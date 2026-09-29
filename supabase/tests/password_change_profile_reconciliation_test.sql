begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

select has_function('public','prepare_password_change_profile',array['text','uuid','text'],'prepare RPC is installed');
select has_function('public','complete_password_change_profile',array['uuid','uuid','text','text'],'complete RPC is installed');
select ok(has_function_privilege('service_role','public.prepare_password_change_profile(text,uuid,text)','execute'),'service role can prepare password changes');
select ok(not has_function_privilege('authenticated','public.prepare_password_change_profile(text,uuid,text)','execute'),'authenticated users cannot prepare password changes directly');
select ok(not has_function_privilege('anon','public.prepare_password_change_profile(text,uuid,text)','execute'),'anonymous users cannot prepare password changes');
select ok(has_function_privilege('service_role','public.complete_password_change_profile(uuid,uuid,text,text)','execute'),'service role can complete password changes');
select ok(not has_function_privilege('authenticated','public.complete_password_change_profile(uuid,uuid,text,text)','execute'),'authenticated users cannot complete password changes directly');

create temporary table pw_deferred_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,division,language,must_change_password,failed_login_count)
  values('pw_deferred_test','1234','Manager','12','English',false,4)
  returning id,username,role,division,language,must_change_password,failed_login_count
)
select * from inserted;

create temporary table pw_deferred_first as
select * from public.prepare_password_change_profile('pw_deferred_test',null,repeat('a',64));
select is((select status from pw_deferred_first),'needs_native_identity','legacy starter password is recognized even when the stored flag is false');
select ok((select attempt_id is not null and profile_id is null from pw_deferred_first),'deferred native identity reserves one attempt without inventing a profile');
select is((select must_change_password from public.ph_app_users where id=(select id from pw_deferred_legacy)),true,'prepare raises the legacy forced-reset gate');
select is((select count(*)::integer from public.profiles where username='pw_deferred_test'),0,'missing profile remains absent until a trusted Auth identity exists');
select throws_ok($$select public.prepare_password_change_profile('pw_deferred_test',null,repeat('b',64))$$,
  '40001','password_change_attempt_conflict','a concurrent different password cannot replace the pending attempt');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-000000000001',username||'@greenleafnursery.com',now(),
  jsonb_build_object('role',role,'legacy_user_id',id::text),jsonb_build_object('username','ignored_user_metadata'),'starter-hash'
from pw_deferred_legacy;

create temporary table pw_deferred_ready as
select * from public.prepare_password_change_profile('', 'c1000000-0000-4000-8000-000000000001',repeat('a',64));
select is((select status from pw_deferred_ready),'ready','reprepare binds the reserved attempt to a newly verified canonical Auth identity');
select is((select attempt_id from pw_deferred_ready),(select attempt_id from pw_deferred_first),'identity retry reuses the original attempt ID');
select is((select profile_id from pw_deferred_ready),'c1000000-0000-4000-8000-000000000001'::uuid,'verified missing profile is created with the Auth UUID');
select is((select role from pw_deferred_ready),'Manager','new profile role comes from the legacy account');
select is((select legacy_user_id from pw_deferred_ready),(select id from pw_deferred_legacy),'new profile links the exact unique legacy row');
select is((select must_change_password from pw_deferred_ready),true,'prepare keeps the gate raised until completion');

update auth.users set encrypted_password=extensions.crypt('Next-Password-2026!',extensions.gen_salt('bf'))
where id='c1000000-0000-4000-8000-000000000001';
create temporary table pw_deferred_completed as
select * from public.complete_password_change_profile(
  (select attempt_id from pw_deferred_ready),'c1000000-0000-4000-8000-000000000001',
  'Next-Password-2026!',repeat('a',64));
