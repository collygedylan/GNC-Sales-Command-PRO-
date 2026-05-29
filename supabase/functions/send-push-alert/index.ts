import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { getRoleAccessState, normalizeUsername, readAppSessionFromRequest } from "../_shared/app-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gnc-session, x-app-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WEB_PUSH_VAPID_PUBLIC_KEY = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") || "";
const WEB_PUSH_VAPID_PRIVATE_KEY = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") || "";
const WEB_PUSH_VAPID_SUBJECT = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") || "mailto:dylan_collyge@greenleafnursery.com";
const REQUEST_ALERT_USERNAMES = new Set(
  String(Deno.env.get("REQUEST_ALERT_USERNAMES") || "dylan_collyge,jd_jones")
    .split(",")
    .map((value) => normalizeUsername(value))
    .filter(Boolean)
);
const FLYER_ALERT_USERNAMES = new Set(
  String(Deno.env.get("FLYER_ALERT_USERNAMES") || "morgan_anderson,kayla_knepp,dylan_collyge,jd_jones")
    .split(",")
    .map((value) => normalizeUsername(value))
    .filter(Boolean)
);
const PUSH_TABLE = "v2_push_subscriptions";
const PUSH_SEND_CONCURRENCY = Math.max(1, Number(Deno.env.get("PUSH_SEND_CONCURRENCY") || "8") || 8);
const WEB_PUSH_OPTIONS = { TTL: 120, urgency: "high", timeout: 8000 };

if (WEB_PUSH_VAPID_PUBLIC_KEY && WEB_PUSH_VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function normalizeEndpoint(value: unknown) {
  return String(value || "").trim();
}

function normalizePayloadUserList(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",");
  return [...new Set(values.map((entry) => normalizeUsername(String(entry || ""))).filter(Boolean))];
}

function normalizePayloadEndpointList(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",");
  return [...new Set(values.map((entry) => normalizeEndpoint(entry)).filter(Boolean))];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function buildTargetUsers(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "new_request") return [...REQUEST_ALERT_USERNAMES];
  if (eventType === "flyer_created") {
    const assignedUsers = normalizePayloadUserList(payload.assigneeUsernames || payload.targetUsers || payload.recipients || payload.assignedTo || payload.repName);
    return assignedUsers.length ? assignedUsers : [...FLYER_ALERT_USERNAMES];
  }
  if (eventType === "flyer_complete") return [...FLYER_ALERT_USERNAMES];
  if (eventType === "chat_message") {
    return normalizePayloadUserList(payload.recipients || payload.targetUsers || payload.to);
  }
  if (eventType === "walkie_alert") {
    return normalizePayloadUserList(payload.recipients || payload.targetUsers || payload.to);
  }
  if (eventType === "request_complete") {
    const direct = normalizeUsername(String(payload.requestedByUsername || payload.requestedBy || payload.repName || ""));
    return [...new Set([direct, ...REQUEST_ALERT_USERNAMES].filter(Boolean))];
  }
  return [];
}

function buildNotification(eventType: string, payload: Record<string, unknown>) {
  const customer = String(payload.customer || "Unknown Customer").trim();
  const repName = String(payload.repName || payload.requestedBy || "Unknown Rep").trim();
  const folderId = String(payload.folderId || "").trim();
  const folderName = String(payload.folderName || folderId || "Flyer Folder").trim();
  const assignedTo = String(payload.assignedTo || repName || "Unassigned").trim();
  const createdBy = String(payload.createdBy || payload.sentBy || "Someone").trim();
  const itemsCount = Math.max(0, Number(payload.itemsCount) || 0);
  if (eventType === "chat_message") {
    const sender = String(payload.senderDisplayName || payload.sentBy || payload.senderUsername || "New message").trim();
    const chatTitle = String(payload.title || payload.customer || "Chat").trim();
    const bodyPreview = String(payload.bodyPreview || "New chat message").trim();
    const conversationId = String(payload.conversationId || payload.folderId || "").trim();
    const messageId = String(payload.messageId || "").trim();
    return {
      title: sender,
      body: chatTitle && chatTitle !== sender ? `${chatTitle}: ${bodyPreview}` : bodyPreview,
      tag: `chat-${conversationId || "message"}-${messageId || Date.now()}`,
      viewId: "chat",
      conversationId,
      messageId,
      url: "./"
    };
  }
  if (eventType === "walkie_alert") {
    const starter = String(payload.sentBy || payload.createdBy || payload.senderDisplayName || "Walkie").trim();
    const channelTitle = String(payload.title || payload.channelTitle || payload.customer || "Walkie").trim();
    const callId = String(payload.callId || payload.folderId || "").trim();
    const channelId = String(payload.channelId || "").trim();
    const alertKind = String(payload.alertKind || "live").trim().toLowerCase();
    const body = alertKind === "invite"
      ? `${starter} invited you to ${channelTitle}.`
      : `${starter} started live audio in ${channelTitle}.`;
    return {
      title: "Walkie Alert",
      body,
      tag: `walkie-${channelId || "channel"}-${callId || Date.now()}`,
      viewId: "walkie",
      channelId,
      callId,
      url: "./"
    };
  }
  if (eventType === "flyer_created") {
    return {
      title: "Flyer Created",
      body: `${createdBy} created ${folderName}. ${itemsCount} row${itemsCount === 1 ? "" : "s"} assigned to ${assignedTo}.`,
      tag: `flyer-created-${folderName || "folder"}`,
      viewId: "tasks",
      taskView: "flyer",
      folderName,
      url: "./"
    };
  }
  if (eventType === "flyer_complete") {
    return {
      title: "Flyer Complete",
      body: `${folderName} is complete. ${itemsCount} row${itemsCount === 1 ? "" : "s"} have photos and specs.`,
      tag: `flyer-complete-${folderName || "folder"}`,
      viewId: "tasks",
      url: "./"
    };
  }
  if (eventType === "request_complete") {
    return {
      title: "Request Complete",
      body: `${customer} is complete. ${itemsCount} row${itemsCount === 1 ? "" : "s"} finished in ${folderId || "Request"}.`,
      tag: `request-complete-${folderId || "folder"}`,
      viewId: "request",
      url: "./"
    };
  }
  return {
    title: "New Request",
    body: `${repName} submitted ${itemsCount} request row${itemsCount === 1 ? "" : "s"} for ${customer}.`,
    tag: `request-new-${folderId || "folder"}`,
    viewId: "request",
    url: "./"
  };
}

