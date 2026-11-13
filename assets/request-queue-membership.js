function queueAccessScope(tab = 'suspend-tag') {
    const user = normalizeEvalAssignableUser(currentUser).replace(/^nally_aguilar$/, 'nelly_aguilar');
    const access = globalThis.GncUserAccessControl;
    const resolved = access?.resolveUserAccessMatrix(user);
    const matrix = resolved?.__pendingAccessWrite ? null : resolved;
    const role = String(matrix?.role || (typeof currentRole === 'string' ? currentRole : '')).toUpperCase().replace(/[^A-Z]/g, '');
    const admin = ['ADMIN', 'ADMINISTRATOR', 'SUPERADMIN'].includes(role);
    if (tab === 'pending') {
        const all = !!user && (admin || ['MANAGER', 'EVAL', 'EVALUATOR'].includes(role)
            || GLOBAL_LIVE_CHANGE_USER_KEYS.has(user) || matrix?.view_all_requests === 'Y'
            || matrix?.request_default_scope === 'ALL');
        return { user, all, initial: all ? 'ALL' : user };
    }
    const all = !!user && admin;
    const defaultsToOwner = ['dylan_collyge', 'megan_kelly'].includes(user);
    return { user, all, initial: all && !defaultsToOwner ? 'ALL' : user };
}

function getQueueScopeFilter(tab) {
    const policy = queueAccessScope(tab);
    const state = getManagerAssignedColumnState();
    const signature = [policy.user, policy.all, policy.initial].join('|');
    state.queueScopeFilters ||= {};
    let choice = state.queueScopeFilters[tab];
    if (!choice || choice.signature !== signature) {
        choice = { signature, value: policy.initial };
        state.queueScopeFilters[tab] = choice;
    }
    return policy.all ? choice.value : policy.user;
}

function isQueueOwnerVisible(row, tab = isDockSuspendDcRequestMirrorRow(row) ? 'suspend-tag' : 'pending') {
    const selected = getQueueScopeFilter(tab);
    return selected === 'ALL' || !!selected && (getAssignedQueueOwner(row) || 'Unassigned') === selected;
}

function prunePendingRequestCards(rows) {
    if (normalizeRequestTabValue(activeReqTab) !== 'pending') return false;
    const container = document.getElementById('request-content');
    if (!container) return false;
    const pendingIds = new Set(rows.filter(isRequestPendingVisible).map(getItemUniqueId));
    const removed = new Set();
    for (const card of container.querySelectorAll('[data-request-uid]')) {
        if (pendingIds.delete(card.getAttribute('data-request-uid'))) continue;
        removed.add(card.closest('.request-swipe-row') || card);
    }
    if (!removed.size) return false;
    cancelChunkRenderWorkForView('request');
    container.__pendingRequestStage = null;
    completedPendingRequestRender = null;
    for (const card of removed) card.remove();
    setContainerRenderSignature(container, '');
    if (container.dataset) delete container.dataset.requestRenderKey;
    return true;
}

function refreshLocalRequestViewState(reason = 'request-local', options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const renderVisible = safeOptions.renderVisible !== false;
    const allowSameFrameRender = safeOptions.allowSameFrameRender === true;
    const renderImmediate = safeOptions.immediate === true && allowSameFrameRender && !isTouchConstrainedDevice() && !isIOSDevice();
    invalidateResolvedViewStateCaches();
    prunePendingRequestCards(requestsInventory);
    const reconciledState = reconcileRequestDrillState(requestsInventory);
    updateFooterRequestBadge();
    requestViewLiveSyncSignature = buildRequestLiveSyncSignature(requestsInventory);
    persistCurrentCache(safeOptions.persistImmediate === true, reason);
    markViewDirty('request');
    markViewDirty('reports');
    const requestVisible = isViewVisible('request');
    if (!renderVisible) return;
    if (requestVisible) refreshVisibleRequestQueue(reason,safeOptions,reconciledState,renderImmediate);
    if (isViewVisible('reports')) queueInteractiveViewRender('reports', false, !!safeOptions.forceReportsRender, 0, 140);
}

