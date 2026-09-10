import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function section(start, end) {
    const from = html.indexOf(start), to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Expected source section: ${start}`);
    return html.slice(from, to);
}
function helper(name) {
    const match = html.match(new RegExp(`        (?:async )?function ${name}\\([^]*?\\n        \\}`));
    assert.ok(match, `Expected real application helper: ${name}`);
    return match[0];
}
function moduleApi(path) {
    const context = { module: { exports: {} }, setTimeout, clearTimeout };
    vm.runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), context);
    return context.module.exports;
}
const engine = moduleApi('../assets/live-sync-coordinator.js');
const registry = moduleApi('../assets/live-sync-registry.js');
const sideAdapterApi = moduleApi('../assets/live-sync-adapters.js');
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

// Evaluate the real dataset definitions, not a parallel table-to-dataset map.
// Only their external query builders/limits and storage/network boundaries are fixtures.
function definitions(context) {
    const source = section('        const DATASET_DEFINITIONS = {', '        // Native-auth production reads');
    for (const name of new Set(source.match(/\b[A-Z][A-Z_]+_TABLE\b/g))) {
        const match = html.match(new RegExp(`const ${name} = ('[^']+');`));
        assert.ok(match, `Expected physical table constant ${name}`);
        context[name] = vm.runInNewContext(match[1]);
    }
    for (const name of new Set(source.match(/\b(?:build|get)[A-Z]\w+/g))) context[name] = () => 'select=*&order=unique_id.asc';
    for (const name of new Set(source.match(/\b[A-Z][A-Z_]+(?:FIELDS|QUERY)\b/g))) context[name] = '*';
    vm.runInContext(`${source}\nthis.DATASET_DEFINITIONS = DATASET_DEFINITIONS;`, context);
}

