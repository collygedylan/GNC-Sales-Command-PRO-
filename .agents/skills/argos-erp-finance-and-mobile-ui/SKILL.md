---
name: argos-erp-finance-and-mobile-ui
description: Maintain source-backed Argos ERP finance read models and responsive mobile presentation. Use for Argos totals, reports, filters, and device UI; do not own inventory mutations, order transitions, or release transport.
---

# Argos ERP Finance and Mobile UI

Own Argos finance/report projections and their responsive presentation only
when an explicit repository contract exists. Inspect the registered schema,
query, and caller before adding a field; do not invent finance semantics from
an ERP label or UI mock.

## Finance and presentation contracts

- Totals, balances, credits, and order summaries remain source-backed with
  explicit currency, sign, date, account, and revision semantics.
- Keep read models separate from commands. A client calculation or rendered
  badge cannot authorize or acknowledge a financial mutation.
- Mobile tables/cards preserve complete filters, exact order/customer identity,
  readable totals, keyboard/touch access, and one owned scroll container.
- Late reads are account/revision fenced and cannot erase a draft, replace a
  newer report, or navigate the user.
- Use existing dark-emerald shell tokens and universal Back/navigation owners;
  do not create an Argos-only theme or global event delegate.

## Boundaries and verification

Operational inventory, Reclass, transfer, and order-state commands belong to
`argos-erp-operations-and-orders`. Canonical data and release transports remain
with the corresponding AgData skills. Test currency/date boundaries, negative
and zero values, account isolation, late-read rejection, filter parity, mobile
overflow, and keyboard/touch activation. If no typed repository contract
exists, stop and add a reviewed schema/query contract before UI behavior.

The exact consolidation map is in
`docs/gemini-gnc-argos-clean-gems-blueprint.md`.
