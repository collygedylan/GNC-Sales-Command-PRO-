import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const registryCode = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');
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
    currentUser: 'fixture', currentRole: 'ADMIN', activeReqTab: 'pending', activeHomeTab: 'orders',
    activeMovesTab: 'office', activeInventoryOfficeApprovalType: 'crop-roll', activeAVTab: 'open',
    activeTaskView: 'flyer', activeSalesOfficeTab: 'season', cropRollDriveSchemaReady: true, productionInventoryTab: 'counting',
    productionWorkflowActive: 'spacing', selectedProductivityUser: '', requestDeliveryRecoveryOpen: false,
    activeDetailTab: '', activeDetailSourceView: '', activeLocationWorkJobId: '', managersSearchTerm: '', evalRole: false,
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
    getActiveEvalSimpleTaskFilterValue: () => context.activeTaskView,
    isInventoryChecksApprovalTaskView: value => value === 'inventory-checks',
    isTaskDiagnosticsView: () => false, isManagerApprovalTab: () => false,
    isInventoryOfficeBlankShellTab: () => false, isCropRollManagerReviewActive: () => false,
    shouldUseRepAvOpenDataset: () => true, shouldPrepareAvRepCustomerFilterData: () => true,
    canAccessView: () => false, canManageRequestDeliveryRecovery: () => false,
    canUseWeatherHoldRiskTools: () => false, canViewBloomscapesPendingOrders: () => false
  };
  for (const match of html.matchAll(/const (MANAGER_[A-Z0-9_]+_VIEW) = '([^']+)';/g)) context[match[1]] = match[2];
  vm.createContext(context);
  vm.runInContext(registryCode, context);
  context.window.AgMetricLiveSyncRegistry = context.AgMetricLiveSyncRegistry;
  for (const name of ['shouldLoadInventoryEditRequestsForEvalRows', 'withEvalInventoryEditRequestsForRowView',
    'getRequestViewLoadingConfig', 'getViewLoadingConfig', 'getProductionLiveSyncSideContext']) {
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

test('Task subviews load their own joined data, not unrelated Flyer history or a second CAV snapshot', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  const keys = (taskView, evalSimpleTaskFilter = '') => new Set(registry.getCoreKeys('tasks', { taskView, evalSimpleTaskFilter }));
  const blanks = keys('av-blanks');
  assert.ok(blanks.has('master') && blanks.has('warehouseAssignedItems') && blanks.has('cavAvBlankKeys'));
  for (const unrelated of ['flyerRows', 'flyerHistory', 'cav', 'salesOffice', 'requests', 'avHotPriceKeys']) assert.equal(blanks.has(unrelated), false, unrelated);
  assert.ok(keys('eval-task', 'av-blanks').has('requests'));
  assert.ok(keys('notes').has('salesOffice'), 'generic Season/Location exclusion uses Sales Office');
  assert.ok(keys('hot-price').has('avHotPriceKeys'));
  assert.ok(keys('flyer').has('flyerRows') && keys('flyer').has('flyerHistory'));
  assert.ok(keys('reserves').has('reserves'));
  assert.ok(keys('cust').has('reserves') && keys('cust').has('customerRepMap'));
  const office = registry.getCoreKeys('sales-office', { salesOfficeTab: 'season' });
  assert.deepEqual(Array.from(office), ['salesOffice', 'master']);
});

test('open Detail retains its source joins as critical requirements without footer badges', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  context.view = 'detail';
  context.canAccessView = () => false; // No Queue badge may incidentally provide a missing join.
  for (const [source, task, expected] of [
    ['docks', '', ['core:soc', 'side:dockWorkflow']],
    ['sales-office', '', ['core:salesOffice']],
    ['tasks', 'flyer', ['core:flyerRows']],
    ['advertisement', '', ['core:flyerRows']],
    ['request', '', ['core:requests']]
  ]) {
    context.activeDetailSourceView = source;
    context.activeTaskView = task;
    const current = context.getProductionLiveSyncSideContext();
    assert.equal(current.surfaces.some((surface) => surface.startsWith('badge:')), false);
    const adapters = registry.getViewAdapters('detail', current);
    for (const id of expected) assert.ok(adapters.includes(id), `${source}/${task}: missing critical Detail adapter ${id}`);
  }
  context.activeDetailSourceView = 'drive';
  context.activeTaskView = 'flyer';
  const drive = registry.getViewAdapters('detail', context.getProductionLiveSyncSideContext());
  for (const unrelated of ['core:soc', 'side:dockWorkflow', 'core:salesOffice', 'core:flyerRows', 'core:flyerHistory']) {
    assert.equal(drive.includes(unrelated), false, `Drive detail must not inherit unrelated ${unrelated}`);
  }
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
      : route === 'av' ? ['open', 'reserves'].map(tab => ({ activeAVTab: tab })) : [{}];
    for (const state of states) for (const evalRole of [false, true]) {
      Object.assign(context, state, { view: route, evalRole });
      const loaded = context.getViewLoadingConfig(route);
      const activeContext = context.getProductionLiveSyncSideContext();
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

test('NCR completion indexes used to remove completed rows participate in review freshness', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  for (const [view, builder] of [['review', 'ensureManagerReviewInventoryBuilt'], ['move-up', 'ensureMoveUpInventoryBuilt']]) {
    assert.match(functionSource(builder), /ensureNcrCompletionIndexLoaded/);
    assert.ok(registry.getViewAdapters(view).includes('side:ncr'), `${view} must track its NCR completion source`);
  }
});
