begin;
-- Reconstruct the installed exact-row predecessor from the reviewed 3.0.8,
-- 3.0.9 and 3.0.16 patches. The ordinary replay still applies each patch.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_REQUEST_WRITER_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
CREATE OR REPLACE FUNCTION public.save_request_work_v1_pre_state_machine_v2359(request_id text, expected_version bigint, patch jsonb, complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare
  existing public.ph_requests_pending%rowtype;
  saved public.ph_requests_pending%rowtype;
  canonical jsonb;
  completion_time text;
  delivery_status text := 'not_queued';
begin
  if not private.can_save_request_work() then
    raise exception using errcode = '42501', message = 'REQUEST_SAVE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(request_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_AND_VERSION_REQUIRED';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PATCH_INVALID';
  end if;

  select * into existing
  from public.ph_requests_pending
  where unique_id = request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;
  expected_version := existing.row_version;

  completion_time := case
    when complete then coalesce(nullif(patch->>'date_completed', ''), now()::text)
    else existing.date_completed
  end;

  update public.ph_requests_pending r
  set req_match = case when patch ? 'req_match' then
        case
          when nullif(btrim(coalesce(patch->>'req_match', '')), '') is null then null
          when btrim(patch->>'req_match') ~ '^-?[0-9]+([.][0-9]+)?$'
            then btrim(patch->>'req_match')::numeric
          else r.req_match
        end
      else r.req_match end,
      req_spec = case when patch ? 'req_spec' then patch->>'req_spec' else r.req_spec end,
      req_caliper = case when patch ? 'req_caliper' then patch->>'req_caliper' else r.req_caliper end,
      req_pic_note = case when patch ? 'req_pic_note' then patch->>'req_pic_note' else r.req_pic_note end,
      req_sales_note = case when patch ? 'req_sales_note' then patch->>'req_sales_note' else r.req_sales_note end,
      req_comments = case when patch ? 'req_comments' then patch->>'req_comments' else r.req_comments end,
      av_note = case when patch ? 'av_note' then patch->>'av_note' else r.av_note end,
      req_reserve = case when patch ? 'req_reserve' then patch->>'req_reserve' else r.req_reserve end,
      req_photo_link = case when patch ? 'req_photo_link' then patch->>'req_photo_link' else r.req_photo_link end,
      req_photo_name = case when patch ? 'req_photo_name' then patch->>'req_photo_name' else r.req_photo_name end,
      req_photo_mode = case when patch ? 'req_photo_mode' then patch->>'req_photo_mode' else r.req_photo_mode end,
      req_rep_action = case when patch ? 'req_rep_action' then patch->>'req_rep_action' else r.req_rep_action end,
      request_note = case when patch ? 'request_note' then patch->>'request_note' else r.request_note end,
      completed_by_username = case when patch ? 'completed_by_username' then patch->>'completed_by_username' else r.completed_by_username end,
      completed_by_display = case when patch ? 'completed_by_display' then patch->>'completed_by_display' else r.completed_by_display end,
      completed_by_email = case when patch ? 'completed_by_email' then patch->>'completed_by_email' else r.completed_by_email end,
      req_status = case when complete then 'Complete'
        when patch ? 'req_status' then patch->>'req_status' else r.req_status end,
      date_completed = completion_time,
      req_archived = case when complete then false
        when patch ? 'req_archived' then coalesce((patch->>'req_archived')::boolean, false)
        else r.req_archived end,
      row_version = r.row_version + 1
  where r.unique_id = request_id
  returning r.* into saved;

  if not found then
    raise exception using errcode = 'PT409', message = 'REQUEST_VERSION_CONFLICT';
  end if;

  -- Shared AV work is committed to Drive in the same transaction. The Drive
  -- trigger propagates these values to every other pending request for the row.
  if saved.master_id is not null then
    update public.ph_master_inventory m
    set match = case when patch ? 'req_match' then patch->>'req_match' else m.match end,
        loc_match_qty = case when patch ? 'loc_match_qty' then patch->>'loc_match_qty' else m.loc_match_qty end,
        spec = case when patch ? 'req_spec' then patch->>'req_spec' else m.spec end,
        caliper = case when patch ? 'req_caliper' then patch->>'req_caliper' else m.caliper end,
        pic_note = case when patch ? 'req_pic_note' then patch->>'req_pic_note' else m.pic_note end,
        av_note = case when patch ? 'av_note' then patch->>'av_note' else m.av_note end,
        sales_note = case when patch ? 'req_comments' then patch->>'req_comments' when patch ? 'req_sales_note' then patch->>'req_sales_note' else m.sales_note end,
           photos = case when patch ? 'drive_photo_link' then coalesce(to_jsonb(string_to_array(nullif(patch->>'drive_photo_link',''),',')),'[]'::jsonb) else m.photos end,
           photo_url = case when patch ? 'drive_photo_link' then nullif(split_part(coalesce(patch->>'drive_photo_link',''),',',1),'') else m.photo_url end,
           photo_link = case when patch ? 'drive_photo_link' then patch->>'drive_photo_link' else m.photo_link end,
        photo_name = case when patch ? 'drive_photo_name' then patch->>'drive_photo_name' else m.photo_name end,
        av_rule_priority_snapshot = case
          when patch ? 'req_match' or patch ? 'req_spec' or patch ? 'req_caliper'
            or patch ? 'req_pic_note' or patch ? 'av_note'
          then m.priority else m.av_rule_priority_snapshot end,
        av_rule_holdstop_snapshot = case
          when patch ? 'req_match' or patch ? 'req_spec' or patch ? 'req_caliper'
            or patch ? 'req_pic_note' or patch ? 'av_note'
          then concat_ws('|', nullif(btrim(coalesce(m.holdstopcode, '')), ''),
                              nullif(btrim(coalesce(m.holdstopreason, '')), ''))
          else m.av_rule_holdstop_snapshot end,
        av_rule_match_updated_at = case when patch ? 'req_match' then now() else m.av_rule_match_updated_at end,
        av_rule_spec_updated_at = case when patch ? 'req_spec' then now() else m.av_rule_spec_updated_at end,
        av_rule_caliper_updated_at = case when patch ? 'req_caliper' then now() else m.av_rule_caliper_updated_at end,
        av_rule_av_note_updated_at = case when patch ? 'av_note' then now() else m.av_rule_av_note_updated_at end,
        av_rule_photo_updated_at = case
          when patch ? 'drive_photo_link' or patch ? 'drive_photo_name' then now()
          else m.av_rule_photo_updated_at end,
        av_rule_bundle_updated_at = case
          when patch ? 'req_match' or patch ? 'req_spec' or patch ? 'req_caliper'
            or patch ? 'req_pic_note' or patch ? 'av_note'
            or patch ? 'drive_photo_link' or patch ? 'drive_photo_name'
          then now() else m.av_rule_bundle_updated_at end
    where m.unique_id = saved.master_id;
  end if;

  if complete then
    perform private.upsert_request_history(request_id, 'completed', 'pending', false);
    insert into public.ph_request_delivery_outbox (
      event_key, event_type, request_id, request_folder, payload, status
    ) values (
      'request-completed:' || request_id || ':' || saved.row_version::text,
      'request_completed', request_id, saved.request_folder,
      jsonb_build_object('request_id', request_id, 'row_version', saved.row_version),
      'pending'
    ) on conflict (event_key) do nothing;
    delivery_status := 'pending';
  else
    perform private.upsert_request_history(request_id, 'updated', 'not_queued', false);
  end if;

  canonical := coalesce(private.canonical_request_json(request_id), to_jsonb(saved));
  return jsonb_build_object(
    'row', canonical,
    'row_version', coalesce((canonical->>'row_version')::bigint, saved.row_version),
    'delivery_state', delivery_status
  );
end;
$function$;
commit;
