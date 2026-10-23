// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';

const source = readFileSync(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../assets/app-runtime.js', import.meta.url), 'utf8');

test('shell layout has explicit desktop and mobile structural rules independent of utility CSS', () => {
  const css = readFileSync(new URL('../assets/app-styles.css', import.meta.url), 'utf8');
  const tree = postcss.parse(css);
  const rule = selector => {
    let found;
    tree.walkRules(selector, node => { if (node.parent.type !== 'root') return; found = Object.fromEntries(node.nodes.filter(item => item.type === 'decl').map(item => [item.prop, item.value])); });
    assert.ok(found, selector); return found;
  };
  assert.deepEqual(rule('html body #app-wrapper .nav-header-utility'), {
    display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'flex-wrap': 'nowrap', 'flex-direction': 'row', gap: '8px', width: '100%', 'min-width': '0'
  });
  assert.equal(rule('html body #app-wrapper #header-version').width, 'auto');
  assert.equal(rule('html body #app-wrapper #header-version').flex, '0 0 auto');
  assert.equal(rule('html body #app-wrapper #bottom-nav').display, 'grid');
  assert.equal(rule('html body #app-wrapper #bottom-nav').position, 'fixed');
  assert.match(css, /max-width:\s*1120px/);
  assert.match(css, /min-height:\s*96px/);
  assert.match(css, /max-height:\s*130px/);
  assert.match(css, /summary::\-webkit-details-marker\s*\{\s*display:\s*none/);
  const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(shell, /id="dashboard-print-btn"[^>]*onclick="[^"]*window.print\(\)/);
  for (const label of ['Menu', 'Home', 'Drive', 'Docks', 'Que', 'Bloom', 'Comm']) assert.ok(shell.includes(`<span>${label}</span>`));
});

test('v2.3.52 assets and worker upgrade purge previous cache generations', () => {
  const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const match of shell.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="(\.\/assets\/[^"?]+\.(?:css|js)(?:\?[^\"]*)?)"/g)) {
    assert.equal(new URL(match[1], 'https://agmetricapp.com').searchParams.get('v'), '2.3.52', match[1]);
  }
  assert.match(sw, /const CACHE_NAME = 'agdata-v2.3.52'/);
  assert.match(sw, /APP_SHELL_RUNTIME_REVISION = 'watchdog-hotfix-r2'/);
  assert.match(sw, /self\.skipWaiting\(\)/); assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(shell, /registration\.update\(\)[^]*navigator\.serviceWorker\.addEventListener\('controllerchange'[^]*window\.reloadForServiceWorkerUpdate\(\)[^]*window\.addEventListener\('focus'[^]*scheduleShellMaintenance\('focus'/);
  const ctx = vm.createContext({ CACHE_NAME: 'agdata-v2.3.52' });
  vm.runInContext(sw.match(/function isRetiredRootCacheName\([^]*?^}/m)[0], ctx);
  for (const key of ['agdata-v2.3.34', 'agdata-v2.3.43', 'agdata-v2.3.46', 'agdata-v2.3.46-r2', 'ag-data-v4.3-rebuild-AgData v2.3.37', 'ag-data-runtime-images-v2', 'legacy-shell']) assert.equal(ctx.isRetiredRootCacheName(key), true, key);
  assert.equal(ctx.isRetiredRootCacheName('agdata-v2.3.52'), false);
  const worker = vm.createContext({ self: { addEventListener() {}, location: { href: 'https://agmetricapp.com/sw.js', origin: 'https://agmetricapp.com' }, registration: { scope: 'https://agmetricapp.com/' } }, URL });
  vm.runInContext(sw + '\nglobalThis.assets = ASSETS_TO_CACHE;', worker);
  for (const asset of worker.assets.filter(asset => /\.(?:css|js|mjs)(?:\?|$)/.test(asset))) assert.equal(new URL(asset, 'https://agmetricapp.com').searchParams.get('v'), '2.3.52', asset);
  const build = readFileSync(new URL('../scripts/build-live-shell.mjs', import.meta.url), 'utf8');
  assert.match(build, /shellStylesheetMarkup\(`\.\/assets\/live-app-styles-base/);
  assert.match(build, /shellStylesheetMarkup\(pilotStylesheetHref\)/);
});

test('v2.3.52 keeps access-code login and native bridging reachable before profile hydration', () => {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const appApi = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/pages-static.yml', import.meta.url), 'utf8');
  const probe = readFileSync(new URL('../scripts/probe-production-login.mjs', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.app-api\][^[]*verify_jwt\s*=\s*false/);
  assert.match(config, /\[functions\.aura-llm-router\][^[]*verify_jwt\s*=\s*false/);
  const profileless = appApi.match(/function profilelessActionResponse\([^]*?^}/m)?.[0] || '';
  assert.doesNotMatch(profileless, /user_access|native_session_bridge/);
  assert.match(appApi, /if \(action === "login"\) return await handleLogin\(payload, req\);[^]*resolveZeroTrustRequestContext/);
  assert.match(runtimeSource, /PRELOGIN_BACKGROUND_ACTIONS = new Set\(\['navigation_preferences', 'get_user_preferences', 'request_work'\]\)/);
  assert.match(runtimeSource, /recoverShellAfterLoginRuntimeFailure\(err, 'login-finalization-failure'\)/);
  assert.match(runtimeSource, /markAgDataRuntimeReady\?\.\(\)/);
  assert.doesNotMatch(runtimeSource, /Login service unavailable/);
  assert.match(agents, /Deploy `app-api` and `aura-llm-router` only with `supabase functions deploy <name> --no-verify-jwt`/);
  assert.match(workflow, /Verify live access-code and native session login[^]*node scripts\/probe-production-login\.mjs/);
  assert.match(probe, /username = 'dylan_collyge'[^]*action: 'login'[^]*action: 'user_access'[^]*action: 'native_session_bridge'/);
});
const watchdogPanelContext = {};
vm.runInNewContext(readFileSync(new URL('../assets/runtime-watchdog-panel.js', import.meta.url), 'utf8'), watchdogPanelContext);
const { createController: createRuntimeWatchdogPanel } = watchdogPanelContext.AgMetricRuntimeWatchdogPanel;

function harness() {
  const listeners = new Map();
  const timers = [];
  const idle = [];
  const errors = [];
  let hidden = false;
  let nextId = 1;
  const add = (target, name, callback) => {
    const key = `${target}:${name}`;
    listeners.set(key, [...(listeners.get(key) || []), callback]);
  };
  const queue = (items, callback, options) => {
    const item = { id: nextId++, callback, options, cancelled: false };
    items.push(item);
    return item.id;
  };
  const cancel = (items, id) => {
    const item = items.find(entry => entry.id === id);
    if (item) item.cancelled = true;
  };
  const document = {
    get hidden() { return hidden; },
    readyState: 'loading',
    addEventListener: (name, callback) => add('document', name, callback),
  };
  const window = {
    document,
    AbortController,
    console: { error: (...args) => errors.push(args) },
    addEventListener: (name, callback) => add('window', name, callback),
    setTimeout: (callback, delay) => queue(timers, callback, delay),
    clearTimeout: id => cancel(timers, id),
    requestIdleCallback: (callback, options) => queue(idle, callback, options),
    cancelIdleCallback: id => cancel(idle, id),
  };
  const context = vm.createContext({ window, document, AbortController, console: window.console, URL });
  vm.runInContext(source, context, { filename: 'assets/app-lifecycle.js' });
  const run = items => {
    assert.ok(items.length, 'expected a queued callback');
    const item = items.shift();
    if (!item.cancelled) item.callback({ didTimeout: false, timeRemaining: () => 50 });
  };
  return {
    context,
    window,
    api: window.AgMetricLifecycle,
    errors,
    timers,
    idle,
    setHidden: value => { hidden = value; },
    event(target, name, isTrusted = true) {
      for (const callback of listeners.get(`${target}:${name}`) || []) {
        callback({ type: name, isTrusted });
      }
    },
    runTimer: () => run(timers),
    runIdle: () => run(idle),
    runAgain: () => vm.runInContext(source, context, { filename: 'assets/app-lifecycle.js' }),
  };
}

const eventValues = events => events.map(({ type, reason }) => ({ type, reason }));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('missing watchdog panel module cannot abort app runtime boot', async () => {
  const start = runtimeSource.indexOf('function createRuntimeWatchdogPanelOrNoop(');
  const end = runtimeSource.indexOf('\n        const runtimeWatchdogPanel =', start);
  assert.ok(start >= 0 && end > start, 'runtime retains the fail-open panel factory');
  const factory = runtimeSource.slice(start, end);
  const context = vm.createContext({
    window: { GncRuntimeWatchdog: { capture() { throw new Error('telemetry unavailable'); } } },
    Promise,
  });
  vm.runInContext(`${factory}\nconst panel = createRuntimeWatchdogPanelOrNoop(undefined, {});\n\n` +
    `globalThis.panelResult = [panel.renderPanel(), panel.refreshBadge(), panel.refreshPanel(), panel.copyFixBrief()];\n` +
    `globalThis.bootReached = true;`, context);
  assert.equal(context.bootReached, true);
  assert.match(context.panelResult[0], /Manager remains available/);
  assert.equal(await context.panelResult[1], null);
  assert.equal(await context.panelResult[2], null);
  assert.equal(await context.panelResult[3], false);
});

function watchdogPanelHarness() {
  let username = 'dylan_collyge', profileId = 'profile-a', authEpoch = 1, cacheScope = 'cache-a';
  let visibleView = 'managers', activeTab = 'runtime-watchdog';
  const pending = [];
  const writes = [];
  let requests = 0;
  let scopeCurrent = true;
  const host = { innerHTML: '', querySelectorAll: () => [] };
  const badge = { textContent: '', title: '', classList: { toggle() {} } };
  const elements = new Map([['runtime-watchdog-events', host], ['runtime-watchdog-header-badge', badge]]);
  const document = { getElementById: id => elements.get(id) || null };
  const controller = createRuntimeWatchdogPanel({
    document,
    lifecycle: { createScope: () => ({ isCurrent: () => scopeCurrent, dispose() {} }) },
    apiUrl: '/api',
    postJson: () => { requests++; const task = deferred(); pending.push(task); return task.promise; },
    getUsername: () => username,
    getProfileId: () => profileId,
    getAuthEpoch: () => authEpoch,
    getCacheScope: () => cacheScope,
    getVisibleView: () => visibleView,
    getActiveTab: () => activeTab,
    panelViewId: 'runtime-watchdog',
    escape: value => String(value || ''),
    clipboard: { writeText: async value => writes.push(value) },
    showToast() {},
    prompt() {},
  });
  return {
    controller, pending, writes, host, badge, get requests() { return requests; },
    setOwner(value, profile, epoch, scope) { username = value; profileId = profile; authEpoch = epoch; cacheScope = scope; },
    setScopeCurrent(value) { scopeCurrent = value; },
    setVisibleView(value) { visibleView = value; },
    setActiveTab(value) { activeTab = value; },
    setHost(value) { elements.set('runtime-watchdog-events', value); },
  };
}

test('watchdog badge and Manager panel share one active-owner refresh', async () => {
  const h = watchdogPanelHarness();
  const panel = h.controller.refreshPanel();
  const badge = h.controller.refreshBadge(true);
  assert.equal(h.requests, 1, 'the badge and panel share a single owner-scoped request');
  h.pending[0].resolve({ data: [{ id: 1, status: 'open', normalized_role: 'manager', view_id: 'home', owning_skill: 'agdata-runtime-watchdog', username: 'dylan_collyge' }], fixBrief: 'current brief' });
  await Promise.all([panel, badge]);
  assert.match(h.host.innerHTML, /dylan_collyge/);
  assert.equal(h.badge.textContent, '1');
  assert.deepEqual(h.writes, []);
});

test('watchdog refresh and copied brief cannot publish after account or view ownership changes', async () => {
  const h = watchdogPanelHarness();
  const oldHost = h.host;
  const oldPanel = h.controller.refreshPanel();
  h.setOwner('megan_kelly', 'profile-b', 2, 'cache-b');
  const freshHost = { innerHTML: '', querySelectorAll: () => [] };
  h.setHost(freshHost);
  const freshPanel = h.controller.refreshPanel();
  assert.equal(h.requests, 2, 'a new authenticated owner starts a new request');
  h.pending[1].resolve({ data: [{ id: 2, status: 'open', normalized_role: 'admin', view_id: 'home', owning_skill: 'agdata-runtime-watchdog', username: 'megan_kelly' }], fixBrief: 'new owner brief' });
  await freshPanel;
  h.pending[0].resolve({ data: [{ id: 1, status: 'open', username: 'dylan_collyge' }], fixBrief: 'old owner brief' });
  await oldPanel;
  assert.match(freshHost.innerHTML, /megan_kelly/);
  assert.doesNotMatch(freshHost.innerHTML, /dylan_collyge/);
  assert.equal(oldHost.innerHTML, '', 'the detached prior panel is not resurrected');
  await h.controller.copyFixBrief();
  assert.deepEqual(h.writes, ['new owner brief']);

  h.setOwner('jd_jones', 'profile-c', 3, 'cache-c');
  const copied = h.controller.copyFixBrief();
  assert.equal(h.requests, 3, 'owner changes invalidate cached incidents and brief before copy');
  h.pending[2].resolve({ data: [], fixBrief: 'third owner brief' });
  await copied;
  assert.deepEqual(h.writes, ['new owner brief', 'third owner brief']);

  const pendingPanel = h.controller.refreshPanel();
  const before = freshHost.innerHTML;
  h.setScopeCurrent(false);
  h.pending[3].resolve({ data: [{ id: 3, username: 'stale-view' }], fixBrief: 'stale view brief' });
  await pendingPanel;
  assert.equal(freshHost.innerHTML, before, 'an aborted lifecycle view does not publish late results');
  assert.deepEqual(h.writes, ['new owner brief', 'third owner brief']);
});

test('startup restores the native session before exposing credentials after an update reload', async () => {
  const html = readComposedAppSource();
  const startup = html.match(/        async function initializeAppSessionOnLoad\([^]*?^        }/m)?.[0];
  assert.ok(startup);
  for (const restored of [true, false]) {
    const shell = deferred(), restore = deferred();
    const inputs = new Set(), spinner = new Set(['hidden']);
    const elements = new Map([['login-inputs', { classList: { add: name => inputs.add(name), remove: name => inputs.delete(name) } }],
      ['loading-spinner', { classList: { add: name => spinner.add(name), remove: name => spinner.delete(name) } }]]);
    let resets = 0, savedPrompts = 0;
    const runtime = vm.createContext({ appSessionStartupStarted: false, NATIVE_AUTH_ENABLED: true,
      document: { getElementById: id => elements.get(id) }, hasExplicitLogoutMarker: () => false,
      ensureCurrentShellBuild: () => shell.promise, restoreNativeAuthSessionOnStartup: () => restore.promise,
      setLoginProgress() {}, resetLoginUiState: () => { resets++; inputs.delete('hidden'); spinner.add('hidden'); },
      primeSavedLoginUiOnStartup: () => { savedPrompts++; }, console, showToast() {} });
    vm.runInContext(startup, runtime);
    const pending = runtime.initializeAppSessionOnLoad();
    assert.equal(inputs.has('hidden'), true, 'credentials stay hidden during the shell/version check');
    assert.equal(spinner.has('hidden'), false);
    shell.resolve(false);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(inputs.has('hidden'), true, 'credentials stay hidden while SDK restoration is pending');
    assert.equal(resets, 0);
    restore.resolve(restored);
    await pending;
    assert.equal(resets, restored ? 0 : 1);
    assert.equal(savedPrompts, restored ? 0 : 1);
    assert.equal(inputs.has('hidden'), restored, 'the login form appears only when no session was restored');
  }
});

test('a transient Chat schema probe failure does not permanently disable the next authorized visit', async () => {
  const html = readComposedAppSource();
  const source = html.match(/        async function ensureChatSchemaReady\([^]*?^        }/m)?.[0];
  assert.ok(source);
  let unavailable = true, probes = 0;
  const runtime = vm.createContext({ chatSchemaReady: null, chatSchemaProbePromise: null, navigator: { onLine: true },
    CHAT_CONVERSATIONS_TABLE: 'conversations', CHAT_PARTICIPANTS_TABLE: 'participants', CHAT_MESSAGES_TABLE: 'messages',
    chatApiGet: async () => { probes++; if (unavailable) throw new Error('Network timeout'); return []; },
    maybeWarnChatSchemaMissing() {} });
  vm.runInContext(source, runtime);
  assert.equal(await runtime.ensureChatSchemaReady(), false);
  unavailable = false;
  assert.equal(await runtime.ensureChatSchemaReady(), true);
  assert.equal(probes, 6, 'the next visit performs real guarded reads again');
});

test('successful native permission refresh health telemetry is informational', () => {
  const html = readComposedAppSource();
  const source = html.match(/        async function refreshNativeRoleAndCapabilities\([^]*?^        }/m)?.[0];
  assert.ok(source);
  assert.match(source, /reportSemanticHealthEvent\('native_role_refreshed', 'auth', roleChanged \? 'NATIVE_ROLE_CHANGED' : 'NATIVE_PERMISSIONS_CHANGED', \{[^]*?\}, 'info'\)/);
  assert.match(source, /\.catch\(\(error\) => \{[^]*?setProductionPermissionCheckState\('failed'\)/);
});

test('same-account Request access refresh is silent and deduplicated; old owners and real denials remain fenced', async () => {
  const html = readComposedAppSource();
  const functions = ['initializeRequestCapabilities', 'getRequestCapabilityStatusMarkup'].map(name => {
    const source = html.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?^        }', 'm'))?.[0];
    assert.ok(source, name); return source;
  }).join('\n');
  for (const outcome of ['ready', 'transient', 'denied', 'account-change']) {
    const gate = deferred();
    let reads = 0, persisted = 0;
    const retained = { username: 'worker', canViewQueue: true };
    const runtime = vm.createContext({ currentUser: 'worker', nativeAuthSessionActive: true, nativeAuthSessionUserId: 'account-a',
      nativeAuthProfile: { id: 'account-a', active: true }, productionLiveSyncReadAuthEpoch: 1, window: {},
      requestCapabilityLoadPromise: null, navigator: { onLine: true },
      requestCapabilityState: { username: 'worker', profileId: 'account-a', authEpoch: 1,
        status: 'ready', stale: false, loadedAt: 1, capabilities: retained },
      getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase(),
      readCachedRequestCapabilities: () => assert.fail('the same-owner memory snapshot takes precedence'),
      refreshRequestCapabilityUi() {}, normalizeRequestCapabilities: value => value,
      persistRequestCapabilities: () => { persisted++; }, reportSemanticHealthEvent() {},
      isSupabaseReadTerminalDenial: error => Number(error?.status) === 403,
      supabaseRpc: async () => {
        reads++; await gate.promise;
        if (outcome === 'denied' || outcome === 'transient') throw Object.assign(new Error(outcome), { status: outcome === 'denied' ? 403 : 503 });
        return { username: 'worker', canViewQueue: false };
      },
    });
    vm.runInContext(functions, runtime);
    const first = runtime.initializeRequestCapabilities({ force: true });
    const second = runtime.initializeRequestCapabilities({ force: true });
    assert.equal(reads, 1);
    assert.equal(runtime.requestCapabilityState.stale, true, 'retained access is not falsely marked fresh');
    assert.equal(runtime.requestCapabilityState.capabilities, retained);
    assert.equal(runtime.getRequestCapabilityStatusMarkup(), '', 'background checks do not replace Home with a permissions banner');
    let replacement;
    if (outcome === 'account-change') {
      runtime.currentUser = 'other'; runtime.nativeAuthProfile = { id: 'account-b' };
      runtime.nativeAuthSessionUserId = 'account-b'; runtime.productionLiveSyncReadAuthEpoch++;
      replacement = { username: 'other', status: 'loading', capabilities: null };
      runtime.requestCapabilityState = replacement;
    }
    gate.resolve();
    await Promise.all([first, second]);
    if (outcome === 'account-change') {
      assert.equal(runtime.requestCapabilityState, replacement);
      assert.equal(persisted, 0);
    } else if (outcome === 'denied') {
      assert.equal(runtime.requestCapabilityState.capabilities, null);
      assert.match(runtime.getRequestCapabilityStatusMarkup(), /role="alert"/);
      assert.equal(persisted, 0);
    } else {
      assert.equal(runtime.getRequestCapabilityStatusMarkup(), '');
      assert.equal(runtime.requestCapabilityState.capabilities.canViewQueue, outcome === 'transient');
      assert.equal(persisted, outcome === 'ready' ? 1 : 0);
    }
  }
});

test('installs one owner with compatibility adapters and validates lifetime names', () => {
  const h = harness();
  const owner = h.api;
  assert.equal(h.window.getShellMaintenanceSignal(), owner.getSignal());
  assert.equal(h.window.suspendShellMaintenanceForNavigation, owner.suspendNavigation);
  assert.equal(Object.isFrozen(owner), true);
  h.runAgain();
  assert.equal(h.window.AgMetricLifecycle, owner, 'a second load must retain the singleton');
  assert.throws(() => owner.getSignal('worker'), /Unknown lifecycle lifetime/);
  assert.throws(() => owner.createScope({ lifetime: 'worker' }), /Unknown lifecycle lifetime/);
});

test('view and session invalidation fence late work while scopes stay isolated', async () => {
  const h = harness();
  const documentSignal = h.api.getSignal('document');
  const sessionSignal = h.api.getSignal('session');
  h.api.enterView('home');
  const firstViewSignal = h.api.getSignal('view');
  const sessionA = h.api.createScope({ lifetime: 'session' });
  const sessionB = h.api.createScope({ lifetime: 'session' });
  const home = h.api.createScope();
  const events = [];
  h.api.subscribe(event => events.push(event));

  sessionA.dispose();
  assert.equal(sessionA.isCurrent(), false);
  assert.equal(sessionB.isCurrent(), true, 'disposing one child cannot abort a sibling');
  assert.equal(sessionSignal.aborted, false, 'disposing a child cannot abort its parent');
  h.api.enterView('home');
  assert.equal(home.isCurrent(), true, 're-entering the same key is a no-op');
  h.api.enterView('request');
  assert.equal(home.signal.aborted, true);
  assert.equal(sessionB.isCurrent(), true);
  assert.equal(firstViewSignal.aborted, true);

  const request = h.api.createScope();
  const guardedCalls = [];
  const guarded = request.guard(value => guardedCalls.push(value));
  const read = deferred();
  const commits = [];
  const completion = read.promise.then(value => {
    if (request.isCurrent()) commits.push(value);
    guarded(value);
  });
  const requestViewSignal = h.api.getSignal('view');
  h.api.resetSession();
  assert.equal(sessionSignal.aborted, true);
  assert.equal(requestViewSignal.aborted, true);
  assert.equal(documentSignal.aborted, false);
  assert.equal(sessionB.signal.aborted, true);
  assert.equal(request.signal.aborted, true);
  assert.notEqual(h.api.getSignal('session'), sessionSignal);
  assert.notEqual(h.api.getSignal('view'), requestViewSignal);
  read.resolve('stale');
  await completion;
  assert.deepEqual(commits, []);
  assert.deepEqual(guardedCalls, []);
  assert.deepEqual(eventValues(events), [
    { type: 'view', reason: 'view-change' },
    { type: 'session', reason: 'session-reset' },
  ]);
});

test('a same-view Manager module refresh preserves its view-scoped work', () => {
  const h = harness();
  h.api.enterView('managers');
  const moduleRead = h.api.createScope();
  h.api.enterView('managers');
  assert.equal(moduleRead.isCurrent(), true);
  h.api.enterView('home');
  assert.equal(moduleRead.isCurrent(), false, 'leaving Managers still retires the module-owned view work');
});

test('resolved live revisions clear the first-sync header before snapshot hydration completes', () => {
  const markStart = runtimeSource.indexOf('function recordDatasetRevisionConnection(');
  const labelEnd = runtimeSource.indexOf('\n        function requireCurrentProductionLiveSyncProof', markStart);
  assert.ok(markStart >= 0 && labelEnd > markStart);
  const state = vm.createContext({
    datasetRevisionConnectionOwner: '', datasetRevisionConnectionStates: [], hasActiveManualSync: () => true,
    getSupabaseReadIdentityScope: () => 'account-a:login-1',
    getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase(),
    window: { GncUserAccessControl: { getSelfState: () => ({ denied: false }) } },
    updateSyncDiagnostics: () => { state.diagnosticsUpdates++; }, diagnosticsUpdates: 0,
  });
  vm.runInContext(runtimeSource.slice(markStart, labelEnd) +
    '\nglobalThis.record = recordDatasetRevisionConnection; globalThis.label = getDatasetRevisionConnectionLabel;', state);
  const value = { contractVersion: 1, permissionVersion: 'access-v2', sources: [
    { key: 'ph_master_inventory', state: 'ready' }, { key: 'ph_soc_master', state: 'importing' },
  ] };
  const normalized = { sources: new Map(value.sources.map(source => [source.key, source])) };
  assert.equal(state.record(value, normalized, { readIdentity: 'account-a:login-1', authenticated: true, accessDenied: false }), true);
  assert.equal(state.label(), 'Connected · 1 ready · 1 updating');
  state.hasActiveManualSync = () => false;
  assert.equal(state.label(), 'Connected · 1 ready');
  assert.equal(state.diagnosticsUpdates, 1);
  assert.match(runtimeSource, /onRevisionRead: \(value, metadata, context\) => recordDatasetRevisionConnection\(value, metadata, context\)/);
  assert.match(runtimeSource, /connectionSourceKeys: \(\) => \['ph_master_inventory'\]/);
  assert.match(runtimeSource, /const revisionSummary = navigator\.onLine === false \? '' : getDatasetRevisionConnectionLabel\(\)/);
});

test('generic Manager module stays selected while same-account access is stale, but not after denial', () => {
  const helperStart = runtimeSource.indexOf('function shouldRetainManagerModuleDuringAccessRefresh(');
  const helperEnd = runtimeSource.indexOf('\n        function renderManagers()', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const source = runtimeSource.slice(helperStart, helperEnd);
  const context = vm.createContext({ getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase() });
  vm.runInContext(`${source}; globalThis.shouldRetain = shouldRetainManagerModuleDuringAccessRefresh;`, context);
  const allowed = new Set(['dashboard']);
  const stale = { status: 'ready', stale: true, username: 'dylan_collyge', snapshot: { username: 'dylan_collyge' } };
  assert.equal(context.shouldRetain('eval-reports-2', allowed, stale, 'dylan_collyge', true, false), true);
  assert.equal(context.shouldRetain('eval-reports-2', allowed, stale, 'megan_kelly', true, false), false);
  assert.equal(context.shouldRetain('eval-reports-2', allowed, stale, 'dylan_collyge', true, true), false);
  assert.equal(context.shouldRetain('eval-reports-2', allowed,
    { status: 'ready', stale: false, username: 'dylan_collyge', snapshot: { username: 'dylan_collyge' } },
    'dylan_collyge', true, false), false);
  const managerStart = runtimeSource.indexOf('function renderManagers()');
  const resetAt = runtimeSource.indexOf("activeHomeTab = 'dashboard';", managerStart);
  assert.ok(runtimeSource.indexOf('shouldRetainManagerModuleDuringAccessRefresh(', managerStart) < resetAt,
    'transient refresh retention runs before the dashboard fallback');
});

test('Docks and Que session/view reads survive a same-account access snapshot completion while real session reset still aborts', async () => {
  const html = readComposedAppSource();
  for (const view of ['docks', 'request']) {
    const h = harness();
    const access = deferred();
    const persisted = [];
    Object.assign(h.context, {
      SUPABASE_URL: 'https://fixture.invalid', nativeAuthSessionActive: true,
      nativeAuthProfile: { id: 'account-a', username: 'worker' }, currentUser: 'worker',
      currentRole: 'Admin', currentUserDivision: '10', productionLiveSyncReadAuthEpoch: 1,
      productionLiveSyncReadPermissionVersion: 'access-v1',
      appAccessSnapshotLoadPromise: null,
      appAccessSnapshotState: { username: 'worker', profileId: 'account-a', authEpoch: 1,
        status: 'ready', stale: false, loadedAt: 1, snapshot: { username: 'worker', dataPermissionVersion: 'access-v1' } },
      navigator: { onLine: true }, activeHomeTab: 'dashboard', MANAGER_ACCESS_CONTROL_VIEW: 'access-control',
      getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase(),
      getCurrentLoginCacheScopeKey: () => 'account-a:login-1',
      supabaseRpc: () => access.promise,
      normalizeAppAccessSnapshot: (value, username) => value?.username === username ? value : null,
      persistAppAccessSnapshot: value => persisted.push(value),
      getRoleAccessState: () => ({ isAdmin: true }),
      reportSemanticHealthEvent: () => assert.fail('same-account refresh should not fail'),
      readCachedAppAccessSnapshot: () => assert.fail('the same-account in-memory snapshot should be retained'),
    });
    for (const name of ['getSupabaseReadIdentityScope', 'initializeAppAccessSnapshot']) {
      const functionSource = html.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?^        }', 'm'))?.[0];
      assert.ok(functionSource, `missing ${name}`);
      vm.runInContext(functionSource, h.context);
    }
    h.api.enterView(view);
    const session = h.api.createScope({ lifetime: 'session' });
    const viewRead = h.api.createScope();
    const owner = h.context.getSupabaseReadIdentityScope();
    const pending = h.context.initializeAppAccessSnapshot({ force: true, reason: 'native-role-refresh' });
    assert.equal(h.context.appAccessSnapshotState.status, 'loading');
    assert.equal(session.isCurrent(), true);
    assert.equal(viewRead.isCurrent(), true);
    h.context.productionLiveSyncReadPermissionVersion = 'access-v2';
    access.resolve({ username: 'worker', dataPermissionVersion: 'access-v2' });
    const snapshot = await pending;
    assert.equal(snapshot.dataPermissionVersion, 'access-v2');
    assert.equal(persisted.length, 1);
    assert.equal(h.context.appAccessSnapshotState.status, 'ready');
    assert.equal(h.context.getSupabaseReadIdentityScope(), owner, 'mutable permission metadata is not a read owner');
    assert.equal(session.isCurrent(), true, `${view}: session read remains live`);
    assert.equal(viewRead.isCurrent(), true, `${view}: view read remains live`);
    h.context.productionLiveSyncReadAuthEpoch++;
    assert.notEqual(h.context.getSupabaseReadIdentityScope(), owner, 'logout/relogin remains a real identity boundary');
    h.api.resetSession();
    assert.equal(session.signal.aborted, true);
    assert.equal(viewRead.signal.aborted, true);
  }
});

test('cancelled navigation may resume on trusted activity but committed navigation requires pageshow', () => {
  const h = harness();
  const events = [];
  h.api.subscribe(event => events.push(event));

  const first = h.api.getSignal();
  h.event('window', 'beforeunload');
  assert.equal(first.aborted, true);
  h.event('window', 'focus', false);
  assert.equal(h.api.getSignal().aborted, true);
  h.event('document', 'pointerdown');
  assert.equal(h.api.getSignal().aborted, false);

  const committed = h.api.getSignal();
  h.event('window', 'pagehide');
  assert.equal(committed.aborted, true);
  h.event('window', 'focus');
  h.event('document', 'keydown');
  assert.equal(h.api.getSignal().aborted, true);
  h.event('window', 'pageshow', false);
  assert.equal(h.api.getSignal().aborted, true);
  h.event('window', 'pageshow');
  assert.equal(h.api.getSignal().aborted, false);
  assert.deepEqual(eventValues(events), [
    { type: 'suspend', reason: 'beforeunload' },
    { type: 'resume', reason: 'pointerdown' },
    { type: 'suspend', reason: 'pagehide' },
    { type: 'resume', reason: 'pageshow' },
  ]);
});

test('hidden pageshow unlocks only a later trusted visible restoration and retires foreground scopes', () => {
  const h = harness();
  h.api.enterView('home');
  const foreground = h.api.createScope({ foreground: true });
  const ordinary = h.api.createScope();
  const events = [];
  const unsubscribe = h.api.subscribe(event => events.push(event));

  h.event('window', 'pagehide');
  h.setHidden(true);
  h.event('window', 'pageshow');
  assert.equal(h.api.getSignal().aborted, true);
  h.event('document', 'visibilitychange');
  assert.equal(foreground.signal.aborted, true);
  assert.equal(ordinary.signal.aborted, true, 'pagehide retires every scope');
  h.setHidden(false);
  h.event('document', 'visibilitychange', false);
  assert.equal(h.api.getSignal().aborted, true);
  h.event('document', 'visibilitychange');
  assert.equal(h.api.getSignal().aborted, false);
  const visible = h.api.createScope({ foreground: true });
  assert.equal(visible.isCurrent(), true);

  unsubscribe();
  h.event('window', 'offline');
  assert.deepEqual(eventValues(events), [
    { type: 'suspend', reason: 'pagehide' },
    { type: 'visibility', reason: 'hidden' },
    { type: 'visibility', reason: 'visible' },
    { type: 'resume', reason: 'visibilitychange' },
    { type: 'visibility', reason: 'visible' },
  ]);
});

test('foreground hiding does not invalidate ordinary scopes in a live document', () => {
  const h = harness();
  h.api.enterView('home');
  const foreground = h.api.createScope({ foreground: true });
  const ordinary = h.api.createScope();
  h.setHidden(true);
  h.event('document', 'visibilitychange');
  assert.equal(foreground.signal.aborted, true);
  assert.equal(ordinary.isCurrent(), true);
  h.setHidden(false);
  h.event('document', 'visibilitychange');
  assert.equal(ordinary.isCurrent(), true);
  assert.equal(h.api.createScope({ foreground: true }).isCurrent(), true);
});

test('timeout and idle cancellation is idempotent and queued callbacks cannot cross invalidation', () => {
  const h = harness();
  h.api.enterView('home');
  const calls = [];
  const scope = h.api.createScope();
  const cancelTimeout = scope.timeout(() => calls.push('cancelled-timeout'), 25);
  const cancelIdle = scope.idle(() => calls.push('cancelled-idle'), { timeout: 50 });
  cancelTimeout();
  cancelTimeout();
  cancelIdle();
  cancelIdle();
  h.runTimer();
  h.runIdle();
  assert.deepEqual(calls, []);

  const stale = h.api.createScope();
  stale.timeout(() => calls.push('stale-timeout'), 1);
  stale.idle(() => calls.push('stale-idle'), { timeout: 1 });
  h.api.enterView('request');
  stale.dispose();
  stale.dispose();
  h.runTimer();
  h.runIdle();
  assert.deepEqual(calls, []);

  const fresh = h.api.createScope();
  fresh.timeout(() => calls.push('fresh-timeout'), 1);
  fresh.idle(() => calls.push('fresh-idle'), { timeout: 1 });
  h.runTimer();
  h.runIdle();
  assert.deepEqual(calls, ['fresh-timeout', 'fresh-idle']);
});

test('a subscriber failure is isolated from later subscribers', () => {
  const h = harness();
  const calls = [];
  h.api.subscribe(() => { throw new Error('subscriber failure'); });
  h.api.subscribe(event => calls.push(event.type));
  h.api.enterView('home');
  assert.deepEqual(calls, ['view']);
  assert.equal(h.errors.length, 1);
});
// @test-group: foundation

test('runtime readiness cancels recovery while a load failure purges stale shell state', async () => {
  const ready = harness();
  ready.event('document', 'DOMContentLoaded');
  assert.equal(ready.window.markAgDataRuntimeReady(), true);
  ready.runTimer();
  assert.equal(ready.window.__AGDATA_RUNTIME_READY__, true);

  const failed = harness();
  const deleted = [];
  let unregistered = 0;
  let replacement = '';
  const storage = new Map();
  failed.window.__APP_SHELL_VERSION__ = 'AgData v2.3.52';
  failed.window.navigator = { serviceWorker: { getRegistrations: async () => [{
    scope: 'https://agmetricapp.com/', active: { scriptURL: 'https://agmetricapp.com/sw.js' },
    unregister: async () => { unregistered += 1; },
  }] } };
  failed.window.caches = { keys: async () => ['agdata-v2.3.50', 'agdata-v2.3.52', 'other-cache'], delete: async key => { deleted.push(key); return true; } };
  failed.window.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  failed.window.location = { href: 'https://agmetricapp.com/index.html', replace: value => { replacement = value; }, reload() {} };
  await failed.window.recoverAppLoadFailure('login-runtime-failure');
  assert.equal(unregistered, 1);
  assert.deepEqual(deleted.sort(), ['agdata-v2.3.50', 'agdata-v2.3.52']);
  assert.match(replacement, /shellv=AgData(?:\+|%20)v2\.3\.52/);
  assert.match(replacement, /shellts=\d+/);
});

test('an active session defers worker updates and mismatch recovery without changing the screen', async () => {
  const h = harness(); let reloads = 0;
  h.window.location = { reload() { reloads++; } };
  h.window.isAuthenticatedAppSessionActive = () => true;
  assert.equal(h.window.reloadForServiceWorkerUpdate('AgData v2.3.33'), false);
  assert.equal(await h.window.recoverShellVersionMismatch('AgData v2.3.32', 'AgData v2.3.33'), false);
  assert.equal(h.window.__gncShellUpdateReady, true);
  assert.equal(h.timers.length, 0); assert.equal(reloads, 0);
});

test('a queued worker reload is canceled when login completes before its timer', () => {
  const h = harness(); let active = false, reloads = 0;
  h.window.location = { reload() { reloads++; } };
  h.window.isAuthenticatedAppSessionActive = () => active;
  assert.equal(h.window.reloadForServiceWorkerUpdate('AgData v2.3.33'), true);
  active = true; h.runTimer();
  assert.equal(reloads, 0); assert.equal(h.window.__gncPwaReloadPending, false);
});

test('transient session loss retains the active identity while confirmed disablement clears it', async () => {
  const ctx = vm.createContext({ currentUser: 'dylan_collyge', nativeAuthProfile: { id: 'actor' }, nativeAuthAccessToken:'expired',
    nativeAuthProfileRestorePending:false, nativeAuthSessionActive:true, nativeAuthReadRequired:true, nativeAuthSessionUserId:'actor',
    hasExplicitLogoutMarker:()=>false, invalidateNativeAuthRecovery(){}, getSupabaseBrowserClient:()=>({auth:{signOut:async()=>{}}}),
    clearCachedNativeAuthProfile(){}, clearInMemorySessionIdentity(){ctx.currentUser='';}, resetLoginUiState(){ctx.loginShown=true;} });
  for (const name of ['isNativeAuthSessionRevoked','clearRevokedNativeAuthSession']) {
    const expression = new RegExp('        (?:async )?function ' + name + '\\([^]*?^        }','m');
    vm.runInContext(runtimeSource.match(expression)[0],ctx);
  }
  assert.equal(await ctx.clearRevokedNativeAuthSession({status:401}),false);
  assert.equal(ctx.currentUser,'dylan_collyge'); assert.equal(ctx.loginShown,undefined);
  assert.equal(await ctx.clearRevokedNativeAuthSession({code:'NATIVE_PROFILE_DISABLED'}),true);
  assert.equal(ctx.currentUser,''); assert.equal(ctx.loginShown,true);
});


test('dark sync controls and Manager modules retain visible surfaces during startup and scrolling', () => {
  const css = readFileSync(new URL('../assets/app-styles.css', import.meta.url),'utf8');
  assert.match(css, /#dashboard-sync-accordion[^]*?#062115/);
  assert.match(css, /manager-module-card[^]*?content-visibility:\s*visible/);
});
