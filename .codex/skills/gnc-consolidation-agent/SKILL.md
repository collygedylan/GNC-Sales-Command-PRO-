---
name: gnc-consolidation-agent
description: Maintain the thirteen-rule nursery Bunch Note generator, whole-group destination proof, house capacity and crew/tape rules.
---

# Automated Bunch Notes

Use the [canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md). The canonical evaluator is GncNurseryModel.evaluateBunchNoteRowAndIssues in assets/nursery-command-model.js; GncNurseryTables in assets/nursery-command-tables.js owns the Simulator Table, Issues, Bunch Note Rules and exact-row approval modal. Do not add a second evaluator in app-runtime.js.

## Owned Files, Canonical Functions & SQL Contracts

Canonical functions: buildBunchNoteContext, evaluateBunchNoteRowAndIssues, publishBunchDecisions, approvedBunchNote; nursery_command_v23127 and ph_dylan_decisions_store remain the only persistence path.

## Rules and workflow

Preserve Gates 1–7: .Y/pathology protection, whole-group moves, source/sale-year tiers, four-tier planting reservations, documented ±250 mL/day demand, permanent shade/orientation and net bed capacity.

8. Tag all seven sequence threads, walking direction and Center House (straddling the 4-inch line).
9. Crapemyrtle, Abelia, Hydrangea, Boxwood, Indian Hawthorn and Pampas Grass require the inside-drape instruction and 8% edge-capacity deduction.
10. Apply early-protect spread space, small Hosta/Astilbe 2-finger, 3DP Baby Gem Boxwood 4-finger and shift countable spacing.
11. Preserve BOB/QC/SAM/RHETT/CHRIS/SHARON/ZAYNE/TA task prefixes, Blue/White/Red/Green flags and Yellow/Pink/Shift/Shift + Pink corner tape laws. Pink vigorous groups are limited to one third; Grapes require G.01. Do not invent a partial allocation.
12. Separate the named look-alike pairs and same-color field tags with divider varieties, wide aisles or opposite houses.
13. Use one house if capacity proves a fit; otherwise outer-house no-flags and flagged stock in the back half of warmer Center House.

Managers → Table Management → BUNCH_NOTES_SIMULATOR → Issues → Drive Mode Card → Approve & Create New Bunch Note. Show concrete rule numbers/reasons and the full exact row. Missing destination, water, house or capacity evidence is a review condition. In-place protected notes do not authorize physical stock movement.

## Persistence and shared navigation

Use nursery_command_v23127 with expectedUpdatedAt and one stable commandId per retry. ph_dylan_decisions_store plan_id is BN- plus the encoded master unique_id; retain exact source/item/lot context. Publish clearly pending optimistic same-account localStorage and Drive projections synchronously; confirm the exact receipt asynchronously and roll back on failure. Do not replace locationnote or bypass existing inventory mutation gates. Preserve switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack and header/search ownership. Modal drafts survive failed saves and background refreshes; closing the workspace clears its modal.

## Cross-Layer Blast Radius

The existing nursery controller/model and Drive presentation own this workflow. Existing authenticated SQL/RPC authorization and idempotency stay authoritative; app-api, Code.gs, delivery workers, private credentials and startup endpoints retain their contracts. New references use the existing on-demand nursery RPC, never a new startup bulk read. A block name alone cannot establish an item/lot audit match.

## Forbidden Anti-Patterns (Never Repeat)

- Never treat a documented zero-house open block as missing data or fabricate a Center House there. Preserve open-block bunching while requiring a real house for inside drape (Invariant 338).

- Never infer tagging work from the generated same-color separation instruction. Derive the crew from the source work or reviewed picker, then re-audit the generated note without changing that crew (Invariant 337).

- Never label a generic seven-gate projection a thirteen-rule audit, invent a destination from an unresolved block note, apply a note to sibling UIDs, or report approval before an exact durable receipt. Invariant 336 preserves unknown-target rejection and account/UID isolation.

## Scoped verification

node --test tests/manager-table-workspace.test.mjs tests/nursery-command.test.mjs

## v2.3.134 Whole-group consolidation

Own 03_SPACE_AND_HYDRO. Move 100% of ITEMCODE by LOCATIONCODE; never approve a ..O partial split without a proven assigned destination. Clear beds T-28d to T-14d before can fill. Rule 13 requires one house when capacity proves fit; otherwise outer houses have no flags and flagged stock belongs in the back half of warmer Center House.

## Shared workflow and canonical ownership

Use all 11 routes in [AGENTS.md](../../../AGENTS.md) and the [dependency map](../../../docs/architecture/agdata-module-dependency-map.md). BUNCH_NOTES_SIMULATOR → Issues → Drive Mode Card → Approve & Create New Bunch Note uses the 13-Rule evaluator in assets/nursery-command-model.js and controller in assets/nursery-command-tables.js. The auditor owns Gates 1–7, Rules 8–13 and the six issue categories; this Gem contributes its domain evidence. resolveBunchNoteExceptionRowIdentity is canonical in the model; assets/app-runtime.js delegates to it. Never add competing evaluators.

## Persistence, navigation and cross-layer blast radius

Every issue has unique_id, locationcode, itemcode, lotcode, commonname and contsize. Retain physical live UIDs; explicitly historical identities use <locationcode>::<itemcode>::GHOST_LOT or HISTORICAL_LOT, zero unverified stock and a ghost badge. Synchronously publish same-account optimistic decisions to localStorage, Simulator, APPROVED_EXECUTION_PLAN and exact-row Drive projections; defer the authorized nursery_command_v23127 save with return=minimal. Validate the exact receipt, retain stable command IDs, and roll back with a retained draft and toast on failure. Never turn a historical approval into stock movement.

Preserve switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack, header/search ownership and READY/LKG reads. SQL seeds source-backed historical definitions idempotently; authenticated RPC authorization and optimistic revision guards remain authoritative. Browser direct-table grants, app-api, Code.gs and Apps Script delivery/outbox remain unchanged; no startup read is added.

## Forbidden Anti-Patterns (Never Repeat)

- Block-only historical cards and waiting for the network before updating approval caused unresolved work and slow UI. Invariants 339–340 require complete identities, immediate projection, exact receipts and rollback. Never fabricate a live master UID, replace physical inventory with historical stock, or broaden mutation grants.

## Scoped verification

Use tests/manager-table-workspace.test.mjs, the appended golden invariants and Permanent Lock 10 in scripts/enforce-all-14-gems-gate.mjs; register this manifest in scripts/run-tooling-release-checks.mjs.
