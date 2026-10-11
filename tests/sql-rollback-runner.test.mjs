import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runSqlRollbackTests, validateRollbackTransaction } from '../scripts/run-sql-rollback-tests.mjs';
import { discoverTests } from '../scripts/test-discovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('rollback canaries own all fixture inserts inside their original transaction', () => {
  const files = discoverTests({ root, group: 'sql-rollback' });
  assert.ok(files.length > 0, 'at least one rollback canary is required');
  const sources = files.map(file => ({ file, source: readFileSync(path.join(root, file), 'utf8') }));
  for (const { file, source } of sources) {
    const begin = source.search(/\bbegin\s*;/i);
    const rollback = source.search(/\brollback\s*;\s*$/i);
    assert.ok(begin >= 0 && rollback > begin, `${file} must own a transaction`);
    assert.ok(source.indexOf('auth.users', begin) > begin, `${file} seeds identities after BEGIN`);
    assert.ok(source.slice(begin, rollback).includes('rollback-'), `${file} uses synthetic fixture keys`);
    assert.ok(source.slice(begin, rollback).includes('do '), `${file} retains its behavior assertions`);
    assert.match(source, /@test-runtime:\s*sql-rollback/);
  }
  const photoHistory = sources.find(({ source }) => source.includes('Lemon Grass'));
  assert.ok(photoHistory, 'the discovered rollback set retains the photo-history canary');
  assert.ok(photoHistory.source.includes('megan_kelly'), 'the photo canary seeds its independent manager denial actor');
  assert.ok(!/sql_rollback_common_users\.sql|_rollback_fixtures\.sql/.test(readFileSync(path.join(root, 'scripts/run-sql-rollback-tests.mjs'), 'utf8')),
    'runner executes self-contained discovered test files without fixture injection');
});

test('rollback runner rejects SQL without a leading transaction and terminal rollback', () => {
  assert.equal(validateRollbackTransaction('-- test annotation\n/* fixture */\nBEGIN; SELECT 1; ROLLBACK;'),
    '-- test annotation\n/* fixture */\nBEGIN; SELECT 1; ROLLBACK;');
  assert.throws(() => validateRollbackTransaction('SELECT 1; ROLLBACK;', 'missing-begin.sql'), /NOT_TRANSACTION_CONTAINED/);
  assert.throws(() => validateRollbackTransaction('BEGIN; SELECT 1; COMMIT;', 'committing-canary.sql'), /NOT_TRANSACTION_CONTAINED/);
  assert.throws(() => validateRollbackTransaction('/* unterminated\nBEGIN; ROLLBACK;', 'bad-comment.sql'), /COMMENT_UNTERMINATED/);
});

test('rollback runner passes discovered multi-statement sources to psql only in the verified local container', () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'gnc-db-workspace-test-'));
  mkdirSync(path.join(workspace, 'supabase'), { recursive: true });
  writeFileSync(path.join(workspace, 'supabase', 'config.toml'), 'project_id = "gncdb123abc"\n[db]\nport = 54322\n');
  const executed = [];
  const containerId = 'a'.repeat(64);
  const inspectWorkspace = options => {
    assert.equal(options.workspaceRoot, workspace);
    assert.equal(options.cli, 'supabase');
    return { absolute: workspace, projectId: 'gncdb123abc', containerId };
  };
  try {
    const result = runSqlRollbackTests({
      root,
      workspaceRoot: workspace,
      cli: 'supabase',
      inspectWorkspace,
      executeNode() { throw new Error('rollback runner must not invoke CLI query'); },
      execute(command, args, options) { executed.push({ command, args, options }); return { status: 0, stdout: '', stderr: '' }; },
    });
    assert.ok(result.files.length > 0);
    assert.equal(result.projectId, 'gncdb123abc');
    assert.equal(executed.length, result.files.length);
    for (const [index, call] of executed.entries()) {
      assert.equal(call.command, 'docker');
      assert.deepEqual(call.args, ['exec', '-i', containerId, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']);
      assert.equal(call.options.root, root);
      assert.equal(call.options.capture, true);
      assert.equal(call.options.input, readFileSync(path.join(root, result.files[index]), 'utf8'));
      assert.match(call.options.input, /\bbegin\s*;/i);
      assert.match(call.options.input, /\brollback\s*;\s*$/i);
    }
    executed.length = 0;
    const selected = runSqlRollbackTests({
      root,
      workspaceRoot: workspace,
      cli: 'supabase',
      inspectWorkspace,
      files: [result.files.at(-1), result.files[0], result.files.at(-1)],
      execute(_command, args, options) { executed.push({ args, options }); return { status: 0 }; },
    });
    assert.deepEqual(selected.files, [...new Set([result.files.at(-1), result.files[0]])].sort());
    assert.equal(executed.length, 2, 'requested rollback files are deduplicated');
    assert.throws(() => runSqlRollbackTests({ root, workspaceRoot: workspace, cli: 'supabase', inspectWorkspace, files: ['../../other.sql'] }), /FILE_NOT_DISCOVERED/);
    assert.throws(() => runSqlRollbackTests({ root, workspaceRoot: root, cli: 'supabase' }), /DISPOSABLE_SUPABASE_WORKSPACE_REQUIRED/);
    assert.throws(() => runSqlRollbackTests({ root, workspaceRoot: workspace, cli: 'supabase', inspectWorkspace,
      files: [result.files[0]], execute: () => ({ status: 1, stderr: 'ERROR: canary failure' }) }),
    error => error.message.includes(`SQL_ROLLBACK_TEST_FAILED:${result.files[0]}`) && error.cause?.message.includes('ERROR: canary failure'));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
