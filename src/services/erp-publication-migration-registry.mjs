import { erpDeferredDriveArchiveContract, erpPackedDriveArchiveContract } from './erp-drive-archive-migration-contracts.mjs';
import { erpManualPublicationContracts } from './erp-manual-publication-contracts.mjs';
import { erpPendingDropContracts } from './erp-pending-drop-migration-contracts.mjs';
import { erpRecoveryPublicationContracts } from './erp-publication-recovery-contract.mjs';
import { erpDeferredOrderHistoryContract, erpReserveHandoverGuardContract, erpSocHandoverGuardContract,
  erpOrderHistoryWholeRowContract } from './erp-order-publication-migration-contracts.mjs';

export const erpPublicationLivenessMigration = '20261109210000_agdata3042_erp_publication_liveness.sql';
export const erpPublicationQueueMigration = '20261109211000_agdata3042_erp_publication_queue.sql';
export const erpPayloadEfficiencyMigration = '20261109212000_agdata3042_erp_payload_efficiency.sql';
export const erpDrivePrepareBatchesMigration = '20261109213000_agdata3042_drive_prepare_batches.sql';
export const erpDriveTransactionInputMigration = '20261109214000_agdata3042_drive_transaction_input.sql';
export const erpScanRecoveryMigration = '20261109215000_agdata3044_reclaim_stale_erp_scans.sql';
export const erpDeltaPublicationMigration = '20261109220000_agdata3046_delta_erp_publication.sql';
export const erpDeferredOrderHistoryMigration = '20261109221000_agdata3046_defer_order_history.sql';
export const erpDriveTuplePlanMigration = '20261109222000_agdata3046_prepare_drive_tuple_plan.sql';
export const erpDriveSemanticDeltaMigration = '20261109223000_agdata3046_drive_semantic_delta.sql';
export const erpDriveOverlayOrdinalsMigration = '20261109224000_agdata3046_index_drive_overlay_ordinals.sql';
export const erpDriveTempContextMigration = '20261109225000_agdata3046_temp_drive_import_context.sql';
export const erpDriveAssignmentSetMigration = '20261109226000_agdata3047_set_based_drive_assignments.sql';
export const erpDriveHistoryFileProofIndexMigration = '20261109226100_agdata3047_drive_history_file_proof_index.sql';
export const erpDriveMasterEvalGuardMigration = '20261109230000_agdata3047_guard_master_eval_before_projection.sql';
export const erpDriveSocEvidenceDeltaMigration = '20261109231000_agdata3047_skip_empty_drive_soc_evidence.sql';
export const erpDriveSocEvidenceMarkerMigration = '20261109232000_agdata3048_mark_drive_soc_evidence_delta.sql';
export const erpDriveNarrowPublicationInputsMigration = '20261109233000_agdata3048_narrow_drive_publication_inputs.sql';
export const erpDriveKeyedCropRollPublicationMigration = '20261109234000_agdata3048_keyed_crop_roll_publication.sql';
export const erpDrivePruneCandidateMigration = '20261109235000_agdata3048_fence_drive_prune_candidates.sql';
export const erpDeferredDriveArchiveMigration = '20261110000000_agdata3048_defer_drive_file_archive.sql';
export const erpRetireCropRollPublicationMigration = '20261110001000_agdata3048_retire_crop_roll_publication.sql';
export const erpDriveSingleStockWriteMigration = '20261110002000_agdata3048_publish_drive_stock_in_one_write.sql';
export const erpAliasSingleStockWriteMigration = '20261110003000_agdata3048_publish_alias_stock_in_one_write.sql';
export const erpInheritedEvidenceIndexesMigration = '20261110006000_agdata3048_index_inherited_location_evidence.sql';
export const erpDriveFinalIdentityMapMigration = '20261110004000_agdata3048_reuse_drive_final_identity_map.sql';
export const erpDriveBatchLiveOverridesMigration = '20261110005000_agdata3048_batch_live_override_reconciliation.sql';
export const erpDriveSocEffectiveEvidenceMigration = '20261110007000_agdata3048_skip_unchanged_soc_evidence_writes.sql';
export const erpDriveSocEvidenceHistoryMigration = '20261110008000_agdata3048_defer_drive_soc_evidence_history.sql';
export const erpDriveBoundedAssignmentLocksMigration = '20261110010000_agdata3048_bound_native_assignment_locks.sql';
export const erpDriveAssignmentRevisionStampMigration = '20261110011000_agdata3048_stamp_unchanged_assignment_rows.sql';
export const erpPackedDriveArchiveMigration = '20261110012000_agdata3048_pack_frozen_drive_archive_rows.sql';
export const erpReserveHandoverGuardMigration = '20261110013000_agdata3048_skip_blank_reserve_handover.sql';
export const erpSocHandoverGuardMigration = '20261110014000_agdata3048_skip_blank_soc_handover.sql';
export const erpOrderHistoryWholeRowMigration = '20261110015000_agdata3048_freeze_whole_order_history_rows.sql';
const scopedContracts = [...erpManualPublicationContracts, ...erpPendingDropContracts, ...erpRecoveryPublicationContracts];
export const erpPublicationMigrationNames = [...scopedContracts.map(([name]) => name), erpPublicationLivenessMigration, erpPublicationQueueMigration,
  erpPayloadEfficiencyMigration, erpDrivePrepareBatchesMigration, erpDriveTransactionInputMigration, erpScanRecoveryMigration,
  erpDeltaPublicationMigration, erpDeferredOrderHistoryMigration, erpDriveTuplePlanMigration, erpDriveSemanticDeltaMigration,
  erpDriveOverlayOrdinalsMigration, erpDriveTempContextMigration, erpDriveAssignmentSetMigration,
  erpDriveHistoryFileProofIndexMigration, erpDriveMasterEvalGuardMigration, erpDriveSocEvidenceDeltaMigration,
  erpDriveSocEvidenceMarkerMigration, erpDriveNarrowPublicationInputsMigration, erpDriveKeyedCropRollPublicationMigration,
  erpDrivePruneCandidateMigration, erpDeferredDriveArchiveMigration, erpRetireCropRollPublicationMigration,
  erpDriveSingleStockWriteMigration, erpAliasSingleStockWriteMigration, erpDriveFinalIdentityMapMigration,
  erpDriveBatchLiveOverridesMigration, erpInheritedEvidenceIndexesMigration, erpDriveSocEffectiveEvidenceMigration,
  erpDriveSocEvidenceHistoryMigration, erpDriveBoundedAssignmentLocksMigration, erpDriveAssignmentRevisionStampMigration,
  erpPackedDriveArchiveMigration, erpReserveHandoverGuardMigration, erpSocHandoverGuardMigration, erpOrderHistoryWholeRowMigration];

