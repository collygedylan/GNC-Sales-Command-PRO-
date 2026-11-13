export function prunePendingRequestCards(rows) {
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

export function refreshLocalRequestViewState(reason = 'request-local', options = {}) {
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
