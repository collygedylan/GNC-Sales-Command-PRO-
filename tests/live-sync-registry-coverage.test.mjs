import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const registryCode = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');
const coordinatorCode = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8');
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
    getActiveManagerReportPageSurface: () => '', useManagerReportPages: () => false,
    currentUser: 'fixture', currentRole: 'ADMIN', activeReqTab: 'pending', activeHomeTab: 'orders',
    activeMovesTab: 'office', activeInventoryOfficeApprovalType: 'crop-roll', activeAVTab: 'open', activeAvSalesBucket: 'current',
    avRepCustomerDropdownOpen: false, selectedAvRepCustomerKey: '',
    activeTaskView: 'flyer', cropRollDriveSchemaReady: true, inventoryMainTab: 'sales', productionInventoryTab: 'counting',
    productionWorkflowActive: 'spacing', selectedProductivityUser: '', requestDeliveryRecoveryOpen: false,
    activeDetailTab: '', activeDetailSourceView: '', activeItem: null, activeLocationWorkJobId: '', managersSearchTerm: '', evalRole: false,
    poManagementState: { season: '27F1' },
    managerOrdersState: { rows: [], batches: [], selectedAssigneeKeys: new Set() },
    bloomscapesPendingState: { orders: [] }, inventoryTransactionHistoryState: {},
    managerTransactionsKeyedState: { allDates: [], files: [] },
    managerHistoricalReportState: { rows: [], selectedColumns: [] }, accessControlAdminState: {}, codexOpsState: {},
    selectedEvalReports: [], getManagerEvalReport2SelectedReportIds: () => context.selectedEvalReports,
    document: { getElementById: () => null },
    getCurrentVisibleViewId: () => context.view,
    getCurrentLoginCacheScopeKey: () => 'fixture-user', getCurrentChatUsername: () => 'fixture',
    getActiveSpreadCountType: () => 'spread', normalizeProductivityUsername: value => value,
    normalizeAvSalesBucket: value => ['current', 'customer', 'customer-open', 'hot-price'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'current',
    normalizeInventoryOfficeApprovalType: value => value,
    getRoleAccessState: () => ({ isAdmin: !context.evalRole, isEval: context.evalRole, isRep: false, allowedViews: new Set(['sales-inventory']) }),
    canManageCustomerRepMappings: () => context.managerAccess?.canManageCustomerRepMappings !== false,
    getManagersToolAccess: () => ({ canManageCompanyDirectory: true, canViewProductionSchedule: true, canViewHrCommand: true, ...(context.managerAccess || {}) }),
    isAlwaysDriveCardOptionsUser: () => false,
    getActiveEvalSimpleTaskFilterValue: () => context.activeTaskView,
    isInventoryChecksApprovalTaskView: value => value === 'inventory-checks',
    isTaskDiagnosticsView: () => false, isManagerApprovalTab: () => false,
    isInventoryOfficeBlankShellTab: () => false, isCropRollManagerReviewActive: () => false,
    shouldUseRepAvOpenDataset: () => true,
    isAvCustomerSalesBucket: value => ['customer', 'customer-open'].includes(String(value || '').toLowerCase()),
    shouldPrepareAvRepCustomerFilterData: () => !!(context.avRepCustomerDropdownOpen || context.selectedAvRepCustomerKey
      || context.isAvCustomerSalesBucket(context.activeAvSalesBucket) || context.activeAVTab === 'reserves'),
    canAccessView: () => false, canManageRequestDeliveryRecovery: () => false,
    canViewDashboardSyncStatus: () => false,
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

test('Home registers its metadata-only verification surface only for authorized dashboard viewers', () => {
  const context = harness();
  context.view = 'home';
  assert.equal(context.getProductionLiveSyncSideContext().surfaces.includes('home:sync-metadata'), false);
  context.canViewDashboardSyncStatus = () => true;
  assert.equal(context.getProductionLiveSyncSideContext().surfaces.includes('home:sync-metadata'), true);
});

test('AV open does not let unopened optional datasets block the verified inventory and reserve snapshot', async () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  Object.assign(context, { view: 'av', activeAVTab: 'open', activeAvSalesBucket: 'current', avRepCustomerDropdownOpen: false,
    selectedAvRepCustomerKey: '', document: { activeElement: {}, body: { classList: { contains: () => false } }, getElementById: () => null } });
  const avContext = context.getProductionLiveSyncSideContext();
  const ids = Array.from(registry.getViewAdapters('av', avContext));
  const adapters = ids.map(id => ({
    id,
    cacheKey: `${id}:open`,
    sourceKeys: Array.from(registry.getSourceKeys([id])),
    stage: async ({ preview } = {}) => {
      if (id === 'core:master') preview?.({ rows: ['first page'], partial: true });
      if (id === 'core:avNotes') throw new Error('Optional AV notes are unavailable');
      return { rows: [id] };
    },
    commit() {}
  }));
  const liveContext = { scope: 'rep-account', viewKey: 'av', visible: true, online: true,
    dataPermissionVersion: 'rep-v1', progressive: true, previewAdapterIds: ['core:master'], adapters };
  let commits = 0;
  vm.runInContext(coordinatorCode, context);
  const coordinator = context.AgMetricLiveSync.createCoordinator({
    getContext: () => liveContext,
    readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'rep-v1', sources: keys.map(key => ({ key, revision: '1', state: 'ready' })) }),
    commitSnapshots: () => { commits += 1; },
    setTimeout: () => 1, clearTimeout() {}
  });

  assert.ok(ids.includes('core:master'), 'Current Season needs the complete master inventory');
  assert.ok(ids.includes('core:reserves'), 'nonpositive Open Stock visibility needs the rep reserve snapshot');
  assert.ok(ids.includes('side:settings'), 'Current Season settings remain part of the atomic snapshot');
  assert.ok(!ids.includes('core:avNotes'), 'AV notes are not required to display the open-stock catalog');
  assert.ok(!ids.includes('core:avHotPriceKeys'), 'hot-price keys are not required for All Open Stock');
  assert.ok(!ids.includes('core:customerRepMap'), 'customer mapping loads only when the rep customer filter is used');
  assert.ok(Array.from(registry.getViewAdapters('av', { ...avContext, avRepCustomerFilterData: true })).includes('core:customerRepMap'),
    'opening the Customer filter adds its mapping dependency');
  context.activeAVTab = 'reserves';
  assert.ok(Array.from(registry.getViewAdapters('av', context.getProductionLiveSyncSideContext())).includes('core:customerRepMap'),
    'the reserves tab retains its mapping dependency');
  context.activeAVTab = 'open';
  context.activeAvSalesBucket = 'customer';
  assert.ok(Array.from(registry.getViewAdapters('av', context.getProductionLiveSyncSideContext())).includes('core:customerRepMap'),
    'customer reserve buckets retain their mapping dependency');
  context.activeAvSalesBucket = 'hot-price';
  assert.ok(Array.from(registry.getViewAdapters('av', context.getProductionLiveSyncSideContext())).includes('core:avHotPriceKeys'),
    'a hot-price bucket retains its exact key dependency');
  assert.ok(Array.from(registry.getViewAdapters('av', { ...context.getProductionLiveSyncSideContext(), surfaces: ['dialog:av-notes'] })).includes('core:avNotes'),
    'the AV notes dialog keeps its explicit notes dependency');
  assert.equal(await coordinator.check('visible-view'), true);
  assert.equal(commits, 1, 'master and reserves publish together even when optional AV-note data is unavailable');
  coordinator.reset();
});

