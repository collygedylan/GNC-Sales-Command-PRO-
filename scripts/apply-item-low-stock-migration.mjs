import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const migrationName = '20260928145055_item_low_stock_targets.sql';
export const perennialAssignmentMigrationName = '20260929013125_perennial_zone_assignment_override.sql';
export const passwordReconciliationMigrationName = '20260929160000_password_change_profile_reconciliation.sql';
export const productionScheduleMigrationName = '20261001012038_production_schedule_snapshot_v1.sql';
export const auraHrCommandCenterMigrationName = '20261001025638_aura_hr_command_center_v1.sql';
export const scheduledHandoverMigrationName = '20261001215508_scheduled_handover_005.sql';
export const requestArchiveMigrationName = '20261001215511_request_archive_005.sql';
export const handoverAssignmentMigrationName = '20261001222228_handover_assignment_transfer_005.sql';
export const readOptimizationMigrationName = '20261002014421_index_request_history_assigned_rep_006.sql';
export const auraInventoryV2MigrationName = '20261002121446_aura_inventory_v2_007.sql';
export const auraInventoryMatchMigrationName = '20261002204108_aura_inventory_match_010.sql';
export const auraLlmFreeTierMigrationName = '20261003025749_aura_llm_free_tier_011.sql';
export const auraInternalQueryMigrationName = '20261007041448_aura_internal_query_conversation_inventory.sql';
export const auraCommonNamePriorityMigrationName = '20261007123459_aura_inventory_common_name_priority.sql';
export const auraDynamicSeasonScopeMigrationName = '20261007145433_aura_dynamic_season_scope.sql';
export const auraInventoryExplicitProjectionMigrationName = '20261007153351_aura_inventory_explicit_projection.sql';
export const sqlFunctionCorrectnessRepairsMigrationName = '20261007211325_sql_function_correctness_repairs.sql';
export const sqlLintRuntimeContextMigrationName = '20261007211340_sql_lint_runtime_context.sql';
export const nellyAccessAuditMigrationName = '20261002134138_nelly_access_audit_baseline_repair_007.sql';
export const evalDeliveryArchiveHealthMigrationName = '20261002155017_eval_delivery_archive_health_007.sql';
export const suspendTagApprovalMigrationName = '20261005194158_suspend_tag_approval_loop.sql';
export const structuredBunchNotesMigrationName = '20261005225759_structured_bunch_notes.sql';
export const bunchNoteCardsMigrationName = '20261006110751_bunch_note_per_card_work.sql';
export const bunchNoteCardCommandsMigrationName = '20261006111244_bunch_note_card_commands.sql';
export const reclassSplitMoveMigrationName = '20261006145333_reclass_split_move_inquiries_v4.sql';
export const reclassShearedMigrationName = '20261008190038_reclass_sheared_action_v5.sql';
export const reclassSmartShieldMigrationName = '20261009053029_reclass_smart_priority_hold_shield_v6.sql';
export const smartShieldRawImportMigrationName = '20261009053030_smart_shield_raw_import_acknowledgment.sql';
export const requestQueueRemoveMigrationName = '20261009170000_request_queue_remove_v1.sql';
export const prompt25HotfixMigrationName = '20261009202507_prompt25_editable_field_shield_and_hold_clear.sql';
export const customerRepMappingMigrationName = '20261010024830_customer_rep_mapping_management.sql';
export const bunchAutoCompletionMigrationName = '20261010080018_bunch_note_auto_completion_delivery.sql';
export const fieldCountingMigrationName = '20261010080140_field_counting_commands_and_reports.sql';
export const customerRepMappingFinalizeTimeoutMigrationName = '20261010152556_customer_rep_mapping_finalize_timeout_55s.sql';
export const historicalRequestsMigrationName = '20261010165013_historical_requests_financial_dashboard.sql';
export const auraVoiceRoleAccessMigrationName = '20261010200046_aura_voice_role_access.sql';
export const auraVoiceSocReadsMigrationName = '20261011032352_aura_voice_soc_reads.sql';
export const requestMappingIdentityMigrationName = '20261011170000_request_mapping_salesrep_identity.sql';
export const historicalRequestsPriceFallbackMigrationName = '20261011193000_historical_requests_price_fallback.sql';
export const reclassConcurrentHoldMigrationName = '20261011223000_reclass_concurrent_hold_rows.sql';
export const navigationRoleBoundariesMigrationName = '20261011230000_normalize_navigation_role_boundaries.sql';
export const salesActorRoleBoundariesMigrationName = '20261011224500_normalize_sales_actor_role_boundaries.sql';
export const reclassEvalSubmitGuardsMigrationName = '20261006150745_reclass_split_move_eval_submit_guards.sql';
export const inventoryRowAssignmentFutureSnapshotsMigrationName = '20261006210000_inventory_row_assignment_future_snapshots.sql';
export const inventoryRowAssignmentLiveConsumersMigrationName = '20261006210200_inventory_row_assignment_live_consumers.sql';
export const inventoryRowAssignmentAuthorityMigrationName = '20261006200446_inventory_row_assignment_authority.sql';
export const itemcodeDefaultOwnersMigrationName = '20261006200448_itemcode_default_owners.sql';
export const inventoryRowAssignmentFenceIntegrationMigrationName = '20261006200449_inventory_row_assignment_fence_integration.sql';
export const requestHistoryDrilldownMigrationName = '20261012011000_request_history_drilldown_isolation.sql';
export const auraEnterpriseDomainVoiceMigrationName = '20261012052500_aura_enterprise_domain_voice.sql';
export const managerReportReadV2MigrationName = '20261012190002_manager_report_read_v2.sql';
export const managerListReadV2MigrationName = '20261012190003_manager_list_read_v2.sql';
export const inventoryLocationOnHandMigrationName = '20261013160000_inventory_location_item_on_hand.sql';
export const masterInventoryRealtimeMigrationName = '20261013170000_master_inventory_realtime_publication.sql';
export const eval2SharedLowStockThresholdMigrationName = '20261014110620_eval2_shared_low_stock_threshold.sql';
export const masterLineageCleanupMigrationName = '20261014140147_master_lineage_cleanup_bounded.sql';
export const seasonSalesCavLookupMigrationName = '20261014142125_season_sales_cav_lookup_index.sql';
export const seasonSalesEmptyCleanupMigrationName = '20261014144043_season_sales_skip_empty_mirror_cleanup.sql';
export const seasonSalesWorklistMigrationName = '20261014145025_season_sales_reconciliation_worklist.sql';
export const inventoryAssignmentBatchesMigrationName = '20261014155536_inventory_assignment_reconciliation_batches.sql';
export const inventoryAssignmentWitnessMigrationName = '20261014160924_inventory_assignment_witness_projection.sql';
export const inventoryAssignmentInputGenerationMigrationName = '20261014161813_inventory_assignment_input_generation.sql';
export const customerAssignmentOverridesMigrationName = '20261014214542_customer_assignment_overrides.sql';
export const bulkMasterSnapshotMigrationName = '20261015012249_bulk_master_snapshot_v1.sql';
export const importHistoryRoutingMigrationName = '20261015165733_import_history_routing.sql';
export const handoverMasterAssignmentFastPathMigrationName = '20261015183500_handover_master_assignment_fast_path.sql';
export const bulkContextIndexPlanMigrationName = '20261015192500_bulk_context_index_plan.sql';
export const managerModuleRevisionSignalsMigrationName = '20261015213506_manager_module_revision_signals.sql';
export const inventoryReclassMovesMigrationName = '20261015230000_inventory_reclass_moves_v1.sql';
export const inventoryReclassQuantityTriggerFastpathsMigrationName = '20261016093000_reclass_quantity_update_trigger_fastpaths_v1.sql';
export const inventoryReclassCompactTriggerIdentityMigrationName = '20261016120000_reclass_compact_trigger_identity_v1.sql';
export const inventoryReclassCompactBatchChildReceiptsMigrationName = '20261016140000_reclass_compact_batch_child_receipts_v1.sql';
export const inventoryReclassNullElisionRpcMigrationName = '20261016160000_reclass_null_elision_rpc_v1.sql';
export const masterIdentityBatchReadMigrationName = '20261017110000_inventory_master_identity_batch_read_v1.sql';
export const bunchNoteMultiAssignmentRoutingMigrationName = '20261017203000_bunch_note_multi_assignment_routing.sql';
export const bunchNoteBlueprintHeaderPdfDeliveryMigrationName = '20261018014347_bunch_note_blueprint_header_pdf_delivery.sql';
export const bunchNoteQueueExecutionMigrationName = '20261018183204_bunch_note_queue_execution_and_recounts.sql';
export const bunchNoteSupervisorAssigneeFacetsMigrationName = '20261019003759_bunch_note_supervisor_assignee_facets_v1.sql';
export const suspendTagSenderIdentityMigrationName = '20261019113414_suspend_tag_sender_identity.sql';
export const canonicalUserAccessMigrationName = '20261019163128_canonical_user_access_control_v1.sql';
export const inventoryReclassMoveDeliveryMigrationName = '20261019172019_inventory_reclass_move_delivery_v1.sql';
export const masterSnapshotChunkedStagingMigrationName = '20261019225625_master_snapshot_chunked_staging_v1.sql';
export const masterIdentityBatchRetrySqlstateMigrationName = '20261019234222_identity_batch_not_ready_retry_sqlstate.sql';
export const reclassEmailReportPolicyMigrationName = '20261020150827_v2315_reclass_email_report_policy.sql';
export const publishedLkgReadProofMigrationName = '20261020161833_published_lkg_read_proof_v1.sql';
export const reclassServerRevisionMigrationName = '20261020204855_reclass_server_revision_and_failed_stage_lease_v1.sql';
export const reclassRepScopeMigrationName = '20261020233500_reclass_rep_scope_preservation_v1.sql';
export const managerPublishedReadMigrationName = '20261021014500_manager_published_read_continuity_v1.sql';
export const importSourceMetadataMigrationName = '20261021020000_import_source_metadata_v1.sql';
export const masterPrioritySplitMigrationName = '20261021021000_master_priority_split_identity_v1.sql';
export const fullAppAdministratorsMigrationName = '20261021035500_full_app_administrators_v1.sql';
export const protectedRequestNaMigrationName = '20261021035641_protect_na_request_mappings_v1.sql';
export const zeroTrustRlsMigrationName = '20261021041910_zero_trust_rls_lockdown_v1.sql';
export const appLoginRateLimitMigrationName = '20261021042013_app_login_rate_limit_v1.sql';
export const managerReportSetBasedReadMigrationName = '20261021115558_manager_report_set_based_read_v1.sql';
export const managerEval2BatchedPreviewMigrationName = '20261021125546_manager_eval2_batched_preview_v1.sql';
export const auraDylanOwnerOnlyMigrationName = '20261021133149_aura_dylan_owner_only_guard.sql';
export const suspendExistingReviewMigrationName = '20261021160000_suspend_existing_review_v1.sql';
export const evalBrowseSuspendReceiptsMigrationName = '20261021210000_eval_browse_suspend_receipts_v1.sql';
export const inventoryOverrideReconciliationMigrationName = '20261021200000_inventory_override_reconciliation.sql';
export const masterChunkLedgerCapacityMigrationName = '20261021195000_master_chunk_ledger_capacity.sql';
export const operationalLookupIndexesMigrationName = '20261021194000_operational_lookup_indexes.sql';
export const applicationConflictRetryMigrationName = '20261021193000_application_conflict_retry_guard.sql';
export const requestWorkSyncStatusMigrationName = '20261021190000_request_work_sync_status_v1.sql';
export const suspendCandidatesRequestPreloadMigrationName = '20261021170000_suspend_candidates_request_preload_v1.sql';
export const reclassSeasonStockMigrationName = '20261021220000_reclass_season_stock_and_recipients.sql';
export const inventoryProjectsMigrationName = '20261022_inventory_projects_v1.sql';
export const masterSnapshotSourceDedupMigrationName = '20261022193000_master_snapshot_source_dedup_v1.sql';
export const masterSnapshotAliasDedupMigrationName = '20261022203000_master_snapshot_alias_dedup_v1.sql';
export const masterSnapshotIdentityDedupMigrationName = '20261022214500_master_snapshot_identity_dedup_v1.sql';
export const masterSnapshotDuplicateMapMigrationName = '20261022223000_master_snapshot_duplicate_map_v1.sql';
export const reclassPhysicalStockMigrationName = '20261023100000_reclass_physical_stock_v1.sql';
export const dashboardWarningCleanupMigrationName = '20261023203000_dashboard_warning_cleanup_and_reclass_recount_v1.sql';
export const driveLocationEvidenceMigrationName = '20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql';
export const boundedRequestQueueReconciliationMigrationName = '20261023233000_bounded_request_queue_reconciliation_v2.sql';
export const requestQuantityRecoveryMigrationName = '20261023234500_request_quantity_recovery_v3.sql';
export const inventoryLocationEvidenceLifecycleMigrationName = '20261023235500_inventory_location_evidence_lifecycle_v2.sql';
export const requestSalesImpactMigrationName = '20261023235900_request_sales_impact_v1.sql';
export const requestSalesImpactV2MigrationName = '20261024010000_request_sales_impact_v2.sql';
export const requestSalesImpactStrictDedupeMigrationName = '20261024023000_request_sales_impact_strict_dedupe_v3.sql';
export const requestQueuePendingReconciliationMigrationName = '20261024060000_request_queue_pending_reconciliation_v3.sql';
export const requestQueueLegacyOutboxReconciliationMigrationName = '20261024061500_request_queue_legacy_outbox_reconciliation_v4.sql';
export const escapedDisplayTextNormalizationMigrationName = '20261024070000_escaped_display_text_normalization_v1.sql';
export const requestLifecycleStateMachineMigrationName = '20261024183000_request_lifecycle_state_machine_v1.sql';
export const unifiedRequestSyncSalesImpactMigrationName = '20261024203000_unified_request_sync_sales_impact_v1.sql';
export const agdataV2361SurgicalRestoreMigrationName = '20261025003000_agdata_v2361_surgical_restore.sql';
export const agdataV2362CanonicalRequestsMigrationName = '20261025013000_agdata_v2362_canonical_requests.sql';
export const agdataV2362LegacyCleanupMigrationName = '20261025014500_agdata_v2362_remove_legacy_request_objects.sql';
export const agdataV2363UniformActiveHistoryMigrationName = '20261025023000_agdata_v2363_uniform_active_history_architecture.sql';
export const agdataV2364RequestBrowserCompatibilityMigrationName = '20261025040000_agdata_v2364_request_browser_compatibility.sql';
export const agdataV2364LocationEvidenceRepairCompatibilityMigrationName = '20261025062000_agdata_v2364_location_evidence_repair_compatibility.sql';
export const agdataV2365AnonSecurityHardeningMigrationName = '20261025080000_agdata_v2365_anon_security_hardening.sql';
export const agdataV2365SalesImpactUnionFixMigrationName = '20261025081000_agdata_v2365_sales_impact_union_fix.sql';
export const agdataV2366HistoricalArchiveMigrationName = '20261025220000_agdata_v2366_historical_archive.sql';
export const agdataV2366FastHistoricalRequestsMigrationName = '20261025223000_agdata_v2366_fast_historical_requests_read.sql';
export const agdataV2366QueueResolutionCleanupMigrationName = '20261025234500_agdata_v2366_queue_resolution_cleanup.sql';
export const agdataV2366HistoricalStateDedupMigrationName = '20261026003000_agdata_v2366_historical_state_dedup.sql';
export const agdataV2366InventoryConsolidationMigrationName = '20261026004500_agdata_v2366_inventory_consolidation.sql';
export const agdataV2366InventoryConsolidationSalesYearFixMigrationName = '20261026010000_agdata_v2366_inventory_consolidation_sales_year_fix.sql';
export const agdataV2366InventoryConsolidationCacheMigrationName = '20261026011500_agdata_v2366_inventory_consolidation_cache.sql';
export const agdataV2366HistoricalArchivePageDedupMigrationName = '20261026013000_agdata_v2366_historical_archive_page_dedup.sql';
export const agdataV2366DriveArchiveSearchHashFixMigrationName = '20261026014500_agdata_v2366_drive_archive_search_hash_fix.sql';
export const agdataV2367CropTierAuraGlossaryMigrationName = '20261026020000_agdata_v2367_crop_tier_aura_glossary.sql';
export const agdataV2367HistoricalDriveFastReadMigrationName = '20261026034500_agdata_v2367_historical_drive_fast_read.sql';
export const agdataV2368RequestPhotoAvNavigationMigrationName = '20261026050000_agdata_v2368_request_photo_av_navigation.sql';
export const agdataV2368MasterPhotoDatePreservationMigrationName = '20261026051000_agdata_v2368_master_photo_date_preservation.sql';
export const agdataV2368AvNoteSanitizerMigrationName = '20261026054000_agdata_v2368_av_note_sanitizer.sql';
export const agdataV2368HistoricalPhotoDateKeyFixMigrationName = '20261026055000_agdata_v2368_historical_photo_date_key_fix.sql';
export const agdataV2369FastLiveErpIngestionMigrationName = '20261026070000_agdata_v2369_fast_live_erp_ingestion.sql';
export const agdataV2369EmergencyRecoveryMigrationName = '20261026140000_agdata_v2369_emergency_recovery.sql';
export const agdataV2369PrivateDeliveryBoundaryMigrationName = '20261026150000_agdata_v2369_private_delivery_boundary.sql';
export const agdataV2370WatchdogRequestRecoveryMigrationName = '20261026160000_agdata_v2370_watchdog_and_request_recovery.sql';
export const agdataV2371RequestSuspendEmailLockCleanupMigrationName = '20261026170000_agdata_v2371_request_suspend_email_and_lock_cleanup.sql';
export const agdataV2372RequestCompletionAcknowledgmentMigrationName = '20261026183000_agdata_v2372_request_completion_acknowledgment.sql';
export const agdataV2372RequestCompletionDeliveryMigrationName = '20261026184500_agdata_v2372_request_completion_delivery.sql';
export const agdataV2373FastAppsScriptErpImportUnblockMigrationName = '20261026180000_agdata_v2373_fast_apps_script_erp_import_unblock.sql';
export const agdataV2373DriveTimeoutRecoveryMigrationName = '20261026190000_agdata_v2373_drive_timeout_recovery.sql';
export const agdataV2374UnifiedFastBaselineSuspendReclassEmailMigrationName = '20261026200000_agdata_v2374_unified_fast_baseline_suspend_reclass_email.sql';
export const agdataV2375SuspendCardsFastBatchSyncMigrationName = '20261026210000_agdata_v2375_suspend_17_cards_and_fast_batch_sync.sql';
export const agdataV2376InstantLoginFastSuspendMigrationName = '20261026220000_agdata_v2376_instant_login_and_fast_suspend_view.sql';
export const agdataV2377SuspendReadContinuityMigrationName = '20261026230000_agdata_v2377_suspend_read_continuity.sql';
export const agdataV2378FullAuditRemediationMigrationName = '20261027003000_agdata_v2378_full_audit_remediation.sql';
export const agdataV2379CompleteReclassDestinationRowLoopMigrationName = '20261027013000_agdata_v2379_complete_reclass_destination_row_loop.sql';
export const agdataV2379ReclassLocationEvidenceMigrationName = '20261027013100_agdata_v2379_reclass_location_evidence.sql';
export const agdataV2380ReclassPreEditReportsMigrationName = '20261027020000_agdata_v2380_reclass_pre_edit_reports_and_test_suppression.sql';
export const agdataV2381FastErpStageRpcsMigrationName = '20261027030000_agdata_v2381_fast_erp_stage_rpcs.sql';
export const agdataV2382DriveParityReclassAndFastSyncMigrationName = '20261027040000_agdata_v2382_drive_parity_reclass_and_fast_sync.sql';
export const agdataV2382SuspendViewSchemaCompatMigrationName = '20261027050000_agdata_v2382_suspend_view_schema_compat.sql';
export const agdataV2382HlPoSetBasedPageStageMigrationName = '20261027060000_agdata_v2382_hl_po_set_based_page_stage.sql';
export const agdataV2383JdUniversalCustomerDirectoryMigrationName = '20261027124800_agdata_v2383_jd_universal_customer_directory.sql';
export const agdataV2384RuntimeRecoveryMigrationName = '20261027133509_agdata_v2384_runtime_recovery.sql';
export const agdataV2385ReclassOpenStockInlineOhMigrationName = '20261027143000_agdata_v2385_reclass_open_stock_and_inline_oh.sql';
export const agdataV2387ReclassPersistenceEvidenceMigrationName = '20261027163924_agdata_v2387_reclass_persistence_and_evidence.sql';
export const agdataV2387BatchReclassEvidenceMigrationName = '20261027171000_agdata_v2387_batch_reclass_evidence.sql';
export const agdataV2388UnifiedRuntimeRecoveryMigrationName = '20261027184835_agdata_v2388_unified_runtime_recovery.sql';
export const agdataV2389LiveRevisionBunchDraftMigrationName = '20261027200748_agdata_v2389_live_revision_and_bunch_draft_restore.sql';
export const agdataV2390UniversalFillTagBunchDylanReclassLotCapMigrationName = '20261027211049_agdata_v2390_universal_fill_tag_bunch_dylan_reclass_lot_cap.sql';
export const agdataV2390ReclassReceiptLiveStockDurabilityMigrationName = '20261027223716_agdata_v2390_reclass_receipt_and_live_stock_durability.sql';
export const agdataV2390PostgresManualSyncMigrationName = '20261028014500_agdata_v2390_postgres_manual_sync.sql';
export const agdataV2390LocalErpWorkerMigrationName = '20261028022000_agdata_v2390_local_erp_worker.sql';
export const agdataV2391CloudErpContinuationsMigrationName = '20261028040000_agdata_v2391_cloud_erp_continuations.sql';
export const agdataV2392JorgeAssignedLiveChangesMigrationName = '20261028070752_agdata_v2392_jorge_assigned_live_changes.sql';
export const agdataV2392SuspendCloseAvOptionsToastEvalFilterMigrationName = '20261028114955_agdata_v2392_suspend_close_av_options_toast_eval_filter.sql';
export const agdataV2394UniversalRequestDirectorySuspendIdentityMigrationName = '20261028145127_agdata_v2394_universal_request_directory_suspend_identity.sql';
export const agdataV2395InstantReclassNavigationMigrationName = '20261028172852_agdata_v2395_instant_reclass_and_navigation.sql';
export const agdataV2396BoundedErpRowCountMigrationName = "20261028190134_agdata_v2396_bounded_erp_row_count.sql";
export const agdataV2396CloudErpContinuationMigrationName = '20261028183832_agdata_v2396_cloud_erp_continuation.sql';
export const agdataV2397BulkReclassOverrideMigrationName = '20261028220500_agdata_v2397_bulk_reclass_override_import.sql';
export const agdataV2397TableManagementMigrationName = '20261028221000_agdata_table_management_v2397.sql';
export const agdataV2397CustomerMappingCrudMigrationName = '20261028222000_agdata_customer_mapping_crud_v2397.sql';
export const agdataV2397UserLifecycleMigrationName = '20261028222500_agdata_user_lifecycle_v2397.sql';
export const releaseDatabaseMigrations = Object.freeze([migrationName, perennialAssignmentMigrationName, passwordReconciliationMigrationName, productionScheduleMigrationName, auraHrCommandCenterMigrationName, scheduledHandoverMigrationName, requestArchiveMigrationName, handoverAssignmentMigrationName, readOptimizationMigrationName, auraInventoryV2MigrationName, nellyAccessAuditMigrationName, evalDeliveryArchiveHealthMigrationName, auraInventoryMatchMigrationName, auraLlmFreeTierMigrationName, suspendTagApprovalMigrationName, structuredBunchNotesMigrationName, bunchNoteCardsMigrationName, bunchNoteCardCommandsMigrationName, reclassSplitMoveMigrationName, reclassEvalSubmitGuardsMigrationName, inventoryRowAssignmentAuthorityMigrationName, itemcodeDefaultOwnersMigrationName, inventoryRowAssignmentFenceIntegrationMigrationName, inventoryRowAssignmentFutureSnapshotsMigrationName, inventoryRowAssignmentLiveConsumersMigrationName, auraInternalQueryMigrationName, auraCommonNamePriorityMigrationName, auraDynamicSeasonScopeMigrationName, auraInventoryExplicitProjectionMigrationName, sqlFunctionCorrectnessRepairsMigrationName, sqlLintRuntimeContextMigrationName, reclassShearedMigrationName, reclassSmartShieldMigrationName, smartShieldRawImportMigrationName, requestQueueRemoveMigrationName, prompt25HotfixMigrationName, customerRepMappingMigrationName, bunchAutoCompletionMigrationName, fieldCountingMigrationName, customerRepMappingFinalizeTimeoutMigrationName, historicalRequestsMigrationName, auraVoiceRoleAccessMigrationName, auraVoiceSocReadsMigrationName, requestMappingIdentityMigrationName, historicalRequestsPriceFallbackMigrationName, reclassConcurrentHoldMigrationName, salesActorRoleBoundariesMigrationName, navigationRoleBoundariesMigrationName, requestHistoryDrilldownMigrationName, auraEnterpriseDomainVoiceMigrationName, managerReportReadV2MigrationName, managerListReadV2MigrationName, inventoryLocationOnHandMigrationName, masterInventoryRealtimeMigrationName, eval2SharedLowStockThresholdMigrationName, masterLineageCleanupMigrationName, seasonSalesCavLookupMigrationName, seasonSalesEmptyCleanupMigrationName, seasonSalesWorklistMigrationName, inventoryAssignmentBatchesMigrationName, inventoryAssignmentWitnessMigrationName, inventoryAssignmentInputGenerationMigrationName, customerAssignmentOverridesMigrationName, bulkMasterSnapshotMigrationName, importHistoryRoutingMigrationName, handoverMasterAssignmentFastPathMigrationName, bulkContextIndexPlanMigrationName, managerModuleRevisionSignalsMigrationName, inventoryReclassMovesMigrationName, inventoryReclassQuantityTriggerFastpathsMigrationName, inventoryReclassCompactTriggerIdentityMigrationName, inventoryReclassCompactBatchChildReceiptsMigrationName, inventoryReclassNullElisionRpcMigrationName, masterIdentityBatchReadMigrationName, bunchNoteMultiAssignmentRoutingMigrationName, bunchNoteBlueprintHeaderPdfDeliveryMigrationName, bunchNoteQueueExecutionMigrationName, bunchNoteSupervisorAssigneeFacetsMigrationName, suspendTagSenderIdentityMigrationName, canonicalUserAccessMigrationName, inventoryReclassMoveDeliveryMigrationName, masterSnapshotChunkedStagingMigrationName, masterIdentityBatchRetrySqlstateMigrationName, reclassEmailReportPolicyMigrationName, publishedLkgReadProofMigrationName, reclassServerRevisionMigrationName, reclassRepScopeMigrationName, managerPublishedReadMigrationName, importSourceMetadataMigrationName, masterPrioritySplitMigrationName, fullAppAdministratorsMigrationName, protectedRequestNaMigrationName, zeroTrustRlsMigrationName, appLoginRateLimitMigrationName, managerReportSetBasedReadMigrationName, managerEval2BatchedPreviewMigrationName, auraDylanOwnerOnlyMigrationName, suspendExistingReviewMigrationName, suspendCandidatesRequestPreloadMigrationName, requestWorkSyncStatusMigrationName, applicationConflictRetryMigrationName, operationalLookupIndexesMigrationName, masterChunkLedgerCapacityMigrationName, inventoryOverrideReconciliationMigrationName, evalBrowseSuspendReceiptsMigrationName, reclassSeasonStockMigrationName, inventoryProjectsMigrationName, masterSnapshotSourceDedupMigrationName, masterSnapshotAliasDedupMigrationName, masterSnapshotIdentityDedupMigrationName, masterSnapshotDuplicateMapMigrationName, reclassPhysicalStockMigrationName, dashboardWarningCleanupMigrationName, driveLocationEvidenceMigrationName, boundedRequestQueueReconciliationMigrationName, requestQuantityRecoveryMigrationName, inventoryLocationEvidenceLifecycleMigrationName, requestSalesImpactMigrationName, requestSalesImpactV2MigrationName, requestSalesImpactStrictDedupeMigrationName, requestQueuePendingReconciliationMigrationName, requestQueueLegacyOutboxReconciliationMigrationName, escapedDisplayTextNormalizationMigrationName, requestLifecycleStateMachineMigrationName, agdataV2379CompleteReclassDestinationRowLoopMigrationName, agdataV2379ReclassLocationEvidenceMigrationName, agdataV2380ReclassPreEditReportsMigrationName, agdataV2381FastErpStageRpcsMigrationName, agdataV2382DriveParityReclassAndFastSyncMigrationName, agdataV2382SuspendViewSchemaCompatMigrationName, agdataV2382HlPoSetBasedPageStageMigrationName, agdataV2383JdUniversalCustomerDirectoryMigrationName, agdataV2384RuntimeRecoveryMigrationName, agdataV2385ReclassOpenStockInlineOhMigrationName, agdataV2395InstantReclassNavigationMigrationName, agdataV2396CloudErpContinuationMigrationName, agdataV2396BoundedErpRowCountMigrationName, agdataV2397BulkReclassOverrideMigrationName, agdataV2397TableManagementMigrationName, agdataV2397CustomerMappingCrudMigrationName, agdataV2397UserLifecycleMigrationName]);

export const registeredReleaseDatabaseMigrations = Object.freeze([
  ...releaseDatabaseMigrations,
  agdataV2387ReclassPersistenceEvidenceMigrationName,
  agdataV2387BatchReclassEvidenceMigrationName,
  agdataV2388UnifiedRuntimeRecoveryMigrationName,
  agdataV2389LiveRevisionBunchDraftMigrationName,
  agdataV2390UniversalFillTagBunchDylanReclassLotCapMigrationName,
  agdataV2390ReclassReceiptLiveStockDurabilityMigrationName,
  agdataV2390PostgresManualSyncMigrationName,
  agdataV2390LocalErpWorkerMigrationName,
  agdataV2391CloudErpContinuationsMigrationName,
  agdataV2392JorgeAssignedLiveChangesMigrationName,
  agdataV2392SuspendCloseAvOptionsToastEvalFilterMigrationName,
  agdataV2394UniversalRequestDirectorySuspendIdentityMigrationName,
  unifiedRequestSyncSalesImpactMigrationName,
  agdataV2361SurgicalRestoreMigrationName,
  agdataV2362CanonicalRequestsMigrationName,
  agdataV2362LegacyCleanupMigrationName,
  agdataV2363UniformActiveHistoryMigrationName,
  agdataV2364RequestBrowserCompatibilityMigrationName,
  agdataV2364LocationEvidenceRepairCompatibilityMigrationName,
  agdataV2365AnonSecurityHardeningMigrationName,
  agdataV2365SalesImpactUnionFixMigrationName,
  agdataV2366HistoricalArchiveMigrationName,
  agdataV2366FastHistoricalRequestsMigrationName,
  agdataV2366QueueResolutionCleanupMigrationName,
  agdataV2366HistoricalStateDedupMigrationName,
  agdataV2366InventoryConsolidationMigrationName,
  agdataV2366InventoryConsolidationSalesYearFixMigrationName,
  agdataV2366InventoryConsolidationCacheMigrationName,
  agdataV2366HistoricalArchivePageDedupMigrationName,
  agdataV2366DriveArchiveSearchHashFixMigrationName,
  agdataV2367CropTierAuraGlossaryMigrationName,
  agdataV2367HistoricalDriveFastReadMigrationName,
  agdataV2368RequestPhotoAvNavigationMigrationName,
  agdataV2368MasterPhotoDatePreservationMigrationName,
  agdataV2368AvNoteSanitizerMigrationName,
  agdataV2368HistoricalPhotoDateKeyFixMigrationName,
  agdataV2369FastLiveErpIngestionMigrationName,
  agdataV2369EmergencyRecoveryMigrationName,
  agdataV2369PrivateDeliveryBoundaryMigrationName,
  agdataV2370WatchdogRequestRecoveryMigrationName,
  agdataV2371RequestSuspendEmailLockCleanupMigrationName,
  agdataV2372RequestCompletionAcknowledgmentMigrationName,
  agdataV2372RequestCompletionDeliveryMigrationName,
  agdataV2373FastAppsScriptErpImportUnblockMigrationName,
  agdataV2373DriveTimeoutRecoveryMigrationName,
  agdataV2374UnifiedFastBaselineSuspendReclassEmailMigrationName,
  agdataV2375SuspendCardsFastBatchSyncMigrationName,
  agdataV2376InstantLoginFastSuspendMigrationName,
  agdataV2377SuspendReadContinuityMigrationName,
  agdataV2378FullAuditRemediationMigrationName,
]);

