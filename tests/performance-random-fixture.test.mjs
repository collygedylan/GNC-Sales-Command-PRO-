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
  assert.deepEqual(evidence.getState(), { algorithm: 'mulberry32-v1', seed, calls: 1000,
    healthSampling: { algorithm: 'mulberry32-event-area-reason-v1', seed, calls: 0, sampled: 0, streams: 0, maxStreams: 64 },
    healthDiagnostics: { algorithm: 'health-invocation-v1', calls: 0, sampled: 0, unsampled: 0, noDraw: 0,
      dropped: 0, maxRecords: 256, records: [] } });
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

test('the real health reporter has the validated 10 percent gate as its only random draw', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function reportPerformanceHealthEvent(');
  const end = source.indexOf('\n        window.reportSemanticHealthEvent', start);
  assert.ok(start > 0 && end > start);
  const reporter = source.slice(start, end);
  const normalized = reporter.replace(/\s+/g, '');
  assert.match(normalized, /^functionreportPerformanceHealthEvent\(eventName,area=(?:"app"|'app'),durationMs=0,metadata=\{\}\)\{if\(!currentUser\|\|navigator\.onLine===false\|\|Math\.random\(\)>=(?:0\.10|0\.1|\.1)\)returnPromise\.resolve\(false\);/);
  assert.equal((normalized.match(/\bMath\.random\(\)/g) || []).length, 1);
  assert.equal((source.match(/window\.reportPerformanceHealthEvent\s*=\s*reportPerformanceHealthEvent/g) || []).length, 1);
});

test('real sampled telemetry calls are stable per event, area and reason despite unrelated random and UUID calls', async () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function reportPerformanceHealthEvent(');
  const end = source.indexOf('\n        window.reportSemanticHealthEvent', start);
  assert.ok(start > 0 && end > start);
  async function exercise(unrelatedDraws) {
    const calls = [];
    let uuidCalls = 0;
    const fixtureMath = Object.create(Math);
    fixtureMath.random = Math.random;
    const context = vm.createContext({ currentUser: 'synthetic', navigator: { onLine: true }, window: {}, Math: fixtureMath, performance, APP_SHELL_BUILD: 'fixture',
      crypto: { randomUUID: () => `fixture-${++uuidCalls}` },
      sanitizeHealthMetadata: value => value, withProductionLiveSyncSignal: (_signal, operation) => operation(undefined),
      supabaseRpc: async (operation, body) => {
        calls.push({ operation, event: body.event_name, area: body.area, duration: body.duration_ms,
          severity: body.severity, code: body.sanitized_code, sampleRate: body.sample_rate, metadata: body.metadata });
        return 1;
      } });
    vm.runInContext(`(${installPerformanceRandomFixture.toString()})(123456);${source.slice(start, end)}`, context);
    context.reportPerformanceHealthEvent = context.__phase6RandomFixture.wrapHealthReporter(context.reportPerformanceHealthEvent);
    context.window.reportPerformanceHealthEvent = context.reportPerformanceHealthEvent;
    const results = [];
    for (let index = 0; index < 100; index++) {
      for (let draw = 0; draw < (typeof unrelatedDraws === 'function' ? unrelatedDraws(index) : unrelatedDraws); draw++) {
        context.Math.random();
        context.crypto.randomUUID();
      }
      const event = index % 2 === 0 ? ['view_render', 'rendering'] : ['view_switch', 'navigation'];
      const reason = event[0] === 'view_render' ? 'request-main' : 'drive-main';
      results.push(await context.reportPerformanceHealthEvent(event[0], event[1], index + 1, { reason, sequence: index }));
    }
    return { calls, results, uuidCalls, state: context.__phase6RandomFixture.getState() };
  }
  const first = await exercise(0);
  const second = await exercise(index => index % 5);
  assert.deepEqual(first.calls, second.calls);
  assert.deepEqual(first.results, second.results);
  assert.equal(first.results.length, 100);
  assert.ok(first.calls.length > 0 && first.calls.length < first.results.length);
  assert.ok(first.calls.every(call => call.operation === 'report_app_health_event' && call.sampleRate === 0.1
    && call.severity === 'info' && call.code === 'PERFORMANCE_SAMPLE' && Number.isInteger(call.duration)));
  assert.equal(first.uuidCalls, 0);
  assert.equal(second.uuidCalls, 200);
  assert.notEqual(first.state.calls, second.state.calls);
  assert.equal(first.state.healthSampling.algorithm, 'mulberry32-event-area-reason-v1');
  assert.equal(first.state.healthSampling.seed, second.state.healthSampling.seed);
  assert.equal(first.state.healthSampling.calls, 100);
  assert.equal(first.state.healthSampling.sampled, first.calls.length);
  assert.deepEqual(JSON.parse(JSON.stringify(first.state.healthSampling)), JSON.parse(JSON.stringify(second.state.healthSampling)));
  assert.equal(first.state.healthSampling.streams, 2);
  assert.equal(Object.keys(first.state.healthSampling).some(key => /event|area|metadata/i.test(key)), false);
  assert.equal(first.state.healthDiagnostics.calls, 100);
  assert.equal(first.state.healthDiagnostics.sampled, first.calls.length);
  assert.equal(first.state.healthDiagnostics.unsampled, 100 - first.calls.length);
  assert.equal(first.state.healthDiagnostics.noDraw, 0);
  assert.equal(first.state.healthDiagnostics.dropped, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(first.state.healthDiagnostics.records.map(record => record.decision))),
    first.results.map(result => result ? 'sampled' : 'unsampled'));
  assert.ok(first.state.healthDiagnostics.records.every(record => Number.isFinite(record.startedAtMs)
    && Number.isFinite(record.returnedAtMs) && record.returnedAtMs >= record.startedAtMs
    && Number.isInteger(record.durationMs) && record.durationMs >= 0));
  assert.ok(first.state.healthDiagnostics.records.every(record => Object.keys(record).sort().join(',')
    === 'area,decision,durationMs,eventName,reason,returnedAtMs,startedAtMs'));
  assert.ok(first.state.healthDiagnostics.records.every(record => !JSON.stringify(record).includes('sequence')));
  assert.deepEqual(
    JSON.parse(JSON.stringify(first.state.healthDiagnostics.records.map(({ eventName, area, reason, durationMs, decision }) =>
      ({ eventName, area, reason, durationMs, decision })))),
    JSON.parse(JSON.stringify(second.state.healthDiagnostics.records.map(({ eventName, area, reason, durationMs, decision }) =>
      ({ eventName, area, reason, durationMs, decision }))))
  );
});

