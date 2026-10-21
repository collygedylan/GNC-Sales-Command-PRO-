import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const registrySource = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');
const adapterSource = readFileSync(new URL('../assets/live-sync-adapters.js', import.meta.url), 'utf8');
const coordinatorSource = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8');
const managerEventsSource = readFileSync(new URL('../assets/manager-source-live-events.js', import.meta.url), 'utf8');
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
const homeTimestampSource = inlineFunctionSource('applyCurrentVerifiedSyncTimestamp');
const resetMetadataSource = inlineFunctionSource('resetDashboardSyncMetadataForPermissionChange');
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
        document: { hidden: false, body: { classList: { contains: () => true } }, getElementById: () => null },
        fetchAllSupabaseRows: async (table, query) => { calls.push(['GET', table, query]); return table === 'ph_crop_roll_runs' ? [] : rows; },
        fetchAuthenticatedSupabaseReadPage: async (table, query, options) => { calls.push(['PAGE', table, query, options]); return { rows: [{ filename: `${table}.xlsx`, last_updated: '2026-10-13T12:00:00Z' }], total: 1 }; },
        fetchPoManagementRows: async () => { calls.push(['GET', 'po']); return rows; },
        runDedupeSupabaseRead: async (_key, taskFn, options = {}) => taskFn({ signal: options.signal }),
        productionLiveSyncNavigation: { signal: null },
        useManagerReportPages: () => true,
        buildManagerReportPageQuery: (surface, operation) => ({ surface, operation, filters: {}, offset: 0, limit: 25 }),
        reportMetadata: new Map(),
        getManagerReportPageController: () => ({
            readPage: async (query) => {
                calls.push(['api', 'report_read_v2', query.operation]);
                return { rows: [], total: 0, hasMore: false, sourceRevision: 'fixture-r1', metadata: {} };
            },
            acceptMetadata: (surface, page) => { ctx.reportMetadata.set(surface, page); }
        }),
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
        postAppFunctionJson: async (_url, payload) => { calls.push(['api', payload.action, payload.operation || 'read']); return {ok:true, rows, hasMore:false, revision:'1'}; },
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
        activeHomeTab: 'dashboard', MANAGER_CUSTOMER_REP_MAP_VIEW: 'customer-rep-map',
        MANAGER_PRODUCTION_SCHEDULE_VIEW: 'production-schedule',
        canManageCustomerRepMappings: () => true,
        getManagersToolAccess: () => ({ canManageCompanyDirectory: true, canViewProductionSchedule: true, canViewHrCommand: true }),
        getProductionLiveSyncSideContext: () => ({ view: 'managers' }),
        GncProductionSchedule: { refresh() { calls.push(['schedule', 'refresh']); } },
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
        getCurrentLoginCacheScopeKey: () => 'native:dylan',
        appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'permission-v1' } },
        DASHBOARD_SYNC_METADATA_LIMIT: 30,
        getDashboardSyncMetadataSources: () => [
            { label: 'Drive', table: 'ph_master_inventory' }, { label: 'SOC', table: 'ph_soc_master' },
            { label: 'Reserves', table: 'ph_reserves' }, { label: 'CAV', table: 'ph_cav_import' }
        ],
        collectDashboardSyncSource: (rows, label) => {
            const latest = Math.max(-1, ...rows.map(row => Date.parse(row.last_updated || '') || -1));
            return { label, iso: latest >= 0 ? new Date(latest).toISOString() : '', ms: latest,
                files: [...new Set(rows.filter(row => (Date.parse(row.last_updated || '') || -1) === latest).map(row => row.filename).filter(Boolean))].sort() };
        },
        updateDashboardSyncSummary() {},
        getRoleAccessState: () => ({ isRep: false, isAdmin: true }), isMyRep: () => true,
        canViewDriveCustomerConsigneeRows: () => true
    };
    const constantNames = [...factorySource.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)].map((entry) => entry[0]);
    for (const name of constantNames) if (!(name in ctx)) ctx[name] = name.toLowerCase();
    for (const name of [...factorySource.matchAll(/\b(can[A-Za-z]+|is[A-Za-z]+)\(/g)].map((entry) => entry[1])) if (!(name in ctx)) ctx[name] = () => true;
    ctx.isKaylaLimitedAccessManagerUser = () => false;
    vm.createContext(ctx);
    vm.runInContext(`${registrySource}\n${adapterSource}`, ctx);
    vm.runInContext(managerEventsSource, ctx);
    ctx.window.SalesWorkspace = ctx.SalesWorkspace;
    ctx.window.BunchQueueShell = { scope: () => 'bunch:scope', stage: async () => { calls.push(['api', 'bunch_note_workflow', 'queue']); return { cards: rows }; }, commit() {} };
    ctx.window.AgMetricLiveSyncRegistry = ctx.AgMetricLiveSyncRegistry;
    ctx.window.AgMetricLiveSyncAdapters = ctx.AgMetricLiveSyncAdapters;
    ctx.window.GncManagerSourceLiveEvents = ctx.GncManagerSourceLiveEvents;
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
    assert.deepEqual([...registry.surfaces['home:sync-metadata'].adapters], ['homeSyncMetadata']);
    assert.deepEqual([...registry.side.homeSyncMetadata], ['ph_master_inventory', 'ph_soc_master', 'ph_reserves', 'ph_cav_import']);
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
        assert.ok(['GET', 'PAGE', 'RPC', 'dock', 'eval', 'location', 'shear', 'codex', 'script', 'api'].includes(call[0]), JSON.stringify(call));
        if (['dock', 'eval', 'location', 'shear'].includes(call[0])) assert.ok(['list', 'get'].includes(call[1]), JSON.stringify(call));
        if (call[0] === 'api') assert.ok(['sales_credit:sources','production_workflow:list','inventory_transaction_history:read','report_read_v2:metadata','customer-rep-map:list','bunch_note_workflow:queue'].includes(call[1]+':'+call[2]), JSON.stringify(call));
        if (call[1] === 'bloomscapes_pending_command') assert.equal(call[2].p_action, 'state');
    }
    assert.equal(h.ctx.shearListState.draft, 'keep me');
    assert.equal(h.ctx.accessControlAdminState.editor.draft, 'keep');
    assert.equal(h.ctx.codexOpsState.draft, 'keep');
    assert.deepEqual([...h.ctx.reportMetadata.keys()], ['eval1', 'eval2', 'ncr', 'assigned-items', 'season-priority', 'approval']);
});

