function setHomeTab(tab = 'dashboard') {
    const requestedTab = String(tab || 'dashboard').trim().toLowerCase();
    if (!managerTableManagementDirectOpen && requestedTab === MANAGER_TABLE_MANAGEMENT_VIEW) return openManagerTableManagement();
    if (requestedTab === MANAGER_SALES_REPS_VIEW) return openManagerSalesRepsModule();
    if (!managerTableManagementDirectOpen && typeof getManagerTableManagementKey === 'function' && getManagerTableManagementKey(requestedTab)) return openManagerTableManagement(getManagerTableManagementKey(requestedTab));
    if (!managerTableManagementDirectOpen && requestedTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) return openManagerTableManagement('assigned-items');
    if (!managerTableManagementDirectOpen && requestedTab === MANAGER_COMPANY_DIRECTORY_VIEW) return openManagerTableManagement('company-directory');
    if (!managerTableManagementDirectOpen && requestedTab === ITEM_INQUIRY_COVERAGE_SETTINGS_VIEW) return openManagerTableManagement('inquiry-coverage');
    if (!managerTableManagementDirectOpen && requestedTab === MANAGER_CUSTOMER_REP_MAP_VIEW) return openManagerTableManagement('customer-assignments');
    if (!managerTableManagementDirectOpen && requestedTab === MANAGER_ACCESS_CONTROL_VIEW) return openManagerTableManagement('user-role-access');
    if (requestedTab === 'hours' && canAccessView('hours')) {
        activeHomeTab = 'dashboard';
        selectedProductivityUser = '';
        switchView('hours');
        return false;
    }
    const previousTab = activeHomeTab;
    const nextTab = resolveAllowedHomeTab(requestedTab);
    leavePreviousHomeTab(previousTab, nextTab);
    enterNextHomeTab(previousTab, nextTab);
    hydrateNextHomeTab(nextTab);
    if (nextTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) scheduleAssignedItemsChrome();
    else globalThis.renderHomeOrManagersNow(true);
    if (typeof syncHomeDashboardBodyMode === 'function') syncHomeDashboardBodyMode();
    return false;
}

