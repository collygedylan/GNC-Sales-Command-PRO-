import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "../_shared/database.types.ts";
import { jsonObject, jsonValue } from "../../../services/database-contract-runtime.ts";
import { RECLASS_EDITABLE_FIELDS_POLICY } from "../../../services/reclassEditableFields.ts";
import { RECLASS_SMART_SHIELD_POLICY } from "../../../services/reclassSmartShield.ts";
import { RECLASS_SHEARED_POLICY } from "../../../services/reclassSheared.ts";

export type InquiryRecord = Record<string, unknown>;
export type InquiryDatabase = Pick<SupabaseClient<Database>, "rpc" | "from">;
type RpcReply = { data: unknown; error: { message?: string } | null };

export async function invokeReclassInquiryRpc(db: InquiryDatabase, name: string, args: InquiryRecord): Promise<RpcReply> {
  const invoke = db.rpc.bind(db) as unknown as Function;
  return await invoke(name, args);
}

export async function authorizeReclassInquiry(db: InquiryDatabase, actor: InquiryRecord, payload: InquiryRecord): Promise<void> {
  const actorId = String(actor.id || "").trim();
  const username = String(actor.username || "").trim().toLowerCase();
  if (!actorId || !username || username !== String(payload.actorUsername || "").trim().toLowerCase()) {
    throw new Error("DRIVE_RECLASS_ACTOR_REQUIRED");
  }
  const { data, error } = await invokeReclassInquiryRpc(db, "authorize_reclass_command_v3076", {
    p_actor_id: actorId, p_command: { ...payload, action: "drive_reclass_inquiry", operation: "create" },
  });
  if (error) throw new Error(error.message || "DRIVE_RECLASS_FORBIDDEN");
  if (data !== true) throw new Error("DRIVE_RECLASS_FORBIDDEN");
}

function reclassInquiryEnqueueRpc(payload: InquiryRecord): string {
  const versions: Record<string, string> = {
    [RECLASS_EDITABLE_FIELDS_POLICY]: "enqueue_drive_reclass_inquiry_v7",
    [RECLASS_SMART_SHIELD_POLICY]: "enqueue_drive_reclass_inquiry_v6",
    [RECLASS_SHEARED_POLICY]: "enqueue_drive_reclass_inquiry_v5",
    "reclass-action-workflow-v4-split-moves-20261006": "enqueue_drive_reclass_inquiry_v4",
  };
  return versions[String(payload.workflowPolicyVersion || "")] || "enqueue_drive_reclass_inquiry_v1";
}

export async function enqueueReclassInquiry(db: InquiryDatabase, payload: InquiryRecord): Promise<InquiryRecord> {
  const name = reclassInquiryEnqueueRpc(payload);
  const args = { p_payload: jsonValue(payload) };
  let reply = await invokeReclassInquiryRpc(db, name, args);
  if (reply.error && /V[567]_.*(?:STALE|SNAPSHOT_CONFLICT|LIVE_EDIT_CONFLICT)|MASTER_SNAPSHOT_NOT_READY|MASTER_IMPORT_FENCE_EXPIRED|Inventory changed while reading/i.test(reply.error.message || "")) {
    reply = await invokeReclassInquiryRpc(db, name, args);
  }
  if (reply.error) throw new Error(reply.error.message || "DRIVE_RECLASS_SERVICE_UNAVAILABLE");
  return jsonObject(reply.data);
}

export async function recoverReclassInquiryReceipt(
  db: InquiryDatabase, result: InquiryRecord, actorUsername: string, normalizeUsername: Function,
): Promise<InquiryRecord> {
  const jobId = String(result.jobId || result.job_id || "").trim();
  if (!jobId || !actorUsername) return result;
  const { data: event, error } = await db.from("ph_request_delivery_outbox")
    .select("payload").eq("event_id", jobId).eq("event_type", "reclass_inquiry").maybeSingle();
  if (error || !event) return result;
  const inquiry = jsonObject(jsonObject(event?.payload).reclassPayload);
  if (normalizeUsername(String(jsonObject(inquiry.actor).username || "")) !== actorUsername) return result;
  const receipt = jsonObject(inquiry.protectedDelivery);
  if (!Array.isArray(receipt.liveEdits)) return result;
  for (const field of ["liveEdits", "inventoryRevision", "liveEditScope", "inventoryFields", "v7Scope"]) {
    if (receipt[field] !== undefined) result[field] = receipt[field];
  }
  return result;
}
