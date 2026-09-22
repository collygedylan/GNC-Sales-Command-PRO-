import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const registryCode = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');
const demandDetailCode = readFileSync(new URL('../assets/drive-demand-detail.js', import.meta.url), 'utf8');
// Extract real top-level functions without copying implementation into the test.
function functionSource(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `Production function ${name} not found`);
  const tail = html.slice(start + 1);
  const next = /\r?\n        (?:async )?function [A-Za-z_$][\w$]*\(/.exec(tail);
  assert.ok(next, `End of ${name} not found`);
  return html.slice(start, start + 1 + next.index);
}
const renderSource = functionSource('renderViewContent');
const routes = [...new Set([
  ...[...renderSource.matchAll(/viewId === '([^']+)'/g)].map(match => match[1]),
  ...[...html.matchAll(/id="view-([a-z-]+)"/g)].map(match => match[1]).filter(id => id !== 'wrapper')
])];

function harness() {
  const context = {
    window: {}, console, Date, JSON, Map, Set, String, Number, Array, Object,
    canUseProductionLiveSync: () => true,
    currentUser: 'fixture', currentRole: 'ADMIN', activeReqTab: 'pending', activeHomeTab: 'orders',
    activeMovesTab: 'office', activeInventoryOfficeApprovalType: 'crop-roll', activeAVTab: 'open',
    activeTaskView: 'flyer', cropRollDriveSchemaReady: true, inventoryMainTab: 'sales', productionInventoryTab: 'counting',
    productionWorkflowActive: 'spacing', selectedProductivityUser: '', requestDeliveryRecoveryOpen: false,
    activeDetailTab: '', activeDetailSourceView: '', activeItem: null, activeLocationWorkJobId: '', managersSearchTerm: '', evalRole: false,
    poManagementState: { season: '27F1' },
    managerOrdersState: { rows: [], batches: [], selectedAssigneeKeys: new Set() },
    bloomscapesPendingState: { orders: [] }, inventoryTransactionHistoryState: {},
    managerTransactionsKeyedState: { allDates: [], files: [] },
    managerHistoricalReportState: { rows: [], selectedColumns: [] }, accessControlAdminState: {}, codexOpsState: {},
    document: { getElementById: () => null },
    getCurrentVisibleViewId: () => context.view,
    getCurrentLoginCacheScopeKey: () => 'fixture-user', getCurrentChatUsername: () => 'fixture',
    getActiveSpreadCountType: () => 'spread', normalizeProductivityUsername: value => value,
    normalizeInventoryOfficeApprovalType: value => value,
    getRoleAccessState: () => ({ isAdmin: !context.evalRole, isEval: context.evalRole, isRep: false }),
    isAlwaysDriveCardOptionsUser: () => false,
    getActiveEvalSimpleTaskFilterValue: () => context.activeTaskView,
    isInventoryChecksApprovalTaskView: value => value === 'inventory-checks',
    isTaskDiagnosticsView: () => false, isManagerApprovalTab: () => false,
    isInventoryOfficeBlankShellTab: () => false, isCropRollManagerReviewActive: () => false,
    shouldUseRepAvOpenDataset: () => true, shouldPrepareAvRepCustomerFilterData: () => true,
    canAccessView: () => false, canManageRequestDeliveryRecovery: () => false,
    canUseWeatherHoldRiskTools: () => false, canViewBloomscapesPendingOrders: () => false,
    canViewDriveCustomerConsigneeRows: () => true
  };
  for (const match of html.matchAll(/const (MANAGER_[A-Z0-9_]+_VIEW) = '([^']+)';/g)) context[match[1]] = match[2];
  vm.createContext(context);
  vm.runInContext(registryCode, context);
  vm.runInContext(demandDetailCode, context);
  context.window.AgMetricLiveSyncRegistry = context.AgMetricLiveSyncRegistry;
  context.window.AgMetricDriveDemandDetail = context.AgMetricDriveDemandDetail;
  for (const name of ['shouldLoadInventoryEditRequestsForEvalRows', 'withEvalInventoryEditRequestsForRowView',
    'normalizePoManagementText', 'normalizePoManagementSeason', 'getRequestViewLoadingConfig', 'getViewLoadingConfig', 'getDriveDemandContext', 'getProductionLiveSyncSideContext']) {
    vm.runInContext(functionSource(name), context);
  }
  return context;
}

