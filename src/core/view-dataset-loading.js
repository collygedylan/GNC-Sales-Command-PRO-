const warmAvInventoryOwners = new WeakMap();

export function rememberWarmAvInventoryRows(rows) {
    if (rows.length && hasAuthenticatedOperationalReadIdentity()) {
        warmAvInventoryOwners.set(rows, getSupabaseReadIdentityScope());
    }
}

export function canRenderWarmAvInventory() {
    if (activeAVTab !== 'open' || !canAccessView('av') || hasConfirmedCurrentAccountRevocation()) return false;
    const owner = getSupabaseReadIdentityScope();
    return [fullInventory, avOpenInventory].some(rows => rows.length && warmAvInventoryOwners.get(rows) === owner);
}

export function retainPendingRequestDisplayOnReadFailure(viewId) {
    return viewId === 'request' && activeReqTab === 'pending' && canAccessView('request')
        && hasAuthenticatedOperationalReadIdentity() && !hasConfirmedCurrentAccountRevocation();
}

export function getViewLoadingConfig(viewId) {
    const pagedSurface = getActiveManagerReportPageSurface(viewId);
    if (viewId === 'sales-inventory' || pagedSurface && useManagerReportPages(pagedSurface)) return { required:[], background:[], label:'Loading report rows...' };
    if (canUseProductionLiveSync() && window.AgMetricLiveSyncRegistry.views[viewId]) {
        const context = getProductionLiveSyncSideContext();
        context.surfaces = context.surfaces.filter(id => !id.startsWith('badge:'));
        return { required: window.AgMetricLiveSyncRegistry.getCoreKeys(viewId, context).map(key => ({ key, mode: 'full' })),
            background: [], label: 'Verifying current data...' };
    }
    return getLegacyInventoryViewLoading(viewId)
        ?? getLegacyManagerViewLoading(viewId)
        ?? getLegacyWorkflowViewLoading(viewId) ?? null;
}

function getLegacyInventoryViewLoading(viewId) {
    if (viewId === 'home' && canUseProductionLiveSync()) return { required: [], background: [], label: 'Opening Home...' };
    if (viewId === 'drive') return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'master', mode: 'full' }], background: [{ key: 'warehouseAssignedItems', mode: 'full' }], label: 'Loading verified Drive rows...' });
    if (viewId === 'building') return { required: [{ key: 'master', mode: 'full' }], background: [], label: 'Loading building workbench rows...' };
    if (viewId === 'av') {
        if (activeAVTab === 'reserves') {
            if (getRoleAccessState().isRep) {
                return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'reserves', mode: 'initial' }], background: [{ key: 'reserves', mode: 'full' }], label: 'Loading your reserve rows...' });
            }
            return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'reserves', mode: 'initial' }], background: [{ key: 'reserves', mode: 'full' }], label: 'Loading reserve rows...' });
        }
        if (shouldUseRepAvOpenDataset()) {
            const required = [{ key: 'avOpen', mode: 'full' }];
            const background = [];
            // Rep AV visibility depends on both the complete seasonal
            // inventory and the rep's complete reserve itemcode set.
            // Loading reserves only after opening the customer filter
            // makes the default Current Season count/export incomplete.
            required.push({ key: 'reserves', mode: 'full' });
            if (shouldPrepareAvRepCustomerFilterData()) background.push({ key: 'customerRepMap', mode: 'full' });
            return withEvalInventoryEditRequestsForRowView({ required, background, label: 'Loading verified AV season rows...' });
        }
        return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'master', mode: 'full' }], background: [], label: 'Loading verified AV season rows from Drive Mode rows...' });
    }
    if (viewId === 'bunch-note') return { required: [], background: [], label: 'Loading Inv Bunch Notes...' };
    if (viewId === 'hl-order') return { required: [{ key: 'soc', mode: 'full' }, { key: 'master', mode: 'full' }], background: [], label: 'Loading HL orders...' };
    if (viewId === 'docks') return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'soc', mode: 'full' }], background: [{ key: 'master', mode: 'full' }], label: 'Loading all dock rows...' });
    if (viewId === 'request') return getRequestViewLoadingConfig(activeReqTab);
}

