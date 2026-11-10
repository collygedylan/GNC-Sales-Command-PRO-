function restoreAppUpdateHeaderSearch(saved) {
    const search = getAppUpdateHeaderSearchRoot(saved.view);
    const root = saved.roots.find(entry => entry.id === search?.id);
    if (root) restoreAppUpdateControls(search, root.controls);
}

function restoreAppUpdateView(saved) {
    if (!saved.detail) {
        restoreAppUpdateHeaderSearch(saved);
        fastBackToView(saved.view, { fromHistory: true, targetScrollTop: saved.scroll, forceRender: true, renderDelay: 0 });
        return true;
    }
    const { detail } = saved;
    persistAppUpdateDetailDraft(saved);
    openDetail(detail.uid, detail.source, { __masterDetailRow: { ...detail.row }, preferredTab: detail.tab });
    if (String(activeItem?.UNIQUE_ID || activeItem?.unique_id || '') !== detail.uid) return false;
    activeDetailSourceView = detail.source;
    lastView = detail.lastView;
    detailReturnState = detail.returnState;
    switchDetailTab(detail.tab, { preserveDraft: true });
    if (typeof runDeferredDetailHydration === 'function' && typeof pendingDetailHydrationToken !== 'undefined' && pendingDetailHydrationToken) {
        const token = pendingDetailHydrationToken;
        clearPendingDetailHydration();
        runDeferredDetailHydration(token);
    }
    return true;
}

function restoreAppUpdateReclass(reclass) {
    openArgosInventoryTransactionModal(reclass.uid, 'reclass', reclass.sourceView, { inquiryRow: reclass.item, inquiryRows: reclass.rows });
    if (argosInventoryTransactionState?.uid !== reclass.uid) return false;
    argosReclassMultiActionState = reclass.proposals;
    activeEvalWorkDetailId = reclass.evalWorkId;
    argosInventoryTransactionState.reclassDraftsByRowUid = argosReclassMultiActionState.rowProposals;
    evalWorkActiveOriginUid = reclass.detailOrigin;
    if (reclass.temporaryOverlays && typeof evalWorkTemporaryRowOverlays !== 'undefined') {
        evalWorkTemporaryRowOverlays.clear();
        reclass.temporaryOverlays.forEach((value, key) => evalWorkTemporaryRowOverlays.set(key, value));
    }
    if (reclass.evidenceByOrigin) evalWorkEvidenceByOrigin = reclass.evidenceByOrigin;
    if (reclass.activePhotos) evalWorkActivePhotos = reclass.activePhotos;
    for (const uid of reclass.expanded) {
        const card = [...document.querySelectorAll('[data-reclass-row-card]')].find(node => node.getAttribute('data-reclass-row-card') === uid);
        if (card) hydrateArgosReclassRowCard(card);
    }
    refreshArgosReclassMultiActionUi();
    return true;
}

async function restoreAppUpdateAuthenticatedWork(envelope, saved, same) {
    if (!canAccessView(saved.view === 'detail' ? (saved.detail?.source || 'drive') : saved.view)) return false;
    restorePersistedAppFilterStateForCurrentUser(true, saved.filters);
    restoreAppUpdateReportState(saved.reports);
    if (saved.drafts?.ncr && typeof ncrDraftState !== 'undefined') {
        ncrDraftState.clear();
        saved.drafts.ncr.forEach((value, key) => ncrDraftState.set(key, value));
    }
    if (saved.drafts?.hl && typeof hlOrderSelections !== 'undefined') {
        hlOrderSelections.clear();
        saved.drafts.hl.forEach((value, key) => hlOrderSelections.set(key, value));
    }
    for (const selection of saved.selection) {
        const fresh = findItemByUniqueId(selection.uid) || selection.row;
        const row = { ...fresh, DOM_ID: selection.domId };
        requestSubmissionSourceRows.set(selection.domId, { ownerKey: getRequestSubmissionOwnerKey(), item: row });
        if (selection.selected) selectedItems.add(selection.domId);
        if (selection.quick) driveQuickRequestItems.add(selection.domId);
        selectedItemSources.set(selection.domId, selection.source);
    }
    if (!restoreAppUpdateView(saved)) return false;
    viewHistoryStack = saved.history.slice(-40);
    if (saved.reclass && !restoreAppUpdateReclass(saved.reclass)) return false;
    if (saved.request) {
        restoreRequestSubmissionForm({ ownerKey: getRequestSubmissionOwnerKey(), clientBatchId: saved.request.batchId || '', formSnapshot: saved.request.form,
            selectionSnapshot: saved.selection.map(item => ({ domId: item.domId, item: item.row, sourceView: item.source })) });
        for (const id of ['step-1-rep', 'step-1.5-folder', 'step-2-cust', 'step-3-qty']) {
            document.getElementById(id)?.classList.toggle('hidden', !saved.request.steps.includes(id));
        }
    }
    if (saved.bloom) {
        writeBloomPickerOrderDraft(saved.bloom);
        openBloomPickerModal();
        applyBloomPickerOrderDraftState(saved.bloom);
    }
    if (saved.cartOpen && !cartPanelOpen) toggleCartPanel(true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!same()) return false;
    updateGlobalActionBar();
    refreshCartButtons();
    updateGlobalBackButton();
    watchAppUpdateRestoredControls(envelope, saved, same);
    return true;
}

async function restoreAppUpdateCheckpoint(state) {
    const envelope = readCommittedAppUpdateSnapshot();
    const owner = getAppUpdateWorkOwner();
    if (!envelope || !isAppUpdateRestoreReleaseReady(envelope)) return false;
    const revision = state.revision;
    const prior = state.restoreAttempts.get(envelope.snapshotId);
    if (prior !== undefined && prior !== revision) return false;
    state.restoreAttempts.set(envelope.snapshotId, revision);
    const same = () => {
        const current = getAppUpdateWorkOwner();
        return state.revision === revision && current.username === owner.username && current.subject === owner.subject && (current.verified || current.guest);
    };
    try {
        const saved = decodeAppUpdateWorkValue(envelope.work);
        if (!same()) return false;
        if (!owner.guest && !await restoreAppUpdateAuthenticatedWork(envelope, saved, same)) return false;
        if (!same()) return false;
        if (owner.guest) {
            saved.roots = [];
            saved.scroll = 0;
        }
        return finishAppUpdateRestore(envelope, saved, same);
    } catch {
        expireAppUpdateRestore();
        window.reportHandledRuntimeIssue?.('app_update_restore', 'WORK_RESTORE_DEFERRED');
        return false;
    }
}

export async function restoreWorkStateAfterAppUpdate() {
    initializeAppUpdateWorkState();const state=getAppUpdateWorkRuntime();
    if(state.restoring)return state.restoring;
    const promise=Promise.resolve().then(() => restoreAppUpdateCheckpoint(state));let deadline;
    const bounded=Promise.race([promise,new Promise(resolve=>{deadline=setTimeout(()=>{expireAppUpdateRestore();resolve(false);},1200);})]);
    state.restoring=bounded;
    try { return await bounded; }
    catch{expireAppUpdateRestore();window.reportHandledRuntimeIssue?.('app_update_restore','WORK_RESTORE_FAILED');return false;}
    finally{clearTimeout(deadline);if(state.restoring===bounded)state.restoring=null;}
}
