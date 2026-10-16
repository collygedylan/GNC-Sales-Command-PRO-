import assert from 'node:assert/strict';
import test from 'node:test';
import { devices } from '@playwright/test';
import { reclassModalPaintLimitMs, scheduleReclassPaintProbeCheck } from './helpers/reclass-paint-probe.mjs';

test('Reclass modal timing follows the shared frontend simulator policy', () => {
  assert.equal(reclassModalPaintLimitMs({ use: devices['iPhone 13'] }), 400);
  for (const name of ['Desktop Chrome', 'Desktop Safari', 'Pixel 7']) {
    assert.equal(reclassModalPaintLimitMs({ use: devices[name] }), 400);
  }
});

test('paint probe coalesces mutation frames and keeps the first qualifying paint time', () => {
  const frames = [];
  let completions = 0;
  const probe = { result: null, rafScheduled: false, finishAfterPaint() {
    completions++;
    this.result = { elapsedMs: 42, phase: 'open' };
  } };
  const requestFrame = callback => frames.push(callback);

  assert.equal(scheduleReclassPaintProbeCheck(probe, requestFrame), true);
  assert.equal(scheduleReclassPaintProbeCheck(probe, requestFrame), false, 'mutations coalesce while two paint frames are pending');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(frames.length, 1, 'the second animation frame gates the paint measurement');
  assert.equal(scheduleReclassPaintProbeCheck(probe, requestFrame), false, 'the pending paint chain is still coalesced');
  frames.shift()();
  assert.equal(completions, 1);
  assert.deepEqual(probe.result, { elapsedMs: 42, phase: 'open' });

  assert.equal(scheduleReclassPaintProbeCheck(probe, requestFrame), false, 'later DOM changes cannot replace the first paint result');
  assert.equal(frames.length, 0);
  assert.equal(completions, 1);
});

test('a completed paint result is not overwritten by an already queued callback', () => {
  const frames = [];
  let completions = 0;
  const probe = { result: null, rafScheduled: false, finishAfterPaint() { completions++; this.result = { elapsedMs: 99 }; } };
  assert.equal(scheduleReclassPaintProbeCheck(probe, callback => frames.push(callback)), true);
  frames.shift()();
  probe.result = { elapsedMs: 51, phase: 'optimistic' };
  frames.shift()();
  assert.deepEqual(probe.result, { elapsedMs: 51, phase: 'optimistic' });
  assert.equal(completions, 0);
});