function resolveAllowedHomeTab(requestedTab) {
    if (requestedTab === MANAGER_RUNTIME_WATCHDOG_VIEW && ['dylan_collyge', 'megan_kelly', 'jd_jones'].includes(String(currentUser || '').trim().toLowerCase())) return MANAGER_RUNTIME_WATCHDOG_VIEW;
    if (requestedTab === 'productivity' && canViewProductivityHome()) return 'productivity';
    if (requestedTab === MANAGER_APPROVAL_HOME_VIEW && getManagersToolAccess().canViewApproval) return MANAGER_APPROVAL_HOME_VIEW;
    if (requestedTab === 'moves' && canAccessView('moves')) return 'moves';
    if (requestedTab === APP_SEASON_SETTINGS_VIEW && canManageCurrentSeasonSettings()) return APP_SEASON_SETTINGS_VIEW;
    if (requestedTab === AV_BLANKS_PHOTO_BYPASS_SETTINGS_VIEW && canManageAvBlanksPhotoBypassSettings()) return AV_BLANKS_PHOTO_BYPASS_SETTINGS_VIEW;
    if (requestedTab === ITEM_INQUIRY_COVERAGE_SETTINGS_VIEW && canManageItemInquiryCoverage()) return ITEM_INQUIRY_COVERAGE_SETTINGS_VIEW;
    if (requestedTab === INVENTORY_TRANSACTION_HISTORY_VIEW && canViewInventoryTransactionHistory()) return INVENTORY_TRANSACTION_HISTORY_VIEW;
    if (requestedTab === MANAGER_TRANSACTIONS_KEYED_VIEW && canViewTransactionsKeyed()) return MANAGER_TRANSACTIONS_KEYED_VIEW;
    if (requestedTab === MANAGER_ORDERS_VIEW && canViewManagerOrders()) return MANAGER_ORDERS_VIEW;
    if (requestedTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && canViewAssignedItemsExport()) return MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW;
    if (requestedTab === MANAGER_CUSTOMER_REP_MAP_VIEW && canManageCustomerRepMappings()) return MANAGER_CUSTOMER_REP_MAP_VIEW;
    if (requestedTab === MANAGER_EVAL_REPORTS_VIEW && canViewManagerEvalReports()) return MANAGER_EVAL_REPORTS_VIEW;
    if (requestedTab === MANAGER_EVAL_REPORTS_2_VIEW && canViewManagerEvalReports2()) return MANAGER_EVAL_REPORTS_2_VIEW;
    if (requestedTab === MANAGER_HISTORICAL_REPORT_VIEW && canViewManagerHistoricalReport()) return MANAGER_HISTORICAL_REPORT_VIEW;
    if (requestedTab === MANAGER_SHORTAGE_CANCEL_VIEW && canViewManagerShortageCancel()) return MANAGER_SHORTAGE_CANCEL_VIEW;
    if (requestedTab === MANAGER_BLOCK_CLEARING_VIEW && canViewManagerBlockClearing()) return MANAGER_BLOCK_CLEARING_VIEW;
    if (requestedTab === MANAGER_ACCESS_CONTROL_VIEW && canViewAccessControl()) return MANAGER_ACCESS_CONTROL_VIEW;
    if (requestedTab === MANAGER_CODEX_OPERATIONS_VIEW && canViewCodexOperations()) return MANAGER_CODEX_OPERATIONS_VIEW;
    if (requestedTab === MANAGER_DELIVERY_RECOVERY_VIEW && canManageRequestDeliveryRecovery()) return MANAGER_DELIVERY_RECOVERY_VIEW;
    if (requestedTab === MANAGER_SEASON_PRIORITY_VIEW && canViewManagerSeasonPriority()) return MANAGER_SEASON_PRIORITY_VIEW;
    if (requestedTab === MANAGER_PRODUCTION_SCHEDULE_VIEW && getManagersToolAccess().canViewProductionSchedule) return MANAGER_PRODUCTION_SCHEDULE_VIEW;
    if (requestedTab === MANAGER_HR_COMMAND_VIEW && getManagersToolAccess().canViewHrCommand) return MANAGER_HR_COMMAND_VIEW;
    if (requestedTab === MANAGER_COMPANY_DIRECTORY_VIEW && getManagersToolAccess().canManageCompanyDirectory) return MANAGER_COMPANY_DIRECTORY_VIEW;
    if (requestedTab === MANAGER_TABLE_MANAGEMENT_VIEW && canAccessView('managers')) return MANAGER_TABLE_MANAGEMENT_VIEW;
    if (isManagerApprovalTab(requestedTab) && canUseManagerApprovalTab(requestedTab)) return requestedTab;
    return 'dashboard';
}

function leavePreviousHomeTab(previousTab, nextTab) {
    if (previousTab === MANAGER_PRODUCTION_SCHEDULE_VIEW && previousTab !== nextTab) window.GncProductionSchedule?.unmount();
    if (previousTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && previousTab !== nextTab) destroyManagerAssignedItemsView();
    if (previousTab === MANAGER_CUSTOMER_REP_MAP_VIEW && previousTab !== nextTab) destroyCustomerRepMappingView();
    if (previousTab === MANAGER_HR_COMMAND_VIEW && previousTab !== nextTab) unmountAlphaCommandCenter('hr');
    if (previousTab === MANAGER_BLOCK_CLEARING_VIEW && previousTab !== nextTab) saveManagerBlockClearingNavigation();
    if (previousTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && previousTab !== nextTab) {
        saveManagerAssignedNavigation();
    }
    if (previousTab !== nextTab) cancelManagerModuleReads();
    if (previousTab !== nextTab && typeof managerReportPageController !== 'undefined') managerReportPageController?.suspendMounts();
    if (previousTab !== nextTab && nextTab === MANAGER_EVAL_REPORTS_2_VIEW) enterEvalAggregateDashboard();
}

