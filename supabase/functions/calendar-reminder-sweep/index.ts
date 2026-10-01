import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { withObservedRequest } from "../_shared/observability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "private, no-store",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

serve((req) => withObservedRequest("calendar-reminder-sweep", req, async () => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return response({ error: "Calendar reminder service is not configured." }, 500);

  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer !== SUPABASE_SERVICE_ROLE_KEY) return response({ error: "Unauthorized." }, 401);
  const input = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "source") || String(input.source || "") !== "pg_cron") {
    return response({ error: "Invalid calendar sweep request." }, 400);
  }

  const { data: rows, error: claimError } = await supabase.rpc("hr_claim_calendar_reminders_v1", { p_limit: 80 });
  if (claimError) return response({ error: "Could not claim due calendar reminders." }, 503);
  const claimed = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  let delivered = 0;
  let failed = 0;
  let noDevice = 0;
  const serviceHeaders = {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };

  for (const row of claimed) {
    const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
    let sent = false;
    let safeCode = "push_delivery_failed";
    try {
      const push = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/send-push-alert`, {
        method: "POST",
        headers: serviceHeaders,
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          eventType: "hr_calendar_reminder",
          reminderKind: String(row.event_type || ""),
          calendarEventId: String(row.calendar_event_id || ""),
          title: String(payload.title || "Calendar reminder").slice(0, 120),
          bodyPreview: String(payload.bodyPreview || "You have an upcoming calendar event.").slice(0, 240),
          // send-push-alert also hardcodes this target for this event type.
          targetUsers: ["dylan_collyge"],
        }),
      });
      const result = await push.json().catch(() => ({})) as Record<string, unknown>;
      const subscriptionCount = Number(result.subscriptions);
      const deliveryCount = Number(result.delivered);
      if (push.ok && subscriptionCount === 0) {
        // No subscribed Dylan device is an intentional terminal outcome, not a retryable failure.
        sent = true;
        noDevice += 1;
      } else if (push.ok && subscriptionCount > 0 && deliveryCount > 0) sent = true;
      else safeCode = push.ok ? "push_zero_deliveries" : `push_http_${push.status}`;
    } catch (error) {
      const name = String((error as { name?: string })?.name || "").toLowerCase();
      safeCode = name === "timeouterror" || name === "aborterror" ? "push_timeout" : "push_network_error";
    }

    const { error: finishError } = await supabase.rpc("hr_finish_calendar_reminder_v1", {
      p_id: String(row.id || ""),
      p_delivered: sent,
      p_error_code: sent ? null : safeCode,
    });
    if (finishError || !sent) failed += 1;
    else delivered += 1;
  }

  return response({ claimed: claimed.length, delivered, noDevice, failed });
}));
