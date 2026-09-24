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
  assert.match(sync, /expectedVersionNumber: result.versionNumber/);
  assert.match(sync, /expectedSource: applyDeploymentFingerprint\(source, githubSha\)/);
  assert.match(sync, /attempts: 13/);
  assert.match(sync, /apps-script-recovery-evidence\.json/);
});

function sequencedClient({ versions = [17, 17], sources = [source] } = {}) {
  const calls = [];
  let reads = 0, contentReads = 0;
  return { calls, projects: {
    deployments: { get: async (args, options) => {
      calls.push({ operation: 'deployment', args, options });
      return { data: { deploymentId: 'deployment-1', deploymentConfig: { versionNumber: versions[Math.min(reads++, versions.length - 1)] } } };
    } },
    getContent: async (args, options) => {
      calls.push({ operation: 'content', args, options });
      return { data: { files: [{ name: 'Code', type: 'SERVER_JS', source: sources[Math.min(contentReads++, sources.length - 1)] }] } };
    }
  } };
}
const pinned = { scriptId: 'script-1', deploymentId: 'deployment-1', expectedCommit: commit,
  expectedVersionNumber: 17, expectedSource: source, attempts: 3 };

test('pinned readback waits for stale metadata and reads only the newly created version', async () => {
  const script = sequencedClient({ versions: [16, 17, 17] }), waits = [], observations = [];
  const evidence = await createAppsScriptRecoveryEvidence({ ...pinned, script,
    sleep: async ms => waits.push(ms), onObservation: value => observations.push(value) });
  assert.equal(evidence.versionNumber, 17);
  assert.deepEqual(waits, [5000]);
  assert.deepEqual(script.calls.filter(c => c.operation === 'content').map(c => c.args.versionNumber), [17]);
  assert.equal(observations[0].observedVersion, 16);
  assert.ok(script.calls.every(c => c.options.timeout <= 12000 && c.options.retry === false));
});

test('pinned readback rejects stale commit and changed full source until exact immutable source is visible', async () => {
  const script = sequencedClient({ sources: [source.replace(commit, 'b'.repeat(40)), source + '\n// not the candidate', source] });
  const observations = [], waits = [];
  const evidence = await createAppsScriptRecoveryEvidence({ ...pinned, script,
    sleep: async ms => waits.push(ms), onObservation: value => observations.push(value) });
  assert.equal(evidence.sourceDigest, createHash('sha256').update(source).digest('hex'));
  assert.equal(waits.length, 2);
  assert.deepEqual(observations.map(o => o.code), ['APPS_SCRIPT_RECOVERY_EVIDENCE_COMMIT_MISMATCH', 'APPS_SCRIPT_RECOVERY_EVIDENCE_SOURCE_MISMATCH']);
  assert.ok(!JSON.stringify(observations).includes('function doPost'));
  assert.ok(!JSON.stringify(observations).includes('script-1'));
});

test('exhausted readback fails without mutation, extra attempts or accepting public health', async () => {
  const script = sequencedClient({ sources: [source.replace(commit, 'c'.repeat(40))] }), waits = [];
  await assert.rejects(createAppsScriptRecoveryEvidence({ ...pinned, script, sleep: async ms => waits.push(ms) }), /COMMIT_MISMATCH/);
  assert.equal(script.calls.filter(c => c.operation === 'content').length, 3);
  assert.equal(waits.length, 2);
  assert.ok(script.calls.every(c => ['content', 'deployment'].includes(c.operation)));
});

test('pinned verification fails immediately for newer deployment or a concurrent version change', async () => {
  for (const versions of [[18], [17, 18]]) {
    const script = sequencedClient({ versions });
    await assert.rejects(createAppsScriptRecoveryEvidence({ ...pinned, script,
      sleep: async () => assert.fail('must not retry a deployment race') }), /DEPLOYMENT_ADVANCED|DEPLOYMENT_CHANGED_DURING_VERIFICATION/);
  }
});

test('retry configuration must retain pinned identities and a bounded deadline', async () => {
  for (const overrides of [{ expectedVersionNumber: undefined }, { expectedSource: '' }, { attempts: 14 }, { retryDelayMs: 5001 }]) {
    await assert.rejects(createAppsScriptRecoveryEvidence({ ...pinned, ...overrides, script: sequencedClient() }), /PINNED_SOURCE_REQUIRED|RETRY_CONFIGURATION_INVALID/);
  }
  let time = 0;
  const script = sequencedClient({ versions: [16] });
  await assert.rejects(createAppsScriptRecoveryEvidence({ ...pinned, script, now: () => time,
    sleep: async () => { time = 90000; } }), /READ_DEADLINE_EXCEEDED/);
  assert.equal(script.calls.length, 1);
});
