async function fetchActiveRequestLiveRows(selectFields = '*', options = {}) {
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
                window.GncRuntimeWatchdog?.capture?.(error, 'fetchActiveRequestLiveRows:canonicalPending');
                return (Array.isArray(requestsInventory) ? requestsInventory : []).filter((row) => row && !row.REQUEST_HISTORY);
            }
        }

async function reconcileExactPendingRequestsFromCompletedSources(reason = 'request-source-completion') {
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

function findExactCompletedSourceForPendingRequestRow(row) {
    if (!row || !isRequestPendingVisible(row)) return null;
    const source = findLinkedMasterRow(row);
    return source && hasCompletionDateValue(source) && isLinkedRequestCompletionFreshForRequest(source,{},row) ? source : null;
}

function deferRequestFolderCompletionDelivery(folder) {
    return {sent:false,skipped:true,reason:String(folder || '').trim() ? 'server_folder_completion_owner' : 'missing_folder'};
}

