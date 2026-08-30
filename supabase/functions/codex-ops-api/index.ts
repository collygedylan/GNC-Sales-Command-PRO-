import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  CODEX_OPS_BUCKET,
  corsHeaders,
  detectEvidenceMime,
  jsonResponse,
  mediaKindForMime,
  requireNativeDylan,
  safeEvidenceName,
  sanitizeErrorCode,
  serviceClient,
  userClient,
  validateEvidenceSize,
} from "../_shared/codex-ops.ts";
import {
  approveCheckAndMerge,
  dispatchCodexWorkflow,
} from "../_shared/github-app.ts";

type JsonRecord = Record<string, unknown>;
const admin = serviceClient();

async function userRpc(req: Request, name: string, args: JsonRecord = {}) {
  const { data, error } = await userClient(req).rpc(name, args);
  if (error)
    throw new Error(
      String(error.message || error.code || "CODEX_OPS_RPC_FAILED"),
    );
  return data;
}

async function serviceEvent(
  taskId: string,
  revision: number,
  action: string,
  payload: JsonRecord = {},
) {
  const { data, error } = await admin.rpc("apply_codex_ops_service_event_v1", {
    p_task_id: taskId,
    p_expected_revision: revision,
    p_action: action,
    p_payload: payload,
  });
  if (error)
    throw new Error(
      String(error.message || error.code || "CODEX_OPS_SERVICE_EVENT_FAILED"),
    );
  return data as JsonRecord;
}

async function verifiedTask(req: Request, taskId: string) {
  const taskData = await userRpc(req, "get_codex_ops_task_v1", {
    p_task_id: taskId,
    p_after_event_id: 0,
    p_event_limit: 1,
  });
  return (taskData as JsonRecord)?.task as JsonRecord;
}

