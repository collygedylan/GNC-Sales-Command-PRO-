export const watchdogRpcRecoveryMigration = '20261111160000_agdata3072_watchdog_rpc_recovery.sql';
export const watchdogRequestReceiptIndexMigration = '20261111160001_agdata3072_request_receipt_index.sql';

export function watchdogRpcRecoveryInstalled() {
    return `select coalesce(
      position('pg_try_advisory_xact_lock' in pg_get_functiondef(unlock_rpc))=0
      and position('DRIVE_ROW_STALE' in pg_get_functiondef(unlock_rpc))=0
      and position('private.inventory_row_assigned_to_actor_v2392' in pg_get_functiondef(unlock_rpc))>0
      and (select proconfig @> array['lock_timeout=8s','statement_timeout=12s'] from pg_proc where oid=unlock_rpc)
      and not has_function_privilege('anon',unlock_rpc,'EXECUTE')
      and has_function_privilege('authenticated',unlock_rpc,'EXECUTE'),false) as installed
      from (select to_regprocedure('public.unlock_drive_evidence_v1(text,text)') as unlock_rpc) rpc`;
}

export function watchdogRequestReceiptIndexInstalled() {
    return `select coalesce((select indisvalid and indisready and indpred is null
      and indrelid='public.ph_requests_completed_history'::regclass
      from pg_index where indexrelid=to_regclass('public.ph_request_history_batch_v3072')),false) as installed`;
}
