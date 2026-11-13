
function isOperationalTransientError(error) {
    const code = String(error?.code || error?.sqlState || '').toUpperCase();
    const message = String(error?.message || '');
    if (/STALE|CONFLICT|FORBIDDEN|UNAUTHORIZED|ABORTED/.test(code + ' ' + message)) return false;
    return ['55P03','LOCK_TIMEOUT','57014','40001','40P01','TRANSPORT_TIMEOUT'].includes(code)
        || [500,502,503,504,546].includes(Number(error?.status))
        || /lock timeout|lock_not_available|failed to fetch|network|timed out/i.test(message);
}

function operationalRpcIsReplaySafe(name, body = {}) {
    if (/^(get_|read_|list_)/.test(name)) return true;
    if (name === 'unlock_drive_evidence_v1') return !!body.p_master_uid;
    if (name === 'save_drive_evidence_v3') return !!body.p_idempotency_key;
    if (['create_request_batch','create_av_request_batch'].includes(name)) return !!body.client_batch_id;
    return name === 'set_itemcode_default_owners_v1' && !!body.p_request_id;
}

async function waitForOperationalRetry(delay, signal) {
    if (signal?.aborted) throw Object.assign(new Error('RPC retry cancelled.'), {code:'REQUEST_ABORTED'});
    await new Promise((resolve, reject) => {
        const cancel = () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('RPC retry cancelled.'), {code:'REQUEST_ABORTED'}));
        };
        const timer = setTimeout(() => {signal?.removeEventListener('abort',cancel);resolve();},delay);
        signal?.addEventListener('abort',cancel,{once:true});
    });
}

async function retryOperationalRpc(send, {safe, current, signal, wait = waitForOperationalRetry, random = Math.random}) {
    return runOperationalRpcRetry(send, {safe,current,signal,wait,random,isTransient:isOperationalTransientError});
}

function recoverDirectOperationalRead(url, options, send, consumeResponse) {
    const target = String(url?.url || url);
    if (consumeResponse || !target.startsWith(SUPABASE_URL + '/rest/v1/')
        || target.includes('/rest/v1/rpc/') || !/^(GET|HEAD)$/i.test(options.method || 'GET')) return send();
    const owner = getSupabaseReadIdentityScope(), epoch = nativeAuthRecoveryEpoch;
    const current = () => owner === getSupabaseReadIdentityScope() && epoch === nativeAuthRecoveryEpoch;
    return retryOperationalRpc(send, {safe:true, current, signal:options.signal});
}

function isRecoverableOperationalRead(body = {}) {
    return ['dataset_read','inventory_read','manual_sync_status'].includes(body.action)
        || body.action === 'request_work' && body.operation === 'capabilities';
}

function isRecoverableRequestRead(url, options = {}) {
    if (/^(GET|HEAD)$/i.test(options.method || 'GET') || /\/rest\/v1\/rpc\/(get_|read_|list_)/i.test(String(url))) return true;
    if (url !== APP_API_FUNCTION_URL || typeof options.body !== 'string') return false;
    try { return isRecoverableOperationalRead(JSON.parse(options.body)); } catch { return false; }
}

