---
name: gnc-bunch-notes-crew-and-ribbon-dispatcher
description: Crew work and tape for Bunch Notes and nursery command planning; use when changing this domain in the thirteen-rule issue and approval workflow.
---

# Crew work and tape

Rule 11: BOB grades/flags Blue/White/Red/Green; QC small TA/stakes; SAM pre-bunch shearing/hauling; RHETT shift grading/hauling; CHRIS residue/scale spray; SHARON/ZAYNE field signs and VM sorting; TA dump reconciliation. Four corner stakes use Yellow Tape (LowH20), Pink Tape (outside/drape), Shift Tape or Shift + Pink Tape. Rule 12 separates look-alike varieties and same-color tags; preserve the selected crew when adding divider instructions.

## Owned Files, Canonical Functions & SQL Contracts

Use all 11 routes in [AGENTS.md](../../../AGENTS.md) and the [dependency map](../../../docs/architecture/agdata-module-dependency-map.md). BUNCH_NOTES_SIMULATOR → Issues → Drive Mode Card → Approve & Create New Bunch Note uses the 13-Rule evaluator in assets/nursery-command-model.js and controller in assets/nursery-command-tables.js. The auditor owns Gates 1–7, Rules 8–13 and the six issue categories; this Gem contributes its domain evidence. resolveBunchNoteExceptionRowIdentity is canonical in the model; assets/app-runtime.js delegates to it. Never add competing evaluators.

## Cross-Layer Blast Radius

Every issue has unique_id, locationcode, itemcode, lotcode, commonname and contsize. Retain physical live UIDs; explicitly historical identities use <locationcode>::<itemcode>::GHOST_LOT or HISTORICAL_LOT, zero unverified stock and a ghost badge. Synchronously publish same-account optimistic decisions to localStorage, Simulator, APPROVED_EXECUTION_PLAN and exact-row Drive projections; defer the authorized nursery_command_v23127 save with return=minimal. Validate the exact receipt, retain stable command IDs, and roll back with a retained draft and toast on failure. Never turn a historical approval into stock movement.

Preserve switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack, header/search ownership and READY/LKG reads. SQL seeds source-backed historical definitions idempotently; authenticated RPC authorization and optimistic revision guards remain authoritative. Browser direct-table grants, app-api, Code.gs and Apps Script delivery/outbox remain unchanged; no startup read is added.

## Forbidden Anti-Patterns (Never Repeat)

- Block-only historical cards and waiting for the network before updating approval caused unresolved work and slow UI. Invariants 339–340 require complete identities, immediate projection, exact receipts and rollback. Never fabricate a live master UID, replace physical inventory with historical stock, or broaden mutation grants.

## Scoped verification

Use tests/manager-table-workspace.test.mjs, the appended golden invariants and Permanent Lock 10 in scripts/enforce-all-14-gems-gate.mjs; register this manifest in scripts/run-tooling-release-checks.mjs.

```sh
node --test tests/manager-table-workspace.test.mjs tests/nursery-command.test.mjs
```