function enterNextHomeTab(previousTab, nextTab) {
    activeHomeTab = nextTab;
    if (nextTab === MANAGER_EVAL_REPORTS_2_VIEW && getCurrentVisibleViewId() !== 'managers') {
        markViewDirty('managers');
        switchView('managers', { managerSubView: true, force: true });
    }
    if (nextTab !== MANAGER_SEASON_PRIORITY_VIEW) cancelManagerSeasonPriorityRead();
    if (nextTab !== SHEAR_APPROVAL_VIEW) activeShearApprovalDetailId = '';
    if (getCurrentVisibleViewId() === 'managers' && previousTab !== nextTab) managersSearchTerm = '';
    if (nextTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && previousTab !== nextTab) {
        const assignedState = getManagerAssignedColumnState();
        managerEvalAssignmentSelection.clear();
        managersSearchTerm = assignedState.search || '';
        assignedState.restoreScroll = true;
        openAssignedItemsFirstFrame(assignedState);
    }
    if (nextTab === MANAGER_BLOCK_CLEARING_VIEW && previousTab !== nextTab) {
        const saved = managerBlockClearingDraftState.views.get(getManagerBlockClearingViewKey());
        if (saved) managersSearchTerm = saved.search;
        managerBlockClearingDraftState.restore = { key: getManagerBlockClearingViewKey(), scroll: saved ? saved.scroll : 0 };
    }
    if (nextTab === 'moves' && previousTab !== 'moves') {
        activeMovesTab = 'main';
        movesViewLevel = 0;
        selectedMovesBlock = null;
        selectedMovesLocation = null;
        managerMovePlannerLevel = 0;
        managerMoveSelectedBlock = null;
        managerMoveSelectedLocation = null;
        managerMoveDestinationStage = 'select';
        markViewDirty('moves');
        ensureDatasetLoaded('master', 'full').then(() => scheduleManagersRender(true)).catch(() => {});
        ensureAssignableAppUsers().then(() => scheduleManagersRender(true)).catch(() => {});
    }
    if (nextTab !== 'productivity') selectedProductivityUser = '';
    if (nextTab === 'productivity') {
        ensureProductivityHistorySchemaReady().catch(() => {});
        loadProductivityUserDirectory(false).catch(() => {});
        if (selectedProductivityUser) loadProductivityHistoryForUser(selectedProductivityUser).catch(() => {});
    }
}

function hydrateNextHomeTab(nextTab) {
    if (isManagerApprovalTab(nextTab)) {
        ensureDatasetLoaded('master', 'full').then(() => scheduleManagersRender(true)).catch(() => {});
        if (isNcrApprovalTaskView(nextTab)) scheduleNcrApprovalTaskRowsRefresh(nextTab, { force: true });
        if (isNotOnInventoryApprovalTaskView(nextTab)) scheduleNotOnInventoryApprovalTaskRowsRefresh(nextTab, { force: true });
    }
    if (nextTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) hydrateAssignedItemsHomeTab();
    if (nextTab === MANAGER_EVAL_REPORTS_VIEW) {
        ensureDatasetLoaded('master', 'full').then(() => scheduleManagersRender(true)).catch(() => {});
        loadManagerEvalReportSettings(false).catch(() => {});
    }
    if (nextTab === MANAGER_EVAL_REPORTS_2_VIEW) {
        loadManagerEvalReports2(false).catch(() => {});
    }
    if (nextTab === MANAGER_HISTORICAL_REPORT_VIEW && managerHistoricalReportState.level === 'names') {
        loadManagerHistoricalCommonNames(managersSearchTerm, true).catch(() => {});
    }
    if (nextTab === MANAGER_TRANSACTIONS_KEYED_VIEW) {
        loadTransactionsKeyedDashboard(false).catch(() => {});
    }
    if (nextTab === MANAGER_ORDERS_VIEW) {
        loadManagerOrderSources(true).catch(() => {});
    }
    if (nextTab === MANAGER_SHORTAGE_CANCEL_VIEW) {
        ensureDatasetLoaded('soc', 'full').then(() => scheduleManagersRender(true)).catch(() => {});
    }
    if (nextTab === MANAGER_BLOCK_CLEARING_VIEW) {
        ensureDatasetLoaded('master', 'full').then(() => scheduleManagersRender(true)).catch(() => {});
        ensureAssignableAppUsers(false).then(() => scheduleManagersRender(true)).catch(() => {});
        ensureAdminRecipientUsers(false).then(() => scheduleManagersRender(true)).catch(() => {});
    }
    if (nextTab === MANAGER_ACCESS_CONTROL_VIEW) {
        loadAccessControlMatrix(false).catch(() => {});
    }
    if (nextTab === MANAGER_CODEX_OPERATIONS_VIEW) {
        loadCodexOpsTasks(false).catch(() => {});
        scheduleCodexOpsPoll();
    } else {
        stopCodexOpsPoll();
    }
    if (nextTab === MANAGER_DELIVERY_RECOVERY_VIEW) loadRequestDeliveryRecoveryQueue(false).catch(() => {});
    if (nextTab === MANAGER_SEASON_PRIORITY_VIEW) loadManagerSeasonPriority(true);
}

