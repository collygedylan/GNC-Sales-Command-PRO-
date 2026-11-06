---
name: agdata-sandbox-and-db-clone-architect
description: "Build and validate only the AgData Test PWA, isolated schema, storage, sender and reviewed promotion."
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# sandbox and db clone architect

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.

## Standalone application and data boundary
- Preserve the current live shell and workflows as the read-only donor. Own test/index.html, test/manifest.json, test/sw-test.js and test/assets/. Install identity is AgData Test (T), short name AgData Test, start /test/index.html and scope /test/. Use distinct 192px and 512px T icons with #062817 background, #10b981 border and a bold white letter.
- Keep the prominent T · AGDATA TEST ENVIRONMENT — EMAILS ROUTED ONLY TO DYLAN badge. Prefix localStorage, IndexedDB, BroadcastChannel and every owned Cache Storage key. Never unregister or retire another application's worker/cache.
- Use the dedicated sandbox project apztnscvagayslumnalr with public.test_* relations/functions and test_* private schemas. The production connection is read-only. Resolve every PostgREST, RPC, Edge, Realtime and native Storage path centrally; reject unmapped writes.
- Clone dependencies, column types/defaults, sequences, indexes, constraints, views with security_invoker=true, functions, triggers and RLS. Rebind all dependencies; a CREATE TABLE AS copy does not preserve these. Private credential and outbox clones never gain browser SELECT or mutation grants.
- Keep snapshots truthful and resumable. Do not clone live leases, pending deliveries, cron executions, action signing keys or worker endpoints into executable jobs. Historical cloned outbox rows are inert; new test events alone are eligible for dispatch.
- New uploads use farm-operations-staging only. Downsample within 1920×1080 at JPEG quality 0.8 and show progress. Measure compression and network separately; <500ms is a target, never an assumed guarantee.

## Email trap and authorization
Rewrite all top-level and nested recipient/to/cc/bcc destinations to Dylan or empty non-To headers in SQL before INSERT/UPDATE, in the server command and immediately before sending. The test worker accepts only authenticated signed events and uses a separate secret and idempotency ledger. Do not replay copied production outbox rows or send an email to prove a no-send authorization check.

## Reviewed production promotion
1. Freeze the tested commit and retain exact source/schema and acceptance receipts. Verify all runtime URLs, namespace mappings, cache ownership, grants and sender recipients.
2. Review the desired production behavior separately; require Dylan's named approval of the exact production patch. No test credential, copied data, test ID, T manifest or test-only recipient rule is promoted.
3. Adapt only the reviewed code/schema differences to canonical production functions, preserving identities, RLS, LKG reads and source-specific worker contracts. Run focused required checks and a rollback proof in the sandbox.
4. On explicit release authorization, apply validated additive SQL and Edge code first, any reviewed Apps Script patch second, and frontend last. Verify exact receipts; stop on a mismatch.
5. Retain the test app independently; record measured results and forward-only recovery instructions.

## Acceptance evidence
Prove production root files unchanged, 29 unique populated test skills, private grants, isolated RPC dependencies and zero outbound production URLs. Validate current operational row counts, 80 pullers, 41 units, SQL triggers, role denials, replay safety and concurrent capacity/split behavior. A visible page or HTTP 200 alone does not prove workflow completion.

## Cross-layer blast radius
Changes are confined to test frontend modules, test-only Edge/server commands, public.test_* RPCs/tables and test_* private schemas. The isolated Apps Script sender delivers only signed new test events to Dylan. Production Code.gs, SQL/RPCs, app-api, runtime and delivery workers are read-only donors and remain unchanged. Shared test Back/navigation and server authorization stay canonical.

## Forbidden Anti-Patterns (Never Repeat)
- Never omit identity-column ownership or defaults when cloning tables; a successful COPY does not prove subsequent authenticated inserts work.
- Never leave copied revision registry keys pointing at donor relation names. Rebind physical keys and reverse them at the logical API boundary.
- Never publish a nested HTML entry point without the same fetch, storage, auth, worker and Realtime isolation as the main test shell.
- Never treat a client-only guard, a renamed table, a copied trigger, or an HTTP success as proof of isolation or a committed operation.
- Never promote test code/data, execute copied production jobs, reuse live secrets or broaden production grants automatically.
- Append a behavior-based regression test and the root cause here when fixing this domain; do not weaken prior contracts.

## Promotion boundary
The donor sandbox implementation is the specification. Do not claim the fulfillment schema is deployed to production; adapt it only under a named release.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Promotion specification; production deployment requires a reviewed patch. Build and validate only the AgData Test PWA, isolated schema, storage, sender and reviewed promotion.

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
Read contracts from: test-agdata-sandbox-and-db-clone-architect, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-sandbox-and-db-clone-architect.

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