select is((select status from pw_deferred_completed),'completed','completion atomically finalizes the prepared attempt');
select is((select must_change_password from pw_deferred_completed),false,'completion returns a cleared password gate');
select is((select password from public.ph_app_users where id=(select id from pw_deferred_legacy)),'Next-Password-2026!','completion synchronizes the legacy password');
select is((select must_change_password from public.ph_app_users where id=(select id from pw_deferred_legacy)),false,'completion clears the legacy gate');
select is((select must_change_password from public.profiles where id='c1000000-0000-4000-8000-000000000001'),false,'completion clears the profile gate');
select is((select role from public.profiles where id='c1000000-0000-4000-8000-000000000001'),'Manager','completion preserves authoritative role');
select is((select failed_login_count from public.ph_app_users where id=(select id from pw_deferred_legacy)),4,'completion preserves failed-login state');
select ok((select password_changed_at is not null from public.ph_app_users where id=(select id from pw_deferred_legacy)),'completion records the password change time');
create temporary table pw_deferred_retry as
select * from public.prepare_password_change_profile('pw_deferred_test','c1000000-0000-4000-8000-000000000001',repeat('a',64));
select is((select status from pw_deferred_retry),'completed','same-password retry after a lost response is recognized as complete');
select is((select role from pw_deferred_retry),'Manager','completed retry returns current database role');
select is((select status from public.complete_password_change_profile(
  (select attempt_id from pw_deferred_ready),'c1000000-0000-4000-8000-000000000001',
  'Next-Password-2026!',repeat('a',64))),'completed','completion retry is idempotent');
select throws_ok($$select public.complete_password_change_profile(
  (select attempt_id from pw_deferred_ready),'c1000000-0000-4000-8000-000000000001',
  'Wrong-Password-2026!',repeat('a',64))$$,'23514','password_change_auth_password_mismatch','completion rejects a password that does not match Auth');

update auth.users set encrypted_password=extensions.crypt('Admin-Reset-2026!',extensions.gen_salt('bf'))
where id='c1000000-0000-4000-8000-000000000001';
select is((select status from public.prepare_password_change_profile(
  'pw_deferred_test','c1000000-0000-4000-8000-000000000001',repeat('a',64))),
  'password_change_not_required','old completed fingerprint is not accepted after Auth password parity changes');

create temporary table pw_alias_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_confirmed_alias','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-000000000006',username||'@greenleafnursery.com',now(),'{}','{}','starter-hash'
from pw_alias_legacy;
select is((select status from public.prepare_password_change_profile(
  'pw_confirmed_alias','c1000000-0000-4000-8000-000000000006',repeat('c',64))),
  'ready','confirmed canonical alias can verify a native identity without metadata');

create temporary table pw_banned_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_banned_account','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,banned_until,encrypted_password)
select 'c1000000-0000-4000-8000-000000000007',username||'@greenleafnursery.com',now(),
  jsonb_build_object('legacy_user_id',id::text),'{}',now()+interval '1 hour','starter-hash'
from pw_banned_legacy;
select throws_ok($$select public.prepare_password_change_profile(
  'pw_banned_account','c1000000-0000-4000-8000-000000000007',repeat('d',64))$$,
  '42501','password_change_inactive_account','banned Auth identities cannot be reconciled');

create temporary table pw_collision_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_auth_collision','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password) values
  ('c1000000-0000-4000-8000-000000000008','pw-auth-collision@greenleafnursery.com',now(),'{}','{}','starter-hash'),
  ('c1000000-0000-4000-8000-000000000009','pw_auth_collision@greenleafnursery.com',now(),'{}','{}','starter-hash');
select throws_ok($$select public.prepare_password_change_profile('pw_auth_collision',null,repeat('e',64))$$,
  '21000','password_change_auth_identity_conflict','distinct canonical emails that normalize to the same username are ambiguous');

create temporary table pw_stale_metadata_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_stale_metadata','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-00000000000a',username||'@greenleafnursery.com',now(),
  '{"legacy_user_id":"999999999"}','{}','starter-hash' from pw_stale_metadata_legacy;
select throws_ok($$select public.prepare_password_change_profile(
  'pw_stale_metadata','c1000000-0000-4000-8000-00000000000a',repeat('f',64))$$,
  '23514','password_change_auth_identity_conflict','a stale app_metadata legacy link cannot fall back to a matching alias');

create temporary table pw_malformed_metadata_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_malformed_metadata','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-00000000000c',username||'@greenleafnursery.com',now(),
  '{"legacy_user_id":"invalid-id"}','{}','starter-hash' from pw_malformed_metadata_legacy;
select throws_ok($$select public.prepare_password_change_profile(
  'pw_malformed_metadata','c1000000-0000-4000-8000-00000000000c',repeat('a',64))$$,
  '23514','password_change_auth_identity_conflict','a malformed app_metadata legacy link cannot fall back to a matching alias');

create temporary table pw_disabled_profile_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_disabled_profile','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-00000000000b',username||'@greenleafnursery.com',now(),
  jsonb_build_object('legacy_user_id',id::text),'{}','starter-hash' from pw_disabled_profile_legacy;