function refreshVisibleRequestQueue(reason, options, reconciled, immediate) {
    if (reason === 'request-complete-retry' && normalizeRequestTabValue(activeReqTab) === 'pending') {
        renderPendingRequestReceiptSnapshot(reconciled.items);
        return;
    }
    if (String(reason).startsWith('request-live-sync')) {
        scheduleHydratedViewRender('request');
        return;
    }
    if (immediate) {
        renderViewContent('request', false, true);
        return;
    }
    scheduleTrackedViewRender('request', `request:local:${String(reason || 'refresh').trim() || 'refresh'}`, {
        delay: 0,
        typingDelay: Math.max(32, Number(options.typingDelay) || 64),
        forceRender: options.forceRender === true || !!reconciled?.changed,
        preferImmediate: false,
        userAction: options.userAction !== false,
        yieldToPaint: true,
        paintYieldDelayMs: isTouchConstrainedDevice() ? 18 : 8,
        allowWhileTouching: true,
        allowWhileScrolling: true,
        allowDuringLiveGesture: true,
        allowDuringRecentInteraction: true,
        allowDuringExtendedBlock: true,
        touchDelayMs: 16,
        interactionDelayMs: 16,
        scrollDelayMs: 32,
        maxDeferMs: USER_VISIBLE_FORCE_RENDER_MAX_DEFER_MS
    });
}

function renderPendingRequestReceiptSnapshot(rows) {
    const container = document.getElementById('request-content');
    const crumb = document.getElementById('request-crumb');
    if (!container) return;
    cancelChunkRenderWorkForView('request');
    container.__pendingRequestStage = null;
    completedPendingRequestRender = null;
    const plan = buildPendingRequestRenderPlan(rows);
    const markup = plan.rows.map(row => generateCard(row,'request','status-purple')).join('')
        || '<div class="p-8 text-center text-gray-400">No pending requests.</div>';
    applyRequestRenderMarkup(container,crumb,plan.crumbText,markup,plan.renderSignature || 'request:pending:empty');
    decorateRequestRows();
    syncRequestBrowseFooter(container,plan.footerMarkup);
    scheduleDeferredCardPhotoHydration(container);
}

function activateQueCategory(tab) {
    activeReqTab = tab;
    syncQueActiveCategory();
}

function scheduleQueCategoryRefresh(tab, navigationSeq) {
    runAfterShellInteractive(() => {
        if (!isCurrentNavigationTransition(navigationSeq, 'request') || activeReqTab !== tab) return;
        if (tab === 'projects') return void ensureQueueInventoryProjectsData(true);
        if (window.BunchQueueShell?.isTab(tab)) return;
        if (tab === 'eval-work') return void loadEvalWorkAssignments(true).catch(() => {});
        if (tab === 'suspend-tag') refreshQueSuspendCategory(navigationSeq);
        forceRefreshRequestsForView('request-tab', {
            force: true,
            allowWhileInteractive: true,
            minIntervalMs: 0
        }).catch(() => {});
    });
}

function refreshQueSuspendCategory(navigationSeq) {
    loadDatasetTargetsWithLimit([{ key: 'suspendTag', mode: 'full' }, { key: 'soc', mode: 'full' }], {
        force: true,
        preserveRequestedMode: true,
        allowWhileInteractive: true,
        retryReason: 'request-tab-suspend'
    }, 1).then(() => {
        if (isCurrentNavigationTransition(navigationSeq, 'request') && activeReqTab === 'suspend-tag') {
            scheduleRequestRender(0, 0, true);
        }
    }).catch(() => {});
}

function resetQueCategoryDrills(nextTab) {
    activeReqTab = nextTab;
    if (nextTab === 'eval-work') subscribeEvalWorkRealtime();
    activeLocationMoveQueDetailUid = '';
    activeLocationWorkJobId = '';
    activeShearQueDetailId = '';
    activeAvOptionEvalDetailId = '';
    if (nextTab !== 'eval-work') activeEvalWorkDetailId = '';
    requestViewLevel = 0;
    selectedReqFolder = null;
    selectedReqRepView = null;
    selectedReqCustView = null;
    selectedReqConsigneeView = null;
    selectedReqFolderView = null;
    requestFolderSearchTerm = '';
    requestRepSearchTerm = '';
    requestCustomerSearchTerm = '';
    requestConsigneeSearchTerm = '';
    requestFolderDateFilter = '';
    if (nextTab === 'suspend-tag') {
        requestDylanFilterMode = 'all';
        requestDylanFilterValue = '';
        requestDylanSalesRepValue = '';
        requestDylanFilterMenuOpen = '';
    }
    clearSelection();
}
