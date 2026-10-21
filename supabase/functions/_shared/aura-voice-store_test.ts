// @test-group: aura
import { handleAuraProviderProbe, parseAuraAccess } from "./aura-voice-store.ts";
function assert(value: unknown, message = "Assertion failed") { if (!value) throw new Error(message); }
const id = "00000000-0000-4000-8000-000000000001";
Deno.test("access parser binds stored actor to Auth UUID and requires canonical Dylan regardless of role", () => {
  const access = { ok: true, actor: { id, username: " Dylan_Collyge ", role: "EVALUATOR" }, capabilities: { auraEnabled: true, inventory: false, history: true, drafts: false } };
  assert(parseAuraAccess(access, id)?.history === true);
  assert(parseAuraAccess({ ...access, capabilities: { ...access.capabilities, auraEnabled: false } }, id) === null);
  assert(parseAuraAccess({ ...access, capabilities: { ...access.capabilities, auraEnabled: undefined } }, id) === null);
  assert(parseAuraAccess(access, "00000000-0000-4000-8000-000000000002") === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, username: "rep_one", role: "ADMIN" } }, id) === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, username: "megan_kelly", role: "ADMIN" } }, id) === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, username: "jd_jones", role: "ADMIN" } }, id) === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, username: "brian_hart", role: "ADMIN" } }, id) === null);
  assert(parseAuraAccess({ ...access, actor: { ...access.actor, role: "" } }, id) === null);
  assert(parseAuraAccess({ ...access, capabilities: { ...access.capabilities, history: false } }, id) === null);
  assert(parseAuraAccess({ ...access, capabilities: { ...access.capabilities, history: "true" } }, id) === null);
});
Deno.test("release readiness requires service principal and verifies refusal plus full-schema stock routing", async () => {
  let calls = 0;
  const options = { env: (key: string) => key === "SUPABASE_SERVICE_ROLE_KEY" ? "release-secret" : key === "GEMINI_API_KEY" ? "provider-secret" : "",
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      if (body.generationConfig.responseModalities?.includes("AUDIO")) {
        assert(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === "Kore");
        return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "AAAAAA==" } }] } }] });
      }
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
  assert(ready.status === 200 && data.model === "gemini-3.8-flash" && data.speechModel === "gemini-3.8-flash-tts" && calls === 3);
  assert(data.checks.refusal && data.checks.inventoryRouting && data.checks.speech);
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
  const actor = { id, username: "dylan_collyge", role: "EVALUATOR" };
  const capabilities = { auraEnabled: true, inventory: false, history: false, drafts: false, socReserves: true, socOpenOrders: false };
  assert(parseAuraAccess({ ok: true, actor, capabilities }, id)?.socReserves === true);
  assert(parseAuraAccess({ ok: true, actor, capabilities: { ...capabilities, socReserves: "true" } }, id) === null);
  assert(parseAuraAccess({ ok: true, actor, capabilities: { ...capabilities, socReserves: false, socOpenOrders: true } }, id)?.socOpenOrders === true);
  assert(parseAuraAccess({ ok: true, actor, capabilities: { ...capabilities, socOpenOrders: 1 } }, id) === null);
  assert(parseAuraAccess({ ok: true, actor: { ...actor, username: "rep_one", role: "ADMIN" }, capabilities }, id) === null);
});

Deno.test("readiness identifies real provider timeouts without revealing exception details", async () => {
  for (const error of [new DOMException("private-provider-timeout", "TimeoutError"),
    new DOMException("private-client-cancellation", "AbortError"), new Error("TimeoutError"), new TypeError("private-network-failure")]) {
    const response = await handleAuraProviderProbe(new Request("https://example.invalid/aura-llm-router/health", { headers: { authorization: "Bearer release-secret" } }), {
      env: key => key === "SUPABASE_SERVICE_ROLE_KEY" ? "release-secret" : "provider-secret",
      fetcher: async () => { throw error; },
    });
    const body = await response.json();
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    assert(response.status === 503 && body.code === "AURA_PROVIDER_NOT_READY");
    assert(body.reason === (timedOut ? "AURA_GEMINI_TIMEOUT" : "AURA_PROVIDER_UNAVAILABLE"));
    assert(body.providerStatus === undefined);
    assert(!JSON.stringify(body).includes(error.message) && !JSON.stringify(body).includes("provider-secret"));
  }
});
