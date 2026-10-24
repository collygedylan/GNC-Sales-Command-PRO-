begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

create schema if not exists archive_backup;
revoke all on schema archive_backup from public,anon,authenticated;

grant select on public.ph_master_inventory to authenticated;

create index if not exists ph_request_delivery_outbox_payload_request_id_v2360_idx
  on public.ph_request_delivery_outbox((payload->>'request_id'));
create index if not exists ph_request_delivery_outbox_payload_request_ids_v2360_idx
  on public.ph_request_delivery_outbox using gin((payload->'request_ids'));

create table if not exists app_sync_private.request_lifecycle_recovery_audit_v1(
  id bigint generated always as identity primary key,
  unique_id text not null,
  recovery_source text not null,
  prior_row jsonb not null,
  recovered_at timestamptz not null default clock_timestamp()
);
alter table app_sync_private.request_lifecycle_recovery_audit_v1 enable row level security;
revoke all on app_sync_private.request_lifecycle_recovery_audit_v1 from public,anon,authenticated;

create or replace function private.block_request_history_loss_v2360()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if tg_op='TRUNCATE' then
    raise exception using errcode='42501',message='REQUEST_HISTORY_TRUNCATE_FORBIDDEN';
  end if;
  return null;
end
$function$;
revoke all on function private.block_request_history_loss_v2360() from public,anon,authenticated,service_role;

drop trigger if exists ph_request_history_block_delete_v2360 on public.ph_request_history;
create trigger ph_request_history_block_delete_v2360
before delete on public.ph_request_history
for each row execute function private.block_request_history_loss_v2360();

drop trigger if exists ph_request_history_block_truncate_v2360 on public.ph_request_history;
create trigger ph_request_history_block_truncate_v2360
before truncate on public.ph_request_history
for each statement execute function private.block_request_history_loss_v2360();

do $repair$
declare
  definition text;
