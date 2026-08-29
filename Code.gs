// =========================================================================
// GNC PARK HILL - COMMAND 001 BACKEND ENGINE (DELTA SYNC) - HIGH PERFORMANCE
// =========================================================================

// ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ 1. RUN THIS ONCE TO CLEAR GOOGLE'S SECURITY WALL
function triggerPermissions() { 
  DriveApp.getRootFolder(); 
  GmailApp.getAliases(); 
  console.log("Permissions cleared! You are good to go."); 
}

// ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ 2. RUN THIS ONCE TO SETUP THE 7:30 AM DAILY ALARM
function setupHoursReminderTrigger() {
  let triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendHoursReminderEmail') { 
      ScriptApp.deleteTrigger(triggers[i]); 
    }
  }
  ScriptApp.newTrigger('sendHoursReminderEmail')
    .timeBased().everyDays(1).atHour(7).create();
  console.log("ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â° Daily 7:30 AM reminder trigger established!");
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

function setupDropFolderAutoSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === AUTO_DROP_FOLDER_SYNC_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger(AUTO_DROP_FOLDER_SYNC_TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(5)
    .create();
  console.log('Auto sync trigger established. Drop folders will be checked about every 5 minutes.');
}

function removeDropFolderAutoSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === AUTO_DROP_FOLDER_SYNC_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  console.log('Auto sync trigger removed.');
}

function runAutoDropFolderSync_() {
  try {
    runRequestIntegrityScheduledWorker_();
  } catch (workerError) {
    console.error('[REQUEST INTEGRITY] Scheduled worker failed: ' + (workerError && workerError.message ? workerError.message : workerError));
  }
  const requestedBy = Session.getEffectiveUser().getEmail() || 'Apps Script Auto Sync';
  return queueManualSyncRequest_({
    job: 'all',
    source: 'auto_trigger',
    requestedBy: requestedBy
  });
}

// =========================================================================
// SUPABASE CONSTANTS & FOLDERS
// =========================================================================
function resolveSupabaseServiceRoleKey_(sourceFallbackKey) {
  try {
    const props = PropertiesService.getScriptProperties();
    const propertyKey = String(
      props.getProperty('SUPABASE_SERVICE_ROLE_KEY') ||
      props.getProperty('SUPABASE_KEY') ||
      props.getProperty('SUPABASE_API_KEY') ||
      props.getProperty('SUPABASE_SERVICE_KEY') ||
      ''
    ).trim();
    if (propertyKey) return propertyKey;
  } catch (err) {
    console.warn('[SUPABASE] Could not read script properties for service role key: ' + (err && err.message ? err.message : err));
  }
  const fallbackKey = String(sourceFallbackKey || '').trim();
  return fallbackKey && fallbackKey !== '__SUPABASE_SERVICE_ROLE_KEY__' ? fallbackKey : '';
}

const SUPABASE_URL = 'https://kzrnyjsosryejjejliii.supabase.co';
const SUPABASE_KEY = resolveSupabaseServiceRoleKey_('__SUPABASE_SERVICE_ROLE_KEY__');
const REQUEST_DELIVERY_RECEIPT_PREFIX = 'REQ_DELIVERY_RECEIPT_V1_';
const RECLASS_BACKGROUND_DELIVERY_ENABLED_ = true;
const RECLASS_DELIVERY_EVENT_TYPE_ = 'reclass_inquiry';
const EVAL_WORK_ASSIGNMENT_EVENT_TYPE_ = 'eval_work_assignment';
const EVAL_WORK_COMPLETION_EVENT_TYPE_ = 'eval_work_completion';

function getSupabaseHeadersForKey_(key, extraHeaders) {
  const headers = Object.assign({}, extraHeaders || {});
  const safeKey = String(key || '').trim();
  if (safeKey) {
    headers.apikey = safeKey;
    const modernSecretKey = /^sb_(secret|publishable)_/i.test(safeKey);
    if (!modernSecretKey) {
      headers.Authorization = 'Bearer ' + safeKey;
    }
  }
  return headers;
}

function getSupabaseHeaders_(extraHeaders) {
  return getSupabaseHeadersForKey_(SUPABASE_KEY, extraHeaders);
}

const APP_LIVE_EVENTS_TABLE = 'ph_app_live_events';
const INVENTORY_TRANSACTION_TABLE = 'ph_inventory_transactions';
const EMIT_APP_LIVE_EVENTS = true;
const DRIVE_AROUND_HISTORY_TABLE = 'ph_drive_around_report_files';
const DRIVE_AROUND_HISTORY_ROW_TABLE = 'ph_drive_around_report_rows';
const HOLD_STOP_ITEMCODE_SUMMARY_TABLE = 'ph_hold_stop_itemcode_summaries';
const HOLD_STOP_LEARNING_REFRESH_RPC = 'ph_start_hold_learning_refresh_chunked';
const DRIVE_AROUND_HISTORY_FOLDER_ID = '1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA';
const DRIVE_AROUND_HISTORY_MAX_FILES_PER_RUN = 2500;
const DRIVE_AROUND_HISTORY_MAX_PARSED_FILES_PER_RUN = 5;
const DRIVE_AROUND_HISTORY_PENDING_FETCH_LIMIT = 1000;
const DRIVE_AROUND_HISTORY_WORKSPACE_RUN_BUDGET_MS = 27 * 60 * 1000;
const DRIVE_AROUND_HISTORY_BACKFILL_RUN_BUDGET_MS = 4 * 60 * 1000;
const DRIVE_AROUND_HISTORY_FLUSH_ROW_THRESHOLD = 10000;
const DRIVE_AROUND_HISTORY_SUPPORTED_EXTENSIONS = Object.freeze(['.csv', '.xls', '.xlsx']);
const DRIVE_AROUND_HISTORY_SOURCE_SCHEMA_VERSION = 1;
const DRIVE_AROUND_HISTORY_REPORT_COLUMN_SPECS = Object.freeze([
  ['warehousei', ['warehousei', 'warehouseid']],
  ['plantgroupcode'], ['itemcode'], ['qualitycode'], ['contsize'], ['commonname'],
  ['lotcode'], ['locationcode'], ['source'], ['desigitem'], ['desigcust'], ['desigloc'],
  ['priority'], ['ptronhand'], ['ptrreviewed'], ['ptravailable'], ['holdstopcode'],
  ['holdstopbegindate'], ['holdstopreason'], ['hsreasonbegin', ['hsreasonbegin', 'hrsseasonbegin']],
  ['season_supply', ['season_supply', 'seasonsupply']], ['season_oh'], ['season_demand'],
  ['s_lts'], ['oversellpercentage'], ['itemspec'], ['locationnote'], ['locationnotedate'],
  ['suspend'], ['suspendto', ['suspendto', 'suspend_to']], ['specialpuller'],
  ['pulltagnote1'], ['pulltagnote2'], ['fieldtagcolor', ['fieldtagcolor', 'field_tag_color']],
  ['salesnote'], ['inventorynote'], ['locationptn1'], ['locationptn2'], ['prisetby'],
  ['priupdated'], ['bypassloc'], ['largeptrqty'], ['maxorderquantity'], ['lochold'],
  ['listprice'], ['ext_ptronhand'], ['varietycode'], ['genusname', ['genusname', 'genus']],
  ['botanicalname'], ['reversecommon'], ['sortnamevariety'], ['containersort'],
  ['saleyear', ['saleyear', 'salesyear']], ['season'], ['blockalpha'], ['blocknumber'],
  ['bay'], ['pullerresponsibility'], ['grower'], ['si_lts'], ['a_lts'], ['ai_lts'],
  ['season_available'], ['holdstopenddate'], ['salesnote_1'], ['fnsalesnote'],
  ['warehousename'], ['mcstatus'], ['hz'], ['intercopo'], ['insurancegroup'], ['brand'],
  ['printedcontainercode'], ['salesnotebegindate'], ['equiv_unit'], ['ext_equiv_unit']
]);
const DRIVE_AROUND_CANONICAL_TIMEZONE = 'America/Chicago';
const DRIVE_AROUND_CANONICAL_PREVIEW_LIMIT = 1000;
const DRIVE_AROUND_CANONICAL_APPLY_LIMIT = 75;
const DRIVE_AROUND_CANONICAL_NAME_PATTERN = /^(20\d{2}-\d{2}-\d{2})\s+(\d{2,})(?:\.[^.]+)?$/i;
const DRIVE_AROUND_MACHINE_NAME_PATTERN = /^drivearoundmc\b/i;
const DRIVE_AROUND_HISTORY_BACKFILL_TRIGGER_HANDLER = 'runDriveAroundHistoryBackfillChunk_';
const DRIVE_AROUND_HISTORY_BACKFILL_HOUR = 2;
const GOOGLE_SHEETS_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
const WAREHOUSE_ASSIGNED_ITEMS_TABLE = 'ph_warehouse_assigned_items';
// Eval assignment review sheet. Supabase is authoritative; this file is export-only.
const WAREHOUSE_ASSIGNED_ITEMS_SHEET_ID = '16mK_5MWcIwVsbok0lGkBG65UeZt553nf5IEPiv0k34Q';
const WAREHOUSE_ASSIGNED_ITEMS_FOLDER_ID = '1PLQJjNIM4dBTBlFOYiumLb-ICccPZbgn';
const HL_PO_PARSED_TABLE = 'ph_27f1_hl_po';
const HL_PO_PARSED_SOURCE_FOLDER_ID = '1681oPSyfz7mURdywOKH_9FQNnBQmmSWO';
const HL_PO_PARSED_PROCESSED_FOLDER_ID = '13jQ37aqokXgzZ2z3VOOdCANdW5lQPgv2';
const HL_PO_PARSED_TIMEZONE = 'America/Chicago';
const TRANSACTIONS_KEYED_FILES_TABLE = 'ph_transactions_keyed_files';
const TRANSACTIONS_KEYED_ROWS_TABLE = 'ph_transactions_keyed_rows';
const TRANSACTIONS_KEYED_PENDING_FOLDER_ID = '1aP8zvY9SwOEV3ThcQf7t9oBBinEr3gMe';
const TRANSACTIONS_KEYED_PROCESSED_FOLDER_ID = '1glpzw3zr1Q2YyNj2OtD_O5fBBFpPe78Q';
const TRANSACTIONS_KEYED_TIMEZONE = 'America/Chicago';
const TRANSACTIONS_KEYED_MAX_FILES_PER_RUN = 3;
const TRANSACTIONS_KEYED_MAX_RUN_MS = 240000;

const FOLDERS = {
  MASTER_DROP: '1MWLYsQJ41bZVcg1SzDIw93uNmQpzPn48',
  MASTER_PROCESSED: '1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA',
  SOC_DROP: '19kd-yBZZeJfhJsITpyrzzANbJBNTs9eE',
  SOC_PROCESSED: '13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo',
  RESERVES_DROP: '1Xiyp6WQGAF-4Tm-KwSwi9RsBqulFcSAG',
  RESERVES_PROCESSED: '1u4Vk5L92zmcXXT2qNWzImWTud73Bpole',
  CUSTOMER_REP_DROP: '1Fgsu1Xnpt_SW9CneVh1gPOdTu338p5W8',
  CUSTOMER_REP_PROCESSED: '1_62SsOENs5DSEU6JIyGi3ZsC3Z8IDGUd',
  CAV_DROP: '1K-y4thhw_iu2UEEZGRc39LzlpUZtcOBZ',
  CAV_PROCESSED: '1reWKO3GzeFhwsy_ot7Sjb2RPiFs448A5',
  WAREHOUSE_ASSIGNED_ITEMS_SOURCE: WAREHOUSE_ASSIGNED_ITEMS_FOLDER_ID,
  HL_PO_PARSED_DROP: HL_PO_PARSED_SOURCE_FOLDER_ID,
  HL_PO_PARSED_PROCESSED: HL_PO_PARSED_PROCESSED_FOLDER_ID,
  TRANSACTIONS_KEYED_DROP: TRANSACTIONS_KEYED_PENDING_FOLDER_ID,
  TRANSACTIONS_KEYED_PROCESSED: TRANSACTIONS_KEYED_PROCESSED_FOLDER_ID
};

const CUSTOMER_REP_MAP_TABLE = 'ph_customer_consignee_sales_reps';
const AUTO_DROP_FOLDER_SYNC_TRIGGER_HANDLER = 'runAutoDropFolderSync_';

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

  'saleyear', 'blockalpha', 'blocknumber', 'bay', 'pullerresponsibility', 'season_available', 'salesnotebegindate',
  'hold_release_approved_at', 'hold_release_approved_by', 'hold_release_approved_by_display', 'hold_release_approved_holdstopbegindate'
]);

function runSOCOnly() { return processLatestFileOnlyFolder(FOLDERS.SOC_DROP, FOLDERS.SOC_PROCESSED, getRuntimeSiteSplitTableName_('ph_soc_master', 'PH'), buildStandardPayload, { deltaMode: true }); }
function runDriveAroundOnly() {
  return processSnapshotBatchFolder(FOLDERS.MASTER_DROP, FOLDERS.MASTER_PROCESSED, 'ph_master_inventory', buildMasterPayload);
}
function runDriveAroundHistoryOnly() { return syncDriveAroundHistoricalFileIndex_({ parseRows: true }); }
function runReservesOnly() { return processLatestFileOnlyFolder(FOLDERS.RESERVES_DROP, FOLDERS.RESERVES_PROCESSED, getRuntimeSiteSplitTableName_('ph_reserves', 'PH'), buildStandardPayload, { deltaMode: true }); }
function runCustomerRepMapOnly() { return processLatestFileOnlyFolder(FOLDERS.CUSTOMER_REP_DROP, FOLDERS.CUSTOMER_REP_PROCESSED, CUSTOMER_REP_MAP_TABLE, buildCustomerRepMapPayload, { deltaMode: true, selectColumnsBuilder: getCustomerRepMapSelectColumns_, headerMatcher: isCustomerRepMapHeaderRow_ }); }
function runWarehouseAssignedItemsOnly() { return syncWarehouseAssignedItemsSheet_(WAREHOUSE_ASSIGNED_ITEMS_SHEET_ID, FOLDERS.WAREHOUSE_ASSIGNED_ITEMS_SOURCE, WAREHOUSE_ASSIGNED_ITEMS_TABLE); }
function runCavOnly() { return processLatestFileOnlyFolder(FOLDERS.CAV_DROP, FOLDERS.CAV_PROCESSED, getRuntimeSiteSplitTableName_('ph_cav_import', 'PH'), buildCavPayload, { deltaMode: true }); }
function runRetiredDiseaseManualSyncStage_() {
  return {
    filesProcessed: 0,
    tempFilesRemoved: 0,
    failedFiles: 0,
    failedFileNames: [],
    failedFileErrors: [],
    retired: true,
    message: 'Retired disease/lab sync stage skipped. Disease & Pest human workflow is unchanged.'
  };
}
function runDiseaseDriveToSupabaseSyncOnly() { return runRetiredDiseaseManualSyncStage_(); }
function runHlPoParsedOnly() { return syncHlPoParsedFolder_(FOLDERS.HL_PO_PARSED_DROP, FOLDERS.HL_PO_PARSED_PROCESSED, HL_PO_PARSED_TABLE); }
function runTransactionsKeyedOnly() { return syncTransactionsKeyedFolder_(FOLDERS.TRANSACTIONS_KEYED_DROP, FOLDERS.TRANSACTIONS_KEYED_PROCESSED); }

const SITE_SPLIT_SITE_CODES_ = Object.freeze(['PH', 'TX', 'NC', 'HL']);
const SITE_SPLIT_SITE_BY_WAREHOUSE_ = Object.freeze({
  '10': 'PH',
  '20': 'TX',
  '40': 'NC',
  '60': 'HL'
});
const SITE_SPLIT_TABLE_BASE_BY_LEGACY_ = Object.freeze({
  ph_master_inventory: 'master_inventory',
  ph_active_request: 'active_request',
  ph_request_history: 'request_history',
  ph_reserves: 'reserves',
  ph_soc_master: 'soc_master',
  ph_cav_import: 'cav_import',
  ph_view_av_hot_price_keys: 'view_av_hot_price_keys',
  ph_av_notes: 'av_notes',
  ph_labor_hours: 'labor_hours',
  ph_sales_office: 'sales_office',
  ph_flyer_folder_rows: 'flyer_folder_rows',
  ph_flyer_folder_history: 'flyer_folder_history',
  ph_ncr_completions: 'ncr_completions',
  ph_take_back_queue: 'take_back_queue',
  ph_productivity_history: 'productivity_history',
  ph_grower_scout_reports: 'grower_scout_reports',
  ph_grower_scout_assets: 'grower_scout_assets',
  ph_shear_list: 'shear_list',
  ph_production_workflow_rows: 'production_workflow_rows',
  ph_spread_counts: 'spread_counts',
  ph_bunch_counts: 'bunch_counts',
  ph_dock_team_status: 'dock_team_status',
  ph_dock_item_status: 'dock_item_status',
  ph_dock_issue_status: 'dock_issue_status',
  ph_dock_issue_allocations: 'dock_issue_allocations',
  ph_drive_around_report_files: 'drive_around_report_files',
  ph_drive_around_report_rows: 'drive_around_report_rows',
  ph_weather_hourly: 'weather_hourly',
  ph_weather_daily: 'weather_daily',
  ph_hold_learning_events: 'hold_learning_events',
  ph_hold_release_cycles: 'hold_release_cycles',
  ph_hold_learning_profiles: 'hold_learning_profiles',
  ph_hold_stop_itemcode_snapshots: 'hold_stop_itemcode_snapshots',
  ph_hold_stop_itemcode_cycles: 'hold_stop_itemcode_cycles',
  ph_hold_stop_itemcode_summaries: 'hold_stop_itemcode_summaries'
});
const SITE_SPLIT_LEGACY_BY_TABLE_BASE_ = Object.freeze(Object.keys(SITE_SPLIT_TABLE_BASE_BY_LEGACY_).reduce(function(acc, legacy) {
  acc[SITE_SPLIT_TABLE_BASE_BY_LEGACY_[legacy]] = legacy;
  return acc;
}, {}));

function isScriptRuntimeFlagEnabled_(key) {
  try {
    const value = PropertiesService.getScriptProperties().getProperty(key);
    return /^(1|true|yes)$/i.test(String(value || '').trim());
  } catch (err) {
    return false;
  }
}

function setScriptPropertyWithQuotaCleanup_(key, value) {
  const props = PropertiesService.getScriptProperties();
  try {
    props.setProperty(key, value);
  } catch (error) {
    const message = String(error && error.message ? error.message : error || '');
    if (!/property storage quota|storage quota|properties/i.test(message)) throw error;
    cleanupRequestGalleryPropertyCache_();
    props.setProperty(key, value);
  }
}

function isSiteSplitTablesEnabled_() {
  return isScriptRuntimeFlagEnabled_('GNC_SITE_TABLES_ENABLED');
}

function normalizeSiteSplitSiteCode_(siteCode) {
  const safe = String(siteCode || '').trim().toUpperCase();
  return SITE_SPLIT_SITE_CODES_.indexOf(safe) !== -1 ? safe : 'PH';
}

function getSiteSplitTableBaseName_(tableName) {
  const safe = String(tableName || '').trim().toLowerCase();
  if (SITE_SPLIT_TABLE_BASE_BY_LEGACY_[safe]) return SITE_SPLIT_TABLE_BASE_BY_LEGACY_[safe];
  const match = safe.match(/^(ph|tx|nc|hl)_(.+)$/);
  return match && SITE_SPLIT_LEGACY_BY_TABLE_BASE_[match[2]] ? match[2] : '';
}

function getSiteSplitLegacyTableName_(tableName) {
  const safe = String(tableName || '').trim().toLowerCase();
  if (SITE_SPLIT_TABLE_BASE_BY_LEGACY_[safe]) return safe;
  const base = getSiteSplitTableBaseName_(safe);
  return base ? String(SITE_SPLIT_LEGACY_BY_TABLE_BASE_[base] || safe) : safe;
}

function resolveSiteSplitTableName_(tableName, siteCode) {
  const safe = String(tableName || '').trim();
  const safeLower = safe.toLowerCase();
  const base = getSiteSplitTableBaseName_(safeLower);
  if (!base || /^(tx|nc|hl)_/.test(safeLower)) return safe;
  if (/^ph_/.test(safeLower) && !SITE_SPLIT_TABLE_BASE_BY_LEGACY_[safeLower]) return safe;
  return `${normalizeSiteSplitSiteCode_(siteCode).toLowerCase()}_${base}`;
}

function getRuntimeSiteSplitTableName_(tableName, siteCode) {
  return isSiteSplitTablesEnabled_()
    ? resolveSiteSplitTableName_(tableName, siteCode)
    : tableName;
}

function getSiteSplitSiteFromWarehouse_(warehouseId) {
  const safe = String(warehouseId || '').trim().replace(/\.0+$/, '');
  return SITE_SPLIT_SITE_BY_WAREHOUSE_[safe] || 'PH';
}

function getSiteCodeFromSiteSplitTableName_(tableName) {
  const match = String(tableName || '').trim().toLowerCase().match(/^(ph|tx|nc|hl)_/);
  return match ? String(match[1] || '').toUpperCase() : '';
}

function isSiteSplitPhysicalTable_(tableName) {
  return !!getSiteCodeFromSiteSplitTableName_(tableName);
}

const MANUAL_SYNC_STATUS_KEY = 'MANUAL_SYNC_STATUS';
const MANUAL_SYNC_TRIGGER_HANDLER = 'runQueuedManualSyncStage_';
const MANUAL_SYNC_STAGE_ORDER_DEFAULT = Object.freeze(['drive', 'soc', 'reserves', 'customer_rep_map', 'warehouse_assigned_items', 'cav', 'transactions_keyed', 'hl_po_parsed']);
const MANUAL_SYNC_EXECUTION_BUDGET_MS = 285000;
const MANUAL_SYNC_NEXT_STAGE_START_CUTOFF_MS = 120000;
const MANUAL_SYNC_QUEUED_STALE_MS = 5 * 60 * 1000;
const MANUAL_SYNC_ACTIVE_STALE_MS = 12 * 60 * 1000;
const SUPABASE_DELETE_URL_MAX_LENGTH = 1800;
const SUPABASE_FETCH_PAGE_SIZE = 1000;
const SUPABASE_PAGED_READ_FETCH_BATCH_SIZE = 8;
const SUPABASE_UPSERT_FETCH_BATCH_SIZE = 6;
// Master inventory writes execute several row-level projection/invalidation triggers.
// Keep full-size requests serial so they avoid lock contention and finish inside Apps Script's runtime.
const SUPABASE_MASTER_UPSERT_CHUNK_SIZE = 1000;
const SUPABASE_MASTER_UPSERT_FETCH_BATCH_SIZE = 1;
const SUPABASE_MASTER_UPSERT_MIN_SPLIT_SIZE = 100;
const SUPABASE_UPSERT_RETRY_COUNT = 3;
const SUPABASE_UPSERT_RETRY_DELAY_MS = 900;
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
const JD_APPROVAL_EMAIL_QUEUE_KEY = 'JD_APPROVAL_EMAIL_QUEUE';
const JD_APPROVAL_EMAIL_TRIGGER_HANDLER = 'processQueuedJdApprovalEmail_';
const JD_APPROVAL_EMAIL_DELAY_MS = 3 * 60 * 1000;
const JD_APPROVAL_EMAIL_MIN_DELAY_MS = 30000;
const REQUEST_GALLERY_BASE_URL_PROPERTY = 'REQUEST_GALLERY_BASE_URL';
const REQUEST_GALLERY_SECRET_PROPERTY = 'REQUEST_GALLERY_SECRET';
const REQUEST_GALLERY_CACHE_META_PREFIX = 'REQUEST_GALLERY_CACHE_META_';
const REQUEST_GALLERY_CACHE_CHUNK_PREFIX = 'REQUEST_GALLERY_CACHE_CHUNK_';
const REQUEST_GALLERY_CACHE_CHUNK_SIZE = 7000;
const REQUEST_GALLERY_PROPERTY_CACHE_ENABLED = false;
const EMAIL_APPROVAL_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMAIL_APPROVAL_USER_EMAILS_ = Object.freeze({
  dylan_collyge: 'dylan_collyge@greenleafnursery.com',
  kayla_knepp: 'kayla_knepp@greenleafnursery.com',
  jd_jones: 'jd_jones@greenleafnursery.com',
  megan_kelly: 'megan_kelly@greenleafnursery.com',
  mitch_kaiser: 'mitch_kaiser@greenleafnursery.com',
  sharon_combs: 'sharon_combs@greenleafnursery.com',
  sunday_ellis: 'sunday_ellis@greenleafnursery.com'
});
const REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_ = Object.freeze([
  EMAIL_APPROVAL_USER_EMAILS_.dylan_collyge,
  EMAIL_APPROVAL_USER_EMAILS_.kayla_knepp,
  EMAIL_APPROVAL_USER_EMAILS_.jd_jones
]);
const REQUEST_LIFECYCLE_RECIPIENT_POLICY_VERSION_ = 'plant-request-lifecycle-v2';
const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';
const INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_EMAILS_ = Object.freeze([
  EMAIL_APPROVAL_USER_EMAILS_.sunday_ellis,
  EMAIL_APPROVAL_USER_EMAILS_.sharon_combs,
  EMAIL_APPROVAL_USER_EMAILS_.mitch_kaiser,
  EMAIL_APPROVAL_USER_EMAILS_.jd_jones,
  EMAIL_APPROVAL_USER_EMAILS_.megan_kelly
]);
const EMAIL_APPROVAL_ASSIGNMENTS_ = Object.freeze({
  'new-crop:dylan': 'ncr_approval_new_crop_dylan',
  'new-crop:jd': 'ncr_approval_new_crop_jd',
  'new-crop:inventory': 'ncr_inventory_new_crop',
  'move-up:dylan': 'ncr_approval_move_up_dylan',
  'move-up:jd': 'ncr_approval_move_up_jd',
  'move-up:inventory': 'ncr_inventory_move_up',
  'move-down:dylan': 'ncr_approval_move_down_dylan',
  'move-down:jd': 'ncr_approval_move_down_jd',
  'move-down:inventory': 'ncr_inventory_move_down',
  'hold-release:dylan': 'ncr_approval_hold_release_dylan',
  'hold-release:jd': 'ncr_approval_hold_release_jd',
  'hold-release:inventory': 'ncr_inventory_hold_release',
  'recount:dylan': 'ncr_approval_recount_dylan',
  'recount:jd': 'ncr_approval_recount_jd',
  'recount:inventory': 'ncr_inventory_recount'
});

const MASTER_IMPORT_BASE_COMPARE_COLUMNS = Object.freeze([
  'unique_id',
  'assignedto',
  'concat',
  'holdstopcode',
  'holdstopreason',
  'holdstopbegindate',
  'hold_release_approved_at',
  'hold_release_approved_by',
  'hold_release_approved_by_display',
  'hold_release_approved_holdstopbegindate'
]);

const MASTER_IMPORT_APP_OWNED_COLUMNS = Object.freeze([
  'date_completed',
  'app_tab_assignment',
  'av_note',
  'sales_note',
  'match',
  'spec',
  'caliper',
  'pic_note',
  'loc_match_qty',
  'initial_ptr',
  'photo_link',
  'photo_name',
  'hold_release_approved_at',
  'hold_release_approved_by',
  'hold_release_approved_by_display',
  'hold_release_approved_holdstopbegindate'
]);

const MASTER_IMPORT_CLEAR_ON_NEW_HOLD_COLUMNS = Object.freeze([
  'date_completed',
  'av_note',
  'sales_note',
  'match',
  'spec',
  'caliper',
  'pic_note',
  'loc_match_qty',
  'initial_ptr',
  'photo_link',
  'photo_name'
]);

function getAppLiveEventAreaForTable_(tableName) {
  const safeTable = getSiteSplitLegacyTableName_(tableName);
  if (safeTable === 'ph_master_inventory') return 'inventory';
  if (safeTable === 'ph_soc_master') return 'docks';
  if (safeTable === 'ph_reserves') return 'reserves';
  if (safeTable === CUSTOMER_REP_MAP_TABLE) return 'customer-rep-map';
  if (safeTable === 'ph_cav_import') return 'av';
  if (safeTable === DRIVE_AROUND_HISTORY_TABLE || safeTable === DRIVE_AROUND_HISTORY_ROW_TABLE || safeTable === 'ph_hold_release_cycles' || safeTable === HOLD_STOP_ITEMCODE_SUMMARY_TABLE) return 'weather-hold';
  if (safeTable === 'ph_sales_office') return 'sales-office';
  if (safeTable === 'ph_active_request') return 'request';
  if (safeTable === TRANSACTIONS_KEYED_FILES_TABLE || safeTable === TRANSACTIONS_KEYED_ROWS_TABLE) return 'transactions-keyed';
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
      headers: getSupabaseHeaders_({
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }),
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
  drive_history: { label: 'Drive Around History', run: runDriveAroundHistoryOnly },
  soc: { label: 'SOC', run: runSOCOnly },
  reserves: { label: 'Reserves', run: runReservesOnly },
  customer_rep_map: { label: 'Customer Rep Map', run: runCustomerRepMapOnly },
  warehouse_assigned_items: { label: 'Warehouse Assigned Items', run: runWarehouseAssignedItemsOnly },
  cav: { label: 'CAV', run: runCavOnly },
  disease: { label: 'Disease Lab Assets (Retired)', run: runRetiredDiseaseManualSyncStage_ },
  lab: { label: 'Lab Assets (Retired)', run: runRetiredDiseaseManualSyncStage_ },
  lab_reports: { label: 'Lab Reports (Retired)', run: runRetiredDiseaseManualSyncStage_ },
  hl_po_parsed: { label: 'HL PO Parsed', run: runHlPoParsedOnly },
  transactions_keyed: { label: 'Transactions Keyed', run: runTransactionsKeyedOnly }
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

function stopDriveAroundHistoryBackfill() {
  removeDriveAroundHistoryBackfillTrigger_();
  console.log('[DRIVE AROUND HISTORY] Backfill trigger removed. Historical Drive Around files will not process unless startDriveAroundHistoryBackfill() is run manually.');
  return { stopped: true };
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
  setScriptPropertyWithQuotaCleanup_(MANUAL_SYNC_STATUS_KEY, JSON.stringify(status || {}));
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
  if (startedAtMs <= 0 && updatedAtMs <= 0) return true;
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
  if (normalized === 'drive_history' || normalized === 'drivearound_history' || normalized === 'drive_around_history') return ['drive_history'];
  if (normalized === 'soc') return ['soc'];
  if (normalized === 'reserves') return ['reserves'];
  if (normalized === 'warehouse_assigned_items' || normalized === 'warehouse_assignments' || normalized === 'assigned_items') return ['warehouse_assigned_items'];
  if (normalized === 'cav') return ['cav'];
  if (normalized === 'disease' || normalized === 'lab' || normalized === 'lab_reports') return [normalized];
  if (normalized === 'hl_po_parsed' || normalized === 'hlpo_parsed' || normalized === 'hl_po_import' || normalized === 'hl_po_upload') return ['hl_po_parsed'];
  if (normalized === 'transactions_keyed' || normalized === 'transaction_keyed' || normalized === 'transactions') return ['transactions_keyed'];
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
        error: String(entry && entry.error || safeResult.error || '').trim(),
        errorCode: String(entry && (entry.errorCode || entry.error_code) || '').trim().toUpperCase()
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
    cleanupRequestGalleryPropertyCache_();
    const forceIfStale = !!(options && (options.forceIfStale === true || options.force_if_stale === true));
    let existing = loadManualSyncStatus_();
    if (existing && existing.active && isManualSyncStatusStale_(existing)) {
      const staleStageLabel = String(existing.currentStageLabel || existing.currentStage || 'manual sync');
      existing = markManualSyncStatusStale_(existing, `${staleStageLabel} did not update before the safety timeout.`);
    }
    if (existing && existing.active && forceIfStale) {
      const nowMs = Date.now();
      const updatedAtMs = parseManualSyncTimestampMs_(existing.updatedAt || existing.updated_at || existing.startedAt || existing.started_at);
      const startedAtMs = parseManualSyncTimestampMs_(existing.startedAt || existing.started_at || existing.updatedAt || existing.updated_at);
      const oldestKnownMs = Math.min.apply(null, [updatedAtMs, startedAtMs].filter(function(value) { return value > 0; }));
      const forceClearAgeMs = oldestKnownMs > 0 ? nowMs - oldestKnownMs : 0;
      if (forceClearAgeMs > MANUAL_SYNC_ACTIVE_STALE_MS) {
        const staleStageLabel = String(existing.currentStageLabel || existing.currentStage || 'manual sync');
        existing = markManualSyncStatusStale_(existing, `Force-cleared stale manual sync before starting a new run. Last stage: ${staleStageLabel}.`);
      }
    }
    if (existing && existing.active) {
      console.warn(`[MANUAL SYNC][${existing.runId || 'active'}] A manual sync is already running.`);
      return Object.assign({}, existing, {
        ok: true,
        status: 'busy',
        active: true,
        runId: existing.runId || '',
        currentStage: existing.currentStage || '',
        currentStageLabel: existing.currentStageLabel || '',
        stageOrder: Array.isArray(existing.stageOrder) ? existing.stageOrder : [],
        stageIndex: Number(existing.stageIndex || 0),
        completedStages: Array.isArray(existing.completedStages) ? existing.completedStages : [],
        stageResults: Array.isArray(existing.stageResults) ? existing.stageResults : [],
        startedAt: existing.startedAt || existing.started_at || '',
        updatedAt: existing.updatedAt || existing.updated_at || existing.startedAt || existing.started_at || new Date().toISOString(),
        finishedAt: existing.finishedAt || existing.finished_at || '',
        message: existing.message || 'A manual sync is already running.',
        error: existing.error || ''
      });
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
      error: '',
      errorCode: ''
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
        status.errorCode = String(failedFileErrors[0] && failedFileErrors[0].errorCode || stageResult.errorCode || stageResult.error_code || 'MANUAL_SYNC_STAGE_FAILED').trim().toUpperCase();
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
  return getSiteSplitTableBaseName_(tableName) === 'master_inventory';
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

function listDriveSubfoldersWithRetry_(folder, label) {
  return withDriveRetry_(`Drive subfolder listing: ${label}`, function() {
    return folder.getFolders();
  });
}

function parseDriveAroundReportDateString_(fileName) {
  const text = String(fileName || '').trim();
  const patterns = [
    /(20\d{2})[-_. ]([01]?\d)[-_. ]([0-3]?\d)/,
    /([01]?\d)[-_. ]([0-3]?\d)[-_. ](20\d{2})/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (!match) continue;
    let year;
    let month;
    let day;
    if (String(match[1]).length === 4) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      year = Number(match[3]);
      month = Number(match[1]);
      day = Number(match[2]);
    }
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return Utilities.formatDate(parsed, 'UTC', 'yyyy-MM-dd');
    }
  }
  return null;
}

function isDriveAroundHistoricalFileSupported_(fileName, mimeType) {
  const safeMimeType = String(mimeType || '').trim();
  if (safeMimeType === GOOGLE_SHEETS_MIME_TYPE) return true;
  const lowerName = String(fileName || '').trim().toLowerCase();
  return DRIVE_AROUND_HISTORY_SUPPORTED_EXTENSIONS.some(function(extension) {
    return lowerName.endsWith(extension);
  });
}

function getDriveFileIsoDateSafe_(file, getterName) {
  try {
    const value = file && typeof file[getterName] === 'function' ? file[getterName]() : null;
    return value && typeof value.toISOString === 'function' ? value.toISOString() : null;
  } catch (err) {
    return null;
  }
}

function getDriveFileSizeSafe_(file) {
  try {
    return file && typeof file.getSize === 'function' ? Number(file.getSize()) || 0 : 0;
  } catch (err) {
    return 0;
  }
}

function getDriveFileDateObjectSafe_(file, getterName) {
  try {
    const value = file && typeof file[getterName] === 'function' ? file[getterName]() : null;
    return value instanceof Date && !isNaN(value.getTime()) ? value : null;
  } catch (err) {
    return null;
  }
}

function formatDriveAroundCanonicalDate_(date) {
  const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  return Utilities.formatDate(safeDate, DRIVE_AROUND_CANONICAL_TIMEZONE, 'yyyy-MM-dd');
}

function padDriveAroundCanonicalSequence_(sequence) {
  const safeSequence = Math.max(1, Number(sequence) || 1);
  return safeSequence < 10 ? `0${safeSequence}` : String(safeSequence);
}

function isDriveAroundMachineNamedFile_(fileName) {
  return DRIVE_AROUND_MACHINE_NAME_PATTERN.test(String(fileName || '').trim());
}

function parseDriveAroundCanonicalFileName_(fileName) {
  const text = String(fileName || '').trim();
  const match = text.match(DRIVE_AROUND_CANONICAL_NAME_PATTERN);
  if (!match) return null;
  const sequence = Number(match[2] || 0);
  return {
    canonicalDate: match[1],
    sequence: sequence > 0 ? sequence : null
  };
}

function getDriveAroundFileExtension_(fileName) {
  const match = String(fileName || '').trim().match(/(\.[A-Za-z0-9]{1,12})$/);
  return match ? match[1] : '';
}

function buildDriveAroundCanonicalFileName_(canonicalDate, sequence, extension) {
  return `${canonicalDate} ${padDriveAroundCanonicalSequence_(sequence)}${String(extension || '')}`;
}

function normalizeDriveAroundRawManifest_(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

function resolveDriveAroundCanonicalDate_(file, options) {
  const safeOptions = options || {};
  const fileName = String(file && typeof file.getName === 'function' ? file.getName() : '').trim();
  const isMachineName = isDriveAroundMachineNamedFile_(fileName);
  const parsedFileNameDate = parseDriveAroundReportDateString_(fileName);
  const createdDate = getDriveFileDateObjectSafe_(file, 'getDateCreated');
  const modifiedDate = getDriveFileDateObjectSafe_(file, 'getLastUpdated');
  const fallbackDate = safeOptions.fallbackDate instanceof Date && !isNaN(safeOptions.fallbackDate.getTime())
    ? safeOptions.fallbackDate
    : null;
  if (parsedFileNameDate && !isMachineName) {
    return {
      canonicalDate: parsedFileNameDate,
      canonicalDateSource: 'filename',
      parsedFileNameDate: parsedFileNameDate,
      driveCreatedAt: createdDate ? createdDate.toISOString() : null,
      driveModifiedAt: modifiedDate ? modifiedDate.toISOString() : null,
      firstSeenAt: createdDate ? createdDate.toISOString() : fallbackDate ? fallbackDate.toISOString() : null
    };
  }
  const sourceDate = createdDate || fallbackDate || modifiedDate || new Date();
  return {
    canonicalDate: formatDriveAroundCanonicalDate_(sourceDate),
    canonicalDateSource: isMachineName ? 'drive_drop_date_machine_name' : 'drive_drop_date',
    parsedFileNameDate: parsedFileNameDate,
    driveCreatedAt: createdDate ? createdDate.toISOString() : null,
    driveModifiedAt: modifiedDate ? modifiedDate.toISOString() : null,
    firstSeenAt: createdDate ? createdDate.toISOString() : fallbackDate ? fallbackDate.toISOString() : sourceDate.toISOString()
  };
}

function getDriveAroundCanonicalSortTime_(file) {
  const createdDate = getDriveFileDateObjectSafe_(file, 'getDateCreated');
  if (createdDate) return createdDate.getTime();
  const modifiedDate = getDriveFileDateObjectSafe_(file, 'getLastUpdated');
  return modifiedDate ? modifiedDate.getTime() : 0;
}

function getDriveAroundCanonicalFolderFiles_(folder) {
  const iterator = listDriveFilesWithRetry_(folder, 'DriveAround canonical folder scan');
  const files = [];
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (isDriveAroundHistoricalFileSupported_(file.getName(), file.getMimeType())) {
      files.push(file);
    }
  }
  return files;
}

function buildDriveAroundCanonicalRenamePlan_(targetFiles, processedFolder, options) {
  const safeOptions = options || {};
  const targetIdSet = {};
  (targetFiles || []).forEach(function(file) {
    const fileId = String(file && typeof file.getId === 'function' ? file.getId() : '').trim();
    if (fileId) targetIdSet[fileId] = true;
  });
  const folderFiles = getDriveAroundCanonicalFolderFiles_(processedFolder);
  const usedNames = {};
  const maxSequenceByDate = {};
  folderFiles.forEach(function(file) {
    const fileName = String(file.getName() || '').trim();
    const canonical = parseDriveAroundCanonicalFileName_(fileName);
    if (!canonical || !canonical.canonicalDate || !canonical.sequence) return;
    usedNames[fileName.toLowerCase()] = true;
    const currentMax = Number(maxSequenceByDate[canonical.canonicalDate] || 0);
    if (canonical.sequence > currentMax) maxSequenceByDate[canonical.canonicalDate] = canonical.sequence;
  });

  const entries = (targetFiles || []).filter(function(file) {
    return file && isDriveAroundHistoricalFileSupported_(file.getName(), file.getMimeType());
  }).map(function(file) {
    const originalName = String(file.getName() || '').trim();
    const resolved = resolveDriveAroundCanonicalDate_(file, safeOptions);
    const existingCanonical = parseDriveAroundCanonicalFileName_(originalName);
    return {
      file: file,
      fileId: String(file.getId() || '').trim(),
      originalFileName: originalName,
      extension: getDriveAroundFileExtension_(originalName),
      canonicalDate: resolved.canonicalDate,
      canonicalDateSource: resolved.canonicalDateSource,
      parsedFileNameDate: resolved.parsedFileNameDate,
      driveCreatedAt: resolved.driveCreatedAt,
      driveModifiedAt: resolved.driveModifiedAt,
      firstSeenAt: resolved.firstSeenAt,
      sortTime: getDriveAroundCanonicalSortTime_(file),
      existingCanonical: existingCanonical
    };
  });

  entries.sort(function(a, b) {
    if (a.canonicalDate !== b.canonicalDate) return a.canonicalDate < b.canonicalDate ? -1 : 1;
    if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
    if (a.originalFileName !== b.originalFileName) return a.originalFileName < b.originalFileName ? -1 : 1;
    return a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0;
  });

  const warnings = [];
  const assignments = entries.map(function(entry) {
    const alreadyCanonicalForDate = entry.existingCanonical &&
      entry.existingCanonical.canonicalDate === entry.canonicalDate &&
      entry.existingCanonical.sequence;
    let sequence = alreadyCanonicalForDate ? entry.existingCanonical.sequence : Number(maxSequenceByDate[entry.canonicalDate] || 0) + 1;
    let canonicalFileName = alreadyCanonicalForDate
      ? entry.originalFileName
      : buildDriveAroundCanonicalFileName_(entry.canonicalDate, sequence, entry.extension);
    while (!alreadyCanonicalForDate && usedNames[String(canonicalFileName || '').toLowerCase()]) {
      sequence += 1;
      canonicalFileName = buildDriveAroundCanonicalFileName_(entry.canonicalDate, sequence, entry.extension);
    }
    usedNames[String(canonicalFileName || '').toLowerCase()] = true;
    const priorMax = Number(maxSequenceByDate[entry.canonicalDate] || 0);
    if (sequence > priorMax) maxSequenceByDate[entry.canonicalDate] = sequence;
    if (sequence > 4) {
      warnings.push(`${entry.canonicalDate} has sequence ${sequence}; keeping the file and continuing.`);
    }
    return Object.assign({}, entry, {
      canonicalSequence: sequence,
      canonicalFileName: canonicalFileName,
      shouldRename: canonicalFileName !== entry.originalFileName,
      isTargetFile: !!targetIdSet[entry.fileId],
      renamedAt: null,
      renameError: null
    });
  });

  return {
    assignments: assignments,
    warnings: warnings
  };
}

function buildDriveAroundCanonicalManifestRow_(file, assignment, nowIso, existingManifestRow) {
  const existing = existingManifestRow || {};
  const raw = normalizeDriveAroundRawManifest_(existing.raw);
  const canonicalFileName = String(assignment && assignment.canonicalFileName || file.getName() || '').trim();
  const originalFileName = String(assignment && assignment.originalFileName || raw.original_file_name || canonicalFileName).trim();
  const canonicalDate = String(assignment && assignment.canonicalDate || parseDriveAroundReportDateString_(canonicalFileName) || '').trim() || null;
  const canonicalSequence = assignment && assignment.canonicalSequence ? Number(assignment.canonicalSequence) : null;
  const driveModifiedAt = getDriveFileIsoDateSafe_(file, 'getLastUpdated') || assignment && assignment.driveModifiedAt || existing.drive_modified_time || null;
  const driveCreatedAt = assignment && assignment.driveCreatedAt || getDriveFileIsoDateSafe_(file, 'getDateCreated') || raw.created_at || null;
  const mergedRaw = Object.assign({}, raw, {
    source: 'apps_script_drivearound_canonical_naming',
    source_folder_id: DRIVE_AROUND_HISTORY_FOLDER_ID,
    original_file_name: originalFileName,
    canonical_file_name: canonicalFileName,
    canonical_report_date: canonicalDate,
    canonical_sequence: canonicalSequence,
    canonical_date_source: assignment && assignment.canonicalDateSource || raw.canonical_date_source || null,
    parsed_file_name_date: assignment && assignment.parsedFileNameDate || raw.parsed_file_name_date || null,
    size_bytes: getDriveFileSizeSafe_(file),
    created_at: driveCreatedAt,
    modified_at: driveModifiedAt,
    renamed_at: assignment && assignment.renamedAt || raw.renamed_at || null,
    indexed_at: nowIso
  });
  return {
    file_id: String(file.getId() || '').trim(),
    file_name: canonicalFileName,
    mime_type: String(file.getMimeType() || '').trim() || null,
    report_date: canonicalDate,
    drive_modified_time: driveModifiedAt,
    web_view_link: file.getUrl(),
    processed_at: nowIso,
    row_count: Number(existing.row_count || 0),
    hold_row_count: Number(existing.hold_row_count || 0),
    status: String(existing.status || '').trim() || 'indexed',
    error_message: existing.error_message || null,
    original_file_name: originalFileName,
    canonical_file_name: canonicalFileName,
    canonical_report_date: canonicalDate,
    canonical_sequence: canonicalSequence,
    canonical_date_source: assignment && assignment.canonicalDateSource || raw.canonical_date_source || null,
    renamed_at: assignment && assignment.renamedAt || raw.renamed_at || null,
    first_seen_at: assignment && assignment.firstSeenAt || raw.first_seen_at || driveCreatedAt || nowIso,
    raw: mergedRaw
  };
}

function pushDriveAroundCanonicalManifestRows_(assignments, nowIso, existingManifestById) {
  const existingMap = existingManifestById || fetchExistingDriveAroundHistoryManifestMap_();
  const rows = (assignments || []).map(function(assignment) {
    const existing = existingMap[String(assignment.fileId || '').trim()] || null;
    return buildDriveAroundCanonicalManifestRow_(assignment.file, assignment, nowIso, existing);
  });
  if (rows.length) pushToSupabase(DRIVE_AROUND_HISTORY_TABLE, rows);
  return rows.length;
}

function renameDriveAroundFileSafely_(assignment) {
  if (!assignment || !assignment.shouldRename) return assignment;
  try {
    renameDriveFileWithRetry_(assignment.file, assignment.canonicalFileName, `DriveAround canonical rename ${assignment.originalFileName}`);
    assignment.renamedAt = new Date().toISOString();
  } catch (err) {
    assignment.renameError = err && err.message ? err.message : String(err);
    console.warn(`[DRIVE AROUND NAME] Rename failed for ${assignment.originalFileName}: ${assignment.renameError}`);
  }
  return assignment;
}

function moveAndNormalizeDriveAroundProcessedFiles_(parsedFiles, processedFolder, options) {
  const files = (parsedFiles || []).map(function(entry) { return entry && entry.file; }).filter(Boolean);
  if (!files.length) return { moved: 0, renamed: 0, renameErrors: 0, manifestRows: 0, warnings: [] };
  const nowIso = options && options.nowIso || new Date().toISOString();
  const plan = buildDriveAroundCanonicalRenamePlan_(files, processedFolder, { fallbackDate: new Date(nowIso) });
  const assignmentsById = {};
  plan.assignments.forEach(function(assignment) {
    assignmentsById[assignment.fileId] = assignment;
  });
  let moved = 0;
  let renamed = 0;
  let renameErrors = 0;
  (parsedFiles || []).forEach(function(entry) {
    const file = entry && entry.file;
    if (!file) return;
    const fileId = String(file.getId() || '').trim();
    const assignment = assignmentsById[fileId];
    moveDriveFileToFolderWithRetry_(file, processedFolder, `Move processed file ${file.getName()}`);
    moved += 1;
    if (assignment && assignment.shouldRename) {
      renameDriveAroundFileSafely_(assignment);
      if (assignment.renamedAt) renamed += 1;
      if (assignment.renameError) renameErrors += 1;
    }
  });
  let manifestRows = 0;
  let manifestError = null;
  try {
    manifestRows = pushDriveAroundCanonicalManifestRows_(plan.assignments, nowIso);
  } catch (err) {
    manifestError = err && err.message ? err.message : String(err);
    console.warn(`[DRIVE AROUND NAME] Manifest update failed after processed files moved: ${manifestError}`);
  }
  return {
    moved: moved,
    renamed: renamed,
    renameErrors: renameErrors,
    manifestRows: manifestRows,
    manifestError: manifestError,
    warnings: plan.warnings
  };
}

function previewNormalizeDriveAroundProcessedNames(limit) {
  return normalizeDriveAroundProcessedNames_({
    apply: false,
    limit: Math.max(1, Math.min(5000, Number(limit) || DRIVE_AROUND_CANONICAL_PREVIEW_LIMIT))
  });
}

function normalizeDriveAroundProcessedNames(limit) {
  return normalizeDriveAroundProcessedNames_({
    apply: true,
    limit: Math.max(1, Math.min(5000, Number(limit) || DRIVE_AROUND_CANONICAL_APPLY_LIMIT))
  });
}

function normalizeDriveAroundProcessedNames_(options) {
  const safeOptions = options || {};
  const apply = safeOptions.apply === true;
  const limit = Math.max(1, Number(safeOptions.limit) || (apply ? DRIVE_AROUND_CANONICAL_APPLY_LIMIT : DRIVE_AROUND_CANONICAL_PREVIEW_LIMIT));
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) throw new Error('DriveAround name cleanup is already running.');
  try {
    const started = new Date();
    const nowIso = started.toISOString();
    const folder = DriveApp.getFolderById(DRIVE_AROUND_HISTORY_FOLDER_ID);
    const files = getDriveAroundCanonicalFolderFiles_(folder);
    const plan = buildDriveAroundCanonicalRenamePlan_(files, folder, { fallbackDate: started });
    const renameNeeded = plan.assignments.filter(function(assignment) { return assignment.shouldRename; });
    const applyTargets = renameNeeded.slice(0, limit);
    let renamed = 0;
    let renameErrors = 0;
    let manifestRows = 0;
    let manifestError = null;
    if (apply) {
      applyTargets.forEach(function(assignment) {
        renameDriveAroundFileSafely_(assignment);
        if (assignment.renamedAt) renamed += 1;
        if (assignment.renameError) renameErrors += 1;
      });
      const auditTargets = plan.assignments
        .filter(function(assignment) { return !assignment.shouldRename; })
        .slice(0, limit);
      const manifestTargetsById = {};
      applyTargets.concat(auditTargets).forEach(function(assignment) {
        if (assignment && assignment.fileId) manifestTargetsById[assignment.fileId] = assignment;
      });
      const manifestTargets = Object.keys(manifestTargetsById).map(function(fileId) {
        return manifestTargetsById[fileId];
      });
      try {
        manifestRows = pushDriveAroundCanonicalManifestRows_(manifestTargets, nowIso);
      } catch (err) {
        manifestError = err && err.message ? err.message : String(err);
        console.warn(`[DRIVE AROUND NAME] Manifest update failed during cleanup: ${manifestError}`);
      }
    }
    const samples = plan.assignments.slice(0, 40).map(function(assignment) {
      return {
        fileId: assignment.fileId,
        oldName: assignment.originalFileName,
        newName: assignment.canonicalFileName,
        canonicalDate: assignment.canonicalDate,
        sequence: assignment.canonicalSequence,
        dateSource: assignment.canonicalDateSource,
        wouldRename: assignment.shouldRename,
        renamed: !!assignment.renamedAt,
        error: assignment.renameError || null
      };
    });
    const summary = {
      apply: apply,
      scanned: files.length,
      planned: plan.assignments.length,
      renameNeeded: renameNeeded.length,
      processedThisRun: apply ? applyTargets.length : 0,
      renamed: renamed,
      renameErrors: renameErrors,
      manifestRows: manifestRows,
      manifestError: manifestError,
      skippedAlreadyCanonical: plan.assignments.length - renameNeeded.length,
      remainingRenameNeeded: apply ? Math.max(0, renameNeeded.length - applyTargets.length + renameErrors) : renameNeeded.length,
      warnings: plan.warnings.slice(0, 25),
      samples: samples
    };
    console.log(`[DRIVE AROUND NAME] ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function fetchExistingDriveAroundHistoryManifestMap_() {
  const limit = SUPABASE_FETCH_PAGE_SIZE;
  let offset = 0;
  const byId = {};
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${DRIVE_AROUND_HISTORY_TABLE}?select=file_id,file_name,report_date,drive_modified_time,row_count,hold_row_count,status,error_message,raw,original_file_name,canonical_file_name,canonical_report_date,canonical_sequence,canonical_date_source,renamed_at,first_seen_at&limit=${limit}&offset=${offset}`;
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: getSupabaseHeaders_(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error(`Drive Around history lookup failed (${res.getResponseCode()}): ${res.getContentText()}`);
    }
    const batch = JSON.parse(res.getContentText() || '[]');
    if (!Array.isArray(batch) || !batch.length) break;
    batch.forEach(function(row) {
      const fileId = String(row && row.file_id || '').trim();
      if (fileId) byId[fileId] = row || {};
    });
    if (batch.length < limit) break;
    offset += limit;
  }
  return byId;
}

function fetchPendingDriveAroundHistoryManifestRows_(limit) {
  const safeLimit = Math.max(1, Math.min(DRIVE_AROUND_HISTORY_PENDING_FETCH_LIMIT, Number(limit) || DRIVE_AROUND_HISTORY_PENDING_FETCH_LIMIT));
  const query = [
    'select=file_id,file_name,report_date,drive_modified_time,row_count,hold_row_count,status,error_message,raw',
    'status=in.(indexed,failed)',
    'order=report_date.asc,canonical_sequence.asc,file_name.asc',
    `limit=${safeLimit}`
  ].join('&');
  const url = `${SUPABASE_URL}/rest/v1/${DRIVE_AROUND_HISTORY_TABLE}?${query}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: getSupabaseHeaders_(),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error(`Pending Drive Around history lookup failed (${res.getResponseCode()}): ${res.getContentText()}`);
  }
  const rows = JSON.parse(res.getContentText() || '[]');
  return Array.isArray(rows) ? rows : [];
}

function driveAroundHistoryManifestHasRows_(manifestRow) {
  if (!manifestRow) return false;
  const status = String(manifestRow.status || '').trim().toLowerCase();
  const rowCount = Number(manifestRow.row_count || 0);
  if (status === 'empty') return true;
  return rowCount > 0 && ['row_indexed', 'processed', 'complete'].indexOf(status) !== -1;
}

function getDriveAroundHistoryManifestFolderPath_(manifestRow, fallback) {
  const safeFallback = String(fallback || '').trim();
  const raw = manifestRow && manifestRow.raw;
  if (!raw) return safeFallback;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return String(parsed && parsed.folder_path || safeFallback).trim() || safeFallback;
    } catch (err) {
      return safeFallback;
    }
  }
  return String(raw && raw.folder_path || safeFallback).trim() || safeFallback;
}

function normalizeDriveAroundHistoryHeaderKey_(header) {
  return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findDriveAroundHistoryColumnIndex_(headers, candidates) {
  const cleanHeaders = (headers || []).map(normalizeDriveAroundHistoryHeaderKey_);
  for (let i = 0; i < candidates.length; i++) {
    const candidate = normalizeDriveAroundHistoryHeaderKey_(candidates[i]);
    const index = cleanHeaders.indexOf(candidate);
    if (index > -1) return index;
  }
  return -1;
}

function getDriveAroundHistoryCell_(row, headers, candidates) {
  const index = findDriveAroundHistoryColumnIndex_(headers, candidates);
  if (index < 0) return '';
  return String(row[index] == null ? '' : row[index]).trim();
}

function getDriveAroundHistoryReportCell_(row, headers, key, aliases) {
  const safeKey = String(key || '').trim().toLowerCase();
  const candidates = Array.isArray(aliases) && aliases.length ? aliases : [safeKey];
  if (safeKey !== 'salesnote_1') return getDriveAroundHistoryCell_(row, headers, candidates);

  const explicitIndex = findDriveAroundHistoryColumnIndex_(headers, ['salesnote_1', 'salesnote 2']);
  if (explicitIndex > -1) return String(row[explicitIndex] == null ? '' : row[explicitIndex]).trim();
  const normalizedHeaders = (headers || []).map(normalizeDriveAroundHistoryHeaderKey_);
  let occurrence = 0;
  for (let index = 0; index < normalizedHeaders.length; index++) {
    if (normalizedHeaders[index] !== 'salesnote') continue;
    occurrence += 1;
    if (occurrence === 2) return String(row[index] == null ? '' : row[index]).trim();
  }
  return '';
}

function buildDriveAroundHistoryReportValues_(headers, row) {
  const values = {};
  DRIVE_AROUND_HISTORY_REPORT_COLUMN_SPECS.forEach(function(spec) {
    const key = spec[0];
    const aliases = spec[1] || [key];
    const value = getDriveAroundHistoryReportCell_(row, headers, key, aliases);
    values[key] = value === '' ? null : value;
  });
  return values;
}

function parseDriveAroundHistoryNumber_(value) {
  const text = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!text) return null;
  const number = Number(text);
  return isNaN(number) ? null : number;
}

function classifyDriveAroundHoldReason_(reason) {
  const text = String(reason || '').toLowerCase();
  if (/(aphid|mite|scale|thrip|snail|caterpillar|insect|bug|pest|borer|beetle)/.test(text)) return 'pest';
  if (/(fung|disease|leaf spot|phytophthora|rhizoctonia|botrytis|canker|mildew|rot|rust|anthracnose|blight|phomopsis|sclerotinia)/.test(text)) return 'fungal_disease';
  if (/(size|sizing|spec|height|too small|too short|too tall|caliper|under[ -]?size|undersized|not ready|not saleable|not ready to ship)/.test(text)) return 'size';
  if (/(leaf quality|leaf|foliar|chlorosis|yellow|necrosis|spotting|burn)/.test(text)) return 'leaf_quality';
  if (/(shear|sheared|trim|cutback|cut back|prune|pruned)/.test(text)) return 'sheared';
  if (/(freeze|frost|cold|heat|hail|weather|wind|drought|wet)/.test(text)) return 'weather_stress';
  return text.trim() ? 'other' : 'unknown';
}

function buildDriveAroundHistoryRowRawJson_(headers, row) {
  const raw = {};
  (headers || []).forEach(function(header, index) {
    const key = normalizePayloadColumnKey_(header) || `column_${index + 1}`;
    if (!key) return;
    const value = row[index];
    raw[key] = value == null ? null : String(value).trim();
  });
  return raw;
}

function buildDriveAroundHistorySnapshotRows_(file, rawData, manifestRow, nowIso) {
  if (!rawData || rawData.length < 2) return [];
  const headers = rawData[0].map(function(header) { return String(header || '').trim(); });
  const fileId = String(file.getId() || '').trim();
  const fileName = String(file.getName() || '').trim();
  const reportDate = manifestRow.report_date || parseDriveAroundReportDateString_(fileName);
  const rows = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] || [];
    const itemcode = getDriveAroundHistoryCell_(row, headers, ['itemcode', 'item code', 'item']);
    const commonname = getDriveAroundHistoryCell_(row, headers, ['commonname', 'common name', 'sortnamevariety', 'description']);
    const locationcode = getDriveAroundHistoryCell_(row, headers, ['locationcode', 'location code', 'location']);
    const lotcode = getDriveAroundHistoryCell_(row, headers, ['lotcode', 'lot code', 'lot']);
    const contsize = getDriveAroundHistoryCell_(row, headers, ['contsize', 'printedcontainercode', 'container sort', 'containersort', 'size']);
    const holdstopcode = getDriveAroundHistoryCell_(row, headers, ['holdstopcode', 'hold stop code']);
    const holdstopreason = getDriveAroundHistoryCell_(row, headers, ['holdstopreason', 'hold stop reason']);
    if (!itemcode && !commonname && !locationcode && !lotcode && !holdstopcode && !holdstopreason) continue;
    const rowNumber = i + 1;
    const raw = buildDriveAroundHistoryRowRawJson_(headers, row);
    const rowHash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(raw),
      Utilities.Charset.UTF_8
    )).replace(/=+$/g, '');
    const snapshotRow = {
      unique_id: `drive_around_row_${fileId}_${rowNumber}`.replace(/[^a-zA-Z0-9_-]+/g, '_'),
      file_id: fileId,
      file_name: fileName,
      report_date: reportDate,
      row_number: rowNumber,
      item_key: [
        itemcode,
        commonname,
        contsize,
        locationcode,
        lotcode
      ].map(function(value) { return String(value || '').trim().toLowerCase(); }).join('|'),
      itemcode: itemcode || null,
      commonname: commonname || null,
      genus: getDriveAroundHistoryCell_(row, headers, ['genus', 'genusname', 'genus name']) || null,
      contsize: contsize || null,
      locationcode: locationcode || null,
      lotcode: lotcode || null,
      season: getDriveAroundHistoryCell_(row, headers, ['season']) || null,
      blockalpha: getDriveAroundHistoryCell_(row, headers, ['blockalpha', 'block alpha', 'block']) || null,
      salesyear: getDriveAroundHistoryCell_(row, headers, ['salesyear', 'sale year', 'sales year']) || null,
      ptravailable: parseDriveAroundHistoryNumber_(getDriveAroundHistoryCell_(row, headers, ['ptravailable', 'ptr available'])),
      holdstopcode: holdstopcode || null,
      holdstopreason: holdstopreason || null,
      holdstopbegindate_raw: getDriveAroundHistoryCell_(row, headers, ['holdstopbegindate', 'hold stop begin date']) || null,
      hold_reason_category: classifyDriveAroundHoldReason_(holdstopreason),
      row_hash: rowHash,
      source_schema_version: DRIVE_AROUND_HISTORY_SOURCE_SCHEMA_VERSION,
      created_at: nowIso,
      updated_at: nowIso
    };
    const reportValues = buildDriveAroundHistoryReportValues_(headers, row);
    Object.keys(reportValues).forEach(function(key) {
      snapshotRow[key] = reportValues[key];
    });
    snapshotRow.ptravailable = parseDriveAroundHistoryNumber_(reportValues.ptravailable);
    snapshotRow.genus = reportValues.genusname || null;
    snapshotRow.salesyear = reportValues.saleyear || null;
    snapshotRow.holdstopbegindate_raw = reportValues.holdstopbegindate || null;
    rows.push(snapshotRow);
  }
  return rows;
}

function buildDriveAroundHistoryManifestRow_(file, folderPath, nowIso) {
  const fileId = String(file.getId() || '').trim();
  const fileName = String(file.getName() || '').trim();
  const mimeType = String(file.getMimeType() || '').trim();
  const modifiedAt = getDriveFileIsoDateSafe_(file, 'getLastUpdated');
  const canonical = resolveDriveAroundCanonicalDate_(file, { fallbackDate: new Date(nowIso) });
  const canonicalName = parseDriveAroundCanonicalFileName_(fileName);
  return {
    file_id: fileId,
    file_name: fileName,
    mime_type: mimeType || null,
    report_date: canonical.canonicalDate,
    drive_modified_time: modifiedAt,
    web_view_link: file.getUrl(),
    processed_at: nowIso,
    row_count: 0,
    hold_row_count: 0,
    status: 'indexed',
    error_message: null,
    original_file_name: fileName,
    canonical_file_name: canonicalName ? fileName : null,
    canonical_report_date: canonical.canonicalDate,
    canonical_sequence: canonicalName && canonicalName.sequence || null,
    canonical_date_source: canonical.canonicalDateSource,
    renamed_at: null,
    first_seen_at: canonical.firstSeenAt || nowIso,
    raw: {
      source: 'apps_script_drive_around_history_index',
      source_folder_id: DRIVE_AROUND_HISTORY_FOLDER_ID,
      folder_path: String(folderPath || ''),
      original_file_name: fileName,
      canonical_file_name: canonicalName ? fileName : null,
      canonical_report_date: canonical.canonicalDate,
      canonical_sequence: canonicalName && canonicalName.sequence || null,
      canonical_date_source: canonical.canonicalDateSource,
      parsed_file_name_date: canonical.parsedFileNameDate || null,
      size_bytes: getDriveFileSizeSafe_(file),
      created_at: getDriveFileIsoDateSafe_(file, 'getDateCreated'),
      modified_at: modifiedAt,
      indexed_at: nowIso
    }
  };
}

function shouldStopDriveAroundHistoryRun_(state) {
  return !!(state && state.runDeadlineMs && Date.now() >= state.runDeadlineMs);
}

function flushDriveAroundHistoryState_(state, force) {
  if (!state) return;
  const manifestCount = Array.isArray(state.manifestRows) ? state.manifestRows.length : 0;
  const snapshotCount = Array.isArray(state.snapshotRows) ? state.snapshotRows.length : 0;
  if (!force && !manifestCount && !snapshotCount) return;
  if (snapshotCount) {
    pushToSupabase(DRIVE_AROUND_HISTORY_ROW_TABLE, state.snapshotRows);
    state.snapshotUpsertCount += snapshotCount;
    state.snapshotRows = [];
  }
  if (manifestCount) {
    pushToSupabase(DRIVE_AROUND_HISTORY_TABLE, state.manifestRows);
    state.manifestUpsertCount += manifestCount;
    state.manifestRows = [];
  }
  if (manifestCount || snapshotCount) {
    console.log(`[DRIVE AROUND HISTORY] Flushed ${manifestCount} manifest row${manifestCount === 1 ? '' : 's'} and ${snapshotCount} row snapshot${snapshotCount === 1 ? '' : 's'} to Supabase.`);
  }
}

function maybeFlushDriveAroundHistoryState_(state) {
  if (!state) return;
  const snapshotCount = Array.isArray(state.snapshotRows) ? state.snapshotRows.length : 0;
  const manifestCount = Array.isArray(state.manifestRows) ? state.manifestRows.length : 0;
  if (snapshotCount >= DRIVE_AROUND_HISTORY_FLUSH_ROW_THRESHOLD || manifestCount >= Math.max(1, Math.floor(DRIVE_AROUND_HISTORY_MAX_PARSED_FILES_PER_RUN / 3))) {
    flushDriveAroundHistoryState_(state, true);
  }
}

function parseDriveAroundHistoryFileIntoState_(file, folderPath, seedManifestRow, state) {
  const fileName = String(file.getName() || '').trim();
  const manifestRow = buildDriveAroundHistoryManifestRow_(file, folderPath, state.nowIso);
  if (seedManifestRow && seedManifestRow.report_date) manifestRow.report_date = seedManifestRow.report_date;
  try {
    const rawData = extractDataFromFile(file, state.rootFolderId);
    const snapshotRows = buildDriveAroundHistorySnapshotRows_(file, rawData, manifestRow, state.nowIso);
    manifestRow.row_count = snapshotRows.length;
    manifestRow.hold_row_count = snapshotRows.filter(function(row) {
      const code = String(row && row.holdstopcode || '').trim().toUpperCase();
      return code === 'H' || code === 'S';
    }).length;
    manifestRow.status = snapshotRows.length ? 'row_indexed' : 'empty';
    manifestRow.error_message = null;
    state.manifestRows.push(manifestRow);
    Array.prototype.push.apply(state.snapshotRows, snapshotRows);
    state.parsedFiles++;
    state.rowsParsed += snapshotRows.length;
    console.log(`[DRIVE AROUND HISTORY] Parsed ${fileName}: ${snapshotRows.length} row snapshot${snapshotRows.length === 1 ? '' : 's'}.`);
    maybeFlushDriveAroundHistoryState_(state);
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    manifestRow.status = 'failed';
    manifestRow.error_message = errorMessage;
    state.manifestRows.push(manifestRow);
    state.parseFailedFiles.push({ name: fileName, error: errorMessage });
    console.error(`[DRIVE AROUND HISTORY] ${fileName} failed: ${errorMessage}`);
    maybeFlushDriveAroundHistoryState_(state);
  }
}

function collectDriveAroundHistoryManifestRows_(folder, folderPath, existingManifestById, state) {
  if (state.filesSeen >= state.maxFiles) return;
  const files = listDriveFilesWithRetry_(folder, `Drive Around history ${folderPath}`);
  while (files.hasNext() && state.filesSeen < state.maxFiles) {
    if (shouldStopDriveAroundHistoryRun_(state)) {
      state.stoppedForRunBudget = true;
      state.remainingUnparsed++;
      return;
    }
    const file = files.next();
    state.filesSeen++;
    const fileName = String(file.getName() || '').trim();
    const mimeType = String(file.getMimeType() || '').trim();
    if (!isDriveAroundHistoricalFileSupported_(fileName, mimeType)) {
      state.skippedUnsupported++;
      continue;
    }
    const fileId = String(file.getId() || '').trim();
    const existingManifest = fileId ? existingManifestById[fileId] : null;
    const manifestRow = buildDriveAroundHistoryManifestRow_(file, folderPath, state.nowIso);
    if (!state.parseRows) {
      if (existingManifest) {
        state.skippedExisting++;
        continue;
      }
      state.manifestRows.push(manifestRow);
      continue;
    }
    if (driveAroundHistoryManifestHasRows_(existingManifest)) {
      state.skippedExisting++;
      continue;
    }
    if (state.parsedFiles >= state.maxParsedFiles) {
      state.remainingUnparsed++;
      if (!existingManifest) state.manifestRows.push(manifestRow);
      continue;
    }
    parseDriveAroundHistoryFileIntoState_(file, folderPath, existingManifest, state);
  }
  const subfolders = listDriveSubfoldersWithRetry_(folder, `Drive Around history ${folderPath}`);
  while (subfolders.hasNext() && state.filesSeen < state.maxFiles) {
    if (shouldStopDriveAroundHistoryRun_(state)) {
      state.stoppedForRunBudget = true;
      state.remainingUnparsed++;
      return;
    }
    const subfolder = subfolders.next();
    const subfolderName = String(subfolder.getName() || '').trim();
    collectDriveAroundHistoryManifestRows_(subfolder, `${folderPath}/${subfolderName || 'Unnamed'}`, existingManifestById, state);
  }
}

function collectPendingDriveAroundHistoryRows_(pendingRows, state) {
  const rows = Array.isArray(pendingRows) ? pendingRows : [];
  for (let index = 0; index < rows.length; index++) {
    const manifestRow = rows[index];
    if (shouldStopDriveAroundHistoryRun_(state)) {
      state.stoppedForRunBudget = true;
      state.remainingUnparsed = Math.max(state.remainingUnparsed, rows.length - index);
      console.log(`[DRIVE AROUND HISTORY] Run budget reached. ${state.remainingUnparsed} fetched pending file${state.remainingUnparsed === 1 ? '' : 's'} left for the next wake-up.`);
      break;
    }
    if (state.parsedFiles >= state.maxParsedFiles) {
      state.remainingUnparsed = Math.max(state.remainingUnparsed, rows.length - index);
      break;
    }
    const fileId = String(manifestRow && manifestRow.file_id || '').trim();
    if (!fileId) continue;
    state.filesSeen++;
    try {
      const file = DriveApp.getFileById(fileId);
      const fileName = String(file.getName() || '').trim();
      const mimeType = String(file.getMimeType() || '').trim();
      if (!isDriveAroundHistoricalFileSupported_(fileName, mimeType)) {
        state.skippedUnsupported++;
        continue;
      }
      const folderPath = getDriveAroundHistoryManifestFolderPath_(manifestRow, 'Drive Around History');
      parseDriveAroundHistoryFileIntoState_(file, folderPath, manifestRow, state);
    } catch (err) {
      const errorMessage = err && err.message ? err.message : String(err);
      state.manifestRows.push({
        file_id: fileId,
        file_name: String(manifestRow && manifestRow.file_name || fileId),
        mime_type: null,
        report_date: manifestRow && manifestRow.report_date || null,
        drive_modified_time: manifestRow && manifestRow.drive_modified_time || null,
        web_view_link: null,
        processed_at: state.nowIso,
        row_count: Number(manifestRow && manifestRow.row_count || 0),
        hold_row_count: Number(manifestRow && manifestRow.hold_row_count || 0),
        status: 'failed',
        error_message: errorMessage,
        raw: {
          source: 'apps_script_drive_around_history_pending_parse',
          source_folder_id: DRIVE_AROUND_HISTORY_FOLDER_ID,
          prior_raw: manifestRow && manifestRow.raw || null,
          indexed_at: state.nowIso
        }
      });
      state.parseFailedFiles.push({ name: String(manifestRow && manifestRow.file_name || fileId), error: errorMessage });
      console.error(`[DRIVE AROUND HISTORY] ${fileId} failed: ${errorMessage}`);
      maybeFlushDriveAroundHistoryState_(state);
    }
  }
}

function syncDriveAroundHistoricalFileIndex_(options) {
  const safeOptions = options || {};
  const maxFiles = Math.max(1, Number(safeOptions.maxFiles) || DRIVE_AROUND_HISTORY_MAX_FILES_PER_RUN);
  const parseRows = safeOptions.parseRows !== false;
  const maxParsedFiles = Math.max(1, Number(safeOptions.maxParsedFiles) || DRIVE_AROUND_HISTORY_MAX_PARSED_FILES_PER_RUN);
  const pendingOnly = safeOptions.pendingOnly === true;
  const rootFolderId = String(safeOptions.folderId || DRIVE_AROUND_HISTORY_FOLDER_ID || FOLDERS.MASTER_PROCESSED || '').trim();
  if (!rootFolderId) throw new Error('Missing Drive Around history folder ID.');
  const started = new Date();
  const nowIso = started.toISOString();
  const requestedRunBudgetMs = Number(safeOptions.runBudgetMs) || DRIVE_AROUND_HISTORY_WORKSPACE_RUN_BUDGET_MS;
  const runBudgetMs = Math.max(3 * 60 * 1000, Math.min(28 * 60 * 1000, requestedRunBudgetMs));
  const state = {
    nowIso: nowIso,
    rootFolderId: rootFolderId,
    maxFiles: maxFiles,
    maxParsedFiles: maxParsedFiles,
    parseRows: parseRows,
    runDeadlineMs: started.getTime() + runBudgetMs,
    runBudgetMs: runBudgetMs,
    stoppedForRunBudget: false,
    filesSeen: 0,
    skippedExisting: 0,
    skippedUnsupported: 0,
    remainingUnparsed: 0,
    parsedFiles: 0,
    rowsParsed: 0,
    parseFailedFiles: [],
    manifestUpsertCount: 0,
    snapshotUpsertCount: 0,
    manifestRows: [],
    snapshotRows: []
  };
  let pendingRows = [];
  const pendingFetchLimit = Math.max(DRIVE_AROUND_HISTORY_PENDING_FETCH_LIMIT, maxParsedFiles + 1);
  if (pendingOnly && parseRows) {
    pendingRows = fetchPendingDriveAroundHistoryManifestRows_(pendingFetchLimit);
    collectPendingDriveAroundHistoryRows_(pendingRows, state);
  } else {
    const rootFolder = getDriveFolderByIdWithRetry_(rootFolderId, 'Drive Around historical processed folder');
    const existingManifestById = fetchExistingDriveAroundHistoryManifestMap_();
    collectDriveAroundHistoryManifestRows_(rootFolder, rootFolder.getName(), existingManifestById, state);
  }
  flushDriveAroundHistoryState_(state, true);
  if (pendingOnly && parseRows && pendingRows.length >= pendingFetchLimit && state.remainingUnparsed === 0) {
    state.remainingUnparsed = 1;
  }
  const summary = {
    filesSeen: state.filesSeen,
    filesProcessed: state.manifestUpsertCount,
    parsedFiles: state.parsedFiles,
    upsertCount: state.manifestUpsertCount + state.snapshotUpsertCount,
    totalRows: state.snapshotUpsertCount,
    rowSnapshotCount: state.snapshotUpsertCount,
    deleteCount: 0,
    tempFilesRemoved: 0,
    skippedExisting: state.skippedExisting,
    skippedUnsupported: state.skippedUnsupported,
    remainingUnparsed: state.remainingUnparsed,
    stoppedForRunBudget: state.stoppedForRunBudget,
    runBudgetMs: state.runBudgetMs,
    pendingOnly: pendingOnly,
    parseFailedFiles: state.parseFailedFiles,
    tableName: DRIVE_AROUND_HISTORY_TABLE,
    runId: Utilities.getUuid().replace(/-/g, '').slice(0, 10)
  };
  emitTableSyncLiveEvent_(DRIVE_AROUND_HISTORY_TABLE, summary);
  console.log(
    `[DONE] ${DRIVE_AROUND_HISTORY_TABLE}: ${state.manifestUpsertCount} manifest row${state.manifestUpsertCount === 1 ? '' : 's'} upserted | ` +
    `${state.snapshotUpsertCount} historical row snapshot${state.snapshotUpsertCount === 1 ? '' : 's'} upserted | ` +
    `${state.parsedFiles} file${state.parsedFiles === 1 ? '' : 's'} parsed | ${state.remainingUnparsed} still waiting for row parsing | ` +
    `${state.skippedExisting} existing skipped | ${state.skippedUnsupported} unsupported skipped | ${state.filesSeen} file${state.filesSeen === 1 ? '' : 's'} scanned` +
    `${state.stoppedForRunBudget ? ' | stopped at run budget for next wake-up' : ''}.`
  );
  return summary;
}

function removeDriveAroundHistoryBackfillTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DRIVE_AROUND_HISTORY_BACKFILL_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function scheduleDriveAroundHistoryBackfillTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  const hasTrigger = triggers.some(function(trigger) {
    return trigger.getHandlerFunction() === DRIVE_AROUND_HISTORY_BACKFILL_TRIGGER_HANDLER;
  });
  if (hasTrigger) return;
  ScriptApp.newTrigger(DRIVE_AROUND_HISTORY_BACKFILL_TRIGGER_HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(DRIVE_AROUND_HISTORY_BACKFILL_HOUR)
    .create();
}

function startDriveAroundHistoryBackfill() {
  removeDriveAroundHistoryBackfillTrigger_();
  scheduleDriveAroundHistoryBackfillTrigger_();
  return runDriveAroundHistoryBackfillChunk_();
}

function runDriveAroundHistoryBackfillChunk_() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) {
    scheduleDriveAroundHistoryBackfillTrigger_();
    console.log('[DRIVE AROUND HISTORY] Backfill already running. Keeping the recurring trigger active.');
    return { skippedLockedRun: true, remainingUnparsed: 1 };
  }
  try {
    const result = syncDriveAroundHistoricalFileIndex_({
      parseRows: true,
      pendingOnly: true,
      maxParsedFiles: DRIVE_AROUND_HISTORY_MAX_PARSED_FILES_PER_RUN,
      runBudgetMs: DRIVE_AROUND_HISTORY_BACKFILL_RUN_BUDGET_MS
    });
    if (Number(result && result.remainingUnparsed || 0) > 0) {
      scheduleDriveAroundHistoryBackfillTrigger_();
      console.log(`[DRIVE AROUND HISTORY] Backfill continuing. ${result.remainingUnparsed} file(s) still need row parsing.`);
    } else {
      removeDriveAroundHistoryBackfillTrigger_();
      console.log('[DRIVE AROUND HISTORY] Backfill complete. All indexed files that could be parsed have row snapshots.');
      result.learningRefresh = refreshHoldStopItemcodeLearningAfterHistory_('drive_around_history_backfill_complete');
    }
    return result;
  } finally {
    lock.releaseLock();
  }
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

function renameDriveFileWithRetry_(file, newName, label) {
  return withDriveRetry_(`Rename file: ${label}`, function() {
    return file.setName(newName);
  });
}

function getSupabaseFetchOptionsForTable_(tableName) {
  if (isMasterInventoryTable_(tableName)) {
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

function normalizeMasterImportValue_(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text || text.toUpperCase() === 'NULL') return '';
  return text;
}

function getMasterImportHoldStopTokens_(value) {
  const normalized = normalizeMasterImportValue_(value).toUpperCase();
  const tokens = {};
  if (normalized.indexOf('H') !== -1) tokens.H = true;
  if (normalized.indexOf('S') !== -1) tokens.S = true;
  return tokens;
}

function hasMasterImportBlockingHold_(value) {
  const tokens = getMasterImportHoldStopTokens_(value);
  return !!(tokens.H || tokens.S);
}

function parseMasterImportHoldReleaseDateMs_(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 10000 && value < 100000) {
      return Math.round((value - 25569) * 86400000);
    }
    return value;
  }
  const text = normalizeMasterImportValue_(value);
  if (!text) return null;
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return direct;
  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(.+))?$/);
  if (slashDate) {
    const month = String(slashDate[1]).padStart(2, '0');
    const day = String(slashDate[2]).padStart(2, '0');
    const rawYear = String(slashDate[3]);
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const time = slashDate[4] ? String(slashDate[4]).trim() : '00:00:00';
    const parsed = Date.parse(`${year}-${month}-${day}T${time}`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const dashDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(.+))?$/);
  if (dashDate) {
    const month = String(dashDate[2]).padStart(2, '0');
    const day = String(dashDate[3]).padStart(2, '0');
    const time = dashDate[4] ? String(dashDate[4]).trim() : '00:00:00';
    const parsed = Date.parse(`${dashDate[1]}-${month}-${day}T${time}`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function shouldSuppressMasterImportHoldByRelease_(nextRow, existingRow) {
  if (!nextRow || !existingRow) return false;
  if (!hasMasterImportBlockingHold_(nextRow.holdstopcode)) return false;
  const approvedAtMs = parseMasterImportHoldReleaseDateMs_(existingRow.hold_release_approved_at);
  if (approvedAtMs == null) return false;
  const beginValue = normalizeMasterImportValue_(nextRow.holdstopbegindate) || normalizeMasterImportValue_(existingRow.holdstopbegindate);
  const beginMs = parseMasterImportHoldReleaseDateMs_(beginValue);
  if (beginMs == null) return true;
  return beginMs <= approvedAtMs;
}

function suppressMasterImportHoldForApprovedRelease_(nextRow) {
  if (!nextRow) return nextRow;
  nextRow.holdstopcode = null;
  nextRow.holdstopreason = null;
  return nextRow;
}

function shouldPreserveMasterImportAppOwnedFields_(existingRow, nextRow) {
  if (!existingRow || !nextRow) return false;
  const existingHadBlockingHold = hasMasterImportBlockingHold_(existingRow.holdstopcode);
  const nextHasBlockingHold = hasMasterImportBlockingHold_(nextRow.holdstopcode);
  if (!existingHadBlockingHold && nextHasBlockingHold) return false;
  return true;
}

function hasExistingMasterImportAppOwnedValue_(existingRow) {
  if (!existingRow) return false;
  return MASTER_IMPORT_APP_OWNED_COLUMNS.some(function(column) {
    return normalizeMasterImportValue_(existingRow[column]) !== '';
  });
}

function preserveMasterImportAppOwnedFields_(nextRow, existingRow) {
  if (!nextRow || !existingRow) return nextRow;
  if (!shouldPreserveMasterImportAppOwnedFields_(existingRow, nextRow)) return nextRow;
  MASTER_IMPORT_APP_OWNED_COLUMNS.forEach(function(column) {
    const existingValue = existingRow[column];
    if (normalizeMasterImportValue_(existingValue) !== '') {
      nextRow[column] = existingValue;
    }
  });
  return nextRow;
}

function clearMasterImportAppOwnedFieldsForNewHold_(nextRow, existingRow) {
  if (!nextRow || !existingRow) return nextRow;
  if (!hasExistingMasterImportAppOwnedValue_(existingRow)) return nextRow;
  const existingHadBlockingHold = hasMasterImportBlockingHold_(existingRow.holdstopcode);
  const nextHasBlockingHold = hasMasterImportBlockingHold_(nextRow.holdstopcode);
  if (existingHadBlockingHold || !nextHasBlockingHold) return nextRow;
  MASTER_IMPORT_CLEAR_ON_NEW_HOLD_COLUMNS.forEach(function(column) {
    nextRow[column] = null;
  });
  return nextRow;
}

function applyMasterImportAppFieldRules_(nextRow, existingRow) {
  if (!nextRow || !existingRow) return nextRow;
  if (shouldSuppressMasterImportHoldByRelease_(nextRow, existingRow)) suppressMasterImportHoldForApprovedRelease_(nextRow);
  clearMasterImportAppOwnedFieldsForNewHold_(nextRow, existingRow);
  preserveMasterImportAppOwnedFields_(nextRow, existingRow);
  return nextRow;
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
  if (key === 'warehousei' || key === 'warehouse_id') key = 'warehouseid';
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
  return isMasterInventoryTable_(tableName);
}

function getStandardPayloadSelectColumns_(rawData) {
  const rawHeaders = Array.isArray(rawData) && Array.isArray(rawData[0]) ? rawData[0] : [];
  return collectAllowedPayloadColumnsFromHeaders_(rawHeaders, ['unique_id', 'contsize']);
}

function getMasterImportCompareColumns_() {
  const seen = {};
  const columns = [];
  MASTER_IMPORT_BASE_COMPARE_COLUMNS.concat(MASTER_IMPORT_APP_OWNED_COLUMNS).forEach(function(column) {
    const safeColumn = String(column || '').trim().toLowerCase();
    if (!safeColumn || seen[safeColumn]) return;
    seen[safeColumn] = true;
    columns.push(safeColumn);
  });
  return columns;
}

function getMasterPayloadSelectColumns_(rawData) {
  return getMasterImportCompareColumns_();
}

function getCavPayloadSelectColumns_() {
  return [
    'unique_id'
  ];
}

const CUSTOMER_REP_MAP_COLUMNS = Object.freeze([
  'customeridentityid', 'customername', 'customergroup', 'customergroupname',
  'customeraddress_1', 'customeraddress_2', 'customercity', 'customerstate',
  'customerzip', 'customercounty', 'customercountry', 'creditmanagerid',
  'creditmanagername', 'customerstatus', 'sortname', 'requirepo', 'ediworequired',
  'top10', 'mailings', 'majoracct', 'autoemail_inv', 'syninvoiceemail',
  'termscode', 'termsdescription', 'delayed_due_1', 'delayed_due_2',
  'tax_exempt_number', 'tax_exempt_date', 'combine_for_vip',
  'customerpurchasediscount', 'discount_applies', 'discounttype',
  'majorcommtype', 'groupapprovalrequired', 'edicustomer', 'edirollup',
  'ackversion', 'delversion', 'invversion', 'creditstatus', 'creditrating',
  'creditlimit', 'consigneegroup', 'consigneegroupname', 'consigneeid',
  'consigneename', 'consigneeaddress_1', 'consigneeaddress_2', 'consigneecity',
  'consigneestate', 'consigneezip', 'consigneecounty', 'consigneecountry',
  'salesrepid', 'salesrepname', 'territorycode', 'territorydesc',
  'cadisc_percent', 'custmajoracct', 'autoemailack', 'synemailack',
  'consigneetype', 'storenumber', 'tagcode', 'qacode', 'consigneestatus',
  'phfreightzone', 'txfreightzone', 'ncfreightzone', 'phpriceschedule',
  'txpriceschedule', 'ncpriceschedule', 'taxcode', 'nsy_lic_no', 'nsy_lic_exp',
  'generalloadinstr', 'okloadinst', 'txloadinst', 'ncloadinst',
  'driverdirections', 'consigneedeliverynote', 'primarycontactid',
  'primarycontactname', 'primarycontactphone', 'primarycontactcell',
  'primarycontactfax', 'primarycontactemail', 'secondarycontactid',
  'secondarycontactname', 'secondarycontactphone', 'secondarycontactcell',
  'secondarycontactfax', 'secondarycontactemail', 'principalcontactid',
  'principalcontactname', 'principalcontactphone', 'principalcontactcell',
  'principalcontactfax', 'principalcontactemail', 'billingcontactid',
  'billingcontactname', 'billingcontactphone', 'billingcontactcell',
  'billingcontactfax', 'billingcontactemail', 'shippingcontactid',
  'shippingcontactname', 'shippingcontactphone', 'shippingcontactcell',
  'shippingcontactfax', 'shippingcontactemail', 'shipcontactcommentstring',
  'cust_notes', 'sendstatements', 'emailstatements', 'statementsent'
]);

const CUSTOMER_REP_MAP_COLUMN_SET = new Set(CUSTOMER_REP_MAP_COLUMNS);

function normalizeCustomerRepMapColumnKey_(header) {
  const raw = String(header || '').trim();
  const upper = raw.toUpperCase().replace(/\s+/g, '');
  const specialMap = {
    'TAX_EXEMPT_#': 'tax_exempt_number',
    'TAXEXEMPT#': 'tax_exempt_number',
    'CADISC%': 'cadisc_percent',
    'CADISC_PERCENT': 'cadisc_percent'
  };
  if (specialMap[upper]) return specialMap[upper];
  return raw
    .toLowerCase()
    .replace(/%/g, '_percent')
    .replace(/#/g, '_number')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function isCustomerRepMapHeaderRow_(row) {
  if (!Array.isArray(row)) return false;
  const normalizedHeaders = row.map(normalizeCustomerRepMapColumnKey_).filter(Boolean);
  if (!normalizedHeaders.length) return false;
  const knownHeaderCount = normalizedHeaders.filter(function(header) {
    return CUSTOMER_REP_MAP_COLUMN_SET.has(header);
  }).length;
  const hasCustomer = normalizedHeaders.indexOf('customername') !== -1 || normalizedHeaders.indexOf('customeridentityid') !== -1;
  const hasConsignee = normalizedHeaders.indexOf('consigneename') !== -1 || normalizedHeaders.indexOf('consigneeid') !== -1;
  const hasSalesRep = normalizedHeaders.indexOf('salesrepname') !== -1 || normalizedHeaders.indexOf('salesrepid') !== -1;
  return knownHeaderCount >= 5 && hasCustomer && hasConsignee && hasSalesRep;
}

function getCustomerRepMapSelectColumns_() {
  return ['unique_id', 'row_hash'];
}

const WAREHOUSE_ASSIGNED_ITEM_COLUMNS = Object.freeze([
  'assignedto',
  'warehousei',
  'itemcode',
  'contsize',
  'commonname',
  'locationcode',
  'source',
  'genusname'
]);
const WAREHOUSE_ASSIGNED_ITEM_COLUMN_SET = new Set(WAREHOUSE_ASSIGNED_ITEM_COLUMNS);

function normalizeWarehouseAssignedItemsHeaderKey_(header) {
  const raw = String(header || '').trim();
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const map = {
    ASSIGNEDTO: 'assignedto',
    WAREHOUSEI: 'warehousei',
    WAREHOUSEID: 'warehousei',
    ITEMCODE: 'itemcode',
    CONTSIZE: 'contsize',
    COMMONNAME: 'commonname',
    LOCATIONCODE: 'locationcode',
    SOURCE: 'source',
    GENUSNAME: 'genusname',
    GENUS: 'genusname'
  };
  if (map[compact]) return map[compact];
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeWarehouseAssignedTo_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/@.+$/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const map = {
    abigal: 'abigail_vazquez',
    abigal_vazquez: 'abigail_vazquez',
    abigal_vazques: 'abigail_vazquez',
    abigail: 'abigail_vazquez',
    abigail_vasquez: 'abigail_vazquez',
    abigail_vazques: 'abigail_vazquez',
    abigail_vazquez: 'abigail_vazquez',
    boby: 'bobby_adair',
    bobby: 'bobby_adair',
    bobby_adair: 'bobby_adair',
    charley: 'charley_robertson',
    charley_robertson: 'charley_robertson',
    dylan: 'dylan_collyge',
    dylan_collyge: 'dylan_collyge',
    ellen: 'ellen_ward',
    ellen_ward: 'ellen_ward',
    jeroge: 'jorge_colunga',
    jeroge_colunga: 'jorge_colunga',
    jorge: 'jorge_colunga',
    jorge_colunga: 'jorge_colunga',
    josh: 'josh_vann',
    josh_vann: 'josh_vann',
    megan: 'megan_kelly',
    megan_kelly: 'megan_kelly',
    mitch: 'mitch_kaiser',
    mitch_kaiser: 'mitch_kaiser',
    zoe: 'zoe_green',
    zoe_green: 'zoe_green'
  };
  return map[key] || raw;
}

function isWarehouseAssignedItemsHeaderRow_(row) {
  if (!Array.isArray(row)) return false;
  const headers = row.map(normalizeWarehouseAssignedItemsHeaderKey_).filter(Boolean);
  if (!headers.length) return false;
  const knownHeaderCount = headers.filter(function(header) {
    return WAREHOUSE_ASSIGNED_ITEM_COLUMN_SET.has(header);
  }).length;
  return knownHeaderCount >= 4 &&
    headers.indexOf('assignedto') !== -1 &&
    headers.indexOf('warehousei') !== -1 &&
    headers.indexOf('itemcode') !== -1 &&
    headers.indexOf('genusname') !== -1;
}

function getWarehouseAssignedItemsSelectColumns_() {
  return ['unique_id', 'concat'];
}

function getWarehouseAssignedItemsRowIdentity_(fields, idTracker, rowNumber) {
  const baseParts = [
    fields.assignedto,
    fields.warehousei,
    fields.itemcode,
    fields.genusname
  ].map(function(value) {
    return String(value || '').trim();
  });
  let baseId = baseParts.join('-').replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!baseId) baseId = 'row-' + String(rowNumber || '');
  if (!baseId) return '';
  if (idTracker[baseId] === undefined) idTracker[baseId] = 0;
  else idTracker[baseId]++;
  return 'warehouse_assigned_' + baseId + (idTracker[baseId] > 0 ? '-' + idTracker[baseId] : '');
}

function buildWarehouseAssignedItemsPayload(rawData, tableName, existingRows, syncStartTime, fileName) {
  const rawHeaders = Array.isArray(rawData) && Array.isArray(rawData[0]) ? rawData[0].map(function(header) { return String(header || '').trim(); }) : [];
  const normalizedHeaders = rawHeaders.map(normalizeWarehouseAssignedItemsHeaderKey_);
  const getIdx = function(columnName) {
    return normalizedHeaders.indexOf(String(columnName || '').trim().toLowerCase());
  };
  const assignedToIdx = getIdx('assignedto');
  const itemCodeIdx = getIdx('itemcode');
  const upserts = [];
  const seenIds = new Set();
  const existingMap = buildExistingRowMap_(existingRows);
  const stats = createDeltaSyncStats_();
  const idTracker = {};
  let totalRows = 0;
  stats.sourceRows = Math.max(0, (rawData.length || 1) - 1);

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] || [];
    const assignedTo = assignedToIdx > -1 ? String(row[assignedToIdx] || '').trim() : '';
    const itemCode = itemCodeIdx > -1 ? String(row[itemCodeIdx] || '').trim() : '';
    const hasAnyValue = row.some(function(value) { return String(value || '').trim() !== ''; });
    if (!hasAnyValue) {
      stats.skippedRows++;
      continue;
    }
    if (!assignedTo || !itemCode) {
      stats.skippedRows++;
      continue;
    }

    totalRows++;
    const fields = {};
    const rawRow = {};
    for (let c = 0; c < normalizedHeaders.length; c++) {
      const key = normalizedHeaders[c];
      const header = rawHeaders[c] || key || ('column_' + (c + 1));
      const value = String(row[c] || '').trim();
      rawRow[header] = value;
      if (!WAREHOUSE_ASSIGNED_ITEM_COLUMN_SET.has(key)) continue;
      fields[key] = (value === '' || value.toUpperCase() === 'NULL') ? null : value;
    }
    if (fields.assignedto) fields.assignedto = normalizeWarehouseAssignedTo_(fields.assignedto);

    const uniqueId = getWarehouseAssignedItemsRowIdentity_(fields, idTracker, i + 1);
    if (!uniqueId) {
      stats.skippedRows++;
      continue;
    }
    stats.validIdentityRows++;

    const obj = {
      unique_id: uniqueId,
      assignedto: fields.assignedto || null,
      warehousei: fields.warehousei || null,
      itemcode: fields.itemcode || null,
      contsize: fields.contsize || null,
      commonname: fields.commonname || null,
      locationcode: fields.locationcode || null,
      source: fields.source || null,
      genusname: fields.genusname || null,
      sheet_row_number: i + 1,
      import_batch: syncStartTime,
      filename: fileName,
      last_updated: syncStartTime,
      raw_row: rawRow
    };
    obj.concat = buildRowSyncHash_(obj, ['raw_row', 'import_batch', 'created_at', 'updated_at']);

    seenIds.add(uniqueId);
    const existingRow = existingMap[uniqueId];
    if (!existingRow) {
      stats.insertedRows++;
      upserts.push(obj);
      continue;
    }
    if (String(existingRow.concat || existingRow.CONCAT || '').trim() !== String(obj.concat || '').trim()) {
      stats.changedRows++;
      upserts.push(obj);
      continue;
    }
    stats.unchangedRows++;
  }

  return { upserts: upserts, seenIds: seenIds, totalRows: totalRows, stats: stats };
}

function syncWarehouseAssignedItemsSheet_(sheetId, folderId, tableName) {
  return exportWarehouseAssignedItemsToSheet_(sheetId, tableName);
}

function callSupabaseRpc_(rpcName, payload) {
  const safeName = String(rpcName || '').trim();
  if (!safeName) throw new Error('Missing Supabase RPC name.');
  const response = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/rpc/' + encodeURIComponent(safeName),
    {
      method: 'post',
      contentType: 'application/json',
      headers: getSupabaseHeadersForKey_(SUPABASE_KEY, { Prefer: 'return=representation' }),
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    }
  );
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Supabase RPC ' + safeName + ' failed (' + status + ').');
  }
  return text ? JSON.parse(text) : null;
}

function exportWarehouseAssignedItemsToSheet_(sheetId, tableName) {
  const safeSheetId = String(sheetId || WAREHOUSE_ASSIGNED_ITEMS_SHEET_ID).trim();
  const safeTableName = String(tableName || WAREHOUSE_ASSIGNED_ITEMS_TABLE).trim();
  if (!safeSheetId) throw new Error('Missing Warehouse Assigned Items export sheet ID.');

  const maintenance = callSupabaseRpc_('run_request_integrity_maintenance', {});
  const rows = Object.values(fetchAllSupabaseData(
    safeTableName,
    'unique_id,itemcode,itemcode_normalized,assignedto,assigned_by,assigned_at,commonname,contsize,locationcode,present_in_drive,first_seen_at,last_seen_at,updated_at',
    getSupabaseFetchOptionsForTable_(safeTableName)
  )).sort(function(a, b) {
    return String(a.itemcode_normalized || a.itemcode || '').localeCompare(String(b.itemcode_normalized || b.itemcode || ''), undefined, { numeric: true });
  });

  const spreadsheet = SpreadsheetApp.openById(safeSheetId);
  const sheet = spreadsheet.getSheets()[0];
  const headers = [
    'ITEMCODE', 'ASSIGNEDTO', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE',
    'PRESENT_IN_DRIVE', 'ASSIGNED_BY', 'ASSIGNED_AT', 'FIRST_SEEN_AT',
    'LAST_SEEN_AT', 'UPDATED_AT'
  ];
  const values = [headers].concat(rows.map(function(row) {
    return [
      row.itemcode_normalized || row.itemcode || '',
      row.assignedto || '',
      row.commonname || '',
      row.contsize || '',
      row.locationcode || '',
      row.present_in_drive === true,
      row.assigned_by || '',
      row.assigned_at || '',
      row.first_seen_at || '',
      row.last_seen_at || '',
      row.updated_at || ''
    ];
  }));

  const existingRows = Math.max(1, sheet.getLastRow());
  const existingColumns = Math.max(headers.length, sheet.getLastColumn());
  sheet.getRange(1, 1, existingRows, existingColumns).clearContent();
  if (values.length) sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  emitTableSyncLiveEvent_(safeTableName, {
    direction: 'supabase_to_sheet',
    exportRows: rows.length,
    sourceSheetId: safeSheetId,
    maintenance: maintenance || {}
  });
  return {
    tableName: safeTableName,
    direction: 'supabase_to_sheet',
    filesProcessed: 1,
    failedFiles: 0,
    upsertCount: 0,
    deleteCount: 0,
    totalRows: rows.length,
    exportedRows: rows.length,
    maintenance: maintenance || {}
  };
}

function getPayloadSelectColumns_(tableName, rawData) {
  if (isMasterInventoryTable_(tableName)) return getMasterPayloadSelectColumns_(rawData);
  if (tableName === CUSTOMER_REP_MAP_TABLE) return getCustomerRepMapSelectColumns_();
  if (tableName === WAREHOUSE_ASSIGNED_ITEMS_TABLE) return getWarehouseAssignedItemsSelectColumns_();
  if (getSiteSplitLegacyTableName_(tableName) === 'ph_cav_import') return getCavPayloadSelectColumns_();
  return getStandardPayloadSelectColumns_(rawData);
}

function getMasterPayloadContext_(rawData, options) {
  const safeOptions = options || {};
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
  let warehouseIdIdx = getIdx('WAREHOUSEID');
  if (warehouseIdIdx === -1) warehouseIdIdx = getIdx('WAREHOUSEI');
  if (warehouseIdIdx === -1) warehouseIdIdx = getIdx('WAREHOUSE_ID');
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
      priority: getIdx('PRIORITY'),
      warehouseId: warehouseIdIdx
    },
    siteScoped: !!safeOptions.siteScoped,
    targetSite: normalizeSiteSplitSiteCode_(safeOptions.targetSite || '')
  };
}

function getMasterRowIdentity_(row, context, idTracker) {
  const indices = context && context.indices ? context.indices : {};
  const itemCodeStr = indices.itemCode > -1 ? String(row[indices.itemCode] || '').trim() : '';
  const locationCode = indices.locationCode > -1 ? String(row[indices.locationCode] || '').trim() : '';
  const commonName = indices.commonName > -1 ? String(row[indices.commonName] || '').trim() : '';
  const contSize = indices.contSize > -1 ? String(row[indices.contSize] || '').trim() : '-';
  const lotCode = indices.lotCode > -1 ? String(row[indices.lotCode] || '').trim() : '';
  const warehouseId = indices.warehouseId > -1 ? String(row[indices.warehouseId] || '').trim() : '';

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
  const rowSiteCode = warehouseId
    ? getSiteSplitSiteFromWarehouse_(warehouseId)
    : normalizeSiteSplitSiteCode_(context.targetSite || 'PH');
  const scopedBaseId = rowSiteCode !== 'PH'
    ? `${rowSiteCode}-${baseId}`
    : baseId;

  if (idTracker[scopedBaseId] === undefined) idTracker[scopedBaseId] = 0;
  else idTracker[scopedBaseId]++;

  let uniqueId = scopedBaseId;
  if (idTracker[scopedBaseId] > 0) uniqueId += '-' + idTracker[scopedBaseId];

  return {
    valid: Boolean(uniqueId),
    uniqueId: uniqueId,
    contSize: contSize
  };
}

function previewMasterSnapshotFile_(rawData, tableName) {
  const context = getMasterPayloadContext_(rawData, {
    siteScoped: isSiteSplitPhysicalTable_(tableName),
    targetSite: getSiteCodeFromSiteSplitTableName_(tableName)
  });
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
    headers: getSupabaseHeaders_({ 'Prefer': 'count=exact' }),
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
         headers: getSupabaseHeaders_(),
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
      headers: getSupabaseHeaders_(),
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
      headers: getSupabaseHeaders_(),
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
          headers: getSupabaseHeaders_(),
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
  let activeSelectColumns = normalizeSupabaseSelectColumns_(selectColumns).split(',').map(function(column) {
    return String(column || '').trim();
  }).filter(Boolean);
  const ignoredMissingColumns = [];

  for (let attempt = 1; attempt <= 5; attempt++) {
    const chunkPlan = chunkSupabaseIdsForInFilter_(tableName, ids, activeSelectColumns);
    let rows = [];
    let missingColumnMap = {};
    let hardFailure = null;

    const requests = chunkPlan.chunks.map(function(chunk) {
      return {
        url: `${chunkPlan.prefix}${chunk.join(',')}${chunkPlan.suffix}`,
        method: 'get',
        headers: getSupabaseHeaders_(),
        muteHttpExceptions: true
      };
    });

    for (let index = 0; index < requests.length; index += batchSize) {
      const batch = requests.slice(index, index + batchSize);
      const responses = executeFetchAllBatches(batch, batch.length);
      responses.forEach(function(res, responseIndex) {
        if (res.getResponseCode() !== 200) {
          const chunkNumber = index + responseIndex + 1;
          const body = res.getContentText();
          extractMissingSupabaseColumnNames_(body).forEach(function(column) {
            if (column && column !== 'unique_id') missingColumnMap[column] = true;
          });
          if (!Object.keys(missingColumnMap).length && !hardFailure) {
            hardFailure = new Error(`Supabase by-ID lookup failed for ${tableName} chunk ${chunkNumber} (${res.getResponseCode()}): ${body}`);
          }
          return;
        }

        const responseRows = JSON.parse(res.getContentText() || '[]');
        if (Array.isArray(responseRows) && responseRows.length) rows = rows.concat(responseRows);
      });
      if (Object.keys(missingColumnMap).length || hardFailure) break;
      if (interChunkDelayMs > 0 && index + batchSize < requests.length) Utilities.sleep(interChunkDelayMs);
    }

    const missingColumns = Object.keys(missingColumnMap).filter(function(column) {
      return ignoredMissingColumns.indexOf(column) === -1;
    });
    if (missingColumns.length) {
      ignoredMissingColumns.push.apply(ignoredMissingColumns, missingColumns);
      console.warn(`[WARN] Supabase schema is missing ${tableName} lookup column(s): ${missingColumns.join(', ')}. Retrying lookup without those fields.`);
      const removeSet = {};
      missingColumns.forEach(function(column) { removeSet[String(column || '').trim().toLowerCase()] = true; });
      activeSelectColumns = activeSelectColumns.filter(function(column) {
        return !removeSet[String(column || '').trim().toLowerCase()];
      });
      if (!activeSelectColumns.length) activeSelectColumns = ['unique_id'];
      continue;
    }

    if (hardFailure) throw hardFailure;
    return rows;
  }

  throw new Error(`Supabase by-ID lookup failed for ${tableName}: schema column retry limit exceeded.`);
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
    headers: getSupabaseHeaders_({
      'Prefer': 'count=exact'
    }),
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

function callSupabaseRpc_(functionName, payload) {
  const safeFunctionName = String(functionName || '').trim();
  if (!safeFunctionName) throw new Error('Missing Supabase RPC function name.');
  const url = `${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(safeFunctionName)}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: getSupabaseHeaders_({
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }),
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error(`Supabase RPC ${safeFunctionName} failed (${code}): ${body}`);
  }
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (err) {
    return body;
  }
}

function refreshHoldStopItemcodeLearningAfterHistory_(reason) {
  const started = new Date();
  try {
    const result = callSupabaseRpc_(HOLD_STOP_LEARNING_REFRESH_RPC, {
      p_job_name: 'drivearound_history_learning_refresh',
      p_item_batch_size: 200,
      p_summary_batch_size: 1000
    });
    const summary = {
      success: true,
      reason: String(reason || 'drive_around_history_backfill'),
      result: result,
      elapsedMs: new Date().getTime() - started.getTime()
    };
    emitTableSyncLiveEvent_(HOLD_STOP_ITEMCODE_SUMMARY_TABLE, summary);
    console.log(`[HOLD STOP LEARNING] Queued chunked itemcode H/S summary refresh after ${summary.reason} in ${summary.elapsedMs}ms.`);
    return summary;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const summary = {
      success: false,
      reason: String(reason || 'drive_around_history_backfill'),
      error: message,
      elapsedMs: new Date().getTime() - started.getTime()
    };
    emitTableSyncLiveEvent_(HOLD_STOP_ITEMCODE_SUMMARY_TABLE, summary);
    console.error(`[HOLD STOP LEARNING] Refresh failed after ${summary.reason}: ${message}`);
    return summary;
  }
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
    headers: getSupabaseHeaders_({
      'Prefer': 'return=minimal,count=exact'
    }),
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
  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ Dropped to 5 to protect against URL length limits with long SOC/Reserve IDs
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
        headers: getSupabaseHeaders_(),
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
      headers: getSupabaseHeaders_(),
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
      headers: getSupabaseHeaders_({ 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      payload: JSON.stringify(chunk), 
      muteHttpExceptions: true
    });
  }
  if(requests.length > 0) {
    let responses = executeFetchAllBatches(requests, SUPABASE_UPSERT_FETCH_BATCH_SIZE); 
    responses.forEach(res => {
        let code = res.getResponseCode();
        if (code !== 200 && code !== 201 && code !== 204) {
            console.error(`ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Supabase Insert Error (Code ${code}): ${res.getContentText()}`);
        }
    });
  }
}

// Override the legacy upsert helper so failed Supabase responses stop the sync immediately.
function buildSupabaseUpsertRequests_(tableName, payloadArray) {
  const chunkSize = isMasterInventoryTable_(tableName) ? SUPABASE_MASTER_UPSERT_CHUNK_SIZE : 1000;
  let requests = [];
  for (let i = 0; i < payloadArray.length; i += chunkSize) {
    const chunk = normalizeSupabaseUpsertChunk(payloadArray.slice(i, i + chunkSize));
    requests.push(buildSupabaseUpsertRequest_(tableName, chunk));
  }
  return requests;
}

function buildSupabaseUpsertRequest_(tableName, normalizedChunk) {
  return {
    url: `${SUPABASE_URL}/rest/v1/${tableName}`,
    method: 'post',
    headers: getSupabaseHeaders_({
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    }),
    payload: JSON.stringify(normalizedChunk || []),
    muteHttpExceptions: true
  };
}

function isSuccessfulSupabaseWriteResponse_(response) {
  const code = response.getResponseCode();
  return code === 200 || code === 201 || code === 204;
}

function extractSupabaseErrorCode_(body) {
  try {
    const parsed = JSON.parse(String(body || ''));
    return String(parsed && parsed.code || '').trim().toUpperCase();
  } catch (error) {
    return '';
  }
}

function isRetryableSupabaseUpsertFailure_(httpCode, body) {
  const code = Number(httpCode) || 0;
  const dbCode = extractSupabaseErrorCode_(body);
  const retryableDbCodes = {
    '40001': true,
    '40P01': true,
    '55P03': true,
    '57014': true
  };
  if (retryableDbCodes[dbCode]) return true;
  if ([408, 425, 429, 502, 503, 504].indexOf(code) !== -1) return true;
  if (code !== 500) return false;
  const message = String(body || '').toLowerCase();
  return message.includes('statement timeout') ||
    message.includes('canceling statement') ||
    message.includes('temporarily unavailable') ||
    message.includes('internal server error') ||
    message.includes('backend error');
}

function retrySupabaseUpsertRequest_(tableName, request, initialResponse, requestNumber) {
  let response = initialResponse;
  for (let attempt = 2; attempt <= SUPABASE_UPSERT_RETRY_COUNT; attempt++) {
    const code = response.getResponseCode();
    const body = response.getContentText();
    if (!isRetryableSupabaseUpsertFailure_(code, body)) break;
    console.warn(`[RETRY] Transient Supabase upsert failure for ${tableName} chunk ${requestNumber} ` +
      `(Code ${code}, attempt ${attempt}/${SUPABASE_UPSERT_RETRY_COUNT}).`);
    Utilities.sleep(SUPABASE_UPSERT_RETRY_DELAY_MS * (attempt - 1));
    response = UrlFetchApp.fetch(request.url, request);
    if (isSuccessfulSupabaseWriteResponse_(response)) break;
  }
  return response;
}

function executeSupabaseUpsertRequestWithRecovery_(tableName, request, initialResponse, requestNumber, splitDepth) {
  if (isSuccessfulSupabaseWriteResponse_(initialResponse)) return [];
  const depth = Math.max(0, Number(splitDepth) || 0);
  const initialBody = initialResponse.getContentText();
  let payloadRows = [];
  try {
    const parsed = JSON.parse(String(request && request.payload || '[]'));
    payloadRows = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    payloadRows = [];
  }

  if (isMasterInventoryTable_(tableName) &&
      extractSupabaseErrorCode_(initialBody) === '57014' &&
      payloadRows.length > SUPABASE_MASTER_UPSERT_MIN_SPLIT_SIZE) {
    const midpoint = Math.ceil(payloadRows.length / 2);
    const splitChunks = [payloadRows.slice(0, midpoint), payloadRows.slice(midpoint)].filter(function(chunk) {
      return chunk.length > 0;
    });
    console.warn(`[SPLIT] Supabase timed out for ${tableName} chunk ${requestNumber} ` +
      `(${payloadRows.length} rows). Retrying as ${splitChunks.map(function(chunk) { return chunk.length; }).join(' + ')} rows.`);
    let splitFailures = [];
    splitChunks.forEach(function(chunk, index) {
      const splitRequest = buildSupabaseUpsertRequest_(tableName, chunk);
      const splitResponse = UrlFetchApp.fetch(splitRequest.url, splitRequest);
      splitFailures = splitFailures.concat(executeSupabaseUpsertRequestWithRecovery_(
        tableName,
        splitRequest,
        splitResponse,
        `${requestNumber}.${index + 1}`,
        depth + 1
      ));
    });
    return splitFailures;
  }

  const response = retrySupabaseUpsertRequest_(tableName, request, initialResponse, requestNumber);
  if (isSuccessfulSupabaseWriteResponse_(response)) return [];
  const body = response.getContentText();
  if (isMasterInventoryTable_(tableName) &&
      extractSupabaseErrorCode_(body) === '57014' &&
      payloadRows.length > SUPABASE_MASTER_UPSERT_MIN_SPLIT_SIZE) {
    return executeSupabaseUpsertRequestWithRecovery_(tableName, request, response, requestNumber, depth + 1);
  }
  return [{ code: response.getResponseCode(), body: body }];
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
  const fetchBatchSize = isMasterInventoryTable_(tableName)
    ? SUPABASE_MASTER_UPSERT_FETCH_BATCH_SIZE
    : SUPABASE_UPSERT_FETCH_BATCH_SIZE;
  let responses = executeFetchAllBatches(requests, fetchBatchSize);
  let failures = [];
  responses.forEach(function(initialResponse, index) {
    const requestFailures = executeSupabaseUpsertRequestWithRecovery_(
      tableName,
      requests[index],
      initialResponse,
      index + 1,
      0
    );
    requestFailures.forEach(function(failure) {
      console.error(`[ERROR] Supabase upsert failed for ${tableName} (Code ${failure.code}): ${failure.body}`);
      failures.push(failure);
    });
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
          isMasterInventoryTable_(tableName) ? getMasterImportCompareColumns_().join(',') : 'unique_id'
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
    const rawData = extractDataFromFile(newestFile, dropFolderId, options);
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
    const preview = previewMasterSnapshotFile_(entry.rawData, tableName);
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
    getMasterImportCompareColumns_(),
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

function filterMasterRawDataBySite_(rawData, siteCode) {
  const safeSite = normalizeSiteSplitSiteCode_(siteCode);
  if (!Array.isArray(rawData) || rawData.length < 1) return rawData;
  const context = getMasterPayloadContext_(rawData);
  const warehouseIdx = context && context.indices ? context.indices.warehouseId : -1;
  const filtered = [rawData[0]];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] || [];
    const rowSite = warehouseIdx > -1
      ? getSiteSplitSiteFromWarehouse_(row[warehouseIdx])
      : 'PH';
    if (rowSite === safeSite) filtered.push(row);
  }
  return filtered;
}

function processSiteSplitMasterSnapshotBatchFolder_(dropFolderId, processedFolderId) {
  const dropFolder = getDriveFolderByIdWithRetry_(dropFolderId, 'site split drive around drop folder');
  const processedFolder = getDriveFolderByIdWithRetry_(processedFolderId, 'site split drive around processed folder');
  const files = listDriveFilesWithRetry_(dropFolder, 'site split drive around drop folder');
  const pendingFiles = [];
  let tempFilesRemoved = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    if (fileName.startsWith('TEMP_')) {
      tempFilesRemoved++;
      trashDriveFileWithRetry_(file, `site split drive around temp file ${fileName}`);
      continue;
    }
    pendingFiles.push(file);
  }

  if (!pendingFiles.length) {
    console.log('[SKIP] No files found for site split drive around.');
    return {
      tableName: 'site_split_master_inventory',
      filesProcessed: 0,
      tempFilesRemoved: tempFilesRemoved,
      failedFiles: 0,
      failedFileNames: [],
      upsertCount: 0,
      deleteCount: 0,
      diagnosticsBySite: {}
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
  const resultsBySite = {};
  let totalUpserts = 0;
  let totalDeletes = 0;
  let importSucceeded = false;

  console.log(`[START] Processing site split Drive Around snapshot batch: ${pendingFiles.length} file(s)`);

  try {
    pendingFiles.forEach(function(file) {
      const fileName = file.getName();
      console.log(`[PARSE][SITE SPLIT] ${fileName}`);
      const rawData = extractDataFromFile(file, dropFolderId);
      if (!rawData || rawData.length < 1) {
        throw new Error(`No readable rows were found in ${fileName}.`);
      }
      parsedFiles.push({ file: file, fileName: fileName, rawData: rawData });
    });

    let anySiteRows = false;
    SITE_SPLIT_SITE_CODES_.forEach(function(siteCode) {
      const tableName = resolveSiteSplitTableName_('ph_master_inventory', siteCode);
      const siteParsedFiles = parsedFiles
        .map(function(entry) {
          return {
            file: entry.file,
            fileName: entry.fileName,
            rawData: filterMasterRawDataBySite_(entry.rawData, siteCode)
          };
        })
        .filter(function(entry) {
          return Array.isArray(entry.rawData) && entry.rawData.length > 1;
        });

      if (!siteParsedFiles.length) {
        console.log(`[SITE SPLIT][${siteCode}] No rows found; skipping destructive sync for ${tableName}.`);
        resultsBySite[siteCode] = {
          tableName: tableName,
          skipped: true,
          upsertCount: 0,
          deleteCount: 0,
          diagnostics: createDeltaSyncStats_()
        };
        return;
      }

      anySiteRows = true;
      const masterResults = executeMasterSnapshotBatch_(tableName, siteParsedFiles, buildMasterPayload, syncStartTime);
      const upserts = masterResults.upserts || [];
      const deletes = masterResults.deletes || [];
      totalUpserts += upserts.length;
      totalDeletes += deletes.length;

      console.log(formatDeltaSyncStats_(tableName, masterResults.combinedStats, {
        filesProcessed: siteParsedFiles.length,
        archivedOlderFiles: 0,
        upserts: upserts.length
      }));

      if (upserts.length > 0) pushToSupabase(tableName, upserts);
      if (deletes.length > 0) deleteFromSupabase(tableName, deletes);
      emitTableSyncLiveEvent_(tableName, {
        filesProcessed: siteParsedFiles.length,
        tempFilesRemoved: tempFilesRemoved,
        upsertCount: upserts.length,
        deleteCount: deletes.length
      });

      resultsBySite[siteCode] = {
        tableName: tableName,
        skipped: false,
        upsertCount: upserts.length,
        deleteCount: deletes.length,
        diagnostics: masterResults.combinedStats
      };
    });

    if (!anySiteRows) throw new Error('No PH/TX/NC/HL Drive Around rows were found; skipped site split sync.');

    const namingSummary = moveAndNormalizeDriveAroundProcessedFiles_(parsedFiles, processedFolder, { nowIso: syncStartTime });
    if (namingSummary && namingSummary.warnings && namingSummary.warnings.length) {
      console.warn(`[DRIVE AROUND NAME] ${namingSummary.warnings.join(' | ')}`);
    }
    importSucceeded = true;
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    failedFiles.push.apply(failedFiles, pendingFiles.map(function(file) {
      return { name: file.getName(), error: errorMessage };
    }));
    console.error(`[ERROR] Failed site split Drive Around batch: ${err && err.stack ? err.stack : errorMessage}`);
    console.warn('[LEAVE] Keeping pending site split Drive Around files in drop folder for retry/manual review.');
  }

  console.log(
    `[DONE] site split Drive Around: ${importSucceeded ? `${pendingFiles.length} snapshot file${pendingFiles.length === 1 ? '' : 's'} processed` : 'snapshot batch failed'}` +
    `${failedFiles.length ? ` | ${failedFiles.length} file${failedFiles.length === 1 ? '' : 's'} left in drop` : ''}` +
    ` | ${totalDeletes} removed row${totalDeletes === 1 ? '' : 's'}` +
    ` | ${totalUpserts} row${totalUpserts === 1 ? '' : 's'} upserted` +
    `${tempFilesRemoved ? ` | ${tempFilesRemoved} temp file${tempFilesRemoved === 1 ? '' : 's'} cleared` : ''}.`
  );

  return {
    tableName: 'site_split_master_inventory',
    filesProcessed: importSucceeded ? pendingFiles.length : 0,
    tempFilesRemoved: tempFilesRemoved,
    failedFiles: failedFiles.length,
    failedFileNames: failedFiles.map(function(entry) { return entry.name; }),
    failedFileErrors: failedFiles,
    upsertCount: totalUpserts,
    deleteCount: totalDeletes,
    diagnosticsBySite: resultsBySite
  };
}

function runSiteSplitDriveAroundOnly_() {
  return processSiteSplitMasterSnapshotBatchFolder_(FOLDERS.MASTER_DROP, FOLDERS.MASTER_PROCESSED);
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

    let namingSummary = null;
    if (isMasterInventoryTable_(tableName) && String(processedFolderId || '') === String(FOLDERS.MASTER_PROCESSED || '')) {
      namingSummary = moveAndNormalizeDriveAroundProcessedFiles_(parsedFiles, processedFolder, { nowIso: syncStartTime });
      if (namingSummary && namingSummary.warnings && namingSummary.warnings.length) {
        console.warn(`[DRIVE AROUND NAME] ${namingSummary.warnings.join(' | ')}`);
      }
    } else {
      parsedFiles.forEach(function(entry) {
        moveDriveFileToFolderWithRetry_(entry.file, processedFolder, `${tableName} processed snapshot file ${entry.fileName}`);
      });
    }
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
  const logicalTable = getSiteSplitLegacyTableName_(tableName);
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
  let reserveStableIdIdx = logicalTable === 'ph_reserves' ? findReserveStableRowIdIndex_(cleanHeaders) : -1;
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
    if (logicalTable === 'ph_soc_master' && (!dockVal || dockVal === '0' || dockVal === '' || !custVal)) continue;
    if (logicalTable === 'ph_reserves' && !custVal) continue;

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
    if (logicalTable === 'ph_reserves' && reserveStableIdIdx > -1) {
      uniqueId = String(row[reserveStableIdIdx] || '').trim();
    }
    if (!uniqueId) {
      let baseId = logicalTable === 'ph_reserves'
        ? `${transVal}-${custVal}-${consVal}-${repVal}-${itemCodeVal}-${contSizeVal}-${locVal}-${lotVal}-${srcVal}-${priVal}-${dItemVal}`
        : `${dockVal}-${transVal}-${custVal}-${consVal}-${stopVal}-${itemCodeVal}-${contSizeVal}-${locVal}-${lotVal}-${srcVal}-${priVal}-${dItemVal}`;
      let cleanId = baseId.replace(/[^a-zA-Z0-9-]/g, '_');
      if (idTracker[cleanId] === undefined) idTracker[cleanId] = 0; else idTracker[cleanId]++;
      uniqueId = cleanId;
      if (idTracker[cleanId] > 0) uniqueId += '-' + idTracker[cleanId];
      if (logicalTable === 'ph_reserves') stats.fallbackIdentityRows++;
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

function buildCustomerRepMapPayload(rawData, tableName, existingRows, syncStartTime, fileName) {
  const rawHeaders = Array.isArray(rawData) && Array.isArray(rawData[0]) ? rawData[0].map(function(header) { return String(header || '').trim(); }) : [];
  const normalizedHeaders = rawHeaders.map(normalizeCustomerRepMapColumnKey_);
  const getIdx = function(columnName) {
    return normalizedHeaders.indexOf(String(columnName || '').trim().toLowerCase());
  };
  const customerIdIdx = getIdx('customeridentityid');
  const customerNameIdx = getIdx('customername');
  const consigneeIdIdx = getIdx('consigneeid');
  const consigneeNameIdx = getIdx('consigneename');
  const salesRepIdIdx = getIdx('salesrepid');
  const salesRepNameIdx = getIdx('salesrepname');
  const territoryIdx = getIdx('territorycode');

  const upserts = [];
  const seenIds = new Set();
  const existingMap = buildExistingRowMap_(existingRows);
  const stats = createDeltaSyncStats_();
  stats.sourceRows = Math.max(0, (rawData.length || 1) - 1);
  let totalRows = 0;
  const stagedRows = {};

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] || [];
    const customerName = customerNameIdx > -1 ? String(row[customerNameIdx] || '').trim() : '';
    const consigneeName = consigneeNameIdx > -1 ? String(row[consigneeNameIdx] || '').trim() : '';
    const salesRepName = salesRepNameIdx > -1 ? String(row[salesRepNameIdx] || '').trim() : '';
    if (!customerName && !consigneeName && !salesRepName) {
      stats.skippedRows++;
      continue;
    }
    totalRows++;
    stats.validIdentityRows++;

    const identityParts = [
      customerIdIdx > -1 ? row[customerIdIdx] : '',
      customerName,
      consigneeIdIdx > -1 ? row[consigneeIdIdx] : '',
      consigneeName,
      salesRepIdIdx > -1 ? row[salesRepIdIdx] : '',
      salesRepName,
      territoryIdx > -1 ? row[territoryIdx] : ''
    ].map(function(value) { return String(value || '').trim(); });
    const identitySource = identityParts.join('|') || `${fileName}|${i}`;
    const identityDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, identitySource, Utilities.Charset.UTF_8);
    const uniqueId = 'cust_rep_' + Utilities.base64EncodeWebSafe(identityDigest).replace(/=+$/g, '').slice(0, 48);
    const obj = {
      unique_id: uniqueId,
      filename: fileName,
      source_file_name: fileName,
      source_row_number: i + 1,
      imported_at: syncStartTime,
      updated_at: syncStartTime
    };
    for (let c = 0; c < normalizedHeaders.length; c++) {
      const key = normalizedHeaders[c];
      if (!CUSTOMER_REP_MAP_COLUMN_SET.has(key)) continue;
      const value = String(row[c] || '').trim();
      obj[key] = (value === '' || value.toUpperCase() === 'NULL') ? null : value;
    }
    obj.row_hash = buildRowSyncHash_(obj, ['imported_at', 'updated_at']);
    stagedRows[uniqueId] = obj;
  }

  Object.keys(stagedRows).forEach(function(uniqueId) {
    const obj = stagedRows[uniqueId];
    seenIds.add(uniqueId);
    const existingRow = existingMap[uniqueId];
    if (!existingRow) {
      stats.insertedRows++;
      upserts.push(obj);
      return;
    }
    if (String(existingRow.row_hash || existingRow.ROW_HASH || '').trim() !== String(obj.row_hash || '').trim()) {
      stats.changedRows++;
      upserts.push(obj);
      return;
    }
    stats.unchangedRows++;
  });

  return { upserts, seenIds, totalRows, stats };
}

function parseMasterAssignmentLocationBlock_(locationCode) {
  const match = String(locationCode || '').trim().toUpperCase().match(/^([A-Z])\.(\d{1,2})(?:\.|$)/);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isFinite(number)) return null;
  return { block: match[1], number: Math.round(number) };
}

function isMasterZoeGreenHostaArea_(locationCode) {
  const parts = parseMasterAssignmentLocationBlock_(locationCode);
  if (!parts) return false;
  if (parts.block === 'D') return parts.number >= 6 && parts.number <= 10;
  if (parts.block === 'C') return parts.number === 6 || parts.number === 7;
  return false;
}

function getMasterAssignedToOverride_(row) {
  if (!row) return '';
  const commonName = String(row.commonname || row.COMMONNAME || row.description || row.DESCRIPTION || '').trim().toLowerCase();
  const genusName = String(row.genusname || row.GENUSNAME || row.genus || row.GENUS || '').trim().toLowerCase();
  const plantGroupCode = String(row.plantgroupcode || row.PLANTGROUPCODE || row.plantgroup || row.PLANTGROUP || '').trim().toUpperCase();
  if (genusName.indexOf('hydrangea m') !== -1) return 'megan_kelly';
  if (plantGroupCode === '140_GRASS') return 'dylan_collyge';
  if ((commonName + ' ' + genusName).indexOf('hosta') === -1) return '';
  const locationCode = String(row.locationcode || row.LOCATIONCODE || row.location || row.LOCATION || '').trim();
  return isMasterZoeGreenHostaArea_(locationCode) ? 'zoe_green' : 'bobby_adair';
}

function buildMasterPayload(rawData, tableName, existingRows, syncStartTime, fileName) {
  const context = getMasterPayloadContext_(rawData, {
    siteScoped: isSiteSplitPhysicalTable_(tableName),
    targetSite: getSiteCodeFromSiteSplitTableName_(tableName)
  });
  const rawHeaders = context.rawHeaders;
  const upserts = [];
  const seenIds = new Set();
  const idTracker = {};
  let totalRows = 0;
  const existingMap = buildExistingRowMap_(existingRows);
  const stats = createDeltaSyncStats_();
  stats.sourceRows = Math.max(0, (rawData.length || 1) - 1);

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

    const existingRow = existingMap[uniqueId];
    applyMasterImportAppFieldRules_(obj, existingRow);

    const existingAssignedTo = existingRow && existingRow.assignedto
      ? String(existingRow.assignedto).trim()
      : '';

    const assignedToOverride = getMasterAssignedToOverride_(obj) || getMasterAssignedToOverride_(existingRow);
    obj.assignedto = assignedToOverride || existingAssignedTo || null;
    obj.concat = buildRowSyncHash_(obj, ['assignedto']);

    seenIds.add(uniqueId);
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

function extractDataFromFile(file, folderId, options) {
  const mime = file.getMimeType();
  const originalFileName = String(file.getName() || '').trim();
  const normalizedFileName = originalFileName.toLowerCase();
  const headerMatcher = options && typeof options.headerMatcher === 'function' ? options.headerMatcher : null;
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
    const headerScanLimit = headerMatcher ? Math.min(50, allValues.length) : Math.min(15, allValues.length);
    for (let r = 0; r < headerScanLimit; r++) {
      if (headerMatcher && headerMatcher(allValues[r])) {
        headerRowIdx = r;
        break;
      }
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

const HL_PO_PARSED_REQUIRED_COLUMNS = Object.freeze([
  'item_code',
  'lot',
  'size',
  'common_name',
  'po_ordered',
  'genus',
  'po_comments',
  'lot_pend_rec',
  'seas_on_hand',
  'po_received',
  'po_remain'
]);

const HL_PO_PARSED_REQUIRED_INPUT_COLUMNS = Object.freeze([
  'item_code',
  'lot',
  'size',
  'common_name',
  'po_ordered',
  'lot_pend_rec',
  'seas_on_hand',
  'po_remain'
]);

const HL_PO_PARSED_HEADER_ALIASES = Object.freeze({
  item_code: ['item_code', 'item code', 'itemcode', 'item'],
  lot: ['lot', 'lot code', 'lotcode'],
  size: ['size', 'container size', 'cont size', 'contsize', 'printed container code', 'printedcontainercode'],
  common_name: ['common_name', 'common name', 'commonname'],
  po_ordered: ['po_ordered', 'po ordered', 'poordered', 'total quantity ordered', 'totalquantityordered', 'quantity ordered', 'quantityordered'],
  genus: ['genus', 'genus name', 'genusname'],
  po_comments: ['po_comments', 'po comments', 'p o comments', 'po comment', 'comments', 'comment'],
  lot_pend_rec: ['lot_pend_rec', 'lot pend rec', 'lot pend received', 'lot pending rec', 'lotpendrec'],
  seas_on_hand: ['seas_on_hand', 'seas on hand', 'season on hand', 'season oh', 'season onhand', 'seasonoh', 'ptronhand', 'ptr on hand'],
  po_received: ['po_received', 'po received', 'poreceived'],
  po_remain: ['po_remain', 'po remain', 'po remaining', 'poremain']
});

const HL_PO_PARSED_NUMERIC_COLUMNS = Object.freeze({
  po_ordered: true,
  lot_pend_rec: true,
  seas_on_hand: true,
  po_received: true,
  po_remain: true
});

function normalizeHlPoHeaderKey_(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildHlPoHeaderAliasMap_() {
  const aliasMap = {};
  Object.keys(HL_PO_PARSED_HEADER_ALIASES).forEach(function(columnName) {
    (HL_PO_PARSED_HEADER_ALIASES[columnName] || []).forEach(function(alias) {
      const key = normalizeHlPoHeaderKey_(alias);
      if (key) aliasMap[key] = columnName;
    });
  });
  return aliasMap;
}

const HL_PO_PARSED_HEADER_ALIAS_MAP = Object.freeze(buildHlPoHeaderAliasMap_());

function getHlPoHeaderMatch_(row) {
  const indexByColumn = {};
  (row || []).forEach(function(header, index) {
    const columnName = HL_PO_PARSED_HEADER_ALIAS_MAP[normalizeHlPoHeaderKey_(header)];
    if (columnName && indexByColumn[columnName] == null) indexByColumn[columnName] = index;
  });
  const missing = HL_PO_PARSED_REQUIRED_INPUT_COLUMNS.filter(function(columnName) {
    return indexByColumn[columnName] == null;
  });
  return missing.length ? null : indexByColumn;
}

function findHlPoHeaderRow_(values) {
  const scanLimit = Math.min(75, Array.isArray(values) ? values.length : 0);
  for (let r = 0; r < scanLimit; r++) {
    const row = values[r] || [];
    const match = getHlPoHeaderMatch_(row);
    if (match) return { rowIndex: r, indexByColumn: match };
  }
  return null;
}

function formatHlPoRequiredHeaderList_() {
  return HL_PO_PARSED_REQUIRED_INPUT_COLUMNS.join(', ');
}

function isHlPoParsedFileSupported_(file) {
  const fileName = String(file.getName() || '').toLowerCase();
  const mime = String(file.getMimeType() || '').toLowerCase();
  return mime === String(MimeType.CSV).toLowerCase() ||
    fileName.endsWith('.csv') ||
    mime === GOOGLE_SHEETS_MIME_TYPE ||
    isExcelLikeFile_(mime, fileName);
}

function hasHlPoNonBlankCells_(values) {
  return (Array.isArray(values) ? values : []).some(function(row) {
    return (Array.isArray(row) ? row : []).some(function(value) {
      return value != null && String(value).replace(/\u00a0/g, ' ').trim() !== '';
    });
  });
}

function extractHlPoParsedSheet_(file, folderId) {
  const fileName = String(file.getName() || '').trim();
  const normalizedFileName = fileName.toLowerCase();
  const mime = String(file.getMimeType() || '').trim();
  let tempSheetId = '';

  try {
    if (mime === MimeType.CSV || normalizedFileName.endsWith('.csv')) {
      const csvValues = Utilities.parseCsv(file.getBlob().getDataAsString());
      if (!hasHlPoNonBlankCells_(csvValues)) {
        throw createHlPoParsedError_('HL_PO_EMPTY_SHEET', `No data was found in ${fileName}.`);
      }
      const csvHeaderMatch = findHlPoHeaderRow_(csvValues);
      if (!csvHeaderMatch) {
        throw createHlPoParsedError_('HL_PO_MISSING_HEADERS', `No required HL PO header row found in ${fileName}. Required headers: ${formatHlPoRequiredHeaderList_()}.`);
      }
      return {
        values: csvValues,
        sourceSheetName: 'CSV',
        headerRowIndex: csvHeaderMatch.rowIndex,
        indexByColumn: csvHeaderMatch.indexByColumn
      };
    }

    let sheetId = file.getId();
    if (isExcelLikeFile_(mime, normalizedFileName)) {
      tempSheetId = createTempGoogleSheetFromExcel_(file, folderId);
      sheetId = tempSheetId;
    }

    const ss = tempSheetId
      ? openSpreadsheetWithRetry_(sheetId, fileName)
      : SpreadsheetApp.openById(sheetId);
    const sheets = ss.getSheets();
    if (!sheets || !sheets.length) throw createHlPoParsedError_('HL_PO_EMPTY_WORKBOOK', `No sheets found in ${fileName}.`);

    let hasNonBlankSheet = false;
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i];
      const values = sheet.getDataRange().getValues();
      if (hasHlPoNonBlankCells_(values)) hasNonBlankSheet = true;
      const headerMatch = findHlPoHeaderRow_(values);
      if (headerMatch) {
        return {
          values: values,
          sourceSheetName: sheet.getName(),
          headerRowIndex: headerMatch.rowIndex,
          indexByColumn: headerMatch.indexByColumn
        };
      }
    }

    if (!hasNonBlankSheet) {
      throw createHlPoParsedError_('HL_PO_EMPTY_SHEET', `No data was found in any sheet/tab in ${fileName}.`);
    }

    throw createHlPoParsedError_('HL_PO_MISSING_HEADERS', `No sheet/tab in ${fileName} has all required HL PO headers: ${formatHlPoRequiredHeaderList_()}.`);
  } finally {
    cleanupTempGoogleSheet_(tempSheetId, fileName);
  }
}

function parseHlPoReportDate_(file) {
  const fileName = String(file.getName() || '');
  const match = fileName.match(/(20\d{2}-\d{2}-\d{2})/);
  if (match) return match[1];
  return Utilities.formatDate(file.getDateCreated(), HL_PO_PARSED_TIMEZONE, 'yyyy-MM-dd');
}

function getHlPoCellValue_(row, indexByColumn, columnName) {
  const index = indexByColumn[columnName];
  return index == null ? null : row[index];
}

function normalizeHlPoTextValue_(value) {
  if (value == null) return null;
  const text = String(value).replace(/\u00a0/g, ' ').trim();
  if (!text || text.toUpperCase() === 'NULL') return null;
  return text;
}

function createHlPoParsedError_(code, message) {
  const safeCode = String(code || 'HL_PO_PARSE_FAILED').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  const error = new Error(`[${safeCode}] ${String(message || 'HL PO Parsed failed.').trim()}`);
  error.code = safeCode;
  return error;
}

function parseHlPoNumericValue_(value, columnName, rowNumber, fileName) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;
  const rawText = String(value).replace(/\u00a0/g, ' ').trim();
  if (!rawText || rawText.toUpperCase() === 'NULL' || rawText === '-' || rawText === '--') return null;
  let cleaned = rawText.replace(/[$,%]/g, '').replace(/,/g, '').trim();
  if (/^\([0-9.]+\)$/.test(cleaned)) cleaned = '-' + cleaned.slice(1, -1);
  const numericValue = Number(cleaned);
  if (isNaN(numericValue)) {
    throw createHlPoParsedError_('HL_PO_ROWS_REJECTED', `Invalid numeric value for ${columnName} at row ${rowNumber} in ${fileName}: "${rawText}".`);
  }
  return numericValue;
}

function isHlPoParsedDataRowBlank_(row, indexByColumn) {
  return HL_PO_PARSED_REQUIRED_INPUT_COLUMNS.every(function(columnName) {
    const value = getHlPoCellValue_(row, indexByColumn, columnName);
    return value == null || String(value).replace(/\u00a0/g, ' ').trim() === '';
  });
}

function buildHlPoParsedRows_(file, sheetData, runId, importedAt) {
  const fileName = String(file.getName() || '').trim();
  const fileId = String(file.getId() || '').trim();
  const reportDate = parseHlPoReportDate_(file);
  const rows = [];

  for (let r = sheetData.headerRowIndex + 1; r < sheetData.values.length; r++) {
    const row = sheetData.values[r] || [];
    const rowNumber = r + 1;
    if (isHlPoParsedDataRowBlank_(row, sheetData.indexByColumn)) continue;

    const parsedRow = {
      source_file_id: fileId,
      source_file_name: fileName,
      source_sheet_name: sheetData.sourceSheetName,
      report_date: reportDate,
      run_id: runId,
      row_index: rowNumber,
      imported_at: importedAt
    };

    HL_PO_PARSED_REQUIRED_COLUMNS.forEach(function(columnName) {
      const value = getHlPoCellValue_(row, sheetData.indexByColumn, columnName);
      parsedRow[columnName] = HL_PO_PARSED_NUMERIC_COLUMNS[columnName]
        ? parseHlPoNumericValue_(value, columnName, rowNumber, fileName)
        : normalizeHlPoTextValue_(value);
    });

    rows.push(parsedRow);
  }

  return rows;
}

function upsertHlPoParsedRows_(tableName, rows) {
  const payloadRows = Array.isArray(rows) ? rows : [];
  if (!payloadRows.length) return 0;

  const chunkSize = 500;
  const requests = [];
  for (let i = 0; i < payloadRows.length; i += chunkSize) {
    const chunk = normalizeSupabaseUpsertChunk(payloadRows.slice(i, i + chunkSize));
    requests.push({
      url: `${SUPABASE_URL}/rest/v1/${tableName}?on_conflict=source_file_id,row_index`,
      method: 'post',
      headers: getSupabaseHeaders_({
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      }),
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
  }

  const responses = executeFetchAllBatches(requests, SUPABASE_UPSERT_FETCH_BATCH_SIZE);
  responses.forEach(function(response) {
    const code = response.getResponseCode();
    if (code !== 200 && code !== 201 && code !== 204) {
      throw new Error(`Supabase HL PO upload failed (${code}): ${response.getContentText()}`);
    }
  });

  return payloadRows.length;
}

function syncHlPoParsedFolder_(sourceFolderId, processedFolderId, tableName) {
  const safeTableName = String(tableName || HL_PO_PARSED_TABLE).trim();
  if (String(sourceFolderId || '').trim() === String(processedFolderId || '').trim()) {
    throw new Error('HL PO Parsed source and processed folders must be different.');
  }
  const sourceFolder = getDriveFolderByIdWithRetry_(sourceFolderId, `${safeTableName} source folder`);
  const processedFolder = getDriveFolderByIdWithRetry_(processedFolderId, `${safeTableName} processed folder`);
  const files = listDriveFilesWithRetry_(sourceFolder, `${safeTableName} source folder`);
  const pendingFiles = [];
  const failedFiles = [];
  let tempFilesRemoved = 0;
  let unsupportedFiles = 0;
  let filesProcessed = 0;
  let upsertCount = 0;
  let totalRows = 0;
  const runId = Utilities.getUuid();

  while (files.hasNext()) {
    const file = files.next();
    const fileName = String(file.getName() || '').trim();
    if (fileName.startsWith('TEMP_')) {
      tempFilesRemoved++;
      trashDriveFileWithRetry_(file, `${safeTableName} temp file ${fileName}`);
      continue;
    }
    if (!isHlPoParsedFileSupported_(file)) {
      unsupportedFiles++;
      console.log(`[HL PO] Skipping unsupported file in source folder: ${fileName}`);
      continue;
    }
    pendingFiles.push(file);
  }

  pendingFiles.sort(function(a, b) {
    const timeDiff = a.getDateCreated().getTime() - b.getDateCreated().getTime();
    if (timeDiff !== 0) return timeDiff;
    return String(a.getName() || '').localeCompare(String(b.getName() || ''));
  });

  pendingFiles.forEach(function(file) {
    const fileName = String(file.getName() || '').trim();
    console.log(`[HL PO] Processing ${fileName} -> ${safeTableName}`);
    try {
      const importedAt = new Date().toISOString();
      const sheetData = extractHlPoParsedSheet_(file, sourceFolderId);
      const rows = buildHlPoParsedRows_(file, sheetData, runId, importedAt);
      if (!rows.length) {
        throw createHlPoParsedError_('HL_PO_NO_IMPORTABLE_ROWS', `No importable HL PO rows found in ${fileName} on sheet ${sheetData.sourceSheetName}. The sheet has a valid header but no nonblank data rows.`);
      }
      const uploadedRows = upsertHlPoParsedRows_(safeTableName, rows);
      moveDriveFileToFolderWithRetry_(file, processedFolder, `${safeTableName} processed file ${fileName}`);
      filesProcessed++;
      upsertCount += uploadedRows;
      totalRows += rows.length;
      console.log(`[HL PO] Uploaded ${uploadedRows} row${uploadedRows === 1 ? '' : 's'} from ${fileName}; moved to processed.`);
    } catch (err) {
      const errorMessage = err && err.message ? err.message : String(err);
      const errorCode = String(err && err.code || 'HL_PO_PARSE_FAILED').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
      failedFiles.push({ name: fileName, error: errorMessage, errorCode: errorCode });
      console.error(`[HL PO] Failed ${fileName}: ${err && err.stack ? err.stack : errorMessage}`);
      console.warn(`[HL PO] Keeping ${fileName} in source folder for correction/retry.`);
    }
  });

  if (!pendingFiles.length) {
    console.log(`[HL PO] No supported pending files found for ${safeTableName}.`);
  }

  console.log(
    `[HL PO] Done: ${filesProcessed} file${filesProcessed === 1 ? '' : 's'} processed` +
    ` | ${upsertCount} row${upsertCount === 1 ? '' : 's'} uploaded` +
    `${failedFiles.length ? ` | ${failedFiles.length} failed file${failedFiles.length === 1 ? '' : 's'} left in source` : ''}` +
    `${unsupportedFiles ? ` | ${unsupportedFiles} unsupported file${unsupportedFiles === 1 ? '' : 's'} skipped` : ''}` +
    `${tempFilesRemoved ? ` | ${tempFilesRemoved} temp file${tempFilesRemoved === 1 ? '' : 's'} cleared` : ''}.`
  );

  if (filesProcessed > 0) {
    emitTableSyncLiveEvent_(safeTableName, {
      filesProcessed: filesProcessed,
      tempFilesRemoved: tempFilesRemoved,
      upsertCount: upsertCount,
      deleteCount: 0,
      totalRows: totalRows,
      runId: runId
    });
  }

  return {
    tableName: safeTableName,
    filesProcessed: filesProcessed,
    tempFilesRemoved: tempFilesRemoved,
    unsupportedFiles: unsupportedFiles,
    failedFiles: failedFiles.length,
    failedFileNames: failedFiles.map(function(entry) { return entry.name; }),
    failedFileErrors: failedFiles,
    upsertCount: upsertCount,
    deleteCount: 0,
    totalRows: totalRows,
    runId: runId
  };
}

const TRANSACTIONS_KEYED_COLUMNS = Object.freeze([
  { header: 'Transaction Date', key: 'transaction_datetime', type: 'datetime' },
  { header: 'Invoice Date', key: 'invoice_datetime', type: 'datetime' },
  { header: 'Commit Date', key: 'commit_datetime', type: 'datetime' },
  { header: 'Code - Item', key: 'code_item', type: 'text' },
  { header: 'Description 1 - Item', key: 'description_1_item', type: 'text' },
  { header: 'Code - Lot', key: 'code_lot', type: 'text' },
  { header: 'Code - Location', key: 'code_location', type: 'text' },
  { header: 'Source', key: 'source', type: 'text' },
  { header: 'Code 2 - Detail', key: 'code_2_detail', type: 'text' },
  { header: 'DesigItem', key: 'desig_item', type: 'text' },
  { header: 'Code 5 - Detail', key: 'code_5_detail', type: 'text' },
  { header: 'DesigCust', key: 'desig_cust', type: 'text' },
  { header: 'Code 3 - Detail', key: 'code_3_detail', type: 'text' },
  { header: 'DesigLoc', key: 'desig_loc', type: 'text' },
  { header: 'Code 4 - Detail', key: 'code_4_detail', type: 'text' },
  { header: 'Out Ordered - Transaction Location', key: 'out_ordered_transaction_location', type: 'number' },
  { header: 'Quantity', key: 'quantity', type: 'number' },
  { header: 'Code 1 - Detail', key: 'code_1_detail', type: 'text' },
  { header: 'Reference', key: 'reference', type: 'text' },
  { header: 'Status', key: 'transaction_status', type: 'text' },
  { header: 'Created By - Detail', key: 'created_by_detail', type: 'text' },
  { header: 'Transaction Number', key: 'transaction_number', type: 'text' },
  { header: 'Date 1 - Detail', key: 'date_1_detail', type: 'datetime' },
  { header: 'Reference 1 - Detail', key: 'reference_1_detail', type: 'text' },
  { header: 'Reference 2 - Detail', key: 'reference_2_detail', type: 'text' },
  { header: 'Program', key: 'program', type: 'text' },
  { header: 'Module', key: 'module', type: 'text' },
  { header: 'Transaction Type', key: 'transaction_type', type: 'text' },
  { header: 'Stage', key: 'stage', type: 'text' },
  { header: 'Shipping Date - OM Transaction Header', key: 'shipping_datetime_om_transaction_header', type: 'datetime' },
  { header: 'Ship To Name - OM Transaction Header', key: 'ship_to_name_om_transaction_header', type: 'text' },
  { header: 'FM PU Stop Number - OM Transaction Header', key: 'fm_pu_stop_number_om_transaction_header', type: 'text' },
  { header: 'FM Trip Number - OM Transaction Header', key: 'fm_trip_number_om_transaction_header', type: 'text' },
  { header: 'Ordered Quantity', key: 'ordered_quantity', type: 'number' },
  { header: 'Shipped Quantity - OM Transaction Detail', key: 'shipped_quantity_om_transaction_detail', type: 'number' },
  { header: 'Price', key: 'price', type: 'number' },
  { header: 'Amount', key: 'amount', type: 'number' },
  { header: 'Reference 1 - Lot', key: 'reference_1_lot', type: 'text' },
  { header: 'Reference 2 - Lot', key: 'reference_2_lot', type: 'text' },
  { header: 'Reference 4 - Lot', key: 'reference_4_lot', type: 'text' }
]);

function normalizeTransactionsKeyedHeader_(value) {
  return String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const TRANSACTIONS_KEYED_COLUMN_BY_HEADER = Object.freeze(TRANSACTIONS_KEYED_COLUMNS.reduce(function(map, column) {
  map[normalizeTransactionsKeyedHeader_(column.header)] = column;
  return map;
}, {}));

function inspectTransactionsKeyedHeaderRow_(row) {
  const cells = Array.isArray(row) ? row : [];
  const normalized = cells.map(normalizeTransactionsKeyedHeader_);
  const recognizedCount = normalized.filter(function(key) { return !!TRANSACTIONS_KEYED_COLUMN_BY_HEADER[key]; }).length;
  const candidate = recognizedCount >= 8 && normalized.indexOf('transactiondate') >= 0 && normalized.indexOf('createdbydetail') >= 0;
  if (!candidate) return { candidate: false, valid: false };

  const indexByKey = {};
  const duplicateHeaders = [];
  const unexpectedHeaders = [];
  normalized.forEach(function(headerKey, index) {
    if (!headerKey) return;
    const column = TRANSACTIONS_KEYED_COLUMN_BY_HEADER[headerKey];
    if (!column) {
      unexpectedHeaders.push(String(cells[index] || '').trim());
      return;
    }
    if (indexByKey[column.key] != null) duplicateHeaders.push(column.header);
    else indexByKey[column.key] = index;
  });
  const missingHeaders = TRANSACTIONS_KEYED_COLUMNS.filter(function(column) {
    return indexByKey[column.key] == null;
  }).map(function(column) { return column.header; });

  return {
    candidate: true,
    valid: !missingHeaders.length && !duplicateHeaders.length && !unexpectedHeaders.length,
    indexByKey: indexByKey,
    missingHeaders: missingHeaders,
    duplicateHeaders: duplicateHeaders,
    unexpectedHeaders: unexpectedHeaders
  };
}

function isTransactionsKeyedFileSupported_(file) {
  const fileName = String(file && file.getName ? file.getName() : '').toLowerCase();
  const mime = String(file && file.getMimeType ? file.getMimeType() : '').toLowerCase();
  return (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) && isExcelLikeFile_(mime, fileName);
}

function formatTransactionsKeyedHeaderError_(sheetName, headerRowNumber, inspection) {
  const parts = [];
  if (inspection.missingHeaders && inspection.missingHeaders.length) parts.push('missing: ' + inspection.missingHeaders.join(', '));
  if (inspection.duplicateHeaders && inspection.duplicateHeaders.length) parts.push('duplicated: ' + inspection.duplicateHeaders.join(', '));
  if (inspection.unexpectedHeaders && inspection.unexpectedHeaders.length) parts.push('unexpected: ' + inspection.unexpectedHeaders.join(', '));
  return `Invalid Transactions Keyed headers on ${sheetName} row ${headerRowNumber} (${parts.join('; ')}).`;
}

function extractTransactionsKeyedSheet_(file, folderId) {
  const fileName = String(file.getName() || '').trim();
  let tempSheetId = '';
  try {
    tempSheetId = createTempGoogleSheetFromExcel_(file, folderId);
    const spreadsheet = openSpreadsheetWithRetry_(tempSheetId, fileName);
    const sheets = spreadsheet.getSheets();
    const validMatches = [];
    const invalidCandidates = [];

    sheets.forEach(function(sheet) {
      const values = sheet.getDataRange().getValues();
      const displayValues = sheet.getDataRange().getDisplayValues();
      const scanLimit = Math.min(75, displayValues.length);
      for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
        const inspection = inspectTransactionsKeyedHeaderRow_(displayValues[rowIndex]);
        if (!inspection.candidate) continue;
        if (inspection.valid) {
          validMatches.push({
            values: values,
            displayValues: displayValues,
            sourceSheetName: sheet.getName(),
            headerRowIndex: rowIndex,
            indexByKey: inspection.indexByKey
          });
        } else {
          invalidCandidates.push(formatTransactionsKeyedHeaderError_(sheet.getName(), rowIndex + 1, inspection));
        }
        break;
      }
    });

    if (validMatches.length > 1) {
      throw new Error(`Multiple sheets in ${fileName} contain the complete Transactions Keyed header set.`);
    }
    if (!validMatches.length) {
      if (invalidCandidates.length) throw new Error(invalidCandidates[0]);
      throw new Error(`No sheet in ${fileName} contains the exact 40-column Transactions Keyed header set.`);
    }
    if (invalidCandidates.length) {
      throw new Error(`Ambiguous Transactions Keyed workbook ${fileName}: ${invalidCandidates[0]}`);
    }
    return validMatches[0];
  } finally {
    cleanupTempGoogleSheet_(tempSheetId, fileName);
  }
}

function bytesToSha256Hex_(bytes) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes || []);
  return digest.map(function(value) {
    return ((value + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function getTransactionsKeyedFileHash_(file) {
  return bytesToSha256Hex_(file.getBlob().getBytes());
}

function normalizeTransactionsKeyedText_(value) {
  if (value == null) return null;
  const text = String(value).replace(/\u00a0/g, ' ').trim();
  return text === '' ? null : text;
}

function parseTransactionsKeyedNumber_(value, columnName, rowNumber, fileName) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error(`Invalid numeric ${columnName} at row ${rowNumber} in ${fileName}.`);
    return value;
  }
  const raw = String(value).replace(/\u00a0/g, ' ').trim();
  if (!raw) return null;
  let cleaned = raw.replace(/[$,%]/g, '').replace(/,/g, '').trim();
  if (/^\([0-9.+-]+\)$/.test(cleaned)) cleaned = '-' + cleaned.slice(1, -1);
  const parsed = Number(cleaned);
  if (!isFinite(parsed)) throw new Error(`Invalid numeric ${columnName} at row ${rowNumber} in ${fileName}.`);
  return parsed;
}

function padTransactionsKeyedDatePart_(value) {
  return String(value).padStart(2, '0');
}

function buildTransactionsKeyedTimestamp_(year, month, day, hour, minute, second, columnName, rowNumber, fileName) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const hh = Number(hour || 0);
  const mm = Number(minute || 0);
  const ss = Number(second || 0);
  const check = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d ||
      check.getUTCHours() !== hh || check.getUTCMinutes() !== mm || check.getUTCSeconds() !== ss) {
    throw new Error(`Invalid date ${columnName} at row ${rowNumber} in ${fileName}.`);
  }
  return `${String(y).padStart(4, '0')}-${padTransactionsKeyedDatePart_(m)}-${padTransactionsKeyedDatePart_(d)}` +
    `T${padTransactionsKeyedDatePart_(hh)}:${padTransactionsKeyedDatePart_(mm)}:${padTransactionsKeyedDatePart_(ss)}`;
}

function parseTransactionsKeyedDateTime_(value, columnName, rowNumber, fileName) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) throw new Error(`Invalid date ${columnName} at row ${rowNumber} in ${fileName}.`);
    return Utilities.formatDate(value, TRANSACTIONS_KEYED_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error(`Invalid date ${columnName} at row ${rowNumber} in ${fileName}.`);
    const excelDate = new Date(Math.round((value - 25569) * 86400000));
    return Utilities.formatDate(excelDate, 'UTC', "yyyy-MM-dd'T'HH:mm:ss");
  }

  const raw = String(value).replace(/\u00a0/g, ' ').trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (match) {
    return buildTransactionsKeyedTimestamp_(match[1], match[2], match[3], match[4], match[5], match[6], columnName, rowNumber, fileName);
  }
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    let hour = Number(match[4] || 0);
    const meridiem = String(match[7] || '').toUpperCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) throw new Error(`Invalid date ${columnName} at row ${rowNumber} in ${fileName}.`);
      if (meridiem === 'AM' && hour === 12) hour = 0;
      if (meridiem === 'PM' && hour !== 12) hour += 12;
    }
    return buildTransactionsKeyedTimestamp_(year, match[1], match[2], hour, match[5], match[6], columnName, rowNumber, fileName);
  }
  throw new Error(`Invalid date ${columnName} at row ${rowNumber} in ${fileName}.`);
}

function isTransactionsKeyedDataRowBlank_(row, indexByKey) {
  return TRANSACTIONS_KEYED_COLUMNS.every(function(column) {
    const value = row[indexByKey[column.key]];
    return value == null || String(value).replace(/\u00a0/g, ' ').trim() === '';
  });
}

function buildTransactionsKeyedRows_(file, sheetData, contentHash, importBatchId) {
  const rows = [];
  const fileId = String(file.getId() || '').trim();
  const fileName = String(file.getName() || '').trim();
  for (let rowIndex = sheetData.headerRowIndex + 1; rowIndex < sheetData.values.length; rowIndex++) {
    const sourceRow = sheetData.values[rowIndex] || [];
    const sourceDisplayRow = (sheetData.displayValues && sheetData.displayValues[rowIndex]) || sourceRow;
    const sourceRowNumber = rowIndex + 1;
    if (isTransactionsKeyedDataRowBlank_(sourceRow, sheetData.indexByKey)) continue;

    const parsed = {
      drive_file_id: fileId,
      content_sha256: contentHash,
      source_sheet_name: sheetData.sourceSheetName,
      source_row_number: sourceRowNumber,
      import_batch_id: importBatchId
    };
    const hashValues = [];
    TRANSACTIONS_KEYED_COLUMNS.forEach(function(column) {
      const columnIndex = sheetData.indexByKey[column.key];
      const rawValue = sourceRow[columnIndex];
      const displayValue = sourceDisplayRow[columnIndex];
      const value = column.type === 'text'
        ? displayValue
        : column.type === 'datetime' && String(displayValue == null ? '' : displayValue).trim()
          ? displayValue
          : rawValue;
      const parsedValue = column.type === 'number'
        ? parseTransactionsKeyedNumber_(value, column.header, sourceRowNumber, fileName)
        : column.type === 'datetime'
          ? parseTransactionsKeyedDateTime_(value, column.header, sourceRowNumber, fileName)
          : normalizeTransactionsKeyedText_(value);
      parsed[column.key] = parsedValue;
      hashValues.push(parsedValue);
    });
    parsed.source_row_hash = bytesToSha256Hex_(Utilities.newBlob(JSON.stringify(hashValues), 'application/json').getBytes());
    rows.push(parsed);
  }
  return rows;
}

function upsertTransactionsKeyedRows_(rows) {
  const payloadRows = Array.isArray(rows) ? rows : [];
  if (!payloadRows.length) return 0;
  const requests = [];
  const chunkSize = 200;
  for (let index = 0; index < payloadRows.length; index += chunkSize) {
    requests.push({
      url: `${SUPABASE_URL}/rest/v1/${TRANSACTIONS_KEYED_ROWS_TABLE}?on_conflict=drive_file_id,content_sha256,source_sheet_name,source_row_number`,
      method: 'post',
      headers: getSupabaseHeaders_({
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      }),
      payload: JSON.stringify(payloadRows.slice(index, index + chunkSize)),
      muteHttpExceptions: true
    });
  }
  const responses = executeFetchAllBatches(requests, 1);
  responses.forEach(function(response) {
    const code = response.getResponseCode();
    if (code !== 200 && code !== 201 && code !== 204) {
      throw new Error(`Transactions Keyed row upload failed (${code}).`);
    }
  });
  return payloadRows.length;
}

function callTransactionsKeyedRpcWithRetry_(rpcName, payload) {
  return withRetry_(`Transactions Keyed RPC ${rpcName}`, 3, 1000, function() {
    return callSupabaseRpc_(rpcName, payload || {});
  }, shouldRetrySupabaseRead_);
}

function getTransactionsKeyedErrorCode_(error) {
  const message = String(error && error.message ? error.message : error || '').toLowerCase();
  if (message.indexOf('header') >= 0 || message.indexOf('40-column') >= 0) return 'HEADER_SCHEMA_INVALID';
  if (message.indexOf('multiple sheets') >= 0 || message.indexOf('ambiguous') >= 0) return 'WORKBOOK_SHEET_AMBIGUOUS';
  if (message.indexOf('numeric') >= 0) return 'NUMERIC_VALUE_INVALID';
  if (message.indexOf('date') >= 0) return 'DATE_VALUE_INVALID';
  if (message.indexOf('row count') >= 0) return 'ROW_COUNT_MISMATCH';
  if (message.indexOf('no importable') >= 0) return 'NO_IMPORTABLE_ROWS';
  if (message.indexOf('move file') >= 0) return 'ARCHIVE_MOVE_FAILED';
  if (message.indexOf('convert excel') >= 0 || message.indexOf('converted sheet') >= 0) return 'EXCEL_CONVERSION_FAILED';
  if (message.indexOf('supabase') >= 0 || message.indexOf('upload') >= 0) return 'SUPABASE_IMPORT_FAILED';
  return 'IMPORT_FAILED';
}

function syncTransactionsKeyedFolder_(sourceFolderId, processedFolderId) {
  if (String(sourceFolderId || '').trim() === String(processedFolderId || '').trim()) {
    throw new Error('Transactions Keyed source and processed folders must be different.');
  }
  const startedAtMs = Date.now();
  const sourceFolder = getDriveFolderByIdWithRetry_(sourceFolderId, 'Transactions Keyed source folder');
  const processedFolder = getDriveFolderByIdWithRetry_(processedFolderId, 'Transactions Keyed processed folder');
  const iterator = listDriveFilesWithRetry_(sourceFolder, 'Transactions Keyed source folder');
  const pendingFiles = [];
  const failedFiles = [];
  let unsupportedFiles = 0;
  let tempFilesRemoved = 0;
  let filesProcessed = 0;
  let duplicateFiles = 0;
  let upsertCount = 0;
  let totalRows = 0;
  const runId = Utilities.getUuid();

  while (iterator.hasNext()) {
    const file = iterator.next();
    const fileName = String(file.getName() || '').trim();
    if (fileName.startsWith('TEMP_')) {
      tempFilesRemoved++;
      trashDriveFileWithRetry_(file, `Transactions Keyed temp file ${fileName}`);
      continue;
    }
    if (!isTransactionsKeyedFileSupported_(file)) {
      unsupportedFiles++;
      continue;
    }
    pendingFiles.push(file);
  }

  pendingFiles.sort(function(a, b) {
    const createdDiff = a.getDateCreated().getTime() - b.getDateCreated().getTime();
    return createdDiff || String(a.getName() || '').localeCompare(String(b.getName() || ''), undefined, { numeric: true });
  });

  const filesToProcess = pendingFiles.slice(0, TRANSACTIONS_KEYED_MAX_FILES_PER_RUN);
  for (let fileIndex = 0; fileIndex < filesToProcess.length; fileIndex++) {
    if (Date.now() - startedAtMs >= TRANSACTIONS_KEYED_MAX_RUN_MS) break;
    const file = filesToProcess[fileIndex];
    const fileName = String(file.getName() || '').trim();
    const fileId = String(file.getId() || '').trim();
    let contentHash = '';
    try {
      contentHash = getTransactionsKeyedFileHash_(file);
      const importBatchId = Utilities.getUuid();
      const prepared = callTransactionsKeyedRpcWithRetry_('prepare_transactions_keyed_import', {
        source_drive_file_id: fileId,
        source_file_name: fileName,
        source_content_sha256: contentHash,
        source_content_bytes: Number(file.getSize() || 0),
        source_import_batch_id: importBatchId
      }) || {};
      const preparedStatus = String(prepared.status || '').toLowerCase();

      if (preparedStatus === 'duplicate_archive_pending' || preparedStatus === 'duplicate') {
        moveDriveFileToFolderWithRetry_(file, processedFolder, `Transactions Keyed duplicate ${fileName}`);
        callTransactionsKeyedRpcWithRetry_('mark_transactions_keyed_file_archived', {
          source_drive_file_id: fileId,
          source_content_sha256: contentHash
        });
        filesProcessed++;
        duplicateFiles++;
        continue;
      }

      if (preparedStatus === 'archive_pending' || preparedStatus === 'processed') {
        moveDriveFileToFolderWithRetry_(file, processedFolder, `Transactions Keyed finalized file ${fileName}`);
        callTransactionsKeyedRpcWithRetry_('mark_transactions_keyed_file_archived', {
          source_drive_file_id: fileId,
          source_content_sha256: contentHash
        });
        filesProcessed++;
        totalRows += Number(prepared.rowCount || 0);
        continue;
      }

      if (preparedStatus !== 'importing') {
        throw new Error('Supabase returned an invalid Transactions Keyed import state.');
      }

      const sheetData = extractTransactionsKeyedSheet_(file, sourceFolderId);
      const rows = buildTransactionsKeyedRows_(file, sheetData, contentHash, importBatchId);
      if (!rows.length) throw new Error(`No importable Transactions Keyed rows found in ${fileName}.`);
      const uploaded = upsertTransactionsKeyedRows_(rows);
      const finalized = callTransactionsKeyedRpcWithRetry_('finalize_transactions_keyed_import', {
        source_drive_file_id: fileId,
        source_content_sha256: contentHash,
        source_sheet_name: sheetData.sourceSheetName,
        source_header_row: sheetData.headerRowIndex + 1,
        expected_row_count: rows.length
      }) || {};
      const finalizedStatus = String(finalized.status || '').toLowerCase();
      if (finalizedStatus !== 'archive_pending' && finalizedStatus !== 'duplicate_archive_pending') {
        throw new Error('Supabase did not finalize the Transactions Keyed import.');
      }

      moveDriveFileToFolderWithRetry_(file, processedFolder, `Transactions Keyed processed file ${fileName}`);
      callTransactionsKeyedRpcWithRetry_('mark_transactions_keyed_file_archived', {
        source_drive_file_id: fileId,
        source_content_sha256: contentHash
      });
      filesProcessed++;
      if (finalizedStatus === 'duplicate_archive_pending') duplicateFiles++;
      else {
        upsertCount += uploaded;
        totalRows += rows.length;
      }
    } catch (err) {
      const errorMessage = err && err.message ? err.message : String(err);
      const errorCode = getTransactionsKeyedErrorCode_(err);
      failedFiles.push({ name: fileName, error: `${errorCode}: ${errorMessage}` });
      console.error(`[TRANSACTIONS KEYED] ${fileName} failed with ${errorCode}. The file remains pending.`);
      if (contentHash) {
        try {
          callTransactionsKeyedRpcWithRetry_('record_transactions_keyed_import_failure', {
            source_drive_file_id: fileId,
            source_content_sha256: contentHash,
            sanitized_error_code: errorCode
          });
        } catch (recordError) {
          console.warn(`[TRANSACTIONS KEYED] Could not record sanitized failure state for ${fileName}.`);
        }
      }
    }
  }

  if (filesProcessed > 0) {
    emitTableSyncLiveEvent_(TRANSACTIONS_KEYED_FILES_TABLE, {
      filesProcessed: filesProcessed,
      tempFilesRemoved: tempFilesRemoved,
      upsertCount: upsertCount,
      deleteCount: 0,
      totalRows: totalRows,
      runId: runId
    });
  }

  return {
    tableName: TRANSACTIONS_KEYED_ROWS_TABLE,
    filesProcessed: filesProcessed,
    duplicateFiles: duplicateFiles,
    remainingFiles: Math.max(0, pendingFiles.length - filesProcessed),
    tempFilesRemoved: tempFilesRemoved,
    unsupportedFiles: unsupportedFiles,
    failedFiles: failedFiles.length,
    failedFileNames: failedFiles.map(function(entry) { return entry.name; }),
    failedFileErrors: failedFiles,
    upsertCount: upsertCount,
    deleteCount: 0,
    totalRows: totalRows,
    runId: runId
  };
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
  if (recordsToUpsert.length > 0) { pushToSupabase('ph_av_notes', recordsToUpsert); }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getAppsScriptDeploymentHealth_() {
  return {
    ok: true,
    service: 'gnc-apps-script',
    deployedCommit: APPS_SCRIPT_DEPLOYMENT_COMMIT_,
    lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_RECIPIENT_POLICY_VERSION_,
    requiredRecipientCount: REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_.length
  };
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const view = String(params.gallery || params.view || '').trim().toLowerCase();
  if (view === 'request') {
    return renderRequestGalleryWebApp_(params);
  }
  if (view === 'request-row') {
    return renderRequestRowCopyWebApp_(params);
  }
  if (view === 'approval') {
    return renderApprovalConfirmWebApp_(params);
  }
  return HtmlService
    .createHtmlOutput('<!doctype html><html><body style="font-family:Arial,sans-serif;"><h2>GNC Park Hill</h2><p>App script is running.</p></body></html>')
    .setTitle('GNC Park Hill');
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
  setScriptPropertyWithQuotaCleanup_(DELAYED_REQUEST_EMAIL_QUEUE_KEY, JSON.stringify(safeJobs));
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

function getRequestCompleteEmailSnapshotComments_(item) {
  const snapshot = parseRequestRowSnapshot_(item);
  return firstNonEmptyRequestValue_(
    item && item.comments,
    item && item.req_comments,
    item && item.request_comments,
    item && item.REQ_COMMENTS,
    item && item.REQUEST_COMMENTS,
    item && item.COMMENTS,
    snapshot && snapshot.comments,
    snapshot && snapshot.req_comments,
    snapshot && snapshot.request_comments,
    snapshot && snapshot.REQ_COMMENTS,
    snapshot && snapshot.REQUEST_COMMENTS,
    snapshot && snapshot.COMMENTS,
    item && item.sales_note,
    item && item.SALES_NOTE,
    item && item.SALESNOTE,
    snapshot && snapshot.sales_note,
    snapshot && snapshot.SALES_NOTE,
    snapshot && snapshot.SALESNOTE,
    ''
  );
}

function cloneRequestCompleteEmailPayloadItemSnapshot_(item) {
  if (!item || typeof item !== 'object') return null;
  const snapshot = parseRequestRowSnapshot_(item);
  const id = String(firstNonEmptyRequestValue_(item.unique_id, item.UNIQUE_ID, snapshot.unique_id, snapshot.UNIQUE_ID, '') || '').trim();
  const comments = String(getRequestCompleteEmailSnapshotComments_(item) || '').trim();
  const row = {
    unique_id: id,
    UNIQUE_ID: id,
    request_folder: firstNonEmptyRequestValue_(item.request_folder, item.REQUEST_FOLDER, item.folder, snapshot.request_folder, snapshot.REQUEST_FOLDER, ''),
    REQUEST_FOLDER: firstNonEmptyRequestValue_(item.REQUEST_FOLDER, item.request_folder, item.folder, snapshot.REQUEST_FOLDER, snapshot.request_folder, ''),
    request_note: firstNonEmptyRequestValue_(item.request_note, item.REQUEST_NOTE, item.req_note, item.REQ_NOTE, snapshot.request_note, snapshot.REQUEST_NOTE, snapshot.req_note, snapshot.REQ_NOTE, ''),
    REQUEST_NOTE: firstNonEmptyRequestValue_(item.REQUEST_NOTE, item.request_note, item.REQ_NOTE, item.req_note, snapshot.REQUEST_NOTE, snapshot.request_note, snapshot.REQ_NOTE, snapshot.req_note, '')
  };
  if (comments) {
    row.comments = comments;
    row.req_comments = comments;
    row.request_comments = comments;
    row.REQ_COMMENTS = comments;
    row.REQUEST_COMMENTS = comments;
    row.REQ_COMMENTS_USER_ENTERED = true;
    row.req_comments_user_entered = true;
  }
  Object.keys(row).forEach(function(key) {
    if (row[key] == null || String(row[key]).trim() === '') delete row[key];
  });
  return row.unique_id || row.comments || row.request_note ? row : null;
}

function overlayRequestCompleteEmailPayloadSnapshots_(rows, snapshots) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const safeSnapshots = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
  if (!safeRows.length || !safeSnapshots.length) return safeRows;
  const snapshotById = {};
  safeSnapshots.forEach(function(snapshot) {
    const id = String(firstNonEmptyRequestValue_(snapshot && snapshot.unique_id, snapshot && snapshot.UNIQUE_ID, '') || '').trim();
    if (id) snapshotById[id] = snapshot;
  });
  return safeRows.map(function(row) {
    const id = String(firstNonEmptyRequestValue_(row && row.unique_id, row && row.UNIQUE_ID, '') || '').trim();
    const snapshot = id ? snapshotById[id] : null;
    if (!snapshot) return row;
    const comments = String(getRequestCompleteEmailSnapshotComments_(snapshot) || '').trim();
    if (!comments) return row;
    row.comments = comments;
    row.req_comments = comments;
    row.request_comments = comments;
    row.REQ_COMMENTS = comments;
    row.REQUEST_COMMENTS = comments;
    row.REQ_COMMENTS_USER_ENTERED = true;
    row.req_comments_user_entered = true;
    return row;
  });
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
  const queuedRequestItems = getRequestEmailPayloadItems_(safePayload)
    .map(cloneRequestCompleteEmailPayloadItemSnapshot_)
    .filter(Boolean);
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
  if (queuedRequestItems.length) safePayload.requestItems = queuedRequestItems;
  else delete safePayload.requestItems;
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

function loadJdApprovalEmailQueue_() {
  const raw = PropertiesService.getScriptProperties().getProperty(JD_APPROVAL_EMAIL_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(function(job) {
      return job && job.id && job.payload;
    }) : [];
  } catch (err) {
    console.error('[JD APPROVAL EMAIL] Could not parse queued approval emails', err);
    return [];
  }
}

function saveJdApprovalEmailQueue_(jobs) {
  const safeJobs = Array.isArray(jobs) ? jobs.filter(function(job) {
    return job && job.id && job.payload;
  }) : [];
  if (!safeJobs.length) {
    PropertiesService.getScriptProperties().deleteProperty(JD_APPROVAL_EMAIL_QUEUE_KEY);
    return;
  }
  setScriptPropertyWithQuotaCleanup_(JD_APPROVAL_EMAIL_QUEUE_KEY, JSON.stringify(safeJobs));
}

function removeJdApprovalEmailTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === JD_APPROVAL_EMAIL_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function scheduleJdApprovalEmailTrigger_(jobs) {
  removeJdApprovalEmailTriggers_();
  const safeJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  if (!safeJobs.length) return;
  const nextDueAtMs = safeJobs.reduce(function(minMs, job) {
    const dueAtMs = Number(job && job.dueAtMs) || 0;
    if (!dueAtMs) return minMs;
    if (!minMs || dueAtMs < minMs) return dueAtMs;
    return minMs;
  }, 0);
  if (!nextDueAtMs) return;
  const delayMs = Math.max(JD_APPROVAL_EMAIL_MIN_DELAY_MS, nextDueAtMs - Date.now());
  ScriptApp.newTrigger(JD_APPROVAL_EMAIL_TRIGGER_HANDLER)
    .timeBased()
    .after(delayMs)
    .create();
}

function shouldQueueJdApprovalEmail_(payload) {
  const emailType = String(payload && payload.emailType || '').trim().toLowerCase();
  const approvalStage = String(payload && (payload.approvalStage || payload.approval_stage) || '').trim().toLowerCase();
  if (payload && payload.forceImmediate === true) return false;
  if (payload && payload.queueJdApprovalEmail === false) return false;
  return (emailType === 'ncr_approval' || emailType === 'hold_release_request') && approvalStage === 'jd';
}

function cloneJdApprovalEmailPayloadForQueue_(payload) {
  const safePayload = payload && typeof payload === 'object' ? JSON.parse(JSON.stringify(payload)) : {};
  const items = getRequestEmailPayloadItems_(safePayload).map(function(item) {
    return item && typeof item === 'object' ? JSON.parse(JSON.stringify(item)) : item;
  });
  safePayload.requestItems = items;
  safePayload.itemsCount = items.length || Number(safePayload.itemsCount || 0) || 0;
  delete safePayload.items;
  delete safePayload.sourceRows;
  delete safePayload.formattedItemsHtml;
  delete safePayload.formattedItemsText;
  delete safePayload.queueDelivery;
  delete safePayload.delayMs;
  return safePayload;
}

function enqueueJdApprovalEmail_(payload) {
  const safePayload = cloneJdApprovalEmailPayloadForQueue_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const queue = loadJdApprovalEmailQueue_();
    const job = {
      id: Utilities.getUuid(),
      dueAtMs: Date.now() + JD_APPROVAL_EMAIL_DELAY_MS,
      attempts: 0,
      payload: safePayload
    };
    queue.push(job);
    saveJdApprovalEmailQueue_(queue);
    scheduleJdApprovalEmailTrigger_(queue);
    return {
      ok: true,
      status: 202,
      queued: true,
      queue: 'jd_approval',
      jobId: job.id,
      queuedCount: queue.length,
      dueAt: new Date(job.dueAtMs).toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function resolveJdApprovalEmailTypeLabel_(payload) {
  const explicitLabel = firstNonEmptyRequestValue_(
    payload && payload.approvalLabel,
    payload && payload.approval_label,
    payload && payload.customer,
    ''
  );
  if (explicitLabel) return explicitLabel;
  const approvalType = String(payload && (payload.approvalType || payload.approval_type) || '').trim().toLowerCase().replace(/_/g, '-');
  if (approvalType === 'hold' || approvalType === 'hold-release' || approvalType === 'off-hold') return 'Off Hold Approval';
  if (approvalType === 'move-up' || approvalType === 'moveup') return 'Move Up Approval';
  if (approvalType === 'recount' || approvalType === 're-count') return 'Re-Count Approval';
  if (approvalType === 'not-on-inventory' || approvalType === 'notoninventory') return 'Not On Inventory';
  return 'New Crop Release';
}

function getApprovalRequesterEntryFromItem_(item) {
  if (!item || typeof item !== 'object') return null;
  return normalizeRequestCompletionUserEntry_({
    username: firstNonEmptyRequestValue_(
      item.NCR_REQUESTED_BY_USERNAME,
      item.ncr_requested_by_username,
      item.ncrRequestedByUsername,
      item.REQUESTED_BY_USERNAME,
      item.requested_by_username,
      item.requestedByUsername,
      ''
    ),
    display: firstNonEmptyRequestValue_(
      item.NCR_REQUESTED_BY_DISPLAY,
      item.ncr_requested_by_display,
      item.ncrRequestedByDisplay,
      item.NCR_REQUESTED_BY,
      item.REQUESTED_BY_DISPLAY,
      item.requested_by_display,
      item.requestedByDisplay,
      item.requestedBy,
      ''
    ),
    email: firstNonEmptyRequestValue_(
      item.NCR_REQUESTED_BY_EMAIL,
      item.ncr_requested_by_email,
      item.ncrRequestedByEmail,
      item.REQUESTED_BY_EMAIL,
      item.requested_by_email,
      item.requestedByEmail,
      ''
    )
  });
}

function getApprovalRequesterEntryFromPayload_(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return normalizeRequestCompletionUserEntry_({
    username: firstNonEmptyRequestValue_(
      payload.requestedByUsername,
      payload.requested_by_username,
      payload.NCR_REQUESTED_BY_USERNAME,
      payload.ncr_requested_by_username,
      payload.requestedBy,
      payload.requested_by,
      ''
    ),
    display: firstNonEmptyRequestValue_(
      payload.requestedByDisplay,
      payload.requested_by_display,
      payload.NCR_REQUESTED_BY_DISPLAY,
      payload.ncr_requested_by_display,
      payload.requestedBy,
      payload.requested_by,
      ''
    ),
    email: firstNonEmptyRequestValue_(
      payload.requestedByEmail,
      payload.requested_by_email,
      payload.NCR_REQUESTED_BY_EMAIL,
      payload.ncr_requested_by_email,
      ''
    )
  });
}

function formatApprovalRequesterEntryLabel_(entry) {
  const normalized = normalizeRequestCompletionUserEntry_(entry);
  if (!normalized) return '';
  if (normalized.display && normalized.username && normalizeRequestCompletionUsername_(normalized.display) !== normalized.username) {
    return normalized.display + ' (' + normalized.username + ')';
  }
  return normalized.display || normalized.username || normalized.email || '';
}

function formatApprovalRequesterLabel_(item) {
  return formatApprovalRequesterEntryLabel_(getApprovalRequesterEntryFromItem_(item));
}

function applyApprovalRequesterFieldsToItem_(item, payload) {
  if (!item || typeof item !== 'object') return null;
  const entry = getApprovalRequesterEntryFromItem_(item) || getApprovalRequesterEntryFromPayload_(payload);
  if (!entry) return null;
  item.NCR_REQUESTED_BY_USERNAME = entry.username || '';
  item.ncr_requested_by_username = entry.username || '';
  item.REQUESTED_BY_USERNAME = entry.username || '';
  item.requestedByUsername = entry.username || '';
  item.requested_by_username = entry.username || '';
  item.NCR_REQUESTED_BY_DISPLAY = entry.display || entry.username || '';
  item.ncr_requested_by_display = entry.display || entry.username || '';
  item.NCR_REQUESTED_BY = entry.display || entry.username || '';
  item.REQUESTED_BY_DISPLAY = entry.display || entry.username || '';
  item.requestedByDisplay = entry.display || entry.username || '';
  item.requested_by_display = entry.display || entry.username || '';
  item.NCR_REQUESTED_BY_EMAIL = entry.email || '';
  item.ncr_requested_by_email = entry.email || '';
  item.REQUESTED_BY_EMAIL = entry.email || '';
  item.requestedByEmail = entry.email || '';
  item.requested_by_email = entry.email || '';
  return entry;
}

function collectApprovalRequesterEntriesFromJobs_(jobs, items) {
  const seen = {};
  const entries = [];
  const addEntry = function(entry) {
    const normalized = normalizeRequestCompletionUserEntry_(entry);
    if (!normalized) return;
    const key = normalized.email || normalized.username || normalizeRequestCompletionUsername_(normalized.display);
    if (!key || seen[key]) return;
    seen[key] = true;
    entries.push(normalized);
  };
  (Array.isArray(jobs) ? jobs : []).forEach(function(job) {
    const payload = job && job.payload ? job.payload : {};
    addEntry(getApprovalRequesterEntryFromPayload_(payload));
    dedupeEmailAddresses_([
      payload && payload.requestedByEmails,
      payload && payload.requested_by_emails,
      payload && payload.submittedByEmails,
      payload && payload.submitted_by_emails
    ]).forEach(function(email) {
      addEntry({ email: email });
    });
  });
  (Array.isArray(items) ? items : []).forEach(function(item) {
    addEntry(getApprovalRequesterEntryFromItem_(item));
  });
  return entries;
}

function collectJdApprovalBatchItems_(jobs) {
  const items = [];
  (Array.isArray(jobs) ? jobs : []).forEach(function(job) {
    const payload = job && job.payload ? job.payload : {};
    const approvalLabel = resolveJdApprovalEmailTypeLabel_(payload);
    const payloadItems = getRequestEmailPayloadItems_(payload);
    if (!payloadItems.length) {
      const fallbackItem = {
        commonname: approvalLabel,
        approval_label: approvalLabel,
        completed_by_display: firstNonEmptyRequestValue_(payload && payload.completedByDisplay, payload && payload.completedBy, ''),
        comments: firstNonEmptyRequestValue_(payload && payload.appInstruction, payload && payload.message, '')
      };
      applyApprovalRequesterFieldsToItem_(fallbackItem, payload);
      items.push(fallbackItem);
      return;
    }
    payloadItems.forEach(function(item) {
      const cloned = item && typeof item === 'object' ? JSON.parse(JSON.stringify(item)) : {};
      cloned.approval_label = firstNonEmptyRequestValue_(cloned.approval_label, cloned.approvalLabel, approvalLabel);
      cloned.completed_by_display = firstNonEmptyRequestValue_(
        cloned.completed_by_display,
        cloned.completedByDisplay,
        payload && payload.completedByDisplay,
        payload && payload.completedBy,
        ''
      );
      applyApprovalRequesterFieldsToItem_(cloned, payload);
      items.push(cloned);
    });
  });
  return items;
}

function buildGroupedJdApprovalEmailPayload_(jobs) {
  const safeJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  const items = collectJdApprovalBatchItems_(safeJobs);
  const typeMap = {};
  safeJobs.forEach(function(job) {
    const label = resolveJdApprovalEmailTypeLabel_(job && job.payload);
    if (label) typeMap[label] = true;
  });
  const typeLabels = Object.keys(typeMap);
  const itemCount = items.length || safeJobs.length;
  const typeSummary = typeLabels.length ? typeLabels.join(', ') : 'Manager Approvals';
  const plural = itemCount === 1 ? 'row' : 'rows';
  const requesterEntries = collectApprovalRequesterEntriesFromJobs_(safeJobs, items);
  const requesterEmails = requesterEntries.map(function(entry) { return entry && entry.email; }).filter(Boolean);
  const requesterSummary = requesterEntries.map(formatApprovalRequesterEntryLabel_).filter(Boolean).join(', ');
  const batchRecipients = dedupeEmailAddresses_([
    'jd_jones@greenleafnursery.com',
    'dylan_collyge@greenleafnursery.com',
    requesterEmails
  ]);
  const batchId = 'jd-approval-batch-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyyMMdd-HHmmss');
  return {
    type: 'email',
    emailType: 'ncr_approval',
    approvalStage: 'jd',
    approvalType: 'manager_batch',
    approvalLabel: 'Manager Approval Batch',
    customer: 'Manager Approval Batch',
    folderId: batchId,
    requestFolder: batchId,
    subject: 'JD Approval Needed: ' + itemCount + ' Dylan-approved ' + plural,
    brandLabel: 'GNC PH Manager Approvals',
    fromName: 'GNC PH Manager Approvals',
    repName: 'JD Jones',
    salesRepName: 'JD Jones',
    completedBy: 'dylan_collyge',
    completed_by: 'dylan_collyge',
    completedByDisplay: 'dylan_collyge',
    requestedBy: requesterSummary || 'dylan_collyge',
    requestedByDisplay: requesterSummary,
    requestedByEmail: requesterEmails[0] || '',
    requestedByEmails: requesterEmails,
    submittedBySummary: requesterSummary,
    submitted_by_summary: requesterSummary,
    submittedByEmails: requesterEmails,
    submitted_by_emails: requesterEmails,
    itemsCount: itemCount,
    requestItems: items,
    internalRecipients: batchRecipients,
    recipientEmails: batchRecipients,
    appInstruction: 'JD: open the app and check Managers. Review the approval tabs for these Dylan-approved rows. Approval types included: ' + typeSummary + '.',
    message: 'Dylan approved ' + itemCount + ' manager approval ' + plural + '. They are grouped in this one email instead of separate row emails.'
  };
}

function requeueJdApprovalEmailJobs_(jobs) {
  const retryJobs = (Array.isArray(jobs) ? jobs : []).map(function(job) {
    const attempts = (Number(job && job.attempts) || 0) + 1;
    return Object.assign({}, job, {
      attempts: attempts,
      dueAtMs: Date.now() + JD_APPROVAL_EMAIL_DELAY_MS
    });
  }).filter(function(job) {
    return Number(job && job.attempts) <= 3;
  });
  if (!retryJobs.length) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const queue = loadJdApprovalEmailQueue_();
    const nextQueue = queue.concat(retryJobs);
    saveJdApprovalEmailQueue_(nextQueue);
    scheduleJdApprovalEmailTrigger_(nextQueue);
  } finally {
    lock.releaseLock();
  }
}

function processQueuedJdApprovalEmail_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  let dueJobs = [];
  let futureJobs = [];
  try {
    const queue = loadJdApprovalEmailQueue_();
    if (!queue.length) {
      removeJdApprovalEmailTriggers_();
      return;
    }
    const nowMs = Date.now();
    queue.forEach(function(job) {
      const dueAtMs = Number(job && job.dueAtMs) || 0;
      if (dueAtMs && dueAtMs <= nowMs) dueJobs.push(job);
      else futureJobs.push(job);
    });
    saveJdApprovalEmailQueue_(futureJobs);
  } finally {
    lock.releaseLock();
  }

  if (!dueJobs.length) {
    scheduleJdApprovalEmailTrigger_(futureJobs);
    return;
  }

  const groupedPayload = buildGroupedJdApprovalEmailPayload_(dueJobs);
  let sentOk = false;
  try {
    const result = sendRequestEmailWithFallback_(groupedPayload);
    sentOk = !!result && result.ok !== false;
    if (!sentOk) {
      console.error('[JD APPROVAL EMAIL] Grouped approval email failed', { result: result });
    }
  } catch (error) {
    console.error('[JD APPROVAL EMAIL] Grouped approval email threw', { error: error && error.message ? error.message : error });
  }
  if (!sentOk) {
    requeueJdApprovalEmailJobs_(dueJobs);
  } else {
    scheduleJdApprovalEmailTrigger_(futureJobs);
  }
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

function parseRequestEmailNumber_(value) {
  const text = firstNonEmptyRequestValue_(value)
    .replace(/,/g, '')
    .replace(/%/g, '')
    .trim();
  if (!text || /^n\/?a$/i.test(text) || /^-+$/.test(text)) return null;
  const numberMatch = text.match(/-?\d+(?:\.\d+)?/);
  if (!numberMatch) return null;
  const numberValue = Number(numberMatch[0]);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeRequestPickNoteToken_(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatRequestPickNoteLocationCode_(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/^([A-Z])\.(\d+)\.(\d+)$/);
  if (!match) return raw;
  const section = match[1];
  const rowNumber = String(parseInt(match[2], 10));
  const spotNumber = String(parseInt(match[3], 10));
  if (!rowNumber || rowNumber === 'NaN') return raw;
  if (!spotNumber || spotNumber === 'NaN' || spotNumber === '0') return rowNumber + section;
  return rowNumber + '.' + section + '.' + spotNumber;
}

function getRequestPickNoteLocationCode_(item) {
  return formatRequestPickNoteLocationCode_(firstNonEmptyRequestValue_(
    item && item.loc,
    item && item.locationcode,
    item && item.LOCATIONCODE,
    item && item.LOCATION,
    item && item.location,
    ''
  ));
}

function getRequestOverSeasonNoReservePickNote_(item) {
  return '';
}

function getRequestPickNoteWithOverSeasonRule_(item, currentNote) {
  const text = String(currentNote || '').trim().replace(/\s+/g, ' ');
  return text;
}

function normalizeRequestCountText_(value) {
  const text = firstNonEmptyRequestValue_(value);
  if (!text || /^n\/?a$/i.test(text) || /^-+$/.test(text)) return '';
  const labeledMatch = text.match(/(?:loc(?:ation)?\s*)?photo\s*match\s*:?\s*([0-9][0-9,]*(?:\.\d+)?)/i);
  if (labeledMatch) return labeledMatch[1].replace(/,/g, '');
  return text;
}

function deriveRequestLocPhotoMatchValue_(item, snapshot) {
  const row = item || {};
  const snap = snapshot || {};
  const matchValue = parseRequestEmailNumber_(firstNonEmptyRequestValue_(
    row.req_match, row.REQ_MATCH,
    row.match, row.MATCH, row.MATCHPCT, row.matchpct,
    row.flyer_match, row.FLYER_MATCH, row.FLYER_MATCHPCT,
    snap.REQ_MATCH, snap.req_match,
    snap.MATCH, snap.match, snap.MATCHPCT, snap.matchpct,
    snap.FLYER_MATCH, snap.flyer_match, snap.FLYER_MATCHPCT,
    ''
  ));
  if (matchValue == null) return null;

  const currentPtrValue = parseRequestEmailNumber_(firstNonEmptyRequestValue_(
    row.ptravailable, row.PTRAVAILABLE,
    row.loc_avail, row.LOC_AVAIL,
    row.locavailable, row.LOCAVAILABLE,
    snap.PTRAVAILABLE, snap.ptravailable,
    snap.LOC_AVAIL, snap.loc_avail,
    snap.LOCAVAILABLE, snap.locavailable,
    ''
  ));
  const currentPtr = Math.max(0, currentPtrValue == null ? 0 : currentPtrValue);
  const baselinePtrValue = parseRequestEmailNumber_(firstNonEmptyRequestValue_(
    row.initial_ptr, row.INITIAL_PTR,
    row.flyer_initial_ptr, row.FLYER_INITIAL_PTR,
    snap.INITIAL_PTR, snap.initial_ptr,
    snap.FLYER_INITIAL_PTR, snap.flyer_initial_ptr,
    ''
  ));

  if (baselinePtrValue == null) return Math.max(0, Math.round(currentPtr * (matchValue / 100)));

  const baselinePtr = Math.max(0, baselinePtrValue);
  const originalMatchQty = Math.max(0, Math.round(baselinePtr * (matchValue / 100)));
  const ptrDrop = Math.max(0, baselinePtr - currentPtr);
  return Math.min(originalMatchQty, Math.max(0, originalMatchQty - ptrDrop));
}

function getRequestLocPhotoMatchValue_(item) {
  const row = item || {};
  const snapshot = parseRequestRowSnapshot_(row);
  const directValue = normalizeRequestCountText_(firstNonEmptyRequestValue_(
    row.loc_match_qty, row.LOC_MATCH_QTY,
    row.locPhotoMatch, row.locPhotoMatchQty,
    row.loc_photo_match, row.LOC_PHOTO_MATCH,
    row.loc_photo_match_qty, row.LOC_PHOTO_MATCH_QTY,
    row.req_loc_match_qty, row.REQ_LOC_MATCH_QTY,
    row.flyer_loc_match_qty, row.FLYER_LOC_MATCH_QTY,
    snapshot.LOC_MATCH_QTY, snapshot.loc_match_qty,
    snapshot.locPhotoMatch, snapshot.locPhotoMatchQty,
    snapshot.LOC_PHOTO_MATCH, snapshot.loc_photo_match,
    snapshot.LOC_PHOTO_MATCH_QTY, snapshot.loc_photo_match_qty,
    snapshot.REQ_LOC_MATCH_QTY, snapshot.req_loc_match_qty,
    snapshot.FLYER_LOC_MATCH_QTY, snapshot.flyer_loc_match_qty,
    ''
  ));
  const derivedValue = deriveRequestLocPhotoMatchValue_(row, snapshot);
  if (directValue) {
    const directNumber = parseRequestEmailNumber_(directValue);
    if (directNumber === 0 && derivedValue != null && Number(derivedValue) > 0) {
      return String(derivedValue);
    }
    return directValue;
  }
  return derivedValue == null ? '' : String(derivedValue);
}

function getRequestLocPhotoMatchEmailValue_(item) {
  return getRequestLocPhotoMatchValue_(item) || '0';
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

function constrainEmailImagesForPhoneLayout_(html) {
  const sourceHtml = String(html || '');
  if (!sourceHtml) return '';
  return sourceHtml.replace(/<img\b([^>]*)>/gi, function(match, attrs) {
    if (/\bdata-email-thumb\b/i.test(String(attrs || ''))) return match;
    let safeAttrs = String(attrs || '');
    const imageStyle = 'display:block;width:100%;max-width:320px;height:auto;max-height:380px;object-fit:contain;border-radius:8px;border:1px solid #d7ded8;';
    if (/style\s*=/i.test(safeAttrs)) {
      safeAttrs = safeAttrs.replace(/style=(["'])(.*?)\1/i, function(styleMatch, quote, styleValue) {
        return 'style=' + quote + String(styleValue || '') + ';' + imageStyle + quote;
      });
    } else {
      safeAttrs += ' style="' + imageStyle + '"';
    }
    safeAttrs = safeAttrs.replace(/\sheight=(["'])[^"']*\1/ig, '');
    if (/\bwidth\s*=/i.test(safeAttrs)) safeAttrs = safeAttrs.replace(/\swidth=(["'])[^"']*\1/i, ' width="320"');
    else safeAttrs += ' width="320"';
    return '<img' + safeAttrs + '>';
  });
}

function buildPhoneSizedEmailHtml_(contentHtml) {
  const bodyHtml = constrainEmailImagesForPhoneLayout_(contentHtml);
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;background:#ffffff;margin:0;padding:0;">',
    '<tr>',
    '<td align="center" style="padding:0;margin:0;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="430" style="width:100%;max-width:430px;border-collapse:collapse;margin:0 auto;">',
    '<tr>',
    '<td style="font-family:Arial,sans-serif;padding:0;color:#333333;font-size:14px;line-height:1.45;">',
    bodyHtml,
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>'
  ].join('');
}

function extractGoogleDriveFileIdFromUrl_(url) {
  const text = String(url || '').trim();
  if (!text || text.indexOf('drive.google.com') === -1) return '';
  let match = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!match) match = text.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) match = text.match(/\/thumbnail\/?\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
  if (!match) match = text.match(/\/uc\?[^#]*\bid=([a-zA-Z0-9_-]+)/);
  return match && match[1] ? match[1] : '';
}

function normalizeRequestPhotoUrlForEmail_(url) {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return '';
  const driveId = extractGoogleDriveFileIdFromUrl_(safeUrl);
  if (driveId) return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(driveId) + '&sz=w1600';
  return safeUrl;
}

function getRequestEmailThumbnailUrl_(url, width) {
  const safeUrl = normalizeRequestPhotoUrlForEmail_(url);
  if (!safeUrl) return '';
  const safeWidth = Math.max(96, Math.min(1600, Number(width) || 320));
  const driveId = extractGoogleDriveFileIdFromUrl_(safeUrl);
  if (driveId) return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(driveId) + '&sz=w' + safeWidth;
  return safeUrl;
}

function normalizeRequestPhotoUrlListForEmail_(photoUrls) {
  const seen = {};
  const urls = [];
  (Array.isArray(photoUrls) ? photoUrls : []).forEach(function(url) {
    const safeUrl = normalizeRequestPhotoUrlForEmail_(url);
    if (!safeUrl || !/^https?:\/\//i.test(safeUrl) || seen[safeUrl]) return;
    seen[safeUrl] = true;
    urls.push(safeUrl);
  });
  return urls;
}

function buildRequestEmailPhotoPreviewStripHtml_(photoUrls, options) {
  const opts = options || {};
  const urls = normalizeRequestPhotoUrlListForEmail_(photoUrls);
  if (!urls.length) return '';
  const firstUrl = urls[0];
  const thumbWidth = Math.max(320, Number(opts.thumbWidth) || 640);
  const thumbUrl = getRequestEmailThumbnailUrl_(firstUrl, thumbWidth);
  const fullUrl = getRequestEmailThumbnailUrl_(firstUrl, 1600) || firstUrl;
  const galleryUrl = String(opts.galleryUrl || '').trim();
  const targetUrl = galleryUrl || fullUrl;
  const label = String(opts.titlePrefix || 'First photo preview').trim() || 'First photo preview';
  const helperText = urls.length > 1
    ? 'First photo shown for this row. Open the row gallery to view all ' + urls.length + ' photos.'
    : 'First photo shown for this row.';
  return [
    '<div style="margin:10px 0 12px 0;">',
    '<div style="margin:0 0 8px 0;color:#065f46;font-size:12px;line-height:1.35;font-weight:800;">' + escapeEmailHtml_(helperText) + '</div>',
    '<a href="' + escapeEmailAttribute_(targetUrl) + '" style="display:block;width:100%;max-width:320px;text-decoration:none;color:#065f46;">',
    '<img data-email-thumb="1" src="' + escapeEmailAttribute_(thumbUrl) + '" alt="' + escapeEmailAttribute_(label) + '" width="320" style="display:block;width:100%;max-width:320px;height:auto;border-radius:10px;border:1px solid #d7ded8;background:#f8fafc;">',
    '<span style="display:block;margin-top:5px;text-align:center;font-size:11px;font-weight:800;color:#065f46;line-height:1.2;">First photo</span>',
    '</a>',
    '</div>',
  ].join('');
}

function extractRequestPhotoUrls_(value) {
  const seen = {};
  const urls = [];
  const addUrl = function(entry) {
    const url = normalizeRequestPhotoUrlForEmail_(String(entry || '').trim().replace(/[)\].,;]+$/g, ''));
    if (!/^https?:\/\//i.test(url) || seen[url]) return;
    seen[url] = true;
    urls.push(url);
  };
  const walk = function(input) {
    if (input == null) return;
    if (Array.isArray(input)) {
      input.forEach(walk);
      return;
    }
    if (typeof input === 'object') {
      Object.keys(input).forEach(function(key) {
        if (/photo|image|url|link/i.test(key)) walk(input[key]);
      });
      return;
    }
    const text = String(input || '').trim();
    if (!text) return;
    if ((text.charAt(0) === '[' && text.charAt(text.length - 1) === ']') || (text.charAt(0) === '{' && text.charAt(text.length - 1) === '}')) {
      try {
        walk(JSON.parse(text));
        return;
      } catch (error) {}
    }
    const matches = text.match(/https?:\/\/[^\s"',<>\]]+/gi);
    if (matches && matches.length) {
      matches.forEach(addUrl);
      return;
    }
    text.split(/[,\n\r\t|]+/).forEach(addUrl);
  };
  walk(value);
  return urls;
}

function getRequestNcrCurrentSeasonSltsEmailField_(item) {
  const approvalType = String(firstNonEmptyRequestValue_(
    item && item.ncr_approval_type,
    item && item.NCR_APPROVAL_TYPE,
    item && item.approval_type,
    item && item.APPROVAL_TYPE,
    item && item.approval_label,
    item && item.approvalLabel,
    ''
  ) || '').trim().toLowerCase().replace(/_/g, '-');
  const isNewCropRelease = approvalType === 'new-crop' ||
    approvalType.indexOf('new crop') !== -1 ||
    approvalType.indexOf('new-crop') !== -1;
  if (!isNewCropRelease) return null;
  const value = firstNonEmptyRequestValue_(
    item && item.ncr_current_season_slts,
    item && item.NCR_CURRENT_SEASON_SLTS,
    item && item.current_season_slts,
    item && item.CURRENT_SEASON_SLTS,
    ''
  );
  if (String(value || '').trim() === '') return null;
  const label = firstNonEmptyRequestValue_(
    item && item.ncr_current_season_slts_label,
    item && item.NCR_CURRENT_SEASON_SLTS_LABEL,
    item && item.current_season_slts_label,
    item && item.CURRENT_SEASON_SLTS_LABEL,
    'Current Season S_LTS'
  );
  return [label, value];
}

function buildRequestItemFieldRowsText_(item) {
  const fields = [
    ['Approval Type', firstNonEmptyRequestValue_(item && item.approval_label, item && item.approvalLabel, item && item.approval_type, item && item.APPROVAL_TYPE, '')],
    ['Item Code', firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, '-')],
    ['Location', firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, '-')],
    ['Lot Code', firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, '')],
    ['Season', firstNonEmptyRequestValue_(item && item.season, item && item.SEASON, '')],
    ['Priority', firstNonEmptyRequestValue_(item && item.priority, item && item.PRIORITY, '')],
    ['S_LTS', firstNonEmptyRequestValue_(item && item.s_lts, item && item.S_LTS, '')],
    ['PTR Available', firstNonEmptyRequestValue_(item && item.ptravailable, item && item.PTRAVAILABLE, '')],
    ['Requested Qty', firstNonEmptyRequestValue_(item && item.qty, item && item.requested_qty, item && item.REQ_QTY, '')],
    ['Completed By', formatRequestCompletionUserLabel_(item)],
    ['Submitted By', formatApprovalRequesterLabel_(item)],
    ['Request Note', firstNonEmptyRequestValue_(item && item.request_note, item && item.req_note, item && item.REQUEST_NOTE, item && item.REQ_NOTE, '')],
    ['EVAL Task', getEvalTaskEmailTypeLabel_(firstNonEmptyRequestValue_(item && item.eval_task_type, item && item.EVAL_TASK_TYPE, ''))],
    ['EVAL Requested By', getEvalTaskRequestedByFromItem_(item)],
    ['EVAL Reviewer', firstNonEmptyRequestValue_(item && item.assignedto, item && item.ASSIGNEDTO, '')],
    ['EVAL Instructions', firstNonEmptyRequestValue_(item && item.eval_task_instructions, item && item.EVAL_TASK_INSTRUCTIONS, '')],
    ['EVAL Result Note', firstNonEmptyRequestValue_(item && item.eval_task_result_note, item && item.EVAL_TASK_RESULT_NOTE, '')],
    ['Desired Spec', firstNonEmptyRequestValue_(item && item.desired_spec, item && item.req_desired_spec, item && item.REQ_DESIRED_SPEC, item && item.DESIRED_SPEC, '')],
    ['Desired Caliper', firstNonEmptyRequestValue_(item && item.desired_caliper, item && item.req_desired_caliper, item && item.REQ_DESIRED_CALIPER, item && item.DESIRED_CALIPER, '')],
    ['Spec', firstNonEmptyRequestValue_(item && item.spec, item && item.REQ_SPEC, item && item.SPEC, '')],
    ['Caliper', firstNonEmptyRequestValue_(item && item.caliper, item && item.REQ_CALIPER, item && item.CALIPER, '')],
    ['LOC MATCH %', formatRequestPercentForEmail_(firstNonEmptyRequestValue_(item && item.match, item && item.req_match, item && item.MATCH, item && item.REQ_MATCH, ''))],
    ['LOC PHOTO MATCH', getRequestLocPhotoMatchEmailValue_(item)],
    ['AV Note', firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, '')],
    ['Reserve', firstNonEmptyRequestValue_(item && item.reserve, item && item.req_reserve, item && item.REQ_RESERVE, '')],
    ['Pick Note', firstNonEmptyRequestValue_(item && item.pick_note, item && item.pick, item && item.req_pick, item && item.req_pic_note, item && item.REQ_PICK, item && item.REQ_PIC_NOTE, item && item.PICK, '')],
    ['Comments', getRequestCompleteEmailSnapshotComments_(item)]
  ];
  const ncrCurrentSeasonSltsField = getRequestNcrCurrentSeasonSltsEmailField_(item);
  if (ncrCurrentSeasonSltsField) fields.splice(7, 0, ncrCurrentSeasonSltsField);

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
    ['Approval Type', firstNonEmptyRequestValue_(item && item.approval_label, item && item.approvalLabel, item && item.approval_type, item && item.APPROVAL_TYPE, '')],
    ['Item Code', firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, '-')],
    ['Location', firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, '-')],
    ['Lot Code', firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, '')],
    ['Season', firstNonEmptyRequestValue_(item && item.season, item && item.SEASON, '')],
    ['Priority', firstNonEmptyRequestValue_(item && item.priority, item && item.PRIORITY, '')],
    ['S_LTS', firstNonEmptyRequestValue_(item && item.s_lts, item && item.S_LTS, '')],
    ['PTR Available', firstNonEmptyRequestValue_(item && item.ptravailable, item && item.PTRAVAILABLE, '')],
    ['Requested Qty', firstNonEmptyRequestValue_(item && item.qty, item && item.requested_qty, item && item.REQ_QTY, '')],
    ['Completed By', formatRequestCompletionUserLabel_(item)],
    ['Submitted By', formatApprovalRequesterLabel_(item)],
    ['Request Note', firstNonEmptyRequestValue_(item && item.request_note, item && item.req_note, item && item.REQUEST_NOTE, item && item.REQ_NOTE, '')],
    ['EVAL Task', getEvalTaskEmailTypeLabel_(firstNonEmptyRequestValue_(item && item.eval_task_type, item && item.EVAL_TASK_TYPE, ''))],
    ['EVAL Requested By', getEvalTaskRequestedByFromItem_(item)],
    ['EVAL Reviewer', firstNonEmptyRequestValue_(item && item.assignedto, item && item.ASSIGNEDTO, '')],
    ['EVAL Instructions', firstNonEmptyRequestValue_(item && item.eval_task_instructions, item && item.EVAL_TASK_INSTRUCTIONS, '')],
    ['EVAL Result Note', firstNonEmptyRequestValue_(item && item.eval_task_result_note, item && item.EVAL_TASK_RESULT_NOTE, '')],
    ['Desired Spec', firstNonEmptyRequestValue_(item && item.desired_spec, item && item.req_desired_spec, item && item.REQ_DESIRED_SPEC, item && item.DESIRED_SPEC, '')],
    ['Desired Caliper', firstNonEmptyRequestValue_(item && item.desired_caliper, item && item.req_desired_caliper, item && item.REQ_DESIRED_CALIPER, item && item.DESIRED_CALIPER, '')],
    ['Spec', firstNonEmptyRequestValue_(item && item.spec, item && item.REQ_SPEC, item && item.SPEC, '')],
    ['Caliper', firstNonEmptyRequestValue_(item && item.caliper, item && item.REQ_CALIPER, item && item.CALIPER, '')],
    ['LOC MATCH %', formatRequestPercentForEmail_(firstNonEmptyRequestValue_(item && item.match, item && item.req_match, item && item.MATCH, item && item.REQ_MATCH, ''))],
    ['LOC PHOTO MATCH', getRequestLocPhotoMatchEmailValue_(item)],
    ['AV Note', firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, '')],
    ['Reserve', firstNonEmptyRequestValue_(item && item.reserve, item && item.req_reserve, item && item.REQ_RESERVE, '')],
    ['Pick Note', firstNonEmptyRequestValue_(item && item.pick_note, item && item.pick, item && item.req_pick, item && item.req_pic_note, item && item.REQ_PICK, item && item.REQ_PIC_NOTE, item && item.PICK, '')],
    ['Comments', getRequestCompleteEmailSnapshotComments_(item)]
  ];
  const ncrCurrentSeasonSltsField = getRequestNcrCurrentSeasonSltsEmailField_(item);
  if (ncrCurrentSeasonSltsField) fields.splice(7, 0, ncrCurrentSeasonSltsField);

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
    megan: 'megan_kelly@greenleafnursery.com',
    megankelly: 'megan_kelly@greenleafnursery.com',
    megan_kelly: 'megan_kelly@greenleafnursery.com',
    sunday: 'sunday_ellis@greenleafnursery.com',
    sundayellis: 'sunday_ellis@greenleafnursery.com',
    sunday_ellis: 'sunday_ellis@greenleafnursery.com',
    sharon: 'sharon_combs@greenleafnursery.com',
    sharoncombs: 'sharon_combs@greenleafnursery.com',
    sharon_combs: 'sharon_combs@greenleafnursery.com',
    mitch: 'mitch_kaiser@greenleafnursery.com',
    mitchkaiser: 'mitch_kaiser@greenleafnursery.com',
    mitch_kaiser: 'mitch_kaiser@greenleafnursery.com',
    mitchkasier: 'mitch_kaiser@greenleafnursery.com',
    mitch_kasier: 'mitch_kaiser@greenleafnursery.com',
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
  const items = getRequestEmailPayloadItems_(payload);
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

function getRequestPayloadItems_(payload) {
  return getRequestEmailPayloadItems_(payload);
}

function normalizeEvalTaskEmailType_(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (lower.indexOf('ncr') !== -1 || lower.indexOf('new crop') !== -1) return 'new-crop';
  if (lower.indexOf('move up') !== -1 || lower.indexOf('move-up') !== -1 || lower.indexOf('moveup') !== -1) return 'move-up';
  if (lower.indexOf('hold') !== -1 || lower.indexOf('off hold') !== -1) return 'check-hold';
  if (lower.indexOf('evaluate') !== -1 || lower.indexOf('evaluation') !== -1) return 'evaluate';
  if (lower.indexOf('recount') !== -1) return 'recount';
  const normalized = lower.replace(/_/g, '-').replace(/\s+/g, '-');
  if (normalized === 'ncr' || normalized === 'newcrop' || normalized === 'new-crop' || normalized === 'new-crop-release') return 'new-crop';
  if (normalized === 'move' || normalized === 'moveup' || normalized === 'move-up') return 'move-up';
  if (normalized === 'hold' || normalized === 'checkhold' || normalized === 'check-hold' || normalized === 'take-off-hold' || normalized === 'off-hold') return 'check-hold';
  if (normalized === 'eval' || normalized === 'evaluate' || normalized === 'evaluation') return 'evaluate';
  if (normalized === 'recount') return 'recount';
  return normalized;
}

function getEvalTaskEmailTypeLabel_(value) {
  if (!firstNonEmptyRequestValue_(value)) return '';
  const normalized = normalizeEvalTaskEmailType_(value);
  if (normalized === 'new-crop') return 'NCR';
  if (normalized === 'move-up') return 'Move Up';
  if (normalized === 'check-hold') return 'Hold Review';
  if (normalized === 'evaluate') return 'Evaluate';
  if (normalized === 'recount') return 'Recount';
  return firstNonEmptyRequestValue_(value);
}

function parseEvalTaskRequestedByFromNote_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/requested\s+by\s*:?\s*([^\n\r|;]+)/i);
  return match ? String(match[1] || '').trim() : '';
}

function getEvalTaskRequestedByFromItem_(item) {
  return firstNonEmptyRequestValue_(
    item && item.eval_task_assigned_by,
    item && item.EVAL_TASK_ASSIGNED_BY,
    parseEvalTaskRequestedByFromNote_(firstNonEmptyRequestValue_(item && item.request_note, item && item.REQUEST_NOTE, item && item.req_note, item && item.REQ_NOTE, '')),
    parseEvalTaskRequestedByFromNote_(firstNonEmptyRequestValue_(item && item.comments, item && item.REQ_COMMENTS, item && item.req_comments, '')),
    ''
  );
}

function isEvalTaskCompletionEmail_(payload) {
  if (String(payload && payload.emailType || '').trim().toLowerCase() !== 'request_complete') return false;
  const items = getRequestPayloadItems_(payload);
  const metaText = [
    payload && payload.folderId,
    payload && payload.requestFolder,
    payload && payload.customer,
    payload && payload.requestCustomer,
    payload && payload.emailSubType,
    payload && payload.evalTaskType
  ].concat(items.map(function(item) {
    return [
      item && item.folder,
      item && item.request_folder,
      item && item.REQUEST_FOLDER,
      item && item.customer,
      item && item.req_customer,
      item && item.REQ_CUSTOMER,
      item && item.eval_task_type,
      item && item.EVAL_TASK_TYPE,
      item && item.eval_task_assigned_by,
      item && item.EVAL_TASK_ASSIGNED_BY,
      item && item.request_note,
      item && item.REQUEST_NOTE
    ].join(' ');
  })).join(' ').toLowerCase();
  return metaText.indexOf('eval task') !== -1 || metaText.indexOf('eval-task') !== -1 || metaText.indexOf('eval_task') !== -1;
}

function isSuspendTagCompletionEmail_(payload) {
  if (String(payload && payload.emailType || '').trim().toLowerCase() !== 'request_complete') return false;
  const source = String(firstNonEmptyRequestValue_(
    payload && payload.source,
    payload && payload.emailSubType,
    payload && payload.email_sub_type,
    payload && payload.requestSource,
    payload && payload.request_source,
    ''
  )).trim().toLowerCase();
  if (source === 'dock_suspend_dc' || source === 'dock_suspend_dc_cancel' || source === 'suspend_tag') return true;
  const folder = String(firstNonEmptyRequestValue_(payload && payload.folderId, payload && payload.requestFolder, '')).trim().toLowerCase();
  if (folder.indexOf('suspend-tag') === 0 || folder.indexOf('suspend_tag') === 0) return true;
  return getRequestPayloadItems_(payload).some(function(item) {
    if (!item) return false;
    if (item.DOCK_SUSPEND_DC_REQUEST || item.dock_suspend_dc_request) return true;
    const itemSource = String(firstNonEmptyRequestValue_(item.REQUEST_SOURCE, item.request_source, item.SOURCE, item.source, '')).trim().toLowerCase();
    return itemSource.indexOf('suspend') !== -1;
  });
}

function getSuspendTagCompletionBrandLabel_(payload) {
  return String(firstNonEmptyRequestValue_(
    payload && payload.fromName,
    payload && payload.brandLabel,
    payload && payload.emailDisplayName,
    payload && payload.sourceLabel,
    'GNC PH Suspend Tag'
  )).trim() || 'GNC PH Suspend Tag';
}

function splitSuspendTagCustomerLabel_(value) {
  const text = String(value || '').trim();
  if (!text) return ['', ''];
  const parts = text.split(/\s*\|\s*/).map(function(part) {
    return String(part || '').trim();
  }).filter(Boolean);
  return [parts[0] || text, parts[1] || ''];
}

function getSuspendTagCustomerName_(item) {
  const explicit = String(firstNonEmptyRequestValue_(
    item && item.customername,
    item && item.CUSTOMERNAME,
    item && item.customer_name,
    item && item.CUSTOMER_NAME,
    item && item.customer,
    item && item.CUSTOMER,
    ''
  )).trim();
  if (explicit) return explicit;
  return splitSuspendTagCustomerLabel_(firstNonEmptyRequestValue_(item && item.req_customer, item && item.REQ_CUSTOMER, item && item.customer, item && item.CUSTOMER, ''))[0];
}

function getSuspendTagConsigneeName_(item) {
  const explicit = String(firstNonEmptyRequestValue_(
    item && item.consigneename,
    item && item.CONSIGNEENAME,
    item && item.consignee_name,
    item && item.CONSIGNEE_NAME,
    item && item.consignee,
    item && item.CONSIGNEE,
    ''
  )).trim();
  if (explicit) return explicit;
  return splitSuspendTagCustomerLabel_(firstNonEmptyRequestValue_(item && item.req_customer, item && item.REQ_CUSTOMER, item && item.customer, item && item.CUSTOMER, ''))[1];
}

function getSuspendTagCompletionFieldRows_(item) {
  const row = item || {};
  return [
    ['Spec', firstNonEmptyRequestValue_(row.spec, row.REQ_SPEC, row.req_spec, row.DOCK_SPEC, row.dock_spec, row.SPEC, '')],
    ['Customer Name', getSuspendTagCustomerName_(row)],
    ['Consignee Name', getSuspendTagConsigneeName_(row)],
    ['Dock Number', firstNonEmptyRequestValue_(row.dock_number, row.DOCK_NUMBER, row.dock_num, row.DOCK_NUM, row.dock, row.DOCK, '')],
    ['Drop Number', firstNonEmptyRequestValue_(row.drop_number, row.DROP_NUMBER, row.stopnumber, row.STOPNUMBER, row.stop, row.STOP, row.drop, row.DROP, '')],
    ['Photo Match Qty', firstNonEmptyRequestValue_(
      row.photo_match_qty,
      row.PHOTO_MATCH_QTY,
      row.loc_match_qty,
      row.LOC_MATCH_QTY,
      row.req_loc_match_qty,
      row.REQ_LOC_MATCH_QTY,
      getRequestLocPhotoMatchEmailValue_(row),
      ''
    )]
  ].map(function(field) {
    return [field[0], String(field[1] || '').trim() || '-'];
  });
}

function buildSuspendTagCompletionPhotoPreviewHtml_(folderId, item) {
  const photoUrls = getRequestItemPhotoUrls_(item);
  if (!photoUrls.length) return '';
  const galleryUrl = buildRequestRowGalleryUrl_(folderId, item);
  const photoCountText = photoUrls.length === 1 ? '1 photo' : photoUrls.length + ' photos';
  const photoPreviewStripHtml = buildRequestEmailPhotoPreviewStripHtml_(photoUrls, {
    titlePrefix: 'Photo',
    tileSize: 116,
    thumbWidth: 360,
    maxPhotos: 12
  });
  const galleryButtonHtml = galleryUrl ? [
    '<div style="text-align:center;">',
    '<a href="' + escapeEmailAttribute_(galleryUrl) + '" style="display:inline-block;padding:10px 14px;border-radius:999px;background:#007a4d;color:#ffffff;font-weight:700;text-decoration:none;">View Row Photo Gallery</a>',
    '</div>'
  ].join('') : '';
  return [
    '<div style="margin:12px 0;padding:10px;border:1px solid #b7f2d1;border-radius:12px;background:#f0fdf4;">',
    '<p style="margin:0 0 10px 0;color:#065f46;font-size:13px;line-height:1.45;font-weight:700;">' + escapeEmailHtml_(photoCountText) + ' captured for this row.</p>',
    photoPreviewStripHtml,
    galleryButtonHtml,
    '</div>'
  ].join('');
}

function buildSuspendTagCompletionItemsHtml_(payload) {
  return buildRequestEmailTableItemsHtml_(payload, { title: 'Suspend Tag Rows' });
}

function buildSuspendTagCompletionItemsText_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  if (!items.length) return String(payload.formattedItemsText || '').trim();
  return items.map(function(item, index) {
    const photoCount = getRequestItemPhotoUrls_(item).length;
    const title = [
      firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Suspend Tag Row'),
      firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, '')
    ].map(function(value) { return String(value || '').trim(); }).filter(Boolean).join(' ');
    const fieldLines = getSuspendTagCompletionFieldRows_(item).map(function(field) {
      return field[0] + ': ' + field[1];
    });
    if (photoCount) fieldLines.push('Photos: ' + photoCount);
    return [(index + 1) + '. ' + title].concat(fieldLines).join('\n');
  }).join('\n\n');
}

function getEmailTableValue_(item, fields, fallback) {
  const safeFields = Array.isArray(fields) ? fields : [];
  const row = item || {};
  for (let i = 0; i < safeFields.length; i++) {
    const fieldName = safeFields[i];
    const value = row[fieldName];
    if (String(value == null ? '' : value).trim() !== '') return value;
  }
  return fallback == null ? '' : fallback;
}

function normalizeEmailTableDisplay_(value, fallback) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback == null ? '' : fallback;
  return raw;
}

function buildEmailTableHeaderCell_(label) {
  return '<th style="padding:8px 10px;background:#555a57;color:#f4f4f4;font-size:13px;line-height:1.15;font-weight:900;text-align:left;text-transform:uppercase;border-bottom:2px solid #b8b8b8;white-space:normal;">' + escapeEmailHtml_(label) + '</th>';
}

function buildEmailTableDataCell_(value, options) {
  const safeOptions = options || {};
  const raw = normalizeEmailTableDisplay_(value, '');
  const content = safeOptions.html ? String(value || '') : (raw ? escapeEmailHtml_(raw) : '&nbsp;');
  const weight = safeOptions.bold === false ? '600' : '800';
  const highlight = safeOptions.highlight ? 'background:#fff176;' : '';
  const nowrap = safeOptions.nowrap ? 'white-space:nowrap;' : '';
  return '<td style="padding:10px;border-bottom:1px solid #b8b8b8;color:inherit;font-size:13px;line-height:1.25;font-weight:' + weight + ';vertical-align:top;word-break:break-word;' + nowrap + highlight + '">' + content + '</td>';
}

function buildEmailTable_(headers, cells) {
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const safeCells = Array.isArray(cells) ? cells : [];
  return [
    '<table class="gnc-email-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:auto;margin:0 0 14px 0;">',
    safeHeaders.length ? '<thead><tr>' + safeHeaders.map(buildEmailTableHeaderCell_).join('') + '</tr></thead>' : '',
    '<tbody><tr>' + safeCells.join('') + '</tr></tbody>',
    '</table>'
  ].join('');
}

function buildEmailRowsTable_(headers, rows) {
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  return [
    '<table class="gnc-email-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:auto;margin:0 0 14px 0;">',
    safeHeaders.length ? '<thead><tr>' + safeHeaders.map(buildEmailTableHeaderCell_).join('') + '</tr></thead>' : '',
    '<tbody>' + safeRows.map(function(cells) { return '<tr>' + cells.join('') + '</tr>'; }).join('') + '</tbody>',
    '</table>'
  ].join('');
}

function normalizeRequestChangedFieldDisplay_(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || ['BLANK', 'NULL', '-'].indexOf(raw.toUpperCase()) !== -1) return '';
  return raw;
}

function normalizeRequestChangedFieldCompare_(value) {
  return normalizeRequestChangedFieldDisplay_(value).replace(/\s+/g, ' ').trim().toUpperCase();
}

function parseRequestChangedFieldsJson_(item) {
  const raw = String(firstNonEmptyRequestValue_(
    item && item.changed_fields_json,
    item && item.CHANGED_FIELDS_JSON,
    item && item.changedFieldsJson,
    item && item.changedFields,
    ''
  ) || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(function(field) {
      return {
        label: String(firstNonEmptyRequestValue_(field && field.label, field && field.field, field && field.FIELD, '') || '').trim(),
        current: String(firstNonEmptyRequestValue_(field && field.current, field && field.CURRENT, field && field.original, field && field.ORIGINAL, '') || '').trim(),
        requested: String(firstNonEmptyRequestValue_(field && field.requested, field && field.REQUESTED, field && field.next, field && field.NEXT, '') || '').trim()
      };
    }).filter(function(field) {
      return field.label && String(field.requested || '').trim();
    });
  } catch (error) {
    return [];
  }
}

function getRequestChangedFieldValue_(item, keys, fallback) {
  const safeItem = item || {};
  const safeKeys = Array.isArray(keys) ? keys : [];
  for (let i = 0; i < safeKeys.length; i += 1) {
    const key = safeKeys[i];
    if (Object.prototype.hasOwnProperty.call(safeItem, key)) {
      const value = safeItem[key];
      if (String(value == null ? '' : value).trim() !== '') return value;
    }
  }
  return fallback == null ? '' : fallback;
}

function buildRequestChangedFieldsRows_(item) {
  const parsed = parseRequestChangedFieldsJson_(item);
  if (parsed.length) return parsed;
  const rows = [];
  const add = function(label, currentValue, requestedValue) {
    const current = normalizeRequestChangedFieldDisplay_(currentValue);
    const requested = normalizeRequestChangedFieldDisplay_(requestedValue);
    if (!requested) return;
    if (normalizeRequestChangedFieldCompare_(current) === normalizeRequestChangedFieldCompare_(requested)) return;
    rows.push({
      label: label,
      current: current || 'Blank',
      requested: requested || 'Blank'
    });
  };
  add('PRIORITY',
    getRequestChangedFieldValue_(item, ['ORIGINAL_PRIORITY', 'original_priority', 'originalPriority', 'priority', 'PRIORITY'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_PRIORITY', 'requested_priority', 'requestedPriority', 'NCR_PRIORITY'], '')
  );
  add('HOLDSTOPCODE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_HOLDSTOPCODE', 'original_holdstopcode', 'originalHoldStopCode', 'holdstopcode', 'HOLDSTOPCODE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_HOLDSTOPCODE', 'requested_holdstopcode', 'requestedHoldStopCode', 'NCR_HOLDSTOPCODE'], '')
  );
  add('HOLDSTOPREASON',
    getRequestChangedFieldValue_(item, ['ORIGINAL_HOLDSTOPREASON', 'original_holdstopreason', 'originalHoldStopReason', 'holdstopreason', 'HOLDSTOPREASON'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_HOLDSTOPREASON', 'requested_holdstopreason', 'requestedHoldStopReason', 'NCR_HOLDSTOPREASON'], '')
  );
  add('LOTCODE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_LOTCODE', 'original_lotcode', 'originalLotcode', 'lotcode', 'LOTCODE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_LOTCODE', 'requested_lotcode', 'requestedLotcode'], '')
  );
  add('LOCATIONCODE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_LOCATIONCODE', 'original_locationcode', 'originalLocationcode', 'locationcode', 'LOCATIONCODE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_LOCATIONCODE', 'requested_locationcode', 'requestedLocationcode'], '')
  );
  add('SOURCE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_SOURCE', 'original_source', 'originalSource', 'source', 'SOURCE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_SOURCE', 'requested_source', 'requestedSource'], '')
  );
  add('PTRONHAND',
    getRequestChangedFieldValue_(item, ['ORIGINAL_PTRONHAND', 'original_ptronhand', 'originalPtronhand', 'ptronhand', 'PTRONHAND'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_PTRONHAND', 'requested_ptronhand', 'requestedPtronhand'], '')
  );
  add('PTRREVIEWED',
    getRequestChangedFieldValue_(item, ['ORIGINAL_PTRREVIEWED', 'original_ptrreviewed', 'originalPtrreviewed', 'ptrreviewed', 'PTRREVIEWED'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_PTRREVIEWED', 'requested_ptrreviewed', 'requestedPtrreviewed'], '')
  );
  add('PTRAVAILABLE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_PTRAVAILABLE', 'original_ptravailable', 'originalPtravailable', 'ptravailable', 'PTRAVAILABLE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_PTRAVAILABLE', 'requested_ptravailable', 'requestedPtravailable'], '')
  );
  add('EVAL DATE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_EVALDATE', 'original_evaldate', 'originalEvalDate', 'evaldate', 'EVALDATE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_EVALDATE', 'requested_evaldate', 'requestedEvalDate'], '')
  );
  add('PRI BY',
    getRequestChangedFieldValue_(item, ['ORIGINAL_PRIBY', 'ORIGINAL_PRISETBY', 'original_priby', 'original_prisetby', 'priby', 'PRIBY', 'prisetby', 'PRISETBY'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_PRIBY', 'REQUESTED_PRISETBY', 'requested_priby', 'requested_prisetby'], '')
  );
  add('PRI UPDATE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_PRIUPDATED', 'original_priupdated', 'originalPriupdated', 'priupdated', 'PRIUPDATED'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_PRIUPDATED', 'requested_priupdated', 'requestedPriupdated'], '')
  );
  add('NOTE DATE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_LOCATIONNOTEDATE', 'original_locationnotedate', 'originalLocationNoteDate', 'locationnotedate', 'LOCATIONNOTEDATE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_LOCATIONNOTEDATE', 'requested_locationnotedate', 'requestedLocationNoteDate', 'NCR_LOCATIONNOTEDATE'], '')
  );
  add('LOCATIONNOTE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_LOCATIONNOTE', 'original_locationnote', 'originalLocationNote', 'locationnote', 'LOCATIONNOTE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_LOCATIONNOTE', 'requested_locationnote', 'requestedLocationNote', 'NCR_LOCATIONNOTE'], '')
  );
  add('LOCATIONPTN1',
    getRequestChangedFieldValue_(item, ['ORIGINAL_LOCATIONPTN1', 'original_locationptn1', 'originalLocationPtn1', 'locationptn1', 'LOCATIONPTN1'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_LOCATIONPTN1', 'requested_locationptn1', 'requestedLocationPtn1', 'NCR_LOCATIONPTN1'], '')
  );
  add('SALESNOTE',
    getRequestChangedFieldValue_(item, ['ORIGINAL_SALESNOTE', 'original_salesnote', 'originalSalesNote', 'salesnote', 'SALESNOTE'], ''),
    getRequestChangedFieldValue_(item, ['REQUESTED_SALESNOTE', 'requested_salesnote', 'requestedSalesNote', 'NCR_SALESNOTE'], '')
  );
  return rows;
}

function buildRequestChangedFieldsTableHtml_(item) {
  const rows = buildRequestChangedFieldsRows_(item);
  if (!rows.length) return '';
  return [
    '<div style="font-weight:800;margin:0 0 10px 0;text-transform:uppercase;letter-spacing:.08em;color:#007a4d;">Changed Fields</div>',
    buildEmailRowsTable_(
      ['FIELD', 'CURRENT', 'REQUESTED'],
      rows.map(function(field) {
        return [
          buildEmailTableDataCell_(field.label, { bold: true, nowrap: true }),
          buildEmailTableDataCell_(field.current || 'Blank', { bold: true }),
          buildEmailTableDataCell_(field.requested || 'Blank', { bold: true, highlight: true })
        ];
      })
    )
  ].join('');
}

function buildRequestEmailTableItemsHtml_(payload, options) {
  const safePayload = payload || {};
  const safeOptions = options || {};
  const items = getRequestEmailPayloadItems_(safePayload);
  if (!items.length) return String(safePayload.formattedItemsHtml || '').trim();
  const galleryFolderId = resolveRequestGalleryFolderId_(safePayload, items);
  cacheRequestGalleryPayload_(galleryFolderId, items);
  const title = String(firstNonEmptyRequestValue_(safeOptions.title, '')).trim();
  const includePhotos = safeOptions.includePhotos !== false;
  const rowsHtml = items.map(function(item, index) {
    const itemTable = buildEmailTable_(
      ['ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'GENUS', 'SALESNOTE', 'HOLDSTOPCODE', 'HOLDSTOPREASON'],
      [
        buildEmailTableDataCell_(getEmailTableValue_(item, ['itemcode', 'ITEMCODE', 'itemCode', 'ITEM_CODE'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['commonname', 'COMMONNAME', 'commonName', 'COMMON_NAME'], 'Unknown Item'), { bold: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['contsize', 'CONTSIZE', 'contSize', 'CONT_SIZE'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['genus', 'GENUS', 'genusname', 'GENUSNAME'], ''), { bold: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['salesnote', 'SALESNOTE', 'sales_note', 'SALES_NOTE'], ''), { bold: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['holdstopcode', 'HOLDSTOPCODE', 'holstopcode', 'HOLSTOPCODE'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['holdstopreason', 'HOLDSTOPREASON', 'holstopreason', 'HOLSTOPREASON'], ''), { bold: true })
      ]
    );
    const rowTable = buildEmailTable_(
      ['ROW', 'LOTCODE', 'LOCATIONCODE', 'SOURCE', 'DESIGCUST'],
      [
        buildEmailTableDataCell_(getEmailTableValue_(item, ['row', 'ROW', 'row_index', 'ROW_INDEX'], String(index + 1)), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['lotcode', 'LOTCODE', 'lotCode', 'LOT_CODE'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['locationcode', 'LOCATIONCODE', 'loc', 'LOC', 'location'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['source', 'SOURCE', 'sourcecode', 'SOURCECODE'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['desigcust', 'DESIGCUST', 'desig_cust', 'DESIG_CUST'], ''), { bold: true, nowrap: true })
      ]
    );
    const qtyTable = buildEmailTable_(
      ['PRIORITY', 'PTRONHAND', 'PTRREVIEWED', 'PTRAVAILABLE'],
      [
        buildEmailTableDataCell_(getEmailTableValue_(item, ['priority', 'PRIORITY'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['ptronhand', 'PTRONHAND', 'onhand', 'ONHAND'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['ptrreviewed', 'PTRREVIEWED', 'review', 'REVIEW'], ''), { bold: true, nowrap: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['ptravailable', 'PTRAVAILABLE', 'available', 'AVAILABLE'], ''), { bold: true, nowrap: true })
      ]
    );
    const noteTable = buildEmailTable_(
      ['LOCATIONNOTEDATE', 'LOCATIONNOTE', 'LOCATIONPTN1'],
      [
        buildEmailTableDataCell_(getEmailTableValue_(item, ['locationnotedate', 'LOCATIONNOTEDATE', 'note_date', 'NOTE_DATE'], ''), { bold: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['locationnote', 'LOCATIONNOTE', 'loc_note', 'LOC_NOTE'], ''), { bold: true }),
        buildEmailTableDataCell_(getEmailTableValue_(item, ['locationptn1', 'LOCATIONPTN1', 'ptn1', 'PTN1'], ''), { bold: true })
      ]
    );
    const changedFieldsTable = buildRequestChangedFieldsTableHtml_(item);
    const requestFields = [
      ['ACTION', getEmailTableValue_(item, ['approval_label', 'approvalLabel', 'approval_type', 'APPROVAL_TYPE', 'action', 'ACTION'], '')],
      ['QTY', getEmailTableValue_(item, ['qty', 'REQ_QTY', 'request_qty', 'requested_qty', 'ncr_qty', 'NCR_QTY', 'loc_match_qty', 'LOC_MATCH_QTY'], '')],
      ['MOVE DOWN SEASON', getEmailTableValue_(item, ['move_down_season', 'MOVE_DOWN_SEASON', 'moveDownSeason'], '')],
      ['SPEC', getEmailTableValue_(item, ['spec', 'REQ_SPEC', 'SPEC'], '')],
      ['LOC PHOTO MATCH', getRequestLocPhotoMatchEmailValue_(item)],
      ['AV NOTE', getEmailTableValue_(item, ['av_note', 'AV_NOTE'], '')],
      ['PICK NOTE', getEmailTableValue_(item, ['pick_note', 'pick', 'req_pick', 'req_pic_note', 'REQ_PICK', 'REQ_PIC_NOTE', 'PICK'], '')],
      ['COMMENTS', getEmailTableValue_(item, ['comments', 'req_comments', 'request_comments', 'REQ_COMMENTS', 'REQUEST_COMMENTS', 'COMMENTS'], '')],
      ['REQUEST NOTE', getEmailTableValue_(item, ['request_note', 'req_note', 'REQUEST_NOTE', 'REQ_NOTE'], '')]
    ].filter(function(field) {
      return String(field[1] == null ? '' : field[1]).trim() !== '';
    });
    const requestTables = [];
    for (let start = 0; start < requestFields.length; start += 4) {
      const chunk = requestFields.slice(start, start + 4);
      requestTables.push(buildEmailTable_(
        chunk.map(function(field) { return field[0]; }),
        chunk.map(function(field) {
          const highlight = /^(ACTION|QTY|LOC PHOTO MATCH|REQUEST NOTE)$/i.test(field[0]);
          return buildEmailTableDataCell_(field[1], { bold: true, highlight: highlight });
        })
      ));
    }
    const requestTable = requestTables.join('');
    const photosHtml = includePhotos ? buildRequestRowPhotoPreviewHtml_(galleryFolderId, item) : '';
    return [
      '<div style="margin:0 0 18px 0;line-height:1.45;">',
      title && index === 0 ? '<div style="font-weight:700;margin:0 0 10px 0;">' + escapeEmailHtml_(title) + '</div>' : '',
      itemTable,
      rowTable,
      qtyTable,
      noteTable,
      changedFieldsTable,
      requestTable,
      photosHtml,
      '</div>'
    ].join('');
  }).join('');
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;">',
    '<style>@media screen and (max-width: 620px) {.gnc-email-table th,.gnc-email-table td{font-size:12px!important;padding:7px 6px!important;}}</style>',
    rowsHtml,
    '</div>'
  ].join('');
}

function getEvalTaskCompletionSummary_(payload) {
  const items = getRequestPayloadItems_(payload);
  const firstItem = items.length ? items[0] || {} : {};
  const requester = firstNonEmptyRequestValue_(
    payload && payload.evalTaskRequestedBy,
    payload && payload.eval_task_requested_by,
    payload && payload.assignedBy,
    payload && payload.assigned_by,
    getEvalTaskRequestedByFromItem_(firstItem),
    ''
  );
  const reviewer = firstNonEmptyRequestValue_(
    payload && payload.evalTaskAssignee,
    payload && payload.eval_task_assignee,
    firstItem && firstItem.assignedto,
    firstItem && firstItem.ASSIGNEDTO,
    payload && payload.repName,
    payload && payload.salesRepName,
    payload && payload.requestedBy,
    ''
  );
  const completedBy = buildRequestCompletedBySummary_(payload);
  const taskType = getEvalTaskEmailTypeLabel_(firstNonEmptyRequestValue_(
    payload && payload.evalTaskType,
    payload && payload.eval_task_type,
    firstItem && firstItem.eval_task_type,
    firstItem && firstItem.EVAL_TASK_TYPE,
    payload && payload.customer,
    ''
  ));
  return {
    requester: requester,
    reviewer: reviewer,
    completedBy: completedBy,
    taskType: taskType
  };
}

function collectRequestSubmitterEmails_(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const requestCreator = safePayload.requestCreator && typeof safePayload.requestCreator === 'object'
    ? safePayload.requestCreator
    : {};
  const candidates = [];
  const addCandidate = function(email, username, display) {
    const resolved = normalizeEmailAddress_(resolveRequestRecipientEmail_(
      firstNonEmptyRequestValue_(username, display, ''),
      email
    ));
    if (isLikelyEmailAddress_(resolved)) candidates.push(resolved);
  };
  addCandidate(
    firstNonEmptyRequestValue_(
      safePayload.requestCreatedByEmail,
      safePayload.request_created_by_email,
      safePayload.requestCreatorEmail,
      safePayload.creatorEmail,
      safePayload.submittedByEmail,
      safePayload.submitted_by_email,
      requestCreator.creatorEmail,
      requestCreator.email,
      ''
    ),
    firstNonEmptyRequestValue_(
      safePayload.requestCreatedByUsername,
      safePayload.request_created_by_username,
      safePayload.requestCreatorUsername,
      safePayload.creatorUsername,
      safePayload.submittedByUsername,
      safePayload.submitted_by_username,
      requestCreator.creatorUsername,
      requestCreator.username,
      ''
    ),
    firstNonEmptyRequestValue_(
      safePayload.requestCreatedByDisplay,
      safePayload.request_created_by_display,
      safePayload.requestCreatorDisplay,
      safePayload.creatorDisplay,
      safePayload.submittedByDisplay,
      safePayload.submitted_by_display,
      requestCreator.creatorDisplay,
      requestCreator.display,
      ''
    )
  );
  getRequestEmailPayloadItems_(safePayload).forEach(function(item) {
    addCandidate(
      firstNonEmptyRequestValue_(item && item.request_created_by_email, item && item.REQUEST_CREATED_BY_EMAIL, ''),
      firstNonEmptyRequestValue_(item && item.request_created_by_username, item && item.REQUEST_CREATED_BY_USERNAME, ''),
      firstNonEmptyRequestValue_(item && item.request_created_by_display, item && item.REQUEST_CREATED_BY_DISPLAY, '')
    );
  });
  return dedupeEmailAddresses_(candidates);
}

function collectRequestRecipients_(payload) {
  const emailType = String(payload && payload.emailType || '').trim().toLowerCase();
  const emailSubType = String(payload && (payload.emailSubType || payload.email_sub_type) || '').trim().toLowerCase();
  const isBlockClearingEmail = emailType === 'block_clearing_email' || emailSubType === 'block_clearing_email' || (payload && payload.blockClearingEmail === true);
  const sendToAllSalesReps = payload && (payload.sendToAllSalesReps === true || emailType === 'drive_shift_report' || isBlockClearingEmail);
  const repName = (emailType === 'drive_shift_report' || isBlockClearingEmail)
    ? ''
    : String(payload.repName || payload.salesRepName || payload.requestedBy || '').trim();
  const repEmail = sendToAllSalesReps ? '' : normalizeEmailAddress_(resolveRequestRecipientEmail_(repName, payload.repEmail || payload.salesRepEmail || ''));
  const approvalStage = String(payload && (payload.approvalStage || payload.approval_stage) || '').trim().toLowerCase();
  const approvalType = String(payload && (payload.approvalType || payload.approval_type) || '').trim().toLowerCase().replace(/_/g, '-');
  const requestedByEmail = normalizeEmailAddress_(payload && (payload.requestedByEmail || payload.requested_by_email) || '');
  const isInventoryTransactionReportEmail = emailType === 'bloom_purpose_report' || (
    emailType === 'drive_customer_outreach' &&
    ['grouped_bloom_ncr', 'paper_ncr_item_inquiry', 'suspend_tag_photo_spec'].indexOf(emailSubType) !== -1
  );
  const inventoryTransactionFallbackRecipients = isInventoryTransactionReportEmail
    ? dedupeEmailAddresses_([
        INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_EMAILS_,
        requestedByEmail,
        resolveRequestRecipientEmail_(firstNonEmptyRequestValue_(
          payload && payload.requestedBy,
          payload && payload.requestedByDisplay,
          payload && payload.submittedBy,
          payload && payload.completedBy,
          payload && payload.createdBy,
          ''
        ), '')
      ])
    : [];
  const explicitApprovalRecipients = dedupeEmailAddresses_([
    payload && payload.recipientEmails,
    payload && payload.emailRecipients,
    payload && payload.internalRecipients,
    payload && payload.recipients
  ]);
  const isRequestEmailFlow = emailType === 'new_request' || emailType.indexOf('request_') === 0;
  const isRequestLifecycleEmail = emailType === 'new_request' || emailType === 'request_complete';
  const requestLifecycleRequiredRecipients = isRequestLifecycleEmail ? REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_ : [];
  const requestSubmitterEmails = isRequestLifecycleEmail ? collectRequestSubmitterEmails_(payload) : [];
  const hasDylanRecipientOverride = payload && !isRequestEmailFlow && (
    payload.dylanRecipientOverride === true ||
    String(payload.recipientOverrideAppliedBy || payload.recipient_override_applied_by || '').trim().toLowerCase() === 'dylan_collyge'
  );
  if (hasDylanRecipientOverride) {
    const recipients = dedupeEmailAddresses_([
      payload.recipientEmails,
      payload.emailRecipients,
      payload.internalRecipients,
      payload.recipients,
      inventoryTransactionFallbackRecipients
    ]);
    return {
      repEmail: repEmail,
      toArray: recipients,
      toList: recipients.join(',')
    };
  }
  const hasExplicitApprovalRecipients = (emailType === 'ncr_approval' || emailType === 'hold_release_request') && explicitApprovalRecipients.length > 0;
  const approvalFallbackRecipients = [];
  const bloomCropUpdateInternalRecipients = [];
  const driveShiftFallbackRecipients = [];
  const blockClearingFallbackRecipients = [];
  if ((emailType === 'ncr_approval' || emailType === 'hold_release_request') && !hasExplicitApprovalRecipients) {
    if (approvalStage === 'jd') {
      approvalFallbackRecipients.push('dylan_collyge@greenleafnursery.com', 'megan_kelly@greenleafnursery.com', 'jd_jones@greenleafnursery.com');
    } else if (approvalStage === 'inventory') {
      approvalFallbackRecipients.push('dylan_collyge@greenleafnursery.com', 'megan_kelly@greenleafnursery.com', 'jd_jones@greenleafnursery.com');
    } else {
      approvalFallbackRecipients.push('dylan_collyge@greenleafnursery.com', 'megan_kelly@greenleafnursery.com');
    }
  }
  if (emailType === 'bloom_crop_update') {
    bloomCropUpdateInternalRecipients.push(
      'dylan_collyge@greenleafnursery.com',
      'jd_jones@greenleafnursery.com',
      'megan_kelly@greenleafnursery.com'
    );
  }
  if (emailType === 'drive_shift_report') {
    driveShiftFallbackRecipients.push('dylan_collyge@greenleafnursery.com');
  }
  if (isBlockClearingEmail && requestedByEmail) {
    blockClearingFallbackRecipients.push(requestedByEmail);
  }
  const recipients = dedupeEmailAddresses_([
    requestLifecycleRequiredRecipients,
    requestSubmitterEmails,
    payload.recipientEmails,
    payload.emailRecipients,
    payload.internalRecipients,
    payload.selectedRepRecipients,
    payload.repRecipientEmails,
    payload.salesRepEmails,
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
    payload.meganEmail,
    requestedByEmail,
    repEmail,
    approvalFallbackRecipients,
    bloomCropUpdateInternalRecipients,
    driveShiftFallbackRecipients,
    blockClearingFallbackRecipients,
    inventoryTransactionFallbackRecipients
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
  return buildCompactRequestItemsHtml_({
    emailType: 'flyer_created',
    requestItems: safeItems,
    itemsCount: safeItems.length,
    subject: 'GNC PH Flyer Created'
  });
}

function buildFlyerCreatedItemsText_(items) {
  const safeItems = Array.isArray(items) ? items : [];
  return buildRequestItemsText_({
    emailType: 'flyer_created',
    requestItems: safeItems,
    itemsCount: safeItems.length,
    subject: 'GNC PH Flyer Created'
  });
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
  const htmlBody = buildPhoneSizedEmailHtml_([
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
  ].join(''));
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
    : safeType === 'drive_shift_report'
      ? 'GNC PH Shift'
    : safeType === 'block_clearing_email'
      ? 'GNC PH Block Clearing'
    : buildDefaultRequestEmailSubject_(payload);
}

function normalizeRequestIdList_(ids) {
  return Array.isArray(ids)
    ? ids.map(function(id) { return String(id || '').trim(); }).filter(Boolean)
    : [];
}

function getRequestEmailTableCandidates_(legacyTableName, siteCode) {
  const legacy = String(legacyTableName || '').trim();
  const runtime = String(getRuntimeSiteSplitTableName_(legacy, siteCode || 'PH') || '').trim();
  const tables = [];
  if (runtime) tables.push(runtime);
  if (legacy && tables.indexOf(legacy) === -1) tables.push(legacy);
  return tables;
}

function isArchivedRequestRow_(row) {
  const archivedRaw = firstNonEmptyRequestValue_(row && row.req_archived, row && row.REQ_ARCHIVED, false);
  const archivedText = String(archivedRaw == null ? '' : archivedRaw).trim().toLowerCase();
  return archivedRaw === true || archivedRaw === 1 || archivedRaw === '1' || archivedText === 'true';
}

function fetchRequestRowsForEmailFolder_(folderId) {
  const safeFolderId = String(folderId || '').trim();
  if (!safeFolderId) return [];
  const baseFields = '*';
  const fieldsWithCompleter = baseFields + ',completed_by_username,completed_by_display,completed_by_email';
    const requestTableNames = ['ph_active_request_live_rows'];
  const loadRows = function(selectFields, requestTableName) {
    const url = `${SUPABASE_URL}/rest/v1/${requestTableName}?select=${selectFields}&request_folder=eq.${encodeURIComponent(safeFolderId)}`;
    const result = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: getSupabaseHeaders_()
    });
    return result;
  };
  for (let tableIndex = 0; tableIndex < requestTableNames.length; tableIndex++) {
    const requestTableName = requestTableNames[tableIndex];
    let response = loadRows(fieldsWithCompleter, requestTableName);
    let status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
    let bodyText = response && response.getContentText ? response.getContentText() : '';
    if (status < 200 || status >= 300) {
      const normalizedBody = String(bodyText || '').toLowerCase();
      if (normalizedBody.indexOf('completed_by_') !== -1 || normalizedBody.indexOf('column') !== -1) {
        response = loadRows(baseFields, requestTableName);
        status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
        bodyText = response && response.getContentText ? response.getContentText() : '';
      }
    }
    if (status < 200 || status >= 300) {
      console.error('[REQUEST EMAIL] Could not load request rows for delayed reply', {
        folderId: safeFolderId,
        tableName: requestTableName,
        status: status,
        body: bodyText
      });
      continue;
    }
    try {
      const parsed = JSON.parse(bodyText || '[]');
      const rows = Array.isArray(parsed) ? parsed : [];
      if (rows.length || tableIndex === requestTableNames.length - 1) return rows;
    } catch (error) {
      console.error('[REQUEST EMAIL] Could not parse delayed request rows', {
        folderId: safeFolderId,
        tableName: requestTableName,
        error: error && error.message ? error.message : error
      });
    }
  }
  return [];
}

function normalizeRequestGalleryIdList_(value) {
  const ids = [];
  const seen = {};
  const addId = function(entry) {
    const id = String(entry == null ? '' : entry).trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  };
  const walk = function(input) {
    if (input == null) return;
    if (Array.isArray(input)) {
      input.forEach(walk);
      return;
    }
    String(input || '').split(/[,\n]+/).forEach(addId);
  };
  walk(value);
  return ids;
}

function filterRequestGalleryItemsByIds_(items, requestIds) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const safeIds = normalizeRequestGalleryIdList_(requestIds);
  if (!safeIds.length) return safeItems;
  const idSet = {};
  safeIds.forEach(function(id) { idSet[id] = true; });
  return safeItems.filter(function(item) {
    const itemId = String(firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, item && item.id, item && item.ID, '')).trim();
    return !!itemId && !!idSet[itemId];
  });
}

function fetchRequestRowsForEmailRequestIds_(requestIds) {
  const safeIds = normalizeRequestGalleryIdList_(requestIds);
  if (!safeIds.length) return [];
  const baseFields = '*';
  const fieldsWithCompleter = baseFields + ',completed_by_username,completed_by_display,completed_by_email';
    const requestTableNames = ['ph_active_request_live_rows'];
  const buildInFilter = function(ids) {
    return ids.map(function(id) {
      return '"' + String(id || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }).join(',');
  };
  const loadRows = function(selectFields, ids, requestTableName) {
    const url = `${SUPABASE_URL}/rest/v1/${requestTableName}?select=${selectFields}&unique_id=in.(${encodeURIComponent(buildInFilter(ids))})`;
    return UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: getSupabaseHeaders_()
    });
  };
  let rows = [];
  for (let offset = 0; offset < safeIds.length; offset += 50) {
    const batchIds = safeIds.slice(offset, offset + 50);
    for (let tableIndex = 0; tableIndex < requestTableNames.length; tableIndex++) {
      const requestTableName = requestTableNames[tableIndex];
      let response = loadRows(fieldsWithCompleter, batchIds, requestTableName);
      let status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
      let bodyText = response && response.getContentText ? response.getContentText() : '';
      if (status < 200 || status >= 300) {
        const normalizedBody = String(bodyText || '').toLowerCase();
        if (normalizedBody.indexOf('completed_by_') !== -1 || normalizedBody.indexOf('column') !== -1) {
          response = loadRows(baseFields, batchIds, requestTableName);
          status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
          bodyText = response && response.getContentText ? response.getContentText() : '';
        }
      }
      if (status < 200 || status >= 300) {
        console.error('[REQUEST EMAIL] Could not load request rows by IDs', {
          requestIds: batchIds,
          tableName: requestTableName,
          status: status,
          body: bodyText
        });
        continue;
      }
      try {
        const parsed = JSON.parse(bodyText || '[]');
        const batchRows = Array.isArray(parsed) ? parsed : [];
        if (batchRows.length || tableIndex === requestTableNames.length - 1) {
          rows = rows.concat(batchRows);
          break;
        }
      } catch (error) {
        console.error('[REQUEST EMAIL] Could not parse request rows by IDs', {
          requestIds: batchIds,
          tableName: requestTableName,
          error: error && error.message ? error.message : error
        });
      }
    }
  }
  return rows;
}

function fetchRequestHistoryRowsForEmailFolder_(folderId) {
  const safeFolderId = String(folderId || '').trim();
  if (!safeFolderId) return [];
  const requestHistoryTableNames = getRequestEmailTableCandidates_('ph_request_history', 'PH');
  for (let tableIndex = 0; tableIndex < requestHistoryTableNames.length; tableIndex++) {
    const requestHistoryTableName = requestHistoryTableNames[tableIndex];
    const url = `${SUPABASE_URL}/rest/v1/${requestHistoryTableName}?select=*&request_folder=eq.${encodeURIComponent(safeFolderId)}&order=updated_at.desc`;
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: getSupabaseHeaders_()
    });
    const status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
    const bodyText = response && response.getContentText ? response.getContentText() : '';
    if (status < 200 || status >= 300) {
      console.error('[REQUEST EMAIL] Could not load request history rows for gallery', {
        folderId: safeFolderId,
        tableName: requestHistoryTableName,
        status: status,
        body: bodyText
      });
      continue;
    }
    try {
      const parsed = JSON.parse(bodyText || '[]');
      const rows = Array.isArray(parsed) ? parsed : [];
      if (rows.length || tableIndex === requestHistoryTableNames.length - 1) return rows;
    } catch (error) {
      console.error('[REQUEST EMAIL] Could not parse request history rows for gallery', {
        folderId: safeFolderId,
        tableName: requestHistoryTableName,
        error: error && error.message ? error.message : error
      });
    }
  }
  return [];
}

function fetchRequestHistoryRowsForEmailRequestIds_(requestIds) {
  const safeIds = normalizeRequestGalleryIdList_(requestIds);
  if (!safeIds.length) return [];
  const requestHistoryTableNames = getRequestEmailTableCandidates_('ph_request_history', 'PH');
  const buildInFilter = function(ids) {
    return ids.map(function(id) {
      return '"' + String(id || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }).join(',');
  };
  let rows = [];
  for (let offset = 0; offset < safeIds.length; offset += 50) {
    const batchIds = safeIds.slice(offset, offset + 50);
    for (let tableIndex = 0; tableIndex < requestHistoryTableNames.length; tableIndex++) {
      const requestHistoryTableName = requestHistoryTableNames[tableIndex];
      const url = `${SUPABASE_URL}/rest/v1/${requestHistoryTableName}?select=*&unique_id=in.(${encodeURIComponent(buildInFilter(batchIds))})&order=updated_at.desc`;
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        headers: getSupabaseHeaders_()
      });
      const status = Number(response && response.getResponseCode ? response.getResponseCode() : 0) || 0;
      const bodyText = response && response.getContentText ? response.getContentText() : '';
      if (status < 200 || status >= 300) {
        console.error('[REQUEST EMAIL] Could not load request history rows by IDs', {
          requestIds: batchIds,
          tableName: requestHistoryTableName,
          status: status,
          body: bodyText
        });
        continue;
      }
      try {
        const parsed = JSON.parse(bodyText || '[]');
        const batchRows = Array.isArray(parsed) ? parsed : [];
        if (batchRows.length || tableIndex === requestHistoryTableNames.length - 1) {
          rows = rows.concat(batchRows);
          break;
        }
      } catch (error) {
        console.error('[REQUEST EMAIL] Could not parse request history rows by IDs', {
          requestIds: batchIds,
          tableName: requestHistoryTableName,
          error: error && error.message ? error.message : error
        });
      }
    }
  }
  return rows;
}

function parseRequestRowSnapshot_(row) {
  const rawSnapshot = row && (row.snapshot || row.SNAPSHOT);
  if (!rawSnapshot) return {};
  if (typeof rawSnapshot === 'object') return rawSnapshot || {};
  try {
    const parsed = JSON.parse(String(rawSnapshot || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function mergeRequestEmailRows_(primaryRows, fallbackRows) {
  const rows = [];
  const indexById = {};
  const addOrMerge = function(row) {
    if (!row) return;
    const id = String(firstNonEmptyRequestValue_(row.unique_id, row.UNIQUE_ID, '')).trim();
    if (id && Object.prototype.hasOwnProperty.call(indexById, id)) {
      const existing = rows[indexById[id]];
      Object.keys(row).forEach(function(key) {
        if (existing[key] == null || String(existing[key]).trim() === '') existing[key] = row[key];
      });
      const existingSnapshot = parseRequestRowSnapshot_(existing);
      const nextSnapshot = parseRequestRowSnapshot_(row);
      Object.keys(nextSnapshot).forEach(function(key) {
        if (existingSnapshot[key] == null || String(existingSnapshot[key]).trim() === '') existingSnapshot[key] = nextSnapshot[key];
      });
      if (Object.keys(existingSnapshot).length) existing.snapshot = existingSnapshot;
      return;
    }
    const cloned = row && typeof row === 'object' ? JSON.parse(JSON.stringify(row)) : row;
    if (id) indexById[id] = rows.length;
    rows.push(cloned);
  };
  (Array.isArray(primaryRows) ? primaryRows : []).forEach(addOrMerge);
  (Array.isArray(fallbackRows) ? fallbackRows : []).forEach(addOrMerge);
  return rows;
}

function buildRequestEmailItemsFromRows_(rows, payload) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const fallbackFolderId = String(firstNonEmptyRequestValue_(payload && payload.folderId, payload && payload.requestFolder, '')).trim();
  const fallbackCustomer = String(firstNonEmptyRequestValue_(payload && payload.customer, payload && payload.requestCustomer, '')).trim();
  return safeRows.map(function(item) {
    const snapshot = parseRequestRowSnapshot_(item);
    const emailItem = {
      unique_id: firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, ''),
      folder: firstNonEmptyRequestValue_(item && item.request_folder, item && item.REQUEST_FOLDER, fallbackFolderId),
      customer: firstNonEmptyRequestValue_(item && item.req_customer, item && item.REQ_CUSTOMER, item && item.request_customer, item && item.REQUEST_CUSTOMER, snapshot.REQ_CUSTOMER, snapshot.request_customer, fallbackCustomer),
      commonname: firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, snapshot.COMMONNAME, snapshot.commonname, ''),
      contsize: firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, ''),
      itemcode: firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, ''),
      genus: firstNonEmptyRequestValue_(item && item.genus, item && item.GENUS, item && item.genusname, item && item.GENUSNAME, snapshot.GENUS, snapshot.genus, snapshot.GENUSNAME, snapshot.genusname, ''),
      lotcode: firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, snapshot.LOTCODE, snapshot.lotcode, ''),
      row: firstNonEmptyRequestValue_(item && item.row, item && item.ROW, item && item.row_index, item && item.ROW_INDEX, snapshot.ROW, snapshot.row, ''),
      season: firstNonEmptyRequestValue_(item && item.season, item && item.SEASON, snapshot.SEASON, snapshot.season, ''),
      priority: firstNonEmptyRequestValue_(item && item.priority, item && item.PRIORITY, snapshot.PRIORITY, snapshot.priority, ''),
      ptronhand: firstNonEmptyRequestValue_(item && item.ptronhand, item && item.PTRONHAND, snapshot.PTRONHAND, snapshot.ptronhand, ''),
      ptrreviewed: firstNonEmptyRequestValue_(item && item.ptrreviewed, item && item.PTRREVIEWED, snapshot.PTRREVIEWED, snapshot.ptrreviewed, ''),
      ptravailable: firstNonEmptyRequestValue_(item && item.ptravailable, item && item.PTRAVAILABLE, snapshot.PTRAVAILABLE, snapshot.ptravailable, ''),
      source: firstNonEmptyRequestValue_(item && item.source, item && item.SOURCE, item && item.sourcecode, item && item.SOURCECODE, snapshot.SOURCE, snapshot.source, snapshot.SOURCECODE, snapshot.sourcecode, ''),
      desigcust: firstNonEmptyRequestValue_(item && item.desigcust, item && item.DESIGCUST, item && item.desig_cust, item && item.DESIG_CUST, snapshot.DESIGCUST, snapshot.desigcust, snapshot.DESIG_CUST, snapshot.desig_cust, ''),
      s_lts: firstNonEmptyRequestValue_(item && item.s_lts, item && item.S_LTS, snapshot.S_LTS, snapshot.s_lts, ''),
      qty: firstNonEmptyRequestValue_(item && item.req_qty, item && item.REQ_QTY, ''),
      loc: firstNonEmptyRequestValue_(item && item.locationcode, item && item.LOCATIONCODE, ''),
      locationcode: firstNonEmptyRequestValue_(item && item.locationcode, item && item.LOCATIONCODE, item && item.loc, item && item.LOC, snapshot.LOCATIONCODE, snapshot.locationcode, snapshot.LOC, snapshot.loc, ''),
      locationnotedate: firstNonEmptyRequestValue_(item && item.locationnotedate, item && item.LOCATIONNOTEDATE, snapshot.LOCATIONNOTEDATE, snapshot.locationnotedate, ''),
      locationnote: firstNonEmptyRequestValue_(item && item.locationnote, item && item.LOCATIONNOTE, snapshot.LOCATIONNOTE, snapshot.locationnote, ''),
      locationptn1: firstNonEmptyRequestValue_(item && item.locationptn1, item && item.LOCATIONPTN1, snapshot.LOCATIONPTN1, snapshot.locationptn1, ''),
      original_priority: firstNonEmptyRequestValue_(item && item.original_priority, item && item.ORIGINAL_PRIORITY, snapshot.ORIGINAL_PRIORITY, snapshot.original_priority, ''),
      requested_priority: firstNonEmptyRequestValue_(item && item.requested_priority, item && item.REQUESTED_PRIORITY, snapshot.REQUESTED_PRIORITY, snapshot.requested_priority, ''),
      original_holdstopcode: firstNonEmptyRequestValue_(item && item.original_holdstopcode, item && item.ORIGINAL_HOLDSTOPCODE, snapshot.ORIGINAL_HOLDSTOPCODE, snapshot.original_holdstopcode, ''),
      requested_holdstopcode: firstNonEmptyRequestValue_(item && item.requested_holdstopcode, item && item.REQUESTED_HOLDSTOPCODE, snapshot.REQUESTED_HOLDSTOPCODE, snapshot.requested_holdstopcode, ''),
      original_holdstopreason: firstNonEmptyRequestValue_(item && item.original_holdstopreason, item && item.ORIGINAL_HOLDSTOPREASON, snapshot.ORIGINAL_HOLDSTOPREASON, snapshot.original_holdstopreason, ''),
      requested_holdstopreason: firstNonEmptyRequestValue_(item && item.requested_holdstopreason, item && item.REQUESTED_HOLDSTOPREASON, snapshot.REQUESTED_HOLDSTOPREASON, snapshot.requested_holdstopreason, ''),
      original_lotcode: firstNonEmptyRequestValue_(item && item.original_lotcode, item && item.ORIGINAL_LOTCODE, snapshot.ORIGINAL_LOTCODE, snapshot.original_lotcode, ''),
      requested_lotcode: firstNonEmptyRequestValue_(item && item.requested_lotcode, item && item.REQUESTED_LOTCODE, snapshot.REQUESTED_LOTCODE, snapshot.requested_lotcode, ''),
      original_locationcode: firstNonEmptyRequestValue_(item && item.original_locationcode, item && item.ORIGINAL_LOCATIONCODE, snapshot.ORIGINAL_LOCATIONCODE, snapshot.original_locationcode, ''),
      requested_locationcode: firstNonEmptyRequestValue_(item && item.requested_locationcode, item && item.REQUESTED_LOCATIONCODE, snapshot.REQUESTED_LOCATIONCODE, snapshot.requested_locationcode, ''),
      original_source: firstNonEmptyRequestValue_(item && item.original_source, item && item.ORIGINAL_SOURCE, snapshot.ORIGINAL_SOURCE, snapshot.original_source, ''),
      requested_source: firstNonEmptyRequestValue_(item && item.requested_source, item && item.REQUESTED_SOURCE, snapshot.REQUESTED_SOURCE, snapshot.requested_source, ''),
      original_ptronhand: firstNonEmptyRequestValue_(item && item.original_ptronhand, item && item.ORIGINAL_PTRONHAND, snapshot.ORIGINAL_PTRONHAND, snapshot.original_ptronhand, ''),
      requested_ptronhand: firstNonEmptyRequestValue_(item && item.requested_ptronhand, item && item.REQUESTED_PTRONHAND, snapshot.REQUESTED_PTRONHAND, snapshot.requested_ptronhand, ''),
      original_ptrreviewed: firstNonEmptyRequestValue_(item && item.original_ptrreviewed, item && item.ORIGINAL_PTRREVIEWED, snapshot.ORIGINAL_PTRREVIEWED, snapshot.original_ptrreviewed, ''),
      requested_ptrreviewed: firstNonEmptyRequestValue_(item && item.requested_ptrreviewed, item && item.REQUESTED_PTRREVIEWED, snapshot.REQUESTED_PTRREVIEWED, snapshot.requested_ptrreviewed, ''),
      original_ptravailable: firstNonEmptyRequestValue_(item && item.original_ptravailable, item && item.ORIGINAL_PTRAVAILABLE, snapshot.ORIGINAL_PTRAVAILABLE, snapshot.original_ptravailable, ''),
      requested_ptravailable: firstNonEmptyRequestValue_(item && item.requested_ptravailable, item && item.REQUESTED_PTRAVAILABLE, snapshot.REQUESTED_PTRAVAILABLE, snapshot.requested_ptravailable, ''),
      original_evaldate: firstNonEmptyRequestValue_(item && item.original_evaldate, item && item.ORIGINAL_EVALDATE, snapshot.ORIGINAL_EVALDATE, snapshot.original_evaldate, ''),
      requested_evaldate: firstNonEmptyRequestValue_(item && item.requested_evaldate, item && item.REQUESTED_EVALDATE, snapshot.REQUESTED_EVALDATE, snapshot.requested_evaldate, ''),
      original_priby: firstNonEmptyRequestValue_(item && item.original_priby, item && item.ORIGINAL_PRIBY, item && item.original_prisetby, item && item.ORIGINAL_PRISETBY, snapshot.ORIGINAL_PRIBY, snapshot.ORIGINAL_PRISETBY, snapshot.original_priby, snapshot.original_prisetby, ''),
      requested_priby: firstNonEmptyRequestValue_(item && item.requested_priby, item && item.REQUESTED_PRIBY, item && item.requested_prisetby, item && item.REQUESTED_PRISETBY, snapshot.REQUESTED_PRIBY, snapshot.REQUESTED_PRISETBY, snapshot.requested_priby, snapshot.requested_prisetby, ''),
      original_priupdated: firstNonEmptyRequestValue_(item && item.original_priupdated, item && item.ORIGINAL_PRIUPDATED, snapshot.ORIGINAL_PRIUPDATED, snapshot.original_priupdated, ''),
      requested_priupdated: firstNonEmptyRequestValue_(item && item.requested_priupdated, item && item.REQUESTED_PRIUPDATED, snapshot.REQUESTED_PRIUPDATED, snapshot.requested_priupdated, ''),
      original_locationnotedate: firstNonEmptyRequestValue_(item && item.original_locationnotedate, item && item.ORIGINAL_LOCATIONNOTEDATE, snapshot.ORIGINAL_LOCATIONNOTEDATE, snapshot.original_locationnotedate, ''),
      requested_locationnotedate: firstNonEmptyRequestValue_(item && item.requested_locationnotedate, item && item.REQUESTED_LOCATIONNOTEDATE, snapshot.REQUESTED_LOCATIONNOTEDATE, snapshot.requested_locationnotedate, ''),
      original_locationnote: firstNonEmptyRequestValue_(item && item.original_locationnote, item && item.ORIGINAL_LOCATIONNOTE, snapshot.ORIGINAL_LOCATIONNOTE, snapshot.original_locationnote, ''),
      requested_locationnote: firstNonEmptyRequestValue_(item && item.requested_locationnote, item && item.REQUESTED_LOCATIONNOTE, snapshot.REQUESTED_LOCATIONNOTE, snapshot.requested_locationnote, ''),
      original_locationptn1: firstNonEmptyRequestValue_(item && item.original_locationptn1, item && item.ORIGINAL_LOCATIONPTN1, snapshot.ORIGINAL_LOCATIONPTN1, snapshot.original_locationptn1, ''),
      requested_locationptn1: firstNonEmptyRequestValue_(item && item.requested_locationptn1, item && item.REQUESTED_LOCATIONPTN1, snapshot.REQUESTED_LOCATIONPTN1, snapshot.requested_locationptn1, ''),
      original_salesnote: firstNonEmptyRequestValue_(item && item.original_salesnote, item && item.ORIGINAL_SALESNOTE, snapshot.ORIGINAL_SALESNOTE, snapshot.original_salesnote, ''),
      requested_salesnote: firstNonEmptyRequestValue_(item && item.requested_salesnote, item && item.REQUESTED_SALESNOTE, snapshot.REQUESTED_SALESNOTE, snapshot.requested_salesnote, ''),
      changed_fields_json: firstNonEmptyRequestValue_(item && item.changed_fields_json, item && item.CHANGED_FIELDS_JSON, snapshot.CHANGED_FIELDS_JSON, snapshot.changed_fields_json, ''),
      salesnote: firstNonEmptyRequestValue_(item && item.salesnote, item && item.SALESNOTE, item && item.sales_note, item && item.SALES_NOTE, snapshot.SALESNOTE, snapshot.salesnote, snapshot.SALES_NOTE, snapshot.sales_note, ''),
      holdstopcode: firstNonEmptyRequestValue_(item && item.holdstopcode, item && item.HOLDSTOPCODE, item && item.holstopcode, item && item.HOLSTOPCODE, snapshot.HOLDSTOPCODE, snapshot.holdstopcode, snapshot.HOLSTOPCODE, snapshot.holstopcode, ''),
      holdstopreason: firstNonEmptyRequestValue_(item && item.holdstopreason, item && item.HOLDSTOPREASON, item && item.holstopreason, item && item.HOLSTOPREASON, snapshot.HOLDSTOPREASON, snapshot.holdstopreason, snapshot.HOLSTOPREASON, snapshot.holstopreason, ''),
      assignedto: firstNonEmptyRequestValue_(item && item.assignedto, item && item.ASSIGNEDTO, snapshot.ASSIGNEDTO, snapshot.assignedto, ''),
      request_note: firstNonEmptyRequestValue_(item && item.request_note, item && item.REQUEST_NOTE, item && item.req_note, item && item.REQ_NOTE, snapshot.REQUEST_NOTE, snapshot.request_note, snapshot.REQ_NOTE, snapshot.req_note, ''),
      eval_task_type: firstNonEmptyRequestValue_(item && item.eval_task_type, item && item.EVAL_TASK_TYPE, snapshot.EVAL_TASK_TYPE, snapshot.eval_task_type, ''),
      eval_task_instructions: firstNonEmptyRequestValue_(item && item.eval_task_instructions, item && item.EVAL_TASK_INSTRUCTIONS, snapshot.EVAL_TASK_INSTRUCTIONS, snapshot.eval_task_instructions, ''),
      eval_task_assigned_by: firstNonEmptyRequestValue_(item && item.eval_task_assigned_by, item && item.EVAL_TASK_ASSIGNED_BY, snapshot.EVAL_TASK_ASSIGNED_BY, snapshot.eval_task_assigned_by, ''),
      eval_task_assigned_at: firstNonEmptyRequestValue_(item && item.eval_task_assigned_at, item && item.EVAL_TASK_ASSIGNED_AT, snapshot.EVAL_TASK_ASSIGNED_AT, snapshot.eval_task_assigned_at, ''),
      eval_task_completed_by: firstNonEmptyRequestValue_(item && item.eval_task_completed_by, item && item.EVAL_TASK_COMPLETED_BY, snapshot.EVAL_TASK_COMPLETED_BY, snapshot.eval_task_completed_by, ''),
      eval_task_completed_at: firstNonEmptyRequestValue_(item && item.eval_task_completed_at, item && item.EVAL_TASK_COMPLETED_AT, snapshot.EVAL_TASK_COMPLETED_AT, snapshot.eval_task_completed_at, ''),
      eval_task_result_note: firstNonEmptyRequestValue_(item && item.eval_task_result_note, item && item.EVAL_TASK_RESULT_NOTE, snapshot.EVAL_TASK_RESULT_NOTE, snapshot.eval_task_result_note, ''),
      av_note: firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, ''),
      desired_spec: firstNonEmptyRequestValue_(item && item.desired_spec, item && item.req_desired_spec, item && item.REQ_DESIRED_SPEC, item && item.DESIRED_SPEC, snapshot.REQ_DESIRED_SPEC, snapshot.req_desired_spec, snapshot.DESIRED_SPEC, snapshot.desired_spec, ''),
      desired_caliper: firstNonEmptyRequestValue_(item && item.desired_caliper, item && item.req_desired_caliper, item && item.REQ_DESIRED_CALIPER, item && item.DESIRED_CALIPER, snapshot.REQ_DESIRED_CALIPER, snapshot.req_desired_caliper, snapshot.DESIRED_CALIPER, snapshot.desired_caliper, ''),
      spec: firstNonEmptyRequestValue_(item && item.req_spec, item && item.REQ_SPEC, item && item.spec, item && item.SPEC, ''),
      caliper: firstNonEmptyRequestValue_(item && item.req_caliper, item && item.REQ_CALIPER, item && item.caliper, item && item.CALIPER, ''),
      match: firstNonEmptyRequestValue_(item && item.req_match, item && item.REQ_MATCH, item && item.match, item && item.MATCH, ''),
      loc_match_qty: getRequestLocPhotoMatchValue_(item),
      reserve: firstNonEmptyRequestValue_(item && item.req_reserve, item && item.REQ_RESERVE, snapshot.REQ_RESERVE, snapshot.req_reserve, ''),
      pick_note: firstNonEmptyRequestValue_(item && item.req_pic_note, item && item.REQ_PIC_NOTE, item && item.req_pick, item && item.REQ_PICK, snapshot.REQ_PICK, snapshot.req_pick, ''),
      comments: firstNonEmptyRequestValue_(item && item.comments, item && item.req_comments, item && item.request_comments, item && item.REQ_COMMENTS, item && item.REQUEST_COMMENTS, snapshot.REQ_COMMENTS, snapshot.req_comments, snapshot.comments, snapshot.request_comments, ''),
      completed_by_username: firstNonEmptyRequestValue_(item && item.completed_by_username, item && item.COMPLETED_BY_USERNAME, item && item.created_by_username, item && item.CREATED_BY_USERNAME, ''),
      completed_by_display: firstNonEmptyRequestValue_(item && item.completed_by_display, item && item.COMPLETED_BY_DISPLAY, item && item.completed_by, item && item.COMPLETED_BY, item && item.created_by_display, item && item.CREATED_BY_DISPLAY, ''),
      completed_by_email: firstNonEmptyRequestValue_(item && item.completed_by_email, item && item.COMPLETED_BY_EMAIL, ''),
      photo: extractRequestPhotoUrls_([
        item && item.req_photo_link,
        item && item.REQ_PHOTO_LINK,
        item && item.request_photo_link,
        item && item.REQUEST_PHOTO_LINK,
        item && item.REQUESTPHOTO_LINK,
        item && item.row_photo_link,
        item && item.ROW_PHOTO_LINK,
        item && item.saved_photo_link,
        item && item.SAVED_PHOTO_LINK,
        item && item.photo_link,
        item && item.PHOTO_LINK,
        item && item.photo,
        item && item.photo_urls,
        item && item.photos,
        snapshot.REQ_PHOTO_LINK,
        snapshot.req_photo_link,
        snapshot.REQUEST_PHOTO_LINK,
        snapshot.request_photo_link,
        snapshot.REQUESTPHOTO_LINK,
        snapshot.ROW_PHOTO_LINK,
        snapshot.row_photo_link,
        snapshot.SAVED_PHOTO_LINK,
        snapshot.saved_photo_link,
        snapshot.PHOTO_LINK,
        snapshot.photo_link,
        snapshot.photo,
        snapshot.photo_urls,
        snapshot.photos
      ]).join(',')
    };
    if (emailItem.comments) {
      emailItem.req_comments = emailItem.comments;
      emailItem.request_comments = emailItem.comments;
      emailItem.REQ_COMMENTS = emailItem.comments;
      emailItem.REQUEST_COMMENTS = emailItem.comments;
      emailItem.COMMENTS = emailItem.comments;
      emailItem.REQ_COMMENTS_USER_ENTERED = true;
      emailItem.req_comments_user_entered = true;
    }
    [
      ['original_priority', 'ORIGINAL_PRIORITY'],
      ['requested_priority', 'REQUESTED_PRIORITY'],
      ['original_holdstopcode', 'ORIGINAL_HOLDSTOPCODE'],
      ['requested_holdstopcode', 'REQUESTED_HOLDSTOPCODE'],
      ['original_holdstopreason', 'ORIGINAL_HOLDSTOPREASON'],
      ['requested_holdstopreason', 'REQUESTED_HOLDSTOPREASON'],
      ['original_lotcode', 'ORIGINAL_LOTCODE'],
      ['requested_lotcode', 'REQUESTED_LOTCODE'],
      ['original_locationcode', 'ORIGINAL_LOCATIONCODE'],
      ['requested_locationcode', 'REQUESTED_LOCATIONCODE'],
      ['original_source', 'ORIGINAL_SOURCE'],
      ['requested_source', 'REQUESTED_SOURCE'],
      ['original_ptronhand', 'ORIGINAL_PTRONHAND'],
      ['requested_ptronhand', 'REQUESTED_PTRONHAND'],
      ['original_ptrreviewed', 'ORIGINAL_PTRREVIEWED'],
      ['requested_ptrreviewed', 'REQUESTED_PTRREVIEWED'],
      ['original_ptravailable', 'ORIGINAL_PTRAVAILABLE'],
      ['requested_ptravailable', 'REQUESTED_PTRAVAILABLE'],
      ['original_evaldate', 'ORIGINAL_EVALDATE'],
      ['requested_evaldate', 'REQUESTED_EVALDATE'],
      ['original_priby', 'ORIGINAL_PRIBY'],
      ['requested_priby', 'REQUESTED_PRIBY'],
      ['original_priupdated', 'ORIGINAL_PRIUPDATED'],
      ['requested_priupdated', 'REQUESTED_PRIUPDATED'],
      ['original_locationnotedate', 'ORIGINAL_LOCATIONNOTEDATE'],
      ['requested_locationnotedate', 'REQUESTED_LOCATIONNOTEDATE'],
      ['original_locationnote', 'ORIGINAL_LOCATIONNOTE'],
      ['requested_locationnote', 'REQUESTED_LOCATIONNOTE'],
      ['original_locationptn1', 'ORIGINAL_LOCATIONPTN1'],
      ['requested_locationptn1', 'REQUESTED_LOCATIONPTN1'],
      ['original_salesnote', 'ORIGINAL_SALESNOTE'],
      ['requested_salesnote', 'REQUESTED_SALESNOTE'],
      ['changed_fields_json', 'CHANGED_FIELDS_JSON']
    ].forEach(function(pair) {
      if (emailItem[pair[0]]) emailItem[pair[1]] = emailItem[pair[0]];
    });
    emailItem.pick_note = getRequestPickNoteWithOverSeasonRule_(emailItem, emailItem.pick_note);
    return emailItem;
  }).filter(function(item) {
    return item.unique_id || item.commonname || item.itemcode;
  });
}

function getRequestEmailPayloadItemKey_(item, index) {
  if (!item || typeof item !== 'object') return 'blank:' + String(index || 0);
  const uniqueId = String(firstNonEmptyRequestValue_(
    item.unique_id,
    item.UNIQUE_ID,
    item.id,
    item.ID,
    ''
  ) || '').trim();
  if (uniqueId) return 'id:' + uniqueId;
  const rowKey = [
    firstNonEmptyRequestValue_(item.itemcode, item.ITEMCODE, item.itemCode, item.ITEM_CODE, ''),
    firstNonEmptyRequestValue_(item.locationcode, item.LOCATIONCODE, item.locationCode, item.LOCATION_CODE, item.loc, item.LOC, ''),
    firstNonEmptyRequestValue_(item.lotcode, item.LOTCODE, item.lotCode, item.LOT_CODE, ''),
    firstNonEmptyRequestValue_(item.contsize, item.CONTSIZE, item.contSize, item.CONT_SIZE, ''),
    firstNonEmptyRequestValue_(item.commonname, item.COMMONNAME, item.commonName, item.COMMON_NAME, '')
  ].map(function(value) {
    return String(value || '').trim().toUpperCase();
  }).filter(Boolean).join('|');
  return rowKey ? 'row:' + rowKey : 'idx:' + String(index || 0);
}

function getRequestEmailPayloadItems_(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const lists = [
    safePayload.requestItems,
    safePayload.items,
    safePayload.sourceRows,
    safePayload.requestRows,
    safePayload.requestSummaryItems,
    safePayload.summaryItems,
    safePayload.allItems
  ];
  const seen = {};
  const items = [];
  lists.forEach(function(list) {
    if (!Array.isArray(list)) return;
    list.filter(Boolean).forEach(function(item) {
      const key = getRequestEmailPayloadItemKey_(item, items.length);
      if (key && seen[key]) return;
      if (key) seen[key] = true;
      items.push(item);
    });
  });
  return items;
}

function hydrateRequestCompletePayload_(payload) {
  const safePayload = payload && typeof payload === 'object' ? JSON.parse(JSON.stringify(payload)) : {};
  if (String(safePayload.emailType || '').trim().toLowerCase() !== 'request_complete') return safePayload;
  const folderId = String(firstNonEmptyRequestValue_(safePayload.requestFolder, safePayload.folderId, '')).trim();
  const requestIds = normalizeRequestIdList_(safePayload.requestIds);
  const existingItems = getRequestEmailPayloadItems_(safePayload);
  const existingItemSnapshots = existingItems
    .map(cloneRequestCompleteEmailPayloadItemSnapshot_)
    .filter(Boolean);
  const folderRows = overlayRequestCompleteEmailPayloadSnapshots_(
    mergeRequestEmailRows_(
      mergeRequestEmailRows_(
        fetchRequestRowsForEmailFolder_(folderId),
        fetchRequestHistoryRowsForEmailFolder_(folderId)
      ),
      existingItemSnapshots
    ),
    existingItemSnapshots
  );
  let rows = folderRows.filter(function(row) {
    const rowId = String(firstNonEmptyRequestValue_(row && row.unique_id, row && row.UNIQUE_ID, '')).trim();
    if (!rowId) return false;
    return !requestIds.length || requestIds.indexOf(rowId) !== -1;
  });
  if (!rows.length && requestIds.length) {
    rows = overlayRequestCompleteEmailPayloadSnapshots_(
      mergeRequestEmailRows_(
        mergeRequestEmailRows_(
          fetchRequestRowsForEmailRequestIds_(requestIds),
          fetchRequestHistoryRowsForEmailRequestIds_(requestIds)
        ),
        existingItemSnapshots
      ),
      existingItemSnapshots
    );
    if (!rows.length && folderRows.length) rows = folderRows;
  }
  rows = overlayRequestCompleteEmailPayloadSnapshots_(rows, existingItemSnapshots);
  if (requestIds.length) {
    const orderMap = new Map(requestIds.map(function(id, index) { return [id, index]; }));
    rows.sort(function(a, b) {
      const aId = String(firstNonEmptyRequestValue_(a && a.unique_id, a && a.UNIQUE_ID, '')).trim();
      const bId = String(firstNonEmptyRequestValue_(b && b.unique_id, b && b.UNIQUE_ID, '')).trim();
      return (orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER) - (orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER);
    });
  }
  const hydratedItems = buildRequestEmailItemsFromRows_(rows, safePayload);
  if (hydratedItems.length) {
    delete safePayload.formattedItemsHtml;
    delete safePayload.formattedItemsText;
    safePayload.requestItems = hydratedItems;
    safePayload.itemsCount = hydratedItems.length;
    safePayload.requestIds = hydratedItems.map(function(item) {
      return String(firstNonEmptyRequestValue_(item && item.unique_id, '')).trim();
    }).filter(Boolean);
  }
  const completedByUsers = collectRequestCompletionUsers_(Object.assign({}, safePayload, {
    requestItems: hydratedItems.length ? hydratedItems.concat(existingItems) : existingItems
  }));
  const completedByEmails = completedByUsers.map(function(user) {
    return user && user.email;
  }).filter(Boolean);
  safePayload.completedByUsers = completedByUsers;
  safePayload.completed_by_users = completedByUsers;
  safePayload.completedByEmails = completedByEmails;
  safePayload.completed_by_emails = completedByEmails;
  return safePayload;
}

function hydrateQueuedRequestCompletePayload_(payload) {
  return hydrateRequestCompletePayload_(payload);
}

function buildRequestItemsHtml_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  if (items.length) return buildCompactRequestItemsHtml_(payload);
  const formatted = String(payload.formattedItemsHtml || '').trim();
  if (formatted) return formatted;
  if (!items.length) return '';
}

function getApprovalInquiryItemValue_(item, fields, fallback) {
  const safeFields = Array.isArray(fields) ? fields : [];
  for (let i = 0; i < safeFields.length; i++) {
    const value = item && item[safeFields[i]];
    if (String(value == null ? '' : value).trim() !== '') return value;
  }
  return fallback == null ? '' : fallback;
}

function buildApprovalInquiryEmailChip_(label, value, tone, options) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw === '-') return '';
  const safeOptions = options || {};
  const safeTone = String(tone || 'slate').trim();
  const color = safeTone === 'green' ? '#007a4d' : (safeTone === 'amber' ? '#b45309' : '#334155');
  const bg = safeTone === 'green' ? '#ecfdf5' : (safeTone === 'amber' ? '#fffbeb' : '#f8fafc');
  const border = safeTone === 'green' ? '#bbf7d0' : (safeTone === 'amber' ? '#fde68a' : '#dbe5df');
  const valueStyle = safeOptions.strike ? 'text-decoration:line-through;text-decoration-thickness:2px;' : '';
  const valueHtml = safeOptions.circleValue
    ? '<span style="display:inline-block;min-width:18px;height:18px;line-height:18px;text-align:center;border:2px solid ' + color + ';border-radius:999px;color:#111827;font-weight:900;' + valueStyle + '">' + escapeEmailHtml_(raw) + '</span>'
    : '<span style="color:#111827;' + valueStyle + '">' + escapeEmailHtml_(raw) + '</span>';
  return '<span style="display:inline-block;margin:0 5px 5px 0;padding:5px 7px;border:1px solid ' + border + ';border-radius:999px;background:' + bg + ';font-size:9px;line-height:1.15;font-weight:900;letter-spacing:.04em;color:' + color + ';text-transform:uppercase;white-space:nowrap;">' + escapeEmailHtml_(label) + ' ' + valueHtml + '</span>';
}

function buildApprovalInquiryItemsHtml_(payload) {
  return buildRequestEmailTableItemsHtml_(payload, { title: 'Selected Approval Rows' });
}

function buildApprovalInquiryItemsText_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  if (!items.length) return String(payload && payload.formattedItemsText || '').trim();
  return items.map(function(item, index) {
    const fields = [
      'Row: ' + String(index + 1),
      'Item Code: ' + firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, '-'),
      'Common Name: ' + firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Unknown Item'),
      'Cont Size: ' + firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, '-'),
      'Lot: ' + getApprovalInquiryItemValue_(item, ['lotcode', 'LOTCODE'], '-'),
      'Location: ' + getApprovalInquiryItemValue_(item, ['locationcode', 'LOCATIONCODE', 'loc', 'LOC'], '-'),
      'Source: ' + getApprovalInquiryItemValue_(item, ['source', 'SOURCE', 'sourcecode', 'SOURCECODE'], '-'),
      'Priority: ' + getApprovalInquiryItemValue_(item, ['priority', 'PRIORITY'], '-'),
      'On Hand: ' + getApprovalInquiryItemValue_(item, ['ptronhand', 'PTRONHAND'], '-'),
      'Review: ' + getApprovalInquiryItemValue_(item, ['ptrreviewed', 'PTRREVIEWED'], '-'),
      'Available: ' + getApprovalInquiryItemValue_(item, ['ptravailable', 'PTRAVAILABLE'], '-')
    ];
    return fields.join('\n');
  }).join('\n\n');
}

function buildApprovalRequestItemsHtml_(payload) {
  return buildApprovalInquiryItemsHtml_(payload);
}

function buildApprovalRequestItemsText_(payload) {
  return buildApprovalInquiryItemsText_(payload);
}

function getRequestItemPhotoUrls_(item) {
  const snapshot = parseRequestRowSnapshot_(item || {});
  return extractRequestPhotoUrls_([
    item && item.photo,
    item && item.photo_urls,
    item && item.photos,
    item && item.req_photo_link,
    item && item.REQ_PHOTO_LINK,
    item && item.request_photo_link,
    item && item.REQUEST_PHOTO_LINK,
    item && item.REQUESTPHOTO_LINK,
    item && item.dock_photo_link,
    item && item.DOCK_PHOTO_LINK,
    item && item.DOCKPHOTO_LINK,
    item && item.photo_link,
    item && item.PHOTO_LINK,
    item && item.row_photo_link,
    item && item.ROW_PHOTO_LINK,
    item && item.saved_photo_link,
    item && item.SAVED_PHOTO_LINK,
    snapshot.REQ_PHOTO_LINK,
    snapshot.req_photo_link,
    snapshot.REQUEST_PHOTO_LINK,
    snapshot.request_photo_link,
    snapshot.REQUESTPHOTO_LINK,
    snapshot.DOCK_PHOTO_LINK,
    snapshot.dock_photo_link,
    snapshot.DOCKPHOTO_LINK,
    snapshot.ROW_PHOTO_LINK,
    snapshot.row_photo_link,
    snapshot.SAVED_PHOTO_LINK,
    snapshot.saved_photo_link,
    snapshot.PHOTO_LINK,
    snapshot.photo_link,
    snapshot.photo,
    snapshot.photo_urls,
    snapshot.photos
  ]);
}

function getRequestGallerySecret_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const configured = String(props.getProperty(REQUEST_GALLERY_SECRET_PROPERTY) || '').trim();
    if (configured) return configured;
  } catch (error) {}
  return SUPABASE_KEY || SUPABASE_URL || 'gnc-request-gallery';
}

function base64EncodeWebSafeNoPadding_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function buildRequestGalleryToken_(folderId) {
  const safeFolderId = String(folderId || '').trim();
  if (!safeFolderId) return '';
  const signature = Utilities.computeHmacSha256Signature(
    safeFolderId,
    getRequestGallerySecret_(),
    Utilities.Charset.UTF_8
  );
  return base64EncodeWebSafeNoPadding_(signature);
}

function buildRequestGalleryFallbackFolderId_(payload, items) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const photoUrls = [];
  const rowKeys = [];
  safeItems.forEach(function(item) {
    const rowKey = firstNonEmptyRequestValue_(
      item && item.unique_id,
      item && item.UNIQUE_ID,
      item && item.id,
      item && item.ID,
      item && item.itemcode,
      item && item.ITEMCODE,
      item && item.commonname,
      item && item.COMMONNAME,
      ''
    );
    if (rowKey) rowKeys.push(String(rowKey));
    getRequestItemPhotoUrls_(item).forEach(function(url) {
      if (photoUrls.indexOf(url) === -1) photoUrls.push(url);
    });
  });
  if (!safeItems.length && !photoUrls.length) return '';
  const digestInput = JSON.stringify({
    emailType: firstNonEmptyRequestValue_(safePayload.emailType, safePayload.type, ''),
    subject: firstNonEmptyRequestValue_(safePayload.subject, ''),
    customer: firstNonEmptyRequestValue_(safePayload.customer, safePayload.audienceLabel, ''),
    rows: rowKeys.slice(0, 80),
    photos: photoUrls.slice(0, 120)
  });
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digestInput, Utilities.Charset.UTF_8);
    return 'email-gallery-' + base64EncodeWebSafeNoPadding_(digest).slice(0, 36);
  } catch (error) {
    return 'email-gallery-' + base64EncodeWebSafeNoPadding_(Utilities.newBlob(digestInput).getBytes()).slice(0, 36);
  }
}

function verifyRequestGalleryToken_(folderId, token) {
  const expected = buildRequestGalleryToken_(folderId);
  return !!expected && expected === String(token || '').trim();
}

function getRequestGalleryBaseUrl_() {
  try {
    const serviceUrl = String(ScriptApp.getService().getUrl() || '').trim();
    if (serviceUrl) return serviceUrl;
  } catch (error) {}
  try {
    const configured = String(PropertiesService.getScriptProperties().getProperty(REQUEST_GALLERY_BASE_URL_PROPERTY) || '').trim();
    if (configured) return configured;
  } catch (error) {}
  return '';
}

function encodeRequestGalleryInlineItems_(items) {
  const compactItems = (Array.isArray(items) ? items : []).filter(Boolean).map(compactRequestGalleryItem_);
  if (!compactItems.length || !buildRequestGallerySlidesFromItems_(compactItems).length) return '';
  try {
    const raw = JSON.stringify({
      items: compactItems,
      encodedAt: new Date().toISOString()
    });
    const encoded = Utilities.base64EncodeWebSafe(Utilities.newBlob(raw).getBytes());
    return encoded.length <= 8000 ? encoded : '';
  } catch (error) {
    console.error('[REQUEST GALLERY] Could not encode inline gallery payload', {
      message: error && error.message ? error.message : String(error)
    });
    return '';
  }
}

function decodeRequestGalleryInlineItems_(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return [];
  try {
    const bytes = Utilities.base64DecodeWebSafe(rawValue);
    const raw = Utilities.newBlob(bytes).getDataAsString();
    const parsed = JSON.parse(raw || '{}');
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.items) ? parsed.items : []);
    return items.filter(Boolean).map(compactRequestGalleryItem_);
  } catch (error) {
    console.error('[REQUEST GALLERY] Could not decode inline gallery payload', {
      message: error && error.message ? error.message : String(error)
    });
  }
  return [];
}

function buildRequestGalleryUrl_(folderId, requestIds, inlineItems) {
  const safeFolderId = String(folderId || '').trim();
  const baseUrl = getRequestGalleryBaseUrl_();
  if (!safeFolderId || !baseUrl) return '';
  const safeIds = normalizeRequestGalleryIdList_(requestIds || []);
  const separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
  let url = baseUrl + separator +
    'gallery=request&folder=' + encodeURIComponent(safeFolderId) +
    '&token=' + encodeURIComponent(buildRequestGalleryToken_(safeFolderId));
  if (safeIds.length) url += '&ids=' + encodeURIComponent(safeIds.join(','));
  const inlineData = encodeRequestGalleryInlineItems_(inlineItems || []);
  if (inlineData) url += '&data=' + encodeURIComponent(inlineData);
  return url;
}

function buildRequestRowCopyUrl_(folderId, item, rowIndex) {
  const safeFolderId = String(firstNonEmptyRequestValue_(
    folderId,
    item && item.folder,
    item && item.request_folder,
    item && item.REQUEST_FOLDER,
    ''
  )).trim();
  const baseUrl = getRequestGalleryBaseUrl_();
  if (!safeFolderId || !baseUrl) return '';
  const rowId = String(firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, item && item.id, item && item.ID, '')).trim();
  const separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
  let url = baseUrl + separator +
    'gallery=request-row&folder=' + encodeURIComponent(safeFolderId) +
    '&token=' + encodeURIComponent(buildRequestGalleryToken_(safeFolderId));
  if (rowId) url += '&row=' + encodeURIComponent(rowId);
  if (rowIndex != null && rowIndex !== '') url += '&index=' + encodeURIComponent(String(rowIndex));
  return url;
}

function buildRequestRowCopyButtonHtml_(folderId, item, rowIndex) {
  const copyUrl = buildRequestRowCopyUrl_(folderId, item, rowIndex);
  if (!copyUrl) return '';
  return [
    '<div style="margin-top:12px;">',
    '<a href="' + escapeEmailAttribute_(copyUrl) + '" style="display:inline-block;padding:9px 13px;border-radius:999px;background:#007a4d;color:#ffffff;font-weight:700;text-decoration:none;">Copy Row</a>',
    '</div>'
  ].join('');
}

function buildRequestRowGalleryUrl_(folderId, item) {
  const safeFolderId = String(firstNonEmptyRequestValue_(
    folderId,
    item && item.folder,
    item && item.request_folder,
    item && item.REQUEST_FOLDER,
    ''
  )).trim();
  if (!safeFolderId) return '';
  const rowId = String(firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, item && item.id, item && item.ID, '')).trim();
  return buildRequestGalleryUrl_(safeFolderId, rowId ? [rowId] : [], item ? [item] : []);
}

function buildRequestRowPhotoPreviewHtml_(folderId, item) {
  const photoUrls = getRequestItemPhotoUrls_(item);
  const pickNote = String(getRequestPickNoteWithOverSeasonRule_(item, firstNonEmptyRequestValue_(
    item && item.pick_note,
    item && item.pick,
    item && item.req_pick,
    item && item.req_pic_note,
    item && item.REQ_PICK,
    item && item.REQ_PIC_NOTE,
    item && item.PICK,
    ''
  )) || '').trim();
  const pickNoteHtml = pickNote
    ? '<div style="margin:10px 0 0 0;padding:9px 10px;border-radius:8px;background:#ecfdf5;border:1px solid #bbf7d0;color:#065f46;font-size:12px;line-height:1.35;"><strong>Pick Note:</strong> ' + escapeEmailHtml_(pickNote) + '</div>'
    : '';
  if (!photoUrls.length) {
    return [
      '<p style="margin:10px 0 0 0;color:#64748b;font-size:12px;font-weight:700;">No photos were captured for this row.</p>',
      pickNoteHtml
    ].join('');
  }
  const galleryUrl = buildRequestRowGalleryUrl_(folderId, item);
  const photoCountText = photoUrls.length === 1 ? '1 photo' : photoUrls.length + ' photos';
  const photoPreviewStripHtml = buildRequestEmailPhotoPreviewStripHtml_(photoUrls, {
    titlePrefix: 'Photo',
    tileSize: 116,
    thumbWidth: 360,
    maxPhotos: 12
  });
  const galleryButtonHtml = galleryUrl ? [
    '<div style="text-align:center;">',
    '<a href="' + escapeEmailAttribute_(galleryUrl) + '" style="display:inline-block;padding:10px 14px;border-radius:999px;background:#007a4d;color:#ffffff;font-weight:700;text-decoration:none;">View Row Photo Gallery</a>',
    '</div>'
  ].join('') : '';
  return [
    '<div style="margin:12px 0;padding:10px;border:1px solid #b7f2d1;border-radius:12px;background:#f0fdf4;">',
    '<p style="margin:0 0 10px 0;color:#065f46;font-size:13px;line-height:1.45;font-weight:700;">' + escapeEmailHtml_(photoCountText) + ' captured for this row.</p>',
    photoPreviewStripHtml,
    pickNoteHtml,
    galleryButtonHtml,
    '</div>'
  ].join('');
}

function getRequestGalleryCacheKey_(folderId) {
  const safeFolderId = String(folderId || '').trim();
  if (!safeFolderId) return '';
  return String(buildRequestGalleryToken_(safeFolderId) || '').slice(0, 40);
}

function compactRequestGalleryItem_(item) {
  const photoUrls = getRequestItemPhotoUrls_(item);
  const compactItem = {
    unique_id: firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, ''),
    folder: firstNonEmptyRequestValue_(item && item.folder, item && item.request_folder, item && item.REQUEST_FOLDER, ''),
    customer: firstNonEmptyRequestValue_(item && item.customer, item && item.req_customer, item && item.REQ_CUSTOMER, ''),
    commonname: firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, ''),
    contsize: firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, ''),
    itemcode: firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, ''),
    lotcode: firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, ''),
    season: firstNonEmptyRequestValue_(item && item.season, item && item.SEASON, ''),
    priority: firstNonEmptyRequestValue_(item && item.priority, item && item.PRIORITY, ''),
    ptravailable: firstNonEmptyRequestValue_(item && item.ptravailable, item && item.PTRAVAILABLE, ''),
    s_lts: firstNonEmptyRequestValue_(item && item.s_lts, item && item.S_LTS, ''),
    qty: firstNonEmptyRequestValue_(item && item.qty, item && item.req_qty, item && item.REQ_QTY, ''),
    loc: firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, ''),
    assignedto: firstNonEmptyRequestValue_(item && item.assignedto, item && item.ASSIGNEDTO, ''),
    request_note: firstNonEmptyRequestValue_(item && item.request_note, item && item.REQUEST_NOTE, item && item.req_note, item && item.REQ_NOTE, ''),
    eval_task_type: firstNonEmptyRequestValue_(item && item.eval_task_type, item && item.EVAL_TASK_TYPE, ''),
    eval_task_instructions: firstNonEmptyRequestValue_(item && item.eval_task_instructions, item && item.EVAL_TASK_INSTRUCTIONS, ''),
    eval_task_assigned_by: firstNonEmptyRequestValue_(item && item.eval_task_assigned_by, item && item.EVAL_TASK_ASSIGNED_BY, ''),
    eval_task_assigned_at: firstNonEmptyRequestValue_(item && item.eval_task_assigned_at, item && item.EVAL_TASK_ASSIGNED_AT, ''),
    eval_task_completed_by: firstNonEmptyRequestValue_(item && item.eval_task_completed_by, item && item.EVAL_TASK_COMPLETED_BY, ''),
    eval_task_completed_at: firstNonEmptyRequestValue_(item && item.eval_task_completed_at, item && item.EVAL_TASK_COMPLETED_AT, ''),
    eval_task_result_note: firstNonEmptyRequestValue_(item && item.eval_task_result_note, item && item.EVAL_TASK_RESULT_NOTE, ''),
    av_note: firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, ''),
    spec: firstNonEmptyRequestValue_(item && item.spec, item && item.req_spec, item && item.REQ_SPEC, ''),
    caliper: firstNonEmptyRequestValue_(item && item.caliper, item && item.req_caliper, item && item.REQ_CALIPER, ''),
    match: firstNonEmptyRequestValue_(item && item.match, item && item.req_match, item && item.REQ_MATCH, ''),
    loc_match_qty: getRequestLocPhotoMatchValue_(item),
    reserve: firstNonEmptyRequestValue_(item && item.reserve, item && item.req_reserve, item && item.REQ_RESERVE, ''),
    pick_note: firstNonEmptyRequestValue_(item && item.pick_note, item && item.req_pic_note, item && item.REQ_PIC_NOTE, ''),
    comments: firstNonEmptyRequestValue_(item && item.comments, item && item.req_comments, item && item.REQ_COMMENTS, ''),
    completed_by_username: firstNonEmptyRequestValue_(item && item.completed_by_username, item && item.COMPLETED_BY_USERNAME, ''),
    completed_by_display: firstNonEmptyRequestValue_(item && item.completed_by_display, item && item.COMPLETED_BY_DISPLAY, ''),
    completed_by_email: firstNonEmptyRequestValue_(item && item.completed_by_email, item && item.COMPLETED_BY_EMAIL, ''),
    photo: photoUrls
  };
  compactItem.pick_note = getRequestPickNoteWithOverSeasonRule_(compactItem, compactItem.pick_note);
  return compactItem;
}

function deleteRequestGalleryCache_(cacheKey) {
  const key = String(cacheKey || '').trim();
  if (!key) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const metaKey = REQUEST_GALLERY_CACHE_META_PREFIX + key;
    let chunkCount = 0;
    try {
      const meta = JSON.parse(String(props.getProperty(metaKey) || '{}'));
      chunkCount = Math.max(0, Number(meta && meta.chunkCount) || 0);
    } catch (error) {}
    for (let index = 0; index < chunkCount; index++) {
      props.deleteProperty(REQUEST_GALLERY_CACHE_CHUNK_PREFIX + key + '_' + index);
    }
    props.deleteProperty(metaKey);
  } catch (error) {}
}

function cleanupRequestGalleryPropertyCache_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const allProperties = props.getProperties() || {};
    let removed = 0;
    Object.keys(allProperties).forEach(function(key) {
      if (String(key || '').indexOf(REQUEST_GALLERY_CACHE_META_PREFIX) === 0 ||
          String(key || '').indexOf(REQUEST_GALLERY_CACHE_CHUNK_PREFIX) === 0) {
        props.deleteProperty(key);
        removed++;
      }
    });
    if (removed) console.log('[REQUEST GALLERY] Cleared ' + removed + ' Script Property cache entries.');
    return { ok: true, removed: removed };
  } catch (error) {
    console.error('[REQUEST GALLERY] Could not clear property cache', error);
    return {
      ok: false,
      removed: 0,
      message: error && error.message ? error.message : String(error)
    };
  }
}

function clearRequestGalleryPropertyCache() {
  return cleanupRequestGalleryPropertyCache_();
}

function cacheRequestGalleryPayload_(folderId, items) {
  if (!REQUEST_GALLERY_PROPERTY_CACHE_ENABLED) return;
  const safeFolderId = String(folderId || '').trim();
  const safeItems = (Array.isArray(items) ? items : []).filter(Boolean).map(compactRequestGalleryItem_);
  if (!safeFolderId || !safeItems.length || !buildRequestGallerySlidesFromItems_(safeItems).length) return;
  const cacheKey = getRequestGalleryCacheKey_(safeFolderId);
  if (!cacheKey) return;
  try {
    const payload = JSON.stringify({
      folderId: safeFolderId,
      cachedAt: new Date().toISOString(),
      items: safeItems
    });
    const props = PropertiesService.getScriptProperties();
    deleteRequestGalleryCache_(cacheKey);
    const chunks = [];
    for (let index = 0; index < payload.length; index += REQUEST_GALLERY_CACHE_CHUNK_SIZE) {
      chunks.push(payload.slice(index, index + REQUEST_GALLERY_CACHE_CHUNK_SIZE));
    }
    chunks.forEach(function(chunk, index) {
      props.setProperty(REQUEST_GALLERY_CACHE_CHUNK_PREFIX + cacheKey + '_' + index, chunk);
    });
    props.setProperty(REQUEST_GALLERY_CACHE_META_PREFIX + cacheKey, JSON.stringify({
      folderId: safeFolderId,
      chunkCount: chunks.length,
      cachedAt: new Date().toISOString()
    }));
  } catch (error) {
    console.error('[REQUEST GALLERY] Could not cache gallery payload', {
      folderId: safeFolderId,
      message: error && error.message ? error.message : String(error)
    });
  }
}

function readRequestGalleryCachedItems_(folderId) {
  const safeFolderId = String(folderId || '').trim();
  const cacheKey = getRequestGalleryCacheKey_(safeFolderId);
  if (!safeFolderId || !cacheKey) return [];
  try {
    const props = PropertiesService.getScriptProperties();
    const meta = JSON.parse(String(props.getProperty(REQUEST_GALLERY_CACHE_META_PREFIX + cacheKey) || '{}'));
    const chunkCount = Math.max(0, Number(meta && meta.chunkCount) || 0);
    if (!chunkCount || String(meta && meta.folderId || '') !== safeFolderId) return [];
    let raw = '';
    for (let index = 0; index < chunkCount; index++) {
      raw += String(props.getProperty(REQUEST_GALLERY_CACHE_CHUNK_PREFIX + cacheKey + '_' + index) || '');
    }
    const parsed = JSON.parse(raw || '{}');
    return Array.isArray(parsed && parsed.items) ? parsed.items.filter(Boolean) : [];
  } catch (error) {
    console.error('[REQUEST GALLERY] Could not read cached gallery payload', {
      folderId: safeFolderId,
      message: error && error.message ? error.message : String(error)
    });
  }
  return [];
}

function resolveRequestGalleryFolderId_(payload, items) {
  const firstItem = Array.isArray(items) && items.length ? items[0] || {} : {};
  const explicitFolderId = firstNonEmptyRequestValue_(
    payload && payload.folderId,
    payload && payload.requestFolder,
    payload && payload.request_folder,
    firstItem.folder,
    firstItem.request_folder,
    firstItem.REQUEST_FOLDER,
    ''
  );
  if (String(explicitFolderId || '').trim()) return explicitFolderId;
  return buildRequestGalleryFallbackFolderId_(payload, items);
}

function resolveRequestGalleryRequestIds_(payload, items) {
  const ids = normalizeRequestGalleryIdList_([
    payload && payload.requestIds,
    payload && payload.request_ids,
    payload && payload.uniqueIds,
    payload && payload.unique_ids
  ]);
  const seen = {};
  ids.forEach(function(id) { seen[id] = true; });
  (Array.isArray(items) ? items : []).forEach(function(item) {
    const id = firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, item && item.id, item && item.ID, '');
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  });
  return ids;
}

function normalizeEmailApprovalType_(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'move' || normalized === 'moveup' || normalized === 'move-up') return 'move-up';
  if (normalized === 'movedown' || normalized === 'move-down') return 'move-down';
  if (normalized === 'hold' || normalized === 'holdrelease' || normalized === 'hold-release' || normalized === 'take-off-hold' || normalized === 'takeoffhold' || normalized === 'off-hold') return 'hold-release';
  if (normalized === 'recount' || normalized === 're-count') return 'recount';
  return 'new-crop';
}

function getEmailApprovalTypeLabel_(type) {
  const normalized = normalizeEmailApprovalType_(type);
  if (normalized === 'move-up') return 'Move Up';
  if (normalized === 'move-down') return 'Move Down';
  if (normalized === 'hold-release') return 'Take Off Hold';
  if (normalized === 'recount') return 'Re-Count';
  return 'NCR';
}

function getEmailApprovalBrandLabel_(type) {
  const normalized = normalizeEmailApprovalType_(type);
  if (normalized === 'move-up') return 'GNC PH MOVE UP';
  if (normalized === 'move-down') return 'GNC PH MOVE DOWN';
  if (normalized === 'hold-release') return 'GNC PH HOLD REMOVAL';
  if (normalized === 'recount') return 'GNC PH RE-COUNT';
  return 'GNC PH NCR';
}

function normalizeEmailApprovalStage_(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'jd' || normalized === 'j-d') return 'jd';
  if (normalized === 'dylan' || normalized === 'first' || normalized === 'manager') return 'dylan';
  if (normalized === 'inventory' || normalized === 'inventory-office') return 'inventory';
  return '';
}

function getEmailApprovalAssignment_(type, stage) {
  const key = normalizeEmailApprovalType_(type) + ':' + normalizeEmailApprovalStage_(stage);
  return EMAIL_APPROVAL_ASSIGNMENTS_[key] || '';
}

function getEmailApprovalStageFromAssignment_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.indexOf('_denied') !== -1 || normalized.indexOf('-denied') !== -1) return 'denied';
  if (normalized.indexOf('_complete') !== -1) return 'complete';
  if (normalized.indexOf('inventory') !== -1 || normalized.indexOf('outbox') !== -1) return 'inventory';
  if (normalized.indexOf('_jd') !== -1 || normalized.indexOf('-jd') !== -1) return 'jd';
  if (normalized.indexOf('_dylan') !== -1 || normalized.indexOf('-dylan') !== -1) return 'dylan';
  return '';
}

function getEmailApprovalTypeFromAssignment_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.indexOf('hold_release') !== -1 || normalized.indexOf('hold-release') !== -1) return 'hold-release';
  if (normalized.indexOf('move_down') !== -1 || normalized.indexOf('move-down') !== -1) return 'move-down';
  if (normalized.indexOf('move_up') !== -1 || normalized.indexOf('move-up') !== -1) return 'move-up';
  if (normalized.indexOf('recount') !== -1 || normalized.indexOf('re-count') !== -1) return 'recount';
  if (normalized.indexOf('new_crop') !== -1 || normalized.indexOf('new-crop') !== -1 || normalized.indexOf('ncr_') !== -1) return 'new-crop';
  return '';
}

function getEmailApprovalUniqueIdFromPayload_(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const items = getRequestEmailPayloadItems_(safePayload);
  const firstItem = items.length ? items[0] || {} : {};
  const explicit = firstNonEmptyRequestValue_(
    safePayload.approvalUniqueId,
    safePayload.approval_unique_id,
    safePayload.sourceUniqueId,
    safePayload.source_unique_id,
    safePayload.masterUniqueId,
    safePayload.master_unique_id,
    firstItem.unique_id,
    firstItem.UNIQUE_ID,
    firstItem.source_unique_id,
    firstItem.SOURCE_UNIQUE_ID,
    ''
  );
  const explicitText = String(explicit || '').trim();
  if (explicitText) return explicitText;
  const folderId = String(firstNonEmptyRequestValue_(safePayload.folderId, safePayload.requestFolder, '') || '').trim();
  const match = folderId.match(/^ncr-approval-(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

function buildEmailApprovalSignature_(uid, type, stage, expiresAt) {
  const raw = [String(uid || '').trim(), normalizeEmailApprovalType_(type), normalizeEmailApprovalStage_(stage), String(expiresAt || '').trim()].join('|');
  const signature = Utilities.computeHmacSha256Signature(
    raw,
    getRequestGallerySecret_() + ':email-approval',
    Utilities.Charset.UTF_8
  );
  return base64EncodeWebSafeNoPadding_(signature);
}

function buildEmailApprovalUrl_(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const uid = getEmailApprovalUniqueIdFromPayload_(safePayload);
  const type = normalizeEmailApprovalType_(firstNonEmptyRequestValue_(
    safePayload.approvalType,
    safePayload.approval_type,
    safePayload.customer,
    ''
  ));
  const stage = normalizeEmailApprovalStage_(firstNonEmptyRequestValue_(
    safePayload.approvalStage,
    safePayload.approval_stage,
    ''
  ));
  const baseUrl = getRequestGalleryBaseUrl_();
  if (!uid || !baseUrl || (stage !== 'dylan' && stage !== 'jd')) return '';
  const expiresAt = Date.now() + EMAIL_APPROVAL_TOKEN_TTL_MS;
  const separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
  return baseUrl + separator +
    'view=approval' +
    '&uid=' + encodeURIComponent(uid) +
    '&type=' + encodeURIComponent(type) +
    '&stage=' + encodeURIComponent(stage) +
    '&exp=' + encodeURIComponent(String(expiresAt)) +
    '&sig=' + encodeURIComponent(buildEmailApprovalSignature_(uid, type, stage, expiresAt));
}

function validateEmailApprovalParams_(params) {
  const safeParams = params || {};
  const uid = String(safeParams.uid || safeParams.row || safeParams.id || '').trim();
  const type = normalizeEmailApprovalType_(safeParams.type || safeParams.approvalType || '');
  const stage = normalizeEmailApprovalStage_(safeParams.stage || safeParams.approvalStage || '');
  const expiresAt = Number(safeParams.exp || 0);
  const sig = String(safeParams.sig || '').trim();
  if (!uid || !type || (stage !== 'dylan' && stage !== 'jd') || !expiresAt || !sig) {
    return { ok: false, message: 'This approval link is missing required information.' };
  }
  if (Date.now() > expiresAt) {
    return { ok: false, message: 'This approval link has expired. Open the app to review the row.' };
  }
  const expected = buildEmailApprovalSignature_(uid, type, stage, expiresAt);
  if (expected !== sig) {
    return { ok: false, message: 'This approval link is not valid.' };
  }
  return { ok: true, uid: uid, type: type, stage: stage, expiresAt: expiresAt, sig: sig };
}

function buildApprovalEmailButtonBlock_(payload) {
  const url = buildEmailApprovalUrl_(payload);
  if (!url) return '';
  const stage = normalizeEmailApprovalStage_(payload && (payload.approvalStage || payload.approval_stage));
  const typeLabel = getEmailApprovalTypeLabel_(payload && (payload.approvalType || payload.approval_type || payload.customer));
  const label = stage === 'jd' ? 'Open JD Approval' : 'Approve and Send to JD';
  return [
    '<div style="margin:16px 0;padding:14px;border-radius:12px;background:#ecfdf5;border:1px solid #a7f3d0;">',
    '<p style="margin:0 0 10px 0;color:#065f46;font-size:13px;line-height:1.4;font-weight:700;">This opens a confirmation page for the ' + escapeEmailHtml_(typeLabel) + ' row. Nothing changes until the confirmation button is clicked.</p>',
    '<a href="' + escapeEmailAttribute_(url) + '" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#007a4d;color:#ffffff;font-size:14px;line-height:1.2;font-weight:900;text-decoration:none;text-transform:uppercase;letter-spacing:.06em;">' + escapeEmailHtml_(label) + '</a>',
    '</div>'
  ].join('');
}

function buildApprovalEmailButtonText_(payload) {
  const url = buildEmailApprovalUrl_(payload);
  if (!url) return '';
  const stage = normalizeEmailApprovalStage_(payload && (payload.approvalStage || payload.approval_stage));
  return (stage === 'jd' ? 'JD Approval Link: ' : 'Dylan Approval Link: ') + url;
}

function buildApprovalEmailPhotoSectionHtml_(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const stage = normalizeEmailApprovalStage_(safePayload.approvalStage || safePayload.approval_stage);
  if (stage !== 'dylan' && stage !== 'jd') return '';
  const items = getRequestEmailPayloadItems_(safePayload);
  if (!items.length) return '';
  const itemsWithPhotoData = items.filter(function(item) {
    return getRequestItemPhotoUrls_(item).length > 0;
  });
  if (!itemsWithPhotoData.length) return '';
  const folderId = resolveRequestGalleryFolderId_(safePayload, items);
  cacheRequestGalleryPayload_(folderId, items);
  const rows = itemsWithPhotoData.map(function(item) {
    return buildRequestRowPhotoPreviewHtml_(folderId, item);
  }).filter(Boolean);
  if (!rows.length) return '';
  return [
    '<div style="margin:16px 0 0 0;">',
    '<p style="margin:0 0 8px 0;color:#065f46;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;">Photos</p>',
    rows.join(''),
    '</div>'
  ].join('');
}

function buildApprovalEmailPhotoSectionText_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  const lines = [];
  items.forEach(function(item, index) {
    const urls = getRequestItemPhotoUrls_(item);
    if (!urls.length) return;
    lines.push('Row ' + String(index + 1) + ' photos:');
    urls.forEach(function(url) { lines.push(url); });
  });
  return lines.join('\n');
}

function fetchEmailApprovalMasterRow_(uid) {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return null;
  const tables = [];
  const runtimeTable = getRuntimeSiteSplitTableName_('ph_master_inventory', 'PH');
  if (runtimeTable) tables.push(runtimeTable);
  if (tables.indexOf('ph_master_inventory') === -1) tables.push('ph_master_inventory');
  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName) + '?select=*&unique_id=eq.' + encodeURIComponent(safeUid) + '&limit=1';
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: getSupabaseHeaders_(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) continue;
    const rows = JSON.parse(res.getContentText() || '[]');
    if (Array.isArray(rows) && rows.length) {
      rows[0].__approval_table_name = tableName;
      return rows[0];
    }
  }
  return null;
}

function patchEmailApprovalMasterRow_(uid, patch, tableName) {
  const safeUid = String(uid || '').trim();
  const safeTable = String(tableName || getRuntimeSiteSplitTableName_('ph_master_inventory', 'PH') || 'ph_master_inventory').trim();
  if (!safeUid || !safeTable) throw new Error('Missing row id for approval update.');
  const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(safeTable) + '?unique_id=eq.' + encodeURIComponent(safeUid);
  const res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(patch || {}),
    headers: getSupabaseHeaders_({
      Prefer: 'return=representation'
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Approval update failed (' + code + '): ' + res.getContentText());
  }
  const rows = JSON.parse(res.getContentText() || '[]');
  const row = Array.isArray(rows) && rows.length ? rows[0] : Object.assign({}, patch, { unique_id: safeUid });
  row.__approval_table_name = safeTable;
  return row;
}

function normalizeInventoryTransactionAction_(action) {
  const safe = String(action || '').trim().toLowerCase();
  if (safe === 'transfer') return 'transfer';
  if (safe === 'reclass') return 'reclass';
  return 'qty';
}

function normalizeInventoryTransactionText_(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeInventoryTransactionCompareText_(value) {
  return normalizeInventoryTransactionText_(value).toUpperCase();
}

function parseInventoryTransactionNumber_(value, label, options) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const text = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!text) throw new Error((label || 'Quantity') + ' is required.');
  const parsed = Number(text);
  if (!isFinite(parsed)) throw new Error((label || 'Quantity') + ' must be a number.');
  if (safeOptions.disallowNegative && parsed < 0) throw new Error((label || 'Quantity') + ' cannot be negative.');
  if (safeOptions.requirePositive && parsed <= 0) throw new Error((label || 'Quantity') + ' must be greater than 0.');
  return parsed;
}

function getInventoryTransactionRowValue_(row, fields, fallback) {
  const safeFields = Array.isArray(fields) ? fields : [];
  for (let i = 0; i < safeFields.length; i++) {
    const field = safeFields[i];
    const candidates = [
      field,
      String(field || '').toLowerCase(),
      String(field || '').toUpperCase()
    ];
    for (let j = 0; j < candidates.length; j++) {
      const key = candidates[j];
      if (!row || !Object.prototype.hasOwnProperty.call(row, key)) continue;
      const value = row[key];
      if (String(value == null ? '' : value).trim() !== '') return value;
    }
  }
  return fallback == null ? '' : fallback;
}

function getInventoryTransactionRowNumber_(row, fields) {
  const value = getInventoryTransactionRowValue_(row, fields, 0);
  const text = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!text || text === '-' || /^n\/?a$/i.test(text)) return 0;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : 0;
}

function getInventoryTransactionRowUid_(row) {
  return normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['unique_id', 'UNIQUE_ID'], ''));
}

function getInventoryTransactionRowTable_(row) {
  return normalizeInventoryTransactionText_(row && row.__approval_table_name || getRuntimeSiteSplitTableName_('ph_master_inventory', 'PH') || 'ph_master_inventory');
}

function cloneInventoryTransactionRowForAudit_(row) {
  const clone = {};
  Object.keys(row || {}).forEach(function(key) {
    if (String(key || '').indexOf('__') === 0) return;
    clone[key] = row[key];
  });
  return clone;
}

function buildInventoryTransactionPatch_(fields) {
  const patch = Object.assign({}, fields || {});
  patch.last_updated = new Date().toISOString();
  return patch;
}

function normalizeInventoryTransactionHoldAction_(transaction) {
  const safeTx = transaction && typeof transaction === 'object' ? transaction : {};
  const raw = normalizeInventoryTransactionCompareText_(firstNonEmptyRequestValue_(
    safeTx.holdAction,
    safeTx.hold_action,
    safeTx.holdstopAction,
    safeTx.holdstop_action,
    safeTx.holdStopAction,
    safeTx.hold_stop_action
  ));
  if (raw === 'HOLD' || raw === 'PLACE_H' || raw === 'PLACE HOLD' || raw === 'H') return 'hold';
  if (raw === 'RELEASE' || raw === 'REMOVE_H' || raw === 'REMOVE HOLD' || raw === 'REMOVE' || raw === 'BLANK' || raw === 'CLEAR') return 'release';
  return 'none';
}

function parseInventoryTransactionLotParts_(lotCode) {
  const match = normalizeInventoryTransactionCompareText_(lotCode).match(/^(\d{2})\.([A-Z0-9]+)$/);
  if (!match) return { salesYear: '', season: '', lotCode: '' };
  return {
    salesYear: match[1],
    season: match[2],
    lotCode: match[1] + '.' + match[2]
  };
}

function getInventoryTransactionHoldScope_(sourceRow, transaction) {
  const safeTx = transaction && typeof transaction === 'object' ? transaction : {};
  const itemCode = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(sourceRow, ['itemcode', 'ITEMCODE'], ''));
  const lotCode = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(sourceRow, ['lotcode', 'LOTCODE'], ''));
  const lotParts = parseInventoryTransactionLotParts_(lotCode);
  const season = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
    safeTx.sourceSeason,
    safeTx.source_season,
    safeTx.season,
    getInventoryTransactionRowValue_(sourceRow, ['season', 'SEASON'], ''),
    lotParts.season
  )).toUpperCase();
  let salesYear = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
    safeTx.sourceSalesYear,
    safeTx.source_salesyear,
    safeTx.salesYear,
    safeTx.salesyear,
    getInventoryTransactionRowValue_(sourceRow, ['saleyear', 'SALEYEAR', 'salesyear', 'SALESYEAR', 'sales_year', 'SALES_YEAR'], ''),
    lotParts.salesYear
  )).toUpperCase();
  const salesYearFourDigitMatch = salesYear.match(/^20(\d{2})$/);
  if (salesYearFourDigitMatch) salesYear = salesYearFourDigitMatch[1];
  return {
    itemCode: itemCode,
    season: season,
    salesYear: salesYear,
    lotCode: lotParts.lotCode || lotCode
  };
}

function buildInventoryTransactionHoldScopeQuery_(scope, useLotFallback) {
  const safeScope = scope || {};
  const parts = [
    'select=*',
    'itemcode=eq.' + encodeURIComponent(safeScope.itemCode)
  ];
  if (useLotFallback) {
    parts.push('lotcode=eq.' + encodeURIComponent(safeScope.lotCode));
  } else {
    parts.push('season=eq.' + encodeURIComponent(safeScope.season));
    parts.push('saleyear=eq.' + encodeURIComponent(safeScope.salesYear));
  }
  return parts.join('&');
}

function patchInventoryTransactionHoldScopeRows_(tableName, scope, patch, useLotFallback) {
  const query = buildInventoryTransactionHoldScopeQuery_(scope, useLotFallback);
  const response = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName) + '?' + query, {
    method: 'patch',
    headers: getSupabaseHeaders_({
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    payload: JSON.stringify(patch),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Hold/stop scope update failed (' + code + '): ' + response.getContentText());
  }
  const rows = JSON.parse(response.getContentText() || '[]');
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    row.__approval_table_name = tableName;
    return row;
  });
}

function patchInventoryTransactionHoldScope_(sourceRow, transaction) {
  const action = normalizeInventoryTransactionHoldAction_(transaction);
  if (action === 'none') {
    return { action: 'none', count: 0, rows: [], itemCode: '', season: '', salesYear: '', reason: '' };
  }
  const scope = getInventoryTransactionHoldScope_(sourceRow, transaction);
  if (!scope.itemCode) throw new Error('Hold/stop update needs an item code.');
  if ((!scope.season || !scope.salesYear) && !scope.lotCode) {
    throw new Error('Hold/stop update needs the current season and sales year.');
  }
  const reason = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
    transaction && transaction.holdStopReason,
    transaction && transaction.holdstopReason,
    transaction && transaction.holdstopreason,
    transaction && transaction.hold_reason,
    transaction && transaction.holdReason
  ));
  const patch = action === 'hold'
    ? buildInventoryTransactionPatch_({ holdstopcode: 'H', holdstopreason: reason })
    : buildInventoryTransactionPatch_({ holdstopcode: null, holdstopreason: null });
  if (action === 'hold' && !reason) throw new Error('Enter the hold/stop reason.');

  const tableName = getInventoryTransactionRowTable_(sourceRow);
  let rows = [];
  if (scope.season && scope.salesYear) {
    rows = patchInventoryTransactionHoldScopeRows_(tableName, scope, patch, false);
  }
  if (!rows.length && scope.lotCode) {
    rows = patchInventoryTransactionHoldScopeRows_(tableName, scope, patch, true);
  }
  if (!rows.length) {
    throw new Error('No current season/current sales year rows matched this item for the hold update.');
  }
  return Object.assign({}, scope, {
    action: action,
    count: rows.length,
    rows: rows,
    reason: action === 'hold' ? reason : ''
  });
}

function getInventoryTransactionReturnedRowByUid_(rows, uid) {
  const safeUid = normalizeInventoryTransactionText_(uid);
  if (!safeUid || !Array.isArray(rows)) return null;
  for (let i = 0; i < rows.length; i++) {
    if (getInventoryTransactionRowUid_(rows[i]) === safeUid) return rows[i];
  }
  return null;
}

function validateInventoryTransactionHoldScopeRequest_(sourceRow, transaction) {
  const action = normalizeInventoryTransactionHoldAction_(transaction);
  if (action === 'none') return;
  const scope = getInventoryTransactionHoldScope_(sourceRow, transaction);
  if (!scope.itemCode) throw new Error('Hold/stop update needs an item code.');
  if ((!scope.season || !scope.salesYear) && !scope.lotCode) {
    throw new Error('Hold/stop update needs the current season and sales year.');
  }
  if (action === 'hold') {
    const reason = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
      transaction && transaction.holdStopReason,
      transaction && transaction.holdstopReason,
      transaction && transaction.holdstopreason,
      transaction && transaction.hold_reason,
      transaction && transaction.holdReason
    ));
    if (!reason) throw new Error('Enter the hold/stop reason.');
  }
}

function validateInventoryTransactionSourceIdentity_(row, source) {
  const safeSource = source && typeof source === 'object' ? source : {};
  const expectedItem = normalizeInventoryTransactionCompareText_(safeSource.itemcode || safeSource.itemCode || '');
  const expectedLot = normalizeInventoryTransactionCompareText_(safeSource.lotcode || safeSource.lotCode || '');
  const expectedLocation = normalizeInventoryTransactionCompareText_(safeSource.locationcode || safeSource.locationCode || safeSource.loc || '');
  const actualItem = normalizeInventoryTransactionCompareText_(getInventoryTransactionRowValue_(row, ['itemcode', 'ITEMCODE'], ''));
  const actualLot = normalizeInventoryTransactionCompareText_(getInventoryTransactionRowValue_(row, ['lotcode', 'LOTCODE'], ''));
  const actualLocation = normalizeInventoryTransactionCompareText_(getInventoryTransactionRowValue_(row, ['locationcode', 'LOCATIONCODE', 'location', 'LOCATION'], ''));
  if (expectedItem && actualItem && expectedItem !== actualItem) throw new Error('This item row changed. Sync and try again.');
  if (expectedLot && actualLot && expectedLot !== actualLot) throw new Error('This lot changed. Sync and try again.');
  if (expectedLocation && actualLocation && expectedLocation !== actualLocation) throw new Error('This location changed. Sync and try again.');
}

function isInventoryTransactionNcrDestination_(transaction) {
  const safeTx = transaction && typeof transaction === 'object' ? transaction : {};
  const reason = normalizeInventoryTransactionCompareText_(firstNonEmptyRequestValue_(
    safeTx.reason,
    safeTx.txType,
    safeTx.tx_type,
    safeTx.reasonCode,
    safeTx.reason_code,
    safeTx.transactionReason,
    safeTx.transaction_reason
  ));
  return reason === 'NCR';
}

function getInventoryTransactionDestinationDesignationSpec_(transaction) {
  const safeTx = transaction && typeof transaction === 'object' ? transaction : {};
  const desigItem = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
    safeTx.desigItem,
    safeTx.desigitem,
    safeTx.desig_item,
    safeTx.newDesigItem,
    safeTx.new_desigitem
  ));
  return {
    desigItem: desigItem || (isInventoryTransactionNcrDestination_(safeTx) ? '=' : ''),
    desigCust: normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
      safeTx.desigCust,
      safeTx.desigcust,
      safeTx.desig_cust,
      safeTx.newDesigCust,
      safeTx.new_desigcust
    )),
    desigLoc: normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
      safeTx.desigLoc,
      safeTx.desigloc,
      safeTx.desig_loc,
      safeTx.newDesigLoc,
      safeTx.new_desigloc
    ))
  };
}

function getInventoryTransactionDestinationSpec_(sourceRow, transaction, action) {
  const safeTx = transaction && typeof transaction === 'object' ? transaction : {};
  const itemCode = normalizeInventoryTransactionText_(action === 'reclass'
    ? firstNonEmptyRequestValue_(safeTx.newItemCode, safeTx.new_itemcode, safeTx.itemcode)
    : getInventoryTransactionRowValue_(sourceRow, ['itemcode', 'ITEMCODE'], ''));
  const lotCode = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(safeTx.newLotCode, safeTx.new_lotcode, safeTx.lotcode));
  const locationCode = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(safeTx.newLocationCode, safeTx.new_locationcode, safeTx.locationcode, safeTx.loc));
  if (!itemCode || !lotCode || !locationCode) throw new Error('Destination item, lot, and location are required.');
  return Object.assign({
    itemCode: itemCode,
    lotCode: lotCode,
    locationCode: locationCode
  }, getInventoryTransactionDestinationDesignationSpec_(safeTx));
}

function getInventoryTransactionSearchTables_(sourceRow) {
  const tables = [];
  const sourceTable = getInventoryTransactionRowTable_(sourceRow);
  if (sourceTable) tables.push(sourceTable);
  const runtimeTable = getRuntimeSiteSplitTableName_('ph_master_inventory', getSiteSplitSiteFromWarehouse_(getInventoryTransactionRowValue_(sourceRow, ['warehouseid', 'WAREHOUSEID'], '10')));
  if (runtimeTable && tables.indexOf(runtimeTable) === -1) tables.push(runtimeTable);
  if (tables.indexOf('ph_master_inventory') === -1) tables.push('ph_master_inventory');
  return tables;
}

function pickInventoryTransactionDestinationRow_(rows, spec) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeSpec = spec || {};
  const targetDesigItem = normalizeInventoryTransactionCompareText_(safeSpec.desigItem || '');
  const targetDesigCust = normalizeInventoryTransactionCompareText_(safeSpec.desigCust || '');
  const targetDesigLoc = normalizeInventoryTransactionCompareText_(safeSpec.desigLoc || '');
  let best = null;
  safeRows.forEach(function(row) {
    const rowDesigItem = normalizeInventoryTransactionCompareText_(getInventoryTransactionRowValue_(row, ['desigitem', 'DESIGITEM'], ''));
    const rowDesigCust = normalizeInventoryTransactionCompareText_(getInventoryTransactionRowValue_(row, ['desigcust', 'DESIGCUST'], ''));
    const rowDesigLoc = normalizeInventoryTransactionCompareText_(getInventoryTransactionRowValue_(row, ['desigloc', 'DESIGLOC'], ''));
    if (targetDesigItem && rowDesigItem !== targetDesigItem) return;
    if (targetDesigCust && rowDesigCust !== targetDesigCust) return;
    if (targetDesigLoc && rowDesigLoc !== targetDesigLoc) return;

    let score = 0;
    if (targetDesigItem) score += 100;
    else if (!rowDesigItem) score += 10;
    else if (rowDesigItem === '=') score -= 10;
    if (targetDesigCust) score += 20;
    else if (!rowDesigCust) score += 2;
    if (targetDesigLoc) score += 20;
    else if (!rowDesigLoc) score += 2;

    if (!best || score > best.score) best = { row: row, score: score };
  });
  return best && best.row ? best.row : null;
}

function fetchInventoryTransactionDestinationRowBySpec_(sourceRow, spec) {
  const safeSpec = spec || {};
  const itemCode = normalizeInventoryTransactionText_(safeSpec.itemCode);
  const lotCode = normalizeInventoryTransactionText_(safeSpec.lotCode);
  const locationCode = normalizeInventoryTransactionText_(safeSpec.locationCode);
  if (!itemCode || !lotCode || !locationCode) return null;
  const tables = getInventoryTransactionSearchTables_(sourceRow);
  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    const query = [
      'select=*',
      'itemcode=eq.' + encodeURIComponent(itemCode),
      'lotcode=eq.' + encodeURIComponent(lotCode),
      'locationcode=eq.' + encodeURIComponent(locationCode),
      'limit=50'
    ].join('&');
    const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName) + '?' + query;
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: getSupabaseHeaders_(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) continue;
    const rows = JSON.parse(res.getContentText() || '[]');
    if (Array.isArray(rows) && rows.length) {
      const picked = pickInventoryTransactionDestinationRow_(rows, safeSpec);
      if (picked) {
        picked.__approval_table_name = tableName;
        return picked;
      }
    }
  }
  return null;
}

function fetchInventoryTransactionItemTemplateRow_(sourceRow, itemCode) {
  const safeItemCode = normalizeInventoryTransactionText_(itemCode);
  if (!safeItemCode) return null;
  const tables = getInventoryTransactionSearchTables_(sourceRow);
  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    const query = [
      'select=*',
      'itemcode=eq.' + encodeURIComponent(safeItemCode),
      'limit=1'
    ].join('&');
    const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName) + '?' + query;
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: getSupabaseHeaders_(),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) continue;
    const rows = JSON.parse(res.getContentText() || '[]');
    if (Array.isArray(rows) && rows.length) {
      rows[0].__approval_table_name = tableName;
      return rows[0];
    }
  }
  return null;
}

function buildInventoryTransactionCreatedRowUniqueId_(row) {
  const itemCode = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['itemcode', 'ITEMCODE'], ''));
  const contSize = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['contsize', 'CONTSIZE'], '-')) || '-';
  const locationCode = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['locationcode', 'LOCATIONCODE'], ''));
  const lotCode = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['lotcode', 'LOTCODE'], ''));
  const source = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['source', 'SOURCE'], ''));
  const desigItem = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['desigitem', 'DESIGITEM'], ''));
  const desigCust = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['desigcust', 'DESIGCUST'], ''));
  const desigLoc = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['desigloc', 'DESIGLOC'], ''));
  const priority = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['priority', 'PRIORITY'], ''));
  const warehouseId = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(row, ['warehouseid', 'WAREHOUSEID'], '10'));
  const baseId = `${itemCode}-${contSize}-${locationCode}-${lotCode}-${source}-${desigItem}-${desigCust}-${desigLoc}-${priority}`
    .replace(/[^a-zA-Z0-9-]/g, '_');
  const rowSiteCode = warehouseId ? getSiteSplitSiteFromWarehouse_(warehouseId) : 'PH';
  return rowSiteCode && rowSiteCode !== 'PH' ? `${rowSiteCode}-${baseId}` : baseId;
}

function buildInventoryTransactionDestinationInsertPayload_(sourceRow, transaction, action, spec) {
  const safeSpec = spec || getInventoryTransactionDestinationSpec_(sourceRow, transaction, action);
  const templateRow = action === 'reclass'
    ? (fetchInventoryTransactionItemTemplateRow_(sourceRow, safeSpec.itemCode) || sourceRow)
    : sourceRow;
  const payload = {};
  Object.keys(templateRow || {}).forEach(function(key) {
    const dbKey = String(key || '').trim().toLowerCase();
    if (!ALLOWED_DB_COLUMNS.has(dbKey)) return;
    if (String(key || '').indexOf('__') === 0) return;
    payload[dbKey] = templateRow[key];
  });

  const nowIso = new Date().toISOString();
  const requestedSource = transaction && typeof transaction.source !== 'object' ? transaction.source : '';
  payload.itemcode = safeSpec.itemCode;
  payload.lotcode = safeSpec.lotCode;
  payload.locationcode = safeSpec.locationCode;
  payload.source = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(
    requestedSource,
    transaction && transaction.newSource,
    getInventoryTransactionRowValue_(sourceRow, ['source', 'SOURCE'], '')
  ));
  if (normalizeInventoryTransactionText_(safeSpec.desigItem)) payload.desigitem = safeSpec.desigItem;
  if (normalizeInventoryTransactionText_(safeSpec.desigCust)) payload.desigcust = safeSpec.desigCust;
  if (normalizeInventoryTransactionText_(safeSpec.desigLoc)) payload.desigloc = safeSpec.desigLoc;
  payload.ptronhand = 0;
  payload.ptravailable = 0;
  payload.ptrreviewed = 0;
  payload.last_updated = nowIso;

  [
    'photo_link', 'photo_name', 'dock_photo_link', 'dock_photo_name', 'flyer_photo_link', 'flyer_photo_name',
    'locationnote', 'locationnotedate', 'locationptn1', 'locationptn2',
    'pulltagnote1', 'pulltagnote2', 'specialpuller', 'inventorynote',
    'loc_match_qty', 'av_note', 'pic_note'
  ].forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) payload[key] = null;
  });

  payload.unique_id = buildInventoryTransactionCreatedRowUniqueId_(payload) || ('invtx-' + Utilities.getUuid());
  payload.concat = buildRowSyncHash_(payload, ['assignedto']);
  return payload;
}

function insertInventoryTransactionDestinationRow_(sourceRow, transaction, action, spec) {
  const tableName = getInventoryTransactionRowTable_(sourceRow);
  const payload = buildInventoryTransactionDestinationInsertPayload_(sourceRow, transaction, action, spec);
  const response = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName), {
    method: 'post',
    headers: getSupabaseHeaders_({
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Could not create destination row. No inventory was changed. ' + response.getContentText());
  }
  const rows = JSON.parse(response.getContentText() || '[]');
  const created = Array.isArray(rows) && rows.length ? rows[0] : payload;
  created.__approval_table_name = tableName;
  created.__inventory_transaction_created = true;
  return created;
}

function deleteInventoryTransactionCreatedRow_(row) {
  const uid = getInventoryTransactionRowUid_(row);
  const tableName = getInventoryTransactionRowTable_(row);
  if (!uid || !tableName) return;
  const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName)
    + '?unique_id=eq.' + encodeURIComponent(uid);
  const response = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: getSupabaseHeaders_(),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Created destination rollback failed: ' + response.getContentText());
  }
}

function fetchInventoryTransactionDestinationRow_(sourceRow, transaction, action) {
  const spec = getInventoryTransactionDestinationSpec_(sourceRow, transaction, action);
  const existing = fetchInventoryTransactionDestinationRowBySpec_(sourceRow, spec);
  if (existing) return existing;
  return insertInventoryTransactionDestinationRow_(sourceRow, transaction, action, spec);
}

function insertInventoryTransactionAudit_(record) {
  const payload = Object.assign({}, record || {});
  const response = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + encodeURIComponent(INVENTORY_TRANSACTION_TABLE), {
    method: 'post',
    headers: getSupabaseHeaders_({
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    }),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code >= 200 && code < 300) return { ok: true };
  return {
    ok: false,
    status: code,
    message: response.getContentText()
  };
}

function normalizeInventoryTransactionHistoryToken_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/@greenleafnursery\.com$/i, '')
    .replace(/[\s.]+/g, '_');
}

function canReadInventoryTransactionHistory_(payload) {
  const actor = payload && typeof payload.actor === 'object' ? payload.actor : {};
  const roleText = String(firstNonEmptyRequestValue_(
    payload && payload.role,
    actor.role,
    actor.userRole,
    ''
  ) || '').trim().toLowerCase();
  if (roleText === 'admin' || roleText === 'manager') return true;
  const allowed = {
    dylan_collyge: true,
    dylan: true,
    jd_jones: true,
    jdjones: true,
    jd: true,
    megan_kelly: true,
    megankelly: true,
    megan: true
  };
  const candidates = [
    payload && payload.actorUsername,
    payload && payload.username,
    payload && payload.user,
    payload && payload.requestedBy,
    actor.username,
    actor.user,
    actor.display,
    actor.displayName,
    actor.email
  ].map(normalizeInventoryTransactionHistoryToken_).filter(Boolean);
  return candidates.some((token) => allowed[token]);
}

function normalizeInventoryTransactionHistoryDateStart_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + 'T00:00:00.000Z';
  return text;
}

function normalizeInventoryTransactionHistoryDateEnd_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + 'T23:59:59.999Z';
  return text;
}

function inventoryTransactionHistoryRowMatchesSearch_(row, searchText) {
  const tokens = String(searchText == null ? '' : searchText).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = JSON.stringify(row || {}).toLowerCase();
  return tokens.every(function(token) {
    return haystack.indexOf(token) !== -1;
  });
}

function fetchInventoryTransactionHistory_(payload) {
  if (!canReadInventoryTransactionHistory_(payload || {})) {
    return {
      ok: false,
      status: 'forbidden',
      message: 'Inventory transaction history is manager-only.'
    };
  }
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const action = String(safePayload.action || 'all').trim().toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(safePayload.limit) || 300));
  const params = ['select=*'];
  if (['qty', 'transfer', 'reclass'].indexOf(action) !== -1) {
    params.push('action=eq.' + encodeURIComponent(action));
  }
  const dateStart = normalizeInventoryTransactionHistoryDateStart_(safePayload.dateStart || safePayload.startDate || safePayload.from);
  const dateEnd = normalizeInventoryTransactionHistoryDateEnd_(safePayload.dateEnd || safePayload.endDate || safePayload.to);
  if (dateStart) params.push('created_at=gte.' + encodeURIComponent(dateStart));
  if (dateEnd) params.push('created_at=lte.' + encodeURIComponent(dateEnd));
  params.push('order=created_at.desc');
  params.push('limit=' + encodeURIComponent(String(limit)));
  const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(INVENTORY_TRANSACTION_TABLE) + '?' + params.join('&');
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: getSupabaseHeaders_({
      Accept: 'application/json'
    }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const text = response.getContentText() || '';
  if (code < 200 || code >= 300) {
    return {
      ok: false,
      status: code,
      message: text || 'Unable to load inventory transaction history.'
    };
  }
  let rows = [];
  try {
    rows = text ? JSON.parse(text) : [];
  } catch (error) {
    return {
      ok: false,
      status: 'parse_error',
      message: 'Inventory transaction history returned unreadable JSON.'
    };
  }
  if (!Array.isArray(rows)) rows = [];
  const searchText = String(safePayload.search || safePayload.query || '').trim();
  if (searchText) {
    rows = rows.filter(function(row) {
      return inventoryTransactionHistoryRowMatchesSearch_(row, searchText);
    });
  }
  return {
    ok: true,
    table: INVENTORY_TRANSACTION_TABLE,
    rows: rows,
    count: rows.length,
    searchedAt: new Date().toISOString()
  };
}

function getInventoryTransactionEmailActionLabel_(action) {
  const safeAction = String(action || '').trim().toLowerCase();
  if (safeAction === 'qty') return 'QTY';
  if (safeAction === 'transfer') return 'Transfer';
  if (safeAction === 'reclass') return 'Reclass';
  return safeAction ? safeAction.toUpperCase() : 'Inventory Transaction';
}

function getInventoryTransactionEmailRecipients_(payload, actorEmail) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  return dedupeEmailAddresses_([
    safePayload.recipientEmails,
    safePayload.emailRecipients,
    safePayload.internalRecipients,
    safePayload.recipients,
    safePayload.requestedByEmail,
    safePayload.requested_by_email,
    safePayload.submittedByEmail,
    safePayload.submitted_by_email,
    safePayload.completedByEmail,
    safePayload.completed_by_email,
    actorEmail,
    INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_EMAILS_
  ]);
}

function getReclassInquiryEmailRecipients_(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  return dedupeEmailAddresses_([
    safePayload.recipientEmails,
    safePayload.emailRecipients,
    safePayload.internalRecipients,
    safePayload.recipients
  ]);
}

function getInventoryTransactionEmailRowValue_(row, fields, fallback) {
  return getInventoryTransactionRowValue_(row || {}, fields || [], fallback == null ? '' : fallback);
}

function buildInventoryTransactionDestinationSummary_(context) {
  const safeContext = context || {};
  const transaction = safeContext.transaction || {};
  const destination = safeContext.destinationRow || {};
  const source = safeContext.sourceBefore || safeContext.sourceRow || {};
  const actionLabel = getInventoryTransactionEmailActionLabel_(safeContext.action).toUpperCase();
  if (safeContext.action === 'qty') {
    const beforeQty = getInventoryTransactionEmailRowValue_(source, ['ptronhand', 'PTRONHAND', 'onhand', 'ONHAND'], '');
    return 'SET PTRONHAND / PTRREVIEWED / PTRAVAILABLE ' + beforeQty + ' -> ' + safeContext.quantity;
  }
  const itemCode = firstNonEmptyRequestValue_(
    transaction.newItemCode,
    transaction.new_itemcode,
    getInventoryTransactionEmailRowValue_(destination, ['itemcode', 'ITEMCODE'], ''),
    getInventoryTransactionEmailRowValue_(source, ['itemcode', 'ITEMCODE'], '')
  );
  const lotCode = firstNonEmptyRequestValue_(
    transaction.newLotCode,
    transaction.new_lotcode,
    getInventoryTransactionEmailRowValue_(destination, ['lotcode', 'LOTCODE'], '')
  );
  const locationCode = firstNonEmptyRequestValue_(
    transaction.newLocationCode,
    transaction.new_locationcode,
    transaction.loc,
    getInventoryTransactionEmailRowValue_(destination, ['locationcode', 'LOCATIONCODE'], '')
  );
  return actionLabel + ' ' + safeContext.quantity + ' TO ITEM ' + itemCode + ' LOT ' + lotCode + ' LOC ' + locationCode;
}

function buildInventoryTransactionEmailItem_(context) {
  const safeContext = context || {};
  const source = safeContext.sourceBefore || safeContext.sourceRow || {};
  const sourceAfter = safeContext.sourceRow || source;
  const holdScope = safeContext.holdScope || {};
  const itemInfoRow = holdScope && holdScope.action && holdScope.action !== 'none' ? sourceAfter : source;
  const transaction = safeContext.transaction || {};
  const actionLabel = getInventoryTransactionEmailActionLabel_(safeContext.action);
  const rowNumber = getInventoryTransactionEmailRowValue_(source, ['row', 'ROW', 'row_index', 'ROW_INDEX'], '');
  return {
    unique_id: getInventoryTransactionEmailRowValue_(source, ['unique_id', 'UNIQUE_ID', 'id', 'ID'], ''),
    itemcode: getInventoryTransactionEmailRowValue_(itemInfoRow, ['itemcode', 'ITEMCODE'], ''),
    commonname: getInventoryTransactionEmailRowValue_(itemInfoRow, ['commonname', 'COMMONNAME', 'common_name', 'COMMON_NAME', 'description', 'DESCRIPTION'], 'Unknown Item'),
    contsize: getInventoryTransactionEmailRowValue_(itemInfoRow, ['contsize', 'CONTSIZE', 'cont_size', 'CONT_SIZE', 'size', 'SIZE'], ''),
    genus: getInventoryTransactionEmailRowValue_(itemInfoRow, ['genus', 'GENUS', 'genusname', 'GENUSNAME'], ''),
    salesnote: getInventoryTransactionEmailRowValue_(itemInfoRow, ['salesnote', 'SALESNOTE', 'sales_note', 'SALES_NOTE'], ''),
    holdstopcode: getInventoryTransactionEmailRowValue_(itemInfoRow, ['holdstopcode', 'HOLDSTOPCODE', 'holstopcode', 'HOLSTOPCODE'], ''),
    holdstopreason: getInventoryTransactionEmailRowValue_(itemInfoRow, ['holdstopreason', 'HOLDSTOPREASON', 'holstopreason', 'HOLSTOPREASON'], ''),
    row: rowNumber,
    lotcode: getInventoryTransactionEmailRowValue_(source, ['lotcode', 'LOTCODE', 'lotCode', 'LOT_CODE'], ''),
    locationcode: getInventoryTransactionEmailRowValue_(source, ['locationcode', 'LOCATIONCODE', 'loc', 'LOC', 'location'], ''),
    source: getInventoryTransactionEmailRowValue_(source, ['source', 'SOURCE', 'sourcecode', 'SOURCECODE'], ''),
    desigcust: getInventoryTransactionEmailRowValue_(source, ['desigcust', 'DESIGCUST', 'desig_cust', 'DESIG_CUST'], ''),
    priority: getInventoryTransactionEmailRowValue_(source, ['priority', 'PRIORITY'], ''),
    ptronhand: getInventoryTransactionEmailRowValue_(source, ['ptronhand', 'PTRONHAND', 'onhand', 'ONHAND'], ''),
    ptrreviewed: getInventoryTransactionEmailRowValue_(source, ['ptrreviewed', 'PTRREVIEWED', 'review', 'REVIEW'], ''),
    ptravailable: getInventoryTransactionEmailRowValue_(source, ['ptravailable', 'PTRAVAILABLE', 'available', 'AVAILABLE'], ''),
    locationnotedate: getInventoryTransactionEmailRowValue_(source, ['locationnotedate', 'LOCATIONNOTEDATE', 'note_date', 'NOTE_DATE'], ''),
    locationnote: getInventoryTransactionEmailRowValue_(source, ['locationnote', 'LOCATIONNOTE', 'loc_note', 'LOC_NOTE'], ''),
    locationptn1: getInventoryTransactionEmailRowValue_(source, ['locationptn1', 'LOCATIONPTN1', 'ptn1', 'PTN1'], ''),
    action: actionLabel,
    qty: safeContext.quantity,
    request_note: buildInventoryTransactionDestinationSummary_(safeContext),
    comments: firstNonEmptyRequestValue_(transaction.reason, transaction.txType, transaction.tx_type, ''),
    photo: extractRequestPhotoUrls_([
      source.req_photo_link,
      source.REQ_PHOTO_LINK,
      source.request_photo_link,
      source.REQUEST_PHOTO_LINK,
      source.row_photo_link,
      source.ROW_PHOTO_LINK,
      source.saved_photo_link,
      source.SAVED_PHOTO_LINK,
      source.photo_link,
      source.PHOTO_LINK,
      source.photo,
      source.photos,
      source.photo_urls,
      sourceAfter.photo_link,
      sourceAfter.PHOTO_LINK,
      sourceAfter.photo,
      sourceAfter.photos,
      sourceAfter.photo_urls
    ]).join(',')
  };
}

function buildInventoryTransactionEmailText_(item, context) {
  const safeItem = item || {};
  const safeContext = context || {};
  return [
    'GNC PH ' + getInventoryTransactionEmailActionLabel_(safeContext.action),
    'Submitted By: ' + firstNonEmptyRequestValue_(safeContext.actorDisplay, safeContext.actorUsername, ''),
    'Transaction ID: ' + firstNonEmptyRequestValue_(safeContext.transactionId, ''),
    '',
    'Item: ' + firstNonEmptyRequestValue_(safeItem.commonname, ''),
    'Item Code: ' + firstNonEmptyRequestValue_(safeItem.itemcode, ''),
    'Size: ' + firstNonEmptyRequestValue_(safeItem.contsize, ''),
    'Lot: ' + firstNonEmptyRequestValue_(safeItem.lotcode, ''),
    'Location: ' + firstNonEmptyRequestValue_(safeItem.locationcode, ''),
    'On Hand: ' + firstNonEmptyRequestValue_(safeItem.ptronhand, ''),
    'Reviewed: ' + firstNonEmptyRequestValue_(safeItem.ptrreviewed, ''),
    'Available: ' + firstNonEmptyRequestValue_(safeItem.ptravailable, ''),
    'Requested Change: ' + firstNonEmptyRequestValue_(safeItem.request_note, '')
  ].join('\n');
}

function sendInventoryTransactionEmail_(payload, context) {
  const safeContext = context || {};
  const actionLabel = getInventoryTransactionEmailActionLabel_(safeContext.action);
  const recipients = getInventoryTransactionEmailRecipients_(payload, safeContext.actorEmail);
  if (!recipients.length) {
    return {
      ok: false,
      recipients: [],
      message: 'No inventory transaction email recipients were selected.'
    };
  }

  const item = buildInventoryTransactionEmailItem_(safeContext);
  const submittedAt = Utilities.formatDate(
    new Date(firstNonEmptyRequestValue_(safeContext.nowIso, new Date().toISOString())),
    Session.getScriptTimeZone() || 'America/Chicago',
    'M/d/yyyy, h:mm:ss a'
  );
  const tableHtml = buildRequestEmailTableItemsHtml_({
    requestItems: [item],
    folderId: 'inventory-transaction-' + firstNonEmptyRequestValue_(safeContext.transactionId, Utilities.getUuid())
  }, {
    title: 'Selected ' + actionLabel + ' Rows',
    includePhotos: true
  });
  const htmlBody = buildPhoneSizedEmailHtml_([
    '<div style="font-family:Arial,Helvetica,sans-serif;padding:20px;color:#333333;">',
    '<h2 style="color:#007a4d;margin:0 0 12px 0;">GNC PH</h2>',
    '<h1 style="margin:0 0 18px 0;color:#111827;font-size:24px;line-height:1.2;">' + escapeEmailHtml_(actionLabel) + '</h1>',
    '<p style="margin:0 0 10px 0;"><strong>Submitted By:</strong> ' + escapeEmailHtml_(firstNonEmptyRequestValue_(safeContext.actorDisplay, safeContext.actorUsername, '')) + '</p>',
    '<p style="margin:0 0 14px 0;"><strong>Submitted:</strong> ' + escapeEmailHtml_(submittedAt) + '</p>',
    '<p style="margin:0 0 18px 0;"><strong>Transaction ID:</strong> ' + escapeEmailHtml_(firstNonEmptyRequestValue_(safeContext.transactionId, '')) + '</p>',
    tableHtml,
    '</div>'
  ].join(''));
  const subjectName = String(firstNonEmptyRequestValue_(item.commonname, 'Inventory')).replace(/\s+/g, ' ').trim();
  const subjectLocation = firstNonEmptyRequestValue_(item.locationcode, '');
  const subject = '[External] GNC PH ' + actionLabel + ': ' + subjectName + (subjectLocation ? ' ' + subjectLocation : '');
  GmailApp.sendEmail(recipients.join(','), subject, buildInventoryTransactionEmailText_(item, safeContext), {
    htmlBody: htmlBody,
    name: 'GNC PH ' + actionLabel
  });
  return {
    ok: true,
    recipients: recipients,
    subject: subject
  };
}

const RECLASS_INQUIRY_ROW_FIELDS_ = [
  { key: 'lotcode', label: 'Lot', aliases: ['lotcode', 'LOTCODE'] },
  { key: 'locationcode', label: 'Location', aliases: ['locationcode', 'LOCATIONCODE'] },
  { key: 'source', label: 'Source', aliases: ['source', 'SOURCE', 'sourcecode', 'SOURCECODE'] },
  { key: 'priority', label: 'Priority', aliases: ['priority', 'PRIORITY'] },
  { key: 'desigitem', label: 'Desig Item', aliases: ['desigitem', 'DESIGITEM', 'DesigItem'] },
  { key: 'desigcust', label: 'Desig Cust', aliases: ['desigcust', 'DESIGCUST', 'DesigCust'] },
  { key: 'desigloc', label: 'Desig Loc', aliases: ['desigloc', 'DESIGLOC', 'DesigLoc'] },
  { key: 'ptronhand', label: 'OH', aliases: ['ptronhand', 'PTRONHAND'], numeric: true },
  { key: 'ptrreviewed', label: 'Rev', aliases: ['ptrreviewed', 'PTRREVIEWED'], numeric: true },
  { key: 'ptravailable', label: 'Avail', aliases: ['ptravailable', 'PTRAVAILABLE'], numeric: true },
  { key: 'locationnotedate', label: 'Loc Note Dt', aliases: ['locationnotedate', 'LOCATIONNOTEDATE'], readOnly: true },
  { key: 'locationnote', label: 'Loc Note', aliases: ['locationnote', 'LOCATIONNOTE'], multiline: true },
  { key: 'pulltagnote1', label: 'Pull Tag 1', aliases: ['pulltagnote1', 'PULLTAGNOTE1'], multiline: true },
  { key: 'pulltagnote2', label: 'Pull Tag 2', aliases: ['pulltagnote2', 'PULLTAGNOTE2'], multiline: true },
  { key: 'locationptn1', label: 'Loc PTN 1', aliases: ['locationptn1', 'LOCATIONPTN1'], multiline: true },
  { key: 'locationptn2', label: 'Loc PTN 2', aliases: ['locationptn2', 'LOCATIONPTN2'], multiline: true },
  { key: 'holdstopcode', label: 'H/S', aliases: ['holdstopcode', 'HOLDSTOPCODE', 'holstopcode', 'HOLSTOPCODE'], hold: true },
  { key: 'holdstopreason', label: 'H/S Reason', aliases: ['holdstopreason', 'HOLDSTOPREASON', 'holstopreason', 'HOLSTOPREASON'], multiline: true }
];

const RECLASS_INQUIRY_IDENTITY_FIELDS_ = [
  { key: 'plantgroupcode', label: 'Plant Grp', aliases: ['plantgroupcode', 'PLANTGROUPCODE'] },
  { key: 'commonname', label: 'Common Name', aliases: ['commonname', 'COMMONNAME', 'description', 'DESCRIPTION'] },
  { key: 'contsize', label: 'Cont.', aliases: ['contsize', 'CONTSIZE'] },
  { key: 'itemcode', label: 'Item Code', aliases: ['itemcode', 'ITEMCODE'] },
  { key: 'genusname', label: 'Genus', aliases: ['genusname', 'GENUSNAME', 'genus', 'GENUS'] },
  { key: 'fieldtagcolor', label: 'Tag Color', aliases: ['fieldtagcolor', 'FIELDTAGCOLOR'] },
  { key: 'itemspec', label: 'Item Spec', aliases: ['itemspec', 'ITEMSPEC'] },
  { key: 'pullerresponsibility', label: 'Puller Resp.', aliases: ['pullerresponsibility', 'PULLERRESPONSIBILITY', 'specialpuller', 'SPECIALPULLER'] },
  { key: 'holdstopcode', label: 'HOLDSTOPCODE', aliases: ['holdstopcode', 'HOLDSTOPCODE', 'holstopcode', 'HOLSTOPCODE'] }
];

const RECLASS_INQUIRY_SEASON_FIELDS_ = [
  { key: 'saleyear', label: 'Sale Yr', aliases: ['saleyear', 'SALEYEAR', 'salesyear', 'SALESYEAR'] },
  { key: 'season', label: 'Season', aliases: ['season', 'SEASON'] },
  { key: 's_lts', label: 'S_LTS', aliases: ['s_lts', 'S_LTS', 's_LTS', 'slts', 'SLTS'] },
  { key: 'season_supply', label: 'Supply', aliases: ['season_supply', 'SEASON_SUPPLY', 'supply', 'SUPPLY'] },
  { key: 'season_oh', label: 'On Hand', aliases: ['season_oh', 'SEASON_OH'] },
  { key: 'season_demand', label: 'Demand', aliases: ['season_demand', 'SEASON_DEMAND', 'demand', 'DEMAND'] }
];

const RECLASS_INQUIRY_COMPACT_FIELDS_ = [
  { key: 'lotcode', label: 'Lotcode', width: '.65in' },
  { key: 'locationcode', label: 'Location', width: '.80in' },
  { key: 'source', label: 'Source', width: '.50in' },
  { key: 'priority', label: 'Priority', width: '.75in' },
  { key: 'ptronhand', label: 'OH', width: '1.25in' },
  { key: 'ptrreviewed', label: 'PTRREVIEWED', width: '.85in' },
  { key: 'locationnotedate', label: 'Loc Note Date', width: '.90in' },
  { key: 'locationnote', label: 'Location Note' }
];

const RECLASS_INQUIRY_ACTION_LABELS_ = Object.freeze({
  hold: 'On Hold Request',
  take_off_hold: 'Off Hold Request',
  stop_ship: 'On Stop Request',
  off_stop_ship: 'Off Stop Request',
  ncr: 'NCR Request',
  recount: 'Re-Count Request',
  priority_change: 'Priority Change',
  move_up: 'Move Up Request',
  move_down: 'Move Down Request'
});

const RECLASS_ACTION_WORKFLOW_V2_ENABLED_ = true;
const RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION_ = 'reclass-action-workflow-v2-live-20260826';
const RECLASS_ACTION_WORKFLOW_V3_ENABLED_ = true;
const RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION_ = 'reclass-action-workflow-v3-row-actions-20260826';
const RECLASS_INQUIRY_DESTINATION_SEASONS_V2_ = Object.freeze(['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z']);
const RECLASS_INQUIRY_ACTION_RULES_V2_ = Object.freeze({
  hold: Object.freeze({ kind: 'hold_on', code: 'H', label: 'On Hold Request' }),
  take_off_hold: Object.freeze({ kind: 'hold_off', code: 'H', label: 'Off Hold Request' }),
  stop_ship: Object.freeze({ kind: 'hold_on', code: 'S', label: 'On Stop Request' }),
  off_stop_ship: Object.freeze({ kind: 'hold_off', code: 'S', label: 'Off Stop Request' }),
  recount: Object.freeze({ kind: 'recount', label: 'Re-Count Request' }),
  priority_change: Object.freeze({ kind: 'priority', label: 'Priority Change' }),
  move_up: Object.freeze({ kind: 'move', label: 'Move Up Request' }),
  move_down: Object.freeze({ kind: 'move', label: 'Move Down Request' })
});
const RECLASS_INQUIRY_ACTION_ORDER_V3_ = Object.freeze(['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down']);
const RECLASS_INQUIRY_HOLD_ACTIONS_V3_ = Object.freeze(['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship']);
const RECLASS_INQUIRY_TEMPORARY_FIELDS_V3_ = Object.freeze({
  holdstopreason: Object.freeze({ label: 'Hold/Stop Reason', maxLength: 1000, renderKey: 'holdstopreason', lower: true }),
  holdstopbegindate: Object.freeze({ label: 'Hold/Stop Begin Date', maxLength: 180 }),
  locationnote: Object.freeze({ label: 'Location Note', maxLength: 4000, renderKey: 'locationnote' }),
  locationnotedate: Object.freeze({ label: 'Location Note Date', maxLength: 180, renderKey: 'locationnotedate' }),
  locationptn1: Object.freeze({ label: 'Location PTN 1', maxLength: 2000 }),
  suspendto: Object.freeze({ label: 'Suspend To', maxLength: 1000 }),
  specialpuller: Object.freeze({ label: 'Special Puller', maxLength: 1000 })
});

function applyReclassInquiryTemporaryOverlayV3_(overlay, values, changedFields) {
  const hasValues = Object.prototype.hasOwnProperty.call(overlay, 'temporaryValues');
  const hasFields = Object.prototype.hasOwnProperty.call(overlay, 'temporaryChangedFields');
  if (!hasValues && !hasFields) return [];
  if (!hasValues || !hasFields || !overlay.temporaryValues || typeof overlay.temporaryValues !== 'object' || Array.isArray(overlay.temporaryValues) || !Array.isArray(overlay.temporaryChangedFields)) {
    throw new Error('Temporary Eval Work row edits are malformed. Refresh and reopen the assignment.');
  }
  const rawValueKeys = Object.keys(overlay.temporaryValues);
  const valueKeys = rawValueKeys.map(function(key) { return String(key || '').trim().toLowerCase(); });
  const declaredKeys = overlay.temporaryChangedFields.map(function(key) { return String(key || '').trim().toLowerCase(); });
  if (rawValueKeys.some(function(key, index) { return key !== valueKeys[index]; }) || new Set(valueKeys).size !== valueKeys.length || new Set(declaredKeys).size !== declaredKeys.length || valueKeys.slice().sort().join('|') !== declaredKeys.slice().sort().join('|')) {
    throw new Error('Temporary Eval Work row fields do not match their declared changes.');
  }
  const changes = [];
  valueKeys.forEach(function(key) {
    const rule = RECLASS_INQUIRY_TEMPORARY_FIELDS_V3_[key];
    if (!rule) throw new Error('A temporary Eval Work row field is not supported.');
    let requested = String(overlay.temporaryValues[key] == null ? '' : overlay.temporaryValues[key]);
    if (requested.length > rule.maxLength) throw new Error(rule.label + ' is too long.');
    if (rule.lower) requested = requested.trim().toLowerCase();
    const current = rule.renderKey ? String(values[rule.renderKey] == null ? '' : values[rule.renderKey]) : '';
    if (rule.renderKey) values[rule.renderKey] = requested;
    if (!rule.renderKey || requested !== current) {
      if (rule.renderKey) changedFields.push(rule.renderKey);
      changes.push({ key: key, label: rule.label, value: requested });
    }
  });
  return changes;
}
function getReclassInquiryActionLabel_(value) {
  const action = String(value || '').trim().toLowerCase();
  return RECLASS_INQUIRY_ACTION_LABELS_[action] || 'Reclass Item Inquiry';
}

function getReclassInquiryActionRuleV2_(value) {
  const action = String(value || '').trim().toLowerCase();
  return RECLASS_INQUIRY_ACTION_RULES_V2_[action] || null;
}

function getReclassInquiryCompactFields_(value, requestActions) {
  return RECLASS_INQUIRY_COMPACT_FIELDS_.slice();
}

function getReclassInquiryExactValue_(row, aliases, fallback) {
  const safeRow = row && typeof row === 'object' ? row : {};
  const safeAliases = Array.isArray(aliases) ? aliases : [aliases];
  for (let i = 0; i < safeAliases.length; i++) {
    const alias = safeAliases[i];
    if (!Object.prototype.hasOwnProperty.call(safeRow, alias)) continue;
    const value = safeRow[alias];
    return value == null ? '' : String(value);
  }
  return fallback == null ? '' : String(fallback);
}

function normalizeReclassInquirySaleYear_(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const number = Number(raw);
  if (!Number.isFinite(number)) return raw;
  const integer = Math.trunc(number);
  return integer >= 0 && integer <= 99 ? String(2000 + integer) : String(integer);
}

function getReclassInquirySeasonRank_(value) {
  const order = ['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z'];
  const index = order.indexOf(String(value || '').trim().toUpperCase());
  return index < 0 ? order.length : index;
}

function fetchReclassInquiryItemRows_(sourceRow) {
  const itemCode = normalizeInventoryTransactionText_(getInventoryTransactionRowValue_(sourceRow, ['itemcode', 'ITEMCODE'], ''));
  const tableName = getInventoryTransactionRowTable_(sourceRow);
  if (!itemCode || !tableName) throw new Error('The source item identity is incomplete.');
  const pageSize = 1000;
  const maxPages = 20;
  let rows = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName) + '?select=*&itemcode=eq.' + encodeURIComponent(itemCode) + '&limit=' + pageSize + '&offset=' + offset;
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: getSupabaseHeaders_({ Accept: 'application/json' }),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) throw new Error('Could not refresh the current Item Inquiry rows (' + code + ').');
    let pageRows = [];
    try {
      pageRows = JSON.parse(response.getContentText() || '[]');
    } catch (error) {
      throw new Error('The refreshed Item Inquiry rows were unreadable.');
    }
    if (!Array.isArray(pageRows)) throw new Error('The refreshed Item Inquiry rows were unreadable.');
    rows = rows.concat(pageRows);
    if (pageRows.length < pageSize) break;
    if (page === maxPages - 1) throw new Error('The Item Inquiry row set is too large to send safely.');
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error('No current rows were found for this ItemCode.');
  rows.forEach(function(row) { row.__approval_table_name = tableName; });
  return rows.sort(function(a, b) {
    const aLoc = getReclassInquiryExactValue_(a, ['locationcode', 'LOCATIONCODE'], '');
    const bLoc = getReclassInquiryExactValue_(b, ['locationcode', 'LOCATIONCODE'], '');
    const locCompare = aLoc.localeCompare(bLoc, undefined, { numeric: true, sensitivity: 'base' });
    if (locCompare) return locCompare;
    const aLot = getReclassInquiryExactValue_(a, ['lotcode', 'LOTCODE'], '');
    const bLot = getReclassInquiryExactValue_(b, ['lotcode', 'LOTCODE'], '');
    return aLot.localeCompare(bLot, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function normalizeReclassInquiryOverlayValue_(field, value) {
  const raw = String(value == null ? '' : value);
  const maxLength = field.multiline ? 2000 : 300;
  if (raw.length > maxLength) throw new Error(field.label + ' exceeds the printable report limit.');
  const normalized = raw.trim();
  if (field.hold) {
    const code = normalized.toUpperCase();
    if (code && code !== 'H' && code !== 'S') throw new Error('Hold/Stop Code must be blank, H, or S.');
    return code;
  }
  if (field.numeric) {
    if (!normalized || /^(?:-|\u2013|\u2014|n\/?a)$/i.test(normalized)) return '';
    const amount = Number(normalized.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount < 0) throw new Error(field.label + ' must be blank or a non-negative number.');
    return String(amount);
  }
  return normalized;
}

function applyReclassInquiryOverlays_(rows, overlays, now) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeOverlays = Array.isArray(overlays) ? overlays : [];
  if (!safeOverlays.length || safeOverlays.length !== safeRows.length) {
    return { ok: false, status: 'conflict', message: 'The Item Inquiry row set changed. Sync, reopen Reclass, and review it before sending.' };
  }
  const overlayByUid = new Map();
  safeOverlays.forEach(function(overlay) {
    const uid = normalizeInventoryTransactionText_(overlay && overlay.unique_id);
    if (!uid || overlayByUid.has(uid)) throw new Error('The Item Inquiry overlay row ids are invalid.');
    overlayByUid.set(uid, overlay);
  });
  const stamp = Utilities.formatDate(now, 'America/Chicago', 'M/d/yyyy, h:mm:ss a');
  const reportRows = [];
  for (let i = 0; i < safeRows.length; i++) {
    const row = safeRows[i];
    const uid = getInventoryTransactionRowUid_(row);
    const overlay = overlayByUid.get(uid);
    if (!overlay) return { ok: false, status: 'conflict', message: 'An Item Inquiry row changed or is no longer available. Sync and try again.' };
    const expected = overlay.expected && typeof overlay.expected === 'object' ? overlay.expected : {};
    const checks = [
      ['ItemCode', getInventoryTransactionRowValue_(row, ['itemcode', 'ITEMCODE'], ''), expected.itemcode],
      ['Lot', getInventoryTransactionRowValue_(row, ['lotcode', 'LOTCODE'], ''), expected.lotcode],
      ['Location', getInventoryTransactionRowValue_(row, ['locationcode', 'LOCATIONCODE'], ''), expected.locationcode]
    ];
    const mismatch = checks.find(function(check) {
      return normalizeInventoryTransactionCompareText_(check[1]) !== normalizeInventoryTransactionCompareText_(check[2]);
    });
    if (mismatch) return { ok: false, status: 'conflict', message: mismatch[0] + ' changed for an Item Inquiry row. Sync and review it before sending.' };
    const values = {};
    const changedFields = [];
    const overlayValues = overlay.values && typeof overlay.values === 'object' ? overlay.values : {};
    RECLASS_INQUIRY_ROW_FIELDS_.forEach(function(field) {
      if (field.readOnly) {
        values[field.key] = getReclassInquiryExactValue_(row, field.aliases, '');
        return;
      }
      const originalValue = normalizeReclassInquiryOverlayValue_(field, getReclassInquiryExactValue_(row, field.aliases, ''));
      const requestedValue = normalizeReclassInquiryOverlayValue_(field, Object.prototype.hasOwnProperty.call(overlayValues, field.key) ? overlayValues[field.key] : originalValue);
      values[field.key] = requestedValue;
      if (requestedValue !== originalValue) changedFields.push(field.key);
    });
    const originalLocationNote = String(getReclassInquiryExactValue_(row, ['locationnote', 'LOCATIONNOTE'], '')).trim();
    if (String(values.locationnote || '') !== originalLocationNote) {
      values.locationnotedate = stamp;
      if (changedFields.indexOf('locationnotedate') === -1) changedFields.push('locationnotedate');
    }
    reportRows.push({ unique_id: uid, values: values, changedFields: changedFields });
  }
  return { ok: true, rows: reportRows };
}

function getReclassInquiryCurrentSeasonV2_(row) {
  const explicit = getReclassInquiryExactValue_(row, ['season', 'SEASON'], '').trim().toUpperCase();
  if (explicit) return explicit;
  const lotCode = getReclassInquiryExactValue_(row, ['lotcode', 'LOTCODE'], '').trim().toUpperCase();
  const parts = lotCode.split('.').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function assertReclassInquiryObjectKeysV2_(value, allowedKeys, label) {
  const safeValue = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowed = Array.isArray(allowedKeys) ? allowedKeys : [];
  Object.keys(safeValue).forEach(function(key) {
    if (allowed.indexOf(key) === -1) throw new Error(label + ' contains an unrelated field: ' + key + '.');
  });
  return safeValue;
}

function buildReclassInquiryActionRowsV2_(action, authoritativeRows, overlays) {
  const requestAction = String(action || '').trim().toLowerCase();
  const rule = getReclassInquiryActionRuleV2_(requestAction);
  if (!rule) throw new Error('The Reclass action is not supported by workflow V2.');
  const safeRows = Array.isArray(authoritativeRows) ? authoritativeRows : [];
  const safeOverlays = Array.isArray(overlays) ? overlays : [];
  if (!safeRows.length || safeRows.length !== safeOverlays.length) {
    return { ok: false, status: 'conflict', message: 'The Item Inquiry row set changed. Sync, reopen Reclass, and review it before sending.' };
  }
  const overlayByUid = new Map();
  safeOverlays.forEach(function(rawOverlay) {
    const overlay = assertReclassInquiryObjectKeysV2_(rawOverlay, ['unique_id', 'expected', 'values', 'actionValues'], 'A row proposal');
    const uid = normalizeInventoryTransactionText_(overlay.unique_id);
    if (!uid || overlayByUid.has(uid)) throw new Error('The Item Inquiry proposal row ids are invalid.');
    overlayByUid.set(uid, overlay);
  });
  const allowedValueKeys = rule.kind === 'priority'
    ? ['priority']
    : (rule.kind === 'hold_on' || rule.kind === 'hold_off' ? ['holdstopcode', 'holdstopreason'] : []);
  const allowedActionKeys = rule.kind === 'move'
    ? ['included', 'moveQuantity', 'destinationSeason']
    : ['included'];
  const reportRows = [];
  let includedCount = 0;
  for (let i = 0; i < safeRows.length; i++) {
    const row = safeRows[i];
    const uid = getInventoryTransactionRowUid_(row);
    const overlay = overlayByUid.get(uid);
    if (!overlay) return { ok: false, status: 'conflict', message: 'An Item Inquiry row changed or is no longer available. Sync and try again.' };
    const expected = assertReclassInquiryObjectKeysV2_(overlay.expected, ['itemcode', 'lotcode', 'locationcode'], 'The expected row identity');
    const checks = [
      ['ItemCode', getInventoryTransactionRowValue_(row, ['itemcode', 'ITEMCODE'], ''), expected.itemcode],
      ['Lot', getInventoryTransactionRowValue_(row, ['lotcode', 'LOTCODE'], ''), expected.lotcode],
      ['Location', getInventoryTransactionRowValue_(row, ['locationcode', 'LOCATIONCODE'], ''), expected.locationcode]
    ];
    const mismatch = checks.find(function(check) {
      return normalizeInventoryTransactionCompareText_(check[1]) !== normalizeInventoryTransactionCompareText_(check[2]);
    });
    if (mismatch) return { ok: false, status: 'conflict', message: mismatch[0] + ' changed for an Item Inquiry row. Sync and review it before sending.' };
    const overlayValues = assertReclassInquiryObjectKeysV2_(overlay.values, allowedValueKeys, 'The proposed inventory values');
    const actionValues = assertReclassInquiryObjectKeysV2_(overlay.actionValues, allowedActionKeys, 'The proposed action values');
    if (Object.prototype.hasOwnProperty.call(actionValues, 'included') && typeof actionValues.included !== 'boolean') {
      throw new Error('The row included flag must be true or false.');
    }
    const included = actionValues.included === true;
    const values = {};
    RECLASS_INQUIRY_ROW_FIELDS_.forEach(function(field) {
      values[field.key] = getReclassInquiryExactValue_(row, field.aliases, '');
    });
    const changedFields = [];
    const reportActionValues = {};
    if (!included) {
      if (Object.keys(overlayValues).length || Object.keys(actionValues).some(function(key) { return key !== 'included'; })) {
        throw new Error('Only selected rows may contain proposed values.');
      }
    } else {
      includedCount++;
      if (rule.kind === 'move') {
        const originalOhRaw = String(values.ptronhand == null ? '' : values.ptronhand).trim().replace(/,/g, '');
        const originalOh = Number(originalOhRaw);
        const moveQuantity = Number(actionValues.moveQuantity);
        if (!Number.isFinite(originalOh) || originalOh < 1) throw new Error('Selected Move rows must have a positive original OH.');
        if (!Number.isInteger(moveQuantity) || moveQuantity < 1 || moveQuantity > originalOh) {
          throw new Error('Move Qty must be a whole number from 1 through the original OH.');
        }
        const destinationSeason = String(actionValues.destinationSeason || '').trim().toUpperCase();
        const currentSeason = getReclassInquiryCurrentSeasonV2_(row);
        if (RECLASS_INQUIRY_DESTINATION_SEASONS_V2_.indexOf(destinationSeason) === -1) {
          throw new Error('To Season must be a configured destination season.');
        }
        if (destinationSeason === currentSeason) throw new Error('To Season must be different from the current season.');
        reportActionValues.movequantity = String(moveQuantity);
        reportActionValues.destinationseason = destinationSeason;
        changedFields.push('movequantity', 'destinationseason');
      } else if (rule.kind === 'hold_on') {
        const proposedCode = String(overlayValues.holdstopcode || '').trim().toUpperCase();
        const proposedReason = String(overlayValues.holdstopreason || '').trim().toLowerCase();
        if (proposedCode !== rule.code) throw new Error(rule.label + ' must propose Hold/Stop Code ' + rule.code + '.');
        if (!proposedReason) throw new Error(rule.label + ' requires a Hold/Stop Reason.');
        const originalCode = String(values.holdstopcode || '').trim().toUpperCase();
        const originalReason = String(values.holdstopreason || '').trim().toLowerCase();
        values.holdstopcode = proposedCode;
        values.holdstopreason = proposedReason;
        if (proposedCode !== originalCode) changedFields.push('holdstopcode');
        if (proposedReason !== originalReason) changedFields.push('holdstopreason');
        if (!changedFields.length) throw new Error(rule.label + ' must change at least one Hold/Stop field.');
      } else if (rule.kind === 'hold_off') {
        const originalCode = String(values.holdstopcode || '').trim().toUpperCase();
        if (originalCode !== rule.code) throw new Error(rule.label + ' can select only rows currently coded ' + rule.code + '.');
        if (!Object.prototype.hasOwnProperty.call(overlayValues, 'holdstopcode') || !Object.prototype.hasOwnProperty.call(overlayValues, 'holdstopreason')) {
          throw new Error(rule.label + ' must explicitly clear Hold/Stop Code and Hold/Stop Reason.');
        }
        if (String(overlayValues.holdstopcode || '').trim() || String(overlayValues.holdstopreason || '').trim()) {
          throw new Error(rule.label + ' must clear Hold/Stop Code and Hold/Stop Reason.');
        }
        values.holdstopcode = '';
        values.holdstopreason = '';
        changedFields.push('holdstopcode');
        if (String(getReclassInquiryExactValue_(row, ['holdstopreason', 'HOLDSTOPREASON', 'holstopreason', 'HOLSTOPREASON'], '')).trim()) changedFields.push('holdstopreason');
      } else if (rule.kind === 'priority') {
        if (!Object.prototype.hasOwnProperty.call(overlayValues, 'priority')) throw new Error('Priority Change requires a proposed Priority value.');
        const requestedRaw = String(overlayValues.priority == null ? '' : overlayValues.priority).trim();
        let requestedPriority = '';
        if (requestedRaw) {
          const number = Number(requestedRaw);
          if (!Number.isInteger(number) || number < 1 || number > 99) throw new Error('Priority must be blank or a whole number from 1 through 99.');
          requestedPriority = String(number);
        }
        const originalRaw = String(values.priority == null ? '' : values.priority).trim();
        const originalNumber = originalRaw ? Number(originalRaw) : null;
        const originalPriority = Number.isInteger(originalNumber) ? String(originalNumber) : originalRaw;
        if (requestedPriority === originalPriority) throw new Error('Priority Change must add, replace, or remove the selected row Priority.');
        values.priority = requestedPriority;
        changedFields.push('priority');
      } else if (rule.kind === 'recount') {
        throw new Error('Re-Count rows must remain read-only and unselected.');
      }
    }
    reportRows.push({
      unique_id: uid,
      values: values,
      actionValues: reportActionValues,
      changedFields: changedFields,
      included: included
    });
  }
  if (overlayByUid.size !== safeRows.length) {
    return { ok: false, status: 'conflict', message: 'The Item Inquiry row set changed. Sync, reopen Reclass, and review it before sending.' };
  }
  if (rule.kind === 'recount') {
    if (includedCount) throw new Error('Re-Count must not contain proposed row changes.');
  } else if (!includedCount) {
    throw new Error(rule.label + ' requires at least one selected row.');
  }
  return { ok: true, rows: reportRows };
}

function normalizeReclassInquirySalesYearV3_(value) {
  const digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isInteger(parsed)) return null;
  return parsed < 100 ? 2000 + parsed : parsed;
}

function fetchReclassInquiryScopeSettingsV3_() {
  const url = SUPABASE_URL + '/rest/v1/ph_app_settings?select=key,value,updated_at&key=eq.current_season_salesyear&limit=1';
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: getSupabaseHeaders_({ Accept: 'application/json' }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Current Reclass season settings could not be refreshed (' + code + ').');
  let rows;
  try { rows = JSON.parse(response.getContentText() || '[]'); }
  catch (error) { throw new Error('Current Reclass season settings were unreadable.'); }
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error('Current Reclass season settings are missing.');
  let value = row.value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch (error) { throw new Error('Current Reclass season settings were unreadable.'); }
  }
  const safe = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const season = String(firstNonEmptyRequestValue_(safe.seasonCode, safe.season_code, safe.currentSeason, safe.current_season, safe.season, '') || '').trim().toUpperCase();
  const salesYear = normalizeReclassInquirySalesYearV3_(firstNonEmptyRequestValue_(safe.salesYear, safe.sales_year, safe.currentSalesYear, safe.current_sales_year, safe.salesyear, ''));
  if (!season || salesYear == null) throw new Error('Current Reclass season settings are incomplete.');
  return { season: season, salesYear: salesYear, updatedAt: String(row.updated_at || '') };
}

function getReclassInquiryActionsLabelV3_(actions) {
  const ordered = RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return (Array.isArray(actions) ? actions : []).indexOf(action) !== -1; });
  if (!ordered.length) return 'Reclass Item Inquiry';
  return ordered.map(getReclassInquiryActionLabel_).join(' + ');
}

function buildReclassInquiryActionRowsV3SeasonScopeLegacy_(transaction, authoritativeRows, overlays, authoritativeScope) {
  const safeTransaction = assertReclassInquiryObjectKeysV2_(transaction, ['requestActions', 'holdStopProposals', 'scope'], 'The Reclass transaction');
  const safeRows = Array.isArray(authoritativeRows) ? authoritativeRows : [];
  const safeOverlays = Array.isArray(overlays) ? overlays : [];
  if (!safeRows.length || safeRows.length !== safeOverlays.length) {
    return { ok: false, status: 'conflict', message: 'The Item Inquiry row set changed. Sync, reopen Reclass, and review it before sending.' };
  }
  const scope = authoritativeScope && typeof authoritativeScope === 'object' ? authoritativeScope : {};
  const clientScope = assertReclassInquiryObjectKeysV2_(safeTransaction.scope, ['season', 'salesYear'], 'The Reclass season scope');
  const clientSeason = String(clientScope.season || '').trim().toUpperCase();
  const clientSalesYear = normalizeReclassInquirySalesYearV3_(clientScope.salesYear);
  if (clientSeason !== String(scope.season || '').trim().toUpperCase() || clientSalesYear !== scope.salesYear) {
    return { ok: false, status: 'conflict', message: 'The current season settings changed. Refresh the app and reopen Reclass before sending.' };
  }
  const requestedActions = Array.isArray(safeTransaction.requestActions) ? safeTransaction.requestActions.map(function(value) { return String(value || '').trim().toLowerCase(); }) : [];
  if (!requestedActions.length || new Set(requestedActions).size !== requestedActions.length) throw new Error('The Reclass action list is empty or duplicated.');
  requestedActions.forEach(function(action) {
    if (RECLASS_INQUIRY_ACTION_ORDER_V3_.indexOf(action) === -1) throw new Error('The Reclass action list contains an unsupported action.');
  });
  const holdProposalMap = new Map();
  const holdStopProposals = Array.isArray(safeTransaction.holdStopProposals) ? safeTransaction.holdStopProposals : [];
  holdStopProposals.forEach(function(rawProposal) {
    const proposal = assertReclassInquiryObjectKeysV2_(rawProposal, ['action', 'reason'], 'A Hold/Stop proposal');
    const action = String(proposal.action || '').trim().toLowerCase();
    const rule = getReclassInquiryActionRuleV2_(action);
    if (RECLASS_INQUIRY_HOLD_ACTIONS_V3_.indexOf(action) === -1 || !rule) throw new Error('A Hold/Stop proposal contains an unsupported action.');
    if (holdProposalMap.has(action)) throw new Error('A Hold/Stop action may be selected only once.');
    const reason = String(proposal.reason || '').trim();
    if (rule.kind === 'hold_on' && !reason) throw new Error(rule.label + ' requires a Hold/Stop Reason.');
    if (rule.kind === 'hold_off' && Object.prototype.hasOwnProperty.call(proposal, 'reason') && reason) throw new Error(rule.label + ' must not contain a new reason.');
    holdProposalMap.set(action, { action: action, reason: reason });
  });
  const overlayByUid = new Map();
  safeOverlays.forEach(function(rawOverlay) {
    const overlay = assertReclassInquiryObjectKeysV2_(rawOverlay, ['unique_id', 'expected', 'proposals'], 'A row proposal');
    const uid = normalizeInventoryTransactionText_(overlay.unique_id);
    if (!uid || overlayByUid.has(uid)) throw new Error('The Item Inquiry proposal row ids are invalid.');
    if (!Array.isArray(overlay.proposals)) throw new Error('Each Item Inquiry row must contain a proposal list.');
    overlayByUid.set(uid, overlay);
  });
  const actionUnion = new Set(Array.from(holdProposalMap.keys()));
  const holdAffectedCounts = {};
  holdProposalMap.forEach(function(proposal, action) { holdAffectedCounts[action] = 0; });
  const reportRows = [];
  for (let i = 0; i < safeRows.length; i++) {
    const row = safeRows[i];
    const uid = getInventoryTransactionRowUid_(row);
    const overlay = overlayByUid.get(uid);
    if (!overlay) return { ok: false, status: 'conflict', message: 'An Item Inquiry row changed or is no longer available. Sync and try again.' };
    const expected = assertReclassInquiryObjectKeysV2_(overlay.expected, ['itemcode', 'lotcode', 'locationcode'], 'The expected row identity');
    const checks = [
      ['ItemCode', getInventoryTransactionRowValue_(row, ['itemcode', 'ITEMCODE'], ''), expected.itemcode],
      ['Lot', getInventoryTransactionRowValue_(row, ['lotcode', 'LOTCODE'], ''), expected.lotcode],
      ['Location', getInventoryTransactionRowValue_(row, ['locationcode', 'LOCATIONCODE'], ''), expected.locationcode]
    ];
    const mismatch = checks.find(function(check) { return normalizeInventoryTransactionCompareText_(check[1]) !== normalizeInventoryTransactionCompareText_(check[2]); });
    if (mismatch) return { ok: false, status: 'conflict', message: mismatch[0] + ' changed for an Item Inquiry row. Sync and review it before sending.' };
    const values = {};
    RECLASS_INQUIRY_ROW_FIELDS_.forEach(function(field) { values[field.key] = getReclassInquiryExactValue_(row, field.aliases, ''); });
    const rowSeason = String(getReclassInquiryExactValue_(row, ['season', 'SEASON'], '') || '').trim().toUpperCase();
    const rowSalesYear = normalizeReclassInquirySalesYearV3_(getReclassInquiryExactValue_(row, ['saleyear', 'SALEYEAR', 'salesyear', 'SALESYEAR'], ''));
    const rowHoldCode = String(values.holdstopcode || '').trim().toUpperCase();
    const inHoldScope = rowSeason === scope.season && rowSalesYear != null && rowSalesYear <= scope.salesYear;
    const rowActions = [];
    const holdLines = [];
    if (inHoldScope) {
      RECLASS_INQUIRY_HOLD_ACTIONS_V3_.forEach(function(action) {
        const proposal = holdProposalMap.get(action);
        if (!proposal) return;
        const rule = getReclassInquiryActionRuleV2_(action);
        if (rule.kind === 'hold_off' && rowHoldCode !== rule.code) return;
        holdAffectedCounts[action]++;
        rowActions.push(action);
        if (rule.kind === 'hold_on') holdLines.push(rule.label + ': set ' + rule.code + ' — ' + proposal.reason);
        else holdLines.push(rule.label + ': clear ' + rule.code + ' and Hold/Stop Reason');
      });
    }
    const actionValues = {};
    const changedFields = [];
    const seenRowActions = new Set();
    let combinedMoveQuantity = 0;
    overlay.proposals.forEach(function(rawProposal) {
      const baseProposal = rawProposal && typeof rawProposal === 'object' && !Array.isArray(rawProposal) ? rawProposal : {};
      const action = String(baseProposal.action || '').trim().toLowerCase();
      const rule = getReclassInquiryActionRuleV2_(action);
      if (!rule || RECLASS_INQUIRY_HOLD_ACTIONS_V3_.indexOf(action) !== -1) throw new Error('A row proposal contains an unsupported action.');
      if (seenRowActions.has(action)) throw new Error('A row action may be selected only once.');
      seenRowActions.add(action);
      actionUnion.add(action);
      rowActions.push(action);
      if (rule.kind === 'priority') {
        const proposal = assertReclassInquiryObjectKeysV2_(baseProposal, ['action', 'priority'], 'A Priority proposal');
        if (!Object.prototype.hasOwnProperty.call(proposal, 'priority')) throw new Error('Priority Change requires a proposed Priority value.');
        const requestedRaw = String(proposal.priority == null ? '' : proposal.priority).trim();
        let requestedPriority = '';
        if (requestedRaw) {
          const number = Number(requestedRaw);
          if (!Number.isInteger(number) || number < 1 || number > 99) throw new Error('Priority must be blank or a whole number from 1 through 99.');
          requestedPriority = String(number);
        }
        const originalRaw = String(values.priority == null ? '' : values.priority).trim();
        const originalNumber = originalRaw ? Number(originalRaw) : null;
        const originalPriority = Number.isInteger(originalNumber) ? String(originalNumber) : originalRaw;
        if (requestedPriority === originalPriority) throw new Error('Priority Change must add, replace, or remove the selected row Priority.');
        values.priority = requestedPriority;
        changedFields.push('priority');
      } else if (rule.kind === 'move') {
        const proposal = assertReclassInquiryObjectKeysV2_(baseProposal, ['action', 'moveQuantity', 'destinationSeason'], 'A Move proposal');
        const originalOh = Number(String(values.ptronhand == null ? '' : values.ptronhand).trim().replace(/,/g, ''));
        const quantity = Number(proposal.moveQuantity);
        if (!Number.isFinite(originalOh) || originalOh < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > originalOh) throw new Error(rule.label + ' Qty must be a whole number from 1 through original OH.');
        const destination = String(proposal.destinationSeason || '').trim().toUpperCase();
        if (RECLASS_INQUIRY_DESTINATION_SEASONS_V2_.indexOf(destination) === -1) throw new Error(rule.label + ' requires a configured destination season.');
        if (destination === getReclassInquiryCurrentSeasonV2_(row)) throw new Error(rule.label + ' destination season must differ from the current season.');
        combinedMoveQuantity += quantity;
        const prefix = action === 'move_up' ? 'moveup' : 'movedown';
        actionValues[prefix + 'quantity'] = String(quantity);
        actionValues[prefix + 'season'] = destination;
        changedFields.push(prefix + 'quantity', prefix + 'season');
      } else if (rule.kind === 'recount') {
        assertReclassInquiryObjectKeysV2_(baseProposal, ['action'], 'A Re-Count proposal');
      }
    });
    const originalOh = Number(String(values.ptronhand == null ? '' : values.ptronhand).trim().replace(/,/g, ''));
    if (combinedMoveQuantity && (!Number.isFinite(originalOh) || combinedMoveQuantity > originalOh)) throw new Error('Combined Move Up and Move Down quantities cannot exceed original OH.');
    if (holdLines.length) {
      actionValues.holdstopproposals = holdLines.join('\n');
      changedFields.push('holdstopproposals');
    }
    const orderedRowActions = RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return rowActions.indexOf(action) !== -1; });
    actionValues.actions = orderedRowActions.map(getReclassInquiryActionLabel_).join('\n');
    reportRows.push({ unique_id: uid, values: values, actionValues: actionValues, changedFields: changedFields, actions: orderedRowActions, included: orderedRowActions.length > 0 });
  }
  if (overlayByUid.size !== safeRows.length) return { ok: false, status: 'conflict', message: 'The Item Inquiry row set changed. Sync, reopen Reclass, and review it before sending.' };
  holdProposalMap.forEach(function(proposal, action) {
    if (!holdAffectedCounts[action]) throw new Error(getReclassInquiryActionLabel_(action) + ' has no eligible rows in the configured current-season scope.');
  });
  const canonicalActions = RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return actionUnion.has(action); });
  if (!canonicalActions.length) throw new Error('Choose at least one Reclass action before sending.');
  if (canonicalActions.join('|') !== RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return requestedActions.indexOf(action) !== -1; }).join('|')) {
    throw new Error('The Reclass action summary does not match the row proposals.');
  }
  return { ok: true, rows: reportRows, requestActions: canonicalActions, scope: scope };
}

function buildReclassInquiryActionRowsV3_(transaction, authoritativeRows, overlays, authoritativeScope, options) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const allowEmptyActions = safeOptions.allowEmptyActions === true;
  const safeTransaction = assertReclassInquiryObjectKeysV2_(transaction, ['requestActions', 'holdStopProposals', 'scope'], 'The Reclass transaction');
  const safeRows = Array.isArray(authoritativeRows) ? authoritativeRows : [];
  const safeOverlays = Array.isArray(overlays) ? overlays : [];
  if (!safeRows.length || safeRows.length !== safeOverlays.length) {
    return { ok: false, status: 'conflict', message: 'The Item Inquiry row set changed. Sync, reopen Reclass, and review it before sending.' };
  }
  const requestedActions = Array.isArray(safeTransaction.requestActions)
    ? safeTransaction.requestActions.map(function(value) { return String(value || '').trim().toLowerCase(); })
    : [];
  if ((!requestedActions.length && !allowEmptyActions) || new Set(requestedActions).size !== requestedActions.length) throw new Error('The Reclass action list is empty or duplicated.');
  requestedActions.forEach(function(action) {
    if (RECLASS_INQUIRY_ACTION_ORDER_V3_.indexOf(action) === -1) throw new Error('The Reclass action list contains an unsupported action.');
  });
  const normalizedHoldProposals = [];
  function addHoldProposal_(rawAction, rawReason, label) {
    const action = String(rawAction || '').trim().toLowerCase();
    const rule = getReclassInquiryActionRuleV2_(action);
    if (!rule || RECLASS_INQUIRY_HOLD_ACTIONS_V3_.indexOf(action) === -1) throw new Error(label + ' contains an unsupported Hold/Stop action.');
    const reason = String(rawReason == null ? '' : rawReason).trim().toLowerCase();
    if (rule.kind === 'hold_on' && !reason) throw new Error(rule.label + ' requires a Hold/Stop Reason.');
    if (rule.kind === 'hold_off' && reason) throw new Error(rule.label + ' must clear Hold/Stop Code and Hold/Stop Reason.');
    if (normalizedHoldProposals.length) {
      const current = normalizedHoldProposals[0];
      if (current.action !== action || current.reason !== reason) throw new Error('Choose only one Hold/Stop action for the complete Item Inquiry.');
      return;
    }
    normalizedHoldProposals.push({ action: action, reason: reason });
  }
  const holdStopProposals = Array.isArray(safeTransaction.holdStopProposals) ? safeTransaction.holdStopProposals : [];
  if (holdStopProposals.length > 1) throw new Error('Choose only one Hold/Stop action for the complete Item Inquiry.');
  holdStopProposals.forEach(function(rawProposal) {
    const proposal = assertReclassInquiryObjectKeysV2_(rawProposal, ['action', 'reason'], 'A Hold/Stop proposal');
    addHoldProposal_(proposal.action, proposal.reason, 'A Hold/Stop proposal');
  });
  const overlayByUid = new Map();
  safeOverlays.forEach(function(rawOverlay) {
    const overlay = assertReclassInquiryObjectKeysV2_(rawOverlay, ['unique_id', 'expected', 'proposals', 'temporaryValues', 'temporaryChangedFields'], 'A row proposal');
    const uid = normalizeInventoryTransactionText_(overlay.unique_id);
    if (!uid || overlayByUid.has(uid)) throw new Error('The Item Inquiry proposal row ids are invalid.');
    if (!Array.isArray(overlay.proposals)) throw new Error('Each Item Inquiry row must contain a proposal list.');
    overlay.proposals.forEach(function(rawProposal) {
      const baseProposal = rawProposal && typeof rawProposal === 'object' && !Array.isArray(rawProposal) ? rawProposal : {};
      const action = String(baseProposal.action || '').trim().toLowerCase();
      if (RECLASS_INQUIRY_HOLD_ACTIONS_V3_.indexOf(action) === -1) return;
      const proposal = assertReclassInquiryObjectKeysV2_(baseProposal, ['action', 'holdstopcode', 'holdstopreason'], 'A cached row Hold/Stop proposal');
      const rule = getReclassInquiryActionRuleV2_(action);
      const requestedCode = String(proposal.holdstopcode == null ? '' : proposal.holdstopcode).trim().toUpperCase();
      const requestedReason = String(proposal.holdstopreason == null ? '' : proposal.holdstopreason).trim().toLowerCase();
      if (rule.kind === 'hold_on' && requestedCode !== rule.code) throw new Error(rule.label + ' must place ' + rule.code + ' in Hold/Stop Code.');
      if (rule.kind === 'hold_off' && (requestedCode || requestedReason)) throw new Error(rule.label + ' must clear Hold/Stop Code and Hold/Stop Reason.');
      addHoldProposal_(action, requestedReason, 'A cached row Hold/Stop proposal');
    });
    overlayByUid.set(uid, overlay);
  });
  const holdProposal = normalizedHoldProposals.length ? normalizedHoldProposals[0] : null;
  const scope = authoritativeScope && typeof authoritativeScope === 'object' ? authoritativeScope : {};
  const clientScope = assertReclassInquiryObjectKeysV2_(safeTransaction.scope, ['season', 'salesYear'], 'The Reclass season scope');
  if (holdProposal) {
    const authoritativeSeason = String(scope.season || '').trim().toUpperCase();
    const authoritativeSalesYear = normalizeReclassInquirySalesYearV3_(scope.salesYear);
    if (!authoritativeSeason || authoritativeSalesYear == null) throw new Error('Current Reclass season settings could not be refreshed.');
    if (Object.keys(clientScope).length) {
      const clientSeason = String(clientScope.season || '').trim().toUpperCase();
      const clientSalesYear = normalizeReclassInquirySalesYearV3_(clientScope.salesYear);
      if (clientSeason !== authoritativeSeason || clientSalesYear !== authoritativeSalesYear) {
        return { ok: false, status: 'conflict', message: 'The current season settings changed. Refresh the app and reopen Reclass before sending.' };
      }
    }
  }
  const actionUnion = new Set(holdProposal ? [holdProposal.action] : []);
  let holdAffectedCount = 0;
  const reportRows = [];
  for (let i = 0; i < safeRows.length; i++) {
    const row = safeRows[i];
    const uid = getInventoryTransactionRowUid_(row);
    const overlay = overlayByUid.get(uid);
    if (!overlay) return { ok: false, status: 'conflict', message: 'An Item Inquiry row changed or is no longer available. Sync and try again.' };
    const expected = assertReclassInquiryObjectKeysV2_(overlay.expected, ['itemcode', 'lotcode', 'locationcode', 'ptronhand'], 'The expected row identity');
    const checks = [
      ['ItemCode', getInventoryTransactionRowValue_(row, ['itemcode', 'ITEMCODE'], ''), expected.itemcode],
      ['Lot', getInventoryTransactionRowValue_(row, ['lotcode', 'LOTCODE'], ''), expected.lotcode],
      ['Location', getInventoryTransactionRowValue_(row, ['locationcode', 'LOCATIONCODE'], ''), expected.locationcode]
    ];
    const mismatch = checks.find(function(check) { return normalizeInventoryTransactionCompareText_(check[1]) !== normalizeInventoryTransactionCompareText_(check[2]); });
    if (mismatch) return { ok: false, status: 'conflict', message: mismatch[0] + ' changed for an Item Inquiry row. Sync and review it before sending.' };
    if (Object.prototype.hasOwnProperty.call(expected, 'ptronhand')) {
      const currentOh = String(getInventoryTransactionRowValue_(row, ['ptronhand', 'PTRONHAND'], '')).trim().replace(/,/g, '');
      const expectedOh = String(expected.ptronhand == null ? '' : expected.ptronhand).trim().replace(/,/g, '');
      if (currentOh !== expectedOh) return { ok: false, status: 'conflict', message: 'OH changed for an Item Inquiry row. Sync and review it before sending.' };
    }
    const values = {};
    RECLASS_INQUIRY_ROW_FIELDS_.forEach(function(field) { values[field.key] = getReclassInquiryExactValue_(row, field.aliases, ''); });
    const actionValues = {};
    const changedFields = [];
    const rowActions = [];
    const seenRowActions = new Set();
    let combinedMoveQuantity = 0;
    if (holdProposal) {
      const rowSeason = getReclassInquiryCurrentSeasonV2_(row);
      const rowSalesYear = normalizeReclassInquirySalesYearV3_(getReclassInquiryExactValue_(row, ['saleyear', 'SALEYEAR', 'salesyear', 'SALESYEAR'], ''));
      const scopeSeason = String(scope.season || '').trim().toUpperCase();
      const scopeSalesYear = normalizeReclassInquirySalesYearV3_(scope.salesYear);
      const rule = getReclassInquiryActionRuleV2_(holdProposal.action);
      const originalCode = String(values.holdstopcode || '').trim().toUpperCase();
      const inScope = rowSeason === scopeSeason && rowSalesYear != null && rowSalesYear <= scopeSalesYear;
      const eligible = inScope && (rule.kind === 'hold_on' || originalCode === rule.code);
      if (eligible) {
        holdAffectedCount++;
        values.holdstopcode = rule.kind === 'hold_on' ? rule.code : '';
        values.holdstopreason = rule.kind === 'hold_on' ? holdProposal.reason : '';
        changedFields.push('holdstopcode', 'holdstopreason');
        rowActions.push(holdProposal.action);
      }
    }
    overlay.proposals.forEach(function(rawProposal) {
      const baseProposal = rawProposal && typeof rawProposal === 'object' && !Array.isArray(rawProposal) ? rawProposal : {};
      const action = String(baseProposal.action || '').trim().toLowerCase();
      const rule = getReclassInquiryActionRuleV2_(action);
      if (!rule) throw new Error('A row proposal contains an unsupported action.');
      if (RECLASS_INQUIRY_HOLD_ACTIONS_V3_.indexOf(action) !== -1) return;
      if (seenRowActions.has(action)) throw new Error('A row action may be selected only once.');
      seenRowActions.add(action);
      actionUnion.add(action);
      rowActions.push(action);
      if (rule.kind === 'priority') {
        const proposal = assertReclassInquiryObjectKeysV2_(baseProposal, ['action', 'priority'], 'A Priority proposal');
        if (!Object.prototype.hasOwnProperty.call(proposal, 'priority')) throw new Error('Priority Change requires a proposed Priority value.');
        const requestedRaw = String(proposal.priority == null ? '' : proposal.priority).trim();
        let requestedPriority = '';
        if (requestedRaw) {
          const number = Number(requestedRaw);
          if (!Number.isInteger(number) || number < 1 || number > 99) throw new Error('Priority must be blank or a whole number from 1 through 99.');
          requestedPriority = String(number);
        }
        const originalRaw = String(values.priority == null ? '' : values.priority).trim();
        const originalNumber = originalRaw ? Number(originalRaw) : null;
        const originalPriority = Number.isInteger(originalNumber) ? String(originalNumber) : originalRaw;
        if (requestedPriority === originalPriority) throw new Error('Priority Change must add, replace, or remove the selected row Priority.');
        values.priority = requestedPriority;
        changedFields.push('priority');
      } else if (rule.kind === 'move') {
        const proposal = assertReclassInquiryObjectKeysV2_(baseProposal, ['action', 'moveQuantity', 'destinationSeason'], 'A Move proposal');
        const originalOh = Number(String(values.ptronhand == null ? '' : values.ptronhand).trim().replace(/,/g, ''));
        const quantity = Number(proposal.moveQuantity);
        if (!Number.isFinite(originalOh) || originalOh < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > originalOh) throw new Error(rule.label + ' Qty must be a whole number from 1 through original OH.');
        const destination = String(proposal.destinationSeason || '').trim().toUpperCase();
        if (RECLASS_INQUIRY_DESTINATION_SEASONS_V2_.indexOf(destination) === -1) throw new Error(rule.label + ' requires a configured destination season.');
        if (destination === getReclassInquiryCurrentSeasonV2_(row)) throw new Error(rule.label + ' destination season must differ from the current season.');
        combinedMoveQuantity += quantity;
        const prefix = action === 'move_up' ? 'moveup' : 'movedown';
        actionValues[prefix + 'quantity'] = String(quantity);
        actionValues[prefix + 'season'] = destination;
        changedFields.push(prefix + 'quantity', prefix + 'season');
      } else if (rule.kind === 'recount') {
        assertReclassInquiryObjectKeysV2_(baseProposal, ['action'], 'A Re-Count proposal');
      }
    });
    const temporaryChanges = applyReclassInquiryTemporaryOverlayV3_(overlay, values, changedFields);
    const originalOh = Number(String(values.ptronhand == null ? '' : values.ptronhand).trim().replace(/,/g, ''));
    if (combinedMoveQuantity && (!Number.isFinite(originalOh) || combinedMoveQuantity > originalOh)) throw new Error('Combined Move Up and Move Down quantities cannot exceed original OH.');
    const orderedRowActions = RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return rowActions.indexOf(action) !== -1; });
    reportRows.push({
      unique_id: uid,
      values: values,
      actionValues: actionValues,
      changedFields: Array.from(new Set(changedFields)),
      temporaryChanges: temporaryChanges,
      actions: orderedRowActions,
      included: orderedRowActions.length > 0
    });
  }
  if (overlayByUid.size !== safeRows.length) return { ok: false, status: 'conflict', message: 'The Item Inquiry row set changed. Sync, reopen Reclass, and review it before sending.' };
  if (holdProposal && !holdAffectedCount) throw new Error(getReclassInquiryActionLabel_(holdProposal.action) + ' has no eligible rows in the configured current-season scope.');
  const canonicalActions = RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return actionUnion.has(action); });
  if (!canonicalActions.length && !allowEmptyActions) throw new Error('Choose at least one Reclass action before sending.');
  if (canonicalActions.join('|') !== RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return requestedActions.indexOf(action) !== -1; }).join('|')) {
    throw new Error('The Reclass action summary does not match the row proposals.');
  }
  return {
    ok: true,
    rows: reportRows,
    requestActions: canonicalActions,
    holdStopProposals: holdProposal ? [holdProposal] : [],
    scope: holdProposal ? {
      season: String(scope.season || '').trim().toUpperCase(),
      salesYear: normalizeReclassInquirySalesYearV3_(scope.salesYear),
      updatedAt: String(scope.updatedAt || ''),
      holdAction: holdProposal.action,
      affectedCount: holdAffectedCount
    } : {}
  };
}

function hasReclassInquiryHoldProposalV3_(transaction, overlays) {
  const safeTransaction = transaction && typeof transaction === 'object' ? transaction : {};
  const requestActions = Array.isArray(safeTransaction.requestActions) ? safeTransaction.requestActions : [];
  if (requestActions.some(function(action) { return RECLASS_INQUIRY_HOLD_ACTIONS_V3_.indexOf(String(action || '').trim().toLowerCase()) !== -1; })) return true;
  if (Array.isArray(safeTransaction.holdStopProposals) && safeTransaction.holdStopProposals.length) return true;
  return (Array.isArray(overlays) ? overlays : []).some(function(overlay) {
    return Array.isArray(overlay && overlay.proposals) && overlay.proposals.some(function(proposal) {
      return RECLASS_INQUIRY_HOLD_ACTIONS_V3_.indexOf(String(proposal && proposal.action || '').trim().toLowerCase()) !== -1;
    });
  });
}

function buildReclassInquiryReportModel_(sourceRow, authoritativeRows, reportRows, payload, now) {
  const identity = {};
  RECLASS_INQUIRY_IDENTITY_FIELDS_.forEach(function(field) {
    identity[field.key] = getReclassInquiryExactValue_(sourceRow, field.aliases, getReclassInquiryExactValue_(authoritativeRows[0], field.aliases, ''));
  });
  identity.holdstopreason = getReclassInquiryExactValue_(sourceRow, ['holdstopreason', 'HOLDSTOPREASON', 'holstopreason', 'HOLSTOPREASON'], getReclassInquiryExactValue_(authoritativeRows[0], ['holdstopreason', 'HOLDSTOPREASON', 'holstopreason', 'HOLSTOPREASON'], '')).trim().toLowerCase();
  const normalizedReportRows = (Array.isArray(reportRows) ? reportRows : []).map(function(row) {
    const normalizedRow = Object.assign({}, row || {});
    normalizedRow.values = Object.assign({}, row && row.values || {});
    normalizedRow.values.holdstopreason = String(normalizedRow.values.holdstopreason || '').trim().toLowerCase();
    normalizedRow.changedFields = Array.isArray(row && row.changedFields) ? row.changedFields.slice() : [];
    normalizedRow.temporaryChanges = Array.isArray(row && row.temporaryChanges)
      ? row.temporaryChanges.map(function(change) { return Object.assign({}, change || {}); }) : [];
    return normalizedRow;
  });
  const sourceUid = getInventoryTransactionRowUid_(sourceRow);
  const originReportRow = normalizedReportRows.find(function(row) {
    return normalizeInventoryTransactionCompareText_(row && row.unique_id) === normalizeInventoryTransactionCompareText_(sourceUid);
  });
  const identityChangedFields = [];
  if (originReportRow && originReportRow.values) {
    identity.holdstopcode = String(originReportRow.values.holdstopcode || '').trim().toUpperCase();
    identity.holdstopreason = String(originReportRow.values.holdstopreason || '').trim().toLowerCase();
    if (originReportRow.changedFields.indexOf('holdstopcode') !== -1) identityChangedFields.push('holdstopcode');
    if (originReportRow.changedFields.indexOf('holdstopreason') !== -1) identityChangedFields.push('holdstopreason');
  } else {
    identity.holdstopcode = String(identity.holdstopcode || '').trim().toUpperCase();
    identity.holdstopreason = String(identity.holdstopreason || '').trim().toLowerCase();
  }
  const seen = {};
  const seasons = [];
  authoritativeRows.forEach(function(row) {
    const entry = {};
    RECLASS_INQUIRY_SEASON_FIELDS_.forEach(function(field) { entry[field.key] = getReclassInquiryExactValue_(row, field.aliases, ''); });
    entry.saleyear = normalizeReclassInquirySaleYear_(entry.saleyear);
    entry.season = String(entry.season || '').trim().toUpperCase();
    if (!RECLASS_INQUIRY_SEASON_FIELDS_.some(function(field) { return String(entry[field.key] || '').trim(); })) return;
    const key = RECLASS_INQUIRY_SEASON_FIELDS_.map(function(field) { return String(entry[field.key] || '').trim().toUpperCase(); }).join('|');
    if (seen[key]) return;
    seen[key] = true;
    seasons.push(entry);
  });
  seasons.sort(function(a, b) {
    const yearDiff = (Number(b.saleyear) || -1) - (Number(a.saleyear) || -1);
    if (yearDiff) return yearDiff;
    return getReclassInquirySeasonRank_(a.season) - getReclassInquirySeasonRank_(b.season);
  });
  const actor = payload && payload.actor && typeof payload.actor === 'object' ? payload.actor : {};
  const transaction = payload && payload.transaction && typeof payload.transaction === 'object' ? payload.transaction : {};
  const requestAction = String(firstNonEmptyRequestValue_(transaction.requestAction, transaction.request_action, '') || '').trim().toLowerCase();
  const requestActions = Array.isArray(transaction.requestActions)
    ? RECLASS_INQUIRY_ACTION_ORDER_V3_.filter(function(action) { return transaction.requestActions.indexOf(action) !== -1; })
    : (requestAction ? [requestAction] : []);
  const editedRows = normalizedReportRows.filter(function(row) { return row && Array.isArray(row.changedFields) && row.changedFields.length; });
  return {
    identity: identity,
    identityChangedFields: identityChangedFields,
    originUid: sourceUid,
    seasons: seasons,
    rows: normalizedReportRows,
    transaction: transaction,
    requestAction: requestAction,
    requestActions: requestActions,
    requestActionLabel: requestActions.length > 1 || (!requestAction && requestActions.length)
      ? getReclassInquiryActionsLabelV3_(requestActions)
      : getReclassInquiryActionLabel_(requestAction),
    actorDisplay: normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(actor.display, actor.username, 'Unknown User')),
    submittedAt: Utilities.formatDate(now, 'America/Chicago', 'M/d/yyyy, h:mm:ss a'),
    editSummary: {
      rowCount: editedRows.length,
      fieldCount: editedRows.reduce(function(total, row) { return total + row.changedFields.length; }, 0)
    }
  };
}

function buildReclassInquiryReportHtml_(model, printMode) {
  return buildReclassInquiryCompactReportHtml_(model, printMode);
}

function buildReclassInquiryReportText_(model) {
  const safeModel = model || {};
  const identity = safeModel.identity || {};
  const editSummary = safeModel.editSummary || {};
  return [
    'GNC PH Reclass Item Inquiry',
    'Submitted: ' + String(safeModel.submittedAt || ''),
    'Submitted By: ' + String(safeModel.actorDisplay || ''),
    'Request: ' + String(safeModel.requestActionLabel || 'Reclass Item Inquiry'),
    'Item: ' + String(identity.commonname || ''),
    'Item Code: ' + String(identity.itemcode || ''),
    'Container: ' + String(identity.contsize || ''),
    'Edited Rows: ' + String(editSummary.rowCount || 0),
    'Edited Fields: ' + String(editSummary.fieldCount || 0),
    '',
    'Open the attached PDF to review the complete Item Inquiry. Proposed values are yellow, boxed, and labeled for color and black-and-white printing.'
  ].join('\n');
}

function buildReclassInquiryEmailHtml_(model) {
  const safeModel = model || {};
  const identity = safeModel.identity || {};
  const editSummary = safeModel.editSummary || {};
  return buildPhoneSizedEmailHtml_([
    '<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2937;">',
    '<h2 style="margin:0 0 14px;color:#007a4d;">GNC PH Reclass Item Inquiry</h2>',
    '<p><strong>Sent By:</strong> ' + escapeEmailHtml_(safeModel.actorDisplay || '') + '<br><strong>Submitted:</strong> ' + escapeEmailHtml_(safeModel.submittedAt || '') + '</p>',
    '<p><strong>Request:</strong> ' + escapeEmailHtml_(safeModel.requestActionLabel || 'Reclass Item Inquiry') + '</p>',
    '<p><strong>Item:</strong> ' + escapeEmailHtml_(identity.commonname || '') + '<br><strong>Item Code:</strong> ' + escapeEmailHtml_(identity.itemcode || '') + '<br><strong>Container:</strong> ' + escapeEmailHtml_(identity.contsize || '') + '</p>',
    '<p><strong>Edited Rows:</strong> ' + escapeEmailHtml_(editSummary.rowCount || 0) + '<br><strong>Edited Fields:</strong> ' + escapeEmailHtml_(editSummary.fieldCount || 0) + '</p>',
    '<p style="padding:12px 14px;border-radius:10px;background:#fffbeb;border:2px solid #111827;color:#111827;"><strong>PDF attached:</strong> Open the Item Inquiry PDF to review every current row. Proposed values are yellow, boxed, and labeled for color and black-and-white printing.</p>',
    '</div>'
  ].join(''));
}

function sortReclassInquiryCompactRows_(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort(function(a, b) {
    const aValues = a && a.values && typeof a.values === 'object' ? a.values : {};
    const bValues = b && b.values && typeof b.values === 'object' ? b.values : {};
    const locationCompare = String(aValues.locationcode || '').localeCompare(String(bValues.locationcode || ''), undefined, { numeric: true, sensitivity: 'base' });
    if (locationCompare) return locationCompare;
    return String(aValues.lotcode || '').localeCompare(String(bValues.lotcode || ''), undefined, { numeric: true, sensitivity: 'base' });
  });
}

function buildReclassInquiryProposalBoxHtml_(value, cssClass) {
  const raw = String(value == null ? '' : value);
  const display = raw ? escapeEmailHtml_(raw) : '[blank]';
  return '<span class="proposal-box' + (cssClass ? ' ' + escapeEmailHtml_(cssClass) : '') + '"><span class="proposal-label">PROPOSED</span><strong>' + display + '</strong></span>';
}

function formatReclassInquiryScopeNote_(scope) {
  const safeScope = scope && typeof scope === 'object' ? scope : {};
  const season = String(safeScope.season || '').trim().toUpperCase();
  const year = normalizeReclassInquirySalesYearV3_(safeScope.salesYear);
  const count = Number(safeScope.affectedCount);
  if (!season || year == null || !Number.isFinite(count)) return '';
  const displayYear = year >= 2000 && year <= 2099 ? String(year).slice(-2) : String(year);
  return season + ' | sales year <= ' + displayYear + ' | ' + String(Math.max(0, Math.trunc(count))) + ' row' + (Math.trunc(count) === 1 ? '' : 's');
}

function buildReclassInquiryCompactReportHtml_(model, printMode) {
  const safeModel = model || {};
  const esc = escapeEmailHtml_;
  const editSummary = safeModel.editSummary || {};
  const actionLabel = String(firstNonEmptyRequestValue_(safeModel.requestActionLabel, getReclassInquiryActionLabel_(safeModel.requestAction), 'Reclass Item Inquiry'));
  const compactFields = getReclassInquiryCompactFields_(safeModel.requestAction, safeModel.requestActions);
  const identityChangedFields = Array.isArray(safeModel.identityChangedFields) ? safeModel.identityChangedFields : [];
  const scopeNote = formatReclassInquiryScopeNote_(safeModel.transaction && safeModel.transaction.scope);
  const identityCells = RECLASS_INQUIRY_IDENTITY_FIELDS_.map(function(field) {
    if (field.key === 'holdstopcode') {
      const code = String(safeModel.identity && safeModel.identity.holdstopcode || '').trim().toUpperCase();
      const reason = String(safeModel.identity && safeModel.identity.holdstopreason || '').trim().toLowerCase();
      const edited = identityChangedFields.indexOf('holdstopcode') !== -1 || identityChangedFields.indexOf('holdstopreason') !== -1;
      const valueHtml = edited
        ? '<span class="proposal-box proposal-box-identity"><span class="proposal-label">PROPOSED</span><strong>' + (code ? esc(code) : '[blank]') + '</strong><span class="identity-sub-label">HOLDSTOPREASON</span><strong>' + (reason ? esc(reason) : '[blank]') + '</strong></span>'
        : '<strong>' + (code ? esc(code) : '&nbsp;') + '</strong><span class="identity-sub-label">HOLDSTOPREASON</span><strong>' + (reason ? esc(reason) : '&nbsp;') + '</strong>';
      return '<div class="identity-cell holdstop-identity' + (edited ? ' edited-cell' : '') + '"' + (edited ? ' data-edited="true"' : '') + '><span>' + esc(field.label) + '</span>' + valueHtml + (scopeNote ? '<small class="scope-note">' + esc(scopeNote) + '</small>' : '') + '</div>';
    }
    const edited = identityChangedFields.indexOf(field.key) !== -1;
    const rawValue = safeModel.identity && Object.prototype.hasOwnProperty.call(safeModel.identity, field.key) ? safeModel.identity[field.key] : '';
    return '<div class="identity-cell' + (edited ? ' edited-cell' : '') + '"' + (edited ? ' data-edited="true"' : '') + '><span>' + esc(field.label) + '</span>' + (edited ? buildReclassInquiryProposalBoxHtml_(rawValue) : '<strong>' + (String(rawValue == null ? '' : rawValue) ? esc(rawValue) : '&nbsp;') + '</strong>') + '</div>';
  }).join('');
  const columnWidths = compactFields.map(function(field) { return '<col' + (field.width ? ' style="width:' + esc(field.width) + '"' : '') + '>'; }).join('');
  const rowHead = compactFields.map(function(field) { return '<th>' + esc(field.label) + '</th>'; }).join('');
  const sortedRows = sortReclassInquiryCompactRows_(safeModel.rows);
  const rowBody = sortedRows.map(function(row) {
    const changedFields = Array.isArray(row && row.changedFields) ? row.changedFields : [];
    return '<tr>' + compactFields.map(function(field) {
      const edited = changedFields.indexOf(field.key) !== -1;
      const sourceValues = field.source === 'actionValues' ? row && row.actionValues : row && row.values;
      let rawValue = sourceValues && Object.prototype.hasOwnProperty.call(sourceValues, field.key) ? sourceValues[field.key] : '';
      if (field.key === 'ptronhand') {
        const actionValues = row && row.actionValues && typeof row.actionValues === 'object' ? row.actionValues : {};
        const movementLines = [];
        if (String(actionValues.moveupquantity || '').trim()) movementLines.push(buildReclassInquiryProposalBoxHtml_('UP ' + String(actionValues.moveupquantity).trim() + ' TO ' + String(actionValues.moveupseason || '').trim().toUpperCase(), 'proposal-box-movement'));
        if (String(actionValues.movedownquantity || '').trim()) movementLines.push(buildReclassInquiryProposalBoxHtml_('DOWN ' + String(actionValues.movedownquantity).trim() + ' TO ' + String(actionValues.movedownseason || '').trim().toUpperCase(), 'proposal-box-movement'));
        if (!movementLines.length && String(actionValues.movequantity || '').trim()) {
          const direction = String(safeModel.requestAction || '').trim().toLowerCase() === 'move_down' ? 'DOWN' : 'UP';
          movementLines.push(buildReclassInquiryProposalBoxHtml_(direction + ' ' + String(actionValues.movequantity).trim() + ' TO ' + String(actionValues.destinationseason || '').trim().toUpperCase(), 'proposal-box-movement'));
        }
        return '<td' + (movementLines.length ? ' class="movement-cell edited-cell" data-edited="true"' : '') + '><strong class="original-oh">' + (String(rawValue == null ? '' : rawValue) ? esc(rawValue) : '&nbsp;') + '</strong>' + movementLines.join('') + '</td>';
      }
      return '<td' + (edited ? ' class="edited-cell" data-edited="true"' : '') + '>' + (edited ? buildReclassInquiryProposalBoxHtml_(rawValue) : (String(rawValue == null ? '' : rawValue) ? esc(rawValue) : '&nbsp;')) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  const compactFieldKeys = new Set(compactFields.map(function(field) { return field.key; }));
  const supplementalTemporaryRows = [];
  sortedRows.forEach(function(row) {
    const values = row && row.values && typeof row.values === 'object' ? row.values : {};
    (Array.isArray(row && row.temporaryChanges) ? row.temporaryChanges : []).forEach(function(change) {
      const key = String(change && change.key || '').trim().toLowerCase();
      const rule = RECLASS_INQUIRY_TEMPORARY_FIELDS_V3_[key];
      const isOriginHoldReason = key === 'holdstopreason' && normalizeInventoryTransactionCompareText_(row && row.unique_id) === normalizeInventoryTransactionCompareText_(safeModel.originUid);
      if (!rule || isOriginHoldReason || (rule.renderKey && compactFieldKeys.has(rule.renderKey))) return;
      supplementalTemporaryRows.push({
        locationcode: String(values.locationcode || ''),
        lotcode: String(values.lotcode || ''),
        label: String(change && change.label || rule.label || key),
        value: String(change && change.value != null ? change.value : '')
      });
    });
  });
  const supplementalTemporaryHtml = supplementalTemporaryRows.length
    ? '<div class="section-title">Temporary Report Edits</div><table class="temporary-table"><thead><tr><th>Location</th><th>Lotcode</th><th>Field</th><th>Proposed Value</th></tr></thead><tbody>' + supplementalTemporaryRows.map(function(change) {
        return '<tr><td>' + esc(change.locationcode) + '</td><td>' + esc(change.lotcode) + '</td><td>' + esc(change.label) + '</td><td class="edited-cell" data-edited="true">' + buildReclassInquiryProposalBoxHtml_(change.value) + '</td></tr>';
      }).join('') + '</tbody></table>'
    : '';
  const pilotBanner = safeModel.isSyntheticPilot
    ? '<div class="pilot-banner">TEST PILOT - SYNTHETIC DATA ONLY</div>'
    : '';
  const evidenceRows = Array.isArray(safeModel.evaluationResultsRows)
    ? safeModel.evaluationResultsRows
    : (safeModel.evaluationResults && typeof safeModel.evaluationResults === 'object' ? [safeModel.evaluationResults] : []);
  const evidenceHtml = evidenceRows.length
    ? '<div class="section-title">Evaluation Results</div>' + evidenceRows.map(function(evidence, evidenceIndex) {
        const evidenceFields = [
          ['Spec', evidence.spec], ['Caliper', evidence.caliper], ['Loc Match %', evidence.locMatchPercent],
          ['AV Note', evidence.avNote], ['Pick Note', evidence.pickNote], ['Comments', evidence.comments]
        ];
        const originLabel = String(evidence.locationcode || '') + ' / ' + String(evidence.lotcode || '');
        return '<section class="evaluation-origin"><h3>Lot ' + esc(String(evidenceIndex + 1)) + ': ' + esc(originLabel) + '</h3><div class="evaluation-results">' + evidenceFields.map(function(field) {
          return '<div class="evaluation-cell"><span>' + esc(field[0]) + '</span><strong>' + (String(field[1] == null ? '' : field[1]) ? esc(field[1]) : '&nbsp;') + '</strong></div>';
        }).join('') + '</div>' + ((Array.isArray(evidence.photos) ? evidence.photos : []).length
          ? '<div class="evaluation-photos">' + evidence.photos.slice(0, 8).map(function(photo) {
              const url = String(photo && (photo.url || photo.publicUrl) || '').trim();
              return url ? '<img src="' + esc(url) + '" alt="Evaluation photo">' : '';
            }).join('') + '</div>' : '') + '</section>';
      }).join('')
    : '';
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page{size:Letter landscape;margin:.34in}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;font-size:8pt;line-height:1.22}h1{margin:0 0 3px;font-size:15pt}.pilot-banner{margin:0 0 5px;padding:4px 8px;border:2px solid #000;background:#fee2e2;color:#000;font-size:8pt;font-weight:700;text-align:center;letter-spacing:.08em}.meta{margin-bottom:5px}.proposal-legend{display:flex;align-items:center;gap:6px;margin:0 0 6px;padding:4px 6px;border:2px solid #000;background:#fff;font-size:7pt;font-weight:700}.proposal-swatch{display:inline-block;padding:2px 5px;border:2px solid #000;background:#fff176;color:#000;font-weight:800}.identity{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #000}.evaluation-origin{margin:0 0 6px;break-inside:avoid}.evaluation-origin h3{margin:0;padding:3px 5px;border:1px solid #000;border-bottom:0;background:#e5e7eb;font-size:7.5pt}.evaluation-results{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #000}.identity-cell,.evaluation-cell{min-height:29px;padding:3px 4px;border-right:1px solid #000;border-bottom:1px solid #000;overflow-wrap:anywhere}.identity-cell:nth-child(3n),.evaluation-cell:nth-child(4n){border-right:0}.identity-cell:nth-last-child(-n+3),.evaluation-cell:nth-last-child(-n+4){border-bottom:0}.identity-cell>span,.evaluation-cell>span{display:block;font-size:7pt;text-transform:uppercase}.identity-cell>strong,.evaluation-cell>strong{display:block;font-size:8pt}.identity-sub-label{margin-top:2px}.scope-note{display:block;margin-top:3px;padding-top:2px;border-top:1px solid #000;font-size:6.5pt;font-weight:700}.proposal-box{display:block;margin:1px 0;padding:2px 3px;border:2px solid #000;background:#fff176!important;color:#000!important;font-weight:800;box-shadow:inset 0 0 0 1px #000;white-space:normal}.proposal-box .proposal-label{display:block;font-size:5.8pt;line-height:1;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.proposal-box strong{display:block;font-size:7.5pt;color:#000}.proposal-box-identity{margin-top:1px}.proposal-box-identity .identity-sub-label{display:block;margin-top:2px;font-size:5.8pt;text-transform:uppercase}.proposal-box-movement{margin-top:2px}.original-oh{display:block;font-size:8pt}.evaluation-photos{display:flex;gap:5px;margin-top:5px;flex-wrap:wrap}.evaluation-photos img{width:1.15in;height:.78in;object-fit:cover;border:1px solid #000}.section-title{margin:8px 0 3px;font-size:9pt;font-weight:700;text-transform:uppercase}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #000;padding:3px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}th{background:#e5e7eb;font-size:7pt;text-align:left}td{font-size:8pt;white-space:pre-line}.edited-cell{background:#fff176!important}' +
    '</style></head><body>' + pilotBanner + '<h1>GNC PH Reclass Item Inquiry</h1><div class="meta"><strong>Request:</strong> ' + esc(actionLabel) + ' &nbsp; <strong>Submitted:</strong> ' + esc(safeModel.submittedAt || '') + ' &nbsp; <strong>By:</strong> ' + esc(safeModel.actorDisplay || '') + ' &nbsp; <strong>Edited:</strong> ' + esc(editSummary.fieldCount || 0) + ' field(s) across ' + esc(editSummary.rowCount || 0) + ' row(s)</div><div class="proposal-legend"><span class="proposal-swatch">PROPOSED</span><span>Yellow, boxed values are proposals and remain visible on black-and-white printers. Report only; no inventory was changed.</span></div>' +
    '<div class="identity">' + identityCells + '</div>' + evidenceHtml + '<div class="section-title">Location / Lot Item Inquiry</div><table class="location-table"><colgroup>' + columnWidths + '</colgroup><thead><tr>' + rowHead + '</tr></thead><tbody>' + rowBody + '</tbody></table>' + supplementalTemporaryHtml + '</body></html>';
}

function getReclassInquiryCompactPilotRows_() {
  return [
    { unique_id: 'pilot-a01', itemcode: 'TEST.RECLASS.001', lotcode: '27.S1', locationcode: 'A.01.000', source: 'SH', priority: '4', ptronhand: '36', ptrreviewed: '2', locationnotedate: '', locationnote: '', holdstopcode: '', holdstopreason: '', season: 'S1' },
    { unique_id: 'pilot-d12', itemcode: 'TEST.RECLASS.001', lotcode: '26.U2', locationcode: 'D.12.000', source: 'LD', priority: '3', ptronhand: '26', ptrreviewed: '1', locationnotedate: '8/18/2026', locationnote: 'Synthetic unchanged row.', holdstopcode: 'S', holdstopreason: 'Synthetic stop', season: 'U2' },
    { unique_id: 'pilot-d17', itemcode: 'TEST.RECLASS.001', lotcode: '27.F1', locationcode: 'D.17.000', source: 'LD', priority: '', ptronhand: '92', ptrreviewed: '4', locationnotedate: '', locationnote: '', holdstopcode: '', holdstopreason: '', season: 'F1' },
    { unique_id: 'pilot-f14', itemcode: 'TEST.RECLASS.001', lotcode: '27.F1', locationcode: 'F.14.000', source: 'LD', priority: '3', ptronhand: '497', ptrreviewed: '12', locationnotedate: '8/20/2026', locationnote: 'Existing synthetic note', holdstopcode: 'H', holdstopreason: 'Synthetic hold', season: 'F1' }
  ];
}

function buildReclassInquiryCompactPilotOverlays_(action, rows) {
  const requestAction = String(action || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    const overlay = {
      unique_id: row.unique_id,
      expected: { itemcode: row.itemcode, lotcode: row.lotcode, locationcode: row.locationcode },
      values: {},
      actionValues: { included: false }
    };
    if (requestAction === 'hold' && row.unique_id === 'pilot-d17') {
      overlay.values = { holdstopcode: 'H', holdstopreason: 'Synthetic hold reason' };
      overlay.actionValues.included = true;
    } else if (requestAction === 'stop_ship' && row.unique_id === 'pilot-d17') {
      overlay.values = { holdstopcode: 'S', holdstopreason: 'Synthetic stop reason' };
      overlay.actionValues.included = true;
    } else if (requestAction === 'take_off_hold' && row.unique_id === 'pilot-f14') {
      overlay.values = { holdstopcode: '', holdstopreason: '' };
      overlay.actionValues.included = true;
    } else if (requestAction === 'off_stop_ship' && row.unique_id === 'pilot-d12') {
      overlay.values = { holdstopcode: '', holdstopreason: '' };
      overlay.actionValues.included = true;
    } else if (requestAction === 'priority_change' && row.unique_id === 'pilot-f14') {
      overlay.values = { priority: '' };
      overlay.actionValues.included = true;
    } else if (requestAction === 'priority_change' && row.unique_id === 'pilot-d17') {
      overlay.values = { priority: '1' };
      overlay.actionValues.included = true;
    } else if (requestAction === 'move_up' && row.unique_id === 'pilot-d12') {
      overlay.actionValues = { included: true, moveQuantity: 20, destinationSeason: 'F1' };
    } else if (requestAction === 'move_down' && row.unique_id === 'pilot-a01') {
      overlay.actionValues = { included: true, moveQuantity: 15, destinationSeason: 'U2' };
    }
    return overlay;
  });
}

function buildReclassInquiryCompactPilotModel_(action, now) {
  const submittedAt = Utilities.formatDate(now, 'America/Chicago', 'M/d/yyyy, h:mm:ss a');
  const requestAction = String(action || '').trim().toLowerCase();
  const rule = getReclassInquiryActionRuleV2_(requestAction);
  if (!rule) throw new Error('The synthetic pilot action is not supported.');
  const authoritativeRows = getReclassInquiryCompactPilotRows_();
  const overlays = buildReclassInquiryCompactPilotOverlays_(requestAction, authoritativeRows);
  const proposal = buildReclassInquiryActionRowsV2_(requestAction, authoritativeRows, overlays);
  if (!proposal.ok) throw new Error(proposal.message || 'The synthetic pilot rows could not be validated.');
  const normalizedRows = proposal.rows.map(function(row) {
    const normalizedRow = Object.assign({}, row);
    normalizedRow.values = Object.assign({}, row.values || {});
    normalizedRow.values.holdstopreason = String(normalizedRow.values.holdstopreason || '').trim().toLowerCase();
    return normalizedRow;
  });
  const originRow = normalizedRows.find(function(row) { return row && row.included; }) || normalizedRows[0];
  const editedRows = normalizedRows.filter(function(row) { return row.changedFields.length; });
  return {
    isSyntheticPilot: true,
    requestAction: requestAction,
    requestActionLabel: getReclassInquiryActionLabel_(requestAction),
    actorDisplay: 'GNC Apps Script Pilot',
    submittedAt: submittedAt,
    identity: {
      plantgroupcode: 'TEST_GROUP',
      commonname: 'Synthetic Reclass Pilot Item',
      contsize: '#5 TEST',
      itemcode: 'TEST.RECLASS.001',
      genusname: 'Testus',
      fieldtagcolor: 'TEST',
      itemspec: 'Synthetic data',
      pullerresponsibility: 'Pilot only',
      holdstopcode: String(originRow && originRow.values && originRow.values.holdstopcode || '').trim().toUpperCase()
    },
    identityChangedFields: originRow && originRow.changedFields.indexOf('holdstopcode') !== -1 ? ['holdstopcode'] : [],
    rows: normalizedRows,
    editSummary: {
      rowCount: editedRows.length,
      fieldCount: editedRows.reduce(function(total, row) { return total + row.changedFields.length; }, 0)
    }
  };
}

function buildReclassInquiryCompactPilotText_(model) {
  const safeModel = model || {};
  const editSummary = safeModel.editSummary || {};
  return [
    'TEST PILOT - SYNTHETIC DATA ONLY',
    'GNC PH Reclass Item Inquiry',
    'Request: ' + String(safeModel.requestActionLabel || ''),
    'Item: ' + String(safeModel.identity && safeModel.identity.commonname || ''),
    'Edited Rows: ' + String(editSummary.rowCount || 0),
    'Edited Fields: ' + String(editSummary.fieldCount || 0),
    '',
    'Open the attached compact PDF to review the pilot format. No production or customer data is included.'
  ].join('\n');
}

function buildReclassInquiryCompactPilotEmailHtml_(model) {
  const safeModel = model || {};
  const editSummary = safeModel.editSummary || {};
  return buildPhoneSizedEmailHtml_([
    '<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2937;">',
    '<div style="margin-bottom:14px;padding:10px 12px;border:2px solid #b91c1c;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:700;text-align:center;">TEST PILOT - SYNTHETIC DATA ONLY</div>',
    '<h2 style="margin:0 0 14px;color:#007a4d;">GNC PH Reclass Item Inquiry</h2>',
    '<p><strong>Request:</strong> ' + escapeEmailHtml_(safeModel.requestActionLabel || '') + '<br><strong>Item:</strong> ' + escapeEmailHtml_(safeModel.identity && safeModel.identity.commonname || '') + '</p>',
    '<p><strong>Edited Rows:</strong> ' + escapeEmailHtml_(editSummary.rowCount || 0) + '<br><strong>Edited Fields:</strong> ' + escapeEmailHtml_(editSummary.fieldCount || 0) + '</p>',
    '<p style="padding:12px 14px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;"><strong>Compact PDF attached:</strong> Open the synthetic Item Inquiry PDF to review the action-specific pilot layout. Proposed cells are highlighted yellow.</p>',
    '<p style="font-size:12px;color:#64748b;">No production inventory, request, customer, or photo data was read or changed.</p>',
    '</div>'
  ].join(''));
}

function getReclassInquiryCacheKey_(token) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token || ''), Utilities.Charset.UTF_8);
  return 'reclass_inquiry_' + bytes.map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 40);
}

function getReclassInquiryEventKey_(token) {
  return 'reclass-inquiry:' + getReclassInquiryCacheKey_(token).replace(/^reclass_inquiry_/, '');
}

function getReclassInquiryOutboxStatus_(row) {
  const source = row && typeof row === 'object' ? row : {};
  const status = String(source.status || 'queued').trim().toLowerCase();
  const code = String(source.sanitized_error_code || '').trim().toUpperCase();
  if (status === 'failed' && (code === 'RECLASS_CONFLICT' || code === 'RECLASS_VALIDATION')) return 'conflict';
  if (status === 'pending') return 'queued';
  if (status === 'unknown') return 'failed';
  return ['processing', 'delivered', 'failed'].indexOf(status) !== -1 ? status : 'queued';
}

function buildReclassInquiryOutboxResponse_(row, duplicate) {
  const source = row && typeof row === 'object' ? row : {};
  const status = getReclassInquiryOutboxStatus_(source);
  const code = String(source.sanitized_error_code || '').trim().toUpperCase();
  return {
    ok: status === 'queued' || status === 'processing' || status === 'delivered',
    status: status,
    jobId: String(source.event_id || ''),
    queuedAt: String(source.created_at || ''),
    deliveredAt: String(source.delivered_at || source.email_delivered_at || ''),
    attemptCount: Math.max(0, Number(source.attempt_count) || 0),
    errorCode: code || '',
    duplicate: duplicate === true,
    message: status === 'delivered' ? 'Reclass Item Inquiry email delivered.'
      : status === 'conflict' ? 'Inventory changed before delivery. Reopen the draft against current inventory.'
      : status === 'failed' ? 'Background delivery needs attention. Your draft is still available.'
      : status === 'processing' ? 'Reclass Item Inquiry is being sent in the background.'
      : 'Reclass Item Inquiry queued for background delivery.'
  };
}

function getReclassInquiryOutboxRow_(token) {
  const safeToken = normalizeInventoryTransactionText_(token);
  if (!safeToken || safeToken.length < 12 || safeToken.length > 180) throw new Error('The Reclass inquiry idempotency token is invalid.');
  const rows = requestDeliveryRest_(
    'ph_request_delivery_outbox',
    'GET',
    'select=event_id,event_key,event_type,status,attempt_count,next_attempt_at,sanitized_error_code,email_delivered_at,delivered_at,created_at,updated_at&event_key=eq.' + encodeURIComponent(getReclassInquiryEventKey_(safeToken)) + '&event_type=eq.' + encodeURIComponent(RECLASS_DELIVERY_EVENT_TYPE_) + '&limit=1',
    null
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function handleReclassInquiryStatus_(payload) {
  const token = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(payload && payload.idempotencyToken, payload && payload.idempotency_token));
  const row = getReclassInquiryOutboxRow_(token);
  if (!row) return { ok: false, status: 'missing', message: 'This background inquiry was not found.' };
  return buildReclassInquiryOutboxResponse_(row, true);
}

function handleReclassInquiryRetry_(payload) {
  const token = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(payload && payload.idempotencyToken, payload && payload.idempotency_token));
  const row = getReclassInquiryOutboxRow_(token);
  if (!row) return { ok: false, status: 'missing', message: 'This background inquiry was not found.' };
  const normalizedStatus = getReclassInquiryOutboxStatus_(row);
  if (normalizedStatus === 'conflict') {
    return { ok: false, status: 'conflict', message: 'Inventory changed before delivery. Reopen the draft against current inventory.' };
  }
  if (normalizedStatus === 'delivered' || normalizedStatus === 'queued' || normalizedStatus === 'processing') {
    return buildReclassInquiryOutboxResponse_(row, true);
  }
  const updated = requestDeliveryRest_(
    'ph_request_delivery_outbox',
    'PATCH',
    'event_id=eq.' + encodeURIComponent(String(row.event_id || '')) + '&event_type=eq.' + encodeURIComponent(RECLASS_DELIVERY_EVENT_TYPE_) + '&status=in.(failed,unknown)',
    {
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
      sanitized_error_code: null,
      lease_token: null,
      lease_owner: null,
      lease_expires_at: null
    },
    'return=representation'
  );
  return buildReclassInquiryOutboxResponse_(Array.isArray(updated) && updated.length ? updated[0] : row, true);
}

function enqueueReclassInquiryEmail_(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const token = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(safePayload.idempotencyToken, safePayload.idempotency_token));
  if (!token || token.length < 12 || token.length > 180) throw new Error('The Reclass inquiry idempotency token is invalid.');
  const source = safePayload.source && typeof safePayload.source === 'object' ? safePayload.source : {};
  const sourceUid = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(source.unique_id, source.uniqueId));
  if (!sourceUid) throw new Error('Missing source inventory row id.');
  const policyVersion = normalizeInventoryTransactionText_(safePayload.workflowPolicyVersion);
  if (policyVersion !== RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION_ && policyVersion !== RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION_) {
    return { ok: false, status: 'conflict', message: 'The Reclass workflow was updated. Refresh the app and review the current rows.' };
  }
  const recipients = getReclassInquiryEmailRecipients_(safePayload);
  if (!recipients.length) throw new Error('Choose at least one email recipient.');
  safePayload.recipientEmails = recipients;
  safePayload.emailRecipients = recipients;
  const serialized = JSON.stringify(safePayload);
  if (serialized.length > 4 * 1024 * 1024) throw new Error('This Reclass inquiry is too large to queue. Reduce the row selection and try again.');
  const existing = getReclassInquiryOutboxRow_(token);
  if (existing) return buildReclassInquiryOutboxResponse_(existing, true);
  const inserted = requestDeliveryRest_(
    'ph_request_delivery_outbox',
    'POST',
    'on_conflict=event_key',
    {
      event_key: getReclassInquiryEventKey_(token),
      event_type: RECLASS_DELIVERY_EVENT_TYPE_,
      request_id: null,
      request_folder: null,
      payload: { reclassPayload: safePayload },
      status: 'pending',
      next_attempt_at: new Date().toISOString()
    },
    'resolution=ignore-duplicates,return=representation'
  );
  const row = Array.isArray(inserted) && inserted.length ? inserted[0] : getReclassInquiryOutboxRow_(token);
  if (!row) throw new Error('The Reclass inquiry could not be queued. Retry with the same draft.');
  return buildReclassInquiryOutboxResponse_(row, false);
}

function deliverReclassInquiryPayload_(payload, messageIdHeader) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const source = safePayload.source && typeof safePayload.source === 'object' ? safePayload.source : {};
    const sourceUid = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(source.unique_id, source.uniqueId));
    if (!sourceUid) throw new Error('RECLASS_VALIDATION:SOURCE_ID_REQUIRED');
    const sourceRow = fetchEmailApprovalMasterRow_(sourceUid);
    if (!sourceRow) throw new Error('RECLASS_CONFLICT:SOURCE_ROW_MISSING');
    try {
      validateInventoryTransactionSourceIdentity_(sourceRow, source);
    } catch (identityError) {
      throw new Error('RECLASS_CONFLICT:SOURCE_ROW_CHANGED');
    }
    const authoritativeRows = fetchReclassInquiryItemRows_(sourceRow);
    const now = new Date();
    const transaction = safePayload.transaction && typeof safePayload.transaction === 'object' ? safePayload.transaction : {};
    const requestAction = String(firstNonEmptyRequestValue_(transaction.requestAction, transaction.request_action, '') || '').trim().toLowerCase();
    const policyVersion = normalizeInventoryTransactionText_(safePayload.workflowPolicyVersion);
    const isV3 = RECLASS_ACTION_WORKFLOW_V3_ENABLED_ && policyVersion === RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION_;
    const isV2 = RECLASS_ACTION_WORKFLOW_V2_ENABLED_ && policyVersion === RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION_;
    if (!isV3 && !isV2) {
      throw new Error('RECLASS_CONFLICT:WORKFLOW_POLICY_CHANGED');
    }
    if (isV2) {
      if (!getReclassInquiryActionRuleV2_(requestAction)) {
        throw new Error('RECLASS_VALIDATION:ACTION_REQUIRED');
      }
    }
    const authoritativeScope = isV3 && hasReclassInquiryHoldProposalV3_(transaction, safePayload.rowOverlays)
      ? fetchReclassInquiryScopeSettingsV3_()
      : null;
    let overlayResult;
    try {
      overlayResult = isV3
        ? buildReclassInquiryActionRowsV3_(transaction, authoritativeRows, safePayload.rowOverlays, authoritativeScope)
        : buildReclassInquiryActionRowsV2_(requestAction, authoritativeRows, safePayload.rowOverlays);
    } catch (validationError) {
      throw new Error('RECLASS_VALIDATION:' + String(validationError && validationError.message || 'PROPOSAL_INVALID'));
    }
    if (!overlayResult.ok) throw new Error('RECLASS_CONFLICT:' + String(overlayResult.message || 'ROW_IDENTITY_CHANGED'));
    const reportPayload = isV3 ? Object.assign({}, safePayload, {
      transaction: Object.assign({}, transaction, {
        requestActions: overlayResult.requestActions,
        holdStopProposals: overlayResult.holdStopProposals || [],
        scope: overlayResult.scope || {}
      })
    }) : safePayload;
    const model = buildReclassInquiryReportModel_(sourceRow, authoritativeRows, overlayResult.rows, reportPayload, now);
    const recipients = getReclassInquiryEmailRecipients_(safePayload);
    if (!recipients.length) throw new Error('RECLASS_VALIDATION:RECIPIENT_REQUIRED');
    const commonName = String(model.identity.commonname || 'Inventory').replace(/\s+/g, ' ').trim();
    const subject = '[External] GNC PH Reclass - ' + model.requestActionLabel + ': ' + commonName;
    let pdfBlob;
    try {
      const printHtml = buildReclassInquiryCompactReportHtml_(model, true);
      pdfBlob = HtmlService.createHtmlOutput(printHtml).getBlob().getAs(MimeType.PDF);
      const safeName = commonName.replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Item';
      const safeAction = model.requestActionLabel.replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'Request';
      pdfBlob.setName('GNC_PH_Reclass_' + safeAction + '_' + safeName + '.pdf');
    } catch (pdfError) {
      throw new Error('RECLASS_PDF_BUILD_FAILED');
    }
    if (!isGmailAdvancedServiceAvailable_()) throw new Error('RECLASS_GMAIL_SERVICE_UNAVAILABLE');
    try {
      const result = sendGmailApiMessage_({
        toList: recipients.join(','),
        toArray: recipients,
        subject: subject,
        textBody: buildReclassInquiryReportText_(model),
        htmlBody: buildReclassInquiryEmailHtml_(model),
        attachments: [pdfBlob],
        fromName: 'GNC PH Reclass',
        fromAddress: resolveAutomatedEmailSenderAddress_(),
        messageIdHeader: String(messageIdHeader || '').trim()
      });
      result.subject = subject;
      result.submittedAt = now.toISOString();
      result.policyVersion = isV3 ? RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION_ : RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION_;
      result.message = model.requestActionLabel + ' Item Inquiry PDF delivered. Proposed cells are highlighted yellow; no inventory data was changed.';
      return result;
    } catch (emailError) {
      if (/^RECLASS_/.test(String(emailError && emailError.message || ''))) throw emailError;
      throw new Error('RECLASS_EMAIL_SEND_FAILED');
    }
}

function handleReclassInquiryEmail_(payload) {
  if (RECLASS_BACKGROUND_DELIVERY_ENABLED_) return enqueueReclassInquiryEmail_(payload);
  throw new Error('The legacy synchronous Reclass delivery path is disabled. Refresh the app and try again.');
}

function handleInventoryTransaction_(payload) {
  if (normalizeInventoryTransactionAction_(payload && payload.action) === 'reclass') {
    const compatibilityPayload = Object.assign({}, payload || {}, {
      type: 'reclass_inquiry_email',
      idempotencyToken: firstNonEmptyRequestValue_(
        payload && payload.idempotencyToken,
        payload && payload.idempotency_token,
        payload && payload.clientTransactionId,
        payload && payload.client_transaction_id
      ),
      rowOverlays: payload && (payload.rowOverlays || payload.row_overlays)
    });
    return handleReclassInquiryEmail_(compatibilityPayload);
  }
  const lock = LockService.getScriptLock();
  let lockReleased = false;
  if (!lock.tryLock(15000)) {
    return {
      ok: false,
      status: 'lock_timeout',
      message: 'Inventory is busy finishing another update. Please try again in a few seconds.'
    };
  }
  try {
    const action = normalizeInventoryTransactionAction_(payload && payload.action);
    const source = payload && typeof payload.source === 'object' ? payload.source : {};
    const transaction = payload && typeof payload.transaction === 'object' ? payload.transaction : {};
    const sourceUid = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(source.unique_id, source.uniqueId, payload && payload.unique_id, payload && payload.uniqueId));
    if (!sourceUid) throw new Error('Missing source inventory row id.');
    const sourceRow = fetchEmailApprovalMasterRow_(sourceUid);
    if (!sourceRow) throw new Error('Source inventory row was not found. Sync and try again.');
    validateInventoryTransactionSourceIdentity_(sourceRow, source);
    validateInventoryTransactionHoldScopeRequest_(sourceRow, transaction);

    const actor = payload && typeof payload.actor === 'object' ? payload.actor : {};
    const actorUsername = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(actor.username, actor.user, payload && payload.actorUsername, 'unknown'));
    const actorDisplay = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(actor.display, actor.displayName, actorUsername, 'Unknown User'));
    const actorEmail = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(actor.email, actor.userEmail, ''));
    const transactionId = Utilities.getUuid();
    const nowIso = new Date().toISOString();
    const sourceBefore = cloneInventoryTransactionRowForAudit_(sourceRow);
    let destinationRow = null;
    let destinationWasCreated = false;
    let destinationBefore = null;
    let sourceAfter = null;
    let destinationAfter = null;
    let holdScopeResult = { action: 'none', count: 0, rows: [] };
    let auditWarning = null;

    if (action === 'qty') {
      const newQty = parseInventoryTransactionNumber_(firstNonEmptyRequestValue_(transaction.newQuantity, transaction.new_quantity, transaction.quantity), 'New quantity', { disallowNegative: true });
      sourceAfter = patchEmailApprovalMasterRow_(sourceUid, buildInventoryTransactionPatch_({
        ptronhand: newQty,
        ptrreviewed: newQty,
        ptravailable: newQty
      }), getInventoryTransactionRowTable_(sourceRow));
    } else {
      const qty = parseInventoryTransactionNumber_(transaction.quantity, 'Quantity to move', { requirePositive: true });
      destinationRow = fetchInventoryTransactionDestinationRow_(sourceRow, transaction, action);
      destinationWasCreated = Boolean(destinationRow && destinationRow.__inventory_transaction_created);
      const destinationUid = getInventoryTransactionRowUid_(destinationRow);
      if (!destinationUid) throw new Error('Destination row is missing a unique id.');
      if (destinationUid === sourceUid) throw new Error('Destination row must be different from the source row.');
      destinationBefore = destinationWasCreated ? null : cloneInventoryTransactionRowForAudit_(destinationRow);
      const sourceOnHand = getInventoryTransactionRowNumber_(sourceRow, ['ptronhand', 'PTRONHAND']);
      const sourceAvailable = getInventoryTransactionRowNumber_(sourceRow, ['ptravailable', 'PTRAVAILABLE']);
      const destinationOnHand = getInventoryTransactionRowNumber_(destinationRow, ['ptronhand', 'PTRONHAND']);
      const destinationAvailable = getInventoryTransactionRowNumber_(destinationRow, ['ptravailable', 'PTRAVAILABLE']);
      let sourcePatched = false;
      try {
        sourceAfter = patchEmailApprovalMasterRow_(sourceUid, buildInventoryTransactionPatch_({
          ptronhand: sourceOnHand - qty,
          ptravailable: sourceAvailable - qty
        }), getInventoryTransactionRowTable_(sourceRow));
        sourcePatched = true;
        destinationAfter = patchEmailApprovalMasterRow_(destinationUid, buildInventoryTransactionPatch_({
          ptronhand: destinationOnHand + qty,
          ptravailable: destinationAvailable + qty
        }), getInventoryTransactionRowTable_(destinationRow));
      } catch (updateError) {
        if (sourcePatched) {
          try {
            patchEmailApprovalMasterRow_(sourceUid, buildInventoryTransactionPatch_({
              ptronhand: sourceOnHand,
              ptravailable: sourceAvailable
            }), getInventoryTransactionRowTable_(sourceRow));
          } catch (rollbackError) {
            console.warn('Inventory transaction rollback failed: ' + (rollbackError && rollbackError.message ? rollbackError.message : rollbackError));
          }
        }
        if (destinationWasCreated) {
          try {
            deleteInventoryTransactionCreatedRow_(destinationRow);
          } catch (createdRollbackError) {
            console.warn('Inventory transaction created destination rollback failed: ' + (createdRollbackError && createdRollbackError.message ? createdRollbackError.message : createdRollbackError));
          }
        }
        throw updateError;
      }
    }

    try {
      holdScopeResult = patchInventoryTransactionHoldScope_(sourceRow, transaction);
    } catch (holdUpdateError) {
      try {
        if (action === 'qty') {
          patchEmailApprovalMasterRow_(sourceUid, buildInventoryTransactionPatch_({
            ptronhand: getInventoryTransactionRowNumber_(sourceBefore, ['ptronhand', 'PTRONHAND']),
            ptrreviewed: getInventoryTransactionRowNumber_(sourceBefore, ['ptrreviewed', 'PTRREVIEWED']),
            ptravailable: getInventoryTransactionRowNumber_(sourceBefore, ['ptravailable', 'PTRAVAILABLE'])
          }), getInventoryTransactionRowTable_(sourceRow));
        } else {
          patchEmailApprovalMasterRow_(sourceUid, buildInventoryTransactionPatch_({
            ptronhand: getInventoryTransactionRowNumber_(sourceBefore, ['ptronhand', 'PTRONHAND']),
            ptravailable: getInventoryTransactionRowNumber_(sourceBefore, ['ptravailable', 'PTRAVAILABLE'])
          }), getInventoryTransactionRowTable_(sourceRow));
          if (destinationWasCreated && destinationRow) {
            deleteInventoryTransactionCreatedRow_(destinationRow);
          } else if (destinationRow && destinationBefore) {
            patchEmailApprovalMasterRow_(getInventoryTransactionRowUid_(destinationRow), buildInventoryTransactionPatch_({
              ptronhand: getInventoryTransactionRowNumber_(destinationBefore, ['ptronhand', 'PTRONHAND']),
              ptravailable: getInventoryTransactionRowNumber_(destinationBefore, ['ptravailable', 'PTRAVAILABLE'])
            }), getInventoryTransactionRowTable_(destinationRow));
          }
        }
      } catch (holdRollbackError) {
        console.warn('Inventory transaction hold rollback failed: ' + (holdRollbackError && holdRollbackError.message ? holdRollbackError.message : holdRollbackError));
      }
      throw holdUpdateError;
    }
    if (holdScopeResult && Array.isArray(holdScopeResult.rows) && holdScopeResult.rows.length) {
      const updatedSource = getInventoryTransactionReturnedRowByUid_(holdScopeResult.rows, sourceUid);
      if (updatedSource) sourceAfter = updatedSource;
      if (destinationAfter) {
        const updatedDestination = getInventoryTransactionReturnedRowByUid_(holdScopeResult.rows, getInventoryTransactionRowUid_(destinationAfter));
        if (updatedDestination) destinationAfter = updatedDestination;
      }
    }

    const sourceAfterAudit = cloneInventoryTransactionRowForAudit_(sourceAfter || sourceRow);
    const destinationAfterAudit = destinationAfter ? cloneInventoryTransactionRowForAudit_(destinationAfter) : null;
    const quantity = action === 'qty'
      ? parseInventoryTransactionNumber_(firstNonEmptyRequestValue_(transaction.newQuantity, transaction.new_quantity, transaction.quantity), 'New quantity', { disallowNegative: true })
      : parseInventoryTransactionNumber_(transaction.quantity, 'Quantity to move', { requirePositive: true });
    const auditResult = insertInventoryTransactionAudit_({
      unique_id: transactionId,
      created_at: nowIso,
      action: action,
      actor_username: actorUsername,
      actor_display: actorDisplay,
      actor_email: actorEmail,
      source_table: getInventoryTransactionRowTable_(sourceRow),
      source_unique_id: sourceUid,
      destination_table: destinationRow ? getInventoryTransactionRowTable_(destinationRow) : '',
      destination_unique_id: destinationRow ? getInventoryTransactionRowUid_(destinationRow) : '',
      source_itemcode: getInventoryTransactionRowValue_(sourceRow, ['itemcode', 'ITEMCODE'], ''),
      source_lotcode: getInventoryTransactionRowValue_(sourceRow, ['lotcode', 'LOTCODE'], ''),
      source_locationcode: getInventoryTransactionRowValue_(sourceRow, ['locationcode', 'LOCATIONCODE'], ''),
      destination_itemcode: destinationRow ? getInventoryTransactionRowValue_(destinationRow, ['itemcode', 'ITEMCODE'], '') : '',
      destination_lotcode: destinationRow ? getInventoryTransactionRowValue_(destinationRow, ['lotcode', 'LOTCODE'], '') : '',
      destination_locationcode: destinationRow ? getInventoryTransactionRowValue_(destinationRow, ['locationcode', 'LOCATIONCODE'], '') : '',
      quantity: quantity,
      source_before: sourceBefore,
      source_after: sourceAfterAudit,
      destination_before: destinationBefore,
      destination_after: destinationAfterAudit,
      raw_payload: payload || {},
      status: 'applied'
    });
    if (!auditResult.ok) {
      auditWarning = auditResult.message || ('Audit insert failed (' + auditResult.status + ')');
      console.warn('Inventory transaction audit warning: ' + auditWarning);
    }

    const rowIds = [sourceUid];
    if (destinationAfter) rowIds.push(getInventoryTransactionRowUid_(destinationAfter));
    (holdScopeResult && Array.isArray(holdScopeResult.rows) ? holdScopeResult.rows : []).forEach(function(row) {
      const uid = getInventoryTransactionRowUid_(row);
      if (uid && rowIds.indexOf(uid) === -1) rowIds.push(uid);
    });
    emitAppLiveEvent_('inventory', 'inventory_transaction_' + action, getInventoryTransactionRowTable_(sourceRow), rowIds, {
      transaction_id: transactionId,
      action: action,
      quantity: quantity,
      source_unique_id: sourceUid,
      destination_unique_id: destinationAfter ? getInventoryTransactionRowUid_(destinationAfter) : '',
      source_row: sourceAfter || null,
      destination_row: destinationAfter || null,
      hold_scope: holdScopeResult && holdScopeResult.action !== 'none' ? {
        action: holdScopeResult.action,
        count: holdScopeResult.count,
        itemcode: holdScopeResult.itemCode,
        season: holdScopeResult.season,
        saleyear: holdScopeResult.salesYear
      } : null,
      hold_rows: holdScopeResult && Array.isArray(holdScopeResult.rows) ? holdScopeResult.rows : []
    });

    try {
      lock.releaseLock();
      lockReleased = true;
    } catch (releaseError) {
      console.warn('Inventory transaction lock release before email failed: ' + (releaseError && releaseError.message ? releaseError.message : releaseError));
    }

    let emailResult = null;
    let emailWarning = null;
    try {
      emailResult = sendInventoryTransactionEmail_(payload, {
        action: action,
        transaction: transaction,
        transactionId: transactionId,
        nowIso: nowIso,
        actorUsername: actorUsername,
        actorDisplay: actorDisplay,
        actorEmail: actorEmail,
        sourceBefore: sourceBefore,
        sourceRow: sourceAfter || sourceRow,
        destinationBefore: destinationBefore,
        destinationRow: destinationAfter || destinationRow,
        holdScope: holdScopeResult,
        quantity: quantity
      });
      if (emailResult && emailResult.ok === false) {
        emailWarning = emailResult.message || 'Inventory transaction email was not sent.';
      }
    } catch (emailError) {
      emailWarning = emailError && emailError.message ? emailError.message : String(emailError || 'Inventory transaction email failed.');
      console.warn('Inventory transaction email warning: ' + emailWarning);
    }

    return {
      ok: true,
      status: 'success',
      action: action,
      transactionId: transactionId,
      sourceRow: sourceAfter || null,
      destinationRow: destinationAfter || null,
      holdRows: holdScopeResult && Array.isArray(holdScopeResult.rows) ? holdScopeResult.rows : [],
      holdScope: holdScopeResult && holdScopeResult.action !== 'none' ? {
        action: holdScopeResult.action,
        count: holdScopeResult.count,
        itemCode: holdScopeResult.itemCode,
        season: holdScopeResult.season,
        salesYear: holdScopeResult.salesYear
      } : { action: 'none', count: 0 },
      auditWarning: auditWarning,
      emailWarning: emailWarning,
      emailRecipients: emailResult && emailResult.recipients ? emailResult.recipients : [],
      message: action === 'qty' ? 'Quantity updated.' : (action === 'transfer' ? 'Transfer applied.' : 'Reclass applied.')
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      message: error && error.message ? error.message : String(error || 'Inventory transaction failed.')
    };
  } finally {
    if (!lockReleased) {
      try { lock.releaseLock(); } catch (error) {}
    }
  }
}

function getEmailApprovalRowValue_(row, fields, fallback) {
  const safeFields = Array.isArray(fields) ? fields : [];
  for (let i = 0; i < safeFields.length; i++) {
    const value = row && row[safeFields[i]];
    if (String(value == null ? '' : value).trim() !== '') return value;
  }
  return fallback == null ? '' : fallback;
}

function getEmailApprovalRequesterEmail_(row) {
  const directEmail = normalizeEmailAddress_(getEmailApprovalRowValue_(row, [
    'ncr_requested_by_email',
    'NCR_REQUESTED_BY_EMAIL',
    'requested_by_email',
    'REQUESTED_BY_EMAIL',
    'completed_by_email',
    'COMPLETED_BY_EMAIL'
  ], ''));
  if (directEmail) return directEmail;
  const username = String(getEmailApprovalRowValue_(row, [
    'ncr_requested_by_username',
    'NCR_REQUESTED_BY_USERNAME',
    'requested_by_username',
    'REQUESTED_BY_USERNAME',
    'completed_by_username',
    'COMPLETED_BY_USERNAME'
  ], '') || '').trim().toLowerCase();
  return normalizeEmailAddress_(EMAIL_APPROVAL_USER_EMAILS_[username] || '');
}

function getEmailApprovalRequesterDisplay_(row) {
  return String(getEmailApprovalRowValue_(row, [
    'ncr_requested_by_display',
    'NCR_REQUESTED_BY_DISPLAY',
    'requested_by_display',
    'REQUESTED_BY_DISPLAY',
    'completed_by_display',
    'COMPLETED_BY_DISPLAY',
    'ncr_requested_by_username',
    'NCR_REQUESTED_BY_USERNAME'
  ], 'Unknown') || 'Unknown').trim();
}

function getEmailApprovalQtyFromRow_(row, type, overrideQty) {
  const direct = String(overrideQty == null ? '' : overrideQty).trim();
  if (direct) return direct;
  const normalized = normalizeEmailApprovalType_(type);
  if (normalized === 'move-up') {
    return String(getEmailApprovalRowValue_(row, ['move_up_qty', 'MOVE_UP_QTY', 'loc_match_qty', 'LOC_MATCH_QTY'], '') || '').trim();
  }
  if (normalized === 'move-down') {
    return String(getEmailApprovalRowValue_(row, ['move_down_qty', 'MOVE_DOWN_QTY', 'loc_match_qty', 'LOC_MATCH_QTY'], '') || '').trim();
  }
  if (normalized === 'recount') {
    return String(getEmailApprovalRowValue_(row, ['recount_qty', 'RECOUNT_QTY', 'loc_match_qty', 'LOC_MATCH_QTY'], '') || '').trim();
  }
  return String(getEmailApprovalRowValue_(row, ['ncr_qty', 'NCR_QTY', 'loc_match_qty', 'LOC_MATCH_QTY'], '') || '').trim();
}

function buildEmailApprovalPayloadItemFromRow_(row, type, approvedQty) {
  const normalizedType = normalizeEmailApprovalType_(type);
  const qty = getEmailApprovalQtyFromRow_(row, normalizedType, approvedQty);
  const actionLabel = getEmailApprovalTypeLabel_(normalizedType);
  const uid = String(getEmailApprovalRowValue_(row, ['unique_id', 'UNIQUE_ID'], '') || '').trim();
  const photoCsv = String(getEmailApprovalRowValue_(row, [
    'photo_link',
    'PHOTO_LINK',
    'dock_photo_link',
    'DOCK_PHOTO_LINK',
    'row_photo_link',
    'ROW_PHOTO_LINK',
    'saved_photo_link',
    'SAVED_PHOTO_LINK'
  ], '') || '').trim();
  const item = {
    unique_id: uid,
    UNIQUE_ID: uid,
    SOURCE_UNIQUE_ID: uid,
    source_unique_id: uid,
    commonname: getEmailApprovalRowValue_(row, ['commonname', 'COMMONNAME'], 'Unknown Item'),
    COMMONNAME: getEmailApprovalRowValue_(row, ['commonname', 'COMMONNAME'], 'Unknown Item'),
    contsize: getEmailApprovalRowValue_(row, ['contsize', 'CONTSIZE'], ''),
    CONTSIZE: getEmailApprovalRowValue_(row, ['contsize', 'CONTSIZE'], ''),
    itemcode: getEmailApprovalRowValue_(row, ['itemcode', 'ITEMCODE'], ''),
    ITEMCODE: getEmailApprovalRowValue_(row, ['itemcode', 'ITEMCODE'], ''),
    genus: getEmailApprovalRowValue_(row, ['genusname', 'GENUSNAME', 'genus', 'GENUS'], ''),
    GENUS: getEmailApprovalRowValue_(row, ['genusname', 'GENUSNAME', 'genus', 'GENUS'], ''),
    salesnote: getEmailApprovalRowValue_(row, ['salesnote', 'SALESNOTE', 'sales_note', 'SALES_NOTE'], ''),
    SALESNOTE: getEmailApprovalRowValue_(row, ['salesnote', 'SALESNOTE', 'sales_note', 'SALES_NOTE'], ''),
    holdstopcode: getEmailApprovalRowValue_(row, ['holdstopcode', 'HOLDSTOPCODE', 'holstopcode', 'HOLSTOPCODE'], ''),
    HOLDSTOPCODE: getEmailApprovalRowValue_(row, ['holdstopcode', 'HOLDSTOPCODE', 'holstopcode', 'HOLSTOPCODE'], ''),
    holdstopreason: getEmailApprovalRowValue_(row, ['holdstopreason', 'HOLDSTOPREASON'], ''),
    HOLDSTOPREASON: getEmailApprovalRowValue_(row, ['holdstopreason', 'HOLDSTOPREASON'], ''),
    ROW: getEmailApprovalRowValue_(row, ['row', 'ROW', 'row_index', 'ROW_INDEX'], ''),
    lotcode: getEmailApprovalRowValue_(row, ['lotcode', 'LOTCODE'], ''),
    LOTCODE: getEmailApprovalRowValue_(row, ['lotcode', 'LOTCODE'], ''),
    locationcode: getEmailApprovalRowValue_(row, ['locationcode', 'LOCATIONCODE'], ''),
    LOCATIONCODE: getEmailApprovalRowValue_(row, ['locationcode', 'LOCATIONCODE'], ''),
    source: getEmailApprovalRowValue_(row, ['source', 'SOURCE', 'sourcecode', 'SOURCECODE'], ''),
    SOURCE: getEmailApprovalRowValue_(row, ['source', 'SOURCE', 'sourcecode', 'SOURCECODE'], ''),
    desigcust: getEmailApprovalRowValue_(row, ['desigcust', 'DESIGCUST'], ''),
    DESIGCUST: getEmailApprovalRowValue_(row, ['desigcust', 'DESIGCUST'], ''),
    priority: getEmailApprovalRowValue_(row, ['priority', 'PRIORITY'], ''),
    PRIORITY: getEmailApprovalRowValue_(row, ['priority', 'PRIORITY'], ''),
    ptronhand: getEmailApprovalRowValue_(row, ['ptronhand', 'PTRONHAND'], ''),
    PTRONHAND: getEmailApprovalRowValue_(row, ['ptronhand', 'PTRONHAND'], ''),
    ptrreviewed: getEmailApprovalRowValue_(row, ['ptrreviewed', 'PTRREVIEWED'], ''),
    PTRREVIEWED: getEmailApprovalRowValue_(row, ['ptrreviewed', 'PTRREVIEWED'], ''),
    ptravailable: getEmailApprovalRowValue_(row, ['ptravailable', 'PTRAVAILABLE'], ''),
    PTRAVAILABLE: getEmailApprovalRowValue_(row, ['ptravailable', 'PTRAVAILABLE'], ''),
    locationnotedate: getEmailApprovalRowValue_(row, ['locationnotedate', 'LOCATIONNOTEDATE'], ''),
    LOCATIONNOTEDATE: getEmailApprovalRowValue_(row, ['locationnotedate', 'LOCATIONNOTEDATE'], ''),
    locationnote: getEmailApprovalRowValue_(row, ['locationnote', 'LOCATIONNOTE'], ''),
    LOCATIONNOTE: getEmailApprovalRowValue_(row, ['locationnote', 'LOCATIONNOTE'], ''),
    locationptn1: getEmailApprovalRowValue_(row, ['locationptn1', 'LOCATIONPTN1'], ''),
    LOCATIONPTN1: getEmailApprovalRowValue_(row, ['locationptn1', 'LOCATIONPTN1'], ''),
    ACTION: actionLabel,
    action: actionLabel,
    APPROVAL_TYPE: normalizedType,
    approval_type: normalizedType,
    QTY: qty,
    qty: qty,
    NCR_QTY: normalizedType === 'new-crop' ? qty : '',
    ncr_qty: normalizedType === 'new-crop' ? qty : '',
    MOVE_UP_QTY: normalizedType === 'move-up' ? qty : '',
    move_up_qty: normalizedType === 'move-up' ? qty : '',
    MOVE_DOWN_QTY: normalizedType === 'move-down' ? qty : '',
    move_down_qty: normalizedType === 'move-down' ? qty : '',
    MOVE_DOWN_SEASON: getEmailApprovalRowValue_(row, ['move_down_season', 'MOVE_DOWN_SEASON'], ''),
    move_down_season: getEmailApprovalRowValue_(row, ['move_down_season', 'MOVE_DOWN_SEASON'], ''),
    LOC_MATCH_QTY: qty,
    loc_match_qty: qty,
    REQ_PHOTO_LINK: photoCsv,
    REQUEST_PHOTO_LINK: photoCsv,
    photo: photoCsv,
    photo_link: photoCsv,
    photo_urls: photoCsv,
    REQUESTED_BY_DISPLAY: getEmailApprovalRequesterDisplay_(row),
    requestedByDisplay: getEmailApprovalRequesterDisplay_(row),
    REQUESTED_BY_EMAIL: getEmailApprovalRequesterEmail_(row),
    requestedByEmail: getEmailApprovalRequesterEmail_(row)
  };
  return item;
}

function buildEmailApprovalPayload_(row, type, stage, options) {
  const safeOptions = options || {};
  const normalizedType = normalizeEmailApprovalType_(type);
  const normalizedStage = normalizeEmailApprovalStage_(stage);
  const typeLabel = getEmailApprovalTypeLabel_(normalizedType);
  const item = buildEmailApprovalPayloadItemFromRow_(row, normalizedType, safeOptions.approvedQty);
  const submittedBy = getEmailApprovalRequesterDisplay_(row);
  const requesterEmail = getEmailApprovalRequesterEmail_(row);
  const baseRecipients = normalizedStage === 'jd'
    ? [EMAIL_APPROVAL_USER_EMAILS_.jd_jones, EMAIL_APPROVAL_USER_EMAILS_.dylan_collyge, requesterEmail]
    : [EMAIL_APPROVAL_USER_EMAILS_.jd_jones, EMAIL_APPROVAL_USER_EMAILS_.dylan_collyge, requesterEmail].concat(safeOptions.extraRecipients || []);
  const recipientEmails = dedupeEmailAddresses_(baseRecipients);
  const rowLabel = [item.COMMONNAME, item.CONTSIZE, item.LOCATIONCODE].map(function(value) {
    return String(value || '').trim();
  }).filter(Boolean).join(' ');
  const taskLabel = normalizedType === 'hold-release' ? 'Off Hold Approval' : (normalizedType === 'move-up' ? 'Move Up Approvals' : (normalizedType === 'move-down' ? 'Move Down Approvals' : (normalizedType === 'recount' ? 'Re-Count Approval' : 'NCR Approvals')));
  const appInstruction = normalizedStage === 'jd'
    ? 'JD: open the confirmation link or the app Managers > ' + taskLabel + '. Review the photos/data, edit the quantity if needed, then approve.'
    : 'Final approved row is ready for keying.';
  const includeTablePhotos = normalizedStage === 'inventory';
  const payload = {
    type: 'email',
    emailType: 'ncr_approval',
    subject: (normalizedStage === 'jd' ? typeLabel + ' Approval' : typeLabel + ' Approved') + (rowLabel ? ': ' + rowLabel : ''),
    fromName: getEmailApprovalBrandLabel_(normalizedType),
    brandLabel: getEmailApprovalBrandLabel_(normalizedType),
    emailDisplayName: getEmailApprovalBrandLabel_(normalizedType),
    sourceLabel: getEmailApprovalBrandLabel_(normalizedType),
    folderId: 'ncr-approval-' + String(item.unique_id || ''),
    requestFolder: 'ncr-approval-' + String(item.unique_id || ''),
    customer: typeLabel,
    approvalType: normalizedType,
    approval_type: normalizedType,
    approvalLabel: typeLabel,
    approvalStage: normalizedStage,
    approvalStageLabel: normalizedStage === 'jd' ? 'JD approval needed' : 'Inventory Office handoff',
    completedBy: safeOptions.completedBy || (normalizedStage === 'jd' ? 'dylan_collyge' : 'jd_jones'),
    approvedBy: safeOptions.approvedBy || '',
    submittedBySummary: submittedBy,
    requestedByDisplay: submittedBy,
    requestedByEmail: requesterEmail,
    submittedAt: getEmailApprovalRowValue_(row, ['ncr_requested_at', 'NCR_REQUESTED_AT', 'created_at', 'updated_at'], ''),
    appInstruction: appInstruction,
    itemsCount: 1,
    internalRecipients: recipientEmails,
    recipientEmails: recipientEmails,
    emailRecipients: recipientEmails,
    recipients: recipientEmails.map(function(email) { return { email: email, role: 'internal' }; }),
    requestItems: [item],
    items: [item],
    sourceRows: [item],
    formattedItemsHtml: buildRequestEmailTableItemsHtml_({ requestItems: [item], folderId: 'ncr-approval-' + String(item.unique_id || '') }, { title: 'Selected ' + typeLabel + ' Rows', includePhotos: includeTablePhotos }),
    formattedItemsText: buildApprovalInquiryItemsText_({ requestItems: [item] }),
    useFormattedApprovalLayout: true,
    use_formatted_approval_layout: true,
    forceImmediate: true,
    queueJdApprovalEmail: false
  };
  return payload;
}

function parseEmailApprovalExtraRecipients_(value) {
  return dedupeEmailAddresses_(String(value || '')
    .split(/[\s,;]+/)
    .map(function(email) { return email.trim(); })
    .filter(Boolean));
}

function renderApprovalPageHtml_(title, bodyHtml) {
  return '<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
    'body{margin:0;background:#f7fbf9;color:#111827;font-family:Arial,Helvetica,sans-serif;}' +
    '.wrap{max-width:760px;margin:0 auto;padding:22px;}' +
    '.card{background:#fff;border:1px solid #b7f2d1;border-radius:18px;padding:20px;box-shadow:0 12px 30px rgba(15,23,42,.08);}' +
    'h1{margin:0 0 8px;color:#007a4d;font-size:28px;line-height:1.1;} h2{margin:0 0 16px;font-size:18px;}' +
    'p{font-size:15px;line-height:1.45;} .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0;}' +
    '.cell{border:1px solid #dbe5df;border-radius:12px;padding:10px;background:#f8fafc;}.label{display:block;color:#64748b;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.value{display:block;font-size:18px;font-weight:900;margin-top:4px;word-break:break-word}' +
    'input,textarea{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:12px;padding:11px 12px;font-size:16px;font-weight:700;}' +
    'label{display:block;margin:12px 0 6px;color:#334155;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;}' +
    '.btn{display:block;width:100%;box-sizing:border-box;margin-top:16px;border:0;border-radius:999px;background:#007a4d;color:#fff;padding:14px 18px;font-size:16px;font-weight:900;text-align:center;text-decoration:none;text-transform:uppercase;letter-spacing:.08em;}' +
    '.safe{margin-top:14px;color:#64748b;font-size:13px;}.bad{border-color:#fecaca;background:#fff1f2;color:#991b1b}.ok{border-color:#bbf7d0;background:#ecfdf5;color:#065f46}' +
    '@media(max-width:620px){.wrap{padding:14px}.card{padding:16px}.meta{grid-template-columns:1fr}h1{font-size:24px}}' +
    '</style><title>' + escapeEmailHtml_(title) + '</title></head><body><div class="wrap"><div class="card">' + bodyHtml + '</div></div></body></html>';
}

function renderApprovalStatusPage_(title, message, tone) {
  const className = tone === 'bad' ? 'cell bad' : 'cell ok';
  return HtmlService.createHtmlOutput(renderApprovalPageHtml_(title, [
    '<h1>GNC PH</h1>',
    '<h2>' + escapeEmailHtml_(title) + '</h2>',
    '<div class="' + className + '"><span class="value">' + escapeEmailHtml_(message) + '</span></div>',
    '<p class="safe">You can close this page and return to the app.</p>'
  ].join(''))).setTitle(title);
}

function renderApprovalConfirmWebApp_(params) {
  const valid = validateEmailApprovalParams_(params);
  if (!valid.ok) return renderApprovalStatusPage_('Approval Link', valid.message, 'bad');
  const row = fetchEmailApprovalMasterRow_(valid.uid);
  if (!row) return renderApprovalStatusPage_('Approval Link', 'This row could not be found. Open the app to review it.', 'bad');
  const assignment = String(getEmailApprovalRowValue_(row, ['app_tab_assignment', 'APP_TAB_ASSIGNMENT'], '') || '').trim();
  const currentStage = getEmailApprovalStageFromAssignment_(assignment);
  const currentType = getEmailApprovalTypeFromAssignment_(assignment) || valid.type;
  if (currentStage && currentStage !== valid.stage) {
    return renderApprovalStatusPage_('Already Processed', 'This row is already in the ' + currentStage + ' stage. No changes were made.', 'bad');
  }
  if (currentType && normalizeEmailApprovalType_(currentType) !== valid.type) {
    return renderApprovalStatusPage_('Approval Link', 'This approval link does not match the current row type. No changes were made.', 'bad');
  }
  const confirmed = String(params && params.confirm || '').trim() === '1';
  if (confirmed) {
    return handleEmailApprovalConfirm_(valid, row, params);
  }
  const item = buildEmailApprovalPayloadItemFromRow_(row, valid.type, '');
  const typeLabel = getEmailApprovalTypeLabel_(valid.type);
  const needsQty = valid.stage === 'jd' && valid.type !== 'hold-release';
  const defaultQty = getEmailApprovalQtyFromRow_(row, valid.type, '');
  const hidden = [
    ['view', 'approval'],
    ['uid', valid.uid],
    ['type', valid.type],
    ['stage', valid.stage],
    ['exp', valid.expiresAt],
    ['sig', valid.sig],
    ['confirm', '1']
  ].map(function(pair) {
    return '<input type="hidden" name="' + escapeEmailAttribute_(pair[0]) + '" value="' + escapeEmailAttribute_(pair[1]) + '">';
  }).join('');
  const qtyHtml = needsQty
    ? '<label for="approvedQty">Approved Qty</label><input id="approvedQty" name="approvedQty" inputmode="numeric" value="' + escapeEmailAttribute_(defaultQty) + '">'
    : '';
  const extraHtml = valid.stage === 'jd'
    ? '<label for="extraRecipients">Extra Recipients</label><textarea id="extraRecipients" name="extraRecipients" rows="3" placeholder="email@greenleafnursery.com, another@greenleafnursery.com"></textarea>'
    : '';
  const buttonText = valid.stage === 'dylan' ? 'Confirm and Send to JD' : 'Confirm and Send Final Email';
  const body = [
    '<h1>GNC PH</h1>',
    '<h2>' + escapeEmailHtml_(typeLabel) + ' Approval</h2>',
    '<p>Review the row below. No data changes until you press the confirm button on this page.</p>',
    '<div class="meta">',
    '<div class="cell"><span class="label">Common Name</span><span class="value">' + escapeEmailHtml_(item.COMMONNAME) + '</span></div>',
    '<div class="cell"><span class="label">Item Code</span><span class="value">' + escapeEmailHtml_(item.ITEMCODE) + '</span></div>',
    '<div class="cell"><span class="label">Location</span><span class="value">' + escapeEmailHtml_(item.LOCATIONCODE) + '</span></div>',
    '<div class="cell"><span class="label">Lot</span><span class="value">' + escapeEmailHtml_(item.LOTCODE) + '</span></div>',
    '<div class="cell"><span class="label">On Hand</span><span class="value">' + escapeEmailHtml_(item.PTRONHAND) + '</span></div>',
    '<div class="cell"><span class="label">Requested Qty</span><span class="value">' + escapeEmailHtml_(defaultQty || '-') + '</span></div>',
    '</div>',
    '<form method="get">',
    hidden,
    qtyHtml,
    extraHtml,
    '<button class="btn" type="submit">' + escapeEmailHtml_(buttonText) + '</button>',
    '</form>',
    '<p class="safe">If this row has already been approved, denied, or moved to another stage, this page will not process it again.</p>'
  ].join('');
  return HtmlService.createHtmlOutput(renderApprovalPageHtml_(typeLabel + ' Approval', body)).setTitle(typeLabel + ' Approval');
}

function handleEmailApprovalConfirm_(valid, row, params) {
  const nowIso = new Date().toISOString();
  const tableName = row.__approval_table_name || getRuntimeSiteSplitTableName_('ph_master_inventory', 'PH');
  if (valid.stage === 'dylan') {
    const patch = {
      app_tab_assignment: getEmailApprovalAssignment_(valid.type, 'jd'),
      assignedto: 'jd_jones',
      date_completed: null,
      updated_at: nowIso
    };
    const updated = patchEmailApprovalMasterRow_(valid.uid, patch, tableName);
    const emailRow = Object.assign({}, row, updated, patch);
    const payload = buildEmailApprovalPayload_(emailRow, valid.type, 'jd', {
      completedBy: 'dylan_collyge',
      approvedBy: 'dylan_collyge'
    });
    sendRequestEmailWithFallback_(payload);
    return renderApprovalStatusPage_('Sent to JD', 'The row was moved to JD approval and JD was sent the approval email with photos.', 'ok');
  }
  if (valid.stage === 'jd') {
    const approvedQty = String(params && params.approvedQty || '').trim();
    if (valid.type !== 'hold-release' && !approvedQty) {
      return renderApprovalStatusPage_('Approval Needs Qty', 'Enter an approved quantity before final approval.', 'bad');
    }
    const initialPtr = Number(getEmailApprovalRowValue_(row, ['ptravailable', 'PTRAVAILABLE', 'ptronhand', 'PTRONHAND'], ''));
    const patch = {
      app_tab_assignment: getEmailApprovalAssignment_(valid.type, 'inventory'),
      assignedto: '',
      date_completed: null,
      initial_ptr: isNaN(initialPtr) ? null : initialPtr,
      updated_at: nowIso
    };
    if (valid.type === 'hold-release') {
      patch.holdstopcode = null;
      patch.holdstopreason = null;
      patch.hold_release_approved_at = nowIso;
      patch.hold_release_approved_by = 'jd_jones';
      patch.hold_release_approved_by_display = 'JD Jones';
      patch.hold_release_approved_holdstopbegindate = getEmailApprovalRowValue_(row, ['holdstopbegindate', 'HOLDSTOPBEGINDATE'], '') || null;
    } else {
      patch.loc_match_qty = approvedQty;
    }
    const updated = patchEmailApprovalMasterRow_(valid.uid, patch, tableName);
    const emailRow = Object.assign({}, row, updated, patch);
    const extraRecipients = parseEmailApprovalExtraRecipients_(params && params.extraRecipients);
    const payload = buildEmailApprovalPayload_(emailRow, valid.type, 'inventory', {
      approvedQty: approvedQty,
      completedBy: 'jd_jones',
      approvedBy: 'jd_jones',
      extraRecipients: extraRecipients
    });
    sendRequestEmailWithFallback_(payload);
    return renderApprovalStatusPage_('Final Email Sent', 'The row was approved and the final table-style email was sent.', 'ok');
  }
  return renderApprovalStatusPage_('Approval Link', 'This approval stage is not supported.', 'bad');
}

function buildRequestGallerySlidesFromItems_(items) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const slides = [];
  safeItems.forEach(function(item, itemIndex) {
    const commonname = firstNonEmptyRequestValue_(item.commonname, item.COMMONNAME, 'Unknown Item');
    const contsize = firstNonEmptyRequestValue_(item.contsize, item.CONTSIZE, '-');
    const itemcode = firstNonEmptyRequestValue_(item.itemcode, item.ITEMCODE, '');
    const locationcode = firstNonEmptyRequestValue_(item.loc, item.locationcode, item.LOCATIONCODE, '');
    const lotcode = firstNonEmptyRequestValue_(item.lotcode, item.LOTCODE, '');
    const qty = firstNonEmptyRequestValue_(item.qty, item.requested_qty, item.REQ_QTY, '');
    const spec = firstNonEmptyRequestValue_(item.spec, item.REQ_SPEC, item.SPEC, '');
    const caliper = firstNonEmptyRequestValue_(item.caliper, item.REQ_CALIPER, item.CALIPER, '');
    const locMatchQty = getRequestLocPhotoMatchEmailValue_(item);
    const avNote = firstNonEmptyRequestValue_(item.av_note, item.AV_NOTE, '');
    getRequestItemPhotoUrls_(item).forEach(function(url, photoIndex) {
      slides.push({
        url: url,
        rowNumber: itemIndex + 1,
        photoNumber: photoIndex + 1,
        title: [commonname, contsize].filter(Boolean).join(' '),
        subtitle: [
          itemcode ? 'Item ' + itemcode : '',
          locationcode ? 'Loc ' + locationcode : '',
          lotcode ? 'Lot ' + lotcode : '',
          qty ? 'Qty ' + qty : ''
        ].filter(Boolean).join(' | '),
        itemcode: itemcode,
        commonname: commonname,
        contsize: contsize,
        locationcode: locationcode,
        lotcode: lotcode,
        qty: qty,
        spec: spec,
        caliper: caliper,
        locMatchQty: locMatchQty,
        avNote: avNote
      });
    });
  });
  return slides;
}

function buildRequestGalleryUrlForPayload_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  return buildRequestGalleryUrl_(resolveRequestGalleryFolderId_(payload, items), resolveRequestGalleryRequestIds_(payload, items), items);
}

function buildRequestGalleryPreviewHtml_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  const slides = buildRequestGallerySlidesFromItems_(items);
  if (!slides.length) return '';
  const galleryFolderId = resolveRequestGalleryFolderId_(payload, items);
  cacheRequestGalleryPayload_(galleryFolderId, items);
  const galleryUrl = buildRequestGalleryUrl_(galleryFolderId, resolveRequestGalleryRequestIds_(payload, items), items);
  const firstSlide = slides[0] || {};
  const targetUrl = galleryUrl || firstSlide.url || '';
  if (!targetUrl) return '';
  const safeTargetUrl = escapeEmailAttribute_(targetUrl);
  const photoCountText = slides.length === 1 ? '1 photo' : slides.length + ' photos';
  const rowCountText = items.length === 1 ? '1 row' : items.length + ' rows';
  const actionLabel = galleryUrl ? 'View Photo Gallery' : 'Open First Photo';
  const previewStripHtml = buildRequestEmailPhotoPreviewStripHtml_(slides.map(function(slide) {
    return slide && slide.url;
  }), {
    titlePrefix: 'Photo',
    tileSize: 112,
    thumbWidth: 360,
    maxPhotos: 12
  });
  const caption = galleryUrl
    ? 'First preview photo is shown below. Open the gallery to view all ' + photoCountText + ' from ' + rowCountText + '.'
    : 'Preview photo shown below. Open it for the full-size image.';
  return [
    '<div style="margin:18px 0; padding:14px; border:1px solid #b7f2d1; border-radius:12px; background:#f0fdf4;">',
    '<p style="margin:12px 0 14px 0; color:#065f46; font-size:13px; line-height:1.45;">' + escapeEmailHtml_(caption) + '</p>',
    previewStripHtml,
    '<div style="text-align:center;">',
    '<a href="' + safeTargetUrl + '" style="display:inline-block; padding:11px 16px; border-radius:999px; background:#007a4d; color:#ffffff; font-weight:700; text-decoration:none;">' + escapeEmailHtml_(actionLabel) + '</a>',
    '</div>',
    '</div>'
  ].join('');
}

function buildCompletedRequestItemsHtml_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  if (!items.length) return String(payload.formattedItemsHtml || '').trim();
  const galleryFolderId = resolveRequestGalleryFolderId_(payload, items);
  cacheRequestGalleryPayload_(galleryFolderId, items);
  const rowsHtml = items.map(function(item, index) {
    const commonName = escapeEmailHtml_(firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Unknown Item'));
    const contSize = escapeEmailHtml_(firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, '-'));
    const photoCount = getRequestItemPhotoUrls_(item).length;
    const photoPreviewHtml = buildRequestRowPhotoPreviewHtml_(galleryFolderId, item);
    const fieldsHtml = [
      buildRequestItemFieldRowsHtml_(item),
      '<div style="margin-top:3px;"><strong>Photos:</strong> ' + escapeEmailHtml_(photoCount ? String(photoCount) : '0') + '</div>'
    ].filter(Boolean).join('');
    return [
      '<li style="margin:0 0 12px 0;background:#f9f9f9;padding:10px;border-left:4px solid #007a4d;list-style:none;">',
      '<strong>' + escapeEmailHtml_(index + 1) + '. ' + commonName + ' (' + contSize + ')</strong>',
      photoPreviewHtml,
      '<div style="margin-top:12px;">',
      fieldsHtml,
      '</div>',
      '</li>'
    ].join('');
  }).join('');
  return '<ul style="list-style:none;padding:0;margin:0;">' + rowsHtml + '</ul>';
}

function buildCompactRequestItemsHtml_(payload) {
  return buildRequestEmailTableItemsHtml_(payload, { title: 'Selected Rows' });
}

function escapeRequestGalleryJson_(value) {
  return JSON.stringify(value || [])
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildRequestGalleryRowsHtml_(items) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!safeItems.length) {
    return '<p class="empty">No request rows were found for this folder.</p>';
  }
  return safeItems.map(function(item, index) {
    const photoCount = getRequestItemPhotoUrls_(item).length;
    const fields = [
      ['Item', firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, '-')],
      ['Location', firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, '-')],
      ['Lot', firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, '')],
      ['Qty', firstNonEmptyRequestValue_(item && item.qty, item && item.requested_qty, item && item.REQ_QTY, '')],
      ['Spec', firstNonEmptyRequestValue_(item && item.spec, item && item.REQ_SPEC, item && item.SPEC, '')],
      ['Caliper', firstNonEmptyRequestValue_(item && item.caliper, item && item.REQ_CALIPER, item && item.CALIPER, '')],
      ['LOC PHOTO MATCH', getRequestLocPhotoMatchEmailValue_(item)],
      ['AV Note', firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, '')],
      ['Comments', getRequestCompleteEmailSnapshotComments_(item)],
      ['Photos', photoCount ? String(photoCount) : '0']
    ].filter(function(field) {
      return String(field[1] || '').trim() !== '';
    });
    const fieldsHtml = fields.map(function(field) {
      return '<div class="row-field"><span>' + escapeEmailHtml_(field[0]) + '</span><strong>' + escapeEmailHtml_(field[1]) + '</strong></div>';
    }).join('');
    return [
      '<article class="row-card">',
      '<div class="row-title">' + escapeEmailHtml_(index + 1) + '. ' + escapeEmailHtml_(firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Unknown Item')) + '</div>',
      '<div class="row-subtitle">' + escapeEmailHtml_(firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, '-')) + '</div>',
      '<div class="row-fields">',
      fieldsHtml,
      '</div>',
      '</article>'
    ].join('');
  }).join('');
}

function buildRequestGalleryErrorPage_(title, message) {
  return HtmlService
    .createHtmlOutput([
      '<!doctype html><html><head>',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escapeEmailHtml_(title || 'Request Gallery') + '</title>',
      '<style>body{margin:0;font-family:Arial,sans-serif;background:#f6faf8;color:#0f172a;padding:24px}.card{max-width:640px;margin:40px auto;background:white;border:1px solid #b7f2d1;border-radius:16px;padding:24px;box-shadow:0 16px 50px rgba(15,23,42,.08)}h1{color:#007a4d;margin:0 0 12px}p{line-height:1.5}</style>',
      '</head><body><div class="card">',
      '<h1>' + escapeEmailHtml_(title || 'Request Gallery') + '</h1>',
      '<p>' + escapeEmailHtml_(message || 'This gallery could not be opened.') + '</p>',
      '</div></body></html>'
    ].join(''))
    .setTitle(title || 'Request Gallery');
}

function loadRequestGalleryItemsForFolder_(folderId, requestIds) {
  const safeFolderId = String(folderId || '').trim();
  const safeIds = normalizeRequestGalleryIdList_(requestIds || []);
  const folderRows = mergeRequestEmailRows_(
    fetchRequestRowsForEmailFolder_(safeFolderId),
    fetchRequestHistoryRowsForEmailFolder_(safeFolderId)
  );
  let rows = folderRows;
  if (safeIds.length) {
    const idSet = {};
    safeIds.forEach(function(id) { idSet[id] = true; });
    rows = folderRows.filter(function(row) {
      const rowId = firstNonEmptyRequestValue_(row && row.unique_id, row && row.UNIQUE_ID, '');
      return !!rowId && !!idSet[rowId];
    });
    if (!rows.length) {
      rows = mergeRequestEmailRows_(
        fetchRequestRowsForEmailRequestIds_(safeIds),
        fetchRequestHistoryRowsForEmailRequestIds_(safeIds)
      );
      if (!rows.length && folderRows.length) rows = folderRows;
    }
  }
  let items = buildRequestEmailItemsFromRows_(rows, { folderId: safeFolderId });
  if (!items.length || !buildRequestGallerySlidesFromItems_(items).length) {
    const cachedItems = readRequestGalleryCachedItems_(safeFolderId);
    if (cachedItems.length) items = cachedItems;
  }
  return items;
}

function findRequestGalleryItem_(items, rowId, rowIndex) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const safeRowId = String(rowId || '').trim();
  if (safeRowId) {
    for (let index = 0; index < safeItems.length; index++) {
      const item = safeItems[index] || {};
      const itemId = String(firstNonEmptyRequestValue_(item.unique_id, item.UNIQUE_ID, item.id, item.ID, '')).trim();
      if (itemId && itemId === safeRowId) return item;
    }
  }
  const numericIndex = Number(rowIndex);
  if (Number.isFinite(numericIndex) && numericIndex >= 0 && numericIndex < safeItems.length) return safeItems[numericIndex];
  return safeItems.length === 1 ? safeItems[0] : null;
}

function buildRequestRowCopyFields_(item) {
  const photoUrls = getRequestItemPhotoUrls_(item);
  const fields = [
    ['Common Name', firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, '')],
    ['Container Size', firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, '')],
    ['Item Code', firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, '')],
    ['Location', firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, '')],
    ['Lot', firstNonEmptyRequestValue_(item && item.lotcode, item && item.LOTCODE, '')],
    ['Season', firstNonEmptyRequestValue_(item && item.season, item && item.SEASON, '')],
    ['Priority', firstNonEmptyRequestValue_(item && item.priority, item && item.PRIORITY, '')],
    ['PTR Available', firstNonEmptyRequestValue_(item && item.ptravailable, item && item.PTRAVAILABLE, '')],
    ['S_LTS', firstNonEmptyRequestValue_(item && item.s_lts, item && item.S_LTS, '')],
    ['Requested Qty', firstNonEmptyRequestValue_(item && item.qty, item && item.requested_qty, item && item.REQ_QTY, '')],
    ['Request Note', firstNonEmptyRequestValue_(item && item.request_note, item && item.req_note, item && item.REQUEST_NOTE, item && item.REQ_NOTE, '')],
    ['Desired Spec', firstNonEmptyRequestValue_(item && item.desired_spec, item && item.req_desired_spec, item && item.REQ_DESIRED_SPEC, item && item.DESIRED_SPEC, '')],
    ['Desired Caliper', firstNonEmptyRequestValue_(item && item.desired_caliper, item && item.req_desired_caliper, item && item.REQ_DESIRED_CALIPER, item && item.DESIRED_CALIPER, '')],
    ['Spec', firstNonEmptyRequestValue_(item && item.spec, item && item.REQ_SPEC, item && item.SPEC, '')],
    ['Caliper', firstNonEmptyRequestValue_(item && item.caliper, item && item.REQ_CALIPER, item && item.CALIPER, '')],
    ['LOC Photo Match', getRequestLocPhotoMatchEmailValue_(item)],
    ['AV Note', firstNonEmptyRequestValue_(item && item.av_note, item && item.AV_NOTE, '')],
    ['Reserve', firstNonEmptyRequestValue_(item && item.reserve, item && item.req_reserve, item && item.REQ_RESERVE, '')],
    ['Pick Note', firstNonEmptyRequestValue_(item && item.pick_note, item && item.pick, item && item.req_pick, item && item.req_pic_note, item && item.REQ_PICK, item && item.REQ_PIC_NOTE, item && item.PICK, '')],
    ['Comments', firstNonEmptyRequestValue_(item && item.comments, item && item.req_comments, item && item.request_comments, item && item.REQ_COMMENTS, item && item.REQUEST_COMMENTS, item && item.COMMENTS, '')],
    ['Completed By', formatRequestCompletionUserLabel_(item)]
  ].filter(function(field) {
    return String(field[1] || '').trim() !== '';
  });
  return {
    fields: fields,
    photoUrls: photoUrls
  };
}

function buildRequestRowCopyText_(item) {
  const copyData = buildRequestRowCopyFields_(item);
  const title = firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Request Row');
  const lines = [String(title || 'Request Row')];
  copyData.fields.forEach(function(field) {
    lines.push(field[0] + ': ' + field[1]);
  });
  if (copyData.photoUrls.length) {
    lines.push('');
    lines.push('Photos:');
    copyData.photoUrls.forEach(function(url, index) {
      lines.push('Photo ' + (index + 1) + ': ' + url);
    });
  }
  return lines.join('\n');
}

function buildRequestRowCopyHtml_(item) {
  const copyData = buildRequestRowCopyFields_(item);
  const title = firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Request Row');
  const contsize = firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, '');
  const rowsHtml = copyData.fields.map(function(field) {
    return '<tr><th style="text-align:left;padding:6px 8px;border:1px solid #d9eadf;background:#f0fdf4;color:#007a4d;">' + escapeEmailHtml_(field[0]) + '</th><td style="padding:6px 8px;border:1px solid #d9eadf;">' + escapeEmailHtml_(field[1]) + '</td></tr>';
  }).join('');
  const photosHtml = copyData.photoUrls.map(function(url, index) {
    const safeUrl = escapeEmailAttribute_(url);
    return '<p><strong>Photo ' + (index + 1) + ':</strong> <a href="' + safeUrl + '">' + escapeEmailHtml_(url) + '</a></p><p><img src="' + safeUrl + '" alt="Photo ' + (index + 1) + '" style="max-width:520px;width:100%;height:auto;border-radius:8px;border:1px solid #ddd;"></p>';
  }).join('');
  return [
    '<div style="font-family:Arial,sans-serif;color:#0f172a;">',
    '<h2 style="color:#007a4d;margin:0 0 6px;">' + escapeEmailHtml_(title) + (contsize ? ' ' + escapeEmailHtml_(contsize) : '') + '</h2>',
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:10px 0;">',
    rowsHtml,
    '</table>',
    photosHtml,
    '</div>'
  ].join('');
}

function renderRequestRowCopyWebApp_(params) {
  const folderId = String(firstNonEmptyRequestValue_(
    params && params.folder,
    params && params.folderId,
    params && params.requestFolder,
    ''
  )).trim();
  const token = String(params && params.token || '').trim();
  if (!folderId || !verifyRequestGalleryToken_(folderId, token)) {
    return buildRequestGalleryErrorPage_('Copy Row', 'This row copy link is missing or no longer valid.');
  }
  const rowId = String(firstNonEmptyRequestValue_(params && params.row, params && params.id, params && params.requestId, '')).trim();
  const rowIndex = params && params.index;
  const items = loadRequestGalleryItemsForFolder_(folderId, rowId ? [rowId] : []);
  const item = findRequestGalleryItem_(items, rowId, rowIndex);
  if (!item) {
    return buildRequestGalleryErrorPage_('Copy Row', 'This request row could not be found.');
  }
  const copyText = buildRequestRowCopyText_(item);
  const copyHtml = buildRequestRowCopyHtml_(item);
  const title = firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Request Row');
  const photoUrls = getRequestItemPhotoUrls_(item);
  const photoPreviewHtml = photoUrls.map(function(url, index) {
    const safeUrl = escapeEmailAttribute_(url);
    return '<a href="' + safeUrl + '" target="_blank" rel="noopener"><img src="' + safeUrl + '" alt="Photo ' + (index + 1) + '"></a>';
  }).join('');
  const html = [
    '<!doctype html><html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>Copy Request Row</title>',
    '<style>',
    ':root{--green:#007a4d;--mint:#e9fff4;--border:#b7f2d1;--ink:#0f172a;--muted:#64748b;}',
    '*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f6faf8;color:var(--ink);}.wrap{max-width:880px;margin:0 auto;padding:18px 14px 32px}.hero{background:var(--green);color:#fff;padding:18px 16px;border-radius:0 0 18px 18px}.hero h1{font-size:24px;line-height:1.1;margin:0 0 6px;font-weight:900}.hero p{margin:0;color:#d9fbe8;font-weight:800}.card{margin-top:16px;background:#fff;border:1px solid var(--border);border-radius:16px;padding:14px;box-shadow:0 12px 40px rgba(15,23,42,.08)}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}button,a.button{border:0;border-radius:999px;background:var(--green);color:#fff;padding:12px 14px;font-weight:900;text-align:center;text-decoration:none;cursor:pointer}.status{min-height:22px;color:var(--green);font-weight:800;margin:6px 0 0}textarea{width:100%;min-height:260px;border:1px solid #cbd5e1;border-radius:12px;padding:12px;font:14px/1.4 Consolas,monospace;color:var(--ink)}.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px}.photos img{display:block;width:100%;height:auto;border-radius:10px;border:1px solid #d7ded8}@media(max-width:560px){.wrap{padding:0 10px 28px}.hero{border-radius:0}.hero h1{font-size:21px}.actions{grid-template-columns:1fr}}',
    '</style>',
    '</head><body>',
    '<div class="hero"><div class="wrap" style="padding-top:0;padding-bottom:0;">',
    '<h1>' + escapeEmailHtml_(title) + '</h1>',
    '<p>' + escapeEmailHtml_(photoUrls.length + ' photos | ' + folderId) + '</p>',
    '</div></div>',
    '<main class="wrap">',
    '<section class="card">',
    '<div class="actions">',
    '<button type="button" id="copyBtn">Copy Row</button>',
    '<a class="button" href="' + escapeEmailAttribute_(buildRequestGalleryUrl_(folderId, rowId ? [rowId] : [])) + '">View Photos</a>',
    '</div>',
    '<p class="status" id="status"></p>',
    '<textarea id="copyText" readonly>' + escapeEmailHtml_(copyText) + '</textarea>',
    photoPreviewHtml ? '<div class="photos">' + photoPreviewHtml + '</div>' : '',
    '</section>',
    '</main>',
    '<script>',
    '(function(){',
    'var copyText=' + escapeRequestGalleryJson_(copyText) + ';',
    'var copyHtml=' + escapeRequestGalleryJson_(copyHtml) + ';',
    'var status=document.getElementById("status");',
    'var textArea=document.getElementById("copyText");',
    'var button=document.getElementById("copyBtn");',
    'function mark(message){status.textContent=message;button.textContent=message==="Copied"?"Copied":"Copy Row";}',
    'function fallback(){textArea.focus();textArea.select();try{document.execCommand("copy");mark("Copied");}catch(e){mark("Select the text and copy");}}',
    'button.addEventListener("click",function(){if(navigator.clipboard&&window.ClipboardItem){var item=new ClipboardItem({"text/html":new Blob([copyHtml],{type:"text/html"}),"text/plain":new Blob([copyText],{type:"text/plain"})});navigator.clipboard.write([item]).then(function(){mark("Copied");},function(){fallback();});}else if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(copyText).then(function(){mark("Copied");},function(){fallback();});}else{fallback();}});',
    '})();',
    '</script>',
    '</body></html>'
  ].join('');
  return HtmlService.createHtmlOutput(html).setTitle('Copy Request Row');
}

function renderRequestGalleryWebApp_(params) {
  const folderId = String(firstNonEmptyRequestValue_(
    params && params.folder,
    params && params.folderId,
    params && params.requestFolder,
    ''
  )).trim();
  const token = String(params && params.token || '').trim();
  if (!folderId || !verifyRequestGalleryToken_(folderId, token)) {
    return buildRequestGalleryErrorPage_('Request Gallery', 'This request gallery link is missing or no longer valid.');
  }

  const requestIds = normalizeRequestGalleryIdList_(params && (params.ids || params.requestIds || params.request_ids || ''));
  const folderRows = mergeRequestEmailRows_(
    fetchRequestRowsForEmailFolder_(folderId),
    fetchRequestHistoryRowsForEmailFolder_(folderId)
  );
  let rows = folderRows;
  if (requestIds.length) {
    const idSet = {};
    requestIds.forEach(function(id) { idSet[id] = true; });
    rows = folderRows.filter(function(row) {
      const rowId = firstNonEmptyRequestValue_(row && row.unique_id, row && row.UNIQUE_ID, '');
      return !!rowId && !!idSet[rowId];
    });
    if (!rows.length) {
      rows = mergeRequestEmailRows_(
        fetchRequestRowsForEmailRequestIds_(requestIds),
        fetchRequestHistoryRowsForEmailRequestIds_(requestIds)
      );
    }
  }
  let items = buildRequestEmailItemsFromRows_(rows, { folderId: folderId });
  let slides = buildRequestGallerySlidesFromItems_(items);
  if (!items.length || !slides.length) {
    const cachedItems = filterRequestGalleryItemsByIds_(readRequestGalleryCachedItems_(folderId), requestIds);
    const cachedSlides = buildRequestGallerySlidesFromItems_(cachedItems);
    if (cachedItems.length && cachedSlides.length) {
      rows = [];
      items = cachedItems;
      slides = cachedSlides;
    }
  }
  if (!items.length || !slides.length) {
    const inlineItems = filterRequestGalleryItemsByIds_(decodeRequestGalleryInlineItems_(firstNonEmptyRequestValue_(
      params && params.data,
      params && params.inline,
      params && params.itemsData,
      ''
    )), requestIds);
    const inlineSlides = buildRequestGallerySlidesFromItems_(inlineItems);
    if (inlineItems.length && inlineSlides.length) {
      rows = [];
      items = inlineItems;
      slides = inlineSlides;
    }
  }
  const firstItem = items.length ? items[0] || {} : {};
  const customerLabel = firstNonEmptyRequestValue_(firstItem.customer, folderId, 'Request Folder');
  const rowsHtml = buildRequestGalleryRowsHtml_(items);
  const slidesJson = escapeRequestGalleryJson_(slides);
  const safeCustomer = escapeEmailHtml_(customerLabel);
  const photoCountLabel = slides.length === 1 ? '1 photo' : slides.length + ' photos';
  const rowCountLabel = items.length === 1 ? '1 row' : items.length + ' rows';
  const mobileSlidesHtml = slides.map(function(slide, index) {
    const title = firstNonEmptyRequestValue_(slide && slide.title, 'Request photo');
    const subtitle = firstNonEmptyRequestValue_(slide && slide.subtitle, '');
    const url = firstNonEmptyRequestValue_(slide && slide.url, '');
    return [
      '<section class="mobile-slide">',
      '<div class="mobile-count">' + escapeEmailHtml_(String(index + 1) + ' / ' + String(slides.length)) + '</div>',
      '<img src="' + escapeEmailAttribute_(url) + '" alt="' + escapeEmailAttribute_(title) + '">',
      '<div class="mobile-caption">',
      '<h2>' + escapeEmailHtml_(title) + '</h2>',
      subtitle ? '<p>' + escapeEmailHtml_(subtitle) + '</p>' : '',
      '</div>',
      '</section>'
    ].join('');
  }).join('');
  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>GNC Request Gallery</title>',
    '<style>',
    ':root{color-scheme:dark;--green:#007a4d;--ink:#f8fafc;--muted:#cbd5e1;}',
    '*{box-sizing:border-box}',
    'html,body{height:100%;overflow:hidden;}',
    'body{margin:0;font-family:Arial,sans-serif;background:#020403;color:var(--ink);}',
    '.mobile-scroll{display:none;}',
    '.viewer{position:fixed;inset:0;background:rgba(0,0,0,.94);display:flex;align-items:center;justify-content:center;padding:72px;}',
    '.topbar{position:fixed;left:0;right:0;top:0;z-index:5;display:flex;justify-content:space-between;gap:16px;padding:16px 18px 10px;background:linear-gradient(180deg,rgba(0,0,0,.86),rgba(0,0,0,0));}',
    '.heading{min-width:0;}',
    '.heading h1{margin:0;color:#fff;font-size:18px;line-height:1.2;font-weight:900;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.heading p{margin:6px 0 0;color:#fff;font-size:15px;font-weight:900;letter-spacing:.1em;}',
    '.close{width:58px;height:58px;min-width:58px;border:0;border-radius:999px;background:rgba(0,0,0,.45);color:#fff;font-size:42px;line-height:1;cursor:pointer;}',
    '.image-shell{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;}',
    '.image-shell img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;box-shadow:0 20px 80px rgba(0,0,0,.45);}',
    '.side-nav{position:fixed;top:50%;transform:translateY(-50%);z-index:4;width:64px;height:64px;border:0;border-radius:999px;background:rgba(0,0,0,.52);color:#fff;font-size:46px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;}',
    '.side-nav.prev{left:18px}.side-nav.next{right:18px}',
    '.empty-page{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f6faf8;color:#64748b;font-weight:800;text-align:center;}',
    '@media (max-width:720px){html,body{height:auto;min-height:100%;overflow:auto;scroll-behavior:smooth;}.desktop-viewer{display:none;}.mobile-scroll{display:block;min-height:100vh;background:#020403;color:#fff;scroll-snap-type:y proximity;padding-bottom:env(safe-area-inset-bottom);}.mobile-sticky{position:sticky;top:0;z-index:6;padding:12px 14px 10px;background:linear-gradient(180deg,rgba(0,0,0,.96),rgba(0,0,0,.72));}.mobile-sticky h1{margin:0;font-size:16px;line-height:1.2;font-weight:900;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.mobile-sticky p{margin:5px 0 0;color:#d9fbe8;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;}.mobile-slide{min-height:calc(100vh - 62px);scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;gap:9px;padding:10px 10px 18px;}.mobile-slide img{display:block;width:100%;height:auto;max-height:calc(100vh - 156px);object-fit:contain;border-radius:8px;background:#0f172a;}.mobile-count{align-self:flex-start;border-radius:999px;background:rgba(0,122,77,.82);padding:6px 10px;font-size:12px;font-weight:900;letter-spacing:.08em;}.mobile-caption{border:1px solid rgba(183,242,209,.35);border-radius:10px;background:rgba(0,122,77,.22);padding:9px 10px;}.mobile-caption h2{margin:0;color:#fff;font-size:15px;line-height:1.2;font-weight:900;}.mobile-caption p{margin:4px 0 0;color:#d5fde6;font-size:12px;line-height:1.35;font-weight:800;}}',
    '</style>',
    '</head>',
    '<body>',
    slides.length ? [
      '<main class="viewer desktop-viewer" id="gallery">',
      '<header class="topbar">',
      '<div class="heading"><h1 id="topTitle">' + safeCustomer + '</h1><p id="topCounter">' + escapeEmailHtml_(photoCountLabel + ' | ' + rowCountLabel) + '</p></div>',
      '<button type="button" class="close" id="closeBtn" aria-label="Close">&times;</button>',
      '</header>',
      '<div class="image-shell"><img id="galleryImage" alt="Request photo"></div>',
      '<button type="button" class="side-nav prev" id="prevBtn" aria-label="Previous photo">&#8249;</button>',
      '<button type="button" class="side-nav next" id="nextBtn" aria-label="Next photo">&#8250;</button>',
      '</main>',
      '<main class="mobile-scroll">',
      '<header class="mobile-sticky">',
      '<h1>' + safeCustomer + '</h1>',
      '<p>' + escapeEmailHtml_(photoCountLabel + ' | ' + rowCountLabel) + '</p>',
      '</header>',
      mobileSlidesHtml,
      '</main>'
    ].join('') : '<main class="empty-page"><p>No photos were found for this request folder.<br>' + escapeEmailHtml_(photoCountLabel + ' | ' + rowCountLabel + ' | ' + folderId) + '</p></main>',
    '<script>',
    '(function(){',
    'var slides=' + slidesJson + ';',
    'if(!slides.length)return;',
    'var index=0;',
    'var image=document.getElementById("galleryImage");',
    'var topTitle=document.getElementById("topTitle");',
    'var topCounter=document.getElementById("topCounter");',
    'var prev=document.getElementById("prevBtn");',
    'var next=document.getElementById("nextBtn");',
    'var closeBtn=document.getElementById("closeBtn");',
    'function render(){var slide=slides[index]||{};var count=(index+1)+" / "+slides.length;image.src=slide.url||"";image.alt=slide.title||"Request photo";topTitle.textContent=String(slide.title||"Request photo").toUpperCase();topCounter.textContent=count;}',
    'function go(delta){index=(index+delta+slides.length)%slides.length;render();}',
    'prev.addEventListener("click",function(){go(-1);});',
    'next.addEventListener("click",function(){go(1);});',
    'closeBtn.addEventListener("click",function(){if(history.length>1)history.back();else window.close();});',
    'document.addEventListener("keydown",function(event){if(event.key==="ArrowLeft")go(-1);if(event.key==="ArrowRight")go(1);});',
    'var startX=0;',
    'image.addEventListener("touchstart",function(event){startX=event.touches&&event.touches.length?event.touches[0].clientX:0;},{passive:true});',
    'image.addEventListener("touchend",function(event){var endX=event.changedTouches&&event.changedTouches.length?event.changedTouches[0].clientX:startX;var delta=endX-startX;if(Math.abs(delta)>40)go(delta>0?-1:1);},{passive:true});',
    'render();',
    '})();',
    '</script>',
    '</body>',
    '</html>'
  ].join('');
  const output = HtmlService.createHtmlOutput(html).setTitle('GNC Request Gallery');
  try {
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {}
  return output;
}

function buildRequestItemsText_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  if (!items.length) {
    const formatted = String(payload.formattedItemsText || '').trim();
    if (formatted) return formatted;
  }
  if (!items.length) return '';

  const galleryFolderId = resolveRequestGalleryFolderId_(payload, items);
  return items.map(function(item) {
    const photoUrls = getRequestItemPhotoUrls_(item);
    const detailText = buildRequestItemFieldRowsText_(item);
    const galleryUrl = buildRequestRowGalleryUrl_(galleryFolderId, item);
    const photoText = photoUrls.length
      ? ['Photos: ' + (photoUrls.length === 1 ? '1 photo' : photoUrls.length + ' photos')]
          .concat(['First Photo: ' + photoUrls[0]])
          .concat(galleryUrl ? ['Photo Gallery: ' + galleryUrl] : [])
          .filter(Boolean).join('\n')
      : '';
    return [
      String(item && item.commonname ? item.commonname : 'Unknown Item') + ' (' + String(item && item.contsize ? item.contsize : '-') + ')',
      detailText,
      photoText
    ].filter(Boolean).join('\n');
  }).join('\n');
}

function getRequestSelectionSummaryGroups_(payload) {
  const items = getRequestEmailPayloadItems_(payload);
  if (!items.length) return [];

  return items.map(function(item) {
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
    const lotCode = String(firstNonEmptyRequestValue_(
      item.lotcode,
      item.LOTCODE,
      item.lotCode,
      item.LOT_CODE,
      ''
    ) || '').trim();
    const locationCode = String(firstNonEmptyRequestValue_(
      item.locationcode,
      item.LOCATIONCODE,
      item.locationCode,
      item.LOCATION_CODE,
      item.loc,
      item.LOC,
      ''
    ) || '').trim();
    if (!itemCode && !commonName && !contSize) return;
    return {
      itemcode: itemCode || 'N/A',
      commonname: commonName || 'Unknown Item',
      contsize: contSize || '-',
      lotcode: lotCode || '-',
      locationcode: locationCode || '-'
    };
  }).filter(Boolean);
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
      '<td style="padding:8px; border-bottom:1px solid #eee;">' + escapeEmailHtml_(group.lotcode) + '</td>',
      '<td style="padding:8px; border-bottom:1px solid #eee;">' + escapeEmailHtml_(group.locationcode) + '</td>',
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
    '<th align="left" style="padding:8px; border-bottom:1px solid #ddd;">LOTCODE</th>',
    '<th align="left" style="padding:8px; border-bottom:1px solid #ddd;">LOCATIONCODE</th>',
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
        'LOTCODE: ' + group.lotcode,
        'LOCATIONCODE: ' + group.locationcode
      ].join('\n');
    }).join('\n\n')
  ].join('\n\n');
}

function getCustomerConsigneeSummaryRows_(payload) {
  const rows = Array.isArray(payload && payload.customerConsigneeRows) ? payload.customerConsigneeRows
    : (Array.isArray(payload && payload.customers) ? payload.customers : []);
  return rows.filter(function(row) {
    return row && typeof row === 'object';
  });
}

function getCustomerConsigneeSummaryLabel_(row) {
  return firstNonEmptyRequestValue_(
    row && row.label,
    [row && row.customername, row && row.consigneename].map(function(value) {
      return String(value || '').trim();
    }).filter(Boolean).join(' / '),
    row && row.customer,
    row && row.customerName,
    row && row.consignee,
    row && row.consigneeName,
    ''
  );
}

function getCustomerConsigneeSummaryQtyLabel_(row) {
  const qtyLabel = firstNonEmptyRequestValue_(row && row.qty_label, row && row.qtyLabel, '');
  if (qtyLabel) return qtyLabel;
  const qty = firstNonEmptyRequestValue_(row && row.qty, row && row.quantity, '');
  if (qty) return 'Qty ' + qty;
  const rows = firstNonEmptyRequestValue_(row && row.rows, row && row.rowCount, row && row.count, '');
  if (rows) return rows + ' row' + (String(rows) === '1' ? '' : 's');
  return '';
}

function buildCustomerConsigneeSummaryHtml_(payload) {
  const rows = getCustomerConsigneeSummaryRows_(payload);
  if (!rows.length) return '';
  const htmlRows = rows.map(function(row) {
    const label = getCustomerConsigneeSummaryLabel_(row);
    const qtyLabel = getCustomerConsigneeSummaryQtyLabel_(row);
    const matchLabel = firstNonEmptyRequestValue_(row && row.item_lot_season, row && row.matchLabel, row && row.match_label, '');
    return '<li><strong>Customer / Consignee:</strong> ' +
      escapeEmailHtml_(label || 'Unknown') +
      (qtyLabel ? ' <span style="color:#047857;font-weight:700;">' + escapeEmailHtml_(qtyLabel) + '</span>' : '') +
      (matchLabel ? ' <span style="color:#64748b;">- ' + escapeEmailHtml_(matchLabel) + '</span>' : '') +
      '</li>';
  }).join('');
  return [
    '<div style="margin:0 0 16px 0;">',
    '<div style="font-weight:700;margin:0 0 6px 0;">Customer / Consignee</div>',
    '<ul style="margin:0 0 0 18px;padding:0;">',
    htmlRows,
    '</ul>',
    '</div>'
  ].join('');
}

function buildCustomerConsigneeSummaryText_(payload) {
  const rows = getCustomerConsigneeSummaryRows_(payload);
  if (!rows.length) return '';
  return [
    'Customer / Consignee',
    rows.map(function(row) {
      const label = getCustomerConsigneeSummaryLabel_(row) || 'Unknown';
      const qtyLabel = getCustomerConsigneeSummaryQtyLabel_(row);
      const matchLabel = firstNonEmptyRequestValue_(row && row.item_lot_season, row && row.matchLabel, row && row.match_label, '');
      return '- ' + [label, qtyLabel, matchLabel].filter(Boolean).join(' - ');
    }).join('\n')
  ].join('\n');
}

function buildAdvertisementEmailHeroHtml_(payload) {
  const subType = String(payload && (payload.emailSubType || payload.email_sub_type) || '').trim().toLowerCase();
  const imageUrl = firstNonEmptyRequestValue_(
    payload && payload.advertisementImageUrl,
    payload && payload.marketingMaterialUrl,
    payload && payload.advertisement_image_url,
    payload && payload.marketing_material_url,
    ''
  );
  if (subType !== 'advertisement' && !imageUrl) return '';
  const title = firstNonEmptyRequestValue_(payload && payload.advertisementTitle, payload && payload.advertisement_title, payload && payload.subject, 'Advertisement');
  const folderName = firstNonEmptyRequestValue_(payload && payload.flyerFolderName, payload && payload.flyer_folder_name, '');
  const safeUrl = escapeEmailAttribute_(imageUrl);
  return [
    '<div style="margin:0 0 18px 0;">',
    '<div style="font-size:18px;font-weight:800;margin:0 0 12px 0;">' + escapeEmailHtml_(title) + '</div>',
    imageUrl ? '<a href="' + safeUrl + '" style="display:block;text-decoration:none;"><img src="' + safeUrl + '" alt="' + escapeEmailAttribute_(title) + '" width="320" style="display:block;width:100%;max-width:320px;height:auto;max-height:380px;object-fit:contain;border-radius:10px;border:1px solid #d7ded8;margin:0 auto;"></a>' : '',
    folderName ? '<div style="font-weight:700;color:#047857;margin:12px 0 0 0;">Flyer Folder: ' + escapeEmailHtml_(folderName) + '</div>' : '',
    '</div>'
  ].join('');
}

function buildAdvertisementEmailHeroText_(payload) {
  const subType = String(payload && (payload.emailSubType || payload.email_sub_type) || '').trim().toLowerCase();
  const imageUrl = firstNonEmptyRequestValue_(
    payload && payload.advertisementImageUrl,
    payload && payload.marketingMaterialUrl,
    payload && payload.advertisement_image_url,
    payload && payload.marketing_material_url,
    ''
  );
  if (subType !== 'advertisement' && !imageUrl) return '';
  return [
    firstNonEmptyRequestValue_(payload && payload.advertisementTitle, payload && payload.advertisement_title, payload && payload.subject, 'Advertisement'),
    imageUrl ? 'Advertisement Image: ' + imageUrl : '',
    firstNonEmptyRequestValue_(payload && payload.flyerFolderName, payload && payload.flyer_folder_name, '') ? 'Flyer Folder: ' + firstNonEmptyRequestValue_(payload && payload.flyerFolderName, payload && payload.flyer_folder_name, '') : ''
  ].filter(Boolean).join('\n');
}

function buildRequestEmailMessage_(payload) {
  const emailType = String(payload.emailType || '').trim().toLowerCase();
  const emailSubType = String(payload.emailSubType || payload.email_sub_type || '').trim().toLowerCase();
  const isBlockClearingEmail = emailType === 'block_clearing_email' || emailSubType === 'block_clearing_email' || (payload && payload.blockClearingEmail === true);
  const isApprovalEmail = emailType === 'ncr_approval' || emailType === 'hold_release_request';
  const isDriveShiftReportEmail = emailType === 'drive_shift_report';
  const isGroupedBloomNcrEmail = emailType === 'drive_customer_outreach' && emailSubType === 'grouped_bloom_ncr';
  const isPaperNcrItemInquiryEmail = emailType === 'drive_customer_outreach' && emailSubType === 'paper_ncr_item_inquiry';
  const isSuspendTagPhotoSpecEmail = emailType === 'drive_customer_outreach' && emailSubType === 'suspend_tag_photo_spec';
  const formattedItemsHtmlRaw = String(payload.formattedItemsHtml || '').trim();
  const formattedItemsTextRaw = String(payload.formattedItemsText || '').trim();
  const isSuspendTagCompletionEmail = isSuspendTagCompletionEmail_(payload);
  const isEvalTaskCompletion = isEvalTaskCompletionEmail_(payload);
  const useFormattedApprovalLayout = isApprovalEmail
    && formattedItemsHtmlRaw
    && String(firstNonEmptyRequestValue_(payload.useFormattedApprovalLayout, payload.use_formatted_approval_layout, 'true')).trim().toLowerCase() !== 'false';
  const useFormattedItemsBody = (
    !!formattedItemsHtmlRaw
    || isDriveShiftReportEmail
    || isPaperNcrItemInquiryEmail
    || isSuspendTagPhotoSpecEmail
    || useFormattedApprovalLayout
  ) && !(emailType === 'request_complete' && !isSuspendTagCompletionEmail && !isEvalTaskCompletion);
  const repName = escapeEmailHtml_(payload.repName || payload.salesRepName || '');
  const customer = escapeEmailHtml_(payload.customer || 'N/A');
  const folderId = escapeEmailHtml_(payload.folderId || payload.requestFolder || '');
  const itemsCount = escapeEmailHtml_(payload.itemsCount || 0);
  const fallbackItemsHtml = emailType === 'request_complete'
    ? (isSuspendTagCompletionEmail ? buildSuspendTagCompletionItemsHtml_(payload) : (isEvalTaskCompletion ? buildCompactRequestItemsHtml_(payload) : buildCompletedRequestItemsHtml_(payload)))
    : (isApprovalEmail ? buildApprovalRequestItemsHtml_(payload) : buildRequestItemsHtml_(payload));
  const fallbackItemsText = isSuspendTagCompletionEmail
    ? buildSuspendTagCompletionItemsText_(payload)
    : (isApprovalEmail ? buildApprovalRequestItemsText_(payload) : buildRequestItemsText_(payload));
  const itemsHtml = useFormattedItemsBody ? (formattedItemsHtmlRaw || fallbackItemsHtml) : fallbackItemsHtml;
  const itemsText = useFormattedItemsBody ? (formattedItemsTextRaw || fallbackItemsText) : fallbackItemsText;
  const selectionSummaryHtml = buildRequestSelectionSummaryHtml_(payload);
  const selectionSummaryText = buildRequestSelectionSummaryText_(payload);
  const subject = buildRequestEmailSubject_(payload);
  const customerConsigneeSummaryHtml = buildCustomerConsigneeSummaryHtml_(payload);
  const customerConsigneeSummaryText = buildCustomerConsigneeSummaryText_(payload);
  const advertisementHeroHtml = buildAdvertisementEmailHeroHtml_(payload);
  const advertisementHeroText = buildAdvertisementEmailHeroText_(payload);

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
      htmlBody: buildPhoneSizedEmailHtml_([
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
      ].join(''))
    };
  }

  if (emailType === 'request_complete') {
    const completionHeading = payload.updatedCompletion === true ? 'Updated Plant Request Completion' : 'Plant Request Completed!';
    const folderNote = String(payload.folderNote || '').trim();
    const folderNoteHtml = folderNote ? '<p><strong>Folder Note:</strong> ' + escapeEmailHtml_(folderNote) + '</p>' : '';
    const completedBySummary = buildRequestCompletedBySummary_(payload);
    const completedBySummaryHtml = completedBySummary ? '<p><strong>Completed By:</strong> ' + escapeEmailHtml_(completedBySummary) + '</p>' : '';
    if (isSuspendTagCompletionEmail) {
      const brandLabelPlain = getSuspendTagCompletionBrandLabel_(payload);
      const brandLabel = escapeEmailHtml_(brandLabelPlain);
      const detailSection = itemsHtml
        ? [
            '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
            itemsHtml
          ].join('')
        : [
            '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
            '<p style="font-size: 12px; color: #777;">No Suspend Tag row details were provided.</p>'
          ].join('');

      return {
        subject: subject,
        textBody: [
          brandLabelPlain,
          itemsText
        ].filter(Boolean).join('\n\n'),
        htmlBody: buildPhoneSizedEmailHtml_([
          '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
          '<h2 style="color: #007a4d;">' + brandLabel + '</h2>',
          detailSection,
          '</div>'
        ].join(''))
      };
    }
    if (isEvalTaskCompletion) {
      const evalSummary = getEvalTaskCompletionSummary_(payload);
      const evalRequesterHtml = evalSummary.requester ? '<p><strong>Requested By:</strong> ' + escapeEmailHtml_(evalSummary.requester) + '</p>' : '';
      const evalReviewerHtml = evalSummary.reviewer ? '<p><strong>Assigned Reviewer:</strong> ' + escapeEmailHtml_(evalSummary.reviewer) + '</p>' : '';
      const evalCompletedByHtml = evalSummary.completedBy ? '<p><strong>Completed By:</strong> ' + escapeEmailHtml_(evalSummary.completedBy) + '</p>' : '';
      const evalDetailSection = itemsHtml
        ? [
            '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
            folderNoteHtml,
            '<p style="font-weight:700; margin-bottom:12px;">Reviewed Crop Rows</p>',
            itemsHtml
          ].join('')
        : [
            '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
            folderNoteHtml,
            '<p style="font-size: 12px; color: #777;">No reviewed crop row details were provided.</p>'
          ].join('');

      return {
        subject: subject,
        textBody: [
          'EVAL Crop Review Completed',
          'This crop review has been completed and is ready for the requesting team to review.',
          'Review Type: ' + String(evalSummary.taskType || 'Crop Review'),
          evalSummary.requester ? 'Requested By: ' + evalSummary.requester : '',
          evalSummary.reviewer ? 'Assigned Reviewer: ' + evalSummary.reviewer : '',
          evalSummary.completedBy ? 'Completed By: ' + evalSummary.completedBy : '',
          'Folder ID: ' + String(payload.folderId || payload.requestFolder || ''),
          'Total Items Reviewed: ' + String(payload.itemsCount || 0),
          folderNote ? 'Folder Note: ' + folderNote : '',
          itemsText
        ].filter(Boolean).join('\n\n'),
        htmlBody: buildPhoneSizedEmailHtml_([
          '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
          '<h2 style="color: #007a4d;">EVAL Crop Review Completed</h2>',
          '<p>This crop review has been completed and is ready for the requesting team to review.</p>',
          '<p><strong>Review Type:</strong> ' + escapeEmailHtml_(evalSummary.taskType || 'Crop Review') + '</p>',
          evalRequesterHtml,
          evalReviewerHtml,
          evalCompletedByHtml,
          '<p><strong>Folder ID:</strong> ' + folderId + '</p>',
          '<p><strong>Total Items Reviewed:</strong> ' + itemsCount + '</p>',
          '<p style="padding:12px 14px; border-radius:10px; background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46;">Requested crop update for NCR, Move Up, or Hold action as listed on the row.</p>',
          evalDetailSection,
          '</div>'
        ].join(''))
      };
    }
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
        completionHeading,
        'Hello ' + String(payload.repName || payload.salesRepName || '') + ',',
        'Your recent plant request has been fully processed and marked as complete.',
        'Customer: ' + String(payload.customer || ''),
        'Folder ID: ' + String(payload.folderId || payload.requestFolder || ''),
        'Total Items Fulfilled: ' + String(payload.itemsCount || 0),
        folderNote ? 'Folder Note: ' + folderNote : '',
        completedBySummary ? 'Completed By: ' + completedBySummary : '',
        itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: buildPhoneSizedEmailHtml_([
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + escapeEmailHtml_(completionHeading) + '</h2>',
        '<p>Hello ' + repName + ',</p>',
        '<p>Your recent plant request has been fully processed and marked as complete.</p>',
        '<p><strong>Customer:</strong> ' + customer + '</p>',
        '<p><strong>Folder ID:</strong> ' + folderId + '</p>',
        '<p><strong>Total Items Fulfilled:</strong> ' + itemsCount + '</p>',
        detailSection,
        '</div>'
      ].join(''))
    };
  }

  if (emailType === 'bloom_purpose_report') {
    const brandLabelPlain = String(payload.brandLabel || payload.fromName || payload.emailDisplayName || 'GNC PH Report').trim() || 'GNC PH Report';
    const brandLabel = escapeEmailHtml_(brandLabelPlain);
    const actionLabelPlain = String(payload.actionLabel || payload.action_label || 'Request').trim() || 'Request';
    const actionLabel = escapeEmailHtml_(actionLabelPlain);
    const actionKey = String(payload.action || payload.purpose || payload.emailPurpose || payload.email_purpose || actionLabelPlain || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const isOffHoldReport = actionKey === 'take_off_hold' || actionKey === 'off_hold' || actionKey === 'hold_release' || actionLabelPlain.toLowerCase() === 'off hold' || brandLabelPlain.toLowerCase().indexOf('off hold') !== -1;
    const reasonLabelPlain = String(payload.reasonLabel || payload.reason_label || 'Reason').trim() || 'Reason';
    const reasonLabel = escapeEmailHtml_(reasonLabelPlain);
    const reasonText = String(payload.reason || payload.message || payload.userMessage || '').trim();
    const requestedByText = String(payload.requestedByDisplay || payload.requestedBy || payload.submittedBy || 'Unknown').trim() || 'Unknown';
    const submittedLabel = String(payload.submittedAtLabel || payload.submittedAt || '').trim()
      || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy, h:mm:ss a');
    const recipients = dedupeEmailAddresses_([payload.recipientEmails, payload.emailRecipients, payload.recipients]);
    const formattedHtml = String(payload.formattedItemsHtml || '').trim();
    const formattedText = String(payload.formattedItemsText || '').trim();
    const customerText = String(payload.customer || 'N/A').trim() || 'N/A';
    const summaryHtml = [
      '<p><strong>' + actionLabel + ' Request Submitted</strong></p>',
      '<p><strong>Submitted By:</strong> ' + escapeEmailHtml_(requestedByText) + '</p>',
      '<p><strong>Submitted:</strong> ' + escapeEmailHtml_(submittedLabel) + '</p>',
      '<p><strong>Customer:</strong> ' + escapeEmailHtml_(customerText) + '</p>',
      '<p><strong>Items Requested:</strong> ' + escapeEmailHtml_(payload.itemsCount || 0) + '</p>',
      reasonText ? '<p><strong>' + reasonLabel + ':</strong> ' + escapeEmailHtml_(reasonText) + '</p>' : '',
      recipients.length ? '<p><strong>Recipients:</strong> ' + escapeEmailHtml_(recipients.join(', ')) + '</p>' : ''
    ].filter(Boolean).join('');
    const offHoldSummaryHtml = [
      '<h2 style="color: #007a4d; margin: 0 0 4px;">GNC PH</h2>',
      '<div style="font-size: 20px; font-weight: 800; color: #111827; margin: 0 0 14px;">Off Hold</div>',
      '<p><strong>Submitted By:</strong> ' + escapeEmailHtml_(requestedByText) + '</p>',
      '<p><strong>Submitted:</strong> ' + escapeEmailHtml_(submittedLabel) + '</p>'
    ].join('');
    const fallbackText = [
      brandLabelPlain,
      actionLabelPlain + ' Request Submitted',
      'Submitted By: ' + requestedByText,
      'Submitted: ' + submittedLabel,
      'Customer: ' + customerText,
      'Items Requested: ' + String(payload.itemsCount || 0),
      reasonText ? reasonLabelPlain + ': ' + reasonText : '',
      recipients.length ? 'Recipients: ' + recipients.join(', ') : '',
      itemsText
    ].filter(Boolean).join('\n\n');
    const offHoldText = [
      'GNC PH',
      'Off Hold',
      'Submitted By: ' + requestedByText,
      'Submitted: ' + submittedLabel,
      formattedText || itemsText
    ].filter(Boolean).join('\n\n');
    return {
      subject: subject,
      textBody: isOffHoldReport ? offHoldText : (formattedText || fallbackText),
      htmlBody: buildPhoneSizedEmailHtml_([
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        isOffHoldReport ? offHoldSummaryHtml : '<h2 style="color: #007a4d;">' + brandLabel + '</h2>',
        isOffHoldReport ? '' : summaryHtml,
        isOffHoldReport ? '' : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
        formattedHtml || itemsHtml || '<p style="font-size: 12px; color: #777;">No selected row details were provided.</p>',
        '</div>'
      ].join(''))
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
    const itemSectionTitle = isPaperNcrItemInquiryEmail
      ? ''
      : '<p style="font-weight:700; margin-bottom:12px;">' + (isGroupedBloomNcrEmail ? 'NCR Rows' : (isSuspendTagPhotoSpecEmail ? 'Suspend Tag Photo / Spec Rows' : 'Photo / Spec Rows')) + '</p>';
    const detailSection = itemsHtml
      ? [
          '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
          (isGroupedBloomNcrEmail || isPaperNcrItemInquiryEmail || isSuspendTagPhotoSpecEmail) ? '' : customerConsigneeSummaryHtml,
          itemSectionTitle,
          itemsHtml
        ].join('')
      : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">' + ((isGroupedBloomNcrEmail || isPaperNcrItemInquiryEmail) ? 'No NCR row details were provided.' : (isSuspendTagPhotoSpecEmail ? 'No Suspend Tag photo/spec rows were provided.' : 'No selected customer/source row details were provided.')) + '</p>';

    if (isPaperNcrItemInquiryEmail) {
      const paperNcrActionPlain = String(payload.customer || payload.requestCustomer || brandLabelPlain.replace(/^GNC PH\s*/i, '') || 'NCR').trim() || 'NCR';
      const paperNcrAction = escapeEmailHtml_(paperNcrActionPlain);
      const paperNcrSubmittedByPlain = String(payload.submittedBy || payload.requestedByDisplay || payload.requestedBy || payload.completedBy || 'Unknown').trim() || 'Unknown';
      const paperNcrSubmittedAtPlain = String(payload.submittedAtLabel || payload.submittedAt || payload.createdAt || '').trim()
        || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy, h:mm:ss a');
      const paperNcrSummaryHtml = [
        '<h2 style="color: #007a4d; margin: 0 0 4px;">GNC PH</h2>',
        '<div style="font-size: 20px; font-weight: 800; color: #111827; margin: 0 0 14px;">' + paperNcrAction + '</div>',
        '<p><strong>Submitted By:</strong> ' + escapeEmailHtml_(paperNcrSubmittedByPlain) + '</p>',
        '<p><strong>Submitted:</strong> ' + escapeEmailHtml_(paperNcrSubmittedAtPlain) + '</p>'
      ].join('');
      return {
        subject: subject,
        textBody: [
          'GNC PH',
          paperNcrActionPlain,
          'Submitted By: ' + paperNcrSubmittedByPlain,
          'Submitted: ' + paperNcrSubmittedAtPlain,
          itemsText
        ].filter(Boolean).join('\n\n'),
        htmlBody: buildPhoneSizedEmailHtml_([
          '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
          paperNcrSummaryHtml,
          itemsHtml || '<p style="font-size: 12px; color: #777;">No selected item inquiry row was provided.</p>',
          '</div>'
        ].join(''))
      };
    }

    return {
      subject: subject,
      textBody: [
        brandLabelPlain,
        plainAudienceLabel ? 'Hello ' + plainAudienceLabel + ',' : '',
        hideItemHeader ? '' : 'Item: ' + plainItem,
        (isGroupedBloomNcrEmail || isPaperNcrItemInquiryEmail || isSuspendTagPhotoSpecEmail) ? '' : customerConsigneeSummaryText,
        itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: buildPhoneSizedEmailHtml_([
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + brandLabel + '</h2>',
        audienceLabel ? '<p>Hello ' + audienceLabel + ',</p>' : '',
        hideItemHeader ? '' : '<p><strong>Item:</strong> ' + htmlItem + '</p>',
        detailSection,
        '</div>'
      ].join(''))
    };
  }

  if (isBlockClearingEmail) {
    const brandLabelPlain = String(payload.blockClearingTitle || payload.reportTitle || payload.workbookTitle || payload.brandLabel || payload.subject || payload.fromName || payload.emailDisplayName || 'GNC PH Block Clearing').trim() || 'GNC PH Block Clearing';
    const brandLabel = escapeEmailHtml_(brandLabelPlain);
    const requestedBy = String(payload.requestedByDisplay || payload.requestedBy || payload.sender || '').trim();
    const requestedByHtml = requestedBy ? '<p><strong>Sent By:</strong> ' + escapeEmailHtml_(requestedBy) + '</p>' : '';
    const blockAlpha = firstNonEmptyRequestValue_(payload.blockalpha, payload.blockAlpha, payload.BLOCKALPHA, '');
    const locationCode = firstNonEmptyRequestValue_(payload.locationcode, payload.locationCode, payload.LOCATIONCODE, '');
    const rowCount = Number(payload.itemsCount || payload.rowCount || 0) || 0;
    const groupCount = Number(payload.groupCount || (Array.isArray(payload.groupedInstructions) ? payload.groupedInstructions.length : 0) || 0) || 0;
    const attachmentName = firstNonEmptyRequestValue_(
      payload.shiftReportWorkbookFilename,
      payload.shiftReportAttachment && (payload.shiftReportAttachment.filename || payload.shiftReportAttachment.fileName || payload.shiftReportAttachment.name),
      'Block Clearing.xlsx'
    );
    const summaryText = [
      brandLabelPlain,
      requestedBy ? 'Sent By: ' + requestedBy : '',
      blockAlpha ? 'Block: ' + blockAlpha : '',
      locationCode ? 'Location: ' + locationCode : '',
      'Rows: ' + String(rowCount),
      'Itemcode Groups: ' + String(groupCount),
      'Excel workbook attached: ' + attachmentName,
      itemsText
    ].filter(Boolean).join('\n\n');
    const summaryHtml = [
      '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
      '<h2 style="color: #007a4d; margin: 0 0 8px;">' + brandLabel + '</h2>',
      requestedByHtml,
      '<p><strong>Block:</strong> ' + escapeEmailHtml_(blockAlpha || '-') + '<br><strong>Location:</strong> ' + escapeEmailHtml_(locationCode || '-') + '<br><strong>Rows:</strong> ' + escapeEmailHtml_(rowCount) + '<br><strong>Itemcode Groups:</strong> ' + escapeEmailHtml_(groupCount) + '</p>',
      '<p style="padding:12px 14px; border-radius:10px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8;"><strong>Excel file:</strong> ' + escapeEmailHtml_(attachmentName) + ' is attached.</p>',
      itemsHtml || '<p style="font-size: 12px; color: #777;">No Block Clearing row details were provided.</p>',
      '</div>'
    ].join('');
    return {
      subject: subject,
      textBody: summaryText,
      htmlBody: buildPhoneSizedEmailHtml_(summaryHtml)
    };
  }

  if (emailType === 'drive_shift_report') {
    const brandLabelPlain = String(payload.brandLabel || payload.fromName || payload.emailDisplayName || 'GNC PH Shift').trim() || 'GNC PH Shift';
    const brandLabel = escapeEmailHtml_(brandLabelPlain);
    const userMessage = String(payload.message || payload.userMessage || '').trim();
    const requestedBy = String(payload.requestedByDisplay || payload.requestedBy || '').trim();
    const requestedByHtml = requestedBy ? '<p><strong>Sent By:</strong> ' + escapeEmailHtml_(requestedBy) + '</p>' : '';
    const reportFormat = String(payload.shiftReportFormat || '').trim().toLowerCase() === 'excel' ? 'excel' : 'report';
    const columns = Array.isArray(payload.shiftReportColumns) ? payload.shiftReportColumns : [];
    const columnCount = columns.length || 0;
    const messageHtml = userMessage
      ? [
          '<div style="white-space:pre-wrap; margin:16px 0 20px; padding:14px 16px; background:#f0fdf4; border-left:4px solid #007a4d; border-radius:8px; font-size:14px; line-height:1.45;">',
          escapeEmailHtml_(userMessage),
          '</div>'
        ].join('')
      : '';
    const attachmentNoteHtml = reportFormat === 'excel'
      ? '<p style="padding:12px 14px; border-radius:10px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8;"><strong>Excel file:</strong> Attached as an Excel workbook.</p>'
      : '';
    const attachmentNoteText = reportFormat === 'excel'
      ? 'Excel workbook attached.'
      : '';
    const detailSection = reportFormat === 'excel'
      ? '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">Open the attached Excel workbook to view the selected Drive Mode headers.</p>'
      : (itemsHtml
        ? [
            '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">',
            '<p style="font-weight:700; margin-bottom:12px;">Drive Mode Rows</p>',
            itemsHtml
          ].join('')
        : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">No Drive row details were provided.</p>');

    return {
      subject: subject,
      textBody: [
        brandLabelPlain,
        requestedBy ? 'Sent By: ' + requestedBy : '',
        'Rows: ' + String(payload.itemsCount || 0),
        columnCount ? 'Headers Included: ' + columnCount : '',
        attachmentNoteText,
        userMessage,
        reportFormat === 'excel' ? '' : itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: buildPhoneSizedEmailHtml_([
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + brandLabel + '</h2>',
        requestedByHtml,
        '<p><strong>Rows:</strong> ' + escapeEmailHtml_(payload.itemsCount || 0) + '</p>',
        columnCount ? '<p><strong>Headers Included:</strong> ' + escapeEmailHtml_(columnCount) + '</p>' : '',
        attachmentNoteHtml,
        messageHtml,
        detailSection,
        '</div>'
      ].join(''))
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
          advertisementHeroHtml,
          customerConsigneeSummaryHtml,
          '<p style="font-weight:700; margin-bottom:12px;">Crop Update Rows</p>',
          cropItemsHtml
        ].join('')
      : '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;"><p style="font-size: 12px; color: #777;">No row details were provided.</p>';

    return {
      subject: subject,
      textBody: [
        brandLabelPlain,
        requestedBy ? 'Sent By: ' + requestedBy : '',
        userMessage,
        advertisementHeroText,
        customerConsigneeSummaryText,
        cropItemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: buildPhoneSizedEmailHtml_([
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + brandLabel + '</h2>',
        requestedByHtml,
        messageHtml,
        detailSection,
        '</div>'
      ].join(''))
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
      htmlBody: buildPhoneSizedEmailHtml_([
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">PH NCR Review Completed</h2>',
        '<p><strong>Completed By:</strong> ' + completedBy + '</p>',
        '<p><strong>Source Row:</strong> ' + folderId + '</p>',
        detailSection,
        '</div>'
      ].join(''))
    };
  }

  if (emailType === 'ncr_approval' || emailType === 'hold_release_request') {
    const approvalTitleText = String(payload.approvalLabel || payload.approval_label || payload.customer || (emailType === 'hold_release_request' ? 'Take Off Hold' : 'Approval')).trim();
    const approvalTitle = escapeEmailHtml_(approvalTitleText);
    const approvalStage = escapeEmailHtml_(payload.approvalStageLabel || payload.approvalStage || 'Approval needed');
    const sentByText = firstNonEmptyRequestValue_(
      payload.completedBy,
      payload.completed_by,
      payload.completedByDisplay,
      payload.completed_by_display,
      payload.sentBy,
      payload.sent_by,
      'Unknown'
    );
    const completedBy = escapeEmailHtml_(sentByText);
    const submittedBySummary = firstNonEmptyRequestValue_(
      payload.submittedBySummary,
      payload.submitted_by_summary,
      payload.requestedByDisplay,
      payload.requested_by_display,
      payload.requestedBy,
      payload.requested_by,
      payload.requestedByUsername,
      payload.requested_by_username,
      ''
    );
    const submittedByHtml = submittedBySummary ? '<p><strong>Submitted By:</strong> ' + escapeEmailHtml_(submittedBySummary) + '</p>' : '';
    const approvalTypeText = String(payload.approvalType || payload.approval_type || payload.approvalLabel || payload.approval_label || payload.customer || '').trim().toLowerCase().replace(/_/g, '-');
    const isHoldReleaseApproval = approvalTypeText.indexOf('hold-release') !== -1 || approvalTypeText.indexOf('hold') !== -1 || approvalTypeText.indexOf('take off hold') !== -1;
    let appInstructionText = String(payload.appInstruction || payload.app_instruction || '').trim();
    if (isHoldReleaseApproval && appInstructionText) {
      appInstructionText = appInstructionText.replace(/Tasks\s*>\s*AV\s*BLANKS/ig, 'Tasks > Off Hold Approval');
    }
    if (isHoldReleaseApproval && !appInstructionText && String(payload.approvalStage || payload.approval_stage || '').trim().toLowerCase() !== 'inventory') {
      appInstructionText = 'Open the app and check Tasks > Off Hold Approval. Review the photos/data, then approve.';
    }
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
    const approvalButtonHtml = buildApprovalEmailButtonBlock_(payload);
    const approvalButtonText = buildApprovalEmailButtonText_(payload);
    const approvalPhotoHtml = buildApprovalEmailPhotoSectionHtml_(payload);
    const approvalPhotoText = buildApprovalEmailPhotoSectionText_(payload);

    if (isHoldReleaseApproval) {
      const holdSubmittedByText = String(submittedBySummary || sentByText || 'Unknown').trim() || 'Unknown';
      let holdSubmittedLabel = String(payload.submittedAtLabel || payload.submitted_at_label || '').trim();
      if (!holdSubmittedLabel) {
        const submittedStamp = firstNonEmptyRequestValue_(
          payload.submittedAt,
          payload.submitted_at,
          payload.ncr_requested_at,
          payload.requestedAt,
          payload.requested_at,
          ''
        );
        let submittedDate = submittedStamp ? new Date(submittedStamp) : new Date();
        if (isNaN(submittedDate.getTime())) submittedDate = new Date();
        holdSubmittedLabel = Utilities.formatDate(submittedDate, Session.getScriptTimeZone(), 'M/d/yyyy, h:mm:ss a');
      }
      const holdItemsHtml = String(payload.formattedItemsHtml || '').trim()
        || itemsHtml
        || '<p style="font-size: 12px; color: #777;">No selected row details were provided.</p>';
      const holdItemsText = String(payload.formattedItemsText || '').trim() || itemsText;
      return {
        subject: subject,
        textBody: [
          'GNC PH',
          'Off Hold',
          'Submitted By: ' + holdSubmittedByText,
          'Submitted: ' + holdSubmittedLabel,
          approvalButtonText,
          approvalPhotoText,
          holdItemsText
        ].filter(Boolean).join('\n\n'),
        htmlBody: buildPhoneSizedEmailHtml_([
          '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
          '<h2 style="color: #007a4d; margin: 0 0 4px;">GNC PH</h2>',
          '<div style="font-size: 20px; font-weight: 800; color: #111827; margin: 0 0 14px;">Off Hold</div>',
          '<p><strong>Submitted By:</strong> ' + escapeEmailHtml_(holdSubmittedByText) + '</p>',
          '<p><strong>Submitted:</strong> ' + escapeEmailHtml_(holdSubmittedLabel) + '</p>',
          approvalButtonHtml,
          holdItemsHtml,
          approvalPhotoHtml,
          '</div>'
        ].join(''))
      };
    }

    if (useFormattedApprovalLayout) {
      const approvalSubmittedByText = String(submittedBySummary || sentByText || 'Unknown').trim() || 'Unknown';
      const approvedByText = String(firstNonEmptyRequestValue_(
        payload.approvedBy,
        payload.approved_by,
        payload.completedByDisplay,
        payload.completed_by_display,
        payload.completedBy,
        payload.completed_by,
        sentByText,
        ''
      ) || '').trim();
      let approvalSubmittedLabel = String(payload.submittedAtLabel || payload.submitted_at_label || '').trim();
      if (!approvalSubmittedLabel) {
        const submittedStamp = firstNonEmptyRequestValue_(
          payload.submittedAt,
          payload.submitted_at,
          payload.ncr_requested_at,
          payload.requestedAt,
          payload.requested_at,
          ''
        );
        let submittedDate = submittedStamp ? new Date(submittedStamp) : new Date();
        if (isNaN(submittedDate.getTime())) submittedDate = new Date();
        approvalSubmittedLabel = Utilities.formatDate(submittedDate, Session.getScriptTimeZone(), 'M/d/yyyy, h:mm:ss a');
      }
      const approvalActionLabel = approvalTitleText || 'Approval';
      return {
        subject: subject,
        textBody: [
          'GNC PH',
          approvalActionLabel,
          'Submitted By: ' + approvalSubmittedByText,
          approvedByText ? 'Approved By: ' + approvedByText : '',
          'Submitted: ' + approvalSubmittedLabel,
          appInstructionText ? 'Next step: ' + appInstructionText : '',
          approvalButtonText,
          approvalPhotoText,
          itemsText
        ].filter(Boolean).join('\n\n'),
        htmlBody: buildPhoneSizedEmailHtml_([
          '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
          '<h2 style="color: #007a4d; margin: 0 0 4px;">GNC PH</h2>',
          '<div style="font-size: 20px; font-weight: 800; color: #111827; margin: 0 0 14px;">' + escapeEmailHtml_(approvalActionLabel) + '</div>',
          '<p><strong>Submitted By:</strong> ' + escapeEmailHtml_(approvalSubmittedByText) + '</p>',
          approvedByText ? '<p><strong>Approved By:</strong> ' + escapeEmailHtml_(approvedByText) + '</p>' : '',
          '<p><strong>Submitted:</strong> ' + escapeEmailHtml_(approvalSubmittedLabel) + '</p>',
          appInstructionHtml,
          approvalButtonHtml,
          itemsHtml || '<p style="font-size: 12px; color: #777;">No selected row details were provided.</p>',
          approvalPhotoHtml,
          '</div>'
        ].join(''))
      };
    }

    return {
      subject: subject,
      textBody: [
        approvalTitleText + ' Approval',
        'Stage: ' + String(payload.approvalStageLabel || payload.approvalStage || 'Approval needed'),
        appInstructionText ? 'Next step: ' + appInstructionText : '',
        approvalButtonText,
        approvalPhotoText,
        'Sent By: ' + sentByText,
        submittedBySummary ? 'Submitted By: ' + submittedBySummary : '',
        'Source Row: ' + String(payload.folderId || payload.requestFolder || ''),
        itemsText
      ].filter(Boolean).join('\n\n'),
      htmlBody: buildPhoneSizedEmailHtml_([
        '<div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">',
        '<h2 style="color: #007a4d;">' + approvalTitle + ' Approval</h2>',
        '<p><strong>Stage:</strong> ' + approvalStage + '</p>',
        appInstructionHtml,
        approvalButtonHtml,
        '<p><strong>Sent By:</strong> ' + completedBy + '</p>',
        submittedByHtml,
        '<p><strong>Source Row:</strong> ' + folderId + '</p>',
        detailSection,
        approvalPhotoHtml,
        '</div>'
      ].join(''))
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
  const alternativeBoundary = 'gnc_alt_' + Utilities.getUuid().replace(/-/g, '');
  const mixedBoundary = 'gnc_mix_' + Utilities.getUuid().replace(/-/g, '');
  const attachments = Array.isArray(options.attachments) ? options.attachments.filter(Boolean) : [];
  const lines = [
    'MIME-Version: 1.0',
    'To: ' + String(options.toList || '')
  ];
  const fromHeader = formatMimeMailbox_(options.fromName, options.fromAddress);
  if (fromHeader) lines.push('From: ' + fromHeader);
  const messageIdHeader = String(options.messageIdHeader || '').trim();
  if (messageIdHeader) lines.push('Message-ID: ' + messageIdHeader);
  lines.push('Subject: ' + String(options.subject || ''));
  lines.push('Content-Type: ' + (attachments.length
    ? 'multipart/mixed; boundary="' + mixedBoundary + '"'
    : 'multipart/alternative; boundary="' + alternativeBoundary + '"'));

  const inReplyTo = String(options.inReplyTo || '').trim();
  const references = String(options.references || '').trim();
  if (inReplyTo) lines.push('In-Reply-To: ' + inReplyTo);
  if (references) lines.push('References: ' + references);

  lines.push('');
  if (attachments.length) {
    lines.push('--' + mixedBoundary);
    lines.push('Content-Type: multipart/alternative; boundary="' + alternativeBoundary + '"');
    lines.push('');
  }
  lines.push('--' + alternativeBoundary);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('');
  lines.push(String(options.textBody || ''));
  lines.push('');
  lines.push('--' + alternativeBoundary);
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('');
  lines.push(String(options.htmlBody || ''));
  lines.push('');
  lines.push('--' + alternativeBoundary + '--');

  attachments.forEach(function(blob, index) {
    const safeName = String(blob.getName && blob.getName() || ('attachment-' + (index + 1)))
      .replace(/[\r\n"\\]+/g, '_').replace(/[\/:*?<>|]+/g, '-').trim() || ('attachment-' + (index + 1));
    const contentType = String(blob.getContentType && blob.getContentType() || 'application/octet-stream').replace(/[\r\n]+/g, '').trim() || 'application/octet-stream';
    const encoded = Utilities.base64Encode(blob.getBytes()).replace(/(.{76})/g, '$1\r\n');
    lines.push('');
    lines.push('--' + mixedBoundary);
    lines.push('Content-Type: ' + contentType + '; name="' + safeName + '"');
    lines.push('Content-Disposition: attachment; filename="' + safeName + '"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(encoded);
  });
  if (attachments.length) {
    lines.push('');
    lines.push('--' + mixedBoundary + '--');
  }

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

function getApprovalEmailDisplayName_(payload) {
  const explicitName = String(
    payload && (
      payload.fromName ||
      payload.brandLabel ||
      payload.emailDisplayName ||
      payload.sourceLabel
    ) || ''
  ).trim();
  if (explicitName) return explicitName;
  const approvalType = String(payload && (payload.approvalType || payload.approval_type) || '').trim().toLowerCase().replace(/_/g, '-');
  if (approvalType.indexOf('hold-release') !== -1 || approvalType.indexOf('hold') !== -1) return 'GNC PH HOLD REMOVAL';
  if (approvalType.indexOf('recount') !== -1 || approvalType.indexOf('re-count') !== -1) return 'GNC PH RE-COUNT';
  if (approvalType.indexOf('move-down') !== -1 || approvalType.indexOf('movedown') !== -1) return 'GNC PH MOVE DOWN';
  if (approvalType.indexOf('move-up') !== -1 || approvalType.indexOf('move') !== -1) return 'GNC PH MOVE UP';
  return 'GNC PH NCR';
}

function getRequestEmailDisplayName_(payload) {
  const explicitName = String(
    payload && (
      payload.fromName ||
      payload.brandLabel ||
      payload.emailDisplayName ||
      payload.sourceLabel
    ) || ''
  ).trim();
  if (explicitName) return explicitName;
  if (isSuspendTagCompletionEmail_(payload)) return 'GNC PH Suspend Tag';
  return 'GNC PH Request';
}

function buildRequestEmailAttachmentBlob_(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  let base64 = String(
    attachment.contentBase64 ||
    attachment.base64 ||
    attachment.dataBase64 ||
    attachment.data ||
    attachment.content ||
    ''
  ).trim();
  if (!base64) return null;
  const dataUrlMatch = base64.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
  let mimeType = String(attachment.mimeType || attachment.contentType || '').trim();
  if (dataUrlMatch) {
    if (!mimeType && dataUrlMatch[1]) mimeType = dataUrlMatch[1];
    base64 = String(dataUrlMatch[2] || '').trim();
  }
  if (!base64) return null;
  const filenameRaw = String(
    attachment.filename ||
    attachment.fileName ||
    attachment.name ||
    'GNC-PH-Shift.xlsx'
  ).trim() || 'GNC-PH-Shift.xlsx';
  const filename = filenameRaw.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim() || 'GNC-PH-Shift.xlsx';
  const safeMimeType = mimeType || 'application/octet-stream';
  try {
    return Utilities.newBlob(Utilities.base64Decode(base64), safeMimeType, filename);
  } catch (error) {
    console.error('Email attachment decode failed', error);
    return null;
  }
}

function buildDriveShiftReportAttachments_(payload) {
  const reportFormat = String(payload && payload.shiftReportFormat || '').trim().toLowerCase();
  if (reportFormat !== 'excel') return [];
  const explicitAttachments = [];
  const candidates = [];
  if (payload && payload.shiftReportAttachment) candidates.push(payload.shiftReportAttachment);
  if (payload && Array.isArray(payload.shiftReportAttachments)) {
    payload.shiftReportAttachments.forEach(function(attachment) { candidates.push(attachment); });
  }
  if (payload && Array.isArray(payload.attachments)) {
    payload.attachments.forEach(function(attachment) { candidates.push(attachment); });
  }
  candidates.forEach(function(attachment) {
    const blob = buildRequestEmailAttachmentBlob_(attachment);
    if (blob) explicitAttachments.push(blob);
  });
  if (explicitAttachments.length) return explicitAttachments;

  const csv = String(payload && payload.shiftReportCsv || '');
  if (!csv) return [];
  const rawName = String(payload && payload.shiftReportFilename || 'GNC-PH-Shift.csv').trim() || 'GNC-PH-Shift.csv';
  const safeName = rawName.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim() || 'GNC-PH-Shift.csv';
  const filename = /\.csv$/i.test(safeName) ? safeName : safeName + '.csv';
  return [Utilities.newBlob(csv, 'text/csv', filename)];
}

function decorateRequestLifecycleEmailResult_(payload, result, recipients) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const safeType = String(safePayload.emailType || '').trim().toLowerCase();
  if (safeType !== 'new_request' && safeType !== 'request_complete') return result;

  const recipientList = dedupeEmailAddresses_(
    recipients && Array.isArray(recipients.toArray) ? recipients.toArray : result && result.recipients
  );
  const requiredRecipientsSatisfied = REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_.every(function(email) {
    return recipientList.indexOf(normalizeEmailAddress_(email)) !== -1;
  });
  const submitterEmails = collectRequestSubmitterEmails_(safePayload);
  const submitterIncluded = submitterEmails.length === 0 || submitterEmails.every(function(email) {
    return recipientList.indexOf(normalizeEmailAddress_(email)) !== -1;
  });

  return Object.assign({}, result || {}, {
    lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_RECIPIENT_POLICY_VERSION_,
    requiredRecipientCount: REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_.length,
    requiredRecipientsSatisfied: requiredRecipientsSatisfied,
    submitterRecorded: submitterEmails.length > 0,
    submitterIncluded: submitterIncluded
  });
}

function sendRequestEmailWithFallback_(payload) {
  if (String(payload && payload.emailType || '').trim().toLowerCase() === 'request_complete') {
    payload = hydrateRequestCompletePayload_(payload);
  }
  const safeType = String(payload && payload.emailType || '').trim().toLowerCase();
  const recipients = collectRequestRecipients_(payload);
  if (!recipients.toArray.length) {
    return decorateRequestLifecycleEmailResult_(payload, {
      ok: false,
      status: 400,
      message: 'No valid request email recipients were resolved.',
      recipients: []
    }, recipients);
  }

  const message = buildRequestEmailMessage_(payload);
  if (safeType === 'ncr_complete') {
    const ncrCompleteName = String(payload.fromName || payload.brandLabel || payload.emailDisplayName || 'GNC PH NCR').trim() || 'GNC PH NCR';
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, {
        htmlBody: message.htmlBody,
        name: ncrCompleteName
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
  if (safeType === 'bloom_purpose_report') {
    const bloomPurposeName = String(payload.fromName || payload.brandLabel || payload.emailDisplayName || 'GNC PH Report').trim() || 'GNC PH Report';
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, {
        htmlBody: message.htmlBody,
        name: bloomPurposeName
      });
      return {
        ok: true,
        status: 200,
        recipients: recipients.toArray,
        mode: 'gmailapp_named'
      };
    } catch (error) {
      console.error('Bloom purpose report email send failed', error);
      return {
        ok: false,
        status: 500,
        recipients: recipients.toArray,
        mode: 'gmailapp_error',
        message: error && error.message ? error.message : 'Bloom purpose report email send failed.'
      };
    }
  }
  if (safeType === 'drive_shift_report' || safeType === 'block_clearing_email') {
    const isBlockClearingEmail = safeType === 'block_clearing_email' || String(payload.emailSubType || payload.email_sub_type || '').trim().toLowerCase() === 'block_clearing_email' || payload.blockClearingEmail === true;
    const driveShiftName = String(payload.fromName || payload.emailDisplayName || (isBlockClearingEmail ? 'GNC PH Block Clearing' : payload.brandLabel) || (isBlockClearingEmail ? 'GNC PH Block Clearing' : 'GNC PH Shift')).trim() || 'GNC PH Shift';
    const attachments = buildDriveShiftReportAttachments_(payload);
    const options = {
      htmlBody: message.htmlBody,
      name: driveShiftName
    };
    if (attachments.length) options.attachments = attachments;
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, options);
      return {
        ok: true,
        status: 200,
        recipients: recipients.toArray,
        mode: attachments.length ? 'gmailapp_named_attachment' : 'gmailapp_named'
      };
    } catch (error) {
      console.error((isBlockClearingEmail ? 'Block Clearing' : 'Drive shift report') + ' email send failed', error);
      return {
        ok: false,
        status: 500,
        recipients: recipients.toArray,
        mode: 'gmailapp_error',
        message: error && error.message ? error.message : (isBlockClearingEmail ? 'Block Clearing email send failed.' : 'Drive shift report email send failed.')
      };
    }
  }
  if (safeType === 'ncr_approval' || safeType === 'hold_release_request') {
    const approvalEmailName = getApprovalEmailDisplayName_(payload);
    try {
      GmailApp.sendEmail(recipients.toList, message.subject, message.textBody || message.subject, {
        htmlBody: message.htmlBody,
        name: approvalEmailName
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
    return decorateRequestLifecycleEmailResult_(payload, {
      ok: false,
      status: 500,
      recipients: recipients.toArray,
      mode: 'gmail_api_unavailable',
      message: 'Gmail Advanced Service is required for request emails but is not available in this Apps Script deployment.'
    }, recipients);
  }

  try {
    const result = sendGmailApiMessage_({
      toList: recipients.toList,
      toArray: recipients.toArray,
      subject: message.subject,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      fromName: getRequestEmailDisplayName_(payload),
      fromAddress: senderAddress,
      threadId: wantsThreadReply && canReplyInThread ? threadId : '',
      inReplyTo: wantsThreadReply && canReplyInThread ? inReplyTo : '',
      references: wantsThreadReply && canReplyInThread ? inReplyTo : '',
      messageIdHeader: String(payload.messageIdHeader || '').trim()
    });
    if (wantsThreadReply && !canReplyInThread) {
      result.mode = 'gmail_api_fresh_completion';
      result.message = 'Request completion email sent as a fresh email because the original thread metadata was unavailable.';
    }
    return decorateRequestLifecycleEmailResult_(payload, result, recipients);
  } catch (error) {
    console.error('Gmail API send failed for request email', error);
    return decorateRequestLifecycleEmailResult_(payload, {
      ok: false,
      status: 500,
      recipients: recipients.toArray,
      mode: 'gmail_api_error',
      message: error && error.message ? error.message : 'Request email send failed.'
    }, recipients);
  }
}

function requestDeliveryRest_(tableName, method, query, payload, prefer) {
  const safeTable = String(tableName || '').trim();
  const safeMethod = String(method || 'GET').trim().toUpperCase();
  const suffix = String(query || '').trim();
  const options = {
    method: safeMethod.toLowerCase(),
    headers: getSupabaseHeadersForKey_(SUPABASE_KEY, {
      'Content-Type': 'application/json',
      Prefer: prefer || (safeMethod === 'GET' ? 'count=none' : 'return=representation')
    }),
    muteHttpExceptions: true
  };
  if (payload !== undefined && payload !== null && safeMethod !== 'GET') {
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/' + safeTable + (suffix ? '?' + suffix : ''),
    options
  );
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    const error = new Error('Request delivery database operation failed (' + status + ').');
    error.status = status;
    throw error;
  }
  return text ? JSON.parse(text) : [];
}

function sendRequestDeliveryPush_(eventRow, requestRows) {
  const eventType = String(eventRow && eventRow.event_type || '').trim();
  const payload = eventRow && eventRow.payload && typeof eventRow.payload === 'object' ? eventRow.payload : {};
  const firstRow = Array.isArray(requestRows) && requestRows.length ? requestRows[0] : {};
  const pushType = eventType === 'request_created' ? 'new_request'
    : eventType === 'request_completed' ? 'request_complete'
    : eventType;
  const body = {
    eventType: pushType,
    folderId: String(eventRow && eventRow.request_folder || firstRow.request_folder || ''),
    repName: String(firstRow.requested_by || ''),
    requestedBy: String(firstRow.requested_by || ''),
    requestedByUsername: String(firstRow.request_selected_rep_username || firstRow.requested_by || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    customer: String(firstRow.req_customer || ''),
    itemsCount: Array.isArray(requestRows) ? requestRows.length : 0,
    requestIds: Array.isArray(requestRows) ? requestRows.map(function(row) { return row.unique_id; }).filter(Boolean) : [],
    itemcode: String(payload.itemcode || ''),
    unassignedCount: Math.max(0, Number(payload.unassigned_count) || 0),
    managerUsernames: Array.isArray(payload.manager_usernames) ? payload.manager_usernames : []
  };
  const response = UrlFetchApp.fetch(SUPABASE_URL + '/functions/v1/send-push-alert', {
    method: 'post',
    contentType: 'application/json',
    headers: getSupabaseHeadersForKey_(SUPABASE_KEY),
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('PUSH_SEND_FAILED');
  return true;
}

function getRequestDeliveryRows_(eventRow) {
  const payload = eventRow && eventRow.payload && typeof eventRow.payload === 'object' ? eventRow.payload : {};
  const requestIds = normalizeRequestIdList_(
    payload.request_ids || payload.requestIds || (eventRow && eventRow.request_id ? [eventRow.request_id] : [])
  );
  if (String(eventRow && eventRow.event_type || '') === 'request_created') {
    const snapshots = Array.isArray(payload.requests) ? payload.requests.filter(Boolean) : [];
    if (snapshots.length) return snapshots;
    return fetchRequestRowsForEmailRequestIds_(requestIds);
  }
  if (String(eventRow && eventRow.event_type || '') === 'request_completed') {
    return fetchRequestHistoryRowsForEmailRequestIds_(requestIds);
  }
  return [];
}

function buildRequestDeliveryEmailPayload_(eventRow, rows) {
  const firstRow = Array.isArray(rows) && rows.length ? rows[0] : {};
  const eventType = String(eventRow && eventRow.event_type || '').trim();
  const requestCreatedByUsername = String(firstRow.request_created_by_username || '');
  const requestCreatedByDisplay = String(firstRow.request_created_by_display || '');
  const requestCreatedByEmail = String(firstRow.request_created_by_email || '');
  const deliveryPayload = eventRow && eventRow.payload && typeof eventRow.payload === 'object' ? eventRow.payload : {};
  const updatedCompletion = eventType === 'request_completed' && deliveryPayload.updatedCompletion === true;
  return {
    type: 'email',
    emailType: eventType === 'request_completed' ? 'request_complete' : 'new_request',
    folderId: String(eventRow && eventRow.request_folder || firstRow.request_folder || ''),
    requestFolder: String(eventRow && eventRow.request_folder || firstRow.request_folder || ''),
    repName: String(firstRow.requested_by || ''),
    requestedBy: String(firstRow.requested_by || ''),
    customer: String(firstRow.req_customer || ''),
    itemsCount: Array.isArray(rows) ? rows.length : 0,
    requestItems: Array.isArray(rows) ? rows : [],
    items: Array.isArray(rows) ? rows : [],
    requestIds: Array.isArray(rows) ? rows.map(function(row) { return row.unique_id; }).filter(Boolean) : [],
    requestCreatedByUsername: requestCreatedByUsername,
    requestCreatedByDisplay: requestCreatedByDisplay,
    requestCreatedByEmail: requestCreatedByEmail,
    submittedByUsername: requestCreatedByUsername,
    submittedByDisplay: requestCreatedByDisplay,
    submittedByEmail: requestCreatedByEmail,
    internalRecipients: REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_.slice(),
    updatedCompletion: updatedCompletion,
    subject: updatedCompletion ? 'Updated Completion - ' + String(eventRow && eventRow.request_folder || firstRow.request_folder || '') : '',
    requestCreator: {
      creatorUsername: requestCreatedByUsername,
      creatorDisplay: requestCreatedByDisplay,
      creatorEmail: requestCreatedByEmail,
      selectedRepUsername: String(firstRow.request_selected_rep_username || ''),
      selectedRepDisplay: String(firstRow.request_selected_rep_display || ''),
      selectedRepEmail: String(firstRow.request_selected_rep_email || '')
    }
  };
}

function requestDeliveryBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function requestDeliverySafeEqual_(left, right) {
  const leftText = String(left || '');
  const rightText = String(right || '');
  let mismatch = leftText.length ^ rightText.length;
  const length = Math.max(leftText.length, rightText.length);
  for (let i = 0; i < length; i++) {
    mismatch |= (leftText.charCodeAt(i % Math.max(leftText.length, 1)) || 0)
      ^ (rightText.charCodeAt(i % Math.max(rightText.length, 1)) || 0);
  }
  return mismatch === 0;
}

function requestDeliveryReceiptKey_(messageIdHeader) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(messageIdHeader || ''),
    Utilities.Charset.UTF_8
  );
  return REQUEST_DELIVERY_RECEIPT_PREFIX + requestDeliveryBase64Url_(digest).slice(0, 40);
}

function getRequestDeliveryReceipt_(messageIdHeader) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(requestDeliveryReceiptKey_(messageIdHeader));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.gmailMessageId ? parsed : null;
  } catch (error) {
    return null;
  }
}

function saveRequestDeliveryReceipt_(messageIdHeader, result) {
  const props = PropertiesService.getScriptProperties();
  const receipt = {
    savedAt: Date.now(),
    gmailMessageId: String(result && result.gmailMessageId || ''),
    threadId: String(result && result.threadId || ''),
    messageId: String(result && result.messageId || ''),
    replyToMessageId: String(result && result.replyToMessageId || ''),
    messageIdHeader: String(messageIdHeader || ''),
    mode: String(result && result.mode || 'gmail_api')
  };
  if (!receipt.gmailMessageId) return;
  props.setProperty(requestDeliveryReceiptKey_(messageIdHeader), JSON.stringify(receipt));

  const all = props.getProperties();
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const receipts = Object.keys(all).filter(function(key) {
    return key.indexOf(REQUEST_DELIVERY_RECEIPT_PREFIX) === 0;
  }).map(function(key) {
    let savedAt = 0;
    try { savedAt = Number(JSON.parse(all[key] || '{}').savedAt) || 0; } catch (error) {}
    return { key: key, savedAt: savedAt };
  }).sort(function(a, b) { return b.savedAt - a.savedAt; });
  receipts.forEach(function(entry, index) {
    if (entry.savedAt < cutoff || index >= 400) props.deleteProperty(entry.key);
  });
}

function verifySignedRequestDelivery_(payload) {
  const timestamp = String(payload && payload.timestamp || '').trim();
  const signature = String(payload && payload.signature || '').trim();
  const deliveryJson = String(payload && payload.deliveryJson || '');
  const timestampMs = Date.parse(timestamp);
  if (!timestamp || !signature || !deliveryJson || !Number.isFinite(timestampMs)) {
    throw new Error('REQUEST_DELIVERY_SIGNATURE_REQUIRED');
  }
  const ageMs = Date.now() - timestampMs;
  if (ageMs < -60000 || ageMs > 300000) {
    throw new Error('REQUEST_DELIVERY_SIGNATURE_EXPIRED');
  }
  const expected = requestDeliveryBase64Url_(Utilities.computeHmacSha256Signature(
    timestamp + '.' + deliveryJson,
    SUPABASE_KEY,
    Utilities.Charset.UTF_8
  ));
  if (!requestDeliverySafeEqual_(expected, signature)) {
    throw new Error('REQUEST_DELIVERY_SIGNATURE_INVALID');
  }
  const delivery = JSON.parse(deliveryJson);
  if (!delivery || typeof delivery !== 'object') throw new Error('REQUEST_DELIVERY_PAYLOAD_INVALID');
  return delivery;
}

function getGmailDeliveryMetadata_(gmailMessageId) {
  const safeId = String(gmailMessageId || '').trim();
  if (!safeId) return null;
  const message = Gmail.Users.Messages.get('me', safeId, {
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'To', 'Subject']
  });
  return {
    gmailMessageId: String(message && message.id || safeId),
    threadId: String(message && message.threadId || ''),
    messageId: extractGmailMessageHeader_(message, 'Message-ID'),
    to: extractGmailMessageHeader_(message, 'To'),
    subject: extractGmailMessageHeader_(message, 'Subject'),
    internalDate: Math.max(0, Number(message && message.internalDate) || 0)
  };
}

function findSentRequestDeliveryByMessageId_(messageIdHeader) {
  const safeMessageId = String(messageIdHeader || '').trim();
  if (!safeMessageId || !isGmailAdvancedServiceAvailable_()) return null;
  const list = Gmail.Users.Messages.list('me', {
    q: 'in:sent rfc822msgid:' + safeMessageId,
    maxResults: 10
  });
  const messages = list && Array.isArray(list.messages) ? list.messages : [];
  if (!messages.length) return null;
  return getGmailDeliveryMetadata_(messages[0].id);
}

function recoverRequestThreadFromSentMail_(requestFolder) {
  const safeFolder = String(requestFolder || '').trim();
  if (!safeFolder || !isGmailAdvancedServiceAvailable_()) return null;
  const searchFolder = safeFolder.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const list = Gmail.Users.Messages.list('me', {
    q: 'in:sent "' + searchFolder + '"',
    maxResults: 50
  });
  const messages = list && Array.isArray(list.messages) ? list.messages : [];
  let earliest = null;
  messages.forEach(function(message) {
    try {
      const metadata = getGmailDeliveryMetadata_(message.id);
      if (!metadata || !metadata.threadId || !metadata.messageId) return;
      if (!earliest || metadata.internalDate < earliest.internalDate) earliest = metadata;
    } catch (error) {}
  });
  return earliest;
}

function buildRecoveredDeliveryResult_(messageIdHeader, savedReceipt, mode) {
  return {
    ok: true,
    status: 200,
    recipients: [],
    mode: mode,
    threadId: String(savedReceipt && savedReceipt.threadId || ''),
    messageId: String(savedReceipt && savedReceipt.messageId || ''),
    gmailMessageId: String(savedReceipt && savedReceipt.gmailMessageId || ''),
    replyToMessageId: String(savedReceipt && savedReceipt.replyToMessageId || ''),
    messageIdHeader: String(messageIdHeader || '')
  };
}

function handleSignedReclassInquiryDelivery_(delivery) {
  const messageIdHeader = String(delivery && delivery.messageIdHeader || '').trim();
  if (!messageIdHeader) throw new Error('REQUEST_DELIVERY_MESSAGE_ID_REQUIRED');
  const savedReceipt = getRequestDeliveryReceipt_(messageIdHeader);
  if (savedReceipt) return buildRecoveredDeliveryResult_(messageIdHeader, savedReceipt, 'apps_script_receipt_recovery');

  const alreadySent = findSentRequestDeliveryByMessageId_(messageIdHeader);
  if (alreadySent) {
    const recoveredResult = buildRecoveredDeliveryResult_(messageIdHeader, alreadySent, 'gmail_api_idempotent_recovery');
    saveRequestDeliveryReceipt_(messageIdHeader, recoveredResult);
    return recoveredResult;
  }

  const eventPayload = delivery && delivery.payload && typeof delivery.payload === 'object' ? delivery.payload : {};
  const reclassPayload = eventPayload.reclassPayload && typeof eventPayload.reclassPayload === 'object'
    ? eventPayload.reclassPayload
    : null;
  if (!reclassPayload) throw new Error('RECLASS_VALIDATION:PAYLOAD_MISSING');
  const result = deliverReclassInquiryPayload_(reclassPayload, messageIdHeader);
  result.messageIdHeader = messageIdHeader;
  saveRequestDeliveryReceipt_(messageIdHeader, result);
  return result;
}

function buildEvalWorkReportModel_(eventPayload) {
  const payload = eventPayload && typeof eventPayload === 'object' ? eventPayload : {};
  const inquiry = payload.inquiry && typeof payload.inquiry === 'object' ? payload.inquiry : {};
  const source = payload.source && typeof payload.source === 'object'
    ? payload.source
    : (inquiry.source && typeof inquiry.source === 'object' ? inquiry.source : {});
  const sourceUid = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(source.unique_id, source.uniqueId));
  if (!sourceUid) throw new Error('EVAL_WORK_VALIDATION:SOURCE_ID_REQUIRED');
  const contractVersion = String(payload.contractVersion || 'eval-work-v1');
  const selectedOrigins = contractVersion === 'eval-work-v2-multi-origin' && Array.isArray(payload.origins)
    ? payload.origins.filter(Boolean) : [];
  const sourceRow = fetchEmailApprovalMasterRow_(sourceUid);
  if (!sourceRow) throw new Error('EVAL_WORK_CONFLICT:SOURCE_ROW_MISSING');
  try {
    validateInventoryTransactionSourceIdentity_(sourceRow, source);
  } catch (error) {
    throw new Error('EVAL_WORK_CONFLICT:SOURCE_ROW_CHANGED');
  }
  const allCurrentItemRows = fetchReclassInquiryItemRows_(sourceRow);
  if (String(payload.scopeContract || '') === 'itemcode-all-rows-v1') {
    const expectedCount = Math.max(0, Number(payload.membershipCount) || 0);
    const selectedIds = selectedOrigins.map(function(originInput) {
      return normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(originInput.unique_id, originInput.uniqueId));
    }).filter(Boolean).sort();
    const currentIds = allCurrentItemRows.map(function(row) {
      return getInventoryTransactionRowUid_(row);
    }).filter(Boolean).sort();
    if (!expectedCount || selectedIds.length !== expectedCount || currentIds.length !== expectedCount
       || selectedIds.join('|') !== currentIds.join('|')) {
      throw new Error('EVAL_WORK_CONFLICT:ITEMCODE_MEMBERSHIP_CHANGED');
    }
  }
  const authoritativeRows = selectedOrigins.length ? selectedOrigins.map(function(originInput) {
    const uid = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(originInput.unique_id, originInput.uniqueId));
    const current = uid ? fetchEmailApprovalMasterRow_(uid) : null;
    if (!current) throw new Error('EVAL_WORK_CONFLICT:ORIGIN_ROW_MISSING');
    try { validateInventoryTransactionSourceIdentity_(current, originInput); }
    catch (error) { throw new Error('EVAL_WORK_CONFLICT:ORIGIN_ROW_CHANGED'); }
    if (String(payload.scopeContract || '') === 'itemcode-all-rows-v1') {
      const expectedOh = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(originInput.ptronhand, originInput.PTRONHAND));
      const currentOh = normalizeInventoryTransactionText_(firstNonEmptyRequestValue_(current.ptronhand, current.PTRONHAND));
      if (expectedOh !== currentOh) throw new Error('EVAL_WORK_CONFLICT:ORIGIN_OH_CHANGED');
    }
    return current;
  }) : allCurrentItemRows;
  const transaction = inquiry.transaction && typeof inquiry.transaction === 'object' ? inquiry.transaction : {};
  const requestActions = Array.isArray(transaction.requestActions)
    ? transaction.requestActions.map(function(value) { return String(value || '').trim().toLowerCase(); }).filter(Boolean)
    : [];
  const hasTemporaryChanges = Array.isArray(inquiry.rowOverlays) && inquiry.rowOverlays.some(function(overlay) {
    return overlay && overlay.temporaryValues && typeof overlay.temporaryValues === 'object' && Object.keys(overlay.temporaryValues).length;
  });
  let reportRows;
  let proposalResult = null;
  if (requestActions.length || hasTemporaryChanges || hasReclassInquiryHoldProposalV3_(transaction, inquiry.rowOverlays)) {
    try {
      const authoritativeScope = hasReclassInquiryHoldProposalV3_(transaction, inquiry.rowOverlays)
        ? fetchReclassInquiryScopeSettingsV3_()
        : null;
      proposalResult = buildReclassInquiryActionRowsV3_(transaction, authoritativeRows, inquiry.rowOverlays, authoritativeScope, { allowEmptyActions: true });
    } catch (error) {
      throw new Error('EVAL_WORK_VALIDATION:' + String(error && error.message || 'PROPOSAL_INVALID'));
    }
    if (!proposalResult.ok) throw new Error('EVAL_WORK_CONFLICT:' + String(proposalResult.message || 'ROW_IDENTITY_CHANGED'));
    reportRows = proposalResult.rows;
  } else {
    reportRows = authoritativeRows.map(function(row) {
      const values = {};
      RECLASS_INQUIRY_ROW_FIELDS_.forEach(function(field) {
        values[field.key] = getReclassInquiryExactValue_(row, field.aliases, '');
      });
      return {
        unique_id: getInventoryTransactionRowUid_(row),
        values: values,
        actionValues: {},
        changedFields: [],
        actions: [],
        included: false
      };
    });
  }
  const actorDisplay = String(payload.deliveryKind || '') === 'completion'
    ? firstNonEmptyRequestValue_(payload.assigneeDisplay, payload.assigneeUsername, 'Evaluator')
    : firstNonEmptyRequestValue_(payload.creatorDisplay, payload.creatorUsername, 'Eval Work Manager');
  const reportPayload = Object.assign({}, inquiry, {
    source: source,
    actor: { display: actorDisplay, username: firstNonEmptyRequestValue_(payload.assigneeUsername, payload.creatorUsername, '') },
    transaction: Object.assign({ requestActions: [], holdStopProposals: [], scope: {} }, transaction, proposalResult ? {
      requestActions: proposalResult.requestActions,
      holdStopProposals: proposalResult.holdStopProposals || [],
      scope: proposalResult.scope || {}
    } : {})
  });
  const model = buildReclassInquiryReportModel_(sourceRow, authoritativeRows, reportRows, reportPayload, new Date());
  model.requestActionLabel = requestActions.length ? getReclassInquiryActionsLabelV3_(requestActions) : 'Evidence Review';
  model.evalWork = {
    id: String(payload.evalWorkId || ''),
    deliveryKind: String(payload.deliveryKind || ''),
    instructions: String(payload.instructions || ''),
    assigneeDisplay: String(firstNonEmptyRequestValue_(payload.assigneeDisplay, payload.assigneeUsername, ''))
  };
  if (String(payload.deliveryKind || '') === 'completion') {
    if (selectedOrigins.length) {
      model.evaluationResultsRows = selectedOrigins.map(function(originInput) {
        const evidence = originInput.evidence && typeof originInput.evidence === 'object' ? originInput.evidence : {};
        return {
          locationcode: String(originInput.locationcode || ''), lotcode: String(originInput.lotcode || ''),
          photos: Array.isArray(evidence.photos) ? evidence.photos : [], spec: String(evidence.spec || ''),
          caliper: String(evidence.caliper || ''),
          locMatchPercent: String(firstNonEmptyRequestValue_(evidence.locMatchPercent, evidence.loc_match_percent, '')),
          avNote: String(firstNonEmptyRequestValue_(evidence.avNote, evidence.av_note, '')),
          pickNote: String(firstNonEmptyRequestValue_(evidence.pickNote, evidence.pick_note, '')),
          comments: String(evidence.comments || '')
        };
      });
    } else {
      const evidence = payload.evidence && typeof payload.evidence === 'object' ? payload.evidence : {};
      model.evaluationResults = {
        locationcode: String(source.locationcode || ''), lotcode: String(source.lotcode || ''),
        photos: Array.isArray(evidence.photos) ? evidence.photos : [], spec: String(evidence.spec || ''),
        caliper: String(evidence.caliper || ''),
        locMatchPercent: String(firstNonEmptyRequestValue_(evidence.locMatchPercent, evidence.loc_match_percent, '')),
        avNote: String(firstNonEmptyRequestValue_(evidence.avNote, evidence.av_note, '')),
        pickNote: String(firstNonEmptyRequestValue_(evidence.pickNote, evidence.pick_note, '')),
        comments: String(evidence.comments || '')
      };
    }
  }
  return model;
}

function buildEvalWorkEmailText_(model, kind) {
  const safeModel = model || {};
  const identity = safeModel.identity || {};
  const evalWork = safeModel.evalWork || {};
  const assignment = kind === 'assignment';
  return [
    assignment ? 'GNC PH Eval Work Assignment' : 'GNC PH Eval Work Completed',
    'Item: ' + String(identity.commonname || ''),
    'Item Code: ' + String(identity.itemcode || ''),
    'Container: ' + String(identity.contsize || ''),
    'Origin: ' + String(identity.locationcode || '') + ' / ' + String(identity.lotcode || ''),
    'Evaluator: ' + String(evalWork.assigneeDisplay || ''),
    assignment && evalWork.instructions ? 'Instructions: ' + String(evalWork.instructions) : '',
    '',
    assignment
      ? 'Open Queue > Eval Work to complete the evidence and Item Inquiry. The current inquiry PDF is attached.'
      : 'The completed Eval Work Item Inquiry PDF is attached.'
  ].filter(function(value) { return value !== ''; }).join('\n');
}

function buildEvalWorkEmailHtml_(model, kind) {
  const safeModel = model || {};
  const identity = safeModel.identity || {};
  const evalWork = safeModel.evalWork || {};
  const assignment = kind === 'assignment';
  return buildPhoneSizedEmailHtml_([
    '<div style="font-family:Arial,sans-serif;padding:20px;color:#1f2937;">',
    '<h2 style="margin:0 0 14px;color:#007a4d;">' + (assignment ? 'Eval Work Assignment' : 'Eval Work Completed') + '</h2>',
    '<p><strong>Item:</strong> ' + escapeEmailHtml_(identity.commonname || '') + '<br><strong>Item Code:</strong> ' + escapeEmailHtml_(identity.itemcode || '') + '<br><strong>Container:</strong> ' + escapeEmailHtml_(identity.contsize || '') + '</p>',
    '<p><strong>Evaluator:</strong> ' + escapeEmailHtml_(evalWork.assigneeDisplay || '') + '</p>',
    assignment && evalWork.instructions ? '<p><strong>Instructions:</strong><br>' + escapeEmailHtml_(evalWork.instructions) + '</p>' : '',
    '<p style="padding:12px 14px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;"><strong>PDF attached:</strong> ' + (assignment ? 'Open Queue &gt; Eval Work to complete this assignment.' : 'Open the completed Item Inquiry and Evaluation Results.') + '</p>',
    '</div>'
  ].join(''));
}

function handleSignedEvalWorkDelivery_(delivery) {
  const messageIdHeader = String(delivery && delivery.messageIdHeader || '').trim();
  if (!messageIdHeader) throw new Error('REQUEST_DELIVERY_MESSAGE_ID_REQUIRED');
  const savedReceipt = getRequestDeliveryReceipt_(messageIdHeader);
  if (savedReceipt) return buildRecoveredDeliveryResult_(messageIdHeader, savedReceipt, 'apps_script_receipt_recovery');
  const alreadySent = findSentRequestDeliveryByMessageId_(messageIdHeader);
  if (alreadySent) {
    const recovered = buildRecoveredDeliveryResult_(messageIdHeader, alreadySent, 'gmail_api_idempotent_recovery');
    saveRequestDeliveryReceipt_(messageIdHeader, recovered);
    return recovered;
  }
  const eventType = String(delivery && delivery.eventType || '').trim();
  const eventPayload = delivery && delivery.payload && typeof delivery.payload === 'object' ? delivery.payload : {};
  if (String(eventPayload.scopeContract || '') === 'itemcode-all-rows-v1') {
    const preflight = callSupabaseRpc_('validate_eval_work_delivery_v1', {
      p_work_id: String(eventPayload.evalWorkId || ''),
      p_event_type: eventType,
      p_membership_signature: String(eventPayload.membershipSignature || '')
    });
    const preflightValue = Array.isArray(preflight) ? preflight[0] : preflight;
    if (!preflightValue || preflightValue.ok !== true
       || Number(preflightValue.originCount) !== Number(eventPayload.membershipCount)) {
      throw new Error('EVAL_WORK_CONFLICT:DELIVERY_PREFLIGHT_FAILED');
    }
  }
  const kind = eventType === EVAL_WORK_ASSIGNMENT_EVENT_TYPE_ ? 'assignment' : 'completion';
  const recipients = kind === 'assignment'
    ? dedupeEmailAddresses_([eventPayload.assignmentRecipients || eventPayload.assigneeEmail])
    : dedupeEmailAddresses_([eventPayload.completionRecipients]);
  if (!recipients.length) throw new Error('EVAL_WORK_VALIDATION:RECIPIENT_REQUIRED');
  const model = buildEvalWorkReportModel_(eventPayload);
  const commonName = String(model.identity && model.identity.commonname || 'Inventory').replace(/\s+/g, ' ').trim();
  const subject = '[External] GNC PH Eval Work - ' + (kind === 'assignment' ? 'Assigned' : 'Completed') + ': ' + commonName;
  let pdfBlob;
  try {
    pdfBlob = HtmlService.createHtmlOutput(buildReclassInquiryCompactReportHtml_(model, true)).getBlob().getAs(MimeType.PDF);
    const safeName = commonName.replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Item';
    pdfBlob.setName('GNC_PH_Eval_Work_' + (kind === 'assignment' ? 'Assignment_' : 'Completed_') + safeName + '.pdf');
  } catch (error) {
    throw new Error('EVAL_WORK_PDF_BUILD_FAILED');
  }
  if (!isGmailAdvancedServiceAvailable_()) throw new Error('EVAL_WORK_GMAIL_SERVICE_UNAVAILABLE');
  try {
    const result = sendGmailApiMessage_({
      toList: recipients.join(','), toArray: recipients, subject: subject,
      textBody: buildEvalWorkEmailText_(model, kind), htmlBody: buildEvalWorkEmailHtml_(model, kind),
      attachments: [pdfBlob], fromName: 'GNC PH Eval Work', fromAddress: resolveAutomatedEmailSenderAddress_(),
      messageIdHeader: messageIdHeader
    });
    result.subject = subject;
    result.messageIdHeader = messageIdHeader;
    saveRequestDeliveryReceipt_(messageIdHeader, result);
    return result;
  } catch (error) {
    if (/^EVAL_WORK_/.test(String(error && error.message || ''))) throw error;
    throw new Error('EVAL_WORK_EMAIL_SEND_FAILED');
  }
}

function handleSignedRequestDeliveryEvent_(payload) {
  const delivery = verifySignedRequestDelivery_(payload);
  const eventType = String(delivery.eventType || '').trim();
  if (eventType === RECLASS_DELIVERY_EVENT_TYPE_) {
    return handleSignedReclassInquiryDelivery_(delivery);
  }
  if (eventType === EVAL_WORK_ASSIGNMENT_EVENT_TYPE_ || eventType === EVAL_WORK_COMPLETION_EVENT_TYPE_) {
    return handleSignedEvalWorkDelivery_(delivery);
  }
  if (eventType !== 'request_created' && eventType !== 'request_completed') {
    throw new Error('REQUEST_DELIVERY_EVENT_TYPE_INVALID');
  }
  const messageIdHeader = String(delivery.messageIdHeader || '').trim();
  if (!messageIdHeader) throw new Error('REQUEST_DELIVERY_MESSAGE_ID_REQUIRED');

  const deliveryLock = LockService.getScriptLock();
  if (!deliveryLock.tryLock(10000)) throw new Error('REQUEST_DELIVERY_BUSY');
  try {
  const savedReceipt = getRequestDeliveryReceipt_(messageIdHeader);
  if (savedReceipt) {
    return {
      ok: true,
      status: 200,
      recipients: [],
      mode: 'apps_script_receipt_recovery',
      threadId: savedReceipt.threadId,
      messageId: savedReceipt.messageId,
      gmailMessageId: savedReceipt.gmailMessageId,
      replyToMessageId: savedReceipt.replyToMessageId,
      messageIdHeader: messageIdHeader
    };
  }

  const alreadySent = findSentRequestDeliveryByMessageId_(messageIdHeader);
  if (alreadySent) {
    const recoveredResult = {
      ok: true,
      status: 200,
      recipients: [],
      mode: 'gmail_api_idempotent_recovery',
      threadId: alreadySent.threadId,
      messageId: alreadySent.messageId,
      gmailMessageId: alreadySent.gmailMessageId,
      replyToMessageId: '',
      messageIdHeader: messageIdHeader
    };
    saveRequestDeliveryReceipt_(messageIdHeader, recoveredResult);
    return recoveredResult;
  }

  const rows = Array.isArray(delivery.rows) ? delivery.rows.filter(Boolean) : [];
  if (!rows.length) throw new Error('REQUEST_DELIVERY_SNAPSHOT_MISSING');
  const eventRow = {
    event_type: eventType,
    request_id: delivery.requestId || '',
    request_folder: delivery.requestFolder || '',
    payload: { request_ids: rows.map(function(row) { return row && row.unique_id; }).filter(Boolean) }
  };
  const emailPayload = buildRequestDeliveryEmailPayload_(eventRow, rows);
  emailPayload.messageIdHeader = messageIdHeader;

  let replyThreadId = '';
  let replyMessageId = '';
  let recoveredLegacyThread = false;
  if (eventType === 'request_completed') {
    const thread = delivery.thread && typeof delivery.thread === 'object' ? delivery.thread : {};
    replyThreadId = String(thread.initial_thread_id || thread.threadId || '').trim();
    replyMessageId = String(thread.initial_message_id || thread.messageId || '').trim();
    if (!replyThreadId || !replyMessageId) {
      const recovered = recoverRequestThreadFromSentMail_(emailPayload.requestFolder || emailPayload.folderId);
      if (recovered) {
        replyThreadId = recovered.threadId;
        replyMessageId = recovered.messageId;
        recoveredLegacyThread = true;
      }
    }
    emailPayload.threadId = replyThreadId;
    emailPayload.messageId = replyMessageId;
  }

  const result = sendRequestEmailWithFallback_(emailPayload);
  if (!result || result.ok !== true) {
    throw new Error('REQUEST_DELIVERY_EMAIL_FAILED:' + String(result && result.message || 'unknown'));
  }
  if (eventType === 'request_completed') {
    result.mode = replyThreadId && replyMessageId
      ? (recoveredLegacyThread ? 'thread_recovery_recovered' : result.mode)
      : 'thread_recovery_fallback';
  }
  result.replyToMessageId = replyMessageId;
  result.messageIdHeader = messageIdHeader;
  saveRequestDeliveryReceipt_(messageIdHeader, result);
  return result;
  } finally {
    deliveryLock.releaseLock();
  }
}

function updateRequestDeliveryEvent_(eventId, patch) {
  return requestDeliveryRest_(
    'ph_request_delivery_outbox',
    'PATCH',
    'event_id=eq.' + encodeURIComponent(String(eventId || '')),
    patch || {},
    'return=representation'
  );
}

function processRequestDeliveryOutbox_(limit) {
  const batchLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { claimed: 0, delivered: 0, failed: 0, locked: true };
  let delivered = 0;
  let failed = 0;
  let events = [];
  try {
    events = requestDeliveryRest_(
      'ph_request_delivery_outbox',
      'GET',
      'select=*&status=eq.pending&next_attempt_at=lte.' + encodeURIComponent(new Date().toISOString()) + '&order=created_at.asc&limit=' + batchLimit,
      null
    );
    events.forEach(function(eventRow) {
      const eventId = String(eventRow.event_id || '');
      const claimedRows = requestDeliveryRest_(
        'ph_request_delivery_outbox',
        'PATCH',
        'event_id=eq.' + encodeURIComponent(eventId) + '&status=eq.pending',
        { status: 'processing', last_attempt_at: new Date().toISOString() },
        'return=representation'
      );
      if (!Array.isArray(claimedRows) || claimedRows.length !== 1) return;
      const claimed = claimedRows[0];
      const eventType = String(claimed.event_type || '');
      const rows = getRequestDeliveryRows_(claimed);
      try {
        let emailDeliveredAt = claimed.email_delivered_at || null;
        let pushDeliveredAt = claimed.push_delivered_at || null;
        const isRequestEvent = eventType === 'request_created' || eventType === 'request_completed';
        if (isRequestEvent && !rows.length) throw new Error('REQUEST_SNAPSHOT_MISSING');

        if (isRequestEvent && !emailDeliveredAt) {
          const emailResult = sendRequestEmailWithFallback_(buildRequestDeliveryEmailPayload_(claimed, rows));
          if (!emailResult || emailResult.ok !== true) throw new Error('EMAIL_SEND_FAILED');
          emailDeliveredAt = new Date().toISOString();
          updateRequestDeliveryEvent_(eventId, { email_delivered_at: emailDeliveredAt });
        } else if (!isRequestEvent) {
          emailDeliveredAt = emailDeliveredAt || new Date().toISOString();
        }

        if (!pushDeliveredAt) {
          sendRequestDeliveryPush_(claimed, rows);
          pushDeliveredAt = new Date().toISOString();
          updateRequestDeliveryEvent_(eventId, { push_delivered_at: pushDeliveredAt });
        }

        const deliveredAt = new Date().toISOString();
        updateRequestDeliveryEvent_(eventId, {
          status: 'delivered',
          email_delivered_at: emailDeliveredAt,
          push_delivered_at: pushDeliveredAt,
          delivered_at: deliveredAt,
          sanitized_error_code: null
        });
        if (claimed.request_id) {
          requestDeliveryRest_('ph_request_history', 'PATCH',
            'unique_id=eq.' + encodeURIComponent(String(claimed.request_id)),
            { delivery_state: 'delivered' }, 'return=minimal');
        }
        delivered++;
      } catch (error) {
        const attempts = Math.max(0, Number(claimed.attempt_count) || 0) + 1;
        const exhausted = attempts >= 8;
        const code = /SNAPSHOT/i.test(String(error && error.message || '')) ? 'REQUEST_SNAPSHOT_MISSING'
          : /EMAIL/i.test(String(error && error.message || '')) ? 'EMAIL_SEND_FAILED'
          : /PUSH/i.test(String(error && error.message || '')) ? 'PUSH_SEND_FAILED'
          : 'DELIVERY_WORKER_FAILED';
        const retryMinutes = Math.min(360, Math.pow(2, Math.min(attempts, 6)));
        updateRequestDeliveryEvent_(eventId, {
          status: exhausted ? 'failed' : 'pending',
          attempt_count: attempts,
          next_attempt_at: new Date(Date.now() + retryMinutes * 60000).toISOString(),
          sanitized_error_code: code
        });
        failed++;
      }
    });
    return { claimed: events.length, delivered: delivered, failed: failed, locked: false };
  } finally {
    lock.releaseLock();
  }
}

function runRequestIntegrityScheduledWorker_() {
  const maintenance = callSupabaseRpc_('run_request_integrity_maintenance', {});
  return {
    maintenance: maintenance || {},
    delivery: { delegated: true, worker: 'supabase_edge_request_delivery' }
  };
}

// RETIRED DISEASE / LAB REPORT DRIVE MIRROR
// =========================================================================
function runDiseaseDriveToSupabaseSync() {
  console.log('[DISEASE SYNC] Retired stage skipped. Disease & Pest human workflow is unchanged.');
  return runRetiredDiseaseManualSyncStage_();
}
function firstNonEmptyPhotoUploadValue_() {
  for (var i = 0; i < arguments.length; i++) {
    var value = arguments[i];
    if (value === null || value === undefined) continue;
    var text = String(value).trim();
    if (text !== '') return text;
  }
  return '';
}

function sanitizePhotoUploadFileSegment_(value, fallback) {
  var clean = String(firstNonEmptyPhotoUploadValue_(value, fallback || 'NA') || fallback || 'NA')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '');
  return clean || String(fallback || 'NA').replace(/[^a-zA-Z0-9_-]+/g, '') || 'NA';
}

function sanitizePhotoUploadFileName_(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|#%{}~\[\]`^]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120) || 'file';
}

function getPhotoUploadFileExtension_(payload) {
  var fileName = String(payload && payload.filename || '').trim();
  var fileMatch = fileName.match(/\.([a-zA-Z0-9]{2,8})$/);
  if (fileMatch && fileMatch[1]) {
    var cleanExt = String(fileMatch[1]).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (cleanExt) return cleanExt === 'jpeg' ? 'jpg' : cleanExt;
  }
  var mimeType = String(payload && payload.mimeType || '').toLowerCase();
  if (mimeType.indexOf('png') !== -1) return 'png';
  if (mimeType.indexOf('webp') !== -1) return 'webp';
  if (mimeType.indexOf('gif') !== -1) return 'gif';
  if (mimeType.indexOf('heic') !== -1) return 'heic';
  if (mimeType.indexOf('heif') !== -1) return 'heif';
  return 'jpg';
}

function buildInventoryPhotoUploadFileName_(payload) {
  var originalName = String(payload && payload.filename || '').trim();
  var itemCode = firstNonEmptyPhotoUploadValue_(
    payload && payload.itemcode,
    payload && payload.itemCode,
    payload && payload.item_code,
    payload && payload.ITEMCODE
  );
  var locationCode = firstNonEmptyPhotoUploadValue_(
    payload && payload.locationcode,
    payload && payload.locationCode,
    payload && payload.location_code,
    payload && payload.loc,
    payload && payload.LOCATIONCODE,
    payload && payload.LOCATION
  );
  if (!itemCode || !locationCode) {
    return sanitizePhotoUploadFileName_(originalName || ('photo-' + new Date().getTime() + '.' + getPhotoUploadFileExtension_(payload)));
  }
  var token = sanitizePhotoUploadFileSegment_(
    firstNonEmptyPhotoUploadValue_(payload && payload.uploadToken, payload && payload.upload_token),
    String(new Date().getTime())
  );
  return sanitizePhotoUploadFileSegment_(itemCode, 'NOITEM') + '-' +
    sanitizePhotoUploadFileSegment_(locationCode, 'NOLOC') + '-' +
    token + '.' + getPhotoUploadFileExtension_(payload);
}

function encodeStoragePath_(path) {
  return String(path || '')
    .split('/')
    .map(function(part) { return encodeURIComponent(part); })
    .join('/');
}

const PHOTO_ARCHIVE_CLOCK_SKEW_MS = 10 * 60 * 1000;
const PHOTO_ARCHIVE_MAX_BYTES = 12 * 1024 * 1024;

function getPhotoArchiveFolderMap_() {
  return {
    request_photos: '1snWsk0DHPXfa8G9gWXMVPXcFiOou7dFw',
    flyer_photos: '1pN_5d2P9xylC0npQCIaLw9t7LQdcQtnR',
    season_sales_notes_photos: '1Zu3CiUH_cMeS5PFWVfSbuvL0x4ypROtv',
    location_sales_notes_photos: '1pWRtlUCW8xS8zQXFxiDt6RwZb_PJbSMq',
    credit_photos: '1Ogwf6JzEIAgBv5k-ofJ-iuYpmoS5TdvK',
    dock_photos: '1IWW6gUP3FFf1J0qUx-y2WRKubnjd0_Am',
    grower_scout_photos: '1N8tp00CiTgD7IYEflqfyhsjGa2fszU1Y',
    marketing_materials: '1ITTElK_Kv4wIj9UIQiulaNeisR5zYZtT',
    archive_manifests: '1ccCOhMmJtaoptcyBPykQAiifDp7gqfZy',
    failed_jobs: '13I72WbWsyctMT7h-k4WHPAXIyO94W65P'
  };
}

function photoArchiveBytesToHex_(bytes) {
  return (bytes || []).map(function(value) {
    const normalized = value < 0 ? value + 256 : value;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function photoArchiveSafeEqual_(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (a.length !== b.length || !a.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function photoArchiveCanonicalRequest_(payload) {
  return [
    String(payload.action || ''),
    String(payload.timestamp || ''),
    String(payload.nonce || ''),
    String(payload.folderId || ''),
    String(payload.fileName || ''),
    String(payload.sourceKey || ''),
    String(payload.sha256 || ''),
    Array.isArray(payload.folderIds) ? payload.folderIds.join(',') : ''
  ].join('\n');
}

function verifyPhotoArchiveRequest_(payload) {
  if (!SUPABASE_KEY) throw new Error('Photo archive signing key is unavailable.');
  const timestamp = Number(payload.timestamp || 0);
  if (!Number.isFinite(timestamp) || Math.abs(new Date().getTime() - timestamp) > PHOTO_ARCHIVE_CLOCK_SKEW_MS) {
    throw new Error('Photo archive request expired.');
  }
  if (!/^[a-f0-9]{24,64}$/i.test(String(payload.nonce || ''))) throw new Error('Photo archive nonce is invalid.');
  const expected = photoArchiveBytesToHex_(Utilities.computeHmacSha256Signature(
    photoArchiveCanonicalRequest_(payload),
    SUPABASE_KEY,
    Utilities.Charset.UTF_8
  ));
  if (!photoArchiveSafeEqual_(expected, payload.signature)) throw new Error('Photo archive signature is invalid.');
}

function requirePhotoArchiveFolder_(folderId) {
  const requested = String(folderId || '').trim();
  const allowed = Object.keys(getPhotoArchiveFolderMap_()).some(function(key) {
    return getPhotoArchiveFolderMap_()[key] === requested;
  });
  if (!allowed) throw new Error('Photo archive destination is not approved.');
  return DriveApp.getFolderById(requested);
}

function handlePhotoArchiveRequest_(payload) {
  verifyPhotoArchiveRequest_(payload);
  if (payload.action === 'probe') {
    const folderIds = Array.isArray(payload.folderIds) ? payload.folderIds : [];
    const folders = folderIds.map(function(folderId) {
      const folder = requirePhotoArchiveFolder_(folderId);
      return { id: folder.getId(), name: folder.getName() };
    });
    return { ok: true, verified: true, folders: folders };
  }
  if (payload.action !== 'upload') throw new Error('Unsupported photo archive action.');
  const fileName = sanitizePhotoUploadFileName_(payload.fileName || 'archived-photo');
  const mimeType = String(payload.mimeType || 'application/octet-stream').trim();
  const bytes = Utilities.base64Decode(String(payload.imageBase64 || ''));
  if (!bytes.length || bytes.length > PHOTO_ARCHIVE_MAX_BYTES) throw new Error('Photo archive file size is invalid.');
  const sourceSha256 = photoArchiveBytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  if (!photoArchiveSafeEqual_(sourceSha256, payload.sha256)) throw new Error('Photo archive source hash does not match.');
  const folder = requirePhotoArchiveFolder_(payload.folderId);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  try {
    file.setDescription(JSON.stringify({
      archive: 'gnc-supabase-photo',
      sourceKey: String(payload.sourceKey || ''),
      sha256: sourceSha256
    }));
    const storedBytes = file.getBlob().getBytes();
    const storedSha256 = photoArchiveBytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, storedBytes));
    if (file.getSize() !== bytes.length || !photoArchiveSafeEqual_(storedSha256, sourceSha256)) {
      throw new Error('Google Drive verification did not match the source file.');
    }
    return {
      ok: true,
      verified: true,
      id: file.getId(),
      name: file.getName(),
      size: file.getSize(),
      sha256: storedSha256,
      folderId: folder.getId()
    };
  } catch (error) {
    try { file.setTrashed(true); } catch (trashError) { console.warn('Could not trash failed photo archive copy: ' + trashError); }
    throw error;
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.type === 'deployment_health') {
      return jsonOutput_(getAppsScriptDeploymentHealth_());
    }

    if (payload.type === 'request_delivery_event') {
      return jsonOutput_(handleSignedRequestDeliveryEvent_(payload));
    }

    if (payload.type === 'reclass_inquiry_status') {
      return jsonOutput_(handleReclassInquiryStatus_(payload));
    }

    if (payload.type === 'reclass_inquiry_retry') {
      return jsonOutput_(handleReclassInquiryRetry_(payload));
    }

    if (payload.type === 'photo_archive') {
      return jsonOutput_(handlePhotoArchiveRequest_(payload));
    }

    if (payload.type === 'clear_request_gallery_cache') {
      return jsonOutput_(cleanupRequestGalleryPropertyCache_());
    }

    if (payload.type === 'drivearound_name_preview' || payload.type === 'drivearound_name_cleanup') {
      const requestedBy = String(payload.requested_by || payload.requestedBy || '').trim().toLowerCase();
      const allowedRequester = requestedBy === 'dylan_collyge' || requestedBy === 'dylancollyge@agmetricapp.com';
      if (!allowedRequester) {
        throw new Error('DriveAround name cleanup is restricted to dylan_collyge.');
      }
      const limit = Math.max(1, Math.min(5000, Number(payload.limit) || 0));
      const result = payload.type === 'drivearound_name_cleanup'
        ? normalizeDriveAroundProcessedNames(limit || DRIVE_AROUND_CANONICAL_APPLY_LIMIT)
        : previewNormalizeDriveAroundProcessedNames(limit || DRIVE_AROUND_CANONICAL_PREVIEW_LIMIT);
      return jsonOutput_(result);
    }

    if (payload.type === 'drivearound_history_backfill') {
      const requestedBy = String(payload.requested_by || payload.requestedBy || '').trim().toLowerCase();
      const allowedRequester = requestedBy === 'dylan_collyge' || requestedBy === 'dylancollyge@agmetricapp.com';
      if (!allowedRequester) {
        throw new Error('DriveAround history backfill is restricted to dylan_collyge.');
      }
      const runInline = payload.run_inline === true || payload.runInline === true;
      if (runInline) return jsonOutput_(startDriveAroundHistoryBackfill());
      removeDriveAroundHistoryBackfillTrigger_();
      scheduleDriveAroundHistoryBackfillTrigger_();
      return jsonOutput_({
        ok: true,
        status: 'queued',
        message: 'DriveAround history backfill trigger queued.',
        maxParsedFilesPerRun: DRIVE_AROUND_HISTORY_MAX_PARSED_FILES_PER_RUN
      });
    }

    if (payload.type === 'manual_run') {
      cleanupRequestGalleryPropertyCache_();
      const runInline = payload.run_inline === true || payload.runInline === true || payload.fast === true;
      const result = queueManualSyncRequest_({
        job: payload.job || 'all',
        source: payload.trigger || 'webhook',
        requestedBy: payload.requested_by || payload.requestedBy || 'Unknown',
        forceIfStale: payload.force_if_stale === true || payload.forceIfStale === true,
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

    if (payload.type === 'manual_clear_status') {
      cleanupRequestGalleryPropertyCache_();
      clearManualSyncStatus();
      return jsonOutput_({
        ok: true,
        active: false,
        currentStage: '',
        currentStageLabel: '',
        message: 'Manual sync status cleared.'
      });
    }

    if (payload.type === 'manual_clear_stale_status') {
      cleanupRequestGalleryPropertyCache_();
      const existing = loadManualSyncStatus_();
      const status = getManualSyncStatusForClient_();
      if (existing && existing.active && (!status || status.active === false)) {
        return jsonOutput_(status || {
          ok: true,
          active: false,
          currentStage: 'stale_failed',
          currentStageLabel: 'Timed Out',
          message: 'Stale manual sync status cleared.'
        });
      }
      return jsonOutput_(status || {
        ok: true,
        active: false,
        currentStage: '',
        currentStageLabel: '',
        message: 'No stale manual sync status found.'
      });
    }

    if (payload.type === 'manual_status') {
      cleanupRequestGalleryPropertyCache_();
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

    if (payload.type === 'inventory_transaction_history') {
      return jsonOutput_(fetchInventoryTransactionHistory_(payload));
    }

    if (payload.type === 'reclass_inquiry_email') {
      return jsonOutput_(handleReclassInquiryEmail_(payload));
    }

    if (payload.type === 'inventory_transaction') {
      return jsonOutput_(handleInventoryTransaction_(payload));
    }
    
    if (payload.type === "email") {
    if (payload.emailType === "new_request" || payload.emailType === "request_complete" || payload.emailType === "ncr_complete" || payload.emailType === "ncr_approval" || payload.emailType === "hold_release_request" || payload.emailType === "drive_customer_outreach" || payload.emailType === "bloom_crop_update" || payload.emailType === "bloom_purpose_report" || payload.emailType === "drive_shift_report" || payload.emailType === "block_clearing_email") {
      const emailType = String(payload.emailType || '').trim().toLowerCase();
      const shouldQueueDelayedReply = emailType === 'request_complete' && Math.max(0, Number(payload.delayMs) || 0) > 0;
      if (shouldQueueDelayedReply) {
        return jsonOutput_(enqueueDelayedRequestEmail_(payload));
      }
      if (shouldQueueJdApprovalEmail_(payload)) {
        return jsonOutput_(enqueueJdApprovalEmail_(payload));
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
        const approvedItems = Array.isArray(payload.approvedItems) ? payload.approvedItems.filter(Boolean) : [];
        const reviewedItemsPayload = {
          emailType: 'request_rep_reviewed',
          subject: subject,
          folderId: payload.folderId || '',
          requestFolder: payload.folderId || '',
          requestItems: approvedItems.map(function(item) {
            return {
              unique_id: firstNonEmptyRequestValue_(item && item.unique_id, item && item.UNIQUE_ID, item && item.id, ''),
              commonname: firstNonEmptyRequestValue_(item && item.commonname, item && item.COMMONNAME, 'Unknown Item'),
              contsize: firstNonEmptyRequestValue_(item && item.contsize, item && item.CONTSIZE, '-'),
              itemcode: firstNonEmptyRequestValue_(item && item.itemcode, item && item.ITEMCODE, ''),
              loc: firstNonEmptyRequestValue_(item && item.loc, item && item.locationcode, item && item.LOCATIONCODE, ''),
              locationcode: firstNonEmptyRequestValue_(item && item.locationcode, item && item.LOCATIONCODE, item && item.loc, ''),
              qty: firstNonEmptyRequestValue_(item && item.qty, item && item.req_qty, item && item.REQ_QTY, ''),
              photo: extractRequestPhotoUrls_([
                item && item.req_photo_link,
                item && item.REQ_PHOTO_LINK,
                item && item.request_photo_link,
                item && item.REQUEST_PHOTO_LINK,
                item && item.REQUESTPHOTO_LINK,
                item && item.photo,
                item && item.photos
              ]).join(',')
            };
          }),
          itemsCount: approvedItems.length
        };
        const rowsHtml = reviewedItemsPayload.requestItems.length
          ? buildCompactRequestItemsHtml_(reviewedItemsPayload)
          : "<p><em>No items were approved. All were rejected.</em></p>";
        
        htmlBody = buildPhoneSizedEmailHtml_(`
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #007a4d;">Request Reviewed by Sales Rep</h2>
            <p><strong>Rep:</strong> ${escapeEmailHtml_(payload.repName)}</p>
            <p><strong>Customer:</strong> ${escapeEmailHtml_(payload.customer)}</p>
            <p><strong>Folder ID:</strong> ${escapeEmailHtml_(payload.folderId)}</p>
            <p>The rep has finished reviewing the completed request. Here are the items they <strong>Approved</strong>:</p>
            ${rowsHtml}
          </div>
        `);
        textBody = [
          subject,
          payload.repName ? 'Rep: ' + payload.repName : '',
          payload.customer ? 'Customer: ' + payload.customer : '',
          payload.folderId ? 'Folder ID: ' + payload.folderId : '',
          reviewedItemsPayload.requestItems.length ? buildRequestItemsText_(reviewedItemsPayload) : 'No items were approved. All were rejected.'
        ].filter(Boolean).join('\n\n');
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
      
      const uploadFileName = buildInventoryPhotoUploadFileName_(payload);
      const blob = Utilities.newBlob(Utilities.base64Decode(payload.image), payload.mimeType, uploadFileName);
      const file = subfolder.createFile(blob); 
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      return ContentService.createTextOutput(JSON.stringify({ status: "success", url: file.getUrl(), filename: uploadFileName })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) { 
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      status: "error",
      message: err && err.message ? err.message : String(err)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
