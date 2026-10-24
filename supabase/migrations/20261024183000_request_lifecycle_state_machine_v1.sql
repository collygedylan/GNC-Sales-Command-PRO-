begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

alter table public.ph_request_history
  add column if not exists req_sales_note text,
  add column if not exists pick_note text,
  add column if not exists comments text,
  add column if not exists effective_qty numeric,
  add column if not exists listprice numeric,
  add column if not exists line_dollar_value numeric,
  add column if not exists photo_date timestamptz,
  add column if not exists loc_match_pct numeric,
  add column if not exists loc_photo_match numeric;

create or replace function private.request_master_has_valid_evidence_v1(
  p_master public.ph_master_inventory,
  p_at timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
stable
set search_path=''
as $function$
declare
  photo_at timestamptz;
  photo_match numeric;
  expires_at timestamptz;
begin
  if p_master.unique_id is null then return false; end if;
  photo_at:=coalesce(p_master.av_rule_photo_updated_at,p_master.date_completed,p_master.av_rule_bundle_updated_at);
  photo_match:=private.historical_requests_number_v1(p_master.loc_match_qty);
  if nullif(btrim(coalesce(p_master.photo_link,'')),'') is null
    or nullif(btrim(coalesce(p_master.spec,'')),'') is null
    or coalesce(photo_match,0)<=0
    or photo_at is null
    or (p_master.av_rule_last_cleared_at is not null and photo_at<=p_master.av_rule_last_cleared_at) then
    return false;
  end if;
  expires_at:=((timezone('America/Chicago',photo_at)::date+11)::timestamp at time zone 'America/Chicago');
  return p_at<expires_at;
end
$function$;

revoke all on function private.request_master_has_valid_evidence_v1(public.ph_master_inventory,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function private.request_receipt_json_v1(p_request_id text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  select coalesce(
    (select private.canonical_request_json(p_request_id)
      ||jsonb_build_object('lifecycle_state','pending_active','active',true)
     from public.ph_active_request active where active.unique_id=p_request_id),
    (select coalesce(history.snapshot,'{}'::jsonb)
      ||jsonb_strip_nulls(to_jsonb(history))
      ||jsonb_build_object(
        'unique_id',history.unique_id,
        'req_status','Complete',
        'date_completed',history.date_completed,
        'lifecycle_state','completed_history',
        'active',false,
        'request_history',true
      )
     from public.ph_request_history history where history.unique_id=p_request_id)
  )
$function$;

revoke all on function private.request_receipt_json_v1(text) from public,anon,authenticated,service_role;

create or replace function private.persist_completed_request_history_v1(
  p_request_id text,
  p_event text default 'completed',
  p_delivery_state text default 'pending',
  p_recovered boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  request_row public.ph_active_request%rowtype;
  master_row public.ph_master_inventory%rowtype;
  quantity numeric;
  unit_price numeric;
  photo_at timestamptz;
  match_pct numeric;
  photo_match numeric;
begin
  select * into request_row from public.ph_active_request where unique_id=p_request_id for update;
  if request_row.unique_id is null then
    raise exception using errcode='P0002',message='REQUEST_NOT_FOUND';
  end if;
  select * into master_row from public.ph_master_inventory where unique_id=request_row.master_id;
  perform private.upsert_request_history(p_request_id,p_event,p_delivery_state,p_recovered);

  quantity:=private.historical_requests_number_v1(request_row.req_qty);
  if quantity is null or quantity<=0 then quantity:=25; end if;
  unit_price:=greatest(coalesce(private.historical_requests_number_v1(master_row.listprice),0),0);
  photo_at:=coalesce(master_row.av_rule_photo_updated_at,master_row.date_completed,
    master_row.av_rule_bundle_updated_at,private.try_timestamptz(request_row.date_completed));
  match_pct:=coalesce(request_row.req_match,private.historical_requests_number_v1(master_row.match));
  photo_match:=private.historical_requests_number_v1(master_row.loc_match_qty);

  update public.ph_request_history history set
    req_status='Complete',
    req_archived=false,
    date_completed=coalesce(private.try_timestamptz(request_row.date_completed),history.date_completed,clock_timestamp()),
    req_photo_link=coalesce(nullif(request_row.req_photo_link,''),nullif(master_row.photo_link,''),history.req_photo_link),
    req_photo_name=coalesce(nullif(request_row.req_photo_name,''),nullif(master_row.photo_name,''),history.req_photo_name),
    photo_link=coalesce(nullif(request_row.req_photo_link,''),nullif(master_row.photo_link,''),history.photo_link),
    photo_name=coalesce(nullif(request_row.req_photo_name,''),nullif(master_row.photo_name,''),history.photo_name),
    req_spec=coalesce(nullif(request_row.req_spec,''),nullif(master_row.spec,''),history.req_spec),
    req_match=coalesce(request_row.req_match::text,nullif(master_row.match,''),history.req_match),
    req_caliper=coalesce(nullif(request_row.req_caliper,''),nullif(master_row.caliper,''),history.req_caliper),
    req_pic_note=coalesce(nullif(request_row.req_pic_note,''),nullif(master_row.pic_note,''),history.req_pic_note),
    req_sales_note=coalesce(nullif(request_row.req_sales_note,''),nullif(master_row.sales_note,''),history.req_sales_note),
    req_comments=coalesce(nullif(request_row.req_comments,''),nullif(master_row.sales_note,''),history.req_comments),
    av_note=coalesce(nullif(request_row.av_note,''),nullif(master_row.av_note,''),history.av_note),
    pick_note=coalesce(nullif(request_row.req_pic_note,''),nullif(master_row.pic_note,''),history.pick_note),
    comments=coalesce(nullif(request_row.req_comments,''),nullif(master_row.sales_note,''),history.comments),
    effective_qty=quantity,
    listprice=unit_price,
    line_dollar_value=round(quantity*unit_price,2),
    photo_date=coalesce(photo_at,history.photo_date),
    loc_match_pct=coalesce(match_pct,history.loc_match_pct),
    loc_photo_match=coalesce(photo_match,history.loc_photo_match),
    customeridentityid=coalesce(nullif(request_row.customeridentityid,''),history.customeridentityid),
    customername=coalesce(nullif(request_row.customername,''),history.customername),
    consigneeidentityid=coalesce(nullif(request_row.consigneeidentityid,''),history.consigneeidentityid),
    consigneename=coalesce(nullif(request_row.consigneename,''),history.consigneename),
    snapshot=coalesce(history.snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'unique_id',request_row.unique_id,'master_id',request_row.master_id,
      'commonname',coalesce(master_row.commonname,request_row.commonname),
      'contsize',coalesce(master_row.contsize,request_row.contsize),
      'locationcode',coalesce(master_row.locationcode,request_row.locationcode),
      'lotcode',coalesce(master_row.lotcode,request_row.lotcode),
      'itemcode',coalesce(master_row.itemcode,request_row.itemcode),
      'req_status','Complete','date_completed',coalesce(private.try_timestamptz(request_row.date_completed),clock_timestamp()),
      'req_photo_link',coalesce(nullif(request_row.req_photo_link,''),nullif(master_row.photo_link,'')),
      'req_photo_name',coalesce(nullif(request_row.req_photo_name,''),nullif(master_row.photo_name,'')),
      'photo_date',photo_at,'req_spec',coalesce(nullif(request_row.req_spec,''),nullif(master_row.spec,'')),
      'loc_match_pct',match_pct,'loc_photo_match',photo_match,
      'av_note',coalesce(nullif(request_row.av_note,''),nullif(master_row.av_note,'')),
      'pick_note',coalesce(nullif(request_row.req_pic_note,''),nullif(master_row.pic_note,'')),
      'comments',coalesce(nullif(request_row.req_comments,''),nullif(master_row.sales_note,'')),
      'effective_qty',quantity,'listprice',unit_price,'line_dollar_value',round(quantity*unit_price,2),
      'request_selected_salesrep_id',request_row.request_selected_salesrep_id,
      'customeridentityid',request_row.customeridentityid,'customername',request_row.customername,
      'consigneeidentityid',request_row.consigneeidentityid,'consigneename',request_row.consigneename
    )),
    last_event=p_event,
    delivery_state=p_delivery_state,
    updated_at=clock_timestamp()
  where history.unique_id=p_request_id;

  return (select coalesce(history.snapshot,'{}'::jsonb)
    ||jsonb_strip_nulls(to_jsonb(history))
    ||jsonb_build_object(
      'unique_id',history.unique_id,'req_status','Complete','date_completed',history.date_completed,
      'lifecycle_state','completed_history','active',false,'request_history',true
    )
    from public.ph_request_history history where history.unique_id=p_request_id);
end
$function$;

revoke all on function private.persist_completed_request_history_v1(text,text,text,boolean)
  from public,anon,authenticated,service_role;

alter function public.save_request_work_v1(text,bigint,jsonb,boolean)
  rename to save_request_work_v1_pre_state_machine_v2359;
revoke all on function public.save_request_work_v1_pre_state_machine_v2359(text,bigint,jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.save_request_work_v1(
  request_id text,
  expected_version bigint,
  patch jsonb,
  complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  result jsonb;
  request_row public.ph_active_request%rowtype;
  receipt jsonb;
  delivery_state text;
begin
  result:=public.save_request_work_v1_pre_state_machine_v2359(request_id,expected_version,patch,complete);
  select * into request_row from public.ph_active_request where unique_id=request_id for update;
  if request_row.unique_id is null then
    raise exception using errcode='P0002',message='REQUEST_NOT_FOUND';
  end if;

  if complete then
    update public.ph_master_inventory master set
      initial_ptr=coalesce(nullif(master.ptronhand,''),nullif(master.ptravailable,''),master.initial_ptr),
      date_completed=coalesce(master.date_completed,clock_timestamp()),
      pick=coalesce(nullif(request_row.req_pic_note,''),master.pick),
      sales_note=coalesce(nullif(request_row.req_comments,''),nullif(request_row.req_sales_note,''),master.sales_note),
      av_rule_bundle_updated_at=clock_timestamp()
    where master.unique_id=request_row.master_id;

    receipt:=private.persist_completed_request_history_v1(request_id,'completed','pending',false);
    delete from public.ph_active_request where unique_id=request_id;
    delivery_state:=coalesce(result->>'delivery_state','pending');
    return result||jsonb_build_object(
      'row',receipt,'row_version',request_row.row_version,
      'delivery_state',delivery_state,'acknowledged',true,
      'lifecycle_state','completed_history','active',false
    );
  end if;

  delete from public.ph_request_history history
  where history.unique_id=request_id and history.date_completed is null
    and lower(btrim(coalesce(history.req_status,'pending'))) not in
      ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed');
  receipt:=private.request_receipt_json_v1(request_id);
  return result||jsonb_build_object(
    'row',receipt,'row_version',request_row.row_version,
    'lifecycle_state','pending_active','active',true
  );
end
$function$;

revoke all on function public.save_request_work_v1(text,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_request_work_v1(text,bigint,jsonb,boolean) to service_role;

alter function public.save_request_work(text,bigint,jsonb,boolean)
  rename to save_request_work_pre_state_machine_v2359;
revoke all on function public.save_request_work_pre_state_machine_v2359(text,bigint,jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.save_request_work(
  request_id text,
  expected_version bigint,
  patch jsonb,
  complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  history_row public.ph_request_history%rowtype;
  profile public.profiles%rowtype;
  receipt jsonb;
begin
  if exists(select 1 from public.ph_active_request where unique_id=request_id) then
    return public.save_request_work_pre_state_machine_v2359(request_id,expected_version,patch,complete);
  end if;
  if not complete then raise exception using errcode='P0002',message='REQUEST_NOT_FOUND'; end if;
  if not private.can_save_request_work() then
    raise exception using errcode='42501',message='REQUEST_SAVE_FORBIDDEN';
  end if;
  select * into history_row from public.ph_request_history history where history.unique_id=request_id;
  if history_row.unique_id is null or history_row.date_completed is null then
    raise exception using errcode='P0002',message='REQUEST_NOT_FOUND';
  end if;
  profile:=private.current_active_profile();
  if lower(btrim(coalesce(profile.username,''))) in ('ben_brown','chance_alldredge')
    and not private.can_work_request_identity(
      history_row.request_created_by_username,history_row.request_selected_rep_username,history_row.requested_by
    ) then
    raise exception using errcode='42501',message='REQUEST_ROW_FORBIDDEN';
  end if;
  receipt:=private.request_receipt_json_v1(request_id);
  return jsonb_build_object(
    'row',receipt,'row_version',history_row.row_version,
    'delivery_state',coalesce((select outbox.status from public.ph_request_delivery_outbox outbox
      where outbox.request_id=request_id and outbox.event_type='request_completed'
      order by outbox.created_at desc limit 1),'already_completed'),
    'acknowledged',true,'idempotent_replay',true,
    'lifecycle_state','completed_history','active',false
  );
end
$function$;

revoke all on function public.save_request_work(text,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_request_work(text,bigint,jsonb,boolean) to service_role;

alter function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)
  rename to request_work_command_v1_pre_state_machine_v2359;
revoke all on function public.request_work_command_v1_pre_state_machine_v2359(uuid,uuid,text,text,bigint,jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.request_work_command_v1(
  p_actor_id uuid,
  p_session_id uuid,
  p_operation text,
  p_request_id text default null,
  p_expected_version bigint default null,
  p_patch jsonb default '{}'::jsonb,
  p_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  history_row public.ph_request_history%rowtype;
  master_row public.ph_master_inventory%rowtype;
  result jsonb;
begin
  if p_operation<>'save' or not p_complete
    or exists(select 1 from public.ph_active_request where unique_id=p_request_id) then
    return public.request_work_command_v1_pre_state_machine_v2359(
      p_actor_id,p_session_id,p_operation,p_request_id,p_expected_version,p_patch,p_complete
    );
  end if;
  if not private.is_service_role_request()
    or not suspend_tag_private.session_active(p_actor_id,p_session_id) then
    raise exception using errcode='42501',message='REQUEST_WORK_SESSION_REQUIRED';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_actor_id,'role','authenticated','session_id',p_session_id
  )::text,true);
  if jsonb_typeof(p_patch)<>'object' then
    raise exception using errcode='22023',message='REQUEST_WORK_OPERATION_INVALID';
  end if;
  select * into history_row from public.ph_request_history history where history.unique_id=p_request_id;
  if history_row.unique_id is null or history_row.date_completed is null then
    raise exception using errcode='P0002',message='REQUEST_NOT_FOUND';
  end if;
  if not private.can_save_request_work() then
    raise exception using errcode='42501',message='REQUEST_SAVE_FORBIDDEN';
  end if;
  if not private.can_work_request_identity(
    history_row.request_created_by_username,history_row.request_selected_rep_username,history_row.requested_by
  ) then
    raise exception using errcode='42501',message='REQUEST_ROW_FORBIDDEN';
  end if;
  result:=public.save_request_work(p_request_id,p_expected_version,p_patch,true);
  select * into master_row from public.ph_master_inventory where unique_id=history_row.master_id;
  return result||jsonb_build_object(
    'master_row',case when master_row.unique_id is null then null else to_jsonb(master_row) end
  );
end
$function$;

revoke all on function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)
  to service_role;

create or replace function private.insert_request_batch(
  p_client_batch_id uuid,
  p_requests jsonb,
  p_request_source text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  entry jsonb;
  request_id text;
  request_ids text[]:=array[]::text[];
  pending_ids text[]:=array[]::text[];
  completed_ids text[]:=array[]::text[];
  inserted_count integer:=0;
  master public.ph_master_inventory%rowtype;
  is_complete boolean;
  source_name text:=lower(btrim(coalesce(p_request_source,'general')));
  snapshots jsonb;
begin
  if p_client_batch_id is null then raise exception using errcode='22023',message='CLIENT_BATCH_ID_REQUIRED'; end if;
  if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests)<1 or jsonb_array_length(p_requests)>100 then
    raise exception using errcode='22023',message='REQUEST_BATCH_SIZE_INVALID';
  end if;

  for entry in select value from jsonb_array_elements(p_requests)
  loop
    request_id:=nullif(btrim(coalesce(entry->>'unique_id','')),'');
    if request_id is null then raise exception using errcode='22023',message='REQUEST_ID_REQUIRED'; end if;
    if request_id=any(request_ids) then raise exception using errcode='23505',message='DUPLICATE_REQUEST_ID_IN_BATCH'; end if;
    request_ids:=array_append(request_ids,request_id);

    if exists(select 1 from public.ph_active_request active where active.unique_id=request_id)
      or exists(select 1 from public.ph_request_history history where history.unique_id=request_id) then
      if not exists(select 1 from public.ph_active_request active
          where active.unique_id=request_id and active.client_batch_id=p_client_batch_id)
        and not exists(select 1 from public.ph_request_history history
          where history.unique_id=request_id and history.client_batch_id=p_client_batch_id) then
        raise exception using errcode='23505',message='REQUEST_ID_ALREADY_USED';
      end if;
      if exists(select 1 from public.ph_active_request active where active.unique_id=request_id) then
        pending_ids:=array_append(pending_ids,request_id);
      else
        completed_ids:=array_append(completed_ids,request_id);
      end if;
      continue;
    end if;

    select candidate.* into master
    from public.ph_master_inventory candidate
    where candidate.unique_id=nullif(btrim(coalesce(entry->>'master_id','')),'')
      or (
        nullif(btrim(coalesce(entry->>'itemcode','')),'') is not null
        and nullif(btrim(coalesce(entry->>'locationcode','')),'') is not null
        and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(entry->>'itemcode'))
        and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(entry->>'locationcode'))
      )
    order by private.request_master_has_valid_evidence_v1(candidate,clock_timestamp()) desc,
      (candidate.unique_id=nullif(btrim(coalesce(entry->>'master_id','')),'')) desc,
      coalesce(candidate.av_rule_photo_updated_at,candidate.date_completed,candidate.av_rule_bundle_updated_at) desc nulls last,
      candidate.unique_id
    limit 1 for update;
    is_complete:=private.request_master_has_valid_evidence_v1(master,clock_timestamp());

    insert into public.ph_active_request(
      unique_id,master_id,commonname,contsize,locationcode,lotcode,itemcode,ptravailable,
      season_supply,priority,qualitycode,field_tag_color,plantgroupcode,requested_by,
      request_folder,req_customer,req_qty,desired_spec,desired_caliper,est_ship,req_reserve,
      req_photo_link,req_photo_name,req_archived,req_status,req_rep_action,created_at,
      req_match,req_spec,req_caliper,req_pic_note,req_sales_note,req_comments,av_note,date_completed,
      completed_by_username,completed_by_display,completed_by_email,req_photo_mode,request_note,
      request_created_by_username,request_created_by_display,request_created_by_email,
      request_selected_rep_username,request_selected_rep_display,request_selected_salesrep_id,
      request_selected_rep_email,app_tab_assignment,master_app_tab_assignment,request_source,
      client_batch_id,row_version,customeridentityid,customername,consigneeidentityid,consigneename
    ) values(
      request_id,coalesce(master.unique_id,nullif(btrim(entry->>'master_id'),'')),
      coalesce(master.commonname,entry->>'commonname'),coalesce(master.contsize,entry->>'contsize'),
      coalesce(master.locationcode,entry->>'locationcode'),coalesce(master.lotcode,entry->>'lotcode'),
      coalesce(master.itemcode,entry->>'itemcode'),coalesce(master.ptravailable,entry->>'ptravailable'),
      coalesce(master.season_supply,entry->>'season_supply'),coalesce(master.priority,entry->>'priority'),
      coalesce(master.qualitycode,entry->>'qualitycode'),coalesce(master.field_tag_color,entry->>'field_tag_color'),
      coalesce(master.plantgroupcode,entry->>'plantgroupcode'),entry->>'requested_by',entry->>'request_folder',
      entry->>'req_customer',entry->>'req_qty',entry->>'desired_spec',entry->>'desired_caliper',entry->>'est_ship',
      coalesce(entry->>'req_reserve','NO'),
      case when is_complete then master.photo_link else entry->>'req_photo_link' end,
      case when is_complete then master.photo_name else entry->>'req_photo_name' end,
      false,case when is_complete then 'Complete' else 'Pending' end,entry->>'req_rep_action',
      coalesce(private.try_timestamptz(entry->>'created_at'),clock_timestamp()),
      case when is_complete then private.historical_requests_number_v1(master.match)
        else private.historical_requests_number_v1(entry->>'req_match') end,
      case when is_complete then master.spec else entry->>'req_spec' end,
      case when is_complete then master.caliper else entry->>'req_caliper' end,
      case when is_complete then coalesce(nullif(master.pick,''),master.pic_note) else entry->>'req_pic_note' end,
      case when is_complete then master.sales_note else entry->>'req_sales_note' end,
      case when is_complete then coalesce(nullif(entry->>'req_comments',''),master.sales_note) else entry->>'req_comments' end,
      case when is_complete then master.av_note else entry->>'av_note' end,
      case when is_complete then clock_timestamp()::text else null end,
      case when is_complete then entry->>'completed_by_username' else null end,
      case when is_complete then entry->>'completed_by_display' else null end,
      case when is_complete then entry->>'completed_by_email' else null end,
      entry->>'req_photo_mode',entry->>'request_note',entry->>'request_created_by_username',
      entry->>'request_created_by_display',entry->>'request_created_by_email',
      entry->>'request_selected_rep_username',entry->>'request_selected_rep_display',
      entry->>'request_selected_salesrep_id',entry->>'request_selected_rep_email',
      coalesce(master.app_tab_assignment,entry->>'app_tab_assignment'),
      coalesce(master.app_tab_assignment,entry->>'master_app_tab_assignment'),source_name,
      p_client_batch_id,1,entry->>'customeridentityid',entry->>'customername',
      entry->>'consigneeidentityid',entry->>'consigneename'
    );
    inserted_count:=inserted_count+1;

    if is_complete then
      perform private.persist_completed_request_history_v1(request_id,'completed','pending',false);
      insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status)
      values('request-completed:auto-evidence:'||request_id,'request_completed',request_id,entry->>'request_folder',
        jsonb_build_object('request_id',request_id,'request_ids',jsonb_build_array(request_id),
          'reason','valid_master_evidence','client_batch_id',p_client_batch_id),'pending')
      on conflict(event_key) do nothing;
      delete from public.ph_active_request where unique_id=request_id;
      completed_ids:=array_append(completed_ids,request_id);
    else
      delete from public.ph_request_history history where history.unique_id=request_id and history.date_completed is null;
      pending_ids:=array_append(pending_ids,request_id);
    end if;
  end loop;

  select coalesce(jsonb_agg(private.request_receipt_json_v1(id) order by ordinal),'[]'::jsonb)
    into snapshots from unnest(request_ids) with ordinality request(id,ordinal);

  if cardinality(pending_ids)>0 then
    insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status)
    values('request-created:'||p_client_batch_id::text,'request_created',p_requests->0->>'request_folder',
      jsonb_build_object('client_batch_id',p_client_batch_id,'request_ids',to_jsonb(pending_ids),
        'requests',(select coalesce(jsonb_agg(private.request_receipt_json_v1(id)),'[]'::jsonb)
          from unnest(pending_ids) id)),'pending')
    on conflict(event_key) do nothing;
  end if;

  return jsonb_build_object(
    'client_batch_id',p_client_batch_id,'inserted_count',inserted_count,'rows',snapshots,
    'pending_count',cardinality(pending_ids),'completed_count',cardinality(completed_ids),
    'delivery_state',case when cardinality(pending_ids)+cardinality(completed_ids)>0 then 'pending' else 'acknowledged' end,
    'lifecycle_state','classified'
  );
end
$function$;

revoke all on function private.insert_request_batch(uuid,jsonb,text) from public,anon,authenticated,service_role;

alter function public.append_request_options_v1(uuid,text,text,text[])
  rename to append_request_options_v1_pre_state_machine_v2359;
revoke all on function public.append_request_options_v1_pre_state_machine_v2359(uuid,text,text,text[])
  from public,anon,authenticated,service_role;

create function public.append_request_options_v1(
  p_client_batch_id uuid,
  p_request_folder text,
  p_source_request_id text,
  p_inventory_row_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  result jsonb;
  candidate record;
  ids text[];
  snapshots jsonb;
begin
  result:=public.append_request_options_v1_pre_state_machine_v2359(
    p_client_batch_id,p_request_folder,p_source_request_id,p_inventory_row_ids
  );
  for candidate in
    select active.*,master as master_row
    from public.ph_active_request active
    left join public.ph_master_inventory master on master.unique_id=active.master_id
    where active.client_batch_id=p_client_batch_id and active.request_folder=p_request_folder
    order by active.unique_id for update of active
  loop
    if private.request_master_has_valid_evidence_v1(candidate.master_row,clock_timestamp()) then
      update public.ph_active_request active set
        req_status='Complete',date_completed=clock_timestamp()::text,
        req_photo_link=candidate.master_row.photo_link,req_photo_name=candidate.master_row.photo_name,
        req_match=private.historical_requests_number_v1(candidate.master_row.match),
        req_spec=candidate.master_row.spec,req_caliper=candidate.master_row.caliper,
        req_pic_note=candidate.master_row.pic_note,
        req_sales_note=candidate.master_row.sales_note,req_comments=candidate.master_row.sales_note,
        av_note=candidate.master_row.av_note,row_version=active.row_version+1
      where active.unique_id=candidate.unique_id;
      perform private.persist_completed_request_history_v1(candidate.unique_id,'completed','pending',false);
      insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status)
      values('request-completed:auto-evidence:'||candidate.unique_id,'request_completed',candidate.unique_id,p_request_folder,
        jsonb_build_object('request_id',candidate.unique_id,'request_ids',jsonb_build_array(candidate.unique_id),
          'reason','valid_master_evidence','client_batch_id',p_client_batch_id),'pending')
      on conflict(event_key) do nothing;
      delete from public.ph_active_request where unique_id=candidate.unique_id;
    else
      delete from public.ph_request_history history
      where history.unique_id=candidate.unique_id and history.date_completed is null;
    end if;
  end loop;
  select coalesce(array_agg(request_id order by request_id),'{}'::text[]) into ids from (
    select active.unique_id request_id from public.ph_active_request active where active.client_batch_id=p_client_batch_id
    union select history.unique_id from public.ph_request_history history where history.client_batch_id=p_client_batch_id
  ) requests;
  select coalesce(jsonb_agg(private.request_receipt_json_v1(id) order by id),'[]'::jsonb)
    into snapshots from unnest(ids) id;
  perform private.reconcile_request_folder_completion_v2(p_request_folder);
  return result||jsonb_build_object('rows',snapshots,'lifecycle_state','classified');
end
$function$;

revoke all on function public.append_request_options_v1(uuid,text,text,text[]) from public,anon;
grant execute on function public.append_request_options_v1(uuid,text,text,text[]) to authenticated,service_role;

create or replace function private.enforce_request_lifecycle_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='30s'
as $function$
declare
  candidate record;
  master_row public.ph_master_inventory%rowtype;
  terminal boolean;
  evidence_ready boolean;
  completion_at timestamptz;
  archived_count integer:=0;
  evidence_count integer:=0;
  pending_count integer:=0;
  history_removed integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-lifecycle-state-machine-v1',0)) then
    return jsonb_build_object('ok',true,'busy',true,'archived',0,'autoCompleted',0,'pending',0,'historyRemoved',0);
  end if;
  for candidate in
    select active.* from public.ph_active_request active
    where active.move_batch_id is null
    order by active.created_at,active.unique_id
    for update skip locked
  loop
    select master.* into master_row from public.ph_master_inventory master
    where master.unique_id=candidate.master_id
       or (upper(btrim(coalesce(master.itemcode,'')))=upper(btrim(coalesce(candidate.itemcode,'')))
         and upper(btrim(coalesce(master.locationcode,'')))=upper(btrim(coalesce(candidate.locationcode,''))))
    order by private.request_master_has_valid_evidence_v1(master,clock_timestamp()) desc,
      (master.unique_id=candidate.master_id) desc,
      coalesce(master.av_rule_photo_updated_at,master.date_completed,master.av_rule_bundle_updated_at) desc nulls last,
      master.unique_id limit 1 for update;
    evidence_ready:=private.request_master_has_valid_evidence_v1(master_row,clock_timestamp());
    terminal:=candidate.created_at<timestamptz '2026-10-20 00:00:00 America/Chicago'
      or nullif(btrim(coalesce(candidate.date_completed,'')),'') is not null
      or lower(btrim(coalesce(candidate.req_status,''))) in
        ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')
      or exists(select 1 from public.ph_request_delivery_outbox outbox
        where outbox.event_type='request_completed'
          and (outbox.request_id=candidate.unique_id or outbox.payload->>'request_id'=candidate.unique_id
            or (jsonb_typeof(outbox.payload->'request_ids')='array' and outbox.payload->'request_ids' ? candidate.unique_id)))
      or exists(select 1 from public.ph_request_history history
        where history.unique_id=candidate.unique_id
          and (history.date_completed is not null or lower(btrim(coalesce(history.req_status,''))) in
            ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')));

    if terminal or evidence_ready then
      select coalesce(private.try_timestamptz(candidate.date_completed),
        (select history.date_completed from public.ph_request_history history where history.unique_id=candidate.unique_id),
        (select outbox.created_at from public.ph_request_delivery_outbox outbox
          where outbox.event_type='request_completed'
            and (outbox.request_id=candidate.unique_id or outbox.payload->>'request_id'=candidate.unique_id
              or (jsonb_typeof(outbox.payload->'request_ids')='array' and outbox.payload->'request_ids' ? candidate.unique_id))
          order by outbox.created_at desc limit 1),
        case when terminal then candidate.created_at else clock_timestamp() end,clock_timestamp())
        into completion_at;
      update public.ph_active_request active set
        master_id=coalesce(master_row.unique_id,active.master_id),req_status='Complete',req_archived=false,
        date_completed=completion_at::text,
        req_photo_link=case when evidence_ready then master_row.photo_link else active.req_photo_link end,
        req_photo_name=case when evidence_ready then master_row.photo_name else active.req_photo_name end,
        req_match=case when evidence_ready then private.historical_requests_number_v1(master_row.match) else active.req_match end,
        req_spec=case when evidence_ready then master_row.spec else active.req_spec end,
        req_caliper=case when evidence_ready then master_row.caliper else active.req_caliper end,
      req_pic_note=case when evidence_ready then master_row.pic_note else active.req_pic_note end,
        req_sales_note=case when evidence_ready then master_row.sales_note else active.req_sales_note end,
        req_comments=case when evidence_ready then coalesce(nullif(active.req_comments,''),master_row.sales_note) else active.req_comments end,
        av_note=case when evidence_ready then master_row.av_note else active.av_note end,
        row_version=active.row_version+1
      where active.unique_id=candidate.unique_id;
      perform private.persist_completed_request_history_v1(candidate.unique_id,
        case when evidence_ready and not terminal then 'auto_completed' else 'completed' end,'not_queued',true);
      if evidence_ready and not terminal then
        insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status)
        values('request-completed:auto-evidence:'||candidate.unique_id,'request_completed',candidate.unique_id,candidate.request_folder,
          jsonb_build_object('request_id',candidate.unique_id,'request_ids',jsonb_build_array(candidate.unique_id),
            'reason','valid_master_evidence'),'pending')
        on conflict(event_key) do nothing;
        evidence_count:=evidence_count+1;
      else
        archived_count:=archived_count+1;
      end if;
      delete from public.ph_active_request where unique_id=candidate.unique_id;
    else
      update public.ph_active_request active set req_status='Pending',req_archived=false,date_completed=null
      where active.unique_id=candidate.unique_id
        and (active.req_status is distinct from 'Pending' or coalesce(active.req_archived,false)
          or nullif(btrim(coalesce(active.date_completed,'')),'') is not null);
      with removed as (
        delete from public.ph_request_history history
        where history.unique_id=candidate.unique_id and history.date_completed is null
          and lower(btrim(coalesce(history.req_status,'pending'))) not in
            ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')
        returning 1
      ) select history_removed+count(*) into history_removed from removed;
      pending_count:=pending_count+1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'busy',false,'archived',archived_count,
    'autoCompleted',evidence_count,'pending',pending_count,'historyRemoved',history_removed);
end
$function$;

revoke all on function private.enforce_request_lifecycle_v1() from public,anon,authenticated,service_role;

create or replace function public.reconcile_active_requests_from_outbox_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='30s'
as $function$
declare
  primary_result jsonb;
  legacy_result jsonb;
  lifecycle_result jsonb;
begin
  primary_result:=private.reconcile_active_requests_from_outbox_v1();
  if coalesce((primary_result->>'busy')::boolean,false) then return primary_result; end if;
  legacy_result:=private.reconcile_legacy_pending_requests_from_outbox_v4();
  if coalesce((legacy_result->>'busy')::boolean,false) then return legacy_result; end if;
  lifecycle_result:=private.enforce_request_lifecycle_v1();
  return jsonb_build_object(
    'ok',coalesce((primary_result->>'ok')::boolean,false)
      and coalesce((legacy_result->>'ok')::boolean,false)
      and coalesce((lifecycle_result->>'ok')::boolean,false),
    'busy',coalesce((lifecycle_result->>'busy')::boolean,false),
    'examined',greatest(coalesce((primary_result->>'examined')::integer,0),coalesce((legacy_result->>'examined')::integer,0)),
    'inserted',coalesce((primary_result->>'inserted')::integer,0)+coalesce((legacy_result->>'inserted')::integer,0),
    'repaired',coalesce((primary_result->>'repaired')::integer,0)+coalesce((legacy_result->>'repaired')::integer,0),
    'retained',coalesce((legacy_result->>'retained')::integer,0),
    'skipped',coalesce((primary_result->>'skipped')::integer,0)+coalesce((legacy_result->>'skipped')::integer,0),
    'archived',coalesce((lifecycle_result->>'archived')::integer,0),
    'autoCompleted',coalesce((lifecycle_result->>'autoCompleted')::integer,0),
    'pending',coalesce((lifecycle_result->>'pending')::integer,0),
    'scope','last-14-days-and-active','primary',primary_result,'legacy',legacy_result,'lifecycle',lifecycle_result
  );
end
$function$;

revoke all on function public.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
grant execute on function public.reconcile_active_requests_from_outbox_v1() to service_role;

update public.ph_master_inventory set commonname=private.normalize_escaped_display_text_v1(commonname)
where commonname is not null and strpos(commonname,chr(92))>0;
update public.ph_active_request set commonname=private.normalize_escaped_display_text_v1(commonname)
where commonname is not null and strpos(commonname,chr(92))>0;
update public.ph_request_history set commonname=private.normalize_escaped_display_text_v1(commonname)
where commonname is not null and strpos(commonname,chr(92))>0;

do $reconcile$
declare result jsonb;
begin
  result:=public.reconcile_active_requests_from_outbox_v1();
  if not coalesce((result->>'ok')::boolean,false)
    or coalesce((result->>'busy')::boolean,false)
    or coalesce((result->>'skipped')::integer,0)<>0 then
    raise exception 'REQUEST_LIFECYCLE_RECONCILIATION_INCOMPLETE: %',result;
  end if;
end
$reconcile$;

insert into public.app_dataset_revisions(key,revision,state,changed_at)
values('ph_active_request',1,'ready',clock_timestamp()),('ph_request_history',1,'ready',clock_timestamp())
on conflict(key) do update set revision=public.app_dataset_revisions.revision+1,state='ready',changed_at=clock_timestamp();

update public.app_runtime_watchdog_events set status='resolved'
where status='open' and app_version<>'2.3.59';

do $verify$
begin
  if exists(select 1 from public.ph_active_request active
    left join public.ph_master_inventory master on master.unique_id=active.master_id
    where active.move_batch_id is null and (
      active.created_at<timestamptz '2026-10-20 00:00:00 America/Chicago'
      or lower(btrim(coalesce(active.req_status,'')))<>'pending'
      or coalesce(active.req_archived,false)
      or nullif(btrim(coalesce(active.date_completed,'')),'') is not null
      or private.request_master_has_valid_evidence_v1(master,clock_timestamp())
    )) then raise exception 'ACTIVE_REQUEST_LIFECYCLE_SEPARATION_INVALID'; end if;
  if exists(select 1 from public.ph_active_request active join public.ph_request_history history using(unique_id)
    where active.move_batch_id is null and history.date_completed is null
      and lower(btrim(coalesce(history.req_status,'pending'))) not in
        ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')) then
    raise exception 'PENDING_REQUEST_HISTORY_OVERLAP_REMAINS';
  end if;
  if not exists(select 1 from public.ph_active_request active
    where active.move_batch_id is null and lower(btrim(coalesce(active.req_status,'')))='pending'
      and active.date_completed is null) then raise exception 'ACTIVE_REQUEST_QUEUE_EMPTY'; end if;
  if exists(select 1 from public.ph_master_inventory where commonname~$regex$\\+(['"])$regex$)
    or exists(select 1 from public.ph_active_request where commonname~$regex$\\+(['"])$regex$)
    or exists(select 1 from public.ph_request_history where commonname~$regex$\\+(['"])$regex$) then
    raise exception 'ESCAPED_REQUEST_DISPLAY_TEXT_REMAINS';
  end if;
  if not has_function_privilege('service_role','public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)','execute')
    or has_function_privilege('authenticated','public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)','execute')
    or not has_function_privilege('service_role','public.reconcile_active_requests_from_outbox_v1()','execute')
    or has_function_privilege('authenticated','public.reconcile_active_requests_from_outbox_v1()','execute') then
    raise exception 'REQUEST_LIFECYCLE_PRIVILEGES_INVALID';
  end if;
end
$verify$;

comment on function private.request_master_has_valid_evidence_v1(public.ph_master_inventory,timestamptz) is
  'True only for a current photo plus spec with positive current location-photo quantity through 11:59 PM America/Chicago on day 10.';
comment on function private.enforce_request_lifecycle_v1() is
  'Keeps regular unfulfilled rows only in active Request and permanently archives completed/current-evidence rows.';

commit;
