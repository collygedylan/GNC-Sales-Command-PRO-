begin;

set local statement_timeout = '120s';
set local lock_timeout = '5s';

do $restore$
declare
  archived record;
begin
  for archived in
    select table_name
    from information_schema.tables
    where table_schema = 'archive_backup' and table_type = 'BASE TABLE'
    order by table_name
  loop
    if to_regclass(format('public.%I', archived.table_name)) is not null then
      raise exception 'ARCHIVE_RESTORE_PUBLIC_CONFLICT: %', archived.table_name;
    end if;
    execute format('alter table archive_backup.%I set schema public', archived.table_name);
  end loop;
  if exists(select 1 from information_schema.tables where table_schema = 'archive_backup' and table_type = 'BASE TABLE') then
    raise exception 'ARCHIVE_RESTORE_INCOMPLETE';
  end if;
end
$restore$;

grant usage on schema public to anon, authenticated;
grant select on public.ph_active_request, public.ph_active_request_live_rows,
  public.ph_request_queue_live_rows, public.ph_request_history,
  public.ph_request_sales_impact_ledger, public."00_app_view_table_map"
  to anon, authenticated;

alter table public.ph_active_request enable row level security;
alter table public.ph_request_history enable row level security;
alter table public.ph_request_sales_impact_ledger enable row level security;
alter table public."00_app_view_table_map" enable row level security;

do $policies$
declare
  policy_row record;
begin
  for policy_row in
    select * from (values
      ('ph_active_request','ph_active_request_read_v2361'),
      ('ph_request_history','ph_request_history_read_v2361'),
      ('ph_request_sales_impact_ledger','ph_request_sales_impact_ledger_read_v2361'),
      ('00_app_view_table_map','app_view_table_map_read_v2361')
    ) as requested(table_name, policy_name)
  loop
    if not exists(
      select 1 from pg_policies
      where schemaname = 'public' and tablename = policy_row.table_name
        and policyname = policy_row.policy_name
    ) then
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
        policy_row.policy_name, policy_row.table_name);
    end if;
  end loop;
end
$policies$;

create table if not exists private.app_manual_sync_status_audit_v2361(
  audit_id bigint generated always as identity primary key,
  prior_status jsonb not null,
  prior_updated_at timestamptz,
  normalized_at timestamptz not null default clock_timestamp()
);
revoke all on private.app_manual_sync_status_audit_v2361 from public, anon, authenticated;
grant select, insert on private.app_manual_sync_status_audit_v2361 to service_role;

insert into private.app_manual_sync_status_audit_v2361(prior_status, prior_updated_at)
select status, updated_at from public.app_manual_sync_status where id = true
  and status is distinct from jsonb_build_object(
    'active',false,'source','startup','currentStage','idle','currentStageLabel','Idle',
    'stageIndex',0,'stageOrder','[]'::jsonb,'completedStages','[]'::jsonb,
    'message','Connected • ready','error',''
  );

insert into public.app_manual_sync_status(id,status,updated_at)
values(true,jsonb_build_object(
  'active',false,'source','startup','currentStage','idle','currentStageLabel','Idle',
  'stageIndex',0,'stageOrder','[]'::jsonb,'completedStages','[]'::jsonb,
  'message','Connected • ready','error',''
),clock_timestamp())
on conflict(id) do update set status=excluded.status,updated_at=excluded.updated_at;

create table if not exists private.ph_active_request_retirement_v2361(
  unique_id text primary key,
  retirement_reason text not null,
  row_snapshot jsonb not null,
  retired_at timestamptz not null default clock_timestamp()
);
revoke all on private.ph_active_request_retirement_v2361 from public, anon, authenticated;
grant select, insert, update on private.ph_active_request_retirement_v2361 to service_role;

do $history_guard$
declare
  request_row record;
begin
  for request_row in
    select active.unique_id
    from public.ph_active_request active
    where active.move_batch_id is null
      and (
        active.created_at < timestamptz '2026-10-22 00:00:00 America/Chicago'
        or coalesce(active.req_archived,false)
        or nullif(btrim(coalesce(active.date_completed,'')),'') is not null
        or lower(btrim(coalesce(active.req_status,'pending'))) <> 'pending'
        or exists(
          select 1 from public.ph_request_delivery_outbox completed
          where lower(btrim(coalesce(completed.event_type,''))) in ('request_completed','plant request completed!')
            and (
              completed.request_id = active.unique_id
              or completed.payload->>'request_id' = active.unique_id
              or (jsonb_typeof(completed.payload->'request_ids') = 'array' and completed.payload->'request_ids' ? active.unique_id)
            )
        )
      )
      and not exists(select 1 from public.ph_request_history history where history.unique_id = active.unique_id)
  loop
    perform private.upsert_request_history(request_row.unique_id,'v2361_retired_active','not_queued',true);
  end loop;
end
$history_guard$;

insert into private.ph_active_request_retirement_v2361(unique_id,retirement_reason,row_snapshot)
select active.unique_id,
  case
    when active.created_at < timestamptz '2026-10-22 00:00:00 America/Chicago' then 'pre_2026_10_22'
    when coalesce(active.req_archived,false) then 'archived'
    when nullif(btrim(coalesce(active.date_completed,'')),'') is not null then 'completed_at'
    when lower(btrim(coalesce(active.req_status,'pending'))) <> 'pending' then 'non_pending_status'
    else 'completed_outbox_event'
  end,
  to_jsonb(active)
