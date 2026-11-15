export function clearReclassDeliveryPollTimer() {
    if (reclassDeliveryPollTimer == null) return;
    reclassDeliveryPollTimer.stop();

}

export function scheduleReclassDeliveryPolling() {
    reclassDeliveryPollTimer ||= window.GncQuotaPolling.create({enabled:isQuotaBackgroundPollingAllowed,run:pollReclassDeliveryJobs});
    reclassDeliveryPollTimer.start();
}
export function startReclassDeliveryPolling() {
    queueArgosReclassMoveRecovery();
    renderReclassDeliveryStatusTray();
    if (!isQuotaBackgroundPollingAllowed()) { clearReclassDeliveryPollTimer(); return; }
    void pollReclassDeliveryJobs().catch(() => {});
    scheduleReclassDeliveryPolling();
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearReclassDeliveryPollTimer();
        clearTimeout(managerApprovalLiveRefreshTimer);
        managerApprovalLiveRefreshTimer = null;
    }
    else startReclassDeliveryPolling();
}, { passive: true });
export function isManagerApprovalLiveContextActive(tab = activeHomeTab) {
    const safeTab = String(tab || activeHomeTab || '').trim().toLowerCase();
    return isViewVisible('managers')
        && isManagerApprovalTab(safeTab)
        && canUseManagerApprovalTab(safeTab)
        && navigator.onLine !== false
        && document.hidden !== true;
}

let managerRefreshPending = null, managerRefreshFailures = 0;
async function refreshManagerApprovalSources(safeTab) {
    if (isInventoryChecksApprovalTaskView(safeTab) || isShearApprovalTaskView(safeTab)) {
        await ensureInventoryEditRequestsLoadedForShearListCatchup(true);
        if (isManagerApprovalLiveContextActive(safeTab)) scheduleManagersRender(true);
    }
    if (useManagerReportPages('approval')) await getManagerReportPageController().refresh('approval');
    else {
        if (isNcrApprovalTaskView(safeTab)) await scheduleNcrApprovalTaskRowsRefresh(safeTab, { bypassThrottle: true, quiet: true });
        if (isNotOnInventoryApprovalTaskView(safeTab)) await scheduleNotOnInventoryApprovalTaskRowsRefresh(safeTab, { bypassThrottle: true, quiet: true });
    }
}
export function runManagerApprovalLiveRefresh(tab = activeHomeTab) {
    const safeTab = String(tab || activeHomeTab || '').trim().toLowerCase();
    if (managerApprovalLiveRefreshTimer) clearTimeout(managerApprovalLiveRefreshTimer);
    managerApprovalLiveRefreshTimer = null;
    if (managerRefreshPending || canUseProductionLiveSync() || !isManagerApprovalLiveContextActive(safeTab)) return false;
    managerRefreshPending = refreshManagerApprovalSources(safeTab)
        .then(() => { managerRefreshFailures = 0; })
        .catch(error => { managerRefreshFailures++; console.warn('Manager approval refresh deferred', error); })
        .finally(() => {
            managerRefreshPending = null;
            scheduleManagerApprovalLiveRefresh(Math.min(1800000, 300000 * 2 ** Math.min(managerRefreshFailures, 3)));
        });
    return false;
}

export function scheduleManagerApprovalLiveRefresh(delay = MANAGER_APPROVAL_LIVE_REFRESH_MS) {
    if (canUseProductionLiveSync()) { clearTimeout(managerApprovalLiveRefreshTimer); managerApprovalLiveRefreshTimer = null; return false; }
    if (managerApprovalLiveRefreshTimer) clearTimeout(managerApprovalLiveRefreshTimer);
    managerApprovalLiveRefreshTimer = null;
    if (!isManagerApprovalLiveContextActive(activeHomeTab)) return false;
    managerApprovalLiveRefreshTimer = setTimeout(() => runManagerApprovalLiveRefresh(activeHomeTab), Math.max(300000, Number(delay) || MANAGER_APPROVAL_LIVE_REFRESH_MS));
    return false;
}
