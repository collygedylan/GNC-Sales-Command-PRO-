// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { compareBenchmarks, parseBenchmarkManifest, parseBenchmarkReport } from '../services/performanceBaseline.ts';

const manifest = parseBenchmarkManifest(JSON.parse(readFileSync(new URL('../performance/baseline.json', import.meta.url), 'utf8')));
const report = (kind, samples) => ({ schemaVersion: 1, commit: manifest.baselineCommit, baselineCommit: manifest.baselineCommit,
  artifactDigest: 'a'.repeat(64), fixtureVersion: manifest.fixtureVersion, browser: 'chromium-fixture', viewport: { width: 390, height: 844 },
  method: 'paired-serial-v1', metrics: [{ id: 'drive', kind, samples }] });
test('performance manifest pins a reviewed baseline and all device profiles', () => {
  assert.deepEqual(manifest.profiles.map(profile => profile.id), ['phone', 'tablet', 'desktop']);
  assert.throws(() => parseBenchmarkManifest({ ...manifest, baselineCommit: 'main' }), /DIGEST_INVALID/);
  assert.throws(() => parseBenchmarkManifest({ ...manifest, budgets: { ...manifest.budgets, relative: 0.5 } }), /MANIFEST_INVALID/);
  assert.throws(() => parseBenchmarkManifest({ ...manifest, warmSamples: 11 }), /SAMPLE_RATIO_INVALID/);
});
test('timing budgets use the larger relative or noise allowance, never add both', () => {
  assert.deepEqual(compareBenchmarks(manifest, report('duration', [100]), report('duration', [125])), []);
  assert.equal(compareBenchmarks(manifest, report('duration', [100]), report('duration', [126])).length, 2);
  assert.deepEqual(compareBenchmarks(manifest, report('database-duration', [100]), report('database-duration', [115])), []);
  assert.equal(compareBenchmarks(manifest, report('database-duration', [100]), report('database-duration', [116])).length, 2);
});
test('bytes, duplicate reads and unchanged-row renders cannot regress', () => {
  for (const kind of ['bytes', 'count', 'renders']) {
    assert.equal(compareBenchmarks(manifest, report(kind, [0]), report(kind, [1])).length, 2);
  }
});
test('missing metrics, samples, changed fixtures, and invalid data fail closed', () => {
  assert.throws(() => parseBenchmarkReport(report('duration', [NaN])), /SAMPLES_INVALID/);
  assert.throws(() => parseBenchmarkReport(report('duration', [])), /SAMPLES_INVALID/);
  assert.throws(() => compareBenchmarks(manifest, report('duration', [1]), { ...report('duration', [1]), fixtureVersion: 'changed' }), /CONTEXT_MISMATCH/);
  assert.throws(() => compareBenchmarks(manifest, report('duration', [1]), report('duration', [1, 2])), /COVERAGE_MISMATCH/);
});
test('live background refresh keeps reason deadlines and resolves current visible dirty views safely', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('        function scheduleDeferredVisibleDirtyViewRefresh(');
  const end = html.indexOf('\n        function ', start + 1);
  const pending = new Map(), scheduled = [], rendered = [], states = { drive: { dirty: true }, request: { dirty: true } };
  const staleViews = new Set(), staleSkips = [], durations = [];
  let visible = ['drive', 'request'];
  const context = vm.createContext({
    scheduleTypingAwareUiRender: (key, callback, delay, typingDelay, options) => {
      scheduled.push({ key, delay, typingDelay, options }); pending.set(key, callback);
    },
    ACTIVE_TYPING_GRACE_MS: 200,
    beginInternalPerfMeasure: () => 0, getVisibleTrackedViewIds: () => visible,
    ensureViewRenderState: view => states[view], isViewVisible: view => visible.includes(view),
    prepareLatestViewRender: () => 1, isLatestViewRenderToken: view => !staleViews.has(view),
    incrementInternalPerfCounter: name => staleSkips.push(name),
    recordInternalPerfDuration: (name, startedAt, reason) => durations.push(reason),
    renderViewContent: (view, fromCache, force) => { rendered.push([view, fromCache, force]); states[view].dirty = false; }
  });
  vm.runInContext(html.slice(start, end), context);
  context.scheduleDeferredVisibleDirtyViewRefresh('realtime:request-ui', 24, 260);
  context.scheduleDeferredVisibleDirtyViewRefresh('dataset-refresh', 35, 180);
  context.scheduleDeferredVisibleDirtyViewRefresh('committed-edit', 60, 300);
  assert.equal(pending.size, 3);
  assert.deepEqual(scheduled.map(({ key, delay, typingDelay }) => ({ key, delay, typingDelay })), [
    { key: 'visible-dirty-refresh:realtime:request-ui', delay: 24, typingDelay: 260 },
    { key: 'visible-dirty-refresh:dataset-refresh', delay: 35, typingDelay: 200 },
    { key: 'visible-dirty-refresh:committed-edit', delay: 60, typingDelay: 300 },
  ]);

  visible = ['request']; // Resolve visibility when the delayed callback runs.
  staleViews.add('request');
  pending.get('visible-dirty-refresh:dataset-refresh')();
  assert.deepEqual(rendered, []);
  assert.deepEqual(staleSkips, ['staleViewRenderSkips']);
  assert.equal(states.drive.dirty, true, 'hidden dirty views remain dirty');

  staleViews.clear();
  pending.get('visible-dirty-refresh:realtime:request-ui')();
  assert.deepEqual(rendered, [['request', false, false]]);
  assert.equal(states.request.dirty, false);
  pending.get('visible-dirty-refresh:committed-edit')();
  assert.deepEqual(rendered, [['request', false, false]], 'a clean visible view is not rendered again');
  assert.deepEqual(durations, ['dataset-refresh', 'realtime:request-ui']);
  assert.equal(states.drive.dirty, true);
});
