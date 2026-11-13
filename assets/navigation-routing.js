let pendingNavigationDisplay = null;

function openDisplayOnlyNavigation(viewId, options = {}) {
    if (options.boot === true && shouldPreserveMountedBootView()) return false;
    const previous = getCurrentVisibleViewId();
    if (options.boot !== true && currentUser) getAppBootViewState().userHasNavigated = true;
    navTransitionSeq += 1;
    const identity = getNavigationVisibilityIdentity();
    pendingNavigationDisplay = { viewId, sequence: navTransitionSeq, owner: `${identity?.id}:${identity?.username}` };
    persistAppFilterStateNow();
    if (isDrawerOpen()) setMenuOpenState(false);
    if (previous && previous !== viewId) {
        cancelScheduledViewRenderWork(previous);
        cancelChunkRenderWorkForView(previous);
        if (previous !== 'detail') pushViewHistoryEntry(previous, getMainAreaScrollTop(), viewId);
    }
    if (previous === 'managers') cancelManagerModuleReads();
    showOnlyPrimaryView(viewId);
    const host = getViewElementById(viewId);
    syncNavigationDisplayStatus(host, ensureViewRenderState(viewId).initialized ? '' : 'Loading module access…');
    updateFooterNavState(viewId);
    syncGlobalHeaderChrome({ reason: `view-display:${viewId}`, force: true });
    repairAppShellScrollState(`view-display:${viewId}`, { resetGestureState: previous !== viewId });
    if (options.targetScrollTop != null) setMainAreaScrollTop(Math.max(0, Number(options.targetScrollTop) || 0));
    else if (previous !== viewId) queueScrollMainAreaToTop(`view:${viewId}`);
    if (viewId !== 'home') ensureNativeBackGuard();
    return false;
}

function isNavigationDisplayPromotionCurrent(pending) {
    const identity = getNavigationVisibilityIdentity();
    return pendingNavigationDisplay === pending && identity
        && pending.owner === `${identity.id}:${identity.username}`
        && pending.sequence === navTransitionSeq && getCurrentVisibleViewId() === pending.viewId
        && pending.viewId !== 'detail' && canAccessView(pending.viewId);
}

function promoteNavigationDisplayAfterAccess() {
    const pending = pendingNavigationDisplay;
    if (!pending || !isNavigationDisplayPromotionCurrent(pending)) return false;
    scheduleUiRender(`navigation-access-ready:${pending.viewId}`, () => applyNavigationDisplayPromotion(pending));
    return true;
}

function applyNavigationDisplayPromotion(pending) {
    if (!isNavigationDisplayPromotionCurrent(pending)) return;
    const scrollTop = getMainAreaScrollTop();
    const state = ensureViewRenderState(pending.viewId);
    pendingNavigationDisplay = null;
    if (!state.initialized) {
        const token = prepareLatestViewRender(pending.viewId);
        runPrimaryNavigationTargetRender({ nextViewId: pending.viewId, navigationSeq: pending.sequence }, token);
    }
    syncNavigationDisplayStatus(getViewElementById(pending.viewId));
    scheduleViewActivationWork(pending.viewId);
    schedulePostRenderMainAreaScrollRestore(pending.viewId, 'navigation-access-ready', scrollTop);
}

function switchView(viewId, options = {}) {
    const target = String(viewId || 'home').trim();
    if (!canDisplayNavigationView(target)) {
        showToast('Access unavailable', 'You do not have permission to open this view.', true);
        return false;
    }
    if (!canAccessView(target)) return openDisplayOnlyNavigation(target, options);
    pendingNavigationDisplay = null;
    syncNavigationDisplayStatus(getViewElementById(target));
    if (options.boot === true && shouldPreserveMountedBootView()) return false;
    if (options.boot !== true && currentUser) getAppBootViewState().userHasNavigated = true;
    const navigationSeq = ++navTransitionSeq;
    if (viewId === 'home' && restoreCameraDetailSession()) return;
    if (typeof getManagerTableManagementKey === 'function' && getManagerTableManagementKey(viewId)) return openManagerTableManagement(getManagerTableManagementKey(viewId));
    const context = beginPrimaryViewNavigation(viewId, options, navigationSeq);
    preparePrimaryNavigationTarget(context);
    if (!preparePrimaryNavigationOrigin(context)) return false;
    mountPrimaryNavigation(context);
    if (reusePrimaryNavigation(context)) return false;
    renderPrimaryNavigation(context);
    restorePrimaryNavigationScroll(context);
    return activatePrimaryNavigation(context);
}

