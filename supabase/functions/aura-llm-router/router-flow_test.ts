// @test-group: aura
import { handleAuraLlmRequest } from "./index.ts";
import type { AuraVoiceDeps, AuraVoiceStore, AuraMemoryArgs, AuraHistoryQuery } from "../_shared/aura-voice-handler.ts";
import type { AuraActor } from "../_shared/aura-gemini.ts";

const ACTOR = "00000000-0000-4000-8000-000000000001";
const CHAT = "00000000-0000-4000-8000-000000000002";
function assert(value: unknown, message = "Assertion failed") { if (!value) throw new Error(message); }
type FixtureOptions = { actor?: AuraActor | null; apiKey?: string; tool?: { name: string; args: unknown } };
function fixture(options: FixtureOptions = {}) {
  const actor: AuraActor | null = options.actor === undefined
    ? { id: ACTOR, username: "rep_one", role: "REP", inventory: true, history: true, drafts: false }
    : options.actor;
  const memoryCalls: AuraMemoryArgs[] = [];
  const historyCalls: AuraHistoryQuery[] = [];
  let providerCalls = 0;
  let inventoryCalls = 0;
  let revision = 0;
  const store: AuraVoiceStore = {
    authorize: async () => actor,
    memory: async (_actorId, args) => {
      memoryCalls.push(args);
      if (args.operation === "begin") return { conversationId: CHAT, revision: ++revision, context: {} };
      if (args.operation === "complete") return { conversationId: CHAT, revision: ++revision };
      if (args.operation === "read") return { conversationId: CHAT, revision, turns: [] };
      return { conversationId: CHAT, revision: ++revision };
    },
    inventory: async () => { inventoryCalls++; return { ok: true, complete: true, rows: [], total: 0, season: "F1", salesYear: 27, settingRevision: 1, datasetRevision: "1", unresolvedCount: 0 }; },
    history: async query => { historyCalls.push(query); return { scope: "own", revision: "1", rows: [], total: 0, summary: { requestCount: 0, totalValue: 0, unpricedCount: 0 } }; },
    reserve: async () => {},
  };
  const deps: AuraVoiceDeps = {
    createStore: () => store,
    apiKey: () => options.apiKey === undefined ? "test-key" : options.apiKey,
    fetcher: async () => {
      providerCalls++;
      const call = options.tool || { name: "inventory", args: { operation: "stock", filters: {} } };
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: call }] } }] }));
    },
  };
  function request(body: string, token = "verified-token") {
    return new Request("https://example.invalid/aura-llm-router", { method: "POST",
      headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" }, body });
  }
  return { deps, request, memoryCalls, historyCalls, get providerCalls() { return providerCalls; }, get inventoryCalls() { return inventoryCalls; } };
}

Deno.test("router authorizes before parsing the body or invoking provider and memory", async () => {
  const f = fixture({ actor: null });
  const response = await handleAuraLlmRequest(f.request("{"), f.deps);
  const body = await response.json();
  assert(response.status === 403 && body.code === "AURA_FORBIDDEN");
  assert(f.memoryCalls.length === 0 && f.providerCalls === 0 && f.inventoryCalls === 0 && f.historyCalls.length === 0);
});

Deno.test("router enforces actor capabilities when a model requests an unavailable tool", async () => {
  const f = fixture({ actor: { id: ACTOR, username: "rep_one", role: "REP", inventory: true, history: false, drafts: false },
    tool: { name: "history", args: { operation: "summary" } } });
  const response = await handleAuraLlmRequest(f.request(JSON.stringify({ mode: "command", text: "Show my requests" })), f.deps);
  const body = await response.json();
  assert(response.status === 403 && body.code === "AURA_TOOL_FORBIDDEN");
  assert(f.providerCalls === 1 && f.historyCalls.length === 0 && f.inventoryCalls === 0);
  assert(f.memoryCalls.some(call => call.operation === "begin") && f.memoryCalls.some(call => call.operation === "fail"));
});

Deno.test("missing Gemini configuration fails closed without deterministic inventory fallback", async () => {
  const f = fixture({ apiKey: "" });
  const response = await handleAuraLlmRequest(f.request(JSON.stringify({ mode: "command", text: "How many maples?" })), f.deps);
  const body = await response.json();
  assert(response.status === 503 && body.code === "AURA_GEMINI_CONFIGURATION_UNAVAILABLE");
  assert(f.providerCalls === 0 && f.inventoryCalls === 0 && f.historyCalls.length === 0);
  assert(f.memoryCalls.some(call => call.operation === "begin") && f.memoryCalls.some(call => call.operation === "fail"));
});

Deno.test("authorized request dispatches the verified tool result rather than provider prose", async () => {
  const f = fixture();
  const response = await handleAuraLlmRequest(f.request(JSON.stringify({ mode: "command", text: "How many maples?" })), f.deps);
  const body = await response.json();
  assert(response.status === 200 && body.ok === true && typeof body.reply === "string");
  assert(f.providerCalls === 1 && f.inventoryCalls === 1 && f.historyCalls.length === 0);
  assert(f.memoryCalls.some(call => call.operation === "complete"));
});
