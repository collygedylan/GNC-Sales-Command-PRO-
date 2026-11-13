function resolveExactSuspendOwner(item, code, state) {
    const canonicalCode = normalizeSuspendOwnerCode(code);
    let projection = item?.suspend_owner_zone_override !== undefined || item?.SUSPEND_OWNER_ZONE_OVERRIDE !== undefined ? item : null;
    if (!projection && typeof suspendTagInventory !== 'undefined' && suspendTagInventoryScope === getSupabaseReadIdentityScope()) {
        const uid = getDockSuspendDcRequestSourceUid(item);
        const identity = getSuspendTagInventoryIdentity(item,item);
        projection = suspendTagInventory.find(row => getDockSuspendDcRequestSourceUid(row) === uid
            && matchesSuspendTagInventoryIdentity(row,identity)) || null;
        if (!projection && suspendTagInventory.some(row => getDockSuspendDcRequestSourceUid(row) === uid)) return 'Unassigned';
    }
    const ownerEvidence = projection || item;
    const projected = validSuspendOwner(ownerEvidence?.suspend_eval_owner || ownerEvidence?.SUSPEND_EVAL_OWNER);
    if (projection?.suspend_owner_zone_override === true || projection?.SUSPEND_OWNER_ZONE_OVERRIDE === true) {
        return projected || 'Unassigned';
    }
    const linked = typeof getQueueCardInventoryRow === 'function' ? getQueueCardInventoryRow(item, 'request') : null;
    const target = linked && matchesSuspendTagInventoryIdentity(linked, getSuspendTagInventoryIdentity(item, item)) ? linked : item;
    const identity = { ...target, ITEMCODE: canonicalCode, itemcode: canonicalCode };
    const assignment = typeof getWarehouseAssignedRowForItem === 'function'
        ? getWarehouseAssignedRowForItem(identity) : null;
    if (assignment && typeof resolveManagerAssignedOwnerEvidence === 'function') {
        const evidence = resolveManagerAssignedOwnerEvidence(identity, state, true);
        const owner = validSuspendOwner(evidence.worker);
        if (owner) return owner;
    }
    return resolveSuspendOwnerFallback(canonicalCode, state, projected);

}

function canCurrentUserViewDockSuspendDcRequests(item = null) {
    if (item?.DOCK_SUSPEND_DC_REQUEST === true) {
        const scope = queueAccessScope('suspend-tag');
        return canReadSuspendQueue() && (scope.all || resolveSuspendOwner(item) === scope.user);
    }
    if (!item && activeReqTab === 'suspend-tag') return canReadSuspendQueue();
    if (item && resolveCanonicalRowAccess(currentUser, item).canCompleteTag) return true;
    return resolveCanonicalRowAccess(currentUser, {}).canEditAnyRow;
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

function normalizeSuspendOwnerCode(value) {
    const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/\.+$/, '');
    if (/^\d{1,6}$/.test(code)) return code.padStart(6, '0');
    const parts = code.match(/^(\d{1,6})\.(\d{1,3})(?:\.(\d+))?$/);
    return parts ? parts[1].padStart(6,'0')+'.'+parts[2].padStart(3,'0')+'.'+(Number(parts[3] || 1)) : code;
}

function validSuspendOwner(value) {
    const owner = normalizeSuspendQueueOwner(value);
    return owner && !['none','null','Unassigned','n_a'].includes(owner) ? owner : '';
}

function suspendOwnerFromRow(row) {
    if (typeof row === 'string') return validSuspendOwner(row);
    return validSuspendOwner(row?.assignedto || row?.ASSIGNEDTO || row?.default_owner || row?.DEFAULT_OWNER
        || row?.default_assignedto || row?.effective_worker || row?.EFFECTIVE_WORKER || row?.eval_user || row?.EVAL_USER);
}

function resolveSuspendOwnerFallback(code, state, projected) {
    const defaults = state.itemcodeDefaultOwners || state.defaultOwnersByCode;
    const exactDefault = defaults?.get(code);
    if (defaults?.has(code) && (exactDefault === null || exactDefault?.assignedto === null)) return 'Unassigned';
    const direct = suspendOwnerFromRow(exactDefault);
    if (direct) return direct;
    const { exact } = getCardEvalOwnerIndex(state, true);
    const indexed = validSuspendOwner(exact.get(code));
    if (indexed) return indexed;
    const entries = [...(defaults?.entries() || [])];
    const inventory = state.fullInventory || [];
    const normalized = collectSuspendOwnerCandidates(entries, inventory, code, false);
    if (normalized.size === 1) return [...normalized][0];
    if (normalized.size > 1) return 'Unassigned';
    const confirmed = validSuspendOwner(projected);
    if (confirmed) return confirmed;
    const family = collectSuspendOwnerCandidates(entries, inventory, code, true);
    return family.size === 1 ? [...family][0] : 'Unassigned';
}

function collectSuspendOwnerCandidates(entries, inventory, code, family) {
    const owners = new Set();
    const matches = candidate => family ? candidate.split('.')[0] === code.split('.')[0] : candidate === code;
    for (const [key, row] of entries) {
        const candidate = normalizeSuspendOwnerCode(row?.itemcode_normalized || row?.itemcode || key);
        const owner = suspendOwnerFromRow(row);
        if (matches(candidate) && owner) owners.add(owner);
    }
    for (const row of inventory) {
        if (row.present_in_drive === false) continue;
        const candidate = normalizeSuspendOwnerCode(row.ITEMCODE || row.itemcode);
        const owner = suspendOwnerFromRow(row);
        if (matches(candidate) && owner) owners.add(owner);
    }
    return owners;
}
