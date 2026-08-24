import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER,
  REQUEST_LIFECYCLE_POLICY_VERSION,
  syncAppsScriptProject
} from '../scripts/apps-script-sync-lib.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const source = `const DEPLOYED_COMMIT = '${APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER}';`;

function makeScript({ versionCount = 0, createdVersion = 201, deployedVersion = createdVersion } = {}) {
  const calls = [];
  const script = {
    projects: {
      versions: {
        list: async () => {
          calls.push('versions.list');
          return { data: { versions: Array.from({ length: versionCount }, (_, index) => ({ versionNumber: index + 1 })) } };
        },
        create: async () => {
          calls.push('versions.create');
          return { data: { versionNumber: createdVersion } };
        }
      },
      getContent: async () => {
        calls.push('getContent');
        return { data: { files: [{ name: 'Code', type: 'SERVER_JS', source: 'old' }] } };
      },
      updateContent: async (request) => {
        calls.push('updateContent');
        script.updatedSource = request.requestBody.files[0].source;
        return { data: {} };
      },
      deployments: {
        update: async () => {
          calls.push('deployments.update');
          return { data: {} };
        },
        get: async () => {
          calls.push('deployments.get');
          return { data: { deploymentConfig: { versionNumber: deployedVersion } } };
        }
      }
    }
  };
  return { script, calls };
}

function healthyFetch(overrides = {}) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      ok: true,
      deployedCommit: sha,
      lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_POLICY_VERSION,
      requiredRecipientCount: 3,
      ...overrides
    })
  });
}

test('full capacity fails before editable Apps Script source is touched', async () => {
  const { script, calls } = makeScript({ versionCount: 200 });
  await assert.rejects(
    syncAppsScriptProject({ script, scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha }),
    (error) => error.code === 'APPS_SCRIPT_VERSION_CAPACITY_EXHAUSTED'
  );
  assert.deepEqual(calls, ['versions.list']);
});

test('capacity at 180 warns but still permits an editable-source-only sync', async () => {
  const { script, calls } = makeScript({ versionCount: 180 });
  const warnings = [];
  const result = await syncAppsScriptProject({
    script,
    scriptId: 'script',
    source: 'const healthy = true;',
    logger: { warn: (message) => warnings.push(message) }
  });
  assert.equal(result.versionCountBefore, 180);
  assert.equal(result.deploymentUpdated, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /APPS_SCRIPT_VERSION_CAPACITY_LOW/);
  assert.deepEqual(calls, ['versions.list', 'getContent', 'updateContent']);
});

test('successful sync advances and verifies the exact deployment version and health policy', async () => {
  const { script, calls } = makeScript({ versionCount: 30, createdVersion: 202, deployedVersion: 202 });
  const result = await syncAppsScriptProject({
    script,
    scriptId: 'script',
    deploymentId: 'deployment',
    source,
    githubSha: sha,
    fetchImpl: healthyFetch(),
    sleep: async () => {},
    healthAttempts: 1
  });
  assert.equal(result.versionNumber, 202);
  assert.equal(result.deployedVersionNumber, 202);
  assert.equal(result.health.requiredRecipientCount, 3);
  assert.ok(script.updatedSource.includes(sha));
  assert.ok(!script.updatedSource.includes(APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER));
  assert.deepEqual(calls, [
    'versions.list',
    'getContent',
    'updateContent',
    'versions.create',
    'deployments.update',
    'deployments.get'
  ]);
});

test('deployment version mismatch is rejected before health is accepted', async () => {
  const { script } = makeScript({ versionCount: 30, createdVersion: 202, deployedVersion: 201 });
  await assert.rejects(
    syncAppsScriptProject({
      script,
      scriptId: 'script',
      deploymentId: 'deployment',
      source,
      githubSha: sha,
      fetchImpl: healthyFetch(),
      sleep: async () => {},
      healthAttempts: 1
    }),
    (error) => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH'
  );
});

test('stale lifecycle recipient policy is rejected after deployment advancement', async () => {
  const { script } = makeScript({ versionCount: 30, createdVersion: 202, deployedVersion: 202 });
  await assert.rejects(
    syncAppsScriptProject({
      script,
      scriptId: 'script',
      deploymentId: 'deployment',
      source,
      githubSha: sha,
      fetchImpl: healthyFetch({ lifecycleRecipientPolicyVersion: 'stale-policy' }),
      sleep: async () => {},
      healthAttempts: 1
    }),
    (error) => error.code === 'APPS_SCRIPT_DEPLOYMENT_HEALTH_POLICY_MISMATCH'
  );
});
