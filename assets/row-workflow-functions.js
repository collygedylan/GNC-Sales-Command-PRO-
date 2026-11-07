function buildEvalWorkAvNoteChoiceButtons(values = []) {
    const spec=String(document.getElementById('eval-work-spec')?.value || '').trim();
    const entries=[['__SPEC_ONLY__','✓ SPEC ONLY ('+(spec?'SPEC - '+spec:'No AV Note')+')'],['__CLEAR_AV_NOTE__','✕ Clear AV Note (Blank)'],...values.map(value=>[value,value])];
    return entries.map(([value,label])=>'<button type="button" data-eval-av-note="'+escapeHtml(value)+'" onpointerdown="return selectEvalWorkAvNote(this.dataset.evalAvNote,event)" ontouchstart="return selectEvalWorkAvNote(this.dataset.evalAvNote,event)" onmousedown="event.preventDefault()" onclick="return selectEvalWorkAvNote(this.dataset.evalAvNote,event)">'+escapeHtml(label)+'</button>').join('');
}

function isSpecOnlyAvNoteContext(item) {
    if (!item) return false;
    const note = item.LOCATION_NOTE ?? item.LOCATIONNOTE ?? item.location_note ?? item.locationnote ?? '';
    const lot = String(item.LOTCODE || item.lotcode || '').trim().toUpperCase();
    return !!String(note).trim() || !!lot && !/(?:^|[.\s_-])F1$/.test(lot)
        || /location/i.test(String(item.APP_TAB_ASSIGNMENT || item.app_tab_assignment || ''));
}

function buildAvNoteSpecialOptions(prefix) {
    const spec=String(document.getElementById(prefix+'spec')?.value || '').trim();
    const button=(value,label)=>`<button type="button" class="av-note-dropdown-option" data-av-note-option="${value}" data-av-note-prefix="${escapeHtml(prefix)}" role="option" onpointerdown="return selectAvNote(this.dataset.avNoteOption,this.dataset.avNotePrefix,event,{fromPressStart:true})" ontouchstart="return selectAvNote(this.dataset.avNoteOption,this.dataset.avNotePrefix,event,{fromPressStart:true})" onmousedown="event.preventDefault()" onclick="return selectAvNote(this.dataset.avNoteOption,this.dataset.avNotePrefix,event)">${escapeHtml(label)}</button>`;
    return button('__SPEC_ONLY__',`✓ SPEC ONLY (${spec ? 'SPEC - '+spec : 'No AV Note'})`)+button('__CLEAR_AV_NOTE__','✕ Clear AV Note (Blank)');
}

function openInlineAvNoteList(prefix, options = {}) {
    if (!AV_NOTE_DROPDOWN_PREFIXES.includes(prefix) || !canEditRowDetails(prefix)) return false;
    const input=document.getElementById(getAvNoteInputIdForPrefix(prefix)),list=document.getElementById(getAvNoteDropdownListIdForPrefix(prefix));
    if (!input || !list || input.disabled) return false;
    if (requestAvNoteSheetState.prefix === prefix) closeRequestAvNoteSheet(list);
    input.readOnly=false;input.inputMode='text';list.dataset.avNotePresentation='inline';
    list.style.setProperty('position','relative','important');list.style.setProperty('inset','auto','important');
    list.style.setProperty('max-height','180px','important');list.style.setProperty('overflow-y','auto','important');
    const label=input.parentElement?.parentElement?.querySelector('label span');
    if(label)label.textContent=isSpecOnlyAvNoteContext(activeItem)?'AV NOTE (OPTIONAL — SPEC ONLY OK)':'AV Note';
    avNoteRenderedKeys[prefix]='';
    filterAvNotes(prefix,{...options,inline:true,showAll:options.searchText===undefined});
    return false;
}

function captureEvaluationDetailReturn(item) {
    const editor = activeItem;
    const text=(row,key)=>String(row?.[key] || row?.[key.toLowerCase()] || '').trim().toUpperCase();
    const sameTuple=!!text(editor,'ITEMCODE') && ['ITEMCODE','LOCATIONCODE','LOTCODE'].every(key=>text(editor,key)===text(item,key));
    const ownsEditor=!!editor && (editor===item || String(editor.UNIQUE_ID || editor.unique_id || '')===String(item.UNIQUE_ID || item.unique_id || '') || sameTuple);
    const viewId=String(detailReturnState?.viewId || lastView || activeDetailSourceView || '').trim();
    return { ownsEditor, editor, token:detailHydrationToken, scope:getSupabaseReadIdentityScope(), viewId:viewId==='detail'?'':viewId,
        scrollTop:Math.max(0,Number(detailReturnState?.scrollTop)||0) };
}

function returnFromConfirmedEvaluationDetail(snapshot) {
    const nav=snapshot?.detailNavigation;
    if (!nav?.ownsEditor || nav.scope!==getSupabaseReadIdentityScope() || !isViewVisible('detail')) return false;
    // A hydration may replace the display UID with the exact master UID. The captured
    // editor generation owns Back; the persistence target's UID never owns navigation.
    if (activeItem!==nav.editor && detailHydrationToken!==nav.token) return false;
    const parent=nav.viewId && getViewElementById(nav.viewId) ? nav.viewId : String(lastView || '').trim();
    if (!parent || parent==='detail') return false;
    lastView=parent;detailReturnState={viewId:parent,scrollTop:nav.scrollTop};
    goBackFromDetail();
    if (isViewVisible('detail')) {
        // Shared overlays can consume Back; completion still owns exactly one parent return.
        teardownDetailPresentation('confirmed-evaluation-return',{preserveDraft:true});
        clearPendingDetailHydration();detailHydrationToken+=1;setDetailEditingChromeState(false);
        activeItem=null;activeDetailSourceView='';activeDetailTab='overview';
        fastBackToView(parent,{targetScrollTop:nav.scrollTop,skipFilterPersist:true,renderDelay:0});
    }
    return !isViewVisible('detail');
}

function applyExplicitAvNotePayload(payload,row,options = {}) {
    const captured=options.markDoneSnapshot?.payload;
    if (captured?.explicit_av_note === true) {
        payload.explicit_av_note=true;payload.av_note=String(captured.av_note ?? '');row.AV_NOTE=payload.av_note;
    } else if (options.explicit_av_note === true && String(row.UNIQUE_ID || row.unique_id || '')===String(options.explicitAvNoteOwner || '')) {
        payload.explicit_av_note=true;payload.av_note=String(options.explicitAvNoteValue ?? '');row.AV_NOTE=payload.av_note;
    }
    return payload;
}

function mergeConfirmedRowEvaluationUploads(snapshot) {
    if (!snapshot || snapshot.scope !== getSupabaseReadIdentityScope()) return;
    const row = snapshot.row, prefix = snapshot.prefix;
    const urls = new Set(getPhotoUrlList(snapshot.payload.photo_link));
    // Only captured row/upload owners contribute; never consult a later editor's DOM or draft.
    for (const source of [row,...snapshot.uploadRows]) for (const key of ['PHOTO_LINK','SAVED_PHOTO_LINK','REQ_PHOTO_LINK','REQUEST_PHOTO_LINK','DOCK_PHOTO_LINK','FLYER_PHOTO_LINK'])
        for (const url of getPhotoUrlList(source[key] || source[key.toLowerCase()] || '')) urls.add(url);
    const csv = [...urls].join(',');
    if (csv) {
        row.SAVED_PHOTO_LINK = row.PHOTO_LINK = csv;
        if (prefix === 'req-') row.REQ_PHOTO_LINK = row.REQUEST_PHOTO_LINK = row.DOCK_PHOTO_LINK = csv;
        if (prefix === 'flyer-') row.FLYER_PHOTO_LINK = csv;
    }
}

