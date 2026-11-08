import assert from 'node:assert/strict';
import test from 'node:test';
import { applyItemLowStockMigration, migrationBody } from '../../scripts/apply-item-low-stock-migration.mjs';

async function verifyMigrationAtomicity() {
    const source = 'begin;\nselect 42;\ncommit;';
    const queries = [];
    const client = { query: async (sql, params) => {
      queries.push({ sql, params });
      const rows = sql.startsWith('select to_regprocedure') ? [{ installed: true }] : [];
      return { rows };
    } };
    assert.equal((await applyItemLowStockMigration({ client, source })).status, 'applied');
    assert.equal(queries[0].sql, 'begin');
    assert.equal(queries.at(-1).sql, 'commit');
    assert.equal(queries.find(query => query.sql.startsWith('insert into')).params[2][0], migrationBody(source));
    const retry = { query: async sql => ({ rows: sql.startsWith('select name')
      ? [{ name: 'item_low_stock_targets', statements: [migrationBody(source)] }]
      : sql.startsWith('select to_regprocedure') ? [{ installed: true }] : [] }) };
    assert.equal((await applyItemLowStockMigration({ client: retry, source })).status, 'already_applied');
    assert.equal(migrationBody('select 1;'), 'select 1;');
    assert.throws(() => migrationBody('select 1; commit;'), /TRANSACTION_REQUIRED/);
}

export function registerMigrationAtomicityTest() {
  test('migration and history entry are atomic and retry verifies the same contents', verifyMigrationAtomicity);
}