function beginPrimaryViewNavigation(viewId, options, navigationSeq) {
    if (viewId !== 'bunch-note') window.BunchNote?.disposeView();
    if (viewId !== 'request' && !(viewId === 'detail' && window.BunchQueueShell?.isDetailOpen())) window.BunchQueueShell?.destroy();
    if (String(viewId || '').trim() !== 'managers') cancelManagerSeasonPriorityRead();
    const viewSwitchStartedAt = beginInternalPerfMeasure();
    persistAppFilterStateNow();
    if (driveQuickFiltersModalOpen) closeDriveQuickFiltersModal();
    if (String(viewId || '').trim() !== 'tasks') closeTaskDropdowns(false);
    if (isDrawerOpen()) setMenuOpenState(false);
    beginDirectNavigationActivity();
    const switchOptions = (options && typeof options === 'object') ? options : {};
    const fromHistory = !!switchOptions.fromHistory;
    const requestedViewId = String(viewId || 'home').trim();
    if (typeof syncRequestSalesImpactOwnership === 'function') syncRequestSalesImpactOwnership();
    if (requestedViewId === 'request-sales-impact') ensureRequestSalesImpactViewElement();
    if (requestedViewId === 'request' && switchOptions.managerSalesReps !== true && requestSalesRepsManagerMode) {
        requestSalesRepsManagerMode = false;
        if (activeReqTab === 'reps') activeReqTab = 'pending';
        markViewDirty('request');
    }
    const nextViewId = canAccessView(requestedViewId) ? requestedViewId : 'home';
    const currentViewId = getCurrentVisibleViewId();
    return { navigationSeq, viewSwitchStartedAt, switchOptions, fromHistory, requestedViewId, nextViewId, currentViewId };
}

function preparePrimaryNavigationTarget(context) {
    const { nextViewId, currentViewId, switchOptions, fromHistory } = context;
    const plainManagersHubEntry = nextViewId === 'managers' && !fromHistory
        && !switchOptions.managerSubView && !switchOptions.quickAccessRoute;
    if (plainManagersHubEntry) {
        if (activeHomeTab !== 'dashboard') {
            if (typeof cancelManagerModuleReads === 'function') cancelManagerModuleReads();
            if (typeof destroyManagerAssignedItemsView === 'function') destroyManagerAssignedItemsView();
            window.GncProductionSchedule?.unmount();
            if (typeof unmountAlphaCommandCenter === 'function') unmountAlphaCommandCenter('hr');
        }
        activeHomeTab = 'dashboard';
        managersSearchTerm = '';
        selectedProductivityUser = '';
        if (typeof markViewDirty === 'function') markViewDirty('managers');
    }
    if (switchOptions.quickAccessRoute && currentViewId !== nextViewId) {
        quickAccessNestedBackState = {
            account: String(currentUser || '').trim().toLowerCase(),
            origin: String(switchOptions.quickAccessOrigin || currentViewId || 'home').trim(),
            parent: nextViewId,
            route: String(switchOptions.quickAccessRoute || '').trim(),
            tab: String(switchOptions.quickAccessTab || '').trim().toLowerCase()
        };
    } else if (!fromHistory && currentViewId !== nextViewId) quickAccessNestedBackState = null;
    if (nextViewId === 'smart-moves') warmSalesIntelligenceData();
    if (nextViewId === 'av' && currentViewId === 'home') clearAvSearchForHomeEntry();
    if (!['historical-requests', 'request-history'].includes(nextViewId)) destroyHistoricalRequestsIsland();
    else markViewDirty('historical-requests');
    if (nextViewId !== 'sales-inventory' && inventoryFieldCountingMode) {
        inventoryFieldCountingMode = false;
        destroyFieldCountingIsland();
    }
}

