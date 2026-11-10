function restorePersistedAppFilterStateForCurrentUser(force = false, snapshotOverride = null) {
    const storageKey = getAppFilterStateStorageKey();
    if (!snapshotOverride && !force && appFilterStateRestoredUserKey === storageKey) return false;
    const snapshot = snapshotOverride || readAppFilterStateSnapshot();
    if (!snapshot || typeof snapshot !== 'object') {
        appFilterStateRestoredUserKey = storageKey;
        return false;
    }
    restoreDriveFilters(snapshot.drive);
    restoreTasksFilters(snapshot.tasks);
    restoreAvFilters(snapshot.av);
    restoreRequestViewState(snapshot.request);
    restoreDocksFilters(snapshot.docks);
    restoreNcrFilters(snapshot.ncr);
    restoreMovesFilters(snapshot.moves);
    restoreSalesInventoryFilters(snapshot.salesInventory);
    invalidateResolvedViewStateCaches();
    ['drive', 'tasks', 'av', 'request', 'docks', 'review', 'move-up', 'moves', 'sales-inventory'].forEach((viewId) => markViewDirty(viewId));
    appFilterStateRestoredUserKey = storageKey;
    return true;
}

function restoreSavedInventoryColumnFilters(saved) {
    const result = {};
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
    for (const [rawKey, filter] of Object.entries(saved)) {
        const key = normalizeDriveColumnFilterKey(rawKey);
        if (!key || !filter || typeof filter !== 'object') continue;
        const nextFilter = {
            mode: normalizeDriveColumnFilterMode(filter.mode || 'values'),
            values: Array.isArray(filter.values) ? filter.values.map(normalizeDriveColumnValue) : [],
            text: normalizeDriveColumnValue(filter.text)
        };
        if (isDriveColumnFilterActive(nextFilter)) result[key] = nextFilter;
    }
    return result;
}

