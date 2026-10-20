import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
import { durationOutsideIntervals, getLoafTimingIntervals } from './helpers/av-hydration-timing.mjs';
import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';

// @test-group: @home-role

// Keep profiler, trace, and screenshot work out of acceptance measurements.
// Set AV_CPU_PROFILE=1 only when collecting diagnostic CPU and Chrome timeline profiles.
test.use({ trace: 'off', screenshot: 'off' });

const SYNTHETIC_MASTER_ROWS = 12000;
const AV_PREVIEW_PAGE_SIZE = 16;
const INVENTORY_PAGE_SIZE = 500;
const PREVIEW_DISPLAY_ROW_LIMIT = 16;

type CpuProfileNode = {
  id: number;
  children?: number[];
  callFrame?: { functionName?: string; url?: string; lineNumber?: number };
};

type TraceClockSync = {
  syncId: string;
  before: { timeOriginMs: number; pageTimeMs: number };
  after: { timeOriginMs: number; pageTimeMs: number };
};

type ChromeTraceEvent = {
  name?: unknown;
  cat?: unknown;
  ts?: unknown;
  dur?: unknown;
  ph?: unknown;
  pid?: unknown;
  tid?: unknown;
  args?: unknown;
};

type LoafDiagnosticEntry = {
  startTime: number;
  duration: number;
  renderStart: number | null;
  styleAndLayoutStart: number | null;
  blockingDuration: number | null;
  firstUIEventTimestamp: number | null;
  paintTime: number | null;
  presentationTime: number | null;
  scripts: Array<Record<string, string | number | null>>;
};

async function persistAndAttach(testInfo: TestInfo, name: string, body: string | Uint8Array, contentType: string) {
  await mkdir(testInfo.outputDir, { recursive: true });
  const path = testInfo.outputPath(name);
  await writeFile(path, body);
  await testInfo.attach(name, { path, contentType });
}

