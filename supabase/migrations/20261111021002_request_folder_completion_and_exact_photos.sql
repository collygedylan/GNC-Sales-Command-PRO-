begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
create or replace function private.request_folder_members_v3065(p_folder text)
returns table(unique_id text, completed boolean) language sql stable security definer set search_path='' as $fn$
  select p.unique_id, lower(btrim(coalesce(p.req_status,''))) in ('complete','completed','done')
    or nullif(btrim(coalesce(p.date_completed,'')),'') is not null
  from public.ph_requests_pending p where btrim(coalesce(p.request_folder,''))=p_folder
    and not coalesce(p.req_archived,false) and lower(btrim(coalesce(p.req_status,''))) not in ('archived','cancelled','canceled')
  union all
  select h.unique_id,true from public.ph_requests_completed_history h
  where btrim(coalesce(h.request_folder,''))=p_folder and h.date_completed is not null
    and lower(coalesce(h.last_event,'')) in ('completed','request_completed')
    and not exists(select 1 from public.ph_requests_pending p where p.unique_id=h.unique_id)
$fn$;
create or replace function private.request_folder_state_v3065(folder_value text,request_ids text[])
returns private.ph_request_folder_delivery_state language plpgsql security definer set search_path='' as $fn$
declare membership_signature_value text;
declare state_row private.ph_request_folder_delivery_state;
begin
  membership_signature_value := md5(coalesce(array_to_string(request_ids, E'\n'), 'empty'));
  select * into state_row from private.ph_request_folder_delivery_state
  where request_folder = folder_value for update;

  if state_row.request_folder is null then
    insert into private.ph_request_folder_delivery_state(
      request_folder, membership_version, membership_signature, active_request_ids)
    values (folder_value, 1, membership_signature_value, request_ids)
    returning * into state_row;
  elsif state_row.membership_signature <> membership_signature_value then
    update private.ph_request_folder_delivery_state set
      membership_version = membership_version + 1,
      membership_signature = membership_signature_value,
      active_request_ids = request_ids,
      completion_event_key = null,
      updated_at = now()
    where request_folder = folder_value returning * into state_row;
  else
    update private.ph_request_folder_delivery_state set active_request_ids = request_ids, updated_at = now()
    where request_folder = folder_value returning * into state_row;
  end if;

  return state_row;
end
$fn$;
create or replace function private.queue_request_folder_v3065(folder_value text,request_ids text[],state_row private.ph_request_folder_delivery_state)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare dependency_keys text[];
declare creation_dependency_coverage boolean;
declare event_key_value text;
declare completion_event public.ph_request_delivery_outbox;
begin
  select coalesce(array_agg(o.event_key order by o.created_at, o.event_key), '{}'::text[])
    into dependency_keys
  from public.ph_request_delivery_outbox o
  where o.request_folder = folder_value
    and o.event_type in ('request_created', 'request_options_appended')
    and coalesce(o.payload->'request_ids', '[]'::jsonb) ?| request_ids;

  select coalesce(bool_and(exists (
    select 1 from public.ph_request_delivery_outbox membership
    where membership.request_folder = folder_value
      and membership.event_type in ('request_created', 'request_options_appended')
      and coalesce(membership.payload->'request_ids', '[]'::jsonb) ? active_request.request_id
  )), false) into creation_dependency_coverage
  from unnest(request_ids) as active_request(request_id);

  if not creation_dependency_coverage then
    return jsonb_build_object('queued', false, 'membershipVersion', state_row.membership_version,
      'activeCount', cardinality(request_ids), 'reason', 'waiting_for_request_membership_event');
  end if;

  event_key_value := 'request-folder-completed:' || md5(folder_value) || ':v' || state_row.membership_version::text;
  insert into public.ph_request_delivery_outbox(
    event_key, event_type, request_folder, payload, status, next_attempt_at)
  values (
    event_key_value, 'request_completed', folder_value,
    jsonb_build_object(
      'contractVersion', 'request-folder-completion-v2',
      'activeRequestIds', to_jsonb(request_ids), 'request_ids', to_jsonb(request_ids),
      'membershipVersion', state_row.membership_version,
      'membershipSignature', state_row.membership_signature,
      'dependencyEventKeys', to_jsonb(dependency_keys),
      'updatedCompletion', state_row.last_delivered_version > 0
    ), 'pending', now()
  ) on conflict (event_key) do update set
      payload = excluded.payload,
      status = case when public.ph_request_delivery_outbox.status = 'suppressed' then 'pending' else public.ph_request_delivery_outbox.status end,
      next_attempt_at = least(public.ph_request_delivery_outbox.next_attempt_at, now()),
      updated_at = now()
  returning * into completion_event;

  update private.ph_request_folder_delivery_state set completion_event_key = event_key_value, updated_at = now()
  where request_folder = folder_value;

  return jsonb_build_object('queued', true, 'eventId', completion_event.event_id,
    'membershipVersion', state_row.membership_version, 'activeCount', cardinality(request_ids));
