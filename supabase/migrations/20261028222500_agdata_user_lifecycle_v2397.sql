begin;
-- Keep User & Role Access deactivation inside the canonical, service-only
-- command boundary. The credential value is deliberately handled only by
-- auth-admin and is never returned by a read command.
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create or replace function public.sync_native_auth_app_access_code_v2397(
  p_username text, p_access_code text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(coalesce(p_username,'')));
  v_profile public.profiles%rowtype;
begin
  if v_username = '' or length(coalesce(p_access_code,'')) < 8 then
    raise exception using errcode='22023',message='USER_ACCESS_CODE_INVALID';
  end if;
  select * into v_profile from public.profiles p where p.username=v_username and p.disabled_at is null for update;
  if v_profile.id is null or v_profile.legacy_user_id is null then
    raise exception using errcode='P0002',message='USER_ACCESS_TARGET_NOT_FOUND';
  end if;
  update public.ph_app_users set password=p_access_code,password_hash=null,password_salt=null,
    password_changed_at=null,must_change_password=true,failed_login_count=0,locked_until=null
  where id=v_profile.legacy_user_id and disabled_at is null;
  if not found then raise exception using errcode='P0002',message='USER_ACCESS_LEGACY_TARGET_NOT_FOUND'; end if;
  update public.profiles set must_change_password=true,updated_at=statement_timestamp() where id=v_profile.id;
  return jsonb_build_object('ok',true,'username',v_username,'must_change_password',true);
end $$;
revoke all on function public.sync_native_auth_app_access_code_v2397(text,text) from public,anon,authenticated;
grant execute on function public.sync_native_auth_app_access_code_v2397(text,text) to service_role;

create or replace function public.deactivate_user_access_v2397(
  p_actor_profile_id uuid, p_username text, p_command_id uuid, p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_access public.user_access_control%rowtype;
  v_state public.user_access_control_state%rowtype;
  v_username text:=lower(btrim(coalesce(p_username,'')));
  v_admin_count integer;
  v_response jsonb;
begin
  select * into v_actor from public.profiles p where p.id=p_actor_profile_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until<=statement_timestamp()) and not p.must_change_password
    and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users l where l.id=p.legacy_user_id
      and l.disabled_at is null and (l.locked_until is null or l.locked_until<=statement_timestamp()))) for share;
  if v_actor.id is null or not private.is_full_app_administrator_v1(v_actor.username)
     or not private.user_access_has_permission_v1(v_actor.id,'can_manage_user_access') then
    raise exception using errcode='42501',message='USER_ACCESS_MANAGER_REQUIRED';
  end if;
  if v_username='' then raise exception using errcode='22023',message='USER_ACCESS_USERNAME_REQUIRED'; end if;
  select * into v_state from public.user_access_control_state where singleton for update;
  if p_command_id is null or p_expected_revision is null then
    raise exception using errcode='22023',message='USER_ACCESS_COMMAND_REQUIRED';
  end if;
  select c.response into v_response from public.user_access_control_commands c
    where c.command_id=p_command_id and c.actor_profile_id=v_actor.id and c.operation='deactivate_user'
      and c.request_hash=md5('deactivate_user:'||v_username||':'||p_expected_revision::text);
  if v_response is not null then return v_response; end if;
  if exists(select 1 from public.user_access_control_commands c where c.command_id=p_command_id) then
    raise exception using errcode='23505',message='USER_ACCESS_COMMAND_CONFLICT';
  end if;
  if p_expected_revision<>v_state.revision then
    raise exception using errcode='40001',message='USER_ACCESS_REVISION_CONFLICT';
  end if;
  select * into v_target from public.profiles p where p.username=v_username for update;
  select * into v_access from public.user_access_control u where u.profile_id=v_target.id for update;
  if v_target.id is null or v_access.id is null or not v_access.active then
    raise exception using errcode='P0002',message='USER_ACCESS_TARGET_NOT_FOUND';
  end if;
  if v_target.id=v_actor.id then raise exception using errcode='42501',message='USER_ACCESS_SELF_DEACTIVATION_FORBIDDEN'; end if;
  if private.is_full_app_administrator_v1(v_target.username) then
    select count(*) into v_admin_count from public.profiles p join public.user_access_control u on u.profile_id=p.id and u.active
      where p.disabled_at is null
        and (p.locked_until is null or p.locked_until<=statement_timestamp()) and not p.must_change_password
        and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users l where l.id=p.legacy_user_id
          and l.disabled_at is null and (l.locked_until is null or l.locked_until<=statement_timestamp())))
        and private.is_full_app_administrator_v1(p.username)
        and private.user_access_has_permission_v1(p.id,'can_manage_user_access');
    if v_admin_count<=1 then raise exception using errcode='42501',message='USER_ACCESS_LAST_ADMIN_FORBIDDEN'; end if;
  end if;
  update public.user_access_control set active=false,revision=revision+1,updated_at=statement_timestamp() where id=v_access.id;
  update public.profiles set disabled_at=statement_timestamp(),updated_at=statement_timestamp() where id=v_target.id;
  if v_target.legacy_user_id is not null then update public.ph_app_users set disabled_at=statement_timestamp() where id=v_target.legacy_user_id; end if;
  update public.user_access_control_state set revision=revision+1,updated_at=statement_timestamp()
    where singleton returning * into v_state;
  v_response:=jsonb_build_object('ok',true,'username',v_username,'active',false,'revision',v_state.revision);
  insert into public.user_access_control_commands(command_id,actor_profile_id,operation,request_hash,response)
    values(p_command_id,v_actor.id,'deactivate_user',md5('deactivate_user:'||v_username||':'||p_expected_revision::text),v_response);
  insert into public.user_access_control_audit(actor_profile_id,target_type,target_key,previous_value,next_value,revision,command_id)
    values(v_actor.id,'user',v_username,jsonb_build_object('active',true),jsonb_build_object('active',false),v_state.revision,p_command_id);
  return v_response;
