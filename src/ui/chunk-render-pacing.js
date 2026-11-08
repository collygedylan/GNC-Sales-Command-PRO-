export function resolveChunkRenderPacing(targetCount = 0, frameBudgetMs = 0, options = {}, state = {}) {
  const safeTargetCount = Math.max(1, Number(targetCount) || 1);
  const safeFrameBudget = Math.max(1, Number(frameBudgetMs) || 1);
  const minBatch = Math.max(1, Number(options.minBatch) || 6);
  const liveGestureActive = state.liveGestureActive === true;
  const interactionSlowMode = liveGestureActive || state.interactionSlowMode === true;
  const touchConstrained = state.touchConstrained === true;
  const iosConstrained = state.iosConstrained === true;
  if (safeTargetCount <= 40) {
    return { liveGestureActive, interactionSlowMode, batchTarget: safeTargetCount,
      timeBudget: safeFrameBudget, frameDelayMs: 0 };
  }
  if (liveGestureActive) {
    return {
      liveGestureActive: true,
      interactionSlowMode: true,
      batchTarget: Math.min(safeTargetCount,
        Math.max(minBatch, Math.ceil(safeTargetCount / (iosConstrained ? 4 : (touchConstrained ? 3 : 2))))),
      timeBudget: Math.max(1, Math.min(safeFrameBudget, iosConstrained ? 1.25 : (touchConstrained ? 2.1 : 3.2))),
      frameDelayMs: iosConstrained ? Math.max(0, Number(state.iosScrollDelay) || 0) : (touchConstrained ? 60 : 24)
    };
  }
  if (interactionSlowMode) {
    return {
      liveGestureActive: false,
      interactionSlowMode: true,
      batchTarget: Math.min(safeTargetCount,
        Math.max(minBatch, Math.ceil(safeTargetCount / (iosConstrained ? 3 : (touchConstrained ? 2.25 : 1.75))))),
      timeBudget: Math.max(1, Math.min(safeFrameBudget, iosConstrained ? 1.5 : (touchConstrained ? 2.6 : 3.8))),
      frameDelayMs: iosConstrained ? 24 : (touchConstrained ? 12 : 0)
    };
  }
  return { liveGestureActive: false, interactionSlowMode: false,
    batchTarget: safeTargetCount, timeBudget: safeFrameBudget, frameDelayMs: 0 };
}

export function shouldAuditRetainedChunkPage(hasRetainedCards = false) {
  return hasRetainedCards === true;
}
