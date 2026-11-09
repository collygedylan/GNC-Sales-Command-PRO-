import assert from 'node:assert/strict';
import { syncAppsScriptProject, REQUEST_LIFECYCLE_POLICY_VERSION } from '../../scripts/apps-script-sync-lib.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';
const source = "const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';";
const previousConfig = { versionNumber: 14, manifestFileName: 'retained-manifest', description: 'Previously verified' };
const deploymentId = 'fixture-deployment';

function fixtureDeployment({ failure, pendingRollbackRead, lateSwitch, postConfigFailure }) {
  let active = previousConfig;
  let pendingConfig;
  let lateCandidate;
  let readsAfterSwitch = 0;
  let exactReads = 0;
  const updates = [];
  const events = [];
  const update = async ({ requestBody }) => {
    const candidate = requestBody.deploymentConfig;
    updates.push(candidate);
    events.push(`put:${candidate.versionNumber}`);
    if (failure === 'switch') throw Object.assign(new Error('FIXTURE_SWITCH_FAILED'), { response: { status: 400 } });
    if (lateSwitch && candidate.versionNumber === 15) {
      lateCandidate = { ...candidate, ...lateSwitch.externalChange };
      throw lateSwitch.error;
    }
    if (pendingRollbackRead && candidate.versionNumber === 14) pendingConfig = active;
    active = candidate;
  };
  const get = async ({ fields }) => {
    if (updates.length) readsAfterSwitch += 1;
    if (lateCandidate && readsAfterSwitch === lateSwitch.afterReads) active = lateCandidate;
    if (fields) exactReads += 1;
    if (postConfigFailure && exactReads === 2 && fields) throw new Error('FIXTURE_CONFIG_READ_FAILED');
    events.push(fields ? 'get:config' : 'get:version');
    const config = pendingConfig || active;
    pendingConfig = undefined;
    return { data: { deploymentId, deploymentConfig: config } };
  };
  return { update, get, updates, events, active: () => active, readsAfterSwitch: () => readsAfterSwitch,
    change: change => { active = { ...active, ...change }; } };
}

function fixture({ failure = 'health', externalChange, changeBeforeSwitch, changeDuringRollbackAuthorization,
  pendingRollbackRead, lateSwitch, postConfigFailure } = {}) {
  let authorizations = 0;
  let healthCalls = 0;
  const deployment = fixtureDeployment({ failure, pendingRollbackRead, lateSwitch, postConfigFailure });
  const script = { projects: {
    getContent: async () => ({ data: { files: [{ name: 'Code', type: 'SERVER_JS', source }] } }),
    updateContent: async () => {},
    versions: { list: async () => ({ data: { versions: [{ versionNumber: 14 }] } }),
      create: async () => ({ data: { versionNumber: 15 } }) },
    deployments: { update: deployment.update, get: deployment.get },
  } };
  const fetchHealth = async () => {
    healthCalls += 1;
    const failedHealth = healthCalls > 1 && failure === 'health';
    if (!failedHealth) return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, deployedCommit: commit,
      lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_POLICY_VERSION, requiredRecipientCount: 5 }) };
    if (externalChange) deployment.change(externalChange);
    return { ok: false, status: 503, text: async () => '{}' };
  };
  const authorize = async () => {
    authorizations += 1;
    deployment.events.push('authorize');
    if (authorizations === 2 && changeDuringRollbackAuthorization) deployment.change(changeDuringRollbackAuthorization);
  };
  const run = () => syncAppsScriptProject({ script, scriptId: 'fixture-script', deploymentId, source, githubSha: commit,
    requireVersionCreation: true, rollbackDeployment: { previousConfig, authorize },
    serviceRoleKey: 'fixture-signing-key', healthAttempts: 1, sleep: async delay => deployment.events.push(`wait:${delay}`), logger: { warn() {} },
    verifyPreparedVersion: async () => deployment.events.push('verify:prepared'),
    afterPreparedVersion: async () => {
      deployment.events.push('restore:head');
      if (failure === 'restore') throw new Error('FIXTURE_HEAD_RESTORE_FAILED');
      if (changeBeforeSwitch) deployment.change(changeBeforeSwitch);
    },
    verifyPublishedVersion: async () => {
      if (failure === 'readback') throw new Error('APPS_SCRIPT_SCOPED_DEPLOYED_FILES_MISMATCH');
    },
    recordDeploymentEvidence: async (result, candidateConfig) => {
      assert.equal(result.versionNumber, candidateConfig.versionNumber);
      assert.deepEqual(deployment.active(), candidateConfig);
      deployment.events.push('record:evidence');
      if (failure === 'evidence') throw new Error('FIXTURE_EVIDENCE_WRITE_FAILED');
    },
    fetchImpl: fetchHealth,
  });
  return { ...deployment, run, authorizations: () => authorizations };
}

export async function assertScopedDeploymentRollback() {
  const failedHealth = fixture({ pendingRollbackRead: true });
  await assert.rejects(failedHealth.run(), /APPS_SCRIPT_DEPLOYMENT_HEALTH_HTTP_503/);
  assert.deepEqual(failedHealth.updates.map(config => config.versionNumber), [15, 14]);
  assert.deepEqual(failedHealth.active(), previousConfig);
  assert.equal(failedHealth.authorizations(), 2);
  const failedReadback = fixture({ failure: 'readback' });
  await assert.rejects(failedReadback.run(), /APPS_SCRIPT_SCOPED_DEPLOYED_FILES_MISMATCH/);
  assert.deepEqual(failedReadback.updates.map(config => config.versionNumber), [15, 14]);
  assert.deepEqual(failedReadback.active(), previousConfig);
}

