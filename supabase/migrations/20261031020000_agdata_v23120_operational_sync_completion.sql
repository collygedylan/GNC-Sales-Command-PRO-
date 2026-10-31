begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Canonical jobs are private.erp_sync_jobs; never create a competing public run table.
create or replace function private.operational_erp_status_v23120(p_status jsonb,p_started timestamptz,p_stamp timestamptz)
returns jsonb language plpgsql immutable set search_path='' as $$
declare all_done boolean; last_progress timestamptz; recovered boolean;
begin
  if not coalesce((p_status->>'active')::boolean,false) then return p_status; end if;
  select bool_and(coalesce(p_status->'sourceProgress'->k->>'error','')='' and coalesce(result->>'outcome','')<>'failed' and
    (coalesce((p_status->'sourceProgress'->k->>'percent')::numeric=100,false) or coalesce(result->>'outcome' in ('processed','imported','UP_TO_DATE'),false)))
    into all_done from unnest(array['drive','cav','reserves','soc','hl_po_parsed']) k
    left join lateral (select r result from jsonb_array_elements(coalesce(p_status->'stageResults','[]')) with ordinality e(r,n)
      where r->>'key'=k and (nullif(p_status->'sourceProgress'->k->>'fileName','') is null or nullif(r->>'sourceFileName','') is null
        or r->>'sourceFileName'=p_status->'sourceProgress'->k->>'fileName') order by n desc limit 1) latest on true;
  select greatest(p_started,max(private.fast_erp_timestamptz_v2369(v->>'updatedAt'))) into last_progress
    from jsonb_each(coalesce(p_status->'sourceProgress','{}')) e(k,v) where k in ('drive','cav','reserves','soc','hl_po','hl_po_parsed');
  recovered:=p_status->>'currentStage'='order_history' or p_stamp-coalesce(last_progress,p_started)>interval '90 seconds';
  if all_done or recovered then
    return p_status||jsonb_build_object('active',false,'status','complete','percent',100,'stageIndex',5,
      'currentStage','idle','currentStageLabel','Idle','finishedAt',p_stamp,'completedAt',p_stamp,
      'error','','errorCode','','message',case when all_done then 'Five operational sources completed.' else 'Operational run released; ready for a fresh Drive check.' end);
  end if;
  return p_status;
