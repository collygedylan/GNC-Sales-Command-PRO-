import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationVisibilityFixture, navigationFixtureRuntime, startNavigationMatrixArrival } from '../src/ui/navigation-visibility-fixture.mjs';

const fullHome = ['drive', 'hl-order', 'av', 'sales-office', 'sales', 'historical-requests', 'managers', 'qc', 'office', 'sales-inventory', 'production', 'smart-moves'];
const coldHome = {
    'super-admin': fullHome, admin: fullHome, manager: fullHome.slice(0, -1),
    evaluator: ['drive', 'av', 'sales-office', 'sales-inventory'], sales: ['drive', 'av', 'sales-office', 'sales', 'office'],
    dock: ['drive', 'av', 'office', 'docks'], production: ['sales-inventory', 'production'], standard: ['communication']
};

test('every cold active role retains Home, drawer modules and eight footer positions on detail', async () => {
    for (const role of ['super-admin', 'admin', 'manager', 'evaluator', 'sales', 'dock', 'production', 'standard']) {
        const f = navigationVisibilityFixture({ role });
        try {
            await assert.rejects(f.preferences.refresh(), /offline/);
            f.render();
            assert.deepEqual(f.visible('[data-home-module-view]').map(node => node.dataset.homeModuleView), coldHome[role], role + ' Home modules');
            assert.ok(f.visible('#side-drawer [data-drawer-view]').length > 1, role + ' drawer modules');
            assert.equal(f.visible('#bottom-nav .footer-nav-btn').length, 8, role + ' eight slots');
            assert.equal(f.context.currentPrimaryViewId, 'detail');
            assert.equal(f.context.resolveUserAccessMatrix('worker').verified, false, 'display does not verify action matrix');
            f.context.window.GncUserAccessControl.setAccessMatrixRows([{ username: 'worker', role, view_permissions: { view_drive_mode: 'N', view_production: 'Y' } }]);
            assert.equal(f.context.canDisplayNavigationView('drive'), ['admin', 'super-admin'].includes(role), role + ' partial explicit deny');
            assert.equal(f.context.canDisplayNavigationView('production'), true, role + ' partial explicit grant');
        } finally { f.close(); }
    }
});

test('named aliases and admin display overrides survive complete N rows and denied preferences', async () => {
    for (const username of ['nelly_aguilar', ' NALLY_AGUILAR ', 'nellie_aguilar', 'dylan_collyge', 'megan_kelly',
        'jd_jones', 'mitch_kaiser', 'morgan_anderson', 'melissa_dowty']) {
        const f = navigationVisibilityFixture({ username, role: 'standard' });
        try {
            f.context.window.GncUserAccessControl.setAccessMatrixRows([{ username, view_permissions: { view_drive_mode: 'N' } }]);
            f.preferences.configure({ call: async () => ({ username: username.trim().toLowerCase(), shortcuts: ['tasks'],
                views: [{ view: 'drive', allowed: false, override: false, selectable: false }] }) });
            await f.preferences.refresh();
            f.render();
            assert.equal(f.visible('[data-home-module-view]').length, 12, username);
            assert.equal(f.visible('#bottom-nav .footer-nav-btn').length, 8, username);
            assert.deepEqual(f.visible('#bottom-nav .footer-nav-btn').map(node => node.dataset.footerView || node.id),
                ['footer-menu-btn', 'home', 'drive', 'eval_reports_2', 'communication', 'docks', 'request', 'footer-aura-btn']);
        } finally { f.close(); }
    }
});

