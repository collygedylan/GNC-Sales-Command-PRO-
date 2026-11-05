        async function waitForInteractiveOwnerWrites(url, init = {}) {
            if (String(init.method || 'GET').toUpperCase() !== 'GET' || !/\/rest\/v1\/(?:ph_master_inventory|ph_inventory_row_assignments|ph_warehouse_assigned_items)(?:\?|$)/.test(String(url))) return;
            if (typeof managerAssignedColumnState === 'undefined') return;
            const owner=managerAssignedColumnState;
            while(owner===managerAssignedColumnState && (owner.defaultPending?.size || Date.now()-Number(owner.ownerWriteAt||0)<350)) {
                if(init.signal?.aborted)throw Object.assign(new Error('Background inventory read cancelled.'),{code:'REQUEST_ABORTED'});
                await new Promise(resolve=>setTimeout(resolve,25));
            }
        }

function getDrivePhotoGatewayState() {
    const owner = getSupabaseReadIdentityScope();
    const state = uploadDrivePhotoWithNativeSession.state || (uploadDrivePhotoWithNativeSession.state = {});
    if (state.owner !== owner) {
        state.owner = owner; state.storageGatewayCooldownUntil = 0; state.warmAt = 0; state.warmPromise = null;
        try {
            const until = Number(localStorage.getItem('agdata_storage_gateway_cooldown_until_v1'));
            if (Number.isFinite(until) && until > Date.now() && until <= Date.now() + 30 * 60 * 1000) state.storageGatewayCooldownUntil = until;
        } catch (_) { /* Storage-disabled browsers retain the in-memory circuit. */ }
    }
    return state;
}

function rememberDrivePhotoGatewayFailure(state) {
    state.storageGatewayCooldownUntil = Date.now() + 30 * 60 * 1000;
    try { localStorage.setItem('agdata_storage_gateway_cooldown_until_v1', String(state.storageGatewayCooldownUntil)); } catch (_) {}
}

async function warmDrivePhotoSaveForRow(item) {
    const uid = String(item?.UNIQUE_ID || item?.unique_id || '').trim();
    if (!uid) return;
    const state = getDrivePhotoGatewayState(), owner = state.owner;
    if (state.warmPromise || (state.warmAt && Date.now() - state.warmAt < 60000)) return state.warmPromise;
    state.warmAt = Date.now();
    const work = (async () => {
        const headers = await getNativeAuthRequestHeaders();
        if (!headers?.Authorization || owner !== getSupabaseReadIdentityScope()) return;
        getPhotoOptimizerWorker();
        const uidHex = Array.from(new TextEncoder().encode(uid), value => value.toString(16).padStart(2, '0')).join('');
        const p_name = 'drive-evidence/' + uidHex + '/test/v2/' + '0'.repeat(64) + '.jpg';
        const warm = [fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/attach_drive_photo_blob_v1', {method:'OPTIONS',headers:{...headers,'Content-Type':'application/json'},referrerPolicy:'no-referrer'}, 1200, 'Photo transport warm-up'),
            fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/can_upload_drive_evidence_v23115', {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_name}),referrerPolicy:'no-referrer'}, 25000, 'Photo authorization warm-up')];
        if (typeof OffscreenCanvas === 'function') warm.push(Promise.resolve().then(async () => {
            const canvas = new OffscreenCanvas(1280, 960);
            canvas.getContext('2d').fillRect(0, 0, 1280, 960);
            await optimizePhotoBlobForUpload(await canvas.convertToBlob({type:'image/jpeg',quality:0.82}), 'warm.jpg');
        }));
        if (Date.now() >= state.storageGatewayCooldownUntil) {
            const original = resolveCanonicalPhotoUrls(item, 'drive').find(url => url.startsWith(SUPABASE_URL + '/storage/v1/object/public/'));
            const healthUrl = original || SUPABASE_URL + '/storage/v1/status';
            warm.push(fetchWithTimeout(healthUrl, {method:'HEAD',cache:'no-store',referrerPolicy:'no-referrer'}, 900, 'Photo Storage health')
                .then(response => { if (response.status === 504 && state.owner === owner) rememberDrivePhotoGatewayFailure(state); })
                .catch(error => { if (state.owner === owner && /timeout|timed out/i.test(String(error?.message || ''))) rememberDrivePhotoGatewayFailure(state); }));
        }
        await Promise.allSettled(warm);
    })().catch(() => {}).finally(() => { if (state.owner === owner && state.warmPromise === work) state.warmPromise = null; });
    state.warmPromise = work;
    return work;
}

async function uploadDrivePhotoWithNativeSession(formData, options = {}) {
            const prefix = String(formData.get('prefix') || '');
            if (!SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix)) throw new Error('Native photo upload requires a Drive evidence row.');
            const masterUid = String(formData.get('masterUid') || '').trim();
            if (!masterUid) throw new Error('Exact Drive row identity is required.');
            const owner = getSupabaseReadIdentityScope();
            const epoch = nativeAuthRecoveryEpoch;
            const currentOwner = () => epoch === nativeAuthRecoveryEpoch && owner === getSupabaseReadIdentityScope();
            let headers = await getNativeAuthRequestHeaders();
            if (currentOwner() && !headers?.Authorization && !options.signal?.aborted && (!options.isCurrent || options.isCurrent())) {
                headers = await getNativeAuthRequestHeaders(true);
            }
            if (!currentOwner()) throw staleSupabaseReadScopeError();
            if (!headers?.Authorization) throw nativeSessionRecoveryError();
            if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw Object.assign(new Error('Photo session changed.'), { code: 'REQUEST_ABORTED' });
            const file = formData.get('file');
            const bytes = await file.arrayBuffer();
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
            const uidHex = Array.from(new TextEncoder().encode(masterUid), value => value.toString(16).padStart(2, '0')).join('');
            const extension = file.type === 'image/webp' ? 'webp' : 'jpg';
            const bucketName = PHOTO_BUCKETS[prefix] || PHOTO_BUCKETS.default;
            const base = 'drive-evidence/' + uidHex + '/';
            const filePath = base + 'v2/' + hash + '.' + extension;
            const parts = [[base + '_thumbs/v2/' + hash + '-w144.' + extension, formData.get('thumbnail144')],
                [base + '_thumbs/v2/' + hash + '-w320.' + extension, formData.get('thumbnail320')], [filePath, file]];
            if (!currentOwner()) throw staleSupabaseReadScopeError();
            const state = getDrivePhotoGatewayState();
            try {
            if ((options.attachPhoto && (!formData.get('thumbnail144') || !formData.get('thumbnail320'))) || Date.now() < state.storageGatewayCooldownUntil) throw Object.assign(new Error('Storage cooldown.'), { code: 'STORAGE_COOLDOWN' });
            await Promise.all(parts.map(async ([objectPath, blob]) => {
                if (!(blob instanceof Blob) || blob.size > 2500000) throw new Error('Optimized photo is invalid.');
                if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw Object.assign(new Error('Photo session changed.'), { code: 'REQUEST_ABORTED' });
                const response = await fetchWithTimeout(SUPABASE_URL + '/storage/v1/object/' + bucketName + '/' + objectPath, {
                    method: 'POST', headers: { ...headers, 'Content-Type': blob.type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
                    referrerPolicy: 'no-referrer', body: blob, signal: options.signal
                }, Math.min(900, Number(options.timeoutMs || 900)), 'Drive photo storage');
                if (!response.ok) {
                    const failure = await response.json().catch(() => ({}));
                    if (response.status !== 409 && String(failure.error || failure.code) !== 'Duplicate') throw Object.assign(new Error('Photo storage did not confirm the upload.'), { status: response.status });
                }
            }));
            } catch (error) {
                if (options.signal?.aborted || (options.isCurrent && !options.isCurrent()) || error?.code === 'REQUEST_ABORTED') throw error;
                if (state.owner === owner && (error?.status === 504 || /timeout|timed out/i.test(String(error?.code || '') + ' ' + String(error?.message || '')))) {
                    rememberDrivePhotoGatewayFailure(state);
                }
                // The database repeats exact-row authorization; Storage quota cannot bypass it.
                const content = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
                const attachPhoto = options.attachPhoto === true;
                const store = auth => fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/' + (attachPhoto ? 'attach_drive_photo_blob_v1' : 'store_drive_photo_blob_v1'), {
                    method:'POST', headers:{...auth,'Content-Type':'application/json'}, referrerPolicy:'no-referrer', signal:options.signal,
                    body:JSON.stringify({p_path:filePath,p_content:content,p_content_type:file.type,...(attachPhoto ? {p_workflow:prefix === 'ssn-' ? 'season' : prefix === 'na-' ? 'notes' : 'location',p_idempotency_key:'photo-' + options.attachmentId} : {})})
                }, 25000, 'Database photo recovery');
                const current = () => currentOwner() && !options.signal?.aborted && (!options.isCurrent || options.isCurrent());
                if (!current()) throw staleSupabaseReadScopeError();
                let response = await store(headers);
                if (response.status === 401 && current()) {
                    const failure = await response.clone().json().catch(() => null);
                    if (['PGRST301','PGRST303','AUTH_REQUIRED'].includes(failure?.code)) {
                        const renewed = await getNativeAuthRequestHeaders(true);
                        if (!current()) throw staleSupabaseReadScopeError();
                        if (renewed?.Authorization) response = await store(renewed);
                    }
                }
                const saved = await response.json();
                if (!response.ok || !saved?.id) throw Object.assign(new Error(saved?.message || 'Photo recovery did not confirm the upload.'),{status:response.status});
                return {ok:true,publicUrl:APP_API_FUNCTION_URL + '?photo_blob=' + saved.id,filePath,fileName:String(formData.get('fileName')||''),bucketName,storage:'postgres',...(saved.receipt ? {receipt:{...saved.receipt,writeConfirmed:true}} : {})};
            }
            return { ok: true, publicUrl: SUPABASE_URL + '/storage/v1/object/public/' + bucketName + '/' + filePath, filePath, bucketName };
        }

function getManagerAssignableOwnerUsers() {
            const state = getManagerAssignedColumnState();
            const warehouse = typeof warehouseAssignedItemsInventory === 'undefined' ? null : warehouseAssignedItemsInventory;
            const inventory = typeof fullInventory === 'undefined' ? null : fullInventory;
            const cached = state.rosterSources;
            if (!cached || cached.warehouse !== warehouse || cached.inventory !== inventory || cached.rows !== state.rows
                || cached.defaults !== state.defaultOwnersByCode || cached.epoch !== state.dataEpoch) {
                const existing = new Set();
                for (const source of [warehouse, inventory, state.rows, state.defaultOwnersByCode?.values()]) {
                    for (const row of source || []) {
                        for (const raw of [row.ASSIGNEDTO, row.assignedto, row.DEFAULT_ASSIGNEDTO, row.default_assignedto]) {
                            if (raw) existing.add(raw);
                        }
                    }
                }
                state.rosterSources = {warehouse, inventory, rows:state.rows, defaults:state.defaultOwnersByCode,
                    epoch:state.dataEpoch, owners:new Set([...existing].map(normalizeEvalAssignableUser).filter(Boolean))};
            }
            const existingOwners = state.rosterSources.owners;
            const matrixEvaluators = (globalThis.GncUserAccessControl?.state?.userAccess || [])
                .filter(entry => /^(eval|evaluator)$/i.test(String(entry.role || '').trim())).map(entry => entry.username);
            const directory = [...getAssignableAppUserOptions().map(entry => entry.username), ...matrixEvaluators];
            return Array.from(new Set([...directory, ...EVAL_ASSIGNMENT_ROSTER_USERS, ...evalAssignableUsers, ...existingOwners]
                .map(normalizeEvalAssignableUser).filter(user => user && (existingOwners.has(user) || (user !== 'ellen_ward' && !EVAL_TASK_INACTIVE_USERS.has(user))))))
                .sort((a, b) => a.localeCompare(b));
        }

        function setManagerAssignedViewMode(value = 'unique') {
            getManagerAssignedColumnState().viewMode = value === 'rows' ? 'rows' : 'unique';
            scheduleManagersRender(true);
            return false;
        }

        function setManagerAssignedPlantGroupFilter(value = '') {
            const state = getManagerAssignedColumnState();
            if (value) state.filters.PLANTGROUPCODE = [String(value).trim().toLowerCase().replace(/[ _]+/g, '_')];
            else delete state.filters.PLANTGROUPCODE;
            scheduleManagersRender(true);
            return false;
        }

        function selectAllFilteredManagerAssignedItems(checked) {
            getManagerAssignedSelectionSnapshot().rows.forEach(row => {
                const code = buildManagerEvalAssignmentKey(row.ITEMCODE);
                if (code) { if (checked) managerEvalAssignmentSelection.add(code); else managerEvalAssignmentSelection.delete(code); }
            });
            updateManagerAssignedItemsView();
            scheduleManagersRender(true);
            return false;
        }

function getCommittedDriveEvidenceReceipt(result, item) {
    if (!result || result.ok !== true || !result.row || typeof result.row !== 'object') return null;
    const row = result.row;
    const masterUid = String(firstNonEmptyValue(item && item.UNIQUE_ID, item && item.unique_id, item && item.master_uid, item && item.uid, '') || '').trim();
    if (!masterUid || String(row.unique_id || '').trim() !== masterUid
        || !['itemcode', 'locationcode', 'lotcode'].every(key => String(row[key] || '').trim().toUpperCase()
            === String(firstNonEmptyValue(item && item[key.toUpperCase()], item && item[key], '') || '').trim().toUpperCase())) {
        throw Object.assign(new Error('DRIVE_ROW_IDENTITY_MISMATCH'), { code: 'DRIVE_ROW_IDENTITY_MISMATCH', driveEvidenceConflict: true });
    }
    return { ...result, canonicalConfirmed: true, writeConfirmed: true };
}

function ensurePhotoTakenDateBadges(root = document) {
            const candidates = [];
            if (root && root.nodeType === 1 && root.matches && root.matches('img')) candidates.push(root);
            if (root && root.querySelectorAll) candidates.push(...root.querySelectorAll('img'));
            candidates.forEach((image) => {
                if (!image || image.closest('.photo-modal-slide')) return;
                const rawUrl = String(image.getAttribute('data-full-src') || image.getAttribute('src') || image.currentSrc || '').trim();
                const label = resolveAndFormatPhotoDate(null, rawUrl);
                if (!label) return;
                const host = image.closest('.app-inline-thumb-column, .app-av-catalog-media')
                    || image.closest('.eval-work-photo-thumb, .historical-requests__photo, button, .app-inline-thumb-box') || image.parentElement;
                if (!host || host.querySelector('.photo-thumb-date')) return;
                host.classList.add('photo-date-badge-host');
                host.insertAdjacentHTML('beforeend', `<span class="photo-thumb-date" data-photo-taken-date="${esc(label)}">${esc(label)}</span>`);
            });
        }

