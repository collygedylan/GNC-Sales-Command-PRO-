import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObservedRequest } from "../_shared/observability.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import webpush from "npm:web-push@3.6.7";
import { getRoleAccessState, normalizeUsername, readSupabaseOrAppSessionFromRequest } from "../_shared/app-auth.ts";
import { resolveOperationalRecipients } from "../_shared/operational-routing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gnc-session, x-app-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "private, no-store"
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WEB_PUSH_VAPID_PUBLIC_KEY = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") || "";
const WEB_PUSH_VAPID_PRIVATE_KEY = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") || "";
const WEB_PUSH_VAPID_SUBJECT = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") || "mailto:dylan_collyge@greenleafnursery.com";
const REQUEST_ALERT_USERNAMES = new Set(
  String(Deno.env.get("REQUEST_ALERT_USERNAMES") || "kayla_knepp,dylan_collyge,jd_jones")
    .split(",")
    .map((value) => normalizeUsername(value))
    .filter(Boolean)
);
const EVAL_ASSIGNMENT_MANAGER_USERNAMES = new Set(
  String(Deno.env.get("EVAL_ASSIGNMENT_MANAGER_USERNAMES") || "dylan_collyge,megan_kelly")
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
const PUSH_TABLE = "ph_push_subscriptions";
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
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" }
  });
}

function buildTargetUsers(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "suspend_tag_approval_requested") return normalizePayloadUserList(payload.repUsername);
  if (eventType === "scheduled_handover_complete" || eventType === "scheduled_handover_failed") return ["dylan_collyge"];
  if (eventType.startsWith("codex_ops_")) return ["dylan_collyge"];
  if (eventType === "hr_calendar_reminder") return ["dylan_collyge"];
  if (eventType === "new_request") return [...REQUEST_ALERT_USERNAMES];
  if (eventType === "eval_assignment_unassigned" || eventType === "eval_assignment_summary") {
    const direct = normalizePayloadUserList(payload.managerUsernames || payload.manager_usernames || payload.targetUsers);
    return direct.length ? direct : [...EVAL_ASSIGNMENT_MANAGER_USERNAMES];
  }
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
  if (eventType === "department_calendar_event") {
    return normalizePayloadUserList(payload.recipients || payload.targetUsers || payload.to);
  }
  if (eventType === "request_complete") {
    const direct = normalizeUsername(String(payload.requestedByUsername || payload.requestedBy || payload.repName || ""));
    return [...new Set([direct, ...REQUEST_ALERT_USERNAMES].filter(Boolean))];
  }
  return [];
}

