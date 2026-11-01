---
name: agdata-fast-release-and-ci-pipeline-guard
description: Ship scoped AgData releases with bounded output and idempotent CI receipts.
---

# agdata-fast-release-and-ci-pipeline-guard

Read relevant skill sections and symbol-index entries without dumping monoliths. Use npx deno. Update all version surfaces and prepare the active _site before one tooling-gate invocation. Existing empty CLI migration receipts pass only after installed-contract verification; conflicting nonempty history fails. Never use gh run rerun --failed; rerun the full workflow. Keep main-thread work and compact logs in Release Evidence.

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
