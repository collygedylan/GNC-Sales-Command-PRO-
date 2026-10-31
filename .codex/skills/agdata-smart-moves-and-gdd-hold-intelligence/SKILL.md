---
name: agdata-smart-moves-and-gdd-hold-intelligence
description: Maintain Smart Sales & Move reason views, symmetric cards and KPI/filter geometry, and Park Hill weather/GDD hold planning.
---

# Smart Moves and GDD hold intelligence

Use [the module dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and symbol index.

## Owned Files, Canonical Functions & SQL Contracts

- Shared model: assets/smart-hold-intelligence.js; runtime: assets/app-runtime.js; layout: assets/app-styles.css. Canonical symbols: renderSmartMovesIntelligence, renderSalesIntelligenceKpi, warmSmartHoldContext, AgDataHoldIntelligence.holdRisk.
- GDD is exactly max(0, (High + Low - 50) / 2), in Fahrenheit for Park Hill, OK. Open-Meteo supplies recent/forecast daily temperatures; localStorage retains the last valid response. Seasonal temperatures and uncalibrated plant-group priors are explicitly estimates. Historical cycles require the same itemcode/locationcode/lotcode and ordered observation dates. Heat never automatically releases a hold or authorizes shearing.
- smart_hold_context is an authenticated, module-authorized optional read of at most 30 itemcodes, 1,500 archived observations and 500 Dock status rows. It adds no startup download and returns a partial marker on read failures. Exact fixture rejects all other keys and mutations.
- SOC and Reserves preserve physical order lines, outstanding quantities, Plan Start dates and Dock trip status. Missing location/lot is labelled unallocated; mismatched known identities are excluded. Undated loads require review.

## Cross-Layer Blast Radius

Runtime and app-api read context only; SQL changes the canonical explicit Itemcode Default Owner precedence and preserves actor authorization, serialized last-write-wins commands and audit receipts. Code.gs, email delivery, five-source RUN SCRIPT, READY/LKG reads and private credential grants retain their contracts.

Use switchView / showOnlyPrimaryView, goBackUniversal / updateGlobalBackButton, viewHistoryStack and shared header/search ownership. Keep same-account loaded data while optional reads refresh; discard responses after an account change.

## Scoped verification

```sh
node --test tests/smart-hold-intelligence.test.mjs tests/assigned-items-filters.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- Never let the shared mobile 44px touch-target rule override the explicitly requested 36px reason tabs and 22px Trace controls; scope compact overrides through the application scroll container and verify the computed mobile cascade.

- v2.3.122: Never render two recommendation cards on one row, resize KPI tiles when traces open, or present an uncalibrated seasonal curve as measured history. Invariants 258–262 and Permanent Locks 9–10 retain these behaviors.
