// =========================================================================
// GNC PARK HILL - COMMAND 001 BACKEND ENGINE (DELTA SYNC) - HIGH PERFORMANCE
// =========================================================================

// ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ 1. RUN THIS ONCE TO CLEAR GOOGLE'S SECURITY WALL
function triggerPermissions() { 
  DriveApp.getRootFolder(); 
  GmailApp.getAliases(); 
  console.log("Permissions cleared! You are good to go."); 
}

// ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ 2. RUN THIS ONCE TO SETUP THE 7:30 AM DAILY ALARM
function setupHoursReminderTrigger() {
  let triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendHoursReminderEmail') { 
      ScriptApp.deleteTrigger(triggers[i]); 
    }
  }
  ScriptApp.newTrigger('sendHoursReminderEmail')
    .timeBased().everyDays(1).atHour(7).create();
  console.log("ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â° Daily 7:30 AM reminder trigger established!");
}

function sendHoursReminderEmail() {
  let day = new Date().getDay();
  if (day >= 1 && day <= 5) {
    let recipientList = "dylan_collyge@greenleafnursery.com"; 
    let subject = "GNC PARK HILL: Labor Hours Reminder";
    let body = "Reminder please turn your hours in by 8:15 a.m. Thanks! Management";
    GmailApp.sendEmail(recipientList, subject, body, { name: "GNC PARK HILL" });
  }
}

// =========================================================================
// SUPABASE CONSTANTS & FOLDERS
// =========================================================================
const SUPABASE_URL = 'https://kzrnyjsosryejjejliii.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cm55anNvc3J5ZWpqZWpsaWlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzAyNzM1NywiZXhwIjoyMDg4NjAzMzU3fQ.Bc46UfJ1N4AgAS1PgfhFg6S4BEyybR6g_TUnPZsE2t0';
const APP_LIVE_EVENTS_TABLE = 'v2_app_live_events';
const EMIT_APP_LIVE_EVENTS = true;

const FOLDERS = {
  MASTER_DROP: '1MWLYsQJ41bZVcg1SzDIw93uNmQpzPn48',
  MASTER_PROCESSED: '1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA',
  SOC_DROP: '19kd-yBZZeJfhJsITpyrzzANbJBNTs9eE',
  SOC_PROCESSED: '13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo',
  RESERVES_DROP: '1Xiyp6WQGAF-4Tm-KwSwi9RsBqulFcSAG',
  RESERVES_PROCESSED: '1u4Vk5L92zmcXXT2qNWzImWTud73Bpole',
  CAV_DROP: '1K-y4thhw_iu2UEEZGRc39LzlpUZtcOBZ',
  CAV_PROCESSED: '1reWKO3GzeFhwsy_ot7Sjb2RPiFs448A5'
};

const ALLOWED_DB_COLUMNS = new Set([
  'unique_id','concat','last_updated','assignedto','spec','caliper','pic_note','sales_note',
  'av_note','photo_link','photo_name','dock_spec','dock_caliper','dock_note','dock_photo_link',
  'dock_photo_name','date_completed','flyer_cat','flyer_title','flyer_inst','flyer_assigned',
  'flyer_notes','flyer_photo_link','flyer_photo_name','flyer_completed','initial_ptr',
  'loc_match_qty','end_cap_folder','end_cap_qty','end_cap_level','match','warehouseid',
  'warehousename','isreserve','salesrepid','salesrepname','nationalaccount','idgroup',
  'customeridentityid','customername','consigneeidentityid','consigneename','consigneecity',
  'consigneestate','consigneezip','tripnumber','stopnumber','zonecode','tagcode',
  'transactionnumber','purchaseordernumber','extunitprice','ordertotal','requestdate',
  'stagename','step','customersku','formattedupc','printedcontainercode','lotcode',
  'locationcode','descriptorcode','itemcode','plantgroupcode','sortnamevariety',
  'containersort','qualitycode','commonname','genusname','quantityordered','quantityshipped',
  'listprice','unitprice','handlingchargeperitem','taggingchargeperitem','combinedprice',
  'freightrateperitem','landed','retailprice','holdstopcode','holdstopreason','salesnote',
  'fnsalesnote','picknote','planstart','generalloadinstr','invoicedate','consigneeaddress_1',
  'consigneeaddress_2','altshipcomment','shiptotelephone_1','okloadinstructions',
  'txloadinstructions','ncloadinstructions','hlloadinstructions','dock','dock_num',
  'equiv_unit','equiv_uom','wingdingunits','dropweight','internalinvnote','hardinesszone',
  'brand','tagdeptnote','ext_unit_merch_shipped','ext_eunit_shipped','avg_price_eunit_shipped',
  'requestdateweek','carrier','suspend','suspend_to','qa_code','grower','priority',
  'ptronhand','ptrreviewed','ptravailable','season_supply','s_lts','itemspec','season',
  'mcstatus','hz','intercopo','insurancegroup','si_lts','a_lts','ai_lts','si_available',
  'holdstopenddate','salesnote_1','contsize', 'source', 'desigitem', 'desigcust', 'desigloc', 'filename',
  'holdstopbegindate', 'hrsseasonbegin', 'season_oh', 'season_demand', 'oversellpercentage',
  'locationnote', 'locationnotedate', 'specialpuller', 'pulltagnote1', 'pulltagnote2', 'fieldtagcolor',
  'inventorynote', 'locationptn1', 'locationptn2', 'prisetby', 'priupdated', 'bypassloc', 'largeptrqty',
  'maxorderquantity', 'lochold', 'ext_ptronhand', 'varietycode', 'botanicalname', 'reversecommon',

  'saleyear', 'blockalpha', 'blocknumber', 'bay', 'pullerresponsibility', 'season_available', 'salesnotebegindate'
]);

function runSOCOnly() { return processLatestFileOnlyFolder(FOLDERS.SOC_DROP, FOLDERS.SOC_PROCESSED, 'v2_soc_master', buildStandardPayload, { deltaMode: true }); }
function runDriveAroundOnly() { return processSnapshotBatchFolder(FOLDERS.MASTER_DROP, FOLDERS.MASTER_PROCESSED, 'v2_master_inventory', buildMasterPayload); }
function runReservesOnly() { return processLatestFileOnlyFolder(FOLDERS.RESERVES_DROP, FOLDERS.RESERVES_PROCESSED, 'v2_reserves', buildStandardPayload, { deltaMode: true }); }
function runCavOnly() { return processLatestFileOnlyFolder(FOLDERS.CAV_DROP, FOLDERS.CAV_PROCESSED, 'v2_cav_import', buildCavPayload, { deltaMode: true }); }

const MANUAL_SYNC_STATUS_KEY = 'MANUAL_SYNC_STATUS';
const MANUAL_SYNC_TRIGGER_HANDLER = 'runQueuedManualSyncStage_';
const MANUAL_SYNC_STAGE_ORDER_DEFAULT = Object.freeze(['drive', 'soc', 'reserves', 'cav']);
const MANUAL_SYNC_EXECUTION_BUDGET_MS = 285000;
const MANUAL_SYNC_NEXT_STAGE_START_CUTOFF_MS = 120000;
const MANUAL_SYNC_QUEUED_STALE_MS = 5 * 60 * 1000;
const MANUAL_SYNC_ACTIVE_STALE_MS = 12 * 60 * 1000;
const SUPABASE_DELETE_URL_MAX_LENGTH = 1800;
const SUPABASE_FETCH_PAGE_SIZE = 1000;
const SUPABASE_PAGED_READ_FETCH_BATCH_SIZE = 8;
const SUPABASE_UPSERT_FETCH_BATCH_SIZE = 6;
const SUPABASE_DELETE_FETCH_BATCH_SIZE = 2;
const SUPABASE_BY_ID_FETCH_BATCH_SIZE = 6;
const SUPABASE_MASTER_FETCH_PAGE_SIZE = 1000;
const SUPABASE_MASTER_FETCH_BATCH_SIZE = 4;
const SUPABASE_MASTER_FETCH_BATCH_DELAY_MS = 25;
const SUPABASE_MASTER_ID_FETCH_PAGE_SIZE = 1000;
const SUPABASE_MASTER_ID_FETCH_DELAY_MS = 0;
const SUPABASE_MASTER_COMPARE_FETCH_DELAY_MS = 0;
const EXCEL_CONVERSION_OPEN_RETRY_COUNT = 5;
const EXCEL_CONVERSION_OPEN_RETRY_DELAY_MS = 1000;
const DRIVE_OPERATION_RETRY_COUNT = 4;
const DRIVE_OPERATION_RETRY_DELAY_MS = 750;
const SUPABASE_FETCH_RETRY_COUNT = 3;
const SUPABASE_FETCH_RETRY_DELAY_MS = 900;
const DELAYED_REQUEST_EMAIL_QUEUE_KEY = 'DELAYED_REQUEST_EMAIL_QUEUE';
const DELAYED_REQUEST_EMAIL_TRIGGER_HANDLER = 'processDelayedRequestEmailQueue_';
const DELAYED_REQUEST_EMAIL_MIN_DELAY_MS = 30000;

function getAppLiveEventAreaForTable_(tableName) {
  const safeTable = String(tableName || '').trim();
  if (safeTable === 'v2_master_inventory') return 'inventory';
  if (safeTable === 'v2_soc_master') return 'docks';
  if (safeTable === 'v2_reserves') return 'reserves';
  if (safeTable === 'v2_cav_import') return 'av';
  if (safeTable === 'v2_sales_office') return 'sales-office';
  if (safeTable === 'v2_active_request') return 'request';
  return '';
}

function emitAppLiveEvent_(area, eventType, sourceTable, rowIds, payload) {
  if (!EMIT_APP_LIVE_EVENTS) return false;
  const safeArea = String(area || '').trim();
  const safeEventType = String(eventType || '').trim();
  const safeSourceTable = String(sourceTable || '').trim();
  if (!safeArea || !safeEventType || !safeSourceTable) return false;
  const event = {
    event_key: `${safeSourceTable}:${safeEventType}:${Utilities.getUuid()}`,
    event_type: safeEventType,
    area: safeArea,
    source_table: safeSourceTable,
    row_ids: Array.isArray(rowIds) ? rowIds.map(function(value) { return String(value || '').trim(); }).filter(Boolean).slice(0, 80) : [],
    payload: payload || {},
    actor_username: 'apps_script',
    actor_display: 'Google Apps Script',
    client_id: 'apps-script-sync',
    created_at: new Date().toISOString()
  };
  try {
    const response = UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/${APP_LIVE_EVENTS_TABLE}`, {
      method: 'post',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      payload: JSON.stringify(event),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) return true;
    console.warn(`[LIVE EVENT] ${safeSourceTable} event skipped (${code}): ${response.getContentText()}`);
  } catch (err) {
    console.warn(`[LIVE EVENT] ${safeSourceTable} event failed: ${err && err.message ? err.message : err}`);
  }
  return false;
}

function emitTableSyncLiveEvent_(tableName, summary) {
  const safeTable = String(tableName || '').trim();
  const area = getAppLiveEventAreaForTable_(safeTable);
  if (!area) return false;
  const safeSummary = summary || {};
  return emitAppLiveEvent_(area, `${area}:sync`, safeTable, [], {
    method: 'SYNC',
    table: safeTable,
    filesProcessed: Number(safeSummary.filesProcessed || 0),
    upsertCount: Number(safeSummary.upsertCount || 0),
    deleteCount: Number(safeSummary.deleteCount || 0),
    totalRows: Number(safeSummary.totalRows || 0),
    runId: String(safeSummary.runId || ''),
    coalesced: true
  });
}

function emitManualSyncLiveEvent_(status) {
  const safeStatus = status || {};
  return emitAppLiveEvent_('inventory', 'manual_sync:complete', 'manual_sync', [], {
    method: 'SYNC',
    table: 'manual_sync',
    runId: String(safeStatus.runId || ''),
    completedStages: Array.isArray(safeStatus.completedStages) ? safeStatus.completedStages : [],
    stageResults: Array.isArray(safeStatus.stageResults) ? safeStatus.stageResults : [],
    message: String(safeStatus.message || 'Manual sync complete.'),
    finishedAt: String(safeStatus.finishedAt || new Date().toISOString())
  });
}

const MANUAL_SYNC_STAGE_DEFINITIONS = Object.freeze({
  drive: { label: 'Drive Around', run: runDriveAroundOnly },
  soc: { label: 'SOC', run: runSOCOnly },
  reserves: { label: 'Reserves', run: runReservesOnly },
  cav: { label: 'CAV', run: runCavOnly }
});

function runDriveSocReservesSequence() {
  const requestedBy = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'Apps Script Editor';
  return queueManualSyncRequest_({
    job: 'all',
    source: 'editor',
    requestedBy: requestedBy
  });
}

function showManualSyncStatus() {
  const status = getManualSyncStatusForClient_();
  if (!status) {
    console.log('[MANUAL SYNC] No manual sync is queued or running.');
    return null;
  }
  console.log(`[MANUAL SYNC][${status.runId || 'unknown'}] ${status.message || 'No status message recorded.'}`);
  console.log(JSON.stringify(status, null, 2));
  return status;
}

function clearManualSyncStatus() {
  PropertiesService.getScriptProperties().deleteProperty(MANUAL_SYNC_STATUS_KEY);
  removeManualSyncStageTriggers_();
  console.log('[MANUAL SYNC] Stored status cleared.');
}

function resetAndRunFullManualSync() {
  clearManualSyncStatus();
  return runDriveSocReservesSequence();
}

function loadManualSyncStatus_() {
  const raw = PropertiesService.getScriptProperties().getProperty(MANUAL_SYNC_STATUS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[MANUAL SYNC] Could not parse stored status: ${err.message}`);
    return null;
  }
}

function saveManualSyncStatus_(status) {
  PropertiesService.getScriptProperties().setProperty(MANUAL_SYNC_STATUS_KEY, JSON.stringify(status || {}));
}

function parseManualSyncTimestampMs_(value) {
  const ms = value ? new Date(value).getTime() : 0;
  return isNaN(ms) ? 0 : ms;
}

function isManualSyncStatusStale_(status, nowMs) {
  if (!status || !status.active) return false;
  const now = Number(nowMs) || Date.now();
  const currentStage = String(status.currentStage || status.current_stage || '').trim().toLowerCase();
  const startedAtMs = parseManualSyncTimestampMs_(status.startedAt || status.started_at || status.updatedAt || status.updated_at);
  const updatedAtMs = parseManualSyncTimestampMs_(status.updatedAt || status.updated_at || status.startedAt || status.started_at);
  if (currentStage === 'queued') return startedAtMs > 0 && (now - startedAtMs) > MANUAL_SYNC_QUEUED_STALE_MS;
  return updatedAtMs > 0 && (now - updatedAtMs) > MANUAL_SYNC_ACTIVE_STALE_MS;
}

function markManualSyncStatusStale_(status, reason) {
  const next = status && typeof status === 'object' ? status : {};
  const staleStageLabel = String(next.currentStageLabel || next.currentStage || 'manual sync');
  const nowIso = new Date().toISOString();
  next.active = false;
  next.currentStage = 'stale_failed';
  next.currentStageLabel = 'Timed Out';
  next.updatedAt = nowIso;
  next.finishedAt = nowIso;
  next.error = String(reason || 'Manual sync timed out before Apps Script reported completion.');
  next.message = `Manual sync timed out during ${staleStageLabel}. ${next.error} It is safe to press Run Script again.`;
  saveManualSyncStatus_(next);
  removeManualSyncStageTriggers_();
  return next;
}

function getManualSyncStatusForClient_() {
  const status = loadManualSyncStatus_();
  if (!status) return null;
  if (isManualSyncStatusStale_(status)) {
    const stageLabel = String(status.currentStageLabel || status.currentStage || 'manual sync');
    return markManualSyncStatusStale_(status, `${stageLabel} did not update before the safety timeout.`);
  }
  return status;
}

function removeManualSyncStageTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === MANUAL_SYNC_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function scheduleManualSyncStageTrigger_() {
  removeManualSyncStageTriggers_();
  ScriptApp.newTrigger(MANUAL_SYNC_TRIGGER_HANDLER)
    .timeBased()
    .after(1000)
    .create();
}

function getManualSyncStageOrder_(jobName) {
  const normalized = String(jobName || '').trim().toLowerCase();
  if (normalized === 'all' || normalized === 'drive_soc_reserves') return MANUAL_SYNC_STAGE_ORDER_DEFAULT.slice();
  if (normalized === 'drive') return ['drive'];
  if (normalized === 'soc') return ['soc'];
  if (normalized === 'reserves') return ['reserves'];
  if (normalized === 'cav') return ['cav'];
  return MANUAL_SYNC_STAGE_ORDER_DEFAULT.slice();
}

function normalizeManualSyncFailedFileEntries_(stageResult) {
  const safeResult = stageResult || {};
  const names = Array.isArray(safeResult.failedFileNames) ? safeResult.failedFileNames : [];
  const errors = Array.isArray(safeResult.failedFileErrors) ? safeResult.failedFileErrors : [];
  if (errors.length) {
    return errors.map(function(entry, index) {
      return {
        name: String(entry && entry.name || names[index] || '').trim(),
        error: String(entry && entry.error || safeResult.error || '').trim()
      };
    }).filter(function(entry) { return entry.name || entry.error; });
  }
  return names.map(function(name) {
    return { name: String(name || '').trim(), error: String(safeResult.error || '').trim() };
  }).filter(function(entry) { return entry.name || entry.error; });
}

function buildManualSyncStageFailureMessage_(stageDef, stageResult) {
  const safeResult = stageResult || {};
  const label = String(stageDef && stageDef.label || safeResult.tableName || 'manual sync stage').trim();
  const failedFiles = Number(safeResult.failedFiles || 0);
  const failedEntries = normalizeManualSyncFailedFileEntries_(safeResult);
  const fileNames = failedEntries.map(function(entry) { return entry.name; }).filter(Boolean);
  const firstError = String(
    (failedEntries[0] && failedEntries[0].error) ||
    safeResult.error ||
    'The file was left in the drop folder for retry.'
  ).trim();
  const fileText = fileNames.length
    ? fileNames.slice(0, 4).join(', ') + (fileNames.length > 4 ? `, +${fileNames.length - 4} more` : '')
    : `${failedFiles || 1} file${failedFiles === 1 ? '' : 's'}`;
  return `${label} failed for ${fileText}. ${firstError}`;
}

function queueManualSyncRequest_(options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let existing = loadManualSyncStatus_();
    if (existing && existing.active && isManualSyncStatusStale_(existing)) {
      const staleStageLabel = String(existing.currentStageLabel || existing.currentStage || 'manual sync');
      existing = markManualSyncStatusStale_(existing, `${staleStageLabel} did not update before the safety timeout.`);
    }
    if (existing && existing.active) {
      console.warn(`[MANUAL SYNC][${existing.runId || 'active'}] A manual sync is already running.`);
      return {
        status: 'busy',
        runId: existing.runId || '',
        currentStage: existing.currentStage || '',
        currentStageLabel: existing.currentStageLabel || '',
        stageOrder: Array.isArray(existing.stageOrder) ? existing.stageOrder : [],
        stageIndex: Number(existing.stageIndex || 0),
        message: existing.message || 'A manual sync is already running.'
      };
    }

    const stageOrder = getManualSyncStageOrder_(options && options.job);
    const stageLabels = stageOrder.map(function(stageKey) {
      const stageDef = MANUAL_SYNC_STAGE_DEFINITIONS[stageKey];
      return stageDef ? stageDef.label : stageKey;
    });
    const timestamp = new Date().toISOString();
    const runId = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const status = {
      active: true,
      runId: runId,
      job: String(options && options.job || 'all'),
      source: String(options && options.source || 'manual_run'),
      requestedBy: String(options && options.requestedBy || 'Unknown'),
      stageOrder: stageOrder,
      stageIndex: 0,
      currentStage: 'queued',
      currentStageLabel: 'Queued',
      completedStages: [],
      stageResults: [],
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: '',
      message: `Queued ${stageLabels.join(' -> ')} sync.`,
      error: ''
    };

    saveManualSyncStatus_(status);
    const deferStart = !(options && options.deferStart === false);
    if (deferStart) {
      try {
        scheduleManualSyncStageTrigger_();
      } catch (triggerError) {
        status.active = false;
        status.currentStage = 'trigger_failed';
        status.currentStageLabel = 'Trigger Failed';
        status.updatedAt = new Date().toISOString();
        status.finishedAt = status.updatedAt;
        status.error = triggerError && triggerError.message ? triggerError.message : String(triggerError);
        status.message = `Could not start the manual sync trigger: ${status.error}`;
        saveManualSyncStatus_(status);
        removeManualSyncStageTriggers_();
        throw triggerError;
      }
    }
    console.log(`[MANUAL SYNC][${runId}] Queued ${stageLabels.join(' -> ')} from ${status.source} by ${status.requestedBy}.`);
    return {
      status: 'queued',
      runId: runId,
      stageOrder: stageOrder,
      message: status.message
    };
  } finally {
    lock.releaseLock();
  }
}

