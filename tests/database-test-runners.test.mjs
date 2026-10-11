import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareIsolatedSqlTests } from '../scripts/prepare-isolated-sql-tests.mjs';
import { runDiscoveredDatabaseTests } from '../scripts/run-discovered-database-tests.mjs';
import { runDiscoveredNodeTests } from '../scripts/run-discovered-tests.mjs';
import { discoverTests } from '../scripts/test-discovery.mjs';

test('source-local tags select discovered setup tests and an empty selection fails', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-tagged-tests-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'tests'));
  writeFileSync(path.join(root, 'tests/new.test.mjs'), '// @test-group: setup\n');
  writeFileSync(path.join(root, 'tests/unrelated.test.mjs'), '');
  const calls = [];
  assert.equal(runDiscoveredNodeTests({ root, group: 'node-unit', argv: ['--tag', 'setup'], print() {}, spawn: (...args) => { calls.push(args); return { status: 0 }; } }), 0);
  assert.deepEqual(calls[0][1], ['--test', '--test-concurrency=1', 'tests/new.test.mjs']);
  assert.throws(() => runDiscoveredNodeTests({ root, group: 'node-unit', argv: ['--tag', 'missing'], print() {} }), /GROUP_EMPTY/);
});

test('Python discovery runs nested convention tests with their own runtime', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-python-tests-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'tests/nested'), { recursive: true });
  writeFileSync(path.join(root, 'tests/nested/test_new.py'), '');
  const calls = [];
  assert.equal(runDiscoveredNodeTests({ root, group: 'python', print() {}, spawn: (...args) => { calls.push(args); return { status: 0 }; } }), 0);
  assert.equal(calls[0][0], process.env.PYTHON || 'python');
  assert.deepEqual(calls[0][1], ['tests/nested/test_new.py']);
});

test('PGlite tests execute from discovery with the caller-owned runtime path', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-pglite-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'supabase/ci'), { recursive: true });
  writeFileSync(path.join(root, 'supabase/ci/alpha_pglite.mjs'), '');
  writeFileSync(path.join(root, 'supabase/ci/ordinary.mjs'), '');
  const calls = [];
  const files = runDiscoveredDatabaseTests({ root, group: 'pglite', pgliteRoot: '/isolated/pglite', spawn: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.deepEqual(files, ['supabase/ci/alpha_pglite.mjs']);
  assert.deepEqual(calls[0][1], [path.join(root, files[0]), '--pglite-root', '/isolated/pglite']);
});

