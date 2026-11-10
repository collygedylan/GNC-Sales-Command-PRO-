function captureAppFilterState() {
    let visibleView = currentPrimaryViewId || 'home';
    try { visibleView = getCurrentVisibleViewId() || visibleView; } catch { globalThis.reportHandledRuntimeIssue?.("captureAppFilterState", 'HANDLED_OPERATION_FAILURE'); }
    return {
        version: 1,
        savedAt: new Date().toISOString(),
        user: normalizeAppFilterStateUserKey(firstNonEmptyValue(currentUser, currentUserDisplay, 'anonymous')),
        visibleView,
        drive: captureDriveFilters(),
        tasks: captureTasksFilters(),
        av: captureAvFilters(),
        request: captureRequestViewState(),
        docks: captureDocksFilters(),
        ncr: captureNcrFilters(),
        moves: captureMovesFilters(),
        salesInventory: captureSalesInventoryFilters()
    };
}

function captureDriveFilters() {
    return {
        activeDriveMode,
        activeDriveTab,
        activeDriveHoldStopReport,
        driveReportEvalUserFilter,
        driveOpenStockReportSeason,
        driveOpenStockReportSalesYear,
        driveOpenStockReportMaxSLts,
        selectedDriveBlock,
        selectedDriveLoc,
        driveQuickFilterName,
        driveQuickFilterLocation,
        driveQuickFilterLot,
        driveQuickFilterSize,
        driveQuickFilterPriority,
        driveQuickFilterLtsMode,
        driveQuickFilterLtsValue,
        driveQuickHoldStopOnly,
        driveViewLevel,
        selectedDriveName,
        selectedDriveSize,
        selectedDriveSeason,
        selectedDriveProgram,
        selectedDriveCommonNames: appFilterSetToArray(selectedDriveCommonNames),
        driveCommonNameSearchTerm,
        selectedDriveGenusNames: appFilterSetToArray(selectedDriveGenusNames),
        driveGenusSearchTerm,
        driveGenusSelectionMode,
        selectedDriveContSizes: appFilterSetToArray(selectedDriveContSizes),
        driveContSizeSearchTerm,
        driveContSizeSelectionMode,
        selectedDriveLocationCodes: appFilterSetToArray(selectedDriveLocationCodes),
        driveLocationSearchTerm,
        driveLocationSelectionMode,
        selectedDriveLotCodes: appFilterSetToArray(selectedDriveLotCodes),
        driveLotSearchTerm,
        driveLotSelectionMode,
        driveSeasonSearchTerm,
        driveSelectedSeasons: appFilterSetToArray(driveSelectedSeasons),
        driveColumnFilters: Object.keys(driveColumnFilters || {}).reduce((acc, key) => {
            const safeKey = normalizeDriveColumnFilterKey(key);
            const filter = getDriveColumnFilterForField(safeKey);
            if (!safeKey || !isDriveColumnFilterActive(filter)) return acc;
            acc[safeKey] = {
                mode: normalizeDriveColumnFilterMode(filter.mode || 'values'),
                values: Array.isArray(filter.values) ? filter.values.map(normalizeDriveColumnValue) : [],
                text: normalizeDriveColumnValue(filter.text)
            };
            return acc;
        }, {}),
        driveColumnFilterFieldKey,
        driveColumnFilterMode,
        driveColumnFilterValueSearchTerm
    };
}

function captureTasksFilters() {
    return {
        activeTaskView,
        activeTaskFilter,
        activeTaskCustomerFilter,
        activeTaskReserveRepFilter,
        activeTaskReserveCustomerFilter,
        activeTaskReserveCustomerFilters: appFilterSetToArray(activeTaskReserveCustomerFilters),
        activeTaskReserveRowStatusMode,
        activeTaskReservePhotoMode,
        activeTaskSeasonReviewMode,
        activeTaskTab,
        activeTaskSubview,
        taskViewTargetUser,
        taskViewLevel,
        selectedTaskBlock,
        selectedTaskLoc,
        selectedEndCapFolder,
        selectedFlyerFolder,
        activeFlyerFolderTab,
        selectedColorWalkSearchTerm,
        selectedTaskGenusNames: appFilterSetToArray(selectedTaskGenusNames),
        taskGenusSearchTerm,
        selectedTaskContSizes: appFilterSetToArray(selectedTaskContSizes),
        taskContSizeSearchTerm,
        taskLocationDetailSearchTerm,
        selectedTaskLocationDetailGenus,
        selectedTaskLocationDetailLotCode,
        taskModeSearchTerm,
        taskEvalUserSearchTerm,
        taskSubviewSearchTerm,
        taskReserveCustomerSearchTerm,
        taskReserveCustomerDraftFilters: appFilterSetToArray(taskReserveCustomerDraftFilters)
    };
}

