function canSubmitArgosReclassForRow(state, payload) {
    authorizeArgosReclassSubmissionRows(payload, state);
    return true;
}

function beginArgosReclassSubmission(state) {
    const identityKey = getArgosReclassLiveEditIdentityKey();
    const apply = document.getElementById('argos-inventory-transaction-apply');
    const isIdentityCurrent = () => identityKey === getArgosReclassLiveEditIdentityKey();
    const isContextCurrent = () => (argosInventoryTransactionState === state || state.backgroundSubmission) && isIdentityCurrent();
    state.submitting = true;
    if (apply) {
        apply.disabled = true;
        apply.textContent = 'Preparing inquiry...';
    }
    return { state, identityKey, apply, isIdentityCurrent, isContextCurrent, moveSaved: false,
        actorUsername: getCurrentReclassDeliveryActor(), sourceView: String(state.sourceView || 'drive') };
}

function reportArgosReclassSubmitFailure(error, submission) {
    if (!submission.isContextCurrent()) return;
    if (error.inventoryMovePending || error.inventoryStatusPending) {
        showToast('Move Confirmation Pending', 'Your saved command will retry with the same request ID.');
        return;
    }
    if (submission.state.backgroundSubmission || error.code === 'INVENTORY_RECLASS_PENDING_STORAGE_UNAVAILABLE') {
        showToast('Move Not Saved', getFriendlyBackendErrorMessage(error, 'The database save failed. Review the worksheet and retry.'), true);
        return;
    }
    window.__gncOpsPilot?.captureFailure?.('commit', error);
    const priorityReportOnly = getArgosInventoryTransactionRequestAction() === 'priority_change';
    const message = submission.moveSaved
        ? 'Inventory moves were saved. Your remaining inquiry draft is still open.'
        : getFriendlyBackendErrorMessage(error, priorityReportOnly ? 'Priority Change report did not send.' : 'Reclass inquiry did not send. Your draft is still open so you can retry.');
    showToast(submission.moveSaved ? 'Moves Saved' : 'Email Error', message, true);
}

function buildArgosReclassSubmissionPayload(state, confirmedPayload) {
    if (state.pendingReclassMove) return getArgosInventoryTransactionPayloadForPendingMove(state, null);
    return confirmedPayload || applyArgosInventoryTransactionSourceContext(buildArgosInventoryTransactionPayload());
}

function isArgosReclassMovePayload(payload) {
    return (payload?.rowOverlays || []).some(overlay => (overlay.proposals || [])
        .some(proposal => ['move_up', 'move_down'].includes(String(proposal?.action || ''))));
}

function announcePendingArgosReclassMove(state) {
    if (!state.pendingReclassMove?.inFlight) return false;
    closeArgosInventoryTransactionModal({ background: true });
    showToast('Saving Moves', 'The move is saved on this device and awaiting confirmation.');
    return true;
}

async function prepareEvalWorkReclassMove(setup, payload, inquiry) {
    const { transactionState: state, identityKey } = setup;
    state.backgroundSubmission = true;
    const work = applyArgosInventoryReclassMoveCommand(state, payload, identityKey);
    if (!state.pendingReclassMove?.inFlight) {
        await work;
        return false;
    }
    setup.inquirySnapshot = removeConfirmedMoveProposalsFromInquiryPayload(inquiry);
    setup.movePending = true;
    announcePendingArgosReclassMove(state);
    void work.then(result => {
        setup.movePending = false;
        if (result && identityKey === getArgosReclassLiveEditIdentityKey()) {
            showToast('Moves Saved', 'Inventory moves were saved and confirmed.');
        }
    }).catch(error => {
        setup.movePending = false;
        setup.moveError = error;
        if (identityKey === getArgosReclassLiveEditIdentityKey()) {
            showToast('Move Not Confirmed', error.inventoryMovePending
                ? 'Your saved command will retry with the same request ID.'
                : String(error.message || 'The database save failed. Review the worksheet before retrying.'), true);
        }
    });
    return true;
}

function focusEvalWorkSetupAssignee(button) {
    setTimeout(() => {
        try {
            button?.focus({ preventScroll: true });
        } catch {
            globalThis.safeIgnoreProbeError?.('openEvalWorkSetupFromReclass');
        }
    }, 30);
}

