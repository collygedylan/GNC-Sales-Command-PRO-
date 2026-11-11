const FULL_NAVIGATION_USERNAMES = new Set([
    'nelly_aguilar', 'dylan_collyge', 'megan_kelly', 'jd_jones',
    'mitch_kaiser', 'morgan_anderson', 'melissa_dowty'
]);
const NAVIGATION_DISPLAY_CACHE_PREFIX = 'gnc-navigation-access-display-v1:';
let navigationDisplayCache = { owner: '', row: null };

function getNavigationDisplayStorage() {
    try { return window.localStorage; }
    catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'navigationDisplayStorage'); return null; }
}

function normalizeNavigationVisibilityUsername(value = '') {
    const username = String(value || '').trim().toLowerCase();
    return ['nally_aguilar', 'nellie_aguilar'].includes(username) ? 'nelly_aguilar' : username;
}

function getNavigationVisibilityIdentity(userOverride = '') {
    const username = normalizeNavigationVisibilityUsername(currentUser);
    if (!username || normalizeNavigationVisibilityUsername(userOverride || currentUser) !== username) return null;
    if (window.__agdataSessionBoundary === true || hasExplicitLogoutMarker() || hasConfirmedCurrentAccountRevocation()) return null;
    const profile = nativeAuthProfile;
    if (nativeAuthSessionActive === true && profile?.id) {
        if (profile.id !== nativeAuthSessionUserId || normalizeNavigationVisibilityUsername(profile.username) !== username) return null;
        return { id: profile.id, username, role: profile.role || currentRole || safeRole || '' };
    }
    if (!hasAuthenticatedOperationalReadIdentity()) return null;
    const record = typeof readPersistedAppSessionRecord === 'function' ? readPersistedAppSessionRecord() : null;
    const matchingRecord = record && normalizeNavigationVisibilityUsername(record.username) === username
        && typeof getCurrentAppSessionToken === 'function' && record.token === getCurrentAppSessionToken();
    const profileId = matchingRecord ? String(record.displayProfileId || '').trim() : '';
    return { id: profileId || `legacy:${username}`, username, role: currentRole || safeRole || '' };
}

function refreshNavigationDisplayCache() {
    const identity = getNavigationVisibilityIdentity();
    const owner = identity?.id ? `${identity.id}:${identity.username}` : '';
    if (!owner) { navigationDisplayCache = { owner: '', row: null }; return; }
    const storage = getNavigationDisplayStorage();
    if (navigationDisplayCache.owner !== owner) {
        navigationDisplayCache = { owner, row: readAccessDisplayCache(storage, identity, NAVIGATION_DISPLAY_CACHE_PREFIX) };
    }
    const source = getNavigationLiveDisplayRow(identity);
    const row = source ? sanitizeAccessDisplayMatrix({ ...source, username: identity.username }, identity.username) : null;
    if (!row || JSON.stringify(row) === JSON.stringify(navigationDisplayCache.row)) return;
    navigationDisplayCache.row = row;
    persistAccessDisplayCache(storage, identity, NAVIGATION_DISPLAY_CACHE_PREFIX, row);
}

function normalizeNavigationAccessRows(result) {
    if (!Array.isArray(result?.data)) return result;
    return { ...result, data: result.data.map(row => ({ ...row, username: normalizeNavigationVisibilityUsername(row.username) })) };
}

