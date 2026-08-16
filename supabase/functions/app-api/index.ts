import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { createAppSession, getRoleAccessState, isForcedPasswordValue, normalizeUsername, readAppSessionFromRequest } from "../_shared/app-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gnc-session, x-app-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const LIVE_PILOT_USERNAME = "dylan_collyge";
const LIVE_PILOT_FEATURE_KEYS = ["skin", "preferences", "card_grid", "monitoring"] as const;
const LIVE_PILOT_SENTRY_DSN = String(Deno.env.get("LIVE_PILOT_SENTRY_DSN") || "").trim();
const PHOTO_BUCKETS: Record<string, string> = {
  "ssn-": "season_sales_notes_photos",
  "lsn-": "location_sales_notes_photos",
  "req-": "request_photos",
  "credit-": "credit_photos",
  "dock-": "dock_photos",
  "flyer-": "flyer_photos",
  default: "flyer_photos",
};
const REP_ALLOWED_PHOTO_PREFIXES = new Set(["req-", "credit-"]);
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
  "ph_shear_list",
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
  "ph_shear_list",
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
const REP_WRITE_TABLES = new Set([
  ...COMMON_AUTH_WRITE_TABLES,
  "ph_active_request",
  "ph_request_history",
  "ph_sales_credit_requests",
  "ph_request_email_threads",
  "ph_sales_office",
  "ph_shear_list",
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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, ...extra }, status);
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

