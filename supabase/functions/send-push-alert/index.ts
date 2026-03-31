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
const PUSH_TABLE = "v2_push_subscriptions";

if (WEB_PUSH_VAPID_PUBLIC_KEY && WEB_PUSH_VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function buildTargetUsers(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "new_request") return [...REQUEST_ALERT_USERNAMES];
  if (eventType === "request_complete") {
    const direct = normalizeUsername(String(payload.requestedByUsername || payload.requestedBy || payload.repName || ""));
    return direct ? [direct] : [];
  }
  return [];
}

function buildNotification(eventType: string, payload: Record<string, unknown>) {
  const customer = String(payload.customer || "Unknown Customer").trim();
  const repName = String(payload.repName || payload.requestedBy || "Unknown Rep").trim();
  const folderId = String(payload.folderId || "").trim();
  const itemsCount = Math.max(0, Number(payload.itemsCount) || 0);
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
  const hasServiceRole = authHeader === SUPABASE_SERVICE_ROLE_KEY || apiKey === SUPABASE_SERVICE_ROLE_KEY;
  const hasAppSession = !!(session && !session.mustChangePassword && sessionAccess && sessionAccess.allowedViews.has("request"));

  if (!hasServiceRole && !hasAppSession) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const eventType = String(payload.eventType || payload.type || "").trim().toLowerCase();
  if (eventType !== "new_request" && eventType !== "request_complete") {
    return jsonResponse({ error: "Unsupported event type." }, 400);
  }

  const targetUsers = buildTargetUsers(eventType, payload);
  if (!targetUsers.length) {
    return jsonResponse({ delivered: 0, targets: [] });
  }

  let query = supabase
    .from(PUSH_TABLE)
    .select("id,username,endpoint,p256dh,auth,subscription_json")
    .in("username", targetUsers)
    .eq("notifications_enabled", true);

  query = eventType === "new_request"
    ? query.eq("wants_new_request", true)
    : query.eq("wants_request_complete", true);

  const { data, error } = await query;
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const subscriptions = Array.isArray(data) ? data : [];
  if (!subscriptions.length) {
    return jsonResponse({ delivered: 0, targets: targetUsers, subscriptions: 0 });
  }

  const notification = buildNotification(eventType, payload);
  const staleIds: number[] = [];
  let delivered = 0;
  const failures: Record<string, unknown>[] = [];

  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(buildSubscription(row), JSON.stringify(notification));
      delivered += 1;
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        staleIds.push(Number(row.id));
      }
      failures.push({ id: row.id, endpoint: row.endpoint, statusCode, message: String((error as Error).message || error) });
    }
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
