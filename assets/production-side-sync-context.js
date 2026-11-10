function getProductionLiveSyncSideContext() {
    const view = getCurrentVisibleViewId();
    const surfaces = [];
    const add = (key) => { if (window.AgMetricLiveSyncRegistry.surfaces[key]) surfaces.push(key); };
    const access = getRoleAccessState();
    if (view === 'home' && canViewDashboardSyncStatus()) add('home:sync-metadata');
    if (String(document.activeElement?.id || '').endsWith('av-note')
        || document.body?.classList.contains('request-av-note-sheet-open')
        || document.body?.classList.contains('eval-work-av-note-open')) add('dialog:av-notes');
    if (view === 'request') {
        add(`request:${activeReqTab}`);
        if (requestDeliveryRecoveryOpen && canManageRequestDeliveryRecovery()) add('request:delivery-recovery');
    }
    if (view === 'sales-inventory' && inventoryMainTab === 'production' && productionInventoryTab === 'counting') add('sales-inventory:counting');
    if (view === 'managers') addProductionLiveManagerSurfaces(add);
    if (view === 'weather-hold' && canUseWeatherHoldRiskTools()) add('weather-hold:risk');
    if (document.getElementById('bloomscapes-pending-dialog')?.open && canViewBloomscapesPendingOrders()) add('dialog:pending-orders');
    if (currentUser && canAccessView('request') && (getRequestCapabilities()?.canViewQueue || canSeeEvalWorkRequestTab())) add('badge:queue');
    if (currentUser && (canAccessView('chat') || canAccessView('communication'))) add('badge:communications');
    const driveDemand = getDriveDemandContext();
    addProductionLiveDialogSurfaces(view,driveDemand,add);
    return {
        view, surfaces: Array.from(new Set(surfaces)), driveDemand,
        inventoryNavigationOnly: view === 'sales-inventory' && !access.allowedViews.has('sales-inventory'),
        poSeason: normalizePoManagementSeason(poManagementState.season),
        driveDetail: view === 'detail' && activeDetailSourceView === 'drive',
        driveAssignmentsRequired: !!(access && !access.isAdmin && (access.isEval || access.isRepLike) && !isAlwaysDriveCardOptionsUser()),
        taskView: String(activeTaskView || '').trim().toLowerCase(),
        taskFilter: String(getActiveEvalSimpleTaskFilterValue() || '').trim().toLowerCase(),
        avTab: view === 'av' ? String(activeAVTab || 'open') : '',
        avSalesBucket: view === 'av' ? normalizeAvSalesBucket(activeAvSalesBucket) : '',
        avRepCustomerFilterData: view === 'av' && shouldPrepareAvRepCustomerFilterData() === true,
        scope: getCurrentLoginCacheScopeKey(),
        username: getCurrentChatUsername(),
        evalInventoryRows: shouldLoadInventoryEditRequestsForEvalRows(),
        productionType: String(productionWorkflowActive || ''),
        locationWorkJobId: String(activeLocationWorkJobId || ''),
        countType: getActiveSpreadCountType(),
        productivityUser: normalizeProductivityUsername(selectedProductivityUser),
        managerOrders: {
            level: managerOrdersState.level, sourceKey: managerOrdersState.sourceKey,
            batchId: managerOrdersState.selectedBatchId, assignees: Array.from(managerOrdersState.selectedAssigneeKeys || []),
            rowCount: managerOrdersState.rows.length, batchCount: managerOrdersState.batches.length
        },
        pendingOrderCount: bloomscapesPendingState.orders.length,
        transactions: { offset: inventoryTransactionHistoryState.offset || 0, action: inventoryTransactionHistoryState.action, search: inventoryTransactionHistoryState.search || managersSearchTerm, dateStart: inventoryTransactionHistoryState.dateStart, dateEnd: inventoryTransactionHistoryState.dateEnd },
        transactionsKeyed: { selectedDate: managerTransactionsKeyedState.selectedDate, search: managerTransactionsKeyedState.search, dateCount: managerTransactionsKeyedState.allDates.length, fileCount: managerTransactionsKeyedState.files.length },
        historical: { level: managerHistoricalReportState.level, name: managerHistoricalReportState.selectedCommonName, size: managerHistoricalReportState.selectedContSize, columns: managerHistoricalReportState.selectedColumns.slice(), dateStart: managerHistoricalReportState.dateStart, dateEnd: managerHistoricalReportState.dateEnd, search: managersSearchTerm, rowCount: managerHistoricalReportState.rows.length },
        accessQuery: { subjectType: accessControlAdminState.viewMode, search: String(managersSearchTerm || '').trim(), role: accessControlAdminState.selectedRole === 'all' ? '' : accessControlAdminState.selectedRole, module: accessControlAdminState.selectedModule === 'all' ? '' : accessControlAdminState.selectedModule, subjectOffset: Number(accessControlAdminState.subjectOffset || 0), subjectLimit: Number(accessControlAdminState.subjectPageSize || 20), permissionOffset: Number(accessControlAdminState.columnOffset || 0), permissionLimit: Number(accessControlAdminState.columnPageSize || 8) },
        codexTaskId: codexOpsState.activeTaskId
    };
}

