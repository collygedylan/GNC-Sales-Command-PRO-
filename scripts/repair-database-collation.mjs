import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  validateDatabaseTarget,
  createDatabaseClientOptions
} from './apply-item-low-stock-migration.mjs';

const PROJECT_ALLOWLIST = new Set(['kzrnyjsosryejjejliii']);
const INVALID_INDEX_ALLOWLIST = new Set(['public.ph_drive_around_report_rows_archive_batch_idx']);
// Hosted Supabase provisioning links /var/lib/postgresql/data to the /data volume.
// Supported paths are documented in https://github.com/supabase/postgres/blob/develop/ansible/tasks/setup-postgres.yml.
const SUPPORTED_DATA_DIRECTORIES = new Set(['/var/lib/postgresql/data', '/data/pgdata']);
const GiB = 1024 ** 3;
let cliPhase = 'argument_validation';

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('COLLATION_IDENTIFIER_INVALID');
  return `"${value.replaceAll('"', '""')}"`;
}

function timeoutValue(value, maximumMs, errorCode) {
  const match = typeof value === 'string' && value.match(/^([1-9]\d*)(ms|s|min)$/);
  if (!match) throw new Error(errorCode);
  const factor = match[2] === 'ms' ? 1 : match[2] === 's' ? 1000 : 60_000;
  const milliseconds = Number(match[1]) * factor;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > maximumMs) throw new Error(errorCode);
  return value;
}

function parsePrometheusMetrics(input) {
  if (typeof input !== 'string') throw new Error('COLLATION_METRICS_MISSING');
  const matches = [];
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^node_filesystem_avail_bytes\{([^}]*)\}\s+([0-9.eE+-]+)\s*$/);
    if (!match) continue;
    const labels = Object.fromEntries([...match[1].matchAll(/([a-zA-Z_][\w]*)="((?:\\.|[^"\\])*)"/g)]
      .map(([, key, value]) => [key, value.replaceAll('\\"', '"').replaceAll('\\\\', '\\')]));
    if (labels.service_type !== 'db' || !labels.supabase_project_ref) continue;
    if (!['/', '/data'].includes(labels.mountpoint)) continue;
    if (!Number.isFinite(Number(match[2])) || Number(match[2]) < 0) continue;
    matches.push({ projectRef: labels.supabase_project_ref, mountpoint: labels.mountpoint, bytes: Number(match[2]) });
  }
  if (matches.length === 0) throw new Error('COLLATION_METRICS_FILESYSTEM_UNAVAILABLE');
  return matches;
}

function metricFreeBytes(metricsText, projectRef) {
  const rows = parsePrometheusMetrics(metricsText).filter(row => row.projectRef === projectRef);
  if (!rows.length) throw new Error('COLLATION_METRICS_PROJECT_MISMATCH');
  const data = rows.filter(row => row.mountpoint === '/data');
  if (data.length !== 1) throw new Error('COLLATION_METRICS_DATA_FILESYSTEM_AMBIGUOUS');
  const root = rows.filter(row => row.mountpoint === '/');
  if (root.length !== 1 || root[0].bytes < 1024 ** 3) {
    throw new Error('COLLATION_METRICS_ROOT_FILESYSTEM_LOW');
  }
  return { dataBytes: data[0].bytes, rootBytes: root[0].bytes };
}

export function parseRepairArguments(args) {
  const values = new Map();
  const valueFlags = new Set(['--project-ref', '--expected-dbname', '--expected-recorded-version', '--expected-actual-version']);
  const allowedFlags = new Set([...valueFlags, '--apply']);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowedFlags.has(flag) || values.has(flag)) throw new Error('COLLATION_ARGUMENTS_INVALID');
    if (flag === '--apply') {
      values.set(flag, true);
      continue;
    }
    const value = args[index + 1];
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('COLLATION_ARGUMENTS_INVALID');
    values.set(flag, value);
    index += 1;
  }
  return Object.fromEntries(values);
}

