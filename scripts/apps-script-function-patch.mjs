import { createHash } from 'node:crypto';
import { parse } from 'acorn';

const fingerprint = 'APPS_SCRIPT_DEPLOYMENT_COMMIT_';
const releaseVersion = 'APP_RELEASE_VERSION_';
const additiveEmailHandler = 'handleSignedInventoryReclassMoveDelivery_';
const bunchNoteEmailHandler = 'handleSignedBunchNoteDelivery_';
const bunchNoteEmailFunctions = new Set([bunchNoteEmailHandler, 'bunchNoteCardRoute_', 'buildBunchNotePdfHtml_']);
const reclassEmailFunctions = new Set([
  'buildReclassInlineOhText_', 'buildReclassItemInquiryTable_', 'buildReclassItemInquiryHtml_', 'buildReclassItemInquiryPdf_', 'buildReclassInquiryReportModel_',
  'buildProtectedLiveEditReportRows_',
  'getReclassInquiryEmailRecipients_',
  'deliverReclassInquiryPayload_',
  'buildReclassInquiryReportText_',
  'buildReclassInquiryEmailHtml_',
  'buildReclassInquiryCompactReportHtml_',
  'buildCompletedInventoryReclassReportModel_',
  'buildCompletedInventoryReclassMoveText_',
  'buildCompletedInventoryReclassMoveHtml_',
]);
const liveImportDeclarations = new Set([
  'MANUAL_SYNC_STAGE_ORDER_DEFAULT', 'IMPORT_HISTORY_CHUNK_SIZE_',
  'URGENT_DRIVE_AROUND_TRIGGER_HANDLER_', 'URGENT_DRIVE_AROUND_REQUEST_KEY_',
  'URGENT_DRIVE_AROUND_RETRY_MS_', 'URGENT_DRIVE_AROUND_STALE_MS_',
  'URGENT_DRIVE_AROUND_EXECUTION_BUDGET_MS_',
]);
const liveImportFunctions = new Set([
  'setupDropFolderAutoSyncTrigger', 'removeDropFolderAutoSyncTrigger', 'runAutoDropFolderSync_',
  'removeUrgentDriveAroundTriggers_', 'scheduleUrgentDriveAroundTrigger_', 'hasPendingDriveAroundSource_',
  'cleanupStaleDriveAroundWorkspace_', 'runUrgentDriveAroundSync_', 'runUrgentDriveAroundSync',
  'failDatasetImportFence_', 'buildSupabaseUpsertRequests_', 'runRoutedDropImport_', 'saveManualSyncStatus_', 'publishManualSyncStatus_', 'setManualSyncImportPhase_', 'scheduleRequestIntegrityMaintenance_', 'runQueuedRequestIntegrityMaintenance_',
  ...liveImportDeclarations,
  'setDatasetImportSourceMetadata_', 'closeDatasetImportFence_',
  'processLatestFileOnlyFolderLocked_', 'processSiteSplitMasterSnapshotBatchFolderLocked_', 'doPost',
  "syncWarehouseAssignedItemsSheet_", "readWarehouseAssignmentExportRevision_", "exportWarehouseAssignedItemsToSheet_",
  "getMasterBulkSnapshotStageConfig_",
  "canonicalizeMasterBulkPayloadValue_",
  "normalizeEscapedImportText_",
  "normalizeEscapedImportRow_",
  "masterBulkSnapshotStageCheckpointKey_",
  "masterBulkSnapshotSyncTimestampKey_",
  "getOrCreateMasterBulkSnapshotSyncTimestamp_",
  "clearMasterBulkSnapshotSyncTimestamp_",
  "assertNoPublishedMasterBulkSnapshotAwaitingArchive_",
  "markMasterBulkSnapshotPublished_",
  "cleanupOrphanedMasterBulkSnapshotStages_",
  "masterBulkSnapshotSourceManifest_",
  "readMasterBulkSnapshotStageCheckpoint_",
  "saveMasterBulkSnapshotStageCheckpoint_",
  "clearMasterBulkSnapshotStageCheckpoint_",
  "masterBulkStageResponseObject_",
  "validateMasterBulkStageState_",
  "callMasterBulkStageRpc_",
  "masterBulkStageContinuationError_",
  "masterBulkStageContinuationResult_",
  "shouldContinueMasterBulkStage_",
  "validateMasterBulkPublishedReplay_",
  "validateMasterBulkStageFinalize_",
  "callMasterBulkSnapshotImport_",
  "buildMasterBulkSnapshotPayload_",
  "buildStandardPayload",
  "buildMasterPayload",
  "buildCavPayload",
  "processSnapshotBatchFolderLocked_",
  "assertRoutedPendingSourceSelection_",
  "getFastLiveIngestDatasetKey_",
  "getFastLiveIngestRpc_",
  "getFastLiveFileMeta_",
  "getFastLiveIngestRows_",
  "processFastLiveFile_",
  "cleanupTempGoogleSheet_", "extractDataFromFile",
  "getImportHistoryRoute_",
  "isLiveImportTemporaryFile_",
  "isCheckpointedLatestImportTable_",
  "cleanupCompletedImportExtraction_",
  "listRoutedDropFiles_",
  "runSOCOnly",
  "runDriveAroundOnly",
  "runWarehouseAssignedOnly",
  "runCavOnly",
  "resolveSupabaseServiceRoleKey_",
  "getSupabaseHeaders_",
  "assertDriveAroundSourceContract_",
  "processCustomerRepMapSnapshotLocked_",
  "getAppsScriptActionSigningKeys_",
  "reconcileAppsScriptActionSigningKey_",
  "requestNaMappingDigest_",
  "ensureProtectedRequestNaCustomerMappings_",
  "verifyRuntimeWatchdogAlert_",
  "verifyAppsScriptLifecycleCanary_",
  "verifyHlTagsSender_",
  "verifyInventoryWorkflowActor_",
  "verifyManualInventoryImportActor_",
  "appsScriptActionConstantTimeEqual_",
  "verifyAppsScriptActionActor_",
  "verifyAppsScriptActionEnvelope_",
  "mintDriveToken_",
  "authorizeAppsScriptPost_",
  "doPost",
  "buildRequestEmailMessage_",
  "buildRequestDeliveryEmailPayload_",
  "sendRequestDeliveryPush_",
  "handleRuntimeWatchdogAlert_",
  "getManualSyncStatusForClient_",
  "createManualSyncQueuedStatus_",
  "sanitizeManualSyncStatusForClient_",
  "listRoutedDropFiles_",
  "processSnapshotBatchFolderLocked_",
  "runQueuedManualSyncStage_",
  "isLiveImportTemporaryFile_",
  "isCheckpointedLatestImportTable_",
  "syncHlPoParsedFolder_",
  "syncTransactionsKeyedFolder_",
  "syncPikesOrdersFolder_",
  "processFolderLocked_",
  "readManualSyncLiveSourceWatermark_",
  "saveManualSyncLiveSourceWatermark_",
  "assertRoutedPendingSourceSelection_",
  "processCustomerRepMapSnapshotLocked_",
]);
const additiveFunctions = new Set(["readWarehouseAssignmentExportRevision_", "getMasterBulkSnapshotStageConfig_", "masterBulkSnapshotStageCheckpointKey_", "masterBulkSnapshotSyncTimestampKey_", "getOrCreateMasterBulkSnapshotSyncTimestamp_", "clearMasterBulkSnapshotSyncTimestamp_", "assertNoPublishedMasterBulkSnapshotAwaitingArchive_", "markMasterBulkSnapshotPublished_", "cleanupOrphanedMasterBulkSnapshotStages_", "masterBulkSnapshotSourceManifest_", "readMasterBulkSnapshotStageCheckpoint_", "saveMasterBulkSnapshotStageCheckpoint_", "clearMasterBulkSnapshotStageCheckpoint_", "masterBulkStageResponseObject_", "validateMasterBulkStageState_", "callMasterBulkStageRpc_", "masterBulkStageContinuationError_", "masterBulkStageContinuationResult_", "shouldContinueMasterBulkStage_", "validateMasterBulkStageFinalize_", "assertDriveAroundSourceContract_", "isLiveImportTemporaryFile_", "readManualSyncLiveSourceWatermark_", "saveManualSyncLiveSourceWatermark_", additiveEmailHandler, bunchNoteEmailHandler, "buildCompletedInventoryReclassReportModel_", "buildCompletedInventoryReclassMoveText_", "buildCompletedInventoryReclassMoveHtml_", "requestNaMappingDigest_", "ensureProtectedRequestNaCustomerMappings_", "handleRuntimeWatchdogAlert_"]);
additiveFunctions.add('buildBunchNotePdfHtml_');
additiveFunctions.add('bunchNoteCardRoute_');
for (const name of ['normalizeEscapedImportText_', 'normalizeEscapedImportRow_']) additiveFunctions.add(name);
for (const name of ['getFastLiveIngestDatasetKey_', 'getFastLiveIngestRpc_', 'getFastLiveFileMeta_',
  'getFastLiveIngestRows_', 'cleanupCompletedImportExtraction_', 'processFastLiveFile_', 'runWarehouseAssignedOnly']) additiveFunctions.add(name);