function fixture({ disk = new Map(), keys = ['master'], permission = 'fixture-permission-v1', revision = '9007199254740993' } = {}) {
    const calls = { diskReads: [], diskWrites: [], rowReads: [], previews: [], commits: [], toasts: [], transport: [], permissionRefresh: [] };
    const state = { permission, revision, sourceRevisions: new Map(), revisionState: 'ready', rowGate: null, metadataGate: null };
    const context = {
        structuredClone, console, setTimeout, clearTimeout,
        productionDatasetCacheReads: new Map(), productionDatasetCacheWrites: new Map(),
        nativeAuthSessionActive: true, nativeAuthProfile: { id: 'fixture-account-a', username: 'fixture_user' },
        currentUser: 'fixture_user', currentRole: 'Admin', loginShellPreparing: false,
        loginScope: 'fixture_user::admin', getCurrentLoginCacheScopeKey: () => context.loginScope,
        navigator: { onLine: true }, window: { AgMetricLiveSync: engine, AgMetricLiveSyncRegistry: registry },
        // Authoritative permission fixtures are ready, never a bypass flag or permissive isVerified stub.
        appAccessSnapshotState: { status: 'ready', stale: false, snapshot: { permissionVersion: permission, views: { drive: true, request: true } } },
        requestCapabilityState: { status: 'ready', stale: false, capabilities: { canView: true, canCreate: true } },
        loadCacheValue: async (key) => { calls.diskReads.push(key); return structuredClone(disk.get(key) ?? null); },
        saveCacheValue: async (key, entry) => { calls.diskWrites.push({ key, entry }); disk.set(key, structuredClone(entry)); return true; },
        fetchAllSupabaseRows: async (table, query) => {
            calls.rowReads.push({ table, query });
            const captured = [{ unique_id: 'synthetic-row', fixtureRevision: state.revision }];
            if (state.rowGate) await state.rowGate.promise;
            return captured;
        },
        buildDatasetPayload: (key, rows) => ({ [key === 'master' ? 'data' : key]: rows }),
        showToast: (...args) => calls.toasts.push(args),
        getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer synthetic-test-token' }),
        SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_WRITE_TIMEOUT_MS: 15000,
        fetchWithTimeout: async (...args) => { calls.transport.push(args); return { ok: true, text: async () => '{"ok":true}' }; }
    };
    vm.createContext(context);
    definitions(context);
    const names = ['getProductionDatasetCacheKey', 'loadProductionDatasetSnapshot', 'saveProductionDatasetSnapshot',
        'getProductionDataScope', 'canUseVerifiedProductionData', 'requireVerifiedProductionData', 'canUseProductionLiveSync',
        'getProductionTableDatasetKeys', 'getProductionDetailDatasetKeys', 'guardProductionDataCommand', 'createProductionCoreLiveAdapter', 'supabaseRpc'];
    vm.runInContext(names.map(helper).join('\n'), context);
    // The production side-context helper exposes the legacy login scope; the
    // coordinator/guard must replace it with the full native cache identity.
    context.getProductionLiveSyncSideContext = () => ({ scope: context.loginScope, username: context.currentUser });
    context.productionLiveSyncSideAdapters = sideAdapterApi.create({
        'side:dockWorkflow': {
            stage: async () => {
                calls.rowReads.push({ table: 'synthetic-dock-workflow', query: 'list' });
                if (state.rowGate) await state.rowGate.promise;
                return { trips: [], items: [] };
            },
            commit() {}
        }
    }, registry);
    context.createProductionLiveSyncSideAdapters = () => context.productionLiveSyncSideAdapters;
    const adapters = keys.map((key) => key.startsWith('side:')
        ? context.productionLiveSyncSideAdapters.getAdapter(key, { ...context.getProductionLiveSyncSideContext(), scope: context.getProductionDataScope() })
        : context.createProductionCoreLiveAdapter(key));
    const liveContext = () => ({ scope: context.getProductionDataScope(), viewKey: 'synthetic-view',
        visible: true, online: context.navigator.onLine, adapters, backgroundAdapters: [] });
    const coordinator = engine.createCoordinator({
        getContext: liveContext,
        readRevisions: async (sourceKeys) => {
            if (state.metadataGate) await state.metadataGate.promise;
            return { contractVersion: 1, permissionVersion: state.permission,
                sources: sourceKeys.map((key) => ({ key, revision: state.sourceRevisions.get(key) ?? state.revision, state: state.revisionState })) };
        },
        loadSnapshot: context.loadProductionDatasetSnapshot,
        saveSnapshot: context.saveProductionDatasetSnapshot,
        previewSnapshots: (snapshots) => calls.previews.push(snapshots),
        commitSnapshots: (snapshots) => calls.commits.push(snapshots),
        onPermissionChange: async (version) => {
            calls.permissionRefresh.push(version);
            context.appAccessSnapshotState.snapshot.permissionVersion = version;
        },
        setTimeout: () => 1, clearTimeout() {}, now: () => 1000
    });
    context.getProductionLiveSyncCoordinator = () => coordinator;
    context.getProductionLiveSyncContext = liveContext;
    return { context, coordinator, adapters, calls, state, disk };
}

test('real snapshot identity isolates auth account, application user, role, login scope and physical query', () => {
    const { context: ctx } = fixture();
    const adapter = ctx.createProductionCoreLiveAdapter('master');
    const key = () => ctx.getProductionDatasetCacheKey(ctx.createProductionCoreLiveAdapter('master'), ctx.getProductionDataScope());
    const original = key();
    assert.deepEqual(JSON.parse(original.slice('verified-dataset:v1:'.length)), [ctx.getProductionDataScope(), adapter.id, adapter.cacheKey]);
    for (const change of [
        () => { ctx.nativeAuthProfile.id = 'fixture-account-b'; },
        () => { ctx.currentUser = 'another_fixture_user'; },
        () => { ctx.currentRole = 'Sales'; },
        () => { ctx.loginScope = 'another_scope'; },
        () => { ctx.DATASET_DEFINITIONS.master.fullQuery = 'select=unique_id&order=unique_id.asc'; }
    ]) {
        const before = key(); change(); assert.notEqual(key(), before);
    }
    assert.notEqual(ctx.getProductionDatasetCacheKey(adapter, 'a","b'), ctx.getProductionDatasetCacheKey({ ...adapter, id: 'b' }, 'a'));
    assert.equal(ctx.createProductionCoreLiveAdapter('avOpen').cacheKey, ctx.createProductionCoreLiveAdapter('master').cacheKey,
        'AV is the same physical all-season snapshot, not a duplicate download');
});

