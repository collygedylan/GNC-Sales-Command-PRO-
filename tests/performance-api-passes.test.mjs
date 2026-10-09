// @test-group: foundation
import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateApiPassReports, API_PAIR_SCHEDULE } from '../scripts/performance-api-passes.mjs';
import { compareBenchmarks, parseBenchmarkManifest } from '../services/performanceBaseline.ts';
import { readFileSync } from 'node:fs';

const manifest = parseBenchmarkManifest(JSON.parse(readFileSync(new URL('../performance/baseline.json', import.meta.url), 'utf8')));
const baselineCommit = manifest.baselineCommit;
const candidateCommit = 'b'.repeat(40);
const scenarioEvidence = [{ scenario: 'lookup.10k.admin.first', total: 10_000, offset: 0, expectedPageDigest: 'c'.repeat(64) }];
const fixtureEvidence = [
  { scenario: 'fixture.10k.physical-relation-size', heapBytes: 8192, indexBytes: 4096, totalBytes: 12288,
    sharedBuffersFlushed: false, purpose: 'observe table/index storage after deterministic fixture seeding and ANALYZE' },
  { scenario: 'fixture.10k.null-last-updated', rows: 10,
    purpose: 'exercise descending queue order with NULLS LAST as used by app-api' },
  { scenario: 'fixture.100k.physical-relation-size', heapBytes: 65536, indexBytes: 32768, totalBytes: 98304,
    sharedBuffersFlushed: false, purpose: 'observe table/index storage after deterministic fixture seeding and ANALYZE' },
  { scenario: 'fixture.100k.null-last-updated', rows: 100,
    purpose: 'exercise descending queue order with NULLS LAST as used by app-api' },
];

function report(commit, artifactDigest, value = 100, options = {}) {
  const metrics = options.metrics || [{ id: 'api.lookup.10k.admin.first.response_ms', kind: 'duration', samples: Array(15).fill(value) }];
  return { schemaVersion: 1, commit, baselineCommit, artifactDigest, fixtureVersion: manifest.fixtureVersion,
    browser: 'authenticated-http-local', viewport: { width: 1, height: 1 },
    method: 'paired-serial-v1', metrics,
    diagnostics: { scenarios: options.scenarios || [...fixtureEvidence, ...scenarioEvidence].map(entry => ({ ...entry })) } };
}

function passes({ baselineValue = 100, candidateValue = 100, options = {} } = {}) {
  let baselinePass = 0, candidatePass = 0;
  return API_PAIR_SCHEDULE.map(revision => ({ revision, report: revision === 'baseline'
    ? report(baselineCommit, 'a'.repeat(64), baselineValue + baselinePass++, options.baseline)
    : report(candidateCommit, 'd'.repeat(64), candidateValue + candidatePass++, options.candidate) }));
}

const aggregate = entries => aggregateApiPassReports(entries, { baselineCommit, candidateCommit,
  expectedSamplesPerPass: manifest.coldSamples + manifest.warmSamples });

test('API aggregation enforces alternating three-pass order and pools every raw sample', () => {
  const entries = passes();
  const { baseline, candidate } = aggregate(entries);
  assert.deepEqual(API_PAIR_SCHEDULE, ['baseline', 'candidate', 'candidate', 'baseline', 'baseline', 'candidate']);
  assert.equal(baseline.metrics[0].samples.length, 45);
  assert.equal(candidate.metrics[0].samples.length, 45);
  assert.deepEqual(baseline.metrics[0].samples.slice(0, 15), Array(15).fill(100));
  assert.deepEqual(baseline.metrics[0].samples.slice(15, 30), Array(15).fill(101));
  assert.equal(baseline.diagnostics.pairedPasses.passes.length, 3);
  assert.equal(candidate.diagnostics.pairedPasses.revision, 'candidate');
});

test('API aggregation rejects mixed worker policies across baseline and candidate passes', () => {
  const mixedPolicy = passes();
  mixedPolicy[2].report.method = 'local-disposable-postgres-authenticated-app-api-v1; edge-runtime=per_worker';
  assert.throws(() => aggregate(mixedPolicy), /PASS_CONTEXT_MISMATCH/);
});

