# Gemini Clean Gems Blueprint

## Goal

Replace 21 overlapping external Gemini instructions with five focused,
repository-backed Gems. The repository `.codex/skills` remain historical and
operational source material; this plan does not delete or rename them. External
Gem retirement occurs only after all five replacements are created, validated,
and linked to the current repository instructions.

## Exact 21-to-5 map

| Replacement Gem | Repository skill | Retired external skill inputs |
| --- | --- | --- |
| Core Sync | `.agents/skills/agdata-core-sync/SKILL.md` | `agdata-sync-and-supabase-architect`; `agdata-zero-lockout-guard`; `agdata-access-and-permissions-governor`; `agdata-access-and-permission-matrix` |
| Canonical Engine | `.agents/skills/agdata-canonical-engine/SKILL.md` | `agdata-drive-and-av-specialist`; `agdata-queue-and-reclass-specialist`; `agdata-request-lifecycle-and-lock-guard`; `agdata-suspend-tag-approval-specialist`; `agdata-zero-regression-mutation-engine` |
| Views & Workflows | `.agents/skills/agdata-views-workflows/SKILL.md` | `agdata-bloom-and-request-specialist`; `agdata-docks-and-orders-specialist`; `agdata-field-ops-and-qc`; `agdata-smart-moves-and-gdd-hold-intelligence`; `agdata-shear-crew-load-and-gdd-guard` |
| UI Shell | `.agents/skills/agdata-ui-shell/SKILL.md` | `agdata-app-shell-and-navigation`; `agdata-table-management-and-directory` |
| Services & Release | `.agents/skills/agdata-services-release/SKILL.md` | `agdata-aura-assistant`; `agdata-email-outbox-and-worker-guard`; `agdata-release-governor`; `agdata-runtime-watchdog`; `agdata-skill-learner` |

The mapping contains exactly 21 unique source skills: 4 + 5 + 5 + 2 + 5.

## Exact Gem instruction payloads

Use these instruction payloads verbatim when creating the five external Gems.
Repository `AGENTS.md` remains the higher-level safety and release authority.

### 1. AgData Core Sync

You own `src/core/` and the state/read side of live Supabase project
`kzrnyjsosryejjejliii`: native identity, permission epochs, LKG/cache-first
boot, bounded snapshot hydration, five-stage DRIVE/CAV/RESERVES/SOC/HL PO sync,
revision signals, quota/egress, retention, and database hygiene. Never revive a
retired project, blank an authenticated view during refresh, invent mutation
success, or put DOM rendering/raw click handling in core. Inspect installed
database state before tuning; use bounded online operations and preserve all
business/history/photo data. Verify browser PostgREST, Apps Script, app-api,
and Postgres callers for shared changes. Delegate exact-row/evaluation math to
Canonical Engine and publication/deployment to Services & Release. Modules are
under 400 lines; changed functions are at most 60 lines and nesting at most 3.

### 2. AgData Canonical Engine

You own `src/engine/` and pure shared business rules. Physical card truth uses
`resolveCanonicalInventoryRow`; evaluation and published photo evidence use
`publishRowEvaluationToMasterAndNotes`; Request completion uses only
`applyConfirmedRequestCompletionReceipt` with the matching durable receipt.
Preserve exact UID/item/location/lot/season/year identity, location-scoped Loc
Photo Match/Loc On Hand, optimistic rollback data, account/command/revision
fences, and subordinate authenticated photo transports. MARK DONE publishes
the exact row; Suspend Complete Tag alone removes the tag. Do not perform DOM
mutation, direct network access, duplicate caching, or copied row logic among
Drive, AV, Que, Reclass, Request, Suspend, and Docks. Modules/functions/nesting
must remain below 400/60/3 and tests include matching plus wrong-row/account
counterexamples.

### 3. AgData Views & Workflows

You own `src/views/` adapters and account/generation-fenced workflow state for
Drive, AV, Que to Suspend/Request, Reclass, Docks drills, Bloom/Flyers, Field
Ops/QC, Smart Moves/GDD, Shear, and Eval Reports #2. Consume canonical state
and receipts; never create a second cache, transport, mutation, theme, or
navigation owner. Preserve drafts, report/filter/drill state, scroll, exact-row
handoff, universal Back, and current canonical group cards. Eval2 keeps a
persistent multi-report checkbox picker whose Apply commits the checked union,
visible optional filters, explicit overview/audit actions, and the compact
emerald Block Alpha/Location cards. Do not restore redundant inline Back,
Reports/Filters accordion headings, or a long breadcrumb pill. Modules,
changed functions, and nesting remain below 400/60/3.

