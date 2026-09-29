import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const migrationName = '20260928145055_item_low_stock_targets.sql';
export const perennialAssignmentMigrationName = '20260929013125_perennial_zone_assignment_override.sql';
export const releaseDatabaseMigrations = Object.freeze([migrationName, perennialAssignmentMigrationName]);

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EADDRNOTAVAIL'
]);
const TLS_ERROR_CODES = new Set([
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER'
]);
const SAFE_ERROR_MARKERS = new Set([
  'LOW_STOCK_SUPABASE_DB_URL_MISSING', 'LOW_STOCK_DATABASE_TARGET_INVALID',
  'LOW_STOCK_DATABASE_TARGET_MISMATCH', 'LOW_STOCK_DATABASE_TLS_REQUIRED',
  'LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED', 'LOW_STOCK_MIGRATION_HISTORY_MISMATCH',
  'LOW_STOCK_DATABASE_CONTRACT_MISSING', 'LOW_STOCK_CLOUD_MAIN_REQUIRED',
  'LOW_STOCK_RELEASE_IDENTITY_REQUIRED', 'LOW_STOCK_CURRENT_MAIN_REQUIRED',
  'LOW_STOCK_DIAGNOSTIC_CONTEXT_INVALID', 'LOW_STOCK_DIAGNOSTIC_WORKFLOW_INVALID',
  'LOW_STOCK_ARGUMENTS_INVALID'
]);

