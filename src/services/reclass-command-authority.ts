import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;
type RpcClient = Pick<SupabaseClient, "rpc">;

/** The caller supplies the profile resolved from its authenticated session. */
export async function requireReclassCommandAuthority(db: RpcClient, actorId: string, command: JsonRecord): Promise<void> {
  const { data, error } = await db.rpc("authorize_reclass_command_v3076", {
    p_actor_id: actorId, p_command: command,
  });
  if (error) throw error;
  if (data !== true) throw new Error("INVENTORY_RECLASS_PERMISSION_REQUIRED");
}
