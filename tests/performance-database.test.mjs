import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertPairedSqlPerformance,
  assertApprovedSqlSchemaExtension,
  assertPinnedReaderTextContract,
  assertSamePinnedMigrationSnapshot,
  assertSqlControlCoverage,
  BETA_DRIVE_CARD_FIELDS,
  buildLocalIdentityFixture,
  buildBetaDrivePageSql,
  buildInventoryPageSql,
  cleanupLocalIdentity,
  inventoryScopeSql,
  pinnedBaselineProjections,
  parseBenchmarkCliArgs,
  readTomlInteger,
  readInventoryPhysicalSizes,
  resolveLocalApiUrl,
  vacuumEmptyPerformanceInventory,
  sanitizedApplicationErrorCode,
  sanitizedDatabaseFailureCode,
  runDatabasePerformanceBenchmark,
  validateApiFunctionPolicy,
  validateLocalBenchmarkUrl,
} from '../scripts/performance-database.mjs';
import {
  INVENTORY_MASTER_BROWSE_FIELDS,
  INVENTORY_MASTER_FULL_FIELDS,
} from '../supabase/functions/_shared/inventory-projections.ts';

test('API benchmark requires oneshot policy while SQL benchmark policy remains unchanged', () => {
  assert.equal(validateApiFunctionPolicy('api', 'oneshot'), 'oneshot');
  assert.throws(() => validateApiFunctionPolicy('api', undefined), /PERFORMANCE_API_FUNCTION_POLICY_REQUIRED/);
  assert.throws(() => validateApiFunctionPolicy('api', 'per_worker'), /PERFORMANCE_API_FUNCTION_POLICY_REQUIRED/);
  assert.equal(validateApiFunctionPolicy('sql', undefined), null);
});

test('performance benchmark accepts only loopback URLs and configured API port', () => {
  assert.equal(validateLocalBenchmarkUrl('http://127.0.0.1:54321/', ['http:'], '/').port, '54321');
  assert.equal(validateLocalBenchmarkUrl('postgresql://postgres:local@localhost:54322/postgres', ['postgresql:'], '/postgres').port, '54322');
  assert.throws(() => validateLocalBenchmarkUrl('https://db.example.com', ['https:']), /PERFORMANCE_LOCAL_URL_REQUIRED/);
  assert.throws(() => validateLocalBenchmarkUrl('http://127.0.0.1:54321/functions/v1', ['http:'], '/'), /PERFORMANCE_LOCAL_URL_REQUIRED/);
  assert.throws(() => validateLocalBenchmarkUrl('http://192.168.1.4:54321', ['http:']), /PERFORMANCE_LOCAL_URL_REQUIRED/);
});

test('benchmark reads API port from its TOML section rather than the database port', () => {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.equal(readTomlInteger(config, 'api', 'port'), 54321);
  assert.equal(readTomlInteger(config, 'db', 'port'), 54322);
  assert.ok(Number.isNaN(readTomlInteger(config, 'api.tls', 'port')));
});

test('SQL-only benchmark validation does not require an API endpoint, but API mode does', () => {
  const config = '[api]\nport = 54321\n[db]\nport = 54322\n';
  assert.equal(resolveLocalApiUrl({}, config, false), null);
  assert.throws(() => resolveLocalApiUrl({}, config, true), /PERFORMANCE_LOCAL_API_URL_MISSING/);
  assert.equal(resolveLocalApiUrl({ API_URL: 'http://127.0.0.1:54321/' }, config, true).port, '54321');
  assert.throws(() => resolveLocalApiUrl({ API_URL: 'http://127.0.0.1:54322/' }, config, true), /PERFORMANCE_LOCAL_API_PORT_MISMATCH/);
});

