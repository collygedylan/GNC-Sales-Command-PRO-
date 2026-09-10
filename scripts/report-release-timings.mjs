import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FIELDS = 'createdAt,jobs,status,conclusion,headSha,url';
const validationName = /(?:^|\/)\s*(?:validation(?:\s*\/|$)|unit$|database(?:-and-functions)?$|build$|functional(?:\s|$)|compiled(?:\s|$)|timing$|lighthouse$|production-health$|release-gate$)/i;
const deployName = /^(?:Deploy to Pages|Deploy verified artifact to Pages|Run actions\/deploy-pages(?:@\S+)?)$/i;
const postName = /(?:^|\/)\s*(?:post-deployment-canary|exact-live)(?:\s|$)/i;
const failed = value => ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(value);
const stamp = value => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const seconds = (start, end) => start !== null && end !== null && end >= start ? (end - start) / 1000 : null;
const clean = value => String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 400);
const rounded = number => Math.round(number * 100) / 100;

export function summarizeReleaseRun(run, runId = '') {
  if (!run || !Array.isArray(run.jobs) || !stamp(run.createdAt)) throw new Error('RELEASE_TIMING_RUN_INVALID');
  const created = stamp(run.createdAt);
  const jobs = run.jobs;
  const deployments = jobs.flatMap(job => (job.steps || []).map(step => ({ job, step })))
    .filter(({ step }) => deployName.test(step.name || '') && step.conclusion === 'success' && stamp(step.completedAt))
    .sort((a, b) => stamp(a.step.completedAt) - stamp(b.step.completedAt));
  const deployed = deployments.at(-1);
  const published = deployed ? stamp(deployed.step.completedAt) : null;
  const validation = jobs.filter(job => validationName.test(job.name || '') && !postName.test(job.name || ''));
  let validationStart = null;
  let validationEnd = null;
  let validationLastJob = '';
  let validationMethod = 'unavailable';
  if (validation.length) {
    const started = validation.map(job => stamp(job.startedAt)).filter(value => value !== null);
    const complete = validation.filter(job => stamp(job.completedAt)).sort((a, b) => stamp(a.completedAt) - stamp(b.completedAt));
    validationStart = started.length ? Math.min(...started) : null;
    // A partial run is not a completed critical path, even if one lane is already green.
    validationEnd = validation.every(job => job.status === 'completed' && stamp(job.completedAt)) ? stamp(complete.at(-1)?.completedAt) : null;
    validationLastJob = clean(complete.at(-1)?.name);
    validationMethod = 'validation-job-wall-interval';
  } else if (deployed) {
    // The old workflow put builds and all pre-publish tests inside the deploy job.
    const steps = deployed.job.steps || [];
    const boundary = steps.findIndex(step => /^(?:Configure Pages|Upload Pages artifact)$/i.test(step.name || '') || deployName.test(step.name || ''));
    const previous = steps.slice(0, boundary).filter(step => step.conclusion === 'success' && stamp(step.completedAt)).at(-1);
    validationStart = stamp(deployed.job.startedAt);
    validationEnd = stamp(previous?.completedAt);
    validationLastJob = clean(previous?.name);
    validationMethod = 'legacy-prepublish-step-boundary';
  }
  const post = jobs.filter(job => postName.test(job.name || ''));
  const postEnd = post.length && post.every(job => job.status === 'completed' && stamp(job.completedAt))
    ? Math.max(...post.map(job => stamp(job.completedAt))) : null;
  const finished = jobs.map(job => stamp(job.completedAt)).filter(value => value !== null);
  const runEnd = run.status === 'completed' && finished.length ? Math.max(...finished) : null;
  const completedDurations = jobs.map(job => job.status === 'completed' ? seconds(stamp(job.startedAt), stamp(job.completedAt)) : null)
    .filter(value => value !== null);
  const failures = [];
  const skipped = [];
  for (const job of jobs) {
    if (failed(job.conclusion)) failures.push({ job: clean(job.name), conclusion: clean(job.conclusion) });
    if (job.conclusion === 'skipped') skipped.push({ job: clean(job.name), conclusion: 'skipped' });
    for (const step of job.steps || []) {
      const entry = { job: clean(job.name), step: clean(step.name), conclusion: clean(step.conclusion) };
      if (failed(step.conclusion)) failures.push(entry);
      if (step.conclusion === 'skipped') skipped.push(entry);
    }
  }
  return {
    runId: clean(runId), url: clean(run.url), commit: clean(run.headSha), status: clean(run.status), conclusion: clean(run.conclusion),
    createdAt: run.createdAt,
    publishedAt: published !== null ? new Date(published).toISOString() : null,
    elapsedToPublicationSeconds: seconds(created, published),
    deployStepSeconds: deployed ? seconds(stamp(deployed.step.startedAt), published) : null,
    validationCriticalPath: {
      method: validationMethod,
      durationSeconds: seconds(validationStart, validationEnd),
      elapsedFromCreatedSeconds: seconds(created, validationEnd),
      lastCompletingJobOrStep: validationLastJob,
      note: 'Observed validation wall interval, including dependency/runner waits; GitHub run-view does not expose a dependency DAG.',
    },
    postDeploymentSeconds: seconds(published, postEnd),
    fullRunSeconds: seconds(created, runEnd),
    completedJobMinutes: rounded(completedDurations.reduce((sum, value) => sum + value, 0) / 60),
    completedJobsWithDuration: completedDurations.length,
    totalJobs: jobs.length,
    jobMinuteNote: 'Sum of completed job durations, not elapsed wall time or exact billable minutes; active jobs are excluded.',
    failures, skipped,
  };
}

