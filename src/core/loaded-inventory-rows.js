export function publishLoadedInventoryLookups(res) {
    if (Object.hasOwn(res,'requestHistoryData')) {
        requestHistoryInventory = (res.requestHistoryData || []).map((item, idx) => normalizeRequestHistoryRow(item, idx)).filter(Boolean);
        requestHistoryInventoryById = rebuildInventoryByIdMap(requestHistoryInventory);
    }

    if (Object.hasOwn(res,'salesCreditsData')) {
        salesCreditRequestsInventory = (res.salesCreditsData || []).map((item, idx) => normalizeSalesCreditRequestRow(item, idx)).filter(Boolean);
        salesCreditRequestsById = rebuildInventoryByIdMap(salesCreditRequestsInventory);
    }

    if (Object.hasOwn(res,'inventoryEditRequestsData')) {
        inventoryEditRequestInventory = (res.inventoryEditRequestsData || []).map((item) => normalizeInventoryEditLiveRecord(item)).filter(Boolean);
    }

    if (Object.hasOwn(res,'growerScoutReportsData')) {
        growerScoutReportsInventory = (res.growerScoutReportsData || []).map((item, idx) => normalizeGrowerScoutReportRow(item, idx)).filter(Boolean);
        rebuildGrowerScoutIndexes();
    }

    if (Object.hasOwn(res,'growerScoutAssetsData')) {
        growerScoutAssetsInventory = (res.growerScoutAssetsData || []).map((item, idx) => normalizeGrowerScoutAssetRow(item, idx)).filter(Boolean);
        rebuildGrowerScoutIndexes();
    }

    if (Object.hasOwn(res,'warehouseAssignedItemsData')) {
        warehouseAssignedItemsInventory = enrichManagerAssignedPlantGroups(res.warehouseAssignedItemsData || []).filter(item => item && item.present_in_drive !== false).map((item, idx) => normalizeWarehouseAssignedItemRow(item, idx)).filter(Boolean);
        clearWarehouseAssignedItemCaches();
        rebuildWarehouseAssignedItemIndexes(true);
        invalidateManagerEvalReport2Cache();
        // Unassigned summaries are emitted only by completed manual sync.
    }
}

export function publishLoadedOfficeInventory(res, hasMaster) {
    if (Object.hasOwn(res,'salesOfficeData') || (hasMaster && salesOfficeInventory.length)) {
        const salesOfficeSource = Object.hasOwn(res,'salesOfficeData') ? (res.salesOfficeData || []) : salesOfficeInventory;
        salesOfficeInventory = salesOfficeSource.map((item, idx) => {
            if (!item) return item;
            item.DOM_ID = 'so_' + (item.UNIQUE_ID || idx);
            return item;
        }).filter((item) => item && isEvalScopedDataRowVisibleToCurrentUser(item));
        syncRealtimeSalesOfficeRows();
    }

    if (Object.hasOwn(res,'flyerFolderRowsData')) {
        flyerFolderInventory = (res.flyerFolderRowsData || []).map((item, idx) => normalizeFlyerFolderRow(item, idx)).filter(Boolean);
        flyerFolderInventoryById = rebuildInventoryByIdMap(flyerFolderInventory);
    }
    if (hasMaster && flyerFolderInventory.length) {
        flyerFolderInventory.forEach((item) => hydrateFlyerFolderRowFromCurrentSource(item));
        flyerFolderInventoryById = rebuildInventoryByIdMap(flyerFolderInventory);
    }

    if (Object.hasOwn(res,'flyerFolderHistoryData')) {
        flyerFolderHistoryInventory = (res.flyerFolderHistoryData || []).map((item, idx) => normalizeFlyerFolderHistoryRow(item, idx)).filter(Boolean);
        flyerFolderHistoryInventoryById = rebuildInventoryByIdMap(flyerFolderHistoryInventory);
    }
}

let suspendSocDisplayIdentity = null;

function getSuspendSocDisplayIdentity() {
    return JSON.stringify([getSupabaseReadIdentityScope(), appAccessSnapshotState.snapshot?.dataPermissionVersion || '']);
}

