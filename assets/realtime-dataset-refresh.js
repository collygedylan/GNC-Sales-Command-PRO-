function flushRealtimeDatasetUpdates(changedTables = []) {
    const tableSet = new Set((changedTables || []).filter(Boolean));
    if (!tableSet.size) return false;
    const dirtyIdsByTable = {};
    tableSet.forEach((tableName) => {
        dirtyIdsByTable[tableName] = consumeRealtimeDirtyRowIds(tableName);
    });
    const changedDatasetKeys = new Set();
    const changedMasterIds = new Set(dirtyIdsByTable['ph_master_inventory'] || []);
    touchRealtimeDatasetState(Array.from(tableSet));
    refreshRealtimeInventoryAndRequestDatasets(tableSet, changedDatasetKeys, changedMasterIds);
    refreshRealtimeOrderAndLookupDatasets(tableSet, changedDatasetKeys);
    const pendingEdits = getPendingEditsCache();
    if (pendingEdits && Object.keys(pendingEdits).length) applyLocalEdits();
    if (changedDatasetKeys.size) {
        propagateCommittedEdit(changedDatasetKeys.has('requests') ? ACTIVE_REQUEST_TABLE : '', null, Array.from(changedDatasetKeys), getVisibleAffectedViewIds(Array.from(changedDatasetKeys)), { delay: 4, typingDelay: 120, requestUiDelay: REQUEST_REALTIME_UI_DELAY_MS });
        if (changedDatasetKeys.has('requests')) flushPendingRequestArchives().catch(() => {});
    }
    updateDashboardSyncSummary();
    return true;
}

function refreshRealtimeInventoryAndRequestDatasets(tableSet, changedDatasetKeys, changedMasterIds) {
    if (tableSet.has('ph_master_inventory')) {
        const masterRefresh = refreshChangedMasterRealtimeSlices(changedMasterIds);
        (masterRefresh.changedDatasetKeys || []).forEach((key) => changedDatasetKeys.add(key));
        const linkedMasterIds = masterRefresh.linkedSyncIds;
        if (requestsInventory.length) {
            syncRealtimeRequestRows(linkedMasterIds);
            changedDatasetKeys.add('requests');
        }
        if (socInventory.length) {
            syncRealtimeSocRows(linkedMasterIds);
            changedDatasetKeys.add('soc');
        }
        if (salesOfficeInventory.length) {
            syncRealtimeSalesOfficeRows(linkedMasterIds);
            changedDatasetKeys.add('salesOffice');
        }
        if (changedMasterIds.size) {
            const changedMasterItems = Array.from(changedMasterIds).map((uid) => findItemByUniqueId(uid)).filter(Boolean);
            const masterClearOps = collectMasterAvRuleClearOps(changedMasterItems);
            if (masterClearOps.length) persistMasterAvRuleClearOps(masterClearOps);
        }
    }
    if (tableSet.has(ACTIVE_REQUEST_TABLE) && !changedDatasetKeys.has('requests')) {
        syncRealtimeRequestRows();
        changedDatasetKeys.add('requests');
    }
    if (tableSet.has(REQUEST_HISTORY_TABLE)) {
        syncRealtimeRequestRows();
        changedDatasetKeys.add('requestHistory');
        changedDatasetKeys.add('requests');
    }
    if (tableSet.has(SALES_CREDIT_REQUESTS_TABLE)) {
        changedDatasetKeys.add('salesCredits');
    }
    if (tableSet.has('ph_inventory_edit_requests')) {
        changedDatasetKeys.add('inventoryEditRequests');
        changedDatasetKeys.add('requests');
    }
    if (tableSet.has('ph_av_option_eval_requests')) {
        avOptionEvalRequestsLoaded = false;
        changedDatasetKeys.add('avOptionEvalRequests');
        changedDatasetKeys.add('requests');
    }
    if (tableSet.has('ph_reserves')) {
        syncRealtimeReserveRows();
        changedDatasetKeys.add('reserves');
    }
}

