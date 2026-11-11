import {isOperationalTransientError} from '../services/rpc-recovery-domain.js';

export async function fetchActiveRequestLiveRows(selectFields = '*', options = {}) {
            // Legacy request/footer reads share the same document lifetime as
            // verified reads. Reload cancellation is not a missing-view error.
            const signal = options.signal || productionLiveSyncNavigation.signal;
            const requireActiveDocument = () => {
                if (signal.aborted) throw Object.assign(new Error('Request queue read cancelled.'), { code: 'REQUEST_ABORTED' });
            };
            requireActiveDocument();
            const query = buildActiveRequestLiveRowsQuery(selectFields);
            const requestOwner = getSupabaseReadIdentityScope();
            const requestSequence = (fetchActiveRequestLiveRows.sequence || 0) + 1;
            fetchActiveRequestLiveRows.sequence = requestSequence;
            const readOptions = { ...(options && typeof options === 'object' ? options : {}), force_fresh:true, cache:'no-store', signal };
            try {
                const rows = await fetchAllSupabaseRows(ACTIVE_REQUEST_TABLE, query, readOptions);
                requireActiveDocument();
                if (requestOwner !== getSupabaseReadIdentityScope()) throw Object.assign(new Error('Request owner changed.'), {code:'REQUEST_ABORTED'});
                Object.defineProperty(rows, 'requestReadMeta', {value:{owner:requestOwner,sequence:requestSequence,authoritative:selectFields === '*'},configurable:true});
                return rows;
            } catch (error) {
                requireActiveDocument();
                if (error && error.code === 'REQUEST_ABORTED') throw error;
                if (requestOwner !== getSupabaseReadIdentityScope()) throw Object.assign(new Error('Request owner changed.'), {code:'REQUEST_ABORTED'});
                if (isOperationalTransientError(error)) {
                    queueRequestForceRefreshRetry('retained-request-read');
                } else window.GncRuntimeWatchdog?.capture?.(error, 'fetchActiveRequestLiveRows:canonicalPending');
                const retained = (Array.isArray(requestsInventory) ? requestsInventory : []).filter(row => row && !row.REQUEST_HISTORY);
                Object.defineProperty(retained,'requestReadMeta',{value:{owner:requestOwner,sequence:requestSequence,authoritative:false,retained:true}});
                return retained;
            }
        }

