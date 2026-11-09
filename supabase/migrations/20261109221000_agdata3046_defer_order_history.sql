begin;
set local lock_timeout = '4s';
set local statement_timeout = '20s';

-- Freeze each order source before the operational revision advances. The
-- archive cannot read a later workbook's rows or hold up the ready revision.
create table private.erp_order_history_rows_v3046 (
  dataset_key text not null check(dataset_key in ('ph_soc_master','ph_reserves')),
  file_id text not null,
  source_uid text not null,
  source_row jsonb not null check(jsonb_typeof(source_row)='object' and source_row->>'unique_id' is not distinct from source_uid),
  attempts integer not null default 0 check(attempts between 0 and 3),
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_sqlstate text,
  primary key(dataset_key,file_id,source_uid)
);
create index erp_order_history_rows_v3046_due
  on private.erp_order_history_rows_v3046(next_attempt_at,dataset_key,file_id,source_uid) where attempts<3;
revoke all on private.erp_order_history_rows_v3046 from public,anon,authenticated,service_role;

create function private.freeze_erp_order_history_rows_v3046(p_dataset text,p_file text)
returns integer language plpgsql set search_path='' as $freeze$
declare changed integer;
begin
  if p_dataset not in ('ph_soc_master','ph_reserves') or nullif(p_file,'') is null then
    raise exception 'ERP_ORDER_HISTORY_SOURCE_INVALID';
  end if;
  execute format('insert into private.erp_order_history_rows_v3046(dataset_key,file_id,source_uid,source_row)
    select $1,$2,source.unique_id,to_jsonb(source) from public.%I source
    on conflict(dataset_key,file_id,source_uid) do nothing',p_dataset) using p_dataset,p_file;
  get diagnostics changed=row_count;
  return changed;
end
$freeze$;

create function private.read_erp_order_history_row_v3046(p_dataset text,p_uid text)
returns jsonb language sql stable set search_path='' as $source$
  select source_row from private.erp_order_history_rows_v3046
  where dataset_key=p_dataset and file_id=nullif(current_setting('agdata.erp.order_history_file_v3046',true),'')
    and source_uid=p_uid
$source$;

do $wire$
declare
  definition text;
  writer record;
  source_anchor text;
  source_query text;
  inline_history text := $original$  if revision_key='ph_soc_master' then perform private.refresh_soc_order_history_v2366(null); end if;
  if revision_key='ph_reserves' then perform private.refresh_reserve_history_v2366(null); end if;$original$;
begin
  for writer in select * from (values
    ('private.refresh_soc_order_history_v2366(text)','ph_soc_master'),
    ('private.refresh_reserve_history_v2366(text)','ph_reserves')) inputs(routine,relation)
  loop
    definition := pg_get_functiondef(writer.routine::regprocedure);
    source_anchor := format('from public.%I source',writer.relation);
    if strpos(definition,source_anchor)=0 then raise exception 'ERP_HISTORY_SOURCE_ANCHOR_MISSING'; end if;
    source_query := format($query$from (
      select live.* from public.%1$I live
      where nullif(current_setting('agdata.erp.order_history_file_v3046',true),'') is null
        and (p_unique_id is null or live.unique_id=p_unique_id)
      union all
      select frozen.*
      from jsonb_populate_record(null::public.%1$I,private.read_erp_order_history_row_v3046(%2$L,p_unique_id)) frozen
      where frozen.unique_id=p_unique_id
    ) source$query$,writer.relation,writer.relation);
    execute replace(definition,source_anchor,source_query);
  end loop;
  definition := pg_get_functiondef('private.fast_finish_live_ingest_v2369(text,jsonb,jsonb,text[],boolean)'::regprocedure);
  if strpos(definition,inline_history)=0 then raise exception 'ERP_ORDER_HISTORY_INLINE_ANCHOR_MISSING'; end if;
  execute replace(definition,inline_history,$queued$  if revision_key in ('ph_soc_master','ph_reserves') then
    result:=result||jsonb_build_object('history_state','queued','history_queued_rows',
      private.freeze_erp_order_history_rows_v3046(revision_key,meta->>'file_id'));
  end if;$queued$);
end
$wire$;

create function private.drain_erp_order_history_v3046()
returns integer language plpgsql set search_path='' set lock_timeout='1s' as $drain$
declare
  job private.erp_order_history_rows_v3046%rowtype;
  processed integer := 0;
  previous_file text := coalesce(current_setting('agdata.erp.order_history_file_v3046',true),'');
begin
  if exists (select 1 from private.erp_sync_jobs where active)
    or not pg_try_advisory_xact_lock(hashtext('agdata-erp-soc-history-v3046')) then
    return 0;
  end if;
  for job in select * from private.erp_order_history_rows_v3046
    where attempts<3 and next_attempt_at<=clock_timestamp()
    order by next_attempt_at,dataset_key,file_id,source_uid limit 32 for update skip locked
  loop
    begin
      perform set_config('agdata.erp.order_history_file_v3046',job.file_id,true);
      if job.dataset_key='ph_soc_master' then
        perform private.refresh_soc_order_history_v2366(job.source_uid);
      else
        perform private.refresh_reserve_history_v2366(job.source_uid);
      end if;
      delete from private.erp_order_history_rows_v3046
      where (dataset_key,file_id,source_uid)=(job.dataset_key,job.file_id,job.source_uid);
      processed:=processed+1;
    exception when query_canceled or others then
      update private.erp_order_history_rows_v3046
      set attempts=job.attempts+1,last_sqlstate=SQLSTATE,
          next_attempt_at=clock_timestamp()+(30*2^job.attempts)*interval '1 second'
      where (dataset_key,file_id,source_uid)=(job.dataset_key,job.file_id,job.source_uid);
      if SQLSTATE='57014' then exit; end if;
    end;
  end loop;
  perform set_config('agdata.erp.order_history_file_v3046',previous_file,true);
  return processed;
end
$drain$;
revoke all on function private.freeze_erp_order_history_rows_v3046(text,text),
  private.read_erp_order_history_row_v3046(text,text),private.drain_erp_order_history_v3046()
  from public,anon,authenticated,service_role;

-- These wrappers used to restore a 60-second lock wait above the finalizer.
alter function private.fast_ingest_snapshot_v2369(regclass,jsonb,text[],boolean) set lock_timeout='4s';
alter function public.fast_ingest_soc_reserves_v1(jsonb,jsonb) set lock_timeout='4s';
alter function public.fast_ingest_cav_v1(jsonb,jsonb) set lock_timeout='4s';

select cron.schedule('agdata-erp-order-history-v3046','* * * * *',
  'set statement_timeout = ''12s''; select private.drain_erp_order_history_v3046();');
commit;
