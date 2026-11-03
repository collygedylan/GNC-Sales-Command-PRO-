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
        const p_name = 'drive-evidence/' + uidHex + '/v2/' + '0'.repeat(64) + '.jpg';
        const warm = [fetchWithTimeout(APP_API_FUNCTION_URL + '?photo_warm=1', {method:'HEAD',referrerPolicy:'no-referrer'}, 1200, 'Photo connection warm-up'),
            fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/attach_drive_photo_blob_v1', {method:'OPTIONS',headers:{...headers,'Content-Type':'application/json'},referrerPolicy:'no-referrer'}, 1200, 'Photo transport warm-up'),
            fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/can_upload_drive_evidence_v23115', {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_name}),referrerPolicy:'no-referrer'}, 4000, 'Photo authorization warm-up')];
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
            const headers = await getNativeAuthRequestHeaders();
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
            const owner = getSupabaseReadIdentityScope();
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
                const response = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/' + (attachPhoto ? 'attach_drive_photo_blob_v1' : 'store_drive_photo_blob_v1'), {
                    method:'POST', headers:{...headers,'Content-Type':'application/json'}, referrerPolicy:'no-referrer', signal:options.signal,
                    body:JSON.stringify({p_path:filePath,p_content:content,p_content_type:file.type,...(attachPhoto ? {p_workflow:prefix === 'ssn-' ? 'season' : prefix === 'na-' ? 'notes' : 'location',p_idempotency_key:'photo-' + options.attachmentId} : {})})
                }, 25000, 'Database photo recovery');
                const saved = await response.json();
                if (!response.ok || !saved?.id) throw Object.assign(new Error(saved?.message || 'Photo recovery did not confirm the upload.'),{status:response.status});
                return {ok:true,publicUrl:APP_API_FUNCTION_URL + '?photo_blob=' + saved.id,filePath,fileName:String(formData.get('fileName')||''),bucketName,storage:'postgres',...(saved.receipt ? {receipt:{...saved.receipt,writeConfirmed:true}} : {})};
            }
            return { ok: true, publicUrl: SUPABASE_URL + '/storage/v1/object/public/' + bucketName + '/' + filePath, filePath, bucketName };
        }

