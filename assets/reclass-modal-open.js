function resolveArgosReclassOpenContext(uid, sourceView, options) {
    const safeUid = String(uid || '').trim();
    const displayedItem = options.inquiryRow || findItemByUniqueId(safeUid);
    const warmGroup = options.__verifiedInquiryGroup ? null : getVerifiedCachedArgosItemInquiryGroup(displayedItem);
    const verifiedGroup = options.__verifiedInquiryGroup || warmGroup;
    const displayGroup = options.__displayInquiryGroup || (!verifiedGroup
        ? getReadableCachedArgosItemInquiryGroup(displayedItem) : null);
    const item = displayedItem || verifiedGroup?.row || displayGroup?.row;
    if (!isArgosInventoryTransactionEligible(item)) {
        showToast('Unavailable', 'This card is not tied to a live inventory row.', true);
        return false;
    }
    const safeSourceView = String(sourceView || activeDetailSourceView || lastView || '').trim().toLowerCase();
    if (!authorizeArgosReclassRow(item, safeSourceView, 'open')) return null;
    return { item, verifiedGroup, displayGroup, safeSourceView, sourceView };
}

function createArgosReclassOpenState(context, options) {
    const { item, verifiedGroup, displayGroup, safeSourceView, sourceView } = context;
    argosInquiryOpenRevision += 1;
    const modal = ensureArgosInventoryTransactionModal();
    const snapshot = getArgosInventorySourceSnapshot(item);
    const inquiryModel = buildItemInquiryViewModel(item, getItemInquiryRows(item, [...((verifiedGroup || displayGroup)?.rows || []), ...(options.inquiryRows || [])]));
    resetArgosReclassMultiActionState();
    argosInventoryTransactionState = {
        uid: snapshot.uniqueId,
        item,
        snapshot,
        inquiryModel,
        verifiedInquiryGroup: verifiedGroup || null,
        verificationIdentityKey: getArgosReclassLiveEditIdentityKey(),
        idempotencyToken: generateArgosInventoryTransactionId('reclass_inquiry'),
        sourceView: String(sourceView || activeDetailSourceView || lastView || '').trim(),
        action: 'reclass',
        submitting: false,
        driveReturnContext: safeSourceView === 'drive' ? {
            searchTerm: getDriveSearchTerm(),
            scrollTop: Number(document.getElementById('main-scroll-area') && document.getElementById('main-scroll-area').scrollTop || 0)
        } : null
    };
    const savedMove = readPendingArgosInventoryReclassMove(getArgosReclassLiveEditIdentityKey());
    if (savedMove && String(savedMove.sourceUid || '') === String(snapshot.uniqueId || '')
        && savedMove.command.moves.some((move) => move.source.uniqueId === String(snapshot.uniqueId || ''))) {
        argosInventoryTransactionState.moveCommandId = savedMove.command.commandId;
        argosInventoryTransactionState.pendingReclassMove = { command: savedMove.command, originalModel: inquiryModel,
            inquiryPayload: savedMove.inquiryPayload || null,
            movedUids: Array.isArray(savedMove.movedUids) ? savedMove.movedUids : [], uncertain: true, recovered: true };
    }
    return { modal, snapshot, inquiryModel };
}

function renderArgosReclassOpenHeader(opened) {
    const { snapshot, inquiryModel } = opened;
    // The modal reuses its DOM, but each opening owns a new submission.
    // A pending older request must not leave the new inquiry disabled.
    const applyButton = document.getElementById('argos-inventory-transaction-apply');
    if (applyButton) applyButton.disabled = false;
    const titleEl = document.getElementById('argos-inventory-transaction-title');
    const subtitleEl = document.getElementById('argos-inventory-transaction-subtitle');
    const sourceEl = document.getElementById('argos-inventory-transaction-source');
    if (titleEl) titleEl.textContent = `${snapshot.commonName || ''} ${snapshot.contSize || ''}`.trim();
    if (subtitleEl) subtitleEl.textContent = '';
    if (sourceEl) sourceEl.innerHTML = '';
    const inquiryEl = document.getElementById('argos-reclass-item-inquiry');
    if (inquiryEl) inquiryEl.innerHTML = renderArgosReclassInquiryEditor(inquiryModel, snapshot.uniqueId);
    if (argosInventoryTransactionState.pendingReclassMove) {
        if (applyButton) applyButton.textContent = 'Confirm Pending Move';
        setArgosReclassMoveInputsLocked(true);
        showToast('Move Confirmation Pending', 'A prior move for this row needs confirmation. Retry it before starting another move.', true);
    }
    return inquiryEl;
}

