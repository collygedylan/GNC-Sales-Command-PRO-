export function applyRealtimeChange(tableName = '', payload = null, deferVisualSync = false) {
    if (!payload || !payload.eventType) return false;
    if (getUniversalLiveSyncTables().includes(tableName) && bufferRowPatchUntilHydrated(tableName, { kind: 'realtime', payload })) return false;
    const realtimeApplyStartedAt = beginInternalPerfMeasure();
    const eventType = String(payload.eventType || '').toUpperCase();
    const special = applyRealtimeDockStatusRows(tableName, payload, eventType, realtimeApplyStartedAt)
        ?? applyRealtimeFieldWorkflowRows(tableName, payload, eventType, realtimeApplyStartedAt)
        ?? applyRealtimeCountAndMessageRows(tableName, payload, eventType, realtimeApplyStartedAt)
        ?? applyRealtimeCalendarRows(tableName, payload, realtimeApplyStartedAt);
    if (special !== undefined) return special;
    const oldRow = payload.old || {};
    const nextRow = payload.new ? formatFetchedRows([payload.new], tableName)[0] : null;
    const uniqueId = String((nextRow && (nextRow.UNIQUE_ID || nextRow.ROW_ID)) || oldRow.unique_id || oldRow.UNIQUE_ID || oldRow.row_id || oldRow.ROW_ID || '');
    if (!uniqueId) return false;
    const isLocalEcho = eventType !== 'DELETE' && nextRow ? consumeMatchingLocalRealtimeEcho(tableName, nextRow) : false;
    const changed = applyRealtimeMasterAndRequestRows(tableName, eventType, nextRow, uniqueId)
        ?? applyRealtimeSalesAndOrderRows(tableName, payload, eventType, nextRow, uniqueId)
        ?? applyRealtimeFlyerAndScoutRows(tableName, payload, eventType, nextRow, uniqueId)
        ?? applyRealtimeSettingsAndLookupRows(tableName, eventType, nextRow, uniqueId)
        ?? applyRealtimeCoverageRows(tableName, payload, eventType, nextRow, uniqueId) ?? false;
    if (changed) refreshRealtimeDetailLookupIndexes(tableName);
    if (isLocalEcho) {
        if (tableName === ACTIVE_REQUEST_TABLE) requestViewLiveSyncSignature = buildRequestLiveSyncSignature(requestsInventory);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, `${tableName}:echo`);
        return false;
    }
    if (!changed) {
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, `${tableName}:noop`);
        return false;
    }
    trackRealtimeDirtyRowId(tableName, uniqueId);
    refreshRealtimeMasterViews(tableName, eventType, nextRow, oldRow, uniqueId)
        || refreshRealtimeRequestAndOrderViews(tableName)
        || refreshRealtimeFlyerViews(tableName, eventType, nextRow)
        || refreshRealtimeScoutAndAssignmentViews(tableName);
    if (!deferVisualSync) flushRealtimeDatasetUpdates([tableName]);
    recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'unknown');
    return true;
}

function applyRealtimeDockStatusRows(tableName, payload, eventType, realtimeApplyStartedAt) {
    if (tableName === APP_LIVE_EVENTS_TABLE) {
        handleAppLiveEventRealtimeChange(payload);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'live-events');
        return false;
    }
    if (tableName === 'ph_dock_trip_status') {
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const tripKey = normalizeDockTeamTripKey(rawRow.tripnumber || rawRow.TRIPNUMBER);
        if (!tripKey) return false;
        if (eventType === 'DELETE') {
            dockTeamStatusByTrip.delete(tripKey);
        } else {
            cacheDockTeamInfo(tripKey, rawRow);
        }
        dockTeamStatusLoaded = true;
        markViewDirty('docks');
        scheduleDocksRender(72);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'dock-trip');
        return true;
    }
    if (tableName === 'ph_dock_item_status') {
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const uniqueId = normalizeDockItemUniqueId(rawRow.unique_id || rawRow.UNIQUE_ID);
        if (!uniqueId) return false;
        if (eventType === 'DELETE') {
            dockItemProgressByUid.delete(uniqueId);
            try { localStorage.removeItem('gnc_dock_item_' + uniqueId); } catch { globalThis.safeIgnoreProbeError?.("applyRealtimeChange"); }
        } else {
            cacheDockItemProgress(uniqueId, rawRow);
        }
        dockItemProgressLoaded = true;
        markViewDirty('docks');
        scheduleDocksRender(72);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'dock-item');
        return true;
    }
}

