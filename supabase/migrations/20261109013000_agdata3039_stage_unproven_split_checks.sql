begin;

-- Proven rows already have a validated insert path. Run the expensive
-- family and lineage proof only for candidates that still need it.
do $repair$
declare
  target regprocedure:='public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure;
  definition text:=pg_get_functiondef(target);
  previous constant text:=$old$  insert into pg_temp.ph_master_proven_new_ids_v1(unique_id)
  select s.unique_id from pg_temp.ph_master_bulk_stage_v1 s
  join pg_temp.ph_master_bulk_map_v1 m using(row_number)
  where m.canonical_unique_id is null and private.is_master_priority_split_v1(p_request_id,s.unique_id)
  on conflict do nothing;$old$;
  ordered constant text:=$new$  with unproven as materialized (
    select s.unique_id from pg_temp.ph_master_bulk_stage_v1 s
    join pg_temp.ph_master_bulk_map_v1 m using(row_number)
    where m.canonical_unique_id is null and not exists(
      select 1 from pg_temp.ph_master_proven_new_ids_v1 proven where proven.unique_id=s.unique_id
    )
  )
  insert into pg_temp.ph_master_proven_new_ids_v1(unique_id)
  select u.unique_id from unproven u
  where private.is_master_priority_split_v1(p_request_id,u.unique_id)
  on conflict do nothing;$new$;
  movement_overlay constant text:='  perform private.apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id);';
  live_overrides constant text:='  perform private.apply_inventory_live_overrides_bulk_v1(p_run_id);';
  canonical_overlays text:=movement_overlay||chr(10)||live_overrides;
begin
  if cardinality(string_to_array(definition,ordered))<>2
      and cardinality(string_to_array(definition,previous))<>2 then
    raise exception 'AGDATA3039_STAGE_SPLIT_CHECK_ANCHOR_CHANGED';
  end if;
  if cardinality(string_to_array(definition,canonical_overlays))<>2 then
    if cardinality(string_to_array(definition,movement_overlay))<>2 then
      raise exception 'AGDATA3039_STAGE_OVERLAY_ANCHOR_CHANGED';
    end if;
    definition:=replace(definition,movement_overlay,canonical_overlays);
  end if;
  execute replace(definition,previous,ordered);
end
$repair$;

-- Join on indexed lineage and stable identities before calling the split
-- proof. A predicate in either join could be pushed onto every input row.
do $repair$
declare
  target regprocedure:='public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure;
  definition text:=pg_get_functiondef(target);
  previous constant text:=$old$  ), candidates as materialized (
    select s.row_number, m.unique_id as canonical_unique_id
    from pg_temp.ph_master_bulk_stage_v1 s
    join public.ph_master_inventory m on m.unique_id = s.unique_id
    union all
    select s.row_number, m.unique_id
    from unresolved s
    join app_sync_private.ph_master_inventory_source_baselines b on b.lineage_key = s.lineage_key
    join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
    where not private.is_master_priority_split_v1(p_request_id,s.unique_id)
    union all
    select s.row_number, m.unique_id
    from unresolved s
    join app_sync_private.ph_master_inventory_item6_source_v7 item6
      on item6.stable_identity_key = s.stable_identity_key
    join public.ph_master_inventory m on m.unique_id = item6.canonical_unique_id
      and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 edit
        where edit.canonical_unique_id = m.unique_id and edit.pending
          and edit.field_name in ('desigitem','desigcust','desigloc'))
    where not private.is_master_priority_split_v1(p_request_id,s.unique_id)
  )$old$;
  ordered constant text:=$new$  ), aliases as materialized (
    select s.row_number,s.unique_id as source_uid,m.unique_id as canonical_unique_id
    from unresolved s
    join app_sync_private.ph_master_inventory_source_baselines b on b.lineage_key=s.lineage_key
    join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
    union all
    select s.row_number,s.unique_id,m.unique_id
    from unresolved s
    join app_sync_private.ph_master_inventory_item6_source_v7 item6
      on item6.stable_identity_key=s.stable_identity_key
    join public.ph_master_inventory m on m.unique_id=item6.canonical_unique_id
      and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 edit
        where edit.canonical_unique_id=m.unique_id and edit.pending
          and edit.field_name in ('desigitem','desigcust','desigloc'))
  ), alias_sources as materialized (
    select distinct source_uid from aliases
  ), split_sources as materialized (
    select source_uid from alias_sources where private.is_master_priority_split_v1(p_request_id,source_uid)
  ), candidates as materialized (
    select a.row_number,a.canonical_unique_id from aliases a
    where not exists(select 1 from split_sources split where split.source_uid=a.source_uid)
  )$new$;
  production_previous text:=replace(previous,'where edit.canonical_unique_id = m.unique_id',
    'where edit.canonical_unique_id = item6.canonical_unique_id');
