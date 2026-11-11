export function resolveTableDrivenAccessMatrix(input) {
    const {name,saved,display,roleValue,aliasPairs,yn,isSuperAdminRole,canonicalSalesRepAccess} = input;
    const sourceRole = saved?.role || roleValue || '';
    const role = String(sourceRole).replace(/[^a-z]/gi,'').toLowerCase();
    const verified = !!saved && saved.__pendingAccessWrite !== true;
    const superAdmin = verified && isSuperAdminRole(sourceRole);
    const admin = verified && ['superadmin','admin','administrator','manager'].includes(role);
    const requestRoles = ['csr','salesoffice','office','eval','evaluator'];
    const full = admin ? 'Y' : 'N', own = verified ? 'Y' : 'N';
    const result = {
        username:name,role:sourceRole,display_name:display?.display_name || name,
        make_request:own,can_make_request:own,request_all_reps:admin || verified && requestRoles.includes(role) ? 'Y' : 'N',
        view_all_requests:full,request_default_scope:admin ? 'ALL' : 'OWN',view_all_suspend:full,suspend_default_scope:'OWN',
        edit_any_row:full,can_edit_all_rows:full,
        edit_assigned_rows_only:verified && ['eval','evaluator'].includes(role) ? 'Y' : 'N',
        can_edit_assigned_items:verified && ['eval','evaluator'].includes(role) ? 'Y' : 'N',
        flyer_folder_access:verified && (admin || ['sales','salesrep','rep','csr'].includes(role)) ? 'Y' : 'N',
        can_manage_flyers:'N',create_project:own,submit_reclass:superAdmin ? 'Y' : 'N',
        complete_suspend_tag:superAdmin ? 'Y' : 'N',approve_suspend_tags:superAdmin ? 'Y' : 'N',
        manage_tables:superAdmin ? 'Y' : 'N',manage_user_access:superAdmin ? 'Y' : 'N',
        use_weather_hold_risk_tools:superAdmin ? 'Y' : 'N',use_aura_assistant:superAdmin ? 'Y' : 'N',
        sales_rep_access:{[name]:'Y'},allowed_request_reps:{[name]:'Y'},view_permissions:{},revision:0,...saved
    };
    result.can_manage_flyers = result.flyer_folder_access;
    for (const [primary,alias] of aliasPairs) {
        const flag = resolveMatrixAliasFlag(saved,primary,alias,result[primary],yn);
        result[primary] = result[alias] = flag;
    }
    result.sales_rep_access = canonicalSalesRepAccess(saved?.allowed_request_reps || result.allowed_request_reps,
        saved?.sales_rep_access || result.sales_rep_access);
    result.allowed_request_reps = {...result.sales_rep_access};
    const nursery = saved?.view_permissions?.view_nursery_command_tables ?? saved?.view_nursery_command_tables ?? (superAdmin ? 'Y' : 'N');
    result.view_nursery_command_tables = yn(nursery);
    result.view_permissions = {...result.view_permissions,view_nursery_command_tables:result.view_nursery_command_tables};
    result.verified = verified;
    return result;
}

function resolveMatrixAliasFlag(saved, primary, alias, fallback, yn) {
    const values = [saved?.[primary],saved?.[alias]].filter(value => value != null);
    if (!values.length) return fallback;
    return values.some(value => yn(value) === 'N') ? 'N' : 'Y';
}

globalThis.resolveTableDrivenAccessMatrix = resolveTableDrivenAccessMatrix;

export function sameAccessSession(left, right) {
    return !!(left && right && left.id === right.id && left.username === right.username && left.sessionKey === right.sessionKey);
}

export function resolveVerifiedAccessSelf(record, identity) {
    if (!record?.verified || !identity || record.profile.username !== identity.username
        || record.sessionKey !== identity.sessionKey || !identity.legacy && record.profile.id !== identity.id) return null;
    return record;
}

export function resolveAccessSelfState(input) {
    const {status,denied,error,identity} = input;
    const record = resolveVerifiedAccessSelf(input.record,identity);
    return {status,denied,verified:!!record && status === 'ready',error,
        profile:record?.profile ? {...record.profile} : null,role:record?.role || '',
        baseline:record ? {...record.baseline} : null,overrides:record ? {...record.permission_overrides} : null,
        permissions:record ? {...record.effective_permissions} : null,
        dataHydrationPolicy:record?.data_hydration_policy ? {...record.data_hydration_policy} : null,revision:record?.revision || 0};
}

Object.assign(globalThis,{sameAccessSession,resolveVerifiedAccessSelf,resolveAccessSelfState});
