function resolveReclassAdministrator(input = {}) {
    const { identity, profile, matrix, currentActor, denied, now = Date.now() } = input;
    const actor = normalizeEvidenceActor(currentActor);
    if (!actor || !identity?.authenticated || identity.username !== actor || denied
        || !profile?.id || normalizeEvidenceActor(profile.username) !== actor
        || !identity.legacy && identity.id !== profile.id
        || profile.active === false || profile.is_active === false || profile.disabled_at
        || profile.must_change_password || profile.locked_until && Date.parse(profile.locked_until) > now
        || matrix?.verified !== true || String(matrix.profile_id || '') !== String(profile.id)
        || normalizeEvidenceActor(matrix.username) !== actor) return null;
    const role = String(matrix.role || '').trim().toLowerCase();
    return /^(admin|super[-_ ]?admin)$/.test(role) ? { actor, profileId: profile.id, matrix } : null;
}

function getVerifiedReclassAdministrator(user = currentUser) {
    const identity = getCanonicalAccessSessionIdentity();
    const actor = normalizeEvidenceActor(user);
    const self = globalThis.GncUserAccessControl?.getSelfState?.();
    const profile = identity?.legacy
        ? self?.verified === true && self.status === 'ready' ? self.profile : null
        : typeof nativeAuthProfile === 'undefined' ? null : nativeAuthProfile;
    return resolveReclassAdministrator({ identity, profile, currentActor: actor,
        matrix: resolveUserAccessMatrix(actor), denied: self?.denied === true });
}

function isSeasonYReclassSource(row) {
    const raw = row?.__reclassIdentityRaw || row;
    const season = String(raw?.SEASON ?? raw?.season ?? '').trim().toUpperCase();
    const lot = String(raw?.LOTCODE ?? raw?.lotcode ?? '').trim().toUpperCase();
    return season === 'Y' || /(?:^|\.)Y$/.test(season) || /(?:^|\.)Y$/.test(lot);
}

function reclassSourceModuleAllowed(matrix, sourceView) {
    const source = String(sourceView || 'drive').trim().toLowerCase();
    const flags = { drive: ['view_drive_mode'], reclass: ['view_drive_mode'], av: ['view_av'],
        'suspend-tag': ['view_que', 'view_que_suspend'], request: ['view_que', 'view_que_request'],
        managers: ['view_managers'], 'eval-work': ['view_que'],
        'eval-report-2': ['view_eval_reports_2'] }[source] || ['view_drive_mode'];
    return !flags.some(flag => [matrix.view_permissions?.[flag], matrix[flag]].some(value => value === 'N' || value === false));
}

function getSeasonYReclassAdministratorAccess(row, sourceView, user = currentUser) {
    if (!isSeasonYReclassSource(row)) return null;
    const administrator = getVerifiedReclassAdministrator(user);
    return administrator ? reclassSourceModuleAllowed(administrator.matrix, sourceView) : null;
}

function isArgosReclassRepOperations(entry) {
    const access = getSeasonYReclassAdministratorAccess(entry?.sourceRow, argosInventoryTransactionState?.sourceView || '');
    return access === true ? false : canCurrentUserSubmitRepInventoryOperations();
}

function getArgosReclassRowAccessDenial(item, sourceView, mode) {
    const adminAccess = getSeasonYReclassAdministratorAccess(item, sourceView);
    if (adminAccess === false) return ['View Only', 'Reclass is not available in this module for this account.'];
    if (adminAccess !== true && !isEvalReclassRowAssigned(currentUser || currentUserDisplay, item)) {
        return ['Assigned Rows Only', `Evaluators can ${mode === 'open' ? 'open' : 'submit'} Reclass only for rows assigned to them.`];
    }
    if (mode !== 'open') return null;
    if (sourceView === 'suspend-tag' && !canCurrentUserViewDockSuspendDcRequests(item)) {
        return ['Unavailable', 'Suspend Tag actions are not available for this account.'];
    }
    if (adminAccess !== true && ['drive', 'suspend-tag'].includes(sourceView)
        && !canCurrentUserUseDriveCardOptions(item, 'drive') && !canCurrentUserSubmitRepInventoryOperations()) {
        return ['View Only', 'Drive Mode actions are only available on rows assigned to you.'];
    }
    return null;
}

function authorizeArgosReclassRow(item, sourceView = '', mode = 'submit') {
    const denial = getArgosReclassRowAccessDenial(item, sourceView, mode);
    if (!denial) return true;
    showToast(denial[0], denial[1], true);
    return false;
}

function canStageArgosReclassRow(uid) {
    const entry = getArgosReclassRowEditorEntry(String(uid || ''));
    const row = entry?.sourceRow;
    if (!row) {
        showToast('Row Unavailable', 'This Reclass source row is no longer available. Review the worksheet.', true);
        return false;
    }
    return authorizeArgosReclassRow(row, argosInventoryTransactionState?.sourceView || '', 'submit');
}

function canStageArgosReclassAction(entry, action) {
    if (!['move_up', 'move_down'].includes(action)) return true;
    const row = entry?.sourceRow?.__reclassIdentityRaw || entry?.sourceRow;
    if (String(row?.LOTCODE ?? row?.lotcode ?? '').trim().toUpperCase() !== 'Y') return true;
    if (getSeasonYReclassAdministratorAccess(row, argosInventoryTransactionState?.sourceView || '') === true) return true;
    showToast('Move Unavailable', 'This physical source lot requires an active administrator to move inventory.', true);
    return false;
}

function getSubmittedPhysicalReclassAction(payload, uid) {
    const overlay = (payload.rowOverlays || []).find(row => String(row.unique_id || '') === uid);
    const action = overlay?.proposals?.find(proposal => ['move_up', 'move_down'].includes(proposal.action))?.action;
    if (action) return action;
    return (payload.moves || []).some(move => String(move.source?.uniqueId || '') === uid) ? 'move_up' : '';
}

function getTouchedReclassSourceUids(payload) {
    const uids = new Set((payload.transaction?.holdStopProposals || []).map(proposal => String(proposal.sourceUid || '')));
    for (const overlay of payload.rowOverlays || []) {
        if (overlay.proposals?.length || overlay.fieldEdits?.length || overlay.resolution === 'done') uids.add(String(overlay.unique_id || ''));
    }
    for (const move of payload.moves || []) uids.add(String(move.source?.uniqueId || ''));
    return uids;
}

function authorizeArgosReclassSubmissionRows(payload, state) {
    const entries = new Map((state.inquiryModel?.locationRows || []).map(entry => [String(entry.unique_id || ''), entry]));
    const uids = getTouchedReclassSourceUids(payload);
    if (!uids.size) uids.add(String(payload.source?.unique_id || state.item?.UNIQUE_ID || state.item?.unique_id || ''));
    for (const uid of uids) {
        const row = entries.get(uid)?.sourceRow;
        if (!uid || !row) throw new Error('A Reclass source row is no longer available. Review the worksheet.');
        if (!authorizeArgosReclassRow(row, state.sourceView || '', 'submit')) {
            throw new Error('Reclass is not authorized for one of the selected source rows.');
        }
        if (!canStageArgosReclassAction(entries.get(uid), getSubmittedPhysicalReclassAction(payload, uid))) {
            throw new Error('This physical Reclass source lot requires an active administrator.');
        }
    }
}

globalThis.getVerifiedReclassAdministrator = getVerifiedReclassAdministrator;