export function validateMaintenanceConnectionPort(connectionString) {
  let connection;
  try {
    connection = connectionString instanceof URL ? connectionString : new URL(connectionString);
  } catch {
    throw new Error('COLLATION_DATABASE_URL_INVALID');
  }
  if (connection.port !== '5432') throw new Error('COLLATION_SESSION_POOLER_REQUIRED');
  return connection;
}

async function readDatabaseIdentity(client, expectedDatabase) {
  const identityResult = await client.query(`
    SELECT d.datname, d.datlocprovider, d.datcollversion,
           pg_database_collation_actual_version(d.oid) AS actual_version,
           pg_get_userbyid(d.datdba) AS database_owner, current_user AS current_role,
           current_setting('server_version_num') AS server_version_num
      FROM pg_database d WHERE d.datname = current_database()`);
  const identity = identityResult.rows[0];
  if (!identity) throw new Error('COLLATION_DATABASE_IDENTITY_UNAVAILABLE');
  if (identity.datname !== expectedDatabase) throw new Error('COLLATION_DATABASE_NAME_MISMATCH');
  if (identity.datlocprovider !== 'i') throw new Error('COLLATION_PROVIDER_UNSUPPORTED');
  if (Number(identity.server_version_num) < 170000) throw new Error('COLLATION_POSTGRES_VERSION_UNSUPPORTED');
  return identity;
}

async function readInventory(client) {
  const { rows: dependent } = await client.query(`
    SELECT ns.nspname AS schema_name, tab.relname AS table_name, idx.relname AS index_name,
           i.indisvalid AS is_valid, i.indisready AS is_ready, i.indislive AS is_live,
           has_table_privilege(current_user, i.indrelid, 'MAINTAIN') AS can_maintain
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_class tab ON tab.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = tab.relnamespace
      CROSS JOIN LATERAL unnest(i.indcollation) AS coll(oid)
      JOIN pg_collation c ON c.oid = coll.oid
     WHERE c.collprovider = 'd'
       AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
     GROUP BY ns.nspname, tab.relname, idx.relname, i.indisvalid, i.indisready, i.indislive, i.indrelid
     ORDER BY ns.nspname, tab.relname, idx.relname`);
  const { rows: invalid } = await client.query(`
    SELECT ns.nspname AS schema_name, tab.relname AS table_name, idx.relname AS index_name,
           i.indisvalid AS is_valid, i.indisready AS is_ready,
           has_table_privilege(current_user, i.indrelid, 'MAINTAIN') AS can_maintain
      FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_class tab ON tab.oid = i.indrelid JOIN pg_namespace ns ON ns.oid = tab.relnamespace
     WHERE NOT i.indisvalid AND ns.nspname NOT IN ('pg_catalog', 'information_schema')`);
  const { rows: sizes } = await client.query(`
    SELECT n.nspname AS schema_name, t.relname AS table_name,
           sum(pg_relation_size(i.indexrelid))::bigint AS table_index_bytes,
           sum(pg_relation_size(i.indexrelid))::bigint AS total_index_bytes
      FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     GROUP BY n.nspname, t.relname`);
  return { dependent, invalid, sizes };
}