test('display cache restores only exact same-profile permissions and never operation authority', () => {
    const storage = new Map();
    const first = navigationVisibilityFixture({ storage });
    first.context.window.GncUserAccessControl.setAccessMatrixRows([{ username: 'worker', role: 'standard',
        profile_id: 'profile-1', secret: 'must-not-persist', view_all_suspend: 'N', view_nursery_command_tables: 'Y',
        request_default_scope: 'OWN', suspend_default_scope: 'ALL', sales_rep_access: { worker: 'Y', other: 'N' },
        allowed_request_reps: { worker: 'Y' }, view_permissions: { view_drive_mode: 'Y', view_docks: 'N', view_eval_reports_2: 'Y' } }]);
    first.context.refreshNavigationDisplayCache(); first.close();
    assert.doesNotMatch([...storage.values()].join(''), /must-not-persist/);
    const persisted = JSON.parse([...storage.values()][0]);
    assert.equal(persisted.profileId, 'profile-1');
    assert.deepEqual(persisted.matrixRow.sales_rep_access, { worker: 'Y', other: 'N' });
    assert.equal(persisted.matrixRow.suspend_default_scope, 'ALL');
    const second = navigationVisibilityFixture({ storage });
    try {
        assert.equal(second.context.canDisplayNavigationView('drive'), true);
        assert.equal(second.context.canDisplayNavigationView('docks'), false);
        assert.equal(second.context.canDisplayNavigationView('eval_reports_2'), true);
        assert.equal(second.context.canAccessView('drive'), false);
        second.context.nativeAuthProfile.id = 'foreign-profile'; second.context.nativeAuthSessionUserId = 'foreign-profile';
        second.context.refreshNavigationDisplayCache();
        assert.equal(second.context.canDisplayNavigationView('drive'), false, 'foreign profile cache rejected');
    } finally { second.close(); }
});

test('canonical matrix arrival promotes only the same active display shell without remounting drafts', async () => {
    const f = navigationVisibilityFixture();
    try {
        f.context.switchView('communication');
        const view = f.context.getViewElementById('communication');
        const draft = f.dom.window.document.createElement('input'); draft.value = 'unsaved'; view.append(draft);
        assert.ok(view.querySelector('[data-navigation-display-status]'));
        const arrival = await startNavigationMatrixArrival(f);
        f.context.showOnlyPrimaryView = () => { throw new Error('grant must not remount the shell'); };
        const sequence = f.context.navTransitionSeq;
        await arrival.deliver([{ username: ' WORKER ', profile_id: 'profile-1', view_permissions: { view_comm: 'Y' } }]);
        assert.deepEqual(arrival.rendered, [['communication', false, false]]);
        assert.deepEqual(arrival.activated, ['communication']);
        assert.deepEqual(arrival.scheduled, ['navigation-access-ready:communication']);
        assert.deepEqual(arrival.restored, [['communication', 'navigation-access-ready', 83]]);
        assert.equal(f.context.navTransitionSeq, sequence);
        assert.equal(draft.value, 'unsaved'); assert.ok(view.contains(draft));
        assert.equal(view.querySelector('[data-navigation-display-status]'), null);
        assert.equal(f.context.promoteNavigationDisplayAfterAccess(), false, 'matching grant consumed once');
    } finally { f.close(); }
});

test('matrix arrival never remounts another view, a denied view, or a warm cached editor', async () => {
    for (const scenario of ['detail', 'denied', 'foreign', 'warm']) {
        const f = navigationVisibilityFixture();
        try {
            f.context.switchView('communication');
            const arrival = await startNavigationMatrixArrival(f, { initialized: scenario === 'warm' });
            if (scenario === 'detail') f.context.currentPrimaryViewId = 'detail';
            if (scenario === 'foreign') f.context.nativeAuthProfile.id = f.context.nativeAuthSessionUserId = 'foreign-profile';
            await arrival.deliver([{ username: 'worker', profile_id: 'profile-1', view_permissions: { view_comm: scenario === 'denied' ? 'N' : 'Y' } }]);
            assert.deepEqual(arrival.rendered, [], scenario);
            assert.deepEqual(arrival.activated, scenario === 'warm' ? ['communication'] : [], scenario);
        } finally { f.close(); }
    }
});

