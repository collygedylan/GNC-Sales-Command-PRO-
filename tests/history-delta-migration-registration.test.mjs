import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { sqlStatements } from '../scripts/database-catalog.mjs';
import { applyItemLowStockMigration, buildScopedMigrationApplySql, historyDeltaMigrationNames,
  migrationContractQuery, normalizeScopedMigrationPaths, releaseDatabaseMigrations } from '../scripts/apply-item-low-stock-migration.mjs';

test('Phase B history migrations are ordered, transactional and wired to exact installed contracts', () => {
  assert.equal(historyDeltaMigrationNames.length, 11);
  assert.deepEqual(historyDeltaMigrationNames, [...historyDeltaMigrationNames].sort());
  assert.deepEqual(releaseDatabaseMigrations.slice(0, historyDeltaMigrationNames.length), historyDeltaMigrationNames);
  const paths = historyDeltaMigrationNames.map(name => `supabase/migrations/${name}`);
  assert.deepEqual(normalizeScopedMigrationPaths(paths), historyDeltaMigrationNames);
  for (const [index, file] of paths.entries()) {
    const name = historyDeltaMigrationNames[index];
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /^begin;/i);
    const statements = sqlStatements(source);
    assert.match(statements.at(-1), /commit;?$/i);
    assert.ok(statements.every(statement => !/^\s*(delete|vacuum)\b/i.test(statement)));
    const contract = migrationContractQuery(name);
    assert.match(contract, /as installed$/i);
    const install = buildScopedMigrationApplySql({ source, targetMigrationName: name });
    assert.ok(install.includes(contract));
    assert.ok(install.includes('LOW_STOCK_DATABASE_CONTRACT_MISSING'));
  }
});

test('an unverified Phase B installed contract rolls back rather than publishing an accepted receipt', async () => {
  const name = historyDeltaMigrationNames.at(-1);
  const source = fs.readFileSync(`supabase/migrations/${name}`, 'utf8');
  const contract = migrationContractQuery(name);
  const calls = [];
  const client = { async query(sql) {
    calls.push(sql);
    return { rows: sql === contract ? [{ installed: false }] : [] };
  } };
  await assert.rejects(applyItemLowStockMigration({ client, source, targetMigrationName: name }), /DATABASE_CONTRACT_MISSING/);
  assert.equal(calls.at(-1), 'rollback');
  assert.ok(!calls.includes('commit'));
});