function erpDeltaPublicationContract() {
  return `select
    to_regclass('private.erp_soc_history_jobs_v3046') is not null
    and not has_table_privilege('service_role',to_regclass('private.erp_soc_history_jobs_v3046'),'SELECT')
    and not has_function_privilege('service_role',to_regprocedure('private.drain_erp_soc_history_v3046()'),'EXECUTE')
    and position('erp_soc_history_jobs_v3046' in pg_get_functiondef(to_regprocedure(
      'private.normalize_soc_itemcode_from_pairs_v23104(jsonb)')))>0
    and position('reconcile_inventory_location_evidence_v1' in pg_get_functiondef(to_regprocedure(
      'public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)')))=0
    and position('erp_source_present is distinct from false' in pg_get_functiondef(to_regprocedure(
      'private.apply_erp_master_provenance_v3042()')))>0
    and (select 'lock_timeout=4s'=any(proconfig) from pg_proc where oid=
      to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid)')) as installed`;
}

function erpDriveTuplePlanContract() {
  return `select
    to_regprocedure('private.prepare_master_bulk_stage_v3046(jsonb)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.prepare_master_bulk_stage_v3046(jsonb)'),'EXECUTE')
    and position('prepare_master_bulk_stage_v3046' in pg_get_functiondef(to_regprocedure(
      'private.load_drive_erp_publication_input_v3042(uuid)')))>0
    and position('input.payload=p_rows' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('from pg_temp.ph_master_bulk_tuples_v3046' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0 as installed`;
}