begin
  definition:=pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure);
  if position('master.pick' in definition)>0 then
    execute replace(definition,'master.pick','master.pic_note');
  end if;

  definition:=pg_get_functiondef('public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure);
  if position('master.pick' in definition)>0 then
    execute replace(definition,'master.pick','master.pic_note');
  end if;

  definition:=pg_get_functiondef('public.append_request_options_v1(uuid,text,text,text[])'::regprocedure);
  if position('candidate.master_row.' in definition)>0 then
    execute replace(definition,'candidate.master_row.','(candidate.master_row).');
  end if;

  definition:=pg_get_functiondef('public.save_request_work(text,bigint,jsonb,boolean)'::regprocedure);
  definition:=replace(definition,'outbox.request_id=request_id','outbox.request_id=$1');
  definition:=replace(definition,'outbox.request_id = request_id','outbox.request_id = $1');
  execute definition;
end
$repair$;

create or replace function private.request_history_has_valid_evidence_v1(p_history public.ph_request_history)
returns boolean
language sql
stable
set search_path=''
as $function$
  select nullif(btrim(coalesce(
      p_history.req_photo_link,p_history.photo_link,p_history.snapshot->>'req_photo_link',p_history.snapshot->>'photo_link',''
    )),'') is not null
    and nullif(btrim(coalesce(p_history.req_spec,p_history.snapshot->>'req_spec',p_history.snapshot->>'spec','')),'') is not null
$function$;
revoke all on function private.request_history_has_valid_evidence_v1(public.ph_request_history)
  from public,anon,authenticated,service_role;

create or replace function private.request_completion_proof_v1(
  p_request_id text,
  p_master_id text default null,
  p_itemcode text default null,
  p_locationcode text default null
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if exists(
    select 1 from public.ph_request_history history
    where history.unique_id=p_request_id and private.request_history_has_valid_evidence_v1(history)
  ) then return 'history_photo_spec'; end if;

  if exists(
    select 1 from public.ph_request_delivery_outbox outbox
    where outbox.event_type='request_completed'
      and (outbox.request_id=p_request_id or outbox.payload->>'request_id'=p_request_id
        or (jsonb_typeof(outbox.payload->'request_ids')='array' and outbox.payload->'request_ids' ? p_request_id))
  ) then return 'request_completed'; end if;

  if exists(
    select 1 from public.ph_master_inventory master
    where (master.unique_id=p_master_id or (
        nullif(btrim(coalesce(p_itemcode,'')),'') is not null
        and nullif(btrim(coalesce(p_locationcode,'')),'') is not null
        and upper(btrim(coalesce(master.itemcode,'')))=upper(btrim(p_itemcode))
        and upper(btrim(coalesce(master.locationcode,'')))=upper(btrim(p_locationcode))
      ))
      and private.request_master_has_valid_evidence_v1(master,statement_timestamp())
  ) then return 'current_master_evidence'; end if;

  if exists(
    select 1 from private.ph_request_queue_removal_commands removal
    where removal.request_uid=p_request_id
  ) then return 'explicit_queue_removal'; end if;

  return null;
end
$function$;
revoke all on function private.request_completion_proof_v1(text,text,text,text)
  from public,anon,authenticated,service_role;

create or replace function private.recover_unfulfilled_requests_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='30s'
as $function$
declare
  candidate record;
  request_data jsonb;
  request_id text;
  inserted_count integer:=0;
  history_count integer:=0;
  outbox_count integer:=0;
  affected integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-recovery-v2360',0)) then
    return jsonb_build_object('ok',true,'busy',true,'recovered',0,'history',0,'outbox',0);
  end if;

  for candidate in
    with history_without_evidence as materialized (
      select history.*
      from public.ph_request_history history
      where nullif(btrim(coalesce(history.unique_id,'')),'') is not null
        and not private.request_history_has_valid_evidence_v1(history)
        and not exists(select 1 from public.ph_active_request active where active.unique_id=history.unique_id)
    )
    select history.* from history_without_evidence history
    where private.request_completion_proof_v1(
        history.unique_id,coalesce(history.master_id,history.master_unique_id),history.itemcode,history.locationcode
      ) is null
    order by history.created_at,history.unique_id
  loop
    insert into app_sync_private.request_lifecycle_recovery_audit_v1(unique_id,recovery_source,prior_row)
    values(candidate.unique_id,'ph_request_history',to_jsonb(candidate));

    insert into public.ph_active_request(
      unique_id,master_id,commonname,contsize,locationcode,lotcode,itemcode,ptravailable,
      season_supply,priority,qualitycode,field_tag_color,plantgroupcode,requested_by,
      request_folder,req_customer,req_qty,desired_spec,desired_caliper,est_ship,req_reserve,
      req_photo_link,req_photo_name,req_archived,req_status,req_rep_action,created_at,
      req_match,req_spec,req_caliper,req_pic_note,req_sales_note,req_comments,av_note,date_completed,
      completed_by_username,completed_by_display,completed_by_email,req_photo_mode,request_note,
      request_created_by_username,request_created_by_display,request_created_by_email,
      request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,
      app_tab_assignment,master_app_tab_assignment,request_source,client_batch_id,row_version,
      customeridentityid,customername,consigneeidentityid,consigneename
    ) values(
      candidate.unique_id,coalesce(candidate.master_id,candidate.master_unique_id),candidate.commonname,
      candidate.contsize,candidate.locationcode,candidate.lotcode,candidate.itemcode,candidate.ptravailable,
      candidate.season_supply,candidate.priority,candidate.qualitycode,candidate.field_tag_color,
      candidate.plantgroupcode,candidate.requested_by,candidate.request_folder,
      coalesce(candidate.req_customer,candidate.request_customer),candidate.req_qty,candidate.desired_spec,
      candidate.desired_caliper,candidate.est_ship,candidate.req_reserve,candidate.req_photo_link,
      candidate.req_photo_name,false,'Pending',candidate.req_rep_action,
      coalesce(candidate.created_at,candidate.updated_at,clock_timestamp()),
      private.historical_requests_number_v1(candidate.req_match),candidate.req_spec,candidate.req_caliper,
      candidate.req_pic_note,candidate.req_sales_note,candidate.req_comments,candidate.av_note,null,
      null,null,null,candidate.snapshot->>'req_photo_mode',candidate.snapshot->>'request_note',
      candidate.request_created_by_username,candidate.request_created_by_display,
      candidate.request_created_by_email,candidate.request_selected_rep_username,
      candidate.request_selected_rep_display,candidate.request_selected_rep_email,
      candidate.app_tab_assignment,candidate.master_app_tab_assignment,'history_recovery',
      candidate.client_batch_id,greatest(coalesce(candidate.row_version,1),1),candidate.customeridentityid,
      candidate.customername,candidate.consigneeidentityid,candidate.consigneename
    ) on conflict(unique_id) do nothing;
    get diagnostics affected=row_count;
    if affected>0 then
      perform private.upsert_request_history(candidate.unique_id,'pending_recovered','not_queued',true);
      inserted_count:=inserted_count+1;
      history_count:=history_count+1;
    end if;
  end loop;

  for candidate in
    with payload_rows as (
      select distinct on(ids.request_id)
        ids.request_id,payload.request_data,outbox.created_at,outbox.event_id
      from public.ph_request_delivery_outbox outbox
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(outbox.payload->'requests')='array' then outbox.payload->'requests' else '[]'::jsonb end
      ) payload(request_data)
      cross join lateral (values(nullif(btrim(coalesce(
        payload.request_data->>'unique_id',payload.request_data->>'request_id',payload.request_data->>'request_unique_id',''
      )),''))) ids(request_id)
      where outbox.event_type='request_created' and ids.request_id is not null
      order by ids.request_id,outbox.created_at desc,outbox.event_id desc
    )
    select * from payload_rows source
    where not exists(select 1 from public.ph_active_request active where active.unique_id=source.request_id)
      and not exists(select 1 from public.ph_request_history history where history.unique_id=source.request_id)
      and private.request_completion_proof_v1(
        source.request_id,source.request_data->>'master_id',source.request_data->>'itemcode',source.request_data->>'locationcode'
      ) is null
    order by source.created_at,source.request_id
  loop
    request_data:=candidate.request_data;
    request_id:=candidate.request_id;
    insert into public.ph_active_request(
      unique_id,master_id,commonname,contsize,locationcode,lotcode,itemcode,ptravailable,
      season_supply,priority,qualitycode,field_tag_color,plantgroupcode,requested_by,
      request_folder,req_customer,req_qty,desired_spec,desired_caliper,est_ship,req_reserve,
      req_photo_link,req_photo_name,req_archived,req_status,req_rep_action,created_at,
      req_match,req_spec,req_caliper,req_pic_note,req_sales_note,req_comments,av_note,date_completed,
      completed_by_username,completed_by_display,completed_by_email,req_photo_mode,request_note,
      request_created_by_username,request_created_by_display,request_created_by_email,
      request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,
      app_tab_assignment,master_app_tab_assignment,request_source,row_version,
      customeridentityid,customername,consigneeidentityid,consigneename
    ) values(
      request_id,request_data->>'master_id',request_data->>'commonname',request_data->>'contsize',
      request_data->>'locationcode',request_data->>'lotcode',request_data->>'itemcode',request_data->>'ptravailable',
      request_data->>'season_supply',request_data->>'priority',request_data->>'qualitycode',
      request_data->>'field_tag_color',request_data->>'plantgroupcode',request_data->>'requested_by',
      request_data->>'request_folder',coalesce(request_data->>'req_customer',request_data->>'customername'),
      request_data->>'req_qty',request_data->>'desired_spec',request_data->>'desired_caliper',
      request_data->>'est_ship',coalesce(request_data->>'req_reserve','NO'),request_data->>'req_photo_link',
      request_data->>'req_photo_name',false,'Pending',request_data->>'req_rep_action',
      coalesce(private.try_timestamptz(request_data->>'created_at'),candidate.created_at,clock_timestamp()),
      private.historical_requests_number_v1(request_data->>'req_match'),request_data->>'req_spec',
      request_data->>'req_caliper',request_data->>'req_pic_note',request_data->>'req_sales_note',
      request_data->>'req_comments',request_data->>'av_note',null,null,null,null,
      request_data->>'req_photo_mode',request_data->>'request_note',
      request_data->>'request_created_by_username',request_data->>'request_created_by_display',
      request_data->>'request_created_by_email',request_data->>'request_selected_rep_username',
      request_data->>'request_selected_rep_display',request_data->>'request_selected_rep_email',
      request_data->>'app_tab_assignment',request_data->>'master_app_tab_assignment','outbox_recovery',1,
      request_data->>'customeridentityid',request_data->>'customername',
      request_data->>'consigneeidentityid',request_data->>'consigneename'
    ) on conflict(unique_id) do nothing;
    get diagnostics affected=row_count;
    if affected>0 then
      perform private.upsert_request_history(request_id,'pending_recovered','not_queued',true);
      inserted_count:=inserted_count+1;
      outbox_count:=outbox_count+1;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'busy',false,'recovered',inserted_count,
    'history',history_count,'outbox',outbox_count);
