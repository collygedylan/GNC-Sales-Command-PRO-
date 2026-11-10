// Declaration-only classic fragment. The normal authenticated shell owns initialization.
function getAppUpdateWorkOwner() {
    const read = task => { try { return task(); } catch { return null; } };
    const username = String(read(() => currentUser) || '').trim().toLowerCase();
    const subject = String(read(() => nativeAuthProfile?.id) || '').trim();
    const verified = !!username && (read(() => nativeAuthSessionActive === true && subject && nativeAuthSessionUserId === subject)
        || !!read(() => getCurrentAppSessionToken()));
    return { username, subject, verified, guest: !username && !subject };
}

function getAppUpdateWorkRuntime() {
    return window.__agdataUpdateWorkRuntime ||= { revision:0, pendingFlush:null, installed:false, restoring:null,
        receipt:null, editedControls:new Map(), restored:new Set(), restoreAttempts:new Map() };
}

function initializeAppUpdateWorkState() {
    const state = getAppUpdateWorkRuntime();
    if (state.installed) return;
    state.installed = true;
    const changed = event => {
        if (state.restoring && event.isTrusted === false) return;
        state.revision += 1;
        if(state.receipt)cancelAppUpdateSnapshotReload(state.receipt);
        state.restoreWatch?.disconnect();state.restoreWatch=null;
        const input = event.target;
        if (input && ['INPUT','SELECT','TEXTAREA'].includes(input.tagName) && input.type !== 'password' && input.type !== 'file') {
            state.editedControls.set(input, { revision:state.revision, owner:getAppUpdateWorkOwner(),
                row:typeof activeItem === 'undefined' ? '' : String(activeItem?.UNIQUE_ID || activeItem?.unique_id || ''),
                value:input.value, checked:input.checked });
        }
    };
    ['input','change','pointerdown','keydown','wheel','touchmove'].forEach(type => document.addEventListener(type, changed, {capture:true,passive:true}));
}

function isAppUpdateElementVisible(element) {
    for (let node=element;node && node.nodeType === 1;node=node.parentElement) {
        if (node.hidden || node.classList?.contains('hidden') || node.style?.display === 'none') return false;
    }
    return !!element && element.isConnected !== false;
}

function hasUnsupportedAppUpdateModalDraft() {
    const checkpointed = '#request-rep-modal,#bloom-picker-modal,#argos-inventory-transaction-modal';
    const browseFilters = '#drive-quick-filters-modal,#drive-column-filter-window,#av-column-filter-window';
    return [...document.querySelectorAll('[role="dialog"], [id$="-modal"]')].some(modal =>
        isAppUpdateElementVisible(modal) && !modal.closest(`${checkpointed},${browseFilters}`)
        && [...modal.querySelectorAll('input:not([type="hidden"]),textarea,select,[contenteditable="true"]')]
            .some(input => !input.disabled && input.type !== 'button' && input.type !== 'submit'));
}

