begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- The active Edge path commits through the set-based private batch function.
-- Clone the full durable source evidence and keep the exact location photo
-- quantity; it is location evidence, not moved-quantity times match percent.
do $migration$
declare
  target regprocedure := 'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_text text;
  new_text text;
begin
  if position('reclass-batch-evidence-v2387' in definition) > 0 then return; end if;

  old_text := '''photo_url'',''photos'',''photo_date'',''spec'',''caliper'',''loc_match_pct'',''av_note'',''pick_note'',''sales_note'',''locationnote'',''locationptn1''';
  new_text := '''photo_url'',''photo_link'',''photo_name'',''photo_expires_at'',''photos'',''photo_date'',''date_completed'',''spec'',''caliper'',''loc_match_pct'',''loc_match_qty'',''loc_photo_match'',''match'',''initial_photo_match_qty'',''pic_note'',''av_note'',''pick_note'',''sales_note'',''locationnote'',''locationptn1''';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2387_BATCH_EVIDENCE_FIELDS_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,old_text,new_text);

  old_text := $old$||jsonb_build_object('loc_photo_match',case
      when private.reclass_numeric_v1(sj.source_before->>'loc_match_pct')>0
        then round(t.quantity*private.reclass_numeric_v1(sj.source_before->>'loc_match_pct')/100.0)
      else null end)$old$;
  new_text := $new$||jsonb_build_object('loc_photo_match',case
      -- reclass-batch-evidence-v2387: retain exact location evidence on both rows.
      when nullif(btrim(sj.source_before->>'loc_photo_match'),'') is not null
        then private.reclass_numeric_v1(sj.source_before->>'loc_photo_match')
      when private.reclass_numeric_v1(sj.source_before->>'loc_match_pct')>0
        then round(t.quantity*private.reclass_numeric_v1(sj.source_before->>'loc_match_pct')/100.0)
      else null end)$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text) <> 1 then
    raise exception 'AGDATA_V2387_BATCH_PHOTO_MATCH_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,old_text,new_text);
end
$migration$;

do $contracts$
declare definition text := pg_get_functiondef('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure);
begin
  if position('reclass-batch-evidence-v2387' in definition)=0
    or position('''photo_link''' in definition)=0
    or position('''pick_note''' in definition)=0
    or position('source_before->>''loc_photo_match''' in definition)=0 then
    raise exception 'AGDATA_V2387_BATCH_EVIDENCE_UNCONFIRMED';
  end if;
end
$contracts$;

notify pgrst,'reload schema';
commit;
