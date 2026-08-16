import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { normalizeUsername } from "../_shared/app-auth.ts";
import { withObservedRequest } from "../_shared/observability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "private, no-store",
};

const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
const serviceRoleKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function authAlias(username: string) {
  const localPart = normalizeUsername(username)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!localPart) throw new Error("invalid_username");
  return `${localPart}@auth.agmetricapp.invalid`;
}

async function requireNativeAuthAdmin(req: Request) {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,disabled_at,locked_until")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.disabled_at) return null;
  if (profile.locked_until && new Date(profile.locked_until).getTime() > Date.now()) return null;
  const role = String(profile.role || "").trim().toUpperCase();
  const metadataAdmin = data.user.app_metadata?.auth_admin === true;
  if (!metadataAdmin && !role.includes("ADMIN") && !role.includes("MANAGER")) return null;
  return { user: data.user, profile };
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const actor = await requireNativeAuthAdmin(req);
  if (!actor) return json({ error: "forbidden" }, 403);

  const payload = await req.json().catch(() => null);
  const action = String(payload?.action || "").trim().toLowerCase();
  const username = normalizeUsername(payload?.username || "");
  const password = String(payload?.password || "");
  if (!username) return json({ error: "invalid_username" }, 400);
  if (password.length < 8) return json({ error: "password_too_short" }, 400);

  if (action === "create_user") {
    const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (existing?.id) return json({ error: "user_exists" }, 409);
    const role = String(payload?.role || "User").trim() || "User";
    const { data, error } = await admin.auth.admin.createUser({
      email: authAlias(username),
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { username },
    });
    if (error || !data?.user?.id) return json({ error: "auth_create_failed" }, 400);
    const { error: profileError } = await admin.from("profiles").insert({
      id: data.user.id,
      username,
      display_name: String(payload?.displayName || username).trim() || username,
      role,
      division: String(payload?.division || "10").trim() || "10",
      language: String(payload?.language || "English").trim() || "English",
      must_change_password: payload?.mustChangePassword !== false,
    });
    if (profileError) return json({ error: "profile_create_failed", reconciliationRequired: true }, 409);
    return json({ ok: true, created: true }, 201);
  }

  if (action === "reset_password") {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (profileError || !profile?.id) return json({ error: "user_not_found" }, 404);
    const { error } = await admin.auth.admin.updateUserById(profile.id, { password });
    if (error) return json({ error: "password_reset_failed" }, 400);
    const { error: updateError } = await admin.from("profiles")
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (updateError) return json({ error: "profile_update_failed", reconciliationRequired: true }, 409);
    return json({ ok: true, reset: true });
  }

  return json({ error: "unsupported_action" }, 400);
}

serve((req) => withObservedRequest("auth-admin", req, () => handle(req)));
