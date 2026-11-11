function resolveExactSuspendOwner(item, code, state) {
    const canonicalCode = /^\d{6}\.\d{3}\.$/.test(code) ? code + '1' : code;
    let projection = item?.suspend_owner_zone_override !== undefined || item?.SUSPEND_OWNER_ZONE_OVERRIDE !== undefined ? item : null;
    if (!projection && typeof suspendTagInventory !== 'undefined' && suspendTagInventoryScope === getSupabaseReadIdentityScope()) {
        const uid = getDockSuspendDcRequestSourceUid(item);
        const identity = getSuspendTagInventoryIdentity(item,item);
        projection = suspendTagInventory.find(row => getDockSuspendDcRequestSourceUid(row) === uid
            && matchesSuspendTagInventoryIdentity(row,identity)) || null;
    }
    const ownerEvidence = projection || item;
    const projected = normalizeEvalAssignableUser(ownerEvidence?.suspend_eval_owner || ownerEvidence?.SUSPEND_EVAL_OWNER);
    if (projection?.suspend_owner_zone_override === true || projection?.SUSPEND_OWNER_ZONE_OVERRIDE === true) {
        return projected && projected !== 'unassigned' ? projected : 'Unassigned';
    }
    const linked = typeof getQueueCardInventoryRow === 'function' ? getQueueCardInventoryRow(item, 'request') : null;
    const target = linked && matchesSuspendTagInventoryIdentity(linked, getSuspendTagInventoryIdentity(item, item)) ? linked : item;
    const identity = { ...target, ITEMCODE: canonicalCode, itemcode: canonicalCode };
    const assignment = typeof getWarehouseAssignedRowForItem === 'function'
        ? getWarehouseAssignedRowForItem(identity) : null;
    if (assignment && typeof resolveManagerAssignedOwnerEvidence === 'function') {
        const evidence = resolveManagerAssignedOwnerEvidence(identity, state, true);
        return normalizeEvalAssignableUser(evidence.worker) || 'Unassigned';
    }
    if (!projection && typeof suspendTagRawSourceRowsReady !== 'undefined' && suspendTagRawSourceRowsReady
        && suspendTagInventoryScope === getSupabaseReadIdentityScope()) return 'Unassigned';
    const defaults = state.itemcodeDefaultOwners || state.defaultOwnersByCode;
    if (defaults?.has(canonicalCode)) {
        const row = defaults.get(canonicalCode);
        return normalizeEvalAssignableUser(typeof row === 'string' ? row : row?.assignedto) || 'Unassigned';
    }
    const { exact } = getCardEvalOwnerIndex(state, true);
    return exact.get(canonicalCode) || (projected && projected !== 'unassigned' ? projected : 'Unassigned');
}

function canCurrentUserViewDockSuspendDcRequests(item = null) {
    if (item?.DOCK_SUSPEND_DC_REQUEST === true) {
        const scope = queueAccessScope('suspend-tag');
        return canReadSuspendQueue() && (scope.all || resolveSuspendOwner(item) === scope.user);
    }
    if (!item && activeReqTab === 'suspend-tag') return canReadSuspendQueue();
    if (item && resolveCanonicalRowAccess(currentUser, item).canCompleteTag) return true;
    return DOCK_SUSPEND_WRITE_USERS.includes(normalizePushUsername(currentUser)) || resolveCanonicalRowAccess(currentUser, {}).canCompleteTag;
}

function resolveSuspendOwner(item) {
    const code = buildManagerEvalAssignmentKey(item?.ITEMCODE || item?.itemcode || item?.ITEM || item?.item);
    const state = getManagerAssignedColumnState();
    if (item?.DOCK_SUSPEND_DC_REQUEST === true || isDockSuspendDcRequestSource(item)) {
        return resolveExactSuspendOwner(item, code, state);
    }
    const { exact, family } = getCardEvalOwnerIndex(state);
    const owner = exact.get(code) || family.get(code.split('.')[0]);
    if (owner) return owner;
    for (const field of ['eval_user', 'assigned_user', 'default_owner', 'effective_worker', 'assignedto']) {
        const assigned = normalizeEvalAssignableUser(item?.[field] || item?.[field.toUpperCase()]);
        if (assigned && !['none', 'null', 'unassigned', 'n_a'].includes(assigned)) return assigned;
    }
    return 'Unassigned';
}

function getSuspendEvalOwner(item) {
    return resolveSuspendOwner(item);
}
