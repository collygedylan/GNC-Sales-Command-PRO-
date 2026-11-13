import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "../_shared/database.types.ts";

type RequestIdentity = { unique_id?: unknown; date_completed?: unknown; req_status?: unknown; req_archived?: unknown };
type DeliveryDatabase = Pick<SupabaseClient<Database>, "from">;

export async function readPendingRequestDeliveryStatus(db: DeliveryDatabase, rows: RequestIdentity[]) {
  const ids = [...new Set(rows.filter(row => !row.date_completed && row.req_archived !== true
    && ["", "pending", "open"].includes(String(row.req_status || "").trim().toLowerCase())
    && typeof row.unique_id === "string" && row.unique_id.startsWith("REQ-"))
    .map(row => String(row.unique_id)))].slice(0, 40);
  if (!ids.length) return [];
  try {
    const { data, error } = await db.from("ph_request_delivery_status")
      .select("request_id,delivery_status,delivery_attempt_count,delivery_display_state")
      .eq("event_type", "new_request").in("request_id", ids).limit(ids.length)
      .abortSignal(AbortSignal.timeout(1200));
    return error ? [] : data || [];
  } catch {
    return [];
  }
}

export function queueRequestOutboxReconciliation(
  reconcile: () => PromiseLike<{ error: { code?: string; message?: string } | null }>,
) {
  const runtime = Reflect.get(globalThis, "EdgeRuntime");
  if (!runtime) return;
  runtime.waitUntil(Promise.resolve().then(reconcile).then(({ error }) => {
    if (error) console.warn("REQUEST_OUTBOX_RECONCILIATION_DEFERRED", error.code || error.message);
  }).catch(error => console.warn("REQUEST_OUTBOX_RECONCILIATION_DEFERRED", error instanceof Error ? error.message : String(error))));
}