export function getSuspendSocDisplayRows() {
    if (!canReadSuspendQueue() || suspendSocDisplayIdentity !== getSuspendSocDisplayIdentity()) return null;
    return socInventory;
}

export function publishLoadedDockInventory(res, hasMaster) {
    if (Object.hasOwn(res,'socData') || (hasMaster && socRawSourceRowsReady)) {
        if (Object.hasOwn(res,'socData')) {
            socRawSourceRows = cloneDockSourceRows(res.socData || []);
            socRawSourceRowsReady = true;
            suspendSocDisplayIdentity = getSuspendSocDisplayIdentity();
        }
        const socSource = Object.hasOwn(res,'socData') ? cloneDockSourceRows(socRawSourceRows)
            : buildDockSourceRowsForMasterRefresh(socRawSourceRows, socInventory);
        socInventory = hydrateDockSourceRows(socSource);
    }
    if (Object.hasOwn(res,'suspendTagData') || (hasMaster && suspendTagRawSourceRowsReady && suspendTagInventoryScope === getSupabaseReadIdentityScope())) {
        if (Object.hasOwn(res,'suspendTagData')) {
            suspendTagRawSourceRows = cloneDockSourceRows(res.suspendTagData || []);
            suspendTagRawSourceRowsReady = true;
        }
        const suspendTagSource = Object.hasOwn(res,'suspendTagData') ? cloneDockSourceRows(suspendTagRawSourceRows)
            : buildDockSourceRowsForMasterRefresh(suspendTagRawSourceRows,
                suspendTagInventory, isDockSuspendDcRequestSource);
        suspendTagInventory = uniquePhysicalSuspendTags(hydrateDockSourceRows(suspendTagSource).filter(isDockSuspendDcRequestSource));
        suspendTagInventoryScope = getSupabaseReadIdentityScope();
    }
}

export function publishLoadedReserveInventory(res, hasMaster) {
    if (Object.hasOwn(res,'reservesData') || (hasMaster && reservesInventory.length)) {
        const incomingReserveSource = Object.hasOwn(res,'reservesData') ? (res.reservesData || []) : reservesInventory;
        const keepExistingFullReserveWarm = !!res._fromCache && getDatasetState('reserves').fullLoaded && Array.isArray(reservesInventory) && reservesInventory.length > incomingReserveSource.length;
        const reserveSource = keepExistingFullReserveWarm ? reservesInventory : incomingReserveSource;
        const canUseFastReserveWarm = !!res._fromCache && Array.isArray(reserveSource) && reserveSource.length > 12000;
        reservesInventory = canUseFastReserveWarm
            ? buildReserveInventoryRowsFast(reserveSource)
            : reserveSource.map((item,idx)=>hydrateReserveInventoryRow(item, idx));
    }
}

export function publishLoadedCustomerInventory(res) {
    if (Object.hasOwn(res,'customerRepMapData')) {
        document.getElementById('manager-customer-rep-map-root')?.dispatchEvent(new Event('mapping-revision'));
        customerRepMapRows = (res.customerRepMapData || []).map((item, idx) => {
            if (!item) return null;
            item.DOM_ID = 'crm_' + (item.UNIQUE_ID || idx);
            return item;
        }).filter(Boolean);
        requestModalCustomerOptionsCacheKey = '';
        requestModalCustomerOptionsReady = areRequestModalCustomerDatasetsReady();
        if (requestModalCustomerOptionsReady) buildRequestModalCustomerOptionsCache(true);
    }

    if (Object.hasOwn(res,'cavData')) {
        cavInventory = (res.cavData || []).map((item, idx) => normalizeCavInventoryRow(item, idx));
    }

    if (Object.hasOwn(res,'cavAvBlankKeysData')) {
        cavAvBlankKeyInventory = (res.cavAvBlankKeysData || []).map((item, idx) => normalizeCavInventoryRow(item, idx));
    }

    if (Object.hasOwn(res,'avHotPriceKeysData')) {
        normalizeAvHotPriceKeyRows(res.avHotPriceKeysData || []);
    }
}