test('Home sync metadata side adapter is bounded, projected, scoped, and commits only metadata', async () => {
    const h = harness();
    let active = 0, maxActive = 0;
    h.ctx.fetchAuthenticatedSupabaseReadPage = async (table, query, options) => {
        h.calls.push(['PAGE', table, query, options]);
        active += 1; maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return { rows: [
            { filename: `${table}-latest-a.xlsx`, last_updated: '2026-10-13T12:00:00Z' },
            { filename: `${table}-latest-b.xlsx`, last_updated: '2026-10-13T12:00:00Z' },
            { filename: `${table}-old.xlsx`, last_updated: '2026-10-12T12:00:00Z' }
        ], total: 3 };
    };
    const adapter = descriptor(h, 'side:homeSyncMetadata');
    assert.equal(JSON.parse(adapter.cacheKey)[2], JSON.stringify(['native:dylan', 'permission-v1']));
    const controller = new AbortController();
    const staged = await adapter.stage({ signal: controller.signal });
    assert.deepEqual(Array.from(staged.entries, entry => entry.table), ['ph_master_inventory', 'ph_soc_master', 'ph_reserves', 'ph_cav_import']);
    assert.ok(staged.entries.every(entry => Array.isArray(entry.rows) && entry.rows.length === 3));
    assert.equal(maxActive, 2, 'metadata source reads run in two bounded concurrent batches');
    const reads = h.calls.filter(call => call[0] === 'PAGE');
    assert.equal(reads.length, 4);
    for (const [, , query] of reads) {
        assert.match(query, /^select=filename,last_updated&last_updated=not\.is\.null&order=last_updated\.desc&limit=30&offset=0$/);
        assert.doesNotMatch(query, /select=\*/);
    }
    adapter.commit(staged);
    assert.equal(h.ctx.dashboardSyncMetadataSummaries.length, 4);
    assert.deepEqual(Array.from(h.ctx.dashboardSyncMetadataSummaries[0].files), ['ph_master_inventory-latest-a.xlsx', 'ph_master_inventory-latest-b.xlsx']);
});

