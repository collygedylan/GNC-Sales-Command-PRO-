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
  if (names.includes('supabaseRpc') || names.includes('assignEvalItemcodes')) {
    context.getSupabaseReadIdentityScope ??= ()=>'fixture-account';
    context.nativeAuthRecoveryEpoch ??= 1;
    context.nativeReadRequiresRls ??= ()=>true;
  }
  if (names.includes('continueManualErpSync')) {
    context.manualSyncStartGeneration ??= 0;
    context.erpSyncStepInFlight ??= false;
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
}

export function goldenRuntimeDependencies(file, names, context) {
  if (file !== 'assets/app-runtime.js') return [];
  const dependencies = [];
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
  return dependencies;
}
