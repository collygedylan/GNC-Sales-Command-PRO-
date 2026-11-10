function resolveEvaluationProjectionTarget(row, source) {
    const indexed = resolveCanonicalInventoryTarget(row, masterInventoryById, masterInventoryByItemCode);
    if (indexed) return indexed;
    const linked = canonicalInventoryLinkedUid(row);
    const table = String(source?.SOURCE_TABLE || source?.source_table || 'ph_master_inventory');
    const uid = linked || (table === 'ph_master_inventory' ? canonicalInventoryRowUid(source) : '');
    if (!uid || masterInventoryById.has(uid) || !canonicalInventorySameLot(row, row)) return null;
    if (!linked && source && canonicalInventorySameLot(row, source, true)) return source;
    return buildMissingEvaluationMasterRow(row, uid);
}

function buildMissingEvaluationMasterRow(row, uid) {
    const master = {UNIQUE_ID:uid,unique_id:uid,SOURCE_TABLE:'ph_master_inventory',source_table:'ph_master_inventory'};
    for (const key of ['ITEMCODE','LOCATIONCODE','LOTCODE','SEASON','SALEYEAR','PRIORITY','COMMONNAME','CONTSIZE',
        'DESIGITEM','DESIGCUST','DESIGLOC','PTRONHAND','PTRREVIEWED','PTRAVAILABLE','S_LTS']) {
        const value = row[key] ?? row[key.toLowerCase()];
        if (value != null) master[key] = master[key.toLowerCase()] = value;
    }
    return master;
}

function setProjectedEvaluationAliases(evidence, keys, value) {
    if (value == null || !String(value).trim() || String(value).trim() === '-') return;
    for (const key of keys) evidence[key] = evidence[key.toLowerCase()] = value;
}

function buildEvaluationProjectionFields(target, patch) {
    const evidence = {};
    const set = (keys,value) => setProjectedEvaluationAliases(evidence,keys,value);
    set(['SPEC'],patch.spec ?? patch.req_spec ?? patch.dock_spec);
    set(['CALIPER'],patch.caliper ?? patch.req_caliper ?? patch.dock_caliper);
    if (patch.explicit_av_note === true && Object.hasOwn(patch,'av_note')) evidence.AV_NOTE=evidence.av_note=String(patch.av_note ?? '');
    else set(['AV_NOTE'],patch.av_note);
    set(['PIC_NOTE','PICK_NOTE','PICK'],patch.pic_note ?? patch.pick_note ?? patch.req_pic_note);
    set(['SALES_NOTE','COMMENTS'],patch.sales_note ?? patch.comments ?? patch.req_comments);
    const match = patch.match ?? patch.match_pct ?? patch.req_match ?? patch.loc_match_pct;
    set(['MATCH','MATCH_PCT','LOC_MATCH_PCT'],match);
    set(['LOC_MATCH_QTY','LOC_PHOTO_MATCH'],getEditorLocMatchQtyValue(target,match) ?? patch.loc_match_qty);
    const clear = patch.force_clear_photos === true;
    const incoming = patch.photo_link ?? patch.req_photo_link ?? patch.dock_photo_link ?? getPhotoUrlList(patch.photos || []).join(',');
    const photos = clear ? String(incoming) : mergePhotoCsvList([target.PHOTO_LINK,target.photo_link,target.SAVED_PHOTO_LINK,incoming]);
    if (photos || clear) setProjectedEvaluationPhotos(evidence,target,patch,photos);
    set(['PHOTO_NAME','SAVED_PHOTO_NAME'],patch.photo_name ?? patch.req_photo_name ?? patch.dock_photo_name);
    set(['PHOTO_DATE'],patch.photo_date);
    return evidence;
}

function setProjectedEvaluationPhotos(evidence, target, patch, photos) {
    const urls = getPhotoUrlList(photos);
    const metadata = [patch.photos,target.photos,target.PHOTOS].filter(Array.isArray).flat();
    evidence.PHOTO_LINK = evidence.photo_link = evidence.SAVED_PHOTO_LINK = evidence.saved_photo_link = photos;
    evidence.PHOTO_URL = evidence.photo_url = urls[0] || '';
    evidence.photos = evidence.PHOTOS = urls.map(url => metadata.find(entry => typeof entry === 'object' && getPhotoUrlList([entry]).includes(url)) || url);
}

