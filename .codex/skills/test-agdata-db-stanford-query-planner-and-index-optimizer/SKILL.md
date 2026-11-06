---
name: test-agdata-db-stanford-query-planner-and-index-optimizer
description: "Sandbox implementation. Verify query plans and exact inventory/dock indexes."
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# test-agdata-db-stanford-query-planner-and-index-optimizer

Sandbox implementation. Verify query plans and exact inventory/dock indexes.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Verify query plans and exact inventory/dock indexes.

### Exact ownership
- test/assets/app-runtime.js: normalizeStoragePublicUrl, isQuotaBackgroundPollingAllowed, isAllowedAppHostname.
- test/assets/runtime-watchdog.js: send.
- supabase/functions/app-api/index.ts: isAllowedAppOrigin.
- Code.gs: module contract.
- sw.js: normalizeStoragePhotoRequest, handleRuntimeImageRequest.
- scripts/apply-item-low-stock-migration.mjs: agdataV23130QuotaSecurityMigrationName.
- test/database/operations.sql: module contract.
- test/assets/assigned-items-table.js: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_ph_master_inventory, test_ph_soc_master, test_ph_itemcode_default_owners
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- EXPLAIN costs and measured latency justify indexes; do not assume a column or index exists.
- Dock parsing accepts 38, 39, Dock 38 and Dock 39; <10ms is a measurement target.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-db-stanford-query-planner-and-index-optimizer, test-agdata-supabase-schema-and-query-contract-guard, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-db-stanford-query-planner-and-index-optimizer.

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