test('manager low-stock summaries load only for Assigned Items consumers', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  const privateSources = ['private.ph_eval_item_low_stock_overrides', 'private.ph_eval_item_low_stock_import_state'];
  const sourceKeys = (surface) => registry.getSourceKeys(registry.getViewAdapters('managers', surface ? { surfaces: [surface] } : {}));
  assert.ok(!sourceKeys().some(table => privateSources.includes(table)), 'Opening the Managers hub must not wait for low-stock summaries');
  assert.ok(!sourceKeys('managers:eval-reports').some(table => privateSources.includes(table)), 'Classic Eval Reports do not consume per-item targets');
  assert.ok(sourceKeys('managers:assigned-items-export').includes('ph_eval_report_settings'), 'Assigned Items retains the public low-stock revision signal');
  assert.ok(!sourceKeys('managers:assigned-items-export').some(table => privateSources.includes(table)), 'The revision gateway never receives private schema keys');
  assert.deepEqual(Array.from(registry.getSourceKeys(['side:itemLowStockTargets'])), ['ph_eval_report_settings']);

  context.document = { activeElement: {}, body: { classList: { contains: () => false } }, getElementById: () => null };
  context.view = 'managers';
  context.activeHomeTab = 'dashboard';
  const hubSurfaces = context.getProductionLiveSyncSideContext().surfaces;
  assert.ok(!hubSurfaces.includes('managers:assigned-items-export'));
  assert.ok(!hubSurfaces.includes('managers:eval-reports-2'));
  assert.ok(!registry.getViewAdapters('managers', { surfaces: hubSurfaces }).includes('side:itemLowStockTargets'),
    'A pending or failed target RPC cannot hold the module picker because it is outside the hub adapter set');

  context.activeHomeTab = context.MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW;
  vm.runInContext(functionSource('getActiveManagerReportPageSurface') + '\n' + functionSource('useManagerReportPages'), context);
  context.window.GncReportPagesLive = {};
  context.currentUser = 'fixture';
  context.getManagerReportPageController = () => ({ enabled: surface => surface === 'assigned-items' });
  assert.equal(context.useManagerReportPages('assigned-items'), true, 'the report controller may remain available to report consumers');
  assert.equal(context.getActiveManagerReportPageSurface('managers'), '',
    'the current full-row Manager panel must not advertise a paged surface to the coordinator');
  const assignedSurfaces = context.getProductionLiveSyncSideContext().surfaces;
  assert.ok(assignedSurfaces.includes('managers:assigned-items-export'));
  const assignedAdapters = registry.getViewAdapters('managers', { surfaces: assignedSurfaces });
  assert.ok(assignedAdapters.includes('core:master'));
  assert.ok(assignedAdapters.includes('core:warehouseAssignedItems'));
  assert.ok(assignedAdapters.includes('side:itemLowStockTargets'));
  assert.ok(assignedAdapters.includes('side:settings'));
  context.activeHomeTab = context.MANAGER_EVAL_REPORTS_2_VIEW;
  context.selectedEvalReports = ['low-stock'];
  const eval2Surfaces = context.getProductionLiveSyncSideContext().surfaces;
  assert.ok(eval2Surfaces.includes('managers:eval-reports-2'));
  assert.ok(!eval2Surfaces.includes('managers:eval-reports-2-low-stock'), 'Eval2 LowStock keeps the shared-threshold path');
  assert.ok(!registry.getViewAdapters('managers', { surfaces: eval2Surfaces }).includes('side:itemLowStockTargets'));
});

