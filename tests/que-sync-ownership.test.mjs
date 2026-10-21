import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
function appFunction(name) {
    const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    const tail = html.slice(start);
    const end = tail.indexOf('\n        }');
    assert.ok(end >= 0, `${name} end`);
    return tail.slice(0, end + '\n        }'.length);
}
function subscriptionHarness() {
    const callbacks = new Map();
    let configuration, changed = 0, updates = 0, reconnects = 0;
    const channel = { on(_type, filter, fn) { callbacks.set(filter.table, fn); return this; }, subscribe(fn) { callbacks.set('connection', fn); return this; } };
    const ctx = {
        SUPABASE_URL: 'https://example.invalid', nativeAuthSessionActive: true, nativeAuthProfile: { id: 'nellie-id' },
        currentUser: 'nellie_aguilar', currentRole: 'User', currentUserDivision: '10',
        productionLiveSyncReadAuthEpoch: 1, productionLiveSyncReadPermissionVersion: '', productionLiveSyncReadGeneration: 0,
        productionLiveSyncCoordinator: null,
        getCurrentLoginCacheScopeKey: () => 'nellie::user',
        canUseProductionLiveSync: () => true,
        getSupabaseBrowserClient: () => ({ channel: () => channel, removeChannel: async () => {} }),
        getInventoryStatusSync: () => ({ setSourceReady() {}, handleUpdate() { updates++; }, resume() {}, suspend() {} }),
        abortSupabaseReadsBeforeGeneration() {}, resetDashboardSyncMetadataForPermissionChange() {},
        document: { hidden: false },
        window: { AgMetricLiveSync: { createCoordinator(options) { configuration = options; return {}; } } }
    };
    for (const name of ['getProductionLiveSyncContext', 'readProductionVerifiedSnapshot', 'readProductionDisplaySnapshot',
        'previewProductionSnapshots', 'retainAppliedProductionDisplay', 'writeProductionVerifiedSnapshot', 'isTouchConstrainedDevice']) ctx[name] = () => {};
    vm.createContext(ctx);
    vm.runInContext(appFunction('getSupabaseReadIdentityScope'), ctx);
    if (html.includes('function getProductionRealtimeOwnerKey(')) vm.runInContext(appFunction('getProductionRealtimeOwnerKey'), ctx);
    vm.runInContext(appFunction('getProductionLiveSyncCoordinator'), ctx);
    ctx.getProductionLiveSyncCoordinator();
    const dispose = configuration.subscribe(() => changed++, () => reconnects++);
    return { ctx, callbacks, configuration, dispose, counts: () => ({ changed, updates, reconnects }) };
}

test('Que master photo/spec notifications still reach Drive after first read learns its permission version', () => {
    const h = subscriptionHarness();
    h.configuration.onStageStart({ priority: 'foreground' }, { permissionVersion: 'permission-v1' });
    h.callbacks.get('app_dataset_revisions')({ new: { key: 'ph_master_inventory', revision: '42', state: 'ready' } });
    h.callbacks.get('ph_master_inventory')({ new: { unique_id: 'patriot', itemcode: 'HOSTA', locationcode: 'C.09.000' } });
    h.callbacks.get('connection')('SUBSCRIBED');
    assert.deepEqual(h.counts(), { changed: 1, updates: 1, reconnects: 1 });
});

test('removed or previous-account realtime callbacks never reach the current user', () => {
    for (const change of [h => { h.ctx.nativeAuthProfile = { id: 'other-id' }; }, h => h.dispose(),
        h => { h.ctx.productionLiveSyncReadAuthEpoch++; }, h => { h.ctx.document.hidden = true; }]) {
        const h = subscriptionHarness();
        change(h);
        h.callbacks.get('app_dataset_revisions')({ new: { key: 'ph_master_inventory', state: 'ready' } });
        h.callbacks.get('ph_master_inventory')({ new: { unique_id: 'old' } });
        h.callbacks.get('connection')('SUBSCRIBED');
        assert.deepEqual(h.counts(), { changed: 0, updates: 0, reconnects: 0 });
    }
});

