import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { validateDatabaseTarget, createDatabaseClientOptions } from './apply-item-low-stock-migration.mjs';
import { validateMaintenanceConnectionPort } from './repair-database-collation.mjs';

const projectRef = 'kzrnyjsosryejjejliii';
const evidence = 'G:/My Drive/GNC/AgData/Release Evidence/database-maintenance-20261108';
const customerTable = 'public.ph_customer_consignee_sales_reps';
const customerIndex = 'public.ph_ccsr_active_customer_consignee_names_idx';
const invalidNames = ['objects_pkey_ccnew', 'name_prefix_search_ccnew',
  'idx_objects_bucket_id_name_ccnew', 'idx_objects_bucket_id_name_lower_ccnew',
  'objects_bucket_id_name_version_key_ccnew', 'idx_objects_current_version_ccnew',
  'idx_objects_null_version_ccnew', 'idx_objects_delete_markers_ccnew'];

function requireMaintenance(condition, code) {
  if (!condition) throw new Error('BOUNDED_MAINTENANCE_' + code);
}

function writeReceipt(receipt) {
  fs.mkdirSync(evidence, { recursive: true });
  fs.appendFileSync(path.join(evidence, 'receipts.jsonl'), JSON.stringify(receipt) + '\n');
}

function maintenanceClient() {
  const linkedProjectRef = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim();
  const pooler = new URL(fs.readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
  requireMaintenance(linkedProjectRef === projectRef, 'LINKED_PROJECT_MISMATCH');
  const url = new URL('postgresql://localhost/postgres');
  Object.assign(url, { hostname: process.env.PGHOST, port: process.env.PGPORT,
    username: process.env.PGUSER, password: process.env.PGPASSWORD, pathname: '/' + process.env.PGDATABASE });
  const safe = validateDatabaseTarget(url.toString(), 'https://' + projectRef + '.supabase.co',
    { linkedProjectRef, poolerHost: pooler.hostname });
  validateMaintenanceConnectionPort(safe);
  return new pg.Client(createDatabaseClientOptions(safe));
}

async function verifySession(client, expectedPid) {
  const { rows } = await client.query(`SELECT pg_backend_pid() pid,current_user,current_database() database,
    current_setting('application_name') application_name,current_setting('statement_timeout') statement_timeout,
    current_setting('lock_timeout') lock_timeout,current_setting('max_parallel_maintenance_workers') workers,
    current_setting('transaction_read_only') read_only`);
  const session = rows[0];
  requireMaintenance(session.current_user === 'postgres' && session.database === 'postgres', 'ROLE_CHANGED');
  requireMaintenance(session.application_name === 'gnc_bounded_maintenance'
    && session.statement_timeout === '30s' && session.lock_timeout === '500ms'
    && session.workers === '0' && session.read_only === 'off', 'SESSION_LIMITS_CHANGED');
  requireMaintenance(!expectedPid || session.pid === expectedPid, 'BACKEND_CHANGED');
  return session;
}

async function preflight(client, pid, table) {
  await verifySession(client, pid);
  const { rows } = await client.query(`SELECT
    (SELECT count(*) FROM private.erp_sync_jobs WHERE active OR request_lease_until>now()) active_jobs,
    (SELECT count(*) FROM pg_stat_progress_create_index) index_builds,
    (SELECT count(*) FROM pg_locks WHERE relation=$1::regclass AND pid<>pg_backend_pid()) locks`, [table]);
  const state = rows[0];
  requireMaintenance(Number(state.active_jobs) === 0 && Number(state.index_builds) === 0
    && Number(state.locks) === 0, 'BUSY_DEFERRED');
}

function customerStatements() {
  const source = fs.readFileSync('docs/architecture/customer-directory-index-maintenance.sql', 'utf8');
  const create = source.match(/CREATE INDEX CONCURRENTLY [\s\S]*?;/)?.[0];
  const explain = source.match(/EXPLAIN \(ANALYZE[\s\S]*?;/)?.[0];
  requireMaintenance(create?.includes('ph_ccsr_active_customer_consignee_names_idx')
    && explain?.includes(customerTable), 'CUSTOMER_SQL_MISSING');
  return { create, explain: explain.replace('TIMING OFF)', 'TIMING OFF, FORMAT JSON)') };
}

async function createCustomerIndex(client, pid) {
  const sql = customerStatements();
  await preflight(client, pid, customerTable);
  const before = (await client.query(sql.explain)).rows[0]['QUERY PLAN'][0];
  const exists = (await client.query('SELECT to_regclass($1) present', [customerIndex])).rows[0].present;
  requireMaintenance(!exists, 'CUSTOMER_INDEX_ALREADY_EXISTS');
  await preflight(client, pid, customerTable);
  await client.query(sql.create);
  await verifySession(client, pid);
  const index = (await client.query(`SELECT indisvalid,indisready,indislive,
    pg_get_indexdef(indexrelid) definition,pg_relation_size(indexrelid)::text bytes
    FROM pg_index WHERE indexrelid=$1::regclass`, [customerIndex])).rows[0];
  requireMaintenance(index?.indisvalid && index.indisready && index.indislive, 'CUSTOMER_INDEX_INVALID');
  const after = (await client.query(sql.explain)).rows[0]['QUERY PLAN'][0];
  const receipt = { operation: 'customer_index', at: new Date().toISOString(), index, before, after };
  writeReceipt(receipt);
  return { operation: receipt.operation, beforeMs: before['Execution Time'], afterMs: after['Execution Time'],
    indexBytes: index.bytes };
}

async function invalidIndexState(client, name) {
  const { rows } = await client.query(`SELECT i.indisvalid,i.indisready,i.indislive,
    pg_relation_size(c.oid)::text bytes,pg_get_indexdef(c.oid) definition,
    pg_has_role(current_user,c.relowner,'USAGE') owner_access,
    (SELECT count(*) FROM pg_constraint WHERE conindid=c.oid) constraints,
    (SELECT count(*) FROM pg_depend WHERE refobjid=c.oid AND deptype NOT IN ('a','i')) dependents,
    o.indisvalid original_valid,o.indisready original_ready,
    (i.indrelid=o.indrelid AND c.relam=original.relam AND i.indkey=o.indkey
      AND i.indclass=o.indclass AND i.indcollation=o.indcollation
      AND i.indoption=o.indoption AND i.indnkeyatts=o.indnkeyatts AND i.indnatts=o.indnatts
      AND i.indisunique=o.indisunique AND i.indnullsnotdistinct=o.indnullsnotdistinct
      AND coalesce(pg_get_expr(i.indexprs,i.indrelid),'')=coalesce(pg_get_expr(o.indexprs,o.indrelid),'')
      AND coalesce(pg_get_expr(i.indpred,i.indrelid),'')=coalesce(pg_get_expr(o.indpred,o.indrelid),'')) equivalent
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index i ON i.indexrelid=c.oid
    LEFT JOIN pg_class original ON original.relnamespace=n.oid AND original.relname=$2
    LEFT JOIN pg_index o ON o.indexrelid=original.oid
    WHERE n.nspname='storage' AND c.relname=$1 AND i.indrelid='storage.objects'::regclass`,
  [name, name.replace(/_ccnew$/, '')]);
  return rows[0];
}

export function safeInvalidIndex(state) {
  return Boolean(state && state.indisvalid === false && state.indisready === true && state.indislive === true
    && state.owner_access === true && state.original_valid === true && state.original_ready === true
    && state.equivalent === true
    && Number(state.constraints) === 0 && Number(state.dependents) === 0);
}

async function dropInvalidIndex(client, pid, name) {
  await preflight(client, pid, 'storage.objects');
  const before = await invalidIndexState(client, name);
  if (!safeInvalidIndex(before)) {
    writeReceipt({ operation: 'invalid_index_retained', name, state: before, at: new Date().toISOString() });
    return { operation: 'invalid_index_retained', name };
  }
  await client.query('DROP INDEX CONCURRENTLY "storage"."' + name + '"');
  const after = await invalidIndexState(client, name);
  requireMaintenance(!after, 'INVALID_INDEX_STILL_PRESENT');
  const original = (await client.query(`SELECT i.indisvalid,i.indisready FROM pg_index i
    WHERE i.indexrelid=to_regclass($1)`, ['storage.' + name.replace(/_ccnew$/, '')])).rows[0];
  requireMaintenance(original?.indisvalid && original.indisready, 'ORIGINAL_INDEX_CHANGED');
  writeReceipt({ operation: 'invalid_index_dropped', name, before, at: new Date().toISOString() });
  return { operation: 'invalid_index_dropped', name, bytes: before.bytes };
}

async function vacuumTarget(client, pid, table) {
  await preflight(client, pid, table);
  const before = (await client.query(`SELECT n_live_tup,n_dead_tup,last_vacuum,last_analyze
    FROM pg_stat_user_tables WHERE relid=$1::regclass`, [table])).rows[0];
  const canMaintain = (await client.query('SELECT has_table_privilege(current_user,$1,\'MAINTAIN\') allowed',
    [table])).rows[0].allowed;
  if (!canMaintain) return { operation: 'vacuum_skipped_permission', table };
  const started = Date.now();
  await client.query('VACUUM (ANALYZE,SKIP_LOCKED,TRUNCATE FALSE,PARALLEL 0) ' + table);
  await verifySession(client, pid);
  const receipt = { operation: 'vacuum', table, before, milliseconds: Date.now() - started,
    at: new Date().toISOString() };
  writeReceipt(receipt);
  return receipt;
}

async function main() {
  requireMaintenance(process.argv.slice(2).join(' ') === '--apply', 'EXPLICIT_APPLY_REQUIRED');
  const client = maintenanceClient();
  await client.connect();
  try {
    await client.query('SET ROLE postgres');
    await client.query(`SET application_name='gnc_bounded_maintenance';SET statement_timeout='30s';
      SET lock_timeout='500ms';SET max_parallel_maintenance_workers=0;SET vacuum_cost_delay='2ms'`);
    const session = await verifySession(client);
    await verifySession(client, session.pid);
    writeReceipt({ operation: 'session_verified', session, at: new Date().toISOString() });
    process.stdout.write(JSON.stringify(await createCustomerIndex(client, session.pid)) + '\n');
    for (const name of invalidNames) {
      process.stdout.write(JSON.stringify(await dropInvalidIndex(client, session.pid, name)) + '\n');
    }
    for (const table of ['public.ph_app_live_events', 'public.ph_drive_around_report_rows', 'storage.objects']) {
      process.stdout.write(JSON.stringify(await vacuumTarget(client, session.pid, table)) + '\n');
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    writeReceipt({ operation: 'stopped', code: error.code || null, message: error.message,
      at: new Date().toISOString() });
    process.stderr.write((error.code || '') + ':' + error.message + '\n');
    process.exitCode = 1;
  });
}
