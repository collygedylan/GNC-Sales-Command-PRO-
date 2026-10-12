-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(11);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.aura_account_rollout'::regclass),'Rollout flags force RLS');
select ok(not has_table_privilege('authenticated','private.aura_account_rollout','select'),'Browser cannot enumerate rollout flags');
select ok(not has_table_privilege('authenticated','private.aura_account_rollout','update'),'Browser cannot enable itself');
select ok(not has_table_privilege('anon','private.aura_account_rollout','select'),'Anonymous cannot read flags');
select ok(has_table_privilege('service_role','private.aura_account_rollout','update'),'Trusted service can manage future rollout');
select ok(not exists(select 1 from private.aura_account_rollout r join public.profiles p on p.id=r.profile_id where r.enabled and lower(btrim(p.username))<>'dylan_collyge'),'Only Dylan is enabled by the migration seed');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('f7130000-0000-4000-8000-000000000001','rollout-rep@example.invalid','{}','{"aura_enabled":true}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('f7130000-0000-4000-8000-000000000001','rollout_rep','Rollout Rep','REP',false);
insert into private.navigation_view_catalog(view_key,label,selectable) values('drive','Drive',true) on conflict(view_key) do nothing;
insert into private.navigation_view_overrides(profile_id,view_key,allowed) values('f7130000-0000-4000-8000-000000000001','drive',true);
select set_config('request.jwt.claim.sub','f7130000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.aura_voice_access_v1()$$,'42501','AURA_ACTOR_FORBIDDEN','Metadata cannot bypass a disabled feature');
insert into private.aura_account_rollout(profile_id,enabled) values('f7130000-0000-4000-8000-000000000001',true);
select is(public.aura_voice_access_v1()#>>'{capabilities,auraEnabled}','true','Explicit rollout enables a future rep without code changes');
select is(public.aura_voice_access_v1()#>>'{actor,id}','f7130000-0000-4000-8000-000000000001','Rollout remains bound to the authenticated actor');
update private.aura_account_rollout set enabled=false where profile_id='f7130000-0000-4000-8000-000000000001';
select throws_ok($$select public.aura_voice_access_v1()$$,'42501','AURA_ACTOR_FORBIDDEN','Revocation takes effect at the next server authorization');
set local role authenticated;
select throws_ok($$update private.aura_account_rollout set enabled=true$$,'42501',null,'Browser cannot mutate the feature flag directly');
reset role;
select * from finish();
rollback;
