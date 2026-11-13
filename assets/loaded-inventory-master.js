function stampLoadedMasterLocationReceipt(res, preparedMasterAtEntry) {
    if (res._verifiedLiveSync !== true) return;
    const scope = String(res._locOnHandReceiptScope || '');
    const permission = String(res._locOnHandReceiptPermission || '');
    const revision = String(res._locOnHandReceiptRevision || '');
    if (!acceptCardLocationOnHandSourceReceipt(scope, permission, revision, true)) return;
    for (const rows of [res.data, res.requestsData, preparedMasterAtEntry?.avOpenRows]) {
        if (!Array.isArray(rows)) continue;
        rows.forEach(row => stampCardLocationOnHandReceipt(row, scope, permission, revision));
    }
}

function preserveLoadedMasterEvidence(row, index, prepared) {
    const preserved = preserveConfirmedDriveEvidence(row);
    if (preserved === row) return false;
    preserved.DOM_ID = 'fi_' + index;
    fullInventory[index] = buildSearchIndex(normalizeRowPhotoFields(preserved));
    const avRow = prepared.avOpenByMasterId?.get(String(preserved.UNIQUE_ID || '').trim());
    if (avRow) syncMasterFieldsToRow(preserved, avRow, EXACT_ROW_SYNC_KEYS, { attachMasterLink: false });
    return true;
}

function installLoadedMasterRows(res, prepared) {
    if (!prepared) {
        fullInventory = scopeMasterInventoryRowsForCurrentUser(res.data || []).map((row, index) => {
            const item = preserveConfirmedDriveEvidence(row);
            item.DOM_ID = 'fi_' + index;
            return buildSearchIndex(normalizeRowPhotoFields(item));
        });
        applyMasterAppTabAssignments(fullInventory);
        return false;
    }
    fullInventory = res.data;
    let unchanged = true;
    if (confirmedDriveEvidenceRows.size) {
        fullInventory.forEach((row, index) => {
            if (preserveLoadedMasterEvidence(row, index, prepared)) unchanged = false;
        });
    }
    return unchanged;
}

function rebindLoadedMasterDisplayReceipt(res, priorDisplayRows) {
    const masterReadMeta = res.data && res.data.readMeta;
    const priorReceipt = productionDisplayMasterReceipt;
    const currentScope = getSupabaseReadIdentityScope();
    const currentPermission = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
    const masterState = getDatasetState('master');
    const liveContext = getProductionLiveSyncContext();
    const verifiedMasterState = masterState?.initialLoaded === true && masterState.rowCompleteness === 'complete'
        && masterState.liveVerifiedScope === liveContext?.scope
        && masterState.liveVerifiedPermission === currentPermission;
    if (masterReadMeta?.rowCompleteness !== 'complete' || Number(masterReadMeta.total) !== res.data.length) return;
    const priorMatches = priorReceipt?.rows === priorDisplayRows
        && priorReceipt.readScope === currentScope && priorReceipt.permission === currentPermission;
    if (priorMatches || verifiedMasterState || res._verifiedLiveSync === true) {
        productionDisplayMasterReceipt = { ...(priorReceipt || {}), rows: fullInventory,
            readScope: currentScope, permission: currentPermission };
    }
}

function publishLoadedMasterInventory(res, preparedMasterAtEntry) {
    const priorDisplayRows = fullInventory;
    clearAcceptedLocOnHandAggregates();
    stampLoadedMasterLocationReceipt(res, preparedMasterAtEntry);
    const prepared = getCurrentPreparedMasterRows(res.data);
    let unchanged = installLoadedMasterRows(res, prepared);
    const mergedMaster = mergeLiveInventoryCardRows(fullInventory);
    if (mergedMaster.length !== fullInventory.length) {
        fullInventory = mergedMaster;
        unchanged = false;
    }
    const clearOps = (res._fromCache || res._verifiedLiveSync) ? [] : collectMasterAvRuleClearOps(fullInventory);
    const preparedIndexes = prepared ? takePreparedMasterIndexMaps(prepared, unchanged) : null;
    if (preparedIndexes) installMasterInventoryIndexMaps(preparedIndexes);
    else rebuildMasterInventoryIndexes();
    rebindLoadedMasterDisplayReceipt(res, priorDisplayRows);
    rememberWarmAvInventoryRows(fullInventory);
    const inheritanceCandidates = preparedIndexes ? prepared.inheritanceCandidates : null;
    hydrateNcrCurrentCropRowsFromSources({ remote: false, maxRemote: 12, candidates: inheritanceCandidates?.ncr });
    hydrateMovedSeasonCurrentRowsFromSources({ remote: false, maxRemote: 12, candidates: inheritanceCandidates?.moved });
    invalidateMasterDerivedInventories();
    getManagerAssignedColumnState().fullInventory = fullInventory;
    refreshSuspendOwnerViews();
    return clearOps;
}

function hydrateLoadedAvRow(item, masterById) {
    if (!item || !masterById) return item;
    const uniqueId = String(item.UNIQUE_ID || '').trim();
    const sourceTable = String(firstNonEmptyValue(item.SOURCE_TABLE, item.source_table, 'ph_master_inventory')).toLowerCase();
    const masterItem = masterById.get(uniqueId) || findLinkedMasterRow(item);
    if (!masterItem) return item;
    if (sourceTable === ACTIVE_REQUEST_TABLE) syncMasterFieldsToRequestRow(masterItem, item);
    else syncMasterFieldsToRow(masterItem, item, EXACT_ROW_SYNC_KEYS, { attachMasterLink: false });
    return item;
}

function loadedAvRowIsVisible(item) {
    const sourceTable = String(firstNonEmptyValue(item && item.SOURCE_TABLE, item && item.source_table, 'ph_master_inventory')).toLowerCase();
    if (!isEvalScopedDataRowVisibleToCurrentUser(item)) return false;
    return sourceTable !== 'ph_master_inventory' || shouldIncludeMasterItemInAvSeasonView(item);
}

function publishLoadedAvInventory(res, hasMaster, changedDatasetKeys) {
    const hasAvOpen = Object.hasOwn(res, 'avOpenData');
    const rebuild = hasMaster && !hasAvOpen;
    if (!hasAvOpen && !rebuild) return;
    const prepared = hasMaster ? getCurrentPreparedMasterRows(res.data) : null;
    const preparedAvOpen = rebuild && prepared?.avOpenRows;
    if (preparedAvOpen) {
        avOpenInventory = mergeLiveInventoryCardRows(preparedAvOpen);
        rememberWarmAvInventoryRows(avOpenInventory);
        if (!changedDatasetKeys.includes('avOpen')) changedDatasetKeys.push('avOpen');
        return;
    }
    const masterById = hasMaster ? new Map(fullInventory.map(item => [String(item.UNIQUE_ID || '').trim(), item])) : null;
    const source = hasAvOpen ? (res.avOpenData || []) : buildAvOpenInventoryFromMasterItems(fullInventory).map(item => ({ ...item }));
    const rows = source.map(item => hydrateLoadedAvRow(item, masterById)).filter(loadedAvRowIsVisible);
    avOpenInventory = mergeLiveInventoryCardRows(rows).map((item, index) => {
        item.DOM_ID = 'avo_' + (item.UNIQUE_ID || index);
        return buildSearchIndex(normalizeRowPhotoFields(item));
    });
    rememberWarmAvInventoryRows(avOpenInventory);
    if (rebuild && !changedDatasetKeys.includes('avOpen')) changedDatasetKeys.push('avOpen');
}
