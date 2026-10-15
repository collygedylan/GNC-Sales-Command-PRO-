import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { inspectDisposableSupabaseWorkspace } from './disposable-supabase-container.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';
import { runCollationRepair } from './repair-database-collation.mjs';

const GiB = 1024 ** 3;
let rehearsalPhase = 'argument validation';
let lastPgNotice = null;

function capturePgNotice(notice) {
  if (!['WARNING', 'ERROR', 'FATAL', 'PANIC'].includes(notice?.severity)) return;
  const message = typeof notice.message === 'string'
    ? notice.message.replace(/\p{Cc}+/gu, ' ').replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, '[redacted-db-url]')
      .replace(/\b(password|passwd|pwd)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 300)
    : '';
  lastPgNotice = { severity: String(notice.severity).slice(0, 16), code: String(notice.code || '').slice(0, 8), message };
}

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error('COLLATION_REHEARSAL_IDENTIFIER_INVALID');
  }
  return `"${value}"`;
}

function quoteLiteral(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('COLLATION_REHEARSAL_LITERAL_INVALID');
  return `'${value.replaceAll("'", "''")}'`;
}

function readArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--workspace', '--scale-rows'].includes(flag) || values.has(flag) || !args[index + 1]) {
      throw new Error('COLLATION_REHEARSAL_USAGE: --workspace <verified-temp-workspace> [--scale-rows <positive-integer>]');
    }
    values.set(flag, args[++index]);
  }
  const workspace = values.get('--workspace');
  const scaleRows = Number(values.get('--scale-rows') || 8_800_000);
  if (!workspace || !Number.isSafeInteger(scaleRows) || scaleRows < 1 || scaleRows > 8_800_000) {
    throw new Error('COLLATION_REHEARSAL_ARGUMENTS_INVALID');
  }
  return { workspace, scaleRows };
}

function connectionForDatabase(baseUrl, database, username, password) {
  const target = new URL(baseUrl);
  target.pathname = `/${database}`;
  target.username = username;
  target.password = password;
  target.search = '';
  target.hash = '';
  return target.toString();
}

async function connect(connectionString, applicationName) {
  const client = new Client({ connectionString, application_name: applicationName, connectionTimeoutMillis: 10_000 });
  await client.connect();
  return client;
}

function adminPsql(verified, database, sql, { tuplesOnly = false } = {}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error('COLLATION_REHEARSAL_DATABASE_INVALID');
  const args = ['exec', '-i', verified.containerId, 'psql', '-X', '-U', 'supabase_admin', '-d', database,
    '-v', 'ON_ERROR_STOP=1'];
  if (tuplesOnly) args.push('-A', '-t');
  return run('docker', args, { root: repoRoot, capture: true, input: sql });
}

function parseAdminJson(verified, database, sql) {
  const output = adminPsql(verified, database, `${sql}\n`, { tuplesOnly: true });
  return JSON.parse(output.trim());
}

async function readAdminSnapshot(verified, database) {
  return parseAdminJson(verified, database, `SELECT json_build_object(
    'rowState', (SELECT json_agg(to_jsonb(r) ORDER BY table_name) FROM (
      SELECT 'public.ph_drive_around_report_rows'::text AS table_name,
             count(*)::text AS row_count, min(row_id)::text AS min_id,
             max(row_id)::text AS max_id, sum(row_id)::text AS id_sum
        FROM public.ph_drive_around_report_rows
      UNION ALL SELECT 'public.rehearsal_scale_rows', count(*)::text, min(row_id)::text,
             max(row_id)::text, sum(row_id)::text FROM public.rehearsal_scale_rows
      UNION ALL SELECT 'public.app_customer_lookup', count(*)::text, min(lookup_id)::text,
             max(lookup_id)::text, sum(lookup_id)::text FROM public.app_customer_lookup
      UNION ALL SELECT 'public.customer_consignees', count(*)::text, min(mapping_id)::text,
             max(mapping_id)::text, sum(mapping_id)::text FROM public.customer_consignees
      UNION ALL SELECT 'platform_like.metadata_rows', count(*)::text, min(id)::text,
             max(id)::text, sum(id)::text FROM platform_like.metadata_rows
    ) r),
    'indexState', (SELECT json_agg(to_jsonb(i) ORDER BY schema_name, table_name, index_name) FROM (
      SELECT ns.nspname AS schema_name, t.relname AS table_name, idx.relname AS index_name,
             pg_get_indexdef(idx.oid) AS definition, x.indisvalid AS valid,
             x.indisready AS ready, x.indislive AS live
        FROM pg_index x JOIN pg_class idx ON idx.oid = x.indexrelid
        JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace ns ON ns.oid = t.relnamespace
       WHERE ns.nspname IN ('public', 'platform_like')
    ) i),
    'relationState', (SELECT json_agg(to_jsonb(r) ORDER BY schema_name, table_name) FROM (
      SELECT n.nspname AS schema_name, c.relname AS table_name,
             c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('public', 'platform_like')
    ) r),
    'policies', (SELECT json_agg(to_jsonb(p) ORDER BY schemaname, tablename, policyname)
                   FROM pg_policies p WHERE schemaname IN ('public', 'platform_like')),
    'grants', (SELECT json_agg(to_jsonb(g) ORDER BY table_schema, table_name, grantee, privilege_type)
                 FROM information_schema.role_table_grants g
                WHERE table_schema IN ('public', 'platform_like'))
  )::text;`);
}

