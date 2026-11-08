// @test-group: @ui-shell,@release-validation
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChunkRenderPacing, shouldAuditRetainedChunkPage } from '../src/ui/chunk-render-pacing.js';

test('bounded workflow pages publish their complete declared batch during interaction', () => {
  const pacing = resolveChunkRenderPacing(37, 3.5, { minBatch: 4 },
    { liveGestureActive: true, touchConstrained: true });
  assert.deepEqual(pacing, { liveGestureActive: true, interactionSlowMode: true,
    batchTarget: 37, timeBudget: 3.5, frameDelayMs: 0 });
});

test('large pages retain touch pacing and bounded follow-up delays', () => {
  const pacing = resolveChunkRenderPacing(120, 4, { minBatch: 8 },
    { liveGestureActive: true, touchConstrained: true });
  assert.equal(pacing.batchTarget, 40);
  assert.equal(pacing.timeBudget, 2.1);
  assert.equal(pacing.frameDelayMs, 60);
});

test('fresh bounded pages skip the retained-DOM audit while retained pages keep it', () => {
  assert.equal(shouldAuditRetainedChunkPage(false), false);
  assert.equal(shouldAuditRetainedChunkPage(true), true);
});