function getAppUpdateBusyState() {
    const read = task => { try { return task(); } catch { return false; } }, reasons=[];
    const add=(reason,value)=>{if(value)reasons.push(reason);};
    add('camera',read(()=>window.isCameraCaptureProtected?.()));
    add('photo-upload',read(()=>pendingPhotoUploads.size)
        || read(()=>[...drivePhotoAttachments.values()].some(job=>job.running && isCurrentDrivePhotoAttachment(job))));
    add('photo-persistence',read(()=>Object.keys(pendingPhotoPersistTimers).length) || read(()=>Object.keys(pendingSharedPhotoMasterPersistTimers).length));
    add('row-save',read(()=>[...rowSaveCoordinatorState.values()].some(value=>value.running || value.pending)));
    add('suspend-save',read(()=>suspendTagRowWrites.size) || read(()=>dockSuspendCompletionInFlight.size));
    add('inventory-save',read(()=>inventoryStatusPendingSaves.size) || read(()=>driveEvidenceAbortControllers.size));
    add('field-save',read(()=>pendingFieldSaveCount > 0) || read(()=>!!autoSaveTimer));
    add('request-submit',read(()=>requestSubmitInFlight) || read(()=>pendingRequestArchiveFlushInFlight));
    add('eval-work-editor',read(()=>!!activeEvalWorkDetailId && isAppUpdateElementVisible(document.getElementById('argos-inventory-transaction-modal'))));
    add('reclass-submit',read(()=>argosInventoryTransactionState?.submitting || argosInventoryTransactionState?.pendingReclassMove));
    add('network-write',read(()=>window.GncLiveUpdateNetwork?.pendingWrites > 0));
    add('update-flush',read(()=>getAppUpdateWorkRuntime().pendingFlush));
    add('restore',read(()=>getAppUpdateWorkRuntime().restoring));
    add('restore-pending',read(()=>{const pending=readCommittedAppUpdateSnapshot();return pending && getAppUpdateWorkRuntime().receipt?.snapshotId!==pending.snapshotId;}));
    add('voice-recording',read(()=>chatVoiceRecordingActive || chatVoiceUploadInFlight));
    const owner=getAppUpdateWorkOwner();
    add('session-restoring',!owner.guest && !owner.verified);
    add('login-draft',owner.guest && read(()=>[...document.querySelectorAll('#view-login input, #login-screen input')].some(input=>String(input.value || '').length)));
    add('unsupported-modal-draft',read(hasUnsupportedAppUpdateModalDraft));
    add('unpersisted-file',read(()=>[...document.querySelectorAll('input[type="file"]')].some(input=>input.files?.length)));
    return { busy:reasons.length>0,reasons,pendingPhotos:reasons.some(reason=>reason.includes('photo') || reason==='unpersisted-file'),
        pendingWrites:reasons.some(reason=>/save|submit|persistence|write|flush/.test(reason)) };
}

function prepareAppUpdateTap() {
    const state = getAppUpdateWorkRuntime();
    if (state.restoring) return;
    const pending = readCommittedAppUpdateSnapshot();
    if (pending && pending.snapshotId !== state.receipt?.snapshotId) expireAppUpdateRestore();
}

function encodeAppUpdateWorkValue(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
        if (/^blob:/i.test(value.trim())) throw Error('unpersisted-blob-url');
        return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if(!Number.isFinite(value))throw Error('unsupported-number');return value; }
    if (typeof value === 'undefined') return {__agdataUpdateType:'Undefined'};
    if (typeof value !== 'object') throw Error('unsupported-draft-value');
    if (typeof Blob !== 'undefined' && value instanceof Blob || value.nodeType || typeof value.then === 'function') throw Error('unpersisted-draft-object');
    if (seen.has(value)) throw Error('cyclic-draft');
    seen.add(value);
    let result;
    if(value instanceof Map)result={__agdataUpdateType:'Map',value:[...value].map(([key,item])=>[encodeAppUpdateWorkValue(key,seen),encodeAppUpdateWorkValue(item,seen)])};
    else if(value instanceof Set)result={__agdataUpdateType:'Set',value:[...value].map(item=>encodeAppUpdateWorkValue(item,seen))};
    else if(value instanceof Date)result={__agdataUpdateType:'Date',value:value.toISOString()};
    else if(Array.isArray(value))result=value.map(item=>encodeAppUpdateWorkValue(item,seen));
    else {
        if(Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)throw Error('unsupported-draft-object');
        result={};
        for(const [key,item]of Object.entries(value)) {
            if(['__proto__','prototype','constructor','__agdataUpdateType'].includes(key))throw Error('unsupported-draft-key');
            if(/^(password|access_token|refresh_token|currentAppSessionToken)$/i.test(key))throw Error('credential-in-draft');
            result[key]=encodeAppUpdateWorkValue(item,seen);
        }
    }
    seen.delete(value);return result;
}

function decodeAppUpdateWorkValue(value) {
    if(!value || typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(decodeAppUpdateWorkValue);
    if(value.__agdataUpdateType==='Undefined')return undefined;
    if(value.__agdataUpdateType==='Map')return new Map(value.value.map(([key,item])=>[decodeAppUpdateWorkValue(key),decodeAppUpdateWorkValue(item)]));
    if(value.__agdataUpdateType==='Set')return new Set(value.value.map(decodeAppUpdateWorkValue));
    if(value.__agdataUpdateType==='Date')return new Date(value.value);
    const result={};for(const [key,item]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw Error('invalid-draft-key');result[key]=decodeAppUpdateWorkValue(item);}return result;
}

function getAppUpdateTabNonce(create = true) {
    const key='agdata_update_restore_tab_v1';let nonce=sessionStorage.getItem(key);
    if(!nonce && create){nonce=window.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);sessionStorage.setItem(key,nonce);if(sessionStorage.getItem(key)!==nonce)throw Error('tab-storage-unavailable');}
    return nonce || '';
}

