import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');
const adapterSource = readFileSync(new URL('../assets/live-sync-adapters.js', import.meta.url), 'utf8');
const coordinatorSource = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8');
const demandDetailSource = readFileSync(new URL('../assets/drive-demand-detail.js', import.meta.url), 'utf8');
const start = html.indexOf('function createProductionLiveSyncSideAdapters()');
const end = html.indexOf('async function loadAvOptionEvalRequests(', start);
assert.ok(start > 0 && end > start);
const factorySource = html.slice(start, end);
const demandStart = html.indexOf('function getDriveDemandContext(');
const demandEnd = html.indexOf('function refreshDriveDemandDetail(', demandStart);
assert.ok(demandStart > 0 && demandEnd > demandStart);
const demandBindingSource = html.slice(demandStart, demandEnd);
function inlineFunctionSource(name) {
    const functionStart = html.indexOf(`        function ${name}(`);
    assert.ok(functionStart > 0, name);
    const functionEnd = html.slice(functionStart + 1).search(/\r?\n        (?:async )?function \w+\(/);
    assert.ok(functionEnd > 0, `${name} end`);
    return html.slice(functionStart, functionStart + 1 + functionEnd);
}
const targetCodesSource = inlineFunctionSource('getManagerItemLowStockTargetCodes');
const targetKeySource = inlineFunctionSource('getManagerAssignedItemTargetKey')
    .replace('function getManagerAssignedItemTargetKey(', 'function getManagerAssignedItemTargetKeyActual(');
const coordinatorSandbox = { module: { exports: {} }, setTimeout, clearTimeout, AbortController };
vm.runInNewContext(coordinatorSource, coordinatorSandbox);
const { createCoordinator } = coordinatorSandbox.module.exports;
function harness(sourceFactory = factorySource) {
    const calls = [];
    const rows = [{ unique_id: 'new', source_unique_id: 'new', id: 'new', tripnumber: 'T1', issueSourceUniqueId: 'new', allocationUniqueId: 'new', UNIQUE_ID: 'new', conversationId: 'new' }];
    const ctx = { SalesWorkspace: {isView:()=>true,stageRefresh:async()=>{calls.push(['api','sales_credit','sources']);return {rows};},applyRefresh(){}}, BunchNote: {scope:()=>'', stage:async()=>({account:'dylan_collyge',jobs:rows}),commit(){},render(){}}, Date, Object, Array, Map, Set, String, Number, JSON, Promise, encodeURIComponent, console, calls, window: {},
        fetchAllSupabaseRows: async (table, query) => { calls.push(['GET', table, query]); return table === 'ph_crop_roll_runs' ? [] : rows; },
        fetchPoManagementRows: async () => { calls.push(['GET', 'po']); return rows; },
        runDedupeSupabaseRead: async (_key, taskFn, options = {}) => taskFn({ signal: options.signal }),
        productionLiveSyncNavigation: { signal: null },
        supabaseFetch: async (table, method, body, query) => { calls.push([method, table, query]); return rows; },
        runDockTripStatusRequest: async (operation) => { calls.push(['dock', operation]); return { data: rows }; },
        runAppApiSupabaseWrite: async (table, method) => { calls.push([method, table]); return rows; },
        evalWorkApi: async (operation) => { calls.push(['eval', operation]); return { data: rows, manager: true }; },
        locationWorkApi: async (operation) => { calls.push(['location', operation]); return { data: rows }; },
        shearLocationWorkApi: async (operation) => { calls.push(['shear', operation]); return { data: operation === 'list' ? rows : rows[0] }; },
        chatApiGet: async (table, query) => { calls.push(['GET', table, query]); return rows; },
        invokeCodexOpsApi: async (operation) => { calls.push(['codex', operation]); return operation === 'list' ? rows : {}; },
        supabaseRpc: async (name, payload) => {
            calls.push(['RPC', name, payload]);
            if (name === 'bloomscapes_pending_command') return { mode: 'pending-unpaid', stockReserved: false, paymentEnabled: false, orders: rows };
            if (name === 'get_manager_order_sources_v1') return { sources: rows };
            if (name === 'get_transactions_keyed_dashboard') return { availableDates: [], dateMetrics: [], allDates: [], files: [], summary: {} };
            if (name === 'get_request_delivery_recovery_queue' || name === 'search_historical_inventory_common_names') return rows;
            if (name === 'get_eval_item_low_stock_targets_v1') return [];
            return {};
        },
        postAppFunctionJson: async (_url, payload) => { calls.push(['api', payload.action, payload.operation || 'read']); return {ok:true, rows, hasMore:false}; },
        postGoogleScriptRawJsonPayload: async (payload) => { calls.push(['script', payload.type]); return { ok: true, rows }; },
        parseRemoteAppSeasonSettingsRow: () => ({ seasonCode: 'F1', salesYear: '27' }),
        writeLocalAppSeasonSettings: (value) => { ctx.settings = value; },
        normalizeItemInquiryCoverage: (value) => value, normalizeDockTeamInfo: (value) => value,
        normalizeDockTeamTripKey: (value) => value, normalizeDockItemUniqueId: (value) => value,
        normalizeDockItemProgress: (value) => value, normalizeDockIssueStatusRow: (value) => value,
        normalizeDockIssueAllocationRow: (value) => value, normalizeChatUser: (value) => value,
        normalizeAssignableAppUserEntry: (value) => value, normalizeFlyerAssignableUserEntry: (value) => value,
        normalizeAppEmailRecipientUserEntry: (value) => value, normalizeAdminRecipientUserEntry: (value) => value,
        normalizeEvalAssignableUser: (value) => String(value || '').toLowerCase(), formatAppUserDisplayName: (value) => value,
        EVAL_TASK_INACTIVE_USERS: new Set(), getEvalAssignableUserList: () => ctx.evalAssignableUsers,
        applyAppEmailRecipientUsersToRepGroups: (value) => { ctx.emailOptions = value; },
        applyAdminRecipientUsersToRepGroups: (value) => { ctx.adminOptions = value; }, applyEvalRecipientUsersToRepGroups() {},
        normalizeAvOptionEvalRequestRow: (value) => value, normalizeSpreadCountType: (value) => value,
        getActiveSpreadCountTableName: (value) => `ph_${value}_counts`, mergeCropRollRowsById: (value) => value,
        normalizeTakeBackRow: (value) => value, normalizeChatParticipant: (value) => value,
        normalizeChatConversation: (value) => value, normalizeChatMessage: (value) => value,
        normalizeDepartmentCalendarEvent: (value) => value, normalizeManagerEvalReportSettings: (value) => value,
        normalizeAccessControlMatrix: (value) => value, mergeProductivityHistoryRows: (_, values) => values,
        isSupportedProductivitySourceKind: () => true, firstNonEmptyValue: (...values) => values.find(Boolean) || '',
        getProductivityHistoryState: () => ctx.productivityState, getArgosInventoryTransactionActorEmail: () => '',
        invalidateDockWorkflowResolvedState() {}, rebuildSpreadCountIndexes() {}, invalidateManagerEvalReportCache() {},
        currentUser: 'dylan_collyge', currentRole: 'ADMIN', currentUserDisplay: 'Dylan', managersSearchTerm: '',
        resolvedViewStateEpoch: 0, datasetLoadSignatures: { master: '1', warehouseAssignedItems: '1' },
        getDatasetLoadSignature: key => ctx.datasetLoadSignatures[key] || '',
        managerItemLowStockCodeKeyCache: null,
        fullInventory: [], warehouseAssignedItemsInventory: [], managerItemLowStockTargetsState: { owner: 'dylan_collyge', key: '', rowsByCode: new Map(), revision: 0 },
        normalizeManagerItemLowStockTargetCode: value => String(value || '').trim().toUpperCase(),
        fetchManagerItemLowStockTargets: async codes => { calls.push(['RPC', 'get_eval_item_low_stock_targets_v1', { p_itemcodes: codes }]); return []; },
        getManagerAssignedItemTargetKey: () => 'fixture-target-key', getManagerItemLowStockTargetsState: () => ctx.managerItemLowStockTargetsState,
        invalidateManagerEvalReport2Cache() {}, canReadItemLowStockTargets: () => true,
        APP_SHELL_VERSION: 'fixture', APP_SHELL_BUILD: 'fixture', REQUEST_EMAIL_SCRIPT_TIMEOUT_MS: 1000,
        dockTeamStatusByTrip: new Map([['old', {}]]), dockItemProgressByUid: new Map([['old', {}]]),
        dockIssueStatusByUid: new Map([['old', {}]]), dockIssueAllocationsById: new Map([['old', {}]]), dockIssueAllocationsBySourceUid: new Map([['old', []]]),
        dockTeamStatusRenderVersion: 0, productionWorkflowState: {}, spreadCountState: {}, shearListState: { openInquiryIds: new Set(), draft: 'keep me' },
        departmentCalendarState: {}, weatherHoldState: {}, poManagementState: {}, managerOrdersState: { draft: 'preserve' },
        managerEvalReportSettingsState: {}, productivityState: {}, productivityHistoryByUser: new Map(),
        inventoryTransactionHistoryState: {}, bloomscapesPendingState: {}, managerTransactionsKeyedState: {}, managerHistoricalReportState: {},
        accessControlAdminState: { editor: { draft: 'keep' } }, codexOpsState: { draft: 'keep' }, activeChatConversationId: 'new',
        activeDetailTab: '', activeDetailSourceView: '', activeItem: null, driveDemandSnapshots: new Map(),
        getCurrentVisibleViewId: () => 'home', getSupabaseReadIdentityScope: () => 'native:dylan',
        getRoleAccessState: () => ({ isRep: false, isAdmin: true }), isMyRep: () => true,
        canViewDriveCustomerConsigneeRows: () => true
    };
    const constantNames = [...factorySource.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)].map((entry) => entry[0]);
    for (const name of constantNames) if (!(name in ctx)) ctx[name] = name.toLowerCase();
    for (const name of [...factorySource.matchAll(/\b(can[A-Za-z]+|is[A-Za-z]+)\(/g)].map((entry) => entry[1])) if (!(name in ctx)) ctx[name] = () => true;
    ctx.isKaylaLimitedAccessManagerUser = () => false;
    vm.createContext(ctx);
    vm.runInContext(`${registrySource}\n${adapterSource}`, ctx);
    ctx.window.SalesWorkspace = ctx.SalesWorkspace;
    ctx.window.AgMetricLiveSyncRegistry = ctx.AgMetricLiveSyncRegistry;
    ctx.window.AgMetricLiveSyncAdapters = ctx.AgMetricLiveSyncAdapters;
    vm.runInContext(demandDetailSource, ctx);
    ctx.window.AgMetricDriveDemandDetail = ctx.AgMetricDriveDemandDetail;
    vm.runInContext(`${demandBindingSource}\n${targetCodesSource}\n${targetKeySource}\n${sourceFactory}`, ctx);
    return { ctx, calls, rows, api: ctx.createProductionLiveSyncSideAdapters() };
}
const context = { scope: 'user:division', username: 'dylan_collyge', productionType: 'propagation', countType: 'spread', productivityUser: 'dylan_collyge', managerOrders: { level: 'sources', sourceKey: '', assignees: [], rowCount: 0, batchCount: 0 }, pendingOrderCount: 0, transactions: {}, transactionsKeyed: { dateCount: 0, fileCount: 0 }, historical: { level: 'names', columns: [], search: '', rowCount: 0 }, accessQuery: {}, codexTaskId: '' };
const driveDemandContext = (kind = 'reserves') => ({ kind, key: { itemcode: 'SYNTH.003', season: 'F1', salesyear: 2027 }, query: 'select=*&itemcode=ilike.*SYNTH.003*', cacheKey: JSON.stringify([kind, 'SYNTH.003']) });

for (const id of ['side:shear', 'side:evalWork', 'side:chat', 'side:calendar']) {
    test(`${id} background network reads receive cohort cancellation`, async () => {
        const h = harness(), controller = new AbortController(), signals = [];
        const hold = signal => {
            assert.ok(signal, 'every background transport must receive a signal');
            signals.push(signal);
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
        };
        h.ctx.fetchAllSupabaseRows = (table, query, options) => hold(options?.signal);
        h.ctx.evalWorkApi = (operation, payload, options) => hold(options?.signal);
        h.ctx.shearLocationWorkApi = (operation, payload, options) => hold(options?.signal);
        h.ctx.chatApiGet = (table, query, label, options) => hold(options?.signal);
        const pending = descriptor(h, id).stage({ signal: controller.signal });
        assert.ok(signals.length > 0); assert.ok(signals.every(signal => signal === controller.signal));
        controller.abort(); await assert.rejects(pending, /Aborted|cancelled/);
    });
}

function descriptor(h, id, overrides = {}) {
    const registry = h.ctx.AgMetricLiveSyncRegistry;
    const selectedRegistry = { ...registry, getViewAdapters: () => [id] };
    // Recreate with the production binding closures but substitute selection only.
    h.ctx.window.AgMetricLiveSyncRegistry = selectedRegistry;
    return h.ctx.createProductionLiveSyncSideAdapters().getViewAdapters('home', { ...context, ...overrides })[0];
}

test('all root production views are classified and every declared adapter has physical dependencies', () => {
    const h = harness();
    const registry = h.ctx.AgMetricLiveSyncRegistry;
    const ids = [...html.matchAll(/id="view-([a-z-]+)"/g)].map((entry) => entry[1]).filter((id) => id !== 'wrapper');
    for (const id of ids) assert.ok(registry.views[id], `Unregistered route ${id}`);
    for (const [id, definition] of Object.entries(registry.adapters)) {
        assert.ok(definition.sourceKeys.length, id);
        assert.ok(definition.sourceKeys.every((key) => !['ph_request_delivery_status', 'ph_request_queue_live_rows', 'ph_active_request_live_rows', 'ph_view_po_27f1_hl', 'ph_crop_roll_open_rows'].includes(key)), `${id}: view is not a revision source`);
    }
    assert.ok(registry.core.cropRollDrive.includes('ph_crop_roll_completed_drive_keys'));
    assert.ok(registry.core.requests.includes('ph_request_delivery_outbox'));
});

test('every side adapter executes a read-only stage and a synchronous commit', async () => {
  const h = harness();
  for (const id of Object.keys(h.ctx.AgMetricLiveSyncRegistry.side)) {
        const driveDemand = id === 'driveReserves' ? driveDemandContext('reserves') : id === 'driveOpenOrders' ? driveDemandContext('open-orders') : undefined;
        const item = descriptor(h, `side:${id}`, { countType: id === 'bunchCounts' ? 'bunch' : 'spread', driveDemand });
        assert.ok(item, id);
        const staged = await item.stage();
        assert.notEqual(staged, undefined, id);
        assert.equal(item.commit(staged), undefined, id);
    }
    for (const call of h.calls) {
        assert.ok(['GET', 'RPC', 'dock', 'eval', 'location', 'shear', 'codex', 'script', 'api'].includes(call[0]), JSON.stringify(call));
        if (['dock', 'eval', 'location', 'shear'].includes(call[0])) assert.ok(['list', 'get'].includes(call[1]), JSON.stringify(call));
        if (call[0] === 'api') assert.ok(['sales_credit:sources','production_workflow:list','inventory_transaction_history:read'].includes(call[1]+':'+call[2]), JSON.stringify(call));
        if (call[1] === 'bloomscapes_pending_command') assert.equal(call[2].p_action, 'state');
    }
    assert.equal(h.ctx.shearListState.draft, 'keep me');
    assert.equal(h.ctx.accessControlAdminState.editor.draft, 'keep');
    assert.equal(h.ctx.codexOpsState.draft, 'keep');
});

test('low-stock target adapter fetches assigned item codes and commits a fresh Eval2 snapshot', async () => {
    const h = harness();
    h.ctx.fullInventory = [{ ITEMCODE: 'drive-only-3' }, { ITEMCODE: 'orchid-1' }];
    h.ctx.warehouseAssignedItemsInventory = [{ ITEMCODE: ' orchid-1 ' }, { itemcode: 'ORCHID-1' }, { ITEMCODE: 'CEDAR-2' }];
    const fetched = [];
    h.ctx.fetchManagerItemLowStockTargets = async codes => {
        fetched.push(codes);
        return [{ itemcode_normalized: 'ORCHID-1', effective_qty: 18, override_revision: 3 },
            { itemcode_normalized: 'DRIVE-ONLY-3', manual_override_qty: 5, effective_qty: 5, override_revision: 8 }];
    };
    let invalidated = 0;
    h.ctx.invalidateManagerEvalReport2Cache = () => { invalidated += 1; };
    const adapter = descriptor(h, 'side:itemLowStockTargets');
    const snapshot = await adapter.stage();
    assert.deepEqual(fetched, [['CEDAR-2', 'DRIVE-ONLY-3', 'ORCHID-1']]);
    assert.deepEqual(snapshot.rows, [{ itemcode_normalized: 'ORCHID-1', effective_qty: 18, override_revision: 3 },
        { itemcode_normalized: 'DRIVE-ONLY-3', manual_override_qty: 5, effective_qty: 5, override_revision: 8 }]);
    assert.equal(adapter.commit(snapshot), undefined);
    assert.equal(h.ctx.managerItemLowStockTargetsState.rowsByCode.get('ORCHID-1').effective_qty, 18);
    assert.equal(h.ctx.managerItemLowStockTargetsState.rowsByCode.get('DRIVE-ONLY-3').effective_qty, 5,
        'the target map includes an overridden inventory item without an Assigned Items row');
    assert.equal(h.ctx.managerItemLowStockTargetsState.key, 'fixture-target-key');
    assert.equal(h.ctx.managerItemLowStockTargetsState.revision, 1);
    assert.equal(invalidated, 1);
});

test('low-stock target coordinator scope stays stable across commits but changes with inventory and account', async () => {
    async function run(sourceFactory = factorySource) {
        const h = harness(sourceFactory);
        h.ctx.fullInventory = [{ ITEMCODE: ' AB-100 ' }, { ITEMCODE: '0012' }];
        h.ctx.warehouseAssignedItemsInventory = [{ itemcode: 'ab-100' }, { ITEMCODE: 'CEDAR.2' }];
        h.ctx.datasetLoadSignatures = { master: 'master-1', warehouseAssignedItems: 'assigned-1' };
        h.ctx.masterLastLoadedAt = 1;
        let account = 'dylan_collyge', reads = 0;
        h.ctx.getManagerAssignedItemTargetKey = h.ctx.getManagerAssignedItemTargetKeyActual;
        const getAdapter = () => descriptor(h, 'side:itemLowStockTargets', { username: account, scope: `native:${account}` });
        const getContext = () => ({ scope: `native:${account}`, viewKey: 'managers', visible: true, online: true, adapters: [getAdapter()] });
        const coordinator = createCoordinator({
            getContext,
            setTimeout: () => 1,
            clearTimeout: () => {},
            readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'policy-1', sources: keys.map(key => ({ key, revision: '1', state: 'ready' })) }),
            commitSnapshots(staged) {
                staged.forEach(({ adapter, value }) => adapter.commit(value));
                // A successful core refresh changes these volatile values during the same cycle.
                h.ctx.resolvedViewStateEpoch++;
                h.ctx.masterLastLoadedAt++;
                h.ctx.datasetLoadSignatures.master = `master-${h.ctx.masterLastLoadedAt}`;
                h.ctx.datasetLoadSignatures.warehouseAssignedItems = `assigned-${h.ctx.resolvedViewStateEpoch + 1}`;
            },
        });
        const initial = getAdapter();
        const initialCacheKey = initial.cacheKey;
        const initialVolatileKey = h.ctx.getManagerAssignedItemTargetKeyActual();
        const firstCheck = await coordinator.check();
        if (sourceFactory !== factorySource) {
            assert.equal(firstCheck, false, 'the legacy volatile scope discards the snapshot after commit');
            assert.ok(coordinator.getStatistics().discardedLoads > 0);
            coordinator.suspend();
            return { h, coordinator };
        }
        assert.equal(firstCheck, true);
        assert.equal(coordinator.getStatus().state, 'Up to date');
        assert.equal(coordinator.getStatistics().discardedLoads, 0);
        assert.notEqual(h.ctx.getManagerAssignedItemTargetKeyActual(), initialVolatileKey,
            'the internal freshness key still tracks refreshed timestamps/epochs');
        assert.equal(getAdapter().cacheKey, initialCacheKey,
            'the side adapter identity is based on codes, not timestamps or the commit epoch');
        assert.ok(h.ctx.masterLastLoadedAt > 1);
        reads++;

        h.ctx.fullInventory.reverse();
        h.ctx.fullInventory.push({ ITEMCODE: 'ab-100' });
        assert.equal(getAdapter().cacheKey, initialCacheKey, 'row order and duplicate item codes do not invalidate scope');

        h.ctx.fullInventory.push({ ITEMCODE: 'NEW-ITEM' });
        assert.notEqual(getAdapter().cacheKey, initialCacheKey, 'a real inventory code addition invalidates the lookup');
        assert.equal(await coordinator.check('metadata'), true);
        reads++;

        const beforeAccountSwitch = getAdapter().cacheKey;
        account = 'megan_kelly';
        assert.notEqual(getAdapter().cacheKey, beforeAccountSwitch, 'the caller account scope remains part of adapter identity');
        assert.equal(await coordinator.check('metadata'), true);
        reads++;
        assert.equal(coordinator.getStatistics().adapterReads, reads);
        coordinator.suspend();
        return { h, coordinator };
    }

    const fixed = await run();
    assert.equal(fixed.coordinator.getStatistics().discardedLoads, 0);

    // Recreate the prior volatile-scope contract only inside this VM harness.
    const legacyFactory = factorySource.replace(
        'scope: () => JSON.stringify(getManagerItemLowStockTargetCodes()),',
        'scope: () => getManagerAssignedItemTargetKey(),'
    );
    assert.notEqual(legacyFactory, factorySource, 'the legacy scope contract is represented in the regression harness');
    const legacy = await run(legacyFactory);
    assert.ok(legacy.coordinator.getStatistics().discardedLoads > 0,
        'the old timestamp/epoch scope causes the coordinator to discard post-commit snapshots');
    legacy.coordinator.suspend();
});