function preparePrimaryNavigationOrigin(context) {
    const { nextViewId, currentViewId, switchOptions, fromHistory } = context;
    let targetScrollTop = switchOptions.targetScrollTop == null ? null : Math.max(0, Number(switchOptions.targetScrollTop) || 0);
    targetScrollTop = prepareManagerAssignedNavigation(currentViewId, nextViewId, targetScrollTop);
    if (shouldResetIosPhoneMainScrollForView(nextViewId)) targetScrollTop = 0;
    repairAppShellScrollState(`view-switch-start:${currentViewId || 'none'}:${nextViewId}`, { resetGestureState: currentViewId !== nextViewId });
    if (nextViewId === 'request') {
        clearIosPhoneRequestFlowState('request-switch-start', { resetScroll: true });
    }
    const switchGuardKey = `${currentViewId || 'none'}->${nextViewId}`;
    const switchNow = Date.now();
    if (!fromHistory && !switchOptions.force && currentViewId !== nextViewId && switchGuardKey === lastGuardedViewSwitchKey && (switchNow - lastGuardedViewSwitchAt) < VIEW_SWITCH_DUPLICATE_GUARD_MS) {
        return false;
    }
    lastGuardedViewSwitchKey = switchGuardKey;
    lastGuardedViewSwitchAt = switchNow;
    const rememberCurrentView = !fromHistory && currentViewId !== nextViewId && currentViewId && currentViewId !== 'detail';
    // Capture after scroll repair, before teardown/body writes invalidate
    // layout and can change the outgoing view's scroll anchoring.
    const historyScroll = rememberCurrentView
        ? (currentViewId === 'managers' && activeHomeTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW
            ? getManagerAssignedColumnState().scroll : getMainAreaScrollTop())
        : null;
    if (currentViewId === 'managers' && nextViewId !== 'managers') { cancelManagerModuleReads(); destroyManagerAssignedItemsView(); }
    if (currentViewId === 'communication' && nextViewId !== 'communication') unmountAlphaCommandCenter('communications');
    if (currentViewId === 'managers' && nextViewId !== 'managers' && activeHomeTab === MANAGER_HR_COMMAND_VIEW) unmountAlphaCommandCenter('hr');
    if (currentViewId === 'managers' && nextViewId !== 'managers' && activeHomeTab === MANAGER_PRODUCTION_SCHEDULE_VIEW) {
        window.GncProductionSchedule?.unmount();
    }
    Object.assign(context, { targetScrollTop, rememberCurrentView, historyScroll });
    return true;
}

function mountPrimaryNavigation(context) {
    const { nextViewId, currentViewId, rememberCurrentView, historyScroll } = context;
    const targetView = getViewElementById(nextViewId);
    if (targetView) {
        showOnlyPrimaryView(nextViewId);
        updateFooterNavState(nextViewId);
        if (nextViewId === 'docks') mountDocksFilterDisclosure(targetView);
    }
    if (window.__gncOpsPilot && typeof window.__gncOpsPilot.setActiveView === 'function') {
        window.__gncOpsPilot.setActiveView(nextViewId);
    }
    if (nextViewId === 'home') scheduleHomeDashboardFitSettle('view-switch-home');
    if (currentViewId && currentViewId !== nextViewId) {
        cancelScheduledViewRenderWork(currentViewId);
        cancelChunkRenderWorkForView(currentViewId);
        cancelScheduledUiRenderByPrefix(`view-enter:${currentViewId}`);
        cancelScheduledUiRenderByPrefix(`view-activate:${currentViewId}`);
        cancelScheduledUiRenderByPrefix(`view-chrome:${currentViewId}`);
    }
    cancelChunkRenderWorkForView(nextViewId);
    const nextState = ensureViewRenderState(nextViewId);
    if ((currentViewId === 'home' || currentViewId === 'managers') && nextViewId !== 'home' && nextViewId !== 'managers' && selectedProductivityUser) {
        selectedProductivityUser = '';
        markViewDirty(currentViewId);
    }
    if (rememberCurrentView) {
        pushViewHistoryEntry(currentViewId, historyScroll, nextViewId);
    }
    lastViewSwitchAt = Date.now();
    if (nextViewId !== 'home') ensureNativeBackGuard();
    Object.assign(context, { targetView, nextState });
}

function mountDocksFilterDisclosure(view) {
    const controls = view.querySelector('.freeze-panel #docks-filter-controls');
    if (!controls || controls.parentElement.matches('.docks-filter-disclosure')) return;
    const disclosure = document.createElement('details');
    disclosure.className = 'docks-filter-disclosure';
    const summary = document.createElement('summary');
    summary.textContent = 'Filters';
    controls.before(disclosure);
    disclosure.append(summary, controls);
}