insert into public.profiles(id,legacy_user_id,username,role,disabled_at,must_change_password)
select 'c1000000-0000-4000-8000-00000000000b',id,username,'User',now(),true from pw_disabled_profile_legacy;
select throws_ok($$select public.prepare_password_change_profile(
  'pw_disabled_profile','c1000000-0000-4000-8000-00000000000b',repeat('a',64))$$,
  '42501','password_change_inactive_account','disabled native profiles cannot be repaired or reset');

create temporary table pw_orphan_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,division,language,must_change_password,failed_login_count)
  values('pw_orphan_profile','starter','LegacyRole','10','English',true,2)
  returning id,username,role,division,language
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-000000000002',username||'@greenleafnursery.com',now(),
  jsonb_build_object('legacy_user_id',id::text),jsonb_build_object('username','ignored_user_metadata'),'starter-hash'
from pw_orphan_legacy;
insert into public.profiles(id,legacy_user_id,username,display_name,role,division,language,must_change_password)
select 'c1000000-0000-4000-8000-000000000002',null,username,'Preserve this name','RetainedRole','42','Spanish',true
from pw_orphan_legacy;
create temporary table pw_orphan_ready as
select * from public.prepare_password_change_profile('pw_orphan_profile','c1000000-0000-4000-8000-000000000002',repeat('b',64));
select is((select status from pw_orphan_ready),'ready','orphan profile is reconciled without recreating it');
select is((select legacy_user_id from public.profiles where id='c1000000-0000-4000-8000-000000000002'),(select id from pw_orphan_legacy),'orphan profile receives only its missing legacy link');
select is((select role from public.profiles where id='c1000000-0000-4000-8000-000000000002'),'RetainedRole','reconciliation preserves an existing profile role');
select is((select division from public.profiles where id='c1000000-0000-4000-8000-000000000002'),'42','reconciliation preserves profile division');
update auth.users set encrypted_password=extensions.crypt('Orphan-Next-2026!',extensions.gen_salt('bf'))
where id='c1000000-0000-4000-8000-000000000002';
create temporary table pw_orphan_completed as
select * from public.complete_password_change_profile(
  (select attempt_id from pw_orphan_ready),'c1000000-0000-4000-8000-000000000002',
  'Orphan-Next-2026!',repeat('b',64));
select is((select role from pw_orphan_completed),'RetainedRole','password completion preserves preexisting profile role');
select is((select role from public.ph_app_users where id=(select id from pw_orphan_legacy)),'LegacyRole','password completion preserves legacy role');

create temporary table pw_duplicate_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_duplicate_user','1234','User',true),('PW-DUPLICATE-USER','1234','User',true)
  returning id
)
select count(*)::integer as rows from inserted;
select throws_ok($$select public.prepare_password_change_profile('pw_duplicate_user',null,repeat('c',64))$$,
  '21000','password_change_duplicate_legacy_username','duplicate normalized legacy usernames are rejected');

create temporary table pw_conflict_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_identity_conflict','1234','User',true),('pw_conflicting_link_target','1234','User',true)
  returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-000000000003','pw_identity_conflict@greenleafnursery.com',now(),
  jsonb_build_object('username','pw_identity_conflict','legacy_user_id',(select id::text from pw_conflict_legacy where username='pw_conflicting_link_target')),'{}','starter-hash';
select throws_ok($$select public.prepare_password_change_profile('pw_identity_conflict','c1000000-0000-4000-8000-000000000003',repeat('d',64))$$,
  '23514','password_change_auth_identity_conflict','conflicting Auth metadata and canonical alias are rejected');

create temporary table pw_link_conflict_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_profile_link_conflict','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-000000000004',username||'@greenleafnursery.com',now(),
  jsonb_build_object('legacy_user_id',id::text),'{}','starter-hash' from pw_link_conflict_legacy;
insert into public.profiles(id,legacy_user_id,username,role,must_change_password)
values('c1000000-0000-4000-8000-000000000004',null,'other_profile_identity','User',true);
select throws_ok($$select public.prepare_password_change_profile('pw_profile_link_conflict','c1000000-0000-4000-8000-000000000004',repeat('e',64))$$,
  '23514','password_change_auth_identity_conflict','a profile row with a conflicting username is not adopted');

