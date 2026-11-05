// @test-group: aura
import { parseAuraAppContext, requestedAuraVariants, spokenAuraSeason, signedAuraQuantity } from "./aura-voice-scope.ts";
import { validateAuraTool, validateInventoryFilters, validateSocFilters } from "./aura-gemini.ts";
function assert(value: unknown) { if (!value) throw new Error("Assertion failed"); }
function throws(run: () => unknown) { let failed = false; try { run(); } catch { failed = true; } assert(failed); }
Deno.test("app context is exact, bounded and never accepts actor or arbitrary filters", () => {
  assert(parseAuraAppContext({ season: "F1", salesyear: 27, settingRevision: 1 }).salesyear === 27);
  for (const bad of [{ season: "U3", salesyear: 27, settingRevision: 1 }, { season: "F1", salesyear: "27", settingRevision: 1 },
    { season: "F1", salesyear: 100, settingRevision: 1 }, { season: "F1", salesyear: 27, settingRevision: -1 },
    { season: "F1", salesyear: 27, settingRevision: 1, role: "ADMIN" }]) throws(() => parseAuraAppContext(bad));
});
Deno.test("variant tokens require explicit whole words, not model hints or substrings", () => {
  assert(requestedAuraVariants("How many Baby Gem Boxwoods?").length === 0);
  assert(requestedAuraVariants("Cone Tree Espaliers").join(",") === "cone,tree,espalier");
  assert(requestedAuraVariants("Coneflower Street").length === 0);
  throws(() => validateAuraTool("inventory", { operation: "stock", filters: { requestedVariants: ["cone"] } }));
  assert(validateInventoryFilters({ requestedVariants: ["cone"], metric: "s_lts" }).metric === "s_lts");
});
Deno.test("SOC spoken seasons preserve literal codes and exclude quoted plant names", () => {
  for (const season of ["F1", "S1", "U1", "U2", "U3", "X", "Y", "Z"]) assert(spokenAuraSeason(`orders for ${season}`) === season);
  assert(spokenAuraSeason('orders for "F1 Rose"') === undefined);
  assert(spokenAuraSeason("reserves in U two") === "U2");
  throws(() => spokenAuraSeason("F1 and S1"));
});
Deno.test("SOC tools cannot select another actor, inject IDs or add a year predicate", () => {
  const args = { commonname: "Baby Gem® Boxwood", contsize: "3DP", customername: "Acme" };
  assert(validateAuraTool("soc_reserves", args).name === "soc_reserves");
  for (const extra of [{ customerId: "another" }, { actorId: "admin" }, { salesYear: 27 }, { requestedVariants: ["cone"] }]) {
    throws(() => validateAuraTool("soc_open_orders", { ...args, ...extra }));
  }
  assert(validateSocFilters({ ...args, customerId: "00012", requestedVariants: [], expectedSettingRevision: 1 }).customerId === "00012");
});
Deno.test("open stock and reserve remaining quantities preserve signed and zero values", () => {
  assert(signedAuraQuantity(-12) === -12 && signedAuraQuantity(0) === 0);
  for (const bad of [null, "12", undefined, NaN, Infinity]) throws(() => signedAuraQuantity(bad));
});
