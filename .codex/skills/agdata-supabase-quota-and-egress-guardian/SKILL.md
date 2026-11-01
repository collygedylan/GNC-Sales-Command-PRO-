---
name: agdata-supabase-quota-and-egress-guardian
description: Reduce avoidable Supabase image, Edge and realtime traffic without blocking operational views.
---

# agdata-supabase-quota-and-egress-guardian

Use normalizeStoragePublicUrl through the canonical getSupabaseStorageOriginalUrl. Keep agdata-photo-cache-v1 cache-first, normalized keys and serialized 500-entry LRU. Pause background polling while hidden or the sync modal is closed; keep active server relays and explicit reads. Preserve applyRealtimeChange in-memory deltas and identity fences. Measure savings after release; do not promise a percentage from static checks.

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
