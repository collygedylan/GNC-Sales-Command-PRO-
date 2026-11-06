---
name: test-agdata-shear-crew-load-and-gdd-guard
description: Maintain exact-location Shear List and Smart Moves outbound-load conflict warnings and reviewed crew confirmation.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Shear crew load and GDD guard

Use [the module dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) and symbol index.

## Owned Files, Canonical Functions & SQL Contracts

- Shared model: test/assets/smart-hold-intelligence.js; runtime: test/assets/app-runtime.js; layout: test/assets/app-styles.css. Canonical symbols: getSmartShearGuard, renderSmartShearGuard, confirmSmartShearLoadGuard, submitShearList, completeShearLocationInquiry.
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

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never derive hold reasons from notes/specs or invented categories/plant-group thresholds, truncate historical learning to the latest 1,500 rows, or assume missing recovery history is safe. Use every canonical historical holdstopreason (imported holdreason) and report_date per itemcode, actual daily highs/lows, and the shared history model. Preserve exact location/lot outbound load matching; unknown recovery requires review. Invariants 288–289 protect these boundaries.
- Never recalculate demand aliases inside the inventory sort comparator or forecast hidden groups; compute each row demand once per render and calculate recovery only for visible cards.
- Never let an unrelated background customer-mapping or revision error replace an already loaded Shear List with a setup gate; retain the same-account rows, inquiries, and Drive Mode tab.
- Never calculate recovery or scan historical/alternate inventory for an exact row with no matching outbound load; prune it before forecasting so the full inventory cannot stall the Shear tab.

- v2.3.122: Never treat a sibling lot as an exact load commitment, drop undated commitments, equate an optional context failure with safe-to-shear, or bypass the existing authorized shear mutation. Invariants 258–262 and Permanent Locks 9–10 retain these behaviors.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain exact-location Shear List and Smart Moves outbound-load conflict warnings and reviewed crew confirmation.

### Exact ownership
- test/assets/app-runtime.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- test/assets/smart-hold-intelligence.js: dailyGdd, holdRisk, shearGuard, buildLoadIndex.
- test/assets/smart-hold-runtime-functions.js: getSmartShearGuard, renderSmartShearGuard, confirmSmartShearLoadGuard.
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
Read contracts from: agdata-shear-crew-load-and-gdd-guard, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-shear-crew-load-and-gdd-guard.

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
