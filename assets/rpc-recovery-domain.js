function finishOwnerReplay(state, success, value, winner = null) {
    if (state.settled) return;
    state.settled = true;
    clearTimeout(state.timer);
    state.request.signal?.removeEventListener('abort', state.cancel);
    state.controllers.forEach(controller => { if (controller !== winner) controller.abort(); });
    (success ? state.resolve : state.reject)(value);
}

function rejectOwnerAttempt(state, error) {
    if (state.settled) return;
    state.failed += 1;
    state.firstError ||= error;
    if (state.controllers.length === 1 || state.failed === state.controllers.length) {
        finishOwnerReplay(state, false, state.firstError);
    }
}

function dispatchOwnerAttempt(state) {
    if (state.settled) return;
    if (state.request.signal?.aborted) return state.cancel();
    if (!state.hedgeInScope()) return finishOwnerReplay(state, false, Object.assign(new Error('Owner save account changed.'), { code: 'REQUEST_SCOPE_CHANGED' }));
    const controller = new AbortController();
    state.controllers.push(controller);
    const replay = state.controllers.length === 2;
    const options = { ...state.request, signal: controller.signal, ownerReplayRelay: replay, ownerReplayRegion: replay ? 'us-east-1' : undefined };
    state.bridge.fetchRpc(state.baseUrl, state.rpcName, options, state.timeoutMs, 'RPC ' + state.rpcName).then(value => {
        if (replay && !value.ok) return rejectOwnerAttempt(state, Object.assign(new Error('Owner relay unavailable.'), { status: value.status }));
        finishOwnerReplay(state, true, value, controller);
    }, error => rejectOwnerAttempt(state, error));
}

function requestOwnerHedged(options) {
    return new Promise((resolve, reject) => {
        const state = { ...options, resolve, reject, controllers: [], settled: false, timer: null, failed: 0, firstError: null };
        state.cancel = () => finishOwnerReplay(state, false, Object.assign(new Error('Owner save cancelled.'), { code: 'REQUEST_ABORTED' }));
        state.request.signal?.addEventListener('abort', state.cancel, { once: true });
        dispatchOwnerAttempt(state);
        if (!state.settled) state.timer = setTimeout(() => dispatchOwnerAttempt(state), 75);
    });
}

async function dispatchRpcWithRecovery(options) {
    const { bridge, baseUrl, rpcName, body, request, requestOptions, timeoutMs, inScope } = options;
    const replayable = rpcName === 'save_drive_evidence_v3' || (rpcName === 'set_itemcode_default_owners_v1' && body.p_request_id);
    try {
        let response;
        if (rpcName === 'set_itemcode_default_owners_v1' && requestOptions.singleWrite !== true
            && Array.isArray(body.p_itemcodes) && typeof body.p_request_id === 'string') {
            response = await requestOwnerHedged(options);
        } else {
            const init = rpcName === 'save_drive_evidence_v3' ? { ...request, referrerPolicy: 'no-referrer' } : request;
            const label = rpcName === 'save_drive_evidence_v3' ? 'Save row evidence' : 'RPC ' + rpcName;
            response = await bridge.fetchRpc(baseUrl, rpcName, init, timeoutMs, label);
        }
        if (replayable && [408, 429, 500, 502, 503, 504, 546].includes(response.status)) {
            throw Object.assign(new Error('Drive evidence transport unavailable.'), { status: response.status });
        }
        return response;
    } catch (error) {
        const status = Number(error && error.status || 0);
        if (!replayable || !inScope() || [400, 401, 403, 404, 409, 422].includes(status)
            || ['REQUEST_ABORTED', 'DRIVE_SAVE_ABORTED'].includes(error && error.code)) throw error;
        return bridge.fetchRpc(baseUrl, rpcName, { ...request, referrerPolicy: 'no-referrer' }, timeoutMs, 'Idempotent RPC recovery');
    }
}
