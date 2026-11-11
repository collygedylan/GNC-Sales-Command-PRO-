function compareAssignedItemCodes(a, b) {
    const left = buildManagerEvalAssignmentKey(a.ITEMCODE || a.itemcode);
    const right = buildManagerEvalAssignmentKey(b.ITEMCODE || b.itemcode);
    return left < right ? -1 : left > right ? 1 : 0;
}

function getManagerAssignedItemsDisplayRows(rows = null, batch = null) {
    const state = getManagerAssignedColumnState();
    const useMaster = batch ? batch.useMaster : !Array.isArray(rows) && typeof fullInventory !== 'undefined' && Array.isArray(fullInventory) && fullInventory.length > 0;
    const input = Array.isArray(rows) ? rows : useMaster ? fullInventory : warehouseAssignedItemsInventory;
    const targetRevision = typeof getManagerItemLowStockTargetsState === 'function' ? getManagerItemLowStockTargetsState().revision : 0;
    const signature = getManagerAssignedDisplaySignature(state, useMaster, targetRevision);
    if (!batch && state.displayCache?.input === input && state.displayCache.signature === signature && state.displayCache.length === input.length) return state.displayCache.rows;
    const sourceRows = (batch ? input : enrichManagerAssignedPlantGroups(input))
        .map((row, index) => projectManagerAssignedOwnerRow(row, index, state, useMaster)).filter(Boolean);
    for (const row of sourceRows) {
        if (row.LOCATIONCODE || !row.ITEMCODE || typeof masterInventoryByItemCode === 'undefined') continue;
        const active = (masterInventoryByItemCode.get(row.ITEMCODE.toUpperCase()) || []).filter(item =>
            item.present_in_drive !== false && item.is_active !== false && item.active !== false && item.ACTIVE !== false);
        row.LOCATIONCODE = [...new Set(active.flatMap(getAssignedLocationTokens).filter(Boolean))].sort((a,b) => a.localeCompare(b,undefined,{numeric:true})).join(', ');
    }
    state.rowCollator ||= new Intl.Collator(undefined, { numeric: true });
    const compare = state.rowCollator.compare;
    const output = sourceRows.sort((a, b) => {
        const itemCompare = compareAssignedItemCodes(a, b);
        if (itemCompare !== 0) return itemCompare;
        const genusCompare = compare(String(a.GENUSNAME || ''), String(b.GENUSNAME || ''));
        if (genusCompare !== 0) return genusCompare;
        const locationCompare = compare(String(a.LOCATIONCODE || ''), String(b.LOCATIONCODE || ''));
        if (locationCompare !== 0) return locationCompare;
        const warehouseCompare = compare(String(a.WAREHOUSEI || ''), String(b.WAREHOUSEI || ''));
        if (warehouseCompare !== 0) return warehouseCompare;
        return compare(String(a.ASSIGNEDTO || ''), String(b.ASSIGNEDTO || ''));
    }).map(row => {
        const target = getManagerItemLowStockTarget(row.ITEMCODE);
        const isHistoryReady = !!target && target.history_ready === true;
        const effectiveTarget = target && target.manual_override_qty != null ? Number(target.manual_override_qty)
            : 150;
        return Object.assign({}, row, {
            AVG_ORDER_QTY: target && target.mean_quantity != null ? Number(target.mean_quantity) : (row.AVG_ORDER_QTY ?? ''),
            LOW_STOCK_TARGET: target ? effectiveTarget : 150,
            LOW_STOCK_SUGGESTED: target && target.suggested_qty != null ? Number(target.suggested_qty) : (row.LOW_STOCK_SUGGESTED ?? ''),
            HISTORY_FROM_DATE: isHistoryReady ? target.history_from_date || '' : '',
            HISTORY_THROUGH_DATE: isHistoryReady ? target.history_through_date || '' : '',
            LOW_STOCK_CALCULATED_AT: isHistoryReady ? target.calculated_at || '' : ''
        });
    });
    if (batch) return output;
    return retainAssignedDisplayRows(state, input, signature, output);
}

