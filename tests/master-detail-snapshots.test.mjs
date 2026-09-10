import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

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
        onVerified: (ctx) => options.onVerified?.(ctx),
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
        productionMasterDetailBindings: new WeakMap(), productionMasterDetailSession: null, activeItem: null,
        getDatasetState: () => ({ listProjectionVersion: 'master-list-v1' }),
        getProductionMasterDetailContext: () => f.context,
        getProductionMasterDetailStore: () => f.store,
        getMasterInventoryExactKey: () => '',
    });
    const names = ['usesProductionMasterListProjection', 'getProductionMasterDetailIds',
        'getProductionMasterDetailIdentity', 'productionMasterDetailFenceMatches',
        'bindProductionMasterDetailRow', 'isProductionMasterDetailBindingCurrent', 'hasProductionMasterDetailForItem'];
    vm.runInContext(names.map(appFunction).join('\n'), context);
    return context;
}

async function ownSaveFixture() {
    const initial = Object.fromEntries(inventory.physicalColumns.map((key) => [key, null]));
    Object.assign(initial, { unique_id: 'A', itemcode: 'ITEM-A', locationcode: 'LOC', lotcode: 'LOT',
        last_updated: '2026-09-10T12:00:00Z', app_tab_assignment: 'notes', av_note: '', photo_link: '', spec: 'OLD SPEC' });
    let ctx, owner = 1, epoch = 1;
    const f = fixture({ rows: [initial], onVerified: () => ctx?.onProductionMasterDetailsVerified(),
        formatRows: (rows) => rows.map((raw) => ({ ...Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null).map(([key, value]) => [key.toUpperCase(), value])),
            SOURCE_TABLE: 'ph_master_inventory', source_table: 'ph_master_inventory' })) });
    const adapter = f.activate(['A']); await f.store.ensure(['A']);
    ctx = bindingFixture(f);
    const dom = new JSDOM('<div id="view-detail"><input id="na-av-note" value="LOCAL DRAFT"><button id="other">Other</button></div>');
    const deadlines = new Map();
    Object.assign(ctx, {
        window: { AgMetricInventoryList: inventory }, document: dom.window.document, structuredClone, AbortController,
        productionMasterDetailSaveQueues: new Map(), navigator: { onLine: true },
        activeDetailSourceView: 'drive', lastView: 'drive', detailHydrationToken: 1,
        captureLoginSessionOwnership: () => owner, isLoginSessionOwnershipCurrent: (value) => value === owner,
        getSupabaseReadIdentityScope: () => JSON.stringify([f.context.scope, f.state.permission, epoch]),
        getCurrentVisibleViewId: () => 'detail', getProductionLiveSyncCoordinator: () => f.coordinator,
        getProductionDetailDatasetKeys: () => ['master'], canUseVerifiedProductionData: () => f.coordinator.isVerified(adapter),
        productionMasterDetailDisabledControls: new WeakMap(), argosInventoryTransactionState: null,
        refreshDrivePhotoDraftUi: () => {}, refreshProtectedSections: () => {}, applyCameraPermissions: () => {}, applyAvDetailReadOnlyState: () => {},
        renderProductionMasterDetailState: () => {}, scheduleDeferredDetailHydration: () => { throw new Error('Own save must not schedule a form repaint'); },
        setTimeout: (callback, delay) => { deadlines.set(callback, delay); return callback; }, clearTimeout: (callback) => deadlines.delete(callback),
    });
    vm.runInContext(['isProductionMasterDetailSessionCurrent', 'captureProductionMasterDetailOwnSave',
        'isProductionMasterDetailOwnSaveCurrent', 'productionMasterCanonicalRowsMatch',
        'continueProductionMasterDetailOwnSave', 'finishProductionMasterDetailOwnSave',
        'applyProductionMasterDetailControlState', 'onProductionMasterDetailsVerified', 'runDeferredDetailHydration',
        'runWithProductionMasterDetailSaveQueue'].map(appFunction).join('\n'), ctx);
    ctx.activeItem = f.store.getVerifiedRows(['A'])[0]; ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']);
    ctx.productionMasterDetailSession = { token: 1, owner, sourceView: 'drive', status: 'ready', ids: ['A'],
        rowIdentity: ctx.getProductionMasterDetailIdentity(ctx.activeItem) };
    const input = dom.window.document.getElementById('na-av-note'); input.focus(); input.setSelectionRange(2, 5);
    return { f, ctx, dom, input, initial, deadlines,
        switchOwner: () => { owner++; epoch++; }, changeEpoch: () => { epoch++; },
        acknowledge: (patch = {}) => { const ack = { ...f.state.rows[0], av_note: 'SAVED NOTE', last_updated: '2026-09-10T12:01:00Z', ...patch };
            f.state.rows = [ack]; f.state.revision = String(Number(f.state.revision) + 1); return structuredClone(ack); } };
}

