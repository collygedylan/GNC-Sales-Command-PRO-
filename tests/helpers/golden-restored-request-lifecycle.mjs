import assert from 'node:assert/strict';
import vm from 'node:vm';

function requestVisibilityChecks(runFunctions, locationContext, functionSource) {
  const moveContext = runFunctions('assets/app-runtime.js', [
    'firstNonEmptyValue', 'getMoveRequestRowBatchId', 'getMoveRequestRowAssignment', 'isMoveRequestRow',
  ], { MOVE_REQUEST_ASSIGNMENT: 'moves' });
  assert.equal(moveContext.isMoveRequestRow({ unique_id: 'move_req_legacy_row' }), true);
  assert.equal(moveContext.isMoveRequestRow({ req_customer: 'Location Move' }), true);
  assert.equal(moveContext.isMoveRequestRow({ unique_id: 'request_row', req_customer: 'Customer' }), false);
  const context = locationContext({
    isRequestVisibleForCurrentUser: () => true, isMoveRequestRow: row => Boolean(row?.MOVE_BATCH_ID),
    isRegularRequestQueueItem: () => true, getQueueCompletionState:()=>null, optimisticCompletedRowIds:new Set(),
    matchesQueHeaderSearch: () => true, refreshVisiblePendingRequestDelivery() {},
    naturalCompare: (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' }),
    getItemUniqueId: row => row.id, buildRequestPagedRenderPlan: (_mode, _crumb, items) => ({ rows: items }),
  });
  vm.runInContext([
    functionSource('assets/app-runtime.js', 'firstNonEmptyValue'),
    functionSource('assets/app-runtime.js', 'normalizeRequestStatus'),
    functionSource('assets/app-runtime.js', 'hasCompletionDateValue'),
    functionSource('assets/app-runtime.js', 'isTruthishHistoryValue'),
    functionSource('assets/app-runtime.js', 'hasConfirmedRequestCompletion'),
    functionSource('assets/app-runtime.js', 'isOptimisticallyCompletedRow'),
    functionSource('assets/app-runtime.js', 'isRequestPendingVisible'),
    functionSource('assets/app-runtime.js', 'compareLocationCodeValues'),
    functionSource('assets/app-runtime.js', 'buildPendingRequestRenderPlan'),
    functionSource('assets/app-runtime.js', 'buildActiveRequestLiveRowsQuery'),
  ].join('\n'), context);
  const active = [
    { id: 'c12', LOCATIONCODE: 'C.12.019', LOTCODE: '27.F1', REQ_STATUS: 'Pending', DATE_COMPLETED: null, REQ_QTY: null, REQUEST_ACTIVE: true },
    { id: 'c2', LOCATIONCODE: 'C.2.000', LOTCODE: '27.S1', REQ_STATUS: 'Pending', DATE_COMPLETED: null, REQ_QTY: '', REQUEST_ACTIVE: true },
    { id: 'c5', LOCATIONCODE: 'C.05.000', LOTCODE: '27.U1', REQ_STATUS: 'Pending', DATE_COMPLETED: null, REQ_QTY: 0, REQUEST_ACTIVE: true, REQUEST_HISTORY: true },
  ];
  const history = Array.from({ length: 4001 }, (_, index) => ({
    id: `history-${index}`, LOCATIONCODE: 'Z.99.999', REQ_STATUS: 'Pending', DATE_COMPLETED: null,
    REQUEST_ACTIVE: false, REQUEST_HISTORY: true, REQUEST_HISTORY_ONLY: true,
  }));
  assert.equal(active.every(row => context.isRequestPendingVisible(row)), true);
  assert.equal(history.every(row => !context.isRequestPendingVisible(row)), true);
  const plan = context.buildPendingRequestRenderPlan([...history, ...active]);
  assert.deepEqual(Array.from(plan.rows, row => row.id), ['c2', 'c5', 'c12']);
  assert.match(context.buildActiveRequestLiveRowsQuery('*'), /date_completed=is\.null[^]*order=created_at\.desc,unique_id\.desc/);
  assert.match(functionSource('assets/app-runtime.js', 'forceRefreshRequestsForView'), /force_fresh: true, cache: 'no-store'/);
  assert.match(functionSource('assets/app-runtime.js', 'fetchAllSupabaseRows'), /forceFresh[^]*:fresh:/);
}

function historicalRecoveryChecks(read) {  const appApiSource = read('supabase/functions/app-api/index.ts');
  assert.match(appApiSource, /\["request_queue", "active_request"\]\.includes\(dataset\)\) query\.set\("date_completed", "is\.null"\)/);
  assert.match(appApiSource, /request_queue:\s*\{[^]*filterFields:\s*new Set\(\[[^\]]*"date_completed"/);
  const migration = read('supabase/migrations/20261024060000_request_queue_pending_reconciliation_v3.sql');
  assert.match(migration, /event_type='request_created'[^]*request_completed[^]*ph_request_queue_removal_commands[^]*insert into public\.ph_active_request/);
  assert.match(migration, /request_queue_expected_pending_v3[^]*REQUEST_CREATED_RECONCILIATION_INCOMPLETE/);
  assert.doesNotMatch(migration, /order by o\.created_at desc,o\.event_id desc\s+limit 100/);
  const legacyMigration = read('supabase/migrations/20261024061500_request_queue_legacy_outbox_reconciliation_v4.sql');
  assert.match(legacyMigration, /legacy-explicit-removal/);
  assert.match(legacyMigration, /outbox_recovery[^]*insert into public\.ph_active_request[^]*REQUEST_LEGACY_PENDING_ROWS_MISSING/);
  const legacyFunction = legacyMigration.slice(legacyMigration.indexOf('create or replace function private.reconcile_legacy_pending_requests_from_outbox_v4'), legacyMigration.indexOf('revoke all on function private.reconcile_legacy_pending_requests_from_outbox_v4'));
  assert.doesNotMatch(legacyFunction, /customeridentityid|consigneeidentityid/);
  const lifecycleMigration = read('supabase/migrations/20261024203000_unified_request_sync_sales_impact_v1.sql');
  const surgicalMigration = read('supabase/migrations/20261025003000_agdata_v2361_surgical_restore.sql');
  assert.match(lifecycleMigration, /request_completion_proof_v1[^]*request_completed[^]*request_history_has_valid_evidence_v1[^]*request_master_has_valid_evidence_v1[^]*ph_request_queue_removal_commands/);
  assert.match(lifecycleMigration, /recover_unfulfilled_requests_v1[^]*insert into public\.ph_active_request[^]*pending_recovered/);
  assert.match(lifecycleMigration, /req_status='Pending'[^]*upsert_request_history\(candidate\.unique_id,'pending_snapshot'/);
  assert.match(lifecycleMigration, /ph_request_history_block_delete_v2360[^]*ph_request_history_block_truncate_v2360/);
  assert.match(lifecycleMigration, /grant select on public\.ph_master_inventory to authenticated/);
  assert.match(lifecycleMigration, /app_runtime_watchdog_events set status='resolved'/);
  assert.match(surgicalMigration, /recent-outbox-cutoff-v2361/);
  assert.match(surgicalMigration, /2026-10-22 00:00:00 America\/Chicago/);
  assert.match(surgicalMigration, /ph_active_request_retirement_v2361[^]*delete from public\.ph_active_request/);
  assert.doesNotMatch(surgicalMigration.slice(surgicalMigration.indexOf('create or replace function private.recover_unfulfilled_requests_v1'), surgicalMigration.indexOf('create or replace function public.reconcile_active_requests_from_outbox_v1')), /history_without_evidence|history_recovery/);
  assert.match(surgicalMigration, /information_schema\.tables[^]*table_schema = 'archive_backup'[^]*alter table archive_backup/);
}

function canonicalMigrationChecks(read) {  const canonicalMigration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const cleanupMigration = read('supabase/migrations/20261025014500_agdata_v2362_remove_legacy_request_objects.sql');
  const uniformMigration = read('supabase/migrations/20261025023000_agdata_v2363_uniform_active_history_architecture.sql');
  const browserCompatibilityMigration = read('supabase/migrations/20261025040000_agdata_v2364_request_browser_compatibility.sql');
  const evidenceCompatibilityMigration = read('supabase/migrations/20261025062000_agdata_v2364_location_evidence_repair_compatibility.sql');
  assert.match(canonicalMigration, /alter table public\.ph_active_request rename to ph_requests_pending/);
  assert.match(canonicalMigration, /alter table public\.ph_request_history rename to ph_requests_completed_history/);
  assert.match(canonicalMigration, /update public\.ph_requests_completed_history history set[^]*canonical_migration_reason','pending-history-overlap-v2362'[^]*from public\.ph_requests_pending pending/);
  assert.match(canonicalMigration, /replace\(definition,'public\.ph_request_history','public\.ph_requests_completed_history'\)/);
  assert.match(canonicalMigration, /recipient_emails jsonb not null default '\[\]'::jsonb/);
  for (const field of ['status', 'request_qty', 'effective_qty', 'is_default_qty', 'line_dollar_value',
    'request_spec', 'request_caliper', 'flag_color', 'ns_grade', 'ld_flag', 'hold_stop_since']) {
    assert.match(canonicalMigration, new RegExp(`add column if not exists ${field}\\b`));
  }
  assert.match(canonicalMigration, /set local session_replication_role='replica'[^]*set local session_replication_role='origin'/);
  assert.match(cleanupMigration, /drop view if exists public\.ph_request_queue_live_rows/);
  assert.match(cleanupMigration, /drop table if exists public\.ph_request_sales_impact_ledger cascade/);
  assert.match(cleanupMigration, /private\.ph_request_folder_delivery_state/);
  assert.match(cleanupMigration, /LEGACY_REQUEST_FUNCTION_REFERENCE_REMAINED/);
  for (const relation of ['ph_00_table_directory', 'ph_active_request', 'ph_request_history',
    'ph_active_drive_mode', 'ph_drive_mode_history', 'ph_active_location_moves',
    'ph_location_moves_history', 'ph_active_recount', 'ph_recount_history',
    'ph_active_eval_work', 'ph_eval_work_history', 'ph_delivery_outbox']) {
    assert.match(uniformMigration, new RegExp(`public\\.${relation}\\b`));
  }
  assert.match(uniformMigration, /ph_requests_pending_sales_request_only_v2363[^]*unique_id not like 'move_req_%'[^]*unique_id not like 'EVAL-%'/);
  assert.match(uniformMigration, /ph_active_request_retirement_v2361[^]*2026-10-22 00:00:00 America\/Chicago[^]*request_completed[^]*ph_active_request/);
  assert.match(uniformMigration, /ph_location_moves_history[^]*ph_eval_work_history[^]*delete from public\.ph_requests_pending[^]*delete from public\.ph_requests_completed_history/);
  assert.match(uniformMigration, /canonical-active-history-v2363/);
  assert.doesNotMatch(uniformMigration, /\bdrop\s+table\b|\btruncate\s+table\b/i);
  for (const field of ['customer', 'consignee', 'qty', 'measure_spec', 'comments']) {
    assert.match(browserCompatibilityMigration, new RegExp(`add column if not exists ${field}\\b`));
  }
  for (const view of ['ph_active_request', 'ph_active_request_live_rows', 'ph_request_queue_live_rows', 'ph_request_history']) {
    assert.match(browserCompatibilityMigration, new RegExp(`view public\\.${view} with \\(security_invoker = false\\)`));
  }
  assert.match(browserCompatibilityMigration, /grant execute on function public\.guard_active_app_session_v1\(\) to anon/);
  assert.match(browserCompatibilityMigration, /least\([^]*greatest\(0, p_current_on_hand\)[^]*p_initial_photo_match_qty - greatest/);
  assert.match(browserCompatibilityMigration, /select public\.reconcile_inventory_location_evidence_v1\(\)/);
  assert.doesNotMatch(browserCompatibilityMigration, /\bdrop\s+table\b|\btruncate\s+table\b/i);
  assert.match(evidenceCompatibilityMigration, /get_request_drive_evidence_health_snapshot_v1[^]*location_evidence_updated_at >= completion\.completed_at/);
  assert.match(evidenceCompatibilityMigration, /location_evidence_cleared_at is not null[^]*location_evidence_current_photo_match_qty, 0\) <= 0/);
  assert.match(evidenceCompatibilityMigration, /guard_enabled boolean:=coalesce\(current_setting\('gnc\.inventory_location_evidence_apply',true\),''\)='on'/);
  assert.match(evidenceCompatibilityMigration, /evidence\.cleared_at is null[^]*coalesce\(canonical_current,0\)>0/);
  assert.doesNotMatch(evidenceCompatibilityMigration, /\bdrop\s+table\b|\btruncate\s+table\b/i);
}

function requestCommandChecks(runFunctions, functionSource) {
  const finalize = functionSource('assets/app-runtime.js', 'finalizeRequestAction');
  const submit = functionSource('assets/request-folder-choice.js', 'submitRequestCreateBatch');
  assert.match(finalize, /return submitRequestCreateBatch\(/);
  assert.match(submit, /buildRequestCreateRow\(/);
  const submitSource = ['buildRequestCreateRow', 'buildRequestCreateEvidence', 'buildRequestCreateMetrics']
    .map(name => functionSource('assets/request-folder-choice.js', name)).join('\n');
  for (const field of ['recipient_emails', 'request_qty', 'effective_qty', 'is_default_qty', 'line_dollar_value',
    'request_spec', 'request_caliper', 'flag_color', 'ns_grade', 'ld_flag', 'hold_stop_since']) {
    assert.match(submitSource, new RegExp(`${field}:`));
  }
  const tabSource = functionSource('assets/app-runtime.js', 'setReqTab');
  assert.match(tabSource, /nextTab === 'pending'[^]*forcePendingRequestRoot\(\{ deferCategoryCounts: true \}\)[^]*runDirectTrackedNavigation/);
  assert.match(tabSource, /delay:\s*0[^]*forceRender:\s*true[^]*yieldToPaint:\s*true[^]*interactiveCritical:\s*true/);
  const tabEvents = [];
  let tabContext;
  tabContext = runFunctions('assets/app-runtime.js', ['setReqTab'], {
    activeReqTab: 'recount', requestSalesRepsManagerMode: false, lastViewSwitchAt: 0,
    activeLocationMoveQueDetailUid: 'move', activeLocationWorkJobId: 'job', activeShearQueDetailId: 'shear',
    activeAvOptionEvalDetailId: 'eval', activeEvalWorkDetailId: '', requestViewLevel: 2,
    selectedReqFolder: 'folder', selectedReqRepView: null, selectedReqCustView: null,
    selectedReqConsigneeView: null, selectedReqFolderView: null, requestFolderSearchTerm: '',
    requestRepSearchTerm: '', requestCustomerSearchTerm: '', requestConsigneeSearchTerm: '',
    requestFolderDateFilter: '', requestDylanFilterMode: 'all', requestDylanFilterValue: '',
    requestDylanSalesRepValue: '', requestDylanFilterMenuOpen: '',
    window: { BunchNote: { disposeView() {} }, BunchQueueShell: { isTab: () => false } },
    Date, normalizeRequestTabValue: value => value === 'pending' ? 'pending' : value,
    getAuthorizedRequestCategories:()=>['pending'],showToast(){},
    navTransitionSeq: 1, resetQueueReadCooldowns() {}, unsubscribeEvalWorkRealtime() {}, subscribeEvalWorkRealtime() {},
    forcePendingRequestRoot() { tabContext.activeReqTab = 'pending'; tabContext.requestViewLevel = 0; tabEvents.push('root'); },
    syncRequestTabButtons() {}, isViewVisible: () => true,
    renderViewContent() { tabEvents.push(`render:${tabContext.activeReqTab}:${tabContext.requestViewLevel}`); },
    runDirectTrackedNavigation(view, key, callback) {
      assert.equal(view, 'request');
      assert.equal(key, 'request-tab:pending');
      callback();
      tabContext.renderViewContent();
      return true;
    },
    scheduleQueCategoryRefresh(tab, seq) { tabEvents.push(`refresh:${tab}:${seq}`); },
    clearSelection() {}, scheduleRequestRenderSideData() { tabEvents.push('hydrate'); }, forceRefreshRequestsForView: async () => true,
    loadRequestArchivePage: async () => true, loadEvalWorkAssignments: async () => true,
    switchView() { throw new Error('unexpected view'); }
  });
  assert.equal(tabContext.setReqTab('pending'), true);
  assert.deepEqual(tabEvents, ['root', 'render:pending:0', 'hydrate', 'refresh:pending:1']);
  tabContext.getAuthorizedRequestCategories=()=>[];
  assert.equal(tabContext.setReqTab('pending'),false);
  assert.deepEqual(tabEvents, ['root', 'render:pending:0', 'hydrate', 'refresh:pending:1']);
  assert.match(functionSource('assets/app-runtime.js', 'renderRequest'), /request_queue_row_render_failed[^]*renderRequestQueueFallbackCard/);
  assert.match(functionSource('assets/app-runtime.js', 'isReadyRequestDataForAutoComplete'), /effectiveSpec[^]*effectiveLocPhotoMatch[^]*<= 0/);
  assert.match(functionSource('assets/app-runtime.js', 'isPhotoDateMsExpired'), /getDate\(\) \+ retentionDays \+ 1/);
}

export function requestLifecycleContract(runFunctions,locationContext,functionSource,read) {
  requestVisibilityChecks(runFunctions,locationContext,functionSource);
  historicalRecoveryChecks(read);
  canonicalMigrationChecks(read);
  requestCommandChecks(runFunctions,functionSource);
}