function restoreDriveFilters(drive) {
    if (!drive || typeof drive !== 'object') return;
    activeDriveMode = appFilterText(drive.activeDriveMode, activeDriveMode || 'ok') || 'ok';
    activeDriveTab = appFilterMode(drive.activeDriveTab, ['name', 'loc', 'card', 'hold'], activeDriveTab || 'name');
    activeDriveHoldStopReport = normalizeDriveHoldStopReportMode(appFilterText(drive.activeDriveHoldStopReport, activeDriveHoldStopReport || 'hold-stop'));
    driveReportEvalUserFilter = normalizeDriveReportEvalUserFilter(appFilterText(drive.driveReportEvalUserFilter, driveReportEvalUserFilter || 'all'));
    driveOpenStockReportSeason = appFilterText(drive.driveOpenStockReportSeason, driveOpenStockReportSeason || 'S1') || 'S1';
    driveOpenStockReportSalesYear = appFilterText(drive.driveOpenStockReportSalesYear, driveOpenStockReportSalesYear || '26') || '26';
    driveOpenStockReportMaxSLts = appFilterText(drive.driveOpenStockReportMaxSLts, driveOpenStockReportMaxSLts || '0') || '0';
    selectedDriveBlock = appFilterNullableText(drive.selectedDriveBlock);
    selectedDriveLoc = appFilterNullableText(drive.selectedDriveLoc);
    driveQuickFilterName = appFilterText(drive.driveQuickFilterName, '');
    driveQuickFilterLocation = appFilterText(drive.driveQuickFilterLocation, '');
    driveQuickFilterLot = appFilterText(drive.driveQuickFilterLot, '');
    driveQuickFilterSize = appFilterText(drive.driveQuickFilterSize, '');
    driveQuickFilterPriority = appFilterText(drive.driveQuickFilterPriority, '');
    driveQuickFilterLtsMode = appFilterText(drive.driveQuickFilterLtsMode, '');
    driveQuickFilterLtsValue = appFilterText(drive.driveQuickFilterLtsValue, '');
    driveQuickHoldStopOnly = false;
    driveViewLevel = appFilterNumber(drive.driveViewLevel, 0);
    selectedDriveName = appFilterNullableText(drive.selectedDriveName);
    selectedDriveSize = appFilterNullableText(drive.selectedDriveSize);
    selectedDriveSeason = appFilterNullableText(drive.selectedDriveSeason);
    selectedDriveProgram = appFilterNullableText(drive.selectedDriveProgram);
    if (Array.isArray(drive.selectedDriveCommonNames)) selectedDriveCommonNames = appFilterArrayToSet(drive.selectedDriveCommonNames);
    driveCommonNameSearchTerm = appFilterText(drive.driveCommonNameSearchTerm, '');
    if (Array.isArray(drive.selectedDriveGenusNames)) selectedDriveGenusNames = appFilterArrayToSet(drive.selectedDriveGenusNames);
    driveGenusSearchTerm = appFilterText(drive.driveGenusSearchTerm, '');
    driveGenusSelectionMode = appFilterMode(drive.driveGenusSelectionMode, ['all', 'custom'], driveGenusSelectionMode || 'all');
    if (Array.isArray(drive.selectedDriveContSizes)) selectedDriveContSizes = appFilterArrayToSet(drive.selectedDriveContSizes);
    driveContSizeSearchTerm = appFilterText(drive.driveContSizeSearchTerm, '');
    driveContSizeSelectionMode = appFilterMode(drive.driveContSizeSelectionMode, ['all', 'custom'], driveContSizeSelectionMode || 'all');
    if (Array.isArray(drive.selectedDriveLocationCodes)) selectedDriveLocationCodes = appFilterArrayToSet(drive.selectedDriveLocationCodes);
    driveLocationSearchTerm = appFilterText(drive.driveLocationSearchTerm, '');
    driveLocationSelectionMode = appFilterMode(drive.driveLocationSelectionMode, ['all', 'custom'], driveLocationSelectionMode || 'all');
    if (Array.isArray(drive.selectedDriveLotCodes)) selectedDriveLotCodes = appFilterArrayToSet(drive.selectedDriveLotCodes);
    driveLotSearchTerm = appFilterText(drive.driveLotSearchTerm, '');
    driveLotSelectionMode = appFilterMode(drive.driveLotSelectionMode, ['all', 'custom'], driveLotSelectionMode || 'all');
    driveSeasonSearchTerm = appFilterText(drive.driveSeasonSearchTerm, '');
    if (Array.isArray(drive.driveSelectedSeasons)) driveSelectedSeasons = appFilterArrayToSet(drive.driveSelectedSeasons);
    driveColumnFilters = restoreSavedInventoryColumnFilters(drive.driveColumnFilters);
    driveColumnFilterFieldKey = normalizeDriveColumnFilterKey(drive.driveColumnFilterFieldKey);
    driveColumnFilterMode = normalizeDriveColumnFilterMode(drive.driveColumnFilterMode || 'values');
    driveColumnFilterValueSearchTerm = appFilterText(drive.driveColumnFilterValueSearchTerm, '');
    driveColumnFilterFieldSearchTerm = '';
    driveColumnFilterHeaderFieldsCache = [];
    driveColumnFilterDrafts = {};
    driveColumnFilterSelectedHeaders = new Set();
    driveColumnFilterStep = 'select';
    driveQuickFiltersModalOpen = false;
    driveCommonNameFilterOpen = false;
    driveGenusFilterOpen = false;
    driveContSizeFilterOpen = false;
    driveLocationFilterOpen = false;
    driveLotFilterOpen = false;
    driveColumnFilterDropdownOpen = false;
    driveViewDropdownOpen = false;
    driveSeasonDropdownOpen = false;
}

