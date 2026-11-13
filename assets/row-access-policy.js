const GLOBAL_LIVE_CHANGE_USER_KEYS = new Set([
    'dylan_collyge', 'megan_kelly', 'jd_jones', 'mitch_kaiser',
    'nelly_aguilar', 'nally_aguilar', 'morgan_anderson', 'melissa_dowty'
]);

function normalizeEvidenceActor(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_')
        .replace(/^_+|_+$/g,'').replace(/^nally_aguilar$/,'nelly_aguilar');
}

function getCanonicalAccessSessionIdentity() {
    const actor = normalizeEvidenceActor(currentUser);
    if (!actor || globalThis.__agdataSessionBoundary === true
        || typeof hasExplicitLogoutMarker === 'function' && hasExplicitLogoutMarker()
        || typeof hasConfirmedCurrentAccountRevocation === 'function' && hasConfirmedCurrentAccountRevocation()) return null;
    const profile = typeof nativeAuthProfile === 'undefined' ? null : nativeAuthProfile;
    if (typeof nativeAuthSessionActive !== 'undefined' && nativeAuthSessionActive) {
        if (!profile?.id || profile.id !== nativeAuthSessionUserId || normalizeEvidenceActor(profile.username) !== actor) return null;
        return {id:profile.id,username:actor,authenticated:true,sessionKey:profile.id,legacy:false};
    }
    const record = typeof readPersistedAppSessionRecord === 'function' ? readPersistedAppSessionRecord() : null;
    const token = typeof getCurrentAppSessionToken === 'function' ? getCurrentAppSessionToken() : '';
    if (!token || record?.token !== token || normalizeEvidenceActor(record.username) !== actor
        || !(Number(record.expiresAt) > Date.now()) || record.mustChangePassword) return null;
    return {id:'app:'+actor,username:actor,authenticated:true,sessionKey:token,legacy:true};
}

function verifiedAppEvidenceProfile(actor) {
    const identity = getCanonicalAccessSessionIdentity();
    const self = globalThis.GncUserAccessControl?.getSelfState?.();
    if (!identity?.legacy || typeof navigator !== 'undefined' && navigator.onLine === false
        || self?.status !== 'ready' || self.verified !== true || self.denied || !self.profile?.id
        || normalizeEvidenceActor(self.profile.username) !== actor) return null;
    return self.profile;
}

function verifiedEvidenceActor(user = currentUser) {
    const actor = normalizeEvidenceActor(user);
    const active = typeof nativeAuthSessionActive !== 'undefined' && nativeAuthSessionActive;
    const profile = active ? nativeAuthProfile : verifiedAppEvidenceProfile(actor);
    const profileId = active ? nativeAuthSessionUserId : profile?.id;
    if (!profile?.id || profile.id !== profileId || normalizeEvidenceActor(profile.username) !== actor
        || actor !== normalizeEvidenceActor(currentUser) || profile.active === false || profile.disabled_at
        || profile.must_change_password || profile.locked_until && Date.parse(profile.locked_until) > Date.now()
        || typeof hasConfirmedCurrentAccountRevocation === 'function' && hasConfirmedCurrentAccountRevocation()
        || globalThis.GncUserAccessControl?.getSelfState?.().denied === true) return null;
    const matrix = resolveUserAccessMatrix(actor);
    return matrix?.verified === true && String(matrix.profile_id || '') === String(profile.id) ? {actor,profile,matrix} : null;
}

function evidenceModuleAllowed(identity, viewFlag, permissionFlag) {
    const value = identity.matrix.view_permissions?.[viewFlag] ?? identity.matrix[viewFlag];
    if (value === 'N' || value === false) return false;
    if (value === 'Y' || value === true) return true;
    const resolved = globalThis.GncUserAccessControl?.getEffectiveUserPermissions?.(identity.profile);
    return resolved?.verified === true && resolved.profile?.id === identity.profile.id
        && resolved.permissions?.[permissionFlag] === true;
}

function resolveEvidenceRowAuthority(user = currentUser) {
    const actor = normalizeEvidenceActor(user || currentUser);
    const session = getCanonicalAccessSessionIdentity();
    if (!session || session.username !== actor) return null;
    const self = globalThis.GncUserAccessControl?.getSelfState?.();
    const profile = session.legacy ? self?.profile : nativeAuthProfile;
    if (self?.denied || profile?.active === false || profile?.disabled_at || profile?.must_change_password
        || profile?.locked_until && Date.parse(profile.locked_until) > Date.now()) return null;
    const resolved = typeof resolveUserAccessMatrix === 'function' ? resolveUserAccessMatrix(actor) : null;
    const matrix = resolved?.__pendingAccessWrite ? null : resolved;
    const role = String(matrix?.role || currentRole || '').trim().toUpperCase().replace(/[ _-]/g,'');
    const power = GLOBAL_LIVE_CHANGE_USER_KEYS.has(actor) || ['SUPERADMIN','ADMIN','ADMINISTRATOR','MANAGER'].includes(role)
        || matrix?.edit_any_row === 'Y';
    const scoped = ['EVAL','EVALUATOR'].includes(role) || matrix?.edit_assigned_rows_only === 'Y';
    return {actor,profile,matrix,power,scoped};
}

