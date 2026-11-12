import { erpPriorDayPruneContracts } from './erp-prior-day-prune-contract.mjs';
import { erpFinalInputCertificateContract, erpFinalInputCertificateMigration } from './erp-final-input-certificate-contract.mjs';
import { erpPriorDriveAliasContract, erpPriorDriveAliasMigration } from './erp-prior-drive-alias-contract.mjs';
import { erpCompiledDriveOrderDeltaContract, erpCompiledDriveOrderDeltaMigration } from './erp-compiled-drive-order-delta-contract.mjs';
import { erpCompiledDriveWorkContract, erpCompiledDriveWorkMigration, erpDriveReadinessWithoutAnalyzeContract,
  erpDriveReadinessWithoutAnalyzeMigration } from './erp-compiled-drive-work-contract.mjs';

export const erpIncrementalDrivePreparationMigration = '20261112031000_agdata3078_incremental_drive_preparation.sql';

export function erpIncrementalDrivePreparationContract() {
  return `select (select count(*)=4 and bool_and(not prosecdef and
      not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE')
      and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where oid in (
        to_regprocedure('private.drive_typed_slice_v3078(text,integer,integer,integer)'),
        to_regprocedure('private.drive_checkpoint_signature_v3078(uuid)'),to_regprocedure('private.seal_drive_preparation_v3078(uuid)'),
        to_regprocedure('private.load_drive_preparation_seal_v3078(uuid)')))
    and (select relrowsecurity and not has_table_privilege('authenticated',oid,'SELECT')
      and not has_table_privilege('service_role',oid,'UPDATE') from pg_class
      where oid=to_regclass('private.erp_drive_preparation_seals_v3078'))
    and (select strpos(prosrc,'batch_rows:=least(250,part.row_count-offset_rows,stage.expected_rows-job.typed_prepared_rows)')>0
      and strpos(prosrc,'private.drive_typed_slice_v3078(part.body,part.row_count,offset_rows,batch_rows)')>0
      from pg_proc where oid=to_regprocedure('private.prepare_drive_typed_part_v3077(uuid)'))
    and (select strpos(prosrc,'if not private.prepare_drive_typed_part_v3077(p_stage_id) then return false;')>0
      and strpos(prosrc,'return private.seal_drive_preparation_v3078(p_stage_id)')>0 and strpos(prosrc,'fit_one_attempt')=0
      from pg_proc where oid=to_regprocedure('private.prepare_erp_publication_v3077(uuid)'))
    and (select strpos(prosrc,'private.load_drive_preparation_seal_v3078(p_stage_id)')>0
      from pg_proc where oid=to_regprocedure('private.load_drive_erp_publication_input_v3042(uuid)'))
    and (select strpos(prosrc,'then ''240s'' else ''120s'' end')>0 and strpos(prosrc,'then ''750ms'' else ''15s'' end')>0
      and strpos(prosrc,'set local statement_timeout = %L; set local lock_timeout = %L; select private.run_erp_stage_publication_v3042')>0
      from pg_proc where oid=to_regprocedure('private.schedule_erp_stage_publication_v3057(uuid)'))
    and (select prosecdef and 'statement_timeout=240s'=any(proconfig) and strpos(prosrc,'set local statement_timeout=''240s''')>0
      and has_function_privilege('service_role',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')
      and not has_function_privilege('authenticated',oid,'EXECUTE')
      from pg_proc where oid=to_regprocedure('public.fast_ingest_drive_around_v1(jsonb,jsonb)')) as installed`;
}

export const erpIncrementalDrivePreparationContracts = [
  ...erpPriorDayPruneContracts,
  [erpIncrementalDrivePreparationMigration, erpIncrementalDrivePreparationContract],
  [erpCompiledDriveWorkMigration, erpCompiledDriveWorkContract],
  [erpDriveReadinessWithoutAnalyzeMigration, erpDriveReadinessWithoutAnalyzeContract],
  [erpFinalInputCertificateMigration, erpFinalInputCertificateContract],
  [erpPriorDriveAliasMigration, erpPriorDriveAliasContract],
  [erpCompiledDriveOrderDeltaMigration, erpCompiledDriveOrderDeltaContract]
];