test('manager customer mapping uses a revision-only adapter and user revisions match their protected table', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  const adapters = Array.from(registry.getViewAdapters('managers', { surfaces: ['managers:customer-rep-map'] }));
  assert.deepEqual(adapters, ['side:customerMappingRevision'],
    'paged assignment UI must not hydrate the complete customer mapping table');
  assert.deepEqual(Array.from(registry.getSourceKeys(adapters)), ['ph_customer_consignee_sales_reps']);
  assert.deepEqual(Array.from(registry.getSourceKeys(['side:users'])), ['ph_app_users']);
});

test('company directory, Production Schedule, and HR use their exact source revision signals', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  const expected = {
    'managers:company-directory': ['ph_company_directory_contacts', 'ph_company_directory_blocks', 'ph_company_directory_beds', 'ph_company_directory_codes'],
    'managers:production-schedule': ['production_schedule_active'],
    'managers:hr-command': ['core_employees', 'hr_job_codes', 'labor_timesheets', 'ph_department_calendar_events']
  };
  for (const [surface, sources] of Object.entries(expected)) {
    const ids = Array.from(registry.getViewAdapters('managers', { surfaces: [surface] }));
    assert.equal(ids.length, 1, surface);
    assert.deepEqual(Array.from(registry.getSourceKeys(ids)), sources, surface);
  }
  assert.equal(registry.adapters['side:companyDirectoryRevision'].sourceKeys.length, 4);
  assert.deepEqual(Array.from(registry.side.hrCommandRevision), expected['managers:hr-command']);
});