from public.ph_active_request active
where active.move_batch_id is null
  and (
    active.created_at < timestamptz '2026-10-22 00:00:00 America/Chicago'
    or coalesce(active.req_archived,false)
    or nullif(btrim(coalesce(active.date_completed,'')),'') is not null
    or lower(btrim(coalesce(active.req_status,'pending'))) <> 'pending'
    or exists(
      select 1 from public.ph_request_delivery_outbox completed
      where lower(btrim(coalesce(completed.event_type,''))) in ('request_completed','plant request completed!')
        and (
          completed.request_id = active.unique_id
          or completed.payload->>'request_id' = active.unique_id
          or (jsonb_typeof(completed.payload->'request_ids') = 'array' and completed.payload->'request_ids' ? active.unique_id)
        )
    )
  )
on conflict(unique_id) do update set retirement_reason=excluded.retirement_reason,
  row_snapshot=excluded.row_snapshot,retired_at=clock_timestamp();

delete from public.ph_active_request active
where active.move_batch_id is null
  and exists(select 1 from private.ph_active_request_retirement_v2361 retired where retired.unique_id=active.unique_id);

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
  affected integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-recovery-v2361',0)) then
    return jsonb_build_object('ok',true,'busy',true,'recovered',0,'source','recent-outbox-only');
  end if;
  for candidate in
    with payload_rows as materialized (
      select distinct on(ids.request_id)
        ids.request_id,payload.request_data,outbox.created_at,outbox.event_id
      from public.ph_request_delivery_outbox outbox
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(outbox.payload->'requests')='array' then outbox.payload->'requests' else '[]'::jsonb end
      ) payload(request_data)
      cross join lateral (values(nullif(btrim(coalesce(
        payload.request_data->>'unique_id',payload.request_data->>'request_id',payload.request_data->>'request_unique_id',''
      )),''))) ids(request_id)
      where lower(btrim(coalesce(outbox.event_type,''))) in ('request_created','new plant request submitted')
        and outbox.created_at >= timestamptz '2026-10-22 00:00:00 America/Chicago'
        and ids.request_id is not null
      order by ids.request_id,outbox.created_at desc,outbox.event_id desc
    )
    select * from payload_rows source
    where not exists(select 1 from public.ph_active_request active where active.unique_id=source.request_id)
      and not exists(
        select 1 from public.ph_request_delivery_outbox completed
        where lower(btrim(coalesce(completed.event_type,''))) in ('request_completed','plant request completed!')
          and (
            completed.request_id=source.request_id
            or completed.payload->>'request_id'=source.request_id
            or (jsonb_typeof(completed.payload->'request_ids')='array' and completed.payload->'request_ids' ? source.request_id)
          )
      )
      and not exists(select 1 from private.ph_request_queue_removal_commands removal where removal.request_uid=source.request_id)
      and not exists(
        select 1 from public.ph_request_history history
        where history.unique_id=source.request_id and (
          coalesce(history.req_archived,false)
          or nullif(btrim(coalesce(history.date_completed,'')),'') is not null
          or lower(btrim(coalesce(history.req_status,''))) in ('complete','completed','fulfilled','archived','closed')
        )
      )
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
      request_data->>'app_tab_assignment',request_data->>'master_app_tab_assignment','recent_outbox_recovery',1,
      request_data->>'customeridentityid',request_data->>'customername',
      request_data->>'consigneeidentityid',request_data->>'consigneename'
    ) on conflict(unique_id) do nothing;
    get diagnostics affected=row_count;
    if affected>0 then
      perform private.upsert_request_history(request_id,'pending_recovered','not_queued',true);
      inserted_count:=inserted_count+1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'busy',false,'recovered',inserted_count,
    'source','recent-outbox-only','cutoff','2026-10-22T00:00:00-05:00');
end
$function$;
revoke all on function private.recover_unfulfilled_requests_v1() from public,anon,authenticated,service_role;

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
    'scope','recent-outbox-cutoff-v2361','recovery',recovery_result,'lifecycle',lifecycle_result
  );
end
$function$;
revoke all on function public.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
grant execute on function public.reconcile_active_requests_from_outbox_v1() to service_role;

create table if not exists private.ph_reclass_recount_merge_audit_v2361(
  duplicate_job_id uuid primary key,
  canonical_job_id uuid not null,
  job_snapshot jsonb not null,
  line_snapshot jsonb not null,
  merged_at timestamptz not null default clock_timestamp()
);
revoke all on private.ph_reclass_recount_merge_audit_v2361 from public,anon,authenticated;
grant select,insert,update on private.ph_reclass_recount_merge_audit_v2361 to service_role;

with ranked as materialized (
  select job.*,first_value(job.id) over(
    partition by upper(btrim(job.itemcode)),upper(btrim(job.locationcode))
    order by job.requested_at,job.created_at,job.id
  ) canonical_job_id
  from public.ph_reclass_recount_jobs job where job.status='pending'
), duplicates as materialized (
  select * from ranked where id<>canonical_job_id
)
insert into private.ph_reclass_recount_merge_audit_v2361(
  duplicate_job_id,canonical_job_id,job_snapshot,line_snapshot
)
select duplicate.id,duplicate.canonical_job_id,to_jsonb(duplicate),
  coalesce((select jsonb_agg(to_jsonb(line) order by line.lotcode,line.season,line.source_unique_id)
    from public.ph_reclass_recount_lines line where line.job_id=duplicate.id),'[]'::jsonb)
from duplicates duplicate
on conflict(duplicate_job_id) do update set canonical_job_id=excluded.canonical_job_id,
  job_snapshot=excluded.job_snapshot,line_snapshot=excluded.line_snapshot,merged_at=clock_timestamp();

