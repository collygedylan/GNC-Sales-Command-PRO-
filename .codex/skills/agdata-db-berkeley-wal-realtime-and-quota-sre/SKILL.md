---
name: agdata-db-berkeley-wal-realtime-and-quota-sre
description: "Exclude bulk tables from WAL publication and bound statement logs."
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# agdata-db-berkeley-wal-realtime-and-quota-sre

Exclude bulk tables from WAL publication and bound statement logs.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Exclude bulk tables from WAL publication and bound statement logs.

### Exact ownership
- assets/app-runtime.js: normalizeStoragePublicUrl, isQuotaBackgroundPollingAllowed, isAllowedAppHostname.
- assets/runtime-watchdog.js: send.
- supabase/functions/app-api/index.ts: isAllowedAppOrigin.
- Code.gs: module contract.
- sw.js: normalizeStoragePhotoRequest, handleRuntimeImageRequest.
- scripts/apply-item-low-stock-migration.mjs: agdataV23130QuotaSecurityMigrationName.
- assets/live-sync-coordinator.js: createCoordinator.
- docs/architecture/realtime-quota-shield.sql: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: app_dataset_revisions, ph_reserves, ph_soc_master
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- bulk table membership in supabase_realtime = 0; revision and interactive memberships are retained.
- role log_statement = none; total ingestion can still include errors and other services.
- 99.98% reduction is a target, not a measured result; full-table storage.objects updates = 0.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-db-berkeley-wal-realtime-and-quota-sre, agdata-supabase-quota-and-egress-guardian, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-db-berkeley-wal-realtime-and-quota-sre.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- REALTIME-2026-11-05: Bulk RESERVES/SOC remained published, revision events bypassed batching, and sandbox operations opened a second channel. Remove bulk publication membership, debounce revision bursts for 500ms and multiplex sandbox interactive events on the session channel. Permanent assertion: tests/golden-invariants.test.mjs Invariant 479; tests/gem-learning-bus.test.mjs; docs/architecture/realtime-quota-verify.sql. Evidence: 2026-11-05 linked production and sandbox catalog inspection; source inspection..
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