test('API benchmark identities link Auth, profile, and legacy account fixtures', () => {
  const fixture = buildLocalIdentityFixture('rep', 'fixture-123', 'Bench-random-password-123!');
  const generatedFixture = buildLocalIdentityFixture('admin', 'DRIVE-V1', 'Bench-random-password-123!');
  assert.equal(generatedFixture.username, 'perf_admin_drive-v1');
  assert.equal(generatedFixture.username, generatedFixture.username.toLowerCase());
  assert.equal(generatedFixture.legacyRow.username, generatedFixture.profileRow.username);
  assert.equal(fixture.legacyRow.username, fixture.username);
  assert.equal(fixture.legacyRow.password, fixture.password);
  assert.equal(fixture.legacyRow.role, 'REP');
  assert.equal(fixture.profileRow.username, fixture.username);
  assert.equal(fixture.profileRow.role, 'REP');
  assert.equal(fixture.profileRow.must_change_password, false);
  assert.equal(fixture.legacyRow.must_change_password, false);
  assert.throws(() => buildLocalIdentityFixture('rep', 'fixture-123', ''), /PERFORMANCE_LOCAL_IDENTITY_FIXTURE_INVALID/);
  assert.throws(() => buildLocalIdentityFixture('unknown', 'fixture-123', 'Bench-random-password-123!'), /PERFORMANCE_LOCAL_IDENTITY_FIXTURE_INVALID/);
});

test('database fixture diagnostics retain only a validated SQLSTATE', () => {
  const failure = sanitizedDatabaseFailureCode('PERFORMANCE_LOCAL_PROFILE_CREATE_FAILED', {
    code: '23514', message: 'sensitive database detail', details: 'private row contents',
  });
  assert.equal(failure.message, 'PERFORMANCE_LOCAL_PROFILE_CREATE_FAILED:23514');
  assert.doesNotMatch(failure.message, /sensitive|private/);
  assert.equal(sanitizedDatabaseFailureCode('PERFORMANCE_LOCAL_PROFILE_CREATE_FAILED', {
    code: 'not-a-sqlstate', message: 'secret',
  }).message, 'PERFORMANCE_LOCAL_PROFILE_CREATE_FAILED:UNKNOWN');
  assert.throws(() => sanitizedDatabaseFailureCode('profile failed', { code: '23514' }), /PERFORMANCE_LOCAL_ERROR_PREFIX_INVALID/);
});

test('physical fixture reset requires the verified owner and zero rows before vacuum', async () => {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql.includes('pg_get_userbyid')) return { rows: [{ owner: 'postgres' }] };
    if (sql === 'SELECT current_user') return { rows: [{ current_user: 'postgres' }] };
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ total: '0' }] };
    if (sql === 'VACUUM (FULL, ANALYZE) public.ph_master_inventory') return { rows: [] };
    throw new Error('unexpected query');
  } };
  await vacuumEmptyPerformanceInventory(db);
  assert.deepEqual(calls, [
    `SELECT pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c WHERE c.oid='public.ph_master_inventory'::regclass`,
    'SELECT current_user',
    'SELECT count(*)::bigint AS total FROM public.ph_master_inventory',
    'VACUUM (FULL, ANALYZE) public.ph_master_inventory',
  ]);
});

test('physical fixture reset never vacuums an unowned or nonempty inventory table', async () => {
  const ownerDb = { async query(sql) {
    if (sql.includes('pg_get_userbyid')) return { rows: [{ owner: 'another_role' }] };
    if (sql === 'SELECT current_user') return { rows: [{ current_user: 'postgres' }] };
    throw new Error('owner guard should stop before inventory count or vacuum');
  } };
  await assert.rejects(vacuumEmptyPerformanceInventory(ownerDb), /PERFORMANCE_FIXTURE_TABLE_OWNER_REQUIRED/);

  const calls = [];
  const nonemptyDb = { async query(sql) {
    calls.push(sql);
    if (sql.includes('pg_get_userbyid')) return { rows: [{ owner: 'postgres' }] };
    if (sql === 'SELECT current_user') return { rows: [{ current_user: 'postgres' }] };
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ total: '1' }] };
    throw new Error('nonempty guard should stop before vacuum');
  } };
  await assert.rejects(vacuumEmptyPerformanceInventory(nonemptyDb), /PERFORMANCE_FIXTURE_REQUIRES_EMPTY_INVENTORY/);
  assert.ok(!calls.some(sql => sql.startsWith('VACUUM')));
});

