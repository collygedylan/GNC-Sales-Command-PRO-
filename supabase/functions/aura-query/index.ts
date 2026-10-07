import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObservedRequest } from "../_shared/observability.ts";
import { handleAuraQueryRequest } from "../_shared/aura-query-handler.ts";

export { handleAuraQueryRequest } from "../_shared/aura-query-handler.ts";

if (import.meta.main) {
  serve((request) => withObservedRequest("aura-query", request, async () =>
    await handleAuraQueryRequest(request) || new Response("AURA unavailable", { status: 500 }), { action: "aura_query" }));
}