function erpDriveSemanticDeltaContract() {
  return `select
    to_regprocedure('private.prior_drive_source_aliases_v3046()') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.prior_drive_source_aliases_v3046()'),'EXECUTE')
    and position('drive_master_delta_predicate_v3046' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('prior_alias.canonical_unique_id=mapped.canonical_unique_id' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('=new.unique_id' in pg_get_functiondef(to_regprocedure(
      'private.apply_inventory_location_evidence_v1()')))>0 as installed`;
}

function erpDriveOverlayOrdinalsContract() {
  return `select
    position('ph_master_bulk_stage_v1_ordinal_uidx' in pg_get_functiondef(to_regprocedure(
      'private.prepare_master_bulk_stage_v3046(jsonb)')))>0
    and position('analyze pg_temp.ph_master_bulk_map_v1 (canonical_unique_id,row_number)' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('to_jsonb(m) old_row' in pg_get_functiondef(to_regprocedure(
      'private.apply_inventory_live_overrides_bulk_v1(uuid)')))=0 as installed`;
}

function erpDriveTempContextContract() {
  return `select
    to_regprocedure('private.open_master_bulk_temp_context_v3046(uuid,uuid)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.open_master_bulk_temp_context_v3046(uuid,uuid)'),'EXECUTE')
    and position('v.relowner=owner.relowner' in pg_get_functiondef(to_regprocedure(
      'private.master_bulk_temp_context_active_v3046(uuid,uuid)')))>0
    and position('insert into app_sync_private.ph_master_bulk_import_context_v1' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))=0
    and position('insert into app_sync_private.ph_master_bulk_import_context_v1' in pg_get_functiondef(to_regprocedure(
      'public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)')))>0 as installed`;
}

function erpDriveAssignmentSetContract() {
  return `select
    to_regprocedure('private.reconcile_drive_row_assignments_v3047(uuid)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.reconcile_drive_row_assignments_v3047(uuid)'),'EXECUTE')
    and position('decide_inventory_row_owner_v3047' in pg_get_functiondef(to_regprocedure(
      'private.resolve_inventory_row_assignment_v1(text,bigint)')))>0
    and position('apply_drive_row_assignment_plan_v3047' in pg_get_functiondef(to_regprocedure(
      'private.reconcile_drive_row_assignments_v3047(uuid)')))>0
    and position('sync_new_unassigned_warehouse_itemcodes_v1' in pg_get_functiondef(to_regprocedure(
      'private.inventory_row_assignment_reconcile_finish_v1(uuid)')))>0 as installed`;
}

function erpDriveHistoryFileProofIndexContract() {
  return `select coalesce((select indisvalid and indisready and indisusable
    from (select indisvalid,indisready,indislive as indisusable from pg_index
      where indexrelid=to_regclass('public.ph_drive_mode_history_file_proof_v3047')
        and indrelid=to_regclass('public.ph_drive_mode_history')) as proof),false) as installed`;
}

function erpDriveMasterEvalGuardContract() {
  return `select
    (select strpos(prosrc,'agdata.bulk_import.') between 1 and strpos(prosrc,'app.eval_publication_v309')-1
      and strpos(prosrc,'=new.unique_id')>0 and strpos(prosrc,'to_jsonb(new)')=0
      from pg_proc where oid=to_regprocedure('private.sync_master_inventory_canonical_v2362()'))
    and (select strpos(prosrc,'guard_enabled:=')>strpos(prosrc,'agdata.bulk_import.')
      from pg_proc where oid=to_regprocedure('private.apply_inventory_location_evidence_v1()'))
    and (select strpos(prosrc,'actor:=')>strpos(prosrc,'is not distinct from')
      from pg_proc where oid=to_regprocedure('private.capture_inventory_location_evidence_v1()')) as installed`;
}

function erpDriveSocEvidenceDeltaContract() {
  return `select
    greatest(strpos(lower(prosrc),'if not exists(select 1 from new_drive_evidence'),
      strpos(lower(prosrc),'if current_setting(marker,true) is distinct from ''on''')) between 1
      and strpos(lower(prosrc),'with changed_drive_evidence as materialized')-1
    and strpos(lower(prosrc),'with changed_drive_evidence as materialized')>0
    and strpos(lower(prosrc),'from changed_drive_evidence n where')>0
    as installed from pg_proc where oid=to_regprocedure('private.publish_drive_evidence_to_soc_v23142()')`;
}

