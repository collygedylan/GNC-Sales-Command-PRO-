begin;
set local statement_timeout='30s';
set local lock_timeout='10s';
DO $patch$
declare definition text:=pg_get_functiondef('public.submit_eval_work_v2_legacy_impl'::regproc);
begin
 if position('agdata316_eval_work_explicit_note' in definition)>0 then return; end if;
 if md5(definition)<>'202f294e068048434ccca4427daac1aa' then raise exception 'AG316_EVAL_WORK_DEFINITION_CHANGED'; end if;
 definition:=replace(definition,$before$  av_note_value text;$before$,$after$  av_note_value text;
  av_note_prior_context text;$after$);
 definition:=replace(definition,$before$    av_note_value := coalesce(nullif(trim(coalesce(evidence->>'avNote', evidence->>'av_note', '')), ''), origin.av_note, '');$before$,$after$    -- agdata316_eval_work_explicit_note: preserve the authorized exact-origin edit, including blank.
    av_note_value := case when evidence->'explicit_av_note'='true'::jsonb
      then coalesce(evidence->>'av_note',evidence->>'avNote','')
      else coalesce(nullif(trim(coalesce(evidence->>'avNote', evidence->>'av_note', '')), ''), origin.av_note, '') end;$after$);
 definition:=replace(definition,$before$    update public.ph_master_inventory set$before$,$after$    av_note_prior_context := current_setting('app.explicit_av_note_v316',true);
    perform private.set_explicit_av_note_v316(jsonb_build_object(
      'explicit_av_note',evidence->'explicit_av_note','av_note',coalesce(evidence->'av_note',evidence->'avNote')),to_jsonb(origin));
    update public.ph_master_inventory set$after$);
 definition:=replace(definition,$before$    perform private.sync_item_detail_photos_v308(origin.unique_id, photo_links);$before$,$after$    perform private.sync_item_detail_photos_v308(origin.unique_id, photo_links);
    perform set_config('app.explicit_av_note_v316',coalesce(av_note_prior_context,''),true);$after$);
 execute definition;
end
$patch$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261107001602','agdata316_eval_work_explicit_note',ARRAY['Honor exact-origin explicit AV Note in Eval Work']) ON CONFLICT(version) DO NOTHING;
COMMIT;