function getManagerAssignableOwnerUsers() {
            const state = getManagerAssignedColumnState();
            const assigned = [typeof warehouseAssignedItemsInventory !== 'undefined' ? warehouseAssignedItemsInventory : [], typeof fullInventory !== 'undefined' ? fullInventory : [], state.rows,
                [...(state.defaultOwnersByCode?.values() || [])]].filter(Array.isArray)
                .flatMap(rows => rows.flatMap(row => [row.ASSIGNEDTO, row.assignedto, row.DEFAULT_ASSIGNEDTO, row.default_assignedto]));
            const existingOwners = new Set(assigned.map(normalizeEvalAssignableUser).filter(Boolean));
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

        function applySuspendTagInventoryReceipt(result, scope) {
            if (scope !== getSupabaseReadIdentityScope()) return false;
            const rows = Array.isArray(result?.inventoryRows) ? result.inventoryRows : result?.inventoryRow ? [result.inventoryRow] : [];
            let applied = false;
            for (const row of rows) {
                if (!row?.unique_id || !row.itemcode || !row.locationcode || isFalseBlockLocation(row.locationcode)) continue;
                const target = Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toUpperCase(),value]));
                target.SOURCE_TABLE = 'ph_master_inventory';
                reconcileConfirmedDriveEvidence({ok:true,code:'SAVED',canonicalConfirmed:true,row,locationRows:[row]}, target, 'req-', {scope,photoOnly:true,preserveDetailDraft:true});
                applied = true;
            }
            return applied;
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
            return window.GncUserAccessControl?.resolveUserAccessMatrix(username, String(currentRole || '')) || null;
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
            let result;
            for (let attempt = 0; ; attempt += 1) {
                try { result = await postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'suspend_tag', operation, payload,
                commandId: options.commandId || null, expectedVersion: options.expectedVersion == null ? null : options.expectedVersion },
                { timeoutMs: getDetailRowWriteTimeoutMs(), signal: options.signal, label: 'Suspend Tag ' + operation, idempotencyKey: options.commandId || '' });
                    break;
                } catch (error) {
                    if (!['save','complete'].includes(operation) || attempt >= 2 || !/55P03|57014/.test(String(error?.code || '')+' '+String(error?.message || '')) || owner !== getSupabaseReadIdentityScope() || options.signal?.aborted) throw error;
                    await new Promise(resolve => setTimeout(resolve, [300,700][attempt]));
                }
            }
            if (!result || result.ok !== true || !result.data) throw new Error(result && (result.code || result.error) || 'Suspend Tag was not confirmed.');
            if (owner === getSupabaseReadIdentityScope() && !['rows', 'approval', 'inbox'].includes(operation)) {
                applySuspendCandidateRows(result.data.rows);
                if (operation === 'add_candidates') applySuspendTagInventoryReceipt(result.data, owner);
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
                bulk.textContent = 'Assign Selected (' + count + ')';
                bulk.disabled = count === 0 || [...snapshot.codes].some(code => state.defaultPending?.has(code));
            }
            const all = document.querySelector('[data-manager-assign-filtered]');
            if (all) { all.textContent = 'Assign All Filtered (' + snapshot.rows.length + ')'; all.disabled = !snapshot.rows.length || [...snapshot.codes].some(code => state.defaultPending?.has(code)); }
        }

        function applyOptimisticItemcodeOwners(codes, assignee) {
            const state = getManagerAssignedColumnState(), wanted = new Set(codes), snapshots = [];
            const fields = ['DEFAULT_ASSIGNEDTO','default_assignedto','DEFAULT_OWNER','default_owner','ASSIGNEDTO','assignedto','effective_worker','EFFECTIVE_WORKER','zone_override_active','assignment_reason'];
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
            return () => { snapshots.forEach(({row,before}) => { if (row.default_owner !== assignee) return; Object.entries(before).forEach(([field, prior]) => { if(prior.exists)row[field]=prior.value;else delete row[field]; }); }); state.dataEpoch++; clearWarehouseAssignedItemCaches(); invalidateManagerEvalReport2Cache(); };
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
            return state.viewProps = { ...state.viewHandlers, uiState: state.viewUi ||= { expanded: new Set(), anchor: null }, rows: displayed, totalRows: totalRows ?? (pageSource ? null : allRows.length), ...(pageSource ? { pageSource } : {}),
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
            return `${getDatasetLoadSignature('warehouseAssignedItems')}|${useMaster ? getDatasetLoadSignature('master') : ''}|${warehouseAssignedItemsInventory.length}|${state.dataEpoch || 0}|${JSON.stringify(state.defaultDrafts || {})}|${targetRevision}|${getDatasetLoadSignature('cav')}|${getDatasetLoadSignature('cropRollDrive')}|${managerEvalReportSettings?.lowStockMaxSLts}`;
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
            if (bulk) bulk.value = value;
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
            if (!force && Date.now() - Number(state.defaultOwnersCheckedAt || 0) < 60000) return state.defaultOwnersByCode;
            state.defaultOwnersCheckedAt = Date.now();
            state.defaultOwnersPromise = fetchAllSupabaseRows('ph_itemcode_default_owners', 'select=*&order=itemcode_normalized.asc').then(rows => {
                if (state !== getManagerAssignedColumnState() || scope !== getSupabaseReadIdentityScope()) return null;
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
                refreshSuspendOwnerViews();
                if (isViewVisible('managers')) scheduleHydratedViewRender('managers');
                return state.defaultOwnersByCode;
            }).catch(() => state.defaultOwnersByCode).finally(() => { state.defaultOwnersPromise = null; });
            return state.defaultOwnersPromise;
        }

        function renderManagerAssignedFallbackRows(rows = [], preview = false) {
            const state = getManagerAssignedColumnState(), limit = state.fallbackLimit || 100;
            const columns = getManagerAssignedColumnDefinitions().slice(0, 7), editable = canManageEvalItemcodeAssignments();
            return '<div data-assigned-fallback><table class="ai-primary-columns"><colgroup>' + (editable ? '<col class="ai-select-col">' : '')
                + columns.map(([field]) => '<col data-field="' + field + '">').join('') + '</colgroup><thead><tr>' + (editable ? '<th>Select</th>' : '')
                + columns.map(([,label]) => '<th>' + escapeHtml(label) + '</th>').join('') + '</tr></thead><tbody>'
                + rows.slice(0, limit).map(row => {
                    const code = buildManagerEvalAssignmentKey(row.ITEMCODE), attr = escapeHtml(JSON.stringify(code));
                    return '<tr data-manager-assigned-item-row="' + escapeHtml(code) + '">'
                        + (editable ? '<td><input type="checkbox" aria-label="Select ' + escapeHtml(code) + ' for bulk assignment" data-itemcode="' + escapeHtml(code) + '"' + (preview ? ' disabled' : '') + (managerEvalAssignmentSelection.has(code) ? ' checked' : '') + ' onchange="toggleManagerEvalAssignmentItem(' + attr + ',&quot;&quot;,this.checked);updateManagerAssignedItemsView()"></td>' : '')
                        + columns.map(([field]) => '<td>' + (field === 'DEFAULT_ASSIGNEDTO' && editable && !preview
                            ? '<select aria-label="Itemcode Default Owner ' + escapeHtml(code) + '" data-default-owner="' + escapeHtml(code) + '" onchange="assignManagerCheckedItemcodes(' + attr + ',this.value)">' + getManagerEvalAssigneeOptionsHtml(state.defaultDrafts?.[code]?.assignedto ?? row[field]) + '</select>'
                            : escapeHtml(row[field] ?? '')) + '</td>').join('') + '</tr>';
                }).join('') + '</tbody></table>' + (!preview && rows.length > limit ? '<button type="button" onclick="getManagerAssignedColumnState().fallbackLimit=' + (limit + 40) + ';updateManagerAssignedItemsView()">Show more items</button>' : '') + '</div>';
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

function isCompletedInventoryRow(item = null) {
    return !!item && (item.completed === true || String(item.DATE_COMPLETED || item.date_completed || item.completed_at || '').trim() !== '');
}

function getCompletedRowUnlockKey(item = activeItem) {
    return item ? String(item.UNIQUE_ID || item.unique_id || '') : '';
}

function syncCompletedRowControls(prefix, item = activeItem) {
    if (!item || item !== activeItem) return;
    const completed = isProtectedSectionCompleted(prefix, item), locked = completed && !isProtectedUnlocked(prefix);
    const button = document.getElementById(prefix + 'btn-save-complete');
    if (button) {
        button.textContent = completed && locked ? '✅ COMPLETED' : 'MARK DONE';
        button.disabled = locked || !canEditRowDetails(prefix, item);
        button.classList.toggle('completed-row-button', completed && locked);
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
    const rows = [item, ...fullInventory.filter(row => row !== item && getCompletedRowUnlockKey(row) === getCompletedRowUnlockKey(item))];
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
    return state[cacheKey] = { defaults, inventory, epoch: state.dataEpoch, exact, family };
}

function resolveSuspendOwner(item) {
    const code = buildManagerEvalAssignmentKey(item?.ITEMCODE || item?.itemcode || item?.ITEM || item?.item);
    const suspend = item?.DOCK_SUSPEND_DC_REQUEST === true || isDockSuspendDcRequestSource(item);
    const {exact, family, defaults} = getCardEvalOwnerIndex(getManagerAssignedColumnState(), suspend);
    const owner = exact.get(code) || family.get(code.split('.')[0]);
    if (owner) return owner;
    if (suspend) return (!defaults && normalizeEvalAssignableUser(item?.suspend_eval_owner || item?.SUSPEND_EVAL_OWNER)) || 'Unassigned';
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

function getSuspendEvalUserFilter() {
    const actor = normalizeEvalAssignableUser(currentUser);
    if (suspendEvalFilterScope !== actor || !canUseRequestSuspendTagAssignedToFilter()) {
        suspendEvalFilterScope = actor;
        requestSuspendEvalUserFilter = actor === 'jd_jones' ? 'ALL' : actor;
    }
    return requestSuspendEvalUserFilter;
}

function buildSuspendEvalUserFilter(items = [], id = 'suspend-eval-user-filter') {
    if (!canUseRequestSuspendTagAssignedToFilter()) return '';
    const { exact } = getCardEvalOwnerIndex(getManagerAssignedColumnState(), true);
    const counts = new Map(Array.from(exact.values(), owner => [owner, 0]));
    for (const item of items) {
        const owner = resolveSuspendOwner(item);
        if (owner === 'Unassigned' || counts.has(owner) || item?.suspend_eval_owner || item?.SUSPEND_EVAL_OWNER) counts.set(owner, (counts.get(owner) || 0) + 1);
    }
    const selected = getSuspendEvalUserFilter();
    const option = (value, label, count) => '<option value="'+escapeHtml(value)+'"'+(value === selected ? ' selected' : '')+'>'+escapeHtml(label)+' ('+count+')</option>';
    const options = [...counts.keys()].filter(user => user !== 'Unassigned').sort().map(user => option(user,user,counts.get(user)));
    if (counts.has('Unassigned')) options.push(option('Unassigned','Unassigned',counts.get('Unassigned')));
    return '<label class="workflow-control"><span>Assigned User / Eval User</span><select id="'+id+'" onchange="return setSuspendEvalUserFilter(this.value)">'+option('ALL','All Suspend Tags',items.length)+options.join('')+'</select></label>';
}

function setSuspendEvalUserFilter(value = 'ALL') {
    getSuspendEvalUserFilter();
    if (canUseRequestSuspendTagAssignedToFilter()) {
        const user = normalizeEvalAssignableUser(value);
        requestSuspendEvalUserFilter = user === 'all' ? 'ALL' : user === 'unassigned' ? 'Unassigned' : user;
    }
    markViewDirty('request');
    renderRequest();
    return false;
}

function refreshSuspendOwnerViews() {
    requestScopedItemsCacheKey = '';
    for (const view of ['request','drive','av']) markViewDirty(view);
    if (activeReqTab === 'suspend-tag' && isViewVisible('request')) scheduleHydratedViewRender('request');
    else if (isViewVisible('drive') || isViewVisible('av')) scheduleDeferredVisibleDirtyViewRefresh('eval-owners');
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
    if (!item || !currentUser) return false;
    const actor = normalizeEvalAssignableUser(currentUser);
    const role = String(currentRole || '').trim().toLowerCase().replace(/[ _]/g, '-');
    if (actor === 'dylan_collyge' || ['admin','administrator','manager','super-admin'].includes(role)) return true;
    const owner = getMasterAssignedToValue(item) || item.EFFECTIVE_WORKER || item.effective_worker || item.DEFAULT_ASSIGNEDTO || item.default_assignedto;
    return !!owner && normalizeEvalAssignableUser(owner) === actor;
}

async function unlockProtectedSection(prefix) {
    const item = activeItem, scope = getSupabaseReadIdentityScope();
    if (!canUnlockCompletedRow(item) || !canEditRowDetails(prefix, item)) { showRowEditRestrictedToast(prefix); return false; }
    if (item.__unlockInFlight) return false;
    item.__unlockInFlight = true;
    try {
        const headers = await getNativeAuthRequestHeaders();
        const response = await fetchWithTimeout(APP_API_FUNCTION_URL, {method:'POST',headers:{...headers,'Content-Type':'application/json'},
            body:JSON.stringify({action:'unlock_drive_row',masterUid:getCompletedRowUnlockKey(item),expectedSignature:String(item.LAST_UPDATED || item.last_updated || '')})},4000,'Unlock row');
        const result = await response.json();
        if (!response.ok || result.ok !== true) throw new Error(result.message || result.code || 'Row could not be unlocked.');
        if (scope !== getSupabaseReadIdentityScope()) return false;
        reconcileConfirmedDriveEvidence({...result,writeConfirmed:true}, item, prefix, {scope});
        if (activeItem && getCompletedRowUnlockKey(activeItem) === getCompletedRowUnlockKey(item)) {
            ['DATE_COMPLETED','date_completed','completed_at'].forEach(key => { activeItem[key] = null; });
            activeItem.completed = false; activeItem.row_locked = false;
            protectedEditState[prefix] = getCompletedRowUnlockKey(activeItem);
            clearProtectedTimers(prefix); renderSavedPhotos(); renderPhotoGallery(); applyProtectedEditState(prefix);
        }
    } catch (error) { showToast('Row remains locked', String(error.message || 'Retry unlocking this row.'), true); }
    finally { delete item.__unlockInFlight; }
    return false;
}

function applySuspendEvalUserFilter(items = []) {
    const owner = getSuspendEvalUserFilter();
    return owner === 'ALL' ? items : items.filter(item => resolveSuspendOwner(item) === owner);
}

function buildSuspendLocationOptionActions(source, row) {
    const uid = escJsAttrValue(String(source.UNIQUE_ID || source.unique_id || ''));
    const masterUid = escJsAttrValue(getRequestItemCodeOptionMasterId(row));
    const location = escapeHtml(row.LOCATIONCODE || row.locationcode || '');
    const oldLocation = escapeHtml(source.LOCATIONCODE || source.locationcode || '');
    return '<div class="suspend-location-actions"><label>Split quantity <input type="number" min="1" step="1" aria-label="Split pull quantity" id="suspend-split-' + escapeHtml(masterUid) + '"></label><button type="button" onclick="event.stopPropagation(); return changeSuspendPullLocation(\'' + uid + '\',\'' + masterUid + '\',\'replace_location\')">🔄 Pull Order From ' + location + ' Instead (Remove ' + oldLocation + ' &amp; Update Dock/Drop)</button><button type="button" onclick="event.stopPropagation(); return changeSuspendPullLocation(\'' + uid + '\',\'' + masterUid + '\',\'split_location\', document.getElementById(\'suspend-split-' + masterUid + '\').value)">➕ Add ' + location + ' to Split Order</button></div>';
}

async function changeSuspendPullLocation(uniqueId, masterUid, operation, splitQuantity = null) {
    const source = findDockSuspendDcRequestMirrorRowByUniqueId(uniqueId) || activeItem;
    if (!source || !['replace_location','split_location','remove_location'].includes(operation)) return false;
    if (operation==='split_location' && (!Number.isFinite(Number(splitQuantity)) || Number(splitQuantity)<=0)) {showToast('Split Quantity','Enter the quantity to pull from this location.',true);return false;}
    const sourceUid = getDockSuspendDcRequestSourceUid(source);
    const scope = getSupabaseReadIdentityScope();
    const state = getDockSuspendCompletionState();
    const key = JSON.stringify([operation,sourceUid,masterUid]);
    const flightKey = scope + '|' + sourceUid;
    if (dockSuspendCompletionInFlight.has(flightKey)) return false;
    const pending = state.pending[key] || {requestId:crypto.randomUUID(),savedAt:Date.now()};
    state.pending[key]=pending; persistDockSuspendCompletionState(state);
    dockSuspendCompletionInFlight.add(flightKey);
    const original = findDockSuspendDcRequestSourceRow(source) || source;
    const snapshot = {...original,unique_id:sourceUid};
    try {
        if (operation === 'remove_location') applySuspendCandidateRows([{...snapshot,suspend_candidate_state:'replaced',suspend:null,suspend_to:null,quantityordered:'0'}]);
        const result = await suspendTagApi(operation,{sourceUid,sourceIdentity:getSuspendTagStableSourceIdentity(original),expectedLastUpdated:getDockSuspendCompletionRevision(original),inventoryIds:masterUid?[masterUid]:[],...(operation==='split_location'?{splitQuantity:Number(splitQuantity)}:{})},{commandId:pending.requestId,expectedVersion:getSuspendTagWriteVersion(source)});
        if (!result?.ok || !Array.isArray(result.rows)) throw new Error('The order line was not confirmed. Retry safely.');
        if (scope !== getSupabaseReadIdentityScope()) return false;
        delete state.pending[key]; persistDockSuspendCompletionState(state);
        requestAvOptionsDropdownOpen=false;
        if (isViewVisible('detail')) {lastView='request';goBackFromDetail();}
        scheduleRequestRender(0,16,true);
        showToast('Location Saved','The exact Dock and Drop now use the confirmed pull locations.');
    } catch (error) {
        if (scope===getSupabaseReadIdentityScope()) {applySuspendCandidateRows([snapshot]);showToast('Location Not Saved',suspendTagErrorMessage(error),true);}
    } finally {dockSuspendCompletionInFlight.delete(flightKey);}
    return false;
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
            const emptyIndex = () => ({ exact: new Map(), base: new Map(), family: new Map() });
            const agree = (map, key, group) => map.set(key, map.has(key) && map.get(key) !== group ? '' : group);
            const indexRow = (index, row) => {
                const code = buildManagerEvalAssignmentKey(row?.ITEMCODE || row?.itemcode || row?.itemcode_normalized);
                const group = getCropRollPlantGroup(row, false);
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
                return { ...row, PLANTGROUPCODE: group, plantgroupcode: group, plant_group_code: group };
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

function confirmRowPhotoSlot(job) {
    for (const slot of getPendingPhotoPreviewEntries(job.item, job.prefix)) {
        if (slot.id === job.id) Object.assign(slot, {publicUrl:job.upload.publicUrl, name:job.upload.fileName, status:'Uploaded'});
    }
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
    requestAnimationFrame(() => setTimeout(async () => {
        if (!current()) return;
        try {
            const useMaster = fullInventory.length > 0;
            const input = useMaster ? fullInventory : warehouseAssignedItemsInventory;
            const signature = () => getManagerAssignedDisplaySignature(state, useMaster, getManagerItemLowStockTargetsState().revision);
            const started = signature();
            if (state.displayCache?.input === input && state.displayCache.signature === started) return;
            const sorted = input.slice().sort(compareAssignedItemCodes);
            const rows = [], byId = new Map(), seen = new Set();
            for (let offset = 0; offset < sorted.length; offset += 100) {
                if (!current()) return;
                const batch = getManagerAssignedItemsDisplayRows(sorted.slice(offset, offset + 100), {useMaster});
                for (const row of batch) {
                    rows.push(row);
                    byId.set(String(row.MASTER_UNIQUE_ID || row.UNIQUE_ID), row);
                }
                if (!offset) {
                    const preview = state.viewMode === 'rows' ? batch : batch.filter(row => !seen.has(row.ITEMCODE) && seen.add(row.ITEMCODE));
                    const slot = host.querySelector('[data-assigned-opening]');
                    if (slot) slot.innerHTML = renderManagerAssignedFallbackRows(preview, true);
                }
                if (offset + 100 < sorted.length) await new Promise(resolve => setTimeout(resolve, 0));
            }
            if (current() && started === signature() && input === (useMaster ? fullInventory : warehouseAssignedItemsInventory)) {
                state.displayCache = { input, signature: started, length: input.length, rows, byId };
            }
        } finally { finish(); }
    }, 0));
}