test('manager revision refresh reaches the mounted Company Directory listener only for its visible authorized tab', () => {
    const h = harness();
    class FakeCustomEvent {
        constructor(type, init) { this.type = type; this.detail = init.detail; }
    }
    const listeners = new Set();
    let received = 0;
    const root = {
        isConnected: true, CustomEvent: FakeCustomEvent,
        addEventListener(type, listener) { if (type === 'gnc-manager-source-revision') listeners.add(listener); },
        dispatchEvent(event) { listeners.forEach(listener => listener(event)); return true; }
    };
    h.ctx.document.getElementById = id => id === 'manager-company-directory-root' ? root : null;
    h.ctx.activeHomeTab = 'company-directory';
    h.ctx.getCurrentVisibleViewId = () => 'managers';
    let authorized = true;
    h.ctx.getManagersToolAccess = () => ({ canManageCompanyDirectory: authorized, canViewProductionSchedule: true, canViewHrCommand: true });
    root.addEventListener('gnc-manager-source-revision', event => {
        if (event.detail?.surface === 'company-directory' && authorized) received += 1;
    });

    const adapter = descriptor(h, 'side:companyDirectoryRevision');
    adapter.commit({ verified: true });
    assert.equal(received, 1, 'the event is delivered directly to the mounted component host');
    assert.deepEqual(Array.from(h.ctx.calls.filter(call => call[0] === 'api').map(call => call[1])), []);

    h.ctx.activeHomeTab = 'dashboard';
    adapter.commit({ verified: true });
    assert.equal(received, 1, 'a hidden manager tab receives no refresh event');
    h.ctx.activeHomeTab = 'company-directory';
    authorized = false;
    adapter.commit({ verified: true });
    assert.equal(received, 1, 'permission loss receives no refresh event');
});

test('deferred manual run response clears optimistic Starting state without completion side effects', () => {
    const start = html.indexOf('function handleDeferredManualSyncStart(');
    const end = html.indexOf('\n        async function runGoogleAppsScriptTrigger(', start);
    assert.ok(start > 0 && end > start);
    const calls = [];
    const sandbox = {
        module: { exports: {} }, manualSyncStatusState: { active: true },
        clearManualSyncStatusPoll: () => calls.push('clear-poll'),
        syncGoogleScriptButton: () => calls.push('button'), updateSyncDiagnostics: () => calls.push('diagnostics'),
        showToast: (...args) => calls.push(['toast', ...args])
    };
    vm.runInNewContext(`${html.slice(start, end)}\nmodule.exports = handleDeferredManualSyncStart;`, sandbox);
    const handle = sandbox.module.exports;
    assert.equal(handle({ ok: true, status: 'deferred', code: 'MANUAL_SYNC_PROCESSOR_BUSY', message: 'Busy' }), true);
    assert.equal(sandbox.manualSyncStatusState, null);
    assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ['clear-poll', 'button', 'diagnostics', 'toast']);
    assert.equal(handle({ ok: true, status: 'queued' }), false);
});

test('header timestamp accepts any current-scope data cohort and ignores empty navigation statuses', () => {
    const sandbox = { module: { exports: {} }, Date, JSON, Number, String,
        productionVerifiedViewKey: context => context.expectedKey };
    vm.runInNewContext(`${homeTimestampSource}\nmodule.exports = applyCurrentVerifiedSyncTimestamp;`, sandbox);
    const apply = sandbox.module.exports;
    const context = { view: 'inventory', surfaces: [], adapters: [{ id: 'core:master' }], scope: 'user-1', dataPermissionVersion: 'perm-2', expectedKey: 'home-key' };
    assert.equal(apply({ state: 'Up to date', lastVerifiedAt: 1791892800000, contextKey: 'home-key' }, context), true);
    assert.equal(sandbox.lastSuccessfulSyncTime, new Date(1791892800000).toISOString());
    assert.equal(sandbox.lastSuccessfulSyncOwner, JSON.stringify(['user-1', 'perm-2']));
    for (const status of [
        { state: 'Syncing', lastVerifiedAt: 1791892800000, contextKey: 'home-key' },
        { state: 'Up to date', lastVerifiedAt: 0, contextKey: 'home-key' },
        { state: 'Up to date', lastVerifiedAt: 1791892800000, contextKey: 'old-key' }
    ]) assert.equal(apply(status, context), false);
    assert.equal(apply({ state: 'Up to date', lastVerifiedAt: 1791892800000, contextKey: 'home-key' }, { ...context, adapters: [], expectedKey: 'home-key' }), false);
});

test('permission reset clears the header stamp and cached Home metadata before a new read can pass', () => {
    const sandbox = { module: { exports: {} }, dashboardSyncMetadataSummaries: [{ label: 'SOC' }], dashboardSyncMetadataFetchedAt: 123,
        dashboardSyncMetadataOwner: 'old-owner', lastSuccessfulSyncTime: 'old-stamp', lastSuccessfulSyncOwner: 'old-owner' };
    const resetHomeSource = inlineFunctionSource('resetHomeSuccessfulSyncTimestamp');
    vm.runInNewContext(`${resetHomeSource}\n${resetMetadataSource}\nmodule.exports = resetDashboardSyncMetadataForPermissionChange;`, sandbox);
    sandbox.module.exports();
    assert.equal(sandbox.dashboardSyncMetadataSummaries.length, 0);
    assert.equal(sandbox.dashboardSyncMetadataFetchedAt, 0);
    assert.equal(sandbox.dashboardSyncMetadataOwner, '');
    assert.equal(sandbox.lastSuccessfulSyncTime, '');
    assert.equal(sandbox.lastSuccessfulSyncOwner, '');
});