function getLegacyManagerViewLoading(viewId) {
    if (viewId === 'managers') {
        if (isTaskDiagnosticsView(activeHomeTab)) {
            return { required: [], background: [], label: 'Loading manager tools...' };
        }
        if (isInventoryChecksApprovalTaskView(activeHomeTab)) {
            return { required: [{ key: 'master', mode: 'full' }, { key: 'inventoryEditRequests', mode: 'full' }], background: [], label: 'Loading inventory check approvals...' };
        }
        if (isManagerApprovalTab(activeHomeTab)) {
            return { required: [{ key: 'master', mode: 'full' }], background: [], label: 'Loading manager approval rows...' };
        }
        if (activeHomeTab === 'moves') {
            if (activeMovesTab === 'office') {
                return {
                    required: [{ key: 'salesOffice', mode: 'full' }, { key: 'inventoryEditRequests', mode: 'full' }],
                    background: [{ key: 'master', mode: 'full' }],
                    label: 'Loading inventory office move rows...'
                };
            }
            return { required: [{ key: 'master', mode: 'full' }, { key: 'salesOffice', mode: 'full' }, { key: 'requests', mode: 'full' }], background: [], label: 'Loading move approvals and evaluation rows...' };
        }
        if (activeHomeTab === MANAGER_HISTORICAL_REPORT_VIEW) {
            return { required: [], background: [], label: 'Loading historical report tools...' };
        }
        return { required: [], background: [{ key: 'master', mode: 'initial' }], label: 'Loading manager tools...' };
    }
    if (viewId === 'sales') return { required: [], background: [], label: 'Loading sales...' };
    if (viewId === 'qc') return { required: [], background: [], label: 'Loading QC...' };
    if (viewId === 'communication') return { required: [], background: [], label: 'Loading communication...' };
    if (viewId === 'department-calendar') return { required: [], background: [], label: 'Loading department calendar...' };
    if (viewId === 'production') return { required: [], background: [], label: 'Loading production...' };
    if (viewId === 'production-workflow') return { required: [], background: [{ key: 'master', mode: 'full' }], label: 'Loading production workflow...' };
    if (viewId === 'sales-inventory') return withEvalInventoryEditRequestsForRowView({ required: [], background: [], label: 'Loading inventory...' });
    if (viewId === 'weather-hold') return withEvalInventoryEditRequestsForRowView({ required: [], background: [], label: 'Loading weather...' });
    if (viewId === 'shear-list') return { required: [], background: [{ key: 'master', mode: 'full' }, { key: 'reserves', mode: 'full' }], label: 'Loading shear list...' };
    if (viewId === 'disease-pest') return { required: [], background: [], label: 'Loading disease and pest management...' };
    if (viewId === 'chat') return { required: [], background: [], label: 'Loading chat...' };
    if (viewId === 'reserves') {
        if (getRoleAccessState().isRep) {
            return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'reserves', mode: 'full' }], background: [], label: 'Loading all of your reserve rows...' });
        }
        return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'reserves', mode: 'full' }], background: [], label: 'Loading all reserve rows...' });
    }
    if (viewId === 'office') return { required: [], background: [], label: 'Loading office...' };
    if (viewId === 'po-management') return { required: [], background: [], label: 'Loading PO Managment...' };
    if (viewId === 'sales-office') return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'salesOffice', mode: 'full' }], background: [{ key: 'master', mode: 'full' }], label: 'Loading verified sales office rows...' });
}