function buildEvaluationMirrorFields(evidence, kind) {
    const fields = {...evidence};
    const prefix = kind === 'flyer' ? 'FLYER' : 'REQ';
    const aliases = {SPEC:'SPEC',CALIPER:'CALIPER',MATCH:'MATCH',AV_NOTE:'AV_NOTE',PICK:'PICK',COMMENTS:'COMMENTS',
        LOC_MATCH_QTY:'LOC_MATCH_QTY',PHOTO_LINK:'PHOTO_LINK',PHOTO_NAME:'PHOTO_NAME'};
    for (const [key,suffix] of Object.entries(aliases)) {
        if (!Object.hasOwn(evidence,key)) continue;
        const alias = `${prefix}_${suffix}`;
        fields[alias] = fields[alias.toLowerCase()] = evidence[key];
        if (kind === 'flyer') continue;
        fields[`REQUEST_${suffix}`] = fields[`request_${suffix.toLowerCase()}`] = evidence[key];
        if (kind === 'suspend') fields[`DOCK_${suffix}`] = fields[`dock_${suffix.toLowerCase()}`] = evidence[key];
    }
    return fields;
}

function snapshotEvaluationFields(row, patch) {
    return Object.keys(patch).map(key => [key,Object.hasOwn(row,key),row[key],patch[key]]);
}

function restoreEvaluationFields(row, fields) {
    for (const [key,existed,value,written] of fields) {
        if (row[key] !== written) continue;
        if (existed) row[key]=value;
        else delete row[key];
    }
}

function collectEvaluationProjectionRows(target, context) {
    const {source,suspendUid,uploadRows = []} = context;
    const uid = canonicalInventoryRowUid(target);
    const match = row => {
        const linked = canonicalInventoryLinkedUid(row);
        if (linked) return linked === uid && canonicalInventorySameLot(row,target,true);
        return resolveCanonicalInventoryTarget(row,masterInventoryById,masterInventoryByItemCode) === target;
    };
    const state = getManagerAssignedColumnState();
    const exactMaster = row => canonicalInventoryRowUid(row) === uid && canonicalInventorySameLot(row,target,true);
    const groups = [[new Set([target,masterInventoryById.get(uid),...(state.fullInventory || []),...fullInventory,
        ...(typeof avOpenInventory === 'undefined' ? [] : avOpenInventory)].filter(exactMaster)),'master']];
    const requests = typeof requestsInventory === 'undefined' ? [] : requestsInventory;
    const suspend = typeof suspendTagInventory === 'undefined' ? [] : suspendTagInventory;
    if (suspendUid) groups.push([collectEvaluationSuspendRows(suspendUid,[source,...uploadRows,...requests,...suspend]),'tag']);
    groups.push([suspend.filter(match),'suspend'],[requests.filter(match),'request']);
    if (typeof flyerFolderInventory !== 'undefined') groups.push([flyerFolderInventory.filter(match),'flyer']);
    if (source && source !== target && match(source)) groups.push([[source],context.prefix === 'flyer-' ? 'flyer' : 'source']);
    return groups;
}

function collectEvaluationSuspendRows(uid, rows) {
    const soc = typeof socInventory === 'undefined' ? [] : socInventory;
    const raw = typeof socRawSourceRows === 'undefined' ? [] : socRawSourceRows;
    return [...rows,...soc,...raw].filter(row => row && getDockSuspendDcRequestSourceUid(row) === uid);
}

function syncEvaluationProjectionNotes(target, owner, state, scope) {
    if (state.noteScope !== scope) state.locationSalesNotes = new Map();
    state.noteScope = scope;
    const notes = state.locationSalesNotes ||= new Map(), code = getRequestItemCodeOptionItemCode(target);
    const rows = notes.get(code) || [], uid = canonicalInventoryRowUid(target);
    let note = rows.find(row => (canonicalInventoryLinkedUid(row) || canonicalInventoryRowUid(row)) === uid && canonicalInventorySameLot(row,target,true));
    if (!note) {
        note = {...target,unique_id:uid};
        notes.set(code,rows.concat(note));
        owner.cleanups.push(() => removeProjectedEvaluationNote(state,notes,code,note));
    }
    writeEvaluationProjectionRow(owner,note,{...owner.evidence,__pendingEvaluationOwner:owner.token});
}