function resetArgosReclassOpenInputs(item, snapshot) {
    refreshArgosInventoryTransactionLotOptions(item);
    refreshArgosInventoryTransactionPriorityOptions(item);
    const sourceInput = document.getElementById('argos-inventory-transaction-source-code');
    const qtyInput = document.getElementById('argos-inventory-transaction-qty');
    const priorityInput = document.getElementById('argos-inventory-transaction-priority');
    const newItemInput = document.getElementById('argos-inventory-transaction-new-item');
    const newLotInput = document.getElementById('argos-inventory-transaction-new-lot');
    const newLocationInput = document.getElementById('argos-inventory-transaction-new-location');
    const desigCustInput = document.getElementById('argos-inventory-transaction-desigcust');
    const desigItemInput = document.getElementById('argos-inventory-transaction-desigitem');
    const desigLocInput = document.getElementById('argos-inventory-transaction-desigloc');
    const lastPltgDateInput = document.getElementById('argos-inventory-transaction-last-pltg-date');
    const reasonInput = document.getElementById('argos-inventory-transaction-reason');
    if (reasonInput) reasonInput.value = '';
    if (sourceInput) sourceInput.value = snapshot.source || '';
    if (qtyInput) qtyInput.value = '0';
    if (priorityInput) priorityInput.value = normalizeArgosInventoryTransactionPriorityValue(snapshot.priority) || '';
    if (newItemInput) newItemInput.value = snapshot.itemCode || '';
    if (newLotInput) {
        const snapshotLotCode = String(snapshot.lotCode || '').trim().toUpperCase();
        const hasSnapshotLotOption = Array.from(newLotInput.options || []).some((option) => option.value === snapshotLotCode);
        newLotInput.value = snapshotLotCode && hasSnapshotLotOption ? snapshotLotCode : '';
    }
    if (newLocationInput) newLocationInput.value = snapshot.locationCode || '';
    if (desigCustInput) desigCustInput.value = snapshot.desigCust || '';
    if (desigItemInput) desigItemInput.value = snapshot.desigItem || '';
    if (desigLocInput) desigLocInput.value = snapshot.desigLoc || '';
    if (lastPltgDateInput) lastPltgDateInput.value = '';
}

function showArgosReclassOpenModal(modal, action) {
    setArgosInventoryTransactionAction(action);
    setArgosInventoryTransactionHoldAction('none');
    const reviewButton = document.getElementById('argos-inventory-transaction-review');
    if (reviewButton) reviewButton.classList.toggle('hidden', !isEvalWorkManagerUser());
    argosInventoryTransactionState.draftBaseline = captureArgosInventoryTransactionDraftBaseline(modal);
    modal.classList.remove('hidden');
}

function isArgosReclassOpenReadCurrent(read) {
    return read.state === argosInventoryTransactionState && read.revision === argosInquiryOpenRevision
        && read.owner === getSupabaseReadIdentityScope() && read.view === getCurrentVisibleViewId()
        && !read.controller.signal.aborted;
}

function applyArgosReclassOpenRefresh(read, freshGroup) {
    const currentContext = getProductionLiveSyncContext();
    if (!isArgosReclassOpenReadCurrent(read)
        || freshGroup.scope && currentContext.scope !== freshGroup.scope
        || freshGroup.permission && currentContext.dataPermissionVersion !== freshGroup.permission) return;
    const refreshedItem = freshGroup.row || read.state.item;
    const refreshedModel = buildItemInquiryViewModel(refreshedItem, freshGroup.rows);
    if (!shouldApplyArgosItemInquiryRefresh(read.state, read.modal, read.inquiryEl, refreshedModel)) return;
    read.state.item = refreshedItem;
    read.state.inquiryModel = refreshedModel;
    read.state.verifiedInquiryGroup = freshGroup;
    if (read.inquiryEl && read.state === argosInventoryTransactionState) {
        read.inquiryEl.innerHTML = renderArgosReclassInquiryEditor(refreshedModel, read.state.snapshot.uniqueId);
    }
}

