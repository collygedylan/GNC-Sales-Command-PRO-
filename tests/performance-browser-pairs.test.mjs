// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { mergePerformanceBrowserContexts, runPerformanceBrowserPairs } from '../scripts/performance-browser-pairs.mjs';

const manifest = JSON.parse(readFileSync(new URL('../performance/baseline.json', import.meta.url), 'utf8'));
const report = (revision, iteration) => ({
  schemaVersion: 1, commit: revision === 'baseline' ? manifest.baselineCommit : 'a'.repeat(40),
  baselineCommit: manifest.baselineCommit, artifactDigest: (revision === 'baseline' ? 'b' : 'c').repeat(64),
  fixtureVersion: manifest.fixtureVersion, browser: 'chromium-test', viewport: { width: 390, height: 844 }, method: 'fixture-pair',
  metrics: [{ id: 'initial-api-reads', kind: 'count', samples: [iteration] },
    { id: 'request.cold.duration', kind: 'duration', samples: [100 + iteration] },
    { id: 'request.warm.bytes', kind: 'bytes', samples: [iteration * 2, iteration * 2 + 1] }],
  initialExecutableJsBytes: [1000], deferredScriptBytes: [50], cancellationDiagnostics: [{ iteration, canceled: 1 }],
  apiReadDiagnostics: [{ iteration, bytes: 5 }], randomDiagnostics: [{ iteration, seed: iteration + 1 }]
});

test('browser pairs run serial adjacent revisions with alternating first position and retain every sample', async () => {
  for (const reverse of [false, true]) {
    const calls = [];
    let active = 0;
    const pair = await runPerformanceBrowserPairs(manifest, async (revision, iteration) => {
      assert.equal(active++, 0, 'benchmark contexts must never overlap');
      await Promise.resolve();
      calls.push({ revision, iteration });
      active--;
      return report(revision, iteration);
    }, { reverse });
    assert.deepEqual(pair.schedule, calls);
    assert.equal(calls.length, 2 * manifest.coldSamples);
    for (let iteration = 0; iteration < manifest.coldSamples; iteration++) {
      const expected = ((iteration % 2 === 1) !== reverse) ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
      assert.deepEqual(calls.slice(2 * iteration, 2 * iteration + 2), expected.map(revision => ({ revision, iteration })));
    }
    for (const revision of ['baseline', 'candidate']) {
      assert.deepEqual(pair[revision].metrics[0].samples, [0, 1, 2, 3, 4]);
      assert.deepEqual(pair[revision].metrics[2].samples, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const key of ['initialExecutableJsBytes', 'deferredScriptBytes', 'cancellationDiagnostics', 'apiReadDiagnostics', 'randomDiagnostics']) {
        assert.equal(pair[revision][key].length, manifest.coldSamples);
      }
    }
  }
});

test('browser aggregation rejects mismatched identities, missing metrics, wrong sample counts and lost diagnostics', () => {
  const valid = () => Array.from({ length: manifest.coldSamples }, (_, iteration) => report('candidate', iteration));
  for (const change of [
    inputs => inputs.pop(),
    inputs => { inputs[1].commit = 'd'.repeat(40); },
    inputs => { inputs[1].artifactDigest = 'd'.repeat(64); },
    inputs => { inputs[1].method = 'other'; },
    inputs => { inputs[1].browser = 'other'; },
    inputs => { inputs[1].viewport.width++; },
    inputs => { inputs[1].metrics.pop(); },
    inputs => { inputs[1].metrics[0].samples.push(5); },
    inputs => { inputs[1].metrics[2].samples.pop(); },
    inputs => { inputs[1].metrics[0].kind = 'bytes'; },
    inputs => { delete inputs[1].apiReadDiagnostics; },
    inputs => { inputs[1].randomDiagnostics = []; },
  ]) {
    const inputs = valid(); change(inputs);
    assert.throws(() => mergePerformanceBrowserContexts(manifest, inputs), /PERFORMANCE_BROWSER_CONTEXT_/);
  }
});

test('a failed context stops browser pairing without retrying or omitting it', async () => {
  const calls = [];
  const failure = new Error('fixture failed');
  await assert.rejects(runPerformanceBrowserPairs(manifest, async (revision, iteration) => {
    calls.push({ revision, iteration });
    if (revision === 'candidate') throw failure;
    return report(revision, iteration);
  }), error => error === failure);
  assert.deepEqual(calls, [{ revision: 'baseline', iteration: 0 }, { revision: 'candidate', iteration: 0 }]);
});

test('actual context runner owns a fresh browser and closes its server on launch or page failure', async () => {
  const source = readFileSync(new URL('../scripts/run-performance-browser.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = source.indexOf('async function benchmark(');
  const end = source.indexOf('\ntry {\n  const baseline', start);
  assert.ok(start >= 0 && end > start);
  for (const failsAt of ['launch', 'page']) {
    let launches = 0, closes = 0, serversClosed = 0;
    const failure = new Error(failsAt);
    const context = vm.createContext({
      startReleaseTestServer: async () => ({ address: () => ({ port: 1234 }), close(done) { serversClosed++; done(); } }),
      chromium: { async launch() {
        launches++;
        if (failsAt === 'launch') throw failure;
        return { version: () => 'test', newContext: async () => ({ newPage: async () => { throw failure; } }),
          async close() { closes++; } };
      } },
    });
    vm.runInContext(source.slice(start, end), context);
    for (let iteration = 0; iteration < 2; iteration++) {
      await assert.rejects(context.benchmark('site', {}, { width: 390, height: 844 }, 'live', iteration), error => error === failure);
    }
    assert.equal(launches, 2);
    assert.equal(closes, failsAt === 'launch' ? 0 : 2);
    assert.equal(serversClosed, 2);
  }
});
