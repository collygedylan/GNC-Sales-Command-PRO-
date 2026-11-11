import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeAppsScriptProjectFiles } from '../src/services/apps-script-project-files.mjs';
import { prepareAppsScriptPublication, restoreAppsScriptHead, verifyScopedAppsScriptFiles } from '../src/services/apps-script-publication-preparation.mjs';
import { applyDeploymentFingerprint, syncAppsScriptProject, REQUEST_LIFECYCLE_POLICY_VERSION } from '../scripts/apps-script-sync-lib.mjs';
import { appsScriptFilesDigest, createAppsScriptSourceGuard } from '../scripts/apps-script-function-patch.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const fingerprint = "const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';";
const deployedCode = fingerprint + '\nfunction handlePhotoArchiveRequest_() { return "old receiver"; }\nfunction retainedWorker() { return "deployed"; }';
const localCode = fingerprint + '\nfunction handlePhotoArchiveRequest_(payload) { return AgDataPhotoArchiveReceiver.createPhotoArchiveReceiver({}).handle(payload); }';
const manifest = { appsScriptPatchFunctions: ['handlePhotoArchiveRequest_'], appsScriptScopedPatchFunctions: ['handlePhotoArchiveRequest_'] };
const previousConfig = { versionNumber: 10, manifestFileName: 'appsscript', description: 'deployed baseline' };

function fixtureScript({ alterCandidate = false, failRestore = false, installedSource = deployedCode, companions = [] } = {}) {
  const installed = [{ name: 'Code', type: 'SERVER_JS', source: installedSource },
    { name: 'appsscript', type: 'JSON', source: '{"timeZone":"America/Chicago"}' }, ...companions];
  const head = installed.map(file => file.name === 'Code' ? { ...file, source: file.source.replace('"deployed"', '"unpublished drift"') } : file)
    .concat({ name: 'UnpublishedHelper', type: 'SERVER_JS', source: 'function unpublishedHelper() {}' });
  let files = head;
  let candidate;
  let deployment = previousConfig;
  const script = { projects: {
    getContent: async ({ versionNumber }) => ({ data: { files: versionNumber === 10 ? installed : versionNumber === 11 ? candidate : files } }),
    updateContent: async ({ requestBody }) => {
      if (failRestore && requestBody.files === head) throw new Error('FIXTURE_HEAD_RESTORE_FAILED');
      files = requestBody.files;
    },
    versions: { list: async () => ({ data: { versions: [{ versionNumber: 10 }] } }),
      create: async () => {
        candidate = alterCandidate ? files.filter(file => file.name !== 'PhotoArchiveReceiver') : files;
        return { data: { versionNumber: 11 } };
      } },
    deployments: { update: async ({ requestBody }) => {
      assert.equal(appsScriptFilesDigest(files), appsScriptFilesDigest(head));
      deployment = requestBody.deploymentConfig;
    },
    get: async () => ({ data: { deploymentId: 'fixture', deploymentConfig: deployment } }) },
  } };
  return { script, head, installed, current: () => files, deployment: () => deployment.versionNumber };
}

async function prepareFixture(fixture) {
  return prepareAppsScriptPublication({ script: fixture.script, scriptId: 'fixture', source: localCode,
    manifest, githubSha: sha, applyFingerprint: applyDeploymentFingerprint, deployedVersion: 10 });
}

async function scopedFixturePublish(fixture, prepared) {
  const { script } = fixture;
  const authorize = async () => {};
  const verify = versionNumber => verifyScopedAppsScriptFiles({ script, scriptId: 'fixture', versionNumber, expectedDigest: prepared.publishedDigest });
  let restorationAttempted = false;
  const restoreHead = async () => {
    restorationAttempted = true;
    await restoreAppsScriptHead({ ...prepared, script, scriptId: 'fixture', authorize });
  };
  try {
    return await syncAppsScriptProject({ script, scriptId: 'fixture', deploymentId: 'fixture', source: prepared.source,
      githubSha: sha, companionFiles: prepared.companionFiles, deployedBaseFiles: prepared.deployedBaseFiles,
      requireVersionCreation: true, verifyPreparedVersion: verify, afterPreparedVersion: restoreHead,
      verifyPublishedVersion: verify, rollbackDeployment: { previousConfig, authorize }, serviceRoleKey: 'synthetic-fixture-secret',
      beforeMutation: createAppsScriptSourceGuard({ script, scriptId: 'fixture', beforeDigest: prepared.expectedRemoteDigest,
        afterDigest: prepared.publishedDigest, authorize }),
      fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ ok: true, deployedCommit: sha,
        lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_POLICY_VERSION, requiredRecipientCount: 5 }) }),
      healthAttempts: 1,
    });
  } catch (error) {
    if (!restorationAttempted) await restoreHead();
    throw error;
  }
}