additiveFunctions.add('resolveSupabaseServiceRoleKey_');
for (const name of ['removeUrgentDriveAroundTriggers_', 'scheduleUrgentDriveAroundTrigger_', 'hasPendingDriveAroundSource_', 'cleanupStaleDriveAroundWorkspace_', 'runUrgentDriveAroundSync_', 'runUrgentDriveAroundSync']) additiveFunctions.add(name);
for (const name of ['publishManualSyncStatus_', 'scheduleRequestIntegrityMaintenance_', 'runQueuedRequestIntegrityMaintenance_']) additiveFunctions.add(name);
additiveFunctions.add('setDatasetImportSourceMetadata_');
additiveFunctions.add('verifyRuntimeWatchdogAlert_');
for (const name of ['appsScriptActionConstantTimeEqual_', 'getAppsScriptActionSigningKeys_', 'reconcileAppsScriptActionSigningKey_', 'verifyAppsScriptActionActor_', 'verifyAppsScriptActionEnvelope_', 'authorizeAppsScriptPost_', 'verifyAppsScriptLifecycleCanary_', 'mintDriveToken_']) additiveFunctions.add(name);
for (const name of ['buildReclassInlineOhText_', 'buildReclassItemInquiryTable_', 'buildReclassItemInquiryHtml_', 'buildReclassItemInquiryPdf_']) additiveFunctions.add(name);
const fail = code => { throw new Error(`APPS_SCRIPT_FUNCTION_PATCH_${code}`); };
const digest = source => createHash('sha256').update(source).digest('hex');