async function inspect(client, projectRef, identity) {
  const { rows: activityRows } = await client.query(`
    SELECT (SELECT count(*) FROM pg_stat_progress_create_index WHERE pid <> pg_backend_pid())::int AS index_ops,
           (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
              AND pid <> pg_backend_pid() AND xact_start < now() - interval '5 minutes'
              AND state <> 'idle')::int AS long_transactions`);
  const { rows: dependencyRows } = await client.query(`
    SELECT
      (SELECT count(*) FROM pg_class WHERE relkind = 'm')::int AS materialized_views,
      (SELECT count(*) FROM pg_partitioned_table p
        CROSS JOIN LATERAL unnest(p.partcollation) AS pc(oid)
        JOIN pg_collation c ON c.oid = pc.oid WHERE c.collprovider = 'd')::int AS default_collation_partition_keys,
      (SELECT count(*) FROM pg_depend dep JOIN pg_collation c
        ON dep.refclassid = 'pg_collation'::regclass AND c.oid = dep.refobjid
        WHERE c.collprovider <> 'd' AND dep.deptype <> 'p'
          AND pg_collation_actual_version(c.oid) IS DISTINCT FROM c.collversion)::int AS named_collation_mismatches,
      (SELECT count(*) FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_namespace ns ON ns.oid = idx.relnamespace
        CROSS JOIN LATERAL unnest(i.indcollation) AS coll(oid)
        JOIN pg_collation c ON c.oid = coll.oid
        JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'x'
        WHERE c.collprovider = 'd')::int AS excluded_default_indexes,
      (SELECT count(*) FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_namespace ns ON ns.oid = idx.relnamespace
        CROSS JOIN LATERAL unnest(i.indcollation) AS coll(oid)
        JOIN pg_collation c ON c.oid = coll.oid
        WHERE c.collprovider = 'd' AND (ns.nspname IN ('pg_catalog', 'information_schema')
          OR ns.nspname LIKE 'pg_toast%'))::int AS system_default_collation_indexes`);
  const { rows: storageRows } = await client.query(`
    SELECT current_setting('data_directory') AS data_directory,
           d.dattablespace AS database_tablespace_oid,
           ts.spcname AS database_tablespace,
           pg_tablespace_location(d.dattablespace) AS database_tablespace_location,
           (SELECT count(*) FROM pg_index i
              JOIN pg_class idx ON idx.oid = i.indexrelid
              JOIN pg_class tab ON tab.oid = i.indrelid
              JOIN pg_namespace ns ON ns.oid = tab.relnamespace
             WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
               AND ns.nspname NOT LIKE 'pg_toast%'
               AND COALESCE(NULLIF(idx.reltablespace, 0), NULLIF(tab.reltablespace, 0), d.dattablespace)
                   <> d.dattablespace) AS nondefault_index_tablespaces
      FROM pg_database d JOIN pg_tablespace ts ON ts.oid = d.dattablespace
     WHERE d.datname = current_database()`);
  const inventory = await readInventory(client);
  const free = metricFreeBytes(projectRef.metricsText, projectRef.projectRef);
  const sizeBytes = inventory.sizes.reduce((sum, row) => sum + Number(row.table_index_bytes), 0);
  const largestTableIndexBytes = inventory.sizes.reduce((max, row) => Math.max(max, Number(row.table_index_bytes)), 0);
  return {
    identity, activity: activityRows[0], dependencies: dependencyRows[0], storage: storageRows[0], ...inventory,
    freeBytes: free.dataBytes, rootFreeBytes: free.rootBytes, sizeBytes, largestTableIndexBytes,
    requiredFreeBytes: 2 * largestTableIndexBytes + 2 * GiB
  };
}

function storageIsWithinGuard(current) {
  const storageDirectory = String(current.storage?.data_directory || '').replaceAll('\\', '/');
  return SUPPORTED_DATA_DIRECTORIES.has(storageDirectory)
    && current.storage?.database_tablespace === 'pg_default'
    && current.storage?.database_tablespace_location === ''
    && Number(current.storage?.nondefault_index_tablespaces) === 0;
}

