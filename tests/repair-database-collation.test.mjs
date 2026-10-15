import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runCollationRepair, parsePrometheusMetrics, parseRepairArguments, validateMaintenanceConnectionPort
} from '../scripts/repair-database-collation.mjs';

const GiB = 1024 ** 3;
const metrics = free => `node_filesystem_avail_bytes{service_type="db",supabase_project_ref="local",mountpoint="/data"} ${free}\nnode_filesystem_avail_bytes{service_type="db",supabase_project_ref="local",mountpoint="/"} 2000000000`;
const metricsText = metrics(30_000_000_000);

function fixture(overrides = {}) {
  const state = {
    recorded: '153.120', actual: '153.121', free: 30_000_000_000,
    indexOps: 0, longTransactions: 0, canMaintainInvalid: true,
    failReindex: false, invalid: true, noticeWarning: false, warningOnDatabaseOnly: false, duplicateLock: false,
    owner: 'postgres', currentRole: 'postgres', denyStorageQuery: false,
    dependencyOverrides: null, preserveInvalidAfterRepair: false, actualChangeAfterDatabaseReindex: null,
    actualChangeAfterRefresh: null, noticePayload: null,
    databaseName: 'postgres', listeners: new Set(), statements: [],
    ...overrides
  };
  const client = {
    on(event, listener) { if (event === 'notice') state.listeners.add(listener); },
    off(event, listener) { if (event === 'notice') state.listeners.delete(listener); },
    async query(sql) {
      state.statements.push(sql);
      if (/^SET /.test(sql)) return { rows: [] };
      if (sql.includes("current_setting('data_directory')")) {
        if (state.denyStorageQuery) throw Object.assign(new Error('permission denied to examine data_directory'), { code: '42501' });
        return { rows: [{
        data_directory: '/data/pgdata', database_tablespace_oid: 1663, database_tablespace: 'pg_default',
        database_tablespace_location: '', nondefault_index_tablespaces: 0,
        ...(state.storageOverrides || {})
        }] };
      }
      if (sql.includes('FROM pg_database d')) return { rows: [{
        datname: state.databaseName, datlocprovider: 'i', datcollversion: state.recorded,
        actual_version: state.actual, database_owner: state.owner, current_role: state.currentRole, server_version_num: '170006'
      }] };
      if (sql.includes('pg_stat_progress_create_index')) return { rows: [{ index_ops: state.indexOps, long_transactions: state.longTransactions }] };
      if (sql.includes('materialized_views')) return { rows: [state.dependencyOverrides || {
        materialized_views: 0, default_collation_partition_keys: 0, named_collation_mismatches: 0,
        excluded_default_indexes: 0, system_default_collation_indexes: 0
      }] };
      if (sql.includes('CROSS JOIN LATERAL unnest(i.indcollation)')) return { rows: [
        { schema_name: 'public', table_name: 'customers', index_name: 'customers_name_idx', is_valid: true, is_ready: true, is_live: true, can_maintain: true },
        { schema_name: 'public', table_name: 'ph_drive_around_report_rows', index_name: 'ph_drive_around_report_rows_archive_batch_idx',
          is_valid: !state.invalid, is_ready: !state.invalid, is_live: true, can_maintain: state.canMaintainInvalid }
      ] };
      if (sql.includes('WHERE NOT i.indisvalid')) return state.invalid ? { rows: [{
        schema_name: 'public', table_name: 'ph_drive_around_report_rows',
        index_name: 'ph_drive_around_report_rows_archive_batch_idx', is_valid: false, is_ready: false,
        can_maintain: state.canMaintainInvalid
      }] } : { rows: [] };
      if (sql.includes('sum(pg_relation_size')) return { rows: [
        { schema_name: 'public', table_name: 'customers', table_index_bytes: String(2 * GiB), total_index_bytes: String(2 * GiB) }
      ] };
      if (sql.startsWith('REINDEX INDEX CONCURRENTLY')) {
        if (state.failReindex) throw Object.assign(new Error('index build failed'), { code: 'XX000' });
        if (!state.preserveInvalidAfterRepair) state.invalid = false;
        if (!state.warningOnDatabaseOnly && (state.noticeWarning || state.noticePayload)) {
          for (const listener of state.listeners) listener(state.noticePayload || { severity: 'WARNING' });
        }
        return { rows: [] };
      }
      if (sql.startsWith('REINDEX DATABASE CONCURRENTLY')) {
        if (state.failReindex) throw Object.assign(new Error('database rebuild failed'), { code: 'XX000' });
        if (state.actualChangeAfterDatabaseReindex) state.actual = state.actualChangeAfterDatabaseReindex;
        if (state.noticeWarning || state.noticePayload) {
          for (const listener of state.listeners) listener(state.noticePayload || { severity: 'WARNING' });
        }
        return { rows: [] };
      }
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: !state.duplicateLock }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      if (sql.startsWith('ALTER DATABASE')) {
        state.recorded = state.actual;
        if (state.actualChangeAfterRefresh) state.actual = state.actualChangeAfterRefresh;
        return { rows: [] };
      }
      throw new Error(`Unexpected query in test fixture: ${sql}`);
    }
  };
  return { client, state };
}

