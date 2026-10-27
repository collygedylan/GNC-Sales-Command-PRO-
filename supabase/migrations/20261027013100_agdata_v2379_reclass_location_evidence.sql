begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '10s';

-- The photo-match remainder formula belongs to the evidence source row only.
-- Destination season rows are siblings at that location and inherit the
-- registry's current location evidence instead of consuming the source's
-- remaining-photo calculation with their own season quantity.
do $migration$
declare
  target regprocedure := 'private.sync_master_inventory_canonical_v2362()'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_text text := $old$canonical_current:=coalesce(private.inventory_location_evidence_qty_v2(
    canonical_baseline,canonical_initial,current_on_hand),evidence.current_photo_match_qty,
    new.loc_photo_match,private.request_numeric_v2362(new.loc_match_qty));$old$;
  new_text text := $new$canonical_current:=case
    when new.unique_id=evidence.source_unique_id
      or upper(btrim(coalesce(new.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')))
      then coalesce(private.inventory_location_evidence_qty_v2(
        canonical_baseline,canonical_initial,current_on_hand),evidence.current_photo_match_qty,
        new.loc_photo_match,private.request_numeric_v2362(new.loc_match_qty))
    else coalesce(evidence.current_photo_match_qty,new.loc_photo_match,
        private.request_numeric_v2362(new.loc_match_qty),
        private.inventory_location_evidence_qty_v2(canonical_baseline,canonical_initial,current_on_hand))
  end;$new$;
begin
  if position('v2379_non_source_evidence_qty' in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'AGDATA_V2379_LOCATION_EVIDENCE_ANCHOR_MISMATCH';
  end if;
  definition:=replace(definition,old_text,new_text||E'\n  -- v2379_non_source_evidence_qty');
  execute definition;
end
$migration$;

-- Refresh only the known repaired physical tuple, and only when the source
-- row, destination quantities, and active evidence still match the reviewed
-- state. A no-op quantity update runs the canonical evidence triggers.
do $repair$
declare refreshed integer;
begin
  update public.ph_master_inventory destination set ptronhand=destination.ptronhand
  from public.ph_master_inventory source
  join app_sync_private.inventory_location_evidence_v1 evidence
    on evidence.itemcode_key=upper(btrim(source.itemcode))
   and evidence.locationcode_key=upper(btrim(source.locationcode))
  where source.itemcode='004103.010.1' and source.locationcode='C.15.000' and source.lotcode='27.S1'
    and private.reclass_numeric_v1(source.ptronhand)=532
    and private.reclass_numeric_v1(source.ptravailable)=532 and source.spec='8-10" H'
    and destination.itemcode=source.itemcode and destination.locationcode=source.locationcode
    and destination.lotcode='27.F1'
    and private.reclass_numeric_v1(destination.ptronhand)=276
    and private.reclass_numeric_v1(destination.ptravailable)=276
    and private.reclass_numeric_v1(destination.s_lts)=0
    and destination.spec is null and evidence.spec='8-10" H'
    and evidence.cleared_at is null and (evidence.expires_at is null or clock_timestamp()<=evidence.expires_at)
    and coalesce(private.reclass_numeric_v1(evidence.current_photo_match_qty::text),0)>0;
  get diagnostics refreshed=row_count;
  if refreshed>1 then raise exception 'AGDATA_V2379_LOCATION_EVIDENCE_REPAIR_AMBIGUOUS'; end if;
  if exists(select 1 from public.ph_master_inventory destination
    where destination.itemcode='004103.010.1' and destination.locationcode='C.15.000'
      and destination.lotcode='27.F1' and private.reclass_numeric_v1(destination.ptronhand)=276
      and private.reclass_numeric_v1(destination.ptravailable)=276 and destination.spec is null
      and exists(select 1 from app_sync_private.inventory_location_evidence_v1 evidence
        where evidence.itemcode_key='004103.010.1' and evidence.locationcode_key='C.15.000'
          and evidence.spec='8-10" H' and evidence.cleared_at is null
          and coalesce(private.reclass_numeric_v1(evidence.current_photo_match_qty::text),0)>0)) then
    raise exception 'AGDATA_V2379_LOCATION_EVIDENCE_REPAIR_NOT_APPLIED';
  end if;
end
$repair$;

notify pgrst,'reload schema';
commit;