async function confirmArgosReclassMoveSubmission(submission, inquiryPayload) {
    const { state, identityKey, sourceView } = submission;
    state.backgroundSubmission = true;
    const moveWork = applyArgosInventoryReclassMoveCommand(state, inquiryPayload, identityKey);
    announcePendingArgosReclassMove(state);
    const result = await moveWork;
    if (!result || !submission.isContextCurrent()) return null;
    submission.moveSaved = true;
    const original = inquiryPayload || applyArgosInventoryTransactionSourceContext(buildArgosInventoryTransactionPayload());
    const remaining = removeConfirmedMoveProposalsFromInquiryPayload(original);
    if (hasRemainingArgosReclassInquiry(remaining, sourceView)) return remaining;
    showToast('Moves Saved', 'Inventory moves were saved and confirmed.');
    const view = getCurrentVisibleViewId();
    if (view) queueInteractiveViewRender(view, false, false, 0, 120);
    return null;
}

function reportArgosReclassDraftFailure(error, pendingDraft, submission) {
    if (String(error?.code || '').toUpperCase() === 'REQUEST_ABORTED') return;
    if (isInventoryStatusOutcomeUncertain(error) || error?.inventoryStatusPending) {
        if (submission.isIdentityCurrent()) showToast('Move Confirmation Pending', 'Your saved inquiry will retry with the same request ID.');
        return;
    }
    upsertReclassDeliveryJob(Object.assign({}, pendingDraft, {
        status: 'failed', pendingCreate: true,
        errorCode: String(error?.code || error?.status || ''),
        message: getFriendlyBackendErrorMessage(error, 'The inquiry was not queued. Your saved draft is available to retry.')
    }));
    if (submission.isIdentityCurrent()) {
        showToast('Moves Not Saved', getFriendlyBackendErrorMessage(error, 'The inquiry was not queued. Your saved draft is available to retry.'), true);
    }
}

function queueArgosReclassInquiryDraft(submission, payload) {
    const pendingDraft = persistPendingReclassDeliveryDraft(payload, submission.actorUsername, submission.sourceView);
    if (!pendingDraft) {
        throw Object.assign(new Error('This device could not preserve the Reclass inquiry draft. Keep this editor open and retry.'),
            { code: 'RECLASS_DRAFT_STORAGE_UNAVAILABLE' });
    }
    submission.state.backgroundSubmission = true;
    closeArgosInventoryTransactionModal({ background: true });
    showToast('Queueing Inquiry', 'Your inquiry draft is saved on this device.');
    void dispatchPendingReclassDeliveryDraft(pendingDraft).catch(error => reportArgosReclassDraftFailure(error, pendingDraft, submission));
}

function didArgosReclassRequestLiveEdits(payload) {
    return payload.workflowPolicyVersion === RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION
        || payload.workflowPolicyVersion === RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION && (
            (payload.transaction?.holdStopProposals || []).length > 0
            || (payload.rowOverlays || []).some(overlay => (overlay.fieldEdits || []).length > 0
                || (overlay.proposals || []).some(proposal => proposal.action === 'priority_change')));
}

async function finishArgosReclassInquiry(submission, payload) {
    const result = await postArgosInventoryTransactionPayload(payload);
    if (!result || result.ok === false && !result.liveEdits?.length) {
        const fallback = result?.status === 'conflict'
            ? 'The source rows changed. Sync, review the worksheet, and send again.'
            : 'Reclass inquiry could not be queued. Your draft is still open so you can retry.';
        throw new Error(getFriendlyBackendErrorMessage(firstNonEmptyValue(result?.message, result?.error, result?.rawResponse, ''), fallback));
    }
    rememberQueuedReclassDelivery(payload, result, submission.actorUsername, submission.sourceView);
    if (payload.transaction?.requestActions?.includes('recount')) {
        reclassRecountLoaded = false;
        void loadReclassRecountJobs(true);
    }
    if (!submission.isIdentityCurrent()) return;
    const live = didArgosReclassRequestLiveEdits(payload)
        ? applyConfirmedArgosReclassLiveEdits(result, submission.identityKey) : null;
    if (!submission.isContextCurrent()) return;
    const unavailableUsers = Array.isArray(result.unavailableUsernames)
        ? result.unavailableUsernames.map(value => String(value || '').trim()).filter(Boolean) : [];
    if (argosInventoryTransactionState === submission.state) closeArgosInventoryTransactionModal();
    if (unavailableUsers.length) {
        showToast('Recipient Notice', `Report queued for available recipients. Unavailable: ${unavailableUsers.join(', ')}.`);
    } else if (live && (live.stale || live.applied === 0)) {
        showToast('Updating Inventory', 'Your inquiry was accepted. The latest inventory status is being refreshed automatically.');
    } else if (live?.applied > 0) {
        showToast('Reclass Applied & Saved', 'Live edits are confirmed. The report is queued for delivery.');
    }
    void pollReclassDeliveryJobs();
}

