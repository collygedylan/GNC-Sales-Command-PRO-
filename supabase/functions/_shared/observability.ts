const MAX_LOG_BYTES = 2048;
const SUCCESS_SAMPLE_RATE = 0.01;

function normalizeErrorCode(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const message = String(source.message || (value instanceof Error ? value.message : ""));
  const messageToken = message.match(/\b(?:eval_work|request|drive|pikes|av_read)_[a-z0-9_]+\b/i)?.[0] || "";
  const candidate = value instanceof Error
    ? (messageToken || value.name)
    : (source.code || messageToken || "unknown_error");
  const text = String(candidate || "unknown_error")
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
      sqlstate: value.sqlstate,
      timeout_stage: value.timeout_stage,
      dataset: value.dataset,
      denial_stage: value.denial_stage,
      truncated: true,
    });
  }
  (level === "error" ? console.error : console.info)(serialized);
}

export function recordHandledError(
  functionName: string,
  action: string,
  error: unknown,
  status = 500,
  diagnostics: {
    requestId?: string; durationMs?: number; sqlState?: string | null; timeoutStage?: string | null;
    dataset?: string | null; denialStage?: string | null;
  } = {},
) {
  const dataset = ["reserves", "notes", "hot_prices", "settings"].includes(String(diagnostics.dataset || ""))
    ? String(diagnostics.dataset) : "";
  const denialStage = ["authorization", "database", "validation", "upstream"].includes(String(diagnostics.denialStage || ""))
    ? String(diagnostics.denialStage) : "";
  emitLog("error", {
    request_id: String(diagnostics.requestId || crypto.randomUUID()).slice(0, 96),
    function: String(functionName || "unknown").slice(0, 64),
    action: String(action || "request").slice(0, 64),
    status,
    duration_ms: Number.isFinite(diagnostics.durationMs) ? Math.max(0, Math.round(diagnostics.durationMs!)) : 0,
    retry_count: 0,
    release: "V2026.08.16.14",
    error_code: normalizeErrorCode(error),
    sqlstate: /^[0-9A-Z]{5}$/.test(String(diagnostics.sqlState || "")) ? diagnostics.sqlState : null,
    timeout_stage: String(diagnostics.timeoutStage || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || null,
    ...(dataset ? { dataset } : {}),
    ...(denialStage ? { denial_stage: denialStage } : {}),
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
  options: { action?: string } = {},
) {
  const requestId = String(req.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 96);
  const startedAt = performance.now();
  // Bounded body handlers provide a fixed action so instrumentation does not
  // consume an unbounded cloned stream before their request deadline starts.
  const action = options.action
    ? String(options.action).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64)
    : await readAction(req);
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
        release: "V2026.08.16.14",
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
      release: "V2026.08.16.14",
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
