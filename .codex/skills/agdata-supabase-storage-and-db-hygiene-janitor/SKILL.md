---
name: agdata-supabase-storage-and-db-hygiene-janitor
description: Maintain photo URL normalization and bounded database retention.
---

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
- Never turn cache misses or telemetry into idle polling, expose protected tables through a blanket read policy, delete referenced receipts, or reject an empty CI-owned receipt without checking the installed contract. Invariants 323–326 and Locks 11–13 cover these seams.
