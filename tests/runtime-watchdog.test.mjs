import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';

const source = fs.readFileSync(new URL('../assets/runtime-watchdog.js', import.meta.url), 'utf8');

test('header watchdog badge force-hides after Dylan switches to any other canonical user', async () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../assets/runtime-watchdog-panel.js', import.meta.url), 'utf8'), { module, Date });
  let username = 'dylan_collyge';
  let reads = 0;
  const badge = { hidden: true, style: { display: 'none' }, textContent: '', title: '', classList: { toggle() {} } };
  const panel = module.exports.createController({ document: { getElementById: () => badge },
    getUsername: () => username, getProfileId: () => username, apiUrl: '/app-api',
    postJson: async () => { reads++; return { data: [{ id: 1 }] }; } });
  await panel.refreshBadge(true);
  assert.equal(badge.hidden, false);
  assert.notEqual(badge.style.display, 'none');
  for (username of ['brian_hatfield', 'megan_kelly', 'jd_jones', 'admin', 'Dylan Collyge', '']) {
    badge.hidden = false; badge.style.display = ''; badge.textContent = '1';
    await panel.refreshBadge(true);
    assert.equal(badge.hidden, true, username);
    assert.equal(badge.style.display, 'none', username);
    assert.equal(badge.textContent, '', username);
  }
  assert.equal(reads, 1, 'hidden badge performs no additional reads; telemetry uses its independent transport');
  const runtime = readComposedAppSource();
  const start = runtime.indexOf('function syncRuntimeWatchdogHeaderVisibility()');
  const end = runtime.indexOf('\n        function configureRuntimeWatchdogForCurrentSession()', start);
  assert.ok(start >= 0 && end > start);
  const hideHeaderBadge = runtime.slice(start, end);
  const otherBadge = { hidden: false, style: { display: '' }, textContent: '9', title: 'open', classList: { add() {} } };
  const otherContext = { currentUser: 'megan_kelly', document: { getElementById: () => otherBadge } };
  vm.runInNewContext(`${hideHeaderBadge}; syncRuntimeWatchdogHeaderVisibility();`, otherContext);
  assert.equal(otherBadge.hidden, true);
  assert.equal(otherBadge.style.display, 'none');
  assert.equal(otherBadge.textContent, '');
  assert.equal(otherBadge.title, '');
});

test('Watchdog Monitor is the first Manager module only for the three authorized administrators', () => {
  const runtime = readComposedAppSource();
  const start = runtime.indexOf('function getManagerModuleOptions(');
  const end = runtime.indexOf('\n        function getManagerModuleMeta(', start);
  assert.ok(start >= 0 && end > start);
  const picker = runtime.slice(start, end);
  for (const username of ['dylan_collyge', 'megan_kelly', 'jd_jones']) {
    const context = { currentUser: username, MANAGER_RUNTIME_WATCHDOG_VIEW: 'runtime-watchdog',
      SHEAR_APPROVAL_VIEW: 'shear-approval', NCR_APPROVAL_NEW_CROP_VIEW: 'ncr-approval-new-crop' };
    vm.runInNewContext(`${picker}; result = getManagerModuleOptions({}, [], [{ id: 'first-tool', label: 'First tool' }]);`, context);
    assert.equal(context.result[0].id, 'runtime-watchdog', username);
    assert.equal(context.result[0].label, 'WATCHDOG MONITOR', username);
  }
  const other = { currentUser: 'brian_hatfield', MANAGER_RUNTIME_WATCHDOG_VIEW: 'runtime-watchdog',
    SHEAR_APPROVAL_VIEW: 'shear-approval', NCR_APPROVAL_NEW_CROP_VIEW: 'ncr-approval-new-crop' };
  vm.runInNewContext(`${picker}; result = getManagerModuleOptions({}, [], [{ id: 'first-tool', label: 'First tool' }]);`, other);
  assert.equal(other.result[0].id, 'first-tool');
  assert.equal(other.result.some(option => option.id === 'runtime-watchdog'), false);
  assert.match(runtime, /if \(activeHomeTab === 'dashboard'\) html = renderManagerModulePicker\(access, managerApprovalTabs, managerToolTabs\);/);
});