function getFilteredManagerAssignedItemsExportRows(rows = null, exceptField = '') {
    const state = getManagerAssignedColumnState();
    const sourceRows = Array.isArray(rows) ? rows : state.displayCache?.rows || getManagerAssignedItemsDisplayRows();
    const index = rememberManagerAssignedColumnLabels(sourceRows);
    const activeKey = getManagerAssignedItemsActiveAssigneeKey();
    const cacheKey = JSON.stringify([activeKey, managersSearchTerm, state.filters, state.sort, state.viewMode, exceptField]);
    if (!exceptField && state.selectionFilterKey !== cacheKey) {
        state.selectionFilterKey = cacheKey;
        state.fallbackLimit = 150;
        managerEvalAssignmentSelection.clear();
    }
    if (state.filteredSource !== sourceRows) { state.filteredSource = sourceRows; state.filteredCache = new Map(); }
    if (state.filteredCache.has(cacheKey)) return state.filteredCache.get(cacheKey);
    const uniqueMode = state.viewMode === 'unique' && !exceptField;
    const fields = Object.entries(state.filters).filter(([field, allowed]) => field !== exceptField && Array.isArray(allowed));
    const terms = managersSearchTerm ? tokenizeSearchValue(managersSearchTerm) : [];
    const { candidates, required } = getManagerAssignedFilterCandidates(index, fields, activeKey, terms, sourceRows);
    const filtered = [], byCode = new Map();
    const length = candidates?.length ?? sourceRows.length;
    for (let i = 0; i < length; i++) {
        const position = candidates ? candidates[i] : i;
        if (required.length && !required.every(group => group.has(position))) continue;
        const entry = index?.[position], row = entry?.row || sourceRows[position];
        if (entry) {
            if (activeKey === 'unassigned' && !entry.unassigned || activeKey === 'assigned' && !entry.ASSIGNEDTO) continue;
        } else {
            if (!matchesManagerAssignedColumnFilters(row, state.filters, exceptField)) continue;
            if (activeKey === 'unassigned' && !getManagerUnassignedItemcodes([row]).length) continue;
            if (activeKey === 'assigned' && !normalizeEvalAssignableUser(row.ASSIGNEDTO)) continue;
            if (!['all','unassigned','assigned'].includes(activeKey) && normalizeEvalAssignableUser(row.ASSIGNEDTO) !== activeKey) continue;
            if (terms.length && !managerTextMatchesSearch([row.ASSIGNEDTO,row.WAREHOUSEI,row.ITEMCODE,row.CONTSIZE,row.COMMONNAME,
                row.LOCATIONCODE,row.LOTCODE,row.MASTER_UNIQUE_ID,row.DEFAULT_ASSIGNEDTO,row.ASSIGNMENT_REASON,row.SOURCE,row.GENUSNAME,row.PLANTGROUPCODE])) continue;
        }
        if (uniqueMode) groupManagerAssignedLocations(byCode, entry?.code ?? buildManagerEvalAssignmentKey(row.ITEMCODE), row);
        else filtered.push(row);
    }
    const unique = uniqueMode ? Array.from(byCode.values()) : filtered;
    const output = sortManagerAssignedColumnRows(unique, state.sort);
    if (state.filteredCache.size > 16) state.filteredCache.clear();
    state.filteredCache.set(cacheKey, output);
    return output;
}

function getManagerAssignedItemsExportColumns() {
    return getManagerAssignedColumnDefinitions().slice(0, 8).map(([field, label]) => ({
        label, value: row => row[field] ?? ''
    }));
}

async function exportManagerAssignedItemsToExcel() {
    if (!canViewAssignedItemsExport()) return false;
    const owner = getSupabaseReadIdentityScope();
    if (!isMasterFullProjectionReady() && !isDatasetLoaded('warehouseAssignedItems', 'full')) {
        if (!await ensureMasterFullProjection('exporting Assigned Items')) throw Error('The complete Assigned Items snapshot is still loading.');
    }
    if (owner !== getSupabaseReadIdentityScope() || !canViewAssignedItemsExport()) throw Error('The account changed. Reopen Assigned Items.');
    const complete = isMasterFullProjectionReady() ? getManagerAssignedItemsDisplayRows()
        : getManagerAssignedItemsDisplayRows(warehouseAssignedItemsInventory,{useMaster:false});
    const rows = getFilteredManagerAssignedItemsExportRows(complete);
    return downloadExcelWorkbook(getManagerAssignedItemsExportColumns(), rows, 'Assigned Items',
        managersSearchTerm || '', 'Assigned_Items', null, { exactColumns: true, filenameBase: 'Assigned_Items' });
}

function retainAssignedDisplayRows(state, input, signature, output) {
    const previous = state.displayCache?.byId || new Map();
    const byId = new Map();
    const stable = output.map(row => {
        const id = String(row.MASTER_UNIQUE_ID || row.UNIQUE_ID);
        const prior = previous.get(id);
        const value = prior && Object.keys(row).every(key => row[key] === prior[key]) && Object.keys(prior).length === Object.keys(row).length ? prior : row;
        byId.set(id, value); return value;
    });
    const priorRows = state.displayCache?.rows;
    const result = priorRows?.length === stable.length && stable.every((row, index) => row === priorRows[index]) ? priorRows : stable;
    state.displayCache = { input, signature, length: input.length, rows: result, byId };
    return result;
}
