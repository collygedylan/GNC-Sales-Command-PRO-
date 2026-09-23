import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  assertProductionAppsScriptTarget,
  assertProductionReleaseContext,
  authorizeProductionRelease,
  verifyAppsScriptDeploymentOwnership
} from '../scripts/lib/production-release-guard.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const commit = 'a'.repeat(40);
const repository = 'example/app';

function releaseApi({ mainCommit = commit } = {}) {
  const run = {
    id: 12,
    run_number: 4,
    run_attempt: 1,
    workflow_id: 9,
    path: '.github/workflows/performance-monitor.yml',
    event: 'workflow_dispatch',
    head_sha: commit,
    head_repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success'
  };
  const job = {
    id: 2,
    run_id: 12,
    head_sha: commit,
    name: 'validation / release-gate',
    status: 'completed',
    conclusion: 'success',
    steps: [{ name: 'Require every safety lane for this commit', status: 'completed', conclusion: 'success' }]
  };
  const artifacts = [
    { id: 30, name: `release-site-${commit}` },
    { id: 31, name: `release-proof-${commit}-1` }
  ].map((artifact) => ({
    ...artifact,
    expired: false,
    expires_at: '2999-01-01T00:00:00Z',
    workflow_run: { id: 12, head_sha: commit }
  }));
  return async (url) => {
    if (url.endsWith('/git/ref/heads/main')) return { object: { sha: mainCommit } };
    if (url.includes('/artifacts?')) return { total_count: artifacts.length, artifacts };
    if (url.includes('/jobs?')) return { total_count: 1, jobs: [job] };
    if (url.includes('/runs?')) return { total_count: 1, workflow_runs: [run] };
    return { id: 9, path: run.path, state: 'active' };
  };
}

test('feature-branch workflow dispatch is rejected before proof lookup', async () => {
  const calls = [];
  const api = async (url) => {
    calls.push(url);
    if (url.endsWith('/git/ref/heads/main')) return { object: { sha: commit } };
    throw new Error('proof lookup must not run');
  };
  await assert.rejects(
    authorizeProductionRelease({ repository, eventName: 'workflow_dispatch', ref: 'refs/heads/feature/repair', commit, api }),
    /PRODUCTION_RELEASE_GUARD_REF_NOT_MAIN/
  );
  assert.deepEqual(calls, [`repos/${repository}/git/ref/heads/main`]);
});

test('old workflow SHA is rejected when main has advanced', async () => {
  await assert.rejects(
    authorizeProductionRelease({ repository, eventName: 'push', ref: 'refs/heads/main', commit, api: releaseApi({ mainCommit: 'b'.repeat(40) }) }),
    /PRODUCTION_RELEASE_GUARD_COMMIT_NOT_CURRENT_MAIN/
  );
});

test('validated exact current-main candidate is authorized', async () => {
  const result = await authorizeProductionRelease({
    repository,
    eventName: 'push',
    ref: 'refs/heads/main',
    commit,
    api: releaseApi()
  });
  assert.equal(result.commit, commit);
  assert.equal(result.proof.siteArtifactId, 30);
});

test('only push or manual events on exact main are eligible', () => {
  assert.throws(
    () => assertProductionReleaseContext({ eventName: 'pull_request', ref: 'refs/heads/main', commit, mainCommit: commit }),
    /PRODUCTION_RELEASE_GUARD_EVENT_NOT_ELIGIBLE/
  );
  assert.equal(
    assertProductionReleaseContext({ eventName: 'workflow_dispatch', ref: 'refs/heads/main', commit, mainCommit: commit }),
    commit
  );
});

test('Apps Script project and deployment must match configured production identities', () => {
  const target = {
    scriptId: 'production-script',
    deploymentId: 'production-deployment',
    expectedScriptId: 'production-script',
    expectedDeploymentId: 'production-deployment'
  };
  assert.deepEqual(assertProductionAppsScriptTarget(target), {
    scriptId: target.scriptId,
    deploymentId: target.deploymentId
  });
  assert.deepEqual(assertProductionAppsScriptTarget({ ...target, expectedScriptId: '' }), {
    scriptId: target.scriptId,
    deploymentId: target.deploymentId
  });
  assert.throws(
    () => assertProductionAppsScriptTarget({ ...target, scriptId: 'wrong-script' }),
    /PRODUCTION_RELEASE_GUARD_SCRIPT_ID_MISMATCH/
  );
  assert.throws(
    () => assertProductionAppsScriptTarget({ ...target, deploymentId: 'wrong-deployment' }),
    /PRODUCTION_RELEASE_GUARD_DEPLOYMENT_ID_MISMATCH/
  );
  assert.throws(
    () => assertProductionAppsScriptTarget({ ...target, expectedDeploymentId: '' }),
    /PRODUCTION_RELEASE_GUARD_EXPECTED_DEPLOYMENT_ID_MISSING/
  );
  assert.throws(
    () => assertProductionAppsScriptTarget({ ...target, deploymentId: '' }),
    /PRODUCTION_RELEASE_GUARD_DEPLOYMENT_ID_MISSING/
  );
});

