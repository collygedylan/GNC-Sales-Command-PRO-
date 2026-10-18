// @test-group: @home-role
import assert from 'node:assert/strict';
import test from 'node:test';
import { durationOutsideIntervals, getLoafTimingIntervals } from './helpers/av-hydration-timing.mjs';

test('background long-task time subtracts only measured UI and natural layout intervals once', () => {
  const task = [0, 200];
  const intervals = [[0, 10], [20, 100], [80, 140]];
  assert.equal(durationOutsideIntervals(...task, intervals), 70);
});

test('LoAF layout accounting ends at the frame boundary, not delayed presentation', () => {
  const timing = getLoafTimingIntervals({
    startTime: 100,
    duration: 200,
    renderStart: 130,
    styleAndLayoutStart: 220,
    presentationTime: 450
  });
  assert.deepEqual(timing, { renderCycle: [130, 300], styleAndLayout: [220, 300] });
  assert.equal(durationOutsideIntervals(100, 300, [[20, 50], timing.styleAndLayout]), 120);
});

test('LoAF intervals omit unavailable or out-of-frame timestamps', () => {
  assert.deepEqual(getLoafTimingIntervals({ startTime: 10, duration: 80, renderStart: 0, styleAndLayoutStart: 95 }), {
    renderCycle: null,
    styleAndLayout: null
  });
  assert.equal(durationOutsideIntervals(10, 10, [[0, 5]]), 0);
});