function resolveNavigationViewFlag(view, flags = {}) {
    const yes = value => String(value || '').trim().toUpperCase() === 'Y';
    if (String(view).startsWith('production:')) return resolveNavigationViewFlag('production', flags);
    if (typeof getManagerTableManagementKey === 'function' && getManagerTableManagementKey(view)) return resolveNavigationNurseryFlag(flags);
    if (view === 'request') {
        if (flags.view_que_request == null && flags.view_que_suspend == null) return resolveNavigationFlagValue(flags, 'view_que');
        return yes(flags.view_que_request) || yes(flags.view_que_suspend) ? 'Y' : 'N';
    }
    const keys = {
        drive:'drive_mode', communication:'comm', chat:'comm', 'department-calendar':'comm',
        'sales-inventory':'inventory', 'inventory-suggestion':'inventory', 'inv-consolidation':'inventory',
        'hl-order':'hl_order', 'sales-office':'sales_office', 'historical-requests':'historical_requests',
        'request-history':'historical_requests', tasks:'flyers', flyer:'flyers',
        reports:'eval_reports', 'manager-eval-reports':'eval_reports', 'eval-reports-2':'eval_reports_2',
        'queue-suspend':'que_suspend', 'queue-pending':'que_request',
        'table-management':'nursery_command_tables', 'production-workflow':'production',
        'bunch-note':'inventory', moves:'inventory', 'move-up':'inventory', review:'qc', reserves:'sales_office'
    };
    const key = 'view_' + (keys[view] || String(view).replaceAll('-', '_'));
    if (Object.hasOwn(flags, key)) return yes(flags[key]) ? 'Y' : 'N';
    if (view === 'drive' && flags.view_drive != null) return yes(flags.view_drive) ? 'Y' : 'N';
    const nested = QUICK_ACCESS_NESTED_ROUTES[view];
    return nested && nested.parent !== view ? resolveNavigationViewFlag(nested.parent, flags) : null;
}

function resolveNavigationNurseryFlag(flags) {
    if (flags.view_nursery_command_tables == null) return null;
    return String(flags.view_nursery_command_tables).toUpperCase() === 'Y' ? 'Y' : 'N';
}

function resolveNavigationFlagValue(flags, key) {
    if (flags[key] == null) return null;
    return String(flags[key]).trim().toUpperCase() === 'Y' ? 'Y' : 'N';
}

function getRoleNavigationDisplayDefaults(identity) {
    const catalog = window.GncUserAccessControl;
    const token = String(identity.role || '').trim().toLowerCase();
    const role = catalog?.normalizeRole?.(token === 'docks' ? 'dock' : token);
    if (role === 'dock_office') return new Set(['home', 'drive', 'av', 'request', 'docks', 'office', 'communication']);
    const sourceRole = token === 'production' ? 'grower' : identity.role || 'standard';
    const access = getRoleAccessState(sourceRole, currentUser);
    if (!role && token !== 'production') return new Set(['home', 'communication']);
    const defaults = new Set(access.allowedViews);
    // Presentation mirrors the canonical role_access_baselines seed; these are not action grants.
    const driveAv = ['admin', 'manager', 'supervisor', 'sales_rep', 'evaluator', 'kier', 'csr', 'data_entry'];
    if (driveAv.includes(role)) { defaults.add('drive'); defaults.add('av'); }
    if (['counter', 'qc_supervisor', 'foreman'].includes(role)) defaults.add('drive');
    defaults.add('request');
    return defaults;
}

function getNavigationLiveDisplayRow(identity) {
    return window.GncUserAccessControl?.state?.userAccess?.find(row =>
        normalizeNavigationVisibilityUsername(row.username) === identity.username
        && (!row.profile_id || row.profile_id === identity.id));
}

function getNavigationDisplayMatrix(identity) {
    const source = getNavigationLiveDisplayRow(identity);
    if (source) return source;
    if (navigationDisplayCache.owner !== `${identity.id}:${identity.username}`) refreshNavigationDisplayCache();
    return navigationDisplayCache.owner === `${identity.id}:${identity.username}` ? navigationDisplayCache.row : null;
}

function hasFullNavigationVisibility(userOverride = '') {
    const identity = getNavigationVisibilityIdentity(userOverride);
    if (!identity) return false;
    const role = String(identity.role || '').trim().toLowerCase().replace(/[-_\s]/g, '');
    return FULL_NAVIGATION_USERNAMES.has(identity.username) || ['admin', 'administrator', 'superadmin'].includes(role);
}