end
$fn$;
create or replace function private.reconcile_request_folder_completion_v2(p_request_folder text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare folder_value text:=btrim(coalesce(p_request_folder,''));
declare request_ids text[];
declare all_complete boolean;
declare state_row private.ph_request_folder_delivery_state;
begin
  if folder_value='' then return jsonb_build_object('queued',false,'reason','folder_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('request-folder-v2:'||folder_value,0));
  select coalesce(array_agg(m.unique_id order by m.unique_id),'{}'::text[]),coalesce(bool_and(m.completed),false)
    into request_ids,all_complete from private.request_folder_members_v3065(folder_value) m;
  state_row:=private.request_folder_state_v3065(folder_value,request_ids);
  update public.ph_request_delivery_outbox o set status='suppressed',
    sanitized_error_code='FOLDER_MEMBERSHIP_SUPERSEDED',updated_at=now()
  where o.request_folder=folder_value and o.event_type='request_completed' and o.status in ('pending','failed','unknown')
    and (coalesce(o.payload->>'contractVersion','')<>'request-folder-completion-v2'
      or coalesce((o.payload->>'membershipVersion')::bigint,0)<>state_row.membership_version);
  if cardinality(request_ids)=0 or not all_complete then
    return jsonb_build_object('queued',false,'membershipVersion',state_row.membership_version,
      'activeCount',cardinality(request_ids),'reason','folder_incomplete');
  end if;
  return private.queue_request_folder_v3065(folder_value,request_ids,state_row);
end
$fn$;
CREATE OR REPLACE FUNCTION private.enqueue_completed_request_email_v316(p_request_id text, p_deleted_row jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h public.ph_requests_completed_history%rowtype;
declare p public.ph_requests_pending%rowtype;
declare folder text;
begin
  select * into p from public.ph_requests_pending where unique_id=p_request_id;
  if p.unique_id is not null and (lower(btrim(coalesce(p.req_status,''))) in ('complete','completed','done')
      or nullif(btrim(coalesce(p.date_completed,'')),'') is not null) then
    perform private.upsert_request_history(p.unique_id,'completed','pending',false);
  end if;
  select * into h from public.ph_requests_completed_history where unique_id=p_request_id;
  if h.unique_id is null and p_deleted_row is not null
     and lower(coalesce(p_deleted_row->>'req_status','')) in ('complete','completed','done') then
    -- A completed DELETE may arrive without the canonical command's history upsert.
    -- Freeze only that exact deleted row; cancellation alone is never completion.
    insert into public.ph_requests_completed_history(unique_id,master_id,commonname,contsize,itemcode,locationcode,lotcode,
      request_folder,requested_by,req_customer,req_qty,req_status,date_completed,req_spec,req_caliper,req_match,
      req_pic_note,req_comments,av_note,req_photo_link,req_photo_name,photos,snapshot,last_event,
      completed_by_username,completed_by_display,completed_by_email,request_created_by_username,
      request_created_by_display,request_created_by_email,request_selected_rep_username,request_selected_rep_display,
      request_selected_rep_email,created_at)
    values(p_request_id,p_deleted_row->>'master_id',p_deleted_row->>'commonname',p_deleted_row->>'contsize',
      p_deleted_row->>'itemcode',p_deleted_row->>'locationcode',p_deleted_row->>'lotcode',p_deleted_row->>'request_folder',
      p_deleted_row->>'requested_by',p_deleted_row->>'req_customer',p_deleted_row->>'req_qty','Complete',
      private.request_timestamptz_v2362(p_deleted_row->>'date_completed'),p_deleted_row->>'req_spec',p_deleted_row->>'req_caliper',
      p_deleted_row->>'req_match',p_deleted_row->>'req_pic_note',p_deleted_row->>'req_comments',p_deleted_row->>'av_note',
      p_deleted_row->>'req_photo_link',p_deleted_row->>'req_photo_name',p_deleted_row->'photos',p_deleted_row,'completed',
      p_deleted_row->>'completed_by_username',p_deleted_row->>'completed_by_display',p_deleted_row->>'completed_by_email',
      p_deleted_row->>'request_created_by_username',p_deleted_row->>'request_created_by_display',p_deleted_row->>'request_created_by_email',
      p_deleted_row->>'request_selected_rep_username',p_deleted_row->>'request_selected_rep_display',p_deleted_row->>'request_selected_rep_email',
      private.request_timestamptz_v2362(p_deleted_row->>'created_at')) on conflict(unique_id) do nothing;
    select * into h from public.ph_requests_completed_history where unique_id=p_request_id;
  end if;
  -- History also contains submitted/updated audit snapshots; their compatibility
  -- trigger fills Complete/date_completed. Only the actual completion event proves Done.
  if h.unique_id is null or lower(coalesce(h.last_event,'')) not in ('completed','request_completed') then return null; end if;
  folder:=h.request_folder;
  return (private.reconcile_request_folder_completion_v2(folder)->>'eventId')::uuid;
end
$function$;
CREATE OR REPLACE FUNCTION private.route_legacy_request_completion_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.event_type = 'request_completed'
     and coalesce(new.payload->>'contractVersion', '') <> 'request-folder-completion-v2' then
    perform private.reconcile_request_folder_completion_v2(new.request_folder);
    new.status := 'suppressed';
    new.sanitized_error_code := 'FOLDER_COMPLETION_V2_SUPERSEDED';
  end if;
  return new;
end
$function$
;
create or replace function public.request_completion_dispatch_rows_v3065(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare event_row public.ph_request_delivery_outbox;
declare member_ids text[];
declare event_ids text[];
declare ready boolean;
declare rows_value jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select * into event_row from public.ph_request_delivery_outbox where event_id=p_event_id and event_type='request_completed';
  if not found or coalesce(event_row.payload->>'contractVersion','')<>'request-folder-completion-v2' then
    return jsonb_build_object('ready',false,'reason','folder_event_required');
  end if;
  select coalesce(array_agg(m.unique_id order by m.unique_id),'{}'::text[]),coalesce(bool_and(m.completed),false)
    into member_ids,ready from private.request_folder_members_v3065(btrim(event_row.request_folder)) m;
  select coalesce(array_agg(value order by value),'{}'::text[]) into event_ids
    from jsonb_array_elements_text(coalesce(event_row.payload->'request_ids','[]'::jsonb));
  if not ready or cardinality(member_ids)=0 or member_ids is distinct from event_ids then
    return jsonb_build_object('ready',false,'reason','folder_incomplete_or_changed');
  end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.unique_id),'[]'::jsonb) into rows_value
    from public.ph_requests_completed_history h where h.unique_id=any(member_ids)
      and lower(coalesce(h.last_event,'')) in ('completed','request_completed');
  if jsonb_array_length(rows_value)<>cardinality(member_ids) then
    return jsonb_build_object('ready',false,'reason','completion_history_missing');
  end if;
  return jsonb_build_object('ready',true,'request_ids',to_jsonb(member_ids),'rows',rows_value);
end
$fn$;

CREATE OR REPLACE FUNCTION private.collect_item_detail_photo_links_v308(p_item text, p_location text, p_lot text, p_refs jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET enable_seqscan TO 'off'
 SET jit TO 'off'
AS $function$
 WITH inventory AS (
  SELECT to_jsonb(m) doc, 'inventory' kind FROM public.ph_master_inventory m WHERE p_item IS NOT NULL AND p_location IS NOT NULL
   AND m.itemcode IS NOT NULL AND m.locationcode IS NOT NULL
   AND upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(p_item))
   AND upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(p_location))
 ), notes AS (
  SELECT to_jsonb(n) doc, 'notes' kind FROM public.ph_location_sales_notes n
   WHERE p_item IS NOT NULL AND p_location IS NOT NULL AND upper(btrim(n.itemcode))=upper(btrim(p_item)) AND upper(btrim(n.locationcode))=upper(btrim(p_location))
 ), candidates AS (SELECT * FROM inventory UNION ALL SELECT * FROM notes), scoped AS (
  SELECT doc FROM candidates c WHERE nullif(btrim(p_lot),'') IS NOT NULL AND upper(btrim(coalesce(doc->>'lotcode','')))=upper(btrim(p_lot))
   AND nullif(p_refs->0->>'unique_id','') IS NOT NULL AND doc->>'unique_id'=p_refs->0->>'unique_id'
 ), refs AS (
  SELECT value doc,n ord FROM jsonb_array_elements(coalesce(p_refs,'[]'::jsonb)) WITH ORDINALITY a(value,n)
   WHERE (p_item IS NULL OR value->>'itemcode' IS NULL OR upper(btrim(value->>'itemcode'))=upper(btrim(p_item)))
     AND (p_location IS NULL OR value->>'locationcode' IS NULL OR upper(btrim(value->>'locationcode'))=upper(btrim(p_location)))
     AND (p_lot IS NULL OR value->>'lotcode' IS NULL OR upper(btrim(value->>'lotcode'))=upper(btrim(p_lot)))
  UNION ALL SELECT doc,10000+row_number() OVER(ORDER BY doc->>'unique_id') FROM scoped
 ), fields AS (
  SELECT f.value,ord,f.field_ord
  FROM refs CROSS JOIN LATERAL (
   SELECT (CASE WHEN jsonb_typeof(doc)='object' THEN doc ELSE jsonb_build_object('photos',doc) END)->keys.key value,
     keys.field_ord
   FROM unnest(ARRAY['photo_link','req_photo_link','drive_photo_link','dock_photo_link','photos','request_photos','photo_urls','photo_url'])
     WITH ORDINALITY keys(key,field_ord)
  ) f WHERE f.value IS NOT NULL
 ), entries AS (
  SELECT entry,ord,field_ord,entry_ord FROM fields CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE jsonb_build_array(value) END) WITH ORDINALITY a(entry,entry_ord)
 ), links AS (
  SELECT btrim(link) link,ord,field_ord,entry_ord,split_ord FROM entries CROSS JOIN LATERAL regexp_split_to_table(CASE WHEN jsonb_typeof(entry)='object' THEN coalesce(entry->>'url',entry->>'src',entry->>'photo_url',entry->>'photo_link','') ELSE coalesce(entry#>>'{}','') END,',') WITH ORDINALITY a(link,split_ord)
 ), unique_links AS (
  SELECT DISTINCT ON(link) link,ord,field_ord,entry_ord,split_ord FROM links WHERE link~'^https?://' ORDER BY link,ord,field_ord,entry_ord,split_ord
 ) SELECT coalesce(string_agg(link,',' ORDER BY ord,field_ord,entry_ord,split_ord),'') FROM unique_links
$function$
;

revoke all on function private.request_folder_members_v3065(text),private.request_folder_state_v3065(text,text[]),
  private.queue_request_folder_v3065(text,text[],private.ph_request_folder_delivery_state) from public,anon,authenticated;
revoke all on function public.request_completion_dispatch_rows_v3065(uuid) from public,anon,authenticated;
grant execute on function public.request_completion_dispatch_rows_v3065(uuid) to service_role;
commit;

