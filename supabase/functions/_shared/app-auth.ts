const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const FORCED_PASSWORD_CHANGE_VALUES = new Set([
  "GREENLEAF25",
  "1234",
  "12345",
  "welcome",
  "password",
]);

export type AppSessionClaims = {
  ver: number;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
  iat: number;
  exp: number;
};

export function normalizeUsername(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeRole(value = "") {
  return String(value || "").toUpperCase().replace(/\s+/g, "");
}

export function isForcedPasswordValue(value = "") {
  return FORCED_PASSWORD_CHANGE_VALUES.has(String(value || "").trim());
}

export function getRoleAccessState(role = "") {
  const roleDisplay = String(role || "").toUpperCase();
  const normalizedRole = normalizeRole(role || roleDisplay);
  const isRep =
    normalizedRole === "REP" ||
    normalizedRole === "SALESREP" ||
    normalizedRole.includes("SALESREP") ||
    roleDisplay.includes("SALES REP");
  const isQcSupervisor =
    normalizedRole.includes("QCSUPERVISOR") ||
    normalizedRole.includes("QCSUP") ||
    roleDisplay.includes("QC SUPERVISOR");
  const isQc = !isQcSupervisor && (normalizedRole === "QC" || normalizedRole.startsWith("QC"));
  const isCsr = normalizedRole === "CSR" || normalizedRole.includes("CSR");
  const isAdmin = normalizedRole.includes("ADMIN") || normalizedRole.includes("MANAGER") || isCsr || (!isRep && !isQcSupervisor && !isQc);
  const allowedViews = new Set<string>(["home"]);
  if (isAdmin) {
    ["drive", "tasks", "docks", "av", "request", "reserves", "sales-office", "reports", "hours", "low-stock", "review"].forEach((viewId) => allowedViews.add(viewId));
  } else if (isRep) {
    ["av", "docks", "request", "sales-office"].forEach((viewId) => allowedViews.add(viewId));
  } else if (isQcSupervisor) {
    ["drive", "docks"].forEach((viewId) => allowedViews.add(viewId));
  } else if (isQc) {
    ["docks"].forEach((viewId) => allowedViews.add(viewId));
  }
  return { isAdmin, isRep, isQcSupervisor, isQc, allowedViews };
}

function getSessionSecret() {
  return String(Deno.env.get("APP_SESSION_SECRET") || "").trim();
}

function getSessionTtlSeconds() {
  const parsed = Number(Deno.env.get("APP_SESSION_TTL_SECONDS") || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_SESSION_TTL_SECONDS;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value = "") {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value = "") {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return base64ToBytes(padded);
}

async function signPayload(payload = "") {
  const secret = getSessionSecret();
  if (!secret) throw new Error("APP_SESSION_SECRET is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

export async function createAppSession(input: {
  username: string;
  displayName?: string;
  role?: string;
  mustChangePassword?: boolean;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: AppSessionClaims = {
    ver: 1,
    username: normalizeUsername(input.username),
    displayName: String(input.displayName || input.username || "").trim() || normalizeUsername(input.username),
    role: String(input.role || "User").trim() || "User",
    mustChangePassword: !!input.mustChangePassword,
    iat: nowSeconds,
    exp: nowSeconds + getSessionTtlSeconds(),
  };
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signature = await signPayload(payload);
  return { token: `${payload}.${signature}`, claims };
}

export async function verifyAppSessionToken(token = ""): Promise<AppSessionClaims | null> {
  const trimmed = String(token || "").trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  try {
    const expectedSignature = await signPayload(payloadPart);
    if (expectedSignature !== signaturePart) return null;
    const claims = JSON.parse(decoder.decode(decodeBase64Url(payloadPart))) as AppSessionClaims;
    if (!claims || typeof claims !== "object") return null;
    if (!claims.username || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      ver: Number(claims.ver || 1),
      username: normalizeUsername(claims.username),
      displayName: String(claims.displayName || claims.username || "").trim() || normalizeUsername(claims.username),
      role: String(claims.role || "User").trim() || "User",
      mustChangePassword: !!claims.mustChangePassword,
      iat: Number(claims.iat || 0),
      exp: Number(claims.exp || 0),
    };
  } catch (_error) {
    return null;
  }
}

export async function readAppSessionFromRequest(req: Request) {
  const headerValue = String(
    req.headers.get("x-gnc-session") ||
      req.headers.get("x-app-session") ||
      req.headers.get("authorization") ||
      "",
  ).trim();
  if (!headerValue) return null;
  const token = headerValue.replace(/^(Bearer|Session)\s+/i, "").trim();
  return await verifyAppSessionToken(token);
}