function runQueuedManualSyncStage_(options) {
  const runOptions = options || {};
  const executionBudgetMs = Math.max(60000, Number(runOptions.executionBudgetMs) || MANUAL_SYNC_EXECUTION_BUDGET_MS);
  const nextStageStartCutoffMs = Math.max(1000, Number(runOptions.nextStageStartCutoffMs) || MANUAL_SYNC_NEXT_STAGE_START_CUTOFF_MS);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let status = null;
  const invocationStartedAt = Date.now();
  try {
    status = loadManualSyncStatus_();
    if (!status || !status.active) {
      removeManualSyncStageTriggers_();
      console.log('[MANUAL SYNC] No queued manual sync found.');
      return;
    }
    if (isManualSyncStatusStale_(status)) {
      const staleStageLabel = String(status.currentStageLabel || status.currentStage || 'manual sync');
      markManualSyncStatusStale_(status, `${staleStageLabel} did not update before the safety timeout.`);
      console.warn(`[MANUAL SYNC][${status.runId || 'unknown'}] Stale manual sync stopped before running another stage.`);
      return;
    }

    const stageOrder = Array.isArray(status.stageOrder) && status.stageOrder.length
      ? status.stageOrder
      : MANUAL_SYNC_STAGE_ORDER_DEFAULT.slice();
    const stageIndex = Number(status.stageIndex || 0);

    if (stageIndex >= stageOrder.length) {
      status.active = false;
      status.currentStage = 'complete';
      status.currentStageLabel = 'Complete';
      status.updatedAt = new Date().toISOString();
      status.finishedAt = status.updatedAt;
      status.message = 'Manual sync already completed.';
      saveManualSyncStatus_(status);
      removeManualSyncStageTriggers_();
      console.log(`[MANUAL SYNC][${status.runId || 'unknown'}] ${status.message}`);
      return;
    }

    while (status.stageIndex < stageOrder.length) {
      const currentStageIndex = Number(status.stageIndex || 0);
      const stageKey = stageOrder[currentStageIndex];
      const stageDef = MANUAL_SYNC_STAGE_DEFINITIONS[stageKey];
      if (!stageDef || typeof stageDef.run !== 'function') {
        throw new Error(`Unknown manual sync stage: ${stageKey}`);
      }

      status.currentStage = stageKey;
      status.currentStageLabel = stageDef.label;
      status.updatedAt = new Date().toISOString();
      status.message = `Starting ${stageDef.label} (${currentStageIndex + 1}/${stageOrder.length})...`;
      saveManualSyncStatus_(status);
      console.log(`[MANUAL SYNC][${status.runId}] ${status.message}`);

      const stageResult = stageDef.run() || {};
      const filesProcessed = Number(stageResult.filesProcessed || 0);
      const tempFilesRemoved = Number(stageResult.tempFilesRemoved || 0);
      const failedFiles = Number(stageResult.failedFiles || 0);
      const failedFileNames = Array.isArray(stageResult.failedFileNames) ? stageResult.failedFileNames : [];
      const failedFileErrors = normalizeManualSyncFailedFileEntries_(stageResult);
      const completedAt = new Date().toISOString();

      if (!Array.isArray(status.completedStages)) status.completedStages = [];
      if (!Array.isArray(status.stageResults)) status.stageResults = [];
      status.stageResults.push({
        key: stageKey,
        label: stageDef.label,
        filesProcessed: filesProcessed,
        tempFilesRemoved: tempFilesRemoved,
        failedFiles: failedFiles,
        failedFileNames: failedFileNames,
        failedFileErrors: failedFileErrors,
        error: String(stageResult.error || '').trim(),
        completedAt: completedAt
      });

      if (failedFiles > 0 || failedFileErrors.length || stageResult.error) {
        status.updatedAt = completedAt;
        status.error = buildManualSyncStageFailureMessage_(stageDef, stageResult);
        status.message = `Failed during ${stageDef.label}: ${status.error}`;
        saveManualSyncStatus_(status);
        throw new Error(status.error);
      }

      status.completedStages.push(stageKey);

      status.stageIndex = currentStageIndex + 1;
      const hasMoreStages = status.stageIndex < stageOrder.length;
      const nextStageKey = hasMoreStages ? stageOrder[status.stageIndex] : '';
      const nextStageDef = nextStageKey ? MANUAL_SYNC_STAGE_DEFINITIONS[nextStageKey] : null;
      const fileSummary = filesProcessed > 0
        ? `${filesProcessed} file${filesProcessed === 1 ? '' : 's'} processed`
        : 'no files found';
      const tempSummary = tempFilesRemoved > 0
        ? `, ${tempFilesRemoved} temp file${tempFilesRemoved === 1 ? '' : 's'} cleared`
        : '';

      status.updatedAt = completedAt;
      if (!hasMoreStages) {
        status.active = false;
        status.currentStage = 'complete';
        status.currentStageLabel = 'Complete';
        status.finishedAt = completedAt;
        status.message = `Finished ${stageDef.label}: ${fileSummary}${tempSummary}. Manual sync complete.`;
        saveManualSyncStatus_(status);
        emitManualSyncLiveEvent_(status);
        removeManualSyncStageTriggers_();
        console.log(`[MANUAL SYNC][${status.runId}] ${status.message}`);
        break;
      }

      const elapsedMs = Date.now() - invocationStartedAt;
      const shouldContinueInline = elapsedMs < nextStageStartCutoffMs && elapsedMs < executionBudgetMs;
      status.message = shouldContinueInline
        ? `Finished ${stageDef.label}: ${fileSummary}${tempSummary}. Continuing to ${nextStageDef ? nextStageDef.label : nextStageKey}...`
        : `Finished ${stageDef.label}: ${fileSummary}${tempSummary}. Queueing ${nextStageDef ? nextStageDef.label : nextStageKey}...`;
      saveManualSyncStatus_(status);
      console.log(`[MANUAL SYNC][${status.runId}] ${status.message}`);

      if (!shouldContinueInline) {
        scheduleManualSyncStageTrigger_();
        break;
      }
    }
  } catch (err) {
    if (status) {
      status.active = false;
      status.updatedAt = new Date().toISOString();
      status.finishedAt = status.updatedAt;
      status.error = err && err.message ? err.message : String(err);
      const stageLabel = status.currentStageLabel || status.currentStage || 'manual sync';
      status.message = `Failed during ${stageLabel}: ${status.error}`;
      saveManualSyncStatus_(status);
    }
    removeManualSyncStageTriggers_();
    console.error(`[MANUAL SYNC][${status && status.runId ? status.runId : 'unknown'}] ${err && err.stack ? err.stack : err}`);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// =========================================================================
// HIGH-PERFORMANCE DELTA SYNC ENGINE
// =========================================================================

function executeFetchAllBatches(requests, batchSize) {
  const safeBatchSize = Math.max(1, Number(batchSize) || 1);
  let responses = [];
  for (let i = 0; i < requests.length; i += safeBatchSize) {
    let batch = requests.slice(i, i + safeBatchSize);
    let batchResponses;
    try {
      batchResponses = UrlFetchApp.fetchAll(batch);
    } catch (err) {
      const message = String(err && err.message ? err.message : err || '').toLowerCase();
      const shouldFallbackSerial = safeBatchSize > 1 && (
        message.includes('bandwidth quota exceeded') ||
        message.includes('service invoked too many times') ||
        message.includes('rate limit') ||
        message.includes('try reducing the rate of data transfer')
      );
      if (!shouldFallbackSerial) throw err;
      batchResponses = batch.map(function(request, requestIndex) {
        return withRetry_(
          `Supabase fetch batch ${i + requestIndex + 1}`,
          SUPABASE_FETCH_RETRY_COUNT,
          SUPABASE_FETCH_RETRY_DELAY_MS,
          function() {
            return UrlFetchApp.fetch(request.url, request);
          },
          function(fetchError) {
            const fetchMessage = String(fetchError && fetchError.message ? fetchError.message : fetchError || '').toLowerCase();
            return fetchMessage.includes('bandwidth quota exceeded') ||
              fetchMessage.includes('service invoked too many times') ||
              fetchMessage.includes('rate limit') ||
              fetchMessage.includes('try reducing the rate of data transfer') ||
              fetchMessage.includes('internal error') ||
              fetchMessage.includes('backend error');
          }
        );
      });
      Utilities.sleep(Math.max(250, SUPABASE_FETCH_RETRY_DELAY_MS));
    }
    responses = responses.concat(batchResponses);
  }
  return responses;
}

function shouldRetryDriveOperation_(err) {
  const message = String(err && err.message ? err.message : err || '').toLowerCase();
  return message.includes('service error: drive') ||
    message.includes('empty response') ||
    message.includes('rate limit') ||
    message.includes('internal error') ||
    message.includes('backend error') ||
    message.includes('try again later');
}

function withRetry_(label, retryCount, baseDelayMs, action, shouldRetry) {
  const totalAttempts = Math.max(1, Number(retryCount) || 1);
  const delayMs = Math.max(0, Number(baseDelayMs) || 0);
  let lastError = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return action();
    } catch (err) {
      lastError = err;
      const canRetry = attempt < totalAttempts && (!shouldRetry || shouldRetry(err));
      if (!canRetry) break;
      Utilities.sleep(delayMs * attempt);
    }
  }
  throw lastError || new Error(`${label} failed.`);
}

function withDriveRetry_(label, action) {
  return withRetry_(label, DRIVE_OPERATION_RETRY_COUNT, DRIVE_OPERATION_RETRY_DELAY_MS, action, shouldRetryDriveOperation_);
}

function shouldRetrySupabaseRead_(err) {
  const message = String(err && err.message ? err.message : err || '').toLowerCase();
  return message.includes('bandwidth quota exceeded') ||
    message.includes('service invoked too many times') ||
    message.includes('rate limit') ||
    message.includes('try reducing the rate of data transfer') ||
    message.includes('empty response') ||
    message.includes('internal error') ||
    message.includes('backend error') ||
    message.includes('try again later') ||
    message.includes('timed out');
}

function isMasterInventoryTable_(tableName) {
  return String(tableName || '').trim() === 'v2_master_inventory';
}

function getDriveFolderByIdWithRetry_(folderId, label) {
  try {
    return withDriveRetry_(`Drive folder lookup: ${label}`, function() {
      return DriveApp.getFolderById(folderId);
    });
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    throw new Error(`Drive folder lookup failed for ${label} (${folderId}): ${errorMessage}`);
  }
}

function listDriveFilesWithRetry_(folder, label) {
  return withDriveRetry_(`Drive folder listing: ${label}`, function() {
    return folder.getFiles();
  });
}

function trashDriveFileWithRetry_(file, label) {
  return withDriveRetry_(`Trash file: ${label}`, function() {
    return file.setTrashed(true);
  });
}

function moveDriveFileToFolderWithRetry_(file, folder, label) {
  return withDriveRetry_(`Move file: ${label}`, function() {
    return file.moveTo(folder);
  });
}

function getSupabaseFetchOptionsForTable_(tableName) {
  if (tableName === 'v2_master_inventory') {
    return {
      pageSize: SUPABASE_MASTER_FETCH_PAGE_SIZE,
      batchSize: SUPABASE_MASTER_FETCH_BATCH_SIZE,
      interBatchDelayMs: SUPABASE_MASTER_FETCH_BATCH_DELAY_MS
    };
  }
  return {};
}

function normalizeSupabaseSelectColumns_(selectColumns) {
  const columns = Array.isArray(selectColumns)
    ? selectColumns
    : String(selectColumns || '').split(',');
  const seen = {};
  const normalized = [];
  columns.forEach(function(column) {
    const safeColumn = String(column || '').trim();
    if (!safeColumn || seen[safeColumn]) return;
    seen[safeColumn] = true;
    normalized.push(safeColumn);
  });
  if (!normalized.length) normalized.push('unique_id');
  return normalized.join(',');
}

function buildExistingRowMap_(existingRows) {
  const map = {};
  if (Array.isArray(existingRows)) {
    existingRows.forEach(function(row) {
      const uid = String(row && row.unique_id || '').trim();
      if (uid) map[uid] = row;
    });
    return map;
  }
  if (existingRows && typeof existingRows === 'object') {
    Object.keys(existingRows).forEach(function(key) {
      const row = existingRows[key];
      const uid = String(row && row.unique_id || key || '').trim();
      if (uid) map[uid] = row;
    });
  }
  return map;
}

function createDeltaSyncStats_() {
  return {
    sourceRows: 0,
    validIdentityRows: 0,
    fallbackIdentityRows: 0,
    unchangedRows: 0,
    changedRows: 0,
    insertedRows: 0,
    deletedRows: 0,
    skippedRows: 0,
    archivedOlderFiles: 0
  };
}

function mergeDeltaSyncStats_(target, source) {
  const nextTarget = target || createDeltaSyncStats_();
  const nextSource = source || {};
  Object.keys(createDeltaSyncStats_()).forEach(function(key) {
    nextTarget[key] = (Number(nextTarget[key]) || 0) + (Number(nextSource[key]) || 0);
  });
  return nextTarget;
}

function formatDeltaSyncStats_(tableName, stats, extras) {
  const safeStats = stats || createDeltaSyncStats_();
  const safeExtras = extras || {};
  const parts = [
    `[SYNC][${tableName}]`,
    `source=${Number(safeStats.sourceRows) || 0}`,
    `valid=${Number(safeStats.validIdentityRows) || 0}`,
    `unchanged=${Number(safeStats.unchangedRows) || 0}`,
    `changed=${Number(safeStats.changedRows) || 0}`,
    `inserted=${Number(safeStats.insertedRows) || 0}`,
    `deleted=${Number(safeStats.deletedRows) || 0}`,
    `skipped=${Number(safeStats.skippedRows) || 0}`,
    `fallbackIds=${Number(safeStats.fallbackIdentityRows) || 0}`
  ];
  if (safeExtras.filesProcessed != null) parts.push(`files=${safeExtras.filesProcessed}`);
  if (safeExtras.archivedOlderFiles != null) parts.push(`archivedOlder=${safeExtras.archivedOlderFiles}`);
  if (safeExtras.upserts != null) parts.push(`upserts=${safeExtras.upserts}`);
  return parts.join(' | ');
}

function normalizePayloadColumnKey_(header) {
  let key = String(header || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (key === 'genus_name' || key === 'genus') key = 'genusname';
  if (key === 'suspendto') key = 'suspend_to';
  if (key === 'salesnote_begindate' || key === 'salesnote_begin_date') key = 'salesnotebegindate';
  if (key === 'holdstopbegin_date' || key === 'holdstop_begin_date') key = 'holdstopbegindate';
  if (key === 'holdstopend_date' || key === 'holdstop_end_date') key = 'holdstopenddate';
  if (key === 'location_note') key = 'locationnote';
  if (key === 'location_note_date') key = 'locationnotedate';
  return key;
}

function collectAllowedPayloadColumnsFromHeaders_(rawHeaders, fixedColumns) {
  const seen = {};
  const columns = [];
  (fixedColumns || []).forEach(function(column) {
    const safeColumn = String(column || '').trim();
    if (!safeColumn || seen[safeColumn]) return;
    seen[safeColumn] = true;
    columns.push(safeColumn);
  });
  (rawHeaders || []).forEach(function(header) {
    const key = normalizePayloadColumnKey_(header);
    if (!ALLOWED_DB_COLUMNS.has(key) || seen[key]) return;
    seen[key] = true;
    columns.push(key);
  });
  return columns;
}

function tableStoresSyncHash_(tableName) {
  return tableName === 'v2_master_inventory';
}

function getStandardPayloadSelectColumns_(rawData) {
  const rawHeaders = Array.isArray(rawData) && Array.isArray(rawData[0]) ? rawData[0] : [];
  return collectAllowedPayloadColumnsFromHeaders_(rawHeaders, ['unique_id', 'contsize']);
}

function getMasterPayloadSelectColumns_(rawData) {
  return ['unique_id', 'assignedto', 'concat'];
}

function getCavPayloadSelectColumns_() {
  return [
    'unique_id'
  ];
}

function getPayloadSelectColumns_(tableName, rawData) {
  if (tableName === 'v2_master_inventory') return getMasterPayloadSelectColumns_(rawData);
  if (tableName === 'v2_cav_import') return getCavPayloadSelectColumns_();
  return getStandardPayloadSelectColumns_(rawData);
}

function getMasterPayloadContext_(rawData) {
  const rawHeaders = Array.isArray(rawData) && Array.isArray(rawData[0])
    ? rawData[0].map(function(header) { return String(header).trim(); })
    : [];
  const cleanHeaders = rawHeaders.map(function(header) {
    return String(header).toUpperCase().replace(/\s+/g, '').replace(/_/g, '');
  });
  const getIdx = function(name) {
    return cleanHeaders.indexOf(String(name).toUpperCase().replace(/\s+/g, '').replace(/_/g, ''));
  };
  let contSizeIdx = getIdx('CONTSIZE');
  if (contSizeIdx === -1) contSizeIdx = getIdx('PRINTEDCONTAINERCODE');
  return {
    rawHeaders: rawHeaders,
    indices: {
      itemCode: getIdx('ITEMCODE'),
      locationCode: getIdx('LOCATIONCODE'),
      lotCode: getIdx('LOTCODE'),
      commonName: getIdx('COMMONNAME'),
      contSize: contSizeIdx,
      source: getIdx('SOURCE'),
      desigItem: getIdx('DESIGITEM'),
      desigCust: getIdx('DESIGCUST'),
      desigLoc: getIdx('DESIGLOC'),
      priority: getIdx('PRIORITY')
    }
  };
}

function getMasterRowIdentity_(row, context, idTracker) {
  const indices = context && context.indices ? context.indices : {};
  const itemCodeStr = indices.itemCode > -1 ? String(row[indices.itemCode] || '').trim() : '';
  const locationCode = indices.locationCode > -1 ? String(row[indices.locationCode] || '').trim() : '';
  const commonName = indices.commonName > -1 ? String(row[indices.commonName] || '').trim() : '';
  const contSize = indices.contSize > -1 ? String(row[indices.contSize] || '').trim() : '-';
  const lotCode = indices.lotCode > -1 ? String(row[indices.lotCode] || '').trim() : '';

  if (!itemCodeStr || itemCodeStr.toUpperCase() === 'NULL' || !locationCode || !commonName) {
    return { valid: false, uniqueId: '', contSize: contSize };
  }

  const sourceStr = indices.source > -1 ? String(row[indices.source] || '').trim() : '';
  const desigItemStr = indices.desigItem > -1 ? String(row[indices.desigItem] || '').trim() : '';
  const desigCustStr = indices.desigCust > -1 ? String(row[indices.desigCust] || '').trim() : '';
  const desigLocStr = indices.desigLoc > -1 ? String(row[indices.desigLoc] || '').trim() : '';
  const priorityStr = indices.priority > -1 ? String(row[indices.priority] || '').trim() : '';

  const baseId = `${itemCodeStr}-${contSize}-${locationCode}-${lotCode}-${sourceStr}-${desigItemStr}-${desigCustStr}-${desigLocStr}-${priorityStr}`
    .replace(/[^a-zA-Z0-9-]/g, '_');

  if (idTracker[baseId] === undefined) idTracker[baseId] = 0;
  else idTracker[baseId]++;

  let uniqueId = baseId;
  if (idTracker[baseId] > 0) uniqueId += '-' + idTracker[baseId];

  return {
    valid: Boolean(uniqueId),
    uniqueId: uniqueId,
    contSize: contSize
  };
}

function previewMasterSnapshotFile_(rawData) {
  const context = getMasterPayloadContext_(rawData);
  const idTracker = {};
  const seenIds = new Set();
  const stats = createDeltaSyncStats_();
  const sourceRowCount = Math.max(0, (rawData && rawData.length ? rawData.length : 1) - 1);
  let totalRows = 0;

  stats.sourceRows = sourceRowCount;

  for (let i = 1; i < (rawData || []).length; i++) {
    const identity = getMasterRowIdentity_(rawData[i], context, idTracker);
    if (!identity.valid) {
      stats.skippedRows++;
      continue;
    }
    totalRows++;
    stats.validIdentityRows++;
    seenIds.add(identity.uniqueId);
  }

  return {
    seenIds: seenIds,
    totalRows: totalRows,
    stats: stats,
    context: context
  };
}

function combineSnapshotDeleteIds_(existingRows, seenIds) {
  const existingMap = buildExistingRowMap_(existingRows);
  const safeSeenIds = seenIds instanceof Set ? seenIds : new Set();
  return Object.keys(existingMap).filter(function(uid) {
    return uid && !safeSeenIds.has(uid);
  });
}

function shouldAbortSnapshotDelete_(stats, totalRows) {
  const safeStats = stats || {};
  const sourceRows = Math.max(Number(safeStats.sourceRows) || 0, Number(totalRows) || 0);
  const validIdentityRows = Number(safeStats.validIdentityRows) || 0;
  return sourceRows > 0 && validIdentityRows <= 0;
}

function fetchAllSupabaseData(tableName, selectColumns, options) {
  const safeSelect = normalizeSupabaseSelectColumns_(selectColumns);
  const fetchOptions = options || {};
  const limit = Math.max(1, Number(fetchOptions.pageSize) || SUPABASE_FETCH_PAGE_SIZE);
  const batchSize = Math.max(1, Number(fetchOptions.batchSize) || SUPABASE_PAGED_READ_FETCH_BATCH_SIZE);
  const interBatchDelayMs = Math.max(0, Number(fetchOptions.interBatchDelayMs) || 0);
  let countUrl = `${SUPABASE_URL}/rest/v1/${tableName}?select=unique_id&limit=1`;
  let countRes = UrlFetchApp.fetch(countUrl, {
    method: 'get',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'count=exact' },
    muteHttpExceptions: true
  });
  
  let allData = {};
  let totalRecords = 0;
  let rangeHeader = countRes.getHeaders()['Content-Range'];
  if (rangeHeader) {
      let match = rangeHeader.match(/\/(\d+)/);
      if (match) totalRecords = parseInt(match[1], 10);
  }

  if (totalRecords > 0) {
    let requests = [];
    for (let offset = 0; offset < totalRecords; offset += limit) {
       requests.push({
         url: `${SUPABASE_URL}/rest/v1/${tableName}?select=${safeSelect}&limit=${limit}&offset=${offset}`,
         method: 'get',
         headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
         muteHttpExceptions: true
       });
    }
    
    let responses = [];
    for (let i = 0; i < requests.length; i += batchSize) {
      let batch = requests.slice(i, i + batchSize);
      let batchResponses = executeFetchAllBatches(batch, batch.length);
      responses = responses.concat(batchResponses);
      if (interBatchDelayMs > 0 && i + batchSize < requests.length) Utilities.sleep(interBatchDelayMs);
    }
    responses.forEach(res => {
        if (res.getResponseCode() !== 200) {
            throw new Error(`Supabase fetch failed for ${tableName} (${res.getResponseCode()}): ${res.getContentText()}`);
        }
        let data = JSON.parse(res.getContentText());
        data.forEach(row => { allData[row.unique_id] = row; });
    });
  }
  return allData;
}


