begin;

-- The existing appearance columns and updated_at are intentionally untouched.
alter table public.ph_app_user_preferences
  add column if not exists footer_shortcuts text[],
  add column if not exists footer_revision bigint not null default 0,
  add column if not exists footer_updated_at timestamptz;

create table private.navigation_view_catalog (
  view_key text primary key, label text not null, parent_key text,
  protected_reason text, selectable boolean not null default true
);
insert into private.navigation_view_catalog(view_key,label,parent_key,protected_reason,selectable) values
('home','Home',null,'Home remains available to every active account.',false),
('drive','Drive Mode',null,null,true),('tasks','Tasks',null,null,true),('docks','Docks',null,null,true),
('request','Queue',null,'Queue tabs and row ownership retain their separate authorization.',true),
('bloom','Bloom',null,'Each Bloom action retains its existing restrictions.',true),
('communication','Communication',null,null,false),('department-calendar','Department Calendar','communication',null,true),('chat','Chat','communication',null,true),
('sales','Sales',null,null,true),('sales-office','Sales Office','sales',null,true),
('request-history','Request History','sales','Sales reps remain restricted to requests assigned to them.',true),
('sales-credit','Credit','sales','Source rows and submissions remain restricted to their permitted owner/customer scope.',true),
('credit-request','Credit Request','sales','Only Dylan Collyge, JD Jones, and Megan Kelly may decide credit lines.',true),
('av','AV',null,null,true),('reserves','Reserves',null,null,true),('advertisement','Advertisement','sales',null,true),
('sales-inventory','Inventory',null,null,true),('weather-hold','Weather and Hold Risk',null,null,true),
('bunch-note','Bunch Notes','sales-inventory','Only Dylan authors Bunch Notes. Workers use their authorized Queue tab.',true),
('hl-order','HL Order','sales-inventory','Only active dylan_collyge may use HL Order.',true),
('po-management','PO Management','sales-inventory','Existing PO approval restrictions remain in force.',true),
('crop-roll','Crop Roll','sales-inventory','Crop Roll management remains Dylan-only.',true),
('office','Office',null,null,true),('production','Production',null,null,true),
('production-workflow','Production Workflows','production',null,true),
('production:propagation','Propagation','production-workflow',null,true),('production:planting','Planting','production-workflow',null,true),
('production:can-filling','Can Filling','production-workflow','Not yet available.',false),
('production:order-pulling','Order Pulling','production-workflow','Not yet available.',false),
('take-back','Take Back','production',null,true),('shear-list','Shear List','production',null,true),
('grower','Grower','production',null,true),('qc','QC',null,null,true),
('moves','Moves',null,'Existing move approval rules remain in force.',true),
('hours','Labor Hours',null,null,true),('low-stock','Low Stock',null,null,true),('review','Review',null,null,true),('move-up','Move Up',null,null,true),
('managers','Manager',null,'Opening Manager does not grant Manager authority or protected tools.',true),
('reports','Reports','managers','Existing Reports users are retained. New default access is Manager-only.',true),
('inventory-transaction-history','Inventory Transaction History','managers','Existing transaction-history reviewer restrictions remain in force.',true),
('access-control','User Access','managers','Only an authenticated Manager can change module/view grants.',false),
('disease-pest','Disease / Pest',null,'Dylan-only capability.',true),('pest-management','Pest Management',null,'Dylan-only capability.',true);

create table private.navigation_access_state (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  revision bigint not null default 0, updated_at timestamptz not null default now()
);
create table private.navigation_view_overrides (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  view_key text not null references private.navigation_view_catalog(view_key),
  allowed boolean not null, primary key(profile_id,view_key)
);
create table private.navigation_reports_legacy (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  captured_at timestamptz not null default now()
);
create table private.navigation_change_events (
  event_id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null, before_value jsonb not null, after_value jsonb not null,
  reason text not null, created_at timestamptz not null default now()
);
create table private.navigation_commands (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  command_id uuid not null, input_value jsonb not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(actor_id,command_id)
);
alter table private.navigation_view_catalog enable row level security;
alter table private.navigation_access_state enable row level security;
alter table private.navigation_view_overrides enable row level security;
alter table private.navigation_reports_legacy enable row level security;
alter table private.navigation_change_events enable row level security;
alter table private.navigation_commands enable row level security;
revoke all on private.navigation_view_catalog,private.navigation_access_state,private.navigation_view_overrides,
  private.navigation_reports_legacy,private.navigation_change_events,private.navigation_commands from public,anon,authenticated;

create function private.navigation_is_manager_v1(p_actor_id uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_actor_id
    and p.disabled_at is null and not coalesce(p.must_change_password,false)
    and (p.locked_until is null or p.locked_until<=now())
    and lower(btrim(p.username))<>'brandt_emerson'
    and (upper(p.role) like '%MANAGER%' or upper(p.role) like '%ADMIN%'
      or lower(btrim(p.username)) in ('dylan_collyge','jd_jones','megan_kelly')))