test('every discovered PGlite runner accepts the shared --pglite-root argument', () => {
  const files = discoverTests({ group: 'pglite' });
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /process\.argv\.slice\(2\)/, `${file} reads runner arguments`);
    assert.match(source, /args\.indexOf\(['"]--pglite-root['"]\)/, `${file} parses the shared dependency-root flag`);
  }
});

test('PostgreSQL concurrency tests get only their annotated DB URL and empty groups fail', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-postgres-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/test_race.mjs'), '// @test-runtime: postgres-concurrency\n// @test-db-env: RACE_TEST_DB_URL\n');
  const calls = [];
  const files = runDiscoveredDatabaseTests({ root, group: 'postgres-concurrency', databaseUrl: 'postgres://isolated', spawn: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.deepEqual(files, ['scripts/test_race.mjs']);
  assert.equal(calls[0][2].env.RACE_TEST_DB_URL, 'postgres://isolated');
  assert.throws(() => runDiscoveredDatabaseTests({ root, group: 'pglite', pgliteRoot: '/isolated', spawn: () => ({ status: 0 }) }), /DATABASE_TEST_GROUP_EMPTY/);
});

test('local auth smoke runner accepts only loopback Supabase and runs tagged scripts directly', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-local-auth-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/first.mjs'), '// @test-runtime: local-auth-smoke\n');
  writeFileSync(path.join(root, 'scripts/second.mjs'), '// @test-runtime: local-auth-smoke\n');
  const prior = { url: process.env.SUPABASE_URL, project: process.env.EXPECTED_PROJECT_REF, service: process.env.SUPABASE_SERVICE_ROLE_KEY, publishable: process.env.SUPABASE_PUBLISHABLE_KEY };
  Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:54321', EXPECTED_PROJECT_REF: 'local', SUPABASE_SERVICE_ROLE_KEY: 'local-service-key', SUPABASE_PUBLISHABLE_KEY: 'local-anon-key' });
  const calls = [];
  try {
    assert.equal(runDiscoveredNodeTests({ root, group: 'local-auth-smoke', print() {}, spawn: (...args) => { calls.push(args); return { status: 0 }; } }), 0);
    assert.deepEqual(calls.map(call => call[1]), [['scripts/first.mjs'], ['scripts/second.mjs']]);
    process.env.SUPABASE_URL = 'https://127.0.0.1.example.invalid';
    assert.throws(() => runDiscoveredNodeTests({ root, group: 'local-auth-smoke', print() {}, spawn: () => ({ status: 0 }) }), /LOOPBACK/);
  } finally {
    for (const [key, value] of Object.entries({ SUPABASE_URL: prior.url, EXPECTED_PROJECT_REF: prior.project, SUPABASE_SERVICE_ROLE_KEY: prior.service, SUPABASE_PUBLISHABLE_KEY: prior.publishable })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('dedicated database concurrency groups require their exact loopback fixture database', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-special-concurrency-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'supabase/ci'), { recursive: true });
  writeFileSync(path.join(root, 'supabase/ci/bloomscapes_pending_concurrency.mjs'), '// @test-runtime: bloomscapes-concurrency\n');
  writeFileSync(path.join(root, 'supabase/ci/suspend_tag_concurrency.mjs'), '// @test-runtime: suspend-tag-concurrency\n');
  const priorHost = process.env.PGHOST, priorDb = process.env.PGDATABASE;
  process.env.PGHOST = 'localhost';
  const calls = [];
  try {
    process.env.PGDATABASE = 'pending_orders_test';
    assert.deepEqual(runDiscoveredDatabaseTests({ root, group: 'bloomscapes-concurrency', spawn: (...args) => { calls.push(args); return { status: 0 }; } }), ['supabase/ci/bloomscapes_pending_concurrency.mjs']);
    assert.equal(calls[0][2].env.CI, 'true');
    process.env.PGDATABASE = 'suspend_tag_test';
    assert.deepEqual(runDiscoveredDatabaseTests({ root, group: 'suspend-tag-concurrency', spawn: (...args) => { calls.push(args); return { status: 0 }; } }), ['supabase/ci/suspend_tag_concurrency.mjs']);
    process.env.PGHOST = 'example.invalid';
    assert.throws(() => runDiscoveredDatabaseTests({ root, group: 'suspend-tag-concurrency', spawn: () => ({ status: 0 }) }), /REQUIRES_LOCAL/);
  } finally {
    if (priorHost === undefined) delete process.env.PGHOST; else process.env.PGHOST = priorHost;
    if (priorDb === undefined) delete process.env.PGDATABASE; else process.env.PGDATABASE = priorDb;
  }
});

test('isolated SQL fixture preparation copies self-contained tests without rewriting assertions', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-sql-fixture-source-'));
  const destination = mkdtempSync(path.join(tmpdir(), 'gnc-sql-fixture-destination-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(destination, { recursive: true, force: true }); });
  mkdirSync(path.join(root, 'supabase/tests'), { recursive: true });
  writeFileSync(path.join(root, 'supabase/tests/direct_test.sql'), '-- @test-runtime: isolated-supabase\nselect 1;\n');
  const source = '-- @test-runtime: isolated-acceptance\n\\set ON_ERROR_STOP on\nbegin;\nselect plan(1);\nselect ok(true, \'assertions completed\');\nselect * from finish();\nrollback;\n';
  writeFileSync(path.join(root, 'supabase/tests/acceptance_test.sql'), source);
  const prepared = prepareIsolatedSqlTests({ root, destination });
  assert.deepEqual(prepared.direct, ['supabase/tests/direct_test.sql']);
  assert.deepEqual(prepared.acceptance, ['supabase/tests/acceptance_test.sql']);
  assert.ok(existsSync(path.join(destination, 'direct_test.sql')));
  assert.equal(readFileSync(path.join(destination, 'acceptance_test.sql'), 'utf8'), source);
});

test('isolated SQL fixture preparation accepts only discovered affected tests', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-sql-selected-source-'));
  const destination = mkdtempSync(path.join(tmpdir(), 'gnc-sql-selected-destination-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(destination, { recursive: true, force: true }); });
  mkdirSync(path.join(root, 'supabase/tests'), { recursive: true });
  writeFileSync(path.join(root, 'supabase/tests/direct_test.sql'), '-- @test-runtime: isolated-supabase\nselect 1;\n');
  writeFileSync(path.join(root, 'supabase/tests/other_test.sql'), '-- @test-runtime: isolated-supabase\nselect 2;\n');
  writeFileSync(path.join(root, 'supabase/tests/acceptance_test.sql'), '-- @test-runtime: isolated-acceptance\nselect 3;\n');
  const selected = prepareIsolatedSqlTests({ root, destination,
    testFiles: ['supabase/tests/direct_test.sql'],
  });
  assert.deepEqual(selected, { direct: ['supabase/tests/direct_test.sql'], acceptance: [] });
  assert.deepEqual(readdirSync(destination), ['direct_test.sql']);
  assert.throws(() => prepareIsolatedSqlTests({ root, destination: path.join(destination, 'invalid'),
    testFiles: ['supabase/tests/unknown_test.sql'],
  }), /SQL_TEST_SELECTION_INVALID/);
});

test('historical photo refresh relations are present with production access semantics in the isolated fixture', () => {
  const root = process.cwd();
  const reportFixture = readFileSync(path.join(root, 'supabase/ci/historical_report_baseline.sql'), 'utf8');
  const photoFixture = readFileSync(path.join(root, 'supabase/ci/photo_history_extensions.sql'), 'utf8');
  const baseline = readFileSync(path.join(root, 'supabase/migrations/20260929200000_production_baseline.sql'), 'utf8');
  const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/historical-database-migrations.json'), 'utf8'));
  const historicalSql = manifest.map(entry => readFileSync(path.join(root, entry.source), 'utf8')).join('\n');
  const refreshStart = baseline.indexOf('CREATE FUNCTION public.refresh_photo_history_catalog_v1');
  const refreshEnd = baseline.indexOf('ALTER FUNCTION public.refresh_photo_history_catalog_v1', refreshStart);
  const refresh = baseline.slice(refreshStart, refreshEnd);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  assert.match(reportFixture.trimStart(), /^--[\s\S]*?\nbegin;/i);
  assert.match(reportFixture.trimEnd(), /commit;$/i);
  assert.match(photoFixture.trimStart(), /^--[\s\S]*?\nbegin;/i);
  assert.match(photoFixture.trimEnd(), /commit;$/i);

  const referenced = [...refresh.matchAll(/\b(?:from|join|update|into)\s+public\.([a-z_][a-z0-9_]*)/gi)].map(match => match[1]);
  for (const relation of new Set(referenced)) {
    assert.match(historicalSql, new RegExp(`create table(?: if not exists)? public\\.${relation}\\s*\\(`, 'i'), `${relation} must exist before photo refresh in the historical fixture`);
  }

  for (const relation of ['ph_flyer_folder_history', 'ph_productivity_history']) {
    assert.match(reportFixture, new RegExp(`create table if not exists public\\.${relation}\\s*\\(`, 'i'));
    assert.match(reportFixture, new RegExp(`alter table public\\.${relation} enable row level security`, 'i'));
    assert.match(baseline, new RegExp(`create table public\\.${relation}\\s*\\(`, 'i'));
  }
  for (const field of ['unique_id', 'flyer_photo_link', 'snapshot', 'created_at', 'updated_at']) {
    assert.match(reportFixture, new RegExp(`\\b${field}\\b`, 'i'));
  }
  for (const field of ['event_key', 'completed_by_username', 'source_kind', 'source_unique_id', 'snapshot']) {
    assert.match(reportFixture, new RegExp(`\\b${field}\\b`, 'i'));
  }
  assert.match(reportFixture, /grant select, maintain on table public\.ph_flyer_folder_history to anon, authenticated/i);
  assert.match(reportFixture, /Allow app read flyer folder history[\s\S]*?for select using \(true\)/i);
  assert.match(reportFixture, /Allow app write flyer folder history[\s\S]*?using \(true\) with check \(true\)/i);
  assert.match(reportFixture, /grant select, references, trigger, truncate, maintain[\s\S]*?on table public\.ph_productivity_history to anon, authenticated/i);
  assert.match(photoFixture, /grant all on table public\.ph_photo_archive_jobs to service_role/i);
  assert.match(photoFixture, /revoke all on table public\.ph_photo_archive_jobs from public, anon, authenticated, service_role/i);
  assert.match(photoFixture, /photo_archive_jobs_deny_browser[\s\S]*?as restrictive to anon, authenticated[\s\S]*?using \(false\) with check \(false\)/i);
  assert.match(baseline, /GRANT ALL ON TABLE public\.ph_photo_archive_jobs TO service_role/i);
  assert.doesNotMatch(`${reportFixture}\n${photoFixture}`, /insert into public\.ph_(flyer_folder|productivity|photo_archive_jobs)/i);
});
