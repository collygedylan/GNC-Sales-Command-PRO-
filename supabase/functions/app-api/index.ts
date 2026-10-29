import { handleSalesWorkflow } from "../_shared/sales-workflow.ts";
import { executeManagerTableManagement } from "../_shared/table-management.ts";
import { buildRuntimeWatchdogFixBrief } from "../_shared/runtime-watchdog-brief.ts";
const APP_RUNTIME_VERSION = "2.3.104";
const APP_RUNTIME_RELEASE = "AgData v2.3.104";
import { isRequestRecipientDirectoryUser, readRequestRecipientDirectory } from "../_shared/request-recipient-directory.ts";
import { RECLASS_SHEARED_POLICY, validateReclassShearedProposals } from "../../../services/reclassSheared.ts";
import { RECLASS_SMART_SHIELD_POLICY, validateReclassSmartShieldProposals } from "../../../services/reclassSmartShield.ts";
import { RECLASS_EDITABLE_FIELDS_POLICY, validateReclassEditableFieldProposals } from "../../../services/reclassEditableFields.ts";
import { handleSuspendTag, verifySuspendTagSession, SUSPEND_TAG_EDITORS, suspendTagError } from "../_shared/suspend-tag.ts";
import { readAvPage } from "../_shared/av-read.ts";
import { captureInventoryLocationRevision, enrichInventoryLocationRows } from "../_shared/inventory-location-on-hand.ts";
import { handleNavigationPreferences, resolveModuleAllowed } from "../_shared/navigation-preferences.ts";
import { resolveCanonicalUserAccess, hasAnyCanonicalUserAccessFlag, requireCanonicalUserAccessFlag, type CanonicalUserAccess, type CanonicalUserAccessFlag } from "../_shared/canonical-user-access.ts";
import { assertInventoryLiveChangeActorRows, GLOBAL_INVENTORY_LIVE_CHANGE_USERS, handleProductionWorkflow, handleInventoryTransactionHistory, handleInventoryReclassMove, inventoryReclassMoveError, normalizeInventoryLiveChangeUsername, workflowError } from "../_shared/production-workflow.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "../_shared/database.types.ts";
import {
  INVENTORY_MASTER_BROWSE_FIELDS as MASTER_BROWSE_FIELDS,
  INVENTORY_MASTER_FULL_FIELDS as MASTER_FULL_FIELDS,
  INVENTORY_MASTER_INITIAL_BASE_FIELDS as MASTER_INITIAL_BASE_FIELDS,
  INVENTORY_MASTER_INITIAL_FIELDS as MASTER_INITIAL_FIELDS,
  INVENTORY_NCR_QUEUE_FIELDS,
  INVENTORY_NOT_ON_INVENTORY_FIELDS,
  INVENTORY_PO_DETAIL_FIELDS,
  projectInventoryRows,
} from "../_shared/inventory-projections.ts";
import { createDatabaseRestBridge, legacyDatabaseTableAliases } from "../../../services/databaseRest.ts";
import { jsonObject, jsonValue, type Json } from "../../../services/database-contract-runtime.ts";
import { renderBunchNoteReportsPdf } from "../../../services/bunch-note-pdf.mjs";
import { ERP_SYNC_STAGES, runErpSyncWorkerStep, validateErpSyncCommand, isLegacyRunScriptAction } from "../_shared/erp-sync.mjs";
import { SECONDARY_ERP_STAGES, runSecondaryErpSyncStep } from "../_shared/erp-secondary-sync.mjs";
import { suspendSourceFreshnessFromRows, suspendSourceFreshnessQuery, suspendTagRowsFromResult } from "./suspend-tag-read.ts";
import { createAppRateLimitDigest, createAppSession, getRoleAccessState, isAppAccountActive, isForcedPasswordValue, normalizeRole, normalizeUsername, readAppSessionFromRequest, readSupabaseOrAppSessionFromRequest } from "../_shared/app-auth.ts";
import { recordHandledError, withObservedRequest } from "../_shared/observability.ts";
import { auraInventoryV2ProfileMatches } from "../_shared/aura-auth.ts";
import { auraInventoryV2Rpc } from "../_shared/aura-inventory.ts";
import { historyPhotoUrl, publicHistoryPhoto, readArchivedHistoryThumbnail, isPhotoHistoryUsernameAllowed } from "../_shared/photo-history.ts";
import { isCustomerRepMappingEditorRole, validateCustomerRepMappingRequest } from "../_shared/customer-rep-mapping.ts";
import {
  PHOTO_LEGACY_MAX_BYTES,
  PHOTO_V2_DISPLAY_MAX_BYTES,
  PHOTO_V2_THUMB_144_MAX_BYTES,
  PHOTO_V2_THUMB_320_MAX_BYTES,
  readPositivePhotoDimension,
  sha256Hex,
  type ValidatedPhotoPart,
  validatePhotoPart,
} from "../_shared/photo-upload.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, x-gnc-session, x-app-session, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "x-agdata-app-version, x-request-id",
  "X-AgData-App-Version": APP_RUNTIME_VERSION,
  "Cache-Control": "private, no-store",
};
const databaseBridge = createDatabaseRestBridge(async (url, init, timeout) => fetch(url, {
  ...init,
  signal: AbortSignal.timeout(timeout),
}), legacyDatabaseTableAliases);

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ERP_SYNC_LOCAL_WORKER_KEY = String(Deno.env.get("ERP_SYNC_LOCAL_WORKER_KEY") || "").trim();
const ERP_SYNC_CLOUD_WORKER_KEY = String(Deno.env.get("ERP_SYNC_CLOUD_WORKER_KEY") || "").trim();
const PRODUCTION_SCHEDULE_WORKBOOK_ID = "1myBn2DzyhYtTj2MmYatf26jz575TjqxSpxC-kFt1Mhw";
const PRODUCTION_SCHEDULE_USERS = new Set(["dylan_collyge", "megan_kelly", "jd_jones"]);
const PRODUCTION_SCHEDULE_SIGNING_SECRET = SUPABASE_SERVICE_ROLE_KEY.trim();
const PRODUCTION_SCHEDULE_APPS_SCRIPT_URL = String(Deno.env.get("APPS_SCRIPT_WEB_APP_URL") || "").trim();
const LEGACY_DARK_DEFAULT_USERNAME = "dylan_collyge";
const LIVE_PILOT_FEATURE_KEYS = ["skin", "preferences", "card_grid", "monitoring"] as const;
const LIVE_PILOT_SENTRY_DSN = String(Deno.env.get("LIVE_PILOT_SENTRY_DSN") || "").trim();
const PHOTO_BUCKETS: Record<string, string> = {
  "ssn-": "season_sales_notes_photos",
  "lsn-": "location_sales_notes_photos",
  "req-": "request_photos",
  "eval-": "request_photos",
  "credit-": "credit_photos",
  "dock-": "dock_photos",
  "flyer-": "flyer_photos",
  default: "flyer_photos",
};
const REP_ALLOWED_PHOTO_PREFIXES = new Set(["req-", "credit-", "eval-"]);
const PROTECTED_DRIVE_PHOTO_PREFIXES = new Set(["ssn-", "lsn-", "na-", "flyer-"]);
const LEGACY_TABLE_ALIASES: Record<string, string> = {
  v2_cav: "ph_cav_import",
  ph_cav: "ph_cav_import",
  ph_active_request: "ph_requests_pending",
  ph_active_request_live_rows: "ph_requests_pending",
  ph_request_queue_live_rows: "ph_requests_pending",
  ph_request_history: "ph_requests_completed_history",
  ph_active_drive_mode: "ph_master_inventory",
  ph_drive_mode_history: "ph_drive_around_report_rows",
  ph_active_suspend: "ph_soc_master",
  ph_active_docks: "ph_dock_trip_status",
  ph_docks_history: "ph_dock_trip_status_audit",
  ph_active_orders: "ph_soc_master",
  ph_orders_history: "ph_historical_orders",
  ph_active_reserves: "ph_reserves",
  ph_active_hl_order: "ph_hl_po",
  ph_hl_order_history: "ph_hl_order_previews",
  ph_active_sales_office: "ph_sales_office",
  ph_sales_office_history: "ph_season_sales_office_events",
  ph_active_flyer: "ph_flyer_folder_rows",
  ph_flyer_history: "ph_flyer_folder_history",
  ph_active_crop_roll: "ph_crop_roll_drive_rows",
  ph_crop_roll_history: "ph_crop_roll_runs",
  ph_active_production: "ph_production_workflow_rows",
  ph_active_production_schedule: "production_schedule_active",
  ph_production_schedule_history: "production_schedule_snapshots",
  ph_active_hold_learning: "ph_hold_learning_profiles",
  ph_hold_learning_history: "ph_hold_learning_events",
  ph_active_chat: "ph_chat_conversations",
  ph_chat_history: "ph_chat_messages",
  ph_active_walkie: "ph_walkie_channels",
  ph_walkie_history: "ph_walkie_calls",
  ph_delivery_outbox: "ph_request_delivery_outbox",
  ph_hr_employees: "core_employees",
  ph_hr_events: "hr_events",
  ph_hr_job_codes: "hr_job_codes",
  ph_hr_timesheets: "labor_timesheets",
  ph_hr_calendar_outbox: "hr_calendar_reminder_outbox",
  ph_marketing_materials: "marketing_materials",
  ph_active_inventory_projects: "inventory_projects",
  ph_inventory_project_rows: "inventory_project_rows",
  ph_watchdog_events: "app_runtime_watchdog_events",
  ph_dataset_revisions: "app_dataset_revisions",
  ph_manual_sync_status: "app_manual_sync_status",
  ph_aura_domain_glossary: "aura_domain_glossary",
};
const AV_OPTION_EVAL_REQUESTS_TABLE = "ph_av_option_eval_requests";
const AV_OPTION_EVAL_MANAGER_USERS = new Set(["dylan_collyge", "jd_jones", "megan_kelly"]);
const FULL_ACCESS_USER_KEYS = new Set(["dylan_collyge", "jd_jones", "megan_kelly"]);
const JD_EXECUTIVE_SALESREP_ID = "AGDATA_EXECUTIVE_ALL";
const APPS_SCRIPT_PROXY_ACTIONS = new Set([
  "email", "image", "block_clearing_pdf", "bunch_note_preview", "hl_order_preview", "inventory_transaction", "inventory_transaction_history",
  "reclass_inquiry_status", "reclass_inquiry_retry", "reclass_inquiry_email",
  "clear_request_gallery_cache", "drivearound_name_preview", "drivearound_name_cleanup",
  "manual_continue", "manual_run", "manual_clear_status", "manual_clear_stale_status", "manual_status", "wake_delivery_worker",
]);
const APPS_SCRIPT_EMAIL_TYPES = new Set([
  "new_request", "request_complete", "ncr_complete", "ncr_approval", "hold_release_request",
  "drive_customer_outreach", "bloom_crop_update", "bloom_purpose_report", "drive_shift_report",
  "block_clearing_email", "flyer_created", "request_rep_reviewed",
]);
const AV_OPTION_EVAL_STATUS_VALUES = new Set(["open", "in_progress", "complete", "cancelled"]);
const AV_OPTION_EVAL_INSERT_FIELDS = new Set([
  "status",
  "assignedto",
  "instructions",
  "selected_row_snapshot",
  "original_row_snapshot",
  "itemcode",
  "commonname",
  "contsize",
  "locationcode",
  "lotcode",
  "priority",
  "ptronhand",
  "ptravailable",
  "s_lts",
  "source",
  "selected_photo_link",
  "selected_photo_name",
  "selected_spec",
  "selected_caliper",
  "selected_av_note",
  "original_itemcode",
  "original_commonname",
  "original_contsize",
  "original_locationcode",
  "original_lotcode",
  "original_priority",
  "original_ptronhand",
  "original_ptravailable",
  "original_s_lts",
  "original_source",
  "original_photo_link",
  "original_photo_name",
  "original_spec",
  "original_caliper",
  "original_av_note",
]);
const AV_OPTION_EVAL_EVALUATOR_UPDATE_FIELDS = new Set([
  "status",
  "result_photo_link",
  "result_photo_name",
  "result_spec",
  "result_caliper",
  "result_loc_match_percent",
  "result_pick_note",
  "result_comments",
  "result_av_note",
]);
const AV_OPTION_EVAL_MANAGER_UPDATE_FIELDS = new Set([
  ...AV_OPTION_EVAL_EVALUATOR_UPDATE_FIELDS,
  "assignedto",
  "instructions",
]);

function normalizeLoginPasswordForComparison(value = "") {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function doesLoginPasswordMatch(dbPassword = "", inputPassword = "") {
  const stored = String(dbPassword || "").trim();
  const entered = String(inputPassword || "").trim();
  if (!stored || !entered) return false;
  if (stored === entered) return true;
  if (!isForcedPasswordValue(stored)) return false;
  return normalizeLoginPasswordForComparison(stored) === normalizeLoginPasswordForComparison(entered);
}

const READABLE_TABLES = new Set([
  "ph_master_inventory",
  "ph_requests_pending",
  "ph_00_table_directory",
  "ph_active_location_moves",
  "ph_location_moves_history",
  "ph_active_recount",
  "ph_recount_history",
  "ph_active_count_review",
  "ph_count_review_history",
  "ph_active_shear_list",
  "ph_shear_list_history",
  "ph_active_eval_work",
  "ph_eval_work_history",
  "ph_active_bunch_notes",
  "ph_bunch_notes_history",
  "ph_request_delivery_status",
  "ph_crop_roll_drive_rows",
  "ph_crop_roll_open_rows",
  "ph_crop_roll_runs",
  "ph_crop_roll_rows",
  "ph_customer_consignee_sales_reps",
  "ph_requests_completed_history",
  "ph_sales_credit_requests",
  "ph_request_email_threads",
  "ph_reserves",
  "ph_soc_master",
  "ph_sales_office",
  "ph_take_back_queue",
  "ph_cav_import",
  "ph_av_notes",
  "ph_view_av_hot_price_keys",
  "ph_dock_team_status",
  "ph_dock_item_status",
  "ph_dock_issue_status",
  "ph_dock_issue_allocations",
  "ph_app_users",
  "ph_app_settings",
  "ph_app_live_events",
  "ph_push_subscriptions",
  "ph_inventory_edit_requests",
  "ph_inventory_edit_request_events",
  "ph_flyer_folder_rows",
  "ph_flyer_folder_history",
  "ph_productivity_history",
  "ph_ncr_completions",
  "ph_production_workflow_rows",
  "ph_spread_counts",
  "ph_bunch_counts",
  "ph_grower_scout_reports",
  "ph_grower_scout_assets",
  "marketing_materials",
  "ph_department_calendar_events",
  "ph_chat_conversations",
  "ph_chat_participants",
  "ph_chat_messages",
  "ph_walkie_channels",
  "ph_walkie_channel_members",
  "ph_walkie_calls",
  "ph_walkie_call_members",
  "ph_walkie_signal_events",
  "ph_weather_hourly",
  "ph_weather_daily",
  "ph_hold_learning_events",
  "ph_hold_learning_profiles",
  "ph_hold_release_cycles",
  "ph_hold_stop_itemcode_snapshots",
  "ph_hold_stop_itemcode_cycles",
  "ph_hold_stop_itemcode_summaries",
  "ph_warehouse_assigned_items",
  "ph_inventory_row_assignments",
  "ph_itemcode_default_owners",
  "ph_hl_po",
  "ph_view_po_27f1_hl",
  AV_OPTION_EVAL_REQUESTS_TABLE,
]);
const WRITABLE_TABLES = new Set([
  "ph_master_inventory",
  "ph_soc_master",
  "ph_av_notes",
  "ph_reserves",
  "ph_requests_pending",
  "ph_crop_roll_drive_rows",
  "ph_crop_roll_runs",
  "ph_crop_roll_rows",
  "ph_requests_completed_history",
  "ph_sales_credit_requests",
  "ph_request_email_threads",
  "ph_sales_office",
  "ph_take_back_queue",
  "ph_dock_team_status",
  "ph_dock_item_status",
  "ph_dock_issue_status",
  "ph_dock_issue_allocations",
  "ph_labor_hours",
  "ph_app_users",
  "ph_app_settings",
  "ph_app_live_events",
  "ph_push_subscriptions",
  "ph_inventory_edit_requests",
  "ph_inventory_edit_request_events",
  "ph_flyer_folder_rows",
  "ph_flyer_folder_history",
  "ph_productivity_history",
  "ph_ncr_completions",
  "ph_production_workflow_rows",
  "ph_spread_counts",
  "ph_bunch_counts",
  "ph_grower_scout_reports",
  "ph_grower_scout_assets",
  "marketing_materials",
  "ph_department_calendar_events",
  "ph_chat_conversations",
  "ph_chat_participants",
  "ph_chat_messages",
  "ph_walkie_channels",
  "ph_walkie_channel_members",
  "ph_walkie_calls",
  "ph_walkie_call_members",
  "ph_walkie_signal_events",
  AV_OPTION_EVAL_REQUESTS_TABLE,
]);
const COMMON_AUTH_WRITE_TABLES = new Set([
  "ph_push_subscriptions",
  "ph_app_live_events",
  "ph_labor_hours",
  "ph_department_calendar_events",
  "ph_chat_conversations",
  "ph_chat_participants",
  "ph_chat_messages",
  "ph_walkie_channels",
  "ph_walkie_channel_members",
  "ph_walkie_calls",
  "ph_walkie_call_members",
  "ph_walkie_signal_events",
]);
const COMMON_AUTH_READ_TABLES = new Set([
  "ph_app_live_events",
  "ph_chat_conversations",
  "ph_chat_participants",
  "ph_chat_messages",
  "ph_walkie_channels",
  "ph_walkie_channel_members",
  "ph_walkie_calls",
  "ph_walkie_call_members",
  "ph_walkie_signal_events",
]);
const REP_READ_TABLES = new Set([
  ...COMMON_AUTH_READ_TABLES,
  "ph_master_inventory",
  "ph_requests_pending",
  "ph_request_delivery_status",
  "ph_customer_consignee_sales_reps",
  "ph_requests_completed_history",
  "ph_sales_credit_requests",
  "ph_request_email_threads",
  "ph_reserves",
  "ph_soc_master",
  "ph_sales_office",
  "ph_cav_import",
  "ph_av_notes",
  "ph_warehouse_assigned_items",
  "ph_inventory_row_assignments",
  "ph_itemcode_default_owners",
  "ph_dock_team_status",
  "ph_dock_item_status",
  "ph_inventory_edit_requests",
  "ph_inventory_edit_request_events",
  "ph_shear_list",
  AV_OPTION_EVAL_REQUESTS_TABLE,
]);
const SALES_MARKETING_READ_TABLES = new Set([
  ...COMMON_AUTH_READ_TABLES,
  "ph_master_inventory",
  "ph_soc_master",
  "ph_app_settings",
  "ph_sales_office",
  "ph_cav_import",
  "ph_av_notes",
  "ph_warehouse_assigned_items",
  "ph_inventory_row_assignments",
  "ph_itemcode_default_owners",
  "ph_dock_team_status",
  "ph_dock_item_status",
]);
const REP_WRITE_TABLES = new Set([
  ...COMMON_AUTH_WRITE_TABLES,
  "ph_requests_pending",
  "ph_requests_completed_history",
  "ph_sales_credit_requests",
  "ph_request_email_threads",
  "ph_sales_office",
  "ph_inventory_edit_requests",
  "ph_inventory_edit_request_events",
]);
const QC_WRITE_TABLES = new Set([
  ...COMMON_AUTH_WRITE_TABLES,
  "ph_dock_team_status",
  "ph_dock_item_status",
  "ph_dock_issue_status",
  "ph_dock_issue_allocations",
]);
const MASTER_QC_WRITABLE_FIELDS = new Set(["dock_note"]);

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ESCAPED_DISPLAY_TEXT_FIELDS = new Set([
  "commonname", "description", "plantname", "productdescription",
  "avnote", "picnote", "picknote", "locationnote", "locnote", "salesnote",
  "requestnote", "reqpicnote", "reqsalesnote", "reqcomments",
  "customer", "customername", "reqcustomer", "requestcustomer", "consignee", "consigneename",
  "requestfolder", "reqfolder", "holdstopreason", "holdreason", "docknote", "flyernotes",
  "inventorynote", "internalinvnote", "tagdeptnote",
]);

function escapedDisplayTextFieldKey(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeEscapedDisplayText(value: unknown) {
  if (typeof value !== "string" || !value.includes("\\")) return value;
  return value.replace(/\\+(["'])/g, "$1");
}

function normalizeEscapedDisplayPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => { value[index] = normalizeEscapedDisplayPayload(entry); });
    return value;
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  Object.entries(record).forEach(([key, entry]) => {
    record[key] = ESCAPED_DISPLAY_TEXT_FIELDS.has(escapedDisplayTextFieldKey(key)) && typeof entry === "string"
      ? normalizeEscapedDisplayText(entry)
      : normalizeEscapedDisplayPayload(entry);
  });
  return record;
}

function escapedDisplayTextJsonReplacer(key: string, value: unknown) {
  return ESCAPED_DISPLAY_TEXT_FIELDS.has(escapedDisplayTextFieldKey(key))
    ? normalizeEscapedDisplayText(value)
    : value;
}

function jsonResponse(body: unknown, status = 200) {
  const appVersion = "2.3.104";
  const versionedBody = body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), app_version: appVersion }
    : body;
  return new Response(JSON.stringify(versionedBody, escapedDisplayTextJsonReplacer), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

function errorResponse(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, ...extra }, status);
}

function profilelessActionResponse(action: string, payload: Record<string, unknown>): Response | null {
  if (action === "navigation_preferences") return jsonResponse({ ok: true, data: null, retained: true, profilePending: true });
  if (action === "get_user_preferences" || action === "live_pilot_bootstrap") return jsonResponse({ ok: true, eligible: false, monitoringEligible: false, flags: {}, preferences: null, monitoring: null, retained: true, profilePending: true });
  if (["dataset_read", "inventory_read", "historical_requests_read", "inventory_consolidation"].includes(action)) {
    return retainedReadResponse(`${action.toUpperCase()}_PROFILE_PENDING`, { profilePending: true });
  }
  if (action === "request_work") return String(payload.operation || "") === "capabilities"
    ? jsonResponse({ ok: true, data: { canViewQueue: false, canEditRequest: false, retained: true }, retained: true, profilePending: true })
    : transientOkResponse("REQUEST_WORK_PROFILE_PENDING", "Request work is waiting for the active profile.");
  return null;
}

function transientOkResponse(code: string, message: string, data: Record<string, unknown> = {}) {
  return jsonResponse({ ok: false, code, message, retained: true, retryable: true, data });
}

function retainedReadResponse(code: string, data: Record<string, unknown> = {}) {
  return jsonResponse({ ok: true, code, retained: true, retryable: true, data: {
    rows: [], total: 0, offset: 0, limit: 0, hasMore: false, retained: true, retryable: true, ...data,
  } });
}

async function failOpenInventoryConflict(response: Response) {
  if (response.status !== 409) return response;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return jsonResponse({ ok: true, code: String(payload.code || "INVENTORY_READ_CHANGED"), retained: true, retryable: true,
    data: { rows: [], total: 0, retained: true, retryable: true, revisionChanged: true } });
}

// Preserve Postgres/PostgREST error identity across the authorized API boundary.
// In particular, permission failures must stay terminal (403) for clients and
// serialization conflicts must stay conflicts (409), rather than being
// flattened into a retryable generic 503.
function databaseFailureResponse(
  message: string,
  error: unknown,
  fallbackCode: string,
) {
  const dbError = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(dbError.code || fallbackCode);
  const explicitStatus = /^PT[45]\d{2}$/.test(code) ? Number(code.slice(2)) : 0;
  const status = code === "42501" ? 403 : (code === "40001" || code === "PT409") || code === "23505" ? 409 : explicitStatus || 503;
  return errorResponse(message, status, { code });
}

// Expected import suspension is a read state, not a serialization retry. Avoid
// invoking the exception-raising totals RPC while the source is already fenced.
async function captureReadyInventoryLocationRevision(actorId: string): Promise<string> {
  const { data, error } = await supabase.from("app_dataset_revisions")
    .select("revision,state").eq("key", "ph_master_inventory").maybeSingle();
  if (error) throw new Error("LOC_ON_HAND_SOURCE_UNAVAILABLE");
  if (!data || !/^[1-9]\d*$/.test(String(data.revision ?? ""))) {
    throw new Error("LOC_ON_HAND_SOURCE_NOT_READY");
  }
  // Do not decide readiness from the fence row alone. The read-only RPC also
  // accepts an attested last-published snapshot while a staged atomic import
  // is interrupted, but still compares this exact revision before returning.
  return captureInventoryLocationRevision(supabase, actorId);
}

function inventoryLocationReadFailureResponse(error: unknown): Response | null {
  const code = String(error instanceof Error ? error.message : error || "");
  if (!/LOC_ON_HAND/.test(code)) return null;
  if (code.includes("LOC_ON_HAND_SOURCE_NOT_READY")) {
    return jsonResponse({ ok: true, code: "LOC_ON_HAND_SOURCE_NOT_READY", retained: true, retryable: true,
      data: { rows: [], total: 0, retained: true, retryable: true, source: "ph_master_inventory" } });
  }
  if (code.includes("LOC_ON_HAND_REVISION_CHANGED")) return null;
  return errorResponse("Inventory totals could not be verified.", 503, { code, retryable: false });
}

function ensureServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
}

function normalizeTableName(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (LEGACY_TABLE_ALIASES[raw]) return LEGACY_TABLE_ALIASES[raw];
  if (raw.startsWith("v2_")) return `ph_${raw.slice(3)}`;
  return raw;
}

function getLegacyTableName(value = "") {
  const normalized = normalizeTableName(value);
  if (!normalized.startsWith("ph_")) return normalized;
  if (normalized === "ph_cav_import") return "v2_cav_import";
  return `v2_${normalized.slice(3)}`;
}

async function responseLooksLikeMissingRelation(response: Response) {
  if (![400, 404].includes(response.status)) return false;
  const text = await response.clone().text().catch(() => "");
  return /42P01|PGRST20[045]|does not exist|Could not find the table|schema cache/i.test(text);
}

function buildRestHeaders(method = "GET", table = "") {
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (method === "POST") {
    headers.Prefer = table === "ph_requests_pending" ? "return=minimal" : "return=minimal,resolution=merge-duplicates";
  } else if (method === "PATCH" || method === "DELETE") {
    headers.Prefer = "return=minimal";
  }
  return headers;
}

function withSelect(query = "", selectValue = "*") {
  const params = new URLSearchParams(String(query || ""));
  params.set("select", selectValue);
  return params.toString();
}

const INTERNAL_MOVE_REQUEST_INSERT_FIELDS = new Set([
  "unique_id", "master_id", "commonname", "contsize", "locationcode", "lotcode", "itemcode", "ptravailable",
  "priority", "requested_by", "request_folder", "req_customer", "req_qty", "desired_spec", "desired_caliper",
  "req_reserve", "req_comments", "req_archived", "req_status", "app_tab_assignment", "assignedto", "move_batch_id",
  "move_approval_stage", "move_status", "move_group_key", "move_from_locationcode", "move_to_locationcode",
  "move_planned_qty", "move_actual_qty", "move_destination_needs_row", "move_dylan_approved_at", "move_jd_approved_at",
  "move_completed_at", "move_completed_by", "created_at", "updated_at",
]);
const INTERNAL_EVAL_REQUEST_INSERT_FIELDS = new Set([
  "unique_id", "master_id", "commonname", "contsize", "locationcode", "lotcode", "itemcode", "ptravailable",
  "season_supply", "priority", "qualitycode", "field_tag_color", "requested_by", "request_folder", "req_customer",
  "req_qty", "desired_spec", "desired_caliper", "request_note", "est_ship", "req_reserve", "req_match", "req_spec",
  "req_caliper", "req_pic_note", "req_comments", "av_note", "req_photo_link", "req_photo_name", "req_archived",
  "date_completed", "req_status",
]);

function classifyInternalCustomerRequestInsert(body: unknown): "move" | "eval" | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  const keys = Object.keys(row).map(key => key.trim().toLowerCase());
  if (new Set(keys).size !== keys.length || keys.includes("request_source")
    || keys.some(key => ["customeridentityid", "customername", "consigneeidentityid", "consigneename", "request_selected_rep_username", "request_selected_rep_display", "request_selected_salesrep_id"].includes(key))) return null;
  const move = keys.every(key => INTERNAL_MOVE_REQUEST_INSERT_FIELDS.has(key))
    && /^move_req_[a-z0-9_]{1,120}$/i.test(String(row.unique_id || ""))
    && String(row.req_customer || "").trim() === "Location Move"
    && /^(?:Manual )?Location Move\b/.test(String(row.request_folder || "").trim())
    && String(row.app_tab_assignment || "").trim().toLowerCase() === "moves"
    && !!String(row.move_batch_id || "").trim()
    && ["dylan", "jd"].includes(String(row.move_approval_stage || "").trim().toLowerCase())
    && String(row.move_status || "").trim().toLowerCase() === `pending_${String(row.move_approval_stage || "").trim().toLowerCase()}`
    && String(row.req_status || "").trim().toLowerCase() === "pending"
    && row.req_archived === false;
  if (move) return "move";
  const evalTask = keys.every(key => INTERNAL_EVAL_REQUEST_INSERT_FIELDS.has(key))
    && /^eval-[a-z0-9._-]{1,180}$/i.test(String(row.unique_id || ""))
    && String(row.req_customer || "").trim().startsWith("EVAL Task")
    && String(row.request_folder || "").trim().startsWith("EVAL-")
    && String(row.req_status || "").trim().toLowerCase() === "pending";
  return evalTask ? "eval" : null;
}

function stampInternalCustomerRequestSource(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !classifyInternalCustomerRequestInsert(body)) return null;
  return { ...(body as Record<string, unknown>), request_source: "internal" };
}

function protectCustomerRequestDbWrite(table: string, method: string, body: unknown) {
  if (table !== "ph_requests_pending") return null;
  if (method === "POST") {
    // Move approvals and Eval assignments are legacy internal workflows. Keep
    // their narrow row contracts working; handleDb rechecks the active actor
    // and the corresponding permission before using the service-role proxy.
    if (classifyInternalCustomerRequestInsert(body)) return null;
    return errorResponse("Create requests through the authorized request batch operation.", 410, { code: "REQUEST_BATCH_API_REQUIRED" });
  }
  if (method === "PATCH" && Array.isArray(body)) {
    return errorResponse("Bulk request updates require the protected request workflow.", 410, { code: "REQUEST_BATCH_API_REQUIRED" });
  }
  if (method === "PATCH" && body && typeof body === "object" && !Array.isArray(body)) {
    const protectedFields = new Set([
      "request_source", "customeridentityid", "customername", "consigneeidentityid", "consigneename",
      "requested_by", "request_selected_rep_username", "request_selected_rep_display", "request_selected_salesrep_id",
    ]);
    const bodyFields = Object.keys(body as Record<string, unknown>).map((key) => key.trim().toLowerCase());
    if (bodyFields.some((key) => protectedFields.has(key))) {
      return errorResponse("Customer identity and selected-representative fields require the protected request workflow.", 410, { code: "REQUEST_BATCH_API_REQUIRED" });
    }
  }
  return null;
}

async function authorizeInternalCustomerRequestInsert(
  session: Awaited<ReturnType<typeof readAppSessionFromRequest>>,
  body: unknown,
) {
  const kind = classifyInternalCustomerRequestInsert(body);
  if (!kind || !body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Create requests through the authorized request batch operation.", 410, { code: "REQUEST_BATCH_API_REQUIRED" });
  }
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("An active account profile is required.", 403, { code: "ACTIVE_PROFILE_REQUIRED" }); }
  const username = normalizeUsername(String(actor.username || ""));
  const access = getRoleAccessState(String(session?.role || ""));
  if (!username || (!access.isAdmin && !FULL_ACCESS_USER_KEYS.has(username))) {
    return errorResponse("This request workflow is not available to this account.", 403, { code: "INTERNAL_REQUEST_FORBIDDEN" });
  }
  if (kind === "eval" && !EVAL_WORK_MANAGER_USERS.has(username)) {
    return errorResponse("Eval assignments are available only to authorized managers.", 403, { code: "EVAL_WORK_ASSIGNMENT_FORBIDDEN" });
  }
  const row = body as Record<string, unknown>;
  const masterId = String(row.master_id || "").trim();
  if (!masterId || masterId.length > 200) {
    return errorResponse("A valid inventory source row is required.", 400, { code: "INTERNAL_REQUEST_SOURCE_INVALID" });
  }
  const { data: master, error } = await supabase.from("ph_master_inventory")
    .select("unique_id,itemcode,locationcode,lotcode,commonname,contsize")
    .eq("unique_id", masterId).maybeSingle();
  if (error) return databaseFailureResponse("The inventory source row could not be verified.", error, "INTERNAL_REQUEST_SOURCE_UNAVAILABLE");
  if (!master) return errorResponse("The inventory source row is no longer available.", 409, { code: "INTERNAL_REQUEST_SOURCE_CHANGED" });
  if (kind === "move") {
    // The master UID plus item/location/lot are the stable source identity.
    // Common name and container size are display fields and may legitimately
    // differ in formatting between an older cached card and the current row.
    const exactSource = ["itemcode", "locationcode", "lotcode"]
      .every(key => String(row[key] ?? "").trim() === String(master[key as keyof typeof master] ?? "").trim());
    const from = String(row.move_from_locationcode || "").trim();
    const to = String(row.move_to_locationcode || "").trim();
    const qty = String(row.move_planned_qty ?? "").trim();
    const requester = String(row.requested_by || "").trim();
    const displayName = String(actor.display_name || "").trim();
    if (!exactSource || from !== String(master.locationcode || "").trim() || !to || to.toLowerCase() === from.toLowerCase()
      || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(qty) || !Number.isFinite(Number(qty))
      || (normalizeUsername(requester) !== username && requester.toLowerCase() !== displayName.toLowerCase())) {
      return errorResponse("The move request no longer matches its source row or signed-in requester.", 409, { code: "INTERNAL_MOVE_REQUEST_INVALID" });
    }
  } else if (!EVAL_WORK_ASSIGNABLE_USERS.has(normalizeUsername(String(row.requested_by || "")))) {
    return errorResponse("Choose an authorized Eval assignee.", 400, { code: "EVAL_WORK_ASSIGNMENT_INVALID" });
  }
  return null;
}

async function restRequest(table: string, method = "GET", query = "", body: unknown = null) {
  const normalizedTable = normalizeTableName(table);
  const querySuffix = String(query || "").trim();
  const request = async (tableName: string) => {
    const options: RequestInit = {
      method,
      headers: buildRestHeaders(method, tableName),
    };
    if (body !== null && body !== undefined && method !== "GET") {
      options.body = JSON.stringify(body);
    }
    return await databaseBridge.fetchTable(SUPABASE_URL, tableName, querySuffix, options, 30_000, "app-api.rest-request");
  };
  const response = await request(normalizedTable);
  if (!response.ok && normalizedTable.startsWith("ph_") && await responseLooksLikeMissingRelation(response)) {
    const legacyTable = getLegacyTableName(normalizedTable);
    if (legacyTable && legacyTable !== normalizedTable) return await request(legacyTable);
  }
  return response;
}

async function readResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function sanitizeFileName(value = "") {
  const trimmed = String(value || "").trim();
  const withoutExt = trimmed.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "photo";
}

function sanitizeStorageFileName(value = "") {
  const raw = String(value || "").trim().split(/[\\/]/).pop() || "";
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "").replace(/\.{2,}/g, ".").slice(0, 140);
  if (cleaned && /\.[a-z0-9]{2,8}$/i.test(cleaned)) return cleaned;
  return "";
}

async function uploadImmutablePhotoObject(bucketName: string, path: string, part: ValidatedPhotoPart) {
  if (!new Set(Object.values(PHOTO_BUCKETS)).has(bucketName) || !["image/jpeg", "image/webp"].includes(part.mimeType)) {
    throw new Error("PHOTO_STORAGE_TARGET_INVALID");
  }
  const result = await supabase.storage.from(bucketName).upload(path, part.bytes, {
    contentType: part.mimeType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (result.error) throw new Error("PHOTO_STORAGE_UNAVAILABLE");
}

function hasTableReadAccess(role = "", table = "", username = "") {
  if (!READABLE_TABLES.has(table)) return false;
  const userKey = normalizeUsername(username);
  if (FULL_ACCESS_USER_KEYS.has(userKey)) return true;
  if (table === "ph_hl_po") return userKey === "dylan_collyge";
  if (table === AV_OPTION_EVAL_REQUESTS_TABLE) return true;
  const access = getRoleAccessState(role);
  if (access.isAdmin) return true;
  if (COMMON_AUTH_READ_TABLES.has(table)) return true;
  if (table === "ph_app_users") return true;
  if (access.isSalesMarketing) return SALES_MARKETING_READ_TABLES.has(table);
  if (access.isRepLike) {
    return REP_READ_TABLES.has(table);
  }
  if (access.isQcSupervisor) {
    return new Set(["ph_master_inventory", "ph_soc_master", "ph_dock_team_status", "ph_dock_item_status"]).has(table);
  }
  if (access.isQc) {
    return new Set(["ph_master_inventory", "ph_soc_master", "ph_dock_team_status", "ph_dock_item_status"]).has(table);
  }
  return false;
}

// Canonical module grants extend only the explicitly owned dataset surfaces.
// They never replace actor/profile checks, named restrictions, or row scoping.
const CANONICAL_DATASET_READ_FLAGS: Record<string, readonly CanonicalUserAccessFlag[]> = {
  inventory_edits: ["can_access_drive_mode", "can_access_manager_tab"],
  shear: ["can_access_drive_mode"],
  request_queue: ["can_access_que"],
  active_request: ["can_access_que"],
  soc: ["can_access_drive_mode", "can_access_que"],
  cav: ["can_access_av"],
  reserves: ["can_access_av", "can_access_drive_mode"],
  sales_office: ["can_access_que", "can_access_drive_mode"],
  dock_team: ["can_access_que"],
  dock_item: ["can_access_que"],
  dock_issue: ["can_access_que"],
  dock_allocations: ["can_access_que"],
  productivity_history: ["can_access_drive_mode", "can_access_manager_tab"],
};

function canonicalDatasetReadAllowed(access: CanonicalUserAccess | null, dataset: string) {
  const flags = CANONICAL_DATASET_READ_FLAGS[dataset];
  return Boolean(access && flags && hasAnyCanonicalUserAccessFlag(access, flags));
}

function canonicalInventoryReadAllowed(access: CanonicalUserAccess | null, operation: string, params: Record<string, unknown>) {
  if (!access) return false;
  const inventoryConsumers: readonly CanonicalUserAccessFlag[] = [
    "can_access_drive_mode", "can_access_av", "can_access_que", "can_access_manager_tab",
  ];
  if (operation === "source_freshness" || operation === "schema_capabilities") {
    return hasAnyCanonicalUserAccessFlag(access, inventoryConsumers);
  }
  if (operation !== "master_page") return false;
  const dataset = String(params.dataset || "").trim();
  if (dataset === "avOpen") return access.permissions.can_access_av === true;
  if (dataset === "lookup") {
    return hasAnyCanonicalUserAccessFlag(access, [...inventoryConsumers, "can_submit_reclass"]);
  }
  if (dataset === "master") {
    return hasAnyCanonicalUserAccessFlag(access, inventoryConsumers);
  }
  return false;
}

function firstRequestCompatibilityValue(...values: unknown[]): Json | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value as Json;
  }
  return undefined;
}

function normalizeRequestBrowserCompatibilityRow(row: Record<string, Json | undefined>) {
  const customer = firstRequestCompatibilityValue(row.customer_name, row.customer, row.customername, row.req_customer);
  const consignee = firstRequestCompatibilityValue(row.consignee_name, row.consignee, row.consigneename);
  const quantity = firstRequestCompatibilityValue(row.request_qty, row.qty, row.req_qty);
  const measureSpec = firstRequestCompatibilityValue(row.request_spec, row.measure_spec, row.req_spec, row.desired_spec);
  const requestCaliper = firstRequestCompatibilityValue(row.request_caliper, row.caliper, row.req_caliper, row.desired_caliper);
  const comments = firstRequestCompatibilityValue(row.request_notes, row.comments, row.request_note, row.req_comments);
  return {
    ...row,
    customer: customer ?? null,
    customer_name: customer ?? null,
    consignee: consignee ?? null,
    consignee_name: consignee ?? null,
    qty: quantity ?? null,
    request_qty: quantity ?? null,
    measure_spec: measureSpec ?? null,
    request_spec: measureSpec ?? null,
    caliper: requestCaliper ?? null,
    request_caliper: requestCaliper ?? null,
    comments: comments ?? null,
    request_notes: comments ?? null,
    date_completed: row.date_completed ?? null,
    status: firstRequestCompatibilityValue(row.status, row.req_status) ?? "Pending",
  } satisfies Record<string, Json | undefined>;
}

// This read boundary deliberately accepts dataset and typed filter names rather
// than PostgREST query strings. The table, projection, stable key, and filter
// fields are all selected by this server-owned map.
const DATASET_READ_COLUMN_PROJECTIONS: Record<string, string> = {
  ph_inventory_edit_requests: "id,status,workflow_stage,stage,previous_stage,stage_before_terminal,request_type,priority_flag,inventory_edit_done,inventory_edit_completed_by,inventory_edit_completed_by_display,inventory_edit_completed_at,photo_data_done,photo_data_completed_by,photo_data_completed_by_display,photo_data_completed_at,source_unique_id,master_unique_id,source_view,commonname,contsize,itemcode,locationcode,lotcode,source,ptravailable,s_lts,assignedto,current_priority,current_locationnote,current_pulltagnotes,current_holdstopcode,current_holdreason,requested,changes,snapshot,holdreason,reason,supervisor_note,approved_qty,jd_approved_qty,approved_by,approved_by_display,approved_at,sent_by,sent_by_display,sent_at,edited_by,edited_by_display,edited_at,stage_updated_by,stage_updated_by_display,stage_updated_at,handled_by,handled_by_display,handled_at,handler_note,notification_stage,notification_sent_at,inventory_edit_live,created_at,updated_at",
  ph_shear_list: "unique_id,source_table,source_unique_id,status,percent_to_shear,itemcode,commonname,contsize,locationcode,lotcode,season,blockalpha,ptravailable,holdstopcode,holdstopreason,snapshot,created_by_username,created_by_display,created_at,updated_by_username,updated_by_display,updated_at,completed_by_username,completed_by_display,completed_at,instructions",
  ph_requests_pending: "id,unique_id,master_id,commonname,contsize,locationcode,lotcode,itemcode,ptravailable,season_supply,priority,qualitycode,field_tag_color,plantgroupcode,requested_by,request_folder,req_customer,req_qty,desired_spec,desired_caliper,est_ship,req_reserve,req_photo_link,req_photo_name,req_archived,req_status,req_rep_action,created_at,req_match,req_spec,req_caliper,req_pic_note,req_sales_note,req_comments,av_note,date_completed,completed_by_username,completed_by_display,completed_by_email,req_photo_mode,move_batch_id,move_approval_stage,move_status,move_group_key,move_from_locationcode,move_to_locationcode,move_planned_qty,move_actual_qty,move_destination_needs_row,move_dylan_approved_at,move_jd_approved_at,move_completed_at,move_completed_by,request_note,request_created_by_username,request_created_by_display,request_created_by_email,request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,request_selected_salesrep_id,app_tab_assignment,master_app_tab_assignment,request_source,client_batch_id,updated_at,row_version,customeridentityid,customername,consigneeidentityid,consigneename,photos,photo_url,photo_date,spec,caliper,loc_match_pct,baseline_on_hand,initial_photo_match_qty,loc_photo_match,pick_note,sales_note,photo_expires_at,sales_rep,customer_name,consignee_name,customer_consignee_label,recipient_emails,status,request_qty,effective_qty,is_default_qty,unit_list_price,line_dollar_value,request_spec,request_caliper,estimated_ship,reserve_flag,request_notes,on_hand,review_qty,available_qty,open_stock,loc_on_hand,pri,flag_color,ns_grade,ld_flag,hold_stop_code,hold_stop_reason,hold_stop_since,source_snapshot,fulfillment_status,fulfilled_qty,fulfilled_by,fulfillment_updated_at",
  ph_soc_master: "unique_id,concat,last_updated,assignedto,date_completed,dock_photo_link,dock_photo_name,dock_spec,dock_caliper,dock_note,contsize,warehouseid,warehousename,isreserve,salesrepid,salesrepname,nationalaccount,idgroup,customeridentityid,customername,consigneeidentityid,consigneename,consigneecity,consigneestate,consigneezip,tripnumber,stopnumber,zonecode,tagcode,transactionnumber,purchaseordernumber,extunitprice,ordertotal,requestdate,stagename,step,customersku,formattedupc,printedcontainercode,lotcode,locationcode,descriptorcode,itemcode,plantgroupcode,sortnamevariety,containersort,qualitycode,commonname,quantityordered,quantityshipped,listprice,unitprice,handlingchargeperitem,taggingchargeperitem,combinedprice,freightrateperitem,landed,retailprice,holdstopcode,holdstopreason,salesnote,fnsalesnote,picknote,planstart,generalloadinstr,invoicedate,consigneeaddress_1,consigneeaddress_2,altshipcomment,shiptotelephone_1,okloadinstructions,txloadinstructions,ncloadinstructions,hlloadinstructions,dock,equiv_unit,equiv_uom,wingdingunits,dropweight,internalinvnote,hardinesszone,brand,tagdeptnote,ext_unit_merch_shipped,ext_eunit_shipped,avg_price_eunit_shipped,requestdateweek,carrier,suspend,suspend_to,qa_code,grower,priority,ptronhand,ptrreviewed,ptravailable,season_supply,s_lts,itemspec,season,mcstatus,hz,intercopo,insurancegroup,si_lts,a_lts,ai_lts,si_available,holdstopenddate,salesnote_1,spec,caliper,pic_note,sales_note,av_note,photo_link,photo_name,flyer_cat,flyer_title,flyer_inst,flyer_assigned,flyer_notes,flyer_photo_link,flyer_photo_name,flyer_completed,initial_ptr,loc_match_qty,end_cap_folder,end_cap_qty,end_cap_level,match,dock_num,source,desigitem,desigcust,desigloc,filename,suspend_candidate_group,suspend_candidate_state,suspend_order_quantity,suspend_origin_uid",
  suspend_tag: "unique_id,concat,last_updated,date_completed,assignedto,status,request_type,is_suspend_tag,customeridentityid,customername,customer,consigneeidentityid,consigneename,consignee,salesrepid,salesrepname,sales_rep,dock_num,dock,stopnumber,drop_number,transactionnumber,itemcode,commonname,contsize,locationcode,lotcode,source,suspend,suspend_to,suspendto,qty,quantityordered,quantityshipped,ptravailable,priority,planstart,requestdateweek,purchaseordernumber,desigitem,desigcust,desigloc,spec,caliper,dock_spec,dock_caliper,dock_note,dock_photo_link,dock_photo_name,photo_link,photo_name,match,loc_match_qty,av_note,pic_note,picknote,salesnote,sales_note,salesnote_1,ptronhand,ptrreviewed,holdstopcode,holdstopreason,suspend_candidate_group,suspend_candidate_state,suspend_order_quantity,suspend_origin_uid,on_hand,review,available,open_stock,loc_photo_match,loc_on_hand",
  ph_cav_import: "unique_id,last_updated,filename,itemcode,commonname,contsize,season,ptravailable,brand,spec,hz,unitprice,holdstopreason,ordertotal,product_description,brand_code,h,available,reserved_qty,order_qty,unit_price,n_star,hot_price,hold_reason,ext_item_total,created_at",
  ph_reserves: "unique_id,concat,last_updated,assigned_to,assignedto,spec,caliper,pic_note,sales_note,av_note,photo_link,photo_name,dock_spec,dock_caliper,dock_note,dock_photo_link,dock_photo_name,date_completed,flyer_cat,flyer_title,flyer_inst,flyer_assigned,flyer_notes,flyer_photo_link,flyer_photo_name,flyer_completed,initial_ptr,loc_match_qty,end_cap_folder,end_cap_qty,end_cap_level,match,item,size,container,location,lot,warehouseid,warehousename,isreserve,salesrepid,salesrepname,nationalaccountidgroup,national_account_idgroup,idgroup,customeridentityid,customername,consigneeidentityid,consigneename,consigneecity,consigneestate,consigneezip,tripnumber,stopnumber,zonecode,tagcode,transactionnumber,purchaseordernumber,extunitprice,ordertotal,requestdate,stagename,step,customersku,formattedupc,printedcontainercode,lotcode,locationcode,descriptorcode,itemcode,plantgroupcode,sortname,variety,containersort,qualitycode,commonname,quantityordered,quantityshipped,listprice,unitprice,handlingchargeperitem,taggingchargeperitem,combinedprice,freightrateperitem,landedretailprice,holdstopcode,holdstopreason,salesnote,fnsalesnote,picknote,planstart,generalloadinstr,invoicedate,consigneeaddress_1,consigneeaddress_2,altshipcomment,shiptotelephone_1,okloadinstructions,txloadinstructions,ncloadinstructions,hlloadinstructions,dock,equiv_unit,equiv_uom,wingdingunits,dropweight,internalinvnote,hardinesszone,brand,tagdeptnote,ext_unit,merch_shipped,ext_unit_merch_shipped,ext_eunit_shipped,avg_price_eunit_shipped,requestdateweek,carrier,suspend,suspend_to,qa_code,grower,nationalaccount,sortnamevariety,landed,retailprice,dock_num,priority,ptronhand,ptrreviewed,ptravailable,season_supply,s_lts,itemspec,season,mcstatus,hz,intercopo,insurancegroup,si_lts,a_lts,ai_lts,si_available,holdstopenddate,salesnote_1,contsize,source,desigitem,desigcust,desigloc,filename",
  ph_sales_office: "unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,priority,sales_note,photo_link,photo_date,completed_by,completed_at,master_id,so_source,order_folder,order_number,order_customer,order_qty,order_desired_spec,order_desired_caliper,order_reserve,order_submitted_by,order_submitted_at,order_status,av_note,spec,caliper,photo_name,move_batch_id,move_from_locationcode,move_to_locationcode,move_actual_qty,workflow_status,workflow_detail,state_revision,reopen_reason,source_revision,updated_at,arrived_at",
  ph_dock_team_status: "dock_num,checker,inspector,mistake,status,updated_by,updated_at",
  ph_dock_item_status: "unique_id,checker_done,inspector_done,checker_completed_by,inspector_completed_by,updated_by,updated_at",
  ph_dock_issue_status: "issue_source_unique_id,source_master_unique_id,source_master_id,dock_num,stop_number,source_locationcode,source_itemcode,source_commonname,source_contsize,source_lotcode,source_qty,source_salesrep,source_customername,source_consigneename,issue_note,issue_state,flagged_by,flagged_at,resolved_by,resolved_at,updated_by,updated_at,source_match_key,issue_photo_link,issue_photo_name,source_photo_link,source_photo_name,photo_date,source_loc_match_qty,source_spec,source_caliper",
  ph_dock_issue_allocations: "allocation_unique_id,issue_source_unique_id,alt_master_unique_id,alt_master_id,allocated_qty,alt_locationcode,alt_lotcode,alt_itemcode,alt_commonname,alt_contsize,alt_ptravailable,updated_by,updated_at",
  ph_productivity_history: "id,event_key,completed_by_username,completed_by_display,completed_at,source_table,source_kind,source_unique_id,source_assignment,itemcode,commonname,contsize,locationcode,lotcode,customer_name,request_folder,snapshot",
};
type DatasetReadRelation =
  | ((keyof Database["public"]["Tables"] | keyof Database["public"]["Views"]) & string)
  | "ph_active_suspend";
const DATASET_READ_SOURCES: Record<string, { table: DatasetReadRelation; permission: string; key: string; fields: string; signatures?: string; filterFields: Set<string>; orderFields: Set<string> }> = {
  app_user_directory: {
    table: "profiles", permission: "ph_app_users", key: "username", fields: "username,display_name,role,division,language",
    filterFields: new Set(["username", "role", "division", "language"]), orderFields: new Set(["username", "display_name", "role"]),
  },
  inventory_edits: {
    table: "ph_inventory_edit_requests", permission: "ph_inventory_edit_requests", key: "id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_inventory_edit_requests,
    filterFields: new Set(["id", "status", "workflow_stage", "stage", "source_unique_id", "master_unique_id", "itemcode", "locationcode", "lotcode", "stage_updated_at", "updated_at"]),
    orderFields: new Set(["id", "stage_updated_at", "created_at", "updated_at"]),
  },
  shear: {
    table: "ph_shear_list", permission: "ph_shear_list", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_shear_list,
    filterFields: new Set(["unique_id", "source_unique_id", "status", "itemcode", "locationcode", "lotcode", "season", "blockalpha", "created_at", "updated_at"]),
    orderFields: new Set(["unique_id", "created_at", "updated_at", "completed_at"]),
  },
  request_queue: {
    table: "ph_requests_pending", permission: "ph_requests_pending", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_requests_pending,
    signatures: "unique_id,status,req_status,req_archived,req_rep_action,request_folder,req_customer,req_qty,request_qty,effective_qty,is_default_qty,line_dollar_value,date_completed,req_match,loc_match_pct,loc_photo_match,req_spec,request_spec,spec,req_caliper,request_caliper,caliper,desired_spec,desired_caliper,req_pic_note,pick_note,request_note,request_notes,req_comments,av_note,sales_note,req_photo_link,photo_url,photos,move_batch_id,move_approval_stage,move_status,move_group_key,move_from_locationcode,move_to_locationcode,move_planned_qty,move_actual_qty,move_destination_needs_row,move_dylan_approved_at,move_jd_approved_at,move_completed_at,move_completed_by",
    filterFields: new Set(["unique_id", "master_id", "itemcode", "locationcode", "lotcode", "requested_by", "request_selected_rep_username", "request_folder", "req_status", "req_archived", "req_rep_action", "app_tab_assignment", "master_app_tab_assignment", "request_source", "move_batch_id", "created_at", "updated_at", "date_completed"]),
    orderFields: new Set(["unique_id", "created_at", "updated_at", "req_status"]),
  },
  active_request: {
    table: "ph_requests_pending", permission: "ph_requests_pending", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_requests_pending,
    signatures: "unique_id,req_status,req_archived,req_rep_action,request_folder,req_customer,req_qty,date_completed,req_match,req_spec,req_caliper,desired_spec,desired_caliper,req_pic_note,request_note,req_comments,av_note,req_photo_link,req_photo_name,move_batch_id,move_approval_stage,move_status,move_group_key,move_from_locationcode,move_to_locationcode,move_planned_qty,move_actual_qty,move_destination_needs_row,move_dylan_approved_at,move_jd_approved_at,move_completed_at,move_completed_by",
    filterFields: new Set(["unique_id", "master_id", "itemcode", "locationcode", "lotcode", "requested_by", "request_selected_rep_username", "request_folder", "req_status", "req_archived", "req_rep_action", "app_tab_assignment", "master_app_tab_assignment", "request_source", "created_at", "updated_at", "date_completed"]),
    orderFields: new Set(["unique_id", "created_at", "updated_at", "date_completed", "req_status"]),
  },
  soc: {
    table: "ph_soc_master", permission: "ph_soc_master", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_soc_master,
    filterFields: new Set(["unique_id", "tripnumber", "stopnumber", "dock_num", "assignedto", "salesrepid", "salesrepname", "customername", "consigneename", "transactionnumber", "itemcode", "locationcode", "lotcode", "season", "source", "last_updated", "date_completed", "planstart", "warehouseid", "stagename"]),
    orderFields: new Set(["unique_id", "last_updated", "date_completed", "tripnumber", "stopnumber", "itemcode", "locationcode"]),
  },
  // Suspend Tag is a server-filtered subset of SOC. Keep the same SOC
  // authorization boundary while returning only fields used by its cards/actions.
  suspend_tag: {
    table: "ph_active_suspend", permission: "ph_soc_master", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.suspend_tag,
    filterFields: new Set(), orderFields: new Set(["unique_id"]),
  },
  cav: {
    table: "ph_cav_import", permission: "ph_cav_import", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_cav_import,
    filterFields: new Set(["unique_id", "itemcode", "season", "contsize", "filename", "last_updated", "hot_price", "brand_code", "hold_reason"]),
    orderFields: new Set(["unique_id", "itemcode", "season", "last_updated", "hot_price"]),
  },
  reserves: {
    table: "ph_reserves", permission: "ph_reserves", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_reserves,
    filterFields: new Set(["unique_id", "itemcode", "locationcode", "lotcode", "season", "salesrepname", "customername", "consigneename", "tripnumber", "dock_num", "source", "holdstopreason", "last_updated", "assignedto", "assigned_to", "warehouseid"]),
    orderFields: new Set(["unique_id", "last_updated", "itemcode", "locationcode", "lotcode", "season", "salesrepname", "customername"]),
  },
  sales_office: {
    table: "ph_sales_office", permission: "ph_sales_office", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_sales_office,
    filterFields: new Set(["unique_id", "master_id", "so_source", "order_folder", "order_number", "order_customer", "order_status", "workflow_status", "move_batch_id", "itemcode", "locationcode", "lotcode", "completed_by", "completed_at", "updated_at"]),
    orderFields: new Set(["unique_id", "completed_at", "updated_at", "order_submitted_at", "order_status", "workflow_status"]),
  },
  dock_team: {
    table: "ph_dock_team_status", permission: "ph_dock_team_status", key: "dock_num", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_dock_team_status,
    filterFields: new Set(["dock_num", "status", "updated_by", "updated_at"]), orderFields: new Set(["dock_num", "updated_at"]),
  },
  dock_item: {
    table: "ph_dock_item_status", permission: "ph_dock_item_status", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_dock_item_status,
    filterFields: new Set(["unique_id", "checker_done", "inspector_done", "updated_by", "updated_at"]), orderFields: new Set(["unique_id", "updated_at"]),
  },
  dock_issue: {
    table: "ph_dock_issue_status", permission: "ph_dock_issue_status", key: "issue_source_unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_dock_issue_status,
    filterFields: new Set(["issue_source_unique_id", "source_master_unique_id", "dock_num", "source_locationcode", "source_itemcode", "source_lotcode", "issue_state", "source_match_key", "updated_at"]), orderFields: new Set(["issue_source_unique_id", "dock_num", "updated_at"]),
  },
  dock_allocations: {
    table: "ph_dock_issue_allocations", permission: "ph_dock_issue_allocations", key: "allocation_unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_dock_issue_allocations,
    filterFields: new Set(["allocation_unique_id", "issue_source_unique_id", "alt_master_unique_id", "updated_at"]), orderFields: new Set(["allocation_unique_id", "issue_source_unique_id", "updated_at"]),
  },
  productivity_history: {
    table: "ph_productivity_history", permission: "ph_productivity_history", key: "event_key",
    fields: "event_key,completed_by_username,completed_by_display,completed_at,source_table,source_kind,source_unique_id,source_assignment,itemcode,commonname,contsize,locationcode,lotcode,customer_name,request_folder,snapshot",
    filterFields: new Set(["event_key", "completed_by_username", "completed_at", "source_kind", "source_table", "source_unique_id"]), orderFields: new Set(["event_key", "completed_at", "completed_by_username"]),
  },
};
const DATASET_READ_FILTER_OPERATORS = new Set(["eq", "neq", "in", "ilike", "is", "gte", "lte", "gt", "lt", "not.is", "not.ilike"]);
const DATASET_READ_PAGE_MAX = 500;
const DATASET_READ_RETAIN_ONLY_ALIASES = new Set(["master_inventory", "access_control", "managers_dashboard"]);
const PRODUCTIVITY_HISTORY_SOURCE_KINDS = new Set(["season_sales_note", "location_sales_note", "need_av", "flyer", "request", "sales_office_order", "end_cap", "task"]);
const PRODUCTIVITY_HISTORY_ENTRY_FIELDS = new Set(["event_key", "completed_by_username", "completed_by_display", "completed_at", "source_table", "source_kind", "source_unique_id", "source_assignment", "itemcode", "commonname", "contsize", "locationcode", "lotcode", "customer_name", "request_folder", "snapshot"]);

function normalizeDatasetReadAlias(value: unknown): string {
  const key = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  const aliases: Record<string, string> = {
    ph_app_users: "app_user_directory",
    ph_master_inventory: "master_inventory", ph_soc_master: "soc", suspend: "suspend_tag",
    ph_soc_suspend_tag_rows: "suspend_tag", ph_active_request: "active_request",
    ph_active_request_live_rows: "active_request", ph_requests_pending: "active_request",
    ph_reserves: "reserves", ph_cav_import: "cav",
    requests: "request_queue", ph_request_queue_live_rows: "request_queue", docks: "dock_team",
    location_move: "location_moves", recount: "sales_office", shear_list: "shear",
    bunch_count_review: "count_review", access_control: "access_control",
    managers_dashboard: "managers_dashboard",
  };
  return aliases[key] || key;
}

function validateDatasetReadParams(payload: Record<string, unknown>) {
  if (Object.keys(payload).some((key) => !["action", "dataset", "params"].includes(key))) throw new Error("DATASET_READ_PAYLOAD_INVALID");
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown> : {};
  if (payload.params !== undefined && (!payload.params || typeof payload.params !== "object" || Array.isArray(payload.params))) throw new Error("DATASET_READ_PARAMETERS_INVALID");
  if (Object.keys(params).some((key) => !["limit", "offset", "select", "projection", "filters", "anyOf", "order", "ifRevision"].includes(key))) throw new Error("DATASET_READ_PARAMETERS_INVALID");
  const requestedLimitValue = Number(params.limit ?? 250), offsetValue = Number(params.offset ?? 0);
  const requestedLimit = Number.isInteger(requestedLimitValue) && requestedLimitValue > 0 ? requestedLimitValue : 250;
  const offset = Number.isInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 2_000_000 ? offsetValue : 0;
  const limit = Math.min(DATASET_READ_PAGE_MAX, requestedLimit);
  // A legacy select may narrow the fixed projection, never inject SQL fields.
  const requestedSelection = params.select == null ? "*" : String(params.select).trim() || "*";
  const selection = ["*", "unique_id"].includes(requestedSelection) ? requestedSelection : "*";
  const projection = String(params.projection || (selection === "unique_id" ? "ids" : "default"));
  if (!["default", "signature", "ids"].includes(projection)) throw new Error("DATASET_READ_PROJECTION_INVALID");
  const rawFilters = params.filters ?? [];
  const rawAnyOf = params.anyOf ?? [];
  const rawOrder = params.order ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > 30 || !Array.isArray(rawAnyOf) || rawAnyOf.length > 30 || !Array.isArray(rawOrder) || rawOrder.length > 4) throw new Error("DATASET_READ_FILTER_INVALID");
  const ifRevision = params.ifRevision === undefined ? '' : String(params.ifRevision);
  if (ifRevision && !/^\d+$/.test(ifRevision)) throw new Error("DATASET_READ_REVISION_INVALID");
  return { limit, offset, projection, ifRevision, filters: rawFilters as unknown[], anyOf: rawAnyOf as unknown[], order: rawOrder as unknown[] };
}

function datasetReadScalar(value: unknown) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 500 && ![...value].some((character) => character.charCodeAt(0) < 32)) return value;
  throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
}

function datasetReadFilterParts(source: typeof DATASET_READ_SOURCES[string], filters: unknown[]) {
  return filters.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("DATASET_READ_FILTER_INVALID");
    const filter = raw as Record<string, unknown>;
    if (Object.keys(filter).some((key) => !["field", "op", "value"].includes(key))) throw new Error("DATASET_READ_FILTER_INVALID");
    const field = String(filter.field || ""), op = String(filter.op || "");
    if (!source.filterFields.has(field) || !DATASET_READ_FILTER_OPERATORS.has(op) || !Object.prototype.hasOwnProperty.call(filter, "value")) throw new Error("DATASET_READ_FILTER_INVALID");
    let value: unknown = filter.value;
    if (op === "in") {
      if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
      value = value.map(datasetReadScalar);
    } else {
      value = datasetReadScalar(value);
      if ((op === "ilike" || op === "not.ilike") && typeof value !== "string") throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
      if ((op === "is" || op === "not.is") && value !== null && typeof value !== "boolean") throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
    }
    if (ESCAPED_DISPLAY_TEXT_FIELDS.has(escapedDisplayTextFieldKey(field))) {
      value = Array.isArray(value) ? value.map(normalizeEscapedDisplayText) : normalizeEscapedDisplayText(value);
    }
    return { field, op, value };
  });
}

function datasetReadOrLiteral(value: unknown) {
  if (value === null) return "null";
  const text = String(value);
  return /[,()."\\]/.test(text) ? `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"` : text;
}

function datasetReadOrCondition(filter: { field: string; op: string; value: unknown }) {
  const op = filter.op === "not.is" || filter.op === "not.ilike" ? filter.op : filter.op;
  const value = Array.isArray(filter.value)
    ? `(${filter.value.map(datasetReadOrLiteral).join(",")})`
    : datasetReadOrLiteral(filter.value);
  return `${filter.field}.${op}.${value}`;
}

function restrictedRequestIdentityOrCondition(identity: string) {
  // Keep the service-role dataset_read path aligned with the restrictive RLS
  // predicate on ph_active_request: split email suffix, lowercase, then strip
  // every non-alphanumeric character before comparing the actor identity.
  const canonical = identity.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!canonical) return "";
  const pattern = `^[^a-z0-9]*${[...canonical].map((character) => `${character}[^a-z0-9]*`).join("")}(@.*)?$`;
  return ["request_created_by_username", "request_selected_rep_username", "requested_by"]
    .map((field) => `${field}.imatch.${datasetReadOrLiteral(pattern)}`).join(",");
}

const SUSPEND_TAG_METRIC_MASTER_FIELDS = "unique_id,itemcode,locationcode,lotcode,season,ptronhand,ptrreviewed,ptravailable,s_lts,holdstopcode,holdstopreason,av_note,sales_note,spec,itemspec,caliper,pic_note,photo_link,photo_url,photos,photo_name,photo_date,loc_photo_match,loc_match_qty,loc_match_pct,match";
const SUSPEND_TAG_METRIC_CAV_FIELDS = "unique_id,itemcode,season,ptravailable,available,reserved_qty,order_qty,holdstopreason,hold_reason,spec,brand,product_description";

function normalizeSuspendTagMetricKey(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function sumSuspendTagMetric(rows: Array<Record<string, unknown>>, keys: string[]) {
  let total = 0;
  let found = false;
  for (const row of rows) {
    const raw = keys.map((key) => row[key] ?? row[key.toUpperCase()]).find((value) => value !== null && value !== undefined && String(value).trim() !== "");
    if (raw === undefined) continue;
    const parsed = Number(String(raw).replace(/,/g, "").trim());
    if (!Number.isFinite(parsed)) continue;
    total += parsed;
    found = true;
  }
  return found ? total : null;
}

function sumSuspendTagOpenStock(rows: Array<Record<string, unknown>>) {
  const bySeason = new Map<string, number>();
  for (const row of rows) {
    const raw = row.s_lts ?? row.S_LTS;
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const season = normalizeSuspendTagMetricKey(row.season ?? row.SEASON);
    const key = season || `${normalizeSuspendTagMetricKey(row.lotcode ?? row.LOTCODE)}|${String(raw).trim()}`;
    if (bySeason.has(key)) continue;
    const value = Number(String(raw).replace(/,/g, "").trim());
    if (Number.isFinite(value)) bySeason.set(key, value);
  }
  return bySeason.size ? [...bySeason.values()].reduce((total, value) => total + value, 0) : null;
}

function sumSuspendTagAvailable(rows: Array<Record<string, unknown>>) {
  let total = 0;
  let found = false;
  for (const row of rows) {
    const availableRaw = row.ptravailable ?? row.PTRAVAILABLE ?? row.available ?? row.AVAILABLE;
    const available = availableRaw === null || availableRaw === undefined || String(availableRaw).trim() === ""
      ? NaN : Number(String(availableRaw).replace(/,/g, "").trim());
    if (Number.isFinite(available)) {
      total += available;
      found = true;
      continue;
    }
    const onHandRaw = row.ptronhand ?? row.PTRONHAND;
    const reviewedRaw = row.ptrreviewed ?? row.PTRREVIEWED;
    if (onHandRaw === null || onHandRaw === undefined || String(onHandRaw).trim() === ""
      || reviewedRaw === null || reviewedRaw === undefined || String(reviewedRaw).trim() === "") continue;
    const onHand = Number(String(onHandRaw).replace(/,/g, "").trim());
    const reviewed = Number(String(reviewedRaw).replace(/,/g, "").trim());
    if (!Number.isFinite(onHand) || !Number.isFinite(reviewed)) continue;
    total += onHand - reviewed;
    found = true;
  }
  return found ? total : null;
}

function firstSuspendTagMetricValue(rows: Array<Record<string, unknown>>, keys: string[]) {
  for (const row of rows) {
    const value = keys.map((key) => row[key] ?? row[key.toUpperCase()]).find((candidate) => candidate !== null && candidate !== undefined && String(candidate).trim() !== "");
    if (value !== undefined) return value;
  }
  return null;
}

async function readSuspendTagMetricRows(table: "ph_master_inventory" | "ph_cav_import", fields: string, itemCodes: string[]) {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let start = 0; start < itemCodes.length; start += 100) {
    const batch = itemCodes.slice(start, start + 100);
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from(table).select(fields).in("itemcode", batch)
        .order("unique_id", { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows.push(...page.map((row) => jsonObject(row)));
      if (page.length < pageSize) break;
      if (offset >= 20_000) throw new Error("SUSPEND_TAG_METRIC_SOURCE_LIMIT");
    }
  }
  return rows;
}

function buildSuspendTagMetricFallback(row: Record<string, unknown>, masterRows: Array<Record<string, unknown>>, cavRows: Array<Record<string, unknown>>, masterSourceAuthoritative = false, preferLocation = false) {
  const itemCode = normalizeSuspendTagMetricKey(row.itemcode ?? row.ITEMCODE);
  const locationCode = normalizeSuspendTagMetricKey(row.locationcode ?? row.LOCATIONCODE);
  const lotCode = normalizeSuspendTagMetricKey(row.lotcode ?? row.LOTCODE);
  const isFalseBlock = /^0+\.0+\.111$/.test(locationCode);
  const itemMaster = masterRows.filter((candidate) => normalizeSuspendTagMetricKey(candidate.itemcode) === itemCode);
  const locationRows = isFalseBlock ? [] : itemMaster.filter((candidate) => normalizeSuspendTagMetricKey(candidate.locationcode) === locationCode);
  const exactRows = lotCode ? locationRows.filter((candidate) => normalizeSuspendTagMetricKey(candidate.lotcode) === lotCode) : [];
  const selectedRows = isFalseBlock ? [] : exactRows.length ? exactRows : !lotCode ? locationRows : [];
  const matchLevel = isFalseBlock ? "false-block" : exactRows.length ? "item-location-lot"
    : selectedRows.length ? "item-location" : "unmatched";
  const absentSourceValue = !isFalseBlock && masterSourceAuthoritative && !locationRows.length ? 0 : null;
  const metric = (keys: string[]) => sumSuspendTagMetric(selectedRows, keys) ?? absentSourceValue;
  const locOnHand = locationRows.length ? sumSuspendTagMetric(locationRows, ["ptronhand"]) : absentSourceValue;
  const locPhotoMatch = selectedRows.length ? firstSuspendTagMetricValue(selectedRows, ["loc_photo_match"])
    : null;
  const openStockRow = selectedRows.find((candidate) => firstSuspendTagMetricValue([candidate], ["s_lts"]) !== null);
  const openStock = openStockRow ? sumSuspendTagMetric([openStockRow], ["s_lts"]) : absentSourceValue;
  return {
    PTRONHAND: metric(["ptronhand"]),
    PTRREVIEWED: metric(["ptrreviewed"]) ?? (sumSuspendTagMetric(selectedRows, ["ptronhand"]) !== null ? 0 : absentSourceValue),
    PTRAVAILABLE: sumSuspendTagAvailable(selectedRows) ?? absentSourceValue,
    S_LTS: openStock,
    LOC_ON_HAND: locOnHand,
    LOC_MATCH_QTY: locPhotoMatch,
    LOC_PHOTO_MATCH: locPhotoMatch,
    HOLDSTOPCODE: firstSuspendTagMetricValue(selectedRows, ["holdstopcode"]) ?? row.holdstopcode ?? null,
    HOLDSTOPREASON: firstSuspendTagMetricValue(selectedRows, ["holdstopreason", "hold_reason"]) ?? row.holdstopreason ?? null,
    AV_NOTE: firstSuspendTagMetricValue(selectedRows, ["av_note"]) ?? row.av_note ?? null,
    SALES_NOTE: firstSuspendTagMetricValue(selectedRows, ["sales_note"]) ?? row.sales_note ?? row.salesnote ?? null,
    SPEC: firstSuspendTagMetricValue(selectedRows, ["spec", "itemspec"]) ?? row.spec ?? row.itemspec ?? null,
    ITEMSPEC: firstSuspendTagMetricValue(selectedRows, ["itemspec", "spec"]) ?? row.itemspec ?? row.spec ?? null,
    CALIPER: firstSuspendTagMetricValue(selectedRows, ["caliper"]) ?? row.caliper ?? null,
    PIC_NOTE: firstSuspendTagMetricValue(selectedRows, ["pic_note"]) ?? row.pic_note ?? null,
    PHOTO_LINK: firstSuspendTagMetricValue(selectedRows, ["photo_link", "photo_url"]) ?? row.photo_link ?? row.photo_url ?? null,
    PHOTO_URL: firstSuspendTagMetricValue(selectedRows, ["photo_url", "photo_link"]) ?? row.photo_url ?? row.photo_link ?? null,
    PHOTOS: firstSuspendTagMetricValue(selectedRows, ["photos"]) ?? row.photos ?? null,
    PHOTO_NAME: firstSuspendTagMetricValue(selectedRows, ["photo_name"]) ?? row.photo_name ?? null,
    PHOTO_DATE: firstSuspendTagMetricValue(selectedRows, ["photo_date"]) ?? row.photo_date ?? null,
    LOC_MATCH_PCT: firstSuspendTagMetricValue(selectedRows, ["loc_match_pct", "match"]) ?? row.loc_match_pct ?? row.match ?? null,
    MATCH: firstSuspendTagMetricValue(selectedRows, ["loc_match_pct", "match"]) ?? locPhotoMatch,
    MATCH_LEVEL: matchLevel,
    SOURCE: selectedRows.length ? "ph_master_inventory" : "unmatched",
  };
}

async function enrichSuspendTagMetricRows(rows: Array<Record<string, Json | undefined>>, actorId: string, metricKey = "suspend_tag_metrics") {
  const itemCodes = [...new Set(rows.map((row) => String(row.itemcode ?? row.ITEMCODE ?? "").trim()).filter(Boolean))];
  if (!itemCodes.length) return rows;
  const inventoryRevision = await captureReadyInventoryLocationRevision(actorId);
  const [masterRows, cavRows] = await Promise.all([
    readSuspendTagMetricRows("ph_master_inventory", SUSPEND_TAG_METRIC_MASTER_FIELDS, itemCodes),
    readSuspendTagMetricRows("ph_cav_import", SUSPEND_TAG_METRIC_CAV_FIELDS, itemCodes),
  ]);
  if (await captureReadyInventoryLocationRevision(actorId) !== inventoryRevision) throw new Error("LOC_ON_HAND_REVISION_CHANGED");
  const groupByItem = (values: Array<Record<string, unknown>>) => {
    const index = new Map<string, Array<Record<string, unknown>>>();
    for (const row of values) {
      const key = normalizeSuspendTagMetricKey(row.itemcode ?? row.ITEMCODE);
      const bucket = index.get(key) || []; bucket.push(row); index.set(key, bucket);
    }
    return index;
  };
  const masterByItem = groupByItem(masterRows), cavByItem = groupByItem(cavRows);
  return rows.map((row) => {
    const key = normalizeSuspendTagMetricKey(row.itemcode ?? row.ITEMCODE);
    return { ...row, [metricKey]: buildSuspendTagMetricFallback(row, masterByItem.get(key) || [], cavByItem.get(key) || [], true, true) as unknown as Json };
  });
}

async function handleDatasetRead(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  request?: Request,
  canonicalAccess: CanonicalUserAccess | null = null,
  verifiedActor: Record<string, unknown> | null = null,
  revisionRetry = false,
) {
  if (!session) return errorResponse("Unauthorized", 401, { code: "DATASET_READ_UNAUTHORIZED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try { actor = verifiedActor || await resolveActiveSessionProfile(session); }
  catch { return retainedReadResponse("DATASET_READ_PROFILE_PENDING", { dataset: normalizeDatasetReadAlias(payload.dataset) }); }
  const username = normalizeUsername(String(actor.username || ""));
  const role = String(session.role || "");
  const dataset = normalizeDatasetReadAlias(payload.dataset);
  if (["location_moves", "eval_work", "bunch_notes", "count_review", "request_history"].includes(dataset)) {
    let params: ReturnType<typeof validateDatasetReadParams>;
    try { params = validateDatasetReadParams(payload); }
    catch { return retainedReadResponse("DATASET_READ_PARAMETERS_INVALID", { dataset }); }
    // Delegate to the existing actor-scoped read. No service-role table alias is introduced.
    let response: Response;
    if (dataset === "location_moves") response = await handleLocationWorkAction(session, { operation:"list", status:"active" });
    else if (dataset === "eval_work") response = await handleEvalWorkAction(session, { operation:"list" }, canonicalAccess);
    else if (dataset === "request_history") response = await handleSalesWorkflow({ session, payload:{ action:"request_history", operation:"search", payload:{ offset:params.offset, limit:params.limit } }, supabase, resolveActiveSessionProfile, headers:corsHeaders });
    else {
      const rpc = supabase.rpc.bind(supabase) as unknown as BunchNoteRpc;
      const result = await rpc("bunch_note_workflow_command_v1", { p_actor_id:actor.id, p_operation:dataset === "count_review" ? "list_discrepancies" : "queue", p_payload:{ filter:"mine", offset:params.offset, limit:Math.min(params.limit, 100) } });
      if (result.error) return retainedReadResponse("DATASET_READ_UNAVAILABLE", { dataset });
      response = jsonResponse({ ok:true, data:result.data });
    }
    if (!response.ok) return response;
    const body = jsonObject(await response.json()), data = body.data;
    const object = data && !Array.isArray(data) && typeof data === "object" ? data : {};
    const rows = Array.isArray(data) ? data : Array.isArray(object.rows) ? object.rows : Array.isArray(object.jobs) ? object.jobs : Array.isArray(object.cards) ? object.cards : Array.isArray(object.reviews) ? object.reviews : [];
    const total = Number(object.total ?? rows.length);
    const page = ["request_history", "bunch_notes", "count_review"].includes(dataset) ? rows : rows.slice(params.offset, params.offset + params.limit);
    return jsonResponse({ ok:true, data:{ rows:page, total, offset:params.offset, limit:params.limit, hasMore:params.offset + page.length < total } });
  }
  const source = DATASET_READ_SOURCES[dataset];
  if (!source && DATASET_READ_RETAIN_ONLY_ALIASES.has(dataset)) {
    const params = validateDatasetReadParams(payload);
    return jsonResponse({ ok: true, data: { dataset, rows: [], total: null, offset: params.offset, limit: params.limit, hasMore: false, up_to_date: true, retained: true } });
  }
  if (!source) return errorResponse("Unsupported dataset.", 400, { code: "DATASET_READ_INVALID" });
  const canonicalDatasetAccess = dataset !== "suspend_tag" && canonicalDatasetReadAllowed(canonicalAccess, dataset);
  if (dataset === "suspend_tag"
    ? !SUSPEND_TAG_EDITORS.has(username)
    : dataset !== "app_user_directory" && !hasTableReadAccess(role, source.permission, username) && !canonicalDatasetAccess) {
    return errorResponse("You do not have access to this dataset.", 403, { code: "DATASET_READ_FORBIDDEN" });
  }
  let parsed: ReturnType<typeof validateDatasetReadParams>;
  try { parsed = validateDatasetReadParams(payload); }
  catch (error) { return errorResponse(String(error instanceof Error ? error.message : error), 400, { code: String(error instanceof Error ? error.message : error) }); }

  if (["request_queue", "active_request"].includes(dataset) && parsed.offset === 0) {
    try {
      const reconciliationTask = Promise.resolve(supabase.rpc("reconcile_active_requests_from_outbox_v1"))
        .then((reconciliation) => {
          if (reconciliation.error) console.warn("REQUEST_OUTBOX_RECONCILIATION_DEFERRED", reconciliation.error.code || reconciliation.error.message);
        })
        .catch((error) => console.warn("REQUEST_OUTBOX_RECONCILIATION_DEFERRED", error instanceof Error ? error.message : String(error)));
      const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime;
      if (runtime) runtime.waitUntil(reconciliationTask);
    } catch (error) {
      console.warn("REQUEST_OUTBOX_RECONCILIATION_DEFERRED", error instanceof Error ? error.message : String(error));
    }
  }

  if (parsed.projection === "signature" && !source.signatures) return errorResponse("This dataset has no signature projection.", 400, { code: "DATASET_READ_PROJECTION_INVALID" });
  const fields = parsed.projection === "ids" ? source.key : parsed.projection === "signature" ? source.signatures! : source.fields;
  try {
    const query = new URLSearchParams();
    query.set("select", fields);
    if (dataset === "app_user_directory") query.set("disabled_at", "is.null");
    if (["request_queue", "active_request"].includes(dataset)) query.set("date_completed", "is.null");
    const filters = datasetReadFilterParts(source, parsed.filters);
    for (const filter of filters) {
      const value = Array.isArray(filter.value) ? `(${filter.value.map(datasetReadOrLiteral).join(",")})` : datasetReadOrLiteral(filter.value);
      query.append(filter.field, `${filter.op}.${value}`);
    }
    if (dataset === "suspend_tag") {
      // Mirror the Suspend Tag eligibility normalization in index.html, but
      // enforce it in PostgREST before exact count/paging so callers cannot
      // widen the result or receive inconsistent page totals.
      query.append("suspend", "eq.SUSPEND");
      query.append("suspend_to", "eq.dc");
    }
    const anyOf = datasetReadFilterParts(source, parsed.anyOf);
    if (parsed.anyOf.length && !anyOf.length) throw new Error("DATASET_READ_FILTER_INVALID");
    const policyUsername = String(actor.username || "").trim().toLowerCase();
    const restrictedRequestIdentity = ["request_queue", "active_request"].includes(dataset)
      && ["ben_brown", "chance_alldredge"].includes(policyUsername) ? policyUsername : "";
    const requestScopeOr = restrictedRequestIdentity ? restrictedRequestIdentityOrCondition(restrictedRequestIdentity) : "";

    // Rep access to reserve rows is always scoped to the active profile; a
    // client filter can narrow this set but cannot remove the server scope.
    const access = getRoleAccessState(role);
    if (dataset === "reserves" && access.isRep && !access.isAdmin && !FULL_ACCESS_USER_KEYS.has(username)) {
      const patterns = new Set<string>();
      for (const value of [actor.username, actor.display_name]) {
        const parts = String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        if (parts.length < 2) continue;
        patterns.add(`${parts[0]}*${parts.at(-1)}`);
        patterns.add(`${parts.at(-1)}*${parts[0]}`);
      }
      if (!patterns.size) return errorResponse("Your sales representative profile is incomplete.", 403, { code: "DATASET_READ_REP_IDENTITY_REQUIRED" });
      const repScope = [...patterns].map((pattern) => `salesrepname.ilike.${datasetReadOrLiteral(pattern)}`).join(",");
      const anyOfScope = anyOf.length ? `or(${anyOf.map(datasetReadOrCondition).join(",")})` : "";
      query.set("or", anyOfScope ? `(and(or(${repScope}),${anyOfScope}))` : `(${repScope})`);
    } else if (requestScopeOr && anyOf.length) {
      query.set("or", `(and(or(${requestScopeOr}),or(${anyOf.map(datasetReadOrCondition).join(",")})))`);
    } else if (requestScopeOr) {
      query.set("or", `(${requestScopeOr})`);
    } else if (anyOf.length) {
      query.set("or", `(${anyOf.map(datasetReadOrCondition).join(",")})`);
    }

    for (const raw of parsed.order) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("DATASET_READ_ORDER_INVALID");
      const order = raw as Record<string, unknown>;
      if (Object.keys(order).some((key) => !["field", "ascending"].includes(key)) || typeof order.ascending !== "boolean") throw new Error("DATASET_READ_ORDER_INVALID");
      const field = String(order.field || "");
      if (!source.orderFields.has(field)) throw new Error("DATASET_READ_ORDER_INVALID");
      query.append("order", `${field}.${order.ascending ? "asc" : "desc"}`);
    }
    if (!parsed.order.some((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).field === source.key)) {
      query.append("order", `${source.key}.asc`);
    }
    query.set("offset", String(parsed.offset));
    query.set("limit", String(parsed.limit));
    // Only physical, non-enriched snapshots use a single revision. Queue joins
    // continue to use the coordinator's complete dependency vector.
    let revision: string | null = null;
    if (["soc", "cav", "reserves"].includes(dataset)) {
      const metadata = await supabase.from("app_dataset_revisions").select("revision,state").eq("key", source.table).maybeSingle();
      if (!metadata.error && metadata.data?.state === "ready") revision = String(metadata.data.revision);
      if (revision && parsed.ifRevision === revision) return jsonResponse({ ok: true, data: { up_to_date: true, revision } });
    }
    const includeLocationTotals = parsed.projection === "default" && ["request_queue", "active_request"].includes(dataset)
      && hasTableReadAccess(role, "ph_master_inventory", username);
    let inventoryRevision: string | null = null;
    if (includeLocationTotals) {
      try { inventoryRevision = await captureReadyInventoryLocationRevision(String(actor.id || "")); }
      catch (error) {
        console.warn("REQUEST_INVENTORY_REVISION_RETAINED", error instanceof Error ? error.message : String(error));
      }
    }
    const sourceFreshnessPromise = dataset === "suspend_tag" && parsed.offset === 0
      ? databaseBridge.fetchTable(SUPABASE_URL, source.table, suspendSourceFreshnessQuery(), {
        method: "GET", headers: buildRestHeaders("GET", source.table),
      }, 30_000, "app-api.suspend-tag-source-freshness")
      : Promise.resolve(null);
    const [response, sourceFreshnessResponse] = await Promise.all([
      databaseBridge.fetchTable(SUPABASE_URL, source.table, query.toString(), {
        method: "GET", headers: { ...buildRestHeaders("GET", source.table), Prefer: "count=exact" },
      }, 30_000, "app-api.dataset-read"),
      sourceFreshnessPromise,
    ]);
    const responseData = await readResponsePayload(response);
    if (!response.ok) {
      return retainedReadResponse("DATASET_READ_UNAVAILABLE", { dataset, offset: parsed.offset, limit: parsed.limit });
    }
    let sourceFreshness: ReturnType<typeof suspendSourceFreshnessFromRows> | undefined;
    if (sourceFreshnessResponse) {
      const freshnessData = await readResponsePayload(sourceFreshnessResponse);
      if (sourceFreshnessResponse.ok) {
        try { sourceFreshness = suspendSourceFreshnessFromRows(freshnessData); }
        catch { sourceFreshness = undefined; }
      }
    }
    const checkedData = jsonValue(responseData);
    if (!Array.isArray(checkedData) || checkedData.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return retainedReadResponse("DATASET_READ_INVALID_PAGE", { dataset, offset: parsed.offset, limit: parsed.limit });
    const data: Array<Record<string, Json | undefined>> = checkedData.map((row) => jsonObject(row));
    const range = response.headers.get("content-range") || "";
    const total = Number(range.match(/\/(\d+)$/)?.[1]);
    if (!Number.isInteger(total) || total < 0) return retainedReadResponse("DATASET_READ_INVALID_PAGE", { dataset, offset: parsed.offset, limit: parsed.limit });
    if (dataset === "suspend_tag") {
      const ids = data.map((row) => row.unique_id).filter((value): value is string => typeof value === "string");
      try {
        const state = await handleSuspendTag(supabase, actor, { operation: "rows", payload: { ids } });
        const stateRows = suspendTagRowsFromResult(state);
        const byId = new Map(stateRows.map((item) => { const row = jsonObject(item); return [String(row.unique_id || ""), row] as const; }));
        for (const row of data) {
          const current = typeof row.unique_id === "string" ? byId.get(row.unique_id) : undefined;
          if (current) for (const [key, value] of Object.entries(current)) if (key.startsWith("suspend_tag_") || key in row) row[key] = value;
        }
      } catch { /* Direct ph_soc_master rows remain the fail-open read. */ }
    }
    let metricRows = data;
    if (["suspend_tag", "request_queue", "active_request"].includes(dataset)) {
      try { metricRows = await enrichSuspendTagMetricRows(data, String(actor.id || ""),dataset === "suspend_tag" ? "suspend_tag_metrics" : "request_inventory_metrics"); }
      catch { metricRows = data; }
    }
    let deliveredInventoryRevision = inventoryRevision;
    let enrichedRows: Json[] = metricRows;
    if (inventoryRevision !== null) {
      try {
        enrichedRows = await enrichInventoryLocationRows(supabase, String(actor.id || ""), metricRows, inventoryRevision);
      } catch (error) {
        if (!["request_queue", "active_request"].includes(dataset)) throw error;
        deliveredInventoryRevision = null;
        console.warn("REQUEST_INVENTORY_ENRICHMENT_RETAINED", error instanceof Error ? error.message : String(error));
      }
    }
    const rows = ["request_queue", "active_request"].includes(dataset)
      ? enrichedRows.map((row) => normalizeRequestBrowserCompatibilityRow(jsonObject(row)))
      : enrichedRows;
    return jsonResponse({ ok: true, data: { rows, total, revision, up_to_date: false, offset: parsed.offset, limit: parsed.limit, hasMore: parsed.offset + data.length < total,
      ...(sourceFreshnessResponse ? { sourceFreshness } : {}),
      ...(deliveredInventoryRevision === null ? {} : { inventoryRevision: deliveredInventoryRevision }) } });
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error || "DATASET_READ_FILTER_INVALID");
    if (code.includes("LOC_ON_HAND_REVISION_CHANGED")) {
      if (!revisionRetry) return await handleDatasetRead(session, payload, request, canonicalAccess, actor, true);
      return jsonResponse({ ok: true, data: { rows: [], total: 0, offset: parsed.offset, limit: parsed.limit, hasMore: false, retained: true, retryable: true, revisionChanged: true } });
    }
    const locationFailure = inventoryLocationReadFailureResponse(error);
    if (locationFailure) return locationFailure;
    if (dataset === "suspend_tag") {
      return jsonResponse({ ok: true, data: { rows: [], total: 0, offset: parsed.offset, limit: parsed.limit, hasMore: false, retained: true, retryable: true } });
    }
    if (/^DATASET_READ_(?:FILTER|ORDER|PAGE|PROJECTION)(?:_[A-Z]+)*_INVALID$/.test(code)) {
      return errorResponse("Unsupported dataset filter or ordering.", 400, { code });
    }
    console.warn("DATASET_READ_UNAVAILABLE", dataset, code);
    return retainedReadResponse("DATASET_READ_UNAVAILABLE", { dataset, offset: parsed.offset, limit: parsed.limit });
  }
}

function isRequestRemovalTimestamp(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= days
    && Number(parts[4]) < 24 && Number(parts[5]) < 60 && Number(parts[6]) < 60
    && (!parts[7] || (Number(parts[8]) < 16 && Number(parts[9]) < 60));
}

async function handleRequestQueueRemove(session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>, payload: Record<string, unknown>) {
  if (!session) return errorResponse("Sign in before removing requests.", 401);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("An active account is required.", 403, { code: "ACCOUNT_INACTIVE" }); }
  const actorId = typeof actor.id === "string" ? actor.id : "";
  if (!actorId) return errorResponse("An active account is required.", 403, { code: "ACCOUNT_INACTIVE" });
  const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";
  const key = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.toLowerCase() : "";
  const version = payload.expectedRowVersion;
  const updatedAt = typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : "";
  if (Object.keys(payload).some(key => !["action", "uid", "idempotencyKey", "expectedRowVersion", "expectedUpdatedAt"].includes(key))
    || !uid || uid.length > 240 || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1
    || !isRequestRemovalTimestamp(updatedAt)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return errorResponse("Refresh the request before removing it.", 400, { code: "REQUEST_REMOVE_COMMAND_INVALID" });
  }
  const { data, error } = await supabase.rpc("request_queue_remove_v1", {
    p_actor_id: actorId, p_uid: uid, p_expected_row_version: version,
    p_expected_updated_at: updatedAt, p_idempotency_key: key,
  });
  if (error) return databaseFailureResponse("The request was not removed. Refresh Que and retry.", error, "REQUEST_REMOVE_FAILED");
  const result = data && typeof data === "object" && !Array.isArray(data) ? jsonObject(data) : {};
  if (result.uid !== uid || result.state !== "removed" || result.idempotencyKey !== key || typeof result.replayed !== "boolean") {
    return errorResponse("The removal response could not be verified. Refresh Que.", 503, { code: "REQUEST_REMOVE_RESPONSE_INVALID" });
  }
  return jsonResponse({ ok: true, data: {
    uid: result.uid, state: result.state, idempotencyKey: result.idempotencyKey, replayed: result.replayed,
  } });
}

async function handleRequestArchive(session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>, payload: Record<string, unknown>) {
    if (!session) return errorResponse("Sign in before archiving requests.", 401);
    let actor: Record<string, unknown>;
    try { actor = await resolveActiveSessionProfile(session); }
    catch { return errorResponse("An active account is required.", 403, { code: "ACCOUNT_INACTIVE" }); }
    const actorId = typeof actor.id === "string" ? actor.id : "";
    if (!actorId) return errorResponse("An active account is required.", 403, { code: "ACCOUNT_INACTIVE" });
    const operation = String(payload.operation || "");
    if (operation === "list") {
      const offset = Number(payload.offset ?? 0), limit = Number(payload.limit ?? 100);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return errorResponse("Invalid archive page.", 400);
      const { data, error } = await supabase.rpc("request_archive_list_v1", { p_actor_id: actorId, p_offset: offset, p_limit: Math.min(limit, 500) });
      if (error) return databaseFailureResponse("Archived requests could not be loaded.", error, "REQUEST_ARCHIVE_READ_FAILED");
      return jsonResponse({ ok: true, data });
    }
    const uid = String(payload.uid || "").trim(), key = String(payload.idempotencyKey || "").trim();
    if (!["archive", "restore"].includes(operation) || !uid || uid.length > 240 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      return errorResponse("Invalid archive command.", 400, { code: "REQUEST_ARCHIVE_COMMAND_INVALID" });
    }
    const { data, error } = await supabase.rpc("request_archive_command_v1", {
      p_actor_id: actorId, p_uid: uid, p_operation: operation, p_idempotency_key: key,
    });
    if (error) return databaseFailureResponse("The archive change was not accepted. Refresh the request and retry.", error, "REQUEST_ARCHIVE_FAILED");
    return jsonResponse({ ok: true, data });
}

function productionScheduleBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parseProductionScheduleRequest(payload: Record<string, unknown>) {
  const operation = String(payload.operation || "").trim().toLowerCase();
  if (!["metadata", "rows", "row_detail", "status", "refresh"].includes(operation)) throw new Error("PRODUCTION_SCHEDULE_OPERATION_INVALID");
  const allowed = new Set(["action", "operation", "sheetId", "q", "filters", "cursor", "limit", "snapshotId", "runId", "projection", "columnIndexes", "sourceRow"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("PRODUCTION_SCHEDULE_PAYLOAD_INVALID");
  if (operation !== "rows" && operation !== "row_detail") return { operation } as const;
  if (payload.sheetId === null || payload.sheetId === undefined || !(typeof payload.sheetId === "number" || typeof payload.sheetId === "string")) {
    throw new Error("PRODUCTION_SCHEDULE_SHEET_INVALID");
  }
  const sheetId = Number(payload.sheetId);
  if (!Number.isInteger(sheetId) || sheetId < 0 || sheetId > 6) throw new Error("PRODUCTION_SCHEDULE_SHEET_INVALID");
  const snapshotId = String(payload.snapshotId || "").trim();
  if (snapshotId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshotId)) {
    throw new Error("PRODUCTION_SCHEDULE_SNAPSHOT_INVALID");
  }
  if (operation === "row_detail") {
    const sourceRow = Number(payload.sourceRow);
    if (!snapshotId || !Number.isSafeInteger(sourceRow) || sourceRow < 1 || sourceRow > 999999999) {
      throw new Error("PRODUCTION_SCHEDULE_ROW_INVALID");
    }
    return { operation, sheetId, snapshotId, sourceRow } as const;
  }
  const projection = payload.projection === undefined ? "full" : String(payload.projection);
  if (!["full", "cards"].includes(projection)) throw new Error("PRODUCTION_SCHEDULE_PROJECTION_INVALID");
  const columnIndexes = payload.columnIndexes === undefined ? [] : payload.columnIndexes;
  if (!Array.isArray(columnIndexes) || columnIndexes.length > 32
    || columnIndexes.some((column) => !Number.isInteger(column) || column < 1 || column > 10000)) {
    throw new Error("PRODUCTION_SCHEDULE_COLUMNS_INVALID");
  }
  const rawLimit = payload.limit === undefined ? 100 : Number(payload.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw new Error("PRODUCTION_SCHEDULE_LIMIT_INVALID");
  const limit = Math.min(500, rawLimit);
  const rawCursor = String(payload.cursor || "").trim();
  if (rawCursor && !/^[1-9][0-9]{0,8}$/.test(rawCursor)) throw new Error("PRODUCTION_SCHEDULE_CURSOR_INVALID");
  if (payload.filters !== undefined && (!payload.filters || typeof payload.filters !== "object" || Array.isArray(payload.filters))) {
    throw new Error("PRODUCTION_SCHEDULE_FILTERS_INVALID");
  }
  const rawFilters = payload.filters && typeof payload.filters === "object" && !Array.isArray(payload.filters)
    ? payload.filters as Record<string, unknown>
    : {};
  if (Object.keys(rawFilters).length > 12) throw new Error("PRODUCTION_SCHEDULE_FILTERS_INVALID");
  const filters: Record<string, string> = {};
  for (const [rawIndex, rawValue] of Object.entries(rawFilters)) {
    if (!/^[1-9][0-9]{0,3}$/.test(rawIndex) || typeof rawValue !== "string" || rawValue.length > 200) {
      throw new Error("PRODUCTION_SCHEDULE_FILTER_INVALID");
    }
    const value = rawValue.trim();
    if (value) filters[rawIndex] = value;
  }
  if (payload.q !== undefined && typeof payload.q !== "string") throw new Error("PRODUCTION_SCHEDULE_SEARCH_INVALID");
  const query = String(payload.q || "").trim();
  if (query.length > 200) throw new Error("PRODUCTION_SCHEDULE_SEARCH_INVALID");
  return { operation, sheetId, limit, cursor: rawCursor ? Number(rawCursor) : 0, q: query, filters, snapshotId: snapshotId || null, projection, columnIndexes: [...new Set(columnIndexes)] } as const;
}

export function isProductionScheduleUser(value: unknown) {
  return PRODUCTION_SCHEDULE_USERS.has(String(value || "").trim().toLowerCase());
}

export async function signProductionScheduleCommand(command: Record<string, unknown>, timestamp: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const deliveryJson = JSON.stringify(command);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${deliveryJson}`));
  return { deliveryJson, signature: productionScheduleBase64Url(new Uint8Array(signature)) };
}

async function dispatchRuntimeWatchdogAlert(event: Record<string, unknown>) {
  if (!PRODUCTION_SCHEDULE_APPS_SCRIPT_URL || !PRODUCTION_SCHEDULE_SIGNING_SECRET) return;
  const timestamp = new Date().toISOString();
  const command = {
    contractVersion: "runtime-watchdog-alert-v1",
    fingerprint: String(event.fingerprint || "").slice(0, 400),
    appVersion: String(event.app_version || "").slice(0, 80),
    severity: String(event.severity || ""),
    username: String(event.username || "").slice(0, 120),
    role: String(event.normalized_role || "").slice(0, 80),
    view: String(event.view_id || "").slice(0, 100),
    owningSkill: String(event.owning_skill || "").slice(0, 100),
    message: String(event.error_message || "").slice(0, 300),
    fixBrief: buildRuntimeWatchdogFixBrief([event], String(event.app_version || APP_RUNTIME_RELEASE)),
  };
  const { deliveryJson, signature } = await signProductionScheduleCommand(command, timestamp, PRODUCTION_SCHEDULE_SIGNING_SECRET);
  await fetch(PRODUCTION_SCHEDULE_APPS_SCRIPT_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "runtime_watchdog_alert_v1", timestamp, signature, deliveryJson }),
    signal: AbortSignal.timeout(5000), redirect: "follow",
  });
}

async function handleProductionScheduleAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Sign in to open Production Schedule.", 401, { code: "PRODUCTION_SCHEDULE_UNAUTHORIZED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("An active account profile is required.", 403, { code: "ACTIVE_PROFILE_REQUIRED" }); }
  const profileUsername = String(actor.username || "").trim().toLowerCase();
  if (!isProductionScheduleUser(profileUsername)) {
    return errorResponse("Production Schedule is limited to authorized users.", 403, { code: "PRODUCTION_SCHEDULE_FORBIDDEN" });
  }
  const username = normalizeUsername(profileUsername);

  let parsed: ReturnType<typeof parseProductionScheduleRequest>;
  try { parsed = parseProductionScheduleRequest(payload); }
  catch (error) {
    const code = String(error instanceof Error ? error.message : error || "PRODUCTION_SCHEDULE_PAYLOAD_INVALID");
    return errorResponse("Production Schedule request is invalid.", 400, { code });
  }

  if (parsed.operation === "metadata") {
    const { data, error } = await supabase.rpc("production_schedule_read_metadata_v1");
    if (error) return databaseFailureResponse("Production Schedule metadata is unavailable.", error, "PRODUCTION_SCHEDULE_METADATA_UNAVAILABLE");
    const metadata = data && typeof data === "object" && !Array.isArray(data) ? jsonObject(data) : { snapshot: null, sheets: [] };
    return jsonResponse({ ok: true, ...metadata });
  }
  if (parsed.operation === "rows") {
    if (!Number.isInteger(parsed.sheetId) || typeof parsed.cursor !== "number" || typeof parsed.limit !== "number"
      || typeof parsed.q !== "string" || !parsed.filters || !parsed.snapshotId) return errorResponse("Invalid schedule request.", 400);
    const { data, error } = await supabase.rpc(parsed.projection === "cards" ? "production_schedule_read_cards_v1" : "production_schedule_read_rows_v1", {
      p_sheet_index: parsed.sheetId,
      p_snapshot_id: parsed.snapshotId,
      p_cursor: parsed.cursor,
      p_limit: parsed.limit,
      p_search: parsed.q,
      p_filters: parsed.filters,
      ...(parsed.projection === "cards" ? { p_column_indexes: parsed.columnIndexes } : {}),
    });
    if (error) return databaseFailureResponse("Production Schedule rows are unavailable.", error, "PRODUCTION_SCHEDULE_ROWS_UNAVAILABLE");
    return jsonResponse({ ok: true, ...(data && typeof data === "object" ? data as Record<string, unknown> : { rows: [], nextCursor: null, total: 0, snapshotId: null, hasMore: false }) });
  }
  if (parsed.operation === "row_detail") {
    if (!parsed.snapshotId || typeof parsed.sheetId !== "number" || typeof parsed.sourceRow !== "number") return errorResponse("Invalid schedule row.", 400);
    // Pin the detail to the same published snapshot as its card. A staged or
    // failed import must never leak into an otherwise complete page.
    const snapshot = await supabase.from("production_schedule_snapshots").select("id")
      .eq("id", parsed.snapshotId).in("status", ["ready", "superseded"]).maybeSingle();
    if (snapshot.error) return databaseFailureResponse("Production Schedule snapshot is unavailable.", snapshot.error, "PRODUCTION_SCHEDULE_SNAPSHOT_UNAVAILABLE");
    if (!snapshot.data) return errorResponse("This schedule snapshot is unavailable. Refresh the sheet.", 409, { code: "PRODUCTION_SCHEDULE_SNAPSHOT_UNAVAILABLE" });
    const { data, error } = await supabase.from("production_schedule_rows").select("source_row,cells")
      .eq("snapshot_id", parsed.snapshotId).eq("sheet_index", parsed.sheetId).eq("source_row", parsed.sourceRow).maybeSingle();
    if (error) return databaseFailureResponse("Production Schedule row is unavailable.", error, "PRODUCTION_SCHEDULE_ROW_UNAVAILABLE");
    if (!data) return errorResponse("This source row is unavailable. Refresh the sheet.", 404, { code: "PRODUCTION_SCHEDULE_ROW_UNAVAILABLE" });
    return jsonResponse({ ok: true, snapshotId: parsed.snapshotId, row: { sourceRow: data.source_row, cells: data.cells } });
  }
  if (parsed.operation === "status") {
    const runId = String(payload.runId || "").trim();
    if (runId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      return errorResponse("Production Schedule run ID is invalid.", 400, { code: "PRODUCTION_SCHEDULE_RUN_INVALID" });
    }
    const { data, error } = await supabase.rpc("production_schedule_read_status_v1", runId ? { p_snapshot_id: runId } : {});
    if (error) return databaseFailureResponse("Production Schedule status is unavailable.", error, "PRODUCTION_SCHEDULE_STATUS_UNAVAILABLE");
    return jsonResponse({ ok: true, run: data && typeof data === "object" ? jsonObject(data) : { id: null, status: "empty" } });
  }

  if (!PRODUCTION_SCHEDULE_APPS_SCRIPT_URL || !PRODUCTION_SCHEDULE_SIGNING_SECRET) {
    return errorResponse("Production Schedule refresh is not configured. Contact the application administrator.", 503, { code: "PRODUCTION_SCHEDULE_REFRESH_NOT_CONFIGURED" });
  }
  const { data: started, error: startError } = await supabase.rpc("production_schedule_start_import_v1", { p_requested_by: username });
  if (startError) return databaseFailureResponse("A Production Schedule refresh could not be started.", startError, "PRODUCTION_SCHEDULE_REFRESH_START_FAILED");
  const startData = started && typeof started === "object" ? started as Record<string, unknown> : {};
  if (startData.already_running === true) {
    return errorResponse("A Production Schedule refresh is already running.", 409, { code: "PRODUCTION_SCHEDULE_REFRESH_IN_PROGRESS", run: { id: startData.snapshot_id, status: startData.status } });
  }
  const snapshotId = String(startData.snapshot_id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshotId)) {
    return errorResponse("The Production Schedule refresh could not be initialized.", 503, { code: "PRODUCTION_SCHEDULE_REFRESH_START_INVALID" });
  }
  const timestamp = new Date().toISOString();
  const command = {
    contractVersion: "production-schedule-import-v1",
    workbookId: PRODUCTION_SCHEDULE_WORKBOOK_ID,
    runId: snapshotId,
    snapshotId,
    requestedBy: username,
  };
  const { deliveryJson, signature } = await signProductionScheduleCommand(command, timestamp, PRODUCTION_SCHEDULE_SIGNING_SECRET);
  try {
    const response = await fetch(PRODUCTION_SCHEDULE_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "production_schedule_import_v1", timestamp, signature, deliveryJson }),
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    const responseText = await response.text();
    let result: Record<string, unknown> = {};
    try { result = responseText ? JSON.parse(responseText) as Record<string, unknown> : {}; } catch { /* handled below */ }
    if (!response.ok || result.ok !== true || result.accepted !== true) {
      const failureCode = String(result.code || `APPS_SCRIPT_HTTP_${response.status}`).replace(/[^A-Za-z0-9_]/g, "_").toUpperCase().slice(0, 100);
      await supabase.rpc("production_schedule_fail_import_v1", { p_snapshot_id: snapshotId, p_error_code: failureCode });
      return errorResponse("Production Schedule refresh could not be queued.", 502, { code: "PRODUCTION_SCHEDULE_REFRESH_DISPATCH_FAILED" });
    }
    return jsonResponse({ ok: true, run: { id: snapshotId, status: "queued" } }, 202);
  } catch (_error) {
    // A network failure is ambiguous: Apps Script may have accepted the signed
    // command before the response was lost. Keep the run queued so status can
    // resolve it without risking a duplicate import.
    return jsonResponse({ ok: true, run: { id: snapshotId, status: "queued" }, dispatchPending: true }, 202);
  }
}

async function handleAppendProductivityHistory(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Unauthorized", 401, { code: "PRODUCTIVITY_HISTORY_UNAUTHORIZED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("An active account profile is required.", 403, { code: "ACTIVE_PROFILE_REQUIRED" }); }
  const username = normalizeUsername(String(actor.username || ""));
  const role = String(session.role || "");
  if (!hasTableWriteAccess(role, "ph_productivity_history", "POST", payload.entries, username)) return errorResponse("You do not have access to productivity history.", 403, { code: "PRODUCTIVITY_HISTORY_FORBIDDEN" });
  if (Object.keys(payload).some((key) => !["action", "entries"].includes(key)) || !Array.isArray(payload.entries) || payload.entries.length < 1 || payload.entries.length > 500) {
    return errorResponse("Productivity history entries are invalid.", 400, { code: "PRODUCTIVITY_HISTORY_PAYLOAD_INVALID" });
  }
  const entries: Database["public"]["Tables"]["ph_productivity_history"]["Insert"][] = [];
  const keys = new Set<string>();
  try {
    for (const raw of payload.entries) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PRODUCTIVITY_HISTORY_ENTRY_INVALID");
      const entry = jsonObject(raw);
      if (Object.keys(entry).some((key) => !PRODUCTIVITY_HISTORY_ENTRY_FIELDS.has(key))) throw new Error("PRODUCTIVITY_HISTORY_ENTRY_INVALID");
      const eventKey = String(entry.event_key || "").trim();
      const completedBy = normalizeUsername(String(entry.completed_by_username || ""));
      const completedAt = String(entry.completed_at || "").trim();
      const sourceTable = String(entry.source_table || "").trim().toLowerCase();
      const sourceKind = String(entry.source_kind || "").trim().toLowerCase();
      const sourceUid = String(entry.source_unique_id || "").trim();
      if (!eventKey || eventKey.length > 1200 || !completedBy || completedBy.length > 120 || !completedAt || !Number.isFinite(Date.parse(completedAt))
        || !sourceTable || sourceTable.length > 120 || !PRODUCTIVITY_HISTORY_SOURCE_KINDS.has(sourceKind) || !sourceUid || sourceUid.length > 240) {
        throw new Error("PRODUCTIVITY_HISTORY_ENTRY_INVALID");
      }
      const expectedEventKey = `${sourceTable}|${sourceKind}|${sourceUid}|${completedAt}|${completedBy}`;
      if (eventKey !== expectedEventKey || keys.has(eventKey)) throw new Error("PRODUCTIVITY_HISTORY_IDEMPOTENCY_KEY_INVALID");
      keys.add(eventKey);
      const snapshot = entry.snapshot && typeof entry.snapshot === "object" && !Array.isArray(entry.snapshot) ? jsonObject(entry.snapshot) : {};
      if (JSON.stringify(snapshot).length > 40000) throw new Error("PRODUCTIVITY_HISTORY_SNAPSHOT_TOO_LARGE");
      entries.push({
        event_key: eventKey,
        completed_by_username: completedBy,
        completed_by_display: String(entry.completed_by_display || completedBy).trim().slice(0, 200),
        completed_at: completedAt,
        source_table: sourceTable,
        source_kind: sourceKind,
        source_unique_id: sourceUid,
        source_assignment: String(entry.source_assignment || "").trim().slice(0, 160) || null,
        itemcode: String(entry.itemcode || "").trim().slice(0, 160) || null,
        commonname: String(entry.commonname || "").trim().slice(0, 300) || null,
        contsize: String(entry.contsize || "").trim().slice(0, 120) || null,
        locationcode: String(entry.locationcode || "").trim().slice(0, 160) || null,
        lotcode: String(entry.lotcode || "").trim().slice(0, 160) || null,
        customer_name: String(entry.customer_name || "").trim().slice(0, 300) || null,
        request_folder: String(entry.request_folder || "").trim().slice(0, 200) || null,
        snapshot: jsonValue(snapshot),
      });
    }
    const { data, error } = await supabase.from("ph_productivity_history")
      .upsert(entries, { onConflict: "event_key" })
      .select("event_key,completed_by_username,completed_by_display,completed_at,source_table,source_kind,source_unique_id,source_assignment,itemcode,commonname,contsize,locationcode,lotcode,customer_name,request_folder,snapshot");
    if (error) return databaseFailureResponse("Productivity history could not be saved.", error, "PRODUCTIVITY_HISTORY_UNAVAILABLE");
    return jsonResponse({ ok: true, data: { rows: Array.isArray(data) ? data : [] } });
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error || "PRODUCTIVITY_HISTORY_ENTRY_INVALID");
    return errorResponse("Productivity history entries are invalid.", 400, { code });
  }
}

async function handleInventoryProjects(actor: Record<string, unknown>, payload: Record<string, unknown>) {
  const action = String(payload.action || "");
  const actorUsername = normalizeUsername(String(actor.username || ""));
  if (!actorUsername) throw new Error("PROJECT_ACTOR_REQUIRED");
  if (action === "projects_read") {
    const { data: projects, error } = await supabase.from("inventory_projects").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    const ids = (projects || []).map(row => row.id);
    const { data: rows, error: rowsError } = ids.length
      ? await supabase.from("inventory_project_rows").select("*").in("project_id", ids).order("locationcode")
      : { data: [], error: null };
    if (rowsError) throw rowsError;
    return { projects: projects || [], rows: rows || [] };
  }
  if (action === "project_save") {
    const projectName = String(payload.projectName || "").trim();
    if (!projectName || projectName.length > 160) throw new Error("PROJECT_NAME_INVALID");
    const record = { project_name: projectName, instructions: String(payload.instructions || "").slice(0, 4000),
      assigned_users: Array.isArray(payload.assignedUsers) ? payload.assignedUsers.slice(0, 100) : [],
      created_by: actorUsername, created_by_name: String(actor.display_name || actorUsername), updated_at: new Date().toISOString() };
    const projectId = String(payload.projectId || "").trim();
    const query = projectId ? supabase.from("inventory_projects").update(record).eq("id", projectId) : supabase.from("inventory_projects").insert(record);
    const { data, error } = await query.select("*").single();
    if (error) throw error;
    return data;
  }
  if (action === "project_add_rows") {
    const projectId = String(payload.projectId || "").trim();
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 100) : [];
    if (!projectId || !rows.length) throw new Error("PROJECT_ROWS_INVALID");
    const records = rows.map(value => { const row = jsonObject(value); return { project_id: projectId,
      itemcode:String(row.itemcode || ""), locationcode:String(row.locationcode || ""), lotcode:String(row.lotcode || ""),
      commonname:String(row.commonname || ""), contsize:String(row.contsize || ""), row_instructions:String(row.rowInstructions || "").slice(0, 2000),
      snapshot_metrics:jsonObject(row.snapshotMetrics), added_by:actorUsername, updated_at:new Date().toISOString() }; });
    if (records.some(row => !row.itemcode || !row.locationcode || !row.lotcode)) throw new Error("PROJECT_ROWS_INVALID");
    const { data, error } = await supabase.from("inventory_project_rows").upsert(records, { onConflict:"project_id,itemcode,locationcode,lotcode" }).select("*");
    if (error) throw error;
    return data || [];
  }
  const rowId = String(payload.rowId || "").trim();
  if (action === "project_update_row") {
    if (!rowId) throw new Error("PROJECT_ROW_INVALID");
    if (payload.remove === true) {
      const { error } = await supabase.from("inventory_project_rows").delete().eq("id", rowId);
      if (error) throw error;
      return { deleted:true };
    }
    const updates: Database["public"]["Tables"]["inventory_project_rows"]["Update"] = { updated_at:new Date().toISOString() };
    if (typeof payload.rowInstructions === "string") updates.row_instructions = payload.rowInstructions.slice(0, 2000);
    if (payload.status === "done" || payload.status === "pending") {
      const done = payload.status === "done";
      updates.status = done ? "done" : "pending";
      updates.completed_by = done ? actorUsername : null;
      updates.completed_at = done ? new Date().toISOString() : null;
    }
    if (Object.keys(updates).length === 1) throw new Error("PROJECT_ROW_UPDATE_INVALID");
    const { data, error } = await supabase.from("inventory_project_rows").update(updates).eq("id", rowId).select("*").single();
    if (error) throw error;
    return data;
  }
  if (action === "project_delete") {
    const projectId = String(payload.projectId || "").trim();
    if (!projectId) throw new Error("PROJECT_ID_INVALID");
    const { error } = await supabase.from("inventory_projects").delete().eq("id", projectId);
    if (error) throw error;
    return { deleted:true };
  }
  throw new Error("PROJECT_ACTION_INVALID");
}

function hasTableWriteAccess(role = "", table = "", method = "POST", body: unknown = null, username = "") {
  if (!WRITABLE_TABLES.has(table)) return false;
  const userKey = normalizeUsername(username);
  const access = getRoleAccessState(role);
  // Request creation, Eval assignments, and push identity are now enforced by
  // authenticated RPCs. Never let this legacy service-role proxy bypass those
  // database authorization boundaries.
  if (table === "ph_warehouse_assigned_items" || table === "ph_inventory_row_assignments" || table === "ph_itemcode_default_owners" || table === "ph_push_subscriptions" || table === "ph_shear_list") return false;
  if (table === "ph_dock_team_status") return false;
  if (table === "ph_soc_master") return false; // Native column grants / protected Suspend Tag command own SOC writes.
  if (table === "ph_requests_pending" && access.isRep) return false;
  if (FULL_ACCESS_USER_KEYS.has(userKey)) return ["POST", "PATCH", "DELETE"].includes(method);
  if (table === AV_OPTION_EVAL_REQUESTS_TABLE) return ["POST", "PATCH", "DELETE"].includes(method);
  if (access.isAdmin) return true;
  if (COMMON_AUTH_WRITE_TABLES.has(table)) return ["POST", "PATCH", "DELETE"].includes(method);
  if (table === "ph_push_subscriptions") return method === "POST";
  if (table === "ph_labor_hours") return method === "POST";
  if (access.isRepLike) {
    return REP_WRITE_TABLES.has(table) && ["POST", "PATCH", "DELETE"].includes(method);
  }
  if (access.isQcSupervisor) {
    if (QC_WRITE_TABLES.has(table) && ["POST", "PATCH", "DELETE"].includes(method)) return true;
    if (table === "ph_dock_team_status" && method === "POST") return true;
    if (table === "ph_dock_item_status" && method === "POST") return true;
    if (table === "ph_master_inventory" && method === "PATCH") {
      const payload = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>) : [];
      return payload.length > 0 && payload.every((key) => MASTER_QC_WRITABLE_FIELDS.has(String(key || "").trim().toLowerCase()));
    }
  }
  if (access.isQc) {
    return QC_WRITE_TABLES.has(table) && ["POST", "PATCH", "DELETE"].includes(method);
  }
  return false;
}

function getSessionUserKey(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>) {
  if (!session) return "";
  return normalizeUsername(session.username || session.displayName || "");
}

const EVAL_WORK_MANAGER_USERS = new Set(["dylan_collyge", "megan_kelly", "jd_jones"]);
const EVAL_WORK_ASSIGNABLE_USERS = new Set([
  "josh_vann", "jorge_colunga", "abigail_vazquez", "bobby_adair", "charley_robertson",
  "ellen_ward", "zoe_green", "mitch_kaiser", "dylan_collyge", "megan_kelly",
  "kayla_knepp", "jd_jones", "nelly_aguilar",
]);

function isEvalWorkManager(session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>) {
  return EVAL_WORK_MANAGER_USERS.has(normalizeUsername(session?.username || session?.displayName || ""));
}

async function resolveActiveSessionProfile(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
) {
  const username = normalizeUsername(session?.username || session?.displayName || "");
  if (!username) throw new Error("profile_identity_required");
  const baseQuery = () => supabase
    .from("profiles")
    .select("id,username,display_name,role,disabled_at,locked_until,must_change_password");
  let profile: Record<string, unknown> | null = null;
  let profileError: unknown = null;
  if (session?.authUserId) {
    const byId = await baseQuery().eq("id", String(session.authUserId)).maybeSingle();
    profile = byId.data as Record<string, unknown> | null;
    profileError = byId.error;
  }
  if (!profile) {
    const byUsername = await baseQuery().eq("username", username).maybeSingle();
    profile = byUsername.data as Record<string, unknown> | null;
    profileError = byUsername.error;
  }
  if (profileError && !profile) throw profileError;
  const lockedUntil = Date.parse(String(profile?.locked_until || ""));
  if (!profile?.id || profile.disabled_at || profile.must_change_password
    || (Number.isFinite(lockedUntil) && lockedUntil > Date.now())) {
    throw new Error("profile_not_active");
  }
  if (!await isAppAccountActive(supabase, { id: String(profile.id) })) throw new Error("profile_not_active");
  return profile as Record<string, unknown>;
}

async function resolveZeroTrustRequestContext(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
) {
  if (!session) throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 });
  if (session.mustChangePassword) throw Object.assign(new Error("PASSWORD_CHANGE_REQUIRED"), { status: 403 });
  const actor = await resolveActiveSessionProfile(session);
  const access = await resolveCanonicalUserAccess(supabase, String(actor.id || ""));
  const profileUsername = normalizeUsername(String(actor.username || ""));
  const sessionUsername = normalizeUsername(String(session.username || ""));
  if (!profileUsername || profileUsername !== sessionUsername || profileUsername !== access.username) {
    throw Object.assign(new Error("AUTH_IDENTITY_MISMATCH"), { status: 401 });
  }
  return {
    actor,
    access,
    session: {
      ...session,
      authUserId: String(actor.id),
      username: profileUsername,
      displayName: String(actor.display_name || profileUsername),
      role: access.canonicalRole,
      displayRole: String(actor.role || "User"),
      canonicalRole: access.canonicalRole,
    },
  };
}

export async function handleFieldCountAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Sign in to use Field Count.", 401, { code: "FIELD_COUNT_UNAUTHORIZED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "FIELD_COUNT_FORBIDDEN" });
  let actor: Record<string, unknown>;
  try {
    actor = await resolveActiveSessionProfile(session);
  } catch {
    return errorResponse("An active account profile is required.", 403, { code: "FIELD_COUNT_FORBIDDEN" });
  }
  try {
    const allowed = new Set(["action", "operation", "payload", "commandId"]);
    if (Object.keys(payload).some(key => !allowed.has(key)) || !["read", "save", "complete"].includes(String(payload.operation))) {
      return errorResponse("FIELD_COUNT_PAYLOAD_INVALID", 400);
    }
    const input = jsonObject(payload.payload);
    if (input.countType !== "bunch" && input.countType !== "spread") return errorResponse("FIELD_COUNT_TYPE_INVALID", 400);
    const table = input.countType === "bunch" ? "ph_bunch_counts" : "ph_spread_counts";
    if (!hasTableReadAccess(String(session.role), table, String(actor.username))
      || !hasTableWriteAccess(String(session.role), table, "POST", null, String(actor.username))) {
      return errorResponse("FIELD_COUNT_FORBIDDEN", 403, { code: "FIELD_COUNT_FORBIDDEN" });
    }
    const { data, error } = await supabase.rpc("field_count_command_v1", {
      p_actor_id: String(actor.id), p_operation: String(payload.operation), p_payload: input,
      ...(typeof payload.commandId === "string" ? { p_command_id: payload.commandId } : {}),
    });
    if (error) throw error;
    return jsonResponse({ ok: true, data });
  } catch (error) {
    const failure = error as { message?: string; code?: string };
    const message = /^FIELD_COUNT_[A-Z_]+$/.test(failure.message || "") ? failure.message! : "FIELD_COUNT_UNAVAILABLE";
    return errorResponse(message, failure.code === "42501" ? 403 : /CONFLICT|CHANGED/.test(message) ? 409 : 400, { code: message });
  }
}

export async function handleRequestRecipientDirectory(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  dependencies = {
    resolveActiveProfile: resolveActiveSessionProfile,
    readDirectory: () => readRequestRecipientDirectory(supabase),
  },
) {
  const forbidden = () => errorResponse("An authorized Bloom or Request email workflow is required.", 403, { code: "RECIPIENT_DIRECTORY_FORBIDDEN" });
  if (!session || session.mustChangePassword) return forbidden();
  let actor: Record<string, unknown>;
  try { actor = await dependencies.resolveActiveProfile(session); }
  catch { return forbidden(); }
  if (!isRequestRecipientDirectoryUser(actor.username)) return forbidden();
  if (Object.keys(payload).some(key => key !== "action")) {
    return errorResponse("Recipient directory filters are server controlled.", 400, { code: "RECIPIENT_DIRECTORY_INPUT_INVALID" });
  }
  try { return jsonResponse(await dependencies.readDirectory()); }
  catch { return errorResponse("Recipients could not be loaded. Retry loading the email picker.", 503, { code: "RECIPIENT_DIRECTORY_UNAVAILABLE" }); }
}

async function handleManagerSeasonSettings(
  req: Request,
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  const forbidden = () => errorResponse("An authorized Managers account is required.", 403, { code: "AURA_MANAGER_SETTINGS_FORBIDDEN" });
  const authorization = String(req.headers.get("authorization") || "").trim();
  if (!session?.authUserId || session.mustChangePassword || !/^Bearer\s+\S+$/i.test(authorization)) return forbidden();
  let actor: Record<string, unknown>;
  try {
    // This operation requires native Auth even during the app's legacy-session window.
    const { data, error } = await supabase.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (error || !data?.user?.id || data.user.id !== session.authUserId) return forbidden();
    actor = await resolveActiveSessionProfile(session);
    if (typeof actor.id !== "string" || actor.id !== data.user.id || !FULL_ACCESS_USER_KEYS.has(String(actor.username || ""))) return forbidden();
  } catch { return forbidden(); }
  const operation = payload.operation === "read" || payload.operation === "save" ? payload.operation : null;
  if (!operation) return errorResponse("Choose read or save.", 400, { code: "AURA_MANAGER_SETTINGS_INPUT_INVALID" });
  const allowed = operation === "read" ? new Set(["action", "operation"])
    : new Set(["action", "operation", "seasonCode", "salesYear", "expectedRevision"]);
  if (!["read", "save"].includes(String(operation)) || Object.keys(payload).some(key => !allowed.has(key))
    || (operation === "save" && (!Number.isSafeInteger(payload.expectedRevision) || Number(payload.expectedRevision) < 0
      || !["S1", "F1"].includes(String(payload.seasonCode)) || !Number.isInteger(payload.salesYear)
      || Number(payload.salesYear) < 1 || Number(payload.salesYear) > 99))) {
    return errorResponse("Choose S1 or F1, a sales year from 1 to 99, and reload the setting before saving.", 400, { code: "AURA_MANAGER_SETTINGS_INPUT_INVALID" });
  }
  try {
    const { data, error } = await supabase.rpc("aura_manager_season_settings_v1", {
    p_actor_id: String(actor.id), p_operation: operation,
      p_expected_revision: operation === "save" ? Number(payload.expectedRevision) : undefined,
      p_season_code: operation === "save" ? String(payload.seasonCode) : undefined,
      p_sales_year: operation === "save" ? Number(payload.salesYear) : undefined,
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("AURA_SEASON_SETTINGS_UNAVAILABLE");
    const setting = jsonObject(data);
    const seasonCode = setting.seasonCode;
    const salesYear = setting.salesYear;
    const revision = setting.revision;
    if (typeof seasonCode !== "string" || !["S1", "F1"].includes(seasonCode) || typeof salesYear !== "number" || !Number.isInteger(salesYear)
      || salesYear < 1 || salesYear > 99 || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) throw new Error("AURA_SEASON_SETTINGS_UNAVAILABLE");
    return jsonResponse({ ok: true, data: { seasonCode, salesYear, revision } });
  } catch (error) {
    const detail = error as { code?: string; message?: string };
    if (detail.code === "42501") return forbidden();
    if ((detail.code === "40001" || detail.code === "PT409") || detail.message === "AURA_MANAGER_SETTINGS_CONFLICT") {
      return errorResponse("Another manager changed the season. Reload the current setting and review your update.", 409, { code: "AURA_MANAGER_SETTINGS_CONFLICT" });
    }
    return errorResponse("Current season settings are unavailable. Reload and try again; no update has been confirmed.", 503, { code: "AURA_SEASON_SETTINGS_UNAVAILABLE" });
  }
}

async function handleCustomerRepMappingAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Sign in to manage customer mappings.", 401, { code: "CUSTOMER_REP_MAPPING_UNAUTHORIZED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("An active account profile is required.", 403, { code: "CUSTOMER_REP_MAPPING_PROFILE_INACTIVE" }); }
  let request: ReturnType<typeof validateCustomerRepMappingRequest>;
  try { request = validateCustomerRepMappingRequest(payload); }
  catch (error) {
    const code = String(error instanceof Error ? error.message : "CUSTOMER_REP_MAPPING_PAYLOAD_INVALID");
    return errorResponse("The customer mapping request is invalid.", 400, { code });
  }
  if (["options", "preload"].includes(request.operation) && !hasTableReadAccess(String(session.role || ""), "ph_customer_consignee_sales_reps", String(actor.username || ""))) {
    return errorResponse("Forbidden", 403, { code: "CUSTOMER_REP_MAPPING_FORBIDDEN" });
  }
  if (!["options", "preload"].includes(request.operation) && !isCustomerRepMappingEditorRole(session.role)) {
    return errorResponse("Customer mapping management is available only to active Administrators and Managers.", 403, { code: "CUSTOMER_REP_MAPPING_FORBIDDEN" });
  }
  try {
    if (request.operation === "options") {
      const salesrepId = String(request.payload.salesrepId || "").trim();
      const salesrepName = String(request.payload.salesrepName || "").trim();
      const username = normalizeUsername(String(actor.username || ""));
      const executiveDirectory = username === "jd_jones";
      const actorRole = String(actor.role || session.role || "").toUpperCase().replace(/[^A-Z]/g, "");
      const repActor = ["REP", "SALESREP", "SALES"].includes(actorRole);
      if (!salesrepId && !salesrepName && !executiveDirectory && !repActor) {
        return errorResponse("Choose a sales representative before loading customer options.", 400, { code: "CUSTOMER_REP_MAPPING_REP_REQUIRED" });
      }
      const { data, error } = await supabase.rpc("request_customer_directory_v23102", {
        p_actor_id: String(actor.id || ""),
        p_salesrep_identity: salesrepName || (!salesrepId && repActor ? String(actor.username || "") : ""),
        p_salesrep_id: salesrepId,
        p_page: Number(request.payload.page || 0),
        p_page_size: Number(request.payload.pageSize || 100),
        p_q: String(request.payload.q || ""),
      });
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("CUSTOMER_REP_MAPPING_RESPONSE_INVALID");
      if (Boolean((data as Record<string, unknown>).universal) !== executiveDirectory) {
        throw new Error("CUSTOMER_REP_MAPPING_DIRECTORY_SCOPE_INVALID");
      }
      return jsonResponse(data);
    }
    const { data, error } = await supabase.rpc("customer_rep_mapping_manage_v1", {
      p_actor_id: String(actor.id || ""),
      p_operation: request.operation,
      p_payload: jsonValue(request.payload),
    });
    if (error) {
      const failure = String(error.message || "");
      if (/CUSTOMER_REP_MAPPING_(?:CONFLICT|DUPLICATE)/.test(failure)) {
        return errorResponse("This mapping changed or conflicts with another row. Reload and review it before saving.", 409, { code: "CUSTOMER_REP_MAPPING_CONFLICT" });
      }
      if (/CUSTOMER_REP_MAPPING_NOT_FOUND/.test(failure)) {
        return errorResponse("The customer mapping no longer exists. Reload the list.", 404, { code: "CUSTOMER_REP_MAPPING_NOT_FOUND" });
      }
      if (/CUSTOMER_REP_MAPPING_(?:FORBIDDEN|PROFILE_INACTIVE)/.test(failure)) {
        return errorResponse("Customer mappings are available only to active Administrators and Managers.", 403, { code: "CUSTOMER_REP_MAPPING_FORBIDDEN" });
      }
      if (/CUSTOMER_REP_MAPPING_(?:PAYLOAD|FILTER|VALUE|REVISION|IDENTITY_MISSING|REP_UNVERIFIED|OPERATION)/.test(failure)) {
        return errorResponse("The customer mapping could not be saved. Review the active customer, consignee, and sales representative.", 400, { code: failure.match(/CUSTOMER_REP_MAPPING_[A-Z_]+/)?.[0] || "CUSTOMER_REP_MAPPING_INVALID" });
      }
      throw error;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("CUSTOMER_REP_MAPPING_RESPONSE_INVALID");
    return jsonResponse(data);
  } catch (error) {
    // The mapping editor is a fail-open read surface. A transient RPC/index
    // failure must not lock Home or Manager behind a 503; retain the browser's
    // last-known-good directory and let it revalidate on the next coordinator tick.
    recordHandledError("app-api", "customer-rep-map", error, 200);
    const page = Number(request.payload.page || 0);
    const pageSize = Number(request.payload.pageSize || 100);
    const readOperation = ["list", "options", "preload", "detail", "reps"].includes(request.operation);
    return jsonResponse(readOperation ? {
      ok: true,
      stale: true,
      retained: true,
      operation: request.operation,
      page,
      pageSize,
      total: 0,
      rows: [],
      reps: [],
      revision: "0",
      code: "CUSTOMER_REP_MAPPING_REVALIDATING",
    } : {
      ok: false,
      stale: true,
      retained: true,
      code: "CUSTOMER_REP_MAPPING_RETRY_REQUIRED",
      message: "The saved directory is still available. Retry this change after refresh; no update was confirmed.",
    }, 200);
  }
}

function sanitizeDriveReclassPayload(payload: Record<string, unknown>) {
  const sourceInput = payload.source && typeof payload.source === "object" && !Array.isArray(payload.source)
    ? payload.source as Record<string, unknown>
    : {};
  const transaction = payload.transaction && typeof payload.transaction === "object" && !Array.isArray(payload.transaction)
    ? payload.transaction as Record<string, unknown>
    : {};
  const rowOverlays = Array.isArray(payload.rowOverlays) ? payload.rowOverlays : [];
  const editableFields = payload.workflowPolicyVersion === RECLASS_EDITABLE_FIELDS_POLICY;
  const sourceContext = jsonObject(payload.sourceContext ?? {});
  const sourceMode = String(sourceContext.sourceMode || "drive");
  return {
    workflowPolicyVersion: String(payload.workflowPolicyVersion || "").trim(),
    idempotencyToken: String(payload.idempotencyToken || payload.idempotency_token || "").trim(),
    source: {
      unique_id: String(sourceInput.unique_id || sourceInput.uniqueId || "").trim(),
      source_table: "ph_master_inventory",
      itemcode: String(sourceInput.itemcode || "").trim(),
      lotcode: String(sourceInput.lotcode || "").trim(),
      locationcode: String(sourceInput.locationcode || "").trim(),
    },
    transaction,
    rowOverlays,
    ...(editableFields ? {
      sourceContext: { sourceMode, ...(sourceMode === "eval-report-2" ? {
        reportId: String(sourceContext.reportId || "").trim().toLowerCase(),
        itemcode: String(sourceContext.itemcode || "").trim(),
      } : {}) },
      recipientEmails: sourceMode === "item-inquiry" && Array.isArray(payload.recipientEmails) ? payload.recipientEmails : [],
    } : {}),
    clientVersion: String(payload.clientVersion || "").trim().slice(0, 80),
  };
}

function driveReclassErrorResponse(message: string) {
  const raw = String(message || "").trim().toUpperCase();
  if (/V7_.*(?:CONFLICT|STALE|ROW_MISSING|SOURCE_MISSING|SOURCE_CHANGED)/.test(raw)) {
    return errorResponse("Inventory changed. Refresh and review the edited fields before sending again.", 409, { code: "DRIVE_RECLASS_SOURCE_CHANGED" });
  }
  if (/V[67]_INVENTORY_REFRESH_REQUIRED|V[67]_INVENTORY_REVISION_MISSING/.test(raw)) {
    return jsonResponse({ ok: false, retryable: true, code: "DRIVE_RECLASS_INVENTORY_REFRESH_REQUIRED", message: "Inventory is refreshing; the latest committed rows remain available." });
  }
  if (/V6_.*(?:SETTINGS|SEASON_SETTING).*(?:UNAVAILABLE|INVALID|MISSING)/.test(raw)) {
    return jsonResponse({ ok: false, retryable: true, code: "DRIVE_RECLASS_SEASON_SETTINGS_UNAVAILABLE", message: "Current season settings are refreshing." });
  }
  if (/V6_LIVE_EDIT_(CONFLICT|ROW_MISSING)|V6_ORIGINAL_SNAPSHOT_CONFLICT/.test(raw)) {
    return errorResponse("Inventory changed. Refresh Drive Mode and review the priority and hold fields before sending again.", 409, { code: "DRIVE_RECLASS_SOURCE_CHANGED" });
  }
  if (/TOKEN_OWNERSHIP/.test(raw)) {
    return errorResponse("This saved inquiry belongs to another user.", 403, { code: "DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT" });
  }
  if (/FORBIDDEN|PERMISSION_REQUIRED|ROW_NOT_ASSIGNED|PROFILE_NOT_ACTIVE|ACTOR_REQUIRED/.test(raw)) {
    return errorResponse("You do not have access to Reclass this Drive row.", 403, { code: "DRIVE_RECLASS_FORBIDDEN" });
  }
  if (/SOURCE_(?:ROW_)?(?:CHANGED|MISSING)|TOKEN_CONFLICT|V5_ORIGINAL_SNAPSHOT_CONFLICT/.test(raw)) {
    return errorResponse("Inventory or inquiry state changed. Refresh Drive Mode, review the row, and send again.", 409, { code: "DRIVE_RECLASS_SOURCE_CHANGED" });
  }
  if (/EVAL_WORK_(ORIGINAL_OH|VERSION|SUBMISSION_TOKEN)_.*CONFLICT|EVAL_WORK_SUBMISSION_TOKEN_CONFLICT/.test(raw)) {
    return errorResponse("The inventory or saved inquiry changed. Refresh Drive Mode, review the row, and send again.", 409, { code: "DRIVE_RECLASS_SOURCE_CHANGED" });
  }
  if (/RECIPIENTS_UNAVAILABLE/.test(raw)) {
    return jsonResponse({ ok: false, retryable: true, code: "DRIVE_RECLASS_RECIPIENTS_UNAVAILABLE", message: "The inventory receipt is retained while report delivery recipients refresh." });
  }
  if (/PAYLOAD|TOKEN|SOURCE_REQUIRED|ACTIONS_INVALID|V3_REQUIRED|V4_|V5_|V6_|V7_|STATUS_INVALID|RETRY_INVALID|EVAL_WORK_(MOVE_|INQUIRY_|ROW_|ACTION_|PROPOSAL_|SPLIT_|ORIGINAL_OH_)/.test(raw)) {
    return errorResponse("The Reclass inquiry is incomplete. Review it and try again.", 400, { code: "DRIVE_RECLASS_INVALID" });
  }
  return jsonResponse({ ok: false, retryable: true, code: "DRIVE_RECLASS_SERVICE_UNAVAILABLE", message: "Reclass is reconciling the same idempotent inquiry." });
}

async function handlePhotoHistoryAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  const profile = await resolveActiveSessionProfile(session).catch(() => null);
  if (session.mustChangePassword || !profile || !isPhotoHistoryUsernameAllowed(profile.username)) {
    return errorResponse('Photo History is not enabled for this account.', 403, { code: 'PHOTO_HISTORY_FORBIDDEN' });
  }
  const operation = String(payload.operation || 'search');
  if (!['search', 'recipients', 'asset', 'send', 'status', 'retry', 'dismiss'].includes(operation)) {
    return errorResponse('Unsupported Photo History action.', 400);
  }
  // The session supplies the actor. RPCs freeze recipients and asset references themselves.
  const input = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
    ? jsonObject(payload.input) : {};
  try {
    if (typeof profile.id !== "string") throw new Error("PHOTO_HISTORY_PROFILE_INVALID");
    const { data, error } = await supabase.rpc('photo_history_gallery_v1', {
      p_actor_id: profile.id, p_operation: operation, p_input: input,
    });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("PHOTO_HISTORY_RESPONSE_INVALID");
    const result = jsonObject(data);
    if (operation === 'search') {
      const photos = Array.isArray(result.photos) ? result.photos.map((value) => publicHistoryPhoto(SUPABASE_URL, jsonObject(value))) : [];
      return jsonResponse({ ...result, photos });
    }
    if (operation === 'asset') {
      const asset = jsonObject(result.asset);
      if (input.open === true) {
        const url = asset.storage_available ? historyPhotoUrl(SUPABASE_URL, asset, true)
          : `https://drive.google.com/file/d/${encodeURIComponent(String(asset.drive_file_id || ''))}/view`;
        return jsonResponse({ ok: true, url, archived: !asset.storage_available });
      }
      if (asset.storage_available) return jsonResponse({ ok: true, thumbnail: historyPhotoUrl(SUPABASE_URL, asset) });
      return jsonResponse(await readArchivedHistoryThumbnail(asset));
    }
    return jsonResponse(result);
  } catch (error) {
    const raw = String(error instanceof Error ? error.message : '');
    const codes: Record<string, string> = {
      PHOTO_HISTORY_RECIPIENT_UNAVAILABLE: 'This sales rep is not available. Choose another verified sales rep.',
      PHOTO_HISTORY_REQUIRED_COPY_UNAVAILABLE: 'Dylan and JD must both have active accounts with verified email addresses. Your photos are retained; no email was sent.',
      PHOTO_HISTORY_ASSET_UNAVAILABLE: 'A selected photo is no longer available. Review your selection.',
      PHOTO_HISTORY_PREVIEW_UNAVAILABLE: 'Thumbnail unavailable. Retry or explicitly open the archived photo.',
      PHOTO_HISTORY_TOKEN_CONFLICT: 'This send was already saved with different selections. Review before sending again.',
      PHOTO_HISTORY_SELECTION_INVALID: 'Select between 1 and 20 photos and keep the message under 2,000 characters.',
      PHOTO_HISTORY_FORBIDDEN: 'Photo History is not enabled for this account.',
    };
    const code = Object.keys(codes).find(c => raw.includes(c)) || 'PHOTO_HISTORY_RETRY';
    return errorResponse(codes[code] || 'Photo History could not finish. Retry; your selection is retained.', code === 'PHOTO_HISTORY_FORBIDDEN' ? 403 : 409, { code });
  }
}

async function invokeRequestDeliveryWorkerNow(source = "app_api_immediate") {
  return await fetch(SUPABASE_URL + "/functions/v1/request-delivery-worker", {
    method: "POST", headers: { Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      apikey: SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ source }), signal: AbortSignal.timeout(20000),
  });
}

function dispatchRequestDeliveryWorkerNow(source = "app_api_immediate") {
  const task = invokeRequestDeliveryWorkerNow(source).then(() => {}).catch(() => {});
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
}

function dispatchReclassDeliveryNow(result: Record<string, unknown>, _actorUsername: string, _token: string) {
  if ((!result.jobId && !result.deliveryEventId) || result.status === "delivered") return result;
  // The transaction already owns a durable outbox entry. Never hold the save
  // response open for PDF/Gmail; the leased worker and status RPC own recovery.
  dispatchRequestDeliveryWorkerNow("reclass_immediate");
  return result;
}

export async function handleDriveReclassAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401, { code: "AUTH_REQUIRED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  const activeProfile = await resolveActiveSessionProfile(session).catch(() => null);
  if (!activeProfile) return errorResponse("An active, unlocked app profile is required.", 403, { code: "PROFILE_NOT_ACTIVE" });
  const actorUsername = normalizeUsername(String(activeProfile.username || session.username || session.displayName || ""));
  if (!actorUsername) return errorResponse("Authenticated user identity is required.", 403, { code: "PROFILE_IDENTITY_REQUIRED" });
  const operation = String(payload.operation || "create").trim().toLowerCase();
  try {
    if (operation === "season_priority_list") {
      const assignedTo = String(payload.assignedTo || payload.assigned_to || "all").trim().slice(0, 120);
      const { data, error } = await supabase.rpc("manager_season_priority_list_v1", {
        p_actor_id: String(activeProfile.id),
        p_assigned_to: assignedTo,
      });
      if (error) return seasonPriorityErrorResponse(error.message || "");
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, rows: [] });
    }
    if (operation === "season_priority_submit") {
      const expectedPriority = Number(payload.expectedPriority ?? payload.expected_priority);
      const { data, error } = await supabase.rpc("submit_manager_season_priority_v2", {
        p_actor_id: String(activeProfile.id),
        p_source_unique_id: String(payload.sourceUid || payload.source_uid || "").trim(),
        p_expected_priority: Number.isInteger(expectedPriority) ? expectedPriority : 0,
        p_scope_fingerprint: String(payload.scopeFingerprint || payload.scope_fingerprint || "").trim().toLowerCase(),
        p_idempotency_token: String(payload.idempotencyToken || payload.idempotency_token || "").trim(),
      });
      if (error) return seasonPriorityErrorResponse(error.message || "");
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, lifecycleStatus: "delivery_failed" });
    }
    if (operation === "season_priority_state") {
      const itemcodes = Array.isArray(payload.itemcodes)
        ? payload.itemcodes.slice(0, 101).map((value) => String(value || "").trim()).filter(Boolean)
        : null;
      const { data, error } = await supabase.rpc("manager_season_priority_state_v1", {
        p_actor_id: String(activeProfile.id),
        ...(itemcodes ? { p_itemcodes: itemcodes } : {}),
      });
      if (error) return seasonPriorityErrorResponse(error.message || "");
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, requests: [] });
    }
    if (operation === "create") {
      if (payload.workflowPolicyVersion === RECLASS_EDITABLE_FIELDS_POLICY && payload.sourceContext != null
        && (typeof payload.sourceContext !== "object" || Array.isArray(payload.sourceContext))) {
        return driveReclassErrorResponse("DRIVE_RECLASS_V7_SOURCE_CONTEXT_INVALID");
      }
      const manualTransaction = payload.transaction && typeof payload.transaction === "object" && !Array.isArray(payload.transaction)
        ? payload.transaction as Record<string, unknown>
        : {};
      if (Object.prototype.hasOwnProperty.call(manualTransaction, "seasonPriority")) {
        return errorResponse("Season Priority contracts are generated by the protected Manager action.", 400, {
          code: "SEASON_PRIORITY_MARKER_RESERVED",
        });
      }
      const protectedPayload = {
        ...sanitizeDriveReclassPayload(payload),
        actorUsername,
      };
      try {
        validateReclassShearedProposals(protectedPayload);
        validateReclassSmartShieldProposals(protectedPayload);
        validateReclassEditableFieldProposals(protectedPayload);
      }
      catch (error) { return driveReclassErrorResponse(error instanceof Error ? error.message : "DRIVE_RECLASS_V5_PAYLOAD_INVALID"); }
      const liveChangeRows = [protectedPayload.source, ...(protectedPayload.rowOverlays || [])
        .map((value) => jsonObject(value))
        .filter((overlay) => (Array.isArray(overlay.fieldEdits) && overlay.fieldEdits.length > 0)
          || (Array.isArray(overlay.proposals) && overlay.proposals.length > 0))]
        .map((row) => ({
          uniqueId: String(row.unique_id || row.uniqueId || row.source_uid || "").trim(),
          itemcode: String(row.itemcode || "").trim(),
          locationcode: String(row.locationcode || "").trim(),
          lotcode: String(row.lotcode || "").trim(),
        }));
      try {
        await assertInventoryLiveChangeActorRows(supabase, activeProfile, liveChangeRows);
      } catch (error) {
        const code = String(error instanceof Error ? error.message : error || "");
        if (code === "INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED") {
          return errorResponse("Live changes for jorge_colunga are only permitted on rows assigned to jorge_colunga in Assigned Items.", 403, { code });
        }
        return driveReclassErrorResponse(code);
      }
      const enqueueRpc = protectedPayload.workflowPolicyVersion === RECLASS_EDITABLE_FIELDS_POLICY
        ? "enqueue_drive_reclass_inquiry_v7"
        : protectedPayload.workflowPolicyVersion === RECLASS_SMART_SHIELD_POLICY
        ? "enqueue_drive_reclass_inquiry_v6"
        : protectedPayload.workflowPolicyVersion === RECLASS_SHEARED_POLICY
          ? "enqueue_drive_reclass_inquiry_v5"
        : protectedPayload.workflowPolicyVersion === "reclass-action-workflow-v4-split-moves-20261006"
          ? "enqueue_drive_reclass_inquiry_v4"
          : "enqueue_drive_reclass_inquiry_v1";
      const { data, error } = await supabase.rpc(enqueueRpc, { p_payload: jsonValue(protectedPayload) });
      if (error) return driveReclassErrorResponse(error.message || "");
      const result = jsonObject(data);
      return jsonResponse(await dispatchReclassDeliveryNow(result, actorUsername, String(protectedPayload.idempotencyToken || "")));
    }
    const token = String(payload.idempotencyToken || payload.idempotency_token || "").trim();
    const rpcName = operation === "status"
      ? "get_drive_reclass_inquiry_status_v1"
      : operation === "retry"
      ? "retry_drive_reclass_inquiry_v1"
      : "";
    if (!rpcName) return errorResponse("Unsupported Reclass operation.", 400, { code: "DRIVE_RECLASS_OPERATION_INVALID" });
    const { data, error } = await supabase.rpc(rpcName, {
      p_actor_username: actorUsername,
      p_idempotency_token: token,
    });
    if (error) return driveReclassErrorResponse(error.message || "");
    const savedResult = jsonObject(data);
    const result = operation === "retry" ? await dispatchReclassDeliveryNow(savedResult, actorUsername, token) : savedResult;
    // The status RPC already authorizes the actor/token. Recover the committed
    // inventory receipt independently of its email delivery status.
    if (result.jobId) {
      const { data: event } = await supabase.from("ph_request_delivery_outbox")
        .select("payload").eq("event_id", String(result.jobId)).maybeSingle();
      const inquiry = jsonObject(jsonObject(event?.payload).reclassPayload);
      if (normalizeUsername(String(jsonObject(inquiry.actor).username || "")) === actorUsername) {
        const receipt = jsonObject(inquiry.protectedDelivery);
        for (const field of ["liveEdits", "inventoryRevision", "liveEditScope", "inventoryFields", "v7Scope"]) {
          if (receipt[field] !== undefined) result[field] = receipt[field];
        }
      }
    }
    return jsonResponse(Object.keys(result).length ? result : { ok: false, status: "missing" });
  } catch (_) {
    return driveReclassErrorResponse("DRIVE_RECLASS_SERVICE_UNAVAILABLE");
  }
}

async function requestReclassRecountRest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const value = await readResponsePayload(response);
  if (!response.ok) throw new Error(String(jsonObject(value).message || jsonObject(value).code || "RECLASS_RECOUNT_DATABASE_UNAVAILABLE"));
  return value;
}

function deriveReclassRecountContainerSize(itemcode: unknown) {
  const sizeCode = String(itemcode || "").trim().split(".")[1] || "";
  const sizes: Record<string, string> = {
    "250":"#25", "150":"#15", "100":"#10", "070":"#7", "050":"#5", "030":"#3",
    "031":"3DP", "021":"2DP", "020":"#2", "013":"1GP", "011":"#1", "010":"#1",
  };
  return sizes[sizeCode] || "";
}

function mergeReclassRecountJobs(jobs: Record<string, unknown>[], lines: Record<string, unknown>[]) {
  const lineBuckets = new Map<string, Record<string, unknown>[]>();
  for (const line of lines) {
    const jobId = String(line.job_id || "").trim();
    if (!jobId) continue;
    const bucket = lineBuckets.get(jobId) || [];
    bucket.push(line);
    lineBuckets.set(jobId, bucket);
  }
  const groups = new Map<string, Record<string, unknown>>();
  for (const job of jobs) {
    const itemcode = String(job.itemcode || "").trim();
    const locationcode = String(job.locationcode || "").trim();
    if (!itemcode || !locationcode) continue;
    const key = `${itemcode.toUpperCase()}\u0000${locationcode.toUpperCase()}`;
    const current = groups.get(key);
    const incomingLines = lineBuckets.get(String(job.id || "").trim()) || [];
    if (!current) {
      const commonname = String(job.commonname || "").trim();
      groups.set(key, {
        ...job,
        commonname: commonname && commonname.toLowerCase() !== "unknown" ? commonname : `Item ${itemcode}`,
        contsize: String(job.contsize || "").trim() || deriveReclassRecountContainerSize(itemcode),
        job_ids: [String(job.id || "").trim()].filter(Boolean),
        lines: incomingLines,
      });
      continue;
    }
    const jobIds = Array.isArray(current.job_ids) ? current.job_ids as unknown[] : [];
    const lineMap = new Map<string, Record<string, unknown>>();
    for (const line of [...(Array.isArray(current.lines) ? current.lines as Record<string, unknown>[] : []), ...incomingLines]) {
      const lineKey = String(line.source_unique_id || "").trim()
        || [line.lotcode, line.season, line.itemcode, line.locationcode].map(value => String(value || "").trim().toUpperCase()).join("|");
      if (!lineMap.has(lineKey)) lineMap.set(lineKey, line);
    }
    const incomingName = String(job.commonname || "").trim();
    if ((!String(current.commonname || "").trim() || /^unknown$|^item\s/i.test(String(current.commonname)))
      && incomingName && incomingName.toLowerCase() !== "unknown") current.commonname = incomingName;
    if (!String(current.contsize || "").trim() && String(job.contsize || "").trim()) current.contsize = String(job.contsize).trim();
    current.job_ids = [...new Set([...jobIds.map(value => String(value || "").trim()), String(job.id || "").trim()].filter(Boolean))];
    current.lines = [...lineMap.values()];
  }
  return [...groups.values()].map((job): Record<string, unknown> => ({
    ...job,
    system_on_hand: (Array.isArray(job.lines) ? job.lines as Record<string, unknown>[] : []).reduce((sum, line) => {
      const value = Number(String(line.on_hand ?? "").replace(/,/g, "").trim());
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0),
  })).sort((left, right) => String(left.locationcode || "").localeCompare(String(right.locationcode || ""), undefined, { numeric:true, sensitivity:"base" })
    || String(left.itemcode || "").localeCompare(String(right.itemcode || ""), undefined, { numeric:true, sensitivity:"base" }));
}

async function handleReclassRecountAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session || session.mustChangePassword) return transientOkResponse("RECLASS_RECOUNT_PROFILE_PENDING", "Recount is waiting for the active profile.", { jobs: [] });
  const actor = await resolveActiveSessionProfile(session).catch(() => null);
  if (!actor) return transientOkResponse("RECLASS_RECOUNT_PROFILE_PENDING", "Recount is waiting for the active profile.", { jobs: [] });
  const operation = String(payload.operation || "list").trim().toLowerCase();
  try {
    if (operation === "list") {
      const jobsValue = await requestReclassRecountRest("ph_active_recount?select=id,itemcode,commonname,contsize,locationcode,requested_by_username,requested_at,system_on_hand,status&order=locationcode.asc,itemcode.asc,requested_at.asc&limit=1000");
      const jobs = Array.isArray(jobsValue) ? jobsValue as Record<string, unknown>[] : [];
      const ids = jobs.map((job) => String(job.id || "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      let lines: Record<string, unknown>[] = [];
      if (ids.length) {
        const lineQuery = `ph_reclass_recount_lines?select=job_id,source_unique_id,lotcode,season,on_hand,available,review&job_id=in.(${ids.join(",")})&order=lotcode.asc,season.asc`;
        const linesValue = await requestReclassRecountRest(lineQuery);
        lines = Array.isArray(linesValue) ? linesValue as Record<string, unknown>[] : [];
      }
      return jsonResponse({ ok: true, data: mergeReclassRecountJobs(jobs, lines) });
    }
    if (operation === "complete") {
      const jobId = String(payload.jobId || payload.job_id || "").trim();
      const commandId = String(payload.commandId || payload.command_id || "").trim();
      const countedTotal = Number(payload.countedTotal ?? payload.counted_total);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)
        || !Number.isSafeInteger(countedTotal) || countedTotal < 0) {
        return jsonResponse({ ok: false, code: "RECLASS_RECOUNT_INPUT_INVALID", message: "Enter a whole counted amount of zero or more." });
      }
      const data = await requestReclassRecountRest("rpc/complete_reclass_recount_v1", {
        method: "POST",
        body: JSON.stringify({ p_actor_id: actor.id, p_job_id: jobId, p_counted_total: countedTotal, p_idempotency_token: commandId }),
      });
      const result = jsonObject(data);
      if (result.deliveryEventId) dispatchReclassDeliveryNow(result, "", "");
      return jsonResponse({ ok: true, data: result });
    }
    return jsonResponse({ ok: false, code: "RECLASS_RECOUNT_OPERATION_INVALID", message: "Unsupported Recount operation." });
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error || "RECLASS_RECOUNT_UNAVAILABLE").toUpperCase();
    return transientOkResponse(code.slice(0, 120), "Recount is temporarily unavailable; displayed rows remain available.", { jobs: [] });
  }
}

async function handleDatasetRevisionsAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  const keys = Array.isArray(payload.datasetKeys)
    ? [...new Set(payload.datasetKeys.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  if (!keys.length || keys.length > 64 || keys.some((key) => !/^[a-z][a-z0-9_]{1,127}$/.test(key))) {
    return jsonResponse({ ok: false, code: "DATASET_KEYS_INVALID", message: "Dataset revision request is invalid." });
  }
  if (!session || session.mustChangePassword) return transientOkResponse("DATASET_PROFILE_PENDING", "Dataset revisions are waiting for the active profile.", { sources: [] });
  const actor = await resolveActiveSessionProfile(session).catch(() => null);
  if (!actor) return transientOkResponse("DATASET_PROFILE_PENDING", "Dataset revisions are waiting for the active profile.", { sources: [] });
  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
    const [{ data, error }, metadata] = await Promise.all([
      rpc("dataset_revisions_for_actor_v1", { p_actor_id: actor.id, p_dataset_keys: keys }),
      supabase.from("app_dataset_revisions").select("key,source_file_name,source_imported_at").in("key", keys),
    ]);
    if (error) throw new Error(error.message || "DATASET_REVISIONS_UNAVAILABLE");
    const payload = jsonObject(data);
    const metadataByKey = new Map((metadata.error ? [] : metadata.data || []).map((row) => [String(row.key || ""), row]));
    const sources = (Array.isArray(payload.sources) ? payload.sources : []).map((value) => {
      const source = jsonObject(value);
      const row = metadataByKey.get(String(source.key || ""));
      if (!row || source.state === "unavailable") return source;
      return {
        ...source,
        sourceFileName: row.source_file_name || null,
        sourceImportedAt: row.source_imported_at || null,
      };
    });
    return jsonResponse({ ok: true, data: { ...payload, sources } });
  } catch (_error) {
    return transientOkResponse("DATASET_REVISIONS_UNAVAILABLE", "Dataset revisions are temporarily unavailable.", { sources: [] });
  }
}

function seasonPriorityErrorResponse(error: unknown) {
  const raw = String(error || "SEASON_PRIORITY_SERVICE_UNAVAILABLE").toUpperCase();
  if (/RECLASS_V6_/.test(raw)) return driveReclassErrorResponse(raw);
  const code = (raw.match(/SEASON_PRIORITY_[A-Z0-9_]+/) || ["SEASON_PRIORITY_SERVICE_UNAVAILABLE"])[0];
  if (/FORBIDDEN|PERMISSION_REQUIRED|TOKEN_OWNERSHIP_CONFLICT/.test(code)) {
    return errorResponse("Season Priority is available only to active Managers and Administrators.", 403, { code });
  }
  if (/EXPECTED_PRIORITY_INVALID|SCOPE_FINGERPRINT_INVALID|TOKEN_INVALID|ITEMCODE_REQUIRED|STATE_LIMIT/.test(code)) {
    return errorResponse("The Season Priority request is invalid. Refresh the Manager view and try again.", 400, { code });
  }
  if (/SOURCE_REFRESH_REQUIRED|SOURCE_REVISION_MISSING/.test(code)) {
    return errorResponse("Inventory is refreshing. Wait for the current import to finish, then refresh.", 503, { code });
  }
  if (/SOURCE_MISSING|SOURCE_NOT_ELIGIBLE|SOURCE_STALE|SCOPE_CHANGED|TOKEN_CONFLICT|ITEM_PENDING|LINEAGE_AMBIGUOUS/.test(code)) {
    return errorResponse("This Season Priority scope changed. Refresh and review it before sending a new inquiry.", 409, { code });
  }
  if (/OUTBOX_MISSING/.test(code)) {
    return errorResponse("The protected Reclass inquiry could not be queued. Retry with the same action.", 503, { code });
  }
  return errorResponse("Season Priority is temporarily unavailable. Refresh before trying again.", 503, { code });
}

function seasonSalesOfficeErrorResponse(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const raw = String(source.message || error || "SEASON_SALES_SERVICE_UNAVAILABLE").toUpperCase();
  const code = (raw.match(/SEASON_SALES_[A-Z0-9_]+/) || ["SEASON_SALES_SERVICE_UNAVAILABLE"])[0];
  if (/USER_NOT_ASSIGNED/.test(code)) {
    return errorResponse("You are not assigned to enter Season Sales Notes.", 403, { code });
  }
  if (/SETTINGS_PERMISSION_REQUIRED/.test(code)) {
    return errorResponse("You do not have permission to manage Season Sales Note users.", 403, { code });
  }
  if (/PROFILE_NOT_ACTIVE|PERMISSION_REQUIRED/.test(code)) {
    return errorResponse("Your active profile does not have Sales Office access.", 403, { code });
  }
  if (/STALE_REVISION|REVISION_REQUIRED|WINNER_CHANGED|NOT_OPEN/.test(code)) {
    return errorResponse("This Season Sales Note changed. Refresh it before trying again.", 409, { code });
  }
  if (/USER_INVALID|USER_LIMIT/.test(code)) {
    return errorResponse("Every selected Season Sales Note user must be active and unlocked.", 400, { code });
  }
  if (/TOKEN_INVALID|TOKEN_CONFLICT|NOT_FOUND/.test(code)) {
    return errorResponse("The Season Sales Note request is invalid. Refresh and try again.", 400, { code });
  }
  if (/BUSY/.test(code) || String(source.code || '') === '55P03' || String(source.code || '') === '57014') {
    return errorResponse("Season Sales Notes are updating. Tap Done again to retry safely.", 503, { code: "SEASON_SALES_BUSY" });
  }
  return errorResponse("Season Sales Notes could not be updated. Retry with the same action.", 503, { code });
}

async function handleRequestSalesImpactAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  actorProfile: Record<string, unknown> | null = null,
) {
  if (!session || session.mustChangePassword) {
    return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
  }
  const actor = actorProfile || await resolveActiveSessionProfile(session);
  if (!await resolveModuleAllowed(supabase, actor, "request-sales-impact")) {
    return jsonResponse({ ok: true, enabled: false, visible: false, rows: [] });
  }
  const { data, error } = await supabase.rpc("get_request_sales_impact_v2");
  if (error) {
    return jsonResponse({
      ok: false,
      enabled: true,
      visible: true,
      retained: true,
      retryable: true,
      code: "REQUEST_SALES_IMPACT_UNAVAILABLE",
    });
  }
  const result = jsonObject(data);
  const sourceAudit = jsonObject(result.source_table_audit || result.source_audit);
  const dedupeContract = String(result.dedupe_contract || sourceAudit.dedupe_contract || "");
  if (dedupeContract !== "canonical-active-history-v2363") {
    return jsonResponse({
      ok: false,
      enabled: true,
      visible: true,
      retained: true,
      retryable: true,
      code: "REQUEST_SALES_IMPACT_CONTRACT_STALE",
    });
  }
  return jsonResponse({ ok: true, enabled: true, visible: true, ...result });
}

async function handleHistoricalRequestsReadAction(
  req: Request,
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  actorProfile: Record<string, unknown> | null = null,
) {
  if (!session || session.mustChangePassword) {
    return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
  }
  if (Object.keys(payload).some((key) => !["action", "query"].includes(key))
      || !payload.query || typeof payload.query !== "object" || Array.isArray(payload.query)) {
    return retainedReadResponse("HISTORICAL_REQUESTS_QUERY_INVALID");
  }
  const query = payload.query as Record<string, unknown>;
  if (JSON.stringify(query).length > 4096) {
    return retainedReadResponse("HISTORICAL_REQUESTS_QUERY_INVALID");
  }
  const actor = actorProfile || await resolveActiveSessionProfile(session);
  const actorId = String(actor.id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)
      || (session.authUserId && String(session.authUserId).trim() !== actorId)) {
    return retainedReadResponse("HISTORICAL_REQUESTS_PROFILE_PENDING");
  }
  try {
    const operation = String(query.operation || "");
    const rpcName = operation.startsWith("archive-") ? "historical_archive_read_v2370" : "historical_requests_read_v2370";
    const legacyRpcNames = ["historical_archive_read_v2368", "historical_requests_read_v2368"] as const;
    let { data, error } = await supabase.rpc(rpcName as never, { p_actor_id: actorId, p_query: query } as never);
    if (error?.code === "PGRST202") {
      const legacyRpcName = operation.startsWith("archive-") ? legacyRpcNames[0] : legacyRpcNames[1];
      const authorization = String(req.headers.get("authorization") || "").trim();
      const authenticatedSupabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      ({ data, error } = await authenticatedSupabase.rpc(legacyRpcName as never, { p_query: query } as never));
    }
    if (error) return retainedReadResponse("HISTORICAL_REQUESTS_UNAVAILABLE");
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return retainedReadResponse("HISTORICAL_REQUESTS_RESPONSE_INVALID");
    }
    return jsonResponse({ ok: true, data });
  } catch {
    return retainedReadResponse("HISTORICAL_REQUESTS_UNAVAILABLE");
  }
}

async function handleInventoryConsolidationAction(
  _req: Request,
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session || session.mustChangePassword) {
    return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
  }
  if (Object.keys(payload).some((key) => !["action", "query"].includes(key))
      || (payload.query !== undefined && (!payload.query || typeof payload.query !== "object" || Array.isArray(payload.query)))) {
    return retainedReadResponse("INVENTORY_CONSOLIDATION_QUERY_INVALID");
  }
  const query = payload.query && typeof payload.query === "object" ? payload.query as Record<string, unknown> : {};
  if (Object.keys(query).some((key) => !["block", "containerSize", "cropTier", "salesYearRule", "query"].includes(key))
      || JSON.stringify(query).length > 2048) {
    return retainedReadResponse("INVENTORY_CONSOLIDATION_QUERY_INVALID");
  }
  const actor = await resolveActiveSessionProfile(session).catch(() => null);
  const actorId = String(actor?.id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)
      || (session.authUserId && String(session.authUserId).trim() !== actorId)) {
    return retainedReadResponse("INVENTORY_CONSOLIDATION_PROFILE_PENDING");
  }
  try {
    let { data, error } = await supabase.rpc("inventory_consolidation_suggestions_v2370" as never, {
      p_actor_id: actorId, p_query: query,
    } as never);
    if (error?.code === "PGRST202") {
      ({ data, error } = await supabase.rpc("inventory_consolidation_suggestions_v1" as never, {
        p_query: query,
      } as never));
    }
    if (error) return retainedReadResponse("INVENTORY_CONSOLIDATION_UNAVAILABLE");
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return retainedReadResponse("INVENTORY_CONSOLIDATION_RESPONSE_INVALID");
    }
    return jsonResponse({ ok: true, data });
  } catch {
    return retainedReadResponse("INVENTORY_CONSOLIDATION_UNAVAILABLE");
  }
}

async function handleSeasonSalesOfficeAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401, { code: "AUTH_REQUIRED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  const activeProfile = await resolveActiveSessionProfile(session).catch(() => null);
  if (!activeProfile) return errorResponse("An active, unlocked app profile is required.", 403, { code: "PROFILE_NOT_ACTIVE" });
  const actorUsername = normalizeUsername(String(activeProfile.username || session.username || session.displayName || ""));
  const operation = String(payload.operation || "").trim().toLowerCase();
  const masterId = String(payload.masterId || payload.master_id || "").trim();
  const idempotencyKey = String(payload.idempotencyKey || payload.idempotency_key || "").trim();
  try {
    if (operation === "access") {
      const { data, error } = await supabase.rpc("get_season_sales_note_access_v1", {
        p_actor_username: actorUsername,
      });
      if (error) throw error;
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, status: "failed" });
    }
    if (operation === "save_users") {
      const rawUsernames = Array.isArray(payload.usernames) ? payload.usernames : [];
      const usernames = Array.from(new Set(rawUsernames
        .map((value) => normalizeUsername(String(value || "")))
        .filter(Boolean)))
        .slice(0, 101);
      const { data, error } = await supabase.rpc("save_season_sales_note_users_v1", {
        p_actor_username: actorUsername,
        p_usernames: usernames,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, status: "failed" });
    }
    if (operation === "save_av_note") {
      const expectedRevision = Number(payload.expectedRevision);
      if (!masterId || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new Error("SEASON_SALES_STALE_REVISION");
      }
      const { data, error } = await supabase.rpc("save_season_sales_office_av_note_v1", {
        p_actor_username: actorUsername,
        p_master_id: masterId,
        p_expected_revision: expectedRevision,
        p_av_note: String(payload.avNote || "").trim().slice(0, 4000),
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, status: "failed" });
    }
    if (operation === "complete") {
      const expectedRevision = Number(payload.expectedRevision);
      if (!masterId || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new Error("SEASON_SALES_STALE_REVISION");
      }
      const { data, error } = await supabase.rpc("complete_season_sales_office_v1", {
        p_actor_username: actorUsername,
        p_master_id: masterId,
        p_expected_revision: expectedRevision,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, status: "failed" });
    }
    if (operation === "refresh") {
      const itemcode = String(payload.itemcode || "").trim();
      if (!itemcode) throw new Error("SEASON_SALES_NOT_FOUND");
      const { data, error } = await supabase.rpc("refresh_season_sales_office_v1", {
        p_actor_username: actorUsername,
        p_itemcode: itemcode,
        p_import_revision: String(payload.importRevision || `client:${Date.now()}`).slice(0, 180),
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, status: "failed" });
    }
    return errorResponse("Unsupported Season Sales Notes operation.", 400, { code: "SEASON_SALES_OPERATION_INVALID" });
  } catch (error) {
    return seasonSalesOfficeErrorResponse(error);
  }
}

const SHEAR_LOCATION_CREATOR = "dylan_collyge";
const SHEAR_LOCATION_TYPES = new Set(["shape_shear", "saleable_shear", "hard_shear", "corrective_shear"]);

function normalizeShearType(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

async function listActiveEmailProfiles() {
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,username,display_name,disabled_at,locked_until,must_change_password")
    .is("disabled_at", null)
    .order("display_name", { ascending: true })
    .limit(500);
  if (profileError) throw profileError;
  const { data: authPage, error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authError) throw authError;
  const emailById = new Map((authPage?.users || []).map((user) => [String(user.id || ""), String(user.email || "").trim().toLowerCase()]));
  const now = Date.now();
  return (profiles || []).flatMap((profile) => {
    const lockedUntil = Date.parse(String(profile.locked_until || ""));
    const email = emailById.get(String(profile.id || "")) || "";
    if (profile.must_change_password || (Number.isFinite(lockedUntil) && lockedUntil > now)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [];
    return [{
      profileId: String(profile.id || ""),
      username: normalizeUsername(profile.username),
      display: String(profile.display_name || profile.username || "").trim(),
      email,
    }];
  });
}

async function resolveShearRecipients(values: unknown) {
  const profileIds = Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim()).filter(Boolean)));
  if (profileIds.length < 1 || profileIds.length > 50) throw new Error("shear_recipient_count_invalid");
  const directory = await listActiveEmailProfiles();
  const byProfileId = new Map(directory.map((entry) => [entry.profileId, entry]));
  const recipients = profileIds.map((profileId) => byProfileId.get(profileId)).filter(Boolean) as Array<Record<string, unknown>>;
  if (recipients.length !== profileIds.length) throw new Error("shear_recipient_invalid");
  return recipients;
}

function shearLocationError(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const raw = String(source.message || error || "shear_request_failed");
  const code = (raw.match(/shear_[a-z0-9_]+/i) || [String(source.code || "shear_request_failed")])[0].toLowerCase();
  const status = String(source.code || "") === "42501" || /forbidden|not_active/.test(code)
    ? 403 : (/conflict|already_active|refresh_required/.test(code) ? 409 : 400);
  const message = code === "shear_location_already_active"
    ? "That location already has active Shear work. Complete or cancel it before creating another inquiry."
    : code === "shear_selection_refresh_required"
    ? "One selected Drive row changed or is no longer current. Refresh Drive Mode and select it again."
    : code === "shear_revision_conflict"
    ? "This Shear inquiry changed. Refresh it before trying again."
    : code === "shear_recipient_invalid" || code === "shear_recipient_count_invalid"
    ? "Choose at least one active app user with a verified email address."
    : code === "shear_create_forbidden"
    ? "Only Dylan can create Shear location inquiries."
    : "The Shear location inquiry could not be completed.";
  return errorResponse(message, status, { code });
}

async function loadShearLocationInquiries(status = "active", inquiryId = "", includeDetails = false) {
  let query = supabase.from("ph_shear_location_inquiries").select([
    "id", "submission_id", "locationcode", "status", "revision", "item_count", "row_count",
    "total_on_hand", "total_to_shear", "recipient_usernames", "delivery_event_id",
    "created_by_username", "created_by_display", "created_at", "updated_at",
    "completed_by_username", "completed_at", "cancelled_by_username", "cancelled_at",
  ].join(","))
    .order("updated_at", { ascending: false }).limit(inquiryId ? 1 : 100);
  if (inquiryId) query = query.eq("id", inquiryId);
  else if (status === "active") query = query.in("status", ["open", "in_progress"]);
  else if (["open", "in_progress", "complete", "cancelled"].includes(status)) query = query.eq("status", status);
  const { data: inquiries, error } = await query.returns<Record<string, unknown>[]>();
  if (error) throw error;
  const ids = (inquiries || []).map((row) => String(row.id || "")).filter(Boolean);
  if (!ids.length) return [];
  let items: Record<string, unknown>[] = [];
  let rows: Record<string, unknown>[] = [];
  if (includeDetails) {
    const [{ data: itemData, error: itemError }, { data: rowData, error: rowError }] = await Promise.all([
      supabase.from("ph_shear_location_items").select("*").in("inquiry_id", ids).order("ordinal", { ascending: true }),
      supabase.from("ph_shear_location_rows").select("*").in("inquiry_id", ids).order("ordinal", { ascending: true }),
    ]);
    if (itemError) throw itemError;
    if (rowError) throw rowError;
    items = (itemData || []) as Record<string, unknown>[];
    rows = (rowData || []) as Record<string, unknown>[];
  }
  const eventIds = (inquiries || []).map((row) => String(row.delivery_event_id || "")).filter(Boolean);
  const deliveryById = new Map<string, Record<string, unknown>>();
  if (eventIds.length) {
    const { data: deliveries, error: deliveryError } = await supabase.from("ph_request_delivery_outbox")
      .select("event_id,status,attempt_count,sanitized_error_code,delivered_at,updated_at")
      .in("event_id", eventIds);
    if (deliveryError) throw deliveryError;
    for (const delivery of deliveries || []) deliveryById.set(String(delivery.event_id || ""), delivery as Record<string, unknown>);
  }
  const rowsByItem = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = String(row.item_id || "");
    const list = rowsByItem.get(key) || [];
    list.push(row as Record<string, unknown>);
    rowsByItem.set(key, list);
  }
  const itemsByInquiry = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const key = String(item.inquiry_id || "");
    const list = itemsByInquiry.get(key) || [];
    list.push({ ...item, rows: rowsByItem.get(String(item.id || "")) || [] } as Record<string, unknown>);
    itemsByInquiry.set(key, list);
  }
  return (inquiries || []).map((inquiry) => ({
    ...inquiry,
    items: itemsByInquiry.get(String(inquiry.id || "")) || [],
    delivery: deliveryById.get(String(inquiry.delivery_event_id || "")) || null,
  }));
}

async function handleShearLocationAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  const actorProfile = await resolveActiveSessionProfile(session).catch(() => null);
  if (!actorProfile) return errorResponse("An active, unlocked app profile is required.", 403, { code: "profile_not_active" });
  const actor = normalizeUsername(actorProfile.username);
  const operation = String(payload.operation || "list").trim().toLowerCase();
  try {
    if (operation === "recipient_options") {
      if (actor !== SHEAR_LOCATION_CREATOR) return errorResponse("Only Dylan can create Shear work.", 403, { code: "shear_create_forbidden" });
      const directory = await listActiveEmailProfiles();
      return jsonResponse({ ok: true, data: directory.map(({ profileId, username, display }) => ({ profileId, username, display })) });
    }
    if (operation === "list") {
      return jsonResponse({ ok: true, data: await loadShearLocationInquiries(String(payload.status || "active").trim().toLowerCase()) });
    }
    if (operation === "get") {
      const inquiryId = String(payload.inquiryId || "").trim();
      if (!inquiryId) throw new Error("shear_inquiry_not_found");
      const rows = await loadShearLocationInquiries("", inquiryId, true);
      if (!rows.length) return errorResponse("That Shear inquiry was not found.", 404, { code: "shear_inquiry_not_found" });
      return jsonResponse({ ok: true, data: rows[0] });
    }
    if (operation === "create") {
      if (actor !== SHEAR_LOCATION_CREATOR) return errorResponse("Only Dylan can create Shear work.", 403, { code: "shear_create_forbidden" });
      const rawSelections = Array.isArray(payload.selections) ? payload.selections : [];
      if (rawSelections.length < 1 || rawSelections.length > 100) throw new Error("shear_selection_count_invalid");
      const selections = rawSelections.map((value) => {
        const selection = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const percent = Number(selection.percent);
        const shearType = normalizeShearType(selection.shearType);
        if (!String(selection.sourceUniqueId || "").trim() || !Number.isFinite(percent) || percent <= 0 || percent > 100
          || !SHEAR_LOCATION_TYPES.has(shearType)) throw new Error("shear_selection_invalid");
        return {
          sourceUniqueId: String(selection.sourceUniqueId || "").trim(),
          percent,
          shearType,
          instructions: String(selection.instructions || "").trim().slice(0, 4000),
        };
      });
      const recipients = await resolveShearRecipients(payload.recipientProfileIds);
      const { data, error } = await supabase.rpc("create_shear_location_inquiries_v1", {
        p_payload: jsonValue({
          actorUsername: actor,
          idempotencyKey: String(payload.idempotencyKey || "").trim(),
          selections,
          recipients,
        }),
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    }
    if (["complete", "cancel", "retry"].includes(operation)) {
      const inquiryId = String(payload.inquiryId || "").trim();
      const expectedRevision = Number(payload.expectedRevision);
      if (!inquiryId || !Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error("shear_revision_invalid");
      if ((operation === "cancel" || operation === "retry") && actor !== SHEAR_LOCATION_CREATOR) {
        return errorResponse("Only Dylan can change or retry this Shear inquiry.", 403, { code: `shear_${operation}_forbidden` });
      }
      const rpcName = operation === "complete" ? "complete_shear_location_inquiry_v1"
        : operation === "cancel" ? "cancel_shear_location_inquiry_v1"
        : "retry_shear_location_delivery_v1";
      const { data, error } = await supabase.rpc(rpcName, {
        p_inquiry_id: inquiryId,
        p_actor_username: actor,
        p_expected_revision: expectedRevision,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    }
    return errorResponse("Unsupported Shear operation.", 400, { code: "shear_operation_invalid" });
  } catch (error) {
    return shearLocationError(error);
  }
}

const LOCATION_WORK_CREATOR = "dylan_collyge";
const LOCATION_WORK_ACTIONS = new Set(["ta", "move", "grade", "save"]);

function locationWorkError(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const raw = String(source.message || error || "location_work_request_failed");
  const code = (raw.match(/location_work_[a-z0-9_]+/i)
    || [String(source.code || "location_work_request_failed")])[0].toLowerCase();
  const status = String(source.code || "") === "42501" || /forbidden|not_active/.test(code)
    ? 403 : (/conflict|already_resolved|refresh_required/.test(code) ? 409 : 400);
  const messages: Record<string, string> = {
    location_work_create_forbidden: "Only Dylan can create Location Work.",
    location_work_cancel_forbidden: "Only Dylan can cancel Location Work.",
    location_work_edit_forbidden: "Only Dylan can edit Location Work.",
    location_work_edit_after_start_forbidden: "Job details cannot be edited after a worker resolves a line.",
    location_work_retry_forbidden: "Only Dylan can retry Location Work email delivery.",
    location_work_complete_forbidden: "This Location Work job is not assigned to you.",
    location_work_source_refresh_required: "A selected Bloom Picker row changed or is no longer current. Refresh Drive Mode and select it again.",
    location_work_destination_refresh_required: "A destination is no longer eligible for that item and sales year. Refresh the destination list.",
    location_work_revision_conflict: "This Location Work job changed. Refresh it before trying again.",
    location_work_line_already_resolved: "That worksheet line was already resolved.",
    location_work_quantity_invalid: "Action Qty must be a positive whole number no greater than the selected row's On Hand.",
    location_work_actual_qty_invalid: "Enter a valid Actual Qty and confirm any amount above the planned quantity.",
    location_work_reason_required: "Enter a reason when work was not completed.",
    location_work_recipient_invalid: "Choose at least one active app user with a verified email address.",
    location_work_delivery_not_retryable: "That email is not currently eligible for retry.",
    location_work_job_not_found: "That Location Work job was not found.",
  };
  return errorResponse(messages[code] || "The Location Work request could not be completed.", status, { code });
}

async function resolveLocationWorkRecipients(values: unknown) {
  const profileIds = Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim()).filter(Boolean)));
  if (profileIds.length < 1 || profileIds.length > 50) throw new Error("location_work_recipient_invalid");
  const directory = await listActiveEmailProfiles();
  const byId = new Map(directory.map((entry) => [entry.profileId, entry]));
  const recipients = profileIds.map((id) => byId.get(id)).filter(Boolean) as Array<Record<string, unknown>>;
  if (recipients.length !== profileIds.length) throw new Error("location_work_recipient_invalid");
  return recipients;
}

async function loadLocationWorkJobs(actor: string, status = "active", jobId = "", includeDetails = false) {
  let query = supabase.from("ph_location_work_jobs").select([
    "id", "title", "general_instructions", "status", "revision", "line_count", "resolved_line_count",
    "assigned_usernames", "assignment_event_id", "completion_event_id", "created_by_username",
    "created_by_display", "created_at", "updated_at", "completed_by_username", "completed_at",
    "cancelled_by_username", "cancelled_at",
  ].join(",")).order("updated_at", { ascending: false }).limit(jobId ? 1 : 100);
  if (jobId) query = query.eq("id", jobId);
  else if (status === "active") query = query.in("status", ["open", "in_progress"]);
  else if (["open", "in_progress", "complete", "cancelled"].includes(status)) query = query.eq("status", status);
  if (actor !== LOCATION_WORK_CREATOR) query = query.contains("assigned_usernames", [actor]);
  const { data: jobs, error } = await query.returns<Record<string, unknown>[]>();
  if (error) throw error;
  const ids = (jobs || []).map((job) => String(job.id || "")).filter(Boolean);
  if (!ids.length) return [];

  const eventIds = (jobs || []).flatMap((job) => [job.assignment_event_id, job.completion_event_id]
    .map((value) => String(value || "")).filter(Boolean));
  const deliveryById = new Map<string, Record<string, unknown>>();
  if (eventIds.length) {
    const { data: deliveries, error: deliveryError } = await supabase.from("ph_request_delivery_outbox")
      .select("event_id,status,attempt_count,sanitized_error_code,delivered_at,updated_at")
      .in("event_id", eventIds);
    if (deliveryError) throw deliveryError;
    for (const delivery of deliveries || []) {
      deliveryById.set(String(delivery.event_id || ""), delivery as Record<string, unknown>);
    }
  }

  let linesByJob = new Map<string, Record<string, unknown>[]>();
  let assignmentsByJob = new Map<string, Record<string, unknown>[]>();
  if (includeDetails) {
    const [{ data: lines, error: linesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      supabase.from("ph_location_work_lines").select("*").in("job_id", ids).order("ordinal", { ascending: true }),
      supabase.from("ph_location_work_assignments")
        .select("job_id,profile_id,username,display_name").in("job_id", ids).order("display_name", { ascending: true }),
    ]);
    if (linesError) throw linesError;
    if (assignmentsError) throw assignmentsError;
    linesByJob = new Map();
    assignmentsByJob = new Map();
    for (const line of lines || []) {
      const key = String(line.job_id || "");
      const group = linesByJob.get(key) || [];
      group.push(line as Record<string, unknown>);
      linesByJob.set(key, group);
    }
    for (const assignment of assignments || []) {
      const key = String(assignment.job_id || "");
      const group = assignmentsByJob.get(key) || [];
      group.push(assignment as Record<string, unknown>);
      assignmentsByJob.set(key, group);
    }
  }
  return (jobs || []).map((job) => ({
    ...job,
    lines: linesByJob.get(String(job.id || "")) || [],
    assignments: assignmentsByJob.get(String(job.id || "")) || [],
    assignmentDelivery: deliveryById.get(String(job.assignment_event_id || "")) || null,
    completionDelivery: deliveryById.get(String(job.completion_event_id || "")) || null,
  }));
}

async function handleLocationWorkAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  const actorProfile = await resolveActiveSessionProfile(session).catch(() => null);
  if (!actorProfile) return errorResponse("An active, unlocked app profile is required.", 403, { code: "profile_not_active" });
  const actor = normalizeUsername(actorProfile.username);
  const operation = String(payload.operation || "list").trim().toLowerCase();
  try {
    if (operation === "recipient_options") {
      if (actor !== LOCATION_WORK_CREATOR) throw new Error("location_work_create_forbidden");
      const directory = await listActiveEmailProfiles();
      return jsonResponse({ ok: true, data: directory.map(({ profileId, username, display }) => ({ profileId, username, display })) });
    }
    if (operation === "list") {
      return jsonResponse({ ok: true, data: await loadLocationWorkJobs(actor, String(payload.status || "active").toLowerCase()) });
    }
    if (operation === "get") {
      const jobId = String(payload.jobId || "").trim();
      if (!jobId) throw new Error("location_work_job_not_found");
      const rows = await loadLocationWorkJobs(actor, "", jobId, true);
      if (!rows.length) return errorResponse("That Location Work job was not found.", 404, { code: "location_work_job_not_found" });
      return jsonResponse({ ok: true, data: rows[0] });
    }
    if (operation === "create") {
      if (actor !== LOCATION_WORK_CREATOR) throw new Error("location_work_create_forbidden");
      const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
      if (rawLines.length < 1 || rawLines.length > 500) throw new Error("location_work_payload_invalid");
      const lines = rawLines.map((value) => {
        const line = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const actionType = String(line.actionType || "").trim().toLowerCase();
        const plannedQty = Number(line.plannedQty);
        const destinationLocationcode = String(line.destinationLocationcode || "").trim();
        if (!String(line.sourceUniqueId || "").trim() || !LOCATION_WORK_ACTIONS.has(actionType)
          || !Number.isInteger(plannedQty) || plannedQty < 1
          || (actionType === "move" && !destinationLocationcode)
          || (actionType === "ta" && destinationLocationcode)) throw new Error("location_work_line_invalid");
        return {
          sourceUniqueId: String(line.sourceUniqueId || "").trim(),
          actionType,
          plannedQty,
          destinationLocationcode,
          destinationSalesYear: String(line.destinationSalesYear || "").trim(),
          inventoryConsolidation: line.inventoryConsolidation === true,
          instructions: String(line.instructions || "").trim().slice(0, 4000),
        };
      });
      const recipients = await resolveLocationWorkRecipients(payload.recipientProfileIds);
      const directory = await listActiveEmailProfiles();
      const completionRecipient = directory.find((entry) => entry.username === LOCATION_WORK_CREATOR);
      if (!completionRecipient) throw new Error("location_work_completion_recipient_invalid");
      const { data, error } = await supabase.rpc("create_location_work_job_v1", {
        p_payload: jsonValue({
          actorUsername: actor,
          idempotencyKey: String(payload.idempotencyKey || "").trim(),
          title: String(payload.title || "").trim(),
          generalInstructions: String(payload.generalInstructions || "").trim(),
          lines,
          recipients,
          completionRecipient,
        }),
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    }
    if (operation === "resolve_line") {
      const jobId = String(payload.jobId || "").trim();
      const lineId = String(payload.lineId || "").trim();
      const expectedRevision = Number(payload.expectedRevision);
      const resolutionStatus = String(payload.resolutionStatus || "").trim().toLowerCase();
      const actualQty = payload.actualQty === null || payload.actualQty === undefined || payload.actualQty === ""
        ? null : Number(payload.actualQty);
      if (!jobId || !lineId || !Number.isInteger(expectedRevision) || expectedRevision < 1
        || !["done", "not_completed"].includes(resolutionStatus)
        || (actualQty !== null && (!Number.isInteger(actualQty) || actualQty < 0))) {
        throw new Error("location_work_resolution_invalid");
      }
      const { data, error } = await supabase.rpc("resolve_location_work_line_v1", {
        p_job_id: jobId,
        p_line_id: lineId,
        p_actor_username: actor,
        p_expected_revision: expectedRevision,
        p_resolution_status: resolutionStatus,
        p_actual_qty: actualQty ?? undefined,
        p_not_completed_reason: String(payload.notCompletedReason || "").trim(),
        p_variance_confirmed: payload.varianceConfirmed === true,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    }
    if (operation === "edit") {
      if (actor !== LOCATION_WORK_CREATOR) throw new Error("location_work_edit_forbidden");
      const jobId = String(payload.jobId || "").trim();
      const expectedRevision = Number(payload.expectedRevision);
      const title = String(payload.title || "").trim();
      const generalInstructions = String(payload.generalInstructions || "").trim();
      if (!jobId || !Number.isInteger(expectedRevision) || expectedRevision < 1
        || !title || title.length > 240 || !generalInstructions || generalInstructions.length > 8000) {
        throw new Error("location_work_payload_invalid");
      }
      const { data, error } = await supabase.rpc("update_location_work_job_v1", {
        p_job_id: jobId,
        p_actor_username: actor,
        p_expected_revision: expectedRevision,
        p_title: title,
        p_general_instructions: generalInstructions,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    }
    if (["cancel", "retry"].includes(operation)) {
      if (actor !== LOCATION_WORK_CREATOR) throw new Error(`location_work_${operation}_forbidden`);
      const jobId = String(payload.jobId || "").trim();
      const expectedRevision = Number(payload.expectedRevision);
      if (!jobId || !Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error("location_work_revision_conflict");
      const result = operation === "cancel"
        ? await supabase.rpc("cancel_location_work_job_v1", { p_job_id: jobId, p_actor_username: actor, p_expected_revision: expectedRevision })
        : await supabase.rpc("retry_location_work_delivery_v1", { p_job_id: jobId, p_actor_username: actor,
          p_expected_revision: expectedRevision, p_delivery_kind: String(payload.deliveryKind || "assignment").trim().toLowerCase() });
      const { data, error } = result;
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    }
    return errorResponse("Unsupported Location Work operation.", 400, { code: "location_work_operation_invalid" });
  } catch (error) {
    return locationWorkError(error);
  }
}

const DOCK_TRIP_STATUS_VALUES = new Set(["Loading", "Missing > 10", "Missing < 5", "Palletize", "Complete"]);

function dockTripStatusError(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const raw = String(source.message || error || "dock_trip_request_failed");
  const code = (raw.match(/dock_trip_[a-z0-9_]+/i) || ["dock_trip_request_failed"])[0].toLowerCase();
  const status = code === "dock_trip_revision_conflict" ? 409
    : (/forbidden|not_active/.test(code) ? 403 : 400);
  const message = code === "dock_trip_revision_conflict"
    ? "This trip assignment changed. Refresh Docks before saving again."
    : code === "dock_trip_edit_forbidden"
    ? "Only an active Admin or QC Supervisor can update dock teams."
    : code === "dock_trip_view_forbidden"
    ? "Your profile does not have Docks access."
    : "The shared trip assignment could not be updated.";
  return errorResponse(message, status, { code });
}

async function handleDockTripStatusAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  try {
    const actorProfile = await resolveActiveSessionProfile(session);
    const role = String(session.role || "").trim();
    const actor = normalizeUsername(actorProfile.username || session.username || session.displayName || "");
    const normalizedRole = String(role || "").toUpperCase().replace(/\s+/g, "");
    const canView = FULL_ACCESS_USER_KEYS.has(actor)
      || normalizedRole.includes("ADMIN") || normalizedRole.includes("MANAGER")
      || normalizedRole === "REP" || normalizedRole === "SALES" || normalizedRole.includes("SALESREP")
      || normalizedRole.includes("CSR") || normalizedRole.startsWith("QC") || normalizedRole.includes("EVAL");
    if (!canView) throw new Error("dock_trip_view_forbidden");
    const operation = String(payload.operation || "list").trim().toLowerCase();
    if (operation === "list") {
      const { data, error } = await supabase
        .from("ph_dock_trip_status")
        .select("tripnumber,dock_num,checker,inspector,mistake,status,revision,updated_by_username,updated_at")
        .order("tripnumber", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return jsonResponse({ ok: true, data: data || [] });
    }
    if (operation !== "upsert") return errorResponse("Unsupported Dock trip operation.", 400, { code: "dock_trip_operation_invalid" });
    const canEdit = FULL_ACCESS_USER_KEYS.has(actor)
      || normalizedRole.includes("ADMIN") || normalizedRole.includes("MANAGER")
      || normalizedRole.includes("QCSUPERVISOR") || normalizedRole.includes("QCSUP");
    if (!canEdit) throw new Error("dock_trip_edit_forbidden");
    const tripnumber = String(payload.tripnumber || "").trim();
    const dockNum = String(payload.dockNum || "").trim();
    const checker = String(payload.checker || "").trim();
    const inspector = String(payload.inspector || "").trim();
    const mistake = String(payload.mistake || "").trim();
    const dockStatus = String(payload.status || "").trim();
    const expectedRevisionRaw = payload.expectedRevision;
    const expectedRevision = expectedRevisionRaw === null || expectedRevisionRaw === undefined || expectedRevisionRaw === ""
      ? null : Number(expectedRevisionRaw);
    if (!tripnumber || tripnumber.length > 80 || dockNum.length > 80
      || checker.length > 120 || inspector.length > 120 || mistake.length > 120
      || !DOCK_TRIP_STATUS_VALUES.has(dockStatus)
      || (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 0))) {
      throw new Error("dock_trip_payload_invalid");
    }
    const { data, error } = await supabase.rpc("save_dock_trip_status_v1", {
      p_tripnumber: tripnumber,
      p_dock_num: dockNum,
      p_checker: checker,
      p_inspector: inspector,
      p_mistake: mistake,
      p_status: dockStatus,
      p_actor_username: actor,
      p_expected_revision: expectedRevision ?? undefined,
    });
    if (error) throw error;
    const savedStatus = Array.isArray(data) ? data[0] : data;
    if (!savedStatus || typeof savedStatus !== "object") throw new Error("dock_trip_save_response_missing");
    return jsonResponse({ ok: true, data: savedStatus });
  } catch (error) {
    return dockTripStatusError(error);
  }
}

async function resolveEvalWorkAssignee(usernameValue: unknown) {
  const username = normalizeUsername(usernameValue);
  if (!username || !EVAL_WORK_ASSIGNABLE_USERS.has(username)) throw new Error("eval_work_assignee_not_allowed");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,username,display_name,disabled_at,locked_until")
    .eq("username", username)
    .maybeSingle();
  if (profileError) throw profileError;
  const lockedUntil = Date.parse(String(profile?.locked_until || ""));
  if (!profile?.id || profile.disabled_at || (Number.isFinite(lockedUntil) && lockedUntil > Date.now())) {
    throw new Error("eval_work_assignee_not_active");
  }
  if (!await isAppAccountActive(supabase, { id: String(profile.id) })) throw new Error("eval_work_assignee_not_active");
  const { data: authUser, error: authUserError } = await supabase.auth.admin.getUserById(String(profile.id));
  if (authUserError) throw authUserError;
  const email = String(authUser?.user?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("eval_work_assignee_email_unavailable");
  return {
    username: normalizeUsername(profile.username),
    display: String(profile.display_name || profile.username || username).trim(),
    email,
  };
}

async function resolveEvalWorkAssignees(usernameValues: unknown) {
  const raw = Array.isArray(usernameValues) ? usernameValues : [usernameValues];
  const usernames = Array.from(new Set(raw.map(normalizeUsername).filter(Boolean)));
  if (usernames.length < 1 || usernames.length > 20) throw new Error("eval_work_assignees_invalid");
  const assignees = [];
  for (const username of usernames) assignees.push(await resolveEvalWorkAssignee(username));
  return assignees;
}

function getEvalWorkAssigneeUsernames(row: Record<string, unknown> | null | undefined) {
  const stored = Array.isArray(row?.assignee_usernames) ? row?.assignee_usernames as unknown[] : [];
  return Array.from(new Set([
    ...stored.map(normalizeUsername),
    normalizeUsername(row?.assignee_username),
  ].filter(Boolean)));
}

function isEvalWorkAssignedTo(row: Record<string, unknown> | null | undefined, username: string) {
  const actor = normalizeUsername(username);
  return !!actor && getEvalWorkAssigneeUsernames(row).includes(actor);
}

function normalizeEvalWorkEvidence(workId: string, evidenceValue: unknown, originUid = "") {
  const evidence = evidenceValue && typeof evidenceValue === "object"
    ? { ...(evidenceValue as Record<string, unknown>) }
    : {};
  const prefix = originUid ? `eval/${workId}/${originUid}/` : `eval/${workId}/`;
  const photos = Array.isArray(evidence.photos) ? evidence.photos : [];
  evidence.photos = photos.map((photoValue) => {
    const photo = photoValue && typeof photoValue === "object" ? photoValue as Record<string, unknown> : {};
    const filePath = String(photo.filePath || photo.file_path || photo.path || "").replace(/^\/+/, "").trim();
    if (!filePath.startsWith(prefix) || filePath.includes("..")) throw new Error("eval_work_photo_scope_invalid");
    const publicUrlData = supabase.storage.from("request_photos").getPublicUrl(filePath);
    const url = String(publicUrlData.data.publicUrl || "").trim();
    if (!url) throw new Error("eval_work_photo_url_unavailable");
    return {
      filePath,
      url,
      name: String(photo.name || filePath.split("/").pop() || "eval-photo").trim().slice(0, 160),
    };
  });
  return evidence;
}

function evalWorkV1Origin(row: Record<string, unknown>) {
  return {
    eval_work_id: row.id,
    origin_unique_id: row.origin_unique_id,
    itemcode: row.itemcode,
    locationcode: row.origin_locationcode,
    lotcode: row.origin_lotcode,
    source: row.origin_source,
    block_alpha: "",
    block_number: "",
    ordinal: 1,
    origin_snapshot: row.origin_snapshot,
    evidence_draft: row.evidence_draft,
    submitted_evidence: row.submitted_evidence,
  };
}

async function withEvalWorkOrigins(rows: Record<string, unknown>[]): Promise<Array<Record<string, unknown> & { origins: Record<string, unknown>[] }>> {
  const v2Ids = rows.filter((row) => String(row.contract_version || "") === "eval-work-v2-multi-origin")
    .map((row) => String(row.id || "")).filter(Boolean);
  let byWork = new Map<string, Record<string, unknown>[]>();
  if (v2Ids.length) {
    const { data, error } = await supabase.from("ph_eval_work_origin_rows").select("*")
      .in("eval_work_id", v2Ids).order("ordinal", { ascending: true });
    if (error) throw error;
    byWork = (data || []).reduce((map, origin) => {
      const key = String(origin.eval_work_id || "");
      const list = map.get(key) || [];
      list.push(origin as Record<string, unknown>);
      map.set(key, list);
      return map;
    }, new Map<string, Record<string, unknown>[]>());
  }
  return rows.map((row) => ({
    ...row,
    origins: String(row.contract_version || "") === "eval-work-v2-multi-origin"
      ? (byWork.get(String(row.id || "")) || [])
      : [evalWorkV1Origin(row)],
  }));
}

function evalReviewSource(payload: Record<string, unknown>) {
  const source = payload.source && typeof payload.source === "object" ? payload.source as Record<string, unknown> : {};
  return {
    unique_id: String(source.unique_id || "").trim(),
    source_table: String(source.source_table || "ph_master_inventory").trim(),
    itemcode: String(source.itemcode || "").trim(),
    locationcode: String(source.locationcode || "").trim(),
    lotcode: String(source.lotcode || "").trim(),
  };
}

function evalWorkError(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(source.code || "").trim();
  const message = String(source.message || error || "eval_work_failed").trim();
  if (/RECLASS_V6_/i.test(message)) return driveReclassErrorResponse(message);
  if (/EVAL_WORK_V6_COMPLETION_OUTBOX_MISSING/i.test(message)) {
    return errorResponse("Eval Work delivery is unavailable. No live edit was committed; retry with the same submission.", 503, { code: "EVAL_WORK_DELIVERY_UNAVAILABLE" });
  }
  const reviewCode = (message.match(/\bREVIEW_[A-Z_]+\b/i) || [""])[0].toUpperCase();
  const reviewMessages: Record<string, string> = {
    REVIEW_SOURCE_MISSING: "The opening inventory row is no longer available. Close this review and reopen the current row.",
    REVIEW_SOURCE_STALE: "The opening row changed. Close this review and reopen the current inventory row.",
    REVIEW_ASSIGNMENT_MISSING: "This row has no AssignedTo evaluator. Have a manager update its assignment, then retry.",
    REVIEW_ASSIGNMENT_AMBIGUOUS: "This row has more than one matching assignment. Have a manager resolve its AssignedTo assignment before sending.",
    REVIEW_ASSIGNEE_INELIGIBLE: "The AssignedTo user is not eligible for Eval Work. Have a manager correct the assignment.",
    REVIEW_ASSIGNEE_INACTIVE: "The AssignedTo user is inactive, locked, or unavailable. Have a manager review that profile.",
    REVIEW_ASSIGNEE_EMAIL_MISSING: "The AssignedTo user needs a usable email address before this review can be sent.",
    REVIEW_ASSIGNMENT_CHANGED: "AssignedTo changed since this review was opened. Review the updated evaluator and confirm again; your instructions and additional recipients are retained.",
    REVIEW_CONFIRMATION_REQUIRED: "Refresh the AssignedTo evaluator and confirm this review again before sending.",
    REVIEW_RECIPIENT_INVALID: "An additional completion recipient is inactive, locked, or has no usable email. Review the additional recipients and retry.",
  };
  if (reviewCode && reviewMessages[reviewCode]) {
    const status = /ASSIGNMENT_CHANGED|CONFIRMATION_REQUIRED|SOURCE_STALE/.test(reviewCode) ? 409 : 400;
    return errorResponse(reviewMessages[reviewCode], status, { code: reviewCode });
  }
  const safeCode = (message.match(/eval_(?:work|report2)_[a-z0-9_]+/i) || [code || "eval_work_failed"])[0].toLowerCase();
  const status = code === "42501" || /forbidden|not_authorized/.test(safeCode)
    ? 403
    : ((code === "40001" || code === "PT409") || /conflict/.test(safeCode) ? 409 : 400);
  const safeMessages: Record<string, string> = {
    eval_work_assignment_scope_conflict: "The current AssignedTo value no longer matches the selected user filter. Refresh the report and review that selection.",
    eval_work_assignee_email_invalid: "One selected evaluator does not have a verified email address.",
    eval_work_assignee_email_unavailable: "One selected evaluator does not have a verified email address.",
    eval_work_assignee_not_active: "One selected evaluator is disabled, locked, or unavailable.",
    eval_work_batch_create_forbidden: "Only Dylan, Megan, or JD can create Eval Reports #2 work.",
    eval_work_itemcode_membership_empty: "No current inventory rows remain for this ITEMCODE. Refresh the report.",
    eval_work_required_manager_recipient_unavailable: "A required Dylan or Megan assignment recipient is unavailable. Review the user profile before retrying.",
    eval_work_required_assignment_recipient_unavailable: "A required assignment recipient is unavailable. Review the user profile before retrying.",
    eval_work_report2_completion_recipient_unavailable: "A required completion recipient is unavailable. Review the user profile before retrying.",
    eval_report2_report_invalid: "The selected report is no longer available. Refresh Eval Reports #2.",
    eval_report2_source_invalid: "This selection did not come from the current Eval Reports #2 view. Refresh and select it again.",
    eval_report2_page_invalid: "The report page request was invalid. Refresh Eval Reports #2.",
    eval_work_batch_size_invalid: "Choose from 1 through 50 ITEMCODEs at a time.",
    eval_work_batch_invalid: "The Eval Work selection changed before it could be saved. Refresh and retry.",
    eval_work_create_token_assignees_conflict: "This retry used a different evaluator list. Refresh the existing assignment instead.",
  };
  const safeMessage = safeMessages[safeCode] || "Eval Work request could not be completed. Retry after refreshing the report.";
  return errorResponse(safeMessage, status, { code: safeCode });
}

async function loadAuthorizedEvalWork(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  workId: string,
) {
  const actor = normalizeUsername(session?.username || session?.displayName || "");
  if (!actor || !workId) return null;
  const query = supabase.from("ph_eval_work").select("*").eq("id", workId).maybeSingle();
  const { data, error } = await query;
  if (error) throw error;
  if (!data) return null;
  if (!isEvalWorkManager(session) && !isEvalWorkAssignedTo(data as Record<string, unknown>, actor)) return null;
  return data as Record<string, unknown>;
}

async function withEvalWorkDeliveryStatus(row: Record<string, unknown>) {
  const eventIds = [row.assignment_event_id, row.completion_event_id].map((value) => String(value || "").trim()).filter(Boolean);
  if (!eventIds.length) return { ...row, delivery: {} };
  const { data, error } = await supabase
    .from("ph_request_delivery_outbox")
    .select("event_id,event_type,status,attempt_count,sanitized_error_code,delivered_at,updated_at")
    .in("event_id", eventIds);
  if (error) throw error;
  const delivery: Record<string, unknown> = {};
  for (const event of data || []) {
    const key = event.event_type === "eval_work_completion" ? "completion" : "assignment";
    delivery[key] = event;
  }
  return { ...row, delivery };
}

async function withEvalWorkDeliveryStatuses(rows: Record<string, unknown>[]) {
  const eventIds = rows.flatMap((row) => [row.assignment_event_id, row.completion_event_id])
    .map((value) => String(value || "").trim()).filter(Boolean);
  if (!eventIds.length) return rows.map((row) => ({ ...row, delivery: {} }));
  const { data, error } = await supabase.from("ph_request_delivery_outbox")
    .select("event_id,event_type,status,attempt_count,sanitized_error_code,delivered_at,updated_at")
    .in("event_id", Array.from(new Set(eventIds)));
  if (error) throw error;
  const byId = new Map((data || []).map((event) => [String(event.event_id || ""), event]));
  return rows.map((row) => {
    const delivery: Record<string, unknown> = {};
    const assignment = byId.get(String(row.assignment_event_id || ""));
    const completion = byId.get(String(row.completion_event_id || ""));
    if (assignment) delivery.assignment = assignment;
    if (completion) delivery.completion = completion;
    return { ...row, delivery };
  });
}

const EVAL_WORK_TEMPORARY_ROW_FIELD_LIMITS: Record<string, number> = {
  holdstopreason: 1000,
  holdstopbegindate: 180,
  locationnote: 4000,
  locationnotedate: 180,
  locationptn1: 2000,
  suspendto: 1000,
  specialpuller: 1000,
};

function normalizeEvalWorkBatchInquiry(value: unknown) {
  const inquiry = value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  const rawOverlays = Array.isArray(inquiry.rowOverlays) ? inquiry.rowOverlays : [];
  inquiry.rowOverlays = rawOverlays.map((rawOverlay) => {
    const overlay = rawOverlay && typeof rawOverlay === "object" && !Array.isArray(rawOverlay)
      ? { ...(rawOverlay as Record<string, unknown>) }
      : {};
    const hasValues = Object.prototype.hasOwnProperty.call(overlay, "temporaryValues");
    const hasFields = Object.prototype.hasOwnProperty.call(overlay, "temporaryChangedFields");
    if (!hasValues && !hasFields) return overlay;
    const rawValues = overlay.temporaryValues;
    const rawFields = overlay.temporaryChangedFields;
    if (!hasValues || !hasFields || !rawValues || typeof rawValues !== "object" || Array.isArray(rawValues) || !Array.isArray(rawFields)) {
      throw new Error("eval_work_batch_temporary_fields_invalid");
    }
    const normalizedValues: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(rawValues as Record<string, unknown>)) {
      const key = String(rawKey || "").trim().toLowerCase();
      const limit = EVAL_WORK_TEMPORARY_ROW_FIELD_LIMITS[key];
      if (!limit || key !== rawKey || Object.prototype.hasOwnProperty.call(normalizedValues, key)) {
        throw new Error("eval_work_batch_temporary_field_invalid");
      }
      let text = String(rawValue == null ? "" : rawValue);
      if (key === "holdstopreason") text = text.trim().toLowerCase();
      if (text.length > limit) throw new Error("eval_work_batch_temporary_value_too_long");
      normalizedValues[key] = text;
    }
    const normalizedFields = rawFields.map((field) => String(field || "").trim().toLowerCase());
    if (new Set(normalizedFields).size !== normalizedFields.length
      || Object.keys(normalizedValues).sort().join("|") !== normalizedFields.slice().sort().join("|")) {
      throw new Error("eval_work_batch_temporary_fields_mismatch");
    }
    overlay.temporaryValues = normalizedValues;
    overlay.temporaryChangedFields = normalizedFields;
    return overlay;
  });
  return inquiry;
}

async function handleEvalWorkAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  canonicalAccess: CanonicalUserAccess | null = null,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  const actor = normalizeUsername(session.username || session.displayName || "");
  if (!actor) return errorResponse("Authenticated user identity is required.", 403);
  const activeProfile = await resolveActiveSessionProfile(session).catch(() => null);
  if (!activeProfile) return errorResponse("An active, unlocked app profile is required.", 403, { code: "PROFILE_NOT_ACTIVE" });
  const operation = String(payload.operation || "list").trim().toLowerCase();
  try {
    if (operation === "report_page") {
      const resolvedAccess = canonicalAccess || await resolveCanonicalUserAccess(supabase, String(activeProfile.id || ""));
      if (resolvedAccess.permissions.can_access_eval_reports_2 !== true) return errorResponse("Eval Reports #2 access is not enabled for this profile.", 403, { code: "eval_report2_view_forbidden" });
      const reportId = String(payload.reportId || "").trim().toLowerCase();
      const cursorItemcode = String(payload.cursorItemcode || "").trim().toUpperCase();
      const limit = Math.min(50, Math.max(1, Number(payload.limit) || 25));
      const { data, error } = await supabase.rpc("list_eval_report2_itemcodes_v1", { p_payload: {
        actorUsername: actor,
        reportId,
        cursorItemcode,
        limit,
      } });
      if (error) throw error;
      return jsonResponse({ ok: true, data, manager: true });
    }
    if (operation === "list") {
      let query = supabase.from("ph_eval_work").select("*").order("updated_at", { ascending: false }).limit(500);
      if (!isEvalWorkManager(session)) query = query.contains("assignee_usernames", [actor]);
      const status = String(payload.status || "").trim().toLowerCase();
      if (["open", "in_progress", "submitted", "cancelled", "resolved_import"].includes(status)) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      const withDelivery = await withEvalWorkDeliveryStatuses((data || []) as Record<string, unknown>[]);
      return jsonResponse({ ok: true, data: await withEvalWorkOrigins(withDelivery), manager: isEvalWorkManager(session) });
    }
    if (operation === "get") {
      const row = await loadAuthorizedEvalWork(session, String(payload.workId || "").trim());
      if (!row) return errorResponse("Eval Work assignment was not found.", 404, { code: "eval_work_not_found" });
      const withDelivery = await withEvalWorkDeliveryStatus(row);
      return jsonResponse({ ok: true, data: (await withEvalWorkOrigins([withDelivery]))[0], manager: isEvalWorkManager(session) });
    }
    if (operation === "review_setup") {
      if (!isEvalWorkManager(session)) return errorResponse("Only Eval Work managers can create assignments.", 403, { code: "eval_work_create_forbidden" });
      const source = evalReviewSource(payload);
      const { data, error } = await supabase.rpc("get_eval_work_review_setup_v1", { p_payload: {
        actorUsername: actor,
        source,
      } });
      if (error) throw error;
      return jsonResponse({ ok: true, setup: data });
    }
    if (operation === "create") {
      if (!isEvalWorkManager(session)) return errorResponse("Only Eval Work managers can create assignments.", 403, { code: "eval_work_create_forbidden" });
      // Sep 9 clients send manual assignees and completion recipients. Any modern
      // contract field keeps its existing confirmation path, including blank revisions.
      const hasField = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);
      const legacyCreate = !hasField("expectedAssignmentRevision") && !hasField("additionalCompletionRecipients")
        && (hasField("assigneeUsernames") || hasField("assigneeUsername")) && Array.isArray(payload.completionRecipients);
      if (legacyCreate) {
        const assignees = await resolveEvalWorkAssignees(payload.assigneeUsernames || payload.assigneeUsername);
        const assignee = assignees[0];
        const source = payload.source && typeof payload.source === "object" ? payload.source as Record<string, unknown> : {};
        const rpcPayload = {
          actorUsername: actor,
          createToken: String(payload.createToken || "").trim(),
          assigneeUsername: assignee.username,
          assigneeEmail: assignee.email,
          assignees,
          instructions: String(payload.instructions || "").trim(),
          completionRecipients: Array.isArray(payload.completionRecipients) ? payload.completionRecipients : [],
          source,
          inquiry: payload.inquiry && typeof payload.inquiry === "object" ? payload.inquiry : undefined,
        };
        const { data, error } = await supabase.rpc("create_eval_work_legacy_sep09_v1", { p_payload: jsonValue(rpcPayload) });
        if (error) throw error;
        return jsonResponse({ ok: true, data: await withEvalWorkDeliveryStatus(data as Record<string, unknown>) });
      }
      const source = evalReviewSource(payload);
      // Resolve source AssignedTo and freeze recipients inside the creation transaction.
      // Do not resolve today's assignment here: an idempotent replay must return its original work first.
      const rpcPayload = {
        actorUsername: actor,
        createToken: String(payload.createToken || "").trim(),
        expectedAssignmentRevision: String(payload.expectedAssignmentRevision || "").trim(),
        instructions: String(payload.instructions || "").trim(),
        additionalCompletionRecipients: Array.isArray(payload.additionalCompletionRecipients) ? payload.additionalCompletionRecipients : [],
        source,
        inquiry: payload.inquiry && typeof payload.inquiry === "object" ? payload.inquiry : undefined,
      };
      const { data, error } = await supabase.rpc("create_eval_work_multi_v1", { p_payload: jsonValue(rpcPayload) });
      if (error) throw error;
      return jsonResponse({ ok: true, data: await withEvalWorkDeliveryStatus(data as Record<string, unknown>) });
    }
    if (operation === "create_batch") {
      if (!isEvalWorkManager(session)) return errorResponse("Only Eval Work managers can create assignments.", 403, { code: "eval_work_batch_create_forbidden" });
      const assignees = await resolveEvalWorkAssignees(payload.assigneeUsernames || payload.assigneeUsername);
      const assignee = assignees[0];
      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      if (rawItems.length < 1 || rawItems.length > 50) return errorResponse("Choose from 1 through 50 ITEMCODEs.", 400, { code: "eval_work_batch_size_invalid" });
      const items = rawItems.map((rawItem) => {
        const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
        const sourceInput = item.source && typeof item.source === "object" ? item.source as Record<string, unknown> : {};
        const contextInput = item.reportContext && typeof item.reportContext === "object" ? item.reportContext as Record<string, unknown> : {};
        const assignedToUsers = Array.from(new Set(
          (Array.isArray(contextInput.assignedToUsers) ? contextInput.assignedToUsers : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        )).slice(0, 100);
        const selectedUserFilters = Array.from(new Set(
          (Array.isArray(contextInput.selectedUserFilters) ? contextInput.selectedUserFilters : assignedToUsers)
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        )).slice(0, 100);
        const matchedAssignedToUsers = Array.from(new Set(
          (Array.isArray(contextInput.matchedAssignedToUsers) ? contextInput.matchedAssignedToUsers : assignedToUsers)
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        )).slice(0, 100);
        const source = {
          unique_id: String(sourceInput.unique_id || "").trim(),
          source_table: "ph_master_inventory",
          itemcode: String(sourceInput.itemcode || "").trim(),
          locationcode: String(sourceInput.locationcode || "").trim(),
          lotcode: String(sourceInput.lotcode || "").trim(),
        };
        const rawOrigins = Array.isArray(item.origins) ? item.origins : [];
        const origins = rawOrigins.map((value) => {
          const origin = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return {
            unique_id: String(origin.unique_id || "").trim(),
            itemcode: String(origin.itemcode || source.itemcode || "").trim(),
            locationcode: String(origin.locationcode || "").trim(),
            lotcode: String(origin.lotcode || "").trim(),
            source: String(origin.source || "").trim(),
          };
        });
        const itemcode = String(item.itemcode || source.itemcode || origins[0]?.itemcode || "").trim();
        if (!itemcode) throw new Error("eval_work_batch_itemcode_invalid");
        return {
          createToken: String(item.createToken || "").trim(),
          scopeContract: "itemcode-all-rows-v1",
          source,
          itemcode,
          origins,
          inquiry: normalizeEvalWorkBatchInquiry(item.inquiry),
          reportContext: {
            reportId: String(contextInput.reportId || "").trim().slice(0, 100),
            ...(Array.isArray(contextInput.reportIds) ? { reportIds: contextInput.reportIds.map((value: unknown) => String(value || "").trim().toLowerCase()).slice(0, 12) } : {}),
            reportLabel: String(contextInput.reportLabel || "").trim().slice(0, 200),
            sourceMode: String(contextInput.sourceMode || "").trim().toLowerCase().slice(0, 40),
            assignedTo: String(contextInput.assignedTo || "").trim().slice(0, 200),
            assignedToUsers,
            selectedUserFilters,
            matchedAssignedToUsers,
            browseMode: String(contextInput.browseMode || "").trim().slice(0, 40),
          },
        };
      });
      const rpcPayload = {
        actorUsername: actor,
        batchToken: String(payload.batchToken || "").trim(),
        assigneeUsername: assignee.username,
        assigneeEmail: assignee.email,
        assignees,
        instructions: String(payload.instructions || "").trim().slice(0, 4000),
        completionRecipients: Array.isArray(payload.completionRecipients) ? payload.completionRecipients : [],
        inventorySignature: String(payload.inventorySignature || "").trim().slice(0, 512),
        settingsSignature: String(payload.settingsSignature || "").trim().slice(0, 1024),
        items,
      };
      const report2ItemCount = items.filter((item) => item.reportContext.sourceMode === "eval-report-2").length;
      if (report2ItemCount > 0 && report2ItemCount !== items.length) {
        return errorResponse("Drive Mode and Eval Reports #2 selections cannot be mixed in one batch.", 400, { code: "eval_work_batch_source_mixed" });
      }
      const rpcName = report2ItemCount === items.length
        ? "create_eval_report2_batch_v1"
        : "create_eval_work_batch_multi_v2";
      const { data, error } = await supabase.rpc(rpcName, { p_payload: jsonValue(rpcPayload) });
      if (error) throw error;
      const report2Result = report2ItemCount === items.length && data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      const rows = (report2Result ? report2Result.rows : data || []) as Record<string, unknown>[];
      const assignmentRefreshed = rows.some((row) => {
        const context = row.source_context && typeof row.source_context === "object"
          ? row.source_context as Record<string, unknown> : {};
        return context.assignmentRefreshed === true;
      });
      const withDelivery = await withEvalWorkDeliveryStatuses(rows);
      return jsonResponse({
        ok: true,
        data: await withEvalWorkOrigins(withDelivery),
        manager: true,
        assignmentRefreshed: report2Result?.assignmentRefreshed === true || assignmentRefreshed,
        result: String(report2Result?.result || "created"),
        resolvedItemcodes: Array.isArray(report2Result?.resolvedItemcodes) ? report2Result?.resolvedItemcodes : [],
      });
    }
    if (operation === "save" || operation === "submit") {
      const workId = String(payload.workId || "").trim();
      const rawRow = await loadAuthorizedEvalWork(session, workId);
      const row = rawRow ? (await withEvalWorkOrigins([rawRow]))[0] : null;
      if (!row || !isEvalWorkAssignedTo(row, actor)) {
        return errorResponse("Only an assigned evaluator can update this work.", 403, { code: "eval_work_edit_forbidden" });
      }
      const isV2 = String(row.contract_version || "") === "eval-work-v2-multi-origin";
      let evidence: Record<string, unknown> = {};
      if (isV2) {
        const input = payload.evidenceByOrigin && typeof payload.evidenceByOrigin === "object"
          ? payload.evidenceByOrigin as Record<string, unknown> : {};
        for (const origin of Array.isArray(row.origins) ? row.origins as Record<string, unknown>[] : []) {
          const originUid = String(origin.origin_unique_id || "").trim();
          if (originUid) evidence[originUid] = normalizeEvalWorkEvidence(workId, input[originUid], originUid);
        }
      } else {
        evidence = normalizeEvalWorkEvidence(workId, payload.evidence && typeof payload.evidence === "object" ? payload.evidence : {});
      }
      const args = {
        p_work_id: workId,
        p_actor_username: actor,
        p_expected_version: Number(payload.expectedVersion),
        p_inquiry: jsonValue(payload.inquiry && typeof payload.inquiry === "object" ? payload.inquiry : row.inquiry_draft ?? {}),
      };
      const result = isV2
        ? operation === "submit"
          ? await supabase.rpc("submit_eval_work_v2", { ...args, p_evidence_by_origin: jsonValue(evidence), p_submission_token: String(payload.submissionToken || "").trim() })
          : await supabase.rpc("save_eval_work_v2", { ...args, p_evidence_by_origin: jsonValue(evidence) })
        : operation === "submit"
          ? await supabase.rpc("submit_eval_work_v1", { ...args, p_evidence: jsonValue(evidence), p_submission_token: String(payload.submissionToken || "").trim() })
          : await supabase.rpc("save_eval_work_v1", { ...args, p_evidence: jsonValue(evidence) });
      const { data, error } = result;
      if (error) throw error;
      const withDelivery = await withEvalWorkDeliveryStatus(data as Record<string, unknown>);
      return jsonResponse({ ok: true, data: (await withEvalWorkOrigins([withDelivery]))[0] });
    }
    if (operation === "reassign") {
      if (!isEvalWorkManager(session)) return errorResponse("Forbidden", 403, { code: "eval_work_manage_forbidden" });
      const assignees = await resolveEvalWorkAssignees(payload.assigneeUsernames || payload.assigneeUsername);
      const { data, error } = await supabase.rpc("reassign_eval_work_v2", { p_payload: {
        workId: String(payload.workId || "").trim(),
        actorUsername: actor,
        expectedVersion: Number(payload.expectedVersion),
        assignees,
      } });
      if (error) throw error;
      return jsonResponse({ ok: true, data: await withEvalWorkDeliveryStatus(data as Record<string, unknown>) });
    }
    if (operation === "cancel") {
      if (!isEvalWorkManager(session)) return errorResponse("Forbidden", 403, { code: "eval_work_manage_forbidden" });
      const { data, error } = await supabase.rpc("cancel_eval_work_v1", {
        p_work_id: String(payload.workId || "").trim(),
        p_actor_username: actor,
        p_expected_version: Number(payload.expectedVersion),
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    }
    if (operation === "remove_photo") {
      const workId = String(payload.workId || "").trim();
      const rawRow = await loadAuthorizedEvalWork(session, workId);
      const row = rawRow ? (await withEvalWorkOrigins([rawRow]))[0] : null;
      if (!row || !isEvalWorkAssignedTo(row, actor) || !["open", "in_progress"].includes(String(row.status || ""))) {
        return errorResponse("Only an assigned evaluator can remove an open Eval photo.", 403, { code: "eval_work_photo_forbidden" });
      }
      const filePath = String(payload.filePath || "").replace(/^\/+/, "");
      const originUid = String(payload.originUid || row.origin_unique_id || "").trim();
      const isV2 = String(row.contract_version || "") === "eval-work-v2-multi-origin";
      if (isV2 && !(Array.isArray(row.origins) && (row.origins as Record<string, unknown>[])
        .some((origin) => String(origin.origin_unique_id || "") === originUid))) {
        return errorResponse("Invalid Eval origin.", 400, { code: "eval_work_photo_origin_invalid" });
      }
      const requiredPrefix = isV2 ? `eval/${workId}/${originUid}/` : `eval/${workId}/`;
      if (!filePath.startsWith(requiredPrefix) || filePath.includes("..")) return errorResponse("Invalid Eval photo path.", 400);
      const { error } = await supabase.storage.from("request_photos").remove([filePath]);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }
    return errorResponse("Unsupported Eval Work operation.", 400);
  } catch (error) {
    recordHandledError("app-api", `eval_work_${operation}`, error, 500);
    return evalWorkError(error);
  }
}

function compareLocationCodeNatural(leftValue: unknown, rightValue: unknown): number {
  const parse = (value: unknown) => {
    const raw = String(value || "").trim().toUpperCase();
    const match = raw.match(/^([A-Z]+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/);
    return match
      ? { raw, block: match[1] || "", parts: [match[2], match[3], match[4]].filter((part): part is string => part !== undefined).map(Number) }
      : { raw, block: raw, parts: [] as number[] };
  };
  const left = parse(leftValue);
  const right = parse(rightValue);
  const blockCompare = left.block.localeCompare(right.block, "en-US", { numeric: true, sensitivity: "base" });
  if (blockCompare) return blockCompare;
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index += 1) {
    const leftPart = Number.isFinite(left.parts[index]) ? left.parts[index] : -1;
    const rightPart = Number.isFinite(right.parts[index]) ? right.parts[index] : -1;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return left.raw.localeCompare(right.raw, "en-US", { numeric: true, sensitivity: "base" });
}

function sortManagerEval2PreviewRows(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const response = { ...(value as Record<string, unknown>) };
  if (!Array.isArray(response.rows)) return response;
  const compare = (left: Record<string, unknown>, right: Record<string, unknown>) => {
    const natural = (first: unknown, second: unknown) => String(first || "").localeCompare(String(second || ""), "en-US", { numeric: true, sensitivity: "base" });
    return compareLocationCodeNatural(left.locationcode ?? left.LOCATIONCODE, right.locationcode ?? right.LOCATIONCODE)
      || natural(left.lotcode ?? left.LOTCODE, right.lotcode ?? right.LOTCODE)
      || natural(left.unique_id ?? left.UNIQUE_ID, right.unique_id ?? right.UNIQUE_ID);
  };
  response.rows = response.rows.map((rawGroup) => {
    if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup)) return rawGroup;
    const group = { ...(rawGroup as Record<string, unknown>) };
    if (Array.isArray(group.previewRows)) {
      group.previewRows = group.previewRows
        .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
        .slice()
        .sort(compare);
      group.previewHasMore = false;
    }
    return group;
  });
  return response;
}

export async function handleManagerReportReadAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  canonicalAccess: CanonicalUserAccess | null = null,
  verifiedActor: Record<string, unknown> | null = null,
) {
  if (!session) return errorResponse("Authentication required.", 401, { code: "AUTH_REQUIRED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  // The request gate already verified this actor. Reuse that request-local
  // result instead of adding two serial profile/account reads to first paint.
  const profile = verifiedActor || await resolveActiveSessionProfile(session).catch(() => null);
  const actor = normalizeUsername(String(profile?.username || ""));
  if (!actor || !profile) return errorResponse("An active, unlocked app profile is required.", 403, { code: "PROFILE_NOT_ACTIVE" });
  const query = payload.query && typeof payload.query === "object" && !Array.isArray(payload.query)
    ? payload.query as Record<string, unknown> : null;
  const operation = String(query?.operation || payload.operation || "").trim().toLowerCase();
  if (operation === "capabilities") {
    const canViewEval1 = FULL_ACCESS_USER_KEYS.has(actor);
    const canViewInventoryManager = hasTableReadAccess(String(session.role || ""), "ph_master_inventory", actor);
    const canViewApproval = INVENTORY_NCR_FIRST_STAGE_USERS.has(actor) || INVENTORY_NCR_JD_STAGE_USERS.has(actor);
    const roleCanReadInventory = hasTableReadAccess(String(session.role || ""), "ph_master_inventory", actor);
    try {
      const access = canonicalAccess || await resolveCanonicalUserAccess(supabase, String(profile.id || ""));
      const canViewEval2 = access.permissions.can_access_eval_reports_2 === true;
      const { data, error } = await supabase.rpc("manager_report_read_v2", { p_payload: {
        actorUsername: actor, operation: "capabilities",
      } });
      const capabilityData = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      if (error || capabilityData.ok !== true) throw error || new Error("MANAGER_REPORT_CAPABILITIES_UNAVAILABLE");
      const backendSurfaces = new Set(Array.isArray(capabilityData.surfaces) ? capabilityData.surfaces.map(String) : []);
      const surfaces = [
        ...(canViewEval1 && backendSurfaces.has("eval1") ? ["eval1"] : []),
        ...(canViewEval2 && backendSurfaces.has("eval2") ? ["eval2"] : []),
        ...(roleCanReadInventory && backendSurfaces.has("ncr") ? ["ncr"] : []),
        ...(canViewInventoryManager && backendSurfaces.has("assigned-items") ? ["assigned-items"] : []),
        ...(canViewInventoryManager && backendSurfaces.has("season-priority") ? ["season-priority"] : []),
        ...(canViewApproval && backendSurfaces.has("approval") ? ["approval"] : []),
      ];
      const approvalTabs = canViewApproval && backendSurfaces.has("approval") ? [
        "ncr-approvals", "move-up-approvals", "move-down-approvals",
        "hold-release-approvals", "recount-approvals", "not-on-inventory-approvals",
      ] : [];
      return jsonResponse({ ok: true, data: { version: "manager-report-read-v2", surfaces,
        approvalTabs, operations: ["groups", "rows", "metadata", "detail"] } });
    } catch {
      return jsonResponse({ ok: true, data: { version: "manager-report-read-v2", surfaces: [],
        approvalTabs: [], operations: [] } });
    }
  }
  if (!query || Object.keys(payload).some((key) => !["action", "operation", "query"].includes(key))) {
    return errorResponse("Invalid report read request.", 400, { code: "MANAGER_REPORT_QUERY_INVALID" });
  }
  const surface = String(query.surface || "").trim().toLowerCase();
  if (surface === "assigned-items" || surface === "season-priority") {
    if (!hasTableReadAccess(String(session.role || ""), "ph_master_inventory", actor)) {
      return errorResponse("Forbidden", 403, { code: "MANAGER_REPORT_FORBIDDEN" });
    }
    const allowed = new Set(["surface", "operation", "filters", "offset", "limit", "sourceRevision"]);
    if (Object.keys(query).some((key) => !allowed.has(key))) return errorResponse("Invalid report read query.", 400, { code: "MANAGER_REPORT_QUERY_INVALID" });
    const filters = query.filters && typeof query.filters === "object" && !Array.isArray(query.filters)
      ? query.filters as Record<string, unknown> : {};
    const limit = Math.min(operation === "groups" ? 25 : 100, Math.max(1, Math.trunc(Number(query.limit) || 25)));
    const offset = Math.min(2_000_000, Math.max(0, Math.trunc(Number(query.offset) || 0)));
    try {
      const { data, error } = await supabase.rpc("manager_report_read_v2", { p_payload: {
        actorUsername: actor, surface, operation, filters: jsonValue(filters), offset, limit,
        sourceRevision: query.sourceRevision == null ? null : String(query.sourceRevision),
      } });
      if (error) throw error;
      return jsonResponse(data && typeof data === "object" ? { ok: true, data } : { ok: false, code: "MANAGER_REPORT_READ_FAILED" });
    } catch (error) {
      const message = String((error as { message?: unknown })?.message || (error instanceof Error ? error.message : error || ""));
      if (/manager_report_source_revision_changed|LOC_ON_HAND_REVISION_CHANGED/i.test(message)) {
        return transientOkResponse("MANAGER_REPORT_SOURCE_REVISION_CHANGED", "The report source changed while paging; retained rows remain visible.",
          { rows: [], total: 0, revisionChanged: true, ...(/LOC_ON_HAND/i.test(message) ? { source: "ph_master_inventory" } : {}) });
      }
      if (/manager_report_source_not_ready|LOC_ON_HAND_SOURCE_NOT_READY/i.test(message)) {
        return transientOkResponse("DATASET_NOT_READY", "The report source is refreshing; retained rows remain visible.",
          { rows: [], total: 0, ...(/LOC_ON_HAND/i.test(message) ? { source: "ph_master_inventory" } : {}) });
      }
      return errorResponse("Could not load manager report data.", 409, { code: "MANAGER_REPORT_READ_FAILED" });
    }
  }
  if (surface === "approval") {
    if ((!INVENTORY_NCR_FIRST_STAGE_USERS.has(actor) && !INVENTORY_NCR_JD_STAGE_USERS.has(actor))
      || !hasTableReadAccess(String(session.role || ""), "ph_master_inventory", actor)) {
      return errorResponse("Forbidden", 403, { code: "MANAGER_REPORT_FORBIDDEN" });
    }
    const allowed = new Set(["surface", "operation", "filters", "offset", "limit", "sourceRevision"]);
    if (Object.keys(query).some((key) => !allowed.has(key))) return errorResponse("Invalid report read query.", 400, { code: "MANAGER_REPORT_QUERY_INVALID" });
    const filters = query.filters && typeof query.filters === "object" && !Array.isArray(query.filters)
      ? query.filters as Record<string, unknown> : {};
    const view = String(filters.approvalTab || "").trim().toLowerCase();
    const queue = String(filters.queue || "queue").trim().toLowerCase();
    const approvalType = MANAGER_APPROVAL_VIEW_TYPES[view];
    const isNotOnInventory = view === MANAGER_NOT_ON_INVENTORY_APPROVAL_VIEW;
    if ((!approvalType && !isNotOnInventory) || !["queue", "outbox"].includes(queue)
      || (isNotOnInventory && queue === "outbox")) {
      return errorResponse("Invalid approval queue.", 400, { code: "MANAGER_REPORT_APPROVAL_TAB_INVALID" });
    }
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.limit) || 25)));
    const offset = Math.min(2_000_000, Math.max(0, Math.trunc(Number(query.offset) || 0)));
    if (!['rows', 'metadata', 'detail'].includes(operation)) {
      return errorResponse("Invalid approval queue operation.", 400, { code: "MANAGER_REPORT_QUERY_INVALID" });
    }
    const allAssignments = [...inventoryActorQueueAssignments(actor)];
    const assignments = queue === "outbox"
      ? allAssignments.filter(assignment => assignment === ("ncr_outbox_" + approvalType!.replace(/-/g, "_"))).sort()
      : allAssignments.filter((assignment) => isNotOnInventory
      ? INVENTORY_NOT_ON_INVENTORY_ASSIGNMENTS.has(assignment)
      : assignment === `ncr_approval_${approvalType!.replace(/-/g, "_")}_dylan`
        || assignment === `ncr_approval_${approvalType!.replace(/-/g, "_")}_jd`).sort();
    if (!assignments.length) return errorResponse("Forbidden", 403, { code: "QUEUE_ASSIGNMENT_FORBIDDEN" });
    try {
      const inventoryRevision = await captureReadyInventoryLocationRevision(String(profile.id || ""));
      let outboxSummary: Record<string, unknown> | null = null;
      let sourceRevision: string;
      if (queue === "outbox") {
        const { data, error } = await supabase.rpc("manager_ncr_outbox_metadata_v1", {
          p_actor_username: actor, p_approval_type: approvalType,
        });
        if (error || !data || typeof data !== "object") throw error || new Error("MANAGER_REPORT_SOURCE_NOT_READY");
        outboxSummary = data as Record<string, unknown>;
        sourceRevision = String(outboxSummary.sourceRevision || "");
        if (!sourceRevision) throw new Error("MANAGER_REPORT_SOURCE_NOT_READY");
      } else {
        const revisionResult = await supabase.from("app_dataset_revisions").select("revision,state").eq("key", "ph_master_inventory").maybeSingle();
        if (revisionResult.error || !revisionResult.data || !/^[1-9]\d*$/.test(String(revisionResult.data.revision ?? ""))) throw new Error("MANAGER_REPORT_SOURCE_NOT_READY");
        sourceRevision = String(revisionResult.data.revision);
        if (sourceRevision !== inventoryRevision) throw new Error("MANAGER_REPORT_SOURCE_REVISION_CHANGED");
      }
      if (query.sourceRevision != null && String(query.sourceRevision) !== sourceRevision) {
        return errorResponse("Approval queue changed while paging.", 409, { code: "MANAGER_REPORT_SOURCE_REVISION_CHANGED" });
      }
      const fields = isNotOnInventory ? INVENTORY_NOT_ON_INVENTORY_FIELDS : INVENTORY_NCR_QUEUE_FIELDS;
      let request = inventoryReadQuery(profile, fields, true, operation === "metadata")
        .in("app_tab_assignment", assignments);
      if (queue === "outbox") {
        request = request
          .like("ncr_approval_message", "%[[GNC_NCR_ITEM_INQUIRY:%")
          .like("ncr_approval_message", '%"activeRows":[{%');
      }
      request = request.order("unique_id", { ascending: true });
      if (operation === "detail" && String(filters.uniqueId || "").trim()) request = request.eq("unique_id", String(filters.uniqueId).trim());
      const { data, error, count } = operation === "metadata" && queue === "outbox"
        ? { data: null, error: null, count: Number(outboxSummary?.total || 0) }
        : await request.range(offset, offset + limit - 1);
      if (error) throw error;
      const rows = await enrichInventoryLocationRows(supabase, String(profile.id || ""), projectInventoryRows(data, fields), inventoryRevision);
      if (queue === "outbox") {
        const { data: afterSummary, error: afterError } = await supabase.rpc("manager_ncr_outbox_metadata_v1", {
          p_actor_username: actor, p_approval_type: approvalType,
        });
        if (afterError || !afterSummary || typeof afterSummary !== "object") throw afterError || new Error("MANAGER_REPORT_SOURCE_NOT_READY");
        if (String((afterSummary as Record<string, unknown>).sourceRevision || "") !== sourceRevision) {
          return transientOkResponse("MANAGER_REPORT_SOURCE_REVISION_CHANGED", "The approval queue changed while paging; retained rows remain visible.",
            { rows: [], total: 0, revisionChanged: true });
        }
        outboxSummary = afterSummary as Record<string, unknown>;
      } else {
        const afterRevision = await supabase.from("app_dataset_revisions").select("revision,state").eq("key", "ph_master_inventory").maybeSingle();
        if (afterRevision.error || !afterRevision.data || !/^[1-9]\d*$/.test(String(afterRevision.data.revision ?? ""))) throw new Error("MANAGER_REPORT_SOURCE_NOT_READY");
        if (String(afterRevision.data.revision) !== sourceRevision) {
          return transientOkResponse("MANAGER_REPORT_SOURCE_REVISION_CHANGED", "The approval queue changed while paging; retained rows remain visible.",
            { rows: [], total: 0, revisionChanged: true });
        }
      }
      const total = queue === "outbox" ? Number(outboxSummary?.total || 0) : count ?? 0;
      return jsonResponse({ ok: true, data: { rows: operation === "metadata" ? [] : rows, total, offset, limit, inventoryRevision,
        hasMore: operation !== "metadata" && offset + rows.length < total, sourceRevision, metadata: { approvalTab: view, queue, assignments,
          ...(queue === "outbox" ? { activeLineCount: Number(outboxSummary?.activeLineCount || 0) } : {}) } } });
    } catch (error) {
      const message = String((error as { message?: unknown })?.message || error || "");
      if (/manager_report_source_revision_changed|LOC_ON_HAND_REVISION_CHANGED/i.test(message)) return transientOkResponse("MANAGER_REPORT_SOURCE_REVISION_CHANGED", "The report source changed while paging; retained rows remain visible.", { rows: [], total: 0, revisionChanged: true, ...(/LOC_ON_HAND/i.test(message) ? { source: "ph_master_inventory" } : {}) });
      if (/manager_report_source_not_ready|LOC_ON_HAND_SOURCE_NOT_READY/i.test(message)) return transientOkResponse("DATASET_NOT_READY", "The report source is refreshing; retained rows remain visible.", { rows: [], total: 0, ...(/LOC_ON_HAND/i.test(message) ? { source: "ph_master_inventory" } : {}) });
      return errorResponse("Could not load approval queue.", 409, { code: "MANAGER_REPORT_APPROVAL_READ_FAILED" });
    }
  }
  if (!["eval1", "eval2", "ncr"].includes(surface)) {
    return errorResponse("This report surface is not available through the bounded report API.", 501, { code: "MANAGER_REPORT_SURFACE_UNAVAILABLE" });
  }
  if (surface === "ncr" && !hasTableReadAccess(String(session.role || ""), "ph_master_inventory", actor)) return errorResponse("Forbidden", 403, { code: "MANAGER_REPORT_FORBIDDEN" });
  if ((surface === "eval1" && !FULL_ACCESS_USER_KEYS.has(actor))
    || (surface === "eval2" && (canonicalAccess || await resolveCanonicalUserAccess(supabase, String(profile.id || ""))).permissions.can_access_eval_reports_2 !== true)) {
    return errorResponse("Forbidden", 403, { code: "MANAGER_REPORT_FORBIDDEN" });
  }
  const allowed = new Set(["surface", "operation", "filters", "offset", "limit", "sourceRevision"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    return errorResponse("Invalid report read query.", 400, { code: "MANAGER_REPORT_QUERY_INVALID" });
  }
  const filters = query.filters && typeof query.filters === "object" && !Array.isArray(query.filters)
    ? query.filters as Record<string, unknown> : {};
  const reportIds = Array.isArray(filters.reportIds) ? filters.reportIds.filter((value): value is string => typeof value === "string").slice(0, 11) : [];
  const safeFilters = { ...filters, reportIds };
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.limit) || 25)));
  const offset = Math.min(2_000_000, Math.max(0, Math.trunc(Number(query.offset) || 0)));
  const readOperation = String(query.operation || payload.operation || "groups").trim().toLowerCase();
  if (!["groups", "rows", "metadata", "detail"].includes(readOperation)) {
    return errorResponse("Invalid report read operation.", 400, { code: "MANAGER_REPORT_OPERATION_INVALID" });
  }
  try {
    const { data, error } = await supabase.rpc("manager_report_read_v2", { p_payload: {
      actorUsername: actor, surface, operation: readOperation, filters: safeFilters, offset, limit,
      sourceRevision: query.sourceRevision == null ? null : String(query.sourceRevision),
    } });
    if (error) throw error;
    const responseData = surface === "eval2" && readOperation === "groups" ? sortManagerEval2PreviewRows(data) : data;
    return jsonResponse(responseData && typeof responseData === "object" ? { ok: true, data: responseData } : { ok: false, code: "MANAGER_REPORT_READ_FAILED" });
  } catch (error) {
    const message = String((error as { message?: unknown })?.message || (error instanceof Error ? error.message : error || ""));
    if (message.includes("manager_report_eval1_forbidden") || message.includes("manager_report_eval2_forbidden")) return errorResponse("Forbidden", 403, { code: "MANAGER_REPORT_FORBIDDEN" });
    if (/manager_report_source_revision_changed|LOC_ON_HAND_REVISION_CHANGED/i.test(message)) return transientOkResponse("MANAGER_REPORT_SOURCE_REVISION_CHANGED", "The report source changed while paging; retained rows remain visible.", { rows: [], total: 0, revisionChanged: true, ...(/LOC_ON_HAND/i.test(message) ? { source: "ph_master_inventory" } : {}) });
    if (/manager_report_source_not_ready|LOC_ON_HAND_SOURCE_NOT_READY/i.test(message)) return transientOkResponse("DATASET_NOT_READY", "The report source is refreshing; retained rows remain visible.", { rows: [], total: 0, ...(/LOC_ON_HAND/i.test(message) ? { source: "ph_master_inventory" } : {}) });
    return errorResponse("Could not load manager report data.", 409, { code: "MANAGER_REPORT_READ_FAILED" });
  }
}

type LivePilotFeatureKey = typeof LIVE_PILOT_FEATURE_KEYS[number];

function getDisabledLivePilotFlags(): Record<LivePilotFeatureKey, boolean> {
  return {
    skin: false,
    preferences: false,
    card_grid: false,
    monitoring: false,
  };
}

function sanitizeLivePilotPreferences(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const themeModeValue = String(source.themeMode || source.theme_mode || source.theme || "").trim().toLowerCase();
  const displayModeValue = String(source.displayMode || source.display_mode || "").trim().toLowerCase();
  const themeMode = ["system", "light", "dark"].includes(themeModeValue)
    ? themeModeValue
    : "dark";
  const displayMode = ["cards", "grid"].includes(displayModeValue)
    ? displayModeValue
    : "cards";
  const updatedAtValue = String(source.updatedAt || source.updated_at || "").trim();
  const updatedAtMs = Date.parse(updatedAtValue);
  const updatedAt = Number.isFinite(updatedAtMs) ? new Date(updatedAtMs).toISOString() : "";
  return { themeMode, displayMode, updatedAt };
}

async function loadLivePilotFlags() {
  const flags = getDisabledLivePilotFlags();
  const { data, error } = await supabase
    .from("ph_app_live_pilot_flags")
    .select("feature_key,enabled")
    .in("feature_key", [...LIVE_PILOT_FEATURE_KEYS]);
  if (error) throw error;
  for (const row of data || []) {
    const key = String(row?.feature_key || "") as LivePilotFeatureKey;
    if (LIVE_PILOT_FEATURE_KEYS.includes(key)) flags[key] = row?.enabled === true;
  }
  return flags;
}

type LivePilotPreferenceRow = {
  user_key: string;
  theme_mode: string;
  display_mode: string;
  updated_at: string;
  cohort_id: string;
};

function serializeLivePilotPreferenceRow(row: Partial<LivePilotPreferenceRow> | null | undefined) {
  const preferences = sanitizeLivePilotPreferences(row || {});
  return {
    themeMode: preferences.themeMode,
    displayMode: preferences.displayMode,
    updatedAt: preferences.updatedAt || new Date(0).toISOString(),
  };
}

async function readLivePilotPreferenceRow(userKey: string) {
  const { data, error } = await supabase
    .from("ph_app_user_preferences")
    .select("user_key,theme_mode,display_mode,updated_at,cohort_id")
    .eq("user_key", userKey)
    .maybeSingle();
  if (error) throw error;
  return data as LivePilotPreferenceRow | null;
}

async function readOrCreateLivePilotPreferenceRow(userKey: string) {
  const existing = await readLivePilotPreferenceRow(userKey);
  if (existing) return existing;
  const { data, error } = await supabase
    .from("ph_app_user_preferences")
    .insert({
      user_key: userKey,
      theme_mode: userKey === LEGACY_DARK_DEFAULT_USERNAME ? "dark" : "light",
      display_mode: "cards",
      updated_at: new Date().toISOString(),
    })
    .select("user_key,theme_mode,display_mode,updated_at,cohort_id")
    .single();
  if (error) {
    if (String(error.code || "") === "23505") {
      const racedRow = await readLivePilotPreferenceRow(userKey);
      if (racedRow) return racedRow;
    }
    throw error;
  }
  return data as LivePilotPreferenceRow;
}

async function handleGetUserPreferences(
  session: Awaited<ReturnType<typeof readAppSessionFromRequest>>,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  const username = getSessionUserKey(session);
  if (!username) return errorResponse("Authenticated user identity is required.", 403);
  try {
    const flags = await loadLivePilotFlags();
    // Monitoring is a production safety control for every authenticated user;
    // appearance experiments remain independently flag-controlled.
    flags.monitoring = !!LIVE_PILOT_SENTRY_DSN;
    const monitoringEligible = !!LIVE_PILOT_SENTRY_DSN;
    const monitoring = monitoringEligible
      ? {
        dsn: LIVE_PILOT_SENTRY_DSN,
        tracesSampleRate: 0.1,
      }
      : null;
    const preferenceRow = (flags.preferences || flags.card_grid)
      ? await readOrCreateLivePilotPreferenceRow(username)
      : null;
    return jsonResponse({
      ok: true,
      eligible: true,
      monitoringEligible,
      flags,
      preferences: preferenceRow ? serializeLivePilotPreferenceRow(preferenceRow) : null,
      monitoring,
    });
  } catch (error) {
    recordHandledError("app-api", "get_user_preferences", error, 503);
    const monitoringEligible = !!LIVE_PILOT_SENTRY_DSN;
    const fallbackFlags = getDisabledLivePilotFlags();
    fallbackFlags.monitoring = monitoringEligible;
    return jsonResponse({
      ok: true,
      eligible: false,
      monitoringEligible,
      flags: fallbackFlags,
      preferences: null,
      monitoring: monitoringEligible ? { dsn: LIVE_PILOT_SENTRY_DSN, tracesSampleRate: 0.1 } : null,
    });
  }
}

async function handleSetUserPreferences(
  session: Awaited<ReturnType<typeof readAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  const username = getSessionUserKey(session);
  if (!username) return errorResponse("Authenticated user identity is required.", 403);

  try {
    const flags = await loadLivePilotFlags();
    if (!flags.preferences && !flags.card_grid) return errorResponse("Appearance preferences are disabled.", 403);
    const preferences = sanitizeLivePilotPreferences(payload.preferences);
    if (!preferences.updatedAt) return errorResponse("A valid updatedAt timestamp is required.", 400);

    const existing = await readLivePilotPreferenceRow(username);
    if (!existing) {
      const { data, error } = await supabase
        .from("ph_app_user_preferences")
        .insert({
          user_key: username,
          theme_mode: preferences.themeMode,
          display_mode: preferences.displayMode,
          updated_at: preferences.updatedAt,
        })
        .select("user_key,theme_mode,display_mode,updated_at,cohort_id")
        .single();
      if (!error && data) {
        return jsonResponse({ ok: true, applied: true, preferences: serializeLivePilotPreferenceRow(data) });
      }
      if (String(error?.code || "") !== "23505") throw error;
    }

    const latestBeforeUpdate = existing || await readLivePilotPreferenceRow(username);
    if (latestBeforeUpdate && Date.parse(latestBeforeUpdate.updated_at) >= Date.parse(preferences.updatedAt)) {
      return jsonResponse({
        ok: true,
        applied: false,
        preferences: serializeLivePilotPreferenceRow(latestBeforeUpdate),
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("ph_app_user_preferences")
      .update({
        theme_mode: preferences.themeMode,
        display_mode: preferences.displayMode,
        updated_at: preferences.updatedAt,
      })
      .eq("user_key", username)
      .lt("updated_at", preferences.updatedAt)
      .select("user_key,theme_mode,display_mode,updated_at,cohort_id")
      .maybeSingle();
    if (updateError) throw updateError;
    const current = updated || await readLivePilotPreferenceRow(username);
    if (!current) throw new Error("Appearance preference row was not found.");
    return jsonResponse({
      ok: true,
      applied: !!updated,
      preferences: serializeLivePilotPreferenceRow(current),
    });
  } catch (error) {
    recordHandledError("app-api", "set_user_preferences", error, 503);
    return errorResponse("Unable to save appearance preferences.", 500);
  }
}

function getSessionDisplayName(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>) {
  if (!session) return "";
  return String(session.displayName || session.username || "").trim();
}

function isAvOptionEvalManager(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>) {
  return AV_OPTION_EVAL_MANAGER_USERS.has(getSessionUserKey(session));
}

function cleanNullableText(value: unknown, maxLength = 1000) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeAvOptionEvalStatus(value: unknown, fallback = "open") {
  const status = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return AV_OPTION_EVAL_STATUS_VALUES.has(status) ? status : fallback;
}

function filterPayloadFields(body: unknown, allowedFields: Set<string>) {
  const rows = Array.isArray(body) ? body : [body];
  return rows.map((row) => {
    const source = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {};
    const next: Record<string, unknown> = {};
    Object.entries(source).forEach(([key, value]) => {
      const safeKey = String(key || "").trim();
      if (allowedFields.has(safeKey)) next[safeKey] = value;
    });
    return next;
  });
}

function appendQueryFilter(query = "", key = "", value = "") {
  const safeKey = String(key || "").trim();
  if (!safeKey) return query;
  const safeValue = String(value || "").trim();
  const next = `${encodeURIComponent(safeKey)}=${encodeURIComponent(safeValue)}`;
  return query ? `${query}&${next}` : next;
}

function prepareAvOptionEvalDbRequest(
  session: Awaited<ReturnType<typeof readAppSessionFromRequest>>,
  method = "GET",
  query = "",
  body: unknown = null,
) {
  const actor = getSessionUserKey(session);
  const actorDisplay = getSessionDisplayName(session) || actor;
  const manager = isAvOptionEvalManager(session);
  if (!actor) return { error: errorResponse("Unauthorized", 401), query, body };

  if (method === "GET") {
    if (manager) return { query, body };
    return {
      query: appendQueryFilter(query, "or", `(assignedto.eq.${actor},created_by.eq.${actor})`),
      body,
    };
  }

  if (method === "DELETE" && !manager) {
    return { error: errorResponse("Forbidden", 403), query, body };
  }

  if (method === "POST") {
    const filteredRows = filterPayloadFields(body, AV_OPTION_EVAL_INSERT_FIELDS).map((row) => {
      const assignedto = normalizeUsername(row.assignedto);
      const instructions = cleanNullableText(row.instructions, 3000);
      row.status = normalizeAvOptionEvalStatus(row.status, "open");
      row.assignedto = assignedto;
      row.instructions = instructions;
      row.created_by = actor;
      row.created_by_display = actorDisplay;
      row.updated_by = actor;
      row.updated_by_display = actorDisplay;
      return row;
    });
    const invalidRow = filteredRows.find((row) => !row.assignedto || !row.instructions);
    if (invalidRow) {
      return { error: errorResponse("Assigned evaluator and instructions are required.", 400), query, body };
    }
    return { query, body: Array.isArray(body) ? filteredRows : filteredRows[0] };
  }

  if (method === "PATCH") {
    const allowedFields = manager ? AV_OPTION_EVAL_MANAGER_UPDATE_FIELDS : AV_OPTION_EVAL_EVALUATOR_UPDATE_FIELDS;
    const filteredRows = filterPayloadFields(body, allowedFields).map((row) => {
      if (Object.prototype.hasOwnProperty.call(row, "assignedto")) {
        row.assignedto = normalizeUsername(row.assignedto);
      }
      if (Object.prototype.hasOwnProperty.call(row, "instructions")) {
        row.instructions = cleanNullableText(row.instructions, 3000);
      }
      if (Object.prototype.hasOwnProperty.call(row, "status")) {
        row.status = normalizeAvOptionEvalStatus(row.status, "open");
      }
      const status = String(row.status || "").trim().toLowerCase();
      if (status === "complete") {
        row.completed_by = actor;
        row.completed_by_display = actorDisplay;
        row.completed_at = new Date().toISOString();
      }
      row.updated_by = actor;
      row.updated_by_display = actorDisplay;
      return row;
    });
    const scopedQuery = manager ? query : appendQueryFilter(query, "assignedto", `eq.${actor}`);
    return { query: scopedQuery, body: Array.isArray(body) ? filteredRows : filteredRows[0] };
  }

  return { query, body };
}

function getLoginClientAddress(req: Request) {
  const forwarded = String(req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
  if (forwarded) return forwarded.slice(0, 128);
  // X-Forwarded-For is client-controlled unless the entire proxy chain is
  // configured to overwrite it. The username digest still limits attempts if
  // this edge does not provide a trusted address header.
  return "unknown";
}

async function updateLoginRateLimit(operation: "check" | "failure" | "success", username: string, req: Request) {
  const [usernameDigest, ipDigest] = await Promise.all([
    createAppRateLimitDigest("username", normalizeUsername(username)),
    createAppRateLimitDigest("ip", getLoginClientAddress(req)),
  ]);
  const rateLimitRpc = supabase.rpc.bind(supabase) as unknown as (
    name: "app_login_rate_limit_v1",
    args: { p_operation: "check" | "failure" | "success"; p_username_digest: string; p_ip_digest: string },
  ) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rateLimitRpc("app_login_rate_limit_v1", {
    p_operation: operation,
    p_username_digest: usernameDigest,
    p_ip_digest: ipDigest,
  });
  if (error) throw error;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

function authorizeAppsScriptProxyAction(action: string, payload: Record<string, unknown>, actor: Record<string, unknown>, access: CanonicalUserAccess) {
  const username = normalizeUsername(String(actor.username || ""));
  const requireAny = (flags: readonly CanonicalUserAccessFlag[]) => {
    if (!hasAnyCanonicalUserAccessFlag(access, flags)) throw Object.assign(new Error("APPS_SCRIPT_ACTION_FORBIDDEN"), { status: 403 });
  };
  if (!APPS_SCRIPT_PROXY_ACTIONS.has(action) || action === "drivearound_history_backfill" || action === "deployment_health") {
    throw Object.assign(new Error("APPS_SCRIPT_ACTION_FORBIDDEN"), { status: 403 });
  }
  if (["manual_run", "manual_continue", "manual_clear_status", "manual_clear_stale_status", "clear_request_gallery_cache", "drivearound_name_cleanup"].includes(action)) {
    if (!FULL_ACCESS_USER_KEYS.has(username)) throw Object.assign(new Error("APPS_SCRIPT_ACTION_FORBIDDEN"), { status: 403 });
    return;
  }
  // Home status is an existing read for every active authenticated nursery role.
  if (action === "manual_status") return;
  if (action === "wake_delivery_worker") return requireAny(["can_access_que", "can_access_manager_tab", "can_submit_reclass"]);
  if (action === "drivearound_name_preview") return requireAny(["can_access_drive_mode"]);
  if (action === "inventory_transaction" || action === "inventory_transaction_history") return requireAny(["can_access_drive_mode"]);
  if (action === "block_clearing_pdf") return requireAny(["can_access_manager_tab", "can_access_drive_mode"]);
  if (action === "bunch_note_preview" || action === "hl_order_preview") return requireAny(["can_access_que", "can_access_manager_tab"]);
  if (action.startsWith("reclass_inquiry_")) return requireAny(["can_submit_reclass", "can_access_manager_tab"]);
  if (action === "image") return requireAny(["can_access_drive_mode", "can_access_av", "can_access_que"]);
  if (action === "email") {
    const emailType = String(payload.emailType || "").trim().toLowerCase();
    if (!APPS_SCRIPT_EMAIL_TYPES.has(emailType)) throw Object.assign(new Error("APPS_SCRIPT_EMAIL_TYPE_FORBIDDEN"), { status: 403 });
    if (["new_request", "request_complete", "request_rep_reviewed"].includes(emailType)) return requireAny(["can_access_que"]);
    if (["ncr_complete", "ncr_approval", "hold_release_request", "block_clearing_email"].includes(emailType)) {
      return requireAny(["can_access_manager_tab", "can_submit_reclass", "can_access_que"]);
    }
    if (["drive_customer_outreach", "drive_shift_report"].includes(emailType)) return requireAny(["can_access_drive_mode", "can_access_manager_tab"]);
    return requireAny(["can_access_av", "can_access_que", "can_access_manager_tab"]);
  }
  throw Object.assign(new Error("APPS_SCRIPT_ACTION_FORBIDDEN"), { status: 403 });
}

function sanitizeAppsScriptProxyPayload(source: Record<string, unknown>, actor: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...source };
  const untrustedIdentityKeys = new Set([
    "actor", "actorid", "actorusername", "actorprofileid", "authuserid", "sessiontoken", "apptoken",
    "isadmin", "role", "userrole", "requestedbyusername", "requestedbydisplay",
    "submittedbyusername", "requestcreatedbyusername",
  ]);
  for (const key of Object.keys(payload)) {
    if (untrustedIdentityKeys.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) delete payload[key];
  }
  const username = normalizeUsername(String(actor.username || ""));
  if (Object.prototype.hasOwnProperty.call(source, "requestedBy")) {
    payload.requestedBy = String(actor.display_name || actor.username || "");
  }
  if (Object.prototype.hasOwnProperty.call(source, "requestedByUsername")) payload.requestedByUsername = username;
  if (Object.prototype.hasOwnProperty.call(source, "submittedByUsername")) payload.submittedByUsername = username;
  if (Object.prototype.hasOwnProperty.call(source, "requestCreatedByUsername")) payload.requestCreatedByUsername = username;
  return payload;
}

async function handleAppsScriptAction(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  requestPayload: Record<string, unknown>,
  access: CanonicalUserAccess | null,
) {
  if (!session || !access) return errorResponse("An active authenticated profile is required.", 401, { code: "AUTH_REQUIRED" });
  if (Object.keys(requestPayload).some(key => key !== "action" && key !== "payload")) {
    return errorResponse("Invalid Apps Script action request.", 400, { code: "APPS_SCRIPT_ACTION_REQUEST_INVALID" });
  }
  const action = String(requestPayload.action || "").trim().toLowerCase();
  if (isLegacyRunScriptAction(action)) {
    return errorResponse("RUN SCRIPT is handled by the PostgreSQL ERP sync worker.", 410, { code: "LEGACY_RUN_SCRIPT_DISABLED" });
  }
  if (!PRODUCTION_SCHEDULE_APPS_SCRIPT_URL || !PRODUCTION_SCHEDULE_SIGNING_SECRET) {
    return transientOkResponse("APPS_SCRIPT_GATEWAY_UNAVAILABLE", "The Apps Script action gateway is unavailable.");
  }
  const source = requestPayload.payload && typeof requestPayload.payload === "object" && !Array.isArray(requestPayload.payload)
    ? requestPayload.payload as Record<string, unknown> : null;
  if (!source) return errorResponse("Invalid Apps Script action payload.", 400, { code: "APPS_SCRIPT_ACTION_REQUEST_INVALID" });
  const actor = await resolveActiveSessionProfile(session);
  try {
    authorizeAppsScriptProxyAction(action, source, actor, access);
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status) || 403;
    const code = String((error as { message?: unknown })?.message || "APPS_SCRIPT_ACTION_FORBIDDEN");
    return errorResponse("This action is not enabled for your active profile.", status, { code });
  }
  const serializedSource = JSON.stringify(source);
  if (serializedSource.length > 24_000_000) return errorResponse("Apps Script action payload is too large.", 413, { code: "APPS_SCRIPT_ACTION_PAYLOAD_TOO_LARGE" });
  const forwardedPayload = sanitizeAppsScriptProxyPayload(source, actor);
  const command = {
    contractVersion: "apps-script-action-v1",
    action,
    payload: forwardedPayload,
    actor: {
      id: String(actor.id),
      username: normalizeUsername(String(actor.username || "")),
      role: access.canonicalRole,
    },
  };
  const timestamp = new Date().toISOString();
  const { deliveryJson, signature } = await signProductionScheduleCommand(command, timestamp, PRODUCTION_SCHEDULE_SIGNING_SECRET);
  try {
    const response = await fetch(PRODUCTION_SCHEDULE_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "apps_script_action_v1", timestamp, signature, deliveryJson }),
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    const responseText = await response.text();
    if (responseText.length > 2_000_000) return transientOkResponse("APPS_SCRIPT_RESPONSE_TOO_LARGE", "Apps Script returned an oversized response.");
    let responseBody: unknown;
    try { responseBody = JSON.parse(responseText); }
    catch { responseBody = { ok: response.ok, data: responseText }; }
    if (response.status >= 500) return transientOkResponse("APPS_SCRIPT_ACTION_FAILED", "The Apps Script action could not be completed.");
    return jsonResponse(responseBody, response.status);
  } catch (error) {
    recordHandledError("app-api", "apps_script_action", error, 502);
    return transientOkResponse("APPS_SCRIPT_ACTION_FAILED", "The Apps Script action could not be completed.");
  }
}

function dispatchAuthenticatedDeliveryWake(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  access: CanonicalUserAccess | null,
  sourceValue: unknown,
) {
  if (!session || !access) return errorResponse("An active authenticated profile is required.", 401, { code: "AUTH_REQUIRED" });
  const source = String(sourceValue || "browser_request").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80) || "browser_request";
  const appsScriptWake = handleAppsScriptAction(session, {
    action: "wake_delivery_worker",
    payload: { type: "wake_delivery_worker", source, limit: 40 },
  }, access).then(() => {}).catch(() => {});
  const edgeWake = invokeRequestDeliveryWorkerNow(source).then(() => {}).catch(() => {});
  const task = Promise.allSettled([appsScriptWake, edgeWake]).then(() => {});
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
  return jsonResponse({ ok: true, scheduled: true, source });
}

const HOME_SYNC_METADATA_USERS = new Set(["dylan_collyge", "jd_jones", "megan_kelly"]);
const HOME_SYNC_METADATA_KEYS = ["ph_master_inventory", "ph_soc_master", "ph_reserves", "ph_cav_import", "hl_po_parsed"];

async function readLoginHomeSyncMetadata(username: string) {
  if (!HOME_SYNC_METADATA_USERS.has(normalizeUsername(username))) return null;
  const { data, error } = await supabase.from("app_dataset_revisions")
    .select("key,revision,state,changed_at,source_file_name,source_imported_at")
    .in("key", HOME_SYNC_METADATA_KEYS);
  if (error || !Array.isArray(data)) return null;
  return {
    contractVersion: 1,
    serverTime: new Date().toISOString(),
    sources: data.map((row) => ({
      key: row.key,
      revision: String(row.revision),
      state: row.state,
      changedAt: row.changed_at,
      sourceFileName: row.source_file_name,
      sourceImportedAt: row.source_imported_at,
    })),
  };
}

async function handlePasskeyAuthenticationProxy(action: string, payload: Record<string, unknown>, req: Request) {
  const isOptions = action === "passkey_auth_options" || action === "passkey_login_begin";
  const endpoint = isOptions ? "passkeys/authentication/options" : "passkeys/authentication/verify";
  const credential = payload.credential && typeof payload.credential === "object" && !Array.isArray(payload.credential)
    ? payload.credential as Record<string, unknown> : null;
  const challengeId = String(payload.challengeId || payload.challenge_id || "").trim();
  if (!isOptions && (!challengeId || !credential)) {
    return errorResponse("Passkey challenge and credential are required.", 400, { code: "PASSKEY_VERIFY_REQUIRED" });
  }
  const body = isOptions
    ? { gotrue_meta_security: { captcha_token: String(payload.captchaToken || "").trim() || undefined } }
    : { challenge_id: challengeId, credential };
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Origin: String(req.headers.get("origin") || "https://agmetricapp.com"),
      "X-Client-Info": "agdata-app-api-passkey-v1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const responseText = await response.text();
  let responseBody = responseText;
  if (isOptions && response.ok) {
    try {
      const parsed = JSON.parse(responseText) as Record<string, unknown>;
      const options = parsed.options && typeof parsed.options === "object" && !Array.isArray(parsed.options)
        ? parsed.options as Record<string, unknown> : null;
      if (options && !Array.isArray(options.allowCredentials)) options.allowCredentials = [];
      responseBody = JSON.stringify(parsed);
    } catch { /* preserve the upstream response if it is unexpectedly non-JSON */ }
  }
  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, "Content-Type": response.headers.get("content-type") || "application/json" },
  });
}

async function handleLogin(payload: Record<string, unknown>, req: Request) {
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "").trim();
  if (!username || !password) return errorResponse("Username and password are required.", 400);

  const normalizedInput = normalizeUsername(username);
  let rateLimit: Record<string, unknown>;
  try {
    rateLimit = await updateLoginRateLimit("check", normalizedInput, req);
  } catch (error) {
    recordHandledError("app-api", "login_rate_limit", error, 503);
    return errorResponse("Sign-in is temporarily unavailable. Try again shortly.", 503, { code: "LOGIN_RATE_LIMIT_UNAVAILABLE" });
  }
  if (rateLimit.allowed !== true) {
    return errorResponse("Too many unsuccessful sign-in attempts. Try again shortly.", 429, {
      code: "LOGIN_RATE_LIMITED",
      retryAfterSeconds: Math.max(1, Math.min(900, Number(rateLimit.retry_after_seconds) || 60)),
    });
  }

  const selectCols = "username,role,password,division,language";
  const exactResponse = await restRequest(
    "ph_app_users",
    "GET",
    `select=${selectCols}&username=eq.${encodeURIComponent(normalizedInput)}&limit=1`,
  );
  if (!exactResponse.ok) return errorResponse("Login lookup failed.", exactResponse.status, { details: await readResponsePayload(exactResponse) });
  let payloadRows = await readResponsePayload(exactResponse);
  let rows = Array.isArray(payloadRows) ? payloadRows as Record<string, unknown>[] : [];
  if (!rows.length && normalizedInput) {
    const fallbackResponse = await restRequest(
      "ph_app_users",
      "GET",
      `select=${selectCols}&username=ilike.${encodeURIComponent(normalizedInput)}&limit=3`,
    );
    if (!fallbackResponse.ok) return errorResponse("Login lookup failed.", fallbackResponse.status, { details: await readResponsePayload(fallbackResponse) });
    payloadRows = await readResponsePayload(fallbackResponse);
    rows = Array.isArray(payloadRows) ? payloadRows as Record<string, unknown>[] : [];
  }
  const matchedUser = rows.find((row) => {
    const dbUsername = String(row.username || row.USERNAME || "").trim();
    const dbPassword = String(row.password || row.PASSWORD || "").trim();
    return doesLoginPasswordMatch(dbPassword, password) && normalizeUsername(dbUsername) === normalizedInput;
  }) || null;

  if (!matchedUser) {
    try {
      await updateLoginRateLimit("failure", normalizedInput, req);
    } catch (error) {
      recordHandledError("app-api", "login_rate_limit", error, 503);
      return errorResponse("Sign-in is temporarily unavailable. Try again shortly.", 503, { code: "LOGIN_RATE_LIMIT_UNAVAILABLE" });
    }
    return jsonResponse({ ok: false, reason: "mismatch" }, 200);
  }
  try {
    await updateLoginRateLimit("success", normalizedInput, req);
  } catch (error) {
    recordHandledError("app-api", "login_rate_limit", error, 503);
    return errorResponse("Sign-in is temporarily unavailable. Try again shortly.", 503, { code: "LOGIN_RATE_LIMIT_UNAVAILABLE" });
  }
  if (!await isAppAccountActive(supabase, { username: normalizedInput })) {
    return errorResponse("This account is no longer active. Contact an administrator.", 403, { code: "ACCOUNT_INACTIVE" });
  }

  const dbUsername = String(matchedUser.username || matchedUser.USERNAME || username).trim() || username;
  const role = String(matchedUser.role || matchedUser.ROLE || "User").trim() || "User";
  const division = String(matchedUser.division || matchedUser.DIVISION || "10").trim() || "10";
  const language = String(matchedUser.language || matchedUser.LANGUAGE || "English").trim() || "English";
  const matchedDbPassword = String(matchedUser.password || matchedUser.PASSWORD || "").trim();
  const mustChangePassword = isForcedPasswordValue(matchedDbPassword) || isForcedPasswordValue(password);
  const [session, homeSyncMetadata] = await Promise.all([
    createAppSession({
      username: dbUsername,
      displayName: dbUsername,
      role,
      mustChangePassword,
    }),
    readLoginHomeSyncMetadata(dbUsername),
  ]);

  return jsonResponse({
    ok: true,
    user: { username: dbUsername, role, division, language },
    session: {
      token: session.token,
      username: session.claims.username,
      displayName: session.claims.displayName,
      role: session.claims.role,
      expiresAt: session.claims.exp * 1000,
      mustChangePassword: session.claims.mustChangePassword,
    },
    homeSyncMetadata,
  });
}

async function handleNativeSessionBridge(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
) {
  if (!session || session.ver < 2) return errorResponse("Native authentication required.", 401);
  if (session.mustChangePassword) {
    return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  }

  const [bridgedSession, homeSyncMetadata] = await Promise.all([
    createAppSession({
      username: session.username,
      displayName: session.displayName || session.username,
      role: normalizeUsername(session.username) === "dylan_collyge"
        ? "admin"
        : String((session as typeof session & { displayRole?: string }).displayRole || session.role),
      mustChangePassword: false,
    }),
    readLoginHomeSyncMetadata(session.username),
  ]);

  return jsonResponse({
    ok: true,
    session: {
      token: bridgedSession.token,
      username: bridgedSession.claims.username,
      displayName: bridgedSession.claims.displayName,
      role: bridgedSession.claims.role,
      expiresAt: bridgedSession.claims.exp * 1000,
      mustChangePassword: false,
    },
    homeSyncMetadata,
  });
}

// An HMAC lets the database recognize the same retry without storing the new
// password before Auth accepts it. Never include this value in a response/log.
async function passwordChangeFingerprint(password: string) {
  const secret = String(Deno.env.get("APP_SESSION_SECRET") || "").trim();
  if (!secret) throw new Error("PASSWORD_CHANGE_UNAVAILABLE");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`gnc-password-change-v1\u0000${password}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Missing profiles must not prevent the password endpoint from reconciling a
// verified native identity. This identity-only fallback is never used by other
// actions; the service-only prepare RPC still checks all account restrictions.
async function readPasswordChangeSession(req: Request, session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>) {
  if (session) return session;
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    const verifiedEmail = String(data.user.email || "").trim().toLowerCase();
    const identity = /^[a-z0-9_]+@greenleafnursery\.com$/.test(verifiedEmail)
      ? { username: verifiedEmail.split("@")[0] } : { id: String(data.user.id) };
    if (!await isAppAccountActive(supabase, identity)) return null;
    const now = Math.floor(Date.now() / 1000);
    return { ver: 2, authUserId: String(data.user.id), username: identity.username || "", displayName: "", role: "", mustChangePassword: true, iat: now, exp: now + 300 };
  } catch { return null; }
}

function passwordReconciliationError(error: { code?: string; message?: string } | null) {
  if (String(error?.message || "").toLowerCase().includes("password_change_attempt_conflict")) {
    return errorResponse("A password change is awaiting confirmation. Retry with the same new password. If you no longer have it, contact an administrator.", 409, { code: "PASSWORD_CHANGE_IN_PROGRESS" });
  }
  if (String(error?.message || "").toLowerCase().includes("password_change_not_required")) {
    return errorResponse("Your password change is already complete. Sign in with your new password.", 409, { code: "PASSWORD_CHANGE_NOT_REQUIRED" });
  }
  if (error?.code === "42501") return errorResponse("This account is not available for password changes. Contact an administrator.", 403, { code: "PASSWORD_CHANGE_FORBIDDEN" });
  return errorResponse("The account identity could not be reconciled safely. Contact an administrator to check the account links.", 409, { code: "AUTH_PROFILE_LINK_REPAIR_REQUIRED" });
}

async function handlePasswordChange(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Unauthorized", 401);
  const newPassword = String(payload.newPassword || "").trim();
  const confirmPassword = String(payload.confirmPassword || "").trim();
  if (!newPassword || newPassword.length < 6) return errorResponse("Password must be at least 6 characters.", 400);
  if (newPassword !== confirmPassword) return errorResponse("Passwords do not match.", 400);
  if (isForcedPasswordValue(newPassword)) return errorResponse("Choose a password other than the shared starter password.", 400);

  const username = normalizeUsername(session.username || "");
  const retryResponse = () => errorResponse("Your password change has not been fully confirmed. Keep this screen open and retry with the same new password.", 503, { code: "PASSWORD_CHANGE_RETRY_REQUIRED", retryable: true });
  let nextSession;
  try {
    if (!await isAppAccountActive(supabase, session.authUserId ? { id: session.authUserId } : { username })) {
      // Legacy-only reconciliation is allowed through its verified username;
      // the native fallback already checked its Auth-verified email identity.
      if (!username || !await isAppAccountActive(supabase, { username })) return errorResponse("This account is no longer active.", 403, { code: "ACCOUNT_INACTIVE" });
    }
    const fingerprint = await passwordChangeFingerprint(newPassword);
    const prepare = async (authUserId: string | null) => {
      const { data, error } = await supabase.rpc("prepare_password_change_profile", {
        p_username: username, ...(authUserId ? { p_auth_user_id: authUserId } : {}), p_password_fingerprint: fingerprint,
      });
      const row = Array.isArray(data) ? data[0] : data;
      return { row: row as Record<string, unknown> | null, error };
    };
    let prepared = await prepare(session.authUserId || null);
    if (prepared.error) return passwordReconciliationError(prepared.error);
    if (prepared.row?.status === "password_change_not_required") return passwordReconciliationError({ message: "password_change_not_required" });
    if (!prepared.row?.attempt_id) return retryResponse();

    if (prepared.row.status === "needs_native_identity") {
      // Only the database-verified account supplies identity/role attributes.
      // A create timeout or existing email is resolved by re-reading the same
      // identity; never delete or overwrite a possibly existing Auth user.
      if (session.authUserId) return passwordReconciliationError(null);
      const canonicalUsername = String(prepared.row.username || "");
      const legacyId = Number(prepared.row.legacy_user_id || 0);
      if (!/^[a-z0-9_]+$/.test(canonicalUsername) || !Number.isInteger(legacyId) || legacyId <= 0) return passwordReconciliationError(null);
      try {
        await supabase.auth.admin.createUser({
          email: `${canonicalUsername}@greenleafnursery.com`, password: newPassword, email_confirm: true,
          app_metadata: { role: String(prepared.row.role || "User"), legacy_user_id: legacyId },
          user_metadata: { username: canonicalUsername },
        });
      } catch { /* The next prepare resolves an ambiguous create outcome. */ }
      prepared = await prepare(null);
      if (prepared.error) return passwordReconciliationError(prepared.error);
    }
    const profile = prepared.row;
    if (!profile?.profile_id || !profile.attempt_id || !profile.username || !profile.role) return retryResponse();
    if (session.authUserId && session.authUserId !== String(profile.profile_id)) return passwordReconciliationError(null);
    let completed = profile;
    if (profile.status !== "completed") {
      if (profile.status !== "ready" || profile.must_change_password !== true) return retryResponse();
      if (!await isAppAccountActive(supabase, { id: String(profile.profile_id) })) return errorResponse("This account is no longer active.", 403, { code: "ACCOUNT_INACTIVE" });
      const { error: nativePasswordError } = await supabase.auth.admin.updateUserById(String(profile.profile_id), { password: newPassword });
      if (nativePasswordError) return retryResponse();
      if (!await isAppAccountActive(supabase, { id: String(profile.profile_id) })) return errorResponse("This account is no longer active.", 403, { code: "ACCOUNT_INACTIVE" });
      const { data: completedData, error: completeError } = await supabase.rpc("complete_password_change_profile", {
        p_attempt_id: String(profile.attempt_id), p_auth_user_id: String(profile.profile_id),
        p_password: newPassword, p_password_fingerprint: fingerprint,
      });
      completed = (Array.isArray(completedData) ? completedData[0] : completedData) as Record<string, unknown>;
      if (completeError) return retryResponse();
    }
    if (completed?.status !== "completed" || completed.profile_id !== profile.profile_id
      || Number(completed.legacy_user_id) !== Number(profile.legacy_user_id) || completed.must_change_password !== false
      || completed.username !== profile.username || !completed.role) return retryResponse();

    nextSession = await createAppSession({
      username: String(completed.username),
      displayName: String(completed.display_name || completed.username),
      role: String(completed.role || "User"), mustChangePassword: false,
    });
  } catch { return retryResponse(); }

  return jsonResponse({
    ok: true,
    session: {
      token: nextSession.token,
      username: nextSession.claims.username,
      displayName: nextSession.claims.displayName,
      role: nextSession.claims.role,
      expiresAt: nextSession.claims.exp * 1000,
      mustChangePassword: false,
    },
  });
}

async function handleDb(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  const protectedTable = String(payload.table || "").trim().toLowerCase();
  const protectedMethod = String(payload.method || "GET").toUpperCase();
  if (protectedTable === "ph_sales_credit_requests" || protectedTable.startsWith("ph_credit_") || protectedTable === "ph_inventory_transactions"
    || (["ph_request_history", "ph_requests_completed_history"].includes(protectedTable) && protectedMethod === "GET")
    || protectedTable === "ph_production_workflow_rows") {
    return errorResponse("Update the app to use the protected workflow.", 410, { code: "SALES_WORKFLOW_API_REQUIRED" });
  }

  if (!session) return errorResponse("Unauthorized", 401);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });

  const table = normalizeTableName(String(payload.table || "").trim());
  const method = String(payload.method || "GET").trim().toUpperCase();
  let body = Object.prototype.hasOwnProperty.call(payload, "body") ? payload.body : null;
  let query = String(payload.query || "").trim();

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return errorResponse("Unsupported method.", 400);
  const customerRequestWriteError = protectCustomerRequestDbWrite(table, method, body);
  if (customerRequestWriteError) return customerRequestWriteError;
  if (table === "ph_master_inventory" && method === "GET") {
    return errorResponse("Use the role-checked inventory_read operations.", 410, { code: "INVENTORY_READ_API_REQUIRED" });
  }
  if (table === "ph_customer_consignee_sales_reps" && method === "GET") {
    // The source JSON is returned only by the Admin/Manager detail RPC. The
    // generic compatibility read uses service credentials, so pin its column
    // projection even when a legacy caller asks for `*` or raw_data.
    const safeMappingColumns = new Set([
      "unique_id", "customeridentityid", "customername", "customerstatus", "consigneeid", "consigneename",
      "consigneestatus", "salesrepid", "salesrepname", "territorycode", "territorydesc", "updated_at",
      "mapping_revision", "mapping_updated_by",
    ]);
    const mappingParams = new URLSearchParams(query);
    const allowedMappingQueryKeys = new Set([...safeMappingColumns, "select", "order", "limit", "offset"]);
    if (query.length > 2000 || [...mappingParams.keys()].some((key) => !allowedMappingQueryKeys.has(key))) {
      return errorResponse("Unsupported customer mapping query.", 400, { code: "CUSTOMER_REP_MAPPING_QUERY_INVALID" });
    }
    const invalidOrder = mappingParams.getAll("order").some((orderValue) => orderValue.split(",").some((part) => {
      const [column, direction, nulls] = part.trim().split(".");
      return !column || !safeMappingColumns.has(column)
        || ![undefined, "asc", "desc"].includes(direction)
        || ![undefined, "nullsfirst", "nullslast"].includes(nulls);
    }));
    if (invalidOrder) {
      return errorResponse("Unsupported customer mapping sort.", 400, { code: "CUSTOMER_REP_MAPPING_QUERY_INVALID" });
    }
    for (const key of ["limit", "offset"]) {
      const values = mappingParams.getAll(key);
      if (values.some((value) => !/^\d{1,6}$/.test(value) || Number(value) > 1_000_000)) {
        return errorResponse("Unsupported customer mapping page.", 400, { code: "CUSTOMER_REP_MAPPING_QUERY_INVALID" });
      }
    }
    query = withSelect(query,
      "unique_id,customeridentityid,customername,customerstatus,consigneeid,consigneename,consigneestatus,salesrepid,salesrepname,territorycode,territorydesc,updated_at,mapping_revision,mapping_updated_by");
  }
  if (method === "GET") {
    if (!hasTableReadAccess(session.role, table, session.username)) return errorResponse("Forbidden", 403);
  } else if (!hasTableWriteAccess(session.role, table, method, body, session.username)) {
    return errorResponse("Forbidden", 403);
  }
  if (table === "ph_requests_pending" && method === "POST") {
    const internalRequestError = await authorizeInternalCustomerRequestInsert(session, body);
    if (internalRequestError) return internalRequestError;
    body = stampInternalCustomerRequestSource(body);
    if (!body) return errorResponse("Create requests through the authorized request batch operation.", 410, { code: "REQUEST_BATCH_API_REQUIRED" });
  }

  if (table === "ph_app_users" && method === "GET") {
    query = withSelect(query, "username,role");
    const params = new URLSearchParams(query);
    params.set("order", "username.asc");
    params.set("limit", "1000");
    query = params.toString();
  }

  if (table === AV_OPTION_EVAL_REQUESTS_TABLE) {
    const prepared = prepareAvOptionEvalDbRequest(session, method, query, body);
    if (prepared.error) return prepared.error;
    query = prepared.query;
    body = prepared.body;
  }

  const response = await restRequest(table, method, query, body);
  const responsePayload = await readResponsePayload(response);
  if (!response.ok) {
    return errorResponse("Database request failed.", response.status, { details: responsePayload });
  }
  return jsonResponse({ ok: true, data: responsePayload });
}

const INVENTORY_MASTER_INITIAL_FIELDS = MASTER_INITIAL_FIELDS;
const INVENTORY_MASTER_INITIAL_BASE_FIELDS = MASTER_INITIAL_BASE_FIELDS;
const INVENTORY_MASTER_FULL_FIELDS = MASTER_FULL_FIELDS;
const INVENTORY_MASTER_BROWSE_FIELDS = MASTER_BROWSE_FIELDS;
const INVENTORY_NCR_ASSIGNMENT_TYPES = new Set(["new-crop", "move-up", "move-down", "hold-release", "recount"]);
const INVENTORY_NCR_FIRST_STAGE_USERS = new Set(["dylan_collyge", "megan_kelly", "jd_jones"]);
const INVENTORY_NCR_JD_STAGE_USERS = new Set(["jd_jones", "megan_kelly", "dylan_collyge"]);
const INVENTORY_NOT_ON_INVENTORY_ASSIGNMENTS = new Set(["not_on_inventory_dylan", "not_on_inventory_jd"]);
const MANAGER_APPROVAL_VIEW_TYPES: Record<string, string> = {
  "ncr-approvals": "new-crop", "move-up-approvals": "move-up", "move-down-approvals": "move-down",
  "hold-release-approvals": "hold-release", "recount-approvals": "recount",
};
const MANAGER_NOT_ON_INVENTORY_APPROVAL_VIEW = "not-on-inventory-approvals";
const INVENTORY_SCHEMA_CAPABILITY_FIELDS: Record<string, string> = {
  evalTask: "eval_task_type,eval_task_status,eval_task_instructions,eval_task_assigned_by,eval_task_assigned_at,eval_task_completed_by,eval_task_completed_at,eval_task_recount_qty,eval_task_moved_up_qty,eval_task_hold_action,eval_task_hold_code,eval_task_hold_reason,eval_task_result_note",
  ncrApproval: "ncr_approval_type,ncr_requested_by_username,ncr_requested_by_display,ncr_requested_by_email,ncr_requested_at,ncr_approval_message",
  holdRelease: "hold_release_approved_at,hold_release_approved_by,hold_release_approved_by_display,hold_release_approved_holdstopbegindate",
  avRules: "av_rule_bundle_updated_at,av_rule_priority_snapshot,av_rule_holdstop_snapshot",
  flyerShadow: "flyer_av_note,flyer_match,flyer_loc_match_qty,flyer_spec,flyer_caliper,flyer_pick,flyer_initial_ptr,flyer_photo_link,flyer_photo_name",
};

function inventoryReadParams(payload: Record<string, unknown>, allowed: string[]) {
  if (payload.params !== undefined && (!payload.params || typeof payload.params !== "object" || Array.isArray(payload.params))) throw new Error("INVENTORY_READ_PARAMETERS_INVALID");
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown>
    : {};
  if (Object.keys(payload).some((key) => !["action", "operation", "params"].includes(key))) throw new Error("INVENTORY_READ_PAYLOAD_INVALID");
  if (Object.keys(params).some((key) => !allowed.includes(key))) throw new Error("INVENTORY_READ_PARAMETERS_INVALID");
  return params;
}

function inventoryReadPageBounds(params: Record<string, unknown>, maxLimit = 500) {
  const requestedLimit = Number(params.limit ?? 250);
  const requestedOffset = Number(params.offset ?? 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > 2_000_000) {
    throw new Error("INVENTORY_READ_PAGE_INVALID");
  }
  return { limit: Math.min(maxLimit, requestedLimit), offset: requestedOffset };
}

function inventoryActorQueueAssignments(username: string) {
  const safeUsername = normalizeUsername(username);
  const allowed = new Set<string>();
  for (const type of INVENTORY_NCR_ASSIGNMENT_TYPES) {
    if (INVENTORY_NCR_FIRST_STAGE_USERS.has(safeUsername)) allowed.add(`ncr_approval_${type.replace(/-/g, "_")}_dylan`);
    if (INVENTORY_NCR_JD_STAGE_USERS.has(safeUsername)) allowed.add(`ncr_approval_${type.replace(/-/g, "_")}_jd`);
    if (INVENTORY_NCR_FIRST_STAGE_USERS.has(safeUsername) || INVENTORY_NCR_JD_STAGE_USERS.has(safeUsername)) {
      allowed.add(`ncr_outbox_${type.replace(/-/g, "_")}`);
    }
  }
  if (INVENTORY_NCR_FIRST_STAGE_USERS.has(safeUsername)) allowed.add("not_on_inventory_dylan");
  if (INVENTORY_NCR_JD_STAGE_USERS.has(safeUsername)) allowed.add("not_on_inventory_jd");
  return allowed;
}

function inventoryReadQuery(actor: Record<string, unknown>, fields: string, includeCount = true, head = false) {
  let query = supabase.from("ph_master_inventory").select(fields, includeCount ? { count: "exact", head } : {});
  const role = String(actor.role || "").trim();
  const compactRole = role.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (compactRole.includes("FOREMAN")) {
    query = query.not("priority", "is", null).not("priority", "in", "(,-,--,---,N/A,NA,NULL,NONE)");
  }
  return query;
}
async function handleInventoryRead(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  canonicalAccess: CanonicalUserAccess | null = null,
  revisionRetry = false,
) {
  if (!session) return errorResponse("Unauthorized", 401);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try {
    actor = await resolveActiveSessionProfile(session);
  } catch {
    return retainedReadResponse("INVENTORY_READ_PROFILE_PENDING");
  }
  const username = normalizeUsername(String(actor.username || ""));
  const role = String(session.role || "");
  actor.role = role;
  const operation = String(payload.operation || "").trim().toLowerCase();
  const readParams = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown> : {};
  const canonicalInventoryAccess = canonicalInventoryReadAllowed(canonicalAccess, operation, readParams);
  if (!hasTableReadAccess(role, "ph_master_inventory", username) && !canonicalInventoryAccess) {
    return errorResponse("Forbidden", 403, { code: "INVENTORY_READ_FORBIDDEN" });
  }

  try {
    if (operation === "source_freshness") {
      inventoryReadParams(payload, []);
      const { data, error } = await inventoryReadQuery(actor, "filename,last_updated", false)
        .not("last_updated", "is", null)
        .order("last_updated", { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) throw error;
      const row = projectInventoryRows(data, "filename,last_updated")[0];
      return jsonResponse({ ok: true, data: { filename: row && !Array.isArray(row) && typeof row === "object" ? row.filename ?? null : null, last_updated: row && !Array.isArray(row) && typeof row === "object" ? row.last_updated ?? null : null } });
    }

    if (operation === "schema_capabilities") {
      const params = inventoryReadParams(payload, []);
      const capabilities: Record<string, { available: boolean }> = {};
      await Promise.all(Object.entries(INVENTORY_SCHEMA_CAPABILITY_FIELDS).map(async ([key, fields]) => {
        const { error } = await supabase.from("ph_master_inventory").select(fields).limit(0);
        capabilities[key] = { available: !error };
      }));
      return jsonResponse({ ok: true, data: { status: "checked", capabilities } });
    }

    if (operation === "master_page") {
      const params = inventoryReadParams(payload, ["dataset", "projection", "uniqueId", "itemCode", "locationCode", "lotCode", "source", "season", "limit", "offset"]);
      const { limit, offset } = inventoryReadPageBounds(params, 1000);
      if (offset === 0) {
        const reconciliation = await supabase.rpc("reconcile_inventory_location_evidence_v1");
        if (reconciliation.error) console.warn("INVENTORY_LOCATION_EVIDENCE_RECONCILIATION_DEFERRED", reconciliation.error.code || reconciliation.error.message);
      }
      const dataset = String(params.dataset || "").trim();
      const projection = String(params.projection || "initial").trim();
      if (!["master", "avOpen", "lookup"].includes(dataset) || !["initial", "initial_base", "browse", "full"].includes(projection)) throw new Error("INVENTORY_READ_OPERATION_INVALID");
      const uniqueId = String(params.uniqueId || "").trim();
      const itemCode = String(params.itemCode || "").trim();
      const locationCode = String(params.locationCode || "").trim();
      const lotCode = String(params.lotCode || "").trim();
      const source = String(params.source || "").trim();
      const season = String(params.season || "").trim();
      if (dataset === "lookup" && !uniqueId && !itemCode) throw new Error("INVENTORY_READ_FILTER_REQUIRED");
      const hasLookupScope = Boolean(locationCode || lotCode || source);
      const pairLookup = Boolean(itemCode && locationCode && !lotCode && !source);
      const exactRowLookup = Boolean(locationCode && lotCode && source);
      if (dataset === "lookup" && !uniqueId && hasLookupScope && !pairLookup && !exactRowLookup) throw new Error("INVENTORY_READ_FILTER_INVALID");
      if (dataset !== "lookup" && (uniqueId || itemCode || locationCode || lotCode || source || season)) throw new Error("INVENTORY_READ_FILTER_INVALID");
      if (dataset === "avOpen" && projection === "initial") throw new Error("INVENTORY_READ_PROJECTION_INVALID");
      if (dataset === "avOpen" && season) throw new Error("INVENTORY_READ_FILTER_INVALID");
      const inventoryRevision = await captureReadyInventoryLocationRevision(String(actor.id || ""));
      const fields = projection === "browse" ? INVENTORY_MASTER_BROWSE_FIELDS
        : dataset === "avOpen" || projection === "full" ? INVENTORY_MASTER_FULL_FIELDS
        : projection === "initial_base" ? INVENTORY_MASTER_INITIAL_BASE_FIELDS : INVENTORY_MASTER_INITIAL_FIELDS;
      let response = inventoryReadQuery(actor, fields);
      if (dataset === "avOpen") response.in("season", ["F1", "S1", "U1", "U2"]);
      if (dataset === "lookup") {
        if (uniqueId) response.eq("unique_id", uniqueId);
        else {
          response.eq("itemcode", itemCode);
          if (locationCode) response.eq("locationcode", locationCode);
          if (exactRowLookup) response.eq("lotcode", lotCode).eq("source", source);
        }
      }
      if (season) response.eq("season", season);
      response = response.order("unique_id", { ascending: true }).range(offset, offset + limit - 1);
      const { data, error, count } = await response;
      if (error) throw error;
      const projected = projectInventoryRows(data, fields);
      const batches = [projected.slice(0, 500), ...(projected.length > 500 ? [projected.slice(500)] : [])];
      const rows = (await Promise.all(batches.map(batch =>
        enrichInventoryLocationRows(supabase, String(actor.id || ""), batch, inventoryRevision)))).flat();
      return jsonResponse({ ok: true, data: { rows, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count,
        inventoryRevision, projection, fieldCoverage: projection === "browse" ? "browse" : dataset === "avOpen" || projection === "full" ? "full" : "initial", columns: fields.split(",") } });
    }

    if (operation === "master_identity_batch") {
      const params = inventoryReadParams(payload, ["queueIdentities", "expectedInventoryRevision"]);
      if (!Array.isArray(params.queueIdentities) || params.queueIdentities.length < 1 || params.queueIdentities.length > 100) {
        throw new Error("INVENTORY_READ_IDENTITY_BATCH_INVALID");
      }
      const requestedRevision = params.expectedInventoryRevision === undefined || params.expectedInventoryRevision === null
        ? null : String(params.expectedInventoryRevision).trim();
      if (requestedRevision !== null && !/^[1-9]\d*$/.test(requestedRevision)) throw new Error("INVENTORY_READ_REVISION_INVALID");
      const { data, error } = await supabase.rpc("inventory_master_identity_batch_read_v1", {
        p_actor_id: String(actor.id || ""), p_queue_identities: params.queueIdentities as Json,
        p_expected_revision: requestedRevision ?? undefined,
      });
      if (error) throw new Error(/MASTER_IDENTITY/i.test(error.message) ? error.message : "MASTER_IDENTITY_READ_FAILED");
      const result = jsonObject(data);
      if (result.retryable === true) return jsonResponse({ ok: true, data: {
        rows: [], total: 0, retained: true, retryable: true,
        revisionChanged: result.revisionChanged === true, sourceNotReady: result.sourceNotReady === true,
        inventoryRevision: String(result.inventoryRevision || requestedRevision || ""),
      } });
      const inventoryRevision = String(result?.inventoryRevision || "");
      if (!/^[1-9]\d*$/.test(inventoryRevision) || (requestedRevision !== null && requestedRevision !== inventoryRevision)
        || !result || !Array.isArray(result.rows)
        || result.rows.length !== params.queueIdentities.length) throw new Error("MASTER_IDENTITY_RESPONSE_INVALID");
      const resolved: Array<{ inputIndex: number; matchCount: number; sourceRow: Json | null }> = [];
      for (let index = 0; index < result.rows.length; index += 1) {
        const entry = jsonObject(result.rows[index]);
        if (!entry || entry.inputIndex !== index || ![0, 1, 2].includes(Number(entry.matchCount))) throw new Error("MASTER_IDENTITY_RESPONSE_INVALID");
        const matchCount = Number(entry.matchCount);
        if (matchCount === 1) {
          if (!entry.row || typeof entry.row !== "object" || Array.isArray(entry.row)) throw new Error("MASTER_IDENTITY_RESPONSE_INVALID");
          resolved.push({ inputIndex: index, matchCount, sourceRow: entry.row as Json });
        } else {
          if (entry.row !== null) throw new Error("MASTER_IDENTITY_RESPONSE_INVALID");
          resolved.push({ inputIndex: index, matchCount, sourceRow: null });
        }
      }
      const uniqueRows = resolved.filter((entry): entry is typeof entry & { sourceRow: Json } => entry.sourceRow !== null);
      const projectedRows = projectInventoryRows(uniqueRows.map(entry => entry.sourceRow), INVENTORY_MASTER_FULL_FIELDS);
      const enrichedRows = await enrichInventoryLocationRows(supabase, String(actor.id || ""), projectedRows, inventoryRevision);
      let enrichedIndex = 0;
      const rows = resolved.map(entry => ({ inputIndex: entry.inputIndex, matchCount: entry.matchCount,
        row: entry.matchCount === 1 ? enrichedRows[enrichedIndex++] : null }));
      return jsonResponse({ ok: true, data: { rows, inventoryRevision, projection: "full", fieldCoverage: "full",
        columns: INVENTORY_MASTER_FULL_FIELDS.split(",") } });
    }

    if (operation === "master_delta") {
      const params = inventoryReadParams(payload, ["since", "limit", "offset"]);
      const { limit, offset } = inventoryReadPageBounds(params);
      const since = String(params.since || "").trim();
      if (!since || !Number.isFinite(Date.parse(since))) throw new Error("INVENTORY_READ_SINCE_INVALID");
      const inventoryRevision = await captureReadyInventoryLocationRevision(String(actor.id || ""));
      const response = inventoryReadQuery(actor, INVENTORY_MASTER_FULL_FIELDS);
      response.gt("last_updated", since);
      response.order("unique_id", { ascending: true }).range(offset, offset + limit - 1);
      const { data, error, count } = await response;
      if (error) throw error;
      const rows = await enrichInventoryLocationRows(supabase, String(actor.id || ""), projectInventoryRows(data, INVENTORY_MASTER_FULL_FIELDS), inventoryRevision);
      return jsonResponse({ ok: true, data: { rows, inventoryRevision, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count } });
    }

    if (operation === "po_detail") {
      const params = inventoryReadParams(payload, ["itemCode", "contSize", "limit", "offset"]);
      const { limit, offset } = inventoryReadPageBounds(params);
      const itemCode = String(params.itemCode || "").trim();
      const contSize = String(params.contSize || "").trim();
      if (!itemCode || !contSize) throw new Error("PO_DETAIL_FILTER_REQUIRED");
      if (!await resolveModuleAllowed(supabase, actor, "po-management")) return errorResponse("Forbidden", 403, { code: "PO_ACCESS_FORBIDDEN" });
      const response = inventoryReadQuery(actor, INVENTORY_PO_DETAIL_FIELDS);
      response.eq("itemcode", itemCode).eq("contsize", contSize);
      response.order("unique_id", { ascending: true }).range(offset, offset + limit - 1);
      const { data, error, count } = await response;
      if (error) throw error;
      const rows = projectInventoryRows(data, INVENTORY_PO_DETAIL_FIELDS);
      return jsonResponse({ ok: true, data: { rows, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count } });
    }

    if (operation === "recount_queue" || operation === "ncr_queue" || operation === "not_on_inventory_queue") {
      const allowedParams = operation === "ncr_queue" ? ["queueType", "assignment", "limit", "offset"]
        : operation === "not_on_inventory_queue" ? ["assignment", "limit", "offset"] : ["limit", "offset"];
      const params = inventoryReadParams(payload, allowedParams);
      const { limit, offset } = inventoryReadPageBounds(params);
      let assignment = "ncr_inventory_recount";
      let fields = INVENTORY_MASTER_FULL_FIELDS;
      let updatedAtFirst = true;
      if (operation === "ncr_queue") {
        const queueType = String(params.queueType || "").trim();
        assignment = String(params.assignment || "").trim().toLowerCase();
        if (!INVENTORY_NCR_ASSIGNMENT_TYPES.has(queueType)) throw new Error("NCR_QUEUE_TYPE_INVALID");
        const expected = inventoryActorQueueAssignments(username);
        const assignmentType = queueType.replace(/-/g, "_");
        if (!expected.has(assignment) || ![`ncr_approval_${assignmentType}_dylan`, `ncr_approval_${assignmentType}_jd`, `ncr_outbox_${assignmentType}`].includes(assignment)) {
          return errorResponse("Forbidden", 403, { code: "QUEUE_ASSIGNMENT_FORBIDDEN" });
        }
        fields = INVENTORY_NCR_QUEUE_FIELDS;
        updatedAtFirst = false;
      } else if (operation === "not_on_inventory_queue") {
        assignment = String(params.assignment || "").trim().toLowerCase();
        if (!INVENTORY_NOT_ON_INVENTORY_ASSIGNMENTS.has(assignment) || !inventoryActorQueueAssignments(username).has(assignment)) {
          return errorResponse("Forbidden", 403, { code: "QUEUE_ASSIGNMENT_FORBIDDEN" });
        }
        fields = INVENTORY_NOT_ON_INVENTORY_FIELDS;
        updatedAtFirst = false;
      } else if (!FULL_ACCESS_USER_KEYS.has(username) && !getRoleAccessState(role).isAdmin && !getRoleAccessState(role).isQcSupervisor) {
        return errorResponse("Forbidden", 403, { code: "QUEUE_ASSIGNMENT_FORBIDDEN" });
      }
      const inventoryRevision = await captureReadyInventoryLocationRevision(String(actor.id || ""));
      let query = supabase.from("ph_master_inventory").select(fields, { count: "exact" }).eq("app_tab_assignment", assignment);
      if (updatedAtFirst) query = query.order("last_updated", { ascending: false, nullsFirst: false }).order("unique_id", { ascending: true });
      else query = query.order("unique_id", { ascending: true });
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw error;
      const rows = await enrichInventoryLocationRows(supabase, String(actor.id || ""), projectInventoryRows(data, fields), inventoryRevision);
      return jsonResponse({ ok: true, data: { rows, inventoryRevision, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count } });
    }

    if (operation === "verify_row") {
      const params = inventoryReadParams(payload, ["kind", "uniqueId", "expectedAssignment", "expectedAssignee"]);
      const kind = String(params.kind || "").trim();
      const uniqueId = String(params.uniqueId || "").trim();
      const assignment = String(params.expectedAssignment || "").trim().toLowerCase();
      const assignee = normalizeUsername(String(params.expectedAssignee || ""));
      if (!["ncr_approval", "not_on_inventory"].includes(kind) || !uniqueId || !assignment) throw new Error("INVENTORY_ROW_VERIFICATION_INVALID");
      const actorAssignments = inventoryActorQueueAssignments(username);
      if (!actorAssignments.has(assignment)) return errorResponse("Forbidden", 403, { code: "QUEUE_ASSIGNMENT_FORBIDDEN" });
      if (kind === "not_on_inventory" && !INVENTORY_NOT_ON_INVENTORY_ASSIGNMENTS.has(assignment)) throw new Error("INVENTORY_ROW_VERIFICATION_INVALID");
      const { data, error } = await supabase.from("ph_master_inventory").select("unique_id,app_tab_assignment,assignedto").eq("unique_id", uniqueId).maybeSingle();
      if (error) throw error;
      const row = data;
      if (!row) return jsonResponse({ ok: true, data: { status: "missing", matches: false } });
      const assignmentMatches = String(row.app_tab_assignment || "").trim().toLowerCase() === assignment;
      const assigneeMatches = !Object.prototype.hasOwnProperty.call(params, "expectedAssignee")
        || normalizeUsername(String(row.assignedto || "")) === assignee;
      const matches = assignmentMatches && assigneeMatches;
      return jsonResponse({ ok: true, data: { status: matches ? "matched" : "mismatch", matches } });
    }

    return errorResponse("Unsupported inventory read operation.", 400, { code: "INVENTORY_READ_OPERATION_INVALID" });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error || "INVENTORY_READ_FAILED");
    if (message.includes("LOC_ON_HAND_REVISION_CHANGED")) {
      if (!revisionRetry) return await handleInventoryRead(session, payload, canonicalAccess, true);
      return jsonResponse({ ok: true, data: { rows: [], total: 0, retained: true, retryable: true, revisionChanged: true } });
    }
    const locationFailure = inventoryLocationReadFailureResponse(error);
    if (locationFailure) return locationFailure;
    if (message.includes("MASTER_IDENTITY_SOURCE_NOT_READY")) return jsonResponse({ ok:true, code:"MASTER_IDENTITY_SOURCE_NOT_READY",
      retained:true, retryable:true, data:{ rows:[], total:0, retained:true, retryable:true, source:"ph_master_inventory" } });
    if (message.includes("MASTER_IDENTITY_REVISION_CHANGED")) return jsonResponse({ ok:true, data:{ rows:[], total:0, retained:true, retryable:true } });
    if (/PAYLOAD_INVALID|PARAMETERS_INVALID|PAGE_INVALID|OPERATION_INVALID|FILTER_INVALID|FILTER_REQUIRED|PROJECTION_INVALID|SINCE_INVALID|TYPE_INVALID|VERIFICATION_INVALID|IDENTITY_BATCH_INVALID|IDENTITY_REVISION_INVALID|IDENTITY_QUEUE_INVALID/.test(message)) {
      return errorResponse("Invalid inventory read request.", 400, { code: message });
    }
    return retainedReadResponse("INVENTORY_READ_FAILED");
  }
}

const AURA_V2_OPERATIONS = new Set(["catalog", "count", "maximum", "lots", "validate_draft", "match", "resolve_query", "crop_tier"]);
const AURA_V2_METRICS = new Set(["ptravailable", "ptronhand"]);
const AURA_V2_SEASONS = new Set(["S1", "F1", "U1", "U2", "U3", "X", "Y", "Z"]);

export { auraInventoryV2ProfileMatches };

export function parseAuraInventoryV2Request(payload: Record<string, unknown>) {
  const allowed = new Set(["action", "operation", "itemcode", "commonName", "contSize", "locationCode", "metric", "openStockOnly", "quantity", "season", "cursor", "limit", "lines", "question", "cropTier"]);
  if (Object.keys(payload).some(key => !allowed.has(key))) throw new Error("AURA_V2_REQUEST_INVALID");
  const operation = String(payload.operation || "").trim().toLowerCase();
  const itemcode = String(payload.itemcode || "").trim();
  const commonName = String(payload.commonName || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const contSize = String(payload.contSize || "").trim();
  const locationCode = String(payload.locationCode || "").trim();
  const metric = String(payload.metric || "ptravailable").trim().toLowerCase();
  const season = payload.season == null || payload.season === "" ? null : String(payload.season).trim().toUpperCase();
  const openStockOnly = payload.openStockOnly === undefined ? false : payload.openStockOnly;
  const quantity = payload.quantity == null || payload.quantity === "" ? null : auraNumber(payload.quantity);
  const limit = payload.limit == null ? 100 : Number(payload.limit);
  const cursor = payload.cursor == null ? null : payload.cursor;
  const lines = payload.lines == null ? [] : payload.lines;
  const question = String(payload.question || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const cropTier = String(payload.cropTier || "").trim().toUpperCase();
  if (!Array.isArray(lines)) throw new Error("AURA_V2_REQUEST_INVALID");
  if (!AURA_V2_OPERATIONS.has(operation) || !AURA_V2_METRICS.has(metric)
    || typeof openStockOnly !== "boolean"
    || (season !== null && !AURA_V2_SEASONS.has(season))
    || (cropTier && !["CARRY_OVER", "CURRENT_CROP", "FUTURE_CROP"].includes(cropTier))
    || itemcode.length > 100 || commonName.length > 160 || contSize.length > 48 || locationCode.length > 64 || question.length > 300
    || !Number.isInteger(limit) || limit < 1 || limit > 500
    || (cursor !== null && (!cursor || typeof cursor !== "object" || Array.isArray(cursor)))) {
    throw new Error("AURA_V2_REQUEST_INVALID");
  }
  const cursorKeys = cursor && Object.keys(cursor as Record<string, unknown>).sort().join(",");
  if ((operation === "catalog" && cursor !== null && cursorKeys !== "contsize,itemcode")
    || (operation === "count" && cursor !== null && cursorKeys !== "unique_id")
    || (operation === "lots" && cursor !== null && cursorKeys !== "priority,unique_id")
    || (["maximum", "validate_draft", "match", "resolve_query", "crop_tier"].includes(operation) && cursor !== null)) {
    throw new Error("AURA_V2_CURSOR_INVALID");
  }
  if (["count", "lots"].includes(operation) && !itemcode) throw new Error("AURA_V2_ITEMCODE_REQUIRED");
  if (operation === "match" && !commonName) throw new Error("AURA_V2_NAME_REQUIRED");
  if (operation === "resolve_query" && !question) throw new Error("AURA_QUERY_TEXT_REQUIRED");
  if (operation === "crop_tier" && !cropTier) throw new Error("AURA_CROP_TIER_INVALID");
  if (operation === "lots" && (quantity == null || !Number.isInteger(quantity) || quantity < 1 || quantity > 999_999)) throw new Error("AURA_V2_QUANTITY_INVALID");
  if (operation !== "lots" && quantity != null && (quantity <= 0 || quantity > 999_999)) throw new Error("AURA_V2_QUANTITY_INVALID");
  if (operation === "validate_draft") {
    const lineKeys = new Set(["unique_id", "itemcode", "commonname", "contsize", "locationcode", "lotcode", "quantity"]);
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50 || lines.some(line =>
      !line || typeof line !== "object" || Array.isArray(line) || Object.keys(line).some(key => !lineKeys.has(key))
      || !Number.isInteger(auraNumber((line as Record<string, unknown>).quantity))
      || Number(auraNumber((line as Record<string, unknown>).quantity)) < 1
      || Number(auraNumber((line as Record<string, unknown>).quantity)) > 999_999)) {
      throw new Error("AURA_V2_DRAFT_INVALID");
    }
  } else if (Array.isArray(lines) && lines.length) {
    throw new Error("AURA_V2_REQUEST_INVALID");
  }
  return { operation, itemcode, commonName, contSize, locationCode, metric, openStockOnly, quantity, season, cursor, limit, lines, question,
    cropTier: cropTier ? cropTier as "CARRY_OVER" | "CURRENT_CROP" | "FUTURE_CROP" : undefined };
}

const AURA_INVENTORY_FIELDS = "unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,ptrreviewed,priority,ptronhand,s_lts,season,saleyear,desigitem,app_tab_assignment";
const AURA_MAX_INVENTORY_ROWS = 5000;
const AURA_INVENTORY_PAGE_SIZE = 500;

export function parseAuraDeterministicInventoryQuestion(value: unknown) {
  const question = String(value || "").normalize("NFKC").trim();
  if (!question || !/\b(?:inventory|stock|available|on[ -]?hand|review|location|lot|where|how many|carry[ -]?over|current crop|future crop|consolidat(?:e|ion))\b/i.test(question)) return null;
  const cropTier = /\b(?:carry[ -]?over|older sales year)\b/i.test(question) ? "CARRY_OVER"
    : /\b(?:current crop|current sales year)\b/i.test(question) ? "CURRENT_CROP"
    : /\b(?:future crop|future sales year|next year crop)\b/i.test(question) ? "FUTURE_CROP" : "";
  const sizeMatch = question.match(/(?:^|\s)(#\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:DP|GP|SP|QT|PT|GAL|G))(?![A-Z0-9])/i);
  const locationMatch = question.match(/\b[A-Z]\.\d{2}(?:\.\d{3})?\b/i);
  const itemCodeMatch = question.match(/\b(?:item\s*code|itemcode)\s*(?:#|:)?\s*([A-Z0-9][A-Z0-9._-]{1,99})\b/i);
  const seasonMatch = question.match(/\b(?:(\d{2,4})[.\s-]?)?(S1|F1|U1|U2|U3|X|Y|Z)\b/i);
  const salesYearMatch = question.match(/\b(?:sales\s*year|salesyear|year)\s*(?:<=?\s*)?(\d{1,4})\b/i);
  const metric = /\bopen stock\b/i.test(question) ? "openStock"
    : /\bon[ -]?hand\b/i.test(question) ? "onHand"
    : /\breview(?:ed)?\b/i.test(question) ? "review" : /\blocations?|\bwhere\b/i.test(question) ? "locations" : "available";
  const needsSeasonScope = !cropTier && (metric === "openStock" || /\b(?:how many|how much|count|inventory count)\b/i.test(question));
  const rawSalesYear = String(seasonMatch?.[1] || salesYearMatch?.[1] || "");
  const parsedSalesYear = rawSalesYear ? Number(rawSalesYear) : NaN;
  const salesYear = Number.isInteger(parsedSalesYear) && parsedSalesYear > 0
    ? (parsedSalesYear > 99 ? parsedSalesYear % 100 : parsedSalesYear) : (needsSeasonScope ? 27 : null);
  const season = String(seasonMatch?.[2] || (needsSeasonScope ? "F1" : "")).toUpperCase();
  const stripped = question
    .replace(/\b(?:item\s*code|itemcode)\s*(?:#|:)?\s*[A-Z0-9][A-Z0-9._-]{1,99}\b/ig, " ")
    .replace(/(?:^|\s)(?:#\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:DP|GP|SP|QT|PT|GAL|G))(?![A-Z0-9])/ig, " ")
    .replace(/\b[A-Z]\.\d{2}(?:\.\d{3})?\b/ig, " ")
    .replace(/\b(?:(?:\d{2,4})[.\s-]?)?(?:S1|F1|U1|U2|U3|X|Y|Z)\b/ig, " ")
    .replace(/\b(?:sales\s*year|salesyear|year)\s*(?:<=?\s*)?\d{1,4}\b/ig, " ")
    .replace(/\b(?:carry[ -]?over|older sales year|current crop|current sales year|future crop|future sales year|next year crop|inventory consolidation|inv consolidation|consolidate locations)\b/ig, " ")
    .replace(/\b(?:how many|how much|show me|find|check|what is|what are|do we have|are there|in open stock|open stock|on[ -]?hand|available|reviewed?|inventory|stock|locations?|lots?|where|current|total|units?|plants?|items?|of|the|for|at|in|by|please)\b/ig, " ")
    .replace(/[^A-Z0-9._#-]+/ig, " ").trim();
  const plantTerms = stripped.toLocaleLowerCase("en-US").split(/\s+/).filter(term => term.length > 1).slice(0, 8);
  if (!itemCodeMatch && !plantTerms.length && !cropTier) return null;
  return {
    question,
    itemcode: String(itemCodeMatch?.[1] || "").trim().toUpperCase(),
    plantTerms,
    contSize: String(sizeMatch?.[1] || "").replace(/\s+/g, "").toUpperCase(),
    locationCode: String(locationMatch?.[0] || "").trim().toUpperCase(),
    metric,
    season,
    salesYear,
    cropTier,
  };
}

async function resolveAuraDeterministicInventoryQuery(question: string, signal?: AbortSignal) {
  const parsed = parseAuraDeterministicInventoryQuestion(question);
  if (!parsed) throw new Error("AURA_QUERY_TEXT_REQUIRED");
  if (parsed.cropTier) {
    const { data, error } = await auraInventoryV2Rpc(supabase, {
      operation: "crop_tier",
      cropTier: parsed.cropTier as "CARRY_OVER" | "CURRENT_CROP" | "FUTURE_CROP",
      itemcode: parsed.itemcode || undefined,
      commonName: parsed.itemcode ? undefined : parsed.plantTerms.join(" ") || undefined,
      limit: 50,
    }, signal);
    if (error) throw error;
    return jsonObject(data);
  }
  const fetchedRows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < AURA_MAX_INVENTORY_ROWS; offset += AURA_INVENTORY_PAGE_SIZE) {
    let builder = supabase.from("ph_master_inventory").select(AURA_INVENTORY_FIELDS);
    if (parsed.itemcode) builder = builder.eq("itemcode", parsed.itemcode);
    else builder = builder.ilike("commonname", `%${auraSearchPattern(parsed.plantTerms[0])}%`);
    if (parsed.locationCode) builder = builder.ilike("locationcode", `${auraSearchPattern(parsed.locationCode)}%`);
    const pageQuery = builder.order("unique_id", { ascending: true }).range(offset, offset + AURA_INVENTORY_PAGE_SIZE - 1);
    const { data, error } = await (signal ? pageQuery.abortSignal(signal) : pageQuery);
    if (error) throw error;
    const page = Array.isArray(data) ? data.map(row => jsonObject(jsonValue(row))) : [];
    fetchedRows.push(...page);
    if (page.length < AURA_INVENTORY_PAGE_SIZE) break;
  }
  const normalized = (value: unknown) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9#]+/g, " ").trim();
  const salesYear = (value: unknown) => {
    const parsedYear = Number(String(value ?? "").replace(/\D/g, ""));
    return Number.isInteger(parsedYear) && parsedYear > 0 ? (parsedYear > 99 ? parsedYear % 100 : parsedYear) : null;
  };
  const rows = fetchedRows.filter(row => {
    const commonName = normalized(row.commonname || "");
    const lotMatch = String(row.lotcode || "").match(/(?:^|[^0-9])(\d{2,4})[.\s-](S1|F1|U1|U2|U3|X|Y|Z)(?:$|[^A-Z0-9])/i);
    const rowSeason = String(lotMatch?.[2] || row.season || "").trim().toUpperCase();
    const rowSalesYear = salesYear(lotMatch?.[1] || row.saleyear);
    if (parsed.itemcode && String(row.itemcode || "").trim().toUpperCase() !== parsed.itemcode) return false;
    if (!parsed.itemcode && !parsed.plantTerms.every(term => commonName.includes(normalized(term)))) return false;
    if (parsed.contSize && auraCanonicalSize(row.contsize) !== auraCanonicalSize(parsed.contSize)) return false;
    if (parsed.locationCode && !String(row.locationcode || "").trim().toUpperCase().startsWith(parsed.locationCode)) return false;
    if (parsed.season && rowSeason !== parsed.season) return false;
    if (parsed.salesYear != null && (rowSalesYear == null || rowSalesYear > parsed.salesYear)) return false;
    if (String(row.desigitem || "").toUpperCase().includes("SHFT")) return false;
    return !["not_on_inventory_dylan", "not_on_inventory_jd", "not_on_inventory_denied"].includes(String(row.app_tab_assignment || "").trim().toLowerCase());
  });
  return {
    ok: true,
    complete: fetchedRows.length < AURA_MAX_INVENTORY_ROWS,
    deterministic: true,
    metric: parsed.metric,
    season: parsed.season,
    salesYear: parsed.salesYear,
    checkedAt: new Date().toISOString(),
    rows,
  };
}

export async function handleAuraInventoryV2(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal; requestId?: string } = {},
) {
  const requestId = String(options.requestId || crypto.randomUUID()).slice(0, 96);
  if (!session) return errorResponse("Sign in with Dylan’s active account to use AURA.", 401, { code: "AURA_AUTH_REQUIRED" });
  if (session.mustChangePassword) return errorResponse("Complete the password change before using AURA.", 403, { code: "AURA_PROFILE_INACTIVE" });
  if (!session.authUserId || normalizeUsername(session.username || "") !== "dylan_collyge") {
    return errorResponse("AURA is available only to Dylan’s active account.", 403, { code: "AURA_FORBIDDEN" });
  }
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("Dylan’s active account profile could not be verified.", 403, { code: "AURA_PROFILE_INACTIVE" }); }
  if (options.signal?.aborted) return errorResponse("AURA inventory lookup was cancelled.", 499, { code: "AURA_REQUEST_CANCELLED", requestId });
  if (!auraInventoryV2ProfileMatches(session, actor)) {
    return errorResponse("AURA is available only to Dylan’s active account.", 403, { code: "AURA_FORBIDDEN" });
  }

  let input: ReturnType<typeof parseAuraInventoryV2Request>;
  try { input = parseAuraInventoryV2Request(payload); }
  catch (error) {
    const code = String(error instanceof Error ? error.message : "AURA_V2_REQUEST_INVALID");
    return errorResponse("AURA inventory request is invalid.", 400, { code });
  }

  const startedAt = performance.now();
  let timeoutStage = "database";
  const deadline = input.operation === "match" ? AbortSignal.timeout(4_500) : null;
  const rpcSignal = deadline && options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline || options.signal;
  try {
    if (input.operation === "resolve_query") {
      return jsonResponse({ ok: true, data: await resolveAuraDeterministicInventoryQuery(input.question, options.signal) });
    }
    timeoutStage = "database";
    const { data, error } = await auraInventoryV2Rpc(supabase, input, rpcSignal);
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return errorResponse("AURA inventory settings changed. Refresh the catalog and retry.", 409, { code: "AURA_V2_RESULT_INVALID", data });
    }
    const resultData = jsonObject(data);
    if (resultData.ok !== true) {
      return errorResponse("AURA inventory settings changed. Refresh the catalog and retry.", 409, { code: String(resultData.code || "AURA_V2_RESULT_INVALID"), data: resultData });
    }
    if (resultData.code === "AURA_ACTIVE_SEASON_REQUIRED") {
      return errorResponse("The active season changed. Refresh the inventory and review the draft again.", 409, { code: "AURA_ACTIVE_SEASON_REQUIRED", data });
    }

    if (input.operation !== "validate_draft" || resultData.valid !== true || !Array.isArray(resultData.rows) || !resultData.rows.length) {
      return jsonResponse({ ok: true, data: resultData });
    }
    const resultRows = resultData.rows.map((row) => jsonObject(row));

    const currentSettings = await readAuraSeasonSettings();
    if (currentSettings.season !== String(resultData.season || "").toUpperCase()
      || currentSettings.salesYear !== Number(resultData.salesYear)) {
      return errorResponse("The active season or sales year changed. Refresh the inventory and review the draft again.", 409, {
        code: "AURA_ACTIVE_SEASON_REQUIRED",
      });
    }

    // Re-read full inventory fields for the <=50 explicitly selected IDs so
    // the existing Bloom Picker editor receives its ordinary row contract.
    // This avoids returning every column through the SQL validation function.
    const selectedIds = resultRows.map((row) => String(row.unique_id || "").trim()).filter(Boolean);
    if (selectedIds.length !== resultRows.length || selectedIds.length > 50) {
      return errorResponse("AURA could not safely prepare those inventory rows. Review the selection again.", 409, { code: "AURA_V2_DRAFT_RESULT_INVALID" });
    }
    const fullRowsQuery = supabase.from("ph_master_inventory")
      .select(INVENTORY_MASTER_FULL_FIELDS).in("unique_id", selectedIds).limit(50);
    const { data: fullRows, error: fullRowsError } = await (options.signal
      ? fullRowsQuery.abortSignal(options.signal)
      : fullRowsQuery);
    if (fullRowsError) throw fullRowsError;
    const fullInventoryRows = Array.isArray(fullRows) ? fullRows.map((row) => jsonObject(jsonValue(row))) : [];
    const freshById = new Map(fullInventoryRows.map(row => [String(row.unique_id || ""), row]));
    const validatedRows: Record<string, unknown>[] = [];
    const failures = Array.isArray(resultData.failures) ? resultData.failures.map((row) => jsonObject(row)) : [];
    for (const line of input.lines || []) {
      const requested = jsonObject(line);
      const uid = String(requested.unique_id || "").trim();
      const row = freshById.get(uid);
      if (!row
        || String(row.itemcode || "").trim().toUpperCase() !== String(requested.itemcode || "").trim().toUpperCase()
        || auraCanonicalName(row.commonname) !== auraCanonicalName(requested.commonname)
        || auraCanonicalSize(row.contsize) !== auraCanonicalSize(requested.contsize)
        || String(row.locationcode || "").trim().toUpperCase() !== String(requested.locationcode || "").trim().toUpperCase()
        || String(row.lotcode || "").trim().toUpperCase() !== String(requested.lotcode || "").trim().toUpperCase()
         || auraCanonicalName(row.season) !== auraCanonicalName(resultData.season)
         || auraComparableSalesYear(row.saleyear) == null || auraComparableSalesYear(row.saleyear)! > Number(resultData.salesYear)
        || auraNumber(row.ptravailable) == null || auraNumber(row.s_lts) == null || auraNumber(row.s_lts)! <= 0
        || auraNumber(requested.quantity) == null || !Number.isInteger(auraNumber(requested.quantity))
        || auraNumber(requested.quantity)! < 1 || auraNumber(requested.quantity)! > 999_999
        || auraNumber(requested.quantity)! > auraNumber(row.ptravailable)!
        || ["not_on_inventory_dylan", "not_on_inventory_jd", "not_on_inventory_denied"].includes(String(row.app_tab_assignment || "").trim().toLowerCase())
        || String(row.desigitem || "").toUpperCase().includes("SHFT")) {
        failures.push({ unique_id: uid || null, error: "row_changed_or_out_of_scope" });
        continue;
      }
      validatedRows.push({ ...row, quantity: Number(requested.quantity) });
    }
    return jsonResponse({ ok: true, data: {
      ...resultData,
      complete: failures.length === 0,
      valid: failures.length === 0,
      rows: failures.length === 0 ? validatedRows : [],
      failures,
    } });
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    const durationMs = Math.round(performance.now() - startedAt);
    const cancelled = options.signal?.aborted === true;
    const statementTimedOut = failure.code === "57014";
    const timedOut = (deadline?.aborted === true || statementTimedOut) && !cancelled;
    const invalid = failure.code === "22023" || String(failure.message || "").startsWith("AURA_V2_");
    const status = cancelled ? 499 : timedOut ? 504 : failure.code === "42501" ? 403 : invalid ? 400 : 503;
    const sqlState = /^[0-9A-Z]{5}$/.test(String(failure.code || "")) ? String(failure.code) : null;
    if (input.operation === "resolve_query" && !cancelled && failure.code !== "42501" && !invalid) {
      return jsonResponse({ ok: true, data: { rows: [], complete: false, deterministic: true, fallbackRequired: true,
        metric: "openStock", season: "F1", salesYear: 27, checkedAt: new Date().toISOString(), requestId } });
    }
    if (!cancelled) {
      recordHandledError("app-api", `aura_inventory_${input.operation}`, timedOut ? { code: "aura_match_timeout" } : error, status, {
        requestId,
        durationMs,
        sqlState,
        timeoutStage: timedOut ? (statementTimedOut ? "database_statement" : timeoutStage) : null,
      });
    }
    if (cancelled) return errorResponse("AURA inventory lookup was cancelled.", 499, { code: "AURA_REQUEST_CANCELLED", requestId });
    if (timedOut) return errorResponse("Inventory matching took too long. Your command is ready to retry.", 504, { code: "AURA_V2_TIMEOUT", requestId, sqlState: sqlState || null, retryable: false });
    if (failure.code === "42501") return errorResponse("AURA cannot read the selected inventory with the active account permissions.", 403, { code: "AURA_DATA_FORBIDDEN", requestId, sqlState });
    const code = sqlState || (String(failure.message || "").startsWith("AURA_V2_") ? String(failure.message) : "AURA_V2_UNAVAILABLE");
    return errorResponse(invalid ? "AURA inventory request is invalid or no longer current." : "AURA inventory is temporarily unavailable.", invalid ? 400 : 503, {
      code: code.slice(0, 120), requestId, sqlState, ...(invalid ? {} : { retryable: true }),
    });
  }
}

function auraCanonicalName(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function auraCanonicalSize(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/^#\s*/, "").replace(/\s+/g, " ");
}

function auraNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!raw || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function auraComparableSalesYear(value: unknown): number | null {
  const parsed = auraNumber(value);
  if (parsed == null || parsed < 1) return null;
  const year = Math.round(parsed >= 2000 ? parsed % 100 : parsed);
  return year <= 99 ? year : null;
}

function auraPriorityCompare(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftPriority = auraNumber(left.priority);
  const rightPriority = auraNumber(right.priority);
  if (leftPriority != null && rightPriority == null) return -1;
  if (leftPriority == null && rightPriority != null) return 1;
  if (leftPriority != null && rightPriority != null && leftPriority !== rightPriority) return leftPriority - rightPriority;
  return String(left.unique_id || "").localeCompare(String(right.unique_id || ""), "en", { numeric: true, sensitivity: "base" });
}

async function readAuraSeasonSettings() {
  const { data, error } = await supabase.from("ph_app_settings").select("key,value")
    .eq("key", "current_season_salesyear").maybeSingle();
  if (error) throw error;
  const value = data?.value && typeof data.value === "object" && !Array.isArray(data.value)
    ? data.value as Record<string, unknown>
    : {};
  const season = String(value.seasonCode ?? value.season_code ?? value.currentSeason ?? value.current_season ?? "").trim().toUpperCase();
  const salesYear = auraComparableSalesYear(value.salesYear ?? value.sales_year ?? value.currentSalesYear ?? value.current_sales_year ?? value.salesyear);
  if (!/^[A-Z][0-9]$/.test(season) || salesYear == null) throw new Error("AURA_SEASON_SETTINGS_UNAVAILABLE");
  return { season, salesYear };
}

function auraSearchPattern(value: string) {
  // PostgREST uses SQL LIKE patterns for ilike; escape user-supplied wildcard characters.
  return value.replace(/[\\%_*]/g, "\\$&");
}

function auraPublicInventoryRow(row: Record<string, unknown>) {
  return {
    unique_id: String(row.unique_id || ""),
    itemcode: row.itemcode ?? null,
    commonname: row.commonname ?? null,
    contsize: row.contsize ?? null,
    locationcode: row.locationcode ?? null,
    lotcode: row.lotcode ?? null,
    ptravailable: row.ptravailable ?? null,
    priority: row.priority ?? null,
    ptronhand: row.ptronhand ?? null,
    s_lts: row.s_lts ?? null,
    season: row.season ?? null,
    saleyear: row.saleyear ?? null,
  };
}

async function readAuraMatchingInventory(input: {
  commonName: string;
  contSize: string;
  locationCode?: string;
}) {
  const settings = await readAuraSeasonSettings();
  const buildQuery = () => {
    let query = supabase.from("ph_master_inventory").select(AURA_INVENTORY_FIELDS)
      .ilike("commonname", auraSearchPattern(input.commonName))
      .ilike("contsize", auraSearchPattern(input.contSize))
      .eq("season", settings.season);
    if (input.locationCode) query = query.ilike("locationcode", auraSearchPattern(input.locationCode));
    return query;
  };

  const collected: Record<string, unknown>[] = [];
  let cursor = "";
  let scanTruncated = false;
  const pageCount = Math.ceil(AURA_MAX_INVENTORY_ROWS / AURA_INVENTORY_PAGE_SIZE);
  for (let page = 0; page < pageCount; page++) {
    let query = buildQuery();
    if (cursor) query = query.gt("unique_id", cursor);
    const { data, error } = await query.order("unique_id", { ascending: true }).limit(AURA_INVENTORY_PAGE_SIZE);
    if (error) throw error;
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    collected.push(...rows);
    if (rows.length < AURA_INVENTORY_PAGE_SIZE) break;
    cursor = String(rows[rows.length - 1]?.unique_id || "");
    if (!cursor) throw new Error("AURA_INVENTORY_CURSOR_INVALID");
    if (page === pageCount - 1) {
      const { data: nextRows, error: lookaheadError } = await buildQuery().gt("unique_id", cursor)
        .order("unique_id", { ascending: true }).limit(1);
      if (lookaheadError) throw lookaheadError;
      scanTruncated = Array.isArray(nextRows) && nextRows.length > 0;
    }
  }

  const filtered: Record<string, unknown>[] = [];
  let uncertain = scanTruncated;
  for (const row of collected) {
    if (auraCanonicalName(row.commonname) !== auraCanonicalName(input.commonName)
      || auraCanonicalSize(row.contsize) !== auraCanonicalSize(input.contSize)) continue;
    const year = auraComparableSalesYear(row.saleyear);
    if (year == null) { uncertain = true; continue; }
    if (year > settings.salesYear) continue;
    const assignment = String(row.app_tab_assignment || "").trim().toLowerCase();
    if (["not_on_inventory_dylan", "not_on_inventory_jd", "not_on_inventory_denied"].includes(assignment)) continue;
    if (String(row.desigitem || "").toUpperCase().includes("SHFT")) continue;
    const openStock = auraNumber(row.s_lts);
    if (openStock == null) { uncertain = true; continue; }
    if (openStock <= 0) continue;
    filtered.push(row);
  }
  return { rows: filtered, settings, complete: !uncertain, scanTruncated };
}

async function handleAuraInventorySearch(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Sign in with Dylan’s active account to use AURA.", 401, { code: "AURA_AUTH_REQUIRED" });
  if (session.mustChangePassword) return errorResponse("Complete the password change before using AURA.", 403, { code: "AURA_PROFILE_INACTIVE" });
  // Reject other identities before resolving a profile or querying application data.
  if (!session.authUserId || normalizeUsername(session.username || "") !== "dylan_collyge") {
    return errorResponse("AURA is available only to Dylan’s active account.", 403, { code: "AURA_FORBIDDEN" });
  }
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("Dylan’s active account profile could not be verified.", 403, { code: "AURA_PROFILE_INACTIVE" }); }
  if (normalizeUsername(String(actor.username || "")) !== "dylan_collyge" || String(actor.id || "") !== String(session.authUserId)) {
    return errorResponse("AURA is available only to Dylan’s active account.", 403, { code: "AURA_FORBIDDEN" });
  }

  const commonName = String(payload.commonName || "").trim().slice(0, 160);
  const contSize = String(payload.contSize || "").trim().slice(0, 48);
  const mode = String(payload.mode || "count").trim().toLowerCase();
  const locationCode = String(payload.locationCode || "").trim().slice(0, 64);
  const quantity = payload.quantity == null || payload.quantity === "" ? null : auraNumber(payload.quantity);
  const offset = payload.offset == null ? 0 : Number(payload.offset);
  const requestedLimit = payload.limit == null ? 100 : Number(payload.limit);
  const limit = Math.min(500, requestedLimit);
  if (Object.keys(payload).some(key => !["action", "commonName", "contSize", "mode", "locationCode", "quantity", "offset", "limit"].includes(key))) {
    return errorResponse("AURA search request is invalid.", 400, { code: "AURA_SEARCH_INVALID" });
  }
  if (!commonName || !contSize || !["count", "order", "scout"].includes(mode)
    || (mode === "order" && (quantity == null || quantity <= 0))
    || !Number.isInteger(offset) || offset < 0 || offset > AURA_MAX_INVENTORY_ROWS
    || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
    return errorResponse("AURA needs a plant name and container size; order searches also need a positive quantity.", 400, { code: "AURA_SEARCH_INVALID" });
  }

  try {
    const result = await readAuraMatchingInventory({ commonName, contSize, ...(locationCode ? { locationCode } : {}) });
    let rows = result.rows;
    let totalAvailable = 0;
    for (const row of rows) {
      const available = auraNumber(row.ptravailable);
      if (available == null) result.complete = false;
      else totalAvailable += available;
    }
    if (mode === "order") {
      rows = rows.filter(row => {
        const available = auraNumber(row.ptravailable);
        return available != null && quantity != null && available >= quantity;
      }).sort(auraPriorityCompare);
    } else {
      rows = rows.sort((a, b) => String(a.locationcode || "").localeCompare(String(b.locationcode || ""), "en", { numeric: true, sensitivity: "base" })
        || String(a.lotcode || "").localeCompare(String(b.lotcode || ""), "en", { numeric: true, sensitivity: "base" })
        || String(a.unique_id || "").localeCompare(String(b.unique_id || ""), "en", { numeric: true, sensitivity: "base" }));
    }
    const hasMore = offset + limit < rows.length || result.scanTruncated;
    return jsonResponse({ ok: true, data: {
      rows: rows.slice(offset, offset + limit).map(auraPublicInventoryRow),
      totalAvailable: result.complete ? totalAvailable : null,
      complete: result.complete,
      season: result.settings.season,
      salesYear: result.settings.salesYear,
      offset,
      limit,
      hasMore,
    } });
  } catch (error) {
    const failure = error as { code?: string };
    if (failure.code === "42501") return errorResponse("AURA cannot read this inventory data with the active account permissions.", 403, { code: "AURA_DATA_FORBIDDEN" });
    return jsonResponse({ ok: true, data: { rows: [], totalAvailable: null, complete: false, fallbackRequired: true,
      season: "F1", salesYear: 27, offset, limit, hasMore: false } });
  }
}

function auraSeverityLabel(score: number | null) {
  if (score == null || score === 0) return "none";
  if (score <= 10) return "low";
  if (score <= 25) return "medium";
  if (score <= 40) return "high";
  return "critical";
}

async function handleAuraScoutLog(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Sign in with Dylan’s active account to use AURA.", 401, { code: "AURA_AUTH_REQUIRED" });
  if (session.mustChangePassword) return errorResponse("Complete the password change before using AURA.", 403, { code: "AURA_PROFILE_INACTIVE" });
  if (!session.authUserId || normalizeUsername(session.username || "") !== "dylan_collyge") {
    return errorResponse("AURA is available only to Dylan’s active account.", 403, { code: "AURA_FORBIDDEN" });
  }
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("Dylan’s active account profile could not be verified.", 403, { code: "AURA_PROFILE_INACTIVE" }); }
  if (normalizeUsername(String(actor.username || "")) !== "dylan_collyge" || String(actor.id || "") !== String(session.authUserId)) {
    return errorResponse("AURA is available only to Dylan’s active account.", 403, { code: "AURA_FORBIDDEN" });
  }

  const allowed = new Set(["action", "sourceInventoryUid", "expected", "pestCode", "issueType", "sevScore", "notes", "idempotencyKey"]);
  if (Object.keys(payload).some(key => !allowed.has(key))) return errorResponse("AURA scouting request is invalid.", 400, { code: "AURA_SCOUT_INVALID" });
  const expected = payload.expected && typeof payload.expected === "object" && !Array.isArray(payload.expected)
    ? payload.expected as Record<string, unknown>
    : {};
  const sourceInventoryUid = String(payload.sourceInventoryUid || "").trim().slice(0, 200);
  const expectedItem = String(expected.itemcode || "").trim();
  const expectedName = String(expected.commonname || "").trim();
  const expectedSize = String(expected.contsize || "").trim();
  const expectedLocation = String(expected.locationcode || "").trim();
  const expectedLot = String(expected.lotcode || "").trim();
  const pestCode = String(payload.pestCode || "").trim().slice(0, 100);
  const notes = String(payload.notes || "").trim().slice(0, 4000);
  const issueType = String(payload.issueType || "pest").trim().toLowerCase();
  const idempotencyKey = String(payload.idempotencyKey || "").trim();
  const sevScore = payload.sevScore == null || payload.sevScore === "" ? null
    : (typeof payload.sevScore === "number" || typeof payload.sevScore === "string" && /^\d+$/.test(payload.sevScore.trim()))
    ? Number(payload.sevScore)
    : Number.NaN;
  if (!sourceInventoryUid || !expectedItem || !expectedName || !expectedSize || !expectedLocation || !expectedLot
    || !pestCode || !idempotencyKey || idempotencyKey.length < 12 || idempotencyKey.length > 200
    || !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)
    || !["pest", "disease", "nutrient"].includes(issueType)
    || (sevScore != null && (!Number.isInteger(sevScore) || sevScore < 0 || sevScore > 50))) {
    return errorResponse("AURA needs a pest code, exact inventory row, valid idempotency key, and severity from 0 to 50.", 400, { code: "AURA_SCOUT_INVALID" });
  }

  try {
    const idempotencyHash = await sha256Hex(new TextEncoder().encode(`aura-scout-v1\u0000${session.authUserId}\u0000${idempotencyKey}`));
    const reportId = `aura-${idempotencyHash}`;
    const reportFields = "unique_id,status,source_inventory_uid,itemcode,common_name,contsize,locationcode,lotcode,pest_code,sev_score,issue_type,manual_note,created_by_username,review_status,created_at";
    const { data: prior, error: priorError } = await supabase.from("ph_grower_scout_reports").select(reportFields)
      .eq("unique_id", reportId).maybeSingle();
    if (priorError) throw priorError;
    if (prior) {
      const sameRequest = normalizeUsername(String(prior.created_by_username || "")) === "dylan_collyge"
        && String(prior.source_inventory_uid || "") === sourceInventoryUid
        && String(prior.itemcode || "") === expectedItem
        && auraCanonicalName(prior.common_name) === auraCanonicalName(expectedName)
        && auraCanonicalSize(prior.contsize) === auraCanonicalSize(expectedSize)
        && String(prior.locationcode || "") === expectedLocation
        && String(prior.lotcode || "") === expectedLot
        && String(prior.pest_code || "") === pestCode
        && String(prior.issue_type || "pest") === issueType
        && (prior.sev_score == null ? null : Number(prior.sev_score)) === sevScore
        && String(prior.manual_note || "") === (notes || `AURA scouting: ${issueType} ${pestCode}`);
      if (!sameRequest) return errorResponse("That AURA request key was already used for different scouting details.", 409, { code: "AURA_IDEMPOTENCY_CONFLICT" });
      return jsonResponse({ ok: true, data: { status: "duplicate", report: prior } });
    }

    const settings = await readAuraSeasonSettings();
    const { data: inventoryRow, error: inventoryError } = await supabase.from("ph_master_inventory")
      .select(AURA_INVENTORY_FIELDS).eq("unique_id", sourceInventoryUid).maybeSingle();
    if (inventoryError) throw inventoryError;
    if (!inventoryRow
      || String(inventoryRow.itemcode || "").trim() !== expectedItem
      || auraCanonicalName(inventoryRow.commonname) !== auraCanonicalName(expectedName)
      || auraCanonicalSize(inventoryRow.contsize) !== auraCanonicalSize(expectedSize)
      || String(inventoryRow.locationcode || "").trim() !== expectedLocation
      || String(inventoryRow.lotcode || "").trim() !== expectedLot) {
      return errorResponse("The selected inventory row changed or is no longer available. Refresh and review the row.", 409, { code: "AURA_SCOUT_ROW_CHANGED" });
    }
    const year = auraComparableSalesYear(inventoryRow.saleyear);
    const openStock = auraNumber(inventoryRow.s_lts);
    if (String(inventoryRow.season || "").trim().toUpperCase() !== settings.season
      || year == null || year > settings.salesYear || openStock == null || openStock <= 0
      || ["not_on_inventory_dylan", "not_on_inventory_jd", "not_on_inventory_denied"].includes(String(inventoryRow.app_tab_assignment || "").trim().toLowerCase())
      || String(inventoryRow.desigitem || "").toUpperCase().includes("SHFT")) {
      return errorResponse("That row is outside the current open-stock scope. Refresh and select a current row.", 409, { code: "AURA_SCOUT_ROW_OUT_OF_SCOPE" });
    }

    const manualNote = notes || `AURA scouting: ${issueType} ${pestCode}`;
    const record = {
      unique_id: reportId,
      status: "dylan_review",
      report_language: "en",
      locationcode: String(inventoryRow.locationcode || ""),
      itemcode: String(inventoryRow.itemcode || ""),
      genus: null,
      common_name: String(inventoryRow.commonname || ""),
      contsize: String(inventoryRow.contsize || ""),
      season: String(inventoryRow.season || ""),
      salesyear: year,
      manual_note: manualNote,
      transcript: null,
      summary_json: { source: "aura_manual", source_inventory_uid: sourceInventoryUid },
      pest_issue: issueType === "pest",
      disease_issue: issueType === "disease",
      nutrient_issue: issueType === "nutrient",
      manual_review: true,
      issue_type: issueType,
      severity: auraSeverityLabel(sevScore),
      diagnosis: pestCode,
      created_by_username: "dylan_collyge",
      created_by_display: String(actor.display_name || actor.username || "Dylan"),
      source_inventory_uid: sourceInventoryUid,
      lotcode: String(inventoryRow.lotcode || ""),
      pest_code: pestCode,
      sev_score: sevScore,
      review_status: "pending",
      worker_id: null,
      attempts: 0,
    };
    const { data: saved, error: saveError } = await supabase.from("ph_grower_scout_reports").insert(record)
      .select(reportFields).single();
    if (saveError) {
      if (saveError.code === "23505") {
        const { data: duplicate, error: duplicateError } = await supabase.from("ph_grower_scout_reports").select(reportFields)
          .eq("unique_id", reportId).maybeSingle();
        if (duplicateError) throw duplicateError;
        if (duplicate && normalizeUsername(String(duplicate.created_by_username || "")) === "dylan_collyge"
          && String(duplicate.source_inventory_uid || "") === sourceInventoryUid
          && String(duplicate.itemcode || "") === expectedItem
          && auraCanonicalName(duplicate.common_name) === auraCanonicalName(expectedName)
          && auraCanonicalSize(duplicate.contsize) === auraCanonicalSize(expectedSize)
          && String(duplicate.locationcode || "") === expectedLocation
          && String(duplicate.lotcode || "") === expectedLot
          && String(duplicate.pest_code || "") === pestCode
          && String(duplicate.issue_type || "pest") === issueType
          && (duplicate.sev_score == null ? null : Number(duplicate.sev_score)) === sevScore
          && String(duplicate.manual_note || "") === manualNote) {
          return jsonResponse({ ok: true, data: { status: "duplicate", report: duplicate } });
        }
        return errorResponse("That AURA request key was already used for different scouting details.", 409, { code: "AURA_IDEMPOTENCY_CONFLICT" });
      }
      throw saveError;
    }
    return jsonResponse({ ok: true, data: { status: "saved", report: saved } });
  } catch (error) {
    const failure = error as { code?: string };
    recordHandledError("app-api", "aura_scout_log", error, 503);
    if (failure.code === "42501") return errorResponse("AURA cannot save scouting reports with the active account permissions.", 403, { code: "AURA_DATA_FORBIDDEN" });
    return errorResponse("AURA could not save the scouting report. Your details are still available to retry.", 503, {
      code: "AURA_SCOUT_UNAVAILABLE",
      retryable: true,
    });
  }
}

type DylanSession = Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>;

async function requireDylanNativeProfile(session: DylanSession) {
  if (!session || session.mustChangePassword || Number(session.ver) !== 2 || !session.authUserId
    || normalizeUsername(session.username || "") !== "dylan_collyge") return null;
  try {
    const profile = await resolveActiveSessionProfile(session);
    if (normalizeUsername(String(profile.username || "")) !== "dylan_collyge"
      || String(profile.id || "") !== String(session.authUserId)) return null;
    return profile;
  } catch {
    return null;
  }
}

function alphaCursorEncode(value: Record<string, string>) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function alphaCursorDecode(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - raw.length % 4) % 4);
    const decoded = JSON.parse(atob(padded)) as Record<string, unknown>;
    return decoded && typeof decoded === "object" ? decoded : null;
  } catch { return null; }
}

function alphaCursorOr(field: string, timestamp: string, id: string) {
  return `${field}.lt.${timestamp},and(${field}.eq.${timestamp},id.lt.${id})`;
}

async function alphaDeterministicUuid(input: string) {
  const digest = await sha256Hex(new TextEncoder().encode(input));
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  const variant = parseInt(bytes[16], 16);
  bytes[16] = ((variant & 0x3) | 0x8).toString(16);
  const hex = bytes.join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function assertDylanAction(session: DylanSession) {
  const actor = await requireDylanNativeProfile(session);
  if (!actor) throw Object.assign(new Error("This command is available only to Dylan’s verified active account."), { status: 403, code: "ALPHA_DYLAN_FORBIDDEN" });
  return actor;
}

function alphaChatMessage(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    conversationId: String(row.conversation_id || ""),
    senderUsername: normalizeUsername(String(row.sender_username || "")),
    senderDisplayName: String(row.sender_display_name || row.sender_name || row.sender_username || ""),
    body: String(row.body || row.message_text || ""),
    createdAt: String(row.created_at || ""),
    clientId: String(row.client_id || ""),
  };
}

async function alphaConversationAccess(conversationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return false;
  const { data, error } = await supabase.from("ph_chat_participants").select("conversation_id")
    .eq("conversation_id", conversationId).eq("username", "dylan_collyge").limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

async function alphaChatList(session: DylanSession, payload: Record<string, unknown>) {
  await assertDylanAction(session);
  if (Object.keys(payload).some(key => !["action", "cursor", "limit"].includes(key))) return errorResponse("Chat list request is invalid.", 400, { code: "ALPHA_CHAT_LIST_INVALID" });
  const limitValue = payload.limit == null ? 50 : Number(payload.limit);
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) return errorResponse("Chat list page size must be between 1 and 100.", 400, { code: "ALPHA_CHAT_LIST_INVALID" });
  const limit = limitValue;
  const { data: ownParticipants, error: ownError } = await supabase.from("ph_chat_participants")
    .select("conversation_id,last_read_at,is_archived").eq("username", "dylan_collyge").eq("is_archived", false).limit(5000);
  if (ownError) throw ownError;
  const ids = [...new Set((ownParticipants || []).map(row => String(row.conversation_id || "")).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return jsonResponse({ ok: true, rows: [], nextCursor: null, hasMore: false });
  let query = supabase.from("ph_chat_conversations")
    .select("id,title,is_group,updated_at,last_message_at,last_message_preview,last_message_sender")
    .in("id", ids).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  const cursor = alphaCursorDecode(payload.cursor);
  if (payload.cursor && (!cursor || typeof cursor.updatedAt !== "string" || typeof cursor.id !== "string" || !/^[0-9a-f-]{36}$/i.test(cursor.id))) {
    return errorResponse("Chat list cursor is invalid.", 400, { code: "ALPHA_CHAT_CURSOR_INVALID" });
  }
  if (cursor) query = query.or(alphaCursorOr("updated_at", String(cursor.updatedAt), String(cursor.id)));
  const { data: conversations, error: conversationError } = await query;
  if (conversationError) throw conversationError;
  const fetched = conversations || [];
  const hasMore = fetched.length > limit;
  const page = fetched.slice(0, limit);
  const pageIds = page.map(row => String(row.id));
  const { data: participants, error: participantError } = pageIds.length
    ? await supabase.from("ph_chat_participants").select("conversation_id,username,display_name,is_archived")
      .in("conversation_id", pageIds).eq("is_archived", false).limit(1000)
    : { data: [], error: null };
  if (participantError) throw participantError;
  const participantsByConversation = new Map<string, Array<{ username: string; displayName: string }>>();
  for (const participant of participants || []) {
    const id = String(participant.conversation_id || "");
    const list = participantsByConversation.get(id) || [];
    list.push({ username: normalizeUsername(String(participant.username || "")), displayName: String(participant.display_name || participant.username || "") });
    participantsByConversation.set(id, list);
  }
  const readAtByConversation = new Map((ownParticipants || []).map(row => [String(row.conversation_id), String(row.last_read_at || "")]));
  const rows = page.map(row => ({
    id: String(row.id), title: String(row.title || ""), isGroup: row.is_group === true,
    updatedAt: String(row.updated_at || ""), lastMessageAt: String(row.last_message_at || ""),
    lastMessagePreview: String(row.last_message_preview || ""), participants: participantsByConversation.get(String(row.id)) || [],
    lastReadAt: readAtByConversation.get(String(row.id)) || "",
  }));
  const oldest = page.at(-1);
  const nextCursor = hasMore && oldest ? alphaCursorEncode({ updatedAt: String(oldest.updated_at), id: String(oldest.id) }) : null;
  return jsonResponse({ ok: true, rows, nextCursor, hasMore });
}

async function alphaChatPage(session: DylanSession, payload: Record<string, unknown>) {
  await assertDylanAction(session);
  if (Object.keys(payload).some(key => !["action", "conversationId", "cursor", "limit"].includes(key))) return errorResponse("Chat page request is invalid.", 400, { code: "ALPHA_CHAT_PAGE_INVALID" });
  const conversationId = String(payload.conversationId || "").trim();
  const limitValue = payload.limit == null ? 50 : Number(payload.limit);
  if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
    return errorResponse("Chat page request is invalid.", 400, { code: "ALPHA_CHAT_PAGE_INVALID" });
  }
  if (!await alphaConversationAccess(conversationId)) return errorResponse("This conversation is unavailable to the active account.", 404, { code: "ALPHA_CHAT_NOT_FOUND" });
  let query = supabase.from("ph_chat_messages").select("id,conversation_id,sender_username,sender_display_name,sender_name,body,message_text,created_at,client_id")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limitValue + 1);
  const cursor = alphaCursorDecode(payload.cursor);
  if (payload.cursor && (!cursor || typeof cursor.createdAt !== "string" || typeof cursor.id !== "string" || !/^[0-9a-f-]{36}$/i.test(cursor.id))) {
    return errorResponse("Chat page cursor is invalid.", 400, { code: "ALPHA_CHAT_CURSOR_INVALID" });
  }
  if (cursor) query = query.or(alphaCursorOr("created_at", String(cursor.createdAt), String(cursor.id)));
  const { data, error } = await query;
  if (error) throw error;
  const fetched = data || [];
  const hasMore = fetched.length > limitValue;
  const descendingPage = fetched.slice(0, limitValue);
  const oldest = descendingPage.at(-1);
  const rows = descendingPage.reverse().map(alphaChatMessage);
  const nextCursor = hasMore && oldest ? alphaCursorEncode({ createdAt: String(oldest.created_at), id: String(oldest.id) }) : null;
  return jsonResponse({ ok: true, conversationId, rows, nextCursor, hasMore });
}

async function alphaChatMarkRead(session: DylanSession, payload: Record<string, unknown>) {
  await assertDylanAction(session);
  if (Object.keys(payload).some(key => !["action", "conversationId"].includes(key))) return errorResponse("Chat read request is invalid.", 400, { code: "ALPHA_CHAT_READ_INVALID" });
  const conversationId = String(payload.conversationId || "").trim();
  if (!await alphaConversationAccess(conversationId)) return errorResponse("This conversation is unavailable to the active account.", 404, { code: "ALPHA_CHAT_NOT_FOUND" });
  const readAt = new Date().toISOString();
  const { error } = await supabase.from("ph_chat_participants").update({ last_read_at: readAt })
    .eq("conversation_id", conversationId).eq("username", "dylan_collyge");
  if (error) throw error;
  return jsonResponse({ ok: true, conversationId, readAt });
}

async function alphaFindDirectConversation(recipientUsername: string) {
  const { data: targetParticipants, error: targetError } = await supabase.from("ph_chat_participants")
    .select("conversation_id").eq("username", recipientUsername).eq("is_archived", false).limit(1000);
  if (targetError) throw targetError;
  const ids = [...new Set((targetParticipants || []).map(row => String(row.conversation_id || "")).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return "";
  const { data: shared, error: sharedError } = await supabase.from("ph_chat_participants").select("conversation_id,username")
    .in("conversation_id", ids).in("username", ["dylan_collyge", recipientUsername]).eq("is_archived", false).limit(2000);
  if (sharedError) throw sharedError;
  const userSets = new Map<string, Set<string>>();
  for (const row of shared || []) {
    const id = String(row.conversation_id || "");
    const set = userSets.get(id) || new Set<string>();
    set.add(normalizeUsername(String(row.username || "")));
    userSets.set(id, set);
  }
  const candidates = [...userSets].filter(([, users]) => users.size === 2 && users.has("dylan_collyge") && users.has(recipientUsername)).map(([id]) => id);
  if (!candidates.length) return "";
  const { data: conversations, error } = await supabase.from("ph_chat_conversations").select("id,updated_at")
    .in("id", candidates).eq("is_group", false).order("updated_at", { ascending: false }).limit(1);
  if (error) throw error;
  return String(conversations?.[0]?.id || "");
}

async function alphaResolveRecipient(name: string) {
  const query = name.trim().toLowerCase();
  const { data, error } = await supabase.from("profiles").select("id,username,display_name,role,disabled_at,locked_until,must_change_password")
    .is("disabled_at", null).eq("must_change_password", false).limit(1000);
  if (error) throw error;
  const active = (data || []).filter(row => {
    const locked = Date.parse(String(row.locked_until || ""));
    return (!Number.isFinite(locked) || locked <= Date.now()) && normalizeUsername(String(row.username || "")) !== "dylan_collyge";
  });
  const matches = active.filter(row => String(row.display_name || "").trim().toLowerCase() === query
    || normalizeUsername(String(row.username || "")) === normalizeUsername(query));
  if (matches.length > 1) return { error: errorResponse("That name matches more than one active profile. Use a more specific username.", 409, { code: "ALPHA_CHAT_RECIPIENT_AMBIGUOUS" }) };
  if (!matches.length) {
    if (/\b(department|evaluators|counters|inventory|production|sales office|managers)\b/i.test(name)) {
      return { error: errorResponse("Department recipients are not configured for AURA yet.", 409, { code: "ALPHA_CHAT_DEPARTMENT_UNCONFIGURED" }) };
    }
    return { error: errorResponse("No unique active recipient matched that name.", 404, { code: "ALPHA_CHAT_RECIPIENT_NOT_FOUND" }) };
  }
  const row = matches[0];
  return { profile: row, username: normalizeUsername(String(row.username || "")), displayName: String(row.display_name || row.username || "") };
}

async function auraChatSend(session: DylanSession, payload: Record<string, unknown>) {
  const actor = await assertDylanAction(session);
  if (Object.keys(payload).some(key => !["action", "recipientName", "message", "clientId", "conversationId"].includes(key))) return errorResponse("AURA message request is invalid.", 400, { code: "AURA_CHAT_INVALID" });
  const rawBody = String(payload.message || "").trim();
  if (rawBody.length > 4000) return errorResponse("Messages are limited to 4,000 characters.", 400, { code: "AURA_CHAT_INVALID" });
  const body = rawBody;
  const clientId = String(payload.clientId || "").trim();
  const suppliedConversation = String(payload.conversationId || "").trim();
  if (!body || body.length > 4000 || !/^[A-Za-z0-9_-]{8,120}$/.test(clientId)) return errorResponse("AURA needs a message and a valid idempotency key.", 400, { code: "AURA_CHAT_INVALID" });

  let recipientUsername: string;
  let recipientName: string;
  let conversationId = suppliedConversation;
  if (suppliedConversation) {
    if (!await alphaConversationAccess(suppliedConversation)) return errorResponse("This conversation is unavailable to the active account.", 404, { code: "ALPHA_CHAT_NOT_FOUND" });
    const { data: participants, error } = await supabase.from("ph_chat_participants").select("username,display_name")
      .eq("conversation_id", suppliedConversation).eq("is_archived", false).limit(100);
    if (error) throw error;
    const other = (participants || []).filter(row => normalizeUsername(String(row.username || "")) !== "dylan_collyge");
    if (other.length !== 1 || (participants || []).length !== 2) return errorResponse("AURA replies are available only in a direct conversation.", 409, { code: "AURA_CHAT_CONVERSATION_NOT_DIRECT" });
    recipientUsername = normalizeUsername(String(other[0].username || ""));
    recipientName = String(other[0].display_name || other[0].username || "");
  } else {
    const rawName = String(payload.recipientName || "").trim().slice(0, 160);
    if (!rawName) return errorResponse("Choose one active recipient.", 400, { code: "AURA_CHAT_RECIPIENT_REQUIRED" });
    const resolved = await alphaResolveRecipient(rawName);
    if (resolved.error) return resolved.error;
    recipientUsername = resolved.username;
    recipientName = resolved.displayName;
    conversationId = await alphaFindDirectConversation(recipientUsername);
    if (!conversationId) conversationId = await alphaDeterministicUuid(`aura-direct-v1:${["dylan_collyge", recipientUsername].sort().join(":")}`);
  }

  const now = new Date().toISOString();
  const conversationPayload = {
    id: conversationId, title: "", is_group: false, created_by: "dylan_collyge",
    created_by_display: String(actor.display_name || actor.username || "Dylan"), created_at: now, updated_at: now,
    last_message_at: now, last_message_preview: body.length > 160 ? `${body.slice(0,157)}...` : body,
    last_message_sender: String(actor.display_name || actor.username || "Dylan"),
  };
  const { error: conversationError } = await supabase.from("ph_chat_conversations")
    .upsert(conversationPayload, { onConflict: "id", ignoreDuplicates: true });
  if (conversationError) throw conversationError;
  const participants = [
    { conversation_id: conversationId, username: "dylan_collyge", display_name: String(actor.display_name || actor.username || "Dylan"), is_archived: false },
    { conversation_id: conversationId, username: recipientUsername, display_name: recipientName, is_archived: false },
  ];
  const { error: participantsError } = await supabase.from("ph_chat_participants")
    .upsert(participants, { onConflict: "conversation_id,username", ignoreDuplicates: true });
  if (participantsError) throw participantsError;

  const messageId = await alphaDeterministicUuid(`aura-chat-v1:${String(actor.id)}:${clientId}`);
  const { data: prior, error: priorError } = await supabase.from("ph_chat_messages")
    .select("id,conversation_id,sender_username,body,message_text,client_id")
    .eq("id", messageId).maybeSingle();
  if (priorError) throw priorError;
  if (prior && (String(prior.conversation_id || "") !== conversationId
    || normalizeUsername(String(prior.sender_username || "")) !== "dylan_collyge"
    || String(prior.body || prior.message_text || "") !== body || String(prior.client_id || "") !== clientId)) {
    return errorResponse("That message key was already used for different content.", 409, { code: "AURA_CHAT_IDEMPOTENCY_CONFLICT" });
  }
  if (!prior) {
    const displayName = String(actor.display_name || actor.username || "Dylan");
    const { error: insertError } = await supabase.from("ph_chat_messages").insert({
      id: messageId, conversation_id: conversationId, sender_username: "dylan_collyge",
      sender_display_name: displayName, sender_name: displayName, message_type: "text",
      body, message_text: body, created_at: now, client_id: clientId,
    });
    if (insertError && insertError.code !== "23505") throw insertError;
    if (insertError?.code === "23505") {
      const { data: raced, error: racedError } = await supabase.from("ph_chat_messages")
        .select("id,conversation_id,sender_username,body,message_text,client_id").eq("id", messageId).maybeSingle();
      if (racedError) throw racedError;
      if (!raced || String(raced.conversation_id || "") !== conversationId || String(raced.body || raced.message_text || "") !== body) throw insertError;
    }
  }
  const { error: conversationUpdateError } = await supabase.from("ph_chat_conversations").update({
    updated_at: now, last_message_at: now, last_message_preview: conversationPayload.last_message_preview,
    last_message_sender: conversationPayload.last_message_sender,
  }).eq("id", conversationId);
  if (conversationUpdateError) throw conversationUpdateError;
  return jsonResponse({ ok: true, messageId, conversationId, recipientName, message: body });
}

async function alphaTimeoffList(session: DylanSession, payload: Record<string, unknown>) {
  await assertDylanAction(session);
  if (Object.keys(payload).some(key => !["action", "offset", "limit", "status"].includes(key))) return errorResponse("Time-off list request is invalid.", 400, { code: "ALPHA_TIMEOFF_LIST_INVALID" });
  const offset = payload.offset == null ? 0 : Number(payload.offset);
  const limit = payload.limit == null ? 50 : Number(payload.limit);
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000 || !Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse("Time-off page is invalid.", 400, { code: "ALPHA_TIMEOFF_LIST_INVALID" });
  let query = supabase.from("ph_department_calendar_events").select("unique_id,department,event_type,title,description,start_at,end_at,all_day,requested_by_username,requested_by_display,assigned_to_username,assigned_to_display,status,approved_by_username,approved_by_display,approved_at,assigned_usernames,assigned_displays,created_at,updated_at,hr_source_event_id")
    .eq("event_type", "time_off").is("hr_source_event_id", null).order("start_at", { ascending: true }).order("unique_id", { ascending: true }).range(offset, offset + limit);
  if (payload.status && ["requested", "approved", "denied", "cancelled"].includes(String(payload.status))) query = query.eq("status", String(payload.status));
  const { data, error } = await query;
  if (error) throw error;
  const fetched = data || [];
  return jsonResponse({ ok: true, rows: fetched.slice(0, limit).map(row => ({
    id: String(row.unique_id), department: String(row.department || "General"), title: String(row.title || ""),
    description: String(row.description || ""), startAt: String(row.start_at || ""), endAt: String(row.end_at || ""),
    allDay: row.all_day === true, requestedByUsername: normalizeUsername(String(row.requested_by_username || "")),
    assignedUsername: normalizeUsername(String(row.assigned_to_username || "")), status: String(row.status || "requested"),
    approvedByUsername: normalizeUsername(String(row.approved_by_username || "")), hrSourceEventId: String(row.hr_source_event_id || ""),
  })), offset, limit, hasMore: fetched.length > limit });
}

async function alphaTimeoffRequest(session: DylanSession, payload: Record<string, unknown>) {
  const actor = await assertDylanAction(session);
  if (Object.keys(payload).some(key => !["action", "clientId", "title", "startAt", "endAt", "department", "assignedUsername"].includes(key))) return errorResponse("Time-off request is invalid.", 400, { code: "ALPHA_TIMEOFF_REQUEST_INVALID" });
  const clientId = String(payload.clientId || "").trim();
  const title = String(payload.title || "").trim().slice(0, 180);
  const startAt = String(payload.startAt || "").trim();
  const endAt = String(payload.endAt || "").trim();
  const startMs = Date.parse(startAt), endMs = Date.parse(endAt);
  const assignedUsername = normalizeUsername(String(payload.assignedUsername || "dylan_collyge"));
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(clientId) || !title || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs
    || endMs - startMs > 31 * 24 * 60 * 60 * 1000) return errorResponse("Enter a title and valid time-off dates (31 days maximum).", 400, { code: "ALPHA_TIMEOFF_REQUEST_INVALID" });
  const { data: activeTarget, error: targetError } = await supabase.from("profiles").select("id,username,display_name,disabled_at,locked_until,must_change_password")
    .eq("username", assignedUsername).maybeSingle();
  if (targetError) throw targetError;
  const lockTime = Date.parse(String(activeTarget?.locked_until || ""));
  if (!activeTarget?.id || activeTarget.disabled_at || activeTarget.must_change_password || (Number.isFinite(lockTime) && lockTime > Date.now())) {
    return errorResponse("Select an active employee profile for the time-off request.", 404, { code: "ALPHA_TIMEOFF_EMPLOYEE_NOT_FOUND" });
  }
  const idHash = await sha256Hex(new TextEncoder().encode(`alpha-timeoff-v1:${String(actor.id)}:${clientId}`));
  const eventId = `alpha-timeoff-${idHash.slice(0, 40)}`;
  const event = {
    unique_id: eventId, department: String(payload.department || "General").trim().slice(0, 120) || "General",
    event_type: "time_off", title, description: "Requested through the HR/Labor Command Center.",
    start_at: new Date(startMs).toISOString(), end_at: new Date(endMs).toISOString(), all_day: false,
    requested_by_username: "dylan_collyge", requested_by_display: String(actor.display_name || "Dylan"),
    assigned_to_username: assignedUsername, assigned_to_display: String(activeTarget.display_name || activeTarget.username),
    assigned_usernames: [assignedUsername], assigned_displays: [String(activeTarget.display_name || activeTarget.username)],
    recurrence_type: "none", recurrence_interval: 1, status: "requested", approved_by_username: null,
    approved_by_display: null, approved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const selectColumns = "unique_id,title,start_at,end_at,assigned_to_username,requested_by_username,status,department,created_at,updated_at";
  const { data: prior, error: priorError } = await supabase.from("ph_department_calendar_events").select(selectColumns)
    .eq("unique_id", eventId).maybeSingle();
  if (priorError) throw priorError;
  if (prior) {
    const matches = normalizeUsername(String(prior.requested_by_username || "")) === "dylan_collyge"
      && String(prior.title || "") === title
      && new Date(String(prior.start_at || "")).getTime() === startMs
      && new Date(String(prior.end_at || "")).getTime() === endMs
      && normalizeUsername(String(prior.assigned_to_username || "")) === assignedUsername;
    if (!matches) return errorResponse("That request key was already used for different time-off details.", 409, { code: "ALPHA_TIMEOFF_IDEMPOTENCY_CONFLICT" });
    return jsonResponse({ ok: true, event: { id: prior.unique_id, title: prior.title, startAt: prior.start_at, endAt: prior.end_at, assignedUsername: prior.assigned_to_username, status: prior.status, department: prior.department } });
  }
  const { error: insertError } = await supabase.from("ph_department_calendar_events").insert(event);
  if (insertError && insertError.code !== "23505") throw insertError;
  const { data: saved, error: readError } = await supabase.from("ph_department_calendar_events").select(selectColumns)
    .eq("unique_id", eventId).maybeSingle();
  if (readError) throw readError;
  if (!saved || normalizeUsername(String(saved.requested_by_username || "")) !== "dylan_collyge") throw new Error("ALPHA_TIMEOFF_SAVE_UNAVAILABLE");
  if (String(saved.title || "") !== title || new Date(String(saved.start_at || "")).getTime() !== startMs
    || new Date(String(saved.end_at || "")).getTime() !== endMs
    || normalizeUsername(String(saved.assigned_to_username || "")) !== assignedUsername) {
    return errorResponse("That request key was already used for different time-off details.", 409, { code: "ALPHA_TIMEOFF_IDEMPOTENCY_CONFLICT" });
  }
  return jsonResponse({ ok: true, event: { id: saved.unique_id, title: saved.title, startAt: saved.start_at, endAt: saved.end_at, assignedUsername: saved.assigned_to_username, status: saved.status, department: saved.department } });
}

async function alphaTimeoffApprove(session: DylanSession, payload: Record<string, unknown>) {
  const actor = await assertDylanAction(session);
  if (Object.keys(payload).some(key => !["action", "eventId", "status"].includes(key))) return errorResponse("Time-off approval is invalid.", 400, { code: "ALPHA_TIMEOFF_APPROVAL_INVALID" });
  const eventId = String(payload.eventId || "").trim();
  const status = String(payload.status || "").trim().toLowerCase();
  if (!eventId || !["approved", "denied", "cancelled"].includes(status)) return errorResponse("Choose an event and a valid decision.", 400, { code: "ALPHA_TIMEOFF_APPROVAL_INVALID" });
  const { data: prior, error: priorError } = await supabase.from("ph_department_calendar_events")
    .select("unique_id,event_type,status,requested_by_username,assigned_to_username,assigned_usernames").eq("unique_id", eventId).maybeSingle();
  if (priorError) throw priorError;
  const priorStatus = String(prior?.status || "");
  const allowedTransition = status === "cancelled"
    ? priorStatus === "requested" || priorStatus === "approved"
    : priorStatus === "requested";
  if (!prior || prior.event_type !== "time_off" || !allowedTransition) {
    return errorResponse("That time-off request cannot be approved here.", 404, { code: "ALPHA_TIMEOFF_NOT_FOUND" });
  }
  if (status === "approved") {
    const assigned = Array.isArray(prior.assigned_usernames) ? prior.assigned_usernames : [];
    const usernames = [...new Set([prior.assigned_to_username, ...assigned].map(value => normalizeUsername(String(value || ""))).filter(Boolean))];
    if (!usernames.length) return errorResponse("Assign an employee before approving this time-off request.", 409, { code: "ALPHA_TIMEOFF_EMPLOYEE_UNAVAILABLE" });
    const { data: employeeProfiles, error: profileError } = await supabase.from("profiles").select("id,username,locked_until,must_change_password")
      .in("username", usernames).is("disabled_at", null).eq("must_change_password", false);
    if (profileError) throw profileError;
    const activeProfiles = (employeeProfiles || []).filter(row => {
      const locked = Date.parse(String(row.locked_until || ""));
      return !Number.isFinite(locked) || locked <= Date.now();
    });
    const profileByUsername = new Map(activeProfiles.map(row => [normalizeUsername(String(row.username || "")), String(row.id || "")]));
    const profileIds = usernames.map(username => profileByUsername.get(username) || "");
    if (profileIds.some(id => !id)) return errorResponse("An assigned employee profile is unavailable. Update the request before approval.", 409, { code: "ALPHA_TIMEOFF_EMPLOYEE_UNAVAILABLE" });
    const { data: employees, error: employeeError } = await supabase.from("core_employees").select("id,profile_id")
      .in("profile_id", profileIds).eq("active", true);
    if (employeeError) throw employeeError;
    const mappedIds = new Set((employees || []).map(row => String(row.profile_id || "")));
    if (profileIds.some(id => !mappedIds.has(id))) return errorResponse("Add an active HR employee record for every assigned profile before approving time off.", 409, { code: "ALPHA_TIMEOFF_HR_RECORD_REQUIRED" });
  }
  const update = {
    status, approved_by_username: status === "approved" ? "dylan_collyge" : null,
    approved_by_display: status === "approved" ? String(actor.display_name || "Dylan") : null,
    approved_at: status === "approved" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = await supabase.from("ph_department_calendar_events").update(update)
    .eq("unique_id", eventId).eq("status", priorStatus)
    .select("unique_id,title,start_at,end_at,assigned_to_username,status,department,approved_by_username,approved_at").maybeSingle();
  if (error) throw error;
  if (!saved) return errorResponse("The request changed while you were reviewing it. Refresh and try again.", 409, { code: "ALPHA_TIMEOFF_CHANGED" });
  return jsonResponse({ ok: true, event: { id: saved.unique_id, title: saved.title, startAt: saved.start_at, endAt: saved.end_at, assignedUsername: saved.assigned_to_username, status: saved.status, department: saved.department, approvedByUsername: saved.approved_by_username, approvedAt: saved.approved_at } });
}

async function handlePhotoUpload(session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>, req: Request) {
  if (!session) return errorResponse("Unauthorized", 401);
  const access = getRoleAccessState(session.role);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });

  const form = await req.formData();
  const prefix = String(form.get("prefix") || "default").trim();
  if (access.isRepLike && !REP_ALLOWED_PHOTO_PREFIXES.has(prefix)) {
    return errorResponse("REP users can only upload request or credit photos.", 403);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("No photo file was provided.", 400);
  const uploadContract = String(form.get("uploadContract") || "").trim().toLowerCase();
  const isV2Upload = uploadContract === "plant-photo-v2";

  let evalWorkId = "";
  let evalOriginUid = "";
  let evalMultiOrigin = false;
  if (prefix === "eval-") {
    evalWorkId = String(form.get("workId") || "").trim();
    const originUid = String(form.get("originUid") || "").trim();
    evalOriginUid = originUid;
    if (!/^[A-Za-z0-9._-]+$/.test(originUid)) {
      return errorResponse("Invalid Eval origin.", 400, { code: "eval_work_photo_origin_invalid" });
    }
    const rawRow = await loadAuthorizedEvalWork(session, evalWorkId).catch(() => null);
    const row = rawRow ? (await withEvalWorkOrigins([rawRow]).catch(() => []))[0] : null;
    const actor = normalizeUsername(session.username || session.displayName || "");
    const originAllowed = row && String(row.contract_version || "") === "eval-work-v2-multi-origin"
      ? (Array.isArray(row.origins) && (row.origins as Record<string, unknown>[])
        .some((origin) => String(origin.origin_unique_id || "") === originUid))
      : String(row && row.origin_unique_id || "") === originUid;
    evalMultiOrigin = !!row && String(row.contract_version || "") === "eval-work-v2-multi-origin";
    if (!row || !isEvalWorkAssignedTo(row, actor)
      || !["open", "in_progress"].includes(String(row.status || ""))
      || !originAllowed) {
      return errorResponse("Eval photo upload is not authorized for this assignment and row.", 403, { code: "eval_work_photo_forbidden" });
    }
  }

  let protectedMasterUid = "";
  if (PROTECTED_DRIVE_PHOTO_PREFIXES.has(prefix)) {
    protectedMasterUid = String(form.get("masterUid") || "").trim();
    const expectedItemcode = String(form.get("itemCode") || "").trim();
    const expectedLocation = String(form.get("locationCode") || "").trim();
    const expectedLot = String(form.get("lotCode") || "").trim();
    if (!protectedMasterUid || !expectedItemcode || !expectedLocation || !expectedLot) {
      return errorResponse("Exact Drive row identity is required.", 400, { code: "drive_photo_identity_required" });
    }
    const { data: masterRow, error: masterError } = await supabase
      .from("ph_master_inventory")
      .select("unique_id,itemcode,locationcode,lotcode")
      .eq("unique_id", protectedMasterUid)
      .maybeSingle();
    if (masterError || !masterRow
      || String(masterRow.itemcode || "").trim() !== expectedItemcode
      || String(masterRow.locationcode || "").trim() !== expectedLocation
      || String(masterRow.lotcode || "").trim() !== expectedLot) {
      return errorResponse("Drive row identity changed. Refresh before uploading.", 409, { code: "drive_photo_row_conflict" });
    }
    const actor = await resolveActiveSessionProfile(session).catch(() => null);
    if (!actor) return errorResponse("An active profile is required for Drive photo uploads.", 403, { code: "drive_photo_forbidden" });
    const actorKey = normalizeInventoryLiveChangeUsername(actor.username);
    if (!access.isAdmin && !GLOBAL_INVENTORY_LIVE_CHANGE_USERS.has(actorKey) && actorKey !== "jorge_colunga") {
      return errorResponse("Drive photo upload requires an active Admin profile.", 403, { code: "drive_photo_forbidden" });
    }
    try {
      await assertInventoryLiveChangeActorRows(supabase, actor, [{
        uniqueId: protectedMasterUid, itemcode: expectedItemcode, locationcode: expectedLocation, lotcode: expectedLot,
      }]);
    } catch (error) {
      const message = actorKey === "jorge_colunga"
        ? "Live changes for jorge_colunga are only permitted on rows assigned to jorge_colunga in Assigned Items."
        : "Drive photo upload is only enabled on inventory rows assigned to your account.";
      return errorResponse(message, 403, { code: String(error instanceof Error ? error.message : "drive_photo_forbidden") });
    }
  }

  const bucketName = PHOTO_BUCKETS[prefix] || PHOTO_BUCKETS.default;
  if (!isV2Upload) {
    try {
      const legacy = await validatePhotoPart(file, PHOTO_LEGACY_MAX_BYTES);
      const requestedFileName = sanitizeStorageFileName(String(form.get("fileName") || file.name || ""));
      const originalName = sanitizeFileName(String(form.get("fileName") || file.name || "photo"));
      const requestedBase = requestedFileName ? requestedFileName.replace(/\.[^.]+$/, "") : `${originalName}-${Date.now()}`;
      const fileName = `${requestedBase}.${legacy.extension}`;
      const filePath = prefix === "eval-"
        ? (evalMultiOrigin ? `eval/${evalWorkId}/${String(evalOriginUid)}/${fileName}` : `eval/${evalWorkId}/${fileName}`)
        : (protectedMasterUid
          ? `drive/${sanitizeStorageFileName(protectedMasterUid)}/${fileName}`
          : `${new Date().toISOString().split("T")[0]}/${fileName}`);
      await uploadImmutablePhotoObject(bucketName, filePath, legacy);
      const publicUrlData = supabase.storage.from(bucketName).getPublicUrl(filePath);
      return jsonResponse({
        ok: true,
        contractVersion: "plant-photo-legacy-compatible",
        publicUrl: String(publicUrlData.data.publicUrl || "").trim(),
        bucketName,
        filePath,
        mimeType: legacy.mimeType,
        byteCount: legacy.bytes.byteLength,
        masterUid: protectedMasterUid || undefined,
      });
    } catch (error) {
      const code = String(error instanceof Error ? error.message : error || "");
      if (["PHOTO_TOO_LARGE", "PHOTO_ENCODING_UNSUPPORTED", "PHOTO_MIME_MISMATCH"].includes(code)) {
        return errorResponse("This app version cannot safely upload that photo. Refresh the app and retry.", 409, { code: "PHOTO_TOO_LARGE_REFRESH_REQUIRED" });
      }
      return errorResponse("Photo upload is temporarily unavailable. Retry without retaking the photo.", 503, { code: "PHOTO_UPLOAD_RETRY" });
    }
  }

  const thumbnail144 = form.get("thumbnail144");
  const thumbnail320 = form.get("thumbnail320");
  if (!(thumbnail144 instanceof File) || !(thumbnail320 instanceof File)) {
    return errorResponse("The optimized thumbnail set is incomplete. Refresh the app and retry.", 400, { code: "PHOTO_THUMBNAILS_REQUIRED" });
  }
  try {
    const [displayPart, thumb144Part, thumb320Part] = await Promise.all([
      validatePhotoPart(file, PHOTO_V2_DISPLAY_MAX_BYTES),
      validatePhotoPart(thumbnail144, PHOTO_V2_THUMB_144_MAX_BYTES),
      validatePhotoPart(thumbnail320, PHOTO_V2_THUMB_320_MAX_BYTES),
    ]);
    if (displayPart.mimeType !== thumb144Part.mimeType || displayPart.mimeType !== thumb320Part.mimeType) {
      return errorResponse("The optimized photo encodings do not match. Refresh the app and retry.", 400, { code: "PHOTO_MIME_MISMATCH" });
    }
    const width = readPositivePhotoDimension(form, "displayWidth", 1920);
    const height = readPositivePhotoDimension(form, "displayHeight", 1920);
    const thumbnail144Width = readPositivePhotoDimension(form, "thumbnail144Width", 144);
    const thumbnail144Height = readPositivePhotoDimension(form, "thumbnail144Height", 144);
    const thumbnail320Width = readPositivePhotoDimension(form, "thumbnail320Width", 320);
    const thumbnail320Height = readPositivePhotoDimension(form, "thumbnail320Height", 320);
    const hash = await sha256Hex(displayPart.bytes);
    const filePath = `v2/${hash}.${displayPart.extension}`;
    const thumbnail144Path = `_thumbs/v2/${hash}-w144.${displayPart.extension}`;
    const thumbnail320Path = `_thumbs/v2/${hash}-w320.${displayPart.extension}`;
    await Promise.all([
      uploadImmutablePhotoObject(bucketName, thumbnail144Path, thumb144Part),
      uploadImmutablePhotoObject(bucketName, thumbnail320Path, thumb320Part),
    ]);
    await uploadImmutablePhotoObject(bucketName, filePath, displayPart);
    const publicUrl = String(supabase.storage.from(bucketName).getPublicUrl(filePath).data.publicUrl || "").trim();
    const thumbnail144Url = String(supabase.storage.from(bucketName).getPublicUrl(thumbnail144Path).data.publicUrl || "").trim();
    const thumbnail320Url = String(supabase.storage.from(bucketName).getPublicUrl(thumbnail320Path).data.publicUrl || "").trim();
    return jsonResponse({
      ok: true,
      contractVersion: "plant-photo-v2",
      publicUrl,
      bucketName,
      filePath,
      thumbnailUrls: { "144": thumbnail144Url, "320": thumbnail320Url },
      thumbnail144Url,
      thumbnail320Url,
      width,
      height,
      thumbnail144Width,
      thumbnail144Height,
      thumbnail320Width,
      thumbnail320Height,
      mimeType: displayPart.mimeType,
      byteCount: displayPart.bytes.byteLength,
      thumbnail144ByteCount: thumb144Part.bytes.byteLength,
      thumbnail320ByteCount: thumb320Part.bytes.byteLength,
      sha256: hash,
      masterUid: protectedMasterUid || undefined,
    });
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error || "");
    if (code === "PHOTO_TOO_LARGE") return errorResponse("The compressed photo is still too large. Retake it or retry after refresh.", 413, { code: "PHOTO_TOO_LARGE" });
    if (code === "PHOTO_MIME_MISMATCH") return errorResponse("The photo encoding did not match its MIME type.", 400, { code: "PHOTO_MIME_MISMATCH" });
    if (code === "PHOTO_ENCODING_UNSUPPORTED") return errorResponse("Only JPEG or WebP plant photos can be uploaded.", 415, { code: "PHOTO_ENCODING_UNSUPPORTED" });
    if (code === "PHOTO_DIMENSIONS_INVALID") return errorResponse("The optimized photo dimensions are invalid. Refresh and retry.", 400, { code: "PHOTO_DIMENSIONS_INVALID" });
    return errorResponse("Photo upload is temporarily unavailable. Retry without retaking the photo.", 503, { code: "PHOTO_UPLOAD_RETRY" });
  }
}

type BunchNoteRpcResult = { data: unknown; error: { message?: string; code?: string } | null };
type BunchNoteRpc = (name: string, args: Record<string, unknown>) => Promise<BunchNoteRpcResult>;

function cleanBunchNoteText(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, limit);
}

function canonicalBunchNoteLocation(value: unknown): string {
  const location = normalizeBunchNoteLocationKey(value);
  return /^[A-Z0-9]+\.[A-Z0-9]+$/.test(location) ? `${location}.000` : location;
}

function normalizeBunchNoteLocationKey(value: unknown): string {
  return cleanBunchNoteText(value, 200).toUpperCase().replace(/\s+/g, "").replace(/\.+$/, "").replace(/\.000$/, "");
}

function normalizeBunchNoteSavePayload(value: unknown): Record<string, unknown> {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  const bodyValue = payload.body;
  if (!bodyValue || typeof bodyValue !== "object" || Array.isArray(bodyValue)) return payload;
  const body: Record<string, unknown> = { ...(bodyValue as Record<string, unknown>), format_version: 5 };
  const locationValues: unknown[] = Array.isArray(body.locations) ? body.locations : [];
  const locations: Record<string, unknown>[] = locationValues.filter((entry: unknown): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry)).map((entry: Record<string, unknown>) => {
    const location = canonicalBunchNoteLocation(entry.location || entry.source_location);
    const next: Record<string, unknown> = { ...entry, location, source_location: location, format_version: 5 };
    const workType = cleanBunchNoteText(entry.work_type || entry.title || entry.purposes || `${location.replace(/\.000$/, "")} Bunch Notes`, 500);
    next.work_type = workType;
    next.purposes = cleanBunchNoteText(entry.purposes || workType, 500);
    for (const [key, limit] of [["title", 500], ["purpose_thread", 500], ["default_house_plan", 800], ["schedule_banner", 2000], ["direction", 200], ["instructions", 8000], ["prerequisites", 8000]] as const) {
      if (key in entry || !["title"].includes(key)) next[key] = cleanBunchNoteText(entry[key], limit);
    }
    const ruleChips: unknown[] = Array.isArray(entry.rule_chips) ? entry.rule_chips : [];
    next.rule_chips = ruleChips.map((chip: unknown) => cleanBunchNoteText(chip, 500)).filter(Boolean).slice(0, 20);
    if (Array.isArray(entry.cards)) next.cards = entry.cards.map((card: unknown) => card && typeof card === "object" && !Array.isArray(card) && (card as Record<string, unknown>).kind !== "divider" ? { ...(card as Record<string, unknown>), location_code: location } : card);
    return next;
  });
  const firstBlock = locations.map((location: Record<string, unknown>) => canonicalBunchNoteLocation(location.location).split(".")[0]).find(Boolean) || "";
  body.locations = locations;
  body.block = cleanBunchNoteText(body.block, 100).toUpperCase().replace(/\.+$/, "") || firstBlock;
  payload.body = body;
  return payload;
}

function forceBunchNoteDylanRecipient(value: unknown, dylanProfileId: string, operation: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value || {};
  const next = { ...(value as Record<string, unknown>) };
  if (operation === "save" && next.body && typeof next.body === "object" && !Array.isArray(next.body)) {
    next.body = { ...(next.body as Record<string, unknown>), recipient_ids: [dylanProfileId] };
  }
  if (operation === "work_preview") next.recipient_ids = [dylanProfileId];
  return next;
}

export async function renderBunchNotePreview(options: {
  rpc: BunchNoteRpc;
  actor: { id: string; username?: string; display_name?: string | null };
  previewId: string;
}) {
  const { data: previewValue, error: previewError } = await options.rpc("bunch_note_command_v1", {
    p_actor_id: options.actor.id,
    p_operation: "preview_read",
    p_payload: { preview_id: options.previewId },
  });
  if (previewError) throw new Error(previewError.message || "BUNCH_NOTE_PREVIEW_READ_FAILED");
  const preview = previewValue && typeof previewValue === "object" && !Array.isArray(previewValue)
    ? previewValue as Record<string, unknown> : {};
  if (!Array.isArray(preview.reports) || preview.reports.length === 0) throw new Error("BUNCH_NOTE_PREVIEW_INVALID");
  if (preview.pdfs !== null && preview.pdfs !== undefined) {
    if (!Array.isArray(preview.pdfs)) throw new Error("BUNCH_NOTE_PREVIEW_PDFS_INVALID");
    return { ok: true as const, pdfs: preview.pdfs };
  }
  const preparedBy = String(options.actor.display_name || options.actor.username || "Unknown").trim();
  const pdfs = await renderBunchNoteReportsPdf(preview.reports, preparedBy || "Unknown");
  const { data: frozenValue, error: freezeError } = await options.rpc("bunch_note_freeze_pdfs_v1", {
    p_preview_id: options.previewId,
    p_pdfs: pdfs,
  });
  if (freezeError) throw new Error(freezeError.message || "BUNCH_NOTE_PDF_FREEZE_FAILED");
  const frozen = frozenValue && typeof frozenValue === "object" && !Array.isArray(frozenValue)
    ? frozenValue as Record<string, unknown> : {};
  if (!Array.isArray(frozen.pdfs)) throw new Error("BUNCH_NOTE_PDF_FREEZE_INVALID");
  return { ok: true as const, pdfs: frozen.pdfs };
}

type CanonicalActionGate = { flag: CanonicalUserAccessFlag } | { any: readonly CanonicalUserAccessFlag[] };

function canonicalActionGate(action: string, payload: Record<string, unknown>): CanonicalActionGate | null {
  if (action === "manager_table_management") return { flag: "can_access_manager_tab" };
  if (action === "fast_erp_ingest") return { flag: "can_access_manager_tab" };
  if (action === "erp_sync") return String(payload.operation || "").trim().toLowerCase() === "status"
    ? { any: ["can_access_drive_mode", "can_access_av", "can_access_que", "can_access_manager_tab"] }
    : { flag: "can_access_manager_tab" };
  if (action === "manual_sync_status") return { any: ["can_access_drive_mode", "can_access_av", "can_access_que", "can_access_manager_tab"] };
  if (action === "av_read") return { flag: "can_access_av" };
  if (action === "dataset_read") {
    const dataset = normalizeDatasetReadAlias(payload.dataset);
    if (["suspend_tag", "location_moves", "eval_work", "bunch_notes", "count_review", "request_history"].includes(dataset)) return { flag: "can_access_que" };
    const flags = CANONICAL_DATASET_READ_FLAGS[dataset];
    if (flags) return { any: flags };
    return { any: ["can_access_drive_mode", "can_access_av", "can_access_que", "can_access_manager_tab"] };
  }
  if (action === "inventory_read") {
    const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
      ? payload.params as Record<string, unknown> : {};
    if (String(params.dataset || "").trim() === "avOpen") return { flag: "can_access_av" };
    return { any: ["can_access_drive_mode", "can_access_av", "can_access_que", "can_access_manager_tab", "can_submit_reclass"] };
  }
  if (action === "drive_reclass_inquiry") {
    return String(payload.operation || "create").trim().toLowerCase() === "create"
      ? { flag: "can_submit_reclass" } : { flag: "can_access_drive_mode" };
  }
  if (action === "reclass_recount") return { flag: "can_access_que" };
  if (action === "dataset_revisions") return { any: ["can_access_drive_mode", "can_access_av", "can_access_que", "can_access_manager_tab"] };
  if (action === "inventory_reclass_move") return { flag: "can_submit_reclass" };
  if (["request_work", "request_history", "sales_credit", "request_queue_remove", "request_archive", "bunch_note", "bunch_note_workflow"].includes(action)) {
    return { flag: "can_access_que" };
  }
  if (action === "eval_work" && String(payload.operation || "list").trim().toLowerCase() === "report_page") {
    return { flag: "can_access_eval_reports_2" };
  }
  if (action === "suspend_tag") {
    if (payload.operation === "dock_review") return { flag: "can_access_drive_mode" };
    return String(payload.operation || "").trim().toLowerCase() === "decide"
      ? { flag: "can_approve_deny_suspend" }
      : ["approval", "inbox", "rows"].includes(String(payload.operation || "").trim().toLowerCase())
      ? { flag: "can_access_que" } : { flag: "can_complete_suspend_tag" };
  }
  if (action === "production_workflow" || action === "inventory_transaction_history") return { flag: "can_access_drive_mode" };
  if (action === "manager_season_settings") return { flag: "can_access_manager_tab" };
  if (action === "report_read_v2") {
    const query = payload.query && typeof payload.query === "object" && !Array.isArray(payload.query)
      ? payload.query as Record<string, unknown> : payload;
    const surface = String(query.surface || "").trim().toLowerCase();
    if (surface === "eval2") return { flag: "can_access_eval_reports_2" };
    if (["assigned-items", "season-priority"].includes(surface)) return { flag: "can_access_manager_tab" };
  }
  return null;
}

function dispatchCloudErpSync(initial: Record<string, unknown>) {
  const runId = String(initial.runId || "");
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime;
  if (!runtime?.waitUntil || !ERP_SYNC_CLOUD_WORKER_KEY) throw new Error("ERP_SYNC_CLOUD_WORKER_UNAVAILABLE");
  const task = (async () => {
    let failures = 0;
    const retryDeadline = Date.now() + 150000;
    while (Date.now() < retryDeadline) {
      try {
        const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/app-api`, {
          method: "POST", headers: { "content-type": "application/json", apikey: SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${ERP_SYNC_CLOUD_WORKER_KEY}` },
          body: JSON.stringify({ action: "erp_sync_continue", runId }), signal: AbortSignal.timeout(15000),
        });
        const body = await response.json() as Record<string, unknown>;
        if (!response.ok) throw new Error(`ERP_SYNC_CONTINUATION_${response.status}`);
        if (body.claimed === false && body.active === true) {
          // A lost release response or overlapping browser request must not strand
          // the run. Wait outside the HTTP handler until its shared lease is free.
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        return;
      } catch (error) {
        if (++failures >= 2) {
          recordHandledError("app-api", "ERP_SYNC_CONTINUATION_FAILED", error, 503);
          return;
        }
      }
    }
  })();
  runtime.waitUntil(task);
}

async function claimAndDispatchCloudStep(runId: string) {
  const latest = await supabase.rpc("get_erp_sync_status_v1" as never, {} as never);
  if (latest.error) throw latest.error;
  const status = jsonObject(latest.data);
  if (status.runId !== runId || status.active !== true) return false;
  // Cloud and browser continuations claim the same row lock and expiring lease.
  const { data, error } = await supabase.rpc("claim_erp_sync_request_step_v1" as never, {
    p_run_id: runId, p_actor: String(status.requestedBy || status.actor || ""),
  } as never);
  if (error) throw error;
  const claim = jsonObject(data);
  if (claim.claimed !== true) return false;
  // Queue the successor before CPU/memory-heavy workbook processing. Its lease
  // retry survives an interrupted worker as well as an ordinary completed step.
  dispatchCloudErpSync({ runId });
  const workerId = String(claim.workerId || claim.worker_id || "");
  const step = Number(claim.continuationStep ?? claim.continuation_step);
  const task = executeCloudErpSyncStep(runId, workerId, step, claim).catch(error => {
    recordHandledError("app-api", "ERP_SYNC_WORKER_FAILED", error, 500);
  });
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime;
  if (!runtime?.waitUntil) throw new Error("ERP_SYNC_EDGE_RUNTIME_UNAVAILABLE");
  runtime.waitUntil(task);
  return true;
}

async function handleErpSyncContinuation(payload: Record<string, unknown>, req: Request) {
  if (!ERP_SYNC_CLOUD_WORKER_KEY || String(req.headers.get("authorization") || "") !== `Bearer ${ERP_SYNC_CLOUD_WORKER_KEY}`) {
    return errorResponse("Cloud worker authorization required.", 401, { code: "ERP_SYNC_CLOUD_WORKER_UNAUTHORIZED" });
  }
  if (Object.keys(payload).some(key => !["action", "runId"].includes(key))) {
    return errorResponse("Invalid cloud worker continuation.", 400, { code: "ERP_SYNC_CONTINUATION_INVALID" });
  }
  const runId = String(payload.runId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return errorResponse("Invalid cloud worker continuation.", 400, { code: "ERP_SYNC_CONTINUATION_INVALID" });
  }
  try {
    const claimed = await claimAndDispatchCloudStep(runId);
    if (claimed) return jsonResponse({ ok: true, claimed }, 202);
    const latest = await supabase.rpc("get_erp_sync_status_v1" as never, {} as never);
    if (latest.error) throw latest.error;
    const status = jsonObject(latest.data);
    return jsonResponse({ ok: true, claimed, active: status.runId === runId && status.active === true });
  } catch (error) {
    const message = String((error as { message?: unknown })?.message || "ERP_SYNC_CONTINUATION_FAILED").slice(0, 200);
    recordHandledError("app-api", message, error, 503);
    return errorResponse("ERP sync continuation failed.", 503, { code: "ERP_SYNC_CONTINUATION_FAILED" });
  }
}

async function failCloudErpSync(runId: string, error: unknown, message: string) {
  const { data } = await supabase.rpc("get_erp_sync_status_v1" as never, {} as never);
  const current = jsonObject(data);
  if (String(current.runId || current.run_id || "") !== runId || current.active !== true) return;
  await supabase.rpc("update_erp_sync_job_v1" as never, { p_run_id: runId, p_status: {
    ...current, active: false, status: "failed", currentStage: "idle", currentStageLabel: "Idle",
    stageIndex: ERP_SYNC_STAGES.length, stageResults: Array.isArray(current.stageResults) ? current.stageResults : [],
    finishedAt: new Date().toISOString(), error: message, errorCode: message,
    message: "ERP sync failed before all stages completed.",
  } } as never);
  recordHandledError("app-api", "ERP_SYNC_WORKER_FAILED", error, 500);
}

async function withCloudErpSyncLeaseHeartbeat<T>(runId: string, workerId: string, work: () => Promise<T>): Promise<T> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const heartbeat = async () => {
    const { error } = await supabase.rpc("assert_erp_sync_worker_v1" as never, {
      p_run_id: runId, p_worker_id: workerId,
    } as never);
    if (error) throw error;
  };
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = heartbeat().catch(() => undefined).finally(() => { inFlight = null; });
  }, 4000);
  try {
    const result = await work();
    stopped = true;
    clearInterval(timer);
    const pending = inFlight;
    if (pending) await pending;
    // A renewal already in flight can observe the just-written inactive terminal status.
    // processCloudErpSyncStep asserts ownership before every durable status write.
    return result;
  } finally {
    stopped = true;
    clearInterval(timer);
    const pending = inFlight;
    if (pending) await pending;
  }
}

async function processCloudErpSyncStep(runId: string, workerId: string, step: number, claimedStatus: Record<string, unknown>, maxRowsPerSlice?: number) {
  const status = claimedStatus.status && typeof claimedStatus.status === "object" ? jsonObject(claimedStatus.status) : claimedStatus;
  const cursor = status.continuationCursor && typeof status.continuationCursor === "object"
    ? jsonObject(status.continuationCursor) : { stageIndex: 0, stageResults: [], attemptedByStage: {} };
  let current: Record<string, unknown> = { ...status };
  const persist = async (patch: Record<string, unknown>) => {
    const lease = await supabase.rpc("assert_erp_sync_worker_v1" as never, {
      p_run_id: runId, p_worker_id: workerId,
    } as never);
    if (lease.error) throw new Error("ERP_SYNC_WORKER_LEASE_INVALID");
    const merged: Record<string, unknown> = { ...current, ...patch };
    const delta = patch.stageResultsDelta;
    delete merged.stageResultsDelta;
    if (delta && typeof delta === "object" && !Array.isArray(delta)) {
      const row = delta as Record<string, unknown>;
      const prior = Array.isArray(current.stageResults) ? current.stageResults as Record<string, unknown>[] : [];
      const index = prior.findIndex(item => item.key === row.key);
      const next = prior.slice();
      if (index >= 0) next[index] = { ...next[index], ...row };
      else next.push(row);
      merged.stageResults = next;
    }
    const { error } = await supabase.rpc("update_erp_sync_job_v1" as never, { p_run_id: runId, p_status: merged } as never);
    if (error) throw error;
    current = merged;
  };
  try {
    const accessToken = await mintCloudDriveAccessToken();
    const cap = Math.max(600, Math.min(2500, Number(maxRowsPerSlice || current.maxRowsPerSlice || cursor.maxRowsPerSlice) || 2500));
    await persist({ maxRowsPerSlice: cap });
    const secondary = async (nextCursor: Record<string, unknown>) => runSecondaryErpSyncStep({
      supabase, env: (key: string) => key === "SUPABASE_SERVICE_ROLE_KEY" ? SUPABASE_SERVICE_ROLE_KEY
        : key === "SUPABASE_URL" ? SUPABASE_URL : Deno.env.get(key) || "", cursor: nextCursor, status: persist, accessToken,
    });
    let result: { done: boolean; cursor: Record<string, unknown>; ok?: boolean };
    if (cursor.coreComplete === true) result = await secondary(cursor);
    else {
      const coreStatus = (patch: Record<string, unknown>) => persist(patch.active === false
        ? { ...patch, active: true, status: "CONTINUE", currentStage: "transactions_keyed", finishedAt: null }
        : patch);
      result = await runErpSyncWorkerStep({ supabase, env: (key: string) => Deno.env.get(key) || "", cursor, status: coreStatus, accessToken, maxRowsPerSlice: cap });
      if (result.done) {
        const nextCursor = { ...result.cursor, coreComplete: true };
        await persist({ continuationCursor: nextCursor });
        result = await secondary(nextCursor);
      }
    }
    if (current.active !== false && Number(current.sliceFailures || 0) > 0) await persist({ sliceFailures: 0 });
    return { result, status: current };
  } catch (error) {
    const message = String((error as { message?: unknown })?.message || "ERP_SYNC_WORKER_FAILED").slice(0, 200);
    // An expired worker must not mark its replacement's active run failed.
    const lease = await supabase.rpc("assert_erp_sync_worker_v1" as never, {
      p_run_id: runId, p_worker_id: workerId,
    } as never);
    if (!lease.error) {
      const failures = Number(current.sliceFailures || 0) + 1;
      if (failures <= 6) {
        const priorCap = Number(maxRowsPerSlice || current.maxRowsPerSlice) || 2500;
        await supabase.rpc("update_erp_sync_job_v1" as never, { p_run_id: runId, p_status: {
          ...current, active: true, status: "CONTINUE", sliceFailures: failures,
          maxRowsPerSlice: priorCap >= 2500 ? 1250 : 600,
          error: message, errorCode: "ERP_SYNC_SLICE_RETRY", message: "Retrying the current import slice with a smaller batch.",
        } } as never);
      } else await failCloudErpSync(runId, error, message);
    }
    throw error;
  }
}

async function releaseCloudErpSyncStep(runId: string, workerId: string, step: number) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const released = await supabase.rpc("release_erp_sync_request_step_v1" as never,
      { p_run_id: runId, p_worker_id: workerId, p_step: step } as never);
    if (!released.error) return;
    if (attempt === 1) recordHandledError("app-api", "ERP_SYNC_LEASE_RELEASE_FAILED", released.error, 503);
  }
}

async function executeCloudErpSyncStep(runId: string, workerId: string, step: number, claimedStatus: Record<string, unknown>) {
  try {
    await withCloudErpSyncLeaseHeartbeat(runId,workerId,() => processCloudErpSyncStep(runId,workerId,step,claimedStatus));
  } finally {
    await releaseCloudErpSyncStep(runId,workerId,step);
  }
}

async function mintCloudDriveAccessToken() {
  if (!PRODUCTION_SCHEDULE_APPS_SCRIPT_URL || !PRODUCTION_SCHEDULE_SIGNING_SECRET) {
    throw new Error("ERP_SYNC_APPS_SCRIPT_TOKEN_BRIDGE_UNAVAILABLE");
  }
  const command = { contractVersion: "apps-script-action-v1", action: "mint_drive_token",
    payload: { type: "mint_drive_token" }, actor: { system: "erp-sync-cloud-worker" } };
  const timestamp = new Date().toISOString();
  const { deliveryJson, signature } = await signProductionScheduleCommand(command, timestamp, PRODUCTION_SCHEDULE_SIGNING_SECRET);
  const response = await fetch(PRODUCTION_SCHEDULE_APPS_SCRIPT_URL, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "apps_script_action_v1", timestamp, signature, deliveryJson }),
    signal: AbortSignal.timeout(15000), redirect: "follow" });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : body;
  const accessToken = String(data.accessToken || data.access_token || "");
  if (!response.ok || body.ok !== true || !accessToken) throw new Error("ERP_SYNC_DRIVE_TOKEN_MINT_FAILED");
  return accessToken;
}

async function handleErpSyncAction(session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>, actorValue: Record<string, unknown> | null) {
  if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
  const actor = actorValue || await resolveActiveSessionProfile(session);
  const command = validateErpSyncCommand(payload);
  const operation = String(payload.operation || "").trim().toLowerCase();
  if (operation === "status") {
    if (!command.ok) {
      return errorResponse("Invalid ERP sync status request.", 400, { code: "ERP_SYNC_REQUEST_INVALID" });
    }
    const { data, error } = await supabase.rpc("get_erp_sync_status_v1" as never, {} as never);
    if (error) return databaseFailureResponse("ERP sync status is unavailable.", error, "ERP_SYNC_STATUS_UNAVAILABLE");
    const status = jsonObject(data);
    if (status.active === true) return jsonResponse({ ok: true, data: status });
    return jsonResponse({ ok: true, data: { ...status, active: false, status: status.status || "idle",
      currentStage: "idle", currentStageLabel: "Idle", updatedAt: status.updatedAt || "" } });
  }
  if (!command.ok || !["start","continue"].includes(operation)) {
    return errorResponse("Invalid ERP sync start request.", 400, { code: "ERP_SYNC_REQUEST_INVALID" });
  }
  if (!FULL_ACCESS_USER_KEYS.has(normalizeUsername(String(actor.username || "")))) {
    return errorResponse("Only designated administrators can run ERP sync.", 403, { code: "ERP_SYNC_FORBIDDEN" });
  }
  if (operation === "continue") {
    const runId = String(command.runId || "");
    const { data, error } = await supabase.rpc("claim_erp_sync_request_step_v1" as never, {
      p_run_id: runId, p_actor: normalizeUsername(String(actor.username || "")),
    } as never);
    if (error) return databaseFailureResponse("ERP sync continuation could not be claimed.", error, "ERP_SYNC_CONTINUE_CLAIM_FAILED");
    const claim = jsonObject(data), status = claim.status && typeof claim.status === "object" ? jsonObject(claim.status) : { ...claim };
    for (const privateField of ["workerId","worker_id","claimed","retryAfterMs","retry_after_ms","continuationStep","continuation_step"]) {
      delete status[privateField];
    }
    if (claim.claimed !== true) {
      const retryAfterMs = Math.max(250,Math.min(10000,Number(claim.retryAfterMs||claim.retry_after_ms)||1000));
      const latest = await supabase.rpc("get_erp_sync_status_v1" as never,{} as never);
      const durableStatus = latest.error ? status : jsonObject(latest.data);
      return jsonResponse({ok:true,status:durableStatus.active===true?"CONTINUE":durableStatus.status||"complete",data:durableStatus,
        runId,retryAfterMs,stage:durableStatus.currentStage||"idle",fileId:durableStatus.fileId||null,nextOffset:durableStatus.nextOffset??null});
    }
    const workerId = String(claim.workerId||claim.worker_id||"");
    const step = Number(claim.continuationStep??claim.continuation_step);
    if (!/^[0-9a-f-]{36}$/i.test(workerId) || !Number.isSafeInteger(step) || step<0) {
      return errorResponse("ERP sync continuation claim was not confirmed.",503,{code:"ERP_SYNC_CONTINUE_CLAIM_UNCONFIRMED"});
    }
    dispatchCloudErpSync({ runId });
    try {
      const {result,status:durableStatus} = await withCloudErpSyncLeaseHeartbeat(runId,workerId,() => processCloudErpSyncStep(runId,workerId,step,status,Number(command.maxRowsPerSlice)||undefined));
      const active = result.done !== true;
      const cursor = durableStatus.continuationCursor && typeof durableStatus.continuationCursor === "object"
        ? jsonObject(durableStatus.continuationCursor) : {};
      const fileContinuation = cursor.fileContinuation && typeof cursor.fileContinuation === "object"
        ? jsonObject(cursor.fileContinuation) : {};
      const fileState = fileContinuation.state && typeof fileContinuation.state === "object"
        && !Array.isArray(fileContinuation.state) ? jsonObject(fileContinuation.state) : {};
      return jsonResponse({ok:true,status:active?"CONTINUE":durableStatus.status||"complete",data:durableStatus,
        runId,stage:durableStatus.currentStage||"idle",fileId:fileContinuation.file && typeof fileContinuation.file === "object"
          ? (fileContinuation.file as Record<string,unknown>).id||null : null,
        nextOffset:fileState.nextOffset??null});
    } finally {
      await releaseCloudErpSyncStep(runId,workerId,step);
    }
  }
  const commandId = command.commandId;
  const { data, error } = await supabase.rpc("claim_erp_sync_job_v2" as never, {
    p_command_id: commandId, p_actor: normalizeUsername(String(actor.username || "")), p_force_restart: true,
  } as never);
  if (error) return databaseFailureResponse("ERP sync could not be queued.", error, "ERP_SYNC_CLAIM_FAILED");
  const claim = jsonObject(data);
  const claimStatus = claim.status && typeof claim.status === "object" && !Array.isArray(claim.status)
    ? jsonObject(claim.status) : claim;
  if (claim.claimed === true) {
    const runId = String(claim.runId || claim.run_id || claimStatus.runId || claimStatus.run_id || "");
    if (!runId) return errorResponse("ERP sync claim was not confirmed.", 503, { code: "ERP_SYNC_CLAIM_UNCONFIRMED" });
    const initial: Record<string, unknown> = { ...claimStatus, active: true, status: "queued", runId, commandId,
      actor: normalizeUsername(String(actor.username || "")), source: "postgresql",
      stageOrder: [...ERP_SYNC_STAGES, ...SECONDARY_ERP_STAGES].map(stage => stage.key), stageIndex: 0, currentStage: "queued",
      currentStageLabel: "Starting", message: "Running cloud sync.", stageResults: [],
      continuationCursor: { stageIndex: 0, stageResults: [], attemptedByStage: {} }, fileId: null, nextOffset: null,
      startedAt: claimStatus.startedAt || new Date().toISOString(), updatedAt: claimStatus.updatedAt || new Date().toISOString(),
      maxAttemptsPerStage: 1, maxRowsPerSlice: Number(command.maxRowsPerSlice)||2500 };
    const { error: initialError } = await supabase.rpc("update_erp_sync_job_v1" as never, {
      p_run_id: runId, p_status: initial,
    } as never);
    if (initialError) return databaseFailureResponse("ERP sync could not be started.", initialError, "ERP_SYNC_START_FAILED");
    dispatchCloudErpSync(initial);
    return jsonResponse({ ok: true, status:"CONTINUE", data: initial });
  }
  if (claimStatus.active === true) dispatchCloudErpSync(claimStatus);
  return jsonResponse({ ok: true, status:claimStatus.active===true?"CONTINUE":claimStatus.status||"complete", data: claimStatus });
}

const ERP_SYNC_WORKER_OPERATIONS: Record<string, { rpc: string; argKeys: readonly string[] }> = {
  update_status: { rpc: "update_erp_sync_job_v1", argKeys: ["p_status"] },
  columns: { rpc: "fast_erp_import_columns_v1", argKeys: ["p_dataset_key"] },
  check_file: { rpc: "check_erp_file_sync_needed_v1", argKeys: ["p_dataset_key", "p_file_id", "p_file_name", "p_modified_at", "p_content_hash"] },
  begin: { rpc: "fast_begin_erp_stage_v1", argKeys: ["p_dataset_key", "p_file_meta", "p_expected_rows"] },
  append: { rpc: "fast_append_erp_stage_batch_v1", argKeys: ["p_stage_id", "p_start_row", "p_rows"] },
  commit: { rpc: "fast_commit_erp_stage_swap_v1", argKeys: ["p_stage_id"] },
};

async function handleErpSyncWorker(payload: Record<string, unknown>, req: Request) {
  const authorization = String(req.headers.get("authorization") || "").trim();
  if (!ERP_SYNC_LOCAL_WORKER_KEY || authorization !== `Bearer ${ERP_SYNC_LOCAL_WORKER_KEY}`) {
    return errorResponse("Service worker authorization required.", 401, { code: "ERP_SYNC_WORKER_UNAUTHORIZED" });
  }
  if (Object.keys(payload).some(key => key !== "action" && key !== "payload")) {
    return errorResponse("Invalid ERP sync worker request.", 400, { code: "ERP_SYNC_WORKER_REQUEST_INVALID" });
  }
  const source = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
    ? payload.payload as Record<string, unknown> : {};
  if (Object.keys(source).some(key => !["operation", "runId", "workerId", "args"].includes(key))) {
    return errorResponse("Invalid ERP sync worker request.", 400, { code: "ERP_SYNC_WORKER_REQUEST_INVALID" });
  }
  const operation = String(source.operation || "").trim().toLowerCase();
  if (operation === "status") {
    if (Object.keys(source).some(key => key !== "operation")) return errorResponse("Invalid ERP sync worker status request.", 400, { code: "ERP_SYNC_WORKER_REQUEST_INVALID" });
    const { data, error } = await supabase.rpc("get_erp_sync_status_v1" as never, {} as never);
    if (error) return databaseFailureResponse("ERP sync status is unavailable.", error, "ERP_SYNC_STATUS_UNAVAILABLE");
    return jsonResponse({ ok: true, data });
  }
  const runId = String(source.runId || "").trim();
  const workerId = String(source.workerId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(runId) || !/^[0-9a-f-]{36}$/i.test(workerId)) {
    return errorResponse("Invalid ERP sync worker lease.", 400, { code: "ERP_SYNC_WORKER_LEASE_INVALID" });
  }
  if (operation === "claim_worker") {
    if (Object.keys(source).some(key => !["operation", "runId", "workerId"].includes(key))) return errorResponse("Invalid ERP sync worker claim.", 400, { code: "ERP_SYNC_WORKER_REQUEST_INVALID" });
    const { data, error } = await supabase.rpc("claim_erp_sync_worker_v1" as never, {
      p_run_id: runId, p_worker_id: workerId,
    } as never);
    if (error) return databaseFailureResponse("ERP sync worker claim failed.", error, "ERP_SYNC_WORKER_CLAIM_FAILED");
    const claim = jsonObject(data);
    return jsonResponse({ ok: true, data: { claimed: claim.claimed === true, status: claim } });
  }
  const spec = ERP_SYNC_WORKER_OPERATIONS[operation];
  const args = source.args && typeof source.args === "object" && !Array.isArray(source.args)
    ? source.args as Record<string, unknown> : null;
  if (!spec || !args || Object.keys(source).some(key => !["operation", "runId", "workerId", "args"].includes(key))
      || Object.keys(args).some(key => !spec.argKeys.includes(key))) {
    return errorResponse("Invalid ERP sync worker operation.", 400, { code: "ERP_SYNC_WORKER_REQUEST_INVALID" });
  }
  const lease = await supabase.rpc("assert_erp_sync_worker_v1" as never, {
    p_run_id: runId, p_worker_id: workerId,
  } as never);
  if (lease.error) return errorResponse("ERP sync worker lease is no longer active.", 409, { code: "ERP_SYNC_WORKER_LEASE_INVALID" });
  const rpcArgs: Record<string, unknown> = { ...args };
  if (operation === "update_status") {
    if (!rpcArgs.p_status || typeof rpcArgs.p_status !== "object" || Array.isArray(rpcArgs.p_status)) {
      return errorResponse("Invalid ERP sync status update.", 400, { code: "ERP_SYNC_WORKER_REQUEST_INVALID" });
    }
    rpcArgs.p_run_id = runId;
  }
  const { data, error } = await supabase.rpc(spec.rpc as never, rpcArgs as never);
  if (error) return databaseFailureResponse("ERP sync worker operation failed.", error, "ERP_SYNC_WORKER_OPERATION_FAILED");
  return jsonResponse({ ok: true, data });
}

if (import.meta.main) serve((req) => withObservedRequest("app-api", req, async () => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  try {
    ensureServerConfig();
  } catch (error) {
    return errorResponse(String(error instanceof Error ? error.message : error || "Server configuration missing."), 500);
  }

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  const payload = contentType.includes("multipart/form-data") ? {} as Record<string, unknown>
    : normalizeEscapedDisplayPayload(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(payload.action || "").trim().toLowerCase();
  if (!contentType.includes("multipart/form-data") && action === "erp_sync_continue") {
    return await handleErpSyncContinuation(payload, req);
  }
  if (!contentType.includes("multipart/form-data") && action === "erp_sync_worker") {
    return errorResponse("The local ERP worker is disabled.", 410, { code: "ERP_SYNC_LOCAL_WORKER_DISABLED" });
  }
  let session = await readSupabaseOrAppSessionFromRequest(req, supabase);
  let canonicalAccessForRequest: CanonicalUserAccess | null = null;
  let activeProfileForRequest: Record<string, unknown> | null = null;

  if (contentType.includes("multipart/form-data")) {
    try {
      const context = await resolveZeroTrustRequestContext(session);
      session = context.session;
      canonicalAccessForRequest = context.access;
      activeProfileForRequest = context.actor;
      return await handlePhotoUpload(session, req);
    } catch (error) {
      const message = String((error as { message?: unknown })?.message || "AUTH_REQUIRED");
      const status = Number((error as { status?: unknown })?.status)
        || ((error as { code?: unknown })?.code === "42501" || /profile_not_active|USER_ACCESS_FORBIDDEN/.test(message) ? 403 : /AUTH_REQUIRED|IDENTITY_MISMATCH/.test(message) ? 401 : 503);
      return errorResponse(status === 503 ? "Access could not be verified. Retry when the service is available." : "An active authenticated profile is required.", status, { code: status === 503 ? "USER_ACCESS_UNAVAILABLE" : message });
    }
  }

  // Login credentials, the native bridge, and the dedicated password reconciliation flow have
  // their own proof contracts; every other app-api action shares the gate below.
  if (action === "login") return await handleLogin(payload, req);
  if (["passkey_auth_options", "passkey_login_begin", "passkey_login_verify"].includes(action)) {
    return await handlePasskeyAuthenticationProxy(action, payload, req);
  }
  if (action === "native_session_bridge") return await handleNativeSessionBridge(session);
  if (action === "password_change") return await handlePasswordChange(await readPasswordChangeSession(req, session), payload);

  try {
    const context = await resolveZeroTrustRequestContext(session);
    session = context.session;
    canonicalAccessForRequest = context.access;
    activeProfileForRequest = context.actor;
  } catch (error) {
    const fallback = profilelessActionResponse(action, payload);
    if (fallback) return fallback;
    const message = String((error as { message?: unknown })?.message || "AUTH_REQUIRED");
    const status = Number((error as { status?: unknown })?.status)
      || ((error as { code?: unknown })?.code === "42501" || /profile_not_active|USER_ACCESS_FORBIDDEN/.test(message) ? 403 : /AUTH_REQUIRED|IDENTITY_MISMATCH/.test(message) ? 401 : 503);
    const code = status === 503 ? "USER_ACCESS_UNAVAILABLE" : message;
    return errorResponse(status === 503 ? "Access could not be verified. Retry when the service is available." : "An active authenticated profile is required.", status, { code });
  }

  if (action.startsWith("watchdog_")) {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
    try {
      const actor = activeProfileForRequest || await resolveActiveSessionProfile(session);
      const username = normalizeUsername(actor.username || session.username || "");
      const watchdogRole = (value: unknown) => {
        const role = normalizeRole(String(value || "")).toLowerCase();
        if (["salesrep", "sales_rep", "sales"].includes(role)) return "sales_rep";
        if (["dockoffice", "dock_office"].includes(role)) return "dock_office";
        if (["qcsupervisor", "qc_supervisor"].includes(role)) return "qc_supervisor";
        if (["dataentry", "data_entry"].includes(role)) return "data_entry";
        if (["takebacks", "take_backs"].includes(role)) return "take_backs";
        return role;
      };
      const privileged = new Set(["dylan_collyge", "megan_kelly", "jd_jones"]);
      if (action === "watchdog_log_event") {
        const event = payload.event && typeof payload.event === "object" && !Array.isArray(payload.event) ? payload.event as Record<string, unknown> : {};
        const allowed = new Set(["event_type", "severity", "app_version", "username", "normalized_role", "view_id", "sub_module", "duration_ms", "error_message", "dataset_revisions_snapshot", "cluster_id", "owning_skill", "suspected_functions", "fingerprint"]);
        if (Object.keys(event).some(key => !allowed.has(key)) || normalizeUsername(event.username) !== username) throw new Error("WATCHDOG_EVENT_INVALID");
        const boundedText = (value: unknown, max: number) => String(value || "").slice(0, max);
        const eventType = boundedText(event.event_type, 64);
        if (!new Set(["VIEW_LOAD_STALL", "ROLE_LATENCY_ANOMALY", "DATA_PARITY_MISMATCH", "UI_LOCKOUT_BANNER", "APP_API_FAILURE", "UNHANDLED_JS_EXCEPTION", "UNHANDLED_PROMISE_REJECTION", "OPERATIONAL_FAILURE"]).has(eventType)) throw new Error("WATCHDOG_EVENT_TYPE_INVALID");
        const severity: "low" | "medium" | "high" | "critical" = eventType === "UI_LOCKOUT_BANNER" ? "critical"
          : eventType === "UNHANDLED_JS_EXCEPTION" || eventType === "UNHANDLED_PROMISE_REJECTION" || eventType === "DATA_PARITY_MISMATCH" || eventType === "VIEW_LOAD_STALL" || eventType === "OPERATIONAL_FAILURE" ? "high"
          : eventType === "APP_API_FAILURE" && /\b5\d\d\b/.test(String(event.error_message || "")) ? "high" : "medium";
        const cluster = String(event.cluster_id || "");
        if (!new Set(["low", "medium", "high", "critical"]).has(severity) || !/^Cluster (?:[1-9]|10)$/.test(cluster)) throw new Error("WATCHDOG_EVENT_INVALID");
        const fingerprint = boundedText(event.fingerprint, 400);
        const appVersion = boundedText(event.app_version, 80);
        if (!fingerprint || !appVersion) throw new Error("WATCHDOG_EVENT_INVALID");
        const revisionInput = event.dataset_revisions_snapshot && typeof event.dataset_revisions_snapshot === "object" && !Array.isArray(event.dataset_revisions_snapshot)
          ? event.dataset_revisions_snapshot as Record<string, unknown> : {};
        const revisions = Object.fromEntries(Object.entries(revisionInput).slice(0, 24).map(([key, value]) => {
          const metadata = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
          return [boundedText(key, 80), metadata ? { revision: boundedText(metadata.revision, 120), state: boundedText(metadata.state, 40) } : boundedText(value, 120)];
        }));
        const owningSkill = boundedText(event.owning_skill, 100);
        if (!/^agdata-[a-z0-9-]+$/.test(owningSkill)) throw new Error("WATCHDOG_EVENT_OWNER_INVALID");
        const safeSuspectedFunctions = Array.isArray(event.suspected_functions) ? event.suspected_functions.slice(0, 8).map(value => boundedText(value, 160)) : [];
        const row = {
          fingerprint, app_version: appVersion, event_type: eventType, severity,
          username, normalized_role: watchdogRole(actor.role), view_id: boundedText(event.view_id, 100),
          sub_module: boundedText(event.sub_module, 120), duration_ms: Math.min(2_147_483_647, Math.max(0, Number(event.duration_ms) || 0)),
          error_message: boundedText(event.error_message, 1000), dataset_revisions_snapshot: revisions,
          cluster_id: cluster, owning_skill: owningSkill, suspected_functions: safeSuspectedFunctions,
          sample_payload: { fingerprint, app_version: appVersion, event_type: eventType, severity, username, normalized_role: watchdogRole(actor.role), view_id: boundedText(event.view_id, 100), sub_module: boundedText(event.sub_module, 120), duration_ms: Math.min(2_147_483_647, Math.max(0, Number(event.duration_ms) || 0)), error_message: boundedText(event.error_message, 1000), dataset_revisions_snapshot: revisions, cluster_id: cluster, owning_skill: owningSkill, suspected_functions: safeSuspectedFunctions, observed_at: new Date().toISOString() },
        };
        const { error } = await supabase.from("app_runtime_watchdog_events" as never).upsert(row as never, { onConflict: "fingerprint,app_version", ignoreDuplicates: false });
        if (error) throw error;
        if (severity === "critical" || severity === "high") {
          const now = new Date();
          const eligibleBefore = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
          const { data: claimed } = await supabase.from("app_runtime_watchdog_events" as never)
            .update({ alert_last_sent_at: now.toISOString() } as never)
            .eq("fingerprint", fingerprint).eq("app_version", appVersion)
            .or(`alert_last_sent_at.is.null,alert_last_sent_at.lt.${eligibleBefore}`).select("id");
          if (Array.isArray(claimed) && claimed.length) await dispatchRuntimeWatchdogAlert(row).catch(() => {});
        }
        return jsonResponse({ ok: true });
      }
      if (!privileged.has(username)) return errorResponse("This feature is not enabled for your active profile.", 403, { code: "WATCHDOG_FORBIDDEN" });
      if (action === "watchdog_list_events") {
        if (Object.keys(payload).some(key => !["action", "includeResolved", "offset"].includes(key))
            || payload.includeResolved !== undefined && typeof payload.includeResolved !== "boolean") throw new Error("WATCHDOG_PARAMETERS_INVALID");
        const offset = Number(payload.offset ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_000_000) throw new Error("WATCHDOG_PARAMETERS_INVALID");
        const currentVersion = APP_RUNTIME_RELEASE.match(/v(\d+)\.(\d+)\.(\d+)/i)?.slice(1).map(Number) || [];
        const { data: openVersions, error: openVersionsError } = await supabase.from("app_runtime_watchdog_events" as never)
          .select("id,app_version").eq("status", "open").limit(1000);
        if (openVersionsError) throw openVersionsError;
        const priorIds = ((openVersions || []) as Array<Record<string, unknown>>).filter((row) => {
          const version = String(row.app_version || "").match(/v(\d+)\.(\d+)\.(\d+)/i)?.slice(1).map(Number) || [];
          if (version.length !== 3 || currentVersion.length !== 3) return false;
          for (let versionIndex = 0; versionIndex < 3; versionIndex += 1) {
            if (version[versionIndex] === currentVersion[versionIndex]) continue;
            return version[versionIndex] < currentVersion[versionIndex];
          }
          return false;
        }).map((row) => Number(row.id)).filter(Number.isSafeInteger);
        if (priorIds.length) {
          const { error: resolveError } = await supabase.from("app_runtime_watchdog_events" as never)
            .update({ status: "resolved" } as never).in("id", priorIds as never[]);
          if (resolveError) throw resolveError;
        }
        let query = supabase.from("app_runtime_watchdog_events" as never).select("*", { count:"exact" });
        if (payload.includeResolved !== true) query = query.eq("status", "open");
        const { data, error, count } = await query.order("last_seen_at", { ascending:false }).order("id", { ascending:false }).range(offset, offset + 249);
        if (error) throw error;
        const rows = (data || []) as Record<string, unknown>[];
        return jsonResponse({ ok:true, data:rows, hasMore:offset + rows.length < Number(count || 0),
          fixBrief:buildRuntimeWatchdogFixBrief(rows.filter(row => row.status === "open"), APP_RUNTIME_RELEASE) });
      }
      if (action === "watchdog_resolve_events") {
        const ids = Array.isArray(payload.ids) ? payload.ids.filter(value => typeof value === "number" && Number.isSafeInteger(value)).slice(0, 250) : [];
        if (!ids.length) throw new Error("WATCHDOG_EVENT_IDS_REQUIRED");
        const { error } = await supabase.from("app_runtime_watchdog_events" as never).update({ status: "resolved" } as never).in("id", ids as never[]);
        if (error) throw error;
        return jsonResponse({ ok: true, resolved: ids.length });
      }
      return errorResponse("Unsupported watchdog action.", 400, { code: "WATCHDOG_ACTION_INVALID" });
    } catch (error) {
      const code = String((error as { message?: unknown })?.message || "WATCHDOG_FAILED");
      return errorResponse(code, /FORBIDDEN/.test(code) ? 403 : /AUTH/.test(code) ? 401 : 400, { code });
    }
  }

  const actionGate = canonicalActionGate(action, payload);
  if (actionGate && canonicalAccessForRequest) {
    try {
      if ("flag" in actionGate) requireCanonicalUserAccessFlag(canonicalAccessForRequest, actionGate.flag);
      else if (!hasAnyCanonicalUserAccessFlag(canonicalAccessForRequest, actionGate.any)) throw new Error("USER_ACCESS_SHARED_READ_FORBIDDEN");
    } catch (error) {
      const message = String((error as { message?: unknown })?.message || "USER_ACCESS_UNAVAILABLE");
      const denied = message.startsWith("USER_ACCESS_FORBIDDEN:") || message === "USER_ACCESS_SHARED_READ_FORBIDDEN";
      const status = denied ? 403 : /profile_not_active|USER_ACCESS_PROFILE_REQUIRED|AUTH_REQUIRED/.test(message) ? 401 : 503;
      const code = denied ? "USER_ACCESS_FORBIDDEN" : status === 401 ? "ACTIVE_PROFILE_REQUIRED" : "USER_ACCESS_UNAVAILABLE";
      if (["dataset_read", "inventory_read"].includes(action)) return retainedReadResponse(code);
      return errorResponse(denied ? "This feature is not enabled for your active profile." : "Access could not be verified. Retry when the service is available.", status, { code });
    }
  }

  if (action === "user_access") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
    try {
      const actor = await resolveActiveSessionProfile(session);
      const allowed = new Set(["action", "operation", "role", "display_name", "permissions", "username", "permission_overrides", "expected_revision", "command_id"]);
      if (Object.keys(payload).some(key => !allowed.has(key))) throw new Error("USER_ACCESS_PAYLOAD_INVALID");
      const operation = String(payload.operation || "").trim().toLowerCase();
      if (!["resolve", "directory", "save_role_baseline", "save_user_overrides", "deactivate_user", "update_user_profile"].includes(operation)) {
        throw new Error("USER_ACCESS_OPERATION_INVALID");
      }
      if (operation !== "resolve" && !FULL_ACCESS_USER_KEYS.has(String(actor.username || "").trim().toLowerCase())) {
        return errorResponse("Only the designated administrators can manage user access.", 403, { code: "USER_ACCESS_MANAGER_REQUIRED" });
      }
      const mutation = operation === "save_role_baseline" || operation === "save_user_overrides" || operation === "deactivate_user" || operation === "update_user_profile";
      const expectedRevision = payload.expected_revision;
      const commandId = String(payload.command_id || "").trim();
      if (mutation && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0)) {
        throw new Error("USER_ACCESS_REVISION_REQUIRED");
      }
      if (mutation && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
        throw new Error("USER_ACCESS_COMMAND_REQUIRED");
      }
      let commandPayload: Record<string, unknown> = {};
      if (operation === "save_role_baseline") {
        if (typeof payload.role !== "string" || !payload.permissions || typeof payload.permissions !== "object" || Array.isArray(payload.permissions)) {
          throw new Error("USER_ACCESS_ROLE_PAYLOAD_INVALID");
        }
        commandPayload = { role: payload.role, permissions: payload.permissions };
      } else if (operation === "save_user_overrides") {
        if (typeof payload.username !== "string" || !payload.username.trim()
          || !payload.permission_overrides || typeof payload.permission_overrides !== "object" || Array.isArray(payload.permission_overrides)) {
          throw new Error("USER_ACCESS_USER_PAYLOAD_INVALID");
        }
        commandPayload = { username: payload.username, permission_overrides: payload.permission_overrides };
      } else if (operation === "deactivate_user") {
        if (typeof payload.username !== "string" || !payload.username.trim()) throw new Error("USER_ACCESS_USERNAME_REQUIRED");
        const { data, error } = await supabase.rpc("deactivate_user_access_v2397", {
          p_actor_profile_id: actor.id,
          p_username: payload.username,
          p_command_id: commandId,
          p_expected_revision: expectedRevision as number,
        } as never);
        if (error) throw error;
        return jsonResponse(data);
      } else if (operation === "update_user_profile") {
        if (typeof payload.username !== "string" || !payload.username.trim()
          || typeof payload.display_name !== "string" || !payload.display_name.trim()
          || typeof payload.role !== "string" || !payload.role.trim()) throw new Error("USER_ACCESS_PROFILE_PAYLOAD_INVALID");
        const { data, error } = await supabase.rpc("update_user_access_profile_v2397", {
          p_actor_profile_id: actor.id,
          p_username: payload.username,
          p_display_name: payload.display_name,
          p_role: payload.role,
          p_command_id: commandId,
          p_expected_revision: expectedRevision as number,
        } as never);
        if (error) throw error;
        return jsonResponse(data);
      } else if (operation === "resolve" && Object.keys(payload).some(key => key !== "action" && key !== "operation")) {
        throw new Error("USER_ACCESS_SELF_ONLY");
      }
      const { data, error } = await supabase.rpc("user_access_command_v1", {
        p_actor_profile_id: actor.id,
        p_operation: operation,
        p_payload: commandPayload,
        ...(mutation ? { p_expected_revision: expectedRevision as number, p_command_id: commandId } : {})
      } as never);
      if (error) throw error;
      if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as Record<string, unknown>).ok === "boolean") {
        return jsonResponse(data);
      }
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const source = error as Record<string, unknown>;
      const code = String(source.message || "USER_ACCESS_FAILED");
      return errorResponse(code, source.code === "42501" ? 403 : /REVISION|CONFLICT|CHANGED/.test(code) ? 409 : /AUTH/.test(code) ? 401 : 400, { code });
    }
  }

  if (action === "delivery_wake") {
    if (Object.keys(payload).some(key => key !== "action" && key !== "source")) {
      return errorResponse("Invalid delivery wake request.", 400, { code: "DELIVERY_WAKE_REQUEST_INVALID" });
    }
    return dispatchAuthenticatedDeliveryWake(session, canonicalAccessForRequest, payload.source);
  }

  if (action === "apps_script_action") {
    if (Object.keys(payload).some(key => key !== "action" && key !== "payload")) {
      return errorResponse("Invalid Apps Script action request.", 400, { code: "APPS_SCRIPT_ACTION_REQUEST_INVALID" });
    }
    return await handleAppsScriptAction(session, payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
      ? payload.payload as Record<string, unknown> : {}, canonicalAccessForRequest);
  }

  if (action === "manager_table_management") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
    try {
      const actor = activeProfileForRequest || await resolveActiveSessionProfile(session);
      const data = await executeManagerTableManagement(
        supabase as unknown as Parameters<typeof executeManagerTableManagement>[0], String(actor.id), payload);
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const code = error instanceof Error ? error.message : "MANAGER_TABLE_UNAVAILABLE";
      const status = /READ_ONLY|FORBIDDEN|ACCESS_REQUIRED/.test(code) ? 403
        : /CONFLICT/.test(code) ? 409 : /INVALID|REQUIRED/.test(code) ? 400 : 503;
      return errorResponse(status === 503 ? "Table data is temporarily unavailable. Retry while keeping your current rows." : code, status,
        { code: /^MANAGER_TABLE_[A-Z_]+$/.test(code) ? code : "MANAGER_TABLE_UNAVAILABLE" });
    }
  }

  if (action === "erp_sync") {
    return await handleErpSyncAction(session, payload, activeProfileForRequest);
  }

  if (action === "fast_erp_ingest") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
    const actor = activeProfileForRequest || await resolveActiveSessionProfile(session);
    if (!FULL_ACCESS_USER_KEYS.has(normalizeUsername(String(actor.username || "")))) {
      return errorResponse("Only designated administrators can run live ERP ingestion.", 403, { code: "FAST_ERP_INGEST_FORBIDDEN" });
    }
    const allowedKeys = new Set(["action", "operation", "dataset", "fileMeta", "rows"]);
    if (Object.keys(payload).some(key => !allowedKeys.has(key))) {
      return errorResponse("Invalid live ERP ingestion request.", 400, { code: "FAST_ERP_INGEST_INVALID" });
    }
    const operation = String(payload.operation || "ingest").trim().toLowerCase();
    const dataset = String(payload.dataset || "").trim().toLowerCase();
    const fileMeta = payload.fileMeta && typeof payload.fileMeta === "object" && !Array.isArray(payload.fileMeta)
      ? payload.fileMeta as Record<string, unknown> : null;
    const rpcByDataset: Record<string, string> = {
      drive: "fast_ingest_drive_around_v1", drive_around: "fast_ingest_drive_around_v1",
      soc: "fast_ingest_soc_orders_v1", soc_orders: "fast_ingest_soc_orders_v1",
      reserves: "fast_ingest_soc_reserves_v1", soc_reserves: "fast_ingest_soc_reserves_v1",
      cav: "fast_ingest_cav_v1", warehouse_assigned: "fast_ingest_warehouse_assigned_v1",
      warehouse_assigned_items: "fast_ingest_warehouse_assigned_v1",
    };
    const readMeta = (...keys: string[]) => {
      for (const key of keys) {
        const value = String(fileMeta?.[key] || "").trim();
        if (value) return value;
      }
      return "";
    };
    const fileId = readMeta("file_id", "fileId");
    const fileName = readMeta("file_name", "fileName");
    if (!fileMeta || !rpcByDataset[dataset] || !["check", "ingest"].includes(operation)
      || !fileId || !fileName || fileId.length > 512 || fileName.length > 1024) {
      return errorResponse("Invalid live ERP ingestion request.", 400, { code: "FAST_ERP_INGEST_INVALID" });
    }
    try {
      const { data: check, error: checkError } = await supabase.rpc("check_erp_file_sync_needed_v1" as never, {
        p_dataset_key: dataset,
        p_file_id: fileId,
        p_file_name: fileName,
        p_modified_at: readMeta("modified_at", "modifiedAt"),
        p_content_hash: readMeta("content_hash", "contentHash") || null,
      } as never);
      if (checkError) throw checkError;
      if (operation === "check" || (check && typeof check === "object" && !Array.isArray(check)
          && (check as Record<string, unknown>).skip === true)) {
        return jsonResponse({ ok: true, data: check });
      }
      const rows = Array.isArray(payload.rows) ? payload.rows : null;
      if (!rows || rows.length < 1 || rows.length > 50_000 || JSON.stringify(rows).length > 64 * 1024 * 1024) {
        return errorResponse("Invalid live ERP row batch.", 400, { code: "FAST_ERP_ROWS_INVALID" });
      }
      const { data, error } = await supabase.rpc(rpcByDataset[dataset] as never, {
        p_file_meta: fileMeta,
        p_rows: rows,
      } as never);
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const source = error as Record<string, unknown>;
      const code = String(source.message || "FAST_ERP_INGEST_FAILED");
      return errorResponse("Live ERP ingestion failed.", source.code === "42501" ? 403 : 422, { code });
    }
  }

  if (action === "manager_season_settings") return await handleManagerSeasonSettings(req, session, payload);
  if (action === "request_recipient_directory") return await handleRequestRecipientDirectory(session, payload);
  if (action === "customer-rep-map") return await handleCustomerRepMappingAction(session, payload);
  if (action === "av_note_options") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
    if (Object.keys(payload).some(key => !["action", "itemcode", "commonname"].includes(key))) {
      return errorResponse("Invalid AV Note options request.", 400, { code: "AV_NOTE_OPTIONS_REQUEST_INVALID" });
    }
    const itemcode = String(payload.itemcode || "").trim();
    const commonname = String(payload.commonname || "").trim();
    if ((!itemcode && !commonname) || itemcode.length > 80 || commonname.length > 240) {
      return errorResponse("Invalid AV Note options request.", 400, { code: "AV_NOTE_OPTIONS_REQUEST_INVALID" });
    }
    try {
      await resolveActiveSessionProfile(session);
      const { data, error } = await supabase.rpc("get_itemcode_av_note_options_v1" as never, {
        p_itemcode: itemcode, p_commonname: commonname || null,
      } as never);
      if (error) throw error;
      const options = (Array.isArray(data) ? data : []).map((row: unknown) => {
        if (typeof row === "string") return row;
        if (row && typeof row === "object") return String((row as Record<string, unknown>).note || "");
        return "";
      }).map(value => value.trim()).filter(Boolean).slice(0, 120);
      return jsonResponse({ ok: true, options });
    } catch (error) {
      return databaseFailureResponse("AV Note options are temporarily unavailable.", error, "AV_NOTE_OPTIONS_FAILED");
    }
  }
  if (["projects_read", "project_save", "project_add_rows", "project_update_row", "project_delete"].includes(action)) {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401);
    try { return jsonResponse({ ok:true, data:await handleInventoryProjects(await resolveActiveSessionProfile(session), payload) }); }
    catch (error) { return databaseFailureResponse("Projects are temporarily unavailable.", error, "PROJECTS_REQUEST_FAILED"); }
  }

  if (action === "inventory_reclass_move") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
    const actor = await resolveActiveSessionProfile(session).catch(() => null);
    if (!actor) return errorResponse("An active, unlocked app profile is required.", 403, { code: "INVENTORY_RECLASS_PROFILE_INACTIVE" });
    try {
      const data = await handleInventoryReclassMove({ supabase, actorProfile: actor, payload });
      if (jsonObject(data).deliveryEventId) dispatchReclassDeliveryNow(jsonObject(data), "", "");
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const failure = inventoryReclassMoveError(error);
      return jsonResponse(failure.body, failure.status);
    }
  }

  if (action === "historical_requests_read") {
    return await handleHistoricalRequestsReadAction(req, session, payload, activeProfileForRequest);
  }
  if (action === "request_sales_impact") {
    return await handleRequestSalesImpactAction(session, activeProfileForRequest);
  }
  if (action === "request_history" || action === "sales_credit") {
    return await handleSalesWorkflow({ session, payload, supabase, resolveActiveSessionProfile, headers: corsHeaders });
  }
  if (["navigation_preferences", "production_workflow", "inventory_transaction_history"].includes(action)) {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401);
    try {
      const actor = await resolveActiveSessionProfile(session);
      if (action === "navigation_preferences") return jsonResponse({ ok: true, data: await handleNavigationPreferences(supabase, actor, payload) });
      const moduleAllowed = await resolveModuleAllowed(supabase, actor, action === "production_workflow" ? "production-workflow" : "inventory-transaction-history");
      const context = { supabase, actorProfile: actor, moduleAllowed, payload };
      const data = action === "production_workflow" ? await handleProductionWorkflow(context) : await handleInventoryTransactionHistory(context);
      return jsonResponse(data);
    } catch (error) {
      const failure = workflowError(error);
      return jsonResponse(failure.body, failure.status);
    }
  }
  if (action === "suspend_tag") {
    if (!session?.authUserId || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "SUSPEND_TAG_SESSION_REQUIRED" });
    try {
      const actor = await resolveActiveSessionProfile(session);
      actor.nativeSessionId = await verifySuspendTagSession(supabase, actor, req);
      const data = jsonObject(await handleSuspendTag(supabase, actor, payload));
      if (payload.operation === "add_candidates" && Array.isArray(data.rows)) {
        // The service-role RPC has already committed atomically. Enrichment must
        // never turn a committed candidate receipt into a failed mutation.
        try { data.rows = jsonValue(await enrichSuspendTagMetricRows(suspendTagRowsFromResult(data), String(actor.id))); }
        catch { /* Canonical source quantities remain on the durable receipt. */ }
      }
      const notification = jsonObject(jsonObject(data).notification);
      if (notification.approvalId && notification.repUsername) {
        // Database-owned recipient; the durable worker retries the same push receipt.
        const push = fetch(SUPABASE_URL + "/functions/v1/send-push-alert", {
          method: "POST", headers: { "Content-Type": "application/json",
            Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY, apikey: SUPABASE_SERVICE_ROLE_KEY },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ eventType: "suspend_tag_approval_requested", ...notification }),
        }).then(response => { if (!response.ok) console.warn("SUSPEND_TAG_PUSH_PENDING", response.status); })
          .catch(() => console.warn("SUSPEND_TAG_PUSH_PENDING"));
        const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (task: Promise<void>) => void } }).EdgeRuntime;
        if (runtime) runtime.waitUntil(push); else await push;
      }
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const failure = suspendTagError(error);
      if (payload.operation === "rows") {
        const input = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
          ? payload.payload as Record<string, unknown> : {};
        const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).slice(0, 1000) : [];
        if (!ids.length) return jsonResponse({ ok: true, data: { rows: [], retained: true, retryable: true } });
        try {
          const direct = await supabase.from("ph_soc_master").select(DATASET_READ_COLUMN_PROJECTIONS.suspend_tag).in("unique_id", ids);
          if (!direct.error && Array.isArray(direct.data)) return jsonResponse({ ok: true, data: { rows: direct.data, direct: true } });
        } catch { /* The displayed client snapshot remains authoritative until retry. */ }
        return jsonResponse({ ok: true, data: { rows: [], retained: true, retryable: true } });
      }
      if (failure.status >= 500) return transientOkResponse(String(failure.body.code || "SUSPEND_TAG_UNAVAILABLE"), "Suspend Tag is temporarily unavailable.");
      return jsonResponse(failure.body, failure.status);
    }
  }
  if (action === "get_user_preferences" || action === "live_pilot_bootstrap") {
    return await handleGetUserPreferences(session);
  }
  if (action === "set_user_preferences" || action === "live_pilot_preferences_save") {
    return await handleSetUserPreferences(session, payload);
  }
  if (action === "eval_work") {
    const response = await handleEvalWorkAction(session, payload, canonicalAccessForRequest);
    if (response.ok && ["create", "create_batch", "submit", "reassign"].includes(String(payload.operation || "").trim().toLowerCase())) {
      dispatchRequestDeliveryWorkerNow(`eval_work_${String(payload.operation || "mutation").trim().toLowerCase()}`);
    }
    return response;
  }
  if (action === "report_read_v2") return await handleManagerReportReadAction(session, payload, canonicalAccessForRequest, activeProfileForRequest);
  if (action === "photo_history") return await handlePhotoHistoryAction(session, payload);
  if (action === "drive_reclass_inquiry") return await handleDriveReclassAction(session, payload);
  if (action === "reclass_recount") return await handleReclassRecountAction(session, payload);
  if (action === "dataset_revisions") return await handleDatasetRevisionsAction(session, payload);
  if (action === "season_sales_office") return await handleSeasonSalesOfficeAction(session, payload);
  if (action === "shear_location_work") {
    const response = await handleShearLocationAction(session, payload);
    if (response.ok && ["create", "complete", "retry"].includes(String(payload.operation || "").trim().toLowerCase())) {
      dispatchRequestDeliveryWorkerNow(`shear_location_${String(payload.operation || "mutation").trim().toLowerCase()}`);
    }
    return response;
  }
  if (action === "bunch_note_workflow") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401, { code: "AUTH_REQUIRED" });
    try {
      const actor = await resolveActiveSessionProfile(session);
      const allowed = new Set(["action", "operation", "payload", "commandId", "expectedRevision"]);
      if (Object.keys(payload).some(key => !allowed.has(key))) throw new Error("BUNCH_NOTE_WORKFLOW_PAYLOAD_INVALID");
      const operation = String(payload.operation || "");
      if (!["queue", "list_discrepancies", "complete_card", "assign_counter", "complete_recount"].includes(operation)) {
        throw new Error("BUNCH_NOTE_WORKFLOW_OPERATION_INVALID");
      }
      const commandId = typeof payload.commandId === "string" ? payload.commandId.trim() : "";
      if (["complete_card", "assign_counter", "complete_recount"].includes(operation)
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
        throw new Error("BUNCH_NOTE_COMMAND_REQUIRED");
      }
      const rpc = supabase.rpc.bind(supabase) as unknown as BunchNoteRpc;
      const { data, error } = await rpc("bunch_note_workflow_command_v1", {
        p_actor_id: actor.id,
        p_operation: operation,
        p_payload: jsonValue(payload.payload || {}),
        ...(commandId ? { p_command_id: commandId } : {}),
        ...(typeof payload.expectedRevision === "number" ? { p_expected_revision: payload.expectedRevision } : {}),
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const source = error as Record<string, unknown>;
      const code = String(source.message || "BUNCH_NOTE_WORKFLOW_FAILED");
      if (source.code !== "42501" && payload.operation === "queue") return jsonResponse({ ok: true, data: { cards: [], total: 0, active_count: 0, review_count: 0, can_review: false, counters: [], assignee_options: [], unassigned_count: 0, retained: true, state: "ready" } });
      if (source.code !== "42501" && payload.operation === "list_discrepancies") return jsonResponse({ ok: true, data: { reviews: [], total: 0, review_count: 0, can_review: false, counters: [], retained: true, state: "ready" } });
      return errorResponse(code, source.code === "42501" ? 403 : /CONFLICT|CHANGED|COMPLETE/.test(code) ? 409 : 400, { code });
    }
  }
  if (action === "bunch_note") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401);
    try {
      const actor = await resolveActiveSessionProfile(session);
      if (typeof actor.id !== "string") throw new Error("BUNCH_NOTE_ACTOR_INVALID");
      const allowed = new Set(["action", "operation", "payload", "commandId", "expectedRevision"]);
      if (Object.keys(payload).some(key => !allowed.has(key))) throw new Error("BUNCH_NOTE_PAYLOAD_INVALID");
      const operation = String(payload.operation || "");
      if (operation === "pdf_preview") {
        const previewPayload = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
          ? payload.payload as Record<string, unknown> : {};
        if (Object.keys(previewPayload).some(key => key !== "preview_id")
          || typeof previewPayload.preview_id !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previewPayload.preview_id)) {
          throw new Error("BUNCH_NOTE_PREVIEW_ID_REQUIRED");
        }
        const rpc = supabase.rpc.bind(supabase) as unknown as BunchNoteRpc;
        const rendered = await renderBunchNotePreview({
          rpc,
          actor: { id: actor.id, username: typeof actor.username === "string" ? actor.username : undefined, display_name: typeof actor.display_name === "string" ? actor.display_name : null },
          previewId: previewPayload.preview_id,
        });
        return jsonResponse({ ok: true, data: { pdfs: rendered.pdfs } });
      }
      if (operation === "dropdown_options_read") {
        const { data, error } = await supabase.from("ph_app_settings").select("value")
          .eq("key", "inv_bunch_notes_custom_dropdowns_v1").limit(1).maybeSingle();
        if (error) throw error;
        const value = data?.value && typeof data.value === "object" && !Array.isArray(data.value)
          ? data.value as Record<string, unknown> : {};
        return jsonResponse({ ok: true, data: { options: value } });
      }
      if (operation === "dropdown_options_save") {
        if (String(actor.username || "").trim().toLowerCase() !== "dylan_collyge") throw Object.assign(new Error("BUNCH_NOTE_DROPDOWN_OPTIONS_FORBIDDEN"), { code: "42501" });
        const source = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
          ? payload.payload as Record<string, unknown> : {};
        if (Object.keys(source).some(key => key !== "options")) throw new Error("BUNCH_NOTE_DROPDOWN_OPTIONS_INVALID");
        const optionSource = source.options && typeof source.options === "object" && !Array.isArray(source.options)
          ? source.options as Record<string, unknown> : {};
        const allowedOptionKeys = new Set(["destination_house", "action", "workflow_instructions", "card_notes", "purpose", "direction", "house_plan", "schedule_alert"]);
        if (Object.keys(optionSource).some(key => !allowedOptionKeys.has(key))) throw new Error("BUNCH_NOTE_DROPDOWN_OPTIONS_INVALID");
        const fields: Record<string, string[]> = {};
        for (const key of allowedOptionKeys) {
          const values = Array.isArray(optionSource[key]) ? optionSource[key] as unknown[] : [];
          const seen = new Set<string>();
          fields[key] = values.map(value => cleanBunchNoteText(value, 500)).filter(value => {
            const normalized = value.toLocaleLowerCase();
            if (!value || seen.has(normalized)) return false;
            seen.add(normalized); return true;
          }).slice(0, 100);
        }
        const value = { version: 1, fields };
        const { error } = await supabase.from("ph_app_settings").upsert({
          key: "inv_bunch_notes_custom_dropdowns_v1", value: jsonValue(value), updated_by: actor.id,
        }, { onConflict: "key" });
        if (error) throw error;
        return jsonResponse({ ok: true, data: { options: value } });
      }
      const { data: dylanRecipient, error: dylanRecipientError } = await supabase.from("profiles")
        .select("id").eq("username", "dylan_collyge").is("disabled_at", null).limit(1).maybeSingle();
      if (dylanRecipientError || !dylanRecipient?.id) throw new Error("BUNCH_NOTE_DYLAN_RECIPIENT_REQUIRED");
      const normalizedPayload = operation === "save" ? normalizeBunchNoteSavePayload(payload.payload) : payload.payload || {};
      const rpcPayload = forceBunchNoteDylanRecipient(normalizedPayload, String(dylanRecipient.id), operation);
      const { data, error } = await supabase.rpc("bunch_note_command_v1", {
        p_actor_id: actor.id, p_operation: operation,
        p_payload: jsonValue(rpcPayload), ...(typeof payload.commandId === "string" && payload.commandId ? { p_command_id: payload.commandId } : {}),
        ...(typeof payload.expectedRevision === "number" ? { p_expected_revision: payload.expectedRevision } : {}),
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const source = error as Record<string, unknown>;
      const code = String(source.message || "BUNCH_NOTE_FAILED");
      if (source.code !== "42501" && payload.operation === "list") return jsonResponse({ ok: true, data: { jobs: [], retained: true, state: "ready" } });
      return errorResponse(code, source.code === "42501" ? 403 : /CONFLICT|CHANGED|CLAIMED/.test(code) ? 409 : 400, { code });
    }
  }
  if (action === "field_count") {
    return await handleFieldCountAction(session, payload);
  }
  if (action === "inventory_consolidation") return await handleInventoryConsolidationAction(req, session, payload);
  if (action === "location_work") {
    const response = await handleLocationWorkAction(session, payload);
    if (response.ok && ["create", "resolve_line", "retry"].includes(String(payload.operation || "").trim().toLowerCase())) {
      dispatchRequestDeliveryWorkerNow(`location_work_${String(payload.operation || "mutation").trim().toLowerCase()}`);
    }
    return response;
  }
  if (action === "dock_trip_status") return await handleDockTripStatusAction(session, payload);
  if (action === "aura_inventory_v2") return await handleAuraInventoryV2(session, payload, {
    signal: req.signal,
    requestId: req.headers.get("x-request-id") || undefined,
  });
  if (action === "aura_inventory_search") return await handleAuraInventorySearch(session, payload);
  if (action === "aura_scout_log") return await handleAuraScoutLog(session, payload);
  if (["aura_chat_send", "alpha_chat_list", "alpha_chat_page", "alpha_chat_mark_read", "alpha_timeoff_list", "alpha_timeoff_request", "alpha_timeoff_approve"].includes(action)) {
    try {
      if (action === "aura_chat_send") return await auraChatSend(session, payload);
      if (action === "alpha_chat_list") return await alphaChatList(session, payload);
      if (action === "alpha_chat_page") return await alphaChatPage(session, payload);
      if (action === "alpha_chat_mark_read") return await alphaChatMarkRead(session, payload);
      if (action === "alpha_timeoff_list") return await alphaTimeoffList(session, payload);
      if (action === "alpha_timeoff_request") return await alphaTimeoffRequest(session, payload);
      return await alphaTimeoffApprove(session, payload);
    } catch (error) {
      const failure = error as { message?: string; status?: number; code?: string };
      const status = Number(failure.status) || (failure.code === "42501" ? 403 : 503);
      if (status >= 500) recordHandledError("app-api", action, error, status);
      return errorResponse(status === 403 ? "This feature is available only to Dylan’s verified active account." : "The request could not be completed.", status, {
        code: String(failure.code || `${action.toUpperCase()}_FAILED`),
      });
    }
  }
  if (action === "dataset_read") return await handleDatasetRead(session, payload, req, canonicalAccessForRequest, activeProfileForRequest);
  if (action === "request_work") {
    const actor = activeProfileForRequest || await resolveActiveSessionProfile(session);
    const operation = String(payload.operation || "");
    const allowedKeys = operation === "capabilities" ? ["action", "operation"] : ["action", "operation", "requestId", "expectedVersion", "patch", "complete"];
    if (!["capabilities", "save"].includes(operation) || Object.keys(payload).some(key => !allowedKeys.includes(key))
      || (operation === "save" && (typeof payload.requestId !== "string" || !payload.requestId.trim() || payload.requestId.length > 200
        || !Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1 || typeof payload.complete !== "boolean"
        || !payload.patch || typeof payload.patch !== "object" || Array.isArray(payload.patch) || JSON.stringify(payload.patch).length > 60000))) return errorResponse("Invalid Request work command.",400,{code:"REQUEST_WORK_INVALID"});
    let sessionId: string;
    try { sessionId = await verifySuspendTagSession(supabase, actor, req); }
    catch { return errorResponse("A verified session is required.",403,{code:"REQUEST_WORK_SESSION_REQUIRED"}); }
    const requestWorkArgs = {p_actor_id:String(actor.id),p_session_id:sessionId,p_operation:operation,
      ...(operation === "save" ? {p_request_id:String(payload.requestId),p_expected_version:Number(payload.expectedVersion),p_patch:jsonValue(payload.patch),p_complete:payload.complete === true} : {})};
    let {data,error} = await supabase.rpc("request_work_command_v1", requestWorkArgs);
    if (error && operation === "save" && payload.complete === true && /REQUEST_NOT_FOUND/.test(error.message)) {
      const replay = await supabase.rpc("request_completion_receipt_v2372", {
        p_actor_id:String(actor.id), p_session_id:sessionId, p_request_id:String(payload.requestId),
      });
      if (!replay.error && replay.data) { data = replay.data; error = null; }
    }
    if (error) return errorResponse(error.message, error.code === "42501" ? 403 : error.code === "PT409" ? 409 : 422,{code:error.message.match(/REQUEST_[A-Z_]+/)?.[0] || "REQUEST_WORK_FAILED"});
    if (operation === "save") {
      const receipt = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      const expectedLifecycle = payload.complete === true ? "completed_history" : "pending_active";
      if (String(receipt.lifecycle_state || "") !== expectedLifecycle) {
        recordHandledError("app-api", action, new Error("REQUEST_LIFECYCLE_UNCONFIRMED"), 503);
        return errorResponse("The Request lifecycle acknowledgment could not be verified.",503,{code:"REQUEST_LIFECYCLE_UNCONFIRMED"});
      }
    }
    return jsonResponse({ok:true,data});
  }
  if (action === "manual_sync_status") {
    if (Object.keys(payload).some(key => key !== "action")) return errorResponse("Invalid status read.",400);
    const response = await databaseBridge.fetchTable(SUPABASE_URL,"app_manual_sync_status","select=status,updated_at&id=eq.true&limit=1",{method:"GET",headers:buildRestHeaders("GET","app_manual_sync_status")},10000,"app-api.manual-sync-status");
    const data = await readResponsePayload(response);
    if (!response.ok) return databaseFailureResponse("Sync status is unavailable.",data,"MANUAL_SYNC_STATUS_UNAVAILABLE");
    const rows = Array.isArray(data) ? data : [];
    const status = jsonObject(rows[0]?.status);
    const active = status.active === true;
    return jsonResponse({ok:true,data:active ? status : {
      ...status, active:false, source:"startup", currentStage:"idle", currentStageLabel:"Idle",
      stageIndex:0, stageOrder:[], completedStages:[], message:"Connected • ready", error:"",
    }});
  }
  if (action === "request_queue_remove") return await handleRequestQueueRemove(session, payload);
  if (action === "request_archive") return await handleRequestArchive(session, payload);
  if (action === "production_schedule") return await handleProductionScheduleAction(session, payload);
  if (action === "append_productivity_history") return await handleAppendProductivityHistory(session, payload);
  if (action === "av_read") {
    if (!session) return errorResponse("Unauthorized", 401);
    if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
    let actor: Record<string, unknown>;
    try { actor = await resolveActiveSessionProfile(session); }
    catch { return errorResponse("An active account profile is required.", 403, { code: "ACTIVE_PROFILE_REQUIRED" }); }
    try {
      const username = normalizeUsername(String(actor.username || ""));
      const role = String(session.role || "");
      const access = getRoleAccessState(role);
      const data = await readAvPage({ supabase, actor, payload,
        // Existing active master-inventory readers may read the single
        // current-season dependency. readAvPage pins settings to that key.
        canRead: table => hasTableReadAccess(role, table, username)
          || (canonicalAccessForRequest?.permissions.can_access_av === true
            && new Set(["ph_cav_import", "ph_reserves", "ph_av_notes", "ph_view_av_hot_price_keys", "ph_app_settings"]).has(table))
          || (table === "ph_app_settings" && hasTableReadAccess(role, "ph_master_inventory", username)),
        restrictRep: access.isRep && !access.isAdmin && !FULL_ACCESS_USER_KEYS.has(username),
      });
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const failure = error as { message?: string; status?: number; code?: string; stage?: string };
      const status = Number(failure.status) || 503;
      const sqlState = /^[0-9A-Z]{5}$/.test(String(failure.code || "")) ? String(failure.code) : null;
      const dataset = ["reserves", "notes", "hot_prices", "settings"].includes(String(payload.dataset))
        ? String(payload.dataset) : "unknown";
      if (status === 403 || status >= 500) {
        recordHandledError("app-api", "av_read", error, status, {
          requestId: req.headers.get("x-request-id") || undefined,
          sqlState,
          dataset,
          denialStage: failure.stage || (status === 403 ? "authorization" : "upstream"),
        });
      }
      return errorResponse(failure.message || "AV_READ_UNAVAILABLE", failure.status || 503, {
        code: failure.code || failure.message || "AV_READ_UNAVAILABLE",
      });
    }
  }
  if (action === "inventory_read") return await failOpenInventoryConflict(await handleInventoryRead(session, payload, canonicalAccessForRequest));
  if (action === "db") {
    if (session && session.ver >= 2) {
      return errorResponse("Native Auth sessions must use PostgREST with RLS for database access.", 410, {
        code: "DIRECT_RLS_REQUIRED"
      });
    }
    return await handleDb(session, payload);
  }

  return errorResponse("Unsupported action.", 400);
}, { serverTiming: true }));
