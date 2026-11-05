---
name: agdata-db-yale-clone-isolation-and-rls-auditor
description: "Audit clone isolation, signed outbox workers and override authority."
---

# agdata-db-yale-clone-isolation-and-rls-auditor

Audit clone isolation, signed outbox workers and override authority.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Audit clone isolation, signed outbox workers and override authority.

### Exact ownership
- test/database/operations.sql: trap_outbox_email.
- test/tools/clone-database.mjs: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_ph_request_delivery_outbox, test_ph_wingding_units, test_ph_order_pulling_teams
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- copied pending jobs executed = 0; test recipient set = Dylan only.
- Delivery workers retain service-role claim/status access; anonymous GRANT ALL is forbidden because it exposes queued payloads and mutations.
- breakdown overrides require Tanner, Jack, Tyler or Dylan server identity.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-db-yale-clone-isolation-and-rls-auditor, test-agdata-sandbox-and-db-clone-architect, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-db-yale-clone-isolation-and-rls-auditor.

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
