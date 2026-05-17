import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeUsername, readAppSessionFromRequest } from "../_shared/app-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gnc-session, x-app-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const MICROSOFT_CLIENT_ID = String(Deno.env.get("MICROSOFT_CLIENT_ID") || "").trim();
const MICROSOFT_CLIENT_SECRET = String(Deno.env.get("MICROSOFT_CLIENT_SECRET") || "").trim();
const MICROSOFT_REDIRECT_URI = String(Deno.env.get("MICROSOFT_REDIRECT_URI") || "").trim();
const OUTLOOK_TOKEN_ENCRYPTION_KEY = String(Deno.env.get("OUTLOOK_TOKEN_ENCRYPTION_KEY") || Deno.env.get("APP_SESSION_SECRET") || "").trim();
const TENANT = String(Deno.env.get("MICROSOFT_TENANT_ID") || "common").trim() || "common";
const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const OUTLOOK_SCOPES = "openid profile offline_access User.Read Mail.ReadWrite Mail.Send";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function errorResponse(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, ...extra }, status);
}

function ensureConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase Edge Function secrets are missing.");
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_REDIRECT_URI) {
    throw new Error("Microsoft Outlook OAuth secrets are missing.");
  }
  if (!OUTLOOK_TOKEN_ENCRYPTION_KEY) throw new Error("OUTLOOK_TOKEN_ENCRYPTION_KEY is missing.");
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
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function importHmacKey() {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(OUTLOOK_TOKEN_ENCRYPTION_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signValue(value = "") {
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(), new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function buildState(username = "") {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    username: normalizeUsername(username),
    issuedAt: Date.now(),
    nonce: crypto.randomUUID(),
  })));
  return `${payload}.${await signValue(payload)}`;
}

async function readStateUsername(state = "") {
  const [payload, signature] = String(state || "").trim().split(".");
  if (!payload || !signature) return "";
  if (signature !== await signValue(payload)) return "";
  const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as Record<string, unknown>;
  const issuedAt = Number(decoded.issuedAt || 0);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 15 * 60 * 1000) return "";
  return normalizeUsername(String(decoded.username || ""));
}

async function importAesKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(OUTLOOK_TOKEN_ENCRYPTION_KEY));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptToken(token = "") {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importAesKey(),
    new TextEncoder().encode(token),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptToken(ciphertext = "", ivValue = "") {
  if (!ciphertext || !ivValue) return "";
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivValue) },
    await importAesKey(),
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

async function audit(username = "", eventType = "", metadata: Record<string, unknown> = {}) {
  try {
    await supabase.from("v2_security_audit_events").insert({
      username: normalizeUsername(username) || null,
      event_type: eventType,
      metadata,
    });
  } catch (_error) {
    // Outlook auditing should not block mail access.
  }
}

async function getAccount(username = "") {
  const normalized = normalizeUsername(username);
  const { data, error } = await supabase
    .from("v2_outlook_accounts")
    .select("*")
    .eq("username", normalized)
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

async function exchangeToken(params: Record<string, string>) {
  const body = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    client_secret: MICROSOFT_CLIENT_SECRET,
    redirect_uri: MICROSOFT_REDIRECT_URI,
    ...params,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error_description || payload.error || "Microsoft token exchange failed."));
  return payload as Record<string, unknown>;
}

async function graphRequest(accessToken = "", path = "", init: RequestInit = {}) {
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || `Microsoft Graph request failed (${response.status}).`));
  return payload;
}

async function getAccessTokenForUser(username = "") {
  const account = await getAccount(username);
  if (!account) throw new Error("Outlook is not connected for this user.");
  const expiresAt = new Date(String(account.access_token_expires_at || ""));
  if (String(account.access_token_ciphertext || "") && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now() + 90_000) {
    return await decryptToken(String(account.access_token_ciphertext || ""), String(account.access_token_iv || ""));
  }
  const refreshToken = await decryptToken(String(account.refresh_token_ciphertext || ""), String(account.refresh_token_iv || ""));
  if (!refreshToken) throw new Error("Outlook refresh token is missing.");
  const tokenPayload = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: OUTLOOK_SCOPES,
  });
  const access = String(tokenPayload.access_token || "");
  const refreshed = tokenPayload.refresh_token ? String(tokenPayload.refresh_token || "") : refreshToken;
  const accessCipher = await encryptToken(access);
  const refreshCipher = await encryptToken(refreshed);
  const expiresIn = Math.max(300, Number(tokenPayload.expires_in || 3600) || 3600);
  await supabase.from("v2_outlook_accounts").upsert({
    username: normalizeUsername(username),
    refresh_token_ciphertext: refreshCipher.ciphertext,
    refresh_token_iv: refreshCipher.iv,
    access_token_ciphertext: accessCipher.ciphertext,
    access_token_iv: accessCipher.iv,
    access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    last_refresh_at: new Date().toISOString(),
    status: "connected",
  }, { onConflict: "username" });
  return access;
}

