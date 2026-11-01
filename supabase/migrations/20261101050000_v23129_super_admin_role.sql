begin;
set local lock_timeout='5s';
set local statement_timeout='45s';

alter table public.user_access add column if not exists submit_reclass text not null default 'N' check(submit_reclass in ('Y','N'));
alter table public.user_access add column if not exists complete_suspend_tag text not null default 'N' check(complete_suspend_tag in ('Y','N'));
alter table public.user_access add column if not exists manage_user_access text not null default 'N' check(manage_user_access in ('Y','N'));
alter table public.user_access add column if not exists use_weather_hold_risk_tools text not null default 'N' check(use_weather_hold_risk_tools in ('Y','N'));
alter table public.user_access add column if not exists use_aura_assistant text not null default 'N' check(use_aura_assistant in ('Y','N'));

-- Carry forward every currently authorized access manager before removing the username list.
update public.user_access u set manage_user_access='Y'
from public.profiles p
where p.id=u.profile_id and private.user_access_has_permission_v1(p.id,'can_manage_user_access');

alter table public.role_access_baselines drop constraint if exists role_access_baselines_role_check;
alter table public.role_access_baselines add constraint role_access_baselines_role_check check(role=any(array[
  'super_admin','admin','manager','supervisor','sales_rep','evaluator','counter','kier','dock_office',
  'qc_supervisor','csr','data_entry','foreman','grower','take_backs'
]));
alter table public.user_access_control drop constraint if exists user_access_control_canonical_role_check;
alter table public.user_access_control add constraint user_access_control_canonical_role_check check(canonical_role='' or canonical_role=any(array[
  'super_admin','admin','manager','supervisor','sales_rep','evaluator','counter','kier','dock_office',
  'qc_supervisor','csr','data_entry','foreman','grower','take_backs'
]));

create or replace function private.canonical_user_access_role_v1(p_role text)
returns text language sql immutable set search_path='' as $$
  select case regexp_replace(upper(btrim(coalesce(p_role,''))),'[^A-Z0-9]+','','g')
    when 'SUPERADMIN' then 'super_admin'
    when 'ADMIN' then 'admin' when 'ADMINISTRATOR' then 'admin'
    when 'MANAGER' then 'manager'
    when 'SUPERVISOR' then 'supervisor' when 'DATAENTRYSUPERVISOR' then 'supervisor'
    when 'REP' then 'sales_rep' when 'SALES' then 'sales_rep' when 'SALESREP' then 'sales_rep'
    when 'SALESUSER' then 'sales_rep' when 'SALESROLE' then 'sales_rep'
    when 'EVAL' then 'evaluator' when 'EVALUATOR' then 'evaluator' when 'EVALUATION' then 'evaluator'
    when 'QC' then 'counter' when 'COUNTER' then 'counter'
    when 'KIER' then 'kier'
    when 'DOCKOFFICE' then 'dock_office' when 'DOCK' then 'dock_office' when 'OFFICE' then 'dock_office'
    when 'QCSUPERVISOR' then 'qc_supervisor' when 'QCSUP' then 'qc_supervisor'
    when 'CSR' then 'csr' when 'CUSTOMERSERVICEREPRESENTATIVE' then 'csr'
    when 'DATAENTRY' then 'data_entry'
    when 'FOREMAN' then 'foreman' when 'GROWER' then 'grower'
    when 'TAKEBACK' then 'take_backs' when 'TAKEBACKS' then 'take_backs'
    else '' end
$$;

create or replace function private.protect_full_app_access_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare flag text;
begin
  if tg_table_name='role_access_baselines' then
    if new.role in ('super_admin','admin') then
      for flag in select jsonb_object_keys(new.permissions) loop
        new.permissions:=jsonb_set(new.permissions,array[flag],'true'::jsonb,true);
      end loop;
    end if;
    if new.role='admin' then
      new.permissions:=jsonb_set(new.permissions,'{can_manage_user_access}','false'::jsonb,true);
    end if;
  elsif new.canonical_role='super_admin' then
    new.active:=true;
    select jsonb_object_agg(key,true) into new.permission_overrides
    from jsonb_object_keys((select permissions from public.role_access_baselines where role='super_admin')) key;
  end if;
  return new;
