import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { withObservedRequest } from "../_shared/observability.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const REQUEST_DELIVERY_CRON_SECRET = Deno.env.get("REQUEST_DELIVERY_CRON_SECRET") || "";
const REQUEST_DELIVERY_SIGNING_SECRET = Deno.env.get("REQUEST_DELIVERY_SIGNING_SECRET") || SUPABASE_SERVICE_ROLE_KEY;
const APPS_SCRIPT_WEB_APP_URL = Deno.env.get("APPS_SCRIPT_WEB_APP_URL") || "";
const WORKER_ID = Deno.env.get("REQUEST_DELIVERY_WORKER_ID") || "edge-request-delivery-v1";
const CLAIM_LIMIT = Math.max(1, Math.min(50, Number(Deno.env.get("REQUEST_DELIVERY_CLAIM_LIMIT") || "12") || 12));

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" }
  });
}

function sanitizeCode(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error || "DELIVERY_WORKER_FAILED").toUpperCase();
  if (/RECLASS_CONFLICT/.test(raw)) return "RECLASS_CONFLICT";
  if (/RECLASS_VALIDATION/.test(raw)) return "RECLASS_VALIDATION";
  if (/SHEAR.*CONFLICT/.test(raw)) return "SHEAR_CONFLICT";
  if (/SHEAR.*VALIDATION/.test(raw)) return "SHEAR_VALIDATION";
  if (/SNAPSHOT/.test(raw)) return "REQUEST_SNAPSHOT_MISSING";
  if (/APPS_SCRIPT|EMAIL|GMAIL/.test(raw)) return "EMAIL_SEND_FAILED";
  if (/PUSH/.test(raw)) return "PUSH_SEND_FAILED";
  if (/LEASE/.test(raw)) return "DELIVERY_LEASE_LOST";
  return raw.replace(/[^A-Z0-9_]+/g, "_").slice(0, 120) || "DELIVERY_WORKER_FAILED";
}

function isAuthorized(req: Request) {
  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const apiKey = String(req.headers.get("apikey") || "").trim();
  const cronSecret = String(req.headers.get("x-delivery-cron-secret") || "").trim();
  return Boolean(
    SUPABASE_SERVICE_ROLE_KEY && (bearer === SUPABASE_SERVICE_ROLE_KEY || apiKey === SUPABASE_SERVICE_ROLE_KEY)
  ) || Boolean(REQUEST_DELIVERY_CRON_SECRET && cronSecret === REQUEST_DELIVERY_CRON_SECRET);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSignature(timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(REQUEST_DELIVERY_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return base64Url(new Uint8Array(signature));
}

async function stableMessageId(eventKey: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventKey));
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `<gnc-${hex.slice(0, 40)}@request-delivery.agdatasolutions.local>`;
}

function requestIdsForEvent(event: JsonRecord) {
  const payload = event.payload && typeof event.payload === "object" ? event.payload as JsonRecord : {};
  const raw = payload.request_ids || payload.requestIds || (event.request_id ? [event.request_id] : []);
  return [...new Set((Array.isArray(raw) ? raw : [raw]).map((value) => String(value || "").trim()).filter(Boolean))];
}

function isFolderCompletionV2(event: JsonRecord) {
  const payload = event.payload && typeof event.payload === "object" ? event.payload as JsonRecord : {};
  return String(event.event_type || "") === "request_completed"
    && String(payload.contractVersion || "") === "request-folder-completion-v2";
}

async function prepareFolderCompletionV2(event: JsonRecord) {
  const { data, error } = await supabase.rpc("prepare_request_folder_completion_v2", {
    p_event_id: String(event.event_id || ""),
    p_lease_token: String(event.lease_token || ""),
  });
  if (error) throw new Error(`FOLDER_COMPLETION_PREPARE_FAILED:${error.code || "unknown"}`);
  return data && typeof data === "object" ? data as JsonRecord : {};
}

async function acknowledgeFolderCompletionV2(event: JsonRecord) {
  const { error } = await supabase.rpc("acknowledge_request_folder_completion_v2", {
    p_event_id: String(event.event_id || ""),
  });
  if (error) throw new Error(`FOLDER_COMPLETION_ACK_FAILED:${error.code || "unknown"}`);
}

