import { assertEquals } from "jsr:@std/assert@1";
import type { AppSessionClaims } from "../_shared/app-auth.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
const { handleFieldCountAction } = await import("./index.ts");

const session: AppSessionClaims = {
  ver: 2, authUserId: "00000000-0000-4000-8000-000000000001", username: "stale_username",
  displayName: "Stale Session Name", role: "ADMIN", mustChangePassword: false, iat: 1, exp: 9999999999,
};
const activeProfile = {
  id: session.authUserId, username: "dylan_collyge", display_name: "Dylan Collyge",
  role: "ADMIN", disabled_at: null, locked_until: null, must_change_password: false,
};
const payload = () => ({ action: "field_count", operation: "save", commandId: "field-count-edge-command-0001",
  payload: { countType: "bunch", scope: { block: "C", location: "C.06.001" }, direction: "east_west",
    entries: [{ sourceUid: "fixture-master-row", countedQty: 12, note: "fixture note", expectedUpdatedAt: null, rowOrder: 1 }] } });

type Call = { path: string; query: URLSearchParams; body: unknown };
async function mockDatabase<T>(options: {
  profile?: unknown; accountActive?: boolean; rpcResult?: unknown; rpcError?: { message: string; code?: string; status?: number };
}, action: (calls: Call[]) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "http://127.0.0.1:54321") throw new Error("Unexpected external request");
    const body = request.method === "POST" ? await request.json() : null;
    calls.push({ path: url.pathname, query: url.searchParams, body });
    const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {
      status, headers: { "content-type": "application/json" },
    }));
    if (url.pathname === "/rest/v1/profiles") return json(options.profile === undefined ? activeProfile : options.profile);
    if (url.pathname === "/rest/v1/rpc/app_account_active_v1") return json(options.accountActive !== false);
    if (url.pathname === "/rest/v1/rpc/field_count_command_v1") {
      if (options.rpcError) return json({ message: options.rpcError.message, code: options.rpcError.code || "40001", details: null, hint: null }, options.rpcError.status || 409);
      return json(options.rpcResult ?? { revision: "12", savedSourceUids: ["fixture-master-row"] });
    }
    throw new Error(`Unexpected database route: ${url.pathname}`);
  };
  try { return await action(calls); }
  finally { globalThis.fetch = originalFetch; }
}

Deno.test("field count requires a session and an active unlocked current profile before command access", async () => {
  await mockDatabase({}, async calls => {
    assertEquals((await handleFieldCountAction(null, payload())).status, 401);
    assertEquals((await handleFieldCountAction({ ...session, mustChangePassword: true }, payload())).status, 403);
    assertEquals(calls.some(call => call.path.endsWith("field_count_command_v1")), false);
  });
  for (const profile of [null, { ...activeProfile, disabled_at: "2026-10-09T00:00:00Z" },
    { ...activeProfile, locked_until: "2999-01-01T00:00:00Z" }, { ...activeProfile, must_change_password: true }]) {
    await mockDatabase({ profile }, async calls => {
      const response = await handleFieldCountAction(session, payload());
      assertEquals(response.status, 403);
      assertEquals((await response.json()).code, "FIELD_COUNT_FORBIDDEN");
      assertEquals(calls.some(call => call.path.endsWith("field_count_command_v1")), false);
    });
  }
  await mockDatabase({ accountActive: false }, async calls => {
    assertEquals((await handleFieldCountAction(session, payload())).status, 403);
    assertEquals(calls.some(call => call.path.endsWith("field_count_command_v1")), false);
  });
});

Deno.test("field count denies CSR writes and forwards the active profile identity for authorized admin commands", async () => {
  await mockDatabase({ profile: { ...activeProfile, username: "fixture_csr", role: "CSR" } }, async calls => {
    const response = await handleFieldCountAction(session, payload());
    assertEquals(response.status, 403);
    assertEquals((await response.json()).code, "FIELD_COUNT_FORBIDDEN");
    assertEquals(calls.some(call => call.path.endsWith("field_count_command_v1")), false);
  });
  await mockDatabase({}, async calls => {
    const response = await handleFieldCountAction(session, payload());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true, data: { revision: "12", savedSourceUids: ["fixture-master-row"] } });
    const profileRead = calls.find(call => call.path === "/rest/v1/profiles");
    assertEquals(profileRead?.query.get("id"), `eq.${session.authUserId}`);
    const rpcCalls = calls.filter(call => call.path.endsWith("field_count_command_v1"));
    assertEquals(rpcCalls.length, 1);
    assertEquals(rpcCalls[0].body, { p_actor_id: activeProfile.id, p_operation: "save", p_payload: payload().payload,
      p_command_id: payload().commandId });
  });
});

Deno.test("field count keeps fixed operations on the typed RPC and rejects unsupported payload fields", async () => {
  for (const input of [
    { ...payload(), table: "ph_master_inventory" },
    { ...payload(), operation: "delete" },
  ]) {
    await mockDatabase({}, async calls => {
      assertEquals((await handleFieldCountAction(session, input)).status, 400);
      assertEquals(calls.some(call => call.path.endsWith("field_count_command_v1")), false);
    });
  }
  await mockDatabase({ rpcError: { message: "FIELD_COUNT_PAYLOAD_INVALID", code: "22023", status: 400 } }, async calls => {
    const input = { ...payload(), payload: { ...payload().payload, table: "ph_master_inventory" } };
    const response = await handleFieldCountAction(session, input);
    assertEquals(response.status, 400);
    assertEquals((await response.json()).code, "FIELD_COUNT_PAYLOAD_INVALID");
    assertEquals(calls.find(call => call.path.endsWith("field_count_command_v1"))?.body, {
      p_actor_id: activeProfile.id, p_operation: "save", p_payload: input.payload, p_command_id: input.commandId,
    });
  });
  await mockDatabase({}, async calls => {
    const input = { ...payload(), operation: "read", commandId: undefined,
      payload: { countType: "spread", block: "C", location: "C.06.001", page: 0 } };
    const response = await handleFieldCountAction(session, input);
    if (response.status !== 200) console.log("read field-count response", response.status, await response.clone().text(), calls);
    assertEquals(response.status, 200);
    const rpc = calls.find(call => call.path.endsWith("field_count_command_v1"));
    assertEquals(rpc?.body, { p_actor_id: activeProfile.id, p_operation: "read", p_payload: input.payload });
  });
});

Deno.test("field count revision conflicts remain conflicts and do not return a saved receipt", async () => {
  await mockDatabase({ rpcError: { message: "FIELD_COUNT_REVISION_CONFLICT", code: "40001", status: 409 } }, async calls => {
    const response = await handleFieldCountAction(session, payload());
    assertEquals(response.status, 409);
    assertEquals(await response.json(), { error: "FIELD_COUNT_REVISION_CONFLICT", code: "FIELD_COUNT_REVISION_CONFLICT" });
    assertEquals(calls.filter(call => call.path.endsWith("field_count_command_v1")).length, 1);
  });
});
