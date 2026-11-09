---
name: argos-erp-operations-and-orders
description: Maintain Argos ERP inventory operations, orders, Reclass moves, and exact-row receipts. Use for Argos transaction lifecycles and order state; do not use for finance presentation or generic AgData hydration.
---

# Argos ERP Operations and Orders

Own Argos-named operational commands while preserving the repository's AgData
canonical row and service boundaries. Existing Reclass surfaces remain adapters
over the canonical engine; this skill does not create a competing inventory
truth owner.

## Operational contracts

- Resolve the exact physical source row before Reclass, transfer, hold, or
  priority work. Ambiguity requires explicit selection.
- Preserve source and destination quantities, season/year/lot identity,
  explanation requirements, account scope, command UUID, idempotent replay,
  rollback data, and the exact returned-row receipt.
- Order state transitions follow their durable server receipt. A queued,
  timed-out, or stale read is not completion.
- Publish returned rows coherently before rebuilding shared indexes; never
  apply sibling rows independently or derive On Hand from order quantity.
- Existing owners include the Argos transaction adapters in
  `assets/app-runtime.js`, `services/reclassMove.ts`, `services/reclassMoves.ts`,
  `services/reclassReceipt.ts`, app-api, and the production-workflow RPC layer.

## Boundaries and verification

Delegate canonical row/evidence rules to `agdata-canonical-engine`, external
transport/release work to `agdata-services-release`, and financial/mobile
presentation to `argos-erp-finance-and-mobile-ui`. Test matching and wrong-row
receipts, stale revisions, replay, rollback, split balance, and cross-year lot
selection. Never infer unregistered Argos schemas from a display label.

The exact consolidation map is in
`docs/gemini-gnc-argos-clean-gems-blueprint.md`.