async function prepareRpcAuthorization(rpcName, body, requestOptions) {
            const rpcScope = getSupabaseReadIdentityScope();
            const rpcEpoch = nativeAuthRecoveryEpoch;
            const inScope = () => rpcEpoch === nativeAuthRecoveryEpoch && rpcScope === getSupabaseReadIdentityScope() && !requestOptions.signal?.aborted;
            const headerOptions = {current:inScope, signal:requestOptions.signal,
                timeoutMs:Math.max(15000, Number(requestOptions.timeoutMs) || SUPABASE_WRITE_TIMEOUT_MS)};
            let nativeHeaders = await waitForOperationalPrerequisite(() => getNativeAuthRequestHeaders().catch(() => null), headerOptions);
            if (!nativeHeaders?.Authorization && inScope() && nativeReadRequiresRls()) {
                nativeHeaders = await waitForOperationalPrerequisite(() => getNativeAuthRequestHeaders(true).catch(() => null), headerOptions);
            }
            if (!inScope()) throw staleSupabaseReadScopeError();
            if (requestOptions.requestSubmissionOwnerKey && (requestOptions.requestSubmissionOwnerKey !== getRequestSubmissionOwnerKey()
                || requestOptions.requestSubmissionGeneration !== requestSubmissionGeneration)) {
                throw Object.assign(new Error('Request account changed before dispatch.'), { code: 'REQUEST_SCOPE_CHANGED', hlOrderCommandDispatch: 'not_sent' });
            }
            if (requestOptions.signal?.aborted) throw Object.assign(new Error(`RPC ${rpcName} cancelled.`), { code: 'REQUEST_ABORTED', hlOrderCommandDispatch: 'not_sent' });
            if (!nativeHeaders || !nativeHeaders.Authorization) {
                throw Object.assign(nativeSessionRecoveryError(), { hlOrderCommandDispatch: 'not_sent' });
            }
            let requestBody;
            try { requestBody = JSON.stringify(body || {}); }
            catch (error) { error.hlOrderCommandDispatch = 'not_sent'; throw error; }
            return { inScope, nativeHeaders, requestBody };
        }

async function finishSupabaseRpc(response, rpcName, body, request, timeoutMs, inScope) {
            if (response.status === 401 && inScope()) {
                const failure = await response.clone().json().catch(() => null);
                if (['PGRST301','PGRST303','AUTH_REQUIRED'].includes(failure?.code)) {
                    const fresh = await getNativeAuthRequestHeaders(true);
                    if (!inScope()) throw staleSupabaseReadScopeError();
                    if (fresh?.Authorization) response = await window.GncDatabase.fetchRpc(SUPABASE_URL, rpcName,
                        { ...request, headers:{ ...request.headers, ...fresh }, cache:'no-store', referrerPolicy:'no-referrer' }, timeoutMs, 'Authenticated RPC retry');
                }
            }
            if (!inScope()) throw staleSupabaseReadScopeError();
            if (!response.ok) {
                let responseCode = '';
                try { responseCode = String((await response.clone().json())?.code || '').trim().toUpperCase(); } catch { globalThis.reportHandledRuntimeIssue?.("supabaseRpc", 'HANDLED_OPERATION_FAILURE'); }
                const error = new Error(await getResponseError(response, `${rpcName} failed (${response.status})`));
                error.status = response.status;
                if (responseCode) error.code = responseCode;
                if (!(response.status === 409 && /^save_request_work/.test(rpcName))) window.GncRuntimeWatchdog?.observeError?.(rpcName, responseCode + ' HTTP ' + response.status,false,'RPC_FAILURE',rpcName === 'save_drive_evidence_v3' ? body.p_idempotency_key : '');
                error.hlOrderCommandDispatch = 'response_received';
                throw error;
            }
            if (rpcName === 'set_itemcode_default_owners_v1' && Object.prototype.hasOwnProperty.call(response, '__gncValidatedData')) {
                return redactEvalSensitiveData(response.__gncValidatedData);
            }
            const text = await response.text();
            if (!inScope()) throw staleSupabaseReadScopeError();
            return redactEvalSensitiveData(text ? JSON.parse(text) : null);
        }