function buildSubscription(row: Record<string, unknown>) {
  const savedJson = row.subscription_json;
  if (savedJson && typeof savedJson === "object") {
    const candidate = savedJson as Record<string, unknown>;
    if (candidate.endpoint && candidate.keys) return candidate;
  }
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth
    }
  };
}

function decodeBase64UrlText(value = "") {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

function getJwtPayload(token = "") {
  const parts = String(token || "").trim().split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(decodeBase64UrlText(parts[1])) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

function isServiceRoleJwt(token = "") {
  const payload = getJwtPayload(token);
  const role = String(payload?.role || "").trim();
  const issuer = String(payload?.iss || "").trim().toLowerCase();
  return role === "service_role" && issuer === "supabase";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WEB_PUSH_VAPID_PUBLIC_KEY || !WEB_PUSH_VAPID_PRIVATE_KEY) {
    return jsonResponse({ error: "Push secrets are not configured." }, 500);
  }

  const authHeader = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const apiKey = String(req.headers.get("apikey") || "").trim();
  const session = await readAppSessionFromRequest(req);
  const sessionAccess = session ? getRoleAccessState(session.role) : null;
  const hasServiceRole = authHeader === SUPABASE_SERVICE_ROLE_KEY || apiKey === SUPABASE_SERVICE_ROLE_KEY || isServiceRoleJwt(authHeader) || isServiceRoleJwt(apiKey);
  const hasAppSession = !!(session && !session.mustChangePassword && sessionAccess);

  if (!hasServiceRole && !hasAppSession) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const eventType = String(payload.eventType || payload.type || "").trim().toLowerCase();
  if (eventType !== "new_request" && eventType !== "request_complete" && eventType !== "flyer_created" && eventType !== "flyer_complete" && eventType !== "chat_message" && eventType !== "walkie_alert") {
    return jsonResponse({ error: "Unsupported event type." }, 400);
  }

  const targetUsers = buildTargetUsers(eventType, payload);
  if (!targetUsers.length) {
    return jsonResponse({ delivered: 0, targets: [] });
  }

  const query = supabase
    .from(PUSH_TABLE)
    .select("id,username,endpoint,p256dh,auth,subscription_json")
    .eq("notifications_enabled", true);

  const { data, error } = await query;
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const targetSet = new Set(targetUsers.map((value) => normalizeUsername(value)).filter(Boolean));
  const excludedEndpoints = new Set(normalizePayloadEndpointList(payload.excludeEndpoints || payload.excludeEndpoint));
  const subscriptions = Array.isArray(data)
    ? data.filter((row) => targetSet.has(normalizeUsername(String(row.username || ""))) && !excludedEndpoints.has(normalizeEndpoint(row.endpoint)))
    : [];
  if (!subscriptions.length) {
    return jsonResponse({ delivered: 0, targets: targetUsers, subscriptions: 0 });
  }

  const notification = buildNotification(eventType, payload);
  const notificationPayload = JSON.stringify(notification);
  const staleIds: number[] = [];
  let delivered = 0;
  const failures: Record<string, unknown>[] = [];

  for (let start = 0; start < subscriptions.length; start += PUSH_SEND_CONCURRENCY) {
    const chunk = subscriptions.slice(start, start + PUSH_SEND_CONCURRENCY);
    await Promise.all(chunk.map(async (row) => {
      try {
        await webpush.sendNotification(buildSubscription(row), notificationPayload, WEB_PUSH_OPTIONS);
        delivered += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(Number(row.id));
        }
        failures.push({ id: row.id, endpoint: row.endpoint, statusCode, message: String((error as Error).message || error) });
      }
    }));
  }

  if (staleIds.length) {
    await supabase.from(PUSH_TABLE).delete().in("id", staleIds);
  }

  return jsonResponse({
    delivered,
    targets: targetUsers,
    subscriptions: subscriptions.length,
    staleRemoved: staleIds.length,
    failures
  });
});