end $$;
revoke all on function private.operational_erp_status_v23120(jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.finish_operational_erp_job_v23120() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.active then
    new.status:=private.operational_erp_status_v23120(new.status,new.started_at,clock_timestamp());
    if not coalesce((new.status->>'active')::boolean,false) then
      new.active:=false;new.finished_at:=clock_timestamp();new.request_lease_until:=null;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.finish_operational_erp_job_v23120() from public,anon,authenticated,service_role;
drop trigger if exists finish_operational_erp_job_v23120 on private.erp_sync_jobs;
create trigger finish_operational_erp_job_v23120 before insert or update on private.erp_sync_jobs
  for each row when (new.active) execute function private.finish_operational_erp_job_v23120();
-- One-time recovery preserves every cursor, completed receipt and READY publication.
update private.erp_sync_jobs set status=private.operational_erp_status_v23120(status,started_at,clock_timestamp()) where active;

-- SQL-only daily observations overlay immutable history bags; finalized manifests stay untouched.
create table if not exists private.soc_live_average_rows_v23120(
  source_day date not null,group_key text not null,source_row_number bigint not null,
  itemcode_normalized text not null,quantity_ordered numeric not null check(quantity_ordered>0),
  snapshot_at timestamptz not null,primary key(source_day,group_key,source_row_number)
);
alter table private.soc_live_average_rows_v23120 enable row level security;
revoke all on private.soc_live_average_rows_v23120 from public,anon,authenticated,service_role;
create index if not exists soc_live_average_item_v23120 on private.soc_live_average_rows_v23120(itemcode_normalized,source_day,group_key);

create or replace function private.fold_soc_average_orders_v23120(p_file_meta jsonb,p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare active_run uuid;stamp timestamptz;day_value date;affected text[];
begin
  select active_run_id into active_run from private.ph_eval_item_low_stock_import_state where singleton for update;
  if active_run is null then return; end if;
  stamp:=coalesce(private.fast_erp_timestamptz_v2369(p_file_meta->>'modified_at'),clock_timestamp());
  day_value:=(stamp at time zone 'America/Chicago')::date;
  with incoming as (
    select upper(btrim(r->>'itemcode')) itemcode from jsonb_array_elements(p_rows) r
    where nullif(btrim(r->>'itemcode'),'') is not null
  ) select array_agg(distinct itemcode) into affected from incoming;
  if affected is null then return; end if;
  -- Replace exactly the incoming daily group bags, including quantity changes and duplicate physical lines.
  with groups as (
    select distinct array_to_json(array[upper(btrim(r->>'warehouseid')),upper(btrim(r->>'transactionnumber')),
      upper(btrim(coalesce(nullif(r->>'consigneeidentityid',''),nullif(r->>'customeridentityid',''),nullif(r->>'consigneename',''),r->>'customername'))),upper(btrim(r->>'itemcode'))])::text group_key
    from jsonb_array_elements(p_rows) r
  ) delete from private.soc_live_average_rows_v23120 l using groups g
    where l.source_day=day_value and l.group_key=g.group_key and l.snapshot_at<=stamp;
  insert into private.soc_live_average_rows_v23120(source_day,group_key,source_row_number,itemcode_normalized,quantity_ordered,snapshot_at)
  select day_value,array_to_json(array[upper(btrim(r->>'warehouseid')),upper(btrim(r->>'transactionnumber')),
    upper(btrim(coalesce(nullif(r->>'consigneeidentityid',''),nullif(r->>'customeridentityid',''),nullif(r->>'consigneename',''),r->>'customername'))),upper(btrim(r->>'itemcode'))])::text,
    n,upper(btrim(r->>'itemcode')),(r->>'quantityordered')::numeric,stamp
  from jsonb_array_elements(p_rows) with ordinality e(r,n)
  where nullif(btrim(r->>'warehouseid'),'') is not null and nullif(btrim(r->>'transactionnumber'),'') is not null
    and coalesce(nullif(btrim(r->>'consigneeidentityid'),''),nullif(btrim(r->>'customeridentityid'),''),nullif(btrim(r->>'consigneename'),''),nullif(btrim(r->>'customername'),'')) is not null
    and nullif(btrim(r->>'itemcode'),'') is not null and nullif(btrim(r->>'dock'),'') is not null
    and lower(btrim(r->>'dock')) not in ('0','nan','null','none') and (r->>'quantityordered')::numeric>0
    and not exists(select 1 from private.soc_live_average_rows_v23120 newer where newer.source_day=day_value
      and newer.group_key=array_to_json(array[upper(btrim(r->>'warehouseid')),upper(btrim(r->>'transactionnumber')),upper(btrim(coalesce(nullif(r->>'consigneeidentityid',''),nullif(r->>'customeridentityid',''),nullif(r->>'consigneename',''),r->>'customername'))),upper(btrim(r->>'itemcode'))])::text and newer.snapshot_at>stamp)
  on conflict(source_day,group_key,source_row_number) do nothing;

  -- Only affected item codes are reduced; no Drive reads, full history import, or master-row trigger.
  with observations as materialized (
    select v.source_report_date source_day,r.group_key,r.quantity_ordered,r.itemcode_normalized,
      v.snapshot_at,v.source_created_at,v.drive_file_id,v.file_version_id::text file_id
    from private.ph_eval_item_low_stock_order_rows r
    join private.ph_eval_item_low_stock_run_files rf on rf.file_version_id=r.file_version_id and rf.run_id=active_run
    join private.ph_eval_item_low_stock_file_versions v on v.file_version_id=r.file_version_id
    where r.itemcode_normalized=any(affected) and v.status='finalized' and v.disposition='eligible'
    union all
    select source_day,group_key,quantity_ordered,itemcode_normalized,snapshot_at,snapshot_at,
      'live:'||source_day::text,'live:'||source_day::text
    from private.soc_live_average_rows_v23120 where itemcode_normalized=any(affected)
  ), bags as (
    select distinct source_day,group_key,snapshot_at,source_created_at,drive_file_id,file_id from observations
  ), ranked as (
    select *,row_number() over(partition by source_day,group_key
      order by snapshot_at desc,source_created_at desc nulls last,drive_file_id collate "C" desc,file_id desc) position from bags
  ), chosen as (
    select o.* from observations o join ranked b using(source_day,group_key,file_id,snapshot_at) where b.position=1
  )
  insert into private.ph_eval_item_low_stock_target_stats(run_id,itemcode_normalized,qualifying_line_count,qualifying_day_count,
    source_file_count,mean_quantity,p75_quantity,suggested_qty,history_from_date,history_through_date,calculated_at)
  select active_run,itemcode_normalized,count(*)::integer,count(distinct source_day)::integer,count(distinct file_id)::integer,
    avg(quantity_ordered),percentile_disc(0.75) within group(order by quantity_ordered),
    ceil(avg(quantity_ordered)+greatest(avg(quantity_ordered),percentile_disc(0.75) within group(order by quantity_ordered)))::integer,
    min(source_day),max(source_day),clock_timestamp() from chosen group by itemcode_normalized
  on conflict(run_id,itemcode_normalized) do update set qualifying_line_count=excluded.qualifying_line_count,
    qualifying_day_count=excluded.qualifying_day_count,source_file_count=excluded.source_file_count,
    mean_quantity=excluded.mean_quantity,p75_quantity=excluded.p75_quantity,suggested_qty=excluded.suggested_qty,
    history_from_date=excluded.history_from_date,history_through_date=excluded.history_through_date,calculated_at=excluded.calculated_at;
end $$;
revoke all on function private.fold_soc_average_orders_v23120(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Preserve the canonical protected-field importer and its service-only entrypoint.
create or replace function public.fast_ingest_soc_orders_v1(p_file_meta jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  result:=private.fast_finish_live_ingest_v2369('soc',p_file_meta,p_rows,array[
    'assignedto','date_completed','dock_photo_link','dock_photo_name','dock_spec','dock_caliper','dock_note',
    'spec','caliper','pic_note','av_note','photo_link','photo_name','initial_ptr','loc_match_qty','app_tab_assignment',
    'match','sales_note','suspend_candidate_group','state','order_quantity','origin_uid'],true);
  if coalesce((result->>'ok')::boolean,false) and coalesce(result->>'status','')<>'UP_TO_DATE' then
    perform private.fold_soc_average_orders_v23120(p_file_meta,p_rows);
  end if;
  return result;
end $$;
revoke all on function public.fast_ingest_soc_orders_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fast_ingest_soc_orders_v1(jsonb,jsonb) to service_role;
-- Retain the authenticated, redacted projection and expose the completion percentage.
do $projection$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.get_my_erp_sync_progress_v23116()'::regprocedure);
  execute replace(definition,'''active'',''status'',''runId''','''active'',''status'',''percent'',''runId''');
end $projection$;
notify pgrst,'reload schema';
commit;
