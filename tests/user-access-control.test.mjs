// @test-group: user-access-control
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync(new URL('../assets/user-access-control.js', import.meta.url), 'utf8');
const permissions = {
    can_access_drive_mode: true, can_access_av: true, can_access_que: true,
    can_access_manager_tab: false, can_manage_user_access: false,
    can_access_eval_reports_2: false, can_submit_reclass: false,
    can_complete_suspend_tag: true, can_approve_deny_suspend: false
};

function makeClient({ identity = { id: 'profile-1', username: 'annette_hancock', authenticated: true }, transport = async () => ({ ok: true, data: {} }), storage = new Map() } = {}) {
    const events = [];
    const context = {
        crypto: { randomUUID: () => 'command-fixed-1' },
        localStorage: { getItem: name => storage.get(name) || null, setItem: (name, value) => storage.set(name, value) },
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        dispatchEvent: event => events.push(event),
        setTimeout, clearTimeout,
    };
    context.window = context;
    vm.runInNewContext(source, context);
    context.GncUserAccessControl.configure({ getSessionIdentity: () => typeof identity === 'function' ? identity() : identity, transport });
    return { api: context.GncUserAccessControl, context, events, storage };
}

function selfSnapshot(overrides = {}, effective = permissions) {
    return { ok: true, data: {
        revision: 8,
        profile: { id: 'profile-1', username: 'Annette_Hancock', display_name: 'Annette Hancock', role: 'Sales Rep', salesrep_id: 'S05', salesrep_match_names: ['Hancock, Annette', 'Annette Hancock', 'annette_hancock', 'S05'] },
        baseline: { role: 'sales_rep', permissions },
        permission_overrides: overrides,
        effective_permissions: effective,
        data_hydration_policy: { use_shared_instant_snapshot: true, av_season_rule: 'CURRENT_SEASON_F1_LE_27', av_visibility_rule: 'OPEN_STOCK_GT_0_OR_REP_RESERVE' },
        resolved_at: '2026-10-19T15:00:00Z'
    } };
}

const adminPermissions = Object.fromEntries(Object.keys(permissions).map(key => [key, true]));
function directorySnapshot() {
    return { ok: true, data: {
        revision: 14,
        role_baselines: [
            { role: 'Administrator', permissions: adminPermissions, revision: 2 },
            { role: 'REP', permissions, revision: 5 }
        ],
        users: [
            { id: 'profile-1', username: 'annette_hancock', display_name: 'Annette Hancock', role: 'Sales Rep', email: 'annette@example.invalid', salesrep_id: 'S05', salesrep_match_names: ['Hancock, Annette', 'Annette Hancock', 'S05'], baseline: { role: 'sales_rep', permissions }, permission_overrides: { can_access_av: null }, effective_permissions: permissions },
            { id: 'profile-2', username: 'wes_lugas', display_name: 'Wes Lugas', role: 'REP', salesrep_id: 'S31', salesrep_match_names: ['Lugas, Wes', 'Wes Lugas', 'S31'], baseline: { role: 'sales_rep', permissions }, permission_overrides: {}, effective_permissions: permissions },
            { username: 'legacy_without_profile', display_name: 'Legacy User', role: 'REP', active: false }
        ]
    } };
}

function mountManager(client, t, options = {}) {
    const dom = new JSDOM('<!doctype html><div id="access"></div>');
    t.after(() => dom.window.close());
    client.context.document = dom.window.document;
    client.context.window.document = dom.window.document;
    const host = dom.window.document.getElementById('access');
    client.api.mountManager(host, options);
    return host;
}

test('role aliases normalize legacy roles without granting unknown roles', () => {
    const { api } = makeClient();
    assert.equal(api.normalizeRole('Sales Rep'), 'sales_rep');
    assert.equal(api.normalizeRole('SALESROLE'), 'sales_rep');
    assert.equal(api.normalizeRole('Data Entry Supervisor'), 'supervisor');
    assert.equal(api.normalizeRole('QC Supervisor'), 'qc_supervisor');
    assert.equal(api.normalizeRole('Data Entry'), 'data_entry');
    assert.equal(api.normalizeRole('Mysterious Access'), '');
});