$$;

-- Preserve the deployed role map, including broad legacy DATAENTRY access.
-- This is a view decision only. It never replaces action/record authorization.
create function private.navigation_legacy_allowed_v1(p_actor_id uuid,p_view text)
returns boolean language plpgsql stable set search_path='' as $$
declare p public.profiles; r text; u text; v text:=p_view; a boolean:=false; limited boolean; admin_role boolean; live_allowed boolean;
begin
  select * into p from public.profiles where id=p_actor_id;
  if p.id is null then return false; end if;
  r:=regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g'); u:=lower(btrim(p.username));
  if v='home' or v='bloom' then return true; end if;
  if v in ('bunch-note','hl-order','disease-pest','pest-management') then return u='dylan_collyge'; end if;
  if v='managers' and u='brandt_emerson' then return false; end if;
  if v='access-control' then return private.navigation_is_manager_v1(p_actor_id); end if;
  if v like 'production:%' then v:='production-workflow'; end if;
  if v='inventory-transaction-history' then return u in ('dylan_collyge','jd_jones','megan_kelly'); end if;
  if v in ('request-history','sales-credit','credit-request') then v:='sales'; end if;
  limited:=r in ('REP','SALES','SALE','SALESUSER','SALESROLE','SALESMARKETING') or r like '%SALESREP%'
    or r like '%CSR%' or r like 'QC%' or r like '%FOREMAN%' or r like '%GROWER%' or r like '%TAKEBACK%'
    or r like 'EVAL%' or r like 'DIVISION%' or u in ('ben_brown','chance_alldredge');
  admin_role:=u in ('dylan_collyge','jd_jones','megan_kelly')
    or ((r like '%ADMIN%' or r like '%MANAGER%') and r not like 'EVAL%') or not limited;
  if v='crop-roll' then return not (r in ('REP','SALES','SALE','SALESUSER','SALESROLE') or r like '%SALESREP%' or r like '%CSR%'); end if;
  if admin_role then a:=true;
  elsif r like '%TAKEBACK%' then a:=v=any(array['take-back','production','production-workflow','sales-inventory','weather-hold','shear-list','tasks','request']);
  elsif r like '%FOREMAN%' then a:=v=any(array['drive','take-back','production','production-workflow','sales-inventory','weather-hold','shear-list','tasks','request','communication','department-calendar','chat','hours','grower']);
  elsif r like '%GROWER%' then a:=v=any(array['production','production-workflow','sales-inventory','weather-hold','shear-list','tasks','request','grower','communication','department-calendar','chat']);
  elsif r like 'EVAL%' then a:=v=any(array['sales-inventory','tasks','drive','request','moves','docks','communication','department-calendar','chat','av','sales-office','weather-hold']);
  elsif r like 'DIVISION%' then a:=v=any(array['request','communication','department-calendar','chat']);
  elsif r='SALESMARKETING' then a:=v=any(array['drive','tasks']);
  elsif r in ('REP','SALES','SALE','SALESUSER','SALESROLE') or r like '%SALESREP%' or r like '%CSR%' then a:=v=any(array['drive','sales','av','docks','request','tasks','weather-hold','communication','department-calendar','chat','sales-office','office']);
  elsif r like 'QC%' then a:=v=any(array['take-back','production','production-workflow','weather-hold','shear-list','communication','department-calendar','chat','qc','drive','docks','tasks','request']);
  else a:=v=any(array['communication','department-calendar','chat','take-back','production','production-workflow','weather-hold','shear-list']); end if;
  -- CSR/REP/Marketing already use these live audit-policy decisions in the shell.
  if private.is_kayla_managed_role_v1(p.role) then
    select coalesce(o.allowed,e.allowed) into live_allowed
      from private.get_effective_app_permissions_v1(p.id,private.resolve_app_access_policy_id_v1(false)) e
      left join private.app_limited_live_overrides o on o.profile_id=p.id and o.permission_key=e.permission_key
      where e.permission_kind='module' and e.module_key=v;
    if found then a:=live_allowed; end if;
  end if;
  return a;
end $$;

insert into private.navigation_reports_legacy(profile_id)
  select p.id from public.profiles p where private.navigation_legacy_allowed_v1(p.id,'reports');

