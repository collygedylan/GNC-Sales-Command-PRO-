begin;
-- AgData 3.0.10: optional evaluation evidence; preserve actor, exact origin, lifecycle and durable publication.
-- Replace only observed installed guards. Existing function ownership and grants are unchanged.

do $migration$
declare
  definition text := pg_get_functiondef('public.submit_eval_work_v2_legacy_impl'::regproc);
  before_text text;
  after_text text;
begin
  if strpos(definition, 'agdata310_optional_evidence') > 0 then return; end if;
  before_text := $before$  photo_path text;$before$;
  after_text := $after$  photo_path text;
  canonical_photo_links text;$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$spec_value := trim(coalesce(evidence->>'spec', ''));$before$;
  after_text := $after$spec_value := coalesce(nullif(trim(evidence->>'spec'), ''), nullif(trim(origin.spec), ''), 'N/A');$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$av_note_value := trim(coalesce(evidence->>'avNote', evidence->>'av_note', ''));$before$;
  after_text := $after$av_note_value := coalesce(nullif(trim(coalesce(evidence->>'avNote', evidence->>'av_note', '')), ''), origin.av_note, '');$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$if jsonb_typeof(photos) <> 'array' or jsonb_array_length(photos) = 0 then raise exception using errcode = '22023', message = 'eval_work_photo_required'; end if;$before$;
  after_text := $after$if jsonb_typeof(photos) <> 'array' then raise exception using errcode = '22023', message = 'eval_work_photos_invalid'; end if;$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$    if spec_value = '' then raise exception using errcode = '22023', message = 'eval_work_spec_required'; end if;
$before$;
  after_text := $after$$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$    if av_note_value = '' then raise exception using errcode = '22023', message = 'eval_work_av_note_required'; end if;
$before$;
  after_text := $after$$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$begin match_value := trim(coalesce(evidence->>'locMatchPercent', evidence->>'loc_match_percent', ''))::numeric;$before$;
  after_text := $after$begin match_value := nullif(trim(coalesce(evidence->>'locMatchPercent', evidence->>'loc_match_percent', '')), '')::numeric;$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$    for photo in select value from jsonb_array_elements(photos) loop$before$;
  after_text := $after$    -- agdata310_optional_evidence: trust only this authorized origin and its exact UID note.
    canonical_photo_links := private.collect_item_detail_photo_links_v308(null, null, null,
      jsonb_build_array(to_jsonb(origin), coalesce((select to_jsonb(note) from public.ph_location_sales_notes note where note.unique_id = origin.unique_id), '{}'::jsonb)));
    for photo in select value from jsonb_array_elements(photos) loop$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$if left(photo_path, length('eval/' || work.id::text || '/' || origin_row.origin_unique_id || '/'))
           <> 'eval/' || work.id::text || '/' || origin_row.origin_unique_id || '/'
         or position('..' in photo_path) > 0 then$before$;
  after_text := $after$if not (trim(coalesce(photo->>'url', '')) = any(string_to_array(coalesce(canonical_photo_links, ''), ',')))
         and (left(photo_path, length('eval/' || work.id::text || '/' || origin_row.origin_unique_id || '/'))
           <> 'eval/' || work.id::text || '/' || origin_row.origin_unique_id || '/'
         or position('..' in photo_path) > 0) then$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$    select string_agg(trim(value->>'url'), E'\n' order by ordinality)$before$;
  after_text := $after$    -- Preserve inherited URLs and aligned names without changing photo dates.
    photos := photos || coalesce((
      select jsonb_agg(jsonb_build_object('url', inherited.url, 'name', coalesce(nullif(split_part(coalesce(origin.photo_name, ''), ',', inherited.ordinality::integer), ''), 'eval-photo')) order by inherited.ordinality)
      from unnest(string_to_array(coalesce(canonical_photo_links, ''), ',')) with ordinality inherited(url, ordinality)
      where inherited.url <> '' and not exists (select 1 from jsonb_array_elements(photos) incoming where trim(coalesce(incoming->>'url', '')) = inherited.url)
    ), '[]'::jsonb);
    select string_agg(trim(value->>'url'), ',' order by ordinality)$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$string_agg(trim(coalesce(value->>'name', 'eval-photo')), E'\n' order by ordinality)$before$;
  after_text := $after$string_agg(trim(coalesce(value->>'name', 'eval-photo')), ',' order by ordinality)$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$    if coalesce(photo_links, '') = '' then raise exception using errcode = '22023', message = 'eval_work_committed_photo_required'; end if;
$before$;
  after_text := $after$$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$coalesce(origin.ptravailable, '')$before$;
  after_text := $after$coalesce(origin.ptronhand, '')$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$match = trim(to_char(match_value, 'FM999990.##'))$before$;
  after_text := $after$match = case when match_value is null then match else trim(to_char(match_value, 'FM999990.##')) end$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$loc_match_qty = case when ptr_value is null then loc_match_qty$before$;
  after_text := $after$loc_match_qty = case when ptr_value is null or match_value is null then loc_match_qty$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$    where unique_id = origin.unique_id;$before$;
  after_text := $after$    where unique_id = origin.unique_id;
    perform private.sync_item_detail_photos_v308(origin.unique_id, photo_links);$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_v2_legacy_impl anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  execute definition;
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('public.submit_eval_work_legacy_v1'::regproc);
  before_text text;
  after_text text;
