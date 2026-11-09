begin;
set local lock_timeout = '4s';
set local statement_timeout = '20s';

-- A workbook's revision owns its current filename. Physical rows carry the
-- filename from their last actual source write. Absence is stamped once.
create or replace function private.apply_erp_master_provenance_v3042()
returns void language plpgsql set search_path = '' as $provenance$
begin
  with incoming as materialized (
    select map.canonical_unique_id,
      private.inventory_location_evidence_number_v2(s.raw_values->>'ptronhand') as on_hand,
      private.inventory_location_evidence_number_v2(s.raw_values->>'ptrreviewed') as reviewed,
      private.inventory_location_evidence_number_v2(s.raw_values->>'ptravailable') as available,
      s.raw_values->>'filename' as filename
    from pg_temp.ph_master_bulk_stage_v1 s
    join pg_temp.ph_master_bulk_map_v1 map using(row_number)
  )
  update public.ph_master_inventory m
  set erp_on_hand=i.on_hand, erp_ptrreview=i.reviewed, erp_available=i.available,
      filename=coalesce(i.filename,m.filename),
      erp_source_filename=coalesce(i.filename,m.filename), erp_source_present=true
  from incoming i
  where m.unique_id=i.canonical_unique_id
    and (m.erp_on_hand,m.erp_ptrreview,m.erp_available,m.erp_source_present)
      is distinct from (i.on_hand,i.reviewed,i.available,true);

  if not exists (
    select 1 from pg_temp.ph_master_bulk_stage_v1
    where nullif(btrim(filename),'') is not null
    having count(distinct nullif(btrim(filename),''))=1
  ) then return; end if;

  update public.ph_master_inventory m
  set erp_source_filename=coalesce(m.erp_source_filename,m.filename), erp_source_present=false
  where m.erp_source_present is distinct from false
    and not exists (
      select 1 from pg_temp.ph_master_bulk_map_v1 map where map.canonical_unique_id=m.unique_id
    );
end
$provenance$;

create table private.erp_soc_history_jobs_v3046 (
  source_uid text primary key,
  attempts integer not null default 0 check(attempts between 0 and 3),
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_sqlstate text
);
create index erp_soc_history_jobs_v3046_due on private.erp_soc_history_jobs_v3046(next_attempt_at,source_uid)
  where attempts < 3;
revoke all on private.erp_soc_history_jobs_v3046 from public,anon,authenticated,service_role;

-- An operational alias correction enqueues only the affected physical SOC
-- rows, in the same transaction. History can retry independently of Drive.
do $queue$
declare
  definition text := pg_get_functiondef('private.normalize_soc_itemcode_from_pairs_v23104(jsonb)'::regprocedure);
  update_at text := '  update public.ph_soc_master as soc';
  diagnostics_at text := '  get diagnostics normalized_rows=row_count;';
  full_refresh text := '  if normalized_rows>0 then perform private.refresh_soc_order_history_v2366(null); end if;';
  start_at integer := strpos(definition,update_at);
  stop_at integer := strpos(definition,diagnostics_at);
begin
  if start_at=0 or stop_at<=start_at or strpos(definition,full_refresh)=0 then
    raise exception 'ERP_SOC_HISTORY_QUEUE_ANCHOR_MISSING';
  end if;
  definition:=overlay(definition placing $exact$  , changed as (
    update public.ph_soc_master as soc
    set itemcode=matched.itemcode
    from matched
    where soc.unique_id=matched.unique_id and soc.itemcode is distinct from matched.itemcode
    returning soc.unique_id
  ), enqueued as (
    insert into private.erp_soc_history_jobs_v3046(source_uid)
    select unique_id from changed
    on conflict(source_uid) do update
      set attempts=0,next_attempt_at=clock_timestamp(),last_sqlstate=null
    returning source_uid
  )
  select count(*)::integer into normalized_rows from enqueued;$exact$
    from start_at for stop_at-start_at+length(diagnostics_at));
  execute replace(definition,full_refresh,'');
end
$queue$;

create function private.drain_erp_soc_history_v3046()
returns integer language plpgsql set search_path = '' set lock_timeout = '1s' as $drain$
declare
  job private.erp_soc_history_jobs_v3046%rowtype;
  processed integer := 0;
begin
  if exists (select 1 from private.erp_sync_jobs where active)
    or not pg_try_advisory_xact_lock(hashtext('agdata-erp-soc-history-v3046')) then
    return 0;
  end if;
  for job in select * from private.erp_soc_history_jobs_v3046
    where attempts<3 and next_attempt_at<=clock_timestamp()
    order by next_attempt_at,source_uid limit 8 for update skip locked
  loop
    begin
      perform private.refresh_soc_order_history_v2366(job.source_uid);
      delete from private.erp_soc_history_jobs_v3046 where source_uid=job.source_uid;
      processed:=processed+1;
    exception when query_canceled or others then
      update private.erp_soc_history_jobs_v3046
      set attempts=job.attempts+1,last_sqlstate=SQLSTATE,
          next_attempt_at=clock_timestamp()+(30*2^job.attempts)*interval '1 second'
      where source_uid=job.source_uid;
      if SQLSTATE='57014' then exit; end if;
    end;
  end loop;
  return processed;