const common = {
  projectRef: 'local', expectedDatabase: 'postgres', metricsText,
  expectedRecordedVersion: '153.120', expectedActualVersion: '153.121'
};

test('parses only database filesystem metrics with project labels', () => {
  const parsed = parsePrometheusMetrics(metricsText + '\nnode_filesystem_avail_bytes{service_type="db",supabase_project_ref="other",mountpoint="/data"} 1');
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0], { projectRef: 'local', mountpoint: '/data', bytes: 30_000_000_000 });
  assert.throws(() => parsePrometheusMetrics(''), /COLLATION_METRICS/);
});

test('rejects duplicate or unknown CLI flags', () => {
  assert.deepEqual(parseRepairArguments(['--apply', '--expected-dbname', 'postgres']), {
    '--apply': true, '--expected-dbname': 'postgres'
  });
  assert.throws(() => parseRepairArguments(['--apply', '--apply']), /COLLATION_ARGUMENTS_INVALID/);
  assert.throws(() => parseRepairArguments(['--unexpected']), /COLLATION_ARGUMENTS_INVALID/);
  assert.throws(() => parseRepairArguments(['--project-ref', '--apply']), /COLLATION_ARGUMENTS_INVALID/);
});

test('maintenance connection requires explicit session-port 5432 before network access', () => {
  const url = validateMaintenanceConnectionPort('postgresql://user:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres');
  assert.equal(url.port, '5432');
  assert.throws(
    () => validateMaintenanceConnectionPort('postgresql://user:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres'),
    /COLLATION_SESSION_POOLER_REQUIRED/
  );
  assert.throws(
    () => validateMaintenanceConnectionPort('postgresql://user:secret@db.example.supabase.co/postgres'),
    /COLLATION_SESSION_POOLER_REQUIRED/
  );
  assert.throws(() => validateMaintenanceConnectionPort('not-a-url'), /COLLATION_DATABASE_URL_INVALID/);
});

test('default execution audits without mutating', async () => {
  const { client, state } = fixture();
  const result = await runCollationRepair({ ...common, client });
  assert.equal(result.mode, 'audit');
  assert.equal(result.dependentIndexCount, 2);
  assert.equal(result.eligible, false);
  assert.equal(state.statements.some(sql => /^(REINDEX|ALTER DATABASE|BEGIN)/.test(sql)), false);
});

test('matching collation version is a guarded no-op', async () => {
  const { client, state } = fixture({ recorded: '153.121', actual: '153.121' });
  const result = await runCollationRepair({ ...common, client, apply: true });
  assert.equal(result.mode, 'noop');
  assert.equal(state.statements.some(sql => /^(REINDEX|ALTER DATABASE)/.test(sql)), false);
});

test('unexpected version change fails closed', async () => {
  const { client } = fixture({ actual: '153.122' });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_VERSION_GUARD_FAILED/);
});

test('insufficient disk headroom prevents every mutation', async () => {
  const { client, state } = fixture();
  await assert.rejects(runCollationRepair({ ...common, client, metricsText: metrics(GiB), apply: true }), /COLLATION_DISK_HEADROOM/);
  assert.equal(state.statements.some(sql => /^(REINDEX|ALTER DATABASE)/.test(sql)), false);
});

test('insufficient root filesystem headroom is rejected by metrics parsing', async () => {
  const { client, state } = fixture();
  const metricsText = `${metrics(GiB).split('\n')[0]}\nnode_filesystem_avail_bytes{service_type="db",supabase_project_ref="local",mountpoint="/"} 100`;
  await assert.rejects(runCollationRepair({ ...common, metricsText, client, apply: true }), /COLLATION_METRICS_ROOT_FILESYSTEM_LOW/);
  assert.equal(state.statements.some(sql => sql.startsWith('REINDEX')), false);
});

