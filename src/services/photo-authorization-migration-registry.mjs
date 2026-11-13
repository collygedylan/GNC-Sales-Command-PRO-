import { suspendOrderReceiptMigrationName, suspendOrderReceiptMigrationContract } from './suspend-order-migration-registry.mjs';

export const photoAuthorizationMigrationName='20261111173946_photo_request_table_authorization.sql';
export const accessDefaultsWatchdogMigrationName='20261111174727_access_defaults_watchdog_read.sql';
export const photoUploadServiceMigrationName='20261111181931_photo_upload_service_authority.sql';
export const photoAuthorizationMigrationNames=[photoAuthorizationMigrationName,accessDefaultsWatchdogMigrationName,photoUploadServiceMigrationName,suspendOrderReceiptMigrationName];

export function photoAuthorizationMigrationContract(name) {
    if (name===photoUploadServiceMigrationName) return photoUploadServiceContract();
    if (name===accessDefaultsWatchdogMigrationName) return accessDefaultsWatchdogContract();
    if (name!==photoAuthorizationMigrationName) return suspendOrderReceiptMigrationContract(name);
    return `SELECT
      to_regprocedure('private.current_evidence_actor_v3074()') IS NOT NULL
      AND to_regprocedure('private.can_work_request_row_v3074(jsonb)') IS NOT NULL
      AND position('inventory_unrestricted_actor' IN pg_get_functiondef(
        'private.require_drive_live_change_profile_v2392(text,text,text,text)'::regprocedure))=0
      AND position('ph_requests_pending' IN pg_get_functiondef(
        'private.require_drive_live_change_profile_v2392(text,text,text,text)'::regprocedure))>0
      AND NOT has_function_privilege('anon','private.can_work_request_row_v3074(jsonb)','EXECUTE')
      AND NOT has_function_privilege('authenticated','private.current_evidence_actor_v3074()','EXECUTE')
      AND (SELECT count(*)=2 FROM pg_policies
        WHERE schemaname='storage' AND tablename='objects'
          AND policyname IN ('photo_evidence_insert_guard_v3074','photo_evidence_update_guard_v3074')
          AND permissive='RESTRICTIVE' AND roles=ARRAY['anon','authenticated']::name[]
          AND with_check LIKE '%can_write_photo_object_v3074%')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('save_request_work','save_request_work_pre_state_machine_v2359',
          'request_work_command_v1','request_work_command_v1_pre_state_machine_v2359','request_completion_receipt_v2372')
          AND (position('can_work_request_row_v3074' IN p.prosrc)=0 OR position('can_work_request_identity' IN p.prosrc)>0))
      AND (SELECT value->>'app_version'='3.0.74' FROM public.ph_app_settings WHERE key='app_version')
      AS installed`;
}

function photoUploadServiceContract() {
    return `SELECT
      to_regprocedure('public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint)') IS NOT NULL
      AND NOT has_function_privilege('anon','public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint)','EXECUTE')
      AND has_function_privilege('service_role','public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint)','EXECUTE')
      AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.authorize_photo_upload_v3074(uuid,text,text,jsonb,uuid,bigint)'::regprocedure
        AND p.prosecdef AND position('private.is_service_role_request()' IN p.prosrc)>0
        AND position('suspend_tag_private.session_active' IN p.prosrc)>0
        AND position('private.current_evidence_actor_v3074()' IN p.prosrc)>0
        AND position('private.require_drive_live_change_profile_v2392' IN p.prosrc)>0
        AND position('private.require_photo_request_source_v3074' IN p.prosrc)>0
        AND p.prosrc !~* '\\m(update|insert|delete|truncate)\\M')
      AND position('can_work_suspend_photo_identity_v3074' IN pg_get_functiondef(
        'private.require_drive_live_change_profile_v2392(text,text,text,text)'::regprocedure))>0 AS installed`;
}

function accessDefaultsWatchdogContract() {
    return `SELECT
      position('role_access_baselines' IN pg_get_functiondef('private.seed_user_access_v23119(public.profiles)'::regprocedure))>0
      AND position('is_full_app_administrator_v1' IN pg_get_functiondef('private.seed_user_access_v23119(public.profiles)'::regprocedure))=0
      AND (SELECT count(*)=3 FROM private.runtime_watchdog_reviewers_v3074)
      AND NOT has_table_privilege('authenticated','private.runtime_watchdog_reviewers_v3074','SELECT')
      AND NOT has_function_privilege('anon','public.read_reviewed_watchdog_events_v3074(boolean,integer)','EXECUTE')
      AND has_function_privilege('authenticated','public.read_reviewed_watchdog_events_v3074(boolean,integer)','EXECUTE')
      AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.read_reviewed_watchdog_events_v3074(boolean,integer)'::regprocedure
        AND p.provolatile='s' AND p.prosecdef AND 'statement_timeout=2s'=ANY(p.proconfig)
        AND position('LIMIT 251' IN p.prosrc)>0 AND position('LIMIT 250' IN p.prosrc)>0
        AND position('resolve_runtime_watchdog' IN p.prosrc)=0
        AND p.prosrc !~* '\\m(update|insert|delete|truncate)\\M')
      AS installed`;
}

function findContract(contracts,name) {
    for (const contract of contracts) {
        const result=contract(name);
        if (result!=null) return result;
    }
    return null;
}

export function createReleaseMigrationContractResolver(contracts,fallback) {
    return name=>findContract(contracts,name)??fallback(name);
}