begin
  if strpos(definition, 'agdata310_optional_evidence') > 0 then return; end if;
  before_text := $before$  photo_path text;$before$;
  after_text := $after$  photo_path text;
  canonical_photo_links text;$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$spec_value := trim(coalesce(p_evidence->>'spec', ''));$before$;
  after_text := $after$spec_value := coalesce(nullif(trim(p_evidence->>'spec'), ''), nullif(trim(origin.spec), ''), 'N/A');$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$av_note_value := trim(coalesce(p_evidence->>'avNote', ''));$before$;
  after_text := $after$av_note_value := coalesce(nullif(trim(coalesce(p_evidence->>'avNote', '')), ''), origin.av_note, '');$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$if jsonb_typeof(photos) <> 'array' or jsonb_array_length(photos) = 0 then raise exception using errcode = '22023', message = 'eval_work_photo_required'; end if;$before$;
  after_text := $after$if jsonb_typeof(photos) <> 'array' then raise exception using errcode = '22023', message = 'eval_work_photos_invalid'; end if;$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$  if spec_value = '' then raise exception using errcode = '22023', message = 'eval_work_spec_required'; end if;
$before$;
  after_text := $after$$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$  if av_note_value = '' then raise exception using errcode = '22023', message = 'eval_work_av_note_required'; end if;
$before$;
  after_text := $after$$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$begin match_value := trim(coalesce(p_evidence->>'locMatchPercent', ''))::numeric;$before$;
  after_text := $after$begin match_value := nullif(trim(coalesce(p_evidence->>'locMatchPercent', '')), '')::numeric;$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$  for photo in select value from jsonb_array_elements(photos) loop$before$;
  after_text := $after$  -- agdata310_optional_evidence: trust only this authorized origin and its exact UID note.
  canonical_photo_links := private.collect_item_detail_photo_links_v308(null, null, null,
    jsonb_build_array(to_jsonb(origin), coalesce((select to_jsonb(note) from public.ph_location_sales_notes note where note.unique_id = origin.unique_id), '{}'::jsonb)));
  for photo in select value from jsonb_array_elements(photos) loop$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$if left(photo_path, length('eval/' || work.id::text || '/')) <> 'eval/' || work.id::text || '/'
       or position('..' in photo_path) > 0 then$before$;
  after_text := $after$if not (trim(coalesce(photo->>'url', '')) = any(string_to_array(coalesce(canonical_photo_links, ''), ',')))
       and (left(photo_path, length('eval/' || work.id::text || '/')) <> 'eval/' || work.id::text || '/'
       or position('..' in photo_path) > 0) then$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$  select string_agg(trim(value->>'url'), E'\n' order by ordinality)$before$;
  after_text := $after$  -- Preserve inherited URLs and aligned names without changing photo dates.
  photos := photos || coalesce((
    select jsonb_agg(jsonb_build_object('url', inherited.url, 'name', coalesce(nullif(split_part(coalesce(origin.photo_name, ''), ',', inherited.ordinality::integer), ''), 'eval-photo')) order by inherited.ordinality)
    from unnest(string_to_array(coalesce(canonical_photo_links, ''), ',')) with ordinality inherited(url, ordinality)
    where inherited.url <> '' and not exists (select 1 from jsonb_array_elements(photos) incoming where trim(coalesce(incoming->>'url', '')) = inherited.url)
  ), '[]'::jsonb);
  select string_agg(trim(value->>'url'), ',' order by ordinality)$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$string_agg(trim(coalesce(value->>'name', 'eval-photo')), E'\n' order by ordinality)$before$;
  after_text := $after$string_agg(trim(coalesce(value->>'name', 'eval-photo')), ',' order by ordinality)$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$  if coalesce(photo_links, '') = '' then raise exception using errcode = '22023', message = 'eval_work_committed_photo_required'; end if;
$before$;
  after_text := $after$$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$coalesce(origin.ptravailable, '')$before$;
  after_text := $after$coalesce(origin.ptronhand, '')$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$match = trim(to_char(match_value, 'FM999990.##'))$before$;
  after_text := $after$match = case when match_value is null then match else trim(to_char(match_value, 'FM999990.##')) end$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$loc_match_qty = case when ptr_value is null then loc_match_qty$before$;
  after_text := $after$loc_match_qty = case when ptr_value is null or match_value is null then loc_match_qty$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := $before$  where unique_id = origin.unique_id;$before$;
  after_text := $after$  where unique_id = origin.unique_id;
  perform private.sync_item_detail_photos_v308(origin.unique_id, photo_links);$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected submit_eval_work_legacy_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  execute definition;
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('public.create_inventory_project_v1'::regproc);
  before_text text;
  after_text text;
begin
  if strpos(definition, 'agdata310_optional_evidence') > 0 then return; end if;
  before_text := $before$     IF coalesce((project.project_meta->'parameters'->>'photo')::boolean,false) AND coalesce(completion->>'photo_url','')!~'^https://' THEN RAISE EXCEPTION 'PROJECT_PHOTO_REQUIRED'; END IF;$before$;
  after_text := $after$     -- agdata310_optional_evidence: project photo proof is optional; custom task requirements remain.$after$;
  if strpos(definition, before_text) = 0 or strpos(substr(definition, strpos(definition, before_text) + length(before_text)), before_text) > 0 then
    raise exception 'AgData 3.0.10 unexpected create_inventory_project_v1 anchor';
  end if;
  definition := replace(definition, before_text, after_text);
  execute definition;
end;
$migration$;

commit;
