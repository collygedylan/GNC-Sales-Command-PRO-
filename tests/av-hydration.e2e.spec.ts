import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';

// @test-group: @home-role

// Keep profiler, trace, and screenshot work out of acceptance measurements.
// Set AV_CPU_PROFILE=1 only when collecting a diagnostic CPU profile.
test.use({ trace: 'off', screenshot: 'off' });

const SYNTHETIC_MASTER_ROWS = 12000;
const PREVIEW_PAGE_SIZE = 500;
const PREVIEW_DISPLAY_ROW_LIMIT = 50;

type CpuProfileNode = {
  id: number;
  children?: number[];
  callFrame?: { functionName?: string; url?: string; lineNumber?: number };
};

function summarizeCpuProfile(value: unknown) {
  if (!value || typeof value !== 'object') return { sampleCount: 0, sampledMs: 0, topFrames: [] };
  const profile = value as { nodes?: unknown; samples?: unknown; timeDeltas?: unknown };
  const nodes = Array.isArray(profile.nodes) ? profile.nodes as CpuProfileNode[] : [];
  const samples = Array.isArray(profile.samples) ? profile.samples.map(Number) : [];
  const timeDeltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas.map(Number) : [];
  const nodeById = new Map(nodes.map(node => [Number(node.id), node]));
  const selfTimeById = new Map<number, number>();
  samples.forEach((id, index) => selfTimeById.set(id, (selfTimeById.get(id) || 0) + (timeDeltas[index] || 0)));
  const topFrames = Array.from(selfTimeById, ([id, micros]) => {
    const frame = nodeById.get(id)?.callFrame || {};
    return { functionName: String(frame.functionName || '(anonymous)'), url: String(frame.url || ''),
      lineNumber: Number(frame.lineNumber) || 0, selfTimeMs: micros / 1000 };
  }).sort((a, b) => b.selfTimeMs - a.selfTimeMs).slice(0, 30);
  return { sampleCount: samples.length, sampledMs: timeDeltas.reduce((sum, value) => sum + value, 0) / 1000, topFrames };
}

function summarizeCpuProfileForLongTasks(value: unknown, pageTimeAtProfileEndMs: number, longTasks: Array<{ startTime: number; endTime: number }>) {
  if (!value || typeof value !== 'object' || !Number.isFinite(pageTimeAtProfileEndMs)) return [];
  const profile = value as { nodes?: unknown; samples?: unknown; timeDeltas?: unknown; startTime?: unknown; endTime?: unknown };
  const nodes = Array.isArray(profile.nodes) ? profile.nodes as CpuProfileNode[] : [];
  const samples = Array.isArray(profile.samples) ? profile.samples.map(Number) : [];
  const timeDeltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas.map(Number) : [];
  const nodeById = new Map(nodes.map(node => [Number(node.id), node]));
  const parentById = new Map<number, number>();
  nodes.forEach(node => (node.children || []).forEach(child => parentById.set(Number(child), Number(node.id))));
  const profileEndMs = Number(profile.endTime) / 1000;
  const profileStartMs = Number(profile.startTime) / 1000;
  if (!Number.isFinite(profileEndMs) || !Number.isFinite(profileStartMs)) return [];
  const pageOffsetMs = pageTimeAtProfileEndMs - profileEndMs;
  const samplesByTask = longTasks.map(task => ({
    task,
    selfFrames: new Map<string, number>(),
    stacks: new Map<string, number>(),
    sampledCpuMs: 0
  }));
  let sampleStartMs = profileStartMs + pageOffsetMs;
  for (let index = 0; index < Math.min(samples.length, timeDeltas.length); index++) {
    const durationMs = Math.max(0, timeDeltas[index] / 1000);
    const sampleEndMs = sampleStartMs + durationMs;
    const sampledNodeId = samples[index];
    const sampledNode = nodeById.get(sampledNodeId);
    const frame = sampledNode?.callFrame || {};
    const frameName = String(frame.functionName || '(anonymous)');
    const frameUrl = String(frame.url || '');
    const frameLabel = `${frameName} [${frameUrl}]`;
    const stackLabels: string[] = [];
    let cursor: number | undefined = sampledNodeId;
    const seen = new Set<number>();
    while (cursor !== undefined && !seen.has(cursor) && stackLabels.length < 32) {
      seen.add(cursor);
      const stackFrame = nodeById.get(cursor)?.callFrame || {};
      stackLabels.push(`${String(stackFrame.functionName || '(anonymous)')} [${String(stackFrame.url || '')}]`);
      cursor = parentById.get(cursor);
    }
    const stackLabel = stackLabels.reverse().join(' <- ');
    for (const target of samplesByTask) {
      const overlapMs = Math.max(0, Math.min(sampleEndMs, target.task.endTime) - Math.max(sampleStartMs, target.task.startTime));
      if (!overlapMs) continue;
      target.sampledCpuMs += overlapMs;
      target.selfFrames.set(frameLabel, (target.selfFrames.get(frameLabel) || 0) + overlapMs);
      target.stacks.set(stackLabel, (target.stacks.get(stackLabel) || 0) + overlapMs);
    }
    sampleStartMs = sampleEndMs;
  }
  return samplesByTask.map(({ task, selfFrames, stacks, sampledCpuMs }) => ({
    ...task,
    sampledCpuMs,
    topSelfFrames: Array.from(selfFrames, ([frame, selfTimeMs]) => ({ frame, selfTimeMs }))
      .sort((a, b) => b.selfTimeMs - a.selfTimeMs).slice(0, 12),
    topCallStacks: Array.from(stacks, ([stack, selfTimeMs]) => ({ stack, selfTimeMs }))
      .sort((a, b) => b.selfTimeMs - a.selfTimeMs).slice(0, 8)
  }));
}

function syntheticMasterRows() {
  return Array.from({ length: SYNTHETIC_MASTER_ROWS }, (_, index) => hlMaster(`av-hydration-${String(index + 1).padStart(5, '0')}`, {
    itemcode: `AVH.${String(index + 1).padStart(5, '0')}`,
    commonname: `Synthetic AV Plant ${String(index + 1).padStart(5, '0')}`,
    contsize: '#1', locationcode: `A.${String(index + 1).padStart(5, '0')}`,
    lotcode: '27.F1', season: 'F1', saleyear: '27', ptravailable: '90', ptronhand: '90'
  }));
}