function evidenceViewPermitted(matrix, viewFlag) {
    const value = matrix?.view_permissions?.[viewFlag] ?? matrix?.[viewFlag];
    return value !== 'N' && value !== false;
}

function canEditScopedEvidenceRow(authority, row) {
    if (!authority || !row) return false;
    if (authority.power) return true;
    if (!authority.scoped) return false;
    const owner = resolveInventoryRowOwner(row);
    return owner ? owner === authority.actor : !!(row.ITEMCODE || row.itemcode || row.ITEM || row.item);
}

function canEditDockMirrorEvidence(item, capability) {
    const identity = verifiedEvidenceActor();
    if (!identity || !evidenceModuleAllowed(identity,'view_que','can_access_que')
        || requestActionDeniedByReceipt(identity,capability) || !canCurrentUserViewDockSuspendDcRequests(item)) return false;
    return identity.matrix.edit_any_row === 'Y'
        || identity.matrix.edit_assigned_rows_only === 'Y' && resolveInventoryRowOwner(item) === identity.actor;
}

function resolveInventoryRowOwner(row) {
    const code = buildManagerEvalAssignmentKey(row?.ITEMCODE || row?.itemcode || row?.ITEM || row?.item);
    const assigned = getCardEvalOwnerIndex(getManagerAssignedColumnState(),true).exact.get(code);
    if (assigned) return normalizeEvidenceActor(assigned);
    for (const key of ['eval_user','default_owner','effective_worker','default_assignedto','assignedto']) {
        const owner = normalizeEvidenceActor(row?.[key] || row?.[key.toUpperCase()]);
        if (owner && !['unassigned','none','null','n_a'].includes(owner)) return owner;
    }
    return '';
}

function resolveCanonicalRowAccess(user, row) {
    const authority = resolveEvidenceRowAuthority(user);
    const permitted = authority && ['view_drive_mode','view_av','view_que'].some(view => evidenceViewPermitted(authority.matrix,view));
    const canEdit = !!permitted && canEditScopedEvidenceRow(authority,row);
    return {canView:!!(normalizeEvidenceActor(user || currentUser) && row),canEditAnyRow:!!authority?.power,canEdit,
        canUnlock:canEdit,canReclass:canEdit,canUploadPhoto:canEdit,canCompleteTag:canEdit,canManageLocations:canEdit};
}

function canUserUnlockRow(user, row) {
    return resolveCanonicalRowAccess(user,row).canUnlock;
}

function tableRequestRole(identity) {
    return String(identity.matrix.role || identity.profile.role || '').replace(/[^a-z]/gi,'').toLowerCase();
}

function getRetainedRequestWorkCapabilities() {
    const identity = verifiedEvidenceActor();
    if (!identity || !evidenceModuleAllowed(identity,'view_que','can_access_que')) return null;
    const role = tableRequestRole(identity);
    const eligible = identity.matrix.edit_any_row === 'Y' || identity.matrix.edit_assigned_rows_only === 'Y'
        || ['rep','sales','salesrep','csr','office','salesoffice','eval','evaluator','admin','administrator','manager','superadmin'].includes(role);
    return {canTakePhoto:eligible,canEdit:eligible,canComplete:eligible,
        scope:identity.matrix.edit_any_row === 'Y' ? 'global' : 'own'};
}

function requestActionDeniedByReceipt(identity, action) {
    const state = typeof requestCapabilityState === 'undefined' ? null : requestCapabilityState;
    if (!state || state.stale || state.status !== 'ready' || !identity.profile?.id || state.profileId !== identity.profile.id
        || normalizeEvidenceActor(state.username) !== identity.actor) return false;
    const field = action === 'photo' ? 'canTakePhoto' : action === 'complete' ? 'canComplete' : 'canEdit';
    return state.capabilities?.canViewQueue === false || state.capabilities?.[field] === false;
}

