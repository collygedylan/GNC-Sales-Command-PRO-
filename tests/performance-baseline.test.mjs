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
test('live background refresh reasons coalesce without caching data or losing dirty views', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('        function scheduleDeferredVisibleDirtyViewRefresh(');
  const end = html.indexOf('\n        function ', start + 1);
  const pending = new Map(), rendered = [], states = { drive: { dirty: true }, request: { dirty: true } };
  const uiRenderFrames = {};
  let scheduled = 0;
  let visible = ['drive'];
  const context = vm.createContext({
    scheduleTypingAwareUiRender: (key, callback) => { scheduled++; uiRenderFrames[key] = 1; pending.set(key, callback); },
    uiRenderFrames, uiRenderTimers: {}, ACTIVE_TYPING_GRACE_MS: 200,
    beginInternalPerfMeasure: () => 0, getVisibleTrackedViewIds: () => visible,
    ensureViewRenderState: view => states[view], isViewVisible: view => visible.includes(view),
    prepareLatestViewRender: () => 1, isLatestViewRenderToken: () => true,
    incrementInternalPerfCounter: () => {}, recordInternalPerfDuration: () => {},
    renderViewContent: view => { rendered.push(view); states[view].dirty = false; }
  });
  vm.runInContext(html.slice(start, end), context);
  for (let i = 0; i < 100; i++) context.scheduleDeferredVisibleDirtyViewRefresh(`change-${i}`);
  assert.equal(pending.size, 1);
  assert.equal(scheduled, 1, 'later signals retain the original deadline instead of starving the pending refresh');
  visible = ['request']; // Navigation happened while deferred; render current state.
  [...pending.values()][0]();
  assert.deepEqual(rendered, ['request']);
  assert.equal(states.drive.dirty, true);
  [...pending.values()][0]();
  assert.deepEqual(rendered, ['request']);
});
