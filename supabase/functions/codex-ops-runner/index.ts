import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  CODEX_OPS_BUCKET,
  jsonResponse,
  sanitizeErrorCode,
  sendCodexOpsPush,
  serviceClient,
} from "../_shared/codex-ops.ts";
import { approveCheckAndMerge } from "../_shared/github-app.ts";

type JsonRecord = Record<string, unknown>;
const admin = serviceClient();
let oidcMetadata: { jwks_uri?: string } | null = null;
let oidcKeys: JsonRecord[] = [];
let oidcKeysLoadedAt = 0;

function decodeBase64Url(value: string) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

function decodeJwtJson(value: string) {
  return JSON.parse(
    new TextDecoder().decode(decodeBase64Url(value)),
  ) as JsonRecord;
}

function expectedRepo() {
  const owner = String(
    Deno.env.get("CODEX_OPS_GITHUB_OWNER") || "collygedylan",
  ).trim();
  const repo = String(
    Deno.env.get("CODEX_OPS_GITHUB_REPO") || "GNC-Sales-Command-PRO-",
  ).trim();
  return `${owner}/${repo}`;
}

async function loadOidcKeys(force = false) {
  if (
    !force &&
    oidcKeys.length &&
    Date.now() - oidcKeysLoadedAt < 60 * 60 * 1000
  )
    return oidcKeys;
  if (!oidcMetadata) {
    const metadataResponse = await fetch(
      "https://token.actions.githubusercontent.com/.well-known/openid-configuration",
    );
    if (!metadataResponse.ok) throw new Error("CODEX_OPS_OIDC_METADATA_FAILED");
    oidcMetadata = await metadataResponse.json();
  }
  const keysResponse = await fetch(String(oidcMetadata?.jwks_uri || ""));
  if (!keysResponse.ok) throw new Error("CODEX_OPS_OIDC_KEYS_FAILED");
  const payload = await keysResponse.json();
  oidcKeys = Array.isArray(payload?.keys) ? payload.keys : [];
  oidcKeysLoadedAt = Date.now();
  return oidcKeys;
}