test('health sampling isolates earlier Request reasons while repeated same-reason calls advance the stream', async () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function reportPerformanceHealthEvent(');
  const end = source.indexOf('\n        window.reportSemanticHealthEvent', start);
  assert.ok(start > 0 && end > start);

  async function driveResult({ requestCalls = 0, extraDriveCalls = 0 }) {
    let invocations = 0;
    const rpcEvents = [];
    const context = vm.createContext({ currentUser: 'synthetic', navigator: { onLine: true }, window: {}, Math: Object.create(Math), APP_SHELL_BUILD: 'fixture',
      sanitizeHealthMetadata: value => value, withProductionLiveSyncSignal: (_signal, operation) => operation(undefined),
      supabaseRpc: async (_operation, body) => { rpcEvents.push(body.event_name); return 1; } });
    vm.runInContext(`(${installPerformanceRandomFixture.toString()})(0);${source.slice(start, end)}`, context);
    const actualReporter = context.reportPerformanceHealthEvent;
    const wrapped = context.__phase6RandomFixture.wrapHealthReporter(actualReporter);
    // Count all attempted calls while letting the fixture wrap the real reporter.
    const countedWrapped = function reportPerformanceHealthEvent(...args) {
      invocations++;
      return wrapped.apply(this, args);
    };
    context.reportPerformanceHealthEvent = countedWrapped;
    context.window.reportPerformanceHealthEvent = countedWrapped;
    for (let index = 0; index < requestCalls; index++) {
      await countedWrapped('view_render', 'rendering', index, { reason: 'request-main' });
    }
    for (let index = 0; index < extraDriveCalls; index++) {
      await countedWrapped('view_render', 'rendering', index, { reason: 'drive-main' });
    }
    rpcEvents.length = 0;
    const result = await countedWrapped('view_render', 'rendering', 999, { reason: 'drive-main' });
    return { result, invocations, rpcEvents, state: context.__phase6RandomFixture.getState() };
  }

  const noRequest = await driveResult({});
  const withRequest = await driveResult({ requestCalls: 40 });
  assert.equal(withRequest.result, noRequest.result, 'Request events with another reason must not shift the Drive sample');
  assert.equal(withRequest.invocations, 41);
  assert.equal(withRequest.state.healthSampling.calls, 41);
  assert.equal(noRequest.state.healthSampling.streams, 1);
  assert.equal(withRequest.state.healthSampling.streams, 2);

  const duplicateBeforeDrive = await driveResult({ extraDriveCalls: 1 });
  assert.notEqual(duplicateBeforeDrive.result, noRequest.result,
    'an extra same-reason Drive event must consume its stream draw rather than being hidden');
  assert.equal(duplicateBeforeDrive.invocations, 2);
  assert.equal(duplicateBeforeDrive.state.healthSampling.calls, 2);
  // The wrapped production handler is still invoked for every event, regardless of sampling.
  assert.equal(noRequest.rpcEvents.length, noRequest.result ? 1 : 0);
  assert.equal(withRequest.rpcEvents.length, withRequest.result ? 1 : 0);
});