function beginConfirmedRowEvaluationUi(snapshot) {
    const {row,source,prefix,scope,isSuspend,payload} = snapshot;
    const uid = String(row.UNIQUE_ID || row.unique_id || '');
    const target = findLinkedMasterRow(row) || (String(row.SOURCE_TABLE || 'ph_master_inventory') === 'ph_master_inventory' ? source : null);
    const rollbackPublication = beginRowEvaluationMemoryPublication(target,payload,scope);
    const memoryOwners=getManagerAssignedColumnState().rowEvaluationMemoryOwners;
    const memoryUid=String(target?.UNIQUE_ID || target?.unique_id || '');
    const memoryOwner=memoryOwners?.get(memoryUid);
    const token = {}, priorToken = source.__rowEvaluationPending;
    const suspendSnapshots = [];
    source.__rowEvaluationPending = token;
    const isRequest = prefix === 'req-' && !isSuspend;
    let removedRows = [], evidenceRolledBack = false, completionRolledBack = false;
    const undoCompletion = target ? beginOptimisticCompletedRow(target,prefix,{...payload}) : null;
    const state = {settled:false,confirmed:false,
        rollbackCompletion() { if (!completionRolledBack && !state.confirmed && scope===getSupabaseReadIdentityScope() && (!memoryOwner || memoryOwners?.get(memoryUid)===memoryOwner)) { completionRolledBack=true;undoCompletion?.(); } },
        rollbackEvidence() { if (!evidenceRolledBack && !state.confirmed) { state.rollbackCompletion();evidenceRolledBack=true; rollbackPublication(); } },
        commit() { state.confirmed=true;state.settled=true;if(source.__rowEvaluationPending===token)delete source.__rowEvaluationPending;for(const entry of suspendSnapshots)if(entry.row.__rowEvaluationPending===token)delete entry.row.__rowEvaluationPending; },
        rollback() {
            if (state.confirmed || state.settled) return;
            state.settled=true;
            if (scope !== getSupabaseReadIdentityScope() || source.__rowEvaluationPending !== token) return;
            state.rollbackCompletion();state.rollbackEvidence();
            for(const entry of suspendSnapshots) if(entry.row.__rowEvaluationPending===token) {
                for(const [key,existed,value,written] of entry.fields) if(entry.row[key]===written) {if(existed)entry.row[key]=value;else delete entry.row[key];}
                delete entry.row.__rowEvaluationPending;
            }
            if (priorToken) source.__rowEvaluationPending=priorToken;else delete source.__rowEvaluationPending;
            if (isRequest) {
                clearOptimisticCompletedRows([uid]);
                if (!requestsInventory.some(item=>String(item.UNIQUE_ID || item.unique_id || '')===uid)) requestsInventory.push(...removedRows);
                refreshRealtimeDetailLookupIndexes(ACTIVE_REQUEST_TABLE);
                updateFooterRequestBadge();
                refreshLocalRequestViewState('request-complete-retry',{forceRender:true,preferImmediate:true,userAction:true});
            }
            markViewDirty('drive');markViewDirty('av');markViewDirty('request');
        }
    };
    if (isSuspend) {
        const sourceUid = getDockSuspendDcRequestSourceUid(source), fields = {};
        const set=(keys,value)=>{if(value!==undefined)for(const key of keys)fields[key]=fields[key.toLowerCase()]=value;};
        set(['SPEC','REQ_SPEC','DOCK_SPEC'],payload.spec);set(['CALIPER','REQ_CALIPER','DOCK_CALIPER'],payload.caliper);
        set(['AV_NOTE'],payload.av_note);set(['MATCH','REQ_MATCH'],payload.match);
        set(['PICK','PICK_NOTE','REQ_PICK'],payload.pick_note);set(['COMMENTS','SALES_NOTE','REQ_COMMENTS'],payload.sales_note);
        set(['PHOTO_LINK','SAVED_PHOTO_LINK','REQ_PHOTO_LINK','REQUEST_PHOTO_LINK','DOCK_PHOTO_LINK'],payload.photo_link);
        set(['DOCK_NOTE'],buildDockSuspendDcRequestNote(snapshot.values,source.DOCK_NOTE || ''));
        const rows=new Set([source,...snapshot.uploadRows,...requestsInventory,...socInventory,...socRawSourceRows,...suspendTagInventory]);
        for(const item of rows) if(item && getDockSuspendDcRequestSourceUid(item)===sourceUid) {
            suspendSnapshots.push({row:item,fields:Object.entries(fields).map(([key,value])=>[key,Object.hasOwn(item,key),item[key],value])});
            Object.assign(item,fields);item.__rowEvaluationPending=token;
        }
    }
    if (isRequest) {
        removedRows=requestsInventory.filter(item=>String(item.UNIQUE_ID || item.unique_id || '')===uid);
        requestsInventory=requestsInventory.filter(item=>String(item.UNIQUE_ID || item.unique_id || '')!==uid);
        trackOptimisticCompletedRows([uid]);
        refreshRealtimeDetailLookupIndexes(ACTIVE_REQUEST_TABLE);
        updateFooterRequestBadge();
    }
    // Keep the exact form draft durable before leaving; completion is still pending.
    backupLocalItem(row,isRequest ? createRequestWorkDraft(row,{
        req_spec:row.REQ_SPEC,req_caliper:row.REQ_CALIPER,req_match:row.REQ_MATCH,
        req_pic_note:row.REQ_PICK,req_comments:row.REQ_COMMENTS,av_note:row.AV_NOTE,
        req_photo_link:row.REQ_PHOTO_LINK,req_photo_name:row.REQ_PHOTO_NAME
    },getRequestWorkValuesFromRow(source),true) : null);
    returnFromConfirmedEvaluationDetail(snapshot);
    if (isRequest || isSuspend) refreshLocalRequestViewState('row-completion-pending',{forceRender:true,preferImmediate:true,userAction:true});
    showToast('Saving','Your work is saving in the background.');
    return state;
}

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
    if (!String(item?.UNIQUE_ID || item?.unique_id || '').trim()) return;
    // Warm local compression only. The authorized upload performs its own exact-row proof.
    // Probing a fake all-zero filename and a no-store Storage HEAD on row-open wastes origin reads.
    getPhotoOptimizerWorker();
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
    const exact = (typeof findLinkedMasterRow === 'function' ? findLinkedMasterRow(item) : null)
        || (typeof getQueueCardInventoryRow === 'function' && typeof isDockSuspendDcRequestMirrorRow === 'function' && isDockSuspendDcRequestMirrorRow(item) ? getQueueCardInventoryRow(item,'request') : null);
    const row = exact || item;
    const rawPct = String(matchValue ?? '').trim();
    const pct = Number(rawPct.replace(/%$/, ''));
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(rawPct) || pct > 100) return null;
    if (pct === 0) return 0;
    const onHand = parseAppNumber(firstNonEmptyValue(row.PTRONHAND,row.ptronhand,row.ON_HAND,row.on_hand,row.onhand,row.ONHAND,''));
    return onHand == null ? null : Math.round(Math.max(0,onHand)*pct/100);
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
function collectAllActiveItemDetailPhotos(targetRow = null, prefix = '') {
    if (!targetRow) return [];
    const state = getManagerAssignedColumnState();
    const normalize = value => String(value || '').trim().toUpperCase();
    const value = (row, name) => row?.[name] ?? row?.[name.toLowerCase()] ?? '';
    const itemcode = normalize(value(targetRow,'ITEMCODE'));
    const locationcode = normalize(value(targetRow,'LOCATIONCODE'));
    const normalizeLot = input => normalize(input).replace(/[\s_-]+/g,'.').replace(/^20(\d{2})(?=\.)/,'$1');
    const lotcode = normalizeLot(value(targetRow,'LOTCODE'));
    const master = findLinkedMasterRow(targetRow) || masterInventoryById.get(String(targetRow.UNIQUE_ID || targetRow.unique_id || ''));
    const masterUid = String(master?.UNIQUE_ID || master?.unique_id || targetRow.MASTER_ID || targetRow.master_id || targetRow.MASTER_UNIQUE_ID || targetRow.master_unique_id || '');
    const rowUid = row => String(row?.MASTER_ID || row?.master_id || row?.MASTER_UNIQUE_ID || row?.master_unique_id || row?.UNIQUE_ID || row?.unique_id || '');
    const matches = row => itemcode && locationcode && normalize(value(row,'ITEMCODE')) === itemcode
        && normalize(value(row,'LOCATIONCODE')) === locationcode;
    const urls = new Set(), visited = new Set();
    const add = input => {
        if (!input) return;
        if (Array.isArray(input)) { input.forEach(add); return; }
        if (typeof input === 'object') {
            if (visited.has(input)) return;
            visited.add(input);
            for (const key of ['url','publicUrl','photo_url','photo_urls','photos','request_photos','photo_link','saved_photo_link','req_photo_link','request_photo_link','dock_photo_link','flyer_photo_link']) {
                add(input[key]); add(input[key.toUpperCase()]);
            }
            return;
        }
        getPhotoUrlList(input).forEach(url => { if (/^https?:\/\//i.test(url)) urls.add(url); });
    };
    add(targetRow);
    const active = typeof activeItem !== 'undefined' && activeItem;
    const activeMatches = active && (active === targetRow || matches(active) && normalizeLot(value(active,'LOTCODE')) === lotcode && (!masterUid || !rowUid(active) || rowUid(active) === masterUid));
    const evalMatches = prefix === 'eval-' && String(evalWorkActiveOriginUid || '') === String(masterUid || rowUid(targetRow)) && !!getEvalWorkById(activeEvalWorkDetailId);
    if (activeMatches || evalMatches) {
        if (activeMatches) add(active);
        if (evalMatches) add(evalWorkActivePhotos);
        add(state.activeItemDetailPhotos); add(state.itemDetailDraft?.photos);
        const detail = evalMatches ? document.querySelector('#request-content .eval-work-evidence') : document.getElementById('view-detail');
        if (detail && !detail.classList.contains('hidden')) {
            const strip = evalMatches ? detail : document.getElementById(prefix + 'photo-list-container') || detail;
            strip.querySelectorAll('[data-photo-url], [data-eval-photo-url], .photo-card img, .saved-photo-tile img').forEach(node => {
                const canonical = node.getAttribute('data-photo-url') || node.getAttribute('data-eval-photo-url') || node.closest('[data-photo-url]')?.getAttribute('data-photo-url');
                add(canonical || node.getAttribute('data-src') || node.currentSrc || node.src);
            });
        }
    }
    const sources = [typeof fullInventory !== 'undefined' ? fullInventory : [],state.fullInventory];
    if (state.noteScope === getSupabaseReadIdentityScope()) sources.push(state.locationSalesNotes);
    for (const source of sources) {
        const list = source instanceof Map ? [...source.values()].flat() : Array.isArray(source) ? source : Object.values(source || {}).flat();
        const candidates = list.filter(matches);
        const byUid = masterUid ? candidates.filter(row => rowUid(row) === masterUid && (!lotcode || !normalizeLot(value(row,'LOTCODE')) || normalizeLot(value(row,'LOTCODE')) === lotcode)) : [];
        const exact = candidates.filter(row => (!lotcode || normalizeLot(value(row,'LOTCODE')) === lotcode)
            && (!masterUid || !rowUid(row) || rowUid(row) === masterUid));
        const fallback = candidates.filter(row => !normalizeLot(value(row,'LOTCODE')) && (!masterUid || !rowUid(row) || rowUid(row) === masterUid));
        (byUid.length ? byUid : exact.length ? exact : fallback).forEach(add);
    }
    return [...urls];
}

function mergeActiveItemDetailPhotoFields(row, prefix = '') {
    const photos = collectAllActiveItemDetailPhotos(row,prefix);
    if (!photos.length) return photos;
    const csv = photos.join(',');
    const existing = Array.isArray(row.photos) ? row.photos : [];
    row.photos = photos.map(url => existing.find(entry => typeof entry === 'object' && getPhotoUrlList([entry]).includes(url)) || url);
    const keys = ['PHOTO_LINK','SAVED_PHOTO_LINK'];
    if (prefix === 'req-') keys.push('REQ_PHOTO_LINK','REQUEST_PHOTO_LINK');
    if (prefix === 'dock-' || typeof isDockSuspendDcRequestMirrorRow === 'function' && isDockSuspendDcRequestMirrorRow(row)) keys.push('DOCK_PHOTO_LINK');
    if (prefix === 'flyer-') keys.push('FLYER_PHOTO_LINK');
    for (const key of keys) row[key] = row[key.toLowerCase()] = csv;
    return photos;
}

function resolveCanonicalInventoryRow(row) {
    if (!row) return row;
    const val = (value,key) => value?.[key] ?? value?.[key.toLowerCase()] ?? '';
    const norm = value => String(value || '').trim().toUpperCase();
    const lot = value => norm(value).replace(/[\s_-]+/g,'.').replace(/^20(\d{2})(?=\.)/,'$1');
    const uid = String(row.MASTER_ID || row.master_id || row.MASTER_UNIQUE_ID || row.master_unique_id || row.UNIQUE_ID || row.unique_id || '');
    let target = masterInventoryById.get(uid);
    const atLocation = candidate => norm(val(candidate,'ITEMCODE')) === norm(val(row,'ITEMCODE'))
        && norm(val(candidate,'LOCATIONCODE')) === norm(val(row,'LOCATIONCODE'));
    const matches = candidate => atLocation(candidate) && lot(val(candidate,'LOTCODE')) === lot(val(row,'LOTCODE'));
    if (target && !matches(target)) target = null;
    if (!target) {
        const locationRows = (masterInventoryByItemCode.get(norm(val(row,'ITEMCODE'))) || []).filter(atLocation);
        const candidates = locationRows.filter(matches);
        if (candidates.length === 1) target = candidates[0];
        else if (!candidates.length && locationRows.length === 1 && (!lot(val(row,'LOTCODE')) || !lot(val(locationRows[0],'LOTCODE')))) target = locationRows[0];
    }
    target ||= row;
    const state = getManagerAssignedColumnState(), scope = getSupabaseReadIdentityScope();
    const targetUid = String(target.UNIQUE_ID || target.unique_id || '');
    const notes = (state.noteScope === scope ? state.locationSalesNotes?.get(norm(val(target,'ITEMCODE'))) || [] : []).filter(atLocation);
    const exact = notes.filter(candidate => String(candidate.master_unique_id || candidate.master_id || candidate.unique_id || candidate.UNIQUE_ID || '') === targetUid || matches(candidate));
    const ranked = [...exact,...notes.filter(candidate => !exact.includes(candidate))].filter(candidate => {
        const stored = val(candidate,'LOC_PHOTO_MATCH') !== '' ? val(candidate,'LOC_PHOTO_MATCH') : val(candidate,'LOC_MATCH_QTY');
        return stored === '' || Number(String(stored).replace(/,/g,'')) !== 0;
    });
    const result = {...row,...target,__canonicalInventoryResolved:true};
    const stored = val(target,'LOC_PHOTO_MATCH') !== '' ? val(target,'LOC_PHOTO_MATCH') : val(target,'LOC_MATCH_QTY');
    const depleted = stored !== '' && Number(String(stored).replace(/,/g,'')) === 0;
    // Location fallback is display-only: never replace the physical UID, lot or stock.
    for (const keys of [['SPEC'],['CALIPER'],['AV_NOTE'],['PIC_NOTE','PICK_NOTE','PICK'],['SALES_NOTE','COMMENTS'],['MATCH','MATCH_PCT','LOC_MATCH_PCT']]) {
        const own = keys.map(key => val(target,key)).find(value => String(value).trim() !== '');
        const inherited = ranked.flatMap(note => keys.map(key => val(note,key))).find(value => String(value).trim() !== '');
        const value = own ?? inherited;
        if (value !== undefined) for (const key of keys) result[key] = result[key.toLowerCase()] = value;
    }
    const photos = new Map();
    for (const source of [target,...(depleted ? [] : ranked)]) {
        const raw = [source.PHOTOS,source.photos].flatMap(value => Array.isArray(value) ? value : typeof value === 'string' && value.trim().startsWith('[') ? (()=>{try{return JSON.parse(value);}catch{return [];}})() : []);
        const urls = ['PHOTO_LINK','SAVED_PHOTO_LINK','PHOTOS','PHOTO_URL'].flatMap(key => getPhotoUrlList(val(source,key)));
        for (const url of urls) {
            const stamp = getPhotoEntryDateMs(url,source);
            if (source !== target && (!Number.isFinite(stamp) || stamp > Date.now() || Date.now()-stamp > 10*86400000)) continue;
            if (photos.has(url)) continue;
            const metadata = raw.find(entry => entry && typeof entry === 'object' && getPhotoUrlList([entry]).includes(url));
            photos.set(url, metadata ? {...metadata} : Number.isFinite(stamp) ? {url,date:new Date(stamp).toISOString()} : url);
        }
    }
    if (photos.size) {
        result.PHOTO_LINK = result.photo_link = result.SAVED_PHOTO_LINK = [...photos.keys()].join(',');
        result.PHOTOS = result.photos = [...photos.values()];
        result.PHOTO_URL = result.photo_url = [...photos.keys()][0];
        const stamp = getPhotoRetentionFallbackDateMs(result);
        if (!String(val(result,'PHOTO_DATE')).trim() && Number.isFinite(stamp)) result.PHOTO_DATE = result.photo_date = new Date(stamp).toISOString();
    }
    const onHand = Number(String(['PTRONHAND','ON_HAND','ONHAND'].map(key => val(target,key)).find(value => value !== '')).replace(/,/g,''));
    const pct = Number(String(val(result,'LOC_MATCH_PCT') || val(result,'MATCH_PCT') || val(result,'MATCH')).replace(/[% ,]/g,''));
    const quantity = stored !== '' ? stored : photos.size && onHand > 0 && pct > 0 ? Math.round(Math.min(100,pct)*onHand/100) : undefined;
    if (quantity !== undefined) result.LOC_PHOTO_MATCH = result.loc_photo_match = quantity;
    // Canonical physical metrics own every legacy display alias, including zero/unknown.
    // Keep snapshot fallbacks from resurrecting a stale projection after a master refresh.
    const metricFamilies = [["PTRONHAND","PTR_ON_HAND","EXT_PTRONHAND","ON_HAND","ONHAND","onHand","qty_on_hand","oh"],["PTRREVIEWED","PTR_REVIEWED","PTRREVIEW","REVIEWED","REVIEW","REVIEW_QTY"],["PTRAVAILABLE","PRTAVAILABLE","AVAILABLE","AVAILABLE_QTY","LOC_AVAIL","LOC_AVAILABLE","LOCAVA"],["S_LTS","OPEN_STOCK","openStock"],["LOC_ON_HAND","locOnHand"],["LOC_PHOTO_MATCH","LOC_MATCH_QTY","CURRENT_PHOTO_MATCH_QTY","REQ_LOC_MATCH_QTY","PHOTO_MATCH_QTY","locPhotoMatch"]];
    const snapshot = row.SNAPSHOT || target.SNAPSHOT ? {...(row.SNAPSHOT || {}),...(target.SNAPSHOT || {})} : null;
    for (const keys of metricFamilies) {
        const aliases = [...new Set(keys.flatMap(key => [key,key.toLowerCase()]))];
        const ownKey = aliases.find(key => Object.hasOwn(target,key));
        const snapshotKey = ownKey === undefined && target.SNAPSHOT ? aliases.find(key => Object.hasOwn(target.SNAPSHOT,key)) : undefined;
        const value = keys[0] === 'LOC_PHOTO_MATCH' && quantity !== undefined ? quantity
            : ownKey !== undefined ? target[ownKey] : snapshotKey !== undefined ? target.SNAPSHOT[snapshotKey] : undefined;
        for (const key of aliases) {
            if ((value == null || String(value).trim() === '') && !(keys[0] === 'LOC_ON_HAND' && ownKey !== undefined)) { delete result[key]; if (snapshot) delete snapshot[key]; }
            else { result[key] = value; if (snapshot) snapshot[key] = value; }
        }
    }
    if (snapshot) result.SNAPSHOT = snapshot;
    return result;
}

function beginRowEvaluationMemoryPublication(target, input, scope) {
    if (!target || scope !== getSupabaseReadIdentityScope()) return () => {};
    const uid = String(target.UNIQUE_ID || target.unique_id || '');
    if (!uid) return () => {};
    const patch = input || {}, state = getManagerAssignedColumnState();
    const token = {}, owners = state.rowEvaluationMemoryOwners ||= new Map();
    owners.set(uid,token);
    const evidence = {};
    const set = (keys,value) => { if (value != null && String(value).trim() !== '' && String(value).trim() !== '-') for (const key of keys) evidence[key] = evidence[key.toLowerCase()] = value; };
    set(['SPEC'],patch.spec ?? patch.req_spec ?? patch.dock_spec);
    set(['CALIPER'],patch.caliper ?? patch.req_caliper ?? patch.dock_caliper);
    if (patch.explicit_av_note === true && Object.hasOwn(patch,'av_note')) evidence.AV_NOTE=evidence.av_note=String(patch.av_note ?? '');
    else set(['AV_NOTE'],patch.av_note);
    set(['PIC_NOTE','PICK_NOTE','PICK'],patch.pic_note ?? patch.pick_note ?? patch.req_pic_note);
    set(['SALES_NOTE','COMMENTS'],patch.sales_note ?? patch.comments ?? patch.req_comments);
    const match = patch.match ?? patch.req_match ?? patch.loc_match_pct;
    set(['MATCH','MATCH_PCT','LOC_MATCH_PCT'],match);
    set(['LOC_MATCH_QTY','LOC_PHOTO_MATCH'],getEditorLocMatchQtyValue(target,match) ?? patch.loc_match_qty);
    const photos = patch.force_clear_photos === true ? String(patch.photo_link ?? patch.req_photo_link ?? patch.dock_photo_link ?? '') : mergePhotoCsvList([target.PHOTO_LINK,target.photo_link,target.SAVED_PHOTO_LINK,patch.photo_link,patch.req_photo_link,patch.dock_photo_link]);
    if (photos || patch.force_clear_photos === true) {
        for (const key of ['PHOTO_LINK','SAVED_PHOTO_LINK']) evidence[key] = evidence[key.toLowerCase()] = photos;
        evidence.PHOTO_URL = evidence.photo_url = getPhotoUrlList(photos)[0] || '';
        evidence.photos = evidence.PHOTOS = getPhotoUrlList(photos);
    }
    set(['PHOTO_NAME','SAVED_PHOTO_NAME'],patch.photo_name ?? patch.req_photo_name ?? patch.dock_photo_name);
    set(['PHOTO_DATE'],patch.photo_date);
    const snapshots = [];
    const candidates = new Set([target,masterInventoryById.get(uid),...(fullInventory || []),...(state.fullInventory || []),...(typeof avOpenInventory === 'undefined' ? [] : avOpenInventory)]);
    const apply = row => {
        snapshots.push({row,fields:Object.keys(evidence).map(key=>[key,Object.hasOwn(row,key),row[key]])});
        Object.assign(row,evidence);
    };
    for (const row of candidates) if (row && String(row.UNIQUE_ID || row.unique_id || '') === uid && isSameDriveEvidenceLocation(row,target,true)) apply(row);
    if (state.noteScope !== scope) state.locationSalesNotes = new Map();
    state.noteScope = scope;
    const notes = state.locationSalesNotes ||= new Map(), code = getRequestItemCodeOptionItemCode(target);
    const prior = notes.get(code) || [], note = prior.find(row=>String(row.unique_id || row.UNIQUE_ID || '') === uid);
    const inserted = note ? null : {...target,unique_id:uid};
    if (note) apply(note); else notes.set(code,prior.concat(Object.assign(inserted,evidence)));
    state.fullInventory = fullInventory;
    const refresh = () => { invalidateResolvedViewStateCaches(); state.photoGeneration = (state.photoGeneration || 0) + 1; markViewDirty('drive'); markViewDirty('av'); };
    refresh();
    return () => {
        if (scope !== getSupabaseReadIdentityScope() || owners.get(uid) !== token) return;
        owners.delete(uid);
        for (const {row,fields} of snapshots) for (const [key,existed,value] of fields) if (row[key] === evidence[key]) { if (existed) row[key]=value; else delete row[key]; }
        if (inserted && notes.get(code)?.includes(inserted)) notes.set(code,notes.get(code).filter(row=>row!==inserted));
        refresh();
    };
}

        async function publishRowEvaluationToMasterAndNotes(item, patch, options = null) {
    if (typeof item === 'string') {
        item = masterInventoryById.get(item) || await loadExactMasterDetailRow(item);
        options ||= {prefix:'lsn-',complete:true};
    }
    if (!item) throw new Error('Exact inventory row is required.');
    if (options?.seasonSalesOffice === true) {
        const scope = options.scope || getSupabaseReadIdentityScope(), authEpoch = nativeAuthRecoveryEpoch;
        const uid = String(item.UNIQUE_ID || item.unique_id || '').trim();
        const expectedRevision = options.expectedRevision;
        if (!uid || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || typeof options.persist !== 'function') throw new Error('SEASON_AV_NOTE_COMMAND_INVALID');
        if (scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
        const result = await options.persist();
        if (scope !== getSupabaseReadIdentityScope() || authEpoch !== nativeAuthRecoveryEpoch) throw staleSupabaseReadScopeError();
        if (result?.ok !== true || result.status !== 'saved' || result.error || String(result.masterId || '') !== uid
            || typeof result.avNote !== 'string' || result.avNote !== String(patch?.av_note ?? '').trim()
            || !Number.isSafeInteger(result.revision) || result.revision !== expectedRevision + 1) throw new Error('SEASON_AV_NOTE_RECEIPT_UNCONFIRMED');
        return result;
    }
    if (options?.requestWork) {
        const scope = options.scope || getSupabaseReadIdentityScope();
        const target = findLinkedMasterRow(item);
        const evidence = target ? buildRequestMasterUpdatePayloadFromSave(item,patch,target) : null;
        if (evidence && patch?.explicit_av_note === true) { evidence.explicit_av_note=true;evidence.av_note=String(patch.av_note ?? ''); }
        const rollback = options.memoryRollback || beginRowEvaluationMemoryPublication(target,evidence,scope);
        let outcome, completedReceipt = false, photoReceipt = false;
        try {
            outcome = await options.persist();
            if (scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
            if (outcome.status !== 'saved') { rollback(); return outcome; }
            const result = outcome.result, saved = result?.row;
            if (result?.ok === false || result?.error || options.complete && result?.active === true || !saved || String(saved.unique_id || saved.UNIQUE_ID || '') !== String(item.UNIQUE_ID || item.unique_id || '')) throw new Error('REQUEST_SAVE_UNCONFIRMED');
            if (options.complete && (result.lifecycle_state !== 'completed_history' || !hasRequestCompletionState(saved))) throw new Error('REQUEST_COMPLETION_RECEIPT_UNCONFIRMED');
            if (options.complete) {
                completedReceipt = true;
                options.onConfirmed?.(result);
            }
            if (options.photoAttachmentUrl) {
                if (result.lifecycle_state !== 'pending_active' || result.active === false
                    || !parsePhotoCsvValues(saved.req_photo_link).includes(options.photoAttachmentUrl)) throw new Error('REQUEST_PHOTO_RECEIPT_UNCONFIRMED');
                photoReceipt = true;
                options.onConfirmed?.(result);
            }
            const expected = String(saved.master_id || item.MASTER_ID || item.master_id || target?.UNIQUE_ID || target?.unique_id || '');
            if (result.master_row) {
                if (!expected || String(result.master_row.unique_id) !== expected) throw new Error('REQUEST_MASTER_RECEIPT_MISMATCH');
                if (photoReceipt && !parsePhotoCsvValues(result.master_row.photo_link).includes(options.photoAttachmentUrl)) throw new Error('REQUEST_MASTER_PHOTO_RECEIPT_UNCONFIRMED');
                if (!completedReceipt && !photoReceipt) options.onConfirmed?.(result);
                const master = target || formatFetchedRows([result.master_row],'ph_master_inventory')[0];
                reconcileConfirmedDriveEvidence({ok:true,row:result.master_row,canonicalConfirmed:true},master,'req-',{scope,preserveDetailDraft:true});
            } else if (target || expected) throw new Error('REQUEST_MASTER_RECEIPT_UNCONFIRMED');
            else if (!completedReceipt && !photoReceipt) options.onConfirmed?.(result);
            return outcome;
        } catch (error) {
            if (completedReceipt || photoReceipt) {
                // The exact Request completion/photo is durable; only its local inventory projection is deferred.
                if (error?.message !== 'REQUEST_MASTER_RECEIPT_UNCONFIRMED') globalThis.reportHandledRuntimeIssue?.('request_work',photoReceipt ? 'REQUEST_PHOTO_PROJECTION_DEFERRED' : 'REQUEST_COMPLETION_PROJECTION_DEFERRED');
                queueVisibleDatasetCatchup(0);
                return outcome;
            }
            rollback(); throw error;
        }
    }
    if (!options || options.suspendCompletionScope) {
        const completionScope = options?.suspendCompletionScope || getSupabaseReadIdentityScope();
        const source = findDockSuspendDcRequestSourceRow(item) || item;
        const identity = getSuspendTagInventoryIdentity(item, source);
        const target = findLinkedMasterRow(item) || getQueueCardInventoryRow(item,'request')
            || await resolveSuspendTagInventoryRow(item,source,identity);
        if (!target) throw new Error('Exact inventory row is required.');
        let inventoryIdentity = identity;
        if (!matchesSuspendTagInventoryIdentity(target,identity)) {
            const display = getQueueDisplayEvidenceRow(item);
            if (!display || String(display.UNIQUE_ID || display.unique_id) !== String(target.UNIQUE_ID || target.unique_id)) throw new Error('Exact inventory row is required.');
            inventoryIdentity = {...window.AgMetricQueueInventory.identity(target),masterUid:String(target.UNIQUE_ID || target.unique_id)};
        }
        const rollback = options?.memoryRollback || beginRowEvaluationMemoryPublication(target,patch,completionScope);
        try {
            const result = await runSuspendTagRowCommand('save',item,patch,options?.photoProof ? getDockSuspendCompletionRevision(options.photoProof.row) : getDockSuspendCompletionRevision(item),{
                completionScope:options?.preserveNavigation === true ? null : completionScope, requireInventoryReceipt:true,inventoryIdentity,inventoryMasterUid:String(target.UNIQUE_ID || target.unique_id),onConfirmed:options?.onConfirmed,
                ...(options?.photoProof ? {photoProof:options.photoProof,serialized:options.serialized === true} : {})
            });
            if (!result) rollback();
            return result;
        } catch (error) { rollback(); throw error; }
    }
    const scope = options.scope || getSupabaseReadIdentityScope();
    const target = options.photoOnly === true ? item : findLinkedMasterRow(item) || item;
    const uid = String(target.UNIQUE_ID || target.unique_id || '').trim();
    if (!uid || !['','ph_master_inventory'].includes(String(target.SOURCE_TABLE || target.source_table || ''))) throw new Error('Exact inventory row is required.');
    if (options.receipt?.row && String(options.receipt.row.UNIQUE_ID || options.receipt.row.unique_id || '') !== uid) throw new Error('EVALUATION_RECEIPT_IDENTITY_MISMATCH');
    const rollback = !options.receipt && options.photoOnly !== true ? options.memoryRollback || beginRowEvaluationMemoryPublication(target,patch,scope) : () => {};
    try {
        const result = options.receipt || await saveSecureDriveEvidence(target, options.prefix, patch, options.complete, options.baseline);
        if (result?.canonicalConfirmed === true && String(result.row?.UNIQUE_ID || result.row?.unique_id || '') === uid) options.onConfirmed?.();
        if (options.isCurrent && !options.isCurrent()) return {result,applied:null};
        if (options.photoOnly === true) {
            const canonical = getCommittedDriveEvidenceReceipt(result,target).row;
            if (!isSameDriveEvidenceLocation(canonical,options.photoIdentity || target,true)) throw new Error('The saved photo location could not be verified. Reopen the item.');
        }
        try {
            const applied = reconcileConfirmedDriveEvidence(result,target,options.prefix,{scope,photoOnly:options.photoOnly === true,preserveDetailDraft:options.preserveDetailDraft === true});
            return {result,applied};
        } catch (error) {
            if (options.photoOnly !== true) throw error;
            globalThis.reportHandledRuntimeIssue?.('persistDrivePhotoAttachment','COMMITTED_PHOTO_REFRESH_DEFERRED');
            queueVisibleDatasetCatchup(0);
            return {result,applied:null,projectionDeferred:true};
        }
    } catch (error) { rollback(); throw error; }
}

        async function publishFlyerInventoryEvidence(item, payload = {}) {
            const master = getMasterPhotoSyncItem(item) || findLinkedMasterRow(item);
            if (!master || String(master.SOURCE_TABLE || 'ph_master_inventory') !== 'ph_master_inventory') throw new Error('Exact Flyer inventory row is required.');
            const value = (flyer, normal) => firstNonEmptyValue(item[flyer],item[normal],'');
            const evidence = {spec:value('FLYER_SPEC','SPEC'),caliper:value('FLYER_CALIPER','CALIPER'),av_note:value('FLYER_AV_NOTE','AV_NOTE'),match:value('FLYER_MATCH','MATCH'),pick_note:value('FLYER_PICK','PICK'),comments:firstNonEmptyValue(payload.sales_note,item.SALES_NOTE,''),photo_link:value('FLYER_PHOTO_LINK','PHOTO_LINK'),photo_name:value('FLYER_PHOTO_NAME','PHOTO_NAME')};
            if (payload.explicit_av_note === true) { evidence.explicit_av_note=true;evidence.av_note=String(payload.av_note ?? ''); }
            if (payload.force_clear_photos === true) Object.assign(evidence,{force_clear_photos:true,photo_link:String(payload.flyer_photo_link ?? payload.photo_link ?? ''),photo_name:String(payload.flyer_photo_name ?? payload.photo_name ?? '')});
            else evidence.photo_link = collectAllActiveItemDetailPhotos(item,'flyer-').join(',');
            const scope=getSupabaseReadIdentityScope();
            const {result}=await publishRowEvaluationToMasterAndNotes(master,evidence,{prefix:'lsn-',scope,complete:!!payload.date_completed,baseline:buildSecureDriveEvidenceBaseline(master),preserveDetailDraft:true});
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
            return mergeRequestModalRepOptions(options).filter(option=>matrixAccess.canRequestSalesRep(resolveUserAccessMatrix(),option.username||option.label));
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

function syncAvKioskMode(manualValue) {
    let state = window.__agdataAvKioskState;
    if (!state) {
        const queries = typeof window.matchMedia === 'function'
            ? ['(display-mode: standalone)','(display-mode: fullscreen)'].map(query => window.matchMedia(query)) : [];
        state = window.__agdataAvKioskState = { queries, manual: null };
        const onDisplayModeChange = () => { state.manual = null; syncAvKioskMode(); if (getCurrentVisibleViewId() === 'av') renderAV(); };
        queries.forEach(query => {
            if (query.addEventListener) query.addEventListener('change', onDisplayModeChange);
            else query.addListener?.(onDisplayModeChange);
        });
    }
    if (typeof manualValue === 'boolean') state.manual = manualValue;
    const detected = state.queries.some(query => query.matches) || window.navigator?.standalone === true;
    const active = state.manual === null ? detected : state.manual;
    state.active = active;
    const view = document.getElementById('view-av');
    if (view) {
        const changed = view.classList.contains('kiosk-mode-active') !== active;
        view.classList.toggle('kiosk-mode-active', active);
        view.classList.toggle('av-kiosk-mode', active);
        document.getElementById('av-kiosk-toggle')?.setAttribute('aria-pressed', String(active));
        if (changed) {
            const cards = document.getElementById('av-content');
            if (cards?.__gncCardWindow) cards.__gncCardWindow.signature = '';
            if (cards) { delete cards.__avPendingChunk; clearContainerRenderSignature(cards); }
            window.GncCardWindow?.refreshAll();
        }
    }
    return active;
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
        syncAvKioskMode(!view.classList.contains('kiosk-mode-active'));
        if (getCurrentVisibleViewId() === 'av') renderAV();
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
function liveInventoryCardValue(row, ...keys) {
    for (const key of keys) for (const alias of [key, key.toLowerCase()]) {
        const value = row?.[alias];
        if (value != null && String(value).trim() !== '') return value;
    }
    return '';
}

function mergeLiveInventoryCardRows(rows = []) {
    const groups = new Map();
    let mergedAny = false;
    for (const row of rows) {
        if (!row) continue;
        const tuple = ['ITEMCODE','LOCATIONCODE','LOTCODE'].map(key => String(liveInventoryCardValue(row,key)).trim().toUpperCase());
        const key = tuple.every(Boolean) ? JSON.stringify(tuple) : row;
        const prior = groups.get(key);
        if (!prior) { groups.set(key,row); continue; }
        mergedAny = true;
        const merged = {...prior};
        merged.__physicalInventoryRows = [...(prior.__physicalInventoryRows || [prior]), ...(row.__physicalInventoryRows || [row])];
        for (const [field,value] of Object.entries(row)) {
            if (value != null && String(value).trim() !== '' && (merged[field] == null || String(merged[field]).trim() === '')) merged[field] = value;
        }
        for (const keys of [['SPEC'],['AV_NOTE','AVNOTE'],['LOC_PHOTO_MATCH','LOC_MATCH_QTY'],['PHOTO_DATE'],['PIC_NOTE','PICK_NOTE'],['SALES_NOTE','COMMENTS']]) {
            const value = liveInventoryCardValue(prior,...keys) || liveInventoryCardValue(row,...keys);
            if (value !== '') for (const key of keys) { merged[key]=value; merged[key.toLowerCase()]=value; }
        }
        const photos = [...new Set([prior,row].flatMap(value => getPhotoUrlList(liveInventoryCardValue(value,'PHOTO_LINK','PHOTO_URL','PHOTOS'))))];
        if (photos.length) merged.PHOTO_LINK = merged.photo_link = merged.PHOTOS = merged.photos = photos.join(',');
        groups.set(key,merged);
    }
    return mergedAny ? [...groups.values()] : rows;
}

// Display projection only. Mutation resolvers keep the physical UID/full identity.
function resolveLiveInventoryForCard(row) {
    if (!row) return null;
    const text = value => String(value || '').trim().toUpperCase();
    const location = value => window.AgMetricQueueInventory?.normalizeLocation(value) || text(value);
    const lot = value => text(value).replace(/^(?:\d{2}|\d{4})[.\s-]*/, '');
    const code = text(liveInventoryCardValue(row,'ITEMCODE'));
    const loc = location(liveInventoryCardValue(row,'LOCATIONCODE'));
    if (!code || !loc || isFalseBlockLocation(loc)) return null;
    const canonical = resolveCanonicalInventoryRow(row);
    const canonicalUid = String(canonical?.UNIQUE_ID || canonical?.unique_id || '');
    const exactMaster = masterInventoryById.get(canonicalUid);
    if (exactMaster && text(liveInventoryCardValue(exactMaster,'ITEMCODE')) === code
        && location(liveInventoryCardValue(exactMaster,'LOCATIONCODE')) === loc) {
        return {...canonical, __liveInventoryCardDisplay:true};
    }
    const indexed = masterInventoryByItemCode.get(code);
    let rows = mergeLiveInventoryCardRows((indexed?.length ? indexed : fullInventory || []).filter(item => text(liveInventoryCardValue(item,'ITEMCODE')) === code));
    const scoped = suspendTagItemHydration.get(code);
    if (!rows.length && scoped?.owner === getSupabaseReadIdentityScope()) rows = mergeLiveInventoryCardRows(scoped.rows || []);
    const atLocation = rows.filter(item => text(liveInventoryCardValue(item,'ITEMCODE')) === code && location(liveInventoryCardValue(item,'LOCATIONCODE')) === loc);
    if (!atLocation.length) return null;
    const number = (item,...keys) => Math.max(0,Number(String(liveInventoryCardValue(item,...keys)).replace(/[, %]/g,'')) || 0);
    const onHand = item => number(item,'PTRONHAND','ON_HAND','ONHAND');
    const available = item => number(item,'PTRAVAILABLE','AVAILABLE','AVAILABLE_QTY');
    const review = item => number(item,'PTRREVIEWED','PTRREVIEW','REVIEW','REVIEW_QTY');
    const wantedLot = lot(liveInventoryCardValue(row,'LOTCODE','LOT'));
    const exact = atLocation.filter(item => lot(liveInventoryCardValue(item,'LOTCODE','LOT')) === wantedLot);
    const active = atLocation.filter(item => onHand(item)>0 || available(item)>0 || review(item)>0);
    const selected = exact.length && (exact.some(item=>onHand(item)>0) || !active.some(item=>onHand(item)>0)) ? exact : active.length ? active : atLocation;
    const primary = [...selected].sort((a,b) => Number(/^(F1|S1)$/.test(lot(liveInventoryCardValue(b,'LOTCODE'))))-Number(/^(F1|S1)$/.test(lot(liveInventoryCardValue(a,'LOTCODE')))) || onHand(b)-onHand(a) || text(a.UNIQUE_ID || a.unique_id).localeCompare(text(b.UNIQUE_ID || b.unique_id)))[0];
    const result = {...resolveCanonicalInventoryRow(primary), __liveInventoryCardDisplay:true};
    const state = getManagerAssignedColumnState();
    const uid = String(primary.UNIQUE_ID || primary.unique_id || '');
    const notes = state.noteScope === getSupabaseReadIdentityScope() ? state.locationSalesNotes?.get(code) || [] : [];
    const note = notes.find(item => {
        const noteUid = String(item.MASTER_UNIQUE_ID || item.master_unique_id || item.MASTER_ID || item.master_id || item.UNIQUE_ID || item.unique_id || '');
        return location(liveInventoryCardValue(item,'LOCATIONCODE')) === loc && (noteUid ? noteUid === uid : !liveInventoryCardValue(item,'LOTCODE','LOT') || lot(liveInventoryCardValue(item,'LOTCODE','LOT')) === lot(liveInventoryCardValue(primary,'LOTCODE','LOT')));
    });
    const fields = [['SPEC'],['CALIPER'],['AV_NOTE','AVNOTE'],['PIC_NOTE','PICK_NOTE','PICKNOTE'],['SALES_NOTE','COMMENTS'],['PHOTO_LINK','PHOTO_URL','PHOTOS'],['PHOTO_NAME'],['PHOTO_DATE'],['DATE_COMPLETED'],['AV_RULE_PHOTO_UPDATED_AT'],['MATCH_PCT','LOC_MATCH_PCT','MATCH'],['LOC_PHOTO_MATCH','LOC_MATCH_QTY'],['HOLDSTOPCODE','HOLD_STOP_CODE'],['HOLDSTOPREASON','HOLDREASON','HOLD_STOP_REASON'],['HOLDSTOPBEGINDATE']];
    for (const keys of fields) {
        const hold = keys[0].startsWith('HOLD');
        const noteValue = hold ? '' : liveInventoryCardValue(note,...keys);
        const value = noteValue !== '' ? noteValue : liveInventoryCardValue(primary,...keys);
        for (const key of keys) result[key] = result[key.toLowerCase()] = value;
    }
    const set = (value,...keys) => { for (const key of keys) result[key] = result[key.toLowerCase()] = value; };
    set(selected.reduce((sum,item)=>sum+onHand(item),0),'PTRONHAND','ON_HAND');
    set(selected.reduce((sum,item)=>sum+review(item),0),'PTRREVIEWED','REVIEW');
    set(selected.reduce((sum,item)=>sum+available(item),0),'PTRAVAILABLE','AVAILABLE');
    set(atLocation.reduce((sum,item)=>sum+onHand(item),0),'LOC_ON_HAND');
    set(rows.filter(item=>/^(F1|S1)$/.test(lot(liveInventoryCardValue(item,'LOTCODE','LOT')))).reduce((sum,item)=>sum+available(item),0),'S_LTS','OPEN_STOCK');
    const evidence = {...primary,...(note || {})};
    const pct = number(evidence,'MATCH_PCT','LOC_MATCH_PCT','MATCH');
    const stored = number(evidence,'LOC_PHOTO_MATCH','LOC_MATCH_QTY');
    const depleted = liveInventoryCardValue(evidence,'EVAL_BASELINE_AVAILABLE','INITIAL_LOC_PHOTO_MATCH','INITIAL_PHOTO_MATCH_QTY') !== '';
    set(depleted ? calculateLiveLocPhotoMatch(primary,note) : stored>0 ? stored : Math.round(Math.min(100,pct)*onHand(primary)/100),'LOC_PHOTO_MATCH','LOC_MATCH_QTY');
    return result;
}

function getQueueDisplayEvidenceRow(item) {
    const table = String(item?.SOURCE_TABLE || item?.source_table || '').toLowerCase();
    if (!item || table === 'ph_master_inventory' || !(isRequestOwnedPhotoRow(item) || isDockSuspendDcRequestMirrorRow(item)
        || ['ph_soc_master','ph_docks','ph_requests_pending','ph_requests_completed_history'].includes(table))) return null;
    return resolveLiveInventoryForCard(item);
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
    const owner = getSupabaseReadIdentityScope();
    const meta = rows?.requestReadMeta;
    const current = (Array.isArray(requestsInventory) ? requestsInventory : []).filter(item => item && !item.REQUEST_HISTORY && !hasConfirmedRequestCompletion(item));
    let receipt = reconcileIncomingRequestRows.receipt;
    if (!receipt || receipt.owner !== owner) receipt = reconcileIncomingRequestRows.receipt = {owner,sequence:0,authoritative:false};
    if (meta && (meta.owner !== owner || Number(meta.sequence) < receipt.sequence)) return current;
    if (!meta?.authoritative && receipt.authoritative) return current;
    const incomingRows = Array.isArray(rows) ? rows.filter(item => item && !hasConfirmedRequestCompletion(item)) : [];
    if (meta?.authoritative) { receipt.sequence = Number(meta.sequence); receipt.authoritative = true; }
    const nextRows = incomingRows.slice(), seenIds = new Set(nextRows.map(item => String(firstNonEmptyValue(item.UNIQUE_ID,item.unique_id,''))));
    current.forEach(item => {
        const id = String(item.UNIQUE_ID || item.unique_id || '').trim();
        if (!id || seenIds.has(id) || optimisticCompletedRowIds.has(id) || !isRequestPendingVisible(item)) return;
        // Only durable local submissions survive a complete authoritative deletion.
        if (!optimisticRequestIds.has(id) && (incomingRows.length || meta?.authoritative)) return;
        nextRows.push(item); seenIds.add(id);
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
    const completed = isProtectedSectionCompleted(prefix, item), locked = isProtectedSectionLocked(prefix,item) && !isProtectedUnlocked(prefix);
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
        else if (control.hasAttribute('data-completion-disabled')) { control.disabled = !canEditRowDetails(prefix,item); delete control.dataset.completionDisabled; }
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
    showToast('Saving', 'Task completion is saving in the background.');
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
    if (isDockSuspendDcRequestMirrorRow(row) || isDockSuspendDcRequestSource(row)) return resolveSuspendOwner(row);
    const code = buildManagerEvalAssignmentKey(row?.ITEMCODE || row?.itemcode || row?.ITEM || row?.item);
    const mapped=index.exact.get(code) || index.family.get(code.slice(0,6));
    if(mapped) return mapped;
    return '';
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
    const actor = normalizeEvalAssignableUser(user).replace(/^nally_aguilar$/, 'nelly_aguilar');
    const named = GLOBAL_LIVE_CHANGE_USER_KEYS.has(actor) || ['admin','manager'].includes(actor);
    const matrix = actor && !named ? resolveUserAccessMatrix(actor) : null;
    const role = String(matrix?.role || (actor === normalizeEvalAssignableUser(currentUser) ? currentRole : '') || '').trim().toUpperCase().replace(/[ _-]/g, '');
    const power = named
        || ['SUPERADMIN','ADMIN','ADMINISTRATOR','MANAGER'].includes(role) || matrix?.edit_any_row === 'Y';
    const scoped = ['EVAL','EVALUATOR'].includes(role) || matrix?.edit_assigned_rows_only === 'Y';
    const canEdit = !!(actor && row && (power || scoped && resolveInventoryRowOwner(row) === actor || role === 'MANAGER' && !matrix?.verified));
    return { canView: !!(actor && row), canEditAnyRow: !!(actor && power), canEdit, canUnlock: canEdit, canReclass: canEdit,
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
    const initial = request ? matrix?.request_default_scope : (user === 'jd_jones' ? 'ALL' : 'OWN');
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

function getDockOrderBusinessKey(row = {}) {
    const value = (...keys) => firstNonEmptyValue(...keys.map(key => row[key]), '');
    const code = String(value('ITEMCODE','itemcode')).trim().toUpperCase().replace(/[.]+$/, '');
    const dock = normalizeDockViewDockKey(value('DOCK','dock','DOCK_NUM','dock_num'));
    const drop = normalizeDockViewStopKey(value('STOPNUMBER','stopnumber','STOP','stop','DROP_NUMBER','drop_number','DROP','drop'));
    const location = String(value('LOCATIONCODE','locationcode','LOCATION','location')).trim().toUpperCase();
    if (!code || dock === 'Unassigned' || drop === 'Unassigned') return '';
    const quantity = Number(String(value('QUANTITYORDERED','quantityordered','QTY','qty','ORDERED_QTY','ordered_qty') || 0).replace(/,/g,''));
    return JSON.stringify([dock,drop,code,location,String(value('CONSIGNEENAME','consigneename','CONSIGNEE','consignee')).trim(),Number.isFinite(quantity)?quantity:0]);
}

function uniquePhysicalSuspendTags(rows) {
    const seen = new Set(), orders = new Set();
    return rows.filter(row => {
        const status = String(row.STATUS || row.status || '').toLowerCase();
        if (row.suspend_completed === true || row.SUSPEND_COMPLETED === true || row.completed === true
            || status === 'deleted' || ['complete','completed'].includes(status) && !['SUSPEND','SUSPENDED'].includes(String(row.SUSPEND || row.suspend || '').toUpperCase())) return false;
        const key = getPhysicalSuspendTagKey(row), order = getDockOrderBusinessKey(row);
        if (!key || seen.has(key) || order && orders.has(order)) return false;
        seen.add(key); if (order) orders.add(order);
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
    const route = suspend ? getDockSuspendToValue(item) : '';
    if (route === 'dc') return 'dylan_collyge';
    if (route === 'ms' || route === 'mk') return 'megan_kelly';
    if (suspend && /^[a-z0-9]+_[a-z0-9_]+$/.test(route)) return normalizeEvalAssignableUser(route);
    const {exact, family} = getCardEvalOwnerIndex(getManagerAssignedColumnState(), suspend);
    const owner = exact.get(code) || family.get(code.split('.')[0]);
    if (owner) return owner;
    if (suspend) return normalizeEvalAssignableUser(item?.suspend_eval_owner || item?.SUSPEND_EVAL_OWNER || item?.eval_user || item?.EVAL_USER) || 'Unassigned';
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
    const counts = tab === 'pending' ? new Map(Array.from(new Set(exact.values()), owner => [owner, 0])) : new Map();
    for (const item of items) {
        const owner = getAssignedQueueOwner(item) || 'Unassigned';
        if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
    }
    const selected = getSuspendEvalUserFilter(tab);
    const option = (value, label, count) => '<option value="'+escapeHtml(value)+'"'+(value === selected ? ' selected' : '')+'>'+escapeHtml(label)+' ('+count+')</option>';
    const options = [...counts.keys()].filter(user => user !== 'Unassigned').sort().map(user => option(user,user,counts.get(user)));
    if (counts.has('Unassigned')) options.push(option('Unassigned','Unassigned',counts.get('Unassigned')));
    return '<label class="workflow-control"><span>Assigned User / Eval User</span><select id="'+id+'" onchange="return setSuspendEvalUserFilter(this.value)">'+option('ALL',id === 'request-eval-user-filter' ? 'All Requests' : 'All Users',items.length)+options.join('')+'</select></label>';
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
            if (!item || resolveCanonicalRowAccess(currentUser,item).canEditAnyRow) return false;
            if (prefix !== 'dock-' && !getPhotoUrlList(getVisiblePhotoLinkCsvForPrefix(prefix,item)).length) return false;
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
            if (!getArgosReclassRowEditorEntry(uid)) return false;
            return focusArgosReclassRow(uid);
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

function persistCameraDetailSession(input = null) {
    if (!activeItem || !currentUser) return;
    const state = window.GncCameraState;
    if (state) {
        state.captureId = (Number(state.captureId) || 0) + 1;
        if (input?.type === 'file') input.__gncCameraCaptureId = state.captureId;
        state.cameraCaptureInFlight = true; state.returnUntil = Date.now() + 15_000;
    }
    persistAppFilterStateNow();
    try {
        sessionStorage.setItem('agdata_camera_detail_v1',JSON.stringify({owner:getSupabaseReadIdentityScope(),captureId:state?.captureId || 0,createdAt:Date.now(),row:{...activeItem},rowUid:getCompletedRowUnlockKey(activeItem),source:activeDetailSourceView || lastView || 'drive',tab:activeDetailTab,scrollY:getMainAreaScrollTop(),filterKey:getAppFilterStateStorageKey(),filters:JSON.stringify(readAppFilterStateSnapshot())}));
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
        entries.push({ ...slot, url: slot.publicUrl || slot.url, previewUrl: slot.localPreviewUrl || slot.url,
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
    const normalizedUrl = typeof normalizeStoragePublicUrl === 'function' ? normalizeStoragePublicUrl(publicUrl) : publicUrl;
    const slots = getPendingPhotoPreviewEntries(item,prefix).filter(entry => entry.id === id);
    for (const slot of slots) Object.assign(slot,{localPreviewUrl:slot.localPreviewUrl || slot.url,publicUrl:normalizedUrl,name:fileName,status:'Uploaded'});
    if (!slots.length || typeof Image === 'undefined') return;
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.onload = () => {
        if (scope !== getSupabaseReadIdentityScope() || !getPendingPhotoPreviewEntries(item,prefix).some(entry => entry.id === id)) return;
        for (const slot of slots) slot.publicPreviewReady = probe.naturalWidth > 0;
        // Clear upload state while retaining the local session image, even if storage later fails.
        clearPendingPhotoPreview(item,prefix,id,false);
        refreshPendingPhotoUiForItem(item,prefix);
    };
    probe.onerror = () => {
        if (scope !== getSupabaseReadIdentityScope()) return;
        for (const slot of slots) { slot.publicPreviewReady=false; slot.url=slot.localPreviewUrl; }
        refreshPendingPhotoUiForItem(item,prefix);
    };
    probe.src = normalizedUrl;
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
        const patch = {req_photo_link:upload.publicUrl,req_photo_name:upload.fileName};
        const publication = await publishRowEvaluationToMasterAndNotes(item,patch,{requestWork:true,scope:job.scope,complete:false,
            photoAttachmentUrl:upload.publicUrl,memoryRollback:()=>{},persist:async () => {
                const response = await postAppFunctionJson(APP_API_FUNCTION_URL, {action:'request_work',operation:'append_photo',requestId:uid,patch},
                    {timeoutMs:25000,signal:job.uploadController.signal,label:'Request photo save'});
                const saved = response?.data?.row;
                if (!response?.ok || saved?.unique_id !== uid
                    || !parsePhotoCsvValues(saved.req_photo_link).includes(upload.publicUrl)) throw new Error('Request photo save was not confirmed.');
                return {status:'saved',result:response.data};
            }});
        const saved = publication.result.row;
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
    const evidencePatch = isComplete ? buildSecureDriveEvidencePayload(payload) : buildSecureDriveEvidencePatch(payload, baseline);
    if (payload.force_clear_photos === true) Object.assign(evidencePatch,{force_clear_photos:true,photo_link:String(payload.photo_link || ''),photo_name:String(payload.photo_name || '')});
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
                        p_expected_signature: '',
                        p_baseline: {},
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
                    const retryable = [408, 409, 422, 429, 500, 502, 503, 504].includes(status)
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
                        html += `<div class="saved-photo-tile relative shrink-0">${deleteButtonHtml}<button type="button" class="p-0 border-0 bg-transparent" onclick="handlePhotoThumbClick('${openLink}', '${title}', ${photoIndex})"${pressAttrs}>${buildDeferredCardPhotoImg(thumb, { hydrateNow:true, loading:'eager', className: 'w-20 h-20 object-cover rounded-lg border border-gray-300 cursor-pointer shadow-sm active:scale-95' }).replace('<img ', '<img data-photo-url="' + escapeHtml(cleanUrl) + '" data-local-preview-url="' + escapeHtml(entry.localPreviewUrl || entry.previewUrl || '') + '" ')}</button><div class="photo-count text-center text-[9px]">${photoIndex + 1}/${entries.length}</div>${statusHtml}${dateHtml}${reorderHtml}</div>`;
                    });
                    html += `</div>`;
                    const mediaSignature = getCompletedRowUnlockKey(activeItem) + ':' + JSON.stringify(entries.map(entry => [entry.url,entry.previewUrl,entry.status,entry.dateLabel,entry.persistedIndex])) + ':' + canRemoveProtectedPhoto(prefix) + ':' + allowReorder;
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
    row = resolveCanonicalInventoryRow(row) || row;
    return [...new Set([row.PHOTOS,row.photos,row.PHOTO_LINK,row.photo_link,row.PHOTO_URL,row.photo_url,row.SAVED_PHOTO_LINK]
        .flatMap(value => getPhotoUrlList(value || '')).filter(url => /^https?:\/\//i.test(url)))];
}
function isValidPhotoRow(row) {
    if (!row) return false;
    row = resolveCanonicalInventoryRow(row) || row;
    const onHand = Number(String(row.PTRONHAND ?? row.ptronhand ?? row.ON_HAND ?? row.on_hand ?? row.ONHAND ?? row.onhand ?? '').replace(/,/g,''));
    if (!(onHand > 0)) return false;
    const stored = row.LOC_PHOTO_MATCH ?? row.loc_photo_match ?? row.LOC_MATCH_QTY ?? row.loc_match_qty;
    const hasStoredMatch = stored != null && String(stored).trim() !== '';
    if (hasStoredMatch && !(Number(String(stored).replace(/,/g,'')) > 0)) return false;
    const pctValue = row.LOC_MATCH_PCT ?? row.loc_match_pct ?? row.MATCH_PCT ?? row.match_pct ?? row.MATCH ?? row.match;
    if (!hasStoredMatch && pctValue != null && String(pctValue).trim() !== '') {
        const pct = Number(String(pctValue).replace(/[% ,]/g,''));
        if (!(Math.round(Math.min(100,pct)*onHand/100) > 0)) return false;
    }
    return getAvRowPhotoUrls(row).some(url => {
        const stamp = getPhotoEntryDateMs(url,row);
        return Number.isFinite(stamp) && stamp <= Date.now() && !isPhotoDateMsExpired(stamp);
    });
}
function hasValidRowPhoto(row) {
    return isValidPhotoRow(row);
}
function getCanonicalValidPhotoRows() {
    // The authorized complete master is the same source as Drive. Never use
    // an AV stock projection or its bounded preparation preview here.
    const seen = new Set(), rows = [];
    for (const source of Array.isArray(fullInventory) ? fullInventory : []) {
        const row = resolveCanonicalInventoryRow(source) || source;
        if (!isValidPhotoRow(row)) continue;
        const key = [row.ITEMCODE ?? row.itemcode, row.LOCATIONCODE ?? row.locationcode, row.LOTCODE ?? row.lotcode]
            .map(value => String(value ?? '').trim().toUpperCase()).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
    }
    return rows;
}
function toggleAvValidPhotos() {
    return setAvPhotoMode(getAvPhotoMode() === 'valid_photos' ? 'all' : 'valid_photos');
}
function updateAvValidPhotoPill() {
    const button = document.getElementById('av-valid-photos-toggle');
    if (!button) return;
    const count = getCanonicalValidPhotoRows().length;
    button.textContent = '📷 Valid Photos (' + count + ')';
    button.setAttribute('aria-pressed',String(getAvPhotoMode() === 'valid_photos'));
}


async function withAgDataBootDeadline(task, fallback = null) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(task), new Promise(resolve => { timer = setTimeout(() => resolve(fallback),1200); })]); }
    catch (_) { return fallback; }
    finally { clearTimeout(timer); }
}
async function restoreCachedNativeBootProfile() {
    if (hasExplicitLogoutMarker() || !NATIVE_AUTH_ENABLED) return null;
    const epoch = nativeAuthRecoveryEpoch;
    const fast = readCachedNativeBootSession();
    const session = fast?.session || await withAgDataBootDeadline(() => getNativeAuthSession(),null);
    if (fast && epoch === nativeAuthRecoveryEpoch) {
        nativeAuthReadRequired = true;
        nativeAuthSessionActive = true;
        nativeAuthSessionUserId = session.user.id;
        nativeAuthAccessToken = session.access_token;
    }
    if (!session?.user?.id || epoch !== nativeAuthRecoveryEpoch || !nativeAuthSessionActive || nativeAuthSessionUserId !== session.user.id) return null;
    const cached = fast?.profile || readCachedNativeAuthProfile(session.user.id);
    if (!cached || cached.active === false || cached.disabled_at || cached.must_change_password || cached.locked_until && Date.parse(cached.locked_until) > Date.now()) return null;
    nativeAuthProfile = cached;
    setTimeout(() => { if (epoch === nativeAuthRecoveryEpoch && nativeAuthSessionUserId === session.user.id) void refreshNativeRoleAndCapabilities('boot-cached-profile'); },0);
    return cached;
}
function recoverAgDataPreboot() {
    if (currentUser && nativeAuthSessionActive && nativeAuthProfile?.id === nativeAuthSessionUserId && !hasExplicitLogoutMarker()) {
        openAppShellAfterLogin(true); return true;
    }
    if (typeof initializeAppSessionOnLoad === 'function') { void initializeAppSessionOnLoad(); }
    return false;
}

// Shared, account-scoped inventory filters. Candidate rows already passed each module's access and search gates.
function getInventoryExcelFields(scope = '') {
    const fields = [['username','Username / Eval User'],['plantgroupcode','Plant Group Code'],['commonname','Common Name'],['contsize','Container Size'],['blockalpha','Block'],['locationcode','Location'],['season','Season'],['lotcode','Lot']];
    if (scope === 'drive') fields.push(['salesyear','Year'],['holdstopcode','Hold/Stop']);
    if (['request','evalwork','locationwork','recount','queueshear'].includes(scope)) return [];
    if (scope === 'suspend') return fields.filter(([key]) => key === 'plantgroupcode');
    const nativeFields = {drive:['commonname','locationcode'],av:['contsize','season'],eval2:['username','locationcode','season','contsize']};
    return fields.filter(([key]) => !nativeFields[scope]?.includes(key));
}
function getInventoryExcelState(scope) {
    const owner = getSupabaseReadIdentityScope();
    const cache = getInventoryExcelState.cache;
    if (!cache || cache.owner !== owner) getInventoryExcelState.cache = {owner, scopes:new Map()};
    const states = getInventoryExcelState.cache.scopes;
    if (!states.has(scope)) states.set(scope,{scope,owner,rows:[],filters:{},facts:new WeakMap(),revision:0});
    return states.get(scope);
}
function inventoryExcelKey(value) { return String(value ?? '').trim().toLowerCase(); }
function getInventoryExcelFacts(row, state) {
    if (!row || typeof row !== 'object') return [];
    if (state.facts.has(row)) return state.facts.get(row);
    const input = row.sourceRow ? {...row.values,...row.sourceRow} : row.row && typeof row.row === 'object' ? {...row,...row.row} : row;
    const parts = Array.isArray(input.lines) && input.lines.length ? input.lines.map(line=>({...input,...line})) : [input];
    const facts = parts.map(item => {
        const field = (...keys) => { for (const key of keys) { const value=item[key] ?? item[key.toUpperCase()]; if(value != null && String(value).trim()) return value; } return ''; };
        const code = String(field('itemcode','item_code','item')).toUpperCase();
        const metadata = typeof masterInventoryByItemCode !== 'undefined' ? masterInventoryByItemCode.get(code)?.[0] : null;
        const fallback = (...keys) => field(...keys) || keys.map(key=>metadata?.[key] ?? metadata?.[key.toUpperCase()]).find(value=>value != null && String(value).trim()) || '';
        const location = field('locationcode','source_locationcode','location');
        const user = Array.isArray(item.assigned_usernames) ? item.assigned_usernames : typeof resolveSuspendOwner === 'function' ? resolveSuspendOwner(item) : field('assignedto','eval_user','username') || 'Unassigned';
        const values = {username:user,plantgroupcode:fallback('plantgroupcode','plt_grp','plant_group_code'),commonname:fallback('commonname','common_name'),contsize:state.scope==='drive'?field('contsize','container_size'):fallback('contsize','container_size'),blockalpha:field('blockalpha','block_alpha') || String(location).match(/^[A-Za-z]+/)?.[0] || '',locationcode:location,season:field('season'),lotcode:field('lotcode','lot'),holdstopcode:field('holdstopcode','hold_stop_code')};
        if (state.scope === 'drive') {
            const lot = String(values.lotcode || '').trim().match(/^(\d{2}|\d{4})\.([A-Za-z][A-Za-z0-9]*)$/);
            values.salesyear = field('salesyear','sales_year') || (lot ? String(lot[1].length === 2 ? 2000 + Number(lot[1]) : Number(lot[1])) : '');
            values.season = field('season') || (lot ? lot[2].toUpperCase() : '');
        }
        return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,[...new Set((Array.isArray(value)?value:[value]).map(v=>String(v??'').trim() || (key==='username'?'Unassigned':'(Blank)')))]]));
    });
    state.facts.set(row,facts); return facts;
}
function inventoryExcelFactMatches(fact, filters, ignore = '') {
    return Object.entries(filters).every(([key,values])=>key===ignore || values===null || fact[key]?.some(value=>values.has(inventoryExcelKey(value))));
}
function inventoryExcelRowMatches(row, state, ignore = '') {
    return getInventoryExcelFacts(row,state).some(fact=>inventoryExcelFactMatches(fact,state.filters,ignore));
}
function getInventoryExcelOptions(state, field) {
    const counts = new Map();
    const candidates=state.scope==='drive' ? getDriveExcelFacetRows(state.rows,field) : state.rows;
    for (const row of candidates) {
        const found = new Map();
        for (const fact of getInventoryExcelFacts(row,state)) if(inventoryExcelFactMatches(fact,state.filters,field)) for(const value of fact[field] || []) found.set(inventoryExcelKey(value),value);
        for(const [key,label] of found) { const entry=counts.get(key)||{key,label,count:0}; entry.count++;counts.set(key,entry); }
    }
    return [...counts.values()].filter(option=>option.count>0).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
}
function applyInventoryExcelFilters(scope, rows) {
    const state = getInventoryExcelState(scope);
    if(scope==='av' && ['valid_photos','photos'].includes(getAvPhotoMode())){delete state.filters.season;delete state.filters.lotcode;}
    const allowed = new Set(getInventoryExcelFields(scope).map(([key]) => key));
    for (const key of Object.keys(state.filters)) if (!allowed.has(key)) delete state.filters[key];
    state.rows = Array.isArray(rows) ? rows : []; state.facts = new WeakMap();
    if (typeof document !== 'undefined' && !state.paintPending) { state.paintPending=true; setTimeout(()=>{state.paintPending=false;mountInventoryExcelFilters(scope);},0); }
    return Object.keys(state.filters).length ? state.rows.filter(row=>inventoryExcelRowMatches(row,state)) : state.rows;
}
function getInventoryExcelHost(scope) {
    const hosts = {drive:'view-drive',av:'view-av',docks:'view-docks',suspend:'view-request',request:'view-request',evalwork:'view-request',locationwork:'view-request',recount:'view-request',shear:'view-shear-list',queueshear:'view-request',smart:'smart-moves-intelligence-panel',eval1:'view-managers',eval2:'view-managers',reclass:'argos-reclass-item-inquiry'};
    const host=document.getElementById(hosts[scope]);
    if (!host || host.closest('.hidden') || host.style.display==='none') return null;
    const view = typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '';
    if (['eval1','eval2'].includes(scope) && (view!=='managers' || activeHomeTab !== (scope==='eval2'?MANAGER_EVAL_REPORTS_2_VIEW:MANAGER_EVAL_REPORTS_VIEW))) return null;
    if (hosts[scope]==='view-request') {
        const tab=normalizeRequestTabValue(activeReqTab), tabs={suspend:['suspend-tag'],request:['pending','reps'],evalwork:['eval-work','shear-test'],locationwork:['location-work','moves'],recount:['recount'],queueshear:['shear-list']};
        if(!tabs[scope]?.includes(tab)) return null;
    }
    if (scope === 'drive') return host.querySelector('#drive-advanced-filters [data-inventory-excel-mount="drive"]');
    if (scope === 'av') return host.querySelector('#av-filter-options');
    if (scope === 'suspend') return host.querySelector('[data-inventory-excel-mount="suspend"]');
    if (hosts[scope] === 'view-request') return null;
    if (scope === 'eval2') return host.querySelector('.manager-eval2-native-filters .mobile-browse-filter-panel');
    return host;
}
function inventoryExcelBarHtml(scope) {
    const state=getInventoryExcelState(scope), escape=escapeHtml;
    const fields=getInventoryExcelFields(scope).filter(([key])=>!(scope==='av' && ['valid_photos','photos'].includes(getAvPhotoMode()) && ['season','lotcode'].includes(key)));
    return '<div class="inventory-excel-fields">'+fields.map(([key,label])=>'<div class="inventory-excel-field"><span>'+escape(label)+'</span><button type="button" data-field="'+key+'" onclick="return openInventoryExcelFilter(\''+scope+'\',this.dataset.field)">'+(state.filters[key] ? state.filters[key].size+' selected' : 'All')+' ▾</button></div>').join('')+'</div><div class="inventory-excel-chips">'+fields.filter(([key])=>state.filters[key]).map(([key,label])=>'<button type="button" data-field="'+key+'" onclick="return clearInventoryExcelFilter(\''+scope+'\',this.dataset.field)">'+escape(label)+': '+state.filters[key].size+' ×</button>').join('')+'<button type="button" onclick="return clearInventoryExcelFilter(\''+scope+'\')">Clear Filters</button></div><div data-excel-popover></div>';
}
function mountInventoryExcelFilters(scope) {
    if (scope === 'drive') mountDriveExcelHeaderFilters();
    if (scope === 'drive' || scope === 'request') document.querySelectorAll('[data-inventory-excel-scope="'+scope+'"]').forEach(bar=>{if(scope==='request'||!bar.closest('#drive-advanced-filters'))bar.remove();});
    const host=getInventoryExcelHost(scope); if(!host) return;
    let bar=host.querySelector('[data-inventory-excel-scope]');
    if(bar && bar.dataset.inventoryExcelScope!==scope) {bar.remove();bar=null;}
    if(!bar) {bar=document.createElement('section');bar.className='inventory-excel-bar';bar.dataset.inventoryExcelScope=scope;host.appendChild(bar);}
    if(bar.contains(document.activeElement) && bar.querySelector('[data-excel-search]')) return;
    const state=getInventoryExcelState(scope), signature=JSON.stringify([state.revision,state.rows.length,getInventoryExcelFields(scope).map(([k])=>[k,state.filters[k]?[...state.filters[k]]:null])]);
    bar.hidden=false;
    if(bar.dataset.signature===signature) return;
    bar.dataset.signature=signature;bar.innerHTML=inventoryExcelBarHtml(scope);
}
function openInventoryExcelFilter(scope, field, anchor = null) {
    const state=getInventoryExcelState(scope), options=getInventoryExcelOptions(state,field);
    state.open={field,options,query:'',draft:new Set(state.filters[field] || options.map(x=>x.key)),beforeSearch:null};
    const host=getInventoryExcelPopoverHost(scope,true); if(!host) return false;
    host.innerHTML='<div class="inventory-excel-popover excel-filter-panel" role="dialog" aria-label="Filter values"><input data-excel-search placeholder="Search values..." aria-label="Search values" oninput="searchInventoryExcelFilter(\''+scope+'\',this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();applyInventoryExcelFilter(\''+scope+'\');}"><div class="inventory-excel-actions"><button type="button" onclick="return bulkInventoryExcelFilter(\''+scope+'\',true)">Select All</button><button type="button" onclick="return bulkInventoryExcelFilter(\''+scope+'\',false)">Clear All</button></div><div class="inventory-excel-options" data-excel-options></div><div class="inventory-excel-actions"><button type="button" onclick="return applyInventoryExcelFilter(\''+scope+'\')">Apply</button><button type="button" onclick="return closeInventoryExcelPopover(\''+scope+'\')">Cancel</button></div></div>';
    paintInventoryExcelOptions(scope);
    if(scope==='drive') positionDriveExcelPopover(host,anchor || document.activeElement);
    host.querySelector('input')?.focus();return false;
}
function getInventoryExcelDisplayedOptions(state) {return state.open.options.filter(option=>doesExcelFilterSearchMatchStart(option.label,state.open.query));}
function paintInventoryExcelOptions(scope) {
    const state=getInventoryExcelState(scope), open=state.open, host=getInventoryExcelPopoverHost(scope)?.querySelector('[data-excel-options]'); if(!host || !open) return;
    host.innerHTML=getInventoryExcelDisplayedOptions(state).map(option=>'<div class="inventory-excel-option"><label><input type="checkbox" data-key="'+escapeHtml(option.key)+'" '+(open.draft.has(option.key)?'checked':'')+' onchange="toggleInventoryExcelOption(\''+scope+'\',this.dataset.key,this.checked)"><span>'+escapeHtml(option.label)+' ('+option.count+')</span></label><button type="button" data-key="'+escapeHtml(option.key)+'" onclick="return onlyInventoryExcelOption(\''+scope+'\',this.dataset.key)">Only</button></div>').join('') || '<p>No matching values.</p>';
}
function searchInventoryExcelFilter(scope, query) {
    const state=getInventoryExcelState(scope), open=state.open;if(!open)return;
    if(!open.query && query)open.beforeSearch=new Set(open.draft);
    if(open.query && !query && open.beforeSearch) {open.draft=new Set(open.beforeSearch);open.beforeSearch=null;}
    open.query=query;paintInventoryExcelOptions(scope);
}
function toggleInventoryExcelOption(scope,key,checked) {const draft=getInventoryExcelState(scope).open?.draft;if(draft)checked?draft.add(key):draft.delete(key);}
function bulkInventoryExcelFilter(scope, checked) {const state=getInventoryExcelState(scope);for(const option of getInventoryExcelDisplayedOptions(state))toggleInventoryExcelOption(scope,option.key,checked);paintInventoryExcelOptions(scope);return false;}
function onlyInventoryExcelOption(scope,key) {getInventoryExcelState(scope).open.draft=new Set([key]);return applyInventoryExcelFilter(scope);}
function applyInventoryExcelFilter(scope) {
    const state=getInventoryExcelState(scope), open=state.open;if(!open)return false;
    state.filters[open.field]=new Set(getInventoryExcelDisplayedOptions(state).filter(option=>open.draft.has(option.key)).map(option=>option.key));state.open=null;state.revision++;
    refreshInventoryExcelView(scope);return false;
}
function clearInventoryExcelFilter(scope,field='') {const state=getInventoryExcelState(scope);if(field)delete state.filters[field];else state.filters={};state.open=null;state.revision++;refreshInventoryExcelView(scope);return false;}
function refreshInventoryExcelView(scope) {
    closeInventoryExcelPopover(scope);
    if(scope==='av'){avResolvedBaseStateKey='';avSharedFilteredRowsCacheKey='';scheduleAVRender(0);}
    else if(scope==='drive'){driveBaseFilterCacheKey='';renderDrive();}
    else if(scope==='docks')renderDocks();
    else if(scope==='smart')renderSmartMovesIntelligence();
    else if(scope==='shear')renderShearList();
    else if(scope==='eval2'){managerEvalReport2ProgressiveRowsState?.observer?.disconnect();managerEvalReport2ProgressiveRowsState=null;resetManagerEvalReport2Drill();scheduleManagersRender(true);}
    else if(scope==='eval1'){getManagerReportPageController().refresh('eval1');scheduleManagersRender(true);}
    else if(scope==='reclass')paintReclassInventoryExcel();
    else {completedPendingRequestRender=null;renderRequest();}
    mountInventoryExcelFilters(scope);
}

function paintReclassInventoryExcel() {
    const state=getInventoryExcelState('reclass'), rows=argosInventoryTransactionState?.inquiryModel?.locationRows || [];
    const visible=new Set(applyInventoryExcelFilters('reclass',rows).map(row=>String(row.unique_id)));
    for(const card of document.querySelectorAll('#argos-reclass-item-inquiry [data-reclass-row-card]')) card.hidden=!visible.has(card.dataset.reclassRowCard);
}

function getAvCrossSeasonPhotoAudit() {
    if (getCurrentVisibleViewId() !== 'av' || !['valid_photos','photos'].includes(getAvPhotoMode())) return {active:false};
    const current=getCurrentAVBaseItems();
    if(current.isPartial)return {active:false};
    let expected=applyAvColumnFiltersToItems(getAvSalesRowsForBucket(activeAvSalesBucket,null,{photoMode:getAvPhotoMode()}),{allSeasons:true}).filter(createAvTopFilterPredicate({allSeasons:true})).filter(getAvPhotoMode()==='valid_photos'?hasValidRowPhoto:avItemHasPhotos);
    const filters=getInventoryExcelState('av');expected=expected.filter(row=>inventoryExcelRowMatches(row,filters));
    const term=getAvSearchBoxValue();if(term)expected=filterBySearch(expected,term,isAvCustomerSalesBucket(activeAvSalesBucket)?'av_reserves':'av_open');
    const shown=new Set(current.items.map(getAvReserveLocationUniqueKey));
    return {active:true,allSeasons:getAvSeasonSummaryLabel()==='All Seasons',missing:expected.filter(row=>!shown.has(getAvReserveLocationUniqueKey(row))).length};
}
function getInventoryExcelParityAudit() {
    for(const [scope,state] of getInventoryExcelState.cache?.scopes || []) {
        const host=getInventoryExcelHost(scope);if(!host || !state.rows.length)continue;
        const bar=host.querySelector('[data-inventory-excel-scope="'+scope+'"]');
        if(!bar || getInventoryExcelFields(scope).some(([key])=>!bar.querySelector('[data-field="'+key+'"]')))return {missing:true};
    }
    return {missing:false};
}

function getManagerEvalReport1ExcelPage(query) {
    if(query?.surface!=='eval1' || !['groups','rows'].includes(query.operation))return null;
    const metadata=getCachedManagerEvalReport2Metadata(),api=getManagerEvalReports2Api();
    const seed=api?.browseSeedRows(metadata);if(!seed)return null;
    let candidates=api.filterBrowseRows(seed,query.filters);
    const grid=query.filters?.gridColumns || {};
    candidates=candidates.filter(row=>Object.entries(grid).every(([field,filter])=>matchesDriveSpreadsheetHeaderFilter(row[field.toLowerCase()] ?? row[field] ?? '',filter.value,filter.mode || 'text')));
    const matched=applyInventoryExcelFilters('eval1',candidates);
    const scoped={...metadata,browseRows:matched.map(row=>metadata.browseColumns.map(key=>row[key]))};
    return api.buildBrowsePage(scoped,query,'cached:'+getDatasetLoadSignature('master'));
}

function syncInventoryExcelBars() {
    if(getCurrentVisibleViewId()!=='drive')closeInventoryExcelPopover('drive');
    for(const bar of document.querySelectorAll('[data-inventory-excel-scope]'))bar.hidden=!getInventoryExcelHost(bar.dataset.inventoryExcelScope);
}


function getBloomProjectParameters() {
    return { priority:'Priority',spec:'Target Spec / Caliper',dates:'Start Date & Finish By Date',assignee:'Who Needs to Grade / Complete (QC / Eval / User)',goal:'Target Goal / Destination Lot',count:'Require How Many Graded Out Count',marking:'What They Are Marked With',notes:'Target Spec / Notes',photo:'Photo Proof',sales:'Sales Rep / Customer / Consignee' };
}
function setBloomProjectMode(mode) {
    const draft=bloomInventoryProjectDraft;if(!draft||draft.busy)return false;
    draft.mode=mode;
    if(mode==='qc'){draft.parameters.sales=false;draft.parameters.assignee=true;draft.parameters.count=true;document.querySelectorAll('#bloom-inventory-project-modal [name^="grader-"]').forEach(input=>{input.value='QC';});}
    if(mode==='sales')draft.parameters.sales=true;else draft.parameters.sales=false;
    syncBloomProjectParameters();return false;
}
function toggleBloomProjectParameter(key) {
    const draft=bloomInventoryProjectDraft;if(!draft||draft.busy||!Object.hasOwn(draft.parameters,key))return false;
    draft.parameters[key]=!draft.parameters[key];syncBloomProjectParameters();return false;
}
function syncBloomProjectParameters() {
    const modal=document.getElementById('bloom-inventory-project-modal'),draft=bloomInventoryProjectDraft;if(!modal||!draft)return;
    modal.querySelectorAll('[data-project-question]').forEach(card=>{const key=card.dataset.projectQuestion,enabled=Object.hasOwn(draft.taskTypes,key)?draft.taskTypes[key]:draft.parameters[key];const toggle=card.querySelector('[data-question-toggle]'),body=card.querySelector('[data-question-body]');toggle.checked=!!enabled;body.hidden=!enabled;body.querySelectorAll('input,select,textarea,button').forEach(c=>c.disabled=!enabled);});
}
function renderBloomProjectQuestionCard(key,label,body) {
    const draft=bloomInventoryProjectDraft,enabled=Object.hasOwn(draft.taskTypes,key)?draft.taskTypes[key]:draft.parameters[key];
    return '<section class="project-question-card" data-project-question="'+key+'"><label class="project-question-heading"><input type="checkbox" data-question-toggle '+(enabled?'checked':'')+' onchange="toggleBloomProjectQuestion(this)"><strong>'+label+'</strong></label><div class="project-question-body" data-question-body '+(enabled?'':'hidden')+'>'+body+'</div></section>';
}
function toggleBloomProjectQuestion(input) {
    const draft=bloomInventoryProjectDraft;if(!draft||draft.busy)return false;const key=input.closest('[data-project-question]').dataset.projectQuestion;
    if(Object.hasOwn(draft.taskTypes,key))draft.taskTypes[key]=input.checked;else draft.parameters[key]=input.checked;draft.parameters.count=!!draft.taskTypes.grading;draft.parameters.spec=!!draft.taskTypes.grading;syncBloomProjectParameters();return false;
}
function applyBloomProjectTemplate(title) {
    if(!title||!bloomInventoryProjectDraft)return;const draft=bloomInventoryProjectDraft,row=draft.rows[0];document.querySelector('#bloom-inventory-project-modal [name=projectName]').value=title+' — '+(row.COMMONNAME||row.ITEMCODE)+' '+(row.CONTSIZE||'')+' ('+(row.LOCATIONCODE||'')+')';
    const task=title==='Cull & Clean Block'?'discard':title==='Haul / Consolidate'?'hauling':title==='Space / Shear Maintenance'?'maintenance':'grading';Object.keys(draft.taskTypes).forEach(k=>draft.taskTypes[k]=k===task);draft.parameters.sales=title==='Sales Rep Customer Pull';draft.parameters.count=task==='grading';draft.parameters.spec=task==='grading';syncBloomProjectParameters();
}

function addBloomProjectCustomVariable(definition=null) {
    const draft=bloomInventoryProjectDraft;if(!draft||draft.busy)return false;if(draft.customVariables.length>=32){showToast('Custom questions','Use up to 32 questions per project.',true);return false;}
    const def=definition||{},id=def.id||'field_'+crypto.randomUUID().replaceAll('-','');if(draft.customVariables.includes(id))return false;draft.customVariables.push(id);
    const type=def.answer_type||def.type||'number';
    document.querySelector('#bloom-inventory-project-modal [data-project-custom-fields]').insertAdjacentHTML('beforeend','<section class="project-question-card project-custom-definition" data-custom-id="'+esc(id)+'"><label class="project-question-heading"><input type="checkbox" name="custom-include-'+id+'" checked onchange="toggleBloomProjectCustomVariable(this)"><strong>Custom Question / Variable</strong></label><div class="project-question-body" data-custom-body><label>Question / Field Label<input name="custom-label-'+id+'" required maxlength="120" value="'+esc(def.label||'')+'"></label><label>Answer Type<select name="custom-type-'+id+'" onchange="toggleBloomProjectCustomChoices(this)">'+[['number','Number / Count'],['text','Text / Note'],['boolean','Yes / No'],['select','Dropdown Choices (comma-separated)']].map(([v,label])=>'<option value="'+v+'" '+(type===v?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label data-custom-choices '+(type==='select'?'':'hidden')+'>Choices (comma-separated)<input name="custom-choices-'+id+'" value="'+esc((def.choices||[]).join(', '))+'" '+(type==='select'?'required':'disabled')+' maxlength="2000"></label><label class="project-check"><input type="checkbox" name="custom-required-'+id+'" '+(def.required===false?'':'checked')+'>Required to complete project</label><label class="project-check"><input type="checkbox" name="custom-save-'+id+'" checked>Save to my checklist for future projects</label></div></section>');return false;
}
function toggleBloomProjectCustomVariable(input) {
    const card=input.closest('[data-custom-id]'),body=card.querySelector('[data-custom-body]');body.hidden=!input.checked;body.querySelectorAll('input,select').forEach(c=>c.disabled=!input.checked);if(input.checked)toggleBloomProjectCustomChoices(body.querySelector('select'));
}
function toggleBloomProjectCustomChoices(select) {
    const choices=select.closest('[data-custom-body]').querySelector('[data-custom-choices]'),input=choices.querySelector('input');choices.hidden=select.value!=='select';input.disabled=choices.hidden;input.required=!choices.hidden;
}
function getBloomProjectSavedVariables() {
    let local=[];try{local=JSON.parse(localStorage.getItem(inventoryProjectCacheKey()+':questions')||'[]');}catch{}if(!Array.isArray(local))local=[];
    const cloud=inventoryProjects.filter(p=>String(p.created_by||'').toLowerCase()===String(currentUser||'').toLowerCase()).flatMap(p=>p.project_meta?.custom_templates||[]);
    return [...new Map([...cloud,...local].filter(d=>d&&d.id&&d.label).map(d=>[d.id,d])).values()].slice(-64);
}
function renderBloomProjectSavedVariables() {
    const host=document.querySelector('#bloom-inventory-project-modal [data-project-saved-fields]');if(!host)return;const fields=getBloomProjectSavedVariables();host.innerHTML=fields.length?'<p>My saved checklist</p>'+fields.map(def=>'<label class="project-check"><input type="checkbox" data-saved-question="'+esc(def.id)+'" '+(bloomInventoryProjectDraft.customVariables.includes(def.id)?'checked':'')+' onchange="useBloomProjectSavedVariable(this)">'+esc(def.label)+'</label>').join(''):'';
}
function useBloomProjectSavedVariable(input) {
    const id=input.dataset.savedQuestion,def=getBloomProjectSavedVariables().find(d=>d.id===id);if(input.checked&&def)addBloomProjectCustomVariable(def);
    const card=document.querySelector('#bloom-inventory-project-modal [data-custom-id="'+CSS.escape(id)+'"]'),toggle=card?.querySelector('[name^="custom-include-"]');if(toggle){toggle.checked=input.checked;toggleBloomProjectCustomVariable(toggle);}
}
function rememberBloomProjectVariables(meta) {
    try{const fields=[...getBloomProjectSavedVariables(),...(meta.custom_templates||[])];localStorage.setItem(inventoryProjectCacheKey()+':questions',JSON.stringify([...new Map(fields.map(d=>[d.id,d])).values()].slice(-64)));}catch{}
}
function getInventoryProjectCustomDefinitions(project) {
    const meta=project.project_meta||{};return [...(meta.custom_variables||[]),...(meta.optional_custom_variables||[])];
}
function renderInventoryProjectCustomAnswer(def,value='') {
    const required=def.required!==false?'required':'',name='custom-'+escapeHtml(def.id),v=value??'';
    const control=def.answer_type==='select'?'<select name="'+name+'" '+required+'><option value="">Choose</option>'+(def.choices||[]).map(choice=>'<option value="'+escapeHtml(choice)+'" '+(v===choice?'selected':'')+'>'+escapeHtml(choice)+'</option>').join('')+'</select>':def.type==='boolean'?'<select name="'+name+'" '+required+'><option value="">Choose</option><option value="true" '+(v===true?'selected':'')+'>Yes</option><option value="false" '+(v===false?'selected':'')+'>No</option></select>':'<input name="'+name+'" type="'+(def.type==='number'?'number':'text')+'" '+(def.type==='number'?'step="any"':'maxlength="1000"')+' '+required+' value="'+escapeHtml(v)+'">';
    return '<label class="project-work-field"><span>'+escapeHtml(def.label)+(def.required===false?' (optional)':'')+'</span>'+control+'</label>';
}

function ensureQueueInventoryProjectsScope() {
    const scope=getSupabaseReadIdentityScope();
    if(queueInventoryProjectsScope!==scope){inventoryProjects=[];inventoryProjectRows=[];queueInventoryProjectsScope=scope;queueInventoryProjectsRefreshedAt=0;queueInventoryProjectsLoad=null;queueInventoryProjectsError='';restoreInventoryProjectsCache();}
    return scope;
}
function isInventoryProjectCompleted(project) {
    const rows=inventoryProjectRows.filter(row=>row.project_id===project.id);
    return rows.length?rows.every(row=>row.status==='done'):project.status==='completed';
}
function getQueueInventoryProjectActiveCount() {
    ensureQueueInventoryProjectsScope();return inventoryProjects.filter(project=>!isInventoryProjectCompleted(project)).length;
}
function ensureQueueInventoryProjectsData(force=false) {
    const scope=ensureQueueInventoryProjectsScope();if(!currentUser||queueInventoryProjectsLoad||(!force&&Date.now()-queueInventoryProjectsRefreshedAt<60000))return;
    queueInventoryProjectsRefreshedAt=Date.now();
    const task=refreshInventoryProjectsData().then(()=>{if(scope!==getSupabaseReadIdentityScope())return;queueInventoryProjectsError='';syncRequestTabButtons();if(activeReqTab==='projects'&&isViewVisible('request')&&!document.querySelector('#request-content form[data-dirty="true"]'))renderQueueInventoryProjects();}).catch(()=>{if(scope===getSupabaseReadIdentityScope()){queueInventoryProjectsError='Projects could not refresh. Saved projects remain available.';if(activeReqTab==='projects')document.querySelector('[data-project-refresh-status]')?.replaceChildren(document.createTextNode(queueInventoryProjectsError));}}).finally(()=>{if(queueInventoryProjectsLoad===task)queueInventoryProjectsLoad=null;});queueInventoryProjectsLoad=task;
}
function setQueueInventoryProjectFilter(kind,value) {
    if(kind==='assigned')queueInventoryProjectsAssigned=value;else if(kind==='priority')queueInventoryProjectsPriority=value;else queueInventoryProjectsFilter=value;
    renderQueueInventoryProjects(true,inventoryProjectActivePanel);return false;
}
function getInventoryProjectLiveRow(row) {
    const uid=row.snapshot_metrics?.master_uid;
    return (masterInventory||[]).find(item=>(!uid||String(item.UNIQUE_ID||item.unique_id)===String(uid))&&String(item.ITEMCODE||item.itemcode)===row.itemcode&&String(item.LOCATIONCODE||item.locationcode)===row.locationcode&&String(item.LOTCODE||item.lotcode)===row.lotcode)||null;
}
function canCompleteInventoryProjectRow(project,row) {
    const user=String(currentUser||'').toLowerCase(),role=String(nativeAuthProfile?.role||'').replace(/[^a-z]/gi,'').toLowerCase(),assigned=String(row.snapshot_metrics?.grader_username||'').toLowerCase();
    return ['admin','manager'].includes(role)||assigned===user||(assigned==='qc'&&['qc','qualitycontrol'].includes(role))||(assigned==='production'&&role==='production')||(assigned==='eval'&&['eval','evaluator'].includes(role))||(!assigned&&String(project.created_by).toLowerCase()===user);
}
function renderQueueInventoryProjects(force=false,targetId='request-content') {
    if(targetId!=='project-sandbox-result-cards')inventoryProjectActivePanel=targetId;
    ensureQueueInventoryProjectsScope();const panel=document.getElementById(targetId);if(!panel||(!force&&panel.querySelector('form[data-dirty="true"]')))return false;
    const crumb=targetId==='request-content'?document.getElementById('request-crumb'):null;if(crumb)crumb.textContent='Projects';
    const completed=inventoryProjects.filter(isInventoryProjectCompleted).length;
    const assignedOptions=[...new Set(['QC','Eval',...inventoryProjects.flatMap(project=>project.assigned_users||[])])].filter(Boolean);
    const visible=inventoryProjects.filter(project=>queueInventoryProjectsPriority==='all'||(project.project_meta?.priority||'Normal')===queueInventoryProjectsPriority).filter(project=>(queueInventoryProjectsFilter==='all'||isInventoryProjectCompleted(project)===(queueInventoryProjectsFilter==='completed'))&&(queueInventoryProjectsAssigned==='all'||(project.assigned_users||[]).includes(queueInventoryProjectsAssigned)));
    const date=value=>value?new Date(value.length===10?value+'T12:00:00':value).toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'}):'—';
    const field=(label,input)=>`<label class="project-work-field"><span>${escapeHtml(label)}</span>${input}</label>`;
    const cards=visible.map(project=>{const meta=project.project_meta||{},params=meta.parameters||{count:true,marking:true,notes:true},definitions=getInventoryProjectCustomDefinitions(project);
        return `<section class="project-queue-card">${renderInventoryProjectHeader(project)}${targetId==='inventory-projects-panel'?'<div class="project-pills"><button type="button" data-id="'+escapeHtml(project.id)+'" onclick="return openInventoryProject(this.dataset.id)">Project Details</button><button type="button" data-id="'+escapeHtml(project.id)+'" onclick="return deleteInventoryProject(this.dataset.id)">Delete Project</button></div>':''}<p>Assigned To: ${escapeHtml((project.assigned_users||[]).map(u=>['QC','Eval','Production'].includes(u)?u+' Team':u).join(', ')||project.created_by)}</p><p>Start Date: ${escapeHtml(date(project.start_date))} · Finish By Date: ${escapeHtml(date(project.finish_by_date))}</p>${meta.goal?'<p>Target: '+escapeHtml(meta.goal)+'</p>':''}${meta.target_notes?'<p>'+escapeHtml(meta.target_notes)+'</p>':''}${params.sales?'<p>'+escapeHtml(project.instructions)+'</p>':''}
        ${inventoryProjectRows.filter(row=>row.project_id===project.id).map(row=>{const live=getInventoryProjectLiveRow(row),snapshot=row.snapshot_metrics||{},done=row.status==='done',saved=row.completion_meta||{},photo=live?getRowPhotoLink(live,'drive'):snapshot.photo;const editable=!done&&canCompleteInventoryProjectRow(project,row);const finished=done&&row.completed_at?'✅ Finished: '+new Date(row.completed_at).toLocaleString('en-US',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true})+' by '+(row.completed_by||''):'⏳ In Progress';
            return `<form class="project-row-card" data-project-row-id="${escapeHtml(row.id)}" oninput="updateInventoryProjectProgress(this)" onsubmit="event.preventDefault();return completeQueueInventoryProjectRow(this)"><div class="project-plant-summary">${photo?'<img width="84" height="84" loading="lazy" alt="Plant" src="'+escapeHtml(photo)+'">':''}<div><strong>${escapeHtml(row.commonname||row.itemcode)} ${escapeHtml(row.contsize||'')} · ${escapeHtml(row.locationcode)} · ${escapeHtml(row.lotcode)}</strong><p>${escapeHtml(row.itemcode)}</p><p>On Hand: ${escapeHtml(live?.PTRONHAND??snapshot.onHand??'—')} · Available: ${escapeHtml(live?.PTRAVAILABLE??snapshot.available??'—')} · Open Stock: ${escapeHtml(live?getCardOpenStockValue(live):snapshot.openStock??'—')}</p><p>Spec: ${escapeHtml(live?.SPEC??snapshot.spec??'—')}</p></div></div><p class="project-finished">${escapeHtml(finished)}</p>
                <fieldset ${editable?'':'disabled'}>${renderInventoryProjectTaskWork(project,row)}
                ${params.count?field('How Many Graded Out',`<input name="qty_graded_out" type="number" min="0" step="1" required value="${escapeHtml(row.qty_graded_out??'')}">`):''}
                ${params.marking?field('Marked With',`<input name="marked_with" maxlength="200" required value="${escapeHtml(saved.marked_with??snapshot.marked_with??'N/A')}">`):''}
                ${params.count||params.notes?field(params.count?'Graded Spec / Notes':'Worker Notes',`<textarea name="notes" maxlength="4000">${escapeHtml(saved.notes||'')}</textarea>`):''}
                ${params.photo?field('Photo Proof · optional',`<input name="photo_file" type="file" accept="image/*" ><input name="photo_url" type="hidden" value="${escapeHtml(saved.photo_url||'')}">${saved.photo_url?'<a href="'+escapeHtml(saved.photo_url)+'" target="_blank" rel="noopener">View photo proof</a>':''}`):''}
                ${definitions.map(def=>renderInventoryProjectCustomAnswer(def,saved.custom_variables?.[def.id])).join('')}
                </fieldset><p role="status" data-project-row-status></p>${editable?'<button type="submit">✅ Complete Project</button>':''}${done&&Number(row.qty_graded_out)>0&&(meta.builder_version!==2||meta.target_lot)?'<button type="button" onclick="return moveGradedInventoryProjectQty(this.form.dataset.projectRowId)">⇄ Move Graded Qty to Open Stock</button>':''}</form>`;
        }).join('')}</section>`;
    }).join('');
    panel.innerHTML=`${targetId==='inventory-projects-panel'?'<button type="button" class="project-sandbox-launcher" onclick="return createInventoryProject()">New Project Folder</button>':''}<div class="project-pills">${[['active','Active / In Progress',inventoryProjects.length-completed],['completed','Completed',completed],['all','All',inventoryProjects.length]].map(([key,label,count])=>`<button type="button" aria-pressed="${queueInventoryProjectsFilter===key}" onclick="return setQueueInventoryProjectFilter('status','${key}')">${label} (${count})</button>`).join('')}<label>Assigned To <select onchange="return setQueueInventoryProjectFilter('assigned',this.value)"><option value="all">All</option>${assignedOptions.map(value=>`<option value="${escapeHtml(value)}" ${queueInventoryProjectsAssigned===value?'selected':''}>${escapeHtml(value)}</option>`).join('')}</select></label><label>Priority <select onchange="return setQueueInventoryProjectFilter('priority',this.value)">${['all','Normal','High','Critical'].map(v=>`<option value="${v}" ${queueInventoryProjectsPriority===v?'selected':''}>${v==='all'?'All priorities':v}</option>`).join('')}</select></label><button type="button" onclick="ensureQueueInventoryProjectsData(true)">Refresh</button><button type="button" onclick="return retrySavedInventoryProject()">Retry Saved Draft</button></div><p role="status" data-project-refresh-status>${escapeHtml(queueInventoryProjectsError)}</p>${cards||'<p class="p-6">No matching projects.</p>'}`;
    updateGlobalBackButton();return false;
}
async function completeQueueInventoryProjectRow(form) {
    if(form.dataset.saving==='true'||!form.reportValidity())return false;
    const row=inventoryProjectRows.find(r=>r.id===form.dataset.projectRowId),project=inventoryProjects.find(p=>p.id===row?.project_id);if(!project||!row||!canCompleteInventoryProjectRow(project,row))return false;
    const scope=getSupabaseReadIdentityScope(),value=n=>String(form.elements.namedItem(n)?.value||'').trim(),params=project.project_meta?.parameters||{},custom={};
    for(const def of getInventoryProjectCustomDefinitions(project)){const answer=value('custom-'+def.id);custom[def.id]=answer===''?null:def.type==='number'?Number(answer):def.type==='boolean'?answer==='true':answer;}
    const task_checks=Object.fromEntries(getProjectTaskTypes(project).map(t=>[t.type,!!form.elements.namedItem('task-'+t.type)?.checked]));
    const completion={task_checks,qty_discarded:value('qty_discarded')===''?null:Number(value('qty_discarded')),qty_hauled:value('qty_hauled')===''?null:Number(value('qty_hauled')),qty_graded_out:params.count?Number(value('qty_graded_out')):null,marked_with:value('marked_with'),notes:value('notes'),photo_url:value('photo_url'),custom_variables:custom};
    const status=form.querySelector('[data-project-row-status]'),button=form.querySelector('[type=submit]'),fieldset=form.querySelector('fieldset'),file=form.elements.namedItem('photo_file')?.files?.[0];form.dataset.saving='true';button.disabled=true;fieldset.disabled=true;status.textContent='Saving completion…';
    try {
        if(params.photo&&file&&form.projectUploadedFile!==file){status.textContent='Uploading photo proof…';const upload=await uploadPhotoViaAppApi('req-',file,'project-'+row.id+'-'+Date.now()+'.jpg',file.type||'image/jpeg',{isCurrent:()=>scope===getSupabaseReadIdentityScope()});if(scope!==getSupabaseReadIdentityScope())return false;completion.photo_url=upload.publicUrl;form.elements.namedItem('photo_url').value=upload.publicUrl;form.projectUploadedFile=file;}
        const result=await inventoryProjectApi('project_create_from_bloom',{operation:'complete_row',projectId:project.id,rowId:row.id,completion});if(scope!==getSupabaseReadIdentityScope())return false;
        const saved=result?.rows?.find(r=>r.id===row.id);if(!saved||saved.status!=='done'||!saved.completed_at)throw Error('Completion receipt missing. Retry to recover.');
        inventoryProjects=inventoryProjects.map(p=>p.id===project.id?result.project:p);inventoryProjectRows=[...inventoryProjectRows.filter(r=>r.project_id!==project.id),...result.rows];cacheInventoryProjects();renderQueueInventoryProjects(true,form.closest('#inventory-projects-panel')?'inventory-projects-panel':'request-content');syncRequestTabButtons();
    }catch(error){status.textContent=error.message;}finally{form.dataset.saving='false';button.disabled=false;fieldset.disabled=false;}return false;
}

function moveGradedInventoryProjectQty(rowId) {
    const row=inventoryProjectRows.find(value=>value.id===rowId),live=row&&getInventoryProjectLiveRow(row),qty=Number(row?.qty_graded_out);const metadata=inventoryProjects.find(p=>p.id===row?.project_id)?.project_meta;if(metadata?.builder_version===2&&!metadata.target_lot)return false;
    if(!live||!Number.isSafeInteger(qty)||qty<=0){showToast('Move Up','Refresh inventory to locate this exact graded row.',true);return false;}
    const uid=String(live.UNIQUE_ID||live.unique_id);openArgosInventoryTransactionModal(uid,'reclass','drive',{inquiryRow:live});
    if(argosInventoryTransactionState?.uid!==uid||!getArgosReclassRowEditorEntry(uid))return false;
    focusArgosReclassRow(uid);if(!getArgosReclassV3Proposal(uid,'move_up'))toggleArgosReclassV3Action(null,'move_up',uid);
    const proposal=getArgosReclassV3Proposal(uid,'move_up');if(!proposal?.splits?.length)return false;
    proposal.splits[0].quantity=String(qty);const project=inventoryProjects.find(value=>value.id===row.project_id),target=String(project?.project_meta?.target_lot||project?.project_meta?.goal||'').match(/\b\d{2}\.[A-Z]\d\b/i);if(target)proposal.splits[0].destinationSeason=target[0].toUpperCase();markArgosReclassProposalEdited(uid);refreshArgosReclassMultiActionUi();return false;
}

// A failed optional panel must not prevent the exact-row editor from opening.
function runDetailPanelRender(render, fallback = false) {
    try { return render(); } catch { console.warn('DETAIL_PANEL_RENDER_FAILED'); return fallback; }
}
function restoreEditableDetailControls(prefix, item = activeItem) {
    if (!item || !canEditRowDetails(prefix,item) || (isProtectedSectionLocked(prefix,item) && !isProtectedUnlocked(prefix))) return;
    const config=getProtectedEditConfig(prefix);if(!config)return;
    const container=document.getElementById(config.containerId),camera=document.getElementById(config.cameraId);
    const controls=[...config.inputIds.map(id=>document.getElementById(id)),document.getElementById(prefix+'btn-save-complete'),camera,...(camera?camera.querySelectorAll('input[type="file"]'):[])].filter(Boolean);
    for(const control of controls){control.removeAttribute('disabled');control.removeAttribute('readonly');control.classList.remove('is-locked','pointer-events-none','cursor-not-allowed','opacity-50','opacity-60');control.style.removeProperty('pointer-events');delete control.dataset.completionDisabled;}
    if(container){container.classList.remove('is-locked','pointer-events-none');container.style.removeProperty('pointer-events');container.removeAttribute('inert');container.querySelectorAll('fieldset[disabled]').forEach(fieldset=>fieldset.removeAttribute('disabled'));}
    if(camera)camera.classList.remove('hidden');
    if(container&&!container.dataset.rowEditUnlockBound){
        container.dataset.rowEditUnlockBound='true';
        const unlockOnEdit=event=>{
            if(!event.target.closest('input,textarea,select,button,label')||!activeItem||!canUserUnlockRow(currentUser,activeItem)||isProtectedUnlocked(prefix))return;
            const completed=activeItem.completed===true||String(firstNonEmptyValue(activeItem.DATE_COMPLETED,activeItem.date_completed,activeItem.completed_at,'')).trim()!=='';
            if(completed)unlockProtectedSection(prefix);
        };
        container.addEventListener('pointerdown',unlockOnEdit,true);container.addEventListener('focusin',unlockOnEdit,true);
    }
}

// Composable project questionnaire; canonical creation/completion retain their receipt and actor checks.
let queueInventoryProjectsPriority='all',inventoryProjectActivePanel='request-content';
const inventoryProjectTaskTypes={grading:'📏 Grading / Open Stock',discard:'🗑️ Discard / Cull',hauling:'🚜 Hauling / Moving',maintenance:'🌱 Ad-Hoc TLC / Maintenance'};
function renderBloomProjectTaskConfigurator(rows) {
    const input=(label,name,value='',type='text')=>'<label class="project-work-field">'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="1" step="1" required':'')+'></label>';
    const select=(label,name,values)=>'<label class="project-work-field">'+label+'<select name="'+name+'">'+values.map(([value,text])=>'<option value="'+esc(value)+'">'+esc(text)+'</option>').join('')+'</select></label>';
    const checks=(name,values)=>'<div class="project-checks">'+values.map(v=>'<label class="project-check"><input type="checkbox" name="'+name+'" value="'+esc(v)+'">'+esc(v)+'</label>').join('')+'</div>';
    const total=rows.reduce((n,r)=>n+(Number(String(r.PTRONHAND??0).replaceAll(',',''))||0),0),destinations=[...new Set((fullInventory?.length?fullInventory:masterInventory||[]).map(r=>r.LOCATIONCODE||r.locationcode).filter(Boolean))].sort();
    return renderBloomProjectQuestionCard('grading','Grade for Open Stock · How Many Graded Out?',input('Qty to Inspect / Target Count','task-grade-count',total||rows.length,'number')+select('Destination Open Stock Lot','task-target-lot',[['27.F1','27.F1'],['27.S1','27.S1'],['','Keep Current Lot / Count Only']])+input('Target Spec to Grade For','task-spec',rows[0].SPEC||'')+input('Target Caliper (optional)','task-caliper',rows[0].CALIPER||'')+'<p>Worker enters How Many Graded Out on completion.</p>')+
    renderBloomProjectQuestionCard('marking','What They Are Marked With · Ribbon / Tag / Stake','<div class="project-marking-choices">'+['N/A','Red Ribbon','Blue Ribbon','White Ribbon','Yellow Ribbon','Pink Ribbon','Orange Ribbon','Tag / Stake'].map(v=>'<button type="button" data-marking="'+esc(v)+'" onclick="this.form.elements[\'task-ribbon\'].value=this.dataset.marking">'+esc(v)+'</button>').join('')+'</div>'+input('Selected marking or custom text','task-ribbon','N/A'))+
    renderBloomProjectQuestionCard('discard','Discard / Cull Tracking · How Many Thrown Away?',checks('task-rejection',['Under-Spec / Small','Rootbound','Leaf Quality / Blight','Winter Damage','Dead / Cull'])+select('Disposal Method','task-disposal',['Dump Pile','Row End','Compost'].map(v=>[v,v]))+'<p>Worker enters How Many Discarded on completion.</p>')+
    renderBloomProjectQuestionCard('hauling','Hauling / Location Move · Where Are They Moving To?',input('From Location','task-from-location',[...new Set(rows.map(r=>r.LOCATIONCODE))].join(', '))+'<label class="project-work-field">To Destination Location<input name="destinationZone" list="project-destinations" placeholder="Search location" required><datalist id="project-destinations">'+destinations.map(v=>'<option value="'+esc(v)+'">').join('')+'</datalist></label>'+checks('task-equipment',['Wingding','Forklift','Trailer'])+'<p>Worker enters How Many Hauled on completion.</p>')+
    renderBloomProjectQuestionCard('maintenance','Maintenance / TLC Checklist',checks('task-maintenance',['Space Cans','Shear / Trim','Fertilize','Weed / Clean Bed','Stake / Tie','Re-Tag','Water'])+'<label>Instructions / Notes<textarea name="task-maintenance-notes" maxlength="4000"></textarea></label>')+
    renderBloomProjectQuestionCard('photo','Include Photo Proof on Completion','<p>Worker may upload a photo when completing.</p>');
}

function toggleBloomProjectTask(type){const draft=bloomInventoryProjectDraft;if(!draft||draft.busy)return false;draft.taskTypes[type]=!draft.taskTypes[type];draft.parameters.count=!!draft.taskTypes.grading;const modal=document.getElementById('bloom-inventory-project-modal');modal.querySelectorAll('[data-task-type]').forEach(b=>b.setAttribute('aria-pressed',String(!!draft.taskTypes[b.dataset.taskType])));modal.querySelectorAll('[data-task-block]').forEach(b=>{b.hidden=!draft.taskTypes[b.dataset.taskBlock];b.querySelectorAll('input,select,textarea').forEach(c=>c.disabled=b.hidden);});syncBloomProjectParameters();return false;}
function collectBloomProjectTasks(form) {
    const value=n=>String(form.elements.namedItem(n)?.value||'').trim(),checked=n=>Array.from(form.querySelectorAll('[name="'+n+'"]:checked')).map(c=>c.value),draft=bloomInventoryProjectDraft;
    return Object.keys(inventoryProjectTaskTypes).filter(k=>draft.taskTypes[k]).map(type=>({type,label:inventoryProjectTaskTypes[type],...(type==='grading'?{target_qty:Number(value('task-grade-count')),marked_with:draft.parameters.marking?value('task-ribbon'):'',target_spec:value('task-spec'),target_caliper:value('task-caliper'),target_lot:value('task-target-lot')}:type==='discard'?{reasons:checked('task-rejection'),disposal:value('task-disposal')}:type==='hauling'?{from_location:value('task-from-location'),destinationZone:value('destinationZone'),equipment:checked('task-equipment')}:{checklist:checked('task-maintenance'),instructions:value('task-maintenance-notes')})}));
}

function buildBloomProjectSummary(rows) {
    const sum=k=>rows.reduce((n,r)=>n+(Number(String(r[k]??0).replaceAll(',',''))||0),0),row=rows[0]||{};
    return '<p class="project-builder-summary">'+esc([row.COMMONNAME||row.ITEMCODE,row.CONTSIZE,row.LOCATIONCODE,row.LOTCODE].filter(Boolean).join(' · '))+' — '+rows.length+' '+(rows.length===1?'Row':'Rows')+' | On Hand: '+sum('PTRONHAND').toLocaleString()+' | Available: '+sum('PTRAVAILABLE').toLocaleString()+'</p>';
}

function handleBloomProjectPickerKey(event,input){const menu=input.closest('.bloom-project-picker-menu');if(!menu)return;const options=Array.from(menu.querySelectorAll('[role="option"]')).filter(b=>!b.hidden);if(event.key==='Escape'){event.preventDefault();menu.hidden=true;menu.parentElement.querySelector('.bloom-project-picker-trigger')?.focus();return;}if(!['ArrowDown','ArrowUp','Enter'].includes(event.key)||!options.length)return;event.preventDefault();let index=options.indexOf(document.activeElement);if(index<0&&event.key==='ArrowUp')index=0;if(event.key==='Enter'){if(index>=0)options[index].click();else options[0].click();return;}index=(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[index].focus();}
function inventoryProjectCacheKey(){return 'agdata.inventory-projects.v2:'+getSupabaseReadIdentityScope();}
function cacheInventoryProjects(){try{localStorage.setItem(inventoryProjectCacheKey(),JSON.stringify({projects:inventoryProjects,rows:inventoryProjectRows,savedAt:Date.now()}));}catch{}}
function restoreInventoryProjectsCache(){try{const data=JSON.parse(localStorage.getItem(inventoryProjectCacheKey())||'null');if(Array.isArray(data?.projects)&&Array.isArray(data?.rows)){inventoryProjects=data.projects;inventoryProjectRows=data.rows;}}catch{}}
function saveInventoryProjectDraft(payload){try{localStorage.setItem(inventoryProjectCacheKey()+':draft',JSON.stringify(payload));return true;}catch{return false;}}
function getProjectTaskTypes(project){return Array.isArray(project.project_meta?.tasks)?project.project_meta.tasks:[];}
function renderInventoryProjectTaskWork(project,row){const tasks=getProjectTaskTypes(project),saved=row.completion_meta||{},esc=escapeHtml;if(!tasks.length)return '';return '<details class="project-task-checklist" open><summary>Task Checklist</summary>'+tasks.map(task=>'<label class="project-check"><input type="checkbox" name="task-'+esc(task.type)+'" required '+(saved.task_checks?.[task.type]?'checked':'')+'>'+esc(task.label||inventoryProjectTaskTypes[task.type])+'</label><p>'+esc(task.type==='grading'?[task.target_spec,task.target_caliper,task.marked_with,task.target_lot].filter(Boolean).join(' · '):task.type==='discard'?[...(task.reasons||[]),task.disposal].filter(Boolean).join(' · '):task.type==='hauling'?[task.destinationZone,...(task.equipment||[])].filter(Boolean).join(' · '):[...(task.checklist||[]),task.instructions].filter(Boolean).join(' · '))+'</p>'+(['discard','hauling'].includes(task.type)?'<label class="project-work-field">How Many '+(task.type==='discard'?'Discarded':'Hauled')+'<input name="qty_'+(task.type==='discard'?'discarded':'hauled')+'" type="number" min="0" step="1" required value="'+esc(saved[task.type==='discard'?'qty_discarded':'qty_hauled']??'')+'"></label>':'')).join('')+'</details><div class="project-progress"><progress max="100" value="'+(row.status==='done'?100:0)+'"></progress><span data-project-progress-label>'+(row.status==='done'?100:0)+'%</span></div>';}
function updateInventoryProjectProgress(form){form.dataset.dirty='true';const controls=Array.from(form.querySelectorAll('fieldset input[required],fieldset select[required],fieldset textarea[required]')).filter(c=>!c.disabled),done=controls.filter(c=>c.type==='checkbox'?c.checked:c.value!==''&&c.checkValidity()).length,percent=controls.length?Math.floor(done/controls.length*100):0;const progress=form.querySelector('progress'),label=form.querySelector('[data-project-progress-label]');if(progress)progress.value=percent;if(label)label.textContent=percent+'%';}
function renderInventoryProjectHeader(project){const meta=project.project_meta||{},done=isInventoryProjectCompleted(project),past=!done&&project.finish_by_date&&new Date(project.finish_by_date+'T23:59:59')<new Date(),finished=done&&project.completed_at?'✅ Finished: '+new Date(project.completed_at).toLocaleString('en-US',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true})+' by '+(project.completed_by||''):'⏳ Not Finished Yet';return '<header class="project-card-heading"><h3>'+escapeHtml(project.project_name)+'</h3><div class="project-pills"><span>'+escapeHtml(meta.display_id||'PRJ-'+String(project.id).slice(-6))+'</span><span>'+escapeHtml(meta.priority||'Normal')+'</span><span>'+(done?'✅ COMPLETED':past?'🚨 PAST DUE':'⏳ IN PROGRESS')+'</span></div></header><p class="project-finished">Finished Date &amp; Time: '+escapeHtml(finished)+'</p><div class="project-pills"><button type="button" data-project-id="'+escapeHtml(project.id)+'" onclick="return reassignInventoryProject(this.dataset.projectId)">👤 Reassign</button><button type="button" onclick="return printInventoryProjectCard(this.closest(\'.project-queue-card\'))">🖨️ Print Run Sheet</button></div>';}
async function reassignInventoryProject(projectId){const project=inventoryProjects.find(p=>p.id===projectId);if(!project)return false;let modal=document.getElementById('project-reassign-dialog');if(!modal){modal=document.createElement('dialog');modal.id='project-reassign-dialog';document.body.appendChild(modal);}const users=[{username:'QC',display:'QC Team'},{username:'Eval',display:'Eval Team'},{username:'Production',display:'Production Team'},...getAssignableAppUserOptions()];modal.innerHTML='<form><h3>Reassign Project</h3><select name="assignee">'+users.map(u=>'<option value="'+escapeHtml(u.username)+'">'+escapeHtml(u.display||u.username)+'</option>').join('')+'</select><p role="status"></p><button type="submit">Save Assignment</button><button type="button" onclick="this.closest(\'dialog\').close()">Cancel</button></form>';modal.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;try{const scope=getSupabaseReadIdentityScope(),result=await inventoryProjectApi('project_create_from_bloom',{operation:'reassign',projectId,assigned_user:form.elements.assignee.value});if(scope!==getSupabaseReadIdentityScope())return;inventoryProjects=inventoryProjects.map(p=>p.id===projectId?result.project:p);inventoryProjectRows=[...inventoryProjectRows.filter(r=>r.project_id!==projectId),...result.rows];cacheInventoryProjects();modal.close();renderQueueInventoryProjects(true,inventoryProjectActivePanel);}catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}};modal.showModal();return false;}
function printInventoryProjectCard(card){if(!card)return false;const win=window.open('','_blank');if(!win)return false;const clone=card.cloneNode(true);clone.querySelectorAll('button').forEach(b=>b.remove());const outputControls=Array.from(clone.querySelectorAll('input,textarea,select'));card.querySelectorAll('input,textarea,select').forEach((input,i)=>{const output=outputControls[i];if(output){output.replaceWith(document.createTextNode(input.type==='checkbox'?(input.checked?'✓':'☐'):input.value));}});win.document.write('<!doctype html><html><head><title>Project Run Sheet</title><style>body{font:14px Arial;padding:24px}img{width:84px;height:84px;object-fit:cover}.project-row-card{break-inside:avoid;border-top:1px solid #bbb;padding:12px 0}label{display:block;margin:6px 0}button{display:none}</style></head><body>'+clone.outerHTML+'</body></html>');win.document.close();win.focus();win.print();return false;}
function renderProjectSandboxResult(payload){let modal=document.getElementById('project-sandbox-result');if(!modal){modal=document.createElement('dialog');modal.id='project-sandbox-result';document.body.appendChild(modal);}modal.innerHTML='<button type="button" onclick="this.closest(\'dialog\').close()">Close Preview</button><div id="project-sandbox-result-cards" data-project-preview="true"></div>';const beforeProjects=inventoryProjects,beforeRows=inventoryProjectRows;try{inventoryProjects=[{id:payload.projectId,project_name:payload.projectName,project_meta:payload.project_meta,start_date:payload.start_date,finish_by_date:payload.finish_by_date,assigned_users:[...new Set(payload.rows.map(r=>r.grader_username))],status:'active',created_by:currentUser}];inventoryProjectRows=payload.rows.map((r,i)=>({...r,id:'preview-'+i,project_id:payload.projectId,status:'pending',snapshot_metrics:{...r.snapshotMetrics,grader_username:r.grader_username}}));renderQueueInventoryProjects(true,'project-sandbox-result-cards');modal.querySelectorAll('#project-sandbox-result-cards button,#project-sandbox-result-cards select').forEach(b=>{if(!String(b.getAttribute('onclick')||'').includes('printInventoryProjectCard')){b.disabled=true;b.title='Preview only';}});modal.style.setProperty('--project-preview-width',document.getElementById('bloom-inventory-project-modal').style.getPropertyValue('--project-preview-width')||'960px');}finally{inventoryProjects=beforeProjects;inventoryProjectRows=beforeRows;}document.getElementById('bloom-inventory-project-modal').close();modal.showModal();return false;}

async function retrySavedInventoryProject(){let payload;try{payload=JSON.parse(localStorage.getItem(inventoryProjectCacheKey()+':draft')||'null');}catch{}if(!payload)return false;const scope=getSupabaseReadIdentityScope();try{const result=await inventoryProjectApi('project_create_from_bloom',payload);if(scope!==getSupabaseReadIdentityScope())return false;if(!result?.project?.id||!Array.isArray(result.rows))throw Error('Project receipt missing.');inventoryProjects=[...inventoryProjects.filter(p=>p.id!==result.project.id),result.project];inventoryProjectRows=[...inventoryProjectRows.filter(r=>r.project_id!==result.project.id),...result.rows];cacheInventoryProjects();localStorage.removeItem(inventoryProjectCacheKey()+':draft');syncRequestTabButtons();renderQueueInventoryProjects(true);showToast('Project saved','The saved draft is now published.');}catch(error){showToast('Project draft',error.message,true);}return false;}

function isReclassExplanationExempt() {
    const role = String(nativeAuthProfile?.role || getCurrentRoleAccessValue?.() || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    const username = String(nativeAuthProfile?.username || currentUser || '').trim().toLowerCase();
    return role === 'super-admin' || role === 'admin' || username === 'dylan_collyge';
}
function getReclassExplanation(uid) {
    return String(getArgosReclassRowProposalMap(String(uid || ''), false)?.reclassExplanation || '').trim();
}
function updateReclassExplanation(input) {
    const uid = input?.getAttribute('data-reclass-explanation-uid');
    if (!uid) return false;
    getArgosReclassRowProposalMap(uid, true).reclassExplanation = String(input.value || '');
    argosInventoryTransactionState.reclassDraftsByRowUid = argosReclassMultiActionState.rowProposals;
    input.removeAttribute('aria-invalid');
    input.style.borderColor = '#34d399';
    markArgosReclassProposalEdited(uid);
    captureEvalWorkLocalDraftSoon(0);
    return true;
}
function requireReclassExplanation(uid) {
    if (isReclassExplanationExempt() || getReclassExplanation(uid)) return true;
    focusArgosReclassRow(uid);
    const input = Array.from(document.querySelectorAll('.reclass-explanation-input')).find(node => node.getAttribute('data-reclass-explanation-uid') === String(uid));
    if (input) { input.setAttribute('aria-invalid','true'); input.style.borderColor='#f87171'; input.focus(); }
    showToast('Reclass Explanation Required', 'Reclass Explanation is required before submitting a Reclass.', true);
    return false;
}
function buildReclassExplanationField(uid) {
    const exempt = isReclassExplanationExempt();
    return '<label class="argos-reclass-row-field argos-reclass-row-field--wide" style="display:block;margin:12px 0"><strong>' + (exempt ? 'Reclass Explanation (Optional for Admin)' : 'Reclass Explanation * (Required)') + '</strong><textarea class="reclass-explanation-input argos-reclass-row-input" data-reclass-explanation-uid="' + escapeHtml(uid) + '" aria-label="Reclass Explanation" aria-required="' + !exempt + '" rows="3" maxlength="4000" style="display:block;width:100%;background:#052e24;color:#ecfdf5;border:1px solid #34d399;border-radius:10px;padding:12px" oninput="updateReclassExplanation(this)">' + escapeHtml(getReclassExplanation(uid)) + '</textarea></label>';
}
function collectReclassExplanations(draft) {
    const holds = new Set((draft.holdStopProposals || []).map(row => row.sourceUid));
    const result = {};
    for (const row of draft.rowOverlays || []) {
        if (!(row.proposals?.length || row.fieldEdits?.length || holds.has(row.unique_id) || row.resolution === 'done')) continue;
        if (!requireReclassExplanation(row.unique_id)) throw new Error('Reclass Explanation is required before submitting a Reclass.');
        result[row.unique_id] = getReclassExplanation(row.unique_id);
    }
    return result;
}

// Executive field audit: account-scoped drafts, canonical inventory reads and serialized PostgREST upserts.
function fieldAuditState() {
    const owner = getSupabaseReadIdentityScope();
    if (window.__fieldAuditState?.owner === owner) return window.__fieldAuditState;
    const key = 'agdata.field-audit.v1:' + owner;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
    const state = { owner, key, audits:saved.audits || {}, pending:saved.pending || {}, questions:saved.questions || [], rows:[], modes:{eval:'legacy',drive:'legacy'}, season:'Y', year:'2026max', status:'all', search:'', block:'', location:'', flat:false, sort:'locationcode', direction:1, page:0, loaded:false, loading:false, saving:false, error:'', varietiesOpen:false, allVarieties:false };
    state.rows = Array.from(masterInventoryById.values()).map(fieldAuditNormalizeRow);
    window.__fieldAuditState = state;
    if (!window.__fieldAuditOnlineHook) { window.addEventListener('online',()=>fieldAuditFlush()); window.__fieldAuditOnlineHook=true; }
    return state;
}
function fieldAuditNumber(value) { const n=Number(String(value ?? '').replace(/[$,\s]/g,'')); return Number.isFinite(n)?n:0; }
function fieldAuditYear(saleyear, lotcode) {
    for (const value of [saleyear,lotcode]) { const match=String(value || '').trim().match(/^(?:20)?(\d{2})(?:\D|$)/); if(match)return 2000+Number(match[1]); }
    return null;
}
function fieldAuditNormalizeRow(raw) {
    const value=(...keys)=>{for(const key of keys){const v=raw[key]??raw[key.toUpperCase()];if(v!==undefined&&v!==null&&v!=='')return v;}return '';};
    const row={id:String(value('unique_id')),itemcode:String(value('itemcode')).trim(),commonname:String(value('commonname')),contsize:String(value('contsize')),locationcode:String(value('locationcode')).trim().toUpperCase(),lotcode:String(value('lotcode')).trim().toUpperCase(),season:String(value('season')).trim().toUpperCase(),saleyear:fieldAuditYear(value('saleyear','sale_year'),value('lotcode')),on_hand:fieldAuditNumber(value('ptronhand','on_hand')),available:fieldAuditNumber(value('ptravailable','available')),list_price:fieldAuditNumber(value('listprice','list_price'))};
    row.blockalpha=String(value('blockalpha')||row.locationcode.split('.')[0]||'Unassigned').trim().toUpperCase();
    row.row_uid=[row.itemcode,row.locationcode,row.lotcode].map(v=>v.toUpperCase()).join('|');
    row.extended_value=row.on_hand*row.list_price;
    row.raw={...raw,...Object.fromEntries(Object.entries(raw).map(([k,v])=>[k.toUpperCase(),v])),UNIQUE_ID:row.id,SOURCE_TABLE:'ph_master_inventory'};
    return row;
}
function fieldAuditMatchingRows(rows, state, audits={}) {
    const words=String(state.search||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return rows.filter(row=>{
        const season=(row.season+' '+row.lotcode).toUpperCase(), year=row.saleyear, status=audits[row.row_uid]?.is_product_there||'UNCHECKED';
        if(state.season!=='all' && (state.season==='U'?!/U[123]/.test(season):!season.includes(state.season)))return false;
        if(state.year!=='all'&&(year===null||(state.year==='2026max'?year>2026:state.year==='2025max'?year>2025:year!==Number(state.year))))return false;
        if(state.status!=='all'&&(state.status==='UNCHECKED'?['YES','NO'].includes(status):status!==state.status))return false;
        if(state.block&&row.blockalpha!==state.block||state.location&&row.locationcode!==state.location)return false;
        const haystack=[row.commonname,row.itemcode,row.locationcode,row.lotcode].join(' ').toLowerCase();return words.every(word=>haystack.includes(word));
    }).sort((a,b)=>{const sortValue=row=>state.sort==='audit_status'?(audits[row.row_uid]?.is_product_there||'UNCHECKED'):state.sort.startsWith('question:')?audits[row.row_uid]?.custom_answers?.[state.sort.slice(9)]?.value:row[state.sort];const av=sortValue(a),bv=sortValue(b);return ((typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??''),undefined,{numeric:true,sensitivity:'base'}))*state.direction)||a.locationcode.localeCompare(b.locationcode,undefined,{numeric:true})||a.commonname.localeCompare(b.commonname);});
}
function fieldAuditRows() { const s=fieldAuditState();return getCurrentVisibleViewId()==='drive'&&s.modes.drive==='audit'?fieldAuditDriveRows():fieldAuditMatchingRows(s.rows,s,s.audits); }
function fieldAuditMetrics(rows, audits) {
    const result={lots:rows.length,units:0,value:0,yes:0,no:0,left:0,locations:new Set()};
    rows.forEach(row=>{result.units+=row.on_hand;result.value+=row.extended_value;result.locations.add(row.locationcode);const v=audits[row.row_uid]?.is_product_there;result[v==='YES'?'yes':v==='NO'?'no':'left']++;});
    result.percent=result.lots?Math.round((result.yes+result.no)/result.lots*100):0;return result;
}
function fieldAuditMoney(value) { return Number(value||0).toLocaleString('en-US',{style:'currency',currency:'USD'}); }
function fieldAuditProgress(m) { return '<span>✅ '+m.yes+' · ❌ '+m.no+' · ⏳ '+m.left+'</span><progress max="100" value="'+m.percent+'" aria-label="Audit completion">'+m.percent+'%</progress><small>'+m.percent+'% complete</small>'; }
function fieldAuditRemember(s=fieldAuditState()) { try{localStorage.setItem(s.key,JSON.stringify({audits:s.audits,pending:s.pending,questions:s.questions}));}catch{s.error='Device storage is full. Keep this page open while answers sync.';} }
async function fieldAuditRequest(method, query, body=null) {
    const native=await getNativeAuthRequestHeaders().catch(()=>null);
    const headers={apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,...(native||{}),'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'};
    const response=await window.GncDatabase.fetchTable(SUPABASE_URL,'ph_inventory_field_audits',query,{method,headers,referrerPolicy:'no-referrer',...(body?{body:JSON.stringify(body)}:{})},20000,'Field audit');
    if(!response.ok)throw new Error('Audit sync is pending ('+response.status+').');
    const text=await response.text();return text?JSON.parse(text):[];
}
async function loadFieldAuditReport(force=false) {
    const s=fieldAuditState();if(s.loading||s.loaded&&!force)return;s.loading=true;s.error='';
    const inventory=fetchAllInventoryReadRows('master_page',{dataset:'master',projection:'full'},{limit:1000,pageConcurrency:2,requireComplete:true,label:'Field audit inventory'}).then(rows=>{if(fieldAuditState()===s){s.rows=rows.map(fieldAuditNormalizeRow);s.inventoryReady=true;}});
    const audits=(async()=>{for(let offset=0;offset<100000;offset+=1000){const rows=await fieldAuditRequest('GET','select=*&order=row_uid.asc&limit=1000&offset='+offset);if(fieldAuditState()!==s)return;for(const row of rows){if(!s.pending[row.row_uid]&&(!s.audits[row.row_uid]||String(row.updated_at)>=String(s.audits[row.row_uid].updated_at)))s.audits[row.row_uid]=row;for(const [id,answer] of Object.entries(row.custom_answers||{})){if(answer&&typeof answer==='object'&&answer.label&&['yesno','number','text'].includes(answer.type)&&!s.questions.some(q=>q.id===id))s.questions.push({id,label:String(answer.label),type:answer.type});}}if(rows.length<1000)break;}})();
    const results=await Promise.allSettled([inventory,audits]);if(fieldAuditState()!==s)return;
    s.loading=false;s.loaded=true;if(results.some(r=>r.status==='rejected'))s.error='Showing available data. Refresh to retry background loading.';
    fieldAuditRemember(s);paintFieldAuditReport();fieldAuditFlush();
}
async function fieldAuditFlush() {
    const s=fieldAuditState();if(s.saving||!Object.keys(s.pending).length)return;s.saving=true;
    try{while(fieldAuditState()===s&&Object.keys(s.pending).length){const batch=Object.entries(s.pending).slice(0,100);await fieldAuditRequest('POST','on_conflict=row_uid',batch.map(([,entry])=>entry));for(const [key,entry] of batch)if(s.pending[key]===entry)delete s.pending[key];fieldAuditRemember(s);}s.error='';}
    catch{s.error='Saved on this device — awaiting sync. Retry when connected.';fieldAuditRemember(s);}
    finally{s.saving=false;if(fieldAuditState()===s)paintFieldAuditReport();}
}
function fieldAuditSetAnswer(id, field, value, repaint=true) {
    const s=fieldAuditState(),row=s.rows.find(r=>r.id===id);if(!row)return false;
    const now=new Date().toISOString(),previous=s.audits[row.row_uid]||{};
    const next={...previous,row_uid:row.row_uid,itemcode:row.itemcode,commonname:row.commonname,contsize:row.contsize,blockalpha:row.blockalpha,locationcode:row.locationcode,lotcode:row.lotcode,saleyear:row.saleyear===null?'':String(row.saleyear),season:row.season,on_hand_snapshot:row.on_hand,available_snapshot:row.available,extended_value_snapshot:row.extended_value,custom_answers:{...(previous.custom_answers||{})},verified_by:String(nativeAuthProfile?.username||currentUser||''),verified_at:now,updated_at:now};
    if(field.startsWith('question:')){const question=s.questions.find(q=>q.id===field.slice(9));if(!question)return false;next.custom_answers[question.id]={label:question.label,type:question.type,value:question.type==='number'?(value===''?null:Number(value)):value};}
    else if(field==='verified_count'){if(value!==''&&(!Number.isFinite(Number(value))||Number(value)<0)){showToast('Verified Qty','Enter a nonnegative count.',true);return false;}next.verified_count=value===''?null:Number(value);}
    else if(['is_product_there','missing_reason','audit_notes'].includes(field))next[field]=value;else return false;
    if(field==='is_product_there'&&value==='YES'&&next.verified_count==null)next.verified_count=row.on_hand;
    s.audits[row.row_uid]=next;s.pending[row.row_uid]=next;fieldAuditRemember(s);
    clearTimeout(s.saveTimer);s.saveTimer=setTimeout(()=>fieldAuditFlush(),350);if(repaint)paintFieldAuditReport();return false;
}
function fieldAuditMarkLocation(location) { const rows=fieldAuditRows().filter(r=>r.locationcode===location);rows.forEach(r=>fieldAuditSetAnswer(r.id,'is_product_there','YES',false));paintFieldAuditReport();return false; }
function fieldAuditFilter(name,value) { const s=fieldAuditState();if(['season','year','status','search'].includes(name))s[name]=value;s.page=0;paintFieldAuditReport(); }
function fieldAuditDrill(block='',location='') { const s=fieldAuditState();s.block=block;s.location=location;s.page=0;paintFieldAuditReport();return false; }
function fieldAuditBack() {const s=fieldAuditState();return s.location?fieldAuditDrill(s.block):fieldAuditDrill();}
function fieldAuditSort(key) { const s=fieldAuditState();s.direction=s.sort===key?-s.direction:1;s.sort=key;s.page=0;paintFieldAuditReport();return false; }
function fieldAuditMode(flat) {fieldAuditState().flat=flat;fieldAuditState().page=0;paintFieldAuditReport();return false;}
function fieldAuditSwitch(surface, mode) {fieldAuditState().modes[surface]=mode;if(surface==='drive')renderDrive();else renderManagers();return false;}
function fieldAuditSwitcher(surface) {const mode=fieldAuditState().modes[surface];return '<div class="field-audit-switcher" role="group" aria-label="Reports"><button type="button" aria-pressed="'+(mode==='audit')+'" onclick="return fieldAuditSwitch(\''+surface+'\',\'audit\')">'+(surface==='drive'?'S Y ≤ 26':'Season Y ≤ 2026 Field Audit')+'</button><button type="button" aria-pressed="'+(mode==='legacy')+'" onclick="return fieldAuditSwitch(\''+surface+'\',\'legacy\')">All Existing Reports · Low Stock · Not in F1</button></div>';}
// The caller owns complete master hydration, account/permission/epoch fencing,
// and cache publication. Classification always receives the original master
// cohort; display notes never create stock rows or change report membership.
async function buildEvalAggregateDashboardModel(inventoryRows, assignmentRows, options = {}) {
    const api = getManagerEvalReports2Api();
    if (!api) throw new Error('Eval report engine is not ready.');
    const yieldTask = options.yieldTask || (() => new Promise(resolve => setTimeout(resolve, 0)));
    const current = () => options.isCurrent?.() !== false;
    const checkpoint = async () => {
        if (!current()) throw Object.assign(new Error('Report snapshot changed.'), { code:'DATASET_READ_SCOPE_CHANGED' });
        await yieldTask();
        if (!current()) throw Object.assign(new Error('Report snapshot changed.'), { code:'DATASET_READ_SCOPE_CHANGED' });
    };
    const source = Array.isArray(inventoryRows) ? inventoryRows : [];
    const model = await api.buildAuthoritativeAssignmentModelAsync(source, assignmentRows, checkpoint, { assignmentContract:'inventory-row-assignments-v1' });
    const index = await api.classifyScriptCompatibleRowsAsync(model.rows, options.classifierOptions, checkpoint);
    const byItem = new Map(), sourceKeys=new Map();
    for (let i=0;i<model.rows.length;i++) {
        if (i%128===0) await checkpoint();
        const row=model.rows[i], code=getManagerEvalReport2ItemCode(row);
        sourceKeys.set(row,getManagerEvalReport2RowKey(row,i));
        if (!byItem.has(code)) byItem.set(code,[]);
        byItem.get(code).push(row);
    }
    const suppressed = new Set();
    let groupIndex=0;
    for (const [code,rows] of byItem) {
        if(groupIndex++%128===0) await checkpoint();
        if (api.isSuppressedEvalReportCardRows(rows)) suppressed.add(code);
    }
    const normalized = new Map(), auditRows = [];
    const priceValue = row => {
        for (const key of ['listprice','list_price']) {
            const value=row?.[key] ?? row?.[key.toUpperCase()];
            if (value!==undefined && value!==null && value!=='') return value;
        }
        return null;
    };
    for (let i=0;i<model.rows.length;i++) {
        if (i%64===0) await checkpoint();
        const row=model.rows[i], key=getManagerEvalReport2RowKey(row,i);
        if (normalized.has(key)) continue;
        const canonical=resolveCanonicalInventoryRow(row) || row;
        const audit=fieldAuditNormalizeRow(canonical), price=priceValue(canonical);
        normalized.set(key,{audit,missingPrice:price===null || String(price).trim()==='' || !Number.isFinite(Number(String(price).replace(/[$,\s]/g,'')))});
        auditRows.push(audit);
    }
    const summarize = async (reportId,rows,label,description) => {
        const result={id:reportId,label,description,lots:0,units:0,value:0,missingPrices:0};
        const seen=new Set();
        for (let i=0;i<rows.length;i++) {
            if (i%256===0) await checkpoint();
            const row=rows[i], key=sourceKeys.get(row) || getManagerEvalReport2RowKey(row,i);
            if (seen.has(key) || suppressed.has(getManagerEvalReport2ItemCode(row))) continue;
            seen.add(key);
            const value=normalized.get(key);
            if (!value) continue;
            result.lots++; result.units+=value.audit.on_hand; result.value+=value.audit.extended_value;
            if (value.missingPrice) result.missingPrices++;
        }
        if (options.includeCohortKeys) result.cohortKeys=[...seen];
        return result;
    };
    const reports=[];
    for (const id of api.REPORT_IDS) reports.push(await summarize(id,index.reports[id] || [],api.REPORT_META[id]?.label || id,api.REPORT_META[id]?.description || ''));
    const auditCohort=[];
    for(let i=0;i<auditRows.length;i+=128){
        await checkpoint();
        auditCohort.push(...fieldAuditMatchingRows(auditRows.slice(i,i+128),{season:'Y',year:'2026max',status:'all',search:'',block:'',location:'',sort:'locationcode',direction:1},{}));
    }
    const auditMetrics=fieldAuditMetrics(auditCohort,{});
    const auditIds=new Set(auditCohort);
    const audit={id:'field-audit',label:'Season Y ≤ 2026 Field Audit',description:'Season Y inventory through 2026.',lots:auditCohort.length,units:auditMetrics.units,value:auditMetrics.value,missingPrices:0};
    for (const entry of normalized.values()) if (auditIds.has(entry.audit) && entry.missingPrice) audit.missingPrices++;
    if (options.includeCohortKeys) audit.cohortKeys=[...normalized].filter(([,entry])=>auditIds.has(entry.audit)).map(([key])=>key);
    await checkpoint();
    return {reports:[audit,...reports],auditRows,sourceRowCount:normalized.size};
}


// Eval Reports landing is presentation state, separate from the existing report drills.
function evalAggregateDashboardState() {
    const owner = getSupabaseReadIdentityScope();
    const permission = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
    if (window.__evalAggregateDashboard?.owner === owner && window.__evalAggregateDashboard.permission === permission) return window.__evalAggregateDashboard;
    return window.__evalAggregateDashboard = { owner, permission, selected:'', model:null, source:null, pending:null, loading:false, error:'', attempted:false };
}
function isEvalAggregateDashboardVisible() { return !evalAggregateDashboardState().selected; }
function enterEvalAggregateDashboard() { const state = evalAggregateDashboardState(); state.selected = ''; state.entry = (state.entry || 0) + 1; }
function showEvalAggregateDashboard() {
    if (!canViewManagerEvalReports2()) return false;
    enterEvalAggregateDashboard();
    renderManagers();
    queueScrollMainAreaToTop('eval-aggregate-dashboard');
    updateGlobalBackButton();
    return false;
}
function backEvalAggregateDashboard() {
    const state = evalAggregateDashboardState();
    if (!state.selected) return false;
    if (state.selected === 'field-audit') {
        const audit = fieldAuditState();
        if (audit.block || audit.location) fieldAuditBack();
        else showEvalAggregateDashboard();
        return true;
    }
    if (managerEvalReport2DetailItemKey || managerEvalReport2BrowseMode === 'location' && managerEvalReport2DrillLevel > 0) return false;
    showEvalAggregateDashboard();
    return true;
}
function openEvalAggregateReport(reportId) {
    if (!canViewManagerEvalReports2()) return false;
    const state = evalAggregateDashboardState();
    const api = getManagerEvalReports2Api();
    if (reportId !== 'field-audit' && !api?.REPORT_IDS.includes(reportId)) return false;
    if (reportId === 'field-audit') {
        if (!state.model || !sameEvalAggregateDashboardSource(state.source, evalAggregateDashboardSource())) {
            const entry = state.entry || 0;
            queueEvalAggregateDashboardRefresh();
            state.pending?.then(() => {
                if (evalAggregateDashboardState() === state && (state.entry || 0) === entry && !state.selected && getCurrentVisibleViewId() === 'managers' && activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW && state.model && sameEvalAggregateDashboardSource(state.source, evalAggregateDashboardSource())) openEvalAggregateReport(reportId);
            });
            return false;
        }
        const audit = fieldAuditState();
        Object.assign(audit, { season:'Y', year:'2026max', status:'all', search:'', block:'', location:'', flat:false, page:0 });
        if (state.model?.auditRows) { audit.rows = state.model.auditRows; audit.inventoryReady = true; }
        audit.modes.eval = 'audit';
    } else {
        // The existing selection owner keeps draft-discard confirmation and permission checks.
        if (!setManagerEvalReport2Reports([reportId])) return false;
        clearManagerEvalReport2Filters();
        setManagerEvalReport2BrowseMode('location');
        fieldAuditState().modes.eval = 'legacy';
    }
    state.selected = reportId;
    renderManagers();
    queueScrollMainAreaToTop('eval-aggregate-report:' + reportId);
    updateGlobalBackButton();
    return false;
}
function renderEvalAggregateDashboard() {
    const state = evalAggregateDashboardState();
    queueEvalAggregateDashboardRefresh();
    const api = getManagerEvalReports2Api();
    const descriptors = [{ id:'field-audit', label:'Season Y ≤ 2026 Field Audit', description:'Season Y inventory through 2026. Review blocks, locations and field answers.' }, ...(api?.REPORT_IDS || []).map(id => ({ id, ...api.REPORT_META[id] }))];
    const reports = new Map((state.model?.reports || []).map(report => [report.id, report]));
    const status = state.error ? state.error : state.model ? state.loading ? 'Refreshing live inventory. Current complete totals remain visible.' : 'Live inventory totals · Choose a report to browse Block Alpha → LocationCode.' : 'Loading complete inventory totals…';
    return '<section class="eval-aggregate-dashboard" aria-labelledby="eval-aggregate-title" data-eval-aggregate-dashboard>'
        + '<header class="eval-aggregate-heading"><div><span class="eval-aggregate-eyebrow">Inventory overview</span><h2 id="eval-aggregate-title">Eval Reports</h2><p role="status">' + escapeHtml(status) + '</p></div>'
        + (state.error ? '<button type="button" class="eval-aggregate-retry" onclick="return retryEvalAggregateDashboard()">Retry totals</button>' : '') + '</header>'
        + '<div class="eval-aggregate-grid">' + descriptors.map(report => {
            const metrics = reports.get(report.id);
            return '<article class="eval-aggregate-card" data-eval-aggregate-report="' + escapeHtml(report.id) + '"><div class="eval-aggregate-card-copy"><h3>' + escapeHtml(report.label) + '</h3><p>' + escapeHtml(report.description || '') + '</p></div>'
                + '<dl class="eval-aggregate-metrics"><div><dt>Total On-Hand</dt><dd data-eval-aggregate-units>' + (metrics ? Number(metrics.units).toLocaleString('en-US') : '—') + '</dd></div><div><dt>Extended Value</dt><dd data-eval-aggregate-value>' + (metrics ? fieldAuditMoney(metrics.value) : '—') + '</dd></div></dl>'
                + '<p class="eval-aggregate-coverage">' + (metrics ? Number(metrics.lots).toLocaleString('en-US') + ' inventory row' + (metrics.lots === 1 ? '' : 's') + (metrics.missingPrices ? ' · ' + metrics.missingPrices + ' without a list price' : '') : 'Complete totals pending') + '</p>'
                + '<button type="button" class="eval-aggregate-go" onclick="return openEvalAggregateReport(\'' + escJsAttrValue(report.id) + '\')" aria-label="View report: ' + escapeHtml(report.label) + '">View Report <span aria-hidden="true">→</span></button></article>';
        }).join('') + '</div></section>';
}
function retryEvalAggregateDashboard() {
    const state = evalAggregateDashboardState();
    state.attempted = false;
    state.error = '';
    queueEvalAggregateDashboardRefresh(true);
    renderManagers();
    return false;
}
function evalAggregateDashboardSource() {
    const receipt = productionDisplayMasterReceipt, master = getDatasetState('master');
    const owner = getSupabaseReadIdentityScope(), permission = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
    const notes = getManagerAssignedColumnState();
    const ready = Array.isArray(fullInventory) && (receipt?.rows === fullInventory && receipt.readScope === owner && receipt.permission === permission
        || master.rowCompleteness === 'complete' && master.liveVerifiedScope === getProductionLiveSyncContext().scope && master.liveVerifiedPermission === permission);
    return { ready, owner, permission, rows:fullInventory, assignments:isDatasetLoaded('warehouseAssignedItems','full') ? warehouseAssignedItemsInventory : null,
        notes:notes.locationSalesNotes, noteScope:notes.noteScope, photoGeneration:notes.photoGeneration,
        epoch:resolvedViewStateEpoch, key:getManagerEvalReport2CacheKeyValue() };
}
function sameEvalAggregateDashboardSource(left, right) {
    return !!left && !!right && ['ready','owner','permission','rows','assignments','notes','noteScope','photoGeneration','epoch','key'].every(key => left[key] === right[key]);
}
function queueEvalAggregateDashboardRefresh(force = false) {
    if (!canViewManagerEvalReports2()) return;
    const state = evalAggregateDashboardState(), initial = evalAggregateDashboardSource();
    if (state.pending || !force && (initial.ready && sameEvalAggregateDashboardSource(state.source, initial) || !initial.ready && state.attempted || state.error && sameEvalAggregateDashboardSource(state.failedSource, initial))) return;
    state.loading = true;
    state.error = '';
    const ownsState = () => evalAggregateDashboardState() === state && canViewManagerEvalReports2();
    // Defer work until the dashboard is painted; the canonical engine yields between batches.
    state.pending = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
        if (!ownsState()) return;
        if (!initial.ready || force) {
            state.attempted = true;
            await ensureDatasetLoaded('master', 'full', { force });
        }
        if (!ownsState()) return;
        const source = evalAggregateDashboardSource();
        if (!source.ready) throw new Error('Complete inventory totals are not available yet. Retry totals to refresh.');
        const next = getConfiguredNextSaleSeasonTarget();
        const model = await buildEvalAggregateDashboardModel(source.rows, source.assignments || [], {
            classifierOptions:{ currentSeason:getConfiguredCurrentSeasonCode(), currentSalesYear:getConfiguredCurrentSalesYearCode(), nextSeason:next.season, nextSalesYear:next.salesYear, settings:managerEvalReportSettings, now:new Date() },
            isCurrent:() => ownsState() && sameEvalAggregateDashboardSource(source, evalAggregateDashboardSource())
        });
        if (!ownsState() || !sameEvalAggregateDashboardSource(source, evalAggregateDashboardSource())) return;
        state.model = model;
        state.source = source;
        state.attempted = false;
    }).catch(error => {
        if (ownsState() && error?.code !== 'DATASET_READ_SCOPE_CHANGED') {
            state.error = 'Complete inventory totals could not refresh. Please retry.';
            state.failedSource = evalAggregateDashboardSource();
        }
    }).finally(() => {
        state.pending = null;
        state.loading = false;
        if (ownsState() && isEvalAggregateDashboardVisible() && getCurrentVisibleViewId() === 'managers' && activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW) scheduleManagersRender(true);
    });
}

function renderManagerEvalReports2Panel() {if(!canViewManagerEvalReports2())return renderManagerEvalReports2LegacyPanel();if(isEvalAggregateDashboardVisible())return renderEvalAggregateDashboard();return fieldAuditState().modes.eval==='audit'?renderFieldAuditReport('eval'):renderManagerEvalReports2LegacyPanel();}
function renderDriveHoldStopCodeView(container,crumb,label='',state=null) {
    if(fieldAuditState().modes.drive==='audit'){applyDriveRenderMarkup(container,crumb,'Drive Mode > Executive Inventory & Field Audit',fieldAuditSwitcher('drive')+renderFieldAuditReport('drive'),'field-audit:'+Date.now());return;}
    renderDriveHoldStopCodeLegacyView(container,crumb,label,state);container.querySelectorAll('.field-audit-switcher').forEach(node=>node.remove());container.insertAdjacentHTML('afterbegin',fieldAuditSwitcher('drive'));
}
function renderFieldAuditReport(surface) {
    const s=fieldAuditState();if(!s.loaded&&!s.loading)setTimeout(()=>loadFieldAuditReport(),0);
    if(surface==='drive')return renderFieldAuditDriveReport();
    const select=(name,options)=>'<label>'+name[0].toUpperCase()+name.slice(1)+'<select onchange="fieldAuditFilter(\''+name+'\',this.value)">'+options.map(([value,label])=>'<option value="'+value+'" '+(s[name]===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>';
    return '<section class="field-audit" data-audit-surface="'+surface+'"><header><h2>Season Y ≤ 2026 Field Audit</h2><p>Season Y · Sale Year ≤ 2026 preset · Live field verification</p></header><div class="field-audit-toolbar">'+select('season',[['Y',"Contains Y"],['all','All Seasons'],['F1','F1'],['S1','S1'],['U','U1 / U2 / U3'],['X','X'],['Z','Z']])+select('year',[['2026max','≤ 2026'],['2027','2027'],['all','All Years'],['2026','2026 Only'],['2025max','≤ 2025']])+select('status',[['all','All Rows'],['UNCHECKED','⏳ Unchecked'],['YES','✅ YES (Present)'],['NO','❌ NO (Missing)']])+'<label class="field-audit-search">Search<input type="search" value="'+escapeHtml(s.search)+'" placeholder="Search Common Name, Item Code, or Location..." oninput="fieldAuditFilter(\'search\',this.value)"></label></div><div class="field-audit-toolbar"><button type="button" onclick="return fieldAuditAddQuestion()">➕ Add Audit Question</button><button type="button" onclick="return fieldAuditExport()">Export Excel</button><button type="button" onclick="return fieldAuditPrint()">🖨️ Print Field Audit Sheet</button><button type="button" onclick="loadFieldAuditReport(true);fieldAuditFlush()">↻ Refresh / Sync</button></div><div data-field-audit-body>'+fieldAuditBody()+'</div></section>';
}
function paintFieldAuditReport() {fieldAuditDriveRefreshOwners();if(document.activeElement?.matches('[data-audit-row] input,[data-audit-row] textarea'))return;document.querySelectorAll('[data-field-audit-body]').forEach(node=>node.innerHTML=node.closest('[data-audit-surface]')?.dataset.auditSurface==='drive'?fieldAuditDriveBody():fieldAuditBody());}
// Manager Field Audit shares the existing Low Stock drill card, with audit-only presentation.
function renderFieldAuditReportDrillGroup(key, group, metrics, state) {
    const isLocation = !!state.block;
    const args = isLocation ? [state.block, key] : [key];
    const label = isLocation ? getDriveBlockNumberLabel(key) : getDriveBlockAlphaLabel(key);
    const card = renderManagerEvalReport2DrillGroupCard({ kind:isLocation ? 'locationcode' : 'blockalpha', value:key, label,
        rowCount:group.length, locationCount:metrics.locations.size, itemCount:new Set(group.map(row => row.itemcode)).size }, {
        openAttrs:buildFastInvokeAttrs('fieldAuditDrill', args, isLocation ? 'Open block number ' + label : 'Open ' + label)
    });
    return '<article class="field-audit-location-group field-audit-report-group">' + card
        + (isLocation ? '<button type="button" class="field-audit-present" data-location="' + escapeHtml(key) + '" onclick="return fieldAuditMarkLocation(this.dataset.location)">✅ All Present at Loc</button>' : '') + '</article>';
}

function fieldAuditBody() {
    const s=fieldAuditState(),rows=fieldAuditRows(),m=fieldAuditMetrics(rows,s.audits),e=escapeHtml,number=n=>Number(n).toLocaleString('en-US');
    let html='<p class="field-audit-sync" role="status">'+e(s.error||(s.loading?'Refreshing complete inventory and saved audits…':Object.keys(s.pending).length?Object.keys(s.pending).length+' answers saved locally · syncing…':s.inventoryReady?'Complete inventory · answers synced':'Cached inventory · background refresh available'))+'</p><div class="field-audit-kpis"><article><span>Matching Lots</span><strong>'+number(m.lots)+'</strong></article><article><span>Total On-Hand</span><strong>'+number(m.units)+'</strong></article><article><span>Extended Value</span><strong>'+fieldAuditMoney(m.value)+'</strong></article><article><span>Audit Progress · Is Product There?</span>'+fieldAuditProgress(m)+'</article></div>';
    const varieties=new Map();rows.forEach(r=>{const group=varieties.get(r.commonname)||[];group.push(r);varieties.set(r.commonname,group);});const ranked=[...varieties].map(([name,group])=>({name,m:fieldAuditMetrics(group,s.audits)})).sort((a,b)=>b.m.units-a.m.units);
    html+='<details class="field-audit-varieties" '+(s.varietiesOpen?'open':'')+' ontoggle="fieldAuditState().varietiesOpen=this.open"><summary>Top Varieties Breakdown · '+ranked.length+' varieties</summary><div class="field-audit-scroll"><table><thead><tr><th>Variety</th><th>Lots</th><th>Total On-Hand</th><th>Total Value</th><th>% Share</th></tr></thead><tbody>'+ranked.slice(0,s.allVarieties?ranked.length:10).map(v=>{const share=m.units?v.m.units/m.units*100:0;return '<tr><td>'+e(v.name)+'</td><td>'+number(v.m.lots)+'</td><td>'+number(v.m.units)+'</td><td>'+fieldAuditMoney(v.m.value)+'</td><td>'+share.toFixed(1)+'%<progress max="100" value="'+Math.max(0,share)+'"></progress></td></tr>';}).join('')+'</tbody></table></div><button type="button" onclick="fieldAuditState().allVarieties=!fieldAuditState().allVarieties;paintFieldAuditReport()">'+(s.allVarieties?'Show top 10':'Show all varieties')+'</button></details>';
    html+='<div class="field-audit-toolbar" role="group" aria-label="Field audit display"><span>'+e(s.block?'Block '+s.block+(s.location?' · Location '+s.location:''):'All Blocks (A–L)')+'</span><button type="button" aria-pressed="'+!s.flat+'" onclick="return fieldAuditMode(false)">🗂️ Block → Location Drill-Down</button><button type="button" aria-pressed="'+s.flat+'" onclick="return fieldAuditMode(true)">Flat A–Z View</button></div>';
    if (!s.flat && !s.location) {
        const groups=new Map();for(const row of rows){const key=s.block?row.locationcode:row.blockalpha;const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
        html+='<div class="field-audit-tiles field-audit-standard-list">'+[...groups].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([key,group])=>{
            const metrics=fieldAuditMetrics(group,s.audits);
            return renderFieldAuditReportDrillGroup(key,group,metrics,s);
        }).join('')+'</div>'+(rows.length?'':'<p>No inventory matches these filters.</p>');
    } else html+=fieldAuditTable(rows);
    return html;
}
// Drive Reports shares the canonical LOCATION cards, with report-local filters.
function fieldAuditDriveState() {
    const s=fieldAuditState();
    return s.driveFilters ||= {preset:'season-y',season:'Y',yearOp:'<=',yearValue:'26',metric:'available',qtyOp:'all',qtyValue:'25',evalOwner:'all',search:''};
}
function fieldAuditDriveCompare(value,operator,operand) {
    if(operator==='all')return true;
    if(value===null||value===undefined||operand===null||operand===undefined||String(value).trim()===''||String(operand).trim()==='')return false;
    const left=Number(value),right=Number(operand);
    if(!Number.isFinite(left)||!Number.isFinite(right))return false;
    return operator==='<'?left<right:operator==='<='?left<=right:operator==='='?left===right:operator==='>='?left>=right:operator==='>'?left>right:false;
}
function fieldAuditDrivePresets() {
    const presets=[['season-y','Season Y'],['low-stock','Low Stock'],['not-in-f1','Not in F1'],['missing-photos','Missing Photos / Needs Eval'],['valid-photos','Valid Photos'],['hold-stop','Hold / Stop'],['priority','Move Up / Priority'],['unassigned','Unassigned Items'],['all','All Inventory']];
    const api=getManagerEvalReportsApi();
    for(const id of api?.REPORT_IDS||[])if(!presets.some(([key])=>key===id))presets.push([id,api.REPORT_META[id]?.label||id]);
    return presets;
}
function fieldAuditDriveFilter(name,value) {
    const s=fieldAuditState(),f=fieldAuditDriveState();
    if(!Object.hasOwn(f,name))return false;
    f[name]=value;s.page=0;
    if(name==='preset'){
        Object.assign(f,{season:value==='season-y'?'Y':'all',yearOp:value==='season-y'?'<=':'all',yearValue:'26',metric:value==='low-stock'?'open_stock':'available',qtyOp:value==='low-stock'?'<=':'all',qtyValue:'25'});
        s.block='';s.location='';
        document.querySelectorAll('[data-audit-surface="drive"] [data-drive-audit-filter]').forEach(input=>input.value=f[input.dataset.driveAuditFilter]);
    }
    paintFieldAuditReport();return false;
}
function fieldAuditDriveData() {
    const s=fieldAuditState(),epoch=typeof resolvedViewStateEpoch==='undefined'?'':resolvedViewStateEpoch;
    const key=[epoch,masterInventoryById.size,Math.floor(Date.now()/60000)].join(':');
    if(s.driveData?.source===s.rows&&s.driveData.key===key)return s.driveData;
    const rows=s.rows.map(row=>{
        const raw=masterInventoryById.get(row.id)||row.raw,live=fieldAuditNormalizeRow(raw);
        const season=String(live.season||live.lotcode).replace(/^(?:20)?\d{2}[. _-]*/, '').trim().toUpperCase();
        const openStock=fieldAuditNumber(getCardOpenStockValue(raw));
        return {...live,season,raw:{...live.raw,SEASON:season,SALEYEAR:live.saleyear,PTRONHAND:live.on_hand,PTRAVAILABLE:live.available,S_LTS:openStock},open_stock:openStock,owners:getDriveReportEvalUsersForItem(raw),searchText:[live.commonname,live.itemcode,live.contsize,live.locationcode,live.lotcode].join(' ').toLowerCase()};
    });
    const items=new Map();
    for(const row of rows){const item=items.get(row.itemcode)||{f1:0,support:0};if(row.season==='F1')item.f1+=Math.max(0,row.available);else item.support+=Math.max(0,row.available);items.set(row.itemcode,item);}
    return s.driveData={source:s.rows,key,rows,items,classified:null,photos:new Map()};
}
function fieldAuditDriveRows() {
    const s=fieldAuditState(),f=fieldAuditDriveState(),data=fieldAuditDriveData(),words=f.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const api=getManagerEvalReportsApi();let report=null;
    if(api?.REPORT_IDS.includes(f.preset)&&!['low-stock','not-in-f1'].includes(f.preset)){
        if(!data.classified){const target=getConfiguredNextSaleSeasonTarget();data.classified=api.classifyRows(data.rows.map(row=>row.raw),{currentSeason:getConfiguredCurrentSeasonCode(),currentSalesYear:getConfiguredCurrentSalesYearCode(),nextSeason:target.season,nextSalesYear:target.salesYear,settings:managerEvalReportSettings,now:new Date()}).reports;}
        report=new Set((data.classified[f.preset]||[]).map(row=>String(row.UNIQUE_ID||row.unique_id||'')));
    }
    const year=fieldAuditYear(f.yearValue,'');
    return data.rows.filter(row=>{
        if(s.block&&row.blockalpha!==s.block||s.location&&row.locationcode!==s.location)return false;
        if(f.season!=='all'&&row.season!==f.season)return false;
        if(!fieldAuditDriveCompare(row.saleyear,f.yearOp,year))return false;
        if(!words.every(word=>row.searchText.includes(word)))return false;
        if(f.evalOwner!=='all'&&(f.evalOwner==='__unassigned__'?row.owners.length:!row.owners.includes(f.evalOwner)))return false;
        const raw=row.raw,stock=data.items.get(row.itemcode);
        if(report&&!report.has(row.id))return false;
        if(f.preset==='not-in-f1'&&!(stock.support>0&&stock.f1===0))return false;
        if(f.preset==='unassigned'&&row.owners.length)return false;
        if(f.preset==='hold-stop'&&![getDriveHoldStopCode(raw),raw.HOLDSTOPREASON||raw.holdstopreason].some(value=>value&&!/^(?:0|N\/A|NONE|NO)$/i.test(String(value).trim())))return false;
        if(f.preset==='priority'&&!(fieldAuditNumber(raw.PRIORITY??raw.priority)>0||/^(?:Y|YES|TRUE|1)$/i.test(String(raw.MOVE_UP??raw.move_up??''))))return false;
        if(f.preset==='valid-photos'||f.preset==='missing-photos'){
            if(!data.photos.has(row.id))data.photos.set(row.id,hasValidRowPhoto(raw));
            if(data.photos.get(row.id)!==(f.preset==='valid-photos'))return false;
        }
        const metric=f.metric==='loc_photo_match'?fieldAuditNumber(getCurrentCardLocPhotoMatchQtyValue(resolveCanonicalInventoryRow(raw),'drive')):row[f.metric];
        return fieldAuditDriveCompare(metric,f.qtyOp,f.qtyValue);
    }).sort((a,b)=>compareLocationCodeValues(a.locationcode,b.locationcode)||a.commonname.localeCompare(b.commonname)||a.lotcode.localeCompare(b.lotcode,undefined,{numeric:true}));
}
function fieldAuditDriveOwnerOptions() {
    const f=fieldAuditDriveState(),options=getDriveReportEvalUserOptions(fieldAuditDriveData().rows.map(row=>row.raw)).map(option=>[option.value,option.value==='all'?'All Users':option.label]);
    if(!options.some(([value])=>value===f.evalOwner))options.push([f.evalOwner,f.evalOwner]);
    return options;
}
function fieldAuditDriveRefreshOwners() {
    const f=fieldAuditDriveState(),e=escapeHtml;
    for(const select of document.querySelectorAll('[data-audit-surface="drive"] [data-drive-audit-filter="evalOwner"]')){
        const markup=fieldAuditDriveOwnerOptions().map(([value,label])=>'<option value="'+e(value)+'" '+(value===f.evalOwner?'selected':'')+'>'+e(label)+'</option>').join('');
        if(select.__fieldAuditOptions!==markup){select.innerHTML=markup;select.__fieldAuditOptions=markup;}
    }
}
function renderFieldAuditDriveReport() {
    const s=fieldAuditState(),f=fieldAuditDriveState(),e=escapeHtml;
    const select=(name,label,options)=>'<label>'+e(label)+'<select data-drive-audit-filter="'+name+'" onchange="return fieldAuditDriveFilter(\''+name+'\',this.value)">'+options.map(([value,text])=>'<option value="'+e(value)+'" '+(f[name]===value?'selected':'')+'>'+e(text)+'</option>').join('')+'</select></label>';
    const number=(name,label)=>'<label>'+e(label)+'<input type="number" inputmode="decimal" step="any" data-drive-audit-filter="'+name+'" value="'+e(f[name])+'" oninput="fieldAuditDriveFilter(\''+name+'\',this.value)"></label>';
    const operators=[['all','All'],['<','<'],['<=','≤'],['=','='],['>=','≥'],['>','>']];
    const owners=fieldAuditDriveOwnerOptions();
    return '<section class="field-audit" data-audit-surface="drive"><div class="field-audit-toolbar">'+select('preset','Filter View',fieldAuditDrivePresets())+select('season','Season (LotCode)',['all','Y','F1','S1','U1','U2','U3','X','Z'].map(value=>[value,value==='all'?'All':value]))+select('yearOp','Sales Year',operators)+number('yearValue','Year (26 or 2026)')+select('metric','Qty / Stock Metric',[['available','Available'],['open_stock','Open Stock'],['on_hand','On Hand'],['loc_photo_match','Loc Photo Match']])+select('qtyOp','Qty Operator',operators)+number('qtyValue','Qty / Stock Number')+select('evalOwner','Eval Owner',owners)+'<label class="field-audit-search">Search<input type="search" value="'+e(f.search)+'" placeholder="Common Name, Item Code, Location…" oninput="fieldAuditDriveFilter(\'search\',this.value)"></label></div><div class="field-audit-toolbar"><button type="button" onclick="return fieldAuditAddQuestion()">+ Add Audit Question</button><button type="button" onclick="return fieldAuditExport()">Export Excel</button><button type="button" onclick="return fieldAuditPrint()">Print</button><button type="button" onclick="loadFieldAuditReport(true);fieldAuditFlush()">Refresh / Sync</button></div><div data-field-audit-body>'+fieldAuditDriveBody()+'</div></section>';
}
function fieldAuditDriveBody() {
    const s=fieldAuditState(),rows=fieldAuditDriveRows(),e=escapeHtml;
    let html='<nav class="field-audit-breadcrumb" aria-label="Report location">'+(s.block?'<button type="button" data-secondary-back onclick="return fieldAuditBack()">← Back</button>':'')+'<button type="button" onclick="return fieldAuditDrill()">BlockAlpha A–L</button>'+(s.block?'<span>›</span><button type="button" data-block="'+e(s.block)+'" onclick="return fieldAuditDrill(this.dataset.block)">'+e(s.block)+'</button>':'')+(s.location?'<span>› '+e(s.location)+'</span>':'')+'</nav>';
    if(s.error)html+='<p role="status">'+e(s.error)+'</p>';
    if(s.location)return html+fieldAuditTable(rows,true);
    const groups=new Map();
    for(const row of rows){const key=s.block?row.locationcode:row.blockalpha;const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
    const entries=[...groups].sort((a,b)=>compareLocationCodeValues(a[0],b[0]));
    return html+'<div>'+entries.map(([key,group])=>{
        const metrics=fieldAuditMetrics(group,s.audits),details={rowCount:group.length,blockNumberCount:metrics.locations.size,totalCans:metrics.units,fieldAudit:true,fieldAuditDrive:true};
        return s.block?renderDriveLocationGroupCard({...details,location:key,block:s.block}):renderDriveBlockGroupCard({...details,block:key});
    }).join('')+'</div>'+(rows.length?'':'<p>No inventory matches these filters.</p>');
}

function fieldAuditInventoryColumns() {return [['locationcode','Location Code'],['commonname','Common Name'],['itemcode','Item Code'],['contsize','Size'],['lotcode','Lot Code'],['saleyear','Sale Year'],['season','Season'],['on_hand','On Hand'],['available','Available'],['list_price','List Price'],['extended_value','Extended Value']];}
function fieldAuditTable(rows,drive=false) {
    const s=fieldAuditState(),e=escapeHtml,columns=fieldAuditInventoryColumns();s.page=Math.max(0,Math.min(s.page,Math.ceil(rows.length/100)-1));
    const control=(row,field,html)=>'<label>'+e(field)+' '+html+'</label>';
    const tableRows=rows.slice(s.page*100,s.page*100+100).map(row=>{
        const a=s.audits[row.row_uid]||{},status=a.is_product_there||'UNCHECKED',uid=e(row.id);
        const input=(field,value,type='text')=>'<input type="'+type+'" '+(type==='number'?'min="0" step="any"':'maxlength="4000"')+' data-row="'+uid+'" data-field="'+e(field)+'" value="'+e(value??'')+'" onchange="fieldAuditSetAnswer(this.dataset.row,this.dataset.field,this.value,false)">';
        let audit='<div class="field-audit-choice" role="group" aria-label="Is the product there?">'+['YES','NO'].map(v=>'<button type="button" class="field-audit-'+v.toLowerCase()+'" aria-pressed="'+(status===v)+'" data-row="'+uid+'" data-answer="'+v+'" onclick="return fieldAuditSetAnswer(this.dataset.row,\'is_product_there\',this.dataset.answer)">'+(v==='YES'?'✅ YES':'❌ NO')+'</button>').join('')+'</div>';
        if(status==='YES')audit+=control(row,'Verified Qty',input('verified_count',a.verified_count??row.on_hand,'number'));
        if(status==='NO')audit+='<div class="field-audit-missing-reasons" role="group" aria-label="Missing reason">'+['Already Planted / Shifted','Moved Location','Sold / Shipped','Dumped / Dead','Needs Recount'].map(v=>'<button type="button" aria-pressed="'+(a.missing_reason===v)+'" data-row="'+uid+'" data-reason="'+e(v)+'" onclick="return fieldAuditSetAnswer(this.dataset.row,\'missing_reason\',this.dataset.reason)">'+e(v)+'</button>').join('')+'</div><button type="button" data-row="'+uid+'" onclick="return fieldAuditOpenRow(this.dataset.row,\'reclass\')">⇄ Open in Reclass</button>';
        if(status!=='UNCHECKED')audit+=control(row,'Audit Note',input('audit_notes',a.audit_notes))+'<small class="field-audit-badge">'+(s.pending[row.row_uid]?'⏳ Saved locally':'✓ Verified')+' by '+e(a.verified_by||'')+' · '+e(a.verified_at?new Date(a.verified_at).toLocaleString('en-US',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'')+'</small>';
        const custom=s.questions.map(q=>{const value=a.custom_answers?.[q.id]?.value??'',field='question:'+q.id;return '<label>'+e(q.label)+(q.type==='yesno'?'<select data-row="'+uid+'" data-field="'+e(field)+'" onchange="fieldAuditSetAnswer(this.dataset.row,this.dataset.field,this.value,false)">'+['','YES','NO'].map(v=>'<option '+(value===v?'selected':'')+'>'+v+'</option>').join('')+'</select>':input(field,value,q.type==='number'?'number':'text'))+'</label>';}).join('');
        const source=masterInventoryById.get(row.id)||formatFetchedRows([row.raw],'ph_master_inventory')[0]||row.raw;
        const item=resolveCanonicalInventoryRow(source)||source;
        const card=generateCard(item,'drive',getDriveCardStatusClass(item),{originView:getCurrentVisibleViewId()});
        return '<article class="field-audit-plant-card" data-audit-row="'+uid+'" data-audit-status="'+status+'">'+card+'<div class="field-audit-row-values"><span>List Price '+fieldAuditMoney(row.list_price)+'</span><span>Ext Value '+fieldAuditMoney(row.extended_value)+'</span></div><section class="field-audit-answer" onclick="event.stopPropagation()"><strong>Is the Product There?</strong>'+audit+custom+(drive?'<div class="field-audit-toolbar"><button type="button" onclick="return fieldAuditAddQuestion()">+ Add Audit Question</button><button type="button" data-row="'+uid+'" onclick="return fieldAuditOpenRow(this.dataset.row,\'reclass\')">⇄ Open in Reclass</button></div>':'')+'</section></article>';
    }).join('');
    return '<div class="field-audit-plant-cards">'+tableRows+'</div><div class="field-audit-pagination"><button type="button" '+(s.page===0?'disabled':'')+' onclick="fieldAuditState().page--;paintFieldAuditReport()">Previous</button><span>Page '+(s.page+1)+' of '+Math.max(1,Math.ceil(rows.length/100))+' · '+rows.length+' matching lots</span><button type="button" '+((s.page+1)*100>=rows.length?'disabled':'')+' onclick="fieldAuditState().page++;paintFieldAuditReport()">Next</button></div>';
}
function fieldAuditOpenRow(id, action) {const row=fieldAuditState().rows.find(r=>r.id===id);if(!row)return false;const source=getCurrentVisibleViewId();if(action==='reclass')return openArgosInventoryTransactionModal(row.id,'reclass',source,{inquiryRow:row.raw});return openDetail(row.id,source,{__masterDetailRow:row.raw});}
function fieldAuditAddQuestion() {
    const dialog=document.createElement('dialog');dialog.className='field-audit field-audit-dialog';dialog.innerHTML='<form onsubmit="return fieldAuditSaveQuestion(event,this)"><h2>Add Audit Question</h2><label>Question<input name="question" required maxlength="160" placeholder="Ready to Shift?"></label><label>Answer type<select name="type"><option value="yesno">Yes / No</option><option value="number">Number / Count</option><option value="text">Text / Note</option></select></label><footer><button type="button" onclick="this.closest(\'dialog\').close()">Cancel</button><button type="submit">Add Question</button></footer></form>';dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();return false;
}
function fieldAuditSaveQuestion(event,form) {event.preventDefault();const label=form.elements.question.value.trim();if(!label)return false;const s=fieldAuditState();s.questions.push({id:'q_'+crypto.randomUUID().replaceAll('-',''),label,type:form.elements.type.value});fieldAuditRemember(s);form.closest('dialog').close();paintFieldAuditReport();return false;}
function fieldAuditExportData() {
    const s=fieldAuditState(),columns=fieldAuditInventoryColumns(),labels=columns.map(([,label])=>label).concat(['Is Product There?','Verified Count','Missing Reason','Audit Notes','Verified By','Verified At'],s.questions.map(q=>q.label));
    const rows=fieldAuditRows().map(row=>{const a=s.audits[row.row_uid]||{};return columns.map(([key])=>row[key]??'').concat([a.is_product_there||'UNCHECKED',a.verified_count??'',a.missing_reason||'',a.audit_notes||'',a.verified_by||'',a.verified_at||''],s.questions.map(q=>a.custom_answers?.[q.id]?.value??''));});return {labels,rows};
}
function fieldAuditExport() {
    const data=fieldAuditExportData(),s=fieldAuditState();
    downloadExcelWorkbook(data.labels.map((label,index)=>({label,value:row=>row[index]})),data.rows,'Season Y <= 2026 Field Audit',s.search,'field-audit',null,{filenameBase:'Season Y Field Audit'});
    return false;
}
function fieldAuditPrint() {const data=fieldAuditExportData(),s=fieldAuditState(),e=escapeHtml,win=window.open('','_blank');if(!win){showToast('Print','Allow the print window, then try again.',true);return false;}win.document.write('<!doctype html><html><head><title>Executive Field Audit</title><style>body{font:11px Arial;color:#ecfdf5;background:#081c12;padding:16px;print-color-adjust:exact}table{border-collapse:collapse;width:100%}td,th{padding:6px;border:1px solid #34d399;overflow-wrap:anywhere}th{background:#0b2416;color:#34d399}thead{display:table-header-group}tr{break-inside:avoid}@page{size:landscape;margin:10mm}</style></head><body><h1>Executive Inventory &amp; Field Audit</h1><p>'+e([s.block||'All Blocks',s.location||'All Locations','Season '+s.season,'Year '+s.year,s.status,s.search].join(' · '))+'</p><table><thead><tr>'+data.labels.map(v=>'<th>'+e(v)+'</th>').join('')+'</tr></thead><tbody>'+data.rows.map(row=>'<tr>'+row.map(v=>'<td>'+e(String(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></body></html>');win.document.close();win.focus();win.print();return false;}

function getAvNotePickerLabel(value = '') {
    const raw = String(value || '').trim();
    if (/^N\s*\/\s*A$/i.test(raw)) return 'N/A';
    return sanitizeAvNoteWithoutSpecCaliper(raw).toUpperCase();
}

function getAvNotePickerLabels(item = null) {
    const presets = ['DORMANT','FLUSHING','FRESH TOPS','FULL TOPS','GOOD COLOR','BUD & BLOOM','GREAT BODY','HEAVY BUDS','NICE FOLIAGE','TRIMMED','N/A'];
    return Array.from(new Set([...presets, ...getIndexedAvNotes(item)].map(getAvNotePickerLabel).filter(Boolean))).sort((a,b) => a.localeCompare(b));
}

function buildSelectedAvNote(note = '', prefix = '', options = {}) {
    if (note === '__CLEAR_AV_NOTE__') return '';
    if (note === '__SPEC_ONLY__') { const spec=String(document.getElementById(String(prefix || '')+'spec')?.value || getAvNoteSpecCaliperValues(prefix).spec || '').trim(); return spec && !/^N\s*\/?\s*A$/i.test(spec) ? 'SPEC - '+spec : ''; }
    const label = options.customText === true ? String(note || '').trim() : getAvNotePickerLabel(note);
    const field = document.getElementById(String(prefix || '') + 'spec');
    const spec = String(field ? field.value : getAvNoteSpecCaliperValues(prefix).spec || '').trim();
    return label && spec && !/^N\s*\/?\s*A$/i.test(spec) ? `${label} / SPEC - ${spec}` : label;
}

function openAvNotePicker(prefix = '', event = null) {
    const safePrefix = String(prefix || '').trim();
    if (!AV_NOTE_DROPDOWN_PREFIXES.includes(safePrefix)) return false;
    if (event?.cancelable) event.preventDefault();
    event?.stopPropagation?.();
    if (!canEditRowDetails(safePrefix)) { showRowEditRestrictedToast(safePrefix); return false; }
    const input = document.getElementById(getAvNoteInputIdForPrefix(safePrefix));
    const list = document.getElementById(getAvNoteDropdownListIdForPrefix(safePrefix));
    if (!input || !list || input.disabled) return false;
    closeDetailMeasurementKeyboard(false, { blur:true });
    document.activeElement?.blur?.();
    list.dataset.avNotePresentation='modal';
    list.style.removeProperty('max-height');
    if (!list.classList.contains('hidden') && requestAvNoteSheetState.prefix === safePrefix) return false;
    hideAllAvNoteDropdowns(safePrefix);
    avNoteRenderedKeys[safePrefix] = '';
    filterAvNotes(safePrefix, { showAll:true, fromDropdownButton:true });
    list.scrollTop = 0;
    return false;
}

function handleAvNotePickerPress(event) {
    const option = getAvNoteOptionFromEvent(event);
    if (option) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        selectAvNote(option.dataset.avNoteOption || '', option.dataset.avNotePrefix || '', event, { fromPressStart:true });
        return;
    }
    const input = event.target;
    if (!isAvNoteInput(input)) return;
    const prefix = String(input.id).replace(/av-note$/, '');
    if (!AV_NOTE_DROPDOWN_PREFIXES.includes(prefix)) return;
    openInlineAvNoteList(prefix);
}

// Same-account, unexpired SDK cache only; inventory/display-name hints are not credentials.
function readCachedNativeBootSession() {
    if (hasExplicitLogoutMarker() || !NATIVE_AUTH_ENABLED) return null;
    try {
        const session = JSON.parse(localStorage.getItem('gnc_supabase_auth_v1') || 'null');
        if (!session?.user?.id || !session.access_token || session.access_token.split('.').length !== 3) return null;
        const encoded = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
        if (claims.sub !== session.user.id || claims.iss !== SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1'
            || claims.aud !== 'authenticated' || !(Number(claims.exp) * 1000 > Date.now())
            || session.expires_at && !(Number(session.expires_at) * 1000 > Date.now())) return null;
        const profile = readCachedNativeAuthProfile(session.user.id);
        if (!profile?.username || profile.active === false || profile.disabled_at || profile.must_change_password
            || profile.locked_until && Date.parse(profile.locked_until) > Date.now()
            || nativeAuthSessionUserId && nativeAuthSessionUserId !== session.user.id
            || nativeAuthProfile?.id && nativeAuthProfile.id !== session.user.id) return null;
        return {session,profile};
    } catch (_) { globalThis.reportHandledRuntimeIssue?.('cached-native-boot', 'CACHED_SESSION_UNREADABLE'); return null; }
}

function getDriveExcelHeaderFields() { return [['salesyear','Year'],['season','Season'],['lotcode','Lot'],['contsize','Size'],['holdstopcode','Hold']]; }
function mountDriveExcelHeaderFilters() {
    ensureDriveToolbarControls();
    const state=getInventoryExcelState('drive'),popup=getInventoryExcelPopoverHost('drive');
    if(popup && !popup.hidden && state.open){state.open.options=getInventoryExcelOptions(state,state.open.field);paintInventoryExcelOptions('drive');}
}
function getDriveExcelFacetRows(rows,field) {
    const plant=buildDrivePlantFilterState(rows).filteredItems;
    const columns=applyDriveColumnFiltersToItems(plant);
    return applyDriveQuickFiltersToItems(columns,'excel-facet:'+field+':'+getInventoryExcelState('drive').revision+':'+driveBaseFilterCacheKey+':'+drivePlantFilterStateCacheKey+':'+buildDriveColumnFilterStateKey());
}
function getInventoryExcelPopoverHost(scope,create=false) {
    if(scope!=='drive')return getInventoryExcelHost(scope)?.querySelector('[data-excel-popover]');
    let host=document.getElementById('drive-excel-popover');
    if(!host && create){
        host=document.createElement('div');host.id='drive-excel-popover';host.dataset.excelPopover='';host.hidden=true;
        if(typeof host.showPopover==='function')host.setAttribute('popover','auto');
        document.body.appendChild(host);
        // One owner; scrolling lists never causes filtering or a full render.
        document.addEventListener('pointerdown',event=>{if(!host.hidden && !host.contains(event.target) && !host.anchor?.contains(event.target))closeInventoryExcelPopover('drive');},{passive:true});
        document.addEventListener('keydown',event=>{if(event.key==='Escape')closeInventoryExcelPopover('drive');});
        window.addEventListener('scroll',event=>{if(!host.hidden && !host.contains(event.target)){const rect=host.anchor?.getBoundingClientRect?.();if(!rect || Math.abs(rect.left-host.anchorLeft)>1 || Math.abs(rect.top-host.anchorTop)>1)closeInventoryExcelPopover('drive');}},{capture:true,passive:true});
        window.addEventListener('resize',()=>{if(!host.hidden)positionDriveExcelPopover(host,host.anchor);},{passive:true});
    }
    return host;
}
function positionDriveExcelPopover(host,anchor) {
    const rect=anchor?.getBoundingClientRect?.() || {left:8,bottom:100},width=Math.min(340,window.innerWidth-16);
    host.anchor=anchor;host.anchorLeft=rect.left;host.anchorTop=rect.top;host.style.width=width+'px';host.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+'px';
    host.style.top=Math.max(8,Math.min(rect.bottom+6,window.innerHeight-180))+'px';
    host.hidden=false;if(typeof host.showPopover==='function' && !host.matches(':popover-open'))host.showPopover();
}
function closeInventoryExcelPopover(scope) {
    const host=getInventoryExcelPopoverHost(scope);if(!host)return false;
    if(scope==='drive'){if(typeof host.hidePopover==='function' && host.matches(':popover-open'))host.hidePopover();host.hidden=true;host.anchor=null;}
    host.replaceChildren();return false;
}

function syncDriveAdvancedFilterPopover(details) {
    const filtersBtn=document.getElementById('drive-filters-btn');filtersBtn?.setAttribute('aria-expanded',String(details.open));
    const panel=details.querySelector('.mobile-browse-filter-panel');if(!panel || typeof panel.showPopover!=='function')return;
    if(!panel.hasAttribute('popover')){
        panel.setAttribute('popover','auto');
        panel.addEventListener('toggle',event=>{if(event.newState==='closed')details.open=false;});
    }
    if(!details.open){if(panel.matches(':popover-open'))panel.hidePopover();return;}
    closeInventoryExcelPopover('drive');
    const rect=(filtersBtn || details).getBoundingClientRect(),width=Math.min(640,window.innerWidth-16);
    Object.assign(panel.style,{position:'fixed',inset:'auto',margin:'0',left:Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8))+'px',top:(rect.bottom+6)+'px',width:width+'px'});
    if(!panel.matches(':popover-open'))panel.showPopover();
}
