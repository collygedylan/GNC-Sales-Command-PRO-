-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(27);

select has_table('public','role_access_baselines','canonical role baselines are stored in the exposed schema');
select has_table('public','user_access_control','per-profile overrides are stored');
select has_table('public','user_access_control_audit','access changes have an audit trail');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.role_access_baselines'::regclass,'public.user_access_control'::regclass,
  'public.user_access_control_state'::regclass,'public.user_access_control_commands'::regclass,
  'public.user_access_control_audit'::regclass)), 'all canonical access tables enforce RLS');
select ok(not has_table_privilege('anon','public.user_access_control','select')
  and not has_table_privilege('authenticated','public.user_access_control','select')
  and has_table_privilege('service_role','public.user_access_control','select'),
  'profiles and overrides are readable only through the trusted server boundary');
select ok(not has_function_privilege('anon','public.user_access_command_v1(uuid,text,jsonb,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','public.user_access_command_v1(uuid,text,jsonb,bigint,uuid)','execute')
  and has_function_privilege('service_role','public.user_access_command_v1(uuid,text,jsonb,bigint,uuid)','execute'),
  'command RPC is server-only');
select is((select count(*)::integer from public.role_access_baselines),14,'all canonical and legacy roles have baselines');
select ok((select bool_and((select count(*)=9 from jsonb_object_keys(role_access_baselines.permissions))
  and private.user_access_permission_flags_valid_v1(permissions,false)) from public.role_access_baselines),
  'every role baseline has exactly the complete, typed nine-flag contract');
select ok((select (permissions->>'can_access_drive_mode')::boolean
  and (permissions->>'can_access_que')::boolean and not (permissions->>'can_access_av')::boolean
  from public.role_access_baselines where role='counter'), 'QC preserves Drive and Que while AV remains denied');
select ok((select (permissions->>'can_access_drive_mode')::boolean
  and not (permissions->>'can_access_av')::boolean from public.role_access_baselines where role='foreman'),
  'Foreman preserves Drive but not AV');
select ok((select count(*)=2 and bool_and(not (permissions->>'can_access_drive_mode')::boolean
  and not (permissions->>'can_access_av')::boolean) from public.role_access_baselines where role in ('grower','take_backs')),
  'Grower and Take Back remain outside Drive and AV');
select ok((select not (permissions->>'can_access_manager_tab')::boolean
  from public.role_access_baselines where role='evaluator'), 'Evaluator cannot inherit Manager access');
select ok((select pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure)
  like '%user_access_has_permission_v1%' and pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure)
  like '%user_access_has_permission_v1%'), 'Eval 2 SQL paths consume the canonical effective feature flag');