test('self permissions become verified only after the authenticated server resolve matches id and username', async () => {
    const { api, context } = makeClient({ transport: async request => {
        assert.equal(request.action, 'user_access');
        assert.equal(request.operation, 'resolve');
        return selfSnapshot();
    } });
    assert.equal(api.getEffectiveUserPermissions().verified, false);
    await api.loadSelf();
    assert.equal(api.getSelfState().verified, true);
    assert.equal(context.getEffectiveUserPermissions('Annette Hancock').verified, true);
    assert.equal(context.getEffectiveUserPermissions('other_user').permissions.can_access_av, false);
    assert.equal(context.getEffectiveUserPermissions('other_user').verified, false);
});

test('public access tables include only the authenticated resolved self when manager directory is unavailable', async () => {
    const { api } = makeClient({ transport: async request => {
        assert.equal(request.operation, 'resolve');
        return selfSnapshot();
    } });
    assert.equal(api.users.length, 0);
    await api.loadSelf();
    assert.equal(api.users.length, 1);
    assert.equal(api.users[0].username, 'annette_hancock');
    assert.equal(api.users[0].active, true);
    assert.equal(api.users[0].effective_permissions.can_access_av, true);
    assert.equal(api.roleBaselines.length, 1);
    assert.equal(api.roleBaselines[0].role, 'sales_rep');
    assert.equal(api.roleBaselines[0].permissions.can_access_av, true);
});

test('transient self-resolution failures retain the same runtime identity snapshot as stale display state', async () => {
    let fail = false;
    const { api } = makeClient({ transport: async () => {
        if (fail) { const error = new Error('temporary service unavailable'); error.status = 503; throw error; }
        return selfSnapshot();
    } });
    await api.loadSelf();
    fail = true;
    await api.loadSelf({ force: true });
    assert.equal(api.getSelfState().status, 'error');
    assert.equal(api.getSelfState().verified, false);
    assert.equal(api.getEffectiveUserPermissions().verified, true);
    assert.equal(api.getEffectiveUserPermissions().stale, true);
    assert.equal(api.getEffectiveUserPermissions().permissions.can_access_av, true);
});

test('terminal access denial clears the prior self snapshot instead of preserving it', async () => {
    let deny = false;
    const { api } = makeClient({ transport: async () => {
        if (deny) { const error = new Error('PROFILE_NOT_ACTIVE'); error.status = 403; throw error; }
        return selfSnapshot();
    } });
    await api.loadSelf();
    deny = true;
    await api.loadSelf({ force: true });
    assert.equal(api.getSelfState().verified, false);
    assert.equal(api.getEffectiveUserPermissions().verified, false);
    assert.equal(api.getEffectiveUserPermissions().permissions.can_access_av, false);
});

test('a mismatched server identity and a local cached directory cannot verify permissions', async () => {
    const storage = new Map([['gnc_user_access_directory_v1:annette_hancock', JSON.stringify({ directory: directorySnapshot().data, savedAt: Date.now() })]]);
    const { api } = makeClient({ storage, transport: async () => {
        const response = selfSnapshot();
        response.data.profile.id = 'different-profile';
        return response;
    } });
    assert.equal(api.getEffectiveUserPermissions('annette_hancock').verified, false);
    assert.equal(api.users.filter(user => user.active === true).length, 2);
    assert.equal(api.users.find(user => user.username === 'legacy_without_profile').selectable, false);
    await api.loadSelf();
    assert.equal(api.getSelfState().verified, false);
    assert.equal(api.getEffectiveUserPermissions('annette_hancock').verified, false);
});

