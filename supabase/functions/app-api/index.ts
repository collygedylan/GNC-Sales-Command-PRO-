import { handleSalesWorkflow } from "../_shared/sales-workflow.ts";
import { handleSuspendTag, verifySuspendTagSession, SUSPEND_TAG_EDITORS, suspendTagError } from "../_shared/suspend-tag.ts";
import { readAvPage } from "../_shared/av-read.ts";
import { handleNavigationPreferences, resolveModuleAllowed } from "../_shared/navigation-preferences.ts";
import { handleProductionWorkflow, handleInventoryTransactionHistory, workflowError } from "../_shared/production-workflow.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { createAppSession, getRoleAccessState, isAppAccountActive, isForcedPasswordValue, normalizeUsername, readAppSessionFromRequest, readSupabaseOrAppSessionFromRequest } from "../_shared/app-auth.ts";
import { recordHandledError, withObservedRequest } from "../_shared/observability.ts";
import { auraInventoryV2ProfileMatches } from "../_shared/aura-auth.ts";
import { auraInventoryV2Rpc } from "../_shared/aura-inventory.ts";
import { historyPhotoUrl, publicHistoryPhoto, readArchivedHistoryThumbnail, isPhotoHistoryUsernameAllowed } from "../_shared/photo-history.ts";
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
  "Cache-Control": "private, no-store",
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
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
};
const AV_OPTION_EVAL_REQUESTS_TABLE = "ph_av_option_eval_requests";
const AV_OPTION_EVAL_MANAGER_USERS = new Set(["dylan_collyge", "jd_jones", "megan_kelly"]);
const FULL_ACCESS_USER_KEYS = new Set(["dylan_collyge", "jd_jones", "megan_kelly"]);
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
  "ph_active_request_live_rows",
  "ph_request_queue_live_rows",
  "ph_request_delivery_status",
  "ph_crop_roll_drive_rows",
  "ph_crop_roll_open_rows",
  "ph_crop_roll_runs",
  "ph_crop_roll_rows",
  "ph_active_request",
  "ph_customer_consignee_sales_reps",
  "ph_request_history",
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
  "ph_hl_po",
  "ph_view_po_27f1_hl",
  AV_OPTION_EVAL_REQUESTS_TABLE,
]);
const WRITABLE_TABLES = new Set([
  "ph_master_inventory",
  "ph_soc_master",
  "ph_av_notes",
  "ph_reserves",
  "ph_active_request_live_rows",
  "ph_crop_roll_drive_rows",
  "ph_crop_roll_runs",
  "ph_crop_roll_rows",
  "ph_active_request",
  "ph_request_history",
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
  "ph_active_request",
  "ph_active_request_live_rows",
  "ph_request_queue_live_rows",
  "ph_request_delivery_status",
  "ph_customer_consignee_sales_reps",
  "ph_request_history",
  "ph_sales_credit_requests",
  "ph_request_email_threads",
  "ph_reserves",
  "ph_soc_master",
  "ph_sales_office",
  "ph_cav_import",
  "ph_av_notes",
  "ph_warehouse_assigned_items",
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
  "ph_dock_team_status",
  "ph_dock_item_status",
]);
const REP_WRITE_TABLES = new Set([
  ...COMMON_AUTH_WRITE_TABLES,
  "ph_active_request",
  "ph_request_history",
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

function errorResponse(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, ...extra }, status);
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
  const status = code === "42501" ? 403 : code === "40001" || code === "23505" ? 409 : explicitStatus || 503;
  return errorResponse(message, status, { code });
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
    headers.Prefer = table === "ph_active_request" ? "return=minimal" : "return=minimal,resolution=merge-duplicates";
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

async function restRequest(table: string, method = "GET", query = "", body: unknown = null) {
  const normalizedTable = normalizeTableName(table);
  const querySuffix = String(query || "").trim();
  const request = async (tableName: string) => {
    const url = `${SUPABASE_URL}/rest/v1/${tableName}${querySuffix ? `?${querySuffix}` : ""}`;
    const options: RequestInit = {
      method,
      headers: buildRestHeaders(method, tableName),
    };
    if (body !== null && body !== undefined && method !== "GET") {
      options.body = JSON.stringify(body);
    }
    return await fetch(url, options);
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
  const result = await supabase.storage.from(bucketName).upload(path, part.bytes, {
    contentType: part.mimeType,
    cacheControl: "31536000",
    upsert: false,
  });
  const duplicate = !!(result.error && /already exists|duplicate/i.test(String(result.error.message || "")));
  if (result.error && !duplicate) throw new Error("PHOTO_STORAGE_UNAVAILABLE");
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
  if (table === "ph_app_users") return access.isQc || access.isQcSupervisor || access.isAdmin || access.isSalesAssistant;
  if (access.isSalesMarketing) return SALES_MARKETING_READ_TABLES.has(table);
  if (access.isRepLike) {
    return REP_READ_TABLES.has(table);
  }
  if (access.isQcSupervisor) {
    return new Set(["ph_master_inventory", "ph_soc_master", "ph_dock_team_status", "ph_dock_item_status"]).has(table);
  }
  if (access.isQc) {
    return new Set(["ph_soc_master", "ph_dock_team_status", "ph_dock_item_status"]).has(table);
  }
  return false;
}

// This read boundary deliberately accepts dataset and typed filter names rather
// than PostgREST query strings. The table, projection, stable key, and filter
// fields are all selected by this server-owned map.
const DATASET_READ_COLUMN_PROJECTIONS: Record<string, string> = {
  ph_inventory_edit_requests: "id,status,workflow_stage,stage,previous_stage,stage_before_terminal,request_type,priority_flag,inventory_edit_done,inventory_edit_completed_by,inventory_edit_completed_by_display,inventory_edit_completed_at,photo_data_done,photo_data_completed_by,photo_data_completed_by_display,photo_data_completed_at,source_unique_id,master_unique_id,source_view,commonname,contsize,itemcode,locationcode,lotcode,source,ptravailable,s_lts,assignedto,current_priority,current_locationnote,current_pulltagnotes,current_holdstopcode,current_holdreason,requested,changes,snapshot,holdreason,reason,supervisor_note,approved_qty,jd_approved_qty,approved_by,approved_by_display,approved_at,sent_by,sent_by_display,sent_at,edited_by,edited_by_display,edited_at,stage_updated_by,stage_updated_by_display,stage_updated_at,handled_by,handled_by_display,handled_at,handler_note,notification_stage,notification_sent_at,inventory_edit_live,created_at,updated_at",
  ph_shear_list: "unique_id,source_table,source_unique_id,status,percent_to_shear,itemcode,commonname,contsize,locationcode,lotcode,season,blockalpha,ptravailable,holdstopcode,holdstopreason,snapshot,created_by_username,created_by_display,created_at,updated_by_username,updated_by_display,updated_at,completed_by_username,completed_by_display,completed_at,instructions",
  ph_request_queue_live_rows: "id,unique_id,master_id,commonname,contsize,locationcode,lotcode,itemcode,ptravailable,season_supply,priority,qualitycode,field_tag_color,plantgroupcode,requested_by,request_folder,req_customer,req_qty,desired_spec,desired_caliper,est_ship,req_reserve,req_photo_link,req_photo_name,req_archived,req_status,req_rep_action,created_at,req_match,req_spec,req_caliper,req_pic_note,req_sales_note,req_comments,av_note,date_completed,completed_by_username,completed_by_display,completed_by_email,req_photo_mode,move_batch_id,move_approval_stage,move_status,move_group_key,move_from_locationcode,move_to_locationcode,move_planned_qty,move_actual_qty,move_destination_needs_row,move_dylan_approved_at,move_jd_approved_at,move_completed_at,move_completed_by,request_note,request_created_by_username,request_created_by_display,request_created_by_email,request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,app_tab_assignment,master_app_tab_assignment,request_source,client_batch_id,updated_at,row_version,drive_row_missing,drive_last_updated,drive_assignedto,drive_match,drive_loc_match_qty,drive_spec,drive_caliper,drive_pic_note,drive_av_note,drive_photo_link,drive_photo_name,av_rule_bundle_updated_at,av_rule_av_note_updated_at,av_rule_spec_updated_at,av_rule_match_updated_at,av_rule_caliper_updated_at,av_rule_photo_updated_at,av_rule_priority_snapshot,av_rule_holdstop_snapshot,av_rule_last_clear_reason,av_rule_last_cleared_at,delivery_event_id,delivery_status,delivery_attempt_count,delivery_next_attempt_at,delivery_first_attempt_at,delivery_last_attempt_at,delivery_lease_expires_at,delivery_error_code,delivery_email_delivered_at,delivery_push_delivered_at,delivery_delivered_at,delivery_mode,delivery_age_seconds,delivery_display_state",
  ph_active_request_live_rows: "id,unique_id,master_id,commonname,contsize,locationcode,lotcode,itemcode,ptravailable,season_supply,priority,qualitycode,field_tag_color,plantgroupcode,requested_by,request_folder,req_customer,req_qty,desired_spec,desired_caliper,est_ship,req_reserve,req_photo_link,req_photo_name,req_archived,req_status,req_rep_action,created_at,req_match,req_spec,req_caliper,req_pic_note,req_sales_note,req_comments,av_note,date_completed,completed_by_username,completed_by_display,completed_by_email,req_photo_mode,move_batch_id,move_approval_stage,move_status,move_group_key,move_from_locationcode,move_to_locationcode,move_planned_qty,move_actual_qty,move_destination_needs_row,move_dylan_approved_at,move_jd_approved_at,move_completed_at,move_completed_by,request_note,request_created_by_username,request_created_by_display,request_created_by_email,request_selected_rep_username,request_selected_rep_display,request_selected_rep_email,app_tab_assignment,master_app_tab_assignment,request_source,client_batch_id,updated_at,row_version,drive_row_missing,drive_last_updated,drive_assignedto,drive_match,drive_loc_match_qty,drive_spec,drive_caliper,drive_pic_note,drive_av_note,drive_photo_link,drive_photo_name,av_rule_bundle_updated_at,av_rule_av_note_updated_at,av_rule_spec_updated_at,av_rule_match_updated_at,av_rule_caliper_updated_at,av_rule_photo_updated_at,av_rule_priority_snapshot,av_rule_holdstop_snapshot,av_rule_last_clear_reason,av_rule_last_cleared_at,customeridentityid,customername,consigneeidentityid,consigneename",
  ph_soc_master: "unique_id,concat,last_updated,assignedto,date_completed,dock_photo_link,dock_photo_name,dock_spec,dock_caliper,dock_note,contsize,warehouseid,warehousename,isreserve,salesrepid,salesrepname,nationalaccount,idgroup,customeridentityid,customername,consigneeidentityid,consigneename,consigneecity,consigneestate,consigneezip,tripnumber,stopnumber,zonecode,tagcode,transactionnumber,purchaseordernumber,extunitprice,ordertotal,requestdate,stagename,step,customersku,formattedupc,printedcontainercode,lotcode,locationcode,descriptorcode,itemcode,plantgroupcode,sortnamevariety,containersort,qualitycode,commonname,quantityordered,quantityshipped,listprice,unitprice,handlingchargeperitem,taggingchargeperitem,combinedprice,freightrateperitem,landed,retailprice,holdstopcode,holdstopreason,salesnote,fnsalesnote,picknote,planstart,generalloadinstr,invoicedate,consigneeaddress_1,consigneeaddress_2,altshipcomment,shiptotelephone_1,okloadinstructions,txloadinstructions,ncloadinstructions,hlloadinstructions,dock,equiv_unit,equiv_uom,wingdingunits,dropweight,internalinvnote,hardinesszone,brand,tagdeptnote,ext_unit_merch_shipped,ext_eunit_shipped,avg_price_eunit_shipped,requestdateweek,carrier,suspend,suspend_to,qa_code,grower,priority,ptronhand,ptrreviewed,ptravailable,season_supply,s_lts,itemspec,season,mcstatus,hz,intercopo,insurancegroup,si_lts,a_lts,ai_lts,si_available,holdstopenddate,salesnote_1,spec,caliper,pic_note,sales_note,av_note,photo_link,photo_name,flyer_cat,flyer_title,flyer_inst,flyer_assigned,flyer_notes,flyer_photo_link,flyer_photo_name,flyer_completed,initial_ptr,loc_match_qty,end_cap_folder,end_cap_qty,end_cap_level,match,dock_num,source,desigitem,desigcust,desigloc,filename",
  suspend_tag: "unique_id,concat,last_updated,date_completed,assignedto,customeridentityid,customername,consigneeidentityid,consigneename,salesrepid,salesrepname,dock_num,dock,stopnumber,transactionnumber,itemcode,commonname,contsize,locationcode,lotcode,source,suspend,suspend_to,quantityordered,quantityshipped,ptravailable,priority,planstart,requestdateweek,purchaseordernumber,desigitem,desigcust,desigloc,spec,caliper,dock_spec,dock_caliper,dock_note,dock_photo_link,dock_photo_name,photo_link,photo_name,match,loc_match_qty,av_note,pic_note,picknote,salesnote,sales_note,salesnote_1,ptronhand,ptrreviewed,holdstopcode",
  ph_cav_import: "unique_id,last_updated,filename,itemcode,commonname,contsize,season,ptravailable,brand,spec,hz,unitprice,holdstopreason,ordertotal,product_description,brand_code,h,available,reserved_qty,order_qty,unit_price,n_star,hot_price,hold_reason,ext_item_total,created_at",
  ph_reserves: "unique_id,concat,last_updated,assigned_to,assignedto,spec,caliper,pic_note,sales_note,av_note,photo_link,photo_name,dock_spec,dock_caliper,dock_note,dock_photo_link,dock_photo_name,date_completed,flyer_cat,flyer_title,flyer_inst,flyer_assigned,flyer_notes,flyer_photo_link,flyer_photo_name,flyer_completed,initial_ptr,loc_match_qty,end_cap_folder,end_cap_qty,end_cap_level,match,item,size,container,location,lot,warehouseid,warehousename,isreserve,salesrepid,salesrepname,nationalaccountidgroup,national_account_idgroup,idgroup,customeridentityid,customername,consigneeidentityid,consigneename,consigneecity,consigneestate,consigneezip,tripnumber,stopnumber,zonecode,tagcode,transactionnumber,purchaseordernumber,extunitprice,ordertotal,requestdate,stagename,step,customersku,formattedupc,printedcontainercode,lotcode,locationcode,descriptorcode,itemcode,plantgroupcode,sortname,variety,containersort,qualitycode,commonname,quantityordered,quantityshipped,listprice,unitprice,handlingchargeperitem,taggingchargeperitem,combinedprice,freightrateperitem,landedretailprice,holdstopcode,holdstopreason,salesnote,fnsalesnote,picknote,planstart,generalloadinstr,invoicedate,consigneeaddress_1,consigneeaddress_2,altshipcomment,shiptotelephone_1,okloadinstructions,txloadinstructions,ncloadinstructions,hlloadinstructions,dock,equiv_unit,equiv_uom,wingdingunits,dropweight,internalinvnote,hardinesszone,brand,tagdeptnote,ext_unit,merch_shipped,ext_unit_merch_shipped,ext_eunit_shipped,avg_price_eunit_shipped,requestdateweek,carrier,suspend,suspend_to,qa_code,grower,nationalaccount,sortnamevariety,landed,retailprice,dock_num,priority,ptronhand,ptrreviewed,ptravailable,season_supply,s_lts,itemspec,season,mcstatus,hz,intercopo,insurancegroup,si_lts,a_lts,ai_lts,si_available,holdstopenddate,salesnote_1,contsize,source,desigitem,desigcust,desigloc,filename",
  ph_sales_office: "unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,priority,sales_note,photo_link,completed_by,completed_at,master_id,so_source,order_folder,order_number,order_customer,order_qty,order_desired_spec,order_desired_caliper,order_reserve,order_submitted_by,order_submitted_at,order_status,av_note,spec,caliper,photo_name,move_batch_id,move_from_locationcode,move_to_locationcode,move_actual_qty,workflow_status,workflow_detail,state_revision,reopen_reason,source_revision,updated_at,arrived_at",
  ph_dock_team_status: "dock_num,checker,inspector,mistake,status,updated_by,updated_at",
  ph_dock_item_status: "unique_id,checker_done,inspector_done,checker_completed_by,inspector_completed_by,updated_by,updated_at",
  ph_dock_issue_status: "issue_source_unique_id,source_master_unique_id,source_master_id,dock_num,stop_number,source_locationcode,source_itemcode,source_commonname,source_contsize,source_lotcode,source_qty,source_salesrep,source_customername,source_consigneename,issue_note,issue_state,flagged_by,flagged_at,resolved_by,resolved_at,updated_by,updated_at,source_match_key,issue_photo_link,issue_photo_name,source_photo_link,source_photo_name,source_loc_match_qty,source_spec,source_caliper",
  ph_dock_issue_allocations: "allocation_unique_id,issue_source_unique_id,alt_master_unique_id,alt_master_id,allocated_qty,alt_locationcode,alt_lotcode,alt_itemcode,alt_commonname,alt_contsize,alt_ptravailable,updated_by,updated_at",
  ph_productivity_history: "id,event_key,completed_by_username,completed_by_display,completed_at,source_table,source_kind,source_unique_id,source_assignment,itemcode,commonname,contsize,locationcode,lotcode,customer_name,request_folder,snapshot",
};
const DATASET_READ_SOURCES: Record<string, { table: string; permission: string; key: string; fields: string; signatures?: string; filterFields: Set<string>; orderFields: Set<string> }> = {
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
    table: "ph_request_queue_live_rows", permission: "ph_request_queue_live_rows", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_request_queue_live_rows,
    signatures: "unique_id,req_status,req_archived,req_rep_action,request_folder,req_customer,req_qty,date_completed,req_match,req_spec,req_caliper,desired_spec,desired_caliper,req_pic_note,request_note,req_comments,av_note,req_photo_link,req_photo_name,move_batch_id,move_approval_stage,move_status,move_group_key,move_from_locationcode,move_to_locationcode,move_planned_qty,move_actual_qty,move_destination_needs_row,move_dylan_approved_at,move_jd_approved_at,move_completed_at,move_completed_by,delivery_status,delivery_attempt_count,delivery_error_code,delivery_display_state,delivery_delivered_at",
    filterFields: new Set(["unique_id", "master_id", "itemcode", "locationcode", "lotcode", "requested_by", "request_selected_rep_username", "request_folder", "req_status", "req_archived", "req_rep_action", "app_tab_assignment", "master_app_tab_assignment", "request_source", "created_at", "updated_at", "delivery_status"]),
    orderFields: new Set(["unique_id", "created_at", "updated_at", "req_status", "delivery_status"]),
  },
  active_request: {
    table: "ph_active_request_live_rows", permission: "ph_active_request_live_rows", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.ph_active_request_live_rows,
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
    table: "ph_soc_master", permission: "ph_soc_master", key: "unique_id", fields: DATASET_READ_COLUMN_PROJECTIONS.suspend_tag,
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
const PRODUCTIVITY_HISTORY_SOURCE_KINDS = new Set(["season_sales_note", "location_sales_note", "need_av", "flyer", "request", "sales_office_order", "end_cap", "task"]);
const PRODUCTIVITY_HISTORY_ENTRY_FIELDS = new Set(["event_key", "completed_by_username", "completed_by_display", "completed_at", "source_table", "source_kind", "source_unique_id", "source_assignment", "itemcode", "commonname", "contsize", "locationcode", "lotcode", "customer_name", "request_folder", "snapshot"]);

function validateDatasetReadParams(payload: Record<string, unknown>) {
  if (Object.keys(payload).some((key) => !["action", "dataset", "params"].includes(key))) throw new Error("DATASET_READ_PAYLOAD_INVALID");
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown> : {};
  if (payload.params !== undefined && (!payload.params || typeof payload.params !== "object" || Array.isArray(payload.params))) throw new Error("DATASET_READ_PARAMETERS_INVALID");
  if (Object.keys(params).some((key) => !["limit", "offset", "projection", "filters", "anyOf", "order"].includes(key))) throw new Error("DATASET_READ_PARAMETERS_INVALID");
  const requestedLimit = Number(params.limit ?? 250), offset = Number(params.offset ?? 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isInteger(offset) || offset < 0 || offset > 2_000_000) throw new Error("DATASET_READ_PAGE_INVALID");
  const limit = Math.min(DATASET_READ_PAGE_MAX, requestedLimit);
  const projection = String(params.projection || "default");
  if (!["default", "signature", "ids"].includes(projection)) throw new Error("DATASET_READ_PROJECTION_INVALID");
  const rawFilters = params.filters ?? [];
  const rawAnyOf = params.anyOf ?? [];
  const rawOrder = params.order ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > 30 || !Array.isArray(rawAnyOf) || rawAnyOf.length > 30 || !Array.isArray(rawOrder) || rawOrder.length > 4) throw new Error("DATASET_READ_FILTER_INVALID");
  return { limit, offset, projection, filters: rawFilters as unknown[], anyOf: rawAnyOf as unknown[], order: rawOrder as unknown[] };
}

function datasetReadScalar(value: unknown) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 500 && !/[\x00-\x1f]/.test(value)) return value;
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

async function handleDatasetRead(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
  request?: Request,
) {
  if (!session) return errorResponse("Unauthorized", 401, { code: "DATASET_READ_UNAUTHORIZED" });
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try { actor = await resolveActiveSessionProfile(session); }
  catch { return errorResponse("An active account profile is required.", 403, { code: "ACTIVE_PROFILE_REQUIRED" }); }
  const username = normalizeUsername(String(actor.username || ""));
  const role = String(actor.role || "");
  const dataset = String(payload.dataset || "").trim().toLowerCase();
  const source = DATASET_READ_SOURCES[dataset];
  if (!source) return errorResponse("Unsupported dataset.", 400, { code: "DATASET_READ_INVALID" });
  if (dataset === "suspend_tag" ? !SUSPEND_TAG_EDITORS.has(username) : !hasTableReadAccess(role, source.permission, username)) return errorResponse("You do not have access to this dataset.", 403, { code: "DATASET_READ_FORBIDDEN" });
  if (dataset === "suspend_tag") {
    try { actor.nativeSessionId = await verifySuspendTagSession(supabase, actor, request); }
    catch { return errorResponse("Sign in again.", 401, { code: "SUSPEND_TAG_SESSION_REQUIRED" }); }
  }
  let parsed: ReturnType<typeof validateDatasetReadParams>;
  try { parsed = validateDatasetReadParams(payload); }
  catch (error) { return errorResponse(String(error instanceof Error ? error.message : error), 400, { code: String(error instanceof Error ? error.message : error) }); }

  if (parsed.projection === "signature" && !source.signatures) return errorResponse("This dataset has no signature projection.", 400, { code: "DATASET_READ_PROJECTION_INVALID" });
  const fields = parsed.projection === "ids" ? source.key : parsed.projection === "signature" ? source.signatures! : source.fields;
  let query: any = supabase.from(source.table).select(fields, { count: "exact" });
  try {
    const filters = datasetReadFilterParts(source, parsed.filters);
    for (const filter of filters) {
      if (filter.op === "in") query = query.in(filter.field, filter.value);
      else if (filter.op === "is") query = query.is(filter.field, filter.value);
      else if (filter.op === "not.is") query = query.not(filter.field, "is", filter.value);
      else if (filter.op === "not.ilike") query = query.not(filter.field, "ilike", filter.value);
      else query = query.filter(filter.field, filter.op, filter.value);
    }
    if (dataset === "suspend_tag") {
      // Mirror the Suspend Tag eligibility normalization in index.html, but
      // enforce it in PostgREST before exact count/paging so callers cannot
      // widen the result or receive inconsistent page totals.
      query = query.filter("suspend", "imatch", "^[[:space:]\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[s\u017f]uspend[[:space:]\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$")
        .filter("suspend_to", "imatch", "^[^a-z0-9]*d[^a-z0-9]*c[^a-z0-9]*$");
    }
    const anyOf = datasetReadFilterParts(source, parsed.anyOf);
    if (parsed.anyOf.length && !anyOf.length) throw new Error("DATASET_READ_FILTER_INVALID");

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
      query = query.or(anyOfScope ? `and(or(${repScope}),${anyOfScope})` : repScope);
    } else if (anyOf.length) {
      query = query.or(anyOf.map(datasetReadOrCondition).join(","));
    }

    for (const raw of parsed.order) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("DATASET_READ_ORDER_INVALID");
      const order = raw as Record<string, unknown>;
      if (Object.keys(order).some((key) => !["field", "ascending"].includes(key)) || typeof order.ascending !== "boolean") throw new Error("DATASET_READ_ORDER_INVALID");
      const field = String(order.field || "");
      if (!source.orderFields.has(field)) throw new Error("DATASET_READ_ORDER_INVALID");
      query = query.order(field, { ascending: order.ascending });
    }
    if (!parsed.order.some((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).field === source.key)) {
      query = query.order(source.key, { ascending: true });
    }
    const { data, error, count } = await query.range(parsed.offset, parsed.offset + parsed.limit - 1);
    if (error) return databaseFailureResponse("Dataset read failed.", error, "DATASET_READ_UNAVAILABLE");
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) return errorResponse("Dataset read returned an invalid page.", 503, { code: "DATASET_READ_INVALID_PAGE" });
    if (dataset === "suspend_tag") {
      const state = await handleSuspendTag(supabase, actor, { operation: "rows", payload: { ids: data.map((row: Record<string, unknown>) => row.unique_id) } }) as { rows: Record<string, unknown>[] };
      const byId = new Map(state.rows.map(row => [row.unique_id, row]));
      for (const row of data) {
        const current = byId.get(row.unique_id);
        if (current) for (const [key, value] of Object.entries(current)) if (key.startsWith("suspend_tag_") || key in row) row[key] = value;
      }
    }
    return jsonResponse({ ok: true, data: { rows: data, total: count, offset: parsed.offset, limit: parsed.limit, hasMore: parsed.offset + data.length < count } });
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error || "DATASET_READ_FILTER_INVALID");
    if (dataset === "suspend_tag" && code.includes("SUSPEND_TAG_")) {
      const failure = suspendTagError(error);
      return jsonResponse(failure.body, failure.status);
    }
    return errorResponse("Dataset read parameters are invalid.", 400, { code });
  }
}