test('low-stock target adapter updates Assigned Items without invalidating the shared-threshold Eval2 snapshot', async () => {
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
    assert.equal(invalidated, 0);
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
      '20261009053029_reclass_smart_priority_hold_shield_v6.sql',
      '20261009053030_smart_shield_raw_import_acknowledgment.sql',
      '20261009170000_request_queue_remove_v1.sql',
      '20261009202507_prompt25_editable_field_shield_and_hold_clear.sql',
      '20261010024830_customer_rep_mapping_management.sql',
      '20261010080018_bunch_note_auto_completion_delivery.sql',
      '20261010080140_field_counting_commands_and_reports.sql',
      '20261010152556_customer_rep_mapping_finalize_timeout_55s.sql',
      '20261010165013_historical_requests_financial_dashboard.sql',
      '20261010200046_aura_voice_role_access.sql',
      '20261011032352_aura_voice_soc_reads.sql',
      '20261011170000_request_mapping_salesrep_identity.sql',
      '20261011193000_historical_requests_price_fallback.sql',
      '20261011223000_reclass_concurrent_hold_rows.sql',
      '20261011224500_normalize_sales_actor_role_boundaries.sql',
      '20261011230000_normalize_navigation_role_boundaries.sql',
      '20261012011000_request_history_drilldown_isolation.sql',
      '20261012052500_aura_enterprise_domain_voice.sql',
      '20261012153000_aura_account_rollout.sql',
    '20261012180000_sales_rep_inventory_operations.sql',
      '20261012190002_manager_report_read_v2.sql',
      '20261012190003_manager_list_read_v2.sql',
      '20261013160000_inventory_location_item_on_hand.sql',
      '20261013170000_master_inventory_realtime_publication.sql',
      '20261014110620_eval2_shared_low_stock_threshold.sql',
      '20261014140147_master_lineage_cleanup_bounded.sql',
      '20261014142125_season_sales_cav_lookup_index.sql',
      '20261014144043_season_sales_skip_empty_mirror_cleanup.sql',
      '20261014145025_season_sales_reconciliation_worklist.sql',
      '20261014155536_inventory_assignment_reconciliation_batches.sql',
      '20261014160924_inventory_assignment_witness_projection.sql',
      '20261014161813_inventory_assignment_input_generation.sql',
      '20261014173230_suspend_tag_close_inventory_sync.sql',
      '20261014190535_application_conflict_http_status.sql',
      '20261014205926_transpose_imported_salesrep_names.sql',
      '20261014214542_customer_assignment_overrides.sql',
      '20261015012249_bulk_master_snapshot_v1.sql',
      '20261015165733_import_history_routing.sql',
      '20261015183500_handover_master_assignment_fast_path.sql',
      '20261015192500_bulk_context_index_plan.sql',
      '20261015213506_manager_module_revision_signals.sql',
      '20261015230000_inventory_reclass_moves_v1.sql',
      '20261016093000_reclass_quantity_update_trigger_fastpaths_v1.sql',
      '20261016120000_reclass_compact_trigger_identity_v1.sql',
      '20261016140000_reclass_compact_batch_child_receipts_v1.sql',
      '20261016160000_reclass_null_elision_rpc_v1.sql',
      '20261017110000_inventory_master_identity_batch_read_v1.sql',
      '20261017203000_bunch_note_multi_assignment_routing.sql',
      '20261018014347_bunch_note_blueprint_header_pdf_delivery.sql',
      '20261018183204_bunch_note_queue_execution_and_recounts.sql',
      '20261019003759_bunch_note_supervisor_assignee_facets_v1.sql',
      '20261019113414_suspend_tag_sender_identity.sql',
      '20261019163128_canonical_user_access_control_v1.sql',
      '20261019172019_inventory_reclass_move_delivery_v1.sql',
      '20261019225625_master_snapshot_chunked_staging_v1.sql',
      '20261019234222_identity_batch_not_ready_retry_sqlstate.sql',
      '20261020150827_v2315_reclass_email_report_policy.sql',
      '20261020161833_published_lkg_read_proof_v1.sql',
      '20261020204855_reclass_server_revision_and_failed_stage_lease_v1.sql',
      '20261020233500_reclass_rep_scope_preservation_v1.sql',
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
