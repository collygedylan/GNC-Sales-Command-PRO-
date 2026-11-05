---
name: test-agdata-wingding-fleet-and-puller-quality-governor
description: "Maintain only test pullers, Wingding units, quality matching, route order and authorized breakdown swaps."
---

# wingding fleet and puller quality governor

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.

## Registry and shift pairing
Seed exactly pullers 001–080 and units 200–240 idempotently. Never fabricate real crew names or overwrite assigned quality on rerun; seeded demonstration identities are labeled. Puller quality is ESP, SP or BLANK (null/empty normalize to BLANK). Unit capacity is an integer clamped to 500–700, default 600 when no reviewed capacity exists.
A morning team has one active driver and one distinct active helper. Serialize pairing to prevent any person or unit belonging to two active teams for the same shift. Store stable team identity independently of hardware.

## Quality and route rules
ESP plus any partner makes an ESP crew; otherwise any SP makes SP; otherwise BLANK. ESP crews can pull all three tiers, SP crews only SP/BLANK, and BLANK crews only BLANK. The server calls test_fn_can_team_pull_tag before assignment; unknown quality fails closed and higher-tier assignment returns INSUFFICIENT_PULLER_QUALITY_TIER. Capacity applies to the sum of remaining assigned quantities, not the number of rows.
Sort rush lines first, then parsed Block Alpha, numeric Block/Bay, numeric Day/Row and a stable physical-line tie-breaker. Do not use lexicographic ordering for numeric route components.

## Breakdown swap
Only authenticated active Tanner, Jack, Tyler or canonical dylan_collyge may perform the server-authorized swap. Resolve their exact account IDs from the cloned roster; display names never grant authority. Lock old/new units and team in one transaction. The old unit must be degraded, the destination operational and free. Preserve driver/helper/team, completed quantities and receipts. Rebatch remaining unpulled lines to replacement capacity without duplicating or dropping work.

## Verification
Exercise every quality pair, empty/invalid tiers, duplicate team members, inactive people, concurrent check-in, overflow, numeric routes, unauthorized swaps and mid-batch replay.

## Cross-layer blast radius
Changes are confined to test frontend modules, test-only Edge/server commands, public.test_* RPCs/tables and test_* private schemas. The isolated Apps Script sender delivers only signed new test events to Dylan. Production Code.gs, SQL/RPCs, app-api, runtime and delivery workers are read-only donors and remain unchanged. Shared test Back/navigation and server authorization stay canonical.

## Forbidden Anti-Patterns (Never Repeat)
- Never treat a client-only guard, a renamed table, a copied trigger, or an HTTP success as proof of isolation or a committed operation.
- Never promote test code/data, execute copied production jobs, reuse live secrets or broaden production grants automatically.
- Append a behavior-based regression test and the root cause here when fixing this domain; do not weaken prior contracts.