export async function runCollationRepair({
  client, metricsText, projectRef, expectedDatabase,
  expectedRecordedVersion = '153.120', expectedActualVersion = '153.121',
  apply = false, lockTimeout = '2s', statementTimeout = '60min', onPhase = () => {}
}) {
  if (!client || typeof client.query !== 'function') throw new Error('COLLATION_CLIENT_REQUIRED');
  if (typeof projectRef !== 'string' || !projectRef || typeof expectedDatabase !== 'string' || !expectedDatabase) {
    throw new Error('COLLATION_TARGET_REQUIRED');
  }
  onPhase('identity_check');
  const identity = await readDatabaseIdentity(client, expectedDatabase);
  if (apply && identity.database_owner !== identity.current_role) throw new Error('COLLATION_DATABASE_OWNER_REQUIRED');
  onPhase('preflight_inspection');
  const current = await inspect(client, { metricsText, projectRef }, identity);
  const { dependent, invalid, activity, freeBytes, largestTableIndexBytes, requiredFreeBytes } = current;
  if (identity.datcollversion === identity.actual_version
      && identity.datcollversion === expectedActualVersion) {
    return { mode: 'noop', projectRef, database: identity.datname, recordedVersion: identity.datcollversion,
      actualVersion: identity.actual_version, refreshed: false };
  }
  if (identity.datcollversion !== expectedRecordedVersion || identity.actual_version !== expectedActualVersion) {
    if (identity.datcollversion === identity.actual_version) throw new Error('COLLATION_VERSION_MISMATCH_EXPECTATIONS');
    if (identity.datcollversion !== expectedRecordedVersion || identity.actual_version !== expectedActualVersion) {
      throw new Error('COLLATION_VERSION_GUARD_FAILED');
    }
  }
  if (!apply) return {
    mode: 'audit', projectRef, database: identity.datname, recordedVersion: identity.datcollversion,
    actualVersion: identity.actual_version, dependentIndexCount: dependent.length,
    invalidIndexCount: invalid.length, dataFreeBytes: freeBytes, rootFreeBytes: current.rootFreeBytes,
    largestTableIndexBytes, requiredFreeBytes, storage: current.storage,
    activity, eligible: dependent.every(row => row.is_valid && row.is_ready && row.is_live)
      && activity.index_ops === 0 && activity.long_transactions === 0 && freeBytes >= requiredFreeBytes
      && current.dependencies.materialized_views === 0
      && current.dependencies.default_collation_partition_keys === 0
      && current.dependencies.named_collation_mismatches === 0
      && current.dependencies.excluded_default_indexes === 0
      && current.dependencies.system_default_collation_indexes === 0
      && storageIsWithinGuard(current)
  };

  if (activity.index_ops !== 0 || activity.long_transactions !== 0) throw new Error('COLLATION_ACTIVITY_PRESENT');
  if (current.dependencies.materialized_views !== 0
      || current.dependencies.default_collation_partition_keys !== 0
      || current.dependencies.named_collation_mismatches !== 0
      || current.dependencies.excluded_default_indexes !== 0
      || current.dependencies.system_default_collation_indexes !== 0) throw new Error('COLLATION_DEPENDENCY_UNSUPPORTED');
  if (!storageIsWithinGuard(current)) {
    throw new Error('COLLATION_STORAGE_LOCATION_UNSUPPORTED');
  }
  if (freeBytes < requiredFreeBytes) throw new Error('COLLATION_DISK_HEADROOM_INSUFFICIENT');
  const invalidQualifiedNames = new Set(invalid.map(row => `${row.schema_name}.${row.index_name}`));
  for (const row of invalid) {
    const qualified = `${row.schema_name}.${row.index_name}`;
    if (!INVALID_INDEX_ALLOWLIST.has(qualified) || !row.can_maintain) throw new Error('COLLATION_INVALID_INDEX_UNSUPPORTED');
  }
  const targetInvalid = invalid.find(row => `${row.schema_name}.${row.index_name}` === 'public.ph_drive_around_report_rows_archive_batch_idx');
  if (dependent.some(row => (!row.is_valid || !row.is_ready || !row.is_live)
      && (!targetInvalid || `${row.schema_name}.${row.index_name}` !== 'public.ph_drive_around_report_rows_archive_batch_idx'))
      || dependent.some(row => invalidQualifiedNames.has(`${row.schema_name}.${row.index_name}`)
        && `${row.schema_name}.${row.index_name}` !== 'public.ph_drive_around_report_rows_archive_batch_idx')) {
    throw new Error('COLLATION_DEPENDENT_INDEX_INVALID');
  }
  const minPerTable = 2 * largestTableIndexBytes + 2 * GiB;
  if (requiredFreeBytes !== minPerTable) throw new Error('COLLATION_DISK_GUARD_INVALID');
  const safeLockTimeout = timeoutValue(lockTimeout, 10_000, 'COLLATION_LOCK_TIMEOUT_INVALID');
  const safeStatementTimeout = timeoutValue(statementTimeout, 60 * 60_000, 'COLLATION_STATEMENT_TIMEOUT_INVALID');

  const advisory = await client.query("SELECT pg_try_advisory_lock(hashtextextended('collation-repair:' || current_database(), 0)) AS acquired");
  if (advisory.rows[0]?.acquired !== true) throw new Error('COLLATION_REPAIR_ALREADY_RUNNING');
  let reindexWarning = false;
  let operationPhase = 'index_repair';
  const acceptedNotices = { expectedCollationMismatch: 0, expectedCatalogSkip: 0 };
  const setPhase = phase => {
    operationPhase = phase;
    onPhase(phase);
  };
  const noticeListener = notice => {
    if (!['WARNING', 'ERROR', 'FATAL', 'PANIC'].includes(notice?.severity)) return;
    const expectedMismatch = notice.severity === 'WARNING'
      && notice.code === '01000'
      && ['index_repair', 'database_reindex'].includes(operationPhase)
      && notice.message === `database "${identity.datname}" has a collation version mismatch`
      && notice.detail === `The database was created using collation version ${expectedRecordedVersion}, but the operating system provides version ${expectedActualVersion}.`;
    const expectedCatalogSkip = notice.severity === 'WARNING'
      && notice.code === '0A000'
      && operationPhase === 'database_reindex'
      && current.dependencies.system_default_collation_indexes === 0
      && notice.message === 'cannot reindex system catalogs concurrently, skipping all';
    if (expectedMismatch) acceptedNotices.expectedCollationMismatch += 1;
    else if (expectedCatalogSkip) acceptedNotices.expectedCatalogSkip += 1;
    else reindexWarning = true;
  };
  client.on?.('notice', noticeListener);
  let operationFailed = false;
  try {
    setPhase('index_repair');
    await client.query(`SET lock_timeout = '${safeLockTimeout}'`);
    await client.query(`SET statement_timeout = '${safeStatementTimeout}'`);
    await client.query('SET max_parallel_maintenance_workers = 0');
    if (targetInvalid) {
      await client.query(`REINDEX INDEX CONCURRENTLY ${quoteIdentifier(targetInvalid.schema_name)}.${quoteIdentifier(targetInvalid.index_name)}`);
      if (reindexWarning) throw new Error('COLLATION_REINDEX_NOTICE_FAILED');
    }
    setPhase('database_reindex');
    await client.query(`REINDEX DATABASE CONCURRENTLY ${quoteIdentifier(identity.datname)}`);
    if (reindexWarning) throw new Error('COLLATION_REINDEX_NOTICE_FAILED');
    client.off?.('notice', noticeListener);
    setPhase('post_reindex_verification');
    const afterIdentity = await readDatabaseIdentity(client, expectedDatabase);
    const after = await inspect(client, { metricsText, projectRef }, afterIdentity);
    const beforeNames = dependent.map(row => `${row.schema_name}.${row.table_name}.${row.index_name}`).sort();
    const afterNames = after.dependent.map(row => `${row.schema_name}.${row.table_name}.${row.index_name}`).sort();
    if (JSON.stringify(beforeNames) !== JSON.stringify(afterNames)
        || after.dependent.some(row => !row.is_valid || !row.is_ready || !row.is_live)
        || after.invalid.length !== 0
        || after.identity.datcollversion !== expectedRecordedVersion
        || after.identity.actual_version !== expectedActualVersion) {
      throw new Error('COLLATION_REINDEX_VERIFICATION_FAILED');
    }
    setPhase('collation_version_refresh');
    await client.query(`ALTER DATABASE ${quoteIdentifier(identity.datname)} REFRESH COLLATION VERSION`);
    setPhase('post_refresh_verification');
    const refreshedIdentity = await readDatabaseIdentity(client, expectedDatabase);
    if (refreshedIdentity.datcollversion !== expectedActualVersion
        || refreshedIdentity.actual_version !== expectedActualVersion
        || refreshedIdentity.datcollversion !== refreshedIdentity.actual_version) {
      throw new Error('COLLATION_REFRESH_VERIFICATION_FAILED');
    }
    return {
      mode: 'apply', projectRef, database: identity.datname, dependentIndexCount: dependent.length,
      invalidIndexRepaired: Boolean(targetInvalid), recordedVersion: refreshedIdentity.datcollversion,
      actualVersion: refreshedIdentity.actual_version, refreshed: true,
      acceptedNotices
    };
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    client.off?.('notice', noticeListener);
    if (!operationFailed) setPhase('advisory_unlock');
    await client.query("SELECT pg_advisory_unlock(hashtextextended('collation-repair:' || current_database(), 0))");
  }
}

