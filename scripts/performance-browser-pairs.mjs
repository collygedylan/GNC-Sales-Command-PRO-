import { parseBenchmarkManifest, parseBenchmarkReport } from '../services/performanceBaseline.ts';

/** Run adjacent cold contexts in alternating order without retrying samples. */
export async function runPerformanceBrowserPairs(manifestInput, measure, { reverse = false } = {}) {
  const manifest = parseBenchmarkManifest(manifestInput);
  if (typeof measure !== 'function' || typeof reverse !== 'boolean') throw new Error('PERFORMANCE_BROWSER_PAIR_OPTIONS_INVALID');
  const passes = { baseline: [], candidate: [] }, schedule = [];
  for (let iteration = 0; iteration < manifest.coldSamples; iteration++) {
    const candidateFirst = (iteration % 2 === 1) !== reverse;
    for (const revision of candidateFirst ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      schedule.push({ iteration, revision });
      passes[revision].push(await measure(revision, iteration));
    }
  }
  return { baseline: mergePerformanceBrowserContexts(manifest, passes.baseline),
    candidate: mergePerformanceBrowserContexts(manifest, passes.candidate), schedule };
}

export function mergePerformanceBrowserContexts(manifestInput, inputs) {
  const manifest = parseBenchmarkManifest(manifestInput);
  if (!Array.isArray(inputs) || inputs.length !== manifest.coldSamples) throw new Error('PERFORMANCE_BROWSER_CONTEXT_COUNT_INVALID');
  const parsed = inputs.map(parseBenchmarkReport);
  const first = parsed[0];
  const identity = report => JSON.stringify({ ...report, metrics: undefined });
  const firstIdentity = identity(first);
  for (const report of parsed) {
    if (identity(report) !== firstIdentity) throw new Error('PERFORMANCE_BROWSER_CONTEXT_IDENTITY_MISMATCH');
    if (report.metrics.length !== first.metrics.length) throw new Error('PERFORMANCE_BROWSER_CONTEXT_METRICS_MISMATCH');
    for (const expected of first.metrics) {
      const metric = report.metrics.find(value => value.id === expected.id);
      const expectedSamples = expected.id.includes('.warm.') ? manifest.warmSamples / manifest.coldSamples : 1;
      if (!metric || metric.kind !== expected.kind || metric.samples.length !== expectedSamples) {
        throw new Error('PERFORMANCE_BROWSER_CONTEXT_METRICS_MISMATCH');
      }
    }
  }
  const metrics = first.metrics.map(metric => ({ ...metric,
    samples: parsed.flatMap(report => report.metrics.find(value => value.id === metric.id).samples) }));
  const output = { ...inputs[0], ...first, metrics };
  for (const key of ['initialExecutableJsBytes', 'deferredScriptBytes', 'cancellationDiagnostics', 'apiReadDiagnostics', 'randomDiagnostics']) {
    if (inputs.some(input => !Array.isArray(input[key]))) throw new Error('PERFORMANCE_BROWSER_CONTEXT_DIAGNOSTICS_MISSING');
    if (['initialExecutableJsBytes', 'deferredScriptBytes', 'randomDiagnostics'].includes(key)
      && inputs.some(input => input[key].length !== 1)) throw new Error('PERFORMANCE_BROWSER_CONTEXT_DIAGNOSTICS_INVALID');
    output[key] = inputs.flatMap(input => input[key]);
  }
  return output;
}
