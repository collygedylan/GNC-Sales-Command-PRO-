-- AgData v3.0.1: serialize staging; preserve receipts and retry cursors.
set local lock_timeout = '15s';
set local statement_timeout = '45s';
do $patch$
declare fn record; definition text; changed text;
begin
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_erp_sync_request_step_v1','assert_erp_sync_worker_v1') loop
    definition:=pg_get_functiondef(fn.oid);
    changed:=replace(definition,'''4 seconds''','''90 seconds''');
    if fn.proname='claim_erp_sync_request_step_v1' then
      changed:=replace(changed,
        'select * into job from private.erp_sync_jobs where run_id=p_run_id for update;',
        'select * into job from private.erp_sync_jobs where run_id=p_run_id;
  if not found then raise exception ''ERP_SYNC_JOB_NOT_FOUND''; end if;
  if job.requested_by is distinct from nullif(btrim(p_actor),'''') then raise exception ''ERP_SYNC_COMMAND_ACTOR_MISMATCH''; end if;
  if not pg_try_advisory_xact_lock(hashtext(''agdata_erp_sync_tick'')) then
    return job.status||jsonb_build_object(''claimed'',false,''continuationStep'',job.continuation_step,''retryAfterMs'',1000);
  end if;
  select * into job from private.erp_sync_jobs where run_id=p_run_id for update;');
    end if;
    if changed=definition then raise exception 'ERP_WORKER_PATCH_ANCHOR_MISSING: %',fn.proname; end if;
    execute changed;
  end loop;
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('fast_append_erp_stage_batch_v1','fast_commit_erp_stage_swap_v1') loop
    definition:=pg_get_functiondef(fn.oid);
    changed:=regexp_replace(definition,E'\\mbegin\\M',E'begin
  perform set_config(''lock_timeout'',''15s'',true);
  perform set_config(''statement_timeout'',''45s'',true);
  if coalesce(auth.role(),'''')<>''service_role'' then raise exception using errcode=''42501'',message=''FAST_ERP_STAGE_FORBIDDEN''; end if;
  if not pg_try_advisory_xact_lock(hashtext(''agdata_erp_sync_tick'')) then
    return jsonb_build_object(''ok'',true,''busy'',true,''stage_id'',p_stage_id,''retryAfterMs'',1000);
  end if;');
    if changed=definition then raise exception 'ERP_STAGE_PATCH_ANCHOR_MISSING: %',fn.proname; end if;
    execute changed;
    execute format('alter function %s set lock_timeout = %L',fn.oid::regprocedure,'15s');
    execute format('alter function %s set statement_timeout = %L',fn.oid::regprocedure,'45s');
  end loop;
end
$patch$;
-- Exact published filename is a READY publication receipt; no metadata write on the skip path.
do $patch$
declare definition text; changed text;
begin
  select pg_get_functiondef('public.check_erp_file_sync_needed_v1(text,text,text,text,text)'::regprocedure) into definition;
  changed:=replace(definition,
    'if current_revision.key is not null and current_revision.source_file_id=btrim(p_file_id) then',
    'if current_revision.key is not null and current_revision.source_file_name=btrim(p_file_name) then
    return jsonb_build_object(''up_to_date'',true,''skip'',true,''ignored'',false,
      ''file_name'',btrim(p_file_name),''dataset_key'',revision_key,
      ''duration_ms'',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
  end if;
  if current_revision.key is not null and current_revision.source_file_id=btrim(p_file_id) then');
  if changed=definition then raise exception 'ERP_SKIP_PATCH_ANCHOR_MISSING'; end if;
  execute changed;
end
$patch$;
