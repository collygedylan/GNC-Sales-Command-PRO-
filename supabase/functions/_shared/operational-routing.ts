import type { Database } from "./database.types.ts";

type Operation = Database["public"]["Functions"]["resolve_operational_recipients_v1"];
type RoutingClient = {
  rpc: (name: "resolve_operational_recipients_v1", args: Operation["Args"]) => PromiseLike<{
    data: Operation["Returns"] | null;
    error: { message?: string } | null;
  }>;
};

// Resolve at delivery time, never when a retry job is first enqueued. The
// database owns the transition/cutoff and verified identity mapping.
export async function resolveOperationalRecipients(client: RoutingClient, recipients: string[], kind: "email" | "username") {
  if (recipients.length > 1000) throw new Error("RECIPIENT_LIMIT_EXCEEDED");
  const { data, error } = await client.rpc("resolve_operational_recipients_v1", {
    p_recipients: recipients,
    p_kind: kind,
  });
  if (error || !Array.isArray(data) || data.some((entry) => typeof entry !== "string")) {
    // Sending to an old recipient list on resolver failure defeats offboarding.
    throw new Error("RECIPIENT_RESOLUTION_UNAVAILABLE");
  }
  return [...new Set(data)];
}