async function handleStartAuth(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>) {
  if (!session || session.mustChangePassword) return errorResponse("Unauthorized", 401);
  const state = await buildState(session.username || session.displayName);
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: MICROSOFT_REDIRECT_URI,
    response_mode: "query",
    scope: OUTLOOK_SCOPES,
    state,
    prompt: "select_account",
  });
  return jsonResponse({ ok: true, authUrl: `${AUTH_URL}?${params.toString()}` });
}

async function saveOAuthCallback(code = "", state = "") {
  const username = await readStateUsername(state);
  if (!username) return htmlResponse("<h2>Outlook connection failed</h2><p>The sign-in state was invalid or expired.</p>", 400);
  const tokenPayload = await exchangeToken({
    grant_type: "authorization_code",
    code,
    scope: OUTLOOK_SCOPES,
  });
  const accessToken = String(tokenPayload.access_token || "");
  const refreshToken = String(tokenPayload.refresh_token || "");
  const profile = await graphRequest(accessToken, "/me?$select=id,displayName,mail,userPrincipalName");
  const accessCipher = await encryptToken(accessToken);
  const refreshCipher = await encryptToken(refreshToken);
  const expiresIn = Math.max(300, Number(tokenPayload.expires_in || 3600) || 3600);
  const email = String(profile.mail || profile.userPrincipalName || "").trim();
  await supabase.from("v2_outlook_accounts").upsert({
    username,
    microsoft_user_id: String(profile.id || ""),
    email,
    display_name: String(profile.displayName || email || username),
    scopes: String(tokenPayload.scope || OUTLOOK_SCOPES).split(/\s+/).filter(Boolean),
    refresh_token_ciphertext: refreshCipher.ciphertext,
    refresh_token_iv: refreshCipher.iv,
    access_token_ciphertext: accessCipher.ciphertext,
    access_token_iv: accessCipher.iv,
    access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    status: "connected",
  }, { onConflict: "username" });
  await audit(username, "outlook_connect", { email });
  return htmlResponse("<h2>Outlook connected</h2><p>You can close this tab and return to GNC.</p>");
}

async function handleList(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  if (!session || session.mustChangePassword) return errorResponse("Unauthorized", 401);
  const top = Math.min(50, Math.max(1, Number(payload.top || 20) || 20));
  const folder = encodeURIComponent(String(payload.folder || "inbox").trim() || "inbox");
  const accessToken = await getAccessTokenForUser(session.username);
  const data = await graphRequest(accessToken, `/me/mailFolders/${folder}/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,conversationId,hasAttachments`);
  return jsonResponse({ ok: true, messages: Array.isArray(data.value) ? data.value : [] });
}

async function handleRead(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  if (!session || session.mustChangePassword) return errorResponse("Unauthorized", 401);
  const messageId = String(payload.messageId || "").trim();
  if (!messageId) return errorResponse("messageId is required.", 400);
  const accessToken = await getAccessTokenForUser(session.username);
  const data = await graphRequest(accessToken, `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,body,bodyPreview,conversationId,hasAttachments`);
  return jsonResponse({ ok: true, message: data });
}

async function handleReply(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  if (!session || session.mustChangePassword) return errorResponse("Unauthorized", 401);
  const messageId = String(payload.messageId || "").trim();
  const comment = String(payload.comment || payload.body || "").trim();
  if (!messageId || !comment) return errorResponse("messageId and comment are required.", 400);
  const accessToken = await getAccessTokenForUser(session.username);
  await graphRequest(accessToken, `/me/messages/${encodeURIComponent(messageId)}/reply`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
  return jsonResponse({ ok: true });
}

async function handleSend(session: Awaited<ReturnType<typeof readAppSessionFromRequest>>, payload: Record<string, unknown>) {
  if (!session || session.mustChangePassword) return errorResponse("Unauthorized", 401);
  const to = Array.isArray(payload.to) ? payload.to.map((value) => String(value || "").trim()).filter(Boolean) : String(payload.to || "").split(",").map((value) => value.trim()).filter(Boolean);
  const subject = String(payload.subject || "").trim();
  const body = String(payload.body || "").trim();
  if (!to.length || !subject || !body) return errorResponse("to, subject, and body are required.", 400);
  const accessToken = await getAccessTokenForUser(session.username);
  await graphRequest(accessToken, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: body },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  return jsonResponse({ ok: true });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    ensureConfig();
  } catch (error) {
    return errorResponse(String((error as Error).message || error), 500);
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = String(url.searchParams.get("code") || "");
    const state = String(url.searchParams.get("state") || "");
    if (code && state) {
      try {
        return await saveOAuthCallback(code, state);
      } catch (error) {
        return htmlResponse(`<h2>Outlook connection failed</h2><p>${String((error as Error).message || error)}</p>`, 500);
      }
    }
    return errorResponse("Unsupported GET request.", 400);
  }

  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);
  const session = await readAppSessionFromRequest(req);
  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action || "").trim().toLowerCase();
  try {
    if (action === "start_auth") return await handleStartAuth(session);
    if (action === "list_messages") return await handleList(session, payload);
    if (action === "read_message") return await handleRead(session, payload);
    if (action === "reply_message") return await handleReply(session, payload);
    if (action === "send_message") return await handleSend(session, payload);
    return errorResponse("Unsupported action.", 400);
  } catch (error) {
    return errorResponse(String((error as Error).message || error), 500);
  }
});
