---
name: agdata-cybersecurity-and-rls-fortress
description: Maintain RLS, invoker views and authenticated mutation boundaries.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# agdata-cybersecurity-and-rls-fortress

Keep ph_app_users, user_access_control and delivery outbox inaccessible to anonymous readers/writers. New operational read policies may preserve existing SELECT grants; never blanket-grant credentials. Origin checks supplement native/session authentication and SQL capability checks.

## Owned Files, Canonical Functions & SQL Contracts
Canonical functions: normalizeStoragePublicUrl, normalizeStoragePhotoRequest, isAllowedAppOrigin and ph_prune_supabase_bloat_v1.

## Cross-Layer Blast Radius
Read [the dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and agdata-symbol-index.json. Runtime/SW quota controls, app-api origin/telemetry, SQL normalization/RLS/retention and CI receipts are scoped together. Code.gs imports/delivery, native auth, mutation grants and shared Back/navigation (goBackUniversal) retain their contracts. No new startup read is added.

## Focused verification
```sh
node --test tests/supabase-quota-security.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- Never turn cache misses or telemetry into idle polling, expose protected tables through a blanket read policy, delete referenced receipts, or reject an empty CI-owned receipt without checking the installed contract. Invariants 323–326 and Locks 11–13 cover these seams.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Maintain RLS, invoker views and authenticated mutation boundaries.

### Exact ownership
- assets/app-runtime.js: normalizeStoragePublicUrl, isQuotaBackgroundPollingAllowed, isAllowedAppHostname.
- assets/runtime-watchdog.js: send.
- supabase/functions/app-api/index.ts: isAllowedAppOrigin.
- Code.gs: module contract.
- sw.js: normalizeStoragePhotoRequest, handleRuntimeImageRequest.
- scripts/apply-item-low-stock-migration.mjs: agdataV23130QuotaSecurityMigrationName.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: ph_app_users, ph_prune_supabase_bloat_v1
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-cybersecurity-and-rls-fortress, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-cybersecurity-and-rls-fortress.

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