async function installAvTimingProbe(page: Page) {
  const installed = await page.evaluate(() => window.eval(`(() => {
    const probe = window.__avHydrationTiming = { startedAt: 0, startedEpochMs: 0, firstCardAt: 0, firstCardEpochMs: 0, renderDurations: [], chunkCallbackDurations: [], chunkCallbackWindows: [], renderStages: [], renderSubOperations: [], activeRenderId: 0, renderIdCounter: 0, processSubOperations: [], activeProcessId: 0, processIdCounter: 0, processLoads: [], liveRenderSchedules: [], longTaskDurations: [], longTasks: [], slowSyncOperations: [], slowAsyncOperations: [],
      searchStartedAt: 0, searchResultAt: 0, observer: null, searchObserver: null, longTaskObserver: null };
    const SLOW_OPERATION_THRESHOLD_MS = 10;
    const MAX_SLOW_OPERATION_RECORDS = 100;
    const recordSlowOperation = (collection, name, startedAt, extra = {}) => {
      const endedAt = performance.now();
      const durationMs = endedAt - startedAt;
      if (!probe.startedAt || durationMs < SLOW_OPERATION_THRESHOLD_MS || probe[collection].length >= MAX_SLOW_OPERATION_RECORDS) return;
      probe[collection].push({ name, startedAt, endedAt, durationMs, ...extra });
    };
    const measureSynchronousOperation = (name, original, getDetails = () => ({})) => function(...args) {
      if (!probe.startedAt) return original.apply(this, args);
      const startedAt = performance.now();
      try { return original.apply(this, args); }
      finally { recordSlowOperation('slowSyncOperations', name, startedAt, getDetails(args, this)); }
    };
    const stageSnapshot = () => {
      const container = document.getElementById('av-content');
      const safeCall = fn => { try { return typeof fn === 'function' ? !!fn() : null; } catch { return null; } };
      const currentView = typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '';
      const ui = currentView && VIEW_LOAD_UI?.[currentView];
      const viewContainer = ui?.container ? document.getElementById(ui.container) : null;
      return { at: performance.now(), view: typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '',
        containerState: typeof getContainerUiState === 'function' ? getContainerUiState(container) : '',
        containerChildren: container?.children?.length || 0, firstCardPresent: !!container?.querySelector('[data-dom-id]'),
        viewContainerState: typeof getContainerUiState === 'function' ? getContainerUiState(viewContainer) : '',
        waitingForContent: !!viewContainer && getContainerUiState(viewContainer) === 'loading',
        activeElementId: document.activeElement?.id || '', hidden: document.hidden,
        draft: safeCall(typeof hasProductionLiveSyncDraft === 'function' ? hasProductionLiveSyncDraft : null),
        typing: safeCall(typeof isUserActivelyTyping === 'function' ? isUserActivelyTyping : null),
        touching: safeCall(typeof isUserActivelyTouching === 'function' ? isUserActivelyTouching : null),
        scrolling: safeCall(typeof isUserActivelyScrolling === 'function' ? isUserActivelyScrolling : null),
        recentViewSwitch: safeCall(typeof isRecentViewSwitchActivity === 'function' ? isRecentViewSwitchActivity : null),
        pendingFieldSave: safeCall(typeof hasPendingFieldSaveActivity === 'function' ? hasPendingFieldSaveActivity : null),
        chunkRenderActive: safeCall(typeof isChunkRenderActive === 'function' ? isChunkRenderActive : null),
        pendingPhotoUploads: Number(window.pendingPhotoUploads?.size) || 0,
        recentCamera: safeCall(typeof isRecentCameraActivity === 'function' ? isRecentCameraActivity : null),
        recentPhotoPersist: safeCall(typeof isRecentPhotoPersistActivity === 'function' ? isRecentPhotoPersistActivity : null),
        recentInteraction: safeCall(typeof isUserInRecentInteractionWindow === 'function' ? isUserInRecentInteractionWindow : null),
        extendedBlock: safeCall(typeof hasExtendedInteractionBlockers === 'function' ? () => hasExtendedInteractionBlockers({ ignoreChunkDuringInteraction: true }) : null) };
    };
    probe.longTaskObserver = new PerformanceObserver(entries => {
      if (!probe.startedAt) return;
      for (const entry of entries.getEntries()) {
        probe.longTaskDurations.push(entry.duration);
        probe.longTasks.push({ startTime: entry.startTime, durationMs: entry.duration, endTime: entry.startTime + entry.duration });
      }
    });
    probe.longTaskObserver.observe({ type: 'longtask', buffered: false });
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => originalRequestAnimationFrame(timestamp => {
      if (probe.startedAt && callback.name === 'renderNextChunk') {
        const started = performance.now();
        try { callback.call(window, timestamp); }
        finally {
          const ended = performance.now();
          probe.chunkCallbackDurations.push(ended - started);
          probe.chunkCallbackWindows.push({ startedAt: started, endedAt: ended });
        }
        return;
      }
      callback.call(window, timestamp);
    });
    const captureSearchResult = () => {
      if (!probe.searchStartedAt || probe.searchResultAt) return;
      const container = document.getElementById('av-content');
      const crumb = String(document.getElementById('av-crumb')?.textContent || '');
      const input = document.getElementById('av-search');
      const term = String(input?.value || '').trim();
      const match = Array.from(container?.querySelectorAll('[data-dom-id]') || []).find(card => card.textContent?.includes(term));
      const rect = match?.getBoundingClientRect();
      const inViewport = !!rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      if (term && crumb.includes('Search Results (1)') && match && inViewport) {
        probe.searchResultAt = performance.now();
        probe.searchObserver?.disconnect();
      }
    };
    const measureRenderOperation = (name, original) => function(...args) {
      const started = performance.now();
      try { return original.apply(this, args); }
      finally {
        const durationMs = performance.now() - started;
        if (probe.startedAt && probe.activeRenderId) probe.renderSubOperations.push({ renderId: probe.activeRenderId, name, durationMs });
        if (durationMs >= SLOW_OPERATION_THRESHOLD_MS) recordSlowOperation('slowSyncOperations', name, started);
      }
    };
    buildResolvedAVBaseState = measureRenderOperation('buildResolvedAVBaseState', buildResolvedAVBaseState);
    getAvRawTabItems = measureRenderOperation('getAvRawTabItems', getAvRawTabItems);
    buildAvSharedFilterState = measureRenderOperation('buildAvSharedFilterState', buildAvSharedFilterState);
    filterBySearch = measureRenderOperation('filterBySearch', filterBySearch);
    renderAvTopControls = measureRenderOperation('renderAvTopControls', renderAvTopControls);
    buildAvTopControlsSignature = measureRenderOperation('buildAvTopControlsSignature', buildAvTopControlsSignature);
    getAvColumnFilterFields = measureRenderOperation('getAvColumnFilterFields', getAvColumnFilterFields);
    sortAvOpenItems = measureRenderOperation('sortAvOpenItems', sortAvOpenItems);
    getAvSalesRowsForBucket = measureRenderOperation('getAvSalesRowsForBucket', getAvSalesRowsForBucket);
    buildAvMultiChoiceOptionsHtml = measureRenderOperation('buildAvMultiChoiceOptionsHtml', buildAvMultiChoiceOptionsHtml);
    buildRowsRenderSignature = measureRenderOperation('buildRowsRenderSignature', buildRowsRenderSignature);
    buildAVExportContext = measureRenderOperation('buildAVExportContext', buildAVExportContext);
    buildAVBrowsePageKey = measureRenderOperation('buildAVBrowsePageKey', buildAVBrowsePageKey);
    getClientBrowsePage = measureRenderOperation('getClientBrowsePage', getClientBrowsePage);
    renderAvPhotoOutreachPanel = measureRenderOperation('renderAvPhotoOutreachPanel', renderAvPhotoOutreachPanel);
    renderAVOpenCardsChunked = measureRenderOperation('renderAVOpenCardsChunked', renderAVOpenCardsChunked);
    buildAvSharedFilterOptionsState = measureRenderOperation('buildAvSharedFilterOptionsState', buildAvSharedFilterOptionsState);
    generateCard = measureRenderOperation('generateCard', generateCard);
    setContainerHtml = measureRenderOperation('setContainerHtml', setContainerHtml);
    captureProductionRefreshAnchor = measureSynchronousOperation('captureProductionRefreshAnchor', captureProductionRefreshAnchor);
    restoreProductionRefreshAnchor = measureSynchronousOperation('restoreProductionRefreshAnchor', restoreProductionRefreshAnchor);
    renderProductionDataFreshness = measureSynchronousOperation('renderProductionDataFreshness', renderProductionDataFreshness);
    const rowCountDetails = args => ({ rowCount: Array.isArray(args[0]) ? args[0].length : undefined });
    applyMasterAppTabAssignments = measureSynchronousOperation('applyMasterAppTabAssignments', applyMasterAppTabAssignments, rowCountDetails);
    formatFetchedRows = measureSynchronousOperation('formatFetchedRows', formatFetchedRows, args => ({ rowCount: Array.isArray(args[0]) ? args[0].length : undefined, source: String(args[1] || '') }));
    buildSearchIndex = measureSynchronousOperation('buildSearchIndex', buildSearchIndex);
    syncMasterFieldsToRow = measureSynchronousOperation('syncMasterFieldsToRow', syncMasterFieldsToRow);
    prepareProductionMasterSnapshot = (function(original) {
      return function(...args) {
        if (!probe.startedAt) return original.apply(this, args);
        const startedAt = performance.now();
        const rowCount = Array.isArray(args[0]) ? args[0].length : 0;
        const result = original.apply(this, args);
        return result.then(value => {
          recordSlowOperation('slowAsyncOperations', 'prepareProductionMasterSnapshot', startedAt, { rowCount, resultRows: Number(value?.rowCount) || 0 });
          return value;
        }, error => {
          recordSlowOperation('slowAsyncOperations', 'prepareProductionMasterSnapshot', startedAt, { rowCount, failed: true });
          throw error;
        });
      };
    })(prepareProductionMasterSnapshot);
    saveCacheValue = (function(original) {
      return function(...args) {
        if (!probe.startedAt) return original.apply(this, args);
        const startedAt = performance.now();
        const value = args[1];
        const rowCount = Array.isArray(value?.rawRows) ? value.rawRows.length
          : (Array.isArray(value?.data) ? value.data.length : 0);
        return original.apply(this, args).then(result => {
          recordSlowOperation('slowAsyncOperations', 'saveCacheValue', startedAt, { rowCount, succeeded: result === true });
          if (result === true && rowCount >= 12000) probe.completedLargeCacheKey = args[0];
          return result;
        }, error => {
          recordSlowOperation('slowAsyncOperations', 'saveCacheValue', startedAt, { rowCount, failed: true });
          throw error;
        });
      };
    })(saveCacheValue);
    const originalIdbPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (!probe.startedAt) return originalIdbPut.apply(this, args);
      const startedAt = performance.now();
      try { return originalIdbPut.apply(this, args); }
      finally {
        const value = args[0];
        const rowCount = Array.isArray(value?.rawRows) ? value.rawRows.length
          : (Array.isArray(value?.data) ? value.data.length : 0);
        recordSlowOperation('slowSyncOperations', 'IDBObjectStore.put', startedAt, { storeName: String(this.name || ''), rowCount });
      }
    };
    const measureProcessOperation = (name, original) => function(...args) {
      const started = performance.now();
      try { return original.apply(this, args); }
      finally {
        const durationMs = performance.now() - started;
        if (probe.startedAt && probe.activeProcessId) probe.processSubOperations.push({ processId: probe.activeProcessId, name, durationMs });
        if (durationMs >= SLOW_OPERATION_THRESHOLD_MS) recordSlowOperation('slowSyncOperations', name, started);
      }
    };
    rebuildMasterInventoryIndexes = measureProcessOperation('rebuildMasterInventoryIndexes', rebuildMasterInventoryIndexes);
    hydrateNcrCurrentCropRowsFromSources = measureProcessOperation('hydrateNcrCurrentCropRowsFromSources', hydrateNcrCurrentCropRowsFromSources);
    hydrateMovedSeasonCurrentRowsFromSources = measureProcessOperation('hydrateMovedSeasonCurrentRowsFromSources', hydrateMovedSeasonCurrentRowsFromSources);
    rebuildDetailLookupIndexes = measureProcessOperation('rebuildDetailLookupIndexes', rebuildDetailLookupIndexes);
    applyLocalEdits = measureProcessOperation('applyLocalEdits', applyLocalEdits);
    const originalProcessAndLoadData = processAndLoadData;
    processAndLoadData = function(res) {
      const processId = ++probe.processIdCounter;
      const previousProcessId = probe.activeProcessId;
      probe.activeProcessId = processId;
      const started = performance.now();
      const inputRows = Array.isArray(res?.data) ? res.data.length : 0;
      const verified = res?._verifiedLiveSync === true;
      const partial = res?._partial === true || res?._progressive === true;
      try { return originalProcessAndLoadData.apply(this, arguments); }
      finally {
        recordSlowOperation('slowSyncOperations', 'processAndLoadData', started, { rowCount: inputRows, verified, partial });
        probe.processLoads.push({ startedAt: started, endedAt: performance.now(), durationMs: performance.now() - started,
          processId, inputRows, verified, partial, stage: stageSnapshot() });
        probe.activeProcessId = previousProcessId;
      }
    };
    const originalScheduleTypingAwareUiRender = scheduleTypingAwareUiRender;
    scheduleTypingAwareUiRender = function(key, renderFn, delay, typingDelay, options) {
      if (String(key || '').startsWith('production-live-refresh')) {
        const scheduledAt = performance.now();
        const item = { key: String(key), scheduledAt, delayMs: Number(delay) || 0, typingDelayMs: Number(typingDelay) || 0,
          options: options || {}, scheduledState: stageSnapshot(), invokedAt: 0, invocationDelayMs: null, invokedState: null };
        probe.liveRenderSchedules.push(item);
        return originalScheduleTypingAwareUiRender.call(this, key, function() {
          item.invokedAt = performance.now();
          item.invocationDelayMs = item.invokedAt - scheduledAt;
          item.invokedState = stageSnapshot();
          return renderFn.apply(this, arguments);
        }, delay, typingDelay, options);
      }
      return originalScheduleTypingAwareUiRender.apply(this, arguments);
    };
    const originalScheduleProductionLiveSyncRender = scheduleProductionLiveSyncRender;
    scheduleProductionLiveSyncRender = function(immediate, options) {
      if (probe.startedAt) {
        const targetView = getCurrentVisibleViewId();
        const ui = VIEW_LOAD_UI[targetView];
        const waitingForContent = ui && getContainerUiState(document.getElementById(ui.container)) === 'loading';
        const contextKey = productionVerifiedViewKey();
        probe.liveRenderSchedules.push({ key: 'scheduleProductionLiveSyncRender', scheduledAt: performance.now(), targetView,
          immediate: immediate === true, options: options || {}, waitingForContent: !!waitingForContent,
          firstDisplay: !!waitingForContent && (options?.cachedPreview === true
            || (targetView === 'request' && productionLiveSyncVerifiedView === contextKey)),
          scheduledState: stageSnapshot(), invokedAt: 0, invocationDelayMs: null });
      }
      return originalScheduleProductionLiveSyncRender.apply(this, arguments);
    };
    const originalRender = renderAV;
    renderAV = function(...args) {
      const renderId = ++probe.renderIdCounter;
      const previousRenderId = probe.activeRenderId;
      probe.activeRenderId = renderId;
      const started = performance.now();
      const before = stageSnapshot();
      let result;
      try { result = originalRender.apply(this, args); }
      finally {
        const duration = performance.now() - started;
        const hasData = getCurrentVisibleViewId() === 'av'
          && (Number(fullInventory.length) > 0 || Number(avOpenInventory?.length) > 0);
        if (probe.startedAt && hasData) {
          probe.renderDurations.push(duration);
          probe.renderStages.push({ renderId, startedAt: started, durationMs: duration, before, after: stageSnapshot(), fullRows: fullInventory.length,
            avRows: Array.isArray(avOpenInventory) ? avOpenInventory.length : 0 });
        }
        probe.activeRenderId = previousRenderId;
      }
      captureSearchResult();
      return result;
    };
    const arm = () => {
      const tile = document.getElementById('home-tile-av');
      if (!tile) throw new Error('AV tile is unavailable');
      tile.addEventListener('pointerdown', () => {
        probe.startedAt = performance.now();
        probe.startedEpochMs = performance.timeOrigin + probe.startedAt;
        probe.firstCardAt = 0;
        probe.firstCardEpochMs = 0;
        probe.renderDurations = [];
        probe.chunkCallbackDurations = [];
        probe.chunkCallbackWindows = [];
        probe.renderStages = [];
        probe.renderSubOperations = [];
        probe.activeRenderId = 0;
        probe.renderIdCounter = 0;
        probe.processSubOperations = [];
        probe.activeProcessId = 0;
        probe.processIdCounter = 0;
        probe.processLoads = [];
        probe.liveRenderSchedules = [];
        probe.longTaskDurations = [];
        probe.longTasks = [];
        probe.slowSyncOperations = [];
        probe.slowAsyncOperations = [];
        probe.searchStartedAt = 0;
        probe.searchResultAt = 0;
        probe.searchObserver?.disconnect();
        probe.searchObserver = new MutationObserver(captureSearchResult);
        const avContainer = document.getElementById('av-content');
        const avCrumb = document.getElementById('av-crumb');
        if (avContainer) probe.searchObserver.observe(avContainer, { childList: true, subtree: true, attributes: true, characterData: true });
        if (avCrumb) probe.searchObserver.observe(avCrumb, { childList: true, subtree: true, characterData: true });
        probe.longTaskObserver?.disconnect();
        probe.longTaskObserver = new PerformanceObserver(entries => {
          for (const entry of entries.getEntries()) {
            probe.longTaskDurations.push(entry.duration);
            probe.longTasks.push({ startTime: entry.startTime, durationMs: entry.duration, endTime: entry.startTime + entry.duration });
          }
        });
        probe.longTaskObserver.observe({ type: 'longtask', buffered: false });
        const capture = () => {
          if (probe.firstCardAt) return true;
          const container = document.getElementById('av-content');
          const card = container?.querySelector('[data-dom-id]');
          if (!container || !card || card.getClientRects().length === 0) return false;
          const style = getComputedStyle(card);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          probe.firstCardAt = performance.now();
          probe.firstCardEpochMs = performance.timeOrigin + probe.firstCardAt;
          probe.observer?.disconnect();
          return true;
        };
        probe.observer?.disconnect();
        probe.observer = new MutationObserver(() => { if (!capture()) requestAnimationFrame(capture); });
        if (!avContainer) throw new Error('AV content container is unavailable');
        probe.observer.observe(avContainer, { childList: true, subtree: true, attributes: true });
        requestAnimationFrame(capture);
        probe.observer.observe(avContainer, { childList: true, subtree: true, characterData: true });
      }, { once: true, capture: true });
    };
    arm();
    window.__armAvHydrationTiming = arm;
    return true;
  })()`));
  expect(installed).toBe(true);
}

