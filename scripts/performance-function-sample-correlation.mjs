const REQUEST_ID = /^perf-api-[a-f0-9]{32}$/;
const MAX_SAMPLE_COUNT = 4096;
const MAX_LOG_BYTES = 4 * 1024 * 1024;

/** Parse the diagnostic `app;dur=N` metric without treating malformed data as a measurement. */
export function parseAppServerTimingDuration(header) {
  if (typeof header !== 'string' || header.length > 2048) return null;
  const matches = [];
  for (const metric of header.split(',')) {
    const parts = metric.split(';').map(part => part.trim());
    if (parts[0]?.toLowerCase() !== 'app') continue;
    const duration = parts.slice(1).find(part => /^dur=/i.test(part));
    if (!duration) return null;
    const rawValue = duration.slice(duration.indexOf('=') + 1);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawValue)) return null;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > 30_000) return null;
    matches.push(value);
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Match only request logs emitted by this app-api measurement pass. Function
 * logs are intentionally sampled, so absence of a matching line is expected.
 * The returned artifact contains a small allowlist of fields and never copies
 * arbitrary log content.
 */
export function correlateAppApiSampleLogs(logText, samples) {
  if (typeof logText !== 'string' || Buffer.byteLength(logText) > MAX_LOG_BYTES
      || !Array.isArray(samples) || samples.length > MAX_SAMPLE_COUNT) {
    throw new Error('PERFORMANCE_FUNCTION_LOG_INPUT_INVALID');
  }

  const byRequestId = new Map();
  for (const sample of samples) {
    if (!sample || typeof sample.scenario !== 'string' || !sample.scenario
        || !Number.isSafeInteger(sample.sample) || sample.sample < 0
        || typeof sample.requestId !== 'string' || !REQUEST_ID.test(sample.requestId)
        || byRequestId.has(sample.requestId)) {
      throw new Error('PERFORMANCE_FUNCTION_SAMPLE_ID_INVALID');
    }
    byRequestId.set(sample.requestId, { scenario: sample.scenario, sample: sample.sample });
  }

  const matches = new Map();
  const duplicateRequestIds = new Set();
  let malformedMatchedLogCount = 0;
  for (const line of logText.split(/\r?\n/)) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    let entry;
    try { entry = JSON.parse(line.slice(start)); } catch { continue; }
    const requestId = entry?.request_id;
    if (!byRequestId.has(requestId) || entry?.function !== 'app-api') continue;
    if (matches.has(requestId) || duplicateRequestIds.has(requestId)) {
      matches.delete(requestId);
      duplicateRequestIds.add(requestId);
      continue;
    }
    const action = entry.action;
    const status = entry.status;
    const durationMs = entry.duration_ms;
    if (typeof action !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(action)
        || !Number.isInteger(status) || status < 100 || status > 599
        || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 30_000) {
      malformedMatchedLogCount += 1;
      continue;
    }
    matches.set(requestId, {
      requestId,
      ...byRequestId.get(requestId),
      action,
      status,
      durationMs,
    });
  }

  const entries = [...matches.values()].sort((left, right) =>
    left.scenario.localeCompare(right.scenario) || left.sample - right.sample);
  return {
    sampleCount: samples.length,
    matchedLogCount: entries.length,
    unsampledOrMissingLogCount: samples.length - entries.length,
    duplicateLogCount: duplicateRequestIds.size,
    malformedMatchedLogCount,
    entries,
  };
}

/** Attach bounded request/log correlations to the existing per-pass report shape. */
export function attachAppApiSampleLogCorrelation(report, logEvidence) {
  const scenarioEvidence = report?.diagnostics?.scenarios;
  const perScenarioCounts = report?.diagnostics?.apiSampleDiagnostics?.perScenario;
  if (!Array.isArray(scenarioEvidence) || !scenarioEvidence.length
      || !perScenarioCounts || typeof perScenarioCounts !== 'object' || Array.isArray(perScenarioCounts)
      || !logEvidence || typeof logEvidence.text !== 'string') {
    throw new Error('PERFORMANCE_API_SAMPLE_DIAGNOSTICS_MISSING');
  }
  const measured = new Map(scenarioEvidence
    .filter(entry => Array.isArray(entry?.apiSampleDiagnostics))
    .map(entry => [entry.scenario, entry.apiSampleDiagnostics]));
  const expectedScenarios = Object.keys(perScenarioCounts).sort();
  if (expectedScenarios.length !== measured.size
      || expectedScenarios.some(scenario => !measured.has(scenario)
        || measured.get(scenario).length !== perScenarioCounts[scenario])) {
    throw new Error('PERFORMANCE_API_SAMPLE_DIAGNOSTICS_INCOMPLETE');
  }
  const samples = [];
  let responseEchoMatchCount = 0;
  let responseEchoMismatchCount = 0;
  for (const [scenario, rows] of measured) {
    for (const row of rows) {
      samples.push({ scenario, sample: row.sample, requestId: row.requestId });
      if (row.responseRequestId === row.requestId) responseEchoMatchCount += 1;
      else responseEchoMismatchCount += 1;
    }
  }
  const correlation = correlateAppApiSampleLogs(logEvidence.text, samples);
  return {
    ...report,
    diagnostics: { ...report.diagnostics, functionLogCorrelation: {
      ...correlation,
      responseEchoMatchCount,
      responseEchoMismatchCount,
      logBytesRead: logEvidence.bytesRead,
      logTotalBytes: logEvidence.totalBytes,
      logTruncated: logEvidence.truncated,
      logUnavailable: logEvidence.unavailable,
      sampleRate: 0.01,
      method: 'Matches only app-api function log records by per-sample x-request-id. Successful requests may have no log because success logging is sampled at 1%; benchmark request/response metrics are unchanged.',
    } },
  };
}
