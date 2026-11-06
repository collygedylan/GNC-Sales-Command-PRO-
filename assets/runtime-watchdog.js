(function installRuntimeWatchdog(global) {
  'use strict';
  if (global.GncRuntimeWatchdog) return;
  const STALL_MS = 4000;
  const PARITY_STALL_MS = 2000;
  const ROLE_ALIASES = Object.freeze({
    admin: 'admin', 'sales rep': 'sales_rep', salesrep: 'sales_rep', sales_rep: 'sales_rep',
    supervisor: 'supervisor', evaluator: 'evaluator', kier: 'kier', 'dock office': 'dock_office', dock_office: 'dock_office',
    'qc supervisor': 'qc_supervisor', qc_supervisor: 'qc_supervisor', shipping: 'shipping', 'data entry': 'data_entry',
    data_entry: 'data_entry', foreman: 'foreman', 'take backs': 'take_backs', take_backs: 'take_backs'
  });
  const OWNERS = Object.freeze({ home: 'agdata-sync-and-supabase-architect', drive: 'agdata-drive-and-av-specialist', av: 'agdata-drive-and-av-specialist', docks: 'agdata-docks-and-orders-specialist', que: 'agdata-queue-and-reclass-specialist', request: 'agdata-queue-and-reclass-specialist', managers: 'agdata-field-ops-and-qc', bloom: 'agdata-bloom-and-request-specialist', comm: 'agdata-docks-and-orders-specialist', chat: 'agdata-docks-and-orders-specialist' });
  const REPORT_QUEUE_PREFIX = 'agdata.runtime-watchdog.pending.v2:';
  const LEGACY_REPORT_QUEUE_PREFIXES = Object.freeze(['agdata.runtime-watchdog.pending.v1:']);
  const MAX_QUEUED_REPORTS = 100;
  const state = { memoryOnly: false, remoteReportAttempted: false, diagnostics: [], configured: false, apiUrl: '', username: '', role: '', revisions: {}, pending: new Map(), seen: new Set(), report: null, getSubModule: null, reportQueue: [], reportQueueOwner: '', reportTimer: null, reportRetryMs: 1000, reportGeneration: 0, reportFlushGeneration: null, viewKey: '', viewVisitId: 0, viewStartedAt: Date.now(), viewBaselines: new Map(), measuredViews: new Set() };
  const HANDLED_SCOPES = new Set(['preboot_auto_recovery','av_valid_photos_cross_season_guard','excel_style_filters_parity_guard','erp_filename_date_order_guard','detail_auto_return_on_mark_done_guard','thumbnail_broken_image_auto_heal','docks_no_trip_number_guard','docks_suspend_sync_guard',"addProductionWorkflowRow","applyBloomActionRowFormPayloadToLocalRow","applyCropRollLocalMasterPatch","applyCurrentUserLanguagePreference","applyDeferredShellReloadIfHidden","applyGlobalBackState","applyRealtimeChange","applyRequestRenderMarkup","bindToastDismissInteractions","broadcastDriveEvidenceLease","buildAvOptionEvalSnapshot","canSeeRecountRequestTab","canSeeShearListRequestTab","cancelAllDriveEvidenceSaves","cancelChatVoiceRecording","cancelDriveEvidenceSavesForItem","captureAppFilterState","captureEvalWorkLocalDraftSoon","clampIosDocumentScrollToTop","cleanupRealtime","clearAppApiWriteProxyUnavailable","clearBiometricLoginState","clearBootCacheForShellUpdate","clearChunkRenderTimersByKey","clearCropRollDriveViewCaches","clearDockMistakeIssuePhotoPreviewUrl","clearEvalWorkLocalDraft","clearExplicitLogoutMarker","clearNcrDraft","clearPendingPhotoPreview","clearPersistedManualSyncStartupState","clearScheduledCachePersist","clearShellForceRefreshMarkerIfCurrent","clearShellStaleRecoveryMarkerIfCurrent","closeDetailMeasurementKeyboard","closeLoginBlockingLayers","coerceAvOptionEvalObject","completeDetailMeasurementKeyboard","confirmCropRollCompletionPayloadSaved","copyTextWithFallback","createRuntimeWatchdogPanelOrNoop","discardAppliedAfterDenial","ensureAppEmailRecipientUsers","ensureCurrentShellBuild","ensureHlOrderAvailability","ensureProductivityHistoryBackfill","ensureRequestSchemaCompatible","ensureSubmittedRequestRowsRenderedBeforeEmail","executeBatchAction","extractPhotoDateIsoFromText_","finalizeChatVoiceRecording","focusChatRecipientInput","focusCropRollPriorityReviewField","focusDetailMeasurementNextField","focusInventoryEditMockModalField","focusNextMobileTextEntryField","focusSearchInputImmediately","forceCropRollCompletionVisibilityRefresh","forceShellBuildReload","formatInventoryEditMockTimestamp","getAppFilterStateStorageKey","getAppLiveEventClientId","getAvOptionEvalUserOptions","getBloomActionRowCurrentSeasonItemCodeHoldStop","getBloomActionRowSourceCandidates","getBloomPurposeRecipientOptions","getCropRollInquiryDecisionRowsForLookup","getDeferredCardPhotoObserver","getDockSuspendCompletionErrorMessage","getDockSuspendCompletionState","getEvalTaskRuleCandidateItems","getGroupedBloomNcrRecipientOptions","getIosRuntimeMainScrollTop","getIosRuntimePrimaryContentElement","getIosRuntimeVisibleViewId","getManagerBlockClearingCache","getManagerShortageCancelRows","getOffHoldPriorityChangeCandidates","getOffHoldPriorityChangeDefaultPriority","getRequestModalLookupOwnerSignature","getRequestSubmissionController","getSeasonSalesOfficeCompletionState","getShellServiceWorkerRegistration","handleCropRollFormFieldFocus","handleManagersSearch","handleRequestSwipeStart","hydrateInventoryConsolidationCache","initializeStartupPerformanceMode","installInternalLongTaskObserver","isDriveSpreadsheetGridMode","isIosRuntimeViewMostlyBlank","loadAdvertisementFabricImage","loadDockIssuePhotoSource","loadMainThreadPhotoSource","logIosFixedShellDiagnostics","logShellDiagnostics","makeRequestArchiveIdempotencyKey","manageAppPasskeys","markAppApiWriteProxyUnavailable","markDepartmentCalendarSeen","markMobilePushRefreshComplete","markSeasonSensitiveViewsDirty","maybeForceLatestStandaloneShell","maybePruneAppLiveEvents","maybeShowForegroundChatNotification","maybeShowForegroundDepartmentCalendarNotification","normalizeDepartmentCalendarArrayValue","normalizeIosNativeDetailMeasurementInput","normalizeRequestEmailThreadRow","notifyManagerUnassignedItems","openAppShellAfterLogin","openBloomPickerModal","openCropRollDuplicatePriorityResolver","openCropRollFinalPriorityPicker","openDetailMeasurementKeyboard","openEvalWorkAvNoteSheet","openEvalWorkSetupFromReclass","openLeafAssistant","openManagerEvalReport2BatchSetup","openPhotoModal","openSalesOfficeAvNoteModal","parseRemoteAppSeasonSettingsRow","parseRemoteAvBlanksPhotoBypassSettingsRow","persistAppAccessSnapshot","persistAppFilterStateNow","persistCropRollFormDrafts","persistDockSuspendCompletionState","persistEvalWorkLocalDraft","persistFallbackNcrCompletedRows","persistInventoryConsolidationCache","persistOutdoorModePreference","persistRequestCapabilities","persistSeasonSalesOfficeCompletionState","persistVerifiedLoginRecord","prepareIosCameraPickerOpen","prepareIosNativeDetailMeasurementInput","preserveAvNoteTextFocus","primeOpsPilotAppearanceForVerifiedUser","primePhotoModalAroundIndex","processDylanFileProcessedToasts","readAppFilterStateSnapshot","readEvalWorkOfflineDraftRows","reconcileArgosReclassInquiryMarkup","recordGncPerfStat","recordLinkedRequestUpdateDiagnostic","recoverStandaloneShellController","refreshIosRuntimeVisibleView","refreshNativeRoleAndCapabilities","registerAppPasskey","rememberDeferredShellReload","rememberIosRuntimeRecoveryReload","removeNcrDraftPhoto","removeNotOnInventoryPhoto","renderChat","renderDriveAltLocPanel","renderExistingRequestFolderPickerFailure","renderRequestQtyStepCurrentItem","renderRequestThisLocationPanel","repairIosRuntimeLayout","requestAdminRecipientUsersForSelector","requestIosRuntimeShellVersion","requireCurrentRequestReuseDecision","resetLoginUiState","resetNotOnInventoryDraftState","resetTransientScrollGestureState","restoreDetailMeasurementFieldFocus","restoreRequestModalActiveTextState","restoreRequestSuspendTagSearchInputState","restoreSearchInputFocusIfSafe","resumeSuspendTagApproval","returnToCropRollLocationAfterDone","runAfterShellInteractive","runDirectTrackedNavigation","runInventoryStatusMutation","runWithDriveEvidenceCrossTabLock","runtime-operation","runtime-render","saveCompletedMoveIds","saveCropRollDetailCompletionRow","saveCropRollDetailForm","saveCropRollFinalPriorityPromptCompletedRow","saveCropRollInquiryDecisionFields","saveCropRollInquiryRow","saveCropRollReviewPriority","saveMoveActualMovedMap","saveMoveTaMap","scheduleBackgroundLoginValidation","scheduleChunkRenderTimeout","scheduleDeferredShellReloadAfterTyping","scrollMainAreaToTop","selectEvalWorkOrigin","setAdaptivePerformanceLevel","setBloomShiftReportColumnSearch","setCompletedRequestFolderReadMap","setEvalWorkDetailView","setExplicitLogoutMarker","setFlyerCompletePushMap","setIosRuntimeMainScrollTop","setMainAreaScrollTop","setPendingRequestArchiveMap","setProductionWorkflowFilter","setProductionWorkflowPanelHtml","setShearDriveFilter","setShellStaleRecoveryMarker","setStoredTargetShellBuild","setWeatherHoldInventoryFilter","shareBloomPurposeEmail","shareInventoryItems","shareRequestFolder","shell-bootstrap","showForcedPasswordChangeGate","signInWithAppPasskey","startChatVoicePress","startLoginNetworkTrace","stopChatVoiceRecorderStream","stopGrowerScoutRecorderStream","stopLeafSpeechPlayback","stopLeafVoiceInput","submitShearList","subscribeCurrentDeviceForPush","supabaseRpc","syncBloomActionRowFormModalUi","syncEvalWorkSetupSummary","syncRequestHeaderSearchChrome","syncShellBuildUrl","teardownDetailPresentation","triggerDetailKeyboardHaptic","trimDeferredCardPhotoHydrationState","trimDeferredChromeSyncTasks","trimInternalPlainObject","unsubscribeEvalWorkRealtime","updateDashboardSyncSummary","upsertBloomPickerOrderDraft","writeLocalAppSeasonSettings","writeLocalAvBlanksPhotoBypassSettings","writeReclassDeliveryJobs"]);
  const HANDLED_CODES = new Set(['PHOTO_SEASON_SCOPE','FILTER_PARITY','DUPLICATE_TAG','RESURRECTED_TAG','LOCATION_MISMATCH','DUPLICATE_CARD','HIERARCHY_MISMATCH','HANDLED_OPERATION_FAILURE', 'READ_FAILED', 'MUTATION_FAILED', 'HYDRATION_FAILED', 'RENDER_FAILED', 'SYNC_FAILED']);
  const handledRing = [];
  const handledSeen = new Set();
  const FIELD_TYPES = new Set(['UI_ERROR_BANNER_SHOWN','UI_CONTROL_BAR_EMPTY','UI_GEOMETRY_ANOMALY','QUEUE_BADGE_MISMATCH','CLIENT_VERSION_DRIFT','RPC_FAILURE']);
  const FIELD_CODES = new Set(['55P03','42501','P0001','HTTP_400','HTTP_401','HTTP_403','HTTP_409','HTTP_500','HTTP_504','TIMEOUT','LOCK_TIMEOUT','SAVE_FAILED','LOAD_FAILED','OPERATION_FAILED','NETWORK','RESTRICTED','MOVE_NOT_SAVED','ROW_LOCKED','ERROR','EMPTY_TABS','WIDE_TAB','FOOTER_MISSING','FOOTER_OFFSCREEN','BADGE_CAPPED','BADGE_EXCESS','FOREIGN_OWNER','OLDER_BUILD']);
  const FIELD_SCOPES = new Set(['suspend-tag','unlock','reclass','request','rpc','ui','queue','navigation','version','home','av','drive','docks','detail','managers']);
  const fieldSeen = new Map();
  const readTimeouts = new Map();
  function recoverReadTimeout(key) {
    for (const [id, entry] of readTimeouts) {
      if (id === key || (key === undefined && entry.owner === state.username && entry.view === view())) {
        global.clearTimeout(entry.timer); readTimeouts.delete(id);
      }
    }
  }
  function deferReadTimeout(key) {
    recoverReadTimeout(key);
    const entry = {owner:state.username, view:view()};
    if (state.username && !document.hidden && !readTimeouts.size) state.recoverRead?.();
    entry.timer = global.setTimeout(() => {
      readTimeouts.delete(key);
      if (entry.owner === state.username && entry.view === view()) observeError('Read','TIMEOUT',false,'RPC_FAILURE');
    }, 15000);
    readTimeouts.set(key,entry);
  }
  const bannerSelector = '.error-banner,.workflow-error-banner,.load-error,[data-kind="error"],[role="alert"][aria-live="assertive"]';
  function observeError(title, message, shown = false, kind = 'UI_ERROR_BANNER_SHOWN', driveCommand = '') {
    const value = (String(title || '').slice(0,160) + ' ' + String(message || '').slice(0,900)).trim();
    if (kind === 'RPC_FAILURE' && (document.hidden || document.visibilityState === 'hidden' || message?.name === 'AbortError' || message?.code === 'REQUEST_ABORTED')) return false;
    if (kind === 'UI_ERROR_BANNER_SHOWN' && !shown) return false;
    if (!value || isIgnorableRuntimeNoise(value) || /REQUEST_ABORTED|AbortError|watchdog_(log|list|resolve)_event|resolve_runtime_watchdog_events_v23158/i.test(value)) return false;
    const sql = value.match(/(?:^|[^a-z0-9])(55P03|42501|P0001)(?![a-z0-9])/i);
    const http = value.match(/\b(?:http|status|returned|rpc)[\s:_(]*(400|401|403|409|500|504)\b/i);
    const code = /lock.*timed? ?out|lock timeout/i.test(value) ? 'LOCK_TIMEOUT' : sql ? sql[1].toUpperCase() : http ? 'HTTP_' + http[1] :
      /timed?\s*out|timeout/i.test(value) ? 'TIMEOUT' : /remains? locked|unlock not confirmed/i.test(value) ? 'ROW_LOCKED' :
      /move not saved/i.test(value) ? 'MOVE_NOT_SAVED' : /restricted|forbidden|denied|do not have access|only update rows assigned/i.test(value) ? 'RESTRICTED' :
      /failed to fetch|networkerror|connection lost/i.test(value) ? 'NETWORK' : shown || /could not|failed|\berror\b|DATABASE_/i.test(value) ? (/save|write/i.test(value) ? 'SAVE_FAILED' : /load|refresh/i.test(value) ? 'LOAD_FAILED' : /required|invalid/i.test(value) ? 'VALIDATION_REQUIRED' : 'OPERATION_FAILED') : '';
    if (!code || code === 'VALIDATION_REQUIRED') return false;
    const scope = /suspend|complete tag/i.test(value) ? 'suspend-tag' : /unlock|row remains locked/i.test(value) ? 'unlock' :
      /reclass|move not saved/i.test(value) ? 'reclass' : /request/i.test(value) ? 'request' : kind === 'RPC_FAILURE' ? 'rpc' : FIELD_SCOPES.has(view()) ? view() : 'ui';
    return reportField(kind, scope, code, driveCommand);
  }
  function reportField(type, scope, code, driveCommand = '') {
    if (!state.configured || !state.username || !FIELD_TYPES.has(type) || !FIELD_SCOPES.has(scope) || !FIELD_CODES.has(code)) return false;
    const current = view().replace(/[^a-z0-9-]/g,'').slice(0,60) || 'unknown';
    const command = /^drive-[a-z0-9_-]{8,175}$/i.test(driveCommand) ? driveCommand : '';
    const key = [state.username,current,scope,type,code,command].join('|'), now = Date.now();
    if (fieldSeen.has(key) && now - fieldSeen.get(key) < 60000) return false;
    fieldSeen.delete(key); fieldSeen.set(key,now);
    if (fieldSeen.size > MAX_QUEUED_REPORTS) fieldSeen.delete(fieldSeen.keys().next().value);
    record(type,{view_id:current,sub_module:scope,error_message:[type,scope,code].join(':'),driveCommand:command,suspected_functions:[scope]});
    return true;
  }
  function inspectIntegrity(root,current) {
    if (!state.username || document.hidden || !global.innerHeight || current === 'login' || current === 'unknown') return;
    const nav = document.getElementById('bottom-nav');
    if (!nav) reportField('UI_GEOMETRY_ANOMALY','navigation','FOOTER_MISSING');
    else {
      const viewport = global.visualViewport;
      const bottom = viewport?.height ? viewport.offsetTop + viewport.height : Math.max(global.innerHeight || 0, document.documentElement?.clientHeight || 0);
      const editing = (['detail-measurement-keyboard-open','keyboard-open','measurement-keyboard-open'].some(key => document.body?.classList?.contains(key))
        || (document.activeElement?.matches?.('input,textarea,[contenteditable=true]') && viewport && viewport.height < global.innerHeight - 80));
      const style = global.getComputedStyle?.(nav);
      const pinned = style?.position === 'fixed' && parseFloat(style.bottom) === 0;
      if (!editing && !pinned && nav.getBoundingClientRect?.().bottom > bottom + 8) {
        nav.style.setProperty('position','fixed','important');
        nav.style.setProperty('bottom','0','important');
        if (nav.getBoundingClientRect().bottom > Math.max(bottom, global.innerHeight) + 8) reportField('UI_GEOMETRY_ANOMALY','navigation','FOOTER_OFFSCREEN');
      }
    }
    if (!['request','que'].includes(current)) return;
    const bar = document.getElementById('request-filter-toolbar') || root.querySelector?.('[data-que-tabs]');
    // Drilldowns intentionally hide the tabs. Only the rendered queue root owns this check.
    if (!state.queueAtRoot || state.queueAtRoot()) {
      const tabs = [...(bar?.querySelectorAll?.('.request-category-chip, [role="tab"]') || [])].filter(tab => tab.offsetWidth > 0 && isVisibleParityNode(tab));
      if (!tabs.length) reportField('UI_CONTROL_BAR_EMPTY','queue','EMPTY_TABS');
      else if (bar.clientWidth > 0 && tabs.some(tab=>tab.offsetWidth >= bar.clientWidth * .90)) reportField('UI_GEOMETRY_ANOMALY','queue','WIDE_TAB');
    }
    const audit = state.getQueueAudit?.(root);
    const badge = document.getElementById('footer-request-badge') || document.querySelector('#nav-que [data-badge]');
    if (badge && isVisibleParityNode(badge)) {
      const label = String(badge.textContent || '').trim();
      if (label === '99+' || (Number.isFinite(audit?.total) && /^\d+$/.test(label) && Number(label) > audit.total)) {
        state.recountQueue?.();
        const corrected = String(badge.textContent || '').trim();
        if (isVisibleParityNode(badge) && corrected === '99+') reportField('QUEUE_BADGE_MISMATCH','queue','BADGE_CAPPED');
        else if (isVisibleParityNode(badge) && Number(corrected) > audit?.total) reportField('QUEUE_BADGE_MISMATCH','queue','BADGE_EXCESS');
      }
    }
    if (audit?.foreign) reportField('QUEUE_BADGE_MISMATCH','queue','FOREIGN_OWNER');
  }
  function inspectBanner(node) {
    if (!node || !isVisibleParityNode(node) || node.closest?.('#runtime-watchdog-events, #runtime-watchdog-header-badge')) return;
    const value = String(node.textContent || '').trim().slice(0,1024);
    if (['success','input-guidance'].includes(node.dataset?.kind) || !node.matches?.(bannerSelector)) return;
    if (value && (!node.getClientRects || node.getClientRects().length)) observeError('', value, true, 'UI_ERROR_BANNER_SHOWN', node.dataset?.driveCommand);
  }
  function safeIgnoreProbeError(_scope) { /* Intentional capability/storage probe; no telemetry. */ }
  function reportHandledRuntimeIssue(scope, errorCode, _meta) {
    try {
      if (_meta && FIELD_TYPES.has(_meta.eventType)) return reportField(_meta.eventType,scope,errorCode);
      const safeScope = typeof scope === 'string' && HANDLED_SCOPES.has(scope) ? scope : 'runtime-operation';
      const safeCode = typeof errorCode === 'string' && HANDLED_CODES.has(errorCode) ? errorCode : 'HANDLED_OPERATION_FAILURE';
      const rawVersion = global.__APP_RELEASE_VERSION__;
      const version = typeof rawVersion === 'string' && /^(?:AgData v)?\d+\.\d+\.\d+$/.test(rawVersion) ? rawVersion : 'unknown';
      const active = view();
      const owningSkill = OWNERS[active] || 'agdata-app-shell-and-navigation';
      const clusterId = ({home:'Cluster 8', drive:'Cluster 3', av:'Cluster 3', docks:'Cluster 7', que:'Cluster 4', request:'Cluster 4', managers:'Cluster 5', bloom:'Cluster 6', comm:'Cluster 7', chat:'Cluster 7'})[active] || 'Cluster 1';
      const fingerprint = [safeScope, safeCode, clusterId].join(':');
      const key = [version, safeScope, fingerprint].join('|');
      if (handledSeen.has(key)) return false;
      handledSeen.add(key);
      handledRing.push(Object.freeze({ timestamp: Date.now(), version, scope: safeScope, errorCode: safeCode, clusterId, owningSkill, fingerprint }));
      if (handledRing.length > 100) { const old = handledRing.shift(); handledSeen.delete([old.version, old.scope, old.fingerprint].join('|')); }
      capture({ code: safeCode }, safeScope);
      return true;
    } catch (_) { return false; /* Terminal observer boundary: never recurse. */ }
  }
  global.reportHandledRuntimeIssue = reportHandledRuntimeIssue;
  global.safeIgnoreProbeError = safeIgnoreProbeError;
  Object.defineProperty(global, '__agdataWatchdogRingBuffer', { get: () => handledRing.slice() });
  if (global.AgDataKernel) Object.assign(global.AgDataKernel.watchdog, { reportHandledRuntimeIssue, safeIgnoreProbeError, getEntries: () => handledRing.slice() });
  let parityWait = null;
  function normalizedRole(value) { const key = String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); return ROLE_ALIASES[key] || key.replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'; }
  function view() { return String(document.body?.dataset?.currentView || document.querySelector('[id^="view-"]:not(.hidden)')?.id?.replace(/^view-/, '') || 'unknown').toLowerCase(); }
  function subModule() { try { return String(typeof state.getSubModule === 'function' ? state.getSubModule() || '' : global.activeHomeTab || ''); } catch (_) { return ''; } }
  function isIgnorableRuntimeNoise(value) { return global.__agdataVersionReloadPending === true || /ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)|NATIVE_PROFILE_RETRY_REQUIRED|REQUEST_ABORTED|DATASET_READ_SCOPE_CHANGED|VALIDATION_REQUIRED/i.test(String(value || '')); }
  function fingerprint(event) { return [event.event_type, event.view_id, event.sub_module, event.error_message].join('|').toLowerCase().slice(0, 400); }
  function reportKey(event) { return `${event.username}:${event.fingerprint}:${event.app_version}`; }
  function reportStorageKey(username = state.username) { return `${REPORT_QUEUE_PREFIX}${String(username || '').trim().toLowerCase()}`; }
  function persistReportQueue() {
    if (!state.reportQueueOwner) return;
    try {
      const durable = state.memoryOnly ? state.reportQueue.filter(event => FIELD_TYPES.has(event.event_type)) : state.reportQueue;
      if (durable.length) global.localStorage?.setItem(reportStorageKey(state.reportQueueOwner), JSON.stringify(durable.slice(-MAX_QUEUED_REPORTS)));
      else global.localStorage?.removeItem(reportStorageKey(state.reportQueueOwner));
    } catch (_) { /* Storage failure must never block the app. */ }
  }
  function loadReportQueue(username) {
    const owner = String(username || '').trim().toLowerCase();
    state.reportQueueOwner = owner;
    state.reportQueue = [];
    if (!owner) return;
    try {
      LEGACY_REPORT_QUEUE_PREFIXES.forEach(prefix => global.localStorage?.removeItem(`${prefix}${owner}`));
      const parsed = JSON.parse(global.localStorage?.getItem(reportStorageKey(owner)) || '[]');
      if (!Array.isArray(parsed)) return;
      const currentVersion = String(global.__APP_RELEASE_VERSION__ || '');
      state.reportQueue = parsed.filter(event => event && typeof event === 'object' && !Array.isArray(event)
        && String(event.username || '').trim().toLowerCase() === owner && String(event.fingerprint || '')
        && String(event.app_version || '') && (FIELD_TYPES.has(event.event_type)
          ? FIELD_CODES.has(event.error_message?.split(':')[2]) && FIELD_SCOPES.has(event.sub_module) && event.error_message === [event.event_type,event.sub_module,event.error_message.split(':')[2]].join(':')
          : !state.memoryOnly && (!currentVersion || String(event.app_version) === currentVersion))).slice(-MAX_QUEUED_REPORTS);
      state.reportQueue.forEach(event => state.seen.add(reportKey(event)));
      if (state.reportQueue.length !== parsed.length) persistReportQueue();
    } catch (_) { state.reportQueue = []; }
  }
  function scheduleReportRetry() {
    if ((state.memoryOnly && !state.reportQueue.some(event=>FIELD_TYPES.has(event.event_type))) || document.hidden || state.reportTimer !== null || !state.reportQueue.length) return;
    const delay = state.reportRetryMs;
    state.reportRetryMs = Math.min(60000, Math.max(1000, state.reportRetryMs * 2));
    state.reportTimer = global.setTimeout(() => { state.reportTimer = null; flushPendingReports(); }, delay);
  }
  async function flushPendingReports() {
    if (document.hidden || state.reportFlushGeneration === state.reportGeneration || !state.configured || !state.username || typeof state.report !== 'function'
      || state.reportQueueOwner !== state.username || !state.reportQueue.length) return false;
    const generation = state.reportGeneration;
    state.reportFlushGeneration = generation;
    const owner = state.username;
    const reporter = state.report;
    try {
      while (!document.hidden && state.reportQueue.length && state.reportQueueOwner === owner && state.username === owner) {
        const event = state.reportQueue[0];
        try {
          if (state.memoryOnly && !FIELD_TYPES.has(event.event_type)) {
            if (state.remoteReportAttempted) { state.reportQueue.shift(); continue; }
            state.remoteReportAttempted = true;
          }
          const result = await reporter(event);
          if (result === false || result?.ok === false) throw new Error('Watchdog report was not accepted.');
          if (state.reportGeneration !== generation || state.reportQueueOwner !== owner || state.username !== owner || state.reportQueue[0] !== event) return false;
          state.reportQueue.shift();
          state.reportRetryMs = 1000;
          persistReportQueue();
          if (!state.reportQueue.length && state.reportTimer !== null) { global.clearTimeout(state.reportTimer); state.reportTimer = null; }
        } catch (_) {
          if (state.reportGeneration === generation && state.reportQueueOwner === owner && state.username === owner) {
            persistReportQueue();
            scheduleReportRetry();
          }
          return false;
        }
      }
      return true;
    } finally {
      if (state.reportFlushGeneration === generation) state.reportFlushGeneration = null;
      if (state.reportQueue.length && state.reportQueueOwner === state.username && state.reportFlushGeneration === null) scheduleReportRetry();
    }
  }
  function send(event) {
    if (!state.configured || !state.username || state.reportQueueOwner !== state.username) return;
    if (state.memoryOnly && !FIELD_TYPES.has(event.event_type)) {
      const diagnostic = { event_type: event.event_type, view_id: event.view_id, timestamp: Date.now() };
      state.diagnostics.push(diagnostic);
      if (state.diagnostics.length > 100) state.diagnostics.shift();
      if (state.remoteReportAttempted || state.reportQueue.length || !['UNHANDLED_JS_EXCEPTION', 'UNHANDLED_PROMISE_REJECTION', 'UI_LOCKOUT_BANNER'].includes(event.event_type)) return;
      event = { ...event, error_message: event.event_type, suspected_functions: [] };
    }
    const key = reportKey(event);
    if (state.seen.has(key) || state.reportQueue.some(row => reportKey(row) === key)) return;
    state.seen.add(key);
    state.reportQueue.push(event);
    if (state.reportQueue.length > MAX_QUEUED_REPORTS) state.reportQueue.splice(0, state.reportQueue.length - MAX_QUEUED_REPORTS);
    persistReportQueue();
    void flushPendingReports();
  }
  function record(type, details = {}) {
    if (/(?:^|:)VALIDATION_REQUIRED(?:$|\b)/.test(String(details.error_message || ''))) return false;
    const currentView = String(details.view_id || view());
    const event = {
      event_type: String(type).slice(0, 64), severity: details.severity || (type.includes('LOCKOUT') || type.includes('PARITY') ? 'high' : 'medium'),
      app_version: String(global.__APP_RELEASE_VERSION__ || 'unknown'), username: state.username, normalized_role: normalizedRole(state.role),
      view_id: currentView, sub_module: String(details.sub_module || subModule()), duration_ms: Math.max(0, Number(details.duration_ms) || 0),
      error_message: String(details.error_message || '').slice(0, 1000), dataset_revisions_snapshot: details.driveCommand
        ? {...state.revisions, drive_command:{revision:details.driveCommand}} : state.revisions,
      cluster_id: ({ home: 'Cluster 8', drive: 'Cluster 3', av: 'Cluster 3', docks: 'Cluster 7', que: 'Cluster 4', request: 'Cluster 4', managers: 'Cluster 5', bloom: 'Cluster 6', comm: 'Cluster 7', chat: 'Cluster 7' })[currentView] || 'Cluster 1',
      owning_skill: OWNERS[currentView] || 'agdata-app-shell-and-navigation', suspected_functions: Array.isArray(details.suspected_functions) ? details.suspected_functions.slice(0, 8) : [], fingerprint: ''
    };
    event.fingerprint = fingerprint(event);
    if (event.dataset_revisions_snapshot?.drive_command?.revision) {
      event.fingerprint += '|' + state.username + '|' + event.dataset_revisions_snapshot.drive_command.revision;
    }
    send(event); return event;
  }
  function capture(error, operation = 'unknown') {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || isIgnorableRuntimeNoise(error?.code || error?.message)) return false;
    const owner = String(operation).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160) || 'unknown';
    const code = String(error?.code || error?.name || 'Error').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 64);
    // Do not send payloads, credentials, row data or arbitrary exception messages.
    // This sensor never mutates app state or repairs code. Its own transport failure
    // is intentionally terminal, so observing an error cannot recurse into itself.
    if (state.memoryOnly && state.configured) return reportField('RPC_FAILURE', 'rpc', FIELD_CODES.has(code) ? code : 'ERROR');
    try { record('OPERATIONAL_FAILURE', { severity: 'high', error_message: `${owner} failed (${code || 'Error'})`, suspected_functions: [owner] }); }
    catch (_) { return false; }
    return true;
  }
  function isVisibleParityNode(node) { return !!node && !node.hidden && !node.closest?.('.hidden, [hidden], [aria-hidden="true"]'); }
  function hasEvalLoadingText(root) {
    return [...root.querySelectorAll('*')].some(node => node.children.length === 0 && isVisibleParityNode(node)
      && /^Loading(?:\.{3}|\u2026)$/i.test(String(node.textContent || '').trim()));
  }
  function findVisibleLoadingIndicator(root) {
    return [...root.querySelectorAll('.skeleton, .skeleton-bar, [aria-busy="true"], .loading, [data-loading="true"]')]
      .find(isVisibleParityNode) || [...root.querySelectorAll('*')].find(node => node.children.length === 0 && isVisibleParityNode(node)
        && /LOADING DATA\.\.\./i.test(node.textContent || ''));
  }
  function inspectDataParity(root, current, currentSubModule) {
    const eval2 = current === 'managers' && currentSubModule === 'eval-reports-2';
    const waiting = eval2 && !document.hidden && hasEvalLoadingText(root);
    const key = `${state.reportGeneration}:${current}:${currentSubModule}`;
    if (parityWait && (!waiting || parityWait.key !== key)) { global.clearTimeout(parityWait.timer); parityWait = null; }
    if (waiting && !parityWait) {
      const startedAt = Date.now();
      parityWait = { key, timer: global.setTimeout(() => {
        if (!parityWait || parityWait.key !== key) return;
        parityWait = null;
        const nextRoot = document.getElementById(`view-${current}`) || document.body;
        if (!document.hidden && view() === current && subModule() === currentSubModule
          && key === `${state.reportGeneration}:${current}:${currentSubModule}` && hasEvalLoadingText(nextRoot)) {
          record('DATA_PARITY_MISMATCH', { view_id: current, sub_module: currentSubModule,
            duration_ms: Math.max(PARITY_STALL_MS, Date.now() - startedAt),
            error_message: 'Eval Reports #2 Loading... rows persisted beyond 2000ms',
            suspected_functions: ['renderManagerEvalReport2Records', 'mountPagedManagerReport'] });
        }
      }, PARITY_STALL_MS) };
    }
    if (document.hidden) return;
    if (current === 'request' || current === 'que') {
      const missing = [...root.querySelectorAll('[data-suspend-tag-card="true"]')].filter(isVisibleParityNode)
        .some(card => [...card.querySelectorAll('[data-queue-metric]')]
          .some(metric => isVisibleParityNode(metric) && String(metric.textContent || '').trim() === '--'));
      if (missing) record('DATA_PARITY_MISMATCH', { view_id: current, sub_module: 'suspend',
        error_message: 'Que SUSPEND rendered unresolved -- inventory metrics',
        suspected_functions: ['buildSuspendTagRenderPlan', 'buildQueueInventoryMetricsHtml'] });
    }
    if (eval2) {
      const countsRoot = root.querySelector('[data-eval-report-counts-ready="true"]');
      const counts = countsRoot ? [...countsRoot.querySelectorAll('[data-eval-report-count]')] : [];
      // A legitimately empty published dataset or report is not an incident.
      if (Number(countsRoot?.dataset?.evalSourceRowCount) > 0 && Number(countsRoot?.dataset?.evalReportMatchCount) > 0
        && counts.length === 11 && counts.every(node => Number(node.dataset.evalReportCount) === 0)) {
        record('DATA_PARITY_MISMATCH', { view_id: current, sub_module: currentSubModule,
          error_message: 'All 11 Eval report counts are zero despite matching published source rows',
          suspected_functions: ['buildManagerEvalReport2IndexAsync', 'report_read_v2'] });
      }
    }
  }
  function docks_suspend_sync_guard() {
    const audit=state.getDocksSuspendAudit?.();
    if (!audit || audit.pending) return;
    const failures=[
      [audit.duplicates,'DUPLICATE_TAG'],[audit.resurrected,'RESURRECTED_TAG'],
      [audit.mismatches,'LOCATION_MISMATCH'],[audit.duplicateCards,'DUPLICATE_CARD'],
      [audit.hierarchyMismatch,'HIERARCHY_MISMATCH']
    ];
    for (const [failed,code] of failures) if(failed) reportHandledRuntimeIssue('docks_suspend_sync_guard',code);
  }
  function erp_filename_date_order_guard() {
    if (state.filenameOrderValid?.() !== false || state.filenameRepairAttempted) return;
    state.filenameRepairAttempted = true;
    reportHandledRuntimeIssue('erp_filename_date_order_guard','FILENAME_ORDER_INVALID');
    Promise.resolve(state.recoverFilenameOrder?.()).catch(() => {});
  }
  function detail_auto_return_on_mark_done_guard() {
    const recover = state.detailReturn; state.detailReturn = null;
    if (!recover) return;
    state.recoveringDetail = true;
    try { if (recover()) reportHandledRuntimeIssue('detail_auto_return_on_mark_done_guard','DETAIL_RETURN_RECOVERED'); }
    finally { state.recoveringDetail = false; }
  }
  function thumbnail_broken_image_auto_heal(root) {
    for (const img of root.querySelectorAll?.('.photo-thumb img, .saved-photo-tile img') || []) {
      const local = img.dataset?.localPreviewUrl;
      if (img.complete && img.naturalWidth === 0 && /^(blob:|data:image\/)/.test(local || '') && img.getAttribute('src') !== local) {
        img.src = local;
        reportHandledRuntimeIssue('thumbnail_broken_image_auto_heal','LOCAL_PREVIEW_RESTORED');
      }
    }
  }
  function docks_no_trip_number_guard(root, current) {
    if (current !== 'docks') return;
    const invalid = [...(root.querySelectorAll?.('h1,h2,h3,h4,[data-dock]') || [])].some(node => /^Dock\s+T\d+/i.test(String(node.textContent || '').trim()) || /^T\d+/i.test(node.dataset?.dock || ''));
    if (!invalid) { state.dockRepairAttempted = false; return; }
    if (state.dockRepairAttempted) return;
    state.dockRepairAttempted = true;
    reportHandledRuntimeIssue('docks_no_trip_number_guard','TRIP_DOCK_INVALID');
    state.recoverDocks?.();
  }
  let prebootFlush = null, prebootRetry = null, lastFilterProbe = 0, bootReadyOwner = '';
  function flushPrebootRecoveries() {
    if (prebootFlush || !state.configured || !state.username || typeof state.report !== 'function' || document.hidden) return prebootFlush;
    if (global.__agdataHomeReadyUser !== state.username || bootReadyOwner === state.username + ':' + state.reportGeneration) return;
    const generation = state.reportGeneration, username = state.username, reporter = state.report;
    const version = String(global.__APP_RELEASE_VERSION__ || '').match(/(?:AgData v|v)?(\d+\.\d+\.\d+)/)?.[1];
    if (!version) return;
    const event = {event_type:'OPERATIONAL_FAILURE',severity:'low',app_version:version,username,normalized_role:normalizedRole(state.role),view_id:'home',sub_module:'preboot_auto_recovery',duration_ms:0,error_message:'SHELL_READY',cluster_id:'Cluster 1',owning_skill:'agdata-zero-lockout-guard',suspected_functions:['preboot_auto_recovery'],dataset_revisions_snapshot:{},fingerprint:'preboot_auto_recovery:ready:'+version+':'+username};
    prebootFlush = Promise.resolve().then(() => reporter(event)).then(result => {
      if (result === false || result?.ok === false) throw new Error('PREBOOT_RECEIPT_PENDING');
      if (state.reportGeneration !== generation || state.username !== username) return;
      bootReadyOwner = username + ':' + generation;
      try { global.localStorage?.setItem('agdata_preboot_recovery_log','[]'); } catch (_) {}
    }).catch(() => { if (prebootRetry === null) prebootRetry = global.setTimeout(() => { prebootRetry = null; void flushPrebootRecoveries(); }, 30000); }).finally(() => { prebootFlush = null; });
    return prebootFlush;
  }
  function av_valid_photos_cross_season_guard() {
    const audit=state.getAvPhotoAudit?.();
    if(audit?.active && (audit.allSeasons!==true || audit.missing>0)) {
      reportHandledRuntimeIssue('av_valid_photos_cross_season_guard','PHOTO_SEASON_SCOPE');
      state.recoverAvPhotoScope?.();
    }
  }
  function excel_style_filters_parity_guard() {
    const audit=state.getExcelFilterAudit?.();
    if(audit?.missing){reportHandledRuntimeIssue('excel_style_filters_parity_guard','FILTER_PARITY');state.recoverExcelFilters?.();}
  }
  function inspect() {
    const current = view(); const root = document.getElementById(`view-${current}`) || document.body;
    const currentSubModule = subModule();
    if(state.username && !document.hidden && Date.now()-lastFilterProbe>30000) {lastFilterProbe=Date.now();av_valid_photos_cross_season_guard();excel_style_filters_parity_guard();void flushPrebootRecoveries();}
    if (state.username && !document.hidden) {
      erp_filename_date_order_guard(); detail_auto_return_on_mark_done_guard();
      thumbnail_broken_image_auto_heal(root); docks_no_trip_number_guard(root,current);
    }
    inspectDataParity(root, current, currentSubModule);
    inspectIntegrity(root,current);
    if(state.username && !document.hidden && ['docks','request','que'].includes(current)) docks_suspend_sync_guard();
    const key = `${current}:${currentSubModule}`;
    if (key !== state.viewKey) { state.viewKey = key; state.viewVisitId++; state.viewStartedAt = Date.now(); }
    const waiting = findVisibleLoadingIndicator(root);
    if (waiting) {
      if (!state.pending.has(key)) state.pending.set(key, setTimeout(() => {
        state.pending.delete(key);
        const nextRoot = document.getElementById(`view-${current}`) || document.body;
        if (view() === current && findVisibleLoadingIndicator(nextRoot)) record('VIEW_LOAD_STALL', { view_id: current, sub_module: subModule(), duration_ms: STALL_MS, error_message: 'Loading indicator persisted beyond 4000ms' });
      }, STALL_MS));
    } else {
      if (state.pending.has(key)) { clearTimeout(state.pending.get(key)); state.pending.delete(key); }
      const visitKey = `${key}@${state.viewVisitId}`;
      if (!state.measuredViews.has(visitKey)) {
        state.measuredViews.add(visitKey);
        const duration = Math.max(0, Date.now() - state.viewStartedAt);
        const baselineKey = `${normalizedRole(state.role)}:${key}`;
        const baseline = state.viewBaselines.get(baselineKey);
        if (baseline && duration > baseline * 2.5 && duration > 250) record('ROLE_LATENCY_ANOMALY', { view_id: current, sub_module: currentSubModule, duration_ms: duration, error_message: `View completed in ${duration}ms versus ${Math.round(baseline)}ms session baseline` });
        state.viewBaselines.set(baselineKey, baseline ? baseline * 0.8 + duration * 0.2 : duration);
      }
    }
    const banners = [...root.querySelectorAll('[role="alert"], .error-banner, .load-error, .text-red-600, .text-red-700')].filter(node => /Load Failed|Access permissions changed|Some data could not be verified|Chat could not load|Could not load these rows/i.test(node.textContent || ''));
    for (const banner of banners) record('UI_LOCKOUT_BANNER', { view_id: current, severity: 'high', error_message: 'Operational view displayed a lockout banner' });
  }
  global.addEventListener('error', event => { if (!isIgnorableRuntimeNoise(event.message)) record('UNHANDLED_JS_EXCEPTION', { severity: 'high', error_message: String(event.message || 'Unhandled error'), suspected_functions: [String(event.filename || '').split('/').pop() + ':' + (event.lineno || '')] }); });
  global.addEventListener('unhandledrejection', event => { const message = String(event.reason?.message || event.reason || 'Unhandled rejection'); if (!isIgnorableRuntimeNoise(message)) record('UNHANDLED_PROMISE_REJECTION', { severity: 'high', error_message: message }); });
  let inspectionPending = false;
  const observer = new MutationObserver(records => {
    if (!state.username || document.hidden) return;
    for (const entry of records || []) {
      const target = entry.target?.nodeType === 3 ? entry.target.parentElement : entry.target;
      const banner = target?.closest?.(bannerSelector);
      if (banner) inspectBanner(banner);
      for (const node of entry.addedNodes || []) if (node.nodeType === 1 && node.matches?.(bannerSelector)) inspectBanner(node);
    }
    if (inspectionPending) return;
    inspectionPending = true;
    (global.requestAnimationFrame || global.setTimeout)(() => {
      inspectionPending = false;
      try {
        if (!state.username || document.hidden) return;
        inspect();
        for (const node of document.querySelectorAll?.(bannerSelector) || []) inspectBanner(node);
      } catch (_) { safeIgnoreProbeError('watchdog-inspect'); }
    }, 80);
  });
  if (document.documentElement) observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-busy', 'data-loading', 'data-eval-report-counts-ready', 'data-eval-report-count'] });
  document.addEventListener?.('error', event => { if (state.username && event.target?.matches?.('.photo-thumb img, .saved-photo-tile img')) thumbnail_broken_image_auto_heal(event.target.parentElement); }, true);
  global.addEventListener('online', () => { state.reportRetryMs = 1000; if (state.reportTimer !== null) { global.clearTimeout(state.reportTimer); state.reportTimer = null; } void flushPendingReports(); });
  document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) {
      if (state.reportTimer !== null) global.clearTimeout(state.reportTimer);
      state.reportTimer = null;
    } else void flushPendingReports();
  });
  global.GncRuntimeWatchdog = Object.freeze({
    configure(options = {}) { state.getAvPhotoAudit=options.getAvPhotoAudit;state.recoverAvPhotoScope=options.recoverAvPhotoScope;state.getExcelFilterAudit=options.getExcelFilterAudit;state.recoverExcelFilters=options.recoverExcelFilters; state.filenameOrderValid=options.filenameOrderValid; state.recoverFilenameOrder=options.recoverFilenameOrder; state.recoverDocks=options.recoverDocks; state.getDocksSuspendAudit=options.getDocksSuspendAudit; state.getQueueAudit=options.getQueueAudit; state.queueAtRoot=options.queueAtRoot; state.recountQueue=options.recountQueue; state.recoverRead=options.recoverRead; state.memoryOnly = options.memoryOnly === true; const username = String(options.username || '').trim().toLowerCase(); if (username !== state.username || username !== state.reportQueueOwner) { state.reportGeneration += 1; state.revisions = {}; if (state.reportTimer !== null) { global.clearTimeout(state.reportTimer); state.reportTimer = null; } state.reportRetryMs = 1000; loadReportQueue(username); } state.apiUrl = String(options.apiUrl || ''); state.username = username; state.role = String(options.role || ''); state.report = options.reportEvent; state.getSubModule = options.getSubModule; state.configured = true; state.revisions = options.datasetRevisions && typeof options.datasetRevisions === 'object' ? options.datasetRevisions : state.revisions; inspect(); void flushPendingReports(); void flushPrebootRecoveries(); },
    expectDetailReturn(recover) { if (state.recoveringDetail) return; state.detailReturn = recover; global.setTimeout(() => detail_auto_return_on_mark_done_guard(),0); },
    deferReadTimeout, recoverReadTimeout,
    toTransportEvent(event) {
      // The deployed Edge accepts OPERATIONAL_FAILURE. SQL restores the typed field event from the bounded token.
      const version = String(event.app_version || '').match(/^(?:AgData v|v)?(\d+\.\d+\.\d+)$/)?.[1];
      return {...event, ...(version ? {app_version:version} : {}), ...(FIELD_TYPES.has(event.event_type) ? {event_type:'OPERATIONAL_FAILURE'} : {})};
    },
    getDatasetRevisions: () => ({...state.revisions}), observeError, record, capture, reportHandledRuntimeIssue, safeIgnoreProbeError, normalizeRole: normalizedRole, setDatasetRevisions(value) { state.revisions = value && typeof value === 'object' ? value : {}; },
    inspect, flushPendingReports, flushPrebootRecoveries, constants: Object.freeze({ stallMs: STALL_MS, parityStallMs: PARITY_STALL_MS, roles: Object.freeze(Object.keys(ROLE_ALIASES)), maxQueuedReports: MAX_QUEUED_REPORTS })
  });
})(window);