async function handleRequestArchive(session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>, payload: Record<string, unknown>) {
    if (!session) return errorResponse("Sign in before archiving requests.", 401);
    let actor: Record<string, unknown>;
    try { actor = await resolveActiveSessionProfile(session); }
    catch { return errorResponse("An active account is required.", 403, { code: "ACCOUNT_INACTIVE" }); }
    const operation = String(payload.operation || "");
    if (operation === "list") {
      const offset = Number(payload.offset ?? 0), limit = Number(payload.limit ?? 100);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return errorResponse("Invalid archive page.", 400);
      const { data, error } = await supabase.rpc("request_archive_list_v1", { p_actor_id: actor.id, p_offset: offset, p_limit: Math.min(limit, 500) });
      if (error) return databaseFailureResponse("Archived requests could not be loaded.", error, "REQUEST_ARCHIVE_READ_FAILED");
      return jsonResponse({ ok: true, data });
    }
    const uid = String(payload.uid || "").trim(), key = String(payload.idempotencyKey || "").trim();
    if (!["archive", "restore"].includes(operation) || !uid || uid.length > 240 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      return errorResponse("Invalid archive command.", 400, { code: "REQUEST_ARCHIVE_COMMAND_INVALID" });
    }
    const { data, error } = await supabase.rpc("request_archive_command_v1", {
      p_actor_id: actor.id, p_uid: uid, p_operation: operation, p_idempotency_key: key,
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
    return jsonResponse({ ok: true, ...(data && typeof data === "object" ? data as Record<string, unknown> : { snapshot: null, sheets: [] }) });
  }
  if (parsed.operation === "rows") {
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
    const { data, error } = await supabase.rpc("production_schedule_read_status_v1", { p_snapshot_id: runId || null });
    if (error) return databaseFailureResponse("Production Schedule status is unavailable.", error, "PRODUCTION_SCHEDULE_STATUS_UNAVAILABLE");
    return jsonResponse({ ok: true, run: data && typeof data === "object" ? data : { id: null, status: "empty" } });
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
  const role = String(actor.role || "");
  if (!hasTableWriteAccess(role, "ph_productivity_history", "POST", payload.entries, username)) return errorResponse("You do not have access to productivity history.", 403, { code: "PRODUCTIVITY_HISTORY_FORBIDDEN" });
  if (Object.keys(payload).some((key) => !["action", "entries"].includes(key)) || !Array.isArray(payload.entries) || payload.entries.length < 1 || payload.entries.length > 500) {
    return errorResponse("Productivity history entries are invalid.", 400, { code: "PRODUCTIVITY_HISTORY_PAYLOAD_INVALID" });
  }
  const entries: Record<string, unknown>[] = [];
  const keys = new Set<string>();
  try {
    for (const raw of payload.entries) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PRODUCTIVITY_HISTORY_ENTRY_INVALID");
      const entry = raw as Record<string, unknown>;
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
      const snapshot = entry.snapshot && typeof entry.snapshot === "object" && !Array.isArray(entry.snapshot) ? entry.snapshot : {};
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
        snapshot,
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

function hasTableWriteAccess(role = "", table = "", method = "POST", body: unknown = null, username = "") {
  if (!WRITABLE_TABLES.has(table)) return false;
  const userKey = normalizeUsername(username);
  const access = getRoleAccessState(role);
  // Request creation, Eval assignments, and push identity are now enforced by
  // authenticated RPCs. Never let this legacy service-role proxy bypass those
  // database authorization boundaries.
  if (table === "ph_warehouse_assigned_items" || table === "ph_push_subscriptions" || table === "ph_shear_list") return false;
  if (table === "ph_dock_team_status") return false;
  if (table === "ph_soc_master") return false; // Native column grants / protected Suspend Tag command own SOC writes.
  if (table === "ph_active_request" && access.isRep) return false;
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
  let query = supabase
    .from("profiles")
    .select("id,username,display_name,role,disabled_at,locked_until,must_change_password");
  query = session?.authUserId
    ? query.eq("id", String(session.authUserId))
    : query.eq("username", username);
  const { data: profile, error } = await query.maybeSingle();
  if (error) throw error;
  const lockedUntil = Date.parse(String(profile?.locked_until || ""));
  if (!profile?.id || profile.disabled_at || profile.must_change_password
    || (Number.isFinite(lockedUntil) && lockedUntil > Date.now())) {
    throw new Error("profile_not_active");
  }
  if (!await isAppAccountActive(supabase, { id: String(profile.id) })) throw new Error("profile_not_active");
  return profile as Record<string, unknown>;
}

function sanitizeDriveReclassPayload(payload: Record<string, unknown>) {
  const sourceInput = payload.source && typeof payload.source === "object" && !Array.isArray(payload.source)
    ? payload.source as Record<string, unknown>
    : {};
  const transaction = payload.transaction && typeof payload.transaction === "object" && !Array.isArray(payload.transaction)
    ? payload.transaction as Record<string, unknown>
    : {};
  const rowOverlays = Array.isArray(payload.rowOverlays) ? payload.rowOverlays : [];
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
    clientVersion: String(payload.clientVersion || "").trim().slice(0, 80),
  };
}

function driveReclassErrorResponse(message: string) {
  const raw = String(message || "").trim().toUpperCase();
  if (/TOKEN_OWNERSHIP/.test(raw)) {
    return errorResponse("This saved inquiry belongs to another user.", 403, { code: "DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT" });
  }
  if (/FORBIDDEN|PERMISSION_REQUIRED|ROW_NOT_ASSIGNED|PROFILE_NOT_ACTIVE|ACTOR_REQUIRED/.test(raw)) {
    return errorResponse("You do not have access to Reclass this Drive row.", 403, { code: "DRIVE_RECLASS_FORBIDDEN" });
  }
  if (/SOURCE_CHANGED|SOURCE_MISSING|TOKEN_CONFLICT/.test(raw)) {
    return errorResponse("Inventory or inquiry state changed. Refresh Drive Mode, review the row, and send again.", 409, { code: "DRIVE_RECLASS_SOURCE_CHANGED" });
  }
  if (/RECIPIENTS_UNAVAILABLE/.test(raw)) {
    return errorResponse("No required Reclass recipient is currently available.", 422, { code: "DRIVE_RECLASS_RECIPIENTS_UNAVAILABLE" });
  }
  if (/PAYLOAD|TOKEN|SOURCE_REQUIRED|ACTIONS_INVALID|V3_REQUIRED|STATUS_INVALID|RETRY_INVALID/.test(raw)) {
    return errorResponse("The Reclass inquiry is incomplete. Review it and try again.", 400, { code: "DRIVE_RECLASS_INVALID" });
  }
  return errorResponse("Reclass service is temporarily unavailable. Retry with the same inquiry.", 503, { code: "DRIVE_RECLASS_SERVICE_UNAVAILABLE" });
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
    ? payload.input as Record<string, unknown> : {};
  try {
    const { data, error } = await supabase.rpc('photo_history_gallery_v1', {
      p_actor_id: profile.id, p_operation: operation, p_input: input,
    });
    if (error) throw new Error(error.message);
    if (operation === 'search') {
      return jsonResponse({ ...data, photos: (data.photos || []).map((a: Record<string, unknown>) => publicHistoryPhoto(SUPABASE_URL, a)) });
    }
    if (operation === 'asset') {
      const asset = data.asset as Record<string, unknown>;
      if (input.open === true) {
        const url = asset.storage_available ? historyPhotoUrl(SUPABASE_URL, asset, true)
          : `https://drive.google.com/file/d/${encodeURIComponent(String(asset.drive_file_id || ''))}/view`;
        return jsonResponse({ ok: true, url, archived: !asset.storage_available });
      }
      if (asset.storage_available) return jsonResponse({ ok: true, thumbnail: historyPhotoUrl(SUPABASE_URL, asset) });
      return jsonResponse(await readArchivedHistoryThumbnail(asset));
    }
    return jsonResponse(data);
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

async function handleDriveReclassAction(
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
        p_actor_id: activeProfile.id,
        p_assigned_to: assignedTo,
      });
      if (error) return seasonPriorityErrorResponse(error.message || "");
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, rows: [] });
    }
    if (operation === "season_priority_submit") {
      const expectedPriority = Number(payload.expectedPriority ?? payload.expected_priority);
      const { data, error } = await supabase.rpc("submit_manager_season_priority_v1", {
        p_actor_id: activeProfile.id,
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
        p_actor_id: activeProfile.id,
        p_itemcodes: itemcodes,
      });
      if (error) return seasonPriorityErrorResponse(error.message || "");
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, requests: [] });
    }
    if (operation === "create") {
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
      const { data, error } = await supabase.rpc("enqueue_drive_reclass_inquiry_v1", { p_payload: protectedPayload });
      if (error) return driveReclassErrorResponse(error.message || "");
      return jsonResponse(data && typeof data === "object" ? data : { ok: false, status: "failed" });
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
    return jsonResponse(data && typeof data === "object" ? data : { ok: false, status: "missing" });
  } catch (_) {
    return driveReclassErrorResponse("DRIVE_RECLASS_SERVICE_UNAVAILABLE");
  }
}