function getLegacyWorkflowViewLoading(viewId) {
    if (viewId === 'moves') {
        if (activeMovesTab === 'office') {
            if (isInventoryOfficeBlankShellTab(activeInventoryOfficeApprovalType)) {
                return { required: [], background: [], label: 'Loading inventory office...' };
            }
            return {
                required: [{ key: 'salesOffice', mode: 'full' }, { key: 'inventoryEditRequests', mode: 'full' }],
                background: [{ key: 'master', mode: 'full' }],
                label: 'Loading inventory office queue...'
            };
        }
        return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'master', mode: 'full' }, { key: 'salesOffice', mode: 'full' }, { key: 'requests', mode: 'full' }], background: [], label: 'Loading verified move approvals and candidates...' });
    }
    if (viewId === 'tasks') {
        if (isTaskDiagnosticsView(activeTaskView)) {
            return { required: [], background: [], label: 'Loading tasks...' };
        }
        const isFlyerTaskView = activeTaskView === 'flyer';
        const required = [{ key: 'master', mode: 'full' }, { key: 'warehouseAssignedItems', mode: 'full' }];
        if (isFlyerTaskView) required.push({ key: 'flyerRows', mode: 'full' }, { key: 'flyerHistory', mode: 'full' });
        const background = [{ key: 'master', mode: 'full' }, { key: 'flyerRows', mode: 'full' }, { key: 'flyerHistory', mode: 'full' }];
        const activeEvalSimpleFilter = getActiveEvalSimpleTaskFilterValue();
        const needsTaskHotPriceKeys = activeTaskView === 'hot-price' || activeEvalSimpleFilter === 'hot-price' || activeEvalSimpleFilter === 'hot-price-ssn';
        if (needsTaskHotPriceKeys) {
            required.push({ key: 'avHotPriceKeys', mode: 'full' });
        }
        if (activeTaskView === 'av-blanks' || activeEvalSimpleFilter === 'av-blanks') {
            required.push({ key: 'cavAvBlankKeys', mode: 'full' });
            background.push({ key: 'cav', mode: 'full' });
            return withEvalInventoryEditRequestsForRowView({ required, background, label: 'Loading current AV Blank rows...' });
        }
        return withEvalInventoryEditRequestsForRowView({ required, background, label: needsTaskHotPriceKeys ? 'Loading HOT PRICE task rows...' : 'Loading task inventory...' });
    }
    if (viewId === 'low-stock') return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'master', mode: 'full' }], background: [], label: 'Loading verified NCR rows...' });
    if (viewId === 'review') return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'master', mode: 'full' }], background: [], label: 'Loading verified review rows...' });
    if (viewId === 'move-up') return withEvalInventoryEditRequestsForRowView({ required: [{ key: 'master', mode: 'full' }], background: [], label: 'Loading verified Move Up rows...' });
    if (viewId === 'advertisement') return { required: [{ key: 'master', mode: 'full' }, { key: 'flyerRows', mode: 'full' }, { key: 'flyerHistory', mode: 'full' }], background: [], label: 'Loading verified advertisement assets...' };
    if (viewId === 'diagnostics') return { required: [], background: [], label: 'Diagnostics retired.' };
    if (viewId === 'grower') return { required: [{ key: 'master', mode: 'full' }], background: [{ key: 'growerScoutReports', mode: 'full' }, { key: 'growerScoutAssets', mode: 'full' }], label: 'Loading verified Grower inventory...' };
    if (viewId === 'pest-management') return { required: [{ key: 'growerScoutReports', mode: 'full' }, { key: 'growerScoutAssets', mode: 'full' }], background: [], label: 'Loading verified pest management...' };
    if (viewId === 'reports') return { required: [{ key: 'master', mode: 'full' }, { key: 'requests', mode: 'full' }, { key: 'requestHistory', mode: 'full' }, { key: 'salesCredits', mode: 'full' }, { key: 'reserves', mode: 'full' }, { key: 'soc', mode: 'full' }], background: [], label: 'Loading verified reports...' };
}

