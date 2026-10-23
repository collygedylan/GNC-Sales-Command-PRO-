(function (root) {
    'use strict';

    const PERMISSION_KEYS = Object.freeze([
        'can_access_drive_mode', 'can_access_av', 'can_access_que', 'can_access_manager_tab',
        'can_manage_user_access', 'can_access_eval_reports_2', 'can_submit_reclass',
        'can_complete_suspend_tag', 'can_approve_deny_suspend'
    ]);
    const FULL_APP_ADMINISTRATORS = Object.freeze(['dylan_collyge', 'megan_kelly', 'jd_jones']);
    const isFullAppAdministrator = username => FULL_APP_ADMINISTRATORS.includes(text(username).toLowerCase());
    const isAuraOwner = username => text(username).trim().toLowerCase() === 'dylan_collyge';
    function enforceAccountPermissions(username, permissions) {
        const result = normalizePermissions(permissions);
        if (isFullAppAdministrator(username)) for (const flag of PERMISSION_KEYS) result[flag] = true;
        result.can_manage_user_access = isFullAppAdministrator(username);
        return result;
    }
    const ROLE_ALIASES = Object.freeze({
        admin: ['ADMIN', 'ADMINISTRATOR', 'SUPERADMIN', 'SUPER ADMIN'],
        manager: ['MANAGER'],
        supervisor: ['SUPERVISOR', 'DATA ENTRY SUPERVISOR', 'DATA-ENTRY SUPERVISOR'],
        sales_rep: ['REP', 'SALES REP', 'SALES_REP', 'SALESREP', 'SALES', 'SALE', 'SALES USER', 'SALES ROLE'],
        evaluator: ['EVAL', 'EVALUATOR', 'EVALUATION'],
        counter: ['QC'],
        kier: ['KIER'],
        dock_office: ['DOCK OFFICE', 'DOCK/OFFICE', 'OFFICE', 'DOCK'],
        qc_supervisor: ['QC SUPERVISOR', 'QC-SUPERVISOR', 'QCSUPERVISOR', 'QCSUP'],
        csr: ['CSR', 'CUSTOMER SERVICE REPRESENTATIVE'],
        data_entry: ['DATA ENTRY', 'DATA-ENTRY'],
        foreman: ['FOREMAN'],
        grower: ['GROWER'],
        take_backs: ['TAKE BACK', 'TAKEBACK', 'TAKE BACKS', 'TAKEBACKS']
    });
    const ROLE_KEYS = Object.freeze(Object.keys(ROLE_ALIASES));
    const CACHE_PREFIX = 'gnc_user_access_directory_v1:';
    let config = {};
    let generation = 0;
    let selfRecord = null;
    let selfStatus = 'idle';
    let selfError = '';
    let selfDenied = false;
    let directoryRecord = null;
    let cachedDirectoryRecord = null;
    let directoryStatus = 'idle';
    let directoryError = '';
    let selfInFlight = null;
    let directoryInFlight = null;
    let configuredIdentityKey = '';
    let managerUiState = null;
    const saveInFlight = new Set();

    const text = value => String(value == null ? '' : value).trim();
    const key = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const compact = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const escapeHtml = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

    function normalizeRole(value) {
        const token = compact(value);
        if (!token) return '';
        for (const [canonical, aliases] of Object.entries(ROLE_ALIASES)) {
            if (compact(canonical) === token || aliases.some(alias => compact(alias) === token)) return canonical;
        }
        if (token.startsWith('EVAL')) return 'evaluator';
        if (token.startsWith('SALESREP')) return 'sales_rep';
        return '';
    }

    function normalizePermissions(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const result = {};
        for (const permission of PERMISSION_KEYS) result[permission] = source[permission] === true;
        return result;
    }

    function normalizeOverrides(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const result = {};
        for (const permission of PERMISSION_KEYS) result[permission] = typeof source[permission] === 'boolean' ? source[permission] : null;
        return result;
    }

    function mergePermissions(baseline, overrides) {
        const base = normalizePermissions(baseline);
        const explicit = normalizeOverrides(overrides);
        return Object.fromEntries(PERMISSION_KEYS.map(permission => [permission,
            explicit[permission] === null ? base[permission] : explicit[permission]]));
    }

    function getIdentity() {
        try {
            const value = typeof config.getSessionIdentity === 'function' ? config.getSessionIdentity() : null;
            if (!value || value.authenticated !== true || !text(value.id) || !key(value.username)) return null;
            return { id: text(value.id), username: key(value.username), authenticated: true };
        } catch { return null; }
    }

    function normalizeProfile(value) {
        const source = value && typeof value === 'object' ? value : {};
        const username = key(source.username);
        const id = text(source.id);
        if (!username || !id) return null;
        const aliases = Array.isArray(source.salesrep_match_names || source.salesrepMatchNames)
            ? (source.salesrep_match_names || source.salesrepMatchNames).map(key).filter(Boolean) : [];
        const salesrepId = text(source.salesrep_id || source.salesrepId).toUpperCase();
        return {
            id, username,
            display_name: text(source.display_name || source.displayName || username),
            role: text(source.role), canonical_role: normalizeRole(source.role),
            email: text(source.email).toLowerCase(), salesrep_id: salesrepId,
            salesrep_match_names: Array.from(new Set([...aliases, username, key(source.display_name), key(salesrepId)]))
        };
    }

    function isVerifiedManager() {
        const identity = getIdentity();
        return !selfDenied && selfRecord?.verified === true && selfRecord.profile.id === identity?.id
            && selfRecord.profile.username === identity?.username && isFullAppAdministrator(identity?.username)
            && selfRecord.effective_permissions.can_manage_user_access === true;
    }

    function currentDirectory() { return directoryRecord || cachedDirectoryRecord; }

    function publicDirectory() {
        const current = clone(currentDirectory()) || { revision: selfRecord?.revision || 0, role_baselines: [], users: [] };
        if (selfRecord?.verified !== true) return current;
        const own = {
            ...selfRecord.profile,
            active: true,
            selectable: true,
            baseline: { ...selfRecord.baseline },
            permission_overrides: { ...selfRecord.permission_overrides },
            effective_permissions: { ...selfRecord.effective_permissions },
            access_revision: selfRecord.revision
        };
        current.users = [...(current.users || []).filter(user => user.username !== own.username), own];
        if (!(current.role_baselines || []).some(row => row.role === selfRecord.role)) {
            current.role_baselines = [...(current.role_baselines || []), {
                role: selfRecord.role, permissions: { ...selfRecord.baseline }, revision: selfRecord.revision
            }];
        } else {
            current.role_baselines = current.role_baselines.map(row => row.role === selfRecord.role
                ? { ...row, permissions: { ...selfRecord.baseline }, revision: selfRecord.revision } : row);
        }
        current.revision = Math.max(Number(current.revision) || 0, selfRecord.revision);
        return current;
    }

    function cacheKey() {
        const identity = getIdentity();
        return identity ? `${CACHE_PREFIX}${identity.username}` : '';
    }

    function readDisplayCache() {
        const storageKey = cacheKey();
        if (!storageKey || !root.localStorage) return null;
        try {
            const parsed = JSON.parse(root.localStorage.getItem(storageKey) || 'null');
            return normalizeDirectory(parsed?.directory);
        } catch { return null; }
    }

    function persistDisplayCache(directory) {
        const storageKey = cacheKey();
        if (!storageKey || !root.localStorage || !directory) return;
        try { root.localStorage.setItem(storageKey, JSON.stringify({ directory, savedAt: Date.now() })); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'persistDisplayCache'); /* Cache is optional display state. */ }
    }

    function normalizeDirectory(value) {
        const source = value && typeof value === 'object' ? value : {};
        const roles = Array.isArray(source.role_baselines) ? source.role_baselines
            : Array.isArray(source.roleBaselines) ? source.roleBaselines
                : Array.isArray(source.baselines) ? source.baselines : [];
        const users = Array.isArray(source.users) ? source.users : Array.isArray(source.user_access) ? source.user_access : [];
        return {
            revision: Math.max(0, Number(source.revision || source.access_revision) || 0),
            role_baselines: roles.map(row => {
                const role = normalizeRole(row?.role);
                if (!role) return null;
                return { role, permissions: normalizePermissions(row.permissions || row.baseline_permissions),
                    revision: Math.max(0, Number(row.revision || row.expected_revision) || 0),
                    updated_at: text(row.updated_at || row.updatedAt), updated_by: key(row.updated_by || row.updatedBy) };
            }).filter(Boolean),
            users: users.map(row => {
                const profile = normalizeProfile(row) || (() => {
                    const username = key(row?.username);
                    const role = normalizeRole(row?.role);
                    if (!username || !role) return null;
                    return { id: '', username, display_name: text(row.display_name || row.display || username),
                        role: text(row.role), canonical_role: role, email: '', salesrep_id: '', salesrep_match_names: [username] };
                })();
                if (!profile || !profile.canonical_role) return null;
                const active = !!profile.id && row.active !== false && row.disabled !== true;
                const baselineValue = row.baseline || row.role_baseline || row.baseline_permissions;
                const baseline = active ? normalizePermissions(baselineValue?.permissions || baselineValue) : normalizePermissions(null);
                const overrides = active ? normalizeOverrides(row.permission_overrides || row.permissionOverrides) : normalizeOverrides(null);
                const effectiveSource = row.effective_permissions || row.effectivePermissions;
                return { ...profile, active, selectable: active, baseline, permission_overrides: overrides,
                    effective_permissions: active ? enforceAccountPermissions(profile.username, effectiveSource || mergePermissions(baseline, overrides)) : normalizePermissions(null),
                    access_revision: Math.max(0, Number(row.access_revision || row.revision) || 0) };
            }).filter(Boolean)
        };
    }

    function unwrap(result) {
        if (!result || result.ok === false) {
            const error = new Error(text(result?.error || result?.message) || 'User access request failed.');
            error.code = text(result?.code || result?.error_code);
            error.status = Number(result?.status || result?.http_status) || 0;
            throw error;
        }
        return result.data && typeof result.data === 'object' ? result.data : result;
    }

    function isTerminalSelfError(error) {
        const code = text(error?.code || error?.message).toUpperCase();
        const status = Number(error?.status) || 0;
        if (/USER_ACCESS_UNAVAILABLE|PROFILE_PENDING|RETRY|TIMEOUT|NETWORK/.test(code)) return false;
        return status === 401 || status === 403
            || /PROFILE_NOT_ACTIVE|PASSWORD_CHANGE_REQUIRED|USER_ACCESS_FORBIDDEN|USER_ACCESS_IDENTITY_MISMATCH|USER_ACCESS_PERMISSION_SNAPSHOT_INVALID|USER_ACCESS_EFFECTIVE_PERMISSION_MISMATCH|USER_ACCESS_HYDRATION_POLICY_INVALID/.test(code);
    }

    async function transport(operation, payload = {}, mutation = {}) {
        if (typeof config.transport !== 'function') throw new Error('Authenticated User Access service is unavailable.');
        const request = { action: 'user_access', operation, ...payload };
        if (mutation.commandId) request.command_id = mutation.commandId;
        if (mutation.expectedRevision != null) request.expected_revision = mutation.expectedRevision;
        return unwrap(await config.transport(request));
    }

    function publish(reason) {
        const detail = { reason, self: getSelfState(), directory: currentDirectory(), directoryStatus, directoryError };
        if (typeof config.onChange === 'function') config.onChange(detail);
        if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
            root.dispatchEvent(new root.CustomEvent('gnc-user-access-change', { detail }));
        }
    }

    function validateSelfResponse(value, identity) {
        const profile = normalizeProfile(value?.profile);
        const baselineSource = value?.baseline;
        const profileRole = normalizeRole(profile?.role);
        const baselineRole = normalizeRole(baselineSource?.role);
        if (!profile || !identity || profile.id !== identity.id || profile.username !== identity.username
            || !profileRole || !baselineRole || profileRole !== baselineRole) {
            throw new Error('USER_ACCESS_IDENTITY_MISMATCH');
        }
        const role = profileRole;
        const baseline = normalizePermissions(baselineSource?.permissions || baselineSource?.baseline_permissions);
        const overrides = normalizeOverrides(value.permission_overrides || value.permissionOverrides);
        const effective = enforceAccountPermissions(profile.username, value.effective_permissions || value.effectivePermissions);
        const computed = enforceAccountPermissions(profile.username, mergePermissions(baseline, overrides));
        for (const permission of PERMISSION_KEYS) {
            if (computed[permission] !== effective[permission]) throw new Error('USER_ACCESS_EFFECTIVE_PERMISSION_MISMATCH');
        }
        const policy = value.data_hydration_policy || value.dataHydrationPolicy || {};
        const useSharedSnapshot = policy.use_shared_instant_snapshot === true || policy.useSharedInstantSnapshot === true;
        const seasonRule = text(policy.av_season_rule || policy.avSeasonRule);
        const visibilityRule = text(policy.av_visibility_rule || policy.avVisibilityRule);
        if (typeof policy.use_shared_instant_snapshot !== 'boolean' && typeof policy.useSharedInstantSnapshot !== 'boolean') {
            throw new Error('USER_ACCESS_HYDRATION_POLICY_INVALID');
        }
        if (!seasonRule || !visibilityRule) throw new Error('USER_ACCESS_HYDRATION_POLICY_INVALID');
        return {
            profile, role, revision: Math.max(0, Number(value.revision) || 0), baseline,
            permission_overrides: overrides, effective_permissions: effective,
            data_hydration_policy: {
                use_shared_instant_snapshot: useSharedSnapshot,
                av_season_rule: seasonRule,
                av_visibility_rule: visibilityRule
            }, resolved_at: text(value.resolved_at || value.resolvedAt), verified: true
        };
    }

    async function loadSelf(options = {}) {
        const identity = getIdentity();
        if (!identity) {
            selfRecord = null; selfStatus = 'unauthenticated'; selfError = 'An authenticated native session is required.';
            publish('self-unverified');
            return null;
        }
        if (selfInFlight && options.force !== true) return selfInFlight;
        const requestGeneration = generation;
        selfStatus = 'loading'; selfError = '';
        publish('self-loading');
        selfInFlight = transport('resolve').then(value => {
            const current = getIdentity();
            if (requestGeneration !== generation || !current || current.id !== identity.id || current.username !== identity.username) return null;
            selfRecord = validateSelfResponse(value, identity);
            selfStatus = 'ready'; selfDenied = false;
            return getSelfState();
        }).catch(error => {
            if (requestGeneration === generation) {
                const current = getIdentity();
                const samePreviouslyResolvedIdentity = selfRecord?.verified === true && current
                    && selfRecord.profile.id === current.id && selfRecord.profile.username === current.username;
                selfDenied = isTerminalSelfError(error);
                if (!samePreviouslyResolvedIdentity || selfDenied) selfRecord = null;
                selfStatus = 'error'; selfError = text(error?.message) || 'User permissions could not be verified.';
            }
            return null;
        }).finally(() => {
            if (requestGeneration === generation) { selfInFlight = null; publish('self-settled'); }
        });
        return selfInFlight;
    }

    async function loadDirectory(options = {}) {
        if (!isVerifiedManager()) throw new Error('USER_ACCESS_MANAGER_REQUIRED');
        if (directoryInFlight && options.force !== true) return directoryInFlight;
        const requestGeneration = generation;
        directoryStatus = 'loading'; directoryError = '';
        if (!directoryRecord) cachedDirectoryRecord = readDisplayCache();
        publish('directory-loading');
        directoryInFlight = transport('directory').then(value => {
            if (requestGeneration !== generation || !isVerifiedManager()) return null;
            const normalized = normalizeDirectory(value.directory || value);
            if (!normalized.role_baselines.length || !normalized.users.length) throw new Error('USER_ACCESS_DIRECTORY_INVALID');
            directoryRecord = normalized;
            cachedDirectoryRecord = normalized;
            directoryStatus = 'ready'; directoryError = '';
            persistDisplayCache(normalized);
            return clone(normalized);
        }).catch(error => {
            if (requestGeneration === generation) {
                directoryStatus = directoryRecord || cachedDirectoryRecord ? 'stale' : 'error';
                directoryError = text(error?.message) || 'User access directory could not load.';
            }
            throw error;
        }).finally(() => {
            if (requestGeneration === generation) { directoryInFlight = null; publish('directory-settled'); }
        });
        return directoryInFlight;
    }

    function makeCommandId() {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
        return `user-access-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    }

    function requireVerifiedManager() {
        if (!isVerifiedManager()) throw new Error('USER_ACCESS_MANAGER_REQUIRED');
        if (!directoryRecord || directoryStatus !== 'ready') throw new Error('USER_ACCESS_DIRECTORY_NOT_VERIFIED');
    }

    async function saveRoleBaseline(roleValue, permissions) {
        requireVerifiedManager();
        const role = normalizeRole(roleValue);
        if (!role || !ROLE_KEYS.includes(role)) throw new Error('USER_ACCESS_ROLE_INVALID');
        const nextPermissions = normalizePermissions(permissions);
        const before = clone(directoryRecord);
        const saveGeneration = generation;
        const actorIdentity = getIdentity();
        const commandId = makeCommandId();
        const requestKey = `role:${role}`;
        if (saveInFlight.has(requestKey)) return false;
        saveInFlight.add(requestKey);
        directoryRecord.role_baselines = directoryRecord.role_baselines.map(row => row.role === role
            ? { ...row, permissions: nextPermissions } : row);
        for (const user of directoryRecord.users) {
            if (user.canonical_role !== role || user.active !== true) continue;
            user.baseline = nextPermissions;
            user.effective_permissions = enforceAccountPermissions(user.username, mergePermissions(nextPermissions, user.permission_overrides));
        }
        persistDisplayCache(directoryRecord); publish('role-baseline-optimistic');
        try {
            const saved = await transport('save_role_baseline', { role, permissions: nextPermissions },
                { commandId, expectedRevision: directoryRecord.revision });
            const currentIdentity = getIdentity();
            if (saveGeneration !== generation || !currentIdentity || !actorIdentity
                || currentIdentity.id !== actorIdentity.id || currentIdentity.username !== actorIdentity.username) {
                throw new Error('USER_ACCESS_ACCOUNT_CHANGED');
            }
            const normalized = normalizeDirectory(saved.directory || saved);
            if (normalized.role_baselines.length && normalized.users.length) directoryRecord = normalized;
            else if (saved.baseline) {
                const baseline = normalizePermissions(saved.baseline.permissions || saved.baseline);
                directoryRecord.role_baselines = directoryRecord.role_baselines.map(row => row.role === role ? { ...row, permissions: baseline } : row);
                for (const user of directoryRecord.users) if (user.canonical_role === role && user.active === true) {
                    user.baseline = baseline; user.effective_permissions = enforceAccountPermissions(user.username, mergePermissions(baseline, user.permission_overrides));
                }
            } else throw new Error('USER_ACCESS_SAVE_RESPONSE_INVALID');
            directoryRecord.revision = Math.max(directoryRecord.revision + 1, Number(saved.revision) || 0);
            if (selfRecord?.verified === true && selfRecord.role === role
                && selfRecord.profile.id === currentIdentity.id && selfRecord.profile.username === currentIdentity.username) {
                selfRecord.baseline = { ...directoryRecord.role_baselines.find(row => row.role === role).permissions };
                selfRecord.effective_permissions = enforceAccountPermissions(selfRecord.profile.username, mergePermissions(selfRecord.baseline, selfRecord.permission_overrides));
                selfRecord.revision = directoryRecord.revision;
            }
            cachedDirectoryRecord = directoryRecord; persistDisplayCache(directoryRecord); publish('role-baseline-saved');
            return true;
        } catch (error) {
            if (saveGeneration === generation) {
                directoryRecord = before; cachedDirectoryRecord = before; persistDisplayCache(before); publish('role-baseline-rollback');
            }
            throw error;
        } finally { saveInFlight.delete(requestKey); }
    }

    async function saveUserOverrides(usernameValue, overridesValue) {
        requireVerifiedManager();
        const username = key(usernameValue);
        const target = directoryRecord.users.find(user => user.username === username);
        if (!target || target.active !== true || !target.id) throw new Error('USER_ACCESS_TARGET_NOT_FOUND');
        const overrides = normalizeOverrides(overridesValue);
        const before = clone(directoryRecord);
        const saveGeneration = generation;
        const actorIdentity = getIdentity();
        const commandId = makeCommandId();
        const requestKey = `user:${username}`;
        if (saveInFlight.has(requestKey)) return false;
        saveInFlight.add(requestKey);
        target.permission_overrides = overrides;
        target.effective_permissions = enforceAccountPermissions(target.username, mergePermissions(target.baseline, overrides));
        persistDisplayCache(directoryRecord); publish('user-overrides-optimistic');
        try {
            const saved = await transport('save_user_overrides', { username, permission_overrides: overrides },
                { commandId, expectedRevision: directoryRecord.revision });
            const currentIdentity = getIdentity();
            if (saveGeneration !== generation || !currentIdentity || !actorIdentity
                || currentIdentity.id !== actorIdentity.id || currentIdentity.username !== actorIdentity.username) {
                throw new Error('USER_ACCESS_ACCOUNT_CHANGED');
            }
            if (saved.user || saved.profile) {
                const row = normalizeDirectory({ revision: saved.revision, role_baselines: directoryRecord.role_baselines,
                    users: [saved.user || saved.profile] }).users[0];
                if (!row || row.username !== username) throw new Error('USER_ACCESS_SAVE_RESPONSE_INVALID');
                directoryRecord.users = directoryRecord.users.map(user => user.username === username ? { ...user, ...row } : user);
            } else if (saved.directory) {
                const normalized = normalizeDirectory(saved.directory);
                if (!normalized.users.some(user => user.username === username)) throw new Error('USER_ACCESS_SAVE_RESPONSE_INVALID');
                directoryRecord = normalized;
            } else throw new Error('USER_ACCESS_SAVE_RESPONSE_INVALID');
            directoryRecord.revision = Math.max(directoryRecord.revision + 1, Number(saved.revision) || 0);
            if (selfRecord?.verified === true && username === currentIdentity.username
                && selfRecord.profile.id === currentIdentity.id && selfRecord.profile.username === currentIdentity.username) {
                const updatedSelf = directoryRecord.users.find(user => user.username === username);
                if (updatedSelf) {
                    selfRecord.baseline = { ...updatedSelf.baseline };
                    selfRecord.permission_overrides = { ...updatedSelf.permission_overrides };
                    selfRecord.effective_permissions = { ...updatedSelf.effective_permissions };
                    selfRecord.revision = directoryRecord.revision;
                }
            }
            cachedDirectoryRecord = directoryRecord; persistDisplayCache(directoryRecord); publish('user-overrides-saved');
            return true;
        } catch (error) {
            if (saveGeneration === generation) {
                directoryRecord = before; cachedDirectoryRecord = before; persistDisplayCache(before); publish('user-overrides-rollback');
            }
            throw error;
        } finally { saveInFlight.delete(requestKey); }
    }

    function aliasesFor(user) {
        if (!user || typeof user !== 'object') return new Set([key(user)].filter(Boolean));
        return new Set([user.username, user.display_name, user.displayName, user.email, user.salesrep_id, user.salesrepId,
            ...(Array.isArray(user.salesrep_match_names) ? user.salesrep_match_names : Array.isArray(user.salesrepMatchNames) ? user.salesrepMatchNames : [])]
            .map(key).filter(Boolean));
    }

    function resolveDirectoryUser(value) {
        const directory = currentDirectory();
        if (!directory) return null;
        const queryAliases = aliasesFor(value);
        if (!queryAliases.size) return null;
        const exactUsername = typeof value === 'object' ? key(value.username) : key(value);
        if (exactUsername) {
            const exact = directory.users.find(user => user.username === exactUsername);
            if (exact) return exact;
        }
        const matches = directory.users.filter(user => [...queryAliases].some(alias => aliasesFor(user).has(alias)));
        return matches.length === 1 ? matches[0] : null;
    }

    function getEffectiveUserPermissions(userValue = null) {
        const identity = getIdentity();
        const selfProfile = selfRecord?.verified === true && identity && selfRecord.profile.id === identity.id
            && selfRecord.profile.username === identity.username ? selfRecord : null;
        const requested = userValue == null ? identity?.username : userValue;
        const requestedAliases = aliasesFor(requested);
        const isSelf = !!(selfProfile && (requested === identity?.username
            || (typeof requested === 'object' && text(requested.id) === identity.id && key(requested.username) === identity.username)
            || [...requestedAliases].some(alias => aliasesFor(selfProfile.profile).has(alias))));
        if (isSelf) {
            return { role: selfProfile.role, permissions: { ...selfProfile.effective_permissions },
                baseline: { ...selfProfile.baseline }, overrides: { ...selfProfile.permission_overrides }, verified: true,
                stale: selfStatus !== 'ready', profile: { ...selfProfile.profile }, data_hydration_policy: { ...selfProfile.data_hydration_policy } };
        }
        const user = resolveDirectoryUser(requested);
        if (!user) return { role: '', permissions: normalizePermissions(null), baseline: normalizePermissions(null),
            overrides: normalizeOverrides(null), verified: false, profile: null, data_hydration_policy: null };
        return { role: user.canonical_role, permissions: { ...user.effective_permissions }, baseline: { ...user.baseline },
            overrides: { ...user.permission_overrides }, verified: false, profile: clone(user), data_hydration_policy: null };
    }

    function getSelfState() {
        return { status: selfStatus, denied: selfDenied, verified: selfRecord?.verified === true && selfStatus === 'ready',
            error: selfError, profile: selfRecord?.profile ? { ...selfRecord.profile } : null,
            role: selfRecord?.role || '', baseline: selfRecord ? { ...selfRecord.baseline } : null,
            overrides: selfRecord ? { ...selfRecord.permission_overrides } : null,
            permissions: selfRecord ? { ...selfRecord.effective_permissions } : null,
            dataHydrationPolicy: selfRecord?.data_hydration_policy ? { ...selfRecord.data_hydration_policy } : null,
            revision: selfRecord?.revision || 0 };
    }

    function reset() {
        generation++;
        selfRecord = null; selfStatus = 'idle'; selfError = ''; selfDenied = false;
        directoryRecord = null; cachedDirectoryRecord = readDisplayCache();
        directoryStatus = cachedDirectoryRecord ? 'stale' : 'idle'; directoryError = '';
        selfInFlight = null; directoryInFlight = null; saveInFlight.clear();
        managerUiState = null;
        publish('reset');
    }

    function configure(options = {}) {
        config = { ...config, ...options };
        const nextIdentity = getIdentity();
        const nextKey = nextIdentity ? `${nextIdentity.id}:${nextIdentity.username}` : '';
        if (configuredIdentityKey && configuredIdentityKey !== nextKey) reset();
        configuredIdentityKey = nextKey;
        if (!cachedDirectoryRecord) cachedDirectoryRecord = readDisplayCache();
        return api;
    }

    function escAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

    function createElement(tag, props = {}, children = []) {
        const element = root.document.createElement(tag);
        for (const [name, value] of Object.entries(props)) {
            if (name === 'className') element.className = value;
            else if (name === 'text') element.textContent = value;
            else if (name.startsWith('data-')) element.setAttribute(name, value);
            else if (name === 'disabled' || name === 'checked' || name === 'selected') element[name] = value;
            else element.setAttribute(name, value);
        }
        for (const child of children) element.append(child);
        return element;
    }

    function renderManager(container, options = {}) {
        if (!container || !root.document) return null;
        container.classList.add('agdata-user-access');
        const directory = currentDirectory();
        const self = getSelfState();
        const identity = getIdentity();
        const identityKey = identity ? `${identity.id}:${identity.username}` : '';
        const remembered = managerUiState?.identityKey === identityKey ? managerUiState : null;
        const requestedRole = normalizeRole(options.selectedRole || container.dataset.selectedRole || remembered?.selectedRole || self.role || ROLE_KEYS[0]);
        const selectedRole = directory?.role_baselines.some(row => row.role === requestedRole) ? requestedRole
            : directory?.role_baselines[0]?.role || requestedRole;
        const selectedUsername = key(options.selectedUsername || container.dataset.selectedUsername || remembered?.selectedUsername || '');
        const query = text(options.query ?? container.dataset.query ?? remembered?.query ?? '');
        const roleFilter = normalizeRole(options.roleFilter ?? container.dataset.roleFilter ?? remembered?.roleFilter ?? '');
        const canManage = isVerifiedManager();
        const activeUserCount = currentDirectory()?.users.filter(user => user.active === true).length || 0;
        const statusText = directoryStatus === 'loading' ? 'Refreshing active user access…'
            : directoryError ? (directoryStatus === 'stale' ? 'Showing cached access directory; refresh failed.' : 'Unable to load the access directory.')
                : !self.verified ? 'Verify your active session to load permissions.'
                    : !canManage ? 'Your account can view its permissions but cannot manage access.'
                    : directoryStatus === 'ready' ? `${activeUserCount} active profiles loaded from the server.` : 'Loading the server access directory…';
        const current = directory || { role_baselines: [], users: [] };
        const baseline = current.role_baselines.find(row => row.role === selectedRole) || null;
        const filteredUsers = current.users.filter(user => (!roleFilter || user.canonical_role === roleFilter)
            && (!query || [user.username, user.display_name, user.email, user.salesrep_id, ...user.salesrep_match_names].some(value => key(value).includes(key(query)))))
            .sort((left, right) => left.display_name.localeCompare(right.display_name));
        const chosenUser = current.users.find(user => user.username === selectedUsername && user.active === true) || null;
        if (chosenUser && !filteredUsers.includes(chosenUser)) filteredUsers.unshift(chosenUser);
        container.dataset.selectedRole = selectedRole;
        container.dataset.selectedUsername = chosenUser?.username || '';
        container.dataset.query = query;
        container.dataset.roleFilter = roleFilter;
        managerUiState = { identityKey, selectedRole, selectedUsername: chosenUser?.username || selectedUsername, query, roleFilter };
        // Async self/directory refreshes can finish after a manager has changed
        // a selector. Read the rendered state at completion time so an older
        // render's captured defaults cannot reset the active selection.
        const latestManagerOptions = () => ({
            selectedRole: container.dataset.selectedRole || selectedRole,
            selectedUsername: container.dataset.selectedUsername ?? selectedUsername,
            query: container.dataset.query ?? query,
            roleFilter: container.dataset.roleFilter ?? roleFilter,
        });
        container.setAttribute('aria-busy', String(directoryStatus === 'loading'));
        container.innerHTML = `<div class="agdata-user-access__heading"><div><h2>User &amp; Role Access</h2><p>Role baselines are inherited by users unless a per-user override is saved.</p></div><button type="button" data-access-refresh>Refresh access</button></div>
            <p class="agdata-user-access__status" data-access-status role="${directoryError ? 'alert' : 'status'}">${escapeHtml(statusText)}</p>
            <div class="agdata-user-access__grid"><section class="agdata-user-access__panel" aria-label="Role baselines"><h3>Role baselines</h3><label>Role<select data-role-select>${ROLE_KEYS.map(role => `<option value="${escAttr(role)}"${role === selectedRole ? ' selected' : ''}>${escapeHtml(role.replaceAll('_', ' '))}</option>`).join('')}</select></label><div data-role-permissions></div><button type="button" data-role-save ${canManage && baseline && !!directoryRecord ? '' : 'disabled'}>Save &amp; Apply to Role</button></section>
            <section class="agdata-user-access__panel" aria-label="Users"><h3>Users <span data-user-count>${filteredUsers.filter(user => user.active === true).length}</span></h3><label>Search users<input type="search" data-user-search value="${escAttr(query)}" autocomplete="off"></label><label>Filter by role<select data-user-role-filter><option value="">All roles</option>${ROLE_KEYS.map(role => `<option value="${escAttr(role)}"${role === roleFilter ? ' selected' : ''}>${escapeHtml(role.replaceAll('_', ' '))}</option>`).join('')}</select></label><label>User<select data-user-select><option value="">Select an active user</option>${filteredUsers.map(user => `<option value="${escAttr(user.username)}"${user.active !== true ? ' disabled' : ''}${user.username === chosenUser?.username ? ' selected' : ''}>${escapeHtml(user.display_name)} — ${escapeHtml(user.role)}${user.salesrep_id ? ` (${escapeHtml(user.salesrep_id)})` : ''}${user.active !== true ? ' — no active profile' : ''}</option>`).join('')}</select></label><div data-user-permissions></div><button type="button" data-user-save ${canManage && chosenUser && !!directoryRecord ? '' : 'disabled'}>Save user overrides</button></section></div>`;
        const rolePermissions = container.querySelector('[data-role-permissions]');
        if (baseline) {
            rolePermissions.innerHTML = PERMISSION_KEYS.map(permission => `<label class="agdata-user-access__permission"><span>${escapeHtml(permission.replace(/^can_/, '').replaceAll('_', ' '))}</span><input type="checkbox" data-role-permission="${permission}"${baseline.permissions[permission] ? ' checked' : ''}${canManage && !!directoryRecord ? '' : ' disabled'}></label>`).join('');
        } else rolePermissions.innerHTML = '<p role="status">Role baseline not available from the server.</p>';
        const userPermissions = container.querySelector('[data-user-permissions]');
        if (chosenUser) {
            userPermissions.innerHTML = `<p class="agdata-user-access__inherited">Inherited role: <strong>${escapeHtml(chosenUser.role)}</strong></p>` + PERMISSION_KEYS.map(permission => {
                const override = chosenUser.permission_overrides[permission];
                const inherited = override === null;
                const effective = chosenUser.effective_permissions[permission];
                return `<label class="agdata-user-access__permission"><span>${escapeHtml(permission.replace(/^can_/, '').replaceAll('_', ' '))}<small>${inherited ? `Inherited · ${effective ? 'Allowed' : 'Denied'}` : `Override · ${effective ? 'Allowed' : 'Denied'}`}</small></span><select data-user-permission="${permission}"${canManage && !!directoryRecord ? '' : ' disabled'}><option value="inherit"${inherited ? ' selected' : ''}>Inherit role baseline</option><option value="true"${override === true ? ' selected' : ''}>Allow</option><option value="false"${override === false ? ' selected' : ''}>Deny</option></select></label>`;
            }).join('');
        } else userPermissions.innerHTML = '<p class="agdata-user-access__inherited">Choose an active user to inspect inherited access and overrides.</p>';
        container.querySelector('[data-access-refresh]').onclick = async () => {
            try {
                if (!getSelfState().verified) await loadSelf({ force: true });
                if (isVerifiedManager()) await loadDirectory({ force: true });
                renderManager(container, latestManagerOptions());
            }
            catch (error) { directoryError = text(error?.message); renderManager(container, latestManagerOptions()); }
        };
        container.querySelector('[data-role-select]').onchange = event => renderManager(container, { selectedRole: event.target.value, selectedUsername, query, roleFilter });
        container.querySelector('[data-user-search]').oninput = event => {
            const inputValue = event.target.value, caret = event.target.selectionStart;
            renderManager(container, { selectedRole, query: inputValue, roleFilter });
            const nextInput = container.querySelector('[data-user-search]');
            nextInput?.focus({ preventScroll: true });
            if (nextInput && Number.isInteger(caret)) nextInput.setSelectionRange(caret, caret);
        };
        container.querySelector('[data-user-role-filter]').onchange = event => renderManager(container, { selectedRole, selectedUsername, query, roleFilter: event.target.value });
        container.querySelector('[data-user-select]').onchange = event => renderManager(container, { selectedRole, selectedUsername: event.target.value, query, roleFilter });
        container.querySelector('[data-role-save]').onclick = async () => {
            const permissions = Object.fromEntries(PERMISSION_KEYS.map(permission => [permission, !!container.querySelector(`[data-role-permission="${permission}"]`)?.checked]));
            const roleAtSubmit = normalizeRole(container.dataset.selectedRole || selectedRole);
            try { await saveRoleBaseline(roleAtSubmit, permissions); root.showToast?.('Saved role access', 'Role permissions were applied.'); renderManager(container, latestManagerOptions()); }
            catch (error) { directoryError = text(error?.message); renderManager(container, latestManagerOptions()); }
        };
        container.querySelector('[data-user-save]').onclick = async () => {
            if (!chosenUser) return;
            const overrides = Object.fromEntries(PERMISSION_KEYS.map(permission => {
                const value = container.querySelector(`[data-user-permission="${permission}"]`)?.value || 'inherit';
                return [permission, value === 'inherit' ? null : value === 'true'];
            }));
            try { await saveUserOverrides(chosenUser.username, overrides); root.showToast?.('Saved user access', 'User overrides were saved.'); renderManager(container, { ...latestManagerOptions(), selectedUsername: chosenUser.username }); }
            catch (error) { directoryError = text(error?.message); renderManager(container, { ...latestManagerOptions(), selectedUsername: chosenUser.username }); }
        };
        if (!self.verified && selfStatus === 'idle' && !selfInFlight) loadSelf().then(async () => {
            if (isVerifiedManager() && directoryStatus !== 'ready') await loadDirectory().catch(error => { globalThis.GncRuntimeWatchdog?.capture?.(error, 'renderManager'); });
            renderManager(container, latestManagerOptions());
        });
        else if (!self.verified && selfInFlight) selfInFlight.then(async () => {
            if (isVerifiedManager() && directoryStatus !== 'ready' && !directoryInFlight) await loadDirectory().catch(error => { globalThis.GncRuntimeWatchdog?.capture?.(error, 'renderManager'); });
            renderManager(container, latestManagerOptions());
        });
        else if (isVerifiedManager() && directoryStatus !== 'ready' && !directoryInFlight) loadDirectory().then(() => {
            renderManager(container, latestManagerOptions());
        }).catch(error => {
            directoryError = text(error?.message); renderManager(container, latestManagerOptions());
        });
        else if (isVerifiedManager() && directoryInFlight) directoryInFlight.then(() => {
            renderManager(container, latestManagerOptions());
        }).catch(error => {
            directoryError = text(error?.message); renderManager(container, latestManagerOptions());
        });
        return { self, directory: current, directoryStatus, manager: canManage };
    }

    function mountManager(container, options = {}) {
        if (container?.querySelector('[data-role-select]') && isVerifiedManager() && !Object.keys(options).length) return;
        return renderManager(container, options);
    }

    const api = {
        configure, reset, loadSelf, loadDirectory, getSelfState, getEffectiveUserPermissions,
        normalizeRole, normalizePermissions, normalizeOverrides, mergePermissions, resolveDirectoryUser, isAuraOwner,
        renderManager, mountManager,
        get directory() { return publicDirectory(); },
        get roleBaselines() { return clone(publicDirectory().role_baselines || []); },
        get users() { return clone(publicDirectory().users || []); },
        get status() { return { self: selfStatus, directory: directoryStatus, error: selfError || directoryError }; },
        get permissionKeys() { return PERMISSION_KEYS.slice(); },
        get roleKeys() { return ROLE_KEYS.slice(); }
    };

    Object.defineProperty(root, 'AGDATA_ROLE_BASELINES', { configurable: true, get: () => api.roleBaselines });
    Object.defineProperty(root, 'AGDATA_USER_ACCESS_TABLE', { configurable: true, get: () => api.users });
    root.getEffectiveUserPermissions = getEffectiveUserPermissions;
    root.GncUserAccessControl = api;
})(typeof window !== 'undefined' ? window : globalThis);
