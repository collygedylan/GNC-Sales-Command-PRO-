import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { correlateAppApiSampleLogs } from './performance-function-sample-correlation.mjs';

const REQUEST_ID = /^perf-api-[a-f0-9]{32}$/;
const SCENARIO = /^[a-z0-9_.-]{1,160}$/;
const ERROR_CODE = /^[A-Z0-9_]{1,80}$/;
const FAILURE_KEYS = [
  'scenario', 'sample', 'requestId', 'responseStatus', 'responseEchoMatched',
  'applicationErrorCode', 'responseBytes', 'responseMs', 'headersMs', 'bodyReadMs', 'appServerDurationMs',
].sort();

function validDuration(value) {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 30_000);
}

/** Construct a payload-free measured HTTP failure record for the parent runner. */
export function createApiFailureDiagnostic(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('PERFORMANCE_API_FAILURE_DIAGNOSTIC_INVALID');
  const record = {
    scenario: input.scenario,
    sample: input.sample,
    requestId: input.requestId,
    responseStatus: input.responseStatus,
    responseEchoMatched: input.responseEchoMatched,
    applicationErrorCode: input.applicationErrorCode,
    responseBytes: input.responseBytes,
    responseMs: input.responseMs,
    headersMs: input.headersMs,
    bodyReadMs: input.bodyReadMs,
    appServerDurationMs: input.appServerDurationMs,
  };
  if (typeof record.scenario !== 'string' || !SCENARIO.test(record.scenario)
      || !Number.isSafeInteger(record.sample) || record.sample < 0 || record.sample > 129
      || typeof record.requestId !== 'string' || !REQUEST_ID.test(record.requestId)
      || !Number.isInteger(record.responseStatus) || record.responseStatus < 100 || record.responseStatus > 599
      || typeof record.responseEchoMatched !== 'boolean'
      || typeof record.applicationErrorCode !== 'string' || !ERROR_CODE.test(record.applicationErrorCode)
      || !Number.isSafeInteger(record.responseBytes) || record.responseBytes < 0 || record.responseBytes > 10_000_000
      || !validDuration(record.responseMs) || !validDuration(record.headersMs)
      || !validDuration(record.bodyReadMs) || !validDuration(record.appServerDurationMs)) {
    throw new Error('PERFORMANCE_API_FAILURE_DIAGNOSTIC_INVALID');
  }
  return Object.freeze(record);
}

function checkedFailurePath(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)
      || !/^failed-api-sample-\d{2}\.json$/.test(path.basename(filePath))) {
    throw new Error('PERFORMANCE_API_FAILURE_PATH_INVALID');
  }
  const parent = path.dirname(filePath);
  const parentInfo = lstatSync(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()
      || !/^gnc-performance-api-[a-zA-Z0-9-]+$/.test(path.basename(parent))) {
    throw new Error('PERFORMANCE_API_FAILURE_PATH_INVALID');
  }
  const realParent = realpathSync(parent);
  const realTemp = realpathSync(os.tmpdir());
  const relative = path.relative(realTemp, realParent);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || path.resolve(parent) !== realParent) throw new Error('PERFORMANCE_API_FAILURE_PATH_INVALID');
  return path.join(realParent, path.basename(filePath));
}

/** Write one mode-0600 failure sidecar inside the runner's private temporary directory. */
export function writeApiFailureDiagnosticFile(filePath, input) {
  const target = checkedFailurePath(filePath);
  writeFileSync(target, `${JSON.stringify(createApiFailureDiagnostic(input))}\n`, { flag: 'wx', mode: 0o600 });
}

/** Read only a small regular sidecar; a missing or unsafe path yields no diagnostic. */
export function readApiFailureDiagnosticFile(filePath) {
  try {
    const target = checkedFailurePath(filePath);
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024) return null;
    const input = JSON.parse(readFileSync(target, 'utf8'));
    if (Object.keys(input || {}).sort().join('\0') !== FAILURE_KEYS.join('\0')) return null;
    return createApiFailureDiagnostic(input);
  } catch {
    return null;
  }
}

/** Correlate just the failed request; project function logs to an allowlist. */
export function correlateApiFailureWithFunctionLog(failure, logEvidence) {
  const safe = createApiFailureDiagnostic(failure);
  if (!logEvidence || typeof logEvidence.text !== 'string') throw new Error('PERFORMANCE_API_FAILURE_LOG_INVALID');
  const correlation = correlateAppApiSampleLogs(logEvidence.text, [
    { scenario: safe.scenario, sample: safe.sample, requestId: safe.requestId },
  ]);
  return Object.freeze({
    functionLog: Object.freeze({
      matchedLogCount: correlation.matchedLogCount,
      missingOrUnsampledLogCount: correlation.unsampledOrMissingLogCount,
      duplicateLogCount: correlation.duplicateLogCount,
      malformedMatchedLogCount: correlation.malformedMatchedLogCount,
      logBytesRead: Number.isSafeInteger(logEvidence.bytesRead) ? logEvidence.bytesRead : 0,
      logTotalBytes: Number.isSafeInteger(logEvidence.totalBytes) ? logEvidence.totalBytes : null,
      logTruncated: logEvidence.truncated === true,
      logUnavailable: logEvidence.unavailable === true,
      entries: Object.freeze(correlation.entries.map(({ scenario, sample, action, status, durationMs }) =>
        Object.freeze({ scenario, sample, action, status, durationMs }))),
    }),
  });
}