async function supabaseRpc(functionName, body = {}, requestOptions = {}) {
            const rpcName = String(functionName || '').trim();
            assertEvalDataSourceAllowed(rpcName);
            if (!rpcName) throw new Error('RPC name is required.');
            if (rpcName === 'get_my_dataset_revisions_v1') return readDatasetRevisionRpc(body, requestOptions);
            const { inScope, nativeHeaders, requestBody } = await prepareRpcAuthorization(rpcName, body, requestOptions);
            if (!inScope()) throw staleSupabaseReadScopeError();
            const timeoutMs = Math.max(1000, Number(requestOptions.timeoutMs) || SUPABASE_WRITE_TIMEOUT_MS);
            if (rpcName === 'save_request_work') {
                const patch = requestCompletionPhotoPatch(body);
                const result = await postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'request_work',
                    operation: rpcName === 'get_request_capabilities' ? 'capabilities' : 'save',
                    requestId: body.request_id, expectedVersion: body.expected_version, patch, complete: body.complete === true
                }, { timeoutMs, signal: requestOptions.signal, label: 'Request work' });
                if (!result?.ok || !result.data) throw new Error(result?.code || 'REQUEST_SAVE_UNCONFIRMED');
                acknowledgeRequestPhotoIntentReceipt(patch,result.data);
                return result.data;
            }
            const request = {
                method: 'POST', ...(['set_itemcode_default_owners_v1','save_drive_evidence_v3'].includes(rpcName) ? { priority: 'high', keepalive: requestBody.length * 3 < 60000 } : {}),
                cache:'no-store', referrerPolicy:'no-referrer',
                headers: {
                    ...nativeHeaders,
                    'Content-Type': 'application/json',
                    'Prefer': ['set_itemcode_default_owners_v1','save_drive_evidence_v3','nursery_command_v23127'].includes(rpcName) ? 'return=minimal' : 'return=representation'
                },
                    body: requestBody,
                signal: requestOptions && requestOptions.signal ? requestOptions.signal : undefined
            };
            const hedgeScope = getSupabaseReadIdentityScope();
            const response = await dispatchRpcWithRecovery({ bridge: window.GncDatabase, baseUrl: SUPABASE_URL,
                rpcName, body, request, requestOptions, timeoutMs, inScope,
                hedgeInScope: () => hedgeScope === getSupabaseReadIdentityScope() });
            return finishSupabaseRpc(response, rpcName, body, request, timeoutMs, inScope);
        }

async function requestAuthorizedDatasetReadPage(table, query = '', limit = 500, offset = 0, options = {}) {
            const config = getAuthorizedDatasetRead(table);
            if (config.dataset === 'suspend_tag' && getCurrentVisibleViewId() === 'home') {
                throw Object.assign(new Error('Suspend refresh deferred until the queue opens.'), {code:'DATASET_READ_RETAINED',retryOnViewChange:true});
            }
            const params = buildAuthorizedDatasetReadParams(table, query, limit, offset);
            const identityScope = getSupabaseReadIdentityScope();
            const permissionVersion = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
            const cacheOwner = JSON.stringify([identityScope, permissionVersion]);
            if (requestAuthorizedDatasetReadPage.cacheOwner !== cacheOwner) {
                requestAuthorizedDatasetReadPage.cacheOwner = cacheOwner;
                requestAuthorizedDatasetReadPage.cache = new Map();
            }
            const cache = requestAuthorizedDatasetReadPage.cache;
            const cacheKey = JSON.stringify([config.dataset, params]);
            const cached = cache.get(cacheKey);
            const cacheable = ['soc', 'cav', 'reserves', 'suspend_tag', 'request_queue', 'active_request'].includes(config.dataset);
            if (cached && ['soc', 'cav', 'reserves'].includes(config.dataset)) params.ifRevision = cached.revision;
            const payload = await loadAuthorizedDatasetPayload(config, params, options);
            if (identityScope !== getSupabaseReadIdentityScope() || permissionVersion !== String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '')) throw staleSupabaseReadScopeError();
            if (payload?.ok === true && payload.data?.retained === true) {
                if (cached) return { ...structuredClone(cached), retained: true }; // Retention never means empty data.
                const direct = await fetchDirectPostgrestReadPage(table, query + '&limit=' + params.limit + '&offset=' + params.offset, { ...options, count: true }).catch(() => null);
                if (identityScope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError(); if (direct && Number.isInteger(direct.total)) return { ...direct, offset: params.offset, limit: params.limit, hasMore: params.offset + direct.rows.length < direct.total };
                throw Object.assign(new Error('Authorized dataset refresh retained the current snapshot.'), { code: 'DATASET_READ_RETAINED' });
            }
            if (payload?.ok === true && payload.data?.up_to_date === true && cached
                && String(payload.data.revision) === cached.revision) return structuredClone(cached);
            if (!payload || payload.ok !== true || !payload.data || !Array.isArray(payload.data.rows)
                || !Number.isInteger(Number(payload.data.total)) || Number(payload.data.total) < 0
                || Number(payload.data.offset) !== params.offset || Number(payload.data.limit) < 1 || Number(payload.data.limit) > 500) {
                const error = new Error(String(payload?.error || payload?.message || `${config.dataset} returned an invalid page.`));
                error.status = Number(payload?.status || 0);
                error.code = String(payload?.code || '').trim().toUpperCase();
                error.payload = payload;
                throw error;
            }
            if (config.dataset === 'suspend_tag' && params.offset === 0 && payload.data.retained !== true) {
                const hasSourceFreshness = Object.prototype.hasOwnProperty.call(payload.data, 'sourceFreshness');
                const sourceFreshness = hasSourceFreshness && payload.data.sourceFreshness && typeof payload.data.sourceFreshness === 'object'
                    ? payload.data.sourceFreshness : {};
                suspendTagSourceFreshness = {
                    scope: identityScope,
                    permissionVersion,
                    loaded: hasSourceFreshness,
                    filename: String(firstNonEmptyValue(sourceFreshness.filename, sourceFreshness.FILENAME, '') || '').trim(),
                    lastUpdated: String(firstNonEmptyValue(sourceFreshness.last_updated, sourceFreshness.lastUpdated, sourceFreshness.LAST_UPDATED, '') || '').trim()
                };
            }
            rememberAuthorizedPageEvidence(payload.data, config, cache, cacheKey, cacheable, identityScope, permissionVersion);
            return payload.data;
        }

