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


export async function fetchWithTimeout(url, options = {}, timeoutMs = SUPABASE_WRITE_TIMEOUT_MS, label = 'Request') {
    if (options.signal?.aborted) throw Object.assign(new Error(`${label} cancelled.`), { code: 'REQUEST_ABORTED' });
    const startedView = typeof document !== 'undefined' ? document.body?.dataset?.currentView : '';
    const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
    const cellular = connection?.type === 'cellular' || (!connection?.type && /^(slow-2g|2g|3g|4g|5g)$/.test(connection?.effectiveType));
    if (cellular && startedView && startedView !== 'login' && String(url).startsWith(SUPABASE_URL + '/')) {
        timeoutMs = Math.max(15000, timeoutMs);
    }
    if (options.ownerReplayRelay === true && url === SUPABASE_URL + '/rest/v1/rpc/set_itemcode_default_owners_v1') {
        url = APP_API_FUNCTION_URL; if (options.ownerReplayRegion) { const relayUrl = new URL(url); relayUrl.searchParams.set('forceFunctionRegion', options.ownerReplayRegion); url = relayUrl.href; }
        options = { ...options, headers: Object.fromEntries(Object.entries(options.headers || {}).filter(([name]) => name.toLowerCase() !== 'prefer')), body: JSON.stringify({ ...JSON.parse(options.body), action: 'assigned_owner_save' }) };
    }
    const secureSupabaseResponse = await fetchSupabaseRestViaAppApiIfNeeded(url, options, timeoutMs, label);
    if (secureSupabaseResponse) return secureSupabaseResponse;
    if (options.detachedReclass) return fetchDetachedReclassResponse(url, options, timeoutMs, label);
    // Preparation can outlive the document; never dispatch an already-cancelled request.
    if (options.signal?.aborted) throw Object.assign(new Error(`${label} cancelled.`), { code: 'REQUEST_ABORTED' });
    const controller = new AbortController();
    const externalSignal = options && options.signal ? options.signal : null;
    let externallyAborted = !!(externalSignal && externalSignal.aborted);
    const handleExternalAbort = () => {
        externallyAborted = true;
        try { controller.abort(externalSignal && externalSignal.reason); } catch { controller.abort(); }
    };
    if (externalSignal && !externalSignal.aborted) externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
    else if (externallyAborted) handleExternalAbort();
    const photoTimeout = typeof document !== 'undefined' && /photo|upload/i.test(label);
    const cancelPhotoTimeout = photoTimeout ? startVisiblePhotoTimeout(() => controller.abort(), timeoutMs) : null;
    const timeoutId = photoTimeout ? null : setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await (window.GncLoginTrace?.fetch(url, { ...options, signal: controller.signal, referrerPolicy: "no-referrer" }) ?? fetch(url, { ...options, signal: controller.signal, referrerPolicy: "no-referrer" }));
    } catch (error) {
        if (error && error.name === 'AbortError') {
            const leftView = !photoTimeout && startedView && startedView !== document.body?.dataset?.currentView;
            if (externallyAborted || leftView || (!photoTimeout && typeof document !== 'undefined' && document.hidden)) {
                const aborted = new Error(`${label} cancelled.`);
                aborted.code = 'REQUEST_ABORTED';
                throw aborted;
            }
            const readPage = /^(GET|HEAD)$/i.test(options.method || 'GET') || /\/rest\/v1\/rpc\/(get_|read_|list_)/i.test(String(url));
            if (!readPage && !/watchdog|Suspend Tag/i.test(label)) window.GncRuntimeWatchdog?.observeError?.(label,'TIMEOUT',false,'RPC_FAILURE');
            throw Object.assign(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s`), {code:'TRANSPORT_TIMEOUT'});
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        cancelPhotoTimeout?.();
        if (externalSignal) externalSignal.removeEventListener('abort', handleExternalAbort);
    }
}

export function assertCurrentPhotoUpload(currentOwner, options) {
    if (!currentOwner()) throw staleSupabaseReadScopeError();
    if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) {
        throw Object.assign(new Error('Photo session changed.'), { code:'REQUEST_ABORTED' });
    }
}

export async function getNativeDrivePhotoObject(formData, prefix, masterUid) {
    const file = formData.get('file');
    const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
    const hash = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    const base = 'drive-evidence/' + hex(new TextEncoder().encode(masterUid)) + '/';
    const extension = file.type === 'image/webp' ? 'webp' : 'jpg';
    const filePath = base + 'v2/' + hash + '.' + extension;
    const parts = [
        [base + '_thumbs/v2/' + hash + '-w144.' + extension, formData.get('thumbnail144')],
        [base + '_thumbs/v2/' + hash + '-w320.' + extension, formData.get('thumbnail320')],
        [filePath, file]
    ];
    return { file, filePath, parts, bucketName:PHOTO_BUCKETS[prefix] || PHOTO_BUCKETS.default };
}

export function isTransientPhotoUploadFailure(error) {
    return [408,429,500,502,503,504,546].includes(Number(error?.status)) || error instanceof TypeError
        || /timeout|timed out|network|failed to fetch|connection/i.test(String(error?.message || ''));
}

export async function uploadNativeDrivePhotoPart(path, blob, headers, currentOwner, options) {
    if (!(blob instanceof Blob) || blob.size > 2500000) throw new Error('Optimized photo is invalid.');
    const write = async () => {
        assertCurrentPhotoUpload(currentOwner, options);
        const response = await fetchWithTimeout(SUPABASE_URL + '/storage/v1/object/' + path, {
            method:'POST', headers:{...headers, 'Content-Type':blob.type, 'x-upsert':'true', 'cache-control':'max-age=31536000'},
            referrerPolicy:'no-referrer', body:blob, signal:options.signal
        }, Math.max(30000, Number(options.timeoutMs) || 30000), 'Drive photo storage');
        if (response.ok) return;
        const failure = await response.json().catch(() => ({}));
        if (response.status !== 409 && String(failure.error || failure.code) !== 'Duplicate') {
            throw Object.assign(new Error('Photo storage did not confirm the upload.'), { status:response.status });
        }
    };
    try { await write(); }
    catch (error) {
        if (!isTransientPhotoUploadFailure(error)) throw error;
        await write();
    }
}

export async function uploadDrivePhotoWithNativeSession(formData, options = {}) {
    const prefix = String(formData.get('prefix') || '');
    if (!SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix)) throw new Error('Native photo upload requires a Drive evidence row.');
    const masterUid = String(formData.get('masterUid') || '').trim();
    if (!masterUid) throw new Error('Exact Drive row identity is required.');
    const owner = getSupabaseReadIdentityScope(), epoch = nativeAuthRecoveryEpoch;
    const currentOwner = () => epoch === nativeAuthRecoveryEpoch && owner === getSupabaseReadIdentityScope();
    let headers = await getNativeAuthRequestHeaders();
    assertCurrentPhotoUpload(currentOwner, options);
    if (!headers?.Authorization) headers = await getNativeAuthRequestHeaders(true);
    assertCurrentPhotoUpload(currentOwner, options);
    if (!headers?.Authorization) throw nativeSessionRecoveryError();
    const { file, filePath, parts, bucketName } = await getNativeDrivePhotoObject(formData, prefix, masterUid);
    const state = getDrivePhotoGatewayState();
    try {
        if ((options.attachPhoto && parts.some(([,blob]) => !blob)) || Date.now() < state.storageGatewayCooldownUntil) {
            throw Object.assign(new Error('Storage cooldown.'), { code:'STORAGE_COOLDOWN' });
        }
        await Promise.all(parts.filter(([,blob]) => blob).map(([path,blob]) =>
            uploadNativeDrivePhotoPart(bucketName + '/' + path, blob, headers, currentOwner, options)));
        assertCurrentPhotoUpload(currentOwner, options);
        return { ok:true, publicUrl:SUPABASE_URL + '/storage/v1/object/public/' + bucketName + '/' + filePath, filePath, bucketName };
    } catch (error) {
        assertCurrentPhotoUpload(currentOwner, options);
        if (currentOwner() && state.owner === owner && isTransientPhotoUploadFailure(error)) rememberDrivePhotoGatewayFailure(state);
    }
    const content = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const attachPhoto = options.attachPhoto === true;
    const command = attachPhoto ? {p_workflow:getSecureDriveEvidenceWorkflow(prefix), p_idempotency_key:'photo-' + options.attachmentId} : {};
    const store = auth => fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/' + (attachPhoto ? 'attach_drive_photo_blob_v1' : 'store_drive_photo_blob_v1'), {
        method:'POST', headers:{...auth,'Content-Type':'application/json'}, referrerPolicy:'no-referrer', signal:options.signal,
        body:JSON.stringify({p_path:filePath,p_content:content,p_content_type:file.type,...command})
    }, 30000, 'Database photo recovery');
    assertCurrentPhotoUpload(currentOwner, options);
    let response = await store(headers);
    if (response.status === 401) {
        const failure = await response.clone().json().catch(() => null);
        if (['PGRST301','PGRST303','AUTH_REQUIRED'].includes(failure?.code)) {
            const renewed = await getNativeAuthRequestHeaders(true);
            assertCurrentPhotoUpload(currentOwner, options);
            if (renewed?.Authorization) response = await store(renewed);
        }
    }
    const saved = await response.json();
    assertCurrentPhotoUpload(currentOwner, options);
    if (!response.ok || !saved?.id) throw Object.assign(new Error(saved?.message || 'Photo recovery did not confirm the upload.'),{status:response.status});
    return {ok:true,publicUrl:APP_API_FUNCTION_URL + '?photo_blob=' + saved.id,filePath,fileName:String(formData.get('fileName')||''),bucketName,
        storage:'postgres',...(saved.receipt ? {receipt:{...saved.receipt,writeConfirmed:true}} : {})};
}
