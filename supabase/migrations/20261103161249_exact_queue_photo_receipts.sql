BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '15s';

-- Preserve the existing row locks, verified session, work roles and idempotent evidence engine.
DO $migration$
DECLARE
    definition text;
    before_text text;
    after_text text;
BEGIN
    SELECT pg_get_functiondef('public.save_drive_evidence_v3'::regproc) INTO definition;
    before_text := 'if current_row.date_completed is not null then';
    after_text := $src$if current_row.date_completed is not null and not (
      coalesce(current_setting('role',true),'') = 'service_role'
      and coalesce(current_setting('app.suspend_evidence_uid',true),'') = current_row.unique_id
      and not coalesce(p_complete,false)
    ) then$src$;
    IF strpos(definition, after_text) = 0 THEN
        IF strpos(definition, before_text) = 0 THEN RAISE EXCEPTION 'Unrecognized completed row guard'; END IF;
        EXECUTE replace(definition, before_text, after_text);
    END IF;

    SELECT pg_get_functiondef('suspend_tag_private.publish_inventory_evidence_v23119'::regproc) INTO definition;
    before_text := '  result:=public.save_drive_evidence_v3';
    after_text := $src$  PERFORM set_config('app.suspend_evidence_uid',m.unique_id,true);
  result:=public.save_drive_evidence_v3$src$;
    IF strpos(definition, after_text) = 0 THEN
        IF strpos(definition, before_text) = 0 OR strpos(definition,'  rows:=rows||') = 0 THEN RAISE EXCEPTION 'Unrecognized Suspend publication'; END IF;
        definition := replace(definition, before_text, after_text);
        before_text := 'AND NOT suspend_tag_private.is_false_block_v2378(candidate.locationcode)';
        IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'Unrecognized Suspend exact row selector'; END IF;
        definition := replace(definition,before_text,before_text || $src$
    AND (NOT (patch ? 'dock_photo_link') OR (target.locationcode IS NOT DISTINCT FROM s.locationcode
         AND upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(s.lotcode,'')))))$src$);
        definition := replace(definition,'  rows:=rows||',$src$  PERFORM set_config('app.suspend_evidence_uid','',true);
  IF (result->>'ok')::boolean IS DISTINCT FROM true OR result->'row'->>'unique_id' IS DISTINCT FROM m.unique_id THEN
    RAISE EXCEPTION 'SUSPEND_TAG_EVIDENCE_UNCONFIRMED' USING ERRCODE='PT409';
  END IF;
  rows:=rows||$src$);
        EXECUTE definition;
    END IF;

    -- Dock review uses the same verified service wrapper and physical source lock.
    SELECT pg_get_functiondef('suspend_tag_private.group_command'::regproc) INTO definition;
    before_text := $src$result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='remove_location'$src$;
    IF strpos(definition, 'dock-photo-publication') = 0 THEN
        IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'Unrecognized Dock review'; END IF;
        after_text := $src$result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
   if p_payload->'patch' ? 'dock_photo_link' then
     -- dock-photo-publication
     select * into s from public.ph_soc_master where unique_id=uid;
     result:=result || suspend_tag_private.publish_inventory_evidence_v23119(p_actor_id,s,p_payload,p_command_id);
   end if;
 elsif p_operation='remove_location'$src$;
        EXECUTE replace(definition,before_text,after_text);
    END IF;

    SELECT pg_get_functiondef('public.request_work_command_v1_pre_state_machine_v2359'::regproc) INTO definition;
    IF strpos(definition, 'append_photo') = 0 THEN
        before_text := 'if p_operation<>''save'' or';
        IF strpos(definition,before_text)=0 OR strpos(definition,' result:=public.save_request_work(')=0 THEN RAISE EXCEPTION 'Unrecognized Request save'; END IF;
        definition := replace(definition,before_text,'if p_operation not in (''save'',''append_photo'') or');
        before_text := ' result:=public.save_request_work(';
        after_text := $src$ if p_operation='append_photo' then
   if p_complete or (p_patch - 'req_photo_link' - 'req_photo_name') <> '{}'::jsonb or coalesce(p_patch->>'req_photo_link','') !~ '^https://[^,[:space:]]+$'
      or nullif(btrim(p_patch->>'req_photo_name'),'') is null or position(',' in p_patch->>'req_photo_name')>0 then
     raise exception 'REQUEST_WORK_PHOTO_INVALID' using errcode='22023';
   end if;
   if master_row.unique_id is null then raise exception 'REQUEST_MASTER_NOT_FOUND' using errcode='P0002'; end if;
   if (p_patch->>'req_photo_link')=any(string_to_array(coalesce(request_row.req_photo_link,''),','))
      and (p_patch->>'req_photo_link')=any(string_to_array(coalesce(master_row.photo_link,''),',')) then
     return jsonb_build_object('ok',true,'lifecycle_state','pending_active','row',to_jsonb(request_row),'row_version',request_row.row_version,'master_row',to_jsonb(master_row));
   end if;
   p_expected_version:=request_row.row_version;
   -- The master and request are both locked. A replay appends each URL at most once.
   clean:=jsonb_build_object(
     'req_photo_link',request_row.req_photo_link,'req_photo_name',request_row.req_photo_name,
     'drive_photo_link',master_row.photo_link,'drive_photo_name',master_row.photo_name);
   if not (p_patch->>'req_photo_link'=any(string_to_array(coalesce(request_row.req_photo_link,''),','))) then
     clean:=clean||jsonb_build_object('req_photo_link',concat_ws(',',nullif(request_row.req_photo_link,''),p_patch->>'req_photo_link'),
       'req_photo_name',concat_ws(',',nullif(request_row.req_photo_name,''),p_patch->>'req_photo_name'));
   end if;
   if not (p_patch->>'req_photo_link'=any(string_to_array(coalesce(master_row.photo_link,''),','))) then
     clean:=clean||jsonb_build_object('drive_photo_link',concat_ws(',',nullif(master_row.photo_link,''),p_patch->>'req_photo_link'),
       'drive_photo_name',concat_ws(',',nullif(master_row.photo_name,''),p_patch->>'req_photo_name'));
   end if;
 end if;
 result:=public.save_request_work($src$;
        EXECUTE replace(definition,before_text,after_text);
    END IF;
END
$migration$;
COMMIT;