function hydrateAssignedItemsHomeTab() {
    const loadAssignmentSources = () => {
        if (activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW || !canViewAssignedItemsExport()) return;
        const ready = () => { refreshAssignedItemLookups(); scheduleHydratedViewRender('managers'); };
        refreshAssignedItemLookups();
        void loadManagerItemcodeDefaultOwners();
        ensureDatasetLoaded('master', 'full', { preserveRequestedMode: true })
            .then(ready).catch(() => {});
        ensureDatasetLoaded('warehouseAssignedItems', 'full', {
            force: !warehouseAssignedItemsInventory.length,
            bypassLiveSyncCoordinator: !warehouseAssignedItemsInventory.length,
            retryOnCancellation: !warehouseAssignedItemsInventory.length,
            preserveRequestedMode: true
        }).then(ready).catch(() => {});
    };
    if (getManagerAssignedColumnState().opening) requestAnimationFrame(() => setTimeout(loadAssignmentSources, 0));
    else loadAssignmentSources();
}


function resolveManagerAssignedOwnerEvidence(row, state, useMaster) {
    const code = buildManagerEvalAssignmentKey(row.ITEMCODE || row.itemcode);
    const ledger = state.defaultOwnersByCode?.get(code);
    const exact = useMaster ? getWarehouseAssignedRowForItem(row) : row;
    const exactDefault = exact?.default_assignedto ?? exact?.DEFAULT_ASSIGNEDTO;
    const mirrorDefault = row.default_owner ?? row.DEFAULT_OWNER ?? row.default_assignedto ?? row.DEFAULT_ASSIGNEDTO;
    const mirrorWorker = row.effective_worker ?? row.EFFECTIVE_WORKER ?? row.assignedto ?? row.ASSIGNEDTO;
    const revision = Number(exact?.default_revision ?? exact?.DEFAULT_REVISION ?? row.default_revision ?? row.DEFAULT_REVISION ?? 0);
    const ledgerCurrent = ledger && Number(ledger.revision || 0) >= revision;
    const owner = ledgerCurrent ? ledger.assignedto ?? '' : exactDefault ?? mirrorDefault ?? '';
    const exactWorker = exact?.assignedto ?? exact?.ASSIGNEDTO;
    const pending = state.defaultPending?.has(code) === true;
    const zone = exact ? isManagerEvalZoneAssignment(exact) || (pending && exact.ASSIGNMENT_REASON === 'zone_zoe')
        : mirrorWorker === 'zoe_green' && mirrorWorker !== mirrorDefault;
    const worker = zone ? (pending ? 'zoe_green' : exactWorker ?? mirrorWorker)
        : ledgerCurrent && exact ? owner : exactWorker ?? mirrorWorker;
    const known = useMaster || !!exact || mirrorWorker != null;
    const exactReason = exact?.assignment_reason ?? exact?.ASSIGNMENT_REASON;
    const reason = zone ? exactReason || 'zone_zoe' : exactReason ?? row.assignment_reason ?? (owner ? 'itemcode_default' : 'unassigned');
    return { owner, worker: worker ?? owner, revision: ledgerCurrent ? Number(ledger.revision || 0) : revision, zone, known, reason };
}

function projectManagerAssignedOwnerRow(row, index, state, useMaster) {
    const evidence = resolveManagerAssignedOwnerEvidence(row, state, useMaster);
    if (!evidence.known) return null;
    const draft = state.defaultDrafts?.[buildManagerEvalAssignmentKey(row.ITEMCODE || row.itemcode)];
    const hasDraft = draft && !draft.error;
    const owner = hasDraft ? draft.assignedto : evidence.owner;
    const worker = hasDraft && !evidence.zone ? owner : evidence.worker;
    const uid = String(row.MASTER_UNIQUE_ID || row.master_unique_id || (useMaster ? row.UNIQUE_ID || row.unique_id : '') || '');
    return normalizeWarehouseAssignedItemRow({ ...row, MASTER_UNIQUE_ID: uid, master_unique_id: uid,
        ASSIGNEDTO: worker, assignedto: worker, effective_worker: worker, DEFAULT_ASSIGNEDTO: owner, default_assignedto: owner,
        DEFAULT_REVISION: evidence.revision, default_revision: evidence.revision, assignment_reason: evidence.reason,
        zone_override_active: evidence.zone }, index);
}