function erpDriveSocEvidenceMarkerContract() {
  return `select
    (select count(*)=2 from pg_trigger where tgrelid='public.ph_master_inventory'::regclass
      and tgfoid=to_regprocedure('private.mark_drive_soc_evidence_delta_v3048()')
      and tgenabled='O' and ((tgtype=18 and tgname='a000_drive_soc_evidence_reset_v3048')
        or (tgtype=17 and tgname='a000_drive_soc_evidence_mark_v3048' and tgqual is not null)))
    and not has_function_privilege('service_role',
      to_regprocedure('private.mark_drive_soc_evidence_delta_v3048()'),'EXECUTE')
    and not has_function_privilege('authenticated',
      to_regprocedure('private.mark_drive_soc_evidence_delta_v3048()'),'EXECUTE')
    and (select strpos(prosrc,'if current_setting(marker,true)') between 1
      and strpos(prosrc,'with changed_drive_evidence as materialized')-1
      from pg_proc where oid=to_regprocedure('private.publish_drive_evidence_to_soc_v23142()')) as installed`;
}

function erpDriveNarrowPublicationInputsContract() {
  return `select
    (select strpos(prosrc,'s.raw_item6_fields <@ s.field_keys')>0
      and strpos(prosrc,'pg_get_userbyid(c.relowner)<>current_user')>0
      and strpos(prosrc,'ph_master_bulk_assignedto_override_v1(to_jsonb(')=0
      and strpos(prosrc,'ph_master_bulk_assignedto_override_v1(jsonb_build_object(')>0
      from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'))
    and (select strpos(prosrc,'jsonb_object_agg(field_name,to_jsonb(e))')=0
      and strpos(prosrc,'oh.field_name=''ptronhand''')>0 and strpos(prosrc,'rv.field_name=''ptrreviewed''')>0
      from pg_proc where oid=to_regprocedure('private.apply_inventory_live_overrides_bulk_v1(uuid)')) as installed`;
}

function erpDriveKeyedCropRollPublicationContract() {
  return `select
    (select strpos(prosrc,'crop.master_unique_id=ids.id')>0 and strpos(prosrc,'master.unique_id=ids.id')>0
      and strpos(prosrc,'any(p_touched_ids)')=0 and strpos(prosrc,'where row(crop.')>0
      and strpos(prosrc,'is distinct from row(excluded.')>0
      from pg_proc where oid=to_regprocedure('private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])'))
    and exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
      where i.indexrelid=to_regclass('public.ph_crop_roll_drive_rows_master_uid_v3048_idx')
        and i.indrelid=to_regclass('public.ph_crop_roll_drive_rows') and i.indisvalid and i.indisready
        and i.indnkeyatts=1 and a.attname='master_unique_id') as installed`;
}

function erpDrivePruneCandidateContract() {
  return `select
    strpos(prosrc,'with missing_source as materialized') between 1 and strpos(prosrc,'eligible_missing_source as materialized')-1
    and strpos(prosrc,'from missing_source live') between 1 and strpos(prosrc,'using eligible_missing_source candidate')-1
    and strpos(prosrc,'live.ctid=candidate.physical_tid')>0
    and strpos(prosrc,'held.status in (''pending'',''conflict'')')>0
    as installed from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')`;
}

function erpRetireCropRollPublicationContract() {
  return `select
    (select count(*)=4 and bool_and(tgenabled='D') from pg_trigger where
      (tgrelid=to_regclass('public.ph_master_inventory') and tgname in ('trg_v2_master_inventory_crop_roll_drive_rows',
        'trg_v2_master_inventory_crop_roll_drive_rows_insert','trg_v2_master_inventory_crop_roll_drive_rows_delete'))
      or (tgrelid=to_regclass('public.ph_crop_roll_rows') and tgname='trg_sync_v2_crop_roll_completed_drive_keys'))
    and (select count(*)=3 and bool_and(strpos(prosrc,'sync_ph_master_bulk_crop_roll_v1')=0)
      from pg_proc where oid in (to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'),
        to_regprocedure('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'),
        to_regprocedure('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)')))
    and not has_function_privilege('authenticated',to_regprocedure('public.refresh_v2_crop_roll_completed_drive_keys()'),'EXECUTE')
    and not has_function_privilege('service_role',to_regprocedure('public.refresh_v2_crop_roll_completed_drive_keys()'),'EXECUTE')
    as installed`;
}