async function loadRequestRows(event: JsonRecord) {
  const payload = event.payload && typeof event.payload === "object" ? event.payload as JsonRecord : {};
  const eventType = String(event.event_type || "");
  if (eventType === "request_created") {
    const snapshots = Array.isArray(payload.requests) ? payload.requests.filter(Boolean) : [];
    if (snapshots.length) return snapshots;
  }
  const ids = requestIdsForEvent(event);
  if (!ids.length) return [];
  const table = eventType === "request_completed" ? "ph_request_history" : "ph_active_request_live_rows";
  const { data, error } = await supabase.from(table).select("*").in("unique_id", ids);
  if (error) throw new Error(`REQUEST_SNAPSHOT_LOAD_FAILED:${error.code || "unknown"}`);
  return Array.isArray(data) ? data : [];
}

async function loadThreadRecord(folder: string) {
  if (!folder) return null;
  const { data, error } = await supabase
    .from("ph_request_email_threads")
    .select("request_folder,recipients,initial_thread_id,initial_message_id,initial_email_sent_at,status")
    .eq("request_folder", folder)
    .maybeSingle();
  if (error) throw new Error(`THREAD_LOOKUP_FAILED:${error.code || "unknown"}`);
  return data || null;
}

async function callAppsScript(event: JsonRecord, rows: unknown[], thread: unknown) {
  if (!APPS_SCRIPT_WEB_APP_URL) throw new Error("APPS_SCRIPT_URL_MISSING");
  const delivery = {
    eventId: event.event_id,
    eventKey: event.event_key,
    eventType: event.event_type,
    requestId: event.request_id,
    requestFolder: event.request_folder,
    messageIdHeader: await stableMessageId(String(event.event_key || event.event_id || "request")),
    payload: event.payload && typeof event.payload === "object" ? event.payload : {},
    rows,
    thread
  };
  const signedBody = JSON.stringify(delivery);
  const timestamp = new Date().toISOString();
  const signature = await hmacSignature(timestamp, signedBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "request_delivery_event", timestamp, signature, deliveryJson: signedBody }),
      signal: controller.signal,
      redirect: "follow"
    });
    const responseText = await response.text();
    let result: JsonRecord = {};
    try { result = responseText ? JSON.parse(responseText) as JsonRecord : {}; } catch { throw new Error("APPS_SCRIPT_INVALID_RESPONSE"); }
    if (!response.ok || result.ok !== true) throw new Error(`APPS_SCRIPT_EMAIL_FAILED:${String(result.code || result.message || response.status)}`);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function buildPushPayload(event: JsonRecord, rows: JsonRecord[]) {
  const payload = event.payload && typeof event.payload === "object" ? event.payload as JsonRecord : {};
  const first = rows[0] || {};
  const eventType = String(event.event_type || "");
  return {
    eventType: eventType === "request_created" ? "new_request"
      : eventType === "request_completed" ? "request_complete" : eventType,
    folderId: String(event.request_folder || first.request_folder || ""),
    repName: String(first.requested_by || ""),
    requestedBy: String(first.requested_by || ""),
    requestedByUsername: String(first.request_selected_rep_username || first.requested_by || "")
      .trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    customer: String(first.req_customer || ""),
    itemsCount: rows.length,
    requestIds: rows.map((row) => String(row.unique_id || "")).filter(Boolean),
    itemcode: String(payload.itemcode || ""),
    unassignedCount: Math.max(0, Number(payload.unassigned_count) || 0),
    managerUsernames: Array.isArray(payload.manager_usernames) ? payload.manager_usernames : []
  };
}

async function sendPush(event: JsonRecord, rows: JsonRecord[]) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-push-alert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY
    },
    body: JSON.stringify(buildPushPayload(event, rows))
  });
  if (!response.ok) throw new Error(`PUSH_SEND_FAILED:${response.status}`);
  const result = await response.json().catch(() => ({}));
  return result as JsonRecord;
}

async function recordChannels(eventId: string, leaseToken: string, channelResults: JsonRecord) {
  const { data, error } = await supabase.rpc("record_request_delivery_channel_result", {
    p_event_id: eventId,
    p_lease_token: leaseToken,
    p_channel_results: channelResults
  });
  if (error) throw new Error(`DELIVERY_CHANNEL_RECORD_FAILED:${error.code || "unknown"}`);
  return data as JsonRecord;
}