function readCommittedAppUpdateSnapshot() {
    try {
        const nonce=getAppUpdateTabNonce(false),owner=getAppUpdateWorkOwner();if(!nonce || !owner.verified && !owner.guest)return null;
        const commit=JSON.parse(sessionStorage.getItem('agdata_update_restore_commit_v1') || 'null');
        const envelope=JSON.parse(localStorage.getItem('agdata_update_restore_v1:'+nonce) || localStorage.getItem('agdata_update_restore_v1') || 'null');
        const age=Date.now()-Number(envelope?.createdAt);
        if(!envelope || envelope.schema!==1 || age<0 || age>=30*60_000 || !Number.isFinite(age)
            || envelope.tabNonce!==nonce || envelope.owner?.username!==owner.username || envelope.owner?.subject!==owner.subject
            || commit?.snapshotId!==envelope.snapshotId || commit?.tabNonce!==nonce || commit?.targetVersion!==envelope.targetVersion
            || getAppUpdateWorkRuntime().restored.has(envelope.snapshotId))return null;
        return envelope;
    }catch{return null;}
}

function commitAppUpdateSnapshotForReload(receipt) {
    if(!isAppUpdateSnapshotCurrent(receipt) || getAppUpdateBusyState().busy)return false;
    try {
        const envelope=JSON.parse(localStorage.getItem('agdata_update_restore_v1:'+receipt.tabNonce) || 'null');
        if(envelope?.snapshotId!==receipt.snapshotId)return false;
        const marker=JSON.stringify({snapshotId:receipt.snapshotId,tabNonce:receipt.tabNonce,targetVersion:envelope.targetVersion,committedAt:Date.now()});
        sessionStorage.setItem('agdata_update_restore_commit_v1',marker);
        return sessionStorage.getItem('agdata_update_restore_commit_v1')===marker && isAppUpdateSnapshotCurrent(receipt);
    }catch{return false;}
}

function cancelAppUpdateSnapshotReload(receipt) {
    try {const marker=JSON.parse(sessionStorage.getItem('agdata_update_restore_commit_v1') || 'null');
        if(marker?.snapshotId===receipt?.snapshotId && marker?.tabNonce===receipt?.tabNonce)sessionStorage.removeItem('agdata_update_restore_commit_v1');
    }catch{}
}

function isAppUpdateRestoreReleaseReady(envelope) {
    const normalize=value=>String(value || '').trim().replace(/^v/i,'');
    let current=window.__APP_SHELL_VERSION__;try{if(typeof APP_VERSION!=='undefined')current=APP_VERSION;}catch{}
    return !!envelope.targetVersion && normalize(current)===normalize(envelope.targetVersion);
}

function persistAppUpdateDetailDraft(saved) {
    if(!saved.detail || typeof rowEvaluationDraftKey!=='function')return;
    const row=saved.detail.row,prefix=saved.detail.prefix,key=rowEvaluationDraftKey(row,prefix);
    const fields=(saved.roots.find(root=>root.id==='view-detail')?.controls || []).filter(field=>field.id.startsWith(prefix) && /(?:spec|caliper|match|av-note|pick|comments)$/.test(field.id));
    if(!key || !fields.length)return;
    const values={...readRowEvaluationDraft(row,prefix),...Object.fromEntries(fields.map(field=>[field.id,field.value]))};
    const json=JSON.stringify(values);localStorage.setItem(key,json);if(localStorage.getItem(key)!==json)throw Error('detail-draft-unverified');
    if(typeof getSuspendTagFormDraftKey==='function' && typeof suspendTagFormDrafts!=='undefined') {
        const suspendKey=getSuspendTagFormDraftKey(row);if(suspendKey)suspendTagFormDrafts.set(suspendKey,values);
    }
}

function applyAppUpdateRestoredControls(saved) {
    let complete=true;
    for(const root of saved.roots){const element=document.getElementById(root.id);complete=restoreAppUpdateControls(element,root.controls)&&complete;
        for(const scroll of root.scrolls){const node=document.getElementById(scroll.id);if(node){node.scrollTop=scroll.top;node.scrollLeft=scroll.left;}}}
    setMainAreaScrollTop(saved.scroll);window.scrollTo?.(saved.windowScroll?.x || 0,saved.windowScroll?.y || 0);
    return complete;
}

