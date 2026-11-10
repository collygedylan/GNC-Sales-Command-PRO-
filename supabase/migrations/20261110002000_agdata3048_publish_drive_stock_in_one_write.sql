begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Resolve stock from immutable Argos cells before overlays. Do not derive
-- provenance from typed stage quantities that Reclass and live edits replace.
do $stage$
declare
  definition text := pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
  anchor text := 'e.value->''values'' as raw_values,';
begin
  if strpos(definition,anchor)=0 then raise exception 'ERP_DRIVE_RAW_STOCK_PRELOAD_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||$fields$
         private.inventory_location_evidence_number_v2(e.value->'values'->>'ptronhand') as frozen_erp_on_hand_v3048,
         private.inventory_location_evidence_number_v2(e.value->'values'->>'ptrreviewed') as frozen_erp_review_v3048,
         private.inventory_location_evidence_number_v2(e.value->'values'->>'ptravailable') as frozen_erp_available_v3048,$fields$);
end
$stage$;

-- Include raw stock and provenance in the same physical UPDATE for exact and
-- proven alias rows. Keep the fallback for new or unresolved alias rows.
do $direct$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  fields_anchor text := '      and not (f.column_name = any(protected_fields));';
  update_anchor text := '    direct_set_values := replace(set_values, ''excluded'', ''s'');';
  condition_anchor text := ') and (%s)) or private.ph_master_bulk_pending_ack_v1(target.unique_id, s.raw_values))';
  stock_delta text := $delta$(target.erp_on_hand,target.erp_ptrreview,target.erp_available,target.erp_source_present)
             is distinct from (s.frozen_erp_on_hand_v3048,s.frozen_erp_review_v3048,s.frozen_erp_available_v3048,true)$delta$;
begin
  if strpos(definition,fields_anchor)=0 or strpos(definition,update_anchor)=0 or strpos(definition,condition_anchor)=0 then
    raise exception 'ERP_DRIVE_STOCK_UPDATE_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,fields_anchor,replace(fields_anchor,'protected_fields','protected_fields ||
        array[''erp_on_hand'',''erp_ptrreview'',''erp_available'',''erp_source_filename'',''erp_source_present'']'));
  definition:=replace(definition,condition_anchor,left(condition_anchor,-1)||' or ('||stock_delta||'))');
  execute replace(definition,update_anchor,$update$    direct_set_values := replace(set_values, 'excluded', 's') ||
      ',erp_on_hand=s.frozen_erp_on_hand_v3048,erp_ptrreview=s.frozen_erp_review_v3048,
        erp_available=s.frozen_erp_available_v3048,erp_source_present=true,
        erp_source_filename=case when $update$||stock_delta||$update$
          then coalesce(s.raw_values->>''filename'',case when ''filename''=any(s.field_keys) then s.filename else target.filename end)
          else target.erp_source_filename end';$update$);
end
$direct$;

do $fallback$
declare
  definition text := pg_get_functiondef('private.apply_erp_master_provenance_v3042()'::regprocedure);
  raw_field text;
  typed_field text;
  anchor text;
begin
  for raw_field,typed_field in select * from (values ('ptronhand','frozen_erp_on_hand_v3048'),
    ('ptrreviewed','frozen_erp_review_v3048'),('ptravailable','frozen_erp_available_v3048')) fields(raw,typed)
  loop
    anchor:=format('private.inventory_location_evidence_number_v2(s.raw_values->>%L)',raw_field);
    if strpos(definition,anchor)=0 then raise exception 'ERP_DRIVE_STOCK_FALLBACK_ANCHOR_MISSING'; end if;
    definition:=replace(definition,anchor,format('s.%I',typed_field));
  end loop;
  execute definition;
end
$fallback$;

commit;