test('health wrapper keeps this, arguments and returned promise and restores random on nesting or synchronous failure', () => {
  const promise = Promise.resolve('same-promise');
  const thisValue = { promise };
  const math = Object.create(Math);
  math.random = () => 0.5;
  const context = vm.createContext({ currentUser: 'synthetic', navigator: { onLine: true }, Math: math });
  vm.runInContext(`(${installPerformanceRandomFixture.toString()})(93);
    function reportPerformanceHealthEvent(eventName,area='app',durationMs=0,metadata={}){
      if(!currentUser||navigator.onLine===false||Math.random()>=0.10)return Promise.resolve(false);
      this.seen=[eventName,area,durationMs,metadata];
      if(this.invokeNested&&!this.nestedDone){this.nestedDone=true;return this.invokeNested();}
      return this.promise;
    }`, context);
  const wrapped = context.__phase6RandomFixture.wrapHealthReporter(context.reportPerformanceHealthEvent);
  const originalRandom = context.Math.random;
  const nestedThis = { promise };
  thisValue.invokeNested = () => wrapped.call(nestedThis, 'view_switch', 'navigation', 13, { nested: true });
  const result = wrapped.call(thisValue, 'view_render', 'rendering', 12, { marker: true });
  assert.strictEqual(result, promise);
  assert.deepEqual(JSON.parse(JSON.stringify(thisValue.seen)), ['view_render', 'rendering', 12, { marker: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(nestedThis.seen)), ['view_switch', 'navigation', 13, { nested: true }]);
  assert.equal(context.__phase6RandomFixture.getState().healthSampling.calls, 2);
  assert.strictEqual(context.Math.random, originalRandom);

  const throwingMath = Object.create(Math);
  throwingMath.random = originalRandom;
  const throwingContext = vm.createContext({ currentUser: 'synthetic', navigator: { onLine: true }, Math: throwingMath });
  vm.runInContext(`(${installPerformanceRandomFixture.toString()})(12); function reportPerformanceHealthEvent(eventName,area="app",durationMs=0,metadata={}){if(!currentUser||navigator.onLine===false||Math.random()>=0.10)return Promise.resolve(false);throw new Error("fixture throw");}`, throwingContext);
  const throwRandom = throwingContext.Math.random;
  const throwWrapped = throwingContext.__phase6RandomFixture.wrapHealthReporter(throwingContext.reportPerformanceHealthEvent);
  assert.throws(() => throwWrapped('view_render', 'rendering'), /fixture throw/);
  assert.strictEqual(throwingContext.Math.random, throwRandom);
});

test('no-user and offline early returns consume neither global nor health-sampling draws', () => {
  const math = Object.create(Math);
  math.random = () => 0.5;
  const context = vm.createContext({ currentUser: null, navigator: { onLine: true }, Math: math, performance });
  vm.runInContext(`(${installPerformanceRandomFixture.toString()})(12); function reportPerformanceHealthEvent(eventName,area='app',durationMs=0,metadata={}){if(!currentUser||navigator.onLine===false||Math.random()>=0.10)return Promise.resolve(false);return Promise.resolve(true);}`, context);
  const wrapped = context.__phase6RandomFixture.wrapHealthReporter(context.reportPerformanceHealthEvent);
  const originalRandom = context.Math.random;
  return wrapped('view_render', 'rendering').then(result => {
    assert.equal(result, false);
    assert.strictEqual(context.Math.random, originalRandom);
    let state = JSON.parse(JSON.stringify(context.__phase6RandomFixture.getState()));
    assert.equal(state.calls, 0);
    assert.equal(state.healthSampling.calls, 0);
    assert.deepEqual({ ...state.healthDiagnostics, records: undefined }, {
      algorithm: 'health-invocation-v1', calls: 1, sampled: 0, unsampled: 0, noDraw: 1, dropped: 0,
      maxRecords: 256, records: undefined
    });
    assert.deepEqual(state.healthDiagnostics.records.map(({ eventName, area, reason, durationMs, decision }) =>
      ({ eventName, area, reason, durationMs, decision })), [
      { eventName: 'view_render', area: 'rendering', reason: '', durationMs: null, decision: 'no-draw' }
    ]);
    assert.ok(state.healthDiagnostics.records.every(record => Number.isFinite(record.startedAtMs)
      && Number.isFinite(record.returnedAtMs) && record.returnedAtMs >= record.startedAtMs));
    context.currentUser = 'synthetic';
    context.navigator.onLine = false;
    return wrapped('view_render', 'rendering');
  }).then(result => {
    assert.equal(result, false);
    assert.equal(context.__phase6RandomFixture.getState().calls, 0);
    assert.equal(context.__phase6RandomFixture.getState().healthSampling.calls, 0);
    const diagnostics = context.__phase6RandomFixture.getState().healthDiagnostics;
    assert.equal(diagnostics.calls, 2);
    assert.equal(diagnostics.noDraw, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.records.map(record => record.decision))), ['no-draw', 'no-draw']);
  });
});

