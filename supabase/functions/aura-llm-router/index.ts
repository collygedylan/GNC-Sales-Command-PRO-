import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObservedRequest } from "../_shared/observability.ts";
import { handleAuraVoiceRequest, type AuraVoiceDeps } from "../_shared/aura-voice-handler.ts";
import { auraVoiceProductionDeps, handleAuraProviderProbe } from "../_shared/aura-voice-store.ts";

/** Authenticated Gemini tool router. The legacy aura-query route remains deterministic. */
export function handleAuraLlmRequest(request: Request, deps: AuraVoiceDeps = auraVoiceProductionDeps) {
  if (new URL(request.url).pathname.endsWith("/aura-llm-router/health")) return handleAuraProviderProbe(request);
  return handleAuraVoiceRequest(request, deps);
}

if (import.meta.main) {
  serve((request) => withObservedRequest("aura-llm-router", request, async () =>
    await handleAuraLlmRequest(request), { action: "aura_voice" }));
}
