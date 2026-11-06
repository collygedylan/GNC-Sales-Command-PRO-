---
name: test-agdata-db-harvard-etl-staging-and-sync-pipeline-engineer
description: "Sandbox implementation. Preserve staging, resumable publication and bounded historical analytics."
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# test-agdata-db-harvard-etl-staging-and-sync-pipeline-engineer

Sandbox implementation. Preserve staging, resumable publication and bounded historical analytics.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Preserve staging, resumable publication and bounded historical analytics.

### Exact ownership
- test/assets/app-runtime.js: runGoogleAppsScriptTrigger, applyManualSyncStatus, refreshManualSyncStatus, isDatasetFrozenDuringManualSync, refreshDashboardSyncMetadata, processDylanFileProcessedToasts, getProductionLiveSyncCoordinator, fetchDirectPostgrestReadPage, runDedupeSupabaseRead, abortSupabaseReadsBeforeGeneration, fetchRequestCustomerMapRows, syncGoogleScriptButton, refreshManualSyncOnForeground, scheduleManualSyncCompletionRefresh, getTransientManualErpSliceStatus, reduceManualErpSliceLimit, getUniversalLiveSyncTables, applyUniversalLiveSyncPatch, getRowPatchDatasetKey, resetPendingRowPatchesForOwner, isRowPatchSourceReady, bufferRowPatchUntilHydrated, replayHydratedRowPatches, hydrateColdSource, ensureColdOperationalHydration, getProductionCoreLiveProjection, ensureDatasetLoaded, hasAuthenticatedOperationalReadIdentity, redactEvalSensitiveData, supabaseRpc, fetchAllSupabaseRows, fetchAllInventoryReadRows, fetchManagerItemLowStockTargets, hydrateFirstDatasetPageForRender, dailyGdd.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleDatasetRevisionsAction, handleAppsScriptAction, dispatchCloudErpSync, handleErpSyncContinuation, mintCloudDriveAccessToken, dispatchRequestDeliveryWorkerNow, fast_erp_ingest, handleErpSyncAction, processCloudErpSyncStep, withCloudErpSyncLeaseHeartbeat, claimAndDispatchCloudStep, executeCloudErpSyncStep, releaseCloudErpSyncStep.
- Code.gs: mintDriveToken_, getFastLiveIngestRpc_, processFastLiveFile_, processRequestDeliveryOutbox_, getManualSyncStageOrder_, queueManualSyncRequest_, runQueuedManualSyncStage_, getFastLiveIngestDatasetKey_, getFastLiveFileMeta_, cleanupCompletedImportExtraction_, cleanupTempGoogleSheet_, extractDataFromFile, scheduleSocOrderHistoryTrigger_, runSocOrderHistoryBackfillChunk_.
- scripts/fast-live-erp-sync.mjs: shouldIncludeSocLiveRow, prepareLiveRows, buildFastBatchSql, buildFastAtomicSwapSql, runFastLiveErpSync, buildFastStageRpcSql, callFastStageRpc.
- supabase/migrations/20261026070000_agdata_v2369_fast_live_erp_ingestion.sql: check_erp_file_sync_needed_v1, fast_ingest_drive_around_v1, fast_ingest_soc_orders_v1, fast_ingest_soc_reserves_v1, fast_ingest_cav_v1, fast_ingest_warehouse_assigned_v1.
- supabase/migrations/20261026140000_agdata_v2369_emergency_recovery.sql: claim_request_delivery_events, safe_parse_timestamptz.
- supabase/migrations/20261026200000_agdata_v2374_unified_fast_baseline_suspend_reclass_email.sql: bulk_import_master_snapshot_v1, fast_ingest_drive_around_v1, ph_active_suspend, ph_soc_suspend_tag_rows.
- supabase/migrations/20261026210000_agdata_v2375_suspend_17_cards_and_fast_batch_sync.sql: ph_active_suspend, ph_soc_suspend_tag_rows.
- supabase/migrations/20261026220000_agdata_v2376_instant_login_and_fast_suspend_view.sql: ph_active_suspend, ph_soc_suspend_tag_rows.
- supabase/migrations/20261026230000_agdata_v2377_suspend_read_continuity.sql: ph_active_suspend.
- supabase/migrations/20261027030000_agdata_v2381_fast_erp_stage_rpcs.sql: fast_begin_erp_stage_v1, fast_append_erp_stage_batch_v1, fast_commit_erp_stage_swap_v1, fast_abort_erp_stage_v1, sync_new_unassigned_warehouse_itemcodes_v1, mirror_itemcode_default_owner_to_warehouse_v1, fast_ingest_warehouse_assigned_v1, repair_fast_drive_archive_sql.
- supabase/migrations/20261027133509_agdata_v2384_runtime_recovery.sql: bulk_import_master_snapshot_v2374_base.
- supabase/migrations/20261027200748_agdata_v2389_live_revision_and_bunch_draft_restore.sql: touch_hl_po_parsed_v2389, hl_po_parsed_revision_v2389.
- supabase/functions/_shared/erp-sync.mjs: runErpSyncWorker, runErpSyncWorkerStep, normalizeErpRows, parseErpCsv, parseErpXlsx, normalizeErpHeader, shouldIgnoreErpFile, validateErpSyncCommand, normalizeErpRowsChunk, stageFileContinuation, parseErpXlsxPage, countImportableErpXlsxRows, validSocDock, firstSocDock, hasImportableSocDock, isImportableSocRow, parseErpXlsxImportRows, compactErpRowsPreservingNullColumnUnion, xlsxColumnLetters, selectedCellPattern, parseXlsxSelectedCells, resolveErpRowsPerSlice, parseErpXlsxSheets, sourceWorkbookBytes, isOperationalErpSyncComplete, buildOperationalStageCheckpoint, maxErpImportRows, finishStageContinuation, runProductionScheduleSyncStep, parseProductionSchedulePage, mapProductionScheduleRecords.
- supabase/migrations/20261028014500_agdata_v2390_postgres_manual_sync.sql: get_erp_sync_status_v1, claim_erp_sync_job_v1, update_erp_sync_job_v1.
- supabase/migrations/20261028022000_agdata_v2390_local_erp_worker.sql: claim_erp_sync_worker_v1, assert_erp_sync_worker_v1.
- supabase/migrations/20261028040000_agdata_v2391_cloud_erp_continuations.sql: claim_erp_sync_worker_v1, claim_erp_sync_worker_step_v1.
- scripts/local-erp-sync-worker.mjs: localWorkerConfig, createWorkerApi, runClaimedLocalJob, pollLocalWorkerOnce, runLocalWorkerLoop.
- supabase/migrations/20261028183832_agdata_v2396_cloud_erp_continuation.sql: claim_erp_sync_job_v2, claim_erp_sync_request_step_v1, release_erp_sync_request_step_v1.
- supabase/migrations/20261028190134_agdata_v2396_bounded_erp_row_count.sql: fast_seal_erp_stage_v1.
- supabase/migrations/20261029031000_agdata_v23100_cloud_sync_lease_renewal.sql: assert_erp_sync_worker_v1.
- supabase/functions/_shared/erp-secondary-sync.mjs: runSecondaryErpSyncStep, prefetchSecondaryFolders, buildSecondaryRows, readSecondarySheet.
- supabase/migrations/20261029132500_agdata_v23103_secondary_delta_imports.sql: upsert_secondary_erp_delta_v23103, hl_po_pdf_stage.
- supabase/migrations/20261029132000_agdata_v23103_bounded_erp_request_lease.sql: claim_erp_sync_request_step_v1, assert_erp_sync_worker_v1.
- supabase/migrations/20261029171000_agdata_v23104_universal_live_sync.sql: agdata_live_sync_authorized_v23104, broadcast_rows_v23104, broadcast_revision_v23104.
- supabase/functions/_shared/erp-history-sync.mjs: runSocHistorySyncStep.
- supabase/migrations/20261029173000_agdata_v23105_cloud_history_refresh.sql: activate_eval_item_low_stock_import_v1.
- supabase/functions/_shared/soc-order-history.mjs: parseSocHistoryWorkbook, parseSocHistoryReportTime.
- test/assets/erp-sync-ui-functions.js: driveManualErpSyncFromStatus.
- scripts/finish-pending-history-files.mjs: finishPendingHistoryFiles, fetchHistoryDriveResource.
- supabase/migrations/20261030180000_agdata_v23116_sync_progress.sql: get_my_erp_sync_progress_v23116.
- supabase/migrations/20261030193000_agdata_v23116_erp_recovery_wake.sql: wake_erp_sync_job_v23116.
- supabase/migrations/20261030200000_agdata_v23116_hl_po_progress_alias.sql: get_my_erp_sync_progress_v23116.
- supabase/migrations/20261031020000_agdata_v23120_operational_sync_completion.sql: operational_erp_status_v23120, finish_operational_erp_job_v23120, fold_soc_average_orders_v23120, fast_ingest_soc_orders_v1, get_my_erp_sync_progress_v23116.
- supabase/migrations/20261031150000_agdata_v23121_live_erp_liveness.sql: operational_erp_status_v23120, finish_operational_erp_job_v23120, get_erp_sync_status_v1, get_my_erp_sync_progress_v23116.
- test/assets/smart-hold-intelligence.js: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_app_dataset_revisions, test_ph_drive_around_report_rows, test_ph_weather_daily
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- overall progress = floor(sum(DRIVE,CAV,RESERVES,SOC,HL PO percentages)/5); 100% requires committed receipt.
- ORDER_HISTORY and PROD_SCHEDULE do not block operational completion; preserve canonical dailyGdd units and formula.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-db-harvard-etl-staging-and-sync-pipeline-engineer, test-agdata-sync-and-supabase-architect, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-db-harvard-etl-staging-and-sync-pipeline-engineer.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- SUSPEND-ALL-ROUTES-2026-11-05: A dc-only membership rule and blanket missing-row deletion hid other evaluators and discarded saved work; legacy evaluation dates were mistaken for permanent physical-tag completion. Never choose an evaluator filter to force an approximate total. Include every active SUSPEND route: dc means dylan_collyge; ms and mk mean megan_kelly; other routes use their explicit username or Assigned Items owner, never an implicit Dylan fallback. Dylan/Megan and other owners default to self; JD defaults to All Users; authorized users retain cross-owner options with actual positive counts. The verified workbook has 24 active ms plus 3 mk rows for Megan, not a fabricated 24 combined. Missing untouched rows leave SOC/Docks on atomic sync; missing tags with saved evidence or replacement work remain until Complete Tag. Only an exact Complete Tag receipt or explicit completed flag creates a permanent closure; evaluation dates and shared business keys cannot close sibling tags. Preserve exact master evidence, session previews, immediate cards return, filename ordering and Watchdog. Permanent assertion: tests/soc-suspend-routing.test.mjs; Invariant 488; rolled-back installed SQL ownership/retention/eligibility assertions.. Evidence: Verified revision 644 workbook: 88 active rows across all codes, including 24 ms and 3 mk. Existing five explicit completions remain closed..
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
