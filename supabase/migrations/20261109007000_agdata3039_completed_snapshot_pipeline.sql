begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table if not exists private.history_delta_pending_files_v3039 (
  relation_id regclass not null,file_id text not null,
  status text not null default 'pending' check(status in('pending','waiting','complete','failed')),
  attempts integer not null default 0,next_attempt_at timestamptz not null default clock_timestamp(),
  rows_removed bigint not null default 0,last_receipt jsonb,last_error text,
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  primary key(relation_id,file_id)
);
create index if not exists history_delta_pending_due_v3039
  on private.history_delta_pending_files_v3039(status,next_attempt_at,created_at);
create index if not exists history_delta_pending_predecessor_v3039
  on private.history_delta_pending_files_v3039((last_receipt->>'previous_file')) where status='waiting';
revoke all on private.history_delta_pending_files_v3039 from public,anon,authenticated,service_role;

create or replace function private.enqueue_history_snapshot_file_v3039(p_relation regclass,p_file text)
returns void language plpgsql security definer set search_path='' as $function$
begin
  perform private.snapshot_read_relation_v3039(p_relation);
  if nullif(p_file,'') is null then raise exception 'HISTORY_COMPLETED_FILE_ID_REQUIRED'; end if;
  insert into private.history_delta_pending_files_v3039(relation_id,file_id) values(p_relation,p_file)
  on conflict(relation_id,file_id) do update set status='pending',attempts=0,last_error=null,
    next_attempt_at=clock_timestamp(),updated_at=clock_timestamp();
end
$function$;

create or replace function private.queue_drive_snapshot_receipt_v3039()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if not private.snapshot_file_receipt_status_v3039(new.status,new.row_count) then return new; end if;
  if tg_op='UPDATE' then
    if (new.status,new.row_count,new.processed_at) is not distinct from(old.status,old.row_count,old.processed_at) then return new; end if;
  end if;
  perform private.enqueue_history_snapshot_file_v3039('public.ph_drive_around_report_rows',new.file_id);
  perform private.enqueue_history_snapshot_file_v3039('public.ph_hold_stop_itemcode_snapshots',new.file_id);
  update private.history_delta_pending_files_v3039 set status='pending',next_attempt_at=clock_timestamp()
    where status='waiting' and last_receipt->>'previous_file'=new.file_id;
  return new;
end
$function$;
create trigger history_delta_completed_file_v3039 after insert or update on public.ph_drive_around_report_files
  for each row execute function private.queue_drive_snapshot_receipt_v3039();

-- Future writes publish immutable observations in the INSERT transaction.
-- A later queue run can reclaim physical duplicates but owns no logical data.
create or replace function private.capture_snapshot_insert_v3039()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if not public.snapshot_archive_policy_supported_v3039(tg_relid) then return null; end if;
  if not exists(select 1 from history_delta_new_rows_v3039) then return null; end if;
  create temporary table history_delta_insert_v3039 on commit drop as
    with payloads as (
      select r.unique_id,r.itemcode,r.file_id,to_jsonb(r) payload
      from history_delta_new_rows_v3039 r
    ), states as (
      select *,private.snapshot_business_state_v3039(payload) business_state from payloads
    )
    select unique_id observation_id,unique_id retained_id,itemcode,file_id,
      coalesce(payload->>'report_date',payload->>'file_date')::date observed_on,
      business_state,payload-array(select jsonb_object_keys(business_state)) provenance from states;
  perform private.capture_snapshot_archive_v3039(tg_relid,'select * from pg_temp.history_delta_insert_v3039');
  drop table pg_temp.history_delta_insert_v3039;
  insert into private.history_delta_pending_files_v3039(relation_id,file_id)
    select tg_relid,f.file_id from public.ph_drive_around_report_files f
    where private.snapshot_file_receipt_status_v3039(f.status,f.row_count)
      and f.file_id in(select new_row.file_id from history_delta_new_rows_v3039 new_row)
  on conflict(relation_id,file_id) do update set status='pending',attempts=0,last_error=null,
    next_attempt_at=clock_timestamp(),updated_at=clock_timestamp();
  update private.history_delta_pending_files_v3039 set status='pending',next_attempt_at=clock_timestamp()
    where relation_id=tg_relid and status='waiting' and last_receipt->>'previous_file' in
      (select file_id from history_delta_new_rows_v3039);
  return null;
end
$function$;
create trigger history_delta_drive_capture_v3039 after insert on public.ph_drive_around_report_rows
  referencing new table as history_delta_new_rows_v3039 for each statement execute function private.capture_snapshot_insert_v3039();