function canDisplayNavigationView(viewId = '', userOverride = '') {
    const view = String(viewId || '').trim();
    if (!view || ['crop-roll', 'manager-crop-roll'].includes(view)) return false;
    if (window.__agdataSessionBoundary === true || hasExplicitLogoutMarker() || hasConfirmedCurrentAccountRevocation()) return false;
    const identity = getNavigationVisibilityIdentity(userOverride);
    if (!identity) return false;
    const row = window.GncUserAccessControl?.state?.userAccess?.find(value => normalizeNavigationVisibilityUsername(value.username) === identity.username);
    const staleProfile = row?.profile_id && row.profile_id !== identity.id;
    if (!staleProfile && canAccessView(view, userOverride)) return true;
    if (hasFullNavigationVisibility(userOverride)) {
        return view === 'home' || view === 'smart-moves' || ROLE_ACCESS_VIEWS.includes(view)
            || Object.prototype.hasOwnProperty.call(QUICK_ACCESS_NESTED_ROUTES, view);
    }
    if (view === 'home') return true;
    const matrix = getNavigationDisplayMatrix(identity);
    const flag = resolveNavigationViewFlag(view, matrix?.view_permissions);
    if (flag === 'N') return false;
    if (flag === 'Y' || (!staleProfile && canAccessView(view, userOverride))) return navigationPreferencesAllowed(view, true);
    const defaults = getRoleNavigationDisplayDefaults(identity);
    const nested = QUICK_ACCESS_NESTED_ROUTES[view];
    return defaults.has(nested?.parent || view) && navigationPreferencesAllowed(view, true);
}

function canDisplayQuickAccessView(view = '') {
    const route = String(view || '').trim();
    if (route.startsWith('production:')) return canDisplayNavigationView('production-workflow');
    return canDisplayNavigationView(route);
}

function navigateDisplayedQuickAccessView(view = '') {
    const route = String(view || '').trim();
    if (!canDisplayQuickAccessView(route)) return false;
    if (canAccessQuickAccessView(route)) return navigateQuickAccessView(route);
    const target = QUICK_ACCESS_NESTED_ROUTES[route]?.parent || (route.startsWith('production:') ? 'production-workflow' : route);
    return switchView(target);
}

function getNavigationDisplayChoices() {
    const choices = [...getHomeModuleRegistry().map(module => module.view), 'tasks', 'take-back', 'weather-hold', 'shear-list', 'bunch-note'];
    return [...new Set(choices)].filter(view => canDisplayNavigationView(view));
}

function getNavigationHomeModuleRegistry(base, smartMoves) {
    const modules = hasFullNavigationVisibility() || isAuthenticatedExecutiveUser('view_smart_moves') ? [...base, smartMoves] : base;
    const role = getNavigationVisibilityIdentity()?.role;
    const dockRole = window.GncUserAccessControl?.normalizeRole?.(String(role || '').toLowerCase() === 'docks' ? 'dock' : role) === 'dock_office';
    if (!dockRole || hasFullNavigationVisibility()) return modules;
    return [...modules, { view: 'docks', label: 'Docks', icon: 'ph-truck', action: "switchView('docks')" }];
}

function canShowFooterViewButton(viewId = '', access = getRoleAccessState()) {
    const targetView = String(viewId || '').trim();
    if (!targetView) return false;
    if (hasFullNavigationVisibility()) return canDisplayNavigationView(targetView);
    if (isSalesShellAccess(access)) return targetView === 'sales' || (['request', 'sales-inventory'].includes(targetView) && canDisplayNavigationView(targetView));
    if (targetView === 'sales') return false;
    return canDisplayNavigationView(targetView);
}

function applyNavigationElementVisibility(element, visible) {
    if (!element) return;
    element.classList.toggle('hidden', !visible);
    element.hidden = !visible;
    element.style.display = '';
    if (!visible) element.classList.remove('active');
}