create function private.navigation_module_allowed_v1(p_actor_id uuid,p_view text)
returns boolean language plpgsql stable set search_path='' as $$
declare p public.profiles; override_value boolean; parent text;
begin
  select * into p from public.profiles where id=p_actor_id;
  if p.id is null or p.disabled_at is not null or coalesce(p.must_change_password,false)
    or (p.locked_until is not null and p.locked_until>now()) then return false; end if;
  if not exists(select 1 from private.navigation_view_catalog where view_key=p_view) then return false; end if;
  -- These entry guards are independent of editable module visibility.
  if p_view in ('bunch-note','hl-order','disease-pest','pest-management') and lower(btrim(p.username))<>'dylan_collyge' then return false; end if;
  if p_view='managers' and lower(btrim(p.username))='brandt_emerson' then return false; end if;
  if p_view='access-control' then return private.navigation_is_manager_v1(p_actor_id); end if;
  if p_view='home' then return true; end if;
  select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
  if found then return override_value; end if;
  if p_view='reports' then return private.navigation_is_manager_v1(p_actor_id) or exists(select 1 from private.navigation_reports_legacy where profile_id=p.id); end if;
  if p_view like 'production:%' then return private.navigation_module_allowed_v1(p.id,'production-workflow'); end if;
  if p_view in ('request-history','sales-credit','credit-request') then
    return private.navigation_module_allowed_v1(p.id,'sales') or lower(btrim(p.username)) in ('dylan_collyge','jd_jones','megan_kelly');
  end if;
  -- Every active account retains access to its scoped Bunch Notes Queue tab.
  if p_view='request' then return true; end if;
  return private.navigation_legacy_allowed_v1(p.id,p_view);
end $$;

create function private.navigation_snapshot_v1(p_actor_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'profileId',p.id,'username',p.username,'role',p.role,
    'manager',private.navigation_is_manager_v1(p.id),
    'accessRevision',coalesce(s.revision,0),'footerRevision',coalesce(pref.footer_revision,0),
    'shortcuts',coalesce(to_jsonb(pref.footer_shortcuts),'null'::jsonb),
    'views',(select jsonb_agg(jsonb_build_object('view',c.view_key,'label',c.label,'parent',c.parent_key,
      'protectedReason',c.protected_reason,'selectable',c.selectable,
      'allowed',private.navigation_module_allowed_v1(p.id,c.view_key),
      'override',o.allowed) order by c.label) from private.navigation_view_catalog c
      left join private.navigation_view_overrides o on o.profile_id=p.id and o.view_key=c.view_key))
  from public.profiles p left join private.navigation_access_state s on s.profile_id=p.id
  left join public.ph_app_user_preferences pref on pref.user_key=lower(btrim(p.username)) where p.id=p_actor_id
$$;

