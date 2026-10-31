begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Keep the canonical status reducer; elapsed duration is never completion proof.
create or replace function private.operational_erp_status_v23120(p_status jsonb,p_started timestamptz,p_stamp timestamptz)
returns jsonb language plpgsql immutable set search_path='' as $$
declare source_key text; progress jsonb; receipt jsonb; amount numeric; total numeric:=0; all_done boolean:=true; checked boolean;
begin
  foreach source_key in array array['drive','cav','reserves','soc','hl_po_parsed'] loop
    progress:=coalesce(p_status->'sourceProgress'->source_key,case when source_key='hl_po_parsed' then p_status->'sourceProgress'->'hl_po' end,'{}');
    select r into receipt from jsonb_array_elements(coalesce(p_status->'stageResults','[]')) with ordinality e(r,n)
      where r->>'key'=source_key and (nullif(progress->>'fileName','') is null or nullif(r->>'sourceFileName','') is null or r->>'sourceFileName'=progress->>'fileName') order by n desc limit 1;
    checked:=coalesce((progress->>'checked')::boolean,false) and progress->>'stage'='complete' or coalesce(receipt->>'outcome'='UP_TO_DATE',false);
    amount:=greatest(0,least(95,coalesce((progress->>'percent')::numeric,0)));
    if coalesce(progress->>'error','')<>'' or receipt->>'outcome'='failed' then checked:=false;
    elsif checked or (receipt->>'outcome' in ('processed','imported') and coalesce((receipt->>'rowCount')::numeric,0)>0)
      or (progress->>'publicationConfirmed'='true' and progress->>'publishedFileName'=progress->>'fileName' and coalesce((progress->>'rowsPublished')::numeric,0)>0) then amount:=100;
    end if;
    total:=total+amount;all_done:=all_done and coalesce(checked,false) and amount=100;
  end loop;
  if all_done then
    return p_status||jsonb_build_object('active',false,'status','complete','percent',100,'stageIndex',5,'currentStage','idle','currentStageLabel','Idle',
      'finishedAt',coalesce(p_status->>'finishedAt',p_stamp::text),'completedAt',p_stamp,'error','','errorCode','','message','Five operational sources completed.');
  end if;
  return p_status||jsonb_build_object('percent',floor(total/5))||case when p_status->>'status'='complete' then
    jsonb_build_object('active',true,'status','running','finishedAt',null,'completedAt',null,'message','Continuing unfinished operational sources.') else '{}'::jsonb end;