function resetArgosReclassSubmitButton({ apply, state, isContextCurrent }) {
    state.submitting = false;
    if (apply && argosInventoryTransactionState === state && isContextCurrent()
        && document.getElementById('argos-inventory-transaction-apply') === apply) {
        apply.disabled = false;
        setArgosInventoryTransactionAction(state.action || 'reclass');
    }
}

async function submitArgosInventoryTransaction(event = null, confirmedPayload = null) {
    event?.preventDefault?.();
    const state = argosInventoryTransactionState;
    if (!state || state.submitting) return false;
    const submission = beginArgosReclassSubmission(state);
    try {
        ensureArgosReclassSubmissionVerification(state);
        if (!submission.isContextCurrent()) return false;
        let payload = buildArgosReclassSubmissionPayload(state, confirmedPayload);
        if (!canSubmitArgosReclassForRow(state, payload)) return false;
        const hasMoves = isArgosReclassMovePayload(payload);
        if (hasMoves || state.pendingReclassMove) {
            payload = await confirmArgosReclassMoveSubmission(submission, payload);
            if (!payload) return false;
        }
        payload = await applyArgosInventoryTransactionEmailRecipients(payload);
        if (!submission.isContextCurrent()) return false;
        if (!payload) {
            if (submission.moveSaved) showToast('Moves Saved', 'Inventory moves were saved. Your remaining inquiry draft is still open.');
            return false;
        }
        if (submission.apply) submission.apply.textContent = 'Queueing...';
        if (hasMoves || state.pendingReclassMove) await finishArgosReclassInquiry(submission, payload);
        else queueArgosReclassInquiryDraft(submission, payload);
    } catch (error) {
        reportArgosReclassSubmitFailure(error, submission);
    } finally {
        resetArgosReclassSubmitButton(submission);
    }
    return false;
}

function confirmArgosReclassHoldReplacement(normalized, rule, globalHoldProposal) {
    if (!globalHoldProposal || globalHoldProposal.action === normalized) return true;
    const conflictingRule = getReclassActionWorkflowV2Config(globalHoldProposal.action);
    const hasEnteredData = !!String(globalHoldProposal.reason || '').trim();
    return window.confirm(`Replace ${conflictingRule.label} with ${rule.label} for this selected row and any server-authorized matching rows${hasEnteredData ? ' and discard its entered reason' : ''}?`);
}

function createArgosReclassLocalActionProposal(normalized, uid, values, rule) {
    const rowMap = getArgosReclassRowProposalMap(uid, true);
    const proposal = { action: normalized };
    if (rule.kind === 'priority') proposal.priority = String(values.priority == null ? '' : values.priority);
    if (rule.kind === 'move') Object.assign(proposal, { splits: [{ quantity: '', destinationSeason: '' }], applyHold: false, holdReason: '' });
    if (rule.kind === 'sheared') proposal.quantity = '';
    rowMap[normalized] = proposal;
}

function createArgosReclassActionProposal(normalized, uid, entry, rule, globalHoldProposal, isHoldAction) {
    if (argosReclassMultiActionState.rowResolutions instanceof Map) argosReclassMultiActionState.rowResolutions.delete(uid);
    const values = entry.values && typeof entry.values === 'object' ? entry.values : {};
    const originalOh = Number(String(values.ptronhand == null ? '' : values.ptronhand).replace(/,/g, ''));
    if (rule.kind === 'sheared' && (!Number.isFinite(originalOh) || originalOh < 1)) {
        showToast('Action Unavailable', `${rule.label} requires a positive original OH.`, true);
        return false;
    }
    if (!isHoldAction) {
        createArgosReclassLocalActionProposal(normalized, uid, values, rule);
        return true;
    }
    if (!confirmArgosReclassHoldReplacement(normalized, rule, globalHoldProposal)) return false;
    argosReclassMultiActionState.holdStopProposals = {
        [normalized]: { action: normalized, reason: '', sourceUid: uid, holdstopbegindate: new Date().toLocaleDateString('en-CA') }
    };
    return true;
}