end
$function$;
revoke all on function private.recover_unfulfilled_requests_v1() from public,anon,authenticated,service_role;

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
  proof text;
  completion_at timestamptz;
  completed_count integer:=0;
  pending_count integer:=0;
  snapshot_count integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-lifecycle-state-machine-v2360',0)) then
    return jsonb_build_object('ok',true,'busy',true,'completed',0,'pending',0,'historySnapshotted',0);
  end if;
  for candidate in
    select active.* from public.ph_active_request active
    where active.move_batch_id is null
    order by active.created_at,active.unique_id
    for update skip locked
  loop
    proof:=private.request_completion_proof_v1(
      candidate.unique_id,candidate.master_id,candidate.itemcode,candidate.locationcode
    );
    if proof is not null then
      select master.* into master_row from public.ph_master_inventory master
      where master.unique_id=candidate.master_id
         or (upper(btrim(coalesce(master.itemcode,'')))=upper(btrim(coalesce(candidate.itemcode,'')))
           and upper(btrim(coalesce(master.locationcode,'')))=upper(btrim(coalesce(candidate.locationcode,''))))
      order by private.request_master_has_valid_evidence_v1(master,clock_timestamp()) desc,
        (master.unique_id=candidate.master_id) desc,
        coalesce(master.av_rule_photo_updated_at,master.date_completed,master.av_rule_bundle_updated_at) desc nulls last,
        master.unique_id limit 1 for update;
      select coalesce(
        (select outbox.created_at from public.ph_request_delivery_outbox outbox
          where outbox.event_type='request_completed'
            and (outbox.request_id=candidate.unique_id or outbox.payload->>'request_id'=candidate.unique_id
              or (jsonb_typeof(outbox.payload->'request_ids')='array' and outbox.payload->'request_ids' ? candidate.unique_id))
          order by outbox.created_at desc limit 1),
        (select history.date_completed from public.ph_request_history history where history.unique_id=candidate.unique_id),
        (select removal.created_at from private.ph_request_queue_removal_commands removal
          where removal.request_uid=candidate.unique_id order by removal.created_at desc limit 1),
        clock_timestamp()
      ) into completion_at;
      update public.ph_active_request active set
        master_id=coalesce(master_row.unique_id,active.master_id),req_status='Complete',req_archived=false,
        date_completed=completion_at::text,
        req_photo_link=case when proof='current_master_evidence' then master_row.photo_link else active.req_photo_link end,
        req_photo_name=case when proof='current_master_evidence' then master_row.photo_name else active.req_photo_name end,
        req_match=case when proof='current_master_evidence' then private.historical_requests_number_v1(master_row.match) else active.req_match end,
        req_spec=case when proof='current_master_evidence' then master_row.spec else active.req_spec end,
        req_caliper=case when proof='current_master_evidence' then master_row.caliper else active.req_caliper end,
        req_pic_note=case when proof='current_master_evidence' then master_row.pic_note else active.req_pic_note end,
        req_sales_note=case when proof='current_master_evidence' then master_row.sales_note else active.req_sales_note end,
        req_comments=case when proof='current_master_evidence' then coalesce(nullif(active.req_comments,''),master_row.sales_note) else active.req_comments end,
        av_note=case when proof='current_master_evidence' then master_row.av_note else active.av_note end,
        row_version=active.row_version+1
      where active.unique_id=candidate.unique_id;
      perform private.persist_completed_request_history_v1(candidate.unique_id,proof,'not_queued',true);
      if proof='current_master_evidence' then
        insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status)
        values('request-completed:auto-evidence:'||candidate.unique_id,'request_completed',candidate.unique_id,candidate.request_folder,
          jsonb_build_object('request_id',candidate.unique_id,'request_ids',jsonb_build_array(candidate.unique_id),
            'reason','valid_master_evidence'),'pending')
        on conflict(event_key) do nothing;
      end if;
      delete from public.ph_active_request where unique_id=candidate.unique_id;
      completed_count:=completed_count+1;
    else
      update public.ph_active_request active set req_status='Pending',req_archived=false,date_completed=null
      where active.unique_id=candidate.unique_id
        and (active.req_status is distinct from 'Pending' or coalesce(active.req_archived,false)
          or nullif(btrim(coalesce(active.date_completed,'')),'') is not null);
      perform private.upsert_request_history(candidate.unique_id,'pending_snapshot','not_queued',true);
      pending_count:=pending_count+1;
      snapshot_count:=snapshot_count+1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'busy',false,'completed',completed_count,
    'pending',pending_count,'historySnapshotted',snapshot_count);
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
  recovery_result jsonb;
  lifecycle_result jsonb;
begin
  recovery_result:=private.recover_unfulfilled_requests_v1();
  if coalesce((recovery_result->>'busy')::boolean,false) then return recovery_result; end if;
  lifecycle_result:=private.enforce_request_lifecycle_v1();
  return jsonb_build_object(
    'ok',coalesce((recovery_result->>'ok')::boolean,false)
      and coalesce((lifecycle_result->>'ok')::boolean,false),
    'busy',coalesce((lifecycle_result->>'busy')::boolean,false),
    'recovered',coalesce((recovery_result->>'recovered')::integer,0),
    'completed',coalesce((lifecycle_result->>'completed')::integer,0),
    'pending',coalesce((lifecycle_result->>'pending')::integer,0),
    'scope','all-history-four-proof','recovery',recovery_result,'lifecycle',lifecycle_result
  );
end
$function$;
revoke all on function public.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
grant execute on function public.reconcile_active_requests_from_outbox_v1() to service_role;

do $reconcile$
declare result jsonb;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  result:=public.reconcile_active_requests_from_outbox_v1();
  if not coalesce((result->>'ok')::boolean,false) or coalesce((result->>'busy')::boolean,false) then
    raise exception 'REQUEST_LIFECYCLE_RECONCILIATION_INCOMPLETE: %',result;
  end if;
end
$reconcile$;

