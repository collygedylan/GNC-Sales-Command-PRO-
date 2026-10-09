// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { benchmarkMetricLimit, compareBenchmarks, parseBenchmarkManifest, parseBenchmarkReport, parseSqlSchemaExtensions } from '../services/performanceBaseline.ts';

const manifest = parseBenchmarkManifest(JSON.parse(readFileSync(new URL('../performance/baseline.json', import.meta.url), 'utf8')));
const strictManifest = parseBenchmarkManifest({ ...manifest, temporaryTimingAllowance: undefined });
const report = (kind, samples) => ({ schemaVersion: 1, commit: manifest.baselineCommit, baselineCommit: manifest.baselineCommit,
  artifactDigest: 'a'.repeat(64), fixtureVersion: manifest.fixtureVersion, browser: 'chromium-fixture', viewport: { width: 390, height: 844 },
  method: 'paired-serial-v1', metrics: [{ id: 'drive', kind, samples }] });
test('performance manifest pins a reviewed baseline and all device profiles', () => {
  assert.deepEqual(manifest.profiles.map(profile => profile.id), ['phone', 'tablet', 'desktop']);
  assert.match(manifest.sqlSchemaCommit, /^[a-f0-9]{40}$/);
  assert.throws(() => parseBenchmarkManifest({ ...manifest, baselineCommit: 'main' }), /DIGEST_INVALID/);
  assert.throws(() => parseBenchmarkManifest({ ...manifest, sqlSchemaCommit: 'main' }), /DIGEST_INVALID/);
  assert.throws(() => parseBenchmarkManifest({ ...manifest, budgets: { ...manifest.budgets, relative: 0.5 } }), /MANIFEST_INVALID/);
  assert.throws(() => parseBenchmarkManifest({ ...manifest, warmSamples: 11 }), /SAMPLE_RATIO_INVALID/);
});

test('additive SQL schema pins require explicit safe paths and immutable blob hashes', () => {
  const entry = { path: 'supabase/migrations/20261009053029_example.sql', gitBlob: 'a'.repeat(40) };
  assert.deepEqual(parseSqlSchemaExtensions([entry]), [entry]);
  assert.throws(() => parseSqlSchemaExtensions([{ ...entry, path: '../new.sql' }]), /SCHEMA_EXTENSION_INVALID/);
  assert.throws(() => parseSqlSchemaExtensions([{ ...entry, gitBlob: 'HEAD' }]), /DIGEST_INVALID/);
  assert.throws(() => parseSqlSchemaExtensions([entry, entry]), /SCHEMA_EXTENSION_DUPLICATE/);
  assert.throws(() => parseSqlSchemaExtensions('latest'), /SCHEMA_EXTENSION_INVALID/);
});
test('timing budgets use the larger relative or noise allowance, never add both', () => {
  assert.deepEqual(compareBenchmarks(strictManifest, report('duration', [100]), report('duration', [125])), []);
  assert.equal(compareBenchmarks(strictManifest, report('duration', [100]), report('duration', [126])).length, 2);
  assert.deepEqual(compareBenchmarks(strictManifest, report('database-duration', [100]), report('database-duration', [115])), []);
  assert.equal(compareBenchmarks(strictManifest, report('database-duration', [100]), report('database-duration', [116])).length, 2);
});

test('approved temporary profile doubles time ceilings with a 75ms browser jitter floor', () => {
  assert.deepEqual(manifest.temporaryTimingAllowance, { multiplier: 2, minimumBrowserAllowanceMs: 75, restoreAtPrompt: 7 });
  for (const [kind, before, limit] of [
    ['duration', 0, 75], ['duration', 100, 250], ['duration', 1000, 2300],
    ['database-duration', 0, 10], ['database-duration', 100, 230],
  ]) {
    assert.equal(benchmarkMetricLimit(manifest, before, kind), limit);
    assert.deepEqual(compareBenchmarks(manifest, report(kind, [before]), report(kind, [limit])), []);
    assert.equal(compareBenchmarks(manifest, report(kind, [before]), report(kind, [limit + 1])).length, 2);
  }
  assert.equal(benchmarkMetricLimit(strictManifest, 0, 'duration'), 25, 'Prompt 7 restores the original browser allowance');
  assert.equal(benchmarkMetricLimit(strictManifest, 0, 'database-duration'), 5, 'Prompt 7 restores the original SQL allowance');
  for (const change of [{ multiplier: 3 }, { minimumBrowserAllowanceMs: 100 }, { restoreAtPrompt: 8 }, { extra: true }]) {
    assert.throws(() => parseBenchmarkManifest({ ...manifest,
      temporaryTimingAllowance: { ...manifest.temporaryTimingAllowance, ...change } }), /TEMPORARY_TIMING_ALLOWANCE_INVALID/);
  }
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
