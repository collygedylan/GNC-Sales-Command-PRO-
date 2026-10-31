-- Run only inside a transaction that is rolled back; never publishes a dataset or sends delivery.
do $proof$
<<sqlTest>>
declare stamp timestamptz:='2026-10-30T12:00:00Z'; status jsonb; run_id uuid; result record;
  sample jsonb:='[{"warehouseid":"__V23120_PROOF__","transactionnumber":"proof","consigneeidentityid":"proof","itemcode":"__V23120_PROOF__","dock":"proof","quantityordered":10}]';
begin
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"order_history"}',stamp,stamp);
  if status->>'active'<>'false' or status->>'percent'<>'100' then raise exception 'Retired history recovery failed'; end if;
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"drive"}',stamp,stamp+interval '91 seconds');
  if status->>'active'<>'false' then raise exception 'Stalled progress recovery failed'; end if;
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"drive"}',stamp,stamp+interval '89 seconds');
  if status->>'active'<>'true' then raise exception 'Fresh operational job must stay active'; end if;
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"hl_po_parsed","stageResults":[{"key":"drive","outcome":"UP_TO_DATE"},{"key":"cav","outcome":"UP_TO_DATE"},{"key":"reserves","outcome":"UP_TO_DATE"},{"key":"soc","outcome":"UP_TO_DATE"}]}',stamp,stamp);
  if status->>'active'<>'true' then raise exception 'Four stages cannot complete a five-source run'; end if;
  status:=private.operational_erp_status_v23120(jsonb_set(status,'{stageResults}',status->'stageResults'||'[{"key":"hl_po_parsed","outcome":"UP_TO_DATE"}]'),stamp,stamp);
  if status->>'active'<>'false' or status->>'percent'<>'100' then raise exception 'Five-source completion failed'; end if;
  select active_run_id into run_id from private.ph_eval_item_low_stock_import_state where singleton;
  if exists(select 1 from private.ph_eval_item_low_stock_target_stats where itemcode_normalized='__V23120_PROOF__') then raise exception 'Proof identity is not isolated'; end if;
  perform private.fold_soc_average_orders_v23120('{"modified_at":"2026-10-30T12:00:00Z"}',sample);
  perform private.fold_soc_average_orders_v23120('{"modified_at":"2026-10-30T12:00:00Z"}',sample);
  select * into strict result from private.ph_eval_item_low_stock_target_stats where itemcode_normalized='__V23120_PROOF__' and ph_eval_item_low_stock_target_stats.run_id=sqlTest.run_id;
  if result.qualifying_line_count<>1 or result.mean_quantity<>10 then raise exception 'SOC replay counted twice'; end if;
  perform private.fold_soc_average_orders_v23120('{"modified_at":"2026-10-30T13:00:00Z"}',jsonb_set(sample,'{0,quantityordered}','20'));
  perform private.fold_soc_average_orders_v23120('{"modified_at":"2026-10-31T12:00:00Z"}',jsonb_set(sample,'{0,quantityordered}','30'));
  select * into strict result from private.ph_eval_item_low_stock_target_stats where itemcode_normalized='__V23120_PROOF__' and ph_eval_item_low_stock_target_stats.run_id=sqlTest.run_id;
  if result.qualifying_line_count<>2 or result.mean_quantity<>25 or result.p75_quantity<>30 or result.suggested_qty<>55 then raise exception 'Daily SOC average semantics failed'; end if;
end $proof$;