function applyRealtimeFieldWorkflowRows(tableName, payload, eventType, realtimeApplyStartedAt) {
    if (tableName === 'ph_dock_issue_status') {
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const uniqueId = normalizeDockIssueSourceUniqueId(firstNonEmptyValue(rawRow.issue_source_unique_id, rawRow.ISSUE_SOURCE_UNIQUE_ID, rawRow.unique_id, rawRow.UNIQUE_ID, ''));
        if (!uniqueId) return false;
        if (eventType === 'DELETE') {
            dockIssueStatusByUid.delete(uniqueId);
        } else {
            cacheDockIssueStatus(uniqueId, rawRow);
        }
        dockIssueDataLoaded = true;
        markViewDirty('docks');
        scheduleDocksRender(72);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'dock-issue');
        return true;
    }
    if (tableName === 'ph_dock_issue_allocations') {
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const allocationUniqueId = String(firstNonEmptyValue(rawRow.allocation_unique_id, rawRow.ALLOCATION_UNIQUE_ID, '')).trim();
        if (!allocationUniqueId) return false;
        if (eventType === 'DELETE') {
            removeDockIssueAllocationFromCache(allocationUniqueId);
        } else {
            cacheDockIssueAllocation(rawRow);
        }
        dockIssueDataLoaded = true;
        markViewDirty('docks');
        scheduleDocksRender(72);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'dock-allocation');
        return true;
    }
    if (tableName === TAKE_BACK_TABLE) {
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const uniqueId = String(firstNonEmptyValue(rawRow.unique_id, rawRow.UNIQUE_ID, '')).trim();
        if (!uniqueId) return false;
        if (eventType === 'DELETE') removeTakeBackRowFromCache(uniqueId);
        else cacheTakeBackRow(rawRow);
        takeBackDataLoaded = true;
        markViewDirty('take-back');
        scheduleTakeBackRender(48);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'take-back');
        return true;
    }
}

function applyRealtimeCountAndMessageRows(tableName, payload, eventType, realtimeApplyStartedAt) {
    if (tableName === SHEAR_LIST_TABLE) {
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const uniqueId = String(firstNonEmptyValue(rawRow.unique_id, rawRow.UNIQUE_ID, '')).trim();
        if (!uniqueId) return false;
        if (eventType === 'DELETE') removeShearListRowFromCache(uniqueId);
        else cacheShearListRow(rawRow);
        shearListState.loaded = true;
        markViewDirty('shear-list');
        markViewDirty('request');
        if (isViewVisible('shear-list')) renderShearList();
        if (isViewVisible('request') && activeReqTab === 'shear-list') scheduleRequestRender(0, REQUEST_REALTIME_UI_DELAY_MS, true);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'shear-list');
        return true;
    }
    if (tableName === PRODUCTION_WORKFLOW_ROWS_TABLE) {
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const uniqueId = String(firstNonEmptyValue(rawRow.unique_id, rawRow.UNIQUE_ID, '')).trim();
        if (!uniqueId) return false;
        if (eventType === 'DELETE') removeProductionWorkflowRowFromCache(uniqueId);
        else cacheProductionWorkflowRow(rawRow);
        productionWorkflowState.loaded = true;
        markViewDirty('production');
        markViewDirty('production-workflow');
        if (isViewVisible('production-workflow')) renderProductionWorkflowPanel();
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'production-workflow');
        return true;
    }
    if (tableName === SPREAD_COUNT_TABLE || tableName === BUNCH_COUNT_TABLE) {
        const activeCountTable = typeof getActiveSpreadCountTableName === 'function' ? getActiveSpreadCountTableName() : SPREAD_COUNT_TABLE;
        if (tableName !== activeCountTable) {
            markViewDirty('sales-inventory');
            recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'count-table');
            return true;
        }
        const rawRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const uniqueId = String(firstNonEmptyValue(rawRow.unique_id, rawRow.UNIQUE_ID, '')).trim();
        if (!uniqueId) return false;
        const changed = eventType === 'DELETE'
            ? removeSpreadCountRecordFromCache(uniqueId)
            : cacheSpreadCountRecord(rawRow);
        if (!changed) return false;
        spreadCountState.loaded = true;
        markViewDirty('sales-inventory');
        if (isViewVisible('sales-inventory')) renderProductionInventoryCountingContent();
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'count-table');
        return true;
    }
}

function applyRealtimeCalendarRows(tableName, payload, realtimeApplyStartedAt) {
    if (tableName === CHAT_CONVERSATIONS_TABLE || tableName === CHAT_PARTICIPANTS_TABLE || tableName === CHAT_MESSAGES_TABLE) {
        handleChatRealtimeChange(tableName, payload);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'chat');
        return true;
    }
    if (tableName === DEPARTMENT_CALENDAR_EVENTS_TABLE) {
        handleDepartmentCalendarRealtimeChange(payload);
        recordInternalPerfDuration('realtimeApplyDurations', realtimeApplyStartedAt, tableName || 'department-calendar');
        return true;
    }
}