export function normalizeScopedMigrationPaths(migrationPaths) {
  if (!Array.isArray(migrationPaths) || migrationPaths.length === 0) {
    throw new Error('LOW_STOCK_SCOPED_MIGRATIONS_INVALID');
  }
  const normalized = [];
  const seen = new Set();
  for (const entry of migrationPaths) {
    if (typeof entry !== 'string' || !entry.trim()) throw new Error('LOW_STOCK_SCOPED_MIGRATIONS_INVALID');
    const repoPath = entry.trim().replaceAll('\\', '/');
    const basename = path.posix.basename(repoPath);
    if (!registeredReleaseDatabaseMigrations.includes(basename)) throw new Error('LOW_STOCK_SCOPED_MIGRATION_NOT_ALLOWLISTED');
    const directory = baselineIncludedMigrations.has(basename) ? 'archive_migrations' : 'migrations';
    if (repoPath !== basename && repoPath !== `supabase/${directory}/${basename}`) {
      throw new Error('LOW_STOCK_SCOPED_MIGRATION_PATH_INVALID');
    }
    if (seen.has(basename)) throw new Error('LOW_STOCK_SCOPED_MIGRATION_DUPLICATE');
    seen.add(basename);
    normalized.push(basename);
  }
  return normalized;
}
// Selected paths come from the authorized exact-commit release scope, never a receipt file.
export function selectReleaseMigrations(value = process.env.RELEASE_MIGRATIONS) {
  if (value === undefined) return registeredReleaseDatabaseMigrations;
  let paths;
  try { paths = JSON.parse(value); }
  catch { throw new Error('LOW_STOCK_SCOPED_MIGRATIONS_INVALID'); }
  if (!Array.isArray(paths)) throw new Error('LOW_STOCK_SCOPED_MIGRATIONS_INVALID');
  return paths.length ? normalizeScopedMigrationPaths(paths) : [];
}

const baselineIncludedMigrations = new Set([migrationName, perennialAssignmentMigrationName, passwordReconciliationMigrationName]);
export const productionBaselineVersion = '20260929200000';

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EADDRNOTAVAIL'
]);
const TLS_ERROR_CODES = new Set([
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_SSL_WRONG_VERSION_NUMBER'
]);
const SAFE_ERROR_MARKERS = new Set([
  'LOW_STOCK_SUPABASE_DB_URL_MISSING', 'LOW_STOCK_DATABASE_TARGET_INVALID',
  'LOW_STOCK_DATABASE_TARGET_MISMATCH', 'LOW_STOCK_DATABASE_TLS_REQUIRED',
  'LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED', 'LOW_STOCK_MIGRATION_HISTORY_MISMATCH',
  'LOW_STOCK_DATABASE_CONTRACT_MISSING', 'LOW_STOCK_CLOUD_MAIN_REQUIRED',
  'LOW_STOCK_RELEASE_IDENTITY_REQUIRED', 'LOW_STOCK_CURRENT_MAIN_REQUIRED',
  'LOW_STOCK_DIAGNOSTIC_CONTEXT_INVALID', 'LOW_STOCK_DIAGNOSTIC_WORKFLOW_INVALID',
  'LOW_STOCK_ARGUMENTS_INVALID', 'LOW_STOCK_SUPABASE_ACCESS_TOKEN_MISSING',
  'LOW_STOCK_SUPABASE_PROJECT_LINK_INVALID', 'LOW_STOCK_SUPABASE_CLI_QUERY_FAILED',
  'LOW_STOCK_SUPABASE_CLI_NOT_FOUND', 'LOW_STOCK_SUPABASE_CLI_AUTH_FAILED',
  'LOW_STOCK_SUPABASE_CLI_PROJECT_LINK_FAILED', 'LOW_STOCK_SUPABASE_CLI_NETWORK_FAILED',
  'LOW_STOCK_SUPABASE_CLI_QUERY_REJECTED', 'LOW_STOCK_SUPABASE_CLI_MULTISTATEMENT_UNSUPPORTED',
  'LOW_STOCK_SUPABASE_CLI_API_NOT_FOUND', 'LOW_STOCK_SUPABASE_CLI_RATE_LIMITED',
  'LOW_STOCK_SUPABASE_CLI_API_FAILED',
  'LOW_STOCK_SUPABASE_CLI_OUTPUT_INVALID', 'LOW_STOCK_MIGRATION_HISTORY_CHANGED'
]);

export function validateDatabaseTarget(connectionString, supabaseUrl) {
  if (!connectionString) throw new Error('LOW_STOCK_SUPABASE_DB_URL_MISSING');
  let database, api;
  try { database = new URL(connectionString); api = new URL(supabaseUrl); }
  catch { throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID'); }
  const match = api.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (api.protocol !== 'https:' || !match || !['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID');
  }
  const user = decodeURIComponent(database.username);
  const direct = database.hostname === `db.${match[1]}.supabase.co` && user === 'postgres';
  const pooler = database.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${match[1]}`;
  if ((!direct && !pooler) || !database.password || database.pathname !== '/postgres') throw new Error('LOW_STOCK_DATABASE_TARGET_MISMATCH');
  if (pooler && database.port === '6543') database.port = '5432';
  // pg merges query parameters over authority fields. Do not allow host/user
  // query overrides to redirect this narrowly scoped production operation.
  const allowed = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'application_name']);
  for (const key of database.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error('LOW_STOCK_DATABASE_TARGET_INVALID');
  }
  if (!database.searchParams.has('sslmode')) database.searchParams.set('sslmode', 'verify-full');
  if (!['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode'))) {
    throw new Error('LOW_STOCK_DATABASE_TLS_REQUIRED');
  }
  // This operation always verifies both the trusted CA and database hostname.
  database.searchParams.set('sslmode', 'verify-full');
  return database.toString();
}

const POSTGRES_TLS_QUERY_PARAMETERS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

export function createDatabaseClientOptions(connectionString) {
  // `pg-connection-string` lets SSL query parameters replace `Client`'s
  // `ssl` object. The URL has already passed validateDatabaseTarget; remove
  // those options here so only this client uses the pinned, verified CA.
  const database = new URL(connectionString);
  for (const parameter of POSTGRES_TLS_QUERY_PARAMETERS) database.searchParams.delete(parameter);
  const hostname = database.hostname;
  const ca = fs.readFileSync(new URL('./certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
  return {
    connectionString: database.toString(),
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
    ssl: {
      ca,
      rejectUnauthorized: true,
      // Make the expected DNS identity explicit. TLS verification remains
      // enabled and is bound to the already-validated database host.
      servername: hostname
    }
  };
}

export function summarizeDatabaseTarget(connectionString) {
  const database = new URL(connectionString);
  const port = Number(database.port || 5432);
  const route = /^db\.[a-z0-9]+\.supabase\.co$/.test(database.hostname)
    ? (port === 6543 ? 'dedicated_pooler' : 'direct')
    : database.hostname.endsWith('.pooler.supabase.com') ? 'pooler' : 'unknown';
  const sslmode = database.searchParams.get('sslmode') || 'require';
  return {
    route,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
    sslmode: ['require', 'verify-ca', 'verify-full'].includes(sslmode) ? sslmode : 'other'
  };
}

export function classifyDatabaseError(error) {
  let code = '';
  try { code = typeof error?.code === 'string' ? error.code : ''; } catch { /* hostile error getter */ }
  if (NETWORK_ERROR_CODES.has(code)) return { errorClass: 'network', errorCode: code };
  if (TLS_ERROR_CODES.has(code)) return { errorClass: 'tls', errorCode: code };
  if (/^[0-9A-Z]{5}$/.test(code)) return { errorClass: 'postgres', errorCode: code };
  return { errorClass: 'other', errorCode: '' };
}

const DIAGNOSTIC_PHASES = new Set([
  'diagnostic_authorization', 'target_validation', 'release_ref', 'database_connect',
  'linked_cli_migrations',
  'transaction_begin', 'advisory_lock', 'migration_history_read', 'migration_sql',
  'migration_history_write', 'contract_check', 'transaction_commit', 'schema_probe',
  'transaction_rollback', 'client_close'
]);

export function formatSafeFailure({ phase, error, connectionString = '' }) {
  const safePhase = DIAGNOSTIC_PHASES.has(phase) ? phase : 'unknown';
  let marker = 'LOW_STOCK_SCHEMA_APPLY_FAILED';
  try {
    if (typeof error?.message === 'string' && SAFE_ERROR_MARKERS.has(error.message)) marker = error.message;
  } catch { /* hostile error getter */ }
  const classified = classifyDatabaseError(error);
  let summary = null;
  try { if (connectionString) summary = summarizeDatabaseTarget(connectionString); } catch { /* invalid URLs are omitted */ }
  const target = summary ? ` route=${summary.route} port=${summary.port} sslmode=${summary.sslmode}` : '';
  const code = classified.errorCode ? ` error_code=${classified.errorCode}` : '';
  return `${marker} phase=${safePhase} error_class=${classified.errorClass}${code}${target}`;
}

export function classifySupabaseCliFailure(result) {
  const errorCode = result?.error && typeof result.error.code === 'string' ? result.error.code : '';
  if (errorCode === 'ENOENT') return 'LOW_STOCK_SUPABASE_CLI_NOT_FOUND';
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`.slice(0, 32_000);
  const marker = [...SAFE_ERROR_MARKERS].find(value => output.includes(value));
  if (marker) return marker;
  const statusCode = Number(output.match(/(?:unexpected\s+)?status(?:\s+code)?\s*[:=]?\s*([1-5]\d{2})|http\s+([1-5]\d{2})/i)?.slice(1).find(Boolean) || 0);
  if ([401, 403].includes(statusCode) || /unauthori[sz]ed|invalid (?:access )?token|token (?:is )?(?:invalid|expired)|http\s*401/i.test(output)) {
    return 'LOW_STOCK_SUPABASE_CLI_AUTH_FAILED';
  }
  if (statusCode === 404) return 'LOW_STOCK_SUPABASE_CLI_API_NOT_FOUND';
  if (statusCode === 429 || /rate.?limit|too many requests/i.test(output)) return 'LOW_STOCK_SUPABASE_CLI_RATE_LIMITED';
  if (statusCode >= 500) return 'LOW_STOCK_SUPABASE_CLI_API_FAILED';
  if (/forbidden|insufficient (?:scope|permission)/i.test(output)) return 'LOW_STOCK_SUPABASE_CLI_AUTH_FAILED';
  if (/project(?:\s+ref)?[^\n]*(?:not linked|not found)|not linked[^\n]*project/i.test(output)) {
    return 'LOW_STOCK_SUPABASE_CLI_PROJECT_LINK_FAILED';
  }
  if (/IPv6 is not supported|IPv4 connection|run supabase link --project-ref/i.test(output)) {
    return 'LOW_STOCK_SUPABASE_CLI_PROJECT_LINK_FAILED';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONN(?:REFUSED|RESET)|ETIMEDOUT|TLS handshake|connection timed out/i.test(output)) {
    return 'LOW_STOCK_SUPABASE_CLI_NETWORK_FAILED';
  }
  if (/SQLSTATE|postgres(?:ql)? error|failed to run sql|query execution failed|permission denied for/i.test(output)) {
    return 'LOW_STOCK_SUPABASE_CLI_QUERY_REJECTED';
  }
  if (/cannot insert multiple commands into a prepared statement/i.test(output)) {
    return 'LOW_STOCK_SUPABASE_CLI_MULTISTATEMENT_UNSUPPORTED';
  }
  return 'LOW_STOCK_SUPABASE_CLI_QUERY_FAILED';
}

export function validateDiagnosticContext(env) {
  const validRepository = /^[\w.-]+\/[\w.-]+$/.test(String(env.GITHUB_REPOSITORY || ''));
  const validSha = /^[a-f0-9]{40}$/.test(String(env.GITHUB_SHA || ''));
  const ref = String(env.GITHUB_REF || '');
  const allowedRef = ref === 'refs/heads/main';
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || !validRepository || !validSha || !allowedRef || ref.includes('..') || ref.endsWith('/')) {
    throw new Error('LOW_STOCK_DIAGNOSTIC_CONTEXT_INVALID');
  }
  const expectedWorkflowRef = `${env.GITHUB_REPOSITORY}/.github/workflows/apps-script-database-diagnostic.yml@${ref}`;
  if (!env.GITHUB_WORKFLOW_REF || env.GITHUB_WORKFLOW_REF !== expectedWorkflowRef) {
    throw new Error('LOW_STOCK_DIAGNOSTIC_WORKFLOW_INVALID');
  }
  return { repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, ref };
}

export async function runReadOnlySchemaDiagnostic({ client, onPhase = () => {} }) {
  let transactionOpen = false;
  let result;
  let failure;
  let failurePhase = '';
  let currentPhase = '';
  const setPhase = value => { currentPhase = value; onPhase(value); };
  try {
    setPhase('transaction_begin');
    await client.query('begin read only');
    transactionOpen = true;
    setPhase('schema_probe');
    result = await client.query("select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed");
  } catch (error) {
    failure = error;
    failurePhase = currentPhase;
  }
  if (transactionOpen) {
    setPhase('transaction_rollback');
    try { await client.query('rollback'); }
    catch (error) { if (!failure) { failure = error; failurePhase = currentPhase; } }
  }
  if (failure) { setPhase(failurePhase); throw failure; }
  return { installed: result?.rows?.[0]?.installed === true };
}

// The current V7 body may be behind the service-only Sales Rep scope wrapper.
// Follow only the exact secure delegation; an unrelated private function is
// never sufficient evidence that the public entry point uses the contract.
const reclassV7ImplementationOid = `case when exists (
  select 1 from pg_proc wrapper where wrapper.oid=to_regprocedure('public.enqueue_drive_reclass_inquiry_v7(jsonb)')
    and wrapper.prosecdef and wrapper.proconfig @> array['search_path=""']
    and position('result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_payload);' in wrapper.prosrc)>0
    and has_function_privilege('service_role',wrapper.oid,'execute')
    and not has_function_privilege('authenticated',wrapper.oid,'execute')
    and not has_function_privilege('anon',wrapper.oid,'execute'))
  then to_regprocedure('private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)')
  else to_regprocedure('public.enqueue_drive_reclass_inquiry_v7(jsonb)') end`;