function syncRegisteredNavigationElements(access, userOverride, fullVisibility) {
    Object.entries(ROLE_VIEW_ELEMENT_IDS).forEach(([view, ids]) => {
        const salesHidden = !fullVisibility && isSalesShellAccess(access) && !['sales', 'sales-inventory'].includes(view);
        const visible = !salesHidden && canDisplayNavigationView(view, userOverride);
        const hideEvalInventory = !fullVisibility && access?.isEval && !access.isAdmin && !canUseInvBunchNotes();
        ids.forEach(id => applyNavigationElementVisibility(document.getElementById(id),
            visible && !(hideEvalInventory && ['drawer-sales-inventory-btn', 'home-tile-sales-inventory'].includes(id))));
    });
    applyNavigationElementVisibility(document.getElementById('drawer-home-btn'), fullVisibility || !isSalesShellAccess(access));
}

function syncHomeModuleVisibility(access, userOverride, fullVisibility, grid) {
    let authorized = 0;
    getHomeModuleRegistry().forEach(module => {
        const tile = document.getElementById(`home-tile-${module.view}`);
        if (!tile) return;
        const visible = canDisplayNavigationView(module.view, userOverride) && (fullVisibility || !isSalesShellAccess(access));
        applyNavigationElementVisibility(tile, visible);
        tile.setAttribute('aria-hidden', String(!visible));
        if (visible) authorized += 1;
    });
    if (!grid) return;
    grid.dataset.authorizedModuleCount = String(authorized);
    grid.dataset.renderedModuleCount = String(grid.querySelectorAll('[data-home-module-view]:not([hidden])').length);
    syncHomeAccountNavigation(grid, authorized);
}

function syncHomeAccountNavigation(grid, authorized) {
    let tile = grid.querySelector('[data-home-account-navigation]');
    if (authorized > 0 || !getNavigationVisibilityIdentity()) { tile?.remove(); return; }
    const target = ['communication', 'request'].find(view => canDisplayNavigationView(view)) || 'home';
    const label = { communication: 'Comm', request: 'Que', home: 'Menu' }[target];
    if (!tile) {
        tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'home-module-tile';
        tile.dataset.homeAccountNavigation = 'true';
        grid.append(tile);
    }
    tile.dataset.homeModuleView = target;
    tile.innerHTML = `<i class="ph ${target === 'home' ? 'ph-list' : 'ph-chat-circle-dots'}" aria-hidden="true"></i><span>${label}</span>`;
    tile.onclick = () => target === 'home' ? setMenuOpenState(true) : switchView(target);
    grid.dataset.authorizedModuleCount = '1';
    grid.dataset.renderedModuleCount = '1';
}

function syncNavigationDisplayStatus(host, message = '') {
    if (!host) return;
    let status = host.querySelector(':scope > [data-navigation-display-status]');
    if (!message) { status?.remove(); return; }
    if (!status) {
        status = document.createElement('p');
        status.dataset.navigationDisplayStatus = 'true';
        status.setAttribute('role', 'status');
        host.append(status);
    }
    status.textContent = message;
}

function syncNavigationVisibilityUi(access, userOverride, grid) {
    const fullVisibility = hasFullNavigationVisibility(userOverride);
    syncRegisteredNavigationElements(access, userOverride, fullVisibility);
    syncHomeModuleVisibility(access, userOverride, fullVisibility, grid);
    document.querySelectorAll('#side-drawer [data-drawer-view]').forEach(element =>
        applyNavigationElementVisibility(element, canDisplayNavigationView(element.dataset.drawerView, userOverride)));
    applyNavigationElementVisibility(document.getElementById('drawer-bloom-picker-btn'), canDisplayNavigationView('bloom', userOverride));
    if (typeof syncRequestSalesImpactOwnership === 'function') syncRequestSalesImpactOwnership();
    scheduleHomeDashboardFitSettle('role-access-ui');
}