function ownsExactRequestWorkRow(identity, item) {
    if (resolveInventoryRowOwner(item) === identity.actor) return true;
    const names = new Set([identity.actor,identity.profile.id,identity.profile.username,identity.profile.display_name,
        identity.profile.email].filter(Boolean).map(normalizeEvidenceActor));
    const fields = ['submitted_by','request_created_by_username','request_created_by_display','request_created_by_email',
        'created_by_username','created_by_display','created_by_email','request_selected_rep_username','request_selected_rep_display','requested_by'];
    return fields.some(key => names.has(normalizeEvidenceActor(item[key] ?? item[key.toUpperCase()])));
}

function canCurrentUserWorkRequestItem(item = null, action = 'edit') {
    const actionKey = String(action || 'edit').trim().toLowerCase();
    if (!item || (item.REQUEST_HISTORY && actionKey !== 'queued-photo')) return false;
    const capability = actionKey === 'queued-photo' ? 'photo' : actionKey;
    if (isDockSuspendDcRequestMirrorRow(item)) return canEditDockMirrorEvidence(item,capability);
    const authority = resolveEvidenceRowAuthority();
    if (!authority || !evidenceViewPermitted(authority.matrix,'view_que')) return false;
    if (requestActionDeniedByReceipt(authority,capability)) return false;
    if (canEditScopedEvidenceRow(authority,item)) return true;
    const identity = verifiedEvidenceActor();
    if (!identity || !evidenceModuleAllowed(identity,'view_que','can_access_que')) return false;
    const fallback = getRetainedRequestWorkCapabilities();
    const allowed = capability === 'photo' ? fallback?.canTakePhoto : capability === 'complete' ? fallback?.canComplete : fallback?.canEdit;
    return !!(allowed && (identity.matrix.edit_any_row === 'Y' || ownsExactRequestWorkRow(identity,item)));
}

function canEditEvidenceWorkflow(prefix, item, sourceView = '') {
    const source = String(sourceView || activeDetailSourceView || lastView || '').trim().toLowerCase();
    const av = ['av','av-photo'].includes(source);
    if (av && globalThis.__agdataAvKioskState?.active === true) return false;
    if (prefix === 'req-') return canCurrentUserWorkRequestItem(item);
    const authority = resolveEvidenceRowAuthority();
    return canEditScopedEvidenceRow(authority,item) && evidenceViewPermitted(authority.matrix,av ? 'view_av' : 'view_drive_mode');
}

function canPublishRowEvidenceCommand(item, options) {
    if (options?.receipt || options?.seasonSalesOffice) return true;
    if (options?.requestWork) return canCurrentUserWorkRequestItem(item,requestEvidenceAction(options));
    if (!options || options.suspendCompletionScope) return canCurrentUserWorkRequestItem(item);
    if (['ssn-','lsn-','na-','global-','req-'].includes(options.prefix)) return canEditEvidenceWorkflow(options.prefix,item,options.sourceView);
    return true;
}

function requestEvidenceAction(options) {
    if (options.complete) return 'complete';
    if (options.queuedPhotoId) return 'queued-photo';
    return options.photoAttachmentUrl ? 'photo' : 'edit';
}

function canEditRowDetails(prefix = '', itemOverride = null) {
    if (!itemOverride && globalThis.isAvDetailReadOnlyContext()) return false;
    const normalizedPrefix = String(prefix || '').trim();
    const item = getEditableDetailItemForPrefix(normalizedPrefix,itemOverride);
    if (['req-','ssn-','lsn-','na-','global-'].includes(normalizedPrefix)) return canEditEvidenceWorkflow(normalizedPrefix,item);
    const access = getRoleAccessState();
    const matrix = resolveUserAccessMatrix();
    if (canUserEditRow(currentUser,item)) return true;
    if (matrix?.edit_assigned_rows_only === 'Y' || access?.isEval) return false;
    if (normalizedPrefix === 'flyer-' && matrix?.flyer_folder_access === 'Y') return true;
    if (isRepReadOnlyUser() && !canRepEditDetailPrefix(normalizedPrefix)) return false;
    if (isRestrictedEvalUser(access) && !canRestrictedEvalUserUpdateItem(item)) return false;
    if (isDriveModePhotoDataEditContext(normalizedPrefix,item) && !canCurrentUserUpdateDrivePhotoData(item,normalizedPrefix)) return false;
    if (normalizedPrefix === 'hold-release-') return true;
    if (activeItem && isSalesOfficeLikeItem(activeItem) && canAccessView('sales-office')) return true;
    if (normalizedPrefix === 'dock-') return canEditDockWorkflow();
    return true;
}

function canUnlockProtectedData() {
    return canUserUnlockRow(currentUser,activeItem);
}

function canUsePhotoDeleteOverride() {
    return canUserUploadRowPhoto(currentUser,activeItem);
}