test('physical relation diagnostics expose only checked heap, index, and total byte counts', async () => {
  const db = { async query(sql) {
    assert.match(sql, /pg_relation_size\('public\.ph_master_inventory'\)/);
    assert.match(sql, /pg_indexes_size\('public\.ph_master_inventory'\)/);
    assert.match(sql, /pg_total_relation_size\('public\.ph_master_inventory'\)/);
    return { rows: [{ heap_bytes: '2490368', index_bytes: '21905408', total_bytes: '24428544' }] };
  } };
  assert.deepEqual(await readInventoryPhysicalSizes(db), { heapBytes: 2490368, indexBytes: 21905408, totalBytes: 24428544 });
  await assert.rejects(readInventoryPhysicalSizes({ async query() {
    return { rows: [{ heap_bytes: 'NaN', index_bytes: '-1', total_bytes: 'unknown' }] };
  } }), /PERFORMANCE_RELATION_SIZE_INVALID/);
});

test('local identity cleanup removes only its rep mapping before profile and Auth deletion', async () => {
  const calls = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const legacyUserId = '22222222-2222-4222-8222-222222222222';
  const db = { async query(sql, values) { calls.push(['db', sql, values]); return { rows: [] }; } };
  const admin = {
    from(table) {
      return {
        delete() {
          return { async eq(column, value) {
            calls.push([table, column, value]);
            return { error: null };
          } };
        },
      };
    },
    auth: { admin: { async deleteUser(id) { calls.push(['auth', id]); return { error: null }; } } },
  };

  await cleanupLocalIdentity(db, admin, userId, legacyUserId);
  assert.deepEqual(calls, [
    ['db', 'DELETE FROM sales_private.rep_identities WHERE profile_id = $1::uuid', [userId]],
    ['profiles', 'id', userId],
    ['auth', userId],
    ['ph_app_users', 'id', legacyUserId],
  ]);
});

test('local identity cleanup errors expose SQLSTATE only', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const db = { async query() { throw Object.assign(new Error('private row detail'), { code: '23503' }); } };
  const admin = {
    from() { return { delete() { return { async eq() { return { error: null }; } }; } }; },
    auth: { admin: { async deleteUser() { return { error: null }; } } },
  };
  await assert.rejects(cleanupLocalIdentity(db, admin, userId, null), error => {
    assert.equal(error.message, 'PERFORMANCE_LOCAL_REP_IDENTITY_CLEANUP_FAILED:23503');
    assert.doesNotMatch(error.message, /private row detail/);
    return true;
  });
});

test('authenticated API diagnostics include only a sanitized application code', () => {
  assert.equal(sanitizedApplicationErrorCode({ code: 'AUTH_PROFILE_LOCKED', message: 'private user detail' }), 'AUTH_PROFILE_LOCKED');
  assert.equal(sanitizedApplicationErrorCode({ code: 'bad code', message: 'token=secret' }), 'UNKNOWN');
  assert.equal(sanitizedApplicationErrorCode({ code: 'A'.repeat(81) }), 'UNKNOWN');
  assert.equal(sanitizedApplicationErrorCode({ message: 'raw server text' }), 'UNKNOWN');
  assert.equal(sanitizedApplicationErrorCode('not an object'), 'UNKNOWN');
});

