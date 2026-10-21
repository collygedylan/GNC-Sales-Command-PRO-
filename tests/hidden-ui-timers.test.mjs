import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `${name} exists`);
  const open = html.indexOf(') {', start) + 2;
  let depth = 0;
  for (let index = open; index < html.length; index++) {
    if (html[index] === '{') depth++;
    else if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`${name} is not closed`);
}

function timerHarness(hidden = false) {
  const intervals = new Map(), timeouts = new Map(), listeners = new Map(), progressWrites = [];
  let nextId = 1;
  const element = () => ({ classList: { add() {}, remove() {} }, style: {}, innerText: '' });
  const nodes = new Map(['login-progress-wrap', 'login-progress-bar', 'login-progress-label'].map(id => [id, element()]));
  const document = { hidden, getElementById: id => nodes.get(id) || null,
    addEventListener: (name, callback) => listeners.set(name, callback) };
  const context = vm.createContext({ document, Math, Date,
    setInterval: (callback, delay) => { const id = nextId++; intervals.set(id, { callback, delay }); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (callback, delay) => { const id = nextId++; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout: id => timeouts.delete(id),
    updateChatVoiceRecordingUi: () => progressWrites.push('chat'),
    updateGrowerScoutRecordingUi: () => progressWrites.push('grower'),
    detailMeasurementKeyboardTarget: {}, isDetailMeasurementKeyboardVisible: () => true,
    pressDetailMeasurementKeyboardKey: () => progressWrites.push('keyboard'),
  });
  return { context, document, intervals, timeouts, listeners, progressWrites, nodes };
}

test('login progress animation pauses in hidden state and restarts once on return', () => {
  assert.match(html, /document\.addEventListener\('visibilitychange', syncGlobalProgressTimerVisibility/);
  const h = timerHarness(true);
  Object.assign(h.context, { activeFetches: 0, fetchProgressInterval: null, currentProgress: 8,
    initialAppLoadActive: true, initialAppLoadComplete: false, initialAppLoadLabel: 'Signing in...' });
  vm.runInContext([extractFunction('setLoginProgress'), extractFunction('clearGlobalProgressTimer'),
    extractFunction('startGlobalProgressTimer'), extractFunction('syncGlobalProgressTimerVisibility'),
    extractFunction('startGlobalProgress')].join('\n'), h.context);
  h.context.startGlobalProgress();
  assert.equal(h.intervals.size, 0, 'hidden startup must not create an animation interval');
  h.document.hidden = false;
  h.context.syncGlobalProgressTimerVisibility();
  assert.equal(h.intervals.size, 1);
  const [id, timer] = [...h.intervals.entries()][0];
  assert.equal(timer.delay, 1000);
  h.document.hidden = true;
  h.context.syncGlobalProgressTimerVisibility();
  assert.equal(h.intervals.size, 0);
  timer.callback();
  assert.equal(h.progressWrites.length, 0, 'a delayed hidden callback cannot repaint login progress');
  h.document.hidden = false;
  h.context.syncGlobalProgressTimerVisibility();
  assert.equal(h.intervals.size, 1);
  assert.notEqual([...h.intervals.keys()][0], id);
});

test('chat and Grower Scout recordings retain capture while their UI timers pause when hidden', () => {
  assert.match(html, /document\.addEventListener\('visibilitychange', syncChatVoiceRecordTimerVisibility/);
  assert.match(html, /document\.addEventListener\('visibilitychange', syncGrowerScoutRecordingTimerVisibility/);
  for (const [activeKey, timerKey, clearFn, syncFn, label] of [
    ['chatVoiceRecordingActive', 'chatVoiceRecordTimer', 'clearChatVoiceRecordTimer', 'syncChatVoiceRecordTimerVisibility', 'chat'],
    ['growerScoutRecordingActive', 'growerScoutRecordingTimer', 'clearGrowerScoutRecordingTimer', 'syncGrowerScoutRecordingTimerVisibility', 'grower'],
  ]) {
    const h = timerHarness(false);
    Object.assign(h.context, { [activeKey]: true, [timerKey]: null });
    vm.runInContext([extractFunction(clearFn), extractFunction(syncFn)].join('\n'), h.context);
    h.context[syncFn]();
    assert.equal(h.intervals.size, 1);
    assert.equal([...h.intervals.values()][0].delay, 1000);
    h.document.hidden = true;
    h.context[syncFn]();
    assert.equal(h.intervals.size, 0);
    assert.equal(h.context[activeKey], true, 'hiding pauses display work without stopping audio capture');
    h.document.hidden = false;
    h.context[syncFn]();
    assert.equal(h.intervals.size, 1);
    assert.ok(h.progressWrites.includes(label), 'visible resume refreshes the elapsed display');
  }
});

test('measurement keyboard repeat refuses hidden starts and cancels a repeat when hidden', () => {
  assert.match(html, /document\.addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.hidden\) suspendDetailMeasurementKeyboardForLifecycle/);
  const h = timerHarness(false);
  Object.assign(h.context, { detailMeasurementKeyboardRepeatTimer: null, detailMeasurementKeyboardRepeatInterval: null });
  vm.runInContext([extractFunction('clearDetailMeasurementKeyboardRepeat'), extractFunction('startDetailMeasurementKeyboardRepeat')].join('\n'), h.context);
  h.context.startDetailMeasurementKeyboardRepeat('__backspace', 'key');
  const delay = [...h.timeouts.values()][0];
  assert.equal(delay.delay, 330);
  delay.callback();
  const repeat = [...h.intervals.values()][0];
  assert.equal(repeat.delay, 58);
  h.document.hidden = true;
  repeat.callback();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.progressWrites.length, 0);
  const timeoutCountBeforeHiddenStart = h.timeouts.size;
  h.context.startDetailMeasurementKeyboardRepeat('__backspace', 'key');
  assert.equal(h.timeouts.size, timeoutCountBeforeHiddenStart, 'no new backspace repeat starts while hidden');
});
