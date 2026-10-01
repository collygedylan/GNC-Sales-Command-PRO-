type SupabaseClientLike = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  auth: { admin: { updateUserById: (id: string, attributes: Record<string, unknown>) => PromiseLike<{ error: unknown }> } };
};

export const TRANSITION_ID = "kayla_knepp_to_nelly_aguilar_20261002";
const PUSH_TIMEOUT_MS = 12_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "private, no-store",
};

type HandlerDependencies = {
  supabase: SupabaseClientLike;
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

function safeCode(value: unknown, fallback: string) {
  const code = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
  return code || fallback;
}

export function createScheduledOffboardingHandler(deps: HandlerDependencies) {
  const fetcher = deps.fetcher || fetch;

  async function deliverQueuedNotifications() {
    const { data: claimed, error: claimError } = await deps.supabase.rpc("scheduled_handover_claim_push_v1");
    if (claimError) return { claimed: 0, delivered: 0, failed: 1 };
    const rows = Array.isArray(claimed) ? claimed as Record<string, unknown>[] : [];
    const serviceHeaders = {
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      apikey: deps.serviceRoleKey,
      "Content-Type": "application/json",
    };
    let delivered = 0;
    let failed = 0;

    // Limit each invocation to three deliveries. Network calls are bounded;
    // a lost HTTP acknowledgement is recovered through durable claims.
    for (const row of rows.slice(0, 3)) {
      const eventType = String(row.event_type || "");
      let ok = false;
      let errorCode = "push_delivery_failed";
      try {
        const push = await fetcher(`${deps.supabaseUrl.replace(/\/$/, "")}/functions/v1/send-push-alert`, {
          method: "POST",
          headers: serviceHeaders,
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
          body: JSON.stringify({
            eventType,
            transitionId: TRANSITION_ID,
            // The sender independently enforces Dylan-only delivery for these
            // event types; never trust a client supplied recipient.
            targetUsers: ["dylan_collyge"],
          }),
        });
        const result = await push.json().catch(() => ({})) as Record<string, unknown>;
        const subscriptions = Number(result.subscriptions || 0);
        const deliveryCount = Number(result.delivered || 0);
        if (push.ok && subscriptions > 0 && deliveryCount > 0) ok = true;
        else if (push.ok && subscriptions === 0) errorCode = "push_no_subscriptions";
        else errorCode = push.ok ? "push_zero_deliveries" : `push_http_${push.status}`;
      } catch (error) {
        const name = String((error as { name?: string })?.name || "").toLowerCase();
        errorCode = name === "timeouterror" || name === "aborterror" ? "push_timeout" : "push_network_error";
      }

      const { error: finishError } = await deps.supabase.rpc("scheduled_handover_finish_push_v1", {
        p_id: Number(row.id),
        p_ok: ok,
        p_error_code: ok ? null : errorCode,
      });
      if (finishError || !ok) failed += 1;
      else delivered += 1;
    }
    return { claimed: rows.length, delivered, failed };
  }

  return async function handleScheduledOffboarding(req: Request) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);
    if (!deps.supabaseUrl || !deps.serviceRoleKey) return response({ error: "Offboarding worker is not configured." }, 500);

    const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (bearer !== deps.serviceRoleKey) return response({ error: "Unauthorized." }, 401);
    const input = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (Object.keys(input).length !== 1 || String(input.source || "") !== "pg_cron") {
      return response({ error: "Invalid offboarding request." }, 400);
    }

    const { data: state, error: tickError } = await deps.supabase.rpc("scheduled_handover_tick_v1");
    if (tickError) return response({ error: "Offboarding transition could not be advanced." }, 503);
    const tick = state && typeof state === "object" ? state as Record<string, unknown> : {};
    if (tick.configured === false || tick.due === false || tick.busy === true) {
      const notifications = await deliverQueuedNotifications();
      return response({ configured: tick.configured !== false, due: tick.due === true, busy: tick.busy === true, notifications });
    }

    let authBanFailed = false;
    if (tick.authBanPending === true) {
      const profileId = String(tick.profileId || "");
      if (!profileId) return response({ error: "Offboarding identity is incomplete." }, 503);
      let banError: { code?: string } | null = null;
      try {
        const result = await deps.supabase.auth.admin.updateUserById(profileId, {
          // A long ban revokes refresh/session access. The DB cutoff separately
          // blocks already-issued JWTs immediately, before their expiry.
          ban_duration: "876000h",
        });
        banError = result.error as { code?: string } | null;
      } catch (error) {
        banError = { code: safeCode((error as { code?: string })?.code, "auth_admin_network_error") };
      }
      const { error: checkpointError } = await deps.supabase.rpc("scheduled_handover_auth_checkpoint_v1", {
        p_ok: !banError,
        p_error_code: banError ? safeCode(banError.code, "auth_admin_ban_failed") : null,
      });
      if (checkpointError) return response({ error: "Offboarding Auth status could not be checkpointed." }, 503);
      authBanFailed = Boolean(banError);
    }

    const { error: finalTickError } = await deps.supabase.rpc("scheduled_handover_tick_v1");
    if (finalTickError) return response({ error: "Offboarding completion could not be verified." }, 503);
    const notifications = await deliverQueuedNotifications();
    return response({ configured: true, due: true, authBanFailed, notifications }, authBanFailed ? 503 : 200);
  };
}
