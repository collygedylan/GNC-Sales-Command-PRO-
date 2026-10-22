import test from 'node:test';
import assert from 'node:assert/strict';
import { patchAppsScriptFunctions, appsScriptFilesDigest, createAppsScriptSourceGuard } from '../scripts/apps-script-function-patch.mjs';
import { syncAppsScriptProject, applyDeploymentFingerprint, REQUEST_LIFECYCLE_POLICY_VERSION } from '../scripts/apps-script-sync-lib.mjs';

const local = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';
function buildSuspendTagApprovalEmail_() { return '<a>Approve</a>'; }
function historicalRunner() { return 'stale repository state'; }`;
const remote = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
// Remote continuous-until override and trigger logic MUST remain byte identical.
const BACKFILL_CONTINUOUS_UNTIL = '2026-10-19T06:15:00-05:00';
function buildSuspendTagApprovalEmail_() { return 'old'; }
function historicalRunner() { return 'remote resumable state'; }
function remoteOnlyFunction() { return /[{}]/.test('{}'); }`;
const names = ['buildSuspendTagApprovalEmail_'];

test('live ERP patch preserves paused historical source and adds only its temporary-file classifier', () => {
  const before = remote + '\nfunction runQueuedManualSyncStage_() { return "old"; }';
  const after = local + '\nfunction runQueuedManualSyncStage_() { return "continue-independent-stages"; }'
    + '\nfunction isLiveImportTemporaryFile_(name) { return /^(?:TEMP_|~\\$)/i.test(name); }';
  const functions = ['runQueuedManualSyncStage_', 'isLiveImportTemporaryFile_'];
  const result = patchAppsScriptFunctions({ remoteSource: before, localSource: after, functionNames: functions });
  assert.match(result.source, /continue-independent-stages/);
  assert.ok(result.source.includes("function historicalRunner() { return 'remote resumable state'; }"));
  assert.ok(result.source.includes("const BACKFILL_CONTINUOUS_UNTIL = '2026-10-19T06:15:00-05:00';"));
  assert.equal(patchAppsScriptFunctions({ remoteSource: result.source, localSource: after, functionNames: functions }).source, result.source);
  assert.throws(() => patchAppsScriptFunctions({ remoteSource: before, localSource: after, functionNames: ['startImportHistoryBackfill'] }), /ALLOWLIST_INVALID/);
});

test('DriveAround release patch adds the urgent processor and schedule constants', () => {
  const urgentNames = [
    'setupDropFolderAutoSyncTrigger', 'runAutoDropFolderSync_', 'runUrgentDriveAroundSync_',
    'runUrgentDriveAroundSync', 'URGENT_DRIVE_AROUND_TRIGGER_HANDLER_', 'URGENT_DRIVE_AROUND_RETRY_MS_',
  ];
  const remoteSource = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function setupDropFolderAutoSyncTrigger() { return 'old'; }
function runAutoDropFolderSync_() { return 'old'; }`;
  const localSource = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';
function setupDropFolderAutoSyncTrigger() { return 'five-daily'; }
function runAutoDropFolderSync_() { return runUrgentDriveAroundSync_({}); }
function runUrgentDriveAroundSync_() { return 'drive-first'; }
function runUrgentDriveAroundSync() { return runUrgentDriveAroundSync_({}); }
const URGENT_DRIVE_AROUND_TRIGGER_HANDLER_ = 'runUrgentDriveAroundSync_';
const URGENT_DRIVE_AROUND_RETRY_MS_ = 15000;`;
  const patched = patchAppsScriptFunctions({ remoteSource, localSource, functionNames: urgentNames });
  assert.match(patched.source, /five-daily/);
  assert.match(patched.source, /function runUrgentDriveAroundSync\(\)/);
  assert.match(patched.source, /URGENT_DRIVE_AROUND_RETRY_MS_ = 15000/);
  assert.equal(patchAppsScriptFunctions({ remoteSource: patched.source, localSource, functionNames: urgentNames }).source, patched.source);
});

test('scoped email publication preserves remote-only history functions and schedule byte-for-byte', () => {
  const patched = patchAppsScriptFunctions({ remoteSource: remote, localSource: local, functionNames: names });
  assert.match(patched.source, /<a>Approve<\/a>/);
  assert.match(patched.source, /__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__/);
  assert.equal(patched.source.slice(patched.source.indexOf('function historicalRunner')), remote.slice(remote.indexOf('function historicalRunner')));
  assert.match(patched.source, /BACKFILL_CONTINUOUS_UNTIL = '2026-10-19T06:15:00-05:00'/);
  assert.equal(patched.protectedSourceDigest.length, 64);
});

test('email patch fails closed for missing functions, duplicate names and backfill allowlisting', () => {
  for (const functionNames of [[], [...names, ...names], ['historicalRunner'], ['missingSuspendTagFunction']]) {
    assert.throws(() => patchAppsScriptFunctions({ remoteSource: remote, localSource: local, functionNames }), /APPS_SCRIPT_FUNCTION_PATCH/);
  }
  assert.throws(() => patchAppsScriptFunctions({ remoteSource: remote + '\nfunction buildSuspendTagApprovalEmail_() {}', localSource: local, functionNames: names }), /DUPLICATE_FUNCTION/);
});