export function fetchReleaseRun(runId, invoke = spawnSync) {
  if (!/^[1-9]\d*$/.test(String(runId))) throw new Error('RELEASE_TIMING_RUN_ID_INVALID');
  // An argument array and shell:false prevent run identifiers from becoming shell commands.
  const result = invoke('gh', ['run', 'view', String(runId), '--json', FIELDS], {
    shell: false, encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error(`RELEASE_TIMING_READ_FAILED_${runId}`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`RELEASE_TIMING_RESPONSE_INVALID_${runId}`); }
}

function duration(value) {
  if (value === null) return 'not complete / unavailable';
  const total = Math.round(value);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}
const markdown = value => clean(value).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');

export function formatReleaseTimings(reports) {
  const rows = [
    '# Release timings', '',
    '| Run | Result | To publication | Validation wall interval | Deploy step | Post-deploy | Full run | Completed job minutes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...reports.map(report => `| ${markdown(report.runId)} | ${markdown(report.conclusion || report.status)} | ${duration(report.elapsedToPublicationSeconds)} | ${duration(report.validationCriticalPath.durationSeconds)} | ${duration(report.deployStepSeconds)} | ${duration(report.postDeploymentSeconds)} | ${duration(report.fullRunSeconds)} | ${report.completedJobMinutes} |`),
    '', 'Publication is the successful deploy-pages step, not the later exact-live confirmation. Validation is an observed wall interval, not a reconstructed dependency graph. Job minutes sum completed jobs and must not be compared directly with wall time.',
  ];
  for (const report of reports) {
    rows.push('', `## Run ${markdown(report.runId)}`, '',
      `Last validation boundary: ${markdown(report.validationCriticalPath.lastCompletingJobOrStep || 'unavailable')} (${report.validationCriticalPath.method}).`,
      `Failures: ${report.failures.length}; skipped jobs/steps: ${report.skipped.length}. A skipped diagnostic upload is not a skipped safety gate.`);
    for (const [label, entries] of [['Failure', report.failures], ['Skipped', report.skipped]]) {
      if (entries.length) rows.push('');
      for (const entry of entries) rows.push(`- ${label}: ${markdown(entry.job)}${entry.step ? ` → ${markdown(entry.step)}` : ''} (${markdown(entry.conclusion)})`);
    }
  }
  return `${rows.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const ids = args.filter(value => value !== '--json' && value !== '--markdown');
    if (!ids.length || (json && args.includes('--markdown')) || ids.some(id => !/^[1-9]\d*$/.test(id))) throw new Error('USAGE: report-release-timings.mjs [--json|--markdown] RUN_ID [RUN_ID...]');
    const reports = [...new Set(ids)].map(id => summarizeReleaseRun(fetchReleaseRun(id), id));
    process.stdout.write(json ? `${JSON.stringify(reports, null, 2)}\n` : formatReleaseTimings(reports));
  } catch (error) {
    console.error(clean(error && error.message || 'RELEASE_TIMING_FAILED'));
    process.exitCode = 1;
  }
}
