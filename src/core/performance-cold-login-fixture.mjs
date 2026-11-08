import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import { buildPerformanceColdStartupReadyExpression, isPerformanceColdStartupReady, waitForPerformanceColdStartupReady } from '../../scripts/performance-browser-fixture.mjs';

export async function verifyColdLoginGate() {
  const source = readComposedAppSource();
  const initializerStart = source.indexOf('        async function initializeAppSessionOnLoad()');
  const initializerEnd = source.indexOf('\n        let appChromeStartupStarted', initializerStart);
  const bindingStart = source.indexOf('        if (document.readyState === \'complete\') {', initializerEnd);
  const bindingEnd = source.indexOf('\n// Login entry is independent', bindingStart);
  assert.ok(initializerStart >= 0 && initializerEnd > initializerStart);
  assert.ok(bindingStart > initializerEnd && bindingEnd > bindingStart);
  const runtimeSource = `${source.slice(initializerStart, initializerEnd)}\n${source.slice(bindingStart, bindingEnd)}`;


  for (const startupPath of ['direct-complete-document', 'load-event']) await verifyStartupPath(startupPath, runtimeSource);
}

async function verifyStartupPath(startupPath, runtimeSource) {
    const listeners = new Map(), attempts = [{ kind: 'restore', outcome: 'active' }];
    let finishRestore, primed = false;
    const browserWindow = { addEventListener(type, callback) { const group = listeners.get(type) || []; group.push(callback); listeners.set(type, group); } };
    const runtime = vm.createContext({
      document: { readyState: startupPath === 'direct-complete-document' ? 'complete' : 'interactive', getElementById: () => null },
      window: browserWindow,
      appSessionStartupStarted: false, nativeAuthRecoveryEpoch: 0, setTimeout, clearTimeout,
      isPublicPhotoShareRoute: () => false, isAuthenticatedAppShellVisible: () => false,
      withAgDataBootDeadline: task => task(), finishAppSessionBootFallback: () => { primed = true; },
      ensureCurrentShellBuild: async () => false,
      resetLoginUiState() {},
      restoreNativeAuthSessionOnStartup: () => new Promise(resolve => { finishRestore = () => { attempts[0].outcome = 'failed'; resolve(false); }; }),
      primeSavedLoginUiOnStartup() { primed = true; },
      initializeAppChromeOnDomReady() {},
      startReclassDeliveryPolling() {},
    });
    browserWindow.__gncRuntimeBootTiming = { state: 'ready' };
    browserWindow.GncLoginTrace = { snapshot: () => ({ attempts }) };
    browserWindow.window = browserWindow;
    browserWindow.document = runtime.document;
    browserWindow.eval = expression => vm.runInContext(expression, runtime);
    vm.runInContext(runtimeSource, runtime);
    const browserReady = () => vm.runInContext(buildPerformanceColdStartupReadyExpression(), runtime);
    if (startupPath === 'load-event') {
      assert.equal(runtime.appSessionStartupStarted, false, 'the real startup binding waits for window.load');
      assert.equal(browserReady(), false,
        'the generated browser expression rejects an incomplete load-event boot');
      runtime.document.readyState = 'complete';
      for (const callback of listeners.get('load') || []) callback();
    }
    assert.equal(runtime.appSessionStartupStarted, true, `${startupPath} starts the real initializer`);
    await Promise.resolve();
    assert.equal(browserReady(), false,
      'the generated browser expression rejects a restore that is still active');
    attempts.length = 0;
    assert.equal(browserReady(), false, 'the generated browser expression rejects a missing restore trace');
    attempts.push({ kind: 'restore', outcome: 'active' });
    const readyState = () => isPerformanceColdStartupReady({ documentReadyState: 'complete', runtimeBootState: 'ready',
      appSessionStartupStarted: runtime.appSessionStartupStarted, loginAttempts: attempts });
    assert.equal(readyState(), false, 'the unresolved startup profile/session read must block cold login');
    let gateResolved = false;
    const wait = waitForPerformanceColdStartupReady(coldGateWaiter(readyState)).then(() => { gateResolved = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(gateResolved, false, 'the beforeLogin gate remains blocked while restore has no result');
    finishRestore();
    await wait;
    await Promise.resolve();
    assert.equal(primed, true, 'the startup initializer completes its no-session branch before login');
    assert.equal(readyState(), true);
    assert.equal(browserReady(), true,
      'the generated browser expression accepts the completed no-session restore');
    attempts[0].outcome = 'shell-ready';
    assert.equal(browserReady(), false, 'the generated browser expression rejects a successful restore in this cold fixture');
    attempts[0].outcome = 'failed';
    assert.equal(browserReady(), true, 'the generated expression remains valid only for the expected no-session outcome');
}

function coldGateWaiter(readyState) {
  return { waitForFunction: (_predicate, _expression, options) => pollColdGate(readyState, options) };
}

async function pollColdGate(readyState, options) {
  const deadline = Date.now() + options.timeout;
  while (Date.now() < deadline) {
    if (readyState()) return { dispose() {} };
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('fixture startup gate timed out');
}