function finishAppUpdateRestore(envelope,saved,same) {
    if(!same() || !applyAppUpdateRestoredControls(saved))return false;
    const state=getAppUpdateWorkRuntime();state.restored.add(envelope.snapshotId);
    localStorage.removeItem('agdata_update_restore_v1:'+envelope.tabNonce);
    const canonical=JSON.parse(localStorage.getItem('agdata_update_restore_v1') || 'null');
    if(canonical?.snapshotId===envelope.snapshotId && canonical?.tabNonce===envelope.tabNonce)localStorage.removeItem('agdata_update_restore_v1');
    cancelAppUpdateSnapshotReload(envelope);
    if(typeof showToast==='function')showToast('Updated to v'+String(envelope.targetVersion).replace(/^v/i,'')+' — your work was preserved.','',false);
    window.dispatchEvent(new Event('agdata:update-work-settled'));return true;
}

function watchAppUpdateRestoredControls(envelope,saved,same) {
    const state=getAppUpdateWorkRuntime();state.restoreWatch?.disconnect();
    if(typeof MutationObserver==='undefined')return;
    // Existing draft owners survive value-only hydration; observe replacement controls without rendering or dispatching input.
    const observer=new MutationObserver(()=>{
        if(!same() || Date.now()-envelope.createdAt>=30*60_000){observer.disconnect();if(state.restoreWatch===observer)state.restoreWatch=null;return;}
        if(state.restored.has(envelope.snapshotId))applyAppUpdateRestoredControls(saved);
        else {try{finishAppUpdateRestore(envelope,saved,same);}catch{}}
    });
    for(const root of saved.roots){const element=document.getElementById(root.id);if(element)observer.observe(element,{childList:true,subtree:true});}
    state.restoreWatch=observer;
}

function retryAppUpdateWorkRestore() {
    const envelope=readCommittedAppUpdateSnapshot(),state=getAppUpdateWorkRuntime();
    if(!envelope || state.restoring || state.restoreAttempts.has(envelope.snapshotId) && state.restoreAttempts.get(envelope.snapshotId)!==state.revision)return Promise.resolve(false);
    return restoreWorkStateAfterAppUpdate();
}

function captureAppUpdateControls(root) {
    if(!root)return [];
    return [...root.querySelectorAll('input,textarea,select,[contenteditable="true"]')].filter(input=>!['password','file','button','submit','reset'].includes(input.type)).map((input,index)=>{
        const row=input.closest?.('[data-reclass-row-card],[data-dom-id],[data-uid]');
        const fields=['name','data-reclass-field','data-reclass-temporary-field','data-reclass-move-action','data-action-field','data-uid','data-dom-id'];
        return {id:input.id || '',index,tag:input.tagName,type:input.type || '',attributes:Object.fromEntries(fields.map(name=>[name,input.getAttribute(name)]).filter(([,value])=>value!==null)),
            row:row?['data-reclass-row-card','data-dom-id','data-uid'].map(name=>[name,row.getAttribute(name)]).find(([,value])=>value!==null):null,
            value:input.isContentEditable?input.textContent:input.value,checked:input.checked,
            selected:input.multiple?[...input.selectedOptions].map(option=>option.value):null,
            selectionStart:typeof input.selectionStart==='number'?input.selectionStart:null,selectionEnd:typeof input.selectionEnd==='number'?input.selectionEnd:null};
    });
}

function restoreAppUpdateControls(root, controls) {
    if(!root || !isAppUpdateElementVisible(root))return false;
    const inputs=[...root.querySelectorAll('input,textarea,select,[contenteditable="true"]')].filter(input=>!['password','file','button','submit','reset'].includes(input.type));
    let complete=true;
    for(const saved of controls){
        const matches=input=>input && input.tagName===saved.tag && Object.entries(saved.attributes).every(([name,value])=>input.getAttribute(name)===value)
            && (!saved.row || input.closest?.('['+saved.row[0]+']')?.getAttribute(saved.row[0])===saved.row[1]);
        const input=saved.id?inputs.find(input=>input.id===saved.id):inputs.find(input=>matches(input) && (saved.row || saved.attributes.name || Object.keys(saved.attributes).length)) || inputs[saved.index];
        if(!matches(input)){complete=false;continue;}
        if(input.isContentEditable){if(input.textContent!==saved.value)input.textContent=saved.value;}else if(input.value!==saved.value)input.value=saved.value;
        if(typeof saved.checked==='boolean')input.checked=saved.checked;
        if(saved.selected)for(const option of input.options)option.selected=saved.selected.includes(option.value);
        if(saved.selectionStart!==null && typeof input.setSelectionRange==='function')try{input.setSelectionRange(saved.selectionStart,saved.selectionEnd);}catch{}
    }
    return complete;
}

