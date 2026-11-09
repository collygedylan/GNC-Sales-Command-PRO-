function handleDeferredManualSyncStart(responseData = {}) {
    if (String(responseData.status || '').trim().toLowerCase() !== 'deferred'
        || String(responseData.code || '').trim().toUpperCase() !== 'MANUAL_SYNC_PROCESSOR_BUSY') return false;
    // The backend did not enqueue a run. Discard the optimistic
    // Starting state without running completion side effects.
    manualSyncStatusState = null;
    clearManualSyncStatusPoll();
    syncGoogleScriptButton();
    updateSyncDiagnostics();
    showToast('Sync in progress', 'The import processor is finishing its current work.', false);
    scheduleManualSyncStatusPoll();
    return true;
}
const manualErpContinuationRequests = new Set();
const MANUAL_ERP_PUBLISH_DEADLINE_MS = 70000;
const MANUAL_ERP_SCAN_DEADLINE_MS = 25000;

export function isManualErpScanStalled(status = {}, now = Date.now()) {
    if (!status.active) return false;
    if (status.recoveryDue === true) return true;
    const drive = status.sourceProgress?.drive;
    const scanning = ['queued', 'scanning'].includes(status.currentStage)
        || status.currentStage === 'drive' && !status.continuationCursor?.fileContinuation && (!drive?.stage || ['queued', 'checking'].includes(drive.stage));
    const began = Date.parse(status.recoveryClaimedAt || status.startedAt || '');
    return scanning && Number.isFinite(began) && now - began >= MANUAL_ERP_SCAN_DEADLINE_MS;
}

function manualErpContinuationIsCurrent(state) {
    return state.generation === manualSyncStartGeneration
        && (!state.owner || state.owner === getSupabaseReadIdentityScope())
        && (typeof document === 'undefined' || !document.hidden)
        && (typeof isQuotaBackgroundPollingAllowed !== 'function' || isQuotaBackgroundPollingAllowed());
}

function waitForManualErpContinuation(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestManualErpContinuation(state) {
    const key = JSON.stringify([state.owner, state.runId]);
    if (manualErpContinuationRequests.has(key)) return null;
    manualErpContinuationRequests.add(key);
    try {
        return await postAppFunctionJson(APP_API_FUNCTION_URL, {
            action: 'erp_sync', operation: 'continue', runId: state.runId, maxRowsPerSlice: state.maxRowsPerSlice
        }, { timeoutMs: MANUAL_ERP_PUBLISH_DEADLINE_MS, label: 'Continue cloud sync' });
    } finally {
        manualErpContinuationRequests.delete(key);
    }
}

async function recoverManualErpContinuationDeadline(state) {
    const observed = await postAppFunctionJson(APP_API_FUNCTION_URL,
        { action: 'erp_sync', operation: 'status', autoRelay: false },
        { timeoutMs: 8000, label: 'Sync status' }).catch(() => null);
    if (!manualErpContinuationIsCurrent(state)) return null;
    const status = observed?.data || observed;
    if (status?.runId !== state.runId) return null;
    applyManualSyncStatus(status, { suppressToast: true });
    return status;
}

function isManualErpContinuationDeadline(error) {
    return /AbortError|TimeoutError/.test(String(error?.name || ''))
        || /timed out|timeout|502|503|504|546|ERP_SYNC_CONTINUE_DEADLINE/i.test(String(error?.message || ''));
}

function retryManualErpContinuation(state, error) {
    const transientStatus = getTransientManualErpSliceStatus(error);
    if (transientStatus) {
        if (state.sliceRetryCount >= 6) throw error;
        state.sliceRetryCount += 1;
        state.maxRowsPerSlice = reduceManualErpSliceLimit(state.maxRowsPerSlice);
        return Math.min(250 * state.sliceRetryCount, 1000);
    }
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures > 3) throw error;
    return Math.min(1500 * state.consecutiveFailures, 4000);
}

function applyManualErpContinuationReply(state, response) {
    state.consecutiveFailures = 0;
    state.step += 1;
    const payload = response.data || response;
    const delay = Number(response.retryAfterMs || response.retry_after_ms || payload.retryAfterMs || payload.retry_after_ms || 0);
    if (!delay) state.sliceRetryCount = 0;
    const status = payload.runStatus || payload.durableStatus || payload.statusData
        || (typeof payload.active === 'boolean' ? payload : null);
    const continuation = String(firstNonEmptyValue(response.status, payload.status, '')).trim().toUpperCase();
    const done = continuation !== 'CONTINUE' && status?.active !== true;
    if (status?.runId && status.runId !== state.runId) return { done: true, status: null };
    if (typeof status?.active === 'boolean') applyManualSyncStatus(status, { suppressToast: !done, delayMs: 500 });
    return { done, status, delay: getManualErpContinuationDelay(status || {}, delay) };
}

