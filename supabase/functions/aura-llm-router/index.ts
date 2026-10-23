import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObservedRequest } from "../_shared/observability.ts";
import { handleAuraVoiceRequest, isDeterministicAuraInventoryQuestion, type AuraVoiceDeps } from "../_shared/aura-voice-handler.ts";
import { auraVoiceProductionDeps, handleAuraProviderProbe } from "../_shared/aura-voice-store.ts";

/** Authenticated Gemini tool router. The legacy aura-query route remains deterministic. */
export async function handleAuraLlmRequest(request: Request, deps: AuraVoiceDeps = auraVoiceProductionDeps) {
  if (new URL(request.url).pathname.endsWith("/aura-llm-router/health")) return handleAuraProviderProbe(request);
  const fallbackRequest = request.clone();
  const response = await handleAuraVoiceRequest(request, deps);
  if (response.status !== 503) return response;
  const body = await fallbackRequest.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || String(body.mode || "command") !== "command") return response;
  const question = body.text ?? body.question ?? body.prompt;
  const deterministicFallbackRequired = isDeterministicAuraInventoryQuestion(question);
  const reply = deterministicFallbackRequired
    ? "I am resolving that from the latest verified inventory snapshot."
    : "Aura could not finish that command, but your conversation is ready to retry.";
  return Response.json({ ok: true, code: deterministicFallbackRequired ? "AURA_DETERMINISTIC_FALLBACK_REQUIRED" : "AURA_COMMAND_RETRY_READY",
    deterministicFallbackRequired, reply, speech: reply, actions: [],
    interpretation: { engine: "router-fallback-v1", complete: false }, source: { kind: "router-fallback", complete: false } },
  { status: 200, headers: response.headers });
}

if (import.meta.main) {
  serve((request) => withObservedRequest("aura-llm-router", request, async () =>
    await handleAuraLlmRequest(request), { action: "aura_voice" }));
}
