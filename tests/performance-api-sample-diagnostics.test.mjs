import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApiSampleDiagnostics,
  intervalOverlapMs,
  MAX_API_GC_DIAGNOSTICS,
} from '../scripts/performance-api-sample-diagnostics.mjs';

class FakePerformanceObserver {
  static latest;
  constructor(callback) {
    this.callback = callback;
    this.entries = [];
    this.disconnected = false;
    this.takeRecordsCalls = 0;
    FakePerformanceObserver.latest = this;
  }
  observe(options) { this.options = options; }
  takeRecords() {
    this.takeRecordsCalls += 1;
    const entries = this.entries.splice(0);
    return entries;
  }
  disconnect() { this.disconnected = true; }
}

const gc = (startTime, duration, kind = 1) => ({ startTime, duration, detail: { kind } });

test('interval overlap clips intervals and treats adjacent boundaries as nonoverlapping', () => {
  assert.equal(intervalOverlapMs(10, 20, 15, 25), 5);
  assert.equal(intervalOverlapMs(10, 20, 20, 25), 0);
  assert.equal(intervalOverlapMs(10, 20, 0, 12), 2);
  assert.equal(intervalOverlapMs(20, 10, 0, 12), 0);
  assert.equal(intervalOverlapMs(Number.NaN, 20, 0, 12), 0);
});

test('sample diagnostics retain response timing boundaries and report separated GC/client work', () => {
  const utilizationCalls = [];
  const diagnostics = createApiSampleDiagnostics({
    now: () => 100,
    Observer: FakePerformanceObserver,
    snapshotEventLoopUtilization: () => ({ marker: utilizationCalls.length }),
    measureEventLoopUtilization: (start, end) => {
      utilizationCalls.push([start, end]);
      return { utilization: start.marker === 0 ? 0.25 : 0.75 };
    },
  });
  const observer = FakePerformanceObserver.latest;
  assert.deepEqual(observer.options, { entryTypes: ['gc'] });
  observer.entries.push(gc(120, 15, 1), gc(154, 10, 2), gc(300, 5, 3));
  diagnostics.recordSample({
    scenario: 'lookup.10k.admin.first.dataset-10k', sampleIndex: 0,
    requestStartedAt: 110, headersAt: 120, bodyReadStartedAt: 125, bodyCompleteAt: 150,
    decodeStartedAt: 152, decodeEndedAt: 158, validationStartedAt: 160, validationEndedAt: 170,
    requestEluStart: { marker: 0 }, requestEluEnd: { marker: 1 },
    decodeEluStart: { marker: 2 }, decodeEluEnd: { marker: 3 },
    validationEluStart: { marker: 4 }, validationEluEnd: { marker: 5 },
  });

  const report = diagnostics.finalize();
  const [sample] = report.scenarios['lookup.10k.admin.first.dataset-10k'];
  assert.equal(sample.sample, 0);
  assert.equal(sample.responseMs, 40);
  assert.equal(sample.headersMs, 10);
  assert.equal(sample.bodyReadMs, 25);
  assert.equal(sample.decodeMs, 6);
  assert.equal(sample.validationMs, 10);
  assert.equal(sample.requestEventLoopUtilization, 0.25);
  assert.equal(sample.decodeEventLoopUtilization, 0.75);
  assert.equal(sample.validationEventLoopUtilization, 0.75);
  assert.equal(sample.requestGcOverlapMs, 15);
  assert.equal(sample.decodeGcOverlapMs, 4);
  assert.equal(sample.validationGcOverlapMs, 4);
  assert.deepEqual(sample.requestGcOverlaps, [{ kind: 1, overlapMs: 15, durationMs: 15 }]);
  assert.equal(report.gcEntriesObserved, 3);
  assert.equal(report.gcEntriesDropped, 0);
  assert.equal(observer.takeRecordsCalls, 1);
  assert.equal(observer.disconnected, true);
  assert.equal(JSON.stringify(report).includes('payload'), false);
});

test('GC diagnostics are capped and report dropped entries without changing samples', () => {
  const diagnostics = createApiSampleDiagnostics({
    now: () => 0,
    maxGcEntries: 1,
    Observer: FakePerformanceObserver,
    snapshotEventLoopUtilization: () => ({}),
    measureEventLoopUtilization: () => ({ utilization: 0 }),
  });
  FakePerformanceObserver.latest.entries.push(gc(2, 1), gc(4, 1));
  diagnostics.recordSample({
    scenario: 'master.100k.admin.browse.deep.dataset-100k', sampleIndex: 0,
    requestStartedAt: 1, headersAt: 2, bodyReadStartedAt: 2, bodyCompleteAt: 3,
    decodeStartedAt: 3, decodeEndedAt: 4, validationStartedAt: 4, validationEndedAt: 5,
  });
  const report = diagnostics.finalize();
  assert.equal(report.gcEntryLimit, 1);
  assert.equal(report.gcEntriesObserved, 1);
  assert.equal(report.gcEntriesDropped, 1);
  assert.equal(report.scenarios['master.100k.admin.browse.deep.dataset-100k'][0].responseMs, 2);
});

test('duplicate and malformed sample intervals fail closed', () => {
  const diagnostics = createApiSampleDiagnostics({ now: () => 0, Observer: FakePerformanceObserver });
  const entry = {
    scenario: 'lookup.10k.admin.first.dataset-10k', sampleIndex: 0,
    requestStartedAt: 1, headersAt: 2, bodyReadStartedAt: 2, bodyCompleteAt: 3,
    decodeStartedAt: 3, decodeEndedAt: 4, validationStartedAt: 4, validationEndedAt: 5,
  };
  diagnostics.recordSample(entry);
  assert.throws(() => diagnostics.recordSample(entry), /PERFORMANCE_API_SAMPLE_DIAGNOSTIC_DUPLICATE/);
  assert.throws(() => diagnostics.recordSample({ ...entry, sampleIndex: 1, bodyCompleteAt: 1 }), /PERFORMANCE_API_SAMPLE_DIAGNOSTIC_INVALID/);
  diagnostics.close();
  assert.equal(FakePerformanceObserver.latest.takeRecordsCalls, 1);
  assert.equal(FakePerformanceObserver.latest.entries.length, 0);
  assert.equal(FakePerformanceObserver.latest.disconnected, true);
  assert.equal(MAX_API_GC_DIAGNOSTICS, 4096);
});