async function advanceManualErpContinuation(state) {
    let response;
    try {
        response = await requestManualErpContinuation(state);
    } catch (error) {
        if (!manualErpContinuationIsCurrent(state)) return { done: true };
        if (!isManualErpContinuationDeadline(error)) return { delay: retryManualErpContinuation(state, error) };
        const status = await recoverManualErpContinuationDeadline(state);
        return status?.active === false ? { done: true, status } : { delay: 1500 };
    }
    if (!manualErpContinuationIsCurrent(state)) return { done: true };
    if (!response) return { delay: 250 };
    if (!response.ok) {
        const status = getTransientManualErpSliceStatus(response);
        const error = Object.assign(new Error(response.message || response.code || 'ERP_SYNC_CONTINUE_FAILED'), { status });
        return { delay: retryManualErpContinuation(state, error) };
    }
    return applyManualErpContinuationReply(state, response);
}

export async function continueManualErpSync(initialStatus = {}) {
    const runId = String(firstNonEmptyValue(initialStatus.runId, initialStatus.run_id, '')).trim();
    if (!runId) throw new Error('MANUAL_SYNC_RUN_ID_MISSING');
    const state = {
        runId, generation: manualSyncStartGeneration,
        owner: typeof getSupabaseReadIdentityScope === 'function' ? getSupabaseReadIdentityScope() : '',
        step: 0, consecutiveFailures: 0, sliceRetryCount: 0,
        maxRowsPerSlice: Math.max(600, Math.min(2500, Number(initialStatus.maxRowsPerSlice) || 2500))
    };
    const deadline = Date.now() + MANUAL_SYNC_SCRIPT_TIMEOUT_MS;
    while (state.step < 300 && Date.now() < deadline && manualErpContinuationIsCurrent(state)) {
        const result = await advanceManualErpContinuation(state);
        if (result.done) return result.status === undefined ? initialStatus : result.status;
        if (manualErpContinuationIsCurrent(state)) await waitForManualErpContinuation(result.delay);
    }
    // The durable job remains eligible for server or foreground continuation.
    return initialStatus;
}

function isCurrentManualErpStart(start) {
    return start.generation === manualSyncStartGeneration && start.epoch === nativeAuthRecoveryEpoch
        && start.username === String(currentUser || '').trim().toLowerCase()
        && (!start.scope || start.scope === getSupabaseReadIdentityScope());
}

function beginManualErpStart() {
    const queuedAt = new Date().toISOString();
    const start = { queuedAt, generation: ++manualSyncStartGeneration, epoch: nativeAuthRecoveryEpoch,
        username: String(currentUser || '').trim().toLowerCase() };
    manualSyncStartPending = true;
    isRunScriptActive = true;
    window.googleScriptRunInFlight = true;
    applyManualSyncStatus({
        active: true, runId: '', stageOrder: MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT.slice(),
        stageIndex: 0, currentStage: 'queued', currentStageLabel: 'Starting',
        startedAt: queuedAt, updatedAt: queuedAt, message: 'Running sync now...'
    }, { delayMs: 1800, suppressToast: true });
    if (typeof openErpSyncProgressModal === 'function') openErpSyncProgressModal();
    syncGoogleScriptButton();
    showToast('Processing...', 'Starting full manual sync...', false);
    return start;
}

async function authorizeManualErpStart(start) {
    const needsProfile = !nativeAuthProfile?.id;
    if (needsProfile) await loadNativeAuthProfile(true).catch(() => null);
    if (!canRunManualInventoryImport()) await ensureAppApiWriteProxySession();
    if (!isCurrentManualErpStart(start) || !canRunManualInventoryImport()) {
        throw new Error('A verified ERP administrator session is required.');
    }
    if (needsProfile && isQuotaBackgroundPollingAllowed()) openErpSyncProgressModal();
    start.scope = getSupabaseReadIdentityScope();
    const headers = await getNativeAuthRequestHeaders();
    if ((!headers?.Authorization && !getCurrentAppSessionToken()) || !canRunManualInventoryImport() || !isCurrentManualErpStart(start)) {
        throw nativeSessionRecoveryError();
    }
    return headers;
}

