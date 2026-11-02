begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Request display scope only: preserve all mutation, credential and delivery grants.
do $backfill$ begin
if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='user_access' and column_name='view_all_requests') then
alter table public.user_access add column view_all_requests text not null default 'N' check (view_all_requests in ('Y','N'));
update public.user_access set view_all_requests=case
 when private.access_username_v23119(username) in ('dylan_collyge','nelly_aguilar','jd_jones','megan_kelly','morgan_anderson','kayla_knapp','mitch_kaiser','melissa_dowty')
   or private.canonical_user_access_role_v1(role) in ('super_admin','admin','manager','csr','sales_rep') then 'Y' else 'N' end,
 revision=revision+1,updated_at=clock_timestamp();
end if;
end $backfill$;
update public.role_access_baselines set matrix_permissions=matrix_permissions||jsonb_build_object('view_all_requests',
 case when private.canonical_user_access_role_v1(role) in ('super_admin','admin','manager','csr','sales_rep') then 'Y' else 'N' end),revision=revision+1,updated_at=clock_timestamp() where not (matrix_permissions ? 'view_all_requests');

CREATE OR REPLACE FUNCTION public.save_user_access_matrix_v23119(p_actor_id uuid, p_username text, p_patch jsonb, p_command_id uuid, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; target public.user_access; prior private.user_access_matrix_commands_v23119; request jsonb:=jsonb_build_object('username',p_username,'patch',p_patch,'revision',p_expected_revision); result jsonb;
begin
  if not private.is_service_role_request() then raise exception 'USER_ACCESS_SERVICE_REQUIRED' using errcode='42501'; end if;
  select * into actor from public.profiles where id=p_actor_id and disabled_at is null and not must_change_password;
  if actor.id is null or not private.user_access_capability_v23129(actor.id,'manage_user_access') then raise exception 'USER_ACCESS_MANAGER_REQUIRED' using errcode='42501'; end if;
  if p_command_id is null or p_expected_revision is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>65536 or exists(
    select 1 from jsonb_object_keys(p_patch) k where k<>all(array['make_request','can_make_request','request_all_reps','view_all_requests','edit_any_row','can_edit_all_rows','edit_assigned_rows_only','can_edit_assigned_items','flyer_folder_access','can_manage_flyers','create_project','submit_reclass','complete_suspend_tag','approve_suspend_tags','manage_tables','manage_user_access','use_weather_hold_risk_tools','use_aura_assistant','sales_rep_access','allowed_request_reps','view_permissions','view_nursery_command_tables'])
  ) then raise exception 'USER_ACCESS_MATRIX_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('access-matrix:'||p_actor_id||':'||p_command_id,0));
  select * into prior from private.user_access_matrix_commands_v23119 where actor_id=p_actor_id and command_id=p_command_id;
  if found then if prior.input<>request then raise exception 'USER_ACCESS_COMMAND_CONFLICT' using errcode='40001'; end if; return prior.response; end if;
  select * into target from public.user_access where username=private.access_username_v23119(p_username) for update;
  if not found then raise exception 'USER_ACCESS_TARGET_NOT_FOUND'; end if;
  if target.revision<>p_expected_revision then raise exception 'USER_ACCESS_REVISION_CONFLICT' using errcode='40001'; end if;
  update public.user_access set make_request=coalesce(p_patch->>'make_request',make_request),can_make_request=coalesce(p_patch->>'can_make_request',can_make_request),
    request_all_reps=coalesce(p_patch->>'request_all_reps',request_all_reps),view_all_requests=coalesce(p_patch->>'view_all_requests',view_all_requests),edit_any_row=coalesce(p_patch->>'edit_any_row',edit_any_row),can_edit_all_rows=coalesce(p_patch->>'can_edit_all_rows',can_edit_all_rows),
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
end $function$
;
CREATE OR REPLACE FUNCTION public.save_access_permission_v23127(p_actor_id uuid, p_mode text, p_target text, p_permission text, p_value text, p_command_id uuid, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; target public.user_access; baseline public.role_access_baselines; prior private.user_access_matrix_commands_v23119; input jsonb:=jsonb_build_object('mode',p_mode,'target',p_target,'permission',p_permission,'value',p_value,'revision',p_expected_revision); result jsonb; patch jsonb; legacy_key text; legacy_patch jsonb; role_key text; rev bigint; saved jsonb; matrices jsonb:='[]'; next_matrix jsonb; child_id uuid;
begin
  if not private.is_service_role_request() then raise exception 'USER_ACCESS_SERVICE_REQUIRED' using errcode='42501'; end if;
  select * into actor from public.profiles where id=p_actor_id and disabled_at is null and not must_change_password and (locked_until is null or locked_until<=now());
  if actor.id is null or not private.user_access_capability_v23129(actor.id,'manage_user_access') then raise exception 'USER_ACCESS_MANAGER_REQUIRED' using errcode='42501'; end if;
  if p_mode is null or p_target is null or btrim(p_target)='' or p_permission is null or p_value is null or p_mode not in ('role','user') or p_value not in ('Y','N') or p_command_id is null or p_expected_revision is null or p_expected_revision<0 or not (
    p_permission=any(array['make_request','request_all_reps','view_all_requests','edit_any_row','edit_assigned_rows_only','flyer_folder_access','create_project','submit_reclass','complete_suspend_tag','approve_suspend_tags','manage_tables','manage_user_access','use_weather_hold_risk_tools','use_aura_assistant','legacy:can_submit_reclass','legacy:can_complete_suspend_tag','legacy:can_access_eval_reports_2','view_drive_mode','view_av','view_que_request','view_que_suspend','view_docks','view_hl_order','view_sales','view_sales_office','view_historical_requests','view_managers','view_qc','view_office','view_inventory','view_production','view_bloom','view_flyers','view_comm','view_smart_moves','view_nursery_command_tables']) or p_permission~'^rep:[a-z0-9_]{1,80}$'
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
    if p_permission like 'view_%' and p_permission<>'view_all_requests' then next_matrix:=next_matrix||jsonb_build_object('view_permissions',coalesce(next_matrix->'view_permissions','{}')||jsonb_build_object(p_permission,p_value));
    elsif p_permission like 'rep:%' then next_matrix:=next_matrix||jsonb_build_object('request_all_reps','N','sales_rep_access',coalesce(next_matrix->'sales_rep_access','{}')||jsonb_build_object(substring(p_permission from 5),p_value));
    else next_matrix:=next_matrix||jsonb_build_object(p_permission,p_value); end if;
    if legacy_key is not null then saved:=public.user_access_command_v1(p_actor_id,'save_role_baseline',jsonb_build_object('role',role_key,'permissions',baseline.permissions||jsonb_build_object(legacy_key,p_value='Y')),rev,md5(p_command_id::text||':baseline')::uuid);
    else update public.role_access_baselines set revision=revision+1,updated_by_profile_id=p_actor_id,updated_at=clock_timestamp() where role=role_key; end if;
    update public.role_access_baselines set matrix_permissions=next_matrix where role=role_key;
  end if;
  for target in select * from public.user_access u where case when p_mode='role' then private.canonical_user_access_role_v1(u.role)=role_key else u.username=private.access_username_v23119(p_target) end order by u.username for update loop
    if p_mode='user' and target.revision<>p_expected_revision then raise exception 'USER_ACCESS_REVISION_CONFLICT' using errcode='40001'; end if;
    patch:='{}';
    if p_permission like 'view_%' and p_permission<>'view_all_requests' then patch:=jsonb_build_object('view_permissions',target.view_permissions||jsonb_build_object(p_permission,p_value));
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
end $function$
;
CREATE OR REPLACE FUNCTION public.get_request_capabilities()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  profile public.profiles%rowtype;
  username_key text;
  role_key text;
  global_access boolean;
  save_access boolean;
  general_create_access boolean;
  av_create_access boolean;
  request_scope text;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;

  username_key := lower(btrim(coalesce(profile.username, '')));
  if username_key in ('nally_aguilar','nelly_aguliar') then username_key := 'nelly_aguilar'; end if;
  role_key := private.normalized_profile_role(profile.role);
  global_access := private.can_manage_requests();
  save_access := private.can_save_request_work();
  general_create_access := private.can_create_general_requests();
  av_create_access := private.can_create_av_requests();

  request_scope := case
    when role_key in ('SUPERADMIN','SUPER_ADMIN','SUPER-ADMIN')
      or username_key in ('dylan_collyge','nelly_aguilar','jd_jones')
      or exists(select 1 from public.user_access u where u.username=private.access_username_v23119(profile.username) and u.view_all_requests='Y') then 'global'
    else 'assigned'
  end;

  return jsonb_build_object(
    'contract_version', 2,
    'username', username_key,
    'scope', request_scope,
    'can_create_general', general_create_access,
    'can_create_av', av_create_access,
    'can_view_queue', true,
    'can_take_photo', save_access,
    'can_edit', save_access,
    'can_complete', save_access,
    'can_archive', global_access
  );
end;
$function$
;

-- The existing direct operational SELECT policies remain intact (READY/LKG); no grants widen.
notify pgrst,'reload schema';
commit;
