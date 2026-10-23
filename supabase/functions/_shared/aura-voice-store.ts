import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { jsonValue } from "../../../services/database-contract-runtime.ts";
import { AURA_GEMINI_MODEL, AURA_PROVIDER_TIMEOUT_MS, AuraGeminiProviderError, auraObject, routeAuraWithGemini, type AuraActor } from "./aura-gemini.ts";
import type { AuraVoiceDeps, AuraVoiceStore } from "./aura-voice-handler.ts";
import { auraVoice, parseAuraGlossary } from "./aura-domain.ts";
import { synthesizeAuraSpeech, AURA_TTS_MODEL } from "./aura-speech.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseAuraAccess(value: unknown, expectedId: string): AuraActor | null {
  const access = auraObject(value);
  if (access.ok !== true) return null;
  const actor = auraObject(access.actor), capabilities = auraObject(access.capabilities);
  if (capabilities.auraEnabled !== true) return null;
  if (actor.id !== expectedId || !UUID.test(expectedId) || typeof actor.username !== "string" || !actor.username.trim()
    || typeof actor.role !== "string" || !actor.role.trim()) return null;
  for (const key of ["inventory", "history", "drafts"]) if (typeof capabilities[key] !== "boolean") return null;
  for (const key of ["socReserves", "socOpenOrders"]) if (capabilities[key] !== undefined && typeof capabilities[key] !== "boolean") return null;
  if (!capabilities.inventory && !capabilities.history && !capabilities.socReserves && !capabilities.socOpenOrders) return null;
  return { id: expectedId, username: actor.username, role: actor.role.trim().toUpperCase(), inventory: capabilities.inventory === true,
    history: capabilities.history === true, drafts: capabilities.drafts === true, socReserves: capabilities.socReserves === true, socOpenOrders: capabilities.socOpenOrders === true };
}
function env(name: string) { return String(Deno.env.get(name) || "").trim(); }
function required(name: string) { const value = env(name); if (!value) throw new Error("AURA_CONFIGURATION_UNAVAILABLE"); return value; }
function isSupabaseUserBearer(value: string) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))) as { role?: unknown };
    return String(claims?.role || "").trim().toLowerCase() === "authenticated";
  } catch {
    return false;
  }
}
export function createAuraVoiceStore(bearer: string): AuraVoiceStore {
  const url = required("SUPABASE_URL");
  const user = createClient<Database>(url, required("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient<Database>(url, required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  let verifiedId = "";
  const verifyActor = (actorId: string) => { if (!verifiedId || actorId !== verifiedId) throw new Error("AURA_FORBIDDEN"); };
  return {
    async domain(signal) {
      verifyActor(verifiedId);
      const { data, error } = await user.rpc("aura_domain_context_v1").abortSignal(signal);
      if (error) throw error;
      const context = auraObject(data);
      if (typeof context.revision !== "string" || !/^[0-9a-f]{32}$/.test(context.revision)) throw new Error("AURA_GLOSSARY_INVALID");
      return { glossary: parseAuraGlossary(context.glossary), revision: context.revision };
    },
    async voicePreference(voice, signal) {
      verifyActor(verifiedId);
      const { data, error } = await user.rpc("aura_voice_preferences_v1", voice ? { p_voice: auraVoice(voice) } : {}).abortSignal(signal);
      if (error) throw error;
      return auraVoice(auraObject(data).voiceName);
    },
    async authorize(signal) {
      if (!isSupabaseUserBearer(bearer)) return null;
      const authenticated = await user.auth.getUser(bearer);
      const id = authenticated.data.user?.id;
      if (authenticated.error || !id || !UUID.test(id) || signal.aborted) return null;
      const access = await user.rpc("aura_voice_access_v1").abortSignal(signal);
      if (access.error) return null;
      const actor = parseAuraAccess(access.data, id);
      if (actor) verifiedId = actor.id;
      return actor;
    },
    async appContext(signal) {
      verifyActor(verifiedId);
      const { data, error } = await user.rpc("aura_voice_context_v1").abortSignal(signal);
      if (error) throw error; return data;
    },
    async soc(kind, filters, cursor, signal) {
      verifyActor(verifiedId);
      const { commonname, contsize, customername, consigneename, ...scope } = filters;
      const { data, error } = await user.rpc("aura_voice_soc_read_v1", { p_kind: kind === "soc_reserves" ? "reserves" : "soc_open_orders",
        p_filters: jsonValue({ ...scope, commonName: commonname, contSize: contsize, customerName: customername,
          ...(consigneename ? { consigneeName: consigneename } : {}) }),
        ...(cursor == null ? {} : { p_cursor: jsonValue(cursor) }), p_limit: 50 }).abortSignal(signal);
      if (error) throw error; return data;
    },
    async memory(actorId, args, signal) {
      verifyActor(actorId);
      const { data, error } = await admin.rpc("aura_voice_conversation_v1", {
        p_actor_id: actorId, p_operation: args.operation,
        ...(args.conversationId ? { p_conversation_id: args.conversationId } : {}), ...(args.turnId ? { p_turn_id: args.turnId } : {}),
        ...(args.expectedRevision === undefined ? {} : { p_expected_revision: args.expectedRevision }), p_payload: jsonValue(args.payload || {}),
      }).abortSignal(signal);
      if (error) throw error; return data;
    },
    async inventory(operation, filters, cursor, signal) {
      verifyActor(verifiedId);
      const { data, error } = await user.rpc("aura_voice_inventory_read_v1", {
        p_operation: operation, p_filters: jsonValue(filters), ...(cursor == null ? {} : { p_cursor: jsonValue(cursor) }), p_limit: 50,
      }).abortSignal(signal);
      if (error) throw error; return data;
    },
    async history(query, signal) {
      verifyActor(verifiedId);
      // Caller JWT is required. The service-role client must never read history.
      const { data, error } = await user.rpc("historical_requests_read_v1", { p_query: jsonValue(query) }).abortSignal(signal);
      if (error) throw error; return data;
    },
    async reserve(inputBytes, signal) {
      verifyActor(verifiedId);
      // Each actual provider attempt reserves once. Turn retries retain DB idempotency;
      // expired/failed attempts count toward quota rather than bypassing it.
      const { data, error } = await admin.rpc("aura_llm_reserve_call_v1", {
        p_request_id: crypto.randomUUID(), p_round: 1, p_input_tokens: Math.min(100000, Math.max(1, inputBytes)),
        p_rpm: 15, p_tpm: 100000, p_rpd: 1000,
      }).abortSignal(signal);
      if (error) throw error;
      if (auraObject(data).allowed !== true) throw new Error("AURA_GEMINI_QUOTA");
    },
  };
}
export const auraVoiceProductionDeps: AuraVoiceDeps = { createStore: createAuraVoiceStore, apiKey: () => env("GEMINI_API_KEY") };

/** Machine-only release readiness probe. No user identity, inventory or conversation is read. */
export async function handleAuraProviderProbe(request: Request, options: { env?: (key: string) => string; fetcher?: typeof fetch } = {}): Promise<Response> {
  const readEnv = options.env || env;
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
  const expected = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supplied = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
  if (!expected || !supplied) return json({ ok: false, code: "AURA_FORBIDDEN" }, 403);
  // Digest comparison avoids comparing the raw variable-length key byte by byte.
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([digest(expected), digest(supplied)]);
  let different = 0; for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  if (different || request.method !== "GET") return json({ ok: false, code: "AURA_FORBIDDEN" }, 403);
  try {
    const probe = (text: string) => routeAuraWithGemini({ text,
      // Synthetic capabilities exercise the complete tool schema. No returned
      // tool is executed and no database client is constructed by this probe.
      actor: { id: "release-readiness-probe", username: "release-readiness-probe", role: "READINESS", inventory: true, history: true, drafts: true, socReserves: true, socOpenOrders: true },
      context: {}, apiKey: readEnv("GEMINI_API_KEY"), signal: AbortSignal.any([request.signal, AbortSignal.timeout(AURA_PROVIDER_TIMEOUT_MS)]), fetcher: options.fetcher,
      // Only the release service principal may perform these two synthetic calls.
      // Ordinary callers always use the quota ledger.
      reserve: async () => {},
    });
    const tool = await probe("Tell me the history of ancient Rome.");
    if (tool.name !== "refuse") return json({ ok: false, code: "AURA_PROVIDER_CONFINEMENT_PROBE_FAILED" }, 503);
    const stock = await probe("Check available stock for item code 000123.");
    if (stock.name !== "inventory" || stock.operation !== "stock" || stock.filters.itemcode !== "000123") {
      return json({ ok: false, code: "AURA_PROVIDER_ROUTING_PROBE_FAILED" }, 503);
    }
    await synthesizeAuraSpeech({ text: "Aura is ready.", voice: "Kore", apiKey: readEnv("GEMINI_API_KEY"),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(AURA_PROVIDER_TIMEOUT_MS)]), fetcher: options.fetcher, reserve: async () => {} });
    return json({ ok: true, model: AURA_GEMINI_MODEL, speechModel: AURA_TTS_MODEL, engine: "gemini-tools-v1", checks: { refusal: true, inventoryRouting: true, speech: true } }, 200);
  } catch (error) {
    const safeReasons = new Set(["AURA_GEMINI_CONFIGURATION_UNAVAILABLE", "AURA_GEMINI_BUSY", "AURA_GEMINI_UNAVAILABLE", "AURA_TOOL_INVALID", "AURA_TOOL_FORBIDDEN", "AURA_SPEECH_INVALID"]);
    const reason = error instanceof DOMException && error.name === "TimeoutError" ? "AURA_GEMINI_TIMEOUT"
      : error instanceof Error && safeReasons.has(error.message) ? error.message : "AURA_PROVIDER_UNAVAILABLE";
    return json({ ok: false, code: "AURA_PROVIDER_NOT_READY", reason,
      ...(error instanceof AuraGeminiProviderError ? { providerStatus: error.providerStatus } : {}) }, 503);
  }
}
