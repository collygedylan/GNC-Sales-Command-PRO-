import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationBody, buildScopedMigrationApplySql, releaseDatabaseMigrations } from '../scripts/apply-item-low-stock-migration.mjs';

const unsafe = /LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED/;

test('transactionless migrations are embedded under the runner transaction and lock', () => {
  const source = "set local lock_timeout='1s';\nselect 'commit;';\ndo $body$ begin perform 1; end $body$;\n";
  assert.equal(migrationBody(source), source);
  const sql = buildScopedMigrationApplySql({ source, targetMigrationName: releaseDatabaseMigrations[0] });
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.ok(sql.includes(source));
  assert.match(sql, /commit;\s*$/);
});

test('wrapped migrations retain one outer transaction', () => {
  assert.equal(migrationBody('begin;\nselect 1;\ncommit;\n'), 'select 1;');
});

test('transaction control cannot escape the enclosing runner transaction', () => {
  for (const command of ['commit', 'begin', 'rollback', 'abort', 'end', 'savepoint x', 'release x', 'start transaction', 'prepare transaction', 'set transaction', 'set standard_conforming_strings = off', 'set local standard_conforming_strings = off']) {
    assert.throws(() => migrationBody(`select 1; /* nested /* comment */ */ ${command}; select 2;`), unsafe, command);
    assert.throws(() => migrationBody(`begin;\nselect 1; ${command};\ncommit;`), unsafe, command);
  }
});

test('quoted content and malformed lexical input cannot hide transaction control', () => {
  assert.doesNotThrow(() => migrationBody("select E'commit\\\' text'; -- rollback;\nselect 1;"));
  for (const source of ["select 'unterminated", 'select $tag$ unterminated', '/* unterminated']) {
    assert.throws(() => migrationBody(source), unsafe);
  }
  assert.throws(() => migrationBody("select 'x\\'; commit; select 1;"), unsafe);
});
