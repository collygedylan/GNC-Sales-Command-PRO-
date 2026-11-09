function resolveExactSuspendOwner(item, code, state) {
    const canonicalCode = /^\d{6}\.\d{3}\.$/.test(code) ? code + '1' : code;
    const defaults = state.itemcodeDefaultOwners || state.defaultOwnersByCode;
    if (defaults?.has(canonicalCode)) {
        const row = defaults.get(canonicalCode);
        return normalizeEvalAssignableUser(typeof row === 'string' ? row : row?.assignedto) || 'Unassigned';
    }
    const { exact } = getCardEvalOwnerIndex(state, true);
    const projected = normalizeEvalAssignableUser(item?.suspend_eval_owner || item?.SUSPEND_EVAL_OWNER);
    return exact.get(canonicalCode) || (projected && projected !== 'unassigned' ? projected : 'Unassigned');
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
