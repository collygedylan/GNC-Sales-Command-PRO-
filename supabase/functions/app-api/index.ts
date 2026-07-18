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
const READABLE_TABLES = new Set([
  "v2_master_inventory",
  "v2_active_request_live_rows",
  "v2_crop_roll_drive_rows",
  "v2_crop_roll_open_rows",
  "v2_crop_roll_runs",
  "v2_crop_roll_rows",
  "v2_active_request",
  "v2_request_history",
  "v2_request_email_threads",
  "v2_reserves",
  "v2_soc_master",
  "v2_sales_office",
  "v2_shear_list",
  "v2_take_back_queue",
  "v2_cav",
  "v2_av_notes",
  "v2_dock_team_status",
  "v2_dock_item_status",
  "v2_dock_issue_status",
  "v2_dock_issue_allocations",
  "v2_app_users",
  "v2_app_settings",
  "v2_app_live_events",
  "v2_push_subscriptions",
  "v2_inventory_edit_requests",
  "v2_inventory_edit_request_events",
  "v2_flyer_folder_rows",
  "v2_flyer_folder_history",
  "v2_productivity_history",
  "v2_ncr_completions",
  "v2_production_workflow_rows",
  "v2_spread_counts",
  "v2_bunch_counts",
  "v2_ml_image_jobs",
  "v2_disease_training_assets",
  "v2_diagnostic_lab_cases",
  "v2_grower_scout_reports",
  "v2_grower_scout_assets",
  "marketing_materials",
  "v2_department_calendar_events",
  "v2_chat_conversations",
  "v2_chat_participants",
  "v2_chat_messages",
  "v2_walkie_channels",
  "v2_walkie_channel_members",
  "v2_walkie_calls",
  "v2_walkie_call_members",
  "v2_walkie_signal_events",
  "v2_weather_hourly",
  "v2_weather_daily",
  "v2_hold_learning_events",
  "v2_hold_learning_profiles",
  "v2_hold_release_cycles",
]);
const WRITABLE_TABLES = new Set([
  "v2_master_inventory",
  "v2_soc_master",
  "v2_av_notes",
  "v2_reserves",
  "v2_active_request_live_rows",
  "v2_crop_roll_drive_rows",
  "v2_crop_roll_runs",
  "v2_crop_roll_rows",
  "v2_active_request",
  "v2_request_history",
  "v2_request_email_threads",
  "v2_sales_office",
  "v2_shear_list",
  "v2_take_back_queue",
  "v2_dock_team_status",
  "v2_dock_item_status",
  "v2_dock_issue_status",
  "v2_dock_issue_allocations",
  "v2_labor_hours",
  "v2_app_users",
  "v2_app_settings",
  "v2_app_live_events",
  "v2_push_subscriptions",
  "v2_inventory_edit_requests",
  "v2_inventory_edit_request_events",
  "v2_flyer_folder_rows",
  "v2_flyer_folder_history",
  "v2_productivity_history",
  "v2_ncr_completions",
  "v2_production_workflow_rows",
  "v2_spread_counts",
  "v2_bunch_counts",
  "v2_ml_image_jobs",
  "v2_disease_training_assets",
  "v2_diagnostic_lab_cases",
  "v2_grower_scout_reports",
  "v2_grower_scout_assets",
  "marketing_materials",
  "v2_department_calendar_events",
  "v2_chat_conversations",
  "v2_chat_participants",
  "v2_chat_messages",
  "v2_walkie_channels",
  "v2_walkie_channel_members",
  "v2_walkie_calls",
  "v2_walkie_call_members",
  "v2_walkie_signal_events",
]);
const COMMON_AUTH_WRITE_TABLES = new Set([
  "v2_push_subscriptions",
  "v2_app_live_events",
  "v2_labor_hours",
  "v2_department_calendar_events",
  "v2_chat_conversations",
  "v2_chat_participants",
  "v2_chat_messages",
  "v2_walkie_channels",
  "v2_walkie_channel_members",
  "v2_walkie_calls",
  "v2_walkie_call_members",
  "v2_walkie_signal_events",
]);
const REP_WRITE_TABLES = new Set([
  ...COMMON_AUTH_WRITE_TABLES,
  "v2_active_request",
  "v2_request_history",
  "v2_request_email_threads",
  "v2_sales_office",
  "v2_shear_list",
  "v2_inventory_edit_requests",
  "v2_inventory_edit_request_events",
]);
const QC_WRITE_TABLES = new Set([
  ...COMMON_AUTH_WRITE_TABLES,
  "v2_dock_team_status",
  "v2_dock_item_status",
  "v2_dock_issue_status",
  "v2_dock_issue_allocations",
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

function buildRestHeaders(method = "GET", table = "") {
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (method === "POST") {
    headers.Prefer = table === "v2_active_request" ? "return=minimal" : "return=minimal,resolution=merge-duplicates";
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
  const querySuffix = String(query || "").trim();
  const url = `${SUPABASE_URL}/rest/v1/${table}${querySuffix ? `?${querySuffix}` : ""}`;
  const options: RequestInit = {
    method,
    headers: buildRestHeaders(method, table),
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

function sanitizeStorageFileName(value = "") {
  const raw = String(value || "").trim().split(/[\\/]/).pop() || "";
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "").replace(/\.{2,}/g, ".").slice(0, 140);
  if (cleaned && /\.[a-z0-9]{2,8}$/i.test(cleaned)) return cleaned;
  return "";
}

function hasTableReadAccess(role = "", table = "") {
  if (!READABLE_TABLES.has(table)) return false;
  const access = getRoleAccessState(role);
  if (access.isAdmin) return true;
  if (table === "v2_app_users") return access.isQc || access.isQcSupervisor || access.isAdmin;
  if (access.isRep) {
    return new Set(["v2_master_inventory", "v2_active_request", "v2_reserves", "v2_soc_master", "v2_sales_office", "v2_cav", "v2_av_notes", "v2_dock_team_status", "v2_dock_item_status"]).has(table);
  }
  if (access.isQcSupervisor) {
    return new Set(["v2_master_inventory", "v2_soc_master", "v2_dock_team_status", "v2_dock_item_status"]).has(table);
  }
  if (access.isQc) {
    return new Set(["v2_soc_master", "v2_dock_team_status", "v2_dock_item_status"]).has(table);
  }
  return false;
}

function hasTableWriteAccess(role = "", table = "", method = "POST", body: unknown = null) {
  if (!WRITABLE_TABLES.has(table)) return false;
  const access = getRoleAccessState(role);
  if (access.isAdmin) return true;
  if (COMMON_AUTH_WRITE_TABLES.has(table)) return ["POST", "PATCH", "DELETE"].includes(method);
  if (table === "v2_push_subscriptions") return method === "POST";
  if (table === "v2_labor_hours") return method === "POST";
  if (access.isRep) {
    return REP_WRITE_TABLES.has(table) && ["POST", "PATCH", "DELETE"].includes(method);
  }
  if (access.isQcSupervisor) {
    if (QC_WRITE_TABLES.has(table) && ["POST", "PATCH", "DELETE"].includes(method)) return true;
    if (table === "v2_dock_team_status" && method === "POST") return true;
    if (table === "v2_dock_item_status" && method === "POST") return true;
    if (table === "v2_master_inventory" && method === "PATCH") {
      const payload = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>) : [];
      return payload.length > 0 && payload.every((key) => MASTER_QC_WRITABLE_FIELDS.has(String(key || "").trim().toLowerCase()));
    }
  }
  if (access.isQc) {
    return QC_WRITE_TABLES.has(table) && ["POST", "PATCH", "DELETE"].includes(method);
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

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return errorResponse("Unsupported method.", 400);
  if (method === "GET") {
    if (!hasTableReadAccess(session.role, table)) return errorResponse("Forbidden", 403);
  } else if (!hasTableWriteAccess(session.role, table, method, body)) {
    return errorResponse("Forbidden", 403);
  }

  if (table === "v2_app_users" && method === "GET") {
    query = withSelect(query, "username,role");
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
  if (access.isRep) return errorResponse("REP users cannot upload row photos.", 403);

  const form = await req.formData();
  const prefix = String(form.get("prefix") || "default").trim();
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
  if (action === "db") return await handleDb(session, payload);

  return errorResponse("Unsupported action.", 400);
});
