// Isolated regression coverage for the Request archive-only completion health case.
// Never connects to a configured or hosted Supabase project.
// node supabase/ci/eval_delivery_archive_health_pglite.mjs --pglite-root .gnc-local/pglite
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw Error('Pass --pglite-root');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
const baseline = fs.readFileSync(new URL('../migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/20261002155017_eval_delivery_archive_health_007.sql', import.meta.url), 'utf8');
const query = async (sql, params = []) => (await db.query(sql, params)).rows;

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`FUNCTION_NOT_FOUND: ${signature}`);
  const bodyStart = source.indexOf('AS $$', start);
  const bodyEnd = source.indexOf('$$;', bodyStart) + 3;
  if (bodyStart < 0 || bodyEnd < 3) throw new Error(`FUNCTION_BODY_NOT_FOUND: ${signature}`);
  return source.slice(start, bodyEnd);
}

function snapshotMetrics(snapshot) {
  return {
    contract_version: snapshot.contract_version,
    required_manager_recipient_count: Number(snapshot.required_manager_recipient_count),
    creation_order_violation_count: Number(snapshot.creation_order_violation_count),
    completion_membership_mismatch_count: Number(snapshot.completion_membership_mismatch_count),
    missing_completion_event_count: Number(snapshot.missing_completion_event_count),
    eval_origin_scope_mismatch_count: Number(snapshot.eval_origin_scope_mismatch_count),
    eval_required_recipient_violation_count: Number(snapshot.eval_required_recipient_violation_count),
    archive_only_completed_folder_count: Number(snapshot.archive_only_completed_folder_count ?? 0),
  };
}