test('SQL scenarios mirror the active fixed role scopes and exact projections', () => {
  assert.equal(inventoryScopeSql('admin'), '');
  assert.match(inventoryScopeSql('rep'), /season IS NULL OR season NOT ILIKE 'U3'/);
  assert.match(inventoryScopeSql('rep'), /lotcode IS NULL OR lotcode NOT ILIKE '%\.U3'/);
  assert.match(inventoryScopeSql('foreman'), /priority IS NOT NULL/);
  assert.throws(() => inventoryScopeSql('unknown'), /PERFORMANCE_ROLE_UNSUPPORTED/);

  const query = buildInventoryPageSql({ fields: INVENTORY_MASTER_BROWSE_FIELDS, role: 'rep', itemcode: 'A-1',
    offset: 9000, limit: 500 });
  assert.equal(query.values[0], 'A-1');
  assert.match(query.page, /^SELECT unique_id,/);
  assert.match(query.page, /season IS NULL OR season NOT ILIKE 'U3'/);
  assert.match(query.page, /lotcode IS NULL OR lotcode NOT ILIKE '%\.U3'/);
  assert.match(query.page, /itemcode = \$1 ORDER BY unique_id ASC OFFSET 9000 LIMIT 500$/);
  assert.match(query.count, /^SELECT count\(\*\)::bigint AS total FROM public\.ph_master_inventory/);
  assert.doesNotMatch(query.page, /SELECT \*/);

  const queue = buildInventoryPageSql({ fields: INVENTORY_MASTER_FULL_FIELDS, queue: true, queueOrder: true,
    offset: 0, limit: 500 });
  assert.match(queue.page, /app_tab_assignment = 'ncr_inventory_recount'/);
  assert.match(queue.page, /ORDER BY last_updated DESC NULLS LAST, unique_id ASC OFFSET 0 LIMIT 500$/);
  assert.throws(() => buildInventoryPageSql({ fields: '*', limit: 1 }), /PERFORMANCE_PROJECTION_INVALID/);
  assert.throws(() => buildInventoryPageSql({ fields: 'itemcode', limit: 1 }), /PERFORMANCE_PROJECTION_INVALID/);
  assert.throws(() => buildInventoryPageSql({ fields: 'unique_id;drop table x', limit: 1 }), /PERFORMANCE_PROJECTION_INVALID/);
  assert.throws(() => buildInventoryPageSql({ fields: 'unique_id', offset: -1, limit: 1 }), /PERFORMANCE_PAGE_INVALID/);
});

test('pinned baseline projections remain exact and genuinely paired SQL timings keep the configured budget', () => {
  const baseline = pinnedBaselineProjections();
  assert.equal(baseline.browse, INVENTORY_MASTER_BROWSE_FIELDS);
  assert.equal(baseline.full, INVENTORY_MASTER_FULL_FIELDS);
  assert.equal(assertPairedSqlPerformance([
    { id: 'db.master.baseline.page.execution_ms', kind: 'database-duration', samples: [1, 2, 3, 4, 5] },
    { id: 'db.master.candidate.page.execution_ms', kind: 'database-duration', samples: [8, 9, 10, 11, 12] },
  ]), true);
  assert.equal(assertPairedSqlPerformance([
    { id: 'db.master.baseline.page.execution_ms', kind: 'database-duration', samples: [5, 5, 5] },
    { id: 'db.master.candidate.page.execution_ms', kind: 'database-duration', samples: [20, 20, 20] },
  ]), true, 'temporary SQL ceiling is twice the original 5 + 5ms limit');
  assert.throws(() => assertPairedSqlPerformance([
    { id: 'db.master.baseline.page.execution_ms', kind: 'database-duration', samples: [5, 5, 5] },
    { id: 'db.master.candidate.page.execution_ms', kind: 'database-duration', samples: [21, 21, 21] },
  ]), /PERFORMANCE_SQL_REGRESSION/);
  assert.throws(() => assertPairedSqlPerformance([]), /PERFORMANCE_SQL_PAIR_EMPTY/);
  assert.throws(() => assertPairedSqlPerformance([
    { id: 'db.master.candidate.page.execution_ms', kind: 'database-duration', samples: [1, 2, 3] },
  ]), /PERFORMANCE_SQL_PAIR_INCOMPLETE/);
});

