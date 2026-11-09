function clearLogoutUpdateLocks() {
    expireAppUpdateRestore();
    if (window.GncCameraState) {
        Object.assign(window.GncCameraState, { cameraCaptureInFlight: false, startedAt: 0, returnUntil: 0 });
        window.persistCameraCaptureState?.();
    }
    for (const timers of [pendingPhotoPersistTimers, pendingSharedPhotoMasterPersistTimers]) {
        for (const [key, timer] of Object.entries(timers)) {
            clearTimeout(timer);
            delete timers[key];
        }
    }
    pendingPhotoUploads.clear();
    for (const state of rowSaveCoordinatorState.values()) {
        state.pending?.resolve?.({ skipped: true, reason: 'logout' });
        state.pending = null;
    }
    rowSaveCoordinatorState.clear();
}

async function performLogout() {
    setExplicitLogoutMarker();
    clearLogoutUpdateLocks();
    inventoryFieldCountingMode = false;
    destroyFieldCountingIsland();
    destroyCustomerRepMappingView();
    disposeAuraWidget();
    resetRequestRecipientDirectoryCache();
    invalidateNativeAuthRecovery();
    if (typeof resetProductionLiveSync === 'function') resetProductionLiveSync();
    if (typeof resetPoManagementInventoryState === 'function') resetPoManagementInventoryState();
    closeBloomscapesPendingOrders();
    window.GncPhotoHistory?.clear();
    cancelAllDriveEvidenceSaves('logout');
    cleanupRealtime();
    clearChatBackgroundPoll();
    clearManualSyncStatusPoll();
    manualSyncStatusState = null;
    const client = getSupabaseBrowserClient();
    if (client?.auth) await client.auth.signOut().catch(() => {});
    nativeAuthSessionActive = false;
    nativeAuthAccessToken = '';
    destroyHistoricalRequestsIsland();
    nativeAuthProfile = null;
    if (window.BunchNote) BunchNote.reset();
    window.BunchQueueShell?.reset();
    window.SalesWorkspace?.reset();
    window.GncNavigationPreferences?.reset?.();
    navigationPreferencesAccount = '';
    if (window.LocationCode) LocationCode.reset();
    clearCachedNativeAuthProfile();
    clearPersistedLoginSession();
    sessionStorage.clear();
    location.reload();
}
