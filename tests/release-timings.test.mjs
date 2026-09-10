import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchReleaseRun, formatReleaseTimings, summarizeReleaseRun } from '../scripts/report-release-timings.mjs';

const at = seconds => new Date(Date.UTC(2026, 8, 9) + seconds * 1000).toISOString();
const step = (name, start, end, conclusion = 'success') => ({ name, startedAt: at(start), completedAt: at(end), conclusion, status: 'completed' });
const job = (name, start, end, steps = [], conclusion = 'success') => ({ name, startedAt: at(start), completedAt: at(end), steps, conclusion, status: 'completed' });
const run = jobs => ({ createdAt: at(0), headSha: 'a'.repeat(40), status: 'completed', conclusion: 'success', jobs, url: 'https://github.com/example/repo/actions/runs/1' });

test('separates publication, deploy step, validation wall time, post checks and summed job minutes', () => {
  const report = summarizeReleaseRun(run([
    job('validation / build', 5, 65),
    job('validation / unit', 5, 95),
    job('validation / compiled (footer)', 70, 130),
    job('validation / release-gate', 135, 140),
    job('deploy', 145, 160, [step('Upload Pages artifact', 147, 151), step('Deploy verified artifact to Pages', 152, 158)]),
    job('exact-live', 162, 175),
    job('post-deployment-canary (requests)', 180, 240),
    job('post-deployment-canary (home)', 180, 270),
    job('report-production-health', 272, 275),
  ]), '123');
  assert.equal(report.elapsedToPublicationSeconds, 158);
  assert.equal(report.deployStepSeconds, 6);
  assert.equal(report.validationCriticalPath.durationSeconds, 135);
  assert.equal(report.validationCriticalPath.elapsedFromCreatedSeconds, 140);
  assert.equal(report.validationCriticalPath.lastCompletingJobOrStep, 'validation / release-gate');
  assert.equal(report.postDeploymentSeconds, 112);
  assert.equal(report.fullRunSeconds, 275);
  assert.equal(report.completedJobMinutes, 6.6);
  assert.equal(report.failures.length, 0);
  assert.match(formatReleaseTimings([report]), /2m 38s/);
});

test('recognizes old serial Pages boundaries without confusing upload with deployment', () => {
  const report = summarizeReleaseRun(run([
    job('deploy', 5, 1487, [
      step('Build v2 beta app', 10, 905), step('Verify AssignedTo review assignment in the compiled shell', 905, 1476),
      step('Upload isolated pre-publish browser diagnostics', 1476, 1476, 'skipped'),
      step('Configure Pages', 1476, 1477), step('Upload Pages artifact', 1477, 1478),
      step('Deploy to Pages', 1478, 1484),
    ]),
    job('post-deployment-canary', 1491, 2270), job('report-production-health', 2273, 2276),
  ]), '34424345738');
  assert.equal(report.elapsedToPublicationSeconds, 1484);
  assert.equal(report.validationCriticalPath.durationSeconds, 1471);
  assert.equal(report.validationCriticalPath.method, 'legacy-prepublish-step-boundary');
  assert.equal(report.postDeploymentSeconds, 786);
  assert.equal(report.fullRunSeconds, 2276);
  assert.equal(report.skipped.length, 1);
  assert.match(formatReleaseTimings([report]), /24m 44s/);
});

test('branch benchmark does not invent a publication and failures/skips remain visible', () => {
  const report = summarizeReleaseRun({ ...run([
    job('validation / build', 5, 65),
    job('validation / unit', 5, 95, [step('Tests', 6, 94, 'failure')], 'failure'),
    job('validation / compiled', 95, 95, [], 'skipped'),
  ]), conclusion: 'failure' }, '2');
  assert.equal(report.elapsedToPublicationSeconds, null);
  assert.equal(report.postDeploymentSeconds, null);
  assert.equal(report.failures.length, 2);
  assert.equal(report.skipped.length, 1);
  assert.match(formatReleaseTimings([report]), /not complete \/ unavailable/);
});

test('running or failed deploy does not count as published or fully verified', () => {
  const active = { ...job('validation / functional (2)', 10, 10), status: 'in_progress', completedAt: null, conclusion: null };
  const report = summarizeReleaseRun({ ...run([
    job('validation / build', 5, 65), active,
    job('deploy', 70, 80, [step('Deploy to Pages', 71, 79, 'failure')], 'failure'),
  ]), status: 'in_progress', conclusion: null });
  assert.equal(report.validationCriticalPath.durationSeconds, null);
  assert.equal(report.elapsedToPublicationSeconds, null);
  assert.equal(report.fullRunSeconds, null);
  assert.equal(report.completedJobsWithDuration, 2);
});

test('read-only gh invocation uses validated IDs, an argument array and shell:false', () => {
  let seen;
  const result = fetchReleaseRun('123', (...args) => { seen = args; return { status: 0, stdout: JSON.stringify(run([])) }; });
  assert.equal(result.jobs.length, 0);
  assert.equal(seen[0], 'gh');
  assert.deepEqual(seen[1], ['run', 'view', '123', '--json', 'createdAt,jobs,status,conclusion,headSha,url']);
  assert.equal(seen[2].shell, false);
  assert.equal(seen[2].windowsHide, true);
  for (const id of ['1; echo secret', '--log', '-1', '1 2', '']) assert.throws(() => fetchReleaseRun(id), /RUN_ID_INVALID/);
  assert.throws(() => fetchReleaseRun('123', () => ({ status: 1, stderr: 'do not expose credentials' })), /^Error: RELEASE_TIMING_READ_FAILED_123$/);
});

test('invalid timestamps and malformed responses cannot produce invented timing data', () => {
  assert.throws(() => summarizeReleaseRun({ jobs: [], createdAt: 'bad' }), /RUN_INVALID/);
  assert.throws(() => fetchReleaseRun('123', () => ({ status: 0, stdout: 'not json' })), /RESPONSE_INVALID/);
});
