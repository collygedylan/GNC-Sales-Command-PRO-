begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

create table private.erp_stage_publication_jobs_v3042 (
  stage_id uuid primary key references private.fast_erp_stage_runs_v1(stage_id) on delete cascade,
  payload jsonb,
  failures integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_error text
);
revoke all on private.erp_stage_publication_jobs_v3042 from public,anon,authenticated,service_role;

-- A prepared payload belongs to the same sealed stage and is discarded with it.
do $prepared$
declare definition text := pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure);
  anchor text := '  select jsonb_agg(row_value order by row_ordinal) into rows_value'||chr(10)||
    '    from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;';
begin
  if strpos(definition,anchor)=0 then raise exception 'ERP_STAGE_PREPARED_PAYLOAD_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,$read$  select j.payload into rows_value
    from private.erp_stage_publication_jobs_v3042 j where j.stage_id=p_stage_id;
  if rows_value is null then
    select jsonb_agg(row_value order by row_ordinal) into rows_value
      from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;
  end if;$read$);
end
$prepared$;

create function private.run_erp_stage_publication_v3042(p_stage_id uuid)
returns void language plpgsql set search_path='' set work_mem='64MB' as $runner$
declare
  stage private.fast_erp_stage_runs_v1%rowtype;
  job private.erp_stage_publication_jobs_v3042%rowtype;
  prepared jsonb;
  receipt jsonb;
  job_name text := 'agdata-erp-publication-'||p_stage_id;
begin
  select * into job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update skip locked;
  if not found then
    if not exists(select 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id) then
      perform cron.unschedule(job_name);
    end if;
    return;
  end if;
  if job.next_attempt_at>clock_timestamp() then return; end if;
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.stage_state='committed' or stage.expires_at<=clock_timestamp() or job.failures>=6 then
    if stage.stage_state='committed' then delete from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id; end if;
    perform cron.unschedule(job_name);
    return;
  end if;

  begin
    if job.payload is null then
      select ('['||string_agg(row_value::text,',' order by row_ordinal)||']')::jsonb into prepared
      from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;
      if coalesce(jsonb_array_length(prepared),0)<>stage.expected_rows then raise exception 'FAST_ERP_STAGE_INCOMPLETE'; end if;
      update private.erp_stage_publication_jobs_v3042 set payload=prepared,failures=0,last_error=null where stage_id=p_stage_id;
      return;
    end if;

    perform set_config('request.jwt.claim.role','service_role',true);
    receipt := public.fast_commit_erp_stage_swap_v1(p_stage_id);
    if coalesce((receipt->>'busy')::boolean,false) then return; end if;
    if not coalesce((receipt->>'ok')::boolean,false) then raise exception 'FAST_ERP_STAGE_COMMIT_UNCONFIRMED'; end if;
    delete from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id;
    perform cron.unschedule(job_name);
  exception when query_canceled or others then
    update private.erp_stage_publication_jobs_v3042 set failures=job.failures+1,
      next_attempt_at=clock_timestamp()+least(60,5*2^job.failures)*interval '1 second',last_error=SQLSTATE
      where stage_id=p_stage_id;
  end;
end
$runner$;
revoke all on function private.run_erp_stage_publication_v3042(uuid) from public,anon,authenticated,service_role;

create function public.fast_commit_erp_stage_swap_v1(p_stage_id uuid,p_async boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $enqueue$
declare stage private.fast_erp_stage_runs_v1%rowtype; prior_failures integer; error_code text;
begin
  if coalesce(auth.role(),'')<>'service_role' or p_async is distinct from true then
    raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN';
  end if;
  select * into stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.stage_state='committed' and stage.committed_result is not null then
    return stage.committed_result||jsonb_build_object('stage_replayed',true);
  end if;
  if not found or stage.stage_state<>'staging' or stage.expires_at<=clock_timestamp()
     or stage.staged_rows<>stage.expected_rows then
    raise exception using errcode='55000',message='FAST_ERP_STAGE_INCOMPLETE';
  end if;
  select failures,last_error into prior_failures,error_code
  from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id;
  if prior_failures>=6 then
    raise exception using errcode='55000',message='ERP_PUBLICATION_RETRY_EXHAUSTED',detail=error_code;
  end if;
  if not found then
    insert into private.erp_stage_publication_jobs_v3042(stage_id) values(p_stage_id) on conflict do nothing;
    if found then
      perform cron.schedule('agdata-erp-publication-'||p_stage_id,'10 seconds',format(
        'set statement_timeout = ''120s''; select private.run_erp_stage_publication_v3042(%L::uuid)',p_stage_id));
    end if;
  end if;
  return jsonb_build_object('ok',true,'busy',true,'stage_id',p_stage_id,'retryAfterMs',10000);
end
$enqueue$;
revoke all on function public.fast_commit_erp_stage_swap_v1(uuid,boolean) from public,anon,authenticated;
grant execute on function public.fast_commit_erp_stage_swap_v1(uuid,boolean) to service_role;
notify pgrst, 'reload schema';

commit;