function addProductionLiveManagerSurfaces(add) {
    const managerToolAccess = getManagersToolAccess();
    if (canLoadProductionLiveManagerTab(activeHomeTab,managerToolAccess)) add(`managers:${activeHomeTab}`);
    if (activeHomeTab === MANAGER_EVAL_REPORTS_VIEW) add('managers:eval-reports');
    if (activeHomeTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) add('managers:assigned-items-export');
    if (selectedProductivityUser) add('managers:productivity');
    if (activeHomeTab === MANAGER_DELIVERY_RECOVERY_VIEW && canManageRequestDeliveryRecovery()) add('request:delivery-recovery');
}

function canLoadProductionLiveManagerTab(tab, access) {
    if (tab === MANAGER_CUSTOMER_REP_MAP_VIEW) return canManageCustomerRepMappings();
    if (tab === MANAGER_COMPANY_DIRECTORY_VIEW) return access.canManageCompanyDirectory;
    if (tab === MANAGER_PRODUCTION_SCHEDULE_VIEW) return access.canViewProductionSchedule;
    if (tab === MANAGER_HR_COMMAND_VIEW) return access.canViewHrCommand;
    return true;
}

function addProductionLiveDialogSurfaces(view, driveDemand, add) {
    const shown = (id) => { const el = document.getElementById(id); return el && !el.classList.contains('hidden') && el.getAttribute('aria-hidden') !== 'true'; };
    if (shown('dock-info-modal') || shown('dock-mistake-modal') || shown('dock-allocation-modal')) add('dialog:dock-team');
    if (shown('request-modal') || shown('request-rep-modal') || shown('request-publish-modal') || shown('inventory-edit-request-modal')) add('dialog:request');
    if ((view === 'detail' && activeDetailTab === 'item-inquiry') || shown('argos-inventory-transaction-modal')) add('dialog:item-inquiry');
    if (driveDemand && canViewDriveCustomerConsigneeRows()) add(`detail:${driveDemand.kind}`);
    if (shown('shear-list-modal')) add('dialog:shear');
    if (shown('bloom-picker-modal')) add('dialog:bloom-picker');
    if (shown('assign-modal') || shown('flyer-assignee-modal')) add('dialog:assignees');
    if (shown('eval-task-modal')) add('dialog:eval-assignees');
    if (['ncr-email-modal', 'grouped-bloom-ncr-recipient-modal', 'bloom-crop-update-modal', 'bloom-email-purpose-modal', 'bloom-share-modal', 'ncr-rep-outreach-modal', 'inventory-multi-action-email-modal'].some(shown)) add('dialog:recipients');
}
