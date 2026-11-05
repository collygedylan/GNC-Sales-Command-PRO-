import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { isRequestRecipientDirectoryUser, mergeRequestRecipients, readRequestRecipientDirectory } from "./request-recipient-directory.ts";
import { requestRecipientDirectoryFromResult } from "../../../services/requestRecipients.ts";

function profile(username: string, role = "CSR", disabled_at: string | null = null, legacy_user_id: number | null = null) {
  return { id: username, username, display_name: username === "alyssa_beitz" ? "Alyssa Beitz" : username, role, disabled_at, legacy_user_id };
}
function legacy(id: number, username: string, role = "REP", disabled_at: string | null = null) {
  return { id, username, role, disabled_at };
}

Deno.test("recipient caller permission is separate from recipient roles", () => {
  for (const username of ["dylan_collyge", "jd_jones", "megan_kelly"]) assertEquals(isRequestRecipientDirectoryUser(username), true);
  for (const username of ["alyssa_beitz", "admin", "dylan_collyge@example.com", null, "DYLAN_COLLYGE"]) {
    assertEquals(isRequestRecipientDirectoryUser(username), false);
  }
});

Deno.test("active CSR and other recipient roles appear once with authoritative profile labels", () => {
  const rows = mergeRequestRecipients([
    profile("alyssa_beitz", "CSR", null, 1), profile("eval_person", "EVAL"), profile("qc_person", "QC"),
  ], [legacy(1, "alyssa_beitz"), legacy(2, "legacy_person", "FOREMAN"), legacy(3, "ALYSSA BEITZ")]);
  assertEquals(rows.map(row => row.username), ["alyssa_beitz", "eval_person", "legacy_person", "qc_person"]);
  assertEquals(rows[0], { username: "alyssa_beitz", displayName: "Alyssa Beitz", role: "CSR" });
});

Deno.test("disabled profiles cannot be resurrected by legacy names or linked account IDs", () => {
  const rows = mergeRequestRecipients([
    profile("disabled_person", "REP", "2026-10-08T12:00:00Z", 1), profile("active_person", "CSR", null, 2),
  ], [legacy(1, "former_name"), legacy(3, "Disabled Person"), legacy(2, "active_person", "CSR", "2026-10-08T12:00:00Z"),
    legacy(4, "legacy_disabled", "QC", "2026-10-08T12:00:00Z")]);
  assertEquals(rows.map(row => row.username), ["active_person"]);
});

Deno.test("canonical duplicate disabled accounts fail closed independent of ordering", () => {
  for (const disabledFirst of [false, true]) {
    const accounts = [legacy(1, "Legacy Person"), legacy(2, "legacy_person", "REP", "2026-10-08T12:00:00Z")];
    assertEquals(mergeRequestRecipients([], disabledFirst ? accounts.reverse() : accounts), []);
  }
});

Deno.test("recipient login locks and password-change flags do not remove active identities", () => {
  const recipient = { ...profile("alyssa_beitz"), locked_until: "2099-01-01T00:00:00Z", must_change_password: true };
  const legacyRecipient = { ...legacy(2, "locked_legacy"), locked_until: "2099-01-01T00:00:00Z", must_change_password: true };
  assertEquals(mergeRequestRecipients([recipient], [legacyRecipient]).map(row => row.username), ["alyssa_beitz", "locked_legacy"]);
});

Deno.test("directory validates responses and strips account fields before reaching the UI", () => {
  const revision = `recipients-v1:${"a".repeat(64)}`;
  assertEquals(requestRecipientDirectoryFromResult({ ok: true, revision, users: [{ username: "alyssa_beitz", displayName: "Alyssa Beitz", role: "CSR", password: "never expose" }] }), {
    ok: true, revision, users: [{ username: "alyssa_beitz", displayName: "Alyssa Beitz", role: "CSR" }],
  });
  for (const value of [null, {}, { ok: true, revision: "stale", users: [] },
    { ok: true, revision, users: [null] }, { ok: true, revision, users: [{ username: "alyssa_beitz", displayName: 12, role: "CSR" }] },
    { ok: true, revision, users: Array(2).fill({ username: "alyssa_beitz", displayName: "Alyssa", role: "CSR" }) }]) {
    assertThrows(() => requestRecipientDirectoryFromResult(value));
  }
});

Deno.test("typed directory pages minimal projections and its revision changes when active identities change", async () => {
  const requests: URL[] = [];
  let disabled = false;
  const client = createClient<Database>("https://recipient-test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: input => {
      const url = new URL(String(input)); requests.push(url);
      const offset = Number(url.searchParams.get("offset") || 0);
      const rows = url.pathname.endsWith("/profiles")
        ? offset === 0 ? Array.from({ length: 500 }, (_, id) => profile(`person_${id}`, "CSR")) : [profile("alyssa_beitz", "CSR", disabled ? "2026-10-08T12:00:00Z" : null)]
        : [legacy(1, "legacy_person")];
      return Promise.resolve(new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } }));
    } },
  });
  const first = await readRequestRecipientDirectory(client);
  assertEquals(first.users.length, 502);
  assertEquals(requests.filter(url => url.pathname.endsWith("/profiles")).length, 2);
  for (const url of requests) {
    assertEquals(/password|locked_until|must_change_password|email/.test(url.searchParams.get("select") || ""), false);
  }
  disabled = true;
  const next = await readRequestRecipientDirectory(client);
  assertEquals(next.users.length, 501);
  assertEquals(next.revision === first.revision, false);
});

Deno.test("directory read failures return no partial results", async () => {
  const client = createClient<Database>("https://recipient-test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: () => Promise.resolve(new Response(JSON.stringify({ message: "failed" }), { status: 500 })) },
  });
  await assertRejects(() => readRequestRecipientDirectory(client), Error, "RECIPIENT_DIRECTORY_UNAVAILABLE");
});