function hasTableWriteAccess(role = "", table = "", method = "POST", body: unknown = null, username = "") {
  if (!WRITABLE_TABLES.has(table)) return false;
  const userKey = normalizeUsername(username);
  if (FULL_ACCESS_USER_KEYS.has(userKey)) return ["POST", "PATCH", "DELETE"].includes(method);
  if (table === AV_OPTION_EVAL_REQUESTS_TABLE) return ["POST", "PATCH", "DELETE"].includes(method);
  const access = getRoleAccessState(role);
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

async function readLivePilotPreferenceRow() {
  const { data, error } = await supabase
    .from("ph_app_user_preferences")
    .select("user_key,theme_mode,display_mode,updated_at,cohort_id")
    .eq("user_key", LIVE_PILOT_USERNAME)
    .maybeSingle();
  if (error) throw error;
  return data as LivePilotPreferenceRow | null;
}

async function readOrCreateLivePilotPreferenceRow() {
  const existing = await readLivePilotPreferenceRow();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("ph_app_user_preferences")
    .insert({
      user_key: LIVE_PILOT_USERNAME,
      theme_mode: "dark",
      display_mode: "cards",
      updated_at: new Date().toISOString(),
    })
    .select("user_key,theme_mode,display_mode,updated_at,cohort_id")
    .single();
  if (error) {
    if (String(error.code || "") === "23505") {
      const racedRow = await readLivePilotPreferenceRow();
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
  try {
    const flags = await loadLivePilotFlags();
    const monitoringEligible = !!(flags.monitoring && LIVE_PILOT_SENTRY_DSN);
    const monitoring = monitoringEligible
      ? {
        dsn: LIVE_PILOT_SENTRY_DSN,
        tracesSampleRate: 0.1,
      }
      : null;
    if (username !== LIVE_PILOT_USERNAME) {
      return jsonResponse({
        ok: true,
        eligible: false,
        monitoringEligible,
        flags: { ...getDisabledLivePilotFlags(), monitoring: monitoringEligible },
        preferences: null,
        monitoring,
      });
    }
    const preferenceRow = (flags.preferences || flags.card_grid)
      ? await readOrCreateLivePilotPreferenceRow()
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
    console.error("Live pilot bootstrap failed closed.", error);
    return jsonResponse({
      ok: true,
      eligible: false,
      monitoringEligible: false,
      flags: getDisabledLivePilotFlags(),
      preferences: null,
      monitoring: null,
    });
  }
}

async function handleSetUserPreferences(
  session: Awaited<ReturnType<typeof readAppSessionFromRequest>>,
  payload: Record<string, unknown>,
) {
  if (!session) return errorResponse("Authentication required.", 401);
  if (getSessionUserKey(session) !== LIVE_PILOT_USERNAME) {
    return errorResponse("Pilot access denied.", 403);
  }

  try {
    const flags = await loadLivePilotFlags();
    if (!flags.preferences && !flags.card_grid) return errorResponse("Pilot preferences are disabled.", 403);
    const preferences = sanitizeLivePilotPreferences(payload.preferences);
    if (!preferences.updatedAt) return errorResponse("A valid updatedAt timestamp is required.", 400);

    const existing = await readLivePilotPreferenceRow();
    if (!existing) {
      const { data, error } = await supabase
        .from("ph_app_user_preferences")
        .insert({
          user_key: LIVE_PILOT_USERNAME,
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

    const latestBeforeUpdate = existing || await readLivePilotPreferenceRow();
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
      .eq("user_key", LIVE_PILOT_USERNAME)
      .lt("updated_at", preferences.updatedAt)
      .select("user_key,theme_mode,display_mode,updated_at,cohort_id")
      .maybeSingle();
    if (updateError) throw updateError;
    const current = updated || await readLivePilotPreferenceRow();
    if (!current) throw new Error("Pilot preference row was not found.");
    return jsonResponse({
      ok: true,
      applied: !!updated,
      preferences: serializeLivePilotPreferenceRow(current),
    });
  } catch (error) {
    console.error("Live pilot preference save failed.", error);
    return errorResponse("Unable to save pilot preferences.", 500);
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
async function handlePasswordChange(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  if (!session) return errorResponse("Unauthorized", 401);
  const newPassword = String(payload.newPassword || "").trim();
  const confirmPassword = String(payload.confirmPassword || "").trim();
  if (!newPassword || newPassword.length < 4) return errorResponse("Password must be at least 4 characters.", 400);
  if (newPassword !== confirmPassword) return errorResponse("Passwords do not match.", 400);
  if (isForcedPasswordValue(newPassword)) return errorResponse("Choose a password other than the shared starter password.", 400);

  const response = await restRequest(
    "ph_app_users",
    "PATCH",
    `username=eq.${encodeURIComponent(session.displayName || session.username)}`,
    { password: newPassword },
  );
  if (!response.ok) {
    return errorResponse("Password update failed.", response.status, { details: await readResponsePayload(response) });
  }

  const nextSession = await createAppSession({
    username: session.displayName || session.username,
    displayName: session.displayName || session.username,
    role: session.role,
    mustChangePassword: false,
  });

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
  if (!session) return errorResponse("Unauthorized", 401);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });

  const table = normalizeTableName(String(payload.table || "").trim());
  const method = String(payload.method || "GET").trim().toUpperCase();
  let body = Object.prototype.hasOwnProperty.call(payload, "body") ? payload.body : null;
  let query = String(payload.query || "").trim();

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return errorResponse("Unsupported method.", 400);
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

async function handlePhotoUpload(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, req: Request) {
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

  const bucketName = PHOTO_BUCKETS[prefix] || PHOTO_BUCKETS.default;
  const requestedFileName = sanitizeStorageFileName(String(form.get("fileName") || file.name || ""));
  const originalName = sanitizeFileName(String(form.get("fileName") || file.name || "photo"));
  const fileName = requestedFileName || `${originalName}-${Date.now()}.jpg`;
  const filePath = `${new Date().toISOString().split("T")[0]}/${fileName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const uploadResult = await supabase.storage.from(bucketName).upload(filePath, bytes, {
    contentType: String(file.type || "image/jpeg").trim() || "image/jpeg",
    cacheControl: "31536000",
    upsert: true,
  });
  if (uploadResult.error) return errorResponse(uploadResult.error.message || "Photo upload failed.", 500);

  const publicUrlData = supabase.storage.from(bucketName).getPublicUrl(filePath);
  const publicUrl = String(publicUrlData.data.publicUrl || "").trim();
  return jsonResponse({ ok: true, publicUrl, bucketName, filePath });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  try {
    ensureServerConfig();
  } catch (error) {
    return errorResponse(String(error instanceof Error ? error.message : error || "Server configuration missing."), 500);
  }

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  const session = await readAppSessionFromRequest(req);

  if (contentType.includes("multipart/form-data")) {
    return await handlePhotoUpload(session, req);
  }

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action || "").trim().toLowerCase();

  if (action === "login") return await handleLogin(payload);
  if (action === "password_change") return await handlePasswordChange(session, payload);
  if (action === "get_user_preferences" || action === "live_pilot_bootstrap") {
    return await handleGetUserPreferences(session);
  }
  if (action === "set_user_preferences" || action === "live_pilot_preferences_save") {
    return await handleSetUserPreferences(session, payload);
  }
  if (action === "db") return await handleDb(session, payload);

  return errorResponse("Unsupported action.", 400);
});