function restoreTasksFilters(tasks) {
    if (!tasks || typeof tasks !== 'object') return;
    activeTaskView = normalizeTaskViewValue(tasks.activeTaskView || tasks.activeTaskTab || activeTaskView);
    activeTaskFilter = getNormalizedTaskSubviewValue(activeTaskView, tasks.activeTaskFilter || tasks.activeTaskSubview || activeTaskFilter);
    activeTaskCustomerFilter = appFilterText(tasks.activeTaskCustomerFilter, activeTaskCustomerFilter || 'all') || 'all';
    activeTaskReserveRepFilter = appFilterText(tasks.activeTaskReserveRepFilter, activeTaskReserveRepFilter || 'all') || 'all';
    activeTaskReserveCustomerFilter = appFilterText(tasks.activeTaskReserveCustomerFilter, activeTaskReserveCustomerFilter || 'all') || 'all';
    if (Array.isArray(tasks.activeTaskReserveCustomerFilters)) activeTaskReserveCustomerFilters = appFilterArrayToSet(tasks.activeTaskReserveCustomerFilters);
    activeTaskReserveRowStatusMode = appFilterMode(tasks.activeTaskReserveRowStatusMode, ['all', 'matching'], activeTaskReserveRowStatusMode || 'all');
    activeTaskReservePhotoMode = appFilterMode(tasks.activeTaskReservePhotoMode, ['all', 'photos'], activeTaskReservePhotoMode || 'all');
    activeTaskSeasonReviewMode = appFilterText(tasks.activeTaskSeasonReviewMode, activeTaskSeasonReviewMode || 'winner') || 'winner';
    activeTaskTab = activeTaskView;
    activeTaskSubview = activeTaskFilter;
    taskViewTargetUser = appFilterNullableText(tasks.taskViewTargetUser);
    taskViewLevel = appFilterNumber(tasks.taskViewLevel, 0);
    selectedTaskBlock = appFilterNullableText(tasks.selectedTaskBlock);
    selectedTaskLoc = appFilterNullableText(tasks.selectedTaskLoc);
    selectedEndCapFolder = appFilterNullableText(tasks.selectedEndCapFolder);
    selectedFlyerFolder = appFilterNullableText(tasks.selectedFlyerFolder);
    activeFlyerFolderTab = appFilterText(tasks.activeFlyerFolderTab, activeFlyerFolderTab || 'active') || 'active';
    selectedColorWalkSearchTerm = appFilterText(tasks.selectedColorWalkSearchTerm, '');
    if (Array.isArray(tasks.selectedTaskGenusNames)) selectedTaskGenusNames = appFilterArrayToSet(tasks.selectedTaskGenusNames);
    taskGenusSearchTerm = appFilterText(tasks.taskGenusSearchTerm, '');
    if (Array.isArray(tasks.selectedTaskContSizes)) selectedTaskContSizes = appFilterArrayToSet(tasks.selectedTaskContSizes);
    taskContSizeSearchTerm = appFilterText(tasks.taskContSizeSearchTerm, '');
    taskLocationDetailSearchTerm = appFilterText(tasks.taskLocationDetailSearchTerm, '');
    selectedTaskLocationDetailGenus = appFilterText(tasks.selectedTaskLocationDetailGenus, '');
    selectedTaskLocationDetailLotCode = appFilterText(tasks.selectedTaskLocationDetailLotCode, '');
    taskModeSearchTerm = appFilterText(tasks.taskModeSearchTerm, '');
    taskEvalUserSearchTerm = appFilterText(tasks.taskEvalUserSearchTerm, '');
    taskSubviewSearchTerm = appFilterText(tasks.taskSubviewSearchTerm, '');
    taskReserveCustomerSearchTerm = appFilterText(tasks.taskReserveCustomerSearchTerm, '');
    if (Array.isArray(tasks.taskReserveCustomerDraftFilters)) taskReserveCustomerDraftFilters = appFilterArrayToSet(tasks.taskReserveCustomerDraftFilters);
    taskGenusFilterOpen = false;
    taskContSizeDropdownOpen = false;
    taskTabDropdownOpen = false;
    taskEvalUserDropdownOpen = false;
    taskSubviewDropdownOpen = false;
    taskReserveCustomerDropdownOpen = false;
}

