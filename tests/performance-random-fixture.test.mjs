// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { installPerformanceRandomFixture, performanceRandomSeed } from '../scripts/performance-random-fixture.mjs';

test('browser fixture retains every deterministic random sample and leaves native services intact', () => {
  const seed = performanceRandomSeed('phone', 'live', 0);
  const createRoot = () => ({ Math: { random: Math.random }, crypto: {}, Date, performance, setTimeout });
  const left = createRoot(), right = createRoot();
  const nativeServices = [left.crypto, left.Date, left.performance, left.setTimeout];
  const evidence = installPerformanceRandomFixture(seed, left);
  installPerformanceRandomFixture(seed, right);
  const samples = Array.from({ length: 1000 }, () => left.Math.random());
  assert.deepEqual(samples, Array.from({ length: 1000 }, () => right.Math.random()));
  assert.ok(samples.every(value => value >= 0 && value < 1));
  assert.ok(samples.some(value => value < 0.1));
  assert.ok(samples.some(value => value >= 0.1));
  assert.equal(new Set(samples).size, samples.length);
  assert.deepEqual(evidence.getState(), { algorithm: 'mulberry32-v1', seed, calls: 1000 });
  assert.deepEqual([left.crypto, left.Date, left.performance, left.setTimeout], nativeServices);
  assert.throws(() => installPerformanceRandomFixture(seed, left), /ALREADY_INSTALLED/);
});

test('profile and sample seeds vary reproducibly without depending on candidate commit or execution order', () => {
  const seeds = ['phone', 'tablet', 'desktop'].flatMap(profile => ['live', 'v2'].flatMap(app =>
    Array.from({ length: 5 }, (_, iteration) => performanceRandomSeed(profile, app, iteration))));
  assert.equal(new Set(seeds).size, 30);
  assert.equal(performanceRandomSeed('phone', 'live', 2), performanceRandomSeed('phone', 'live', 2));
  assert.throws(() => performanceRandomSeed('unknown', 'live', 0), /SAMPLE_INVALID/);
  assert.throws(() => installPerformanceRandomFixture(-1), /SEED_INVALID/);
});

test('serialized initializer exercises the real sampled telemetry function reproducibly without dropping its RPC', async () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function reportPerformanceHealthEvent(');
  const end = source.indexOf('\n        window.reportSemanticHealthEvent', start);
  assert.ok(start > 0 && end > start);
  async function exercise() {
    const calls = [];
    const context = vm.createContext({ currentUser: 'synthetic', navigator: { onLine: true }, APP_SHELL_BUILD: 'fixture',
      sanitizeHealthMetadata: value => value, withProductionLiveSyncSignal: (_signal, operation) => operation(undefined),
      supabaseRpc: async (operation, body) => { calls.push({ operation, event: body.event_name, sampleRate: body.sample_rate }); return 1; } });
    vm.runInContext(`(${installPerformanceRandomFixture.toString()})(123456);${source.slice(start, end)}`, context);
    for (let index = 0; index < 100; index++) await context.reportPerformanceHealthEvent('view_render', 'rendering', 5, {});
    return calls;
  }
  const first = await exercise();
  assert.deepEqual(first, await exercise());
  assert.ok(first.length > 0 && first.length < 100);
  assert.ok(first.every(call => call.operation === 'report_app_health_event' && call.sampleRate === 0.1));
});
