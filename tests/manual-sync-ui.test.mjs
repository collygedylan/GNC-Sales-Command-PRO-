import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: node-unit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();

function extractBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} / ${endMarker}`);
  return html.slice(start, end);
}

test('manual sync client fallback uses the ordered five-stage pass and advances past a failed stage', () => {
  const stageMatch = html.match(/const MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT = Object\.freeze\((\[[^;]+\])\);/);
  assert.ok(stageMatch, 'client fallback stage order is present');
  const expectedOrder = ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'];
  const stageOrder = vm.runInNewContext(stageMatch[1]);
  assert.deepEqual(Array.from(stageOrder), expectedOrder);

  const normalizers = extractBetween('        function normalizeRetiredManualSyncStageKey(', '        function getManualSyncStatusTimestampMs(');
  const progress = extractBetween('        function getManualSyncProgressInfo(', '        function getManualSyncStatusText(');
  const sandbox = {
    module: { exports: {} },
    RETIRED_MANUAL_SYNC_STAGE_KEYS: new Set(['disease', 'lab', 'lab_reports']),
    MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT: expectedOrder,
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '',
    Date, String, Number, Array, Object, Math,
  };
  vm.runInNewContext(`${normalizers}\n${progress}\nmodule.exports = { normalizeManualSyncStatusPayload, getManualSyncProgressInfo };`, sandbox);
  const { normalizeManualSyncStatusPayload, getManualSyncProgressInfo } = sandbox.module.exports;
  const active = normalizeManualSyncStatusPayload({
    active: true,
    currentStage: 'soc',
    stageIndex: 3,
    stageResults: [{ key: 'drive', outcome: 'failed', errorCode: 'DRIVE_READ_FAILED' }],
  });
  assert.deepEqual(Array.from(active.stageOrder), expectedOrder, 'an active legacy status without stageOrder uses the five-stage fallback');
  assert.equal(active.stageResults[0].outcome, 'failed', 'failure detail remains available to the status UI');
  assert.equal(getManualSyncProgressInfo(active).text, '4/5', 'the worker’s next stage index is reflected rather than remaining at 0/5');
});

test('explicit logout does not reveal the blank login UI mid-signout; deliberate empty login still validates', () => {
  const authWatcher = extractBetween('        function installNativeRoleRefreshWatchers(', "        document.addEventListener('visibilitychange'");
  const logout = extractBetween('        async function performLogout()', '        function debounce(');
  const login = extractBetween('        function handleLogin(isBiometricLogin=false)', '        async function submitNewPassword(');
  assert.match(authWatcher, /typeof resetLoginUiState === 'function' && !hasExplicitLogoutMarker\(\)\) resetLoginUiState\(\)/);
  assert.ok(logout.indexOf('setExplicitLogoutMarker();') < logout.indexOf('client.auth.signOut()'), 'explicit logout is marked before Supabase emits SIGNED_OUT');
  assert.ok(logout.indexOf('client.auth.signOut()') < logout.indexOf('location.reload()'), 'the UI stays on the authenticated shell while sign-out and cleanup finish');
  assert.match(login, /if\(!rawUser\|\|!inputPass\)\{ showToast\("Error","Please enter username and password",true\); return; \}/,
    'an explicit empty login attempt retains its normal validation');
});

test('each committed ERP file toasts once for Dylan even before the stage advances; completion restores idle', () => {
  const source = extractBetween('        function applyManualSyncStatus(', '        async function refreshManualSyncStatus(');
  for (const username of ['dylan_collyge', 'megan_kelly']) {
    const toasts = [], diagnostics = [];
    const initial = { active: true, runId: 'one-run', stageIndex: 0, stageResults: [] };
    const context = vm.createContext({
      manualSyncStatusState: initial, currentUser: username, navigator: { onLine: true },
      normalizeManualSyncStatusPayload: value => value || {}, isManualSyncStatusClientStale: () => false,
      syncGoogleScriptButton() {}, refreshDashboardSyncMetadata: async () => {},
      shouldPauseManualSyncViewRefresh: () => false, updateSyncDiagnostics: value => diagnostics.push(value),
      scheduleManualSyncStatusPoll() {}, clearManualSyncStatusPoll() {},
      refreshRealtimeSubscriptionsForCurrentView() {}, scheduleManualSyncCompletionRefresh() {},
      manualSyncTerminalErrorRunId: '', showToast: (...args) => toasts.push(args),
      dashboardSyncMetadataFetchedAt: 1, liveSyncMode: 'idle',
    });
    vm.runInContext(`${source}\nthis.applyStatus = applyManualSyncStatus;`, context);
    const first = { key: 'drive', outcome: 'processed', processedFiles: 1, sourceFileName: 'a.xlsx' };
    const second = { ...first, sourceFileName: 'b.xlsx' };
    context.applyStatus({ ...initial, stageResults: [first] });
    context.applyStatus({ ...initial, stageResults: [first] });
    context.applyStatus({ ...initial, stageResults: [first, second] });
    context.applyStatus({ ...initial, active: false, stageIndex: 5, currentStage: 'idle', stageResults: [first, second] }, { suppressToast: true });
    assert.equal(toasts.length, username === 'dylan_collyge' ? 2 : 0);
    if (toasts.length) assert.notEqual(toasts[0][3].fingerprint, toasts[1][3].fingerprint);
    assert.equal(diagnostics.at(-1), 'idle');
    assert.equal(context.manualSyncStatusState.active, false);
  }
});
