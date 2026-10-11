// @test-group: backend
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER,
  REQUEST_LIFECYCLE_POLICY_VERSION,
  syncAppsScriptProject,
  verifyDeploymentVersion
} from '../scripts/apps-script-sync-lib.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const source = `const DEPLOYED_COMMIT = '${APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER}';`;

function makeScript({ versionCount = 0, createdVersion = 201, deployedVersion = createdVersion, observedVersions } = {}) {
  const calls = [];
  let deploymentReads = 0;
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
        get: async (request, options) => {
          calls.push('deployments.get');
          script.lastDeploymentRead = { request, options };
          const version = observedVersions
            ? observedVersions[Math.min(deploymentReads++, observedVersions.length - 1)] : deployedVersion;
          return { data: { deploymentConfig: { versionNumber: version } } };
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
  const { script, calls } = makeScript({ versionCount: 30, createdVersion: 202, deployedVersion: 201 });
  const sleeps = [];
  let healthReads = 0;
  await assert.rejects(
    syncAppsScriptProject({
      script,
      scriptId: 'script',
      deploymentId: 'deployment',
      source,
      githubSha: sha,
      fetchImpl: async () => { healthReads += 1; return healthyFetch()(); },
      sleep: async ms => { sleeps.push(ms); },
      logger: { warn() {} },
      healthAttempts: 1
    }),
    (error) => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH'
  );
  assert.equal(healthReads, 0);
  assert.equal(calls.filter(call => call === 'deployments.get').length, 13);
  assert.deepEqual(sleeps, Array(12).fill(5000));
  for (const mutation of ['updateContent', 'versions.create', 'deployments.update']) {
    assert.equal(calls.filter(call => call === mutation).length, 1, `${mutation} is never retried`);
  }
});

test('stale deployment reads converge without another version or deployment write', async () => {
  const { script, calls } = makeScript({ createdVersion: 202, observedVersions: [200, 201, 202] });
  const sleeps = [];
  const warnings = [];
  let healthReads = 0;
  const result = await syncAppsScriptProject({
    script, scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha,
    sleep: async ms => { sleeps.push(ms); }, logger: { warn: value => warnings.push(value) },
    fetchImpl: async () => { healthReads += 1; return healthyFetch()(); }
  });
  assert.equal(result.deployedVersionNumber, 202);
  assert.equal(healthReads, 1);
  assert.deepEqual(sleeps, [5000, 5000]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(value => value.startsWith('APPS_SCRIPT_DEPLOYMENT_VERSION_PENDING ')));
  assert.deepEqual(calls, ['versions.list', 'getContent', 'updateContent', 'versions.create',
    'deployments.update', 'deployments.get', 'deployments.get', 'deployments.get']);
  assert.deepEqual(script.lastDeploymentRead, {
    request: { scriptId: 'script', deploymentId: 'deployment' },
    options: { timeout: 12000, retry: false }
  });
});

test('newer, missing, and malformed deployment versions fail without polling or health acceptance', async () => {
  for (const [version, expectedCode] of [
    [203, 'ADVANCED'], [undefined, 'INVALID'], [null, 'INVALID'], [true, 'INVALID'],
    ['202', 'INVALID'], [0, 'INVALID'], [202.5, 'INVALID']
  ]) {
    const { script, calls } = makeScript({ createdVersion: 202, observedVersions: [version] });
    await assert.rejects(syncAppsScriptProject({
      script, scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha,
      sleep: async () => assert.fail('must not wait'), fetchImpl: async () => assert.fail('must not accept health')
    }), error => error.code === `APPS_SCRIPT_DEPLOYMENT_VERSION_${expectedCode}`);
    assert.equal(calls.filter(call => call === 'deployments.get').length, 1);
    assert.equal(calls.filter(call => call === 'deployments.update').length, 1);
  }
});

test('version visibility deadline bounds reads even when requests consume the wait budget', async () => {
  let clock = 0;
  const requests = [];
  const script = { projects: { deployments: { get: async (_request, options) => {
    requests.push(options);
    clock += 11000;
    return { data: { deploymentConfig: { versionNumber: 201 } } };
  } } } };
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => clock, sleep: async ms => { clock += ms; }
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  assert.equal(requests.length, 6);
  assert.deepEqual(requests.at(-1), { timeout: 10000, retry: false });
});

test('a newer deployment observed after a stale read stops verification immediately', async () => {
  const { script, calls } = makeScript({ observedVersions: [201, 203, 202] });
  const sleeps = [];
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    sleep: async ms => { sleeps.push(ms); }
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_ADVANCED');
  assert.deepEqual(calls, ['deployments.get', 'deployments.get']);
  assert.deepEqual(sleeps, [5000]);
});

test('an expired deadline prevents the first read or any read after sleep', async () => {
  const first = makeScript({ deployedVersion: 201 });
  let ticks = 0;
  await assert.rejects(verifyDeploymentVersion({
    script: first.script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => ticks++ === 0 ? 0 : 90000
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  assert.deepEqual(first.calls, []);
  const afterSleep = makeScript({ deployedVersion: 201 });
  let clock = 0;
  await assert.rejects(verifyDeploymentVersion({
    script: afterSleep.script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => clock, sleep: async () => { clock = 90000; }
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  assert.deepEqual(afterSleep.calls, ['deployments.get']);
});

test('a matching read after the deadline is not accepted and transport errors are not masked', async () => {
  let clock = 0;
  const script = { projects: { deployments: { get: async () => {
    clock = 90001;
    return { data: { deploymentConfig: { versionNumber: 202 } } };
  } } } };
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => clock, sleep: async () => assert.fail('deadline is exhausted')
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  const denied = Object.assign(new Error('permission denied'), { code: 403 });
  script.projects.deployments.get = async () => { throw denied; };
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    sleep: async () => assert.fail('transport errors are not retried')
  }), error => error === denied);
});

test('invalid verification bounds fail before any API read', async () => {
  for (const invalid of [{ attempts: 0 }, { attempts: 14 }, { retryDelayMs: -1 },
    { retryDelayMs: 5001 }, { versionNumber: 0 }]) {
    const { script, calls } = makeScript();
    await assert.rejects(verifyDeploymentVersion({
      script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202, ...invalid
    }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERIFICATION_CONFIGURATION_INVALID');
    assert.deepEqual(calls, []);
  }
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