function applyRealtimeMasterAndRequestRows(tableName, eventType, nextRow, uniqueId) {
    let changed = false;
    if (tableName === 'ph_master_inventory') return applyRealtimeMasterRow(eventType,nextRow,uniqueId);
    if (tableName === ACTIVE_REQUEST_TABLE) {
        if (eventType === 'DELETE') {
            clearOptimisticRequestIds([uniqueId]);
            discardPendingLocalEdits([uniqueId], true);
            changed = removeRealtimeRow(requestsInventory, uniqueId);
        } else {
            clearOptimisticRequestIds([uniqueId]);
            if (!isEvalScopedDataRowVisibleToCurrentUser(nextRow)) changed = removeRealtimeRow(requestsInventory, uniqueId);
            else changed = upsertRealtimeRow(requestsInventory, nextRow, tableName);
            if (nextRow && hasRequestCompletionState(nextRow)) discardPendingLocalEdits([uniqueId], true);
        }
        return changed;
    }
}

function applyRealtimeMasterRow(eventType, row, uid) {
    if (eventType !== 'DELETE' && !row) return false;
    if (eventType === 'DELETE' || !isMasterInventoryRowVisibleToCurrentUser(row)) {
        const masterRemoved = removeRealtimeRow(fullInventory,uid);
        const avRemoved = removeRealtimeRow(avOpenInventory,uid);
        return avRemoved || masterRemoved;
    }
    const table = 'ph_master_inventory';
    const masterChanged = upsertRealtimeRow(fullInventory,row,table);
    const avChanged = shouldIncludeMasterItemInAvSeasonView(row)
        ? upsertRealtimeRow(avOpenInventory,row,table) : removeRealtimeRow(avOpenInventory,uid);
    return avChanged || masterChanged;
}

function applyRealtimeSalesAndOrderRows(tableName, payload, eventType, nextRow, uniqueId) {
    let changed = false;
    if (tableName === REQUEST_HISTORY_TABLE) return applyRealtimeRequestHistoryRow(eventType,payload.new || nextRow,uniqueId);
    if (tableName === SALES_CREDIT_REQUESTS_TABLE) {
        if (eventType === 'DELETE') {
            changed = removeRealtimeRow(salesCreditRequestsInventory, uniqueId);
        } else {
            const creditRow = normalizeSalesCreditRequestRow(payload.new || nextRow);
            if (creditRow) changed = upsertRealtimeRow(salesCreditRequestsInventory, creditRow, tableName);
        }
        return changed;
    }
    if (tableName === 'ph_inventory_edit_requests') {
        changed = true;
        queueDatasetLoad('inventoryEditRequests', 'full', 0);
        return changed;
    }
    if (tableName === 'ph_av_option_eval_requests') {
        avOptionEvalRequestsLoaded = false;
        avOptionEvalRequestsError = '';
        changed = true;
        return changed;
    }
}

function applyRealtimeRequestHistoryRow(eventType, input, uid) {
    if (eventType === 'DELETE') return removeRealtimeRow(requestHistoryInventory,uid);
    const row = normalizeRequestHistoryRow(input);
    if (!row) return false;
    const changed = !!cacheRequestHistoryRow(row);
    requestsInventory = mergeRequestRowsWithHistory((requestsInventory || []).filter(item => item && !item.REQUEST_HISTORY),requestHistoryInventory)
        .filter(item => isEvalScopedDataRowVisibleToCurrentUser(item));
    return changed;
}

function applyRealtimeFlyerAndScoutRows(tableName, payload, eventType, nextRow, uniqueId) {
    let changed = false;
    if (tableName === 'ph_reserves') {
        changed = eventType === 'DELETE'
            ? removeRealtimeRow(reservesInventory, uniqueId)
            : upsertRealtimeRow(reservesInventory, nextRow, tableName);
        return changed;
    }
    if (tableName === 'ph_soc_master') {
        changed = eventType === 'DELETE'
            ? removeRealtimeRow(socInventory, uniqueId)
            : (isEvalScopedDataRowVisibleToCurrentUser(nextRow) ? upsertRealtimeRow(socInventory, nextRow, tableName) : removeRealtimeRow(socInventory, uniqueId));
        return changed;
    }
    if (tableName === 'ph_sales_office') {
        if (eventType === 'DELETE' || (nextRow && isSalesOfficeComplete(nextRow)) || !isEvalScopedDataRowVisibleToCurrentUser(nextRow)) {
            changed = removeRealtimeRow(salesOfficeInventory, uniqueId);
        } else if (nextRow) {
            changed = upsertRealtimeRow(salesOfficeInventory, nextRow, tableName);
        }
        return changed;
    }
    if (tableName === FLYER_FOLDER_ROWS_TABLE) {
        if (eventType === 'DELETE') {
            changed = removeFlyerFolderRowFromCache(uniqueId);
        } else if (nextRow) {
            changed = !!cacheFlyerFolderRow(nextRow);
        }
        return changed;
    }
    if (tableName === FLYER_FOLDER_HISTORY_TABLE) {
        if (eventType === 'DELETE') {
            changed = removeRealtimeRow(flyerFolderHistoryInventory, uniqueId);
        } else {
            const historyRow = normalizeFlyerFolderHistoryRow(payload.new || nextRow);
            if (historyRow) changed = !!cacheFlyerFolderHistoryRow(historyRow);
        }
        return changed;
    }
}

