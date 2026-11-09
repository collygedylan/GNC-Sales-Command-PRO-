begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table if not exists private.history_reader_rewire_receipts_v3039 (
  function_id oid primary key,
  original_digest text not null,
  rewritten_digest text not null,
  preserved_contract jsonb not null,
  installed_at timestamptz not null default clock_timestamp()
);
revoke all on private.history_reader_rewire_receipts_v3039 from public,anon,authenticated,service_role;

create or replace function private.snapshot_function_contract_v3039(p_function oid)
returns jsonb language sql stable set search_path='' as $function$
  select jsonb_build_object('owner',proowner,'return_type',prorettype,'arguments',proargtypes::text,
    'security_definer',prosecdef,'volatility',provolatile,'parallel',proparallel,
    'strict',proisstrict,'leakproof',proleakproof,'configuration',proconfig,'grants',proacl::text)
  from pg_proc where oid=p_function
$function$;

create or replace function private.rewire_snapshot_function_v3039(p_function oid)
returns void language plpgsql security definer set search_path='' as $function$
declare original text; rewritten text; inverse text; expected text; contract jsonb;
begin
  original:=pg_get_functiondef(p_function);
  contract:=private.snapshot_function_contract_v3039(p_function);
  rewritten:=private.rewrite_snapshot_reads_v3039(original,'ph_drive_around_report_rows','ph_drive_around_report_rows_snapshot_v3039');
  rewritten:=private.rewrite_snapshot_reads_v3039(rewritten,'ph_hold_stop_itemcode_snapshots','ph_hold_stop_itemcode_snapshots_snapshot_v3039');
  if rewritten=original then return; end if;
  -- The older hash helper accepts the physical composite type. Preserve that
  -- type explicitly when its row now originates from the compatible view.
  rewritten:=regexp_replace(rewritten,'(private[.]drive_around_report_state_hash_v2366\()([a-z_][a-z_0-9]*)(\))',
    '\1ROW(\2.*)::public.ph_drive_around_report_rows\3','gi');
  expected:=regexp_replace(original,'(private[.]drive_around_report_state_hash_v2366\()([a-z_][a-z_0-9]*)(\))',
    '\1ROW(\2.*)::public.ph_drive_around_report_rows\3','gi');
  inverse:=replace(rewritten,'public.ph_drive_around_report_rows_snapshot_v3039','public.ph_drive_around_report_rows');
  inverse:=replace(inverse,'public.ph_hold_stop_itemcode_snapshots_snapshot_v3039','public.ph_hold_stop_itemcode_snapshots');
  if inverse<>expected then raise exception 'HISTORY_READER_REWRITE_NOT_REFERENCE_ONLY'; end if;
  execute rewritten;
  if private.snapshot_function_contract_v3039(p_function)<>contract then
    raise exception 'HISTORY_READER_CONTRACT_CHANGED';
  end if;
  insert into private.history_reader_rewire_receipts_v3039(function_id,original_digest,rewritten_digest,preserved_contract)
    values(p_function,md5(original),md5(pg_get_functiondef(p_function)),contract)
  on conflict(function_id) do update set original_digest=excluded.original_digest,
    rewritten_digest=excluded.rewritten_digest,preserved_contract=excluded.preserved_contract,installed_at=clock_timestamp();
end
$function$;

do $rewire_known_readers$
declare target record;
begin
  for target in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname||'.'||p.proname)=any(array[
      'private.historical_drive_file_page_v2367','public.get_historical_inventory_rows',
      'public.historical_archive_read_v1','public.historical_archive_read_v2',
      'public.ph_refresh_hold_learning_itemcode_batch','public.ph_refresh_hold_learning_summary_batch',
      'public.ph_refresh_hold_stop_itemcode_cycles_fast','public.ph_refresh_hold_stop_itemcode_summaries',
      'public.smart_hold_context_v23127','public.v2_refresh_hold_stop_itemcode_episode_learning',
      'public.ph_prepare_hold_learning_refresh_chunked','public.v2_refresh_hold_learning_from_drive_around_rows',
      'public.v2_refresh_hold_learning_from_drive_around_rows_range'])
  loop
    perform private.rewire_snapshot_function_v3039(target.oid);
  end loop;
end
$rewire_known_readers$;

revoke all on function private.snapshot_function_contract_v3039(oid) from public,anon,authenticated,service_role;
revoke all on function private.rewire_snapshot_function_v3039(oid) from public,anon,authenticated,service_role;
commit;
