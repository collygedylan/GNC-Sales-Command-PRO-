import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { iterateGitHubApiPages, listGitHubApiItems } from './github-api-pagination.mjs';
import { fetchGitHubJson } from './lib/github-json-transport.mjs';

const WORKFLOW_PATH = '.github/workflows/pages-static.yml';

export async function findLastSuccessfulDeploymentBaseline({ repository, currentRunId, currentSha, api, publication = 'any' }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || typeof api !== 'function') {
    throw new Error('RELEASE_BASELINE_INPUT_INVALID');
  }
  const publicationJobs = { any: ['deploy', 'backend-publication'], frontend: ['deploy'], backend: ['backend-publication'] }[publication];
  if (!publicationJobs) throw new Error('RELEASE_BASELINE_PUBLICATION_INVALID');
  const workflow = await api(`repos/${repository}/actions/workflows/pages-static.yml`);
  if (!Number.isSafeInteger(workflow?.id) || workflow.path !== WORKFLOW_PATH || workflow.state !== 'active') {
    throw new Error('RELEASE_BASELINE_WORKFLOW_INVALID');
  }
  // Inspect newest pages first: GitHub caps filtered run searches at 1,000
  // results even when total_count is higher. Older runs are unnecessary once
  // a successful publication has been verified.
  for await (const runs of iterateGitHubApiPages({ api,
    endpoint: `repos/${repository}/actions/workflows/${workflow.id}/runs?branch=main&status=success`,
    field: 'workflow_runs' })) {
    const candidates = runs.filter(run => run.id !== currentRunId && run.path === WORKFLOW_PATH
      && run.head_branch === 'main' && run.head_sha !== currentSha && run.conclusion === 'success'
      && run.head_repository?.full_name?.toLowerCase() === repository.toLowerCase())
      .sort((a, b) => b.run_number - a.run_number);
    for (const run of candidates) {
      const jobs = await listGitHubApiItems({ api,
        endpoint: `repos/${repository}/actions/runs/${run.id}/jobs`, field: 'jobs' });
      if (jobs.some(job => job.status === 'completed' && job.conclusion === 'success'
        && publicationJobs.includes(job.name) && job.head_sha === run.head_sha)) return run.head_sha;
    }
  }
  return '';
}

async function githubApi(endpoint) {
  return fetchGitHubJson({ endpoint, token: process.env.GITHUB_TOKEN });
}

async function main() {
  const base = await findLastSuccessfulDeploymentBaseline({
    repository: process.env.GITHUB_REPOSITORY,
    currentRunId: Number(process.env.GITHUB_RUN_ID),
    currentSha: process.env.RELEASE_BASELINE_INCLUDE_CURRENT === 'true' ? '' : process.env.GITHUB_SHA,
    api: githubApi,
    publication: process.env.RELEASE_BASELINE_PUBLICATION || 'any',
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `commit=${base}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.code || error.message || 'RELEASE_BASELINE_FAILED'); process.exitCode = 1; });
}