test('manager revision surfaces are selected only for their authorized active tabs', () => {
  const context = harness();
  context.document = { activeElement: {}, body: { classList: { contains: () => false } }, getElementById: () => null };
  context.view = 'managers';
  for (const [tab, surface] of [
    [context.MANAGER_COMPANY_DIRECTORY_VIEW, 'managers:company-directory'],
    [context.MANAGER_PRODUCTION_SCHEDULE_VIEW, 'managers:production-schedule'],
    [context.MANAGER_HR_COMMAND_VIEW, 'managers:hr-command']
  ]) {
    context.activeHomeTab = tab;
    assert.ok(context.getProductionLiveSyncSideContext().surfaces.includes(surface), surface);
  }
  context.managerAccess = { canManageCompanyDirectory: false, canViewProductionSchedule: false, canViewHrCommand: false };
  for (const surface of ['managers:company-directory', 'managers:production-schedule', 'managers:hr-command']) {
    assert.ok(!context.getProductionLiveSyncSideContext().surfaces.includes(surface), surface);
  }
});

test('Eval2 LowStock preview keeps the actual coordinator cohort stable', async () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  context.view = 'managers';
  context.activeHomeTab = context.MANAGER_EVAL_REPORTS_2_VIEW;
  context.selectedEvalReports = ['low-stock'];
  let targetCodes = ['INITIAL'], masterStages = 0;
  const getContext = () => {
    const side = context.getProductionLiveSyncSideContext();
    const ids = Array.from(registry.getViewAdapters('managers', { surfaces: side.surfaces }));
    const adapters = ids.map(id => ({
      id,
      cacheKey: id === 'side:itemLowStockTargets' ? JSON.stringify(targetCodes) : JSON.stringify([id, 'stable']),
      sourceKeys: Array.from(registry.getSourceKeys([id])),
      stage: async options => {
        if (id === 'core:master') {
          masterStages += 1;
          options.preview?.({partial:true});
        }
        return {id};
      },
      commit:() => {}
    }));
    return {scope:'manager-account', viewKey:'managers', visible:true, online:true, dataPermissionVersion:'p1', progressive:true, adapters};
  };
  vm.runInContext(coordinatorCode, context);
  const coordinator = context.AgMetricLiveSync.createCoordinator({
    getContext,
    readRevisions:async keys => ({contractVersion:1,permissionVersion:'p1',serverTime:'fixture',sources:keys.map(key => ({key,state:'ready',revision:'1'}))}),
    previewSnapshots:() => { targetCodes = [...targetCodes, `PREVIEW-${targetCodes.length}`]; },
    setTimeout:() => 1, clearTimeout:() => {}, concurrency:2
  });
  await coordinator.check('visible-view');
  const stats = coordinator.getStatistics();
  assert.equal(stats.discardedLoads, 0, 'partial inventory preview must not change Eval2 coordinator identity');
  assert.equal(masterStages, 1, 'the full master snapshot must not restart from offset zero');
  assert.equal(stats.commits, 1);
  assert.ok(!getContext().adapters.some(adapter => adapter.id === 'side:itemLowStockTargets'));
});