test('custom tablespaces or unsupported data directories block apply', async t => {
  for (const storageOverrides of [
    { database_tablespace: 'extra_space' },
    { database_tablespace_location: '/mnt/extra' },
    { nondefault_index_tablespaces: 1 },
    { data_directory: '/other/postgres' },
    { data_directory: '/data/pgdata/nested' }
  ]) {
    await t.test(JSON.stringify(storageOverrides), async () => {
      const { client, state } = fixture({ storageOverrides });
      await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_STORAGE_LOCATION_UNSUPPORTED/);
      assert.equal(state.statements.some(sql => sql.startsWith('REINDEX')), false);
    });
  }
});

test('hosted canonical PGDATA link path is accepted', async () => {
  const { client } = fixture({ storageOverrides: { data_directory: '/var/lib/postgresql/data' } });
  const result = await runCollationRepair({ ...common, client, apply: true });
  assert.equal(result.refreshed, true);
});

test('active index build or long transaction prevents mutations', async t => {
  for (const value of [{ indexOps: 1 }, { longTransactions: 1 }]) {
    await t.test(JSON.stringify(value), async () => {
      const { client, state } = fixture(value);
      await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_ACTIVITY/);
      assert.equal(state.statements.some(sql => /^(REINDEX|ALTER DATABASE)/.test(sql)), false);
    });
  }
});

test('invalid index without individual MAINTAIN is denied before database reindex', async () => {
  const { client, state } = fixture({ canMaintainInvalid: false });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_INVALID_INDEX/);
  assert.equal(state.statements.some(sql => sql.startsWith('REINDEX')), false);
});

test('non-owner is denied before acquiring a lock or mutating', async () => {
  const { client, state } = fixture({ currentRole: 'app_user', denyStorageQuery: true });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_DATABASE_OWNER_REQUIRED/);
  assert.equal(state.statements.some(sql => /^(REINDEX|ALTER DATABASE|SELECT pg_try_advisory_lock)/.test(sql)), false);
  assert.equal(state.statements.some(sql => sql.includes("current_setting('data_directory')")), false,
    'non-owner authorization must be checked before probing restricted storage settings');
});

test('unsupported dependencies are rejected before mutation', async t => {
  for (const field of ['materialized_views', 'default_collation_partition_keys', 'named_collation_mismatches', 'excluded_default_indexes', 'system_default_collation_indexes']) {
    await t.test(field, async () => {
      const { client, state } = fixture({ dependencyOverrides: {
        materialized_views: 0, default_collation_partition_keys: 0, named_collation_mismatches: 0,
        excluded_default_indexes: 0, system_default_collation_indexes: 0, [field]: 1
      } });
      await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_DEPENDENCY_UNSUPPORTED/);
      assert.equal(state.statements.some(sql => sql.startsWith('REINDEX')), false);
    });
  }
});

test('a duplicate repair lock is rejected before mutation', async () => {
  const { client, state } = fixture({ duplicateLock: true });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REPAIR_ALREADY_RUNNING/);
  assert.equal(state.statements.some(sql => sql.startsWith('REINDEX')), false);
});

test('unsupported invalid index is rejected before mutation', async () => {
  const { client, state } = fixture();
  const originalQuery = client.query;
  client.query = async sql => sql.includes('WHERE NOT i.indisvalid')
    ? { rows: [{ schema_name: 'auth', table_name: 'accounts', index_name: 'surprise_idx', is_valid: false, is_ready: false, can_maintain: true }] }
    : originalQuery(sql);
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_INVALID_INDEX/);
  assert.equal(state.statements.some(sql => sql.startsWith('REINDEX')), false);
});

test('failed index reindex never refreshes collation metadata', async () => {
  const { client, state } = fixture({ failReindex: true });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /index build failed/);
  assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
});

test('unexpected reindex warning stops before collation metadata refresh', async () => {
  const { client, state } = fixture({ noticeWarning: true });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REINDEX_NOTICE_FAILED/);
  assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
  assert.equal(state.listeners.size, 0);
});

test('database reindex warning also prevents metadata refresh', async () => {
  const { client, state } = fixture({ noticeWarning: true, warningOnDatabaseOnly: true });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REINDEX_NOTICE_FAILED/);
  assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
});