function seasonPriorityErrorResponse(error: unknown) {
  const raw = String(error || "SEASON_PRIORITY_SERVICE_UNAVAILABLE").toUpperCase();
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
        p_payload: {
          actorUsername: actor,
          idempotencyKey: String(payload.idempotencyKey || "").trim(),
          selections,
          recipients,
        },
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
          instructions: String(line.instructions || "").trim().slice(0, 4000),
        };
      });
      const recipients = await resolveLocationWorkRecipients(payload.recipientProfileIds);
      const directory = await listActiveEmailProfiles();
      const completionRecipient = directory.find((entry) => entry.username === LOCATION_WORK_CREATOR);
      if (!completionRecipient) throw new Error("location_work_completion_recipient_invalid");
      const { data, error } = await supabase.rpc("create_location_work_job_v1", {
        p_payload: {
          actorUsername: actor,
          idempotencyKey: String(payload.idempotencyKey || "").trim(),
          title: String(payload.title || "").trim(),
          generalInstructions: String(payload.generalInstructions || "").trim(),
          lines,
          recipients,
          completionRecipient,
        },
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
        p_actual_qty: actualQty,
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
      const rpcName = operation === "cancel" ? "cancel_location_work_job_v1" : "retry_location_work_delivery_v1";
      const args: Record<string, unknown> = {
        p_job_id: jobId,
        p_actor_username: actor,
        p_expected_revision: expectedRevision,
      };
      if (operation === "retry") args.p_delivery_kind = String(payload.deliveryKind || "assignment").trim().toLowerCase();
      const { data, error } = await supabase.rpc(rpcName, args);
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
    const role = String(actorProfile.role || session.role || "").trim();
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
      p_dock_num: dockNum || null,
      p_checker: checker || null,
      p_inspector: inspector || null,
      p_mistake: mistake || null,
      p_status: dockStatus,
      p_actor_username: actor,
      p_expected_revision: expectedRevision,
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
    : (code === "40001" || /conflict/.test(safeCode) ? 409 : 400);
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
      if (!isEvalWorkManager(session)) {
        return errorResponse("Only Dylan, Megan, or JD can view Eval Reports #2.", 403, { code: "eval_report2_view_forbidden" });
      }
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
        const { data, error } = await supabase.rpc("create_eval_work_legacy_sep09_v1", { p_payload: rpcPayload });
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
      const { data, error } = await supabase.rpc("create_eval_work_multi_v1", { p_payload: rpcPayload });
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
      const { data, error } = await supabase.rpc(rpcName, { p_payload: rpcPayload });
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
      const rpcName = isV2
        ? (operation === "submit" ? "submit_eval_work_v2" : "save_eval_work_v2")
        : (operation === "submit" ? "submit_eval_work_v1" : "save_eval_work_v1");
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
      const { data, error } = await supabase.rpc(rpcName, {
        p_work_id: workId,
        p_actor_username: actor,
        p_expected_version: Number(payload.expectedVersion),
        p_inquiry: payload.inquiry && typeof payload.inquiry === "object" ? payload.inquiry : row.inquiry_draft,
        ...(isV2 ? { p_evidence_by_origin: evidence } : { p_evidence: evidence }),
        ...(operation === "submit" ? { p_submission_token: String(payload.submissionToken || "").trim() } : {}),
      });
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

async function handleLogin(payload: Record<string, unknown>) {
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "").trim();
  if (!username || !password) return errorResponse("Username and password are required.", 400);

  const selectCols = "username,role,password,division,language";
  const normalizedInput = normalizeUsername(username);
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

  if (!matchedUser) return jsonResponse({ ok: false, reason: "mismatch" }, 200);
  if (!await isAppAccountActive(supabase, { username: normalizedInput })) {
    return errorResponse("This account is no longer active. Contact an administrator.", 403, { code: "ACCOUNT_INACTIVE" });
  }

  const dbUsername = String(matchedUser.username || matchedUser.USERNAME || username).trim() || username;
  const role = String(matchedUser.role || matchedUser.ROLE || "User").trim() || "User";
  const division = String(matchedUser.division || matchedUser.DIVISION || "10").trim() || "10";
  const language = String(matchedUser.language || matchedUser.LANGUAGE || "English").trim() || "English";
  const matchedDbPassword = String(matchedUser.password || matchedUser.PASSWORD || "").trim();
  const mustChangePassword = isForcedPasswordValue(matchedDbPassword) || isForcedPasswordValue(password);
  const session = await createAppSession({
    username: dbUsername,
    displayName: dbUsername,
    role,
    mustChangePassword,
  });

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
  });
}

