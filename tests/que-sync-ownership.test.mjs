import { createProductionSubscriptionFixture } from '../src/core/production-subscription-fixture.mjs';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

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
    const fixture = createProductionSubscriptionFixture(appFunction('getUniversalLiveSyncTables'),
        appFunction('getProductionLiveSyncCoordinator'));
    let changed = 0, reconnects = 0;
    const dispose = fixture.options.subscribe(() => changed++, () => reconnects++);
    const patch = fixture.handlers.find(handler => handler.kind === 'broadcast').callback;
    const revision = fixture.handlers.find(handler => handler.filter.table === 'app_dataset_revisions').callback;
    fixture.options.onRevisionRead({ sources: [{ key: 'ph_master_inventory', state: 'ready' }] });
    return { fixture, dispose, revision, patch,
        counts: () => ({ changed, patches: fixture.patchCount, reconnects }) };
}

const masterPatch = { payload: { table: 'ph_master_inventory', eventType: 'UPDATE',
    rows: [{ unique_id: 'patriot', itemcode: 'HOSTA', locationcode: 'C.09.000' }] } };
const masterRevision = { new: { key: 'ph_master_inventory', revision: '42', state: 'ready' } };

test('Que master photo/spec notifications still reach Drive after first read learns its permission version', () => {
    const h = subscriptionHarness();
    h.fixture.options.onStageStart({ priority: 'foreground' }, { permissionVersion: 'permission-v1' });
    h.revision(masterRevision);
    h.patch(masterPatch);
    h.fixture.channel.onState('SUBSCRIBED');
    assert.deepEqual(h.counts(), { changed: 1, patches: 1, reconnects: 1 });
});

test('removed subscriptions and previous-account data events never reach the current user', () => {
    for (const boundary of ['account', 'disposed']) {
        const h = subscriptionHarness();
        if (boundary === 'account') h.fixture.owner = 'other-account:epoch-2';
        else h.dispose();
        h.revision(masterRevision);
        h.patch(masterPatch);
        assert.deepEqual(h.counts(), { changed: 0, patches: 0, reconnects: 0 });
        if (boundary === 'disposed') {
            h.fixture.channel.onState('SUBSCRIBED');
            assert.equal(h.counts().reconnects, 0);
        }
    }
    const hidden = subscriptionHarness();
    hidden.fixture.ctx.document.hidden = true;
    hidden.patch(masterPatch);
    assert.equal(hidden.counts().patches, 0, 'hidden documents never apply broadcast rows');
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