test('legacy directory identities without native profiles remain disabled and fail closed', async t => {
    const client = makeClient({ identity: { id: 'admin-1', username: 'admin', authenticated: true }, transport: async request => {
        if (request.operation === 'resolve') return { ok: true, data: { ...selfSnapshot({}, adminPermissions).data,
            profile: { id: 'admin-1', username: 'admin', role: 'Administrator' }, baseline: { role: 'admin', permissions: adminPermissions },
            effective_permissions: adminPermissions } };
        if (request.operation === 'directory') return directorySnapshot();
        throw new Error('unexpected_operation');
    } });
    const { api } = client;
    await api.loadSelf();
    await api.loadDirectory();
    const legacy = api.users.find(user => user.username === 'legacy_without_profile');
    assert.equal(legacy.active, false);
    assert.equal(legacy.selectable, false);
    assert.equal(legacy.id, '');
    assert.equal(api.getEffectiveUserPermissions('legacy_without_profile').verified, false);
    assert.equal(api.getEffectiveUserPermissions('legacy_without_profile').permissions.can_access_av, false);
    const host = mountManager(client, t, { selectedUsername: 'legacy_without_profile' });
    assert.equal(host.querySelector('[data-user-select] option[value="legacy_without_profile"]').disabled, true);
    assert.equal(host.querySelector('[data-user-save]').disabled, true);
});

test('account switch invalidates an older in-flight resolve before it can replace the new profile', async () => {
    let identity = { id: 'profile-1', username: 'annette_hancock', authenticated: true };
    let releaseOld;
    let callCount = 0;
    const transport = async request => {
        assert.equal(request.operation, 'resolve');
        callCount++;
        if (callCount === 1) return new Promise(resolve => { releaseOld = resolve; });
        return { ok: true, data: { ...selfSnapshot({}, permissions).data,
            profile: { id: identity.id, username: identity.username, role: 'Sales Rep' },
            baseline: { role: 'sales_rep', permissions } } };
    };
    const { api } = makeClient({ identity: () => identity, transport });
    const oldRequest = api.loadSelf();
    identity = { id: 'profile-2', username: 'wes_lugas', authenticated: true };
    api.configure({ getSessionIdentity: () => identity, transport });
    await api.loadSelf();
    releaseOld(selfSnapshot());
    await oldRequest;
    assert.equal(api.getSelfState().profile.username, 'wes_lugas');
    assert.equal(api.getSelfState().verified, true);
});

test('rep aliases match the authoritative active directory without treating aliases as identities', async () => {
    const { api } = makeClient({ identity: { id: 'admin-1', username: 'admin', authenticated: true }, transport: async request => {
        if (request.operation === 'resolve') return { ok: true, data: { ...selfSnapshot({}, adminPermissions).data,
            profile: { id: 'admin-1', username: 'admin', role: 'Administrator' },
            baseline: { role: 'admin', permissions: adminPermissions }, effective_permissions: adminPermissions } };
        return directorySnapshot();
    } });
    await api.loadSelf();
    await api.loadDirectory();
    assert.equal(api.resolveDirectoryUser('Annette Hancock')?.username, 'annette_hancock');
    assert.equal(api.resolveDirectoryUser('Hancock, Annette')?.salesrep_id, 'S05');
    assert.equal(api.resolveDirectoryUser('Lugas, Wes')?.username, 'wes_lugas');
    assert.equal(api.getEffectiveUserPermissions('Wes Lugas').verified, false);
});

