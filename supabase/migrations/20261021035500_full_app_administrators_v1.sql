begin;
-- Account ownership is resolved from authenticated profiles, never editable display names.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function private.is_full_app_administrator_v1(p_username text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(lower(btrim(p_username)) in ('dylan_collyge','megan_kelly','jd_jones'),false)
$$;
revoke all on function private.is_full_app_administrator_v1(text) from public,anon,authenticated;

create or replace function private.protect_full_app_access_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare flag text;
begin
  if tg_table_name='role_access_baselines' then
    if new.role='admin' then
      for flag in select jsonb_object_keys(new.permissions) loop
        new.permissions:=jsonb_set(new.permissions,array[flag],'true'::jsonb,true);
      end loop;
    end if;
    -- Management is an account grant, never an inheritable role grant.
    new.permissions:=jsonb_set(new.permissions,'{can_manage_user_access}','false'::jsonb,true);
  else
    if private.is_full_app_administrator_v1(new.username) then
      new.active:=true;
      new.canonical_role:='admin';
      select jsonb_object_agg(key,true) into new.permission_overrides
        from jsonb_object_keys((select permissions from public.role_access_baselines where role='admin')) key;
    else
      new.permission_overrides:=jsonb_set(new.permission_overrides,'{can_manage_user_access}','false'::jsonb,true);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.protect_full_app_access_v1() from public,anon,authenticated;
drop trigger if exists protect_full_app_role_baseline on public.role_access_baselines;
create trigger protect_full_app_role_baseline before insert or update on public.role_access_baselines
  for each row execute function private.protect_full_app_access_v1();
drop trigger if exists protect_full_app_user_access on public.user_access_control;
create trigger protect_full_app_user_access before insert or update on public.user_access_control
  for each row execute function private.protect_full_app_access_v1();

update public.role_access_baselines set permissions=permissions,revision=revision+1,updated_at=statement_timestamp();
update public.profiles set role='Admin'
  where private.is_full_app_administrator_v1(username) and role is distinct from 'Admin';
update public.user_access_control set permission_overrides=permission_overrides,revision=revision+1,updated_at=statement_timestamp();
update public.user_access_control_state set revision=revision+1,updated_at=statement_timestamp() where singleton;

create or replace function private.user_access_has_permission_v1(p_profile_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when not (b.permissions ? p_permission) then false
    when p_permission='can_manage_user_access' then private.is_full_app_administrator_v1(p.username)
    when private.is_full_app_administrator_v1(p.username) then true
    else coalesce((private.user_access_effective_permissions_v1(b.permissions,u.permission_overrides)->>p_permission)::boolean,false) end
  from public.profiles p join public.user_access_control u on u.profile_id=p.id and u.active
  join public.role_access_baselines b on b.role=u.canonical_role
  where p.id=p_profile_id and p.disabled_at is null and not p.must_change_password
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users legacy where legacy.id=p.legacy_user_id
      and legacy.disabled_at is null and (legacy.locked_until is null or legacy.locked_until<=statement_timestamp())))
    and not private.scheduled_handover_cutoff_reached_v1(p.username,statement_timestamp())
$$;
revoke all on function private.user_access_has_permission_v1(uuid,text) from public,anon,authenticated;

