import assert from 'node:assert/strict';
import vm from 'node:vm';

function inspectExactQueueIdentity(read) {
  const helperContext = vm.createContext({});
  vm.runInContext(read('assets/queue-inventory-hydration.js'), helperContext);
  const rows = [
    { UNIQUE_ID: 'exact', ITEMCODE: '004380.010.1', LOCATIONCODE: 'B.04.000', LOTCODE: '27.F1', PRIORITY:'1', PTRONHAND: 5, PTRREVIEWED: 1, PTRAVAILABLE: 4, S_LTS: -2, LOC_MATCH_QTY: 3, LOC_ON_HAND: 25 },
    { UNIQUE_ID: 'other-lot', ITEMCODE: '004380.010.1', LOCATIONCODE: 'B.04.000', LOTCODE: '27.S1', PTRONHAND: 20, PTRREVIEWED: 2, PTRAVAILABLE: 18, S_LTS: 91 },
    { UNIQUE_ID: 'other-location', ITEMCODE: '004380.010.1', LOCATIONCODE: 'E.12.000', LOTCODE: '27.F1', PTRONHAND: 400, PTRREVIEWED: 5, PTRAVAILABLE: 395, S_LTS: 700 },
  ];
  const index = helperContext.AgMetricQueueInventory.createIndex(rows);
  const exactDisplay = index.resolveSuspendTagDisplay({ itemcode: '004380.010.1', locationcode: 'B.04.000', lotcode: '27.F1', masterUid:'exact' });
  assert.equal(exactDisplay.matchLevel, 'exact-row');
  assert.equal(exactDisplay.row.PTRONHAND, 5);
  assert.equal(exactDisplay.row.S_LTS, -2);
  assert.equal(exactDisplay.row.LOC_ON_HAND, 25, 'location total sums only the requested physical location');
  assert.equal(index.resolveSuspendTagDisplay({ itemcode: '004380.010.1', locationcode: 'C.01.000', lotcode: '27.F1' }).status, 'missing',
    'same-lot inventory at another location is not a fallback');
  const noLot = index.resolveSuspendTagDisplay({ itemcode:'004380.010.1', locationcode:'B.04.000' });
  assert.equal(noLot.status, 'missing', 'incomplete identity cannot authorize a physical row');
  assert.equal(index.resolveSuspendTagDisplay({ itemcode: '004380.010.1', locationcode: '00.000.111', lotcode: '27.F1' }).status, 'missing');

  return rows;
}

function inspectExactQueueMetrics(rows, runFunctions) {
  const exactMaster = rows[0];
  const sink = {};
  const context = runFunctions('assets/app-runtime.js', ['isFalseBlockLocation', 'normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
    resolveLiveInventoryForCard: () => null, getQueueDisplayEvidenceRow: () => null,
    window: { AgMetricQueueInventory: { identity: row => ({ itemCode:row.ITEMCODE, locationCode:row.LOCATIONCODE, lotCode:row.LOTCODE }) } },
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    isDockSuspendDcRequestMirrorRow: item => item?.isSuspend === true,
    findDockSuspendDcRequestSourceRow: item => item,
    getSuspendTagInventoryIdentity: item => item,
    getQueueCardInventoryState: () => ({ status: 'unavailable', row: null }),
    getQueueCardInventoryAuthorizationContext: () => ({ readScope: 'actor', scope: 'actor', permission: 'v1' }),
    getDatasetState: () => ({ initialLoaded: true, rowCompleteness: 'complete', liveVerifiedScope: 'actor', liveVerifiedPermission: 'v1' }),
    masterInventoryLookup: { resolve: () => ({ status: 'ready', row: exactMaster }) },
    fullInventory: rows,
    getSuspendTagMetricDisplayFallback: () => null,
    buildInventoryQuantityChipsHtml: row => { sink.row = row; return ''; },
  });
  const card = { isSuspend: true, ITEMCODE: exactMaster.ITEMCODE, LOCATIONCODE: exactMaster.LOCATIONCODE, LOTCODE: exactMaster.LOTCODE,
    suspend_tag_metrics: { PTRONHAND: 999, PTRREVIEWED: 0, PTRAVAILABLE: 999, OPEN_STOCK: 999, LOC_ON_HAND: 999, LOC_MATCH_QTY: 999 } };
  context.buildQueueInventoryMetricsHtml(card, 'request');
  assert.deepEqual([sink.row.PTRONHAND, sink.row.PTRREVIEWED, sink.row.PTRAVAILABLE, sink.row.OPEN_STOCK,
    sink.row.LOC_MATCH_QTY, sink.row.LOC_ON_HAND], [5, 1, 4, -2, 3, 25],
  'complete exact master data wins over conflicting enriched server metrics');
  const exactZeroMetrics = context.normalizeRequestCardMetrics({
    PTRONHAND: 0, PTRREVIEWED: 30, PTRAVAILABLE: 5, S_LTS: -2, LOC_ON_HAND: 2046,
    ON_HAND: 125, REVIEW: 120, AVAILABLE: 0
  });
  assert.deepEqual([exactZeroMetrics.PTRONHAND, exactZeroMetrics.PTRREVIEWED, exactZeroMetrics.PTRAVAILABLE,
    exactZeroMetrics.S_LTS, exactZeroMetrics.LOC_ON_HAND], [0, 30, 5, -2, 2046],
  'exact PTR values beat stale aliases and zero On Hand is never inferred');
  return { context, card, sink };
}

