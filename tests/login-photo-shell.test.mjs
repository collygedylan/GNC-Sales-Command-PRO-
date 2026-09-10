import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(start, end) {
    const first = html.indexOf(start), last = html.indexOf(end, first);
    assert.ok(first >= 0 && last > first, start);
    return html.slice(first, last);
}

function freshnessFixture() {
    let indicator;
    const notices = [], signals = [];
    const drawer = { appendChild: value => { indicator = value; value.parentElement = drawer; } };
    const syncAction = { parentElement: drawer, insertAdjacentElement(position, value) {
        assert.equal(position, 'afterend');
        drawer.appendChild(value);
    } };
    const ctx = {
        document: {
            getElementById: id => ({ 'live-data-freshness': indicator, 'side-drawer': drawer, 'drawer-force-sync-btn': syncAction })[id],
            createElement: () => ({ style: {}, setAttribute() {} }),
            body: { appendChild() { assert.fail('Data status must not become a floating body overlay'); } }
        },
        productionLiveSyncDraftChanged: false,
        getCurrentVisibleViewId: () => 'home',
        productionLiveSyncCoordinator: { getStatus: () => null, signal: (...args) => signals.push(args) },
        canUseProductionLiveSync: () => true,
        showToast: (...args) => notices.push(args)
    };
    vm.createContext(ctx);
    vm.runInContext(section('        function renderProductionDataFreshness(', '        function hasProductionLiveSyncDraft('), ctx);
    return { ctx, notices, signals, drawer, get indicator() { return indicator; } };
}

test('data status stays in normal Menu flow instead of covering search controls', () => {
    const f = freshnessFixture();
    f.ctx.renderProductionDataFreshness({ state: 'Needs attention', lastVerifiedAt: null });
    assert.equal(f.indicator.parentElement, f.drawer);
    assert.match(f.indicator.style.cssText, /position:static/);
    assert.match(f.indicator.style.cssText, /color:#dcfce7!important/);
    assert.doesNotMatch(f.indicator.style.cssText, /position:fixed|position:absolute|z-index/);
    const first = f.indicator;
    f.ctx.renderProductionDataFreshness({ state: 'Up to date', lastVerifiedAt: Date.now() });
    assert.equal(f.indicator, first);
});

test('partial and unverified snapshots never display Data Current or account-verification warnings', () => {
    for (const state of ['Syncing', 'Importing', 'Needs attention', 'Offline']) {
        const f = freshnessFixture();
        f.ctx.renderProductionDataFreshness({ state, lastVerifiedAt: null, message: 'A dataset is pending.' });
        assert.doesNotMatch(f.indicator.textContent, /Data Current|not verified/i);
        assert.match(f.indicator.textContent, /Awaiting first data check/);
        assert.equal(f.indicator.hidden, false);
    }
});

test('confirmed freshness shows verification time; attention keeps the last checked time', () => {
    const f = freshnessFixture();
    f.ctx.renderProductionDataFreshness({ state: 'Up to date', lastVerifiedAt: Date.now() });
    assert.match(f.indicator.textContent, /^Data Current · Last checked /);
    f.ctx.renderProductionDataFreshness({ state: 'Needs attention', lastVerifiedAt: Date.now() });
    assert.match(f.indicator.textContent, /^Data Update Needs Attention · Last checked /);
});

test('data status retry explains the dataset error without implying account verification failure', () => {
    const f = freshnessFixture();
    f.ctx.renderProductionDataFreshness({ state: 'Needs attention', lastVerifiedAt: null, message: 'Calendar could not load.' });
    f.indicator.onclick();
    assert.match(f.notices[0][1], /Calendar could not load/);
    assert.match(f.notices[0][1], /not an account verification warning/);
    assert.deepEqual(f.signals, [['status-tap', 0]]);
});

test('a retained unconfirmed photo blocks shell replacement after the upload itself has finished', () => {
    let pending = true;
    const ctx = { window: { pendingPhotoUploads: new Map() }, pendingRequestArchiveFlushInFlight: false,
        hasPendingProtectedPhotoDrafts: () => pending };
    vm.createContext(ctx);
    vm.runInContext(section('        function isShellReloadHardBlocked(', '        function applyDeferredShellReloadIfHidden('), ctx);
    assert.equal(ctx.isShellReloadHardBlocked(), true);
    pending = false;
    assert.equal(ctx.isShellReloadHardBlocked(), false);
    ctx.window.pendingPhotoUploads.set('physical-row', {});
    assert.equal(ctx.isShellReloadHardBlocked(), true);
});

test('ambient realtime cannot start inventory loading while required access is being prepared', () => {
    const ctx = { loginShellPreparing: true, nativeAuthSessionActive: true,
        nativeAuthProfile: { id: 'profile', username: 'fixture' }, currentUser: 'fixture',
        window: { AgMetricLiveSync: {}, AgMetricLiveSyncRegistry: {} } };
    vm.createContext(ctx);
    vm.runInContext(section('        function canUseProductionLiveSync(', '        function createProductionCoreLiveAdapter('), ctx);
    assert.equal(ctx.canUseProductionLiveSync(), false);
    ctx.loginShellPreparing = false;
    assert.equal(ctx.canUseProductionLiveSync(), true);
    ctx.currentUser = 'different';
    assert.equal(ctx.canUseProductionLiveSync(), false);
});