function parityHarness({ currentView = 'managers', subModule = 'eval-reports-2' } = {}) {
  const reports = [], timers = new Map();
  let now = 0, timerId = 0;
  const dom = { loading: false, cards: [], counts: null };
  const leaf = textContent => ({ textContent, children: [], closest: () => null });
  const root = {
    textContent: '',
    querySelector: selector => selector === '[data-eval-report-counts-ready="true"]' ? dom.counts : null,
    querySelectorAll: selector => selector === '[data-suspend-tag-card="true"]' ? dom.cards
      : selector === '*' && dom.loading ? [leaf('Loading...')] : []
  };
  const document = { body: { dataset: { currentView }, ...root }, documentElement: {},
    querySelector: () => null, getElementById: () => root, addEventListener() {} };
  const schedule = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; };
  const cancel = id => timers.delete(id);
  const window = { __APP_RELEASE_VERSION__: 'AgData v2.3.28', addEventListener() {}, setTimeout: schedule, clearTimeout: cancel };
  class MutationObserver { observe() {} }
  vm.runInNewContext(source, { window, document, MutationObserver, setTimeout: schedule, clearTimeout: cancel,
    Date: { now: () => now }, Map, Set, Object, String, Number, Array });
  const watchdog = window.GncRuntimeWatchdog;
  watchdog.configure({ username: 'dylan_collyge', role: 'Admin', getSubModule: () => subModule,
    reportEvent: event => { reports.push(event); return { ok: true }; } });
  return { reports, dom, document, watchdog, leaf,
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await new Promise(resolve => setImmediate(resolve)); }
  };
}

test('parity sensor flags Suspend metric dashes but accepts explicit zero and N/A', async () => {
  const h = parityHarness({ currentView: 'request', subModule: '' });
  const metric = (name, value) => ({ ...h.leaf(value), dataset: { queueMetric: name } });
  let metrics = [metric('on-hand', '0'), metric('review', '0'), metric('loc-photo-match', 'N/A')];
  h.dom.cards = [{ closest: () => null, querySelectorAll: () => metrics }];
  h.watchdog.inspect();
  assert.equal(h.reports.length, 0);
  metrics = [metric('on-hand', '--'), metric('reason', '--')];
  h.watchdog.inspect();
  await h.advance(0);
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].event_type, 'DATA_PARITY_MISMATCH');
  assert.equal(h.reports[0].owning_skill, 'agdata-queue-and-reclass-specialist');
  assert.match(h.reports[0].error_message, /SUSPEND/);
  h.watchdog.inspect();
  await h.advance(0);
  assert.equal(h.reports.length, 1, 'repeat mutations are deduplicated');
});

test('parity sensor reports Eval Loading text only after two seconds and cancels after navigation or completion', async () => {
  const h = parityHarness();
  h.dom.loading = true;
  h.watchdog.inspect();
  await h.advance(1999);
  assert.equal(h.reports.length, 0);
  await h.advance(2);
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].event_type, 'DATA_PARITY_MISMATCH');
  assert.ok(h.reports[0].duration_ms >= 2000);
  for (const change of ['complete', 'navigate', 'account']) {
    const other = parityHarness();
    other.dom.loading = true; other.watchdog.inspect();
    if (change === 'complete') other.dom.loading = false;
    if (change === 'navigate') other.document.body.dataset.currentView = 'home';
    if (change === 'account') other.watchdog.configure({ username: 'megan_kelly', role: 'Admin', reportEvent: event => other.reports.push(event) });
    other.watchdog.inspect(); await other.advance(2001);
    assert.equal(other.reports.length, 0, change);
  }
});