function captureAppUpdateReportState() {
    return { activeHomeTab,activeManagerEvalReport2,managerEvalReport2Mode,managerEvalReport2DisplayMode,managerEvalReport2SeasonFilters,
        managerEvalReport2ContSizeFilter,managerEvalReport2AssignedToFilter,managerEvalReport2AssignedToFilters,managerEvalReport2LocationFilter,
        managerEvalReport2PriorityFilter,managerEvalReport2BrowseMode,managerEvalReport2DrillLevel,managerEvalReport2SelectedCommonName,
        managerEvalReport2SelectedContSize,managerEvalReport2SelectedBlockAlpha,managerEvalReport2SelectedBlockNumber,managerEvalReport2SelectedLocationCode,
        managerEvalReport2DrillScrollByKey,managerEvalReport2SelectedReportIds,managerEvalReport2DetailItemKey,managerEvalReport2DetailReturnScrollTop,managersSearchTerm,
        aggregate:window.__evalAggregateDashboard?.selected || '',
        audit:window.__fieldAuditState?Object.fromEntries(['modes','season','year','status','search','block','location','flat','sort','direction','page','varietiesOpen','allVarieties'].map(key=>[key,window.__fieldAuditState[key]])):null };
}

function restoreAppUpdateReportState(saved) {
    ({activeHomeTab,activeManagerEvalReport2,managerEvalReport2Mode,managerEvalReport2DisplayMode,managerEvalReport2SeasonFilters,
        managerEvalReport2ContSizeFilter,managerEvalReport2AssignedToFilter,managerEvalReport2AssignedToFilters,managerEvalReport2LocationFilter,
        managerEvalReport2PriorityFilter,managerEvalReport2BrowseMode,managerEvalReport2DrillLevel,managerEvalReport2SelectedCommonName,
        managerEvalReport2SelectedContSize,managerEvalReport2SelectedBlockAlpha,managerEvalReport2SelectedBlockNumber,managerEvalReport2SelectedLocationCode,
        managerEvalReport2DrillScrollByKey,managerEvalReport2SelectedReportIds,managerEvalReport2DetailItemKey,managerEvalReport2DetailReturnScrollTop,managersSearchTerm}=saved);
    if(typeof evalAggregateDashboardState==='function')evalAggregateDashboardState().selected=saved.aggregate;
    if(saved.audit && typeof fieldAuditState==='function')Object.assign(fieldAuditState(),saved.audit);
}

function getAppUpdateHeaderSearchRoot(view) {
    const id = GLOBAL_HEADER_SEARCH_CONFIG[view];
    return id ? document.getElementById(id) : null;
}

