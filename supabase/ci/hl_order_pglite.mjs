// Auxiliary local SQL verification, not a replacement for the composed Supabase
// migration/pgTAP/concurrency CI lane. Dependencies stay outside the checkout:
// npm install --prefix <cache> --no-save --package-lock=false @electric-sql/pglite@0.5.8
// node supabase/ci/hl_order_pglite.mjs --pglite-root <cache>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root with the external pinned PGlite installation.');
const require = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < a) throw new Error('Baseline boundaries changed; inspect the actual migration before updating the harness.');
  return source.slice(a, b);
}

try {
  await db.waitReady;
  // Only platform identity/schema plumbing is supplied here. The HL migration,
  // outbox table, delivery RPCs, and recovery RPCs below execute from real files.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; create schema extensions;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create function extensions.gen_random_uuid() returns uuid language sql volatile as $$ select gen_random_uuid() $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.jwt(),auth.uid() to authenticated,anon,service_role;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.profiles(id uuid primary key,username text unique,display_name text,role text,disabled_at timestamptz,locked_until timestamptz,must_change_password boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create function private.current_active_profile() returns public.profiles language sql stable security definer as $$ select p from public.profiles p where id=auth.uid() and disabled_at is null and (locked_until is null or locked_until<=now()) $$;
    create function private.can_manage_requests() returns boolean language sql stable security definer as $$ select exists(select 1 from public.profiles p where id=auth.uid() and role in ('ADMIN','MANAGER') and disabled_at is null) $$;
    create table public.ph_request_history(unique_id text primary key,snapshot jsonb,delivery_state text,updated_at timestamptz,req_customer text,requested_by text,request_selected_rep_email text,request_created_by_email text);
  `);
  await db.exec(between(read('supabase/ci/request_workflow_baseline.sql'), 'create table if not exists public.ph_master_inventory', 'create table if not exists public.ph_active_request'));
  await db.exec(read('supabase/ci/hl_order_baseline.sql'));
  await db.exec(read('supabase/migrations/20260809011735_ph_27f1_hl_po.sql'));
  await db.exec(between(read('supabase/migrations/20260820114722_request_integrity_and_eval_assignments.sql'), 'create table if not exists public.ph_request_delivery_outbox', 'create table if not exists public.ph_app_health_events'));
  await db.exec('alter table public.ph_request_delivery_outbox enable row level security; grant all on public.ph_request_delivery_outbox to service_role;');
  const worker = read('supabase/migrations/20260820230245_reliable_request_delivery_worker.sql');
  await db.exec(worker.slice(0, worker.indexOf('-- Authenticated users may read only delivery metadata.')));
  await db.exec(between(worker, '-- Authenticated users may read only delivery metadata.', 'create or replace view public.ph_request_delivery_status'));
  await db.exec(between(worker, 'drop function if exists public.get_request_delivery_recovery_queue();', '-- Server authority stamps the authenticated completing profile.'));
  await db.exec(read('supabase/migrations/20260911115037_hl_ordering_system.sql'));
  let historical;
  if (args.includes('--backfill')) {
    const fixture = read('supabase/tests/hl_order_lifecycle_test.sql');
    await db.exec(fixture.slice(0, fixture.indexOf('do $test$')));
    await db.exec(`
      update public.ph_soc_master set planstart='Tue Sep 15 2026 10:00:00 GMT-0500 (Central Daylight Time)' where unique_id in ('HL-A','HL-B');
      select pg_temp.hl_command('draft_save','{"rows":[{"source_id":"HL-A","quantity":6},{"source_id":"HL-B","quantity":20}]}');
      do $$ declare p jsonb; s jsonb; o jsonb; begin
        p:=pg_temp.hl_command('preview','{}')->'preview';
        s:=pg_temp.hl_command('submit',jsonb_build_object('preview_id',p->>'id')); o:=s->'orders'->0;
        perform pg_temp.hl_confirm((o->>'event_id')::uuid);
        perform pg_temp.hl_command('receive',jsonb_build_object('order_id',o->>'id','lines',
          jsonb_build_array(jsonb_build_object('line_id',(select id from hl_order_private.order_lines where source_id='HL-A'),'received_quantity',2))));
      end $$;
      commit;
    `);
    historical = (await db.query(`select
      (select jsonb_agg(to_jsonb(o) order by id) from hl_order_private.orders o) orders,
      (select jsonb_agg(to_jsonb(l) order by id) from hl_order_private.order_lines l) lines,
      (select jsonb_agg(to_jsonb(p) order by id) from public.ph_hl_order_previews p) previews,
      (select jsonb_agg(to_jsonb(r) order by id) from hl_order_private.receipts r) receipts`)).rows[0];
  }
  await db.exec(read('supabase/migrations/20260911203510_hl_ship_date_submission_batches.sql'));
  await db.exec(read('supabase/migrations/20260912002734_hl_po_receipt_balances.sql'));
  if (historical) {
    const after = (await db.query(`select
      (select jsonb_agg(to_jsonb(o)-'ship_date' order by id) from hl_order_private.orders o) orders,
      (select jsonb_agg(to_jsonb(l)-'batch_id' order by id) from hl_order_private.order_lines l) lines,
      (select jsonb_agg(to_jsonb(p) order by id) from public.ph_hl_order_previews p) previews,
      (select jsonb_agg(to_jsonb(r) order by id) from hl_order_private.receipts r) receipts`)).rows[0];
    if (JSON.stringify(after)!==JSON.stringify(historical)) throw new Error('Migration altered legacy history');
    const proof = (await db.query(`select count(*)::int n from hl_order_private.submission_batches b
      join hl_order_private.orders o on o.id=b.order_id
      where b.status='sent' and b.ship_date='2026-09-15' and b.preview_id=o.preview_id and b.event_id=o.event_id
        and b.delivery_receipt=o.delivery_receipt and o.ship_date='2026-09-15'
        and (select count(*) from hl_order_private.order_lines l where l.batch_id=b.id)=2`)).rows[0];
    if (proof.n!==1) throw new Error('Legacy batch provenance or Chicago date failed');
    console.log('PASS legacy backfill: two sent lines, saved PDFs, quantities, receipt, number, delivery proof unchanged; batch and Sep 15 ship date added.');
  }
  await db.exec(read('supabase/ci/hl_restock_revision_baseline.sql'));
  await db.exec(read('supabase/migrations/20260908185903_live_dataset_revisions.sql'));
  await db.exec(read('supabase/migrations/20260908201318_live_dataset_revision_empty_statements.sql'));
  await db.exec(read('supabase/migrations/20260912170906_hl_restocking.sql'));
  const files = historical ? [] : args.includes('--test') ? [args[args.indexOf('--test') + 1]] : [
    'supabase/tests/hl_order_lifecycle_test.sql', 'supabase/tests/hl_order_delivery_test.sql', 'supabase/tests/hl_order_ship_dates_test.sql', 'supabase/tests/hl_order_po_receipts_test.sql', 'supabase/tests/hl_order_restock_test.sql'
  ];
  for (const file of files) {
    if (!file || !/^supabase\/tests\/hl_order_[a-z_]+\.sql$/.test(file)) throw new Error('Invalid HL SQL test path.');
    const results = await db.exec(read(file));
    const tap = results.flatMap((result) => result.rows).flatMap((row) => Object.values(row)).filter((value) => typeof value === 'string' && /^(?:ok|not ok|1\.\.)/.test(value));
    if (!tap.some((line) => /^1\.\.[1-9]\d*$/.test(line)) || tap.some((line) => /^not ok/.test(line))) throw new Error('SQL tests did not produce a passing TAP plan: ' + file);
    console.log(file + '\n' + tap.join('\n'));
  }
} catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code, detail: error.detail, where: error.where, position: error.position }));
  process.exitCode = 1;
} finally { await db.close(); }