function inspectSuspendAliases(read, runFunctions, context, card, sink) {
  const domain = {}; vm.runInNewContext(read('assets/dock-order-domain.js'), domain);
  const quantityAliasContext = runFunctions('assets/app-runtime.js', ['syncDockSuspendDcRequestQuantityAliases'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? null,
    isDockSuspendDcRequestMirrorRow: () => true, applyDockSuspendQuantityAliases: domain.applyDockSuspendQuantityAliases
  });
  const mirrorWithDefaultZero = { PTRONHAND: 0, PTRREVIEWED: 0, PTRAVAILABLE: 0, S_LTS: 0 };
  quantityAliasContext.syncDockSuspendDcRequestQuantityAliases(mirrorWithDefaultZero, {
    IS_SUSPEND_TAG: true, ON_HAND: 125, REVIEW: 120, AVAILABLE: 5, OPEN_STOCK: -2
  });
  assert.deepEqual([mirrorWithDefaultZero.PTRONHAND, mirrorWithDefaultZero.PTRREVIEWED,
    mirrorWithDefaultZero.PTRAVAILABLE, mirrorWithDefaultZero.S_LTS], [125, 120, 5, -2],
  'active Suspend exact view aliases replace default zero compatibility fields before hydration');
  context.buildQueueInventoryMetricsHtml({ ...card, LOCATIONCODE: '0.00.111' }, 'request');
  assert.deepEqual([sink.row.PTRONHAND, sink.row.PTRREVIEWED, sink.row.PTRAVAILABLE, sink.row.OPEN_STOCK,
    sink.row.LOC_MATCH_QTY, sink.row.LOC_ON_HAND], [0, 0, 0, 0, 0, 0],
  'False Block overrides every server metric alias');

}

function inspectQueueFallbacks(runFunctions, card) {
  let rejectedPayloadRow;
  const unavailableContext = runFunctions('assets/app-runtime.js', ['isFalseBlockLocation', 'normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
    resolveLiveInventoryForCard: () => null, getQueueDisplayEvidenceRow: () => null,
    window: {}, firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    isDockSuspendDcRequestMirrorRow: item => item?.isSuspend === true, findDockSuspendDcRequestSourceRow: item => item,
    getSuspendTagInventoryIdentity: item => item,
    getQueueCardInventoryState: () => ({ status:'loading', row:null }),
    getQueueCardInventoryAuthorizationContext: () => null, getDatasetState: () => null,
    getSuspendTagMetricDisplayFallback: () => null,
    buildInventoryQuantityChipsHtml: (row, options) => { rejectedPayloadRow = { row, options }; return ''; }
  });
  unavailableContext.buildQueueInventoryMetricsHtml({ ...card, suspend_tag_metrics: {
    MATCH_LEVEL: 'item', PTRONHAND: 999, PTRREVIEWED: 0, PTRAVAILABLE: 999, OPEN_STOCK: 999, LOC_ON_HAND: 999, LOC_MATCH_QTY: 999
  } }, 'request');
  assert.equal(rejectedPayloadRow.row.PTRONHAND, undefined, 'item-only server enrichment is not painted while exact hydration is pending');
  assert.equal(rejectedPayloadRow.row.OPEN_STOCK, undefined);
  assert.equal(rejectedPayloadRow.options.hydrationStatus, '', 'invalid enrichment stays an unknown/N/A state');

  const metadataContext = runFunctions('assets/app-runtime.js', ['syncDockSuspendCardMasterSummaryFields'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? null
  });
  const metadataRow = { PRIORITY: 1, HOLDSTOPREASON: 'stale', SPEC: 'stale spec', PHOTO_LINK: 'stale photo', PHOTO_DATE: 'stale date' };
  metadataContext.syncDockSuspendCardMasterSummaryFields(metadataRow, {
    priority: 4, holdstopreason: 'current hold', spec: 'current spec', photo_url: 'current photo', photo_date: '2026-10-27'
  });
  assert.deepEqual([metadataRow.PRIORITY, metadataRow.HOLDSTOPREASON, metadataRow.SPEC, metadataRow.PHOTO_LINK, metadataRow.PHOTO_DATE],
    [4, 'current hold', 'current spec', 'current photo', '2026-10-27'], 'exact master metadata replaces stale queue summaries');
}

export function queueInventoryExactContract({read, runFunctions}) {
  const rows = inspectExactQueueIdentity(read);
  const { context, card, sink } = inspectExactQueueMetrics(rows, runFunctions);
  inspectSuspendAliases(read, runFunctions, context, card, sink);
  inspectQueueFallbacks(runFunctions, card);
}
