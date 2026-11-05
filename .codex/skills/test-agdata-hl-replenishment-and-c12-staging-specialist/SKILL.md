---
name: test-agdata-hl-replenishment-and-c12-staging-specialist
description: "Govern test-only HL replenishment, exact item mapping, C.12.000 staging and deviation reports."
---

# hl replenishment and c12 staging specialist

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.

## Identity and replenishment
Join test_ph_hl_po, test_ph_soc_master, test_ph_master_inventory and test_ph_customer_reserves through an explicit canonical mapping. test_fn_normalize_itemcode trims whitespace and trailing dots only. It cannot equate 003085.030 with 003085.030.1 by itself; accept an unambiguous exact inventory family mapping and require a physical-row selection for ambiguity. Preserve season, lot, priority and row_uid.

## Eleven-bay staging limit
C.12.000 has 23 physical bays; HL may occupy at most 11 distinct active bays. Reserve/release occupancy transactionally under a location lock; validate bay identity and capacity on the server, not only on the queue. Reusing an already reserved bay does not consume a twelfth distinct bay. Release only after the matching completed movement. Return HL_STAGING_BAY_EXHAUSTION without blanking other queues or discarding drafts.

## Pull deviations
Persist source/target quantities and exact identities atomically, prevent negative stock, record the puller's authenticated attribution, and create the test_ph_reclass_inquiries record and a durable Dylan-only outbox event in the same command. Include canonical itemcode, common/botanical description, contsize, lotcode, old_location, new_location and divergent quantities. Failed publication must not be displayed as completed. Preserve the canonical Back stack and scrolled queue.

## Verification
Test competing eleventh/twelfth reservations, repeated idempotency keys, release/reuse, ambiguous item families, exact-row deductions, rollback and the complete trapped email payload.

## Cross-layer blast radius
Changes are confined to test frontend modules, test-only Edge/server commands, public.test_* RPCs/tables and test_* private schemas. The isolated Apps Script sender delivers only signed new test events to Dylan. Production Code.gs, SQL/RPCs, app-api, runtime and delivery workers are read-only donors and remain unchanged. Shared test Back/navigation and server authorization stay canonical.

## Forbidden Anti-Patterns (Never Repeat)
- Never treat a client-only guard, a renamed table, a copied trigger, or an HTTP success as proof of isolation or a committed operation.
- Never promote test code/data, execute copied production jobs, reuse live secrets or broaden production grants automatically.
- Append a behavior-based regression test and the root cause here when fixing this domain; do not weaken prior contracts.