create trigger history_delta_hold_capture_v3039 after insert on public.ph_hold_stop_itemcode_snapshots
  referencing new table as history_delta_new_rows_v3039 for each statement execute function private.capture_snapshot_insert_v3039();

create or replace function private.skip_archived_snapshot_replay_v3039()
returns trigger language plpgsql security definer set search_path='' as $function$
declare original jsonb; replay_fields text[]:=array['created_at','updated_at'];
begin
  select state.business_state||coverage.provenance into original
  from private.history_snapshot_coverage_v3039 coverage
  join private.history_snapshot_states_v3039 state using(relation_id,state_digest)
  where coverage.relation_id=tg_relid and coverage.observation_id=new.unique_id
    and coverage.observation_id<>coverage.retained_id;
  if original is not null and original-replay_fields=to_jsonb(new)-replay_fields
    and public.snapshot_archive_policy_supported_v3039(tg_relid) then return null; end if;
  return new;
end
$function$;
create trigger zz_history_delta_drive_replay_v3039 before insert on public.ph_drive_around_report_rows
  for each row execute function private.skip_archived_snapshot_replay_v3039();
create trigger zz_history_delta_hold_replay_v3039 before insert on public.ph_hold_stop_itemcode_snapshots
  for each row execute function private.skip_archived_snapshot_replay_v3039();