function fetchSupabaseRowsForFile(tableName, fileName, selectColumns) {
  const limit = SUPABASE_FETCH_PAGE_SIZE;
  let rows = [];
  let offset = 0;
  const encodedFileName = encodeURIComponent(fileName);
  const safeSelect = normalizeSupabaseSelectColumns_(selectColumns);

  while (true) {
    let url = `${SUPABASE_URL}/rest/v1/${tableName}?select=${safeSelect}&filename=eq.${encodedFileName}&limit=${limit}&offset=${offset}`;
    let res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      throw new Error(`File-scoped lookup failed for ${tableName} (${res.getResponseCode()}): ${res.getContentText()}`);
    }

    let batch = JSON.parse(res.getContentText() || '[]');
    if (!Array.isArray(batch) || batch.length === 0) break;

    rows = rows.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return rows;
}

function fetchAllSupabaseRowIds(tableName) {
  const limit = 1000;
  let ids = [];
  let offset = 0;

  while (true) {
    let url = `${SUPABASE_URL}/rest/v1/${tableName}?select=unique_id&limit=${limit}&offset=${offset}`;
    let res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) {
      throw new Error(`Table-scoped id lookup failed for ${tableName} (${res.getResponseCode()}): ${res.getContentText()}`);
    }

    let batch = JSON.parse(res.getContentText() || '[]');
    if (!Array.isArray(batch) || batch.length === 0) break;

    ids = ids.concat(batch
      .map(function(row) { return String(row && row.unique_id || ''); })
      .filter(Boolean));

    if (batch.length < limit) break;
    offset += limit;
  }

  return ids;
}

function fetchAllSupabaseRowIdsForMaster_(tableName) {
  const limit = Math.max(1, Number(SUPABASE_MASTER_ID_FETCH_PAGE_SIZE) || 1);
  const interPageDelayMs = Math.max(0, Number(SUPABASE_MASTER_ID_FETCH_DELAY_MS) || 0);
  let ids = [];
  let offset = 0;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=unique_id&limit=${limit}&offset=${offset}`;
    const res = withRetry_(
      `Master ID lookup for ${tableName} at offset ${offset}`,
      SUPABASE_FETCH_RETRY_COUNT,
      SUPABASE_FETCH_RETRY_DELAY_MS,
      function() {
        return UrlFetchApp.fetch(url, {
          method: 'get',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
          muteHttpExceptions: true
        });
      },
      shouldRetrySupabaseRead_
    );

    if (res.getResponseCode() !== 200) {
      throw new Error(`Master ID lookup failed for ${tableName} (${res.getResponseCode()}): ${res.getContentText()}`);
    }

    const batch = JSON.parse(res.getContentText() || '[]');
    if (!Array.isArray(batch) || batch.length === 0) break;

    ids = ids.concat(batch
      .map(function(row) { return String(row && row.unique_id || '').trim(); })
      .filter(Boolean));

    if (batch.length < limit) break;
    offset += limit;
    if (interPageDelayMs > 0) Utilities.sleep(interPageDelayMs);
  }

  return ids;
}

function chunkSupabaseIdsForInFilter_(tableName, ids, selectColumns) {
  const safeSelect = normalizeSupabaseSelectColumns_(selectColumns);
  const prefix = `${SUPABASE_URL}/rest/v1/${tableName}?select=${safeSelect}&unique_id=in.(`;
  const suffix = ')';
  const safeIds = [];
  const seen = {};
  (ids || []).forEach(function(rawId) {
    const safeId = String(rawId || '').trim();
    if (!safeId || seen[safeId]) return;
    seen[safeId] = true;
    safeIds.push(encodeURIComponent(safeId));
  });

  const chunks = [];
  let currentChunk = [];
  let currentLength = prefix.length + suffix.length;

  safeIds.forEach(function(encodedId) {
    const separatorLength = currentChunk.length ? 1 : 0;
    const nextLength = currentLength + separatorLength + encodedId.length;
    if (currentChunk.length && nextLength > SUPABASE_DELETE_URL_MAX_LENGTH) {
      chunks.push(currentChunk);
      currentChunk = [encodedId];
      currentLength = prefix.length + suffix.length + encodedId.length;
      return;
    }
    currentChunk.push(encodedId);
    currentLength = nextLength;
  });

  if (currentChunk.length) chunks.push(currentChunk);

  return {
    prefix: prefix,
    suffix: suffix,
    chunks: chunks
  };
}

function fetchSupabaseRowsByIds_(tableName, ids, selectColumns, options) {
  const fetchOptions = options || {};
  const interChunkDelayMs = Math.max(0, Number(fetchOptions.interChunkDelayMs) || 0);
  const batchSize = Math.max(1, Number(fetchOptions.batchSize) || SUPABASE_BY_ID_FETCH_BATCH_SIZE);
  const chunkPlan = chunkSupabaseIdsForInFilter_(tableName, ids, selectColumns);
  let rows = [];

  const requests = chunkPlan.chunks.map(function(chunk) {
    return {
      url: `${chunkPlan.prefix}${chunk.join(',')}${chunkPlan.suffix}`,
      method: 'get',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
      muteHttpExceptions: true
    };
  });

  for (let index = 0; index < requests.length; index += batchSize) {
    const batch = requests.slice(index, index + batchSize);
    const responses = executeFetchAllBatches(batch, batch.length);
    responses.forEach(function(res, responseIndex) {
      if (res.getResponseCode() !== 200) {
        const chunkNumber = index + responseIndex + 1;
        throw new Error(`Supabase by-ID lookup failed for ${tableName} chunk ${chunkNumber} (${res.getResponseCode()}): ${res.getContentText()}`);
      }

      const responseRows = JSON.parse(res.getContentText() || '[]');
      if (Array.isArray(responseRows) && responseRows.length) rows = rows.concat(responseRows);
    });
    if (interChunkDelayMs > 0 && index + batchSize < requests.length) Utilities.sleep(interChunkDelayMs);
  }

  return rows;
}

function getSupabaseContentRangeCount(headers) {
  const safeHeaders = headers || {};
  const rangeHeader = safeHeaders['Content-Range'] || safeHeaders['content-range'] || '';
  const match = String(rangeHeader || '').match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

function fetchSupabaseRowCount(tableName) {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=unique_id&limit=1`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'count=exact'
    },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 206) {
    const errorText = res.getContentText();
    console.error(`Snapshot count lookup failed for ${tableName} (${code}): ${errorText}`);
    return { success: false, count: null, statusCode: code, error: errorText };
  }
  return {
    success: true,
    count: getSupabaseContentRangeCount(res.getHeaders()) || 0,
    statusCode: code,
    error: ''
  };
}

function clearSupabaseSnapshotTable(tableName) {
  const countResult = fetchSupabaseRowCount(tableName);
  if (!countResult.success) {
    return {
      success: false,
      deletedCount: 0,
      statusCode: countResult.statusCode,
      error: countResult.error || `Could not count rows for ${tableName}.`
    };
  }

  const existingCount = Number(countResult.count) || 0;
  if (existingCount <= 0) {
    return { success: true, deletedCount: 0, statusCode: 204, error: '' };
  }

  const url = `${SUPABASE_URL}/rest/v1/${tableName}?unique_id=not.is.null`;
  const res = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=minimal,count=exact'
    },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 204) {
    const errorText = res.getContentText();
    console.error(`Snapshot clear failed for ${tableName} (${code}): ${errorText}`);
    return {
      success: false,
      deletedCount: 0,
      statusCode: code,
      error: errorText || `Snapshot clear failed for ${tableName}.`
    };
  }

  const deletedCount = getSupabaseContentRangeCount(res.getHeaders());
  return {
    success: true,
    deletedCount: deletedCount == null ? existingCount : deletedCount,
    statusCode: code,
    error: ''
  };
}

function deleteFromSupabase(tableName, idsToDelete) {
  // ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ Dropped to 5 to protect against URL length limits with long SOC/Reserve IDs
  let requests = [];
  const prefix = `${SUPABASE_URL}/rest/v1/${tableName}?unique_id=in.(`;
  const suffix = ')';
  let currentChunk = [];
  let currentLength = prefix.length + suffix.length;
  (idsToDelete || []).forEach(function(rawId) {
    const encodedId = encodeURIComponent(String(rawId || ''));
    if (!encodedId) return;
    const separatorLength = currentChunk.length ? 1 : 0;
    const nextLength = currentLength + separatorLength + encodedId.length;
    if (currentChunk.length && nextLength > SUPABASE_DELETE_URL_MAX_LENGTH) {
      requests.push({
        url: `${prefix}${currentChunk.join(',')}${suffix}`,
        method: 'delete',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
        muteHttpExceptions: true
      });
      currentChunk = [encodedId];
      currentLength = prefix.length + suffix.length + encodedId.length;
      return;
    }
    currentChunk.push(encodedId);
    currentLength = nextLength;
  });
  if (currentChunk.length) {
    requests.push({
      url: `${prefix}${currentChunk.join(',')}${suffix}`,
      method: 'delete',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
      muteHttpExceptions: true
    });
  }
  if (requests.length > 0) executeFetchAllBatches(requests, SUPABASE_DELETE_FETCH_BATCH_SIZE);
}

function normalizeSupabaseUpsertChunk(rows) {
  let keySet = {};

  (rows || []).forEach(function(row) {
    Object.keys(row || {}).forEach(function(key) {
      keySet[key] = true;
    });
  });

  let keys = Object.keys(keySet);

  return (rows || []).map(function(row) {
    let normalized = {};
    keys.forEach(function(key) {
      let value = Object.prototype.hasOwnProperty.call(row || {}, key) ? row[key] : null;
      normalized[key] = value === undefined ? null : value;
    });
    return normalized;
  });
}

function pushToSupabaseLegacy_(tableName, payloadArray) {
  const chunkSize = 1000; 
  let requests = [];
  for (let i = 0; i < payloadArray.length; i += chunkSize) {
    const chunk = normalizeSupabaseUpsertChunk(payloadArray.slice(i, i + chunkSize));
    requests.push({
      url: `${SUPABASE_URL}/rest/v1/${tableName}`,
      method: 'post', 
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(chunk), 
      muteHttpExceptions: true
    });
  }
  if(requests.length > 0) {
    let responses = executeFetchAllBatches(requests, SUPABASE_UPSERT_FETCH_BATCH_SIZE); 
    responses.forEach(res => {
        let code = res.getResponseCode();
        if (code !== 200 && code !== 201 && code !== 204) {
            console.error(`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Supabase Insert Error (Code ${code}): ${res.getContentText()}`);
        }
    });
  }
}

// Override the legacy upsert helper so failed Supabase responses stop the sync immediately.
function buildSupabaseUpsertRequests_(tableName, payloadArray) {
  const chunkSize = 1000;
  let requests = [];
  for (let i = 0; i < payloadArray.length; i += chunkSize) {
    const chunk = normalizeSupabaseUpsertChunk(payloadArray.slice(i, i + chunkSize));
    requests.push({
      url: `${SUPABASE_URL}/rest/v1/${tableName}`,
      method: 'post',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
  }
  return requests;
}

function extractMissingSupabaseColumnNames_(body) {
  const text = String(body || '');
  const missing = {};
  const patterns = [
    /Could not find the ['"]([^'"]+)['"] column/gi,
    /column ['"]([^'"]+)['"] of relation/gi,
    /column ['"]([^'"]+)['"] does not exist/gi,
    /['"]column['"]\s*:\s*['"]([^'"]+)['"]/gi
  ];
  patterns.forEach(function(pattern) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const col = String(match[1] || '').trim().toLowerCase();
      if (col) missing[col] = true;
    }
  });
  return Object.keys(missing);
}

function removeSupabaseColumnsFromPayload_(payloadArray, columns) {
  const removeSet = {};
  (columns || []).forEach(function(column) {
    const safeColumn = String(column || '').trim().toLowerCase();
    if (safeColumn) removeSet[safeColumn] = true;
  });
  return (payloadArray || []).map(function(row) {
    const next = {};
    Object.keys(row || {}).forEach(function(key) {
      if (!removeSet[String(key || '').trim().toLowerCase()]) next[key] = row[key];
    });
    return next;
  });
}

function executeSupabaseUpsert_(tableName, payloadArray) {
  const requests = buildSupabaseUpsertRequests_(tableName, payloadArray);
  if (!requests.length) return [];
  let responses = executeFetchAllBatches(requests, SUPABASE_UPSERT_FETCH_BATCH_SIZE);
  let failures = [];
  responses.forEach(function(res) {
    let code = res.getResponseCode();
    if (code !== 200 && code !== 201 && code !== 204) {
      let body = res.getContentText();
      console.error(`[ERROR] Supabase upsert failed for ${tableName} (Code ${code}): ${body}`);
      failures.push({ code: code, body: body });
    }
  });
  return failures;
}

function pushToSupabase(tableName, payloadArray) {
  if (!payloadArray || !payloadArray.length) return;
  let nextPayload = payloadArray;
  let ignoredMissingColumns = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const failures = executeSupabaseUpsert_(tableName, nextPayload);
    if (!failures.length) {
      if (ignoredMissingColumns.length) {
        console.warn(`[WARN] Supabase import for ${tableName} ignored missing table columns: ${ignoredMissingColumns.join(', ')}`);
      }
      return;
    }
    const missingColumnMap = {};
    failures.forEach(function(failure) {
      extractMissingSupabaseColumnNames_(failure.body).forEach(function(column) {
        if (column && column !== 'unique_id') missingColumnMap[column] = true;
      });
    });
    const missingColumns = Object.keys(missingColumnMap).filter(function(column) {
      return ignoredMissingColumns.indexOf(column) === -1;
    });
    if (!missingColumns.length) {
      const firstFailure = failures[0];
      throw new Error(`Supabase upsert failed for ${tableName} (${firstFailure.code}): ${firstFailure.body}`);
    }
    ignoredMissingColumns = ignoredMissingColumns.concat(missingColumns);
    console.warn(`[WARN] Supabase schema is missing ${tableName} column(s): ${missingColumns.join(', ')}. Retrying import without those non-key fields.`);
    nextPayload = removeSupabaseColumnsFromPayload_(nextPayload, missingColumns);
  }
  try {
    const failures = executeSupabaseUpsert_(tableName, nextPayload);
    if (failures.length) {
      const firstFailure = failures[0];
      throw new Error(`Supabase upsert failed for ${tableName} (${firstFailure.code}): ${firstFailure.body}`);
    }
    if (ignoredMissingColumns.length) {
      console.warn(`[WARN] Supabase import for ${tableName} ignored missing table columns: ${ignoredMissingColumns.join(', ')}`);
    }
  } catch (error) {
    throw error;
  }
}

function throwSupabaseUpsertFailures_(tableName, failures) {
  if (failures && failures.length) {
    const firstFailure = failures[0];
    throw new Error(`Supabase upsert failed for ${tableName} (${firstFailure.code}): ${firstFailure.body}`);
  }
}

function processFolder(dropFolderId, processedFolderId, tableName, payloadBuilderFunc) {
  const dropFolder = getDriveFolderByIdWithRetry_(dropFolderId, `${tableName} drop folder`);
  const processedFolder = getDriveFolderByIdWithRetry_(processedFolderId, `${tableName} processed folder`);
  const files = listDriveFilesWithRetry_(dropFolder, `${tableName} drop folder`);
  let filesSeen = 0;
  let filesProcessed = 0;
  let tempFilesRemoved = 0;
  let failedFiles = [];

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    if (fileName.startsWith('TEMP_')) {
      tempFilesRemoved++;
      trashDriveFileWithRetry_(file, `${tableName} temp file ${fileName}`);
      continue;
    }

    filesSeen++;
    console.log(`[START] Processing: ${fileName} -> Table: ${tableName}`);

    try {
      const syncStartTime = new Date().toISOString();
      let rawData = extractDataFromFile(file, dropFolderId);

      if (rawData && rawData.length >= 1) {
        console.log(`[SYNC] Fetching current rows for ${fileName}...`);
        const existingRows = fetchSupabaseRowsForFile(
          tableName,
          fileName,
          tableName === 'v2_master_inventory' ? 'unique_id,assignedto' : 'unique_id'
        );

        let results = payloadBuilderFunc(rawData, tableName, existingRows, syncStartTime, fileName);
        let upserts = results.upserts;
        let seenIds = results.seenIds;
        let totalRows = results.totalRows;
        let deletes = existingRows
          .map(function(row) { return String(row.unique_id || ''); })
          .filter(function(id) { return id && !seenIds.has(id); });

        console.log(`Sync results: ${upserts.length} rows upserted | ${deletes.length} removed rows | ${totalRows} parsed rows`);

        if (upserts.length > 0) pushToSupabase(tableName, upserts);
        if (deletes.length > 0) deleteFromSupabase(tableName, deletes);
      } else {
        console.warn('[SKIP] 0 rows meeting criteria found.');
      }

      moveDriveFileToFolderWithRetry_(file, processedFolder, `${tableName} processed file ${fileName}`);
      filesProcessed++;
    } catch (err) {
      const errorMessage = err && err.message ? err.message : String(err);
      failedFiles.push({ name: fileName, error: errorMessage });
      console.error(`[ERROR] Failed processing ${fileName} for ${tableName}: ${err && err.stack ? err.stack : errorMessage}`);
      console.warn(`[LEAVE] Keeping ${fileName} in drop folder for retry/manual review.`);
    }
  }

  if (filesSeen === 0) {
    console.log(`[SKIP] No files found for ${tableName}.`);
  }

  console.log(
    `[DONE] ${tableName}: ${filesProcessed} file${filesProcessed === 1 ? '' : 's'} processed` +
    `${failedFiles.length ? ` | ${failedFiles.length} failed file${failedFiles.length === 1 ? '' : 's'} left in drop` : ''}` +
    `${tempFilesRemoved ? ` | ${tempFilesRemoved} temp file${tempFilesRemoved === 1 ? '' : 's'} cleared` : ''}.`
  );

  if (filesProcessed > 0) {
    emitTableSyncLiveEvent_(tableName, {
      filesProcessed: filesProcessed,
      tempFilesRemoved: tempFilesRemoved
    });
  }

  return {
    tableName: tableName,
    filesProcessed: filesProcessed,
    tempFilesRemoved: tempFilesRemoved,
    failedFiles: failedFiles.length,
    failedFileNames: failedFiles.map(function(entry) { return entry.name; }),
    failedFileErrors: failedFiles
  };
}

