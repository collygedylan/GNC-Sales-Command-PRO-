// Isolated PostgreSQL/WASM verification; not a native Auth, Storage, or Realtime
// integration substitute. No production connection and no repository dependency changes.
// node supabase/ci/sales_mobile_pglite.mjs --pglite-root <external-pinned-installation>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root with the external pinned PGlite 0.5.8 installation.');
const require = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let currentStep = 'platform baseline';
try {
  await db.waitReady;
  // These are platform plumbing only. All business tables, functions, grants,
  // triggers, and assertions below are loaded from their actual checked-in SQL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; create schema storage;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.jwt(),auth.uid() to authenticated,anon,service_role;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.profiles(id uuid primary key references auth.users(id),username text unique,display_name text,role text,division text default '10',disabled_at timestamptz,locked_until timestamptz,must_change_password boolean default false);
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
  `);
  const files = [
    'supabase/ci/request_workflow_baseline.sql',
    'supabase/ci/hl_order_baseline.sql',
    'supabase/ci/sales_credit_baseline.sql',
    'supabase/migrations/20260815043342_dylan_live_pilot_preferences.sql',
    'supabase/migrations/20260820114722_request_integrity_and_eval_assignments.sql',
    'supabase/migrations/20260820143000_suppress_initial_eval_event_fanout.sql',
    'supabase/migrations/20260820150000_legacy_completion_atomic_guard.sql',
    'supabase/migrations/20260820230245_reliable_request_delivery_worker.sql',
    'supabase/migrations/20260821012500_restore_request_email_threads_schema.sql',
    'supabase/migrations/20260901192727_repair_request_option_append.sql',
    'supabase/migrations/20260828024750_centralized_access_control_audit_v1.sql',
    'supabase/migrations/20260828070741_access_control_manager_read_v2.sql',
    'supabase/migrations/20260904003007_sales_marketing_and_kayla_limited_access.sql',
    'supabase/migrations/20260908185903_live_dataset_revisions.sql',
    'supabase/migrations/20260908201318_live_dataset_revision_empty_statements.sql',
    'supabase/migrations/20260921034331_sales_history_permanent_credit_workflow.sql',
    'supabase/migrations/20260921034349_production_workflow_and_atomic_inventory_audit.sql',
    'supabase/migrations/20260921034506_navigation_preferences_and_live_view_grants.sql',
    'supabase/ci/request_notification_history_baseline.sql',
    'supabase/migrations/20260924115226_sales_history_customer_docks_ownership.sql',
    'supabase/migrations/20260924145431_incident_pause_request_delivery_wakes.sql',
    'supabase/migrations/20260924145930_incident_pause_request_delivery_claims.sql',
    'supabase/migrations/20260924155225_request_metadata_notification_guard.sql',
    'supabase/migrations/20260924155542_restore_request_delivery_after_metadata_guard.sql',
    'supabase/migrations/20260924172552_request_drive_evidence_reset_guard.sql',
    'supabase/tests/request_drive_reset_test.sql',
    'supabase/tests/request_metadata_notifications_test.sql',
    'supabase/tests/sales_credit_workflow_test.sql',
    'supabase/tests/sales_history_docks_test.sql',
    'supabase/tests/navigation_preferences_test.sql',
    'supabase/tests/production_workflow_test.sql',
  ];
  for (const file of files) {
    currentStep = file;
    if (args.includes('--before-reset-guard') && file.endsWith('20260924172552_request_drive_evidence_reset_guard.sql')) {
      const original = read('supabase/migrations/20260905233900_safe_request_drive_evidence_repair_and_rpc_hardening.sql');
      await db.exec(original.slice(0, original.indexOf('-- Trigger and maintenance functions')) + '\ncommit;');
      continue;
    }
    if (file.endsWith('20260901192727_repair_request_option_append.sql')) {
      // Load the real folder state AND all completion triggers. Omitting the
      // active-row trigger would hide metadata-backfill notification fanout.
      // Unrelated Eval writers remain covered by the full native CI chain.
      const folderMigration = read('supabase/migrations/20260828213612_multi_origin_eval_work_folder_completion_v2.sql');
      const start = folderMigration.indexOf('create table if not exists private.ph_request_folder_delivery_state');
      const end = folderMigration.indexOf('revoke all on function private.eval_normalize_user_v2', start);
      if (start < 0 || end < start) throw new Error('FOLDER_STATE_BASELINE_NOT_FOUND');
      await db.exec(folderMigration.slice(start, end));
    }
    await db.exec(read(file));
  }
  console.log('PASS: Sales/Credits, Navigation, and Production/Audit migrations and transactional SQL checks. Native platform and concurrent-connection checks remain required in CI.');
} catch (error) {
  console.error(`FAILED STEP: ${currentStep}`);
  console.error(error.message);
  if (error.detail) console.error(`DETAIL: ${error.detail}`);
  if (error.where) console.error(`CONTEXT: ${error.where}`);
  if (error.position) console.error(`POSITION: ${error.position}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
