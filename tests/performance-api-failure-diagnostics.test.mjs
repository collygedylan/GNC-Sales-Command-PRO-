// @test-group: foundation
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  correlateApiFailureWithFunctionLog,
  createApiFailureDiagnostic,
  readApiFailureDiagnosticFile,
  writeApiFailureDiagnosticFile,
} from '../scripts/performance-api-failure-diagnostics.mjs';

const requestId = `perf-api-${'a'.repeat(32)}`;
const failure = overrides => createApiFailureDiagnostic({
  scenario: 'lookup.10k.admin.first.dataset-10k',
  sample: 0,
  requestId,
  responseStatus: 502,
  responseEchoMatched: false,
  applicationErrorCode: 'UNKNOWN',
  responseBytes: 21,
  responseMs: 187.25,
  headersMs: 182.5,
  bodyReadMs: 4.75,
  appServerDurationMs: null,
  ...overrides,
});

test('failed-request diagnostics retain bounded allowlisted metadata only', () => {
  const record = failure({ authorization: 'secret', body: 'private response', requestId });
  assert.deepEqual(Object.keys(record).sort(), [
    'applicationErrorCode', 'appServerDurationMs', 'bodyReadMs', 'headersMs', 'requestId',
    'responseBytes', 'responseEchoMatched', 'responseMs', 'responseStatus', 'sample', 'scenario',
  ].sort());
  assert.doesNotMatch(JSON.stringify(record), /secret|private response/);
  for (const bad of [
    { scenario: {} }, { requestId: {} }, { applicationErrorCode: {} }, { sample: 130 },
    { responseStatus: 99 }, { responseStatus: Number.NaN }, { responseStatus: undefined },
    { responseStatus: '502' }, { responseStatus: {} },
    { responseBytes: 10_000_001 }, { responseMs: Infinity },
  ]) assert.throws(() => failure(bad), /PERFORMANCE_API_FAILURE_DIAGNOSTIC_INVALID/);
});

test('failure sidecar is exclusive, private and constrained to its owned temp directory', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'gnc-performance-api-test-'));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.match(path.basename(directory), /^gnc-performance-api-test-/);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'failed-api-sample-01.json');
  writeApiFailureDiagnosticFile(target, failure());
  assert.deepEqual(readApiFailureDiagnosticFile(target), failure());
  if (process.platform !== 'win32') assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.throws(() => writeApiFailureDiagnosticFile(target, failure()), /EEXIST/);
  assert.throws(() => writeApiFailureDiagnosticFile(path.join(directory, 'other.json'), failure()), /PATH_INVALID/);
  assert.equal(readApiFailureDiagnosticFile(path.join(directory, 'missing.json')), null);
});

test('failure log correlation distinguishes a logged handler response from a missing gateway response', () => {
  const rawLog = JSON.stringify({ request_id: requestId, function: 'app-api', action: 'inventory_read',
    status: 502, duration_ms: 181, authorization: 'secret', body: 'private payload' });
  const correlated = correlateApiFailureWithFunctionLog(failure(), {
    text: rawLog, bytesRead: Buffer.byteLength(rawLog), totalBytes: Buffer.byteLength(rawLog), truncated: false, unavailable: false,
  });
  assert.equal(correlated.functionLog.matchedLogCount, 1);
  assert.deepEqual(correlated.functionLog.entries, [{ scenario: failure().scenario, sample: 0,
    action: 'inventory_read', status: 502, durationMs: 181 }]);
  assert.doesNotMatch(JSON.stringify(correlated), /secret|private payload|perf-api-/);

  const unmatched = correlateApiFailureWithFunctionLog(failure(), {
    text: JSON.stringify({ request_id: 'perf-api-elsewhere', function: 'app-api', action: 'inventory_read', status: 502, duration_ms: 1 }),
    bytesRead: 1, totalBytes: 1, truncated: false, unavailable: false,
  });
  assert.equal(unmatched.functionLog.matchedLogCount, 0);
  assert.equal(unmatched.functionLog.missingOrUnsampledLogCount, 1);
});