create temporary table pw_profile_identity_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_profile_identity','1234','Manager',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
values('c1000000-0000-4000-8000-00000000000d','legacy-format@example.net',null,'{}','{}','starter-hash');
insert into public.profiles(id,legacy_user_id,username,display_name,role,must_change_password)
select 'c1000000-0000-4000-8000-00000000000d',id,username,'Existing profile','RetainedManager',true
from pw_profile_identity_legacy;
select throws_ok($$select public.prepare_password_change_profile(
  'wrong_client_username','c1000000-0000-4000-8000-00000000000d',repeat('c',64))$$,
  '23514','password_change_auth_identity_conflict','a verified native UUID cannot reset a different claimed username');
select is((select status from public.prepare_password_change_profile(
  'pw_profile_identity','c1000000-0000-4000-8000-00000000000d',repeat('c',64))),
  'ready','existing service-linked profile verifies a native UUID despite noncanonical unconfirmed email');

create temporary table pw_rollback_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_completion_rollback','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-00000000000e',username||'@greenleafnursery.com',now(),
  jsonb_build_object('legacy_user_id',id::text),'{}','starter-hash' from pw_rollback_legacy;
insert into public.profiles(id,legacy_user_id,username,role,must_change_password)
select 'c1000000-0000-4000-8000-00000000000e',id,username,'User',true from pw_rollback_legacy;
create temporary table pw_rollback_ready as
select * from public.prepare_password_change_profile(
  'pw_completion_rollback','c1000000-0000-4000-8000-00000000000e',repeat('d',64));
update auth.users set encrypted_password=extensions.crypt('Rollback-Next-2026!',extensions.gen_salt('bf'))
where id='c1000000-0000-4000-8000-00000000000e';
create function public.pw_fail_profile_gate_clear() returns trigger language plpgsql as $$
begin
  if old.id='c1000000-0000-4000-8000-00000000000e' and old.must_change_password and not new.must_change_password then
    raise exception using errcode='P0001',message='profile_completion_fixture_failure';
  end if;
  return new;
end $$;
create trigger pw_fail_profile_gate_clear before update on public.profiles
for each row execute function public.pw_fail_profile_gate_clear();
select throws_ok($$select public.complete_password_change_profile(
  (select attempt_id from pw_rollback_ready),'c1000000-0000-4000-8000-00000000000e',
  'Rollback-Next-2026!',repeat('d',64))$$,
  'P0001','profile_completion_fixture_failure','profile write failure aborts the entire password completion');
select is((select password from public.ph_app_users where id=(select id from pw_rollback_legacy)),
  '1234','failed profile sync rolls back the earlier legacy password write');
select is((select must_change_password from public.ph_app_users where id=(select id from pw_rollback_legacy)),
  true,'failed profile sync keeps the legacy forced-reset gate raised');
select is((select must_change_password from public.profiles where id='c1000000-0000-4000-8000-00000000000e'),
  true,'failed profile sync keeps the profile forced-reset gate raised');
drop trigger pw_fail_profile_gate_clear on public.profiles;
drop function public.pw_fail_profile_gate_clear();
select is((select status from public.complete_password_change_profile(
  (select attempt_id from pw_rollback_ready),'c1000000-0000-4000-8000-00000000000e',
  'Rollback-Next-2026!',repeat('d',64))),
  'completed','the same reserved attempt succeeds when the transient profile failure is removed');

create temporary table pw_unconfirmed_legacy as
with inserted as (
  insert into public.ph_app_users(username,password,role,must_change_password)
  values('pw_unconfirmed_alias','1234','User',true) returning id,username
)
select * from inserted;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)
select 'c1000000-0000-4000-8000-000000000005',username||'@greenleafnursery.com',null,'{}',
  jsonb_build_object('username',username),'starter-hash' from pw_unconfirmed_legacy;
select throws_ok($$select public.prepare_password_change_profile('pw_unconfirmed_alias','c1000000-0000-4000-8000-000000000005',repeat('f',64))$$,
  '23514','password_change_unconfirmed_auth_alias','unconfirmed canonical email alone is not trusted; user_metadata is ignored');

insert into public.ph_app_users(username,password,role,must_change_password,disabled_at)
values('pw_disabled_account','1234','User',false,now());
select throws_ok($$select public.prepare_password_change_profile('pw_disabled_account',null,repeat('a',64))$$,
  '42501','password_change_inactive_account','disabled legacy accounts cannot be repaired or reset');
insert into public.ph_app_users(username,password,role,must_change_password,locked_until)
values('pw_locked_account','1234','User',true,now()+interval '1 hour');
select throws_ok($$select public.prepare_password_change_profile('pw_locked_account',null,repeat('b',64))$$,
  '42501','password_change_inactive_account','locked legacy accounts cannot be repaired or reset');

select * from finish();
rollback;
