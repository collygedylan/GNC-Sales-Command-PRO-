---
name: test-agdata-supabase-storage-and-db-hygiene-janitor
description: Maintain photo URL normalization and bounded database retention.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# agdata-supabase-storage-and-db-hygiene-janitor

Use public.ph_prune_supabase_bloat_v1 with service_role execution only. Preserve referenced delivery receipts, active leases, resumable private ERP cursors and truthful completion. Normalize nested JSON strings without changing JSON types or unrelated query parameters. Inspect actual catalog names; skip absent legacy relations.

## Owned Files, Canonical Functions & SQL Contracts
Canonical functions: normalizeStoragePublicUrl, normalizeStoragePhotoRequest, isAllowedAppOrigin and ph_prune_supabase_bloat_v1.

## Cross-Layer Blast Radius
Read [the dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and agdata-symbol-index.json. Runtime/SW quota controls, app-api origin/telemetry, SQL normalization/RLS/retention and CI receipts are scoped together. Code.gs imports/delivery, native auth, mutation grants and shared Back/navigation (goBackUniversal) retain their contracts. No new startup read is added.

## Focused verification
```sh
node --test tests/supabase-quota-security.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- v2.3.140 follow-up: Never strip the exact-row object prefix or concatenate it into the hash when checking static photo derivatives. Require both real 144px and 320px thumbnails under the original prefix; unscoped sibling thumbnails must not satisfy scoped health (Invariant 377).
- Never turn cache misses or telemetry into idle polling, expose protected tables through a blanket read policy, delete referenced receipts, or reject an empty CI-owned receipt without checking the installed contract. Invariants 323–326 and Locks 11–13 cover these seams.

## Environment boundary
Use test/ implementations and sandbox apztnscvagayslumnalr with mapped test_* objects. Donor paths describe the canonical behavior, not authorization to mutate production.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain photo URL normalization and bounded database retention.

### Exact ownership
- test/assets/app-runtime.js: normalizeStoragePublicUrl, isQuotaBackgroundPollingAllowed, isAllowedAppHostname.
- test/assets/runtime-watchdog.js: send.
- supabase/functions/app-api/index.ts: isAllowedAppOrigin.
- Code.gs: module contract.
- sw.js: normalizeStoragePhotoRequest, handleRuntimeImageRequest.
- scripts/apply-item-low-stock-migration.mjs: agdataV23130QuotaSecurityMigrationName.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_ph_prune_supabase_bloat_v1
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-supabase-storage-and-db-hygiene-janitor, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-supabase-storage-and-db-hygiene-janitor.

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