end $$;
revoke all on function private.protect_full_app_access_v1() from public,anon,authenticated;

insert into public.role_access_baselines(role,permissions,matrix_permissions,revision,updated_at)
values('super_admin',
  '{"can_access_drive_mode":true,"can_access_av":true,"can_access_que":true,"can_access_manager_tab":true,"can_manage_user_access":true,"can_access_eval_reports_2":true,"can_submit_reclass":true,"can_complete_suspend_tag":true,"can_approve_deny_suspend":true}'::jsonb,
  jsonb_build_object(
    'make_request','Y','can_make_request','Y','request_all_reps','Y','edit_any_row','Y','can_edit_all_rows','Y',
    'edit_assigned_rows_only','Y','can_edit_assigned_items','Y','flyer_folder_access','Y','can_manage_flyers','Y',
    'create_project','Y','submit_reclass','Y','complete_suspend_tag','Y','approve_suspend_tags','Y','manage_tables','Y',
    'manage_user_access','Y','use_weather_hold_risk_tools','Y','use_aura_assistant','Y',
    'sales_rep_access',private.access_rep_roster_v23119(),'allowed_request_reps',private.access_rep_roster_v23119(),
    'view_permissions','{"view_drive_mode":"Y","view_av":"Y","view_que_request":"Y","view_que_suspend":"Y","view_docks":"Y","view_hl_order":"Y","view_sales":"Y","view_sales_office":"Y","view_historical_requests":"Y","view_managers":"Y","view_qc":"Y","view_office":"Y","view_inventory":"Y","view_production":"Y","view_bloom":"Y","view_flyers":"Y","view_comm":"Y","view_smart_moves":"Y","view_nursery_command_tables":"Y"}'::jsonb
  ),1,clock_timestamp())
on conflict(role) do update set permissions=excluded.permissions,matrix_permissions=excluded.matrix_permissions,
  revision=public.role_access_baselines.revision+1,updated_at=clock_timestamp();

update public.profiles set role='super-admin' where private.access_username_v23119(username)='dylan_collyge';
update public.ph_app_users set role='super-admin' where private.access_username_v23119(username)='dylan_collyge';

do $$
declare relation_name text; role_column text;
begin
  foreach relation_name in array array['company_directory','ph_company_directory'] loop
    if to_regclass('public.'||relation_name) is null then continue; end if;
    select column_name into role_column from information_schema.columns
    where table_schema='public' and table_name=relation_name and column_name in ('role','user_role','userrole')
    order by case column_name when 'role' then 1 when 'user_role' then 2 else 3 end limit 1;
    if role_column is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name=relation_name and column_name='username') then
      execute format('update public.%I set %I=%L where private.access_username_v23119(username)=%L',relation_name,role_column,'super-admin','dylan_collyge');
    end if;
  end loop;
end $$;

update public.user_access_control set canonical_role='super_admin',active=true,revision=revision+1,updated_at=clock_timestamp()
where username='dylan_collyge';
update public.user_access set role='super-admin',make_request='Y',can_make_request='Y',request_all_reps='Y',
  edit_any_row='Y',can_edit_all_rows='Y',edit_assigned_rows_only='Y',can_edit_assigned_items='Y',
  flyer_folder_access='Y',can_manage_flyers='Y',create_project='Y',submit_reclass='Y',complete_suspend_tag='Y',
  approve_suspend_tags='Y',manage_tables='Y',manage_user_access='Y',use_weather_hold_risk_tools='Y',use_aura_assistant='Y',
  sales_rep_access=private.access_rep_roster_v23119(),allowed_request_reps=private.access_rep_roster_v23119(),
  view_nursery_command_tables='Y',view_permissions='{"view_drive_mode":"Y","view_av":"Y","view_que_request":"Y","view_que_suspend":"Y","view_docks":"Y","view_hl_order":"Y","view_sales":"Y","view_sales_office":"Y","view_historical_requests":"Y","view_managers":"Y","view_qc":"Y","view_office":"Y","view_inventory":"Y","view_production":"Y","view_bloom":"Y","view_flyers":"Y","view_comm":"Y","view_smart_moves":"Y","view_nursery_command_tables":"Y"}'::jsonb,
  revision=revision+1,updated_at=clock_timestamp()
