import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createAppSession, getRoleAccessState, isForcedPasswordValue, normalizeUsername, readAppSessionFromRequest } from "../_shared/app-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gnc-session, x-app-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const PHOTO_BUCKETS: Record<string, string> = {
  "ssn-": "season_sales_notes_photos",
  "lsn-": "location_sales_notes_photos",
  "req-": "request_photos",
  "dock-": "dock_photos",
  "flyer-": "flyer_photos",
  default: "flyer_photos",
};
const SITE_CODES = new Set(["PH", "TX", "NC", "HL"]);
const SITE_TABLE_BASE_BY_LEGACY: Record<string, string> = {
  v2_master_inventory: "master_inventory",
  v2_active_request: "active_request",
  v2_request_history: "request_history",
  v2_reserves: "reserves",
  v2_soc_master: "soc_master",
  v2_cav_import: "cav_import",
  v2_view_av_hot_price_keys: "view_av_hot_price_keys",
  v2_av_notes: "av_notes",
  v2_labor_hours: "labor_hours",
  v2_sales_office: "sales_office",
  v2_flyer_folder_rows: "flyer_folder_rows",
  v2_flyer_folder_history: "flyer_folder_history",
  v2_ncr_completions: "ncr_completions",
  v2_take_back_queue: "take_back_queue",
  v2_productivity_history: "productivity_history",
  v2_ml_image_jobs: "ml_image_jobs",
  v2_diagnostic_lab_cases: "diagnostic_lab_cases",
  v2_diagnostic_reference_reports: "diagnostic_reference_reports",
  v2_diagnostic_review_feedback: "diagnostic_review_feedback",
  v2_disease_training_assets: "disease_training_assets",
  v2_grower_scout_reports: "grower_scout_reports",
  v2_grower_scout_assets: "grower_scout_assets",
  v2_shear_list: "shear_list",
  v2_production_workflow_rows: "production_workflow_rows",
  v2_spread_counts: "spread_counts",
  v2_bunch_counts: "bunch_counts",
  v2_dock_team_status: "dock_team_status",
  v2_dock_item_status: "dock_item_status",
  v2_dock_issue_status: "dock_issue_status",
  v2_dock_issue_allocations: "dock_issue_allocations",
  v2_drive_around_report_files: "drive_around_report_files",
  v2_drive_around_report_rows: "drive_around_report_rows",
  v2_weather_hourly: "weather_hourly",
  v2_weather_daily: "weather_daily",
  v2_hold_learning_events: "hold_learning_events",
  v2_hold_release_cycles: "hold_release_cycles",
  v2_hold_learning_profiles: "hold_learning_profiles",
};
const LEGACY_BY_SITE_TABLE_BASE = Object.fromEntries(Object.entries(SITE_TABLE_BASE_BY_LEGACY).map(([legacy, base]) => [base, legacy]));
const SITE_SCOPED_BUCKETS = new Set([
  "season_sales_notes_photos",
  "location_sales_notes_photos",
  "request_photos",
  "dock_photos",
  "flyer_photos",
  "marketing_materials",
  "ml_capture_photos",
  "diagnostic_lab_reports",
  "disease_training_assets",
  "grower_scout_audio",
  "grower_scout_photos",
  "grower_scout_files",
]);
const READABLE_TABLES = new Set([
  "v2_master_inventory",
  "v2_active_request",
  "v2_reserves",
  "v2_soc_master",
  "v2_sales_office",
  "v2_cav_import",
  "v2_view_av_hot_price_keys",
  "v2_av_notes",
  "v2_labor_hours",
  "v2_dock_team_status",
  "v2_dock_item_status",
  "v2_app_users",
  "v2_push_subscriptions",
]);
const WRITABLE_TABLES = new Set([
  "v2_master_inventory",
  "v2_active_request",
  "v2_sales_office",
  "v2_dock_team_status",
  "v2_dock_item_status",
  "v2_labor_hours",
  "v2_push_subscriptions",
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

function buildRestHeaders(method = "GET") {
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (method === "POST") {
    headers.Prefer = "return=representation,resolution=merge-duplicates";
  } else if (method === "PATCH" || method === "DELETE") {
    headers.Prefer = "return=representation";
  }
  return headers;
}

function withSelect(query = "", selectValue = "*") {
  const params = new URLSearchParams(String(query || ""));
  params.set("select", selectValue);
  return params.toString();
}

function normalizeSiteCode(siteCode = "") {
  const safe = String(siteCode || "").trim().toUpperCase();
  return SITE_CODES.has(safe) ? safe : "PH";
}

function envSiteTablesEnabled() {
  return /^(1|true|yes)$/i.test(String(Deno.env.get("GNC_SITE_TABLES_ENABLED") || ""));
}

function envSiteBucketsEnabled() {
  return /^(1|true|yes)$/i.test(String(Deno.env.get("GNC_SITE_BUCKETS_ENABLED") || Deno.env.get("GNC_SITE_TABLES_ENABLED") || ""));
}

async function readSiteRuntimeFlag(flagName: string, envEnabled = false) {
  if (envEnabled) return true;
  const { data, error } = await supabase
    .from("app_site_runtime_flags")
    .select("enabled")
    .eq("key", flagName)
    .maybeSingle();
  if (error) {
    console.warn("site runtime flag lookup failed", { flagName, error: error.message });
    return false;
  }
  return data?.enabled === true;
}

function getSiteTableBaseName(table = "") {
  const safe = String(table || "").trim().toLowerCase();
  if (SITE_TABLE_BASE_BY_LEGACY[safe]) return SITE_TABLE_BASE_BY_LEGACY[safe];
  const match = safe.match(/^(ph|tx|nc|hl)_(.+)$/);
  return match && LEGACY_BY_SITE_TABLE_BASE[match[2]] ? match[2] : "";
}

function getLegacyTableName(table = "") {
  const safe = String(table || "").trim().toLowerCase();
  if (SITE_TABLE_BASE_BY_LEGACY[safe]) return safe;
  const base = getSiteTableBaseName(safe);
  return base ? String(LEGACY_BY_SITE_TABLE_BASE[base] || safe) : safe;
}

function resolveSiteTable(table = "", siteCode = "", enabled = envSiteTablesEnabled()) {
  const safe = String(table || "").trim();
  const safeLower = safe.toLowerCase();
  const base = getSiteTableBaseName(safeLower);
  if (!base || /^(ph|tx|nc|hl)_/.test(safeLower)) return safe;
  if (!enabled) return safe;
  return `${normalizeSiteCode(siteCode).toLowerCase()}_${base}`;
}

function resolveSiteBucket(bucket = "", siteCode = "", enabled = envSiteBucketsEnabled()) {
  const safe = String(bucket || "").trim();
  if (!safe || !SITE_SCOPED_BUCKETS.has(safe) || !enabled) return safe;
  return `${normalizeSiteCode(siteCode).toLowerCase()}_${safe}`;
}

async function restRequest(table: string, method = "GET", query = "", body: unknown = null) {
  const querySuffix = String(query || "").trim();
  const url = `${SUPABASE_URL}/rest/v1/${table}${querySuffix ? `?${querySuffix}` : ""}`;
  const options: RequestInit = {
    method,
    headers: buildRestHeaders(method),
  };
  if (body !== null && body !== undefined && method !== "GET") {
    options.body = JSON.stringify(body);
  }
  return await fetch(url, options);
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

function hasTableReadAccess(role = "", table = "", username = "") {
  const logicalTable = getLegacyTableName(table);
  if (!READABLE_TABLES.has(logicalTable)) return false;
  const access = getRoleAccessState(role, username);
  if (access.isAdmin) return true;
  if (logicalTable === "v2_app_users") return access.isQc || access.isQcSupervisor || access.isAdmin;
  if (access.isRep) {
    return new Set(["v2_master_inventory", "v2_active_request", "v2_reserves", "v2_soc_master", "v2_sales_office", "v2_cav_import", "v2_view_av_hot_price_keys", "v2_av_notes", "v2_dock_team_status", "v2_dock_item_status"]).has(logicalTable);
  }
  if (access.isEval) {
    return new Set(["v2_master_inventory", "v2_active_request", "v2_soc_master", "v2_sales_office", "v2_cav_import", "v2_view_av_hot_price_keys", "v2_av_notes", "v2_dock_team_status", "v2_dock_item_status", "v2_push_subscriptions"]).has(logicalTable);
  }
  if (access.isQcSupervisor) {
    return new Set(["v2_master_inventory", "v2_soc_master", "v2_dock_team_status", "v2_dock_item_status"]).has(logicalTable);
  }
  if (access.isQc) {
    return new Set(["v2_soc_master", "v2_dock_team_status", "v2_dock_item_status"]).has(logicalTable);
  }
  return false;
}

function hasTableWriteAccess(role = "", table = "", method = "POST", body: unknown = null, username = "") {
  const logicalTable = getLegacyTableName(table);
  if (!WRITABLE_TABLES.has(logicalTable)) return false;
  const access = getRoleAccessState(role, username);
  if (access.isAdmin) return true;
  if (logicalTable === "v2_push_subscriptions") return method === "POST";
  if (logicalTable === "v2_labor_hours") return method === "POST";
  if (access.isRep) {
    return (
      (logicalTable === "v2_active_request" && ["POST", "PATCH", "DELETE"].includes(method)) ||
      (logicalTable === "v2_sales_office" && ["POST", "DELETE"].includes(method))
    );
  }
  if (access.isEval) {
    return (
      (logicalTable === "v2_master_inventory" && method === "PATCH") ||
      (logicalTable === "v2_active_request" && ["POST", "PATCH", "DELETE"].includes(method)) ||
      (logicalTable === "v2_sales_office" && ["POST", "PATCH", "DELETE"].includes(method)) ||
      (logicalTable === "v2_dock_team_status" && method === "POST") ||
      (logicalTable === "v2_dock_item_status" && method === "POST")
    );
  }
  if (access.isQcSupervisor) {
    if (logicalTable === "v2_dock_team_status" && method === "POST") return true;
    if (logicalTable === "v2_dock_item_status" && method === "POST") return true;
    if (logicalTable === "v2_master_inventory" && method === "PATCH") {
      const payload = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>) : [];
      return payload.length > 0 && payload.every((key) => MASTER_QC_WRITABLE_FIELDS.has(String(key || "").trim().toLowerCase()));
    }
  }
  if (access.isQc) {
    return logicalTable === "v2_dock_item_status" && method === "POST";
  }
  return false;
}

async function handleLogin(payload: Record<string, unknown>) {
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "").trim();
  if (!username || !password) return errorResponse("Username and password are required.", 400);

  const selectCols = "username,role,password";
  const normalizedInput = normalizeUsername(username);
  const exactResponse = await restRequest(
    "v2_app_users",
    "GET",
    `select=${selectCols}&username=eq.${encodeURIComponent(normalizedInput)}&limit=1`,
  );
  if (!exactResponse.ok) return errorResponse("Login lookup failed.", exactResponse.status, { details: await readResponsePayload(exactResponse) });
  let payloadRows = await readResponsePayload(exactResponse);
  let rows = Array.isArray(payloadRows) ? payloadRows as Record<string, unknown>[] : [];
  if (!rows.length && normalizedInput) {
    const fallbackResponse = await restRequest(
      "v2_app_users",
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
    return dbPassword === password && normalizeUsername(dbUsername) === normalizedInput;
  }) || null;

  if (!matchedUser) return jsonResponse({ ok: false, reason: "mismatch" }, 200);

  const dbUsername = String(matchedUser.username || matchedUser.USERNAME || username).trim() || username;
  const role = String(matchedUser.role || matchedUser.ROLE || "User").trim() || "User";
  const mustChangePassword = isForcedPasswordValue(password);
  const session = await createAppSession({
    username: dbUsername,
    displayName: dbUsername,
    role,
    mustChangePassword,
  });

  return jsonResponse({
    ok: true,
    user: { username: dbUsername, role },
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
    "v2_app_users",
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

  const table = String(payload.table || "").trim();
  const method = String(payload.method || "GET").trim().toUpperCase();
  const body = Object.prototype.hasOwnProperty.call(payload, "body") ? payload.body : null;
  let query = String(payload.query || "").trim();
  const siteCode = normalizeSiteCode(String(payload.siteCode || payload.site_code || ""));
  const siteTablesAreEnabled = await readSiteRuntimeFlag("site_tables_enabled", envSiteTablesEnabled());
  const physicalTable = resolveSiteTable(table, siteCode, siteTablesAreEnabled);
  const logicalTable = getLegacyTableName(table);

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return errorResponse("Unsupported method.", 400);
  if (method === "GET") {
    if (!hasTableReadAccess(session.role, table, session.username)) return errorResponse("Forbidden", 403);
  } else if (!hasTableWriteAccess(session.role, table, method, body, session.username)) {
    return errorResponse("Forbidden", 403);
  }

  if (logicalTable === "v2_app_users" && method === "GET") {
    query = withSelect(query, "username,role");
  }

  const response = await restRequest(physicalTable, method, query, body);
  const responsePayload = await readResponsePayload(response);
  if (!response.ok) {
    return errorResponse("Database request failed.", response.status, { details: responsePayload });
  }
  return jsonResponse({ ok: true, data: responsePayload });
}

async function handlePhotoUpload(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, req: Request) {
  if (!session) return errorResponse("Unauthorized", 401);
  const access = getRoleAccessState(session.role, session.username);
  if (session.mustChangePassword) return errorResponse("Password change required.", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  if (access.isRep) return errorResponse("REP users cannot upload row photos.", 403);

  const form = await req.formData();
  const prefix = String(form.get("prefix") || "default").trim();
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("No photo file was provided.", 400);

  const siteCode = normalizeSiteCode(String(form.get("siteCode") || form.get("site_code") || ""));
  const siteBucketsAreEnabled = await readSiteRuntimeFlag("site_buckets_enabled", envSiteBucketsEnabled());
  const siteTablesAreEnabled = siteBucketsAreEnabled || await readSiteRuntimeFlag("site_tables_enabled", envSiteTablesEnabled());
  const bucketName = resolveSiteBucket(PHOTO_BUCKETS[prefix] || PHOTO_BUCKETS.default, siteCode, siteTablesAreEnabled);
  const originalName = sanitizeFileName(String(form.get("fileName") || file.name || "photo"));
  const fileName = `${originalName}-${Date.now()}.jpg`;
  const filePath = `${new Date().toISOString().split("T")[0]}/${fileName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const uploadResult = await supabase.storage.from(bucketName).upload(filePath, bytes, {
    contentType: String(file.type || "image/jpeg").trim() || "image/jpeg",
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
  if (action === "db") return await handleDb(session, payload);

  return errorResponse("Unsupported action.", 400);
});
