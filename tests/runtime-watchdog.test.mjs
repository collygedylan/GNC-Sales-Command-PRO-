import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
