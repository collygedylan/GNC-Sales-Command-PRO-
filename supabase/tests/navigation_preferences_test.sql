begin;
create temporary table navigation_checks(description text);
create function pg_temp.nav_check(ok boolean,description text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Navigation: %',description; end if; insert into navigation_checks values(description); end $$;
create function pg_temp.nav_reject(actor uuid,op text,payload jsonb,revision bigint,expected text) returns void language plpgsql as $$
begin
  begin perform public.navigation_preferences_command_v1(actor,op,payload,gen_random_uuid(),revision); raise exception 'Expected %',expected;
  exception when others then if sqlerrm<>expected then raise; end if; end;
  perform pg_temp.nav_check(true,expected);
end $$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('97002000-0000-0000-0000-000000000001','navmanager@example.invalid','{}','{}'),
('97002000-0000-0000-0000-000000000002','navworker@example.invalid','{}','{}'),
('97002000-0000-0000-0000-000000000003','navdataentry@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
('97002000-0000-0000-0000-000000000001','nav_manager','Navigation manager','MANAGER',false),
('97002000-0000-0000-0000-000000000002','nav_worker','Navigation worker','GROWER',false),
('97002000-0000-0000-0000-000000000003','nav_dataentry','Navigation dataentry','DATAENTRY',false);
do $$
declare manager uuid:='97002000-0000-0000-0000-000000000001'; worker uuid:='97002000-0000-0000-0000-000000000002';
  dataentry uuid:='97002000-0000-0000-0000-000000000003'; command uuid:=gen_random_uuid(); result jsonb; payload jsonb;
begin
  perform pg_temp.nav_check(public.navigation_module_allowed_v1(worker,'production-workflow'),'existing Grower production access remains');
  perform pg_temp.nav_check(public.navigation_module_allowed_v1(dataentry,'production-workflow'),'existing Data Entry production access remains');
  perform pg_temp.nav_check(not public.navigation_module_allowed_v1(dataentry,'reports'),'new non-Manager Reports defaults denied');
  insert into private.navigation_reports_legacy(profile_id) values(dataentry);
  perform pg_temp.nav_check(public.navigation_module_allowed_v1(dataentry,'reports'),'grandfathered Reports user retained');
  perform pg_temp.nav_check(public.navigation_module_allowed_v1(manager,'reports'),'Manager Reports default allowed');
  perform pg_temp.nav_reject(worker,'users','{}',null,'NAVIGATION_MANAGER_REQUIRED');
  perform pg_temp.nav_reject(worker,'user_access',jsonb_build_object('profileId',manager),null,'NAVIGATION_MANAGER_REQUIRED');
  perform pg_temp.nav_reject(manager,'set_user_access',jsonb_build_object('profileId',worker,'changes',jsonb_build_array(jsonb_build_object('view','hl-order','allowed',true)),'reason','Request access'),0,'NAVIGATION_PROTECTED_CAPABILITY');
  payload:=jsonb_build_object('profileId',worker,'changes',jsonb_build_array(jsonb_build_object('view','docks','allowed',true)),'reason','Approved job navigation');
  result:=public.navigation_preferences_command_v1(manager,'set_user_access',payload,command,0);
  perform pg_temp.nav_check(public.navigation_module_allowed_v1(worker,'docks'),'Manager grant effective immediately');
  perform pg_temp.nav_check(result=public.navigation_preferences_command_v1(manager,'set_user_access',payload,command,0),'same command replay does not repeat audit or revision');
  perform pg_temp.nav_check((select count(*)=1 from private.navigation_change_events where actor_id=manager),'one audit event after replay');
  perform pg_temp.nav_reject(manager,'set_user_access',payload,0,'NAVIGATION_REVISION_CONFLICT');
  perform pg_temp.nav_reject(worker,'save_shortcuts','{"shortcuts":["docks","docks"]}',0,'NAVIGATION_SHORTCUT_NOT_ALLOWED');
  perform pg_temp.nav_reject(worker,'save_shortcuts','{"shortcuts":["home"]}',0,'NAVIGATION_SHORTCUT_NOT_ALLOWED');
  insert into public.ph_app_user_preferences(user_key,theme_mode,display_mode) values('nav_worker','dark','grid');
  result:=public.navigation_preferences_command_v1(worker,'save_shortcuts','{"shortcuts":["docks","tasks"]}',gen_random_uuid(),0);
  perform pg_temp.nav_check(result->'shortcuts'='["docks","tasks"]'::jsonb,'shortcut order retained');
  perform pg_temp.nav_check((select theme_mode='dark' and display_mode='grid' from public.ph_app_user_preferences where user_key='nav_worker'),'footer saves never overwrite theme');
  perform pg_temp.nav_reject(worker,'save_shortcuts','{"shortcuts":[]}',0,'NAVIGATION_REVISION_CONFLICT');
  perform public.navigation_preferences_command_v1(manager,'set_user_access',jsonb_build_object('profileId',worker,'changes',jsonb_build_array(jsonb_build_object('view','docks','allowed',false)),'reason','Assignment removed'),gen_random_uuid(),1);
  perform pg_temp.nav_check(not public.navigation_module_allowed_v1(worker,'docks'),'revocation immediately checked server-side');
  perform pg_temp.nav_reject(worker,'save_shortcuts','{"shortcuts":["docks"]}',1,'NAVIGATION_SHORTCUT_NOT_ALLOWED');
  update public.profiles set disabled_at=now() where id=worker;
  perform pg_temp.nav_check(not public.navigation_module_allowed_v1(worker,'production-workflow'),'disabled account loses module access');
  perform pg_temp.nav_reject(worker,'get','{}',null,'NAVIGATION_AUTH_REQUIRED');
  perform pg_temp.nav_check(not has_function_privilege('authenticated','public.navigation_preferences_command_v1(uuid,text,jsonb,uuid,bigint)','execute'),'client cannot submit another actor directly to command RPC');
  perform pg_temp.nav_check(not has_function_privilege('anon','public.navigation_module_allowed_v1(uuid,text)','execute'),'anonymous profile permission inspection denied');
  perform pg_temp.nav_check(not has_table_privilege('authenticated','private.navigation_view_overrides','select'),'other user overrides not directly readable');
end $$;
select count(*) as navigation_checks_passed from navigation_checks;
rollback;
