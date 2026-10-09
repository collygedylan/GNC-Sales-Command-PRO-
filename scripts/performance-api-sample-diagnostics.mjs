import { PerformanceObserver, performance } from 'node:perf_hooks';

export const MAX_API_GC_DIAGNOSTICS = 4096;

function finiteTimestamp(value) {
  return Number.isFinite(value) && value >= 0;
}

function validInterval(start, end) {
  return finiteTimestamp(start) && finiteTimestamp(end) && end >= start;
}

/** Return the nonnegative overlap between two half-open monotonic intervals. */
export function intervalOverlapMs(startA, endA, startB, endB) {
  if (!validInterval(startA, endA) || !validInterval(startB, endB)) return 0;
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function safeUtilization(start, end, measure) {
  try {
    const value = measure(start, end)?.utilization;
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  } catch {
    return null;
  }
}

function gcEntry(entry) {
  const startTime = Number(entry?.startTime);
  const duration = Number(entry?.duration);
  if (!finiteTimestamp(startTime) || !Number.isFinite(duration) || duration < 0) return null;
  const rawKind = entry?.detail?.kind;
  return {
    startTime,
    duration,
    kind: Number.isSafeInteger(rawKind) && rawKind >= 0 ? rawKind : null,
  };
}

/**
 * Collect bounded, payload-free diagnostics around API samples. This observer
 * never changes request scheduling or the benchmark's response_ms boundaries.
 */
export function createApiSampleDiagnostics({
  now = () => performance.now(),
  snapshotEventLoopUtilization = () => performance.eventLoopUtilization(),
  measureEventLoopUtilization = (start, end) => performance.eventLoopUtilization(start, end),
  Observer = PerformanceObserver,
  maxGcEntries = MAX_API_GC_DIAGNOSTICS,
} = {}) {
  if (!Number.isSafeInteger(maxGcEntries) || maxGcEntries < 1) throw new Error('PERFORMANCE_API_DIAGNOSTICS_LIMIT_INVALID');
  const origin = now();
  const gcEntries = [];
  const samplesByScenario = new Map();
  let droppedGcEntries = 0;
  let observer = null;
  let observerAvailable = false;

  const ingest = entries => {
    for (const entry of entries || []) {
      const normalized = gcEntry(entry);
      if (!normalized) continue;
      if (gcEntries.length >= maxGcEntries) {
        droppedGcEntries += 1;
        continue;
      }
      gcEntries.push(normalized);
    }
  };

  try {
    observer = new Observer(list => ingest(list.getEntries()));
    observer.observe({ entryTypes: ['gc'] });
    observerAvailable = true;
  } catch {
    try { observer?.disconnect(); } catch { /* Optional diagnostics only. */ }
    observer = null;
  }

  function recordSample({ scenario, sampleIndex, requestStartedAt, headersAt, bodyReadStartedAt,
    bodyCompleteAt, decodeStartedAt, decodeEndedAt, validationStartedAt, validationEndedAt,
    requestEluStart, requestEluEnd, decodeEluStart, decodeEluEnd, validationEluStart, validationEluEnd,
    requestId, responseRequestId, responseStatus, appServerDurationMs }) {
    if (typeof scenario !== 'string' || !scenario || !Number.isSafeInteger(sampleIndex) || sampleIndex < 0
        || typeof requestId !== 'string' || !/^perf-api-[a-f0-9]{32}$/.test(requestId)
        || (responseRequestId !== null && (typeof responseRequestId !== 'string' || responseRequestId.length > 96))
        || !Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599
        || (appServerDurationMs !== null && (!Number.isFinite(appServerDurationMs) || appServerDurationMs < 0 || appServerDurationMs > 30_000))
        || !validInterval(requestStartedAt, headersAt) || !validInterval(headersAt, bodyReadStartedAt)
        || !validInterval(bodyReadStartedAt, bodyCompleteAt) || !validInterval(bodyCompleteAt, decodeStartedAt)
        || !validInterval(decodeStartedAt, decodeEndedAt) || !validInterval(decodeEndedAt, validationStartedAt)
        || !validInterval(validationStartedAt, validationEndedAt)) {
      throw new Error('PERFORMANCE_API_SAMPLE_DIAGNOSTIC_INVALID');
    }
    const rows = samplesByScenario.get(scenario) || [];
    if (rows.some(row => row.sample === sampleIndex)) throw new Error('PERFORMANCE_API_SAMPLE_DIAGNOSTIC_DUPLICATE');
    rows.push({
      sample: sampleIndex,
      requestId,
      responseRequestId,
      responseStatus,
      appServerDurationMs,
      requestStartMs: requestStartedAt - origin,
      headersAtMs: headersAt - origin,
      bodyReadStartMs: bodyReadStartedAt - origin,
      responseCompleteMs: bodyCompleteAt - origin,
      decodeStartMs: decodeStartedAt - origin,
      decodeEndMs: decodeEndedAt - origin,
      validationStartMs: validationStartedAt - origin,
      validationEndMs: validationEndedAt - origin,
      responseMs: bodyCompleteAt - requestStartedAt,
      headersMs: headersAt - requestStartedAt,
      bodyReadMs: bodyCompleteAt - bodyReadStartedAt,
      decodeMs: decodeEndedAt - decodeStartedAt,
      validationMs: validationEndedAt - validationStartedAt,
      requestEventLoopUtilization: safeUtilization(requestEluStart, requestEluEnd, measureEventLoopUtilization),
      decodeEventLoopUtilization: safeUtilization(decodeEluStart, decodeEluEnd, measureEventLoopUtilization),
      validationEventLoopUtilization: safeUtilization(validationEluStart, validationEluEnd, measureEventLoopUtilization),
      _requestInterval: [requestStartedAt, bodyCompleteAt],
      _decodeInterval: [decodeStartedAt, decodeEndedAt],
      _validationInterval: [validationStartedAt, validationEndedAt],
    });
    samplesByScenario.set(scenario, rows);
  }

  function collectGcEntries() {
    if (!observer) return;
    try {
      const pending = observer.takeRecords();
      ingest(Array.isArray(pending) ? pending : pending?.getEntries?.());
    }
    catch { /* Observer implementations may not expose takeRecords. */ }
  }

  function finalize() {
    collectGcEntries();
    try { observer?.disconnect(); } catch { /* Already disconnected. */ }
    observer = null;
    const scenarios = {};
    for (const [scenario, samples] of samplesByScenario) {
      scenarios[scenario] = samples.sort((left, right) => left.sample - right.sample).map(sample => {
        const [requestStart, requestEnd] = sample._requestInterval;
        const [decodeStart, decodeEnd] = sample._decodeInterval;
        const [validationStart, validationEnd] = sample._validationInterval;
        const requestGcOverlaps = [];
        const decodeGcOverlaps = [];
        const validationGcOverlaps = [];
        for (const event of gcEntries) {
          const requestOverlap = intervalOverlapMs(requestStart, requestEnd, event.startTime, event.startTime + event.duration);
          if (requestOverlap > 0) requestGcOverlaps.push({ kind: event.kind, overlapMs: requestOverlap, durationMs: event.duration });
          const decodeOverlap = intervalOverlapMs(decodeStart, decodeEnd, event.startTime, event.startTime + event.duration);
          if (decodeOverlap > 0) decodeGcOverlaps.push({ kind: event.kind, overlapMs: decodeOverlap, durationMs: event.duration });
          const validationOverlap = intervalOverlapMs(validationStart, validationEnd, event.startTime, event.startTime + event.duration);
          if (validationOverlap > 0) validationGcOverlaps.push({ kind: event.kind, overlapMs: validationOverlap, durationMs: event.duration });
        }
        const { _requestInterval, _decodeInterval, _validationInterval, ...visible } = sample;
        return {
          ...visible,
          headersMinusAppMs: visible.appServerDurationMs === null
            ? null : visible.headersMs - visible.appServerDurationMs,
          requestGcOverlapMs: requestGcOverlaps.reduce((sum, event) => sum + event.overlapMs, 0),
          decodeGcOverlapMs: decodeGcOverlaps.reduce((sum, event) => sum + event.overlapMs, 0),
          validationGcOverlapMs: validationGcOverlaps.reduce((sum, event) => sum + event.overlapMs, 0),
          requestGcOverlaps,
          decodeGcOverlaps,
          validationGcOverlaps,
        };
      });
    }
    return {
      observerAvailable,
      gcEntryLimit: maxGcEntries,
      gcEntriesObserved: gcEntries.length,
      gcEntriesDropped: droppedGcEntries,
      scenarios,
    };
  }

  function close() {
    collectGcEntries();
    try { observer?.disconnect(); } catch { /* Best-effort cleanup on failure paths. */ }
    observer = null;
  }

  return {
    now,
    snapshotEventLoopUtilization,
    recordSample,
    finalize,
    close,
  };
}