async function loadAuthorizedDatasetPayload(config, params, options) {
            let payload;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    payload = await postAppFunctionJson(APP_API_FUNCTION_URL, {
                        action: 'dataset_read', dataset: config.dataset, params
                    }, {
                        timeoutMs: Number(options.timeoutMs) || SUPABASE_READ_TIMEOUT_MS,
                        signal: options.signal,
                        label: `${config.dataset} data`
                    });
                    break;
                } catch (error) {
                    if (attempt === 0 && isInventoryRevisionAdoptionError(error) && !options.signal?.aborted) continue;
                    throw error;
                }
            }
    return payload;
}

function rememberAuthorizedPageEvidence(data, config, cache, cacheKey, cacheable, identityScope, permissionVersion) {
            const inventoryRevision = String(data.inventoryRevision || data.rows.find(row => row?.loc_on_hand_revision || row?.LOC_ON_HAND_REVISION)?.loc_on_hand_revision || data.rows.find(row => row?.LOC_ON_HAND_REVISION)?.LOC_ON_HAND_REVISION || '');
            if (inventoryRevision && acceptCardLocationOnHandSourceReceipt(identityScope, permissionVersion, inventoryRevision)) {
                data.rows.forEach(row => stampCardLocationOnHandReceipt(row, identityScope, permissionVersion, inventoryRevision));
            }
            if (cacheable && (['suspend_tag', 'request_queue', 'active_request'].includes(config.dataset) || /^\d+$/.test(String(data.revision || '')))) {
                cache.delete(cacheKey);
                cache.set(cacheKey, structuredClone(data));
                while (cache.size > 32) cache.delete(cache.keys().next().value);
            }
}