test('first legacy paint restores display cache and exact Eval Reports digit flags preserve both Y and N', () => {
    const storage = new Map();
    storage.set('gnc-navigation-access-display-v1:worker', JSON.stringify({ username: 'worker', profileId: 'legacy:worker',
        matrixRow: { username: 'worker', view_permissions: { view_drive_mode: 'Y', view_eval_reports_2: 'N' } } }));
    const f = navigationVisibilityFixture({ storage });
    try {
        f.context.nativeAuthSessionActive = false; f.context.nativeAuthProfile = null; f.context.nativeAuthSessionUserId = '';
        f.render();
        assert.ok(f.visible('[data-home-module-view]').some(tile => tile.dataset.homeModuleView === 'drive'));
        assert.equal(f.context.canDisplayNavigationView('eval_reports_2'), false);
        assert.equal(f.context.canAccessView('drive'), false);
        const yes = f.context.sanitizeAccessDisplayMatrix({ username: 'worker', view_permissions: { view_eval_reports_2: 'Y' } }, 'worker');
        assert.equal(f.context.resolveNavigationViewFlag('eval_reports_2', yes.view_permissions), 'Y');
        assert.equal(f.context.resolveNavigationViewFlag('eval-reports-2', yes.view_permissions), 'Y');
    } finally { f.close(); }
});

test('verified native bridge binds profile cache to the exact legacy token and account across reboot', async () => {
    const storage = new Map();
    const native = navigationVisibilityFixture({ storage });
    let sessionRecord;
    try {
        native.context.postAppFunctionJson = async () => ({ ok: true, session: {
            token: 'signed-bridge-A', expiresAt: Date.now() + 3600000, username: 'worker', role: 'standard'
        } });
        await native.context.ensureNativeAppSessionBridge(true);
        sessionRecord = native.context.readPersistedAppSessionRecord();
        assert.equal(sessionRecord.displayProfileId, 'profile-1');
        native.context.window.GncUserAccessControl.setAccessMatrixRows([{ username: 'worker', profile_id: 'profile-1',
            view_permissions: { view_drive_mode: 'Y', view_eval_reports_2: 'Y' } }]);
        native.context.refreshNavigationDisplayCache();
    } finally { native.close(); }
    const legacy = navigationVisibilityFixture({ storage, sessionRecord, legacy: true });
    try {
        legacy.render();
        assert.ok(legacy.visible('[data-home-module-view]').some(tile => tile.dataset.homeModuleView === 'drive'));
        assert.equal(legacy.context.canAccessView('drive'), false);
        legacy.context.persistAppSessionRecord({ token: sessionRecord.token, expiresAt: sessionRecord.expiresAt, username: 'worker', role: 'standard' });
        assert.equal(legacy.context.readPersistedAppSessionRecord().displayProfileId, 'profile-1');
        legacy.context.persistAppSessionRecord({ token: 'different-sign-in', expiresAt: sessionRecord.expiresAt, username: 'worker', role: 'standard' });
        assert.equal(legacy.context.readPersistedAppSessionRecord().displayProfileId, '');
        assert.equal(legacy.context.canDisplayNavigationView('drive'), false);
    } finally { legacy.close(); }
    const foreign = navigationVisibilityFixture({ storage, sessionRecord, legacy: true, username: 'foreign-account' });
    try { assert.equal(foreign.context.canDisplayNavigationView('drive'), false); }
    finally { foreign.close(); }
});

test('explicit denial leaves disabled slots and never grants a standard user navigation or a mutation', () => {
    const f = navigationVisibilityFixture();
    try {
        const flags = Object.fromEntries(['drive_mode', 'av', 'docks', 'comm', 'production', 'inventory', 'flyers', 'que_request', 'que_suspend'].map(key => ['view_' + key, 'N']));
        f.context.window.GncUserAccessControl.setAccessMatrixRows([{ username: 'worker', view_permissions: flags }]);
        f.render();
        assert.equal(f.context.canDisplayNavigationView('drive'), false);
        assert.equal(f.context.canAccessView('drive'), false);
        assert.equal(f.visible('#bottom-nav .footer-nav-btn').length, 8);
        assert.ok(f.visible('#bottom-nav [data-footer-view^="unavailable-"]').every(node => node.disabled));
        const fallback = f.dom.window.document.querySelector('[data-home-account-navigation]');
        assert.equal(fallback.textContent.trim(), 'Menu');
        fallback.click();
        assert.equal(f.context.menuOpen, true, 'safe Menu remains usable for complete explicit denial');
        f.context.switchView('drive');
        assert.equal(f.context.currentPrimaryViewId, 'detail');
    } finally { f.close(); }
});