test('overlapping note/photo RPCs without Web Locks each verify their acknowledgement and release the local queue', async () => {
    const h = await ownSaveFixture(), { ctx, f } = h;
    const gate = deferred(); let calls = 0, ids = 0;
    Object.assign(ctx, {
        runWithDriveEvidenceCrossTabLock: async (_uid, runner) => runner(),
        mergePhotoCsvList: (values) => [...new Set(values.flatMap((value) => String(value || '').split(',')).filter(Boolean))].join(','),
        createStableClientBatchId: () => String(++ids), getDetailRowWriteTimeoutMs: () => 1000,
        waitForDriveEvidenceRetry: async () => {}, clearDriveEvidenceConflict: () => {},
        supabaseRpc: async (operation, payload) => {
            assert.equal(operation, 'save_drive_evidence_v2'); calls++;
            if (calls === 1) await gate.promise;
            const ack = h.acknowledge({ ...payload.p_evidence, last_updated: `2026-09-10T12:0${calls}:00Z` });
            return { ok: true, canonicalConfirmed: true, row: ack, requestRows: [] };
        },
    });
    vm.runInContext(`const SECURE_DRIVE_EVIDENCE_PREFIXES = new Set(['ssn-', 'lsn-', 'na-']);
        const DRIVE_EVIDENCE_TERMINAL_CONFLICT_CODES = new Set(['DRIVE_FIELD_CONFLICT']);
        const driveEvidenceAbortControllers = new Map();
        ${['firstNonEmptyValue', 'buildSecureDriveEvidencePayload', 'buildSecureDriveEvidenceBaseline',
            'normalizeDriveEvidenceComparable', 'buildSecureDriveEvidencePatch', 'getSecureDriveEvidenceWorkflow',
            'saveSecureDriveEvidence'].map(appFunction).join('\n')}`, ctx);
    const original = { ...ctx.activeItem };
    const first = ctx.saveSecureDriveEvidence(original, 'na-', { av_note: 'SAVED NOTE' }, false);
    const second = ctx.saveSecureDriveEvidence({ ...original }, 'na-', { photo_link: 'https://photos.invalid/second.webp' }, false);
    await settle(); assert.equal(calls, 1); assert.equal(ctx.productionMasterDetailSaveQueues.size, 1);
    gate.resolve(); const results = await Promise.all([first, second]);
    assert.equal(results.every((result) => result.canonicalConfirmed), true);
    assert.equal(calls, 2, 'exactly one business write per distinct user operation');
    assert.equal(ctx.productionMasterDetailSaveQueues.size, 0);
    assert.equal(ctx.productionMasterDetailSession.ownSave, null);
    assert.equal(ctx.hasProductionMasterDetailForItem(ctx.activeItem), true, 'the second queued save also advanced its exact binding');
    assert.equal(ctx.activeItem.AV_NOTE, 'SAVED NOTE');
    assert.equal(ctx.activeItem.PHOTO_LINK, 'https://photos.invalid/second.webp');
    assert.equal(h.input.value, 'LOCAL DRAFT');
    assert.ok(f.state.fetches.length >= 3);
    const failed = ctx.runWithProductionMasterDetailSaveQueue('A', async () => { throw new Error('controlled-failure'); });
    await assert.rejects(failed, /controlled-failure/); assert.equal(ctx.productionMasterDetailSaveQueues.size, 0);
    h.dom.window.close();
});

test('raw canonical detail reads retain all physical nulls and never expose mutable storage', async () => {
    const h = await ownSaveFixture();
    const raw = h.f.store.getVerifiedCanonicalRows(['A']);
    assert.equal(Object.keys(raw[0]).length, 213); assert.equal(raw[0].carrier, null);
    raw[0].app_tab_assignment = 'untrusted';
    assert.equal(h.f.store.getVerifiedCanonicalRows(['A'])[0].app_tab_assignment, 'notes');
    h.f.context.online = false;
    assert.equal(h.f.store.getVerifiedCanonicalRows(['A']), null);
    h.dom.window.close();
});