function processLatestFileOnlyFolder(dropFolderId, processedFolderId, tableName, payloadBuilderFunc, options) {
  const dropFolder = getDriveFolderByIdWithRetry_(dropFolderId, `${tableName} drop folder`);
  const processedFolder = getDriveFolderByIdWithRetry_(processedFolderId, `${tableName} processed folder`);
  const deltaMode = !!(options && options.deltaMode);
  const files = listDriveFilesWithRetry_(dropFolder, `${tableName} drop folder`);
  const pendingFiles = [];
  let tempFilesRemoved = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    if (fileName.startsWith('TEMP_')) {
      tempFilesRemoved++;
      trashDriveFileWithRetry_(file, `${tableName} temp file ${fileName}`);
      continue;
    }
    pendingFiles.push(file);
  }

  if (!pendingFiles.length) {
    console.log(`[SKIP] No files found for ${tableName}.`);
    return {
      tableName: tableName,
      filesProcessed: 0,
      tempFilesRemoved: tempFilesRemoved,
      skippedFilesArchived: 0,
      failedFiles: 0,
      failedFileNames: [],
      upsertCount: 0,
      deleteCount: 0,
      totalRows: 0,
      diagnostics: createDeltaSyncStats_()
    };
  }

  pendingFiles.sort(function(a, b) {
    const timeDiff = b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
    if (timeDiff !== 0) return timeDiff;
    return String(a.getName() || '').localeCompare(String(b.getName() || ''));
  });

  const newestFile = pendingFiles[0];
  const olderFiles = pendingFiles.slice(1);
  const newestFileName = newestFile.getName();
  let skippedFilesArchived = 0;
  let upsertCount = 0;
  let deleteCount = 0;
  let totalRows = 0;
  let syncDiagnostics = createDeltaSyncStats_();
  let failedFiles = [];
  let importSucceeded = false;

  console.log(
    `[START] Processing latest file only: ${newestFileName} -> Table: ${tableName}` +
    `${olderFiles.length ? ` | ${olderFiles.length} older pending file${olderFiles.length === 1 ? '' : 's'} will be archived` : ''}`
  );

  try {
    const syncStartTime = new Date().toISOString();
    const rawData = extractDataFromFile(newestFile, dropFolderId);
    if (!rawData || rawData.length < 1) {
      throw new Error(`No readable rows were found in ${newestFileName}.`);
    }
    const selectColumns = (options && typeof options.selectColumnsBuilder === 'function')
      ? options.selectColumnsBuilder(rawData, tableName)
      : getPayloadSelectColumns_(tableName, rawData);
    const existingRows = fetchAllSupabaseData(tableName, selectColumns, getSupabaseFetchOptionsForTable_(tableName));
    const results = payloadBuilderFunc(rawData, tableName, existingRows, syncStartTime, newestFileName);
    const upserts = Array.isArray(results && results.upserts) ? results.upserts : [];
    const seenIds = results && results.seenIds instanceof Set ? results.seenIds : new Set();
    totalRows = Number(results && results.totalRows) || 0;
    syncDiagnostics = results && results.stats ? results.stats : createDeltaSyncStats_();
    if (shouldAbortSnapshotDelete_(syncDiagnostics, totalRows)) {
      throw new Error(`0 valid snapshot identities were found in ${newestFileName}; skipped destructive sync for ${tableName}.`);
    }
    const deletes = deltaMode ? combineSnapshotDeleteIds_(existingRows, seenIds) : [];
    syncDiagnostics.deletedRows = deletes.length;
    upsertCount = upserts.length;
    deleteCount = deletes.length;
    console.log(formatDeltaSyncStats_(tableName, syncDiagnostics, {
      filesProcessed: 1,
      archivedOlderFiles: olderFiles.length,
      upserts: upsertCount
    }));
    if (upserts.length > 0) pushToSupabase(tableName, upserts);
    if (deltaMode && deletes.length > 0) deleteFromSupabase(tableName, deletes);

    moveDriveFileToFolderWithRetry_(newestFile, processedFolder, `${tableName} processed file ${newestFileName}`);
    importSucceeded = true;
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    upsertCount = 0;
    deleteCount = 0;
    failedFiles.push({ name: newestFileName, error: errorMessage });
    console.error(`[ERROR] Failed processing latest file ${newestFileName} for ${tableName}: ${err && err.stack ? err.stack : errorMessage}`);
    console.warn(`[LEAVE] Keeping ${newestFileName} in drop folder for retry/manual review.`);
  }

  if (importSucceeded) {
    olderFiles.forEach(function(file) {
      console.log(`[ARCHIVE] Skipping older pending file for ${tableName}: ${file.getName()}`);
      moveDriveFileToFolderWithRetry_(file, processedFolder, `${tableName} archived older file ${file.getName()}`);
      skippedFilesArchived++;
    });
    syncDiagnostics.archivedOlderFiles = skippedFilesArchived;
  } else if (olderFiles.length) {
    console.warn(`[LEAVE] Newest file for ${tableName} failed, so ${olderFiles.length} older pending file${olderFiles.length === 1 ? '' : 's'} will stay in drop.`);
  }

  console.log(
    `[DONE] ${tableName}: ${importSucceeded ? 1 : 0} latest file${importSucceeded ? '' : 's'} processed` +
    `${failedFiles.length ? ` | ${failedFiles.length} failed file${failedFiles.length === 1 ? '' : 's'} left in drop` : ''}` +
    ` | ${deleteCount} removed row${deleteCount === 1 ? '' : 's'}` +
    ` | ${upsertCount} row${upsertCount === 1 ? '' : 's'} upserted` +
    ` | ${totalRows} parsed row${totalRows === 1 ? '' : 's'}` +
    ` | ${skippedFilesArchived} older file${skippedFilesArchived === 1 ? '' : 's'} archived` +
    `${tempFilesRemoved ? ` | ${tempFilesRemoved} temp file${tempFilesRemoved === 1 ? '' : 's'} cleared` : ''}.`
  );

  if (importSucceeded) {
    emitTableSyncLiveEvent_(tableName, {
      filesProcessed: 1,
      tempFilesRemoved: tempFilesRemoved,
      skippedFilesArchived: skippedFilesArchived,
      upsertCount: upsertCount,
      deleteCount: deleteCount,
      totalRows: totalRows
    });
  }

  return {
    tableName: tableName,
    filesProcessed: importSucceeded ? 1 : 0,
    tempFilesRemoved: tempFilesRemoved,
    skippedFilesArchived: skippedFilesArchived,
    failedFiles: failedFiles.length,
    failedFileNames: failedFiles.map(function(entry) { return entry.name; }),
    failedFileErrors: failedFiles,
    upsertCount: upsertCount,
    deleteCount: deleteCount,
    totalRows: totalRows,
    diagnostics: syncDiagnostics
  };
}

function executeMasterSnapshotBatch_(tableName, parsedFiles, payloadBuilderFunc, syncStartTime) {
  const previewEntries = [];
  const previewStats = createDeltaSyncStats_();
  const combinedStats = createDeltaSyncStats_();
  const requestedCompareIds = new Set();
  const upsertsById = new Map();
  const seenIds = new Set();

  parsedFiles.forEach(function(entry) {
    const preview = previewMasterSnapshotFile_(entry.rawData);
    if (shouldAbortSnapshotDelete_(preview.stats, preview.totalRows)) {
      throw new Error(`0 valid snapshot identities were found in ${entry.fileName}; skipped destructive sync for ${tableName}.`);
    }
    mergeDeltaSyncStats_(previewStats, preview.stats);
    previewEntries.push({
      file: entry.file,
      fileName: entry.fileName,
      rawData: entry.rawData,
      preview: preview
    });
    preview.seenIds.forEach(function(uid) {
      const safeUid = String(uid || '').trim();
      if (safeUid) requestedCompareIds.add(safeUid);
    });
  });

  if (shouldAbortSnapshotDelete_(previewStats, previewStats.sourceRows)) {
    throw new Error(`0 valid snapshot identities were found for ${tableName}; skipped destructive sync.`);
  }

  console.log(`[MASTER SNAPSHOT][${tableName}] stage=existing_ids_scan | pendingFiles=${parsedFiles.length}`);
  const existingIds = fetchAllSupabaseRowIdsForMaster_(tableName);
  console.log(`[MASTER SNAPSHOT][${tableName}] stage=compare_rows_fetch | existingIds=${existingIds.length} | compareIds=${requestedCompareIds.size}`);
  const existingCompareRows = fetchSupabaseRowsByIds_(
    tableName,
    Array.from(requestedCompareIds),
    ['unique_id', 'assignedto', 'concat'],
    { interChunkDelayMs: SUPABASE_MASTER_COMPARE_FETCH_DELAY_MS }
  );
  console.log(`[MASTER SNAPSHOT][${tableName}] stage=compare_rows_ready | existingCompareRows=${existingCompareRows.length}`);

  const mutableExistingRows = buildExistingRowMap_(existingCompareRows);

  previewEntries.forEach(function(entry) {
    const results = payloadBuilderFunc(entry.rawData, tableName, mutableExistingRows, syncStartTime, entry.fileName);
    const fileStats = results && results.stats ? results.stats : createDeltaSyncStats_();
    if (shouldAbortSnapshotDelete_(fileStats, results && results.totalRows)) {
      throw new Error(`0 valid snapshot identities were found in ${entry.fileName}; skipped destructive sync for ${tableName}.`);
    }
    mergeDeltaSyncStats_(combinedStats, fileStats);
    (results.upserts || []).forEach(function(row) {
      const uid = String(row && row.unique_id || '').trim();
      if (!uid) return;
      upsertsById.set(uid, row);
      mutableExistingRows[uid] = row;
    });
    (results.seenIds || new Set()).forEach(function(uid) {
      const safeUid = String(uid || '').trim();
      if (safeUid) seenIds.add(safeUid);
    });
  });

  if (shouldAbortSnapshotDelete_(combinedStats, combinedStats.sourceRows)) {
    throw new Error(`0 valid snapshot identities were found for ${tableName}; skipped destructive sync.`);
  }

  const deletes = existingIds.filter(function(uid) {
    const safeUid = String(uid || '').trim();
    return safeUid && !seenIds.has(safeUid);
  });
  combinedStats.deletedRows = deletes.length;

  console.log(`[MASTER SNAPSHOT][${tableName}] stage=delete_pass | existingIds=${existingIds.length} | compareIds=${requestedCompareIds.size} | compareRows=${existingCompareRows.length} | deletes=${deletes.length}`);

  return {
    combinedStats: combinedStats,
    upserts: Array.from(upsertsById.values()),
    deletes: deletes,
    compareIdsRequested: requestedCompareIds.size,
    existingIdsFetched: existingIds.length,
    existingCompareRowsFetched: existingCompareRows.length
  };
}

function processSnapshotBatchFolder(dropFolderId, processedFolderId, tableName, payloadBuilderFunc, options) {
  const dropFolder = getDriveFolderByIdWithRetry_(dropFolderId, `${tableName} drop folder`);
  const processedFolder = getDriveFolderByIdWithRetry_(processedFolderId, `${tableName} processed folder`);
  const files = listDriveFilesWithRetry_(dropFolder, `${tableName} drop folder`);
  const pendingFiles = [];
  let tempFilesRemoved = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    if (fileName.startsWith('TEMP_')) {
      tempFilesRemoved++;
      trashDriveFileWithRetry_(file, `${tableName} temp file ${fileName}`);
      continue;
    }
    pendingFiles.push(file);
  }

  if (!pendingFiles.length) {
    console.log(`[SKIP] No files found for ${tableName}.`);
    return {
      tableName: tableName,
      filesProcessed: 0,
      tempFilesRemoved: tempFilesRemoved,
      failedFiles: 0,
      failedFileNames: [],
      upsertCount: 0,
      deleteCount: 0,
      diagnostics: createDeltaSyncStats_()
    };
  }

  pendingFiles.sort(function(a, b) {
    const timeDiff = a.getLastUpdated().getTime() - b.getLastUpdated().getTime();
    if (timeDiff !== 0) return timeDiff;
    return String(a.getName() || '').localeCompare(String(b.getName() || ''));
  });

  const syncStartTime = new Date().toISOString();
  const parsedFiles = [];
  const failedFiles = [];
  const combinedStats = createDeltaSyncStats_();
  let upsertCount = 0;
  let deleteCount = 0;
  let importSucceeded = false;

  console.log(`[START] Processing snapshot batch: ${pendingFiles.length} file(s) -> Table: ${tableName}`);

  try {
    pendingFiles.forEach(function(file) {
      const fileName = file.getName();
      console.log(`[PARSE] ${fileName}`);
      const rawData = extractDataFromFile(file, dropFolderId);
      if (!rawData || rawData.length < 1) {
        throw new Error(`No readable rows were found in ${fileName}.`);
      }
      parsedFiles.push({ file: file, fileName: fileName, rawData: rawData });
    });

    let upserts = [];
    let deletes = [];

    if (isMasterInventoryTable_(tableName)) {
      const masterResults = executeMasterSnapshotBatch_(tableName, parsedFiles, payloadBuilderFunc, syncStartTime);
      mergeDeltaSyncStats_(combinedStats, masterResults.combinedStats);
      upserts = masterResults.upserts || [];
      deletes = masterResults.deletes || [];
    } else {
      const selectColumnsSet = {};
      parsedFiles.forEach(function(entry) {
        getPayloadSelectColumns_(tableName, entry.rawData).forEach(function(column) {
          selectColumnsSet[column] = true;
        });
      });
      const existingRows = fetchAllSupabaseData(tableName, Object.keys(selectColumnsSet), getSupabaseFetchOptionsForTable_(tableName));
      const mutableExistingRows = buildExistingRowMap_(existingRows);
      const upsertsById = new Map();
      const seenIds = new Set();

      parsedFiles.forEach(function(entry) {
        const results = payloadBuilderFunc(entry.rawData, tableName, mutableExistingRows, syncStartTime, entry.fileName);
        const fileStats = results && results.stats ? results.stats : createDeltaSyncStats_();
        if (shouldAbortSnapshotDelete_(fileStats, results && results.totalRows)) {
          throw new Error(`0 valid snapshot identities were found in ${entry.fileName}; skipped destructive sync for ${tableName}.`);
        }
        mergeDeltaSyncStats_(combinedStats, fileStats);
        (results.upserts || []).forEach(function(row) {
          const uid = String(row && row.unique_id || '').trim();
          if (!uid) return;
          upsertsById.set(uid, row);
          mutableExistingRows[uid] = row;
        });
        (results.seenIds || new Set()).forEach(function(uid) {
          const safeUid = String(uid || '').trim();
          if (safeUid) seenIds.add(safeUid);
        });
      });

      if (shouldAbortSnapshotDelete_(combinedStats, combinedStats.sourceRows)) {
        throw new Error(`0 valid snapshot identities were found for ${tableName}; skipped destructive sync.`);
      }

      deletes = combineSnapshotDeleteIds_(existingRows, seenIds);
      combinedStats.deletedRows = deletes.length;
      upserts = Array.from(upsertsById.values());
    }

    upsertCount = upserts.length;
    deleteCount = deletes.length;

    console.log(formatDeltaSyncStats_(tableName, combinedStats, {
      filesProcessed: parsedFiles.length,
      archivedOlderFiles: 0,
      upserts: upsertCount
    }));

    if (upserts.length > 0) pushToSupabase(tableName, upserts);
    if (deletes.length > 0) deleteFromSupabase(tableName, deletes);

    parsedFiles.forEach(function(entry) {
      moveDriveFileToFolderWithRetry_(entry.file, processedFolder, `${tableName} processed snapshot file ${entry.fileName}`);
    });
    importSucceeded = true;
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    upsertCount = 0;
    deleteCount = 0;
    failedFiles.push.apply(failedFiles, pendingFiles.map(function(file) {
      return { name: file.getName(), error: errorMessage };
    }));
    console.error(`[ERROR] Failed snapshot batch for ${tableName}: ${err && err.stack ? err.stack : errorMessage}`);
    console.warn(`[LEAVE] Keeping pending ${tableName} snapshot files in drop folder for retry/manual review.`);
  }

  console.log(
    `[DONE] ${tableName}: ${importSucceeded ? `${pendingFiles.length} snapshot file${pendingFiles.length === 1 ? '' : 's'} processed` : 'snapshot batch failed'}` +
    `${failedFiles.length ? ` | ${failedFiles.length} file${failedFiles.length === 1 ? '' : 's'} left in drop` : ''}` +
    ` | ${deleteCount} removed row${deleteCount === 1 ? '' : 's'}` +
    ` | ${upsertCount} row${upsertCount === 1 ? '' : 's'} upserted` +
    `${tempFilesRemoved ? ` | ${tempFilesRemoved} temp file${tempFilesRemoved === 1 ? '' : 's'} cleared` : ''}.`
  );

  if (importSucceeded) {
    emitTableSyncLiveEvent_(tableName, {
      filesProcessed: pendingFiles.length,
      tempFilesRemoved: tempFilesRemoved,
      upsertCount: upsertCount,
      deleteCount: deleteCount
    });
  }

  return {
    tableName: tableName,
    filesProcessed: importSucceeded ? pendingFiles.length : 0,
    tempFilesRemoved: tempFilesRemoved,
    failedFiles: failedFiles.length,
    failedFileNames: failedFiles.map(function(entry) { return entry.name; }),
    failedFileErrors: failedFiles,
    upsertCount: upsertCount,
    deleteCount: deleteCount,
    diagnostics: combinedStats
  };
}

const RESERVE_STABLE_ROW_ID_HEADERS = Object.freeze([
  'UNIQUEID',
  'UNIQUE_ID',
  'ROWID',
  'ROW_ID',
  'SHEETROWID',
  'SHEET_ROW_ID',
  'SOURCEROWID',
  'SOURCE_ROW_ID',
  'IMPORTROWID',
  'IMPORT_ROW_ID',
  'LINEID',
  'LINE_ID',
  'ROWNUMBER',
  'ROW_NUMBER',
  'RESERVEROWID',
  'RESERVE_ROW_ID'
]);

function findReserveStableRowIdIndex_(cleanHeaders) {
  for (let i = 0; i < RESERVE_STABLE_ROW_ID_HEADERS.length; i++) {
    const candidate = String(RESERVE_STABLE_ROW_ID_HEADERS[i] || '').toUpperCase().replace(/\s+/g, '').replace(/_/g, '');
    const idx = cleanHeaders.indexOf(candidate);
    if (idx > -1) return idx;
  }
  return -1;
}

function normalizeDeltaCompareValue_(value) {
  if (value == null) return '';
  return String(value).trim();
}

function buildRowSyncHash_(row, excludedKeys) {
  const excluded = {};
  ['unique_id', 'last_updated', 'filename', 'concat']
    .concat(Array.isArray(excludedKeys) ? excludedKeys : [])
    .forEach(function(key) {
      excluded[String(key || '').trim().toLowerCase()] = true;
    });
  const keys = Object.keys(row || {})
    .filter(function(key) { return !excluded[String(key || '').trim().toLowerCase()]; })
    .sort();
  const payload = keys.map(function(key) {
    return `${String(key || '').trim().toLowerCase()}=${normalizeDeltaCompareValue_(row[key])}`;
  }).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function getExistingRowSyncHash_(row) {
  return String((row && (row.concat || row.CONCAT)) || '').trim();
}

function didHashedRowChange_(existingRow, nextRow) {
  const nextHash = getExistingRowSyncHash_(nextRow);
  const existingHash = getExistingRowSyncHash_(existingRow);
  if (nextHash && existingHash) return nextHash !== existingHash;
  return didDeltaRowChange_(existingRow, nextRow);
}

function didDeltaRowChange_(existingRow, nextRow) {
  if (!existingRow) return true;
  const keys = Object.keys(nextRow || {}).filter(function(key) {
    return !['unique_id', 'last_updated', 'filename', 'concat'].includes(String(key || '').trim().toLowerCase());
  });
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (normalizeDeltaCompareValue_(existingRow[key]) !== normalizeDeltaCompareValue_(nextRow[key])) return true;
  }
  return false;
}

