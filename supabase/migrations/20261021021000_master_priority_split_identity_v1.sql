begin;

-- PH source UIDs include designation and priority. A complete stage can add
-- one priority-distinct row while retaining every old stable-family UID.
-- Prove the complete family; never infer ownership from a source UID prefix.
create or replace function private.is_master_priority_split_v1(p_request_id uuid,p_source_uid text)
returns boolean language sql stable security definer set search_path=''
as $function$
  with incoming as materialized (
    select s.* from app_sync_private.ph_master_snapshot_stage_rows_v1 s
    join app_sync_private.ph_master_snapshot_stage_v1 h using(request_id)
    where s.request_id=p_request_id and s.unique_id=p_source_uid and h.status='staging'
      and not exists(select 1 from public.ph_master_inventory m where m.unique_id=s.unique_id)
  ), family as materialized (
    select f.* from app_sync_private.ph_master_snapshot_stage_rows_v1 f
    join incoming s on f.request_id=s.request_id and f.stable_identity_key=s.stable_identity_key
  ), live_family as materialized (
    select m.unique_id,m.priority,b.lineage_key,b.priority as source_priority,v.stable_identity_key
    from public.ph_master_inventory m join incoming s
      on coalesce(m.warehouseid,'')=coalesce(s.raw_values->>'warehouseid','')
      and coalesce(m.itemcode,'')=coalesce(s.raw_values->>'itemcode','')
      and coalesce(m.contsize,'')=coalesce(s.raw_values->>'contsize','')
      and coalesce(m.locationcode,'')=coalesce(s.raw_values->>'locationcode','')
      and coalesce(m.lotcode,'')=coalesce(s.raw_values->>'lotcode','')
      and coalesce(m.source,'')=coalesce(s.raw_values->>'source','')
    left join app_sync_private.ph_master_inventory_source_baselines b on b.canonical_unique_id=m.unique_id
    left join app_sync_private.ph_master_inventory_item6_source_v7 v on v.canonical_unique_id=m.unique_id
  )
  select exists(select 1 from incoming s
    where coalesce(s.raw_values->>'warehouseid','')='10' and exists(select 1 from live_family)
      -- Exactly one new UID. Other designations may share its priority only
      -- when those separate physical rows retain their exact source UIDs.
      and (select count(*) from family)=(select count(*) from live_family)+1
      and (select count(*) from family f where not exists(
        select 1 from public.ph_master_inventory m where m.unique_id=f.unique_id))=1
      -- Null is explicit source data, not omission or a fabricated zero.
      -- Reconstruct PH Code.gs UIDs; counter-suffixed duplicates are not proof.
      and not exists(select 1 from family f
        where not (f.raw_values ? 'priority') or jsonb_typeof(f.raw_values->'priority') not in('string','null')
          or f.unique_id is distinct from regexp_replace(
            coalesce(btrim(f.raw_values->>'itemcode'),'')||'-'||coalesce(btrim(f.raw_values->>'contsize'),'')||'-'||
            coalesce(btrim(f.raw_values->>'locationcode'),'')||'-'||coalesce(btrim(f.raw_values->>'lotcode'),'')||'-'||
            coalesce(btrim(f.raw_values->>'source'),'')||'-'||coalesce(btrim(f.raw_values->>'desigitem'),'')||'-'||
            coalesce(btrim(f.raw_values->>'desigcust'),'')||'-'||coalesce(btrim(f.raw_values->>'desigloc'),'')||'-'||
            coalesce(btrim(f.raw_values->>'priority'),''),'[^a-zA-Z0-9-]','_','g'))
      and not exists(select 1 from family f
        group by f.lineage_key,coalesce(btrim(f.raw_values->>'priority'),'') having count(*)>1)
      -- The coarse v6 candidate is exactly one priority-distinct sibling.
      -- Every live sibling, including different designations, is retained.
      and (select count(*) from live_family m where m.lineage_key=s.lineage_key)=1
      and exists(select 1 from live_family m where m.lineage_key=s.lineage_key
        and m.source_priority is distinct from (s.raw_values->>'priority'))
      and not exists(select 1 from live_family m where not exists(
        select 1 from family f where f.unique_id=m.unique_id
          and m.lineage_key=f.lineage_key and m.stable_identity_key=s.stable_identity_key
          and m.priority is not distinct from m.source_priority
          and f.raw_values->>'priority' is not distinct from m.source_priority))
      -- Incoming UID claims include orphan ledgers. Unrelated old SELF aliases
      -- do not claim this new UID; crosscanonical retained aliases do.
      and not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a
        where a.imported_unique_id=s.unique_id or a.canonical_unique_id=s.unique_id)
      and not exists(select 1 from app_sync_private.ph_master_inventory_source_baselines b where b.canonical_unique_id=s.unique_id)
      and not exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 v where v.canonical_unique_id=s.unique_id)
      and not exists(select 1 from app_sync_private.ph_master_bulk_import_source_v1 b
        where b.source_unique_id=s.unique_id or b.canonical_unique_id=s.unique_id)
      and not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a
        join live_family m on m.unique_id=a.imported_unique_id where a.canonical_unique_id<>a.imported_unique_id)
      and not exists(select 1 from private.ph_inventory_reclass_import_aliases_v1 a
        where a.lineage_key=s.lineage_key or a.lineage_key in(select lineage_key from live_family))
      -- Identity and prior-lineage checks include stale/orphan pending edits.
      and not exists(select 1 from app_sync_private.ph_master_inventory_app_edits e
        where e.pending_legacy_sync and (e.lineage_key=s.lineage_key or e.lineage_key in(select lineage_key from live_family)
          or e.canonical_unique_id in(select unique_id from family union select unique_id from live_family)
          or exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 v
            where v.canonical_unique_id=e.canonical_unique_id and v.stable_identity_key=s.stable_identity_key)
          or exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a
            where a.canonical_unique_id=e.canonical_unique_id and a.stable_identity_key=s.stable_identity_key)))
      and not exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
        where e.pending and (e.stable_identity_key=s.stable_identity_key
          or e.canonical_unique_id in(select unique_id from family union select unique_id from live_family)))
      and not exists(select 1 from private.ph_inventory_reclass_movements_v1 movement
        where movement.status in('pending','conflict') and (
          movement.source_lineage_key=s.lineage_key or movement.destination_lineage_key=s.lineage_key
          or movement.source_lineage_key in(select lineage_key from live_family)
          or movement.destination_lineage_key in(select lineage_key from live_family)
          or movement.source_unique_id in(select unique_id from family union select unique_id from live_family)
          or movement.destination_unique_id in(select unique_id from family union select unique_id from live_family)
          or private.ph_master_inventory_stable_identity_v7(movement.source_before)=s.stable_identity_key
          or private.ph_master_inventory_stable_identity_v7(movement.source_after)=s.stable_identity_key
          or private.ph_master_inventory_stable_identity_v7(movement.destination_before)=s.stable_identity_key
          or private.ph_master_inventory_stable_identity_v7(movement.destination_after)=s.stable_identity_key))
  );