with ranked as materialized (
  select job.id,first_value(job.id) over(
    partition by upper(btrim(job.itemcode)),upper(btrim(job.locationcode))
    order by job.requested_at,job.created_at,job.id
  ) canonical_job_id
  from public.ph_reclass_recount_jobs job where job.status='pending'
), duplicates as materialized (
  select * from ranked where id<>canonical_job_id
)
insert into public.ph_reclass_recount_lines(
  job_id,source_unique_id,itemcode,locationcode,lotcode,season,on_hand,available,review
)
select duplicate.canonical_job_id,line.source_unique_id,line.itemcode,line.locationcode,
  line.lotcode,line.season,line.on_hand,line.available,line.review
from duplicates duplicate join public.ph_reclass_recount_lines line on line.job_id=duplicate.id
on conflict(job_id,source_unique_id) do update set
  lotcode=excluded.lotcode,season=excluded.season,on_hand=excluded.on_hand,
  available=excluded.available,review=excluded.review;

delete from public.ph_reclass_recount_jobs duplicate
using private.ph_reclass_recount_merge_audit_v2361 audit
where duplicate.id=audit.duplicate_job_id and duplicate.status='pending';

create or replace function private.reclass_recount_item_identity_v2361(
  p_itemcode text,p_commonname text default null,p_contsize text default null
)
returns table(commonname text,contsize text)
language sql
stable
security definer
set search_path=''
as $function$
  with input as (
    select upper(btrim(coalesce(p_itemcode,''))) item_key,
      left(regexp_replace(coalesce(p_itemcode,''),'[^0-9]','','g'),6) prefix_key,
      split_part(coalesce(p_itemcode,''),'.',2) size_code,
      nullif(btrim(case when lower(btrim(coalesce(p_commonname,'')))='unknown' then '' else coalesce(p_commonname,'') end),'') input_name,
      nullif(btrim(coalesce(p_contsize,'')),'') input_size
  ), candidates as materialized (
    select 1 source_priority,itemcode,commonname,contsize from public.ph_master_inventory
    union all select 2,itemcode,commonname,contsize from public.ph_historical_inventory_dimensions
    union all select 3,itemcode,commonname,contsize from public.ph_request_history
  ), normalized as (
    select candidate.*,upper(btrim(coalesce(candidate.itemcode,''))) item_key,
      left(regexp_replace(coalesce(candidate.itemcode,''),'[^0-9]','','g'),6) prefix_key,
      split_part(coalesce(candidate.itemcode,''),'.',2) size_code
    from candidates candidate
    where nullif(btrim(coalesce(candidate.commonname,'')),'') is not null
  ), selected_name as (
    select normalized.commonname
    from normalized,input
    where normalized.item_key=input.item_key or (input.prefix_key<>'' and normalized.prefix_key=input.prefix_key)
    order by case when normalized.item_key=input.item_key then 0 else 1 end,
      normalized.source_priority,normalized.itemcode limit 1
  ), selected_size as (
    select normalized.contsize
    from normalized,input
    where nullif(btrim(coalesce(normalized.contsize,'')),'') is not null
      and (normalized.item_key=input.item_key or (input.size_code<>'' and normalized.size_code=input.size_code))
    order by case when normalized.item_key=input.item_key then 0 else 1 end,
      normalized.source_priority,normalized.itemcode limit 1
  )
  select coalesce(input.input_name,(select selected_name.commonname from selected_name),'Item '||coalesce(p_itemcode,'')),
    coalesce(input.input_size,(select selected_size.contsize from selected_size),case input.size_code
      when '250' then '#25' when '150' then '#15' when '100' then '#10'
      when '070' then '#7' when '050' then '#5' when '030' then '#3'
      when '031' then '3DP' when '021' then '2DP' when '020' then '#2'
      when '013' then '1GP' when '011' then '#1' when '010' then '#1'
      else null end)
  from input
$function$;
revoke all on function private.reclass_recount_item_identity_v2361(text,text,text)
  from public,anon,authenticated,service_role;

with resolved as materialized (
  select job.id,identity.commonname,identity.contsize
  from public.ph_reclass_recount_jobs job
  cross join lateral private.reclass_recount_item_identity_v2361(job.itemcode,job.commonname,job.contsize) identity
  where job.status='pending' and (
    nullif(btrim(coalesce(job.commonname,'')),'') is null
    or lower(btrim(job.commonname))='unknown'
    or nullif(btrim(coalesce(job.contsize,'')),'') is null
  )
)
update public.ph_reclass_recount_jobs job
set commonname=resolved.commonname,contsize=coalesce(resolved.contsize,''),updated_at=clock_timestamp()
from resolved where job.id=resolved.id;

update public.ph_reclass_recount_jobs job
set system_on_hand=totals.system_on_hand,updated_at=clock_timestamp()
from (
  select line.job_id,coalesce(sum(line.on_hand),0) system_on_hand
  from public.ph_reclass_recount_lines line group by line.job_id
) totals
where job.id=totals.job_id and job.status='pending';

create unique index if not exists ph_reclass_recount_jobs_pending_item_location_v2361_idx
  on public.ph_reclass_recount_jobs((upper(btrim(itemcode))),(upper(btrim(locationcode))))
  where status='pending';