test('only canonical core datasets and settings touch disk; duplicate preload shares one read', async () => {
    const { context: ctx, adapters, calls } = fixture();
    const scope = ctx.getProductionDataScope();
    const first = ctx.loadProductionDatasetSnapshot(adapters[0], { scope });
    assert.equal(first, ctx.loadProductionDatasetSnapshot(adapters[0], { scope }));
    assert.equal(await first, null);
    assert.equal(calls.diskReads.length, 1);
    for (const id of ['side:chat', 'side:access', 'side:codex']) {
        assert.equal(await ctx.loadProductionDatasetSnapshot({ id, cacheKey: id }, { scope }), null);
        ctx.saveProductionDatasetSnapshot({ id, cacheKey: id, scope, value: { draft: 'not canonical' } });
    }
    assert.equal(calls.diskReads.length, 1); assert.equal(calls.diskWrites.length, 0);
    await ctx.loadProductionDatasetSnapshot({ id: 'side:settings', cacheKey: 'settings' }, { scope });
    assert.equal(calls.diskReads.length, 2);
});

test('disk writes clone immediately, serialize the same key, and allow another key to progress', async () => {
    const { context: ctx, adapters, calls, disk } = fixture();
    const gate = deferred();
    const first = { contractVersion: 1, ...adapters[0], stage: undefined, scope: ctx.getProductionDataScope(),
        permissionVersion: 'fixture-permission-v1', verifiedAt: 1000,
        sources: [{ key: 'ph_master_inventory', revision: '1', state: 'ready' }], value: { rows: [{ note: 'server-one' }] } };
    delete first.stage;
    const original = ctx.saveCacheValue;
    ctx.saveCacheValue = async (key, value) => {
        calls.diskWrites.push({ key, revision: value.sources[0].revision, note: value.value.rows[0].note });
        if (value.sources[0].revision === '1') await gate.promise;
        disk.set(key, structuredClone(value)); return true;
    };
    ctx.saveProductionDatasetSnapshot(first);
    first.value.rows[0].note = 'unsaved-editor-change';
    first.sources[0].revision = '999';
    const second = { ...structuredClone(first), sources: [{ key: 'ph_master_inventory', revision: '2', state: 'ready' }], value: { rows: [{ note: 'server-two' }] } };
    ctx.saveProductionDatasetSnapshot(second);
    const other = { ...structuredClone(second), scope: 'another-account', sources: [{ key: 'ph_master_inventory', revision: '3', state: 'ready' }] };
    ctx.saveProductionDatasetSnapshot(other);
    await settle();
    assert.deepEqual(calls.diskWrites.map((write) => write.revision), ['1', '3']);
    assert.equal(calls.diskWrites[0].note, 'server-one', 'the queued write never captures an editor mutation');
    assert.equal(ctx.productionDatasetCacheWrites.size, 1, 'only the blocked same-key chain remains');
    const key = ctx.getProductionDatasetCacheKey(first, first.scope);
    assert.equal((await ctx.loadProductionDatasetSnapshot(adapters[0], { scope: first.scope })).value.rows[0].note, 'server-two');
    gate.resolve(); await Promise.all(ctx.productionDatasetCacheWrites.values()); await settle();
    assert.deepEqual(calls.diskWrites.map((write) => write.revision), ['1', '3', '2']);
    assert.equal(disk.get(key).sources[0].revision, '2'); assert.equal(disk.get(key).value.rows[0].note, 'server-two');
    assert.equal(ctx.productionDatasetCacheWrites.size, 0);
    ctx.saveCacheValue = original;
});

