import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppsScriptSyncPreflight } from '../scripts/apps-script-sync-preflight.mjs';
import { REQUEST_LIFECYCLE_POLICY_VERSION, REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT } from '../scripts/apps-script-sync-lib.mjs';

const repository = 'example/app';
const candidateCommit = 'a'.repeat(40);
const deployedCommit = 'b'.repeat(40);
const candidateBlob = 'c'.repeat(40);
const oldBlob = 'd'.repeat(40);
const receiverPath = 'src/services/photo-archive-receiver.mjs';
const sourceBlobs = new Map([
  ['Code.gs', candidateBlob],
  [receiverPath, 'e'.repeat(40)],
  ['scripts/build-photo-archive-receiver.mjs', 'f'.repeat(40)],
]);
const target = {
  scriptId: 'production-script', deploymentId: 'production-deployment',
  expectedScriptId: 'production-script', expectedDeploymentId: 'production-deployment'
};
const contentsUrl = `https://api.github.com/repos/${repository}/contents/`;
const healthUrl = `https://script.google.com/macros/s/${target.deploymentId}/exec`;
const sourceRequests = commit => [...sourceBlobs.keys()].map(file => ['GET', `${contentsUrl}${file}?ref=${commit}`]);
const candidateRequests = sourceRequests(candidateCommit);
const healthRequest = ['POST', healthUrl];
const preflightRequests = [...candidateRequests, healthRequest, ...sourceRequests(deployedCommit)];

function fixture({ deployedChanges = {}, healthStatus = 200, candidateStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push([options.method || 'GET', url]);
    if (url.startsWith(contentsUrl)) {
      const [file, commit] = url.slice(contentsUrl.length).split('?ref=');
      assert.ok(sourceBlobs.has(file), file);
      assert.ok([candidateCommit, deployedCommit].includes(commit), commit);
      const isCandidate = commit === candidateCommit;
      const status = isCandidate ? candidateStatus : 200;
      const sha = isCandidate ? sourceBlobs.get(file) : deployedChanges[file] ?? sourceBlobs.get(file);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ type: 'file', sha })
      };
    }
    assert.equal(url, healthUrl);
    return {
      ok: healthStatus >= 200 && healthStatus < 300,
      status: healthStatus,
      json: async () => ({
        ok: healthStatus >= 200 && healthStatus < 300,
        deployedCommit,
        lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_POLICY_VERSION,
        requiredRecipientCount: REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT
      }),
      text: async () => JSON.stringify({
        ok: healthStatus >= 200 && healthStatus < 300,
        deployedCommit,
        lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_POLICY_VERSION,
        requiredRecipientCount: REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT
      })
    };
  };
  return { calls, fetchImpl };
}

const run = (f, overrides = {}) => getAppsScriptSyncPreflight({ serviceRoleKey: 'synthetic-signing-key',
  repository, candidateCommit, ...target, token: 'test-token', fetchImpl: f.fetchImpl, ...overrides
});

test('compatible deployed Code.gs and companion sources skip Apps Script version creation', async () => {
  const f = fixture();
  assert.deepEqual(await run(f), { syncRequired: false });
  assert.deepEqual(f.calls, preflightRequests);
});

test('Code.gs mismatch requests a normal guarded Apps Script sync', async () => {
  const f = fixture({ deployedChanges: { 'Code.gs': oldBlob } });
  assert.deepEqual(await run(f), { syncRequired: true });
  assert.deepEqual(f.calls, preflightRequests);
});

test('photo receiver source mismatch requests a normal guarded Apps Script sync', async () => {
  const f = fixture({ deployedChanges: { [receiverPath]: oldBlob } });
  assert.deepEqual(await run(f), { syncRequired: true });
  assert.deepEqual(f.calls, preflightRequests);
});

test('unavailable deployment health requests a normal guarded Apps Script sync', async () => {
  const f = fixture({ healthStatus: 503 });
  assert.deepEqual(await run(f), { syncRequired: true });
  assert.deepEqual(f.calls, [...candidateRequests, healthRequest], 'an unavailable health probe does not retry');
});

test('GitHub candidate-source errors fail closed instead of requesting a sync', async () => {
  const f = fixture({ candidateStatus: 403 });
  await assert.rejects(run(f), /COMPATIBLE_APPS_SCRIPT_GITHUB_CONTENTS_HTTP_403/);
  assert.deepEqual(f.calls, candidateRequests);
});

test('production target configuration errors fail closed before any request', async () => {
  const f = fixture();
  await assert.rejects(run(f, { expectedDeploymentId: '' }), /PRODUCTION_RELEASE_GUARD_EXPECTED_DEPLOYMENT_ID_MISSING/);
  assert.equal(f.calls.length, 0);
});

test('unexpected transport errors fail closed', async () => {
  const error = new Error('network failure');
  const fetchImpl = async () => { throw error; };
  await assert.rejects(getAppsScriptSyncPreflight({ serviceRoleKey: 'synthetic-signing-key', repository, candidateCommit, ...target,
    token: 'test-token', fetchImpl }), error);
});