function restoreAvFilters(av) {
    if (!av || typeof av !== 'object') return;
    activeAVTab = appFilterMode(av.activeAVTab, ['open', 'reserves'], activeAVTab || 'open');
    activeAvOpenTab = appFilterMode(av.activeAvOpenTab, ['name', 'photos'], activeAvOpenTab || 'name');
    activeAvHotPriceTab = 'all';
    avOpenLevel = appFilterNumber(av.avOpenLevel, 0);
    selectedAvOpenName = appFilterNullableText(av.selectedAvOpenName);
    selectedAvOpenSize = appFilterNullableText(av.selectedAvOpenSize);
    selectedAvOpenSeason = appFilterNullableText(av.selectedAvOpenSeason);
    selectedAvOpenLot = appFilterNullableText(av.selectedAvOpenLot);
    avResLevel = appFilterNumber(av.avResLevel, 0);
    selectedAvResRep = appFilterNullableText(av.selectedAvResRep);
    selectedAvResDriveUid = appFilterNullableText(av.selectedAvResDriveUid);
    selectedAvResItemCode = appFilterNullableText(av.selectedAvResItemCode);
    selectedAvResName = appFilterNullableText(av.selectedAvResName);
    selectedAvResSize = appFilterNullableText(av.selectedAvResSize);
    selectedAvResCustomerKey = appFilterNullableText(av.selectedAvResCustomerKey);
    activeAvReserveMode = appFilterMode(av.activeAvReserveMode, ['all', 'photos', 'cards'], activeAvReserveMode || 'all');
    activeAvReserveDetailTab = appFilterMode(av.activeAvReserveDetailTab, ['customer', 'rep', 'row'], activeAvReserveDetailTab || 'customer');
    selectedAvReserveDetailCustomerKey = appFilterNullableText(av.selectedAvReserveDetailCustomerKey);
    activeAvSalesBucket = appFilterMode(av.activeAvSalesBucket, AV_SALES_BUCKET_OPTIONS.map((option) => option.value), activeAvSalesBucket || 'current');
    activeAvPhotoMode = appFilterMode(av.activeAvPhotoMode, ['all', 'valid_photos', 'photos', 'no_photos'], activeAvPhotoMode || 'all');
    if (Array.isArray(av.selectedAvSeasons)) {
        selectedAvSeasons = appFilterArrayToSet(av.selectedAvSeasons);
        avSeasonDefaultsInitialized = true;
    }
    avSeasonSearchTerm = appFilterText(av.avSeasonSearchTerm, '');
    if (Array.isArray(av.selectedAvGenusNames)) selectedAvGenusNames = appFilterArrayToSet(av.selectedAvGenusNames);
    avGenusSearchTerm = appFilterText(av.avGenusSearchTerm, '');
    avGenusSelectionMode = appFilterMode(av.avGenusSelectionMode, ['all', 'custom'], avGenusSelectionMode || 'all');
    if (Array.isArray(av.selectedAvContSizes)) selectedAvContSizes = appFilterArrayToSet(av.selectedAvContSizes);
    avContSizeSearchTerm = appFilterText(av.avContSizeSearchTerm, '');
    avContSizeSelectionMode = appFilterMode(av.avContSizeSelectionMode, ['all', 'custom'], avContSizeSelectionMode || 'all');
    selectedAvSalesRepName = appFilterText(av.selectedAvSalesRepName, '');
    avSalesRepSearchTerm = appFilterText(av.avSalesRepSearchTerm, '');
    selectedAvRepCustomerKey = appFilterText(av.selectedAvRepCustomerKey, '');
    avRepCustomerSearchTerm = appFilterText(av.avRepCustomerSearchTerm, '');
    avHoldFilterMode = appFilterText(av.avHoldFilterMode, avHoldFilterMode || 'all') || 'all';
    avHoldStopOnly = appFilterBool(av.avHoldStopOnly, false);
    avColumnFilters = restoreSavedInventoryColumnFilters(av.avColumnFilters);
    avColumnFilterFieldKey = normalizeDriveColumnFilterKey(av.avColumnFilterFieldKey);
    avColumnFilterMode = normalizeDriveColumnFilterMode(av.avColumnFilterMode || 'values');
    avColumnFilterValueSearchTerm = appFilterText(av.avColumnFilterValueSearchTerm, '');
    avColumnFilterFieldSearchTerm = '';
    avColumnFilterHeaderFieldsCache = [];
    avColumnFilterDrafts = {};
    avColumnFilterSelectedHeaders = new Set();
    avColumnFilterStep = 'select';
    avPhotoOutreachMinSLts = appFilterText(av.avPhotoOutreachMinSLts, '');
    if (Array.isArray(av.avPhotoOutreachSelectedRepKeys)) avPhotoOutreachSelectedRepKeys = appFilterArrayToSet(av.avPhotoOutreachSelectedRepKeys);
    avSourceDropdownOpen = false;
    avSeasonDropdownOpen = false;
    avGenusFilterOpen = false;
    avContSizeFilterOpen = false;
    avHoldDropdownOpen = false;
    avPhotoDropdownOpen = false;
    avSalesRepDropdownOpen = false;
    avRepCustomerDropdownOpen = false;
    avColumnFilterDropdownOpen = false;
}