test('reserve cache hydration discards an IndexedDB read that finishes after account switching', async () => {
    let release, applied = 0;
    const ctx = {
        currentUser: 'account-a', reservesInventory: [],
        canUseProductionLiveSync: () => false,
        getSupabaseReadIdentityScope: () => ctx.currentUser,
        getPersistentInventoryCacheOwner: () => ctx.currentUser,
        getUserScopedDatasetCacheKey: () => `reserves:${ctx.currentUser}`,
        loadCacheValue: () => new Promise(resolve => { release = resolve; }),
        getDatasetState: () => ({ initialLoaded: false }), firstNonEmptyValue: (...values) => values.find(Boolean),
        getRoleAccessState: () => ({ isRep: true }), shouldTrustCachedFullLoadForDataset: () => false,
        doesCacheSnapshotMatchCurrentSession: value => value.meta.scopedUser === ctx.currentUser,
        processAndLoadData() { applied++; }
    };
    vm.createContext(ctx);
    vm.runInContext(appFunction('warmUserScopedDatasetCaches'), ctx);
    const pending = ctx.warmUserScopedDatasetCaches();
    ctx.currentUser = 'account-b';
    release({ rows: [{ customer: 'account-a-only' }], meta: { scopedUser: 'account-a' } });
    assert.equal(await pending, false);
    assert.equal(applied, 0);
});

test('inventory snapshots use distinct account, role, division and permission namespaces', async () => {
    const values = new Map();
    const ctx = { currentUser: 'nellie', currentRole: 'User', safeRole: 'USER', currentUserDivision: '10',
        nativeAuthSessionActive: true, nativeAuthProfile: { id: 'subject-a' }, SUPABASE_URL: 'site-a',
        appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'access-v1' } },
        normalizeSessionIdentity: value => String(value || '').trim().toLowerCase(),
        saveCacheValue: async (key, value) => { values.set(key, value); return true; },
        loadCacheValue: async key => values.get(key) };
    vm.createContext(ctx);
    vm.runInContext(appFunction('getPersistentInventoryCacheOwner'), ctx);
    vm.runInContext(appFunction('saveToCache') + '\n' + appFunction('loadFromCache'), ctx);
    const snapshot = { meta: { owner: ctx.getPersistentInventoryCacheOwner() }, data: ['nellie'] };
    assert.equal(await ctx.saveToCache(snapshot), true);
    assert.equal(await ctx.loadFromCache(), snapshot);
    for (const [key, value] of [['nativeAuthProfile', { id: 'subject-b' }], ['currentRole', 'Admin'], ['currentUserDivision', '20'],
        ['appAccessSnapshotState', { snapshot: { dataPermissionVersion: 'access-v2' } }]]) {
        const previous = ctx[key]; ctx[key] = value;
        assert.equal(await ctx.loadFromCache(), null, key);
        assert.equal(await ctx.saveToCache(snapshot), false, 'old snapshot cannot be written under a new owner');
        ctx[key] = previous;
    }
    assert.equal(await ctx.loadFromCache(), snapshot, 'other users do not evict the saved owner snapshot');
});

test('cache warming starts a new owner read and discards the previous account result', async () => {
    const pending = new Map(), applied = [];
    const ctx = { currentUser: 'account-a', cacheWarmPromise: null, cacheWarmOwner: '',
        canUseProductionLiveSync: () => false,
        loginPrefetchPromise: null, loginPrefetchMode: '',
        getSupabaseReadIdentityScope: () => ctx.currentUser,
        getCurrentLoginCacheScopeKey: () => ctx.currentUser,
        clearLoginCachePrefetch() {},
        loadFromCache: () => new Promise(resolve => pending.set(ctx.currentUser, resolve)),
        doesCacheSnapshotMatchCurrentSession: value => value?.meta?.scopedUser === ctx.currentUser,
        normalizeCachedInventorySnapshot: value => value,
        processAndLoadData: value => applied.push(value.meta.scopedUser),
        getCachedDatasetLoadState: () => ({}), hydrateDatasetLoadState() {} };
    vm.createContext(ctx);
    vm.runInContext(appFunction('warmCachedInventory'), ctx);
    const first = ctx.warmCachedInventory();
    await Promise.resolve();
    ctx.currentUser = 'account-b';
    const second = ctx.warmCachedInventory();
    await Promise.resolve();
    pending.get('account-a')({ meta: { scopedUser: 'account-a' } });
    pending.get('account-b')({ meta: { scopedUser: 'account-b' } });
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(applied, ['account-b']);
});
