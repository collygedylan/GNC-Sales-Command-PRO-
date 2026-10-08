/** Shared benchmark contracts. These are tooling inputs, never business data. */
export type MetricKind = 'duration' | 'database-duration' | 'count' | 'bytes' | 'renders';
export type BenchmarkMetric = { id: string; kind: MetricKind; samples: number[] };
export type BenchmarkManifest = {
  schemaVersion: 1;
  baselineCommit: string;
  fixtureVersion: string;
  coldSamples: number;
  warmSamples: number;
  profiles: { id: string; width: number; height: number }[];
  budgets: { relative: number; browserNoiseMs: number; databaseNoiseMs: number };
};
export type BenchmarkReport = {
  schemaVersion: 1;
  commit: string;
  baselineCommit: string;
  artifactDigest: string;
  fixtureVersion: string;
  browser: string;
  viewport: { width: number; height: number };
  method: string;
  metrics: BenchmarkMetric[];
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PERFORMANCE_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error('PERFORMANCE_INTEGER_INVALID');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('PERFORMANCE_STRING_REQUIRED');
  return value;
}
function sha(value: unknown, length: number): string {
  const result = string(value);
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(result)) throw new Error('PERFORMANCE_DIGEST_INVALID');
  return result;
}
export function parseBenchmarkManifest(input: unknown): BenchmarkManifest {
  const raw = object(input), budgets = object(raw.budgets);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.profiles) || raw.profiles.length !== 3
      || budgets.relative !== 0.15 || budgets.browserNoiseMs !== 25 || budgets.databaseNoiseMs !== 5) {
    throw new Error('PERFORMANCE_MANIFEST_INVALID');
  }
  const profiles = raw.profiles.map(value => {
    const entry = object(value);
    return { id: string(entry.id), width: integer(entry.width, 320, 2560), height: integer(entry.height, 400, 2560) };
  });
  if (new Set(profiles.map(entry => entry.id)).size !== profiles.length) throw new Error('PERFORMANCE_PROFILE_DUPLICATE');
  const coldSamples = integer(raw.coldSamples, 5, 30), warmSamples = integer(raw.warmSamples, 10, 100);
  if (warmSamples % coldSamples !== 0) throw new Error('PERFORMANCE_SAMPLE_RATIO_INVALID');
  return { schemaVersion: 1, baselineCommit: sha(raw.baselineCommit, 40), fixtureVersion: string(raw.fixtureVersion),
    coldSamples, warmSamples, profiles,
    budgets: { relative: 0.15, browserNoiseMs: 25, databaseNoiseMs: 5 } };
}
export function parseBenchmarkReport(input: unknown): BenchmarkReport {
  const raw = object(input), viewport = object(raw.viewport);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.metrics) || !raw.metrics.length) throw new Error('PERFORMANCE_METRICS_REQUIRED');
  const metrics = raw.metrics.map((value): BenchmarkMetric => {
    const entry = object(value), kind = entry.kind;
    if (kind !== 'duration' && kind !== 'database-duration' && kind !== 'count' && kind !== 'bytes' && kind !== 'renders') throw new Error('PERFORMANCE_METRIC_KIND_INVALID');
    if (!Array.isArray(entry.samples) || !entry.samples.length || entry.samples.some(sample => typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0)) throw new Error('PERFORMANCE_SAMPLES_INVALID');
    return { id: string(entry.id), kind, samples: entry.samples as number[] };
  });
  if (new Set(metrics.map(metric => metric.id)).size !== metrics.length) throw new Error('PERFORMANCE_METRIC_DUPLICATE');
  return { schemaVersion: 1, commit: sha(raw.commit, 40), baselineCommit: sha(raw.baselineCommit, 40), artifactDigest: sha(raw.artifactDigest, 64),
    fixtureVersion: string(raw.fixtureVersion), browser: string(raw.browser), method: string(raw.method),
    viewport: { width: integer(viewport.width, 1, 10000), height: integer(viewport.height, 1, 10000) }, metrics };
}
export function percentile(samples: readonly number[], percentileValue: number): number {
  if (!samples.length || samples.some(sample => !Number.isFinite(sample) || sample < 0)) throw new Error('PERFORMANCE_SAMPLES_INVALID');
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)];
}
export function compareBenchmarks(manifestInput: unknown, baselineInput: unknown, candidateInput: unknown): string[] {
  const manifest = parseBenchmarkManifest(manifestInput), baseline = parseBenchmarkReport(baselineInput), candidate = parseBenchmarkReport(candidateInput);
  if (baseline.commit !== manifest.baselineCommit || baseline.baselineCommit !== manifest.baselineCommit || candidate.baselineCommit !== manifest.baselineCommit
      || baseline.fixtureVersion !== manifest.fixtureVersion || candidate.fixtureVersion !== manifest.fixtureVersion
      || baseline.browser !== candidate.browser || baseline.method !== candidate.method
      || JSON.stringify(baseline.viewport) !== JSON.stringify(candidate.viewport)) throw new Error('PERFORMANCE_COMPARISON_CONTEXT_MISMATCH');
  if (baseline.metrics.length !== candidate.metrics.length) throw new Error('PERFORMANCE_METRIC_COVERAGE_MISMATCH');
  const failures: string[] = [];
  for (const previous of baseline.metrics) {
    const next = candidate.metrics.find(metric => metric.id === previous.id);
    if (!next || next.kind !== previous.kind || next.samples.length !== previous.samples.length) throw new Error('PERFORMANCE_METRIC_COVERAGE_MISMATCH');
    for (const p of [0.5, 0.95]) {
      const before = percentile(previous.samples, p), after = percentile(next.samples, p);
      const noise = previous.kind === 'duration' ? manifest.budgets.browserNoiseMs : previous.kind === 'database-duration' ? manifest.budgets.databaseNoiseMs : 0;
      const limit = noise ? before + Math.max(before * manifest.budgets.relative, noise) : before;
      if (after > limit) failures.push(`${previous.id} p${p * 100}: ${after.toFixed(2)} exceeds ${limit.toFixed(2)} (baseline ${before.toFixed(2)})`);
    }
  }
  return failures;
}
