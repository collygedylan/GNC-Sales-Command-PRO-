---
name: agdata-suspend-tag-location-replace-and-docks-sync
description: "Govern test Suspend day colors, Dock 38/39 ingest, exact location replacement and two distinct completion actions."
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# suspend tag location replace and docks sync

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.

## Physical identity and presentation
One physical SOC/tag line is one Suspend card. Dock 38 and 39 lines enter both the test Suspend projection and Docks without synthetic completed history. Plan Start uses local nursery weekdays: Mon #7C3AED, Tue #DC2626, Wed #16A34A, Thu #2563EB, Fri #16A34A. Never derive local weekday from a UTC-midnight date conversion.

## Replace Location
Open an immediate dark-emerald confirmation dialog from the displayed card and refresh eligible exact F1/S1 inventory in the background. Match canonical item families only when unambiguous. Support one bay (F.23.000 to D.20.000) or explicit multi-bay allocations. Preview itemcode, description, lot, original location, every destination and its assigned quantity. Submit one authenticated idempotent transaction; preserve exact physical row identity and synchronize test_ph_soc_master and test_ph_docks with one receipt and Realtime revision.

## Distinct lifecycle actions
MARK DONE publishes all exact inventory evaluation fields, quantities, photos and location notes through the cloned canonical evidence RPC. It keeps the tag in PENDING_SUPERVISOR_CLEAR and returns immediately to the original scrolled Suspend cards after its matching receipt. Queue item/location photo fallback is display-only and can never select a write target. COMPLETE TAG alone archives/removes the card, with supervisor authorization repeated server-side.

## Verification
Test Dock 38/39 projection, local weekday colors, no-location/ambiguous items, multi-bay balance and rollback, exact master receipt mismatch rejection, return scroll position, retained Mark Done card and unauthorized Complete Tag denial.

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

Scope: Promotion specification; production deployment requires a reviewed patch. Govern test Suspend day colors, Dock 38/39 ingest, exact location replacement and two distinct completion actions.

### Exact ownership
- test/assets/test/operations.mjs: module contract.
- test/assets/test/operations-model.mjs: module contract.
- test/database/operations.sql: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_ph_soc_master, test_ph_docks
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-suspend-tag-location-replace-and-docks-sync, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-suspend-tag-location-replace-and-docks-sync.

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
