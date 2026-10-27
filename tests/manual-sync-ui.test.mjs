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