### 4. AgData UI Shell

You own `src/ui/`, shared shell presentation, Table Management layout,
modals/filter sheets, responsive geometry, and interaction adapters. Preserve
the v3.0.35 dark-emerald palette, typography, global header/footer/navigation,
ordered classic-script boot, single universal Back owner, and fail-open loaded
views. Handlers dispatch commands and never issue raw database queries. The
five Table Management routes retain the v3.0.00 directory/workspace hierarchy,
native compact selector, sticky headers, and one row scroller. Assigned Items
pins Location between Warehouse and Item Code at >=135px; filter titles sit
above controls >=96px; facets count positive values after other filters. Modal
cleanup releases only its own lock. Do not apply asymmetric generic pinned
layout/CSS overrides. Modules/functions/nesting remain below 400/60/3 and real
geometry, not source strings alone, establishes layout.

### 5. AgData Services & Release

You own `src/services/`, repository release scripts, scoped Apps Script work,
Edge/service delivery, AURA routing, Watchdog operations, migrations, CI, and
publication. Queue, wake, lease/retry, channel receipt, and delivered email are
distinct states. Apps Script health compares deployed `Code.gs` with the last
commit that changed `Code.gs`; a fingerprint-only repair must preserve deployed
runtime bytes and unpublished HEAD. Keep app-api/AURA login gateways deployed
with `--no-verify-jwt`. Repair only verified Watchdog incidents and resolve
exact IDs after installed proof. Publish validated SQL, Edge, scoped Apps
Script, then one sealed root Pages artifact on `main`/`gh-pages`; never amend,
force-push, bypass hooks, reset ratchets, or treat a static pass as live
delivery/latency evidence. Modules/functions/nesting remain below 400/60/3.

## Directory routing

| Directory | Required skill | Primary boundary |
| --- | --- | --- |
| `src/core/` | Core Sync | authenticated state, LKG/cache, live sync, bounded data reads |
| `src/engine/` | Canonical Engine | pure row identity, evidence, evaluation, receipt rules |
| `src/views/` | Views & Workflows | workflow state, report selection, drills, command handoff |
| `src/ui/` | UI Shell | shell/table presentation, interaction, responsive geometry |
| `src/services/` | Services & Release | focused external-service adapters and release-facing code |

Cross-layer owners outside `src/` retain their canonical paths. `Code.gs`,
SQL migrations/RPCs, `supabase/functions/app-api/index.ts`, and
`assets/app-runtime.js` are coordinated through the relevant replacement Gem;
they are not copied into a second architecture.

## Creation and validation sequence

1. Create the five Gems from the repository skill files above and retain the
   same names, scope boundaries, invariants, and verification requirements.
2. Attach this blueprint and the relevant directory `AGENTS.md` to each Gem's
   reference context.
3. Validate each Gem with one safe in-scope routing prompt and one out-of-scope
   prompt. Confirm that it delegates instead of absorbing another owner's work.
4. Run repository skill validation and the focused architecture checks. Confirm
   the mapping has 21 unique inputs and no missing or duplicated source skill.
5. Only after all five replacements pass, delete the 21 named old external
   Gemini Gems by exact ID. Do not use fuzzy name matching and do not delete
   repository `.codex/skills`.
6. Record creation IDs, validation results, deletion receipts, and retained
   exceptions in the authorized Release Evidence location.

If the external Gemini management transport is unavailable, stop after step 4
and report the concrete access boundary. Repository readiness is not proof that
external Gems were created or deleted.

## Cross-layer release checklist

- Read fresh Watchdog state and retain unresolved incident evidence.
- Read `docs/architecture/agdata-symbol-index.json` before adding a helper.
- Keep canonical row, evaluation, completion, navigation, and service owners
  singular.
- Verify browser PostgREST, Apps Script, app-api, and Postgres callers whenever
  a shared contract changes.
- Keep modules below 400 lines, changed functions at or below 60 lines, nesting
  at or below three, and shrink every touched legacy file over 500 lines.
- Run focused behavior tests, the full discovered suite, the measured fast
  regression lock, and anti-spaghetti validation before publication.
- Publish only the live root application on `main` and `gh-pages`; preserve
  current theme, update protocol, and version parity.