function boundaries(source, names) {
  const found = new Map();
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  for (const node of tree.body) {
    if (node.type === 'FunctionDeclaration' && names.includes(node.id?.name)) {
      if (found.has(node.id.name)) fail('DUPLICATE_FUNCTION');
      found.set(node.id.name, { start: node.start, end: node.end });
    }
    if (node.type === 'VariableDeclaration' && node.declarations.length === 1
      && [fingerprint, releaseVersion, ...names.filter(name => liveImportDeclarations.has(name))].includes(node.declarations[0].id.name)) {
      const name = node.declarations[0].id.name;
      if (found.has(name)) fail('DUPLICATE_FINGERPRINT');
      found.set(name, { start: node.start, end: node.end });
    }
  }
  return found;
}

function mergeManualContinuation(remote, local) {
  const oldAuthorization = "['manual_run', 'manual_clear_status', 'manual_clear_stale_status']";
  const authorization = "['manual_run', 'manual_continue', 'manual_clear_status', 'manual_clear_stale_status']";
  const start = "    if (payload.type === 'manual_continue') {";
  const next = "    if (payload.type === 'manual_run') {";
  const localStart = local.indexOf(start), localEnd = local.indexOf(next, localStart);
  if (localStart < 0 || localEnd < 0) fail('MANUAL_DISPATCH_LOCAL_ANCHOR');
  const block = local.slice(localStart, localEnd);
  if (!remote.includes(authorization)) {
    if (remote.split(oldAuthorization).length !== 2) fail('MANUAL_AUTHORIZATION_REMOTE_ANCHOR');
    remote = remote.replace(oldAuthorization, authorization);
  }
  if (remote.includes(start)) {
    if (!remote.includes(block)) fail('MANUAL_CONTINUATION_REMOTE_CONFLICT');
    return remote;
  }
  if (remote.split(next).length !== 2) fail('MANUAL_DISPATCH_REMOTE_ANCHOR');
  return remote.replace(next, block + next);
}