function getEditorLocMatchQtyValue(item = null, matchValue = '') {
            if (!item) return null;
            if (typeof isDockSuspendDcRequestMirrorRow === 'function' && isDockSuspendDcRequestMirrorRow(item)) {
                return calculateDockSuspendDcRequestLocMatchQty(item, matchValue);
            }
            const liveRow = typeof findLinkedMasterRow === 'function' ? findLinkedMasterRow(item) : null;
            const row = liveRow || item;
            const rawPct = String(matchValue ?? '').trim();
            const pct = Number(rawPct.replace(/%$/, ''));
            if (row.PHOTO_MATCH_PTR_AVAILABLE_KNOWN === false || !/^(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(rawPct) || pct > 100) return null;
            if (pct === 0) return 0;
            const available = parseAppNumber(firstNonEmptyValue(row.PTRAVAILABLE,row.ptravailable,row.available,row.AVAILABLE,row.ptr_available,''));
            if (available != null) {
                const baseline = firstNonEmptyValue(row.eval_baseline_available,row.EVAL_BASELINE_AVAILABLE,row.initial_loc_photo_match,row.INITIAL_LOC_PHOTO_MATCH,row.initial_photo_match_qty,row.INITIAL_PHOTO_MATCH_QTY,'');
                const hasOnHand = [row.PTRONHAND,row.ptronhand,row.ON_HAND,row.on_hand,row.onhand,row.ONHAND].some(value => Number(value)>0);
                if (String(baseline ?? '').trim()==='' && !hasOnHand) return Math.round(Math.max(0,available)*pct/100);
                const savedPct = parseAppNumber(firstNonEmptyValue(row.LOC_MATCH_PCT,row.loc_match_pct,row.MATCH,row.match,''));
                const draft = pct !== savedPct ? {eval_baseline_available:Math.max(0,available),initial_loc_photo_match:Math.round(Math.max(0,available)*(pct||0)/100)} : {};
                return calculateLiveLocPhotoMatch({...row,...draft,LOC_MATCH_PCT:pct,loc_match_pct:pct,MATCH:pct,match:pct});
            }
            const stocks = [row, item].flatMap(value => [value.PTRONHAND, value.ptronhand, value.on_hand, value.onhand,
                value.onHand, value.qty_on_hand, value.oh, value.PTR_ON_HAND, value.ptr_on_hand,
                value.PTRAVAILABLE, value.ptravailable]).map(parseAppNumber).filter(value => value != null);
            const onHand = stocks.find(value => value > 0) ?? stocks[0]
                ?? (typeof getCardLocationOnHandValue === 'function' ? parseAppNumber(getCardLocationOnHandValue(row)) : null);
            return calculateLocMatchQtyValue({ ...row, PTRAVAILABLE: onHand == null ? '' : onHand }, matchValue);
        }

async function postPhotoUploadWithTransientRetry(formData, options = {}) {
            const delays = [500, 1200, 2500];
            const transient = error => {
                if (['REQUEST_ABORTED', 'DATASET_READ_SCOPE_CHANGED', 'PASSWORD_CHANGE_REQUIRED'].includes(String(error && error.code || '').toUpperCase())
                    || String(error && error.name || '') === 'AbortError') return false;
                const status = Number(error && error.status) || 0;
                return status === 500 || status === 502 || status === 503 || status === 504 || status === 546
                    || error instanceof TypeError
                    || /failed to fetch|network ?error|connection (?:reset|closed)|timed? ?out|temporarily unavailable/i.test(String(error && error.message || error || ''));
            };
            for (let attempt = 0; ; attempt += 1) {
                if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) {
                    throw Object.assign(new Error('Photo session changed.'), { code: 'REQUEST_ABORTED' });
                }
                try {
                    return await postAppFunctionFormData(APP_API_FUNCTION_URL, formData, {
                        timeoutMs: Math.max(1000, Number(options.timeoutMs) || SUPABASE_UPLOAD_TIMEOUT_MS),
                        signal: options.signal, isCurrent: options.isCurrent, label: 'Secure photo upload'
                    });
                } catch (error) {
                    if (attempt === 0 && !['REQUEST_ABORTED', 'PASSWORD_CHANGE_REQUIRED'].includes(String(error?.code || '')) && error?.name !== 'AbortError' && (typeof navigator === 'undefined' || navigator.onLine !== false) && typeof formData?.get === 'function' && SECURE_DRIVE_EVIDENCE_PREFIXES.has(String(formData.get('prefix') || ''))) {
                        try { return await uploadDrivePhotoWithNativeSession(formData, options); }
                        catch (fallbackError) {
                            if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw fallbackError;
                        }
                    }
                    if (attempt >= delays.length || !transient(error)) throw error;
                    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                }
            }
        }

        function applySuspendTagInventoryReceipt(result, scope, identity = null) {
            if (scope !== getSupabaseReadIdentityScope()) return false;
            const rows = Array.isArray(result?.inventoryRows) ? result.inventoryRows : result?.inventoryRow ? [result.inventoryRow] : [];
            let applied = false;
            for (const row of rows) {
                if (!row?.unique_id || !row.itemcode || !row.locationcode || isFalseBlockLocation(row.locationcode)) continue;
                if (identity && (rows.length !== 1 || !matchesSuspendTagInventoryIdentity(row, identity))) continue;
                const target = Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toUpperCase(),value]));
                target.SOURCE_TABLE = 'ph_master_inventory';
                reconcileConfirmedDriveEvidence({ok:true,code:'SAVED',canonicalConfirmed:true,row,locationRows:[row]}, target, 'req-', {scope,photoOnly:true,preserveDetailDraft:true});
                const state = getManagerAssignedColumnState();
                if (state.noteScope !== scope) state.locationSalesNotes = new Map();
                state.noteScope = scope;
                const notes = state.locationSalesNotes ||= new Map();
                const code = getRequestItemCodeOptionItemCode(target);
                const prior = notes.get(code) || [];
                const previous = prior.find(note => note.unique_id === row.unique_id);
                notes.set(code, [...prior.filter(note => note.unique_id !== row.unique_id),
                    {...previous,...row,pick_note:row.pic_note,loc_match_pct:row.match}]);
                applied = true;
            }
            return applied;
        }
        async function publishRowEvaluationToMasterAndNotes(item, patch, options = null) {
            if (!options) return runSuspendTagRowCommand('save', item, patch, getDockSuspendCompletionRevision(item), {requireInventoryReceipt:true});
            const scope = options.scope || getSupabaseReadIdentityScope();
            const result = options.receipt || await saveSecureDriveEvidence(item, options.prefix, patch, options.complete, options.baseline);
            const applied = reconcileConfirmedDriveEvidence(result,item,options.prefix,{scope, preserveDetailDraft:options.preserveDetailDraft === true});
            return {result,applied};
        }

        async function publishFlyerInventoryEvidence(item, payload = {}) {
            const master = getMasterPhotoSyncItem(item) || findLinkedMasterRow(item);
            if (!master || String(master.SOURCE_TABLE || 'ph_master_inventory') !== 'ph_master_inventory') throw new Error('Exact Flyer inventory row is required.');
            const value = (flyer, normal) => firstNonEmptyValue(item[flyer],item[normal],'');
            const evidence = {spec:value('FLYER_SPEC','SPEC'),caliper:value('FLYER_CALIPER','CALIPER'),av_note:value('FLYER_AV_NOTE','AV_NOTE'),match:value('FLYER_MATCH','MATCH'),pick_note:value('FLYER_PICK','PICK'),comments:firstNonEmptyValue(payload.sales_note,item.SALES_NOTE,''),photo_link:value('FLYER_PHOTO_LINK','PHOTO_LINK'),photo_name:value('FLYER_PHOTO_NAME','PHOTO_NAME')};
            const scope=getSupabaseReadIdentityScope();
            const result=await saveSecureDriveEvidence(master,'lsn-',evidence,false,buildSecureDriveEvidenceBaseline(master));
            reconcileConfirmedDriveEvidence(result,master,'flyer-',{scope,preserveDetailDraft:true});
            return result;
        }

        function resolveUserAccessMatrix(username = currentUser) {
            const same = normalizeEvalAssignableUser(username) === normalizeEvalAssignableUser(currentUser);
            return window.GncUserAccessControl?.resolveUserAccessMatrix(username, same ? String(currentRole || '') : '') || null;
        }

        function getAllowedRequestModalRepOptions() {
            const matrixAccess = typeof window !== 'undefined' ? window.GncUserAccessControl : null;
            const fallback = (matrixAccess?.getAccessSalesReps() || []).map(rep => normalizeRequestRepUserOption({username:rep.username,display_name:rep.label,role:'REP'})).filter(Boolean);
            const eligibleUsers = [...requestModalRepUserOptions.filter(option => isRequestRepRoleValue(option && option.role)),...fallback];
            const optionsByIdentity = new Map();
            const add = (option, identity) => {
                if (!option || !option.label || !identity) return;
                const previous = optionsByIdentity.get(identity);
                const ids = new Set([...(previous?.salesrepIds || []), ...(option.salesrepIds || []), previous?.salesrepId, option.salesrepId].filter(Boolean));
                optionsByIdentity.set(identity, { ...previous, ...option, label: previous?.salesrepId ? previous.label : option.label,
                    salesrepIds: Array.from(ids), salesrepId: ids.size === 1 ? Array.from(ids)[0] : '' });
            };
            const directory = getRequestMappedRepDirectory();
            directory.options.forEach(option => add(option, `rep:${normalizeRequestSalesrepId(option.salesrepId) || option.salesrepId}`));
            eligibleUsers.forEach(option => {
                const id = String(option.salesrepId || '').trim();
                const username = normalizePushUsername(option.username || '');
                add(option, id ? `rep:${normalizeRequestSalesrepId(id) || id}` : `user:${username}`);
            });
            const options=Array.from(optionsByIdentity.values()).sort((a, b) => a.label.localeCompare(b.label));
            if (!matrixAccess) return options;
            const roster=new Set(matrixAccess.getAccessSalesReps().map(rep=>matrixAccess.normalizeAccessUsername(rep.username)));
            return mergeRequestModalRepOptions(options).filter(option=>roster.has(matrixAccess.normalizeAccessUsername(option.label)) && matrixAccess.canRequestSalesRep(resolveUserAccessMatrix(),option.username||option.label));
        }

        async function suspendTagApi(operation, payload, options = {}) {
            const owner = getSupabaseReadIdentityScope();
            const startedView = typeof document !== 'undefined' ? document.body?.dataset?.currentView : '';
            const delays = operation === 'close' && !options.readCommitted ? [350, 800, 1500, 2500]
                : options.commandId && ['close','save','complete','replace_location','split_location','remove_location','add_candidates','dock_review'].includes(operation) ? [300, 800, 1600] : ['rows','inbox','approval'].includes(operation) ? [350] : [];
            let result;
            for (let attempt = 0; ; attempt += 1) {
                if (owner !== getSupabaseReadIdentityScope() || options.signal?.aborted) throw staleSupabaseReadScopeError();
                try { if (operation === 'replace_location' && payload.finalPull === true) {
                    const headers = await getNativeAuthRequestHeaders();
                    if (!headers?.Authorization || owner !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
                    const response = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/select_final_suspend_location_v23163', {method:'POST',headers:{...headers,'Content-Type':'application/json'},referrerPolicy:'no-referrer',signal:options.signal,body:JSON.stringify({p_payload:payload,p_command_id:options.commandId,p_expected_version:options.expectedVersion ?? null})},15000,'Final Suspend pull');
                    if (!response.ok) throw await createSupabaseReadResponseError(response,'Final Suspend pull');
                    result = {ok:true,data:await response.json()};
                } else result = await postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'suspend_tag', operation, payload,
                commandId: options.commandId || null, expectedVersion: options.expectedVersion == null ? null : options.expectedVersion },
                { timeoutMs: Math.max(15000,getDetailRowWriteTimeoutMs()), signal: options.signal, label: 'Suspend Tag ' + operation, idempotencyKey: options.commandId || '' });
                    if (!result || result.ok !== true || !result.data) throw new Error([result?.code, result?.error, result?.message].filter(Boolean).join(' ') || 'Suspend Tag was not confirmed.');
                    break;
                } catch (error) {
                    const reason = String(error?.code || '') + ' ' + String(error?.message || '');
                    const cancelled = options.signal?.aborted || error?.name === 'AbortError' || ['REQUEST_ABORTED','DATASET_READ_SCOPE_CHANGED'].includes(error?.code);
                    const leftView = startedView && startedView !== document.body?.dataset?.currentView;
                    if (cancelled || owner !== getSupabaseReadIdentityScope()) throw error;
                    const transient = /55P03|57014|40P01|lock_not_available|lock timeout|deadlock detected|network|failed to fetch|fetch failed|load failed|connection|timed out/i.test(reason);
                    const firstLock = attempt === 0 && /55P03|lock_not_available/i.test(reason);
                    if (!transient || (!firstLock && attempt >= delays.length) || leftView) {
                        const confirmed = options.readCommitted && await options.readCommitted().catch(() => null);
                        if (confirmed && owner === getSupabaseReadIdentityScope()) { result = {data:confirmed}; break; }
                        if (operation !== 'rows' && !leftView) globalThis.GncRuntimeWatchdog?.observeError?.('Suspend Tag ' + operation,reason,false,'RPC_FAILURE');
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, firstLock ? 250 : delays[attempt]));
                }
            }
            if (owner === getSupabaseReadIdentityScope() && !['rows', 'approval', 'inbox'].includes(operation)) {
                applySuspendCandidateRows(result.data.rows, {close:operation === 'close'});
                if (['add_candidates','replace_location','split_location'].includes(operation)) applySuspendTagInventoryReceipt(result.data, owner);
            }
            return result.data;
        }

        function getManagerAssignedSelectionSnapshot() {
            const rows = getFilteredManagerAssignedItemsExportRows(getManagerAssignedItemsDisplayRows());
            const codes = new Set(rows.map(row => buildManagerEvalAssignmentKey(row.ITEMCODE)).filter(Boolean));
            const selectedRows = rows.filter(row => managerEvalAssignmentSelection.has(buildManagerEvalAssignmentKey(row.ITEMCODE)));
            const state = getManagerAssignedColumnState();
            const filtered = Object.values(state.filters).some(Array.isArray) || !!String(managersSearchTerm || '').trim() || getManagerAssignedItemsActiveAssigneeKey() !== 'all';
            return { rows, codes, selectedRows, filtered };
        }

        function updateManagerAssignedItemsView(options = {}) {
            const state = getManagerAssignedColumnState();
            if (state.opening) return;
            if (options.ownerOnly && state.viewProps && state.view && state.viewHost?.isConnected) {
                state.view.update({...state.viewProps,ownerDrafts:{...state.defaultDrafts},pendingCodes:new Set(state.defaultPending||[]),selectedCodes:new Set(managerEvalAssignmentSelection)});
                clearTimeout(state.ownerPaintTimer);
                const settle = () => { if(state!==getManagerAssignedColumnState())return;if(state.defaultPending?.size){state.ownerPaintTimer=setTimeout(settle,350);return;}updateManagerAssignedItemsView();scheduleManagersRender(true); };
                state.ownerPaintTimer=setTimeout(settle,350);
                return;
            }
            if (state.view && state.viewHost?.isConnected) state.view.update(getManagerAssignedItemsViewProps());
            const snapshot = getManagerAssignedSelectionSnapshot();
            const checkbox = document.querySelector('[data-assigned-select-all-visible]');
            if (checkbox) {
                checkbox.checked = snapshot.rows.length > 0 && snapshot.selectedRows.length === snapshot.rows.length;
                checkbox.indeterminate = snapshot.selectedRows.length > 0 && snapshot.selectedRows.length < snapshot.rows.length;
                const label = checkbox.parentElement;
                if (label?.lastChild?.nodeType === 3) label.lastChild.textContent = 'Select All Filtered (' + snapshot.rows.length + ')';
            }
            const bulk = document.querySelector('[data-manager-assign-selected]');
            if (bulk) {
                const count = snapshot.selectedRows.length;
                bulk.textContent = '✓ Reassign (' + (count || snapshot.rows.length) + ')';
                bulk.disabled = !snapshot.rows.length || [...snapshot.codes].some(code => state.defaultPending?.has(code));
            }
            const all = document.querySelector('[data-manager-assign-filtered]');
            if (all) { all.textContent = 'Assign All Filtered (' + snapshot.rows.length + ')'; all.disabled = !snapshot.rows.length || [...snapshot.codes].some(code => state.defaultPending?.has(code)); }
        }

        function applyOptimisticItemcodeOwners(codes, assignee) {
            const state = getManagerAssignedColumnState(), wanted = new Set(codes), snapshots = [];
            const fields = ['DEFAULT_ASSIGNEDTO','default_assignedto','DEFAULT_OWNER','default_owner','ASSIGNEDTO','assignedto','effective_worker','EFFECTIVE_WORKER','zone_override_active','assignment_reason'];
            const defaults = state.defaultOwnersByCode ||= state.itemcodeDefaultOwners instanceof Map ? state.itemcodeDefaultOwners : new Map();
            const previousDefaults = new Map();
            for (const code of wanted) {
                const previous = defaults.get(code);
                const optimistic = { ...previous, itemcode_normalized: code, assignedto: assignee };
                previousDefaults.set(code, {previous, optimistic});
                defaults.set(code, optimistic);
            }
            state.itemcodeDefaultOwners = defaults;
            const seen = new Set();
            [warehouseAssignedItemsInventory, fullInventory, state.warehouseAssignedItems, state.itemcodeDefaultOwners, state.inventoryRowAssignments, state.fullInventory, state.rows, state.data, state.displayCache?.rows].filter(Array.isArray).forEach(rows => rows.forEach(row => {
                if (seen.has(row) || !wanted.has(buildManagerEvalAssignmentKey(row.ITEMCODE || row.itemcode || row.itemcode_normalized))) return;
                seen.add(row); const before = Object.fromEntries(fields.map(field => [field, { exists: Object.hasOwn(row, field), value: row[field] }]));
                snapshots.push({ row, before });
                fields.slice(0,8).forEach(field => { row[field] = assignee; }); row.zone_override_active = false; row.assignment_reason = assignee ? 'itemcode_default' : 'unassigned';
            }));
            state.dataEpoch = (state.dataEpoch || 0) + 1;
            clearWarehouseAssignedItemCaches();
            if (state.displayCache) {
                const targets = getManagerItemLowStockTargetsState();
                state.displayCache.signature = getManagerAssignedDisplaySignature(state, state.displayCache.input === fullInventory, targets.revision);
                state.filteredCache = new Map();
            }
            invalidateManagerEvalReport2Cache();
            const refreshOwners = () => {
                state.assignedFilterIndex = null;
                state.filteredCache = new Map();
                if (typeof getCardEvalOwnerIndex === 'function') getCardEvalOwnerIndex(state, true);
                if (state === getManagerAssignedColumnState() && typeof refreshSuspendOwnerViews === 'function') refreshSuspendOwnerViews();
            };
            refreshOwners();
            return () => {
                for (const [code, {previous, optimistic}] of previousDefaults) {
                    const active = state.defaultOwnersByCode;
                    if (active?.get(code) !== optimistic) continue;
                    if (previous === undefined) active.delete(code);
                    else active.set(code, previous);
                }
                snapshots.forEach(({row,before}) => {
                    if (row.default_owner !== assignee) return;
                    for (const [field, prior] of Object.entries(before)) {
                        if (prior.exists) row[field] = prior.value;
                        else delete row[field];
                    }
                });
                state.dataEpoch++;
                clearWarehouseAssignedItemCaches();
                invalidateManagerEvalReport2Cache();
                refreshOwners();
            };
        }


        function getManagerAssignedItemsViewProps(rows = null, totalRows = null) {
            const state = getManagerAssignedColumnState();
            const low = getManagerItemLowStockTargetsState();
            const pageSource = state.viewPageSource && useManagerReportPages('assigned-items') ? { ...state.viewPageSource,
                query: buildManagerReportPageQuery('assigned-items', 'rows'), refreshKey: state.viewRefreshKey || 0 } : null;
            if (pageSource) {
                state.viewNormalizeRow ||= (row, index) => normalizeWarehouseAssignedItemRow(enrichManagerAssignedPlantGroups([row])[0], index);
                state.viewPageStateHandler ||= (page, offset, result) => {
                    const nextRevision = page?.sourceRevision || state.viewPageRevision || '';
                    const nextError = result?.error ? String(result.error.message || result.error) : '';
                    const nextMetadata = page?.metadata || state.viewMetadata || {};
                    const nextMetadataKey = JSON.stringify(nextMetadata);
                    const metadataChanged = state.viewMetadataKey !== nextMetadataKey;
                    if (state.viewPageRevision === nextRevision && state.viewPageError === nextError && state.viewMetadataKey === nextMetadataKey) return;
                    state.viewPageRevision = nextRevision; state.viewPageError = nextError;
                    state.viewMetadata = nextMetadata; state.viewMetadataKey = nextMetadataKey;
                    updateManagerAssignedItemsView();
                    if (metadataChanged && isViewVisible('managers')) scheduleManagersRender(true);
                };
                pageSource.normalizeRow = state.viewNormalizeRow;
                pageSource.onPageState = state.viewPageStateHandler;
            }
            const allRows = pageSource ? [] : getManagerAssignedItemsDisplayRows();
            const displayed = pageSource ? [] : getFilteredManagerAssignedItemsExportRows(allRows);
            state.visibleRows = displayed;
            if (!state.viewHandlers) state.viewHandlers = {
                onDefaultChange: assignManagerCheckedItemcodes,
                onSelectAll: checked => selectAllFilteredManagerAssignedItems(checked),
                onSelect: (code, checked) => { toggleManagerEvalAssignmentItem(code, '', checked); updateManagerAssignedItemsView(); },
                onLowStockDraft: (code, value) => { updateManagerItemLowStockDraft(code, value); updateManagerAssignedItemsView(); },
                onLowStockSave: code => saveManagerItemLowStockOverride(code),
                onLowStockReset: code => resetManagerItemLowStockOverride(code),
                onColumnFilter: (field, event) => openManagerAssignedColumnFilter(field, event.currentTarget),
                getReason: getManagerEvalAssignmentReason,
                onRetry: () => { if (state.viewPageSource) { state.viewRefreshKey = (state.viewRefreshKey || 0) + 1; updateManagerAssignedItemsView(); } else refreshManagerAssignedItemsExport(); },
                fallbackHtml: () => renderManagerAssignedFallbackRows(getManagerAssignedItemsViewProps().rows),
                onError: () => { globalThis.GncRuntimeWatchdog?.captureHandled?.('assigned_items_module_fallback'); }
            };
            if (!state.viewColumns) state.viewColumns = getManagerAssignedColumnDefinitions();
            const optionKey = JSON.stringify(getManagerAssignableOwnerUsers().map(user => [user, getEvalAssignableUserLabel(user)]));
            if (state.viewOptionKey !== optionKey) {
                state.viewOptionKey = optionKey;
                state.viewOptions = [{value: '', label: 'Unassigned'}, ...getManagerAssignableOwnerUsers().map(user => ({value: normalizeEvalAssignableUser(user), label: getEvalAssignableUserLabel(user)}))];
            }
            return state.viewProps = { ...state.viewHandlers, filterKey:state.selectionFilterKey, uiState: state.viewUi ||= { expanded: new Set(), anchor: null }, rows: displayed, totalRows: totalRows ?? (pageSource ? null : allRows.length), ...(pageSource ? { pageSource } : {}),
                scrollElement: state.viewHost?.closest('[data-manager-assigned-scroll]') || document.getElementById('main-scroll-area'), columns: state.viewColumns,
                columnFilters: Object.fromEntries(state.viewColumns.map(([field]) => [field, { active: Array.isArray(state.filters[field]), open: state.editor?.field === field, label: !Array.isArray(state.filters[field]) ? 'All' : state.filters[field].length === 1 ? getManagerAssignedColumnLabel(field, state.filters[field][0]) : `${state.filters[field].length} selected` }])),
                sort: state.sort, grouped: false,
                canManageAssignments: canManageEvalItemcodeAssignments(), snapshotCurrent: isManagerAssignedSnapshotCurrent(),
                options: state.viewOptions, ownerDrafts: { ...state.defaultDrafts },
                pendingCodes: new Set(state.defaultPending || []), selectedCodes: new Set(managerEvalAssignmentSelection),
                lowStock: { targets: low.rowsByCode, drafts: new Map(low.drafts), saving: new Set(low.saving),
                    canEdit: canManageItemLowStockTargets(), error: low.error,
                    fallback: Number.isFinite(Number(managerEvalReportSettings?.lowStockMaxSLts)) ? Number(managerEvalReportSettings.lowStockMaxSLts) : 150 } };
        }

        function sameAssignedDisplayRows(previous, next) {
            if (previous === next) return true;
            if (!previous || previous.length !== next.length) return false;
            const fields = ['MASTER_UNIQUE_ID', 'UNIQUE_ID', 'DEFAULT_REVISION', ...getManagerAssignedColumnDefinitions().map(([field]) => field)];
            return next.every((row, index) => fields.every(field => row[field] === previous[index][field]));
        }

        function getManagerAssignedDisplaySignature(state, useMaster, targetRevision) {
            return `${getDatasetLoadSignature('warehouseAssignedItems')}|${useMaster}|${getDatasetLoadSignature('master')}|${warehouseAssignedItemsInventory.length}|${state.dataEpoch || 0}|${JSON.stringify(state.defaultDrafts || {})}|${targetRevision}|${getDatasetLoadSignature('cav')}|${getDatasetLoadSignature('cropRollDrive')}|${managerEvalReportSettings?.lowStockMaxSLts}`;
        }

        function applyCommittedItemcodeOwnerReceipt(row) {
            if (typeof managerAssignedColumnState === 'undefined' || typeof currentUser !== 'string') return row;
            const state = managerAssignedColumnState;
            if (!state.ownerReceiptUser || state.ownerReceiptUser !== currentUser || !(state.ownerReceipts instanceof Map)) return row;
            const uid = String(row.master_unique_id || row.MASTER_UNIQUE_ID || '');
            const receipt = state.ownerReceipts.get(uid);
            if (!receipt) return row;
            const incoming = Number(row.default_revision ?? row.DEFAULT_REVISION ?? 0), committed = Number(receipt.default_revision || 0);
            if (incoming > committed) { state.ownerReceipts.set(uid, { ...row }); return row; }
            if (incoming < committed || Number(row.revision || 0) < Number(receipt.revision || 0)) {
                Object.assign(row, { assignedto: receipt.assignedto || '', ASSIGNEDTO: receipt.assignedto || '',
                    default_assignedto: receipt.default_assignedto || '', DEFAULT_ASSIGNEDTO: receipt.default_assignedto || '',
                    default_owner: receipt.default_assignedto || '', effective_worker: receipt.assignedto || '',
                    default_revision: committed, DEFAULT_REVISION: committed, revision: receipt.revision,
                    zone_override_active: receipt.zone_override_active, assignment_reason: receipt.assignment_reason });
            }
            return row;
        }

        function assignManagerCheckedItemcodes(code, value) {
            const snapshot = getManagerAssignedSelectionSnapshot();
            const checked = snapshot.selectedRows.some(row => buildManagerEvalAssignmentKey(row.ITEMCODE) === buildManagerEvalAssignmentKey(code))
                ? [...new Set(snapshot.selectedRows.map(row => buildManagerEvalAssignmentKey(row.ITEMCODE)))] : [];
            const bulk = document.getElementById('manager-eval-bulk-assignee');
            if (bulk) {
                bulk.value = value;
                bulk.dispatchEvent?.(new Event('change'));
            }
            return assignEvalItemcodes(checked.length > 1 ? checked : [code], value);
        }

function canViewNurseryCommandTables(user = currentUser) {
            const matrix = typeof resolveUserAccessMatrix === 'function' ? resolveUserAccessMatrix(user) : null;
            return matrix?.view_permissions?.view_nursery_command_tables === 'Y';
        }
