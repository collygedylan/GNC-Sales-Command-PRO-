import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const migrationName = '20260928145055_item_low_stock_targets.sql';
export const perennialAssignmentMigrationName = '20260929013125_perennial_zone_assignment_override.sql';
export const passwordReconciliationMigrationName = '20260929160000_password_change_profile_reconciliation.sql';
export const productionScheduleMigrationName = '20261001012038_production_schedule_snapshot_v1.sql';
export const auraHrCommandCenterMigrationName = '20261001025638_aura_hr_command_center_v1.sql';
export const scheduledHandoverMigrationName = '20261001215508_scheduled_handover_005.sql';
export const requestArchiveMigrationName = '20261001215511_request_archive_005.sql';
export const handoverAssignmentMigrationName = '20261001222228_handover_assignment_transfer_005.sql';
export const readOptimizationMigrationName = '20261002014421_index_request_history_assigned_rep_006.sql';
export const auraInventoryV2MigrationName = '20261002121446_aura_inventory_v2_007.sql';
export const auraInventoryMatchMigrationName = '20261002204108_aura_inventory_match_010.sql';
export const auraLlmFreeTierMigrationName = '20261003025749_aura_llm_free_tier_011.sql';
export const nellyAccessAuditMigrationName = '20261002134138_nelly_access_audit_baseline_repair_007.sql';
export const evalDeliveryArchiveHealthMigrationName = '20261002155017_eval_delivery_archive_health_007.sql';
export const suspendTagApprovalMigrationName = '20261005194158_suspend_tag_approval_loop.sql';
export const releaseDatabaseMigrations = Object.freeze([migrationName, perennialAssignmentMigrationName, passwordReconciliationMigrationName, productionScheduleMigrationName, auraHrCommandCenterMigrationName, scheduledHandoverMigrationName, requestArchiveMigrationName, handoverAssignmentMigrationName, readOptimizationMigrationName, auraInventoryV2MigrationName, nellyAccessAuditMigrationName, evalDeliveryArchiveHealthMigrationName, auraInventoryMatchMigrationName, auraLlmFreeTierMigrationName, suspendTagApprovalMigrationName]);
const baselineIncludedMigrations = new Set([migrationName, perennialAssignmentMigrationName, passwordReconciliationMigrationName]);
export const productionBaselineVersion = '20260929200000';

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
  if (name === suspendTagApprovalMigrationName) return "select to_regprocedure('public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)') is not null and to_regprocedure('public.prepare_suspend_tag_delivery_v1(uuid,uuid)') is not null and has_function_privilege('service_role','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute') and not has_function_privilege('authenticated','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute') and has_column_privilege('authenticated','public.ph_soc_master','dock_note','update') and not has_column_privilege('authenticated','public.ph_soc_master','date_completed','update') and (select relrowsecurity from pg_class where oid='suspend_tag_private.approvals'::regclass) and exists(select 1 from pg_policies where schemaname='public' and tablename='ph_soc_master' and policyname='suspend_tag_read') as installed";
  if (name === auraLlmFreeTierMigrationName) return "select exists(select 1 from pg_class where oid=to_regclass('aura_private.llm_provider_calls') and relrowsecurity) and not has_schema_privilege('anon','aura_private','usage') and not has_schema_privilege('authenticated','aura_private','usage') and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)') and not prosecdef and array_to_string(proconfig,',') like '%statement_timeout=1s%') and has_function_privilege('service_role','public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)','execute') and not has_function_privilege('anon','public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)','execute') and not has_function_privilege('authenticated','public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)','execute') and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_inventory_lot_lookup_v1(text,text,integer)') and not prosecdef and array_to_string(proconfig,',') like '%statement_timeout=4s%') and has_function_privilege('service_role','public.aura_inventory_lot_lookup_v1(text,text,integer)','execute') and not has_function_privilege('anon','public.aura_inventory_lot_lookup_v1(text,text,integer)','execute') and not has_function_privilege('authenticated','public.aura_inventory_lot_lookup_v1(text,text,integer)','execute') and to_regclass('public.idx_ph_master_inventory_aura_lot_uid') is not null as installed";
  if (name === evalDeliveryArchiveHealthMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('private.request_folder_archive_only_completed_v1(text)') and not prosecdef and provolatile='s') and not has_function_privilege('anon','private.request_folder_archive_only_completed_v1(text)','execute') and not has_function_privilege('authenticated','private.request_folder_archive_only_completed_v1(text)','execute') and position('archive_only_completed_folder_count' in pg_get_functiondef('public.get_eval_request_delivery_health_snapshot_v2()'::regprocedure))>0 and has_function_privilege('service_role','public.get_eval_request_delivery_health_snapshot_v2()','execute') and not has_function_privilege('anon','public.get_eval_request_delivery_health_snapshot_v2()','execute') and not has_function_privilege('authenticated','public.get_eval_request_delivery_health_snapshot_v2()','execute') as installed";
  if (name === nellyAccessAuditMigrationName) return "select exists(select 1 from public.profiles p where p.id='961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid and lower(btrim(p.username))='nelly_aguilar' and private.normalized_profile_role(p.role)='ADMIN') and private.resolve_app_access_policy_id_v1(true) is not null and (select count(*) from private.get_effective_app_permissions_v1('961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid,private.resolve_app_access_policy_id_v1(true)))=(select count(*) from private.app_access_permissions where active) and exists(select 1 from private.app_access_permissions where active) and not exists(select 1 from private.get_effective_app_permissions_v1('961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid,private.resolve_app_access_policy_id_v1(true)) e left join private.app_access_legacy_baseline b on b.profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid and b.permission_key=e.permission_key where b.permission_key is null) as installed";
  if (name === auraInventoryV2MigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)') and not prosecdef) and has_function_privilege('service_role','public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute') and not has_function_privilege('anon','public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute') and not has_function_privilege('authenticated','public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute') as installed";
  if (name === auraInventoryMatchMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)') and not prosecdef and array_to_string(proconfig,',') like '%statement_timeout=4s%') and has_function_privilege('service_role','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute') and not has_function_privilege('anon','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute') and not has_function_privilege('authenticated','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute') and to_regclass('public.idx_ph_master_inventory_aura_name_trgm') is not null and to_regclass('public.idx_ph_master_inventory_aura_season_size') is not null as installed";
  if (name === readOptimizationMigrationName) return "select exists(select 1 from pg_index where indexrelid=to_regclass('public.idx_ph_request_history_assigned_rep_id') and indisvalid) and to_regprocedure('public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])') is not null and has_function_privilege('service_role','public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') and not has_function_privilege('anon','public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') and not has_function_privilege('authenticated','public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') as installed";
  if (name === scheduledHandoverMigrationName) return "select to_regprocedure('public.app_account_active_v1(uuid,text)') is not null and to_regprocedure('public.resolve_operational_recipients_v1(text[],text)') is not null and to_regprocedure('public.scheduled_handover_tick_v1()') is not null and exists(select 1 from private.scheduled_account_handover_v1 where departing_profile_id='e2584b32-472c-4888-b592-394235050b5b'::uuid and successor_profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid and effective_at='2026-10-03 04:00:00+00'::timestamptz and ((completed_at is not null and auth_banned_at is not null) or exists(select 1 from cron.job where jobname='scheduled_handover_kayla_nelly_20261002' and active and schedule='* * * * *' and command='select private.scheduled_handover_dispatch_v1();'))) as installed";
  if (name === handoverAssignmentMigrationName) return "select to_regprocedure('private.transfer_remaining_handover_assignments_v1(text,integer)') is not null and to_regprocedure('private.handover_normalize_assignment_v1()') is not null as installed";
  if (name === requestArchiveMigrationName) return "select to_regprocedure('public.request_archive_command_v1(uuid,text,text,uuid)') is not null and to_regprocedure('public.request_archive_list_v1(uuid,integer,integer)') is not null as installed";
  if (name === migrationName) return "select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed";
  if (name === perennialAssignmentMigrationName) return "select to_regprocedure('public.reconcile_eval_itemcodes(uuid)') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_warehouse_assigned_items' and column_name='zone_override_active') as installed";
  if (name === passwordReconciliationMigrationName) return "select to_regprocedure('public.prepare_password_change_profile(text,uuid,text)') is not null and to_regprocedure('public.complete_password_change_profile(uuid,uuid,text,text)') is not null as installed";
  if (name === productionScheduleMigrationName) return "select to_regprocedure('public.production_schedule_start_import_v1(text)') is not null and to_regprocedure('public.production_schedule_read_metadata_v1()') is not null and to_regclass('public.production_schedule_rows') is not null as installed";
  if (name === auraHrCommandCenterMigrationName) return "select to_regclass('public.core_employees') is not null and to_regclass('public.hr_job_codes') is not null and to_regclass('public.hr_events') is not null and to_regclass('public.labor_timesheets') is not null and exists(select 1 from pg_partitioned_table where partrelid='public.labor_timesheets'::regclass) and to_regprocedure('public.hr_claim_calendar_reminders_v1(integer)') is not null and to_regprocedure('public.hr_finish_calendar_reminder_v1(uuid,boolean,text)') is not null and to_regprocedure('private.hr_purge_calendar_reminders_v1()') is not null and to_regprocedure('private.hr_active_username_v1()') is not null and exists(select 1 from cron.job where jobname='hr_calendar_reminder_sweep') as installed";
  throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
}