test('role baseline updates are optimistic and roll back the local directory after a server error', async t => {
    let failSave = false;
    const calls = [];
    const client = makeClient({ identity: { id: 'admin-1', username: 'admin', authenticated: true }, transport: async request => {
        calls.push(request);
        if (request.operation === 'resolve') return { ok: true, data: { ...selfSnapshot({}, adminPermissions).data,
            profile: { id: 'admin-1', username: 'admin', role: 'Administrator' }, baseline: { role: 'admin', permissions: adminPermissions }, effective_permissions: adminPermissions } };
        if (request.operation === 'directory') return directorySnapshot();
        if (request.operation === 'save_role_baseline' && failSave) return { ok: false, error: 'REVISION_CONFLICT' };
        if (request.operation === 'save_role_baseline') return { ok: true, data: { revision: 15,
            baseline: { role: request.role, permissions: request.permissions, revision: 6 } } };
        throw new Error('unexpected operation');
    } });
    const { api, events } = client;
    await api.loadSelf();
    await api.loadDirectory();
    const next = { ...permissions, can_access_av: false };
    const host = mountManager(client, t, { selectedRole: 'sales_rep' });
    host.querySelector('[data-role-permission="can_access_av"]').checked = false;
    await host.querySelector('[data-role-save]').onclick();
    assert.equal(api.directory.users.find(user => user.username === 'wes_lugas').effective_permissions.can_access_av, false);
    assert.equal(calls.at(-1).command_id, 'command-fixed-1');
    assert.equal(calls.at(-1).expected_revision, 14);
    const beforeFailure = api.directory.role_baselines.find(row => row.role === 'sales_rep').permissions.can_access_av;
    failSave = true;
    host.querySelector('[data-role-permission="can_access_av"]').checked = true;
    await host.querySelector('[data-role-save]').onclick();
    assert.equal(api.directory.role_baselines.find(row => row.role === 'sales_rep').permissions.can_access_av, beforeFailure);
    assert.match(host.querySelector('[data-access-status]').textContent, /REVISION_CONFLICT/);
    assert.ok(events.some(event => event.detail.reason === 'role-baseline-optimistic'));
    assert.ok(events.some(event => event.detail.reason === 'role-baseline-rollback'));
});

test('per-user overrides apply over inherited flags and restore prior cached state on save failure', async t => {
    const calls = [];
    let rejectSave = false;
    const client = makeClient({ identity: { id: 'admin-1', username: 'admin', authenticated: true }, transport: async request => {
        calls.push(request);
        if (request.operation === 'resolve') return { ok: true, data: { ...selfSnapshot({}, adminPermissions).data,
            profile: { id: 'admin-1', username: 'admin', role: 'Administrator' }, baseline: { role: 'admin', permissions: adminPermissions }, effective_permissions: adminPermissions } };
        if (request.operation === 'directory') return directorySnapshot();
        if (request.operation === 'save_user_overrides' && rejectSave) return { ok: false, error: 'DENIED' };
        if (request.operation === 'save_user_overrides') return { ok: true, data: { revision: 15,
            user: { id: 'profile-2', username: 'wes_lugas', display_name: 'Wes Lugas', role: 'REP', salesrep_id: 'S31', salesrep_match_names: ['Lugas, Wes', 'Wes Lugas', 'S31'], baseline: { role: 'sales_rep', permissions }, permission_overrides: request.permission_overrides, effective_permissions: { ...permissions, can_access_av: request.permission_overrides.can_access_av ?? permissions.can_access_av } } } };
        throw new Error('unexpected operation');
    } });
    const { api } = client;
    await api.loadSelf();
    await api.loadDirectory();
    const host = mountManager(client, t, { selectedUsername: 'wes_lugas' });
    host.querySelector('[data-user-permission="can_access_av"]').value = 'true';
    await host.querySelector('[data-user-save]').onclick();
    assert.equal(api.directory.users.find(user => user.username === 'wes_lugas').effective_permissions.can_access_av, true);
    assert.equal(calls.at(-1).operation, 'save_user_overrides');
    assert.equal(calls.at(-1).username, 'wes_lugas');
    rejectSave = true;
    host.querySelector('[data-user-permission="can_access_av"]').value = 'false';
    await host.querySelector('[data-user-save]').onclick();
    assert.equal(api.directory.users.find(user => user.username === 'wes_lugas').effective_permissions.can_access_av, true);
    assert.match(host.querySelector('[data-access-status]').textContent, /DENIED/);
});
