begin;
set local lock_timeout='1s';
set local statement_timeout='15s';
-- Run only inside a transaction that is rolled back; never publishes a dataset or sends delivery.
do $proof$
<<sqlTest>>
declare stamp timestamptz:='2026-10-30T12:00:00Z'; status jsonb; run_id uuid; result record; proof_job uuid:=gen_random_uuid();
  sample jsonb:='[{"warehouseid":"__V23120_PROOF__","transactionnumber":"proof","consigneeidentityid":"proof","itemcode":"__V23120_PROOF__","dock":"proof","quantityordered":10}]';
begin
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"order_history"}',stamp,stamp);
  if status->>'active'<>'true' then raise exception 'Retired history with unchecked sources must continue'; end if;
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"drive"}',stamp,stamp+interval '91 seconds');
  if status->>'active'<>'true' then raise exception 'Stale progress must remain resumable'; end if;
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"drive"}',stamp,stamp+interval '89 seconds');
  if status->>'active'<>'true' then raise exception 'Fresh operational job must stay active'; end if;
  status:=private.operational_erp_status_v23120('{"active":true,"currentStage":"hl_po_parsed","stageResults":[{"key":"drive","outcome":"UP_TO_DATE"},{"key":"cav","outcome":"UP_TO_DATE"},{"key":"reserves","outcome":"UP_TO_DATE"},{"key":"soc","outcome":"UP_TO_DATE"}]}',stamp,stamp);
  if status->>'active'<>'true' then raise exception 'Four stages cannot complete a five-source run'; end if;
  status:=private.operational_erp_status_v23120(jsonb_set(status,'{stageResults}',status->'stageResults'||'[{"key":"hl_po_parsed","outcome":"UP_TO_DATE"}]'),stamp,stamp);
  if status->>'active'<>'false' or status->>'percent'<>'100' then raise exception 'Five-source completion failed'; end if;
  status:=private.operational_erp_status_v23120('{"active":true,"status":"running","sourceProgress":{"drive":{"fileName":"proof.xlsx","publishedFileName":"proof.xlsx","publicationConfirmed":true,"rowsPublished":9498,"stage":"publishing","percent":95}}}',stamp,stamp+interval '147 seconds');
  if status->>'active'<>'true' or status->>'percent'<>'20' then raise exception 'A 147-second committed Drive stage cannot complete four unchecked sources'; end if;
  insert into private.fast_erp_stage_runs_v1(dataset_key,file_meta,source_fingerprint,expected_rows) values('soc','{}','__V23121_SOC_PROOF__',52000);
  begin insert into private.fast_erp_stage_runs_v1(dataset_key,file_meta,source_fingerprint,expected_rows) values('drive_around','{}','__V23121_DRIVE_PROOF__',52000);raise exception 'Drive row bound was weakened';exception when check_violation then null;end;
  if position('workerActive' in pg_get_functiondef('public.get_erp_sync_status_v1()'::regprocedure))=0 or position('leaseExpired' in pg_get_functiondef('public.get_my_erp_sync_progress_v23116()'::regprocedure))=0 then raise exception 'Lease recovery projection missing';end if;
  insert into private.erp_sync_jobs(run_id,command_id,requested_by,active,status,started_at) values(proof_job,proof_job::text,'__V23121_PROOF__',true,jsonb_build_object('runId',proof_job,'active',true,'status','running','currentStage','drive','stageIndex',0,'stageResults','[]'::jsonb,'sourceProgress',status->'sourceProgress'),clock_timestamp()-interval '147 seconds');
  select j.status into status from private.erp_sync_jobs j where j.run_id=proof_job;
  if status->>'active'<>'true' or status->>'percent'<>'20' or not status->'sourceProgress'->'cav' ? 'lastPublishedRows' then raise exception 'Healthy publication/metadata trigger failed';end if;
  update private.erp_sync_jobs j set request_lease_until=clock_timestamp()+interval '4 seconds',updated_at=clock_timestamp() where j.run_id=proof_job;
  status:=public.get_erp_sync_status_v1();if status->>'workerActive'<>'true' or status->>'leaseExpired'<>'false' then raise exception 'Healthy lease projection failed';end if;
  update private.erp_sync_jobs j set active=false,status=j.status||'{"status":"complete","active":false,"percent":100}' where j.run_id=proof_job;
  select j.status into status from private.erp_sync_jobs j where j.run_id=proof_job;if status->>'active'<>'true' or status->>'percent'<>'20' then raise exception 'Incomplete terminal write was not rejected';end if;
  update private.erp_sync_jobs j set active=false,status=j.status||'{"status":"failed","active":false,"percent":100}' where j.run_id=proof_job;
  select j.status into status from private.erp_sync_jobs j where j.run_id=proof_job;if status->>'active'<>'false' or status->>'percent'<>'20' then raise exception 'A failed run cannot force 100 percent';end if;
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

rollback;
