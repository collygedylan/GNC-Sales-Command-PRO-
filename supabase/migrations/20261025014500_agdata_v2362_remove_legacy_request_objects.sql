begin;

set local statement_timeout='30s';
set local lock_timeout='5s';

drop trigger if exists ph_request_delivery_outbox_sales_impact_ledger_v1 on public.ph_request_delivery_outbox;
drop trigger if exists ph_request_queue_removal_sales_impact_ledger_v1 on private.ph_request_queue_removal_commands;
drop trigger if exists ph_active_request_sales_impact_ledger_v1 on public.ph_requests_pending;
drop trigger if exists ph_request_history_sales_impact_ledger_v1 on public.ph_requests_completed_history;
drop trigger if exists request_financial_capture_v1 on public.ph_requests_pending;
drop trigger if exists request_financial_capture_v1 on public.ph_requests_completed_history;

drop view if exists public.ph_request_queue_live_rows;
drop view if exists public.ph_active_request_live_rows;
drop view if exists public.ph_request_sales_impact_lines_v1;
drop view if exists public.ph_request_sales_impact_by_rep;
drop view if exists public.ph_request_sales_impact_by_customer_consignee;
drop view if exists public.ph_request_sales_impact_by_sales_rep_v1;
drop view if exists public.ph_request_sales_impact_by_customer_consignee_v1;
drop view if exists public.ph_active_request;
drop view if exists public.ph_request_history;

drop table if exists public.ph_request_sales_impact_ledger cascade;
drop table if exists private.request_financial_values_v1 cascade;
drop table if exists private.folder_delivery cascade;

drop function if exists private.block_request_sales_impact_ledger_delete_v1();
drop function if exists private.refresh_request_sales_impact_line_v1(text);
drop function if exists private.upsert_request_sales_impact_outbox_line_v1(jsonb,text,timestamptz);
drop function if exists private.request_sales_impact_source_trigger_v1();
drop function if exists private.request_sales_impact_outbox_trigger_v1();
drop function if exists private.request_sales_impact_removal_trigger_v1();
drop function if exists private.capture_request_financial_v1();
drop function if exists private.request_sales_price_v2360(text,text,text,text);
drop function if exists private.upsert_request_sales_impact_source_v2361(text,text,integer,jsonb,timestamptz,text,text);

delete from public.app_dataset_revisions where key in (
  'ph_active_request','ph_active_request_live_rows','ph_request_queue_live_rows',
  'ph_request_history','ph_request_sales_impact_ledger'
);
delete from app_sync_private.sources where key in (
  'ph_active_request','ph_active_request_live_rows','ph_request_queue_live_rows',
  'ph_request_history','ph_request_sales_impact_ledger'
);

do $verify$
declare pending_count bigint;
declare completed_count bigint;
declare completed_total numeric;
begin
  if to_regclass('public.ph_master_inventory') is null
    or to_regclass('public.ph_requests_pending') is null
    or to_regclass('public.ph_requests_completed_history') is null then
    raise exception 'CANONICAL_THREE_TABLE_CONTRACT_MISSING';
  end if;
  if to_regclass('private.ph_request_folder_delivery_state') is null then
    raise exception 'REQUEST_FOLDER_DELIVERY_STATE_MISSING';
  end if;
  if to_regclass('public.ph_active_request') is not null
    or to_regclass('public.ph_active_request_live_rows') is not null
    or to_regclass('public.ph_request_queue_live_rows') is not null
    or to_regclass('public.ph_request_history') is not null
    or to_regclass('public.ph_request_sales_impact_ledger') is not null
    or to_regclass('private.request_financial_values_v1') is not null
    or to_regclass('private.folder_delivery') is not null then
    raise exception 'LEGACY_REQUEST_OBJECT_REMAINED';
  end if;
  if exists(select 1 from public."00_app_view_table_map" mapping
    cross join unnest(mapping.source_tables) source_table
    where source_table in ('public.ph_active_request','public.ph_active_request_live_rows',
      'public.ph_request_queue_live_rows','public.ph_request_history',
      'public.ph_request_sales_impact_ledger','public.ph_request_sales_impact_lines_v1')) then
    raise exception 'APP_VIEW_TABLE_MAP_STALE';
  end if;
  if exists(select 1 from pg_proc procedure_row join pg_namespace namespace_row
    on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname in ('public','private','app_sync_private')
      and procedure_row.prosrc ~ 'ph_(active_request|active_request_live_rows|request_queue_live_rows|request_history|request_sales_impact_ledger)') then
    raise exception 'LEGACY_REQUEST_FUNCTION_REFERENCE_REMAINED';
  end if;
  if exists(select 1 from information_schema.tables where table_schema='archive_backup' and table_type='BASE TABLE') then
    raise exception 'ARCHIVE_BACKUP_NOT_EMPTY';
  end if;
  select count(*) into pending_count from public.ph_requests_pending
    where move_batch_id is null and date_completed is null;
  select count(*),round(coalesce(sum(line_dollar_value),0),2)
    into completed_count,completed_total from public.ph_requests_completed_history;
  if pending_count<1 or pending_count>25 then raise exception 'PENDING_REQUEST_COUNT_INVALID: %',pending_count; end if;
  if completed_count<4059 then raise exception 'COMPLETED_REQUEST_COUNT_LOW: %',completed_count; end if;
  if completed_total<6067786.53 then raise exception 'COMPLETED_REQUEST_TOTAL_LOW: %',completed_total; end if;
  raise notice 'AGDATA_V2362_CLEAN pending=% completed=% completed_total=%',
    pending_count,completed_count,completed_total;
end
$verify$;

select pg_notify('pgrst','reload schema');

commit;