function restoreDocksFilters(docks) {
    if (!docks || typeof docks !== 'object') return;
    dockViewMode = appFilterMode(docks.dockViewMode, ['docks', 'mistakes', 'dropoff'], dockViewMode || 'docks');
    dockViewLevel = appFilterNumber(docks.dockViewLevel, 0);
    selectedDockNum = appFilterNullableText(docks.selectedDockNum);
    selectedDockStop = appFilterNullableText(docks.selectedDockStop);
    selectedDockName = appFilterNullableText(docks.selectedDockName);
    selectedDockSize = appFilterNullableText(docks.selectedDockSize);
    selectedDockItemCode = appFilterNullableText(docks.selectedDockItemCode);
    selectedDockCustomer = appFilterText(docks.selectedDockCustomer, '');
    selectedDockTrip = appFilterText(docks.selectedDockTrip, '');
    selectedDockRep = appFilterText(docks.selectedDockRep, '');
    if (Array.isArray(docks.selectedDockGenusNames)) selectedDockGenusNames = appFilterArrayToSet(docks.selectedDockGenusNames);
    dockGenusSearchTerm = appFilterText(docks.dockGenusSearchTerm, '');
    if (Array.isArray(docks.selectedDockContSizes)) selectedDockContSizes = appFilterArrayToSet(docks.selectedDockContSizes);
    dockContSizeSearchTerm = appFilterText(docks.dockContSizeSearchTerm, '');
    if (Array.isArray(docks.selectedDockLocationCodes)) selectedDockLocationCodes = appFilterArrayToSet(docks.selectedDockLocationCodes);
    dockLocationSearchTerm = appFilterText(docks.dockLocationSearchTerm, '');
    restoreDockRepCustomerFilterState(docks);
    dockRepSearchTerm = appFilterText(docks.dockRepSearchTerm, '');
    dockCustomerSearchTerm = appFilterText(docks.dockCustomerSearchTerm, '');
    dockColumnFilters = cloneDockColumnFilters(docks.dockColumnFilters || {});
    dockColumnFilterDrafts = cloneDockColumnFilters(dockColumnFilters);
    dockColumnFilterDropdownOpen = false;
    dockGenusFilterOpen = false;
    dockContSizeFilterOpen = false;
    dockLocationFilterOpen = false;
    dockRepFilterOpen = false;
    dockCustomerFilterOpen = false;
}

function restoreNcrFilters(ncr) {
    if (!ncr || typeof ncr !== 'object') return;
    reviewSearchTerm = appFilterText(ncr.reviewSearchTerm, '');
    moveUpSearchTerm = appFilterText(ncr.moveUpSearchTerm, '');
    reviewBrowseMode = normalizeNcrBrowseMode(ncr.reviewBrowseMode || reviewBrowseMode);
    moveUpBrowseMode = normalizeNcrBrowseMode(ncr.moveUpBrowseMode || moveUpBrowseMode);
    restoreNcrFilterState('review', ncr.review);
    restoreNcrFilterState('move-up', ncr.moveUp);
}

function restoreMovesFilters(moves) {
    if (!moves || typeof moves !== 'object') return;
    activeMovesTab = appFilterText(moves.activeMovesTab, activeMovesTab || 'main') || 'main';
    activeInventoryOfficeApprovalType = normalizeInventoryOfficeApprovalType(
        appFilterText(moves.activeInventoryOfficeApprovalType, activeInventoryOfficeApprovalType || 'move-up'));
    movesViewLevel = appFilterNumber(moves.movesViewLevel, 0);
    selectedMovesBlock = appFilterNullableText(moves.selectedMovesBlock);
    selectedMovesLocation = appFilterNullableText(moves.selectedMovesLocation);
    managerMoveCardSearchTerm = appFilterText(moves.managerMoveCardSearchTerm, managerMoveCardSearchTerm || '');
    managerMoveCardSelectedCommonName = appFilterText(moves.managerMoveCardSelectedCommonName, managerMoveCardSelectedCommonName || '');
    managerMoveCardSelectedContSize = appFilterText(moves.managerMoveCardSelectedContSize, managerMoveCardSelectedContSize || '');
    managerMoveCardSelectedSalesYear = appFilterText(moves.managerMoveCardSelectedSalesYear, managerMoveCardSelectedSalesYear || '');
    managerMoveInstructionText = appFilterText(moves.managerMoveInstructionText, managerMoveInstructionText || '');
}

function restoreSalesInventoryFilters(salesInventory) {
    if (!salesInventory || typeof salesInventory !== 'object') return;
    notOnInventoryPanelOpen = appFilterBool(salesInventory.notOnInventoryPanelOpen, false);
    notOnInventorySearchTerm = appFilterText(salesInventory.notOnInventorySearchTerm, '');
    notOnInventorySelectedUid = appFilterText(salesInventory.notOnInventorySelectedUid, '');
    notOnInventoryContSizeCode = appFilterText(salesInventory.notOnInventoryContSizeCode, '');
    notOnInventoryQualitySuffix = appFilterText(salesInventory.notOnInventoryQualitySuffix, notOnInventoryQualitySuffix || '1') || '1';
    notOnInventoryLocationCode = appFilterText(salesInventory.notOnInventoryLocationCode, '');
}