test('the exact PG17 concurrent system-catalog skip warning is accepted only for database reindex', async () => {
  const { client } = fixture({ warningOnDatabaseOnly: true, noticePayload: {
    severity: 'WARNING', code: '0A000',
    message: 'cannot reindex system catalogs concurrently, skipping all'
  } });
  const result = await runCollationRepair({ ...common, client, apply: true });
  assert.equal(result.acceptedNotices.expectedCatalogSkip, 1);
  assert.equal(result.acceptedNotices.expectedCollationMismatch, 0);
});

test('system-catalog skip warning with unexpected SQLSTATE fails closed', async () => {
  const { client, state } = fixture({ warningOnDatabaseOnly: true, noticePayload: {
    severity: 'WARNING', code: '22000',
    message: 'cannot reindex system catalogs concurrently, skipping all'
  } });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REINDEX_NOTICE_FAILED/);
  assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
});

test('system-catalog skip warning in index-repair phase fails closed', async () => {
  const { client, state } = fixture({ noticePayload: {
    severity: 'WARNING', code: '0A000',
    message: 'cannot reindex system catalogs concurrently, skipping all'
  } });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REINDEX_NOTICE_FAILED/);
  assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
});

test('the exact current-database collation mismatch warning with expected versions is accepted', async () => {
  const { client } = fixture({ warningOnDatabaseOnly: true, noticePayload: {
    severity: 'WARNING', code: '01000',
    message: 'database "postgres" has a collation version mismatch',
    detail: 'The database was created using collation version 153.120, but the operating system provides version 153.121.'
  } });
  const result = await runCollationRepair({ ...common, client, apply: true });
  assert.equal(result.acceptedNotices.expectedCollationMismatch, 1);
});

test('collation mismatch warnings for another database or version fail closed', async t => {
  const notices = [
    { severity: 'WARNING', code: '01000', message: 'database "other" has a collation version mismatch',
      detail: 'The database was created using collation version 153.120, but the operating system provides version 153.121.' },
    { severity: 'WARNING', code: '01000', message: 'database "postgres" has a collation version mismatch',
      detail: 'The database was created using collation version 153.119, but the operating system provides version 153.121.' }
  ];
  for (const noticePayload of notices) {
    await t.test(noticePayload.message, async () => {
      const { client, state } = fixture({ warningOnDatabaseOnly: true, noticePayload });
      await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REINDEX_NOTICE_FAILED/);
      assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
    });
  }
});

test('failed post-reindex verification keeps original collation metadata', async () => {
  const { client, state } = fixture({ preserveInvalidAfterRepair: true });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REINDEX_VERIFICATION_FAILED/);
  assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
});

test('fresh post-reindex collation identity is checked before refresh', async () => {
  const { client, state } = fixture({ actualChangeAfterDatabaseReindex: '153.122' });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REINDEX_VERIFICATION_FAILED/);
  assert.equal(state.statements.some(sql => sql.startsWith('ALTER DATABASE')), false);
});

test('fresh post-refresh recorded and actual versions must still equal the preflighted version', async () => {
  const { client, state } = fixture({ actualChangeAfterRefresh: '153.122' });
  await assert.rejects(runCollationRepair({ ...common, client, apply: true }), /COLLATION_REFRESH_VERIFICATION_FAILED/);
});

test('quoted database identifiers are escaped', async () => {
  const databaseName = 'odd"name';
  const { client, state } = fixture({ databaseName });
  const result = await runCollationRepair({ ...common, expectedDatabase: databaseName, client, apply: true });
  assert.ok(state.statements.some(sql => sql.startsWith('REINDEX DATABASE CONCURRENTLY "odd""name"')));
  assert.equal(result.database, databaseName);
});

test('successful path repairs known invalid index, reindexes database, then refreshes last', async () => {
  const { client, state } = fixture();
  const result = await runCollationRepair({ ...common, client, apply: true });
  const index = state.statements.findIndex(sql => sql.startsWith('REINDEX INDEX CONCURRENTLY'));
  const database = state.statements.findIndex(sql => sql.startsWith('REINDEX DATABASE CONCURRENTLY'));
  const refresh = state.statements.findIndex(sql => sql.startsWith('ALTER DATABASE'));
  const parallelism = state.statements.indexOf('SET max_parallel_maintenance_workers = 0');
  assert.ok(index > -1 && index < database && database < refresh);
  assert.ok(parallelism > -1 && parallelism < index);
  assert.match(state.statements[database], /"postgres"/);
  assert.equal(state.statements.some(sql => /^BEGIN\b/i.test(sql)), false);
  assert.equal(result.refreshed, true);
  assert.equal(result.recordedVersion, '153.121');
});