test('scoped companion publication verifies installed files and restores byte-identical unpublished HEAD', async () => {
  const fixture = fixtureScript();
  const prepared = await prepareFixture(fixture);
  assert.match(prepared.source, /return "deployed"/);
  assert.doesNotMatch(prepared.source, /unpublished drift/);
  assert.equal(prepared.companionFiles[0].name, 'PhotoArchiveReceiver');
  const result = await scopedFixturePublish(fixture, prepared);
  assert.equal(result.deployedVersionNumber, 11);
  assert.equal(appsScriptFilesDigest(fixture.current()), appsScriptFilesDigest(fixture.head));
});

test('missing or changed immutable companion cannot replace the active deployment', async () => {
  const fixture = fixtureScript({ alterCandidate: true });
  const prepared = await prepareFixture(fixture);
  await assert.rejects(scopedFixturePublish(fixture, prepared), /APPS_SCRIPT_SCOPED_DEPLOYED_FILES_MISMATCH/);
  assert.equal(fixture.deployment(), 10);
  assert.equal(appsScriptFilesDigest(fixture.current()), appsScriptFilesDigest(fixture.head));
  assert.throws(() => mergeAppsScriptProjectFiles({ files: fixture.installed, source: localCode }), /COMPANION_MISSING/);
  assert.throws(() => mergeAppsScriptProjectFiles({ files: fixture.installed, source: localCode,
    companionFiles: [{ name: 'UnpublishedHelper', type: 'SERVER_JS', source: 'function fake() {}' }] }), /COMPANION_ALLOWLIST_INVALID/);
});

test('a failed HEAD restoration prevents the candidate deployment switch', async () => {
  const fixture = fixtureScript({ failRestore: true });
  const prepared = await prepareFixture(fixture);
  await assert.rejects(scopedFixturePublish(fixture, prepared), /FIXTURE_HEAD_RESTORE_FAILED/);
  assert.equal(fixture.deployment(), 10);
});

test('a release-selected unrelated patch preserves the live photo receiver and unselected Code functions', async () => {
  const companion = { name: 'PhotoArchiveReceiver', type: 'SERVER_JS', source: '/* previously deployed companion */' };
  const unrelated = 'function buildSuspendTagApprovalEmail_() { return "before"; }';
  const installedSource = localCode.replace('.handle(payload)', '.handle("deployed photo request")') + '\n' + unrelated;
  const fixture = fixtureScript({ installedSource, companions: [companion] });
  const prepared = await prepareAppsScriptPublication({ script: fixture.script, scriptId: 'fixture',
    source: localCode + '\n' + unrelated.replace('"before"', '"after"'),
    manifest: { appsScriptPatchFunctions: [...manifest.appsScriptPatchFunctions, 'buildSuspendTagApprovalEmail_'],
      appsScriptScopedPatchFunctions: ['buildSuspendTagApprovalEmail_'] },
    githubSha: sha, applyFingerprint: applyDeploymentFingerprint, deployedVersion: 10 });
  assert.deepEqual(prepared.patchEvidence.functions, ['buildSuspendTagApprovalEmail_']);
  assert.match(prepared.source, /return "after"/);
  assert.match(prepared.source, /\.handle\("deployed photo request"\)/);
  assert.deepEqual(prepared.companionFiles, []);
  const files = mergeAppsScriptProjectFiles({ files: prepared.deployedBaseFiles, source: prepared.source, companionFiles: prepared.companionFiles });
  assert.deepEqual(files.find(file => file.name === 'PhotoArchiveReceiver'), companion);
});

test('the Phase B manifest authorizes exactly its two photo functions and rejects invalid scoped selections', async () => {
  const phaseB = { ...JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
    appsScriptScopedPatchFunctions:['photoArchiveCanonicalRequest_', 'handlePhotoArchiveRequest_'] };
  assert.deepEqual(phaseB.appsScriptScopedPatchFunctions, ['photoArchiveCanonicalRequest_', 'handlePhotoArchiveRequest_']);
  assert.ok(phaseB.appsScriptScopedPatchFunctions.every(name => phaseB.appsScriptPatchFunctions.includes(name)));
  for (const selected of [undefined, [], ['handlePhotoArchiveRequest_', 'handlePhotoArchiveRequest_'], ['buildSuspendTagApprovalEmail_']]) {
    await assert.rejects(prepareAppsScriptPublication({ deployedVersion: 10,
      manifest: { ...manifest, appsScriptScopedPatchFunctions: selected } }), /APPS_SCRIPT_SCOPED_FUNCTIONS_INVALID/);
  }
});