$function$;
revoke all on function private.is_master_priority_split_v1(uuid,text) from public,anon,authenticated,service_role;

do $preserve_priority_splits$
declare
  function_oid oid:='public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
  definition text; anchor text; replacement text;
  owner_before oid; acl_before aclitem[]; config_before text[]; security_before boolean;
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
  into definition,owner_before,acl_before,config_before,security_before from pg_proc p where p.oid=function_oid;
  if strpos(definition,'private.is_master_priority_split_v1(p_request_id,s.unique_id)')=0 then
    anchor:=$anchor$    join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
    union all$anchor$;
    replacement:=$body$    join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
    where not private.is_master_priority_split_v1(p_request_id,s.unique_id)
    union all$body$;
    if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
      raise exception 'MASTER_PRIORITY_SPLIT_V6_MAPPING_ANCHOR_INVALID'; end if;
    definition:=replace(definition,anchor,replacement);
    anchor:=$anchor$          and edit.field_name in ('desigitem','desigcust','desigloc'))
  )$anchor$;
    replacement:=$body$          and edit.field_name in ('desigitem','desigcust','desigloc'))
    where not private.is_master_priority_split_v1(p_request_id,s.unique_id)
  )$body$;
    if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
      raise exception 'MASTER_PRIORITY_SPLIT_V7_MAPPING_ANCHOR_INVALID'; end if;
    definition:=replace(definition,anchor,replacement);
    anchor:=$anchor$  analyze pg_temp.ph_master_proven_new_ids_v1;$anchor$;
    replacement:=$body$  -- Reuse the existing private run/PID/transaction guarded INSERT;
  -- its source/v6/v7 baseline publication and ordinary conflict fallback remain.
  insert into pg_temp.ph_master_proven_new_ids_v1(unique_id)
  select s.unique_id from pg_temp.ph_master_bulk_stage_v1 s
  join pg_temp.ph_master_bulk_map_v1 m using(row_number)
  where m.canonical_unique_id is null and private.is_master_priority_split_v1(p_request_id,s.unique_id)
  on conflict(unique_id) do nothing;
  analyze pg_temp.ph_master_proven_new_ids_v1;$body$;
    if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
      raise exception 'MASTER_PRIORITY_SPLIT_PROVEN_INSERT_ANCHOR_INVALID'; end if;
    definition:=replace(definition,anchor,replacement);
    execute definition;
  end if;
  select pg_get_functiondef(function_oid) into definition;
  anchor:='where not private.is_master_priority_split_v1(p_request_id,s.unique_id)';
  if length(definition)-length(replace(definition,anchor,''))<>2*length(anchor)
     or strpos(definition,'m.canonical_unique_id is null and private.is_master_priority_split_v1(p_request_id,s.unique_id)')=0
     or strpos(definition,'BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS')=0
     or strpos(definition,'private.apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id)')=0
     or strpos(definition,'app_sync_private.ph_master_new_insert_statement_v1')=0
     or strpos(definition,'insert into app_sync_private.ph_master_inventory_source_baselines(')=0
     or strpos(definition,'insert into app_sync_private.ph_master_inventory_item6_source_v7(')=0 then
    raise exception 'MASTER_PRIORITY_SPLIT_FINALIZER_CONTRACT_INVALID'; end if;
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'MASTER_PRIORITY_SPLIT_SECURITY_CHANGED'; end if;
end
$preserve_priority_splits$;

notify pgrst,'reload schema';
commit;
