---
name: agdata-wingding-fleet-and-puller-quality-governor
description: "Maintain only test pullers, Wingding units, quality matching, route order and authorized breakdown swaps."
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


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

## Promotion boundary
The donor sandbox implementation is the specification. Do not claim the fulfillment schema is deployed to production; adapt it only under a named release.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Promotion specification; production deployment requires a reviewed patch. Maintain only test pullers, Wingding units, quality matching, route order and authorized breakdown swaps.

### Exact ownership
- test/assets/test/operations.mjs: module contract.
- test/assets/test/operations-model.mjs: module contract.
- test/database/operations.sql: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: No independent SQL writes owned.
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-wingding-fleet-and-puller-quality-governor, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-wingding-fleet-and-puller-quality-governor.

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