for (const revisionBeforeAck of [false, true]) test(`own acknowledged note then photo continues without repaint (${revisionBeforeAck ? 'revision first' : 'ack first'})`, async () => {
    const h = await ownSaveFixture(), { ctx, f, input } = h;
    const active = ctx.activeItem;
    active.DOM_ID = 'stable-dom'; active.CAV_DISPLAY = 'retained display';
    for (const patch of [{ spec: null }, { photo_link: 'https://photos.invalid/kept.webp', photo_name: 'kept.webp' }]) {
        const ticket = ctx.captureProductionMasterDetailOwnSave({ ...active }, false);
        assert.ok(ticket, 'detached photo RPC input matches the verified active physical row');
        const ack = h.acknowledge(patch);
        if (revisionBeforeAck) {
            await f.coordinator.check();
            assert.equal(ctx.productionMasterDetailSession.status, 'ready', 'own in-flight write defers permanent change classification');
            assert.equal(ctx.hasProductionMasterDetailForItem(active), false);
            assert.equal(ctx.runDeferredDetailHydration(1), false);
        }
        assert.equal(await ctx.continueProductionMasterDetailOwnSave(ticket, ack), true);
        ctx.finishProductionMasterDetailOwnSave(ticket);
        assert.equal(ctx.hasProductionMasterDetailForItem(active), true);
        assert.equal(ctx.productionMasterDetailSession.status, 'ready');
        assert.equal(ctx.activeItem, active);
        assert.equal(active.AV_NOTE, 'SAVED NOTE');
        assert.equal(Object.hasOwn(active, 'SPEC'), false, 'physical nulls do not retain an old baseline value');
        assert.equal(active.DOM_ID, 'stable-dom'); assert.equal(active.CAV_DISPLAY, 'retained display');
        assert.equal(input.value, 'LOCAL DRAFT');
        assert.equal(h.dom.window.document.activeElement, input);
        assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 5]);
    }
    assert.equal(active.PHOTO_LINK, 'https://photos.invalid/kept.webp');
    h.dom.window.close();
});

for (const change of ['evidence', 'assignment-same-signature', 'permission', 'owner', 'same-account-new-epoch', 'navigation', 'timeout']) {
    test(`held acknowledged-save continuation cannot rebind after ${change}`, async () => {
        const h = await ownSaveFixture(), { ctx, f, input } = h;
        const ticket = ctx.captureProductionMasterDetailOwnSave(ctx.activeItem, false);
        const ack = h.acknowledge();
        const gate = deferred(); f.state.fetchHook = async () => { await gate.promise; return f.state.rows; };
        const pending = ctx.continueProductionMasterDetailOwnSave(ticket, ack); await settle();
        assert.equal(ctx.hasProductionMasterDetailForItem(ctx.activeItem), false);
        assert.equal(input.disabled, true);
        if (change === 'evidence') f.state.rows = [{ ...f.state.rows[0], av_note: 'REMOTE NOTE' }];
        if (change === 'assignment-same-signature') f.state.rows = [{ ...f.state.rows[0], app_tab_assignment: 'hold-release' }];
        if (change === 'permission') { f.state.permission = 'permission-2'; }
        if (change === 'owner') h.switchOwner();
        if (change === 'same-account-new-epoch') h.changeEpoch();
        if (change === 'navigation') { ctx.detailHydrationToken = 3; }
        if (change === 'timeout') {
            assert.equal(h.deadlines.size, 1);
            const [callback, delay] = h.deadlines.entries().next().value;
            assert.equal(delay, 15000); callback();
        }
        gate.resolve(); assert.equal(await pending, false); await settle();
        ctx.finishProductionMasterDetailOwnSave(ticket);
        assert.equal(ticket.rebound, undefined);
        assert.equal(ctx.hasProductionMasterDetailForItem(ctx.activeItem), false);
        assert.equal(input.value, 'LOCAL DRAFT');
        h.dom.window.close();
    });
}

