begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Post-write alias resolution already proves each mapped canonical UID exists.
-- Reuse that exact map for source witnesses instead of reopening the trigger
-- context and resolving the same aliases twice from private history tables.
do $witnesses$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  identity_proof text := $proof$raise exception using errcode='PT409', message = 'BULK_MASTER_IMPORT_CONCURRENT_ROW_CHANGE';$proof$;
  location_at integer := strpos(definition,'  update app_sync_private.ph_master_inventory_item6_source_v7 i');
  source_at integer := strpos(definition,'  insert into app_sync_private.ph_master_bulk_import_source_v1(');
  conflict_at integer := strpos(definition,'  on conflict (canonical_unique_id) do update set');
  source_span text;
begin
  if strpos(definition,identity_proof)=0 or location_at<=strpos(definition,identity_proof)
    or source_at<=location_at or conflict_at<=source_at then
    raise exception 'ERP_DRIVE_FINAL_IDENTITY_WITNESS_ANCHOR_MISSING';
  end if;
  source_span:=substring(definition from location_at for conflict_at-location_at);
  if regexp_count(source_span,'ph_master_bulk_context_v3046')<>2
    or regexp_count(source_span,'ph_master_inventory_import_lineage_seen')<>2
    or regexp_count(source_span,'ph_master_inventory_item6_alias_seen_v7')<>2 then
    raise exception 'ERP_DRIVE_FINAL_IDENTITY_WITNESS_SHAPE_CHANGED';
  end if;
  execute overlay(definition placing $source$  if exists(select 1 from pg_temp.ph_master_bulk_tuples_v3046
    where raw_item6_fields @> array['locationnote']) then
    with notes as (
      select distinct on (mapped.canonical_unique_id)
        mapped.canonical_unique_id,s.raw_values->'locationnote' as raw_note
      from pg_temp.ph_master_bulk_map_v1 mapped join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
      where s.raw_item6_fields @> array['locationnote']
      order by mapped.canonical_unique_id,s.unique_id
    )
    update app_sync_private.ph_master_inventory_item6_source_v7 i
    set field_values=jsonb_set(i.field_values,'{locationnote}',notes.raw_note,true),
        imported_at=clock_timestamp(),import_run_id=p_run_id
    from notes where i.canonical_unique_id=notes.canonical_unique_id
      and i.field_values->'locationnote' is distinct from notes.raw_note;
  end if;

  insert into app_sync_private.ph_master_bulk_import_source_v1(
    canonical_unique_id, source_unique_id, source_hash, import_run_id
  )
  select distinct on (mapped.canonical_unique_id)
    mapped.canonical_unique_id,s.unique_id,s.source_hash,p_run_id
  from pg_temp.ph_master_bulk_map_v1 mapped join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
  order by mapped.canonical_unique_id,s.unique_id
$source$ from location_at for conflict_at-location_at);
end
$witnesses$;

commit;