test('Docks stages in isolation and replaces authoritative maps, including deletions', async () => {
    const h = harness();
    const item = descriptor(h, 'side:dockWorkflow');
    const snapshot = await item.stage();
    assert.equal(h.ctx.dockIssueStatusByUid.has('old'), true);
    item.commit(snapshot);
    assert.equal(h.ctx.dockIssueStatusByUid.has('old'), false);
    assert.equal(h.ctx.dockIssueStatusByUid.has('new'), true);
    assert.equal(h.ctx.dockIssueAllocationsById.has('old'), false);
    assert.equal(h.ctx.dockTeamStatusByTrip.has('T1'), true);
});

test('side load failures and malformed payloads do not become empty successful snapshots', async () => {
    const h = harness();
    h.ctx.fetchAllSupabaseRows = async () => { throw new Error('offline'); };
    await assert.rejects(descriptor(h, 'side:dockWorkflow').stage(), /offline/);
    assert.equal(h.ctx.dockIssueStatusByUid.has('old'), true);
    h.ctx.evalWorkApi = async () => ({ ok: true });
    await assert.rejects(descriptor(h, 'side:evalWork').stage(), /invalid response/);
});

test('Drive demand adapters use the matching source, preserve identity scope, enforce REP visibility, and forward cancellation', async () => {
    const h = harness(), controller = new AbortController();
    const seen = [];
    h.ctx.getRoleAccessState = () => ({ isRep: true, isAdmin: false });
    h.ctx.isMyRep = (name) => name === 'My Rep';
    h.ctx.fetchAllSupabaseRows = async (table, query, options) => {
        seen.push({ table, query, signal: options?.signal });
        return [
            { unique_id: 'exact', itemcode: ' SYNTH.003 ', lotcode: '27.F1', salesrepname: 'My Rep', invoicedate: null, quantityordered: 0 },
            { unique_id: 'other-rep', itemcode: 'SYNTH.003', lotcode: '27.F1', salesrepname: 'Other Rep', invoicedate: null },
            { unique_id: 'invoiced', itemcode: 'SYNTH.003', lotcode: '27.F1', salesrepname: 'My Rep', invoicedate: '2026-09-01' },
            { unique_id: 'other-season', itemcode: 'SYNTH.003', lotcode: '26.F1', salesrepname: 'My Rep', invoicedate: null }
        ];
    };
    const reserves = descriptor(h, 'side:driveReserves', { scope: 'scope-a', driveDemand: driveDemandContext('reserves') });
    const reserveValue = await reserves.stage({ signal: controller.signal });
    assert.equal(seen[0].table, 'ph_reserves'); assert.equal(seen[0].signal, controller.signal);
    assert.deepEqual(JSON.parse(JSON.stringify(reserveValue.rows)).map((row) => row.unique_id), ['exact', 'invoiced'],
        'Reserves retain their raw imported rows; only Open Orders applies invoice exclusion');
    reserves.commit(reserveValue);
    assert.ok(h.ctx.driveDemandSnapshots.has(JSON.stringify(['scope-a', reserveValue.cacheKey])));

    const orders = descriptor(h, 'side:driveOpenOrders', { scope: 'scope-b', driveDemand: driveDemandContext('open-orders') });
    const orderValue = await orders.stage({ signal: controller.signal });
    assert.equal(seen[1].table, 'ph_soc_master'); assert.equal(seen[1].signal, controller.signal);
    assert.deepEqual(JSON.parse(JSON.stringify(orderValue.rows)).map((row) => row.unique_id), ['exact']);
    orders.commit(orderValue);
    assert.ok(h.ctx.driveDemandSnapshots.has(JSON.stringify(['scope-b', orderValue.cacheKey])));
    assert.notEqual(reserveValue.cacheKey, orderValue.cacheKey, 'source kind cannot reuse an adjacent tab snapshot');

    h.ctx.canViewDriveCustomerConsigneeRows = () => false;
    assert.equal(descriptor(h, 'side:driveReserves', { driveDemand: driveDemandContext('reserves') }), undefined,
        'a denied detail eligibility cannot schedule a protected source read');

    h.ctx.canViewDriveCustomerConsigneeRows = () => true;
    h.ctx.fetchAllSupabaseRows = async (table, query, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
    const cancelled = new AbortController();
    const pending = descriptor(h, 'side:driveReserves', { driveDemand: driveDemandContext('reserves') }).stage({ signal: cancelled.signal });
    cancelled.abort();
    await assert.rejects(pending, /Aborted|cancelled/);
});

test('private pending orders remain Dylan-only without blocking assigned Location Work readers', async () => {
    const h = harness();
    h.ctx.canViewBloomscapesPendingOrders = () => false;
    assert.equal(descriptor(h, 'side:pendingOrders', { username: 'another_user' }), undefined);
    const assigned = [{ id: 'assigned-job', assigned_usernames: ['another_user'] }];
    h.ctx.locationWorkApi = async (operation, payload) => { h.calls.push(['location', operation, payload]); return { data: assigned }; };
    const adapter = descriptor(h, 'side:locationWork', { username: 'another_user' });
    assert.deepEqual(await adapter.stage(), assigned);
    assert.deepEqual(h.calls.filter((call) => call[0] === 'location').map((call) => call[1]), ['list']);
    assert.equal(descriptor(h, 'side:locationWork', { username: '' }), undefined);
});

test('user-directory staging keeps the protected native directory boundary', async () => {
    const h = harness(); let protectedRead = false;
    h.ctx.fetchAllSupabaseRows = async (table) => { assert.notEqual(table, 'ph_app_users'); return []; };
    h.ctx.supabaseFetch = async (table, method) => { assert.equal(table, 'ph_app_users'); assert.equal(method, 'GET'); protectedRead = true; return []; };
    await descriptor(h, 'side:users').stage(); assert.equal(protectedRead, true);
});

test('a verified directory snapshot replaces all option caches without changing selected draft fields', async () => {
    const h = harness();
    h.ctx.supabaseFetch = async () => [{ username: 'new_user', display_name: 'New User', role: 'Eval', email: 'fixture@example.invalid' }];
    h.ctx.dockAssignableUsers = ['deleted_user']; h.ctx.assignableAppUsers = [{ username: 'deleted_user' }];
    h.ctx.flyerAssigneePickerDefaultNames = ['keep_selection']; h.ctx.assignUserSearchTerm = 'typed query';
    h.ctx.evalTaskModalSeeded = true; h.ctx.bloomRecipientDraft = ['keep_email'];
    const adapter = descriptor(h, 'side:users'); const value = await adapter.stage();
    assert.deepEqual(h.ctx.dockAssignableUsers, ['deleted_user']);
    adapter.commit(value);
    assert.deepEqual(Array.from(h.ctx.dockAssignableUsers), ['new_user']);
    assert.equal(h.ctx.assignableAppUsers[0].username, 'new_user'); assert.equal(h.ctx.flyerAssignableUsers[0].username, 'new_user');
    assert.deepEqual(Array.from(h.ctx.evalAssignableUsers), ['new_user']); assert.equal(h.ctx.evalAssignableUserLabels.get('new_user'), 'New User');
    assert.equal(h.ctx.emailOptions[0].email, 'fixture@example.invalid');
    assert.deepEqual(h.ctx.flyerAssigneePickerDefaultNames, ['keep_selection']); assert.equal(h.ctx.assignUserSearchTerm, 'typed query');
    assert.equal(h.ctx.evalTaskModalSeeded, true); assert.deepEqual(h.ctx.bloomRecipientDraft, ['keep_email']);
});

test('inventory views and Bloom Picker dialogs require settings but badge-only Chat does not', () => {
    const h = harness(); const registry = h.ctx.AgMetricLiveSyncRegistry;
    for (const view of ['docks', 'reports', 'reserves', 'request']) assert.ok(registry.getViewAdapters(view).includes('side:settings'), view);
    const bloom = registry.getViewAdapters('chat', { surfaces: ['dialog:bloom-picker'] });
    assert.ok(bloom.includes('core:reserves')); assert.ok(bloom.includes('core:customerRepMap')); assert.ok(bloom.includes('side:settings'));
    assert.ok(!registry.getViewAdapters('chat', { surfaces: ['badge:queue'] }).includes('side:settings'));
    assert.ok(!registry.getViewAdapters('hours', { surfaces: ['badge:queue'] }).includes('side:settings'));
});

test('Codex eligibility is a pure identity check and server capabilities gate all task reads', async () => {
    const h = harness();
    h.ctx.canViewCodexOperations = () => { throw new Error('Recursive legacy capability loader'); };
    const operations = [];
    h.ctx.invokeCodexOpsApi = async (operation) => { operations.push(operation); return { canView: false, submissionEnabled: false }; };
    const adapter = descriptor(h, 'side:codex');
    const denied = await adapter.stage();
    assert.deepEqual(operations, ['capabilities']); assert.equal(denied.tasks.length, 0);
    assert.equal(descriptor(h, 'side:codex', { username: 'another_user' }), undefined);
    operations.length = 0;
    h.ctx.invokeCodexOpsApi = async (operation) => { operations.push(operation); return operation === 'capabilities' ? { canView: true, submissionEnabled: true } : []; };
    await adapter.stage(); assert.deepEqual(operations, ['capabilities', 'list']);
});

test('pagination result size is not part of the live-cache scope', () => {
    const h = harness();
    assert.equal(descriptor(h, 'side:pendingOrders').cacheKey, descriptor(h, 'side:pendingOrders', { pendingOrderCount: 25 }).cacheKey);
    assert.equal(descriptor(h, 'side:managerOrders').cacheKey, descriptor(h, 'side:managerOrders', { managerOrders: { ...context.managerOrders, rowCount: 100, batchCount: 25 } }).cacheKey);
});

test('unregistered routes and adapters fail closed', () => {
    const h = harness();
    assert.throws(() => h.ctx.AgMetricLiveSyncRegistry.getViewAdapters('invented'), /Unregistered/);
    assert.throws(() => h.ctx.AgMetricLiveSyncRegistry.getSourceKeys(['side:invented']), /Unregistered/);
});

test('every registered physical source has a database revision contract', () => {
    const h = harness();
    const directory = new URL('../supabase/migrations/', import.meta.url);
    const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql'));
    assert.deepEqual(migrations, [
      '20260929200000_production_baseline.sql',
      '20260930183036_grower_row_scout_fields.sql',
      '20260930205254_season_sales_business_conflicts_use_pt409.sql',
      '20261001012038_production_schedule_snapshot_v1.sql',
      '20261001025638_aura_hr_command_center_v1.sql',
        '20261001215508_scheduled_handover_005.sql',
        '20261001215511_request_archive_005.sql',
        '20261001222228_handover_assignment_transfer_005.sql',
        '20261002014421_index_request_history_assigned_rep_006.sql',
      '20261002121446_aura_inventory_v2_007.sql',
      '20261002134138_nelly_access_audit_baseline_repair_007.sql',
      '20261002155017_eval_delivery_archive_health_007.sql',
      '20261002204108_aura_inventory_match_010.sql',
      '20261003025749_aura_llm_free_tier_011.sql',
      '20261004010000_company_directory.sql',
    '20261005194158_suspend_tag_approval_loop.sql',
    '20261005225759_structured_bunch_notes.sql',
    '20261006110751_bunch_note_per_card_work.sql',
    '20261006111244_bunch_note_card_commands.sql',
    '20261006145333_reclass_split_move_inquiries_v4.sql',
    '20261006150745_reclass_split_move_eval_submit_guards.sql',
    '20261006200446_inventory_row_assignment_authority.sql',
    '20261006200448_itemcode_default_owners.sql',
    '20261006200449_inventory_row_assignment_fence_integration.sql',
    '20261006210000_inventory_row_assignment_future_snapshots.sql',
    '20261006210200_inventory_row_assignment_live_consumers.sql',
    '20261007041448_aura_internal_query_conversation_inventory.sql',
    '20261007123459_aura_inventory_common_name_priority.sql',
    '20261007145433_aura_dynamic_season_scope.sql',
    '20261007153351_aura_inventory_explicit_projection.sql',
    '20261007211325_sql_function_correctness_repairs.sql',
    '20261007211340_sql_lint_runtime_context.sql',
    '20261008190038_reclass_sheared_action_v5.sql',
    ], 'active migrations contain the baseline and current live app features');
    const baseline = migrations.map((name) => readFileSync(new URL(name, directory), 'utf8')).join('\n');
    // The schema-only baseline omits seed rows. Historical migrations remain
    // the source for validating the registered source-key contracts.
    const archiveDirectory = new URL('../supabase/archive_migrations/', import.meta.url);
    const archivedSql = readdirSync(archiveDirectory).filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(new URL(name, archiveDirectory), 'utf8')).join('\n');
    const sql = `${baseline}\n${archivedSql}`;
    const keys = h.ctx.AgMetricLiveSyncRegistry.sourceKeys;
    for (const key of keys) assert.ok(sql.includes(`('${key}',`), `Unregistered backend source ${key}`);
    for (const view of Object.keys(h.ctx.AgMetricLiveSyncRegistry.views)) {
        const ids = h.ctx.AgMetricLiveSyncRegistry.getViewAdapters(view, { surfaces: ['badge:queue', 'badge:communications'] });
        assert.ok(h.ctx.AgMetricLiveSyncRegistry.getSourceKeys(ids).length <= 64, `${view} exceeds the metadata request cap`);
    }
});
