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
const buildCommit = 'b'.repeat(40);
const prHead = 'c'.repeat(40);
const tree = 'd'.repeat(40);

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
    if (url.endsWith(`/commits/${commit}/pulls?per_page=100`)) return [];
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

function mergedPagesProofFixture({ mainRefs = [commit, commit] } = {}) {
  const pr = { number: 42, merged: true, merged_at: '2026-09-28T00:00:00Z', draft: false, merge_commit_sha: commit,
    base: { ref: 'main', repo: { full_name: repository } }, head: { sha: prHead, repo: { full_name: repository } } };
  const run = { id: 12, run_number: 4, run_attempt: 1, workflow_id: 9,
    path: '.github/workflows/performance-monitor.yml', event: 'pull_request', head_sha: prHead,
    head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' };
  const jobs = [{ id: 2, run_id: run.id, head_sha: prHead, name: 'validation / release-gate',
    status: 'completed', conclusion: 'success',
    steps: [{ name: 'Require every safety lane for this commit', status: 'completed', conclusion: 'success' }] }];
  const artifacts = [
    { id: 30, name: `release-site-${buildCommit}` },
    { id: 31, name: `release-proof-${buildCommit}-1` }
  ].map(artifact => ({ ...artifact, expired: false, expires_at: '2999-01-01T00:00:00Z',
    workflow_run: { id: run.id, head_sha: prHead } }));
  const state = { pr, run, runs: [run], jobs, artifacts,
    workflow: { id: 9, path: run.path, state: 'active' },
    merged: { sha: commit, tree: { sha: tree } },
    built: { sha: buildCommit, tree: { sha: tree }, parents: [{ sha: prHead }] },
    mainRefs: [...mainRefs], mainRefReads: 0 };
  const api = async url => {
    if (url.endsWith('/git/ref/heads/main')) {
      const index = state.mainRefReads++;
      return { object: { sha: state.mainRefs[Math.min(index, state.mainRefs.length - 1)] } };
    }
    if (url.endsWith(`/commits/${commit}/pulls?per_page=100`)) return [state.pr];
    if (url.endsWith('/pulls/42')) return state.pr;
    if (url.endsWith('/actions/workflows/performance-monitor.yml')) return state.workflow;
    if (url.includes('/actions/workflows/9/runs?')) {
      return url.includes('event=pull_request')
        ? { total_count: state.runs.length, workflow_runs: state.runs }
        : { total_count: 0, workflow_runs: [] };
    }
    if (url.includes('/attempts/1/jobs?')) return { total_count: state.jobs.length, jobs: state.jobs };
    if (url.endsWith('/actions/runs/12/artifacts?per_page=100')) return { total_count: state.artifacts.length, artifacts: state.artifacts };
    if (url.endsWith(`/git/commits/${commit}`)) return state.merged;
    if (url.endsWith(`/git/commits/${buildCommit}`)) return state.built;
    throw new Error(`Unexpected Pages proof API request: ${url}`);
  };
  return { api, state };
}

test('merged PR Pages proof authorizes exact current-main Code.gs deployment without a manual main run', async () => {
  const result = await authorizeProductionRelease({ repository, eventName: 'push', ref: 'refs/heads/main',
    commit, api: mergedPagesProofFixture().api });
  assert.equal(result.commit, commit);
  assert.deepEqual(result.proof, {
    reuse: true, schemaVersion: 'gnc-release-proof-v1', repository, commit: buildCommit,
    mergedCommit: commit, tree, runId: 12, attempt: 1, siteArtifactId: 30, proofArtifactId: 31
  });
});

test('Pages proof still requires the merge commit to be exact current main', async () => {
  await assert.rejects(authorizeProductionRelease({ repository, eventName: 'push', ref: 'refs/heads/main',
    commit, api: mergedPagesProofFixture({ mainRefs: ['b'.repeat(40), 'b'.repeat(40)] }).api }),
  /PRODUCTION_RELEASE_GUARD_COMMIT_NOT_CURRENT_MAIN/);
});

test('main advancing during proof lookup rejects a merged PR proof', async () => {
  await assert.rejects(authorizeProductionRelease({ repository, eventName: 'push', ref: 'refs/heads/main',
    commit, api: mergedPagesProofFixture({ mainRefs: [commit, 'b'.repeat(40)] }).api }),
  /PRODUCTION_RELEASE_GUARD_COMMIT_NOT_CURRENT_MAIN/);
});

test('main advancing during legacy manual proof lookup rejects authorization', async () => {
  const original = releaseApi();
  let mainReads = 0;
  const api = async url => {
    if (url.endsWith('/git/ref/heads/main')) {
      mainReads++;
      return { object: { sha: mainReads === 1 ? commit : 'b'.repeat(40) } };
    }
    return original(url);
  };
  await assert.rejects(authorizeProductionRelease({ repository, eventName: 'workflow_dispatch',
    ref: 'refs/heads/main', commit, api }), /PRODUCTION_RELEASE_GUARD_COMMIT_NOT_CURRENT_MAIN/);
});

for (const [name, mutate] of [
  ['tree mismatch', f => { f.state.built.tree.sha = 'f'.repeat(40); }],
  ['fork PR', f => { f.state.pr.head.repo.full_name = 'fork/app'; }],
  ['failed latest run', f => { f.state.run.conclusion = 'failure'; }],
  ['newer failed validation attempt', f => { f.state.runs.push({ ...f.state.run, id: 13,
    run_number: 5, run_attempt: 2, conclusion: 'failure' }); }],
  ['expired site artifact', f => { f.state.artifacts[0].expired = true; }],
  ['expired proof artifact', f => { f.state.artifacts[1].expires_at = '2000-01-01T00:00:00Z'; }],
  ['invalid artifact association', f => { f.state.artifacts[1].workflow_run.id = 13; }],
]) test(`Apps Script guard rejects Pages proof with ${name}`, async () => {
  const fixture = mergedPagesProofFixture();
  mutate(fixture);
  await assert.rejects(authorizeProductionRelease({ repository, eventName: 'push', ref: 'refs/heads/main',
    commit, api: fixture.api }), /(?:PAGES_RELEASE|RELEASE_PROOF)_/);
});

test('Pages selector API errors fail closed instead of bypassing to a manual proof', async () => {
  const calls = [];
  const api = async url => {
    calls.push(url);
    if (url.endsWith('/git/ref/heads/main')) return { object: { sha: commit } };
    throw new Error('GITHUB_API_UNAVAILABLE');
  };
  await assert.rejects(authorizeProductionRelease({ repository, eventName: 'push', ref: 'refs/heads/main', commit, api }),
    /GITHUB_API_UNAVAILABLE/);
  assert.deepEqual(calls, [`repos/${repository}/git/ref/heads/main`, `repos/${repository}/commits/${commit}/pulls?per_page=100`]);
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

test('database diagnosis is explicit, read-only, and cannot authorize a release', () => {
  const workflow = yaml.load(fs.readFileSync('.github/workflows/apps-script-sync.yml', 'utf8'));
  assert.equal(workflow.on.workflow_dispatch.inputs.diagnose_database.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch.inputs.diagnose_database.default, false);
  const diagnostic = workflow.jobs['diagnose-database'];
  assert.match(diagnostic.if, /github.event_name == 'workflow_dispatch' && inputs.diagnose_database/);
  assert.match(diagnostic.if, /github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(diagnostic.if, /codex|startsWith/);
  assert.deepEqual(diagnostic.permissions, { contents: 'read' });
  assert.equal(diagnostic.outputs, undefined);
  const probe = diagnostic.steps.find(step => step.run?.endsWith(' --diagnose'));
  assert.equal(probe.run, 'node scripts/apply-item-low-stock-migration.mjs --diagnose');
  assert.deepEqual(Object.keys(probe.env).sort(), ['SUPABASE_DB_URL', 'SUPABASE_URL']);
  assert.doesNotMatch(JSON.stringify(diagnostic), /APPS_SCRIPT_|GH_TOKEN|pages-static|sync-codegs/);
  assert.match(workflow.jobs['authorize-production'].if, /!inputs.diagnose_database/);
  assert.equal(workflow.jobs['sync-codegs'].needs, 'authorize-production');
  assert.deepEqual(workflow.jobs['publish-pages'].needs, ['authorize-production', 'sync-codegs']);
});