test('Tasks NCR list actions retain verified-list assignment policy while editors require exact details', async () => {
    const f = fixture({ rows: [row('A', { assignedto: 'eval-user', eval_task_type: 'new-crop' })] });
    const listAdapter = { id: 'core:master', cacheKey: 'list-v1', sourceKeys: ['ph_master_inventory'],
        stage: async () => f.state.rows };
    f.context.adapters = [listAdapter];
    await f.coordinator.check();
    const ctx = bindingFixture(f);
    let visible = 'tasks';
    let access = { isEval: true, isAdmin: false, isRepLike: false };
    Object.assign(ctx, {
        activeDetailSourceView: '', lastView: 'tasks', activeTaskTab: 'new-crop',
        currentUser: 'eval-user', currentUserDisplay: 'Eval User',
        getCurrentVisibleViewId: () => visible,
        getRoleAccessState: () => access,
        getProductionDetailDatasetKeys: () => ['master'],
        canUseVerifiedProductionData: () => f.coordinator.isVerified(listAdapter),
        getEditableDetailItemForPrefix: (_prefix, item) => item || ctx.activeItem,
        canRestrictedEvalUserUpdateItem: (item) => item?.ASSIGNEDTO === 'eval-user',
        isPrivilegedManagerUser: () => false, canUseEvalTaskAssignment: () => false,
        isEvalTaskItem: (item) => Boolean(item?.EVAL_TASK_TYPE), normalizeEvalTaskType: (value) => value,
        isSalesOfficeLikeItem: () => false, canAccessView: () => false,
        canUseNcrTaskView: () => false, canUseNcrApprovalTaskView: () => false,
    });
    vm.runInContext(['firstNonEmptyValue', 'isRepReadOnlyUser', 'canRepEditDetailPrefix',
        'isRestrictedEvalUser', 'isEvalNcrOrMoveUpDetailTask', 'isDriveModePhotoDataEditContext',
        'canCurrentUserUpdateDrivePhotoDataByRole', 'canCurrentUserUpdateDrivePhotoData',
        'canEditRowDetailsByRole', 'canEditRowDetails', 'canEditNcrWorkflow'].map(appFunction).join('\n'), ctx);
    const listRow = { UNIQUE_ID: 'A', SOURCE_TABLE: 'ph_master_inventory', ASSIGNEDTO: 'eval-user', EVAL_TASK_TYPE: 'new-crop' };
    assert.equal(ctx.hasProductionMasterDetailForItem(listRow), false);
    assert.equal(ctx.canEditNcrWorkflow(listRow), true);
    listRow.EVAL_TASK_TYPE = 'move-up';
    assert.equal(ctx.canEditNcrWorkflow(listRow), true);
    listRow.ASSIGNEDTO = 'someone-else';
    assert.equal(ctx.canEditNcrWorkflow(listRow), false);
    listRow.ASSIGNEDTO = 'eval-user';
    access = { isEval: false, isAdmin: false, isRepLike: true };
    assert.equal(ctx.canEditNcrWorkflow(listRow), false);
    access = { isEval: true, isAdmin: false, isRepLike: false };
    ctx.activeItem = listRow; visible = 'detail'; ctx.activeDetailSourceView = 'tasks';
    assert.equal(ctx.canEditNcrWorkflow(listRow), false);
    assert.equal(ctx.canEditRowDetails('ncr-', listRow), false);
    assert.equal(ctx.canCurrentUserUpdateDrivePhotoData(listRow, 'ncr-'), false);
    f.context.adapters = [listAdapter, f.store.getAdapter(['A'])];
    const [full] = await f.store.ensure(['A']);
    ctx.activeItem = { ...full, SOURCE_TABLE: 'ph_master_inventory' };
    ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']);
    assert.equal(ctx.canEditNcrWorkflow(ctx.activeItem), true);
    visible = 'tasks'; ctx.activeItem = null; ctx.activeDetailSourceView = '';
    f.state.sourceState = 'importing';
    await f.coordinator.check();
    assert.equal(ctx.canEditNcrWorkflow(listRow), false);
});

