import { parseBenchmarkReport } from '../services/performanceBaseline.ts';

export const API_PAIR_SCHEDULE = Object.freeze([
  'baseline', 'candidate',
  'candidate', 'baseline',
  'baseline', 'candidate',
]);
export const API_PASSES_PER_REVISION = 3;

function fail(code) { throw new Error(code); }

function validateFixtureEvidence(entry) {
  const physical = /^fixture\.(10k|100k)\.physical-relation-size$/.exec(entry.scenario);
  if (physical) {
    const expectedKeys = ['heapBytes', 'indexBytes', 'purpose', 'scenario', 'sharedBuffersFlushed', 'totalBytes'];
    if (Object.keys(entry).sort().join('|') !== expectedKeys.sort().join('|')
        || !Number.isSafeInteger(entry.heapBytes) || entry.heapBytes < 0
        || !Number.isSafeInteger(entry.indexBytes) || entry.indexBytes < 0
        || !Number.isSafeInteger(entry.totalBytes) || entry.totalBytes < 0
        || entry.sharedBuffersFlushed !== false
        || entry.purpose !== 'observe table/index storage after deterministic fixture seeding and ANALYZE') {
      fail('PERFORMANCE_API_FIXTURE_EVIDENCE_INVALID');
    }
    return { type: 'physical-relation-size', size: physical[1], heapBytes: entry.heapBytes,
      indexBytes: entry.indexBytes, totalBytes: entry.totalBytes };
  }
  const nullRows = /^fixture\.(10k|100k)\.null-last-updated$/.exec(entry.scenario);
  if (nullRows) {
    const expectedRows = nullRows[1] === '10k' ? 10 : 100;
    if (Object.keys(entry).sort().join('|') !== ['purpose', 'rows', 'scenario'].sort().join('|')
        || entry.rows !== expectedRows
        || entry.purpose !== 'exercise descending queue order with NULLS LAST as used by app-api') {
      fail('PERFORMANCE_API_FIXTURE_EVIDENCE_INVALID');
    }
    return { type: 'null-last-updated', size: nullRows[1], rows: entry.rows };
  }
  return null;
}

function reportEvidence(report) {
  const scenarios = report.diagnostics?.scenarios;
  if (!Array.isArray(scenarios) || !scenarios.length) fail('PERFORMANCE_API_RESULT_EVIDENCE_MISSING');
  const rows = [];
  const fixtureEvidence = [];
  for (const entry of scenarios) {
    if (!entry || typeof entry.scenario !== 'string') fail('PERFORMANCE_API_RESULT_EVIDENCE_INVALID');
    if (entry.scenario.startsWith('fixture.')) {
      const fixture = validateFixtureEvidence(entry);
      if (!fixture) fail('PERFORMANCE_API_FIXTURE_EVIDENCE_INVALID');
      fixtureEvidence.push(fixture);
      continue;
    }
    if (!Number.isSafeInteger(entry.total)
        || !Number.isSafeInteger(entry.offset) || typeof entry.expectedPageDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(entry.expectedPageDigest)) fail('PERFORMANCE_API_RESULT_EVIDENCE_INVALID');
    rows.push({ scenario: entry.scenario, total: entry.total, offset: entry.offset, digest: entry.expectedPageDigest });
  }
  rows.sort((a, b) => a.scenario.localeCompare(b.scenario));
  if (new Set(rows.map(row => row.scenario)).size !== rows.length) fail('PERFORMANCE_API_RESULT_EVIDENCE_DUPLICATE');
  if (!rows.length) fail('PERFORMANCE_API_RESULT_EVIDENCE_EMPTY');
  const fixtureIds = fixtureEvidence.map(({ type, size }) => `${size}.${type}`);
  if (new Set(fixtureIds).size !== fixtureIds.length || fixtureIds.length !== 4) fail('PERFORMANCE_API_FIXTURE_EVIDENCE_INCOMPLETE');
  return { identity: JSON.stringify(rows), rows, fixtureEvidence };
}

function validatedReport(report) {
  if (!Array.isArray(report?.metrics) || !report.metrics.length) fail('PERFORMANCE_API_METRIC_COVERAGE_MISMATCH');
  const parsed = parseBenchmarkReport(report);
  return { ...parsed, diagnostics: report.diagnostics };
}

