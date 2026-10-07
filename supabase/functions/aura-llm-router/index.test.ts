import { resolveAuraIntent } from "../_shared/aura-query.ts";

function assert(value: unknown, message: string) { if (!value) throw new Error(message); }

Deno.test("count in perennial area remains a stock count with a zone constraint", () => {
  const intent = resolveAuraIntent("How many plants are in the perennial area?");
  assert(intent.mode === "inventory" && intent.operation === "stock", "area count routes to stock");
  assert(intent.filters.zone === "perennial", "perennial boundary is explicit");
  assert(intent.filters.metric === "ptravailable", "available is the default quantity");
  assert(intent.filters.openStockOnly === false, "count does not invent an open-stock eligibility filter");
});

Deno.test("Zoe's ownership and direct-assignee questions retain their distinct filters", () => {
  const zoe = resolveAuraIntent("Show Zoe’s plants");
  assert(zoe.filters.assignee === "zoe_green", "Zoe maps to the canonical owner");
  const acer = resolveAuraIntent("Who is assigned to Acer?");
  assert(acer.mode === "ownership" && acer.filters.productText === "Acer", "plant name isn't parsed as an assignee");
  assert(!acer.filters.assigneeText, "ambiguous assignee phrase doesn't invent an assignee");
});

Deno.test("where questions use a location lookup and normalize nursery size tokens", () => {
  const where = resolveAuraIntent("Where is 3 gallon Acer?");
  assert(where.operation === "locations" && where.filters.productText === "Acer", "where routes to location lookup");
  assert(where.filters.contSize === "#3", "gallon shorthand is normalized by the shared nursery helper");
  const size = resolveAuraIntent("How many #3 dogwoods?");
  assert(size.filters.contSize === "#3", "nursery # size is normalized consistently");
});

Deno.test("workflow domain terms route to fixed capabilities", () => {
  const cases: Array<[string, string]> = [
    ["show open requests", "request_queue"], ["show orders", "sales_orders"], ["dock 12", "dock_team"],
    ["department calendar meetings", "calendar"], ["employee time off", "employees"],
    ["private chat messages", ""], ["today's weather", "weather_daily"],
    ["production work", "production_work"], ["scout pest photos", "pest"], ["marketing flyers", "marketing"],
  ];
  for (const [question, capability] of cases) {
    const intent = resolveAuraIntent(question);
    assert(capability ? intent.capability === capability : intent.mode === "chat", `routes ${question}`);
  }
});