select ok((select not polpermissive from pg_policy where polname='canonical_user_access_inventory_read_v1'
  and polrelid='public.ph_master_inventory'::regclass)
  and exists(select 1 from pg_policy where polname='sales_rep_inventory_read_v1'
    and polrelid='public.ph_master_inventory'::regclass and polpermissive),
  'canonical inventory policy is restrictive and retains the existing Sales Rep role policy');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('a9f10000-0000-4000-8000-000000000001','access-admin@example.invalid','{}','{}'),
 ('a9f10000-0000-4000-8000-000000000002','access-rep@example.invalid','{}','{}'),
 ('a9f10000-0000-4000-8000-000000000003','access-unknown@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until) values
 ('a9f10000-0000-4000-8000-000000000001','access_admin','Access Admin','ADMIN',false,null,null),
 ('a9f10000-0000-4000-8000-000000000002','access_rep','Access Rep','REP',false,null,null),
 ('a9f10000-0000-4000-8000-000000000003','access_unknown','Access Unknown','unrecognized role',false,null,null)
on conflict(id) do update set role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select ('a9f10000-0000-4000-8000-'||lpad((n+1000)::text,12,'0'))::uuid,
  format('access-rep-%s@example.invalid',n),'{}','{}'
from generate_series(1,64) n on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select ('a9f10000-0000-4000-8000-'||lpad((n+1000)::text,12,'0'))::uuid,
  format('access_rep_%s',n),format('Access Rep %s',n),'REP',false,null,null
from generate_series(1,64) n
on conflict(id) do update set role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
analyze public.profiles;
analyze public.user_access_control;

create temporary table user_access_perf_evidence(payload jsonb) on commit drop;
create function pg_temp.user_access_directory_67_under_100ms_v1() returns boolean
language plpgsql as $$
declare
  started_at timestamptz;
  resolve_first_ms numeric;
  resolve_warm_ms numeric;
  directory_first_ms numeric;
  directory_warm_ms numeric;
  resolve_value jsonb;
  directory_value jsonb;
  warm_value jsonb;
  warm_resolve_valid boolean;
  auth_lookup_plan jsonb;
begin
  started_at:=clock_timestamp();
  resolve_value:=public.user_access_command_v1('a9f10000-0000-4000-8000-000000000002','resolve','{}');
  resolve_first_ms:=extract(epoch from (clock_timestamp()-started_at))*1000;
  started_at:=clock_timestamp();
  warm_value:=public.user_access_command_v1('a9f10000-0000-4000-8000-000000000002','resolve','{}');
  resolve_warm_ms:=extract(epoch from (clock_timestamp()-started_at))*1000;
  warm_resolve_valid:=jsonb_typeof(warm_value->'effective_permissions')='object';
  started_at:=clock_timestamp();
  directory_value:=public.user_access_command_v1('a9f10000-0000-4000-8000-000000000001','directory','{}');
  directory_first_ms:=extract(epoch from (clock_timestamp()-started_at))*1000;
  started_at:=clock_timestamp();
  warm_value:=public.user_access_command_v1('a9f10000-0000-4000-8000-000000000001','directory','{}');
  directory_warm_ms:=extract(epoch from (clock_timestamp()-started_at))*1000;
  execute $explain$explain (analyze, buffers, format json)
    select p.id from public.user_access_control u join public.profiles p on p.id=u.profile_id
    where u.username='access_rep' and u.active and p.disabled_at is null and not p.must_change_password$explain
    into auth_lookup_plan;
  insert into user_access_perf_evidence(payload) values(jsonb_build_object(
    'postgres_version',current_setting('server_version'),
    'synthetic_profile_count',(select count(*) from public.profiles),
    'resolve_first_call_ms',round(resolve_first_ms,3),'resolve_second_call_ms',round(resolve_warm_ms,3),
    'directory_first_call_ms',round(directory_first_ms,3),'directory_second_call_ms',round(directory_warm_ms,3),
    'cache_condition','first call after fixture setup; second call immediately repeated in same transaction; OS/cache state otherwise uncontrolled',
    'directory_result_count',jsonb_array_length(directory_value->'users'),
    'indexed_auth_lookup_plan',auth_lookup_plan));
  return resolve_first_ms<100 and resolve_warm_ms<100 and directory_first_ms<100 and directory_warm_ms<100
    and (select count(*)=67 from public.profiles)
    and jsonb_typeof(resolve_value->'effective_permissions')='object'
    and warm_resolve_valid
    and jsonb_array_length(directory_value->'users')>=67;
end $$;
select ok(pg_temp.user_access_directory_67_under_100ms_v1(),
  'resolve and manager directory RPC each return within 100ms with 67 representative profiles');

select is((public.user_access_command_v1('a9f10000-0000-4000-8000-000000000002','resolve','{}')->'effective_permissions'->>'can_access_av')::boolean,true,
  'native REP profile resolves its default canonical AV permission');
select throws_ok($$select public.user_access_command_v1('a9f10000-0000-4000-8000-000000000003','resolve','{}')$$,
  '42501','USER_ACCESS_ROLE_UNMAPPED','unknown role fails closed');
select throws_ok($$select public.user_access_command_v1('a9f10000-0000-4000-8000-000000000002','directory','{}')$$,
  '42501','USER_ACCESS_MANAGER_REQUIRED','ordinary REP cannot read the user directory');

select is((public.user_access_command_v1('a9f10000-0000-4000-8000-000000000001','directory','{}')->>'revision')::bigint,
  (select revision from public.user_access_control_state where singleton), 'manager directory is served through the authorized RPC');
select is((public.user_access_command_v1('a9f10000-0000-4000-8000-000000000001','save_user_overrides',
  '{"username":"access_rep","permission_overrides":{"can_access_av":false}}',
  (select revision from public.user_access_control_state where singleton),
  'a9f10000-0000-4000-8000-000000000101')->'user'->'effective_permissions'->>'can_access_av','false',
  'manager override is reflected in the effective authorization response');
select is(public.user_access_command_v1('a9f10000-0000-4000-8000-000000000001','save_user_overrides',
  '{"username":"access_rep","permission_overrides":{"can_access_av":false}}',
  (select revision-1 from public.user_access_control_state where singleton),
  'a9f10000-0000-4000-8000-000000000101'),
  (select response from public.user_access_control_commands where command_id='a9f10000-0000-4000-8000-000000000101'),
  'same command ID and request replays its receipt after the global revision advances');
select throws_ok($$select public.user_access_command_v1('a9f10000-0000-4000-8000-000000000001','save_user_overrides',
  '{"username":"access_rep","permission_overrides":{"can_access_av":true}}',
  (select revision-1 from public.user_access_control_state where singleton),
  'a9f10000-0000-4000-8000-000000000102')$$,
  '40001','USER_ACCESS_REVISION_CONFLICT','stale access mutation is rejected');

select ok((select u.active from public.user_access_control u where u.profile_id='a9f10000-0000-4000-8000-000000000002'),
  'lock expiry is evaluated at resolve time instead of persisting inactive state');
update public.profiles set locked_until=statement_timestamp()+interval '1 hour' where id='a9f10000-0000-4000-8000-000000000002';
select throws_ok($$select public.user_access_command_v1('a9f10000-0000-4000-8000-000000000002','resolve','{}')$$,
  '42501','USER_ACCESS_ACTIVE_PROFILE_REQUIRED','currently locked profile cannot resolve permissions');
update public.profiles set locked_until=statement_timestamp()-interval '1 minute' where id='a9f10000-0000-4000-8000-000000000002';
select is((public.user_access_command_v1('a9f10000-0000-4000-8000-000000000002','resolve','{}')->'profile'->>'username'),
  'access_rep','profile becomes resolvable when lock expires without a manual reset');

insert into public.ph_master_inventory(unique_id,itemcode,season,priority)
values('user-access-direct-read-probe','ACCESS-PROBE','F1','P1') on conflict(unique_id) do nothing;
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,source,saleyear,ptronhand,ptravailable,s_lts,priority)
select 'USER-ACCESS-PLAN-'||g::text,'ACCESS'||lpad(g::text,5,'0'),'B.09.001','ACCESS-LOT-'||g::text,
  'ACCESS-PLAN','25','1','1','1','P1'
from generate_series(1,10000) g;
analyze public.ph_master_inventory;
do $inventory_plan$
declare plan_value jsonb;
begin
  execute $explain$explain (analyze, buffers, format json)
    select unique_id,itemcode from public.ph_master_inventory
    where unique_id='user-access-direct-read-probe'$explain into plan_value;
  update user_access_perf_evidence set payload=payload || jsonb_build_object(
    'representative_master_row_count',(select count(*) from public.ph_master_inventory),
    'representative_master_read_plan',plan_value);
end
$inventory_plan$;
select set_config('request.jwt.claim.sub','a9f10000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where unique_id='user-access-direct-read-probe'),1::bigint,
  'active REP with an allowed AV module can read shared inventory through authenticated PostgREST');
reset role;
select public.user_access_command_v1('a9f10000-0000-4000-8000-000000000001','save_user_overrides',
  '{"username":"access_rep","permission_overrides":{"can_access_drive_mode":false,"can_access_av":false,"can_access_que":false,"can_access_manager_tab":false,"can_submit_reclass":false}}',
  (select revision from public.user_access_control_state where singleton),
  'a9f10000-0000-4000-8000-000000000103');
select set_config('request.jwt.claim.sub','a9f10000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.ph_master_inventory where unique_id='user-access-direct-read-probe'),0::bigint,
  'canonical module revocation blocks direct authenticated inventory reads even when legacy role policy matches');
reset role;

select diag('V2311_PERFORMANCE_JSON='||(select payload::text from user_access_perf_evidence));
select * from finish();
rollback;