function buildNotification(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "scheduled_handover_complete" || eventType === "scheduled_handover_failed") {
    return {
      title: eventType === "scheduled_handover_complete" ? "Scheduled handover complete" : "Scheduled handover needs attention",
      body: eventType === "scheduled_handover_complete" ? "Kayla's app access is disabled and unfinished work has transferred to Nelly." : "Kayla's scheduled access cutoff is enforced. Review the handover audit for unfinished steps.",
      tag: `handover-${String(payload.transitionId || "scheduled")}-${eventType}`,
      viewId: "managers", url: "./",
    };
  }
  if (eventType === "suspend_tag_approval_requested") {
    const approvalId = String(payload.approvalId || "");
    if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new Error("SUSPEND_TAG_APPROVAL_INVALID");
    return { title: "GNC PH Suspend Tag", body: `${String(payload.customer || "")} — ${String(payload.itemDescription || "")} — Approval requested`,
      tag: `suspend-tag-${approvalId}`, viewId: "suspend-tag-approval", approvalId,
      actions: [{ action: "approve", title: "Approve" }, { action: "deny", title: "Deny" }], url: `./?suspendApproval=${approvalId}` };
  }
  const customer = String(payload.customer || "Unknown Customer").trim();
  const repName = String(payload.repName || payload.requestedBy || "Unknown Rep").trim();
  const folderId = String(payload.folderId || "").trim();
  const folderName = String(payload.folderName || folderId || "Flyer Folder").trim();
  const assignedTo = String(payload.assignedTo || repName || "Unassigned").trim();
  const createdBy = String(payload.createdBy || payload.sentBy || "Someone").trim();
  const itemsCount = Math.max(0, Number(payload.itemsCount) || 0);
  if (eventType === "hr_calendar_reminder") {
    const reminderKind = String(payload.reminderKind || "calendar").trim().toLowerCase();
    const titles: Record<string, string> = {
      time_off_tomorrow: "Time Off Tomorrow",
      meeting_day_before: "Meeting Tomorrow",
      meeting_t1h: "Meeting in One Hour",
      meeting_t30m: "Meeting in 30 Minutes",
      meeting_t15m: "Meeting in 15 Minutes",
    };
    const calendarEventId = String(payload.calendarEventId || "").trim();
    return {
      title: titles[reminderKind] || "Calendar Reminder",
      body: String(payload.bodyPreview || "You have an upcoming calendar event.").trim(),
      tag: `hr-calendar-${calendarEventId || Date.now()}-${reminderKind}`,
      viewId: "department-calendar",
      calendarEventId,
      url: "./",
    };
  }
  if (eventType.startsWith("codex_ops_")) {
    const taskId = String(payload.taskId || "").trim();
    const states: Record<string, { title: string; body: string }> = {
      codex_ops_needs_input: { title: "Codex Needs Input", body: "A mobile repair task is waiting for your reply." },
      codex_ops_ready: { title: "Codex Repair Ready", body: "Tests passed. Review the exact commit before deployment." },
      codex_ops_live: { title: "Codex Repair Live", body: "The approved commit and production health were verified." },
      codex_ops_failed: { title: "Codex Repair Stopped", body: "The task failed or was blocked without an unsafe change." },
      codex_ops_reverted: { title: "Codex Repair Reverted", body: "The deterministic rollback is live and healthy." },
    };
    const state = states[eventType] || { title: "Codex Operations", body: "A task status changed." };
    return {
      ...state,
      tag: `codex-ops-${taskId || Date.now()}-${eventType}`,
      viewId: "managers",
      homeTab: "codex-operations",
      taskId,
      url: "./"
    };
  }
  if (eventType === "eval_assignment_unassigned") {
    const itemcode = String(payload.itemcode || "New ItemCode").trim();
    return {
      title: "Eval Assignment Needed",
      body: `${itemcode} is not assigned to an active EVAL user.`,
      tag: `eval-assignment-${itemcode || Date.now()}`,
      viewId: "home",
      homeTab: "assigned-items-export",
      url: "./"
    };
  }
  if (eventType === "eval_assignment_summary") {
    const unassignedCount = Math.max(0, Number(payload.unassignedCount || payload.unassigned_count) || 0);
    return {
      title: "Eval Assignments Need Review",
      body: `${unassignedCount} ItemCode${unassignedCount === 1 ? " is" : "s are"} currently unassigned.`,
      tag: "eval-assignment-initial-summary",
      viewId: "home",
      homeTab: "assigned-items-export",
      url: "./"
    };
  }
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
  if (eventType === "department_calendar_event") {
    const eventTitle = String(payload.title || payload.customer || "Calendar Event").trim();
    const bodyPreview = String(payload.bodyPreview || `${createdBy} added ${eventTitle}.`).trim();
    const calendarEventId = String(payload.calendarEventId || payload.folderId || "").trim();
    return {
      title: "Calendar",
      body: bodyPreview,
      tag: `calendar-${calendarEventId || Date.now()}`,
      viewId: "department-calendar",
      calendarEventId,
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

serve((req) => withObservedRequest("send-push-alert", req, async () => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WEB_PUSH_VAPID_PUBLIC_KEY || !WEB_PUSH_VAPID_PRIVATE_KEY) {
    return jsonResponse({ error: "Push secrets are not configured." }, 500);
  }

  const authHeader = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const apiKey = String(req.headers.get("apikey") || "").trim();
  const session = await readSupabaseOrAppSessionFromRequest(req, supabase);
  const sessionAccess = session ? getRoleAccessState(session.role) : null;
  const hasServiceRole = authHeader === SUPABASE_SERVICE_ROLE_KEY || apiKey === SUPABASE_SERVICE_ROLE_KEY;
  const hasAppSession = !!(session && !session.mustChangePassword && sessionAccess);

  if (!hasServiceRole && !hasAppSession) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const eventType = String(payload.eventType || payload.type || "").trim().toLowerCase();
  const codexEventTypes = new Set(["codex_ops_needs_input", "codex_ops_ready", "codex_ops_live", "codex_ops_failed", "codex_ops_reverted"]);
  const handoverEventTypes = new Set(["scheduled_handover_complete", "scheduled_handover_failed", "suspend_tag_approval_requested"]);
  if (eventType !== "new_request" && eventType !== "request_complete" && eventType !== "flyer_created" && eventType !== "flyer_complete" && eventType !== "chat_message" && eventType !== "walkie_alert" && eventType !== "department_calendar_event" && eventType !== "hr_calendar_reminder" && eventType !== "eval_assignment_unassigned" && eventType !== "eval_assignment_summary" && !codexEventTypes.has(eventType) && !handoverEventTypes.has(eventType)) {
    return jsonResponse({ error: "Unsupported event type." }, 400);
  }
  // Reminders and handover notices require the configured service credential;
  // an active app session cannot send these administrative event types.
  if ((eventType === "hr_calendar_reminder" || handoverEventTypes.has(eventType)) && authHeader !== SUPABASE_SERVICE_ROLE_KEY && apiKey !== SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "This reminder event is service-only." }, 403);
  }

  let targetUsers: string[];
  try { targetUsers = await resolveOperationalRecipients(supabase, buildTargetUsers(eventType, payload), "username"); }
  catch { return jsonResponse({ error: "Recipient routing is temporarily unavailable. No push was sent." }, 503); }
  if (!targetUsers.length) {
    return jsonResponse({ delivered: 0, targets: [] });
  }

  const query = supabase
    .from(PUSH_TABLE)
    .select("id,username,endpoint,p256dh,auth,subscription_json")
    .eq("notifications_enabled", true)
    .in("username", targetUsers);

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
  const failureCounts: Record<string, number> = {};

  for (let start = 0; start < subscriptions.length; start += PUSH_SEND_CONCURRENCY) {
    const chunk = subscriptions.slice(start, start + PUSH_SEND_CONCURRENCY);
    // A long send may cross the cutoff after the initial subscription query.
    let currentTargets: Set<string>;
    try { currentTargets = new Set(await resolveOperationalRecipients(supabase, targetUsers, "username")); }
    catch { return jsonResponse({ error: "Recipient routing changed. Remaining pushes were stopped.", delivered }, 503); }
    await Promise.all(chunk.map(async (row) => {
      if (!currentTargets.has(normalizeUsername(String(row.username || "")))) return;
      try {
        if (eventType === "suspend_tag_approval_requested") {
          const receipt = await supabase.rpc("suspend_tag_push_receipt_v1", { p_approval_id: payload.approvalId, p_endpoint: row.endpoint, p_delivered: false });
          if (receipt.error) throw new Error("SUSPEND_TAG_PUSH_RECEIPT_FAILED");
          if (receipt.data === true) { delivered += 1; return; }
        }
        await webpush.sendNotification(buildSubscription(row), notificationPayload, WEB_PUSH_OPTIONS);
        if (eventType === "suspend_tag_approval_requested") {
          const receipt = await supabase.rpc("suspend_tag_push_receipt_v1", { p_approval_id: payload.approvalId, p_endpoint: row.endpoint, p_delivered: true });
          if (receipt.error) throw new Error("SUSPEND_TAG_PUSH_RECEIPT_FAILED");
        }
        delivered += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(Number(row.id));
        }
        const failureCode = statusCode > 0 ? `http_${statusCode}` : "delivery_error";
        failureCounts[failureCode] = Number(failureCounts[failureCode] || 0) + 1;
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
    failureCounts
  });
}));