end $$;
revoke all on function private.operational_erp_status_v23120(jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.finish_operational_erp_job_v23120() returns trigger
language plpgsql security definer set search_path='' as $$
declare source record; previous jsonb; filename text; published_count bigint;
begin
  -- Capture existing published rows once per source/run, never on every status poll.
  for source in select * from (values ('drive','ph_master_inventory','ph_master_inventory'),('cav','ph_cav_import','ph_cav_import'),
    ('reserves','ph_reserves','ph_reserves'),('soc','ph_soc_master','ph_soc_master'),('hl_po_parsed','hl_po_parsed','ph_hl_po')) s(key,revision_key,table_name) loop
    previous:=coalesce(new.status->'sourceProgress'->source.key,'{}');
    if not previous ? 'lastPublishedRows' then
      select source_file_name into filename from public.app_dataset_revisions where key=source.revision_key and state='ready';
      execute format('select count(*) from public.%I',source.table_name) into published_count;
      new.status:=jsonb_set(new.status,'{sourceProgress}',coalesce(new.status->'sourceProgress','{}')||jsonb_build_object(source.key,
        jsonb_build_object('fileName',filename,'lastPublishedRows',published_count,'stage','queued','percent',0,'checked',false)||previous),true);
    end if;
  end loop;
  new.status:=private.operational_erp_status_v23120(new.status,new.started_at,clock_timestamp());
  new.active:=coalesce((new.status->>'active')::boolean,false);
  if new.active then new.finished_at:=null; else new.finished_at:=coalesce(new.finished_at,clock_timestamp());new.request_lease_until:=null; end if;
  return new;
end $$;
revoke all on function private.finish_operational_erp_job_v23120() from public,anon,authenticated,service_role;
drop trigger if exists finish_operational_erp_job_v23120 on private.erp_sync_jobs;
create trigger finish_operational_erp_job_v23120 before insert or update on private.erp_sync_jobs
  for each row execute function private.finish_operational_erp_job_v23120();

-- Reclassify only the latest false completion. Preserve its receipt/cursor; the user starts a fresh five-folder check.
update private.erp_sync_jobs j set status=private.operational_erp_status_v23120(j.status||jsonb_build_object('status','incomplete','active',false,'finishedAt',null),j.started_at,clock_timestamp()),finished_at=null
where j.run_id=(select run_id from private.erp_sync_jobs order by started_at desc limit 1) and not j.active and j.status->>'status'='complete'
  and (private.operational_erp_status_v23120(j.status,j.started_at,clock_timestamp())->>'status')<>'complete';

-- Bind an already committed file receipt before restoring its truthful published label.
update private.erp_sync_jobs j set status=private.operational_erp_status_v23120(jsonb_set(j.status,
  array['sourceProgress',case s.dataset_key when 'drive_around' then 'drive' else s.dataset_key end],
  coalesce(j.status->'sourceProgress'->(case s.dataset_key when 'drive_around' then 'drive' else s.dataset_key end),'{}')||jsonb_build_object(
    'publicationConfirmed',true,'publishedFileName',s.file_meta->>'file_name','fileName',s.file_meta->>'file_name',
    'rowsPublished',s.expected_rows,'rowsParsed',s.expected_rows,'rowsStaged',s.expected_rows,'rowsTotal',s.expected_rows,
    'stage','published','percent',100,'checked',false),true),j.started_at,clock_timestamp())
from private.fast_erp_stage_runs_v1 s
where j.run_id=(select run_id from private.erp_sync_jobs order by started_at desc limit 1) and not j.active
  and j.status->>'status'='incomplete' and s.stage_id::text=j.status->'continuationCursor'->'fileContinuation'->'state'->>'stageId'
  and s.stage_state='committed' and s.committed_result->>'ok'='true'
  and s.file_meta->>'file_name'=j.status->'continuationCursor'->'fileContinuation'->'file'->>'name';

create or replace function public.get_erp_sync_status_v1()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,private as $$
  select coalesce((select status||jsonb_build_object('active',active,'updatedAt',updated_at,
    'workerActive',active and coalesce(request_lease_until>statement_timestamp(),false),
    'leaseExpired',active and coalesce(request_lease_until<=statement_timestamp(),true),
    'resumable',active and coalesce(request_lease_until<=statement_timestamp(),true))
    from private.erp_sync_jobs order by started_at desc,run_id desc limit 1),
    jsonb_build_object('active',false,'status','idle','percent',0,'currentStage','idle','stageIndex',0,
      'stageOrder',jsonb_build_array('drive','cav','reserves','soc','hl_po_parsed'),'stageResults','[]'::jsonb));
$$;
revoke all on function public.get_erp_sync_status_v1() from public,anon,authenticated;
grant execute on function public.get_erp_sync_status_v1() to service_role;

do $projection$
declare definition text;
begin
 definition:=pg_catalog.pg_get_functiondef('public.get_my_erp_sync_progress_v23116()'::regprocedure);
 definition:=replace(definition,'''active'',''status'',''percent'',''runId''','''active'',''status'',''percent'',''workerActive'',''leaseExpired'',''resumable'',''runId''');
 execute definition;
end $projection$;

-- Keep 1,500-row slices and 64-MiB payload bounds; a legitimate 52,000-row SOC file may seal at 100,000 rows.
alter table private.fast_erp_stage_runs_v1 drop constraint if exists fast_erp_stage_runs_v1_expected_rows_check;
alter table private.fast_erp_stage_runs_v1 add constraint fast_erp_stage_runs_v1_expected_rows_check
  check(expected_rows between 1 and case when dataset_key='soc' then 100000 else 50000 end);
do $capacity$
declare target regprocedure; definition text;
begin
 foreach target in array array['public.fast_begin_erp_stage_v1(text,jsonb,integer)'::regprocedure,'public.fast_seal_erp_stage_v1(uuid,integer)'::regprocedure] loop
   definition:=pg_get_functiondef(target);definition:=replace(definition,'p_expected_rows>50000','p_expected_rows>100000');
   if target='public.fast_begin_erp_stage_v1(text,jsonb,integer)'::regprocedure then definition:=replace(definition,'p_expected_rows<>50000','p_expected_rows<>(case when p_dataset_key=''soc'' then 100000 else 50000 end)');end if;execute definition;
 end loop;
 target:='private.fast_ingest_snapshot_v2369(regclass,jsonb,text[],boolean)'::regprocedure;
 definition:=pg_get_functiondef(target);definition:=replace(definition,'jsonb_array_length(p_rows)>50000','jsonb_array_length(p_rows)>(case when table_name in (''ph_soc_master'',''public.ph_soc_master'') then 100000 else 50000 end)');execute definition;
 target:='private.fast_finish_live_ingest_v2369(text,jsonb,jsonb,text[],boolean)'::regprocedure;
 definition:=pg_get_functiondef(target);definition:=replace(definition,'jsonb_array_length(p_rows)>50000','jsonb_array_length(p_rows)>(case when p_dataset_key=''soc'' then 100000 else 50000 end)');execute definition;
end $capacity$;
update private.fast_erp_stage_runs_v1 set expected_rows=100000 where dataset_key='soc' and stage_state='staging' and file_meta->>'expected_rows_pending'='true' and expected_rows=50000;
notify pgrst,'reload schema';
commit;