test('stored metadata is immutable, preserves decimal revisions, and unchanged reload waits for fresh verification', async () => {
    const first = fixture();
    assert.equal(await first.coordinator.check(), true); await settle();
    const stored = [...first.disk.values()][0];
    assert.equal(stored.contractVersion, 1); assert.equal(stored.permissionVersion, 'fixture-permission-v1');
    assert.equal(stored.sources[0].revision, '9007199254740993'); assert.equal(typeof stored.sources[0].revision, 'string');
    first.calls.commits[0][0].value.payload.data[0].note = 'unsaved draft';
    assert.equal(stored.value.payload.data[0].note, undefined);
    const warm = fixture({ disk: first.disk }); const gate = deferred(); warm.state.metadataGate = gate;
    const pending = warm.coordinator.check(); await settle();
    assert.equal(warm.context.canUseVerifiedProductionData(['master']), false);
    assert.equal(warm.calls.rowReads.length, 0); assert.equal(warm.calls.commits.length, 0);
    gate.resolve(); assert.equal(await pending, true);
    assert.equal(warm.calls.rowReads.length, 0); assert.equal(warm.coordinator.getStatistics().cacheHits, 1);
    assert.equal(warm.context.canUseVerifiedProductionData(['master']), true);
    assert.equal(warm.calls.commits[0][0].value.payload.data[0].note, undefined);
});

test('changed revisions reload; changed permissions or account never preview another canonical scope', async () => {
    const first = fixture(); await first.coordinator.check(); await settle();
    const changed = fixture({ disk: first.disk, revision: '9007199254740994' });
    assert.equal(await changed.coordinator.check(), true);
    assert.equal(changed.calls.rowReads.length, 1);
    assert.equal(changed.calls.commits.at(-1)[0].value.payload.data[0].fixtureRevision, '9007199254740994');
    for (const kind of ['permission', 'account']) {
        const f = fixture({ disk: first.disk, permission: kind === 'permission' ? 'fixture-permission-v2' : 'fixture-permission-v1' });
        if (kind === 'account') f.context.nativeAuthProfile.id = 'fixture-account-b';
        assert.equal(await f.coordinator.check(), true);
        assert.equal(f.calls.previews.length, 0, kind); assert.equal(f.calls.rowReads.length, 1, kind);
    }
});

test('an unchanged saved master is previewed while a different changed critical join is still loading', async () => {
    const first = fixture({ keys: ['master', 'reserves'] });
    await first.coordinator.check(); await settle();
    const warm = fixture({ disk: first.disk, keys: ['master', 'reserves'] });
    warm.state.sourceRevisions.set('ph_reserves', '9007199254740994');
    const gate = deferred(); warm.state.rowGate = gate;
    const pending = warm.coordinator.check();
    try {
        await settle();
        assert.equal(warm.calls.rowReads.length, 1, 'only the changed Reserves join should download');
        assert.equal(warm.calls.rowReads[0].table, 'ph_reserves');
        assert.ok(warm.calls.previews.flat().some(({ adapter }) => adapter.id === 'core:master'),
            'a matching master cache must not stay invisible behind a slow changed join');
        assert.equal(warm.context.canUseVerifiedProductionData(['master', 'reserves']), false);
    } finally { gate.resolve(); await pending; }
    assert.equal(warm.context.canUseVerifiedProductionData(['master', 'reserves']), true);
});

test('incomplete or mismatched persisted contracts cannot authorize a cached preview', async () => {
    const first = fixture(); await first.coordinator.check(); await settle();
    const [key, entry] = [...first.disk][0];
    for (const mutate of [
        (value) => { value.contractVersion = 0; },
        (value) => { delete value.permissionVersion; },
        (value) => { value.scope = 'another-account'; },
        (value) => { value.cacheKey = 'another-query'; },
        (value) => { value.verifiedAt = null; },
        (value) => { value.sources = []; },
        (value) => { value.sources[0].state = 'importing'; },
        (value) => { value.sources[0].revision = 'not-a-revision'; }
    ]) {
        const invalid = structuredClone(entry); mutate(invalid);
        const f = fixture({ disk: new Map([[key, invalid]]) });
        assert.equal(await f.coordinator.check(), true);
        assert.equal(f.calls.previews.length, 0);
        assert.equal(f.calls.rowReads.length, 1);
    }
});

