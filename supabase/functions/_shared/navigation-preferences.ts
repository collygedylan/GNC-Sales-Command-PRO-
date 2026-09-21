/** Module visibility never grants a protected action or broadens row ownership. */
export type NavigationActor = Record<string, unknown> & { id?: unknown };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export async function resolveModuleAllowed(db: RpcClient, actor: NavigationActor, view: string): Promise<boolean> {
  if (!actor?.id) return false;
  const { data, error } = await db.rpc("navigation_module_allowed_v1", {
    p_actor_id: String(actor.id), p_view: view,
  });
  if (error) throw error;
  return data === true;
}

/** Pass only a profile resolved from the verified session, never submitted actor fields. */
export async function handleNavigationPreferences(db: RpcClient, actor: NavigationActor, input: Record<string, unknown>) {
  if (!actor?.id) throw new Error("NAVIGATION_AUTH_REQUIRED");
  const allowed = new Set(["action", "operation", "payload", "commandId", "expectedRevision"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("NAVIGATION_PAYLOAD_INVALID");
  const { data, error } = await db.rpc("navigation_preferences_command_v1", {
    p_actor_id: String(actor.id), p_operation: String(input.operation || "get"),
    p_payload: input.payload || {}, p_command_id: input.commandId || null,
    p_expected_revision: input.expectedRevision ?? null,
  });
  if (error) throw error;
  return data;
}
