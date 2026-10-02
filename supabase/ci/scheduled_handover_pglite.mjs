import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root with an external PGlite installation.');
const require = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const flyerRowFixture = fs.readFileSync(new URL('./scheduled_handover_fixture.sql', import.meta.url), 'utf8')
  .match(/CREATE TABLE IF NOT EXISTS public\.ph_flyer_folder_rows \([\s\S]*?\n\);/)[0];
const fixture = `
create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
create schema auth; create schema private; create schema cron; create schema vault; create schema net; create schema storage; create table storage.objects(id bigint);
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create table public.profiles(id uuid primary key,legacy_user_id int,username text not null,display_name text,role text,disabled_at timestamptz,locked_until timestamptz,must_change_password boolean default false,updated_at timestamptz default now());
create table public.ph_app_users(id int primary key,username text not null unique,role text,disabled_at timestamptz,locked_until timestamptz,must_change_password boolean default false);
create table public.ph_eval_assignment_users(username text primary key,display_name text not null,active bool default true,source text,updated_at timestamptz default now());
create table public.ph_app_settings(key text primary key,value jsonb not null default '{}'::jsonb,updated_by text,updated_at timestamptz default now());
create table public.ph_eval_work(id uuid primary key,status text,assignee_username text,assignee_usernames text[],assignee_profiles jsonb,version int default 1,updated_at timestamptz default now());
${flyerRowFixture}
create table public.ph_push_subscriptions(id bigint generated always as identity primary key,profile_id uuid,username text,notifications_enabled bool default true);
create table public.test_protected_data(id int primary key,value text);
insert into public.test_protected_data values(1,'shared protected row');
create table public.test_handover_companion(fail boolean not null default false);
insert into public.test_handover_companion values(false);
create table private.app_limited_live_overrides(profile_id uuid,permission_key text,allowed bool,updated_by_username text,updated_at timestamptz,primary key(profile_id,permission_key));
create table private.app_limited_access_events(id bigint generated always as identity,actor_username text,target_username text,target_role text,permission_key text,previous_value jsonb,next_value jsonb,reason text);
create table private.app_limited_access_state(singleton bool primary key,revision bigint default 0,updated_at timestamptz default now());
insert into private.app_limited_access_state(singleton,revision) values(true,1);
create table private.app_access_user_overrides(policy_id bigint,profile_id uuid,permission_key text,allowed bool,access_scope text,updated_at timestamptz,primary key(policy_id,profile_id,permission_key));
create table private.app_access_change_events(id bigint generated always as identity,policy_id bigint,actor_username text,event_type text,target_type text,target_key text,permission_key text,previous_value jsonb,next_value jsonb,reason text);
create table private.app_access_policy_versions(id bigint primary key,revision int default 0);
insert into private.app_access_policy_versions(id,revision) values(1,1);
create function private.normalized_profile_role(text) returns text language sql immutable as $$ select lower($1) $$;
create function private.transfer_remaining_handover_assignments_v1(text,integer) returns jsonb language plpgsql as $$ begin if (select fail from public.test_handover_companion) then raise exception 'fixture transfer failure'; end if; return jsonb_build_object('changed',0,'remaining',false,'errorCode',null); end $$;
create function public.reassign_eval_work_v2(jsonb) returns jsonb language plpgsql security definer as $$
declare a jsonb; idv uuid := ($1->>'workId')::uuid; names text[]; lead jsonb;
begin select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into a from jsonb_array_elements($1->'assignees') with ordinality t(x,ord);
select array_agg(lower(x->>'username') order by ord), (array_agg(x order by ord))[1] into names,lead from jsonb_array_elements(a) with ordinality t(x,ord);
update public.ph_eval_work set assignee_profiles=a,assignee_usernames=names,assignee_username=lead->>'username',version=version+1,updated_at=now() where id=idv;
return '{}'::jsonb; end $$;
create table cron.job(jobid bigint generated always as identity primary key,jobname text,schedule text,command text);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$ declare i bigint; begin insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid into i; return i; end $$;
create function cron.unschedule(bigint) returns boolean language plpgsql as $$ begin delete from cron.job where jobid=$1; return found; end $$;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
create function public.app_account_active_v1(uuid,text) returns bool language sql as $$ select true $$;
alter table public.profiles enable row level security;
alter table public.ph_push_subscriptions enable row level security; alter table storage.objects enable row level security; alter table public.test_protected_data enable row level security;
create policy fixture_profiles_self on public.profiles for select to authenticated using(id=auth.uid());
create policy fixture_protected_data on public.test_protected_data for all to authenticated using(true) with check(true);
create policy fixture_storage_access on storage.objects for select to authenticated using(true);
grant usage on schema public,storage to anon,authenticated,service_role;
grant select on public.profiles,public.test_protected_data,storage.objects to authenticated;
grant update on public.test_protected_data to authenticated;
insert into storage.objects(id) values(1);
insert into auth.users(id,email) values
('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp@greenleafnursery.com'),
('961b0a0f-11a6-4db5-b066-582f772ab8e7','nelly_aguilar@greenleafnursery.com');
insert into public.ph_app_users(id,username,role) values(17,'kayla_knepp','ADMIN'),(74,'nelly_aguilar','admin');
insert into public.profiles(id,legacy_user_id,username,display_name,role) values
('e2584b32-472c-4888-b592-394235050b5b',17,'kayla_knepp','Kayla Knepp','ADMIN'),
('961b0a0f-11a6-4db5-b066-582f772ab8e7',74,'nelly_aguilar','Nelly Aguilar','admin');
insert into private.app_limited_live_overrides values('e2584b32-472c-4888-b592-394235050b5b','x',true,'dylan_collyge',now());
insert into private.app_limited_live_overrides values('e2584b32-472c-4888-b592-394235050b5b','kayla-deny',false,'dylan_collyge',now());
insert into private.app_limited_live_overrides values('961b0a0f-11a6-4db5-b066-582f772ab8e7','nelly-existing',false,'dylan_collyge',now());
insert into private.app_access_user_overrides values(1,'e2584b32-472c-4888-b592-394235050b5b','y',true,'all',now());
insert into private.app_access_user_overrides values(1,'e2584b32-472c-4888-b592-394235050b5b','kayla-deny',false,'all',now());
insert into private.app_access_user_overrides values(1,'961b0a0f-11a6-4db5-b066-582f772ab8e7','nelly-existing',false,'all',now());
insert into public.ph_app_settings values('av_blanks_photo_bypass_users','{"users":["kayla_knepp"]}'::jsonb,'dylan_collyge',now());
insert into public.ph_eval_assignment_users(username,display_name,active,source) values('kayla_knepp','Kayla Knepp',true,'managed_roster');
insert into public.ph_eval_work(id,status,assignee_username,assignee_usernames,assignee_profiles,version)
values('aaaaaaaa-0000-0000-0000-000000000001','open','kayla_knepp',array['kayla_knepp','other'],
'[{"username":"kayla_knepp","display":"Kayla","email":"kayla_knepp@greenleafnursery.com"},{"username":"other","display":"Other","email":"other@greenleafnursery.com"}]'::jsonb,4);
insert into public.ph_flyer_folder_rows(unique_id,assignedto,flyer_assigned) values
('unfinished','kayla_knepp','Kayla Knepp, Other'),('completed','kayla_knepp','Kayla Knepp, Other');
update public.ph_flyer_folder_rows set flyer_completed=now() where unique_id='completed';
insert into public.ph_push_subscriptions(profile_id,username,notifications_enabled) values('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp',true);
`;
try {
  await db.waitReady;
  await db.exec(fixture);
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001215508_scheduled_handover_005.sql'),'utf8');
  await db.exec(migration);
  console.log('MIGRATION_OK');
  const grants=await db.query("select (select count(*)::int from private.app_limited_live_overrides where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7' and allowed) limited_grants,(select count(*)::int from private.app_limited_live_overrides where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7' and permission_key='nelly-existing' and not allowed) existing_limited_denials,(select count(*)::int from private.app_access_user_overrides where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7' and allowed) manager_grants,(select count(*)::int from private.app_access_user_overrides where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7' and permission_key='nelly-existing' and not allowed) existing_manager_denials,(select value->'users' @> '[\"nelly_aguilar\"]'::jsonb from public.ph_app_settings where key='av_blanks_photo_bypass_users') settings_grant");
  if (grants.rows[0].limited_grants!==1 || grants.rows[0].existing_limited_denials!==1 || grants.rows[0].manager_grants!==1 || grants.rows[0].existing_manager_denials!==1 || !grants.rows[0].settings_grant) throw new Error('Nelly capability transfer overwrote an existing choice or failed to copy a grant');
  console.log('PASS: only positive Kayla capabilities copy; Nelly denials and admin role remain unchanged');
  const a=await db.query("select public.app_account_active_v1('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp') active, private.app_account_active_at_v1('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp','2026-10-03 03:59:59.999999+00') before_active, private.app_account_active_at_v1('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp','2026-10-03 04:00:00+00') cutoff_active, private.resolve_operational_recipients_at_v1(array['kayla_knepp'],'username','2026-10-03 03:59:59.999999+00') before, private.resolve_operational_recipients_at_v1(array['kayla_knepp'],'username','2026-10-03 04:00:00+00') at, private.resolve_operational_recipients_at_v1(array['kayla_knepp_backup'],'username','2026-10-03 03:59:59+00') exact_alias, private.resolve_operational_recipients_at_v1(array['vendor@example.com'],'email','2026-10-03 03:59:59+00') external_email");
  if (!a.rows[0].active || !a.rows[0].before_active || a.rows[0].cutoff_active || JSON.stringify(a.rows[0].before)!==JSON.stringify(['kayla_knepp','nelly_aguilar']) || JSON.stringify(a.rows[0].at)!==JSON.stringify(['nelly_aguilar']) || JSON.stringify(a.rows[0].exact_alias)!==JSON.stringify(['kayla_knepp_backup']) || JSON.stringify(a.rows[0].external_email)!==JSON.stringify(['vendor@example.com'])) throw new Error('account/recipient boundary assertions failed');
  console.log('PASS: active account and exact recipient behavior before/at cutoff');
  await db.exec("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','e2584b32-472c-4888-b592-394235050b5b',false)");
  const kaylaBefore=await db.query("select count(*)::int rows from public.test_protected_data");
  if (kaylaBefore.rows[0].rows!==1) throw new Error('active Kayla lost permitted data before cutoff');
  await db.query('select public.guard_active_app_session_v1()');
  await db.exec('reset role');
  console.log('PASS: active authenticated Kayla keeps existing RLS access before cutoff');
  await db.exec("alter table private.scheduled_account_handover_v1 drop constraint scheduled_account_handover_v1_effective_at_check; update private.scheduled_account_handover_v1 set effective_at=now()-interval '1 minute';");
  await db.exec("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','e2584b32-472c-4888-b592-394235050b5b',false)");
  const kaylaAfter=await db.query("select count(*)::int rows from public.test_protected_data");
  const kaylaStorage=await db.query("select count(*)::int rows from storage.objects");
  const kaylaUpdate=await db.query("update public.test_protected_data set value='denied' where id=1 returning id");
  if (kaylaAfter.rows[0].rows!==0 || kaylaStorage.rows[0].rows!==0 || kaylaUpdate.rows.length!==0) throw new Error('Kayla retained public-table or Storage RLS access after cutoff');
  let guardDenied=false;
  try { await db.query('select public.guard_active_app_session_v1()'); } catch (error) { guardDenied=String(error.message).includes('APP_ACCOUNT_INACTIVE'); }
  if (!guardDenied) throw new Error('pre-request guard did not deny the cut-off Kayla JWT');
  await db.exec('reset role');
  await db.exec("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','961b0a0f-11a6-4db5-b066-582f772ab8e7',false)");
  const nellyAfter=await db.query("select count(*)::int rows from public.test_protected_data");
  const nellyStorage=await db.query("select count(*)::int rows from storage.objects");
  const nellyUpdate=await db.query("update public.test_protected_data set value='nelly update' where id=1 returning id");
  if (nellyAfter.rows[0].rows!==1 || nellyStorage.rows[0].rows!==1 || nellyUpdate.rows.length!==1) throw new Error('active Nelly lost existing table or Storage permissions');
  await db.exec('reset role');
  await db.exec("set role anon; select set_config('request.jwt.claim.role','anon',false); select set_config('request.jwt.claim.sub','',false)");
  await db.query('select public.guard_active_app_session_v1()');
  await db.exec('reset role');
  const anonScope = await db.query("select has_schema_privilege('anon','private','usage') access, has_function_privilege('anon','private.guard_active_app_session_v1()','execute') helper");
  if (anonScope.rows[0].access || anonScope.rows[0].helper) throw new Error('anonymous role gained access to private schema or helper');
  console.log('PASS: Kayla loses Data API/Storage access at cutoff; Nelly remains authorized; anon pre-request is harmless');
  await db.exec("update public.test_handover_companion set fail=true");
  const tick=await db.query('select public.scheduled_handover_tick_v1() result');
  if (!tick.rows[0].result.assignmentsPending || !String(tick.rows[0].result.errorCode).startsWith('remaining_transfer_failed_')) throw new Error('companion failure was not checkpointed');
  const firstFailure=await db.query("select (select assignedto from public.ph_flyer_folder_rows where unique_id='unfinished') flyer,(select assignedto from public.ph_flyer_folder_rows where unique_id='completed') completed,(select notifications_enabled from public.ph_push_subscriptions where username='kayla_knepp') push,(select attempts from private.scheduled_handover_assignment_state_v1 where target_key='companion') attempts,(select count(*) from private.scheduled_handover_push_outbox_v1 where event_type='scheduled_handover_failed') notice_count");
  if (firstFailure.rows[0].flyer!=='nelly_aguilar' || firstFailure.rows[0].completed!=='kayla_knepp' || firstFailure.rows[0].push || firstFailure.rows[0].attempts!==1 || firstFailure.rows[0].notice_count!==1) throw new Error('bounded handover failure state assertions failed');
  const assignmentRoster=await db.query("select active from public.ph_eval_assignment_users where username='kayla_knepp'");
  if (assignmentRoster.rows[0]?.active!==false) throw new Error('cutoff left Kayla active in the Eval assignment roster');
  const audit=await db.query("select metadata from private.scheduled_account_handover_audit_v1 where event_key like 'kayla_nelly_flyer_%'");
  if (!audit.rows[0]?.metadata?.before?.assignedto || audit.rows[0]?.metadata?.after?.assignedto!=='nelly_aguilar') throw new Error('assignment before/after audit incomplete');
  console.log('PASS: cutoff disables profile, legacy sign-in, Eval roster and push; transfers unfinished flyer only with before/after audit');
  await db.query("select public.scheduled_handover_tick_v1()");
  const attempts=await db.query("select attempts from private.scheduled_handover_assignment_state_v1 where target_key='companion'");
  if (attempts.rows[0].attempts!==1) throw new Error('companion failure retried during cooldown');
  await db.exec("update private.scheduled_handover_assignment_state_v1 set next_attempt_at=now() where target_key='companion'; update public.test_handover_companion set fail=false");
  await db.query("select public.scheduled_handover_tick_v1()");
  await db.query("select public.scheduled_handover_auth_checkpoint_v1(true,null)");
  const complete=await db.query("select public.scheduled_handover_tick_v1() result");
  if (!complete.rows[0].result.complete) throw new Error('handover did not complete after Auth confirmation and transfer success');
  const completedAgain=await db.query("select public.scheduled_handover_tick_v1() result");
  if (!completedAgain.rows[0].result.complete || Number(completedAgain.rows[0].result.transferredTotal)!==Number(complete.rows[0].result.transferredTotal)) throw new Error('completed handover was not idempotent');
  console.log('PASS: retry checkpoint/backoff, Auth confirmation, completion and repeated tick idempotency');
  const claims=await db.query('select * from public.scheduled_handover_claim_push_v1()');
  if (!claims.rows.length) throw new Error('failure notification was not queued for dispatch');
  for (const claim of claims.rows) await db.query('select public.scheduled_handover_finish_push_v1($1,true,null)',[claim.id]);
  const completionClaim=await db.query('select * from public.scheduled_handover_claim_push_v1()');
  for (const claim of completionClaim.rows) await db.query('select public.scheduled_handover_finish_push_v1($1,true,null)',[claim.id]);
  await db.query('select private.scheduled_handover_dispatch_v1()');
  const job=await db.query("select count(*)::int count from cron.job where jobname='scheduled_handover_kayla_nelly_20261002'");
  if (job.rows[0].count!==0) throw new Error('completed transition cron was not unscheduled after notifications reached terminal state');
  console.log('PASS: outbox completion notifications are delivered/terminal before cron unschedules');
  const inspect=await db.query("select (select disabled_at is not null from public.profiles where username='kayla_knepp') profile_disabled,(select disabled_at is not null from public.ph_app_users where username='kayla_knepp') legacy_disabled,(select notifications_enabled from public.ph_push_subscriptions where username='kayla_knepp') push_enabled,(select assignee_username from public.ph_eval_work where id='aaaaaaaa-0000-0000-0000-000000000001') eval_assignee,(select assignedto from public.ph_flyer_folder_rows where unique_id='unfinished') flyer_assignee,(select assignedto from public.ph_flyer_folder_rows where unique_id='completed') completed_assignee,(select revision from private.app_limited_access_state where singleton) override_revision");
  console.log('PGlite migration + handover behavior checks passed.');
} catch(e) { console.error('FAIL',e.message,e.stack); process.exitCode=1; }
finally { await db.close(); }

