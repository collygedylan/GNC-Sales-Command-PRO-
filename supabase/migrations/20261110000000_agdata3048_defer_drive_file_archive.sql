begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

create table private.erp_drive_archive_jobs_v3048 (
  publication_id uuid primary key,
  file_id text not null,
  file_meta jsonb not null,
  source_rows integer not null default 0 check(source_rows>=0),
  attempts integer not null default 0 check(attempts between 0 and 3),
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_sqlstate text,
  archived_at timestamptz
);
create index erp_drive_archive_jobs_v3048_due on private.erp_drive_archive_jobs_v3048(next_attempt_at,publication_id)
  where archived_at is null and attempts<3;
create table private.erp_drive_archive_rows_v3048 (
  publication_id uuid not null references private.erp_drive_archive_jobs_v3048(publication_id),
  source_uid text not null,
  source_row public.ph_master_inventory not null check((source_row).unique_id=source_uid),
  primary key(publication_id,source_uid)
);
revoke all on private.erp_drive_archive_jobs_v3048,private.erp_drive_archive_rows_v3048 from public,anon,authenticated,service_role;

create function private.freeze_erp_drive_archive_v3048(p_publication uuid,p_meta jsonb)
returns jsonb language plpgsql set search_path='' as $freeze$
declare copied integer;
begin
  insert into private.erp_drive_archive_jobs_v3048(publication_id,file_id,file_meta)
  values(p_publication,p_meta->>'file_id',p_meta);
  insert into private.erp_drive_archive_rows_v3048(publication_id,source_uid,source_row)
  select p_publication,master.unique_id,master from public.ph_master_inventory master;
  get diagnostics copied=row_count;
  update private.erp_drive_archive_jobs_v3048 set source_rows=copied where publication_id=p_publication;
  return jsonb_build_object('archive_state','queued','archive_source_rows',copied,'archive_publication_id',p_publication,
    'report_rows',0,'history_rows',0);
end
$freeze$;

-- A worker uses its frozen typed snapshot. Existing internal archive callers
-- with no worker context retain the canonical live-row behavior.
create function private.read_erp_drive_archive_rows_v3048(p_file text)
returns setof public.ph_master_inventory language sql stable set search_path='' as $rows$
  select master.* from public.ph_master_inventory master
  where nullif(current_setting('agdata.erp.drive_archive_job_v3048',true),'') is null
  union all
  select (r.source_row).* from private.erp_drive_archive_rows_v3048 r
  join private.erp_drive_archive_jobs_v3048 j using(publication_id)
  where j.publication_id=nullif(current_setting('agdata.erp.drive_archive_job_v3048',true),'')::uuid
    and j.file_id=p_file and j.archived_at is null
$rows$;

do $wire$
declare
  definition text := pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure);
  raw_anchor text := 'from public.ph_master_inventory master on conflict(unique_id)';
  file_anchor text := '  from public.ph_master_inventory'||chr(10)||'  on conflict(file_id)';
  history_anchor text := '  from public.ph_master_inventory master'||chr(10)||'  on conflict(history_key)';
  ingest_anchor text := '  archive_result:=private.fast_archive_drive_v2369(meta);';
begin
  if strpos(definition,raw_anchor)=0 or strpos(definition,file_anchor)=0 or strpos(definition,history_anchor)=0 then
    raise exception 'ERP_DRIVE_ARCHIVE_FROZEN_INPUT_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,raw_anchor,'from private.read_erp_drive_archive_rows_v3048($1) master on conflict(unique_id)');
  definition:=replace(definition,file_anchor,$source$  from private.read_erp_drive_archive_rows_v3048(meta->>'file_id')
  on conflict(file_id)$source$);
  execute replace(definition,history_anchor,$source$  from private.read_erp_drive_archive_rows_v3048(meta->>'file_id') master
  on conflict(history_key)$source$);

  definition:=pg_get_functiondef('private.drive_mode_projection_matches_source_v3039(text,date,integer)'::regprocedure);
  if strpos(definition,'from public.ph_master_inventory')=0 then raise exception 'ERP_DRIVE_ARCHIVE_PROJECTION_ANCHOR_MISSING'; end if;
  execute replace(definition,'from public.ph_master_inventory','from private.read_erp_drive_archive_rows_v3048(p_file)');

  definition:=pg_get_functiondef('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'::regprocedure);
  if strpos(definition,ingest_anchor)=0 then raise exception 'ERP_DRIVE_ARCHIVE_INLINE_ANCHOR_MISSING'; end if;
  execute replace(definition,ingest_anchor,'  archive_result:=private.freeze_erp_drive_archive_v3048(run_id,meta);');
end
$wire$;

create function private.drain_erp_drive_archive_v3048()
returns integer language plpgsql set search_path='' set lock_timeout='1s' as $drain$
declare
  job private.erp_drive_archive_jobs_v3048%rowtype;
  receipt jsonb;
  previous_job text := coalesce(current_setting('agdata.erp.drive_archive_job_v3048',true),'');
  previous_role text := coalesce(current_setting('request.jwt.claim.role',true),'');
  previous_bulk text := coalesce(current_setting('agdata.bulk_import.ph_drive_around_report_rows',true),'');
begin
  if exists(select 1 from private.erp_sync_jobs where active)
    or not pg_try_advisory_xact_lock(hashtext('agdata-erp-soc-history-v3046')) then return 0; end if;
  select * into job from private.erp_drive_archive_jobs_v3048
  where archived_at is null and attempts<3 and next_attempt_at<=clock_timestamp()
  order by next_attempt_at,publication_id limit 1 for update skip locked;
  if not found then return 0; end if;
  begin
    perform set_config('request.jwt.claim.role','service_role',true);
    perform set_config('agdata.bulk_import.ph_drive_around_report_rows','on',true);
    perform set_config('agdata.erp.drive_archive_job_v3048',job.publication_id::text,true);
    receipt:=private.fast_archive_drive_v2369(job.file_meta);
    if (receipt->>'report_rows')::integer is distinct from job.source_rows
      or (receipt->>'history_rows')::integer is distinct from job.source_rows
      or not exists(select 1 from private.drive_mode_projection_receipts_v3039
        where file_id=job.file_id and row_count=job.source_rows and report_date=(job.file_meta->>'report_date')::date) then
      raise exception 'ERP_DRIVE_ARCHIVE_RECEIPT_MISSING';
    end if;
    delete from private.erp_drive_archive_rows_v3048 where publication_id=job.publication_id;
    update private.erp_drive_archive_jobs_v3048 set archived_at=clock_timestamp(),last_sqlstate=null
    where publication_id=job.publication_id;
  exception when query_canceled or others then
    update private.erp_drive_archive_jobs_v3048 set attempts=job.attempts+1,last_sqlstate=sqlstate,
      next_attempt_at=clock_timestamp()+(30*2^job.attempts)*interval '1 second' where publication_id=job.publication_id;
    return 0;
  end;
  perform set_config('agdata.erp.drive_archive_job_v3048',previous_job,true);
  perform set_config('request.jwt.claim.role',previous_role,true);
  perform set_config('agdata.bulk_import.ph_drive_around_report_rows',previous_bulk,true);
  return 1;
end
$drain$;

revoke all on function private.freeze_erp_drive_archive_v3048(uuid,jsonb),private.read_erp_drive_archive_rows_v3048(text),
  private.drain_erp_drive_archive_v3048() from public,anon,authenticated,service_role;

select cron.schedule('agdata-erp-drive-archive-v3048','* * * * *',
  'set statement_timeout = ''20s''; select private.drain_erp_drive_archive_v3048();');
commit;