async function verifyGithubOidc(req: Request) {
  const token = String(req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("CODEX_OPS_OIDC_REQUIRED");
  const header = decodeJwtJson(parts[0]);
  const claims = decodeJwtJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid)
    throw new Error("CODEX_OPS_OIDC_HEADER_INVALID");
  let keys = await loadOidcKeys();
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await loadOidcKeys(true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw new Error("CODEX_OPS_OIDC_KEY_UNKNOWN");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new Error("CODEX_OPS_OIDC_SIGNATURE_INVALID");
  const now = Math.floor(Date.now() / 1000);
  const audience = String(
    Deno.env.get("CODEX_OPS_OIDC_AUDIENCE") || "gnc-codex-ops-v1",
  ).trim();
  const audiences = Array.isArray(claims.aud)
    ? claims.aud.map(String)
    : [String(claims.aud || "")];
  const repo = expectedRepo();
  const workflowRef = String(claims.workflow_ref || "");
  const requiredEnvironment = String(
    Deno.env.get("CODEX_OPS_GITHUB_ENVIRONMENT") || "codex-ops",
  ).trim();
  if (claims.iss !== "https://token.actions.githubusercontent.com")
    throw new Error("CODEX_OPS_OIDC_ISSUER_INVALID");
  if (!audiences.includes(audience))
    throw new Error("CODEX_OPS_OIDC_AUDIENCE_INVALID");
  if (Number(claims.exp || 0) <= now || Number(claims.nbf || 0) > now + 30)
    throw new Error("CODEX_OPS_OIDC_EXPIRED");
  if (
    claims.repository !== repo ||
    claims.repository_owner !== repo.split("/")[0]
  )
    throw new Error("CODEX_OPS_OIDC_REPOSITORY_INVALID");
  const allowedWorkflowRefs = [
    `${repo}/.github/workflows/codex-ops.yml@refs/heads/main`,
    `${repo}/.github/workflows/codex-ops-maintenance.yml@refs/heads/main`,
  ];
  if (!allowedWorkflowRefs.some((value) => workflowRef.startsWith(value)))
    throw new Error("CODEX_OPS_OIDC_WORKFLOW_INVALID");
  if (
    claims.ref !== "refs/heads/main" ||
    claims.event_name !== "workflow_dispatch"
  )
    throw new Error("CODEX_OPS_OIDC_REF_INVALID");
  if (requiredEnvironment && claims.environment !== requiredEnvironment)
    throw new Error("CODEX_OPS_OIDC_ENVIRONMENT_INVALID");
  if (
    claims.runner_environment &&
    claims.runner_environment !== "github-hosted"
  )
    throw new Error("CODEX_OPS_OIDC_RUNNER_INVALID");
  if (!/^[0-9a-f]{40}$/.test(String(claims.sha || "")))
    throw new Error("CODEX_OPS_OIDC_COMMIT_INVALID");
  return claims;
}

async function serviceEvent(
  taskId: string,
  revision: number,
  action: string,
  payload: JsonRecord = {},
) {
  const { data, error } = action === "repair.result"
    ? await admin.rpc("apply_codex_ops_repair_result_service_v2", {
      p_task_id: taskId,
      p_expected_revision: revision,
      p_payload: payload,
    })
    : await admin.rpc("apply_codex_ops_service_event_v1", {
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

async function runnerContext(
  taskId: string,
  revision: number,
  dispatchAction: string,
) {
  if (["diagnose", "sol_review"].includes(dispatchAction)) {
    await serviceEvent(taskId, revision, "runner.claim", { dispatchAction });
  }
  const { data, error } = await admin.rpc(
    "get_codex_ops_runner_context_service_v1",
    {
      p_task_id: taskId,
      p_expected_revision: revision,
    },
  );
  if (error || !data)
    throw new Error(String(error?.message || "CODEX_OPS_CONTEXT_FAILED"));
  const context = data as JsonRecord;
  const attachments = Array.isArray(context.attachments)
    ? (context.attachments as JsonRecord[])
    : [];
  context.attachments = await Promise.all(
    attachments.map(async (attachment) => {
      const objectPath = String(attachment.objectPath || "");
      const { data: signed, error: signedError } = await admin.storage
        .from(CODEX_OPS_BUCKET)
        .createSignedUrl(objectPath, 600);
      if (signedError || !signed?.signedUrl)
        throw new Error("CODEX_OPS_EVIDENCE_SIGN_FAILED");
      const { objectPath: _removed, ...safe } = attachment;
      return { ...safe, evidenceUrl: signed.signedUrl, expiresInSeconds: 600 };
    }),
  );
  return context;
}

function sanitizedAgentPayload(body: JsonRecord) {
  const allowed = [
    "summary",
    "reproduced",
    "fingerprint",
    "risk",
    "affectedFiles",
    "requiredTests",
    "needsInput",
    "escalationRequired",
    "repairAllowed",
    "changedFiles",
    "tests",
    "pathPolicyPassed",
    "requiredChecksPassed",
    "branch",
    "pullRequestNumber",
    "pullRequestUrl",
    "headSha",
    "errorCode",
    "mergedSha",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => Object.prototype.hasOwnProperty.call(body, key))
      .map((key) => [key, body[key]]),
  );
}

async function cleanupExpiredEvidence() {
  const { data, error } = await admin.rpc(
    "list_expired_codex_ops_evidence_service_v1",
    { p_limit: 100 },
  );
  if (error) throw new Error("CODEX_OPS_CLEANUP_LIST_FAILED");
  const rows = Array.isArray(data) ? (data as JsonRecord[]) : [];
  let deleted = 0;
  for (const row of rows) {
    const taskId = String(row.taskId || "");
    const revision = Number(row.revision || 0);
    const path = String(row.objectPath || "");
    const attachmentId = String(row.attachmentId || "");
    const { error: removeError } = await admin.storage
      .from(CODEX_OPS_BUCKET)
      .remove([path]);
    if (removeError) continue;
    await serviceEvent(taskId, revision, "attachment.delete", { attachmentId });
    deleted += 1;
  }
  return { deleted };
}

serve(async (req) => {
  if (req.method !== "POST")
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const claims = await verifyGithubOidc(req);
    const body = (await req.json()) as JsonRecord;
    const operation = String(body.operation || "");
    const taskId = String(body.taskId || "");
    const revision = Number(body.revision || 0);
    const workflowRef = String(claims.workflow_ref || "");
    if (operation === "cleanup") {
      if (
        !workflowRef.includes("/.github/workflows/codex-ops-maintenance.yml@")
      )
        throw new Error("CODEX_OPS_OIDC_WORKFLOW_INVALID");
      return jsonResponse(await cleanupExpiredEvidence());
    }
    if (!workflowRef.includes("/.github/workflows/codex-ops.yml@"))
      throw new Error("CODEX_OPS_OIDC_WORKFLOW_INVALID");
    if (
      !/^[0-9a-f-]{36}$/i.test(taskId) ||
      !Number.isInteger(revision) ||
      revision < 1
    )
      throw new Error("CODEX_OPS_RUNNER_INPUT_INVALID");
    if (operation === "context")
      return jsonResponse(
        await runnerContext(
          taskId,
          revision,
          String(body.dispatchAction || "diagnose"),
        ),
      );
    if (operation === "rollback-merge") {
      const { data: context, error } = await admin.rpc(
        "get_codex_ops_runner_context_service_v1",
        {
          p_task_id: taskId,
          p_expected_revision: revision,
        },
      );
      if (
        error ||
        !context ||
        context.rollbackAuthorized !== true ||
        String(context.status) !== "failed"
      ) {
        throw new Error("CODEX_OPS_ROLLBACK_NOT_AUTHORIZED");
      }
      const rollbackSha = String(body.headSha || "").toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(rollbackSha))
        throw new Error("CODEX_OPS_SHA_INVALID");
      const mergedSha = await approveCheckAndMerge(
        Number(body.pullRequestNumber),
        rollbackSha,
      );
      return jsonResponse({ taskId, revision, rollbackMergedSha: mergedSha });
    }
    if (operation === "result") {
      const stage = String(body.stage || "");
      const action =
        stage === "diagnosis"
          ? "diagnosis.result"
          : stage === "repair"
            ? "repair.result"
            : stage === "publish"
              ? "publish.result"
              : stage === "live"
                ? "deployment.live"
                : stage === "failed"
                  ? "deployment.failed"
                  : stage === "reverted"
                    ? "deployment.reverted"
                    : "";
      if (!action) throw new Error("CODEX_OPS_RUNNER_STAGE_INVALID");
      const result = await serviceEvent(
        taskId,
        revision,
        action,
        sanitizedAgentPayload((body.result || {}) as JsonRecord),
      );
      const status = String(result.status || "");
      if (status === "needs_input")
        await sendCodexOpsPush("codex_ops_needs_input", taskId);
      if (status === "ready_for_approval")
        await sendCodexOpsPush("codex_ops_ready", taskId);
      if (status === "live") await sendCodexOpsPush("codex_ops_live", taskId);
      if (status === "failed" || status === "blocked")
        await sendCodexOpsPush("codex_ops_failed", taskId);
      if (status === "reverted")
        await sendCodexOpsPush("codex_ops_reverted", taskId);
      return jsonResponse(result);
    }
    return jsonResponse({ error: "CODEX_OPS_RUNNER_OPERATION_INVALID" }, 400);
  } catch (error) {
    const code = sanitizeErrorCode(error);
    const status = /OIDC/.test(code) ? 403 : /REVISION/.test(code) ? 409 : 400;
    return jsonResponse({ error: code }, status);
  }
});
