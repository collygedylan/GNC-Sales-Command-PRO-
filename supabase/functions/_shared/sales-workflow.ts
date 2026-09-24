import type { AppSessionClaims } from "./app-auth.ts";

export const SALES_CREDIT_BUCKET = "sales-credit-evidence";
export const SALES_CREDIT_PHOTO_LIMIT = 8 * 1024 * 1024;
const READ_OPERATIONS = new Set(["compatibility", "folders", "sources", "source", "drafts", "detail", "submissions", "attachment_download"]);
const WRITE_OPERATIONS = new Set(["save_draft", "submit", "review_line", "authorize_repeat", "amend_line", "resolve_source"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSalesEnvelope(input: Record<string, unknown>) {
  if (Object.keys(input).some((key) => !["action", "operation", "payload", "commandId", "expectedRevision"].includes(key))) throw new Error("SALES_PAYLOAD_INVALID");
  const action = String(input.action || "");
  const operation = String(input.operation || (action === "request_history" ? "search" : ""));
  if (action === "request_history" ? !["search", "folders", "detail", "compatibility"].includes(operation)
    : action !== "sales_credit" || (!READ_OPERATIONS.has(operation) && !WRITE_OPERATIONS.has(operation) && operation !== "attachment_upload")) throw new Error("SALES_OPERATION_INVALID");
  const payload = input.payload ?? {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("SALES_PAYLOAD_INVALID");
  if ((WRITE_OPERATIONS.has(operation) || operation === "attachment_upload") && !UUID.test(String(input.commandId || ""))) throw new Error("SALES_COMMAND_ID_REQUIRED");
  if (input.expectedRevision !== undefined && (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0)) throw new Error("SALES_REVISION_INVALID");
  return { action, operation, payload: payload as Record<string, unknown> };
}

export function decodeCreditPhoto(payload: Record<string, unknown>) {
  const encoded = String(payload.base64 || "");
  if (!encoded || encoded.length > Math.ceil(SALES_CREDIT_PHOTO_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("CREDIT_PHOTO_INVALID");
  let binary: string;
  try { binary = atob(encoded); } catch { throw new Error("CREDIT_PHOTO_INVALID"); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > SALES_CREDIT_PHOTO_LIMIT) throw new Error("CREDIT_PHOTO_TOO_LARGE");
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  const mime = jpeg ? "image/jpeg" : png ? "image/png" : webp ? "image/webp" : "";
  if (!mime || String(payload.mime || "").toLowerCase() !== mime) throw new Error("CREDIT_PHOTO_ENCODING_INVALID");
  return { bytes, mime, extension: jpeg ? "jpg" : png ? "png" : "webp" };
}

export function salesErrorStatus(error: { code?: string; message?: string }) {
  const message = String(error.message || "");
  if (error.code === "42501" || /FORBIDDEN|NOT_ACTIVE/.test(message)) return 403;
  if (/CONFLICT|CHANGED|ALREADY|AUTHORIZATION_REQUIRED|REVIEW_REQUIRED/.test(message)) return 409;
  if (/NOT_FOUND/.test(message)) return 404;
  if (/PHOTO_TOO_LARGE/.test(message)) return 413;
  return 400;
}

type Dependencies = {
  session: AppSessionClaims | null;
  payload: Record<string, unknown>;
  supabase: any;
  resolveActiveSessionProfile: (session: AppSessionClaims | null) => Promise<Record<string, unknown>>;
  headers?: HeadersInit;
};

async function hashBytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

/** Actor UUID comes only from a verified session and freshly loaded trusted profile. */
export async function handleSalesWorkflow(deps: Dependencies): Promise<Response> {
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...Object.fromEntries(new Headers(deps.headers)), "content-type": "application/json" } });
  if (!deps.session || deps.session.mustChangePassword) return respond({ ok: false, code: "SESSION_REQUIRED", error: "Sign in again." }, 401);
  try {
    const { action, operation, payload } = validateSalesEnvelope(deps.payload);
    const actor = await deps.resolveActiveSessionProfile(deps.session);
    const call = async (op: string, body: Record<string, unknown>, attachment = false) => {
      const { data, error } = await deps.supabase.rpc(attachment ? "sales_credit_attachment_v1" : action === "request_history" ? "request_history_command_v1" : "sales_credit_command_v1", {
        p_actor_id: actor.id, p_operation: op, p_payload: body,
        ...(!attachment ? { p_command_id: deps.payload.commandId || null, p_expected_revision: deps.payload.expectedRevision ?? null } : {}),
      });
      if (error) throw error;
      return data;
    };
    if (operation === "attachment_upload") {
      const photo = decodeCreditPhoto(payload);
      const sha256 = await hashBytes(photo.bytes);
      const attachment = await call("reserve", { id: deps.payload.commandId, sourceId: payload.sourceId, mime: photo.mime, size: photo.bytes.length, sha256, extension: photo.extension }, true);
      const { error } = await deps.supabase.storage.from(SALES_CREDIT_BUCKET).upload(attachment.object_path, photo.bytes, { contentType: photo.mime, upsert: false, cacheControl: "private, max-age=0" });
      if (error) {
        // A lost acknowledgement may leave an immutable object in place. Verify it,
        // rather than overwrite evidence or ask the user to retake the photograph.
        const existing = await deps.supabase.storage.from(SALES_CREDIT_BUCKET).download(attachment.object_path);
        if (existing.error || !existing.data || await hashBytes(new Uint8Array(await existing.data.arrayBuffer())) !== sha256) throw new Error("CREDIT_PHOTO_UPLOAD_FAILED_RETRY_SAME_PHOTO");
      }
      const saved = await call("finish", { id: attachment.id, sha256 }, true);
      return respond({ ok: true, data: { attachmentId: saved.id, sourceId: saved.source_id, mime: saved.mime, size: saved.byte_count } });
    }
    if (operation === "attachment_download") {
      const attachment = await call("download", payload, true);
      const { data, error } = await deps.supabase.storage.from(SALES_CREDIT_BUCKET).createSignedUrl(attachment.object_path, 60);
      if (error) throw error;
      return respond({ ok: true, data: { url: data.signedUrl, expiresIn: 60 } });
    }
    return respond({ ok: true, data: await call(operation, payload) });
  } catch (value) {
    const error = value as { code?: string; message?: string };
    const code = String(error.message || "SALES_WORKFLOW_FAILED");
    return respond({ ok: false, error: code, code }, salesErrorStatus(error));
  }
}
