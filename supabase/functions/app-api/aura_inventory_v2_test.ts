// Pure request-contract tests; importing app-api with inert credentials never
// contacts a Supabase project or starts the edge-function listener.
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
const { parseAuraInventoryV2Request, handleAuraInventoryV2, auraInventoryV2ProfileMatches } = await import("./index.ts");

Deno.test("AURA V2 accepts bounded catalog and current-setting scoped queries", () => {
  const catalog = parseAuraInventoryV2Request({ action: "aura_inventory_v2", operation: "catalog", limit: 500 });
  if (catalog.operation !== "catalog" || catalog.limit !== 500 || catalog.season !== null) throw new Error("Catalog defaults changed.");
  const count = parseAuraInventoryV2Request({ operation: "count", itemcode: "003955.030.1", contSize: "#3", season: "U1", metric: "ptronhand", openStockOnly: true, cursor: { unique_id: "u-20" } });
  if (count.itemcode !== "003955.030.1" || count.contSize !== "#3" || count.season !== "U1" || count.metric !== "ptronhand") {
    throw new Error("Count scope or metric was not preserved.");
  }
  const lots = parseAuraInventoryV2Request({ operation: "lots", itemcode: "003955.030.1", quantity: 50, limit: 25 });
  if (lots.quantity !== 50 || lots.limit !== 25) throw new Error("Lots request was not normalized.");
  const match = parseAuraInventoryV2Request({ operation: "match", commonName: "  Baby Gem   Boxwood ", contSize: "3DP", openStockOnly: true, season: "F1" });
  if (match.commonName !== "Baby Gem Boxwood" || match.contSize !== "3DP" || !match.openStockOnly || match.season !== "F1") {
    throw new Error("Match search name and inventory scope were not normalized.");
  }
});

Deno.test("AURA V2 rejects caller sales-year authority, arbitrary metrics and malformed cursors", () => {
  for (const payload of [
    { operation: "catalog", salesYear: 99 },
    { operation: "maximum", metric: "priority" },
    { operation: "count", itemcode: "x", cursor: [] },
    { operation: "count", itemcode: "x", season: "SPRING" },
    { operation: "match", commonName: "" },
    { operation: "match", commonName: "x", cursor: { itemcode: "x" } },
    { operation: "match", commonName: "x", salesYear: 27 },
    { operation: "lots", itemcode: "x", quantity: 0 },
    { operation: "mystery" },
  ]) {
    let rejected = false;
    try { parseAuraInventoryV2Request(payload); } catch { rejected = true; }
    if (!rejected) throw new Error(`Expected AURA request rejection: ${JSON.stringify(payload)}`);
  }
});

Deno.test("AURA V2 validates draft line count and only accepts exact inventory identities", () => {
  const line = { unique_id: "uid-1", itemcode: "003955.030.1", commonname: "Accolade Elm", contsize: "#3", locationcode: "U1", lotcode: "27.F1", quantity: 12 };
  const parsed = parseAuraInventoryV2Request({ operation: "validate_draft", lines: [line] });
  if (parsed.lines.length !== 1 || parsed.lines[0].unique_id !== "uid-1") throw new Error("Draft line was not preserved.");
  for (const lines of [[], Array.from({ length: 51 }, (_, index) => ({ ...line, unique_id: `uid-${index}` })), [{ ...line, salesYear: 99 }]]) {
    let rejected = false;
    try { parseAuraInventoryV2Request({ operation: "validate_draft", lines }); } catch { rejected = true; }
    if (!rejected) throw new Error("Invalid draft payload was accepted.");
  }
});

Deno.test("AURA V2 blocks missing, legacy-only, non-Dylan, and forced-password sessions before inventory access", async () => {
  const action = { operation: "catalog" };
  const denied = [
    { session: null, status: 401 },
    { session: { username: "dylan_collyge", authUserId: null, ver: 1 }, status: 403 },
    { session: { username: "floor_user", authUserId: "user-2", ver: 2 }, status: 403 },
    { session: { username: "dylan_collyge", authUserId: "user-1", mustChangePassword: true, ver: 2 }, status: 403 },
  ];
  for (const entry of denied) {
    const response = await handleAuraInventoryV2(entry.session as never, action);
    if (response.status !== entry.status) throw new Error(`Expected auth rejection ${entry.status}; received ${response.status}.`);
  }
});

Deno.test("AURA V2 rejects inactive or mismatched resolved profiles", () => {
  const session = { username: "dylan_collyge", authUserId: "auth-dylan" };
  if (!auraInventoryV2ProfileMatches(session, { id: "auth-dylan", username: "dylan_collyge" })) throw new Error("Exact active Dylan profile was rejected.");
  for (const profile of [
    null,
    { id: "other-id", username: "dylan_collyge" },
    { id: "auth-dylan", username: "different_user" },
    { id: "auth-dylan", username: "dylan_collyge", disabled_at: "2026-10-02T00:00:00Z" },
    { id: "auth-dylan", username: "dylan_collyge", is_active: false },
    { id: "auth-dylan", username: "dylan_collyge", must_change_password: true },
  ]) {
    if (auraInventoryV2ProfileMatches(session, profile)) throw new Error("Mismatched profile was accepted.");
  }
  if (auraInventoryV2ProfileMatches({ ...session, username: "different_user" }, { id: "auth-dylan", username: "dylan_collyge" })) {
    throw new Error("Non-Dylan session was accepted against Dylan's profile.");
  }
});