async function beginAttachment(req: Request, body: JsonRecord) {
  const taskId = String(body.taskId || "");
  const task = await verifiedTask(req, taskId);
  const revision = Number(body.revision);
  if (Number(task?.revision) !== revision)
    throw new Error("CODEX_OPS_REVISION_CONFLICT");
  const id = crypto.randomUUID();
  const mime = String(body.mime || "").toLowerCase();
  const kind = mediaKindForMime(mime);
  if (!kind) throw new Error("CODEX_OPS_MEDIA_INVALID");
  const name = safeEvidenceName(body.name);
  const objectPath = `tasks/${taskId}/${id}/${name}`;
  await serviceEvent(taskId, revision, "attachment.register", {
    id,
    idempotencyKey: String(body.idempotencyKey || ""),
    mediaKind: kind,
    name,
    declaredMime: mime,
    objectPath,
  });
  const { data, error } = await admin.storage
    .from(CODEX_OPS_BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (error || !data?.token) throw new Error("CODEX_OPS_SIGNED_UPLOAD_FAILED");
  return {
    attachmentId: id,
    path: objectPath,
    token: data.token,
    signedUrl: data.signedUrl,
    mediaKind: kind,
  };
}

async function finalizeAttachment(req: Request, body: JsonRecord) {
  const taskId = String(body.taskId || "");
  const task = await verifiedTask(req, taskId);
  const revision = Number(body.revision);
  if (Number(task?.revision) !== revision)
    throw new Error("CODEX_OPS_REVISION_CONFLICT");
  const attachmentId = String(body.attachmentId || "");
  const path = String(body.path || "");
  if (!path.startsWith(`tasks/${taskId}/${attachmentId}/`))
    throw new Error("CODEX_OPS_ATTACHMENT_SCOPE_INVALID");
  const directory = path.slice(0, path.lastIndexOf("/"));
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed, error: listError } = await admin.storage
    .from(CODEX_OPS_BUCKET)
    .list(directory, { search: filename, limit: 2 });
  const object = listed?.find((entry: { name: string }) => entry.name === filename);
  const size = Number(object?.metadata?.size || 0);
  const { data: signed, error: signedError } = await admin.storage
    .from(CODEX_OPS_BUCKET)
    .createSignedUrl(path, 90);
  if (listError || signedError || !object || !signed?.signedUrl)
    throw new Error("CODEX_OPS_ATTACHMENT_MISSING");
  const response = await fetch(signed.signedUrl, {
    headers: { Range: "bytes=0-511" },
  });
  if (!response.ok) throw new Error("CODEX_OPS_SIGNATURE_READ_FAILED");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const detectedMime = detectEvidenceMime(bytes);
  const kind = mediaKindForMime(detectedMime);
  if (!detectedMime || !validateEvidenceSize(kind, size)) {
    await admin.storage.from(CODEX_OPS_BUCKET).remove([path]);
    await serviceEvent(taskId, revision, "attachment.reject", {
      attachmentId,
      rejectionCode: detectedMime ? "SIZE_INVALID" : "SIGNATURE_MISMATCH",
    });
    throw new Error(
      detectedMime
        ? "CODEX_OPS_ATTACHMENT_SIZE_INVALID"
        : "CODEX_OPS_SIGNATURE_MISMATCH",
    );
  }
  await serviceEvent(taskId, revision, "attachment.verify", {
    attachmentId,
    detectedMime,
    sizeBytes: size,
    etag: String(object?.metadata?.eTag || object?.metadata?.etag || ""),
  });
  return { attachmentId, detectedMime, sizeBytes: size, verified: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    await requireNativeDylan(req, admin);
    const body = (await req.json()) as JsonRecord;
    const action = String(body.action || "");
    if (action === "capabilities")
      return jsonResponse(await userRpc(req, "get_codex_ops_capabilities_v1"));
    if (action === "list")
      return jsonResponse(
        await userRpc(req, "list_codex_ops_tasks_v1", {
          p_before: body.before || null,
          p_limit: body.limit || 20,
        }),
      );
    if (action === "get")
      return jsonResponse(
        await userRpc(req, "get_codex_ops_task_v1", {
          p_task_id: body.taskId,
          p_after_event_id: body.afterEventId || 0,
          p_event_limit: body.eventLimit || 100,
        }),
      );
    if (action === "create")
      return jsonResponse(
        await userRpc(req, "create_codex_ops_task_v1", {
          p_description: body.description,
          p_idempotency_key: body.idempotencyKey,
        }),
      );
    if (action === "message")
      return jsonResponse(
        await userRpc(req, "add_codex_ops_message_v1", {
          p_task_id: body.taskId,
          p_expected_revision: body.revision,
          p_body: body.message,
          p_idempotency_key: body.idempotencyKey,
        }),
      );
    if (action === "cancel")
      return jsonResponse(
        await userRpc(req, "cancel_codex_ops_task_v1", {
          p_task_id: body.taskId,
          p_expected_revision: body.revision,
          p_idempotency_key: body.idempotencyKey,
        }),
      );
    if (action === "escalate")
      return jsonResponse(
        await userRpc(req, "request_codex_ops_escalation_v1", {
          p_task_id: body.taskId,
          p_expected_revision: body.revision,
          p_reason: body.reason,
          p_idempotency_key: body.idempotencyKey,
        }),
      );
    if (action === "begin-upload")
      return jsonResponse(await beginAttachment(req, body));
    if (action === "finalize-upload")
      return jsonResponse(await finalizeAttachment(req, body));
    if (action === "dispatch") {
      const task = await verifiedTask(req, String(body.taskId || ""));
      if (Number(task?.revision) !== Number(body.revision))
        throw new Error("CODEX_OPS_REVISION_CONFLICT");
      const dispatchAction = String(body.dispatchAction || "diagnose");
      if (!["diagnose", "sol_review"].includes(dispatchAction))
        throw new Error("CODEX_OPS_DISPATCH_INVALID");
      await serviceEvent(
        String(body.taskId),
        Number(body.revision),
        "dispatch.queue",
        {
          dispatchAction,
          idempotencyKey: String(body.idempotencyKey || ""),
        },
      );
      await dispatchCodexWorkflow(
        String(body.taskId),
        Number(body.revision),
        dispatchAction,
      );
      return jsonResponse({
        ok: true,
        taskId: body.taskId,
        revision: body.revision,
        action: dispatchAction,
      });
    }
    if (action === "approve") {
      const task = await verifiedTask(req, String(body.taskId || ""));
      const expectedSha = String(body.headSha || "").toLowerCase();
      if (String(task?.headSha || "").toLowerCase() !== expectedSha)
        throw new Error("CODEX_OPS_HEAD_CHANGED");
      const approval = await userRpc(req, "approve_codex_ops_deployment_v1", {
        p_task_id: body.taskId,
        p_expected_revision: body.revision,
        p_head_sha: expectedSha,
        p_idempotency_key: body.idempotencyKey,
      });
      const mergedSha = await approveCheckAndMerge(
        Number(task.pullRequestNumber),
        expectedSha,
      );
      await serviceEvent(
        String(body.taskId),
        Number(body.revision),
        "deployment.merged",
        { mergedSha },
      );
      await dispatchCodexWorkflow(
        String(body.taskId),
        Number(body.revision),
        "verify",
      );
      return jsonResponse(approval);
    }
    return jsonResponse({ error: "CODEX_OPS_ACTION_INVALID" }, 400);
  } catch (error) {
    const code = sanitizeErrorCode(error);
    const status = /AUTH_REQUIRED|DYLAN_ONLY/.test(code)
      ? 403
      : /NOT_FOUND/.test(code)
        ? 404
        : /REVISION|HEAD_CHANGED/.test(code)
          ? 409
          : 400;
    return jsonResponse({ error: code }, status);
  }
});