export async function assertScopedDeploymentRollbackCounterexamples() {
  for (const externalChange of [{ versionNumber: 16 }, { description: 'Edited externally' }]) {
    const changed = fixture({ externalChange });
    await assert.rejects(changed.run(), error => {
      assert.match(error.message, /APPS_SCRIPT_SCOPED_DEPLOYMENT_CHANGED_DURING_ROLLBACK/);
      assert.match(error.errors[0].message, /APPS_SCRIPT_DEPLOYMENT_HEALTH_HTTP_503/);
      return true;
    });
    assert.equal(changed.updates.length, 1);
    assert.deepEqual(changed.active(), { ...changed.updates[0], ...externalChange });
  }
  const unswitched = fixture({ failure: 'switch' });
  await assert.rejects(unswitched.run(), /FIXTURE_SWITCH_FAILED/);
  assert.deepEqual(unswitched.active(), previousConfig);
  assert.equal(unswitched.updates.length, 1);
  assert.equal(unswitched.readsAfterSwitch(), 0);
}

export async function invariant566() {
  await assertScopedDeploymentRollback();
  await assertScopedDeploymentRollbackCounterexamples();
}

export async function assertScopedDeploymentSuccessBoundary() {
  const success = fixture({ failure: null });
  const result = await success.run();
  assert.equal(result.deployedVersionNumber, 15);
  assert.equal(success.active().manifestFileName, previousConfig.manifestFileName);
  assert.deepEqual(success.events.slice(0, 5), ['verify:prepared', 'restore:head', 'authorize', 'get:config', 'put:15']);
  assert.deepEqual(success.events.slice(-3), ['get:version', 'get:config', 'record:evidence']);

  for (const changeBeforeSwitch of [{ manifestFileName: 'external' }, { description: 'external' }, { versionNumber: 16 }]) {
    const changed = fixture({ changeBeforeSwitch });
    await assert.rejects(changed.run(), /APPS_SCRIPT_SCOPED_DEPLOYMENT_CHANGED/);
    assert.deepEqual(changed.updates, []);
    assert.deepEqual(changed.active(), { ...previousConfig, ...changeBeforeSwitch });
  }
  const failedRestore = fixture({ failure: 'restore' });
  await assert.rejects(failedRestore.run(), /FIXTURE_HEAD_RESTORE_FAILED/);
  assert.deepEqual(failedRestore.updates, []);

  for (const [options, expected] of [[{ postConfigFailure: true }, /DEPLOYMENT_OWNERSHIP_UNVERIFIED/],
    [{ failure: 'evidence' }, /FIXTURE_EVIDENCE_WRITE_FAILED/]]) {
    const failed = fixture(options);
    await assert.rejects(failed.run(), expected);
    assert.deepEqual(failed.updates.map(config => config.versionNumber), [15, 14]);
    assert.deepEqual(failed.active(), previousConfig);
  }
}

export async function assertAmbiguousDeploymentUpdates() {
  for (const detail of [{ code: 'ETIMEDOUT' }, { code: 'ECONNRESET' }, { response: { status: 503 } }]) {
    const error = Object.assign(new Error('FIXTURE_AMBIGUOUS_SWITCH'), detail);
    const late = fixture({ lateSwitch: { error, afterReads: 3 } });
    await assert.rejects(late.run(), actual => actual === error);
    assert.deepEqual(late.updates.map(config => config.versionNumber), [15, 14]);
    assert.deepEqual(late.active(), previousConfig);
  }
  const error = Object.assign(new Error('FIXTURE_AMBIGUOUS_SWITCH'), { code: 'ETIMEDOUT' });
  const unchanged = fixture({ lateSwitch: { error } });
  await assert.rejects(unchanged.run(), actual => actual === error);
  assert.equal(unchanged.readsAfterSwitch(), 6);
  assert.deepEqual(unchanged.updates.map(config => config.versionNumber), [15]);
  assert.deepEqual(unchanged.active(), previousConfig);

  const external = { description: 'external candidate metadata' };
  const changed = fixture({ lateSwitch: { error, afterReads: 2, externalChange: external } });
  const duringAuthorization = fixture({ lateSwitch: { error, afterReads: 2 }, changeDuringRollbackAuthorization: external });
  for (const fixture of [changed, duringAuthorization]) {
    await assert.rejects(fixture.run(), failure => {
      assert.match(failure.message, /APPS_SCRIPT_SCOPED_DEPLOYMENT_CHANGED_DURING_ROLLBACK/);
      assert.equal(failure.errors[0], error);
      return true;
    });
    assert.equal(fixture.updates.length, 1);
    assert.deepEqual(fixture.active(), { ...fixture.updates[0], ...external });
  }
}

export async function invariant568() {
  await assertScopedDeploymentSuccessBoundary();
  await assertAmbiguousDeploymentUpdates();
}