test('Managers navigation has no data gate and each data tab declares its own cohort', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  assert.equal(registry.views.managers.kind, 'navigation');
  assert.deepEqual(Array.from(registry.getViewAdapters('managers')), []);
  const expected = {
    'managers:assigned-items-export': ['core:master', 'core:warehouseAssignedItems', 'side:itemLowStockTargets', 'side:settings'],
    'managers:eval-reports': ['core:master', 'side:managerEvalSettings', 'side:settings'],
    'managers:eval-reports-2': ['core:master', 'core:warehouseAssignedItems', 'side:managerEvalSettings', 'side:settings'],
    'managers:orders': ['side:managerOrders'],
    'managers:access-control': ['side:access'],
    'managers:historical-report': ['side:historical']
  };
  for (const [surface, adapters] of Object.entries(expected)) {
    assert.deepEqual(Array.from(registry.getViewAdapters('managers', { surfaces: [surface] })).sort(), adapters.sort(), surface);
  }
  assert.deepEqual(Array.from(registry.getViewAdapters('managers', { surfaces: ['managers:eval-reports-2-low-stock'] })).sort(), ['side:itemLowStockTargets']);
});

test('paged report lists subscribe to revisions without materializing complete inventory or assignments', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  const ids = Array.from(registry.getViewAdapters('managers', { pagedReportSurface:'eval2', surfaces:['managers:eval-reports-2'] }));
  assert.deepEqual(ids.sort(), ['side:reportEval2','side:settings']);
  const sources = Array.from(registry.getSourceKeys(ids));
  assert.ok(sources.includes('ph_master_inventory'));
  assert.ok(sources.includes('ph_inventory_row_assignments'));
  assert.ok(sources.includes('ph_eval_report_settings'));
  assert.ok(!sources.some(source => source.startsWith('private.')));
  assert.deepEqual(Array.from(registry.getCoreKeys('low-stock', { pagedReportSurface:'ncr' })), []);
  assert.deepEqual(Array.from(registry.getViewAdapters('sales-inventory', { pagedReportSurface:'inventory-hub' })), []);
  const dialog = Array.from(registry.getViewAdapters('managers', {
    pagedReportSurface:'eval2', surfaces:['managers:eval-reports-2','dialog:item-inquiry']
  }));
  assert.ok(dialog.includes('core:master'), 'Existing dialog authority cohort remains intact');
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
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:archived'] })), [],
    'Archived rows are loaded only through the capability-checked archive RPC.');
});

test('Pending and Suspend Tag verify their own queue cohorts while other request tabs keep their joins', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:pending'] })),
    ['core:requests', 'side:queueInventoryRevision', 'side:settings']);
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:suspend-tag', 'badge:queue'] })),
    ['core:suspendTag', 'side:queueInventoryRevision'], 'Suspend Tag keeps cached footer counts without gating entry on broad queue badge sources');
  const expected = {
    'request:reps': ['core:requests', 'core:master', 'core:customerRepMap', 'core:requestHistory', 'core:salesCredits', 'side:settings'],
    'request:suspend-tag': ['core:suspendTag', 'side:queueInventoryRevision'],
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
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:bunch-notes'] })), ['side:bunchQueue']);
  for (const surface of ['request:bunch-notes', 'request:bunch-count-review']) assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: [surface, 'badge:queue'] })), ['side:bunchQueue'], 'Assigned-work queues do not hydrate broad inventory or requests');
  assert.deepEqual(Array.from(registry.getViewAdapters('request', { surfaces: ['request:pending', 'dialog:request'] })),
    ['core:requests', 'side:queueInventoryRevision', 'core:master', 'core:reserves', 'core:customerRepMap', 'side:settings']);
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