test('native guards require genuinely verified source dependencies and fail closed offline or during an account mismatch', async () => {
    const f = fixture({ keys: ['master', 'requests'] });
    assert.throws(() => f.context.requireVerifiedProductionData(['master']), { code: 'DATA_NOT_VERIFIED' });
    await f.coordinator.check();
    assert.doesNotThrow(() => f.context.requireVerifiedProductionData(['master', 'requests']));
    assert.throws(() => f.context.requireVerifiedProductionData(['soc']), { code: 'DATA_NOT_VERIFIED' });
    f.context.navigator.onLine = false;
    assert.throws(() => f.context.requireVerifiedProductionData(['master']), { code: 'DATA_NOT_VERIFIED' });
    f.context.navigator.onLine = true; f.context.nativeAuthProfile.username = 'another_fixture_user';
    assert.throws(() => f.context.requireVerifiedProductionData(['master']), { code: 'DATA_NOT_VERIFIED' });
    f.context.nativeAuthProfile.username = f.context.currentUser; f.context.nativeAuthProfile.id = 'fixture-account-b';
    assert.throws(() => f.context.requireVerifiedProductionData(['master']), { code: 'DATA_NOT_VERIFIED' });
});

test('protected permission and status reads remain available before inventory verification', async () => {
    const f = fixture();
    const readCalls = [['get_my_dataset_revisions_v1', {}], ['list_request_recipients_v1', {}],
        ['season_sales_office', { operation: 'access' }], ['eval_work', { operation: 'review_setup' }],
        ['location_work', { operation: 'list' }], ['drive_reclass_inquiry', { operation: 'reconcile_status' }]];
    for (const [name, body] of readCalls) assert.deepEqual(plain(await f.context.supabaseRpc(name, body)), { ok: true });
    assert.equal(f.calls.transport.length, readCalls.length); assert.equal(f.calls.toasts.length, 0);
    assert.equal(f.context.canUseVerifiedProductionData(['master']), false);
    await assert.rejects(f.context.supabaseRpc('season_sales_office', { operation: 'save_av_note' }), { code: 'DATA_NOT_VERIFIED' });
    assert.equal(f.calls.transport.length, readCalls.length, 'blocked writes never reach the transport');
});

test('explicit suspend completion and flyer batch RPCs enforce only their required verified sources', async () => {
    const f = fixture({ keys: ['master', 'soc'] });
    for (const name of ['complete_suspend_tag_v1', 'create_flyer_folder_batch_v1']) {
        await assert.rejects(f.context.supabaseRpc(name, { synthetic: true }), { code: 'DATA_NOT_VERIFIED' });
    }
    assert.equal(f.calls.transport.length, 0);
    await f.coordinator.check();
    for (const name of ['complete_suspend_tag_v1', 'create_flyer_folder_batch_v1']) await f.context.supabaseRpc(name, { synthetic: true });
    assert.equal(f.calls.transport.length, 2);
    const masterOnly = fixture(); await masterOnly.coordinator.check();
    await masterOnly.context.supabaseRpc('create_flyer_folder_batch_v1', {});
    await assert.rejects(masterOnly.context.supabaseRpc('complete_suspend_tag_v1', {}), { code: 'DATA_NOT_VERIFIED' });
    assert.equal(masterOnly.calls.transport.length, 1, 'suspend completion also needs Docks, not Requests or Flyer history');
});

test('an active Request write needs current queue data but does not wait for Request history', async () => {
    const f = fixture({ keys: ['master', 'requests'] });
    await f.coordinator.check();
    assert.equal(f.context.canUseVerifiedProductionData(['requestHistory']), false);
    await f.context.supabaseRpc('save_request_work', { synthetic: true });
    assert.equal(f.calls.transport.length, 1);
    assert.ok(f.calls.rowReads.every(({ table }) => table !== 'ph_request_history'));
});