function captureAppUpdateWorkSnapshot() {
    const owner=getAppUpdateWorkOwner();
    if(!owner.verified && !owner.guest)throw Error('session-not-ready');
    if(owner.guest)return {owner,view:'login',roots:[],selection:[]};
    const view=getCurrentVisibleViewId(),visible=id=>isAppUpdateElementVisible(document.getElementById(id));
    const rootIds=[...new Set(['view-'+view,...['request-rep-modal','bloom-picker-modal','argos-inventory-transaction-modal'].filter(visible)])];
    const search = getAppUpdateHeaderSearchRoot(view);
    if (search && document.getElementById('global-header-search-slot')?.contains(search)) rootIds.push(search.id);
    const selection=[...new Set([...selectedItems,...driveQuickRequestItems])].map(domId=>{
        const row=findItemByDomId(domId);if(!row)throw Error('selection-not-ready');
        return {domId,uid:String(row.UNIQUE_ID || row.unique_id || ''),row,source:selectedItemSources.get(domId) || '',selected:selectedItems.has(domId),quick:driveQuickRequestItems.has(domId)};
    });
    let request=null;if(visible('request-rep-modal')){captureRequestQtyStepRenderedInputs();request={form:captureRequestSubmissionForm(),batchId:activeRequestSubmissionBatchId,
        steps:['step-1-rep','step-1.5-folder','step-2-cust','step-3-qty'].filter(visible)};}
    let bloom=null;if(visible('bloom-picker-modal'))bloom=collectBloomPickerOrderDraftState();
    const reclass=visible('argos-inventory-transaction-modal') && argosInventoryTransactionState ? {
        uid:argosInventoryTransactionState.uid,sourceView:argosInventoryTransactionState.sourceView,item:argosInventoryTransactionState.item,
        rows:(argosInventoryTransactionState.inquiryModel?.locationRows || []).map(row=>row.sourceRow).filter(Boolean),
        proposals:argosReclassMultiActionState,evalWorkId:activeEvalWorkDetailId,
        detailOrigin:typeof evalWorkActiveOriginUid==='undefined'?'':evalWorkActiveOriginUid,
        temporaryOverlays:typeof evalWorkTemporaryRowOverlays==='undefined'?null:evalWorkTemporaryRowOverlays,
        evidenceByOrigin:typeof evalWorkEvidenceByOrigin==='undefined'?null:evalWorkEvidenceByOrigin,
        activePhotos:typeof evalWorkActivePhotos==='undefined'?null:evalWorkActivePhotos,
        expanded:[...document.querySelectorAll('[data-reclass-row-card]')].filter(card=>card.querySelector('[data-reclass-row-hydrated="true"]')).map(card=>card.getAttribute('data-reclass-row-card'))}:null;
    return {owner,view,scroll:getMainAreaScrollTop(),windowScroll:{x:window.scrollX || 0,y:window.scrollY || 0},filters:captureAppFilterState(),history:viewHistoryStack.slice(-40),reports:captureAppUpdateReportState(),
        detail:view==='detail' && activeItem?{row:activeItem,uid:String(activeItem.UNIQUE_ID || activeItem.unique_id || ''),source:activeDetailSourceView || lastView,
            tab:activeDetailTab,lastView,returnState:detailReturnState,prefix:getDetailTabPrefix(activeDetailTab)}:null,
        selection,request,bloom,reclass,cartOpen:cartPanelOpen,
        drafts:{ncr:typeof ncrDraftState==='undefined'?null:ncrDraftState,hl:typeof hlOrderSelections==='undefined'?null:hlOrderSelections},
        roots:rootIds.map(id=>({id,controls:captureAppUpdateControls(document.getElementById(id)),scrolls:[...document.getElementById(id)?.querySelectorAll('[id]') || []].filter(node=>node.scrollTop || node.scrollLeft).map(node=>({id:node.id,top:node.scrollTop,left:node.scrollLeft}))}))};
}

function isAppUpdateSnapshotCurrent(receipt) {
    try {
        const state=getAppUpdateWorkRuntime(),owner=getAppUpdateWorkOwner();
        return receipt?.ok===true && state.receipt?.snapshotId===receipt.snapshotId && state.revision===receipt.revision
            && receipt.tabNonce===getAppUpdateTabNonce(false) && receipt.owner.username===owner.username && receipt.owner.subject===owner.subject
            && (owner.verified || owner.guest) && receipt.interactionKey===getAppUpdateInteractionKey();
    } catch {return false;}
}

function getAppUpdateInteractionKey() {
    const owner=getAppUpdateWorkOwner();if(owner.guest)return 'login';
    return JSON.stringify([getCurrentVisibleViewId(),navTransitionSeq,String(activeItem?.UNIQUE_ID || activeItem?.unique_id || ''),activeDetailTab,
        activeHomeTab,[...selectedItems],[...driveQuickRequestItems],['request-rep-modal','bloom-picker-modal','argos-inventory-transaction-modal'].map(id=>isAppUpdateElementVisible(document.getElementById(id)))]);
}