function buildStandardPayload(rawData, tableName, existingRows, syncStartTime, fileName) {
  const rawHeaders = rawData[0].map(h => String(h).trim());
  const cleanHeaders = rawHeaders.map(h => String(h).toUpperCase().replace(/\s+/g, '').replace(/_/g, ''));
  const getIdx = (name) => cleanHeaders.indexOf(name.toUpperCase().replace(/\s+/g, '').replace(/_/g, ''));

  let iIdx = getIdx('ITEMCODE'), dockIdx = getIdx('DOCK');
  let custIdx = getIdx('CUSTOMERNAME'), consIdx = getIdx('CONSIGNEENAME');
  let stopIdx = getIdx('STOPNUMBER'), repIdx = getIdx('SALESREPNAME');

  let cIdx = getIdx('CONTSIZE');
  if (cIdx === -1) cIdx = getIdx('PRINTEDCONTAINERCODE');

  let transIdx = getIdx('TRANSACTIONNUMBER');
  let locIdx = getIdx('LOCATIONCODE'), lotIdx = getIdx('LOTCODE'), priIdx = getIdx('PRIORITY');
  let srcIdx = getIdx('SOURCE'), dItemIdx = getIdx('DESIGITEM');
  let reserveStableIdIdx = tableName === 'v2_reserves' ? findReserveStableRowIdIndex_(cleanHeaders) : -1;
  let upserts = [], seenIds = new Set(), idTracker = {};
  let totalRows = 0;
  let existingMap = buildExistingRowMap_(existingRows);
  let stats = createDeltaSyncStats_();
  stats.sourceRows = Math.max(0, (rawData.length || 1) - 1);

  for (let i = 1; i < rawData.length; i++) {
    let row = rawData[i];
    let itemCodeVal = String(row[iIdx] || '').trim();
    let custVal = custIdx > -1 ? String(row[custIdx] || '').trim() : '';
    let dockVal = dockIdx > -1 ? String(row[dockIdx] || '').trim() : '';
    if (!itemCodeVal || itemCodeVal.toUpperCase() === 'NULL') continue;
    if (tableName === 'v2_soc_master' && (!dockVal || dockVal === '0' || dockVal === '' || !custVal)) continue;
    if (tableName === 'v2_reserves' && !custVal) continue;

    totalRows++;

    let contSizeVal = cIdx > -1 ? String(row[cIdx] || '').trim() : '-';
    let consVal = consIdx > -1 ? String(row[consIdx] || '').trim() : '';
    let stopVal = stopIdx > -1 ? String(row[stopIdx] || '').trim() : '';
    let repVal = repIdx > -1 ? String(row[repIdx] || '').trim() : '';
    let transVal = transIdx > -1 ? String(row[transIdx] || '').trim() : '';
    let locVal = locIdx > -1 ? String(row[locIdx] || '').trim() : '';
    let lotVal = lotIdx > -1 ? String(row[lotIdx] || '').trim() : '';
    let priVal = priIdx > -1 ? String(row[priIdx] || '').trim() : '';
    let srcVal = srcIdx > -1 ? String(row[srcIdx] || '').trim() : '';
    let dItemVal = dItemIdx > -1 ? String(row[dItemIdx] || '').trim() : '';
    let uniqueId = '';
    if (tableName === 'v2_reserves' && reserveStableIdIdx > -1) {
      uniqueId = String(row[reserveStableIdIdx] || '').trim();
    }
    if (!uniqueId) {
      let baseId = tableName === 'v2_reserves'
        ? `${transVal}-${custVal}-${consVal}-${repVal}-${itemCodeVal}-${contSizeVal}-${locVal}-${lotVal}-${srcVal}-${priVal}-${dItemVal}`
        : `${dockVal}-${transVal}-${custVal}-${consVal}-${stopVal}-${itemCodeVal}-${contSizeVal}-${locVal}-${lotVal}-${srcVal}-${priVal}-${dItemVal}`;
      let cleanId = baseId.replace(/[^a-zA-Z0-9-]/g, '_');
      if (idTracker[cleanId] === undefined) idTracker[cleanId] = 0; else idTracker[cleanId]++;
      uniqueId = cleanId;
      if (idTracker[cleanId] > 0) uniqueId += '-' + idTracker[cleanId];
      if (tableName === 'v2_reserves') stats.fallbackIdentityRows++;
    }
    if (!uniqueId) {
      stats.skippedRows++;
      continue;
    }
    stats.validIdentityRows++;

    let obj = { unique_id: uniqueId, last_updated: syncStartTime, contsize: contSizeVal, filename: fileName };
    for (let c = 0; c < rawHeaders.length; c++) {
      let key = normalizePayloadColumnKey_(rawHeaders[c]);
      if (ALLOWED_DB_COLUMNS.has(key)) {
        let val = String(row[c] || '').trim();
        obj[key] = (val === '' || val === 'NULL') ? null : val;
      }
    }
    if (tableStoresSyncHash_(tableName)) obj.concat = buildRowSyncHash_(obj);

    seenIds.add(uniqueId);
    const existingRow = existingMap[uniqueId];
    if (!existingRow) {
      stats.insertedRows++;
      upserts.push(obj);
      continue;
    }
    if (didHashedRowChange_(existingRow, obj)) {
      stats.changedRows++;
      upserts.push(obj);
      continue;
    }
    stats.unchangedRows++;
  }

  return { upserts, seenIds, totalRows, stats };
}

function buildMasterPayload(rawData, tableName, existingRows, syncStartTime, fileName) {
  const context = getMasterPayloadContext_(rawData);
  const rawHeaders = context.rawHeaders;
  const upserts = [];
  const seenIds = new Set();
  const idTracker = {};
  let totalRows = 0;
  const existingMap = buildExistingRowMap_(existingRows);
  const stats = createDeltaSyncStats_();
  stats.sourceRows = Math.max(0, (rawData.length || 1) - 1);

  const bigTreeSizes = ['#7', '#10', '#15', '#25', '#45'];
  const roundRobinTeam = ['Dylan', 'Morgan', 'Kayla'];

  let rrIndex = 0;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    const identity = getMasterRowIdentity_(row, context, idTracker);
    if (!identity.valid) {
      stats.skippedRows++;
      continue;
    }
    totalRows++;
    const uniqueId = identity.uniqueId;
    const contSize = identity.contSize;
    stats.validIdentityRows++;

    const obj = { unique_id: uniqueId, last_updated: syncStartTime, contsize: contSize, filename: fileName };
    for (let c = 0; c < rawHeaders.length; c++) {
      const key = normalizePayloadColumnKey_(rawHeaders[c]);
      if (ALLOWED_DB_COLUMNS.has(key)) {
        const val = String(row[c] || '').trim();
        obj[key] = (val === '' || val === 'NULL') ? null : val;
      }
    }

    const existingAssignedTo = existingMap[uniqueId] && existingMap[uniqueId].assignedto
      ? String(existingMap[uniqueId].assignedto).trim()
      : '';

    if (existingAssignedTo) obj.assignedto = existingAssignedTo;
    else if (bigTreeSizes.some(size => contSize.includes(size))) obj.assignedto = 'Dylan';
    else {
      obj.assignedto = roundRobinTeam[rrIndex];
      rrIndex = (rrIndex + 1) % roundRobinTeam.length;
    }
    obj.concat = buildRowSyncHash_(obj, ['assignedto']);

    seenIds.add(uniqueId);
    const existingRow = existingMap[uniqueId];
    if (!existingRow) {
      stats.insertedRows++;
      upserts.push(obj);
      continue;
    }
    if (didHashedRowChange_(existingRow, obj)) {
      stats.changedRows++;
      upserts.push(obj);
      continue;
    }
    stats.unchangedRows++;
  }

  return { upserts, seenIds, totalRows, stats };
}

