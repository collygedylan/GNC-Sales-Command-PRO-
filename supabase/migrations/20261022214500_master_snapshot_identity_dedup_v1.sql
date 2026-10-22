begin;

do $migration$
declare
  function_oid oid := 'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
  function_definition text;
  anchor text := $anchor$               and coalesce(duplicate_mapped.canonical_unique_id, duplicate_s.unique_id)
                 = coalesce(mapped.canonical_unique_id, s.unique_id)
               and duplicate_s.unique_id < s.unique_id$anchor$;
  replacement text := $replacement$               and (
                 coalesce(duplicate_mapped.canonical_unique_id, duplicate_s.unique_id)
                   = coalesce(mapped.canonical_unique_id, s.unique_id)
                 or duplicate_s.lineage_key = s.lineage_key
                 or duplicate_s.stable_identity_key = s.stable_identity_key
               )
               and duplicate_s.unique_id < s.unique_id$replacement$;
begin
  select pg_get_functiondef(function_oid) into function_definition;
  if length(function_definition) - length(replace(function_definition, anchor, '')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_IDENTITY_DEDUP_ANCHOR_INVALID';
  end if;
  execute replace(function_definition, anchor, replacement);
end
$migration$;

commit;