function mergeRuntimeWatchdogDispatch(remote, local) {
  const route = "    if (payload.type === 'runtime_watchdog_alert_v1') return jsonOutput_(handleRuntimeWatchdogAlert_(payload));";
  const deployment = "    if (payload.type === 'deployment_health') {";
  if (!local.includes(route)) fail('WATCHDOG_DISPATCH_LOCAL_ANCHOR');
  if (remote.includes(route)) return remote;
  if (remote.split(deployment).length !== 2) fail('WATCHDOG_DISPATCH_REMOTE_ANCHOR');
  return remote.replace(deployment, route + '\n\n' + deployment);
}

function mergeAppsScriptPostGate(remote, local) {
  const oldEntry = '    const payload = JSON.parse(e.postData.contents);';
  const guardedEntry = '    const payload = authorizeAppsScriptPost_(JSON.parse(e.postData.contents));';
  if (!local.includes(guardedEntry)) fail('POST_GATE_LOCAL_ANCHOR');
  if (remote.includes(guardedEntry)) return remote;
  if (remote.split(oldEntry).length !== 2) fail('POST_GATE_REMOTE_ANCHOR');
  return remote.replace(oldEntry, guardedEntry);
}

function mergeRequestDeliveryWakeDispatch(remote, local) {
  const route = "    if (payload.type === 'wake_delivery_worker') {\n      const deliveryLimit = Math.max(1, Math.min(100, Number(payload.limit) || 40));\n      return jsonOutput_(processRequestDeliveryOutbox_(deliveryLimit));\n    }";
  const anchor = "    if (payload.type === 'photo_history_thumbnail') {";
  if (!local.includes(route)) return remote;
  if (remote.includes(route)) return remote;
  if (remote.split(anchor).length !== 2) fail('DELIVERY_WAKE_REMOTE_ANCHOR');
  return remote.replace(anchor, route + '\n' + anchor);
}

function mergeMintDriveTokenDispatch(remote, local) {
  const route = "    if (payload.type === 'mint_drive_token') return jsonOutput_(mintDriveToken_());";
  const anchor = "    if (payload.type === 'deployment_health') {";
  const guardedEntry = '    const payload = authorizeAppsScriptPost_(JSON.parse(e.postData.contents));';
  if (!local.includes(route)) return remote;
  if (remote.includes(route)) return remote;
  if (!remote.includes(guardedEntry)) fail('MINT_DRIVE_TOKEN_POST_GATE_REMOTE_ANCHOR');
  if (remote.split(anchor).length !== 2) fail('MINT_DRIVE_TOKEN_DISPATCH_REMOTE_ANCHOR');
  return remote.replace(anchor, route + '\n\n' + anchor);
}