function aggregateRevision(passReports, revision, expectedCommit, expectedBaselineCommit, expectedSamplesPerPass) {
  if (passReports.length !== API_PASSES_PER_REVISION) fail('PERFORMANCE_API_PASS_COUNT_INVALID');
  const reports = passReports.map(entry => validatedReport(entry.report));
  const first = reports[0];
  if (first.commit !== expectedCommit || first.baselineCommit !== expectedBaselineCommit) fail('PERFORMANCE_API_PASS_COMMIT_MISMATCH');
  const evidence = reportEvidence(first);
  for (const report of reports.slice(1)) {
    if (report.commit !== expectedCommit || report.baselineCommit !== expectedBaselineCommit
        || report.fixtureVersion !== first.fixtureVersion || report.browser !== first.browser
        || report.method !== first.method || JSON.stringify(report.viewport) !== JSON.stringify(first.viewport)
        || report.artifactDigest !== first.artifactDigest) fail('PERFORMANCE_API_PASS_CONTEXT_MISMATCH');
    const nextEvidence = reportEvidence(report);
    if (nextEvidence.identity !== evidence.identity) fail('PERFORMANCE_API_RESULTS_CHANGED');
  }

  const metricIds = first.metrics.map(metric => metric.id);
  if (new Set(metricIds).size !== metricIds.length) fail('PERFORMANCE_API_METRIC_DUPLICATE');
  for (const report of reports) {
    if (report.metrics.length !== metricIds.length || report.metrics.some(metric => !metricIds.includes(metric.id))) {
      fail('PERFORMANCE_API_METRIC_COVERAGE_MISMATCH');
    }
  }
  const metrics = first.metrics.map(metric => {
    const matching = reports.map(report => report.metrics.find(candidate => candidate.id === metric.id));
    if (matching.some(candidate => !candidate || candidate.kind !== metric.kind
        || candidate.samples.length !== expectedSamplesPerPass)) {
      fail('PERFORMANCE_API_METRIC_COVERAGE_MISMATCH');
    }
    return { id: metric.id, kind: metric.kind, samples: matching.flatMap(candidate => candidate.samples) };
  });
  if (!metrics.length) fail('PERFORMANCE_API_METRICS_REQUIRED');
  const method = `${first.method}; paired-api-three-round-order-v1; pooled-${expectedSamplesPerPass * API_PASSES_PER_REVISION}-samples-per-metric`;
  return { ...first, metrics, diagnostics: { ...first.diagnostics,
    pairedPasses: { revision, passes: reports.map((report, index) => {
      const passEvidence = reportEvidence(report);
      return { commit: report.commit, artifactDigest: report.artifactDigest, passIndex: index + 1,
        scenarioCount: passEvidence.rows.length, fixtureEvidence: passEvidence.fixtureEvidence };
    }) } }, method };
}

/** Validate six alternating pass reports and pool every sample per revision. */
export function aggregateApiPassReports(entries, { baselineCommit, candidateCommit, expectedSamplesPerPass } = {}) {
  if (!Array.isArray(entries) || entries.length !== API_PAIR_SCHEDULE.length) fail('PERFORMANCE_API_PASS_COUNT_INVALID');
  if (!/^[a-f0-9]{40}$/.test(baselineCommit || '') || !/^[a-f0-9]{40}$/.test(candidateCommit || '')) {
    fail('PERFORMANCE_API_PASS_COMMIT_INVALID');
  }
  if (!Number.isSafeInteger(expectedSamplesPerPass) || expectedSamplesPerPass < 1) fail('PERFORMANCE_API_SAMPLE_COUNT_INVALID');
  const byRevision = { baseline: [], candidate: [] };
  for (let index = 0; index < API_PAIR_SCHEDULE.length; index += 1) {
    const expectedRevision = API_PAIR_SCHEDULE[index];
    const entry = entries[index];
    if (!entry || entry.revision !== expectedRevision || !entry.report) fail('PERFORMANCE_API_PASS_ORDER_INVALID');
    byRevision[expectedRevision].push(entry);
  }
  const baseline = aggregateRevision(byRevision.baseline, 'baseline', baselineCommit, baselineCommit, expectedSamplesPerPass);
  const candidate = aggregateRevision(byRevision.candidate, 'candidate', candidateCommit, baselineCommit, expectedSamplesPerPass);
  if (baseline.baselineCommit !== candidate.baselineCommit || baseline.fixtureVersion !== candidate.fixtureVersion
      || baseline.browser !== candidate.browser || baseline.method !== candidate.method
      || JSON.stringify(baseline.viewport) !== JSON.stringify(candidate.viewport)) fail('PERFORMANCE_API_COMPARISON_CONTEXT_MISMATCH');
  if (reportEvidence(baseline).identity !== reportEvidence(candidate).identity) fail('PERFORMANCE_API_RESULTS_CHANGED');
  if (baseline.metrics.length !== candidate.metrics.length
      || baseline.metrics.some(metric => !candidate.metrics.some(other => other.id === metric.id
        && other.kind === metric.kind && other.samples.length === metric.samples.length))) {
    fail('PERFORMANCE_API_METRIC_COVERAGE_MISMATCH');
  }
  return { baseline, candidate };
}
