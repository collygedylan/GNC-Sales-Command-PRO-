export function installGoldenRuntimeDefaults(file, names, context, appApiVersion) {
  if (file === 'supabase/functions/app-api/index.ts' && names.includes('jsonResponse')) {
    context.APP_RUNTIME_VERSION ??= appApiVersion;
  }
  if (names.includes('driveManualErpSyncFromStatus')) {
    context.manualSyncStartPending ??= false;
    context.manualSyncStartGeneration ??= 0;
  }
  if (file !== 'assets/app-runtime.js') return;
  if (names.includes('assignEvalItemcodes')) {
    context.document ??= {querySelectorAll:()=>[]};
    context.mirrorConfirmedItemcodeOwners ??= async()=>{};
  }
  if (names.includes('applyArgosInventoryReclassMoveCommand')) {
    context.activeReclassMoveCommands ??= new Map();
  }
  if (names.includes('supabaseRpc') || names.includes('assignEvalItemcodes')) {
    context.getSupabaseReadIdentityScope ??= ()=>'fixture-account';
    context.nativeAuthRecoveryEpoch ??= 1;
    context.nativeReadRequiresRls ??= ()=>true;
  }
  if (names.includes('continueManualErpSync')) {
    context.manualSyncStartGeneration ??= 0;
    context.manualErpContinuationRequests ??= new Set();
  }
  if (names.some(name => ['runGoogleAppsScriptTrigger','syncGoogleScriptButton','refreshManualSyncStatus'].includes(name))) {
    context.manualSyncStartPending ??= false;
    context.manualSyncStartGeneration ??= 0;
    context.manualSyncStatusState ??= null;
    context.nativeAuthRecoveryEpoch ??= 1;
    context.nativeAuthProfile ??= {id:'fixture',username:'dylan_collyge'};
    context.canViewDashboardSyncStatus ??= ()=>true;
    context.renderErpSyncProgressModal ??= ()=>{};
  }
  context.MANUAL_ERP_PUBLISH_DEADLINE_MS ??= 45000;
}

function appendManualErpFixtureDependencies(dependencies, names, context) {
  if (names.includes('continueManualErpSync')) {
    dependencies.push(...['manualErpContinuationIsCurrent', 'waitForManualErpContinuation', 'requestManualErpContinuation',
      'recoverManualErpContinuationDeadline', 'isManualErpContinuationDeadline', 'retryManualErpContinuation',
      'applyManualErpContinuationReply', 'advanceManualErpContinuation', 'getTransientManualErpSliceStatus',
      'reduceManualErpSliceLimit', 'getManualErpContinuationDelay'].filter(name => !context[name]));
  }
  if (names.includes('runGoogleAppsScriptTrigger')) {
    dependencies.push(...['isCurrentManualErpStart', 'beginManualErpStart', 'authorizeManualErpStart',
      'applyManualErpStartResponse', 'reportManualErpStartFailure', 'isManualErpContinuationDeadline'].filter(name => !context[name]));
  }
}

export function goldenRuntimeDependencies(file, names, context) {
  if (file !== 'assets/app-runtime.js') return [];
  const dependencies = [];
  appendManualErpFixtureDependencies(dependencies, names, context);
  const reclassDependencies = {
    applyArgosInventoryReclassMoveCommand: ['prepareArgosReclassMove', 'dispatchArgosInventoryReclassMove',
      'isPendingReclassMoveDurable', 'requestArgosReclassMoveReceipt', 'reconcileArgosReclassMoveReceipt',
      'getArgosReclassReceiptRevision', 'publishArgosReclassMoveReceiptRows', 'clearArgosReclassMove',
      'handleArgosReclassMoveFailure', 'isUncertainReclassMove'],
    openEvalWorkSetupFromReclass: ['isArgosReclassMovePayload', 'prepareEvalWorkReclassMove', 'announcePendingArgosReclassMove',
      'focusEvalWorkSetupAssignee'],
    submitArgosInventoryTransaction: ['canSubmitArgosReclassForRow', 'beginArgosReclassSubmission',
      'buildArgosReclassSubmissionPayload', 'isArgosReclassMovePayload', 'confirmArgosReclassMoveSubmission',
      'announcePendingArgosReclassMove', 'reportArgosReclassSubmitFailure', 'resetArgosReclassSubmitButton',
      'queueArgosReclassInquiryDraft', 'reportArgosReclassDraftFailure', 'finishArgosReclassInquiry', 'didArgosReclassRequestLiveEdits'],
    postReclassCommand: ['postReclassRecoveryRpc', 'waitForReclassRecovery'],
  };
  for (const name of names) {
    dependencies.push(...(reclassDependencies[name] || []).filter(dependency => !context[dependency]));
  }
  if (names.includes('renderManagerTableManagementWorkspace')) {
    dependencies.push('managerTableDirectoryItems','renderManagerTableWorkspaceMarkup',
      'renderManagerTableDirectoryMarkup','renderManagerTableOption','renderManagerTableChoice');
  }
  if (names.includes('saveDockSuspendDcRequestMirrorData')) {
    for (const name of ['prepareSuspendDetailSource', 'buildSuspendDetailPatch', 'captureSuspendDetailTarget',
      'restoreSuspendDetailTarget', 'beginSuspendDetailOptimisticPatch', 'handleSuspendDetailSaveError']) {
      if (!context[name]) dependencies.push(name);
    }
  }
  if (names.includes('supabaseRpc')) {
    for (const name of ['readDatasetRevisionRpc', 'prepareRpcAuthorization', 'finishSupabaseRpc',
      'finishOwnerReplay', 'rejectOwnerAttempt', 'dispatchOwnerAttempt', 'requestOwnerHedged', 'dispatchRpcWithRecovery']) {
      if (!context[name]) dependencies.push(name);
    }
  }
  if (names.includes('postAppFunctionJson')) {
    for (const name of ['decodeAppFunctionResponse','reportAppFunctionFailure','createAppFunctionError']) {
      if (!context[name]) dependencies.push(name);
    }
  }
  if (names.includes('getDockSuspendDcRequestPlanstartInfo') && !context.getWeekdayColorForPlanStart) {
    dependencies.push('getWeekdayColorForPlanStart');
  }
  if (names.includes('resolveCanonicalInventoryRow')) {
    dependencies.push('collectCanonicalInventoryPhotos','canonicalPhotoMetadataValue','parseCanonicalPhotoMetadata',
      'applyCanonicalInventoryPhotos','applyCanonicalInventoryMetricAliases','canonicalMetricFamilyValue','applyCanonicalMetricFamily');
  }
  if (names.includes('publishRowEvaluationToMasterAndNotes')) {
    dependencies.push('publishSeasonSalesOfficeEvaluation','publishRequestWorkEvaluation','reconcileRequestPublicationMaster','reportDeferredRequestPublication');
  }
  return dependencies;
}