test('Dock commands require a verified operational side snapshot as well as inventory joins', async () => {
    const f = fixture({ keys: ['master', 'soc', 'side:dockWorkflow'] });
    const ctx = f.context;
    ctx.getRoleAccessState = () => ({ isAdmin: true, isQcSupervisor: false });
    ctx.getDockItemProgress = () => ({ checker: false, inspector: false });
    ctx.getDockRowQueueStage = () => 'checker';
    ctx.isDockRowQueuedForCurrentUser = () => true;
    vm.runInContext([helper('canEditDockWorkflow'), helper('canCurrentUserMarkDockStage')].join('\n'), ctx);
    assert.equal(ctx.canEditDockWorkflow(), false);
    assert.equal(ctx.canCurrentUserMarkDockStage({ UNIQUE_ID: 'fixture-dock-row' }, 'checker'), false,
        'the row handler must fail before its optimistic local completion toggle');
    await assert.rejects(ctx.supabaseRpc('dock_trip_status', { operation: 'upsert' }), { code: 'DATA_NOT_VERIFIED' });
    assert.equal(f.calls.transport.length, 0);
    await f.coordinator.check();
    assert.equal(ctx.canUseVerifiedProductionData(['master', 'soc', 'side:dockWorkflow']), true);
    assert.equal(ctx.canEditDockWorkflow(), true);
    assert.equal(ctx.canCurrentUserMarkDockStage({ UNIQUE_ID: 'fixture-dock-row' }, 'checker'), true);
    await ctx.supabaseRpc('dock_trip_status', { operation: 'upsert' });
    assert.equal(f.calls.transport.length, 1);
    f.coordinator.suspend();
    assert.equal(ctx.canEditDockWorkflow(), false, 'foreground return must reverify shared Dock progress');
    assert.equal(ctx.canCurrentUserMarkDockStage({ UNIQUE_ID: 'fixture-dock-row' }, 'checker'), false);
    await assert.rejects(ctx.supabaseRpc('dock_trip_status', { operation: 'upsert' }), { code: 'DATA_NOT_VERIFIED' });
    assert.equal(f.calls.transport.length, 1);
    const coreOnly = fixture({ keys: ['master', 'soc'] });
    await coreOnly.coordinator.check();
    await assert.rejects(coreOnly.context.supabaseRpc('dock_trip_status', { operation: 'upsert' }), { code: 'DATA_NOT_VERIFIED' });
    assert.equal(coreOnly.calls.transport.length, 0, 'current inventory alone cannot authorize stale operational state');
});

test('all Dock operational tables map to their required side snapshot', () => {
    const { context: ctx } = fixture();
    for (const table of ['ph_dock_trip_status', 'ph_dock_item_status', 'ph_dock_issue_status', 'ph_dock_issue_allocations']) {
        const keys = ctx.getProductionTableDatasetKeys(table);
        assert.ok(keys.includes('side:dockWorkflow'), `${table} must not bypass side verification`);
    }
});

test('Eval assignment RPC waits for the assignment snapshot, not just current master rows', async () => {
    const masterOnly = fixture(); await masterOnly.coordinator.check();
    await assert.rejects(masterOnly.context.supabaseRpc('set_eval_itemcode_assignment', { itemcode: 'FIXTURE' }), { code: 'DATA_NOT_VERIFIED' });
    assert.equal(masterOnly.calls.transport.length, 0);
    const complete = fixture({ keys: ['master', 'warehouseAssignedItems'] });
    await complete.coordinator.check();
    await complete.context.supabaseRpc('set_eval_itemcode_assignment', { itemcode: 'FIXTURE' });
    assert.equal(complete.calls.transport.length, 1);
});

test('physical write table mapping excludes unrelated history and derived aliases', () => {
    const { context: ctx } = fixture();
    for (const [table, expected] of [
        ['ph_master_inventory', ['master']], ['ph_active_request', ['requests']],
        ['ph_request_queue_live_rows', ['requests']], ['ph_request_history', ['requestHistory']],
        ['ph_flyer_folder_rows', ['flyerRows']], ['ph_flyer_folder_history', ['flyerHistory']],
        ['ph_soc_master', ['soc']], ['unknown_table', []]
    ]) assert.deepEqual(plain(ctx.getProductionTableDatasetKeys(table)), expected, table);
    assert.deepEqual(plain(registry.getSourceKeys(['core:requestHistory'])), ['ph_request_history']);
    assert.deepEqual(plain(registry.getSourceKeys(['core:flyerHistory'])), ['ph_flyer_folder_history']);
});