test('health invocation diagnostics are bounded and omit unsafe labels or arbitrary metadata', async () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function reportPerformanceHealthEvent(');
  const end = source.indexOf('\n        window.reportSemanticHealthEvent', start);
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({ currentUser: null, navigator: { onLine: true }, window: {}, Math: Object.create(Math), performance, APP_SHELL_BUILD: 'fixture',
    sanitizeHealthMetadata: value => value, withProductionLiveSyncSignal: (_signal, operation) => operation(undefined),
    supabaseRpc: async () => 1 });
  vm.runInContext(`(${installPerformanceRandomFixture.toString()})(321);${source.slice(start, end)}`, context);
  const wrapped = context.__phase6RandomFixture.wrapHealthReporter(context.reportPerformanceHealthEvent);
  let reasonGetterCalls = 0;
  const metadata = { token: 'private-token', get reason() { reasonGetterCalls++; return 'private reason'; } };
  for (let index = 0; index < 260; index++) {
    await wrapped(`unsafe?token=${index}`, 'rendering', index + 0.4, metadata);
  }
  const diagnostics = context.__phase6RandomFixture.getState().healthDiagnostics;
  assert.equal(reasonGetterCalls, 0);
  assert.equal(diagnostics.calls, 260);
  assert.equal(diagnostics.sampled, 0);
  assert.equal(diagnostics.unsampled, 0);
  assert.equal(diagnostics.noDraw, 260);
  assert.equal(diagnostics.dropped, 4);
  assert.equal(diagnostics.maxRecords, 256);
  assert.equal(diagnostics.records.length, 256);
  assert.ok(diagnostics.records.every((record, index) => record.eventName === '<other>' && record.area === 'rendering'
    && record.reason === '' && record.durationMs === index && record.decision === 'no-draw'));
  assert.equal(JSON.stringify(diagnostics).includes('private-token'), false);
  assert.equal(JSON.stringify(diagnostics).includes('private reason'), false);
  assert.equal(JSON.stringify(diagnostics).includes('unsafe?token'), false);
});