function refreshRealtimeOrderAndLookupDatasets(tableSet, changedDatasetKeys) {
    if (tableSet.has('ph_soc_master') && !changedDatasetKeys.has('soc')) {
        syncRealtimeSocRows();
        changedDatasetKeys.add('soc');
        if (canReadSuspendQueue()) changedDatasetKeys.add('requests');
    }
    if (tableSet.has('ph_sales_office') && !changedDatasetKeys.has('salesOffice')) {
        syncRealtimeSalesOfficeRows();
        changedDatasetKeys.add('salesOffice');
    }
    if (tableSet.has(FLYER_FOLDER_ROWS_TABLE)) {
        changedDatasetKeys.add('flyerRows');
    }
    if (tableSet.has(FLYER_FOLDER_HISTORY_TABLE)) {
        changedDatasetKeys.add('flyerHistory');
    }
    if (tableSet.has(WAREHOUSE_ASSIGNED_ITEMS_TABLE)) {
        clearWarehouseAssignedItemCaches();
        invalidateManagerEvalReport2Cache();
        changedDatasetKeys.add('warehouseAssignedItems');
        markViewDirty('managers');
        if (!shouldDeferInteractiveBackgroundWork() && isViewVisible('managers') && activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW) scheduleManagersRender(true);
    }
    if (tableSet.has('ph_app_settings')) {
        refreshAvBlanksPhotoBypassSettingsFromRemote({ force: true }).then(() => {
            markViewDirty('tasks');
            markViewDirty('sales-office');
            markViewDirty('managers');
            if (isViewVisible('tasks')) scheduleTasksRender(16, 0, true);
            if (isViewVisible('sales-office')) queueInteractiveViewRender('sales-office', false, true, 16, 180);
            if (isViewVisible('managers')) scheduleManagersRender(true);
        }).catch(() => {});
    }
    if (tableSet.has('ph_cav_import')) {
        syncRealtimeCavRows();
        changedDatasetKeys.add('cav');
        changedDatasetKeys.add('cavAvBlankKeys');
    }
    if (tableSet.has('ph_av_notes')) {
        invalidateAvNotesCommonNameIndex();
        changedDatasetKeys.add('avNotes');
    }
}

function refreshRealtimeMasterViews(tableName, eventType, nextRow, oldRow, uniqueId) {
    if (tableName === 'ph_master_inventory') {
        invalidateResolvedViewStateCaches();
        refreshActiveMasterDetailFromRealtimeRow(nextRow || oldRow, eventType);
        if (eventType !== 'DELETE') {
            scheduleUiRender(`moved-season-av-sync:${uniqueId}`, () => {
                syncMovedSeasonCurrentRowsFromSource(nextRow || oldRow, { remote: true, maxRemote: 4 });
                hydrateMovedSeasonCurrentRowsFromSources({ remote: true, maxRemote: 4 });
            }, 96);
        }
        ['drive','tasks','managers','av','review','move-up','advertisement','low-stock','moves','reports'].forEach((viewId) => markViewDirty(viewId));
        if (activeReqTab === 'recount') markViewDirty('request');
        if (!shouldDeferInteractiveBackgroundWork()) {
            const forceCompletionRender = !!(nextRow && hasCompletionDateValue(nextRow));
            if (isViewVisible('drive')) queueInteractiveViewRender('drive', false, false, 0, 120);
            if (isViewVisible('tasks')) queueInteractiveViewRender('tasks', false, forceCompletionRender, 0, 120);
            if (isViewVisible('managers') && isManagerApprovalTab(activeHomeTab)) queueInteractiveViewRender('managers', false, forceCompletionRender, 0, 120);
            if (isViewVisible('av')) queueInteractiveViewRender('av', false, false, 0, 140);
            if (isViewVisible('review')) queueInteractiveViewRender('review', false, false, 0, 160);
            if (isViewVisible('move-up')) queueInteractiveViewRender('move-up', false, false, 0, 160);
            if (isViewVisible('low-stock')) queueInteractiveViewRender('low-stock', false, false, 0, 160);
            if (isViewVisible('moves')) queueInteractiveViewRender('moves', false, forceCompletionRender, 0, 120);
            if (isViewVisible('reports')) queueInteractiveViewRender('reports', false, false, 0, 180);
            if (activeReqTab === 'recount' && isViewVisible('request')) scheduleRequestRender(0, REQUEST_REALTIME_UI_DELAY_MS, true);
        }
        return true;
    }
    if (tableName === ACTIVE_REQUEST_TABLE) {
        invalidateResolvedViewStateCaches();
        requestViewLiveSyncSignature = buildRequestLiveSyncSignature(requestsInventory);
        refreshActiveRequestDetailFromRealtimeRow(nextRow || oldRow, eventType);
        triggerRequestRealtimeUiRefresh(0);
        return true;
    }
    if (tableName === REQUEST_HISTORY_TABLE) {
        invalidateResolvedViewStateCaches();
        requestViewLiveSyncSignature = buildRequestLiveSyncSignature(requestsInventory);
        triggerRequestRealtimeUiRefresh(0);
        return true;
    }
}