test('an unrelated verified callback during an unchanged detail check locks temporarily without rebasing or marking changed', async () => {
    let ctx;
    const f = fixture({ onVerified: () => ctx?.onProductionMasterDetailsVerified() });
    f.activate(['A']); await f.store.ensure(['A']);
    ctx = bindingFixture(f);
    ctx.activeItem = { ...f.store.getVerifiedRows(['A'])[0], SOURCE_TABLE: 'ph_master_inventory' };
    ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']);
    const baseline = ctx.activeItem;
    const editor = { value: 'USER DRAFT', disabled: false };
    const scheduledRenders = [];
    Object.assign(ctx, {
        detailHydrationToken: 1, activeDetailSourceView: 'drive', lastView: 'drive',
        getCurrentVisibleViewId: () => 'detail', isLoginSessionOwnershipCurrent: (owner) => owner === 'owner-A',
        argosInventoryTransactionState: null, document: { getElementById: () => null },
        applyProductionMasterDetailControlState: () => { editor.disabled = !ctx.hasProductionMasterDetailForItem(ctx.activeItem); },
        scheduleDeferredDetailHydration: (...args) => scheduledRenders.push(args),
    });
    ctx.productionMasterDetailSession = { token: 1, owner: 'owner-A', sourceView: 'drive', status: 'ready',
        rowIdentity: ctx.getProductionMasterDetailIdentity(baseline) };
    vm.runInContext(['isProductionMasterDetailSessionCurrent', 'onProductionMasterDetailsVerified', 'runDeferredDetailHydration'].map(appFunction).join('\n'), ctx);
    const gate = deferred(); let joinedStarted = false;
    f.context.adapters.push({ id: 'side:held-join', cacheKey: 'join-v1', sourceKeys: ['ph_settings'],
        stage: async () => { joinedStarted = true; await gate.promise; return []; } });
    const badge = { id: 'side:badge', cacheKey: 'badge-v1', sourceKeys: ['ph_active_request'], stage: async () => [] };
    f.context.backgroundAdapters = [badge];
    const pending = f.coordinator.check();
    await settle();
    assert.equal(joinedStarted, true);
    assert.equal(ctx.hasProductionMasterDetailForItem(baseline), false);
    assert.equal(ctx.runDeferredDetailHydration(1), false);
    assert.equal(ctx.productionMasterDetailSession.status, 'ready', 'the deferred render path also waits without marking changed');
    assert.equal(await f.coordinator.ensure(badge), true);
    assert.equal(editor.disabled, true, 'the mutation gate remains locked while the critical check is pending');
    assert.equal(ctx.productionMasterDetailSession.status, 'ready', 'temporary unverified state is not an observed change');
    assert.equal(ctx.activeItem, baseline);
    assert.equal(editor.value, 'USER DRAFT');
    gate.resolve(); await pending; await settle();
    assert.equal(editor.disabled, false);
    assert.equal(ctx.productionMasterDetailSession.status, 'ready');
    assert.deepEqual(scheduledRenders, [[1, 0]], 'the deferred full-row paint is resumed only after verification');
    assert.equal(ctx.activeItem, baseline);
    assert.equal(editor.value, 'USER DRAFT');
    f.state.revision = '2';
    await f.coordinator.check();
    assert.equal(ctx.productionMasterDetailSession.status, 'changed', 'a genuinely new master revision still requires reopening');
    assert.equal(editor.disabled, true);
    assert.equal(ctx.activeItem, baseline);
    assert.equal(editor.value, 'USER DRAFT');
});