function getNurseryTableManagementOptions(identity) {
    return {
nurseryIdentity: identity,
                    nurseryApprovedBy: String(currentUser || 'Reviewer'),
                    nurseryAuthorized: () => identity === getSupabaseReadIdentityScope() && canViewNurseryCommandTables(),
                    inventory: () => fullInventory,
                    inventoryReady: () => getDatasetState('master').rowCompleteness === 'complete',
                    onBunchNoteSaved: (row, decision) => {
                        const uid = String(row?.unique_id || row?.UNIQUE_ID || '');
                        const live = !row?.synthetic && fullInventory.find(item => String(item.unique_id || item.UNIQUE_ID || '') === uid);
                        if (live) live.approved_bunch_note = decision?.notes || '';
                        invalidateDriveResolvedCardState();
                    },
                    onBunchNoteError: message => showToast('Bunch Note save failed', message, true),
                    inventoryRevision: () => getDatasetLoadSignature('master') + ':' + resolvedViewStateEpoch,
                    nurserySendPdf: async (payload, commandId) => {
                        if (identity !== getSupabaseReadIdentityScope() || !canViewNurseryCommandTables()) throw new Error('NURSERY_ACCESS_DENIED');
                        const result = await postAppFunctionJson(APP_API_FUNCTION_URL, {action:'bunch_note',operation:'nursery_pdf',payload,commandId}, {timeoutMs:45000,idempotencyKey:commandId});
                        if(identity !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
                        if(!result?.ok) throw new Error(result?.message || 'PDF email was not queued.');
                        return result.data;
                    },
                    nurseryRequest: async ({table,operation,payload}) => {
                        if (identity !== getSupabaseReadIdentityScope() || !canViewNurseryCommandTables()) throw new Error('NURSERY_ACCESS_DENIED');
                        const result = await supabaseRpc('nursery_command_v23127', {p_table:table,p_operation:operation,p_payload:payload}, {timeoutMs:30000});
                        if (identity !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
                        return result;
                    },
    };
}

        function isAllowedAppHostname(hostname = window.location.hostname, protocol = window.location.protocol) {
            const host = String(hostname).toLowerCase();
            return (protocol === 'https:' && (host === 'agmetricapp.com' || host === 'www.agmetricapp.com' || host.endsWith('.github.io')))
                || (['http:', 'https:'].includes(protocol) && ['localhost', '127.0.0.1'].includes(host));
        }
        function isQuotaBackgroundPollingAllowed() {
            const modal = document.getElementById('erp-sync-progress-modal');
            return !document.hidden && !!modal && !modal.hidden && !modal.classList.contains('hidden') && modal.style.display !== 'none';
        }

function getManagerTableManagementItems(access = getManagersToolAccess()) {
            return [
                ...(globalThis.GncNurseryModel?.TABLES || []).map(item => ({...item,visible:canViewNurseryCommandTables()})),
                { id:'assigned-items', label:'Assigned Items', section:'editable', visible:access.canViewAssignedItemsExport },
                { id:'company-directory', label:'Company Directory', section:'editable', visible:typeof canonicalFeaturePermission !== 'function' || canonicalFeaturePermission('can_access_manager_tab') !== false },
                { id:'inquiry-coverage', label:'Inquiry Coverage', section:'editable', visible:typeof canonicalFeaturePermission !== 'function' || canonicalFeaturePermission('can_access_manager_tab') !== false },
                { id:'customer-assignments', label:'Customer Assignments', section:'editable', visible:access.canManageCustomerRepMappings },
                { id:'user-role-access', label:'User & Role Access', section:'editable', visible:access.canManageAccessControl },
                { id:'av-note-users', label:'AV Note Users', section:'editable', visible:access.canManageAvBlanksPhotoBypass },
                { id:'season', label:'Season', section:'editable', visible:access.canManageSeasonSettings },
                { id:'season-priority', label:'Season Priority', section:'editable', visible:access.canViewSeasonPriority },
                { id:'crop-roll', label:'Crop Roll', section:'editable', visible:access.canViewCropRoll },
                { id:'production-schedule', label:'PROD SCHEDULE 102726 (2026-10-29_1232)', section:'schedule', visible:access.canViewProductionSchedule },
                { id:'historical-drive-mode', label:'Historical Drive Mode', section:'archive', visible:canUseHistoricalRequests() },
                { id:'historical-soc-open-orders', label:'Historical SOC Open Orders', section:'archive', visible:canUseHistoricalRequests() },
                { id:'historical-soc-reserves', label:'Historical SOC Reserves', section:'archive', visible:canUseHistoricalRequests() },
                { id:'historical-requests', label:'Historical Requests', section:'archive', visible:canUseHistoricalRequests() },
                { id:'photo-history', label:'Photo History', section:'archive', visible:canOpenPhotoHistory() }
            ].filter(item => item.visible);
        }

function openManagerTableManagement(table = '') {
            const key = getManagerTableManagementKey(table) || String(table || '').trim().toLowerCase();
            if (!key) managersSearchTerm = '';
            const available = new Set(getManagerTableManagementItems().map(item => item.id));
            if (key && !available.has(key)) {
                if (key === 'photo-history' && !canOpenPhotoHistory()) return false;
                if (key === 'assigned-items' && canViewAssignedItemsExport()) {
                    managerTableManagementSelection = key; managerTableManagementDirectOpen = true;
                    try { return setHomeTab(MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW); } finally { managerTableManagementDirectOpen = false; }
                }
                if (key === 'customer-assignments' && canManageCustomerRepMappings()) {
                    managerTableManagementSelection = key; managerTableManagementDirectOpen = true;
                    try { return setHomeTab(MANAGER_CUSTOMER_REP_MAP_VIEW); } finally { managerTableManagementDirectOpen = false; }
                }
                if (key === 'user-role-access' && canViewAccessControl()) {
                    managerTableManagementSelection = key; managerTableManagementDirectOpen = true;
                    try { return setHomeTab(MANAGER_ACCESS_CONTROL_VIEW); } finally { managerTableManagementDirectOpen = false; }
                }
                if (key === 'historical-requests' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-requests');
                if (key === 'historical-drive-mode' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-drive');
                if (key === 'historical-soc-open-orders' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-orders');
                if (key === 'historical-soc-reserves' && canUseHistoricalRequests()) return navigateQuickAccessView('archive-reserves');
                return false;
            }
            if (key === 'photo-history') return openDylanPhotoHistory({ readOnly: true });
            const legacyTab = getManagerTableManagementLegacyTab(key);
            if (legacyTab) {
                managerTableManagementSelection = key;
                managerTableManagementDirectOpen = true;
                try { if (getCurrentVisibleViewId() !== 'managers') switchView('managers'); setHomeTab(legacyTab); if (key !== 'assigned-items') renderManagers(); return false; }
                finally { managerTableManagementDirectOpen = false; }
            }
            if (key === 'historical-requests') return navigateQuickAccessView('archive-requests');
            if (key === 'historical-drive-mode') return navigateQuickAccessView('archive-drive');
            if (key === 'historical-soc-open-orders') return navigateQuickAccessView('archive-orders');
            if (key === 'historical-soc-reserves') return navigateQuickAccessView('archive-reserves');
            managerTableManagementSelection = key;
            destroyManagerTableManagement();
            if (getCurrentVisibleViewId() !== 'managers') switchView('managers');
            managerTableManagementDirectOpen = true;
            try { setHomeTab(MANAGER_TABLE_MANAGEMENT_VIEW); renderManagers(); return false; }
            finally { managerTableManagementDirectOpen = false; }
        }

function getManagerTableManagementKey(tab = '') {
    const key = String(tab || '').trim().toLowerCase();
    const aliases = {'assigned-items':'assigned-items','assigned-items-export':'assigned-items','company-directory':'company-directory','inquiry-coverage':'inquiry-coverage','item-inquiry-coverage':'inquiry-coverage','customer-assignments':'customer-assignments','customer-rep-map':'customer-assignments','user-role-access':'user-role-access','access-control':'user-role-access','production-schedule':'production-schedule','av-note-users':'av-note-users','av-blanks-photo-bypass':'av-note-users','season':'season','season-settings':'season','app-season-settings':'season','season-priority':'season-priority','crop-roll':'crop-roll'};
    return aliases[key] || (globalThis.GncNurseryModel?.TABLES?.some(item => item.id === key) ? key : '');
}
function getManagerTableManagementLegacyTab(key = '') {
    return {'assigned-items':'assigned-items-export','customer-assignments':'customer-rep-map','user-role-access':'access-control','production-schedule':'production-schedule','av-note-users':'av-blanks-photo-bypass','season':'season-settings','season-priority':'season-priority','crop-roll':'crop-roll'}[key] || '';
}
function renderManagerTableManagementWorkspace(content, selected = '') {
    const items = getManagerTableManagementItems(), adminOrder = ['assigned-items','user-role-access','company-directory','customer-assignments','inquiry-coverage','av-note-users','season','season-priority','crop-roll'];
    const directory = [...adminOrder.map(key => items.find(item => item.id === key)).filter(Boolean), ...items.filter(item => item.nursery || item.section === 'schedule' && !items.some(row => row.id === 'prod-schedule'))];
    if (!selected) {
        const query = typeof managersSearchTerm === 'string' ? managersSearchTerm.trim().toLowerCase() : '';
        const cards = directory.map(item => '<button type="button" class="manager-module-card" data-manager-table-card="' + esc(item.id) + '"' + (query && !item.label.toLowerCase().includes(query) ? ' hidden' : '') + ' onclick="return openManagerTableManagement(this.dataset.managerTableCard)"><span class="manager-module-icon" aria-hidden="true"><i class="ph-bold ph-table"></i></span><span class="manager-module-title">' + esc(item.label) + '</span></button>').join('');
        return '<section id="view-table-management" data-table-directory-mode="index" data-selected-table="" aria-label="Table Management directory"><div class="table-management-directory" data-table-directory>' + cards + '</div></section>';
    }
    const active = items.find(item => item.id === selected);
    const choices = [...directory, ...items.filter(item => item.section === 'archive')];
    const options = choices.map(item => '<option value="' + esc(item.id) + '" data-manager-table-pill="' + esc(item.id) + '" aria-pressed="' + (item.id === selected) + '"' + '>' + esc(item.label) + '</option>').join('');
    return '<section id="view-table-management" data-table-directory-mode="table" data-selected-table="' + esc(selected) + '" aria-label="Table Management workspace"><nav class="table-management-selector" data-table-selector aria-label="Table navigation"><button type="button" data-table-all onclick="return openManagerTableManagement()">← All Tables</button><strong class="table-management-title" title="' + esc(active?.label || selected) + '">' + esc(active?.label || selected) + '</strong><select data-table-switch aria-label="Switch Table" onchange="return openManagerTableManagement(this.value)"><option value="" selected disabled>Switch Table ▾</option>' + options + '</select></nav><div class="table-management-workspace" data-table-workspace>' + content + '</div></section>';
}
function syncManagerTableManagementViewport() {
    const root = document.getElementById('view-table-management');
    if (!root) return;
    const main = document.getElementById('main-scroll-area');
    if (main) main.scrollTop = 0;
    root.style.setProperty('--table-management-height', Math.max(180, window.innerHeight - root.getBoundingClientRect().top - 76) + 'px');
}

        function discardDrivePhotoAttachment(id) {
            const job = drivePhotoAttachments.get(id);
            if (!job || !isCurrentDrivePhotoAttachment(job)) return false;
            job.uploadController?.abort();
            job.commandRow?.__drivePhotoAbort?.();
            drivePhotoAttachments.delete(id);
            if (job.blobBackup) job.blobBackup.then(() => deleteIndexedDbRecord(REQUEST_BLOB_STORE,job.blobId)).catch(() => false);
            clearPendingPhotoPreview(job.item, job.prefix, job.preview.id);
            refreshPendingPhotoUiForItem(job.item, job.prefix);
            return false;
        }

function formatAvReadySummary(bucket, count) {
    return String(bucket).toUpperCase() + ' · ' + count.toLocaleString('en-US') + (count === 1 ? ' ITEM READY' : ' ITEMS READY');
}

function toggleAvShowroomControl(button, mode) {
    const view = document.getElementById('view-av');
    if (!view || !button) return false;
    if (mode === 'filters') {
        const panel = document.getElementById('av-filter-options');
        if (!panel) return false;
        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
    } else if (mode === 'kiosk') {
        button.setAttribute('aria-pressed', String(view.classList.toggle('av-kiosk-mode')));
    }
    return false;
}

function rowEvaluationDraftKey(row, prefix) {
    const uid = row?.UNIQUE_ID || row?.unique_id;
    return currentUser && uid ? 'gnc-evaluation-draft:' + JSON.stringify([getSupabaseReadIdentityScope(),prefix,uid]) : '';
}
function readRowEvaluationDraft(row,prefix) {
    try { return JSON.parse(localStorage.getItem(rowEvaluationDraftKey(row,prefix)) || '{}'); } catch { return {}; }
}
function restoreRowEvaluationDraft(row,prefix) {
    for (const [id,value] of Object.entries(readRowEvaluationDraft(row,prefix))) {
        const field = document.getElementById(id);
        if (field && id.startsWith(prefix)) field.value = value;
    }
}
function clearSavedRowEvaluationDraft(row,prefix,saved) {
    const key = rowEvaluationDraftKey(row,prefix);
    if (!key || !saved) return;
    try {
        const draft = readRowEvaluationDraft(row,prefix);
        for (const id of Object.keys(saved)) if (draft[id] === saved[id]) delete draft[id];
        if (Object.keys(draft).length) localStorage.setItem(key,JSON.stringify(draft)); else localStorage.removeItem(key);
    } catch { /* Storage can be unavailable in private browsing. */ }
}

function getQueueDisplayPhotoUrls(row) {
    if (!row) return [];
    return [...new Set([...getPhotoUrlList(getSharedAppPhotoLinkCsvRaw(row,{includePending:false})), ...getInventoryLocationPhotos(row)])];
}
function getQueueDisplayEvidenceRow(item) {
    const table = String(item?.SOURCE_TABLE || item?.source_table || '').toLowerCase();
    if (!item || table === 'ph_master_inventory' || !(isRequestOwnedPhotoRow(item) || isDockSuspendDcRequestMirrorRow(item)
        || ['ph_requests_pending','ph_requests_completed_history'].includes(table))) return null;
    const code = getRequestItemCodeOptionItemCode(item);
    const normalizeLocation = window.AgMetricQueueInventory?.normalizeLocation || (value => String(value || '').trim().toUpperCase());
    const location = normalizeLocation(item.LOCATIONCODE || item.locationcode);
    if (!code || !location || isFalseBlockLocation(location)) return null;
    const scope = getSupabaseReadIdentityScope(), state = getManagerAssignedColumnState();
    const scoped = suspendTagItemHydration.get(code);
    const candidates = new Map();
    const add = row => {
        if (!row || getRequestItemCodeOptionItemCode(row) !== code ||
            normalizeLocation(row.LOCATIONCODE || row.locationcode) !== location) return;
        const uid = row.UNIQUE_ID || row.unique_id;
        if (!uid) return;
        const prior = candidates.get(uid);
        if (!prior) { candidates.set(uid,row); return; }
        const merged = {...prior,...row};
        for (const key of ['photo_link','spec','caliper','av_note','pick_note','sales_note','loc_match_pct','loc_photo_match']) {
            const upper = key.toUpperCase();
            if ((merged[upper] ?? merged[key] ?? '') === '') {
                const saved = prior[upper] ?? prior[key];
                if (saved != null) merged[upper] = merged[key] = saved;
            }
        }
        candidates.set(uid,merged);
    };
    if (state.noteScope === scope) (state.locationSalesNotes?.get(code) || []).forEach(add);
    if (scoped?.owner === scope) (scoped.rows || []).forEach(add);
    (masterInventoryByNormalizedItemLocation.get(getInventoryCardItemLocationKey(item)) || []).forEach(add);
    const linked = item.MASTER_ID || item.master_id || item.MASTER_UNIQUE_ID || item.master_unique_id;
    if (linked) add(masterInventoryById.get(linked));
    const part = (r,k) => String(r[k] ?? r[k.toLowerCase()] ?? (k === 'PRIORITY' ? r.PRI ?? r.pri : '') ?? '').trim().toUpperCase();
    const score = row => {
        const photo = getQueueDisplayPhotoUrls(row).length > 0;
        let value = photo ? 64 : 0;
        if (linked && (row.UNIQUE_ID || row.unique_id) === linked) value += 32;
        for (const [key, weight] of [['LOTCODE',16],['SALEYEAR',8],['SEASON',4],['PRIORITY',2]]) {
            if (part(item,key) && part(item,key) === part(row,key)) value += weight;
        }
        return value;
    };
    let best = null, bestScore = -1;
    for (const row of candidates.values()) {
        const rank = score(row);
        if (rank > bestScore || rank === bestScore && String(row.UNIQUE_ID || row.unique_id) < String(best.UNIQUE_ID || best.unique_id)) {
            best = row; bestScore = rank;
        }
    }
    return best;
}

function inventoryPhotoLocationKey(row) {
    if (!row) return '';
    const table = String(row.SOURCE_TABLE || row.source_table || '').toLowerCase();
    const ownUid = row.ROW_UID || row.row_uid || row.UNIQUE_ID || row.unique_id;
    const masterUid = row.MASTER_UNIQUE_ID || row.master_unique_id || row.MASTER_ID || row.master_id || row.master_uid;
    const uid = String((!table || table === 'ph_master_inventory' || table === 'ph_location_sales_notes')
        ? ownUid || masterUid || '' : masterUid || '').trim();
    if (uid) return 'uid:' + uid;
    const part = key => String(row[key] ?? row[key.toLowerCase()] ?? '').trim().toUpperCase();
    const tuple = ['ITEMCODE','LOCATIONCODE','LOTCODE'].map(part);
    const priority = part('PRIORITY') || part('PRI'), season = part('SEASON'), year = part('SALEYEAR'), designation = part('DESIGITEM');
    if (!tuple[0] || !tuple[1] || !(tuple[2] || priority && (season || year))) return '';
    if (typeof masterInventoryLookup !== 'undefined' && masterInventoryLookup) {
        const rows = masterInventoryLookup.byItemLoc.get(getInventoryCardItemLocationKey(row))?.rows || [];
        const matching = rows.filter(candidate => {
            const value = k => String(candidate[k] ?? candidate[k.toLowerCase()] ?? '').trim().toUpperCase();
            return (!tuple[2] || tuple[2] === value('LOTCODE')) && (!priority || priority === value('PRIORITY'))
                && (!season || season === value('SEASON')) && (!year || year === value('SALEYEAR'))
                && (!designation || designation === value('DESIGITEM'));
        });
        if (matching.length > 1) return '';
        if (matching.length === 1) return 'uid:' + (matching[0].UNIQUE_ID || matching[0].unique_id);
    }
    return 'tuple:' + JSON.stringify([ ...tuple,priority,season,year,designation ]);
}

function rememberInventoryLocationPhotoRows(rows, scope) {
    if (scope !== getSupabaseReadIdentityScope() || !Array.isArray(rows)) return;
    const state = getManagerAssignedColumnState();
    if (state.photoReadScope !== scope) state.photoReadRows = new Map();
    state.photoReadScope = scope;
    for (const row of rows) {
        const uid = row.UNIQUE_ID || row.unique_id;
        if (!uid || !inventoryPhotoLocationKey(row)) continue;
        state.photoReadRows.delete(uid); state.photoReadRows.set(uid,row);
    }
    while (state.photoReadRows.size > 1500) state.photoReadRows.delete(state.photoReadRows.keys().next().value);
    state.photoGeneration = (state.photoGeneration || 0) + 1;
}

function getAvNamePhotoSearchRows(term) {
    const query = String(term || '').trim().toLowerCase();
    if (query.length < 3 || query.length > 100 || getAvPhotoMode() !== 'photos' || activeAVTab !== 'open') return [];
    const state = getManagerAssignedColumnState(), scope = getSupabaseReadIdentityScope();
    const permission = appAccessSnapshotState.snapshot?.dataPermissionVersion || '';
    const key = JSON.stringify([scope, permission, query]);
    const previous = state.avPhotoSearch;
    if (previous?.key === key && (previous.pending || Date.now() < previous.expires)) return previous.rows;
    if (previous?.timer) clearTimeout(previous.timer);
    const search = state.avPhotoSearch = {key, rows:[], pending:true, expires:0, timer:null};
    const current = () => state.avPhotoSearch === search && scope === getSupabaseReadIdentityScope()
        && permission === (appAccessSnapshotState.snapshot?.dataPermissionVersion || '')
        && query === getAvSearchTerm() && getAvPhotoMode() === 'photos' && isViewVisible('av');
    search.timer = setTimeout(async () => {
        try {
            if (!current()) return;
            const code = getExactAvSearchItemCode(query);
            const pattern = getRequestItemCodeOptionCommonNameSearchPattern({COMMONNAME:query});
            if (!code && !pattern) return;
            const lookup = code || '&' + new URLSearchParams({commonname:'ilike.'+pattern});
            const raw = await fetchRequestItemCodeOptionRowsFromSupabase(lookup,{maxRows:120});
            if (!current()) return;
            const records = formatFetchedRows(raw,'ph_master_inventory').map(row => buildSearchIndex(row));
            rememberInventoryLocationPhotoRows(records, scope);
            search.rows = records;
            search.expires = Date.now()+60000;
            avResolvedBaseStateKey = ''; avResolvedBaseStateCache = null;
            scheduleAVRender(0,16,true);
        } catch (_) { search.expires = Date.now()+10000; }
        finally { search.pending = false; }
    },120);
    return search.rows;
}

function getInventoryLocationPhotos(row) {
    const key = inventoryPhotoLocationKey(row);
    if (!key) return [];
    const state = getManagerAssignedColumnState();
    const inventory = fullInventory, avRows = avOpenInventory;
    const version = inventoryDomIdLookupCacheVersion + ':' + queueCardInventoryRenderVersion + ':' + (state.photoGeneration || 0);
    const scope = getSupabaseReadIdentityScope();
    if (state.photoScope !== scope) {
        state.photoSources = null;
        if (state.noteScope !== scope) state.locationSalesNotes = new Map();
    }
    if (state.photoSources !== inventory || state.photoAvRows !== avRows || state.photoVersion !== version) {
        const byRow = new Map();
        const add = item => {
            const id = inventoryPhotoLocationKey(item);
            if (!id || !(item.PHOTOS?.length || item.photos?.length || item.photo_link || item.PHOTO_LINK || item.PHOTO_URL || item.photo_url || item.SAVED_PHOTO_LINK)) return;
            const raw = getSharedAppPhotoLinkCsvRaw(item,{includePending:false});
            const urls = getPhotoUrlList(raw);
            if (!urls.length) return;
            let group = byRow.get(id);
            if (!group) byRow.set(id, group = new Map());
            for (const url of urls) if (!group.has(url) && !isPhotoEntryExpired(url,item)) {
                resolveAndFormatPhotoDate(item,url);
                group.set(url,item);
            }
        };
        inventory.forEach(add); if (avRows !== inventory) avRows.forEach(add);
        state.locationSalesNotes?.forEach(notes => notes.forEach(add));
        if (state.photoReadScope === scope) state.photoReadRows?.forEach(add);
        if (state.sessionPhotoScope === scope) state.recentSessionPhotos?.forEach(add);
        state.photosByInventoryRow = byRow;
        state.photoSources = inventory; state.photoAvRows = avRows; state.photoVersion = version; state.photoScope = scope;
    }
    const entries = state.photosByInventoryRow.get(key);
    return entries ? Array.from(entries).filter(([url, source]) => !isPhotoEntryExpired(url, source, {allowUnknownDate:true})).map(([url])=>url) : [];
}

        function getPhotoUrlList(urlStr='') {
            if (Array.isArray(urlStr)) return urlStr.flatMap(entry => getPhotoUrlList(typeof entry === 'object' ? entry?.url || entry?.publicUrl || entry?.photo_url || '' : entry));
            const raw = String(urlStr || '').trim();
            if (raw.startsWith('[')) { try { return getPhotoUrlList(JSON.parse(raw)); } catch (_) { return []; } }
            return raw.replace(/(data:image\/[^,]+),/gi, '$1\u0000')
                .split(',').map(part => part.replace('\u0000', ','))
                .map(part => {
                    let cleanUrl = String(part || '').trim();
                    if (!cleanUrl) return '';
                    if (/^blob:/i.test(cleanUrl) || /^data:image\//i.test(cleanUrl)) return cleanUrl;
                    let match = cleanUrl.match(/(https?:\/\/[^"\s>]+)/);
                    if (match) cleanUrl = match[1];
                    if (!cleanUrl.startsWith('http')) return '';
                    return getExpandedImageUrl(cleanUrl);
                })
                .filter(Boolean);
        }

        function reconcileIncomingRequestRows(rows = []) {
            const incomingRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
            if (!optimisticRequestIds.size && incomingRows.length) return incomingRows;
            const nextRows = incomingRows.slice();
            const seenIds = new Set();
            nextRows.forEach((item) => {
                const id = String(firstNonEmptyValue(item && item.UNIQUE_ID, item && item.unique_id, '')).trim();
                if (!id) return;
                seenIds.add(id);
                // Keep the submitted identity through superseded reads; completion/archive clears it.
            });
            (Array.isArray(requestsInventory) ? requestsInventory : []).forEach((item) => {
                const id = String(item && item.UNIQUE_ID || '').trim();
                if (!id || seenIds.has(id) || (incomingRows.length && !optimisticRequestIds.has(id))
                    || optimisticCompletedRowIds.has(id) || !isRequestPendingVisible(item)) return;
                nextRows.push(item);
                seenIds.add(id);
            });
            return nextRows;
        }

        async function loadManagerItemcodeDefaultOwners(force = false) {
            const state = getManagerAssignedColumnState(), scope = getSupabaseReadIdentityScope();
            if (state.defaultOwnersPromise) return state.defaultOwnersPromise;
            const ownerEpoch = state.ownerWriteAt;
            if (!force && Date.now() - Number(state.defaultOwnersCheckedAt || 0) < 60000) return state.defaultOwnersByCode;
            state.defaultOwnersCheckedAt = Date.now();
            state.defaultOwnersPromise = fetchAllSupabaseRows('ph_itemcode_default_owners', 'select=*&order=itemcode_normalized.asc').then(rows => {
                if (state !== getManagerAssignedColumnState() || scope !== getSupabaseReadIdentityScope()) return null;
                if (ownerEpoch !== state.ownerWriteAt || state.defaultPending?.size) { state.defaultOwnersCheckedAt = 0; return state.defaultOwnersByCode; }
                const previous = state.defaultOwnersByCode || new Map();
                const next = new Map(rows.map(row => {
                    const code = buildManagerEvalAssignmentKey(row.itemcode_normalized), old = previous.get(code);
                    return [code, old && Number(old.revision) > Number(row.revision) ? old : row];
                }));
                if (state.itemcodeDefaultOwners && previous.size === next.size && [...next].every(([code, row]) => {
                    const old = previous.get(code);
                    return old && old.revision === row.revision && old.assignedto === row.assignedto && old.plant_group_code === row.plant_group_code;
                })) return previous;
                state.defaultOwnersByCode = next;
                state.dataEpoch = (state.dataEpoch || 0) + 1;
                state.itemcodeDefaultOwners = state.defaultOwnersByCode;
                getCardEvalOwnerIndex(state, true);
                refreshSuspendOwnerViews();
                if (isViewVisible('managers')) scheduleHydratedViewRender('managers');
                return state.defaultOwnersByCode;
            }).catch(() => state.defaultOwnersByCode).finally(() => { state.defaultOwnersPromise = null; });
            return state.defaultOwnersPromise;
        }

        function renderManagerAssignedFallbackRows(rows = [], preview = false) {
            const state = getManagerAssignedColumnState(), limit = state.fallbackLimit || 150;
            const columns = getManagerAssignedColumnDefinitions().slice(0, 9), editable = canManageEvalItemcodeAssignments();
            const roster = editable && !preview ? getManagerAssignableOwnerUsers() : [];
            const options = new Map();
            const ownerOptions = value => {
                if (!options.has(value)) options.set(value, getManagerEvalAssigneeOptionsHtml(value, roster));
                return options.get(value);
            };
            return '<div data-assigned-fallback' + (preview ? '' : ' onscroll="appendManagerAssignedFallbackPage(this)"') + '><table class="ai-primary-columns"><colgroup>' + (editable ? '<col class="ai-select-col">' : '')
                + columns.map(([field]) => '<col data-field="' + field + '">').join('') + '</colgroup><thead><tr>' + (editable ? '<th>Select</th>' : '')
                + columns.map(([field,label]) => '<th>' + (preview ? escapeHtml(label) : renderManagerAssignedColumnTrigger(field,label)) + '</th>').join('') + '</tr></thead><tbody>'
                + rows.slice(0, limit).map(row => {
                    const code = buildManagerEvalAssignmentKey(row.ITEMCODE), attr = escapeHtml(JSON.stringify(code));
                    return '<tr data-manager-assigned-item-row="' + escapeHtml(code) + '">'
                        + (editable ? '<td><input type="checkbox" aria-label="Select ' + escapeHtml(code) + ' for bulk assignment" data-itemcode="' + escapeHtml(code) + '"' + (preview ? ' disabled' : '') + (managerEvalAssignmentSelection.has(code) ? ' checked' : '') + ' onchange="toggleManagerEvalAssignmentItem(' + attr + ',&quot;&quot;,this.checked);updateManagerAssignedItemsView()"></td>' : '')
                        + columns.map(([field]) => '<td>' + (field === 'DEFAULT_ASSIGNEDTO' && editable && !preview
                            ? '<select aria-label="Itemcode Default Owner ' + escapeHtml(code) + '" data-default-owner="' + escapeHtml(code) + '" onchange="assignManagerCheckedItemcodes(' + attr + ',this.value)">' + ownerOptions(state.defaultDrafts?.[code]?.assignedto ?? row[field]) + '</select>'
                            : escapeHtml(row[field] || (field === 'LOCATIONCODE' ? '—' : row[field] ?? ''))) + '</td>').join('') + '</tr>';
                }).join('') + '</tbody></table>' + (!preview && rows.length > limit ? '<button type="button" data-assigned-more onclick="appendManagerAssignedFallbackPage(this.parentElement,true)">Show more items</button>' : '') + '</div>';
        }

function appendManagerAssignedFallbackPage(scroller, force = false) {
    const more = scroller.querySelector('[data-assigned-more]');
    if (!more || (!force && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 400)) return;
    const rows = getManagerAssignedSelectionSnapshot().rows;
    const body = scroller.querySelector('tbody');
    const start = body.rows.length;
    const batch = rows.slice(start, start + 150);
    const template = document.createElement('template');
    template.innerHTML = renderManagerAssignedFallbackRows(batch);
    body.append(...template.content.querySelectorAll('tbody tr'));
    getManagerAssignedColumnState().fallbackLimit = body.rows.length;
    if (body.rows.length >= rows.length) more.remove();
}

// Canonical Available-based depletion; zero is a real quantity, never a missing value.
function calculateLiveLocPhotoMatch(row = {}, note = null) {
    const number = (...values) => { for (const value of values) { if (value == null || String(value).trim() === '') continue; const parsed = Number(String(value).replace(/,/g, '').replace(/%$/, '')); if (Number.isFinite(parsed)) return Math.max(0, parsed); } return null; };
    const currentOnHand = [row.onhand, row.ONHAND, row.PTRONHAND, row.ptronhand, row.ptr_onhand, row.ON_HAND, row.on_hand, row.loc_on_hand].map(value => number(value)).find(value => value > 0) ?? 0;
    const available = number(row.available, row.AVAILABLE, row.PTRAVAILABLE, row.ptravailable, row.ptr_available, row.LOC_AVAILABLE, row.loc_available) ?? currentOnHand;
    const pct = number(note?.match_pct, note?.loc_match_pct, note?.LOC_MATCH_PCT, note?.MATCH_PCT, note?.MATCH, note?.match, row.LOC_MATCH_PCT, row.loc_match_pct, row.MATCH_PCT, row.match_pct, row.MATCH, row.match) ?? 0;
    const baseline = number(note?.eval_baseline_available, note?.EVAL_BASELINE_AVAILABLE, row.eval_baseline_available, row.EVAL_BASELINE_AVAILABLE) ?? Math.max(currentOnHand, available);
    const initial = number(note?.initial_loc_photo_match, note?.INITIAL_LOC_PHOTO_MATCH, row.initial_loc_photo_match, row.INITIAL_LOC_PHOTO_MATCH)
        ?? number(note?.initial_photo_match_qty, note?.INITIAL_PHOTO_MATCH_QTY, row.INITIAL_PHOTO_MATCH_QTY, row.initial_photo_match_qty)
        ?? number(...[note?.LOC_PHOTO_MATCH,note?.loc_photo_match,note?.LOC_MATCH_QTY,note?.loc_match_qty,row.LOC_PHOTO_MATCH,row.loc_photo_match,row.LOC_MATCH_QTY,row.loc_match_qty].filter(value => Number(value)>0))
        ?? Math.round(Math.min(100, pct) * baseline / 100);
    return Math.max(0, Math.min(available, initial - Math.max(0, baseline - available)));
}

function hasLockableInventoryEvidence(row) {
    if (!row) return false;
    const photos = getPhotoUrlList(row.PHOTO_LINK || row.photo_link || row.PHOTO_URL || row.photo_url || row.PHOTOS || row.photos || '');
    if (!photos.length) return false;
    const stored = row.LOC_PHOTO_MATCH ?? row.loc_photo_match ?? row.LOC_MATCH_QTY ?? row.loc_match_qty;
    if (stored != null && String(stored).trim() !== '' && !(Number(stored)>0)) return false;
    return calculateLiveLocPhotoMatch(row)>0;
}
function isCompletedInventoryRow(item = null) {
    return !!item && (item.completed === true || String(item.DATE_COMPLETED || item.date_completed || item.completed_at || '').trim() !== '')
        && (String(item.SOURCE_TABLE || item.source_table || 'ph_master_inventory') !== 'ph_master_inventory' || hasLockableInventoryEvidence(item));
}

function getCompletedRowUnlockKey(item = activeItem) {
    return item ? String(item.MASTER_UNIQUE_ID || item.master_unique_id || item.MASTER_ID || item.master_id || item.UNIQUE_ID || item.unique_id || '') : '';
}

function syncCompletedRowControls(prefix, item = activeItem) {
    if (!item || item !== activeItem) return;
    const completed = isProtectedSectionCompleted(prefix, item), locked = completed && !isProtectedUnlocked(prefix);
    const button = document.getElementById(prefix + 'btn-save-complete');
    if (button) {
        button.textContent = completed && locked ? '✅ COMPLETED' : 'MARK DONE';
        button.disabled = locked || !canEditRowDetails(prefix, item);
        button.classList.toggle('completed-row-button', completed && locked);
        button.classList.toggle('row-ready-to-complete', !button.disabled && !locked);
    }
    const config = getProtectedEditConfig(prefix);
    const container = config && document.getElementById(config.containerId);
    if (container) container.dataset.completedLocked = String(locked);
    // Keep existing image nodes mounted; change only edit controls, including photo arrows/delete.
    document.querySelectorAll('#view-detail button[onclick], #view-detail input[type="file"]').forEach(control => {
        const action = control.getAttribute('onclick') || '';
        if (control.type !== 'file' && !/promptPhotoDelete|removePhoto|reorderPhoto|moveSavedPhoto|movePhoto|PhotoPicker|Camera/.test(action)) return;
        if (locked) { if (!control.hasAttribute('data-completion-disabled')) control.dataset.completionDisabled = String(control.disabled); control.disabled = true; }
        else if (control.hasAttribute('data-completion-disabled')) { control.disabled = control.dataset.completionDisabled === 'true'; delete control.dataset.completionDisabled; }
    });
}

function beginOptimisticCompletedRow(item, prefix, payload) {
    const fields = ['DATE_COMPLETED','date_completed','completed','completed_at','eval_baseline_available','EVAL_BASELINE_AVAILABLE','initial_loc_photo_match','INITIAL_LOC_PHOTO_MATCH','LOC_PHOTO_MATCH','loc_photo_match'];
    const key = getCompletedRowUnlockKey(item);
    const master = masterInventoryById.get(key);
    const rows = master && master !== item ? [item, master] : [item];
    const overrides = getManagerAssignedColumnState().unlockedRowsByKey;
    const wasUnlocked = overrides?.delete(key);
    const snapshots = rows.map(row => ({row, values: fields.map(key => [key, Object.hasOwn(row,key), row[key]])}));
    const available = parseAppNumber(getCardPtrAvailableValue(item, {preserveUnknown:true})) ?? parseAppNumber(firstNonEmptyValue(item.PTRONHAND,item.ptronhand,item.onhand,0)) ?? 0;
    const pct = parseAppNumber(firstNonEmptyValue(payload.match,item.MATCH,item.match,item.LOC_MATCH_PCT,item.loc_match_pct,0)) || 0;
    const completedAt = new Date().toISOString(), initial = Math.round(Math.max(0,available)*pct/100);
    rows.forEach(row => Object.assign(row, {completed:true,completed_at:completedAt,DATE_COMPLETED:completedAt,date_completed:completedAt,
        eval_baseline_available:Math.max(0,available),EVAL_BASELINE_AVAILABLE:Math.max(0,available),initial_loc_photo_match:initial,INITIAL_LOC_PHOTO_MATCH:initial,LOC_PHOTO_MATCH:initial,loc_photo_match:initial}));
    payload.date_completed = completedAt;
    clearDetailMeasurementKeyboardKeepAlive();
    closeDetailMeasurementKeyboard(false, {blur:true});
    document.querySelectorAll('input,textarea,[contenteditable="true"]').forEach(input => input.blur());
    Object.keys(PROTECTED_EDIT_CONFIG).forEach(key => { protectedEditState[key] = false; });
    if (item === activeItem) applyProtectedEditState(prefix);
    // Paint existing card badges without rebuilding cards or their photos.
    document.querySelectorAll('[data-completed-row]').forEach(badge => { if (badge.dataset.completedRow === getCompletedRowUnlockKey(item)) { badge.hidden = false; badge.textContent = '✅ COMPLETED'; } });
    showToast('Success', 'Task Completed! Saving in background.');
    return () => {
        if (wasUnlocked) overrides.set(key, true);
        snapshots.forEach(({row,values}) => values.forEach(([key,exists,value]) => { if(exists)row[key]=value;else delete row[key]; }));
        if (item === activeItem) { protectedEditState[prefix] = getCompletedRowUnlockKey(item); refreshProtectedSections(); }
        document.querySelectorAll('[data-completed-row]').forEach(badge => { if(badge.dataset.completedRow===getCompletedRowUnlockKey(item))badge.hidden=!isCompletedInventoryRow(item); });
    };
}

function buildCompletedRowBadge(item) {
    return '<span class="completed-row-badge" data-completed-row="'+escapeHtml(getCompletedRowUnlockKey(item))+'"'+(isCompletedInventoryRow(item)?'':' hidden')+'>✅ COMPLETED</span>';
}

function buildEvalOwnerBadge(item) {
    return '<span class="card-eval-owner">EVAL: ' + escapeHtml(getSuspendEvalOwner(item) || 'Unassigned') + '</span>';
}

async function mirrorConfirmedItemcodeOwners(codes, assignee, scope) {
    const headers=await getNativeAuthRequestHeaders();
    if (!headers || scope!==getSupabaseReadIdentityScope()) return;
    // The RPC owns revisions and assignment propagation. Ignore duplicates so a late mirror
    // can never overwrite a newer manager command; the existing DB trigger repeats authorization.
    const response=await window.GncDatabase.fetchTable(SUPABASE_URL,'ph_itemcode_default_owners','on_conflict=itemcode_normalized',{
        method:'POST',headers:{...headers,'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'},
        body:JSON.stringify(codes.map(itemcode_normalized=>({itemcode_normalized,assignedto:assignee||null})))
    },10000,'Owner persistence');
    if(!response.ok)throw await createSupabaseReadResponseError(response,'Owner mirror failed');
}

function getAssignedQueueOwner(row, index = getCardEvalOwnerIndex(getManagerAssignedColumnState(), true)) {
    const code = buildManagerEvalAssignmentKey(row?.ITEMCODE || row?.itemcode || row?.ITEM || row?.item);
    return index.exact.get(code) || index.family.get(code.slice(0, 6)) || '';
}

function resolveInventoryRowOwner(row) {
    const assigned = getAssignedQueueOwner(row);
    if (assigned) return assigned;
    for (const key of ['eval_user', 'default_owner', 'effective_worker', 'default_assignedto', 'assignedto']) {
        const owner = normalizeEvalAssignableUser(row?.[key] || row?.[key.toUpperCase()]);
        if (owner && !['unassigned', 'none', 'null', 'n_a'].includes(owner)) return owner;
    }
    return '';
}

function resolveCanonicalRowAccess(user, row) {
    const actor = normalizeEvalAssignableUser(user);
    const named = GLOBAL_LIVE_CHANGE_USER_KEYS.has(actor);
    const matrix = actor && !named ? resolveUserAccessMatrix(actor) : null;
    const role = String(matrix?.role || (actor === normalizeEvalAssignableUser(currentUser) ? currentRole : '') || '').trim().toUpperCase().replace(/[ _-]/g, '');
    const power = named
        || ['SUPERADMIN','ADMIN','ADMINISTRATOR'].includes(role) || matrix?.edit_any_row === 'Y';
    const scoped = ['EVAL','EVALUATOR'].includes(role) || matrix?.edit_assigned_rows_only === 'Y';
    const canEdit = !!(actor && row && (power || scoped && resolveInventoryRowOwner(row) === actor || role === 'MANAGER' && !matrix?.verified));
    return { canView: !!(actor && row), canEdit, canUnlock: canEdit, canReclass: canEdit,
        canUploadPhoto: canEdit, canCompleteTag: canEdit, canManageLocations: canEdit };
}

function canUserEditRow(user, row) {
    return resolveCanonicalRowAccess(user, row).canEdit;
}
function canUserUnlockRow(user, row) {
    return !!row && (resolveCanonicalRowAccess(user, row).canUnlock
        || user === currentUser && /^(?:SUPERADMIN|ADMIN|ADMINISTRATOR|MANAGER|QCSUPERVISOR)$/.test(String(currentRole || '').toUpperCase().replace(/[ _-]/g,'')));
}
function canUserReclassRow(user, row) {
    return resolveCanonicalRowAccess(user, row).canReclass;
}
function canUserUploadRowPhoto(user, row) {
    return resolveCanonicalRowAccess(user, row).canUploadPhoto;
}

function queueAccessScope(tab = 'suspend-tag') {
    const user = normalizeEvalAssignableUser(currentUser).replace(/^nally_aguilar$/, 'nelly_aguilar');
    const request = tab === 'pending';
    const matrix = globalThis.GncUserAccessControl?.resolveUserAccessMatrix(user);
    const flag = request ? matrix?.view_all_requests : matrix?.view_all_suspend;
    const fallback = (request ? ['dylan_collyge','jd_jones','megan_kelly','nelly_aguilar','morgan_anderson'] : ['dylan_collyge','jd_jones','megan_kelly']).includes(user);
    const all = flag == null ? fallback : flag === 'Y';
    const initial = request ? matrix?.request_default_scope : matrix?.suspend_default_scope;
    return { user, all, initial:all && (initial || (request || user === 'jd_jones' ? 'ALL' : 'OWN')) === 'ALL' ? 'ALL' : user };
}

function getQueueScopeFilter(tab) {
    const policy = queueAccessScope(tab);
    const state = getManagerAssignedColumnState();
    const signature = [policy.user, policy.all, policy.initial].join('|');
    state.queueScopeFilters ||= {};
    let choice = state.queueScopeFilters[tab];
    if (!choice || choice.signature !== signature) choice = state.queueScopeFilters[tab] = {signature, value:policy.initial};
    return policy.all ? choice.value : policy.user;
}

function isQueueOwnerVisible(row, tab = isDockSuspendDcRequestMirrorRow(row) ? 'suspend-tag' : 'pending') {
    const selected = getQueueScopeFilter(tab);
    return selected === 'ALL' || !!selected && (getAssignedQueueOwner(row) || 'Unassigned') === selected;
}

function getWatchdogQueueAudit(root) {
    const counts = getActiveAssignedQueueCounts();
    return {total:getRequestQueueAlertCount(counts), foreign:['pending','suspend-tag'].includes(activeReqTab) && !queueAccessScope(activeReqTab).all && !!root?.querySelector('[data-watchdog-foreign-owner="true"]')};
}

function watchdogQueueOwnerMismatch(row) {
    const owner = getAssignedQueueOwner(row);
    return !!owner && owner !== normalizeEvalAssignableUser(currentUser);
}

function openRuntimeWatchdogFromHeader() {
    if (!['dylan_collyge','megan_kelly','jd_jones'].includes(String(currentUser || '').trim().toLowerCase())) return false;
    if (getCurrentVisibleViewId() !== 'managers') switchView('managers');
    setHomeTab(MANAGER_RUNTIME_WATCHDOG_VIEW);
    return false;
}

function getActiveAssignedQueueCounts(personal = false) {
    const state = getManagerAssignedColumnState();
    const requestAllowed = !!getRequestCapabilities()?.canViewQueue;
    const suspendAllowed = canReadSuspendQueue();
    const source = getDockSuspendDcSourceRows();
    const signature = [resolvedViewStateEpoch, state.dataEpoch, getSuspendEvalUserFilter('pending'), getSuspendEvalUserFilter('suspend-tag'), requestAllowed, suspendAllowed,
        getDatasetLoadSignature('requests'), getDatasetLoadSignature('suspendTag'), getDatasetLoadSignature('soc')].join('|');
    const slot = personal ? 'personalQueueCounts' : 'activeQueueCounts';
    const previous = state[slot];
    if (personal && previous && previous.signature === signature && previous.requests === requestsInventory && previous.source === source) return previous.counts;
    const actor = normalizeEvalAssignableUser(currentUser);
    const visible = (row, tab) => personal ? !!actor && getAssignedQueueOwner(row) === actor : isQueueOwnerVisible(row, tab);
    const requests = new Set();
    if (requestAllowed) for (const row of requestsInventory) {
        if (!isRegularRequestQueueItem(row) || !visible(row, 'pending') || !isRequestPendingVisible(row)) continue;
        const uid = getItemUniqueId(row);
        if (uid) requests.add(uid);
    }
    const counts = { pending: requests.size, 'suspend-tag': suspendAllowed ? countPendingSuspendTagQueueItems([], source, row => visible(row, 'suspend-tag')) : 0 };
    state[slot] = {signature, requests:requestsInventory, source, counts};
    return counts;
}

function getPhysicalSuspendTagKey(row) {
    const uid = getDockSuspendDcRequestSourceUid(row).replace(/^dock_suspend_dc_/i, '');
    if (uid) return 'uid:' + uid;
    const id = row?.soc_order_key || row?.id;
    if (id != null && id !== '') return 'soc:' + id;
    const fields = ['itemcode','dock','drop','consignee','locationcode'].map(key => row?.[key] || row?.[key.toUpperCase()] || '');
    return fields.every(Boolean) ? JSON.stringify(fields) : '';
}

function uniquePhysicalSuspendTags(rows) {
    const seen = new Set();
    return rows.filter(row => {
        const key = getPhysicalSuspendTagKey(row);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getCardEvalOwnerIndex(state, assignedItemsOnly = false) {
    const defaults = state.itemcodeDefaultOwners || state.defaultOwnersByCode;
    const inventory = assignedItemsOnly ? null : state.fullInventory || fullInventory;
    const cacheKey = assignedItemsOnly ? 'suspendAssignedOwners' : 'cardEvalOwners';
    const previous = state[cacheKey];
    if (previous && previous.defaults === defaults && previous.inventory === inventory && previous.epoch === state.dataEpoch) return previous;
    const exact = new Map(), votes = new Map(), family = new Map();
    const remember = (code, value, override) => {
        code = buildManagerEvalAssignmentKey(code);
        const owner = normalizeEvalAssignableUser(value);
        if (code && owner && !['none','null','unassigned','n_a'].includes(owner) && (override || !exact.has(code))) exact.set(code, owner);
    };
    for (const row of inventory || []) {
        if (row.present_in_drive === false) continue;
        remember(row.ITEMCODE || row.itemcode, row.default_owner || row.DEFAULT_OWNER || row.default_assignedto || row.DEFAULT_ASSIGNEDTO ||
            row.effective_worker || row.EFFECTIVE_WORKER || row.eval_user || row.EVAL_USER || row.assignedto || row.ASSIGNEDTO, false);
    }
    defaults?.forEach((row, key) => remember(row.itemcode_normalized || row.itemcode || row.ITEMCODE || key,
        typeof row === 'string' ? row : row.assignedto || row.default_owner || row.DEFAULT_OWNER, true));
    // Each distinct size votes once, even when one size is stocked in many lots.
    for (const [code, owner] of exact) {
        const stem = code.split('.')[0];
        if (!/^\d{6}$/.test(stem)) continue;
        if (!votes.has(stem)) votes.set(stem, new Map());
        const counts = votes.get(stem);
        counts.set(owner, (counts.get(owner) || 0) + 1);
    }
    for (const [stem, counts] of votes) {
        const winners = [...counts].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        family.set(stem, winners[0][0]);
    }
    const codesByOwner = new Map();
    if (assignedItemsOnly) {
        for (const [code, owner] of exact) {
            if (!codesByOwner.has(owner)) codesByOwner.set(owner, new Set());
            codesByOwner.get(owner).add(code);
        }
        state.ownerByExactItemcodeMap = exact;
        state.ownerByPrefix6Map = family;
        state.usersWithAssignedItemsSet = new Set(exact.values());
    }
    return state[cacheKey] = { defaults, inventory, epoch: state.dataEpoch, exact, family, codesByOwner };
}

function resolveSuspendOwner(item) {
    const code = buildManagerEvalAssignmentKey(item?.ITEMCODE || item?.itemcode || item?.ITEM || item?.item);
    const suspend = item?.DOCK_SUSPEND_DC_REQUEST === true || isDockSuspendDcRequestSource(item);
    const {exact, family} = getCardEvalOwnerIndex(getManagerAssignedColumnState(), suspend);
    const owner = exact.get(code) || family.get(code.split('.')[0]);
    if (owner) return owner;
    if (suspend) return normalizeEvalAssignableUser(item?.suspend_eval_owner || item?.SUSPEND_EVAL_OWNER) || 'Unassigned';
    for (const field of ['eval_user','assigned_user','default_owner','effective_worker','assignedto']) {
        // A Dock mirror may synthesize ASSIGNEDTO from the sales rep. Only a physical assignment is an evaluator.
        const raw = field === 'assignedto' && item?.DOCK_SUSPEND_DC_REQUEST ? item.suspend_source_assignedto : item?.[field] || item?.[field.toUpperCase()];
        const assigned = normalizeEvalAssignableUser(raw);
        if (assigned && !['none','null','unassigned','n_a'].includes(assigned)) return assigned;
    }
    return 'Unassigned';
}

function getSuspendEvalOwner(item) {
    return resolveSuspendOwner(item);
}

function isSuspendTabAvailable() {
    if (queueAccessScope('suspend-tag').all) return true;
    // Keep authorized cached navigation until ownership and a complete source are both known.
    const state = getManagerAssignedColumnState();
    if (!(state.itemcodeDefaultOwners || state.defaultOwnersByCode) || !(suspendTagRawSourceRowsReady || socRawSourceRowsReady)) return true;
    return getActiveAssignedQueueCounts(true)['suspend-tag'] > 0;
}

function getSuspendEvalUserFilter(tab = activeReqTab) {
    return getQueueScopeFilter(tab === 'pending' ? 'pending' : 'suspend-tag');
}

function buildSuspendEvalUserFilter(items = [], id = 'suspend-eval-user-filter') {
    const tab = id === 'request-eval-user-filter' ? 'pending' : 'suspend-tag';
    if (!queueAccessScope(tab).all) return '';
    const { exact } = getCardEvalOwnerIndex(getManagerAssignedColumnState(), true);
    const counts = new Map(Array.from(new Set(exact.values()), owner => [owner, 0]));
    for (const item of items) {
        const owner = getAssignedQueueOwner(item) || 'Unassigned';
        if (owner === 'Unassigned' || counts.has(owner)) counts.set(owner, (counts.get(owner) || 0) + 1);
    }
    const selected = getSuspendEvalUserFilter(tab);
    const option = (value, label, count) => '<option value="'+escapeHtml(value)+'"'+(value === selected ? ' selected' : '')+'>'+escapeHtml(label)+' ('+count+')</option>';
    const options = [...counts.keys()].filter(user => user !== 'Unassigned').sort().map(user => option(user,user,counts.get(user)));
    if (counts.has('Unassigned')) options.push(option('Unassigned','Unassigned',counts.get('Unassigned')));
    return '<label class="workflow-control"><span>Assigned User / Eval User</span><select id="'+id+'" onchange="return setSuspendEvalUserFilter(this.value)">'+option('ALL',id === 'request-eval-user-filter' ? 'All Requests' : 'All Suspend Tags',items.length)+options.join('')+'</select></label>';
}

function setSuspendEvalUserFilter(value = 'ALL') {
    const tab = activeReqTab === 'pending' ? 'pending' : 'suspend-tag';
    getSuspendEvalUserFilter(tab);
    if (queueAccessScope(tab).all) {
        const user = normalizeEvalAssignableUser(value);
        requestSuspendEvalUserFilter = user === 'all' ? 'ALL' : user === 'unassigned' ? 'Unassigned' : user;
        getManagerAssignedColumnState().queueScopeFilters[tab].value = requestSuspendEvalUserFilter;
    }
    requestScopedItemsCacheKey = '';
    markViewDirty('request');
    renderRequest();
    paintFooterRequestBadgeOnly();
    return false;
}

function refreshSuspendOwnerViews() {
    requestScopedItemsCacheKey = '';
    for (const view of ['request','drive','av']) markViewDirty(view);
    if (isViewVisible('request')) scheduleHydratedViewRender('request');
    else if (isViewVisible('drive') || isViewVisible('av')) scheduleDeferredVisibleDirtyViewRefresh('eval-owners');
    paintFooterRequestBadgeOnly();
}

function replaceDetailMediaPreservingImages(container, html) {
    if (!container) return;
    const template=document.createElement('template'); template.innerHTML=html;
    const images=new Map();
    container.querySelectorAll('img').forEach(img=>{const key=img.getAttribute('data-src')||img.getAttribute('src');if(!images.has(key))images.set(key,[]);images.get(key).push(img);});
    template.content.querySelectorAll('img').forEach(img=>{const key=img.getAttribute('data-src')||img.getAttribute('src');const retained=images.get(key)?.shift();if(retained)img.replaceWith(retained);});
    container.replaceChildren(template.content);
}

function isProtectedSectionLocked(prefix, item = activeItem) {
            if (prefix === 'req-') return false;
            if (isProtectedSectionCompleted(prefix, item)) return true;
            if (isDriveModePhotoDataEditContext(prefix, item)) {
                if (getRoleAccessState()?.isAdmin) return false;
                if (canCurrentUserUpdateDrivePhotoData(item, prefix)) return false;
                return sectionHasProtectedData(prefix, item);
            }
            return false;
        }

function canReorderProtectedPhoto(prefix, item = activeItem) {
            return !!item && canEditRowDetails(prefix,item) && (!isProtectedSectionCompleted(prefix,item) || isProtectedUnlocked(prefix));
        }

function canUnlockCompletedRow(item = activeItem) {
    return canUserUnlockRow(currentUser, item);
}

function unlockProtectedSection(prefix) {
    const item = activeItem;
    if (!canUnlockCompletedRow(item)) { showRowEditRestrictedToast(prefix); return false; }
    const state = getManagerAssignedColumnState(), key = getCompletedRowUnlockKey(item);
    if (!key) return false;
    const pending = state.pendingRowUnlocks ||= new Map();
    if (pending.has(key)) return false;
    const overrides = state.unlockedRowsByKey ||= new Map();
    const signature = String(item.LAST_UPDATED || item.last_updated || '');
    state.failedRowUnlocks?.delete(key);
    overrides.set(key, true);
    for (const row of new Set([item, masterInventoryById.get(key)])) {
        if (row) Object.assign(row, {completed:false, is_completed:false, locked:false, row_locked:false,
            DATE_COMPLETED:null, date_completed:null, completed_at:null});
    }
    protectedEditState[prefix] = key;
    clearProtectedTimers(prefix);
    applyProtectedEditState(prefix);
    const scope = getSupabaseReadIdentityScope();
    const task = serializeSuspendTagRowWrite({UNIQUE_ID:key}, () => persistCanonicalRowUnlock(state, item, prefix, key, signature, scope), 'unlock|' + signature);
    pending.set(key, task);
    task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    return false;
}

async function persistCanonicalRowUnlock(state, item, prefix, key, signature, scope) {
    const current = () => scope === getSupabaseReadIdentityScope() && state === getManagerAssignedColumnState();
    const delays = [300,800,1600];
    for (let attempt = 0; attempt <= delays.length && current(); attempt++) {
        try {
            const headers = await getNativeAuthRequestHeaders(attempt > 0);
            if (!current()) return false;
            if (!headers?.Authorization) throw Object.assign(new Error('Native sign-in is required to unlock this row.'), {retryable:false});
            const response = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/unlock_drive_evidence_v1', {
                method:'POST', headers, referrerPolicy:'no-referrer',
                body:JSON.stringify({p_master_uid:key,p_expected_signature:signature})
            }, 25000, 'Unlock row');
            const result = await response.json();
            if (!response.ok || result.ok !== true) {
                if (result.message === 'DRIVE_ROW_STALE' && attempt < delays.length) {
                    const fresh = await loadExactMasterDetailRow(key);
                    if (!current() || fresh.__masterDetailRaw?.unique_id !== key) return false;
                    if (!fresh.__masterDetailRaw.date_completed) return true;
                    signature = fresh.__masterDetailRaw.last_updated || '';
                    continue;
                }
                const retryable = response.status >= 500 || [401,429].includes(response.status) || /55P03|lock_not_available|lock timeout|DRIVE_SAVE_BUSY/i.test([result.code,result.message].join(' '));
                throw Object.assign(new Error(result.message || result.code || 'Unlock was not confirmed.'), {retryable});
            }
            if (!current()) return false;
            if (String(result.row?.unique_id || result.row?.UNIQUE_ID || '') !== key) throw Object.assign(new Error('Unlock receipt identity mismatch.'),{retryable:false});
            // Only publish the unlock revision. A late receipt must not overwrite a photo, field draft or subsequent Mark Done.
            for (const row of new Set([item, masterInventoryById.get(key)])) {
                if (row && result.row.last_updated && String(row.LAST_UPDATED || row.last_updated || '') === signature) row.LAST_UPDATED = row.last_updated = result.row.last_updated;
            }
            if (state.unlockedRowsByKey.get(key) === true) state.unlockedRowsByKey.set(key, result.row.last_updated || true);
            return true;
        } catch (error) {
            if (!current()) return false;
            if (error.retryable === false || attempt === delays.length) {
                if (error.retryable !== false || /DRIVE_ROW_STALE/.test(error.message)) {
                    const row = await loadExactMasterDetailRow(key).catch(() => null);
                    if (!current()) return false;
                    if (row && String(row.UNIQUE_ID || row.unique_id) === key && (row.LAST_UPDATED || row.last_updated) !== signature
                        && row.__masterDetailRaw?.date_completed === null && !isCompletedInventoryRow(row)) {
                        state.unlockedRowsByKey.set(key, row.LAST_UPDATED || row.last_updated);
                        return true;
                    }
                }
                (state.failedRowUnlocks ||= new Set()).add(key);
                if (activeItem && getCompletedRowUnlockKey(activeItem) === key) {
                    renderProtectedControls(prefix);
                    showToast('Unlock not confirmed', 'Your edits are retained. Tap Retry Unlock before saving.', true);
                }
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
    }
    return false;
}

function applySuspendEvalUserFilter(items = []) {
    const owner = getSuspendEvalUserFilter();
    return owner === 'ALL' ? items : items.filter(row => isQueueOwnerVisible(row, 'suspend-tag'));
}

function isSuspendPullItemMatch(code, sourceCode) {
    const normalized = value => String(value || '').trim().toUpperCase().replace(/^(\d{6}\.\d{3})\.$/, '$1.1');
    return !!normalized(code) && normalized(code) === normalized(sourceCode);
}

function openSuspendPullPicker(uniqueId) {
    const source = findDockSuspendDcRequestMirrorRowByUniqueId(uniqueId);
    if (!source || !canReadSuspendQueue() || !resolveCanonicalRowAccess(currentUser, source).canManageLocations) return false;
    const scope = getSupabaseReadIdentityScope();
    const dialog = document.createElement('dialog');
    dialog.className = 'suspend-pull-picker';
    dialog.setAttribute('aria-label', 'Change / Add Location');
    dialog.innerHTML = '<h2>Change / Add Location</h2><div data-manual></div><div data-locations></div><footer><button type="button" data-detail>More tag options</button><button type="button" data-cancel>Cancel</button></footer>';
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    document.body.appendChild(dialog);
    dialog.showModal();
    const paint = () => {
        if (!dialog.open) return;
        if (scope !== getSupabaseReadIdentityScope()) { dialog.close(); return; }
        const options = getRequestItemCodeOptionRows(source);
        if (!dialog.querySelector('input')) dialog.querySelector('[data-manual]').innerHTML = buildSuspendManualPullSelector(source, options, true);
        dialog.querySelector('[data-locations]').innerHTML = options.map(row => {
            const loc = row.LOCATIONCODE || row.locationcode;
            const lot = row.LOTCODE || row.lotcode || '';
            return '<article><span>' + escapeHtml([row.ITEMCODE || row.itemcode,lot].filter(Boolean).join(' · ')) + '</span><button type="button" data-add="' + escapeHtml(getRequestItemCodeOptionMasterId(row)) + '">➕ Add Location to Suspend Tag</button><button type="button" data-pull="' + escapeHtml(getRequestItemCodeOptionMasterId(row)) + '">✓ Select Location (' + escapeHtml(loc) + ')</button></article>';
        }).join('');
    };
    dialog.onclick = event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (scope !== getSupabaseReadIdentityScope()) { dialog.close(); return; }
        if (button.hasAttribute('data-enter')) { chooseSuspendPullLocation(source, dialog); return; }
        if (button.hasAttribute('data-add')) { const row = getRequestItemCodeOptionRows(source).find(row => getRequestItemCodeOptionMasterId(row) === button.dataset.add); if (row) void addSelectedDockSuspendDcRequestOptions([row],source).then(paint); return; }
        if (button.hasAttribute('data-pull')) { dialog.close(); void changeSuspendPullLocation(uniqueId, button.dataset.pull, 'replace_location'); }
        if (button.hasAttribute('data-detail')) { dialog.close(); openDockSuspendDcRequestUpdate(uniqueId, { preferredTab:'request', openAvOptions:true }); }
        if (button.hasAttribute('data-cancel')) dialog.close();
    };
    paint();
    if (!getRequestItemCodeOptionRows(source).length) hydrateSuspendTagItemOptions([source]);
    const refresh = suspendTagItemHydration.get(getRequestItemCodeOptionItemCode(source))?.promise;
    if (refresh) void refresh.then(() => { if (dialog.open && scope === getSupabaseReadIdentityScope()) { ensureRequestItemCodeOptionState(source).cachedSignature = ''; paint(); } });
    return false;
}

function buildSuspendLocationOptionActions(source, row) {
    const uid = escJsAttrValue(String(source.UNIQUE_ID || source.unique_id || ''));
    const masterUid = escJsAttrValue(getRequestItemCodeOptionMasterId(row));
    const location = escapeHtml(row.LOCATIONCODE || row.locationcode || '');
    const oldLocation = escapeHtml(source.LOCATIONCODE || source.locationcode || '');
    return '<div class="suspend-location-actions"><label>Split quantity <input type="number" min="1" step="1" aria-label="Split pull quantity" id="suspend-split-' + escapeHtml(masterUid) + '"></label><button type="button" onclick="event.stopPropagation(); return changeSuspendPullLocation(\'' + uid + '\',\'' + masterUid + '\',\'replace_location\')">✓ Select Location (' + location + ')</button><button type="button" onclick="event.stopPropagation(); return changeSuspendPullLocation(\'' + uid + '\',\'' + masterUid + '\',\'split_location\', document.getElementById(\'suspend-split-' + masterUid + '\').value)">➕ Add ' + location + ' to Split Order</button></div>';
}

function showMoreSuspendPullLocations() {
    const state = ensureRequestItemCodeOptionState(activeItem);
    const selector = '[data-request-itemcode-option="true"]';
    const selected = new Set(Array.from(document.querySelectorAll(selector + ':checked'), input => input.value));
    state.visiblePullLimit = (state.visiblePullLimit || 12) + 24;
    renderRequestMatchingInventoryOptions(activeItem, 'request', {skipLoad:true});
    for (const input of document.querySelectorAll(selector)) if (!input.disabled && selected.has(input.value)) input.checked = true;
    syncSuspendAvOptionSelectionControls();
    return false;
}

function buildSuspendManualPullSelector(item, rows, modal = false) {
    const choices = rows.filter(row => !isFalseBlockLocation(row.LOCATIONCODE || row.locationcode));
    const options = choices.map(row => {
        const location = row.LOCATIONCODE || row.locationcode;
        const lot = row.LOTCODE || row.lotcode || '';
        const value = location + (lot ? ' · ' + lot : '');
        return '<option value="' + escapeHtml(value) + '"></option>';
    }).join('');
    const id = modal ? 'suspend-picker-code' : 'suspend-pull-location';
    return '<div class="suspend-manual-pull"><label for="' + id + '">Select / Enter New Location Code</label><input data-pull-code id="' + id + '" list="' + id + '-options" placeholder="F.14.000" autocomplete="off"><datalist id="' + id + '-options">' + options + '</datalist><label>Lot for a new location <input data-pull-lot placeholder="e.g. 27.F1"></label><button type="button" ' + (modal ? 'data-enter' : 'onclick="return chooseSuspendPullLocation()"') + '>➕ Add Location to Suspend Tag</button></div>';
}

function chooseSuspendPullLocation(source = activeItem, dialog = null) {
    const root = dialog || document;
    const value = root.querySelector('[data-pull-code]')?.value.trim().toUpperCase();
    const rows = getRequestItemCodeOptionRows(source).filter(row => {
        const location = String(row.LOCATIONCODE || row.locationcode || '').toUpperCase();
        const lot = String(row.LOTCODE || row.lotcode || '').toUpperCase();
        return location && !isFalseBlockLocation(location) && (value === location || value === location + ' · ' + lot);
    });
    const uid = source.UNIQUE_ID || source.unique_id;
    if (rows.length === 1) {
        dialog?.close();
        return addSelectedDockSuspendDcRequestOptions(rows,source);
    }
    if (rows.length > 1) { showToast('Select a lot', 'Choose the exact lot on its card below.', true); return false; }
    const lot = String(root.querySelector('[data-pull-lot]')?.value || source.LOTCODE || source.lotcode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:\.[A-Z0-9]+){1,2}$/.test(value || '') || isFalseBlockLocation(value) || !/^\d{2}\.(?:F1|S1|U1|U2|U3|X|Y|Z)$/.test(lot)) {
        showToast('Select a pull row', 'Enter a real location and its lot, or choose a listed row.', true); return false;
    }
    dialog?.close();
    return addSelectedDockSuspendDcRequestOptions([],source,[{locationcode:value,lotcode:lot}]);
}

function isFalseBlockLocation(location = '') {
    return /^0+\.0+\.111$/i.test(String(location || '').trim());
}

function confirmSuspendLocationChange(source, locations) {
    const order = getDockSuspendDcRequestGroupParts(source);
    const old = String(source.LOCATIONCODE || source.locationcode || '');
    const next = locations.join(', ');
    const item = [source.COMMONNAME || source.commonname, source.CONTSIZE || source.contsize].filter(Boolean).join(' ');
    const dock = 'Dock ' + order.dock + ' · Drop ' + order.drop;
    const message = [item + ' · ' + (source.ITEMCODE || source.itemcode),
        dock + ' · Qty ' + getDockOrderedQtyDisplay(source) + ' · ' + order.consignee,
        'Pull Order From: ' + next + '\nPrevious: ' + old + (isFalseBlockLocation(old) ? ' FALSE BLOCK' : ''),
        'Confirming will update Docks (' + dock + ') to pull from ' + next + ', remove FALSE BLOCK and all candidate and selected Suspend Tag rows for this order, and keep all photos and evaluation data in Drive Mode, AV, and Docks.'].join('\n\n');
    return showAppConfirm(message, {title:'Confirm Final Pull Location', tone:'suspend-location', confirmLabel:'✓ Confirm & Update Docks', cancelLabel:'Cancel'});
}

function previewSuspendPullAllocation(target, source, masterUid) {
    const location = target.LOCATIONCODE || target.locationcode;
    const lot = target.LOTCODE || target.lotcode || '';
    const quantity = Math.abs(parseAppNumber(getDockOrderedQtyDisplay(source)) || 0);
    const changes = [];
    if (masterUid && quantity && (location !== (source.LOCATIONCODE || source.locationcode) || lot !== (source.LOTCODE || source.lotcode || ''))) {
        const rows = new Set([masterInventoryById.get(masterUid), ...avOpenInventory.filter(row => getRequestItemCodeOptionMasterId(row) === masterUid)]);
        for (const row of rows) {
            if (!row) continue;
            const before = [row.PTRREVIEWED, row.ptrreviewed];
            const next = String((parseAppNumber(before[0] ?? before[1]) || 0) + quantity);
            row.PTRREVIEWED = row.ptrreviewed = next;
            changes.push({row,before,next});
        }
        markViewDirty('drive'); markViewDirty('av');
    }
    return () => {
        for (const {row,before,next} of changes) if (row.PTRREVIEWED === next && row.ptrreviewed === next) [row.PTRREVIEWED,row.ptrreviewed] = before;
        markViewDirty('drive'); markViewDirty('av');
    };
}

async function changeSuspendPullLocation(uniqueId, masterUid, operation, splitQuantity = null, customRow = null) {
    const source = findDockSuspendDcRequestMirrorRowByUniqueId(uniqueId);
    if (!source || !resolveCanonicalRowAccess(currentUser, source).canManageLocations || !['replace_location','split_location','remove_location'].includes(operation)) return false;
    if (operation === 'split_location' && (!Number.isFinite(Number(splitQuantity)) || Number(splitQuantity) <= 0)) {
        showToast('Split Quantity','Enter the quantity to pull from this location.',true);
        return false;
    }
    const target = customRow || (masterUid && getRequestItemCodeOptionRows(source).find(row => getRequestItemCodeOptionMasterId(row) === masterUid));
    if (operation !== 'remove_location' && (!target || isFalseBlockLocation(target.LOCATIONCODE || target.locationcode))) return false;
    const scope = getSupabaseReadIdentityScope();
    const next = target && (target.LOCATIONCODE || target.locationcode);
    const old = source.LOCATIONCODE || source.locationcode;
    const reviewed = getSuspendTagStableSourceIdentity(source);
    if (next && operation === 'replace_location' && !await confirmSuspendLocationChange(source, [next])) return false;
    if (scope !== getSupabaseReadIdentityScope()) return false;
    const sourceUid = getDockSuspendDcRequestSourceUid(source);
    const key = JSON.stringify([operation,sourceUid,masterUid,customRow,splitQuantity,reviewed]);
    return serializeSuspendTagRowWrite(source, async () => {
        const original = findDockSuspendDcRequestSourceRow(source) || source;
        if (scope !== getSupabaseReadIdentityScope() || JSON.stringify(getSuspendTagStableSourceIdentity(original)) !== JSON.stringify(reviewed)
            || !resolveCanonicalRowAccess(currentUser, original).canManageLocations) return false;
        const state = getDockSuspendCompletionState();
        const snapshot = Object.fromEntries(Object.entries(original).map(([key,value])=>[key.toLowerCase(),value]));
        snapshot.unique_id = sourceUid;
        const pending = state.pending[key] || {requestId:crypto.randomUUID(),savedAt:Date.now()};
        const payload = {sourceUid,...(operation==='replace_location' ? {finalPull:true} : {}),sourceIdentity:reviewed,expectedLastUpdated:getDockSuspendCompletionRevision(original),inventoryIds:masterUid?[masterUid]:[],
            ...(customRow ? {customRows:[customRow]} : {}), ...(operation==='split_location'?{splitQuantity:Number(splitQuantity)}:{})};
        // An uncertain retry must replay exactly the original command, including its version.
        pending.payload ||= payload;
        if (!Object.hasOwn(pending,'version')) pending.version = getSuspendTagWriteVersion(source);
        state.pending[key]=pending; persistDockSuspendCompletionState(state);
        let preview = false, rollbackAllocation;
        try {
            if (operation === 'replace_location') {
                rollbackAllocation = previewSuspendPullAllocation(target, original, masterUid);
                const entry = buildDockSuspendDcOptionSocEntry(target, source);
                if (entry) {
                    applySuspendCandidateRows([{...snapshot, ...entry.payload, unique_id:sourceUid}], {preview:true});
                    preview = true;
                }
            } else if (operation === 'remove_location') {
                applySuspendCandidateRows([{...snapshot,suspend_candidate_state:'replaced',suspend:null,suspend_to:null,quantityordered:'0'}]);
                preview = true;
            }
            const readCommitted = async () => {
                if (operation !== 'replace_location' || scope !== getSupabaseReadIdentityScope()) return null;
                const page = query => fetchAuthenticatedSupabaseReadPage('ph_soc_master', 'select=*&' + query);
                const origin = original.SUSPEND_ORIGIN_UID || original.suspend_origin_uid || sourceUid;
                const prior = (await page('unique_id=eq.' + encodeURIComponent(origin) + '&limit=1')).rows?.[0];
                if (!prior || prior.unique_id !== origin || scope !== getSupabaseReadIdentityScope() || prior.suspend || !prior.date_completed ||
                    prior.suspend_candidate_state !== 'approved' || prior.locationcode !== next || String(prior.lotcode || '') !== String(target.LOTCODE || target.lotcode || '')) return null;
                const rows = (await page('suspend_origin_uid=eq.' + encodeURIComponent(origin) + '&limit=1000')).rows || [];
                if (rows.some(row => row.suspend || !row.date_completed)) return null;
                const inventory = await fetchAuthenticatedSupabaseReadPage('ph_master_inventory','select=*&unique_id=eq.' + encodeURIComponent(masterUid) + '&limit=1');
                return inventory.rows?.length === 1 ? {ok:true,finalPull:true,originUid:origin,rows:[prior,...rows.filter(row => row.unique_id !== origin)],inventoryRows:inventory.rows} : null;
            };
            const result = await suspendTagApi(operation,pending.payload,{commandId:pending.requestId,expectedVersion:pending.version,readCommitted});
            if (scope !== getSupabaseReadIdentityScope()) return false;
            if (!result?.ok || !Array.isArray(result.rows)) throw new Error('The order line was not confirmed. Retry safely.');
            const order = getDockSuspendDcRequestGroupParts(original);
            if (operation === 'replace_location' && (!result.finalPull || !result.rows.some(row =>
                (row.unique_id === sourceUid || row.suspend_origin_uid === (original.SUSPEND_ORIGIN_UID || original.suspend_origin_uid || sourceUid))
                && row.locationcode === next && String(row.lotcode || '') === String(target.LOTCODE || target.lotcode || '')
                && String(row.dock_num || row.dock) === String(order.dock) && String(row.stopnumber) === String(order.drop)
                && row.date_completed && !row.suspend && !['denied','replaced','canceled'].includes(row.suspend_candidate_state)))) throw new Error('The server did not confirm this pull location.');
            delete state.pending[key]; persistDockSuspendCompletionState(state);
            requestAvOptionsDropdownOpen=false;
            if (isViewVisible('detail')) {lastView='request';goBackFromDetail();}
            scheduleRequestRender(0,16,true);
            if (operation === 'replace_location') showToast('Location Changed', 'Updated ' + old + ' → ' + next + ' across Suspend Tag, Drive Mode, and Dock ' + order.dock + ' · Drop ' + order.drop + '.');
            else showToast('Location Saved','The exact Dock and Drop now use the confirmed pull locations.');
        } catch (error) {
            if (scope === getSupabaseReadIdentityScope()) {
                rollbackAllocation?.();
                if (preview) applySuspendCandidateRows([snapshot]);
                showToast('Location Not Saved',suspendTagErrorMessage(error),true);
            }
        }
        return false;
    }, key);
}

function toggleArgosReclassRowCard(button = null) {
            const card = button && button.closest ? button.closest('[data-reclass-row-card]') : null;
            if (!card) return false;
            if (card.getAttribute('data-reclass-row-expanded') === 'true') {
                card.setAttribute('data-reclass-row-expanded','false');
                button.setAttribute('aria-expanded','false');
                argosInventoryTransactionState?.expandedReclassRows?.delete(card.getAttribute('data-reclass-row-card'));
                return false;
            }
            const uid = card.getAttribute('data-reclass-row-card');
            const state = argosInventoryTransactionState;
            const identity = getArgosReclassLiveEditIdentityKey();
            const entry = getArgosReclassRowEditorEntry(uid);
            if (!entry) return false;
            const values = entry.values || {};
            const item = document.getElementById('argos-inventory-transaction-title')?.textContent || '';
            const metrics = [['OH', values.ptronhand], ['REV', values.ptrreviewed || 0], ['AVL', values.ptravailable], ['PRI', values.priority || '—']];
            const summary = '<strong>' + escapeHtml(values.locationcode || 'Unassigned') + ' · Lot ' + escapeHtml(values.lotcode || '—') + '</strong><p>' + escapeHtml(item) + '</p><div class="argos-reclass-confirm-metrics">' + metrics.map(([label,value]) => '<span>' + label + ': ' + escapeHtml(String(value ?? '—')) + '</span>').join('') + '</div>';
            return showArgosReclassConfirmation('Open This Row for Reclass?', summary, () => {
                if (argosInventoryTransactionState === state && identity === getArgosReclassLiveEditIdentityKey()) focusArgosReclassRow(uid);
            });
        }

function focusArgosReclassRow(uid = '') {
            const state = argosInventoryTransactionState;
            if (!state) return false;
            state.focusedReclassRowUid = String(uid || '');
            state.expandedReclassRows ||= new Set();
            if (uid) state.expandedReclassRows.add(String(uid));
            state.reclassDraftsByRowUid = argosReclassMultiActionState.rowProposals;
            const modal = document.getElementById('argos-inventory-transaction-modal');
            modal.querySelectorAll('[data-reclass-row-card]').forEach(card => {
                const selected = !!uid && card.getAttribute('data-reclass-row-card') === uid;
                card.hidden = false;
                if (selected) card.setAttribute('data-reclass-row-expanded', 'true');
                card.querySelector('.argos-reclass-row-toggle')?.setAttribute('aria-expanded', selected ? 'true' : 'false');
                if (selected) hydrateArgosReclassRowCard(card);
            });
            const body = modal.querySelector('.argos-tx-body');
            if (body) body.scrollTop = 0;
            return false;
        }

function refreshArgosReclassMultiActionUi() {
            document.querySelectorAll('[data-reclass-row-card]').forEach((card) => {
                const body = card.querySelector('[data-reclass-row-body]');
                const entry = getArgosReclassRowEditorEntry(card.getAttribute('data-reclass-row-card'));
                if (!entry) return;
                if (body && body.getAttribute('data-reclass-row-hydrated') === 'true') body.innerHTML = buildArgosReclassActionFieldsHtml(entry);
                card.setAttribute('data-reclass-scope-actions', getArgosReclassV3ScopeActionsForEntry(entry).join(','));
                const count = getArgosReclassV3ActionCountForEntry(entry);
                const resolution = getEvalWorkInquiryRowResolution(entry.unique_id);
                card.setAttribute('data-eval-row-resolution', resolution);
                const counter = card.querySelector('[data-reclass-row-edit-count]');
                if (counter) {
                    counter.hidden = count === 0;
                    counter.textContent = `✓ STAGED: ${count} Action${count === 1 ? '' : 's'}`;
                }
                const resolutionBadge = card.querySelector('[data-eval-row-resolution-badge]');
                if (resolutionBadge) {
                    resolutionBadge.setAttribute('data-resolution', resolution);
                    resolutionBadge.textContent = resolution === 'done' ? 'Done' : (resolution === 'no_action' ? 'No Action' : 'Needs Review');
                }
                card.setAttribute('data-reclass-row-edit-count', String(count));
                setArgosReclassAttributeIfChanged(card, 'data-reclass-proposal-signature',
                    getArgosReclassProposalRenderSignature(entry.unique_id, resolution));
            });
            const staged = Array.from(argosReclassRowEditorEntries.values()).filter(entry => getArgosReclassV3ActionCountForEntry(entry) > 0).length;
            const apply = document.getElementById('argos-inventory-transaction-apply');
            if (apply && !apply.disabled) apply.textContent = 'REVIEW & APPLY RECLASS (' + staged + ' Rows)';
            const list = document.querySelector('.argos-reclass-row-list');
            if (list) { let counter = list.querySelector('[data-reclass-staged-count]'); if (!counter) { counter = document.createElement('p'); counter.dataset.reclassStagedCount = ''; list.prepend(counter); } counter.textContent = staged + ' ROWS STAGED'; }
            return true;
        }

// An unentered match is unknown, not an evaluated zero. Docks owns independent evidence.
function isRowPhotoEvaluationExpired(item = null, prefix = '') {
    if (!item || prefix === 'dock-' || String(item.SOURCE_TABLE || item.source_table || '').toLowerCase() === 'ph_dock_assignments') return false;
    const stamp = getPhotoRetentionFallbackDateMs(item);
    if (Number.isFinite(stamp) && isPhotoDateMsExpired(stamp)) return true;
    const match = [item.MATCH,item.match,item.LOC_MATCH_PCT,item.loc_match_pct].find(value => value != null && String(value).trim() !== '');
    return match != null && calculateLiveLocPhotoMatch(item) <= 0;
}

function persistCameraDetailSession() {
    if (!activeItem || !currentUser) return;
    const state = window.GncCameraState;
    if (state) { state.cameraCaptureInFlight = true; state.returnUntil = Date.now() + 15_000; }
    persistAppFilterStateNow();
    try {
        sessionStorage.setItem('agdata_camera_detail_v1',JSON.stringify({owner:getSupabaseReadIdentityScope(),createdAt:Date.now(),row:{...activeItem},rowUid:getCompletedRowUnlockKey(activeItem),source:activeDetailSourceView || lastView || 'drive',tab:activeDetailTab,scrollY:getMainAreaScrollTop(),filterKey:getAppFilterStateStorageKey(),filters:JSON.stringify(readAppFilterStateSnapshot())}));
        window.persistCameraCaptureState?.();
    } catch (_) { /* Camera capture remains usable when storage is disabled. */ }
}

function restoreCameraDetailSession() {
    if (!currentUser) return false;
    try {
        const saved = JSON.parse(sessionStorage.getItem('agdata_camera_detail_v1') || 'null');
        if (!saved) return false;
        if (saved.owner !== getSupabaseReadIdentityScope() || Date.now()-saved.createdAt > 30*60_000) { sessionStorage.removeItem('agdata_camera_detail_v1'); return false; }
        sessionStorage.removeItem('agdata_camera_detail_v1');
        const row = fullInventory.find(item => getCompletedRowUnlockKey(item) === saved.rowUid) || saved.row;
        if (!row || getCompletedRowUnlockKey(row) !== saved.rowUid) return false;
        if (saved.filters && saved.filterKey === getAppFilterStateStorageKey()) {
            try { localStorage.setItem(saved.filterKey,saved.filters); restorePersistedAppFilterStateForCurrentUser(true); } catch (_) { /* Restore the row even if filter storage is unavailable. */ }
        }
        openDetail(saved.rowUid,saved.source,{__masterDetailRow:row,preferredTab:saved.tab || 'location'});
        requestAnimationFrame(() => setMainAreaScrollTop(Number(saved.scrollY)||0));
        window.finishCameraCapture?.();
        return true;
    } catch (_) { return false; }
}


function notifyManagerUnassignedItemsAfterSync(completedRunId = '') {
    if (!currentUser || !completedRunId || !['home','managers'].includes(getCurrentVisibleViewId())) return 0;
    const key = 'gnc_unassigned_completed_sync_v1:' + getSupabaseReadIdentityScope();
    try {
        if (sessionStorage.getItem(key) === completedRunId) return 0;
        sessionStorage.setItem(key, completedRunId);
    } catch (_) { /* The canonical summary also deduplicates the item-code set. */ }
    return notifyManagerUnassignedItems();
}

        function enrichManagerAssignedPlantGroups(rows = []) {
            const state = getManagerAssignedColumnState();
            const sources = [fullInventory, typeof cavInventory !== 'undefined' && cavInventory,
                typeof cropRollDriveInventory !== 'undefined' && cropRollDriveInventory, state.fullInventory,
                state.itemDetails, state.inquiryCoverage, state.items, state.rows, state.defaultOwnersByCode,
                typeof masterInventoryByItemCode !== 'undefined' && masterInventoryByItemCode];
            const sizes = sources.map(source => source?.length ?? source?.size ?? 0);
            const emptyIndex = () => ({ exact:new Map(), base:new Map(), family:new Map(), genusExact:new Map(), genusFamily:new Map() });
            const agree = (map, key, group) => map.set(key, map.has(key) && map.get(key) !== group ? '' : group);
            const indexRow = (index, row) => {
                const code = buildManagerEvalAssignmentKey(row?.ITEMCODE || row?.itemcode || row?.itemcode_normalized);
                const genus = row?.GENUSNAME || row?.genusname || row?.genus_name || row?.genus;
                if (code && genus) { agree(index.genusExact,code,genus); agree(index.genusFamily,code.split('.')[0],genus); }
                const group = getCropRollPlantGroup(row, false) || row?.plantGroup;
                if (!code || !group) return;
                if (!index.exact.has(code)) index.exact.set(code, group);
                agree(index.base, code.split('.').slice(0, 2).join('.'), group);
                agree(index.family, code.split('.')[0], group);
            };
            let cached = state.plantGroupIndex;
            if (!cached || cached.epoch !== state.dataEpoch || sources.some((source, i) => source !== cached.sources[i] || sizes[i] !== cached.sizes[i])) {
                cached = { ...emptyIndex(), epoch: state.dataEpoch, sources, sizes };
                for (const source of new Set(sources)) {
                    for (const entry of source?.values?.() || []) {
                        if (Array.isArray(entry)) entry.forEach(row => indexRow(cached, row));
                        else indexRow(cached, entry);
                    }
                }
                state.plantGroupIndex = cached;
            }
            const incoming = Array.isArray(rows) ? rows : [];
            const overlay = emptyIndex();
            if (incoming.length > 1) incoming.forEach(row => indexRow(overlay, row));
            const match = (level, key) => {
                if (!overlay[level].has(key)) return cached[level].get(key);
                const value = overlay[level].get(key);
                return !cached[level].has(key) || cached[level].get(key) === value ? value : '';
            };
            return incoming.map(row => {
                if (!row || typeof row !== 'object') return row;
                const code = buildManagerEvalAssignmentKey(row.ITEMCODE || row.itemcode || row.itemcode_normalized);
                const parts = code.split('.');
                const group = getCropRollPlantGroup(row, false) || cached.exact.get(code) || overlay.exact.get(code)
                    || match('base', parts.slice(0, 2).join('.')) || match('family', parts[0]) || '';
                const genus = row.GENUSNAME || row.genusname || row.genus_name || row.genus || match('genusExact',code) || match('genusFamily',parts[0]) || '';
                return { ...row, GENUSNAME:genus, genusname:genus, PLANTGROUPCODE: group || row.plantGroup || '', plantgroupcode: group || row.plantGroup || '', plant_group_code: group || row.plantGroup || '' };
            });
        }


function preserveInventoryScrollPosition(paint) {
    const scroller = getMainAreaScrollTarget();
    const top = scroller?.scrollTop;
    const windowTop = window.scrollY;
    paint();
    if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
    if (window.scrollY !== windowTop) window.scrollTo(window.scrollX, windowTop);
}

function trackFastPressMove(event) {
    if (!event || !activeFastPress) return true;
    if (activeFastPress.pointerId !== null && Number(event.pointerId) !== activeFastPress.pointerId) return true;
    const deltaX = Math.abs(Number(event.clientX || 0) - activeFastPress.startX);
    const deltaY = Math.abs(Number(event.clientY || 0) - activeFastPress.startY);
    if ((activeFastPress.cleanTapOnly ? deltaX >= 8 || deltaY >= 8
        : deltaX > FAST_PRESS_MOVE_THRESHOLD_PX || deltaY > FAST_PRESS_MOVE_THRESHOLD_PX) && !activeFastPress.cancelled) {
        activeFastPress.cancelled = true;
        const pressTarget = event.currentTarget || event.target;
        const isFooterQuickAccess = !!(
            pressTarget
            && typeof pressTarget.closest === 'function'
            && pressTarget.closest('#bottom-nav .footer-nav-btn')
        );
        // A small finger drift cancels the accelerated pointer action. Keep
        // the browser's following native click available for quick access;
        // suppressing it made Android footer buttons focus without routing.
        if (!isFooterQuickAccess) armFastPressGhostClickSuppression(activeFastPress.pointerType);
    }
    return true;
}

// The capture slot keeps its blob for display and its committed URL for saves and deletes.
function rowPhotoIdentity(url) {
    const value = String(url || '').trim();
    try {
        const parsed = new URL(value);
        if (parsed.pathname.includes('/storage/v1/')) return parsed.origin + parsed.pathname.replace('/render/image/public/', '/object/public/');
    } catch { return value; }
    return value;
}

function mergeRowPhotoSlots(slots, serverEntries) {
    const entries = [], seen = new Set();
    const server = new Map(serverEntries.map(entry => [rowPhotoIdentity(entry.url), entry]));
    for (const slot of slots) {
        const key = rowPhotoIdentity(slot.publicUrl || slot.storageUrl || slot.url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        seen.add(slot.url);
        const saved = server.get(key);
        entries.push({ ...slot, url: slot.publicUrl || slot.url, previewUrl: slot.url,
            pending: slot.status !== 'Uploaded', persistedIndex: saved?.persistedIndex ?? -1 });
    }
    for (const entry of serverEntries) {
        const key = rowPhotoIdentity(entry.url);
        if (!key || seen.has(key) || key.startsWith('blob:')) continue;
        seen.add(key);
        entries.push({ ...entry, pending: false });
    }
    return entries;
}

function verifyPublishedPhotoPreview(item,prefix,id,publicUrl,fileName) {
    const scope = getSupabaseReadIdentityScope();
    const slots = getPendingPhotoPreviewEntries(item,prefix).filter(entry => entry.id === id);
    for (const slot of slots) Object.assign(slot,{publicUrl,name:fileName,status:'Uploaded'});
    if (!slots.length || typeof Image === 'undefined') return;
    const local = slots[0].url;
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.onload = () => {
        if (scope !== getSupabaseReadIdentityScope() || !getPendingPhotoPreviewEntries(item,prefix).some(entry=>entry.id === id)) return;
        for (const img of document.querySelectorAll('#photo-modal img')) if (img.getAttribute('src') === local) img.src = publicUrl;
        clearPendingPhotoPreview(item,prefix,id,true);
        refreshPendingPhotoUiForItem(item,prefix);
    };
    probe.src = getExpandedImageUrl(publicUrl);
}

function confirmRowPhotoSlot(job) {
    verifyPublishedPhotoPreview(job.item,job.prefix,job.id,job.upload.publicUrl,job.upload.fileName);
    drivePhotoAttachments.delete(job.id);
    if (job.blobBackup) job.blobBackup.then(() => deleteIndexedDbRecord(REQUEST_BLOB_STORE,job.blobId)).catch(() => false);
    refreshPendingPhotoUiForItem(job.item, job.prefix);
}

function startVisiblePhotoTimeout(onTimeout, budget) {
    let remaining = budget, started = 0, timer;
    const update = () => {
        if (started) remaining -= performance.now() - started;
        clearTimeout(timer);
        started = 0;
        if (!document.hidden) {
            started = performance.now();
            timer = setTimeout(onTimeout, Math.max(0, remaining));
        }
    };
    document.addEventListener('visibilitychange', update);
    update();
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
}

async function persistQueuePhotoAttachment(job) {
    const { item, prefix, upload } = job;
    const uid = String(item.UNIQUE_ID);
    if (prefix === 'req-' && isDockSuspendDcRequestMirrorRow(item)) {
        const proof = await loadCurrentSuspendTagPhotoRow(item);
        const receipt = await persistSuspendTagUploadedPhoto(item, proof, upload.publicUrl, upload.fileName);
        if (!receipt?.acknowledged) throw new Error('Suspend photo save was not confirmed.');
    } else if (prefix === 'req-') {
        const response = await postAppFunctionJson(APP_API_FUNCTION_URL, {action:'request_work',operation:'append_photo',
            requestId:uid, patch:{req_photo_link:upload.publicUrl,req_photo_name:upload.fileName}},
            {timeoutMs:25000,signal:job.uploadController.signal,label:'Request photo save'});
        const saved = response?.data?.row, master = response?.data?.master_row;
        if (!response?.ok || saved?.unique_id !== uid || !master?.unique_id || master.unique_id !== saved.master_id
            || !parsePhotoCsvValues(saved.req_photo_link).includes(upload.publicUrl)
            || !parsePhotoCsvValues(master.photo_link).includes(upload.publicUrl)) throw new Error('Request photo save was not confirmed.');
        if (!isCurrentDrivePhotoAttachment(job)) return;
        const live = findRequestRowByUniqueId(uid);
        for (const target of new Set([item, live, activeItem].filter(row => row?.UNIQUE_ID === uid))) {
            setPhotoAliasFieldsForPrefix(target,prefix,saved.req_photo_link,saved.req_photo_name);
            target.ROW_VERSION = target.row_version = Math.max(Number(target.ROW_VERSION || 0), Number(saved.row_version || 0));
        }
    } else {
        const patch = {dock_photo_link:appendPhotoCsvValue(item.DOCK_PHOTO_LINK,upload.publicUrl),
            dock_photo_name:appendPhotoCsvValue(item.DOCK_PHOTO_NAME,upload.fileName)};
        const receipt = await writeSocReviewThroughAppApi('PATCH',patch,'unique_id=eq.' + encodeURIComponent(uid));
        if (!receipt?.row || String(receipt.row.unique_id) !== uid || !parsePhotoCsvValues(receipt.row.dock_photo_link).includes(upload.publicUrl)) throw new Error('Dock photo save was not confirmed.');
        if (isCurrentDrivePhotoAttachment(job)) setPhotoAliasFieldsForPrefix(item,prefix,receipt.row.dock_photo_link,receipt.row.dock_photo_name);
    }
    if (isCurrentDrivePhotoAttachment(job)) confirmRowPhotoSlot(job);
}

function evalPhotoRow(work, originUid) {
    return {UNIQUE_ID:'eval:' + work.id + ':' + originUid, ITEMCODE:String(work.id), LOCATIONCODE:'eval', originUid};
}

async function persistEvalPhotoAttachment(job) {
    const { workId, originUid } = job.formFields;
    const work = getEvalWorkById(workId);
    if (!work) throw new Error('Reopen the evaluation to finish saving this photo.');
    const open = String(activeEvalWorkDetailId) === String(workId);
    const multi = work.contract_version === 'eval-work-v2-multi-origin';
    const byOrigin = multi ? { ...(open ? collectEvalWorkEvidenceByOrigin(work) : work.evidence_draft) } : null;
    const evidence = { ...((byOrigin ? byOrigin[originUid] : open ? collectEvalWorkEvidence(work) : work.evidence_draft) || {}) };
    const photo = {url:job.upload.publicUrl, name:job.fileName, filePath:job.upload.filePath};
    evidence.photos = [...(evidence.photos || []).filter(entry => rowPhotoIdentity(entry.url) !== rowPhotoIdentity(photo.url)), photo];
    evidence.picturesSpecsResolution = '';
    if (byOrigin) byOrigin[originUid] = evidence;
    const inquiry = open ? collectEvalWorkInquiryPayload(work) : (work.inquiry_draft || job.inquiry);
    const result = await evalWorkApi('save', {workId, expectedVersion:work.version, inquiry,
        ...(byOrigin ? {evidenceByOrigin:byOrigin} : {evidence})});
    if (!result?.ok || !result.data || String(result.data.id) !== String(workId)) throw new Error('Evaluation photo save was not confirmed.');
    if (!isCurrentDrivePhotoAttachment(job)) return;
    Object.assign(work,result.data);
    if (String(activeEvalWorkDetailId) === String(workId)) {
        if (byOrigin) evalWorkEvidenceByOrigin[originUid] = {...evalWorkEvidenceByOrigin[originUid],photos:evidence.photos};
        if (String(evalWorkActiveOriginUid || work.origin_unique_id) === String(originUid)) {
            evalWorkActivePhotos = [...evalWorkActivePhotos.filter(entry => rowPhotoIdentity(entry.url) !== rowPhotoIdentity(photo.url)), photo];
        }
    }
    confirmRowPhotoSlot(job);
}

function restoreCapturedPhotoFields(item,prefix) {
    const slots = getPendingPhotoPreviewEntries(item,prefix).filter(entry => entry.status === 'Uploaded' && entry.publicUrl);
    if (!slots.length) return;
    const links = getPhotoAliasFieldsForPrefix(prefix,'link').map(key => item[key]);
    const names = getPhotoAliasFieldsForPrefix(prefix,'name').map(key => item[key]);
    setPhotoAliasFieldsForPrefix(item,prefix,mergePhotoCsvList([...links,...slots.map(entry => entry.publicUrl)]),
        mergePhotoCsvList([...names,...slots.map(entry => entry.name)]));
}

function openAssignedItemsFirstFrame(state) {
    const host = document.getElementById('managers-content');
    if (!host) return;
    const ticket = state.opening = {};
    host.innerHTML = renderManagerTableManagementWorkspace('<div class="assigned-items-workspace" data-assigned-opening role="status">Opening Assigned Items…</div>', 'assigned-items');
    const current = () => state.opening === ticket && activeHomeTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW
        && isViewVisible('managers') && state === getManagerAssignedColumnState() && canViewAssignedItemsExport();
    const finish = () => {
        if (!current()) return;
        state.opening = null;
        renderManagers();
    };
    requestAnimationFrame(() => {
        if (!current()) return;
        const useMaster = fullInventory.length > 0;
        const input = useMaster ? fullInventory : warehouseAssignedItemsInventory;
        const slot = host.querySelector('[data-assigned-opening]');
        if (slot && input.length) {
            const cache = state.displayCache;
            const warm = cache?.input === input && cache.signature === getManagerAssignedDisplaySignature(state, useMaster, getManagerItemLowStockTargetsState().revision);
            const batch = warm ? cache.rows : getManagerAssignedItemsDisplayRows(input.slice(0, 150), {useMaster});
            slot.innerHTML = renderManagerAssignedFallbackRows(getFilteredManagerAssignedItemsExportRows(batch).slice(0, 150), true);
        }
        setTimeout(async () => {
            if (!current()) return;
            try {
                const useMaster = fullInventory.length > 0;
                const input = useMaster ? fullInventory : warehouseAssignedItemsInventory;
                const signature = () => getManagerAssignedDisplaySignature(state, useMaster, getManagerItemLowStockTargetsState().revision);
                const started = signature();
                if (state.displayCache?.input === input && state.displayCache.signature === started) return;
                const sorted = input.slice().sort(compareAssignedItemCodes);
                const rows = [], byId = new Map();
                for (let offset = 0; offset < sorted.length; offset += 100) {
                    if (!current()) return;
                    const batch = getManagerAssignedItemsDisplayRows(sorted.slice(offset, offset + 100), {useMaster});
                    for (const row of batch) {
                        rows.push(row);
                        byId.set(String(row.MASTER_UNIQUE_ID || row.UNIQUE_ID), row);
                    }
                    if (offset + 100 < sorted.length) await new Promise(resolve => setTimeout(resolve, 0));
                }
                if (current() && started === signature() && input === (useMaster ? fullInventory : warehouseAssignedItemsInventory)) {
                    state.displayCache = { input, signature: started, length: input.length, rows, byId };
                }
            } finally { finish(); }
        }, 0);
    });
}

function refreshAssignedItemLookups() {
            if (!isViewVisible('managers') || activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW || !canViewAssignedItemsExport()) return;
            const lowStockState = getManagerItemLowStockTargetsState();
            const lowStockKey = getManagerAssignedItemTargetKey();
            if (canReadItemLowStockTargets() && lowStockState.key !== lowStockKey
                && lowStockState.loadingKey !== lowStockKey && lowStockState.errorKey !== lowStockKey) {
                loadManagerItemLowStockTargets(false).catch(error => console.warn('Assigned Items history unavailable.', error));
            }
            if (canManageEvalItemcodeAssignments() && !evalAssignableUsersDirectoryResolved && !evalAssignableUsersPromise) {
                ensureEvalAssignableUsers().then(() => scheduleHydratedViewRender('managers')).catch(error => console.warn('Assignment directory unavailable.', error));
            }
            if (!assignableAppUsersLoaded && !assignableAppUsersPromise) ensureAssignableAppUsers().then(() => scheduleHydratedViewRender('managers')).catch(() => {});
        }

        function scheduleHydratedViewRender(viewId) {
            if (!isViewVisible(viewId)) { markViewDirty(viewId); return; }
            if (canUseProductionLiveSync() && (['request', 'drive', 'av'].includes(viewId)
                || viewId === 'managers' && activeHomeTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && getProductionLiveSyncContext().adapters.length)) {
                scheduleProductionLiveSyncRender(true);
                return;
            }
            const config = getViewLoadingConfig(viewId);
            const keys = [...(config?.required || []), ...(config?.background || [])];
            const signature = JSON.stringify([getSupabaseReadIdentityScope(), resolvedViewStateEpoch, activeHomeTab,
                activeReqTab, getManagerAssignedColumnState().dataEpoch, keys.map(entry => getDatasetLoadSignature(entry.key))]);
            scheduleCoalescedViewRender(viewId, () => {
                if (isViewVisible(viewId)) renderViewContent(viewId, false, false);
            }, signature);
        }

        function retainAvChunk(container, signature) {
            const pending = container.__avPendingChunk;
            if (!pending || pending.token !== avRenderChunkToken || pending.signature !== signature) return false;
            pending.retained = true;
            return true;
        }

function normalizeQueueNoteText(value) {
    return String(value ?? '').replace(/\\+(?=')/g, '');
}

function escapeQueueNoteText(value) {
    return escapeHtml(normalizeQueueNoteText(value));
}

function renderQueueOwnerFilterPanel(tab, items) {
    const panel = document.getElementById('request-pending-owner-filter');
    if (!panel) return;
    panel.hidden = !['pending', 'suspend-tag'].includes(tab) || !queueAccessScope(tab).all;
    if (!panel.hidden) {
        const id = tab === 'pending' ? 'request-eval-user-filter' : 'request-suspend-tag-assigned-filter';
        syncRequestChromeMarkup(panel, buildSuspendEvalUserFilter(items, id), requestCategoryToolbarMarkupByNode);
    }
}

async function saveSecureDriveEvidence(item = null, prefix = '', payload = {}, isComplete = false, baselineInput = null, serialized = false) {
    const ownerState = getManagerAssignedColumnState(), unlockKey = getCompletedRowUnlockKey(item);
    const pendingUnlock = !serialized && ownerState.pendingRowUnlocks?.get(unlockKey);
    if ((pendingUnlock && !await pendingUnlock || ownerState.failedRowUnlocks?.has(unlockKey)) && hasLockableInventoryEvidence(item)) throw new Error('Unlock not confirmed. Your edits are retained.');
    if (!item || !SECURE_DRIVE_EVIDENCE_PREFIXES.has(String(prefix || '').trim().toLowerCase())) {
        throw new Error('Secure Drive evidence context is invalid.');
    }
    if (!serialized) {
        const signature = JSON.stringify(['evidence', prefix, isComplete, item.LAST_UPDATED || item.last_updated, payload, baselineInput]);
        return serializeSuspendTagRowWrite(item, () => saveSecureDriveEvidence(item, prefix, payload, isComplete, baselineInput, true), signature);
    }
    const baseline = baselineInput && typeof baselineInput === 'object'
        ? { ...baselineInput }
        : buildSecureDriveEvidenceBaseline(item);
    const evidencePatch = buildSecureDriveEvidencePatch(payload, baseline);
    if (Object.prototype.hasOwnProperty.call(evidencePatch, 'match')) {
        const computedQty = getEditorLocMatchQtyValue(item, evidencePatch.match);
        if (computedQty != null) evidencePatch.loc_match_qty = computedQty;
        else if (Number(evidencePatch.match) > 0 && !(Number(evidencePatch.loc_match_qty) > 0)) delete evidencePatch.loc_match_qty;
    }
    if (!isComplete && !Object.keys(evidencePatch).length && !item.__drivePhotoAttachment) {
        return { ok: true, code: 'NO_CHANGES', canonicalConfirmed: true, row: item, requestRows: [], noOp: true };
    }
    const retryIntent = JSON.stringify([getSupabaseReadIdentityScope(), getCompletedRowUnlockKey(item), prefix, !!isComplete, evidencePatch]);
    const lockedRetry = item.__driveLockedRetry;
    delete item.__driveLockedRetry;
    const evidenceSignature = JSON.stringify({
        prefix: String(prefix || '').trim().toLowerCase(),
        complete: !!isComplete,
        expected: String(firstNonEmptyValue(item.LAST_UPDATED, item.last_updated, '') || '').trim(),
        baseline,
        evidence: evidencePatch
    });
    if (!item.__driveEvidenceIdempotencyKey || item.__driveEvidenceIdempotencySignature !== evidenceSignature) {
        const parentToken = String(item.__driveEvidenceRetryParentToken || '').trim();
        item.__driveEvidenceIdempotencyKey = lockedRetry?.intent === retryIntent ? lockedRetry.key : parentToken
            ? `${parentToken.slice(0, 165)}-r1`
            : `drive-${createStableClientBatchId()}`;
        item.__driveEvidenceIdempotencySignature = evidenceSignature;
        delete item.__driveEvidenceRetryParentToken;
    }
    const masterUid = String(firstNonEmptyValue(item.UNIQUE_ID, item.unique_id, '') || '').trim();
    const identityScope = getSupabaseReadIdentityScope();
    const controller = new AbortController();
    if (item.__drivePhotoAttachment) item.__drivePhotoAbort = () => controller.abort();
    driveEvidenceAbortControllers.set(masterUid, controller);
    try {
        return await runWithDriveEvidenceCrossTabLock(masterUid, async () => {
            let lastError = null;
            const delays = [300,800,1600];
            for (let attempt = 0; attempt <= delays.length; attempt += 1) {
                try {
                    if (identityScope !== getSupabaseReadIdentityScope() || controller.signal.aborted
                        || (item.__drivePhotoAttachment && !item.__drivePhotoIsCurrent())) {
                        throw Object.assign(new Error('Photo session changed.'), { code: 'DRIVE_SAVE_ABORTED' });
                    }
                    const result = await supabaseRpc('save_drive_evidence_v3', {
                        p_master_uid: masterUid,
                        p_expected_itemcode: String(firstNonEmptyValue(item.ITEMCODE, item.itemcode, '') || '').trim(),
                        p_expected_locationcode: String(firstNonEmptyValue(item.LOCATIONCODE, item.locationcode, '') || '').trim(),
                        p_expected_lotcode: String(firstNonEmptyValue(item.LOTCODE, item.lotcode, '') || '').trim(),
                        p_expected_signature: String(firstNonEmptyValue(item.LAST_UPDATED, item.last_updated, '') || '').trim(),
                        p_baseline: baseline,
                        p_evidence: evidencePatch,
                        p_complete: !!isComplete,
                        p_workflow: getSecureDriveEvidenceWorkflow(prefix),
                        p_idempotency_key: item.__driveEvidenceIdempotencyKey
                    }, { timeoutMs: Math.max(getDetailRowWriteTimeoutMs(), 30000), signal: controller.signal });
                    const code = String(result && result.code || '').trim().toUpperCase();
                    if (identityScope !== getSupabaseReadIdentityScope() || controller.signal.aborted) {
                        throw Object.assign(new Error('Photo session changed.'), { code: 'DRIVE_SAVE_ABORTED' });
                    }
                    const committed = getCommittedDriveEvidenceReceipt(result, item);
                    if (committed) {
                        delete item.__driveEvidenceIdempotencyKey;
                        delete item.__driveEvidenceIdempotencySignature;
                        try { delete item.__driveEvidenceBaselineOverride; } catch (error) { item.__driveEvidenceBaselineOverride = null; }
                        clearDriveEvidenceConflict(item, prefix);
                        if (typeof discardPendingLocalEdits === 'function') discardPendingLocalEdits([masterUid], true);
                        return committed;
                    }
                    if (code === 'DRIVE_SAVE_BUSY' && attempt < delays.length) {
                        await waitForDriveEvidenceRetry(delays[attempt], controller.signal);
                        continue;
                    }
                    if (DRIVE_EVIDENCE_TERMINAL_CONFLICT_CODES.has(code)) {
                        setDriveEvidenceConflict(item, prefix, result || { code });
                        const conflictError = new Error(code || 'DRIVE_FIELD_CONFLICT');
                        conflictError.code = code || 'DRIVE_FIELD_CONFLICT';
                        conflictError.driveEvidenceConflict = true;
                        throw conflictError;
                    }
                    const unconfirmedError = new Error(code || 'DRIVE_SAVE_UNCONFIRMED');
                    unconfirmedError.code = code || 'DRIVE_SAVE_UNCONFIRMED';
                    throw unconfirmedError;
                } catch (error) {
                    lastError = error;
                    if (String(error?.message || '').includes('DRIVE_ROW_COMPLETED_UNLOCK_REQUIRED')) {
                        if (identityScope === getSupabaseReadIdentityScope()) {
                            item.__driveLockedRetry = { intent: retryIntent, key: item.__driveEvidenceIdempotencyKey };
                            ownerState.unlockedRowsByKey?.delete(unlockKey);
                            (ownerState.failedRowUnlocks ||= new Set()).add(unlockKey);
                            if (getCompletedRowUnlockKey(activeItem) === unlockKey) {
                                protectedEditState[prefix] = false;
                                renderProtectedControls(prefix);
                            }
                        }
                        throw Object.assign(new Error('This row was completed. Your edits are retained. Use Retry Unlock, then save again.'), {code:'DRIVE_ROW_COMPLETED_UNLOCK_REQUIRED'});
                    }
                    if (error && (error.driveEvidenceConflict || error.code === 'DRIVE_SAVE_ABORTED' || error.code === 'REQUEST_ABORTED')) throw error;
                    const status = Number(error && error.status || 0);
                    const message = String(error && error.message || '').toUpperCase();
                    const retryable = [408, 409, 429, 500, 502, 503, 504].includes(status)
                        || message.includes('TIMED OUT')
                        || message.includes('NETWORK')
                        || /55P03|LOCK_NOT_AVAILABLE|LOCK TIMEOUT|FAILED TO FETCH|LOAD FAILED/.test(message + ' ' + error?.code);
                    if (!retryable || attempt >= delays.length) break;
                    await waitForDriveEvidenceRetry(delays[attempt], controller.signal);
                }
            }
            if (identityScope === getSupabaseReadIdentityScope() && !controller.signal.aborted
                && /55P03|lock|busy|network|fetch|load failed|connection|timed out/i.test(String(lastError?.code) + ' ' + lastError?.message)) {
                const exact = await loadExactMasterDetailRow(masterUid).catch(() => null);
                const row = exact?.__masterDetailRaw;
                const aliases = {comments:'sales_note',pick_note:'pick_note'};
                if (identityScope === getSupabaseReadIdentityScope() && row && row.last_updated
                    && row.last_updated !== (item.LAST_UPDATED || item.last_updated)
                    && (!isComplete || Number.isFinite(Date.parse(row.date_completed)))
                    && Object.entries(evidencePatch).every(([field,value]) => {
                        const key = aliases[field] || field;
                        return Object.hasOwn(row,key) && normalizeDriveEvidenceComparable(row[key]) === normalizeDriveEvidenceComparable(value);
                    })) {
                    const receipt = getCommittedDriveEvidenceReceipt({ok:true,code:'SAVED',row,requestRows:[],locationRows:[row]},item);
                    delete item.__driveEvidenceIdempotencyKey;
                    delete item.__driveEvidenceIdempotencySignature;
                    clearDriveEvidenceConflict(item,prefix);
                    return receipt;
                }
            }
            const safeError = new Error(lastError && lastError.message || 'The row could not be saved. Your draft is retained; retry saving.');
            safeError.code = String(lastError && lastError.code || 'DRIVE_SAVE_RETRYABLE').replace(/[^A-Z0-9_-]+/gi, '_').slice(0, 80);
            safeError.status = Number(lastError && lastError.status || 0);
            throw safeError;
        });
    } finally {
        if (driveEvidenceAbortControllers.get(masterUid) === controller) driveEvidenceAbortControllers.delete(masterUid);
    }
}

        function renderSavedPhotos() {
            let sLink = getSharedAppPhotoLinkCsv(activeItem) || "";
            let rLink = getRequestPhotoLinkCsv(activeItem) || "";
            let dLink = getDockOwnedPhotoLinkCsv(activeItem) || "";
            let fLink = getFlyerVisiblePhotoLinkCsv(activeItem) || "";
            const allowPhotoEdits = (prefix) => canEditRowDetails(prefix);

            const makeThumbs = (link, containerId, wrapperId, prefix, allowRemove = false, title = 'Saved Photo') => {
                let el = document.getElementById(containerId);
                let wrap = document.getElementById(wrapperId);
                if(!el || !wrap) return;
                const entries = getDisplayPhotoEntries(prefix, activeItem, link);
                if (prefix !== 'flyer-') {
                    const owned = new Set(entries.flatMap(entry => getPhotoUrlList(entry.url)));
                    const display = prefix === 'req-' ? getQueueDisplayEvidenceRow(activeItem) || activeItem : activeItem;
                    const urls = prefix === 'req-' && activeDetailSourceView === 'request' ? getQueueDisplayPhotoUrls(display) : getInventoryLocationPhotos(display);
                    for (const url of urls) if (!owned.has(url)) entries.push({url, shared:true, persistedIndex:-1, dateLabel:resolveAndFormatPhotoDate(activeItem,url)});
                }
                if(entries.length > 0) {
                    const allowReorder = canReorderProtectedPhoto(prefix);
                    const persistedEntries = entries.filter((entry) => !entry.pending && entry.persistedIndex > -1);
                    const openLink = entries.map((entry) => entry.url).join(',');
                    let html = `<div class="flex gap-2 overflow-x-auto pb-2">`;
                    entries.forEach((entry, photoIndex) => {
                        const cleanUrl = getPhotoUrlList(entry.url)[0] || '';
                        if (!cleanUrl) return;
                        const thumb = entry.previewUrl || getDirectImageUrl(cleanUrl, 'gallery-tile');
                        const canRemoveThis = canRemoveProtectedPhoto(prefix, activeItem) && !entry.pending && (entry.persistedIndex > -1 || entry.publicUrl);
                        const cleanUrlAttr = escJsAttrValue(cleanUrl);
                        const pressAttrs = canRemoveThis ? ` oncontextmenu="event.preventDefault(); return false;" onmousedown="startPhotoDeletePress(event, '${prefix}', ${entry.persistedIndex}, '${cleanUrlAttr}')" onmouseup="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" onmouseleave="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" ontouchstart="startPhotoDeletePress(event, '${prefix}', ${entry.persistedIndex}, '${cleanUrlAttr}')" ontouchend="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" ontouchcancel="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})" ontouchmove="cancelPhotoDeletePress('${prefix}', ${entry.persistedIndex})"` : '';
                        const deleteButtonHtml = canRemoveThis
                            ? `<button type="button" class="absolute -right-1 -top-1 z-10 inline-flex h-7 min-w-[28px] items-center justify-center gap-1 rounded-full border border-white bg-red-600 px-1.5 text-[8px] font-black uppercase tracking-[0.08em] text-white shadow-md active:scale-95" onclick="event.stopPropagation(); return promptPhotoDelete('${prefix}', ${entry.persistedIndex}, '${cleanUrlAttr}')" aria-label="Delete photo"><i class="ph-bold ph-trash"></i><span class="hidden sm:inline">Delete</span></button>`
                            : '';
                        const statusHtml = entry.pending ? `<div class="mt-1 text-[9px] font-bold text-emerald-500 uppercase text-center">${escapeHtml(entry.status || 'Uploading')}</div>${entry.uploadId && entry.status === 'Save failed' ? `<button type="button" class="mt-1 border rounded px-2 py-1" onclick="retryDrivePhotoAttachment('${escJsAttrValue(entry.uploadId)}')">Retry photo</button><button type="button" class="mt-1 border rounded px-2 py-1" onclick="event.stopPropagation(); discardDrivePhotoAttachment('${escJsAttrValue(entry.uploadId)}')">Tap Delete</button>` : ''}` : '<div class="photo-uploaded-status mt-1 text-[9px] font-bold text-emerald-600 uppercase text-center">✓ UPLOADED</div>';
                        const dateHtml = entry.dateLabel ? `<div class="mt-1 text-[9px] font-bold text-slate-400 uppercase text-center">Photo ${entry.dateLabel}</div>` : '';
                        const firstVisiblePersistedIndex = persistedEntries.length ? persistedEntries[0].persistedIndex : -1;
                        const lastVisiblePersistedIndex = persistedEntries.length ? persistedEntries[persistedEntries.length - 1].persistedIndex : -1;
                        const reorderHtml = allowReorder && !entry.shared && !entry.pending && persistedEntries.length > 1 ? `<div class="photo-reorder-pair mt-1 flex items-center justify-center gap-1"><button type="button" class="px-2 py-1 text-[10px] font-black rounded-md border border-emerald-600 bg-emerald-950 text-emerald-100 ${entry.persistedIndex === firstVisiblePersistedIndex ? 'opacity-30 pointer-events-none' : ''}" onclick="event.stopPropagation(); movePhotoInSet('${prefix}', ${entry.persistedIndex}, -1)">LEFT</button><button type="button" class="px-2 py-1 text-[10px] font-black rounded-md border border-emerald-600 bg-emerald-950 text-emerald-100 ${entry.persistedIndex === lastVisiblePersistedIndex ? 'opacity-30 pointer-events-none' : ''}" onclick="event.stopPropagation(); movePhotoInSet('${prefix}', ${entry.persistedIndex}, 1)">RIGHT</button></div>` : '';
                        html += `<div class="saved-photo-tile relative shrink-0">${deleteButtonHtml}<button type="button" class="p-0 border-0 bg-transparent" onclick="handlePhotoThumbClick('${openLink}', '${title}', ${photoIndex})"${pressAttrs}>${buildDeferredCardPhotoImg(thumb, { hydrateNow:true, loading:'eager', className: 'w-20 h-20 object-cover rounded-lg border border-gray-300 cursor-pointer shadow-sm active:scale-95' })}</button><div class="photo-count text-center text-[9px]">${photoIndex + 1}/${entries.length}</div>${statusHtml}${dateHtml}${reorderHtml}</div>`;
                    });
                    html += `</div>`;
                    const mediaSignature = getCompletedRowUnlockKey(activeItem) + ':' + JSON.stringify(entries.map(entry => [entry.url,entry.status,entry.dateLabel,entry.persistedIndex])) + ':' + canRemoveProtectedPhoto(prefix) + ':' + allowReorder;
                    if (el.dataset.mediaSignature !== mediaSignature) { replaceDetailMediaPreservingImages(el,html); el.dataset.mediaSignature = mediaSignature; }
                    scheduleDeferredCardPhotoHydration(el);
                    wrap.classList.remove('hidden');
                } else {
                    el.innerHTML = "";
                    delete el.dataset.mediaSignature;
                    wrap.classList.add('hidden');
                }
            };

            makeThumbs(sLink, 'ssn-photo-list-container', 'ssn-photo-preview', 'ssn-', allowPhotoEdits('ssn-'), 'Base Photos');
            makeThumbs(sLink, 'lsn-photo-list-container', 'lsn-photo-preview', 'lsn-', allowPhotoEdits('lsn-'), 'Base Photos');
            makeThumbs(sLink, 'na-photo-list-container', 'na-photo-preview', 'na-', allowPhotoEdits('na-'), 'Base Photos');
            makeThumbs(rLink, 'req-photo-list-container', 'req-photo-preview', 'req-', allowPhotoEdits('req-') && !!(rLink || getPendingPhotoPreviewEntries(activeItem, 'req-').length), 'Request Photos');
            makeThumbs(dLink, 'dock-photo-list-container', 'dock-photo-preview', 'dock-', allowPhotoEdits('dock-') && !!(dLink || getPendingPhotoPreviewEntries(activeItem, 'dock-').length), 'Dock Photos');
            makeThumbs(fLink, 'flyer-photo-list-container', 'flyer-photo-preview', 'flyer-', allowPhotoEdits('flyer-') && !!(fLink || getPendingPhotoPreviewEntries(activeItem, 'flyer-').length), 'Flyer Photos');
            renderNcrDraftPhotos(activeItem);
            refreshProtectedSections();
        }

function applySavedSuspendDisplay(mirror, source, patch) {
    const identity = getSuspendTagInventoryIdentity(mirror,source);
    if (!identity.itemCode || !identity.locationCode || isFalseBlockLocation(identity.locationCode)) return;
    const display = {unique_id:identity.masterUid, itemcode:identity.itemCode, locationcode:identity.locationCode, lotcode:identity.lotCode};
    for (const [from,to] of [['dock_photo_link','photo_link'],['dock_photo_name','photo_name'],['dock_spec','spec'],['av_note','av_note']]) {
        if (Object.hasOwn(patch,from) && source[from] != null) display[to] = source[from];
    }
    const master = identity.masterUid && masterInventoryById.get(identity.masterUid);
    if (master && matchesSuspendTagInventoryIdentity(master,identity)) {
        for (const field of ['spec','av_note','photo_link','photo_name']) if (Object.hasOwn(display,field)) master[field.toUpperCase()] = master[field] = display[field];
    }
    if (display.photo_link) {
        display.photo_date = source.photo_date || source.last_updated || new Date().toISOString();
        const state = getManagerAssignedColumnState(), scope = getSupabaseReadIdentityScope();
        if (state.sessionPhotoScope !== scope) state.recentSessionPhotos = new Map();
        state.sessionPhotoScope = scope;
        const rowKey = inventoryPhotoLocationKey(display);
        if (rowKey) (state.recentSessionPhotos ||= new Map()).set(rowKey,display);
        state.photoGeneration = (state.photoGeneration || 0) + 1;
    }
}

async function resolveReviewedWatchdogEvents(ids) {
    const allowed = ['dylan_collyge','megan_kelly','jd_jones'];
    const actor = String(currentUser || '').trim().toLowerCase();
    if (!allowed.includes(actor) || !Array.isArray(ids) || !ids.length || ids.length > 250 ||
        ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('WATCHDOG_REVIEW_DENIED');
    const scope = getSupabaseReadIdentityScope();
    const headers = await getNativeAuthRequestHeaders();
    if (!headers?.Authorization || scope !== getSupabaseReadIdentityScope()) throw Error('WATCHDOG_REVIEW_SESSION_REQUIRED');
    // This remote-only procedure is absent from the pinned generated browser schema.
    // Constrain both its request and receipt here just as the generated bridge does.
    const response = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/resolve_runtime_watchdog_events_v23158', {
        method:'POST', referrerPolicy:'no-referrer', headers:{...headers,'Content-Type':'application/json','x-client-info':'agdata/'+APP_VERSION},
        body:JSON.stringify({p_ids:ids})
    },5000,'Watchdog review');
    if (!response.ok) throw Error('WATCHDOG_REVIEW_HTTP_' + response.status);
    const result = await response.json();
    if (scope !== getSupabaseReadIdentityScope() || result?.ok !== true || !Number.isSafeInteger(result.resolved)
        || result.resolved < 0 || result.resolved > ids.length
        || !Array.isArray(result.confirmed_ids) || !ids.every(id => result.confirmed_ids.includes(id))) throw Error('WATCHDOG_REVIEW_RECEIPT_INVALID');
    return result;
}

        function getDetailMeasurementKeyboardSelection(input = null) {
            const value = String(input && input.value || '');
            const valueLength = value.length;
            if (['spec','match'].includes(detailMeasurementKeyboardType)) return {start:valueLength, end:valueLength, value, valueLength};
            const nativeNote = detailMeasurementKeyboardType === 'av-note' && document.activeElement === input;
            let start = nativeNote ? input.selectionStart : Number(input?.dataset?.detailKeypadCursorStart);
            let end = nativeNote ? input.selectionEnd : Number(input?.dataset?.detailKeypadCursorEnd);
            if (!Number.isFinite(start)) start = valueLength;
            if (!Number.isFinite(end)) end = start;
            start = Math.max(0, Math.min(valueLength, Math.round(start)));
            end = Math.max(0, Math.min(valueLength, Math.round(end)));
            if (end < start) end = start;
            return { start, end, value, valueLength };
        }

        function getNormalizedDetailMeasurementCursor(input = null, rawValue = '', rawCursor = null) {
            const valueText = String(rawValue || '');
            const cursor = Number.isFinite(Number(rawCursor)) ? Math.max(0, Math.min(valueText.length, Math.round(Number(rawCursor)))) : valueText.length;
            return normalizeDetailMeasurementKeyboardValueForInput(input, valueText.slice(0, cursor)).length;
        }
async function readOwnedRequestBatchReceipt(entry) {
    const owner = getRequestSubmissionOwnerKey();
    const batch = String(entry?.clientBatchId || '');
    const ids = (entry?.requests || []).map(row => String(row.unique_id || row.UNIQUE_ID || '').trim());
    if (!owner || owner !== entry?.ownerKey || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(batch)
        || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !id || id.length > 200)) return null;
    const headers = await getNativeAuthRequestHeaders();
    if (!headers?.Authorization || owner !== getRequestSubmissionOwnerKey()) return null;
    const response = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/get_my_request_batch_receipt_v23162', {
        method:'POST', headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({p_batch:batch,p_ids:ids}), referrerPolicy:'no-referrer'
    },15000,'Request receipt');
    if (!response.ok) throw new Error('REQUEST_RECEIPT_HTTP_' + response.status);
    const result = await response.json();
    return owner === getRequestSubmissionOwnerKey() ? result : null;
}

function showRequestWorkFieldValidation(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (field && isViewVisible('detail')) {
        field.setAttribute('aria-invalid','true');
        field.addEventListener('input', () => field.removeAttribute('aria-invalid'), {once:true});
        if (!field.disabled) field.focus({preventScroll:true});
    }
    // A local input prompt remains an accessible alert; transport/server errors use the normal observer.
    showToast('Required',message,true,{requestInputGuidance:true});
}

async function auditLocalRequestDurability(reason = 'runtime', force = false) {
    const owner = getRequestSubmissionOwnerKey();
    const now = Date.now();
    if (!owner || !nativeAuthSessionActive || !nativeAuthProfile?.id || (!force && lastLocalRequestDurabilityAuditOwner === owner && now-lastLocalRequestDurabilityAuditAt < 60000)) return false;
    if (lastLocalRequestDurabilityAuditOwner !== owner) lastLocalRequestDurabilitySignature = '';
    lastLocalRequestDurabilityAuditOwner = owner;
    lastLocalRequestDurabilityAuditAt = now;
    await reconcileConfirmedRequestWorkDrafts(owner);
    if (owner !== getRequestSubmissionOwnerKey()) return false;
    const entries = await readOwnedRequestOutboxEntries();
    if (owner !== getRequestSubmissionOwnerKey()) return false;
    const stale = entries.filter(entry => entry.status === 'acknowledged' || Number(entry.attempts) > 0
        || now-Date.parse(entry.createdAt || entry.updatedAt) > 5*60*1000);
    const pending = [];
    for (const entry of stale) {
        if (owner !== getRequestSubmissionOwnerKey()) return false;
        const outcome = await getRequestSubmissionController().reconcile(entry);
        if (owner !== getRequestSubmissionOwnerKey()) return false;
        if (!['acknowledged','retained-for-review'].includes(outcome.status)) pending.push(entry.clientBatchId);
    }
    const blobs = await getAllIndexedDbRecords(REQUEST_BLOB_STORE,{decodeRequestBlobs:false});
    if (owner !== getRequestSubmissionOwnerKey()) return false;
    const staleBlobs = blobs.filter(blob => blob.ownerKey === owner && now-Date.parse(blob.createdAt) > 15*60*1000);
    const signature = JSON.stringify([owner,pending.slice().sort(),staleBlobs.length]);
    if (signature === lastLocalRequestDurabilitySignature) return false;
    lastLocalRequestDurabilitySignature = signature;
    if (pending.length) reportSemanticHealthEvent('unconfirmed_request_write','request','LOCAL_REQUEST_OUTBOX_PENDING',
        {pending_count:pending.length,reason:/^[\da-f-]{36}$/i.test(pending[0]) ? pending[0] : reason});
    if (staleBlobs.length) reportSemanticHealthEvent('unreferenced_request_upload','request','LOCAL_REQUEST_BLOB_PENDING',
        {pending_count:staleBlobs.length,reason},'warning');
    return !!(pending.length || staleBlobs.length);
}
async function reconcileConfirmedRequestWorkDrafts(owner) {
    const cache = getPendingEditsCache();
    for (const [id,entry] of Object.entries(cache)) {
        const draft = entry.requestWorkDraft;
        if (!entry.autoRetryBlocked || !draft || draft.requestId !== id || !Number.isSafeInteger(Number(draft.baseVersion)) || Number(draft.baseVersion) < 1) continue;
        const legacyActor = String(entry.data?.COMPLETED_BY_USERNAME || entry.data?.completed_by_username || '').toLowerCase();
        if (entry.requestWorkOwnerKey !== owner && (entry.requestWorkOwnerKey || !draft.complete || legacyActor !== String(currentUser).toLowerCase())) continue;
        if (owner !== getRequestSubmissionOwnerKey()) return;
        if (isViewVisible('detail') && getItemUniqueId(activeItem) === id) continue;
        const revision = entry.timestamp;
        const canonical = await fetchCanonicalRequestWorkRow(id).catch(() => null);
        if (owner !== getRequestSubmissionOwnerKey()) return;
        if (!canonical || canonical.requestId !== id || canonical.rowVersion < Number(draft.baseVersion) || cache[id] !== entry || entry.timestamp !== revision) continue;
        if (draft.complete && !canonical.completed) continue;
        if (!entry.requestWorkOwnerKey && String(canonical.row?.COMPLETED_BY_USERNAME || canonical.row?.completed_by_username || '').toLowerCase() !== legacyActor) continue;
        const values = Object.entries(draft.dirtyValues || {});
        if (!values.length || !values.every(([key,value]) => Object.hasOwn(canonical.values,key) && value === canonical.values[key])) continue;
        if (canonical.completed) confirmQueueCompletion(canonical.row);
        delete cache[id];
        flushPendingEditsCache(true);
    }
}
        async function fetchCanonicalRequestWorkRow(requestId = '') {
            const normalizedId = String(requestId || '').trim();
            if (!normalizedId || navigator.onLine === false) return null;
            const identityScope = getSupabaseReadIdentityScope();
            const permissionVersion = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
            const query = 'select=*&unique_id=eq.' + encodeURIComponent(normalizedId);
            let rows = await fetchSupabasePage(ACTIVE_REQUEST_LIVE_ROWS_TABLE, query, 1, 0);
            let completed = false;
            if (!rows?.length && identityScope === getSupabaseReadIdentityScope()) {
                const history = await fetchDirectPostgrestReadPage(REQUEST_HISTORY_TABLE, query + '&date_completed=not.is.null&limit=1', {}, false);
                rows = history?.rows || [];
                completed = rows.length === 1 && !!rows[0].date_completed;
            }
            if (identityScope !== getSupabaseReadIdentityScope()
                || permissionVersion !== String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '')) throw staleSupabaseReadScopeError();
            const formatted = formatFetchedRows(rows || [], ACTIVE_REQUEST_TABLE);
            const row = formatted[0] || null;
            const rowVersion = Number(firstNonEmptyValue(row && row.ROW_VERSION, row && row.row_version, 0));
            return row && String(row.UNIQUE_ID || row.unique_id) === normalizedId && Number.isSafeInteger(rowVersion) && rowVersion > 0
                ? { row, rowVersion, requestId:normalizedId, completed, values: getRequestWorkValuesFromRow(row) }
                : null;
        }
function showSavedRequestReviewChoices(owner) {
    if (!owner || owner !== getRequestSubmissionOwnerKey()) return false;
    const saved = Array.from(requestSubmissionEntries.values()).filter(entry => entry.ownerKey === owner && entry.formSnapshot && entry.status !== 'acknowledged');
    if (!saved.some(entry => entry.retainedForReview)) return false;
    const modal = document.getElementById('request-rep-modal'), panel = modal?.querySelector('.request-create-panel');
    if (!panel) return false;
    const section = document.createElement('section');
    section.id = 'saved-request-review-choices';
    section.setAttribute('aria-label','Saved Requests');
    section.className = 'flex flex-col gap-2 overflow-y-auto text-left';
    const heading = document.createElement('h3');
    heading.className = 'font-bold text-lg'; heading.textContent = 'Saved Requests';
    const note = document.createElement('p');
    note.className = 'text-sm'; note.textContent = 'Choose a draft to review. Opening it does not submit it.';
    section.append(heading,note);
    for (const entry of saved) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'rounded-xl border border-emerald-700 p-3 text-left';
        const name = entry.formSnapshot.customer || entry.requests?.[0]?.customername || 'Request';
        const count = entry.requests?.length || 0;
        button.textContent = [name, count+' item'+(count===1?'':'s'), entry.clientBatchId.slice(-8),
            entry.retainedForReview ? 'Saved for review' : 'Saved locally'].join(' · ');
        button.onclick = () => {
            if (owner !== getRequestSubmissionOwnerKey() || requestSubmitInFlight) return;
            section.remove(); restoreRequestSubmissionForm(entry);
        };
        section.appendChild(button);
    }
    const close = document.createElement('button');
    close.type='button';close.className='rounded-xl border p-2';close.textContent='Close';close.onclick=closeRequestModal;
    section.appendChild(close);
    document.getElementById(section.id)?.remove();panel.prepend(section);modal.classList.remove('hidden');
    return true;
}

function rememberOperationalExport(view, rows) {
    const root = document.getElementById('view-' + view);
    if (!root) return;
    root.agdataExport = { owner:getSupabaseReadIdentityScope(), tab:view === 'request' ? activeReqTab : dockViewMode, rows };
}

function exportOperationalRows(view) {
    const current = document.getElementById('view-' + view)?.agdataExport;
    if (!isViewVisible(view) || current?.owner !== getSupabaseReadIdentityScope() || current?.tab !== (view === 'request' ? activeReqTab : dockViewMode) || !current?.rows?.length) {
        showToast('Export Excel','No matching rows in this view.'); return false;
    }
    const fields = ['ITEMCODE','CONTSIZE','COMMONNAME','LOCATIONCODE','LOTCODE','DOCK','STOPNUMBER','QUANTITYORDERED','CONSIGNEENAME','PLANSTART','SPEC','AV_NOTE'];
    const columns = fields.map(key=>({label:key,value:row=>row[key] ?? row[key.toLowerCase()] ?? ''}));
    downloadExcelWorkbook(columns,current.rows,view === 'docks' ? 'Docks' : 'Que','','operational-'+view);
    return false;
}

function buildFilteredWorkbookFile(columns, rows, title, searchTerm, fileLabel, metaRows, options) {
    const data = enrichManagerAssignedPlantGroups(rows);
    const all = columns.map(column=>Array.isArray(column) ? {label:column[1],value:row=>row[column[0]] ?? ''} : column);
    for (const field of ['GENUSNAME','PLANTGROUPCODE']) if (!all.some(c=>String(c.label).replace(/[ _]/g,'').toUpperCase()===field)) all.push({label:field,value:row=>row[field] || ''});
    // Keep the existing sheet formatting, print headings, metadata and filename.
    try {
        if (!window.XLSX?.utils || metaRows?.length || options?.freezeHeaderRow || options?.includeAutoFilter) return buildExcelWorkbookFile(all,data,title,searchTerm,fileLabel,metaRows,options);
        const cells = [all.map(c=>c.label),...data.map(row=>all.map(c=>c.value?.(row) ?? ''))];
        const book = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(book,window.XLSX.utils.aoa_to_sheet(cells),getAVWorksheetName(title));
        const blob = new Blob([window.XLSX.write(book,{type:'array',bookType:'xlsx'})]);
        return {blob,workbookBlob:blob,filename:sanitizeExcelWorkbookFileBase(options?.filenameBase || fileLabel,'export')+'.xlsx'};
    } catch (error) {
        const cells = [all.map(c=>c.label), ...data.map(row=>all.map(c=>c.value?.(row) ?? ''))];
        const base = sanitizeExcelWorkbookFileBase(options?.filenameBase || fileLabel,'export');
        if (window.XLSX?.utils) {
            const book = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(book,window.XLSX.utils.aoa_to_sheet(cells),getAVWorksheetName(title));
            try { const blob=new Blob([window.XLSX.write(book,{type:'array',bookType:'xlsx'})]);return {blob,workbookBlob:blob,filename:base+'.xlsx'}; } catch {}
        }
        const quote = value => '"' + String(value ?? '').replace(/"/g,'""') + '"';
        const blob = new Blob(['\uFEFF',cells.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
        return {blob,workbookBlob:blob,filename:base+'.csv'};
    }
}


function getAvRowPhotoUrls(row = {}) {
    return [...new Set([row.PHOTOS,row.photos,row.PHOTO_LINK,row.photo_link,row.PHOTO_URL,row.photo_url,row.SAVED_PHOTO_LINK]
        .flatMap(value => getPhotoUrlList(value || '')).filter(url => /^https?:\/\//i.test(url)))];
}
function hasValidRowPhoto(row) {
    if (!row) return false;
    const available = Number(String(row.PTRAVAILABLE ?? row.ptravailable ?? row.AVAILABLE ?? row.available ?? '').replace(/,/g,''));
    if (!(available > 0)) return false;
    const stored = row.LOC_PHOTO_MATCH ?? row.loc_photo_match ?? row.LOC_MATCH_QTY ?? row.loc_match_qty;
    if (stored != null && String(stored).trim() !== '' && !(Number(String(stored).replace(/,/g,'')) > 0)) return false;
    if (!(calculateLiveLocPhotoMatch(row) > 0)) return false;
    const now = Date.now(), limit = 10 * 24 * 60 * 60 * 1000;
    const metadata = [row.PHOTOS,row.photos].flatMap(value => Array.isArray(value) ? value : []);
    return getAvRowPhotoUrls(row).some(url => {
        const entry = metadata.find(value => value && typeof value === 'object' && getPhotoUrlList([value]).includes(url));
        const entryDate = entry && (entry.taken_at || entry.created_at || entry.uploaded_at || entry.photo_date || entry.timestamp || entry.date);
        const stamp = entryDate ? getPhotoDateMsFromText_(entryDate) : getPhotoEntryDateMs(url,row);
        return Number.isFinite(stamp) && stamp <= now && now - stamp <= limit;
    });
}
function toggleAvValidPhotos() {
    return setAvPhotoMode(getAvPhotoMode() === 'valid_photos' ? 'all' : 'valid_photos');
}
function updateAvValidPhotoPill() {
    const button = document.getElementById('av-valid-photos-toggle');
    if (!button) return;
    let rows = buildAvSharedFilterState(getAvRawTabItems(activeAVTab,{ignoreSecondaryTab:true})).filteredItems;
    const term = getAvSearchBoxValue();
    if (term) rows = filterBySearch(rows,term,isAvCustomerSalesBucket(activeAvSalesBucket) ? 'av_reserves' : 'av_open');
    const count = rows.filter(hasValidRowPhoto).length;
    button.textContent = '📷 Valid Photos (' + count + ')';
    button.setAttribute('aria-pressed',String(getAvPhotoMode() === 'valid_photos'));
}
