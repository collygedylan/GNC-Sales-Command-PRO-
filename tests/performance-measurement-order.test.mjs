// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function measurementFixture({ settlementError } = {}) {
  const source = readFileSync(new URL('../scripts/run-performance-browser.mjs', import.meta.url), 'utf8');
  const classifierStart = source.indexOf('function classifyApiTraffic(');
  const measureStart = source.indexOf('async function measure(');
  assert.ok(classifierStart >= 0 && measureStart > classifierStart);
  const start = source.indexOf('async function measure(');
  const end = source.indexOf('\nasync function benchmark(', start);
  assert.ok(start >= 0 && end > start, 'the regression exercises the actual route measurement');
  const events = [], totals = { apiRequests: [], pending: [], errors: [] };
  let now = 100, evaluations = 0;
  const page = { async evaluate() {
    evaluations++;
    if (evaluations === 1) { events.push('reset-observers'); return 123; }
    if (evaluations === 2) { events.push('read-observers'); return { longTaskMs: 75, domRemovals: 3 }; }
    assert.equal(evaluations, 3);
    events.push('scroll');
    return { scrollFrameP95: 16, diagnostics: { startTime: 930, endTime: 1186, frameGaps: Array(16).fill(16) } };
  } };
  const control = {};
  const context = vm.createContext({
    performance: { now: () => now },
    async settle() { events.push('raf'); },
    async waitForPerformancePollWindow() { events.push('poll-window'); },
    async openPerformanceView(actualPage, app, view) {
      assert.equal(actualPage, page); assert.equal(app, 'live'); assert.equal(view, 'request');
      events.push('first-visible'); now = 150;
    },
    async waitForPerformanceViewSettlement(actualPage, app, view) {
      assert.equal(actualPage, page); assert.equal(app, 'live'); assert.equal(view, 'request');
      events.push('settle-queued-work');
      if (settlementError) throw settlementError;
      now = 900; // Deferred work remains accounted for without changing usable-content latency.
      totals.apiRequests.push({ index: 0, operation: 'rpc:get_sample', bytes: 37, canceled: false, error: null });
      totals.apiRequests.push({ index: 1, operation: 'rpc:report_app_health_event', bytes: 1, canceled: false, error: null });
    },
    async settlePerformanceApiBoundary(actualTotals, actualControl) {
      assert.equal(actualTotals, totals); assert.equal(actualControl, control);
      events.push(`freeze-${totals.apiRequests.length}`);
      return totals.apiRequests.length;
    },
    async drainPerformanceResponseBodies() { events.push('drain-bodies'); },
  });
  vm.runInContext(source.slice(classifierStart, measureStart), context);
  vm.runInContext(source.slice(start, end), context);
  return { events, run: () => context.measure(page, 'live', 'request', totals, control, 0) };
}

test('route measurement retains first-visible latency and counts queued reads before closing its window', async () => {
  const fixture = measurementFixture();
  const result = await fixture.run();
  assert.equal(result.duration, 50);
  assert.equal(result.reads, 1);
  assert.equal(result.bytes, 37);
  assert.equal(result.writes, 1);
  assert.equal(result.writeBytes, 1);
  assert.equal(result.reads + result.writes + result.otherRequests, result.boundaryEndIndex - result.boundaryStartIndex);
  assert.equal(result.bytes + result.writeBytes + result.otherBytes, 38, 'traffic classification partitions every response byte');
  assert.equal(result.longTaskMs, 75);
  assert.equal(result.domRemovals, 3);
  assert.equal(result.scrollFrameP95, 16);
  assert.equal(result.renderingDiagnostics.sampleStart, 123);
  assert.deepEqual(result.renderingDiagnostics.scroll.frameGaps, Array(16).fill(16));
  assert.equal(result.renderingDiagnostics.scroll.startTime, 930);
  assert.equal(result.renderingDiagnostics.scroll.endTime, 1186);
  assert.equal(result.boundaryEndIndex, 2);
  assert.deepEqual(fixture.events, ['poll-window', 'raf', 'freeze-0', 'reset-observers', 'first-visible', 'raf',
    'settle-queued-work', 'freeze-2', 'read-observers', 'scroll', 'drain-bodies']);
});

test('unsettled route work invalidates the sample rather than reporting partial counts', async () => {
  const fixture = measurementFixture({ settlementError: new Error('PERFORMANCE_VIEW_SETTLEMENT_TIMEOUT') });
  await assert.rejects(fixture.run(), /PERFORMANCE_VIEW_SETTLEMENT_TIMEOUT/);
  assert.equal(fixture.events.includes('freeze-1'), false);
  assert.equal(fixture.events.includes('read-observers'), false);
});