test('Suspend Tag customer and rep mapping is background-only and deduplicated', () => {
  const context = vm.createContext({ Array, Set });
  vm.runInContext(functionSource('appendSuspendTagBackgroundCustomerRepMap'), context);
  const foregroundIds = new Set(['core:suspendTag']);
  const created = { id: 'core:customerRepMap' };
  let factoryCalls = 0;
  const background = context.appendSuspendTagBackgroundCustomerRepMap([], foregroundIds, 'request', ['request:suspend-tag'], () => {
    factoryCalls += 1; return created;
  });
  assert.deepEqual(Array.from(foregroundIds), ['core:suspendTag'], 'the map is not a queue-entry gate');
  assert.deepEqual(Array.from(background, adapter => adapter.id), ['core:customerRepMap']);
  context.appendSuspendTagBackgroundCustomerRepMap(background, foregroundIds, 'request', ['request:suspend-tag'], () => {
    factoryCalls += 1; return created;
  });
  context.appendSuspendTagBackgroundCustomerRepMap([], new Set(['core:customerRepMap']), 'request', ['request:suspend-tag'], () => {
    factoryCalls += 1; return created;
  });
  context.appendSuspendTagBackgroundCustomerRepMap([], foregroundIds, 'request', ['request:pending'], () => {
    factoryCalls += 1; return created;
  });
  assert.equal(factoryCalls, 1, 'existing adapters and unrelated request tabs do not duplicate the read');
});

test('Sales Office rows verify before optional enrichment cohorts', () => {
  const context = vm.createContext({ Array, String });
  vm.runInContext(functionSource('partitionSalesOfficeLiveAdapters'), context);
  const adapters = ['side:settings', 'core:flyerHistory', 'core:master', 'core:salesOffice', 'core:inventoryEditRequests']
    .map(id => ({ id }));
  const list = context.partitionSalesOfficeLiveAdapters(adapters, 'sales-office', []);
  assert.deepEqual(Array.from(list.foreground, adapter => adapter.id), ['core:salesOffice']);
  assert.deepEqual(Array.from(list.background, adapter => adapter.id), [
    'side:settings', 'core:flyerHistory', 'core:master', 'core:inventoryEditRequests'
  ]);
  const dialog = context.partitionSalesOfficeLiveAdapters(adapters, 'sales-office', ['dialog:item-inquiry']);
  assert.deepEqual(Array.from(dialog.foreground, adapter => adapter.id), adapters.map(adapter => adapter.id),
    'an opened workflow keeps its complete authorization cohort');
  assert.deepEqual(Array.from(dialog.background), []);
});

test('Drive verifies its displayed stock without waiting for unopened detail sources', () => {
  const context = harness(), registry = context.AgMetricLiveSyncRegistry;
  assert.deepEqual(Array.from(registry.getViewAdapters('drive')), ['core:master', 'side:settings']);
  const assigned = registry.getViewAdapters('drive', { driveAssignmentsRequired: true, evalInventoryRows: true });
  assert.ok(!assigned.includes('core:warehouseAssignedItems'), 'assignment actions hydrate in the background');
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
  assert.deepEqual(Array.from(registry.getViewAdapters('docks')), ['core:soc', 'core:master', 'core:customerRepMap', 'side:dockWorkflow', 'side:queueInventoryRevision', 'side:settings']);
});


test('Suspend inventory revision invalidates exact-row hydration without a complete master scan', () => {
  const registry = harness().AgMetricLiveSyncRegistry;
  const ids = Array.from(registry.getViewAdapters('request', { surfaces: ['request:suspend-tag'] }));
  assert.ok(!ids.includes('core:master'));
  assert.ok(ids.includes('side:queueInventoryRevision'));
  assert.deepEqual(Array.from(registry.getSourceKeys(['side:queueInventoryRevision'])), ['ph_master_inventory']);
  assert.ok(registry.getViewAdapters('docks').includes('side:queueInventoryRevision'));
});