async function createInvalidUniqueIndex({ databaseUrl, buildRows, appTag }) {
  const build = await connect(databaseUrl, `${appTag}_index_build`);
  let buildError;
  try {
    await build.query(`CREATE TABLE public.ph_drive_around_report_rows (
      row_id bigint PRIMARY KEY,
      batch_key text NOT NULL
    )`);
    await build.query(`INSERT INTO public.ph_drive_around_report_rows(row_id, batch_key)
      SELECT value, 'batch-' || lpad((value % 20000)::text, 5, '0')
        FROM generate_series(1, $1::bigint) AS value`, [buildRows]);
    try {
      await build.query(`CREATE UNIQUE INDEX CONCURRENTLY ph_drive_around_report_rows_archive_batch_idx
        ON public.ph_drive_around_report_rows (batch_key)`);
    } catch (error) { buildError = error; }
    assert.equal(buildError?.code, '23505', 'duplicate fixture values must leave a failed unique concurrent build');
    const { rows } = await build.query(`
      SELECT i.indisvalid, i.indisready FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
       WHERE idx.relname = 'ph_drive_around_report_rows_archive_batch_idx'
         AND idx.relnamespace = 'public'::regnamespace`);
    assert.equal(rows[0]?.indisvalid, false, 'failed concurrent create must leave an invalid index');
    await build.query('DELETE FROM public.ph_drive_around_report_rows WHERE row_id > 20000');
    await build.query('ANALYZE public.ph_drive_around_report_rows');
  } finally {
    await build.end();
  }
}

