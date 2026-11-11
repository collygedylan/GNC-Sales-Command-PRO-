begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

create or replace function suspend_tag_private.assigned_owner_v3068(
  p_itemcode text,p_locationcode text,p_lotcode text
) returns text language plpgsql stable security definer set search_path='' as $function$
declare code text:=upper(btrim(p_itemcode)); owner text;
begin
  if code ~ '^[0-9]{6}[.][0-9]{3}[.]$' then code:=code||'1'; end if;
  if private.eval_location_zone(p_locationcode)='inside' then
    if private.inventory_assignment_actor_active_v3047('zoe_green',null) then return 'zoe_green'; end if;
    return null;
  end if;
  select nullif(lower(btrim(d.assignedto)),'') into owner
  from public.ph_itemcode_default_owners d where d.itemcode_normalized=code;
  if found then return owner; end if;
  select case when count(distinct a.assignedto)=1 then min(a.assignedto) end into owner
  from public.ph_inventory_row_assignments a
  where a.present_in_drive and a.itemcode_normalized=code
    and upper(btrim(a.locationcode))=upper(btrim(p_locationcode))
    and upper(btrim(a.lotcode))=upper(btrim(p_lotcode));
  return nullif(lower(btrim(owner)),'');
end
$function$;

create or replace function suspend_tag_private.zone_override_v3068(p_locationcode text)
returns boolean language sql immutable security definer set search_path='' as $function$
  select private.eval_location_zone(p_locationcode)='inside'
$function$;

create or replace function suspend_tag_private.is_admin_v3068(p_role text)
returns boolean language sql immutable set search_path='' as $function$
  select regexp_replace(upper(coalesce(p_role,'')),'[^A-Z]','','g') in ('ADMIN','ADMINISTRATOR','SUPERADMIN')
$function$;

create or replace function suspend_tag_private.can_work_row_v3068(p_actor public.profiles,p_row public.ph_soc_master)
returns boolean language sql stable security definer set search_path='' as $function$
  select p_actor.id is not null and (suspend_tag_private.is_admin_v3068(p_actor.role)
    or private.access_username_v23119(p_actor.username)=suspend_tag_private.assigned_owner_v3068(
      p_row.itemcode,p_row.locationcode,p_row.lotcode))
$function$;

create or replace function suspend_tag_private.require_row_owner_v3068(p_actor public.profiles,p_row public.ph_soc_master)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if not coalesce(suspend_tag_private.can_work_row_v3068(p_actor,p_row),false) then
    raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
  end if;
end
$function$;

create or replace function suspend_tag_private.require_inventory_owners_v3068(p_actor public.profiles,p_ids jsonb)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if suspend_tag_private.is_admin_v3068(p_actor.role) then return; end if;
  if exists(select 1 from public.ph_master_inventory m
    where m.unique_id in(select jsonb_array_elements_text(coalesce(p_ids,'[]')))
      and private.access_username_v23119(p_actor.username) is distinct from
        suspend_tag_private.assigned_owner_v3068(m.itemcode,m.locationcode,m.lotcode)) then
    raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
  end if;
end
$function$;

revoke all on function suspend_tag_private.assigned_owner_v3068(text,text,text),
  suspend_tag_private.zone_override_v3068(text),
  suspend_tag_private.is_admin_v3068(text),suspend_tag_private.can_work_row_v3068(public.profiles,public.ph_soc_master),
  suspend_tag_private.require_row_owner_v3068(public.profiles,public.ph_soc_master),
  suspend_tag_private.require_inventory_owners_v3068(public.profiles,jsonb)
from public,anon,authenticated,service_role;
grant execute on function suspend_tag_private.assigned_owner_v3068(text,text,text) to anon,authenticated,service_role;
grant execute on function suspend_tag_private.zone_override_v3068(text) to anon,authenticated,service_role;

-- Preserve Request scope exactly; SUSPEND scope follows the verified profile role.
create or replace function private.queue_scope_actor_v23159(p_queue text)
returns text language sql stable security definer set search_path='' as $function$
  select case when case when p_queue='suspend' then suspend_tag_private.is_admin_v3068(p.role)
    else (case p_queue when 'request' then a.view_all_requests else a.view_all_suspend end)='Y' end
    then '*' else private.access_username_v23119(p.username) end
  from private.current_active_profile() p left join public.user_access a on a.profile_id=p.id where p.id is not null
$function$;

do $view$
declare
  prior text:=pg_get_viewdef('public.ph_active_suspend'::regclass,true); changed text;
  old_owner constant text:=$pattern$NULLIF[(]lower[(]btrim[(]exact[.]assignedto[)][)], ''::text[)]$pattern$;
  new_owner constant text:='suspend_tag_private.assigned_owner_v3068(tag_1.itemcode,tag_1.locationcode,tag_1.lotcode)';
  old_join constant text:=$pattern$LEFT JOIN (public[.])?ph_itemcode_default_owners exact ON exact[.]itemcode_normalized = upper[(].*?END[)]$pattern$;
