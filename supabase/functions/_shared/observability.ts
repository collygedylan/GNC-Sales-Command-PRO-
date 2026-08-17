const MAX_LOG_BYTES = 2048;
const SUCCESS_SAMPLE_RATE = 0.01;

function normalizeErrorCode(value: unknown) {
  const text = String(value instanceof Error ? value.name : value || "unknown_error")
    .trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return text.slice(0, 64) || "unknown_error";
}

function emitLog(level: "info" | "error", value: Record<string, unknown>) {
  let serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_LOG_BYTES) {
    serialized = JSON.stringify({
      request_id: value.request_id,
      function: value.function,
      action: value.action,
      status: value.status,
      duration_ms: value.duration_ms,
      release: value.release,
      error_code: value.error_code,
      truncated: true,
    });
  }
  (level === "error" ? console.error : console.info)(serialized);
}

export function recordHandledError(functionName: string, action: string, error: unknown, status = 500) {
  emitLog("error", {
    request_id: crypto.randomUUID(),
    function: String(functionName || "unknown").slice(0, 64),
    action: String(action || "request").slice(0, 64),
    status,
    duration_ms: 0,
    retry_count: 0,
    release: "V2026.08.16.11",
    error_code: normalizeErrorCode(error),
    handled: true,
  });
}

async function readAction(req: Request) {
  if (!String(req.headers.get("content-type") || "").includes("application/json")) return "request";
  try {
    const payload = await req.clone().json();
    return String(payload?.action || payload?.eventType || payload?.type || "request")
      .trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 64) || "request";
  } catch (_error) {
    return "request";
  }
}

export async function withObservedRequest(
  functionName: string,
  req: Request,
  handler: () => Promise<Response>,
) {
  const requestId = String(req.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 96);
  const startedAt = performance.now();
  const action = await readAction(req);
  try {
    const response = await handler();
    const status = response.status;
    if (status >= 400 || Math.random() < SUCCESS_SAMPLE_RATE) {
      emitLog(status >= 500 ? "error" : "info", {
        request_id: requestId,
        function: functionName,
        action,
        status,
        duration_ms: Math.round(performance.now() - startedAt),
        retry_count: Number(req.headers.get("x-retry-count") || 0),
        release: "V2026.08.16.11",
        error_code: status >= 400 ? `http_${status}` : null,
      });
    }
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    emitLog("error", {
      request_id: requestId,
      function: functionName,
      action,
      status: 500,
      duration_ms: Math.round(performance.now() - startedAt),
      retry_count: Number(req.headers.get("x-retry-count") || 0),
      release: "V2026.08.16.11",
      error_code: normalizeErrorCode(error),
    });
    return new Response(JSON.stringify({ error: "Internal server error", requestId }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
}
