---
name: test-agdata-shear-crew-load-and-gdd-guard
description: Maintain exact-location Shear List and Smart Moves outbound-load conflict warnings and reviewed crew confirmation.
---

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
