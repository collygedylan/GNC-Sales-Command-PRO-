import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFingerprintRepair, publishFingerprintRepair } from '../scripts/repair-apps-script-fingerprint.mjs';
import { appsScriptFilesDigest } from '../scripts/apps-script-health-fingerprint.mjs';

const oldCommit = 'a'.repeat(40);
const expectedCommit = 'b'.repeat(40);
const source = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '${oldCommit}';
function getAppsScriptDeploymentHealth_() { return {ok: true}; }
function remoteOnlyRoute_() { return 'preserved'; }
`;
const localSource = source.replace(oldCommit, '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__');
const files = code => [{ name: 'Code', type: 'SERVER_JS', source: code },
  { name: 'appsscript', type: 'JSON', source: '{"timeZone":"America/Chicago"}' }];

function fixture(failure = '') {
  const snapshot = { webFiles: files(source), headFiles: files(source + 'const unpublished = true;\n'),
    deployment: { deploymentId: 'AKfycbwhH-eB5Py3xCwhmWReOAcAfl9Zu6mkw0hZYnAbIP9lLANoE4iebK1hXa6-ogU4_1AURA',
      deploymentConfig: { scriptId: '1mDwtEXFHmvnVANlQAB6cPqnW8F4AqcKeOsLolLYhvQgf2K3Qu_QKCpXT',
        versionNumber: 378, manifestFileName: 'appsscript', description: 'existing' },
      entryPoints: [{ webApp: { entryPointConfig: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' } } }] } };
  snapshot.headDigest = appsScriptFilesDigest(snapshot.headFiles);
  snapshot.webDigest = appsScriptFilesDigest(snapshot.webFiles);
  const state = { head: structuredClone(snapshot.headFiles), deployment: structuredClone(snapshot.deployment),
    version: null, writes: 0 };
  const api = async (url, method = 'GET', body) => {
    if (method === 'GET' && url.endsWith('/content')) return { files: structuredClone(state.head) };
    if (method === 'GET' && url.includes('?versionNumber=')) return { files: state.version };
    if (method === 'GET') return structuredClone(state.deployment);
    state.writes += 1;
    if (method === 'PUT' && url.endsWith('/content')) {
      state.head = structuredClone(body.files);
      return {};
    }
    if (method === 'POST') {
      if (failure === 'create') throw new Error('CREATE_FAILED');
      state.version = structuredClone(state.head);
      return { versionNumber: 379 };
    }
    if (failure === 'deploy') throw new Error('DEPLOY_FAILED');
    if (failure === 'concurrent') state.head = files(source + 'const otherEditor = true;\n');
    state.deployment.deploymentConfig = structuredClone(body.deploymentConfig);
    return {};
  };
  const candidate = prepareFingerprintRepair({ webFiles: snapshot.webFiles, localSource, expectedCommit });
  return { snapshot, state, api, candidate };
}

test('fingerprint candidate retains every deployed byte except the declared commit', () => {
  const { candidate } = fixture();
  assert.equal(candidate.files[0].source, source.replace(oldCommit, expectedCommit));
  assert.equal(candidate.files[1].source, files(source)[1].source);
});

test('changed health helper cannot smuggle runtime logic into a metadata repair', () => {
  assert.throws(() => prepareFingerprintRepair({ webFiles: files(source),
    localSource: localSource.replace('ok: true', 'ok: false'), expectedCommit }), /RUNTIME_CHANGED/);
});

test('successful publication retains permissions and restores unpublished HEAD exactly', async () => {
  const { api, snapshot, state, candidate } = fixture();
  const receipt = await publishFingerprintRepair({ api, snapshot, candidate });
  assert.equal(receipt.version, 379);
  assert.deepEqual(state.head, snapshot.headFiles);
  assert.equal(appsScriptFilesDigest(state.version), candidate.digest);
  assert.deepEqual(state.deployment.entryPoints, snapshot.deployment.entryPoints);
  assert.equal(state.deployment.deploymentConfig.manifestFileName, 'appsscript');
});

for (const phase of ['create', 'deploy']) {
  test(`failed ${phase} restores exact original HEAD`, async () => {
    const { api, snapshot, state, candidate } = fixture(phase);
    await assert.rejects(publishFingerprintRepair({ api, snapshot, candidate }), /FAILED/);
    assert.deepEqual(state.head, snapshot.headFiles);
  });
}

test('preexisting concurrent HEAD edits prevent every mutation', async () => {
  const { api, snapshot, state, candidate } = fixture();
  state.head = files(source + 'const otherEditor = true;\n');
  await assert.rejects(publishFingerprintRepair({ api, snapshot, candidate }), /HEAD_CHANGED/);
  assert.equal(state.writes, 0);
});

test('late concurrent HEAD edits survive rather than being overwritten during restoration', async () => {
  const { api, snapshot, state, candidate } = fixture('concurrent');
  await assert.rejects(publishFingerprintRepair({ api, snapshot, candidate }), /CONCURRENT_HEAD_CHANGE_RETAINED/);
  assert.match(state.head[0].source, /otherEditor/);
});