export async function reconcileExactPendingRequestsFromCompletedSources(reason = 'request-source-completion') {
    if (pendingRequestSourceCompletionReconcileInFlight || navigator.onLine === false) return false;
    const scope = getSupabaseReadIdentityScope();
    const entries = (requestsInventory || []).filter(isRequestPendingVisible)
        .map(row => ({ row, source:findExactCompletedSourceForPendingRequestRow(row) }))
        .filter(entry => entry.source && isExactLinkedRequestCompletionMatch(entry.source,entry.row));
    if (!entries.length) return false;
    pendingRequestSourceCompletionReconcileInFlight = true;
    let completed = 0;
    try {
        for (const {row,source} of entries.slice(0,80)) {
            if (scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
            const patch = buildLinkedRequestCompletionPayload(source,{},row,{canPersistCompletionUser:true});
            if (!patch) continue;
            const snapshot = captureConfirmedRowEvaluation(row,'req-');
            applyRequestWorkValuesToItem(snapshot.row,patch);
            await saveData(true,'req-',true,snapshot.row,{markDoneConfirmationAccepted:true,markDoneSnapshot:snapshot});
            if (hasConfirmedRequestCompletion(row)) completed++;
            await yieldToUiFrame();
        }
    } finally {
        pendingRequestSourceCompletionReconcileInFlight = false;
    }
    if (completed) persistCurrentCache(false,String(reason));
    return completed > 0;
}

export function findExactCompletedSourceForPendingRequestRow(row) {
    if (!row || !isRequestPendingVisible(row)) return null;
    const source = findLinkedMasterRow(row);
    return source && hasCompletionDateValue(source) && isLinkedRequestCompletionFreshForRequest(source,{},row) ? source : null;
}

export function deferRequestFolderCompletionDelivery(folder) {
    return {sent:false,skipped:true,reason:String(folder || '').trim() ? 'server_folder_completion_owner' : 'missing_folder'};
}


export async function forceRefreshRequestsForView(reason = 'request-view', options = {}) {
            const navigationSeq = navTransitionSeq;
            const safeOptions = options && typeof options === 'object' ? options : {};
            if (isRequestViewReadTerminalForCurrentIdentity() && safeOptions.manualRetry !== true) return false;
            if (safeOptions.manualRetry === true) {
                clearSupabaseReadTerminalDenialsForIdentity();
                requestViewTerminalReadIdentityScope = '';
                clearRequestViewReadFailure();
            }
            if (!currentUser || navigator.onLine === false) return false;
            if (requestViewForceRefreshInFlight) return true;
            const readCooldown = requestViewReadCooldownRemaining();
            if (readCooldown > 0) return false;
            const retryIfInteractive = () => {
                if (safeOptions.allowWhileInteractive || !shouldDeferInteractiveBackgroundWork()) return false;
                queueRequestInteractiveRefresh(reason, safeOptions);
                return true;
            };
            if (retryIfInteractive()) return false;
            const now = Date.now();
            const minInterval = Math.max(0, Number(safeOptions.minIntervalMs ?? REQUEST_VIEW_FORCE_REFRESH_MIN_INTERVAL_MS) || 0);
            if (!safeOptions.force && lastRequestViewForceRefreshAt && (now - lastRequestViewForceRefreshAt) < minInterval) return false;
            requestViewForceRefreshInFlight = true;
            lastRequestViewForceRefreshAt = now;
            try {
                const nativeAdapter = getNativeForegroundRequestRefreshAdapter();
                if (nativeAdapter) return await refreshNativeRequestRows(nativeAdapter,reason,safeOptions,navigationSeq);
                const rows = await fetchActiveRequestLiveRows('*', { force_fresh: true, cache: 'no-store' });
                if (rows.requestReadMeta?.retained || retryIfInteractive()) return false;
                return await commitRefreshedRequestRows(rows,reason,safeOptions,navigationSeq);
            } catch (error) {
                recordRequestViewReadFailure(error);
                return false;
            } finally {
                requestViewForceRefreshInFlight = false;
            }
        }

async function refreshNativeRequestRows(nativeAdapter, reason, safeOptions, navigationSeq) {

                    const owner = getProductionLiveSyncContext();
                    const didRefresh = await productionLiveSyncCoordinator.ensure(nativeAdapter,
                        safeOptions.force === true || safeOptions.manualRetry === true);
                    const currentOwner = getProductionLiveSyncContext();
                    const currentAdapter = getNativeForegroundRequestRefreshAdapter();
                    if (!didRefresh || !isCurrentNavigationTransition(navigationSeq, 'request') || owner.scope !== currentOwner.scope
                        || owner.dataPermissionVersion !== currentOwner.dataPermissionVersion
                        || owner.view !== currentOwner.view || owner.viewKey !== currentOwner.viewKey || !currentAdapter
                        || nativeAdapter.cacheKey !== currentAdapter.cacheKey) return false;
                    // The coordinator owns snapshot validation, cache commits and
                    // rendering. Reapplying its rows through the legacy path can
                    // cancel a verified preview and rebuild the same list twice.
                    await refreshActiveRequestQueueSideData(reason || 'request-force-refresh', {
                        force: safeOptions.force === true,
                        allowWhileInteractive: true,
                        minIntervalMs: REQUEST_QUEUE_SIDE_REFRESH_MIN_INTERVAL_MS
                    });
                    return true;
                }

async function commitRefreshedRequestRows(rows, reason, safeOptions, navigationSeq) {
                const formattedRows = buildDatasetPayload('requests', rows).requestsData;
                requestViewRetryAttempts = 0;
                clearRequestViewReadFailure();
                if (requestViewForceRefreshRetryTimer) clearTimeout(requestViewForceRefreshRetryTimer);
                requestViewForceRefreshRetryTimer = null;
                if (requestViewInteractiveRefreshTimer) clearTimeout(requestViewInteractiveRefreshTimer);
                requestViewInteractiveRefreshTimer = null;
                processAndLoadData({ requestsData: formattedRows });
                await refreshActiveRequestQueueSideData(reason || 'request-force-refresh', {
                    force: safeOptions.force === true,
                    allowWhileInteractive: true,
                    minIntervalMs: REQUEST_QUEUE_SIDE_REFRESH_MIN_INTERVAL_MS
                });
                const state = getDatasetState('requests');
                state.initialLoaded = true;
                state.fullLoaded = true;
                state.lastLoadedAt = new Date().toISOString();
                requestViewLiveSyncSignature = buildRequestLiveSyncSignature(requestsInventory);
                updateFooterRequestBadge();
                schedulePendingRequestSourceCompletionReconcile(24, reason || 'request-force-refresh');
                markViewDirty('request');
                markViewDirty('reports');
                if (isCurrentNavigationTransition(navigationSeq, 'request')) queueInteractiveViewRender('request', false, true, 0, REQUEST_REALTIME_UI_DELAY_MS);
                if (isCurrentNavigationTransition(navigationSeq, 'reports')) queueInteractiveViewRender('reports', false, true, 0, 180);
                persistCurrentCache(false, reason);
                return true;
}
