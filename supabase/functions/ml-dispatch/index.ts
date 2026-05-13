import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ml-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GITHUB_DISPATCH_TOKEN = String(Deno.env.get("GITHUB_DISPATCH_TOKEN") || "").trim();
const GITHUB_REPOSITORY = String(Deno.env.get("GITHUB_REPOSITORY") || "collygedylan/GNC-Sales-Command-PRO-").trim();
const GITHUB_DISPATCH_EVENT = String(Deno.env.get("GITHUB_DISPATCH_EVENT") || "ml-photo-created").trim();
const ML_DISPATCH_SECRET = String(Deno.env.get("ML_DISPATCH_SECRET") || "").trim();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request) {
  return String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function isAuthorized(req: Request) {
  if (!ML_DISPATCH_SECRET) return false;
  const bearer = getBearerToken(req);
  const headerSecret = String(req.headers.get("x-ml-dispatch-secret") || "").trim();
  return bearer === ML_DISPATCH_SECRET || headerSecret === ML_DISPATCH_SECRET;
}

function normalizeDispatchEvent(value: unknown) {
  const candidate = String(value || "").trim();
  if (candidate === "ml-training-asset-created") return candidate;
  if (candidate === "ml-photo-created") return candidate;
  return GITHUB_DISPATCH_EVENT || "ml-photo-created";
}

async function readPayload(req: Request) {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (_error) {
    return { raw: text };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!GITHUB_DISPATCH_TOKEN || !GITHUB_REPOSITORY || !ML_DISPATCH_SECRET) {
    return jsonResponse({ error: "GitHub dispatch or ML dispatch secrets are not configured." }, 500);
  }
  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const payload = await readPayload(req);
  const eventType = normalizeDispatchEvent(payload.event_type || payload.eventType);
  const record = payload.record && typeof payload.record === "object" ? payload.record as Record<string, unknown> : {};
  const clientPayload = {
    source: String(payload.source || "supabase").trim() || "supabase",
    table: String(payload.table || payload.source || "").trim(),
    unique_id: String(record.unique_id || payload.unique_id || payload.uniqueId || "").trim(),
    image_bucket: String(record.image_bucket || payload.image_bucket || "").trim(),
    image_path: String(record.image_path || payload.image_path || "").trim(),
    created_at: String(record.created_at || payload.created_at || new Date().toISOString()).trim(),
  };

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "gnc-supabase-ml-dispatch",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: clientPayload,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    return jsonResponse({
      error: "GitHub repository_dispatch failed.",
      status: response.status,
      details,
    }, 502);
  }

  return jsonResponse({
    ok: true,
    event_type: eventType,
    repository: GITHUB_REPOSITORY,
    client_payload: clientPayload,
  });
});