export function ensureViewDataForRender(viewId) {
    const pagedSurface = getActiveManagerReportPageSurface(viewId);
    if (viewId === 'sales-inventory' || pagedSurface && useManagerReportPages(pagedSurface)) return false;
    // Eval Reports #2 owns its inventory/assignment load and keeps its
    // last-good index. Generic Manager verification must not replace
    // the report panel with the shared view error screen.
    if (shouldLetManagerEvalReport2OwnLoadState(viewId)) return false;
    const config = getViewLoadingConfig(viewId);
    if (!config) return false;
    return canUseProductionLiveSync() ? ensureProductionViewDataForRender(viewId) : ensureLegacyViewDataForRender(viewId, config);
}

function ensureProductionViewDataForRender(viewId) {
    const context = getProductionLiveSyncContext();
    if (!context.adapters.length) return false;
    const optionalBunchView = viewId === 'bunch-note'
        || viewId === 'request' && ['bunch-notes', 'bunch-count-review'].includes(String(activeReqTab || '').trim().toLowerCase());
    if (optionalBunchView || viewId === 'docks') {
        void getProductionLiveSyncCoordinator().check('visible-view').catch(() => false);
        return false;
    }
    if (getCurrentVisibleViewId() !== viewId) return true;
    if (viewId === 'av' && canRenderWarmAvInventory()) {
        void getProductionLiveSyncCoordinator().check('visible-view').catch(() => false);
        return false;
    }
    const key = productionVerifiedViewKey(context);
    if (productionLiveSyncVerifiedView === key
        || hasCurrentProductionReadStatus(productionLiveSyncCoordinator?.getStatus(), context)) return false;
    // Navigation changes verification identity, not the ownership of
    // this account's already-rendered snapshot. Retain its display
    // before a loading state can replace it; revalidation still runs.
    if (!hasProgressiveViewData(context)) getProductionLiveSyncCoordinator().retainDisplay();
    const canDisplay = hasProgressiveViewData(context);
    if (productionLiveSyncViewLoad?.key === key && productionLiveSyncViewLoad.failed) {
        if (canDisplay) return false;
        if (viewId === 'av') {
            showAvReadUnavailableState(productionLiveSyncViewLoad.error || new Error(productionLiveSyncCoordinator.getStatus().message || 'Available inventory could not be verified.'), false, viewId);
            return true;
        }
        showViewErrorState(viewId, productionLiveSyncCoordinator.getStatus().message || 'Current data could not be verified. Please retry.', true, productionLiveSyncViewLoad.error);
        return true;
    }
    if (!canDisplay) showViewLoadingState(viewId, 'Loading data...', true);
    if (productionLiveSyncViewLoad?.key !== key || !productionLiveSyncViewLoad.pending) startProductionViewRead(viewId, key, canDisplay);
    return !canDisplay;
}

function startProductionViewRead(viewId, key, canDisplay) {
    const load = { key, pending: true, failed: false };
    productionLiveSyncViewLoad = load;
    if (!canDisplay && (viewId === 'drive' || viewId === 'av')) {
        const recoveryScope = window.AgMetricLifecycle.createScope({ lifetime: 'view', foreground: true });
        recoveryScope.timeout(() => {
            recoveryScope.dispose();
            void recoverColdInventoryView(viewId, load);
        }, 1000);
    }
    getProductionLiveSyncCoordinator().check('visible-view').then(() => {
        const status = productionLiveSyncCoordinator.getStatus();
        load.failed = productionLiveSyncVerifiedView !== key
            && ['Needs attention', 'Importing', 'Offline'].includes(status.state);
        if (load.failed && status.message) load.error = Object.assign(new Error(status.message), {
            status: Number(status.status || 0), code: String(status.code || '').trim().toUpperCase()
        });
    }).catch((error) => { load.failed = true; load.error = error; }).finally(() => {
        load.pending = false;
        if (!load.failed || productionLiveSyncViewLoad !== load || !isViewVisible(viewId) || productionVerifiedViewKey() !== key) return;
        if (viewId === 'drive' || viewId === 'av') void recoverColdInventoryView(viewId, load);
        const currentHasDisplay = hasProgressiveViewData(getProductionLiveSyncContext());
        if (load.failed && !currentHasDisplay) {
            if (viewId === 'av' || viewId === 'drive') showAvReadUnavailableState(load.error || new Error(productionLiveSyncCoordinator.getStatus().message || 'Available inventory could not be verified.'), false, viewId);
            else showViewErrorState(viewId, productionLiveSyncCoordinator.getStatus().message || 'Current data could not be verified. Please retry.', true, load.error);
        } else if (load.failed && (viewId === 'av' || viewId === 'drive')) {
            showAvReadUnavailableState(load.error || new Error(productionLiveSyncCoordinator.getStatus().message || 'Available inventory refresh failed.'), true, viewId);
        }
        // Successful publication is rendered once by onStatus.
    });
}