test('real context separates active-screen requirements from footer badge background work', () => {
    const { context: ctx } = fixture();
    ctx.document = { hidden: false };
    ctx.RETIRED_DATASET_KEYS = new Set();
    const side = { getViewAdapters: (view, details) => registry.getViewAdapters(view, details).filter((id) => id.startsWith('side:'))
        .map((id) => ({ id, cacheKey: id, sourceKeys: registry.getSourceKeys([id]), stage: async () => ({}) })) };
    ctx.productionLiveSyncSideAdapters = side;
    ctx.getProductionLiveSyncSideContext = () => ({ view: 'hours', surfaces: ['badge:queue', 'badge:communications'] });
    vm.runInContext(helper('getProductionLiveSyncContext'), ctx);
    let result = ctx.getProductionLiveSyncContext();
    assert.equal(result.adapters.length, 0, 'Hours does not wait for badge data or inventory settings');
    assert.ok(result.backgroundAdapters.some((adapter) => adapter.id === 'core:requests'));
    assert.ok(result.backgroundAdapters.some((adapter) => adapter.id === 'side:chat'));
    ctx.getProductionLiveSyncSideContext = () => ({ view: 'docks', surfaces: ['badge:queue', 'badge:communications'] });
    result = ctx.getProductionLiveSyncContext();
    assert.ok(result.adapters.some((adapter) => adapter.id === 'core:soc'));
    assert.ok(result.adapters.some((adapter) => adapter.id === 'side:settings'));
    assert.ok(!result.adapters.some((adapter) => adapter.id === 'side:chat'));
    const criticalIds = new Set(result.adapters.map((adapter) => adapter.id));
    assert.ok(result.backgroundAdapters.every((adapter) => !criticalIds.has(adapter.id)));
});

test('post-verification callback updates permission and badge chrome without replacing the focused draft', () => {
    const f = fixture(); const ctx = f.context; const calls = [];
    const input = { value: 'my unsaved note', selectionStart: 4, selectionEnd: 7 };
    const item = { unique_id: 'synthetic-row', note: 'draft' };
    Object.assign(ctx, {
        productionLiveSyncCoordinator: null, productionSeasonDerivationPending: false,
        productionLiveSyncReadGeneration: 0, productionLiveSyncReadPermissionVersion: '',
        isTouchConstrainedDevice: () => false, previewProductionDatasetSnapshots() {}, renderProductionDataFreshness() {},
        refreshProtectedSections: () => calls.push('permissions'),
        getCurrentVisibleViewId: () => 'detail', activeDetailSourceView: 'drive', activeItem: item,
        applyCameraPermissions: (source, row) => { assert.equal(source, 'drive'); assert.equal(row, item); calls.push('camera'); },
        applyAvDetailReadOnlyState: (source) => { assert.equal(source, 'drive'); calls.push('detail-permissions'); },
        updateFooterRequestBadge: () => calls.push('request-badge'), updateFooterChatBadge: () => calls.push('chat-badge'),
        document: { activeElement: input },
        processAndLoadData: () => { throw new Error('Must not replace form data during a chrome refresh'); },
        renderDetailView: () => { throw new Error('Must not rerender the focused editor'); },
        scheduleProductionLiveSyncRender: () => { throw new Error('Must not schedule an editor rerender'); }
    });
    let callbacks;
    ctx.window = { ...ctx.window, AgMetricLiveSync: { createCoordinator: (options) => { callbacks = options; return f.coordinator; } } };
    vm.runInContext(helper('getProductionLiveSyncCoordinator'), ctx);
    ctx.getProductionLiveSyncCoordinator();
    callbacks.onVerified({ scope: 'old-account' }); assert.deepEqual(calls, []);
    callbacks.onVerified({ scope: ctx.getProductionDataScope() });
    assert.deepEqual(calls, ['permissions', 'camera', 'detail-permissions', 'request-badge', 'chat-badge']);
    assert.deepEqual(input, { value: 'my unsaved note', selectionStart: 4, selectionEnd: 7 });
    assert.equal(ctx.activeItem, item); assert.equal(item.note, 'draft');
    calls.length = 0;
    ctx.getCurrentVisibleViewId = () => 'drive';
    ctx.hasProductionLiveSyncDraft = () => false;
    callbacks.onVerified({ scope: ctx.getProductionDataScope() });
    assert.deepEqual(calls, ['request-badge', 'chat-badge'], 'plain lists do not refresh hidden form chrome before first paint');
    calls.length = 0;
    ctx.hasProductionLiveSyncDraft = () => true;
    callbacks.onVerified({ scope: ctx.getProductionDataScope() });
    assert.deepEqual(calls, ['permissions', 'request-badge', 'chat-badge'], 'an open data-entry dialog still refreshes protected controls');
    callbacks.onStageStart({}, { permissionVersion: 'fixture-permission-v2' });
    assert.equal(ctx.productionLiveSyncReadGeneration, 1);
    assert.equal(ctx.productionLiveSyncReadPermissionVersion, 'fixture-permission-v2');
});

