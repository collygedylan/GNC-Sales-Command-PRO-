import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditTestDiscovery, discoverAllTests, discoverTests, readTestAnnotations, testDiscoveryGroups } from '../scripts/test-discovery.mjs';

test('test discovery sorts repo-relative files and separates browser Node tests from unit tests', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-test-discovery-'));
  try {
    for (const file of [
      'tests/z.test.mjs', 'tests/a.test.mjs', 'tests/flow.browser.test.mjs',
      'v2/tests/cache-migration.test.mjs', 'v2/src/components/Card.test.tsx',
      'tests/login.e2e.spec.ts', 'tests/python/test_sync.py',
      'supabase/functions/app-api/index.ts', 'supabase/functions/app-api/index_test.ts',
      'supabase/ci/aura_pglite.mjs', 'supabase/ci/aura_concurrency.mjs',
      'supabase/tests/aura_test.sql', 'supabase/tests/fixture_rollback.sql',
      'supabase/tests/aura_rollback_test.sql',
      'supabase/tests/live_dataset_revisions_test.sql',
      'supabase/tests/live_dataset_revisions_empty_statements_test.sql',
    ]) {
      const absolute = path.join(root, file);
      mkdirSync(path.dirname(absolute), { recursive: true });
      const source = file.startsWith('supabase/tests/live_dataset_revisions_')
        ? '-- @test-runtime: live-dataset-revision-sql\n'
        : file.includes('annotations') ? '# @test-group: pgtap' : '';
      writeFileSync(absolute, source);
    }
    assert.deepEqual(discoverTests({ root, group: 'node-unit' }), [
      'tests/a.test.mjs', 'tests/z.test.mjs', 'v2/tests/cache-migration.test.mjs',
    ]);
    assert.deepEqual(discoverTests({ root, group: 'node-browser' }), ['tests/flow.browser.test.mjs']);
    assert.deepEqual(discoverTests({ root, group: 'vitest-mount' }), ['v2/src/components/Card.test.tsx']);
    assert.deepEqual(discoverTests({ root, group: 'playwright' }), ['tests/login.e2e.spec.ts']);
    assert.deepEqual(discoverTests({ root, group: 'deno-tests' }), ['supabase/functions/app-api/index_test.ts']);
    assert.deepEqual(discoverTests({ root, group: 'deno-entrypoints' }), ['supabase/functions/app-api/index.ts']);
    assert.deepEqual(discoverTests({ root, group: 'pglite' }), ['supabase/ci/aura_pglite.mjs']);
    assert.deepEqual(discoverTests({ root, group: 'concurrency' }), ['supabase/ci/aura_concurrency.mjs']);
    assert.deepEqual(discoverTests({ root, group: 'python' }), ['tests/python/test_sync.py']);
    assert.deepEqual(discoverTests({ root, group: 'sql-pgtap' }), [
      'supabase/tests/aura_test.sql',
      'supabase/tests/live_dataset_revisions_empty_statements_test.sql',
      'supabase/tests/live_dataset_revisions_test.sql',
    ]);
    assert.deepEqual(discoverTests({ root, group: 'sql-rollback' }), [
      'supabase/tests/aura_rollback_test.sql', 'supabase/tests/fixture_rollback.sql',
    ]);
    assert.deepEqual(discoverTests({ root, group: 'live-dataset-revision-sql' }), [
      'supabase/tests/live_dataset_revisions_empty_statements_test.sql',
      'supabase/tests/live_dataset_revisions_test.sql',
    ]);
    assert.deepEqual(discoverTests({ root, group: 'sql-isolated-supabase' }), []);
    assert.deepEqual(testDiscoveryGroups, Object.keys(discoverAllTests({ root })));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('discovery rejects unknown groups and reads file-local execution annotations', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-test-annotations-'));
  try {
    mkdirSync(path.join(root, 'tests'), { recursive: true });
    writeFileSync(path.join(root, 'tests/example.test.mjs'), '// @test-group: sql-pgtap\n// @test-runtime: local-db\n');
    assert.throws(() => discoverTests({ root, group: 'everything' }), /TEST_DISCOVERY_UNKNOWN_GROUP/);
    assert.deepEqual(readTestAnnotations({ root, file: 'tests/example.test.mjs' }), [
      { type: 'group', value: 'sql-pgtap' }, { type: 'runtime', value: 'local-db' },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('canonical SQL is selected only by its explicit runtime annotation and must be nonempty', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-test-sql-canonical-'));
  try {
    mkdirSync(path.join(root, 'supabase/tests'), { recursive: true });
    writeFileSync(path.join(root, 'supabase/tests/canonical_test.sql'), '-- @test-runtime: canonical\nselect 1;\n');
    writeFileSync(path.join(root, 'supabase/tests/historical_test.sql'), '-- @test-runtime: isolated-supabase\nselect 1;\n');
    assert.deepEqual(discoverTests({ root, group: 'sql-canonical' }), ['supabase/tests/canonical_test.sql']);
    assert.deepEqual(discoverAllTests({ root })['sql-canonical'], ['supabase/tests/canonical_test.sql']);

    rmSync(path.join(root, 'supabase/tests/canonical_test.sql'));
    assert.throws(() => discoverTests({ root, group: 'sql-canonical' }), /SQL_CANONICAL_TESTS_REQUIRED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sandbox SQL pgTAP discovery is scoped to sandbox tests and must be nonempty', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-test-sandbox-pgtap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'supabase/sandbox/tests'), { recursive: true });
  mkdirSync(path.join(root, 'supabase/tests'), { recursive: true });
  const sandbox = 'supabase/sandbox/tests/private_api_test.sql';
  const production = 'supabase/tests/production_test.sql';
  writeFileSync(path.join(root, sandbox), '-- @test-runtime: sandbox-pgtap\nselect plan(1);\n');
  writeFileSync(path.join(root, production), '-- @test-runtime: canonical\nselect plan(1);\n');
  assert.deepEqual(discoverTests({ root, group: 'sandbox-pgtap' }), [sandbox]);
  assert.deepEqual(discoverAllTests({ root })['sandbox-pgtap'], [sandbox]);
  assert.equal(auditTestDiscovery({ root, requiredGroups: ['sandbox-pgtap'] }).total, 2);
  rmSync(path.join(root, sandbox));
  assert.throws(() => discoverTests({ root, group: 'sandbox-pgtap' }), /SANDBOX_PGTAP_TESTS_REQUIRED/);
});

test('SQL discovery annotations use SQL comments before a runner executes them', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-test-sql-comments-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'supabase/tests'), { recursive: true });
  const file = 'supabase/tests/example_test.sql';
  writeFileSync(path.join(root, file), '// @test-runtime: isolated-supabase\nbegin; rollback;\n');
  assert.throws(() => readTestAnnotations({ root, file }), /TEST_DISCOVERY_SQL_ANNOTATION_COMMENT_INVALID/);
  writeFileSync(path.join(root, file), '-- @test-runtime: isolated-supabase\nbegin; rollback;\n');
  assert.deepEqual(readTestAnnotations({ root, file }), [{ type: 'runtime', value: 'isolated-supabase' }]);
});

test('SQL secondary harness annotations select intentional overlap without changing primary runtime', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-test-sql-harness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'supabase/tests'), { recursive: true });
  const fixture = 'supabase/tests/fixture_test.sql';
  const ordinary = 'supabase/tests/ordinary_test.sql';
  writeFileSync(path.join(root, fixture), '-- @test-runtime: isolated-supabase\n-- @test-harness: season-av\nbegin; rollback;\n');
  writeFileSync(path.join(root, ordinary), '-- @test-runtime: isolated-supabase\nbegin; rollback;\n');
  assert.deepEqual(discoverTests({ root, group: 'sql-isolated-supabase' }), [fixture, ordinary]);
  assert.deepEqual(discoverTests({ root, group: 'sql-secondary-harness', harness: 'season-av' }), [fixture]);
  assert.deepEqual(discoverTests({ root, group: 'sql-secondary-harness' }), [fixture]);
  assert.deepEqual(readTestAnnotations({ root, file: fixture }), [
    { type: 'runtime', value: 'isolated-supabase' }, { type: 'harness', value: 'season-av' },
  ]);
  assert.equal(auditTestDiscovery({ root, requiredGroups: ['sql-isolated-supabase'] }).total, 2);
});

test('the live repository has no unclassified root Node unit test suffixes', () => {
  const all = discoverAllTests();
  assert.ok(all['node-unit'].includes('tests/postgres-storm-read-guard.test.mjs'));
  assert.ok(all['node-unit'].includes('tests/live-runtime-manifest.test.mjs'));
  assert.ok(!all['node-unit'].includes('tests/alpha-command-center.browser.test.mjs'));
  assert.ok(all['node-browser'].includes('tests/alpha-command-center.browser.test.mjs'));
  assert.ok(all['vitest-mount'].some(file => file.endsWith('.test.tsx')));
  assert.ok(all['deno-tests'].length > 0);
  assert.ok(all['sql-pgtap'].length > 0);
});

test('every Playwright spec declares at least one discovered suite tag', () => {
  const specs = discoverTests({ group: 'playwright' });
  assert.ok(specs.length > 0);
  for (const file of specs) {
    const groups = readTestAnnotations({ file }).filter(annotation => annotation.type === 'group');
    assert.ok(groups.length, `${file} must declare its suite/runtime tags`);
  }
  const canary = readTestAnnotations({ file: 'tests/production-request-canary.spec.ts' })
    .flatMap(annotation => annotation.value.split(','));
  assert.ok(canary.includes('@production-canary'));
  assert.ok(!canary.includes('@local-e2e'));
});

test('isolated PostgreSQL runtime tests are discovered separately from PGlite and default units', () => {
  const groups = discoverAllTests();
  assert.ok(groups['postgres-runtime'].includes('supabase/ci/suspend_tag_approval.mjs'));
  assert.ok(!groups['node-unit'].includes('supabase/ci/suspend_tag_approval.mjs'));
  assert.ok(!groups.pglite.includes('supabase/ci/suspend_tag_approval.mjs'));
});

test('database fixtures are assigned one discovered execution environment', () => {
  const groups = discoverAllTests();
  for (const group of ['sql-isolated-supabase', 'sql-isolated-acceptance', 'live-dataset-revision-sql', 'sql-secondary-harness', 'bloomscapes-pgtap', 'suspend-tag-pgtap', 'postgres-concurrency', 'sql-canonical', 'sandbox-pgtap']) assert.ok(groups[group].length > 0, group);
  assert.ok(groups['sandbox-pgtap'].every(file => file.startsWith('supabase/sandbox/tests/')));
  assert.ok(groups['live-dataset-revision-sql'].includes('supabase/tests/live_dataset_revisions_test.sql'));
  assert.ok(!groups['sql-isolated-supabase'].some(file => file.startsWith('supabase/tests/live_dataset_revisions_')));
  const classifiedSql = new Set([
    ...groups['sql-isolated-supabase'], ...groups['sql-isolated-acceptance'],
    ...groups['live-dataset-revision-sql'], ...groups['bloomscapes-pgtap'], ...groups['suspend-tag-pgtap'], ...groups['sql-canonical'],
  ]);
  assert.deepEqual(groups['sql-pgtap'].filter(file => !classifiedSql.has(file)), []);
  for (const file of groups['sql-secondary-harness']) {
    assert.ok(groups['sql-isolated-supabase'].includes(file) || groups['sql-isolated-acceptance'].includes(file), file);
  }
  for (const file of groups['postgres-concurrency']) {
    const annotations = readTestAnnotations({ file });
    assert.equal(annotations.filter(annotation => annotation.type === 'db-env').length, 1, file);
  }
});

test('discovery audit blocks unclassified tests, empty groups and duplicate runtime assignment', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-discovery-audit-'));
  try {
    mkdirSync(path.join(root, 'tests'));
    const file = path.join(root, 'tests/new.test.mjs');
    writeFileSync(file, '');
    assert.equal(auditTestDiscovery({ root, requiredGroups: ['node-unit'] }).total, 1);
    writeFileSync(path.join(root, 'tests/next.test.js'), '');
    assert.equal(auditTestDiscovery({ root, requiredGroups: ['node-unit'] }).total, 2, 'new conventional tests need no central edit');
    assert.throws(() => auditTestDiscovery({ root, requiredGroups: ['vitest-mount'] }), /empty required group/);
    writeFileSync(path.join(root, 'tests/unclassified.test.py'), '');
    assert.throws(() => auditTestDiscovery({ root, requiredGroups: [] }), /unclassified test/);
    rmSync(path.join(root, 'tests/unclassified.test.py'));
    writeFileSync(file, '// @test-runtime: postgres\n');
    assert.throws(() => auditTestDiscovery({ root, requiredGroups: [] }), /duplicate execution/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('all repository tests have one primary runtime and populated required lanes', () => {
  assert.ok(auditTestDiscovery().total > 0);
});
