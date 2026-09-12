import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');
const adapterSource = readFileSync(new URL('../assets/live-sync-adapters.js', import.meta.url), 'utf8');
const start = html.indexOf('function createProductionLiveSyncSideAdapters()');
const end = html.indexOf('async function loadAvOptionEvalRequests(', start);
assert.ok(start > 0 && end > start);
const factorySource = html.slice(start, end);
function harness() {
    const calls = [];
    const rows = [{ unique_id: 'new', source_unique_id: 'new', id: 'new', tripnumber: 'T1', issueSourceUniqueId: 'new', allocationUniqueId: 'new', UNIQUE_ID: 'new', conversationId: 'new' }];
    const ctx = { Date, Object, Array, Map, Set, String, Number, JSON, Promise, encodeURIComponent, console, calls, window: {},
        fetchAllSupabaseRows: async (table, query) => { calls.push(['GET', table, query]); return table === 'ph_crop_roll_runs' ? [] : rows; },
        fetchPoManagementRows: async () => { calls.push(['GET', 'po']); return rows; },
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
            return {};
        },
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
        APP_SHELL_VERSION: 'fixture', APP_SHELL_BUILD: 'fixture', REQUEST_EMAIL_SCRIPT_TIMEOUT_MS: 1000,
        dockTeamStatusByTrip: new Map([['old', {}]]), dockItemProgressByUid: new Map([['old', {}]]),
        dockIssueStatusByUid: new Map([['old', {}]]), dockIssueAllocationsById: new Map([['old', {}]]), dockIssueAllocationsBySourceUid: new Map([['old', []]]),
        dockTeamStatusRenderVersion: 0, productionWorkflowState: {}, spreadCountState: {}, shearListState: { openInquiryIds: new Set(), draft: 'keep me' },
        departmentCalendarState: {}, weatherHoldState: {}, poManagementState: {}, managerOrdersState: { draft: 'preserve' },
        managerEvalReportSettingsState: {}, productivityState: {}, productivityHistoryByUser: new Map(),
        inventoryTransactionHistoryState: {}, bloomscapesPendingState: {}, managerTransactionsKeyedState: {}, managerHistoricalReportState: {},
        accessControlAdminState: { editor: { draft: 'keep' } }, codexOpsState: { draft: 'keep' }, activeChatConversationId: 'new'
    };
    const constantNames = [...factorySource.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)].map((entry) => entry[0]);
    for (const name of constantNames) if (!(name in ctx)) ctx[name] = name.toLowerCase();
    for (const name of [...factorySource.matchAll(/\b(can[A-Za-z]+|is[A-Za-z]+)\(/g)].map((entry) => entry[1])) if (!(name in ctx)) ctx[name] = () => true;
    ctx.isKaylaLimitedAccessManagerUser = () => false;
    vm.createContext(ctx);
    vm.runInContext(`${registrySource}\n${adapterSource}`, ctx);
    ctx.window.AgMetricLiveSyncRegistry = ctx.AgMetricLiveSyncRegistry;
    ctx.window.AgMetricLiveSyncAdapters = ctx.AgMetricLiveSyncAdapters;
    vm.runInContext(factorySource, ctx);
    return { ctx, calls, rows, api: ctx.createProductionLiveSyncSideAdapters() };
}
const context = { scope: 'user:division', username: 'dylan_collyge', productionType: 'spacing', countType: 'spread', productivityUser: 'dylan_collyge', managerOrders: { level: 'sources', sourceKey: '', assignees: [], rowCount: 0, batchCount: 0 }, pendingOrderCount: 0, transactions: {}, transactionsKeyed: { dateCount: 0, fileCount: 0 }, historical: { level: 'names', columns: [], search: '', rowCount: 0 }, accessQuery: {}, codexTaskId: '' };

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
        const item = descriptor(h, `side:${id}`, { countType: id === 'bunchCounts' ? 'bunch' : 'spread' });
        assert.ok(item, id);
        const staged = await item.stage();
        assert.notEqual(staged, undefined, id);
        assert.equal(item.commit(staged), undefined, id);
    }
    for (const call of h.calls) {
        assert.ok(['GET', 'RPC', 'dock', 'eval', 'location', 'shear', 'codex', 'script'].includes(call[0]), JSON.stringify(call));
        if (['dock', 'eval', 'location', 'shear'].includes(call[0])) assert.ok(['list', 'get'].includes(call[1]), JSON.stringify(call));
        if (call[1] === 'bloomscapes_pending_command') assert.equal(call[2].p_action, 'state');
    }
    assert.equal(h.ctx.shearListState.draft, 'keep me');
    assert.equal(h.ctx.accessControlAdminState.editor.draft, 'keep');
    assert.equal(h.ctx.codexOpsState.draft, 'keep');
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
    for (const view of ['docks', 'reports', 'reserves', 'building', 'request']) assert.ok(registry.getViewAdapters(view).includes('side:settings'), view);
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
    const migrations = readdirSync(directory).filter((name) => name.endsWith('_live_dataset_revisions.sql'));
    assert.ok(migrations.length, 'live revision migration is missing');
    const sql = migrations.map((name) => readFileSync(new URL(name, directory), 'utf8')).join('\n');
    const keys = h.ctx.AgMetricLiveSyncRegistry.sourceKeys;
    for (const key of keys) assert.ok(sql.includes(`('${key}',`), `Unregistered backend source ${key}`);
    for (const view of Object.keys(h.ctx.AgMetricLiveSyncRegistry.views)) {
        const ids = h.ctx.AgMetricLiveSyncRegistry.getViewAdapters(view, { surfaces: ['badge:queue', 'badge:communications'] });
        assert.ok(h.ctx.AgMetricLiveSyncRegistry.getSourceKeys(ids).length <= 64, `${view} exceeds the metadata request cap`);
    }
});
