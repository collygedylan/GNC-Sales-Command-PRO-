import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';

const source = readComposedAppSource();

function extract(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0, `missing source: ${startText}`);
  assert.ok(end > start, `missing source after ${startText}: ${endText}`);
  return source.slice(start, end);
}

function pushContext() {
  const calls = { help: 0, warning: 0, subscribe: 0 };
  const context = vm.createContext({
    window: {},
    document: { hidden: false },
    Notification: { permission: 'denied' },
    currentUser: 'dylan_collyge',
    cellularPushEnrollmentTimer: null,
    pushBlockedNoticeShown: false,
    androidPushForceRefreshedThisSession: false,
    isPushSupported: () => true,
    getPushPromptUserScope: () => 'dylan_collyge:profile',
    isCellularPushDevice: () => false,
    hasCompletedMobilePushRefresh: () => true,
    maybeWarnPushPermissionBlocked: () => { calls.warning += 1; },
    showPushPermissionHelp: () => { calls.help += 1; },
    subscribeCurrentDeviceForPush: async () => { calls.subscribe += 1; return false; },
    showToast() {},
    setTimeout(callback) { Promise.resolve().then(callback); return 1; },
    clearTimeout() {},
    calls,
  });
  vm.runInContext(
    extract('async function manuallyEnablePushNotifications()', 'function scheduleCellularPushEnrollment(')
      + extract('function scheduleCellularPushEnrollment(', 'function installPushEnrollmentListeners('),
    context,
  );
  return context;
}

test('startup push enrollment never opens blocked-permission help, while explicit Menu action does', async () => {
  const context = pushContext();
  context.scheduleCellularPushEnrollment('login', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.calls.warning, 1);
  assert.equal(context.calls.help, 0);

  await context.manuallyEnablePushNotifications();
  assert.equal(context.calls.help, 1);
});