export async function upsertVaultSecret({ client, name, value, description }) {
  if (!client || !/^[a-z][a-z0-9_]{2,63}$/.test(String(name || '')) || !String(value || '')) {
    throw new Error('HR_VAULT_SECRET_INPUT_INVALID');
  }
  const prior = await client.query('select id from vault.secrets where name = $1 limit 1', [name]);
  if (prior.rows.length) {
    await client.query('select vault.update_secret($1,$2,$3,$4)', [prior.rows[0].id, value, name, description || null]);
    return 'updated';
  }
  await client.query('select vault.create_secret($1,$2,$3)', [value, name, description || null]);
  return 'created';
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
      // The production baseline contains these archived migrations. Its ledger
      // intentionally has no entries for their former individual versions.
      const baseline = await client.query('select name from supabase_migrations.schema_migrations where version = $1', [productionBaselineVersion]);
      if (baseline.rows.length && baselineIncludedMigrations.has(targetMigrationName)) {
        if (baseline.rows.length !== 1 || baseline.rows[0].name !== 'production_baseline') throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
        onPhase('contract_check');
        const result = await client.query(contractQuery);
        if (result.rows[0]?.installed !== true) throw new Error('LOW_STOCK_DATABASE_CONTRACT_MISSING');
        onPhase('transaction_commit');
        await client.query('commit');
        return { status: 'included_in_baseline' };
      }
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
        const sourceDirectory = baselineIncludedMigrations.has(targetMigrationName) ? 'archive_migrations' : 'migrations';
        const source = fs.readFileSync(new URL(`../supabase/${sourceDirectory}/${targetMigrationName}`, import.meta.url), 'utf8');
        const applied = await applyItemLowStockMigration({ client, source, targetMigrationName, onPhase: next => { phase = next; } });
        console.log(`${targetMigrationName}: ${applied.status}.`);
      }
      if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL) {
        await upsertVaultSecret({ client, name: 'hr_calendar_project_url', value: process.env.SUPABASE_URL, description: 'Supabase project URL used by the scheduled HR calendar reminder dispatcher.' });
        await upsertVaultSecret({ client, name: 'hr_calendar_service_role_key', value: process.env.SUPABASE_SERVICE_ROLE_KEY, description: 'Service role credential used only by the pg_cron calendar reminder dispatcher.' });
        console.log('HR calendar reminder Vault credentials synchronized.');
      } else {
        throw new Error('HR_VAULT_CREDENTIALS_REQUIRED');
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
