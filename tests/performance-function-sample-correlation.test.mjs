import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachAppApiSampleLogCorrelation,
  correlateAppApiSampleLogs,
  parseAppServerTimingDuration,
} from '../scripts/performance-function-sample-correlation.mjs';

const requestId = `perf-api-${'a'.repeat(32)}`;

test('correlates only measured app-api log records and returns allowlisted fields', () => {
  const records = [
    JSON.stringify({ request_id: 'perf-ready-0123456789abcdef0123456789abcdef', function: 'app-api', action: '__performance_readiness_probe__', status: 400 }),
    JSON.stringify({ request_id: requestId, function: 'kong', action: 'inventory_read', status: 200, duration_ms: 9 }),
    JSON.stringify({ request_id: requestId, function: 'app-api', action: 'inventory_read', status: 200, duration_ms: 182, authorization: 'secret', body: 'private data' }),
    JSON.stringify({ request_id: `perf-api-${'c'.repeat(32)}`, function: 'app-api', action: 'inventory_read', status: 200, duration_ms: 4 }),
  ].join('\n');

  const result = correlateAppApiSampleLogs(records, [
    { scenario: 'master.first', sample: 0, requestId },
    { scenario: 'master.first', sample: 1, requestId: `perf-api-${'b'.repeat(32)}` },
  ]);
  assert.deepEqual(result, {
    sampleCount: 2,
    matchedLogCount: 1,
    unsampledOrMissingLogCount: 1,
    duplicateLogCount: 0,
    malformedMatchedLogCount: 0,
    entries: [{ requestId, scenario: 'master.first', sample: 0, action: 'inventory_read', status: 200, durationMs: 182 }],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|private data/);
});

test('duplicate logs are marked ambiguous and are not attributed to a sample', () => {
  const log = JSON.stringify({ request_id: requestId, function: 'app-api', action: 'inventory_read', status: 200, duration_ms: 8 });
  const result = correlateAppApiSampleLogs(`${log}\n${log}`, [
    { scenario: 'queue.first', sample: 0, requestId },
  ]);
  assert.equal(result.matchedLogCount, 0);
  assert.equal(result.duplicateLogCount, 1);
  assert.equal(result.unsampledOrMissingLogCount, 1);
});

test('malformed matching records and nonmatching log text do not leak into output', () => {
  const log = [
    `not json secret=do-not-copy`,
    JSON.stringify({ request_id: requestId, function: 'app-api', action: 'inventory_read', status: 200, duration_ms: 'slow', authorization: 'secret' }),
  ].join('\n');
  const result = correlateAppApiSampleLogs(log, [
    { scenario: 'queue.first', sample: 0, requestId },
  ]);
  assert.equal(result.malformedMatchedLogCount, 1);
  assert.equal(result.matchedLogCount, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret|slow|do-not-copy/);
});

test('rejects unsafe request maps and oversized log input', () => {
  assert.throws(() => correlateAppApiSampleLogs('', [{ scenario: 's', sample: 0, requestId: 'invalid' }]), /PERFORMANCE_FUNCTION_SAMPLE_ID_INVALID/);
  assert.throws(() => correlateAppApiSampleLogs('', [
    { scenario: 's', sample: 0, requestId },
    { scenario: 'other', sample: 0, requestId },
  ]), /PERFORMANCE_FUNCTION_SAMPLE_ID_INVALID/);
  assert.throws(() => correlateAppApiSampleLogs('x'.repeat(4 * 1024 * 1024 + 1), []), /PERFORMANCE_FUNCTION_LOG_INPUT_INVALID/);
});

test('parses only one finite app Server-Timing duration', () => {
  assert.equal(parseAppServerTimingDuration(null), null);
  assert.equal(parseAppServerTimingDuration('db;dur=4.2'), null);
  assert.equal(parseAppServerTimingDuration('app;dur=182.45'), 182.45);
  assert.equal(parseAppServerTimingDuration('db;dur=4.2, app;dur=182.45'), 182.45);
  for (const malformed of [
    'app;dur=NaN', 'app;dur=Infinity', 'app;dur=-1', 'app;dur=30001',
    'app', 'app;duration=4', 'app;dur=2, app;dur=3', 'app;dur=1ms',
  ]) assert.equal(parseAppServerTimingDuration(malformed), null, malformed);
});

test('attaches correlations from the actual benchmark report scenario shape', () => {
  const secondId = `perf-api-${'b'.repeat(32)}`;
  const report = { diagnostics: {
    apiSampleDiagnostics: { perScenario: { 'queue.first': 2 } },
    scenarios: [
      { scenario: 'fixture.10k.physical-relation-size', rows: 10 },
      { scenario: 'queue.first', apiSampleDiagnostics: [
        { sample: 0, requestId, responseRequestId: requestId, responseStatus: 200 },
        { sample: 1, requestId: secondId, responseRequestId: secondId, responseStatus: 200 },
      ] },
    ],
  } };
  const log = JSON.stringify({ request_id: requestId, function: 'app-api', action: 'inventory_read', status: 200, duration_ms: 140 });
  const attached = attachAppApiSampleLogCorrelation(report, {
    text: log, bytesRead: Buffer.byteLength(log), totalBytes: Buffer.byteLength(log), truncated: false, unavailable: false,
  });
  assert.equal(report.diagnostics.functionLogCorrelation, undefined, 'preserves the source report');
  assert.equal(attached.diagnostics.functionLogCorrelation.sampleCount, 2);
  assert.equal(attached.diagnostics.functionLogCorrelation.matchedLogCount, 1);
  assert.equal(attached.diagnostics.functionLogCorrelation.responseEchoMatchCount, 2);
  assert.equal(attached.diagnostics.functionLogCorrelation.entries[0].scenario, 'queue.first');
  assert.equal(attached.diagnostics.functionLogCorrelation.entries[0].sample, 0);
  assert.throws(() => attachAppApiSampleLogCorrelation({
    diagnostics: { apiSampleDiagnostics: { perScenario: { 'queue.first': 2 } }, scenarios: report.diagnostics.scenarios.slice(0, 1) },
  }, { text: '', bytesRead: 0, totalBytes: 0, truncated: false, unavailable: false }), /PERFORMANCE_API_SAMPLE_DIAGNOSTICS_INCOMPLETE/);
});