function hasValidCommunicationFilters(table, query) {
    if (!['ph_chat_conversations','ph_chat_participants','ph_chat_messages'].includes(table)) return true;
    for (const [key, value] of new URLSearchParams(query)) {
        if (!['id','conversation_id','username'].includes(key)) continue;
        if (/^eq\.(?:null|undefined|\s*)$/i.test(value) || /^in\.\([\s,]*\)$/.test(value)) return false;
        if (value.startsWith('in.(') && value.slice(4,-1).split(',').some(id => !id.trim() || /^(null|undefined)$/i.test(id.trim()))) return false;
    }
    return true;
}

async function chatApiGet(table, query = 'select=*', label = 'Chat', options = {}) {
            const safeTable = normalizeAppTableName(table);
            if (!hasValidCommunicationFilters(safeTable, query)) return [];
            const readKey = `legacy:${safeTable}:${String(query || '').trim()}`;
            return await withProductionLiveSyncSignal(options.signal || null, (signal) => runDedupeSupabaseRead(readKey, ({ signal: readSignal }) => runAppApiSupabaseWrite(safeTable, 'GET', null, query, {
                timeoutMs: SUPABASE_READ_TIMEOUT_MS, label,
                signal: readSignal
            }), { signal }));
        }


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
    const options = { ...state.request, signal:controller.signal, cache:'no-store', referrerPolicy:'no-referrer',
        ownerReplayRelay:replay, ownerReplayRegion:replay ? 'us-east-1' : undefined };
    state.bridge.fetchRpc(state.baseUrl, state.rpcName, options, state.timeoutMs, 'RPC ' + state.rpcName).then(value => {
        if (!state.hedgeInScope()) return finishOwnerReplay(state, false, Object.assign(new Error('Owner save account changed.'), {code:'REQUEST_SCOPE_CHANGED'}));
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

async function dispatchRpcAttemptWithRecovery(options) {
    const { bridge, baseUrl, rpcName, body, requestOptions, timeoutMs, inScope } = options;
    const request = {...options.request, recoverableRpcAttempt:true};
    const replayable = ['save_drive_evidence_v3','set_itemcode_default_owners_v1'].includes(rpcName)
        && operationalRpcIsReplaySafe(rpcName, body);
    if (replayable && rpcName === 'set_itemcode_default_owners_v1' && requestOptions.singleWrite !== true
        && Array.isArray(body.p_itemcodes) && typeof body.p_request_id === 'string') return requestOwnerHedged(options);
    try {
        const init = {...request, cache:'no-store', referrerPolicy:'no-referrer'};
        const label = rpcName === 'save_drive_evidence_v3' ? 'Save row evidence' : 'RPC ' + rpcName;
        const response = await bridge.fetchRpc(baseUrl, rpcName, init, timeoutMs, label);
        if (replayable && [408, 429, 500, 502, 503, 504, 546].includes(response.status)) {
            throw Object.assign(new Error('Drive evidence transport unavailable.'), { status: response.status });
        }
        return response;
    } catch (error) {
        const status = Number(error && error.status || 0);
        if (!replayable || !inScope() || [400, 401, 403, 404, 409, 422].includes(status)
            || ['REQUEST_ABORTED', 'DRIVE_SAVE_ABORTED'].includes(error && error.code)) throw error;
        return bridge.fetchRpc(baseUrl, rpcName, { ...request, cache:'no-store', referrerPolicy: 'no-referrer' }, timeoutMs, 'Idempotent RPC recovery');
    }
}

async function dispatchRpcWithRecovery(options) {
    try {
        return await retryOperationalRpc(() => dispatchRpcAttemptWithRecovery(options), {
            safe: !['save_drive_evidence_v3','set_itemcode_default_owners_v1'].includes(options.rpcName)
                && operationalRpcIsReplaySafe(options.rpcName, options.body),
            current: options.inScope, signal: options.request.signal
        });
    } catch (error) {
        if (options.inScope() && !options.request.signal?.aborted) {
            globalThis.window?.GncRuntimeWatchdog?.observeError?.(options.rpcName,error.code || 'TRANSPORT_FAILURE',false,'RPC_FAILURE');
        }
        throw error;
    }
}
