async function decodeAppFunctionResponse(response) {
    const version = String(response.headers?.get('x-agdata-latest-version') || response.headers?.get('x-agdata-app-version') || '').trim();
    if (version) void window.forceAgDataVersionUpgrade?.(version, APP_SHELL_VERSION, {reason:'app-api-response'});
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text || null; }
    if (payload?.force_reload && payload.latest_version) void window.forceAgDataVersionUpgrade?.(payload.latest_version, APP_SHELL_VERSION, {reason:'app-api-cutover'});
    return payload;
}

function reportAppFunctionFailure(action, body, response, responseCode) {
    const preLogin = response.status === 401 && (isLoginScreenVisible() || !getCurrentAppSessionToken());
    const policy = response.status === 403 && /FORBIDDEN|NOT_ENABLED|UNAVAILABLE/.test(responseCode)
        || [409,423].includes(response.status) && /SOURCE_CHANGED|REVISION_CHANGED|REFRESH|NOT_READY/.test(responseCode);
    const reconciling = action === 'request_work' && body.operation === 'save' && response.status === 409;
    if (!action.startsWith('watchdog_') && !preLogin && !reconciling) window.GncRuntimeWatchdog?.observeError?.(action,responseCode + ' HTTP ' + response.status,false,'RPC_FAILURE');
    if (!action.startsWith('watchdog_') && !preLogin && !policy && !reconciling) window.GncRuntimeWatchdog?.record('APP_API_FAILURE', {severity:response.status >= 500 ? 'high' : 'medium',error_message:'App API returned HTTP ' + response.status});
}

function createAppFunctionError(message, response, payload, responseCode, options) {
    const error = new Error(message);
    error.status = response.status;
    error.requestId = response.headers?.get('x-request-id') || options.requestId || '';
    error.payload = payload;
    error.code = responseCode;
    error.sqlState = String(payload && (payload.sqlState || payload.sqlstate) || '').trim().toUpperCase();
    error.details = payload && typeof payload === 'object' ? String(payload.details || '').trim() : '';
    return error;
}

function applyAppApiSessionHeaders(headers, nativeHeaders, includeSession = true) {
            if (nativeHeaders?.Authorization) {
                headers.Authorization = nativeHeaders.Authorization;
                return;
            }
            const legacyToken = includeSession && getCurrentAppSessionToken();
            if (legacyToken) headers['x-gnc-session'] = legacyToken;
        }

async function postAppFunctionJson(url, body, options = {}) {
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
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body || {}),
                cache: 'no-store',
                signal: safeOptions.signal,
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

