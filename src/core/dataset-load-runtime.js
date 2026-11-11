export async function ensureDatasetLoaded(key, mode = 'initial', options = {}) {
    if (RETIRED_DATASET_KEYS.has(String(key || '').trim())) return false;
    const definition = DATASET_DEFINITIONS[key];
    if (!definition) return false;
    if (!options.bypassLiveSyncCoordinator) {
        const coldLoad = getOwnedColdDatasetLoad(key,mode);
        if (coldLoad) return coldLoad;
        if (typeof canUseProductionLiveSync === 'function' && canUseProductionLiveSync()) return ensureCoordinatedDataset(key,mode,options);
    }
    const wantsFull = mode === 'full';
    const state = getDatasetState(key);
    if (isDatasetFrozenDuringManualSync(key,mode)) return wantsFull ? !!state.fullLoaded : !!(state.initialLoaded || state.fullLoaded);
    if (options.force && !wantsFull && state.fullLoaded && !options.preserveRequestedMode) return ensureDatasetLoaded(key,'full',options);
    if (!options.force && datasetLoadAlreadyComplete(key,state,wantsFull)) return true;
    const load = () => runDatasetLoadWithRetry(key,definition,state,wantsFull,options);
    if (wantsFull) {
        if (state.fullPromise) return state.fullPromise;
        state.fullPromise = Promise.resolve(state.initialPromise).catch(() => false).then(load).finally(() => {
            state.fullPromise = null;
        });
        return state.fullPromise;
    }
    if (state.initialPromise) return state.initialPromise;
    state.initialPromise = load().finally(() => { state.initialPromise = null; });
    return state.initialPromise;
}

function getOwnedColdDatasetLoad(key, mode) {
    if (mode !== 'full' || !coldSourceHydrations.has(key)) return null;
    const owner = getSupabaseReadIdentityScope();
    const state = getDatasetState(key);
    if (coldSourceHydrations.get(key)?.ownerIdentity !== owner || !state.fullPromise) return null;
    return state.fullPromise.then(loaded => owner === getSupabaseReadIdentityScope() ? loaded : false);
}

async function ensureCoordinatedDataset(key, mode, options) {
    const adapterId = `core:${key === 'avOpen' ? 'master' : key}`;
    const foreground = getProductionLiveSyncContext().adapters.find(adapter => adapter.id === adapterId);
    // A browse preview joins the foreground full snapshot already paging.
    const adapter = mode !== 'full' && foreground?.projection === 'full'
        ? foreground : createProductionCoreLiveAdapter(key,mode === 'full' ? 'full' : 'browse');
    const loaded = await getProductionLiveSyncCoordinator().ensure(adapter,!!options.force);
    if (loaded || getDatasetRenderRowCount(key) > 0) return loaded;
    return ensureDatasetLoaded(key,mode,{...options,bypassLiveSyncCoordinator:true});
}

function datasetLoadAlreadyComplete(key, state, wantsFull) {
    if (wantsFull) return state.fullLoaded && ((key !== 'master' && key !== 'avOpen') || state.fieldCoverage === 'full');
    return (state.initialLoaded || state.fullLoaded) && !isMasterInitialLoadPartialForCurrentScope(state);
}

async function runDatasetLoadWithRetry(key, definition, state, wantsFull, options) {
    const maxRetries = options.retryOnCancellation === true ? 4 : 0;
    for (let attempt = 0; ; attempt += 1) {
        try { return await runLegacyDatasetLoad(key,definition,state,wantsFull,options); }
        catch (error) {
            if (attempt >= maxRetries || getSupabaseReadErrorCode(error) !== 'REQUEST_ABORTED') throw error;
            await new Promise(resolve => setTimeout(resolve,600*(attempt+1)));
        }
    }
}

function createDatasetReadPlan(key, definition, wantsFull, options) {
    const modeLabel = wantsFull ? 'full' : 'initial';
    const querySource = wantsFull ? definition.fullQuery : definition.initialQuery;
    const query = typeof querySource === 'function' ? querySource(modeLabel,options) : querySource || 'select=*';
    const initialLimitSource = definition.initialLimit;
    const limit = typeof initialLimitSource === 'function' ? initialLimitSource(modeLabel,options) : initialLimitSource || INITIAL_PAGE_LIMIT;
    const fetchAll = !wantsFull && definition.initialFetchAll === true && options.fastInitialPage !== true;
    const owner = getSupabaseReadIdentityScope();
    const firstPage = shouldHydrateFirstPageForDatasetLoad(key,modeLabel)
        ? {onFirstPage:(rows,meta) => owner === getSupabaseReadIdentityScope() ? hydrateFirstDatasetPageForRender(key,rows,meta) : false}
        : {};
    return {key,definition,wantsFull,options,modeLabel,query,limit,fetchAll,owner,firstPage};
}