test('first-paint rendering preempts the normal 150ms batch while preserving drafts and scroll', () => {
    const { context: ctx, coordinator } = fixture();
    const pending = new Map(), scheduled = [], cancelled = [], calls = [];
    const scroller = { scrollTop: 432 };
    const input = { value: 'unsaved note', selectionStart: 3, selectionEnd: 6, matches: () => true };
    let nextTimer = 0, draft = false;
    Object.assign(ctx, {
        productionLiveSyncCoordinator: coordinator, productionLiveSyncRenderTimer: null,
        productionLiveSyncDraftChanged: false, productionLiveSyncRendering: false,
        document: { hidden: false, activeElement: null, getElementById: () => scroller },
        getCurrentVisibleViewId: () => 'drive', hasProductionLiveSyncDraft: () => draft,
        renderProductionDataFreshness: () => calls.push('freshness'),
        markViewDirty: (view) => calls.push(`dirty:${view}`),
        renderViewContent: (view, force, retain) => {
            assert.equal(ctx.productionLiveSyncRendering, true);
            assert.equal(force, false); assert.equal(retain, true);
            calls.push(`render:${view}`); scroller.scrollTop = 0;
        },
        setTimeout: (callback, delay) => {
            const id = ++nextTimer; scheduled.push(delay); pending.set(id, callback); return id;
        },
        clearTimeout: (id) => { cancelled.push(id); pending.delete(id); }
    });
    vm.runInContext(helper('scheduleProductionLiveSyncRender'), ctx);
    const flush = () => {
        const [id, callback] = pending.entries().next().value;
        pending.delete(id); callback();
    };
    ctx.scheduleProductionLiveSyncRender();
    ctx.scheduleProductionLiveSyncRender();
    assert.deepEqual(scheduled, [150], 'ordinary refreshes remain batched');
    ctx.scheduleProductionLiveSyncRender({ immediate: true });
    assert.deepEqual(cancelled, [1], 'a queued background render cannot delay the first usable rows');
    assert.deepEqual(scheduled, [150, 0]); assert.equal(pending.size, 1);
    flush();
    assert.deepEqual(calls, ['dirty:drive', 'render:drive']); assert.equal(scroller.scrollTop, 432);
    assert.equal(ctx.productionLiveSyncRendering, false); assert.equal(ctx.productionLiveSyncRenderTimer, null);
    draft = true;
    ctx.scheduleProductionLiveSyncRender({ immediate: true }); flush();
    assert.deepEqual(calls, ['dirty:drive', 'render:drive', 'freshness']);
    assert.equal(ctx.productionLiveSyncDraftChanged, true);
    draft = false; ctx.document.activeElement = input;
    ctx.scheduleProductionLiveSyncRender({ immediate: true }); flush();
    assert.deepEqual(calls, ['dirty:drive', 'render:drive', 'freshness']);
    assert.equal(input.value, 'unsaved note'); assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 6);
    assert.equal(ctx.productionLiveSyncDraftChanged, true);
});