function erpDriveSingleStockWriteContract() {
  return `select
    (select strpos(prosrc,'erp_on_hand=s.frozen_erp_on_hand_v3048')>0
      and strpos(prosrc,'or ((target.erp_on_hand,target.erp_ptrreview,target.erp_available,target.erp_source_present)')>0
      from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'))
    and (select strpos(prosrc,'as frozen_erp_available_v3048')>0 from pg_proc
      where oid=to_regprocedure('private.prepare_master_bulk_stage_v3046(jsonb)'))
    and (select strpos(prosrc,'s.frozen_erp_on_hand_v3048 as on_hand')>0 from pg_proc
      where oid=to_regprocedure('private.apply_erp_master_provenance_v3042()')) as installed`;
}

function erpAliasSingleStockWriteContract() {
  return `select strpos(prosrc,'erp_on_hand=excluded.erp_on_hand')>0
    and strpos(prosrc,'coalesce(s.raw_values->>''''filename'''',s.filename),true')>0
    and strpos(prosrc,'or ((existing.erp_on_hand,existing.erp_ptrreview,existing.erp_available,existing.erp_source_present)')>0 as installed
    from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')`;
}

function erpDriveFinalIdentityMapContract() {
  return `select strpos(prosrc,'i.canonical_unique_id=notes.canonical_unique_id')>0
    and strpos(prosrc,'mapped.canonical_unique_id,s.unique_id,s.source_hash,p_run_id')>0
    and strpos(prosrc,'BULK_MASTER_IMPORT_CONCURRENT_ROW_CHANGE')<strpos(prosrc,'i.canonical_unique_id=notes.canonical_unique_id')
    as installed from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')`;
}

function erpDriveBatchLiveOverridesContract() {
  return `select strpos(prosrc,'pending=not private.inventory_override_matches_v1(e.field_name,s.raw_values->e.field_name,e.app_override_value)')>0
    and strpos(prosrc,'with pending_patches as materialized')>0
    and strpos(prosrc,'jsonb_populate_record(s,p.fields)')>0
    and strpos(prosrc,'for v_field_name in')=0
    and not has_function_privilege('authenticated',oid,'EXECUTE')
    and not has_function_privilege('service_role',oid,'EXECUTE') as installed
    from pg_proc where oid=to_regprocedure('private.apply_inventory_live_overrides_bulk_v1(uuid)')`;
}

function erpInheritedEvidenceIndexesContract() {
  return `select
    exists(select 1 from pg_index i where i.indexrelid=to_regclass('app_sync_private.inventory_location_evidence_location_v3048_idx')
      and i.indrelid='app_sync_private.inventory_location_evidence_v1'::regclass and i.indisvalid
      and pg_get_indexdef(i.indexrelid,1,true)='itemcode_key' and pg_get_indexdef(i.indexrelid,2,true)='locationcode_key')
    and exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.ph_location_sales_notes_location_v3048_idx')
      and i.indrelid='public.ph_location_sales_notes'::regclass and i.indisvalid
      and pg_get_indexdef(i.indexrelid,1,true)='upper(btrim(itemcode))'
      and pg_get_indexdef(i.indexrelid,2,true)='upper(btrim(locationcode))') as installed`;
}

function erpDriveSocEffectiveEvidenceContract() {
  return `select strpos(prosrc,'and (s.photo_link,s.photo_name,s.photo_url,s.photos,s.dock_photo_link,s.dock_photo_name,')>0
    and strpos(prosrc,'coalesce(n.photo_link,s.dock_photo_link)')>0
    and strpos(prosrc,'then s.date_completed else n.date_completed end)')>0
    and strpos(prosrc,'other.unique_id<>n.unique_id')>0 as installed
    from pg_proc where oid=to_regprocedure('private.publish_drive_evidence_to_soc_v23142()')`;
}

