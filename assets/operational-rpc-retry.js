function assertOperationalRequestCurrent(current, signal) {
    if (signal?.aborted) throw Object.assign(new Error('RPC retry cancelled.'), {code:'REQUEST_ABORTED'});
    if (!current()) throw Object.assign(new Error('RPC account changed.'), {code:'REQUEST_SCOPE_CHANGED'});
}

function createOperationalFetchDeadline(timeoutMs, {signal, visibleTimeout, onInterrupt}) {
    const controller = new AbortController();
    let timer, nativeDeadline, cancelVisibleTimeout;
    const stop = () => {
        clearTimeout(timer);
        cancelVisibleTimeout?.();
        signal?.removeEventListener('abort', interrupt);
        nativeDeadline?.removeEventListener('abort', interrupt);
    };
    const interrupt = () => {
        const error = Object.assign(new Error('Transport interrupted.'), {name:'AbortError'});
        onInterrupt(error);
        controller.abort(signal?.aborted ? signal.reason : error);
        stop();
    };
    if (signal?.aborted) {
        interrupt();
        return {signal:controller.signal, stop};
    }
    signal?.addEventListener('abort', interrupt, {once:true});
    if (visibleTimeout) cancelVisibleTimeout = visibleTimeout(interrupt, timeoutMs);
    else if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        nativeDeadline = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
        nativeDeadline.addEventListener('abort', interrupt, {once:true});
    } else timer = setTimeout(interrupt, timeoutMs);
    return {signal:controller.signal, stop};
}

async function waitForOperationalPrerequisite(read, {signal, current, timeoutMs}) {
    assertOperationalRequestCurrent(current, signal);
    let timer, cancel;
    const deadline = new Promise((_, reject) => {
        cancel = () => reject(Object.assign(new Error('RPC preparation cancelled.'), {code:'REQUEST_ABORTED'}));
        signal?.addEventListener('abort', cancel, {once:true});
        timer = setTimeout(() => reject(Object.assign(new Error('RPC preparation timed out.'), {code:'TRANSPORT_TIMEOUT'})), timeoutMs);
    });
    try {
        const value = await Promise.race([read(), deadline]);
        assertOperationalRequestCurrent(current, signal);
        return value;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

async function readOperationalFailure(response, signal) {
    let timer;
    let cancel;
    try {
        return await Promise.race([
            response.clone().json().catch(() => ({})),
            new Promise(resolve => { timer = setTimeout(() => resolve({}), 1000); }),
            new Promise((_, reject) => {
                cancel = () => reject(Object.assign(new Error('RPC retry cancelled.'), {code:'REQUEST_ABORTED'}));
                signal?.addEventListener('abort', cancel, {once:true});
            })
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

async function runOperationalRpcRetry(send, {safe, current, signal, wait, random = Math.random, isTransient}) {
    const delays = [150,400,900];
    for (let attempt = 0; ; attempt++) {
        assertOperationalRequestCurrent(current, signal);
        try {
            const response = await send();
            assertOperationalRequestCurrent(current, signal);
            if (response.ok || !safe || attempt === delays.length) return response;
            const payload = await readOperationalFailure(response, signal);
            assertOperationalRequestCurrent(current, signal);
            const error = {status:response.status,code:payload.code || payload.sqlState,message:payload.message || payload.error};
            if (!isTransient(error)) return response;
        } catch (error) {
            assertOperationalRequestCurrent(current, signal);
            if (!safe || !isTransient(error) || attempt === delays.length) throw error;
        }
        await wait(delays[attempt] + Math.floor(random() * 50), signal);
    }
}
