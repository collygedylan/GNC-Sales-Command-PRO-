---
name: test-agdata-smart-moves-and-gdd-hold-intelligence
description: Maintain Smart Sales & Move reason views, symmetric cards and KPI/filter geometry, and Park Hill weather/GDD hold planning.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Smart Moves and GDD hold intelligence

Use [the module dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) and symbol index.

## Owned Files, Canonical Functions & SQL Contracts

- `historicalModels` merges complete recorded models with summary/profile thresholds; `fetchSmartHoldContextDirect` is the exact scoped read fallback. `lifecycleFor`, `wholeGroupKey`, `isShiftLot`, `seasonalWorkflow` and `getFilteredSmartMoveKpis` own lifecycle planning, bed identity, shift protection and filtered KPIs. `test/components/bunch-notes/CardBoard.jsx` persists seasonal instructions through existing card saves; FieldCountingView retains the canonical bunch/spread mutation types.

- Shared model: test/assets/smart-hold-intelligence.js; runtime: test/assets/app-runtime.js; layout: test/assets/app-styles.css. Canonical symbols: renderSmartMovesIntelligence, renderSalesIntelligenceKpi, warmSmartHoldContext, AgDataHoldIntelligence.holdRisk.
- GDD is exactly max(0, (High + Low - 50) / 2), in Fahrenheit for Park Hill, OK. Open-Meteo supplies recent/forecast daily temperatures; localStorage retains the last valid response. Seasonal forecast temperatures are explicitly estimates; no plant-group recovery priors or synthetic reasons are permitted. Server models aggregate all itemcode file-date observations by exact recorded reason; raw-row fixtures retain physical identity. Heat never automatically releases a hold or authorizes shearing.
- smart_hold_context is an authenticated, module-authorized optional read of at most 30 itemcodes of complete SQL-aggregated historical models and 500 Dock status rows. It adds no startup download and returns a partial marker on read failures. Exact fixture rejects all other keys and mutations.
- SOC and Reserves preserve physical order lines, outstanding quantities, Plan Start dates and Dock trip status. Missing location/lot is labelled unallocated; mismatched known identities are excluded. Undated loads require review.

## Cross-Layer Blast Radius

Runtime and app-api read context only; SQL changes the canonical explicit Itemcode Default Owner precedence and preserves actor authorization, serialized last-write-wins commands and audit receipts. test/workers/email/Code.gs, email delivery, five-source RUN SCRIPT, READY/LKG reads and private credential grants retain their contracts.

Use switchView / showOnlyPrimaryView, goBackUniversal / updateGlobalBackButton, viewHistoryStack and shared header/search ownership. Keep same-account loaded data while optional reads refresh; discard responses after an account change.

## Scoped verification

```sh
node --test test/tests/smart-hold-intelligence.test.mjs test/tests/assigned-items-filters.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.189: Never recompute recommendations from a filter-mutated global inventory. Apply shared display facets to the existing recommendation cards while keeping canonical models and authorization intact (Invariant 493).
- v2.3.130: Never leave transformed photo URLs in cache keys, poll closed/hidden background UI, persist routine watchdog diagnostics, or emit success Edge logs. Keep signed cloud relays independent of the browser, protect referenced receipts and private grants, and verify empty CLI receipts against installed contracts (Invariants 323–326).

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never derive hold reasons from notes/specs or invented categories/plant-group thresholds, truncate historical learning to the latest 1,500 rows, or assume missing recovery history is safe. Use every canonical historical holdstopreason (imported holdreason) and report_date per itemcode, actual daily highs/lows, and the shared history model. Preserve exact location/lot outbound load matching; unknown recovery requires review. Invariants 288–289 protect these boundaries.
- Never rescan the complete immutable history snapshot or reconstruct a time-zone formatter for every inventory card; index each archive array by exact item/location/lot and reuse the Park Hill formatter.
- Never let the shared mobile 44px touch-target rule override the explicitly requested 36px reason tabs and 22px Trace controls; scope compact overrides through the application scroll container and verify the computed mobile cascade.

- v2.3.122: Never render two recommendation cards on one row, resize KPI tiles when traces open, or present an uncalibrated seasonal curve as measured history. Invariants 258–262 and Permanent Locks 9–10 retain these behaviors.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain Smart Sales & Move reason views, symmetric cards and KPI/filter geometry, and Park Hill weather/GDD hold planning.

### Exact ownership
- test/assets/app-runtime.js: renderSmartMovesIntelligence.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- test/assets/smart-hold-intelligence.js: dailyGdd, holdRisk, shearGuard, buildLoadIndex, historicalModels, wholeGroupKey, isShiftLot, lifecycleFor, seasonalWorkflow.
- test/assets/smart-hold-runtime-functions.js: warmSmartHoldContext, renderSmartHoldMetrics, fetchSmartHoldContextDirect, getFilteredSmartMoveKpis.
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
Read contracts from: agdata-smart-moves-and-gdd-hold-intelligence, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-smart-moves-and-gdd-hold-intelligence.

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
