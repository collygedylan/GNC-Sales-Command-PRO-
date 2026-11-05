---
name: agdata-db-cmu-chief-schema-and-constraint-architect
description: "Protect physical identity and database constraints."
---

# agdata-db-cmu-chief-schema-and-constraint-architect

Protect physical identity and database constraints.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Protect physical identity and database constraints.

### Exact ownership
- assets/app-runtime.js: module contract.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- assets/user-access-control.js: module contract.
- assets/row-workflow-functions.js: calculateLiveLocPhotoMatch, beginOptimisticCompletedRow, syncCompletedRowControls, replaceDetailMediaPreservingImages.
- test/database/operations.sql: test_fn_normalize_itemcode.
- test/database/exact-row-notes.sql: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: ph_master_inventory, ph_location_sales_notes, ph_soc_master, ph_reserves
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- inventory mutation predicate includes exact unique_id; locationcode-only updates = 0.
- rtrim(trim(coalesce(itemcode, empty)), dot) removes trailing dots only; ambiguous family-to-physical mappings require explicit selection.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-db-cmu-chief-schema-and-constraint-architect, agdata-zero-regression-mutation-engine, agdata-cross-gem-memory-bus-orchestrator, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-db-cmu-chief-schema-and-constraint-architect.

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
