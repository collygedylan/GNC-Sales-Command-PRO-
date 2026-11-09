import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../assets/cold-operational-display.js', import.meta.url), 'utf8');
const keys = ['master', 'requests', 'suspendTag', 'soc'];
const cohorts = { drive: ['master'], av: ['master'], request: ['requests', 'suspendTag'] };

function deferred() {
    let resolve;
    const promise = new Promise(settle => { resolve = settle; });
    return { promise, resolve };
}

function operationalDisplayFixture() {
    const disk = new Map(keys.map(key => [key, deferred()]));
    const live = new Map(keys.map(key => [key, deferred()]));
    const visibleRows = new Map(), rendered = new Map(), loaded = new Set(), reads = [];
    let badge = 0;
    const adapter = (key, projection = 'browse') => ({ id: `core:${key}`, cacheKey: `${key}/${projection}`, projection });
    const context = vm.createContext({
        window: {}, document: { hidden: false }, readIdentity: 'owner-a:1', scope: 'owner-a',
        appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'v1' } }, coldSourceHydrations: new Map(),
        fullInventory: [], TRACKED_VIEW_IDS: Object.keys(cohorts), createProductionCoreLiveAdapter: adapter,
        resetPendingRowPatchesForOwner: () => context.readIdentity,
        canUseProductionLiveSync: () => true, getSupabaseReadIdentityScope: () => context.readIdentity,
        getProductionLiveSyncContext: () => ({ visible: true, authenticated: true, scope: context.scope,
            readIdentity: context.readIdentity, dataPermissionVersion: context.appAccessSnapshotState.snapshot.dataPermissionVersion,
            adapters: [adapter('master')], backgroundAdapters: keys.slice(1).map(key => adapter(key)) }),
        getDatasetState: key => ({ fullLoaded: loaded.has(key), rowCompleteness: loaded.has(key) ? 'complete' : '',
            expectedRowCount: visibleRows.get(key)?.length }),
        getDatasetRenderRowCount: key => visibleRows.get(key)?.length || 0,
        hasConfirmedCurrentAccountRevocation: () => false, hasProductionLiveSyncDraft: () => false,
        readProductionDisplaySnapshot: (candidate, meta) => {
            const key = candidate.id.slice(5);
            reads.push(['disk', key, meta.scope, meta.dataPermissionVersion]);
            return disk.get(key).promise;
        },
        ensureDatasetLoaded: async key => {
            reads.push(['live', key]);
            const rows = await live.get(key).promise;
            loaded.add(key);
            visibleRows.set(key, rows);
            return true;
        },
        processAndLoadData: payload => {
            visibleRows.set(payload.key, payload.rows);
            if (payload.key === 'master') context.fullInventory = payload.rows;
        },
        productionDisplayMasterReceipt: null,
        paintFooterRequestBadgeOnly: () => { badge = context.getDatasetRenderRowCount('requests') + context.getDatasetRenderRowCount('suspendTag'); },
        replayHydratedRowPatches() {}, rebuildMasterInventoryIndexes() {}, invalidateResolvedViewStateCaches() {}, markViewDirty() {},
        scheduleProductionLiveSyncRender() {
            for (const [view, datasets] of Object.entries(cohorts)) rendered.set(view, datasets.flatMap(key => visibleRows.get(key) || []));
        }
    });
    vm.runInContext(source, context);
    return { context, disk, live, rendered, reads, badge: () => badge };
}

function finishDisk(disk, key, rows) {
    disk.get(key).resolve({ payload: { key, rows }, rowCount: rows.length, rowCompleteness: 'complete' });
}

export async function assertOperationalColdDisplay() {
    const { context, disk, live, rendered, reads, badge } = operationalDisplayFixture();
    const liveReads = keys.map(key => context.hydrateColdSource(key));
    const cacheRead = context.warmColdOperationalDisplay();
    const sameCacheRead = context.warmColdOperationalDisplay();
    assert.deepEqual(reads, [...keys.map(key => ['live', key]), ...keys.map(key => ['disk', key, 'owner-a', 'v1'])]);
    for (const key of keys) finishDisk(disk, key, [`saved-${key}-1`, `saved-${key}-2`]);
    await Promise.all([cacheRead, sameCacheRead]);
    assert.deepEqual(rendered.get('drive'), ['saved-master-1', 'saved-master-2']);
    assert.deepEqual(rendered.get('av'), ['saved-master-1', 'saved-master-2']);
    assert.deepEqual(rendered.get('request'), ['saved-requests-1', 'saved-requests-2', 'saved-suspendTag-1', 'saved-suspendTag-2']);
    assert.equal(badge(), 4);
    for (const key of keys) live.get(key).resolve([`fresh-${key}`]);
    await Promise.all(liveReads);
    assert.deepEqual(rendered.get('drive'), ['fresh-master']);
    assert.deepEqual(rendered.get('av'), ['fresh-master']);
    assert.deepEqual(rendered.get('request'), ['fresh-requests', 'fresh-suspendTag']);
    assert.equal(badge(), 2);
}

export async function assertOperationalColdDisplayFences() {
    const { context, disk, live, rendered, reads } = operationalDisplayFixture();
    const cacheRead = context.warmColdOperationalDisplay();
    const liveRead = context.hydrateColdSource('requests');
    live.get('requests').resolve([]);
    assert.equal(await liveRead, true);
    finishDisk(disk, 'requests', ['obsolete-request']);
    await Promise.resolve();
    assert.equal(await context.hydrateColdSource('requests'), true);
    assert.equal(reads.filter(([type]) => type === 'live').length, 1);
    context.readIdentity = 'owner-b:2';
    for (const key of ['master', 'soc', 'suspendTag']) finishDisk(disk, key, [`owner-a-${key}`]);
    await cacheRead;
    assert.deepEqual(rendered.get('drive'), []);
    assert.deepEqual(rendered.get('request'), []);
}