function applyManualErpStartResponse(response) {
    if (!response?.ok) throw new Error(response?.message || response?.code || 'ERP_SYNC_START_FAILED');
    const data = response.data || response;
    const status = String(firstNonEmptyValue(response.status, data.status, '')).trim().toLowerCase();
    const message = String(firstNonEmptyValue(data.message, '')).trim();
    if (status === 'deferred' && handleDeferredManualSyncStart(data)) return;
    if (data.ok === false) throw new Error(message || `Manual sync failed (${data.status || 0})`);
    if (response.cloudRelay === true || data.cloudRelay === true) {
        applyManualSyncStatus(data, { delayMs: 500, suppressToast: true });
        showToast('Started', 'Cloud sync started. You can leave the app.');
        return;
    }
    if (status === 'busy' || data.active === true && (data.runId || data.run_id)) {
        applyManualSyncStatus({ ...data, active: true, runId: String(data.runId || data.run_id || '').trim() },
            { delayMs: 500, suppressToast: true });
        showToast('Resuming Sync', message || 'Continuing the active cloud sync.', false);
        return;
    }
    if (['queued', 'continue', 'running'].includes(status)) {
        const startedAt = String(data.startedAt || data.started_at || new Date().toISOString()).trim();
        applyManualSyncStatus({ ...data, active: true, runId: String(data.runId || '').trim(),
            stageOrder: Array.isArray(data.stageOrder) ? data.stageOrder : MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT.slice(),
            stageIndex: 0, currentStage: 'queued', currentStageLabel: 'Queued', startedAt,
            updatedAt: String(data.updatedAt || data.updated_at || startedAt).trim(), message: message || 'Manual sync queued.'
        }, { delayMs: 700, suppressToast: true });
        showToast('Started', message || 'Cloud sync started.');
        return;
    }
    if (typeof data.active !== 'boolean') throw new Error('ERP_SYNC_STATUS_INVALID');
    applyManualSyncStatus(data, { suppressToast: false });
}

function reportManualErpStartFailure(error, start) {
    if (!isCurrentManualErpStart(start) || document.hidden) return;
    if (isManualErpContinuationDeadline(error)) {
        scheduleManualSyncStatusPoll(500);
        return;
    }
    applyManualSyncStatus({ active: false, currentStage: 'request_failed', currentStageLabel: 'Request Failed',
        startedAt: start.queuedAt, finishedAt: new Date().toISOString(),
        error: error?.message || 'Could not start the Supabase import.'
    }, { suppressToast: true });
    showToast('Error', error?.message || 'Could not start the Supabase import.', true);
}

export async function runGoogleAppsScriptTrigger() {
    releaseStaleManualSyncClientStateIfNeeded();
    const recovering = isManualErpScanStalled(manualSyncStatusState || {});
    if (!canViewDashboardSyncStatus() || !recovering && (manualSyncStartPending || window.googleScriptRunInFlight)) return false;
    const start = beginManualErpStart();
    try {
        const authHeaders = await authorizeManualErpStart(start);
        const payload = { action: 'erp_sync', operation: 'start', commandId: crypto.randomUUID(),
            maxAttemptsPerStage: 1, force: true, forceRestart: true, maxRowsPerSlice: 2500 };
        const response = await postAppFunctionJson(APP_API_FUNCTION_URL, payload,
            { timeoutMs: MANUAL_ERP_SCAN_DEADLINE_MS, label: 'Run Script', keepalive: true, nativeHeaders: authHeaders, includeSession: true });
        if (!isCurrentManualErpStart(start)) return false;
        manualSyncStartPending = false;
        applyManualErpStartResponse(response);
    } catch (error) {
        reportManualErpStartFailure(error, start);
    } finally {
        if (start.generation === manualSyncStartGeneration) {
            manualSyncStartPending = false;
            isRunScriptActive = false;
            window.googleScriptRunInFlight = false;
            if (manualSyncStatusState?.active && manualSyncStatusState?.runId) driveManualErpSyncFromStatus(manualSyncStatusState, true);
            syncGoogleScriptButton();
            renderErpSyncProgressModal();
        }
    }
    return false;
}

function getManualErpContinuationDelay(status = {}, retryAfterMs = 0) {
    // A server lease is mandatory backpressure; staging counters alone are not EOF.
    const publicationBackoff = Number(status.retryNotBefore || 0) - Date.now();
    if (publicationBackoff > 0) return Math.min(60000, publicationBackoff);
    if (Number(retryAfterMs) > 0) return Math.min(5000, Number(retryAfterMs));
    return 250;
}
function getTransientManualErpSliceStatus(value = {}) {
    const candidates = [value?.status, value?.statusCode, value?.status_code, value?.payload?.status,
        value?.payload?.statusCode, value?.payload?.status_code, value?.error?.status];
    for (const candidate of candidates) {
        const status = Number(candidate);
        if ([500, 502, 504, 546].includes(status)) return status;
    }
    return 0;
}

function reduceManualErpSliceLimit(current = 2500) {
    const rows = Number(current) || 2500;
    if (rows > 1250) return 1250;
    return 600;
}
