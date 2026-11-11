import type { CanonicalUserAccessFlag } from "../_shared/canonical-user-access.ts";
import { handleInventoryReclassMove as executeInventoryReclassMove } from "../_shared/production-workflow.ts";
import { requireReclassCommandAuthority } from "../../../src/services/reclass-command-authority.ts";

type JsonRecord = Record<string, unknown>;
export type CanonicalActionGate = { flag: CanonicalUserAccessFlag } | { any: readonly CanonicalUserAccessFlag[] };

export function reclassActionGate(action: string, payload: JsonRecord): { gate: CanonicalActionGate | null } | null {
  if (action === "inventory_reclass_move") return { gate: null };
  if (action !== "drive_reclass_inquiry") return null;
  return { gate: String(payload.operation || "create").trim().toLowerCase() === "create"
    ? null : { flag: "can_access_drive_mode" } };
}

export async function handleInventoryReclassMove(context: Parameters<typeof executeInventoryReclassMove>[0]) {
  if (context.payload.operation === "status") {
    await requireReclassCommandAuthority(context.supabase as unknown as Parameters<typeof requireReclassCommandAuthority>[0],
      String(context.actorProfile.id || ""), { action: "inventory_reclass_move", operation: "status", commandId: context.payload.commandId });
  }
  return await executeInventoryReclassMove(context);
}
