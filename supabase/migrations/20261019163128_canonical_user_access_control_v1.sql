-- Canonical nine-flag access model. Access is resolved only by app-api after
-- it has verified an active native profile; browser roles/local storage are
-- display hints and never authorize a request.
create or replace function private.user_access_permission_flags_valid_v1(p_value jsonb,p_allow_nulls boolean default false)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item record; flag_count integer;
begin
  if coalesce(jsonb_typeof(p_value),'')<>'object' then return false; end if;
  select count(*) into flag_count from jsonb_object_keys(p_value);
  if flag_count<>9 then return false; end if;
  for item in select key,value from jsonb_each(p_value) loop
    if item.key <> all(array[
      'can_access_drive_mode','can_access_av','can_access_que','can_access_manager_tab',
      'can_manage_user_access','can_access_eval_reports_2','can_submit_reclass',
      'can_complete_suspend_tag','can_approve_deny_suspend'
    ]) then return false; end if;
    if p_allow_nulls then
      if jsonb_typeof(item.value) not in ('boolean','null') then return false; end if;
    elsif jsonb_typeof(item.value)<>'boolean' then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end
$$;
create or replace function private.user_access_effective_permissions_v1(p_baseline jsonb,p_overrides jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb:=coalesce(p_baseline,'{}'::jsonb); k text;
begin
  for k in select jsonb_object_keys(coalesce(p_baseline,'{}'::jsonb)) loop
    if coalesce(p_overrides,'{}'::jsonb) ? k and jsonb_typeof(p_overrides->k)='boolean' then result:=jsonb_set(result,array[k],p_overrides->k,true); end if;
  end loop;
  return result;
end $$;
create or replace function private.user_access_overrides_valid_v1(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item record;
begin
  if coalesce(jsonb_typeof(p_value),'')<>'object' then return false; end if;
  for item in select key,value from jsonb_each(p_value) loop
    if item.key <> all(array[
      'can_access_drive_mode','can_access_av','can_access_que','can_access_manager_tab',
      'can_manage_user_access','can_access_eval_reports_2','can_submit_reclass',
      'can_complete_suspend_tag','can_approve_deny_suspend'
    ]) or jsonb_typeof(item.value) not in ('boolean','null') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create table if not exists public.user_access_control_state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default statement_timestamp()
);
insert into public.user_access_control_state(singleton, revision)
values (true, 1) on conflict (singleton) do nothing;

create table if not exists public.role_access_baselines (
  role text primary key check (role = any(array[
    'admin','manager','supervisor','sales_rep','evaluator','counter','kier','dock_office',
    'qc_supervisor','csr','data_entry','foreman','grower','take_backs'
  ])),
  permissions jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default statement_timestamp(),
  constraint role_access_baselines_permission_shape check (
    private.user_access_permission_flags_valid_v1(permissions,false)
  )
);

create table if not exists public.user_access_control (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete cascade,
  username text not null unique check (username = lower(btrim(username)) and username <> ''),
  display_name text not null default '',
  canonical_role text not null default '' check (canonical_role = '' or canonical_role = any(array[
    'admin','manager','supervisor','sales_rep','evaluator','counter','kier','dock_office',
    'qc_supervisor','csr','data_entry','foreman','grower','take_backs'
  ])),
  email text,
  salesrep_id text,
  salesrep_match_names text[] not null default '{}',
  permission_overrides jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint user_access_control_override_shape check (
    private.user_access_overrides_valid_v1(permission_overrides)
  ),
  constraint user_access_control_profile_link check (profile_id is not null or active=false),
  constraint user_access_control_override_keys check (private.user_access_permission_flags_valid_v1(
    coalesce(permission_overrides,'{}'::jsonb) || jsonb_build_object('can_access_drive_mode',coalesce(permission_overrides->'can_access_drive_mode','null'::jsonb),
      'can_access_av',coalesce(permission_overrides->'can_access_av','null'::jsonb),'can_access_que',coalesce(permission_overrides->'can_access_que','null'::jsonb),
      'can_access_manager_tab',coalesce(permission_overrides->'can_access_manager_tab','null'::jsonb),'can_manage_user_access',coalesce(permission_overrides->'can_manage_user_access','null'::jsonb),
      'can_access_eval_reports_2',coalesce(permission_overrides->'can_access_eval_reports_2','null'::jsonb),'can_submit_reclass',coalesce(permission_overrides->'can_submit_reclass','null'::jsonb),
      'can_complete_suspend_tag',coalesce(permission_overrides->'can_complete_suspend_tag','null'::jsonb),'can_approve_deny_suspend',coalesce(permission_overrides->'can_approve_deny_suspend','null'::jsonb)),true))
);
create index if not exists user_access_control_directory_idx
  on public.user_access_control(active, canonical_role, username);

create table if not exists public.user_access_control_commands (
  command_id uuid primary key,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default statement_timestamp()
);
create table if not exists public.user_access_control_audit (
  id bigint generated always as identity primary key,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (target_type in ('role','user')),
  target_key text not null,
  previous_value jsonb,
  next_value jsonb not null,
  revision bigint not null,
  command_id uuid not null unique references public.user_access_control_commands(command_id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);

create or replace function private.canonical_user_access_role_v1(p_role text)
returns text language sql immutable set search_path = '' as $$
  select case regexp_replace(upper(btrim(coalesce(p_role,''))), '[^A-Z0-9]+', '', 'g')
    when 'ADMIN' then 'admin' when 'ADMINISTRATOR' then 'admin' when 'SUPERADMIN' then 'admin'
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

-- Preserve current explicit module visibility. Unknown roles are unmapped and
-- therefore receive no permissions. Special action access starts closed and
-- is seeded below only for the existing specifically authorized users.
insert into public.role_access_baselines(role, permissions) values
('admin', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',true,'can_manage_user_access',true,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('manager', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',true,'can_manage_user_access',true,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('supervisor', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('sales_rep', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',false,'can_complete_suspend_tag',false,'can_approve_deny_suspend',true)),
('evaluator', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('counter', jsonb_build_object('can_access_drive_mode',true,'can_access_av',false,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',false,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('kier', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('dock_office', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('qc_supervisor', jsonb_build_object('can_access_drive_mode',true,'can_access_av',false,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('csr', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',false,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('data_entry', jsonb_build_object('can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('foreman', jsonb_build_object('can_access_drive_mode',true,'can_access_av',false,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('grower', jsonb_build_object('can_access_drive_mode',false,'can_access_av',false,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false)),
('take_backs', jsonb_build_object('can_access_drive_mode',false,'can_access_av',false,'can_access_que',true,'can_access_manager_tab',false,'can_manage_user_access',false,'can_access_eval_reports_2',false,'can_submit_reclass',true,'can_complete_suspend_tag',false,'can_approve_deny_suspend',false))
on conflict (role) do nothing;

-- Keep both early permission reads and dataset snapshots on one revision so a
-- manager change cannot leave a trusted client cache authorized by stale data.
create or replace function app_sync_private.data_permission_version(p_actor uuid)
returns text language sql stable security definer set search_path = '' as $$
  select md5(
    jsonb_build_object('id',profile.id,'username',profile.username,'role',profile.role,'division',profile.division)::text
    || coalesce((select jsonb_agg(to_jsonb(permission)||jsonb_build_object(
        'allowed',case when private.is_kayla_managed_role_v1(profile.role) and override.permission_key is not null
          then override.allowed else permission.allowed end,
        'decision_source',case when private.is_kayla_managed_role_v1(profile.role) and override.permission_key is not null
          then 'limited-user' else permission.decision_source end)
        order by permission.permission_key)::text
      from private.get_effective_app_permissions_v1(p_actor,private.resolve_app_access_policy_id_v1(false)) permission
      left join private.app_limited_live_overrides override
        on override.profile_id=p_actor and override.permission_key=permission.permission_key),'[]')
    || ':user-access:' || coalesce((select state.revision::text from public.user_access_control_state state where state.singleton),'0')
  ) from public.profiles profile where profile.id=p_actor
$$;
revoke all on function app_sync_private.data_permission_version(uuid) from public,anon,authenticated;

-- Sales-rep IDs are assigned through the existing verified identity map, not
-- inferred from editable username/display-name strings.
create or replace function private.user_access_salesrep_identity_v1(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'salesrep_id',min(mapping.salesrepid),
    'salesrep_match_names',coalesce(array_agg(distinct mapping.salesrepname order by mapping.salesrepname)
      filter(where nullif(btrim(mapping.salesrepname),'') is not null),'{}'::text[])
  )
  from sales_private.rep_identities identity
  left join public.ph_customer_consignee_sales_reps mapping
    on sales_private.key(mapping.salesrepid)=identity.identity_key
  where identity.profile_id=p_profile_id and identity.kind='external_id'
$$;
revoke all on function private.user_access_salesrep_identity_v1(uuid) from public,anon,authenticated;

create or replace function private.user_access_has_permission_v1(p_profile_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((private.user_access_effective_permissions_v1(b.permissions,u.permission_overrides)->>p_permission)::boolean,false)
  from public.profiles p
  join public.user_access_control u on u.profile_id=p.id and u.active
  join public.role_access_baselines b on b.role=u.canonical_role
  where p.id=p_profile_id and p.disabled_at is null and not p.must_change_password
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users legacy where legacy.id=p.legacy_user_id
      and legacy.disabled_at is null and (legacy.locked_until is null or legacy.locked_until<=statement_timestamp())))
    and not private.scheduled_handover_cutoff_reached_v1(p.username,statement_timestamp())
$$;
revoke all on function private.user_access_has_permission_v1(uuid,text) from public,anon,authenticated;

-- Direct PostgREST reads of the shared inventory table must honor canonical
-- module revocations too. This no-argument wrapper binds auth.uid() itself;
-- callers cannot choose an actor. Existing permissive/ownership policies
-- still apply, and this restrictive policy only adds an AND boundary.
create or replace function public.user_access_inventory_read_allowed_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    private.user_access_has_permission_v1(auth.uid(),'can_access_drive_mode')
    or private.user_access_has_permission_v1(auth.uid(),'can_access_av')
    or private.user_access_has_permission_v1(auth.uid(),'can_access_que')
    or private.user_access_has_permission_v1(auth.uid(),'can_access_manager_tab')
    or private.user_access_has_permission_v1(auth.uid(),'can_submit_reclass'),false)
$$;
revoke all on function public.user_access_inventory_read_allowed_v1() from public,anon,authenticated;
grant execute on function public.user_access_inventory_read_allowed_v1() to authenticated;
drop policy if exists canonical_user_access_inventory_read_v1 on public.ph_master_inventory;
create policy canonical_user_access_inventory_read_v1 on public.ph_master_inventory
  as restrictive for select to authenticated
  using (public.user_access_inventory_read_allowed_v1());

-- Upgrade the existing service-only Eval 2 endpoints at a narrow predicate
-- boundary; actor resolution, profile activity and row scoping stay intact.
do $upgrade_eval2_access$
declare definition text; old_gate text; new_gate text;
begin
  definition:=pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure);
  old_gate:='if actor_username not in (''dylan_collyge'', ''megan_kelly'', ''jd_jones'') then';
  new_gate:='if not private.user_access_has_permission_v1(actor.id,''can_access_eval_reports_2'') then';
  if position(new_gate in definition)=0 then
    if (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1 then
      raise exception 'USER_ACCESS_EVAL2_ITEMCODE_GATE_SHAPE_INVALID';
    end if;
    execute replace(definition,old_gate,new_gate);
  end if;

  definition:=pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure);
  old_gate:='if surface=''eval2'' and actor.username not in (''dylan_collyge'',''megan_kelly'',''jd_jones'') then';
  new_gate:='if surface=''eval2'' and not private.user_access_has_permission_v1(actor.id,''can_access_eval_reports_2'') then';
  if position(new_gate in definition)=0 then
    if (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1 then
      raise exception 'USER_ACCESS_EVAL2_MANAGER_GATE_SHAPE_INVALID';
    end if;
    definition:=replace(definition,old_gate,new_gate);
  end if;
  old_gate:='jsonb_build_array(''eval1'',''eval2'',''ncr'') ||';
  new_gate:='jsonb_build_array(''eval1'',''ncr'') || case when private.user_access_has_permission_v1(actor.id,''can_access_eval_reports_2'') then jsonb_build_array(''eval2'') else ''[]''::jsonb end ||';
  if position(new_gate in definition)=0 then
    if (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1 then
      raise exception 'USER_ACCESS_EVAL2_CAPABILITIES_GATE_SHAPE_INVALID';
    end if;
    definition:=replace(definition,old_gate,new_gate);
  end if;
  if definition<>pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure) then execute definition; end if;
end
$upgrade_eval2_access$;

create or replace function private.sync_user_access_profile_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare role_key text;
begin
  role_key := private.canonical_user_access_role_v1(new.role);
  update public.user_access_control u set username=lower(btrim(new.username)),display_name=coalesce(nullif(btrim(new.display_name),''),new.username),
    canonical_role=role_key,email=coalesce((select a.email from auth.users a where a.id=new.id),u.email),
    active=new.disabled_at is null and not new.must_change_password,
    revision=u.revision+1,updated_at=statement_timestamp() where u.profile_id=new.id;
  if not found then
    insert into public.user_access_control(profile_id,username,display_name,canonical_role,email,active,permission_overrides)
    values(new.id,lower(btrim(new.username)),coalesce(nullif(btrim(new.display_name),''),new.username),role_key,
      (select a.email from auth.users a where a.id=new.id),
      new.disabled_at is null and not new.must_change_password,'{}'::jsonb)
    on conflict (username) do update set profile_id=excluded.profile_id,display_name=excluded.display_name,
      canonical_role=excluded.canonical_role,email=coalesce(excluded.email,public.user_access_control.email),
      active=excluded.active,revision=public.user_access_control.revision+1,updated_at=statement_timestamp();
  end if;
  update public.user_access_control_state set revision=revision+1,updated_at=statement_timestamp() where singleton;
  return new;
end $$;
drop trigger if exists profiles_sync_user_access_control_v1 on public.profiles;
create trigger profiles_sync_user_access_control_v1 after insert or update of username,display_name,role,disabled_at,locked_until,must_change_password on public.profiles
for each row execute function private.sync_user_access_profile_v1();

insert into public.user_access_control(profile_id,username,display_name,canonical_role,email,active,permission_overrides)
select p.id,lower(btrim(p.username)),coalesce(nullif(btrim(p.display_name),''),p.username),
  private.canonical_user_access_role_v1(p.role),(select u.email from auth.users u where u.id=p.id),
  p.disabled_at is null and not p.must_change_password,'{}'::jsonb
from public.profiles p
on conflict (profile_id) do update set display_name=excluded.display_name,canonical_role=excluded.canonical_role,
  email=coalesce(excluded.email,public.user_access_control.email),active=excluded.active,
  revision=public.user_access_control.revision+1,updated_at=statement_timestamp();
-- Legacy app-only identities are directory-visible but disabled and have no
-- profile/session, so they cannot resolve permissions or authenticate here.
insert into public.user_access_control(username,display_name,canonical_role,email,active,permission_overrides)
select lower(btrim(u.username)),coalesce(nullif(btrim(u.username),''),''),
  private.canonical_user_access_role_v1(u.role),null,false,'{}'::jsonb
from public.ph_app_users u
where not exists(select 1 from public.profiles p where lower(btrim(p.username))=lower(btrim(u.username)))
on conflict (username) do nothing;

-- Preserve the pre-existing Eval Reports #2 users as explicit overrides while
-- making future eligibility follow the canonical permission flag.
with changed as (
  update public.user_access_control
  set permission_overrides=jsonb_set(permission_overrides,'{can_access_eval_reports_2}','true',true),
      revision=revision+1,updated_at=statement_timestamp()
  where username in ('dylan_collyge','megan_kelly','jd_jones')
    and profile_id is not null and active
    and permission_overrides->'can_access_eval_reports_2' is distinct from 'true'::jsonb
  returning 1
)
update public.user_access_control_state set revision=revision+1,updated_at=statement_timestamp()
where singleton and exists(select 1 from changed);

create or replace function public.user_access_command_v1(
  p_actor_profile_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
  p_expected_revision bigint default null,p_command_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles; access_row public.user_access_control; baseline_row public.role_access_baselines;
  state_row public.user_access_control_state; target public.user_access_control; role_key text;
  operation_value text:=lower(btrim(coalesce(p_operation,''))); payload_value jsonb:=coalesce(p_payload,'{}'::jsonb);
  permissions_value jsonb; overrides_value jsonb; effective_value jsonb; profile_json jsonb;
  baseline_json jsonb; user_json jsonb; directory_json jsonb; response_json jsonb; previous_json jsonb;
  salesrep_identity_json jsonb;
  expected_permissions text[]:=array['can_access_drive_mode','can_access_av','can_access_que','can_access_manager_tab','can_manage_user_access','can_access_eval_reports_2','can_submit_reclass','can_complete_suspend_tag','can_approve_deny_suspend'];
  request_hash_value text;
begin
  if p_actor_profile_id is null or operation_value not in ('resolve','directory','save_role_baseline','save_user_overrides')
     or jsonb_typeof(payload_value)<>'object' then raise exception using errcode='22023',message='USER_ACCESS_REQUEST_INVALID'; end if;
  select * into actor from public.profiles p where p.id=p_actor_profile_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until<=statement_timestamp()) and not p.must_change_password
    and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users legacy where legacy.id=p.legacy_user_id
      and legacy.disabled_at is null and (legacy.locked_until is null or legacy.locked_until<=statement_timestamp())))
    and not private.scheduled_handover_cutoff_reached_v1(p.username,statement_timestamp());
  if actor.id is null or not exists(select 1 from public.user_access_control u where u.profile_id=actor.id and u.active) then
    raise exception using errcode='42501',message='USER_ACCESS_ACTIVE_PROFILE_REQUIRED';
  end if;
  select * into access_row from public.user_access_control u where u.profile_id=actor.id;
  select * into state_row from public.user_access_control_state where singleton;
  select * into baseline_row from public.role_access_baselines b where b.role=access_row.canonical_role;
  if baseline_row.role is null then raise exception using errcode='42501',message='USER_ACCESS_ROLE_UNMAPPED'; end if;
  overrides_value:=access_row.permission_overrides;
  effective_value:=baseline_row.permissions;
  for role_key in select jsonb_object_keys(baseline_row.permissions) loop
    if overrides_value ? role_key and jsonb_typeof(overrides_value->role_key)='boolean' then
      effective_value:=jsonb_set(effective_value,array[role_key],overrides_value->role_key,true);
    end if;
  end loop;
  if operation_value='resolve' then
    salesrep_identity_json:=private.user_access_salesrep_identity_v1(actor.id);
    profile_json:=jsonb_build_object('id',actor.id,'username',access_row.username,'display_name',access_row.display_name,'role',actor.role,
      'email',(select auth_user.email from auth.users auth_user where auth_user.id=actor.id),
      'salesrep_id',salesrep_identity_json->'salesrep_id','salesrep_match_names',coalesce(salesrep_identity_json->'salesrep_match_names','[]'::jsonb));
    baseline_json:=jsonb_build_object('role',baseline_row.role,'permissions',baseline_row.permissions,'revision',baseline_row.revision);
    return jsonb_build_object('revision',state_row.revision,'profile',profile_json,'baseline',baseline_json,
      'permission_overrides',overrides_value,'effective_permissions',effective_value,
      'data_hydration_policy',jsonb_build_object('use_shared_instant_snapshot',true,
        'av_season_rule','CURRENT_SEASON_F1_LE_27',
        'av_visibility_rule',case when access_row.canonical_role='sales_rep' then 'OPEN_STOCK_GT_0_OR_REP_RESERVE' else 'ALL_ELIGIBLE_ROWS' end),
      'resolved_at',statement_timestamp());
  end if;
  if coalesce((effective_value->>'can_manage_user_access')::boolean,false) is not true then
    raise exception using errcode='42501',message='USER_ACCESS_MANAGER_REQUIRED';
  end if;
  if operation_value='directory' then
    select coalesce(jsonb_agg(jsonb_build_object('role',b.role,'permissions',b.permissions,'revision',b.revision) order by b.role),'[]'::jsonb)
      into baseline_json from public.role_access_baselines b;
    select coalesce(jsonb_agg(jsonb_build_object('id',u.profile_id,'username',u.username,'display_name',u.display_name,'role',coalesce(p.role,''),
      'email',(select auth_user.email from auth.users auth_user where auth_user.id=u.profile_id),
      'salesrep_id',rep.salesrep_id,'salesrep_match_names',rep.salesrep_match_names,
      'active',(u.active and p.id is not null and p.disabled_at is null and (p.locked_until is null or p.locked_until<=statement_timestamp()) and not p.must_change_password
        and (p.legacy_user_id is null or exists(select 1 from public.ph_app_users legacy where legacy.id=p.legacy_user_id and legacy.disabled_at is null and (legacy.locked_until is null or legacy.locked_until<=statement_timestamp())))),
      'canonical_role',u.canonical_role,'baseline',jsonb_build_object('role',b.role,'permissions',b.permissions),
      'permission_overrides',u.permission_overrides,'effective_permissions',private.user_access_effective_permissions_v1(b.permissions,u.permission_overrides),'access_revision',u.revision)
      order by u.username),'[]'::jsonb) into user_json
      from public.user_access_control u left join public.profiles p on p.id=u.profile_id
      left join public.role_access_baselines b on b.role=u.canonical_role
      left join lateral (
        select identity_value->>'salesrep_id' as salesrep_id,
          array(select jsonb_array_elements_text(coalesce(identity_value->'salesrep_match_names','[]'::jsonb))) as salesrep_match_names
        from (select private.user_access_salesrep_identity_v1(u.profile_id) as identity_value) identity_row
      ) rep on true;
    return jsonb_build_object('revision',state_row.revision,'role_baselines',baseline_json,'users',user_json);
  end if;
  if p_command_id is null or p_expected_revision is null then raise exception using errcode='22023',message='USER_ACCESS_COMMAND_REQUIRED'; end if;
  request_hash_value:=md5(operation_value||':'||payload_value::text||':'||p_expected_revision::text);
  if exists(select 1 from public.user_access_control_commands c where c.command_id=p_command_id) then
    select c.response into response_json from public.user_access_control_commands c where c.command_id=p_command_id and c.actor_profile_id=actor.id and c.operation=operation_value and c.request_hash=request_hash_value;
    if response_json is null then raise exception using errcode='23505',message='USER_ACCESS_COMMAND_CONFLICT'; end if;
    return response_json;
  end if;
  select * into state_row from public.user_access_control_state where singleton for update;
  -- A concurrent retry may have waited on the singleton revision lock after
  -- the first request inserted its receipt. Recheck under the lock so that
  -- exactly-once retries return the saved response instead of a stale-rev
  -- error.
  if exists(select 1 from public.user_access_control_commands c where c.command_id=p_command_id) then
    select c.response into response_json from public.user_access_control_commands c where c.command_id=p_command_id and c.actor_profile_id=actor.id and c.operation=operation_value and c.request_hash=request_hash_value;
    if response_json is null then raise exception using errcode='23505',message='USER_ACCESS_COMMAND_CONFLICT'; end if;
    return response_json;
  end if;
  if p_expected_revision<>state_row.revision then raise exception using errcode='40001',message='USER_ACCESS_REVISION_CONFLICT'; end if;
  if operation_value='save_role_baseline' then
    if exists(select 1 from jsonb_object_keys(payload_value) k where k not in ('role','permissions')) then raise exception using errcode='22023',message='USER_ACCESS_PAYLOAD_INVALID'; end if;
    role_key:=lower(btrim(coalesce(payload_value->>'role','')));
    permissions_value:=payload_value->'permissions';
    if role_key not in (select b.role from public.role_access_baselines b) or not private.user_access_permission_flags_valid_v1(permissions_value,false) then
      raise exception using errcode='22023',message='USER_ACCESS_BASELINE_INVALID';
    end if;
    if actor.role not ilike '%admin%' and (role_key='admin' or (
      coalesce((effective_value->>'can_manage_user_access')::boolean,false)
      and permissions_value->>'can_manage_user_access' is distinct from (select permissions->>'can_manage_user_access' from public.role_access_baselines where role=role_key))) then
      raise exception using errcode='42501',message='USER_ACCESS_PRIVILEGED_FLAG_FORBIDDEN';
    end if;
    select to_jsonb(b) into previous_json from public.role_access_baselines b where b.role=role_key for update;
    update public.role_access_baselines b set permissions=permissions_value,revision=b.revision+1,updated_by_profile_id=actor.id,updated_at=statement_timestamp()
      where b.role=role_key returning to_jsonb(b) into baseline_json;
    user_json:=null;
  else
    if exists(select 1 from jsonb_object_keys(payload_value) k where k not in ('username','permission_overrides')) then raise exception using errcode='22023',message='USER_ACCESS_PAYLOAD_INVALID'; end if;
    role_key:=trim(both '_' from regexp_replace(split_part(lower(btrim(coalesce(payload_value->>'username',''))),'@',1),'[^a-z0-9]+','_','g'));
    overrides_value:=payload_value->'permission_overrides';
    if overrides_value is null or jsonb_typeof(overrides_value)<>'object'
      or exists(select 1 from jsonb_each(overrides_value) e where e.key<>all(expected_permissions) or jsonb_typeof(e.value) not in ('boolean','null')) then
      raise exception using errcode='22023',message='USER_ACCESS_OVERRIDES_INVALID';
    end if;
    select * into target from public.user_access_control u where u.username=role_key and u.profile_id is not null and u.active for update;
    if target.profile_id is null then raise exception using errcode='22023',message='USER_ACCESS_TARGET_INVALID'; end if;
    if actor.id=target.profile_id and overrides_value ? 'can_manage_user_access' and overrides_value->'can_manage_user_access' is distinct from target.permission_overrides->'can_manage_user_access'
      and actor.role not ilike '%admin%' then raise exception using errcode='42501',message='USER_ACCESS_SELF_ELEVATION_FORBIDDEN'; end if;
    if actor.role not ilike '%admin%' and overrides_value ? 'can_manage_user_access'
      and overrides_value->'can_manage_user_access' is distinct from target.permission_overrides->'can_manage_user_access' then
      raise exception using errcode='42501',message='USER_ACCESS_PRIVILEGED_FLAG_FORBIDDEN';
    end if;
    previous_json:=target.permission_overrides;
    update public.user_access_control u set permission_overrides=overrides_value,revision=u.revision+1,updated_at=statement_timestamp()
      where u.id=target.id returning to_jsonb(u) into user_json;
    baseline_json:=null;
  end if;
  update public.user_access_control_state set revision=revision+1,updated_at=statement_timestamp() where singleton returning * into state_row;
  insert into public.user_access_control_commands(command_id,actor_profile_id,operation,request_hash,response)
    values(p_command_id,actor.id,operation_value,request_hash_value,'{}'::jsonb);
  insert into public.user_access_control_audit(actor_profile_id,target_type,target_key,previous_value,next_value,revision,command_id)
    values(actor.id,case when operation_value='save_role_baseline' then 'role' else 'user' end,role_key,previous_json,
      coalesce(baseline_json,user_json,'{}'::jsonb),state_row.revision,p_command_id);
  if operation_value='save_role_baseline' then response_json:=jsonb_build_object('revision',state_row.revision,'baseline',jsonb_build_object('role',role_key,'permissions',baseline_json->'permissions','revision',baseline_json->'revision'));
  else
    select b.permissions into permissions_value from public.role_access_baselines b where b.role=target.canonical_role;
    effective_value:=private.user_access_effective_permissions_v1(permissions_value,overrides_value);
    salesrep_identity_json:=private.user_access_salesrep_identity_v1(target.profile_id);
    response_json:=jsonb_build_object('revision',state_row.revision,'user',jsonb_build_object('id',target.profile_id,'username',target.username,'display_name',target.display_name,'role',(select p.role from public.profiles p where p.id=target.profile_id),
      'email',(select auth_user.email from auth.users auth_user where auth_user.id=target.profile_id),
      'salesrep_id',salesrep_identity_json->'salesrep_id','salesrep_match_names',coalesce(salesrep_identity_json->'salesrep_match_names','[]'::jsonb),
      'active',target.active,'canonical_role',target.canonical_role,'baseline',jsonb_build_object('role',target.canonical_role,'permissions',permissions_value),'permission_overrides',overrides_value,'effective_permissions',effective_value,'access_revision',target.revision+1));
  end if;
  update public.user_access_control_commands set response=response_json where command_id=p_command_id;
  return response_json;
end $$;

alter table public.role_access_baselines enable row level security;
alter table public.role_access_baselines force row level security;
alter table public.user_access_control enable row level security;
alter table public.user_access_control force row level security;
alter table public.user_access_control_state enable row level security;
alter table public.user_access_control_state force row level security;
alter table public.user_access_control_commands enable row level security;
alter table public.user_access_control_commands force row level security;
alter table public.user_access_control_audit enable row level security;
alter table public.user_access_control_audit force row level security;
revoke all on public.role_access_baselines,public.user_access_control,public.user_access_control_state,public.user_access_control_commands,public.user_access_control_audit from public,anon,authenticated;
grant select,insert,update,delete on public.role_access_baselines,public.user_access_control,public.user_access_control_state,public.user_access_control_commands,public.user_access_control_audit to service_role;
grant usage,select on sequence public.user_access_control_audit_id_seq to service_role;
revoke all on function public.user_access_command_v1(uuid,text,jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function public.user_access_command_v1(uuid,text,jsonb,bigint,uuid) to service_role;
revoke all on function private.canonical_user_access_role_v1(text),private.user_access_effective_permissions_v1(jsonb,jsonb) from public,anon,authenticated;
