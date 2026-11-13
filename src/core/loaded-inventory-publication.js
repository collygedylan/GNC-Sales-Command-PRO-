const loadedInventoryDatasetKeys = Object.freeze({
    "data": "master",
    "avOpenData": "avOpen",
    "requestsData": "requests",
    "requestHistoryData": "requestHistory",
    "salesCreditsData": "salesCredits",
    "inventoryEditRequestsData": "inventoryEditRequests",
    "reservesData": "reserves",
    "customerRepMapData": "customerRepMap",
    "socData": "soc",
    "suspendTagData": "suspendTag",
    "salesOfficeData": "salesOffice",
    "flyerFolderRowsData": "flyerRows",
    "flyerFolderHistoryData": "flyerHistory",
    "growerScoutReportsData": "growerScoutReports",
    "growerScoutAssetsData": "growerScoutAssets",
    "warehouseAssignedItemsData": "warehouseAssignedItems",
    "cavData": "cav",
    "cavAvBlankKeysData": "cavAvBlankKeys",
    "avHotPriceKeysData": "avHotPriceKeys",
    "avNotesData": "avNotes"
});

function prepareLoadedInventoryPublication(res) {
    const preparedMasterAtEntry = Array.isArray(res.data) ? getCurrentPreparedMasterRows(res.data) : null;
    const preparedDataAtEntry = preparedMasterAtEntry ? res.data : null;
    if (preparedDataAtEntry) {
        const payloadWithoutPreparedData = { ...res };
        delete payloadWithoutPreparedData.data;
        res = { ...redactEvalSensitiveData(payloadWithoutPreparedData), data: preparedDataAtEntry };
    } else res = redactEvalSensitiveData(res);
    if (res._fromCache === true) [res.data, res.requestsData, preparedMasterAtEntry?.avOpenRows]
        .forEach(rows => (Array.isArray(rows) ? rows : []).forEach(clearCardLocationOnHandReceipt));
    const hasKey = (key) => Object.prototype.hasOwnProperty.call(res, key);
    const hasMaster = hasKey('data');
    // Master publication stamps after invalidating the preceding snapshot.
    if (res._verifiedLiveSync === true && !hasMaster) {
        const receiptScope = String(res._locOnHandReceiptScope || '');
        const receiptPermission = String(res._locOnHandReceiptPermission || '');
        const receiptRevision = String(res._locOnHandReceiptRevision || '');
        acceptCardLocationOnHandSourceReceipt(receiptScope, receiptPermission, receiptRevision);
        [res.data, res.requestsData, preparedMasterAtEntry?.avOpenRows]
            .forEach(rows => (Array.isArray(rows) ? rows : []).forEach(row => stampCardLocationOnHandReceipt(row, receiptScope, receiptPermission, receiptRevision)));
    }
    const changedDatasetKeys = Object.entries(loadedInventoryDatasetKeys).filter(([key]) => hasKey(key)).map(([, key]) => key);
    return {res, hasMaster, preparedMasterAtEntry, changedDatasetKeys};
}

function hydrateLoadedRequestEvalMeta(item) {
    if (!hasEvalTaskRequestMeta(item)) return;
    hydrateEvalTaskRequestRowFromMeta(item);
    normalizeRowPhotoFields(item);
    buildSearchIndex(item);
}

function hydrateLoadedRequestRow(item) {
    if (!item.DOM_ID) item.DOM_ID = 'req_' + item.UNIQUE_ID;
    item.REQ_STATUS = normalizeRequestStatus(firstNonEmptyValue(item.REQ_STATUS, item.req_status, item.STATUS, 'Pending')) || 'Pending';
    item.REQ_ARCHIVED = item.REQUEST_HISTORY ? false : (item.REQ_ARCHIVED === true || item.REQ_ARCHIVED === 1
        || item.REQ_ARCHIVED === '1' || String(item.REQ_ARCHIVED || '').trim().toLowerCase() === 'true');
    hydrateLoadedRequestEvalMeta(item);
    const masterItem = item.REQUEST_HISTORY ? null : findLinkedMasterRow(item);
    if (!masterItem) {
        normalizeRowPhotoFields(item);
        buildSearchIndex(item);
        return mergeRequestLiveCanonicalEvidence(item);
    }
    syncMasterFieldsToRequestRow(masterItem, item);
    item.APP_TAB_ASSIGNMENT = firstNonEmptyValue(item.APP_TAB_ASSIGNMENT, masterItem.APP_TAB_ASSIGNMENT);
    hydrateLoadedRequestEvalMeta(item);
    return mergeRequestLiveCanonicalEvidence(item);
}

