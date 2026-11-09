---
name: agdata-canonical-engine
description: Protect AgData canonical inventory hydration, exact-row evidence, photo/evaluation publication, completion receipts, and mutation models. Use for src/engine or shared row/card behavior; do not use for shell styling or database transport ownership.
---

# AgData Canonical Engine

Own src/engine and the pure domain rules shared by Drive, AV, Que, Reclass,
Docks, Request, Suspend, and Eval surfaces.

## Canonical owners

- Physical card truth resolves through resolveCanonicalInventoryRow and its
  canonical hydration facade. Order quantity is never an On Hand fallback.
- Evaluation and published photo evidence enter
  publishRowEvaluationToMasterAndNotes.
- Request completion becomes visible only through
  applyConfirmedRequestCompletionReceipt with the matching durable receipt.
- Exact physical identity includes the authoritative UID and required
  item/location/lot/season/year context. Ambiguity requires selection.

## Behavior contracts

- MARK DONE publishes exact-row evidence; Suspend Complete Tag alone removes
  the physical tag.
- Loc Photo Match and Loc On Hand remain location-scoped and numeric only when
  supported by a complete authorized cohort or matching aggregate receipt.
- Optimistic mutations retain rollback data, account scope, command identity,
  and receipt fences. A timeout or stale read never invents success.
- Photo transports remain subordinate authenticated mechanisms, not alternate
  publication owners.
- Engine modules are pure where practical: no DOM mutation, no direct network
  calls, and no duplicate caches.

## Engineering limits

Every module is below 400 physical lines. Every new or modified function is at
most 60 lines and nesting is at most three. Extract shared logic instead of
copying it across Drive, AV, Que, Reclass, Request, Suspend, or Docks.

## Verification

Run focused canonical-row, row-evaluation, completion-receipt, Reclass,
Suspend, Drive/AV, and Docks tests for the touched contract. Include negative
wrong-row/wrong-account receipts and safe matching counterexamples.

## Forbidden Anti-Patterns (Never Repeat)

- Never copy an extracted card/evidence/publication helper back into the legacy
  runtime or call a classic-script lexical owner as an undeclared global.
  Compose the generated fragment from its `src/engine` or `src/views` owner,
  cross the ordered-script seam through `globalThis`, and verify source/output
  parity plus wrong-row and wrong-account receipt rejection (Invariant 564).

The complete 21-to-5 migration and caller checklist is in
docs/gemini-clean-gems-blueprint.md.
