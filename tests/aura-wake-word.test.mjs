// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeWordController } from '../services/auraWakeWord.js';
function fixture({ supported = true } = {}) {
  const engines = [], timers = [], wakes = [], states = [];
  let authorized = true, visible = true;
  class Recognition {
    constructor() { engines.push(this); }
    start() { this.started = true; this.onstart?.(); }
    abort() { this.aborted = true; }
  }
  const controller = createWakeWordController({ getRecognition: () => supported ? Recognition : null, isAuthorized: () => authorized, isVisible: () => visible,
    onWake: text => wakes.push(text), onState: state => states.push(state),
    schedule: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, cancel: timer => { timer.cancelled = true; } });
  return { controller, engines, timers, wakes, states, setAuthorized: value => { authorized = value; }, setVisible: value => { visible = value; } };
}
test('wake-word listener is inert until explicit opt-in and recognizes all supported variants once', async () => {
  for (const phrase of ['hey aura', 'hey, aura', 'hey ora']) {
    const f = fixture(); assert.equal(f.engines.length, 0); f.controller.startFromGesture();
    const engine = f.engines[0]; assert.equal(engine.continuous, true); assert.equal(engine.interimResults, true);
    engine.onresult({ resultIndex: 0, results: [[{ transcript: phrase + ', how many Baby Gem?' }]] });
    await Promise.resolve(); assert.deepEqual(f.wakes, ['how many Baby Gem?']); assert.equal(engine.aborted, true); assert.equal(engine.onresult, null);
    f.controller.destroy();
  }
});
test('permission denial disables standby; unsupported browsers never start recognition', () => {
  const f = fixture(); f.controller.startFromGesture(); f.engines[0].onerror({ error: 'not-allowed' });
  assert.equal(f.controller.enabled, false); assert.equal(f.states.at(-1).state, 'permission-denied'); assert.equal(f.timers.length, 0); f.controller.destroy();
  const unsupported = fixture({ supported: false }); assert.equal(unsupported.controller.startFromGesture(), false); assert.equal(unsupported.engines.length, 0); unsupported.controller.destroy();
});
test('unexpected end restarts with backoff, suspension and owner changes stop microphone acquisition', () => {
  const f = fixture(); f.controller.startFromGesture(); f.engines[0].onend();
  assert.equal(f.timers[0].delay, 700); f.timers[0].callback(); assert.equal(f.engines.length, 2);
  f.controller.setSuspended(true); assert.equal(f.engines[1].aborted, true); f.controller.setSuspended(false); assert.equal(f.engines.length, 3);
  f.engines[2].onend(); f.setAuthorized(false);
  f.controller.destroy(); assert.equal(f.controller.enabled, false); assert.equal(f.timers.at(-1).cancelled, true);
  f.timers.at(-1).callback(); assert.equal(f.engines.length, 3);
});
test('hidden or unauthorized sessions cannot activate standby', () => {
  const f = fixture(); f.setVisible(false); assert.equal(f.controller.startFromGesture(), false);
  f.setVisible(true); f.setAuthorized(false); assert.equal(f.controller.startFromGesture(), false); assert.equal(f.engines.length, 0); f.controller.destroy();
});