async function fetchLegacyDatasetRows(plan) {
    const {key,definition,wantsFull,options,query,limit,fetchAll,firstPage} = plan;
    if (key === 'master' || key === 'avOpen') {
        const params = {dataset:key,projection:wantsFull ? 'full' : 'browse'};
        if (wantsFull || fetchAll) return fetchAllInventoryReadRows('master_page',params,{...firstPage,limit:5000,pageConcurrency:8,requireComplete:true});
        const page = await fetchInventoryReadPage('master_page',params,Math.min(limit,500),0,{label:'Inventory rows'});
        Object.defineProperty(page.rows,'readMeta',{value:{projection:page.projection,fieldCoverage:page.fieldCoverage,columns:page.columns},enumerable:false});
        return page.rows;
    }
    if (key === 'requests') return fetchActiveRequestLiveRows('*',options);
    if (wantsFull || fetchAll) return fetchAllSupabaseRows(definition.table,query,{
        ...firstPage,...(options.retainOnGenerationChange === true ? {retainOnGenerationChange:true} : {})
    });
    return fetchSupabasePage(definition.table,query,limit,0);
}

async function retryFullLegacyMasterRead(plan, error) {
    console.warn('Fast master inventory load failed; retrying with full master rows.',error);
    try {
        return await fetchAllInventoryReadRows('master_page',{dataset:'master',projection:'full'},{...plan.firstPage,limit:500});
    } catch (fallbackError) {
        console.warn('Full master retry failed; showing first master page while background sync retries.',fallbackError);
        return (await fetchInventoryReadPage('master_page',{dataset:'master',projection:'full'},Math.min(plan.limit,500),0,{label:'Inventory rows'})).rows;
    }
}

function recoverLegacyDatasetRows(plan, error) {
    const {key,definition,wantsFull,modeLabel,fetchAll,firstPage} = plan;
    const failure = classifyDatasetLoadFailureCode(error);
    if (failure === null) {
        if (error?.code === 'DATASET_READ_RETAINED' && !error.retryOnViewChange) queueDatasetLoad(key,modeLabel,3000);
        return null;
    }
    if (isInventorySourceReadinessError(error)) {
        suspendProductionInventoryReadForReadiness(error);
        reportSemanticHealthEvent('dataset_load_failed','data_sync',getSupabaseReadErrorCode(error) || 'DATASET_NOT_READY',{reason:`${key}:${modeLabel}`});
        throw error;
    }
    if (key === 'master' && !wantsFull && fetchAll && markMissingOptionalMasterInitialColumns(error)) {
        return fetchAllInventoryReadRows('master_page',{dataset:'master',projection:'initial_base'},{...firstPage,limit:500});
    }
    if (key === 'master' && fetchAll) return retryFullLegacyMasterRead(plan,error);
    if (key === 'requests' && isRequestQueueLiveRowsViewMissingError(error)) {
        return fetchAllSupabaseRows(ACTIVE_REQUEST_TABLE,'select=*&date_completed=is.null&order=unique_id.desc');
    }
    if (key === 'flyerRows' && isOptionalFlyerRowsMissingError(error)) return handleMissingOptionalFlyerRowsTable(error);
    if (['requestHistory','flyerHistory'].includes(key) && isOptionalTableMissingError(error,definition.table)) return handleMissingOptionalHistoryTable(key,error);
    if (key === 'customerRepMap' && isOptionalTableMissingError(error,definition.table)) return [];
    reportSemanticHealthEvent('dataset_load_failed','data_sync',failure,{reason:`${key}:${modeLabel}`});
    throw error;
}

function updateLegacyDatasetLoadState(plan, state, rows) {
    const {key,wantsFull,fetchAll} = plan;
    const inventory = key === 'master' || key === 'avOpen';
    const partial = key === 'master' && (wantsFull || fetchAll) && masterRowsLookPartialForCurrentScope(rows);
    const fieldCoverage = inventory ? String(rows.readMeta?.fieldCoverage || '') : 'full';
    if (inventory && wantsFull && fieldCoverage !== 'full') throw new Error('Full inventory fields were not returned; the partial snapshot was discarded.');
    state.initialLoaded = true;
    state.fullLoaded = wantsFull ? !partial : inventory ? fieldCoverage === 'full' && !partial : state.fullLoaded;
    state.expectedRowCount = rows.readMeta?.total ?? rows.length;
    state.fieldCoverage = fieldCoverage;
    state.rowCompleteness = (wantsFull || fetchAll) && !partial ? 'complete' : 'partial';
    state.lastLoadedAt = new Date().toISOString();
    if (key === 'master' && wantsFull) state.firstPagePreviewLoaded = false;
    return partial;
}

function refreshRequestOptionsAfterDatasetLoad() {
    requestModalCustomerOptionsCacheKey = '';
    requestModalCustomerOptionsReady = areRequestModalCustomerDatasetsReady();
    if (requestModalCustomerOptionsReady) buildRequestModalCustomerOptionsCache(true);
    refreshRequestModalCustomerStepIfVisible();
}

