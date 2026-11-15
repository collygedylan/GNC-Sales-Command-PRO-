const cacheableReads = new WeakSet<object>();
export function cacheablePreferenceRead<T>(value: T): T {
  if (value && typeof value === "object") cacheableReads.add(value);
  return value;
}

export function createJsonResponder(
  cors: Record<string, string>, version: string,
  replacer: NonNullable<Parameters<typeof JSON.parse>[1]>,
) {
  return (body: unknown, status = 200) => {
    const versionedBody = body && typeof body === "object" && !Array.isArray(body)
      ? { ...body, app_version: version } : body;
    const data = body && typeof body === "object" && "data" in body ? body.data : null;
    const cacheable = status === 200 && !!data && typeof data === "object" && cacheableReads.has(data);
    return new Response(JSON.stringify(versionedBody, replacer), {
      status,
      headers: { ...cors, "Content-Type": "application/json",
        "Cache-Control": cacheable ? "private, max-age=120" : "private, no-store",
        "Vary": "Origin, Authorization, x-app-session, x-gnc-session" },
    });
  };
}

export function readOnlyPollResponse(response: Response, payload: Record<string, unknown>) {
  const read = payload.action === "dataset_revisions"
    || payload.action === "navigation_preferences" && payload.operation === "get"
    || payload.action === "photo_history" && payload.operation === "status";
  if (!read || response.status !== 200) return response;
  response.headers.set("Cache-Control", "private, max-age=120");
  response.headers.set("Vary", "Origin, Authorization, x-app-session, x-gnc-session");
  return response;
}
