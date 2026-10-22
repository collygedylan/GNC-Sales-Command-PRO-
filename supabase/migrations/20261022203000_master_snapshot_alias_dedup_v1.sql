begin;

do $migration$
declare
  function_oid oid;
  function_definition text;
  anchor text := $anchor$           and not exists(select 1 from pg_temp.ph_master_new_insert_ids_v1 ni where ni.unique_id=s.unique_id)$anchor$;
  replacement text := $replacement$           and not exists(select 1 from pg_temp.ph_master_new_insert_ids_v1 ni where ni.unique_id=s.unique_id)
           and not exists(
             select 1
             from pg_temp.ph_master_bulk_stage_v1 duplicate_s
             join pg_temp.ph_master_bulk_map_v1 duplicate_mapped using (row_number)
             where duplicate_s.raw_item6_fields = s.raw_item6_fields
               and duplicate_s.field_keys = s.field_keys
               and coalesce(duplicate_mapped.canonical_unique_id, duplicate_s.unique_id)
                 = coalesce(mapped.canonical_unique_id, s.unique_id)
               and duplicate_s.unique_id < s.unique_id
           )$replacement$;
begin
  foreach function_oid in array array[
    'public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure,
    'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure
  ] loop
    select pg_get_functiondef(function_oid) into function_definition;
    if length(function_definition) - length(replace(function_definition, anchor, '')) <> length(anchor) then
      raise exception 'MASTER_SNAPSHOT_ALIAS_DEDUP_ANCHOR_INVALID';
    end if;
    execute replace(function_definition, anchor, replacement);
  end loop;
end
$migration$;

commit;