test('remote code race guard detects source edits while ignoring server metadata and ordering', () => {
  const a = [{ name: 'Code', type: 'SERVER_JS', source: remote }, { name: 'appsscript', type: 'JSON', source: '{}' }];
  assert.equal(appsScriptFilesDigest(a), appsScriptFilesDigest(a.toReversed().map(file => ({ ...file, updateTime: 'later' }))));
  assert.notEqual(appsScriptFilesDigest(a), appsScriptFilesDigest(a.map(file => ({ ...file, source: file.source + ' ' }))));
});

test('scoped publisher advances one version with guarded remote backfill and manifest intact', async () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const patch = patchAppsScriptFunctions({ remoteSource: remote, localSource: local, functionNames: names });
  let files = [{ name: 'Code', type: 'SERVER_JS', source: remote }, { name: 'appsscript', type: 'JSON', source: '{"timeZone":"America/Chicago"}' }];
  const published = files.map(file => file.name === 'Code' ? { ...file, source: applyDeploymentFingerprint(patch.source, sha) } : file);
  const mutations = [];
  const script = { projects: {
    getContent: async () => ({ data: { files } }),
    updateContent: async request => { mutations.push('source'); files = request.requestBody.files; },
    versions: { list: async () => ({ data: { versions: [] } }), create: async () => { mutations.push('version'); return { data: { versionNumber: 334 } }; } },
    deployments: { update: async () => { mutations.push('deployment'); }, get: async () => ({ data: { deploymentConfig: { versionNumber: 334 } } }) },
  } };
  let authorizations = 0;
  const result = await syncAppsScriptProject({ script, scriptId: 'fixture', deploymentId: 'fixture', source: patch.source, githubSha: sha,
    beforeMutation: createAppsScriptSourceGuard({ script, scriptId: 'fixture', beforeDigest: appsScriptFilesDigest(files), afterDigest: appsScriptFilesDigest(published), authorize: async () => { authorizations++; } }),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, deployedCommit: sha, lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_POLICY_VERSION, requiredRecipientCount: 3 }) }),
    healthAttempts: 1,
  });
  assert.equal(result.deployedVersionNumber, 334);
  assert.equal(authorizations, 3);
  assert.deepEqual(mutations, ['source', 'version', 'deployment']);
  assert.deepEqual(files, published);
});

test('remote edits or withdrawn authorization stop scoped publication before the next mutation', async () => {
  let files = [{ name: 'Code', type: 'SERVER_JS', source: remote }];
  const beforeDigest = appsScriptFilesDigest(files);
  const script = { projects: { getContent: async () => ({ data: { files } }) } };
  const guard = createAppsScriptSourceGuard({ script, scriptId: 'fixture', beforeDigest, afterDigest: beforeDigest, authorize: async () => {} });
  await guard();
  files = [{ ...files[0], source: remote + '\n// operator changed the schedule' }];
  await assert.rejects(guard(), /REMOTE_SOURCE_CHANGED/);
  const denied = createAppsScriptSourceGuard({ script, scriptId: 'fixture', beforeDigest, afterDigest: beforeDigest, authorize: async () => { throw new Error('CURRENT_MAIN_CHANGED'); } });
  await assert.rejects(denied(), /CURRENT_MAIN_CHANGED/);
});

test('only the authorized Reclass email handler and completed-report helper may be added without changing remote backfill',()=>{
 const name='handleSignedInventoryReclassMoveDelivery_';
 const helper='buildCompletedInventoryReclassReportModel_';
 const additions=local+'\nfunction '+name+'(delivery) { return {ok:true,eventId:delivery.eventId}; }\nfunction '+helper+'(receipt) { return receipt; }';
 const first=patchAppsScriptFunctions({remoteSource:remote,localSource:additions,functionNames:[...names,name,helper]});
 const oldTail=remote.slice(remote.indexOf('function historicalRunner'));
 assert.ok(first.source.includes(oldTail),'all original history and remote-only function bytes remain intact');
 assert.match(first.source,/function handleSignedInventoryReclassMoveDelivery_\(delivery\)/);
 const retry=patchAppsScriptFunctions({remoteSource:first.source,localSource:additions,functionNames:[...names,name,helper]});
 assert.equal(retry.source,first.source,'repeat publication adds no duplicate handler');
 assert.throws(()=>patchAppsScriptFunctions({remoteSource:remote,localSource:local,functionNames:[...names,name,helper]}),/FUNCTION_MISSING/);
 assert.throws(()=>patchAppsScriptFunctions({remoteSource:remote,localSource:additions+'\nfunction newBackfillRunner() {}',functionNames:['newBackfillRunner']}),/ALLOWLIST_INVALID/);
});
