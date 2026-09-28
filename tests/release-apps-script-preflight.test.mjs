import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppsScriptSyncPreflight } from '../scripts/apps-script-sync-preflight.mjs';
import { REQUEST_LIFECYCLE_POLICY_VERSION, REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT } from '../scripts/apps-script-sync-lib.mjs';

const repository = 'example/app';
const candidateCommit = 'a'.repeat(40);
const deployedCommit = 'b'.repeat(40);
const candidateBlob = 'c'.repeat(40);
const oldBlob = 'd'.repeat(40);
const target = {
  scriptId: 'production-script', deploymentId: 'production-deployment',
  expectedScriptId: 'production-script', expectedDeploymentId: 'production-deployment'
};

function fixture({ deployedBlob = candidateBlob, healthStatus = 200, candidateStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://api.github.com/')) {
      const isCandidate = String(url).endsWith(`?ref=${candidateCommit}`);
      const status = isCandidate ? candidateStatus : 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ type: 'file', sha: isCandidate ? candidateBlob : deployedBlob })
      };
    }
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

const run = (f, overrides = {}) => getAppsScriptSyncPreflight({
  repository, candidateCommit, ...target, token: 'test-token', fetchImpl: f.fetchImpl, ...overrides
});

test('compatible deployed Code.gs skips Apps Script version creation', async () => {
  const f = fixture();
  assert.deepEqual(await run(f), { syncRequired: false });
  assert.equal(f.calls.length, 3, 'one candidate blob, one health probe, and one deployed blob request');
});

test('Code.gs mismatch requests a normal guarded Apps Script sync', async () => {
  const f = fixture({ deployedBlob: oldBlob });
  assert.deepEqual(await run(f), { syncRequired: true });
  assert.equal(f.calls.length, 3);
});

test('unavailable deployment health requests a normal guarded Apps Script sync', async () => {
  const f = fixture({ healthStatus: 503 });
  assert.deepEqual(await run(f), { syncRequired: true });
  assert.equal(f.calls.length, 2, 'an unavailable health probe does not retry');
});

test('GitHub candidate-source errors fail closed instead of requesting a sync', async () => {
  const f = fixture({ candidateStatus: 403 });
  await assert.rejects(run(f), /COMPATIBLE_APPS_SCRIPT_GITHUB_CONTENTS_HTTP_403/);
  assert.equal(f.calls.length, 1);
});

test('production target configuration errors fail closed before any request', async () => {
  const f = fixture();
  await assert.rejects(run(f, { expectedDeploymentId: '' }), /PRODUCTION_RELEASE_GUARD_EXPECTED_DEPLOYMENT_ID_MISSING/);
  assert.equal(f.calls.length, 0);
});

test('unexpected transport errors fail closed', async () => {
  const error = new Error('network failure');
  const fetchImpl = async () => { throw error; };
  await assert.rejects(getAppsScriptSyncPreflight({ repository, candidateCommit, ...target,
    token: 'test-token', fetchImpl }), error);
});