function toggleArgosReclassV3Action(button = null, action = '', sourceUid = '') {
    const normalized = String(action || '').trim().toLowerCase();
    const card = button && button.closest ? button.closest('[data-reclass-row-card]') : null;
    const uid = String(card && card.getAttribute('data-reclass-row-card') || sourceUid || '').trim();
    const entry = getArgosReclassRowEditorEntry(uid);
    const rule = getReclassActionWorkflowV5Config(normalized);
    if (!entry || !rule) return false;
    if (!canStageArgosReclassAction(entry, normalized)) return false;
    if (isArgosReclassRepOperations(entry) && !['priority_change', 'hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'].includes(normalized)) return false;
    const isHoldAction = RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS.includes(normalized);
    const globalHoldProposal = getArgosReclassV3HoldProposal();
    const existing = isHoldAction && globalHoldProposal && globalHoldProposal.action === normalized
        ? globalHoldProposal : getArgosReclassV3Proposal(uid, normalized);
    if (!existing && !requireReclassExplanation(uid)) return false;
    card?.querySelectorAll('[data-reclass-v3-proposal-field]').forEach(input => handleArgosReclassV3ProposalInput(input));
    const previousAction = argosInventoryTransactionState?.activeReclassAction?.[uid];
    if (argosInventoryTransactionState) {
        argosInventoryTransactionState.activeReclassAction ||= {};
        argosInventoryTransactionState.activeReclassAction[uid] = normalized;
    }
    if (existing && previousAction !== normalized) { refreshArgosReclassMultiActionUi(); return false; }
    if (existing) {
        if (isHoldAction) argosReclassMultiActionState.holdStopProposals = {};
        else {
            const rowMap = getArgosReclassRowProposalMap(uid, false) || {};
            delete rowMap[normalized];
            if (!Object.keys(rowMap).length) argosReclassMultiActionState.rowProposals.delete(uid);
        }
    } else {
        if (!createArgosReclassActionProposal(normalized, uid, entry, rule, globalHoldProposal, isHoldAction)) return false;
    }
    if (argosInventoryTransactionState) argosInventoryTransactionState.reclassDraftsByRowUid = argosReclassMultiActionState.rowProposals;
    if (argosInventoryTransactionState) argosInventoryTransactionState.idempotencyToken = generateArgosInventoryTransactionId('reclass_inquiry');
    refreshArgosReclassMultiActionUi();
    captureEvalWorkLocalDraftSoon(0);
    return false;
}

function handleArgosReclassV3ProposalInput(input = null) {
    const card = input && input.closest ? input.closest('[data-reclass-row-card]') : null;
    const uid = String(card && card.getAttribute('data-reclass-row-card') || '').trim();
    const action = String(input && input.getAttribute('data-reclass-v3-proposal-action') || '').trim().toLowerCase();
    const field = String(input && input.getAttribute('data-reclass-v3-proposal-field') || '').trim();
    const proposal = RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS.includes(action) ? getArgosReclassV3HoldProposal() : getArgosReclassV3Proposal(uid, action);
    if (!proposal || !field) return false;
    if (['move_up', 'move_down'].includes(action)) {
        const splitIndex = Number(input.getAttribute('data-reclass-split-index'));
        if (['quantity', 'destinationSeason'].includes(field) && Number.isInteger(splitIndex) && proposal.splits && proposal.splits[splitIndex]) proposal.splits[splitIndex][field] = String(input.value ?? '');
        else return false;
        const entry = getArgosReclassRowEditorEntry(uid);
        card.querySelectorAll('[data-reclass-move-balance]').forEach((node) => {
            node.textContent = getArgosReclassMoveBalanceText(entry);
            node.setAttribute('data-over-limit', String(getArgosReclassMoveBalance(entry).remaining < 0));
        });
        markArgosReclassProposalEdited(uid);
        return true;
    }
    const value = field === 'holdstopreason' || field === 'reason'
        ? String(input.value == null ? '' : input.value).toLowerCase()
        : String(input.value == null ? '' : input.value);
    if ((field === 'holdstopreason' || field === 'reason') && input.value !== value) input.value = value;
    proposal[field] = value;
    if (action === 'sheared' && field === 'quantity') {
        const preview = card && card.querySelector('[data-sheared-request-preview="true"]');
        if (preview) preview.textContent = value.trim() ? `${value.trim()}-->#` : '—';
    }
    if (field === 'reason' && RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS.includes(action)) {
        document.querySelectorAll('[data-reclass-v3-proposal-field="reason"]').forEach((other) => {
            if (other !== input && other.getAttribute('data-reclass-v3-proposal-action') === action) other.value = value;
        });
    }
    markArgosReclassProposalEdited(uid);
    return true;
}
