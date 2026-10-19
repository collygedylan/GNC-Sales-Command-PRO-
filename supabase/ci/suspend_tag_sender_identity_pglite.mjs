// Focused disposable PostgreSQL WASM check for the Suspend approval sender/recipient migration.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = await PGlite.create();
const read = async path => (await import('node:fs')).readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema suspend_tag_private;
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function private.is_service_role_request() returns boolean language sql stable as $$select coalesce(auth.jwt()->>'role','')='service_role'$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table public.profiles(id uuid primary key,username text not null,display_name text);
    create table public.ph_soc_master(
      unique_id text primary key,last_updated timestamptz,suspend text,suspend_to text,salesrepname text,
      customername text,consigneename text,commonname text,contsize text,locationcode text,quantityordered text,
      dock_spec text,dock_caliper text,dock_note text,dock_photo_link text,dock_photo_name text,
      av_note text,match text,loc_match_qty text,initial_ptr text
    );
    create table public.ph_request_delivery_outbox(
      event_id uuid primary key default gen_random_uuid(),event_key text unique,event_type text,request_id text,
      request_folder text,payload jsonb,status text default 'pending',lease_token uuid,lease_owner text,lease_expires_at timestamptz,
      email_delivered_at timestamptz,push_delivered_at timestamptz,gmail_thread_id text,message_id_header text
    );
    create table suspend_tag_private.workflows(
      source_uid text primary key,source_revision timestamptz,status text,completed_by uuid,completed_at timestamptz,
      current_approval_id uuid,round integer default 0,version bigint default 0,updated_at timestamptz default now()
    );
    create table suspend_tag_private.approvals(
      id uuid primary key,source_uid text,source_revision timestamptz,round integer,completed_by uuid,rep_id uuid,
      snapshot jsonb,submitter_email text,rep_email text,status text default 'pending',decided_at timestamptz,
      decided_by uuid,request_event_id uuid,decision_event_id uuid,created_at timestamptz default now()
    );
    create function suspend_tag_private.active_profile(p_id uuid) returns public.profiles
      language plpgsql stable security definer set search_path='' as $$declare p public.profiles; begin
        select * into p from public.profiles where id=p_id; if p.id is null then raise exception 'inactive'; end if; return p; end$$;
    create function suspend_tag_private.session_active(p_id uuid,p_session uuid) returns boolean
      language sql stable security definer set search_path='' as $$select exists(select 1 from auth.sessions where user_id=p_id and id=p_session and (not_after is null or not_after>now()))$$;
    create function suspend_tag_private.eligible(p_suspend text,p_to text) returns boolean
      language sql immutable as $$select p_suspend='SUSPEND' and p_to='DC'$$;
    create function suspend_tag_private.validate_review(p public.ph_soc_master) returns void
      language plpgsql as $$begin return; end$$;
    create function suspend_tag_private.command(uuid,text,jsonb,uuid,bigint) returns jsonb
      language sql as $$select jsonb_build_object(
        'actor',current_setting('app.suspend_tag_actor_id',true),
        'decisionMessage',current_setting('app.suspend_tag_decision_message',true),
        'payload',$3
      )$$;
  `);
  await db.exec(`insert into public.profiles(id,username,display_name) values
    ('00000000-0000-0000-0000-000000000001','rep_user','Rep User'),
    ('00000000-0000-0000-0000-000000000002','dylan_collyge','Dylan College'),
    ('00000000-0000-0000-0000-000000000003','megan_kelly','Megan Kelly'),
    ('00000000-0000-0000-0000-000000000004','dan_mccuistion','Dan McCuistion'),
    ('00000000-0000-0000-0000-000000000005','jd_jones','JD Jones'),
    ('00000000-0000-0000-0000-000000000006','field_sender','Field Sender');
    insert into auth.users(id,email,email_confirmed_at) select id,username||'@example.test',now() from public.profiles;
    insert into auth.sessions(id,user_id) values
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
      ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006');
    insert into public.ph_soc_master(unique_id,last_updated,suspend,suspend_to,salesrepname,customername,commonname,contsize)
      values('suspend-fixture','2026-10-19T12:00:00Z','SUSPEND','DC','Rep User','Customer','Tree','#1');
    insert into suspend_tag_private.workflows(source_uid,source_revision,status,completed_by,completed_at,round)
      values('suspend-fixture','2026-10-19T12:00:00Z','completed','00000000-0000-0000-0000-000000000002',now(),0);
  `);

  // Representative synthetic row volume keeps this isolated from production
  // while exercising the primary-key lookups used by request_approval.
  const syntheticRows = 9_500;
  await db.exec(`
    insert into public.ph_soc_master(unique_id,last_updated,suspend,suspend_to)
    select 'synthetic-soc-' || lpad(n::text,5,'0'), now(), 'SUSPEND', 'DC'
      from generate_series(1,${syntheticRows}) n;
    insert into suspend_tag_private.workflows(source_uid,status)
    select 'synthetic-soc-' || lpad(n::text,5,'0'), 'completed'
      from generate_series(1,${syntheticRows}) n;
    analyze public.ph_soc_master;
    analyze suspend_tag_private.workflows;
  `);
  const volume = (await db.query(`select
    (select count(*)::int from public.ph_soc_master) as master_rows,
    (select count(*)::int from suspend_tag_private.workflows) as workflow_rows`)).rows[0];
  assert.equal(volume.master_rows, syntheticRows + 1);
  assert.equal(volume.workflow_rows, syntheticRows + 1);

  await db.exec(await read('supabase/migrations/20261019113414_suspend_tag_sender_identity.sql'));
  const configured = await db.query(`select set_config('app.suspend_tag_actor_id','00000000-0000-0000-0000-000000000006',false)`);
  assert.ok(configured.rows[0].set_config);
  const requestStartedAt = performance.now();
  const sent = await db.query(`select suspend_tag_private.request_approval('suspend-fixture') as approval_id`);
  const requestMs = performance.now() - requestStartedAt;
  assert.ok(requestMs < 100, `interactive approval request query exceeded 100ms: ${requestMs.toFixed(2)}ms`);
  const approvalId = sent.rows[0].approval_id;
  const repeatStartedAt = performance.now();
  const duplicate = await db.query(`select suspend_tag_private.request_approval('suspend-fixture') as approval_id`);
  const duplicateRequestMs = performance.now() - repeatStartedAt;
  assert.equal(duplicate.rows[0].approval_id, approvalId, 'repeated request must reuse the pending approval round');
  assert.ok(duplicateRequestMs < 100, `warm idempotent request query exceeded 100ms: ${duplicateRequestMs.toFixed(2)}ms`);
  const masterPlan = (await db.query(`explain (analyze, costs, format json)
    select unique_id from public.ph_soc_master where unique_id='suspend-fixture'`)).rows[0]['QUERY PLAN'][0].Plan;
  const workflowPlan = (await db.query(`explain (analyze, costs, format json)
    select source_uid from suspend_tag_private.workflows where source_uid='suspend-fixture'`)).rows[0]['QUERY PLAN'][0].Plan;
  assert.match(JSON.stringify(masterPlan), /Index Scan|Index Only Scan/);
  assert.match(JSON.stringify(workflowPlan), /Index Scan|Index Only Scan/);
  const approval = (await db.query('select * from suspend_tag_private.approvals where id=$1',[approvalId])).rows[0];
  assert.equal(approval.completed_by,'00000000-0000-0000-0000-000000000002');
  assert.equal(approval.sent_by,'00000000-0000-0000-0000-000000000006');
  assert.equal(approval.submitter_email,'field_sender@example.test');
  const recipients = (await db.query('select request_email, decision_emails from suspend_tag_private.approval_recipients where approval_id=$1',[approvalId])).rows[0];
  assert.equal(recipients.request_email,'rep_user@example.test');
  assert.deepEqual(new Set(recipients.decision_emails),new Set([
    'field_sender@example.test','dylan_collyge@example.test','dan_mccuistion@example.test',
    'megan_kelly@example.test','jd_jones@example.test',
  ]));
  assert.equal(recipients.decision_emails.includes(recipients.request_email),false);

  await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
  await db.query(`select set_config('app.suspend_tag_decision_message','',false)`);
  await assert.rejects(
    db.query(`select public.suspend_tag_command_v1('00000000-0000-0000-0000-000000000006','decide','{"decisionMessage":true}'::jsonb,null,null,'10000000-0000-0000-0000-000000000006')`),
    /SUSPEND_TAG_DECISION_MESSAGE_INVALID/,
  );
  await assert.rejects(
    db.query(`select public.suspend_tag_command_v1('00000000-0000-0000-0000-000000000006','decide',jsonb_build_object('decisionMessage',repeat('x',1001)),null,null,'10000000-0000-0000-0000-000000000006')`),
    /SUSPEND_TAG_DECISION_MESSAGE_INVALID/,
  );
  await assert.rejects(
    db.query(`select public.suspend_tag_command_v1('00000000-0000-0000-0000-000000000006','decide','{"decisionMessage":"ok"}'::jsonb,null,null,'20000000-0000-0000-0000-000000000006')`),
    /SUSPEND_TAG_SESSION_REQUIRED/,
  );
  await db.query(`select set_config('request.jwt.claims','{"role":"authenticated"}',false)`);
  await assert.rejects(
    db.query(`select public.suspend_tag_command_v1('00000000-0000-0000-0000-000000000006','decide','{"decisionMessage":"ok"}'::jsonb,null,null,'10000000-0000-0000-0000-000000000006')`),
    /SUSPEND_TAG_SERVICE_REQUIRED/,
  );
  await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
  const command = (await db.query(`select public.suspend_tag_command_v1(
    '00000000-0000-0000-0000-000000000006','decide','{"decisionMessage":"Keep the photo."}'::jsonb,
    null,null,'10000000-0000-0000-0000-000000000006') as result`)).rows[0].result;
  assert.equal(command.actor,'00000000-0000-0000-0000-000000000006');
  assert.equal(command.decisionMessage,'Keep the photo.');

  const requestEvent = (await db.query(`select request_event_id from suspend_tag_private.approvals where id=$1`,[approvalId])).rows[0].request_event_id;
  const lease = '30000000-0000-0000-0000-000000000001';
  await db.query(`update public.ph_request_delivery_outbox set status='processing',lease_token=$2 where event_id=$1`,[requestEvent,lease]);
  await assert.rejects(
    db.query(`select public.prepare_suspend_tag_delivery_v1($1,'30000000-0000-0000-0000-000000000002')`,[requestEvent]),
    /DELIVERY_LEASE_LOST/,
  );
  await db.query(`select set_config('request.jwt.claims','{"role":"authenticated"}',false)`);
  await assert.rejects(
    db.query(`select public.prepare_suspend_tag_delivery_v1($1,$2)`,[requestEvent,lease]),
    /DELIVERY_WORKER_FORBIDDEN/,
  );
  await db.query(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
  const preparedRequest = (await db.query(`select public.prepare_suspend_tag_delivery_v1($1,$2) as result`,[requestEvent,lease])).rows[0].result;
  assert.deepEqual(preparedRequest.deliveryRecipients,['rep_user@example.test']);
  assert.equal(preparedRequest.decisionMessage,'');

  await db.query(`update public.ph_request_delivery_outbox set email_delivered_at=now(),gmail_thread_id='thread-1',message_id_header='<msg-1>' where event_id=$1`,[requestEvent]);
  const decisionEvent = (await db.query(`insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status,lease_token)
    values('decision:'||$1,'suspend_tag_approval_decided',$1,'suspend-tag-'||$1,jsonb_build_object('approval_id',$1),'processing',$2) returning event_id`,[approvalId,lease])).rows[0].event_id;
  const preparedDecision = (await db.query(`select public.prepare_suspend_tag_delivery_v1($1,$2) as result`,[decisionEvent,lease])).rows[0].result;
  assert.deepEqual(new Set(preparedDecision.deliveryRecipients),new Set(recipients.decision_emails));
  assert.equal(preparedDecision.thread.threadId,'thread-1');

  await db.query(`select set_config('app.suspend_tag_decision_message','Please recheck the photo.',false)`);
  const decisionStartedAt = performance.now();
  await db.query(`update suspend_tag_private.approvals set status='denied' where id=$1`,[approvalId]);
  const decisionMs = performance.now() - decisionStartedAt;
  assert.ok(decisionMs < 100, `interactive decision persistence query exceeded 100ms: ${decisionMs.toFixed(2)}ms`);
  const decision = (await db.query('select decision_message from suspend_tag_private.approvals where id=$1',[approvalId])).rows[0];
  assert.equal(decision.decision_message,'Please recheck the photo.');
  console.log(`PASS isolated Suspend approval sender identity, frozen recipients, and decision message; request_approval ${requestMs.toFixed(2)}ms, idempotent repeat ${duplicateRequestMs.toFixed(2)}ms, decision persistence ${decisionMs.toFixed(2)}ms; synthetic volume master=${volume.master_rows}, workflows=${volume.workflow_rows}; primary-key plans indexed (PGlite WASM in-memory; timings are not production PostgreSQL latency)`);
} finally {
  await db.close();
}
