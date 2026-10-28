begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.normalize_inventory_live_change_username_v2392(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case regexp_replace(lower(btrim(coalesce(p_value,''))),'[^a-z0-9]+','_','g')
    when 'jorge' then 'jorge_colunga'
    when 'colunga_jorge' then 'jorge_colunga'
    else regexp_replace(lower(btrim(coalesce(p_value,''))),'[^a-z0-9]+','_','g') end
$$;
revoke all on function private.normalize_inventory_live_change_username_v2392(text) from public,anon,authenticated;

create or replace function private.inventory_row_assigned_to_actor_v2392(
  p_actor_username text,p_master_uid text,p_itemcode text
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.ph_inventory_row_assignments a
    where a.present_in_drive
      and a.master_unique_id=btrim(coalesce(p_master_uid,''))
      and private.normalize_inventory_live_change_username_v2392(a.assignedto)
        =private.normalize_inventory_live_change_username_v2392(p_actor_username)
  ) or exists(
    select 1 from public.ph_warehouse_assigned_items a
    where a.present_in_drive
      and upper(btrim(coalesce(a.itemcode_normalized,a.itemcode,'')))=upper(btrim(coalesce(p_itemcode,'')))
      and private.normalize_inventory_live_change_username_v2392(a.assignedto)
        =private.normalize_inventory_live_change_username_v2392(p_actor_username)
  )
$$;
revoke all on function private.inventory_row_assigned_to_actor_v2392(text,text,text) from public,anon,authenticated;

create or replace function private.require_drive_live_change_profile_v2392(
  p_master_uid text,p_itemcode text,p_locationcode text,p_lotcode text
) returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare actor public.profiles%rowtype;actor_key text;actor_role text;row_value public.ph_master_inventory%rowtype;
begin
  select p.* into actor from public.profiles p where p.id=auth.uid() and p.disabled_at is null
    and not p.must_change_password and (p.locked_until is null or p.locked_until<=statement_timestamp());
  if actor.id is null then raise exception using errcode='42501',message='DRIVE_LIVE_CHANGE_PROFILE_INACTIVE'; end if;
  actor_key:=private.normalize_inventory_live_change_username_v2392(actor.username);
  actor_role:=private.normalized_profile_role(actor.role);
  if actor_key=any(array['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser'])
     or actor_role in ('ADMIN','ADMINISTRATOR') then return actor; end if;
  if actor_key<>'jorge_colunga' then
    raise exception using errcode='42501',message='DRIVE_LIVE_CHANGE_ADMIN_REQUIRED';
  end if;
  select m.* into row_value from public.ph_master_inventory m
  where m.unique_id=btrim(coalesce(p_master_uid,''))
    and upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(coalesce(p_itemcode,'')))
    and upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(coalesce(p_locationcode,'')))
    and upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_lotcode,''))) limit 1;
  if row_value.unique_id is null or not private.inventory_row_assigned_to_actor_v2392(
    actor_key,row_value.unique_id,row_value.itemcode) then
    raise exception using errcode='42501',message=case when actor_key='jorge_colunga'
      then 'INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED' else 'INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED' end;
  end if;
  return actor;
end $$;
revoke all on function private.require_drive_live_change_profile_v2392(text,text,text,text) from public,anon,authenticated;

do $$
declare definition text;original text;
begin
  original:=pg_get_functiondef('public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text)'::regprocedure);
  if position('private.require_drive_live_change_profile_v2392' in original)>0 then return; end if;
  definition:=replace(original,'actor := private.require_active_admin_profile();',
    'actor := private.require_drive_live_change_profile_v2392(p_master_uid,p_expected_itemcode,p_expected_locationcode,p_expected_lotcode);');
  if definition=original then
    definition:=replace(original,'actor:=private.require_active_admin_profile();',
      'actor:=private.require_drive_live_change_profile_v2392(p_master_uid,p_expected_itemcode,p_expected_locationcode,p_expected_lotcode);');
  end if;
  if definition=original then raise exception 'SAVE_DRIVE_EVIDENCE_V3_ACTOR_GATE_NOT_FOUND'; end if;
  execute definition;
end $$;

with target as (
  select p.id from public.profiles p where lower(btrim(p.username))='jorge_colunga' limit 1
)
update public.profiles p set must_change_password=false
where p.id=(select id from target) and p.must_change_password;

update public.user_access_control u set
  active=true,
  permission_overrides=coalesce(u.permission_overrides,'{}'::jsonb)||jsonb_build_object(
    'can_access_drive_mode',true,'can_access_av',true,'can_access_que',true,
    'can_access_manager_tab',true,'can_submit_reclass',true,'can_manage_user_access',false),
  revision=u.revision+1,updated_at=statement_timestamp()
where u.username='jorge_colunga' and u.profile_id is not null
  and (not u.active or not coalesce((u.permission_overrides->>'can_access_drive_mode')::boolean,false)
    or not coalesce((u.permission_overrides->>'can_access_av')::boolean,false)
    or not coalesce((u.permission_overrides->>'can_access_que')::boolean,false)
    or not coalesce((u.permission_overrides->>'can_access_manager_tab')::boolean,false)
    or not coalesce((u.permission_overrides->>'can_submit_reclass')::boolean,false)
    or coalesce((u.permission_overrides->>'can_manage_user_access')::boolean,false));

insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope,updated_at)
select private.resolve_app_access_policy_id_v1(false),p.id,v.permission_key,true,v.access_scope,statement_timestamp()
from public.profiles p cross join (values
  ('module.drive.view',null::text),('module.av.view',null::text),('drive.reclass.submit','assigned'),
  ('module.managers.view',null::text),('manager.assigned_items_export.view',null::text),
  ('module.request.view',null::text),('request.view_queue','assigned')
) v(permission_key,access_scope)
where lower(btrim(p.username))='jorge_colunga'
on conflict(policy_id,profile_id,permission_key) do update set
  allowed=true,access_scope=excluded.access_scope,updated_at=excluded.updated_at;

update public.user_access_control_state set revision=revision+1,updated_at=statement_timestamp() where singleton;

comment on function private.inventory_row_assigned_to_actor_v2392(text,text,text)
is 'v2.3.92 canonical exact-row or Assigned Items itemcode ownership check for scoped live inventory changes.';
comment on function private.require_drive_live_change_profile_v2392(text,text,text,text)
is 'v2.3.92 permits global live-change users and active Admins on all rows; other users require an exact Assigned Items row.';

commit;