test('Google must confirm that the configured script owns the production deployment', async () => {
  const calls = [];
  const script = { projects: { deployments: { get: async (request) => {
    calls.push(request);
    return { data: { deploymentId: 'production-deployment', deploymentConfig: { versionNumber: 41 } } };
  } } } };
  const deployment = await verifyAppsScriptDeploymentOwnership({
    script,
    scriptId: 'production-script',
    deploymentId: 'production-deployment'
  });
  assert.equal(deployment.deploymentConfig.versionNumber, 41);
  assert.deepEqual(calls, [{ scriptId: 'production-script', deploymentId: 'production-deployment' }]);

  await assert.rejects(
    verifyAppsScriptDeploymentOwnership({
      script: { projects: { deployments: { get: async () => {
        throw Object.assign(new Error('not found'), { response: { status: 404 } });
      } } } },
      scriptId: 'wrong-project',
      deploymentId: 'production-deployment'
    }),
    /PRODUCTION_RELEASE_GUARD_DEPLOYMENT_OWNERSHIP_UNVERIFIED/
  );
  await assert.rejects(
    verifyAppsScriptDeploymentOwnership({
      script: { projects: { deployments: { get: async () => ({ data: {} }) } } },
      scriptId: 'production-script',
      deploymentId: 'missing-deployment'
    }),
    /PRODUCTION_RELEASE_GUARD_DEPLOYMENT_OWNERSHIP_UNVERIFIED/
  );
});

test('workflow keeps production credentials inside the guarded deploy step', () => {
  const source = fs.readFileSync(new URL('../.github/workflows/apps-script-sync.yml', import.meta.url), 'utf8');
  const workflow = yaml.load(source);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.jobs['authorize-production'].if, /refs\/heads\/main/);
  assert.equal(workflow.jobs['sync-codegs'].needs, 'authorize-production');
  assert.match(workflow.jobs['sync-codegs'].if, /authorized == 'true'/);
  const authorizeSource = JSON.stringify(workflow.jobs['authorize-production']);
  assert.doesNotMatch(authorizeSource, /APPS_SCRIPT_(?:SCRIPT_ID|CLASPRC_JSON|DEPLOYMENT_ID)/);
  const syncSteps = workflow.jobs['sync-codegs'].steps;
  const deploy = syncSteps.find((step) => step.run === 'node scripts/sync-codegs-to-apps-script.js');
  assert.ok(deploy);
  assert.equal(deploy.env.APPS_SCRIPT_SCRIPT_ID, '${{ secrets.APPS_SCRIPT_SCRIPT_ID }}');
  assert.equal(deploy.env.APPS_SCRIPT_DEPLOYMENT_ID, '${{ secrets.APPS_SCRIPT_DEPLOYMENT_ID }}');
  assert.equal(deploy.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(deploy.env.GITHUB_REF, '${{ github.ref }}');
  assert.equal(syncSteps.filter((step) => step.env?.APPS_SCRIPT_CLASPRC_JSON).length, 1);
});

test('deploy script reauthorizes exact main and proof before creating OAuth credentials', () => {
  const source = fs.readFileSync(new URL('../scripts/sync-codegs-to-apps-script.js', import.meta.url), 'utf8');
  const authorization = source.indexOf('await authorizeProductionReleaseFromEnvironment()');
  const oauth = source.indexOf('const claspRc = parseClaspRc(claspRcJson)');
  const ownership = source.indexOf('await verifyAppsScriptDeploymentOwnership({');
  const mutation = source.indexOf('await syncAppsScriptProject({');
  assert.ok(authorization > 0);
  assert.ok(oauth > authorization);
  assert.ok(ownership > oauth);
  assert.ok(mutation > ownership);
});