end $$;
revoke all on function public.deactivate_user_access_v2397(uuid,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.deactivate_user_access_v2397(uuid,text,uuid,bigint) to service_role;

create or replace function public.update_user_access_profile_v2397(
  p_actor_profile_id uuid, p_username text, p_display_name text, p_role text,
  p_command_id uuid, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_access public.user_access_control%rowtype;
  v_state public.user_access_control_state%rowtype;
  v_username text:=lower(btrim(coalesce(p_username,'')));
  v_display_name text:=btrim(coalesce(p_display_name,''));
  v_role_key text:=private.canonical_user_access_role_v1(p_role);
  v_role text;
  v_request_hash text;
  v_response jsonb;
  v_previous jsonb;
begin
  v_role:=case v_role_key
    when 'admin' then 'Admin' when 'manager' then 'Manager' when 'supervisor' then 'Supervisor'
    when 'sales_rep' then 'Sales Rep' when 'evaluator' then 'Evaluator' when 'counter' then 'QC'
    when 'kier' then 'Kier' when 'dock_office' then 'Dock Office' when 'qc_supervisor' then 'QC Supervisor'
    when 'csr' then 'CSR' when 'data_entry' then 'Data Entry' when 'foreman' then 'Foreman'
    when 'grower' then 'Grower' when 'take_backs' then 'Take Backs' else null end;
  if v_username='' or v_display_name='' or length(v_display_name)>120 or v_role is null then
    raise exception using errcode='22023',message='USER_ACCESS_PROFILE_INVALID';
  end if;
  if p_command_id is null or p_expected_revision is null then
    raise exception using errcode='22023',message='USER_ACCESS_COMMAND_REQUIRED';
  end if;
  select * into v_actor from public.profiles p where p.id=p_actor_profile_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until<=statement_timestamp()) and not p.must_change_password
    and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users l where l.id=p.legacy_user_id
      and l.disabled_at is null and (l.locked_until is null or l.locked_until<=statement_timestamp()))) for share;
  if v_actor.id is null or not private.is_full_app_administrator_v1(v_actor.username)
    or not private.user_access_has_permission_v1(v_actor.id,'can_manage_user_access') then
    raise exception using errcode='42501',message='USER_ACCESS_MANAGER_REQUIRED';
  end if;
  select * into v_state from public.user_access_control_state where singleton for update;
  v_request_hash:=md5('update_user_profile:'||v_username||':'||v_display_name||':'||v_role||':'||p_expected_revision::text);
  select c.response into v_response from public.user_access_control_commands c where c.command_id=p_command_id
    and c.actor_profile_id=v_actor.id and c.operation='update_user_profile' and c.request_hash=v_request_hash;
  if v_response is not null then return v_response; end if;
  if exists(select 1 from public.user_access_control_commands c where c.command_id=p_command_id) then
    raise exception using errcode='23505',message='USER_ACCESS_COMMAND_CONFLICT';
  end if;
  if p_expected_revision<>v_state.revision then raise exception using errcode='40001',message='USER_ACCESS_REVISION_CONFLICT'; end if;
  select * into v_target from public.profiles p where p.username=v_username for update;
  select * into v_access from public.user_access_control u where u.profile_id=v_target.id for update;
  if v_target.id is null or v_access.id is null or not v_access.active or v_target.disabled_at is not null then
    raise exception using errcode='P0002',message='USER_ACCESS_TARGET_NOT_FOUND';
  end if;
  if private.is_full_app_administrator_v1(v_target.username)
    and private.canonical_user_access_role_v1(v_target.role)<>v_role_key then
    raise exception using errcode='42501',message='USER_ACCESS_ADMIN_ROLE_IMMUTABLE';
  end if;
  v_previous:=jsonb_build_object('display_name',v_target.display_name,'role',v_target.role);
  update public.profiles set display_name=v_display_name,role=v_role,updated_at=statement_timestamp() where id=v_target.id;
  if v_target.legacy_user_id is not null then
    update public.ph_app_users set role=v_role where id=v_target.legacy_user_id and disabled_at is null;
    if not found then raise exception using errcode='P0002',message='USER_ACCESS_LEGACY_TARGET_NOT_FOUND'; end if;
  end if;
  update public.user_access_control_state set revision=revision+1,updated_at=statement_timestamp()
    where singleton returning * into v_state;
  v_response:=jsonb_build_object('ok',true,'username',v_username,'display_name',v_display_name,'role',v_role,'revision',v_state.revision);
  insert into public.user_access_control_commands(command_id,actor_profile_id,operation,request_hash,response)
    values(p_command_id,v_actor.id,'update_user_profile',v_request_hash,v_response);
  insert into public.user_access_control_audit(actor_profile_id,target_type,target_key,previous_value,next_value,revision,command_id)
    values(v_actor.id,'user',v_username,v_previous,jsonb_build_object('display_name',v_display_name,'role',v_role),v_state.revision,p_command_id);
  return v_response;
end $$;
revoke all on function public.update_user_access_profile_v2397(uuid,text,text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.update_user_access_profile_v2397(uuid,text,text,text,uuid,bigint) to service_role;
commit;
