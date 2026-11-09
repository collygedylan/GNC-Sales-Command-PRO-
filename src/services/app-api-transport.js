export async function decodeAppFunctionResponse(response) {
    const version = String(response.headers?.get('x-agdata-latest-version') || response.headers?.get('x-agdata-app-version') || '').trim();
    if (version) void window.forceAgDataVersionUpgrade?.(version, APP_SHELL_VERSION, {reason:'app-api-response'});
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text || null; }
    if (payload?.force_reload && payload.latest_version) void window.forceAgDataVersionUpgrade?.(payload.latest_version, APP_SHELL_VERSION, {reason:'app-api-cutover'});
    return payload;
}

export function reportAppFunctionFailure(action, body, response, responseCode) {
    const preLogin = response.status === 401 && (isLoginScreenVisible() || !getCurrentAppSessionToken());
    const policy = response.status === 403 && /FORBIDDEN|NOT_ENABLED|UNAVAILABLE/.test(responseCode)
        || [409,423].includes(response.status) && /SOURCE_CHANGED|REVISION_CHANGED|REFRESH|NOT_READY/.test(responseCode);
    const reconciling = action === 'request_work' && body.operation === 'save' && response.status === 409;
    if (!action.startsWith('watchdog_') && !preLogin && !reconciling) window.GncRuntimeWatchdog?.observeError?.(action,responseCode + ' HTTP ' + response.status,false,'RPC_FAILURE');
    if (!action.startsWith('watchdog_') && !preLogin && !policy && !reconciling) window.GncRuntimeWatchdog?.record('APP_API_FAILURE', {severity:response.status >= 500 ? 'high' : 'medium',error_message:'App API returned HTTP ' + response.status});
}

export function createAppFunctionError(message, response, payload, responseCode, options) {
    const error = new Error(message);
    error.status = response.status;
    error.requestId = response.headers?.get('x-request-id') || options.requestId || '';
    error.payload = payload;
    error.code = responseCode;
    error.sqlState = String(payload && (payload.sqlState || payload.sqlstate) || '').trim().toUpperCase();
    error.details = payload && typeof payload === 'object' ? String(payload.details || '').trim() : '';
    return error;
}

export function applyAppApiSessionHeaders(headers, nativeHeaders, includeSession = true) {
            if (nativeHeaders?.Authorization) {
                headers.Authorization = nativeHeaders.Authorization;
                return;
            }
            const legacyToken = includeSession && getCurrentAppSessionToken();
            if (legacyToken) headers['x-gnc-session'] = legacyToken;
        }