where username='dylan_collyge';

create or replace function private.is_full_app_administrator_v1(p_username text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1 from public.profiles p left join public.user_access u on u.profile_id=p.id
    where private.access_username_v23119(p.username)=private.access_username_v23119(p_username)
      and p.disabled_at is null and not p.must_change_password
      and (p.locked_until is null or p.locked_until<=statement_timestamp())
      and (private.canonical_user_access_role_v1(p.role)='super_admin' or u.manage_user_access='Y')
  ),false)
$$;
revoke all on function private.is_full_app_administrator_v1(text) from public,anon,authenticated;

create or replace function private.user_access_capability_v23129(p_profile_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.canonical_user_access_role_v1(p.role)='super_admin' or case p_permission
    when 'submit_reclass' then u.submit_reclass='Y'
    when 'complete_suspend_tag' then u.complete_suspend_tag='Y'
    when 'manage_user_access' then u.manage_user_access='Y'
    when 'use_weather_hold_risk_tools' then u.use_weather_hold_risk_tools='Y'
    when 'use_aura_assistant' then u.use_aura_assistant='Y'
    when 'view_nursery_command_tables' then u.view_nursery_command_tables='Y' and u.view_permissions->>p_permission='Y'
    else case when p_permission like 'view_%' then u.view_permissions->>p_permission='Y' else false end end,false)
  from public.profiles p join public.user_access u on u.profile_id=p.id
  where p.id=p_profile_id and p.disabled_at is null and not p.must_change_password
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
$$;
revoke all on function private.user_access_capability_v23129(uuid,text) from public,anon,authenticated;

create or replace function private.can_view_access_control_v2()
returns boolean language sql stable security definer set search_path='' as $$
  select private.user_access_capability_v23129((select auth.uid()),'manage_user_access')
$$;

create or replace function private.user_access_has_permission_v1(p_profile_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select case when not (b.permissions ? p_permission) then false
    when private.canonical_user_access_role_v1(p.role)='super_admin' then true
    when p_permission='can_manage_user_access' then m.manage_user_access='Y'
    else coalesce((private.user_access_effective_permissions_v1(b.permissions,u.permission_overrides)->>p_permission)::boolean,false) end
  from public.profiles p join public.user_access_control u on u.profile_id=p.id and u.active
  join public.role_access_baselines b on b.role=u.canonical_role
  join public.user_access m on m.profile_id=p.id
  where p.id=p_profile_id and p.disabled_at is null and not p.must_change_password
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users legacy where legacy.id=p.legacy_user_id
      and legacy.disabled_at is null and (legacy.locked_until is null or legacy.locked_until<=statement_timestamp())))
    and not private.scheduled_handover_cutoff_reached_v1(p.username,statement_timestamp())
$$;
revoke all on function private.user_access_has_permission_v1(uuid,text) from public,anon,authenticated;

create or replace function private.sync_nursery_capability_v23127() returns trigger language plpgsql set search_path='' as $$
begin
  if private.canonical_user_access_role_v1(new.role)='super_admin' then
    new.view_nursery_command_tables:='Y';
  elsif new.view_permissions ? 'view_nursery_command_tables' then
    new.view_nursery_command_tables:=new.view_permissions->>'view_nursery_command_tables';
  end if;
  new.view_permissions:=jsonb_set(coalesce(new.view_permissions,'{}'),'{view_nursery_command_tables}',to_jsonb(new.view_nursery_command_tables),true);
  return new;