function reusePrimaryNavigation(context) {
    const { nextViewId, currentViewId, nextState, targetScrollTop, navigationSeq, viewSwitchStartedAt } = context;
    if (currentViewId !== nextViewId || !nextState.initialized || nextState.dirty) return false;
    incrementInternalPerfCounter('warmViewReuseHits');
    if (nextViewId === 'home') repairHomeDashboardShell('home-warm-reuse');
    if (nextViewId === 'managers' && activeHomeTab === MANAGER_PRODUCTION_SCHEDULE_VIEW) {
        const scheduleRoot = document.getElementById('manager-production-schedule-root');
        if (scheduleRoot) window.GncProductionSchedule?.mount(scheduleRoot, (payload, signal) => postAppFunctionJson(APP_API_FUNCTION_URL, payload, { timeoutMs: 30000, label: 'Production Schedule', signal }), getSupabaseReadIdentityScope());
    }
    if (nextViewId === 'managers' && activeHomeTab === MANAGER_HR_COMMAND_VIEW) void mountAlphaCommandCenter('hr', document.getElementById('manager-hr-command-root'));
    if (nextViewId === 'communication') renderCommunicationHub();
    if (nextViewId === 'request') {
        scheduleRequestNavigationLiveWake('request-warm-reuse');
    }
    if (targetScrollTop != null) scheduleUiRender(`view-restore:${nextViewId}:${targetScrollTop}`, () => { if (isCurrentNavigationTransition(navigationSeq, nextViewId)) setMainAreaScrollTop(targetScrollTop); });
    syncGlobalHeaderChrome({ reason: `view-reuse:${nextViewId}`, force: true });
    scheduleStickyRailOffsetSync(`view-reuse:${nextViewId}`, true);
    if (isIosPhoneRequestFlowView(nextViewId)) scheduleIosPhoneRequestFlowAudit('view-reuse', { resetScroll: true });
    schedulePrimaryViewChromeRefresh(nextViewId, {
        delay: 0,
        requestSyncDelay: nextViewId === 'request' ? 120 : 0,
        passive: true,
        passiveDelay: isTouchConstrainedDevice() ? 20 : 6,
        skipStickySync: false,
        skipHeaderSync: true
    });
    repairAppShellScrollState(`view-reuse:${nextViewId}`);
    recordGncPerfStat('viewSwitches', {
        mode: 'reuse',
        from: currentViewId || 'none',
        to: nextViewId,
        duration: getAdaptivePerfElapsedMs(viewSwitchStartedAt)
    }, 80);
    reportPerformanceHealthEvent('view_switch', 'navigation', getAdaptivePerfElapsedMs(viewSwitchStartedAt), { reason: 'warm_reuse' });
    recordInternalPerfDuration('viewSwitchDurations', viewSwitchStartedAt, `${currentViewId || 'none'}->${nextViewId}`);
    return true;
}

function renderPrimaryNavigation(context) {
    const { nextViewId, currentViewId, nextState, targetView } = context;
    const needsTargetRender = !nextState.initialized || nextState.dirty;
    const renderToken = needsTargetRender ? prepareLatestViewRender(nextViewId) : 0;
    if (!targetView) {
        if (needsTargetRender) queueViewRender(nextViewId);
        return;
    }
    repairAppShellScrollState(`view-switch:${nextViewId}`, { resetGestureState: currentViewId !== nextViewId });
    syncGlobalHeaderChrome({ reason: `view-switch:${nextViewId}`, force: true });
    scheduleStickyRailOffsetSync(`view-switch:${nextViewId}`, true);
    if (needsTargetRender) {
        const runTargetRender = () => runPrimaryNavigationTargetRender(context, renderToken);
        if (shouldRenderViewSynchronouslyOnSwitch(nextViewId, nextState)) {
            runTargetRender();
        } else {
            scheduleUiRender(`view-switch-render:${nextViewId}`, runTargetRender, isTouchConstrainedDevice() ? 12 : 4);
        }
    }
}

function runPrimaryNavigationTargetRender({ nextViewId, navigationSeq }, renderToken) {
    if (!isLatestViewRenderToken(nextViewId, renderToken)) {
        incrementInternalPerfCounter('staleViewRenderSkips');
        return;
    }
    if (isCurrentNavigationTransition(navigationSeq, nextViewId)) renderViewContent(nextViewId, false, false);
}

function restorePrimaryNavigationScroll(context) {
    const { nextViewId, currentViewId, targetScrollTop, navigationSeq } = context;
    if (targetScrollTop != null) {
        scheduleUiRender(`view-restore:${nextViewId}:${targetScrollTop}`, () => {
            if (!isCurrentNavigationTransition(navigationSeq, nextViewId)) return;
            setMainAreaScrollTop(targetScrollTop);
            requestAnimationFrame(() => confirmPrimaryNavigationScroll(context));
        });
    } else if (currentViewId !== nextViewId) {
        queueScrollMainAreaToTop(`view:${nextViewId}`);
    }
}