function applyRealtimeSettingsAndLookupRows(tableName, eventType, nextRow, uniqueId) {
    let changed = false;
    if (tableName === GROWER_SCOUT_REPORTS_TABLE) {
        if (eventType === 'DELETE') {
            changed = removeRealtimeRow(growerScoutReportsInventory, uniqueId);
        } else if (nextRow) {
            changed = upsertRealtimeRow(growerScoutReportsInventory, normalizeGrowerScoutReportRow(nextRow), tableName);
        }
        rebuildGrowerScoutIndexes();
        return changed;
    }
    if (tableName === GROWER_SCOUT_ASSETS_TABLE) {
        if (eventType === 'DELETE') {
            changed = removeRealtimeRow(growerScoutAssetsInventory, uniqueId);
        } else if (nextRow) {
            changed = upsertRealtimeRow(growerScoutAssetsInventory, normalizeGrowerScoutAssetRow(nextRow), tableName);
        }
        rebuildGrowerScoutIndexes();
        return changed;
    }
    if (tableName === WAREHOUSE_ASSIGNED_ITEMS_TABLE) {
        if (eventType === 'DELETE' || nextRow?.present_in_drive === false) {
            changed = removeRealtimeRow(warehouseAssignedItemsInventory, uniqueId);
        } else if (nextRow) {
            changed = upsertRealtimeRow(warehouseAssignedItemsInventory, normalizeWarehouseAssignedItemRow(nextRow), tableName);
        }
        if (changed) {
            clearWarehouseAssignedItemCaches();
            invalidateManagerEvalReport2Cache();
            // Unassigned summaries are emitted only by completed manual sync.
        }
        return changed;
    }
    if (tableName === 'ph_cav_import') {
        changed = eventType === 'DELETE'
            ? removeRealtimeRow(cavInventory, uniqueId)
            : upsertRealtimeRow(cavInventory, nextRow, tableName);
        return changed;
    }
}

function applyRealtimeCoverageRows(tableName, payload, eventType, nextRow, uniqueId) {
    let changed = false;
    if (tableName === 'ph_av_notes') {
        changed = eventType === 'DELETE'
            ? removeRealtimeRow(avNotesDb, uniqueId)
            : upsertRealtimeRow(avNotesDb, nextRow, tableName);
        invalidateAvNotesCommonNameIndex();
        return changed;
    }
    if (tableName === 'ph_app_settings') {
        const settingRow = eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
        const settingKey = String(firstNonEmptyValue(settingRow.key, settingRow.KEY, '') || '').trim();
        if (settingKey === 'app_version' && eventType !== 'DELETE') {
            const settingValue = settingRow.value && typeof settingRow.value === 'object' ? settingRow.value : {};
            const remoteVersion = String(firstNonEmptyValue(settingValue.app_version, settingValue.version, settingRow.value, '') || '').trim();
            if (remoteVersion) void window.forceAgDataVersionUpgrade?.(remoteVersion, APP_SHELL_VERSION, { reason: 'app-settings-realtime' });
        }
        if (settingKey === AV_BLANKS_PHOTO_BYPASS_SETTINGS_KEY) {
            avBlanksPhotoBypassRemoteLoaded = false;
            avBlanksPhotoBypassAccessCache = null;
            changed = true;
        }
        return changed;
    }
    if (tableName === ITEM_INQUIRY_COVERAGE_TABLE) {
        itemInquiryCoverageState.loaded = false;
        changed = true;
        if (getCurrentVisibleViewId() === 'managers' && activeHomeTab === ITEM_INQUIRY_COVERAGE_SETTINGS_VIEW) {
            loadItemInquiryCoverage(true).catch(() => {});
        }
        return changed;
    }
}