async function handleNativeSessionBridge(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
) {
  if (!session || session.ver < 2) return errorResponse("Native authentication required.", 401);
  if (session.mustChangePassword) {
    return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  }

  const bridgedSession = await createAppSession({
    username: session.username,
    displayName: session.displayName || session.username,
    role: session.role,
    mustChangePassword: false,
  });

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
        p_username: username, p_auth_user_id: authUserId, p_password_fingerprint: fingerprint,
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
    || (protectedTable === "ph_request_history" && protectedMethod === "GET")
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
  if (table === "ph_master_inventory" && method === "GET") {
    return errorResponse("Use the role-checked inventory_read operations.", 410, { code: "INVENTORY_READ_API_REQUIRED" });
  }
  if (method === "GET") {
    if (!hasTableReadAccess(session.role, table, session.username)) return errorResponse("Forbidden", 403);
  } else if (!hasTableWriteAccess(session.role, table, method, body, session.username)) {
    return errorResponse("Forbidden", 403);
  }

  if (table === "ph_app_users" && method === "GET") {
    const access = getRoleAccessState(session.role);
    query = withSelect(query, "username,role");
    if (access.isSalesAssistant && !access.isAdmin) {
      const params = new URLSearchParams(query);
      params.set("role", "in.(REP,Rep,rep)");
      params.set("order", "username.asc");
      params.set("limit", "1000");
      query = params.toString();
    }
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

const INVENTORY_MASTER_INITIAL_FIELDS = [
  "unique_id", "warehouseid", "plantgroupcode", "itemcode", "qualitycode", "contsize", "commonname",
  "lotcode", "locationcode", "source", "desigitem", "desigcust", "desigloc", "priority", "ptravailable", "s_lts", "season_supply", "saleyear",
  "itemspec", "locationnote", "locationnotedate", "fieldtagcolor", "holdstopcode", "holdstopreason", "holdstopbegindate", "season", "blockalpha", "blocknumber",
  "hold_release_approved_at", "hold_release_approved_by", "hold_release_approved_by_display", "hold_release_approved_holdstopbegindate",
  "app_tab_assignment", "assignedto", "date_completed", "av_note", "sales_note", "salesnote", "match", "loc_match_qty", "initial_ptr", "spec", "caliper",
  "av_rule_bundle_updated_at", "av_rule_av_note_updated_at", "av_rule_spec_updated_at", "av_rule_match_updated_at", "av_rule_caliper_updated_at", "av_rule_photo_updated_at",
  "av_rule_priority_snapshot", "av_rule_holdstop_snapshot", "av_rule_last_clear_reason", "av_rule_last_cleared_at",
  "eval_task_type", "eval_task_status", "eval_task_instructions", "eval_task_assigned_by", "eval_task_assigned_at", "eval_task_completed_by", "eval_task_completed_at",
  "eval_task_recount_qty", "eval_task_moved_up_qty", "eval_task_hold_action", "eval_task_hold_code", "eval_task_hold_reason", "eval_task_result_note",
  "photo_link", "photo_name", "dock_photo_link", "dock_photo_name", "flyer_photo_link", "flyer_photo_name", "flyer_completed",
  "flyer_av_note", "flyer_match", "flyer_loc_match_qty", "flyer_spec", "flyer_caliper", "flyer_pick", "flyer_initial_ptr",
].join(",");
const INVENTORY_MASTER_INITIAL_BASE_FIELDS = INVENTORY_MASTER_INITIAL_FIELDS.split(",").filter((field) =>
  !field.startsWith("hold_release_") && !field.startsWith("av_rule_")
).join(",");
// Explicit full contracts preserve existing detail/export fields without exposing
// future schema additions automatically. Browse includes every current Drive filter.
const INVENTORY_MASTER_FULL_FIELDS = [
  "unique_id", "itemcode", "commonname", "contsize", "locationcode", "lotcode", "ptravailable",
  "season_supply", "priority", "qualitycode", "field_tag_color", "s_lts", "season", "plantgroupcode",
  "listprice", "concat", "last_updated", "assignedto", "date_completed", "end_cap_folder", "end_cap_qty",
  "end_cap_level", "match", "spec", "caliper", "pic_note", "sales_note", "av_note",
  "photo_link", "photo_name", "dock_spec", "dock_caliper", "dock_note", "dock_photo_link", "dock_photo_name",
  "flyer_cat", "flyer_title", "flyer_inst", "flyer_assigned", "flyer_notes", "flyer_photo_link", "flyer_photo_name",
  "flyer_completed", "initial_ptr", "loc_match_qty", "warehousei", "desigitem", "desigcust", "desigloc",
  "ptronhand", "ptrreviewed", "holdstopcode", "holdstopbegindate", "holdstopreason", "hsreasonbegin", "season_oh",
  "season_demand", "oversellpercentage", "itemspec", "locationnote", "locationnotedate", "suspend", "suspendto",
  "specialpuller", "pulltagnote1", "pulltagnote2", "fieldtagcolor", "salesnote", "inventorynote", "locationptn1",
  "locationptn2", "prisetby", "priupdated", "bypassloc", "largeptrqty", "maxorderquantity", "lochold",
  "ext_ptronhand", "varietycode", "genusname", "botanicalname", "reversecommon", "sortnamevariety", "containersort",
  "saleyear", "blockalpha", "blocknumber", "bay", "pullerresponsibility", "grower", "si_lts",
  "a_lts", "ai_lts", "season_available", "holdstopenddate", "salesnote_1", "fnsalesnote", "warehousename",
  "mcstatus", "hz", "intercopo", "insurancegroup", "brand", "printedcontainercode", "warehouseid",
  "isreserve", "salesrepid", "salesrepname", "nationalaccount", "idgroup", "customeridentityid", "customername",
  "consigneeidentityid", "consigneename", "consigneecity", "consigneestate", "consigneezip", "tripnumber", "stopnumber",
  "zonecode", "tagcode", "transactionnumber", "purchaseordernumber", "extunitprice", "ordertotal", "requestdate",
  "stagename", "step", "customersku", "formattedupc", "descriptorcode", "quantityordered", "quantityshipped",
  "unitprice", "handlingchargeperitem", "taggingchargeperitem", "combinedprice", "freightrateperitem", "landed", "retailprice",
  "picknote", "planstart", "generalloadinstr", "invoicedate", "consigneeaddress_1", "consigneeaddress_2", "altshipcomment",
  "shiptotelephone_1", "okloadinstructions", "txloadinstructions", "ncloadinstructions", "hlloadinstructions", "dock", "dock_num",
  "equiv_unit", "equiv_uom", "wingdingunits", "dropweight", "internalinvnote", "hardinesszone", "tagdeptnote",
  "ext_unit_merch_shipped", "ext_eunit_shipped", "avg_price_eunit_shipped", "requestdateweek", "carrier", "suspend_to", "qa_code",
  "si_available", "source", "filename", "app_tab_assignment", "salesnotebegindate", "ncr_approval_type", "ncr_requested_by_username",
  "ncr_requested_by_display", "ncr_requested_by_email", "ncr_requested_at", "ncr_approval_message", "hold_release_approved_at", "hold_release_approved_by", "hold_release_approved_by_display",
  "hold_release_approved_holdstopbegindate", "flyer_av_note", "flyer_match", "flyer_loc_match_qty", "flyer_spec", "flyer_caliper", "flyer_pick",
  "flyer_initial_ptr", "eval_task_type", "eval_task_status", "eval_task_instructions", "eval_task_assigned_by", "eval_task_assigned_at", "eval_task_completed_by",
  "eval_task_completed_at", "eval_task_recount_qty", "eval_task_moved_up_qty", "eval_task_hold_action", "eval_task_hold_code", "eval_task_hold_reason", "eval_task_result_note",
  "av_rule_bundle_updated_at", "av_rule_av_note_updated_at", "av_rule_spec_updated_at", "av_rule_match_updated_at", "av_rule_caliper_updated_at", "av_rule_photo_updated_at", "av_rule_priority_snapshot",
  "av_rule_holdstop_snapshot", "av_rule_last_clear_reason", "av_rule_last_cleared_at",
].join(",");
const INVENTORY_MASTER_BROWSE_FIELDS = [
  "unique_id", "warehouseid", "plantgroupcode", "itemcode", "qualitycode", "contsize", "commonname",
  "lotcode", "locationcode", "source", "desigitem", "desigcust", "desigloc", "priority",
  "ptravailable", "s_lts", "season_supply", "saleyear", "itemspec", "locationnote", "locationnotedate",
  "fieldtagcolor", "holdstopcode", "holdstopreason", "holdstopbegindate", "season", "blockalpha", "blocknumber",
  "hold_release_approved_at", "hold_release_approved_by", "hold_release_approved_by_display", "hold_release_approved_holdstopbegindate", "app_tab_assignment", "assignedto", "date_completed",
  "av_note", "sales_note", "salesnote", "match", "loc_match_qty", "initial_ptr", "spec",
  "caliper", "av_rule_bundle_updated_at", "av_rule_av_note_updated_at", "av_rule_spec_updated_at", "av_rule_match_updated_at", "av_rule_caliper_updated_at", "av_rule_photo_updated_at",
  "av_rule_priority_snapshot", "av_rule_holdstop_snapshot", "av_rule_last_clear_reason", "av_rule_last_cleared_at", "eval_task_type", "eval_task_status", "eval_task_instructions",
  "eval_task_assigned_by", "eval_task_assigned_at", "eval_task_completed_by", "eval_task_completed_at", "eval_task_recount_qty", "eval_task_moved_up_qty", "eval_task_hold_action",
  "eval_task_hold_code", "eval_task_hold_reason", "eval_task_result_note", "photo_link", "photo_name", "dock_photo_link", "dock_photo_name",
  "flyer_photo_link", "flyer_photo_name", "flyer_completed", "flyer_av_note", "flyer_match", "flyer_loc_match_qty", "flyer_spec",
  "flyer_caliper", "flyer_pick", "flyer_initial_ptr", "warehousei", "ptronhand", "ptrreviewed", "hsreasonbegin",
  "season_oh", "season_demand", "oversellpercentage", "suspend", "suspendto", "specialpuller", "pulltagnote1",
  "pulltagnote2", "inventorynote", "locationptn1", "locationptn2", "prisetby", "priupdated", "bypassloc",
  "largeptrqty", "maxorderquantity", "lochold", "listprice", "ext_ptronhand", "varietycode", "genusname",
  "botanicalname", "reversecommon", "sortnamevariety", "containersort", "bay", "pullerresponsibility", "grower",
  "si_lts", "a_lts", "ai_lts", "season_available", "holdstopenddate", "fnsalesnote", "warehousename",
  "mcstatus", "hz", "intercopo", "insurancegroup", "brand", "printedcontainercode", "salesnotebegindate",
  "equiv_unit", "last_updated", "filename", "ncr_approval_type", "ncr_requested_by_username", "ncr_requested_by_display", "ncr_requested_by_email",
  "ncr_requested_at", "ncr_approval_message", "end_cap_folder", "end_cap_qty", "end_cap_level", "flyer_cat", "flyer_title",
  "flyer_inst", "flyer_assigned", "flyer_notes", "pic_note",
  "consigneename", "customername", "dock", "dock_caliper", "dock_note", "dock_num", "dock_spec",
  "field_tag_color", "picknote", "planstart", "qa_code", "salesnote_1", "salesrepid", "salesrepname",
  "stopnumber", "suspend_to", "tripnumber",
].join(",");
const INVENTORY_PO_DETAIL_FIELDS = "unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,app_tab_assignment,priority,season";
const INVENTORY_NCR_QUEUE_FIELDS = "unique_id,warehouseid,plantgroupcode,itemcode,qualitycode,contsize,commonname,itemspec,locationcode,lotcode,source,desigitem,desigcust,desigloc,priority,ptronhand,ptravailable,s_lts,saleyear,season,locationnote,locationnotedate,locationptn1,fieldtagcolor,holdstopcode,holdstopreason,holdstopbegindate,last_updated,photo_link,photo_name,dock_photo_link,dock_photo_name,flyer_photo_link,flyer_photo_name,flyer_completed,flyer_av_note,flyer_match,flyer_loc_match_qty,flyer_spec,flyer_caliper,flyer_pick,flyer_initial_ptr,av_note,sales_note,salesnote,match,loc_match_qty,initial_ptr,spec,caliper,ncr_approval_type,ncr_requested_by_username,ncr_requested_by_display,ncr_requested_by_email,ncr_requested_at,ncr_approval_message,hold_release_approved_at,hold_release_approved_by,hold_release_approved_by_display,hold_release_approved_holdstopbegindate,app_tab_assignment,assignedto,eval_task_type,eval_task_status,eval_task_instructions,eval_task_assigned_by,eval_task_assigned_at,eval_task_completed_by,eval_task_completed_at,eval_task_recount_qty,eval_task_moved_up_qty,eval_task_hold_action,eval_task_hold_code,eval_task_hold_reason,eval_task_result_note";
const INVENTORY_NOT_ON_INVENTORY_FIELDS = "unique_id,warehouseid,plantgroupcode,itemcode,qualitycode,contsize,commonname,itemspec,locationcode,lotcode,source,desigitem,desigcust,desigloc,priority,ptronhand,ptravailable,s_lts,saleyear,season,locationnote,locationnotedate,locationptn1,fieldtagcolor,holdstopcode,holdstopreason,holdstopbegindate,last_updated,photo_link,photo_name,dock_photo_link,dock_photo_name,flyer_photo_link,flyer_photo_name,flyer_completed,flyer_av_note,flyer_match,flyer_loc_match_qty,flyer_spec,flyer_caliper,flyer_pick,flyer_initial_ptr,av_note,sales_note,salesnote,match,loc_match_qty,initial_ptr,spec,caliper,app_tab_assignment,assignedto";
const INVENTORY_NCR_ASSIGNMENT_TYPES = new Set(["new-crop", "move-up", "move-down", "hold-release", "recount"]);
const INVENTORY_NCR_FIRST_STAGE_USERS = new Set(["dylan_collyge", "megan_kelly"]);
const INVENTORY_NCR_JD_STAGE_USERS = new Set(["jd_jones", "megan_kelly"]);
const INVENTORY_NOT_ON_INVENTORY_ASSIGNMENTS = new Set(["not_on_inventory_dylan", "not_on_inventory_jd"]);
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

function inventoryReadPageBounds(params: Record<string, unknown>) {
  const requestedLimit = Number(params.limit ?? 250);
  const requestedOffset = Number(params.offset ?? 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > 2_000_000) {
    throw new Error("INVENTORY_READ_PAGE_INVALID");
  }
  return { limit: Math.min(500, requestedLimit), offset: requestedOffset };
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

function inventoryReadQuery(table: string, fields: string, actor: Record<string, unknown>, includeCount = true) {
  let query: any = supabase.from(table).select(fields, includeCount ? { count: "exact" } : {});
  const role = String(actor.role || "").trim();
  const access = getRoleAccessState(role);
  const compactRole = role.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (compactRole.includes("FOREMAN")) {
    query = query.not("priority", "is", null).not("priority", "in", "(,-,--,---,N/A,NA,NULL,NONE)");
  }
  if (access.isRepLike && !access.isAdmin) {
    query = query.or("season.is.null,season.not.ilike.U3").or("lotcode.is.null,lotcode.not.ilike.%.U3");
  }
  return query;
}

async function handleInventoryRead(
  session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Unauthorized", 401);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  let actor: Record<string, unknown>;
  try {
    actor = await resolveActiveSessionProfile(session);
  } catch {
    return errorResponse("An active account profile is required.", 403, { code: "ACTIVE_PROFILE_REQUIRED" });
  }
  const username = normalizeUsername(String(actor.username || ""));
  const role = String(actor.role || "");
  if (!hasTableReadAccess(role, "ph_master_inventory", username)) return errorResponse("Forbidden", 403, { code: "INVENTORY_READ_FORBIDDEN" });

  const operation = String(payload.operation || "").trim().toLowerCase();
  try {
    if (operation === "source_freshness") {
      inventoryReadParams(payload, []);
      const { data, error } = await inventoryReadQuery("ph_master_inventory", "filename,last_updated", actor, false)
        .not("last_updated", "is", null)
        .order("last_updated", { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] || null : null;
      return jsonResponse({ ok: true, data: { filename: row?.filename ?? null, last_updated: row?.last_updated ?? null } });
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
      const { limit, offset } = inventoryReadPageBounds(params);
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
      if (dataset === "lookup" && !uniqueId && (locationCode || lotCode || source) && !(locationCode && lotCode && source)) throw new Error("INVENTORY_READ_FILTER_INVALID");
      if (dataset !== "lookup" && (uniqueId || itemCode || locationCode || lotCode || source || season)) throw new Error("INVENTORY_READ_FILTER_INVALID");
      if (dataset === "avOpen" && projection === "initial") throw new Error("INVENTORY_READ_PROJECTION_INVALID");
      if (dataset === "avOpen" && season) throw new Error("INVENTORY_READ_FILTER_INVALID");
      const fields = projection === "browse" ? INVENTORY_MASTER_BROWSE_FIELDS
        : dataset === "avOpen" || projection === "full" ? INVENTORY_MASTER_FULL_FIELDS
        : projection === "initial_base" ? INVENTORY_MASTER_INITIAL_BASE_FIELDS : INVENTORY_MASTER_INITIAL_FIELDS;
      let response = inventoryReadQuery("ph_master_inventory", fields, actor);
      if (dataset === "avOpen") response.in("season", ["F1", "S1", "U1", "U2"]);
      if (dataset === "lookup") {
        if (uniqueId) response.eq("unique_id", uniqueId);
        else {
          response.eq("itemcode", itemCode);
          if (locationCode && lotCode && source) response.eq("locationcode", locationCode).eq("lotcode", lotCode).eq("source", source);
        }
      }
      if (season) response.eq("season", season);
      response = response.order("unique_id", { ascending: true }).range(offset, offset + limit - 1);
      const { data, error, count } = await response;
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return jsonResponse({ ok: true, data: { rows, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count,
        projection, fieldCoverage: projection === "browse" ? "browse" : dataset === "avOpen" || projection === "full" ? "full" : "initial", columns: fields.split(",") } });
    }

    if (operation === "master_delta") {
      const params = inventoryReadParams(payload, ["since", "limit", "offset"]);
      const { limit, offset } = inventoryReadPageBounds(params);
      const since = String(params.since || "").trim();
      if (!since || !Number.isFinite(Date.parse(since))) throw new Error("INVENTORY_READ_SINCE_INVALID");
      const response = inventoryReadQuery("ph_master_inventory", INVENTORY_MASTER_FULL_FIELDS, actor);
      response.gt("last_updated", since);
      response.order("unique_id", { ascending: true }).range(offset, offset + limit - 1);
      const { data, error, count } = await response;
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return jsonResponse({ ok: true, data: { rows, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count } });
    }

    if (operation === "po_detail") {
      const params = inventoryReadParams(payload, ["itemCode", "contSize", "limit", "offset"]);
      const { limit, offset } = inventoryReadPageBounds(params);
      const itemCode = String(params.itemCode || "").trim();
      const contSize = String(params.contSize || "").trim();
      if (!itemCode || !contSize) throw new Error("PO_DETAIL_FILTER_REQUIRED");
      if (!await resolveModuleAllowed(supabase, actor, "po-management")) return errorResponse("Forbidden", 403, { code: "PO_ACCESS_FORBIDDEN" });
      const response = inventoryReadQuery("ph_master_inventory", INVENTORY_PO_DETAIL_FIELDS, actor);
      response.eq("itemcode", itemCode).eq("contsize", contSize);
      response.order("unique_id", { ascending: true }).range(offset, offset + limit - 1);
      const { data, error, count } = await response;
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return jsonResponse({ ok: true, data: { rows, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count } });
    }

    if (operation === "recount_queue" || operation === "ncr_queue" || operation === "not_on_inventory_queue") {
      const allowedParams = operation === "ncr_queue" ? ["queueType", "assignment", "limit", "offset"]
        : operation === "not_on_inventory_queue" ? ["assignment", "limit", "offset"] : ["limit", "offset"];
      const params = inventoryReadParams(payload, allowedParams);
      const { limit, offset } = inventoryReadPageBounds(params);
      let assignment = "ncr_inventory_recount";
      let fields = "*";
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
      let query: any = supabase.from("ph_master_inventory").select(fields, { count: "exact" }).eq("app_tab_assignment", assignment);
      query = updatedAtFirst ? query.order("last_updated", { ascending: false, nullsFirst: false }).order("unique_id", { ascending: true })
        : query.order("unique_id", { ascending: true });
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return jsonResponse({ ok: true, data: { rows, total: count ?? null, offset, limit, hasMore: count === null ? rows.length === limit : offset + rows.length < count } });
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
      const row = data as Record<string, unknown> | null;
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
    if (/PAYLOAD_INVALID|PARAMETERS_INVALID|PAGE_INVALID|OPERATION_INVALID|FILTER_INVALID|FILTER_REQUIRED|PROJECTION_INVALID|SINCE_INVALID|TYPE_INVALID|VERIFICATION_INVALID/.test(message)) {
      return errorResponse("Invalid inventory read request.", 400, { code: message });
    }
    return errorResponse("Inventory data is temporarily unavailable.", 503, { code: "INVENTORY_READ_FAILED", retryable: true });
  }
}

const AURA_V2_OPERATIONS = new Set(["catalog", "count", "maximum", "lots", "validate_draft", "match"]);
const AURA_V2_METRICS = new Set(["ptravailable", "ptronhand"]);
const AURA_V2_SEASONS = new Set(["S1", "F1", "U1", "U2", "U3", "X", "Y", "Z"]);

export { auraInventoryV2ProfileMatches };

export function parseAuraInventoryV2Request(payload: Record<string, unknown>) {
  const allowed = new Set(["action", "operation", "itemcode", "commonName", "contSize", "locationCode", "metric", "openStockOnly", "quantity", "season", "cursor", "limit", "lines"]);
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
  if (!Array.isArray(lines)) throw new Error("AURA_V2_REQUEST_INVALID");
  if (!AURA_V2_OPERATIONS.has(operation) || !AURA_V2_METRICS.has(metric)
    || typeof openStockOnly !== "boolean"
    || (season !== null && !AURA_V2_SEASONS.has(season))
    || itemcode.length > 100 || commonName.length > 160 || contSize.length > 48 || locationCode.length > 64
    || !Number.isInteger(limit) || limit < 1 || limit > 500
    || (cursor !== null && (!cursor || typeof cursor !== "object" || Array.isArray(cursor)))) {
    throw new Error("AURA_V2_REQUEST_INVALID");
  }
  const cursorKeys = cursor && Object.keys(cursor as Record<string, unknown>).sort().join(",");
  if ((operation === "catalog" && cursor !== null && cursorKeys !== "contsize,itemcode")
    || (operation === "count" && cursor !== null && cursorKeys !== "unique_id")
    || (operation === "lots" && cursor !== null && cursorKeys !== "priority,unique_id")
    || (["maximum", "validate_draft", "match"].includes(operation) && cursor !== null)) {
    throw new Error("AURA_V2_CURSOR_INVALID");
  }
  if (["count", "lots"].includes(operation) && !itemcode) throw new Error("AURA_V2_ITEMCODE_REQUIRED");
  if (operation === "match" && !commonName) throw new Error("AURA_V2_NAME_REQUIRED");
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
  return { operation, itemcode, commonName, contSize, locationCode, metric, openStockOnly, quantity, season, cursor, limit, lines };
}

const AURA_INVENTORY_FIELDS = "unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,priority,ptronhand,s_lts,season,saleyear,desigitem,app_tab_assignment";
const AURA_MAX_INVENTORY_ROWS = 5000;
const AURA_INVENTORY_PAGE_SIZE = 500;

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
    timeoutStage = "database";
    const { data, error } = await auraInventoryV2Rpc(supabase, input, rpcSignal);
    if (error) throw error;
    if (!data || typeof data !== "object" || data.ok !== true) {
      return errorResponse("AURA inventory settings changed. Refresh the catalog and retry.", 409, { code: String(data?.code || "AURA_V2_RESULT_INVALID"), data });
    }
    if (data.code === "AURA_ACTIVE_SEASON_REQUIRED") {
      return errorResponse("The active season changed. Refresh the inventory and review the draft again.", 409, { code: "AURA_ACTIVE_SEASON_REQUIRED", data });
    }

    if (input.operation !== "validate_draft" || data.valid !== true || !Array.isArray(data.rows) || !data.rows.length) {
      return jsonResponse({ ok: true, data });
    }

    const currentSettings = await readAuraSeasonSettings();
    if (currentSettings.season !== String(data.season || "").toUpperCase()
      || currentSettings.salesYear !== Number(data.salesYear)) {
      return errorResponse("The active season or sales year changed. Refresh the inventory and review the draft again.", 409, {
        code: "AURA_ACTIVE_SEASON_REQUIRED",
      });
    }

    // Re-read full inventory fields for the <=50 explicitly selected IDs so
    // the existing Bloom Picker editor receives its ordinary row contract.
    // This avoids returning every column through the SQL validation function.
    const selectedIds = data.rows.map((row: Record<string, unknown>) => String(row.unique_id || "").trim()).filter(Boolean);
    if (selectedIds.length !== data.rows.length || selectedIds.length > 50) {
      return errorResponse("AURA could not safely prepare those inventory rows. Review the selection again.", 409, { code: "AURA_V2_DRAFT_RESULT_INVALID" });
    }
    const fullRowsQuery = supabase.from("ph_master_inventory")
      .select(INVENTORY_MASTER_FULL_FIELDS).in("unique_id", selectedIds).limit(50);
    const { data: fullRows, error: fullRowsError } = await (options.signal
      ? fullRowsQuery.abortSignal(options.signal)
      : fullRowsQuery);
    if (fullRowsError) throw fullRowsError;
    const fullInventoryRows = (Array.isArray(fullRows) ? fullRows : []) as unknown as Record<string, unknown>[];
    const freshById = new Map(fullInventoryRows.map(row => [String(row.unique_id || ""), row]));
    const validatedRows: Record<string, unknown>[] = [];
    const failures = [...(Array.isArray(data.failures) ? data.failures : [])] as Record<string, unknown>[];
    for (const requested of input.lines as Record<string, unknown>[]) {
      const uid = String(requested.unique_id || "").trim();
      const row = freshById.get(uid);
      if (!row
        || String(row.itemcode || "").trim().toUpperCase() !== String(requested.itemcode || "").trim().toUpperCase()
        || auraCanonicalName(row.commonname) !== auraCanonicalName(requested.commonname)
        || auraCanonicalSize(row.contsize) !== auraCanonicalSize(requested.contsize)
        || String(row.locationcode || "").trim().toUpperCase() !== String(requested.locationcode || "").trim().toUpperCase()
        || String(row.lotcode || "").trim().toUpperCase() !== String(requested.lotcode || "").trim().toUpperCase()
        || auraCanonicalName(row.season) !== auraCanonicalName(data.season)
        || auraComparableSalesYear(row.saleyear) == null || auraComparableSalesYear(row.saleyear)! > Number(data.salesYear)
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
      ...data,
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
    recordHandledError("app-api", "aura_inventory_search", error, 503);
    if (failure.code === "42501") return errorResponse("AURA cannot read this inventory data with the active account permissions.", 403, { code: "AURA_DATA_FORBIDDEN" });
    return errorResponse("AURA could not verify current inventory. Retry after the data connection recovers.", 503, {
      code: "AURA_INVENTORY_UNAVAILABLE",
      retryable: true,
    });
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

  let recipientUsername = "";
  let recipientName = "";
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
    if (!access.isAdmin) {
      return errorResponse("Drive photo upload requires an active Admin profile.", 403, { code: "drive_photo_forbidden" });
    }
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

if (import.meta.main) serve((req) => withObservedRequest("app-api", req, async () => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  try {
    ensureServerConfig();
  } catch (error) {
    return errorResponse(String(error instanceof Error ? error.message : error || "Server configuration missing."), 500);
  }

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  const session = await readSupabaseOrAppSessionFromRequest(req, supabase);

  if (contentType.includes("multipart/form-data")) {
    return await handlePhotoUpload(session, req);
  }

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action || "").trim().toLowerCase();

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
      return jsonResponse({ ok: true, data: await handleSuspendTag(supabase, actor, payload) });
    } catch (error) {
      const failure = suspendTagError(error);
      return jsonResponse(failure.body, failure.status);
    }
  }
  if (action === "login") return await handleLogin(payload);
  if (action === "native_session_bridge") return await handleNativeSessionBridge(session);
  if (action === "password_change") return await handlePasswordChange(await readPasswordChangeSession(req, session), payload);
  if (action === "get_user_preferences" || action === "live_pilot_bootstrap") {
    return await handleGetUserPreferences(session);
  }
  if (action === "set_user_preferences" || action === "live_pilot_preferences_save") {
    return await handleSetUserPreferences(session, payload);
  }
  if (action === "eval_work") return await handleEvalWorkAction(session, payload);
  if (action === "photo_history") return await handlePhotoHistoryAction(session, payload);
  if (action === "drive_reclass_inquiry") return await handleDriveReclassAction(session, payload);
  if (action === "season_sales_office") return await handleSeasonSalesOfficeAction(session, payload);
  if (action === "shear_location_work") return await handleShearLocationAction(session, payload);
  if (action === "bunch_note") {
    if (!session || session.mustChangePassword) return errorResponse("Sign in again.", 401);
    try {
      const actor = await resolveActiveSessionProfile(session);
      const allowed = new Set(["action", "operation", "payload", "commandId", "expectedRevision"]);
      if (Object.keys(payload).some(key => !allowed.has(key))) throw new Error("BUNCH_NOTE_PAYLOAD_INVALID");
      const { data, error } = await supabase.rpc("bunch_note_command_v1", {
        p_actor_id: actor.id, p_operation: String(payload.operation || ""),
        p_payload: payload.payload || {}, p_command_id: payload.commandId || null,
        p_expected_revision: payload.expectedRevision ?? null,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, data });
    } catch (error) {
      const source = error as Record<string, unknown>;
      const code = String(source.message || "BUNCH_NOTE_FAILED");
      return errorResponse(code, source.code === "42501" ? 403 : /CONFLICT|CHANGED|CLAIMED/.test(code) ? 409 : 400, { code });
    }
  }
  if (action === "location_work") return await handleLocationWorkAction(session, payload);
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
  if (action === "dataset_read") return await handleDatasetRead(session, payload, req);
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
      const role = String(actor.role || "");
      const access = getRoleAccessState(role);
      const data = await readAvPage({ supabase, actor, payload,
        // Existing active master-inventory readers may read the single
        // current-season dependency. readAvPage pins settings to that key.
        canRead: table => hasTableReadAccess(role, table, username)
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
  if (action === "inventory_read") return await handleInventoryRead(session, payload);
  if (action === "db") {
    if (session && session.ver >= 2) {
      return errorResponse("Native Auth sessions must use PostgREST with RLS for database access.", 410, {
        code: "DIRECT_RLS_REQUIRED"
      });
    }
    return await handleDb(session, payload);
  }

  return errorResponse("Unsupported action.", 400);
}));