async function commitLegacyDatasetRows(plan, state, rows) {
    const {key,definition,wantsFull,owner} = plan;
    if (key === 'reserves' && wantsFull) {
        reservesInventory = await buildReserveInventoryRowsAsync(formatFetchedRows(rows,definition.sourceTable));
        rebuildDetailLookupIndexes();
        invalidateResolvedViewStateCaches();
        refreshRequestOptionsAfterDatasetLoad();
        persistUserScopedDatasetCache('reserves').catch(() => {});
        return;
    }
    const payload = buildDatasetPayload(key,rows);
    if (key === 'master' && !wantsFull && definition.mergeInitialRows === true && Array.isArray(payload.data)) {
        payload.data = mergeInitialMasterRowsWithExisting(payload.data);
    }
    processAndLoadData(payload);
    if (key === 'customerRepMap') refreshRequestOptionsAfterDatasetLoad();
    if (key === 'master' && state.rowCompleteness === 'complete' && rows.readMeta?.rowCompleteness === 'complete' && Number(rows.readMeta.total) === rows.length) {
        productionDisplayMasterReceipt = {rows:fullInventory,readScope:owner,permission:String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '')};
    }
}

function refreshViewsAfterLegacyDatasetLoad(key, wantsFull) {
    const render = view => queueInteractiveViewRender(view,false,true,wantsFull ? 18 : 8,220);
    if (key === 'reserves') {
        if (isViewVisible('av') && (activeAVTab === 'reserves' || shouldPrepareAvRepCustomerFilterData())) render('av');
        if (isViewVisible('reserves')) render('reserves');
        if (isViewVisible('reports')) render('reports');
    }
    if (key === 'customerRepMap' && isViewVisible('av') && shouldPrepareAvRepCustomerFilterData()) render('av');
    if (['avOpen','master','avHotPriceKeys'].includes(key) && isViewVisible('av')) {
        avResolvedBaseStateKey = '';
        render('av');
    }
    if (key === 'avHotPriceKeys') {
        const filter = getActiveEvalSimpleTaskFilterValue();
        if (isViewVisible('tasks') && (activeTaskView === 'hot-price' || filter === 'hot-price' || filter === 'hot-price-ssn')) render('tasks');
    }
    if (key === 'cav' || key === 'cavAvBlankKeys') {
        const filter = getActiveEvalSimpleTaskFilterValue();
        if (isViewVisible('tasks') && (activeTaskView === 'av-blanks' || filter === 'av-blanks')) render('tasks');
    }
}

async function runLegacyDatasetLoad(key, definition, state, wantsFull, options) {
    const startedAt = beginInternalPerfMeasure();
    if (shouldPauseInterruptibleRefresh(options)) {
        options.interruptedDuringLoad = true;
        return false;
    }
    const plan = createDatasetReadPlan(key,definition,wantsFull,options);
    let rows;
    try { rows = await fetchLegacyDatasetRows(plan); }
    catch (error) { rows = await recoverLegacyDatasetRows(plan,error); }
    if (!rows || plan.owner !== getSupabaseReadIdentityScope()) return false;
    if (shouldPauseInterruptibleRefresh(options)) {
        options.interruptedDuringLoad = true;
        return false;
    }
    const partial = updateLegacyDatasetLoadState(plan,state,rows);
    await commitLegacyDatasetRows(plan,state,rows);
    if (plan.owner !== getSupabaseReadIdentityScope()) return false;
    replayHydratedRowPatches();
    refreshViewsAfterLegacyDatasetLoad(key,wantsFull);
    if (key === 'master' && state.fullLoaded && (wantsFull || plan.fetchAll)) persistCurrentCache(true,'master-full');
    else persistCurrentCache();
    touchSyncTimestamp();
    if (partial) {
        state.lastLoadedAt = '';
        setTimeout(() => queueDatasetLoad('master','full',isTouchConstrainedDevice() ? 2200 : 900),80);
    }
    reportPerformanceHealthEvent('dataset_load','data_sync',getAdaptivePerfElapsedMs(startedAt),{
        reason:`${key}:${plan.modeLabel}`,affected_count:Array.isArray(rows) ? rows.length : 0
    });
    return true;
}

function shouldHydrateFirstPageForDatasetLoad(key = '', mode = 'initial') {
    const safeKey = String(key || '').trim();
    if (mode !== 'full' || safeKey !== 'master') return false;
    if (getDatasetRenderRowCount(safeKey) > 0) return false;
    const visibleView = getCurrentVisibleViewId();
    return ['home', 'drive', 'av', 'docks', 'managers', 'request', 'detail'].includes(visibleView);
}

async function hydrateFirstDatasetPageForRender(key = '', rows = [], meta = {}) {
    const safeKey = String(key || '').trim();
    if (!safeKey || !Array.isArray(rows) || !rows.length) return false;
    const state = getDatasetState(safeKey);
    processAndLoadData(buildDatasetPayload(safeKey, rows));
    state.firstPagePreviewLoaded = true;
    state.rowCompleteness = 'partial';
    state.expectedRowCount = meta.total;
    state.lastLoadedAt = new Date().toISOString();
    if (safeKey === 'master') {
        rebuildMasterInventoryIndexes();
        const view = getCurrentVisibleViewId();
        TRACKED_VIEW_IDS.forEach(markViewDirty);
        if (view !== 'home') queueInteractiveViewRender(view, false, true, 0, 140);
        scheduleProductionLiveSyncRender(true, { cachedPreview: true });
    }
    await yieldToUiFrame();
    return true;
}