test('every rendered route and root DOM view has an explicit registry classification', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  assert.ok(routes.length >= 35, 'Route discovery unexpectedly became empty or incomplete');
  for (const route of routes) assert.ok(registry.views[route], `Unclassified real route: ${route}`);
  for (const id of ['sales', 'qc', 'production', 'office', 'disease-pest']) assert.equal(registry.views[id].kind, 'navigation');
  assert.equal(registry.views.hours.kind, 'static');
});

test('actual loader dependencies remain covered for every route, request tab, task state and Eval role', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  const requestTabs = [...new Set([...functionSource('renderRequest').matchAll(/activeReqTab === '([^']+)'/g)].map(match => match[1]))];
  const taskViews = [...new Set([...functionSource('getViewLoadingConfig').matchAll(/activeTaskView === '([^']+)'/g)].map(match => match[1]))];
  const managerTabs = [...new Set(['orders', 'moves', 'inventory-checks', ...Object.keys(context).filter(key => key.startsWith('MANAGER_') && key.endsWith('_VIEW')).map(key => context[key])])];
  const missing = new Set();
  for (const route of routes) {
    const states = route === 'request' ? requestTabs.map(tab => ({ activeReqTab: tab }))
      : route === 'tasks' ? taskViews.map(tab => ({ activeTaskView: tab }))
      : route === 'managers' ? managerTabs.flatMap(tab => ['office', 'moves'].map(mode => ({ activeHomeTab: tab, activeMovesTab: mode })))
      : route === 'moves' ? ['office', 'moves'].map(tab => ({ activeMovesTab: tab }))
      : route === 'sales-inventory' ? ['sales', 'production'].flatMap(inventoryMainTab => ['counting', '84rd'].map(productionInventoryTab => ({ inventoryMainTab, productionInventoryTab })))
      : route === 'av' ? ['open', 'reserves'].map(tab => ({ activeAVTab: tab })) : [{}];
    for (const state of states) for (const evalRole of [false, true]) {
      Object.assign(context, state, { view: route, evalRole });
      const loaded = context.getViewLoadingConfig(route);
      const activeContext = context.getProductionLiveSyncSideContext();
      if (route === 'sales-inventory') assert.equal(activeContext.surfaces.includes('sales-inventory:counting'),
        state.inventoryMainTab === 'production' && state.productionInventoryTab === 'counting',
        `Only visible counting content registers count dependencies: ${JSON.stringify(state)}`);
      // Footer badges remain visible on every authenticated screen. Also cover
      // each data-bearing dialog that can be opened over a routed screen.
      for (const dialog of ['', ...Object.keys(registry.surfaces).filter(key => key.startsWith('dialog:'))]) {
        const surfaces = [...new Set([...activeContext.surfaces, 'badge:queue', 'badge:communications', ...(dialog ? [dialog] : [])])];
        const keys = registry.getSourceKeys(registry.getViewAdapters(route, { ...activeContext, surfaces }));
        assert.ok(keys.length <= 64, `${route} ${JSON.stringify(state)}${evalRole ? ' Eval' : ''} ${dialog}: ${keys.length} revision keys exceed the API cap`);
      }
      if (!loaded) continue;
      const declared = new Set(registry.getCoreKeys(route, activeContext));
      for (const item of [...loaded.required || [], ...loaded.background || []]) {
        if (!declared.has(item.key)) missing.add(`${route} ${JSON.stringify(state)}${evalRole ? ' Eval' : ''}: ${item.key}`);
      }
    }
  }
  assert.deepEqual([...missing], [], `Actual production loaders are not covered:\n${[...missing].join('\n')}`);
});

test('every implemented request subview has an explicit surface instead of silently falling through', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  const tabs = [...new Set([...functionSource('renderRequest').matchAll(/activeReqTab === '([^']+)'/g)].map(match => match[1]))];
  assert.ok(tabs.includes('reps') && tabs.includes('suspend-tag'));
  for (const tab of tabs) assert.ok(registry.surfaces[`request:${tab}`], `Unclassified Que surface request:${tab}`);
});

test('Pending requests verifies only its queue cohort while every other request tab keeps its joins', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:pending'] })),
    ['core:requests', 'side:settings']);
  const expected = {
    'request:reps': ['core:requests', 'core:master', 'core:customerRepMap', 'core:requestHistory', 'core:salesCredits', 'side:settings'],
    'request:suspend-tag': ['core:requests', 'core:master', 'core:customerRepMap', 'core:soc', 'side:settings'],
    'request:eval-work': ['core:requests', 'core:master', 'core:customerRepMap', 'side:evalWork', 'side:settings'],
    'request:av-check': ['core:requests', 'core:master', 'core:customerRepMap', 'side:avOptionEval', 'side:settings'],
    'request:moves': ['core:requests', 'core:master', 'core:customerRepMap', 'core:inventoryEditRequests', 'side:locationWork', 'side:settings'],
    'request:recount': ['core:requests', 'core:master', 'core:customerRepMap', 'core:salesOffice', 'side:ncr', 'side:settings'],
    'request:shear-list': ['core:requests', 'core:master', 'core:customerRepMap', 'core:reserves', 'side:shear', 'side:settings'],
    'request:shear-test': ['core:requests', 'core:master', 'core:customerRepMap', 'core:reserves', 'core:inventoryEditRequests', 'side:shear', 'side:settings'],
  };
  for (const [surface, adapters] of Object.entries(expected)) {
    assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: [surface] })), adapters, surface);
  }
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:bunch-notes'] })), ['side:bunchNotes']);
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:pending', 'dialog:request'] })),
    ['core:requests', 'core:master', 'core:reserves', 'core:customerRepMap', 'side:settings']);
});