function refreshArgosReclassOpenInquiry(item, modal, inquiryEl) {
    if (!canUseProductionLiveSync()) return;
    const read = { state: argosInventoryTransactionState, revision: argosInquiryOpenRevision,
        owner: getSupabaseReadIdentityScope(), view: getCurrentVisibleViewId(), modal, inquiryEl, controller: new AbortController() };
    argosInquiryReadController?.abort();
    argosInquiryReadController = read.controller;
    requestAnimationFrame(() => {
        if (!isArgosReclassOpenReadCurrent(read)) return;
        clearSupabaseReadFailuresForVisibleContext({ adapters: [{ sourceKeys: ['ph_master_inventory'] }] });
        void loadArgosItemInquiryRows(item, { signal: read.controller.signal })
            .then(freshGroup => applyArgosReclassOpenRefresh(read, freshGroup))
            .catch(() => { /* Keep the displayed row and draft through background read failures. */ })
            .finally(() => {
                if (argosInquiryReadController === read.controller) argosInquiryReadController = null;
            });
    });
}

function openArgosInventoryTransactionModal(uid = '', action = 'reclass', sourceView = '', options = {}) {
    const context = resolveArgosReclassOpenContext(uid, sourceView, options);
    if (!context) return false;
    const opened = createArgosReclassOpenState(context, options);
    const inquiryEl = renderArgosReclassOpenHeader(opened);
    resetArgosReclassOpenInputs(context.item, opened.snapshot);
    showArgosReclassOpenModal(opened.modal, action);
    refreshArgosReclassOpenInquiry(context.item, opened.modal, inquiryEl);
    return false;
}

function buildArgosReclassActionFieldsHtml(entry = null) {
    const safeEntry = entry && typeof entry === 'object' ? entry : { unique_id: '', values: {} };
    const uid = String(safeEntry.unique_id || '').trim();
    const values = safeEntry.values && typeof safeEntry.values === 'object' ? safeEntry.values : {};
    if (!RECLASS_ACTION_WORKFLOW_V3_ENABLED) return '';
    const originalOh = Number(String(values.ptronhand == null ? '' : values.ptronhand).replace(/,/g, ''));
    const globalHoldProposal = getArgosReclassV3HoldProposal();
    const repOperations = isArgosReclassRepOperations(safeEntry);
    const buttons = ['move_up', 'move_down', 'recount', 'hold', 'take_off_hold', 'priority_change', 'stop_ship', 'off_stop_ship', 'sheared'].filter(action => RECLASS_ACTION_WORKFLOW_V5_ORDER.includes(action)).filter((action) => !repOperations || ['priority_change', 'hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'].includes(action)).map(action => renderArgosReclassActionButton(action, uid, originalOh, globalHoldProposal)).join('');
    const activeActions = RECLASS_ACTION_WORKFLOW_V5_ORDER.filter((action) => !!getArgosReclassV3Proposal(uid, action));
    const requestedAction = argosInventoryTransactionState?.activeReclassAction?.[uid];
    const visibleAction = activeActions.includes(requestedAction) ? requestedAction : activeActions[activeActions.length - 1];
    const proposalsHtml = visibleAction ? globalThis.buildArgosReclassV3ProposalHtml(safeEntry, visibleAction) : '';
    const scopeActions = getArgosReclassV3ScopeActionsForEntry(safeEntry);
    if (globalHoldProposal && String(globalHoldProposal.sourceUid || '') === uid && !scopeActions.includes(globalHoldProposal.action)) scopeActions.push(globalHoldProposal.action);
    const scopeHtml = scopeActions.length ? `<div class="argos-reclass-action-scope">${scopeActions.map((action) => escapeHtml(ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS[action] || getReclassActionWorkflowV2Config(action).label)).join(', ')} requested for this row. Eligible manager fanout is determined by the server.</div>` : '';
    const mobileEditor = isArgosReclassMobileEditorViewport();
    const settings = mobileEditor ? null : getArgosReclassScopeSettings();
    const scopeCopy = settings && settings.season && settings.salesYear != null ? `${settings.season} / sales year <= ${String(settings.salesYear).slice(-2)}` : 'settings unavailable';
    const locationOverlay = getArgosReclassTemporaryOverlay(uid, false);
    const hasLocationChanges = !!(locationOverlay && locationOverlay.temporaryChangedFields && locationOverlay.temporaryChangedFields.length);
    const locationDetailsHtml = `<details class="argos-reclass-action-panel argos-reclass-location-panel" data-reclass-location-details ${isArgosReclassLocationDetailsOpen(safeEntry) ? 'open' : ''}><summary class="argos-reclass-action-panel-title"><span>Inventory fields (optional) <span class="argos-reclass-location-changed" data-reclass-location-changed ${hasLocationChanges ? '' : 'hidden'}>· Changes entered</span></span><i class="ph-bold ph-caret-down argos-reclass-location-caret" aria-hidden="true"></i></summary><div class="argos-reclass-location-content"><p>Changed fields update live inventory when you send the inquiry. The same changes are queued for keyers and protected until the legacy import matches.</p><div class="argos-reclass-action-proposal-grid">${renderArgosReclassInventoryFields(safeEntry)}</div><small>Pri By, Eval Date and Pri Update are stamped on submission. Note Date changes only with Loc Note.</small></div></details>`;
    const resolution = getEvalWorkInquiryRowResolution(uid);
    const resolutionHtml = argosInventoryTransactionState && argosInventoryTransactionState.sourceView === 'eval-work'
        ? `<section class="eval-work-row-resolution"><div><strong>Finish this row</strong><small>Use Mark Done after choosing an action or changing a location detail, or No Action when nothing needs to change. The final row automatically sends the PDF.</small></div><div class="eval-work-row-resolution-actions"><button type="button" class="eval-work-row-resolution-btn" data-eval-row-resolution-action="done" aria-pressed="${resolution === 'done' ? 'true' : 'false'}" onclick="return setEvalWorkInquiryRowResolution(this,'done')"><i class="ph-bold ph-check-circle"></i> Mark Done</button><button type="button" class="eval-work-row-resolution-btn" data-eval-row-resolution-action="no_action" aria-pressed="${resolution === 'no_action' ? 'true' : 'false'}" onclick="return setEvalWorkInquiryRowResolution(this,'no_action')"><i class="ph-bold ph-minus-circle"></i> No Action</button></div></section>`
        : '';
    return `<section class="argos-reclass-action-panel"><div class="argos-reclass-action-panel-title"><span>Actions for this row</span>${mobileEditor ? '' : `<small>Choose an action to show its request fields. Hold / Stop starts from the selected row; the server determines any authorized matching-row scope (${escapeHtml(scopeCopy)}).</small>`}</div><div class="argos-reclass-action-grid">${buttons}</div>${buildReclassExplanationField(uid)}${scopeHtml}${proposalsHtml ? `<div class="argos-reclass-action-proposal-grid">${proposalsHtml}</div>` : ''}</section>${repOperations ? '' : locationDetailsHtml}${resolutionHtml}`;
}

