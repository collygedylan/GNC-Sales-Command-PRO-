import vm from 'node:vm';

export function deadlineRenderContext(tokens, frames, hooks) {
  return vm.createContext({
      chunkRenderTokensByKey: tokens,
      chunkRenderActivityByKey: {},
      productionLiveSyncRendering: false,
      productionLiveSyncActiveRender: null,
      normalizeRenderSignature: value => String(value || ''),
      buildRowsRenderSignature: () => 'render-test',
      CHUNK_RENDER_INTERACTION_HOLD_MAX_MS: 260,
      IOS_CHUNK_SYNC_ROW_LIMIT: 24,
      window: { matchMedia: () => ({ matches: true }) },
      document: { documentElement: { clientHeight: 640 } },
      performance: { now: () => 1 },
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
      scheduleChunkRenderTimeout: (_key, callback, delay) => { if (delay === 250) hooks.deadline = callback; return 1; },
      cancelChunkRenderWorkForContainer() {},
      bumpChunkRenderTokenByKey: key => (tokens[key] = (tokens[key] || 0) + 1),
      getContainerChunkRenderKey: target => target.dataset.activeChunkRenderKey || '',
      setContainerChunkRenderState: (target, key, token) => { target.dataset.activeChunkRenderKey = key; target.dataset.activeChunkRenderToken = String(token); },
      clearContainerChunkRenderState: (target, key, token) => {
        if (target.dataset.activeChunkRenderKey === key && target.dataset.activeChunkRenderToken === String(token)) {
          delete target.dataset.activeChunkRenderKey; delete target.dataset.activeChunkRenderToken;
        }
      },
      isChunkRenderCurrentForContainer: (target, key, token) => Number(tokens[key]) === token
        && (!target.dataset.activeChunkRenderToken || Number(target.dataset.activeChunkRenderToken) === token),
      beginInternalPerfMeasure: () => 1, getAdaptivePerfElapsedMs: () => 1,
      isAdaptivePerformanceMode: () => false, getAdaptivePerformanceLevel: () => 0,
      isIOSDevice: () => false, isStandaloneApp: () => false,
      getChunkRenderPacing: count => ({ batchTarget: Math.min(count, Math.max(8, Math.ceil(count / 3))), timeBudget: 2, frameDelayMs: 0 }),
      shouldHoldFollowupChunkFramesForInteraction: () => false,
      isUserInLiveTouchScrollGesture: () => true,
      beginChunkRenderActivity() {}, endChunkRenderActivity() {},
      setContainerHtml() {}, appendHtmlFragment() {}, setContainerUiState() {},
      getContainerRenderSignature: target => target.dataset.renderSignature || '',
      setContainerRenderSignature: (target, signature) => { target.dataset.renderSignature = signature; },
      incrementInternalPerfCounter() {}, recordGncPerfStat() {}, recordInternalPerfDuration() {},
      reportSemanticHealthEvent() {}
    });
}