async function finishEvent(eventId: string, leaseToken: string, channelResults: JsonRecord) {
  const { error } = await supabase.rpc("complete_request_delivery_event", {
    p_event_id: eventId,
    p_lease_token: leaseToken,
    p_channel_results: channelResults
  });
  if (error) throw new Error(`DELIVERY_COMPLETE_FAILED:${error.code || "unknown"}`);
}

async function failEvent(eventId: string, leaseToken: string, error: unknown) {
  const { error: rpcError } = await supabase.rpc("fail_request_delivery_event", {
    p_event_id: eventId,
    p_lease_token: leaseToken,
    p_error_code: sanitizeCode(error)
  });
  if (rpcError && !/DELIVERY_LEASE_LOST/.test(String(rpcError.message || ""))) {
    console.error(JSON.stringify({ action: "fail_event", error_code: rpcError.code || "unknown" }));
  }
}

async function failEventPermanent(eventId: string, leaseToken: string, error: unknown, attemptCount: unknown) {
  const { data, error: updateError } = await supabase
    .from("ph_request_delivery_outbox")
    .update({
      status: "failed",
      attempt_count: Math.max(0, Number(attemptCount) || 0) + 1,
      sanitized_error_code: sanitizeCode(error),
      lease_token: null,
      lease_owner: null,
      lease_expires_at: null
    })
    .eq("event_id", eventId)
    .eq("status", "processing")
    .eq("lease_token", leaseToken)
    .select("event_id")
    .maybeSingle();
  if (updateError) throw new Error(`DELIVERY_PERMANENT_FAIL_RECORD_FAILED:${updateError.code || "unknown"}`);
  if (!data) throw new Error("DELIVERY_LEASE_LOST");
}

async function ensureCanary(source: string) {
  if (source !== "cron") return false;
  const bucket = Math.floor(Date.now() / 300000);
  const { error } = await supabase.from("ph_request_delivery_outbox").upsert({
    event_key: `delivery-canary:${bucket}`,
    event_type: "delivery_canary",
    payload: { bucket },
    status: "pending",
    next_attempt_at: new Date().toISOString()
  }, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) throw new Error(`CANARY_ENQUEUE_FAILED:${error.code || "unknown"}`);
  return true;
}

async function heartbeat(claimed: number, delivered: number, failed: number, canary: boolean, errorCode = "") {
  await supabase.rpc("heartbeat_request_delivery_worker", {
    p_worker_id: WORKER_ID,
    p_claimed: claimed,
    p_delivered: delivered,
    p_failed: failed,
    p_canary: canary,
    p_error_code: errorCode || null
  });
}