function erpDriveSocEvidenceHistoryContract() {
  return `select
    strpos(pg_get_functiondef(to_regprocedure('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)')),
      'set_config(''gnc.erp_drive_soc_history_run_v3048'',p_run_id::text,true)')>0
    and strpos(prosrc,'coalesce(auth.role(),'''')<>''service_role''')>0
    and strpos(prosrc,'returning case when deferred_file is not null then to_jsonb(s) end')>0
    and strpos(prosrc,'insert into private.erp_order_history_rows_v3046')>0
    and strpos(pg_get_functiondef(to_regprocedure('private.archive_soc_order_trigger_v2366()')),
      'perform private.refresh_soc_order_history_v2366(new.unique_id)')>0 as installed
    from pg_proc where oid=to_regprocedure('private.publish_drive_evidence_to_soc_v23142()')`;
}

function erpDriveBoundedAssignmentLocksContract() {
  return `select strpos(prosrc,'inventory-row-assignment:')=0
    and strpos(prosrc,'gnc-reconcile-eval-itemcodes-v2') between 1 and strpos(prosrc,'plan_drive_row_assignments_v3047')-1
    and strpos(prosrc,'INVENTORY_ROW_ASSIGNMENT_IMPORT_FENCE_LOST')>0
    and strpos(pg_get_functiondef(to_regprocedure('private.resolve_inventory_row_assignment_v1(text,bigint)')),
      'inventory-row-assignment:')>0 as installed
    from pg_proc where oid=to_regprocedure('private.reconcile_drive_row_assignments_v3047(uuid)')`;
}

function erpDriveAssignmentRevisionStampContract() {
  return `select strpos(prosrc,'where p.stamp_only and a.master_unique_id=p.master_unique_id')>0
    and strpos(prosrc,'where not stamp_only order by master_unique_id on conflict')>0
    and strpos(prosrc,'a.plant_group_code is not distinct from p.expected_plant_group_code')>0
    and strpos(pg_get_functiondef(to_regprocedure('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)')),
      'where not exists(select 1 from public.ph_itemcode_default_owners existing')>0 as installed
    from pg_proc where oid=to_regprocedure('private.apply_drive_row_assignment_plan_v3047(bigint)')`;
}

const erpBoundedPublicationContracts = new Map([
  ...scopedContracts,
  [erpDeltaPublicationMigration, erpDeltaPublicationContract],
  [erpDeferredOrderHistoryMigration, erpDeferredOrderHistoryContract],
  [erpDriveTuplePlanMigration, erpDriveTuplePlanContract],
  [erpDriveSemanticDeltaMigration, erpDriveSemanticDeltaContract],
  [erpDriveOverlayOrdinalsMigration, erpDriveOverlayOrdinalsContract],
  [erpDriveTempContextMigration, erpDriveTempContextContract],
  [erpDriveAssignmentSetMigration, erpDriveAssignmentSetContract],
  [erpDriveHistoryFileProofIndexMigration, erpDriveHistoryFileProofIndexContract],
  [erpDriveMasterEvalGuardMigration, erpDriveMasterEvalGuardContract],
  [erpDriveSocEvidenceDeltaMigration, erpDriveSocEvidenceDeltaContract],
  [erpDriveSocEvidenceMarkerMigration, erpDriveSocEvidenceMarkerContract],
  [erpDriveNarrowPublicationInputsMigration, erpDriveNarrowPublicationInputsContract],
  [erpDriveKeyedCropRollPublicationMigration, erpDriveKeyedCropRollPublicationContract],
  [erpDrivePruneCandidateMigration, erpDrivePruneCandidateContract],
  [erpDeferredDriveArchiveMigration, erpDeferredDriveArchiveContract],
  [erpRetireCropRollPublicationMigration, erpRetireCropRollPublicationContract],
  [erpDriveSingleStockWriteMigration, erpDriveSingleStockWriteContract],
  [erpAliasSingleStockWriteMigration, erpAliasSingleStockWriteContract],
  [erpDriveFinalIdentityMapMigration, erpDriveFinalIdentityMapContract],
  [erpDriveBatchLiveOverridesMigration, erpDriveBatchLiveOverridesContract],
  [erpInheritedEvidenceIndexesMigration, erpInheritedEvidenceIndexesContract],
  [erpDriveSocEffectiveEvidenceMigration, erpDriveSocEffectiveEvidenceContract],
  [erpDriveSocEvidenceHistoryMigration, erpDriveSocEvidenceHistoryContract],
  [erpDriveBoundedAssignmentLocksMigration, erpDriveBoundedAssignmentLocksContract],
  [erpDriveAssignmentRevisionStampMigration, erpDriveAssignmentRevisionStampContract],
  [erpPackedDriveArchiveMigration, erpPackedDriveArchiveContract],
  [erpReserveHandoverGuardMigration, erpReserveHandoverGuardContract],
  [erpSocHandoverGuardMigration, erpSocHandoverGuardContract],
  [erpOrderHistoryWholeRowMigration, erpOrderHistoryWholeRowContract],
]);

