import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// These are integration-style unit tests against the actual R1 coordinator,
// not a readiness stub. R1 must be merged before this R2 suite is executed.
const sandbox = { module: { exports: {} }, setTimeout, clearTimeout };
for (const name of ['inventory-list-contract', 'master-detail-snapshots', 'live-sync-coordinator']) {
    vm.runInNewContext(readFileSync(new URL('../assets/' + name + '.js', import.meta.url), 'utf8'), sandbox);
}
const { createStore } = sandbox.AgMetricMasterDetailSnapshots;
const { createCoordinator } = sandbox.AgMetricLiveSync;
const inventory = sandbox.AgMetricInventoryList;
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const row = (id, extra = {}) => ({ unique_id: id, itemcode: 'ITEM-' + id, unitprice: '4.50', customeridentityid: null, ...extra });

function fixture(options = {}) {
    const state = {
        revision: '1', permission: 'permission-1', sourceState: 'ready',
        rows: options.rows || [row('A'), row('B'), row('C'), row('D'), row('E')],
        fetches: [], commits: [], refreshes: [], statuses: [], fetchHook: null
    };
    const context = { scope: 'account-A/role-1', permissionVersion: state.permission, revision: state.revision,
        viewKey: 'detail', visible: true, online: true, adapters: [], backgroundAdapters: [] };
    const timers = new Map();
    let timerId = 0, store;
    const coordinator = createCoordinator({
        getContext: () => context,
        readRevisions: async (keys) => ({ contractVersion: 1, permissionVersion: state.permission,
            sources: keys.map((key) => ({ key, revision: state.revision, state: key === 'ph_master_inventory' ? state.sourceState : 'ready' })) }),
        commitSnapshots: (staged, ctx, metadata) => {
            // Production updates these from the joined verified master adapter.
            context.permissionVersion = metadata.permissionVersion;
            context.revision = metadata.sources.get('ph_master_inventory')?.revision || context.revision;
            staged.forEach(({ adapter, value }) => {
                state.commits.push({ adapter, value: plain(value), scope: ctx.scope });
                adapter.commit?.(value, ctx, metadata);
            });
        },
        onPermissionChange: async (permission) => { state.refreshes.push(permission); },
        onStatus: (status) => state.statuses.push(status),
        loadSnapshot: options.storage ? async (adapter) => options.storage.get(adapter.cacheKey) || null : undefined,
        saveSnapshot: options.storage ? async (entry) => { options.storage.set(entry.cacheKey, plain(entry)); } : undefined,
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: (id) => timers.delete(id)
    });
    store = createStore({
        getCoordinator: () => coordinator,
        getContext: () => context,
        inventoryContract: inventory,
        batchSize: options.batchSize || 2,
        formatRows: options.formatRows || ((rows) => rows.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key.toUpperCase(), value])))),
        fetchExactRows: async (ids, ctx) => {
            const read = { ids: Array.from(ids), scope: ctx.scope, revision: state.revision };
            state.fetches.push(read);
            const captured = state.rows.filter((item) => ids.includes(item.unique_id));
            if (state.fetchHook) {
                const response = await state.fetchHook(ids, read, captured);
                if (response !== undefined) return response;
            }
            return captured;
        }
    });
    function activate(ids, view = 'detail') {
        const adapter = store.getAdapter(ids);
        context.viewKey = view;
        context.adapters = adapter ? [adapter] : [];
        return adapter;
    }
    return { store, coordinator, context, state, timers, activate };
}

test('adapter identity is frozen, exact-set stable, versioned and scope-specific', () => {
    const f = fixture();
    const adapter = f.store.getAdapter([' B ', 'A', 'B']);
    assert.equal(adapter, f.store.getAdapter(['A', 'B']));
    assert.equal(adapter.id, 'side:master-detail:["A","B"]');
    assert.deepEqual(Array.from(adapter.ids), ['A', 'B']);
    assert.deepEqual(Array.from(adapter.sourceKeys), ['ph_master_inventory']);
    assert.equal(Object.isFrozen(adapter), true);
    assert.equal(Object.isFrozen(adapter.ids), true);
    assert.match(adapter.cacheKey, /master-detail-v1/);
    assert.match(adapter.cacheKey, /select=\*/);
    f.context.scope = 'account-B/role-1';
    assert.notEqual(f.store.getAdapter(['A', 'B']).cacheKey, adapter.cacheKey);
    assert.equal(f.store.getAdapter([]), null);
    assert.throws(() => f.store.getAdapter(['']), /missing exact unique ID/);
    assert.throws(() => f.store.getAdapter([42]), /missing exact unique ID/);
    assert.throws(() => f.store.getAdapter('A'), /array of exact unique IDs/);
});

