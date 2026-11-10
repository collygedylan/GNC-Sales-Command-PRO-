-- Run after installing the deferred order history migration in a rolled-back local transaction.
create temporary table ph_soc_master (
  unique_id text, itemcode text, transactionnumber text, filename text, last_updated timestamptz, source text
);
create temporary table ph_reserves (like ph_soc_master);
insert into ph_soc_master values
  ('order-fixture-3046','SOC-3046.1','100046','soc-original-3046.xlsx','2026-11-09T17:00:00Z',null),
  ('order-fixture-3046-named','SOC-3046.2','100047','soc-original-3046.xlsx','2026-11-09T17:00:00Z','PH');
insert into ph_reserves values
  ('order-fixture-3046','RESERVE-3046.1','200046','reserve-original-3046.xlsx','2026-11-09T17:00:00Z',null),
  ('order-fixture-3046-named','RESERVE-3046.2','200047','reserve-original-3046.xlsx','2026-11-09T17:00:00Z','PH');

do $test$
declare
  definition text := pg_get_functiondef('private.freeze_erp_order_history_rows_v3046(text,text)'::regprocedure);
  drained integer;
begin
  execute replace(definition,'from public.%I source','from pg_temp.%I source');
  if private.freeze_erp_order_history_rows_v3046('ph_reserves','reserve-file-fixture-3046')<>2
    or private.freeze_erp_order_history_rows_v3046('ph_soc_master','soc-file-fixture-3046')<>2 then
    raise exception 'ERP_ORDER_HISTORY_FREEZE_FIXTURE_FAILED';
  end if;
  if (select count(*) from private.erp_order_history_rows_v3046
      where file_id in ('soc-file-fixture-3046','reserve-file-fixture-3046')
        and jsonb_typeof(source_row)='object' and source_row->>'unique_id'=source_uid
        and ((source_uid='order-fixture-3046' and source_row->'source'='null'::jsonb)
          or (source_uid='order-fixture-3046-named' and source_row->>'source'='PH')))<>4 then
    raise exception 'ERP_ORDER_HISTORY_SNAPSHOT_BOUND_SCALAR_SOURCE';
  end if;
  update ph_soc_master set itemcode='LATER-SOC';
  update ph_reserves set itemcode='LATER-RESERVE';
  if private.freeze_erp_order_history_rows_v3046('ph_soc_master','soc-file-fixture-3046')<>0 then
    raise exception 'ERP_ORDER_HISTORY_IDEMPOTENT_FREEZE_FIXTURE_FAILED';
  end if;
  drained:=private.drain_erp_order_history_v3046();
  if drained<>4 then
    raise exception 'ERP_ORDER_HISTORY_EXACT_DRAIN_FIXTURE_FAILED';
  end if;
  if not exists(select 1 from public.ph_orders_history where source_unique_id='order-fixture-3046'
      and source_file_name='soc-original-3046.xlsx' and itemcode='SOC-3046.1')
    or not exists(select 1 from public.ph_reserves_history where source_unique_id='order-fixture-3046'
      and source_file_name='reserve-original-3046.xlsx' and itemcode='RESERVE-3046.1')
    or not exists(select 1 from public.ph_orders_history where source_unique_id='order-fixture-3046-named'
      and source_file_name='soc-original-3046.xlsx' and itemcode='SOC-3046.2')
    or not exists(select 1 from public.ph_reserves_history where source_unique_id='order-fixture-3046-named'
      and source_file_name='reserve-original-3046.xlsx' and itemcode='RESERVE-3046.2') then
    raise exception 'ERP_ORDER_HISTORY_FROZEN_SOURCE_FIXTURE_FAILED';
  end if;
end
$test$;