function captureAvFilters() {
    return {
        activeAVTab,
        activeAvOpenTab,
        activeAvHotPriceTab,
        avOpenLevel,
        selectedAvOpenName,
        selectedAvOpenSize,
        selectedAvOpenSeason,
        selectedAvOpenLot,
        avResLevel,
        selectedAvResRep,
        selectedAvResDriveUid,
        selectedAvResItemCode,
        selectedAvResName,
        selectedAvResSize,
        selectedAvResCustomerKey,
        activeAvReserveMode,
        activeAvReserveDetailTab,
        selectedAvReserveDetailCustomerKey,
        activeAvSalesBucket,
        activeAvPhotoMode,
        selectedAvSeasons: appFilterSetToArray(selectedAvSeasons),
        avSeasonSearchTerm,
        selectedAvGenusNames: appFilterSetToArray(selectedAvGenusNames),
        avGenusSearchTerm,
        avGenusSelectionMode,
        selectedAvContSizes: appFilterSetToArray(selectedAvContSizes),
        avContSizeSearchTerm,
        avContSizeSelectionMode,
        selectedAvSalesRepName,
        avSalesRepSearchTerm,
        selectedAvRepCustomerKey,
        avRepCustomerSearchTerm,
        avHoldFilterMode,
        avHoldStopOnly,
        avColumnFilters: Object.keys(avColumnFilters || {}).reduce((acc, rawKey) => {
            const key = normalizeDriveColumnFilterKey(rawKey);
            const filter = getAvColumnFilterForField(key);
            if (!key || !isDriveColumnFilterActive(filter)) return acc;
            acc[key] = {
                mode: normalizeDriveColumnFilterMode(filter.mode || 'values'),
                values: Array.isArray(filter.values) ? filter.values.map(normalizeDriveColumnValue) : [],
                text: normalizeDriveColumnValue(filter.text)
            };
            return acc;
        }, {}),
        avColumnFilterFieldKey,
        avColumnFilterMode,
        avColumnFilterValueSearchTerm,
        avPhotoOutreachMinSLts,
        avPhotoOutreachSelectedRepKeys: appFilterSetToArray(avPhotoOutreachSelectedRepKeys)
    };
}

function captureDocksFilters() {
    return {
        dockViewMode,
        dockViewLevel,
        selectedDockNum,
        selectedDockStop,
        selectedDockName,
        selectedDockSize,
        selectedDockItemCode,
        selectedDockCustomer,
        selectedDockTrip,
        selectedDockRep,
        selectedDockGenusNames: appFilterSetToArray(selectedDockGenusNames),
        dockGenusSearchTerm,
        selectedDockContSizes: appFilterSetToArray(selectedDockContSizes),
        dockContSizeSearchTerm,
        selectedDockLocationCodes: appFilterSetToArray(selectedDockLocationCodes),
        dockLocationSearchTerm,
        ...captureDockRepCustomerFilterState(),
        dockRepSearchTerm,
        dockCustomerSearchTerm,
        dockColumnFilters: cloneDockColumnFilters(dockColumnFilters)
    };
}

function captureNcrFilters() {
    return {
        reviewSearchTerm,
        moveUpSearchTerm,
        reviewBrowseMode,
        moveUpBrowseMode,
        review: captureNcrFilterState('review'),
        moveUp: captureNcrFilterState('move-up')
    };
}

function captureMovesFilters() {
    return {
        activeMovesTab,
        activeInventoryOfficeApprovalType,
        movesViewLevel,
        selectedMovesBlock,
        selectedMovesLocation,
        managerMoveCardSearchTerm,
        managerMoveCardSelectedCommonName,
        managerMoveCardSelectedContSize,
        managerMoveCardSelectedSalesYear,
        managerMoveInstructionText
    };
}

function captureSalesInventoryFilters() {
    return {
        notOnInventoryPanelOpen,
        notOnInventorySearchTerm,
        notOnInventorySelectedUid,
        notOnInventoryContSizeCode,
        notOnInventoryQualitySuffix,
        notOnInventoryLocationCode
    };
}