export function validateDatabaseTarget(connectionString, supabaseUrl) {
  if (!connectionString) throw new Error('LOW_STOCK_SUPABASE_DB_URL_MISSING');
  let database, api;
  try { database = new URL(connectionString); api = new URL(supabaseUrl); }
  catch { throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID'); }
  const match = api.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (api.protocol !== 'https:' || !match || !['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID');
  }
  const user = decodeURIComponent(database.username);
  const direct = database.hostname === `db.${match[1]}.supabase.co` && user === 'postgres';
  const pooler = database.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${match[1]}`;
  if ((!direct && !pooler) || !database.password || database.pathname !== '/postgres') throw new Error('LOW_STOCK_DATABASE_TARGET_MISMATCH');
  // pg merges query parameters over authority fields. Do not allow host/user
  // query overrides to redirect this narrowly scoped production operation.
  const allowed = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'application_name']);
  for (const key of database.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID');
  }
  if (!database.searchParams.has('sslmode')) database.searchParams.set('sslmode', 'verify-full');
  if (!['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode'))) {
    throw new Error('LOW_STOCK_DATABASE_TLS_REQUIRED');
  }
  // This operation always verifies both the trusted CA and database hostname.
  database.searchParams.set('sslmode', 'verify-full');
  return database.toString();
}

const POSTGRES_TLS_QUERY_PARAMETERS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

export function createDatabaseClientOptions(connectionString) {
  // `pg-connection-string` lets SSL query parameters replace `Client`'s
  // `ssl` object. The URL has already passed validateDatabaseTarget; remove
  // those options here so only this client uses the pinned, verified CA.
  const database = new URL(connectionString);
  for (const parameter of POSTGRES_TLS_QUERY_PARAMETERS) database.searchParams.delete(parameter);
  const hostname = database.hostname;
  const ca = fs.readFileSync(new URL('./certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
  return {
    connectionString: database.toString(),
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
    ssl: {
      ca,
      rejectUnauthorized: true,
      // Make the expected DNS identity explicit. TLS verification remains
      // enabled and is bound to the already-validated database host.
      servername: hostname
    }
  };
}

export function summarizeDatabaseTarget(connectionString) {
  const database = new URL(connectionString);
  const port = Number(database.port || 5432);
  const route = /^db\.[a-z0-9]+\.supabase\.co$/.test(database.hostname)
    ? (port === 6543 ? 'dedicated_pooler' : 'direct')
    : database.hostname.endsWith('.pooler.supabase.com') ? 'pooler' : 'unknown';
  const sslmode = database.searchParams.get('sslmode') || 'require';
  return {
    route,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
    sslmode: ['require', 'verify-ca', 'verify-full'].includes(sslmode) ? sslmode : 'other'
  };
}

export function classifyDatabaseError(error) {
  let code = '';
  try { code = typeof error?.code === 'string' ? error.code : ''; } catch { /* hostile error getter */ }
  if (NETWORK_ERROR_CODES.has(code)) return { errorClass: 'network', errorCode: code };
  if (TLS_ERROR_CODES.has(code)) return { errorClass: 'tls', errorCode: code };
  if (/^[0-9A-Z]{5}$/.test(code)) return { errorClass: 'postgres', errorCode: code };
  return { errorClass: 'other', errorCode: '' };
}

const DIAGNOSTIC_PHASES = new Set([
  'diagnostic_authorization', 'target_validation', 'release_ref', 'database_connect',
  'transaction_begin', 'advisory_lock', 'migration_history_read', 'migration_sql',
  'migration_history_write', 'contract_check', 'transaction_commit', 'schema_probe',
  'transaction_rollback', 'client_close'
]);

export function formatSafeFailure({ phase, error, connectionString = '' }) {
  const safePhase = DIAGNOSTIC_PHASES.has(phase) ? phase : 'unknown';
  let marker = 'LOW_STOCK_SCHEMA_APPLY_FAILED';
  try {
    if (typeof error?.message === 'string' && SAFE_ERROR_MARKERS.has(error.message)) marker = error.message;
  } catch { /* hostile error getter */ }
  const classified = classifyDatabaseError(error);
  let summary = null;
  try { if (connectionString) summary = summarizeDatabaseTarget(connectionString); } catch { /* invalid URLs are omitted */ }
  const target = summary ? ` route=${summary.route} port=${summary.port} sslmode=${summary.sslmode}` : '';
  const code = classified.errorCode ? ` error_code=${classified.errorCode}` : '';
  return `${marker} phase=${safePhase} error_class=${classified.errorClass}${code}${target}`;
}

export function validateDiagnosticContext(env) {
  const validRepository = /^[\w.-]+\/[\w.-]+$/.test(String(env.GITHUB_REPOSITORY || ''));
  const validSha = /^[a-f0-9]{40}$/.test(String(env.GITHUB_SHA || ''));
  const ref = String(env.GITHUB_REF || '');
  const allowedRef = ref === 'refs/heads/main';
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || !validRepository || !validSha || !allowedRef || ref.includes('..') || ref.endsWith('/')) {
    throw new Error('LOW_STOCK_DIAGNOSTIC_CONTEXT_INVALID');
  }
  const expectedWorkflowRef = `${env.GITHUB_REPOSITORY}/.github/workflows/apps-script-database-diagnostic.yml@${ref}`;
  if (!env.GITHUB_WORKFLOW_REF || env.GITHUB_WORKFLOW_REF !== expectedWorkflowRef) {
    throw new Error('LOW_STOCK_DIAGNOSTIC_WORKFLOW_INVALID');
  }
  return { repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, ref };
}

export async function runReadOnlySchemaDiagnostic({ client, onPhase = () => {} }) {
  let transactionOpen = false;
  let result;
  let failure;
  let failurePhase = '';
  let currentPhase = '';
  const setPhase = value => { currentPhase = value; onPhase(value); };
  try {
    setPhase('transaction_begin');
    await client.query('begin read only');
    transactionOpen = true;
    setPhase('schema_probe');
    result = await client.query("select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed");
  } catch (error) {
    failure = error;
    failurePhase = currentPhase;
  }
  if (transactionOpen) {
    setPhase('transaction_rollback');
    try { await client.query('rollback'); }
    catch (error) { if (!failure) { failure = error; failurePhase = currentPhase; } }
  }
  if (failure) { setPhase(failurePhase); throw failure; }
  return { installed: result?.rows?.[0]?.installed === true };
}

export function migrationContractQuery(name) {
  if (name === migrationName) return "select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed";
  if (name === perennialAssignmentMigrationName) return "select to_regprocedure('public.reconcile_eval_itemcodes(uuid)') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_warehouse_assigned_items' and column_name='zone_override_active') as installed";
  throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
}

export function migrationBody(source) {
  if (!/^begin;\s/i.test(source) || !/\scommit;\s*$/i.test(source)) throw new Error('LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED');
  return source.replace(/^begin;\s*/i, '').replace(/\scommit;\s*$/i, '');
}

export async function applyItemLowStockMigration({ client, source, onPhase = () => {}, targetMigrationName = migrationName }) {
  if (!releaseDatabaseMigrations.includes(targetMigrationName)) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
  const version = targetMigrationName.split('_')[0];
  const name = targetMigrationName.slice(version.length + 1, -4);
  const body = migrationBody(source);
  const contractQuery = migrationContractQuery(targetMigrationName);
  onPhase('transaction_begin');
  await client.query('begin');
  try {
    onPhase('advisory_lock');
    await client.query("select pg_advisory_xact_lock(hashtext('gnc-item-low-stock-schema-v1'))");
    onPhase('migration_history_read');
    const prior = await client.query('select name, statements from supabase_migrations.schema_migrations where version = $1', [version]);
    if (prior.rows.length) {
      if (prior.rows[0].name !== name || prior.rows[0].statements?.join('\n') !== body) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
    } else {
      onPhase('migration_sql');
      await client.query(body);
      onPhase('migration_history_write');
      await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)', [version,name,[body]]);
    }
    onPhase('contract_check');
    const result = await client.query(contractQuery);
    if (result.rows[0]?.installed !== true) throw new Error('LOW_STOCK_DATABASE_CONTRACT_MISSING');
    onPhase('transaction_commit');
    await client.query('commit');
    return { status: prior.rows.length ? 'already_applied' : 'applied' };
  } catch (error) {
    try { await client.query('rollback'); } catch { /* retain the migration error for sanitized reporting */ }
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  const diagnose = args.length === 1 && args[0] === '--diagnose';
  if (args.length && !diagnose) throw new Error('LOW_STOCK_ARGUMENTS_INVALID');
  let phase = diagnose ? 'diagnostic_authorization' : 'release_ref';
  let connectionString = '';
  let client;
  let primaryError;
  try {
    if (diagnose) validateDiagnosticContext(process.env);
    else {
      // This command runs only after the existing cloud release-proof verifier.
      // Recheck current main immediately before opening the database connection.
      if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main'
          || !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) throw new Error('LOW_STOCK_CLOUD_MAIN_REQUIRED');
      const repository = process.env.GITHUB_REPOSITORY || '', sha = process.env.GITHUB_SHA || '';
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || !process.env.GH_TOKEN) throw new Error('LOW_STOCK_RELEASE_IDENTITY_REQUIRED');
      const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
        headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok || (await response.json()).object?.sha !== sha) throw new Error('LOW_STOCK_CURRENT_MAIN_REQUIRED');
    }
    phase = 'target_validation';
    connectionString = validateDatabaseTarget(process.env.SUPABASE_DB_URL, process.env.SUPABASE_URL);
    client = new pg.Client(createDatabaseClientOptions(connectionString));
    phase = 'database_connect';
    await client.connect();
    if (diagnose) {
      const probe = await runReadOnlySchemaDiagnostic({ client, onPhase: next => { phase = next; } });
      console.log(`LOW_STOCK_SCHEMA_DIAGNOSTIC status=ok installed=${probe.installed}`);
    } else {
      for (const targetMigrationName of releaseDatabaseMigrations) {
        const source = fs.readFileSync(new URL(`../supabase/migrations/${targetMigrationName}`, import.meta.url), 'utf8');
        const applied = await applyItemLowStockMigration({ client, source, targetMigrationName, onPhase: next => { phase = next; } });
        console.log(`${targetMigrationName}: ${applied.status}.`);
      }
    }
  } catch (error) {
    primaryError = error;
    console.error(formatSafeFailure({ phase, error, connectionString }));
    process.exitCode = 1;
  } finally {
    if (client) {
      phase = 'client_close';
      try { await client.end(); }
      catch (error) {
        if (!primaryError) {
          console.error(formatSafeFailure({ phase, error, connectionString }));
          process.exitCode = 1;
        }
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(formatSafeFailure({ phase: 'release_ref', error }));
    process.exitCode = 1;
  });
}