create or replace function private.capture_reclass_recount_event_v1(
  p_event_id uuid,p_payload jsonb,p_requested_at timestamptz
)
returns void
language plpgsql
security definer
set search_path=''
set statement_timeout='5s'
as $function$
declare
  inquiry jsonb:=coalesce(p_payload->'reclassPayload','{}'::jsonb);
  actor_username text:=lower(btrim(coalesce(inquiry#>>'{actor,username}','')));
begin
  if p_event_id is null or actor_username=''
     or jsonb_typeof(inquiry#>'{transaction,requestActions}') is distinct from 'array'
     or not (inquiry#>'{transaction,requestActions}' ? 'recount')
     or jsonb_typeof(inquiry->'rowOverlays') is distinct from 'array' then return; end if;

  with overlay_rows as materialized (
    select value overlay from jsonb_array_elements(inquiry->'rowOverlays')
    where btrim(coalesce(value->>'unique_id',''))<>''
  ), source_rows as materialized (
    select btrim(coalesce(master.itemcode,overlay#>>'{expected,itemcode}',inquiry#>>'{source,itemcode}','')) itemcode,
      btrim(coalesce(master.commonname,inquiry#>>'{source,commonname}','')) commonname,
      btrim(coalesce(master.contsize,inquiry#>>'{source,contsize}','')) contsize,
      btrim(coalesce(master.locationcode,overlay#>>'{expected,locationcode}','')) locationcode,
      coalesce(private.reclass_numeric_v1(master.ptronhand),private.reclass_numeric_v1(overlay#>>'{expected,ptronhand}'),0) on_hand
    from overlay_rows source left join public.ph_master_inventory master on master.unique_id=source.overlay->>'unique_id'
  )
  insert into public.ph_reclass_recount_jobs(
    source_event_id,itemcode,commonname,contsize,locationcode,requested_by_username,requested_at,system_on_hand
  )
  select p_event_id,itemcode,max(commonname),max(contsize),locationcode,actor_username,
    coalesce(p_requested_at,clock_timestamp()),sum(on_hand)
  from source_rows where itemcode<>'' and locationcode<>'' group by itemcode,locationcode
  on conflict((upper(btrim(itemcode))),(upper(btrim(locationcode)))) where status='pending'
  do update set commonname=coalesce(nullif(public.ph_reclass_recount_jobs.commonname,''),excluded.commonname),
    contsize=coalesce(nullif(public.ph_reclass_recount_jobs.contsize,''),excluded.contsize),updated_at=clock_timestamp();

  with overlay_rows as materialized (
    select value overlay from jsonb_array_elements(inquiry->'rowOverlays')
    where btrim(coalesce(value->>'unique_id',''))<>''
  ), source_rows as materialized (
    select source.overlay,btrim(coalesce(master.itemcode,source.overlay#>>'{expected,itemcode}',inquiry#>>'{source,itemcode}','')) itemcode,
      btrim(coalesce(master.locationcode,source.overlay#>>'{expected,locationcode}','')) locationcode,
      btrim(coalesce(master.lotcode,source.overlay#>>'{expected,lotcode}','')) lotcode,
      btrim(coalesce(master.season,'')) season,
      coalesce(private.reclass_numeric_v1(master.ptronhand),private.reclass_numeric_v1(source.overlay#>>'{expected,ptronhand}'),0) on_hand,
      coalesce(private.reclass_numeric_v1(master.ptravailable),0) available,
      coalesce(private.reclass_numeric_v1(master.ptrreviewed),0) review
    from overlay_rows source left join public.ph_master_inventory master on master.unique_id=source.overlay->>'unique_id'
  )
  insert into public.ph_reclass_recount_lines(
    job_id,source_unique_id,itemcode,locationcode,lotcode,season,on_hand,available,review
  )
  select job.id,source.overlay->>'unique_id',source.itemcode,source.locationcode,
    source.lotcode,source.season,source.on_hand,source.available,source.review
  from source_rows source join public.ph_reclass_recount_jobs job
    on job.status='pending' and upper(btrim(job.itemcode))=upper(btrim(source.itemcode))
      and upper(btrim(job.locationcode))=upper(btrim(source.locationcode))
  on conflict(job_id,source_unique_id) do update set lotcode=excluded.lotcode,season=excluded.season,
    on_hand=excluded.on_hand,available=excluded.available,review=excluded.review;

  update public.ph_reclass_recount_jobs job
  set system_on_hand=totals.system_on_hand,updated_at=clock_timestamp()
  from (
    select line.job_id,sum(line.on_hand) system_on_hand
    from public.ph_reclass_recount_lines line
    join public.ph_reclass_recount_jobs pending on pending.id=line.job_id and pending.status='pending'
    group by line.job_id
  ) totals where job.id=totals.job_id;

  with resolved as materialized (
    select job.id,identity.commonname,identity.contsize
    from public.ph_reclass_recount_jobs job
    cross join lateral private.reclass_recount_item_identity_v2361(job.itemcode,job.commonname,job.contsize) identity
    where job.status='pending' and (
      nullif(btrim(coalesce(job.commonname,'')),'') is null or lower(btrim(job.commonname))='unknown'
      or nullif(btrim(coalesce(job.contsize,'')),'') is null
    )
  )
  update public.ph_reclass_recount_jobs job
  set commonname=resolved.commonname,contsize=coalesce(resolved.contsize,''),updated_at=clock_timestamp()
  from resolved where job.id=resolved.id;
end
$function$;
revoke all on function private.capture_reclass_recount_event_v1(uuid,jsonb,timestamptz)
  from public,anon,authenticated,service_role;

drop index if exists public.ph_request_sales_impact_ledger_unique_id_idx;

update public.ph_request_sales_impact_ledger ledger
set line_identity_key='ph_request_history:'||ledger.unique_id||':1',
  source_row_id=ledger.unique_id,source_table='ph_request_history',
  source_tables=array['ph_request_history'],row_index=1,updated_at=clock_timestamp();

create or replace function private.upsert_request_sales_impact_source_v2361(
  p_source_table text,p_source_row_id text,p_item_index integer,p_data jsonb,
  p_request_date timestamptz default null,p_email_thread_id text default null,p_force_status text default null
)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare
  request_id text:=nullif(btrim(coalesce(p_data->>'unique_id',p_data->>'request_id',p_data->>'request_unique_id','')),'');
  quantity numeric;
  effective_quantity numeric;
  price record;
  status_value text;
begin
  if nullif(btrim(coalesce(p_source_table,'')),'') is null
    or nullif(btrim(coalesce(p_source_row_id,'')),'') is null then return false; end if;
  request_id:=coalesce(request_id,'source-'||md5(p_source_table||':'||p_source_row_id));
  quantity:=private.request_sales_numeric_v1(coalesce(
    p_data->>'raw_qty',p_data->>'req_qty',p_data->>'qty',p_data->>'quantity',p_data->>'effective_qty'
  ));
  effective_quantity:=case when quantity>0 then quantity else 25 end;
  select * into price from private.request_sales_price_v2360(
    p_data->>'itemcode',p_data->>'commonname',p_data->>'contsize',
    coalesce(p_data->>'listprice',p_data->>'list_price',p_data->>'unit_list_price')
  );
  status_value:=case
    when lower(btrim(coalesce(p_force_status,'')))='completed' then 'Completed'
    when lower(btrim(coalesce(p_data->>'req_archived',''))) in ('true','t','1','yes')
      or nullif(btrim(coalesce(p_data->>'date_completed','')),'') is not null
      or lower(btrim(coalesce(p_data->>'req_status',p_data->>'status','pending'))) in ('complete','completed','fulfilled','archived','closed')
      then 'Completed' else 'Pending' end;
  insert into public.ph_request_sales_impact_ledger(
    line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,
    row_index,email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,
    itemcode,commonname,contsize,lotcode,locationcode,raw_qty,effective_qty,list_price,
    price_source,source_payload,updated_at
  ) values(
    p_source_table||':'||p_source_row_id||':'||greatest(coalesce(p_item_index,1),1),request_id,
    coalesce(nullif(btrim(p_data->>'request_folder'),''),request_id),p_data->>'request_folder',
    p_source_row_id,p_source_table,array[p_source_table],greatest(coalesce(p_item_index,1),1),
    coalesce(p_email_thread_id,p_data->>'email_thread_id',p_data->>'gmail_thread_id'),
    coalesce(private.try_timestamptz(p_data->>'created_at'),private.try_timestamptz(p_data->>'request_date'),p_request_date),
    status_value,coalesce(nullif(btrim(coalesce(p_data->>'request_selected_rep_display',
      p_data->>'request_selected_rep_username',p_data->>'requested_by',p_data->>'sales_rep')),''),'Unassigned'),
    coalesce(nullif(btrim(coalesce(p_data->>'customername',p_data->>'req_customer',
      p_data->>'request_customer',p_data->>'customer_name')),''),'Unknown Customer'),
    coalesce(nullif(btrim(coalesce(p_data->>'consigneename',p_data->>'consignee_name')),''),'N/A'),
    p_data->>'itemcode',private.normalize_escaped_display_text_v1(p_data->>'commonname'),p_data->>'contsize',
    p_data->>'lotcode',p_data->>'locationcode',case when quantity>0 then quantity end,effective_quantity,
    coalesce(price.list_price,0),coalesce(price.price_source,'unpriced'),coalesce(p_data,'{}'::jsonb),clock_timestamp()
  ) on conflict(line_identity_key) do update set
    unique_id=excluded.unique_id,request_identity=excluded.request_identity,folder_id=excluded.folder_id,
    source_row_id=excluded.source_row_id,source_table=excluded.source_table,source_tables=excluded.source_tables,
    row_index=excluded.row_index,email_thread_id=excluded.email_thread_id,request_date=excluded.request_date,
    status=excluded.status,sales_rep=excluded.sales_rep,customer_name=excluded.customer_name,
    consignee_name=excluded.consignee_name,itemcode=excluded.itemcode,commonname=excluded.commonname,
    contsize=excluded.contsize,lotcode=excluded.lotcode,locationcode=excluded.locationcode,
    raw_qty=excluded.raw_qty,effective_qty=excluded.effective_qty,list_price=excluded.list_price,
    price_source=excluded.price_source,source_payload=excluded.source_payload,updated_at=excluded.updated_at;
  return true;
end
$function$;
revoke all on function private.upsert_request_sales_impact_source_v2361(text,text,integer,jsonb,timestamptz,text,text)
  from public,anon,authenticated,service_role;

create or replace function private.refresh_request_sales_impact_line_v1(p_request_id text)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare source record; touched boolean:=false;
begin
  for source in
    select 'ph_active_request'::text source_table,active.unique_id source_row_id,to_jsonb(active) row_data,active.created_at request_date
    from public.ph_active_request active where active.unique_id=p_request_id and active.move_batch_id is null
    union all
    select 'ph_request_history',history.unique_id,
      coalesce(history.snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(history)),history.created_at
    from public.ph_request_history history where history.unique_id=p_request_id
  loop
    touched:=private.upsert_request_sales_impact_source_v2361(
      source.source_table,source.source_row_id,1,source.row_data,source.request_date,null,null
    ) or touched;
  end loop;
  return touched;
end
$function$;
revoke all on function private.refresh_request_sales_impact_line_v1(text)
  from public,anon,authenticated,service_role;

create or replace function private.request_sales_impact_source_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if tg_op='DELETE' then return old; end if;
  if tg_table_name='ph_active_request'
    and nullif(to_jsonb(new)->>'move_batch_id','') is not null then
    return new;
  end if;
  perform private.upsert_request_sales_impact_source_v2361(
    tg_table_name,new.unique_id,1,
    case when tg_table_name='ph_request_history'
      then coalesce(to_jsonb(new)->'snapshot','{}'::jsonb)||jsonb_strip_nulls(to_jsonb(new)) else to_jsonb(new) end,
    new.created_at,null,null
  );
  return new;
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
declare entry record; request_data jsonb;
begin
  if lower(btrim(coalesce(new.event_type,''))) in ('request_created','new plant request submitted')
    and jsonb_typeof(new.payload->'requests')='array' then
    for entry in select value,ordinality from jsonb_array_elements(new.payload->'requests') with ordinality loop
      perform private.upsert_request_sales_impact_source_v2361(
        'ph_request_delivery_outbox',new.event_id::text,entry.ordinality::integer,
        entry.value,new.created_at,new.gmail_thread_id,null
      );
    end loop;
  elsif lower(btrim(coalesce(new.event_type,''))) in ('request_completed','plant request completed!') then
    for entry in
      select request_id,row_number() over(order by request_id)::integer item_index
      from (
        select nullif(btrim(new.request_id),'') request_id
        union select nullif(btrim(value),'') from jsonb_array_elements_text(
          case when jsonb_typeof(new.payload->'request_ids')='array' then new.payload->'request_ids' else '[]'::jsonb end
        ) value
      ) ids where request_id is not null
    loop
      select coalesce(history.snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(history))
      into request_data from public.ph_request_history history where history.unique_id=entry.request_id;
      if request_data is not null then
        perform private.upsert_request_sales_impact_source_v2361(
          'ph_request_delivery_outbox',new.event_id::text,entry.item_index,
          request_data,new.created_at,new.gmail_thread_id,'Completed'
        );
      end if;
      update public.ph_request_sales_impact_ledger set status='Completed',updated_at=clock_timestamp()
      where unique_id=entry.request_id;
    end loop;
  end if;
  return new;
end
$function$;
revoke all on function private.request_sales_impact_outbox_trigger_v1()
  from public,anon,authenticated,service_role;

with base as materialized (
  select * from public.ph_request_sales_impact_ledger where source_table='ph_request_history'
), source as materialized (
  select active.*,row_number() over(partition by active.unique_id order by active.created_at,active.unique_id)::integer item_index
  from public.ph_active_request active where active.move_batch_id is null
)
insert into public.ph_request_sales_impact_ledger(
  line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,row_index,
  email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,itemcode,commonname,contsize,
  lotcode,locationcode,raw_qty,effective_qty,list_price,price_source,source_payload,updated_at
)
select 'ph_active_request:'||source.unique_id||':'||source.item_index,base.unique_id,base.request_identity,
  base.folder_id,source.unique_id,'ph_active_request',array['ph_active_request'],source.item_index,
  base.email_thread_id,source.created_at,'Pending',base.sales_rep,base.customer_name,base.consignee_name,
  base.itemcode,base.commonname,base.contsize,base.lotcode,base.locationcode,base.raw_qty,base.effective_qty,
  base.list_price,base.price_source,to_jsonb(source),clock_timestamp()
from source join base on base.unique_id=source.unique_id
on conflict(line_identity_key) do update set source_payload=excluded.source_payload,status=excluded.status,updated_at=excluded.updated_at;

with base as materialized (
  select * from public.ph_request_sales_impact_ledger where source_table='ph_request_history'
), expanded as materialized (
  select outbox.event_id,outbox.created_at,outbox.gmail_thread_id,payload.value request_data,payload.ordinality::integer item_index,
    nullif(btrim(coalesce(payload.value->>'unique_id',payload.value->>'request_id',payload.value->>'request_unique_id','')),'') request_id
  from public.ph_request_delivery_outbox outbox
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(outbox.payload->'requests')='array' then outbox.payload->'requests' else '[]'::jsonb end
  ) with ordinality payload(value,ordinality)
  where lower(btrim(coalesce(outbox.event_type,''))) in ('request_created','new plant request submitted')
)
insert into public.ph_request_sales_impact_ledger(
  line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,row_index,
  email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,itemcode,commonname,contsize,
  lotcode,locationcode,raw_qty,effective_qty,list_price,price_source,source_payload,updated_at
)
select 'ph_request_delivery_outbox:'||expanded.event_id||':'||expanded.item_index,base.unique_id,
  base.request_identity,base.folder_id,expanded.event_id::text,'ph_request_delivery_outbox',
  array['ph_request_delivery_outbox'],expanded.item_index,coalesce(expanded.gmail_thread_id,base.email_thread_id),
  expanded.created_at,base.status,base.sales_rep,base.customer_name,base.consignee_name,base.itemcode,
  base.commonname,base.contsize,base.lotcode,base.locationcode,base.raw_qty,base.effective_qty,
  base.list_price,base.price_source,expanded.request_data,clock_timestamp()
from expanded join base on base.unique_id=expanded.request_id
on conflict(line_identity_key) do update set source_payload=excluded.source_payload,status=excluded.status,updated_at=excluded.updated_at;

with base as materialized (
  select * from public.ph_request_sales_impact_ledger where source_table='ph_request_history'
), expanded as materialized (
  select outbox.event_id,outbox.created_at,outbox.gmail_thread_id,ids.request_id,
    row_number() over(partition by outbox.event_id order by ids.request_id)::integer item_index,
    jsonb_build_object('event_id',outbox.event_id,'event_type',outbox.event_type,
      'request_id',ids.request_id,'payload',outbox.payload) source_payload
  from public.ph_request_delivery_outbox outbox
  cross join lateral (
    select nullif(btrim(outbox.request_id),'') request_id
    union select nullif(btrim(value),'') from jsonb_array_elements_text(
      case when jsonb_typeof(outbox.payload->'request_ids')='array' then outbox.payload->'request_ids' else '[]'::jsonb end
    ) value
  ) ids
  where lower(btrim(coalesce(outbox.event_type,''))) in ('request_completed','plant request completed!')
    and ids.request_id is not null
)
insert into public.ph_request_sales_impact_ledger(
  line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,row_index,
  email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,itemcode,commonname,contsize,
  lotcode,locationcode,raw_qty,effective_qty,list_price,price_source,source_payload,updated_at
)
select 'ph_request_delivery_outbox:'||expanded.event_id||':'||expanded.item_index,base.unique_id,
  base.request_identity,base.folder_id,expanded.event_id::text,'ph_request_delivery_outbox',
  array['ph_request_delivery_outbox'],expanded.item_index,coalesce(expanded.gmail_thread_id,base.email_thread_id),
  expanded.created_at,'Completed',base.sales_rep,base.customer_name,base.consignee_name,base.itemcode,
  base.commonname,base.contsize,base.lotcode,base.locationcode,base.raw_qty,base.effective_qty,
  base.list_price,base.price_source,expanded.source_payload,clock_timestamp()
from expanded join base on base.unique_id=expanded.request_id
on conflict(line_identity_key) do update set source_payload=excluded.source_payload,status='Completed',updated_at=excluded.updated_at;

with base as materialized (
  select * from public.ph_request_sales_impact_ledger where source_table='ph_request_history'
), expanded as materialized (
  select thread.*,history.unique_id,
    row_number() over(partition by thread.id order by history.unique_id)::integer item_index
  from public.ph_request_email_threads thread
  join public.ph_request_history history on history.request_folder=thread.request_folder
)
insert into public.ph_request_sales_impact_ledger(
  line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,row_index,
  email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,itemcode,commonname,contsize,
  lotcode,locationcode,raw_qty,effective_qty,list_price,price_source,source_payload,updated_at
)
select 'ph_request_email_threads:'||expanded.id||':'||expanded.item_index,base.unique_id,base.request_identity,
  base.folder_id,expanded.id::text,'ph_request_email_threads',array['ph_request_email_threads'],expanded.item_index,
  coalesce(expanded.initial_thread_id,base.email_thread_id),coalesce(expanded.initial_email_sent_at,base.request_date),
  base.status,base.sales_rep,base.customer_name,base.consignee_name,base.itemcode,base.commonname,base.contsize,
  base.lotcode,base.locationcode,base.raw_qty,base.effective_qty,base.list_price,base.price_source,
  to_jsonb(expanded),clock_timestamp()
from expanded join base on base.unique_id=expanded.unique_id
on conflict(line_identity_key) do update set source_payload=excluded.source_payload,status=excluded.status,updated_at=excluded.updated_at;

insert into public.ph_request_sales_impact_ledger(
  line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,row_index,
  email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,itemcode,commonname,contsize,
  lotcode,locationcode,raw_qty,effective_qty,list_price,price_source,source_payload,updated_at
)
select 'ph_request_email_threads:'||thread.id||':1','source-'||md5('ph_request_email_threads:'||thread.id::text),
  coalesce(nullif(btrim(thread.request_folder),''),thread.id::text),thread.request_folder,thread.id::text,
  'ph_request_email_threads',array['ph_request_email_threads'],1,thread.initial_thread_id,
  thread.initial_email_sent_at,case when lower(btrim(coalesce(thread.status,''))) in ('complete','completed','closed') then 'Completed' else 'Pending' end,
  coalesce(nullif(btrim(thread.sales_rep_name),''),'Unassigned'),
  coalesce(nullif(btrim(thread.request_customer),''),'Unknown Customer'),'N/A',null,null,null,null,null,null,25,0,
  'unpriced',to_jsonb(thread),clock_timestamp()
from public.ph_request_email_threads thread
where not exists(select 1 from public.ph_request_history history where history.request_folder=thread.request_folder)
on conflict(line_identity_key) do update set source_payload=excluded.source_payload,status=excluded.status,updated_at=excluded.updated_at;

with base as materialized (
  select * from public.ph_request_sales_impact_ledger where source_table='ph_request_history'
), expanded as materialized (
  select folder.*,history.unique_id,
    row_number() over(partition by folder.request_folder order by history.unique_id)::integer item_index
  from private.ph_request_folder_delivery_state folder
  join public.ph_request_history history on history.request_folder=folder.request_folder
)
insert into public.ph_request_sales_impact_ledger(
  line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,row_index,
  email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,itemcode,commonname,contsize,
  lotcode,locationcode,raw_qty,effective_qty,list_price,price_source,source_payload,updated_at
)
select 'private.ph_request_folder_delivery_state:'||expanded.request_folder||':'||expanded.item_index,
  base.unique_id,base.request_identity,base.folder_id,expanded.request_folder,
  'private.ph_request_folder_delivery_state',array['private.ph_request_folder_delivery_state'],expanded.item_index,
  base.email_thread_id,coalesce(expanded.updated_at,base.request_date),base.status,base.sales_rep,base.customer_name,
  base.consignee_name,base.itemcode,base.commonname,base.contsize,base.lotcode,base.locationcode,
  base.raw_qty,base.effective_qty,base.list_price,base.price_source,to_jsonb(expanded),clock_timestamp()
from expanded join base on base.unique_id=expanded.unique_id
on conflict(line_identity_key) do update set source_payload=excluded.source_payload,status=excluded.status,updated_at=excluded.updated_at;

with base as materialized (
  select * from public.ph_request_sales_impact_ledger where source_table='ph_request_history'
), expanded as materialized (
  select financial.*,
    financial.source_table||':'||financial.request_id source_row_identity
  from private.request_financial_values_v1 financial
)
insert into public.ph_request_sales_impact_ledger(
  line_identity_key,unique_id,request_identity,folder_id,source_row_id,source_table,source_tables,row_index,
  email_thread_id,request_date,status,sales_rep,customer_name,consignee_name,itemcode,commonname,contsize,
  lotcode,locationcode,raw_qty,effective_qty,list_price,price_source,source_payload,updated_at
)
select 'private.request_financial_values_v1:'||expanded.source_row_identity||':1',base.unique_id,
  base.request_identity,base.folder_id,expanded.source_row_identity,'private.request_financial_values_v1',
  array['private.request_financial_values_v1'],1,base.email_thread_id,coalesce(expanded.captured_at,base.request_date),
  base.status,base.sales_rep,base.customer_name,base.consignee_name,expanded.itemcode,base.commonname,
  base.contsize,base.lotcode,base.locationcode,
  case when coalesce(expanded.effective_qty,base.effective_qty,0)>0
    then coalesce(expanded.effective_qty,base.effective_qty) end,
  case when coalesce(expanded.effective_qty,base.effective_qty,0)>0
    then coalesce(expanded.effective_qty,base.effective_qty) else 25 end,
  coalesce(expanded.list_price,base.list_price,0),'private.request_financial_values_v1',to_jsonb(expanded),clock_timestamp()
from expanded join base on base.unique_id=expanded.request_id
on conflict(line_identity_key) do update set source_payload=excluded.source_payload,status=excluded.status,
  effective_qty=excluded.effective_qty,list_price=excluded.list_price,updated_at=excluded.updated_at;

create or replace function public.get_request_sales_impact_v2()
returns jsonb
language sql
stable
security definer
set search_path=''
set statement_timeout='10s'
as $function$
  with lines as materialized (
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
    'dedupe_contract','source-row-line-identity-v2361',
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
      'dedupe_contract','source-row-line-identity-v2361','ledger_table','ph_request_sales_impact_ledger',
      'line_count',(select count(*) from lines),
      'distinct_source_lines',(select count(distinct source_table||':'||source_row_id||':'||row_index) from lines),
      'distinct_unique_ids',(select count(distinct unique_id) from lines),
      'requested_minimum_lines',8982,'requested_minimum_dollars',10000000,
      'requested_minimum_met',(select total_line_items>=8982 and total_dollar_value>=10000000 from summary),
      'formula','(raw_qty > 0 ? raw_qty : 25) * list_price'
    )
  )
$function$;
revoke all on function public.get_request_sales_impact_v2() from public,anon,authenticated;
grant execute on function public.get_request_sales_impact_v2() to service_role;

insert into public.app_dataset_revisions(key,revision,state,changed_at)
values('ph_active_request',1,'ready',clock_timestamp()),
  ('ph_request_sales_impact_ledger',1,'ready',clock_timestamp())
on conflict(key) do update set revision=public.app_dataset_revisions.revision+1,
  state='ready',changed_at=clock_timestamp();

do $verify$
declare
  active_count bigint;
  ledger_count bigint;
  ledger_total numeric;
begin
  if exists(select 1 from information_schema.tables where table_schema='archive_backup' and table_type='BASE TABLE') then
    raise exception 'ARCHIVE_BACKUP_NOT_EMPTY';
  end if;
  if exists(select 1 from public.app_manual_sync_status where id=true
    and (coalesce((status->>'active')::boolean,false) or coalesce(status->>'currentStage','')<>'idle')) then
    raise exception 'MANUAL_SYNC_NOT_IDLE';
  end if;
  select count(*) into active_count from public.ph_active_request where move_batch_id is null;
  if active_count<1 or active_count>25 then raise exception 'ACTIVE_REQUEST_COUNT_INVALID: %',active_count; end if;
  if exists(select 1 from public.ph_active_request where move_batch_id is null
    and created_at<timestamptz '2026-10-22 00:00:00 America/Chicago') then
    raise exception 'STALE_ACTIVE_REQUEST_REMAINED';
  end if;
  if exists(select 1 from public.ph_reclass_recount_jobs where status='pending'
    group by upper(btrim(itemcode)),upper(btrim(locationcode)) having count(*)>1) then
    raise exception 'RECOUNT_DUPLICATES_REMAIN';
  end if;
  if exists(select 1 from public.ph_reclass_recount_jobs where status='pending'
    and (nullif(btrim(coalesce(commonname,'')),'') is null or lower(btrim(commonname))='unknown')) then
    raise exception 'RECOUNT_NAME_UNRESOLVED';
  end if;
  select count(*),round(coalesce(sum(line_dollar_value),0),2)
  into ledger_count,ledger_total from public.ph_request_sales_impact_ledger;
  if ledger_count<8982 then raise exception 'REQUEST_LEDGER_LINE_COUNT_LOW: %',ledger_count; end if;
  if ledger_total<10000000 then raise exception 'REQUEST_LEDGER_TOTAL_LOW: %',ledger_total; end if;
  if exists(select 1 from public.ph_request_sales_impact_ledger
    group by line_identity_key having count(*)>1) then raise exception 'REQUEST_LEDGER_IDENTITY_DUPLICATE'; end if;
  if (select count(*) from public.ph_request_sales_impact_ledger)<>
     (select count(distinct source_table||':'||source_row_id||':'||row_index) from public.ph_request_sales_impact_ledger) then
    raise exception 'REQUEST_LEDGER_SOURCE_IDENTITY_COLLAPSE';
  end if;
  if position('recent-outbox-cutoff-v2361' in pg_get_functiondef('public.reconcile_active_requests_from_outbox_v1()'::regprocedure))=0 then
    raise exception 'REQUEST_RECOVERY_CONTRACT_STALE';
  end if;
  if position('source-row-line-identity-v2361' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))=0 then
    raise exception 'REQUEST_SALES_IMPACT_CONTRACT_STALE';
  end if;
end
$verify$;

select pg_notify('pgrst','reload schema');

commit;
