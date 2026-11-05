---
name: test-agdata-supabase-quota-and-egress-guardian
description: Reduce avoidable Supabase image, Edge and realtime traffic without blocking operational views.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# test-agdata-supabase-quota-and-egress-guardian

Use normalizeStoragePublicUrl through the canonical getSupabaseStorageOriginalUrl. Keep test-agdata-photo-cache-v1 cache-first, normalized keys and serialized 500-entry LRU. Pause background polling while hidden or the sync modal is closed; keep active server relays and explicit reads. Preserve applyRealtimeChange in-memory deltas and identity fences. Measure savings after release; do not promise a percentage from static checks.

## Owned Files, Canonical Functions & SQL Contracts
Canonical functions: normalizeStoragePublicUrl, normalizeStoragePhotoRequest, isAllowedAppOrigin and test_ph_prune_supabase_bloat_v1.

## Cross-Layer Blast Radius
Read [the dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) and test-agdata-symbol-index.json. Runtime/SW quota controls, app-api origin/telemetry, SQL normalization/RLS/retention and CI receipts are scoped together. test/workers/email/Code.gs imports/delivery, native auth, mutation grants and shared Back/navigation (goBackUniversal) retain their contracts. No new startup read is added.

## Focused verification
```sh
node --test test/tests/supabase-quota-security.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- v2.3.144 field follow-up: Native atomic photo attachments store only the compressed main image; skip unused derivative encoding only for that route. Keep both real thumbnails on the normal Storage path. User-selected uploads start immediately, pause passive refresh contention, and retain exact-row native authorization and committed receipt checks.
- v2.3.144: Never reset a proven gateway outage on reload or make Item Detail wait for photo transport warm-up. Persist the bounded 30-minute agdata_storage_gateway_cooldown_until_v1 deadline; warm only on detail entry through the native read-only test_can_upload_drive_evidence_v23115 RPC, exact Edge HEAD ?photo_warm=1, write-free blob-RPC OPTIONS, representative image-codec initialization and bounded Storage HEAD. Single-flight and account fences remain mandatory; warm-up never writes evidence or grants authority. Invariant 399 supersedes the five-minute RAM-only cooldown. Report actual HTTP cache headers separately from storage metadata.
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated test_store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- Never serialize unbounded photo uploads, hide other staged Reclass rows, or treat added candidates as an exact-order replacement. Keep 1280px/200KB JPEG compression, authenticated test_store_drive_photo_blob_v1 recovery, canonical Drive Item Detail, exact source/group commands with preserved split totals, and statement-level evidence propagation. Invariants 391–393 cover these seams; no new startup read, test/workers/email/Code.gs or delivery changes.
- Never turn cache misses or telemetry into idle polling, expose protected tables through a blanket read policy, delete referenced receipts, or reject an empty CI-owned receipt without checking the installed contract. Invariants 323–326 and Locks 11–13 cover these seams.
