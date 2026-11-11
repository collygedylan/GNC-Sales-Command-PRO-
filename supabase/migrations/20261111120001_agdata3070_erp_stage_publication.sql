begin;
set local lock_timeout='4s';
set local statement_timeout='30s';

-- The master bulk guard delegates the incoming hold tuple to the typed stage.
-- Publish its ERP values just like priority after the per-row decision above.
do $projection$
declare proc regprocedure; def text; anchor text:='protected_fields constant text[] := array[''holdstopcode'',''holdstopreason'',''locationnote''];';
  deletion_guard text:='      and not exists (select 1 from private.ph_inventory_reclass_movements_v1 held';
begin
  foreach proc in array array['public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure,
    'public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure] loop
    def:=pg_get_functiondef(proc);
    if cardinality(string_to_array(def,anchor))<>2 then raise exception 'ACTION_PROJECTION_OWNER_DRIFT %',proc; end if;
    if cardinality(string_to_array(def,deletion_guard))<>2 then raise exception 'ACTION_RETENTION_OWNER_DRIFT %',proc; end if;
    def:=replace(def,deletion_guard,E'      and not exists (select 1 from public.app_row_actions a where a.canonical_unique_id=live.unique_id and a.reconciliation_status=''pending'')\n'||deletion_guard);
    execute replace(def,anchor,'protected_fields constant text[] := array[''locationnote''];');
  end loop;
end $projection$;

-- Keep legacy movement identity/ambiguity checks. Its quantity projection may
-- run only for a command that does not already have canonical ledger legs.
do $delegate$
declare f text; anchor text:='    if desired_status=''pending'' then';
  old_pool text:='season_stock.itemcode=stage.itemcode and season_stock.pending';
begin
  f:=pg_get_functiondef('private.apply_inventory_reclass_import_overlay_v1(uuid,uuid)'::regprocedure);
  if cardinality(string_to_array(f,anchor))<>2 then raise exception 'ACTION_MOVEMENT_OWNER_DRIFT'; end if;
  execute replace(f,anchor,$managed$    if (conflict_reason_value is null or conflict_reason_value='target_quantity_changed')
       and exists(select 1 from private.ph_inventory_reclass_commands_v1 cmd join public.app_row_actions a
         on a.app_update_action ? 'command_id' and a.app_update_action->>'command_id'=cmd.command_id
         and a.canonical_unique_id=movement_request.source_uid where cmd.request_id=movement_request.request_id)
    then continue; end if;
$managed$||anchor);
  f:=pg_get_functiondef('private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure);
  if cardinality(string_to_array(f,old_pool))<>4 then raise exception 'ACTION_SEASON_OWNER_DRIFT'; end if;
  execute replace(f,old_pool,old_pool||$managed$ and not exists(select 1 from public.app_row_actions a
      where a.changed_fields && array['s_lts','season_oh'] and a.app_update_row->>'itemcode'=season_stock.itemcode
      and private.inventory_stock_season_v1(a.app_update_row->>'lotcode',a.app_update_row->>'season')=season_stock.season)$managed$);
end $delegate$;

create or replace function public.begin_pending_erp_stage_v3070(
  p_dataset_key text, p_file_meta jsonb, p_expected_rows integer
) returns jsonb language plpgsql security definer
set search_path = '' set statement_timeout = '120s' set lock_timeout = '250ms'
as $function$
declare
  v_dataset text := lower(btrim(coalesce(p_dataset_key, '')));
  meta jsonb;
  fingerprint text;
  stage private.fast_erp_stage_runs_v1%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FAST_ERP_STAGE_FORBIDDEN';
  end if;
  if v_dataset not in ('drive_around', 'soc', 'reserves', 'cav')
     or p_expected_rows is null or p_expected_rows < 1 or p_expected_rows > 100000 then
    raise exception using errcode = '22023', message = 'FAST_ERP_STAGE_INPUT_INVALID';
  end if;
  meta := private.fast_erp_file_meta_v2369(p_file_meta);
  if coalesce(meta->>'content_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'ERP_PENDING_CONTENT_HASH_REQUIRED';
  end if;
  if p_file_meta->>'expected_rows_pending' = 'true' then
    if p_expected_rows <> (case when v_dataset = 'soc' then 100000 else 50000 end) then
      raise exception 'FAST_ERP_STAGE_CAPACITY_INVALID';
    end if;
    meta := meta || jsonb_build_object('expected_rows_pending', true);
  end if;
  meta := meta || jsonb_build_object('manual_pending', true);
  if p_file_meta ? 'sync_run_id' then
    if not exists(select 1 from private.erp_sync_jobs j where j.run_id=(p_file_meta->>'sync_run_id')::uuid and j.active)
      then raise exception 'ERP_PENDING_RUN_INACTIVE'; end if;
    meta:=meta||jsonb_build_object('sync_run_id',(p_file_meta->>'sync_run_id')::uuid);
  end if;
  fingerprint := encode(extensions.digest(convert_to(v_dataset || '|' || (meta->>'file_id') || '|'
    || (meta->>'file_name') || '|' || (meta->>'modified_at') || '|'
    || (meta->>'content_hash') || '|' || p_expected_rows::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('fast-erp-stage:' || fingerprint, 0));
  select * into stage from private.fast_erp_stage_runs_v1 r
    where r.dataset_key = v_dataset and r.source_fingerprint = fingerprint for update;
  if stage.stage_id is null then
    insert into private.fast_erp_stage_runs_v1(dataset_key, file_meta, source_fingerprint, expected_rows)
      values (v_dataset, meta, fingerprint, p_expected_rows) returning * into stage;
  elsif (stage.file_meta - array['manual_pending','sync_run_id']) is distinct from (meta - array['manual_pending','sync_run_id']) or
      (stage.expected_rows <> p_expected_rows and coalesce(meta->>'expected_rows_pending', 'false') <> 'true') then
    raise exception using errcode = '22023', message = 'FAST_ERP_STAGE_SOURCE_CONFLICT';
  end if;
  if stage.stage_state = 'committed' then
    if stage.committed_result is null or coalesce((stage.committed_result->>'ok')::boolean, false) is not true
       or coalesce((stage.committed_result->>'skip')::boolean, false) is true
       or coalesce((stage.committed_result->>'source_rows')::integer, 0) < 1
       or stage.expected_rows < 1 or stage.staged_rows <> stage.expected_rows then
      raise exception 'ERP_PENDING_RECEIPT_UNCONFIRMED';
    end if;
    return jsonb_build_object('ok', true, 'committed', true, 'stage_id', stage.stage_id,
      'expected_rows', stage.expected_rows, 'receipt', stage.committed_result);
  end if;
  if stage.stage_state <> 'staging' then raise exception 'ERP_PENDING_STAGE_NOT_RESUMABLE'; end if;
  if stage.file_meta is distinct from meta then
    update private.fast_erp_stage_runs_v1 set file_meta = meta where stage_id = stage.stage_id;
  end if;
  if stage.expires_at <= clock_timestamp() then
    update private.fast_erp_stage_runs_v1 set expires_at = clock_timestamp() + interval '24 hours'
      where stage_id = stage.stage_id;
  end if;
  return jsonb_build_object('ok', true, 'committed', false, 'stage_id', stage.stage_id,
    'expected_rows', stage.expected_rows, 'staged_rows', stage.staged_rows, 'status', stage.stage_state);
end
$function$;
revoke all on function public.begin_pending_erp_stage_v3070(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.begin_pending_erp_stage_v3070(text, jsonb, integer) to service_role;

alter table public.app_dataset_revisions add column if not exists last_checked_at timestamptz;
create or replace function public.record_erp_stage_checked_v3070(
  p_run_id uuid, p_worker_id uuid, p_stage_key text
) returns jsonb language plpgsql security definer
set search_path = '' set statement_timeout = '5s' set lock_timeout = '250ms'
as $function$
declare
  revision_key text;
  checked_at timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'ERP_SYNC_WORKER_FORBIDDEN';
  end if;
  revision_key := case p_stage_key
    when 'drive' then 'ph_master_inventory' when 'cav' then 'ph_cav_import'
    when 'reserves' then 'ph_reserves' when 'soc' then 'ph_soc_master'
    when 'hl_po_parsed' then 'hl_po_parsed' else null end;
  if revision_key is null then raise exception 'ERP_SYNC_STAGE_INVALID'; end if;
  perform public.assert_erp_sync_worker_v1(p_run_id, p_worker_id);
  update public.app_dataset_revisions set last_checked_at = checked_at where key = revision_key;
  if not found then raise exception 'ERP_SYNC_REVISION_MISSING'; end if;
  return jsonb_build_object('ok', true, 'key', p_stage_key, 'last_checked_at', checked_at);
end
$function$;
revoke all on function public.record_erp_stage_checked_v3070(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_erp_stage_checked_v3070(uuid, uuid, text) to service_role;

do $patch$
declare definition text; changed text;
begin
  select pg_get_functiondef('public.check_erp_file_sync_needed_v1(text,text,text,text,text)'::regprocedure) into definition;
  changed := replace(definition, '  if incoming_order < active_order then',
    '  if current_setting(''agdata.erp.manual_pending'',true) = ''on'' then' || E'\n' ||
    '    return jsonb_build_object(''skip'',false,''up_to_date'',false,''dataset_key'',revision_key);' || E'\n' ||
    '  end if;' || E'\n' || '  if incoming_order < active_order then');
  if changed = definition then raise exception 'ERP_PENDING_CHECK_PATCH_ANCHOR_MISSING'; end if;
  execute changed;

  select pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure) into definition;
  changed := replace(definition, 'declare stage private.fast_erp_stage_runs_v1%rowtype;',
    'declare previous_manual_pending text; previous_sync_job text; stage private.fast_erp_stage_runs_v1%rowtype;');
  if changed = definition then raise exception 'ERP_PENDING_COMMIT_DECLARE_ANCHOR_MISSING'; end if;
  definition := changed;
  changed := replace(definition, '  update private.fast_erp_stage_runs_v1 set stage_state=''committing'' where stage_id=p_stage_id;',
    '  previous_manual_pending := coalesce(current_setting(''agdata.erp.manual_pending'',true),'''');' || E'\n' ||
    '  previous_sync_job := coalesce(current_setting(''agdata.erp.sync_job_v3070'',true),'''');' || E'\n' ||
    '  perform set_config(''agdata.erp.sync_job_v3070'',coalesce(stage.file_meta->>''sync_run_id'',''''),true);' || E'\n' ||
    '  perform set_config(''agdata.erp.manual_pending'',case when stage.file_meta->>''manual_pending''=''true'' then ''on'' else ''off'' end,true);' || E'\n' ||
    '  update private.fast_erp_stage_runs_v1 set stage_state=''committing'' where stage_id=p_stage_id;');
  if changed = definition then raise exception 'ERP_PENDING_COMMIT_ENTER_ANCHOR_MISSING'; end if;
  definition := changed;
  changed := replace(definition, '  perform set_config(''agdata.erp.prepared_drive'',previous_prepared,true);',
    '  perform set_config(''agdata.erp.manual_pending'',previous_manual_pending,true);' || E'\n' ||
    '  perform set_config(''agdata.erp.sync_job_v3070'',previous_sync_job,true);' || E'\n' ||
    '  perform set_config(''agdata.erp.prepared_drive'',previous_prepared,true);');
  if changed = definition then raise exception 'ERP_PENDING_COMMIT_EXIT_ANCHOR_MISSING'; end if;
  execute changed;
end
$patch$;

commit;