test('identical pinned readers and migration snapshots are required for shared SQL controls', () => {
  const baselineAppApi = `function inventoryReadParams(payload) { return payload; }\nfunction projectInventoryRows(rows: unknown, fields: string): Json[] {\n  return rows.map(row => row);\n}\nconst AURA_V2_OPERATIONS = new Set([]);`;
  const currentAppApi = `function inventoryReadParams(payload) { return payload; }\nconst AURA_V2_OPERATIONS = new Set([]);`;
  const baselineBetaApi = `export const APP_VERSION = 'old';\nexport function readRows() { return []; }`;
  const currentBetaApi = `export const APP_VERSION = 'new';\nexport function readRows() { return []; }`;
  const digests = assertPinnedReaderTextContract({ baselineAppApi, currentAppApi, baselineBetaApi, currentBetaApi });
  assert.match(digests.inventoryReaderDigest, /^[a-f0-9]{64}$/);
  assert.match(digests.betaReaderDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => assertPinnedReaderTextContract({ baselineAppApi,
    currentAppApi: currentAppApi.replace('return payload', 'return {}'), baselineBetaApi, currentBetaApi }),
  /PERFORMANCE_PINNED_SQL_INVENTORY_READER_CHANGED/);
  assert.throws(() => assertPinnedReaderTextContract({ baselineAppApi, currentAppApi, baselineBetaApi,
    currentBetaApi: currentBetaApi.replace('return []', 'return [1]') }), /PERFORMANCE_PINNED_SQL_BETA_READER_CHANGED/);
  assert.equal(assertSamePinnedMigrationSnapshot(['supabase/migrations/a.sql'], ['supabase/migrations/a.sql'],
    [['supabase/migrations/a.sql', 'a'.repeat(40)]], [['supabase/migrations/a.sql', 'a'.repeat(40)]]), true);
  assert.throws(() => assertSamePinnedMigrationSnapshot(['supabase/migrations/a.sql'],
    ['supabase/migrations/a.sql', 'supabase/migrations/b.sql'], [], []), /PERFORMANCE_PINNED_SQL_MIGRATION_SET_CHANGED/);
  assert.throws(() => assertSamePinnedMigrationSnapshot(['supabase/migrations/a.sql'], ['supabase/migrations/a.sql'],
    [['supabase/migrations/a.sql', 'a'.repeat(40)]], [['supabase/migrations/a.sql', 'b'.repeat(40)]]),
  /PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED/);
});

test('SQL schema pin permits the reviewed additive migration while locking old blobs and full current schema', () => {
  const old = ['supabase/migrations/001_old.sql'];
  const pinned = [...old, 'supabase/migrations/002_reviewed.sql'];
  const oldHash = 'a'.repeat(40), newHash = 'b'.repeat(40);
  assert.equal(assertApprovedSqlSchemaExtension(old, pinned, pinned,
    [[old[0], oldHash]], [[old[0], oldHash], [pinned[1], newHash]], [[old[0], oldHash], [pinned[1], newHash]]), true);
  assert.throws(() => assertApprovedSqlSchemaExtension(old, pinned, pinned,
    [[old[0], oldHash]], [[old[0], 'c'.repeat(40)], [pinned[1], newHash]], [[old[0], 'c'.repeat(40)], [pinned[1], newHash]]),
  /PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED/);
  assert.throws(() => assertApprovedSqlSchemaExtension(old, pinned, pinned,
    [[old[0], oldHash]], [[old[0], oldHash], [pinned[1], newHash]], [[old[0], oldHash], [pinned[1], 'd'.repeat(40)]]),
  /PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED/);
  assert.throws(() => assertApprovedSqlSchemaExtension(old, pinned, [...pinned, 'supabase/migrations/003_unreviewed.sql'],
    [[old[0], oldHash]], [[old[0], oldHash], [pinned[1], newHash]], [[old[0], oldHash], [pinned[1], newHash], ['supabase/migrations/003_unreviewed.sql', 'e'.repeat(40)]]),
  /PERFORMANCE_PINNED_SQL_MIGRATION_SET_CHANGED/);
});

test('identical SQL has shared-control coverage without synthetic baseline/candidate timing samples', () => {
  const evidence = ['master.first', 'master.deep'].map(scenario => ({ scenario,
    comparison: 'not_applicable_identical_sql', queryFingerprint: 'a'.repeat(64),
    sampleCount: 30, controlSampleCount: 30,
    baselineRowHash: 'b'.repeat(64), candidateRowHash: 'b'.repeat(64), baselineCount: '100', candidateCount: '100',
    controlPagePlan: { Plan: { 'Node Type': 'Limit' } }, controlCountPlan: { Plan: { 'Node Type': 'Aggregate' } },
    controlPagePlanNodes: [], controlCountPlanNodes: [],
  }));
  assert.equal(assertSqlControlCoverage(evidence, new Set(['master.first', 'master.deep'])), true);
  assert.throws(() => assertSqlControlCoverage(evidence.slice(0, 1), new Set(['master.first', 'master.deep'])),
    /PERFORMANCE_SQL_CONTROL_COVERAGE_INCOMPLETE/);
  assert.throws(() => assertSqlControlCoverage([{ ...evidence[0], candidateRowHash: 'c'.repeat(64) }], new Set(['master.first'])),
    /PERFORMANCE_SQL_CONTROL_EVIDENCE_INVALID/);
  assert.throws(() => assertSqlControlCoverage([{ ...evidence[0], controlSampleCount: 29 }], new Set(['master.first'])),
    /PERFORMANCE_SQL_CONTROL_EVIDENCE_INVALID/);
});