create table public.ph_request_sales_impact_ledger(
  line_identity_key text primary key,
  unique_id text not null,
  request_identity text not null,
  folder_id text,
  source_row_id text not null,
  source_table text not null,
  source_tables text[] not null default '{}'::text[],
  row_index integer not null default 1,
  email_thread_id text,
  request_date timestamptz,
  status text not null check(status in ('Pending','Completed')),
  sales_rep text not null default 'Unassigned',
  customer_name text not null default 'Unknown Customer',
  consignee_name text not null default 'N/A',
  itemcode text,
  commonname text,
  contsize text,
  lotcode text,
  locationcode text,
  raw_qty numeric,
  effective_qty numeric not null,
  list_price numeric not null default 0,
  price_source text not null default 'unpriced',
  line_dollar_value numeric generated always as (round(effective_qty*list_price,2)) stored,
  source_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index ph_request_sales_impact_ledger_unique_id_idx
  on public.ph_request_sales_impact_ledger(unique_id);
create index ph_request_sales_impact_ledger_request_date_idx
  on public.ph_request_sales_impact_ledger(request_date desc,line_identity_key);
alter table public.ph_request_sales_impact_ledger enable row level security;
revoke all on public.ph_request_sales_impact_ledger from public,anon,authenticated;
grant select on public.ph_request_sales_impact_ledger to service_role;

create or replace function private.block_request_sales_impact_ledger_delete_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if tg_op='TRUNCATE' then
    raise exception using errcode='42501',message='REQUEST_SALES_LEDGER_TRUNCATE_FORBIDDEN';
  end if;
  return null;
end
$function$;
revoke all on function private.block_request_sales_impact_ledger_delete_v1()
  from public,anon,authenticated,service_role;

create trigger ph_request_sales_impact_ledger_block_delete
before delete on public.ph_request_sales_impact_ledger
for each row execute function private.block_request_sales_impact_ledger_delete_v1();
create trigger ph_request_sales_impact_ledger_block_truncate
before truncate on public.ph_request_sales_impact_ledger
for each statement execute function private.block_request_sales_impact_ledger_delete_v1();

create or replace function private.request_sales_price_v2360(
  p_itemcode text,p_commonname text,p_contsize text,p_explicit text default null
)
returns table(list_price numeric,price_source text)
language plpgsql
stable
security definer
set search_path=''
as $function$
declare explicit_price numeric:=private.request_sales_numeric_v1(p_explicit);
begin
  if explicit_price>0 then
    return query select round(explicit_price,2),'request_row'::text;
    return;
  end if;
  return query
  with catalog as (
    select 1 source_priority,'ph_master_inventory'::text source_name,itemcode,commonname,contsize,listprice::text price
    from public.ph_master_inventory
    union all
    select 2,'ph_view_av_hot_price',itemcode,commonname,contsize,listprice::text
    from public.ph_view_av_hot_price
    union all
    select 3,'ph_cav_import',itemcode,commonname,contsize,coalesce(nullif(unitprice,''),unit_price)::text
    from public.ph_cav_import
  ), normalized as (
    select source_priority,source_name,
      upper(btrim(coalesce(itemcode,''))) item_key,
      upper(btrim(coalesce(commonname,''))) common_key,
      upper(btrim(coalesce(contsize,''))) size_key,
      private.request_sales_numeric_v1(price) price
    from catalog
  ), matched as (
    select *,case
      when nullif(btrim(coalesce(p_itemcode,'')),'') is not null
        and item_key=upper(btrim(p_itemcode)) then 1
      when nullif(btrim(coalesce(p_commonname,'')),'') is not null
        and nullif(btrim(coalesce(p_contsize,'')),'') is not null
        and common_key=upper(btrim(p_commonname)) and size_key=upper(btrim(p_contsize)) then 2
      when nullif(btrim(coalesce(p_contsize,'')),'') is not null
        and size_key=upper(btrim(p_contsize)) then 3
      else 9 end match_priority
    from normalized where price>0
  )
  select round(price,2),case match_priority when 1 then 'itemcode:'||source_name
    when 2 then 'commonname_contsize:'||source_name else 'contsize:'||source_name end
  from matched where match_priority<9
  order by match_priority,source_priority,price desc limit 1;
  if not found then return query select 0::numeric,'unpriced'::text; end if;
end
$function$;
revoke all on function private.request_sales_price_v2360(text,text,text,text)
  from public,anon,authenticated,service_role;

create or replace function private.refresh_request_sales_impact_line_v1(p_request_id text)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare
  row_data jsonb;
  source_name text;
  source_names text[];
  quantity numeric;
  effective_quantity numeric;
  price record;
  request_status text;
  request_time timestamptz;
begin
  select source.row_data,source.source_name into row_data,source_name
  from (
    select to_jsonb(active) row_data,'ph_active_request'::text source_name,1 priority
    from public.ph_active_request active where active.unique_id=p_request_id and active.move_batch_id is null
    union all
    select coalesce(history.snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(history)),
      'ph_request_history',2
    from public.ph_request_history history where history.unique_id=p_request_id
  ) source order by source.priority limit 1;
  if row_data is null then return false; end if;

  source_names:=array_remove(array[
    case when exists(select 1 from public.ph_active_request where unique_id=p_request_id and move_batch_id is null) then 'ph_active_request' end,
    case when exists(select 1 from public.ph_request_history where unique_id=p_request_id) then 'ph_request_history' end,
    case when exists(select 1 from public.ph_request_delivery_outbox outbox
      where outbox.request_id=p_request_id or outbox.payload->>'request_id'=p_request_id
        or (jsonb_typeof(outbox.payload->'request_ids')='array' and outbox.payload->'request_ids' ? p_request_id))
      then 'ph_request_delivery_outbox' end
  ],null);
  quantity:=private.request_sales_numeric_v1(coalesce(
    row_data->>'raw_qty',row_data->>'req_qty',row_data->>'qty',row_data->>'quantity'
  ));
  effective_quantity:=case when quantity>0 then quantity else 25 end;
  select * into price from private.request_sales_price_v2360(
    row_data->>'itemcode',row_data->>'commonname',row_data->>'contsize',
    coalesce(row_data->>'listprice',row_data->>'list_price',row_data->>'unit_list_price')
  );
  request_status:=case
    when exists(select 1 from public.ph_active_request active where active.unique_id=p_request_id and active.move_batch_id is null) then 'Pending'
    when private.request_completion_proof_v1(p_request_id,row_data->>'master_id',row_data->>'itemcode',row_data->>'locationcode') is not null then 'Completed'
    else 'Pending' end;
  request_time:=coalesce(private.try_timestamptz(row_data->>'created_at'),private.try_timestamptz(row_data->>'request_date'));

  insert into public.ph_request_sales_impact_ledger(
    line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,
    row_index,email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,
    itemcode,commonname,contsize,lotcode,locationcode,raw_qty,effective_qty,list_price,
    price_source,source_payload,updated_at
  ) values(
    'uid:'||lower(btrim(p_request_id)),p_request_id,
    coalesce(nullif(btrim(row_data->>'request_folder'),''),p_request_id),row_data->>'request_folder',
    source_name||':'||p_request_id,source_name,source_names,1,row_data->>'email_thread_id',request_time,
    request_status,coalesce(nullif(btrim(coalesce(row_data->>'request_selected_rep_display',
      row_data->>'request_selected_rep_username',row_data->>'requested_by')),''),'Unassigned'),
    coalesce(nullif(btrim(coalesce(row_data->>'customername',row_data->>'req_customer',
      row_data->>'request_customer')),''),'Unknown Customer'),
    coalesce(nullif(btrim(row_data->>'consigneename'),''),'N/A'),row_data->>'itemcode',
    private.normalize_escaped_display_text_v1(row_data->>'commonname'),row_data->>'contsize',
    row_data->>'lotcode',row_data->>'locationcode',case when quantity>0 then quantity end,
    effective_quantity,coalesce(price.list_price,0),coalesce(price.price_source,'unpriced'),row_data,clock_timestamp()
  ) on conflict(line_identity_key) do update set
    unique_id=excluded.unique_id,request_identity=excluded.request_identity,folder_id=excluded.folder_id,
    source_row_id=excluded.source_row_id,source_table=excluded.source_table,source_tables=excluded.source_tables,
    email_thread_id=excluded.email_thread_id,request_date=excluded.request_date,status=excluded.status,
    sales_rep=excluded.sales_rep,customer_name=excluded.customer_name,consignee_name=excluded.consignee_name,
    itemcode=excluded.itemcode,commonname=excluded.commonname,contsize=excluded.contsize,
    lotcode=excluded.lotcode,locationcode=excluded.locationcode,raw_qty=excluded.raw_qty,
    effective_qty=excluded.effective_qty,list_price=excluded.list_price,price_source=excluded.price_source,
    source_payload=excluded.source_payload,updated_at=excluded.updated_at;
  return true;
end
$function$;
revoke all on function private.refresh_request_sales_impact_line_v1(text)
  from public,anon,authenticated,service_role;

create or replace function private.upsert_request_sales_impact_outbox_line_v1(
  p_data jsonb,p_source_row_id text,p_request_date timestamptz
)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare
  request_id text:=nullif(btrim(coalesce(
    p_data->>'unique_id',p_data->>'request_id',p_data->>'request_unique_id',''
  )), '');
  quantity numeric;
  effective_quantity numeric;
  price record;
begin
  if request_id is null then return false; end if;
  if exists(select 1 from public.ph_active_request where unique_id=request_id and move_batch_id is null)
    or exists(select 1 from public.ph_request_history where unique_id=request_id) then
    return private.refresh_request_sales_impact_line_v1(request_id);
  end if;
  quantity:=private.request_sales_numeric_v1(coalesce(p_data->>'raw_qty',p_data->>'req_qty',p_data->>'qty'));
  effective_quantity:=case when quantity>0 then quantity else 25 end;
  select * into price from private.request_sales_price_v2360(
    p_data->>'itemcode',p_data->>'commonname',p_data->>'contsize',
    coalesce(p_data->>'listprice',p_data->>'list_price',p_data->>'unit_list_price')
  );
  insert into public.ph_request_sales_impact_ledger(
    line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,
    row_index,email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,
    itemcode,commonname,contsize,lotcode,locationcode,raw_qty,effective_qty,list_price,
    price_source,source_payload,updated_at
  ) values(
    'uid:'||lower(request_id),request_id,coalesce(nullif(btrim(p_data->>'request_folder'),''),request_id),
    p_data->>'request_folder',p_source_row_id,'ph_request_delivery_outbox',array['ph_request_delivery_outbox'],
    1,p_data->>'email_thread_id',coalesce(private.try_timestamptz(p_data->>'created_at'),p_request_date),
    case when private.request_completion_proof_v1(request_id,p_data->>'master_id',p_data->>'itemcode',p_data->>'locationcode') is null
      then 'Pending' else 'Completed' end,
    coalesce(nullif(btrim(coalesce(p_data->>'request_selected_rep_display',p_data->>'request_selected_rep_username',
      p_data->>'requested_by')),''),'Unassigned'),
    coalesce(nullif(btrim(coalesce(p_data->>'customername',p_data->>'req_customer',p_data->>'request_customer')),''),'Unknown Customer'),
    coalesce(nullif(btrim(p_data->>'consigneename'),''),'N/A'),p_data->>'itemcode',
    private.normalize_escaped_display_text_v1(p_data->>'commonname'),p_data->>'contsize',p_data->>'lotcode',
    p_data->>'locationcode',case when quantity>0 then quantity end,effective_quantity,
    coalesce(price.list_price,0),coalesce(price.price_source,'unpriced'),p_data,clock_timestamp()
  ) on conflict(line_identity_key) do update set
    request_identity=excluded.request_identity,folder_id=excluded.folder_id,source_payload=excluded.source_payload,
    status=excluded.status,raw_qty=excluded.raw_qty,effective_qty=excluded.effective_qty,
    list_price=excluded.list_price,price_source=excluded.price_source,updated_at=excluded.updated_at;
  return true;
end
$function$;
revoke all on function private.upsert_request_sales_impact_outbox_line_v1(jsonb,text,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function private.request_sales_impact_source_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if (tg_op='DELETE' and old.move_batch_id is not null)
    or (tg_op<>'DELETE' and new.move_batch_id is not null) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  perform private.refresh_request_sales_impact_line_v1(
    case when tg_op='DELETE' then old.unique_id else new.unique_id end
  );
  return case when tg_op='DELETE' then old else new end;
end
$function$;
revoke all on function private.request_sales_impact_source_trigger_v1()
  from public,anon,authenticated,service_role;

create or replace function private.request_sales_impact_outbox_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare entry record;
declare request_id text;
begin
  if new.event_type='request_created' and jsonb_typeof(new.payload->'requests')='array' then
    for entry in select value,ordinality from jsonb_array_elements(new.payload->'requests') with ordinality
    loop
      perform private.upsert_request_sales_impact_outbox_line_v1(
        entry.value,'ph_request_delivery_outbox:'||new.event_id::text||':'||entry.ordinality::text,new.created_at
      );
    end loop;
  elsif new.event_type='request_completed' then
    for request_id in
      select distinct id from unnest(array_remove(array[
        nullif(btrim(coalesce(new.request_id,'')),''),nullif(btrim(coalesce(new.payload->>'request_id','')),'')
      ],null)) id
      union
      select value from jsonb_array_elements_text(
        case when jsonb_typeof(new.payload->'request_ids')='array' then new.payload->'request_ids' else '[]'::jsonb end
      )
    loop
      perform private.refresh_request_sales_impact_line_v1(request_id);
      update public.ph_request_sales_impact_ledger set status='Completed',updated_at=clock_timestamp()
      where unique_id=request_id;
    end loop;
  end if;
  return new;
end
$function$;
revoke all on function private.request_sales_impact_outbox_trigger_v1()
  from public,anon,authenticated,service_role;

create or replace function private.request_sales_impact_removal_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  perform private.refresh_request_sales_impact_line_v1(new.request_uid);
  update public.ph_request_sales_impact_ledger set status='Completed',updated_at=clock_timestamp()
  where unique_id=new.request_uid;
  return new;
end
$function$;
revoke all on function private.request_sales_impact_removal_trigger_v1()
  from public,anon,authenticated,service_role;

do $seed$
declare entry record;
begin
  with source_candidates as materialized (
    select active.unique_id,to_jsonb(active) row_data,'ph_active_request'::text source_name,
      1 priority,false history_evidence
    from public.ph_active_request active where active.move_batch_id is null
    union all
    select history.unique_id,
      coalesce(history.snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(history)),
      'ph_request_history',2,private.request_history_has_valid_evidence_v1(history)
    from public.ph_request_history history
  ), source_presence as materialized (
    select unique_id,bool_or(source_name='ph_active_request') has_active,
      bool_or(source_name='ph_request_history') has_history
    from source_candidates group by unique_id
  ), source_rows as materialized (
    select distinct on(unique_id) unique_id,row_data,source_name,history_evidence
    from source_candidates order by unique_id,priority
  ), normalized as materialized (
    select source.*,private.request_sales_numeric_v1(coalesce(
        source.row_data->>'raw_qty',source.row_data->>'req_qty',source.row_data->>'qty',source.row_data->>'quantity'
      )) quantity,
      coalesce(source.row_data->>'listprice',source.row_data->>'list_price',source.row_data->>'unit_list_price') explicit_price
    from source_rows source
  ), price_catalog as materialized (
    select 1 source_priority,'ph_master_inventory'::text source_name,
      upper(btrim(coalesce(itemcode,''))) item_key,upper(btrim(coalesce(commonname,''))) common_key,
      upper(btrim(coalesce(contsize,''))) size_key,private.request_sales_numeric_v1(listprice::text) price
    from public.ph_master_inventory
    union all
    select 2,'ph_view_av_hot_price',upper(btrim(coalesce(itemcode,''))),
      upper(btrim(coalesce(commonname,''))),upper(btrim(coalesce(contsize,''))),
      private.request_sales_numeric_v1(listprice::text)
    from public.ph_view_av_hot_price
    union all
    select 3,'ph_cav_import',upper(btrim(coalesce(itemcode,''))),
      upper(btrim(coalesce(commonname,''))),upper(btrim(coalesce(contsize,''))),
      private.request_sales_numeric_v1(coalesce(nullif(unitprice,''),unit_price)::text)
    from public.ph_cav_import
  ), price_keys as materialized (
    select distinct row_data->>'itemcode' itemcode,row_data->>'commonname' commonname,
      row_data->>'contsize' contsize,explicit_price,
      upper(btrim(coalesce(row_data->>'itemcode',''))) item_key,
      upper(btrim(coalesce(row_data->>'commonname',''))) common_key,
      upper(btrim(coalesce(row_data->>'contsize',''))) size_key,
      private.request_sales_numeric_v1(explicit_price) explicit_numeric
    from normalized
  ), priced_keys as materialized (
    select key.itemcode,key.commonname,key.contsize,key.explicit_price,
      case when key.explicit_numeric>0 then round(key.explicit_numeric,2)
        else coalesce(best.list_price,0) end list_price,
      case when key.explicit_numeric>0 then 'request_row'::text
        else coalesce(best.price_source,'unpriced') end price_source
    from price_keys key
    left join lateral (
      select round(catalog.price,2) list_price,
        case when catalog.item_key=key.item_key and key.item_key<>'' then 'itemcode:'||catalog.source_name
          when catalog.common_key=key.common_key and catalog.size_key=key.size_key
            and key.common_key<>'' and key.size_key<>'' then 'commonname_contsize:'||catalog.source_name
          else 'contsize:'||catalog.source_name end price_source
      from price_catalog catalog
      where not coalesce(key.explicit_numeric>0,false) and catalog.price>0
        and ((key.item_key<>'' and catalog.item_key=key.item_key)
          or (key.common_key<>'' and key.size_key<>''
            and catalog.common_key=key.common_key and catalog.size_key=key.size_key)
          or (key.size_key<>'' and catalog.size_key=key.size_key))
      order by case when catalog.item_key=key.item_key and key.item_key<>'' then 1
          when catalog.common_key=key.common_key and catalog.size_key=key.size_key
            and key.common_key<>'' and key.size_key<>'' then 2 else 3 end,
        catalog.source_priority,catalog.price desc
      limit 1
    ) best on true
  ), outbox_ids as materialized (
    select nullif(btrim(outbox.request_id),'') request_id from public.ph_request_delivery_outbox outbox
    where nullif(btrim(coalesce(outbox.request_id,'')),'') is not null
    union
    select nullif(btrim(outbox.payload->>'request_id'),'') from public.ph_request_delivery_outbox outbox
    where nullif(btrim(coalesce(outbox.payload->>'request_id','')),'') is not null
    union
    select nullif(btrim(ids.value),'')
    from public.ph_request_delivery_outbox outbox
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(outbox.payload->'request_ids')='array'
        then outbox.payload->'request_ids' else '[]'::jsonb end
    ) ids(value)
    where nullif(btrim(ids.value),'') is not null
  )
  insert into public.ph_request_sales_impact_ledger(
    line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,
    row_index,email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,
    itemcode,commonname,contsize,lotcode,locationcode,raw_qty,effective_qty,list_price,
    price_source,source_payload,updated_at
  )
  select 'uid:'||lower(btrim(source.unique_id)),source.unique_id,
    coalesce(nullif(btrim(source.row_data->>'request_folder'),''),source.unique_id),
    source.row_data->>'request_folder',source.source_name||':'||source.unique_id,source.source_name,
    array_remove(array[
      case when presence.has_active then 'ph_active_request' end,
      case when presence.has_history then 'ph_request_history' end,
      case when outbox.request_id is not null then 'ph_request_delivery_outbox' end
    ],null),1,source.row_data->>'email_thread_id',
    coalesce(private.try_timestamptz(source.row_data->>'created_at'),
      private.try_timestamptz(source.row_data->>'request_date')),
    case when presence.has_active then 'Pending'
      when source.history_evidence then 'Completed'
      when private.request_completion_proof_v1(
        source.unique_id,source.row_data->>'master_id',source.row_data->>'itemcode',source.row_data->>'locationcode'
      ) is not null then 'Completed' else 'Pending' end,
    coalesce(nullif(btrim(coalesce(source.row_data->>'request_selected_rep_display',
      source.row_data->>'request_selected_rep_username',source.row_data->>'requested_by')),''),'Unassigned'),
    coalesce(nullif(btrim(coalesce(source.row_data->>'customername',source.row_data->>'req_customer',
      source.row_data->>'request_customer')),''),'Unknown Customer'),
    coalesce(nullif(btrim(source.row_data->>'consigneename'),''),'N/A'),source.row_data->>'itemcode',
    private.normalize_escaped_display_text_v1(source.row_data->>'commonname'),source.row_data->>'contsize',
    source.row_data->>'lotcode',source.row_data->>'locationcode',case when source.quantity>0 then source.quantity end,
    case when source.quantity>0 then source.quantity else 25 end,coalesce(price.list_price,0),
    coalesce(price.price_source,'unpriced'),source.row_data,clock_timestamp()
  from normalized source
  join source_presence presence on presence.unique_id=source.unique_id
  join priced_keys price on price.itemcode is not distinct from source.row_data->>'itemcode'
    and price.commonname is not distinct from source.row_data->>'commonname'
    and price.contsize is not distinct from source.row_data->>'contsize'
    and price.explicit_price is not distinct from source.explicit_price
  left join outbox_ids outbox on outbox.request_id=source.unique_id;
  for entry in
    select outbox.event_id,outbox.created_at,payload.value,payload.ordinality
    from public.ph_request_delivery_outbox outbox
    cross join lateral jsonb_array_elements(
      case when outbox.event_type='request_created' and jsonb_typeof(outbox.payload->'requests')='array'
        then outbox.payload->'requests' else '[]'::jsonb end
    ) with ordinality payload(value,ordinality)
    cross join lateral (values(nullif(btrim(coalesce(
      payload.value->>'unique_id',payload.value->>'request_id',payload.value->>'request_unique_id',''
    )),''))) ids(request_id)
    where ids.request_id is not null
      and not exists(select 1 from public.ph_active_request active where active.unique_id=ids.request_id)
      and not exists(select 1 from public.ph_request_history history where history.unique_id=ids.request_id)
  loop
    perform private.upsert_request_sales_impact_outbox_line_v1(
      entry.value,'ph_request_delivery_outbox:'||entry.event_id::text||':'||entry.ordinality::text,entry.created_at
    );
  end loop;
end
$seed$;

create trigger ph_active_request_sales_impact_ledger_v1
after insert or update or delete on public.ph_active_request
for each row execute function private.request_sales_impact_source_trigger_v1();
create trigger ph_request_history_sales_impact_ledger_v1
after insert or update on public.ph_request_history
for each row execute function private.request_sales_impact_source_trigger_v1();
create trigger ph_request_delivery_outbox_sales_impact_ledger_v1
after insert on public.ph_request_delivery_outbox
for each row execute function private.request_sales_impact_outbox_trigger_v1();
create trigger ph_request_queue_removal_sales_impact_ledger_v1
after insert on private.ph_request_queue_removal_commands
for each row execute function private.request_sales_impact_removal_trigger_v1();

create or replace view public.ph_request_sales_impact_lines_v1
with (security_invoker=true) as
select * from public.ph_request_sales_impact_ledger;

create or replace view public.ph_request_sales_impact_by_sales_rep_v1
with (security_invoker=true) as
select sales_rep,count(*)::integer line_count,count(distinct request_identity)::integer request_count,
  round(sum(line_dollar_value),2) total_dollar_value
from public.ph_request_sales_impact_ledger group by sales_rep;

create or replace view public.ph_request_sales_impact_by_customer_consignee_v1
with (security_invoker=true) as
select customer_name,consignee_name,count(*)::integer line_count,
  count(distinct request_identity)::integer request_count,round(sum(line_dollar_value),2) total_dollar_value
from public.ph_request_sales_impact_ledger group by customer_name,consignee_name;

revoke all on public.ph_request_sales_impact_lines_v1,
  public.ph_request_sales_impact_by_sales_rep_v1,
  public.ph_request_sales_impact_by_customer_consignee_v1 from public,anon,authenticated;
grant select on public.ph_request_sales_impact_lines_v1,
  public.ph_request_sales_impact_by_sales_rep_v1,
  public.ph_request_sales_impact_by_customer_consignee_v1 to service_role;

create or replace function public.get_request_sales_impact_v2()
returns jsonb
language sql
stable
security definer
set search_path=''
set statement_timeout='10s'
as $function$
  with lines as (
    select * from public.ph_request_sales_impact_ledger
  ), summary as (
    select round(coalesce(sum(line_dollar_value),0),2) total_dollar_value,
      round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
      round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
      count(distinct request_identity)::integer total_requests,count(*)::integer total_line_items,
      count(*) filter(where status='Completed')::integer completed_line_items,
      count(*) filter(where status='Pending')::integer pending_line_items,
      count(*) filter(where raw_qty is null)::integer default_quantity_lines,
      count(*) filter(where list_price<=0)::integer unpriced_lines
    from lines
  )
  select jsonb_build_object(
    'dedupe_contract','zero_cross_request_dedupe_v1',
    'summary',(select to_jsonb(summary) from summary),
    'by_sales_rep',coalesce((select jsonb_agg(jsonb_build_object(
      'sales_rep',rollup.sales_rep,'line_count',rollup.line_count,'request_count',rollup.request_count,
      'total_dollar_value',rollup.total_dollar_value
    ) order by rollup.total_dollar_value desc,rollup.sales_rep) from public.ph_request_sales_impact_by_sales_rep_v1 rollup),'[]'::jsonb),
    'by_customer_consignee',coalesce((select jsonb_agg(jsonb_build_object(
      'customer_name',rollup.customer_name,'consignee_name',rollup.consignee_name,
      'customer_consignee_label',rollup.customer_name||' / '||rollup.consignee_name,
      'line_count',rollup.line_count,'request_count',rollup.request_count,
      'total_dollar_value',rollup.total_dollar_value
    ) order by rollup.total_dollar_value desc,rollup.customer_name,rollup.consignee_name)
      from public.ph_request_sales_impact_by_customer_consignee_v1 rollup),'[]'::jsonb),
    'line_items',coalesce((select jsonb_agg(jsonb_build_object(
      'line_identity_key',line_identity_key,'request_identity',request_identity,'unique_id',unique_id,
      'folder_id',folder_id,'source_row_id',source_row_id,'source_table',source_table,
      'source_tables',source_tables,'row_index',row_index,'email_thread_id',email_thread_id,
      'request_date',request_date,'status',status,'sales_rep',sales_rep,'customer_name',customer_name,
      'consignee_name',consignee_name,'customer_consignee_label',customer_name||' / '||consignee_name,
      'itemcode',itemcode,'commonname',commonname,'contsize',contsize,'lotcode',lotcode,
      'locationcode',locationcode,'raw_qty',raw_qty,'effective_qty',effective_qty,
      'is_default_qty',raw_qty is null,'list_price',list_price,'unit_list_price',list_price,
      'price_source',price_source,'line_dollar_value',line_dollar_value
    ) order by request_date desc nulls last,line_identity_key) from lines),'[]'::jsonb),
    'source_table_audit',jsonb_build_object(
      'dedupe_contract','zero_cross_request_dedupe_v1','ledger_table','ph_request_sales_impact_ledger',
      'line_count',(select count(*) from lines),'distinct_unique_ids',(select count(distinct unique_id) from lines),
      'lifecycle_unique_ids',(select count(distinct unique_id) from (
        select unique_id from public.ph_request_history union select unique_id from public.ph_active_request
      ) lifecycle),'requested_minimum_dollars',10000000,
      'requested_minimum_met',(select total_dollar_value>=10000000 from summary),
      'formula','(raw_qty > 0 ? raw_qty : 25) * list_price'
    )
  )
$function$;
revoke all on function public.get_request_sales_impact_v2() from public,anon,authenticated;
grant execute on function public.get_request_sales_impact_v2() to service_role;

insert into private.navigation_view_catalog(view_key,label,parent_key,protected_reason,selectable)
values('request-sales-impact','Request Sales Impact ($)','sales',
  'Hidden by default; Managers may explicitly grant or hide this reporting view.',true)
on conflict(view_key) do update set label=excluded.label,parent_key=excluded.parent_key,
  protected_reason=excluded.protected_reason,selectable=excluded.selectable;

create or replace function private.navigation_module_allowed_v1(p_actor_id uuid,p_view text)
returns boolean
language plpgsql
stable
set search_path=''
as $function$
declare p public.profiles; override_value boolean;
begin
  select * into p from public.profiles where id=p_actor_id;
  if p.id is null or p.disabled_at is not null or coalesce(p.must_change_password,false)
    or (p.locked_until is not null and p.locked_until>now()) then return false; end if;
  if not exists(select 1 from private.navigation_view_catalog where view_key=p_view) then return false; end if;
  if p_view in ('bunch-note','hl-order','disease-pest','pest-management') and lower(btrim(p.username))<>'dylan_collyge' then return false; end if;
  if p_view='managers' and lower(btrim(p.username))='brandt_emerson' then return false; end if;
  if p_view='access-control' then return private.navigation_is_manager_v1(p_actor_id); end if;
  if p_view='home' then return true; end if;
  if p_view='request-sales-impact' then
    select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
    if found then return override_value; end if;
    return lower(btrim(p.username))='dylan_collyge';
  end if;
  if p_view='historical-requests' then
    select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
    if found and not override_value then return false; end if;
    return p.username='dylan_collyge'
      or upper(regexp_replace(coalesce(p.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) in ('REP','SALESREP','ADMIN','ADMINISTRATOR');
  end if;
  select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
  if found then return override_value; end if;
  if p_view='reports' then return private.navigation_is_manager_v1(p_actor_id)
    or exists(select 1 from private.navigation_reports_legacy where profile_id=p.id); end if;
  if p_view like 'production:%' then return private.navigation_module_allowed_v1(p.id,'production-workflow'); end if;
  if p_view in ('request-history','sales-credit','credit-request') then
    return private.navigation_module_allowed_v1(p.id,'sales')
      or lower(btrim(p.username)) in ('dylan_collyge','jd_jones','megan_kelly');
  end if;
  if p_view='request' then return true; end if;
  return private.navigation_legacy_allowed_v1(p.id,p_view);
end
$function$;

create table public."00_app_view_table_map"(
  view_key text primary key,
  view_label text not null,
  parent_key text,
  source_tables text[] not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public."00_app_view_table_map" enable row level security;
revoke all on public."00_app_view_table_map" from public,anon,authenticated;
grant select on public."00_app_view_table_map" to service_role;

insert into public."00_app_view_table_map"(view_key,view_label,parent_key,source_tables)
select catalog.view_key,catalog.label,catalog.parent_key,
  case catalog.view_key
    when 'drive' then array['public.ph_master_inventory','public.ph_active_request_live_rows']
    when 'av' then array['public.ph_master_inventory','app_sync_private.inventory_location_evidence_v1']
    when 'request' then array['public.ph_active_request_live_rows','public.ph_request_queue_live_rows','public.ph_request_history']
    when 'request-sales-impact' then array['public.ph_request_sales_impact_ledger','public.ph_request_sales_impact_lines_v1']
    when 'historical-requests' then array['public.ph_request_history','public.ph_master_inventory']
    when 'request-history' then array['public.ph_request_history']
    when 'reserves' then array['public.ph_reserves']
    when 'docks' then array['public.ph_soc_master']
    when 'sales-office' then array['public.ph_soc_master','public.ph_reserves']
    when 'production' then array['public.ph_master_inventory','public.ph_active_request']
    when 'production-workflow' then array['public.ph_master_inventory','public.ph_active_request']
    when 'managers' then array['public.profiles','public.app_runtime_watchdog_events']
    when 'access-control' then array['public.profiles','private.navigation_view_overrides']
    when 'communication' then array['public.ph_chat_messages']
    when 'chat' then array['public.ph_chat_messages']
    else array['public.app_dataset_revisions']
  end
from private.navigation_view_catalog catalog
on conflict(view_key) do update set view_label=excluded.view_label,parent_key=excluded.parent_key,
  source_tables=excluded.source_tables,updated_at=clock_timestamp();

update public.ph_master_inventory set commonname=private.normalize_escaped_display_text_v1(commonname)
where commonname is not null and strpos(commonname,chr(92))>0;
update public.ph_active_request set commonname=private.normalize_escaped_display_text_v1(commonname)
where commonname is not null and strpos(commonname,chr(92))>0;
update public.ph_request_history set commonname=private.normalize_escaped_display_text_v1(commonname)
where commonname is not null and strpos(commonname,chr(92))>0;
update public.ph_request_sales_impact_ledger set commonname=private.normalize_escaped_display_text_v1(commonname)
where commonname is not null and strpos(commonname,chr(92))>0;

insert into app_sync_private.sources(key,modules,client_enabled,dylan_only)
values('ph_request_sales_impact_ledger','{managers,request,sales,reports}',true,false)
on conflict(key) do update set modules=excluded.modules,client_enabled=excluded.client_enabled,
  dylan_only=excluded.dylan_only;

insert into public.app_dataset_revisions(key,revision,state,changed_at)
values('ph_active_request',1,'ready',clock_timestamp()),
  ('ph_request_history',1,'ready',clock_timestamp()),
  ('ph_request_sales_impact_ledger',1,'ready',clock_timestamp())
on conflict(key) do update set revision=public.app_dataset_revisions.revision+1,
  state='ready',changed_at=clock_timestamp();

update public.app_runtime_watchdog_events set status='resolved'
where status='open' and app_version<>'2.3.60';

do $verify$
declare lifecycle_count bigint;
declare ledger_count bigint;
begin
  if not has_table_privilege('authenticated','public.ph_master_inventory','select') then
    raise exception 'MASTER_INVENTORY_AUTHENTICATED_SELECT_MISSING';
  end if;
  if exists(select 1 from public.ph_request_history history
    where private.request_completion_proof_v1(
      history.unique_id,coalesce(history.master_id,history.master_unique_id),history.itemcode,history.locationcode
    ) is null
      and not exists(select 1 from public.ph_active_request active where active.unique_id=history.unique_id)) then
    raise exception 'UNFULFILLED_REQUEST_RECOVERY_INCOMPLETE';
  end if;
  if exists(select 1 from public.ph_active_request active
    where active.move_batch_id is null and (lower(btrim(coalesce(active.req_status,'')))<>'pending'
      or coalesce(active.req_archived,false) or nullif(btrim(coalesce(active.date_completed,'')),'') is not null
      or private.request_completion_proof_v1(active.unique_id,active.master_id,active.itemcode,active.locationcode) is not null)) then
    raise exception 'ACTIVE_REQUEST_FOUR_PROOF_STATE_INVALID';
  end if;
  select count(distinct unique_id) into lifecycle_count from (
    select unique_id from public.ph_request_history
    union select unique_id from public.ph_active_request where move_batch_id is null
  ) lifecycle;
  select count(*) into ledger_count from public.ph_request_sales_impact_ledger;
  if ledger_count<lifecycle_count
    or exists(select 1 from public.ph_request_sales_impact_ledger group by unique_id having count(*)>1)
    or exists(select 1 from public.ph_request_sales_impact_ledger
      where line_dollar_value is distinct from round((case when coalesce(raw_qty,0)>0 then raw_qty else 25 end)*list_price,2)) then
    raise exception 'REQUEST_SALES_LEDGER_CONTRACT_INVALID';
  end if;
  if (select count(*) from pg_trigger where tgrelid='public.ph_request_history'::regclass
      and tgname in ('ph_request_history_block_delete_v2360','ph_request_history_block_truncate_v2360') and tgenabled='O')<>2 then
    raise exception 'REQUEST_HISTORY_APPEND_ONLY_GUARD_INVALID';
  end if;
  if (select count(*) from pg_class where oid in (
      'public.ph_request_sales_impact_lines_v1'::regclass,
      'public.ph_request_sales_impact_by_sales_rep_v1'::regclass,
      'public.ph_request_sales_impact_by_customer_consignee_v1'::regclass
    ) and reloptions@>array['security_invoker=true'])<>3 then
    raise exception 'REQUEST_SALES_SECURITY_INVOKER_INVALID';
  end if;
  if position('master.pick' in pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure))>0
    or position('master.pick' in pg_get_functiondef('public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure))>0
    or position('candidate.master_row.' in pg_get_functiondef('public.append_request_options_v1(uuid,text,text,text[])'::regprocedure))>0
    or position('outbox.request_id=request_id' in replace(
      pg_get_functiondef('public.save_request_work(text,bigint,jsonb,boolean)'::regprocedure),' ',''
    ))>0 then raise exception 'REQUEST_FUNCTION_REPAIR_INCOMPLETE'; end if;
  if exists(select 1 from public.ph_master_inventory where commonname~$regex$\\+(['"])$regex$)
    or exists(select 1 from public.ph_active_request where commonname~$regex$\\+(['"])$regex$)
    or exists(select 1 from public.ph_request_history where commonname~$regex$\\+(['"])$regex$)
    or exists(select 1 from public.ph_request_sales_impact_ledger where commonname~$regex$\\+(['"])$regex$) then
    raise exception 'ESCAPED_REQUEST_DISPLAY_TEXT_REMAINS';
  end if;
end
$verify$;

notify pgrst,'reload schema';

comment on table public.ph_request_sales_impact_ledger is
  'Permanent one-line-per-stable-request-ID sales-impact ledger; lifecycle copies merge only by exact unique_id.';
comment on function private.request_completion_proof_v1(text,text,text,text) is
  'Returns only the four accepted request completion proofs: completion outbox, history photo+spec, current master evidence, or explicit queue removal.';
comment on function private.enforce_request_lifecycle_v1() is
  'Keeps every unfulfilled request active and snapshotted in history; completion requires one of four explicit proofs.';

commit;