async function saveWorkStateBeforeAppUpdate(options = {}) {
    initializeAppUpdateWorkState();
    const state=getAppUpdateWorkRuntime(),busy=getAppUpdateBusyState();
    if(busy.busy)return {ok:false,reason:busy.reasons[0]};
    const owner=getAppUpdateWorkOwner(),revision=state.revision,interactionKey=getAppUpdateInteractionKey();
    let snapshot;
    try { snapshot=captureAppUpdateWorkSnapshot();encodeAppUpdateWorkValue(snapshot); }
    catch(error){return {ok:false,reason:error.message || 'snapshot-failed'};}
    // A bounded non-completion save is advisory. Timeout keeps the actual write owned and blocks reload.
    if(snapshot.detail?.prefix && typeof saveData==='function' && typeof canEditRowDetails==='function' && canEditRowDetails(snapshot.detail.prefix,activeItem)) {
        const flush=Promise.resolve().then(()=>saveData(false,snapshot.detail.prefix,true,activeItem));
        state.pendingFlush=flush;
        const settled=flush.then(()=>true,()=>true).finally(()=>{if(state.pendingFlush===flush)state.pendingFlush=null;window.dispatchEvent(new Event('agdata:update-work-settled'));});
        let timer;const finished=await Promise.race([settled,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),Math.min(1500,Math.max(1,Number(options.deadlineMs)||1500)));})]);clearTimeout(timer);
        if(!finished)return {ok:false,reason:'save-still-pending'};
        const current=getAppUpdateWorkOwner();
        if(current.username!==owner.username || current.subject!==owner.subject)return {ok:false,reason:'account-changed'};
        if(state.revision!==revision || interactionKey!==getAppUpdateInteractionKey()) {
            for(const[input,saved]of state.editedControls)if(saved.revision>revision && input.isConnected && saved.owner.username===current.username && saved.owner.subject===current.subject
                && saved.row===String(activeItem?.UNIQUE_ID || activeItem?.unique_id || '')){input.value=saved.value;if(typeof saved.checked==='boolean')input.checked=saved.checked;}
            return {ok:false,reason:'work-changed'};
        }
        // Retain raw text/caret from before normalization while collecting newly committed photo/state references.
        const refreshed=captureAppUpdateWorkSnapshot();refreshed.roots=snapshot.roots;snapshot=refreshed;
    }
    if(getAppUpdateBusyState().busy)return {ok:false,reason:'work-busy'};
    try {
        const tabNonce=getAppUpdateTabNonce(),snapshotId=window.crypto?.randomUUID?.() || tabNonce+':'+Date.now();
        const envelope={schema:1,snapshotId,tabNonce,revision,targetVersion:String(options.targetVersion || ''),createdAt:Date.now(),owner,
            work:encodeAppUpdateWorkValue(snapshot)};
        const json=JSON.stringify(envelope),key='agdata_update_restore_v1',backup=key+':'+tabNonce;
        localStorage.setItem(backup,json);if(localStorage.getItem(backup)!==json)throw Error('snapshot-backup-unverified');
        localStorage.setItem('agdata_update_restore_v1',JSON.stringify(envelope));if(localStorage.getItem(key)!==json)throw Error('snapshot-unverified');
        state.receipt={ok:true,snapshotId,revision,tabNonce,owner,view:snapshot.view,interactionKey};
        return state.receipt;
    }catch(error){state.receipt=null;return {ok:false,reason:error.message || 'storage-unavailable'};}
}

function expireAppUpdateRestore() {
    const state=getAppUpdateWorkRuntime();state.revision+=1;
    state.restoreWatch?.disconnect();state.restoreWatch=null;
    try {
        const nonce=getAppUpdateTabNonce(false),key='agdata_update_restore_v1';
        const canonical=localStorage.getItem(key),own=nonce && localStorage.getItem(key+':'+nonce);
        let envelope=null;try{envelope=JSON.parse(canonical || 'null');}catch{}
        const belongs=!envelope || envelope.tabNonce===nonce;
        const raw=own || (belongs ? canonical : null);
        // Retain draft bytes outside the automatic restore path; never erase another tab's work.
        if(raw){try{localStorage.setItem('agdata_update_recovery_v1:'+nonce,raw);}catch{window.reportHandledRuntimeIssue?.('app_update_restore','RECOVERY_BACKUP_UNAVAILABLE');}}
        if(belongs)localStorage.removeItem(key);
        if(nonce)localStorage.removeItem(key+':'+nonce);
        sessionStorage.removeItem('agdata_update_restore_commit_v1');
    } catch { window.reportHandledRuntimeIssue?.('app_update_restore','RESTORE_STORAGE_UNAVAILABLE'); }
}