function renderArgosReclassActionButton(action, uid, originalOh, globalHoldProposal) {
    const rule = getReclassActionWorkflowV5Config(action);
    const scopeEntries = RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS.includes(action) ? getArgosReclassHoldTargetEntries(action, uid) : [];
    const proposalScopeEntries = RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS.includes(action) ? getArgosReclassHoldProposalTargetEntries(action) : [];
    const active = RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS.includes(action)
        ? !!(globalHoldProposal && globalHoldProposal.action === action && (String(globalHoldProposal.sourceUid || '') === uid || proposalScopeEntries.some((candidate) => String(candidate && candidate.unique_id || '') === uid)))
        : !!getArgosReclassV3Proposal(uid, action);
    const { eligible, title } = getArgosReclassActionAvailability(action, rule, scopeEntries, originalOh);
    const actionLabel = ({ recount: 'Re-Count', sheared: 'Sheared to #' })[action] || ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS[action] || rule.label;
    return `<button type="button" class="argos-reclass-action-btn" data-reclass-v3-action="${escapeHtml(action)}" aria-pressed="${active ? 'true' : 'false'}" onclick="return toggleArgosReclassV3Action(this, '${escapeHtml(action)}')" ${!(eligible || active) ? 'disabled' : ''} title="${escapeHtml(title)}">${escapeHtml(actionLabel)}</button>`;
}

function getArgosReclassActionAvailability(action, rule, scopeEntries, originalOh) {
    if (['move', 'sheared'].includes(rule.kind) && (!Number.isFinite(originalOh) || originalOh < 1)) {
        return { eligible: false, title: 'Requires positive original OH' };
    }
    const hold = RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS.includes(action);
    if (hold && !scopeEntries.length) {
        const title = rule.kind === 'hold_off' ? `No scoped rows are currently coded ${rule.code}` : 'Current season settings or eligible rows are unavailable';
        return { eligible: false, title };
    }
    const title = hold ? `${scopeEntries.length} scoped row${scopeEntries.length === 1 ? '' : 's'} affected` : '';
    return { eligible: true, title };
}
