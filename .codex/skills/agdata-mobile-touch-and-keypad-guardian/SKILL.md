---
name: agdata-mobile-touch-and-keypad-guardian
description: Maintain responsive AV search, isolated custom measurement keypads and dark-emerald mobile controls.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# agdata mobile touch and keypad guardian

## Owned Files, Canonical Functions & SQL Contracts
Item Detail keypads, saved-note picker, AV search and first card window.
assets/app-runtime.js (applyDetailMeasurementKeyboardInputState, handleDetailMeasurementKeyboardButtonPress, openDetailMeasurementKeyboard, renderAVOpenCardsChunked), assets/app-shell-style-16.css.

## Cross-Layer Blast Radius
Use the existing switchView, goBackUniversal, header/search ownership and modal Back handlers. Preserve identity-scoped READY/LKG reads and server-authorized mutations. A skill does not authorize a deployment or email send.

Use docs/architecture/agdata-module-dependency-map.md for the canonical shared contracts. Runtime/Apps Script changes preserve SQL mutation authorization and READY/LKG reads; the scoped SOC migration changes staging cleanup only.

## Focused verification
```sh
node --test tests/operational-resilience.test.mjs
```
Run tests/operational-resilience.test.mjs; golden Invariants 359–360 and scripts/enforce-all-14-gems-gate.mjs own these contracts. Retain Planting Invariant 355. Browser timings are measured on hydrated data; physical native keyboard behavior needs device verification.

Custom fields retain readonly and inputmode="none" through keypad close.

## Forbidden Anti-Patterns (Never Repeat)
- v2.3.144: Never infer completion from photo/spec changes or drop a committed photo timestamp while restoring editor drafts. Keep unlimited photo references and ✓ UPLOADED receipts; only explicit Mark Done completes. Native unlock repeats assigned-user/Admin/super-admin authorization. Photo age >10 calendar days or evaluated zero match expires through canonical evidence/history; unentered match remains a draft and Docks-owned photos are exempt. Camera state is owner-scoped, survives recreation, and defers reload through capture plus 15 seconds. Unassigned summaries occur only once per completed manual sync on Home/Managers. Invariant 400 exercises these boundaries.
- Never serialize unbounded photo uploads, hide other staged Reclass rows, or treat added candidates as an exact-order replacement. Keep 1280px/200KB JPEG compression, authenticated store_drive_photo_blob_v1 recovery, canonical Drive Item Detail, exact source/group commands with preserved split totals, and statement-level evidence propagation. Invariants 391–393 cover these seams; no new startup read, Code.gs or delivery changes.
- Never measure sticky chrome synchronously while dismissing the measurement keyboard for completion; queue its canonical forced frame after locking controls (Invariant 387).
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.
- Never enable the native keyboard while the custom keypad is active, double-handle touch/click, or accept shear taps during keypad layout transitions. Never defer AV input repaint until typing stops. Never introduce white saved-note dropdowns or AV filter pills.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Maintain responsive AV search, isolated custom measurement keypads and dark-emerald mobile controls.

### Exact ownership
- assets/app-runtime.js: shouldApplyDetailMeasurementReadonly, handleDetailMeasurementKeyboardButtonPress, renderAVOpenCardsChunked.
- assets/row-workflow-functions.js: discardDrivePhotoAttachment.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: No independent SQL writes owned.
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-mobile-touch-and-keypad-guardian, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-mobile-touch-and-keypad-guardian.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