function removeProjectedEvaluationNote(state, notes, code, note) {
    if (state.locationSalesNotes === notes && notes.get(code)?.includes(note)) notes.set(code,notes.get(code).filter(row => row !== note));
}

function confirmEvaluationProjection(result, uid, rollback, onConfirmed, scope) {
    if (scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    if (result?.noOp === true) rollback.commit?.();
    if (result?.canonicalConfirmed !== true || canonicalInventoryRowUid(result.row) !== uid) return;
    rollback.commit?.();
    onConfirmed?.();
}

function writeEvaluationProjectionRow(owner, row, evidence) {
    const prior = owner.rows.get(row);
    if (prior && !owner.rebasing) return;
    const next = snapshotEvaluationFields(row,evidence);
    if (prior) retainUnchangedEvaluationBaseline(prior,next);
    owner.rows.set(row,next);
    Object.assign(row,evidence);
}

function retainUnchangedEvaluationBaseline(prior, next) {
    const priorByKey = new Map(prior.map(field => [field[0],field]));
    for (const field of next) {
        const previous = priorByKey.get(field[0]);
        if (!previous || field[2] !== previous[3]) continue;
        field[1]=previous[1];
        field[2]=previous[2];
    }
}

function refreshEvaluationProjectionViews(state) {
    invalidateResolvedViewStateCaches();
    state.photoGeneration = (state.photoGeneration || 0) + 1;
    for (const view of ['drive','av','request','docks','tasks']) markViewDirty(view);
}

function upsertEvaluationProjectionMaster(target, owner) {
    if (fullInventory.some(row => canonicalInventoryRowUid(row) === canonicalInventoryRowUid(target))) return;
    fullInventory.push(target);
    rebuildMasterInventoryIndexes();
    owner.cleanups.push(() => {
        const index = fullInventory.indexOf(target);
        if (index < 0) return;
        fullInventory.splice(index,1);
        rebuildMasterInventoryIndexes();
    });
}

function projectEvaluationOwner(owner) {
    const {target,context,evidence,state,scope} = owner;
    upsertEvaluationProjectionMaster(target,owner);
    for (const [rows,kind] of collectEvaluationProjectionRows(target,context)) {
        const fields = ['master','source'].includes(kind) ? evidence : buildEvaluationMirrorFields(evidence,kind === 'tag' ? 'suspend' : kind);
        if (kind === 'tag') fields.DOCK_NOTE=fields.dock_note=context.dockNote;
        for (const row of rows) writeEvaluationProjectionRow(owner,row,fields);
    }
    syncEvaluationProjectionNotes(target,owner,state,scope);
    state.fullInventory = fullInventory;
    refreshEvaluationProjectionViews(state);
}

function rollbackEvaluationOwner(owner) {
    owner.failed = true;
    const {state,scope,uid,owners,prior} = owner;
    if (scope !== getSupabaseReadIdentityScope() || owners.get(uid) !== owner) return;
    for (const [row,fields] of owner.rows) restoreEvaluationFields(row,fields);
    for (const cleanup of owner.cleanups) cleanup();
    if (prior && !prior.confirmed) owners.set(uid,prior);
    else {
        owners.delete(uid);
        if (prior) clearEvaluationNoteOwner(prior);
    }
    if (prior?.failed) rollbackEvaluationOwner(prior);
    refreshEvaluationProjectionViews(state);
}

function beginRowEvaluationMemoryPublication(target, input, scope, context = {}) {
    const uid = canonicalInventoryRowUid(target);
    if (!uid || scope !== getSupabaseReadIdentityScope()) return () => {};
    const state = getManagerAssignedColumnState(), owners = state.rowEvaluationMemoryOwners ||= new Map();
    const patch = input || {};
    const owner = {target,uid,state,scope,owners,prior:owners.get(uid),rows:new Map(),cleanups:[],
        context,patch,token:Symbol(uid),evidence:buildEvaluationProjectionFields(target,patch)};
    owners.set(uid,owner);
    projectEvaluationOwner(owner);
    const rollback = () => rollbackEvaluationOwner(owner);
    rollback.isCurrent = () => owners.get(uid) === owner && scope === getSupabaseReadIdentityScope();
    rollback.commit = () => {
        owner.confirmed = true;
        if (!rollback.isCurrent()) return;
        owners.delete(uid);
        clearEvaluationNoteOwner(owner);
    };
    return rollback;
}

function clearEvaluationNoteOwner(owner) {
    for (const row of owner.rows.keys()) if (row.__pendingEvaluationOwner === owner.token) delete row.__pendingEvaluationOwner;
}

function reapplyPendingEvaluationProjection(uid, state, scope) {
    const owner = state.rowEvaluationMemoryOwners?.get(uid);
    if (!owner || owner.scope !== scope || owner.failed) return;
    owner.evidence = buildEvaluationProjectionFields(owner.target,owner.patch);
    owner.rebasing = true;
    projectEvaluationOwner(owner);
    owner.rebasing = false;
}

function startEvaluationRequestRemoval(uid) {
    const removed = requestsInventory.filter(item => canonicalInventoryRowUid(item) === uid);
    requestsInventory=requestsInventory.filter(item => canonicalInventoryRowUid(item) !== uid);
    trackOptimisticCompletedRows([uid]);
    refreshRealtimeDetailLookupIndexes(ACTIVE_REQUEST_TABLE);
    updateFooterRequestBadge();
    return () => {
        clearOptimisticCompletedRows([uid]);
        if (!requestsInventory.some(item => canonicalInventoryRowUid(item) === uid)) {
            requestsInventory.push(...removed.filter(item => !hasConfirmedRequestCompletion(item)));
        }
        refreshRealtimeDetailLookupIndexes(ACTIVE_REQUEST_TABLE);
        updateFooterRequestBadge();
        refreshLocalRequestViewState('request-complete-retry',{forceRender:true,preferImmediate:true,userAction:true});
    };
}

function backUpConfirmedEvaluationDraft(row, source, isRequest) {
    const requestDraft = isRequest ? createRequestWorkDraft(row,{
        req_spec:row.REQ_SPEC,req_caliper:row.REQ_CALIPER,req_match:row.REQ_MATCH,
        req_pic_note:row.REQ_PICK,req_comments:row.REQ_COMMENTS,av_note:row.AV_NOTE,
        req_photo_link:row.REQ_PHOTO_LINK,req_photo_name:row.REQ_PHOTO_NAME
    },getRequestWorkValuesFromRow(source),true) : null;
    backupLocalItem(row,requestDraft);
}

function beginConfirmedRowEvaluationUi(snapshot) {
    const {row,source,prefix,scope,isSuspend,payload,uploadRows} = snapshot;
    if (scope !== getSupabaseReadIdentityScope()) return {settled:true,confirmed:false,rollback() {}};
    const uid = canonicalInventoryRowUid(row);
    const target = resolveEvaluationProjectionTarget(row,source);
    const suspendUid = isSuspend ? getDockSuspendDcRequestSourceUid(source) : '';
    const dockNote = suspendUid ? buildDockSuspendDcRequestNote(snapshot.values,source.DOCK_NOTE || '') : '';
    const undoEvidence = beginRowEvaluationMemoryPublication(target,payload,scope,{source,prefix,suspendUid,dockNote,uploadRows});
    const undoCompletion = target ? beginOptimisticCompletedRow(target,prefix,{...payload}) : null;
    const isRequest = prefix === 'req-' && !isSuspend;
    const undoRemoval = isRequest ? startEvaluationRequestRemoval(uid) : null;
    const state = createConfirmedEvaluationUiState({scope,undoEvidence,undoCompletion,undoRemoval});
    backUpConfirmedEvaluationDraft(row,source,isRequest);
    returnFromConfirmedEvaluationDetail(snapshot);
    if (isRequest || isSuspend) refreshLocalRequestViewState('row-completion-pending',{forceRender:true,preferImmediate:true,userAction:true});
    showToast('Saving','Your work is saving in the background.');
    return state;
}

function createConfirmedEvaluationUiState({scope,undoEvidence,undoCompletion,undoRemoval}) {
    let evidenceRolledBack = false, completionRolledBack = false;
    const state = {settled:false,confirmed:false};
    state.rollbackCompletion = () => {
        if (completionRolledBack || state.confirmed || scope !== getSupabaseReadIdentityScope() || undoEvidence.isCurrent?.() === false) return;
        completionRolledBack=true;
        undoCompletion?.();
    };
    state.rollbackEvidence = () => {
        if (evidenceRolledBack || state.confirmed) return;
        state.rollbackCompletion();
        evidenceRolledBack=true;
        undoEvidence();
    };
    state.commit = () => {
        state.confirmed=true;
        state.settled=true;
        undoEvidence.commit?.();
    };
    state.rollback = () => {
        if (state.settled) return;
        state.settled=true;
        state.rollbackEvidence();
        if (scope === getSupabaseReadIdentityScope()) undoRemoval?.();
    };
    return state;
}

async function publishSeasonSalesOfficeEvaluation(item, patch, options) {
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

async function publishRequestWorkEvaluation(item, patch, options) {
    const scope = options.scope || getSupabaseReadIdentityScope();
    const target = findLinkedMasterRow(item);
    const evidence = target ? buildRequestMasterUpdatePayloadFromSave(item, patch, target) : null;
    if (evidence && patch?.explicit_av_note === true) { evidence.explicit_av_note = true; evidence.av_note = String(patch.av_note ?? ''); }
    const rollback = options.memoryRollback || beginRowEvaluationMemoryPublication(target, evidence, scope);
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
        if (completedReceipt || photoReceipt) rollback.commit?.();
        reconcileRequestPublicationMaster({ result, saved, item, target, options, completedReceipt, photoReceipt, scope, rollback });
        return outcome;
    } catch (error) {
        if (completedReceipt || photoReceipt) {
            // The exact Request completion/photo is durable; only its local inventory projection is deferred.
            reportDeferredRequestPublication(error, photoReceipt);
            queueVisibleDatasetCatchup(0);
            return outcome;
        }
        rollback(); throw error;
    }
}

function reconcileRequestPublicationMaster({ result, saved, item, target, options, completedReceipt, photoReceipt, scope, rollback }) {
    const expected = String(saved.master_id || item.MASTER_ID || item.master_id || target?.UNIQUE_ID || target?.unique_id || '');
    if (result.master_row) {
        if (!expected || String(result.master_row.unique_id) !== expected) throw new Error('REQUEST_MASTER_RECEIPT_MISMATCH');
        if (photoReceipt && !parsePhotoCsvValues(result.master_row.photo_link).includes(options.photoAttachmentUrl)) throw new Error('REQUEST_MASTER_PHOTO_RECEIPT_UNCONFIRMED');
        if (!completedReceipt && !photoReceipt) options.onConfirmed?.(result);
        rollback.commit?.();
        const master = target || formatFetchedRows([result.master_row], 'ph_master_inventory')[0];
        reconcileConfirmedDriveEvidence({ ok: true, row: result.master_row, canonicalConfirmed: true }, master, 'req-', { scope, preserveDetailDraft: true });
    } else if (target || expected) throw new Error('REQUEST_MASTER_RECEIPT_UNCONFIRMED');
    else if (!completedReceipt && !photoReceipt) options.onConfirmed?.(result);
}

function reportDeferredRequestPublication(error, photoReceipt) {
    if (error?.message === 'REQUEST_MASTER_RECEIPT_UNCONFIRMED') return;
    globalThis.reportHandledRuntimeIssue?.('request_work', photoReceipt ? 'REQUEST_PHOTO_PROJECTION_DEFERRED' : 'REQUEST_COMPLETION_PROJECTION_DEFERRED');
}