create or replace function private.completed_snapshot_predecessor_v3039(p_relation regclass,p_file text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare receipt jsonb; previous_file text;
begin
  receipt:=private.snapshot_file_completion_v3039(p_relation,p_file);
  if not (receipt->>'ready')::boolean then return receipt; end if;
  with ordered as (
    select file_id,lag(file_id) over ordering previous_file
      from private.snapshot_file_order_v3039() window ordering as(order by sequence)
  ) select ordered.previous_file into previous_file from ordered where file_id=p_file;
  if previous_file is not null and not (private.snapshot_file_completion_v3039(p_relation,previous_file)->>'ready')::boolean then
    return receipt||jsonb_build_object('ready',false,'reason','predecessor_not_complete','previous_file',previous_file);
  end if;
  return receipt||jsonb_build_object('previous_file',previous_file);
end
$function$;

create or replace function private.stage_completed_snapshot_file_v3039(p_relation regclass,p_file text,p_previous text,p_limit integer)
returns bigint language plpgsql security definer set search_path='' as $function$
declare planned bigint; changed bigint;
begin
  drop table if exists pg_temp.history_delta_work_v3039;
  execute format($query$
    create temporary table history_delta_work_v3039 on commit drop as
    with observations as materialized (
      select to_jsonb(r) payload,private.snapshot_entity_v3039($1,to_jsonb(r)) entity,
        private.snapshot_business_state_v3039(to_jsonb(r)) business_state,r.file_id
      from %s r where r.file_id in($2,$3) and nullif(btrim(r.itemcode),'') is not null
        and coalesce(to_jsonb(r)->>'report_date',to_jsonb(r)->>'file_date') is not null
    ), counted as materialized (
      select *,count(*) over(partition by file_id,entity) multiplicity from observations
    ), candidates as materialized (
      select current.payload,current.business_state,previous.payload previous_payload,
        coalesce(coverage.retained_id,previous.payload->>'unique_id') retained_id
      from counted current join counted previous using(entity,business_state)
      join %s physical on physical.unique_id=current.payload->>'unique_id' and to_jsonb(physical)=current.payload
      left join private.history_snapshot_coverage_v3039 coverage on coverage.relation_id=$1
        and coverage.observation_id=previous.payload->>'unique_id'
      where current.file_id=$2 and previous.file_id=$3 and current.multiplicity=1 and previous.multiplicity=1
      order by current.payload->>'unique_id' limit $4
    ), required as (
      select payload,business_state,retained_id from candidates
      union all select previous_payload,business_state,previous_payload->>'unique_id' from candidates
    )
    select payload->>'unique_id' observation_id,retained_id,
      payload->>'itemcode' itemcode,payload->>'file_id' file_id,
      coalesce(payload->>'report_date',payload->>'file_date')::date observed_on,
      payload,business_state,payload-array(select jsonb_object_keys(business_state)) provenance from required
  $query$,private.snapshot_read_relation_v3039(p_relation),p_relation) using p_relation,p_file,p_previous,p_limit;
  select count(*) into planned from pg_temp.history_delta_work_v3039 where observation_id<>retained_id;
  execute format('select r.unique_id from %s r join pg_temp.history_delta_work_v3039 w
    on r.unique_id=w.observation_id for update of r',p_relation);
  execute format('select count(*) from %s r join pg_temp.history_delta_work_v3039 w
    on r.unique_id=w.observation_id where w.observation_id<>w.retained_id and to_jsonb(r) is distinct from w.payload',p_relation) into changed;
  if changed<>0 then raise exception 'HISTORY_SOURCE_CHANGED_RETRY'; end if;
  return planned;
end
$function$;

create or replace function private.compact_completed_snapshot_file_v3039(p_relation regclass,p_file text,p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $function$
declare metadata jsonb; planned bigint; removed bigint;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'HISTORY_BATCH_LIMIT_INVALID'; end if;
  perform private.assert_snapshot_archive_writable_v3039(p_relation);
  metadata:=private.completed_snapshot_predecessor_v3039(p_relation,p_file);
  if not (metadata->>'ready')::boolean then return metadata||jsonb_build_object('status','waiting_for_complete_source'); end if;
  if metadata->>'previous_file' is null then return metadata||jsonb_build_object('status','complete','rows_removed',0); end if;
  planned:=private.stage_completed_snapshot_file_v3039(p_relation,p_file,metadata->>'previous_file',p_limit);
  perform private.write_snapshot_delta_coverage_v3039(p_relation);
  removed:=private.delete_verified_snapshot_duplicates_v3039(p_relation);
  return metadata||jsonb_build_object('status',case when planned=p_limit then 'more' else 'complete' end,
    'rows_removed',removed,'logical_observations_preserved',true);
end
$function$;

create or replace function private.process_history_delta_queue_v3039()
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $function$
declare job private.history_delta_pending_files_v3039; receipt jsonb; failure text;
begin
  select * into job from private.history_delta_pending_files_v3039 where status='pending'
    and next_attempt_at<=clock_timestamp() order by next_attempt_at,created_at,file_id for update skip locked limit 1;
  if job.file_id is null then return jsonb_build_object('status','idle'); end if;
  begin
    receipt:=private.compact_completed_snapshot_file_v3039(job.relation_id::regclass,job.file_id,500);
    update private.history_delta_pending_files_v3039 set status=case receipt->>'status'
      when 'complete' then 'complete' when 'waiting_for_complete_source' then 'waiting' else 'pending' end,
      rows_removed=rows_removed+coalesce((receipt->>'rows_removed')::bigint,0),last_receipt=receipt,
      attempts=0,last_error=null,next_attempt_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp()
      where relation_id=job.relation_id and file_id=job.file_id;
  exception when others then
    get stacked diagnostics failure=message_text;
    update private.history_delta_pending_files_v3039 set attempts=attempts+1,last_error=left(failure,500),
      next_attempt_at=clock_timestamp()+make_interval(secs=>least(900,60*power(2,least(attempts,4))::integer)),
      updated_at=clock_timestamp() where relation_id=job.relation_id and file_id=job.file_id;
    return jsonb_build_object('status','retry_scheduled','error',failure);
  end;
  return receipt;
end
$function$;

do $schedule_bounded_queue$
declare job_id bigint;
begin
  if to_regclass('cron.job') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null then
    if not exists(select 1 from cron.job where jobname='agdata_history_delta_queue_v3039') then
      job_id:=cron.schedule('agdata_history_delta_queue_v3039','* * * * *','select private.process_history_delta_queue_v3039();');
      -- Activate only after the new Edge snapshot transport is verified live.
      perform cron.alter_job(job_id,active:=false);
    end if;
  end if;
end
$schedule_bounded_queue$;

revoke all on function private.enqueue_history_snapshot_file_v3039(regclass,text) from public,anon,authenticated,service_role;
revoke all on function private.queue_drive_snapshot_receipt_v3039() from public,anon,authenticated,service_role;
revoke all on function private.capture_snapshot_insert_v3039() from public,anon,authenticated,service_role;
revoke all on function private.skip_archived_snapshot_replay_v3039() from public,anon,authenticated,service_role;
revoke all on function private.completed_snapshot_predecessor_v3039(regclass,text) from public,anon,authenticated,service_role;
revoke all on function private.stage_completed_snapshot_file_v3039(regclass,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function private.compact_completed_snapshot_file_v3039(regclass,text,integer) from public,anon,authenticated,service_role;
revoke all on function private.process_history_delta_queue_v3039() from public,anon,authenticated,service_role;
commit;
