import { createHash } from 'node:crypto';
import { parse } from 'acorn';

const fingerprint = 'APPS_SCRIPT_DEPLOYMENT_COMMIT_';
const additiveEmailHandler = 'handleSignedInventoryReclassMoveDelivery_';
const reclassEmailFunctions = new Set([
  'getReclassInquiryEmailRecipients_',
  'deliverReclassInquiryPayload_',
  'buildReclassInquiryReportText_',
  'buildReclassInquiryEmailHtml_',
  'buildReclassInquiryCompactReportHtml_',
  'buildCompletedInventoryReclassReportModel_',
  'buildCompletedInventoryReclassMoveText_',
  'buildCompletedInventoryReclassMoveHtml_',
]);
const liveImportFunctions = new Set([
  "getMasterBulkSnapshotStageConfig_",
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
  "processSnapshotBatchFolderLocked_",
  "assertRoutedPendingSourceSelection_",
  "assertDriveAroundSourceContract_",
  "processCustomerRepMapSnapshotLocked_",
  "getManualSyncStatusForClient_",
  "createManualSyncQueuedStatus_",
  "sanitizeManualSyncStatusForClient_",
  "listRoutedDropFiles_",
  "processSnapshotBatchFolderLocked_",
  "runQueuedManualSyncStage_",
  "isLiveImportTemporaryFile_",
  "syncHlPoParsedFolder_",
  "syncTransactionsKeyedFolder_",
  "syncPikesOrdersFolder_",
  "processFolderLocked_",
  "readManualSyncLiveSourceWatermark_",
  "saveManualSyncLiveSourceWatermark_",
  "assertRoutedPendingSourceSelection_",
  "processCustomerRepMapSnapshotLocked_",
]);
const additiveFunctions = new Set(["getMasterBulkSnapshotStageConfig_", "masterBulkSnapshotStageCheckpointKey_", "masterBulkSnapshotSyncTimestampKey_", "getOrCreateMasterBulkSnapshotSyncTimestamp_", "clearMasterBulkSnapshotSyncTimestamp_", "assertNoPublishedMasterBulkSnapshotAwaitingArchive_", "markMasterBulkSnapshotPublished_", "cleanupOrphanedMasterBulkSnapshotStages_", "masterBulkSnapshotSourceManifest_", "readMasterBulkSnapshotStageCheckpoint_", "saveMasterBulkSnapshotStageCheckpoint_", "clearMasterBulkSnapshotStageCheckpoint_", "masterBulkStageResponseObject_", "validateMasterBulkStageState_", "callMasterBulkStageRpc_", "masterBulkStageContinuationError_", "masterBulkStageContinuationResult_", "shouldContinueMasterBulkStage_", "validateMasterBulkPublishedReplay_", "validateMasterBulkStageFinalize_", "assertDriveAroundSourceContract_", "isLiveImportTemporaryFile_", "readManualSyncLiveSourceWatermark_", "saveManualSyncLiveSourceWatermark_", additiveEmailHandler, "buildCompletedInventoryReclassReportModel_", "buildCompletedInventoryReclassMoveText_", "buildCompletedInventoryReclassMoveHtml_"]);
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
      && node.declarations[0].id.name === fingerprint) {
      if (found.has(fingerprint)) fail('DUPLICATE_FINGERPRINT');
      found.set(fingerprint, { start: node.start, end: node.end });
    }
  }
  return found;
}

/** Preserve remote source verbatim outside the explicitly authorized functions. */
export function patchAppsScriptFunctions({ remoteSource, localSource, functionNames }) {
  if (!Array.isArray(functionNames) || !functionNames.length
    || new Set(functionNames).size !== functionNames.length
    || functionNames.some(name => !/^[A-Za-z_$][\w$]*$/.test(name)
      || (!/SuspendTag/i.test(name) && name !== 'handleSignedRequestDeliveryEvent_' && name !== additiveEmailHandler && !reclassEmailFunctions.has(name) && name !== 'buildReclassInquiryReportModel_' && !liveImportFunctions.has(name)))) fail('ALLOWLIST_INVALID');
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
  const local = boundaries(localSource, functionNames);
  const names = [...functionNames, fingerprint];
  for (const name of names) if (!local.has(name) || !remote.has(name)) fail('FUNCTION_MISSING');
  const changes = names.map(name => ({ name, ...remote.get(name),
    replacement: localSource.slice(local.get(name).start, local.get(name).end) }))
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