async function timingEvidence(page: Page) {
  return page.evaluate(() => window.eval(`(() => {
    const probe = window.__avHydrationTiming;
    const renderWindows = (probe?.renderStages || []).map(stage => [stage.startedAt, stage.startedAt + stage.durationMs]);
    const chunkWindows = (probe?.chunkCallbackWindows || []).map(window => [window.startedAt, window.endedAt]);
    const renderIntervals = [...renderWindows, ...chunkWindows]
      .filter(interval => Number.isFinite(interval[0]) && Number.isFinite(interval[1]) && interval[1] > interval[0])
      .sort((left, right) => left[0] - right[0]);
    const nonRenderLongTaskDurationsMs = (probe?.longTasks || []).map(task => {
      const taskStart = task.startTime, taskEnd = task.endTime;
      let covered = 0, activeStart = null, activeEnd = null;
      for (const [windowStart, windowEnd] of renderIntervals) {
        const start = Math.max(taskStart, windowStart), end = Math.min(taskEnd, windowEnd);
        if (end <= start) continue;
        if (activeEnd === null) { activeStart = start; activeEnd = end; }
        else if (start <= activeEnd) activeEnd = Math.max(activeEnd, end);
        else { covered += activeEnd - activeStart; activeStart = start; activeEnd = end; }
      }
      if (activeEnd !== null) covered += activeEnd - activeStart;
      return Math.max(0, task.durationMs - covered);
    });
    return {
      firstCardMs: probe?.firstCardAt && probe?.startedAt ? probe.firstCardAt - probe.startedAt : null,
      startedEpochMs: Number(probe?.startedEpochMs) || null,
      firstCardEpochMs: Number(probe?.firstCardEpochMs) || null,
      dataRenderDurationsMs: Array.isArray(probe?.renderDurations) ? probe.renderDurations.slice() : [],
      chunkCallbackDurationsMs: Array.isArray(probe?.chunkCallbackDurations) ? probe.chunkCallbackDurations.slice() : [],
      chunkCallbackWindows: Array.isArray(probe?.chunkCallbackWindows) ? probe.chunkCallbackWindows.slice() : [],
      renderStages: Array.isArray(probe?.renderStages) ? probe.renderStages.slice() : [],
      renderSubOperations: Array.isArray(probe?.renderSubOperations) ? probe.renderSubOperations.slice() : [],
      processSubOperations: Array.isArray(probe?.processSubOperations) ? probe.processSubOperations.slice() : [],
      processLoads: Array.isArray(probe?.processLoads) ? probe.processLoads.slice() : [],
      liveRenderSchedules: Array.isArray(probe?.liveRenderSchedules) ? probe.liveRenderSchedules.slice() : [],
      longTaskDurationsMs: Array.isArray(probe?.longTaskDurations) ? probe.longTaskDurations.slice() : [],
      longTasks: Array.isArray(probe?.longTasks) ? probe.longTasks.slice() : [],
      nonRenderLongTaskDurationsMs,
      slowSyncOperations: Array.isArray(probe?.slowSyncOperations) ? probe.slowSyncOperations.slice() : [],
      slowAsyncOperations: Array.isArray(probe?.slowAsyncOperations) ? probe.slowAsyncOperations.slice() : [],
      maxMainThreadOperationMs: Math.max(0, ...(probe?.renderDurations || []), ...(probe?.chunkCallbackDurations || []), ...(probe?.longTaskDurations || [])),
      searchResponseMs: probe?.searchResultAt && probe?.searchStartedAt ? probe.searchResultAt - probe.searchStartedAt : null,
      visibleCardCount: document.querySelectorAll('#av-content [data-dom-id]').length,
      previewRows: Number(fullInventory.length) || 0,
      avRows: Array.isArray(avOpenInventory) ? avOpenInventory.length : 0,
      master: { fullLoaded: getDatasetState('master').fullLoaded === true,
        fieldCoverage: String(getDatasetState('master').fieldCoverage || ''),
        rowCompleteness: String(getDatasetState('master').rowCompleteness || '') },
      verified: productionLiveSyncVerifiedView === productionVerifiedViewKey(),
      coordinatorState: String(getProductionLiveSyncCoordinator().getStatus().state || '')
    };
  })()`));
}