test('retained photo recovery stays visible offline and re-enables only for the same genuinely verified detail', async () => {
    let ctx, owner = 'owner-A', isAdmin = true, saves = 0;
    const f = fixture({ rows: [row('A', { locationcode: 'LOC', lotcode: 'LOT' })],
        onVerified: () => ctx?.applyProductionMasterDetailControlState() });
    f.activate(['A']); await f.store.ensure(['A']);
    ctx = bindingFixture(f);
    ctx.activeItem = { ...f.store.getVerifiedRows(['A'])[0], SOURCE_TABLE: 'ph_master_inventory' };
    ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']);
    const baseline = ctx.activeItem;
    const dom = new JSDOM('<div id="view-detail"><div><button id="camera-btn-na">Photo</button></div><input id="na-av-note" value="RETAINED FORM DRAFT"></div>');
    Object.assign(ctx, {
        document: dom.window.document, navigator: { onLine: true },
        productionMasterDetailDisabledControls: new WeakMap(), activeDetailSourceView: 'drive', lastView: 'drive',
        isLoginSessionOwnershipCurrent: (value) => value === owner,
        getRoleAccessState: () => ({ isAdmin }), findLinkedMasterRow: () => null,
        canEditRowDetails: () => false, renderProductionMasterDetailState: () => {},
        persistDrivePhotoDraft: async () => { saves++; return true; },
        showToast: () => { throw new Error('Unexpected photo retry failure'); },
    });
    vm.runInContext(`const SECURE_DRIVE_EVIDENCE_PREFIXES = new Set(['ssn-', 'lsn-', 'na-']);
        const PROTECTED_DRIVE_PHOTO_PREFIXES = new Set(['ssn-', 'lsn-', 'na-', 'flyer-']);
        ${['firstNonEmptyValue', 'getDrivePhotoIdentity', 'getDrivePhotoMasterItem', 'canUploadRowPhoto',
            'canUploadRowPhotoByRole', 'assertDrivePhotoDraftContext', 'refreshDrivePhotoDraftUi',
            'retryDrivePhotoSave', 'applyProductionMasterDetailControlState'].map(appFunction).join('\n')}`, ctx);
    const draft = { owner, identity: ctx.getDrivePhotoIdentity(baseline), state: 'retry',
        entries: [{ publicUrl: 'https://photos.invalid/retained.webp' }] };
    ctx.getDrivePhotoDraft = () => draft;
    ctx.applyProductionMasterDetailControlState();
    const button = dom.window.document.querySelector('[data-drive-photo-retry="na-"]');
    assert.ok(button); assert.equal(button.disabled, false);
    button.focus();
    f.context.online = false; ctx.navigator.onLine = false;
    ctx.applyProductionMasterDetailControlState();
    assert.equal(button.disabled, true);
    assert.equal(button.isConnected, true);
    assert.equal(await ctx.retryDrivePhotoSave('na-'), false);
    assert.equal(saves, 0, 'programmatic retry cannot bypass offline state');
    f.context.online = true; ctx.navigator.onLine = true;
    const gate = deferred();
    f.context.adapters.push({ id: 'side:held-join', cacheKey: 'join-v1', sourceKeys: ['ph_settings'],
        stage: async () => { await gate.promise; return []; } });
    const pending = f.coordinator.check(); await settle();
    ctx.applyProductionMasterDetailControlState();
    assert.equal(button.disabled, true, 'online alone does not authorize the pending dependency group');
    assert.equal(await ctx.retryDrivePhotoSave('na-'), false);
    assert.equal(saves, 0);
    gate.resolve(); await pending; await settle();
    assert.equal(button.disabled, false);
    assert.equal(dom.window.document.querySelector('[data-drive-photo-retry="na-"]'), button);
    assert.equal(dom.window.document.activeElement, button, 'metadata refresh preserves the recovery button and its focus');
    assert.equal(ctx.activeItem, baseline);
    assert.equal(dom.window.document.getElementById('na-av-note').value, 'RETAINED FORM DRAFT');
    assert.equal(draft.entries[0].publicUrl, 'https://photos.invalid/retained.webp');
    await ctx.retryDrivePhotoSave('na-'); assert.equal(saves, 1, 'only the explicit verified retry persists the retained URL');
    f.state.sourceState = 'denied'; await f.coordinator.check(); ctx.applyProductionMasterDetailControlState();
    assert.equal(button.disabled, true);
    await ctx.retryDrivePhotoSave('na-'); assert.equal(saves, 1);
    f.state.sourceState = 'ready'; f.state.revision = '2'; await f.coordinator.check();
    assert.equal(button.disabled, true, 'a changed master revision cannot enable the old bound detail');
    await ctx.retryDrivePhotoSave('na-'); assert.equal(saves, 1);
    ctx.activeItem = { ...f.store.getVerifiedRows(['A'])[0], SOURCE_TABLE: 'ph_master_inventory' };
    ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']); ctx.applyProductionMasterDetailControlState();
    assert.equal(button.disabled, false, 'reviewing and binding the fresh full row restores recovery');
    f.state.permission = 'permission-2'; await f.coordinator.check();
    assert.equal(button.disabled, true, 'new permission metadata cannot bless an old full-row binding');
    ctx.activeItem = { ...f.store.getVerifiedRows(['A'])[0], SOURCE_TABLE: 'ph_master_inventory' };
    ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']); ctx.applyProductionMasterDetailControlState();
    assert.equal(button.disabled, false);
    isAdmin = false; ctx.applyProductionMasterDetailControlState();
    assert.equal(dom.window.document.querySelector('[data-drive-photo-retry]'), null);
    await ctx.retryDrivePhotoSave('na-'); assert.equal(saves, 1);
    isAdmin = true; owner = 'owner-B'; ctx.applyProductionMasterDetailControlState();
    assert.equal(dom.window.document.querySelector('[data-drive-photo-retry]'), null, 'another login cannot recover the prior actor’s draft');
    await ctx.retryDrivePhotoSave('na-'); assert.equal(saves, 1);
    dom.window.close();
});

