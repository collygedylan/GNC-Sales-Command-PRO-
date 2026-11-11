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

export function productionHomeSyncMetadataCoordinatorOwnsCurrentView() {
            if (typeof canUseProductionLiveSync !== 'function' || !canUseProductionLiveSync()
                || typeof getCurrentVisibleViewId !== 'function' || getCurrentVisibleViewId() !== 'home'
                || !canViewDashboardSyncStatus() || typeof getProductionLiveSyncContext !== 'function') return false;
            const context = getProductionLiveSyncContext();
            return (context.surfaces || []).includes('home:sync-metadata')
                && (context.adapters || []).some((adapter) => adapter.id === 'side:homeSyncMetadata');
        }

export async function refreshManualErpHomeRevisionMetadata(force = false) {
    const owner = getSupabaseReadIdentityScope();
    if (!force && dashboardSyncMetadataOwner === owner && dashboardSyncMetadataFetchedAt
        && Date.now() - dashboardSyncMetadataFetchedAt < DASHBOARD_SYNC_METADATA_TTL_MS) return true;
    if (dashboardSyncMetadataInFlight && dashboardSyncMetadataRequestOwner === owner) return dashboardSyncMetadataInFlight;
    const pending = prefetchDashboardSyncMetadataAfterLogin();
    dashboardSyncMetadataInFlight = pending;
    dashboardSyncMetadataRequestOwner = owner;
    try {
        const published = await pending;
        if (owner !== getSupabaseReadIdentityScope() || !canViewDashboardSyncStatus()) return false;
        if (published) dashboardSyncMetadataFetchedAt = Date.now();
        return published;
    } finally {
        if (dashboardSyncMetadataInFlight === pending) {
            dashboardSyncMetadataInFlight = null;
            dashboardSyncMetadataRequestOwner = '';
        }
    }
}

export async function readLegacyErpHomeSource(source, signal) {
    const query = `select=filename,last_updated&last_updated=not.is.null&order=last_updated.desc&limit=${DASHBOARD_SYNC_METADATA_LIMIT}&offset=0`;
    const read = ({ signal: readSignal }) => fetchAuthenticatedSupabaseReadPage(source.table, query,
        { timeoutMs: SUPABASE_READ_TIMEOUT_MS, signal: readSignal });
    const page = source.table === 'ph_master_inventory' ? await read({ signal })
        : await runDedupeSupabaseRead(`page:${source.table}:${query}`, read, { signal });
    return collectDashboardSyncSource(formatFetchedRows(page?.rows || [], source.table), source.label);
}

export async function loadLegacyErpHomeMetadata(owner, signal) {
    const current = () => !signal.aborted && !productionHomeSyncMetadataCoordinatorOwnsCurrentView()
        && owner === getSupabaseReadIdentityScope() && canViewDashboardSyncStatus();
    const entries = [];
    for (const source of getDashboardSyncMetadataSources()) {
        if (!current()) return false;
        try {
            const summary = await readLegacyErpHomeSource(source, signal);
            if (!current()) return false;
            if (summary && (summary.iso || summary.files.length)) entries.push(summary);
        } catch {
            // Retain the previous source summary when its bounded read fails.
            if (!current()) return false;
        }
        await yieldToUiFrame();
    }
    if (!current()) return false;
    dashboardSyncMetadataSummaries = mergeDashboardSyncSummaries([
        ...(dashboardSyncMetadataOwner === owner ? dashboardSyncMetadataSummaries : []), ...entries]);
    dashboardSyncMetadataFetchedAt = Date.now();
    dashboardSyncMetadataOwner = owner;
    updateDashboardSyncSummary();
    return true;
}