async function makeFixture({ verified, baseUrl, scaleRows, appTag }) {
  const names = {
    database: `${appTag}_repair`,
    owner: `${appTag}_owner`,
    limited: `${appTag}_limited`,
    platform: `${appTag}_platform`,
    reader: `${appTag}_reader`,
  };
  const passwords = {
    owner: randomUUID().replaceAll('-', ''),
    limited: randomUUID().replaceAll('-', ''),
  };
  const recordedVersion = 'codex-rehearsal-stale';
  const psql = (database, sql) => adminPsql(verified, database, `${sql}\n`);
  let owner = null;
  let limited = null;
  try {
    const serverVersion = parseAdminJson(verified, 'postgres',
      `SELECT json_build_object('version', current_setting('server_version_num')::int)::text;`);
    assert.ok(Number(serverVersion.version) >= 170000, 'rehearsal requires PostgreSQL 17+');
    psql('postgres', `CREATE ROLE ${quoteIdentifier(names.owner)} LOGIN PASSWORD ${quoteLiteral(passwords.owner)};
      CREATE ROLE ${quoteIdentifier(names.limited)} LOGIN PASSWORD ${quoteLiteral(passwords.limited)};
      CREATE ROLE ${quoteIdentifier(names.platform)} NOLOGIN;
      CREATE ROLE ${quoteIdentifier(names.reader)} NOLOGIN;`);
    psql('postgres', `
      CREATE DATABASE ${quoteIdentifier(names.database)} OWNER ${quoteIdentifier(names.owner)}
      TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US'
      COLLATION_VERSION ${quoteLiteral(recordedVersion)};`);

    const ownerUrl = connectionForDatabase(baseUrl, names.database, names.owner, passwords.owner);
    owner = await connect(ownerUrl, `${appTag}_owner`);
    const identity = parseAdminJson(verified, names.database, `SELECT json_build_object(
      'recorded', d.datcollversion, 'actual', pg_database_collation_actual_version(d.oid),
      'dataDirectory', current_setting('data_directory'))::text
      FROM pg_database d WHERE d.datname = current_database();`);
    const actualVersion = identity.actual;
    assert.equal(identity.recorded, recordedVersion);
    assert.equal(typeof actualVersion, 'string', 'local ICU default collation version must be available');
    assert.notEqual(actualVersion, recordedVersion, 'fixture must actually begin with a collation version mismatch');
    assert.ok(['/var/lib/postgresql/data', '/data/pgdata'].includes(identity.dataDirectory),
      'verified disposable server must use one of the canonical Supabase PGDATA paths');
    await owner.query(`CREATE TABLE public.rehearsal_scale_rows (
      row_id bigint PRIMARY KEY,
      batch_key text NOT NULL
    )`);
    await owner.query(`INSERT INTO public.rehearsal_scale_rows(row_id, batch_key)
      SELECT value, 'key-' || lpad(value::text, 10, '0')
        FROM generate_series(1, $1::bigint) AS value`, [scaleRows]);
    await owner.query('CREATE INDEX rehearsal_scale_key_idx ON public.rehearsal_scale_rows(batch_key)');
    await psql(names.database, `CREATE SCHEMA platform_like AUTHORIZATION ${quoteIdentifier(names.platform)};
      GRANT pg_read_all_settings TO ${quoteIdentifier(names.owner)};
      GRANT USAGE ON SCHEMA platform_like TO ${quoteIdentifier(names.owner)};
      CREATE TABLE platform_like.metadata_rows (id bigint PRIMARY KEY, display_name text NOT NULL);
      INSERT INTO platform_like.metadata_rows
        SELECT value, 'managed-' || lpad(value::text, 8, '0') FROM generate_series(1, 1000) AS value;
      CREATE INDEX metadata_rows_display_name_idx ON platform_like.metadata_rows(display_name);
      ALTER TABLE platform_like.metadata_rows OWNER TO ${quoteIdentifier(names.platform)};`);

    await owner.query(`CREATE TABLE public.app_customer_lookup (lookup_id bigint PRIMARY KEY, customer_name text NOT NULL)`);
    await owner.query(`INSERT INTO public.app_customer_lookup
      SELECT value, 'customer-' || lpad(value::text, 8, '0') FROM generate_series(1, 10681) AS value`);
    await owner.query('CREATE INDEX app_customer_lookup_name_idx ON public.app_customer_lookup(customer_name)');
    await owner.query(`CREATE TABLE public.customer_consignees (mapping_id bigint PRIMARY KEY, mapping_name text NOT NULL)`);
    await owner.query(`INSERT INTO public.customer_consignees
      SELECT value, 'mapping-' || lpad(value::text, 8, '0') FROM generate_series(1, 14645) AS value`);
    await owner.query('CREATE INDEX customer_consignees_name_idx ON public.customer_consignees(mapping_name)');

    // Build the real invalid index before enabling forced RLS, so owner fixture setup can insert and repair rows.
    await createInvalidUniqueIndex({ databaseUrl: ownerUrl, buildRows: 40000, appTag });
    await owner.query(`ALTER TABLE public.ph_drive_around_report_rows ENABLE ROW LEVEL SECURITY`);
    await owner.query(`ALTER TABLE public.ph_drive_around_report_rows FORCE ROW LEVEL SECURITY`);
    await owner.query(`CREATE POLICY rehearsal_even_rows ON public.ph_drive_around_report_rows
      FOR SELECT TO ${quoteIdentifier(names.reader)} USING (row_id % 2 = 0)`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(names.reader)}`);
    await owner.query(`GRANT SELECT ON public.ph_drive_around_report_rows TO ${quoteIdentifier(names.reader)}`);
    await owner.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(names.database)} TO ${quoteIdentifier(names.limited)}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(names.limited)}`);

    await owner.query('ANALYZE');
    const { rows: privilegeRows } = await owner.query(`
      SELECT has_table_privilege(current_user, 'platform_like.metadata_rows'::regclass, 'MAINTAIN') AS can_maintain_platform_like,
             has_table_privilege(current_user, 'public.ph_drive_around_report_rows', 'MAINTAIN') AS can_maintain_invalid_index_table,
             r.rolsuper AS is_superuser, d.datdba = r.oid AS owns_database
        FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
       WHERE r.rolname = current_user`);
    assert.equal(privilegeRows[0]?.can_maintain_platform_like, false,
      'database owner must lack table-level MAINTAIN on the platform-like relation');
    assert.equal(privilegeRows[0]?.can_maintain_invalid_index_table, true,
      'allowlisted invalid index table must explicitly allow single-index recovery');
    assert.equal(privilegeRows[0]?.is_superuser, false, 'database owner rehearsal must not use a superuser role');
    assert.equal(privilegeRows[0]?.owns_database, true, 'repair role must own only the disposable target database');
    await owner.end();
    owner = null;

    const limitedUrl = connectionForDatabase(baseUrl, names.database, names.limited, passwords.limited);
    limited = await connect(limitedUrl, `${appTag}_limited`);
    return { verified, names, ownerUrl, limited, actualVersion, recordedVersion, scaleRows };
  } catch (error) {
    if (owner) await owner.end().catch(() => {});
    if (limited) await limited.end().catch(() => {});
    await dropFixture(verified, names);
    throw error;
  }
}