serve((req) => withObservedRequest("request-delivery-worker", req, async () => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !REQUEST_DELIVERY_CRON_SECRET || !REQUEST_DELIVERY_SIGNING_SECRET || !APPS_SCRIPT_WEB_APP_URL) {
    return jsonResponse({ error: "Delivery worker secrets are not configured." }, 503);
  }
  if (!isAuthorized(req)) return jsonResponse({ error: "Unauthorized" }, 401);

  const input = await req.json().catch(() => ({})) as JsonRecord;
  const source = String(input.source || "manual").trim().toLowerCase();
  let canary = false;
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let runError = "";

  try {
    canary = await ensureCanary(source);
    const { data, error } = await supabase.rpc("claim_request_delivery_events", {
      p_limit: CLAIM_LIMIT,
      p_worker_id: WORKER_ID
    });
    if (error) throw new Error(`DELIVERY_CLAIM_FAILED:${error.code || "unknown"}`);
    const events = Array.isArray(data) ? data as JsonRecord[] : [];
    claimed = events.length;

    for (const event of events) {
      const eventId = String(event.event_id || "");
      const leaseToken = String(event.lease_token || "");
      let channelResults = event.channel_results && typeof event.channel_results === "object"
        ? { ...(event.channel_results as JsonRecord) } : {};
      try {
        const eventType = String(event.event_type || "");
        if (eventType === "delivery_canary") {
          channelResults = { canary: { delivered_at: new Date().toISOString(), mode: "canary" } };
          await finishEvent(eventId, leaseToken, channelResults);
          delivered += 1;
          continue;
        }

        if (["reclass_inquiry", "eval_work_assignment", "eval_work_completion", "shear_location_inquiry", "location_work_assignment", "location_work_completion"].includes(eventType)) {
          if (!event.email_delivered_at) {
            const emailResult = await callAppsScript(event, [], null);
            channelResults.email = {
              delivered_at: new Date().toISOString(),
              gmail_message_id: String(emailResult.gmailMessageId || ""),
              thread_id: String(emailResult.threadId || ""),
              message_id: String(emailResult.messageId || ""),
              message_id_header: String(emailResult.messageIdHeader || ""),
              mode: String(emailResult.mode || "gmail_api"),
              recipients: Array.isArray(emailResult.recipients) ? emailResult.recipients : []
            };
            event.email_delivered_at = (channelResults.email as JsonRecord).delivered_at;
            await recordChannels(eventId, leaseToken, { email: channelResults.email });
          }
          await finishEvent(eventId, leaseToken, channelResults);
          delivered += 1;
          continue;
        }

        if (isFolderCompletionV2(event)) {
          const readiness = await prepareFolderCompletionV2(event);
          if (readiness.ready !== true) continue;
          const payload = event.payload && typeof event.payload === "object" ? event.payload as JsonRecord : {};
          payload.request_ids = Array.isArray(readiness.requestIds) ? readiness.requestIds : payload.request_ids;
          payload.activeRequestIds = payload.request_ids;
          payload.updatedCompletion = readiness.updatedCompletion === true;
          event.payload = payload;
        }

        const rows = await loadRequestRows(event) as JsonRecord[];
        const isRequestEvent = ["request_created", "request_completed"].includes(String(event.event_type || ""));
        if (isRequestEvent && !rows.length) throw new Error("REQUEST_SNAPSHOT_MISSING");

        if (isRequestEvent && !event.email_delivered_at) {
          const folder = String(event.request_folder || rows[0]?.request_folder || "");
          const thread = await loadThreadRecord(folder);
          const emailResult = await callAppsScript(event, rows, thread);
          channelResults.email = {
            delivered_at: new Date().toISOString(),
            gmail_message_id: String(emailResult.gmailMessageId || ""),
            thread_id: String(emailResult.threadId || ""),
            message_id: String(emailResult.messageId || ""),
            reply_to_message_id: String(emailResult.replyToMessageId || ""),
            message_id_header: String(emailResult.messageIdHeader || ""),
            mode: String(emailResult.mode || "gmail_api"),
            recipients: Array.isArray(emailResult.recipients) ? emailResult.recipients : []
          };
          event.email_delivered_at = (channelResults.email as JsonRecord).delivered_at;
          event.gmail_message_id = (channelResults.email as JsonRecord).gmail_message_id;
          event.gmail_thread_id = (channelResults.email as JsonRecord).thread_id;
          event.message_id_header = (channelResults.email as JsonRecord).message_id_header;
          await recordChannels(eventId, leaseToken, { email: channelResults.email });
        }

        if (!event.push_delivered_at) {
          const pushResult = await sendPush(event, rows);
          channelResults.push = {
            delivered_at: new Date().toISOString(),
            delivered_count: Number(pushResult.delivered || 0),
            mode: "web_push"
          };
          event.push_delivered_at = (channelResults.push as JsonRecord).delivered_at;
          await recordChannels(eventId, leaseToken, { push: channelResults.push });
        }

        await finishEvent(eventId, leaseToken, channelResults);
        if (isFolderCompletionV2(event)) {
          await acknowledgeFolderCompletionV2(event).catch((error) => {
            console.error(JSON.stringify({ action: "folder_completion_ack", error_code: sanitizeCode(error) }));
          });
        }
        delivered += 1;
      } catch (error) {
        failed += 1;
        const code = sanitizeCode(error);
        if (["reclass_inquiry", "eval_work_assignment", "eval_work_completion", "shear_location_inquiry", "location_work_assignment", "location_work_completion"].includes(String(event.event_type || ""))
          && ["RECLASS_CONFLICT", "RECLASS_VALIDATION", "EVAL_WORK_CONFLICT", "EVAL_WORK_VALIDATION", "SHEAR_CONFLICT", "SHEAR_VALIDATION"].includes(code)) {
          await failEventPermanent(eventId, leaseToken, error, event.attempt_count);
        } else {
          await failEvent(eventId, leaseToken, error);
        }
      }
    }
  } catch (error) {
    runError = sanitizeCode(error);
    console.error(JSON.stringify({ action: "worker_run", error_code: runError }));
  } finally {
    await heartbeat(claimed, delivered, failed, canary, runError).catch(() => {});
  }

  return jsonResponse({ ok: !runError, claimed, delivered, failed, canary, errorCode: runError || null }, runError ? 500 : 200);
}));
