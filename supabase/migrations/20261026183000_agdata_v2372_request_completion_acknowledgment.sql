begin;

set local lock_timeout = '15s';
set local statement_timeout = '120s';

do $repair_completed_history_source$
declare
  definition text;
  repaired text;
begin
  definition := pg_get_functiondef(
    'private.persist_completed_request_history_v1(text,text,text,boolean)'::regprocedure
  );
  repaired := replace(
    definition,
    'request_row public.ph_active_request%rowtype;',
    'request_row public.ph_requests_pending%rowtype;'
  );
  repaired := replace(
    repaired,
    'from public.ph_active_request where unique_id=p_request_id for update;',
    'from public.ph_requests_pending where unique_id=p_request_id for update;'
  );
  if position('request_row public.ph_active_request%rowtype;' in repaired) > 0
     or position('from public.ph_active_request where unique_id=p_request_id for update;' in repaired) > 0 then
    raise exception 'REQUEST_HISTORY_COMPLETION_SOURCE_REPAIR_FAILED';
  end if;
  execute repaired;
end
$repair_completed_history_source$;

do $repair_request_completion_acknowledgment$
declare
  definition text;
  repaired text;
begin
  definition := pg_get_functiondef(
    'public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure
  );
  repaired := replace(
    definition,
    'request_row public.ph_active_request%rowtype;',
    'request_row public.ph_requests_pending%rowtype;'
  );
  repaired := replace(
    repaired,
    'select * into request_row from public.ph_active_request where unique_id=request_id for update;',
    'select * into request_row from public.ph_requests_pending where unique_id=request_id for update;'
  );
  repaired := replace(
    repaired,
    'delete from public.ph_active_request where unique_id=request_id;',
    'delete from public.ph_requests_pending where unique_id=request_id;'
  );
  if position('request_row public.ph_active_request%rowtype;' in repaired) > 0
     or position('select * into request_row from public.ph_active_request where unique_id=request_id for update;' in repaired) > 0
     or position('delete from public.ph_active_request where unique_id=request_id;' in repaired) > 0 then
    raise exception 'REQUEST_COMPLETION_ACKNOWLEDGMENT_REPAIR_FAILED';
  end if;
  execute repaired;
end
$repair_request_completion_acknowledgment$;

create or replace function public.request_completion_receipt_v2372(
  p_actor_id uuid,
  p_session_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
as $function$
declare
  history_row public.ph_request_history%rowtype;
  receipt jsonb;
begin
  if not private.is_service_role_request()
     or not suspend_tag_private.session_active(p_actor_id,p_session_id) then
    raise exception using errcode='42501',message='REQUEST_WORK_SESSION_REQUIRED';
  end if;
  if exists(select 1 from public.ph_active_request where unique_id=p_request_id) then
    return null;
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_actor_id,'role','authenticated','session_id',p_session_id
  )::text,true);
  select * into history_row
  from public.ph_request_history history
  where history.unique_id=p_request_id
    and history.date_completed is not null;
  if history_row.unique_id is null
     or not private.can_save_request_work()
     or not private.can_work_request_identity(
       history_row.request_created_by_username,
       history_row.request_selected_rep_username,
       history_row.requested_by
     ) then
    return null;
  end if;
  receipt:=private.request_receipt_json_v1(p_request_id);
  return jsonb_build_object(
    'row',receipt,
    'row_version',history_row.row_version,
    'delivery_state',coalesce((select outbox.status
      from public.ph_request_delivery_outbox outbox
      where outbox.request_id=p_request_id and outbox.event_type='request_completed'
      order by outbox.created_at desc limit 1),'already_completed'),
    'acknowledged',true,
    'idempotent_replay',true,
    'lifecycle_state','completed_history',
    'active',false
  );
end
$function$;

