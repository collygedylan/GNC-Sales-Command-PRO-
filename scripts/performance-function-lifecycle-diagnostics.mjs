const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_SAMPLES = 4096;
const MAX_EVENTS = 256;
const READINESS_ID = /^perf-ready-[a-f0-9]{32}$/;
const EVENT_KINDS = Object.freeze({
  cpuSoftLimit: /\bcpu\b.{0,100}\bsoft\b.{0,60}\blimit\b|\bsoft\b.{0,60}\bcpu\b.{0,100}\blimit\b/i,
  cpuHardLimit: /\bcpu\b.{0,100}\bhard\b.{0,60}\blimit\b|\bhard\b.{0,60}\bcpu\b.{0,100}\blimit\b/i,
  booted: /\bbooted\s*(?:\(|\b)/i,
  memoryLimit: /\b(?:memory|mem)\b.{0,100}\blimit\b|\b(?:out of memory|oom killed|memory limit exceeded)\b/i,
  wallClockLimit: /\bwall[ -]?clock\b.{0,100}\blimit\b|\bwall[ -]?clock limit exceeded\b/i,
});
const EVENT_COUNT_KEYS = Object.freeze(Object.keys(EVENT_KINDS));
const SAMPLE_NAME = /^[A-Za-z0-9._-]{1,160}$/;
const MEASURED_REQUEST_ID = /^perf-api-[a-f0-9]{32}$/;

function measuredSamples(report) {
  const scenarios = report?.diagnostics?.scenarios;
  const perScenario = report?.diagnostics?.apiSampleDiagnostics?.perScenario;
  if (!Array.isArray(scenarios) || !scenarios.length || !perScenario
      || typeof perScenario !== 'object' || Array.isArray(perScenario)) {
    throw new Error('PERFORMANCE_FUNCTION_LIFECYCLE_REPORT_INVALID');
  }
  const byScenario = new Map(scenarios.filter(row => Array.isArray(row?.apiSampleDiagnostics))
    .map(row => [row.scenario, row.apiSampleDiagnostics]));
  const names = Object.keys(perScenario);
  if (names.length !== byScenario.size || names.some(name => !byScenario.has(name)
      || !SAMPLE_NAME.test(name) || byScenario.get(name).length !== perScenario[name])) {
    throw new Error('PERFORMANCE_FUNCTION_LIFECYCLE_SAMPLES_INCOMPLETE');
  }
  const result = [];
  const ids = new Set();
  for (const [scenario, rows] of byScenario) {
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.sample) || row.sample < 0
          || typeof row.requestId !== 'string' || !MEASURED_REQUEST_ID.test(row.requestId)
          || ids.has(row.requestId) || !Number.isFinite(row.requestStartMs) || row.requestStartMs < 0) {
        throw new Error('PERFORMANCE_FUNCTION_LIFECYCLE_SAMPLE_INVALID');
      }
      ids.add(row.requestId);
      result.push({ scenario, sample: row.sample, requestStartMs: row.requestStartMs });
    }
  }
  if (result.length > MAX_SAMPLES) throw new Error('PERFORMANCE_FUNCTION_LIFECYCLE_SAMPLE_LIMIT');
  result.sort((left, right) => left.requestStartMs - right.requestStartMs);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index].requestStartMs <= result[index - 1].requestStartMs) {
      throw new Error('PERFORMANCE_FUNCTION_LIFECYCLE_SAMPLE_ORDER_INVALID');
    }
  }
  return result;
}

function readinessMarker(line, requestId) {
  const start = line.indexOf('{');
  if (start < 0) return false;
  try {
    const entry = JSON.parse(line.slice(start));
    return entry?.request_id === requestId && entry?.function === 'app-api'
      && entry?.action === '__performance_readiness_probe__' && entry?.status === 400;
  } catch { return false; }
}

