---
name: agdata-it-harvard-formal-verification-and-qa-director
description: "Verify receipts, locks, thumbnails and Reclass authorization."
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# agdata-it-harvard-formal-verification-and-qa-director

Verify receipts, locks, thumbnails and Reclass authorization.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Verify receipts, locks, thumbnails and Reclass authorization.

### Exact ownership
- assets/app-runtime.js: calculateLiveLocPhotoMatch.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- assets/user-access-control.js: module contract.
- assets/row-workflow-functions.js: module contract.
- scripts/enforce-all-gems-gate.mjs: module contract.
- tests/golden-invariants.test.mjs: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: ph_master_inventory
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- completion lock ⇒ photo exists ∧ Loc Photo Match > 0; explicit unlock still requires the authenticated exact-row RPC.
- blob URL retirement ⇒ remote Image.onload; Reclass event stops card propagation.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-it-harvard-formal-verification-and-qa-director, agdata-zero-regression-mutation-engine, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-it-harvard-formal-verification-and-qa-director.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- GATE-FIXTURES-2026-11-05: Legacy fixtures omitted new dependency and receipt fields and retained expectations superseded by current workflows; progress dialog width lost its bounded centering. Golden invariants dynamically imported test modules whose test registrations became children of an already finishing parent on hosted Node 22, causing cancelled tests. Use current exact receipts and real helper dependencies; preserve no-photo unlock, no forced reload, Location column and five operational sources. Keep the progress dialog bounded and centered. Keep shared assertions in modules that do not register or import test files; register the same assertion functions independently from Golden and standalone suites. Permanent assertion: tests/golden-invariants.test.mjs Invariant 480; scripts/enforce-all-14-gems-gate.mjs Golden invariant 541 checks shared assertion modules and negative node:test and test-file imports; invariants 482 through 488 retain the behavior checks.. Evidence: 2026-11-05 gate failure log and canonical source inspection. https://github.com/collygedylan/GNC-Sales-Command-PRO-/actions/runs/42448871641/job/128633594003.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
