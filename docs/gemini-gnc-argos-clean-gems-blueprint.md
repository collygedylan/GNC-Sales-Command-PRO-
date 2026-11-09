# Gemini, GNC, and Argos Clean Gems Blueprint

## Goal

Maintain exactly ten focused repository-backed skill packages: five AgData,
three GNC nursery-production, and two Argos ERP skills. Repository skills are
the source of truth; creating these packages does not claim that an external
Gemini account was changed.

## Ten-skill catalog

| Domain | Consolidated skill | Repository package | Boundary |
| --- | --- | --- | --- |
| AgData | Core Sync | `.agents/skills/agdata-core-sync/SKILL.md` | identity, LKG/cache, live sync, bounded reads, database hygiene |
| AgData | Canonical Engine | `.agents/skills/agdata-canonical-engine/SKILL.md` | exact-row inventory, evidence, evaluation, completion receipts |
| AgData | Views & Workflows | `.agents/skills/agdata-views-workflows/SKILL.md` | operational view state, queues, reports, drills, command handoff |
| AgData | UI Shell | `.agents/skills/agdata-ui-shell/SKILL.md` | global shell, Table Management, modals, filters, responsive UI |
| AgData | Services & Release | `.agents/skills/agdata-services-release/SKILL.md` | Apps Script, Edge, delivery, Watchdog, migrations, CI, publication |
| GNC | Production Schedule Pipeline | `.agents/skills/gnc-production-schedule-pipeline/SKILL.md` | source headers, cutoffs, future inventory, demand/capacity reconciliation |
| GNC | Bunch Notes & Hydro Engine | `.agents/skills/gnc-bunch-notes-and-hydro-engine/SKILL.md` | thirteen-rule issues, cross-sheet identity, hydro/bed capacity, approval |
| GNC | Nursery Stage Operations | `.agents/skills/gnc-nursery-stage-operations/SKILL.md` | sticking, cuttings, planting, can filling, shift/haul, SY movement |
| Argos | ERP Operations & Orders | `.agents/skills/argos-erp-operations-and-orders/SKILL.md` | exact-row ERP commands, Reclass, order transitions, durable receipts |
| Argos | ERP Finance & Mobile UI | `.agents/skills/argos-erp-finance-and-mobile-ui/SKILL.md` | typed finance read models and responsive presentation |

## GNC 20-to-3 consolidation

| Consolidated skill | Existing source skills |
| --- | --- |
| `gnc-production-schedule-pipeline` | `gnc-2027-production-optimizer`; `gnc-prod-schedule-demand-cutoff-analyst`; `gnc-sheet-header-architect`; `gnc-future-inventory-reconciler`; `nursery-production-reconciler` |
| `gnc-bunch-notes-and-hydro-engine` | `gnc-president-master-orchestrator`; `gnc-cross-sheet-bunch-notes-linker`; `gnc-consolidation-agent`; `gnc-bed-and-hydro-supervisor`; `gnc-bunch-notes-and-schedule-ingest`; `gnc-bunch-notes-rule-and-issue-auditor`; `gnc-bunch-notes-multi-hop-sequencer`; `gnc-bunch-notes-crew-and-ribbon-dispatcher` |
| `gnc-nursery-stage-operations` | `gnc-sticking-agent`; `gnc-cuttings-agent`; `gnc-planting-agent`; `gnc-can-filling-agent`; `gnc-shift-haul-and-schedule-navigator`; `gnc-f1-sy27-movement-manager`; `gnc-planting-location-fallback-shield` |

All 20 source skills occur once. They remain protected operational references;
this consolidation does not delete or rename `.codex/skills`.

## Argos ownership boundary

The two Argos packages consolidate repository behavior, not external systems.
Operations & Orders coordinates the existing Argos-named Reclass/order adapters
with AgData's canonical engine and service owners. Finance & Mobile UI may use
only registered typed read contracts and never authorizes an operational or
financial mutation from client presentation. Any future dedicated Argos source
directory must add its own `AGENTS.md` route before code is placed there.

## Validation and external synchronization

1. Validate all ten `SKILL.md` files and their `agents/openai.yaml` metadata.
2. Confirm the AgData 21-to-5 map in `docs/gemini-clean-gems-blueprint.md` and
   the GNC 20-to-3 map above contain unique inputs.
3. Exercise one in-scope and one out-of-scope routing prompt for each package;
   ownership delegation must remain explicit.
4. Run the repository modular-skill, architecture, and tooling checks.
5. If an authorized external Gemini management transport is available, sync by
   exact package name and record its IDs/receipts. Without that transport,
   report repository readiness honestly; do not claim external creation.

Release publication still follows `agdata-services-release`: fresh Watchdog
state, focused checks, full requested suites, measured fast lock, ordinary
hooks, and one atomic live-root `main` plus `gh-pages` publication.