test('AV renders a bounded first-page preview before side reads, then verifies and reuses all inventory', { tag: ['@home-role'] }, async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'home-desktop-chromium', 'This is a controlled client-render timing measurement on desktop Chromium.');
  test.setTimeout(120_000);

  let sideGateEnabled = false;
  let releaseSideReads!: () => void;
  let markSideReadStarted!: () => void;
  const sideGate = new Promise<void>(resolve => { releaseSideReads = resolve; });
  const sideReadStarted = new Promise<void>(resolve => { markSideReadStarted = resolve; });
  let sideReadsHeld = 0;
  const masterPageLimits: number[] = [];
  const masterPageTimings: Array<{ offset: number; limit: number; requestAtMs: number; responseAtMs?: number; status?: number; failed?: string }> = [];
  const milestones: Array<{ name: string; evidence: unknown }> = [];

  const fixture = await installHlOrderFixture(page, baseURL!, {
    startupMode: 'cold', username: 'av_hydration_fixture', role: 'ADMIN', master: syntheticMasterRows(),
    beforeLogin: async () => {
      await expect(page.locator('#login-button')).toBeEnabled();
      await page.route('**/rest/v1/**', async route => {
        if (!sideGateEnabled) return route.fallback();
        const url = new URL(route.request().url());
        if (/\/rpc\/get_my_dataset_revisions_v1$/.test(url.pathname)) return route.fallback();
        if (!['GET', 'HEAD'].includes(route.request().method())) return route.fallback();
        sideReadsHeld++;
        markSideReadStarted();
        await sideGate;
        return route.fallback();
      });
      await page.route('**/functions/v1/app-api', async route => {
        if (!sideGateEnabled || route.request().method() !== 'POST') return route.fallback();
        const raw: unknown = route.request().postDataJSON();
        const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        if (body.action === 'inventory_read' && body.operation === 'master_page') {
          const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params)
            ? body.params as Record<string, unknown> : {};
          if (Number(params.offset) === 0 && masterPageLimits.length === 0) masterPageLimits.push(Number(params.limit));
          return route.fallback();
        }
        if (body.action === 'inventory_read' && body.operation === 'master_delta') return route.fallback();
        sideReadsHeld++;
        markSideReadStarted();
        await sideGate;
        return route.fallback();
      });
    }
  });

  const masterPageRequestByRequest = new WeakMap<object, (typeof masterPageTimings)[number]>();
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().includes('/functions/v1/app-api')) return;
    let body: Record<string, unknown>;
    try {
      const raw: unknown = request.postDataJSON();
      body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    } catch { return; }
    if (body.action !== 'inventory_read' || body.operation !== 'master_page') return;
    const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params)
      ? body.params as Record<string, unknown> : {};
    const timing = { offset: Number(params.offset) || 0, limit: Number(params.limit) || 0, requestAtMs: Date.now() };
    masterPageTimings.push(timing);
    masterPageRequestByRequest.set(request, timing);
  });
  page.on('response', response => {
    const timing = masterPageRequestByRequest.get(response.request());
    if (!timing) return;
    timing.responseAtMs = Date.now();
    timing.status = response.status();
  });
  page.on('requestfailed', request => {
    const timing = masterPageRequestByRequest.get(request);
    if (timing) timing.failed = request.failure()?.errorText || 'request failed';
  });

  fixture.holdNextMasterLaterPage();
  await installAvTimingProbe(page);
  sideGateEnabled = true;
  const captureMilestone = async (name: string, evidence: unknown) => {
    const firstCardEpochMs = evidence && typeof evidence === 'object'
      ? Number((evidence as Record<string, unknown>).firstCardEpochMs) : NaN;
    const firstPreviewResponseAtMs = masterPageTimings.find(item => item.offset === 0)?.responseAtMs;
    const entry = { name, evidence, network: { masterPageTimings: masterPageTimings.map(item => ({ ...item })),
      previewResponseToFirstCardMs: Number.isFinite(firstCardEpochMs) && Number.isFinite(firstPreviewResponseAtMs)
        ? firstCardEpochMs - Number(firstPreviewResponseAtMs) : null } };
    milestones.push(entry);
    await testInfo.attach(`av-hydration-${name}.json`, {
      body: JSON.stringify(entry, null, 2), contentType: 'application/json'
    });
    console.log(`AV_HYDRATION_MILESTONE_${name.toUpperCase()}`, JSON.stringify(entry));
  };
  let cpuProfilerSession: CDPSession | null = null;
  let cpuProfilerStarted = false;
  let cpuProfileSummary: ReturnType<typeof summarizeCpuProfile> | null = null;
  let cpuProfileWindowStart: { timeOriginMs: number; pageTimeMs: number } | null = null;
  let cpuProfileWindowEnd: { timeOriginMs: number; pageTimeMs: number } | null;
  let cpuProfileStartBracket: { before: { timeOriginMs: number; pageTimeMs: number }; after: { timeOriginMs: number; pageTimeMs: number } } | null = null;
  const cpuProfileEnabled = process.env.AV_CPU_PROFILE === '1';
  try {
    if (cpuProfileEnabled) {
      cpuProfilerSession = await page.context().newCDPSession(page);
      await cpuProfilerSession.send('Profiler.enable');
      await cpuProfilerSession.send('Profiler.setSamplingInterval', { interval: 1000 });
      const before = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
      await cpuProfilerSession.send('Profiler.start');
      cpuProfilerStarted = true;
      const after = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
      cpuProfileWindowStart = before;
      cpuProfileStartBracket = { before, after };
    }
    await page.locator('#home-tile-av').click();
    await Promise.all([fixture.waitForHeldMasterLaterPage(), sideReadStarted]);
    await expect(page.locator('#av-content [data-dom-id]').first()).toBeVisible();
    await expect.poll(async () => (await timingEvidence(page)).firstCardMs).not.toBeNull();

    const preview = await timingEvidence(page);
    await captureMilestone('preview', preview);
    expect(masterPageLimits[0], 'the AV preview read must use the bounded 500-row page').toBe(PREVIEW_PAGE_SIZE);
    expect(preview.previewRows).toBeGreaterThan(0);
    expect(preview.previewRows).toBeLessThanOrEqual(PREVIEW_PAGE_SIZE);
    expect(preview.visibleCardCount).toBeGreaterThan(0);
    expect(preview.visibleCardCount).toBeLessThanOrEqual(PREVIEW_DISPLAY_ROW_LIMIT);
    expect(preview.firstCardMs).toBeGreaterThanOrEqual(0);
    // Human-approved exception: only the initial uncached fetch-to-first-card may take 1,000ms.
    expect.soft(preview.firstCardMs).toBeLessThanOrEqual(1000);
    expect(preview.dataRenderDurationsMs.length).toBeGreaterThan(0);
    assertFrontendUiTiming(expect.soft(Math.max(0, ...preview.dataRenderDurationsMs, ...preview.chunkCallbackDurationsMs)), test.info().project);
    expect.soft(Math.max(0, ...preview.nonRenderLongTaskDurationsMs)).toBeLessThan(100);
    expect(preview.master.fieldCoverage).not.toBe('full');
    expect(preview.master.rowCompleteness).not.toBe('complete');
    expect(preview.verified).toBe(false);

    const search = page.locator('#av-search');
    await expect(search).toBeEnabled();
    const searchStartedAt = await page.evaluate(() => {
      const probe = window.eval('window.__avHydrationTiming');
      const input = document.getElementById('av-search') as HTMLInputElement | null;
      if (!input || !probe) throw new Error('AV preview search control is unavailable');
      const startedAt = performance.now();
      probe.searchStartedAt = startedAt;
      probe.searchResultAt = 0;
      input.value = 'AVH.00049';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return startedAt;
    });
    await page.waitForFunction(() => window.eval('window.__avHydrationTiming.searchResultAt > 0'), null, { timeout: 1000 });
    const previewInteraction = await timingEvidence(page);
    await captureMilestone('preview-interaction', previewInteraction);
    expect(previewInteraction.searchResponseMs).toBeGreaterThanOrEqual(0);
    assertFrontendUiTiming(expect.soft(previewInteraction.searchResponseMs), test.info().project);
    expect(await search.inputValue()).toBe('AVH.00049');
    await expect(page.locator('#av-content [data-dom-id]').filter({ hasText: 'AVH.00049' }).first()).toBeVisible();
    expect(searchStartedAt).toBeGreaterThan(0);

    await page.waitForTimeout(1100);
    const gated = await timingEvidence(page);
    await captureMilestone('gated', gated);
    expect(gated.verified, 'no full-data verification may publish while later master pages and side reads are held').toBe(false);
    expect(gated.master.rowCompleteness).not.toBe('complete');
    expect(sideReadsHeld).toBeGreaterThan(0);
    expect(fixture.blockedMutations, 'preview must remain read-only').toEqual([]);
    expect(fixture.commands, 'no transactional commands may be issued before verification').toEqual([]);

    releaseSideReads();
    fixture.releaseHeldMasterLaterPage();
    await expect(page.locator('#live-data-freshness')).toHaveAttribute('data-state', 'Up to date', { timeout: 30_000 });
    await page.waitForFunction((expectedRows: number) => window.eval(`(() => {
      const identity = getAvSalesDerivationIdentity(activeAvSalesBucket);
      const prepared = window.AgMetricAvDerivedRows.peek(identity.key, identity.scope);
      return getDatasetState('master').fieldCoverage === 'browse'
      && getDatasetState('master').rowCompleteness === 'complete'
      && fullInventory.length === ${expectedRows}
      && productionLiveSyncVerifiedView === productionVerifiedViewKey()
      && !avDerivedRowsPendingSignature
      && prepared && prepared.sourceKey === identity.sourceKey;
    })()`), SYNTHETIC_MASTER_ROWS, { timeout: 30_000 });

    await page.waitForFunction(() => window.eval('!!window.__avHydrationTiming.completedLargeCacheKey'));
    const cachedRows = await page.evaluate(() => window.eval('loadCacheValue(window.__avHydrationTiming.completedLargeCacheKey).then(value => value?.rawRows?.length || 0)'));
    expect(cachedRows).toBe(SYNTHETIC_MASTER_ROWS);
    const legacyCacheSaved = await page.evaluate(() => window.eval('runPersistCurrentCacheNow()'));
    expect(legacyCacheSaved, 'legacy cache projection and storage must also remain bounded').toBe(true);
    const legacyCachedRows = await page.evaluate(() => window.eval('loadCacheValue("latest_data").then(value => value?.data?.length || 0)'));
    expect(legacyCachedRows).toBe(SYNTHETIC_MASTER_ROWS);
    const full = await timingEvidence(page);
    await captureMilestone('full-verification', full);
    expect(full.master.fieldCoverage).toBe('browse');
    expect(full.master.rowCompleteness).toBe('complete');
    expect(full.previewRows).toBe(SYNTHETIC_MASTER_ROWS);
    assertFrontendUiTiming(expect.soft(Math.max(0, ...full.dataRenderDurationsMs, ...full.chunkCallbackDurationsMs)), test.info().project);
    expect.soft(Math.max(0, ...full.nonRenderLongTaskDurationsMs)).toBeLessThan(100);
    expect(await search.inputValue()).toBe('AVH.00049');
    await expect(page.locator('#av-content [data-dom-id]').filter({ hasText: 'AVH.00049' }).first()).toBeVisible();

    const readsBeforeWarmRepeat = fixture.backgroundMasterReads;
    const warmCard = await page.locator('#av-content [data-dom-id]').first().elementHandle();
    expect(warmCard, 'a completed AV card is available before navigating away').not.toBeNull();
    const warmCardDomId = await warmCard!.getAttribute('data-dom-id');
    await page.locator('#global-header-inline-back').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await page.evaluate(() => window.eval('__armAvHydrationTiming()'));
    await page.locator('#home-tile-av').click();
    await expect(page.locator('#av-content [data-dom-id]').first()).toBeVisible();
    await expect.poll(async () => warmCard!.evaluate(node => node.isConnected
      && node.isSameNode(document.querySelector('#av-content [data-dom-id]')))).toBe(true);
    expect(await warmCard!.getAttribute('data-dom-id')).toBe(warmCardDomId);
    await expect.poll(async () => (await timingEvidence(page)).firstCardMs).not.toBeNull();
    await page.waitForFunction(() => window.eval(`productionLiveSyncVerifiedView === productionVerifiedViewKey()
      && getProductionLiveSyncCoordinator().getStatus().state === 'Up to date'`), null, { timeout: 10_000 });
    const warm = await timingEvidence(page);
    await captureMilestone('warm-repeat', warm);
    assertFrontendUiTiming(expect.soft(warm.firstCardMs), test.info().project);
    assertFrontendUiTiming(expect.soft(Math.max(0, ...warm.dataRenderDurationsMs, ...warm.chunkCallbackDurationsMs)), test.info().project);
    expect.soft(Math.max(0, ...warm.nonRenderLongTaskDurationsMs)).toBeLessThan(100);
    expect(fixture.backgroundMasterReads).toBe(readsBeforeWarmRepeat);
    expect(warm.master.rowCompleteness).toBe('complete');
    expect(warm.verified).toBe(true);

    const evidence = {
      kind: 'isolated-client-render-fixture', datasetRows: SYNTHETIC_MASTER_ROWS,
      acceptedColdAvFirstCardLimitMs: 1000,
      acceptedAvDomRenderLimitMs: 400,
      acceptedBackgroundLongTaskLimitMs: 100,
      environment: {
        nodeVersion: process.version,
        browserVersion: await page.context().browser()?.version(),
        viewport: page.viewportSize(),
        trace: 'off',
        screenshots: 'off',
        cpuProfile: cpuProfileEnabled ? 'enabled by AV_CPU_PROFILE=1' : 'disabled for acceptance timing',
        domObserverScope: '#av-content and #av-crumb; long-task observer remains page-wide for the main-thread gate',
        coldAssumptions: 'Fresh Playwright test context, cold fixture login, no-cache request headers, and service workers blocked by the home-role config.',
        warmAssumptions: 'Same page context after full browse-cohort verification; the first card DOM node is retained and no new master read is allowed.'
      },
      firstPageLimit: masterPageLimits[0], coldPreview: preview, gatedState: gated, fullVerification: full,
      previewInteraction, warmRepeat: warm, heldSideReadCount: sideReadsHeld,
      note: 'Playwright fixture measurements cover UI hydration/rendering; database and live API timings require the separate disposable backend benchmark.'
    };
    await testInfo.attach('av-hydration-client-fixture.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    console.log('AV_HYDRATION_CLIENT_FIXTURE', JSON.stringify(evidence));
  } finally {
    releaseSideReads();
    try { fixture.releaseHeldMasterLaterPage(); } catch { /* no page remained held */ }
    if (cpuProfilerSession && cpuProfilerStarted) {
      try {
        const stopped = await cpuProfilerSession.send('Profiler.stop');
        cpuProfileWindowEnd = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
        cpuProfileSummary = summarizeCpuProfile(stopped.profile);
        await testInfo.attach('av-hydration-cpu-profile.json', {
          body: JSON.stringify(stopped.profile), contentType: 'application/json'
        });
        await testInfo.attach('av-hydration-cpu-profile-summary.json', {
          body: JSON.stringify(cpuProfileSummary, null, 2), contentType: 'application/json'
        });
        const longTaskRecords = new Map<string, { milestone: string; startTime: number; endTime: number; durationMs: number }>();
        const syncOperationRecords = new Map<string, { name: string; startedAt: number; endedAt: number; durationMs: number; [key: string]: unknown }>();
        const asyncOperationRecords = new Map<string, { name: string; startedAt: number; endedAt: number; durationMs: number; [key: string]: unknown }>();
        for (const milestone of milestones) {
          const evidence = milestone.evidence && typeof milestone.evidence === 'object'
            ? milestone.evidence as Record<string, unknown> : {};
          const longTasks = Array.isArray(evidence.longTasks) ? evidence.longTasks as Array<{ startTime: number; endTime: number; durationMs: number }> : [];
          const slowSyncOperations = Array.isArray(evidence.slowSyncOperations)
            ? evidence.slowSyncOperations as Array<{ name: string; startedAt: number; endedAt: number; durationMs: number; [key: string]: unknown }> : [];
          const slowAsyncOperations = Array.isArray(evidence.slowAsyncOperations)
            ? evidence.slowAsyncOperations as Array<{ name: string; startedAt: number; endedAt: number; durationMs: number; [key: string]: unknown }> : [];
          longTasks.forEach(task => longTaskRecords.set(`${task.startTime}:${task.endTime}`,
            longTaskRecords.get(`${task.startTime}:${task.endTime}`) || { milestone: milestone.name, ...task }));
          slowSyncOperations.forEach(operation => syncOperationRecords.set(`${operation.name}:${operation.startedAt}:${operation.endedAt}`, operation));
          slowAsyncOperations.forEach(operation => asyncOperationRecords.set(`${operation.name}:${operation.startedAt}:${operation.endedAt}`, operation));
        }
        const timelineEvidence = {
          longTasks: Array.from(longTaskRecords.values()),
          slowSyncOperations: Array.from(syncOperationRecords.values()),
          slowAsyncOperations: Array.from(asyncOperationRecords.values())
        };
        const correlatedLongTasks = timelineEvidence.longTasks.map((task: { startTime: number; endTime: number; durationMs: number }) => ({
          ...task,
          overlappingSynchronousOperations: timelineEvidence.slowSyncOperations.filter((operation: { startedAt: number; endedAt: number }) =>
            operation.startedAt <= task.endTime && operation.endedAt >= task.startTime),
          overlappingAsynchronousOperations: timelineEvidence.slowAsyncOperations.filter((operation: { startedAt: number; endedAt: number }) =>
            operation.startedAt <= task.endTime && operation.endedAt >= task.startTime)
        }));
        const longTaskCpuAttribution = summarizeCpuProfileForLongTasks(stopped.profile,
          Number(cpuProfileWindowEnd?.pageTimeMs), timelineEvidence.longTasks);
        await testInfo.attach('av-hydration-cpu-profile-timeline.json', {
          body: JSON.stringify({ sampleIntervalUs: 1000, cpuProfileWindowStart, cpuProfileStartBracket, cpuProfileWindowEnd,
            profileSampledMs: cpuProfileSummary.sampledMs,
            clock: 'Long-task and operation start/end times use page performance.now(); CPU samples use the adjacent CDP profile window. Async overlaps show wall-clock coincidence only; synchronous overlaps identify code executing on the main thread.',
            correlatedLongTasks, longTaskCpuAttribution }, null, 2), contentType: 'application/json'
        });
        console.log('AV_HYDRATION_CPU_PROFILE_SUMMARY', JSON.stringify(cpuProfileSummary));
      } catch (error) {
        console.log('AV_HYDRATION_CPU_PROFILE_CAPTURE_FAILED', String(error));
      }
    }
    if (cpuProfilerSession) {
      try { await cpuProfilerSession.detach(); }
      catch (error) { console.log('AV_HYDRATION_CPU_PROFILE_DETACH_FAILED', String(error)); }
    }
    const finalState = await timingEvidence(page).catch(error => ({ captureError: String(error) }));
    const failureEvidence = { status: testInfo.status || 'in-progress', milestones, finalState,
      masterPageLimits, masterPageTimings, sideReadsHeld, cpuProfileSummary };
    await testInfo.attach('av-hydration-final-state.json', {
      body: JSON.stringify(failureEvidence, null, 2), contentType: 'application/json'
    });
    console.log('AV_HYDRATION_FINAL_STATE', JSON.stringify(failureEvidence));
  }

  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});
