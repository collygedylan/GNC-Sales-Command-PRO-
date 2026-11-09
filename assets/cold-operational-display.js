const coldOperationalDisplayReads = new Map();
const coldOperationalDisplayKeys = new Set(['master', 'requests', 'suspendTag', 'soc']);

async function hydrateColdSource(key = '') {
    const owner = resetPendingRowPatchesForOwner();
    if (!key || !canUseProductionLiveSync()) return false;
    const state = getDatasetState(key);
    if (state.fullLoaded && state.rowCompleteness === 'complete'
        && (state.expectedRowCount === 0 || getDatasetRenderRowCount(key) > 0)) return true;
    if (coldSourceHydrations.has(key)) return coldSourceHydrations.get(key);
    const promise = ensureDatasetLoaded(key, 'full', { bypassLiveSyncCoordinator: true,
        force: getDatasetRenderRowCount(key) === 0, preserveRequestedMode: true, retryOnCancellation: true,
        retainOnGenerationChange: true })
        .then(loaded => {
            if (owner !== getSupabaseReadIdentityScope()) return false;
            if (loaded) {
                replayHydratedRowPatches();
                rebuildMasterInventoryIndexes();
                invalidateResolvedViewStateCaches({ preserveAvPreparation: true });
                TRACKED_VIEW_IDS.forEach(markViewDirty);
                if (key === 'requests' || key === 'suspendTag') paintFooterRequestBadgeOnly();
                scheduleProductionLiveSyncRender(true);
            }
            return loaded;
        }).catch(() => false).finally(() => {
            if (coldSourceHydrations.get(key) === promise) coldSourceHydrations.delete(key);
        });
    Object.defineProperty(promise, 'ownerIdentity', { value: owner, configurable: true });
    coldSourceHydrations.set(key, promise);
    return promise;
}

function isColdOperationalDisplayCurrent(key, context) {
    return context.readIdentity === getSupabaseReadIdentityScope()
        && context.dataPermissionVersion === String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '')
        && !document.hidden && !hasConfirmedCurrentAccountRevocation()
        && !getDatasetState(key).fullLoaded && getDatasetRenderRowCount(key) === 0;
}

async function readColdOperationalDisplay(adapter, key, context) {
    const read = candidate => readProductionDisplaySnapshot(candidate, { contractVersion: 1, scope: context.scope,
        adapterId: candidate.id, cacheKey: candidate.cacheKey, dataPermissionVersion: context.dataPermissionVersion });
    const saved = await read(adapter);
    if (saved || key !== 'master' || !isColdOperationalDisplayCurrent(key, context)) return saved;
    const alternate = createProductionCoreLiveAdapter(key, adapter.projection === 'full' ? 'browse' : 'full');
    return read(alternate);
}

function applyColdOperationalDisplay(key, saved, context) {
    if (!saved?.payload || saved.rowCompleteness !== 'complete' || !saved.rowCount
        || !isColdOperationalDisplayCurrent(key, context) || hasProductionLiveSyncDraft()) return false;
    processAndLoadData({ ...saved.payload, _fromCache: true, _verifiedLiveSync: true });
    if (key === 'master') {
        productionDisplayMasterReceipt = { rows: fullInventory, readScope: context.readIdentity,
            permission: context.dataPermissionVersion };
    }
    if (key === 'requests' || key === 'suspendTag') paintFooterRequestBadgeOnly();
    scheduleProductionLiveSyncRender(true, { cachedPreview: true });
    return true;
}

function warmColdOperationalDisplayAdapter(adapter, context) {
    const key = adapter.id.startsWith('core:') ? adapter.id.slice(5) : '';
    if (!coldOperationalDisplayKeys.has(key) || !isColdOperationalDisplayCurrent(key, context)) return false;
    const owner = JSON.stringify([context.readIdentity, context.dataPermissionVersion]);
    const previous = coldOperationalDisplayReads.get(key);
    if (previous?.owner === owner) return previous.promise;
    const task = { owner, promise: readColdOperationalDisplay(adapter, key, context)
        .then(saved => applyColdOperationalDisplay(key, saved, context))
        .catch(error => { window.GncRuntimeWatchdog?.capture?.(error, 'operational-display-cache'); return false; })
        .finally(() => { if (coldOperationalDisplayReads.get(key) === task) coldOperationalDisplayReads.delete(key); }) };
    coldOperationalDisplayReads.set(key, task);
    return task.promise;
}

function warmColdOperationalDisplay() {
    if (!canUseProductionLiveSync()) return false;
    const context = getProductionLiveSyncContext();
    if (!context.visible || !context.authenticated || context.accessDenied || !context.dataPermissionVersion) return false;
    return Promise.all(context.adapters.concat(context.backgroundAdapters)
        .map(adapter => warmColdOperationalDisplayAdapter(adapter, context)));
}
