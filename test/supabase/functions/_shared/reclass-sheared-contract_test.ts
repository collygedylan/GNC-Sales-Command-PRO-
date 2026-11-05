import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { RECLASS_SHEARED_POLICY, reclassShearedProposal, validateReclassShearedProposals } from "../../../services/reclassSheared.ts";

Deno.test("typed sheared proposals retain exact quantities and never accept a designation from the client", () => {
  assertEquals(reclassShearedProposal({ action: "sheared", quantity: 100 }), { action: "sheared", quantity: 100 });
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", 2147483648, null]) {
    assertThrows(() => reclassShearedProposal({ action: "sheared", quantity }));
  }
  for (const value of [null, { action: "#", quantity: 100 },
    { action: "sheared", quantity: 100, desigitem: "100-->#" },
    { action: "sheared", quantity: 100, season: "F1" }]) assertThrows(() => reclassShearedProposal(value));
});

Deno.test("new proposal validation preserves older versions and leaves legacy action validation to SQL", () => {
  validateReclassShearedProposals({ workflowPolicyVersion: "reclass-action-workflow-v4-split-moves-20261006" });
  validateReclassShearedProposals({ workflowPolicyVersion: RECLASS_SHEARED_POLICY, rowOverlays: [{ proposals: [
    { action: "move_up", splits: [{ quantity: 700, destinationSeason: "F1" }], applyHold: false, holdReason: "" },
    { action: "sheared", quantity: 100 },
  ] }] });
  for (const rowOverlays of [null, [null], [{ proposals: null }], [{ proposals: [{ action: "sheared", quantity: 0 }] }]]) {
    assertThrows(() => validateReclassShearedProposals({ workflowPolicyVersion: RECLASS_SHEARED_POLICY, rowOverlays }));
  }
});