test('API aggregation requires complete metric sets, sample counts, and stable response parity', () => {
  const missingPass = passes().slice(0, 5);
  assert.throws(() => aggregateApiPassReports(missingPass, { baselineCommit, candidateCommit }), /PASS_COUNT_INVALID/);

  const wrongOrder = passes();
  [wrongOrder[0], wrongOrder[1]] = [wrongOrder[1], wrongOrder[0]];
  assert.throws(() => aggregate(wrongOrder), /PASS_ORDER_INVALID/);

  const missingMetric = passes();
  missingMetric[4].report.metrics = [];
  assert.throws(() => aggregate(missingMetric), /METRIC_COVERAGE_MISMATCH/);

  const changedSampleCount = passes();
  changedSampleCount[0].report.metrics[0].samples.pop();
  assert.throws(() => aggregate(changedSampleCount), /METRIC_COVERAGE_MISMATCH/);

  const allShort = passes();
  for (const entry of allShort) entry.report.metrics[0].samples.pop();
  assert.throws(() => aggregate(allShort), /METRIC_COVERAGE_MISMATCH/);

  const extraMetric = passes();
  extraMetric[2].report.metrics.push({ id: 'unexpected.metric', kind: 'duration', samples: Array(15).fill(1) });
  assert.throws(() => aggregate(extraMetric), /METRIC_COVERAGE_MISMATCH/);

  const changedRows = passes();
  changedRows[5].report.diagnostics.scenarios = [...fixtureEvidence, { ...scenarioEvidence[0], expectedPageDigest: 'e'.repeat(64) }];
  assert.throws(() => aggregate(changedRows), /RESULTS_CHANGED/);

  const crossRevisionRows = passes();
  crossRevisionRows[1].report.diagnostics.scenarios = [...fixtureEvidence, { ...scenarioEvidence[0], total: 9_999 }];
  assert.throws(() => aggregate(crossRevisionRows), /RESULTS_CHANGED/);

  const badFixture = passes();
  badFixture[0].report.diagnostics.scenarios[0].heapBytes = '8192';
  assert.throws(() => aggregate(badFixture), /FIXTURE_EVIDENCE_INVALID/);
});

test('paired API samples retain the strict restoration policy and use the temporary time ceiling', () => {
  const strictManifest = parseBenchmarkManifest({ ...manifest, temporaryTimingAllowance: undefined });
  const allowed = passes({ baselineValue: 100, candidateValue: 114 });
  const allowedReports = aggregate(allowed);
  assert.deepEqual(compareBenchmarks(strictManifest, allowedReports.baseline, allowedReports.candidate), []);

  const rejected = passes({ baselineValue: 100, candidateValue: 126 });
  const rejectedReports = aggregate(rejected);
  assert.match(compareBenchmarks(strictManifest, rejectedReports.baseline, rejectedReports.candidate).join('\n'), /p95.*exceeds/);
  assert.deepEqual(compareBenchmarks(manifest, rejectedReports.baseline, rejectedReports.candidate), []);
  const fixedMetrics = value => [{ id: 'api.lookup.10k.admin.first.response_ms', kind: 'duration', samples: Array(15).fill(value) }];
  const atLimit = aggregate(passes({ options: { baseline: { metrics: fixedMetrics(100) }, candidate: { metrics: fixedMetrics(250) } } }));
  assert.deepEqual(compareBenchmarks(manifest, atLimit.baseline, atLimit.candidate), []);
  const overLimit = aggregate(passes({ options: { baseline: { metrics: fixedMetrics(100) }, candidate: { metrics: fixedMetrics(251) } } }));
  assert.match(compareBenchmarks(manifest, overLimit.baseline, overLimit.candidate).join('\n'), /p95.*exceeds/);
  assert.equal(manifest.budgets.relative, 0.15);
  assert.equal(manifest.budgets.browserNoiseMs, 25);
});

test('API aggregation rejects duplicated metric IDs and revision commits', () => {
  const duplicate = passes();
  duplicate[0].report.metrics.push({ ...duplicate[0].report.metrics[0] });
  assert.throws(() => aggregate(duplicate), /METRIC_DUPLICATE/);

  const badCommit = passes();
  badCommit[0].report.commit = 'f'.repeat(40);
  assert.throws(() => aggregate(badCommit), /PASS_COMMIT_MISMATCH/);

  const badBaseline = passes();
  badBaseline[0].report.baselineCommit = 'f'.repeat(40);
  assert.throws(() => aggregate(badBaseline), /PASS_COMMIT_MISMATCH/);
});
