import assert from 'node:assert/strict';

function displayQueueContract(runFunctions) {
  const samples = [
    [String.raw`Alexander\'s Great Siberian Bugloss`, "Alexander's Great Siberian Bugloss"],
    [String.raw`Alice \\'N Wonderland Dwarf Oakleaf Hydrangea`, "Alice 'N Wonderland Dwarf Oakleaf Hydrangea"],
    [String.raw`Endless Summer® Twist N\\\' Shout® Hydrangea`, "Endless Summer® Twist N' Shout® Hydrangea"],
  ];
  const runtime = runFunctions('assets/app-runtime.js', ['normalizeEscapedDisplayText', 'normalizeSearchValue']);
  const appsScript = runFunctions('Code.gs', ['normalizeEscapedImportText_', 'normalizeEscapedImportRow_', 'canonicalizeMasterBulkPayloadValue_']);
  const api = runFunctions('supabase/functions/app-api/index.ts', [
    'escapedDisplayTextFieldKey', 'normalizeEscapedDisplayText', 'normalizeEscapedDisplayPayload', 'escapedDisplayTextJsonReplacer'
  ], { ESCAPED_DISPLAY_TEXT_FIELDS:new Set(['commonname', 'reqsalesnote']) });
  for (const [escaped, clean] of samples) {
    assert.equal(runtime.normalizeEscapedDisplayText(escaped), clean);
    assert.equal(runtime.normalizeSearchValue(escaped), runtime.normalizeSearchValue(clean));
    assert.equal(appsScript.normalizeEscapedImportText_(escaped), clean);
    assert.equal(api.normalizeEscapedDisplayText(escaped), clean);
  }
  assert.equal(appsScript.canonicalizeMasterBulkPayloadValue_({ commonname:samples[1][0] }).commonname, samples[1][1]);
  const inbound = { request:{ commonname:samples[2][0], req_sales_note:String.raw`Customer said \"hold\"` }, untouched:String.raw`C:\Plants` };
  api.normalizeEscapedDisplayPayload(inbound);
  assert.equal(inbound.request.commonname, samples[2][1]);
  assert.equal(inbound.request.req_sales_note, 'Customer said "hold"');
  assert.equal(inbound.untouched, String.raw`C:\Plants`);
  assert.equal(JSON.parse(JSON.stringify({ COMMONNAME:samples[0][0] }, api.escapedDisplayTextJsonReplacer)).COMMONNAME, samples[0][1]);

}

function queueCompatibilityContract(runFunctions) {
  const queue = runFunctions('assets/app-runtime.js', ['hasConfirmedRequestCompletion','isRequestPendingVisible', 'buildPendingRequestRenderPlan'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    normalizeRequestStatus: value => String(value || '').trim(), isTruthishHistoryValue: value => value === true,
    isRequestVisibleForCurrentUser: () => true, isMoveRequestRow: () => false,getQueueCompletionState:()=>null, optimisticCompletedRowIds:new Set(),
    matchesQueHeaderSearch: () => true, refreshVisiblePendingRequestDelivery() {},
    applyInventoryExcelFilters: undefined, rememberOperationalExport: undefined,
    hasCompletionDateValue: item => Boolean(item?.DATE_COMPLETED || item?.date_completed), isRegularRequestQueueItem: () => true,
    compareLocationCodeValues: () => 0, naturalCompare: () => 0, getItemUniqueId: item => item.UNIQUE_ID,
    buildRequestPagedRenderPlan: (mode, crumbText, items) => ({ empty:!items.length, mode, crumbText, items, rows:items }),
  });
  const pendingRows = [
    { UNIQUE_ID:'pending-1', REQ_STATUS:'Pending', DATE_COMPLETED:null, REQ_QTY:'1', LOCATIONCODE:'D.09.013', LOTCODE:'27.F1' },
    { UNIQUE_ID:'pending-25', STATUS:'Pending', DATE_COMPLETED:null, QTY:25, LOCATIONCODE:'D.09.044', LOTCODE:'27.F1', REQUEST_FOLDER:'delivered-folder' },
    { UNIQUE_ID:'pending-null', STATUS:'Pending', DATE_COMPLETED:null, REQUEST_QTY:null, LOCATIONCODE:'F.05.000', LOTCODE:'27.F1' },
  ];
  assert.equal(pendingRows.every(queue.isRequestPendingVisible), true);
  assert.equal(queue.buildPendingRequestRenderPlan(pendingRows).rows.length, 3);

  const compatibility = runFunctions('assets/app-runtime.js', ['normalizeRequestBrowserCompatibilityRow'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
  });
  const compatibleRow = compatibility.normalizeRequestBrowserCompatibilityRow({
    CUSTOMER:'Legacy Customer', CONSIGNEE:'Legacy Consignee', QTY:25, MEASURE_SPEC:'5 ft',
    REQUEST_CALIPER:'2 in', COMMENTS:'Legacy note', DATE_COMPLETED:null,
  });
  assert.equal(compatibleRow.CUSTOMER_NAME, 'Legacy Customer');
  assert.equal(compatibleRow.CONSIGNEE_NAME, 'Legacy Consignee');
  assert.equal(compatibleRow.REQUEST_QTY, 25);
  assert.equal(compatibleRow.REQUEST_SPEC, '5 ft');
  assert.equal(compatibleRow.REQUEST_NOTES, 'Legacy note');

  const depletion = runFunctions('assets/app-runtime.js', ['getDepletedLocPhotoMatchQtyValue'], {
    parseAppNumber: value => value === null || value === undefined || value === '' ? null : Number(value),
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    findLinkedMasterRow: () => null,
  });
  assert.equal(depletion.getDepletedLocPhotoMatchQtyValue({ PTRONHAND:25, BASELINE_ON_HAND:250, INITIAL_PHOTO_MATCH_QTY:125 }, 125), 0);
  assert.equal(depletion.getDepletedLocPhotoMatchQtyValue({ PTRONHAND:25 }, 125), 25);

}

function staticContracts(read,functionSource) {  const migration = read('supabase/migrations/20261024070000_escaped_display_text_normalization_v1.sql');
  for (const marker of ['normalize_escaped_display_text_v1', 'a000_normalize_escaped_display_text_v1',
    'ph_master_inventory', 'ph_active_request', 'ph_request_history', 'ph_soc_master', 'ph_reserves', 'ph_cav_import']) assert.match(migration, new RegExp(marker));
  assert.match(read('supabase/migrations/20261024203000_unified_request_sync_sales_impact_v1.sql'), /zero_cross_request_dedupe_v1/);
  assert.match(read('supabase/functions/app-api/index.ts'), /\["request_queue", "active_request"\]\.includes\(dataset\)\) query\.set\("date_completed", "is\.null"\)/);
  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(appApi, /function normalizeRequestBrowserCompatibilityRow[^]*customer:[^]*customer_name:[^]*qty:[^]*request_qty:/);
  assert.match(appApi, /keys\.length > 64[^]*dataset_revisions_for_actor_v1/);
  assert.doesNotMatch(functionSource('supabase/functions/app-api/index.ts', 'handleDatasetRevisionsAction'), /allowedKeys/);
  const browserVerifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['headless: true', '#footer-request-btn', 'data-request-category="pending"',
    'No pending requests.', 'Oakland® Red Holly', 'Sunburst® Honeylocust', 'homeMetadataMs']) assert.match(browserVerifier, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

export function escapedTextContract(runFunctions,read,functionSource) {
  displayQueueContract(runFunctions);
  queueCompatibilityContract(runFunctions);
  staticContracts(read,functionSource);
}