export function migrationContractQuery(name) {
  if (name === agdataV2397BulkReclassOverrideMigrationName) return `select
    to_regprocedure('private.apply_inventory_live_overrides_bulk_v1(uuid)') is not null
    and position('apply_inventory_live_overrides_bulk_v1(p_run_id)' in pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure))>0
    and not has_function_privilege('anon','private.apply_inventory_live_overrides_bulk_v1(uuid)','execute')
    and not has_function_privilege('authenticated','private.apply_inventory_live_overrides_bulk_v1(uuid)','execute') as installed`;
  if (name === agdataV2397UserLifecycleMigrationName) return `select
    to_regprocedure('public.sync_native_auth_app_access_code_v2397(text,text)') is not null
    and to_regprocedure('public.deactivate_user_access_v2397(uuid,text,uuid,bigint)') is not null
    and to_regprocedure('public.update_user_access_profile_v2397(uuid,text,text,text,uuid,bigint)') is not null
    and not has_function_privilege('authenticated','public.update_user_access_profile_v2397(uuid,text,text,text,uuid,bigint)','execute')
    and position('USER_ACCESS_SELF_DEACTIVATION_FORBIDDEN' in pg_get_functiondef('public.deactivate_user_access_v2397(uuid,text,uuid,bigint)'::regprocedure))>0
    and not has_function_privilege('anon','public.sync_native_auth_app_access_code_v2397(text,text)','execute')
    and not has_function_privilege('authenticated','public.deactivate_user_access_v2397(uuid,text,uuid,bigint)','execute')
    and has_function_privilege('service_role','public.deactivate_user_access_v2397(uuid,text,uuid,bigint)','execute')
    as installed`;
  if (name === agdataV2397CustomerMappingCrudMigrationName) return `select
    to_regclass('sales_private.customer_mapping_rows_v2397') is not null
    and to_regprocedure('sales_private.replay_customer_mapping_rows_v2397()') is not null
    and position('replay_customer_mapping_rows_v2397' in pg_get_functiondef('public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure))>0
    and position('CUSTOMER_REP_MAPPING_VALUE_PROTECTED' in pg_get_functiondef('public.customer_rep_mapping_manage_v1(uuid,text,jsonb)'::regprocedure))>0
    and not has_function_privilege('anon','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and not has_function_privilege('authenticated','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and has_function_privilege('service_role','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    as installed`;
  if (name === agdataV2397TableManagementMigrationName) return `select
    to_regclass('public.ph_company_directory') is not null
    and to_regclass('public.ph_inquiry_coverage') is not null
    and has_function_privilege('service_role','public.manager_table_management_v2397(uuid,text,text,jsonb)','execute')
    and not has_function_privilege('anon','public.manager_table_management_v2397(uuid,text,text,jsonb)','execute')
    and not has_function_privilege('authenticated','public.manager_table_management_v2397(uuid,text,text,jsonb)','execute')
    and position('MANAGER_TABLE_READ_ONLY' in pg_get_functiondef('public.manager_table_management_v2397(uuid,text,text,jsonb)'::regprocedure))>0 as installed`;
  if (name === masterSnapshotDuplicateMapMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)')
      and position('duplicate_canonical as materialized' in p.prosrc)>0
      and position('keeper_live.unique_id = keeper_mapped.canonical_unique_id' in p.prosrc)>0) as installed`;
  if (name === masterSnapshotIdentityDedupMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)')
      and position('duplicate_s.lineage_key = s.lineage_key' in p.prosrc)>0
      and position('duplicate_s.stable_identity_key = s.stable_identity_key' in p.prosrc)>0) as installed`;
  if (name === masterSnapshotAliasDedupMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)')
      and position('duplicate_mapped.canonical_unique_id' in p.prosrc)>0) as installed`;
  if (name === masterSnapshotSourceDedupMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)')
      and position('select distinct on (coalesce(c.canonical_unique_id' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)')
      and position('select distinct on (coalesce(c.canonical_unique_id' in p.prosrc)>0) as installed`;
  if (name === inventoryProjectsMigrationName) return `select
    to_regclass('public.inventory_projects') is not null
    and to_regclass('public.inventory_project_rows') is not null
    and to_regprocedure('public.recover_stale_master_imports_v1(timestamptz)') is not null
    and (select relrowsecurity from pg_class where oid='public.inventory_projects'::regclass)
    and (select relrowsecurity from pg_class where oid='public.inventory_project_rows'::regclass)
    and has_function_privilege('service_role','public.recover_stale_master_imports_v1(timestamptz)','execute')
    and not has_function_privilege('authenticated','public.recover_stale_master_imports_v1(timestamptz)','execute')
    and position('actor_role not in' in pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure))>0
    and position('dylan_collyge' in pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure))>0 as installed`;
  if (name === evalBrowseSuspendReceiptsMigrationName) return `select position('browseColumns' in pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure))>0 and position('removed_false_block' in pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0 and not has_function_privilege('authenticated','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','EXECUTE') as installed`;
  if (name === inventoryOverrideReconciliationMigrationName) return `select to_regclass('app_sync_private.inventory_live_overrides_v1') is not null and exists(select 1 from pg_trigger where tgrelid='public.ph_master_inventory'::regclass and tgname='zz_inventory_live_overrides' and tgenabled='O') and position('v7FrozenRows' in pg_get_functiondef('public.retry_drive_reclass_inquiry_v1(text,text)'::regprocedure))>0 as installed`;
  if (name === masterChunkLedgerCapacityMigrationName) return `select exists(select 1 from pg_constraint where conrelid='app_sync_private.ph_master_snapshot_stage_chunks_v1'::regclass and conname='ph_master_snapshot_stage_chunks_v1_row_count_check' and convalidated and position('2000' in pg_get_constraintdef(oid))>0) as installed`;
  if (name === operationalLookupIndexesMigrationName) return `select count(*)=13 and bool_and(i.indisvalid and i.indisready) as installed from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('ph_master_inventory_item_loc_lot_idx','ph_master_inventory_location_idx','ph_master_inventory_commonname_idx','ph_soc_master_dock_stop_item_idx','ph_soc_master_item_loc_lot_idx','ph_soc_master_location_idx','ph_soc_master_last_updated_idx','ph_customer_rep_name_tuple_idx','ph_warehouse_assigned_item_loc_idx','ph_active_request_item_loc_idx','ph_active_request_status_updated_idx','ph_request_history_item_loc_idx','ph_request_history_status_updated_idx')`;
  if (name === applicationConflictRetryMigrationName) return String.raw`select not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','app_sync_private','suspend_tag_private') and p.prokind='f' and p.prosrc ~* $pattern$errcode\s*=\s*'40001'$pattern$) and position('PT409' in pg_get_functiondef(to_regprocedure('public.manager_report_read_v2(jsonb)')))>0 and exists(select 1 from pg_constraint where conrelid='app_sync_private.ph_master_snapshot_stage_v1'::regclass and conname='ph_master_snapshot_stage_v1_check' and position('2000' in pg_get_constraintdef(oid))>0) and exists(select 1 from pg_policies where schemaname='public' and tablename='ph_27s1_hl_po' and policyname='ph_27s1_hl_po_manager_read' and position('SELECT auth.uid()' in qual)>0) as installed`;
  if (name === requestWorkSyncStatusMigrationName) return `select
    to_regprocedure('public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)') is not null
    and to_regclass('public.app_manual_sync_status') is not null
    and not has_function_privilege('authenticated','public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)','execute')
    and position('if complete then expected_version := existing.row_version' in pg_get_functiondef('public.save_request_work(text,bigint,jsonb,boolean)'::regprocedure))>0
    and position('> 2000' in pg_get_functiondef('public.append_master_snapshot_stage_chunk_v1(uuid,uuid,integer,jsonb)'::regprocedure))>0 as installed`;

  if (name === suspendCandidatesRequestPreloadMigrationName) return `select
    to_regprocedure('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)') is not null
    and position('suspend_tag_private.group_command' in p.prosrc)>0
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_soc_master' and column_name='suspend_candidate_state')
    and exists(select 1 from pg_proc q where q.oid='public.customer_rep_mapping_manage_v1(uuid,text,jsonb)'::regprocedure and position('preload' in q.prosrc)>0)
    and not has_function_privilege('authenticated','suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)','execute')
    as installed from pg_proc p where p.oid='public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)'::regprocedure`;

  if (name === suspendExistingReviewMigrationName) return `select
    to_regprocedure('suspend_tag_private.existing_review(public.ph_soc_master)') is not null
    and position('suspend_tag_private.existing_review(edited)' in p.prosrc)>0
    and position('sibling.itemcode=s.itemcode' in p.prosrc)>0
    and position('SUSPEND_TAG_SOURCE_CHANGED' in p.prosrc)>0 as installed
    from pg_proc p where p.oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure`;

  if (name === auraDylanOwnerOnlyMigrationName) return `select count(*)=4 and bool_and(
    p.prosecdef
    and has_function_privilege('authenticated',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute')
    and position(case when p.proname='aura_voice_soc_read_v1'
      then $guard$coalesce(lower(btrim(actor_name)),'')<>'dylan_collyge'$guard$
      else $guard$coalesce(lower(btrim(actor.username)),'')<>'dylan_collyge'$guard$ end in p.prosrc)>0
    and (p.proname<>'aura_voice_access_v1' or not has_function_privilege('service_role',p.oid,'execute'))
    ) as installed from pg_proc p where p.oid in (
      to_regprocedure('public.aura_voice_access_v1()'),
      to_regprocedure('public.aura_voice_context_v1()'),
      to_regprocedure('public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)'),
      to_regprocedure('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'))`;
  if (name === managerEval2BatchedPreviewMigrationName) return `select
    p.prosecdef and p.provolatile='s' and p.proconfig @> array['search_path=""']
    and position('eval2_preview_candidates as materialized' in p.prosrc)>0
    and position('preview_ordinal<=18' in p.prosrc)>0
    and position('reportMatchCount' in p.prosrc)>0
    and position('manager_report_actor_required' in p.prosrc)>0
    and position('manager_report_eval2_forbidden' in p.prosrc)>0
    and position('published_snapshot_read_proof' in p.prosrc)>0
    and position('manager_report_source_revision_changed' in p.prosrc)>0
    and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')
    and has_function_privilege('service_role',p.oid,'execute') as installed
    from pg_proc p where p.oid=to_regprocedure('public.manager_report_read_v2(jsonb)')`;
  if (name === managerReportSetBasedReadMigrationName) return `select
    p.prosecdef and p.provolatile='s' and p.proconfig @> array['search_path=""']
    and position('active_assignment_users as materialized' in p.prosrc)>0
    and position('page_keys as materialized' in p.prosrc)>0
    and position('manager_report_actor_required' in p.prosrc)>0
    and position('manager_report_eval2_forbidden' in p.prosrc)>0
    and position('published_snapshot_read_proof' in p.prosrc)>0
    and position('manager_report_source_revision_changed' in p.prosrc)>0
    and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')
    and has_function_privilege('service_role',p.oid,'execute') as installed
    from pg_proc p where p.oid=to_regprocedure('public.manager_report_read_v2(jsonb)')`;

  if (name === appLoginRateLimitMigrationName) return `select
    to_regclass('private.app_login_rate_limits_v1') is not null
    and to_regprocedure('public.app_login_rate_limit_v1(text,text,text)') is not null
    and has_function_privilege('service_role','public.app_login_rate_limit_v1(text,text,text)','EXECUTE')
    and not has_function_privilege('anon','public.app_login_rate_limit_v1(text,text,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.app_login_rate_limit_v1(text,text,text)','EXECUTE') as installed`;
  if (name === zeroTrustRlsMigrationName) return `select
    not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity)
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','v','m','f')
        and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
          or has_table_privilege('anon',c.oid,'DELETE') or has_table_privilege('anon',c.oid,'TRUNCATE')
          or has_any_column_privilege('anon',c.oid,'INSERT') or has_any_column_privilege('anon',c.oid,'UPDATE')))
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind in ('f','p') and (p.provolatile='v' or p.prosecdef)
        and has_function_privilege('anon',p.oid,'EXECUTE')) as installed`;
  if (name === fullAppAdministratorsMigrationName) return `select
    to_regprocedure('private.is_full_app_administrator_v1(text)') is not null
    and (select count(*) from public.user_access_control where username in ('dylan_collyge','megan_kelly','jd_jones')
      and active and canonical_role='admin' and not exists(select 1 from jsonb_each(permission_overrides) f where f.value<>'true'::jsonb))=3
    and not exists(select 1 from public.user_access_control where username not in ('dylan_collyge','megan_kelly','jd_jones')
      and permission_overrides->'can_manage_user_access' is distinct from 'false'::jsonb) as installed`;
  if (name === protectedRequestNaMigrationName) return `select
    to_regprocedure('sales_private.ensure_request_na_customer_mappings_v1(uuid)') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ph_customer_consignee_sales_reps'::regclass
      and tgname='protect_request_na_customer_mapping_v1' and not tgisinternal)
    and position('ensure_request_na_customer_mappings_v1(p_run_id)' in pg_get_functiondef('public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure))>0 as installed`;
  if (name === masterPrioritySplitMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.is_master_priority_split_v1(uuid,text)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('pending_legacy_sync' in p.prosrc)>0
      and position('ph_inventory_reclass_movements_v1' in p.prosrc)>0
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)')
      and position('private.is_master_priority_split_v1(p_request_id,s.unique_id)' in p.prosrc)>0
      and position('BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS' in p.prosrc)>0) as installed`;
  if (name === managerPublishedReadMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.manager_report_read_v2(jsonb)')
      and position('published_snapshot_read_proof' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.manager_ncr_outbox_metadata_v1(text,text)')
      and position('published_snapshot_read_proof' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)')
      and position('published_snapshot_read_proof' in p.prosrc)>0 and position('publishedReadable' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.manager_report_enrich_location_on_hand_v1(jsonb,boolean)')
      and position('published_snapshot_read_proof' in p.prosrc)>0) as installed`;
  if (name === importSourceMetadataMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.finish_dataset_import_with_sources_v1(uuid,jsonb)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('IMPORT_SOURCE_REPLAY_SUPERSEDED' in p.prosrc)>0
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.snapshot(text[])')
      and position('sourceFileName' in p.prosrc)>0) as installed`;
  if (name === reclassRepScopeMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.enqueue_drive_reclass_inquiry_v7(jsonb)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_payload);' in p.prosrc)>0
      and position('auth.role() is distinct from ''service_role''' in p.prosrc)>0
      and position('actor_count<>1' in p.prosrc)>0
      and position('DRIVE_RECLASS_PROFILE_NOT_ACTIVE' in p.prosrc)>0
      and position('navigation_module_allowed_v1' in p.prosrc)>0
      and position('app_access_user_overrides' in p.prosrc)>0
      and position('SALES_REP_OPERATION_FORBIDDEN' in p.prosrc)>0
      and position('fieldEdits' in p.prosrc)>0
      and position('exception when others then' in p.prosrc)>0
      and position('set_config(''gnc.sales_rep_operation_actor'',previous_scope,true)' in p.prosrc)>0
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('reclass-dylan-megan-submitter-v1' in p.prosrc)>0
      and position('reclass_delivery_recipients_v1' in p.prosrc)>0
      and position('lock_ph_master_inventory_for_reclass_lkg_v1(true)' in p.prosrc)>0
      and position('clear_current_ph_inventory_reclass_lkg_context_v1' in p.prosrc)>0
      and not has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.sales_rep_operation_scope_v1(uuid)')
      and not p.prosecdef and p.proconfig @> array['search_path=""']
      and position('gnc.sales_rep_operation_actor' in p.prosrc)>0
      and not has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute'))
    and (select count(*)=2 from pg_proc p where p.oid in (
      to_regprocedure('public.enqueue_drive_reclass_inquiry_v1(jsonb)'),
      to_regprocedure('public.enqueue_drive_reclass_inquiry_v6(jsonb)'))
      and position('sales_rep_operation_scope_v1' in p.prosrc)>0) as installed`;
  if (name === reclassServerRevisionMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)')
      and p.prosecdef and p.pronargdefaults=3 and p.proconfig @> array['search_path=""']
      and position('batch_receipt.request->>''expectedRevision''' in p.prosrc)>0
      and position('resolved_revision := private.lock_ph_master_inventory_for_reclass_lkg_v1()' in p.prosrc)>0
      and position('p_command_id, resolved_revision, p_moves' in p.prosrc)>0
      and position('insert into public.ph_request_delivery_outbox' in p.prosrc)>0)
    and has_function_privilege('service_role','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('authenticated','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('anon','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.published_snapshot_read_proof(text,bigint)')
      and position('reclass_failed_unpublished_canonical_run_v1(lease.run_id)' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.sync_inventory_row_assignment_statement_v1()')
      and position('if stale_lease and not importing and not lkg_reclass_context then' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.lock_ph_master_inventory_for_live_edit_v6()')
      and position('reclass_lkg_write_context_proven_v1()' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.touch_source()')
      and position('context.inventory_revision = current_revision.revision' in p.prosrc)>0
      and position('set inventory_revision = current_revision.revision + 1' in p.prosrc)>0)
    and not has_function_privilege('service_role','private.reclass_failed_unpublished_canonical_run_v1(uuid)','execute')
    as installed`;
  if (name === publishedLkgReadProofMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.published_snapshot_read_proof(text,bigint)')
      and p.prosecdef and p.provolatile='s' and p.proconfig @> array['search_path=""']
      and position('publishedReadable' in p.prosrc)>0 and position('publishedRevision' in p.prosrc)>0
      and position('mutationAllowed' in p.prosrc)>0)
    and not has_function_privilege('anon','app_sync_private.published_snapshot_read_proof(text,bigint)','execute')
    and not has_function_privilege('authenticated','app_sync_private.published_snapshot_read_proof(text,bigint)','execute')
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.snapshot(text[])')
      and position('published_snapshot_read_proof' in p.prosrc)>0 and position('publishedAt' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)')
      and position('published_snapshot_read_proof' in p.prosrc)>0 and position('publishedRevision' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.inventory_location_on_hand_read_v1(uuid,jsonb,text)')
      and position('published_snapshot_read_proof' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.lock_ph_master_inventory_for_reclass_lkg_v1(boolean)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and not has_function_privilege('authenticated',p.oid,'execute')
      and position('for update' in lower(p.prosrc))>0 and position('mutationAllowed' in p.prosrc)>0)
    and not has_function_privilege('service_role','private.lock_ph_master_inventory_for_reclass_lkg_v1(boolean)','execute')
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.reclass_lkg_write_context_active_v1()')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('service_role',p.oid,'execute')
      and position('published_snapshot_read_proof' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.clear_current_ph_inventory_reclass_lkg_context_v1()')
      and p.prosecdef and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('service_role',p.oid,'execute'))
    and has_table_privilege('authenticated','private.ph_inventory_reclass_lkg_context_v1','select') is false
    and has_table_privilege('service_role','private.ph_inventory_reclass_lkg_context_v1','insert') is false
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgfoid=to_regprocedure('private.sync_inventory_row_assignment_statement_v1()')
      and not t.tgisinternal)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.sync_inventory_row_assignment_statement_v1()')
      and p.prosecdef and position('reclass_lkg_write_context_active_v1' in p.prosrc)>0
      and position('MASTER_SNAPSHOT_NOT_READY' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)')
      and position('lock_ph_master_inventory_for_reclass_lkg_v1(true)' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)')
      and position('lock_ph_master_inventory_for_reclass_lkg_v1(true)' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=${reclassV7ImplementationOid}
      and position('lock_ph_master_inventory_for_reclass_lkg_v1(true)' in p.prosrc)>0
      and position('clear_current_ph_inventory_reclass_lkg_context_v1' in p.prosrc)>0) as installed`;
  if (name === reclassEmailReportPolicyMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.reclass_delivery_recipients_v1(text)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('dylan_collyge' in p.prosrc)>0 and position('megan_kelly' in p.prosrc)>0)
    and not has_function_privilege('authenticated','private.reclass_delivery_recipients_v1(text)','execute')
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)')
      and p.prosecdef and position('appliedRows' in p.prosrc)>0
      and position('reclass_delivery_recipients_v1' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)')
      and p.prosecdef and position('reclass_delivery_recipients_v1' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=${reclassV7ImplementationOid}
      and p.prosecdef and position('reclass_delivery_recipients_v1' in p.prosrc)>0)
    as installed`;

  if (name === masterIdentityBatchRetrySqlstateMigrationName) return `select
    exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)')
        and p.prosecdef and p.provolatile='s'
        and p.proconfig @> array['search_path=""']
        and p.proconfig @> array['statement_timeout=5s']
        and position('errcode=''55000'',message=''MASTER_IDENTITY_SOURCE_NOT_READY''' in p.prosrc)>0
        and position('errcode=''55000'',message=''MASTER_IDENTITY_REVISION_CHANGED''' in p.prosrc)>0
        and position('errcode=''40001'',message=''MASTER_IDENTITY_SOURCE_NOT_READY''' in p.prosrc)=0
        and position('errcode=''40001'',message=''MASTER_IDENTITY_REVISION_CHANGED''' in p.prosrc)=0
        and has_function_privilege('service_role',p.oid,'execute')
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')) as installed`;
  if (name === masterSnapshotChunkedStagingMigrationName) return `select count(*)=3 and coalesce(bool_and(p.prosecdef
    and p.proconfig @> array['search_path=""','statement_timeout=120s','lock_timeout=15s']
    and has_function_privilege('service_role',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')),false) as installed
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('begin_master_snapshot_stage_v1','append_master_snapshot_stage_chunk_v1','finalize_master_snapshot_stage_v1')`;
  if (name === inventoryReclassCompactTriggerIdentityMigrationName) return `select
    (select count(*)=2 and bool_and(p.prosecdef) and bool_and(p.provolatile='i')
      and bool_and(p.proconfig @> array['search_path=""'])
      and (select proowner from pg_proc where oid=to_regprocedure('private.ph_master_inventory_lineage_key_v1(public.ph_master_inventory)'))
        =(select proowner from pg_proc where oid=to_regprocedure('private.ph_master_inventory_lineage_key_v1(jsonb)'))
      and (select proowner from pg_proc where oid=to_regprocedure('private.ph_master_inventory_stable_identity_v7(public.ph_master_inventory)'))
        =(select proowner from pg_proc where oid=to_regprocedure('private.ph_master_inventory_stable_identity_v7(jsonb)'))
      and bool_and(not has_function_privilege('anon',p.oid,'execute'))
      and bool_and(not has_function_privilege('authenticated',p.oid,'execute'))
      and bool_and(not has_function_privilege('service_role',p.oid,'execute'))
      from pg_proc p where p.oid in (
        to_regprocedure('private.ph_master_inventory_lineage_key_v1(public.ph_master_inventory)'),
        to_regprocedure('private.ph_master_inventory_stable_identity_v7(public.ph_master_inventory)')))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.guard_ph_master_inventory_priority_hold_v1()')
      and position('ph_master_inventory_lineage_key_v1(new)' in p.prosrc)>0
      and position('ph_master_inventory_lineage_key_v1(old)' in p.prosrc)>0
      and position('ph_master_inventory_lineage_key_v1(to_jsonb(new))' in p.prosrc)=0
      and position('ph_master_inventory_lineage_key_v1(to_jsonb(old))' in p.prosrc)=0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.refresh_ph_master_inventory_item6_lineage_v7()')
      and position('ph_master_inventory_stable_identity_v7(new)' in p.prosrc)>0
      and position('ph_master_inventory_lineage_key_v1(new)' in p.prosrc)>0
      and position('stable_identity_v7(to_jsonb(new))' in p.prosrc)=0
      and position('lineage_key_v1(to_jsonb(new))' in p.prosrc)=0) as installed`;
  if (name === inventoryReclassCompactBatchChildReceiptsMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.replay_inventory_reclass_batch_child_v1(uuid)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('service_role',p.oid,'execute')
      and position('b.request_id=parent_request_id' in p.prosrc)>0
      and position('batch_row.child_request_ids[source_index] is distinct from p_child_request_id' in p.prosrc)>0
      and position('batchRequestId' in p.prosrc)>0
      and position('sourceIndex' in p.prosrc)>0
      and position('movement.value->>''sourceUniqueId''' in p.prosrc)>0
      and position('movement.value->>''sourceUniqueId''=source_uid' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)')
      and position('replay_inventory_reclass_batch_child_v1(command_row.request_id)' in p.prosrc)>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)')
      and position('_batchResultReference' in p.prosrc)>0
      and position('result=r.result_value' in p.prosrc)=0) as installed`;
  if (name === inventoryReclassQuantityTriggerFastpathsMigrationName) return `select
    (select count(*)=3 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname in ('aaa_ph_master_inventory_priority_hold_shield','aaa_ph_master_inventory_priority_hold_shield_insert',
        'aaa_ph_master_inventory_priority_hold_shield_delete') and not t.tgisinternal)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='aaa_ph_master_inventory_priority_hold_shield' and (t.tgtype & 16)<>0 and t.tgqual is not null
      and t.tgfoid='private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='aab_ph_master_inventory_item6_guard_v7' and (t.tgtype & 16)<>0 and t.tgqual is not null
      and t.tgfoid='private.guard_ph_master_inventory_item6_fields_v7()'::regprocedure)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='aab_ph_master_inventory_item6_guard_v7_delete' and (t.tgtype & 8)<>0)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='zzz_ph_master_inventory_item6_lineage_v7' and (t.tgtype & 4)<>0)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='zzz_ph_master_inventory_item6_lineage_v7_update' and (t.tgtype & 16)<>0 and t.tgqual is not null
      and t.tgfoid='private.refresh_ph_master_inventory_item6_lineage_v7()'::regprocedure)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='trigger_inventory_changes' and t.tgqual is not null
      and t.tgfoid='public.check_inventory_changes_and_reset()'::regprocedure)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='sync_season_sales_av_note_reset' and t.tgqual is not null
      and t.tgfoid='private.sync_season_sales_av_note_reset_v1()'::regprocedure)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname='trigger_new_assignment' and t.tgqual is not null
      and t.tgfoid='public.notify_new_assignment()'::regprocedure)
    and not exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
      and t.tgname in ('aaa_ph_master_inventory_priority_hold_shield','aab_ph_master_inventory_item6_guard_v7',
        'zzz_ph_master_inventory_item6_lineage_v7_update') and t.tgisinternal) as installed`;
  if (name === inventoryReclassMovesMigrationName) return `select
    (select count(*)=5 and bool_and(c.relrowsecurity)
      and bool_and(not has_table_privilege('anon',c.oid,'select,insert,update,delete'))
      and bool_and(not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
      and bool_and(not has_table_privilege('service_role',c.oid,'select,insert,update,delete'))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=any(array['ph_inventory_reclass_commands_v1',
        'ph_inventory_reclass_batch_receipts_v1','ph_inventory_reclass_movements_v1',
        'ph_inventory_reclass_import_aliases_v1','ph_inventory_reclass_import_conflicts_v1']::text[]))
    and (select count(*)=3 and bool_and(p.prosecdef)
      and bool_and(p.proconfig @> array['search_path=""'])
      and bool_and(has_function_privilege('service_role',p.oid,'execute'))
      and bool_and(not has_function_privilege('anon',p.oid,'execute'))
      and bool_and(not has_function_privilege('authenticated',p.oid,'execute'))
      from pg_proc p where p.oid in (
        to_regprocedure('public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'),
        to_regprocedure('public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'),
        to_regprocedure('public.get_inventory_reclass_move_status_v1(uuid,text)')))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)')
        and p.prosecdef and p.proconfig @> array['search_path=""']
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute'))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)')
        and position('INVENTORY_RECLASS_OVERLAP_INVALID' in p.prosrc)>0
        and position('ph_inventory_reclass_movements_v1' in p.prosrc)>0
        and position('reclass_batch_source_before_v1' in p.prosrc)>0
        and position('reclass_batch_source_after_v1' in p.prosrc)>0
        and position('reclass_batch_target_before_v1' in p.prosrc)>0
        and position('reclass_batch_target_after_v1' in p.prosrc)>0
        and position('reclass_batch_source_json_v1' in p.prosrc)>0
        and position('reclass_batch_target_json_v1' in p.prosrc)>0
        and position('returning m.*' in lower(p.prosrc))>0
        and position('apply_inventory_reclass_move_v1' in p.prosrc)=0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)')
        and position('ph_warehouse_assigned_items' in p.prosrc)>0
        and position('DRIVE_RECLASS_ROW_NOT_ASSIGNED' in p.prosrc)>0
        and position('INVENTORY_RECLASS_DESTINATION_SEASON_MISMATCH' in p.prosrc)>0)
    and not exists(select 1 from pg_constraint f
      where f.contype='f' and f.confdeltype='c' and f.conrelid in (
        'private.ph_inventory_reclass_commands_v1'::regclass,
        'private.ph_inventory_reclass_batch_receipts_v1'::regclass,
        'private.ph_inventory_reclass_movements_v1'::regclass,
        'private.ph_inventory_reclass_import_aliases_v1'::regclass,
        'private.ph_inventory_reclass_import_conflicts_v1'::regclass))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)')
        and position('apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id)' in p.prosrc)>0
        and position('ph_inventory_reclass_movements_v1' in p.prosrc)>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.apply_inventory_reclass_import_overlay_v1(uuid,uuid)')
        and p.prosecdef and p.proconfig @> array['search_path=""']
        and position('record_inventory_reclass_import_conflict_v1' in p.prosrc)>0
        and position('operation_order' in p.prosrc)>0
        and position('target_duplicate' in p.prosrc)>0
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute'))
    and exists(select 1 from information_schema.columns
      where table_schema='private' and table_name='ph_inventory_reclass_commands_v1'
        and column_name='operation_order' and is_identity='YES')
    and (select count(*)=2 and bool_and(p.prosecdef) and bool_and(p.proconfig @> array['search_path=""'])
      and bool_and(not has_function_privilege('anon',p.oid,'execute'))
      and bool_and(not has_function_privilege('authenticated',p.oid,'execute'))
      and bool_and(not has_function_privilege('service_role',p.oid,'execute'))
      from pg_proc p where p.oid in (
        to_regprocedure('private.ph_inventory_reclass_batch_context_v1(uuid)'),
        to_regprocedure('private.ph_master_bulk_crop_roll_defer_active_v1()')))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.ph_inventory_reclass_batch_context_v1(uuid)')
        and position('backend_pid' in p.prosrc)>0 and position('transaction_id' in p.prosrc)>0
        and position('auth.role' in p.prosrc)>0 and position('gnc.inventory_reclass_batch' in p.prosrc)>0)
    and exists(select 1 from information_schema.columns
      where table_schema='private' and table_name='ph_inventory_reclass_batch_receipts_v1'
        and column_name='backend_pid')
    and exists(select 1 from information_schema.columns
      where table_schema='private' and table_name='ph_inventory_reclass_batch_receipts_v1'
        and column_name='transaction_id')
    and exists(select 1 from pg_index i
      where i.indexrelid=to_regclass('public.ph_master_inventory_reclass_lineage_v1_idx')
        and i.indrelid='public.ph_master_inventory'::regclass and i.indisvalid and i.indisready
        and position('warehouseid' in pg_get_indexdef(i.indexrelid))>0
        and position('desigloc' in pg_get_indexdef(i.indexrelid))>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.get_inventory_reclass_move_status_v1(uuid,text)')
        and position('importStatus' in p.prosrc)>0 and position('status' in p.prosrc)>0)
    as installed`;
  if (name === inventoryReclassNullElisionRpcMigrationName) return `select
    (select count(*)=2 and bool_and(p.prosecdef) and bool_and(p.proconfig @> array['search_path=""'])
      and bool_and(has_function_privilege('service_role',p.oid,'execute'))
      and bool_and(not has_function_privilege('anon',p.oid,'execute'))
      and bool_and(not has_function_privilege('authenticated',p.oid,'execute'))
      from pg_proc p where p.oid in (
        to_regprocedure('public.apply_inventory_reclass_moves_compact_v1(uuid,text,bigint,jsonb)'),
        to_regprocedure('public.get_inventory_reclass_move_status_compact_v1(uuid,text)')))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.encode_inventory_reclass_rows_v1(jsonb)')
        and p.provolatile='s' and p.prosecdef and p.proconfig @> array['search_path=""']
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute'))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.apply_inventory_reclass_moves_compact_v1(uuid,text,bigint,jsonb)')
        and position('apply_inventory_reclass_moves_v1' in p.prosrc)>0
        and position('encode_inventory_reclass_rows_v1' in p.prosrc)>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.get_inventory_reclass_move_status_compact_v1(uuid,text)')
        and position('get_inventory_reclass_move_status_v1' in p.prosrc)>0
        and position('encode_inventory_reclass_rows_v1' in p.prosrc)>0)
    as installed`;
  if (name === masterIdentityBatchReadMigrationName) return `select
    exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)')
        and p.prosecdef and p.provolatile='s'
        and p.proconfig @> array['search_path=""']
        and p.proconfig @> array['statement_timeout=5s']
        and has_function_privilege('service_role',p.oid,'execute')
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute'))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.master_identity_item_key_v1(text)')
        and p.provolatile='i'
        and p.proconfig @> array['search_path=""']
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute'))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.master_identity_location_key_v1(text)')
        and p.provolatile='i'
        and p.proconfig @> array['search_path=""']
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute'))
    and exists(select 1 from pg_index i
      where i.indexrelid=to_regclass('public.ph_master_inventory_identity_batch_v1_idx')
        and i.indrelid='public.ph_master_inventory'::regclass and i.indisvalid and i.indisready)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)')
        and position('MASTER_IDENTITY_SOURCE_NOT_READY' in p.prosrc)>0
        and position('MASTER_IDENTITY_REVISION_CHANGED' in p.prosrc)>0
        and position('MASTER_IDENTITY_ACTOR_FORBIDDEN' in p.prosrc)>0)
    as installed`;
  if (name === managerModuleRevisionSignalsMigrationName) return `select
    (select count(*)=8 and bool_and(client_enabled) and bool_and(modules=array['managers'])
      and bool_and(dylan_only=(key<>'production_schedule_active'))
      from app_sync_private.sources where key=any(array[
        'ph_company_directory_contacts','ph_company_directory_blocks','ph_company_directory_beds','ph_company_directory_codes',
        'production_schedule_active','core_employees','hr_job_codes','labor_timesheets']::text[]))
    and (select count(*)=8 from public.app_dataset_revisions where key=any(array[
        'ph_company_directory_contacts','ph_company_directory_blocks','ph_company_directory_beds','ph_company_directory_codes',
        'production_schedule_active','core_employees','hr_job_codes','labor_timesheets']::text[]))
    and (select count(*)=32 and bool_and(t.tgenabled='O') and bool_and(not t.tgisinternal)
      and bool_and(p.proname='touch_source')
      and bool_and(t.tgtype=case t.tgname when 'app_dataset_revision_inserted' then 4 when 'app_dataset_revision_updated' then 16 when 'app_dataset_revision_deleted' then 8 when 'app_dataset_revision_truncated' then 32 end)
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_proc p on p.oid=t.tgfoid
      where n.nspname='public' and c.relname=any(array[
        'ph_company_directory_contacts','ph_company_directory_blocks','ph_company_directory_beds','ph_company_directory_codes',
        'production_schedule_active','core_employees','hr_job_codes','labor_timesheets']::text[])
        and t.tgname=any(array['app_dataset_revision_inserted','app_dataset_revision_updated','app_dataset_revision_deleted','app_dataset_revision_truncated']::text[]))
    and exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_dataset_revisions')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
      and tablename=any(array['ph_company_directory_contacts','ph_company_directory_blocks','ph_company_directory_beds','ph_company_directory_codes',
        'production_schedule_active','core_employees','hr_job_codes','labor_timesheets']::text[]))
    and (select relrowsecurity from pg_class where oid='public.app_dataset_revisions'::regclass)
    and exists(select 1 from pg_policies where schemaname='public' and tablename='app_dataset_revisions'
      and policyname='app_dataset_revision_read' and qual ilike '%can_read_source%key%')
    and has_table_privilege('authenticated','public.app_dataset_revisions','select')
    and has_table_privilege('service_role','public.app_dataset_revisions','select')
    and not has_table_privilege('anon','public.app_dataset_revisions','select') as installed`;
  if (name === bulkContextIndexPlanMigrationName) return `select exists(select 1 from pg_proc p
    where p.oid=to_regprocedure('private.ph_master_bulk_context_v1(uuid,text)')
      and p.prosecdef and p.provolatile='v'
      and p.proconfig @> array['search_path=""']
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('service_role',p.oid,'execute')
      and p.prosrc ~ 'c[.]source_unique_id[[:space:]]*=[[:space:]]*p_unique_id'
      and p.prosrc ~ 'c[.]canonical_unique_id[[:space:]]*=[[:space:]]*p_unique_id'
      and position('ph_master_inventory_import_lineage_seen' in p.prosrc)>0
      and position('ph_master_inventory_item6_alias_seen_v7' in p.prosrc)>0)
      and exists(select 1 from pg_proc p
        where p.oid=to_regprocedure('app_sync_private.ph_master_bulk_context_analyze_v1()')
          and p.prosecdef and p.proconfig @> array['search_path=""']
          and not has_function_privilege('anon',p.oid,'execute')
          and not has_function_privilege('authenticated',p.oid,'execute')
          and not has_function_privilege('service_role',p.oid,'execute')
          and position('analyze app_sync_private.ph_master_bulk_import_context_v1' in lower(p.prosrc))>0)
      and exists(select 1 from pg_trigger t
        where t.tgrelid='app_sync_private.ph_master_bulk_import_context_v1'::regclass
          and t.tgname='ph_master_bulk_context_analyze_v1'
          and t.tgfoid=to_regprocedure('app_sync_private.ph_master_bulk_context_analyze_v1()')
          and t.tgtype=4 and t.tgenabled='O' and not t.tgisinternal)
      and (select count(*)=3 from pg_index i
        where i.indrelid='app_sync_private.ph_master_bulk_import_context_v1'::regclass
          and i.indisvalid and i.indisready
          and i.indexrelid in (
            'app_sync_private.ph_master_bulk_import_context_v1_pkey'::regclass,
            'app_sync_private.ph_master_bulk_import_context_run_pid_xid_idx'::regclass,
            'app_sync_private.ph_master_bulk_import_context_request_canonical_idx'::regclass)) as installed`;
  if (name === handoverMasterAssignmentFastPathMigrationName) return `select exists(select 1 from pg_proc p
    where p.oid=to_regprocedure('private.handover_normalize_assignment_v1()')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('service_role',p.oid,'execute')
      and position('tg_table_name=''ph_master_inventory''then' in regexp_replace(lower(p.prosrc),'[[:space:]]','','g'))>0
      and position('prior_assignedto:=new.assignedto' in regexp_replace(lower(p.prosrc),'[[:space:]]','','g'))>0
      and position('doc:=to_jsonb(new)' in regexp_replace(lower(p.prosrc),'[[:space:]]','','g'))>0
      and position('jsonb_populate_record(new,patch)' in regexp_replace(lower(p.prosrc),'[[:space:]]','','g'))>0
      and position('jsonb_populate_record(null::public.%i,$1)' in regexp_replace(lower(p.prosrc),'[[:space:]]','','g'))>0) as installed`;
  if (name === importHistoryRoutingMigrationName) return `select
    (select count(*)=2 and bool_and(c.relrowsecurity)
      and bool_and(not has_table_privilege('anon',c.oid,'select,insert,update,delete'))
      and bool_and(not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
      and bool_and(not has_table_privilege('service_role',c.oid,'select,insert,update,delete'))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='import_private' and c.relname in ('import_history_files','import_history_rows'))
    and (select count(*)=3 and bool_and(p.prosecdef)
      and bool_and(p.proconfig @> array['search_path=""','statement_timeout=55s'])
      and bool_and(has_function_privilege('service_role',p.oid,'execute'))
      and bool_and(not has_function_privilege('authenticated',p.oid,'execute'))
      and bool_and(not has_function_privilege('anon',p.oid,'execute'))
      from pg_proc p where p.oid in (
        to_regprocedure('public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'),
        to_regprocedure('public.stage_import_history_rows_v1(uuid,jsonb)'),
        to_regprocedure('public.publish_import_history_v1(uuid)')))
    and (select count(*)=2 and bool_and(p.prosecdef)
      and bool_and(p.proconfig @> array['search_path=""'])
      and bool_and(has_function_privilege('authenticated',p.oid,'execute'))
      and bool_and(has_function_privilege('service_role',p.oid,'execute'))
      and bool_and(not has_function_privilege('anon',p.oid,'execute'))
      and bool_and(position('can_manage_eval_assignments' in p.prosrc)>0)
      from pg_proc p where p.oid in (
        to_regprocedure('public.list_import_history_v1(text,date,integer,integer)'),
        to_regprocedure('public.get_import_history_rows_v1(uuid,integer,integer)')))
    and exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
      where c.oid=to_regclass('import_private.import_history_files_ready_page_idx')
        and pg_get_indexdef(c.oid) ilike '%(dataset, report_date DESC, daily_sequence DESC)%'
        and pg_get_expr(i.indpred,i.indrelid) ilike '%status%ready%')
    and exists(select 1 from pg_class c where c.oid=to_regclass('import_private.import_history_rows_pkey')
      and pg_get_indexdef(c.oid) ilike '%(snapshot_id, row_number)%')
    and position('IMPORT_HISTORY_RETRY_CONFLICT' in pg_get_functiondef(
      'public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure))>0
    and position('IMPORT_HISTORY_ROW_RETRY_CONFLICT' in pg_get_functiondef(
      'public.stage_import_history_rows_v1(uuid,jsonb)'::regprocedure))>0
    and position('IMPORT_HISTORY_STAGE_GAP' in pg_get_functiondef(
      'public.stage_import_history_rows_v1(uuid,jsonb)'::regprocedure))>0
    and position('IMPORT_HISTORY_ROWS_INCOMPLETE' in pg_get_functiondef(
      'public.publish_import_history_v1(uuid)'::regprocedure))>0
    as installed`;
  if (name === bulkMasterSnapshotMigrationName) return `select
    exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)')
        and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=55s','lock_timeout=5s']
        and has_function_privilege('service_role',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('anon',p.oid,'execute')
        and position('BULK_MASTER_IMPORT_REQUEST_ID_REUSED' in p.prosrc)>0
        and position('BULK_MASTER_IMPORT_FENCE_LOST' in p.prosrc)>0
        and position('request_row.response' in p.prosrc)>0)
    and (select count(*)=3 and bool_and(c.relrowsecurity)
      and bool_and(not has_table_privilege('anon',c.oid,'select,insert,update,delete'))
      and bool_and(not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
      and bool_and(not has_table_privilege('service_role',c.oid,'select,insert,update,delete'))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_sync_private' and c.relname in
        ('ph_master_bulk_import_receipts_v1','ph_master_bulk_import_context_v1','ph_master_bulk_import_source_v1'))
    and (select count(*)=2 from pg_trigger t
      where t.tgrelid='public.ph_master_inventory'::regclass and not t.tgisinternal and t.tgenabled='O'
        and ((t.tgname='aa00_ph_master_bulk_raw_context_v1'
          and t.tgfoid=to_regprocedure('private.ph_master_bulk_isolation_v1()'))
          or (t.tgname='aabz_ph_master_bulk_import_field_isolation_v1'
            and t.tgfoid=to_regprocedure('private.ph_master_bulk_live_field_isolation_v1()'))))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.ph_master_bulk_crop_roll_defer_active_v1()')
        and p.prosecdef and p.proconfig @> array['search_path=""']
        and position('ph_master_inventory_import_run_v1' in p.prosrc)>0
        and position('ph_master_bulk_import_context_v1' in p.prosrc)>0
        and position('pg_backend_pid' in p.prosrc)>0
        and position('txid_current' in p.prosrc)>0
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute'))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])')
        and p.prosecdef and p.proconfig @> array['search_path=""']
        and position('ph_master_inventory_import_run_v1' in p.prosrc)>0
        and position('gnc.master_bulk_crop_roll_deferred' in p.prosrc)>0
        and position('ph_master_bulk_import_context_v1' in p.prosrc)>0
        and (
          position('v2_crop_roll_drive_row_from_json' in p.prosrc)>0
          or (
            -- The typed replacement is valid only with the deployed, fenced
            -- staging contract. A helper name alone cannot certify this path.
            position('private.ph_master_crop_roll_from_master_v1(master)' in p.prosrc)>0
            and exists(select 1 from pg_proc mapper
              where mapper.oid=to_regprocedure('private.ph_master_crop_roll_from_master_v1(public.ph_master_inventory)')
                and mapper.proowner=p.proowner and mapper.provolatile='s'
                and mapper.prorettype=to_regtype('public.ph_crop_roll_drive_rows')
                and mapper.proconfig @> array['search_path=""']
                and not has_function_privilege('anon',mapper.oid,'execute')
                and not has_function_privilege('authenticated',mapper.oid,'execute')
                and not has_function_privilege('service_role',mapper.oid,'execute'))
            and (select count(*)=3 and coalesce(bool_and(stage.prosecdef and stage.proowner=p.proowner
              and stage.prorettype='jsonb'::regtype
              and stage.proconfig @> array['search_path=""','statement_timeout=120s','lock_timeout=15s']
              and has_function_privilege('service_role',stage.oid,'execute')
              and not has_function_privilege('anon',stage.oid,'execute')
              and not has_function_privilege('authenticated',stage.oid,'execute')),false)
              from pg_proc stage where stage.oid in (
                to_regprocedure('public.begin_master_snapshot_stage_v1(uuid,uuid,jsonb,text,integer,integer)'),
                to_regprocedure('public.append_master_snapshot_stage_chunk_v1(uuid,uuid,integer,jsonb)'),
                to_regprocedure('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)')))
            and exists(select 1 from pg_proc finalizer
              where finalizer.oid=to_regprocedure('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)')
                and position('assert_master_snapshot_stage_fence_v1' in finalizer.prosrc)>0
                and position('MASTER_SNAPSHOT_STAGE_INCOMPLETE' in finalizer.prosrc)>0
                and position('source_manifest_digest' in finalizer.prosrc)>0
                and position('published_response' in finalizer.prosrc)>0
                and position('private.sync_ph_master_bulk_crop_roll_v1' in finalizer.prosrc)>0)
            and (select count(*)=3 and coalesce(bool_and(stage_table.relrowsecurity
              and not has_table_privilege('anon',stage_table.oid,'select,insert,update,delete')
              and not has_table_privilege('authenticated',stage_table.oid,'select,insert,update,delete')
              and not has_table_privilege('service_role',stage_table.oid,'select,insert,update,delete')),false)
              from pg_class stage_table join pg_namespace ns on ns.oid=stage_table.relnamespace
              where ns.nspname='app_sync_private' and stage_table.relname in (
                'ph_master_snapshot_stage_v1','ph_master_snapshot_stage_chunks_v1','ph_master_snapshot_stage_rows_v1'))
          )
        )
        and position('public.ph_crop_roll_drive_rows' in p.prosrc)>0
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute'))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.upsert_v2_crop_roll_drive_row_from_master()')
        and p.prosecdef
        and position('ph_master_bulk_crop_roll_defer_active_v1' in p.prosrc)>0)
    and exists(select 1 from pg_trigger t
      where t.tgrelid='public.ph_master_inventory'::regclass
        and t.tgname='trg_v2_master_inventory_crop_roll_drive_rows'
        and not t.tgisinternal and t.tgenabled='O'
        and t.tgfoid=to_regprocedure('public.upsert_v2_crop_roll_drive_row_from_master()'))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)')
        and position('sync_ph_master_bulk_crop_roll_v1' in p.prosrc)>0
        and position('gnc.master_bulk_crop_roll_deferred' in p.prosrc)>0
        and position('previous_crop_roll_marker' in p.prosrc)>0
        and position('coalesce(previous_crop_roll_marker' in p.prosrc)>0)
    as installed`;
  if (name === customerAssignmentOverridesMigrationName) return `select
    to_regclass('sales_private.customer_rep_assignment_sources') is not null
    and to_regclass('sales_private.customer_rep_assignment_overrides') is not null
    and to_regclass('sales_private.customer_rep_assignment_receipts') is not null
    and (select count(*)=3 and bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='sales_private' and c.relname in ('customer_rep_assignment_sources','customer_rep_assignment_overrides','customer_rep_assignment_receipts'))
    and not has_table_privilege('authenticated','sales_private.customer_rep_assignment_overrides','select,insert,update,delete')
    and not has_table_privilege('anon','sales_private.customer_rep_assignment_overrides','select,insert,update,delete')
    and not has_table_privilege('authenticated','sales_private.customer_rep_assignment_sources','select,insert,update,delete')
    and not has_table_privilege('anon','sales_private.customer_rep_assignment_sources','select,insert,update,delete')
    and not has_table_privilege('authenticated','sales_private.customer_rep_assignment_receipts','select,insert,update,delete')
    and not has_table_privilege('anon','sales_private.customer_rep_assignment_receipts','select,insert,update,delete')
    and has_function_privilege('service_role','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and not has_function_privilege('authenticated','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and not has_function_privilege('anon','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and position('customer_rep_assignment_receipt_replay_v1' in pg_get_functiondef('public.customer_rep_mapping_manage_v1(uuid,text,jsonb)'::regprocedure))>0
    and position('customer_rep_assignment_apply_overrides_v1' in pg_get_functiondef('public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure))>0
    and exists(select 1 from pg_proc p where p.oid='public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure
      and p.proconfig @> array['statement_timeout=55s']) as installed`;
  if (name === inventoryAssignmentInputGenerationMigrationName) return `select
    exists(select 1 from pg_class where oid=to_regclass('private.inventory_row_assignment_input_generation') and relrowsecurity)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('private.inventory_row_assignment_reconcile_source_witness_v1()')
        and p.prosecdef and p.provolatile='v' and p.proconfig @> array['search_path=""']
        and position('inventory_row_assignment_input_generation' in p.prosrc)>0
        and position('for share' in lower(p.prosrc))>0)
    and (select count(*) from pg_trigger t
      where t.tgfoid=to_regprocedure('private.bump_inventory_row_assignment_input_generation_v1()')
        and not t.tgisinternal and t.tgenabled<>'D')=12
    as installed`;
  if (name === inventoryAssignmentWitnessMigrationName) return `select exists(
    select 1 from pg_proc p
    where p.oid=to_regprocedure('private.inventory_row_assignment_reconcile_source_witness_v1()')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and ((position('md5(jsonb_build_array(' in p.prosrc)>0
        and position('m.plantgroupcode' in p.prosrc)>0
        and position('a.zone_override_prior_assigned_at' in p.prosrc)>0
        and position('to_jsonb(m)' in p.prosrc)=0)
        or (to_regclass('private.inventory_row_assignment_input_generation') is not null
          and position('inventory_row_assignment_input_generation' in p.prosrc)>0))
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
  ) as installed`;
  if (name === inventoryAssignmentBatchesMigrationName) return `select
    exists(select 1 from pg_class where oid=to_regclass('private.inventory_row_assignment_reconcile_runs') and relrowsecurity)
    and exists(select 1 from pg_class where oid=to_regclass('private.inventory_row_assignment_reconcile_worklist') and relrowsecurity)
    and to_regprocedure('private.inventory_row_assignment_reconcile_source_witness_v1()') is not null
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)')
        and p.prosecdef and p.proconfig @> array['search_path=""']
        and has_function_privilege('service_role',p.oid,'execute')
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.advance_import(uuid,text)')
      and position('inventory_row_assignment_reconcile_finish_v1' in p.prosrc)>0)
    as installed`;
  if (name === seasonSalesEmptyCleanupMigrationName) return `select exists(
    select 1 from pg_proc p
    where p.oid=to_regprocedure('private.season_sales_mirror_winner_v1(public.ph_master_inventory,public.ph_season_sales_office_state)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('if exists (' in p.prosrc)>0
      and position('coalesce(sales.master_id, sales.unique_id) <> p_winner.unique_id' in p.prosrc)>0
  ) as installed`;
  if (name === seasonSalesWorklistMigrationName) return `select exists(
    select 1 from pg_proc p where p.oid=to_regprocedure('public.reconcile_season_sales_office_v1(text[],boolean,text,text)')
      and p.prosecdef and position('''itemcodes'', (select coalesce(jsonb_agg(target.itemcode_normalized order by target.itemcode_normalized)' in p.prosrc)>0
      and position('from season_sales_target_items_v1 target' in p.prosrc)>0
  ) and has_function_privilege('service_role','public.reconcile_season_sales_office_v1(text[],boolean,text,text)','execute')
    and not has_function_privilege('anon','public.reconcile_season_sales_office_v1(text[],boolean,text,text)','execute')
    and not has_function_privilege('authenticated','public.reconcile_season_sales_office_v1(text[],boolean,text,text)','execute') as installed`;
  if (name === seasonSalesCavLookupMigrationName) return `select exists(
    select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.oid=to_regclass('public.ph_cav_import_season_sales_normalized_lookup_idx')
      and i.indrelid='public.ph_cav_import'::regclass and i.indisvalid and i.indpred is null
      and i.indnkeyatts=3
      and position('upper(btrim(coalesce(itemcode,' in lower(regexp_replace(pg_get_indexdef(c.oid),'[[:space:]]','','g')))>0
      and position('upper(btrim(coalesce(season,' in lower(regexp_replace(pg_get_indexdef(c.oid),'[[:space:]]','','g')))>0
      and position('last_updateddesc' in lower(regexp_replace(pg_get_indexdef(c.oid),'[[:space:]]','','g')))>0
  ) as installed`;
  if (name === masterLineageCleanupMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prune_expired_master_lineage_v1(uuid)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('statement_timestamp()' in p.prosrc)>0
      and position('skip locked' in p.prosrc)>0
      and position('import_leases' in p.prosrc)>0)
    and position('perform private.prune_expired_master_lineage_v1(import_run_id);' in pg_get_functiondef('private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure))>0
    and position('perform private.prune_expired_master_lineage_v1(v_run_id);' in pg_get_functiondef('private.resolve_ph_master_inventory_item6_alias_v7()'::regprocedure))>0
    and not has_function_privilege('anon','private.prune_expired_master_lineage_v1(uuid)','execute')
    and not has_function_privilege('authenticated','private.prune_expired_master_lineage_v1(uuid)','execute')
    and not has_function_privilege('service_role','private.prune_expired_master_lineage_v1(uuid)','execute') as installed`;
  if (name === masterInventoryRealtimeMigrationName) return "select exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ph_master_inventory') and exists(select 1 from pg_publication where pubname='supabase_realtime' and pubupdate) and exists(select 1 from pg_class where oid='public.ph_master_inventory'::regclass and relrowsecurity) and exists(select 1 from pg_policies where schemaname='public' and tablename='ph_master_inventory' and policyname='inventory_status_realtime_read_v1' and roles @> array['authenticated']::name[] and cmd='SELECT') and has_column_privilege('authenticated','public.ph_master_inventory','unique_id','SELECT') and has_column_privilege('authenticated','public.ph_master_inventory','itemcode','SELECT') and has_column_privilege('authenticated','public.ph_master_inventory','locationcode','SELECT') as installed";
  if (name === eval2SharedLowStockThresholdMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.eval_report2_item_qualifies_v1(text,text,timestamptz)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('low_stock_max_slts' in p.prosrc)>0
      and position('eval_item_low_stock_target_stats_v1' in p.prosrc)=0
      and position('ph_eval_item_low_stock_overrides' in p.prosrc)=0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.manager_report_read_v2(jsonb)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('casewhensurface=''eval2''thenst.low_limitelsecoalesce(o.manual_override_qty,t.suggested_qty,st.low_limit)endlow_item_limit'
        in lower(regexp_replace(p.prosrc,'[[:space:]]','','g')))>0
      and position('leftjoinprivate.eval_item_low_stock_target_stats_v1tonsurface<>''eval2''and' in lower(regexp_replace(p.prosrc,'[[:space:]]','','g')))>0
      and position('leftjoinprivate.ph_eval_item_low_stock_overridesoonsurface<>''eval2''and' in lower(regexp_replace(p.prosrc,'[[:space:]]','','g')))>0)
    and has_function_privilege('service_role','public.manager_report_read_v2(jsonb)','execute')
    and not has_function_privilege('anon','public.manager_report_read_v2(jsonb)','execute')
    and not has_function_privilege('authenticated','public.manager_report_read_v2(jsonb)','execute')
    and has_function_privilege('service_role','private.eval_report2_item_qualifies_v1(text,text,timestamptz)','execute')
    and not has_function_privilege('anon','private.eval_report2_item_qualifies_v1(text,text,timestamptz)','execute')
    and not has_function_privilege('authenticated','private.eval_report2_item_qualifies_v1(text,text,timestamptz)','execute') as installed`;
  if (name === inventoryLocationOnHandMigrationName) return `select
    exists(select 1 from pg_proc where oid=to_regprocedure('public.inventory_location_on_hand_read_v1(uuid,jsonb,text)')
      and prosecdef and proconfig @> array['search_path=""'])
    and has_function_privilege('service_role','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute')
    and not has_function_privilege('authenticated','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute')
    and not has_function_privilege('anon','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute')
    and to_regclass('public.ph_master_inventory_item_location_on_hand_idx') is not null
    and position('manager_report_enrich_location_on_hand_v1' in pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure))>0
    as installed`;
  if (name === auraEnterpriseDomainVoiceMigrationName) return `select
    exists(select 1 from pg_class where oid=to_regclass('public.aura_domain_glossary') and relrowsecurity and relforcerowsecurity)
    and exists(select 1 from pg_class where oid=to_regclass('public.user_preferences') and relrowsecurity and relforcerowsecurity)
    and exists(select 1 from pg_policies where schemaname='public' and tablename='user_preferences' and policyname='aura_preference_own_update' and qual like '%auth.uid()%' and with_check like '%auth.uid()%')
    and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_preferences_v1(text)') and not prosecdef)
    and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_domain_context_v1()') and not prosecdef)
    and has_function_privilege('authenticated','public.aura_voice_preferences_v1(text)','execute')
    and not has_function_privilege('anon','public.aura_voice_preferences_v1(text)','execute')
    and not has_function_privilege('service_role','public.aura_voice_preferences_v1(text)','execute')
    and not has_column_privilege('authenticated','public.user_preferences','user_id','update')
    and position('[[:space:]]' in pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure))>0
    and exists(select 1 from pg_proc where oid=to_regprocedure('private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)') and prosecdef and position('private.aura_form_matches_v1' in prosrc)>0 and position('AURA_SETTING_REVISION_INVALID' in prosrc)>0 and position('allocated' in prosrc)>0)
    and not has_function_privilege('authenticated','private.aura_form_matches_v1(text,jsonb)','execute')
    as installed`;
  if (name === requestHistoryDrilldownMigrationName) return `select
    to_regclass('public.ph_historical_orders') is not null
    and position('record_kind' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
    and position('history-v3:' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
    and position('catalog_prices' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
    and position('date_from_stamp' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
    and to_regclass('private.request_financial_values_v1') is not null
    and to_regclass('private.request_financial_admins_v1') is not null
    and position('rep_scoped:=not private.history_dylan_financial_v1(actor.id)' in pg_get_functiondef('public.request_history_command_v1(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and position('history_redact_financial_v1' in pg_get_functiondef('public.request_history_command_v1(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and exists(select 1 from pg_policies where schemaname='public' and tablename='ph_request_history' and policyname='ph_request_history_owner_isolation' and permissive='RESTRICTIVE')
    and exists(select 1 from pg_policies where schemaname='public' and tablename='ph_active_request' and policyname='ph_active_request_rep_isolation' and permissive='RESTRICTIVE')
    and not has_function_privilege('authenticated','private.history_dylan_financial_v1(uuid)','execute')
    and not has_table_privilege('anon','public.ph_historical_orders','select') as installed`;
  if (name === navigationRoleBoundariesMigrationName) return `select position('[[:space:]]' in pg_get_functiondef('private.navigation_module_allowed_v1(uuid,text)'::regprocedure))>0 as installed`;
  if (name === salesActorRoleBoundariesMigrationName) return `select
    position('[[:space:]]' in pg_get_functiondef('sales_private.actor(uuid)'::regprocedure))>0
    and position('[[:space:]]' in pg_get_functiondef('sales_private.request_mapping_rep_allowed_v1(uuid,text)'::regprocedure))>0
    and not has_function_privilege('authenticated','sales_private.actor(uuid)','execute') as installed`;
  if (name === reclassConcurrentHoldMigrationName) return `select
    position('DRIVE_RECLASS_V6_MOVE_UP_HOLD_CONFLICT' in pg_get_functiondef('private.validate_reclass_smart_shield_v6(jsonb)'::regprocedure))=0
    and position('holdstopbegindate = case' in pg_get_functiondef('private.apply_ph_master_inventory_live_edits_v6(jsonb)'::regprocedure))>0
    and not has_function_privilege('authenticated','private.apply_ph_master_inventory_live_edits_v6(jsonb)','execute') as installed`;
  if (name === historicalRequestsPriceFallbackMigrationName) return `select
    (select baseline.installed from (${migrationContractQuery(historicalRequestsMigrationName)}) baseline)
    and ((position('fallback_prices' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
    and position('current_master_found' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
    and position('min(price)=max(price)' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0)
      or (position('catalog_prices' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
        and to_regprocedure('private.history_catalog_price_v1(text)') is not null
        and position('history-v3:' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0)) as installed`;
  if (name === requestMappingIdentityMigrationName) return "select (exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_active_request' and column_name='request_selected_salesrep_id') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_active_request_live_rows' and column_name='request_selected_salesrep_id') and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_request_queue_live_rows' and column_name='request_selected_salesrep_id') and to_regprocedure('sales_private.request_mapping_rep_allowed_v1(uuid,text)') is not null and exists(select 1 from pg_proc where oid='private.insert_request_batch(uuid,jsonb,text)'::regprocedure and position('request_selected_salesrep_id' in prosrc)>0)) as installed";
  if (name === historicalRequestsMigrationName) return `select
    to_regprocedure('public.historical_requests_read_v1(jsonb)') is not null
    and exists(select 1 from pg_proc p where p.oid='public.historical_requests_read_v1(jsonb)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""','statement_timeout=10s'])
    and has_function_privilege('authenticated','public.historical_requests_read_v1(jsonb)','execute')
    and not has_function_privilege('anon','public.historical_requests_read_v1(jsonb)','execute')
    and not has_function_privilege('service_role','public.historical_requests_read_v1(jsonb)','execute')
    and (position('private.navigation_module_allowed_v1(actor_id,''historical-requests'')' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
      or position('private.navigation_module_allowed_v1(actor_id,requested_view)' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0)
    and to_regprocedure('private.historical_requests_number_v1(text)') is not null
    and exists(select 1 from private.navigation_view_catalog where view_key='historical-requests' and parent_key='sales' and selectable)
    and position('if p_view=''historical-requests'' then' in pg_get_functiondef('private.navigation_module_allowed_v1(uuid,text)'::regprocedure))>0
    and position('if found and not override_value then return false' in pg_get_functiondef('private.navigation_module_allowed_v1(uuid,text)'::regprocedure))>0
    and position('p.username=''dylan_collyge''' in pg_get_functiondef('private.navigation_module_allowed_v1(uuid,text)'::regprocedure))>0
    and position('(''REP'',''SALESREP'',''ADMIN'',''ADMINISTRATOR'')' in pg_get_functiondef('private.navigation_module_allowed_v1(uuid,text)'::regprocedure))>0 as installed`;
  if (name === customerRepMappingFinalizeTimeoutMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid='public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure
      and coalesce(p.proconfig,'{}'::text[]) @> array['statement_timeout=55s'])
    and has_function_privilege('service_role','public.finalize_customer_rep_mapping_import_v1(uuid)','execute')
    and not has_function_privilege('authenticated','public.finalize_customer_rep_mapping_import_v1(uuid)','execute')
    and not has_function_privilege('anon','public.finalize_customer_rep_mapping_import_v1(uuid)','execute') as installed`;
  if (name === bunchAutoCompletionMigrationName) return "select to_regprocedure('bunch_note_private.queue_completed_work_delivery()') is not null as installed";
  if (name === fieldCountingMigrationName) return "select to_regprocedure('public.field_count_command_v1(uuid,text,jsonb,uuid)') is not null and to_regprocedure('public.field_count_delivery_record_v1(uuid,uuid,text,jsonb)') is not null and not has_function_privilege('authenticated','public.field_count_command_v1(uuid,text,jsonb,uuid)','execute') and (select relrowsecurity from pg_class where oid='workflow_private.field_count_reports'::regclass) as installed";
  if (name === customerRepMappingMigrationName) return `select
    to_regprocedure('public.customer_rep_mapping_manage_v1(uuid,text,jsonb)') is not null
    and to_regprocedure('public.finalize_customer_rep_mapping_import_v1(uuid)') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ph_active_request'::regclass and tgname='require_active_customer_mapping_for_request_v1' and tgenabled='O' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgrelid='public.ph_active_request'::regclass and tgname='require_active_customer_mapping_for_request_update_v1' and tgenabled='O' and not tgisinternal)
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_customer_consignee_sales_reps' and column_name='raw_data' and data_type='jsonb')
    and has_function_privilege('service_role','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and not has_function_privilege('authenticated','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and not has_function_privilege('anon','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','execute')
    and has_function_privilege('service_role','public.finalize_customer_rep_mapping_import_v1(uuid)','execute')
    and not has_function_privilege('authenticated','public.finalize_customer_rep_mapping_import_v1(uuid)','execute')
    and not has_function_privilege('anon','public.finalize_customer_rep_mapping_import_v1(uuid)','execute')
    and not has_column_privilege('authenticated','public.ph_customer_consignee_sales_reps','raw_data','select')
    and not has_column_privilege('anon','public.ph_customer_consignee_sales_reps','raw_data','select') as installed`;
  if (name === prompt25HotfixMigrationName) return `select
    to_regprocedure('public.enqueue_drive_reclass_inquiry_v7(jsonb)') is not null
    and to_regprocedure('private.ph_holdstop_strict_reduction_v1(text,text)') is not null
    and to_regclass('app_sync_private.ph_master_inventory_item6_edits_v7') is not null
    and exists(select 1 from pg_trigger where tgname='aab_ph_master_inventory_item6_guard_v7' and not tgisinternal)
    and has_function_privilege('service_role','public.enqueue_drive_reclass_inquiry_v7(jsonb)','execute')
    and not has_function_privilege('authenticated','public.enqueue_drive_reclass_inquiry_v7(jsonb)','execute')
    and not has_function_privilege('anon','public.enqueue_drive_reclass_inquiry_v7(jsonb)','execute') as installed`;
  if (name === requestQueueRemoveMigrationName) return `select
    to_regclass('private.ph_request_queue_removal_commands') is not null
    and position('REQUEST_REMOVE_STALE_REVISION' in pg_get_functiondef('public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)'::regprocedure)) > 0
    and position('delete from public.ph_active_request' in pg_get_functiondef('public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)'::regprocedure)) > 0
    and not has_function_privilege('anon','public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)','execute')
    and not has_function_privilege('authenticated','public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)','execute')
    and has_function_privilege('service_role','public.request_queue_remove_v1(uuid,text,bigint,timestamptz,uuid)','execute')
    and not has_table_privilege('service_role','private.ph_request_queue_removal_commands','select') as installed`;
  if (name === sqlLintRuntimeContextMigrationName) return `select
    exists(select 1 from pg_proc where oid=to_regprocedure('private.transfer_remaining_handover_assignments_v1(text,integer)')
      and prosecdef and array_to_string(proconfig,',') like '%search_path=%'
      and prosrc like '%for dynamic_row_key,dynamic_before_values in execute%'
      and prosrc like '%shear_entry public.ph_shear_location_inquiries%rowtype%'
      and prosrc like '%assignment_entry public.ph_master_inventory_user_assignments%rowtype%'
      and prosrc like '%app.scheduled_handover_default_owner%'
      and prosrc like '%gnc-reconcile-eval-itemcodes-v2%'
      and position('entry record' in prosrc)=0)
    and not has_function_privilege('anon','private.transfer_remaining_handover_assignments_v1(text,integer)','execute')
    and not has_function_privilege('authenticated','private.transfer_remaining_handover_assignments_v1(text,integer)','execute')
    and has_function_privilege('service_role','private.transfer_remaining_handover_assignments_v1(text,integer)','execute') as installed`;
  if (name === sqlFunctionCorrectnessRepairsMigrationName) return `select
    exists(select 1 from pg_proc where oid=to_regprocedure('public.hl_order_inventory_availability(text[])')
      and prosecdef and prosrc like '%sum(inventory_rows.available)%')
    and exists(select 1 from pg_proc where oid=to_regprocedure('public.submit_manager_season_priority_v1(uuid,text,integer,text,text)')
      and prosecdef and prosrc like '%resolution_snapshot_hash = v_before_state_hash%')
    and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)')
      and prosecdef and prosrc like '%AURA_BUNCH_CREATION_DATE_UNAVAILABLE%'
      and position('j.created_at' in prosrc)=0)
    and exists(select 1 from pg_proc where oid=to_regprocedure('bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint)')
      and prosecdef and position('card.row_ids @> (action->''row_ids'')' in prosrc)>0)
    and exists(select 1 from pg_proc where oid=to_regprocedure('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)')
      and prosecdef and prosrc like '%where outbox.event_id in%' and prosrc like '%outbox.status=''failed''%')
    and not has_function_privilege('anon','public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)','execute')
    and not has_function_privilege('authenticated','public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)','execute')
    and has_function_privilege('service_role','public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)','execute') as installed`;
  if (name === auraCommonNamePriorityMigrationName) return `select
    exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)')
      and prosecdef and array_to_string(proconfig,',') like '%statement_timeout=5s%'
      and prosrc like '%commonName%' and prosrc like '%product_priority%'
      and prosrc like '%common_score%')
    and to_regclass('public.idx_ph_master_inventory_aura_name_trgm') is not null
    and not has_function_privilege('anon','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute')
    and not has_function_privilege('authenticated','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute')
    and has_function_privilege('service_role','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute') as installed`;
  if (name === auraInternalQueryMigrationName) {
    const helpers = [
      'public.aura_query_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)',
      'public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)',
      'public.aura_query_hl_order_v1(uuid,text,jsonb,jsonb,integer)',
      'public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)',
    ];
    const helperContracts = helpers.map(signature => `(
      exists(select 1 from pg_proc where oid=to_regprocedure('${signature}') and prosecdef
        and array_to_string(proconfig,',') like '%search_path=%'
        and array_to_string(proconfig,',') like '%statement_timeout=%')
      and not has_function_privilege('anon','${signature}','execute')
      and not has_function_privilege('authenticated','${signature}','execute')
      and has_function_privilege('service_role','${signature}','execute')
    )`).join(' and ');
    return `select ${helperContracts}
      and not has_schema_privilege('anon','aura_private','usage')
      and not has_schema_privilege('authenticated','aura_private','usage')
      and (select count(*)=2 from pg_class where oid in
        (to_regclass('aura_private.aura_query_conversations'),to_regclass('aura_private.aura_query_turns'))
        and relrowsecurity) as installed`;
  }
  if (name === inventoryRowAssignmentAuthorityMigrationName) return "select to_regclass('public.ph_inventory_row_assignments') is not null and to_regclass('public.ph_itemcode_default_owners') is not null and to_regprocedure('private.inventory_effective_owner_v1(text)') is not null and (select relrowsecurity from pg_class where oid='public.ph_inventory_row_assignments'::regclass) and not has_table_privilege('authenticated','public.ph_inventory_row_assignments','update') as installed";
  if (name === itemcodeDefaultOwnersMigrationName) return "select to_regprocedure('public.set_itemcode_default_owners_v1(jsonb,uuid)') is not null and to_regclass('private.ph_itemcode_default_owner_commands') is not null and to_regclass('private.ph_itemcode_default_owner_audit') is not null and has_function_privilege('service_role','public.set_itemcode_default_owners_v1(jsonb,uuid)','execute') and has_function_privilege('authenticated','public.set_itemcode_default_owners_v1(jsonb,uuid)','execute') and not has_function_privilege('anon','public.set_itemcode_default_owners_v1(jsonb,uuid)','execute') as installed";
  if (name === inventoryRowAssignmentFenceIntegrationMigrationName) return "select to_regclass('app_sync_private.sources') is not null and exists(select 1 from app_sync_private.sources where key='ph_inventory_row_assignments' and client_enabled) and to_regprocedure('public.reconcile_eval_itemcodes(uuid)') is not null and position('EVAL_ITEMCODE_GROUP_ASSIGNMENT_RETIRED' in pg_get_functiondef('public.set_eval_itemcode_assignment(text,text)'::regprocedure)) > 0 as installed";
  if (name === inventoryRowAssignmentFutureSnapshotsMigrationName) return "select position('ph_inventory_row_assignments' in pg_get_functiondef('public.finalize_pikes_order_import(text,text,text,integer,integer)'::regprocedure)) > 0 and position('ph_warehouse_assigned_items' in pg_get_functiondef('public.finalize_pikes_order_import(text,text,text,integer,integer)'::regprocedure)) = 0 and position('ph_itemcode_default_owners' in pg_get_functiondef('private.handover_assignment_targets_v1()'::regprocedure)) > 0 and to_regprocedure('private.handover_recompute_default_owner_rows_v1()') is not null as installed";
  if (name === inventoryRowAssignmentLiveConsumersMigrationName) return "select position('inventory_effective_owner_v1' in pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v1(jsonb)'::regprocedure)) > 0 and position('ph_inventory_row_assignments' in pg_get_functiondef('public.manager_season_priority_list_v1(uuid,text)'::regprocedure)) > 0 and position('from public.ph_warehouse_assigned_items a' in pg_get_functiondef('public.manager_season_priority_list_v1(uuid,text)'::regprocedure)) = 0 as installed";
  if (name === reclassSplitMoveMigrationName) return "select to_regprocedure('public.enqueue_drive_reclass_inquiry_v4(jsonb)') is not null and has_function_privilege('service_role','public.enqueue_drive_reclass_inquiry_v4(jsonb)','execute') and not has_function_privilege('authenticated','public.enqueue_drive_reclass_inquiry_v4(jsonb)','execute') and not has_function_privilege('anon','public.enqueue_drive_reclass_inquiry_v4(jsonb)','execute') and to_regprocedure('private.project_reclass_split_move_v4(jsonb,boolean)') is not null and to_regprocedure('private.validate_eval_work_inquiry_legacy_v1(jsonb,text,jsonb)') is not null and to_regprocedure('private.validate_eval_work_inquiry_v1(jsonb,text,jsonb)') is not null and to_regprocedure('private.validate_eval_work_inquiry_v4_strict(jsonb,text,jsonb)') is not null and exists(select 1 from pg_proc where oid=to_regprocedure('public.enqueue_drive_reclass_inquiry_v4(jsonb)') and prosecdef) as installed";
  if (name === reclassShearedMigrationName) return `select to_regprocedure('public.enqueue_drive_reclass_inquiry_v5(jsonb)') is not null and to_regprocedure('private.project_reclass_sheared_v5(jsonb)') is not null and to_regprocedure('private.validate_drive_reclass_sheared_v5(jsonb)') is not null and to_regprocedure('private.validate_eval_work_inquiry_sheared_v5(jsonb,text,jsonb)') is not null and has_function_privilege('service_role','public.enqueue_drive_reclass_inquiry_v5(jsonb)','execute') and not has_function_privilege('authenticated','public.enqueue_drive_reclass_inquiry_v5(jsonb)','execute') and not has_function_privilege('anon','public.enqueue_drive_reclass_inquiry_v5(jsonb)','execute') and exists(select 1 from pg_proc where oid=to_regprocedure('public.enqueue_drive_reclass_inquiry_v5(jsonb)') and prosecdef and proconfig @> array['search_path=""']) and position('quantity_text' in pg_get_functiondef('private.project_reclass_sheared_v5(jsonb)'::regprocedure))>0 and position('-->#' in pg_get_functiondef('private.project_reclass_sheared_v5(jsonb)'::regprocedure))>0 and ((to_regprocedure('private.submit_eval_work_v1_v5_impl(uuid,text,integer,jsonb,jsonb,text)') is null and position('validate_eval_work_inquiry_sheared_v5' in pg_get_functiondef('public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0) or (position('validate_eval_work_inquiry_sheared_v5' in pg_get_functiondef(to_regprocedure('private.submit_eval_work_v1_v5_impl(uuid,text,integer,jsonb,jsonb,text)')))>0 and position('submit_eval_work_v1_v5_impl' in pg_get_functiondef('public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0)) and ((to_regprocedure('private.submit_eval_work_v2_v5_impl(uuid,text,integer,jsonb,jsonb,text)') is null and position('validate_eval_work_inquiry_sheared_v5' in pg_get_functiondef('public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0) or (position('validate_eval_work_inquiry_sheared_v5' in pg_get_functiondef(to_regprocedure('private.submit_eval_work_v2_v5_impl(uuid,text,integer,jsonb,jsonb,text)')))>0 and position('submit_eval_work_v2_v5_impl' in pg_get_functiondef('public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0)) and position('update public.ph_master_inventory' in pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v5(jsonb)'::regprocedure))=0 as installed`;
  if (name === smartShieldRawImportMigrationName) return `select
    to_regprocedure('private.guard_ph_master_inventory_priority_hold_v1()') is not null
    and to_regprocedure('private.rearm_approved_hold_clear_shields_v1()') is not null
    and position('x-gnc-master-tuple-policy' in pg_get_functiondef('private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure))>0
    and position('raw-priority-hold-v1' in pg_get_functiondef('private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure))>0
    and position('raw_master_tuple' in pg_get_functiondef('private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure))>0
    and exists(select 1 from pg_trigger where tgname='aaa_ph_master_inventory_priority_hold_shield'
      and tgrelid='public.ph_master_inventory'::regclass
      and tgfoid='private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure
      and not tgisinternal and tgenabled='O')
    and not has_function_privilege('anon','private.guard_ph_master_inventory_priority_hold_v1()','execute')
    and not has_function_privilege('authenticated','private.guard_ph_master_inventory_priority_hold_v1()','execute')
    and not has_function_privilege('service_role','private.guard_ph_master_inventory_priority_hold_v1()','execute')
    and not has_function_privilege('anon','private.rearm_approved_hold_clear_shields_v1()','execute')
    and not has_function_privilege('authenticated','private.rearm_approved_hold_clear_shields_v1()','execute')
    and not has_function_privilege('service_role','private.rearm_approved_hold_clear_shields_v1()','execute') as installed`;
  if (name === reclassSmartShieldMigrationName) return `select
    to_regprocedure('public.enqueue_drive_reclass_inquiry_v6(jsonb)') is not null
    and to_regprocedure('public.submit_manager_season_priority_v2(uuid,text,integer,text,text)') is not null
    and to_regprocedure('private.guard_ph_master_inventory_priority_hold_v1()') is not null
    and to_regclass('app_sync_private.ph_master_inventory_app_edits') is not null
    and to_regclass('app_sync_private.ph_master_inventory_source_baselines') is not null
    and exists(select 1 from pg_trigger where tgname='aaa_ph_master_inventory_priority_hold_shield' and not tgisinternal)
    and has_function_privilege('service_role','public.enqueue_drive_reclass_inquiry_v6(jsonb)','execute')
    and not has_function_privilege('authenticated','public.enqueue_drive_reclass_inquiry_v6(jsonb)','execute')
    and not has_function_privilege('anon','public.enqueue_drive_reclass_inquiry_v6(jsonb)','execute')
    and has_function_privilege('service_role','public.submit_manager_season_priority_v2(uuid,text,integer,text,text)','execute')
    and not has_function_privilege('authenticated','public.submit_manager_season_priority_v2(uuid,text,integer,text,text)','execute')
    and not has_function_privilege('anon','public.submit_manager_season_priority_v2(uuid,text,integer,text,text)','execute')
    and position('v6FrozenRows' in pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v6(jsonb)'::regprocedure))>0
    and position('liveEdits' in pg_get_functiondef('public.submit_manager_season_priority_v2(uuid,text,integer,text,text)'::regprocedure))>0
    and ((to_regprocedure('private.submit_eval_work_v1_v6_impl(uuid,text,integer,jsonb,jsonb,text)') is null
      and position('eval_work_smart_shield_v6_to_v5' in pg_get_functiondef('public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0)
      or (position('eval_work_smart_shield_v6_to_v5' in pg_get_functiondef(to_regprocedure('private.submit_eval_work_v1_v6_impl(uuid,text,integer,jsonb,jsonb,text)')))>0
        and position('submit_eval_work_v1_v6_impl' in pg_get_functiondef('public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0
        and not has_function_privilege('service_role',to_regprocedure('private.submit_eval_work_v1_v6_impl(uuid,text,integer,jsonb,jsonb,text)'),'execute')))
    and ((to_regprocedure('private.submit_eval_work_v2_v6_impl(uuid,text,integer,jsonb,jsonb,text)') is null
      and position('eval_work_smart_shield_v6_to_v5' in pg_get_functiondef('public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0)
      or (position('eval_work_smart_shield_v6_to_v5' in pg_get_functiondef(to_regprocedure('private.submit_eval_work_v2_v6_impl(uuid,text,integer,jsonb,jsonb,text)')))>0
        and position('submit_eval_work_v2_v6_impl' in pg_get_functiondef('public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0
        and not has_function_privilege('service_role',to_regprocedure('private.submit_eval_work_v2_v6_impl(uuid,text,integer,jsonb,jsonb,text)'),'execute')))
    and not has_table_privilege('service_role','app_sync_private.ph_master_inventory_app_edits','select') as installed`;
  if (name === reclassEvalSubmitGuardsMigrationName) return "select to_regprocedure('public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)') is not null and to_regprocedure('public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_eval_work' and column_name='submission_request_fingerprint') and has_function_privilege('service_role','public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)','execute') and has_function_privilege('service_role','public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)','execute') and not has_function_privilege('service_role','public.submit_eval_work_legacy_v1(uuid,text,integer,jsonb,jsonb,text)','execute') and not has_function_privilege('service_role','public.submit_eval_work_legacy_v2(uuid,text,integer,jsonb,jsonb,text)','execute') as installed";
  if (name === bunchNoteCardsMigrationName) return "select to_regclass('bunch_note_private.bunch_note_work_cards') is not null and to_regprocedure('bunch_note_private.normalize_work_cards(jsonb,jsonb)') is not null and (select relrowsecurity from pg_class where oid='bunch_note_private.bunch_note_work_cards'::regclass) and not has_table_privilege('authenticated','bunch_note_private.bunch_note_work_cards','select') and not has_table_privilege('anon','bunch_note_private.bunch_note_work_cards','update') and exists(select 1 from pg_trigger where tgname='bunch_note_batch_v5_cards' and not tgisinternal) and exists(select 1 from pg_trigger where tgname='bunch_note_job_work_cards' and not tgisinternal) as installed";
  if (name === bunchNoteCardCommandsMigrationName) return "select to_regprocedure('public.bunch_note_card_command_v1(uuid,text,jsonb,uuid,bigint)') is not null and has_function_privilege('service_role','public.bunch_note_card_command_v1(uuid,text,jsonb,uuid,bigint)','execute') and not has_function_privilege('authenticated','public.bunch_note_card_command_v1(uuid,text,jsonb,uuid,bigint)','execute') and not has_function_privilege('anon','public.bunch_note_card_command_v1(uuid,text,jsonb,uuid,bigint)','execute') as installed";
  if (name === structuredBunchNotesMigrationName) return "select to_regclass('bunch_note_private.bunch_notes') is not null and to_regclass('bunch_note_private.bunch_note_lines') is not null and to_regprocedure('bunch_note_private.structured_note(jsonb,jsonb)') is not null and (select relrowsecurity from pg_class where oid='bunch_note_private.bunch_notes'::regclass) and (select relrowsecurity from pg_class where oid='bunch_note_private.bunch_note_lines'::regclass) and not has_table_privilege('authenticated','bunch_note_private.bunch_notes','select') and not has_table_privilege('authenticated','bunch_note_private.bunch_note_lines','update') and has_function_privilege('service_role','public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint)','execute') as installed";
  if (name === suspendTagApprovalMigrationName) return "select to_regprocedure('public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)') is not null and to_regprocedure('public.prepare_suspend_tag_delivery_v1(uuid,uuid)') is not null and has_function_privilege('service_role','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute') and not has_function_privilege('authenticated','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute') and has_column_privilege('authenticated','public.ph_soc_master','dock_note','update') and not has_column_privilege('authenticated','public.ph_soc_master','date_completed','update') and (select relrowsecurity from pg_class where oid='suspend_tag_private.approvals'::regclass) and exists(select 1 from pg_policies where schemaname='public' and tablename='ph_soc_master' and policyname='suspend_tag_read') as installed";
  if (name === auraLlmFreeTierMigrationName) return "select exists(select 1 from pg_class where oid=to_regclass('aura_private.llm_provider_calls') and relrowsecurity) and not has_schema_privilege('anon','aura_private','usage') and not has_schema_privilege('authenticated','aura_private','usage') and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)') and not prosecdef and array_to_string(proconfig,',') like '%statement_timeout=1s%') and has_function_privilege('service_role','public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)','execute') and not has_function_privilege('anon','public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)','execute') and not has_function_privilege('authenticated','public.aura_llm_reserve_call_v1(uuid,integer,integer,integer,integer,integer)','execute') and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_inventory_lot_lookup_v1(text,text,integer)') and not prosecdef and array_to_string(proconfig,',') like '%statement_timeout=4s%') and has_function_privilege('service_role','public.aura_inventory_lot_lookup_v1(text,text,integer)','execute') and not has_function_privilege('anon','public.aura_inventory_lot_lookup_v1(text,text,integer)','execute') and not has_function_privilege('authenticated','public.aura_inventory_lot_lookup_v1(text,text,integer)','execute') and to_regclass('public.idx_ph_master_inventory_aura_lot_uid') is not null as installed";
  if (name === evalDeliveryArchiveHealthMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('private.request_folder_archive_only_completed_v1(text)') and not prosecdef and provolatile='s') and not has_function_privilege('anon','private.request_folder_archive_only_completed_v1(text)','execute') and not has_function_privilege('authenticated','private.request_folder_archive_only_completed_v1(text)','execute') and position('archive_only_completed_folder_count' in pg_get_functiondef('public.get_eval_request_delivery_health_snapshot_v2()'::regprocedure))>0 and has_function_privilege('service_role','public.get_eval_request_delivery_health_snapshot_v2()','execute') and not has_function_privilege('anon','public.get_eval_request_delivery_health_snapshot_v2()','execute') and not has_function_privilege('authenticated','public.get_eval_request_delivery_health_snapshot_v2()','execute') as installed";
  if (name === nellyAccessAuditMigrationName) return "select exists(select 1 from public.profiles p where p.id='961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid and lower(btrim(p.username))='nelly_aguilar' and private.normalized_profile_role(p.role)='ADMIN') and private.resolve_app_access_policy_id_v1(true) is not null and (select count(*) from private.get_effective_app_permissions_v1('961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid,private.resolve_app_access_policy_id_v1(true)))=(select count(*) from private.app_access_permissions where active) and exists(select 1 from private.app_access_permissions where active) and not exists(select 1 from private.get_effective_app_permissions_v1('961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid,private.resolve_app_access_policy_id_v1(true)) e left join private.app_access_legacy_baseline b on b.profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid and b.permission_key=e.permission_key where b.permission_key is null) as installed";
  if (name === auraInventoryV2MigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)') and not prosecdef) and has_function_privilege('service_role','public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute') and not has_function_privilege('anon','public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute') and not has_function_privilege('authenticated','public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute') as installed";
  if (name === auraInventoryMatchMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)') and not prosecdef and array_to_string(proconfig,',') like '%statement_timeout=4s%') and has_function_privilege('service_role','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute') and not has_function_privilege('anon','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute') and not has_function_privilege('authenticated','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute') and to_regclass('public.idx_ph_master_inventory_aura_name_trgm') is not null and to_regclass('public.idx_ph_master_inventory_aura_season_size') is not null as installed";
  if (name === auraDynamicSeasonScopeMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)') and prosecdef and proconfig @> array['search_path=\"\"','statement_timeout=5s']) and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_resolve_season_v1(uuid,text)') and prosecdef and proconfig @> array['search_path=\"\"','statement_timeout=5s']) and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)') and prosecdef and proconfig @> array['search_path=\"\"','statement_timeout=8s']) and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)') and prosecdef and proconfig @> array['pg_trgm.word_similarity_threshold=0.3']) and has_function_privilege('service_role','public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)','execute') and has_function_privilege('service_role','public.aura_resolve_season_v1(uuid,text)','execute') and has_function_privilege('service_role','public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('anon','public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)','execute') and not has_function_privilege('authenticated','public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)','execute') and not has_function_privilege('anon','public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('authenticated','public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)','execute') and position('settingRevision' in pg_get_functiondef('public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure))>0 as installed";
  if (name === auraInventoryExplicitProjectionMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)') and prosecdef and exists(select 1 from unnest(proconfig) c where c like 'search_path=%') and proconfig @> array['statement_timeout=5s','pg_trgm.word_similarity_threshold=0.3'] and position('settingRevision' in prosrc)>0 and position('m.unique_id,m.itemcode,m.commonname,m.contsize,m.ptravailable,m.ptronhand,m.genusname,m.botanicalname' in prosrc)>0 and position('m.*' in prosrc)=0) and has_function_privilege('service_role','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('anon','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('authenticated','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute') as installed";
  if (name === auraVoiceRoleAccessMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_access_v1()') and prosecdef and proconfig @> array['statement_timeout=5s'] and position('auth.uid()' in prosrc)>0 and position('historical-requests' in prosrc)>0 and position('drive' in prosrc)>0 and position('av' in prosrc)>0) and has_function_privilege('authenticated','public.aura_voice_access_v1()','execute') and not has_function_privilege('anon','public.aura_voice_access_v1()','execute') and not has_function_privilege('service_role','public.aura_voice_access_v1()','execute') and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)') and prosecdef and position('auth.uid()' in prosrc)>0) and has_function_privilege('authenticated','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','execute') and not has_function_privilege('anon','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','execute') and not has_function_privilege('service_role','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','execute') and exists(select 1 from pg_proc where oid=to_regprocedure('private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)') and prosecdef and position('datasetRevision' in prosrc)>0 and position('m.unique_id,m.itemcode,m.commonname,m.contsize,m.ptravailable,m.ptronhand,m.genusname,m.botanicalname' in prosrc)>0) and not has_function_privilege('authenticated','private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('service_role','private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)','execute') and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)') and prosecdef and position('historical-requests' in prosrc)>0) and has_function_privilege('service_role','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute') and not has_function_privilege('authenticated','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute') and not has_function_privilege('anon','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute') as installed";
  if (name === auraVoiceSocReadsMigrationName) return "select exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_context_v1()') and prosecdef and provolatile='v' and position('FOR SHARE' in upper(prosrc))>0 and has_function_privilege('authenticated','public.aura_voice_context_v1()','execute') and not has_function_privilege('anon','public.aura_voice_context_v1()','execute') and not has_function_privilege('service_role','public.aura_voice_context_v1()','execute')) and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)') and prosecdef and provolatile='v' and proconfig @> array['statement_timeout=6s'] and position('sales_private.assigned_rep' in prosrc)>0 and position('requestedVariants' in prosrc)>0 and position('expectedSettingRevision' in prosrc)>0 and position('candidateChoicesTruncated' in prosrc)>0) and has_function_privilege('authenticated','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','execute') and not has_function_privilege('anon','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','execute') and not has_function_privilege('service_role','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','execute') and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_access_v1()') and position('socReserves' in prosrc)>0 and position('socOpenOrders' in prosrc)>0) and exists(select 1 from pg_proc where oid=to_regprocedure('public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)') and position('navigation_module_allowed_v1(p_actor_id,''reserves'')' in prosrc)>0 and position('navigation_module_allowed_v1(p_actor_id,''docks'')' in prosrc)>0 and has_function_privilege('service_role','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute') and not has_function_privilege('authenticated','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute')) as installed";
  if (name === readOptimizationMigrationName) return "select exists(select 1 from pg_index where indexrelid=to_regclass('public.idx_ph_request_history_assigned_rep_id') and indisvalid) and to_regprocedure('public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])') is not null and has_function_privilege('service_role','public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') and not has_function_privilege('anon','public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') and not has_function_privilege('authenticated','public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') as installed";
  if (name === scheduledHandoverMigrationName) return "select to_regprocedure('public.app_account_active_v1(uuid,text)') is not null and to_regprocedure('public.resolve_operational_recipients_v1(text[],text)') is not null and to_regprocedure('public.scheduled_handover_tick_v1()') is not null and exists(select 1 from private.scheduled_account_handover_v1 where departing_profile_id='e2584b32-472c-4888-b592-394235050b5b'::uuid and successor_profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid and effective_at='2026-10-03 04:00:00+00'::timestamptz and ((completed_at is not null and auth_banned_at is not null) or exists(select 1 from cron.job where jobname='scheduled_handover_kayla_nelly_20261002' and active and schedule='* * * * *' and command='select private.scheduled_handover_dispatch_v1();'))) as installed";
  if (name === handoverAssignmentMigrationName) return "select to_regprocedure('private.transfer_remaining_handover_assignments_v1(text,integer)') is not null and to_regprocedure('private.handover_normalize_assignment_v1()') is not null as installed";
  if (name === requestArchiveMigrationName) return "select to_regprocedure('public.request_archive_command_v1(uuid,text,text,uuid)') is not null and to_regprocedure('public.request_archive_list_v1(uuid,integer,integer)') is not null as installed";
  if (name === migrationName) return "select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed";
  if (name === perennialAssignmentMigrationName) return "select to_regprocedure('public.reconcile_eval_itemcodes(uuid)') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_warehouse_assigned_items' and column_name='zone_override_active') as installed";
  if (name === passwordReconciliationMigrationName) return "select to_regprocedure('public.prepare_password_change_profile(text,uuid,text)') is not null and to_regprocedure('public.complete_password_change_profile(uuid,uuid,text,text)') is not null as installed";
  if (name === productionScheduleMigrationName) return "select to_regprocedure('public.production_schedule_start_import_v1(text)') is not null and to_regprocedure('public.production_schedule_read_metadata_v1()') is not null and to_regclass('public.production_schedule_rows') is not null as installed";
  if (name === auraHrCommandCenterMigrationName) return "select to_regclass('public.core_employees') is not null and to_regclass('public.hr_job_codes') is not null and to_regclass('public.hr_events') is not null and to_regclass('public.labor_timesheets') is not null and exists(select 1 from pg_partitioned_table where partrelid='public.labor_timesheets'::regclass) and to_regprocedure('public.hr_claim_calendar_reminders_v1(integer)') is not null and to_regprocedure('public.hr_finish_calendar_reminder_v1(uuid,boolean,text)') is not null and to_regprocedure('private.hr_purge_calendar_reminders_v1()') is not null and to_regprocedure('private.hr_active_username_v1()') is not null and exists(select 1 from cron.job where jobname='hr_calendar_reminder_sweep') as installed";
  if (name === managerReportReadV2MigrationName) return `select
    to_regprocedure('public.manager_report_read_v2(jsonb)') is not null
    and exists(select 1 from pg_proc p where p.oid='public.manager_report_read_v2(jsonb)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""'])
    and has_function_privilege('service_role','public.manager_report_read_v2(jsonb)','execute')
    and not has_function_privilege('anon','public.manager_report_read_v2(jsonb)','execute')
    and not has_function_privilege('authenticated','public.manager_report_read_v2(jsonb)','execute')
    and to_regprocedure('public.manager_ncr_outbox_metadata_v1(text,text)') is not null
    and has_function_privilege('service_role','public.manager_ncr_outbox_metadata_v1(text,text)','execute')
    and not has_function_privilege('anon','public.manager_ncr_outbox_metadata_v1(text,text)','execute')
    and not has_function_privilege('authenticated','public.manager_ncr_outbox_metadata_v1(text,text)','execute')
    and position('private.inventory_effective_owner_v1' in pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure))>0
    and not exists(select 1 from unnest(array[
      to_regclass('public.idx_ph_master_inventory_eval_itemcode_lookup'),
      to_regclass('public.idx_ph_master_inventory_eval_tasks'),
      to_regclass('public.ph_master_inventory_location_work_match_idx'),
      to_regclass('public.ph_inventory_row_assignments_owner_idx'),
      to_regclass('public.ph_inventory_row_assignments_itemcode_idx')
    ]::regclass[]) named(index_oid) left join pg_index i on i.indexrelid=named.index_oid
      where i.indexrelid is null or not i.indisvalid)
    and not exists(select 1 from (values
      ('idx_ph_master_inventory_eval_itemcode_lookup','public.ph_master_inventory','upper(btrim(coalesce(itemcode,''''::text)))',''),
      ('idx_ph_master_inventory_eval_tasks','public.ph_master_inventory','assignedto,eval_task_status,eval_task_type',''),
      ('ph_master_inventory_location_work_match_idx','public.ph_master_inventory','lower(btrim(itemcode)),lower(btrim(saleyear)),lower(btrim(locationcode)),unique_id',''),
      ('ph_inventory_row_assignments_owner_idx','public.ph_inventory_row_assignments','lower(btrim(assignedto)),master_unique_id','present_in_driveand(assignedtoisnotnull)'),
      ('ph_inventory_row_assignments_itemcode_idx','public.ph_inventory_row_assignments','itemcode_normalized,master_unique_id','present_in_drive')
    ) expected(index_name,table_name,key_fragment,predicate_fragment)
    left join pg_class c on c.oid=to_regclass('public.'||expected.index_name)
    left join pg_index i on i.indexrelid=c.oid
    where c.oid is null or c.relnamespace<>'public'::regnamespace
      or i.indrelid<>expected.table_name::regclass
      or position(regexp_replace(lower(expected.key_fragment),'[[:space:]\"]','','g') in lower(regexp_replace(pg_get_indexdef(c.oid),'[[:space:]\"]','','g')))=0
      or (expected.predicate_fragment<>'' and position(expected.predicate_fragment in lower(regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[[:space:]\"]','','g')))=0)
    ) as installed`;
  if (name === managerListReadV2MigrationName) return `select
    to_regprocedure('private.manager_report_assigned_page_v2(uuid,jsonb,text,integer,integer,text)') is not null
    and to_regprocedure('private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)') is not null
    and not has_function_privilege('anon','private.manager_report_assigned_page_v2(uuid,jsonb,text,integer,integer,text)','execute')
    and not has_function_privilege('authenticated','private.manager_report_assigned_page_v2(uuid,jsonb,text,integer,integer,text)','execute')
    and not has_function_privilege('service_role','private.manager_report_assigned_page_v2(uuid,jsonb,text,integer,integer,text)','execute')
    and not has_function_privilege('anon','private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)','execute')
    and not has_function_privilege('authenticated','private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)','execute')
    and not has_function_privilege('service_role','private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)','execute')
    and exists(select 1 from pg_proc p where p.oid='private.manager_report_assigned_page_v2(uuid,jsonb,text,integer,integer,text)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""'])
    and exists(select 1 from pg_proc p where p.oid='private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""']) as installed`;
  if (name === bunchNoteBlueprintHeaderPdfDeliveryMigrationName) return `select
    (select count(*)=3 and bool_and(is_nullable='NO') and bool_and(data_type='text')
      from information_schema.columns
      where table_schema='bunch_note_private' and table_name='bunch_note_work_cards'
        and column_name=any(array['destination_qualifier','workflow_instructions','left_margin']::text[]))
    and exists(select 1 from pg_constraint c
      where c.conrelid='bunch_note_private.bunch_note_work_cards'::regclass
        and c.conname='bunch_note_work_cards_workflow_action_check'
        and position('compound' in pg_get_constraintdef(c.oid))>0
        and position('set_out' in pg_get_constraintdef(c.oid))>0)
    and exists(select 1 from pg_constraint c
      where c.conrelid='bunch_note_private.bunch_note_work_cards'::regclass
        and c.conname='bunch_note_work_cards_routing_check'
        and position('workflow_instructions' in pg_get_constraintdef(c.oid))>0
        and position('destination_qualifier' in pg_get_constraintdef(c.oid))>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('bunch_note_private.structured_note(jsonb,jsonb)')
        and position('purpose_thread' in p.prosrc)>0 and position('default_house_plan' in p.prosrc)>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('bunch_note_private.normalize_work_cards(jsonb,jsonb)')
        and position('kind' in p.prosrc)>0 and position('workflow_instructions' in p.prosrc)>0
        and position('destination_qualifier' in p.prosrc)>0 and position('left_margin' in p.prosrc)>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('bunch_note_private.mirror_work_cards()')
        and position('kind' in p.prosrc)>0 and position('workflow_instructions' in p.prosrc)>0
        and position('destination_qualifier' in p.prosrc)>0 and position('left_margin' in p.prosrc)>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('bunch_note_private.validate_blueprint_header()')
        and not p.prosecdef and p.proconfig @> array['search_path=""']
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute')
        and position('schedule_banner' in p.prosrc)>0 and position('rule_chips' in p.prosrc)>0)
    and (select count(*)=2 from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bunch_note_private' and not t.tgisinternal
        and t.tgname=any(array['zzz_bunch_note_v221_header_guard','zzz_bunch_note_v221_job_header_guard']::text[]))
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('bunch_note_private.recipients_for_reports(jsonb,jsonb)')
        and p.prosecdef and p.proconfig @> array['search_path=""']
        and not has_function_privilege('anon',p.oid,'execute')
        and not has_function_privilege('authenticated',p.oid,'execute')
        and not has_function_privilege('service_role',p.oid,'execute')
        and position('megan_kelly' in p.prosrc)>0 and position('sharon_combs' in p.prosrc)>0
        and position('owner_ids' in p.prosrc)>0 and position('bunch_note_private.recipients(ids)' in p.prosrc)>0)
    and exists(select 1 from pg_proc p
      where p.oid=to_regprocedure('bunch_note_private.bunch_note_command_legacy(uuid,text,jsonb,uuid,bigint)')
        and position('recipients_for_reports' in p.prosrc)>0)
    as installed`;
  if (name === bunchNoteMultiAssignmentRoutingMigrationName) return `select
    (select count(*)=4 from information_schema.columns
      where table_schema='bunch_note_private' and table_name='bunch_note_work_cards'
        and column_name=any(array['workflow_action','destination_location','destination_house','notes']::text[]))
    and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bunch_note_private' and c.relname='bunch_note_card_assignees' and c.relrowsecurity
        and not has_table_privilege('anon',c.oid,'select')
        and not has_table_privilege('authenticated',c.oid,'select')
        and not has_table_privilege('service_role',c.oid,'select'))
    and (select count(*)=8 and bool_and(not has_function_privilege('anon',p.oid,'execute'))
      and bool_and(not has_function_privilege('authenticated',p.oid,'execute'))
      and bool_and(not has_function_privilege('service_role',p.oid,'execute'))
      from pg_proc p where p.oid in (
        to_regprocedure('bunch_note_private.card_allowed(uuid,bunch_note_private.jobs,uuid)'),
        to_regprocedure('bunch_note_private.normalize_work_cards(jsonb,jsonb)'),
        to_regprocedure('bunch_note_private.mirror_work_cards()'),
        to_regprocedure('bunch_note_private.card_safe_job(bunch_note_private.jobs,uuid)'),
        to_regprocedure('bunch_note_private.card_destination_view(public.profiles,text)'),
        to_regprocedure('bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint)'),
        to_regprocedure('bunch_note_private.card_instruction_snapshot(jsonb,uuid)'),
        to_regprocedure('bunch_note_private.card_instruction_snapshot_map(jsonb)')))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint)')
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute'))
    and (select count(*)=2 from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bunch_note_private'
        and t.tgname=any(array['bunch_note_batch_work_cards','bunch_note_job_work_cards']::text[])
        and not t.tgisinternal) as installed`;
  if (name === bunchNoteQueueExecutionMigrationName) return `select
    to_regclass('bunch_note_private.workflow_commands') is not null
    and to_regclass('bunch_note_private.card_completions') is not null
    and to_regclass('bunch_note_private.count_reviews') is not null
    and (select count(*)=3 and bool_and(c.relrowsecurity) from
      unnest(array[to_regclass('bunch_note_private.workflow_commands'),
        to_regclass('bunch_note_private.card_completions'),to_regclass('bunch_note_private.count_reviews')]) names(oid)
      join pg_class c on c.oid=names.oid)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute'))
    and not has_table_privilege('anon',to_regclass('bunch_note_private.card_completions'),'select')
    and not has_table_privilege('authenticated',to_regclass('bunch_note_private.card_completions'),'select')
    and not has_table_privilege('service_role',to_regclass('bunch_note_private.card_completions'),'select')
    and has_function_privilege('service_role',to_regprocedure('public.bunch_note_delivery_lookup_v1(uuid)'),'execute')
    and not has_function_privilege('anon',to_regprocedure('public.bunch_note_delivery_lookup_v1(uuid)'),'execute')
    and not has_function_privilege('authenticated',to_regprocedure('public.bunch_note_delivery_lookup_v1(uuid)'),'execute')
    and has_function_privilege('service_role',to_regprocedure('public.bunch_note_freeze_pdfs_v1(uuid,jsonb)'),'execute')
    and not has_function_privilege('anon',to_regprocedure('public.bunch_note_freeze_pdfs_v1(uuid,jsonb)'),'execute')
    and not has_function_privilege('authenticated',to_regprocedure('public.bunch_note_freeze_pdfs_v1(uuid,jsonb)'),'execute')
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')
      and p.prosecdef and p.proconfig @> array['search_path=""'])
    and pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')) like '%sharon_combs%'
    as installed`;
  if (name === bunchNoteSupervisorAssigneeFacetsMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('service_role',p.oid,'execute'))
    and position('dylan_collyge' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('dylan_college' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('sharon_combs' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('ADMIN' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('ADMINISTRATOR' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('SUPERVISOR' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('DATAENTRYSUPERVISOR' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('SENIORINVENTORYMANAGER' in pg_get_functiondef(to_regprocedure('bunch_note_private.workflow_can_review(public.profiles)')))>0
    and position('assignee_options' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('unassigned_count' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('facet_people as (' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('count(*) card_count from facet_people' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('ca.user_id is distinct from a.owner_id' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('cross join facets' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('assigned_to' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('unassigned' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('coalesce(p.active and p.status=' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('coalesce(r.assigned_counter_id=actor.id or review_allowed,false)' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('coalesce(v.assigned_counter_id=actor.id or review_allowed,false)' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    and position('if not coalesce(card.owner_id=actor.id' in pg_get_functiondef(to_regprocedure('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)')))>0
    as installed`;
  if (name === suspendTagSenderIdentityMigrationName) return `select
    exists(select 1 from information_schema.columns where table_schema='suspend_tag_private' and table_name='approvals'
      and column_name='sent_by' and udt_name='uuid' and is_nullable='NO')
    and exists(select 1 from information_schema.columns where table_schema='suspend_tag_private' and table_name='approvals'
      and column_name='decision_message' and data_type='text')
    and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='suspend_tag_private' and c.relname='approval_recipients' and c.relrowsecurity)
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      where n.nspname='suspend_tag_private' and c.relname='approval_recipients'
        and acl.grantee=0 and acl.privilege_type='SELECT')
    and not has_table_privilege('anon','suspend_tag_private.approval_recipients','select')
    and not has_table_privilege('authenticated','suspend_tag_private.approval_recipients','select')
    and not has_table_privilege('anon','suspend_tag_private.approval_recipients','insert')
    and not has_table_privilege('authenticated','suspend_tag_private.approval_recipients','insert')
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('suspend_tag_private.capture_decision_message()')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute'))
    and exists(select 1 from pg_trigger t where t.tgrelid='suspend_tag_private.approvals'::regclass
      and t.tgname='suspend_tag_capture_decision_message' and t.tgenabled='O'
      and t.tgfoid=to_regprocedure('suspend_tag_private.capture_decision_message()'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('suspend_tag_private.request_approval(text)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('sender_id' in pg_get_functiondef(p.oid))>0
      and position('app.suspend_tag_actor_id' in pg_get_functiondef(p.oid))>0
      and position('decision_emails' in pg_get_functiondef(p.oid))>0
      and position('approval_recipients' in pg_get_functiondef(p.oid))>0
      and position('sent_by' in pg_get_functiondef(p.oid))>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)')
      and p.prosecdef is false
      and position('session_active' in pg_get_functiondef(p.oid))>0
      and position('app.suspend_tag_decision_message' in pg_get_functiondef(p.oid))>0
      and position('SUSPEND_TAG_DECISION_MESSAGE_INVALID' in pg_get_functiondef(p.oid))>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.prepare_suspend_tag_delivery_v1(uuid,uuid)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and position('approval_recipients' in pg_get_functiondef(p.oid))>0
      and position('decision_emails' in pg_get_functiondef(p.oid))>0
      and position('decisionMessage' in pg_get_functiondef(p.oid))>0
      and position('DELIVERY_WORKER_FORBIDDEN' in pg_get_functiondef(p.oid))>0)
    as installed`;
  if (name === canonicalUserAccessMigrationName) return `select
    (select count(*)=14 and bool_and(jsonb_typeof(permissions)='object'
      and (select count(*)=9 from jsonb_object_keys(permissions))) from public.role_access_baselines)
    and (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
      'public.role_access_baselines'::regclass,'public.user_access_control'::regclass,
      'public.user_access_control_state'::regclass,'public.user_access_control_commands'::regclass,
      'public.user_access_control_audit'::regclass))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.user_access_command_v1(uuid,text,jsonb,bigint,uuid)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and not has_function_privilege('anon',p.oid,'execute'))
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.user_access_has_permission_v1(uuid,text)')
      and p.prosecdef and p.proconfig @> array['search_path=""'])
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.data_permission_version(uuid)')
      and position('user-access:' in pg_get_functiondef(p.oid))>0)
    and exists(select 1 from pg_trigger t where t.tgrelid='public.profiles'::regclass
      and t.tgname='profiles_sync_user_access_control_v1' and t.tgenabled='O')
    as installed`;
  if (name === inventoryReclassMoveDeliveryMigrationName) return `select
    exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid))>0
      and position('ph_request_delivery_outbox' in pg_get_functiondef(p.oid))>0
      and position('inventory_reclass_move_completed' in pg_get_functiondef(p.oid))>0)
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)')
      and p.prosecdef and p.proconfig @> array['search_path=""']
      and has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')
      and position('lease_token' in pg_get_functiondef(p.oid))>0
      and position('processing' in pg_get_functiondef(p.oid))>0
      and position('ph_inventory_reclass_batch_receipts_v1' in pg_get_functiondef(p.oid))>0)
    as installed`;
  if (name === reclassSeasonStockMigrationName) return `select
    to_regclass('app_sync_private.inventory_season_stock_overrides_v1') is not null
    and to_regprocedure('private.inventory_season_stock_receipt_v1(text[])') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ph_master_inventory'::regclass and tgname='zz_reclass_season_stock_update' and tgenabled='O')
    and position('sharon_combs' in pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure))>0
    and position('inventory_season_stock_receipt_v1' in pg_get_functiondef('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    as installed`;
  if (name === reclassPhysicalStockMigrationName) return `select
    position('private.reclass_numeric_v1(m.s_lts)+change.delta' in pg_get_functiondef('private.propagate_inventory_season_stock_v1()'::regprocedure))>0
    and position('new.season_oh:=stock.season_oh::text' in pg_get_functiondef('private.guard_inventory_season_stock_v1()'::regprocedure))>0
    and position('new.s_lts:=stock.open_stock::text' in pg_get_functiondef('private.guard_inventory_season_stock_v1()'::regprocedure))=0
    and position('''rows''' in pg_get_functiondef('private.inventory_season_stock_receipt_v1(text[])'::regprocedure))>0
    as installed`;
  if (name === dashboardWarningCleanupMigrationName) return `select
    to_regclass('public.ph_reclass_recount_jobs') is not null
    and to_regclass('public.ph_reclass_recount_lines') is not null
    and (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.ph_reclass_recount_jobs'::regclass)
    and (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.ph_reclass_recount_lines'::regclass)
    and exists(select 1 from pg_trigger where tgrelid='public.ph_request_delivery_outbox'::regclass
      and tgname='capture_reclass_recount_outbox_v1' and tgenabled='O')
    and has_function_privilege('service_role','public.complete_reclass_recount_v1(uuid,uuid,numeric,uuid)','execute')
    and not has_function_privilege('authenticated','public.complete_reclass_recount_v1(uuid,uuid,numeric,uuid)','execute')
    and has_function_privilege('service_role','public.dataset_revisions_for_actor_v1(uuid,text[])','execute')
    and not has_function_privilege('authenticated','public.dataset_revisions_for_actor_v1(uuid,text[])','execute')
    and position('revisionChanged' in pg_get_functiondef('public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)'::regprocedure))>0
    and position('revisionChanged' in pg_get_functiondef('public.inventory_location_on_hand_read_v1(uuid,jsonb,text)'::regprocedure))>0
    and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='v'
        and not coalesce((select option_value='true' from pg_options_to_table(c.reloptions)
          where option_name='security_invoker'),false))
    and (select datcollversion=pg_database_collation_actual_version(oid) from pg_database where datname=current_database())
    as installed`;
  if (name === driveLocationEvidenceMigrationName) return `select
    to_regclass('app_sync_private.inventory_location_evidence_v1') is not null
    and (select relrowsecurity from pg_class where oid='app_sync_private.inventory_location_evidence_v1'::regclass)
    and not has_table_privilege('authenticated','app_sync_private.inventory_location_evidence_v1','select')
    and exists(select 1 from pg_trigger where tgrelid='public.ph_master_inventory'::regclass
      and tgname='zzz_inventory_location_evidence_apply' and tgenabled='O')
    and exists(select 1 from pg_trigger where tgrelid='public.ph_master_inventory'::regclass
      and tgname='zzzz_inventory_location_evidence_capture' and tgenabled='O')
    and has_function_privilege('service_role','public.reconcile_inventory_location_evidence_v1()','execute')
    and not has_function_privilege('authenticated','public.reconcile_inventory_location_evidence_v1()','execute')
    and has_function_privilege('authenticated','public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text)','execute')
    and position('private.require_active_admin_profile' in pg_get_functiondef('public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text)'::regprocedure))>0
    and to_regclass('app_sync_private.request_lifecycle_tombstones_v1') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ph_active_request'::regclass
      and tgname='capture_request_lifecycle_tombstone_v1' and tgenabled='O')
    and has_function_privilege('service_role','public.reconcile_active_requests_from_outbox_v1()','execute')
    and not has_function_privilege('authenticated','public.reconcile_active_requests_from_outbox_v1()','execute')
    and position('''previewHasMore'',false' in pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure))>0
    and position('private.eval_work_natural_sort_key_v1(p.lotcode)' in pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure))>0
    as installed`;
  if (name === boundedRequestQueueReconciliationMigrationName) return `select
    to_regclass('public.ph_request_delivery_outbox_request_created_recent_idx') is not null
    and ((position('limit 100' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
      and position('order by o.created_at desc,o.event_id desc' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0)
      or (position('limit 100' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))=0
        and position('request_completed' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
        and position('ph_request_queue_removal_commands' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0))
    and position('regexp_matches' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
    and position('insert into public.ph_active_request' in lower(pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure)))>0
    and position('insert into public.ph_request_delivery_outbox' in lower(pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure)))>0
    and exists(select 1 from pg_trigger where tgrelid='public.ph_active_request'::regclass
      and tgname='app_dataset_revision_inserted' and tgenabled='O')
    and has_function_privilege('service_role','public.reconcile_active_requests_from_outbox_v1()','execute')
    and not has_function_privilege('authenticated','public.reconcile_active_requests_from_outbox_v1()','execute')
    as installed`;
  if (name === requestQuantityRecoveryMigrationName) return `select
    exists(select 1 from pg_trigger where tgrelid='public.ph_active_request'::regclass
      and tgname='app_dataset_revision_updated' and tgenabled='O')
    and not exists(
      select 1
      from (values
        ('REQ-mvlgbfl7p8r8zxrj97j','1'::text),('REQ-mvlg4t85vlzf7053pv','1'::text),
        ('REQ-mvlfib5eqwa3typzcqq','1'::text),('REQ-mvlfib5evawvlvvx09','1'::text),
        ('REQ-mvlex5bay7ngnehzi7','1'::text),('REQ-mvlbp5hkkk58akaubms','10'::text),
        ('REQ-mvk1xgv2ty9fttuqj2','4'::text)
      ) corrections(unique_id,expected_qty)
      join public.ph_active_request active using(unique_id)
      where lower(btrim(coalesce(active.req_status,'')))='pending'
        and active.req_qty is distinct from corrections.expected_qty
    ) as installed`;
  if (name === inventoryLocationEvidenceLifecycleMigrationName) return `select
    exists(select 1 from pg_attribute where attrelid='app_sync_private.inventory_location_evidence_v1'::regclass
      and attname='baseline_on_hand' and not attisdropped)
    and exists(select 1 from pg_attribute where attrelid='app_sync_private.inventory_location_evidence_v1'::regclass
      and attname='current_photo_match_qty' and not attisdropped)
    and exists(select 1 from pg_trigger where tgrelid='app_sync_private.inventory_location_evidence_v1'::regclass
      and tgname='inventory_location_evidence_lifecycle_v2' and tgenabled='O')
    and position('America/Chicago' in pg_get_functiondef('private.inventory_location_evidence_expiry_v2(timestamptz)'::regprocedure))>0
    and position('p_initial_photo_match_qty-greatest(0,p_baseline_on_hand-p_current_on_hand)' in
      replace(pg_get_functiondef('private.inventory_location_evidence_qty_v2(numeric,numeric,numeric)'::regprocedure),' ',''))>0
    and position('current_photo_match_qty' in pg_get_functiondef('private.apply_inventory_location_evidence_v1()'::regprocedure))>0
    and position('current_photo_match_qty' in pg_get_functiondef('public.reconcile_inventory_location_evidence_v1()'::regprocedure))>0
    and has_function_privilege('service_role','public.reconcile_inventory_location_evidence_v1()','execute')
    and not has_function_privilege('authenticated','public.reconcile_inventory_location_evidence_v1()','execute')
    as installed`;
  if (name === requestSalesImpactMigrationName) return `select
    to_regprocedure('public.get_request_sales_impact_v1()') is not null
    and position('ph_request_history' in pg_get_functiondef('public.get_request_sales_impact_v1()'::regprocedure))>0
    and position('ph_request_delivery_outbox' in pg_get_functiondef('public.get_request_sales_impact_v1()'::regprocedure))>0
    and position('coalesce(d.raw_qty,25::numeric)' in replace(pg_get_functiondef('public.get_request_sales_impact_v1()'::regprocedure),' ',''))>0
    and position('request_key_norm,dedupe_item_key,location_key,lot_key' in replace(pg_get_functiondef('public.get_request_sales_impact_v1()'::regprocedure),' ',''))>0
    and has_function_privilege('service_role','public.get_request_sales_impact_v1()','execute')
    and not has_function_privilege('authenticated','public.get_request_sales_impact_v1()','execute')
    as installed`;
  if (name === requestSalesImpactV2MigrationName) return `select
    exists(select 1 from pg_proc where oid=to_regprocedure('public.get_request_sales_impact_v2()')
      and prosecdef and proconfig @> array['search_path=""','statement_timeout=60s'])
    and position('jsonb_array_elements' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('regexp_matches' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('line_identity_key' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('catalog_by_size' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('source_table_audit' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and has_function_privilege('service_role','public.get_request_sales_impact_v2()','execute')
    and not has_function_privilege('authenticated','public.get_request_sales_impact_v2()','execute')
    and not has_function_privilege('anon','public.get_request_sales_impact_v2()','execute')
    as installed`;
  if (name === requestSalesImpactStrictDedupeMigrationName) return `select
    exists(select 1 from pg_proc where oid=to_regprocedure('public.get_request_sales_impact_v2()')
      and prosecdef and proconfig @> array['search_path=""','statement_timeout=60s'])
    and position('strict_9_field_cross_table_v1' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('strict_business_key' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('source_copy_ordinal' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('outbox_event_types' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('previous_v2_merge_audit' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and has_function_privilege('service_role','public.get_request_sales_impact_v2()','execute')
    and not has_function_privilege('authenticated','public.get_request_sales_impact_v2()','execute')
    and not has_function_privilege('anon','public.get_request_sales_impact_v2()','execute')
    as installed`;
  if (name === requestQueuePendingReconciliationMigrationName) return `select
    to_regclass('public.ph_request_delivery_outbox_request_completed_recent_idx') is not null
    and to_regclass('private.ph_request_queue_removal_commands_request_uid_idx') is not null
    and position('limit 100' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))=0
    and position('request_completed' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
    and position('ph_request_queue_removal_commands' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
    and position('request_lifecycle_tombstones_v1' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
    and position('jsonb_array_elements' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
    and position('regexp_matches' in lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
    and exists(select 1 from pg_proc where oid='private.reconcile_active_requests_from_outbox_v1()'::regprocedure
      and prosecdef and proconfig @> array['search_path=""','statement_timeout=30s'])
    and has_function_privilege('service_role','public.reconcile_active_requests_from_outbox_v1()','execute')
    and not has_function_privilege('authenticated','public.reconcile_active_requests_from_outbox_v1()','execute')
    and exists(select 1 from pg_trigger where tgrelid='public.ph_active_request'::regclass
      and tgname='app_dataset_revision_deleted' and tgenabled='O')
    as installed`;
  if (name === requestQueueLegacyOutboxReconciliationMigrationName) return `select
    exists(select 1 from pg_proc where oid='private.reconcile_legacy_pending_requests_from_outbox_v4()'::regprocedure
      and prosecdef and proconfig @> array['search_path=""','statement_timeout=30s'])
    and position('legacy-explicit-removal' in lower(pg_get_functiondef('private.reconcile_legacy_pending_requests_from_outbox_v4()'::regprocedure)))>0
    and position('outbox_recovery' in lower(pg_get_functiondef('private.reconcile_legacy_pending_requests_from_outbox_v4()'::regprocedure)))>0
    and position('customeridentityid' in lower(pg_get_functiondef('private.reconcile_legacy_pending_requests_from_outbox_v4()'::regprocedure)))=0
    and position('request_completed' in lower(pg_get_functiondef('private.reconcile_legacy_pending_requests_from_outbox_v4()'::regprocedure)))>0
    and position('ph_request_queue_removal_commands' in lower(pg_get_functiondef('private.reconcile_legacy_pending_requests_from_outbox_v4()'::regprocedure)))>0
    and position('reconcile_legacy_pending_requests_from_outbox_v4' in lower(pg_get_functiondef('public.reconcile_active_requests_from_outbox_v1()'::regprocedure)))>0
    and has_function_privilege('service_role','public.reconcile_active_requests_from_outbox_v1()','execute')
    and not has_function_privilege('authenticated','public.reconcile_active_requests_from_outbox_v1()','execute')
    as installed`;
  if (name === escapedDisplayTextNormalizationMigrationName) return `select
    exists(select 1 from pg_proc where oid='private.normalize_escaped_display_text_v1(text)'::regprocedure
      and provolatile='i' and proisstrict and proparallel='s' and proconfig @> array['search_path=""'])
    and private.normalize_escaped_display_text_v1($input$Alexander\\'s$input$)=$output$Alexander's$output$
    and not has_function_privilege('service_role','private.normalize_escaped_display_text_v1(text)','execute')
    and (select count(*) from pg_trigger where tgname='a000_normalize_escaped_display_text_v1' and tgenabled='O'
      and tgrelid=any(array['public.ph_master_inventory'::regclass,'public.ph_active_request'::regclass,
        'public.ph_request_history'::regclass,'public.ph_soc_master'::regclass,'public.ph_reserves'::regclass,
        'public.ph_cav_import'::regclass]))=6
    and not exists(select 1 from public.ph_master_inventory where commonname ~ $regex$\\\\+(['"])$regex$)
    and not exists(select 1 from public.ph_active_request where commonname ~ $regex$\\\\+(['"])$regex$)
    and not exists(select 1 from public.ph_request_history where commonname ~ $regex$\\\\+(['"])$regex$)
    as installed`;
  if (name === requestLifecycleStateMachineMigrationName) return `select
    (select count(*) from information_schema.columns where table_schema='public' and table_name='ph_request_history'
      and column_name in ('effective_qty','listprice','line_dollar_value','photo_date','loc_match_pct','loc_photo_match','pick_note','comments'))=8
    and to_regprocedure('private.request_master_has_valid_evidence_v1(public.ph_master_inventory,timestamp with time zone)') is not null
    and to_regprocedure('private.persist_completed_request_history_v1(text,text,text,boolean)') is not null
    and position('completed_history' in pg_get_functiondef('public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure))>0
    and position('request_master_has_valid_evidence_v1' in pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure))>0
    and position('enforce_request_lifecycle_v1' in pg_get_functiondef('public.reconcile_active_requests_from_outbox_v1()'::regprocedure))>0
    and has_function_privilege('service_role','public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)','execute')
    and not has_function_privilege('authenticated','public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)','execute')
    and not exists(select 1 from public.ph_active_request active
      where active.move_batch_id is null and (lower(btrim(coalesce(active.req_status,'')))<>'pending'
        or coalesce(active.req_archived,false) or nullif(btrim(coalesce(active.date_completed,'')),'') is not null))
    and not exists(select 1 from public.ph_master_inventory where commonname ~ $regex$\\\\+(['"])$regex$)
    and not exists(select 1 from public.ph_active_request where commonname ~ $regex$\\\\+(['"])$regex$)
    and not exists(select 1 from public.ph_request_history where commonname ~ $regex$\\\\+(['"])$regex$)
    as installed`;
  if (name === unifiedRequestSyncSalesImpactMigrationName) return `select
    to_regclass('public.ph_request_sales_impact_ledger') is not null
    and to_regclass('public."00_app_view_table_map"') is not null
    and has_table_privilege('authenticated','public.ph_master_inventory','select')
    and position('zero_cross_request_dedupe_v1' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and position('all-history-four-proof' in pg_get_functiondef('public.reconcile_active_requests_from_outbox_v1()'::regprocedure))>0
    and position('candidate.master_row.' in pg_get_functiondef('public.append_request_options_v1(uuid,text,text,text[])'::regprocedure))=0
    and position('master.pick' in pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure))=0
    and (select count(*) from pg_trigger where tgrelid='public.ph_request_history'::regclass
      and tgname in ('ph_request_history_block_delete_v2360','ph_request_history_block_truncate_v2360') and tgenabled='O')=2
    and exists(select 1 from private.navigation_view_catalog where view_key='request-sales-impact')
    and not exists(select 1 from public.ph_request_sales_impact_ledger group by unique_id having count(*)>1)
    as installed`;
  if (name === agdataV2361SurgicalRestoreMigrationName) return `select
    not exists(select 1 from information_schema.tables where table_schema='archive_backup' and table_type='BASE TABLE')
    and position('recent-outbox-cutoff-v2361' in pg_get_functiondef('public.reconcile_active_requests_from_outbox_v1()'::regprocedure))>0
    and position('source-row-line-identity-v2361' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and to_regclass('private.ph_active_request_retirement_v2361') is not null
    and to_regclass('private.ph_reclass_recount_merge_audit_v2361') is not null
    and to_regclass('public.ph_reclass_recount_jobs_pending_item_location_v2361_idx') is not null
    and not exists(select 1 from public.ph_active_request where move_batch_id is null
      and created_at<timestamptz '2026-10-22 00:00:00 America/Chicago')
    and not exists(select 1 from public.ph_reclass_recount_jobs where status='pending'
      group by upper(btrim(itemcode)),upper(btrim(locationcode)) having count(*)>1)
    and (select count(*) from public.ph_request_sales_impact_ledger)>=8982
    and (select coalesce(sum(line_dollar_value),0) from public.ph_request_sales_impact_ledger)>=10000000
    and not exists(select 1 from public.ph_request_sales_impact_ledger
      group by source_table,source_row_id,row_index having count(*)>1)
    as installed`;
  if (name === agdataV2362CanonicalRequestsMigrationName) return `select
    to_regclass('public.ph_master_inventory') is not null
    and to_regclass('public.ph_requests_pending') is not null
    and to_regclass('public.ph_requests_completed_history') is not null
    and (select data_type='jsonb' from information_schema.columns where table_schema='public'
      and table_name='ph_requests_pending' and column_name='recipient_emails')
    and (select data_type='jsonb' from information_schema.columns where table_schema='public'
      and table_name='ph_requests_completed_history' and column_name='recipient_emails')
    and position('canonical-three-table-v2362' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and not exists(select 1 from public.ph_requests_pending where move_batch_id is null
      and created_at<timestamptz '2026-10-22 00:00:00 America/Chicago')
    and not exists(select 1 from public.ph_requests_pending pending
      join public.ph_requests_completed_history history using(unique_id)
      where pending.move_batch_id is null)
    and (select count(*) from public.ph_requests_completed_history)>=4059
    and (select coalesce(sum(line_dollar_value),0) from public.ph_requests_completed_history)>=6067786.53
    and not exists(select 1 from information_schema.tables
      where table_schema='archive_backup' and table_type='BASE TABLE')
    as installed`;
  if (name === agdataV2362LegacyCleanupMigrationName) return `select
    to_regclass('public.ph_master_inventory') is not null
    and to_regclass('public.ph_requests_pending') is not null
    and to_regclass('public.ph_requests_completed_history') is not null
    and to_regclass('public.ph_active_request') is null
    and to_regclass('public.ph_active_request_live_rows') is null
    and to_regclass('public.ph_request_queue_live_rows') is null
    and to_regclass('public.ph_request_history') is null
    and to_regclass('public.ph_request_sales_impact_ledger') is null
    and to_regclass('private.request_financial_values_v1') is null
    and to_regclass('private.folder_delivery') is null
    and to_regclass('private.ph_request_folder_delivery_state') is not null
    and not exists(select 1 from public."00_app_view_table_map" mapping
      cross join unnest(mapping.source_tables) source_table
      where source_table in ('public.ph_active_request','public.ph_active_request_live_rows',
        'public.ph_request_queue_live_rows','public.ph_request_history',
        'public.ph_request_sales_impact_ledger','public.ph_request_sales_impact_lines_v1'))
    and not exists(select 1 from pg_proc procedure_row join pg_namespace namespace_row
      on namespace_row.oid=procedure_row.pronamespace
      where namespace_row.nspname in ('public','private','app_sync_private')
        and procedure_row.prosrc ~ 'ph_(active_request|active_request_live_rows|request_queue_live_rows|request_history|request_sales_impact_ledger)')
    as installed`;
  if (name === agdataV2363UniformActiveHistoryMigrationName) return `select
    to_regclass('public.ph_00_table_directory') is not null
    and to_regclass('public.ph_active_request') is not null
    and to_regclass('public.ph_request_history') is not null
    and to_regclass('public.ph_active_location_moves') is not null
    and to_regclass('public.ph_location_moves_history') is not null
    and to_regclass('public.ph_active_recount') is not null
    and to_regclass('public.ph_eval_work_history') is not null
    and to_regclass('public.ph_delivery_outbox') is not null
    and (select count(*) from public.ph_00_table_directory)=21
    and not exists(select 1 from public.ph_requests_pending
      where unique_id like 'move_req_%' or unique_id like 'EVAL-%')
    and not exists(select 1 from public.ph_requests_completed_history
      where unique_id like 'move_req_%' or unique_id like 'EVAL-%')
    and (select count(*) from public.ph_location_moves_history)>=4
    and (select count(*) from public.ph_eval_work_history)>=7
    and (select count(*) from public.ph_request_history)>=4042
    and coalesce((public.get_request_sales_impact_v2()->'summary'->>'completed_dollar_value')::numeric,0)>=6067786.53
    and not exists(select 1 from public.ph_active_recount
      group by upper(btrim(itemcode)),upper(btrim(locationcode)) having count(*)>1)
    and not exists(select 1 from public.ph_active_recount
      where nullif(btrim(commonname),'') is null or lower(btrim(commonname))='unknown')
    and position('canonical-active-history-v2363' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    as installed`;
  if (name === agdataV2364RequestBrowserCompatibilityMigrationName) return `select
    to_regclass('public.ph_active_request') is not null
    and to_regclass('public.ph_active_request_live_rows') is not null
    and to_regclass('public.ph_request_queue_live_rows') is not null
    and has_function_privilege('anon','public.guard_active_app_session_v1()','execute')
    and (select count(*) from information_schema.columns
      where table_schema='public' and table_name='ph_requests_pending'
        and column_name in ('customer','consignee','qty','measure_spec','comments'))=5
    and (select count(*) from public.ph_active_request)>=6
    and not exists(select 1 from public.ph_requests_pending where date_completed is not null)
    and position('least(' in pg_get_functiondef('private.inventory_location_evidence_qty_v2(numeric,numeric,numeric)'::regprocedure))>0
    as installed`;
  if (name === agdataV2364LocationEvidenceRepairCompatibilityMigrationName) return `select
    position('evidence_changed' in pg_get_functiondef(
      'private.sync_master_inventory_canonical_v2362()'::regprocedure))>0
    and position('location_evidence_updated_at' in pg_get_functiondef(
      'public.get_request_drive_evidence_health_snapshot_v1()'::regprocedure))>0
    as installed`;
  if (name === agdataV2365AnonSecurityHardeningMigrationName) return `select
    not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','v','m','f')
        and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
          or has_table_privilege('anon',c.oid,'DELETE') or has_table_privilege('anon',c.oid,'TRUNCATE')
          or has_any_column_privilege('anon',c.oid,'INSERT') or has_any_column_privilege('anon',c.oid,'UPDATE')))
    and not exists(select 1 from pg_policies where schemaname='public' and permissive='PERMISSIVE'
      and cmd in ('ALL','INSERT','UPDATE','DELETE') and roles && array['anon'::name,'public'::name])
    and not exists(with sensitive(name) as (values ('ph_app_users'),('profiles'),('user_access_control'),
      ('user_access_control_audit'),('user_access_control_commands'),('user_access_control_state'),
      ('role_access_baselines'),('ph_request_delivery_outbox'),('ph_delivery_outbox'),
      ('ph_request_delivery_status'),('ph_request_delivery_worker_state'),('ph_request_email_threads'),
      ('hr_calendar_reminder_outbox'),('hr_events'),('hr_job_codes'),('labor_timesheets'),
      ('core_employees'),('ph_labor_hours'),('ph_push_subscriptions'),('ph_requests_pending'),
      ('ph_active_request'),('ph_active_request_live_rows'),('ph_request_queue_live_rows'),
      ('ph_requests_completed_history'),('ph_request_history'))
      select 1 from sensitive where to_regclass('public.'||name) is not null
        and has_table_privilege('anon',to_regclass('public.'||name),'SELECT'))
    and not exists(with sensitive(name) as (values ('ph_app_users'),('profiles'),('user_access_control'),
      ('user_access_control_audit'),('user_access_control_commands'),('user_access_control_state'),
      ('role_access_baselines'),('ph_request_delivery_outbox'),('ph_delivery_outbox'),
      ('ph_request_delivery_status'),('ph_request_delivery_worker_state'),('ph_request_email_threads'),
      ('hr_calendar_reminder_outbox'),('hr_events'),('hr_job_codes'),('labor_timesheets'),
      ('core_employees'),('ph_labor_hours'),('ph_push_subscriptions'),('ph_requests_pending'),
      ('ph_active_request'),('ph_active_request_live_rows'),('ph_request_queue_live_rows'),
      ('ph_requests_completed_history'),('ph_request_history'))
      select 1 from sensitive join pg_class c on c.oid=to_regclass('public.'||sensitive.name)
      where c.relkind in ('r','p') and not c.relrowsecurity)
    as installed`;
  if (name === agdataV2365SalesImpactUnionFixMigrationName) return `select
    position('select history.*' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))=0
    and position('explicit-completed-history-union-v2365' in
      pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))>0
    and coalesce((public.get_request_sales_impact_v2()->'summary'->>'completed_dollar_value')::numeric,0)>=6067786.53
    and has_function_privilege('service_role','public.get_request_sales_impact_v2()','execute')
    and not has_function_privilege('authenticated','public.get_request_sales_impact_v2()','execute')
    and not has_function_privilege('anon','public.get_request_sales_impact_v2()','execute')
    as installed`;
  if (name === agdataV2366HistoricalArchiveMigrationName) return `select
    (select relkind='r' from pg_class where oid='public.ph_orders_history'::regclass)
    and (select relkind='r' from pg_class where oid='public.ph_reserves_history'::regclass)
    and (select relkind='r' from pg_class where oid='public.ph_drive_mode_history'::regclass)
    and (select relkind='r' from pg_class where oid='public.ph_drive_mode_history_files'::regclass)
    and to_regprocedure('public.historical_archive_read_v1(jsonb)') is not null
    and has_function_privilege('authenticated','public.historical_archive_read_v1(jsonb)','execute')
    and not has_function_privilege('anon','public.historical_archive_read_v1(jsonb)','execute')
    and not has_table_privilege('anon','public.ph_orders_history','select')
    and not has_table_privilege('anon','public.ph_reserves_history','select')
    and not has_table_privilege('anon','public.ph_drive_mode_history','select')
    and not has_table_privilege('anon','public.ph_drive_mode_history_files','select')
    and (select count(*) from public.ph_orders_history)>=20000
    and (select count(*) from public.ph_reserves_history)>=7000
    and (select count(*) from public.ph_drive_mode_history_files)>=1236
    and (select count(*) from public.ph_drive_mode_history)>=20000
    and (select count(*) from pg_trigger where not tgisinternal and tgname in
      ('ph_soc_master_archive_v2366','ph_reserves_archive_v2366','ph_drive_files_archive_v2366','ph_drive_evidence_archive_v2366'))=4
    and (select count(*) from pg_trigger where not tgisinternal and tgrelid='public.ph_requests_completed_history'::regclass
      and tgname in ('ph_requests_completed_history_block_delete_v2366','ph_requests_completed_history_block_truncate_v2366'))=2
    and exists(select 1 from pg_trigger where not tgisinternal
      and tgrelid='public.ph_drive_around_report_files'::regclass and tgname='ph_drive_files_archive_v2366')
    and position('row.file_id=path_2' in pg_get_functiondef('public.historical_archive_read_v1(jsonb)'::regprocedure))>0
    and position('source.itemcode=dimension.itemcode' in pg_get_functiondef('public.historical_archive_read_v1(jsonb)'::regprocedure))>0
    as installed`;
  if (name === agdataV2366FastHistoricalRequestsMigrationName) return `select
    to_regprocedure('private.historical_request_customer_key_v2366(text,text)') is not null
    and to_regprocedure('private.historical_request_consignee_key_v2366(text,text,text)') is not null
    and position('history-fast-v2366' in coalesce(obj_description('public.historical_requests_read_v1(jsonb)'::regprocedure,'pg_proc'),''))>0
    and position('ph_requests_completed_history' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))>0
    and position('ph_master_inventory' in pg_get_functiondef('public.historical_requests_read_v1(jsonb)'::regprocedure))=0
    and has_function_privilege('authenticated','public.historical_requests_read_v1(jsonb)','execute')
    and not has_function_privilege('anon','public.historical_requests_read_v1(jsonb)','execute')
    and exists(select 1 from pg_indexes where schemaname='public' and indexname='ph_requests_completed_history_rep_fast_v2366')
    and exists(select 1 from pg_indexes where schemaname='public' and indexname='ph_requests_completed_history_customer_fast_v2366')
    as installed`;
  if (name === agdataV2366QueueResolutionCleanupMigrationName) return `select
    not exists(select 1 from public.ph_active_recount)
    and not exists(select 1 from public.ph_active_bunch_notes)
    and not exists(select 1 from bunch_note_private.bunch_note_work_cards card
      join bunch_note_private.bunch_notes note on note.id=card.bunch_note_id
      join bunch_note_private.jobs job on job.id=note.job_id
      where card.active and card.status='open' and job.status='open')
    and (select count(*) from public.ph_active_request)=6
    and (select count(*) from public.ph_active_request where unique_id=any(array[
      'REQ-mvk1xgv2ty9fttuqj2','REQ-mvlbp5hkkk58akaubms','REQ-mvlfib5eqwa3typzcqq',
      'REQ-mvlfib5evawvlvvx09','REQ-mvlg4t85vlzf7053pv','REQ-mvlgbfl7p8r8zxrj97j']))=6
    and exists(select 1 from public.ph_active_suspend
      where commonname='Pink Delight Butterfly Bush' and locationcode='D.26.000')
    and exists(select 1 from public.ph_sales_office
      where unique_id='moves_001360_010_1-_1-J_05_000-26_U2-LD----_C_17_000'
        and lower(btrim(coalesce(order_status,'')))='completed')
    and exists(select 1 from public.ph_recount_history)
    and exists(select 1 from public.ph_bunch_notes_history)
    and not exists(select 1 from public.ph_reclass_recount_jobs job
      join public.ph_request_delivery_outbox outbox on outbox.request_id=job.id::text
      where job.status='completed' and job.completed_by_username='dylan_collyge'
        and job.delivery_event_id is null and outbox.event_type='reclass_recount_completed')
    and to_regprocedure('public.complete_reclass_recount_v1(uuid,uuid,numeric,uuid)') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ph_request_delivery_outbox'::regclass
      and tgname='capture_reclass_recount_outbox_v1' and tgenabled='O')
    as installed`;
  if (name === agdataV2366HistoricalStateDedupMigrationName) return `select
    to_regprocedure('public.deduplicate_drive_around_report_rows_batch_v1(integer)') is not null
    and to_regprocedure('public.historical_archive_read_v2(jsonb)') is not null
    and to_regprocedure('private.compact_history_states_v2366()') is not null
    and to_regclass('private.ph_drive_around_row_states_v2366') is not null
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_orders_history' and column_name='row_state_hash')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_reserves_history' and column_name='seen_count')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_drive_mode_history' and column_name='last_file_id')
    and exists(select 1 from pg_indexes where schemaname='public' and indexname='ph_orders_history_item_state_v2366')
    and exists(select 1 from pg_indexes where schemaname='public' and indexname='ph_reserves_history_item_state_v2366')
    and exists(select 1 from pg_indexes where schemaname='public' and indexname='ph_drive_mode_history_item_state_v2366')
    and position('America/Chicago' in pg_get_functiondef('public.deduplicate_drive_around_report_rows_batch_v1(integer)'::regprocedure))>0
    and position('23:30' in pg_get_functiondef('public.deduplicate_drive_around_report_rows_batch_v1(integer)'::regprocedure))>0
    and exists(select 1 from pg_proc where oid='public.deduplicate_drive_around_report_rows_batch_v1(integer)'::regprocedure
      and proconfig @> array['statement_timeout=4500ms'])
    and has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute')
    and not has_function_privilege('anon','public.historical_archive_read_v2(jsonb)','execute')
    and not has_function_privilege('authenticated','public.deduplicate_drive_around_report_rows_batch_v1(integer)','execute')
    as installed`;
  if (name === agdataV2366InventoryConsolidationMigrationName) return `select
    to_regprocedure('public.inventory_consolidation_suggestions_v1(jsonb)') is not null
    and to_regprocedure('public.create_location_work_job_v1(jsonb)') is not null
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_location_work_lines' and column_name='destination_salesyear')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_location_work_lines' and column_name='work_source')
    and ((position('source.loc_on_hand>0' in pg_get_functiondef('public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure))>0
      and position('source.loc_on_hand<100' in pg_get_functiondef('public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure))>0)
      or (to_regprocedure('private.refresh_inventory_consolidation_cache_v2366()') is not null
        and position('source.loc_on_hand>0' in pg_get_functiondef('private.refresh_inventory_consolidation_cache_v2366()'::regprocedure))>0
        and position('source.loc_on_hand<100' in pg_get_functiondef('private.refresh_inventory_consolidation_cache_v2366()'::regprocedure))>0))
    and position('inventoryConsolidation' in pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))>0
    and position('public.ph_location_work_jobs' in pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))>0
    and position('public.ph_requests_pending' in pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))=0
    and has_function_privilege('authenticated','public.inventory_consolidation_suggestions_v1(jsonb)','execute')
    and not has_function_privilege('anon','public.inventory_consolidation_suggestions_v1(jsonb)','execute')
    and has_function_privilege('service_role','public.create_location_work_job_v1(jsonb)','execute')
    and not has_function_privilege('authenticated','public.create_location_work_job_v1(jsonb)','execute')
    as installed`;
  if (name === agdataV2366InventoryConsolidationSalesYearFixMigrationName) return `select
    position('inventory_consolidation_sales_year_v2366' in
      pg_get_functiondef('public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure))>0
    and position('season_sales_settings_v1' in
      pg_get_functiondef('public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure))>0
    and position('inventory_consolidation_sales_year_v2366(private.season_sales_settings_v1()->>''salesYear'',null)'
      in pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))>0
    and has_function_privilege('authenticated','public.inventory_consolidation_suggestions_v1(jsonb)','execute')
    and has_function_privilege('service_role','public.create_location_work_job_v1(jsonb)','execute')
    as installed`;
  if (name === agdataV2366InventoryConsolidationCacheMigrationName) return `select
    to_regclass('private.inventory_consolidation_cache_v2366') is not null
    and to_regprocedure('private.refresh_inventory_consolidation_cache_v2366()') is not null
    and position('source.loc_on_hand>0' in pg_get_functiondef('private.refresh_inventory_consolidation_cache_v2366()'::regprocedure))>0
    and position('source.loc_on_hand<100' in pg_get_functiondef('private.refresh_inventory_consolidation_cache_v2366()'::regprocedure))>0
    and position('candidate.sales_year=source.sales_year' in pg_get_functiondef('private.refresh_inventory_consolidation_cache_v2366()'::regprocedure))>0
    and exists(select 1 from pg_proc where oid='public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure
      and proconfig @> array['statement_timeout=500ms'])
    and position('inventory_consolidation_cache_v2366' in pg_get_functiondef('public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure))>0
    and not has_function_privilege('authenticated','private.refresh_inventory_consolidation_cache_v2366()','execute')
    and has_function_privilege('authenticated','public.inventory_consolidation_suggestions_v1(jsonb)','execute')
    as installed`;
  if (name === agdataV2366HistoricalArchivePageDedupMigrationName) return `select
    position('state-dedup-v2366' in pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))>0
    and position('record_kind in (''orders'',''reserves'')' in pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))>0
    and position('item.record-''id''' in pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))>0
    and has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute')
    and not has_function_privilege('anon','public.historical_archive_read_v2(jsonb)','execute')
    as installed`;
  if (name === agdataV2366DriveArchiveSearchHashFixMigrationName) return `select
    position('drive-search-row-alias-v2366' in pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))>0
    and position('drive_around_report_state_hash_v2366(raw_row)' in pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))>0
    and has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute')
    and not has_function_privilege('anon','public.historical_archive_read_v2(jsonb)','execute')
    as installed`;
  if (name === agdataV2367CropTierAuraGlossaryMigrationName) return `select
    to_regprocedure('public.get_consolidation_move_candidates_v1()') is not null
    and to_regprocedure('public.aura_inventory_crop_tier_v1(text,text,integer)') is not null
    and position('destination_profile.max_sales_year<settings.current_sales_year' in
      pg_get_functiondef('public.get_consolidation_move_candidates_v1()'::regprocedure))>0
    and position('destination_profile.min_sales_year=settings.current_sales_year' in
      pg_get_functiondef('public.get_consolidation_move_candidates_v1()'::regprocedure))>0
    and position('candidate.sales_year=source.sales_year' in
      pg_get_functiondef('public.get_consolidation_move_candidates_v1()'::regprocedure))>0
    and position('get_consolidation_move_candidates_v1() candidate' in
      pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))>0
    and position('source_sales_year>current_sales_year' in
      pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))=0
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='aura_domain_glossary' and column_name='definition')
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='aura_domain_glossary' and column_name='synonyms' and data_type='ARRAY')
    and (select count(*) from public.aura_domain_glossary where term=any(array[
      'carry over','current crop','future crop','inv consolidation','loc photo match','request sales impact',
      'mistake guy','historical orders','historical reserves','historical drive around','location moves',
      'suspend tag','recount','bunch notes','eval work','shear list']))=16
    and not exists(select 1 from private.inventory_consolidation_cache_v2366 cache
      cross join lateral jsonb_array_elements(cache.destinations) destination
      where (cache.crop_tier='CARRY_OVER' and (destination->>'salesYear')::integer>=cache.current_sales_year)
        or (cache.crop_tier='CURRENT_CROP' and (destination->>'salesYear')::integer<>cache.current_sales_year)
        or (cache.crop_tier='FUTURE_CROP' and (destination->>'salesYear')::integer<>cache.source_sales_year))
    and not exists(select 1 from private.inventory_consolidation_cache_v2366 cache
      cross join lateral jsonb_array_elements(cache.destinations) destination
      where cache.itemcode='006138.021.1' and cache.source_locationcode='G.15.000'
        and cache.source_sales_year=2025 and destination->>'locationcode'='E.22.000'
        and (destination->>'salesYear')::integer=2027)
    and exists(select 1 from private.inventory_consolidation_cache_v2366 cache
      cross join lateral jsonb_array_elements(cache.destinations) destination
      where cache.itemcode='008404.010.1' and cache.source_locationcode='C.11.034'
        and cache.source_sales_year=2026 and cache.crop_tier='CARRY_OVER'
        and destination->>'locationcode'='C.11.054' and (destination->>'salesYear')::integer=2026)
    and has_function_privilege('authenticated','public.aura_inventory_crop_tier_v1(text,text,integer)','execute')
    and not has_function_privilege('anon','public.aura_inventory_crop_tier_v1(text,text,integer)','execute')
    and has_function_privilege('authenticated','public.inventory_consolidation_suggestions_v1(jsonb)','execute')
    and has_function_privilege('service_role','public.create_location_work_job_v1(jsonb)','execute')
    as installed`;
  if (name === agdataV2367HistoricalDriveFastReadMigrationName) return `select
    to_regprocedure('private.historical_drive_file_page_v2367(text,integer,integer)') is not null
    and position('historical_drive_file_page_v2367(path_value->>2' in
      pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))>0
    and not has_function_privilege('authenticated','private.historical_drive_file_page_v2367(text,integer,integer)','execute')
    and has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute')
    and not has_function_privilege('anon','public.historical_archive_read_v2(jsonb)','execute')
    as installed`;
  if (name === agdataV2368RequestPhotoAvNavigationMigrationName) return `select
    to_regprocedure('public.safe_parse_timestamptz(text,timestamp with time zone)') is not null
    and to_regprocedure('public.verify_request_batch_submission_v2368(uuid,jsonb)') is not null
    and to_regprocedure('public.sanitize_av_note_without_spec_caliper(text)') is not null
    and to_regprocedure('public.get_itemcode_av_note_options_v1(text,text)') is not null
    and to_regprocedure('public.historical_requests_read_v2368(jsonb)') is not null
    and to_regprocedure('public.historical_archive_read_v2368(jsonb)') is not null
    and public.sanitize_av_note_without_spec_caliper('HEAVY BUD / SPEC - 3.5-4''H')='HEAVY BUD'
    and public.sanitize_av_note_without_spec_caliper('SPEC - 16-18" HXW') is null
    and position('to_char(photo_at at time zone' in lower(pg_get_functiondef(
      'private.persist_completed_request_history_v1(text,text,text,boolean)'::regprocedure)))>0
    and position('request_created_by_email' in pg_get_functiondef('private.stamp_request_batch_creator(jsonb)'::regprocedure))>0
    and has_function_privilege('authenticated','public.verify_request_batch_submission_v2368(uuid,jsonb)','execute')
    and not has_function_privilege('anon','public.verify_request_batch_submission_v2368(uuid,jsonb)','execute')
    and has_function_privilege('service_role','public.get_itemcode_av_note_options_v1(text,text)','execute')
    and not has_function_privilege('authenticated','public.get_itemcode_av_note_options_v1(text,text)','execute')
    and has_function_privilege('authenticated','public.historical_requests_read_v2368(jsonb)','execute')
    and has_function_privilege('authenticated','public.historical_archive_read_v2368(jsonb)','execute')
    and exists(select 1 from private.navigation_view_catalog where view_key='eval_reports_2' and selectable)
    and not exists(select 1 from private.navigation_view_catalog where selectable is distinct from true)
    and (select count(*) from information_schema.columns where table_schema='public'
      and table_name in ('ph_sales_office','ph_flyer_folder_rows','ph_flyer_folder_history','ph_dock_issue_status')
      and column_name='photo_date')=4
    as installed`;
  if (name === agdataV2368MasterPhotoDatePreservationMigrationName) return `select
    position('concat_ws(' in pg_get_functiondef(
      'private.sync_master_inventory_canonical_v2362()'::regprocedure))>0
    and not exists(select 1 from public.ph_master_inventory row
      where row.photo_date is null
        and nullif(btrim(concat_ws(',',row.photo_link,row.dock_photo_link,row.flyer_photo_link)),'') is not null)
    as installed`;
  if (name === agdataV2368AvNoteSanitizerMigrationName) return `select
    public.sanitize_av_note_without_spec_caliper('16-18" HxW') is null
    and public.sanitize_av_note_without_spec_caliper('20" H X 30" W') is null
    and public.sanitize_av_note_without_spec_caliper('14-16" H - 18-20" W') is null
    and public.sanitize_av_note_without_spec_caliper('24" T GOOD BRANCHING')='GOOD BRANCHING'
    and not exists(
      select 1 from public.get_itemcode_av_note_options_v1('008866.031.1','Alice ''N Wonderland Dwarf Oakleaf Hydrangea') option_row
      where option_row.note ~* '(^|[^a-z])(spec|caliper|cal)([^a-z]|$)'
        or option_row.note ~* '^[[:space:]]*[0-9]+([.][0-9]+)?([[:space:]]*-[[:space:]]*[0-9]+([.][0-9]+)?)?[[:space:]]*[''"]?[[:space:]]*(h[[:space:]]*x[[:space:]]*w|height|high|h|width|wide|w|tall|t)([[:space:]]|$)'
    ) as installed`;
  if (name === agdataV2368HistoricalPhotoDateKeyFixMigrationName) return `select
    position('history.source_unique_id' in pg_get_functiondef(
      'private.historical_photo_date_for_record_v2368(text,jsonb)'::regprocedure))>0
    and position('history.history_key' in pg_get_functiondef(
      'private.historical_photo_date_for_record_v2368(text,jsonb)'::regprocedure))>0
    and not has_function_privilege('authenticated',
      'private.historical_photo_date_for_record_v2368(text,jsonb)','execute')
    as installed`;
  if (name === agdataV2369FastLiveErpIngestionMigrationName) return `select
    to_regprocedure('public.check_erp_file_sync_needed_v1(text,text,text,text,text)') is not null
    and to_regprocedure('public.fast_ingest_drive_around_v1(jsonb,jsonb)') is not null
    and to_regprocedure('public.fast_ingest_soc_orders_v1(jsonb,jsonb)') is not null
    and to_regprocedure('public.fast_ingest_soc_reserves_v1(jsonb,jsonb)') is not null
    and to_regprocedure('public.fast_ingest_cav_v1(jsonb,jsonb)') is not null
    and to_regprocedure('public.fast_ingest_warehouse_assigned_v1(jsonb,jsonb)') is not null
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='app_dataset_revisions' and column_name='source_modified_at')
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='app_dataset_revisions' and column_name='source_content_hash')
    and has_function_privilege('service_role','public.check_erp_file_sync_needed_v1(text,text,text,text,text)','execute')
    and not has_function_privilege('authenticated','public.check_erp_file_sync_needed_v1(text,text,text,text,text)','execute')
    and has_function_privilege('service_role','public.fast_ingest_drive_around_v1(jsonb,jsonb)','execute')
    and not has_function_privilege('authenticated','public.fast_ingest_drive_around_v1(jsonb,jsonb)','execute')
    as installed`;
  if (name === agdataV2369EmergencyRecoveryMigrationName) return `select
    has_table_privilege('anon','public.ph_master_inventory','select')
    and has_table_privilege('authenticated','public.ph_customer_consignee_sales_reps','select')
    and not has_table_privilege('anon','public.ph_app_users','select')
    and not has_table_privilege('anon','public.user_access_control','select')
    and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='ph_active_request'
        and coalesce(c.reloptions,'{}'::text[])@>array['security_invoker=true'])
    and position('old.photo_url is distinct from new.photo_url' in lower(pg_get_triggerdef(
      (select oid from pg_trigger where tgrelid='public.ph_master_inventory'::regclass
        and tgname='ph_drive_evidence_archive_v2366' and not tgisinternal))))>0
    and position('safe_parse_timestamptz' in lower(pg_get_functiondef(
      'private.persist_completed_request_history_v1(text,text,text,boolean)'::regprocedure)))>0
    as installed`;
  if (name === agdataV2369PrivateDeliveryBoundaryMigrationName) return `select
    not has_table_privilege('anon','public.ph_request_delivery_outbox','select')
    and not has_table_privilege('authenticated','public.ph_request_delivery_outbox','select')
    and not has_any_column_privilege('anon','public.ph_requests_completed_history','update')
    and not has_table_privilege('authenticated','public.ph_request_email_threads','update')
    and not has_table_privilege('anon','public.ph_delivery_outbox','select')
    and not has_table_privilege('authenticated','public.ph_request_delivery_status','select')
    and has_table_privilege('service_role','public.ph_request_delivery_outbox','select')
    and has_table_privilege('service_role','public.ph_request_delivery_worker_state','update')
    and not has_function_privilege('anon','public.claim_request_delivery_events(integer,text)','execute')
    and not has_function_privilege('authenticated','public.get_request_delivery_recovery_queue()','execute')
    and has_function_privilege('service_role','public.claim_request_delivery_events(integer,text)','execute')
    and not exists(select 1 from pg_policies where schemaname='public'
      and tablename=any(array['ph_request_delivery_outbox','ph_request_delivery_worker_state',
        'ph_request_email_threads','ph_requests_completed_history'])
      and roles && array['public'::name,'anon'::name,'authenticated'::name])
    as installed`;
  if (name === agdataV2370WatchdogRequestRecoveryMigrationName) return `select
    exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='ph_master_inventory' and column_name='pick')
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='ph_requests_pending' and column_name='submitted_by')
    and position('pick_note=coalesce' in replace(pg_get_functiondef(
      'public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure),' ',''))>0
    and exists(select 1 from pg_proc where oid=
      'public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)'::regprocedure
      and proconfig@>array['lock_timeout=15s','statement_timeout=30s'])
    and has_function_privilege('service_role',
      'public.inventory_consolidation_suggestions_v2370(uuid,jsonb)','execute')
    and not has_function_privilege('authenticated',
      'public.inventory_consolidation_suggestions_v2370(uuid,jsonb)','execute')
    and not exists(select 1 from public.app_runtime_watchdog_events
      where status is distinct from 'resolved')
    as installed`;
  if (name === agdataV2371RequestSuspendEmailLockCleanupMigrationName) return `select
    has_table_privilege('service_role','public.ph_master_inventory','insert,update,delete')
    and has_table_privilege('service_role','public.ph_request_delivery_outbox','insert,update,delete')
    and not has_table_privilege('anon','public.ph_master_inventory','insert,update,delete')
    and not has_table_privilege('anon','public.ph_request_delivery_outbox','insert,update,delete')
    and has_function_privilege('service_role','public.claim_request_delivery_events(integer,text)','execute')
    and not has_function_privilege('anon','public.claim_request_delivery_events(integer,text)','execute')
    and position('source_identity->>''ptronhand''isdistinctfrom' in replace(pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure),' ',''))=0
    and not exists(select 1 from public.ph_active_request where date_completed is not null
      or lower(btrim(coalesce(req_status,''))) not in ('','pending','open'))
    and (select value->>'app_version' from public.ph_app_settings where key='app_version')='2.3.71'
    as installed`;
  if (name === agdataV2372RequestCompletionAcknowledgmentMigrationName) return `select
    position('from public.ph_requests_pending where unique_id=p_request_id for update;' in pg_get_functiondef(
      'private.persist_completed_request_history_v1(text,text,text,boolean)'::regprocedure))>0
    and position('select * into request_row from public.ph_requests_pending where unique_id=request_id for update;' in pg_get_functiondef(
      'public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure))>0
    and has_function_privilege('service_role','public.request_completion_receipt_v2372(uuid,uuid,text)','execute')
    and not has_function_privilege('authenticated','public.request_completion_receipt_v2372(uuid,uuid,text)','execute')
    and not exists(select 1 from public.ph_requests_pending where unique_id='REQ-mvp9cdc5mc3uk7hltrd')
    and (select value->>'app_version' from public.ph_app_settings where key='app_version')='2.3.72'
    as installed`;
  if (name === agdataV2372RequestCompletionDeliveryMigrationName) return `select
    position('from public.ph_requests_completed_history history' in pg_get_functiondef(
      'private.reconcile_request_folder_completion_v2(text)'::regprocedure))>0
    and position('from public.ph_requests_completed_history history' in pg_get_functiondef(
      'public.prepare_request_folder_completion_v2(uuid,uuid)'::regprocedure))>0
    and exists(select 1 from public.ph_request_delivery_outbox
      where request_folder='Digger Odell Nursery - Digger Odell Nursery - 10/26/26'
        and event_type='request_completed'
        and payload->>'contractVersion'='request-folder-completion-v2')
    as installed`;
  if (name === agdataV2373FastAppsScriptErpImportUnblockMigrationName) return `select
    not exists(select 1 from pg_trigger where tgrelid='public.ph_drive_around_report_rows'::regclass
      and tgname='ph_drive_around_report_state_merge_v2366' and not tgisinternal)
    and exists(select 1 from pg_indexes where schemaname='public' and tablename='ph_drive_around_report_rows'
      and indexname='ph_drive_around_report_rows_file_unique_v2373')
    and position('ph_master_bulk_crop_roll_defer_active_v1' in pg_get_functiondef(
      'public.upsert_v2_crop_roll_drive_row_from_master()'::regprocedure))>0
    and has_table_privilege('service_role','public.ph_master_inventory','insert,update,delete')
    and has_table_privilege('service_role','public.ph_drive_around_report_rows','insert,update,delete')
    and not has_table_privilege('anon','public.ph_master_inventory','insert,update,delete')
    and not has_table_privilege('authenticated','public.ph_master_inventory','insert,update,delete')
    and (select value->>'app_version' from public.ph_app_settings where key='app_version')='2.3.73'
    as installed`;
  if (name === agdataV2373DriveTimeoutRecoveryMigrationName) return `select
    coalesce((select proconfig @> array['statement_timeout=120s']
      from pg_proc where oid='public.fast_ingest_drive_around_v1(jsonb,jsonb)'::regprocedure),false)
    as installed`;
  if (name === agdataV2374UnifiedFastBaselineSuspendReclassEmailMigrationName) return `select
    position('INVENTORY_RECLASS_REVISION_CONFLICT' in pg_get_functiondef(
      'public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure))=0
    and coalesce((select reloptions @> array['security_invoker=true'] from pg_class
      where oid='public.ph_active_suspend'::regclass),false)
    and has_function_privilege('service_role','public.fast_ingest_drive_around_v1(jsonb,jsonb)','execute')
    and not has_function_privilege('anon','public.fast_ingest_drive_around_v1(jsonb,jsonb)','execute')
    and (select value->>'app_version' from public.ph_app_settings where key='app_version') in ('2.3.74','2.3.75','2.3.76','2.3.77')
    as installed`;
  if (name === agdataV2375SuspendCardsFastBatchSyncMigrationName) return `select
    coalesce((select reloptions @> array['security_invoker=true'] from pg_class
      where oid='public.ph_active_suspend'::regclass),false)
    and (select count(*) from public.ph_active_suspend)=(select count(*) from public.ph_soc_master
      where upper(btrim(coalesce(suspend,'')))='SUSPEND'
        and lower(btrim(coalesce(suspend_to,'')))='dc'
        and date_completed is null
        and lower(btrim(coalesce(suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected'))
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_active_suspend' and column_name='is_suspend_tag')
    and (select value->>'app_version' from public.ph_app_settings where key='app_version') in ('2.3.75','2.3.76','2.3.77')
    as installed`;
  if (name === agdataV2376InstantLoginFastSuspendMigrationName) return `select
    coalesce((select reloptions @> array['security_invoker=true'] from pg_class
      where oid='public.ph_active_suspend'::regclass),false)
    and to_regclass('public.ph_master_inventory_suspend_lookup_v2376_idx') is not null
    and to_regclass('public.ph_soc_master_suspend_dc_v2376_idx') is not null
    and has_table_privilege('anon','public.ph_active_suspend','select')
    and has_table_privilege('authenticated','public.ph_master_inventory','select')
    as installed`;
  if (name === agdataV2377SuspendReadContinuityMigrationName) return `select
    (coalesce((select reloptions @> array['security_invoker=true'] from pg_class
      where oid='public.ph_active_suspend'::regclass),false)
      or (coalesce((select reloptions @> array['security_invoker=false'] from pg_class
        where oid='public.ph_active_suspend'::regclass),false)
        and exists(select 1 from supabase_migrations.schema_migrations where version='20261027003000')))
    and has_table_privilege('anon','public.ph_active_suspend','select')
    and (select count(*) from public.ph_active_suspend)=(select count(*) from public.ph_soc_master
      where upper(btrim(coalesce(suspend,'')))='SUSPEND'
        and lower(btrim(coalesce(suspend_to,'')))='dc'
        and date_completed is null
        and lower(btrim(coalesce(suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected'))
    and (select value->>'app_version' from public.ph_app_settings where key='app_version') in ('2.3.77','2.3.78','2.3.79')
    as installed`;
  if (name === agdataV2378FullAuditRemediationMigrationName) return `select
    coalesce((select reloptions @> array['security_invoker=false'] from pg_class
      where oid='public.ph_active_suspend'::regclass),false)
    and coalesce((select reloptions @> array['security_invoker=false'] from pg_class
      where oid='public.ph_active_request'::regclass),false)
    and has_table_privilege('anon','public.ph_requests_completed_history','select')
    and has_table_privilege('authenticated','public.ph_requests_completed_history','select')
    and coalesce((select reloptions @> array['security_invoker=true'] from pg_class
      where oid='public.ph_suspend_history'::regclass),false)
    and has_table_privilege('anon','public.ph_suspend_history','select')
    and has_table_privilege('anon','public.ph_productivity_history','select')
    and (select value->>'app_version' from public.ph_app_settings where key='app_version') in ('2.3.78','2.3.79')
    and not has_table_privilege('anon','public.ph_request_delivery_outbox','select')
    and not has_table_privilege('authenticated','public.ph_request_delivery_outbox','select')
    and not exists(select 1 from public.ph_requests_pending p
      where lower(btrim(coalesce(nullif(p.status,''),p.req_status,''))) in ('complete','completed'))
    and exists(select 1 from pg_trigger where tgrelid='suspend_tag_private.approvals'::regclass
      and tgname='agdata_v2378_suspend_decision_to_order' and not tgisinternal)
    and position('is_false_block_v2378' in pg_get_functiondef(
      'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and position('app_sync_private.data_permission_version(actor)' in pg_get_functiondef(
      'app_sync_private.snapshot(text[])'::regprocedure))>0
    and position('md5(actor_scope::text||permissions::text)' in pg_get_functiondef(
      'app_sync_private.snapshot(text[])'::regprocedure))=0
    and position('app_sync_private.data_permission_version(p_actor_id)' in pg_get_functiondef(
      'public.dataset_revisions_for_actor_v1(uuid,text[])'::regprocedure))>0
    and position('md5(actor_scope::text||permissions::text)' in pg_get_functiondef(
      'public.dataset_revisions_for_actor_v1(uuid,text[])'::regprocedure))=0
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('app_sync_private.data_permission_version(uuid)')
      and position('app_limited_live_overrides' in pg_get_functiondef(p.oid))>0
      and position('state.revision' in pg_get_functiondef(p.oid))>0
      and position('user-access:' in pg_get_functiondef(p.oid))>0)
    as installed`;
  if (name === agdataV2381FastErpStageRpcsMigrationName) return `select
    to_regclass('private.fast_erp_stage_runs_v1') is not null
    and to_regclass('private.fast_erp_stage_rows_v1') is not null
    and to_regprocedure('public.fast_begin_erp_stage_v1(text,jsonb,integer)') is not null
    and to_regprocedure('public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb)') is not null
    and to_regprocedure('public.fast_commit_erp_stage_swap_v1(uuid)') is not null
    and to_regprocedure('public.fast_abort_erp_stage_v1(uuid)') is not null
    and has_function_privilege('service_role','public.fast_begin_erp_stage_v1(text,jsonb,integer)','execute')
    and not has_function_privilege('anon','public.fast_begin_erp_stage_v1(text,jsonb,integer)','execute')
    and not has_function_privilege('authenticated','public.fast_begin_erp_stage_v1(text,jsonb,integer)','execute')
    and position('fast_ingest_drive_around_v1' in pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure))>0
    and position('fast_ingest_soc_orders_v1' in pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure))>0
    and position('fast_ingest_soc_reserves_v1' in pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure))>0
    and position('fast_ingest_cav_v1' in pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure))>0
    and position('WAREHOUSE_ASSIGNMENTS_SEED_ONLY' in pg_get_functiondef('public.fast_ingest_warehouse_assigned_v1(jsonb,jsonb)'::regprocedure))>0
    and position('reconcile_inventory_row_assignments_v1' in pg_get_functiondef('public.reconcile_eval_itemcodes(uuid)'::regprocedure))>0
    and position('sync_new_unassigned_warehouse_itemcodes_v1(p_import_run_id)' in pg_get_functiondef('public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)'::regprocedure))>0
    and position('sync_new_unassigned_warehouse_itemcodes_v1(p_run_id)' in pg_get_functiondef('private.inventory_row_assignment_reconcile_finish_v1(uuid)'::regprocedure))>0
    and position('eval_assignment_unassigned' in pg_get_functiondef('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)'::regprocedure))>0
    and position($archive$coalesce(master.itemcode,''''))),encode(extensions.digest$archive$ in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and position('replace(common_columns' in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and position('ptravailable)::numeric' in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and position('manager_report_safe_numeric_v1(master.ptravailable)' in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and position('manager_report_safe_numeric_v1(master.ptronhand)' in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and position('manager_report_safe_numeric_v1(master.ptrreviewed)' in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and position('manager_report_safe_numeric_v1(master.s_lts)' in pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure))>0
    and exists(select 1 from pg_trigger where tgrelid='public.ph_itemcode_default_owners'::regclass
      and tgname='ph_itemcode_default_owner_warehouse_mirror_v2381' and not tgisinternal)
    and position('new.assignedto' in pg_get_functiondef('private.mirror_itemcode_default_owner_to_warehouse_v1()'::regprocedure))>0
    as installed`;
  if (name === agdataV2382DriveParityReclassAndFastSyncMigrationName) return `select
    exists(select 1 from pg_class where oid='public.ph_active_suspend'::regclass
      and reloptions @> array['security_invoker=true'])
    and position('^0+[.]0+[.]111$' in pg_get_viewdef('public.ph_active_suspend'::regclass))>0
    and position('lower(btrim(coalesce(master.itemcode' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('lower(btrim(coalesce(master.locationcode' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('master.lotcode' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('inventory.s_lts' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('inventory.ptravailable' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('inventory.loc_photo_match' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('sum(coalesce(casewhen(nullif(regexp_replace(coalesce(master.ptronhand' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('private.request_numeric_v2362' in pg_get_viewdef('public.ph_active_suspend'::regclass))=0
    and position('private.' in pg_get_viewdef('public.ph_active_suspend'::regclass))=0
    and position('inventory.priority' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and (position('inventory.holdstopcode' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
      or position('master.holdstopcode' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0)
    and (position('inventory.itemspec' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
      or position('master.itemspec' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0)
    and (position('inventory.photo_url' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
      or position('master.photo_url' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0)
    and has_table_privilege('anon','public.ph_active_suspend','select')
    and has_table_privilege('authenticated','public.ph_active_suspend','select')
    and not has_table_privilege('anon','public.ph_active_suspend','insert,update,delete')
    and not has_table_privilege('authenticated','public.ph_active_suspend','insert,update,delete') as installed`;
  if (name === agdataV2382SuspendViewSchemaCompatMigrationName) return `select
    exists(select 1 from pg_class where oid='public.ph_active_suspend'::regclass and reloptions @> array['security_invoker=true'])
    and exists(select 1 from pg_class where oid='public.ph_soc_suspend_tag_rows'::regclass and reloptions @> array['security_invoker=true'])
    and position('master.lotcode' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('inventory.s_lts' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('inventory.holdstopreason' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and position('inventory.photo_name' in lower(regexp_replace(pg_get_viewdef('public.ph_active_suspend'::regclass),'[[:space:]]','','g')))>0
    and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ph_active_suspend'
      and column_name in ('hsreasonbegin','holdstopbegindate','photo_url','photos','photo_date','match_level'))
    and has_table_privilege('anon','public.ph_active_suspend','select')
    and has_table_privilege('authenticated','public.ph_active_suspend','select')
    and not has_table_privilege('anon','public.ph_active_suspend','insert,update,delete')
    and not has_table_privilege('authenticated','public.ph_active_suspend','insert,update,delete') as installed`;
  if (name === agdataV2382HlPoSetBasedPageStageMigrationName) return `select
    position('with ordinality' in lower(pg_get_functiondef('public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)'::regprocedure)))>0
    and position('insert into hl_order_private.po_import_rows' in lower(pg_get_functiondef('public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)'::regprocedure)))>0
    and position('for r in select value from jsonb_array_elements(p_rows)' in lower(pg_get_functiondef('public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)'::regprocedure)))=0
    and position('jsonb_array_length(p_rows)>1000' in lower(pg_get_functiondef('public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)'::regprocedure)))>0
    and position('hl_po_pdf_incomplete' in lower(pg_get_functiondef('public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)'::regprocedure)))>0
    and has_function_privilege('service_role','public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)','execute')
    and not has_function_privilege('anon','public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)','execute')
    and not has_function_privilege('authenticated','public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean)','execute') as installed`;
  if (name === agdataV2383JdUniversalCustomerDirectoryMigrationName) return `select
    to_regprocedure('public.request_jd_customer_directory_v1(uuid,integer,integer,text)') is not null
    and to_regprocedure('sales_private.is_jd_universal_request_tuple_v1(text,text,text,text)') is not null
    and position('AGDATA_EXECUTIVE_ALL' in pg_get_functiondef(
      'sales_private.require_active_customer_mapping_for_request_v1()'::regprocedure))>0
    and has_function_privilege('service_role','public.request_jd_customer_directory_v1(uuid,integer,integer,text)','execute')
    and not has_function_privilege('anon','public.request_jd_customer_directory_v1(uuid,integer,integer,text)','execute')
    and not has_function_privilege('authenticated','public.request_jd_customer_directory_v1(uuid,integer,integer,text)','execute')
    and exists(select 1 from supabase_migrations.schema_migrations where version='20261027124800') as installed`;
  if (name === agdataV2384RuntimeRecoveryMigrationName) return `select
    exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='app_runtime_watchdog_events' and column_name='resolved_at')
    and exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='app_runtime_watchdog_events' and column_name='resolved_in_version')
    and position('mapped.source_unique_id' in pg_get_functiondef(
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure))>0
    and not exists(select 1 from public.app_runtime_watchdog_events where status='open'
      and cluster_id in ('Cluster 3','Cluster 4','Cluster 5'))
    and exists(select 1 from supabase_migrations.schema_migrations where version='20261027133509') as installed`;
  if (name === agdataV2379CompleteReclassDestinationRowLoopMigrationName) return `select
    position('expected_columns' in pg_get_functiondef('private.encode_inventory_reclass_rows_v1(jsonb)'::regprocedure))>0 and
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027013000')
    and position('reclass-destination-row-loop-v2379' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    and position('photo_url' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    and position('loc_photo_match' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    and position('p_expected_revision < 0' in pg_get_functiondef(
      'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0
    and has_function_privilege('service_role','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('authenticated','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('anon','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    as installed`;
  if (name === agdataV2379ReclassLocationEvidenceMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027013100')
    and position('v2379_non_source_evidence_qty' in pg_get_functiondef(
      'private.sync_master_inventory_canonical_v2362()'::regprocedure))>0
    and position('evidence.current_photo_match_qty,new.loc_photo_match' in pg_get_functiondef(
      'private.sync_master_inventory_canonical_v2362()'::regprocedure))>0
    and position('v2379_non_source_evidence_qty' in pg_get_functiondef(
      'private.apply_inventory_location_evidence_v1()'::regprocedure))=0
    as installed`;
  if (name === agdataV2380ReclassPreEditReportsMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027020000')
    and position('v2380_pre_edit_report_rows' in pg_get_functiondef(
      'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0
    and position('reclass_inquiry' in pg_get_functiondef(
      'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0
    and position('reclassPayload' in pg_get_functiondef(
      'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0
    and position('v7FrozenRows' in pg_get_functiondef(
      'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0
    and position('testDeliverySuppressed' in pg_get_functiondef(
      'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0
    and has_function_privilege('service_role','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('authenticated','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('anon','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    as installed`;
  if (name === agdataV2385ReclassOpenStockInlineOhMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027143000')
    and position('next_stock:=coalesce(baseline,0)+change.oh_delta;' in pg_get_functiondef(
      'private.propagate_inventory_season_stock_v1()'::regprocedure))>0
    and position('private.reclass_numeric_v1(m.s_lts)+change.oh_delta' in pg_get_functiondef(
      'private.propagate_inventory_season_stock_v1()'::regprocedure))>0
    and exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004424.010.1'
      and locationcode='C.16.000' and lotcode='27.F1' and ptronhand='166' and ptrreviewed='2' and ptravailable='164' and s_lts='109')
    and exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004424.010.1'
      and locationcode='H.06.000' and lotcode='27.F1' and ptronhand='1' and ptrreviewed='0' and ptravailable='1' and s_lts='109')
    and exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004424.010.1'
      and locationcode='C.16.000' and lotcode='27.S1' and ptronhand='12' and ptrreviewed='0' and ptravailable='12' and s_lts='2')
    as installed`;
  if (name === agdataV2387ReclassPersistenceEvidenceMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027163924')
    and position('''photo_link''' in pg_get_functiondef(
      'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure))>0
    and exists(select 1 from public.ph_master_inventory where btrim(itemcode)='010585.031.1'
      and locationcode='D.21.000' and lotcode='27.F1' and ptronhand='325' and ptravailable='325'
      and s_lts='325' and loc_photo_match='325' and loc_match_pct='15')
    and exists(select 1 from public.ph_master_inventory where btrim(itemcode)='010585.031.1'
      and locationcode='D.21.000' and lotcode='27.S1' and ptronhand='1843' and ptravailable='1843'
      and s_lts='998' and loc_photo_match='325' and loc_match_pct='15')
    as installed`;
  if (name === agdataV2387BatchReclassEvidenceMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027171000')
    and position('reclass-batch-evidence-v2387' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    and position('source_before->>''loc_photo_match''' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    as installed`;
  if (name === agdataV2388UnifiedRuntimeRecoveryMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027184835')
    and position('reclass-source-alias-v2388' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    and not exists(select 1 from public.app_runtime_watchdog_events where status='open')
    and exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.88')
    as installed`;
  if (name === agdataV2389LiveRevisionBunchDraftMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027200748')
    and exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.89')
    and exists(select 1 from public.app_dataset_revisions where key='hl_po_parsed' and state='ready')
    and exists(select 1 from pg_trigger where tgrelid='hl_order_private.state'::regclass
      and tgname='hl_po_parsed_revision_v2389' and not tgisinternal)
    and not exists(
      select 1 from bunch_note_private.batches b join public.profiles p on p.id=b.created_by,
        lateral jsonb_array_elements(coalesce(b.body->'locations','[]'::jsonb)) location
      where lower(p.username)='dylan_collyge'
        and upper(coalesce(location->>'location',location->>'source_location',''))='F.05'
    ) as installed`;
  if (name === agdataV2390UniversalFillTagBunchDylanReclassLotCapMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027211049')
    and position('suspend-fill-tag-v2390' in pg_get_functiondef(
      'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and position('location-sales-notes-v2390' in pg_get_functiondef(
      'suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and position('reclass-move-up-open-stock-v2390' in pg_get_functiondef(
      'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))>0
    and exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.90')
    as installed`;
  if (name === agdataV2390LocalErpWorkerMigrationName) return `select
    to_regprocedure('public.claim_erp_sync_worker_v1(uuid,uuid)') is not null
    and to_regprocedure('public.assert_erp_sync_worker_v1(uuid,uuid)') is not null
    and exists(select 1 from pg_attribute where attrelid='private.erp_sync_jobs'::regclass and attname='worker_id' and not attisdropped)
    and not has_function_privilege('anon','public.claim_erp_sync_worker_v1(uuid,uuid)','execute')
    and not has_function_privilege('authenticated','public.assert_erp_sync_worker_v1(uuid,uuid)','execute')
    and has_function_privilege('service_role','public.claim_erp_sync_worker_v1(uuid,uuid)','execute')
    as installed`;
  if (name === agdataV2391CloudErpContinuationsMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261028040000')
    and exists(select 1 from pg_attribute where attrelid='private.erp_sync_jobs'::regclass
      and attname='continuation_step' and not attisdropped and atttypid='integer'::regtype)
    and to_regprocedure('public.claim_erp_sync_worker_step_v1(uuid,uuid,integer)') is not null
    and position('worker_id' in pg_get_functiondef('public.claim_erp_sync_worker_step_v1(uuid,uuid,integer)'::regprocedure))>0
    and position('continuation_step' in pg_get_functiondef('public.claim_erp_sync_worker_step_v1(uuid,uuid,integer)'::regprocedure))>0
    and not has_function_privilege('anon','public.claim_erp_sync_worker_step_v1(uuid,uuid,integer)','execute')
    and not has_function_privilege('authenticated','public.claim_erp_sync_worker_step_v1(uuid,uuid,integer)','execute')
    and has_function_privilege('service_role','public.claim_erp_sync_worker_step_v1(uuid,uuid,integer)','execute')
    and position('supabase_edge' in pg_get_functiondef('public.claim_erp_sync_worker_v1(uuid,uuid)'::regprocedure))>0
    as installed`;
  if (name === agdataV2392JorgeAssignedLiveChangesMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261028070752')
    and to_regprocedure('private.inventory_row_assigned_to_actor_v2392(text,text,text)') is not null
    and to_regprocedure('private.require_drive_live_change_profile_v2392(text,text,text,text)') is not null
    and position('require_drive_live_change_profile_v2392' in pg_get_functiondef(
      'public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text)'::regprocedure))>0
    and exists(select 1 from public.user_access_control where username='jorge_colunga' and active
      and permission_overrides @> '{"can_access_drive_mode":true,"can_access_av":true,"can_access_que":true,"can_access_manager_tab":true,"can_submit_reclass":true}'::jsonb)
    and exists(select 1 from private.app_access_user_overrides o join public.profiles p on p.id=o.profile_id
      where lower(btrim(p.username))='jorge_colunga' and o.permission_key='drive.reclass.submit'
        and o.allowed and o.access_scope='assigned')
    as installed`;
  if (name === agdataV2392SuspendCloseAvOptionsToastEvalFilterMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261028114955')
    and position('suspend-close-stable-identity-v2392' in pg_get_functiondef(
      'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and position('suspend-tag-complete:' in pg_get_functiondef(
      'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and exists(select 1 from pg_class where oid='public.ph_suspend_history'::regclass
      and reloptions @> array['security_invoker=true'])
    and exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.93')
    as installed`;
  if (name === agdataV2394UniversalRequestDirectorySuspendIdentityMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261028145127')
    and to_regprocedure('public.request_customer_directory_v2394(uuid,text,text,integer,integer,text)') is not null
    and position('suspend-physical-identity-v2394' in pg_get_functiondef(
      'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.94')
    as installed`;
  if (name === agdataV2396BoundedErpRowCountMigrationName) return `select
    to_regprocedure('public.fast_seal_erp_stage_v1(uuid,integer)') is not null
    and position('expected_rows_pending' in pg_get_functiondef('public.fast_begin_erp_stage_v1(text,jsonb,integer)'::regprocedure))>0
    and not has_function_privilege('anon','public.fast_seal_erp_stage_v1(uuid,integer)','execute')
    and not has_function_privilege('authenticated','public.fast_seal_erp_stage_v1(uuid,integer)','execute')
    and has_function_privilege('service_role','public.fast_seal_erp_stage_v1(uuid,integer)','execute')
    as installed`;
  if (name === agdataV2396CloudErpContinuationMigrationName) return `select
    to_regprocedure('public.claim_erp_sync_job_v2(text,text,boolean)') is not null
    and to_regprocedure('public.claim_erp_sync_request_step_v1(uuid,text)') is not null
    and to_regprocedure('public.release_erp_sync_request_step_v1(uuid,uuid,integer)') is not null
    and not has_function_privilege('anon','public.claim_erp_sync_request_step_v1(uuid,text)','execute')
    and not has_function_privilege('authenticated','public.claim_erp_sync_request_step_v1(uuid,text)','execute')
    and has_function_privilege('service_role','public.claim_erp_sync_request_step_v1(uuid,text)','execute')
    and position('jsonb_array_length(p_rows)>5000' in pg_get_functiondef('public.fast_append_erp_stage_batch_v1(uuid,integer,jsonb)'::regprocedure))>0
    as installed`;
  if (name === agdataV2395InstantReclassNavigationMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261028172852')
    and has_function_privilege('service_role','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('authenticated','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and not has_function_privilege('anon','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
    and (select count(*) from public.ph_master_inventory where btrim(itemcode)='006192.010.1'
      and (locationcode,lotcode,ptronhand,ptrreviewed,ptravailable,s_lts) in
        (('C.16.000','27.F1','220','0','220','150'),('C.16.000','27.S1','324','0','324','4074'),
         ('H.03.000','27.S1','4000','0','4000','4074'))) = 3
    and exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.95')
    as installed`;
  if (name === agdataV2390PostgresManualSyncMigrationName) return `select
    to_regclass('private.erp_sync_jobs') is not null
    and to_regprocedure('public.get_erp_sync_status_v1()') is not null
    and to_regprocedure('public.claim_erp_sync_job_v1(text,text)') is not null
    and to_regprocedure('public.update_erp_sync_job_v1(uuid,jsonb)') is not null
    and to_regprocedure('public.fast_erp_import_columns_v1(text)') is not null
    and exists(select 1 from pg_class where oid='private.erp_sync_jobs'::regclass and relrowsecurity)
    and not has_function_privilege('anon','public.claim_erp_sync_job_v1(text,text)','execute')
    and not has_function_privilege('authenticated','public.claim_erp_sync_job_v1(text,text)','execute')
    and exists(select 1 from pg_index where indrelid='private.erp_sync_jobs'::regclass and indisunique and indpred is not null)
    as installed`;
  if (name === agdataV2390ReclassReceiptLiveStockDurabilityMigrationName) return `select
    exists(select 1 from supabase_migrations.schema_migrations where version='20261027223716')
    and position('fast_ingest_drive_around_v1' in pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure))>0
    and position('004103.010.1' in pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure))=0
    and position('s_lts' in pg_get_functiondef('private.reconcile_inventory_live_overrides_v1()'::regprocedure))>0
    and position('season_oh' in pg_get_functiondef('private.reconcile_inventory_live_overrides_v1()'::regprocedure))>0
    and exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004103.010.1' and btrim(contsize)='#1'
      and locationcode='C.15.000' and lotcode='27.F1' and ptronhand='529' and ptrreviewed='0' and ptravailable='529' and s_lts='253')
    and exists(select 1 from public.ph_master_inventory where btrim(itemcode)='004103.010.1' and btrim(contsize)='#1'
      and locationcode='C.15.000' and lotcode='27.S1' and ptronhand='279' and ptrreviewed='0' and ptravailable='279' and s_lts='0')
    and (select count(*) from public.ph_master_inventory where btrim(itemcode)='004103.010.1' and btrim(contsize)='#1'
      and (locationcode,lotcode) in (('C.15.000','27.F1'),('F.16.000','27.F1'),('H.06.000','27.F1'),
        ('C.15.000','27.S1'),('F.16.000','27.S1'),('I.03.000','27.S1'))
      and (ptronhand,ptrreviewed,ptravailable,s_lts,season_oh) in
        (('529','0','529','253','643'),('113','0','113','253','643'),('1','0','1','253','643'),
         ('279','0','279','0','2050'),('175','0','175','0','2050'),('1596','0','1596','0','2050'))) = 6
    as installed`;
  throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
}

export async function upsertVaultSecret({ client, name, value, description }) {
  if (!client || !/^[a-z][a-z0-9_]{2,63}$/.test(String(name || '')) || !String(value || '')) {
    throw new Error('HR_VAULT_SECRET_INPUT_INVALID');
  }
  const prior = await client.query('select id from vault.secrets where name = $1 limit 1', [name]);
  if (prior.rows.length) {
    await client.query('select vault.update_secret($1,$2,$3,$4)', [prior.rows[0].id, value, name, description || null]);
    return 'updated';
  }
  await client.query('select vault.create_secret($1,$2,$3)', [value, name, description || null]);
  return 'created';
}

export function migrationBody(source) {
  if (!/^begin;\s/i.test(source) || !/\scommit;\s*$/i.test(source)) throw new Error('LOW_STOCK_MIGRATION_TRANSACTION_REQUIRED');
  return source.replace(/^begin;\s*/i, '').replace(/\scommit;\s*$/i, '');
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export function buildScopedMigrationPreflightSql(targetMigrationName) {
  if (!registeredReleaseDatabaseMigrations.includes(targetMigrationName)) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
  const version = targetMigrationName.slice(0, 14);
  return `begin;\nset local statement_timeout='30s';\nselect jsonb_build_object('prior',(select to_jsonb(m) from (select name,statements from supabase_migrations.schema_migrations where version=${sqlLiteral(version)}) m),` +
    `'baseline',(select to_jsonb(m) from (select name from supabase_migrations.schema_migrations where version=${sqlLiteral(productionBaselineVersion)}) m)) as release_migration_state;\ncommit;`;
}

export function buildScopedMigrationApplySql({ source, targetMigrationName }) {
  if (!registeredReleaseDatabaseMigrations.includes(targetMigrationName)) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
  const version = targetMigrationName.slice(0, 14);
  const name = targetMigrationName.slice(version.length + 1, -4);
  const body = migrationBody(source);
  const contract = migrationContractQuery(targetMigrationName);
  const baselineRace = baselineIncludedMigrations.has(targetMigrationName)
    ? `if exists(select 1 from supabase_migrations.schema_migrations where version=${sqlLiteral(productionBaselineVersion)}) then raise exception 'LOW_STOCK_MIGRATION_HISTORY_CHANGED'; end if;`
    : '';
  return `begin;\nset local lock_timeout='1500ms';\nset local statement_timeout='30s';\n` +
    `select pg_advisory_xact_lock(hashtext('gnc-item-low-stock-schema-v1'));\n` +
    `do $history$ begin if exists(select 1 from supabase_migrations.schema_migrations where version=${sqlLiteral(version)}) then ` +
    `raise exception 'LOW_STOCK_MIGRATION_HISTORY_CHANGED'; end if; ${baselineRace} end $history$;\n` +
    `${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(` +
    `${sqlLiteral(version)},${sqlLiteral(name)},array[${sqlLiteral(body)}]::text[]);\n` +
    `do $contract$ begin if not coalesce((select installed from (${contract}) as release_contract),false) then ` +
    `raise exception 'LOW_STOCK_DATABASE_CONTRACT_MISSING'; end if; end $contract$;\ncommit;`;
}

export function buildScopedMigrationExistingCheckSql({ targetMigrationName, expectedState, source }) {
  if (!registeredReleaseDatabaseMigrations.includes(targetMigrationName) || !['prior', 'baseline'].includes(expectedState)) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
  const version = targetMigrationName.slice(0, 14);
  const name = targetMigrationName.slice(version.length + 1, -4);
  const contract = migrationContractQuery(targetMigrationName).replace(/;\s*$/, '');
  const historyCheck = expectedState === 'prior'
    ? `if not exists(select 1 from supabase_migrations.schema_migrations where version=${sqlLiteral(version)} and name=${sqlLiteral(name)} and array_to_string(statements,E'\\n')=${sqlLiteral(migrationBody(source))}) then raise exception 'LOW_STOCK_MIGRATION_HISTORY_CHANGED'; end if;`
    : `if not exists(select 1 from supabase_migrations.schema_migrations where version=${sqlLiteral(productionBaselineVersion)} and name='production_baseline') then raise exception 'LOW_STOCK_MIGRATION_HISTORY_CHANGED'; end if;`;
  return `begin;\nset local lock_timeout='1500ms';\nset local statement_timeout='30s';\nselect pg_advisory_xact_lock(hashtext('gnc-item-low-stock-schema-v1'));\n` +
    `do $check$ begin ${historyCheck} if not coalesce((select installed from (${contract}) as release_contract),false) then raise exception 'LOW_STOCK_DATABASE_CONTRACT_MISSING'; end if; end $check$;\ncommit;`;
}

function parseSupabaseQueryRows(output) {
  const text = String(output || '').trim();
  for (const candidate of [text, ...text.split(/\r?\n/).reverse()]) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.rows)) return parsed.rows;
      if (Array.isArray(parsed?.result?.rows)) return parsed.result.rows;
    } catch { /* inspect the next complete JSON payload */ }
  }
  throw new Error('LOW_STOCK_SUPABASE_CLI_OUTPUT_INVALID');
}

export async function applyScopedMigrationWithSupabaseCli({ source, targetMigrationName, query }) {
  if (typeof query !== 'function') throw new Error('LOW_STOCK_SUPABASE_CLI_QUERY_FAILED');
  const version = targetMigrationName.slice(0, 14);
  const name = targetMigrationName.slice(version.length + 1, -4);
  const body = migrationBody(source);
  const rows = await query(buildScopedMigrationPreflightSql(targetMigrationName));
  const state = rows?.[0]?.release_migration_state;
  if (!state || typeof state !== 'object') throw new Error('LOW_STOCK_SUPABASE_CLI_OUTPUT_INVALID');
  const contract = migrationContractQuery(targetMigrationName);
  if (state.prior) {
    const statements = Array.isArray(state.prior.statements) ? state.prior.statements.join('\n') : String(state.prior.statements || '');
    if (state.prior.name !== name || statements !== body) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
    await query(buildScopedMigrationExistingCheckSql({ targetMigrationName, expectedState: 'prior', source }));
    return { status: 'already_applied' };
  }
  if (baselineIncludedMigrations.has(targetMigrationName) && state.baseline) {
    if (state.baseline.name !== 'production_baseline') throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
    await query(buildScopedMigrationExistingCheckSql({ targetMigrationName, expectedState: 'baseline' }));
    return { status: 'included_in_baseline' };
  }
  await query(buildScopedMigrationApplySql({ source, targetMigrationName }));
  return { status: 'applied' };
}

export async function applyScopedMigrationsUsingSupabaseCli({ migrationPaths, root = process.cwd(), query = sql => runLinkedSupabaseQuery(sql, { root }) }) {
  const selected = normalizeScopedMigrationPaths(migrationPaths);
  const results = [];
  for (const targetMigrationName of selected) {
    const sourceDirectory = baselineIncludedMigrations.has(targetMigrationName) ? 'archive_migrations' : 'migrations';
    const sourcePath = path.join(root, 'supabase', sourceDirectory, targetMigrationName);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const result = await applyScopedMigrationWithSupabaseCli({ source, targetMigrationName, query });
    results.push({ migration: targetMigrationName, ...result });
  }
  return results;
}

export async function runLinkedSupabaseQuery(sql, { root = process.cwd(), spawn = spawnSync } = {}) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('LOW_STOCK_SUPABASE_ACCESS_TOKEN_MISSING');
  const linkFile = path.join(root, 'supabase', '.temp', 'project-ref');
  const linkedProject = fs.readFileSync(linkFile, 'utf8').trim();
  let apiProject = '';
  try { apiProject = new URL(process.env.SUPABASE_URL || '').hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] || ''; }
  catch { throw new Error('LOW_STOCK_SUPABASE_PROJECT_LINK_INVALID'); }
  if (!/^[a-z0-9]{20}$/.test(linkedProject) || linkedProject !== apiProject) throw new Error('LOW_STOCK_SUPABASE_PROJECT_LINK_INVALID');
  const cliEntrypoint = path.join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
  const cliEntryStat = fs.existsSync(cliEntrypoint) ? fs.lstatSync(cliEntrypoint) : null;
  if (!cliEntryStat?.isFile() || cliEntryStat.isSymbolicLink()) throw new Error('LOW_STOCK_SUPABASE_CLI_NOT_FOUND');
  const tempRoot = process.env.RUNNER_TEMP || tmpdir();
  const queryFile = path.join(tempRoot, `agdata-linked-query-${process.pid}.sql`);
  const existing = fs.existsSync(queryFile) ? fs.lstatSync(queryFile) : null;
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('LOW_STOCK_SUPABASE_CLI_QUERY_FAILED');
  fs.writeFileSync(queryFile, sql, 'utf8');
  let result;
  try {
    result = spawn(process.execPath, [cliEntrypoint, 'db', 'query', '--linked', '--file', queryFile, '--output', 'json'],
      { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  } finally {
    fs.writeFileSync(queryFile, '');
  }
  if (result.error || result.status !== 0) {
    throw new Error(classifySupabaseCliFailure(result));
  }
  return parseSupabaseQueryRows(result.stdout);
}

export async function applyItemLowStockMigration({ client, source, onPhase = () => {}, targetMigrationName = migrationName }) {
  if (!registeredReleaseDatabaseMigrations.includes(targetMigrationName)) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
  const version = targetMigrationName.split('_')[0];
  const name = targetMigrationName.slice(version.length + 1, -4);
  const body = migrationBody(source);
  const contractQuery = migrationContractQuery(targetMigrationName);
  onPhase('transaction_begin');
  await client.query('begin');
  try {
    onPhase('advisory_lock');
    await client.query("select pg_advisory_xact_lock(hashtext('gnc-item-low-stock-schema-v1'))");
    onPhase('migration_history_read');
    const prior = await client.query('select name, statements from supabase_migrations.schema_migrations where version = $1', [version]);
    if (prior.rows.length) {
      if (prior.rows[0].name !== name || prior.rows[0].statements?.join('\n') !== body) throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
    } else {
      // The production baseline contains these archived migrations. Its ledger
      // intentionally has no entries for their former individual versions.
      const baseline = await client.query('select name from supabase_migrations.schema_migrations where version = $1', [productionBaselineVersion]);
      if (baseline.rows.length && baselineIncludedMigrations.has(targetMigrationName)) {
        if (baseline.rows.length !== 1 || baseline.rows[0].name !== 'production_baseline') throw new Error('LOW_STOCK_MIGRATION_HISTORY_MISMATCH');
        onPhase('contract_check');
        const result = await client.query(contractQuery);
        if (result.rows[0]?.installed !== true) throw new Error('LOW_STOCK_DATABASE_CONTRACT_MISSING');
        onPhase('transaction_commit');
        await client.query('commit');
        return { status: 'included_in_baseline' };
      }
      onPhase('migration_sql');
      await client.query(body);
      onPhase('migration_history_write');
      await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)', [version,name,[body]]);
    }
    onPhase('contract_check');
    const result = await client.query(contractQuery);
    if (result.rows[0]?.installed !== true) throw new Error('LOW_STOCK_DATABASE_CONTRACT_MISSING');
    onPhase('transaction_commit');
    await client.query('commit');
    return { status: prior.rows.length ? 'already_applied' : 'applied' };
  } catch (error) {
    try { await client.query('rollback'); } catch { /* retain the migration error for sanitized reporting */ }
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  if (process.env.RELEASE_MIGRATIONS !== undefined) {
    if (args.length) throw new Error('LOW_STOCK_ARGUMENTS_INVALID');
    let phase = 'release_ref';
    try {
      const selected = selectReleaseMigrations();
      if (!selected.length) return;
      if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main'
          || !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) throw new Error('LOW_STOCK_CLOUD_MAIN_REQUIRED');
      const repository = process.env.GITHUB_REPOSITORY || '', sha = process.env.GITHUB_SHA || '';
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || !process.env.GH_TOKEN) throw new Error('LOW_STOCK_RELEASE_IDENTITY_REQUIRED');
      phase = 'current_main_check';
      const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
        headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok || (await response.json()).object?.sha !== sha) throw new Error('LOW_STOCK_CURRENT_MAIN_REQUIRED');
      phase = 'linked_cli_migrations';
      const results = await applyScopedMigrationsUsingSupabaseCli({ migrationPaths: selected, root: process.cwd() });
      for (const result of results) console.log(`${result.migration}: ${result.status}.`);
    } catch (error) {
      console.error(formatSafeFailure({ phase, error }));
      process.exitCode = 1;
    }
    return;
  }
  const diagnose = args.length === 1 && args[0] === '--diagnose';
  if (args.length && !diagnose) throw new Error('LOW_STOCK_ARGUMENTS_INVALID');
  let phase = diagnose ? 'diagnostic_authorization' : 'release_ref';
  let connectionString = '';
  let client;
  let primaryError;
  try {
    if (diagnose) validateDiagnosticContext(process.env);
    else {
      // This command runs only after the existing cloud release-proof verifier.
      // Recheck current main immediately before opening the database connection.
      if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main'
          || !['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) throw new Error('LOW_STOCK_CLOUD_MAIN_REQUIRED');
      const repository = process.env.GITHUB_REPOSITORY || '', sha = process.env.GITHUB_SHA || '';
      if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || !process.env.GH_TOKEN) throw new Error('LOW_STOCK_RELEASE_IDENTITY_REQUIRED');
      const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
        headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok || (await response.json()).object?.sha !== sha) throw new Error('LOW_STOCK_CURRENT_MAIN_REQUIRED');
    }
    phase = 'target_validation';
    connectionString = validateDatabaseTarget(process.env.SUPABASE_DB_URL, process.env.SUPABASE_URL);
    client = new pg.Client(createDatabaseClientOptions(connectionString));
    phase = 'database_connect';
    await client.connect();
    if (diagnose) {
      const probe = await runReadOnlySchemaDiagnostic({ client, onPhase: next => { phase = next; } });
      console.log(`LOW_STOCK_SCHEMA_DIAGNOSTIC status=ok installed=${probe.installed}`);
    } else {
      const selectedMigrations = selectReleaseMigrations();
      for (const targetMigrationName of selectedMigrations) {
        const sourceDirectory = baselineIncludedMigrations.has(targetMigrationName) ? 'archive_migrations' : 'migrations';
        const source = fs.readFileSync(new URL(`../supabase/${sourceDirectory}/${targetMigrationName}`, import.meta.url), 'utf8');
        const applied = await applyItemLowStockMigration({ client, source, targetMigrationName, onPhase: next => { phase = next; } });
        console.log(`${targetMigrationName}: ${applied.status}.`);
      }
      if (process.env.RELEASE_MIGRATIONS !== undefined) {
        console.log('Targeted ingestion release: existing reminder Vault configuration preserved.');
      } else if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL) {
        await upsertVaultSecret({ client, name: 'hr_calendar_project_url', value: process.env.SUPABASE_URL, description: 'Supabase project URL used by the scheduled HR calendar reminder dispatcher.' });
        await upsertVaultSecret({ client, name: 'hr_calendar_service_role_key', value: process.env.SUPABASE_SERVICE_ROLE_KEY, description: 'Service role credential used only by the pg_cron calendar reminder dispatcher.' });
        console.log('HR calendar reminder Vault credentials synchronized.');
      } else {
        throw new Error('HR_VAULT_CREDENTIALS_REQUIRED');
      }
    }
  } catch (error) {
    primaryError = error;
    console.error(formatSafeFailure({ phase, error, connectionString }));
    process.exitCode = 1;
  } finally {
    if (client) {
      phase = 'client_close';
      try { await client.end(); }
      catch (error) {
        if (!primaryError) {
          console.error(formatSafeFailure({ phase, error, connectionString }));
          process.exitCode = 1;
        }
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(formatSafeFailure({ phase: 'release_ref', error }));
    process.exitCode = 1;
  });
}