function summarizeChromeTimeline(raw: string, clockSync: TraceClockSync | null,
  longTasks: Array<{ startTime: number; endTime: number; durationMs: number }>, loafEntries: LoafDiagnosticEntry[]) {
  let events: ChromeTraceEvent[] = [];
  try {
    const parsed = JSON.parse(raw) as { traceEvents?: unknown };
    events = Array.isArray(parsed.traceEvents) ? parsed.traceEvents as ChromeTraceEvent[] : [];
  } catch {
    return { eventCount: 0, clockCorrelation: null, targetLongTasks: [], targetLongAnimationFrames: [],
      error: 'Trace stream was not complete JSON.' };
  }
  const syncEvent = clockSync && events.find(event => {
    const args = event.args && typeof event.args === 'object' ? event.args as Record<string, unknown> : {};
    return event.name === 'clock_sync' && (args.sync_id === clockSync.syncId || args.syncId === clockSync.syncId);
  });
  const syncTsMs = Number(syncEvent?.ts) / 1000;
  const pageMidpointMs = clockSync ? (clockSync.before.pageTimeMs + clockSync.after.pageTimeMs) / 2 : NaN;
  const pageOffsetMs = Number.isFinite(syncTsMs) && Number.isFinite(pageMidpointMs) ? pageMidpointMs - syncTsMs : NaN;
  const clockCorrelation = Number.isFinite(pageOffsetMs) ? {
    syncId: clockSync?.syncId, pageOffsetMs, bracketWidthMs: clockSync!.after.pageTimeMs - clockSync!.before.pageTimeMs,
    pageTimeOriginMs: clockSync?.before.timeOriginMs
  } : null;
  const relevantNames = new Set(['RunTask', 'Program', 'FunctionCall', 'EvaluateScript', 'EventDispatch', 'FireAnimationFrame',
    'RequestAnimationFrame', 'TimerFire', 'Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'PrePaint', 'Paint', 'CompositeLayers',
    'Commit', 'V8.Execute', 'UpdateLayerTree']);
  const targetLongTasks = Number.isFinite(pageOffsetMs) ? longTasks.filter(task => task.durationMs >= 50).map(task => {
    const matching = events.flatMap(event => {
      const name = String(event.name || '');
      const traceStartMs = Number(event.ts) / 1000 + pageOffsetMs;
      const traceDurationMs = Number(event.dur) / 1000;
      if (!relevantNames.has(name) || !Number.isFinite(traceStartMs)
          || traceStartMs > task.endTime || traceStartMs + (Number.isFinite(traceDurationMs) ? traceDurationMs : 0) < task.startTime) return [];
      return [{ name, category: String(event.cat || ''), phase: String(event.ph || ''),
        startPageMs: traceStartMs, durationMs: Number.isFinite(traceDurationMs) ? traceDurationMs : null,
        pid: Number(event.pid) || 0, tid: Number(event.tid) || 0 }];
    }).sort((left, right) => left.startPageMs - right.startPageMs);
    const totals = new Map<string, { count: number; durationMs: number; maxDurationMs: number }>();
    matching.forEach(event => {
      const entry = totals.get(event.name) || { count: 0, durationMs: 0, maxDurationMs: 0 };
      entry.count++;
      if (event.durationMs !== null) entry.durationMs += event.durationMs;
      entry.maxDurationMs = Math.max(entry.maxDurationMs, event.durationMs || 0);
      totals.set(event.name, entry);
    });
    return { task, eventSummary: Array.from(totals, ([name, values]) => ({ name, ...values }))
      .sort((left, right) => right.durationMs - left.durationMs), events: matching.slice(0, 300) };
  }) : [];
  const targetLongAnimationFrames = Number.isFinite(pageOffsetMs) ? loafEntries.filter(frame => frame.duration >= 50).map(frame => {
    const frameEnd = frame.startTime + frame.duration;
    const renderStart = frame.renderStart;
    const styleStart = frame.styleAndLayoutStart;
    const layoutEvents = events.flatMap(event => {
      const name = String(event.name || '');
      const startPageMs = Number(event.ts) / 1000 + pageOffsetMs;
      const durationMs = Number(event.dur) / 1000;
      const endPageMs = startPageMs + (Number.isFinite(durationMs) ? durationMs : 0);
      if (!['Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'PrePaint', 'Paint', 'UpdateLayerTree', 'CompositeLayers'].includes(name)
          || !Number.isFinite(startPageMs) || endPageMs < (styleStart ?? frame.startTime) || startPageMs > frameEnd) return [];
      return [{ name, category: String(event.cat || ''), phase: String(event.ph || ''), startPageMs,
        durationMs: Number.isFinite(durationMs) ? durationMs : null, pid: Number(event.pid) || 0, tid: Number(event.tid) || 0 }];
    }).sort((left, right) => left.startPageMs - right.startPageMs);
    return { frame, frameEnd, preRenderWorkMs: renderStart === null ? null : Math.max(0, renderStart - frame.startTime),
      renderCycleMs: renderStart === null ? null : Math.max(0, frameEnd - renderStart),
      styleAndLayoutTailMs: styleStart === null ? null : Math.max(0, frameEnd - styleStart),
      reportedScriptDurationMs: frame.scripts.reduce((sum, script) => sum + (Number(script.duration) || 0), 0),
      layoutEventSummary: layoutEvents.reduce<Array<{ name: string; count: number; durationMs: number; maxDurationMs: number }>>((summary, event) => {
        let item = summary.find(value => value.name === event.name);
        if (!item) { item = { name: event.name, count: 0, durationMs: 0, maxDurationMs: 0 }; summary.push(item); }
        item.count++;
        item.durationMs += event.durationMs || 0;
        item.maxDurationMs = Math.max(item.maxDurationMs, event.durationMs || 0);
        return summary;
      }, []), layoutEvents: layoutEvents.slice(0, 300) };
  }) : [];
  return { eventCount: events.length, clockCorrelation, targetLongTasks, targetLongAnimationFrames, error: null };
}

async function stopAndAttachChromeTimeline(session: CDPSession, testInfo: TestInfo, clockSync: TraceClockSync | null,
  cpuProfileStartBracket: { before: { timeOriginMs: number; pageTimeMs: number }; after: { timeOriginMs: number; pageTimeMs: number } } | null,
  longTasks: Array<{ startTime: number; endTime: number; durationMs: number }>, loafEntries: LoafDiagnosticEntry[]) {
  type TraceComplete = { stream?: string; traceFormat?: string };
  let completionHandler: ((value: TraceComplete) => void) | null = null;
  const completion = new Promise<TraceComplete>(resolve => {
    completionHandler = resolve;
    session.once('Tracing.tracingComplete', resolve);
  });
  await session.send('Tracing.end');
  const waitMs = 10_000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const complete = await Promise.race([completion, new Promise<null>(resolve => {
    timeoutId = setTimeout(() => resolve(null), waitMs);
  })]);
  if (timeoutId) clearTimeout(timeoutId);
  if (completionHandler) session.off('Tracing.tracingComplete', completionHandler);
  if (!complete?.stream) throw new Error('Chrome tracing did not provide a readable stream within 10 seconds.');
  const deadline = Date.now() + waitMs;
  const chunks: string[] = [];
  let byteCount = 0;
  let readError = '';
  let streamEnded = false;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let readTimeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        session.send('IO.read', { handle: complete.stream, size: 1024 * 1024 }),
        new Promise<null>(resolve => { readTimeout = setTimeout(() => resolve(null), remaining); })
      ]);
      if (readTimeout) clearTimeout(readTimeout);
      if (!result) { readError = 'Trace stream read exceeded the 10-second bound.'; break; }
      const part = result.base64Encoded ? Buffer.from(result.data || '', 'base64').toString('utf8') : String(result.data || '');
      byteCount += Buffer.byteLength(part);
      if (byteCount > 40 * 1024 * 1024) { readError = 'Trace stream exceeded the 40 MiB capture bound.'; break; }
      chunks.push(part);
      if (result.eof) { streamEnded = true; break; }
    }
    const raw = chunks.join('');
    const summary = summarizeChromeTimeline(raw, clockSync, longTasks, loafEntries);
    const completeJson = streamEnded && !readError && summary.error === null;
    if (completeJson) await persistAndAttach(testInfo, 'av-hydration-devtools-timeline.json', raw, 'application/json');
    else if (raw) await persistAndAttach(testInfo, 'av-hydration-devtools-timeline.partial.txt', raw, 'text/plain');
    const timelineSummary = { captureComplete: completeJson, streamEnded, readError: readError || null, byteCount, cpuProfileStartBracket,
      traceFormat: complete.traceFormat || null, clockSync, ...summary };
    await persistAndAttach(testInfo, 'av-hydration-devtools-timeline-summary.json', JSON.stringify(timelineSummary, null, 2), 'application/json');
    await persistAndAttach(testInfo, 'av-hydration-loaf-evidence.json', JSON.stringify({ clockCorrelation: summary.clockCorrelation,
      frames: summary.targetLongAnimationFrames }, null, 2), 'application/json');
    console.log('AV_HYDRATION_DEVTOOLS_TIMELINE_SUMMARY', JSON.stringify({ captureComplete: completeJson, streamEnded, byteCount,
      readError: readError || null, ...summary }));
  } finally {
    await session.send('IO.close', { handle: complete.stream }).catch(() => undefined);
  }
}

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
    const probe = window.__avHydrationTiming = { startedAt: 0, startedEpochMs: 0, firstCardAt: 0, firstCardEpochMs: 0, openSalesAvDurationMs: null, openSalesAvWindow: null, renderDurations: [], chunkCallbackDurations: [], chunkCallbackWindows: [], renderStages: [], renderSubOperations: [], activeRenderId: 0, renderIdCounter: 0, processSubOperations: [], activeProcessId: 0, processIdCounter: 0, processLoads: [], liveRenderSchedules: [], longTaskDurations: [], longTasks: [], slowSyncOperations: [], slowAsyncOperations: [], preparationPhase: '', preparationPhases: [], yieldToUiFrameDurations: [],
      searchStartedAt: 0, searchResultAt: 0, observer: null, searchObserver: null, searchResultVisibilityObserver: null,
      searchCandidate: null, firstCardVisibilityObserver: null, firstCardCandidate: null, longTaskObserver: null,
      longAnimationFrames: [], longAnimationFrameObserver: null, armedPointerHandler: null };
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
      if (!term || !crumb.includes('Search Results (1)') || !match) {
        probe.searchResultVisibilityObserver?.disconnect();
        probe.searchResultVisibilityObserver = null;
        probe.searchCandidate = null;
        return;
      }
      if (probe.searchCandidate === match) return;
      probe.searchResultVisibilityObserver?.disconnect();
      probe.searchCandidate = match;
      if (typeof IntersectionObserver !== 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (probe.searchStartedAt && !probe.searchResultAt && probe.searchCandidate === match
              && match.isConnected && String(input?.value || '').trim() === term
              && String(document.getElementById('av-crumb')?.textContent || '').includes('Search Results (1)')) {
            probe.searchResultAt = performance.now();
            probe.searchObserver?.disconnect();
          }
        }));
        return;
      }
      probe.searchResultVisibilityObserver = new IntersectionObserver(entries => {
        if (!probe.searchStartedAt || probe.searchResultAt || probe.searchCandidate !== match || !match.isConnected) return;
        if (!entries.some(entry => entry.target === match && entry.isIntersecting && entry.intersectionRatio > 0)) return;
        if (String(input?.value || '').trim() !== term
            || !String(document.getElementById('av-crumb')?.textContent || '').includes('Search Results (1)')) return;
        probe.searchResultAt = performance.now();
        probe.searchObserver?.disconnect();
        probe.searchResultVisibilityObserver?.disconnect();
      });
      probe.searchResultVisibilityObserver.observe(match);
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
    const originalOpenSalesAvModule = openSalesAvModule;
    openSalesAvModule = function(...args) {
      if (!probe.startedAt) return originalOpenSalesAvModule.apply(this, args);
      const startedAt = performance.now();
      try { return originalOpenSalesAvModule.apply(this, args); }
      finally {
        const endedAt = performance.now();
        probe.openSalesAvDurationMs = endedAt - startedAt;
        probe.openSalesAvWindow = [startedAt, endedAt];
      }
    };
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
    const originalPrepareMasterSeasonAssignments = prepareMasterSeasonAssignments;
    prepareMasterSeasonAssignments = function(...args) {
      if (!probe.startedAt) return originalPrepareMasterSeasonAssignments.apply(this, args);
      const startedAt = performance.now();
      const previousPhase = probe.preparationPhase;
      probe.preparationPhase = 'prepareMasterSeasonAssignments';
      let result;
      try { result = originalPrepareMasterSeasonAssignments.apply(this, args); }
      catch (error) {
        probe.preparationPhases.push({ name: 'prepareMasterSeasonAssignments', startedAt, endedAt: performance.now(), failed: true });
        probe.preparationPhase = previousPhase;
        throw error;
      }
      return Promise.resolve(result).then(value => {
        probe.preparationPhases.push({ name: 'prepareMasterSeasonAssignments', startedAt, endedAt: performance.now(), failed: false });
        return value;
      }, error => {
        probe.preparationPhases.push({ name: 'prepareMasterSeasonAssignments', startedAt, endedAt: performance.now(), failed: true });
        throw error;
      }).finally(() => { probe.preparationPhase = previousPhase; });
    };
    const originalYieldToUiFrame = yieldToUiFrame;
    yieldToUiFrame = function(...args) {
      if (!probe.startedAt) return originalYieldToUiFrame.apply(this, args);
      const startedAt = performance.now();
      const phase = probe.preparationPhase || 'other';
      let result;
      try { result = originalYieldToUiFrame.apply(this, args); }
      catch (error) {
        probe.yieldToUiFrameDurations.push({ phase, startedAt, endedAt: performance.now(), failed: true });
        throw error;
      }
      return Promise.resolve(result).then(value => {
        probe.yieldToUiFrameDurations.push({ phase, startedAt, endedAt: performance.now(), failed: false });
        return value;
      }, error => {
        probe.yieldToUiFrameDurations.push({ phase, startedAt, endedAt: performance.now(), failed: true });
        throw error;
      });
    };
    saveCacheValue = (function(original) {
      return function(...args) {
        if (!probe.startedAt) return original.apply(this, args);
        const startedAt = performance.now();
        const value = args[1];
        const rowCount = Array.isArray(value?.rawRows) ? value.rawRows.length
          : (Array.isArray(value?.data) ? value.data.length : 0);
        return original.apply(this, args).then(result => {
          recordSlowOperation('slowAsyncOperations', 'saveCacheValue', startedAt, { rowCount, succeeded: result === true });
          if (result === true && rowCount >= 12000 && value?.format === 'verified-raw-v1'
              && value?.meta?.adapterId === 'core:master') probe.completedLargeCacheKey = args[0];
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
      if (probe.armedPointerHandler) document.removeEventListener('pointerdown', probe.armedPointerHandler, true);
      probe.observer?.disconnect();
      probe.searchObserver?.disconnect();
      probe.firstCardVisibilityObserver?.disconnect();
      probe.searchResultVisibilityObserver?.disconnect();
      probe.firstCardCandidate = null;
      probe.searchCandidate = null;
      const onAvTilePointerDown = event => {
        const target = event.target instanceof Element ? event.target.closest('#home-sales-open-av') : null;
        if (!target) return;
        document.removeEventListener('pointerdown', onAvTilePointerDown, true);
        probe.armedPointerHandler = null;
        probe.startedAt = performance.now();
        probe.startedEpochMs = performance.timeOrigin + probe.startedAt;
        probe.firstCardAt = 0;
        probe.firstCardEpochMs = 0;
        probe.openSalesAvDurationMs = null;
        probe.openSalesAvWindow = null;
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
        probe.preparationPhase = '';
        probe.preparationPhases = [];
        probe.yieldToUiFrameDurations = [];
        probe.longTaskDurations = [];
        probe.longTasks = [];
        probe.longAnimationFrames = [];
        probe.slowSyncOperations = [];
        probe.slowAsyncOperations = [];
        probe.searchStartedAt = 0;
        probe.searchResultAt = 0;
        probe.searchCandidate = null;
        probe.searchResultVisibilityObserver?.disconnect();
        probe.searchResultVisibilityObserver = null;
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
            probe.longTasks.push({ startTime: entry.startTime, durationMs: entry.duration, endTime: entry.startTime + entry.duration,
              attribution: Array.from(entry.attribution || []).map(item => ({ name: item.name, entryType: item.entryType,
                containerType: item.containerType, containerName: item.containerName, containerId: item.containerId })) });
          }
        });
        probe.longTaskObserver.observe({ type: 'longtask', buffered: false });
        const capture = () => {
          if (probe.firstCardAt) return true;
          const container = document.getElementById('av-content');
          const card = container?.querySelector('[data-dom-id]');
          if (!container || !card) {
            probe.firstCardVisibilityObserver?.disconnect();
            probe.firstCardVisibilityObserver = null;
            probe.firstCardCandidate = null;
            return false;
          }
          if (probe.firstCardCandidate === card) return true;
          probe.firstCardVisibilityObserver?.disconnect();
          probe.firstCardCandidate = card;
          const recordVisibleCard = () => {
            if (probe.firstCardAt || probe.firstCardCandidate !== card || !card.isConnected) return;
            probe.firstCardAt = performance.now();
            probe.firstCardEpochMs = performance.timeOrigin + probe.firstCardAt;
            probe.observer?.disconnect();
            probe.firstCardVisibilityObserver?.disconnect();
          };
          if (typeof IntersectionObserver !== 'function') {
            requestAnimationFrame(() => requestAnimationFrame(recordVisibleCard));
            return true;
          }
          probe.firstCardVisibilityObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.target === card && entry.isIntersecting && entry.intersectionRatio > 0)) recordVisibleCard();
          });
          probe.firstCardVisibilityObserver.observe(card);
          return true;
        };
        probe.observer?.disconnect();
        probe.observer = new MutationObserver(capture);
        if (!avContainer) throw new Error('AV content container is unavailable');
        probe.observer.observe(avContainer, { childList: true, subtree: true, attributes: true });
        requestAnimationFrame(capture);
        probe.observer.observe(avContainer, { childList: true, subtree: true, characterData: true });
      };
      probe.armedPointerHandler = onAvTilePointerDown;
      document.addEventListener('pointerdown', onAvTilePointerDown, true);
    };
    arm();
    window.__armAvHydrationTiming = arm;
    return true;
  })()`));
  expect(installed).toBe(true);
}

async function startAvLoafObserver(page: Page, enabled: boolean) {
  return page.evaluate(diagnosticEnabled => {
    return window.eval(`(diagnosticEnabled => {
    const probe = window.__avHydrationTiming;
    if (!probe) return { enabled: true, supported: false };
    const supported = Array.isArray(PerformanceObserver.supportedEntryTypes)
      && PerformanceObserver.supportedEntryTypes.includes('long-animation-frame');
    probe.longAnimationFrames = [];
    if (!supported) return { enabled: true, supported: false };
    const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
    const safeSource = value => {
      const source = String(value || '');
      if (!source) return '';
      try { const url = new URL(source, location.href); return url.origin + url.pathname; }
      catch { return source.split(/[?#]/, 1)[0].slice(0, 240); }
    };
    const observer = new PerformanceObserver(list => {
      if (!probe.startedAt || probe.longAnimationFrames.length >= 100) return;
      for (const entry of list.getEntries()) {
        if (probe.longAnimationFrames.length >= 100) break;
        const scripts = diagnosticEnabled ? Array.from(entry.scripts || []).map(script => ({
          startTime: numberOrNull(script.startTime), duration: numberOrNull(script.duration),
          executionStart: numberOrNull(script.executionStart), forcedStyleAndLayoutDuration: numberOrNull(script.forcedStyleAndLayoutDuration),
          pauseDuration: numberOrNull(script.pauseDuration), invoker: String(script.invoker || ''), invokerType: String(script.invokerType || ''),
          sourceURL: safeSource(script.sourceURL), sourceFunctionName: String(script.sourceFunctionName || ''),
          sourceCharPosition: numberOrNull(script.sourceCharPosition), windowAttribution: String(script.windowAttribution || '')
        })) : [];
        probe.longAnimationFrames.push({ startTime: numberOrNull(entry.startTime), duration: numberOrNull(entry.duration),
          renderStart: numberOrNull(entry.renderStart), styleAndLayoutStart: numberOrNull(entry.styleAndLayoutStart),
          blockingDuration: numberOrNull(entry.blockingDuration), firstUIEventTimestamp: numberOrNull(entry.firstUIEventTimestamp),
          paintTime: numberOrNull(entry.paintTime), presentationTime: numberOrNull(entry.presentationTime), scripts });
      }
    });
    try {
      observer.observe({ type: 'long-animation-frame', buffered: false });
      probe.longAnimationFrameObserver = observer;
    return { enabled: true, supported: true, diagnosticScripts: diagnosticEnabled };
    } catch (error) {
      return { enabled: true, supported: false, observeError: String(error) };
    }
    })(${diagnosticEnabled ? 'true' : 'false'})`);
  }, enabled);
}

async function timingEvidence(page: Page) {
  const evidence = await page.evaluate(() => window.eval(`(() => {
    const probe = window.__avHydrationTiming;
    const renderWindows = (probe?.renderStages || []).map(stage => [stage.startedAt, stage.startedAt + stage.durationMs]);
    const chunkWindows = (probe?.chunkCallbackWindows || []).map(window => [window.startedAt, window.endedAt]);
    const userActionWindows = probe?.openSalesAvWindow ? [probe.openSalesAvWindow] : [];
    const measuredUiIntervals = [...renderWindows, ...chunkWindows, ...userActionWindows]
      .filter(interval => Number.isFinite(interval[0]) && Number.isFinite(interval[1]) && interval[1] > interval[0])
      .sort((left, right) => left[0] - right[0]);
    return {
      firstCardMs: probe?.firstCardAt && probe?.startedAt ? probe.firstCardAt - probe.startedAt : null,
      openSalesAvDurationMs: Number.isFinite(probe?.openSalesAvDurationMs) ? probe.openSalesAvDurationMs : null,
      measuredUiIntervals,
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
      longAnimationFrames: Array.isArray(probe?.longAnimationFrames) ? probe.longAnimationFrames.slice() : [],
      preparationPhases: Array.isArray(probe?.preparationPhases) ? probe.preparationPhases.map(phase => ({ ...phase, durationMs: phase.endedAt - phase.startedAt })) : [],
      yieldToUiFrameCount: Array.isArray(probe?.yieldToUiFrameDurations) ? probe.yieldToUiFrameDurations.length : 0,
      yieldToUiFrameDurations: Array.isArray(probe?.yieldToUiFrameDurations) ? probe.yieldToUiFrameDurations.map(yieldEvent => ({ ...yieldEvent, durationMs: yieldEvent.endedAt - yieldEvent.startedAt })) : [],
      longTaskDurationsMs: Array.isArray(probe?.longTaskDurations) ? probe.longTaskDurations.slice() : [],
      longTasks: Array.isArray(probe?.longTasks) ? probe.longTasks.slice() : [],
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
  const loafIntervals = evidence.longAnimationFrames.map(getLoafTimingIntervals);
  const styleAndLayoutIntervals = loafIntervals.flatMap(intervals => intervals.styleAndLayout ? [intervals.styleAndLayout] : []);
  evidence.naturalRenderCycleDurationsMs = loafIntervals.flatMap(intervals => intervals.renderCycle
    ? [intervals.renderCycle[1] - intervals.renderCycle[0]] : []);
  const backgroundExclusions = [...evidence.measuredUiIntervals, ...styleAndLayoutIntervals];
  evidence.nonRenderLongTaskDurationsMs = evidence.longTasks.map(task =>
    durationOutsideIntervals(task.startTime, task.endTime, backgroundExclusions));
  return evidence;
}

test('AV renders a bounded first-page preview before side reads, then verifies and reuses all inventory', { tag: ['@home-role'] }, async ({ page, baseURL }, testInfo) => {
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
    startupMode: 'cold', username: 'brian_hatfield', role: 'REP', master: syntheticMasterRows(),
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
  let chromeTraceSession: CDPSession | null = null;
  let chromeTracingStarted = false;
  let chromeTraceCaptured = false;
  let chromeTraceClockSync: TraceClockSync | null = null;
  try {
    const loafObserverStatus = await startAvLoafObserver(page, cpuProfileEnabled)
      .catch(error => ({ enabled: true, supported: false, observeError: String(error) }));
    if (cpuProfileEnabled) {
      console.log('AV_HYDRATION_LOAF_OBSERVER', JSON.stringify(loafObserverStatus));
      cpuProfilerSession = await page.context().newCDPSession(page);
      await cpuProfilerSession.send('Profiler.enable');
      await cpuProfilerSession.send('Profiler.setSamplingInterval', { interval: 1000 });
      const before = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
      await cpuProfilerSession.send('Profiler.start');
      cpuProfilerStarted = true;
      const after = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
      cpuProfileWindowStart = before;
      cpuProfileStartBracket = { before, after };
      chromeTraceSession = cpuProfilerSession;
      try {
        await chromeTraceSession.send('Tracing.start', {
          categories: 'devtools.timeline,disabled-by-default-devtools.timeline,toplevel,v8,blink.user_timing',
          transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'none', bufferUsageReportingInterval: 1000
        });
        chromeTracingStarted = true;
        const syncId = `av-hydration-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
        const syncBefore = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
        await chromeTraceSession.send('Tracing.recordClockSyncMarker', { syncId });
        const syncAfter = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
        chromeTraceClockSync = { syncId, before: syncBefore, after: syncAfter };
      } catch (error) {
        console.log('AV_HYDRATION_DEVTOOLS_TIMELINE_START_FAILED', String(error));
      }
    }
    await page.locator('#home-sales-open-av').click();
    await Promise.all([fixture.waitForHeldMasterLaterPage(), sideReadStarted]);
    await expect(page.locator('#av-content [data-dom-id]').first()).toBeVisible();
    await expect.poll(async () => (await timingEvidence(page)).firstCardMs).not.toBeNull();

    const preview = await timingEvidence(page);
    await captureMilestone('preview', preview);
    expect(masterPageLimits[0], 'the AV preview must request only the 16 rows needed for its bounded first paint').toBe(AV_PREVIEW_PAGE_SIZE);
    expect(masterPageTimings.some(item => item.offset === AV_PREVIEW_PAGE_SIZE && item.limit === INVENTORY_PAGE_SIZE),
      'complete inventory paging must continue immediately after the preview with bounded 500-row pages').toBe(true);
    expect(preview.previewRows).toBeGreaterThan(0);
    expect(preview.previewRows).toBeLessThanOrEqual(PREVIEW_DISPLAY_ROW_LIMIT);
    expect(preview.visibleCardCount).toBeGreaterThan(0);
    expect(preview.visibleCardCount).toBeLessThanOrEqual(PREVIEW_DISPLAY_ROW_LIMIT);
    expect(preview.firstCardMs).toBeGreaterThanOrEqual(0);
    // Human-approved exception: only the initial uncached fetch-to-first-card may take 1,000ms.
    expect.soft(preview.firstCardMs).toBeLessThanOrEqual(1000);
    assertFrontendUiTiming(expect.soft(preview.openSalesAvDurationMs), test.info().project);
    expect(preview.dataRenderDurationsMs.length).toBeGreaterThan(0);
    assertFrontendUiTiming(expect.soft(Math.max(0, ...preview.dataRenderDurationsMs, ...preview.chunkCallbackDurationsMs,
      ...preview.naturalRenderCycleDurationsMs)), test.info().project);
    // AV-specific approved waiver: the accepted run measured a 158 ms non-render task.
    // Keep this scoped ceiling at 250 ms; UI (400 ms), cold first-card (1000 ms), and CPU gates stay unchanged.
    expect.soft(Math.max(0, ...preview.nonRenderLongTaskDurationsMs)).toBeLessThanOrEqual(250);
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
      input.value = 'AVH.00015';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return startedAt;
    });
    await page.waitForFunction(() => window.eval('window.__avHydrationTiming.searchResultAt > 0'), null, { timeout: 1000 });
    const previewInteraction = await timingEvidence(page);
    await captureMilestone('preview-interaction', previewInteraction);
    expect(previewInteraction.searchResponseMs).toBeGreaterThanOrEqual(0);
    assertFrontendUiTiming(expect.soft(previewInteraction.searchResponseMs), test.info().project);
    expect(await search.inputValue()).toBe('AVH.00015');
    await expect(page.locator('#av-content [data-dom-id]').filter({ hasText: 'AVH.00015' }).first()).toBeVisible();
    expect(searchStartedAt).toBeGreaterThan(0);
    if (chromeTraceSession && chromeTracingStarted) {
      const traceLongTasks = Array.isArray(previewInteraction.longTasks)
        ? previewInteraction.longTasks as Array<{ startTime: number; endTime: number; durationMs: number }> : [];
      const traceLoafEntries = Array.isArray(previewInteraction.longAnimationFrames)
        ? previewInteraction.longAnimationFrames as LoafDiagnosticEntry[] : [];
      try {
        await stopAndAttachChromeTimeline(chromeTraceSession, testInfo, chromeTraceClockSync, cpuProfileStartBracket, traceLongTasks, traceLoafEntries);
        chromeTraceCaptured = true;
        chromeTracingStarted = false;
      } catch (error) {
        console.log('AV_HYDRATION_DEVTOOLS_TIMELINE_CAPTURE_FAILED', String(error));
      }
    }

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
    const authorizedMembership = await page.evaluate((expectedRows: number) => window.eval(`(() => {
      const ids = new Set(fullInventory.map(row => String(row.UNIQUE_ID || row.unique_id || '')));
      return { count: fullInventory.length, first: ids.has('av-hydration-00001'), last: ids.has('av-hydration-${String(expectedRows).padStart(5, '0')}') };
    })()`), SYNTHETIC_MASTER_ROWS);
    expect(authorizedMembership).toEqual({ count: SYNTHETIC_MASTER_ROWS, first: true, last: true });

    await page.waitForFunction(() => window.eval('!!window.__avHydrationTiming.completedLargeCacheKey'));
    const cachedRows = await page.evaluate(() => window.eval('loadCacheValue(window.__avHydrationTiming.completedLargeCacheKey).then(value => value?.rawRows?.length || 0)'));
    expect(cachedRows).toBe(SYNTHETIC_MASTER_ROWS);
    const legacyCacheSaved = await page.evaluate(() => window.eval('runPersistCurrentCacheNow()'));
    expect(legacyCacheSaved, 'legacy cache projection and storage must also remain bounded').toBe(true);
    const ownedCache = await page.evaluate(() => window.eval('loadFromCache().then(value => ({ rows:value?.data?.length || 0, ownerMatches:!!value?.meta?.owner && value.meta.owner === getPersistentInventoryCacheOwner() }))'));
    expect(ownedCache).toEqual({ rows:SYNTHETIC_MASTER_ROWS, ownerMatches:true });
    const full = await timingEvidence(page);
    await captureMilestone('full-verification', full);
    expect(full.master.fieldCoverage).toBe('browse');
    expect(full.master.rowCompleteness).toBe('complete');
    expect(full.previewRows).toBe(SYNTHETIC_MASTER_ROWS);
    assertFrontendUiTiming(expect.soft(Math.max(0, ...full.dataRenderDurationsMs, ...full.chunkCallbackDurationsMs,
      ...full.naturalRenderCycleDurationsMs)), test.info().project);
    expect.soft(Math.max(0, ...full.nonRenderLongTaskDurationsMs)).toBeLessThanOrEqual(250);
    expect(await search.inputValue()).toBe('AVH.00015');
    await expect(page.locator('#av-content [data-dom-id]').filter({ hasText: 'AVH.00015' }).first()).toBeVisible();

    const readsBeforeWarmRepeat = fixture.backgroundMasterReads;
    const warmCard = await page.locator('#av-content [data-dom-id]').first().elementHandle();
    expect(warmCard, 'a completed AV card is available before navigating away').not.toBeNull();
    const warmCardDomId = await warmCard!.getAttribute('data-dom-id');
    await page.locator('#global-header-inline-back').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await page.evaluate(() => window.eval('__armAvHydrationTiming()'));
    await page.locator('#home-sales-open-av').click();
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
    assertFrontendUiTiming(expect.soft(warm.openSalesAvDurationMs), test.info().project);
    assertFrontendUiTiming(expect.soft(Math.max(0, ...warm.dataRenderDurationsMs, ...warm.chunkCallbackDurationsMs,
      ...warm.naturalRenderCycleDurationsMs)), test.info().project);
    expect.soft(Math.max(0, ...warm.nonRenderLongTaskDurationsMs)).toBeLessThanOrEqual(250);
    expect(fixture.backgroundMasterReads).toBe(readsBeforeWarmRepeat);
    expect(warm.master.rowCompleteness).toBe('complete');
    expect(warm.verified).toBe(true);

    const partialCache = await page.evaluate(() => window.eval(`(async () => {
      const cacheKey=window.__avHydrationTiming.completedLargeCacheKey;
      if (!cacheKey) throw new Error('Verified master cache was not persisted');
      const saved=await loadCacheValue(cacheKey);
      if (saved?.format!=='verified-raw-v1' || !Array.isArray(saved.rawRows)) throw new Error('Verified master cache shape mismatch');
      const adapter={id:'core:master',projection:saved.projection};
      try {
        await saveCacheValue(cacheKey,{...saved,rawRows:saved.rawRows.slice(0,12),rowCount:12,rowCompleteness:'partial'});
        const display=await readProductionDisplaySnapshot(adapter,saved.meta);
        const verified=await readProductionVerifiedSnapshot(adapter,saved.meta);
        return {displayRejected:display===null,verifiedRejected:verified===null,fullRows:fullInventory.length};
      } finally { await saveCacheValue(cacheKey,saved); }
    })()`));
    expect(partialCache).toEqual({displayRejected:true,verifiedRejected:true,fullRows:SYNTHETIC_MASTER_ROWS});

    const evidence = {
      kind: 'isolated-client-render-fixture', datasetRows: SYNTHETIC_MASTER_ROWS,
      acceptedColdAvFirstCardLimitMs: 1000,
      acceptedAvDomRenderLimitMs: 2000,
      acceptedBackgroundLongTaskLimitMs: 250,
      environment: {
        nodeVersion: process.version,
        browserVersion: await page.context().browser()?.version(),
        viewport: page.viewportSize(),
        trace: 'off',
        screenshots: 'off',
        cpuProfile: cpuProfileEnabled ? 'enabled by AV_CPU_PROFILE=1' : 'disabled for acceptance timing',
        loafObserver: loafObserverStatus,
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
    if (chromeTraceSession && chromeTracingStarted && !chromeTraceCaptured) {
      try {
        const finalEvidence = await timingEvidence(page);
        const traceLongTasks = Array.isArray(finalEvidence.longTasks)
          ? finalEvidence.longTasks as Array<{ startTime: number; endTime: number; durationMs: number }> : [];
        const traceLoafEntries = Array.isArray(finalEvidence.longAnimationFrames)
          ? finalEvidence.longAnimationFrames as LoafDiagnosticEntry[] : [];
        await stopAndAttachChromeTimeline(chromeTraceSession, testInfo, chromeTraceClockSync, cpuProfileStartBracket, traceLongTasks, traceLoafEntries);
        chromeTraceCaptured = true;
      } catch (error) {
        console.log('AV_HYDRATION_DEVTOOLS_TIMELINE_CAPTURE_FAILED', String(error));
      }
    }
    if (cpuProfilerSession && cpuProfilerStarted) {
      try {
        const stopped = await cpuProfilerSession.send('Profiler.stop');
        cpuProfileWindowEnd = await page.evaluate(() => ({ timeOriginMs: performance.timeOrigin, pageTimeMs: performance.now() }));
        cpuProfileSummary = summarizeCpuProfile(stopped.profile);
        await persistAndAttach(testInfo, 'av-hydration-cpu-profile.json', JSON.stringify(stopped.profile), 'application/json');
        await persistAndAttach(testInfo, 'av-hydration-cpu-profile-summary.json', JSON.stringify(cpuProfileSummary, null, 2), 'application/json');
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
        await persistAndAttach(testInfo, 'av-hydration-cpu-profile-timeline.json', JSON.stringify({ sampleIntervalUs: 1000, cpuProfileWindowStart, cpuProfileStartBracket, cpuProfileWindowEnd,
            profileSampledMs: cpuProfileSummary.sampledMs,
            clock: 'Long-task and operation start/end times use page performance.now(); CPU samples use the adjacent CDP profile window. Async overlaps show wall-clock coincidence only; synchronous overlaps identify code executing on the main thread.',
            correlatedLongTasks, longTaskCpuAttribution }, null, 2), 'application/json');
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