test('parity sensor detects contradictory all-zero Eval counts without flagging a valid empty result', () => {
  const h = parityHarness();
  const counts = Array.from({ length: 11 }, () => ({ dataset: { evalReportCount: '0' } }));
  h.dom.counts = { dataset: { evalSourceRowCount: '9581', evalReportMatchCount: '0' }, querySelectorAll: () => counts };
  h.watchdog.inspect();
  assert.equal(h.reports.length, 0, 'an authoritative empty report is valid');
  h.dom.counts.dataset.evalReportMatchCount = '7180';
  h.watchdog.inspect();
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].event_type, 'DATA_PARITY_MISMATCH');
  assert.match(h.reports[0].error_message, /11.*zero/);
});

test('watchdog normalizes every supported role alias and emits bounded incident fields', async () => {
  const listeners = new Map();
  const reported = [];
  const emptyRoot = { querySelector: () => null, querySelectorAll: () => [], textContent: '' };
  const document = { body: { dataset: { currentView: 'drive' }, ...emptyRoot }, documentElement: {}, querySelector: () => null, getElementById: () => null };
  class MutationObserver { observe() {} }
  const window = { __APP_RELEASE_VERSION__: 'AgData v2.3.22', addEventListener: (name, fn) => listeners.set(name, fn), setTimeout: () => 1, clearTimeout: () => {} };
  vm.runInNewContext(source, { window, document, MutationObserver, setTimeout, clearTimeout, Map, Set, Object, String, Number, Array });
  const roles = ['admin', 'sales rep', 'salesrep', 'sales_rep', 'supervisor', 'evaluator', 'kier', 'dock office', 'dock_office', 'qc supervisor', 'qc_supervisor', 'shipping', 'data entry', 'data_entry', 'foreman', 'take backs', 'take_backs'];
  const normalized = roles.map(role => window.GncRuntimeWatchdog.normalizeRole(role));
  assert.deepEqual(normalized, ['admin', 'sales_rep', 'sales_rep', 'sales_rep', 'supervisor', 'evaluator', 'kier', 'dock_office', 'dock_office', 'qc_supervisor', 'qc_supervisor', 'shipping', 'data_entry', 'data_entry', 'foreman', 'take_backs', 'take_backs']);
  window.GncRuntimeWatchdog.configure({ username: 'dylan_collyge', role: 'Admin', reportEvent: event => reported.push(event) });
  const event = window.GncRuntimeWatchdog.record('VIEW_LOAD_STALL', { duration_ms: 4001, error_message: 'LOADING DATA...' });
  assert.equal(reported.length, 1);
  for (const field of ['event_type', 'severity', 'app_version', 'username', 'normalized_role', 'view_id', 'sub_module', 'duration_ms', 'error_message', 'dataset_revisions_snapshot', 'cluster_id', 'owning_skill', 'suspected_functions', 'fingerprint']) assert.ok(Object.hasOwn(event, field), field);
  assert.equal(event.normalized_role, 'admin');
  assert.equal(event.view_id, 'drive');
  assert.equal(event.duration_ms, 4001);
  assert.equal(event.owning_skill, 'agdata-drive-and-av-specialist');
  assert.equal(window.GncRuntimeWatchdog.capture({ name: 'AbortError' }, 'view.cancel'), false);
  assert.equal(reported.length, 1, 'expected view cancellation is not an incident');
  assert.equal(window.GncRuntimeWatchdog.capture(new Error('secret token and row contents'), 'queue.persist'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reported[1].event_type, 'OPERATIONAL_FAILURE');
  assert.equal(reported[1].error_message, 'queue.persist failed (Error)');
  assert.equal(JSON.stringify(reported).includes('secret token'), false);
  window.GncRuntimeWatchdog.configure({ username: 'dylan_collyge', role: 'Admin', reportEvent: () => { throw new Error('transport unavailable'); } });
  assert.doesNotThrow(() => window.GncRuntimeWatchdog.capture(new Error('failure'), 'view.load'));
});

test('watchdog queues reports per account, retries after transport recovery and ignores a settled first view', async () => {
  const listeners = new Map();
  const storage = new Map();
  const timers = new Map();
  let timerId = 0;
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const emptyRoot = { querySelector: () => null, querySelectorAll: () => [], textContent: '' };
  const document = {
    body: { dataset: { currentView: 'home' }, ...emptyRoot }, documentElement: {},
    querySelector: () => null, getElementById: () => null, addEventListener: () => {}
  };
  const window = {
    __APP_RELEASE_VERSION__: 'AgData v2.3.27', localStorage,
    addEventListener: (name, fn) => listeners.set(name, fn),
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id)
  };
  class MutationObserver { observe() {} }
  vm.runInNewContext(source, { window, document, MutationObserver, setTimeout, clearTimeout, Map, Set, Object, String, Number, Array });
  const watchdog = window.GncRuntimeWatchdog;
  let rejectFirstReport;
  const dylanReports = [];
  watchdog.configure({ username: 'dylan_collyge', role: 'Admin', getSubModule: () => 'home-dashboard', reportEvent: event => {
    dylanReports.push(event);
    return new Promise((_, reject) => { rejectFirstReport = reject; });
  } });
  watchdog.inspect();
  assert.equal(storage.size, 0, 'an already-rendered first view must not create a load-stall incident');
  watchdog.setDatasetRevisions({ inventory: { revision: '7', state: 'ready' } });
  watchdog.record('OPERATIONAL_FAILURE', { view_id: 'home', error_message: 'bounded failure' });
  const dylanKey = 'agdata.runtime-watchdog.pending.v1:dylan_collyge';
  assert.equal(JSON.parse(storage.get(dylanKey)).length, 1, 'inflight delivery remains durable in the account queue');

  const otherAccountReports = [];
  watchdog.configure({ username: 'megan_kelly', role: 'Admin', reportEvent: event => { otherAccountReports.push(event); return { ok: true }; } });
  watchdog.record('OPERATIONAL_FAILURE', { view_id: 'home', error_message: 'other account' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(otherAccountReports.length, 1);
  assert.equal(otherAccountReports[0].username, 'megan_kelly');
  assert.equal(JSON.parse(storage.get(dylanKey))[0].username, 'dylan_collyge', 'another account cannot drain the queued event');
  rejectFirstReport(new Error('offline'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(storage.get(dylanKey)).length, 1, 'a stale request completion cannot mutate the new account queue');

  const recoveredReports = [];
  watchdog.configure({ username: 'dylan_collyge', role: 'Admin', reportEvent: event => { recoveredReports.push(event); return { ok: true }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recoveredReports.length, 1);
  assert.equal(recoveredReports[0].username, 'dylan_collyge');
  assert.equal(recoveredReports[0].app_version, 'AgData v2.3.27');
  assert.equal(recoveredReports[0].sub_module, 'home-dashboard');
  assert.deepEqual(JSON.parse(JSON.stringify(recoveredReports[0].dataset_revisions_snapshot)), { inventory: { revision: '7', state: 'ready' } });
  assert.equal(dylanReports.length, 1);
  assert.equal(storage.has(dylanKey), false, 'successful delivery clears only that account queue');
});

test('production login wires the sensor to the authenticated watchdog app-api action', () => {
  const runtime = readComposedAppSource();
  const fixture = fs.readFileSync(new URL('../tests/fixtures/hl-order-state.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /function configureRuntimeWatchdogForCurrentSession\(\)/);
  assert.match(runtime, /window\.GncRuntimeWatchdog\.configure\(\{\s*apiUrl: APP_API_FUNCTION_URL/);
  assert.match(runtime, /postAppFunctionJson\(APP_API_FUNCTION_URL, \{ action: 'watchdog_log_event', event \}/);
  assert.match(runtime, /configureRuntimeWatchdogForCurrentSession\(\);[\s\S]{0,500}if \(nativeAuthSessionActive\)/);
  assert.match(runtime, /GncRuntimeWatchdog\?\.flushPendingReports\?\.\(\)/);
  assert.ok(fixture.includes("if (body.action === 'watchdog_log_event')"));
  assert.ok(fixture.includes("Object.keys(body).sort().join(',') === 'action,event'"));
  assert.ok(fixture.includes("if (body.action === 'watchdog_list_events')"));
  assert.ok(fixture.includes("Object.keys(body).join(',') === 'action'"));
  assert.ok(fixture.includes("String(body.action || '').startsWith('watchdog_')"));
  assert.match(runtime, /getSubModule: \(\) => getCurrentVisibleViewId\(\) === 'managers' \? activeHomeTab : ''/);
});

test('watchdog transport supports native-only auth and rejects absent or switched auth before sending', async () => {
  const runtime = readComposedAppSource();
  const start = runtime.indexOf('function syncRuntimeWatchdogHeaderVisibility()');
  const end = runtime.indexOf('\n        async function finalizeLogin', start);
  assert.ok(start >= 0 && end > start, 'expected the production watchdog configuration helper');
  const helper = runtime.slice(start, end);
  const harness = ({ native = false, token = '', headersPromise = Promise.resolve({ apikey: 'public-key', Authorization: 'Bearer native-token', 'Content-Type': 'application/json' }) } = {}) => {
    let options = null;
    const posted = [];
    let headerReads = 0;
    const context = {
      window: { GncRuntimeWatchdog: { configure(value) { options = value; } } },
      APP_API_FUNCTION_URL: 'https://example.supabase.co/functions/v1/app-api',
      currentUser: 'dylan_collyge', currentRole: 'Admin', activeHomeTab: 'dashboard',
      getCurrentVisibleViewId: () => 'managers',
      getCurrentAppSessionToken: () => token,
      nativeAuthSessionActive: native,
      nativeAuthProfile: native ? { id: 'profile-1' } : null,
      nativeAuthSessionUserId: native ? 'profile-1' : '',
      nativeAuthRecoveryEpoch: 4,
      getNativeAuthRequestHeaders: async () => { headerReads += 1; return await headersPromise; },
      postAppFunctionJson: async (...args) => { posted.push(args); return { ok: true }; }
    };
    vm.runInNewContext(helper, context);
    context.configureRuntimeWatchdogForCurrentSession();
    return { context, options: () => options, posted, headerReads: () => headerReads };
  };

  const native = harness({ native: true });
  await native.options().reportEvent({ username: 'dylan_collyge' });
  assert.equal(native.headerReads(), 1);
  assert.equal(native.posted.length, 1);
  assert.equal(native.posted[0][1].action, 'watchdog_log_event');
  assert.equal(native.posted[0][2].nativeHeaders.Authorization, 'Bearer native-token');

  const unauthenticated = harness();
  await assert.rejects(unauthenticated.options().reportEvent({ username: 'dylan_collyge' }), /session is not ready/i);
  assert.equal(unauthenticated.posted.length, 0);

  let resolveHeaders;
  const switched = harness({ native: true, headersPromise: new Promise(resolve => { resolveHeaders = resolve; }) });
  const send = switched.options().reportEvent({ username: 'dylan_collyge' });
  switched.context.currentUser = 'megan_kelly';
  resolveHeaders({ apikey: 'public-key', Authorization: 'Bearer native-token', 'Content-Type': 'application/json' });
  await assert.rejects(send, /account changed/i);
  assert.equal(switched.posted.length, 0);

  let resolveStaleHeaders;
  const staleEpoch = harness({ native: true, headersPromise: new Promise(resolve => { resolveStaleHeaders = resolve; }) });
  const staleSend = staleEpoch.options().reportEvent({ username: 'dylan_collyge' });
  staleEpoch.context.nativeAuthRecoveryEpoch += 1;
  resolveStaleHeaders({ apikey: 'public-key', Authorization: 'Bearer native-token', 'Content-Type': 'application/json' });
  await assert.rejects(staleSend, /account changed/i);
  assert.equal(staleEpoch.posted.length, 0, 'a stale auth epoch cannot send telemetry');
});

test('critical catch fallbacks report bounded operational failures without replacing their recovery', () => {
  for (const path of ['index.html', 'assets/app-lifecycle.js', 'assets/live-sync-coordinator.js',
    'assets/request-submission.js', 'assets/user-access-control.js', 'assets/queue-completion-state.js']) {
    const text = path === 'index.html' ? readComposedAppSource()
      : fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(text, /GncRuntimeWatchdog\?\.capture\?\.\(error,/, path);
  }
});

test('watchdog persistence is RLS protected and privileged actions are server authorized', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261021030302_runtime_watchdog_v1.sql', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  assert.match(migration, /unique \(fingerprint, app_version\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.app_runtime_watchdog_events from anon, authenticated/);
  assert.match(api, /watchdog_log_event/);
  assert.match(api, /watchdog_list_events/);
  assert.match(api, /watchdog_resolve_events/);
  assert.match(api, /new Set\(\["dylan_collyge", "megan_kelly", "jd_jones"\]\)/);
  assert.match(api, /createClient<Database>\(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(api, /supabase\.from\("app_runtime_watchdog_events" as never\)\.upsert/);
});

test('signed watchdog email embeds the same complete fix brief returned to the copy button', () => {
  const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/runtime-watchdog-brief.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, module);
  const row = { username: 'megan_kelly', normalized_role: 'admin', view_id: 'managers', sub_module: 'eval-reports-2',
    duration_ms: 4200, event_type: 'VIEW_LOAD_STALL', error_message: 'test incident',
    dataset_revisions_snapshot: { inventory: '42' }, cluster_id: 'Cluster 5', owning_skill: 'agdata-field-ops-and-qc',
    suspected_functions: ['buildManagerEvalReport2IndexAsync'] };
  const release = 'AgData v' + JSON.parse(read('package.json')).version;
  const brief = module.exports.buildRuntimeWatchdogFixBrief([row], release);
  for (const text of ['# AgData Runtime Watchdog Fix Brief', release, 'megan_kelly', '4200ms', 'inventory', '42', 'Cluster 5', '.codex/skills/agdata-field-ops-and-qc/SKILL.md', 'buildManagerEvalReport2IndexAsync', 'Focused verification:']) assert.ok(brief.includes(text), text);
  const script = read('Code.gs');
  const start = script.indexOf('function handleRuntimeWatchdogAlert_('), end = script.indexOf('\nfunction ', start + 1);
  let sent;
  const context = { verifyRuntimeWatchdogAlert_: () => ({ fingerprint: 'f', appVersion: 'AgData v2.3.23', severity: 'high', view: 'managers', fixBrief: brief }),
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { computeDigest: () => [], DigestAlgorithm: { SHA_256: '' }, base64EncodeWebSafe: () => 'hash' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) }, MailApp: { sendEmail: value => { sent = value; } } };
  vm.runInNewContext(script.slice(start, end) + '\nhandleRuntimeWatchdogAlert_({});', context);
  assert.equal(sent.to, 'dylan_collyge@greenleafnursery.com');
  assert.ok(sent.body.endsWith(brief));
  assert.match(readComposedAppSource(), /const brief = fixBrief;/);
  assert.match(read('supabase/functions/app-api/index.ts'), /fixBrief: buildRuntimeWatchdogFixBrief\(\(data \|\| \[\]\) as Record<string, unknown>\[\]\, APP_RUNTIME_RELEASE\)/);
});
