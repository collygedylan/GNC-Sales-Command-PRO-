---
name: test-agdata-it-stanford-db-and-realtime-sre
description: "Sandbox implementation. Bound revision refresh, public image URLs and five-source sync."
---

# test-agdata-it-stanford-db-and-realtime-sre

Sandbox implementation. Bound revision refresh, public image URLs and five-source sync.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Bound revision refresh, public image URLs and five-source sync.

### Exact ownership
- test/assets/app-runtime.js: normalizeStoragePublicUrl, driveManualErpSyncFromStatus.
- test/assets/runtime-watchdog.js: send.
- supabase/functions/app-api/index.ts: isAllowedAppOrigin.
- Code.gs: module contract.
- sw.js: normalizeStoragePhotoRequest, handleRuntimeImageRequest.
- scripts/apply-item-low-stock-migration.mjs: agdataV23130QuotaSecurityMigrationName.
- test/assets/live-sync-coordinator.js: createCoordinator.
- test/assets/erp-sync-ui-functions.js: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_app_dataset_revisions
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- channels per tab/session ≤ 1; revision debounce = 500ms; transformed image requests = 0.
- Five source completion requires a publication receipt; staged_rows ≥ parsed_rows requests continuation.
- 1920px at 0.90 and <400ms are requested upload targets; preserve proven fallback limits and measure encoding/network independently.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-it-stanford-db-and-realtime-sre, test-agdata-supabase-quota-and-egress-guardian, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-it-stanford-db-and-realtime-sre.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- PHOTO-TARGET-2026-11-05: The initial photo encoding target remained 1600px at 0.85 after the requested Full HD upgrade. Begin at a 1920px maximum edge and JPEG 0.90, never upscale smaller inputs; keep the bounded byte/quality fallback and static thumbnails. Measure actual network latency. Permanent assertion: tests/golden-invariants.test.mjs Invariant 481; tests/gem-learning-bus.test.mjs. Evidence: 2026-11-05 worker and main-thread codec inspection..
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
