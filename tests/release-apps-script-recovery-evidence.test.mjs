import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAppsScriptRecoveryEvidence } from '../scripts/apps-script-recovery-evidence.mjs';
import fs from 'node:fs';

const commit = 'a'.repeat(40);
const source = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '${commit}';\nfunction doPost() {}`;

function client({ before = 17, after = before, code = source } = {}) {
  let deploymentReads = 0;
  const calls = [];
  return { calls, projects: {
    deployments: { get: async args => {
      calls.push(['deployment', args]);
      deploymentReads += 1;
      return { data: { deploymentId: 'deployment-1', deploymentConfig: { versionNumber: deploymentReads === 1 ? before : after } } };
    } },
    getContent: async args => {
      calls.push(['content', args]);
      return { data: { files: [{ name: 'Code', type: 'SERVER_JS', source: code }] } };
    }
  } };
}

test('recovery evidence binds the unchanged deployed version to the exact commit source', async () => {
  const script = client();
  const result = await createAppsScriptRecoveryEvidence({
    script, scriptId: 'script-1', deploymentId: 'deployment-1', expectedCommit: commit,
    now: () => Date.parse('2026-09-22T12:00:00Z')
  });
  assert.deepEqual(result, {
    schemaVersion: 'gnc-apps-script-recovery-evidence-v1', commit, versionNumber: 17,
    verifiedAt: '2026-09-22T12:00:00.000Z', sourceDigest: createHash('sha256').update(source).digest('hex')
  });
  assert.deepEqual(script.calls.map(call => call[0]), ['deployment', 'content', 'deployment']);
  assert.equal(script.calls[1][1].versionNumber, 17);
  assert.ok(!JSON.stringify(result).includes('script-1'));
  assert.ok(!JSON.stringify(result).includes('deployment-1'));
  assert.ok(!JSON.stringify(result).includes('function doPost'));
});

test('recovery evidence rejects a mismatched commit and a deployment version race', async () => {
  await assert.rejects(createAppsScriptRecoveryEvidence({
    script: client({ code: source.replace(commit, 'b'.repeat(40)) }), scriptId: 'script-1',
    deploymentId: 'deployment-1', expectedCommit: commit
  }), /COMMIT_MISMATCH/);
  await assert.rejects(createAppsScriptRecoveryEvidence({
    script: client({ before: 17, after: 18 }), scriptId: 'script-1',
    deploymentId: 'deployment-1', expectedCommit: commit
  }), /DEPLOYMENT_CHANGED_DURING_VERIFICATION/);
});

test('sync workflow retains only the sanitized recovery evidence artifact', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/apps-script-sync.yml', import.meta.url), 'utf8');
  const sync = fs.readFileSync(new URL('../scripts/sync-codegs-to-apps-script.js', import.meta.url), 'utf8');
  assert.match(workflow, /path: \.gnc-local\/apps-script-recovery-evidence\.json/);
  assert.ok(!workflow.includes('sandbox.json'));
  assert.match(sync, /createAppsScriptRecoveryEvidence/);
  assert.match(sync, /apps-script-recovery-evidence\.json/);
});
