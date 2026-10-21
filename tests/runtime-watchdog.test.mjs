import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../assets/runtime-watchdog.js', import.meta.url), 'utf8');

test('watchdog normalizes every supported role alias and emits bounded incident fields', () => {
  const listeners = new Map();
  const reported = [];
  const emptyRoot = { querySelector: () => null, querySelectorAll: () => [], textContent: '' };
  const document = { body: { dataset: { currentView: 'drive' }, ...emptyRoot }, documentElement: {}, querySelector: () => null, getElementById: () => null };
  class MutationObserver { observe() {} }
  const window = { __APP_RELEASE_VERSION__: 'AgData v2.3.22', addEventListener: (name, fn) => listeners.set(name, fn) };
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
  assert.equal(reported[1].event_type, 'OPERATIONAL_FAILURE');
  assert.equal(reported[1].error_message, 'queue.persist failed (Error)');
  assert.equal(JSON.stringify(reported).includes('secret token'), false);
  window.GncRuntimeWatchdog.configure({ username: 'dylan_collyge', role: 'Admin', reportEvent: () => { throw new Error('transport unavailable'); } });
  assert.doesNotThrow(() => window.GncRuntimeWatchdog.capture(new Error('failure'), 'view.load'));
});

test('critical catch fallbacks report bounded operational failures without replacing their recovery', () => {
  for (const path of ['index.html', 'assets/app-lifecycle.js', 'assets/live-sync-coordinator.js',
    'assets/request-submission.js', 'assets/user-access-control.js', 'assets/queue-completion-state.js']) {
    const text = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
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
  const brief = module.exports.buildRuntimeWatchdogFixBrief([row]);
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
  assert.match(read('index.html'), /const brief = runtimeWatchdogFixBrief;/);
  assert.match(read('supabase/functions/app-api/index.ts'), /fixBrief: buildRuntimeWatchdogFixBrief/);
});
