import { createClient } from "npm:@supabase/supabase-js@2.112.3";

export const CODEX_OPS_BUCKET = "codex-ops-evidence-v1";
export const CODEX_OPS_CONTRACT = "mobile-codex-ops-v1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "private, no-store",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

export function sanitizeErrorCode(error: unknown) {
  const raw = String(
    error instanceof Error ? error.message : error || "CODEX_OPS_FAILED",
  ).toUpperCase();
  const known = raw.match(/CODEX_OPS_[A-Z0-9_]+/)?.[0];
  return (
    known ||
    raw.replace(/[^A-Z0-9_]+/g, "_").slice(0, 100) ||
    "CODEX_OPS_FAILED"
  );
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function userClient(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_ANON_KEY") || "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: String(req.headers.get("authorization") || ""),
        },
      },
    },
  );
}

export async function requireNativeDylan(
  req: Request,
  admin = serviceClient(),
) {
  const token = String(req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) throw new Error("CODEX_OPS_AUTH_REQUIRED");
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id || user.is_anonymous)
    throw new Error("CODEX_OPS_AUTH_REQUIRED");
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,username,disabled_at,locked_until")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile) throw new Error("CODEX_OPS_DYLAN_ONLY");
  const locked =
    profile.locked_until &&
    new Date(profile.locked_until).getTime() > Date.now();
  if (
    String(profile.username || "")
      .trim()
      .toLowerCase() !== "dylan_collyge" ||
    profile.disabled_at ||
    locked
  ) {
    throw new Error("CODEX_OPS_DYLAN_ONLY");
  }
  return { user, profile };
}

export function safeEvidenceName(name: unknown) {
  const cleaned = String(name || "evidence")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return cleaned || "evidence";
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return new TextDecoder("ascii").decode(bytes.slice(start, start + length));
}

export function detectEvidenceMime(bytes: Uint8Array) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes
      .slice(0, 8)
      .every(
        (v, i) => v === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i],
      )
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  )
    return "image/webp";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6)))
    return "image/gif";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "video/webm";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand))
      return brand === "mif1" ? "image/heif" : "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  return "";
}

export function mediaKindForMime(mime: string) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "";
}

export function validateEvidenceSize(kind: string, size: number) {
  if (!Number.isFinite(size) || size <= 0) return false;
  return kind === "image"
    ? size <= 15 * 1024 * 1024
    : kind === "video" && size <= 150 * 1024 * 1024;
}

export async function sendCodexOpsPush(eventType: string, taskId: string) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return;
  await fetch(`${url}/functions/v1/send-push-alert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ eventType, taskId, targetUsers: ["dylan_collyge"] }),
  }).catch(() => null);
}
