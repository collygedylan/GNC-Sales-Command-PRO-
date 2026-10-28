begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

create table if not exists private.erp_sync_jobs (
  run_id uuid primary key default gen_random_uuid(),
  command_id text not null unique,
  requested_by text not null,
  active boolean not null default true,
  status jsonb not null,
  started_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  constraint erp_sync_status_object check (jsonb_typeof(status) = 'object')
);
alter table private.erp_sync_jobs enable row level security;
revoke all on private.erp_sync_jobs from public, anon, authenticated;
create unique index if not exists erp_sync_one_active_job on private.erp_sync_jobs(active) where active;

create or replace function public.get_erp_sync_status_v1()
returns jsonb language sql stable security definer set search_path = pg_catalog, public, private as $$
  select coalesce((select status from private.erp_sync_jobs order by started_at desc, run_id desc limit 1),
    jsonb_build_object('active',false,'status','idle','currentStage','idle','stageIndex',0,
      'stageOrder',jsonb_build_array('drive','cav','reserves','soc','hl_po_parsed'),'stageResults','[]'::jsonb));
$$;

create or replace function public.claim_erp_sync_job_v1(p_command_id text, p_actor text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  existing private.erp_sync_jobs%rowtype;
  job_id uuid := gen_random_uuid();
  stamp timestamptz := clock_timestamp();
  initial_status jsonb;
begin
  if p_command_id is null or p_command_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or nullif(btrim(p_actor),'') is null or length(p_actor)>200 then
    raise exception 'ERP_SYNC_COMMAND_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agdata:manual-erp-sync',0));
  -- Expiry frees only this job lease. Published operational datasets remain READY.
  update private.erp_sync_jobs set active=false, finished_at=stamp, updated_at=stamp,
    status=status || jsonb_build_object('active',false,'status','failed','currentStage','idle',
      'finishedAt',stamp,'updatedAt',stamp,'error','The prior import worker expired; completed data is retained.',
      'errorCode','ERP_SYNC_WORKER_EXPIRED')
    where active and updated_at < stamp - interval '20 minutes';
  select * into existing from private.erp_sync_jobs where command_id=p_command_id;
  if found then
    if existing.requested_by <> btrim(p_actor) then raise exception 'ERP_SYNC_COMMAND_ACTOR_MISMATCH'; end if;
    return existing.status || jsonb_build_object('claimed',false);
  end if;
  select * into existing from private.erp_sync_jobs where active limit 1;
  if found then return existing.status || jsonb_build_object('claimed',false,'status','busy'); end if;
  initial_status := jsonb_build_object('active',true,'status','queued','runId',job_id,
    'stageOrder',jsonb_build_array('drive','cav','reserves','soc','hl_po_parsed'),
    'stageIndex',0,'currentStage','queued','currentStageLabel','Queued','stageResults','[]'::jsonb,
    'requestedBy',btrim(p_actor),'startedAt',stamp,'updatedAt',stamp,'source','postgres',
    'maxAttemptsPerStage',1,'message','Supabase import queued.');
  insert into private.erp_sync_jobs(run_id,command_id,requested_by,status,started_at,updated_at)
    values(job_id,p_command_id,btrim(p_actor),initial_status,stamp,stamp);
  return initial_status || jsonb_build_object('claimed',true);
end;
$$;

create or replace function public.update_erp_sync_job_v1(p_run_id uuid, p_status jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  existing private.erp_sync_jobs%rowtype;
  stamp timestamptz := clock_timestamp();
  next_status jsonb;
  next_active boolean;
  next_stage integer;
begin
  if jsonb_typeof(p_status) is distinct from 'object' or jsonb_typeof(p_status->'active') is distinct from 'boolean'
    or jsonb_typeof(p_status->'stageIndex') is distinct from 'number' then raise exception 'ERP_SYNC_STATUS_INVALID'; end if;
  next_active := (p_status->>'active')::boolean;
  next_stage := (p_status->>'stageIndex')::integer;
  if next_stage < 0 or next_stage > 5 or jsonb_typeof(p_status->'stageResults') is distinct from 'array'
    then raise exception 'ERP_SYNC_STATUS_INVALID'; end if;
  select * into existing from private.erp_sync_jobs where run_id=p_run_id for update;
  if not found then raise exception 'ERP_SYNC_JOB_NOT_FOUND'; end if;
  if not existing.active then return existing.status; end if;
  if next_stage < coalesce((existing.status->>'stageIndex')::integer,0) then raise exception 'ERP_SYNC_STAGE_REGRESSION'; end if;
  next_status := existing.status || p_status || jsonb_build_object('runId',existing.run_id,
    'requestedBy',existing.requested_by,'startedAt',existing.started_at,'updatedAt',stamp,
    'stageOrder',jsonb_build_array('drive','cav','reserves','soc','hl_po_parsed'),'source','postgres','maxAttemptsPerStage',1);
  if not next_active then next_status := next_status || jsonb_build_object('finishedAt',stamp); end if;
  update private.erp_sync_jobs set status=next_status, active=next_active, updated_at=stamp,
    finished_at=case when next_active then null else stamp end where run_id=p_run_id;
  return next_status;
end;
$$;

create or replace function public.fast_erp_import_columns_v1(p_dataset_key text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare target_table regclass;
begin
  target_table := case p_dataset_key when 'drive_around' then 'public.ph_master_inventory'::regclass
    when 'cav' then 'public.ph_cav_import'::regclass when 'reserves' then 'public.ph_reserves'::regclass
    when 'soc' then 'public.ph_soc_master'::regclass else null end;
  if target_table is null then raise exception 'ERP_SYNC_DATASET_INVALID'; end if;
  return (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a
    where a.attrelid=target_table and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attidentity='');
end;
$$;

revoke all on function public.get_erp_sync_status_v1() from public, anon, authenticated;
revoke all on function public.claim_erp_sync_job_v1(text,text) from public, anon, authenticated;
revoke all on function public.update_erp_sync_job_v1(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.fast_erp_import_columns_v1(text) from public, anon, authenticated;
grant execute on function public.get_erp_sync_status_v1() to service_role;
grant execute on function public.claim_erp_sync_job_v1(text,text) to service_role;
grant execute on function public.update_erp_sync_job_v1(uuid,jsonb) to service_role;
grant execute on function public.fast_erp_import_columns_v1(text) to service_role;
commit;
