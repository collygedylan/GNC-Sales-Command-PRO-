function getViewLoadingConfig(viewId) {
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