test('beta Drive physical-read proxy uses its fixed 18-column projection, 250-row pages, and bound search', () => {
  assert.equal(BETA_DRIVE_CARD_FIELDS.split(',').length, 18);
  assert.deepEqual(BETA_DRIVE_CARD_FIELDS.split(','), [
    'unique_id', 'itemcode', 'commonname', 'contsize', 'locationcode', 'lotcode',
    'ptravailable', 'ptronhand', 'ptrreviewed', 'priority', 'season', 'season_supply',
    'saleyear', 'blockalpha', 'blocknumber', 'holdstopcode', 'photo_link', 'photo_name',
  ]);
  const first = buildBetaDrivePageSql();
  assert.match(first.page, /^SELECT unique_id,itemcode,commonname,/);
  assert.match(first.page, /ORDER BY commonname ASC, unique_id ASC OFFSET 0 LIMIT 250$/);
  assert.match(first.count, /^SELECT count\(\*\)::bigint AS total/);
  const deep = buildBetaDrivePageSql({ offset: 99750 });
  assert.match(deep.page, /OFFSET 99750 LIMIT 250$/);
  const searched = buildBetaDrivePageSql({ search: "plant%' OR true --", offset: 250 });
  assert.equal(searched.values[0], "%plant%' OR true --%");
  assert.match(searched.page, /commonname ILIKE \$1 OR itemcode ILIKE \$1 OR locationcode ILIKE \$1/);
  assert.doesNotMatch(searched.page, /plant%/);
  assert.throws(() => buildBetaDrivePageSql({ limit: 251 }), /PERFORMANCE_PAGE_INVALID/);
  assert.throws(() => buildBetaDrivePageSql({ search: '  ' }), /PERFORMANCE_SEARCH_INVALID/);
});

test('benchmark CLI consumes a Supabase path as the value of --cli', () => {
  const options = parseBenchmarkCliArgs(['--sql-workspace', path.join(os.tmpdir(), 'gnc-db-workspace-fixture'),
    '--cli', path.join(os.tmpdir(), 'supabase.exe')]);
  assert.equal(options.mode, '--sql-workspace');
  assert.equal(options.cli, path.join(os.tmpdir(), 'supabase.exe'));
  assert.throws(() => parseBenchmarkCliArgs(['--sql-workspace', 'workspace', '--cli']), /PERFORMANCE_CLI_ARGUMENTS_INVALID/);
  assert.throws(() => parseBenchmarkCliArgs(['--invalid', 'workspace']), /PERFORMANCE_CLI_ARGUMENTS_INVALID/);
});

test('database-check adapter runs only the SQL mode and parses the child report', () => {
  const report = { schemaVersion: 1, metrics: [{ id: 'db.test', kind: 'database-duration', samples: [1] }] };
  let invocation;
  const workspaceRoot = path.join(os.tmpdir(), 'gnc-db-workspace-fixture');
  const cli = path.join(os.tmpdir(), 'repo', 'supabase.exe');
  const actual = runDatabasePerformanceBenchmark({ workspaceRoot, cli,
    executeNode(args, options) { invocation = { args, options }; return `${JSON.stringify(report)}\n`; } });
  assert.deepEqual(actual, report);
  assert.equal(invocation.args[1], '--sql-workspace');
  assert.equal(invocation.args[2], path.resolve(workspaceRoot));
  assert.equal(invocation.args[3], '--cli');
  assert.equal(invocation.args[4], path.resolve(cli));
  assert.equal(invocation.options.capture, true);
  assert.throws(() => runDatabasePerformanceBenchmark({ executeNode() {} }), /PERFORMANCE_WORKSPACE_REQUIRED/);
  assert.throws(() => runDatabasePerformanceBenchmark({ workspaceRoot,
    executeNode() { return 'not-json'; } }), /PERFORMANCE_REPORT_INVALID/);
});