-- Keep the command's idempotent receipts and directory response consistent with
-- the enforced account grants, including a caller trying to uncheck its own flag.
do $$
declare definition text; original text;
begin
  original:=pg_get_functiondef('public.user_access_command_v1(uuid,text,jsonb,bigint,uuid)'::regprocedure);
  definition:=original;
  if position('if not private.is_full_app_administrator_v1(actor.username) or' in definition)=0 then
  definition:=replace(definition,
    'if coalesce((effective_value->>''can_manage_user_access'')::boolean,false) is not true then',
    'if not private.is_full_app_administrator_v1(actor.username) or coalesce((effective_value->>''can_manage_user_access'')::boolean,false) is not true then');
  if definition=original then raise exception 'FULL_APP_MANAGEMENT_GATE_NOT_FOUND'; end if;
  end if;
  original:=definition;
  if position('if private.is_full_app_administrator_v1(target.username) then' in definition)=0 then
  definition:=replace(definition,'previous_json:=target.permission_overrides;',
    'if private.is_full_app_administrator_v1(target.username) then
       select jsonb_object_agg(key,true) into overrides_value from unnest(expected_permissions) key;
     else
       overrides_value:=jsonb_set(overrides_value,''{can_manage_user_access}'',''false''::jsonb,true);
     end if;
     previous_json:=target.permission_overrides;');
  if definition=original then raise exception 'FULL_APP_OVERRIDE_GATE_NOT_FOUND'; end if;
  end if;
  execute definition;
end $$;

-- Every registered application capability uses the existing global scope for
-- these three profiles; disabled/locked accounts still fail the original gate.
create or replace function private.get_effective_app_permissions_v1(p_profile_id uuid,p_policy_id bigint)
returns table(permission_key text,permission_kind text,module_key text,label text,description text,
  scope_options text[],sort_order integer,allowed boolean,access_scope text,decision_source text)
language sql stable security definer set search_path = '' as $$
  with profile as (
    select p.id,private.normalized_profile_role(p.role) role_key,p.disabled_at,p.locked_until,
      p.must_change_password,private.is_full_app_administrator_v1(p.username) full_access
    from public.profiles p where p.id=p_profile_id limit 1
  )
  select perm.permission_key,perm.permission_kind,perm.module_key,perm.label,perm.description,perm.scope_options,perm.sort_order,
    case when profile.id is null or profile.disabled_at is not null or profile.must_change_password
      or (profile.locked_until is not null and profile.locked_until>now()) then false
      when profile.full_access then true else coalesce(u.allowed,r.allowed,false) end,
    case when profile.id is null or profile.disabled_at is not null or profile.must_change_password
      or (profile.locked_until is not null and profile.locked_until>now()) then null
      when profile.full_access then case when 'global'=any(perm.scope_options) then 'global' else null end
      when u.permission_key is not null then u.access_scope when r.permission_key is not null then r.access_scope else null end,
    case when profile.id is null or profile.disabled_at is not null or profile.must_change_password
      or (profile.locked_until is not null and profile.locked_until>now()) then 'default-deny'
      when profile.full_access then 'user' when u.permission_key is not null then 'user'
      when r.permission_key is not null then 'role' else 'default-deny' end
  from private.app_access_permissions perm left join profile on true
  left join private.app_access_role_grants r on r.policy_id=p_policy_id and r.role_key=profile.role_key and r.permission_key=perm.permission_key
  left join private.app_access_user_overrides u on u.policy_id=p_policy_id and u.profile_id=profile.id and u.permission_key=perm.permission_key
  where perm.active order by perm.sort_order,perm.permission_key
$$;
revoke all on function private.get_effective_app_permissions_v1(uuid,bigint) from public,anon,authenticated;

create or replace function private.can_manage_eval_assignments()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_full_app_administrator_v1((private.current_active_profile()).username)
$$;
create or replace function private.company_directory_is_dylan_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  with active as (select private.current_active_profile() as profile)
  select private.is_full_app_administrator_v1((profile).username)
    and not coalesce((profile).must_change_password,true) from active
$$;

create or replace function private.history_dylan_financial_v1(p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=p_actor
    and (private.is_full_app_administrator_v1(p.username)
      or exists(select 1 from private.request_financial_admins_v1 a where a.profile_id=p.id and a.active))
    and upper(regexp_replace(coalesce(p.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) in ('ADMIN','ADMINISTRATOR','SUPERADMIN')
    and p.disabled_at is null and not coalesce(p.must_change_password,true)
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and private.app_account_active_at_v1(p.id,p.username,statement_timestamp()))
$$;

-- Change only explicit actor authorization predicates, never recipients,
-- task ownership, actor attribution or workflow transition conditions.
do $$
declare entry record; definition text; checked integer:=0;
begin
  for entry in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_eval_work_v1','create_eval_work_batch_v1','reassign_eval_work_v1','cancel_eval_work_v1',
      'create_location_work_job_v1','update_location_work_job_v1','cancel_location_work_job_v1',
      'resolve_location_work_line_v1','retry_location_work_delivery_v1',
      'create_shear_location_inquiries_v1','cancel_shear_location_inquiry_v1','retry_shear_location_delivery_v1',
      'bunch_note_command_v1','bunch_note_workflow_command_v1')
  loop
    definition:=pg_get_functiondef(entry.oid);
    definition:=replace(definition,'lower(actor.username) not in (''dylan_collyge'', ''megan_kelly'')',
      'not private.is_full_app_administrator_v1(actor.username)');
    definition:=replace(definition,'actor.username <> ''dylan_collyge''','not private.is_full_app_administrator_v1(actor.username)');
    definition:=replace(definition,'actor.username=''dylan_collyge''','private.is_full_app_administrator_v1(actor.username)');
    if position('private.is_full_app_administrator_v1(actor.username)' in definition)=0 then
      raise exception 'FULL_APP_OPERATION_GATE_NOT_FOUND: %',entry.oid::regprocedure;
    end if;
    execute definition;
    checked:=checked+1;
  end loop;
  if checked<>14 then raise exception 'FULL_APP_OPERATION_SET_INCOMPLETE: %',checked; end if;
end $$;

do $$
declare entry record; definition text;
begin
  for entry in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='suspend_tag_private' and p.proname in ('command','can_edit')
  loop
    definition:=pg_get_functiondef(entry.oid);
    definition:=replace(definition,'''dylan_collyge'',''megan_kelly'',''dan_mccuistion''',
      '''dylan_collyge'',''megan_kelly'',''jd_jones'',''dan_mccuistion''');
    definition:=replace(definition,'a.rep_id<>actor.id then raise exception ''SUSPEND_TAG_FORBIDDEN''',
      '(a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)) then raise exception ''SUSPEND_TAG_FORBIDDEN''');
    definition:=replace(definition,'''canDecide'',a.rep_id=actor.id and a.status=''pending''',
      '''canDecide'',(a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) and a.status=''pending''');
    if position('''dylan_collyge'',''megan_kelly'',''jd_jones'',''dan_mccuistion''' in definition)=0 then
      raise exception 'FULL_APP_SUSPEND_GATE_NOT_FOUND';
    end if;
    execute definition;
  end loop;
end $$;

-- Eval 1 has a separate historical account gate. Include JD without changing
-- classification, source publication proof or mutation source checks.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure);
  definition:=replace(definition,'in (''dylan_collyge'',''megan_kelly'')','in (''dylan_collyge'',''megan_kelly'',''jd_jones'')');
  execute definition;
end $$;

-- Repair the current router capability contract for the designated admins.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure);
  if position('''auraEnabled''' in definition)=0 then
    definition:=replace(definition,'''capabilities'',jsonb_build_object(''inventory''',
      '''capabilities'',jsonb_build_object(''auraEnabled'',true,''inventory''');
    if position('''auraEnabled''' in definition)=0 then raise exception 'FULL_APP_AURA_CAPABILITY_ANCHOR_MISSING'; end if;
  end if;
  execute definition;
end $$;

do $$
begin
  if (select count(*) from public.user_access_control where username in ('dylan_collyge','megan_kelly','jd_jones')
    and active and canonical_role='admin' and not exists(select 1 from jsonb_each(permission_overrides) f where f.value<>'true'::jsonb))<>3
    then raise exception 'FULL_APP_ADMINISTRATOR_ASSERTION_FAILED'; end if;
  if exists(select 1 from public.user_access_control where not private.is_full_app_administrator_v1(username)
    and permission_overrides->'can_manage_user_access' is distinct from 'false'::jsonb)
    then raise exception 'FULL_APP_MANAGEMENT_EXCLUSIVITY_FAILED'; end if;
end $$;
commit;
