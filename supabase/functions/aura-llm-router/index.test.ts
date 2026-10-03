import { assertInventoryOnlyText, actionsFrom, hasMultipleDraftCalls, modelFactSelection, parseAuraLlmRequest } from "./index.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("router accepts bounded inventory command with stable UUID", () => {
  const parsed = parseAuraLlmRequest({
    mode: "command", text: "How many 3 gallon dogwoods are available?", source: "typed",
    turnId: "123e4567-e89b-42d3-a456-426614174000", context: { sku: "DG-1", size: "3 gal" },
  });
  assert(parsed.mode === "command" && parsed.context.sku === "DG-1", "command fields should parse");
});

Deno.test("router rejects untrusted transcript and invalid turn IDs", () => {
  let threw = false;
  try { parseAuraLlmRequest({ mode: "command", text: "check", turnId: "caller-selected-id" }); } catch { threw = true; }
  assert(threw, "turn ID must be a UUID");
  threw = false;
  try { assertInventoryOnlyText("Text my customer the address", false); } catch { threw = true; }
  assert(threw, "customer communications must not go to the provider");
});

Deno.test("router blocks customer financial and order-status intent even with a bound party", () => {
  for (const text of [
    "What is Acme's account balance?",
    "Check the customer's invoice",
    "What does Acme owe us?",
    "What is the order status?",
    "Has the order shipped?",
    "What is their balance?",
    "What are the payment terms?",
  ]) {
    let threw = false;
    try { assertInventoryOnlyText(text, true); } catch { threw = true; }
    assert(threw, `private customer intent must be blocked: ${text}`);
  }
  assertInventoryOnlyText("Prepare a draft order for the selected client: 25 Baby Gem Boxwood", true);
  assert(hasMultipleDraftCalls([{ name: "draft_order" }, { name: "draft_order" }]), "duplicate draft calls must be rejected together");
  assert(!hasMultipleDraftCalls([{ name: "draft_order" }, { name: "check_open_stock" }]), "one draft call can coexist with a stock check");
});

Deno.test("provider fact selector accepts only known IDs and actions omit failed tools", () => {
  const accepted = modelFactSelection({ content: { parts: [{ text: '{"factIds":["f1"]}' }] } }, 2);
  const rejected = modelFactSelection({ content: { parts: [{ text: '{"factIds":["f3"]}' }] } }, 2);
  assert(accepted.length === 1 && accepted[0] === 1, "valid fact ID should parse");
  assert(rejected.length === 0, "unknown fact IDs must be rejected");
  const actions = actionsFrom([
    { operation: "unavailable", complete: false },
    { operation: "open_stock", complete: true, total: 22, metric: "ptravailable" },
    { operation: "draft_validation", valid: false, complete: false, failures: [{ error: "test" }] },
  ]);
  assert(actions.length === 1 && actions[0].operation === "open_stock", "only supported successful inventory actions should be emitted");
});
