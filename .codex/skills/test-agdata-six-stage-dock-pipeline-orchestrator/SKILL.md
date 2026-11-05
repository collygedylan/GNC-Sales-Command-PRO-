---
name: test-agdata-six-stage-dock-pipeline-orchestrator
description: "Govern test dock transitions, checker evidence, inspector release, palletization and pink-tape isolation."
---

# six stage dock pipeline orchestrator

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.

## Canonical six-stage transition
1. Field pulling records STAGED_AT_DOCK only after physical arrival.
2. Dock staging records actual bays; HL C.12.000 allocations obey the shared 11-bay transaction.
3. Tagging exposes Flag Mistake and Drop Tagging Complete; a flagged row leaves validation and enters the mistake queue.
4. Checkers record verified quantities against exact SOC lines. A positive drop releases only verified rows to the Inspector Gate when verified units reach at least 10% of total units.
5. At 95% verified completion, publish READY_FOR_PALLETIZATION only if the remainder is explicitly isolated as mistakes. Loading must exclude every pink-tape unit. TRAILER_LOADED requires a server-validated physical completion receipt.
6. A role-authorized inspector signature and timestamp transition the completed drop to Traffic Dispatch, preserving the immutable signature and load identity. Traffic is the handoff, not an extra editable dock stage.

## Evidence and concurrency
Derive total/checked/mistake quantities from transactional line evidence; clients may not forge aggregate counters. Zero totals never satisfy percentage thresholds. Validate all counts as nonnegative integers and checked+mistakes<=total. Recompute thresholds on INSERT and UPDATE and revoke stale readiness after a reversal. A 95% alert is idempotent for its drop/revision. Never touch or load any plant flagged with physical pink tape. Enforce this in SQL as well as the UI.

## Verification
Exercise 0/9/10/94/95/100%, insertion above a threshold, downward corrections, duplicate checker receipts, conflicting updates, pink-tape loading rejection, premature signoff rejection, authorized final handoff and exact queue removal.

## Cross-layer blast radius
Changes are confined to test frontend modules, test-only Edge/server commands, public.test_* RPCs/tables and test_* private schemas. The isolated Apps Script sender delivers only signed new test events to Dylan. Production Code.gs, SQL/RPCs, app-api, runtime and delivery workers are read-only donors and remain unchanged. Shared test Back/navigation and server authorization stay canonical.

## Forbidden Anti-Patterns (Never Repeat)
- Never treat a client-only guard, a renamed table, a copied trigger, or an HTTP success as proof of isolation or a committed operation.
- Never promote test code/data, execute copied production jobs, reuse live secrets or broaden production grants automatically.
- Append a behavior-based regression test and the root cause here when fixing this domain; do not weaken prior contracts.