test('all IDs, not a visible page, are batched and only then returned as verified full rows', async () => {
    const f = fixture();
    f.activate(['E', 'A', 'D', 'C', 'B']);
    assert.equal(f.store.getVerifiedRows(['A']), null);
    const rows = await f.store.ensure(['E', 'D', 'C', 'B', 'A']);
    assert.deepEqual(plain(rows.map((item) => item.UNIQUE_ID)), ['A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(f.state.fetches.map((read) => read.ids), [['A', 'B'], ['C', 'D'], ['E']]);
    assert.equal(f.state.commits.length, 1);
    const fence = { scope: f.context.scope, permissionVersion: 'permission-1', revision: '1', uniqueId: 'A' };
    assert.equal(inventory.isDetailRow(rows[0], fence), true);
    assert.equal(inventory.isListRow(rows[0]), false);
    assert.equal(Object.isFrozen(inventory.getCompleteness(rows[0])), true);
    assert.equal(Object.keys(rows[0]).includes(inventory.metadataKey), false);
    assert.equal(rows[0].CUSTOMERIDENTITYID, null);
    assert.equal(rows[0].UNITPRICE, '4.50');
    assert.equal(inventory.isDetailRow(rows[0], { ...fence, permissionVersion: 'other' }), false);
    assert.equal(inventory.isDetailRow(rows[0], { ...fence, revision: '2' }), false);
});

test('a formatter and caller may mutate detached copies without changing canonical server values', async () => {
    let formattedInput;
    const sharedAppRow = row('A', { details: { original: true }, customeridentityid: null });
    const f = fixture({ rows: [sharedAppRow], formatRows: (rows) => {
        formattedInput = rows;
        rows[0].client_display = 'formatted';
        return rows;
    } });
    f.activate(['A']);
    const first = await f.store.ensure(['A']);
    first[0].unitprice = 'draft';
    first[0].details.original = false;
    formattedInput[0].details.original = false;
    sharedAppRow.unitprice = 'mutated fetch response';
    const second = f.store.getVerifiedRows(['A']);
    assert.equal(second[0].unitprice, '4.50');
    assert.equal(second[0].details.original, true);
    assert.equal(second[0].client_display, 'formatted');
    assert.equal(inventory.getCompleteness(sharedAppRow), null);
    assert.equal(f.state.commits[0].value.rows[0].client_display, undefined);
});

for (const [name, response] of [
    ['missing/deleted ID', [row('A')]],
    ['duplicate ID', [row('A'), row('A')]],
    ['unexpected ID', [row('A'), row('Z')]],
    ['missing row identity', [row('A'), { itemcode: 'ITEM-B' }]],
    ['conflicting aliases', [row('A'), row('B', { UNIQUE_ID: 'A' })]],
    ['non-row response', [row('A'), null]],
    ['non-array response', { rows: [row('A'), row('B')] }],
    ['list projection', [row('A'), inventory.markListRow(row('B'))]]
]) {
    test(name + ' cannot establish full-row verification', async () => {
        const f = fixture(); f.activate(['A', 'B']);
        f.state.fetchHook = async () => response;
        assert.equal(await f.store.ensure(['A', 'B']), null);
        assert.equal(f.store.getVerifiedRows(['A', 'B']), null);
        assert.equal(f.state.commits.length, 0);
        assert.equal(f.coordinator.getStatus().state, 'Needs attention');
    });
}

test('an import changing between batches never commits mixed revisions', async () => {
    const f = fixture({ rows: [row('A', { unitprice: 'old' }), row('B', { unitprice: 'old' })], batchSize: 1 });
    f.activate(['A', 'B']);
    f.state.fetchHook = async (_ids, read, captured) => {
        if (read.ids[0] === 'B' && read.revision === '1') {
            f.state.revision = '2';
            f.state.rows = [row('A', { unitprice: 'new' }), row('B', { unitprice: 'new' })];
        }
        return captured;
    };
    const rows = await f.store.ensure(['A', 'B']);
    assert.deepEqual(plain(rows.map((item) => item.UNITPRICE)), ['new', 'new']);
    assert.equal(f.state.commits.length, 1);
    assert.equal(f.state.fetches.length, 4);
    assert.equal(inventory.getCompleteness(rows[0]).revision, '2');
});

test('a missing row in the last batch cannot publish earlier successful batches', async () => {
    const f = fixture({ batchSize: 1 }); f.activate(['A', 'B', 'C']);
    f.state.fetchHook = async (ids, _read, captured) => ids[0] === 'C' ? [] : captured;
    assert.equal(await f.store.ensure(['A', 'B', 'C']), null);
    assert.equal(f.state.fetches.length, 3);
    assert.equal(f.state.commits.length, 0);
    assert.equal(f.store.getVerifiedRows(['A', 'B', 'C']), null);
});

test('continuous source revision changes respect the real coordinator retry bound', async () => {
    const f = fixture(); f.activate(['A']);
    f.state.fetchHook = async (_ids, _read, captured) => {
        f.state.revision = String(Number(f.state.revision) + 1);
        return captured;
    };
    assert.equal(await f.store.ensure(['A']), null);
    assert.equal(f.state.fetches.length, 3);
    assert.equal(f.state.commits.length, 0);
    assert.equal(f.store.getVerifiedRows(['A']), null);
});

test('imports, interrupted imports and denied sources revoke previous full-row readiness', async () => {
    const f = fixture(); f.activate(['A']);
    assert.ok(await f.store.ensure(['A']));
    for (const sourceState of ['importing', 'interrupted', 'unavailable']) {
        f.state.sourceState = sourceState;
        await f.coordinator.check();
        assert.equal(f.store.getVerifiedRows(['A']), null);
        assert.equal(await f.store.ensure(['A']), null);
    }
    assert.equal(f.state.fetches.length, 1);
    f.state.sourceState = 'ready'; f.state.revision = '2';
    f.state.rows = [row('A', { unitprice: 'after import' })];
    const rows = await f.store.ensure(['A']);
    assert.equal(rows[0].UNITPRICE, 'after import');
});

test('scope, permission and revision markers must match the current context even when the adapter is verified', async () => {
    const f = fixture(); f.activate(['A']); await f.store.ensure(['A']);
    f.context.permissionVersion = 'permission-other';
    assert.equal(f.store.getVerifiedRows(['A']), null);
    f.context.permissionVersion = 'permission-1'; f.context.revision = '2';
    assert.equal(f.store.getVerifiedRows(['A']), null);
    f.context.revision = '1'; assert.ok(f.store.getVerifiedRows(['A']));
    f.context.scope = 'account-B/role-1'; assert.equal(f.store.getVerifiedRows(['A']), null);
    f.context.scope = 'account-A/role-1'; assert.equal(f.store.getVerifiedRows(['A']), null);
});

test('permission changes require real coordinator refresh and restamp the full-row cache', async () => {
    const f = fixture(); f.activate(['A']); await f.store.ensure(['A']);
    f.state.permission = 'permission-2'; f.context.permissionVersion = 'permission-2';
    assert.equal(f.store.getVerifiedRows(['A']), null);
    await f.coordinator.check();
    const rows = await f.store.ensure(['A']);
    assert.ok(rows);
    assert.deepEqual(f.state.refreshes, ['permission-2']);
    assert.equal(inventory.getCompleteness(rows[0]).permissionVersion, 'permission-2');
    assert.equal(f.state.fetches.length, 2);
});

test('account changes while a batch is loading cannot cache or return old-account rows', async () => {
    const f = fixture(); f.activate(['A']);
    const gate = deferred(); f.state.fetchHook = () => gate.promise;
    const waiting = f.store.ensure(['A']); await settle();
    f.context.scope = 'account-B/role-1';
    f.activate([], 'home');
    gate.resolve();
    assert.equal(await waiting, null);
    assert.equal(f.state.commits.length, 0);
    assert.equal(f.store.getVerifiedRows(['A']), null);
    f.state.fetchHook = null; f.state.rows = [row('A', { unitprice: 'account B' })]; f.activate(['A']);
    assert.equal((await f.store.ensure(['A']))[0].UNITPRICE, 'account B');
});

test('navigation may retain a valid canonical read but never returns it until the requested adapter is verified', async () => {
    const f = fixture(); f.activate(['A'], 'detail:A');
    const gate = deferred(); f.state.fetchHook = () => gate.promise;
    const first = f.store.ensure(['A']); await settle();
    f.activate([], 'other-view'); gate.resolve();
    assert.equal(await first, null);
    assert.equal(f.state.commits.length, 0);
    assert.equal(f.store.getVerifiedRows(['A']), null);
    f.state.fetchHook = null; f.activate(['A'], 'detail:A');
    assert.equal((await f.store.ensure(['A']))[0].UNIQUE_ID, 'A');
    assert.equal(f.state.fetches.length, 1, 'R1 reuses the valid in-flight canonical server value');
});

test('reset fences pending batches and cannot be undone by their late completion', async () => {
    const f = fixture(); const oldAdapter = f.activate(['A']);
    const gate = deferred(); f.state.fetchHook = () => gate.promise;
    const first = f.store.ensure(['A']); await settle();
    f.store.reset(); const nextAdapter = f.store.getAdapter(['A']);
    f.context.adapters = []; f.context.viewKey = 'home';
    assert.notEqual(nextAdapter.cacheKey, oldAdapter.cacheKey);
    gate.resolve(); await first;
    assert.equal(f.store.getVerifiedRows(['A']), null);
    f.state.fetchHook = null; f.activate(['A']);
    assert.equal((await f.store.ensure(['A']))[0].UNIQUE_ID, 'A');
});

test('hidden and offline contexts cannot expose previously verified full rows', async () => {
    const f = fixture(); f.activate(['A']); await f.store.ensure(['A']);
    f.context.visible = false;
    assert.equal(f.store.getVerifiedRows(['A']), null);
    assert.equal(await f.store.ensure(['A']), null);
    f.context.visible = true; f.context.online = false;
    assert.equal(f.store.getVerifiedRows(['A']), null);
    assert.equal(await f.store.ensure(['A']), null);
    assert.equal(f.state.fetches.length, 1);
});

test('a slow background badge does not delay exact-row ensure completion', async () => {
    const f = fixture(); f.activate(['A']);
    const badge = deferred(); let badgeStarted = false;
    f.context.backgroundAdapters = [{ id: 'side:badge', cacheKey: 'badge', sourceKeys: ['ph_active_request'],
        stage: async () => { badgeStarted = true; return badge.promise; }, commit: () => {} }];
    assert.equal((await f.store.ensure(['A']))[0].UNIQUE_ID, 'A');
    await settle(); assert.equal(badgeStarted, true);
    assert.equal(f.state.commits.some((entry) => entry.adapter.id === 'side:badge'), false);
    badge.resolve([]); await settle();
});

test('unchanged persisted snapshots are reused and formatted without another server row read', async () => {
    const storage = new Map();
    const first = fixture({ storage }); first.activate(['A', 'B']); await first.store.ensure(['A', 'B']); await settle();
    assert.equal(storage.size, 1);
    const second = fixture({ storage }); second.activate(['A', 'B']);
    const rows = await second.store.ensure(['A', 'B']);
    assert.equal(rows.length, 2);
    assert.equal(second.state.fetches.length, 0);
    assert.equal(inventory.getCompleteness(rows[0]).scope, second.context.scope);
    rows[0].UNITPRICE = 'draft';
    assert.equal(second.store.getVerifiedRows(['A', 'B'])[0].UNITPRICE, '4.50');
});

test('persisted rows with incompatible inner identity fail closed instead of being marked full', async () => {
    const storage = new Map();
    const first = fixture({ storage }); first.activate(['A']); await first.store.ensure(['A']); await settle();
    const entry = storage.values().next().value;
    entry.value.scope = 'another-account';
    const second = fixture({ storage }); second.activate(['A']);
    assert.equal(await second.store.ensure(['A']), null);
    assert.equal(second.store.getVerifiedRows(['A']), null);
});

test('a malformed formatter cannot tag unrelated app rows as verified details', async () => {
    const appRow = row('Z');
    const f = fixture({ formatRows: () => [appRow] }); f.activate(['A']);
    await assert.rejects(f.store.ensure(['A']), /unexpected row identity/);
    assert.equal(inventory.getCompleteness(appRow), null);
});

test('empty ID sets do not require a session or trigger any row read', async () => {
    const f = fixture(); f.context.scope = '';
    assert.deepEqual(plain(await f.store.ensure([])), []);
    assert.deepEqual(plain(f.store.getVerifiedRows([])), []);
    assert.equal(f.state.fetches.length, 0);
    assert.equal(await f.store.ensure(['A']), null);
});

const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function appFunction(name) {
    const start = app.search(new RegExp(`        (?:async )?function ${name}\\(`));
    assert.notEqual(start, -1, name);
    const end = app.indexOf('\n        }', start);
    assert.notEqual(end, -1, name + ' closes');
    return app.slice(start, end + '\n        }'.length);
}
function bindingFixture(f) {
    const context = vm.createContext({ Map, Set, WeakMap, Object, JSON, String,
        productionMasterDetailBindings: new WeakMap(), activeItem: null,
        getDatasetState: () => ({ listProjectionVersion: 'master-list-v1' }),
        getProductionMasterDetailContext: () => f.context,
        getProductionMasterDetailStore: () => f.store,
        getMasterInventoryExactKey: () => '',
    });
    const names = ['usesProductionMasterListProjection', 'getProductionMasterDetailIds',
        'getProductionMasterDetailIdentity', 'productionMasterDetailFenceMatches',
        'bindProductionMasterDetailRow', 'hasProductionMasterDetailForItem'];
    vm.runInContext(names.map(appFunction).join('\n'), context);
    return context;
}

test('real app detail binding rejects a linked ID or source identity mutation on the same object', async () => {
    const f = fixture(); f.activate(['A']); await f.store.ensure(['A']);
    const ctx = bindingFixture(f);
    const item = { UNIQUE_ID: 'owned-1', SOURCE_TABLE: 'ph_active_request', MASTER_ID: 'A' };
    ctx.bindProductionMasterDetailRow(item, ['A']);
    assert.equal(ctx.hasProductionMasterDetailForItem(item), true);
    item.MASTER_ID = 'B';
    assert.equal(ctx.hasProductionMasterDetailForItem(item), false);
    item.MASTER_ID = 'A'; item.master_id = 'B';
    assert.equal(ctx.hasProductionMasterDetailForItem(item), false);
    assert.throws(() => ctx.getProductionMasterDetailIds(item), /conflicting/);
    delete item.master_id; delete item.MASTER_ID;
    assert.equal(ctx.hasProductionMasterDetailForItem(item), false);
    item.MASTER_ID = 'A'; item.SOURCE_TABLE = 'ph_sales_office';
    assert.equal(ctx.hasProductionMasterDetailForItem(item), false);
    item.SOURCE_TABLE = 'ph_active_request'; item.UNIQUE_ID = 'owned-2';
    assert.equal(ctx.hasProductionMasterDetailForItem(item), false);
    item.UNIQUE_ID = 'owned-1';
    assert.equal(ctx.hasProductionMasterDetailForItem(item), true);
});

test('persisted evidence restores only to the DOM sidecar and leaves verified server baseline immutable', async () => {
    const f = fixture({ rows: [row('A', { spec: 'SERVER SPEC', sales_note: 'SERVER NOTE' })] });
    f.activate(['A']); await f.store.ensure(['A']);
    const ctx = bindingFixture(f);
    ctx.activeItem = { ...f.store.getVerifiedRows(['A'])[0], SOURCE_TABLE: 'ph_master_inventory' };
    ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']);
    const inputs = new Map(['na-spec', 'na-comments'].map((id) => [id,
        { id, value: 'server form', disabled: false, closest: () => true }]));
    ctx.document = { getElementById: (id) => inputs.get(id) };
    ctx.detailHydrationInputEditContexts = new WeakMap();
    ctx.detailHydrationToken = 1; ctx.activeDetailSourceView = 'drive'; ctx.lastView = 'drive';
    ctx.getCurrentVisibleViewId = () => 'detail';
    ctx.isLoginSessionOwnershipCurrent = (owner) => owner === 'account-A';
    ctx.getDetailHydrationDraftContext = () => ({ token: 1 });
    ctx.getEditableLocMatchPercentValue = (value) => String(value || '');
    ctx.canEditRowDetails = () => f.coordinator.isVerified(f.store.getAdapter(['A']));
    ctx.productionMasterDetailSession = { token: 1, owner: 'account-A', sourceView: 'drive', status: 'ready',
        rowIdentity: ctx.getProductionMasterDetailIdentity(ctx.activeItem),
        pendingEvidence: { spec: 'LOCAL DRAFT', comments: 'RECOVERABLE COMMENT' } };
    vm.runInContext(['isProductionMasterDetailSessionCurrent', 'restoreProductionMasterDetailDraft'].map(appFunction).join('\n'), ctx);
    ctx.restoreProductionMasterDetailDraft();
    assert.equal(inputs.get('na-spec').value, 'LOCAL DRAFT');
    assert.equal(inputs.get('na-comments').value, 'RECOVERABLE COMMENT');
    assert.equal(ctx.activeItem.SPEC, 'SERVER SPEC');
    assert.equal(ctx.activeItem.SALES_NOTE, 'SERVER NOTE');
    assert.equal(f.store.getVerifiedRows(['A'])[0].SPEC, 'SERVER SPEC');
    assert.equal(ctx.detailHydrationInputEditContexts.get(inputs.get('na-spec')).token, 1);
    inputs.get('na-spec').value = 'NEWER TYPING';
    ctx.restoreProductionMasterDetailDraft();
    assert.equal(inputs.get('na-spec').value, 'NEWER TYPING');
});