test('demand revision surfaces are Drive-detail-only and do not alter AV detail loading', () => {
  const context = harness();
  Object.assign(context, {
    view: 'detail', activeDetailTab: 'customer', activeItem: { itemcode: 'SYNTH.003', season: 'F1', saleyear: '27' }
  });
  context.activeDetailSourceView = 'drive';
  assert.ok(context.getProductionLiveSyncSideContext().surfaces.includes('detail:reserves'));
  context.activeDetailSourceView = 'av';
  assert.ok(!context.getProductionLiveSyncSideContext().surfaces.some((surface) => surface.startsWith('detail:')),
    'AV keeps its existing detail path and never starts a Drive demand read');
});

test('NCR completion indexes used to remove completed rows participate in review freshness', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  for (const [view, builder] of [['review', 'ensureManagerReviewInventoryBuilt'], ['move-up', 'ensureMoveUpInventoryBuilt']]) {
    assert.match(functionSource(builder), /ensureNcrCompletionIndexLoaded/);
    assert.ok(registry.getViewAdapters(view).includes('side:ncr'), `${view} must track its NCR completion source`);
  }
});

test('Drive verifies its displayed stock without waiting for unopened detail sources', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  assert.deepEqual(Array.from(registry.getViewAdapters('drive')), ['core:master', 'side:settings']);
  const assigned = registry.getViewAdapters('drive', { driveAssignmentsRequired: true, evalInventoryRows: true });
  assert.ok(assigned.includes('core:warehouseAssignedItems'));
  assert.ok(assigned.includes('core:inventoryEditRequests'));
  for (const id of ['core:reserves', 'core:avNotes']) assert.ok(!assigned.includes(id));
  assert.ok(registry.getViewAdapters('drive', { surfaces: ['dialog:av-notes'] }).includes('core:avNotes'));
});

test('Tasks verifies each selected category including empty-key fallbacks and joined reserves', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  const base = Array.from(registry.getCoreKeys('tasks'));
  assert.deepEqual(base, ['master', 'requests', 'salesOffice', 'warehouseAssignedItems']);
  for (const [taskView, extra] of [
    ['flyer', ['flyerRows', 'flyerHistory']], ['hot-price', ['avHotPriceKeys']],
    ['av-blanks', ['cavAvBlankKeys', 'cav']], ['reserves', ['reserves', 'customerRepMap']]
  ]) assert.deepEqual(Array.from(registry.getCoreKeys('tasks', { taskView })), [...base, ...extra]);
  assert.ok(registry.getCoreKeys('tasks', { taskView: 'eval', taskFilter: 'av-blanks' }).includes('cav'));
  assert.ok(registry.getCoreKeys('tasks', { taskView: 'eval', taskFilter: 'hot-price-ssn' }).includes('avHotPriceKeys'));
});

test('Drive detail defers its source panels while AV and Docks retain their complete joins', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  assert.deepEqual(Array.from(registry.getCoreKeys('detail', { driveDetail: true })), ['master']);
  assert.deepEqual(Array.from(registry.getCoreKeys('detail')), ['master', 'reserves', 'avNotes']);
  const demand = registry.getViewAdapters('detail', { driveDetail: true, surfaces: ['detail:reserves'] });
  assert.ok(demand.includes('side:driveReserves'));
  assert.ok(!demand.includes('core:reserves'));
  assert.deepEqual(Array.from(registry.getViewAdapters('docks')), ['core:soc', 'core:master', 'core:customerRepMap', 'side:dockWorkflow', 'side:settings']);
});