begin
  if cardinality(string_to_array(definition,ordered))=2 then return; end if;
  if cardinality(string_to_array(definition,previous))+cardinality(string_to_array(definition,production_previous))<>3 then
    raise exception 'AGDATA3039_STAGE_ALIAS_SPLIT_ANCHOR_CHANGED';
  end if;
  execute replace(replace(definition,previous,ordered),production_previous,ordered);
end
$repair$;

-- Group the first source for each resolved UID once. The previous anti-join
-- walked an increasing UID prefix for every row before filtering proven inserts.
do $repair$
declare
  target regprocedure:='public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure;
  definition text:=pg_get_functiondef(target);
  previous_head constant text:=$old$      'with affected as (
         insert into public.ph_master_inventory as target (%s)$old$;
  ordered_head constant text:=$new$      'with first_sources as materialized (
         select min(candidate.unique_id) as first_uid
         from pg_temp.ph_master_bulk_stage_v1 candidate
         join pg_temp.ph_master_bulk_map_v1 candidate_map using(row_number)
         where candidate.raw_item6_fields=$1 and candidate.field_keys=$2
         group by coalesce(candidate_map.canonical_unique_id,candidate.unique_id)
       ), affected as (
         insert into public.ph_master_inventory as target (%s)$new$;
  previous_filter constant text:=$old$           and not exists(
             select 1
             from pg_temp.ph_master_bulk_stage_v1 duplicate_s
             join pg_temp.ph_master_bulk_map_v1 duplicate_mapped using (row_number)
             where duplicate_s.raw_item6_fields = s.raw_item6_fields
               and duplicate_s.field_keys = s.field_keys
               and (
                 coalesce(duplicate_mapped.canonical_unique_id, duplicate_s.unique_id)
                   = coalesce(mapped.canonical_unique_id, s.unique_id)

               )
               and duplicate_s.unique_id < s.unique_id
           )$old$;
  ordered_filter constant text:='           and s.unique_id in (select first_uid from first_sources)';
begin
  if cardinality(string_to_array(definition,ordered_head))=2
      and cardinality(string_to_array(definition,ordered_filter))=2 then return; end if;
  if cardinality(string_to_array(definition,previous_head))<>2
      or cardinality(string_to_array(definition,previous_filter))<>2 then
    raise exception 'AGDATA3039_STAGE_ORDINAL_FILTER_ANCHOR_CHANGED';
  end if;
  execute replace(replace(definition,previous_head,ordered_head),previous_filter,ordered_filter);
end
$repair$;

-- The staged publisher has only the typed ERP columns. The direct publisher
-- also carries app-only columns. Preserve only fields available to each stage.
do $repair$
declare
  target regprocedure:='private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure;
  definition text:=pg_get_functiondef(target);
  previous constant text:=$old$    select distinct e.field_name from app_sync_private.inventory_live_overrides_v1 e
    where e.pending order by e.field_name$old$;
  ordered constant text:=$new$    select distinct e.field_name from app_sync_private.inventory_live_overrides_v1 e
    join pg_catalog.pg_attribute field on field.attrelid='pg_temp.ph_master_bulk_stage_v1'::regclass
      and field.attnum>0 and not field.attisdropped and field.attname=e.field_name
    where e.pending and exists(
      select 1 from pg_temp.ph_master_bulk_map_v1 mapped
      where mapped.canonical_unique_id=e.canonical_unique_id and mapped.candidate_count=1
    )
    order by e.field_name$new$;
begin
  if cardinality(string_to_array(definition,ordered))=2 then return; end if;
  if cardinality(string_to_array(definition,previous))<>2 then
    raise exception 'AGDATA3039_STAGE_OVERRIDE_FIELDS_ANCHOR_CHANGED';
  end if;
  execute replace(definition,previous,ordered);
end
$repair$;

commit;
