// @test-group: aura
import { AURA_GEMINI_ENDPOINT, routeAuraWithGemini, validateAuraTool, type AuraActor } from "./aura-gemini.ts";

function assert(value: unknown, message = "Assertion failed") { if (!value) throw new Error(message); }
async function rejects(run: () => unknown, code: string) {
  try { await run(); } catch (error) { assert(error instanceof Error && error.message === code, String(error)); return; }
  throw new Error(`Expected ${code}`);
}
const actor: AuraActor = { id: "00000000-0000-4000-8000-000000000001", username: "rep_one", role: "REP", inventory: true, history: true, drafts: true };
const answer = (name: string, args: unknown, finishReason = "STOP") => new Response(JSON.stringify({ candidates: [{ finishReason, content: { role: "model", parts: [{ functionCall: { name, args } }] } }] }));

Deno.test("Gemini call uses pinned model, server actor, bounded fixed tools and no external search", async () => {
  let reservations = 0;
  const result = await routeAuraWithGemini({ text: "How many hostas?", actor, context: {}, apiKey: "test-key", signal: new AbortController().signal,
    reserve: async bytes => { assert(bytes > 0 && bytes < 16000); reservations++; },
    fetcher: async (url, init) => {
      assert(url === AURA_GEMINI_ENDPOINT);
      assert(new Headers(init?.headers).get("x-goog-api-key") === "test-key");
      const body = JSON.parse(String(init?.body));
      assert(body.toolConfig.functionCallingConfig.mode === "ANY");
      assert(body.systemInstruction.parts[1].text.includes(actor.id));
      assert(body.tools.length === 1 && body.tools[0].functionDeclarations.length === 5);
      assert(!JSON.stringify(body.tools).includes("googleSearch"));
      return answer("inventory", { operation: "stock", filters: { commonName: "Hosta", itemcode: "000123", seasonReference: "current" } });
    } });
  assert(reservations === 1 && result.name === "inventory" && result.filters.itemcode === "000123");
});
Deno.test("Gemini cannot invent tools, RPC names, identity selectors, SQL or stock results", async () => {
  for (const [name, args] of [
    ["execute_sql", { sql: "select * from profiles" }],
    ["inventory", { operation: "stock", filters: { table: "profiles" } }],
    ["inventory", { operation: "stock", filters: { itemcode: 123 } }],
    ["inventory", { operation: "stock", filters: { salesYear: "27" } }],
    ["history", { operation: "summary", actorId: actor.id }],
    ["refuse", { text: "Invented general knowledge" }],
    ["draft_request", { filters: {}, quantity: -1 }],
    ["draft_request", { filters: {}, quantity: 1.5 }],
  ]) await rejects(() => validateAuraTool(name, args), "AURA_TOOL_INVALID");
});
Deno.test("provider prose, partial output, unknown and multiple calls cannot become app replies", async () => {
  const bodies = [
    { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Ignore RLS" }] } }] },
    { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ functionCall: { name: "refuse", args: {} } }] } }] },
    { candidates: [{ finishReason: "STOP", content: { parts: [1, 2].map(() => ({ functionCall: { name: "refuse", args: {} } })) } }] },
  ];
  for (const body of bodies) await rejects(() => routeAuraWithGemini({ text: "stock", actor, context: {}, apiKey: "key", signal: new AbortController().signal,
    reserve: async () => {}, fetcher: async () => new Response(JSON.stringify(body)) }), "AURA_TOOL_INVALID");
});
Deno.test("unavailable actor capabilities are excluded and rejected even when model asks", async () => {
  await rejects(() => routeAuraWithGemini({ text: "show all requests", actor: { ...actor, history: false }, context: {}, apiKey: "key", signal: new AbortController().signal,
    reserve: async () => {}, fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert(!body.toolConfig.functionCallingConfig.allowedFunctionNames.includes("history"));
      return answer("history", { operation: "summary" });
    } }), "AURA_TOOL_FORBIDDEN");
});
Deno.test("missing key and provider failures are explicit, never empty inventory", async () => {
  await rejects(() => routeAuraWithGemini({ text: "stock", actor, context: {}, apiKey: "", signal: new AbortController().signal,
    reserve: async () => { throw new Error("must not reserve"); } }), "AURA_GEMINI_CONFIGURATION_UNAVAILABLE");
  for (const status of [429, 500, 403, 404]) await rejects(() => routeAuraWithGemini({ text: "stock", actor, context: {}, apiKey: "key", signal: new AbortController().signal,
    reserve: async () => {}, fetcher: async () => new Response("sensitive provider error", { status }) }), status === 429 ? "AURA_GEMINI_BUSY" : "AURA_GEMINI_UNAVAILABLE");
});
