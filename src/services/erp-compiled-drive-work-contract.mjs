import { certifiedInputProofPredicate } from './erp-final-input-certificate-contract.mjs';
export const erpCompiledDriveWorkMigration = '20261112034500_agdata3078_compiled_drive_work.sql';
export const erpDriveReadinessWithoutAnalyzeMigration = '20261112044000_agdata3078_drive_readiness_without_analyze.sql';

function verifiedReadinessWithoutAnalyze() {
  return `strpos(lower(prosrc),'analyze private.erp_drive_compiled_rows_v3078')=0
    and ((strpos(prosrc,'perform private.assert_drive_typed_checkpoint_v3077(p_stage)')>0
    and strpos(prosrc,'s.checkpoint_hash is distinct from private.drive_checkpoint_signature_v3078(p_stage)')>0
    and strpos(prosrc,'count(*),min(row_number),max(row_number)')>0
    and strpos(prosrc,'set ready=true where stage_id=p_stage')>0)
    or (strpos(prosrc,'return private.certify_drive_final_input_v3078(p_stage)')>0 and ${certifiedInputProofPredicate()}))`;
}

export function erpDriveReadinessWithoutAnalyzeContract() {
  return `select exists(select 1 from pg_proc
      where oid=to_regprocedure('private.prepare_drive_work_v3078(uuid)')
        and ${verifiedReadinessWithoutAnalyze()}
        and strpos(prosrc,'least(w.compiled_rows+250,w.expected_rows)')>0
        and not has_function_privilege('service_role',oid,'EXECUTE'))
    and exists(select 1 from pg_index i where i.indrelid=to_regclass('private.erp_drive_compiled_rows_v3078')
      and i.indisprimary and i.indisvalid and i.indisready
      and strpos(pg_get_indexdef(i.indexrelid),'(stage_id, row_number)')>0)
    and exists(select 1 from pg_index i where i.indrelid=to_regclass('private.erp_drive_compiled_rows_v3078')
      and i.indisvalid and i.indisready and strpos(pg_get_indexdef(i.indexrelid),'(stage_id, erp_work_cohort)')>0) as installed`;
}

export function erpCompiledDriveWorkContract() {
  return `select (select count(*)=3 and bool_and(relpersistence='u' and relrowsecurity
        and not has_table_privilege('anon',oid,'SELECT') and not has_table_privilege('authenticated',oid,'SELECT')
        and not has_table_privilege('service_role',oid,'UPDATE')) from pg_class where oid in (
        to_regclass('private.erp_drive_compiled_rows_v3078'),to_regclass('private.erp_drive_compiled_cohorts_v3078'),
        to_regclass('private.erp_drive_compiled_headers_v3078')))
    and (select count(*)=4 and bool_and(not prosecdef and not has_function_privilege('anon',oid,'EXECUTE')
        and not has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('service_role',oid,'EXECUTE'))
      from pg_proc where oid in (to_regprocedure('private.copy_drive_work_range_v3078(uuid,integer,integer)'),
        to_regprocedure('private.prepare_drive_work_v3078(uuid)'),to_regprocedure('private.load_drive_work_v3078(uuid)'),
        to_regprocedure('private.has_drive_work_binding_v3078(boolean)')))
    and (select strpos(prosrc,'least(w.compiled_rows+250,w.expected_rows)')>0 and strpos(prosrc,'for update nowait')>0
        and (strpos(prosrc,'analyze private.erp_drive_compiled_rows_v3078 (stage_id,row_number,unique_id,lineage_key,erp_work_cohort)')>0
          and strpos(prosrc,'private.assert_drive_typed_checkpoint_v3077(p_stage)')>0
          or (${verifiedReadinessWithoutAnalyze()}))
      from pg_proc where oid=to_regprocedure('private.prepare_drive_work_v3078(uuid)'))
    and (select strpos(prosrc,'unnest(array[r.erp_row])')>0 and strpos(prosrc,'r.row_number>p_before and r.row_number<=p_after')>0
      from pg_proc where oid=to_regprocedure('private.copy_drive_work_range_v3078(uuid,integer,integer)'))
    and (select (strpos(prosrc,'private.assert_drive_typed_checkpoint_v3077(p_stage)')>0
        or (strpos(prosrc,'private.match_drive_final_certificate_v3078(private.lock_drive_final_input_v3078(p_stage))')>0
          and ${certifiedInputProofPredicate()}))
        and strpos(prosrc,'with(security_invoker=true)')>0 and strpos(prosrc,'with local check option')>0
      from pg_proc where oid=to_regprocedure('private.load_drive_work_v3078(uuid)'))
    and (select strpos(prosrc,'private.prepare_drive_work_v3078(p_stage_id)')>0 from pg_proc
      where oid=to_regprocedure('private.prepare_erp_publication_v3077(uuid)'))
    and (select strpos(prosrc,'private.load_drive_work_v3078(p_stage_id)')>0 from pg_proc
      where oid=to_regprocedure('private.load_drive_preparation_seal_v3078(uuid)'))
    and (select strpos(prosrc,'private.drive_work_index_or_analyze_v3078(loaded_payload_hash,true)')>0
        and strpos(prosrc,'private.drive_compiled_cohort_sql_v3078(sql_text,loaded_payload_hash,to_jsonb(tuple_value))')>0
        and strpos(prosrc,'input.payload=p_rows')>0 and strpos(prosrc,'pg_get_userbyid(c.relowner)<>current_user')>0
      from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')) as installed`;
}
