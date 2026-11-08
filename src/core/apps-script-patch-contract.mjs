import assert from 'node:assert/strict';
import vm from 'node:vm';
import {patchAppsScriptFunctions} from '../../scripts/apps-script-function-patch.mjs';

function assertPatchManifest(manifest) {
  const required = [
    'buildSuspendTagApprovalEmail_',
    'buildReclassInlineOhText_', 'buildReclassItemInquiryTable_', 'buildCompletedInventoryReclassReportModel_', 'buildReclassItemInquiryHtml_', 'buildReclassItemInquiryPdf_',
    'buildReclassInquiryReportModel_', 'getReclassInquiryEmailRecipients_', 'buildReclassInquiryCompactReportHtml_',
    'buildReclassInquiryEmailHtml_', 'deliverReclassInquiryPayload_', 'handleSignedInventoryReclassMoveDelivery_', 'bunchNoteCardRoute_', 'buildBunchNotePdfHtml_', 'handleSignedBunchNoteDelivery_',
    'setupDropFolderAutoSyncTrigger', 'removeDropFolderAutoSyncTrigger', 'runAutoDropFolderSync_',
    'removeUrgentDriveAroundTriggers_', 'scheduleUrgentDriveAroundTrigger_', 'hasPendingDriveAroundSource_',
    'cleanupStaleDriveAroundWorkspace_', 'runUrgentDriveAroundSync_', 'runUrgentDriveAroundSync',
    'failDatasetImportFence_', 'runQueuedManualSyncStage_', 'MANUAL_SYNC_STAGE_ORDER_DEFAULT', 'URGENT_DRIVE_AROUND_TRIGGER_HANDLER_',
    'URGENT_DRIVE_AROUND_REQUEST_KEY_', 'URGENT_DRIVE_AROUND_RETRY_MS_', 'URGENT_DRIVE_AROUND_STALE_MS_',
    'URGENT_DRIVE_AROUND_EXECUTION_BUDGET_MS_', 'canonicalizeMasterBulkPayloadValue_',
    'normalizeEscapedImportText_', 'normalizeEscapedImportRow_', 'buildMasterBulkSnapshotPayload_',
    'buildStandardPayload', 'buildMasterPayload', 'buildCavPayload',
    'getImportHistoryRoute_', 'isLiveImportTemporaryFile_', 'isCheckpointedLatestImportTable_', 'cleanupTempGoogleSheet_', 'cleanupCompletedImportExtraction_', 'extractDataFromFile', 'listRoutedDropFiles_',
    'getFastLiveIngestDatasetKey_', 'getFastLiveIngestRpc_', 'getFastLiveFileMeta_',
    'getFastLiveIngestRows_', 'processFastLiveFile_', 'runRoutedDropImport_',
    'buildRequestDeliveryEmailPayload_', 'scheduleSocOrderHistoryTrigger_', 'runSocOrderHistoryBackfillChunk_',
    'runSOCOnly', 'runDriveAroundOnly',
    'runWarehouseAssignedOnly', 'runCavOnly', 'resolveSupabaseServiceRoleKey_', 'getSupabaseHeaders_',
    'reconcileAppsScriptActionSigningKey_', 'verifyAppsScriptActionEnvelope_', 'mintDriveToken_', 'doPost',
  ];
  for (const name of required) assert.ok(manifest.appsScriptPatchFunctions.includes(name), name);
  assert.equal(new Set(manifest.appsScriptPatchFunctions).size, manifest.appsScriptPatchFunctions.length);
  assert.equal(manifest.appsScriptPatchRelease, true);
}