test('Reclass controls and recipients recover from a same-fence check but not a changed revision', async () => {
    let ctx;
    const f = fixture({ onVerified: () => ctx?.onProductionMasterDetailsVerified() });
    const exact = f.activate(['A']); await f.store.ensure(['A']);
    ctx = bindingFixture(f);
    const input = { id: 'proposal', value: 'RETAINED PROPOSAL', disabled: false };
    const recipient = { id: 'recipient', value: 'chosen-recipient', disabled: false };
    const readonly = { id: 'readonly', value: 'fixed', disabled: true };
    const button = { id: 'argos-inventory-transaction-apply', innerHTML: 'Email Item Inquiry', disabled: false };
    Object.defineProperty(button, 'textContent', { get: () => button.innerHTML, set: (value) => { button.innerHTML = value; } });
    const controls = [input, recipient, readonly, button];
    const modal = { classList: { contains: () => false }, querySelectorAll: () => controls };
    const state = { masterDetailToken: 1, masterDetailOwner: 'owner-A', masterDetailIds: ['A'],
        masterDetailFence: { ...f.context }, submitting: false, inquiryModel: { rows: ['UNCHANGED BASELINE'] } };
    Object.assign(ctx, {
        getCurrentVisibleViewId: () => 'drive', productionMasterReclassGeneration: 1,
        isLoginSessionOwnershipCurrent: (owner) => owner === 'owner-A',
        canUseVerifiedProductionData: () => f.coordinator.isVerified(exact),
        argosInventoryTransactionState: state, productionMasterReclassDisabledControls: new WeakMap(),
        document: { getElementById: (id) => id === 'argos-inventory-transaction-modal' ? modal : id === button.id ? button : null },
    });
    vm.runInContext(['isProductionReclassDetailFenceCurrent', 'isProductionReclassDetailVerified',
        'onProductionMasterDetailsVerified'].map(appFunction).join('\n'), ctx);
    const gate = deferred();
    f.context.adapters.push({ id: 'side:held-join', cacheKey: 'join-v1', sourceKeys: ['ph_settings'], stage: async () => { await gate.promise; return []; } });
    const badge = { id: 'side:badge', cacheKey: 'badge-v1', sourceKeys: ['ph_active_request'], stage: async () => [] };
    f.context.backgroundAdapters = [badge];
    const pending = f.coordinator.check(); await settle();
    await f.coordinator.ensure(badge);
    assert.equal(controls.every((control) => control.disabled), true);
    assert.match(button.textContent, /Checking inventory/);
    assert.equal(ctx.isProductionReclassDetailVerified(), false);
    gate.resolve(); await pending; await settle();
    assert.deepEqual(controls.map((control) => control.disabled), [false, false, true, false]);
    assert.equal(button.innerHTML, 'Email Item Inquiry');
    assert.equal(ctx.isProductionReclassDetailVerified(), true);
    assert.equal(ctx.argosInventoryTransactionState, state);
    assert.equal(input.value, 'RETAINED PROPOSAL');
    assert.equal(recipient.value, 'chosen-recipient');
    assert.deepEqual(state.inquiryModel, { rows: ['UNCHANGED BASELINE'] });
    f.state.revision = '2'; await f.coordinator.check();
    assert.equal(controls.every((control) => control.disabled), true);
    assert.match(button.textContent, /Inventory changed/);
    assert.equal(ctx.isProductionReclassDetailVerified(), false);
    assert.equal(ctx.argosInventoryTransactionState, state);
    assert.equal(input.value, 'RETAINED PROPOSAL');
    assert.equal(recipient.value, 'chosen-recipient');
});

test('an unchanged recovery panel retains the same Retry button until its genuine action changes state', () => {
    const ctx = bindingFixture(fixture());
    const elements = new Map();
    const createElement = () => {
        const node = { children: [], hidden: false, setAttribute() {}, appendChild(child) { this.children.push(child); } };
        let text = '';
        Object.defineProperty(node, 'textContent', { get: () => text, set: (value) => { text = value; node.children = []; } });
        return node;
    };
    elements.set('view-detail', { prepend: (node) => elements.set(node.id, node) });
    const scheduled = [];
    Object.assign(ctx, {
        activeItem: { UNIQUE_ID: 'A', SOURCE_TABLE: 'ph_master_inventory' }, detailHydrationToken: 1,
        activeDetailSourceView: 'drive', lastView: 'drive', getCurrentVisibleViewId: () => 'detail',
        isLoginSessionOwnershipCurrent: (owner) => owner === 'owner-A',
        document: { getElementById: (id) => elements.get(id), createElement },
        scheduleDeferredDetailHydration: (...args) => scheduled.push(args),
    });
    const session = { token: 1, owner: 'owner-A', sourceView: 'drive', status: 'error', error: 'Verification needs a retry',
        rowIdentity: ctx.getProductionMasterDetailIdentity(ctx.activeItem) };
    ctx.productionMasterDetailSession = session;
    vm.runInContext(['isProductionMasterDetailSessionCurrent', 'renderProductionMasterDetailState'].map(appFunction).join('\n'), ctx);
    ctx.renderProductionMasterDetailState();
    const panel = elements.get('master-detail-load-state'), retry = panel.children[0];
    for (let i = 0; i < 50; i++) ctx.renderProductionMasterDetailState();
    assert.equal(panel.children[0], retry, 'verification callbacks preserve pointer/focus target identity');
    assert.equal(panel.children.length, 1);
    assert.deepEqual(scheduled, []);
    retry.onclick();
    assert.equal(session.status, 'loading');
    assert.deepEqual(scheduled, [[1, 0]]);
    assert.equal(panel.children.length, 0);
    for (let i = 0; i < 50; i++) ctx.renderProductionMasterDetailState();
    assert.deepEqual(scheduled, [[1, 0]], 'passive status renders never create a retry loop');
    session.status = 'error'; session.error = 'Verification needs a retry';
    ctx.renderProductionMasterDetailState();
    assert.notEqual(panel.children[0], retry, 'a new failed attempt receives a new action');
});

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