export function erpPublicationMigrationContract(name) {
  const bounded = erpBoundedPublicationContracts.get(name);
  if (bounded) return bounded();
  if (name === erpScanRecoveryMigration) return `select
    to_regprocedure('private.erp_sync_recovery_due_v3044(jsonb,timestamptz,timestamptz,timestamptz)') is not null
    and not has_function_privilege('service_role',to_regprocedure(
      'private.erp_sync_recovery_due_v3044(jsonb,timestamptz,timestamptz,timestamptz)'),'EXECUTE')
    and position('recoveryClaimedAt' in pg_get_functiondef(to_regprocedure('public.claim_erp_sync_request_step_v1(uuid,text)')))>0
    and position('_workerLeaseId' in pg_get_functiondef(to_regprocedure('public.update_erp_sync_job_v1(uuid,jsonb)')))>0
    and position('recoveryDue' in pg_get_functiondef(to_regprocedure('public.get_erp_sync_status_v1()')))>0
    and position('erp_sync_recovery_due_v3044' in pg_get_functiondef(to_regprocedure('private.wake_erp_sync_job_v23116()')))>0 as installed`;
  if (name === erpDriveTransactionInputMigration) return `select
    to_regprocedure('private.load_drive_erp_publication_input_v3042(uuid)') is not null
    and not has_function_privilege('service_role',to_regprocedure('private.load_drive_erp_publication_input_v3042(uuid)'),'EXECUTE')
    and position('load_drive_erp_publication_input_v3042' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid,boolean)')))>0
    and position('prepared_digest' in pg_get_functiondef(to_regprocedure(
      'public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)')))>0 as installed`;
  if (name === erpDrivePrepareBatchesMigration) return `select
    to_regclass('private.erp_drive_publication_parts_v3042') is not null
    and not has_table_privilege('authenticated',to_regclass('private.erp_drive_publication_parts_v3042'),'SELECT')
    and position('prepared_rows' in pg_get_functiondef(to_regprocedure(
      'private.run_erp_stage_publication_v3042(uuid)')))>0
    and position('agdata.erp.prepared_drive' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid)')))>0 as installed`;
  if (name === erpPayloadEfficiencyMigration) return `select
    position('stable_aliases as materialized' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('private.ph_master_inventory_lineage_key_v1(m)' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))>0
    and position('agdata_erp_publication' in pg_get_functiondef(to_regprocedure(
      'private.run_erp_stage_publication_v3042(uuid)')))>0 as installed`;
  if (name === erpPublicationQueueMigration) return `select
    to_regclass('private.erp_stage_publication_jobs_v3042') is not null
    and to_regprocedure('private.run_erp_stage_publication_v3042(uuid)') is not null
    and has_function_privilege('service_role',to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'),'EXECUTE')
    and not has_function_privilege('authenticated',to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'),'EXECUTE')
    and position('select j.payload' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid)')))>0 as installed`;
  if (name !== erpPublicationLivenessMigration) return null;
  return `select
    position('disable trigger' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')))=0
    and position('apply_erp_master_provenance_v3042' in pg_get_functiondef(to_regprocedure(
      'public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)')))>0
    and position('jsonb_array_length(rows_value)' in pg_get_functiondef(to_regprocedure(
      'public.fast_commit_erp_stage_swap_v1(uuid)')))>0
    and not has_function_privilege('authenticated',to_regprocedure('private.apply_erp_master_provenance_v3042()'),'EXECUTE')
    and (select count(*)=4 from pg_proc where oid in (
      to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid)'),
      to_regprocedure('public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb)'),
      to_regprocedure('public.fast_seal_erp_stage_v1(uuid,integer)'),
      to_regprocedure('public.fast_abort_erp_stage_v1(uuid)')) and 'statement_timeout=120s'=any(proconfig)) as installed`;
}
