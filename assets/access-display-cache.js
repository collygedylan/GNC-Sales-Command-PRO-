function sanitizeAccessDisplayMatrix(row, username) {
    if (!row || String(row.username || '').trim().toLowerCase() !== username) return null;
    const result = { username, role: String(row.role || '').trim(), revision: Number(row.revision) || 0 };
    const flags = ['make_request', 'can_make_request', 'request_all_reps', 'view_all_requests', 'edit_any_row',
        'can_edit_all_rows', 'edit_assigned_rows_only', 'can_edit_assigned_items', 'flyer_folder_access',
        'can_manage_flyers', 'create_project', 'submit_reclass', 'complete_suspend_tag', 'approve_suspend_tags',
        'manage_tables', 'manage_user_access', 'use_weather_hold_risk_tools', 'use_aura_assistant',
        'view_all_suspend', 'view_nursery_command_tables'];
    for (const flag of flags) {
        if (typeof row[flag] === 'boolean' || /^(Y|N)$/i.test(String(row[flag] ?? ''))) result[flag] = row[flag];
    }
    result.view_permissions = Object.fromEntries(Object.entries(row.view_permissions || {})
        .filter(([key, value]) => /^view_[a-z0-9_]+$/.test(key) && /^(Y|N)$/i.test(String(value)))
        .map(([key, value]) => [key, String(value).toUpperCase()]));
    if (typeof row.profile_id === 'string' && row.profile_id.length <= 128) result.profile_id = row.profile_id.trim();
    for (const key of ['sales_rep_access', 'allowed_request_reps']) {
        if (row[key] && typeof row[key] === 'object') result[key] = sanitizeAccessDisplayRepMap(row[key]);
    }
    for (const key of ['request_default_scope', 'suspend_default_scope']) {
        if (['ALL', 'OWN', 'ASSIGNED', 'GLOBAL', 'REP', 'CREATED', 'EVAL', 'ROLE'].includes(String(row[key]).toUpperCase())) result[key] = row[key];
    }
    return result;
}

function sanitizeAccessDisplayRepMap(value) {
    return Object.fromEntries(Object.entries(value).slice(0, 1000)
        .filter(([key, flag]) => key.length > 0 && key.length <= 150 && !/[\u0000-\u001f]/.test(key)
            && (typeof flag === 'boolean' || /^(Y|N)$/i.test(String(flag)))));
}

function readAccessDisplayCache(storage, identity, prefix) {
    if (!storage || !identity) return null;
    try {
        const parsed = JSON.parse(storage.getItem(prefix + identity.username) || 'null');
        const row = sanitizeAccessDisplayMatrix(parsed?.matrixRow, identity.username);
        if (row?.profile_id && row.profile_id !== identity.id) return null;
        return parsed?.profileId === identity.id && parsed?.username === identity.username ? row : null;
    } catch { return null; }
}

function persistAccessDisplayCache(storage, identity, prefix, matrixRow) {
    if (!storage || !identity || !matrixRow) return;
    try {
        storage.setItem(prefix + identity.username, JSON.stringify({
            username: identity.username, matrixRow: sanitizeAccessDisplayMatrix(matrixRow, identity.username),
            profileId: matrixRow.profile_id || identity.id, savedAt: Date.now()
        }));
    } catch (error) {
        globalThis.GncRuntimeWatchdog?.capture?.(error, 'persistDisplayCache');
    }
}