function isAppApiDispatch(line) {
  return /\bserving the request with\b[^\r\n]*[\\/]app-api(?:[\\/\s'"`]|$)/i.test(line);
}

function matchedEvent(line) {
  for (const [kind, pattern] of Object.entries(EVENT_KINDS)) {
    if (pattern.test(line)) return kind;
  }
  return null;
}

/**
 * Extract lifecycle counts from a bounded local function-server log. Request
 * ordinals are mapped only when one exact readiness marker is followed by
 * exactly the measured dispatch count; otherwise records remain unmapped.
 */
export function parseFunctionLifecycleDiagnostics(logEvidence, report, readinessRequestId) {
  if (!logEvidence || typeof logEvidence.text !== 'string'
      || Buffer.byteLength(logEvidence.text) > MAX_LOG_BYTES
      || typeof logEvidence.bytesRead !== 'number' || !Number.isSafeInteger(logEvidence.bytesRead)
      || logEvidence.bytesRead < 0 || logEvidence.bytesRead > MAX_LOG_BYTES
      || typeof logEvidence.truncated !== 'boolean' || typeof logEvidence.unavailable !== 'boolean'
      || typeof readinessRequestId !== 'string' || !READINESS_ID.test(readinessRequestId)) {
    throw new Error('PERFORMANCE_FUNCTION_LIFECYCLE_INPUT_INVALID');
  }
  const samples = measuredSamples(report);
  const lines = logEvidence.text.split(/\r?\n/);
  const readinessLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (readinessMarker(lines[index], readinessRequestId)) readinessLines.push(index);
  }
  const readinessLine = readinessLines.length === 1 ? readinessLines[0] : -1;
  const dispatches = [];
  if (readinessLine >= 0 && !logEvidence.truncated && !logEvidence.unavailable) {
    for (let index = readinessLine + 1; index < lines.length; index += 1) {
      if (isAppApiDispatch(lines[index])) dispatches.push(index);
    }
  }
  const mappingReliable = readinessLines.length === 1 && readinessLine >= 0
    && !logEvidence.truncated && !logEvidence.unavailable && dispatches.length === samples.length;
  const sampleByOrdinal = mappingReliable
    ? samples.map(({ scenario, sample }) => ({ scenario, sample }))
    : [];
  const dispatchOrdinalByLine = new Map(dispatches.map((lineIndex, ordinal) => [lineIndex, ordinal]));
  const counts = Object.fromEntries(EVENT_COUNT_KEYS.map(key => [key, 0]));
  const events = [];
  let droppedEventCount = 0;
  let currentDispatchOrdinal = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (dispatchOrdinalByLine.has(index)) currentDispatchOrdinal = dispatchOrdinalByLine.get(index);
    const kind = matchedEvent(lines[index]);
    if (!kind) continue;
    counts[kind] += 1;
    if (events.length >= MAX_EVENTS) { droppedEventCount += 1; continue; }
    const mappedSample = mappingReliable && currentDispatchOrdinal >= 0
      ? sampleByOrdinal[currentDispatchOrdinal] : null;
    events.push({
      kind,
      lineOrdinal: index,
      dispatchOrdinal: mappingReliable && currentDispatchOrdinal >= 0 ? currentDispatchOrdinal : null,
      scenario: mappedSample?.scenario ?? null,
      sample: mappedSample?.sample ?? null,
    });
  }
  return {
    eventCounts: counts,
    eventCount: Object.values(counts).reduce((sum, value) => sum + value, 0),
    events,
    droppedEventCount,
    readinessMarkerCount: readinessLines.length,
    expectedMeasuredDispatchCount: samples.length,
    dispatchCountAfterReadiness: dispatches.length,
    dispatchSampleMapping: mappingReliable ? 'exact-readiness-suffix' : 'unmapped',
    logBytesRead: logEvidence.bytesRead,
    logTotalBytes: Number.isSafeInteger(logEvidence.totalBytes) && logEvidence.totalBytes >= 0
      ? logEvidence.totalBytes : null,
    logTruncated: logEvidence.truncated,
    logUnavailable: logEvidence.unavailable,
    method: 'Counts only allowlisted Edge Runtime lifecycle log phrases. Dispatch ordinals map to measured samples only when one exact readiness-log marker is followed by exactly the full measured request count; this is line-order correlation, not a request-ID lifecycle trace.',
  };
}

export function attachFunctionLifecycleDiagnostics(report, logEvidence, readinessRequestId) {
  if (!report || typeof report !== 'object' || !report.diagnostics || typeof report.diagnostics !== 'object') {
    throw new Error('PERFORMANCE_FUNCTION_LIFECYCLE_REPORT_INVALID');
  }
  return {
    ...report,
    diagnostics: {
      ...report.diagnostics,
      functionLifecycle: parseFunctionLifecycleDiagnostics(logEvidence, report, readinessRequestId),
    },
  };
}
