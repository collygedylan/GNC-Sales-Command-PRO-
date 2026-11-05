---
name: agdata-db-mit-plpgsql-rpc-and-trigger-engineer
description: "Maintain atomic splitting, threshold triggers and quality constraints."
---

# agdata-db-mit-plpgsql-rpc-and-trigger-engineer

Maintain atomic splitting, threshold triggers and quality constraints.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Maintain atomic splitting, threshold triggers and quality constraints.

### Exact ownership
- test/database/operations.sql: test_fn_can_team_pull_tag.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_ph_soc_master, test_ph_dock_drop_status, test_ph_order_pulling_teams
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- sum(split quantities) = parent quantity; stock balance ≥ 0; inspection threshold ≥10%; palletization ≥95%.
- ESP ≥ SP ≥ BLANK; assigned team capacity is 500–700; exact Dock/Drop updates are one transaction.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-db-mit-plpgsql-rpc-and-trigger-engineer, test-agdata-six-stage-dock-pipeline-orchestrator, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-db-mit-plpgsql-rpc-and-trigger-engineer.

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