function buildMintPatch(appsScriptSource, sourceFunction) {
  const untouched = 'const HISTORICAL_BACKFILL_PAUSED = true;\nconst AUTO_SYNC_PAUSED = true;';
  const remote = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'old';\nconst APP_RELEASE_VERSION_ = 'old';\n${untouched}\nfunction doPost() { return 'old'; }`;
  const local = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'new';\nconst APP_RELEASE_VERSION_ = 'new';\nfunction doPost() { return 'new'; }\nfunction setDatasetImportSourceMetadata_() { return 'metadata'; }`;
  const patch = patchAppsScriptFunctions({ remoteSource: remote, localSource: local,
    functionNames: ['doPost', 'setDatasetImportSourceMetadata_'], includeRelease: true });
  assert.ok(patch.source.includes(untouched));
  assert.match(patch.source, /const APP_RELEASE_VERSION_ = 'new'/);
  assert.match(patch.source, /function setDatasetImportSourceMetadata_\(\) \{ return 'metadata'; \}/);
  const bunchPrefix = "const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'old';\n";
  const bunchPatch = patchAppsScriptFunctions({ remoteSource: bunchPrefix,
    localSource: `${bunchPrefix}function handleSignedBunchNoteDelivery_() { return 'dylan-only'; }`,
    functionNames: ['handleSignedBunchNoteDelivery_'] });
  assert.match(bunchPatch.source, /function handleSignedBunchNoteDelivery_\(\) \{ return 'dylan-only'; \}/);
  assert.throws(() => patchAppsScriptFunctions({ remoteSource: remote, localSource: local,
    functionNames: ['startImportHistoryBackfill'] }), /ALLOWLIST_INVALID/);
  const localDispatch = sourceFunction(appsScriptSource, 'doPost');
  const start = localDispatch.indexOf("    if (payload.type === 'manual_continue') {");
  const next = localDispatch.indexOf("    if (payload.type === 'manual_run') {", start);
  const remoteOnly = "    if (payload.type === 'remote_only') return jsonOutput_({ preserved: true });\n\n";
  const wakeRoute = "    if (payload.type === 'wake_delivery_worker') {\n      const deliveryLimit = Math.max(1, Math.min(100, Number(payload.limit) || 40));\n      return jsonOutput_(processRequestDeliveryOutbox_(deliveryLimit));\n    }\n";
  const priorDispatch = (localDispatch.slice(0, start) + remoteOnly + localDispatch.slice(next))
    .replace(wakeRoute, '')
    .replace("['manual_run', 'manual_continue', 'manual_clear_status', 'manual_clear_stale_status']",
      "['manual_run', 'manual_clear_status', 'manual_clear_stale_status']");
  const prefix = "const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'old';\n";
  const merged = patchAppsScriptFunctions({ remoteSource: prefix + priorDispatch,
    localSource: prefix + localDispatch, functionNames: ['doPost'] });
  assert.ok(merged.source.includes(remoteOnly), 'remote-only dispatch remains byte-for-byte intact');
  assert.match(merged.source, /type === 'manual_continue'/);
  assert.match(merged.source, /type === 'wake_delivery_worker'/);
  assert.equal(patchAppsScriptFunctions({ remoteSource: merged.source,
    localSource: prefix + localDispatch, functionNames: ['doPost'] }).source, merged.source);
  const mintSource = sourceFunction(appsScriptSource, 'mintDriveToken_');
  const mintRoute = "    if (payload.type === 'mint_drive_token') return jsonOutput_(mintDriveToken_());";
  const mintPatch = patchAppsScriptFunctions({ remoteSource: `${prefix}${priorDispatch}`,
    localSource: `${prefix}${localDispatch}\n${mintSource}`, functionNames: ['doPost', 'mintDriveToken_'] });
  assert.match(mintPatch.source, /function mintDriveToken_\(\)/);
  assert.ok(mintPatch.source.includes(mintRoute), 'the merger inserts mint dispatch into remote doPost without the local route');
  assert.ok(mintPatch.source.includes(remoteOnly), 'adding the signed mint action preserves unrelated remote-only routes');

  return mintPatch;
}

async function verifyMintDispatch(mintPatch, appsScriptSource, sourceFunction) {
  const mergedPostContext = vm.createContext({
    getAppsScriptActionSigningKeys_: () => ['test-service-key'],
    requestDeliveryBase64Url_: () => 'valid-signature',
    appsScriptActionConstantTimeEqual_: (left, right) => left === right,
    Utilities: { computeHmacSha256Signature: () => [1, 2, 3], Charset: { UTF_8: 'UTF-8' } },
    verifyAppsScriptActionActor_: () => { throw new Error('mint route must use its restricted system actor'); },
    jsonOutput_: value => value,
    ScriptApp: { getOAuthToken: () => 'test-oauth-token' },
  });
  for (const name of ['verifyAppsScriptActionEnvelope_', 'authorizeAppsScriptPost_']) {
    vm.runInContext(sourceFunction(appsScriptSource, name), mergedPostContext);
  }
  for (const name of ['mintDriveToken_', 'doPost']) vm.runInContext(sourceFunction(mintPatch.source, name), mergedPostContext);
  const command = { contractVersion: 'apps-script-action-v1', action: 'mint_drive_token',
    payload: { type: 'mint_drive_token' }, actor: { system: 'erp-sync-cloud-worker' } };
  const tokenResponse = await mergedPostContext.doPost({ postData: { contents: JSON.stringify({
    type: 'apps_script_action_v1', timestamp: new Date().toISOString(), signature: 'valid-signature',
    deliveryJson: JSON.stringify(command),
  }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(tokenResponse)), { ok: true, accessToken: 'test-oauth-token' },
    'remote-only doPost verifies the signed command then returns the mint result');
}

export async function ingestionPatchContract({manifest, appsScriptSource, sourceFunction}) {
  assertPatchManifest(manifest);
  const mintPatch = buildMintPatch(appsScriptSource, sourceFunction);
  await verifyMintDispatch(mintPatch, appsScriptSource, sourceFunction);
}