begin
  if position('assigned_owner_v3068' in prior)>0 and position('suspend_owner_zone_override' in prior)>0 then return; end if;
  if cardinality(regexp_split_to_array(prior,old_owner,'i'))<>3
    or cardinality(regexp_split_to_array(prior,old_join,'ns'))<>2 then
    raise exception 'SUSPEND_ASSIGNED_VIEW_ANCHOR_CHANGED';
  end if;
  changed:=regexp_replace(prior,old_owner,new_owner,'gi');
  changed:=regexp_replace(changed,old_join,'','ns');
  if changed ~ 'exact[.]' then raise exception 'SUSPEND_ASSIGNED_VIEW_JOIN_REMAINS'; end if;
  if cardinality(regexp_split_to_array(changed,E'\\n[ ]+FROM [(]'))<2
    or position(') workbook_suspend' in changed)=0 then raise exception 'SUSPEND_ASSIGNED_VIEW_OUTER_CHANGED'; end if;
  changed:=regexp_replace(changed,E'\\n[ ]+FROM [(]',
    E',\n    suspend_tag_private.zone_override_v3068(workbook_suspend.locationcode) AS suspend_owner_zone_override\n   FROM (');
  execute 'create or replace view public.ph_active_suspend with (security_invoker=true) as '||changed;
end
$view$;

-- Keep the existing native session, physical source recovery, receipt and publisher.
do $command$
declare
  prior text:=pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  gate constant text:=$pattern$  if p_operation<>'decide' and actor[.]username not in [(].*?then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;$pattern$;
  source_anchor constant text:=$anchor$  if not found or not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;$anchor$;
  rows_anchor constant text:=$anchor$where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)))$anchor$;
begin
  if position('require_row_owner_v3068' in prior)>0 then return; end if;
  if cardinality(regexp_split_to_array(prior,gate,'n'))<>2
    or cardinality(string_to_array(prior,source_anchor))<>2
    or cardinality(string_to_array(prior,rows_anchor))<>2 then
    raise exception 'SUSPEND_ASSIGNED_COMMAND_ANCHOR_CHANGED';
  end if;
  prior:=regexp_replace(prior,gate,'','n');
  prior:=replace(prior,rows_anchor,replace(rows_anchor,'suspend_to)))','suspend_to) and suspend_tag_private.can_work_row_v3068(actor,r)))'));
  prior:=replace(prior,source_anchor,source_anchor||E'\n  if p_operation<>''decide'' then perform suspend_tag_private.require_row_owner_v3068(actor,s); end if;');
  execute prior;
end
$command$;

do $group$
declare
  prior text:=pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  gate constant text:=$pattern$   elsif regexp_replace[(]upper[(]coalesce[(]actor[.]role,''[)][)],'\[\^A-Z\]','','g'[)] not in.*?then[[:space:]]+raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;$pattern$;
  start_anchor constant text:=$anchor$ if s.unique_id is null then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;$anchor$;
  end_anchor constant text:=' group_key:=suspend_tag_private.order_key(s);';
  first_at integer; last_at integer; guards text;
begin
  if position('require_row_owner_v3068' in prior)>0 then return; end if;
  if cardinality(regexp_split_to_array(prior,gate,'ns'))<>2
    or cardinality(string_to_array(prior,start_anchor))<>2
    or cardinality(string_to_array(prior,end_anchor))<>2 then
    raise exception 'SUSPEND_ASSIGNED_GROUP_ANCHOR_CHANGED';
  end if;
  prior:=regexp_replace(prior,gate,'   end if;','ns');
  first_at:=strpos(prior,start_anchor)+length(start_anchor); last_at:=strpos(prior,end_anchor);
  guards:=substr(prior,first_at,last_at-first_at);
  if guards ~* '\m(insert|update|delete|perform|execute)\M' or length(guards)>6000 then
    raise exception 'SUSPEND_ASSIGNED_GROUP_GUARD_CHANGED';
  end if;
  prior:=overlay(prior placing $guard$
 if p_operation in ('approval','decide') then
   if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g')='SALESREP'
     and (suspend_tag_private.rep_for_row(s)).id is distinct from actor.id then
     raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
   end if;
 elsif p_operation<>'dock_review' then
   perform suspend_tag_private.require_row_owner_v3068(actor,s);
   perform suspend_tag_private.require_inventory_owners_v3068(actor,p_payload->'inventoryIds');
 end if;
$guard$ from first_at for last_at-first_at);
  execute prior;
end
$group$;

notify pgrst,'reload schema';
commit;
