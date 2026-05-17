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
  "ncr-": "request_photos",
  "dock-": "dock_photos",
  "flyer-": "flyer_photos",
  "marketing-": "marketing_materials",
  "ml-": "ml_capture_photos",
  "chat-voice-": "chat_voice_notes",
  "diagnostic-lab-": "diagnostic_lab_reports",
  "grower-audio-": "grower_scout_audio",
  "grower-photo-": "grower_scout_photos",
  "grower-file-": "grower_scout_files",
  "walkie-voice-": "walkie_voice_notes",
  "outlook-attachment-": "outlook_attachments",
  default: "flyer_photos",
};
const PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_HASH_ITERATIONS = 310000;
const PASSWORD_LOCK_ATTEMPTS = 5;
const PASSWORD_LOCK_MINUTES = 15;
const PASSWORD_ROTATION_DAYS = 30;
const READABLE_TABLES = new Set([
  "v2_master_inventory",
  "v2_active_request",
  "v2_reserves",
  "v2_soc_master",
  "v2_sales_office",
  "v2_cav",
  "v2_cav_import",
  "v2_av_notes",
  "v2_dock_team_status",
  "v2_dock_item_status",
  "v2_dock_issue_status",
  "v2_dock_issue_allocations",
  "v2_app_users",
  "v2_app_live_events",
  "v2_push_subscriptions",
  "v2_request_history",
  "v2_request_email_threads",
  "v2_flyer_folder_rows",
  "v2_flyer_folder_history",
  "v2_ml_image_jobs",
  "v2_disease_training_assets",
  "v2_diagnostic_lab_cases",
  "v2_ncr_completions",
  "v2_take_back_queue",
  "v2_productivity_history",
  "v2_view_av_hot_price_keys",
  "marketing_materials",
  "v2_chat_conversations",
  "v2_chat_participants",
  "v2_chat_messages",
  "v2_walkie_channels",
  "v2_walkie_channel_members",
  "v2_walkie_calls",
  "v2_walkie_call_members",
  "v2_walkie_signal_events",
  "v2_walkie_voice_messages",
  "v2_outlook_accounts",
  "v2_grower_scout_reports",
  "v2_grower_scout_assets",
]);
const WRITABLE_TABLES = new Set([
  "v2_master_inventory",
  "v2_active_request",
  "v2_request_history",
  "v2_request_email_threads",
  "v2_sales_office",
  "v2_dock_team_status",
  "v2_dock_item_status",
  "v2_dock_issue_status",
  "v2_dock_issue_allocations",
  "v2_labor_hours",
  "v2_push_subscriptions",
  "v2_app_live_events",
  "v2_flyer_folder_rows",
  "v2_flyer_folder_history",
  "v2_ml_image_jobs",
  "v2_disease_training_assets",
  "v2_diagnostic_lab_cases",
  "v2_ncr_completions",
  "v2_take_back_queue",
  "v2_productivity_history",
  "marketing_materials",
  "v2_chat_conversations",
  "v2_chat_participants",
  "v2_chat_messages",
  "v2_walkie_channels",
  "v2_walkie_channel_members",
  "v2_walkie_calls",
  "v2_walkie_call_members",
  "v2_walkie_signal_events",
  "v2_walkie_voice_messages",
  "v2_grower_scout_reports",
  "v2_grower_scout_assets",
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

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value = "") {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function generatePasswordSalt() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function timingSafeEqual(left = "", right = "") {
  const leftBytes = new TextEncoder().encode(String(left || ""));
  const rightBytes = new TextEncoder().encode(String(right || ""));
  if (leftBytes.length !== rightBytes.length) return false;
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

async function hashPassword(password = "", salt = generatePasswordSalt()) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: PASSWORD_HASH_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const digest = bytesToBase64Url(new Uint8Array(derivedBits));
  return {
    salt,
    hash: `${PASSWORD_HASH_ALGORITHM}$${PASSWORD_HASH_ITERATIONS}$${salt}$${digest}`,
  };
}

async function verifyPassword(password = "", row: Record<string, unknown>) {
  const savedHash = String(row.password_hash || row.PASSWORD_HASH || "").trim();
  if (savedHash) {
    const parts = savedHash.split("$");
    if (parts.length === 4 && parts[0] === PASSWORD_HASH_ALGORITHM) {
      const salt = String(parts[2] || row.password_salt || "").trim();
      if (!salt) return false;
      const nextHash = await hashPassword(password, salt);
      return timingSafeEqual(nextHash.hash, savedHash);
    }
  }
  const legacyPassword = String(row.password || row.PASSWORD || "").trim();
  return !!legacyPassword && timingSafeEqual(legacyPassword, String(password || "").trim());
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isFutureTimestamp(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return false;
  const parsed = new Date(text);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
}

function isPastOrNowTimestamp(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return false;
  const parsed = new Date(text);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
}

function isUserDisabled(row: Record<string, unknown>) {
  return !!String(row.disabled_at || row.DISABLED_AT || "").trim();
}

function isUserLocked(row: Record<string, unknown>) {
  return isFutureTimestamp(row.locked_until || row.LOCKED_UNTIL || "");
}

function isPasswordChangeRequired(row: Record<string, unknown>, submittedPassword = "") {
  const forcedByFlag = row.must_change_password === true || row.MUST_CHANGE_PASSWORD === true || String(row.must_change_password || row.MUST_CHANGE_PASSWORD || "").toLowerCase() === "true";
  const expiresAt = row.password_expires_at || row.PASSWORD_EXPIRES_AT || "";
  const missingHash = !String(row.password_hash || row.PASSWORD_HASH || "").trim() && !String(row.password || row.PASSWORD || "").trim();
  return forcedByFlag || isPastOrNowTimestamp(expiresAt) || missingHash || isForcedPasswordValue(submittedPassword);
}

async function auditSecurityEvent(username = "", eventType = "", metadata: Record<string, unknown> = {}) {
  try {
    const normalized = normalizeUsername(username);
    await restRequest("v2_security_audit_events", "POST", "", {
      username: normalized || null,
      event_type: String(eventType || "unknown").trim() || "unknown",
      metadata,
    });
  } catch (_error) {
    // Security audit should never block the user-facing workflow.
  }
}

async function patchAppUser(username = "", body: Record<string, unknown>) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const response = await restRequest("v2_app_users", "PATCH", `username=eq.${encodeURIComponent(normalized)}`, body);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(`User update failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function findAppUser(username = "", selectCols = "*") {
  const normalizedInput = normalizeUsername(username);
  if (!normalizedInput) return null;
  const exactResponse = await restRequest(
    "v2_app_users",
    "GET",
    `select=${selectCols}&username=eq.${encodeURIComponent(normalizedInput)}&limit=1`,
  );
  if (!exactResponse.ok) throw new Error(`Login lookup failed: ${JSON.stringify(await readResponsePayload(exactResponse))}`);
  let payloadRows = await readResponsePayload(exactResponse);
  let rows = Array.isArray(payloadRows) ? payloadRows as Record<string, unknown>[] : [];
  if (!rows.length) {
    const fallbackResponse = await restRequest(
      "v2_app_users",
      "GET",
      `select=${selectCols}&username=ilike.${encodeURIComponent(normalizedInput)}&limit=3`,
    );
    if (!fallbackResponse.ok) throw new Error(`Login lookup failed: ${JSON.stringify(await readResponsePayload(fallbackResponse))}`);
    payloadRows = await readResponsePayload(fallbackResponse);
    rows = Array.isArray(payloadRows) ? payloadRows as Record<string, unknown>[] : [];
  }
  return rows.find((row) => normalizeUsername(String(row.username || row.USERNAME || "")) === normalizedInput) || null;
}

async function assertSessionIsCurrent(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>) {
  if (!session) return { ok: false, status: 401, message: "Unauthorized" };
  const row = await findAppUser(
    session.username || session.displayName,
    "username,role,must_change_password,password_expires_at,locked_until,disabled_at,password_changed_at",
  ).catch(() => null);
  if (!row) return { ok: false, status: 401, message: "Unauthorized" };
  if (isUserDisabled(row)) return { ok: false, status: 403, message: "User account is disabled.", code: "ACCOUNT_DISABLED" };
  if (isUserLocked(row)) return { ok: false, status: 423, message: "User account is temporarily locked.", code: "ACCOUNT_LOCKED", lockedUntil: row.locked_until || row.LOCKED_UNTIL || "" };
  if (session.mustChangePassword || isPasswordChangeRequired(row)) {
    return { ok: false, status: 403, message: "Password change required.", code: "PASSWORD_CHANGE_REQUIRED" };
  }
  return { ok: true, row };
}

function buildSessionResponse(session: Awaited<ReturnType<typeof createAppSession>>) {
  return {
    token: session.token,
    username: session.claims.username,
    displayName: session.claims.displayName,
    role: session.claims.role,
    expiresAt: session.claims.exp * 1000,
    mustChangePassword: session.claims.mustChangePassword,
  };
}

function sanitizeFileName(value = "") {
  const trimmed = String(value || "").trim();
  const withoutExt = trimmed.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "photo";
}

function getFileExtension(fileName = "", mimeType = "") {
  const fromName = String(fileName || "").trim().match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const mime = String(mimeType || "").trim().toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "bin";
}

function hasTableReadAccess(role = "", table = "") {
  if (!READABLE_TABLES.has(table)) return false;
  if (table === "v2_security_audit_events" || table === "v2_outlook_accounts") return false;
  const access = getRoleAccessState(role);
  if (access.isAdmin) return true;
  if (table === "v2_grower_scout_reports" || table === "v2_grower_scout_assets") {
    return !!(access.isForeman || access.isGrower);
  }
  if (table === "v2_app_users") return true;
  if (table === "v2_walkie_voice_messages" || table.startsWith("v2_walkie_") || table.startsWith("v2_chat_")) return true;
  if (table === "v2_ml_image_jobs" || table === "v2_diagnostic_lab_cases" || table === "v2_disease_training_assets") return access.isAdmin;
  if (access.isRep) {
    return new Set(["v2_master_inventory", "v2_active_request", "v2_reserves", "v2_soc_master", "v2_sales_office", "v2_cav", "v2_av_notes", "v2_dock_team_status", "v2_dock_item_status"]).has(table);
  }
  if (access.isQcSupervisor) {
    return new Set(["v2_master_inventory", "v2_soc_master", "v2_dock_team_status", "v2_dock_item_status"]).has(table);
  }
  if (access.isQc) {
    return new Set(["v2_soc_master", "v2_dock_team_status", "v2_dock_item_status"]).has(table);
  }
  return true;
}

function hasTableWriteAccess(role = "", table = "", method = "POST", body: unknown = null) {
  if (!WRITABLE_TABLES.has(table)) return false;
  if (table === "v2_outlook_accounts" || table === "v2_security_audit_events" || table === "v2_app_users") return false;
  const access = getRoleAccessState(role);
  if (access.isAdmin) return true;
  if (table === "v2_walkie_voice_messages" || table.startsWith("v2_walkie_") || table.startsWith("v2_chat_")) return true;
  if (table === "v2_ml_image_jobs" || table === "v2_diagnostic_lab_cases" || table === "v2_disease_training_assets") return false;
  if (table === "v2_grower_scout_reports" || table === "v2_grower_scout_assets") {
    return !!(access.isForeman || access.isGrower) && ["POST", "PATCH"].includes(method);
  }
  if (table === "v2_push_subscriptions") return method === "POST";
  if (table === "v2_labor_hours") return method === "POST";
  if (access.isRep) {
    return (
      (table === "v2_active_request" && ["POST", "PATCH", "DELETE"].includes(method)) ||
      (table === "v2_sales_office" && ["POST", "DELETE"].includes(method))
    );
  }
  if (access.isQcSupervisor) {
    if (table === "v2_dock_team_status" && method === "POST") return true;
    if (table === "v2_dock_item_status" && method === "POST") return true;
    if (table === "v2_master_inventory" && method === "PATCH") {
      const payload = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>) : [];
      return payload.length > 0 && payload.every((key) => MASTER_QC_WRITABLE_FIELDS.has(String(key || "").trim().toLowerCase()));
    }
  }
  if (access.isQc) {
    return table === "v2_dock_item_status" && method === "POST";
  }
  return true;
}

async function handleLogin(payload: Record<string, unknown>) {
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "").trim();
  if (!username || !password) return errorResponse("Username and password are required.", 400);

  const selectCols = [
    "username",
    "role",
    "password",
    "password_hash",
    "password_salt",
    "password_changed_at",
    "password_expires_at",
    "must_change_password",
    "failed_login_count",
    "locked_until",
    "disabled_at",
    "last_login_at",
  ].join(",");
  let matchedUser: Record<string, unknown> | null = null;
  try {
    matchedUser = await findAppUser(username, selectCols);
  } catch (error) {
    return errorResponse("Login lookup failed.", 500, { details: String((error as Error).message || error) });
  }

  if (!matchedUser) {
    await auditSecurityEvent(username, "login_failed", { reason: "unknown_user" });
    return jsonResponse({ ok: false, reason: "mismatch" }, 200);
  }

  const dbUsername = String(matchedUser.username || matchedUser.USERNAME || username).trim() || username;
  const normalizedDbUsername = normalizeUsername(dbUsername);
  if (isUserDisabled(matchedUser)) {
    await auditSecurityEvent(normalizedDbUsername, "login_blocked", { reason: "disabled" });
    return jsonResponse({ ok: false, reason: "disabled" }, 200);
  }
  if (isUserLocked(matchedUser)) {
    await auditSecurityEvent(normalizedDbUsername, "login_blocked", { reason: "locked", lockedUntil: matchedUser.locked_until || matchedUser.LOCKED_UNTIL || "" });
    return jsonResponse({ ok: false, reason: "locked", lockedUntil: matchedUser.locked_until || matchedUser.LOCKED_UNTIL || "" }, 200);
  }

  const passwordMatches = await verifyPassword(password, matchedUser);
  if (!passwordMatches) {
    const failedCount = Math.max(0, Number(matchedUser.failed_login_count || matchedUser.FAILED_LOGIN_COUNT || 0) || 0) + 1;
    const lockBody: Record<string, unknown> = { failed_login_count: failedCount };
    if (failedCount >= PASSWORD_LOCK_ATTEMPTS) {
      lockBody.locked_until = new Date(Date.now() + PASSWORD_LOCK_MINUTES * 60 * 1000).toISOString();
    }
    await patchAppUser(normalizedDbUsername, lockBody).catch(() => null);
    await auditSecurityEvent(normalizedDbUsername, failedCount >= PASSWORD_LOCK_ATTEMPTS ? "login_lockout" : "login_failed", { failedLoginCount: failedCount });
    return jsonResponse({ ok: false, reason: failedCount >= PASSWORD_LOCK_ATTEMPTS ? "locked" : "mismatch", lockedUntil: lockBody.locked_until || null }, 200);
  }

  const role = String(matchedUser.role || matchedUser.ROLE || "User").trim() || "User";
  const now = new Date();
  let passwordChangedAt = String(matchedUser.password_changed_at || matchedUser.PASSWORD_CHANGED_AT || "").trim();
  const mustChangePassword = isPasswordChangeRequired(matchedUser, password);
  const loginPatch: Record<string, unknown> = {
    failed_login_count: 0,
    locked_until: null,
    last_login_at: now.toISOString(),
  };
  if (!String(matchedUser.password_hash || matchedUser.PASSWORD_HASH || "").trim() && !mustChangePassword) {
    const nextPassword = await hashPassword(password);
    passwordChangedAt = now.toISOString();
    loginPatch.password = null;
    loginPatch.password_hash = nextPassword.hash;
    loginPatch.password_salt = nextPassword.salt;
    loginPatch.password_changed_at = passwordChangedAt;
    loginPatch.password_expires_at = addDays(now, PASSWORD_ROTATION_DAYS).toISOString();
    loginPatch.must_change_password = false;
  }
  await patchAppUser(normalizedDbUsername, loginPatch).catch(() => null);
  await auditSecurityEvent(normalizedDbUsername, "login_success", { passwordChangeRequired: mustChangePassword });
  const session = await createAppSession({
    username: dbUsername,
    displayName: dbUsername,
    role,
    mustChangePassword,
    passwordChangedAt,
  });

  return jsonResponse({
    ok: true,
    user: { username: dbUsername, role },
    session: buildSessionResponse(session),
  });
}
async function handlePasswordChange(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  if (!session) return errorResponse("Unauthorized", 401);
  const newPassword = String(payload.newPassword || "").trim();
  const confirmPassword = String(payload.confirmPassword || "").trim();
  if (!newPassword || newPassword.length < 8) return errorResponse("Password must be at least 8 characters.", 400);
  if (newPassword !== confirmPassword) return errorResponse("Passwords do not match.", 400);
  if (isForcedPasswordValue(newPassword)) return errorResponse("Choose a password other than the shared starter password.", 400);

  const securityRow = await findAppUser(session.username || session.displayName, "username,role,password,password_hash,password_salt");
  if (!securityRow) return errorResponse("Unauthorized", 401);
  if (await verifyPassword(newPassword, securityRow)) return errorResponse("Choose a password you have not already used.", 400);
  const now = new Date();
  const nextPassword = await hashPassword(newPassword);
  const dbUsername = String(securityRow.username || session.username || session.displayName || "").trim();
  await patchAppUser(dbUsername, {
    password: null,
    password_hash: nextPassword.hash,
    password_salt: nextPassword.salt,
    password_changed_at: now.toISOString(),
    password_expires_at: addDays(now, PASSWORD_ROTATION_DAYS).toISOString(),
    must_change_password: false,
    failed_login_count: 0,
    locked_until: null,
  });
  await auditSecurityEvent(dbUsername, "password_changed", { rotationDays: PASSWORD_ROTATION_DAYS });

  const nextSession = await createAppSession({
    username: dbUsername || session.username,
    displayName: session.displayName || dbUsername || session.username,
    role: String(securityRow.role || securityRow.ROLE || session.role || "User").trim() || "User",
    mustChangePassword: false,
    passwordChangedAt: now.toISOString(),
  });

  return jsonResponse({
    ok: true,
    session: buildSessionResponse(nextSession),
  });
}

async function handleDb(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  const sessionState = await assertSessionIsCurrent(session);
  if (!sessionState.ok) {
    const sessionIssue = sessionState as Record<string, unknown>;
    return errorResponse(String(sessionIssue.message || "Unauthorized"), Number(sessionIssue.status || 401), { code: sessionIssue.code, lockedUntil: sessionIssue.lockedUntil });
  }

  const table = String(payload.table || "").trim();
  const method = String(payload.method || "GET").trim().toUpperCase();
  const body = Object.prototype.hasOwnProperty.call(payload, "body") ? payload.body : null;
  let query = String(payload.query || "").trim();

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return errorResponse("Unsupported method.", 400);
  if (method === "GET") {
    if (!hasTableReadAccess(session!.role, table)) return errorResponse("Forbidden", 403);
  } else if (!hasTableWriteAccess(session!.role, table, method, body)) {
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
  const sessionState = await assertSessionIsCurrent(session);
  if (!sessionState.ok) {
    const sessionIssue = sessionState as Record<string, unknown>;
    return errorResponse(String(sessionIssue.message || "Unauthorized"), Number(sessionIssue.status || 401), { code: sessionIssue.code, lockedUntil: sessionIssue.lockedUntil });
  }
  const access = getRoleAccessState(session!.role);
  if (access.isRep) return errorResponse("REP users cannot upload row photos.", 403);

  const form = await req.formData();
  const prefix = String(form.get("prefix") || "default").trim();
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("No photo file was provided.", 400);

  const bucketName = PHOTO_BUCKETS[prefix] || PHOTO_BUCKETS.default;
  const submittedName = String(form.get("fileName") || file.name || "upload").trim();
  const originalName = sanitizeFileName(submittedName);
  const extension = getFileExtension(submittedName || file.name || "", String(file.type || ""));
  const fileName = `${originalName}-${Date.now()}.${extension}`;
  const requestedPath = String(form.get("filePath") || "").trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  const filePath = requestedPath && !requestedPath.includes("..")
    ? requestedPath.replace(/[^a-zA-Z0-9_./=-]+/g, "-").slice(0, 240)
    : `${new Date().toISOString().split("T")[0]}/${fileName}`;
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