revoke all on function public.request_completion_receipt_v2372(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.request_completion_receipt_v2372(uuid,uuid,text)
  to service_role;

do $complete_blue_shadow_request$
declare
  actor_id uuid;
  request_row public.ph_requests_pending%rowtype;
  completion_result jsonb;
  previous_evidence_guard text;
begin
  select id into actor_id
  from public.profiles
  where lower(btrim(username))='dylan_collyge'
    and disabled_at is null
  limit 1;
  select * into request_row
  from public.ph_requests_pending pending
  where pending.itemcode='002194.030.1'
    and pending.locationcode='E.11.000'
    and pending.lotcode='27.F1'
    and lower(btrim(coalesce(pending.req_customer,pending.customername,'')))='digger odell nursery'
  order by pending.created_at desc
  limit 1
  for update;
  if request_row.unique_id is not null then
    if actor_id is null then raise exception 'DYLAN_PROFILE_NOT_FOUND'; end if;
    perform set_config('request.jwt.claim.sub',actor_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object(
      'sub',actor_id,'role','authenticated'
    )::text,true);
    completion_result:=public.save_request_work(
      request_row.unique_id,
      request_row.row_version,
      jsonb_strip_nulls(jsonb_build_object(
        'req_match',70,
        'loc_match_qty',31,
        'req_spec','18-20" H',
        'req_caliper','N/A',
        'av_note','FULL TOPS',
        'req_reserve','NO',
        'req_photo_link',request_row.req_photo_link,
        'req_photo_name',request_row.req_photo_name,
        'drive_photo_link',request_row.req_photo_link,
        'drive_photo_name',request_row.req_photo_name,
        'date_completed',clock_timestamp()
      )),
      true
    );
    if completion_result->>'lifecycle_state' is distinct from 'completed_history' then
      raise exception 'BLUE_SHADOW_COMPLETION_UNCONFIRMED';
    end if;
  end if;
  update app_sync_private.inventory_location_evidence_v1 evidence set
    spec='18-20" H',caliper='N/A',match='70',loc_match_qty='31',
    loc_match_pct=70,initial_photo_match_qty=31,current_photo_match_qty=31,
    av_note='FULL TOPS',updated_at=clock_timestamp(),updated_by='dylan_collyge'
  where evidence.itemcode_key='002194.030.1'
    and evidence.locationcode_key='E.11.000';
  previous_evidence_guard:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  update public.ph_master_inventory master set
    spec='18-20" H',caliper='N/A',match='70',loc_match_qty='31',
    loc_match_pct=70,loc_photo_match=31,av_note='FULL TOPS'
  where master.itemcode='002194.030.1'
    and master.locationcode='E.11.000'
    and master.lotcode='27.F1';
  perform set_config('gnc.inventory_location_evidence_apply',previous_evidence_guard,true);
  update public.ph_requests_completed_history history set
    req_status='Complete',status='Complete',req_spec='18-20" H',spec='18-20" H',
    req_caliper='N/A',caliper='N/A',req_match='70',loc_match_pct=70,
    loc_photo_match=31,av_note='FULL TOPS',req_reserve='NO',reserve_flag='NO'
  where history.unique_id='REQ-mvp9cdc5mc3uk7hltrd';
end
$complete_blue_shadow_request$;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values (
  'app_version',
  jsonb_build_object('app_version','2.3.72','release','AgData v2.3.72'),
  'release-v2.3.72',
  now()
)
on conflict(key) do update set
  value = excluded.value,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

do $v2372_contract$
declare
  persist_definition text;
  save_definition text;
begin
  persist_definition:=pg_get_functiondef(
    'private.persist_completed_request_history_v1(text,text,text,boolean)'::regprocedure
  );
  save_definition:=pg_get_functiondef(
    'public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure
  );
  if position('from public.ph_requests_pending where unique_id=p_request_id for update;' in persist_definition)=0
     or position('select * into request_row from public.ph_requests_pending where unique_id=request_id for update;' in save_definition)=0
     or position('delete from public.ph_requests_pending where unique_id=request_id;' in save_definition)=0 then
    raise exception 'REQUEST_COMPLETION_BASE_TABLE_CONTRACT_MISSING';
  end if;
  if has_function_privilege('authenticated','public.request_completion_receipt_v2372(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.request_completion_receipt_v2372(uuid,uuid,text)','EXECUTE') then
    raise exception 'REQUEST_COMPLETION_RECEIPT_PRIVILEGE_INVALID';
  end if;
  if exists(select 1 from public.ph_requests_pending where unique_id='REQ-mvp9cdc5mc3uk7hltrd') then
    raise exception 'BLUE_SHADOW_PENDING_ROW_REMAINS';
  end if;
  if not exists(select 1 from public.ph_requests_completed_history
    where unique_id='REQ-mvp9cdc5mc3uk7hltrd' and req_status='Complete'
      and req_spec='18-20" H' and loc_match_pct=70 and loc_photo_match=31 and av_note='FULL TOPS') then
    raise exception 'BLUE_SHADOW_HISTORY_CONTRACT_MISSING';
  end if;
  if not exists(select 1 from public.ph_master_inventory
    where itemcode='002194.030.1' and locationcode='E.11.000' and lotcode='27.F1') then
    raise exception 'BLUE_SHADOW_MASTER_ROW_MISSING';
  end if;
  if not exists(select 1 from public.ph_master_inventory
    where itemcode='002194.030.1' and locationcode='E.11.000' and lotcode='27.F1' and spec='18-20" H') then
    raise exception 'BLUE_SHADOW_MASTER_SPEC_MISSING';
  end if;
  if not exists(select 1 from public.ph_master_inventory
    where itemcode='002194.030.1' and locationcode='E.11.000' and lotcode='27.F1' and loc_match_qty='31') then
    raise exception 'BLUE_SHADOW_MASTER_PHOTO_MATCH_MISSING';
  end if;
  if not exists(select 1 from public.ph_master_inventory
    where itemcode='002194.030.1' and locationcode='E.11.000' and lotcode='27.F1' and av_note='FULL TOPS') then
    raise exception 'BLUE_SHADOW_MASTER_AV_NOTE_MISSING';
  end if;
  if not exists(select 1 from public.ph_request_delivery_outbox
    where request_id='REQ-mvp9cdc5mc3uk7hltrd' and event_type='request_completed') then
    raise exception 'BLUE_SHADOW_OUTBOX_CONTRACT_MISSING';
  end if;
end
$v2372_contract$;

commit;
