import { assertEquals } from "jsr:@std/assert@1";
import type { AppSessionClaims } from "../_shared/app-auth.ts";
import type { RequestRecipientDirectory } from "../../../services/requestRecipients.ts";
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
const { handleRequestRecipientDirectory } = await import("./index.ts");
const session: AppSessionClaims = { ver: 2, authUserId: "actor-id", username: "dylan_collyge", displayName: "Dylan Collyge", role: "ADMIN", mustChangePassword: false, iat: 1, exp: 9999999999 };
const directory: RequestRecipientDirectory = { ok: true, revision: `recipients-v1:${"a".repeat(64)}`, users: [{ username: "alyssa_beitz", displayName: "Alyssa Beitz", role: "CSR" }] };

Deno.test("recipient route checks authentication and stored workflow identity before directory reads", async () => {
  let reads = 0;
  const dependencies = { resolveActiveProfile: async () => ({ username: "unauthorized_user" }), readDirectory: () => { reads++; return Promise.resolve(directory); } };
  for (const claims of [null, { ...session, mustChangePassword: true }, session]) {
    assertEquals((await handleRequestRecipientDirectory(claims, { action: "request_recipient_directory" }, dependencies)).status, 403);
  }
  assertEquals(reads, 0);
  assertEquals((await handleRequestRecipientDirectory(session, {}, { ...dependencies, resolveActiveProfile: () => Promise.reject(new Error("profile_not_active")) })).status, 403);
  assertEquals(reads, 0);
});

Deno.test("authorized route returns active recipients and rejects client-controlled filters", async () => {
  let reads = 0;
  const dependencies = { resolveActiveProfile: async () => ({ username: "dylan_collyge" }), readDirectory: () => { reads++; return Promise.resolve(directory); } };
  const response = await handleRequestRecipientDirectory(session, { action: "request_recipient_directory" }, dependencies);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), directory);
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals((await handleRequestRecipientDirectory(session, { action: "request_recipient_directory", role: "REP" }, dependencies)).status, 400);
  assertEquals(reads, 1);
});

Deno.test("recipient route distinguishes service failure from a complete empty directory", async () => {
  const dependencies = { resolveActiveProfile: async () => ({ username: "dylan_collyge" }), readDirectory: () => Promise.reject(new Error("database unavailable")) };
  assertEquals((await handleRequestRecipientDirectory(session, {}, dependencies)).status, 503);
});