end
$drain$;
revoke all on function private.drain_erp_soc_history_v3046() from public,anon,authenticated,service_role;

-- The minute evidence-lifecycle job already yields during ERP. The exact
-- order delta, expiry receipts, and immutable Drive archive remain atomic.
do $inline$
declare
  definition text := pg_get_functiondef('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'::regprocedure);
  full_reconcile text := '  perform public.reconcile_inventory_location_evidence_v1();';
  evidence_scope text := 'where a.run_id=p_run_id and e.source_unique_id=a.canonical_unique_id and e.cleared_at is null;';
  physical_scope text := 'and (a.old_loc_photo_match>0 or a.photo_expired);';
begin
  if strpos(definition,full_reconcile)=0 then raise exception 'ERP_EVIDENCE_RECONCILE_ANCHOR_MISSING'; end if;
  execute replace(definition,full_reconcile,'');

  definition := pg_get_functiondef('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure);
  if strpos(definition,evidence_scope)=0 or strpos(definition,physical_scope)=0 then
    raise exception 'ERP_EVIDENCE_DELTA_ANCHOR_MISSING';
  end if;
  definition := replace(definition,evidence_scope,$delta$where a.run_id=p_run_id
        and e.source_unique_id=a.canonical_unique_id and e.cleared_at is null
        and (a.photo_expired or (e.current_photo_match_qty,e.loc_match_qty,e.initial_loc_photo_match,e.eval_baseline_available)
          is distinct from (a.new_loc_photo_match,a.new_loc_photo_match::text,a.new_loc_photo_match,
            private.inventory_location_evidence_number_v2(m.ptravailable)));$delta$);
  execute replace(definition,physical_scope,$delta$and (a.old_loc_photo_match>0 or a.photo_expired)
        and ((m.loc_photo_match,m.loc_match_qty,m.initial_loc_photo_match,m.eval_baseline_available)
          is distinct from (a.new_loc_photo_match,a.new_loc_photo_match::text,a.new_loc_photo_match,
            private.inventory_location_evidence_number_v2(m.ptravailable))
          or (a.photo_expired and (m.photo_link,m.photo_name,m.photo_url,m.photos,m.date_completed,m.eval_task_completed_at)
            is distinct from (null::text,null::text,null::text,'[]'::jsonb,null::timestamptz,null::timestamptz)));$delta$);
end
$inline$;

-- Set top-level deadlines as separate cron statements. A nested function's
-- statement_timeout setting does not change an already-running statement.
do $deadline$
declare
  definition text := pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure);
  lock_anchor text := 'set_config(''lock_timeout'',''15s'',true)';
  scheduled text := $prior$set statement_timeout = ''120s''; begin; select private.load_drive_erp_publication_input_v3042(%1$L::uuid); select private.run_erp_stage_publication_v3042(%1$L::uuid); commit',p_stage_id$prior$;
begin
  if strpos(definition,lock_anchor)=0 then raise exception 'ERP_PUBLICATION_LOCK_ANCHOR_MISSING'; end if;
  execute replace(definition,lock_anchor,'set_config(''lock_timeout'',''4s'',true)');
  definition := pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'::regprocedure);
  if strpos(definition,scheduled)=0 then raise exception 'ERP_PUBLICATION_DEADLINE_ANCHOR_MISSING'; end if;
  execute replace(definition,scheduled,$command$begin; set local lock_timeout = ''4s''; set local statement_timeout = ''30s''; select private.load_drive_erp_publication_input_v3042(%1$L::uuid); set local statement_timeout = %2$L; select private.run_erp_stage_publication_v3042(%1$L::uuid); commit',p_stage_id,case stage.dataset_key when 'drive_around' then '20s' else '120s' end$command$);
end
$deadline$;

alter function public.fast_commit_erp_stage_swap_v1(uuid) set lock_timeout = '4s';
alter function public.fast_ingest_drive_around_v1(jsonb,jsonb) set lock_timeout = '4s';
alter function public.fast_ingest_drive_around_v2374_base(jsonb,jsonb) set lock_timeout = '4s';
alter function public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text) set lock_timeout = '4s';
alter function public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text) set lock_timeout = '4s';
alter function public.fast_ingest_soc_orders_v1(jsonb,jsonb) set lock_timeout = '4s';
alter function private.fast_finish_live_ingest_v2369(text,jsonb,jsonb,text[],boolean) set lock_timeout = '4s';

select cron.schedule('agdata-erp-soc-history-v3046','* * * * *',
  'set statement_timeout = ''12s''; select private.drain_erp_soc_history_v3046();');

commit;