function ensureLegacyViewDataForRender(viewId, config) {
    if (viewId === 'av' && canRenderWarmAvInventory()) {
        queueViewBackgroundDatasets([...config.required, ...config.background]);
        return false;
    }
    const blockedByManualSync = hasActiveManualSync() && config.required.some((item) => isDatasetFrozenDuringManualSync(item.key, item.mode) && !isDatasetLoaded(item.key, item.mode));
    if (blockedByManualSync) {
        showViewLoadingState(viewId, 'Manual sync running...');
        updateSyncDiagnostics('manual-sync');
        return true;
    }
    const pending = config.required.filter((item) => !isDatasetLoaded(item.key, item.mode));
    const blockingPending = pending.filter((item) => !canUseDatasetForImmediateRender(item));
    if (!blockingPending.length) {
        if (pending.length) loadLegacyViewDataInBackground(viewId, pending);
        queueViewBackgroundDatasets(config.background || []);
        return false;
    }
    startLegacyBlockingViewRead(viewId, config, blockingPending);
    return true;
}

function startLegacyBlockingViewRead(viewId, config, blockingPending) {
    showViewLoadingState(viewId, config.label);
    const viewDataStartedAt = beginInternalPerfMeasure();
    loadDatasetTargetsWithLimit(blockingPending).then(() => {
        resetViewLoadRetry(viewId);
        reportPerformanceHealthEvent('view_data_ready', 'rendering', getAdaptivePerfElapsedMs(viewDataStartedAt), {
            reason: viewId,
            affected_count: blockingPending.length
        });
        queueViewBackgroundDatasets(config.background || []);
        markViewDirty(viewId);
        if (isViewVisible(viewId)) {
            prepareLatestViewRender(viewId);
            renderViewContent(viewId, false, true);
        }
    }).catch(error => handleLegacyViewReadFailure(viewId, error));
}

function handleLegacyViewReadFailure(viewId, error) {
    if (!isViewVisible(viewId)) return;
    if (viewId === 'av') showAvReadUnavailableState(error, hasProgressiveViewData());
    else showViewErrorState(viewId, error?.message || 'Could not load data.', false, error);
    scheduleViewLoadRetry(viewId, error);
}

function loadLegacyViewDataInBackground(viewId, pending) {
    const concurrency = getDatasetTargetLoadConcurrency(pending, { allowWhileInteractive: true });
    loadDatasetTargetsWithLimit(pending, {
        preserveRequestedMode: true,
        allowWhileInteractive: true,
        retryReason: 'view-immediate-background'
    }, concurrency).then(() => {
        markViewDirty(viewId);
        if (isViewVisible(viewId)) queueInteractiveViewRender(viewId, false, true, 0, 120);
    }).catch(() => {});
}

function queueViewBackgroundDatasets(targets) {
    const delay = getViewBackgroundLoadDelayMs();
    for (const {key, mode} of targets) {
        if (!isDatasetLoaded(key, mode) && !isDatasetFrozenDuringManualSync(key, mode)) queueDatasetLoad(key, mode, delay);
    }
}