end $$;

create or replace function public.save_user_access_matrix_v23119(p_actor_id uuid,p_username text,p_patch jsonb,p_command_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.user_access; prior private.user_access_matrix_commands_v23119; request jsonb:=jsonb_build_object('username',p_username,'patch',p_patch,'revision',p_expected_revision); result jsonb;
begin
  if not private.is_service_role_request() then raise exception 'USER_ACCESS_SERVICE_REQUIRED' using errcode='42501'; end if;
  select * into actor from public.profiles where id=p_actor_id and disabled_at is null and not must_change_password;
  if actor.id is null or not private.user_access_capability_v23129(actor.id,'manage_user_access') then raise exception 'USER_ACCESS_MANAGER_REQUIRED' using errcode='42501'; end if;
  if p_command_id is null or p_expected_revision is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>65536 or exists(
    select 1 from jsonb_object_keys(p_patch) k where k<>all(array['make_request','can_make_request','request_all_reps','edit_any_row','can_edit_all_rows','edit_assigned_rows_only','can_edit_assigned_items','flyer_folder_access','can_manage_flyers','create_project','submit_reclass','complete_suspend_tag','approve_suspend_tags','manage_tables','manage_user_access','use_weather_hold_risk_tools','use_aura_assistant','sales_rep_access','allowed_request_reps','view_permissions','view_nursery_command_tables'])
  ) then raise exception 'USER_ACCESS_MATRIX_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('access-matrix:'||p_actor_id||':'||p_command_id,0));
  select * into prior from private.user_access_matrix_commands_v23119 where actor_id=p_actor_id and command_id=p_command_id;
  if found then if prior.input<>request then raise exception 'USER_ACCESS_COMMAND_CONFLICT' using errcode='40001'; end if; return prior.response; end if;
  select * into target from public.user_access where username=private.access_username_v23119(p_username) for update;
  if not found then raise exception 'USER_ACCESS_TARGET_NOT_FOUND'; end if;
  if target.revision<>p_expected_revision then raise exception 'USER_ACCESS_REVISION_CONFLICT' using errcode='40001'; end if;
  update public.user_access set make_request=coalesce(p_patch->>'make_request',make_request),can_make_request=coalesce(p_patch->>'can_make_request',can_make_request),
    request_all_reps=coalesce(p_patch->>'request_all_reps',request_all_reps),edit_any_row=coalesce(p_patch->>'edit_any_row',edit_any_row),can_edit_all_rows=coalesce(p_patch->>'can_edit_all_rows',can_edit_all_rows),
    edit_assigned_rows_only=coalesce(p_patch->>'edit_assigned_rows_only',edit_assigned_rows_only),can_edit_assigned_items=coalesce(p_patch->>'can_edit_assigned_items',can_edit_assigned_items),
    flyer_folder_access=coalesce(p_patch->>'flyer_folder_access',flyer_folder_access),can_manage_flyers=coalesce(p_patch->>'can_manage_flyers',can_manage_flyers),create_project=coalesce(p_patch->>'create_project',create_project),
    submit_reclass=coalesce(p_patch->>'submit_reclass',submit_reclass),complete_suspend_tag=coalesce(p_patch->>'complete_suspend_tag',complete_suspend_tag),approve_suspend_tags=coalesce(p_patch->>'approve_suspend_tags',approve_suspend_tags),
    manage_tables=coalesce(p_patch->>'manage_tables',manage_tables),manage_user_access=coalesce(p_patch->>'manage_user_access',manage_user_access),use_weather_hold_risk_tools=coalesce(p_patch->>'use_weather_hold_risk_tools',use_weather_hold_risk_tools),
    use_aura_assistant=coalesce(p_patch->>'use_aura_assistant',use_aura_assistant),sales_rep_access=coalesce(p_patch->'sales_rep_access',p_patch->'allowed_request_reps',sales_rep_access),
    allowed_request_reps=coalesce(p_patch->'allowed_request_reps',p_patch->'sales_rep_access',allowed_request_reps),view_permissions=coalesce(p_patch->'view_permissions',view_permissions),
    view_nursery_command_tables=coalesce(p_patch->>'view_nursery_command_tables',view_nursery_command_tables),revision=revision+1
  where username=target.username returning * into target;
  result:=jsonb_build_object('ok',true,'matrix',to_jsonb(target));
  insert into private.user_access_matrix_commands_v23119 values(p_actor_id,p_command_id,request,result);
  return result;
end $$;
revoke all on function public.save_user_access_matrix_v23119(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.save_user_access_matrix_v23119(uuid,text,jsonb,uuid,bigint) to service_role;

create or replace function public.save_access_permission_v23127(p_actor_id uuid,p_mode text,p_target text,p_permission text,p_value text,p_command_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.user_access; baseline public.role_access_baselines; prior private.user_access_matrix_commands_v23119; input jsonb:=jsonb_build_object('mode',p_mode,'target',p_target,'permission',p_permission,'value',p_value,'revision',p_expected_revision); result jsonb; patch jsonb; legacy_key text; legacy_patch jsonb; role_key text; rev bigint; saved jsonb; matrices jsonb:='[]'; next_matrix jsonb; child_id uuid;
begin
  if not private.is_service_role_request() then raise exception 'USER_ACCESS_SERVICE_REQUIRED' using errcode='42501'; end if;
  select * into actor from public.profiles where id=p_actor_id and disabled_at is null and not must_change_password and (locked_until is null or locked_until<=now());
  if actor.id is null or not private.user_access_capability_v23129(actor.id,'manage_user_access') then raise exception 'USER_ACCESS_MANAGER_REQUIRED' using errcode='42501'; end if;
  if p_mode is null or p_target is null or btrim(p_target)='' or p_permission is null or p_value is null or p_mode not in ('role','user') or p_value not in ('Y','N') or p_command_id is null or p_expected_revision is null or p_expected_revision<0 or not (
    p_permission=any(array['make_request','request_all_reps','edit_any_row','edit_assigned_rows_only','flyer_folder_access','create_project','submit_reclass','complete_suspend_tag','approve_suspend_tags','manage_tables','manage_user_access','use_weather_hold_risk_tools','use_aura_assistant','legacy:can_submit_reclass','legacy:can_complete_suspend_tag','legacy:can_access_eval_reports_2','view_drive_mode','view_av','view_que_request','view_que_suspend','view_docks','view_hl_order','view_sales','view_sales_office','view_historical_requests','view_managers','view_qc','view_office','view_inventory','view_production','view_bloom','view_flyers','view_comm','view_smart_moves','view_nursery_command_tables']) or p_permission~'^rep:[a-z0-9_]{1,80}$'
  ) then raise exception 'USER_ACCESS_PERMISSION_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('permission:'||p_actor_id||':'||p_command_id,0));
  select * into prior from private.user_access_matrix_commands_v23119 where actor_id=p_actor_id and command_id=p_command_id;
  if found then if prior.input<>input then raise exception 'USER_ACCESS_COMMAND_CONFLICT' using errcode='40001'; end if; return prior.response; end if;
  select revision into rev from public.user_access_control_state where singleton for update;
  legacy_key:=case p_permission when 'view_drive_mode' then 'can_access_drive_mode' when 'view_av' then 'can_access_av' when 'view_managers' then 'can_access_manager_tab' when 'approve_suspend_tags' then 'can_approve_deny_suspend' when 'submit_reclass' then 'can_submit_reclass' when 'complete_suspend_tag' then 'can_complete_suspend_tag' when 'manage_user_access' then 'can_manage_user_access' else case when p_permission like 'legacy:%' then substring(p_permission from 8) end end;
  if p_mode='role' then
    role_key:=private.canonical_user_access_role_v1(p_target);
    select * into baseline from public.role_access_baselines where role=role_key for update;
    if not found then raise exception 'USER_ACCESS_ROLE_INVALID'; end if;
    if baseline.revision<>p_expected_revision then raise exception 'USER_ACCESS_REVISION_CONFLICT' using errcode='40001'; end if;
    next_matrix:=baseline.matrix_permissions;
    if p_permission like 'view_%' then next_matrix:=next_matrix||jsonb_build_object('view_permissions',coalesce(next_matrix->'view_permissions','{}')||jsonb_build_object(p_permission,p_value));
    elsif p_permission like 'rep:%' then next_matrix:=next_matrix||jsonb_build_object('request_all_reps','N','sales_rep_access',coalesce(next_matrix->'sales_rep_access','{}')||jsonb_build_object(substring(p_permission from 5),p_value));
    else next_matrix:=next_matrix||jsonb_build_object(p_permission,p_value); end if;
    if legacy_key is not null then saved:=public.user_access_command_v1(p_actor_id,'save_role_baseline',jsonb_build_object('role',role_key,'permissions',baseline.permissions||jsonb_build_object(legacy_key,p_value='Y')),rev,md5(p_command_id::text||':baseline')::uuid);
    else update public.role_access_baselines set revision=revision+1,updated_by_profile_id=p_actor_id,updated_at=clock_timestamp() where role=role_key; end if;
    update public.role_access_baselines set matrix_permissions=next_matrix where role=role_key;
  end if;
  for target in select * from public.user_access u where case when p_mode='role' then private.canonical_user_access_role_v1(u.role)=role_key else u.username=private.access_username_v23119(p_target) end order by u.username for update loop
    if p_mode='user' and target.revision<>p_expected_revision then raise exception 'USER_ACCESS_REVISION_CONFLICT' using errcode='40001'; end if;
    patch:='{}';
    if p_permission like 'view_%' then patch:=jsonb_build_object('view_permissions',target.view_permissions||jsonb_build_object(p_permission,p_value));
    elsif p_permission like 'rep:%' then patch:=jsonb_build_object('request_all_reps','N','sales_rep_access',target.sales_rep_access||jsonb_build_object(substring(p_permission from 5),p_value));
    elsif p_permission not like 'legacy:%' then patch:=jsonb_build_object(p_permission,p_value); end if;
    if p_permission='request_all_reps' then patch:=patch||jsonb_build_object('sales_rep_access',(select coalesce(jsonb_object_agg(k,p_value),'{}') from jsonb_object_keys(private.access_rep_roster_v23119()) k)); end if;
    saved:=public.save_user_access_matrix_v23119(p_actor_id,target.username,patch,md5(p_command_id::text||':matrix:'||target.username)::uuid,target.revision);
    matrices:=matrices||jsonb_build_array(saved->'matrix');
    if legacy_key is not null then
      select permission_overrides||jsonb_build_object(legacy_key,p_value='Y') into legacy_patch from public.user_access_control where profile_id=target.profile_id and active;
      if found then select revision into rev from public.user_access_control_state where singleton; saved:=public.user_access_command_v1(p_actor_id,'save_user_overrides',jsonb_build_object('username',target.username,'permission_overrides',legacy_patch),rev,md5(p_command_id::text||':legacy:'||target.username)::uuid); end if;
    end if;
  end loop;
  if p_mode='user' and jsonb_array_length(matrices)=0 then raise exception 'USER_ACCESS_TARGET_NOT_FOUND'; end if;
  result:=jsonb_build_object('ok',true,'matrixRows',matrices,'roleMatrices',(select jsonb_agg(jsonb_build_object('role',role,'revision',revision,'matrix',matrix_permissions)) from public.role_access_baselines),'directory',public.user_access_command_v1(p_actor_id,'directory','{}',null,null));
  insert into private.user_access_matrix_commands_v23119 values(p_actor_id,p_command_id,input,result);
  return result;
end $$;
revoke all on function public.save_access_permission_v23127(uuid,text,text,text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.save_access_permission_v23127(uuid,text,text,text,text,uuid,bigint) to service_role;

-- Preserve the mature AURA RPC bodies and replace only their literal owner gate.
do $$
declare definition text;
  role_gate text:=$old$actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR')$old$;
  context_role_gate text:=$old$upper(regexp_replace(coalesce(actor.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR')$old$;
  actor_gate text:=$old$actor.username<>'dylan_collyge'$old$;
  soc_actor_gate text:=$old$actor_name<>'dylan_collyge'$old$;
  capability_gate text:=$new$not private.user_access_capability_v23129(actor.id,'use_aura_assistant')$new$;
begin
  definition:=pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure);
  if position(role_gate in definition)>0 and position(actor_gate in definition)>0 then
    definition:=replace(replace(definition,role_gate,'true'),actor_gate,capability_gate); execute definition;
  elsif position(capability_gate in definition)=0 then raise exception 'AURA_ACCESS_GATE_CONTRACT_MISMATCH'; end if;
  definition:=pg_get_functiondef('public.aura_voice_context_v1()'::regprocedure);
  if position(context_role_gate in definition)>0 and position(actor_gate in definition)>0 then
    definition:=replace(replace(definition,context_role_gate,'true'),actor_gate,capability_gate); execute definition;
  elsif position(capability_gate in definition)=0 then raise exception 'AURA_CONTEXT_GATE_CONTRACT_MISMATCH'; end if;
  definition:=pg_get_functiondef('public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)'::regprocedure);
  if position(role_gate in definition)>0 and position(actor_gate in definition)>0 then
    definition:=replace(replace(definition,role_gate,'true'),actor_gate,capability_gate); execute definition;
  elsif position(capability_gate in definition)=0 then raise exception 'AURA_INVENTORY_GATE_CONTRACT_MISMATCH'; end if;
  definition:=pg_get_functiondef('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure);
  if position(role_gate in definition)>0 and position(soc_actor_gate in definition)>0 then
    definition:=replace(replace(definition,role_gate,'true'),soc_actor_gate,capability_gate);
    definition:=replace(definition,$old$actor_name='dylan_collyge'$old$,$new$private.is_full_app_administrator_v1(actor_name)$new$);
    if position('dylan_collyge' in definition)>0 then raise exception 'AURA_SOC_LITERAL_OWNER_GATE_REMAINS'; end if;
    execute definition;
  elsif position(capability_gate in definition)=0 or position('dylan_collyge' in definition)>0 then raise exception 'AURA_SOC_GATE_CONTRACT_MISMATCH'; end if;
end $$;

update public.user_access_control_state set revision=revision+1,updated_at=clock_timestamp() where singleton;

do $$
begin
  if (select count(*) from public.profiles where private.access_username_v23119(username)='dylan_collyge' and private.canonical_user_access_role_v1(role)='super_admin')<>1 then raise exception 'SUPER_ADMIN_PROFILE_SEED_FAILED'; end if;
  if not exists(select 1 from public.user_access where username='dylan_collyge' and manage_user_access='Y' and use_weather_hold_risk_tools='Y' and use_aura_assistant='Y' and view_nursery_command_tables='Y') then raise exception 'SUPER_ADMIN_MATRIX_SEED_FAILED'; end if;
  if not exists(select 1 from public.role_access_baselines where role='super_admin' and permissions->>'can_manage_user_access'='true' and matrix_permissions->>'manage_user_access'='Y') then raise exception 'SUPER_ADMIN_BASELINE_SEED_FAILED'; end if;
end $$;

commit;
