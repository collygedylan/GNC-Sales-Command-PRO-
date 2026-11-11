function actionDiscrepanciesInstalled() {
  return `select coalesce((
    select count(*) = 3 and bool_and(relrowsecurity)
      and bool_and(not has_table_privilege('authenticated',oid,'SELECT'))
      and bool_and(not has_table_privilege('anon',oid,'SELECT'))
    from pg_class where oid in (to_regclass('public.app_row_actions'),
      to_regclass('public.ph_action_learning_rules'),to_regclass('public.ph_action_discrepancies')))
    and has_function_privilege('service_role',manager_rpc,'EXECUTE')
    and not has_function_privilege('authenticated',manager_rpc,'EXECUTE')
    and not has_function_privilege('anon',manager_rpc,'EXECUTE')
    and strpos(pg_get_functiondef(to_regprocedure('private.reconcile_inventory_live_overrides_v1()')),
      'private.capture_action_v3070') > 0
    and strpos(pg_get_functiondef(to_regprocedure('private.apply_inventory_live_overrides_bulk_v1(uuid)')),
      'private.publish_actions_v3070') > 0, false) as installed
    from (select to_regprocedure('public.manager_action_discrepancies_v3070(uuid,text,jsonb)') as manager_rpc) rpc`;
}

function erpStagePublicationInstalled() {
  return `select coalesce(exists(select 1 from pg_attribute
      where attrelid=to_regclass('public.app_dataset_revisions') and attname='last_checked_at'
      and atttypid='timestamptz'::regtype and not attisdropped)
    and has_function_privilege('service_role',stage_rpc,'EXECUTE')
    and has_function_privilege('service_role',checked_rpc,'EXECUTE')
    and not has_function_privilege('anon',stage_rpc,'EXECUTE')
    and not has_function_privilege('authenticated',stage_rpc,'EXECUTE')
    and not has_function_privilege('anon',checked_rpc,'EXECUTE')
    and not has_function_privilege('authenticated',checked_rpc,'EXECUTE')
    and strpos(pg_get_functiondef(stage_rpc),'ERP_PENDING_RECEIPT_UNCONFIRMED') > 0
    and strpos(pg_get_functiondef(checked_rpc),'public.assert_erp_sync_worker_v1') > 0
    and strpos(pg_get_functiondef(to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid)')),
      'agdata.erp.sync_job_v3070') > 0, false) as installed
    from (select to_regprocedure('public.begin_pending_erp_stage_v3070(text,jsonb,integer)') as stage_rpc,
      to_regprocedure('public.record_erp_stage_checked_v3070(uuid,uuid,text)') as checked_rpc) rpc`;
}

export const erpPendingDropContracts = [
  ['20261111120000_agdata3070_action_discrepancies.sql', actionDiscrepanciesInstalled],
  ['20261111120001_agdata3070_erp_stage_publication.sql', erpStagePublicationInstalled]
];