/** Preserve remote source verbatim outside the explicitly authorized functions. */
export function patchAppsScriptFunctions({ remoteSource, localSource, functionNames, includeRelease = false }) {
  if (!Array.isArray(functionNames) || !functionNames.length
    || new Set(functionNames).size !== functionNames.length
    || functionNames.some(name => !/^[A-Za-z_$][\w$]*$/.test(name)
      || (!/SuspendTag/i.test(name) && name !== 'handleSignedRequestDeliveryEvent_' && name !== additiveEmailHandler
        && !bunchNoteEmailFunctions.has(name) && !reclassEmailFunctions.has(name)
        && name !== 'buildReclassInquiryReportModel_' && !liveImportFunctions.has(name)))) fail('ALLOWLIST_INVALID');
  // Only the authorized additive handlers and helpers may be absent remotely. All existing
  // source bytes stay intact; stage a placeholder at EOF, then use the same
  // parsed-function replacement and protected-source comparison below.
  let preparedRemote = remoteSource;
  let remote = boundaries(preparedRemote, functionNames);
  for (const name of additiveFunctions) {
    if (functionNames.includes(name) && !remote.has(name)) {
      preparedRemote += '\n\nfunction ' + name + '() {}\n';
      remote = boundaries(preparedRemote, functionNames);
    }
  }
  for (const name of liveImportDeclarations) {
    if (functionNames.includes(name) && !remote.has(name)) {
      preparedRemote += '\n\nconst ' + name + ' = null;\n';
      remote = boundaries(preparedRemote, functionNames);
    }
  }
  const local = boundaries(localSource, functionNames);
  const names = [...functionNames, fingerprint, ...(includeRelease ? [releaseVersion] : [])];
  for (const name of names) if (!local.has(name) || !remote.has(name)) fail('FUNCTION_MISSING');
  const changes = names.map(name => {
    let replacement = localSource.slice(local.get(name).start, local.get(name).end);
    if (name === 'doPost') {
      let remoteBlock = preparedRemote.slice(remote.get(name).start, remote.get(name).end);
      if (replacement.includes("if (payload.type === 'manual_continue')")) remoteBlock = mergeManualContinuation(remoteBlock, replacement);
      if (replacement.includes("if (payload.type === 'runtime_watchdog_alert_v1')")) remoteBlock = mergeRuntimeWatchdogDispatch(remoteBlock, replacement);
      if (replacement.includes('authorizeAppsScriptPost_(JSON.parse(e.postData.contents))')) remoteBlock = mergeAppsScriptPostGate(remoteBlock, replacement);
      remoteBlock = mergeRequestDeliveryWakeDispatch(remoteBlock, replacement);
      remoteBlock = mergeMintDriveTokenDispatch(remoteBlock, replacement);
      replacement = remoteBlock;
    }
    return { name, ...remote.get(name), replacement };
  })
    .sort((a, b) => b.start - a.start);
  let merged = preparedRemote;
  let protectedSource = preparedRemote;
  for (const change of changes) {
    merged = merged.slice(0, change.start) + change.replacement + merged.slice(change.end);
    protectedSource = protectedSource.slice(0, change.start) + `/* authorized:${change.name} */` + protectedSource.slice(change.end);
  }
  // Parse and mask again after replacement: malformed/nested edits fail closed.
  const resultBounds = boundaries(merged, functionNames);
  let protectedResult = merged;
  for (const entry of names.map(name => ({ name, ...resultBounds.get(name) })).sort((a, b) => b.start - a.start)) {
    protectedResult = protectedResult.slice(0, entry.start) + `/* authorized:${entry.name} */` + protectedResult.slice(entry.end);
  }
  if (protectedResult !== protectedSource) fail('PROTECTED_SOURCE_CHANGED');
  return { source: merged, protectedSourceDigest: digest(protectedSource), functions: functionNames.slice() };
}

export function appsScriptFilesDigest(files) {
  return digest(JSON.stringify(files.map(file => ({ name: file.name, type: file.type, source: file.source }))
    .sort((a, b) => a.name.localeCompare(b.name))));
}

export function createAppsScriptSourceGuard({ script, scriptId, beforeDigest, afterDigest, authorize }) {
  let checkedMutations = 0;
  return async () => {
    await authorize();
    const current = await script.projects.getContent({ scriptId });
    const expected = checkedMutations === 0 ? beforeDigest : afterDigest;
    if (appsScriptFilesDigest(current.data?.files || []) !== expected) fail('REMOTE_SOURCE_CHANGED');
    checkedMutations++;
  };
}