export { parsePrometheusMetrics };

async function main(args, env) {
  cliPhase = 'argument_validation';
  const values = parseRepairArguments(args);
  const readValue = flag => values[flag] || '';
  const apply = values['--apply'] === true;
  const projectRef = readValue('--project-ref');
  const expectedDatabase = readValue('--expected-dbname');
  if (apply && (!projectRef || !expectedDatabase || !readValue('--expected-recorded-version') || !readValue('--expected-actual-version'))) {
    throw new Error('COLLATION_APPLY_ARGUMENTS_REQUIRED');
  }
  if (apply && !PROJECT_ALLOWLIST.has(projectRef)) throw new Error('COLLATION_PROJECT_NOT_ALLOWLISTED');
  cliPhase = 'credential_validation';
  if (!env.GNC_SUPABASE_DB_URL || !env.SUPABASE_METRICS_KEY) throw new Error('COLLATION_CREDENTIALS_REQUIRED');
  const databaseUrl = validateMaintenanceConnectionPort(env.GNC_SUPABASE_DB_URL);
  const inferredRef = databaseUrl.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]
    || databaseUrl.username.split('.').at(-1);
  const targetRef = projectRef || inferredRef;
  if (apply && inferredRef !== projectRef) throw new Error('COLLATION_PROJECT_TARGET_MISMATCH');
  const apiUrl = `https://${targetRef}.supabase.co`;
  const connectionString = validateDatabaseTarget(env.GNC_SUPABASE_DB_URL, apiUrl);
  const metricsUrl = `https://${targetRef}.supabase.co/customer/v1/privileged/metrics`;
  cliPhase = 'metrics_request';
  const response = await fetch(metricsUrl, {
    headers: { authorization: `Basic ${Buffer.from(`username:${env.SUPABASE_METRICS_KEY}`).toString('base64')}` },
    signal: AbortSignal.timeout(10000), redirect: 'error'
  });
  if (!response.ok) throw new Error('COLLATION_METRICS_REQUEST_FAILED');
  const metricsText = await response.text();
  const client = new pg.Client({ ...createDatabaseClientOptions(connectionString), application_name: 'gnc_collation_repair' });
  try {
    cliPhase = 'database_connect';
    await client.connect();
    const result = await runCollationRepair({
      client, metricsText, projectRef: targetRef, expectedDatabase: expectedDatabase || 'postgres', apply,
      expectedRecordedVersion: readValue('--expected-recorded-version') || '153.120',
      expectedActualVersion: readValue('--expected-actual-version') || '153.121',
      onPhase: phase => { cliPhase = phase; }
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    cliPhase = 'client_close';
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch(error => {
    const knownMarker = typeof error?.message === 'string' && /^COLLATION_[A-Z0-9_]+$/.test(error.message)
      ? error.message : '';
    const rawCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : '';
    const safeCode = knownMarker || rawCode || 'UNKNOWN';
    process.stderr.write(`COLLATION_REPAIR_FAILED phase=${cliPhase} error_code=${safeCode}\n`);
    process.exitCode = 1;
  });
}