try {
  await db.waitReady;
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema private;
    create table public.ph_active_request(
      unique_id text primary key, request_folder text not null,
      req_archived boolean not null default false, req_status text,
      date_completed text
    );
    create table private.ph_request_folder_delivery_state(
      request_folder text primary key, membership_version bigint not null,
      membership_signature text not null, active_request_ids text[] not null,
      completion_event_key text, last_delivered_version bigint not null default 0,
      last_delivered_signature text, updated_at timestamptz not null default now()
    );
    create table private.ph_request_archive_command_ledger(
      idempotency_key uuid primary key, request_uid text not null,
      operation text not null, result jsonb not null, created_at timestamptz not null
    );
    create table public.ph_request_delivery_outbox(
      event_id uuid primary key default gen_random_uuid(), event_key text not null unique,
      event_type text not null, request_id text, request_folder text, payload jsonb not null default '{}',
      status text not null check(status in ('pending','processing','delivered','failed','unknown','suppressed')),
      sanitized_error_code text, next_attempt_at timestamptz not null default now(),
      delivered_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.ph_eval_work(id uuid primary key, contract_version text, origin_count integer not null default 0);
    create table public.ph_eval_work_origin_rows(eval_work_id uuid not null, origin_key text not null, primary key(eval_work_id,origin_key));
    create function private.is_service_role_request() returns boolean
      language sql stable as $$ select current_setting('request.jwt.claim.role',true) = 'service_role' $$;
    create function private.eval_work_required_manager_emails_v2() returns text[]
      language sql stable as $$ select array['dylan@example.test','megan@example.test']::text[] $$;
    create function private.try_timestamptz(p_value text) returns timestamptz
      language plpgsql immutable as $$ begin return nullif(trim(p_value),'')::timestamptz; exception when others then return null; end $$;
    grant usage on schema public, private to anon, authenticated, service_role;
    grant execute on function private.is_service_role_request(), private.eval_work_required_manager_emails_v2(), private.try_timestamptz(text) to service_role;
  `);

  const finishedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const archivedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await query(`
    insert into public.ph_active_request(unique_id,request_folder,req_archived,req_status,date_completed)
    values ('current-row','archive-only-folder',false,'completed',$1),
           ('archived-row','archive-only-folder',true,'pending',null)
  `, [finishedAt]);
  await query(`insert into private.ph_request_folder_delivery_state(
    request_folder,membership_version,membership_signature,active_request_ids
  ) values ('archive-only-folder',2,'historical-two-row-signature',array['archived-row','current-row'])`);
  await query(`insert into private.ph_request_archive_command_ledger(
    idempotency_key,request_uid,operation,result,created_at
  ) values ($1,'archived-row','archive',$2::jsonb,$3)`, [
    '10000000-0000-4000-8000-000000000001',
    JSON.stringify({ uid: 'archived-row', operation: 'archive', state: 'archived', row: {
      unique_id: 'archived-row', request_folder: 'archive-only-folder', req_archived: true,
      req_status: 'pending', date_completed: null,
    } }), archivedAt,
  ]);
  await query(`insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,sanitized_error_code)
    values ('legacy-completion','request_completed','archive-only-folder','{"legacy":true}'::jsonb,'suppressed','FOLDER_COMPLETION_V2_SUPERSEDED')`);

  // Load the actual deployed health-snapshot implementation before the repair.
  await db.exec(extractFunction(baseline, 'CREATE FUNCTION public.get_eval_request_delivery_health_snapshot_v2()'));
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  let original = snapshotMetrics((await query('select public.get_eval_request_delivery_health_snapshot_v2() as snapshot'))[0].snapshot);
  assert.equal(original.required_manager_recipient_count, 2);
  assert.equal(original.missing_completion_event_count, 1, 'historical baseline flags the archived-only membership shrink');
  assert.equal(original.completion_membership_mismatch_count, 0);
  assert.equal(original.creation_order_violation_count, 0);
  assert.equal(original.eval_origin_scope_mismatch_count, 0);
  assert.equal(original.eval_required_recipient_violation_count, 0);

  const beforeCounts = (await query(`select
    (select count(*) from public.ph_active_request)::int as requests,
    (select count(*) from private.ph_request_archive_command_ledger)::int as ledger,
    (select count(*) from public.ph_request_delivery_outbox)::int as outbox,
    (select count(*) from private.ph_request_folder_delivery_state)::int as states`))[0];
  const beforeLegacy = (await query(`select event_id,event_key,payload,status,sanitized_error_code
    from public.ph_request_delivery_outbox where event_key='legacy-completion'`))[0];
  const beforeArchiveLedger = (await query(`select idempotency_key,request_uid,operation,result,created_at
    from private.ph_request_archive_command_ledger where request_uid='archived-row'`))[0];
  await db.exec(migration);

  const after = snapshotMetrics((await query('select public.get_eval_request_delivery_health_snapshot_v2() as snapshot'))[0].snapshot);
  assert.deepEqual(after, {
    contract_version: 'eval-request-delivery-health-v2',
    required_manager_recipient_count: 2,
    creation_order_violation_count: 0,
    completion_membership_mismatch_count: 0,
    missing_completion_event_count: 0,
    eval_origin_scope_mismatch_count: 0,
    eval_required_recipient_violation_count: 0,
    archive_only_completed_folder_count: 1,
  }, 'only the audited archive-only folder is exempted');

  // A real v2 event with a stale membership signature remains exempt only for
  // this precisely classified archive-only folder; history is not rewritten.
  await query(`insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,delivered_at)
    values ('historical-v2-completion','request_completed','archive-only-folder',
      jsonb_build_object('contractVersion','request-folder-completion-v2','membershipVersion',2,
        'membershipSignature','old-signature','activeRequestIds',jsonb_build_array('archived-row','current-row'),
        'dependencyEventKeys',jsonb_build_array()),'delivered',now())`);
  const membershipCheck = snapshotMetrics((await query('select public.get_eval_request_delivery_health_snapshot_v2() as snapshot'))[0].snapshot);
  assert.equal(membershipCheck.completion_membership_mismatch_count, 0, 'narrow archived subset does not trip stale historical membership');
  assert.equal(membershipCheck.missing_completion_event_count, 0);
  assert.deepEqual((await query(`select event_id,event_key,payload,status,sanitized_error_code
    from public.ph_request_delivery_outbox where event_key='legacy-completion'`))[0], beforeLegacy,
  'health reads preserve the suppressed legacy completion event');
  assert.deepEqual((await query(`select idempotency_key,request_uid,operation,result,created_at
    from private.ph_request_archive_command_ledger where request_uid='archived-row'`))[0], beforeArchiveLedger,
  'health reads preserve the archive audit command');

  // Negative controls: each must fail classification; no pending rows, restore
  // commands, deleted IDs, or post-archive completion can qualify.
  const helper = async folder => (await query('select private.request_folder_archive_only_completed_v1($1) as ok', [folder]))[0].ok;
  await query(`insert into public.ph_active_request values ('no-evidence-row','no-evidence-folder',false,'completed',$1)`, [finishedAt]);
  await query(`insert into private.ph_request_folder_delivery_state values ('no-evidence-folder',2,'old',array['no-evidence-row','missing-row'],null,0,null,now())`);
  assert.equal(await helper('no-evidence-folder'), false, 'missing/deleted membership evidence cannot be waived');

  await query(`insert into public.ph_active_request values ('pending-row','pending-folder',false,'pending',null),
    ('archived-pending','pending-folder',true,'pending',null)`);
  await query(`insert into private.ph_request_folder_delivery_state values ('pending-folder',2,'old',array['pending-row','archived-pending'],null,0,null,now())`);
  await query(`insert into private.ph_request_archive_command_ledger values($1,'archived-pending','archive',$2::jsonb,$3)`, [
    '10000000-0000-4000-8000-000000000002',
    JSON.stringify({ uid: 'archived-pending', operation: 'archive', state: 'archived', row: {
      unique_id: 'archived-pending', request_folder: 'pending-folder', req_archived: true,
      req_status: 'pending', date_completed: null,
    } }), archivedAt,
  ]);
  assert.equal(await helper('pending-folder'), false, 'a pending current member cannot qualify');

  await query(`insert into public.ph_active_request values ('restore-current','restore-folder',false,'completed',$1),
    ('restore-archived','restore-folder',true,'pending',null)`, [finishedAt]);
  await query(`insert into private.ph_request_folder_delivery_state values ('restore-folder',2,'old',array['restore-current','restore-archived'],null,0,null,now())`);
  await query(`insert into private.ph_request_archive_command_ledger values($1,'restore-archived','restore',$2::jsonb,$3)`, [
    '10000000-0000-4000-8000-000000000003',
    JSON.stringify({ uid: 'restore-archived', operation: 'restore', state: 'restored', row: {
      unique_id: 'restore-archived', request_folder: 'restore-folder', req_archived: false,
    } }), archivedAt,
  ]);
  assert.equal(await helper('restore-folder'), false, 'latest restore command is not an archive proof');

  await query(`insert into public.ph_active_request values ('late-current','late-folder',false,'completed',$1),
    ('late-archived','late-folder',true,'pending',null)`, [new Date(Date.now() + 10 * 60 * 1000).toISOString()]);
  await query(`insert into private.ph_request_folder_delivery_state values ('late-folder',2,'old',array['late-current','late-archived'],null,0,null,now())`);
  await query(`insert into private.ph_request_archive_command_ledger values($1,'late-archived','archive',$2::jsonb,$3)`, [
    '10000000-0000-4000-8000-000000000004',
    JSON.stringify({ uid: 'late-archived', operation: 'archive', state: 'archived', row: {
      unique_id: 'late-archived', request_folder: 'late-folder', req_archived: true,
      req_status: 'pending', date_completed: null,
    } }), archivedAt,
  ]);
  assert.equal(await helper('late-folder'), false, 'completion after earliest archive is not exempt');

  await query(`insert into public.ph_active_request values ('completed-current','completed-archive-folder',false,'completed',$1),
    ('completed-archived','completed-archive-folder',true,'completed',$1)`, [finishedAt]);
  await query(`insert into private.ph_request_folder_delivery_state values ('completed-archive-folder',2,'old',array['completed-current','completed-archived'],null,0,null,now())`);
  await query(`insert into private.ph_request_archive_command_ledger values($1,'completed-archived','archive',$2::jsonb,$3)`, [
    '10000000-0000-4000-8000-000000000005',
    JSON.stringify({ uid: 'completed-archived', operation: 'archive', state: 'archived', row: {
      unique_id: 'completed-archived', request_folder: 'completed-archive-folder', req_archived: true,
      req_status: 'completed', date_completed: finishedAt,
    } }), archivedAt,
  ]);
  assert.equal(await helper('completed-archive-folder'), false, 'archival cannot hide a member that was already completed');

  const afterCounts = (await query(`select
    (select count(*) from public.ph_active_request)::int as requests,
    (select count(*) from private.ph_request_archive_command_ledger)::int as ledger,
    (select count(*) from public.ph_request_delivery_outbox)::int as outbox,
    (select count(*) from private.ph_request_folder_delivery_state)::int as states`))[0];
  // Only the explicit historical v2 row above was inserted by this test; calls
  // to either security-definer snapshot and the private classifier are read-only.
  assert.equal(afterCounts.requests, beforeCounts.requests + 9);
  assert.equal(afterCounts.ledger, beforeCounts.ledger + 4);
  assert.equal(afterCounts.outbox, beforeCounts.outbox + 1);
  assert.equal(afterCounts.states, beforeCounts.states + 5);
  console.log('PASS: archive-only delivery-health classification and negative controls in isolated PGlite.');
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