function confirmPrimaryNavigationScroll({ nextViewId, targetScrollTop, navigationSeq }) {
    if (!isCurrentNavigationTransition(navigationSeq, nextViewId)) return;
    if (Math.abs(getMainAreaScrollTop() - targetScrollTop) > 2) setMainAreaScrollTop(targetScrollTop);
    if (isIosPhoneRequestFlowView(nextViewId)) scheduleIosPhoneRequestFlowAudit('view-restore', { resetScroll: true });
}

function activatePrimaryNavigation(context) {
    const { nextViewId, currentViewId, nextState, targetView, viewSwitchStartedAt } = context;
    const shouldActivateImmediately = shouldRunImmediateViewActivation(nextViewId, nextState);
    const warmCleanTarget = nextState.initialized && !nextState.dirty && !shouldActivateImmediately;
    schedulePrimaryViewChromeRefresh(nextViewId, {
        delay: warmCleanTarget ? 0 : 0,
        requestSyncDelay: nextViewId === 'request' ? 120 : 0,
        passive: warmCleanTarget,
        passiveDelay: warmCleanTarget ? (isTouchConstrainedDevice() ? 22 : 8) : 0,
        skipStickySync: false,
        skipHeaderSync: false
    });
    if (nextViewId === 'request') scheduleRequestNavigationLiveWake('request-switch');
    if (shouldActivateImmediately) {
        scheduleViewActivationWork(nextViewId);
    } else {
        scheduleWarmViewFollowup(nextViewId, nextState, {
            allowWarmRefresh: !warmCleanTarget,
            syncRealtime: true,
            delay: warmCleanTarget ? (isTouchConstrainedDevice() ? 64 : 32) : (isTouchConstrainedDevice() ? 56 : 28),
            backgroundDelay: warmCleanTarget ? (isTouchConstrainedDevice() ? 148 : 104) : (isTouchConstrainedDevice() ? 128 : 92)
        });
    }
    recordGncPerfStat('viewSwitches', {
        mode: targetView ? 'switch' : 'queued',
        from: currentViewId || 'none',
        to: nextViewId,
        duration: getAdaptivePerfElapsedMs(viewSwitchStartedAt)
    }, 80);
    reportPerformanceHealthEvent('view_switch', 'navigation', getAdaptivePerfElapsedMs(viewSwitchStartedAt), { reason: targetView ? 'switch' : 'queued' });
    recordInternalPerfDuration('viewSwitchDurations', viewSwitchStartedAt, `${currentViewId || 'none'}->${nextViewId}`);
    return false;

}


function shouldRenderViewSynchronouslyOnSwitch(viewId = '', state = null) {
    const targetViewId = String(viewId || '').trim();
    if (!targetViewId) return false;
    if (targetViewId === 'av' && canRenderWarmAvInventory()) return true;
    if (targetViewId === 'request') {
        const requestState = (state && typeof state === 'object') ? state : ensureViewRenderState(targetViewId);
        return !requestState.initialized || !!requestState.dirty;
    }
    if (targetViewId === 'managers' && activeHomeTab === 'dashboard') {
        const managerState = (state && typeof state === 'object') ? state : ensureViewRenderState(targetViewId);
        if (managerState.initialized && !managerState.dirty) return false;
        const managerConfig = getViewLoadingConfig(targetViewId);
        // The module picker is a small navigation shell with no required
        // dataset cohort. Render it in the click turn so touch devices
        // don't pay an extra timer and animation-frame hop.
        return !(managerConfig && Array.isArray(managerConfig.required) && managerConfig.required.length);
    }
    if (isTouchConstrainedDevice() || isIOSDevice()) return false;
    const lightViewIds = ['home', 'sales', 'qc', 'communication', 'production', 'sales-inventory', 'disease-pest', 'office', 'po-management'];
    if (!lightViewIds.includes(targetViewId)) return false;
    const safeState = (state && typeof state === 'object') ? state : ensureViewRenderState(targetViewId);
    if (safeState.initialized && !safeState.dirty) return false;
    const config = getViewLoadingConfig(targetViewId);
    return !(config && Array.isArray(config.required) && config.required.length);
}