function buildCavPayload(rawData, tableName, existingRows, syncStartTime, fileName) {
  const rawHeaders = rawData[0].map(h => String(h).trim());
  const cleanHeaders = rawHeaders.map(h => String(h).toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const getIdx = (name) => cleanHeaders.indexOf(String(name).toUpperCase().replace(/[^A-Z0-9]/g, ''));

  let itemIdx = getIdx('ITEM');
  let descIdx = getIdx('PRODUCTDESCRIPTION');
  let brandCodeIdx = getIdx('BRANDCODE');
  let sizeIdx = getIdx('SIZE');
  let seasonIdx = getIdx('SEASON');
  let availableIdx = getIdx('AVAILABLE');
  let reservedQtyIdx = getIdx('RESERVEDQTY');
  let orderQtyIdx = getIdx('ORDERQTY');
  let unitPriceIdx = getIdx('UNITPRICE');
  let hotPriceIdx = getIdx('HOTPRICE');
  let holdReasonIdx = getIdx('HOLDREASONNOTESCOMMENT');
  if (holdReasonIdx === -1) holdReasonIdx = getIdx('HOLDREASONNOTESCOMMENTS');
  let specIdx = getIdx('SPEC');
  let hzIdx = getIdx('HZ');
  let extItemTotalIdx = getIdx('EXTITEMTOTAL');

  let upserts = [];
  let seenIds = new Set();
  let idTracker = {};
  let totalRows = 0;
  let existingMap = buildExistingRowMap_(existingRows);
  let stats = createDeltaSyncStats_();
  stats.sourceRows = Math.max(0, (rawData.length || 1) - 1);

  for (let i = 1; i < rawData.length; i++) {
    let row = rawData[i];
    let itemCodeVal = itemIdx > -1 ? String(row[itemIdx] || '').trim() : '';
    let descriptionVal = descIdx > -1 ? String(row[descIdx] || '').trim() : '';
    let brandCodeVal = brandCodeIdx > -1 ? String(row[brandCodeIdx] || '').trim() : '';
    let sizeVal = sizeIdx > -1 ? String(row[sizeIdx] || '').trim() : '-';
    let seasonVal = seasonIdx > -1 ? String(row[seasonIdx] || '').trim() : '';
    let availableVal = availableIdx > -1 ? String(row[availableIdx] || '').trim() : '';
    let reservedQtyVal = reservedQtyIdx > -1 ? String(row[reservedQtyIdx] || '').trim() : '';
    let orderQtyVal = orderQtyIdx > -1 ? String(row[orderQtyIdx] || '').trim() : '';
    let unitPriceVal = unitPriceIdx > -1 ? String(row[unitPriceIdx] || '').trim() : '';
    let hotPriceVal = hotPriceIdx > -1 ? String(row[hotPriceIdx] || '').trim() : '';
    let holdReasonVal = holdReasonIdx > -1 ? String(row[holdReasonIdx] || '').trim() : '';
    let specVal = specIdx > -1 ? String(row[specIdx] || '').trim() : '';
    let hzVal = hzIdx > -1 ? String(row[hzIdx] || '').trim() : '';
    let extItemTotalVal = extItemTotalIdx > -1 ? String(row[extItemTotalIdx] || '').trim() : '';

    if (!itemCodeVal || itemCodeVal.toUpperCase() === 'NULL') continue;

    totalRows++;

    let baseId = `${itemCodeVal}-${sizeVal}-${brandCodeVal}-${seasonVal}-${specVal}-${hzVal}`.replace(/[^a-zA-Z0-9-]/g, '_');
    if (idTracker[baseId] === undefined) idTracker[baseId] = 0; else idTracker[baseId]++;

    let uniqueId = baseId;
    if (idTracker[baseId] > 0) uniqueId += '-' + idTracker[baseId];
    if (!uniqueId) {
      stats.skippedRows++;
      continue;
    }
    stats.validIdentityRows++;

    let obj = {
      unique_id: uniqueId,
      last_updated: syncStartTime,
      filename: fileName,
      itemcode: itemCodeVal,
      commonname: descriptionVal || itemCodeVal,
      product_description: descriptionVal || null,
      contsize: sizeVal || '-',
      season: seasonVal || null,
      ptravailable: availableVal || null,
      brand: brandCodeVal || null,
      brand_code: brandCodeVal || null,
      spec: specVal || null,
      hz: hzVal || null,
      unitprice: unitPriceVal || null,
      unit_price: unitPriceVal || null,
      hot_price: hotPriceVal || null,
      holdstopreason: holdReasonVal || null,
      reserved_qty: reservedQtyVal || null,
      order_qty: orderQtyVal || null,
      ordertotal: extItemTotalVal || null
    };
    seenIds.add(uniqueId);
    const existingRow = existingMap[uniqueId];
    if (!existingRow) {
      stats.insertedRows++;
      upserts.push(obj);
      continue;
    }
    if (didHashedRowChange_(existingRow, obj)) {
      stats.changedRows++;
      upserts.push(obj);
      continue;
    }
    stats.unchangedRows++;
  }

  return { upserts, seenIds, totalRows, stats };
}
// =========================================================================
// MEMORY-OPTIMIZED UTILITIES & ENDPOINTS
// =========================================================================

function isExcelLikeFile_(mime, fileName) {
  const safeMime = String(mime || '').toLowerCase();
  const safeFileName = String(fileName || '').toLowerCase();
  return safeMime.includes('excel') ||
    safeMime.includes('spreadsheetml') ||
    safeFileName.endsWith('.xlsx') ||
    safeFileName.endsWith('.xls') ||
    safeFileName.endsWith('.xlsm');
}

function createTempGoogleSheetFromExcel_(file, folderId) {
  const convertedFile = withDriveRetry_(`Convert Excel to Google Sheet: ${file.getName()}`, function() {
    return Drive.Files.create(
      { name: "TEMP_" + file.getName(), mimeType: MimeType.GOOGLE_SHEETS, parents: [folderId] },
      file.getBlob(),
      { fields: 'id,name' }
    );
  });

  if (!convertedFile || !convertedFile.id) {
    throw new Error(`Converted Google Sheet id was not returned for ${file.getName()}.`);
  }

  return String(convertedFile.id);
}

function openSpreadsheetWithRetry_(sheetId, fileName) {
  let lastError = null;

  for (let attempt = 1; attempt <= EXCEL_CONVERSION_OPEN_RETRY_COUNT; attempt++) {
    try {
      const spreadsheet = SpreadsheetApp.openById(sheetId);
      const sheets = spreadsheet.getSheets();
      if (!sheets || !sheets.length) {
        throw new Error(`Converted workbook for ${fileName} has no sheets.`);
      }
      return spreadsheet;
    } catch (err) {
      lastError = err;
      if (attempt < EXCEL_CONVERSION_OPEN_RETRY_COUNT) {
        Utilities.sleep(EXCEL_CONVERSION_OPEN_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw new Error(`Converted sheet open failed for ${fileName}: ${lastError && lastError.message ? lastError.message : lastError}`);
}

function cleanupTempGoogleSheet_(sheetId, fileName) {
  const tempSheetId = String(sheetId || '').trim();
  if (!tempSheetId) return;

  try {
    withDriveRetry_(`Trash temp converted sheet: ${fileName}`, function() {
      return Drive.Files.update({ trashed: true }, tempSheetId, null, { fields: 'id,trashed' });
    });
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    console.warn(`[WARN] Could not trash temp converted sheet ${tempSheetId} for ${fileName}: ${errorMessage}`);
  }
}

function extractDataFromFile(file, folderId) {
  const mime = file.getMimeType();
  const originalFileName = String(file.getName() || '').trim();
  const normalizedFileName = originalFileName.toLowerCase();
  let allValues = [];
  let tempSheetId = '';

  try {
    if (mime === MimeType.CSV || normalizedFileName.endsWith('.csv')) {
      const csvString = file.getBlob().getDataAsString();
      allValues = Utilities.parseCsv(csvString);
    } else {
      let sheetId = file.getId();
      if (isExcelLikeFile_(mime, normalizedFileName)) {
        tempSheetId = createTempGoogleSheetFromExcel_(file, folderId);
        sheetId = tempSheetId;
      }

      const ss = tempSheetId
        ? openSpreadsheetWithRetry_(sheetId, originalFileName)
        : SpreadsheetApp.openById(sheetId);
      const sheets = ss.getSheets();
      if (!sheets || !sheets.length) {
        throw new Error(`No sheets found in ${originalFileName}.`);
      }
      allValues = sheets[0].getDataRange().getValues();
    }

    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(15, allValues.length); r++) {
      let rowValues = allValues[r].map(cell => String(cell).toUpperCase().replace(/[^A-Z0-9]/g, ''));
      const isStandardInventoryHeader = rowValues.includes('ITEMCODE') || rowValues.includes('DOCK') || rowValues.includes('WAREHOUSEID');
      const isCavHeader = rowValues.includes('PRODUCTDESCRIPTION') && (rowValues.includes('ITEM') || rowValues.includes('AVAILABLE'));
      if (isStandardInventoryHeader || isCavHeader) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error(`No recognized header row found in ${originalFileName}.`);
    }

    allValues.splice(0, headerRowIdx);
    return allValues;
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    console.error(`[ERROR] extractDataFromFile failed for ${originalFileName}: ${errorMessage}`);
    throw new Error(errorMessage);
  } finally {
    cleanupTempGoogleSheet_(tempSheetId, originalFileName);
  }
}

function syncNotesToSupabase() {
  const sheetUrl = "https://docs.google.com/spreadsheets/d/1g7Dy2mDDljTs3e9FhQhdDQ-b7sw_gU1vCdcA14N4mKk/edit?gid=1449031333#gid=1449031333";
  const ss = SpreadsheetApp.openByUrl(sheetUrl);
  const targetGid = 1449031333;
  let sheet = null;
  
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === targetGid) { sheet = sheets[i]; break; }
  }
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  let headers = data[0], commonnameIdx = -1, salesnoteIdx = -1, uniqueIdIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    let h = String(headers[i]).toLowerCase().trim();
    if (h === "commonname") { commonnameIdx = i; headers[i] = "commonname"; }
    if (h === "salesnotes" || h === "salesnote") { salesnoteIdx = i; headers[i] = "salesnote"; }
    if (h === "unique_id") uniqueIdIdx = i;
  }

  if (commonnameIdx === -1 || salesnoteIdx === -1) return;

  if (uniqueIdIdx === -1) {
    uniqueIdIdx = headers.length;
    headers.push("unique_id");
    sheet.getRange(1, uniqueIdIdx + 1).setValue("unique_id");
    if (commonnameIdx > -1) sheet.getRange(1, commonnameIdx + 1).setValue("commonname");
    if (salesnoteIdx > -1) sheet.getRange(1, salesnoteIdx + 1).setValue("salesnote");
  }

  let recordsToUpsert = [];
  let updatedSheetData = [];

  for (let i = 1; i < data.length; i++) {
    let row = data[i];
    while (row.length < headers.length) { row.push(""); }
    let commonname = row[commonnameIdx] ? String(row[commonnameIdx]).trim() : "";
    let salesnote = row[salesnoteIdx] ? String(row[salesnoteIdx]).trim() : "";
    let uid = row[uniqueIdIdx] ? String(row[uniqueIdIdx]).trim() : "";

    if (!commonname && !salesnote) continue;

    if (!uid) { uid = Utilities.getUuid(); row[uniqueIdIdx] = uid; }
    recordsToUpsert.push({ unique_id: uid, commonname: commonname, salesnote: salesnote });
    updatedSheetData.push(row);
  }

  if (updatedSheetData.length > 0) {
    sheet.getRange(2, 1, updatedSheetData.length, headers.length).setValues(updatedSheetData);
    SpreadsheetApp.flush(); 
  }
  if (recordsToUpsert.length > 0) { pushToSupabase('v2_av_notes', recordsToUpsert); }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function loadDelayedRequestEmailQueue_() {
  const raw = PropertiesService.getScriptProperties().getProperty(DELAYED_REQUEST_EMAIL_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(function(job) {
      return job && job.id && job.payload;
    }) : [];
  } catch (err) {
    console.error('[REQUEST EMAIL] Could not parse delayed email queue', err);
    return [];
  }
}

function saveDelayedRequestEmailQueue_(jobs) {
  const safeJobs = Array.isArray(jobs) ? jobs.filter(function(job) {
    return job && job.id && job.payload;
  }) : [];
  if (!safeJobs.length) {
    PropertiesService.getScriptProperties().deleteProperty(DELAYED_REQUEST_EMAIL_QUEUE_KEY);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(DELAYED_REQUEST_EMAIL_QUEUE_KEY, JSON.stringify(safeJobs));
}

function removeDelayedRequestEmailTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DELAYED_REQUEST_EMAIL_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function scheduleDelayedRequestEmailTrigger_(jobs) {
  removeDelayedRequestEmailTriggers_();
  const safeJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  if (!safeJobs.length) return;
  const nextDueAtMs = safeJobs.reduce(function(minMs, job) {
    const dueAtMs = Number(job && job.dueAtMs) || 0;
    if (!dueAtMs) return minMs;
    if (!minMs || dueAtMs < minMs) return dueAtMs;
    return minMs;
  }, 0);
  if (!nextDueAtMs) return;
  const delayMs = Math.max(1000, nextDueAtMs - Date.now());
  ScriptApp.newTrigger(DELAYED_REQUEST_EMAIL_TRIGGER_HANDLER)
    .timeBased()
    .after(delayMs)
    .create();
}

function enqueueDelayedRequestEmail_(payload) {
  const safePayload = payload && typeof payload === 'object' ? JSON.parse(JSON.stringify(payload)) : {};
  const threadId = String(safePayload.threadId || '').trim();
  const messageId = String(safePayload.messageId || '').trim();
  if (!threadId || !messageId) {
    return {
      ok: false,
      status: 400,
      queued: false,
      message: 'Delayed request completion emails require threadId and messageId.'
    };
  }
  const delayMs = Math.max(DELAYED_REQUEST_EMAIL_MIN_DELAY_MS, Number(safePayload.delayMs) || 0);
  const requestIds = Array.isArray(safePayload.requestIds)
    ? safePayload.requestIds.map(function(id) { return String(id || '').trim(); }).filter(Boolean)
    : [];
  if (!requestIds.length && Array.isArray(safePayload.requestItems)) {
    safePayload.requestIds = safePayload.requestItems.map(function(item) {
      return String(firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, '')).trim();
    }).filter(Boolean);
  } else if (requestIds.length) {
    safePayload.requestIds = requestIds;
  }
  delete safePayload.delayMs;
  delete safePayload.queueDelivery;
  delete safePayload.requestItems;
  delete safePayload.formattedItemsHtml;
  delete safePayload.formattedItemsText;
  const queue = loadDelayedRequestEmailQueue_();
  const job = {
    id: Utilities.getUuid(),
    dueAtMs: Date.now() + delayMs,
    payload: safePayload
  };
  queue.push(job);
  saveDelayedRequestEmailQueue_(queue);
  scheduleDelayedRequestEmailTrigger_(queue);
  return {
    ok: true,
    status: 202,
    queued: true,
    jobId: job.id,
    dueAt: new Date(job.dueAtMs).toISOString()
  };
}

function processDelayedRequestEmailQueue_() {
  const queue = loadDelayedRequestEmailQueue_();
  if (!queue.length) {
    removeDelayedRequestEmailTriggers_();
    return;
  }
  const nowMs = Date.now();
  const dueJobs = [];
  const futureJobs = [];
  queue.forEach(function(job) {
    const dueAtMs = Number(job && job.dueAtMs) || 0;
    if (dueAtMs && dueAtMs <= nowMs) dueJobs.push(job);
    else futureJobs.push(job);
  });
  saveDelayedRequestEmailQueue_(futureJobs);
  dueJobs.forEach(function(job) {
    let jobPayload = job && job.payload ? JSON.parse(JSON.stringify(job.payload)) : {};
    delete jobPayload.delayMs;
    delete jobPayload.queueDelivery;
    if (String(jobPayload.emailType || '').trim().toLowerCase() === 'request_complete') {
      jobPayload = hydrateQueuedRequestCompletePayload_(jobPayload);
    }
    try {
      const result = sendRequestEmailWithFallback_(jobPayload);
      if (!result || result.ok === false) {
        console.error('[REQUEST EMAIL] Delayed request email failed', { jobId: job && job.id, result: result });
      }
    } catch (error) {
      console.error('[REQUEST EMAIL] Delayed request email threw', { jobId: job && job.id, error: error && error.message ? error.message : error });
    }
  });
  scheduleDelayedRequestEmailTrigger_(futureJobs);
}

function escapeEmailHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeEmailAttribute_(value) {
  return escapeEmailHtml_(value).replace(/`/g, '&#96;');
}

function firstNonEmptyRequestValue_() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function formatRequestPercentForEmail_(value) {
  const text = firstNonEmptyRequestValue_(value);
  if (!text) return '';
  return /%$/.test(text) ? text : text + '%';
}

const CALIPER_MEASUREMENT_NOTE_ = '** Caliper is measured 12 inches above soil level.';

function isCaliperEmailField_(label) {
  return String(label || '').trim().toLowerCase() === 'caliper';
}

function hasCaliperEmailValue_(value) {
  return String(value == null ? '' : value).trim() !== '';
}

function buildCaliperMeasurementNoteHtml_(value) {
  if (!hasCaliperEmailValue_(value)) return '';
  return '<div style="margin:2px 0 6px 0;color:#dc2626;font-weight:700;">' + escapeEmailHtml_(CALIPER_MEASUREMENT_NOTE_) + '</div>';
}

function extractRequestPhotoUrls_(value) {
  const seen = {};
  return String(value || '')
    .split(',')
    .map(function(entry) { return String(entry || '').trim(); })
    .filter(function(entry) {
      if (!/^https?:\/\//i.test(entry) || seen[entry]) return false;
      seen[entry] = true;
      return true;
    });
}

function buildRequestItemFieldRowsText_(item) {
  const fields = [
    ['Item Code', firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, '-')],
    ['Location', firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, '-')],
    ['Lot', firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, '')],
    ['Season', firstNonEmptyRequestValue_(item && item.season, item && item.SEASON, '')],
    ['Priority', firstNonEmptyRequestValue_(item && item.priority, item && item.PRIORITY, '')],
    ['S_LTS', firstNonEmptyRequestValue_(item && item.s_lts, item && item.S_LTS, '')],
    ['PTR Available', firstNonEmptyRequestValue_(item && item.ptravailable, item && item.PTRAVAILABLE, '')],
    ['Requested Qty', firstNonEmptyRequestValue_(item && item.qty, item && item.requested_qty, item && item.REQ_QTY, '')],
    ['Completed By', formatRequestCompletionUserLabel_(item)],
    ['Spec', firstNonEmptyRequestValue_(item && item.spec, item && item.REQ_SPEC, item && item.SPEC, '')],
    ['Caliper', firstNonEmptyRequestValue_(item && item.caliper, item && item.REQ_CALIPER, item && item.CALIPER, '')],
    ['LOC MATCH %', formatRequestPercentForEmail_(firstNonEmptyRequestValue_(item && item.match, item && item.req_match, item && item.MATCH, item && item.REQ_MATCH, ''))],
    ['LOC PHOTO MATCH', firstNonEmptyRequestValue_(item && item.loc_match_qty, item && item.LOC_MATCH_QTY, item && item.locPhotoMatch, '')],
    ['AV Note', firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, '')],
    ['Reserve', firstNonEmptyRequestValue_(item && item.reserve, item && item.req_reserve, item && item.REQ_RESERVE, '')],
    ['Pick Note', firstNonEmptyRequestValue_(item && item.pick_note, item && item.pick, item && item.REQ_PICK, item && item.PICK, '')],
    ['Comments', firstNonEmptyRequestValue_(item && item.comments, item && item.REQ_COMMENTS, item && item.COMMENTS, item && item.SALES_NOTE, item && item.SALESNOTE, '')]
  ];

  return fields
    .filter(function(field) { return !!String(field[1] || '').trim(); })
    .map(function(field) {
      const line = field[0] + ': ' + field[1];
      return isCaliperEmailField_(field[0]) && hasCaliperEmailValue_(field[1])
        ? line + '\n' + CALIPER_MEASUREMENT_NOTE_
        : line;
    })
    .join('\n');
}

function buildRequestItemFieldRowsHtml_(item) {
  const fields = [
    ['Item Code', firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, '-')],
    ['Location', firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, '-')],
    ['Lot', firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, '')],
    ['Season', firstNonEmptyRequestValue_(item && item.season, item && item.SEASON, '')],
    ['Priority', firstNonEmptyRequestValue_(item && item.priority, item && item.PRIORITY, '')],
    ['S_LTS', firstNonEmptyRequestValue_(item && item.s_lts, item && item.S_LTS, '')],
    ['PTR Available', firstNonEmptyRequestValue_(item && item.ptravailable, item && item.PTRAVAILABLE, '')],
    ['Requested Qty', firstNonEmptyRequestValue_(item && item.qty, item && item.requested_qty, item && item.REQ_QTY, '')],
    ['Completed By', formatRequestCompletionUserLabel_(item)],
    ['Spec', firstNonEmptyRequestValue_(item && item.spec, item && item.REQ_SPEC, item && item.SPEC, '')],
    ['Caliper', firstNonEmptyRequestValue_(item && item.caliper, item && item.REQ_CALIPER, item && item.CALIPER, '')],
    ['LOC MATCH %', formatRequestPercentForEmail_(firstNonEmptyRequestValue_(item && item.match, item && item.req_match, item && item.MATCH, item && item.REQ_MATCH, ''))],
    ['LOC PHOTO MATCH', firstNonEmptyRequestValue_(item && item.loc_match_qty, item && item.LOC_MATCH_QTY, item && item.locPhotoMatch, '')],
    ['AV Note', firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, '')],
    ['Reserve', firstNonEmptyRequestValue_(item && item.reserve, item && item.req_reserve, item && item.REQ_RESERVE, '')],
    ['Pick Note', firstNonEmptyRequestValue_(item && item.pick_note, item && item.pick, item && item.REQ_PICK, item && item.PICK, '')],
    ['Comments', firstNonEmptyRequestValue_(item && item.comments, item && item.REQ_COMMENTS, item && item.COMMENTS, item && item.SALES_NOTE, item && item.SALESNOTE, '')]
  ];

  return fields
    .filter(function(field) { return !!String(field[1] || '').trim(); })
    .map(function(field) {
      const rowHtml = '<div><strong>' + escapeEmailHtml_(field[0]) + ':</strong> ' + escapeEmailHtml_(field[1]) + '</div>';
      return rowHtml + (isCaliperEmailField_(field[0]) ? buildCaliperMeasurementNoteHtml_(field[1]) : '');
    })
    .join('');
}

function normalizeEmailAddress_(value) {
  return String(value || '').trim().toLowerCase();
}

function isLikelyEmailAddress_(value) {
  const email = normalizeEmailAddress_(value);
  return !!email && email.indexOf('@') > 0 && email.indexOf('.') > email.indexOf('@') + 1;
}

function flattenEmailValues_(input, output) {
  const sink = Array.isArray(output) ? output : [];
  if (input == null) return sink;

  if (Array.isArray(input)) {
    input.forEach(function(entry) {
      flattenEmailValues_(entry, sink);
    });
    return sink;
  }

  if (typeof input === 'object') {
    flattenEmailValues_(input.email || input.address || input.value || '', sink);
    return sink;
  }

  String(input || '').split(/[;,]/).forEach(function(part) {
    const trimmed = normalizeEmailAddress_(part);
    if (trimmed) sink.push(trimmed);
  });
  return sink;
}

function dedupeEmailAddresses_(values) {
  const seen = {};
  const unique = [];
  flattenEmailValues_(values, []).forEach(function(entry) {
    const email = normalizeEmailAddress_(entry);
    if (!isLikelyEmailAddress_(email) || seen[email]) return;
    seen[email] = true;
    unique.push(email);
  });
  return unique;
}

function resolveRequestRecipientEmail_(repName, fallbackEmail) {
  const normalized = String(repName || '').trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = normalized.replace(/\s+/g, '');
  const underscored = normalized.replace(/\s+/g, '_');
  const aliasMap = {
    jd: 'jd_jones@greenleafnursery.com',
    jdjones: 'jd_jones@greenleafnursery.com',
    jd_jones: 'jd_jones@greenleafnursery.com',
    dylan: 'dylan_collyge@greenleafnursery.com',
    dylancollyge: 'dylan_collyge@greenleafnursery.com',
    dylan_collyge: 'dylan_collyge@greenleafnursery.com',
    kayla: 'kayla_knepp@greenleafnursery.com',
    kaylaknepp: 'kayla_knepp@greenleafnursery.com',
    kayla_knepp: 'kayla_knepp@greenleafnursery.com',
    morgan: 'morgan_anderson@greenleafnursery.com',
    morgananderson: 'morgan_anderson@greenleafnursery.com',
    morgan_anderson: 'morgan_anderson@greenleafnursery.com',
    ben: 'ben_maschino@greenleafnursery.com',
    benmaschino: 'ben_maschino@greenleafnursery.com',
    ben_maschino: 'ben_maschino@greenleafnursery.com',
    benmachino: 'ben_maschino@greenleafnursery.com',
    ben_machino: 'ben_maschino@greenleafnursery.com',
    abbey: 'abbey_burka@greenleafnursery.com',
    abbeyburka: 'abbey_burka@greenleafnursery.com',
    abbey_burka: 'abbey_burka@greenleafnursery.com',
    molly: 'molly_dixon@greenleafnursery.com',
    mollydixon: 'molly_dixon@greenleafnursery.com',
    molly_dixon: 'molly_dixon@greenleafnursery.com'
  };

  if (aliasMap[compact]) return aliasMap[compact];
  if (aliasMap[underscored]) return aliasMap[underscored];

  const fallback = normalizeEmailAddress_(fallbackEmail);
  if (isLikelyEmailAddress_(fallback)) {
    const localPart = fallback.split('@')[0].replace(/[^a-z0-9_]/g, '');
    if (aliasMap[localPart]) return aliasMap[localPart];
    return fallback;
  }

  return underscored ? underscored + '@greenleafnursery.com' : '';
}

function normalizeRequestCompletionUsername_(value) {
  return String(value || '').trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeRequestCompletionUserEntry_(entry) {
  let username = '';
  let display = '';
  let email = '';
  if (typeof entry === 'string') {
    const raw = String(entry || '').trim();
    if (!raw) return null;
    if (raw.indexOf('@') !== -1) {
      email = normalizeEmailAddress_(raw);
      username = normalizeRequestCompletionUsername_(raw.split('@')[0] || raw);
      display = username;
    } else {
      username = normalizeRequestCompletionUsername_(raw);
      display = raw;
    }
  } else if (entry && typeof entry === 'object') {
    username = normalizeRequestCompletionUsername_(firstNonEmptyRequestValue_(
      entry.username,
      entry.user,
      entry.completed_by_username,
      entry.completedByUsername,
      entry.COMPLETED_BY_USERNAME,
      entry.REQUEST_COMPLETED_BY_USERNAME,
      ''
    ));
    display = String(firstNonEmptyRequestValue_(
      entry.display,
      entry.displayName,
      entry.completed_by_display,
      entry.completedByDisplay,
      entry.COMPLETED_BY_DISPLAY,
      entry.REQUEST_COMPLETED_BY_DISPLAY,
      entry.completed_by,
      entry.completedBy,
      entry.COMPLETED_BY,
      username,
      ''
    ) || '').trim();
    email = normalizeEmailAddress_(firstNonEmptyRequestValue_(
      entry.email,
      entry.completed_by_email,
      entry.completedByEmail,
      entry.COMPLETED_BY_EMAIL,
      entry.REQUEST_COMPLETED_BY_EMAIL,
      ''
    ));
  }
  if (!username && email) username = normalizeRequestCompletionUsername_(email.split('@')[0] || email);
  if (!display) display = username || email;
  if (!email && (username || display)) email = normalizeEmailAddress_(resolveRequestRecipientEmail_(username || display, ''));
  if (!username && display) username = normalizeRequestCompletionUsername_(display);
  if (!username && !display && !email) return null;
  return {
    username: username,
    display: display,
    email: email
  };
}

function getRequestCompletionUserEntryFromItem_(item) {
  if (!item || typeof item !== 'object') return null;
  return normalizeRequestCompletionUserEntry_({
    username: firstNonEmptyRequestValue_(item.COMPLETED_BY_USERNAME, item.completed_by_username, item.completedByUsername, item.REQUEST_COMPLETED_BY_USERNAME, ''),
    display: firstNonEmptyRequestValue_(item.COMPLETED_BY_DISPLAY, item.completed_by_display, item.completedByDisplay, item.COMPLETED_BY, item.completed_by, item.REQUEST_COMPLETED_BY_DISPLAY, ''),
    email: firstNonEmptyRequestValue_(item.COMPLETED_BY_EMAIL, item.completed_by_email, item.completedByEmail, item.REQUEST_COMPLETED_BY_EMAIL, '')
  });
}

function formatRequestCompletionUserLabel_(item) {
  const entry = getRequestCompletionUserEntryFromItem_(item);
  if (!entry) return '';
  if (entry.display && entry.username && normalizeRequestCompletionUsername_(entry.display) !== entry.username) {
    return entry.display + ' (' + entry.username + ')';
  }
  return entry.display || entry.username || entry.email || '';
}

function collectRequestCompletionUsers_(payload) {
  const seen = {};
  const users = [];
  const addUser = function(entry) {
    const normalized = normalizeRequestCompletionUserEntry_(entry);
    if (!normalized) return;
    const key = normalized.email || normalized.username || normalizeRequestCompletionUsername_(normalized.display);
    if (!key || seen[key]) return;
    seen[key] = true;
    users.push(normalized);
  };
  const directUsers = Array.isArray(payload && payload.completedByUsers) ? payload.completedByUsers
    : (Array.isArray(payload && payload.completed_by_users) ? payload.completed_by_users : []);
  directUsers.forEach(addUser);
  const directEmails = dedupeEmailAddresses_([
    payload && payload.completedByEmails,
    payload && payload.completed_by_emails,
    payload && payload.completerEmails,
    payload && payload.requestCompletedByEmails
  ]);
  directEmails.forEach(addUser);
  const items = Array.isArray(payload && payload.requestItems) ? payload.requestItems
    : (Array.isArray(payload && payload.items) ? payload.items
      : (Array.isArray(payload && payload.sourceRows) ? payload.sourceRows : []));
  items.forEach(function(item) {
    addUser(getRequestCompletionUserEntryFromItem_(item));
  });
  return users;
}

function buildRequestCompletedBySummary_(payload) {
  return collectRequestCompletionUsers_(payload).map(function(user) {
    if (user.display && user.username && normalizeRequestCompletionUsername_(user.display) !== user.username) return user.display + ' (' + user.username + ')';
    return user.display || user.username || user.email || '';
  }).filter(Boolean).join(', ');
}

function collectRequestRecipients_(payload) {
  const sendToAllSalesReps = payload && payload.sendToAllSalesReps === true;
  const repName = String(payload.repName || payload.salesRepName || payload.requestedBy || '').trim();
  const repEmail = sendToAllSalesReps ? '' : normalizeEmailAddress_(resolveRequestRecipientEmail_(repName, payload.repEmail || payload.salesRepEmail || ''));
  const emailType = String(payload && payload.emailType || '').trim().toLowerCase();
  const approvalStage = String(payload && (payload.approvalStage || payload.approval_stage) || '').trim().toLowerCase();
  const approvalType = String(payload && (payload.approvalType || payload.approval_type) || '').trim().toLowerCase().replace(/_/g, '-');
  const requestedByEmail = normalizeEmailAddress_(payload && (payload.requestedByEmail || payload.requested_by_email) || '');
  const approvalFallbackRecipients = [];
  if (emailType === 'ncr_approval' || emailType === 'hold_release_request') {
    if (approvalStage === 'jd') {
      approvalFallbackRecipients.push('dylan_collyge@greenleafnursery.com', 'jd_jones@greenleafnursery.com');
    } else if (approvalStage === 'inventory') {
      if (approvalType.indexOf('hold-release') !== -1 || approvalType.indexOf('hold') !== -1) {
        approvalFallbackRecipients.push('dylan_collyge@greenleafnursery.com');
      } else {
        approvalFallbackRecipients.push('dylan_collyge@greenleafnursery.com', 'jd_jones@greenleafnursery.com');
      }
    } else {
      approvalFallbackRecipients.push('dylan_collyge@greenleafnursery.com');
    }
  }
  const recipients = dedupeEmailAddresses_([
    payload.recipientEmails,
    payload.internalRecipients,
    payload.linkedRepEmails,
    payload.assistantEmails,
    payload.completedByEmails,
    payload.completed_by_emails,
    payload.completerEmails,
    payload.requestCompletedByEmails,
    collectRequestCompletionUsers_(payload).map(function(user) { return user.email; }),
    payload.recipients,
    payload.dylanEmail,
    payload.jdEmail,
    requestedByEmail,
    repEmail,
    approvalFallbackRecipients
  ]);

  return {
    repEmail: repEmail,
    toArray: recipients,
    toList: recipients.join(',')
  };
}

function splitFlyerAssigneeNames_(value) {
  if (Array.isArray(value)) {
    const names = [];
    value.forEach(function(entry) {
      splitFlyerAssigneeNames_(entry).forEach(function(name) { names.push(name); });
    });
    return names;
  }
  return String(value || '')
    .split(/[;,\n]+/)
    .map(function(entry) { return String(entry || '').trim(); })
    .filter(Boolean);
}

function collectFlyerCreatedRecipients_(payload) {
  const assigneeNames = splitFlyerAssigneeNames_([
    payload.assignedTo,
    payload.assigneeNames,
    payload.assigneeUsernames,
    payload.targetUsers,
    payload.recipients
  ]);
  const assigneeEmails = assigneeNames.map(function(name) {
    return resolveRequestRecipientEmail_(name, '');
  });
  const recipients = dedupeEmailAddresses_([
    payload.recipientEmails,
    payload.emailRecipients,
    assigneeEmails
  ]);
  return {
    assigneeNames: assigneeNames,
    toArray: recipients,
    toList: recipients.join(',')
  };
}

function buildFlyerCreatedItemsHtml_(items) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return '<p style="font-size: 12px; color: #777;">No row details were provided.</p>';
  return '<ul style="list-style:none; margin:0; padding:0;">' + safeItems.map(function(item) {
    const commonname = escapeEmailHtml_(item && (item.commonname || item.COMMONNAME || 'Unknown Item'));
    const contsize = escapeEmailHtml_(item && (item.contsize || item.CONTSIZE || '-'));
    const locationcode = escapeEmailHtml_(item && (item.locationcode || item.LOCATIONCODE || ''));
    const itemcode = escapeEmailHtml_(item && (item.itemcode || item.ITEMCODE || ''));
    const meta = [
      itemcode ? 'Item Code: ' + itemcode : '',
      locationcode ? 'Loc: ' + locationcode : ''
    ].filter(Boolean).join(' | ');
    return [
      '<li style="margin-bottom:12px; background:#f9fafb; padding:12px; border-left:4px solid #007a4d; border-radius:8px;">',
      '<strong>' + commonname + ' (' + contsize + ')</strong>',
      meta ? '<br><span style="font-size:12px; color:#475569;">' + meta + '</span>' : '',
      '</li>'
    ].join('');
  }).join('') + '</ul>';
}

function buildFlyerCreatedItemsText_(items) {
  const safeItems = Array.isArray(items) ? items : [];
  return safeItems.map(function(item) {
    return [
      String(item && (item.commonname || item.COMMONNAME || 'Unknown Item')) + ' (' + String(item && (item.contsize || item.CONTSIZE || '-')) + ')',
      String(item && (item.itemcode || item.ITEMCODE || '') ? 'Item Code: ' + (item.itemcode || item.ITEMCODE) : ''),
      String(item && (item.locationcode || item.LOCATIONCODE || '') ? 'Loc: ' + (item.locationcode || item.LOCATIONCODE) : '')
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function sendFlyerCreatedEmail_(payload) {
  const safePayload = payload || {};
  const recipients = collectFlyerCreatedRecipients_(safePayload);
  if (!recipients.toList) {
    return {
      ok: false,
      status: 400,
      mode: 'missing_recipients',
      message: 'No flyer assignee email recipients were found.'
    };
  }
  const folderName = String(safePayload.folderName || safePayload.folderId || 'Flyer Folder').trim();
  const assignedTo = String(safePayload.assignedTo || recipients.assigneeNames.join(', ') || 'Unassigned').trim();
  const createdBy = String(safePayload.createdBy || safePayload.requestedByDisplay || safePayload.requestedBy || 'GNC App').trim();
  const itemCount = Array.isArray(safePayload.items) ? safePayload.items.length : 0;
  const subject = 'GNC PH Flyer Created - ' + folderName;
  const itemsHtml = buildFlyerCreatedItemsHtml_(safePayload.items);
  const itemsText = buildFlyerCreatedItemsText_(safePayload.items);
  const textBody = [
    'Flyer Folder Created',
    'Folder: ' + folderName,
    'Assigned To: ' + assignedTo,
    'Created By: ' + createdBy,
    'Rows: ' + itemCount,
    String(safePayload.instructions || ''),
    itemsText
  ].filter(Boolean).join('\n\n');
  const htmlBody = [
    '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
    '<h2 style="color: #007a4d;">Flyer Folder Created</h2>',
    '<p><strong>Folder:</strong> ' + escapeEmailHtml_(folderName) + '</p>',
    '<p><strong>Assigned To:</strong> ' + escapeEmailHtml_(assignedTo) + '</p>',
    '<p><strong>Created By:</strong> ' + escapeEmailHtml_(createdBy) + '</p>',
    '<p><strong>Rows:</strong> ' + escapeEmailHtml_(itemCount) + '</p>',
    safePayload.instructions ? '<p style="font-size:12px; color:#64748b;">' + escapeEmailHtml_(safePayload.instructions) + '</p>' : '',
    '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
    itemsHtml,
    '</div>'
  ].join('');
  GmailApp.sendEmail(recipients.toList, subject, textBody, {
    htmlBody: htmlBody,
    name: 'GNC PH Flyer'
  });
  return {
    ok: true,
    status: 200,
    mode: 'sent',
    recipients: recipients.toArray,
    subject: subject
  };
}

function normalizeRequestEmailSubjectCustomer_(value) {
  const base = String(firstNonEmptyRequestValue_(value)).trim();
  if (!base) return 'Request';
  const normalized = base
    .replace(/\s*\|\s*/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || 'Request';
}

function formatRequestEmailSubjectDate_(value) {
  const candidate = firstNonEmptyRequestValue_(value);
  const parsed = candidate ? new Date(candidate) : new Date();
  const safeDate = parsed instanceof Date && !isNaN(parsed.getTime()) ? parsed : new Date();
  return Utilities.formatDate(safeDate, Session.getScriptTimeZone(), 'MM/dd/yyyy');
}

function buildDefaultRequestEmailSubject_(payload) {
  const customerLabel = normalizeRequestEmailSubjectCustomer_(
    firstNonEmptyRequestValue_(
      payload && payload.requestCustomer,
      payload && payload.request_customer,
      payload && payload.customer,
      payload && payload.req_customer,
      'Request'
    )
  );
  const dateLabel = formatRequestEmailSubjectDate_(
    firstNonEmptyRequestValue_(
      payload && payload.subjectDate,
      payload && payload.subject_date,
      payload && payload.initialEmailSentAt,
      payload && payload.initial_email_sent_at,
      ''
    )
  );
  return dateLabel ? customerLabel + ' ' + dateLabel : customerLabel;
}

function buildDefaultNcrEmailSubject_(payload) {
  const firstItem = payload && Array.isArray(payload.requestItems) && payload.requestItems.length ? payload.requestItems[0] || {} : {};
  const parts = [
    firstNonEmptyRequestValue_(payload && payload.commonname, payload && payload.commonName, firstItem && firstItem.commonname, firstItem && firstItem.COMMONNAME, ''),
    firstNonEmptyRequestValue_(payload && payload.contsize, payload && payload.contSize, firstItem && firstItem.contsize, firstItem && firstItem.CONTSIZE, ''),
    firstNonEmptyRequestValue_(payload && payload.locationcode, payload && payload.locationCode, firstItem && firstItem.locationcode, firstItem && firstItem.LOCATIONCODE, firstItem && firstItem.loc, '')
  ].map(function(value) {
    return String(value || '').trim();
  }).filter(Boolean);
  return parts.join(' ') || 'New Crop Release';
}

function buildRequestEmailSubject_(payload) {
  const customSubject = String(payload.subject || '').trim();
  if (customSubject) return customSubject;
  const safeType = String(payload && payload.emailType || '').trim().toLowerCase();
  return safeType === 'ncr_complete'
    ? buildDefaultNcrEmailSubject_(payload)
    : safeType === 'bloom_crop_update'
      ? 'GNC PH Crop Update'
    : buildDefaultRequestEmailSubject_(payload);
}

function normalizeRequestIdList_(ids) {
  return Array.isArray(ids)
    ? ids.map(function(id) { return String(id || '').trim(); }).filter(Boolean)
    : [];
}

function isArchivedRequestRow_(row) {
  const archivedRaw = firstNonEmptyRequestValue_(row && row.req_archived, row && row.REQ_ARCHIVED, false);
  const archivedText = String(archivedRaw == null ? '' : archivedRaw).trim().toLowerCase();
  return archivedRaw === true || archivedRaw === 1 || archivedRaw === '1' || archivedText === 'true';
}

function fetchRequestRowsForEmailFolder_(folderId) {
  const safeFolderId = String(folderId || '').trim();
  if (!safeFolderId) return [];
  const baseFields = 'unique_id,request_folder,req_customer,commonname,contsize,itemcode,req_qty,locationcode,av_note,req_spec,req_caliper,req_match,loc_match_qty,req_photo_link,req_photo_name,req_archived';
  const fieldsWithCompleter = baseFields + ',completed_by_username,completed_by_display,completed_by_email';
  let response = null;
  let status = 0;
  let bodyText = '';
  const loadRows = function(selectFields) {
    const url = `${SUPABASE_URL}/rest/v1/v2_active_request?select=${selectFields}&request_folder=eq.${encodeURIComponent(safeFolderId)}`;
    const result = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      }
    });
    return result;
  };
  response = loadRows(fieldsWithCompleter);
  status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
  bodyText = response && response.getContentText ? response.getContentText() : '';
  if (status < 200 || status >= 300) {
    const normalizedBody = String(bodyText || '').toLowerCase();
    if (normalizedBody.indexOf('completed_by_') !== -1 || normalizedBody.indexOf('column') !== -1) {
      response = loadRows(baseFields);
      status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
      bodyText = response && response.getContentText ? response.getContentText() : '';
    }
  }
  if (status < 200 || status >= 300) {
    console.error('[REQUEST EMAIL] Could not load request rows for delayed reply', {
      folderId: safeFolderId,
      status: status,
      body: bodyText
    });
    return [];
  }
  try {
    const parsed = JSON.parse(bodyText || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[REQUEST EMAIL] Could not parse delayed request rows', { folderId: safeFolderId, error: error && error.message ? error.message : error });
    return [];
  }
}

function buildRequestEmailItemsFromRows_(rows, payload) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const fallbackFolderId = String(firstNonEmptyRequestValue_(payload && payload.folderId, payload && payload.requestFolder, '')).trim();
  const fallbackCustomer = String(firstNonEmptyRequestValue_(payload && payload.customer, payload && payload.requestCustomer, '')).trim();
  return safeRows.map(function(item) {
    return {
      unique_id: firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, ''),
      folder: firstNonEmptyRequestValue_(item && item.request_folder, item && item.REQUEST_FOLDER, fallbackFolderId),
      customer: firstNonEmptyRequestValue_(item && item.req_customer, item && item.REQ_CUSTOMER, fallbackCustomer),
      commonname: firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, ''),
      contsize: firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, ''),
      itemcode: firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, ''),
      qty: firstNonEmptyRequestValue_(item && item.req_qty, item && item.REQ_QTY, ''),
      loc: firstNonEmptyRequestValue_(item && item.locationcode, item && item.LOCATIONCODE, ''),
      av_note: firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, ''),
      spec: firstNonEmptyRequestValue_(item && item.req_spec, item && item.REQ_SPEC, item && item.spec, item && item.SPEC, ''),
      caliper: firstNonEmptyRequestValue_(item && item.req_caliper, item && item.REQ_CALIPER, item && item.caliper, item && item.CALIPER, ''),
      match: firstNonEmptyRequestValue_(item && item.req_match, item && item.REQ_MATCH, item && item.match, item && item.MATCH, ''),
      loc_match_qty: firstNonEmptyRequestValue_(item && item.loc_match_qty, item && item.LOC_MATCH_QTY, ''),
      completed_by_username: firstNonEmptyRequestValue_(item && item.completed_by_username, item && item.COMPLETED_BY_USERNAME, ''),
      completed_by_display: firstNonEmptyRequestValue_(item && item.completed_by_display, item && item.COMPLETED_BY_DISPLAY, item && item.completed_by, item && item.COMPLETED_BY, ''),
      completed_by_email: firstNonEmptyRequestValue_(item && item.completed_by_email, item && item.COMPLETED_BY_EMAIL, ''),
      photo: firstNonEmptyRequestValue_(item && item.req_photo_link, item && item.REQ_PHOTO_LINK, item && item.photo_link, '')
    };
  }).filter(function(item) {
    return item.unique_id || item.commonname || item.itemcode;
  });
}

function hydrateQueuedRequestCompletePayload_(payload) {
  const safePayload = payload && typeof payload === 'object' ? JSON.parse(JSON.stringify(payload)) : {};
  const folderId = String(firstNonEmptyRequestValue_(safePayload.requestFolder, safePayload.folderId, '')).trim();
  const requestIds = normalizeRequestIdList_(safePayload.requestIds);
  const requestIdSet = new Set(requestIds);
  let rows = fetchRequestRowsForEmailFolder_(folderId).filter(function(row) {
    const rowId = String(firstNonEmptyRequestValue_(row && row.unique_id, row && row.UNIQUE_ID, '')).trim();
    if (!rowId) return false;
    if (requestIdSet.size && !requestIdSet.has(rowId)) return false;
    return !isArchivedRequestRow_(row);
  });
  if (requestIds.length) {
    const orderMap = new Map(requestIds.map(function(id, index) { return [id, index]; }));
    rows.sort(function(a, b) {
      const aId = String(firstNonEmptyRequestValue_(a && a.unique_id, a && a.UNIQUE_ID, '')).trim();
      const bId = String(firstNonEmptyRequestValue_(b && b.unique_id, b && b.UNIQUE_ID, '')).trim();
      return (orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER) - (orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER);
    });
  }
  delete safePayload.formattedItemsHtml;
  delete safePayload.formattedItemsText;
  safePayload.requestItems = buildRequestEmailItemsFromRows_(rows, safePayload);
  if (safePayload.requestItems.length) safePayload.itemsCount = safePayload.requestItems.length;
  return safePayload;
}

function buildRequestItemsHtml_(payload) {
  const formatted = String(payload.formattedItemsHtml || '').trim();
  if (formatted) return formatted;

  const items = Array.isArray(payload.requestItems) ? payload.requestItems
    : (Array.isArray(payload.items) ? payload.items
      : (Array.isArray(payload.sourceRows) ? payload.sourceRows : []));
  if (!items.length) return '';

  const rowsHtml = items.map(function(item) {
    const commonName = escapeEmailHtml_(item && item.commonname ? item.commonname : 'Unknown Item');
    const contSize = escapeEmailHtml_(item && item.contsize ? item.contsize : '-');
    const detailRowsHtml = buildRequestItemFieldRowsHtml_(item);
    const photoUrls = extractRequestPhotoUrls_(item && (item.photo || item.photo_link || item.photo_urls || ''));
    const photoHtml = photoUrls.map(function(url, index) {
      const safeUrl = escapeEmailAttribute_(url);
      const linkLabel = photoUrls.length > 1 ? 'Photo ' + (index + 1) : 'Photo';
      return [
        '<div style="margin-top:10px;">',
        '<div><strong>' + linkLabel + ':</strong> <a href="' + safeUrl + '">' + escapeEmailHtml_(url) + '</a></div>',
        '<div style="margin-top:6px;"><img src="' + safeUrl + '" alt="' + linkLabel + '" style="max-width:220px; max-height:220px; border-radius:8px; border:1px solid #ddd;"></div>',
        '</div>'
      ].join('');
    }).join('');
    return [
      '<li style="margin-bottom:12px; background:#f9f9f9; padding:10px; border-left:4px solid #007a4d;">',
      '<strong>' + commonName + ' (' + contSize + ')</strong><br>',
      detailRowsHtml,
      photoHtml,
      '</li>'
    ].join('');
  }).join('');

  return '<ul style="list-style:none; padding:0; margin:0;">' + rowsHtml + '</ul>';
}

function buildRequestItemsText_(payload) {
  const formatted = String(payload.formattedItemsText || '').trim();
  if (formatted) return formatted;

  const items = Array.isArray(payload.requestItems) ? payload.requestItems
    : (Array.isArray(payload.items) ? payload.items
      : (Array.isArray(payload.sourceRows) ? payload.sourceRows : []));
  if (!items.length) return '';

  return items.map(function(item) {
    const photoUrls = extractRequestPhotoUrls_(item && (item.photo || item.photo_link || item.photo_urls || ''));
    const detailText = buildRequestItemFieldRowsText_(item);
    const photoText = photoUrls.map(function(url, index) {
      return (photoUrls.length > 1 ? 'Photo ' + (index + 1) : 'Photo') + ': ' + url;
    }).join('\n');
    return [
      String(item && item.commonname ? item.commonname : 'Unknown Item') + ' (' + String(item && item.contsize ? item.contsize : '-') + ')',
      detailText,
      photoText
    ].filter(Boolean).join('\n');
  }).join('\n');
}

function getRequestSelectionSummaryGroups_(payload) {
  const items = Array.isArray(payload.requestItems) ? payload.requestItems
    : (Array.isArray(payload.items) ? payload.items
      : (Array.isArray(payload.sourceRows) ? payload.sourceRows : []));
  if (!items.length) return [];

  const groupsByKey = {};
  const order = [];

  items.forEach(function(item) {
    if (!item) return;
    const itemCode = String(firstNonEmptyRequestValue_(
      item.itemcode,
      item.ITEMCODE,
      item.itemCode,
      item.ITEM_CODE,
      ''
    ) || '').trim();
    const commonName = String(firstNonEmptyRequestValue_(
      item.commonname,
      item.COMMONNAME,
      item.commonName,
      item.COMMON_NAME,
      ''
    ) || '').trim();
    const contSize = String(firstNonEmptyRequestValue_(
      item.contsize,
      item.CONTSIZE,
      item.contSize,
      item.CONT_SIZE,
      ''
    ) || '').trim();
    if (!itemCode && !commonName && !contSize) return;

    const groupKey = itemCode
      ? 'ITEMCODE:' + itemCode.toUpperCase()
      : ['NOITEMCODE', commonName.toUpperCase(), contSize.toUpperCase()].join('|');

    if (!groupsByKey[groupKey]) {
      groupsByKey[groupKey] = {
        itemcode: itemCode || 'N/A',
        commonname: commonName || 'Unknown Item',
        contsize: contSize || '-',
        rowsSelected: 0
      };
      order.push(groupKey);
    }
    groupsByKey[groupKey].rowsSelected += 1;
  });

  return order.map(function(key) {
    return groupsByKey[key];
  });
}

function buildRequestSelectionSummaryHtml_(payload) {
  const groups = getRequestSelectionSummaryGroups_(payload);
  if (!groups.length) return '';

  const rowsHtml = groups.map(function(group) {
    return [
      '<tr>',
      '<td style="padding:8px; border-bottom:1px solid #eee;"><strong>' + escapeEmailHtml_(group.itemcode) + '</strong></td>',
      '<td style="padding:8px; border-bottom:1px solid #eee;">' + escapeEmailHtml_(group.commonname) + '</td>',
      '<td style="padding:8px; border-bottom:1px solid #eee;">' + escapeEmailHtml_(group.contsize) + '</td>',
      '<td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">' + escapeEmailHtml_(group.rowsSelected) + '</td>',
      '</tr>'
    ].join('');
  }).join('');

  return [
    '<div style="margin:18px 0;">',
    '<p style="font-weight:700; margin:0 0 10px 0;">Selected Request Rows</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; font-size:13px;">',
    '<thead>',
    '<tr style="background:#f3f7f5;">',
    '<th align="left" style="padding:8px; border-bottom:1px solid #ddd;">ITEMCODE</th>',
    '<th align="left" style="padding:8px; border-bottom:1px solid #ddd;">COMMONNAME</th>',
    '<th align="left" style="padding:8px; border-bottom:1px solid #ddd;">CONTSIZE</th>',
    '<th align="center" style="padding:8px; border-bottom:1px solid #ddd;">ROWS SELECTED</th>',
    '</tr>',
    '</thead>',
    '<tbody>',
    rowsHtml,
    '</tbody>',
    '</table>',
    '</div>'
  ].join('');
}

function buildRequestSelectionSummaryText_(payload) {
  const groups = getRequestSelectionSummaryGroups_(payload);
  if (!groups.length) return '';

  return [
    'Selected Request Rows',
    groups.map(function(group) {
      return [
        'ITEMCODE: ' + group.itemcode,
        'COMMONNAME: ' + group.commonname,
        'CONTSIZE: ' + group.contsize,
        'Rows Selected For Itemcode: ' + group.rowsSelected
      ].join('\n');
    }).join('\n\n')
  ].join('\n\n');
}

function buildRequestEmailMessage_(payload) {
  const emailType = String(payload.emailType || '').trim().toLowerCase();
  const repName = escapeEmailHtml_(payload.repName || payload.salesRepName || '');
  const customer = escapeEmailHtml_(payload.customer || 'N/A');
  const folderId = escapeEmailHtml_(payload.folderId || payload.requestFolder || '');
  const itemsCount = escapeEmailHtml_(payload.itemsCount || 0);
  const itemsHtml = buildRequestItemsHtml_(payload);
  const itemsText = buildRequestItemsText_(payload);
  const selectionSummaryHtml = buildRequestSelectionSummaryHtml_(payload);
  const selectionSummaryText = buildRequestSelectionSummaryText_(payload);
  const subject = buildRequestEmailSubject_(payload);

  if (emailType === 'new_request') {
    return {
      subject: subject,
      textBody: [
        'New Plant Request Submitted',
        'Rep: ' + String(payload.repName || payload.salesRepName || ''),
        'Customer: ' + String(payload.customer || 'N/A'),
        'Folder ID: ' + String(payload.folderId || payload.requestFolder || ''),
        'Items Requested: ' + String(payload.itemsCount || 0),
        selectionSummaryText,
        'Please check the app under Requests > Pending to fulfill this request.'
      ].filter(Boolean).join('\n\n'),
      htmlBody: [
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">New Plant Request Submitted</h2>',
        '<p><strong>Rep:</strong> ' + repName + '</p>',
        '<p><strong>Customer:</strong> ' + customer + '</p>',
        '<p><strong>Folder ID:</strong> ' + folderId + '</p>',
        '<p><strong>Items Requested:</strong> ' + itemsCount + '</p>',
        selectionSummaryHtml,
        '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
        '<p style="font-size: 12px; color: #777;">Please check the app under <strong>Requests &gt; Pending</strong> to fulfill this request.</p>',
        '</div>'
      ].join('')
    };
  }

  if (emailType === 'request_complete') {
    const folderNote = String(payload.folderNote || '').trim();
    const folderNoteHtml = folderNote ? '<p><strong>Folder Note:</strong> ' + escapeEmailHtml_(folderNote) + '</p>' : '';
    const completedBySummary = buildRequestCompletedBySummary_(payload);
    const completedBySummaryHtml = completedBySummary ? '<p><strong>Completed By:</strong> ' + escapeEmailHtml_(completedBySummary) + '</p>' : '';
    const detailSection = itemsHtml
      ? [
          '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
          folderNoteHtml,
          completedBySummaryHtml,
          '<p style="font-weight:700; margin-bottom:12px;">Completed Items</p>',
          itemsHtml
        ].join('')
      : [
          '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
          folderNoteHtml,
          completedBySummaryHtml,
          '<p style="font-size: 12px; color: #777;">Please log into the app, go to <strong>Requests &gt; Sales Reps</strong> to Approve or Reject these items.</p>'
        ].join('');

    return {
      subject: subject,
      textBody: [
        'Plant Request Completed!',
        'Hello ' + String(payload.repName || payload.salesRepName || '') + ',',
        'Your recent plant request has been fully processed and marked as complete.',
        'Customer: ' + String(payload.customer || ''),
        'Folder ID: ' + String(payload.folderId || payload.requestFolder || ''),
        'Total Items Fulfilled: ' + String(payload.itemsCount || 0),
        folderNote ? 'Folder Note: ' + folderNote : '',
        completedBySummary ? 'Completed By: ' + completedBySummary : '',
        itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: [
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">Plant Request Completed!</h2>',
        '<p>Hello ' + repName + ',</p>',
        '<p>Your recent plant request has been fully processed and marked as complete.</p>',
        '<p><strong>Customer:</strong> ' + customer + '</p>',
        '<p><strong>Folder ID:</strong> ' + folderId + '</p>',
        '<p><strong>Total Items Fulfilled:</strong> ' + itemsCount + '</p>',
        detailSection,
        '</div>'
      ].join('')
    };
  }

  if (emailType === 'drive_customer_outreach') {
    const brandLabelPlain = String(payload.brandLabel || payload.fromName || payload.emailDisplayName || 'GNC PH Reserves').trim() || 'GNC PH Reserves';
    const brandLabel = escapeEmailHtml_(brandLabelPlain);
    const audienceLabel = escapeEmailHtml_(payload.audienceLabel || payload.audience || payload.repName || payload.salesRepName || '');
    const plainAudienceLabel = String(payload.audienceLabel || payload.audience || payload.repName || payload.salesRepName || '').trim();
    const commonName = escapeEmailHtml_(payload.commonname || payload.commonName || 'Item');
    const itemCode = escapeEmailHtml_(payload.itemcode || payload.itemCode || '');
    const season = escapeEmailHtml_(payload.season || '');
    const hideItemHeader = payload.hideItemHeader === true;
    const plainItem = [
      String(payload.commonname || payload.commonName || 'Item'),
      String(payload.itemcode || payload.itemCode || ''),
      String(payload.season || '')
    ].map(function(value) { return value.trim(); }).filter(Boolean).join(' ');
    const htmlItem = [commonName, itemCode, season].filter(Boolean).join(' &bull; ');
    const detailSection = itemsHtml
      ? [
          '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
          itemsHtml
        ].join('')
      : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">No selected customer/source row details were provided.</p>';

    return {
      subject: subject,
      textBody: [
        brandLabelPlain,
        plainAudienceLabel ? 'Hello ' + plainAudienceLabel + ',' : '',
        hideItemHeader ? '' : 'Item: ' + plainItem,
        itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: [
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + brandLabel + '</h2>',
        audienceLabel ? '<p>Hello ' + audienceLabel + ',</p>' : '',
        hideItemHeader ? '' : '<p><strong>Item:</strong> ' + htmlItem + '</p>',
        detailSection,
        '</div>'
      ].join('')
    };
  }

  if (emailType === 'bloom_crop_update') {
    const brandLabelPlain = String(payload.brandLabel || payload.fromName || payload.emailDisplayName || 'GNC PH Crop Update').trim() || 'GNC PH Crop Update';
    const brandLabel = escapeEmailHtml_(brandLabelPlain);
    const userMessage = String(payload.message || payload.userMessage || '').trim();
    const requestedBy = String(payload.requestedByDisplay || payload.requestedBy || '').trim();
    const requestedByHtml = requestedBy ? '<p><strong>Sent By:</strong> ' + escapeEmailHtml_(requestedBy) + '</p>' : '';
    const cropItemsHtml = String(itemsHtml || '')
      .replace(/<div[^>]*>\s*Bloom Picker Rows\s*<\/div>/gi, '')
      .replace(/<div>\s*<strong>\s*LOC MATCH %:\s*<\/strong>[^<]*<\/div>/gi, '');
    const cropItemsText = String(itemsText || '').split(/\r?\n/).filter(function(line) {
      const normalizedLine = String(line || '').trim().toLowerCase();
      return normalizedLine !== 'bloom picker rows' && normalizedLine !== 'bloom picker row' && normalizedLine.indexOf('loc match %:') !== 0;
    }).join('\n').trim();
    const messageHtml = userMessage
      ? [
          '<div style="white-space:pre-wrap; margin:16px 0 20px; padding:14px 16px; background:#f0fdf4; border-left:4px solid #007a4d; border-radius:8px; font-size:14px; line-height:1.45;">',
          escapeEmailHtml_(userMessage),
          '</div>'
        ].join('')
      : '';
    const detailSection = cropItemsHtml
      ? [
          '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
          cropItemsHtml
        ].join('')
      : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">No row details were provided.</p>';

    return {
      subject: subject,
      textBody: [
        brandLabelPlain,
        requestedBy ? 'Sent By: ' + requestedBy : '',
        userMessage,
        cropItemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: [
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + brandLabel + '</h2>',
        requestedByHtml,
        messageHtml,
        detailSection,
        '</div>'
      ].join('')
    };
  }

  if (emailType === 'ncr_complete') {
    const completedBy = escapeEmailHtml_(payload.completedBy || payload.completed_by || 'Unknown');
    const detailSection = itemsHtml
      ? [
          '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
          '<p style="font-weight:700; margin-bottom:12px;">Captured NCR Details</p>',
          itemsHtml
        ].join('')
      : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">No NCR row details were provided.</p>';

    return {
      subject: subject,
      textBody: [
        'PH NCR Review Completed',
        'Completed By: ' + String(payload.completedBy || payload.completed_by || 'Unknown'),
        'Source Row: ' + String(payload.folderId || payload.requestFolder || ''),
        itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: [
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">PH NCR Review Completed</h2>',
        '<p><strong>Completed By:</strong> ' + completedBy + '</p>',
        '<p><strong>Source Row:</strong> ' + folderId + '</p>',
        detailSection,
        '</div>'
      ].join('')
    };
  }

  if (emailType === 'ncr_approval' || emailType === 'hold_release_request') {
    const approvalTitleText = String(payload.approvalLabel || payload.approval_label || payload.customer || (emailType === 'hold_release_request' ? 'Take Off Hold' : 'Approval')).trim();
    const approvalTitle = escapeEmailHtml_(approvalTitleText);
    const approvalStage = escapeEmailHtml_(payload.approvalStageLabel || payload.approvalStage || 'Approval needed');
    const completedBy = escapeEmailHtml_(payload.completedBy || payload.completed_by || 'Unknown');
    const appInstructionText = String(payload.appInstruction || payload.app_instruction || '').trim();
    const appInstructionHtml = appInstructionText
      ? '<p style="padding:12px 14px; border-radius:10px; background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46;"><strong>Next step:</strong> ' + escapeEmailHtml_(appInstructionText) + '</p>'
      : '';
    const detailSection = itemsHtml
      ? [
          '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
          '<p style="font-weight:700; margin-bottom:12px;">Approval Row Details</p>',
          itemsHtml
        ].join('')
      : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">No approval row details were provided.</p>';

    return {
      subject: subject,
      textBody: [
        approvalTitleText + ' Approval',
        'Stage: ' + String(payload.approvalStageLabel || payload.approvalStage || 'Approval needed'),
        appInstructionText ? 'Next step: ' + appInstructionText : '',
        'Sent By: ' + String(payload.completedBy || payload.completed_by || 'Unknown'),
        'Source Row: ' + String(payload.folderId || payload.requestFolder || ''),
        itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: [
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + approvalTitle + ' Approval</h2>',
        '<p><strong>Stage:</strong> ' + approvalStage + '</p>',
        appInstructionHtml,
        '<p><strong>Sent By:</strong> ' + completedBy + '</p>',
        '<p><strong>Source Row:</strong> ' + folderId + '</p>',
        detailSection,
        '</div>'
      ].join('')
    };
  }

  throw new Error('Unsupported request email type: ' + emailType);
}

function isGmailAdvancedServiceAvailable_() {
  return typeof Gmail !== 'undefined' &&
    Gmail &&
    Gmail.Users &&
    Gmail.Users.Messages &&
    typeof Gmail.Users.Messages.send === 'function';
}

function base64UrlEncode_(value) {
  return Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8);
}

function formatMimeMailbox_(displayName, email) {
  const safeEmail = String(email || '').trim();
  const safeName = String(displayName || '').trim();
  if (safeName && safeEmail) {
    return '"' + safeName.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '" <' + safeEmail + '>';
  }
  return safeEmail || safeName;
}

function resolveAutomatedEmailSenderAddress_() {
  const activeEmail = normalizeEmailAddress_(Session.getActiveUser().getEmail());
  if (activeEmail) return activeEmail;
  const effectiveEmail = normalizeEmailAddress_(Session.getEffectiveUser().getEmail());
  if (effectiveEmail) return effectiveEmail;
  try {
    const aliases = GmailApp.getAliases();
    if (aliases && aliases.length) {
      const firstAlias = normalizeEmailAddress_(aliases[0]);
      if (firstAlias) return firstAlias;
    }
  } catch (error) {}
  return '';
}

function buildMimeEmail_(options) {
  const boundary = 'gnc_' + Utilities.getUuid().replace(/-/g, '');
  const lines = [
    'MIME-Version: 1.0',
    'To: ' + String(options.toList || '')
  ];
  const fromHeader = formatMimeMailbox_(options.fromName, options.fromAddress);
  if (fromHeader) lines.push('From: ' + fromHeader);
  lines.push('Subject: ' + String(options.subject || ''));
  lines.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');

  const inReplyTo = String(options.inReplyTo || '').trim();
  const references = String(options.references || '').trim();
  if (inReplyTo) lines.push('In-Reply-To: ' + inReplyTo);
  if (references) lines.push('References: ' + references);

  lines.push('');
  lines.push('--' + boundary);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('');
  lines.push(String(options.textBody || ''));
  lines.push('');
  lines.push('--' + boundary);
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('');
  lines.push(String(options.htmlBody || ''));
  lines.push('');
  lines.push('--' + boundary + '--');

  return lines.join('\r\n');
}

function extractGmailMessageHeader_(message, headerName) {
  const target = String(headerName || '').trim().toLowerCase();
  const headers = message && message.payload && Array.isArray(message.payload.headers) ? message.payload.headers : [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i] || {};
    if (String(header.name || '').trim().toLowerCase() === target) {
      return String(header.value || '').trim();
    }
  }
  return '';
}

function sendGmailApiMessage_(options) {
  const request = {
    raw: base64UrlEncode_(buildMimeEmail_(options))
  };
  if (options.threadId) request.threadId = String(options.threadId).trim();

  const sent = Gmail.Users.Messages.send(request, 'me');
  const sentId = String((sent && sent.id) || '').trim();
  const threadId = String((sent && sent.threadId) || options.threadId || '').trim();
  let internetMessageId = '';

  if (sentId) {
    try {
      const metadata = Gmail.Users.Messages.get('me', sentId, {
        format: 'metadata',
        metadataHeaders: ['Message-ID']
      });
      internetMessageId = extractGmailMessageHeader_(metadata, 'Message-ID');
    } catch (error) {}
  }

  return {
    ok: true,
    status: 200,
    threadId: threadId,
    messageId: internetMessageId || sentId,
    gmailMessageId: sentId,
    recipients: options.toArray || [],
    mode: threadId ? 'gmail_api_threaded' : 'gmail_api'
  };
}

function sendRequestEmailWithFallback_(payload) {
  const recipients = collectRequestRecipients_(payload);
  if (!recipients.toArray.length) {
    return {
      ok: false,
      status: 400,
      message: 'No valid request email recipients were resolved.',
      recipients: []
    };
  }

  const message = buildRequestEmailMessage_(payload);
  const safeType = String(payload.emailType || '').trim().toLowerCase();
  if (safeType === 'ncr_complete') {
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, {
        htmlBody: message.htmlBody,
        name: 'GNC PH NCR'
      });
      return {
        ok: true,
        status: 200,
        recipients: recipients.toArray,
        mode: 'gmailapp_named'
      };
    } catch (error) {
      console.error('NCR email send failed', error);
      return {
        ok: false,
        status: 500,
        recipients: recipients.toArray,
        mode: 'gmailapp_error',
        message: error && error.message ? error.message : 'NCR email send failed.'
      };
    }
  }
  if (safeType === 'bloom_crop_update') {
    const bloomCropUpdateName = String(payload.fromName || payload.brandLabel || payload.emailDisplayName || 'GNC PH Crop Update').trim() || 'GNC PH Crop Update';
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, {
        htmlBody: message.htmlBody,
        name: bloomCropUpdateName
      });
      return {
        ok: true,
        status: 200,
        recipients: recipients.toArray,
        mode: 'gmailapp_named'
      };
    } catch (error) {
      console.error('Bloom crop update email send failed', error);
      return {
        ok: false,
        status: 500,
        recipients: recipients.toArray,
        mode: 'gmailapp_error',
        message: error && error.message ? error.message : 'Bloom crop update email send failed.'
      };
    }
  }
  if (safeType === 'ncr_approval' || safeType === 'hold_release_request') {
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, {
        htmlBody: message.htmlBody,
        name: 'GNC PH Approvals'
      });
      return {
        ok: true,
        status: 200,
        recipients: recipients.toArray,
        mode: 'gmailapp_named'
      };
    } catch (error) {
      console.error('Approval email send failed', error);
      return {
        ok: false,
        status: 500,
        recipients: recipients.toArray,
        mode: 'gmailapp_error',
        message: error && error.message ? error.message : 'Approval email send failed.'
      };
    }
  }
  if (safeType === 'drive_customer_outreach') {
    const driveOutreachName = String(payload.fromName || payload.brandLabel || payload.emailDisplayName || 'GNC PH Reserves').trim() || 'GNC PH Reserves';
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, {
        htmlBody: message.htmlBody,
        name: driveOutreachName
      });
      return {
        ok: true,
        status: 200,
        recipients: recipients.toArray,
        mode: 'gmailapp_named'
      };
    } catch (error) {
      console.error('Drive customer outreach email send failed', error);
      return {
        ok: false,
        status: 500,
        recipients: recipients.toArray,
        mode: 'gmailapp_error',
        message: error && error.message ? error.message : 'Drive customer outreach email send failed.'
      };
    }
  }
  const wantsThreadReply = safeType === 'request_complete';
  const threadId = String(payload.threadId || '').trim();
  const inReplyTo = String(payload.messageId || '').trim();
  const senderAddress = resolveAutomatedEmailSenderAddress_();
  const canReplyInThread = !!(threadId && inReplyTo);

  if (!isGmailAdvancedServiceAvailable_()) {
    return {
      ok: false,
      status: 500,
      recipients: recipients.toArray,
      mode: 'gmail_api_unavailable',
      message: 'Gmail Advanced Service is required for request emails but is not available in this Apps Script deployment.'
    };
  }

  try {
    const result = sendGmailApiMessage_({
      toList: recipients.toList,
      toArray: recipients.toArray,
      subject: message.subject,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      fromName: 'GNC PH Request',
      fromAddress: senderAddress,
      threadId: wantsThreadReply && canReplyInThread ? threadId : '',
      inReplyTo: wantsThreadReply && canReplyInThread ? inReplyTo : '',
      references: wantsThreadReply && canReplyInThread ? inReplyTo : ''
    });
    if (wantsThreadReply && !canReplyInThread) {
      result.mode = 'gmail_api_fresh_completion';
      result.message = 'Request completion email sent as a fresh email because the original thread metadata was unavailable.';
    }
    return result;
  } catch (error) {
    console.error('Gmail API send failed for request email', error);
    return {
      ok: false,
      status: 500,
      recipients: recipients.toArray,
      mode: 'gmail_api_error',
      message: error && error.message ? error.message : 'Request email send failed.'
    };
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    
    if (payload.type === 'manual_run') {
      const runInline = payload.run_inline === true || payload.runInline === true || payload.fast === true;
      const result = queueManualSyncRequest_({
        job: payload.job || 'all',
        source: payload.trigger || 'webhook',
        requestedBy: payload.requested_by || payload.requestedBy || 'Unknown',
        deferStart: !runInline
      });
      if (runInline && result && result.status === 'queued') {
        runQueuedManualSyncStage_({
          executionBudgetMs: 330000,
          nextStageStartCutoffMs: 300000
        });
        const finalStatus = getManualSyncStatusForClient_();
        return jsonOutput_(finalStatus || result);
      }
      return jsonOutput_(result);
    }

    if (payload.type === 'manual_status') {
      const status = getManualSyncStatusForClient_();
      return jsonOutput_(status || {
        active: false,
        currentStage: '',
        currentStageLabel: '',
        stageIndex: 0,
        stageOrder: [],
        completedStages: [],
        stageResults: [],
        message: 'No manual sync is queued or running.',
        error: '',
        startedAt: '',
        updatedAt: '',
        finishedAt: ''
      });
    }
    
    if (payload.type === "email") {
    if (payload.emailType === "new_request" || payload.emailType === "request_complete" || payload.emailType === "ncr_complete" || payload.emailType === "ncr_approval" || payload.emailType === "hold_release_request" || payload.emailType === "drive_customer_outreach" || payload.emailType === "bloom_crop_update") {
      const emailType = String(payload.emailType || '').trim().toLowerCase();
      const shouldQueueDelayedReply = emailType === 'request_complete' && Math.max(0, Number(payload.delayMs) || 0) > 0;
      if (shouldQueueDelayedReply) {
        return jsonOutput_(enqueueDelayedRequestEmail_(payload));
      }
      return jsonOutput_(sendRequestEmailWithFallback_(payload));
    }
    if (payload.emailType === "flyer_created") {
      return jsonOutput_(sendFlyerCreatedEmail_(payload));
    }

      let subject = "", htmlBody = "", recipient = "", textBody = "";

      if (payload.emailType === "request_rep_reviewed") {
        recipient = payload.dylanEmail;
        subject = `GNC PARK HILL: Request Fully Reviewed & Approved (${payload.folderId})`;
        
        let rowsHtml = payload.approvedItems.map(item => {
            let imgHtml = item.photo ? `<br><img src="${item.photo.split(',')[0].trim()}" style="max-height:100px; border-radius:8px; margin-top:5px;">` : '';
            return `<li style="margin-bottom:15px; background:#f9f9f9; padding:10px; border-left:4px solid #007a4d;">
                      <strong>${item.commonname} (${item.contsize})</strong><br>
                      Item Code: ${item.itemcode} | Loc: ${item.loc}<br>
                      Qty Requested: ${item.qty}
                      ${imgHtml}
                    </li>`;
        }).join('');
        
        if(payload.approvedItems.length === 0) { rowsHtml = "<p><em>No items were approved. All were rejected.</em></p>"; }
        
        htmlBody = `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #007a4d;">Request Reviewed by Sales Rep</h2>
            <p><strong>Rep:</strong> ${payload.repName}</p>
            <p><strong>Customer:</strong> ${payload.customer}</p>
            <p><strong>Folder ID:</strong> ${payload.folderId}</p>
            <p>The rep has finished reviewing the completed request. Here are the items they <strong>Approved</strong>:</p>
            <ul style="list-style:none; padding:0;">${rowsHtml}</ul>
          </div>
        `;
        textBody = subject;
      }

      if (recipient) {
        GmailApp.sendEmail(recipient, subject, textBody || subject, { htmlBody: htmlBody, name: "GNC PARK HILL" });
        return ContentService.createTextOutput(JSON.stringify({ ok: true, status: "success" })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          ok: false,
          status: "error",
          message: "Unsupported email type or missing recipient."
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    else if (payload.type === "image") {
      let photoFolderId = '1MSXvqpKI0g0vgVdK2hazQ2BG2LPgCcGn'; 
      const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"); 
      let subfolder;
      
      if (payload.folderContext === 'docks') {
          photoFolderId = '1bCpAfapXBDhTuhqBiT_oFl7NeImNbYCX'; 
          let parentFolder = DriveApp.getFolderById(photoFolderId); 
          let dockFolderName = "Dock " + payload.dockNum;
          let dockFolders = parentFolder.getFoldersByName(dockFolderName); 
          let dockFolder = dockFolders.hasNext() ? dockFolders.next() : parentFolder.createFolder(dockFolderName);
          let folderName = payload.customFolderName || "Unassigned"; 
          let customFolders = dockFolder.getFoldersByName(folderName);
          subfolder = customFolders.hasNext() ? customFolders.next() : dockFolder.createFolder(folderName);
      } else {
          if (payload.folderContext === 'season') photoFolderId = '1019IrWjqrFGrQr7VvH6xyS5x_DqTijTo'; 
          else if (payload.folderContext === 'location') photoFolderId = '1sAYKp4Bm26XNJtMI_Xkhp3IFsvlCrtJ_'; 
          else if (payload.folderContext === 'request') photoFolderId = '1NLErB4AyYSFp3_SC44-SM-wMlRXW7FZr';
          
          let parentFolder = DriveApp.getFolderById(photoFolderId); 
          let subfoldersList = parentFolder.getFoldersByName(dateStr); 
          subfolder = subfoldersList.hasNext() ? subfoldersList.next() : parentFolder.createFolder(dateStr);
      }
      
      const blob = Utilities.newBlob(Utilities.base64Decode(payload.image), payload.mimeType, payload.filename);
      const file = subfolder.createFile(blob); 
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", url: file.getUrl() })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) { 
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      status: "error",
      message: err && err.message ? err.message : String(err)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
