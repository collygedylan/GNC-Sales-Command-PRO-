import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachFunctionLifecycleDiagnostics,
  parseFunctionLifecycleDiagnostics,
} from '../scripts/performance-function-lifecycle-diagnostics.mjs';

const readyId = `perf-ready-${'a'.repeat(32)}`;
const samples = [
  { scenario: 'queue.first', sample: 0, requestId: `perf-api-${'1'.repeat(32)}`, requestStartMs: 10 },
  { scenario: 'master.deep', sample: 0, requestId: `perf-api-${'2'.repeat(32)}`, requestStartMs: 20 },
];
const report = () => ({ diagnostics: {
  apiSampleDiagnostics: { perScenario: { 'queue.first': 1, 'master.deep': 1 } },
  scenarios: samples.map(sample => ({ scenario: sample.scenario, apiSampleDiagnostics: [sample] })),
} });
const logEvidence = text => ({
  text,
  bytesRead: Buffer.byteLength(text),
  totalBytes: Buffer.byteLength(text),
  truncated: false,
  unavailable: false,
});
const dispatch = 'Serving the request with functions/v1/app-api';
const readiness = `{"request_id":"${readyId}","function":"app-api","action":"__performance_readiness_probe__","status":400}`;

test('maps allowlisted lifecycle events only after exact readiness and full dispatch suffix', () => {
  const text = [
    'Edge Runtime booted (32ms)',
    dispatch,
    readiness,
    dispatch,
    'CPU soft limit reached',
    dispatch,
    'Memory limit exceeded',
    'Wall-clock limit exceeded',
    'CPU hard limit reached',
  ].join('\n');
  const result = parseFunctionLifecycleDiagnostics(logEvidence(text), report(), readyId);
  assert.deepEqual(result.eventCounts, {
    cpuSoftLimit: 1, cpuHardLimit: 1, booted: 1, memoryLimit: 1, wallClockLimit: 1,
  });
  assert.equal(result.dispatchSampleMapping, 'exact-readiness-suffix');
  assert.equal(result.dispatchCountAfterReadiness, 2);
  assert.deepEqual(result.events.map(({ kind, scenario, sample }) => ({ kind, scenario, sample })), [
    { kind: 'booted', scenario: null, sample: null },
    { kind: 'cpuSoftLimit', scenario: 'queue.first', sample: 0 },
    { kind: 'memoryLimit', scenario: 'master.deep', sample: 0 },
    { kind: 'wallClockLimit', scenario: 'master.deep', sample: 0 },
    { kind: 'cpuHardLimit', scenario: 'master.deep', sample: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /functions\/v1|request_id|CPU soft|Memory limit/);
});

test('leaves lifecycle events unmapped when readiness suffix is incomplete or ambiguous', () => {
  const variants = [
    logEvidence([dispatch, readiness, 'CPU soft limit reached'].join('\n')),
    logEvidence([dispatch, readiness, dispatch, dispatch, readiness, dispatch, 'CPU hard limit reached'].join('\n')),
    { ...logEvidence([readiness, dispatch, dispatch, 'Memory limit exceeded'].join('\n')), truncated: true },
  ];
  for (const evidence of variants) {
    const result = parseFunctionLifecycleDiagnostics(evidence, report(), readyId);
    assert.equal(result.dispatchSampleMapping, 'unmapped');
    assert.ok(result.events.every(event => event.scenario === null && event.sample === null && event.dispatchOrdinal === null));
  }
});

test('attaches diagnostics without mutating the per-pass report and tolerates missing logs safely', () => {
  const source = report();
  const attached = attachFunctionLifecycleDiagnostics(source, {
    text: '', bytesRead: 0, totalBytes: null, truncated: false, unavailable: true,
  }, readyId);
  assert.equal(source.diagnostics.functionLifecycle, undefined);
  assert.equal(attached.diagnostics.functionLifecycle.dispatchSampleMapping, 'unmapped');
  assert.equal(attached.diagnostics.functionLifecycle.logUnavailable, true);
  assert.deepEqual(attached.diagnostics.functionLifecycle.eventCounts, {
    cpuSoftLimit: 0, cpuHardLimit: 0, booted: 0, memoryLimit: 0, wallClockLimit: 0,
  });
});

test('bounds event records, counts excess events, and never copies arbitrary log content', () => {
  const text = [readiness, dispatch, dispatch,
    ...Array.from({ length: 300 }, (_, index) => `private/path/token-${index}: CPU hard limit reached`),
  ].join('\n');
  const result = parseFunctionLifecycleDiagnostics(logEvidence(text), report(), readyId);
  assert.equal(result.eventCount, 300);
  assert.equal(result.events.length, 256);
  assert.equal(result.droppedEventCount, 44);
  assert.doesNotMatch(JSON.stringify(result), /private|token-|CPU hard/);
});

test('rejects invalid readiness identity, malformed samples, and oversized logs', () => {
  assert.throws(() => parseFunctionLifecycleDiagnostics(logEvidence(''), report(), 'bad'), /LIFECYCLE_INPUT_INVALID/);
  const badReport = report();
  badReport.diagnostics.scenarios[0].apiSampleDiagnostics[0].requestStartMs = Number.NaN;
  assert.throws(() => parseFunctionLifecycleDiagnostics(logEvidence(''), badReport, readyId), /LIFECYCLE_SAMPLE_INVALID/);
  assert.throws(() => parseFunctionLifecycleDiagnostics(logEvidence('x'.repeat(4 * 1024 * 1024 + 1)), report(), readyId), /LIFECYCLE_INPUT_INVALID/);
});