function appendManagerAssignedCandidateGroup(groups, lists, total) {
    if (lists.some(list => list.length === total)) return;
    groups.push(lists.length === 1 ? lists[0] : [...new Set(lists.flat())].sort((a, b) => a - b));
}

function getManagerAssignedTermPositions(index, term) {
    const vocab = index.vocabulary;
    let low = 0;
    let high = vocab.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (vocab[mid] < term) low = mid + 1;
        else high = mid;
    }
    const positions = [];
    for (let i = low; i < vocab.length && vocab[i].startsWith(term); i++) positions.push(index.words.get(vocab[i]));
    return positions;
}

function addManagerAssignedColumnCandidates(index, fields, addGroup) {
    for (const [field, allowed] of fields) {
        const lookup = index.columns.get(field);
        if (lookup) addGroup(allowed.map(value => lookup.get(value) || []));
    }
}

function getManagerAssignedFilterCandidates(index, fields, activeKey, terms, sourceRows) {
    const groups = [];
    const addGroup = lists => appendManagerAssignedCandidateGroup(groups, lists, sourceRows.length);
    if (index) {
        addManagerAssignedColumnCandidates(index, fields, addGroup);
        if (!['all','assigned','unassigned'].includes(activeKey)) addGroup([index.columns.get('ASSIGNEDTO').get(activeKey) || []]);
        for (const term of terms) addGroup(getManagerAssignedTermPositions(index, term));
    }
    groups.sort((a,b) => a.length - b.length);
    const candidates = groups.shift();
    const required = groups.map(group => new Set(group));
    return { candidates, required };
}

function groupManagerAssignedLocations(groups, code, row) {
    const key = JSON.stringify([code, row.ASSIGNEDTO, row.zone_override_active === true]);
    const prior = groups.get(key);
    if (!prior || prior.LOCATIONCODE === row.LOCATIONCODE) {
        groups.set(key, row);
        return;
    }
    const locations = new Set([...getAssignedLocationTokens(prior), ...getAssignedLocationTokens(row)].filter(Boolean));
    groups.set(key, { ...row, LOCATIONCODE: [...locations].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ') });
}

function applyManagerAssignedOwnerMirrors(defaults, assignments, state) {
    const owners = new Map(defaults.map(row => [buildManagerEvalAssignmentKey(row.itemcode || row.itemcode_normalized), row]));
    const update = row => {
        const exact = assignments.get(String(row.master_unique_id || row.MASTER_UNIQUE_ID || row.UNIQUE_ID || row.unique_id || ''));
        const saved = owners.get(buildManagerEvalAssignmentKey(row.ITEMCODE || row.itemcode || row.itemcode_normalized));
        const revision = Number(saved?.default_revision ?? saved?.revision ?? 0);
        if (!saved || revision < Number(row.default_revision || row.DEFAULT_REVISION || 0)) return;
        const owner = saved.assignedto ?? '';
        const worker = exact ? exact.assignedto ?? '' : row.zone_override_active ? row.assignedto ?? '' : owner;
        Object.assign(row, { default_owner: owner, DEFAULT_OWNER: owner, default_assignedto: owner, DEFAULT_ASSIGNEDTO: owner,
            assignedto: worker, ASSIGNEDTO: worker, effective_worker: worker, default_revision: revision,
            DEFAULT_REVISION: revision, zone_override_active: exact?.zone_override_active ?? row.zone_override_active });
    };
    const sourceRows = [warehouseAssignedItemsInventory, state.rows, state.data, state.fullInventory, state.inventoryRowAssignments];
    if (typeof fullInventory !== 'undefined') sourceRows.push(fullInventory);
    sourceRows.filter(Array.isArray).forEach(rows => rows.forEach(update));
}

function scheduleAssignedItemsChrome() {
    const state = getManagerAssignedColumnState();
    requestAnimationFrame(() => setTimeout(() => {
        if (state === getManagerAssignedColumnState() && activeHomeTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) {
            globalThis.renderHomeOrManagersNow(true);
        }
    }, 0));
}
