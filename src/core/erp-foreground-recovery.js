const MANUAL_ERP_STAGED_STALL_MS = 12000;

export function getManualErpStagingAge(status = {}, now = Date.now()) {
    if (!status?.active || !status.runId) return null;
    const key = status.currentStage === 'hl_po' ? 'hl_po_parsed' : status.currentStage;
    const progress = status.sourceProgress?.[key];
    if (!['staging', 'publishing'].includes(progress?.stage)) return null;
    const stamp = Date.parse(progress.updatedAt || '');
    return Number.isFinite(stamp) ? Math.max(0, now - stamp) : null;
}

export function getManualErpProgressPollDelay(status, normalDelay, now = Date.now()) {
    const age = getManualErpStagingAge(status, now);
    if (age === null || age >= MANUAL_ERP_STAGED_STALL_MS) return normalDelay;
    return Math.min(normalDelay, Math.max(1000, MANUAL_ERP_STAGED_STALL_MS - age));
}

export function resumeManualErpCheckpoint(status, foreground = false) {
    if (!status?.active || !status.runId || Number(status.retryNotBefore) > Date.now()) return false;
    const age = getManualErpStagingAge(status);
    if (!foreground && (age === null || age < MANUAL_ERP_STAGED_STALL_MS)) return false;
    return driveManualErpSyncFromStatus(status, true);
}

export function shouldIgnoreManualErpStatus(current, incoming) {
    if (!current?.active || !incoming || current.runId === incoming.runId) return false;
    const started = Date.parse(current.startedAt);
    if (current.runId) return Date.parse(incoming.startedAt) < started;
    if (incoming.active && incoming.runId) return false;
    return Date.parse(incoming.finishedAt || incoming.updatedAt || incoming.startedAt) < started;
}

export function getManualSyncCompletionViewId() {
    const visibleTracked = typeof getVisibleTrackedViewIds === 'function' ? getVisibleTrackedViewIds() : [];
    const visibleView = visibleTracked[0] || (typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '');
    return resolveRealtimeContextViewId(visibleView || activeRealtimeContextViewId || activeRealtimeViewId || 'home');
}

async function acquireManualErpWakeLock(state, request) {
    try {
        const lock = await Promise.resolve().then(() => request('screen'));
        if (state.wanted) state.sentinel = lock;
        else await lock.release();
    } catch {
        // Sync can continue on the server when the browser declines the lock.
    } finally {
        state.pending = null;
    }
}

function releaseManualErpWakeLock(state) {
    const lock = state.sentinel;
    state.sentinel = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
}

export function createManualErpScreenWakeLock(request) {
    const state = { sentinel: null, pending: null, wanted: false };
    return next => {
        state.wanted = next;
        if (!next) releaseManualErpWakeLock(state);
        else if (!state.pending && (!state.sentinel || state.sentinel.released)) state.pending = acquireManualErpWakeLock(state, request);
        return state.pending;
    };
}

export function bindManualErpProgressWakeLock(doc, win, screenLock, owner) {
    const modal = doc.getElementById('erp-sync-progress-modal');
    if (!modal || !screenLock?.request || !win.MutationObserver) return;
    const setWanted = createManualErpScreenWakeLock(screenLock.request.bind(screenLock));
    const sync = () => {
        const open = !modal.classList.contains('hidden') && modal.style.display !== 'none';
        void setWanted(open && doc.visibilityState === 'visible' && !!modal.dataset.owner && modal.dataset.owner === owner());
    };
    const observer = new win.MutationObserver(sync);
    observer.observe(modal, { attributes: true, attributeFilter: ['class', 'style', 'data-owner'] });
    doc.addEventListener('visibilitychange', sync);
    win.addEventListener('pagehide', () => setWanted(false));
    win.addEventListener('pageshow', sync);
}