test('structural pending-edit replay cannot broadcast master drafts into verified list/detail baselines', async () => {
    for (const blocked of [false, true]) {
        const f = fixture({ rows: [row('A', { spec: 'SERVER SPEC', sales_note: 'SERVER NOTE' })] });
        f.activate(['A']); await f.store.ensure(['A']);
        const ctx = bindingFixture(f);
        const list = { ...f.store.getVerifiedRows(['A'])[0], SOURCE_TABLE: 'ph_master_inventory' };
        ctx.activeItem = { ...list };
        ctx.bindProductionMasterDetailRow(ctx.activeItem, ['A']);
        const pending = { A: { timestamp: Date.now(), sourceTable: 'ph_master_inventory',
            data: { ...list, SPEC: 'LOCAL DRAFT', SALES_NOTE: 'LOCAL NOTE' },
            ...(blocked ? { autoRetryBlocked: true, conflictType: 'drive-evidence', driveEvidenceConflict: {} } : {}) } };
        Object.assign(ctx, {
            fullInventory: [list], masterInventoryById: new Map([['A', list]]),
            avOpenInventory: [], lowStockInventory: [], managerReviewInventory: [], moveUpInventory: [],
            salesOfficeInventory: [], socInventory: [], reservesInventory: [], requestsInventory: [], flyerFolderInventory: [],
            EXACT_ROW_SYNC_KEYS: ['SPEC', 'SALES_NOTE'], LINKED_ROW_SYNC_KEYS: [],
            getPendingEditsCache: () => pending,
            findPendingEditTarget: (uid) => ctx.masterInventoryById.get(uid),
            findLinkedMasterRow: () => list, isFlyerFolderRow: () => false,
            clonePhotoFields() {}, syncSharedFlyerPhotoFields() {}, normalizeRowPhotoFields() {}, buildSearchIndex: (item) => item,
            shouldIncludeMasterItemInAvSeasonView: () => false, rebuildInventoryByIdMap: () => new Map(),
            shouldDiscardPendingEditForCurrentRow: () => false, flushPendingEditsCache() {},
        });
        vm.runInContext(['firstNonEmptyValue', 'isRequestLikeLocalEditRow', 'buildSecureDriveEvidenceBaseline',
            'syncMasterFieldsToRow', 'syncRowDataAcrossViews', 'applyLocalEdits'].map(appFunction).join('\n'), ctx);
        ctx.applyLocalEdits();
        assert.equal(list.SPEC, 'SERVER SPEC');
        assert.equal(ctx.activeItem.SPEC, 'SERVER SPEC');
        assert.equal(ctx.hasProductionMasterDetailForItem(ctx.activeItem), true);
        assert.equal(pending.A.data.SPEC, 'LOCAL DRAFT', 'recoverable work remains in its sidecar');
        assert.equal(pending.A.autoRetryBlocked === true, blocked);
        assert.equal(f.store.getVerifiedRows(['A'])[0].SPEC, 'SERVER SPEC');
        // The supported legacy full-row workflow retains its original replay.
        ctx.getDatasetState = () => ({ listProjectionVersion: '' });
        ctx.applyLocalEdits();
        assert.equal(list.SPEC, 'LOCAL DRAFT');
        assert.equal(ctx.activeItem.SPEC, 'LOCAL DRAFT');
    }
});