create function public.navigation_module_allowed_v1(p_actor_id uuid,p_view text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.navigation_module_allowed_v1(p_actor_id,p_view)
$$;

create function public.navigation_preferences_command_v1(
  p_actor_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,p_command_id uuid default null,p_expected_revision bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.profiles; result jsonb; request_value jsonb; previous private.navigation_commands;
  before_value jsonb; choices text[]; item jsonb; key text; revision_value bigint; reason text; manager_actor boolean;
begin
  select * into actor from public.profiles where id=p_actor_id;
  if actor.id is null or actor.disabled_at is not null or coalesce(actor.must_change_password,false)
    or (actor.locked_until is not null and actor.locked_until>now()) then raise exception 'NAVIGATION_AUTH_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 then raise exception 'NAVIGATION_PAYLOAD_INVALID'; end if;
  manager_actor:=private.navigation_is_manager_v1(actor.id);
  if p_operation='get' then return private.navigation_snapshot_v1(actor.id); end if;
  if p_operation in ('users','user_access','set_user_access') and not manager_actor then raise exception 'NAVIGATION_MANAGER_REQUIRED' using errcode='42501'; end if;
  if p_operation='users' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',p.display_name,'role',p.role,
      'active',p.disabled_at is null and (p.locked_until is null or p.locked_until<=now())) order by p.username),'[]'::jsonb) from public.profiles p);
  end if;
  if p_operation in ('user_access','set_user_access') then
    select * into target from public.profiles where id=(p_payload->>'profileId')::uuid;
    if target.id is null then raise exception 'NAVIGATION_USER_NOT_FOUND'; end if;
  else target:=actor; end if;
  if p_operation='user_access' then return private.navigation_snapshot_v1(target.id); end if;
  if p_operation not in ('save_shortcuts','set_user_access') then raise exception 'NAVIGATION_OPERATION_INVALID'; end if;
  if p_command_id is null or p_expected_revision is null then raise exception 'NAVIGATION_COMMAND_REVISION_REQUIRED'; end if;
  request_value:=jsonb_build_object('operation',p_operation,'payload',p_payload,'revision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||':'||p_command_id::text,0));
  select * into previous from private.navigation_commands where actor_id=actor.id and command_id=p_command_id;
  if found then
    if previous.input_value<>request_value then raise exception 'NAVIGATION_COMMAND_CONFLICT' using errcode='40001'; end if;
    return previous.result;
  end if;
  if p_operation='save_shortcuts' then
    if (select count(*) from jsonb_object_keys(p_payload))<>1 or not (p_payload?'shortcuts')
      or jsonb_typeof(p_payload->'shortcuts')<>'array' or jsonb_array_length(p_payload->'shortcuts')>5 then raise exception 'NAVIGATION_SHORTCUTS_INVALID'; end if;
    select coalesce(array_agg(value),'{}'::text[]) into choices from jsonb_array_elements_text(p_payload->'shortcuts');
    if cardinality(choices)<>(select count(distinct x) from unnest(choices) x) or exists(select 1 from unnest(choices) x
      where not exists(select 1 from private.navigation_view_catalog c where c.view_key=x and c.selectable)
      or not private.navigation_module_allowed_v1(actor.id,x)) then raise exception 'NAVIGATION_SHORTCUT_NOT_ALLOWED' using errcode='42501'; end if;
    insert into public.ph_app_user_preferences(user_key) values(lower(btrim(actor.username))) on conflict do nothing;
    select footer_revision into revision_value from public.ph_app_user_preferences where user_key=lower(btrim(actor.username)) for update;
    if revision_value<>p_expected_revision then raise exception 'NAVIGATION_REVISION_CONFLICT' using errcode='40001'; end if;
    before_value:=private.navigation_snapshot_v1(actor.id)->'shortcuts';
    update public.ph_app_user_preferences set footer_shortcuts=choices,footer_revision=footer_revision+1,footer_updated_at=now()
      where user_key=lower(btrim(actor.username));
    reason:='User updated footer shortcuts';
  else
    if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('profileId','changes','reason'))
      or jsonb_typeof(p_payload->'changes')<>'array' or jsonb_array_length(p_payload->'changes') not between 1 and 100 then raise exception 'NAVIGATION_CHANGES_INVALID'; end if;
    reason:=btrim(coalesce(p_payload->>'reason',''));
    if length(reason) not between 4 and 500 then raise exception 'NAVIGATION_REASON_REQUIRED'; end if;
    insert into private.navigation_access_state(profile_id) values(target.id) on conflict do nothing;
    select revision into revision_value from private.navigation_access_state where profile_id=target.id for update;
    if revision_value<>p_expected_revision then raise exception 'NAVIGATION_REVISION_CONFLICT' using errcode='40001'; end if;
    before_value:=private.navigation_snapshot_v1(target.id);
    if (select count(*) from jsonb_array_elements(p_payload->'changes'))<>(select count(distinct value->>'view') from jsonb_array_elements(p_payload->'changes')) then raise exception 'NAVIGATION_DUPLICATE_VIEW'; end if;
    for item in select value from jsonb_array_elements(p_payload->'changes') loop
      key:=item->>'view';
      if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2 or not(item?'allowed')
        or coalesce(jsonb_typeof(item->'allowed'),'missing') not in ('boolean','null')
        or not exists(select 1 from private.navigation_view_catalog where view_key=key) then raise exception 'NAVIGATION_VIEW_INVALID'; end if;
      if key in ('home','access-control') or (key in ('bunch-note','hl-order','disease-pest','pest-management') and lower(btrim(target.username))<>'dylan_collyge')
        or (key='managers' and lower(btrim(target.username))='brandt_emerson') then raise exception 'NAVIGATION_PROTECTED_CAPABILITY' using errcode='42501'; end if;
      if item->'allowed'='null'::jsonb then delete from private.navigation_view_overrides where profile_id=target.id and view_key=key;
      else insert into private.navigation_view_overrides(profile_id,view_key,allowed) values(target.id,key,(item->>'allowed')::boolean)
        on conflict(profile_id,view_key) do update set allowed=excluded.allowed; end if;
    end loop;
    update private.navigation_access_state set revision=revision+1,updated_at=now() where profile_id=target.id;
  end if;
  result:=private.navigation_snapshot_v1(target.id);
  insert into private.navigation_change_events(actor_id,target_id,operation,before_value,after_value,reason)
    values(actor.id,target.id,p_operation,coalesce(before_value,'null'::jsonb),result,reason);
  insert into private.navigation_commands(actor_id,command_id,input_value,result) values(actor.id,p_command_id,request_value,result);
  return result;
end $$;

revoke all on function private.navigation_is_manager_v1(uuid), private.navigation_legacy_allowed_v1(uuid,text),
  private.navigation_module_allowed_v1(uuid,text),private.navigation_snapshot_v1(uuid) from public,anon,authenticated;
revoke all on function public.navigation_module_allowed_v1(uuid,text),public.navigation_preferences_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.navigation_module_allowed_v1(uuid,text),public.navigation_preferences_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;

commit;
