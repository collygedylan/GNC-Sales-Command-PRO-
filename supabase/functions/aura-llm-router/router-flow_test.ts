import { handleAuraLlmRequest } from "./index.ts";

const ACTOR = "00000000-0011-4000-8000-000000000001";
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
function fixture(username = "dylan_collyge") {
  const profile = { id: ACTOR, username, display_name: username, role: "Admin", must_change_password: false, disabled_at: null, locked_until: null };
  const chain = (data: unknown) => {
    const q: any = {
      select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }),
      then: (yes: (value: unknown) => unknown, no: (error: unknown) => unknown) => Promise.resolve({ data, error: null }).then(yes, no),
    };
    return q;
  };
  const client: any = {
    auth: { getUser: async () => ({ data: { user: { id: ACTOR } }, error: null }) },
    from: (table: string) => chain(table === "profiles" ? profile : null),
    rpc: (name: string) => chain(name === "app_account_active_v1" ? true : false),
  };
  const request = () => new Request("https://example.invalid/aura-llm-router", {
    method: "POST", headers: { authorization: "Bearer verified-token", "content-type": "application/json" },
    body: JSON.stringify({ mode: "unsupported" }),
  });
  return { client, request };
}

Deno.test("compatibility route accepts only the exact active Dylan identity", async () => {
  const denied = fixture("dylan-collyge");
  const deniedResponse = await handleAuraLlmRequest(denied.request(), { adminClient: denied.client, userClient: denied.client });
  assert(deniedResponse.status === 403, "normalized username lookalike is forbidden");

  const allowed = fixture();
  const allowedResponse = await handleAuraLlmRequest(allowed.request(), { adminClient: allowed.client, userClient: allowed.client });
  assert(allowedResponse.status === 400, "exact active identity reaches request validation");
  const body = await allowedResponse.json();
  assert(body.code === "AURA_QUERY_MODE_INVALID", "request validation remains deterministic");
});

Deno.test("no LLM/provider configuration is required for the deterministic compatibility route", async () => {
  const f = fixture();
  const response = await handleAuraLlmRequest(f.request(), { adminClient: f.client, userClient: f.client, env: () => "" });
  assert(response.status === 400, "no external provider environment is consulted");
});
