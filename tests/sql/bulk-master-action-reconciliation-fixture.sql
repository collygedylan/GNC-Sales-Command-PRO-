do $proof$
declare
  uid text:='GNC_BULK_BENCH_ACTION_CONTRACT';
  run_id uuid:='00000000-0000-4000-8000-000000003079';
  baseline jsonb:=jsonb_build_object('unique_id',uid,'itemcode','CI-BULK-ACTION','commonname','Original name',
    'locationcode','A.01','lotcode','27.F1','holdstopcode','H','holdstopreason','ERP hold');
  app_row jsonb:=baseline||'{"holdstopcode":"APP_HOLD","holdstopreason":"Supervisor hold"}'::jsonb;
  report jsonb:=baseline||'{"commonname":"Changed report name"}'::jsonb;
  patch jsonb; v_action_id bigint; receipt public.ph_action_discrepancies;
begin
  perform private.capture_action_v3070(baseline,app_row,'bulk_contract_fixture');
  select id into strict v_action_id from public.app_row_actions where canonical_unique_id=uid;
  patch:=private.reconcile_action_row_v3070(uid,baseline,'Baseline.xlsx',run_id);
  if patch->>'holdstopcode'<>'APP_HOLD' or patch->>'holdstopreason'<>'Supervisor hold'
    or (select reconciliation_status from public.app_row_actions where id=v_action_id)<>'pending'
    or exists(select 1 from public.ph_action_discrepancies where action_id=v_action_id and itemcode='CI-BULK-ACTION')
    then raise exception 'BULK_BASELINE_MUST_PRESERVE_PENDING_APP_HOLD'; end if;
  patch:=private.reconcile_action_row_v3070(uid,report,'Changed.xlsx',run_id);
  select d.* into strict receipt from public.ph_action_discrepancies d where d.action_id=v_action_id;
  if patch->>'holdstopcode'<>'H' or patch->>'holdstopreason'<>'ERP hold'
    or receipt.app_update_row->>'holdstopcode'<>'APP_HOLD'
    or receipt.report_update_row->>'holdstopcode'<>'H' or receipt.import_run_id<>run_id
    or not receipt.discrepancy_diff @> '[{"field":"holdstopcode","app_expected_value":"APP_HOLD","report_actual_value":"H"}]'
    or not exists(select 1 from public.app_row_actions a where a.id=v_action_id
      and a.reconciliation_status='discrepant' and a.absorbed_by_erp and a.sync_run_id=run_id)
    then raise exception 'BULK_CHANGED_REPORT_REQUIRES_LOSSLESS_DISCREPANCY'; end if;
  perform private.reconcile_action_row_v3070(uid,report,'Changed.xlsx',run_id);
  if (select count(*) from public.ph_action_discrepancies d where d.action_id=v_action_id)<>1
    then raise exception 'BULK_DISCREPANCY_REPLAY_MUST_BE_IDEMPOTENT'; end if;
  uid:=uid||'_MATCHED'; baseline:=baseline||jsonb_build_object('unique_id',uid);
  app_row:=app_row||jsonb_build_object('unique_id',uid);
  perform private.capture_action_v3070(baseline,app_row,'bulk_contract_fixture');
  patch:=private.reconcile_action_row_v3070(uid,app_row,'Acknowledged.xlsx',run_id);
  if patch->>'holdstopcode'<>'APP_HOLD' or not exists(select 1 from public.app_row_actions a
    where a.canonical_unique_id=uid and a.reconciliation_status='matched' and a.absorbed_by_erp)
    then raise exception 'BULK_EXACT_APP_ACKNOWLEDGEMENT_MUST_MATCH'; end if;
end $proof$;
select 'BULK_ACTION_RECONCILIATION_PASS' as result;
