// @test-group: aura
import { handleAuraProviderProbe, parseAuraAccess } from "./aura-voice-store.ts";
function assert(value: unknown, message = "Assertion failed") { if (!value) throw new Error(message); }
const id = "00000000-0000-4000-8000-000000000001";
Deno.test("access parser binds stored actor to Auth UUID and requires explicit capabilities and roles", () => {
  const access = { ok: true, actor: { id, username: "rep_one", role: "REP" }, capabilities: { inventory: false, history: true, drafts: false } };
  assert(parseAuraAccess(access, id)?.history === true);
  assert(parseAuraAccess(access, "00000000-0000-4000-8000-000000000002") === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, role: "unknown" } }, id) === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, role: " RE P " } }, id) === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, role: " rep " } }, id)?.history === true);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, username: "dylan_collyge", role: "legacy" } }, id)?.history === true);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, username: "Dylan_Collyge", role: "legacy" } }, id) === null);
  assert(parseAuraAccess({ ...access, capabilities: { ...access.capabilities, history: false } }, id) === null);
  assert(parseAuraAccess({ ...access, capabilities: { ...access.capabilities, history: "true" } }, id) === null);
});
Deno.test("release readiness requires service principal and verifies refusal plus full-schema stock routing", async () => {
  let calls = 0;
  const options = { env: (key: string) => key === "SUPABASE_SERVICE_ROLE_KEY" ? "release-secret" : key === "GEMINI_API_KEY" ? "provider-secret" : "",
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert(!JSON.stringify(body).includes(id));
      assert(body.tools[0].functionDeclarations.length === 7);
      const question = JSON.parse(body.contents[0].parts[0].text).question;
      assert(["Tell me the history of ancient Rome.", "Check available stock for item code 000123."].includes(question));
      const functionCall = question.includes("ancient Rome") ? { name: "refuse", args: {} }
        : { name: "inventory", args: { operation: "stock", filters: { itemcode: "000123" } } };
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall }] } }] }));
    } };
  for (const key of ["", "user-jwt", "invalid"]) {
    const response = await handleAuraProviderProbe(new Request("https://example.invalid/aura-llm-router/health", { headers: key ? { authorization: `Bearer ${key}` } : {} }), options);
    assert(response.status === 403);
  }
  assert(calls === 0);
  const ready = await handleAuraProviderProbe(new Request("https://example.invalid/aura-llm-router/health", { headers: { authorization: "Bearer release-secret" } }), options);
  const data = await ready.json();
  assert(ready.status === 200 && data.model === "gemini-3.8-flash" && calls === 2);
  assert(data.checks.refusal && data.checks.inventoryRouting);
});
Deno.test("release readiness rejects a provider that refuses stock instead of routing it", async () => {
  let calls = 0;
  const response = await handleAuraProviderProbe(new Request("https://example.invalid/aura-llm-router/health", { headers: { authorization: "Bearer release-secret" } }), {
    env: key => key === "SUPABASE_SERVICE_ROLE_KEY" ? "release-secret" : "provider-secret",
    fetcher: async () => { calls++; return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "refuse", args: {} } }] } }] })); },
  });
  assert(response.status === 503 && (await response.json()).code === "AURA_PROVIDER_ROUTING_PROBE_FAILED" && calls === 2);
});

Deno.test("readiness exposes bounded provider diagnostics without reflecting provider bodies", async () => {
  for (const status of [400, 403, 404, 429, 503]) {
    const response = await handleAuraProviderProbe(new Request("https://example.invalid/aura-llm-router/health", { headers: { authorization: "Bearer release-secret" } }), {
      env: key => key === "SUPABASE_SERVICE_ROLE_KEY" ? "release-secret" : "provider-secret",
      fetcher: async () => new Response("private-provider-message", { status }),
    });
    const body = await response.json();
    assert(response.status === 503 && body.code === "AURA_PROVIDER_NOT_READY" && body.providerStatus === status);
    assert(body.reason === (status === 429 ? "AURA_GEMINI_BUSY" : "AURA_GEMINI_UNAVAILABLE"));
    assert(!JSON.stringify(body).includes("private-provider-message") && !JSON.stringify(body).includes("provider-secret"));
  }
});

Deno.test("SOC-only capability access is explicit and never accepts truthy strings", () => {
  const actor = { id, username: "rep_one", role: "REP" };
  const capabilities = { inventory: false, history: false, drafts: false, socReserves: true, socOpenOrders: false };
  assert(parseAuraAccess({ ok: true, actor, capabilities }, id)?.socReserves === true);
  assert(parseAuraAccess({ ok: true, actor, capabilities: { ...capabilities, socReserves: "true" } }, id) === null);
  assert(parseAuraAccess({ ok: true, actor, capabilities: { ...capabilities, socReserves: false, socOpenOrders: true } }, id)?.socOpenOrders === true);
  assert(parseAuraAccess({ ok: true, actor, capabilities: { ...capabilities, socOpenOrders: 1 } }, id) === null);
});
