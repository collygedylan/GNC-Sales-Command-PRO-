---
name: test-agdata-mistake-queue-and-line-split-specialist
description: "Maintain test mistake evidence, F1/S1 replacement eligibility and atomic multi-bay splits."
---

# mistake queue and line split specialist

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.

## Pink-tape rejection evidence
R-all rejects the whole line and needs one actual Bad Plant image. R-[N] rejects a positive subset strictly below the ordered quantity and needs Bad Plant plus Good Plant images. Require nonblank valid storage references owned by farm-operations-staging; an empty string is not a photo. Preserve rejected, verified and shipped quantities independently. Downsample within 1920×1080 at JPEG 0.8, measure the <500ms target separately from upload latency and show progress/retry state.

## Replacement eligibility
Only exact F1 and S1 season tokens are eligible, including documented sale-year prefixes. Reject Y/27.Y, U3, FS, U1, U2 and X with SEASON_CODE_INELIGIBLE. Do not accept substring matches. Preserve row_uid, lot, priority and physical location for each chosen replacement.

## Atomic splitting
Lock the original SOC line and all source inventory rows in stable UID order. Validate positive integer allocations, exact item equivalence, F1/S1 eligibility, total equal to the requested replacement and sufficient per-row remaining stock. Deduct each chosen row once and create exact children with is_split_line=true, parent_soc_id referencing the original. Retire/supersede the original demand in that same transaction so the parent plus children cannot double-count. Update test_ph_docks consistently and store a command receipt. Replays return that receipt without new deductions or children.

## Verification
Test full/partial image requirements, signed wrong-bucket URLs, all blocked season tokens, 5+5 allocations across B.15.000/B.32.000, mismatched sums, overdraw, simultaneous allocations, rollback, duplicate submits and matching SOC/Docks totals.

## Cross-layer blast radius
Changes are confined to test frontend modules, test-only Edge/server commands, public.test_* RPCs/tables and test_* private schemas. The isolated Apps Script sender delivers only signed new test events to Dylan. Production Code.gs, SQL/RPCs, app-api, runtime and delivery workers are read-only donors and remain unchanged. Shared test Back/navigation and server authorization stay canonical.

## Forbidden Anti-Patterns (Never Repeat)
- Never treat a client-only guard, a renamed table, a copied trigger, or an HTTP success as proof of isolation or a committed operation.
- Never promote test code/data, execute copied production jobs, reuse live secrets or broaden production grants automatically.
- Append a behavior-based regression test and the root cause here when fixing this domain; do not weaken prior contracts.