async function dropFixture(verified, names) {
  if (!names) return;
  adminPsql(verified, 'postgres', `DROP DATABASE IF EXISTS ${quoteIdentifier(names.database)} WITH (FORCE);
    DROP ROLE IF EXISTS ${quoteIdentifier(names.reader)};
    DROP ROLE IF EXISTS ${quoteIdentifier(names.platform)};
    DROP ROLE IF EXISTS ${quoteIdentifier(names.limited)};
    DROP ROLE IF EXISTS ${quoteIdentifier(names.owner)};\n`);
}

async function verifyRehearsal({ workspace, scaleRows }) {
  rehearsalPhase = 'disposable workspace verification';
  const verified = inspectDisposableSupabaseWorkspace({
    workspaceRoot: workspace,
    cli: packageBin('supabase', 'supabase', repoRoot),
    execute: run,
    executeNode: runNode,
  });
  const baseUrl = verified.dbUrl.toString();
  const appTag = `crh${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const metricsText = `node_filesystem_avail_bytes{service_type="db",supabase_project_ref="local",mountpoint="/"} ${20 * GiB}\nnode_filesystem_avail_bytes{service_type="db",supabase_project_ref="local",mountpoint="/data"} ${20 * GiB}`;
  rehearsalPhase = 'disposable fixture creation';
  const fixture = await makeFixture({ verified, baseUrl, scaleRows, appTag });
  let repairClient = null;
  try {
    const before = await connect(fixture.ownerUrl, `${appTag}_repair`);
    repairClient = before;
    before.on('notice', capturePgNotice);
    const initial = await readAdminSnapshot(verified, fixture.names.database);
    rehearsalPhase = 'authorization and audit assertions';
    assert.equal(Number(initial.rowState.find(row => row.table_name === 'public.rehearsal_scale_rows')?.row_count), scaleRows);
    assert.equal(Number(initial.rowState.find(row => row.table_name === 'public.ph_drive_around_report_rows')?.row_count), 20000);
    const badIndex = initial.indexState.find(index => index.index_name === 'ph_drive_around_report_rows_archive_batch_idx');
    assert.ok(badIndex && !badIndex.valid, 'failed concurrent unique build must leave the allowlisted index invalid');

    let denial;
    try {
      await runCollationRepair({
        client: fixture.limited, metricsText, projectRef: 'local', expectedDatabase: fixture.names.database,
        expectedRecordedVersion: fixture.recordedVersion, expectedActualVersion: fixture.actualVersion, apply: true,
      });
    } catch (error) { denial = error; }
    assert.equal(denial?.message, 'COLLATION_DATABASE_OWNER_REQUIRED', 'non-owner apply must fail before maintenance');
    const versionAfterDenial = await before.query(`
      SELECT datcollversion FROM pg_database WHERE datname = current_database()`);
    assert.equal(versionAfterDenial.rows[0]?.datcollversion, fixture.recordedVersion,
      'denied request must not refresh the recorded version');

    const audit = await runCollationRepair({
      client: before, metricsText, projectRef: 'local', expectedDatabase: fixture.names.database,
      expectedRecordedVersion: fixture.recordedVersion, expectedActualVersion: fixture.actualVersion,
      apply: false,
    });
    assert.equal(audit.mode, 'audit');
    assert.equal(audit.eligible, false, 'audit must flag the known invalid index for repair');
    assert.equal(audit.invalidIndexCount, 1);

    rehearsalPhase = 'concurrent index repair and collation refresh';
    const result = await runCollationRepair({
      client: before, metricsText, projectRef: 'local', expectedDatabase: fixture.names.database,
      expectedRecordedVersion: fixture.recordedVersion, expectedActualVersion: fixture.actualVersion,
      apply: true, onPhase: phase => { rehearsalPhase = phase; },
    });
    assert.equal(result.mode, 'apply');
    assert.equal(result.invalidIndexRepaired, true);
    assert.equal(result.refreshed, true);
    assert.equal(result.recordedVersion, fixture.actualVersion);

    rehearsalPhase = 'post-repair preservation and performance assertions';
    const after = await readAdminSnapshot(verified, fixture.names.database);
    assert.deepEqual(after.rowState, initial.rowState, 'repair must preserve every source row and aggregate');
    assert.deepEqual(after.relationState, initial.relationState, 'repair must preserve RLS flags');
    assert.deepEqual(after.policies, initial.policies, 'repair must preserve RLS policies');
    assert.deepEqual(after.grants, initial.grants, 'repair must preserve table grants');
    assert.deepEqual(after.indexState.map(({ schema_name, table_name, index_name, definition }) =>
      ({ schema_name, table_name, index_name, definition })), initial.indexState.map(({ schema_name, table_name, index_name, definition }) =>
      ({ schema_name, table_name, index_name, definition })), 'repair must preserve index identities and definitions');
    assert.ok(after.indexState.every(index => index.valid && index.ready && index.live), 'every fixture index must be valid after repair');

    const query = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT row_id FROM public.rehearsal_scale_rows
       WHERE batch_key = $1 ORDER BY batch_key LIMIT 50`;
    const plan = await before.query(query, ['key-0000042000']);
    const explain = plan.rows[0]['QUERY PLAN'][0];
    const warmSamples = [];
    for (let index = 0; index < 10; index++) {
      const sample = await before.query(query, ['key-0000042000']);
      warmSamples.push(Number(sample.rows[0]['QUERY PLAN'][0].Plan['Actual Total Time']));
    }
    const warmSorted = [...warmSamples].sort((a, b) => a - b);
    const warmP50 = warmSorted[Math.floor(warmSorted.length / 2)];
    assert.ok(Number(explain.Plan['Actual Total Time']) < 100, 'first-touch point lookup should remain below 100 ms');
    assert.ok(warmSamples.every(sample => sample < 100), 'every warm point lookup sample should remain below 100 ms');
    const findIndexNode = node => node?.['Index Name'] ? node : (node?.Plans || []).map(findIndexNode).find(Boolean);
    const indexNode = findIndexNode(explain.Plan);
    assert.equal(indexNode?.['Index Name'], 'rehearsal_scale_key_idx',
      'measured point lookup must use the expected default-collation index');

    process.stdout.write(`${JSON.stringify({
      status: 'passed', projectId: verified.projectId, database: fixture.names.database,
      postgresVersion: 17, scaleRows, lookupRows: 10681, mappingRows: 14645,
      recordedVersionBefore: fixture.recordedVersion, actualVersion: fixture.actualVersion,
      repairedAllowlistedInvalidIndex: result.invalidIndexRepaired,
      dependentIndexCount: result.dependentIndexCount,
      rlsPoliciesPreserved: after.policies.length === initial.policies.length,
      tableGrantsPreserved: after.grants.length === initial.grants.length,
      rowsPreserved: JSON.stringify(after.rowState) === JSON.stringify(initial.rowState),
      databaseOwnerWithoutTableMaintainSucceeded: true,
      nonOwnerDenied: denial.message,
      measuredOperation: 'indexed equality lookup, ORDER BY key LIMIT 50',
      datasetRows: scaleRows,
      firstTouchPostReindexMs: Number(explain.Plan['Actual Total Time']),
      firstTouchCacheCondition: 'first measured query after REINDEX; OS cache condition uncontrolled',
      warmP50Ms: warmP50,
      warmSamplesMs: warmSamples,
      plan: explain.Plan['Node Type'],
      planIndex: indexNode?.['Index Name'] || null,
    })}\n`);
  } finally {
    if (repairClient) await repairClient.end().catch(() => {});
    await fixture.limited.end().catch(() => {});
    await dropFixture(verified, fixture.names);
  }
}

async function main(args) {
  const { workspace, scaleRows } = readArgs(args);
  await verifyRehearsal({ workspace, scaleRows });
}

main(process.argv.slice(2)).catch(error => {
  const code = typeof error?.code === 'string' && (/^[A-Z0-9_]+$/.test(error.code) || /^\d{5}$/.test(error.code))
    ? error.code
    : error?.name === 'AssertionError' ? 'COLLATION_REHEARSAL_ASSERTION_FAILED' : 'COLLATION_REHEARSAL_FAILED';
  const message = typeof error?.message === 'string' ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 240) : '';
  const notice = lastPgNotice ? ` notice=${JSON.stringify(lastPgNotice)}` : '';
  process.stderr.write(`${code} [${rehearsalPhase}]: ${message}${notice}\n`);
  process.exitCode = 1;
});