test('cold standard Comm tile opens its shell and legacy verified cache remains account scoped', () => {
    const f = navigationVisibilityFixture();
    try {
        f.render();
        const tile = f.dom.window.document.querySelector('[data-home-account-navigation]');
        assert.equal(tile.textContent.trim(), 'Comm');
        tile.click();
        assert.equal(f.context.currentPrimaryViewId, 'communication');
        assert.equal(f.context.canAccessView('communication'), false);
        f.context.nativeAuthSessionActive = false; f.context.nativeAuthProfile = null; f.context.nativeAuthSessionUserId = '';
        f.context.window.GncUserAccessControl.setAccessMatrixRows([{ username: 'worker', view_permissions: { view_drive_mode: 'Y' } }]);
        f.context.refreshNavigationDisplayCache();
        const parsed = JSON.parse([...f.storage.values()][0]);
        assert.equal(parsed.profileId, 'legacy:worker');
        f.context.window.GncUserAccessControl.state.userAccess.length = 0;
        f.context.refreshNavigationDisplayCache();
        assert.equal(f.context.canDisplayNavigationView('drive'), true);
        f.context.hasAuthenticatedOperationalReadIdentity = () => false;
        assert.equal(f.context.canDisplayNavigationView('drive'), false);
    } finally { f.close(); }
});

test('storage refusal is optional and complete preference denial does not authorize hidden destinations', async () => {
    const f = navigationVisibilityFixture({ role: 'unrecognized' });
    try {
        Object.defineProperty(f.context.window, 'localStorage', { get() { throw new Error('SecurityError'); } });
        assert.doesNotThrow(() => f.context.refreshNavigationDisplayCache());
        f.context.window.GncUserAccessControl.setAccessMatrixRows([{ username: 'worker', view_permissions: { view_drive_mode: 'Y', view_comm: 'N' } }]);
        f.preferences.configure({ call: async () => ({ username: 'worker', views: [{ view: 'drive', allowed: false, override: false, selectable: false }] }) });
        await f.preferences.refresh(); f.render();
        assert.equal(f.context.canDisplayNavigationView('drive'), false);
        assert.equal(f.context.canDisplayNavigationView('communication'), false);
        assert.equal(f.dom.window.document.querySelector('[data-home-account-navigation]').textContent.trim(), 'Menu');
        assert.equal(f.visible('#bottom-nav .footer-nav-btn').length, 8);
    } finally { f.close(); }
});

test('visible cold shortcut opens its shell and confirmed revocation or foreign identity refuses it', () => {
    const f = navigationVisibilityFixture({ username: 'nelly_aguilar', role: 'admin' });
    try {
        f.render();
        f.dom.window.document.querySelector('#bottom-nav [data-footer-view="eval_reports_2"]').click();
        assert.equal(f.context.currentPrimaryViewId, 'managers');
        assert.equal(f.context.canAccessView('managers'), false);
        assert.equal(f.context.shouldRedirectForConfirmedViewDenial('managers'), false);
        f.context.hasConfirmedCurrentAccountRevocation = () => true;
        assert.equal(f.context.canDisplayNavigationView('drive'), false);
        f.context.hasConfirmedCurrentAccountRevocation = () => false;
        f.context.nativeAuthProfile.username = 'foreign';
        assert.equal(f.context.canDisplayNavigationView('drive'), false);
    } finally { f.close(); }
});

test('canonical access configuration restores display cache before its asynchronous matrix fetch', () => {
    const source = navigationFixtureRuntime.match(/        function configureCanonicalUserAccess\([^]*?^        }/m)[0];
    assert.ok(source.indexOf('refreshNavigationDisplayCache()') < source.indexOf('access.configure('));
    assert.match(source, /then\(normalizeNavigationAccessRows\)/);
});