function publishLoadedRequestInventory(res, hasMaster) {
    const hasRequests = Object.hasOwn(res, 'requestsData');
    if (!hasRequests && !Object.hasOwn(res, 'requestHistoryData') && !(hasMaster && requestsInventory.length)) return;
    const activeSource = hasRequests ? reconcileIncomingRequestRows(res.requestsData || [])
        : (requestsInventory || []).filter(item => item && !item.REQUEST_HISTORY);
    const rows = mergeRequestRowsWithHistory(activeSource, requestHistoryInventory);
    requestsInventory = rows.map(hydrateLoadedRequestRow).filter(item => isEvalScopedDataRowVisibleToCurrentUser(item));
    applyPendingRequestArchives();
    invalidateRequestViewResolvedCaches();
    updateFooterRequestBadge();
    requestViewLiveSyncSignature = buildRequestLiveSyncSignature(requestsInventory);
    if (!res._verifiedLiveSync && currentUser && canAccessView('request') && navigator.onLine !== false && !document.hidden) {
        syncAlwaysOnRequestData(getRequestViewLiveSyncInterval({ alwaysOn: true, allowHealthyRealtime: true }));
    }
    if (hasRequests && !res._verifiedLiveSync) triggerRequestRealtimeUiRefresh(0);
}

function finishLoadedInventoryPublication(res, hasMaster, changedDatasetKeys, clearOps) {
    if (clearOps.length) persistMasterAvRuleClearOps(clearOps);
    if (changedDatasetKeys.length) {
        rebuildDetailLookupIndexes();
        invalidateResolvedViewStateCaches({ preserveAvPreparation: res._verifiedLiveSync === true
            && !Object.keys(getPendingEditsCache()).length && !clearOps.length });
        applyLocalEdits();
        applyPendingRequestArchives();
        if (!res._verifiedLiveSync) refreshAffectedViews(changedDatasetKeys);
        scheduleTaskHotCacheWarmup('dataset-change', hasMaster ? 90 : 160);
        if (!res._verifiedLiveSync && changedDatasetKeys.includes('requests')) flushPendingRequestArchives().catch(() => {});
    }
    updateDashboardSyncSummary();
}

export function processAndLoadData(payload) {
    if (!payload) return;
    const {res, hasMaster, preparedMasterAtEntry, changedDatasetKeys} = prepareLoadedInventoryPublication(payload);
    if (Object.hasOwn(res, 'avNotesData')) {
        avNotesDb = res.avNotesData || [];
        invalidateAvNotesCommonNameIndex();
    }
    const clearOps = hasMaster ? publishLoadedMasterInventory(res, preparedMasterAtEntry) : [];
    publishLoadedAvInventory(res, hasMaster, changedDatasetKeys);
    publishLoadedInventoryLookups(res);
    publishLoadedRequestInventory(res, hasMaster);
    publishLoadedOfficeInventory(res, hasMaster);
    publishLoadedDockInventory(res, hasMaster);
    publishLoadedReserveInventory(res, hasMaster);
    publishLoadedCustomerInventory(res);
    finishLoadedInventoryPublication(res, hasMaster, changedDatasetKeys, clearOps);
    if (hasMaster || changedDatasetKeys.includes('avOpen')) restoreBloomCartSelection();
    if (hasMaster || changedDatasetKeys.includes('warehouseAssignedItems')) refreshVisibleEvalOverview();
}