export async function fetchDetachedReclassResponse(url, options, timeoutMs, label) {
    const { signal, ...request } = options;
    if (signal?.aborted) throw Object.assign(new Error(label + ' was not started.'), { code: 'REQUEST_ABORTED' });
    // Fetch keepalive limits the aggregate outstanding request bodies to 64 KiB.
    // A large worksheet still uses an independent request and durable replay.
    const keepalive = new TextEncoder().encode(request.body || '').byteLength <= 60 * 1024;
    let timer;
    try {
        const response = fetch(url, { ...request, keepalive, referrerPolicy: 'no-referrer' });
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(label + ' confirmation timed out.'),
                { code: 'TRANSPORT_TIMEOUT', outcomeUncertain: true })), timeoutMs);
        });
        return await Promise.race([response, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

async function postReclassRecoveryRpc(payload, options, scope, refresh = false) {
    if (scope !== getSupabaseReadIdentityScope() || options.signal?.aborted) throw staleSupabaseReadScopeError();
    const headers = await getNativeAuthRequestHeaders(refresh);
    if (!headers?.Authorization || scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    const response = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/reclass_transport_v1', {
        method: 'POST', headers, body: JSON.stringify(payload), referrerPolicy: 'no-referrer',
        signal: options.signal, detachedReclass: options.detachedReclass
    }, 5000, 'Reclass recovery');
    if (response.status === 401 && !refresh) return postReclassRecoveryRpc(payload, options, scope, true);
    const result = await response.json();
    if (!response.ok) {
        throw Object.assign(new Error(result.message || 'Reclass recovery failed'), { status: response.status, code: result.code });
    }
    return result;
}

async function waitForReclassRecovery(body, options, scope) {
    let reply = await postReclassRecoveryRpc({ p_command: body }, options, scope);
    const ticket = reply.ticket;
    const until = Date.now() + 22000;
    for (let attempt = 0; reply.pending && attempt < 20 && Date.now() < until; attempt++) {
        await new Promise(resolve => setTimeout(resolve, Math.min(2000, 500 * (attempt + 1))));
        reply = await postReclassRecoveryRpc({ p_ticket: ticket }, options, scope);
    }
    if (scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    if (reply.pending) throw Object.assign(new Error('Reclass confirmation timed out. Your command is retained.'), { status: 504 });
    if (!(reply.status >= 200 && reply.status < 300)) {
        throw Object.assign(new Error(reply.body?.error || 'Reclass was not confirmed'), { status: reply.status, code: reply.body?.code });
    }
    return reply.body;
}

export async function postReclassCommand(body, options = {}) {
    const scope = getSupabaseReadIdentityScope();
    const request = body.action === 'inventory_reclass_move' ? { ...options, signal: undefined, detachedReclass: true } : options;
    try {
        return await postAppFunctionJson(APP_API_FUNCTION_URL, body, request);
    } catch (error) {
        if (request.signal?.aborted || scope !== getSupabaseReadIdentityScope() || !nativeAuthSessionActive
            || !(Number(error.status) >= 500 || /failed to fetch|network|timed? ?out|load failed/i.test(error.message || ''))) throw error;
        return await waitForReclassRecovery(body, request, scope);
    }
}

export async function postAppFunctionJson(url, body, options = {}) {
            if (!isAllowedAppHostname()) throw Object.assign(new Error('Origin not allowed'), { code: 'APP_ORIGIN_DENIED' });
            const safeOptions = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
            const action = String(body?.action || '').trim().toLowerCase();
            const authEpoch = nativeAuthRecoveryEpoch;
            const callOwner = String(currentUser || '').trim().toLowerCase();
            if (PRELOGIN_BACKGROUND_ACTIONS.has(action) && isLoginScreenVisible()) return preLoginBackgroundFallback(body);
            const headers = { 'Content-Type': 'application/json', 'x-client-info': 'agdata/' + APP_VERSION };
            if (SUPABASE_KEY) {
                headers['apikey'] = SUPABASE_KEY;
                headers['Authorization'] = 'Bearer ' + SUPABASE_KEY;
            }
            const nativeHeaders = safeOptions.nativeHeaders || await getNativeAuthRequestHeaders().catch(() => null);
            if (authEpoch !== nativeAuthRecoveryEpoch || callOwner !== String(currentUser || '').trim().toLowerCase()) throw staleSupabaseReadScopeError();
            if (action === 'erp_sync' && !nativeHeaders?.Authorization && !getCurrentAppSessionToken()) throw nativeSessionRecoveryError();
            if (safeOptions.signal?.aborted) throw Object.assign(new Error('App function read cancelled.'), { code: 'REQUEST_ABORTED' });
            const idempotencyKey = String(safeOptions.idempotencyKey || '').trim();
            if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 180);
            if (safeOptions.requestId) headers['x-request-id'] = String(safeOptions.requestId).slice(0, 80);
            applyAppApiSessionHeaders(headers, nativeHeaders, safeOptions.includeSession !== false);
            const detached = action === 'inventory_reclass_move' && safeOptions.detachedReclass;
            const send = detached ? fetchDetachedReclassResponse : fetchWithTimeout;
            const response = await send(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body || {}),
                cache: 'no-store',
                signal: detached ? undefined : safeOptions.signal,
                keepalive: safeOptions.keepalive === true
            }, Number(safeOptions.timeoutMs || 18000), String(safeOptions.label || 'App Function'));
            const payload = await decodeAppFunctionResponse(response);
            if (!response.ok) {
                const message = payload && typeof payload === 'object' ? String(payload.error || payload.message || `Request failed (${response.status})`).trim() : `Request failed (${response.status})`;
                const responseCode = String(payload && (payload.code || payload.sqlstate || payload.sqlState) || '').trim().toUpperCase();
                const authenticatedAction = callOwner && (nativeHeaders?.Authorization || safeOptions.includeSession !== false);
                if (response.status === 401 && authenticatedAction && !safeOptions.authRetried
                    && (!responseCode || responseCode === 'AUTH_REQUIRED') && authEpoch === nativeAuthRecoveryEpoch
                    && callOwner === String(currentUser || '').trim().toLowerCase() && !safeOptions.signal?.aborted) {
                    const refreshed = await getNativeAuthRequestHeaders(true);
                    if (refreshed && authEpoch === nativeAuthRecoveryEpoch && callOwner === String(currentUser || '').trim().toLowerCase()
                        && (action !== 'erp_sync' || canRunManualInventoryImport())) {
                        return postAppFunctionJson(url, body, { ...safeOptions, authRetried:true, nativeHeaders:refreshed, includeSession:false });
                    }
                }
                reportAppFunctionFailure(action,body,response,responseCode);
                throw createAppFunctionError(message,response,payload,responseCode,safeOptions);
            }
            return payload;
        }

