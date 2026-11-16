import assert from 'node:assert/strict';
import vm from 'node:vm';
import {assertBulkMasterRpcTimeouts,readBulkMasterTriggerState} from '../services/bulk-master-http-contract.mjs';

export async function assertWatchdogAutoTriage(read, path, root, readFileSync) {
  const storage = new Map([['agdata.runtime-watchdog.pending.v2:dylan_collyge', JSON.stringify([{ username: 'dylan_collyge', fingerprint: 'old', app_version: 'AgData v2.3.54' }])]]);
  const rootNode = { querySelectorAll: () => [] };
  const document = { hidden: false, body: { ...rootNode, dataset: { currentView: 'drive' } }, documentElement: null,
    querySelector: () => null, getElementById: () => null, addEventListener() {} };
  const reports = [];
  const window = { __APP_RELEASE_VERSION__: 'AgData v2.3.57', activeHomeTab: '',
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout, clearTimeout, addEventListener() {} };
  const context = vm.createContext({ window, document, MutationObserver: class { observe() {} }, setTimeout, clearTimeout, console });
  vm.runInContext(read('assets/runtime-watchdog.js'), context, { filename: 'assets/runtime-watchdog.js' });
  window.GncRuntimeWatchdog.configure({ username: 'dylan_collyge', role: 'Admin', reportEvent: async event => { reports.push(event); return { ok: true }; } });
  const index = JSON.parse(read('docs/architecture/agdata-symbol-index.json'));
  const cases = [
    ['home', 'refreshDashboardSyncMetadata'], ['drive', 'renderDrive'], ['av', 'renderAV'], ['docks', 'renderDocks'],
    ['request', 'renderRequest'], ['managers', 'renderManagerEvalReports2Panel'], ['bloom', 'renderBloomPickerTrayRows'], ['chat', 'renderCommunicationHub'],
  ];
  for (const [viewId, symbol] of cases) {
    const event = window.GncRuntimeWatchdog.record('GOLDEN_TRIAGE', { view_id: viewId, suspected_functions: [symbol] });
    assert.equal(event.app_version, 'AgData v2.3.57');
    const skillPath = path.join(root, '.codex', 'skills', event.owning_skill, 'SKILL.md');
    assert.equal(readFileSync(skillPath, 'utf8').length > 0, true);
    const domain = index.domains[event.owning_skill];
    assert.ok(domain);
    assert.equal(Object.values(domain).flatMap(value => Array.isArray(value) ? value : []).includes(symbol), true, `${event.owning_skill}:${symbol}`);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...storage.values()].some(value => String(value).includes('AgData v2.3.54')), false);
  assert.equal(reports.every(event => event.app_version === 'AgData v2.3.57'), true);
}

export async function assertCurrentBulkRpcContract() {
  const safe=['search_path=""','statement_timeout=180s','lock_timeout=4s'];
  assert.doesNotThrow(()=>assertBulkMasterRpcTimeouts(safe));
  for(const config of [null,[],['statement_timeout=180s','lock_timeout=60s'],
    ['statement_timeout=180s','lock_timeout=0'],['statement_timeout=0','lock_timeout=4s']]) {
    assert.throws(()=>assertBulkMasterRpcTimeouts(config),assert.AssertionError);
  }
  const state={total:53,enabled:50,handover:1,handover_enabled:1,evidence_delta:2,evidence_delta_enabled:2,
    disabled_names:['trg_v2_master_inventory_crop_roll_drive_rows','trg_v2_master_inventory_crop_roll_drive_rows_delete',
      'trg_v2_master_inventory_crop_roll_drive_rows_insert'],retired_projection_disabled:3};
  let reads=0;
  assert.equal(await readBulkMasterTriggerState(async sql=>{reads++;assert.match(sql,/pg_trigger/);return state;}),state);
  assert.equal(reads,1);
  await assert.rejects(readBulkMasterTriggerState(async()=>({...state,evidence_delta_enabled:1})),assert.AssertionError);
}