function refreshRealtimeRequestAndOrderViews(tableName) {
    if (tableName === SALES_CREDIT_REQUESTS_TABLE) {
        invalidateResolvedViewStateCaches();
        triggerRequestRealtimeUiRefresh(0);
        return true;
    }
    if (tableName === 'ph_inventory_edit_requests') {
        invalidateResolvedViewStateCaches();
        markViewDirty('request');
        queueDatasetLoad('inventoryEditRequests', 'full', 0);
        if (isViewVisible('request') && activeReqTab === 'shear-test') {
            scheduleRequestRender(0, REQUEST_REALTIME_UI_DELAY_MS, true);
        }
        return true;
    }
    if (tableName === 'ph_av_option_eval_requests') {
        invalidateResolvedViewStateCaches();
        avOptionEvalRequestsLoaded = false;
        triggerRequestRealtimeUiRefresh(0);
        return true;
    }
    if (tableName === 'ph_soc_master') {
        invalidateResolvedViewStateCaches();
        markViewDirty('docks');
        if (canReadSuspendQueue()) {
            triggerRequestRealtimeUiRefresh(0);
        }
        if (!shouldDeferInteractiveBackgroundWork() && isViewVisible('docks')) scheduleDocksRender(0);
        return true;
    }
}

function refreshRealtimeFlyerViews(tableName, eventType, nextRow) {
    if (tableName === 'ph_sales_office') {
        invalidateResolvedViewStateCaches();
        if (eventType !== 'DELETE') refreshActiveSalesOfficeDetailFromRow(nextRow);
        markViewDirty('sales-office');
        markViewDirty('moves');
        if (activeReqTab === 'recount') markViewDirty('request');
        if (!shouldDeferInteractiveBackgroundWork()) {
            if (isViewVisible('sales-office')) queueInteractiveViewRender('sales-office', false, true, 0, 120);
            if (isViewVisible('moves')) queueInteractiveViewRender('moves', false, true, 0, 120);
            if (activeReqTab === 'recount' && isViewVisible('request')) scheduleRequestRender(0, REQUEST_REALTIME_UI_DELAY_MS, true);
        }
        return true;
    }
    if (tableName === FLYER_FOLDER_ROWS_TABLE) {
        invalidateResolvedViewStateCaches();
        markViewDirty('tasks');
        markViewDirty('advertisement');
        scheduleTasksRender(48);
        if (isViewVisible('advertisement')) {
            renderAdvertisementFlyerFolders();
        }
        return true;
    }
    if (tableName === FLYER_FOLDER_HISTORY_TABLE) {
        invalidateResolvedViewStateCaches();
        markViewDirty('tasks');
        markViewDirty('advertisement');
        scheduleTasksRender(48);
        if (isViewVisible('advertisement')) {
            renderAdvertisementFlyerFolders();
        }
        return true;
    }
}

function refreshRealtimeScoutAndAssignmentViews(tableName) {
    if (tableName === GROWER_SCOUT_REPORTS_TABLE || tableName === GROWER_SCOUT_ASSETS_TABLE) {
        markViewDirty('grower');
        markViewDirty('pest-management');
        if (isViewVisible('grower')) queueInteractiveViewRender('grower', false, true, 0, 120);
        if (isViewVisible('pest-management')) queueInteractiveViewRender('pest-management', false, true, 0, 120);
        return true;
    }
    if (tableName === WAREHOUSE_ASSIGNED_ITEMS_TABLE) {
        invalidateResolvedViewStateCaches();
        invalidateManagerEvalReport2Cache();
        markViewDirty('tasks');
        markViewDirty('managers');
        if (!shouldDeferInteractiveBackgroundWork() && isViewVisible('tasks')) scheduleTasksRender(0, 0, true);
        if (!shouldDeferInteractiveBackgroundWork() && isViewVisible('managers') && activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW) scheduleManagersRender(true);
        return true;
    }
}
