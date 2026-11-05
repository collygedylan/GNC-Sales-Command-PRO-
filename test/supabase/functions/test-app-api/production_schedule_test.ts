// Import with inert local values so these pure contract checks never contact a
// project or start the Edge Function listener.
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
const { parseProductionScheduleRequest, signProductionScheduleCommand, isProductionScheduleUser } = await import("./index.ts");

Deno.test("Production Schedule allowlist uses normalized fixed account keys", () => {
  for (const username of ["dylan_collyge", "MEGAN_KELLY", "jd_jones"]) {
    if (!isProductionScheduleUser(username)) throw new Error(`Expected authorized user: ${username}`);
  }
  for (const username of ["manager", "dylan_collyge@example.com", "github_actions_release", ""]) {
    if (isProductionScheduleUser(username)) throw new Error(`Unexpected authorized user: ${username}`);
  }
});

Deno.test("Production Schedule rows validate 1-based filters and cap pages at 500", () => {
  const parsed = parseProductionScheduleRequest({
    action: "production_schedule",
    operation: "rows",
    sheetId: 0,
    limit: 900,
    cursor: "27",
    q: "Juniper",
    filters: { "5": "F1", "12": "Move Up", "13": "" },
  });
  if (parsed.operation !== "rows") throw new Error("Expected a row request.");
  if (parsed.limit !== 500 || parsed.cursor !== 27 || parsed.sheetId !== 0) throw new Error("Page bounds or cursor were not normalized.");
  if (parsed.filters["5"] !== "F1" || parsed.filters["12"] !== "Move Up" || "13" in parsed.filters) {
    throw new Error("Physical column filters were not normalized.");
  }
});

Deno.test("Production Schedule rejects invalid tabs, cursors, filters, and payload keys", () => {
  const invalid = [
    { operation: "rows", sheetId: 7 },
    { operation: "rows", sheetId: 0, cursor: "-1" },
    { operation: "rows", sheetId: 0, filters: { "0": "invalid column base" } },
    { operation: "rows", sheetId: 0, filters: { "2": 22 } },
    { operation: "rows", sheetId: 0, filters: "not-an-object" },
    { operation: "rows", sheetId: null },
    { operation: "rows", sheetId: 0, unrecognized: true },
    { operation: "missing" },
    { operation: "refresh", requestedBy: "github_actions_release" },
  ];
  for (const payload of invalid) {
    let rejected = false;
    try { parseProductionScheduleRequest(payload); } catch { rejected = true; }
    if (!rejected) throw new Error(`Expected request to be rejected: ${JSON.stringify(payload)}`);
  }
});

Deno.test("Production Schedule command signatures bind timestamp and fixed command body", async () => {
  const command = {
    contractVersion: "production-schedule-import-v1",
    workbookId: "1myBn2DzyhYtTj2MmYatf26jz575TjqxSpxC-kFt1Mhw",
    runId: "00000000-0000-4000-8000-000000000013",
    snapshotId: "00000000-0000-4000-8000-000000000013",
    requestedBy: "dylan_collyge",
  };
  const timestamp = "2026-10-01T00:00:00.000Z";
  const secret = "local-test-secret";
  const signed = await signProductionScheduleCommand(command, timestamp, secret);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(signed.signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signed.signature.length % 4) % 4)), character => character.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(`${timestamp}.${signed.deliveryJson}`));
  if (!valid || JSON.parse(signed.deliveryJson).workbookId !== command.workbookId) throw new Error("Signature did not authenticate the fixed source command.");
  const altered = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(`${timestamp}.${signed.deliveryJson} `));
  if (altered) throw new Error("Signature accepted a modified command body.");
});
