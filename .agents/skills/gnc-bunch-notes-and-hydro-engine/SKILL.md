---
name: gnc-bunch-notes-and-hydro-engine
description: Audit and approve GNC Bunch Notes using exact inventory, water, house, bed, crew, tape, and dependency evidence. Use for thirteen-rule issue generation and approval; do not use for raw schedule ingestion or stage execution alone.
---

# GNC Bunch Notes and Hydro Engine

Own the thirteen-rule Bunch Note issue and approval workflow. Preserve the
existing `BUNCH_NOTES_SIMULATOR -> Issues -> Drive Mode Card -> Approve &
Create New Bunch Note` route and its authenticated durable receipt.

## Canonical decisions

- Link every note to exact live item, location, lot, season, sale year, and
  historical schedule identity before evaluating it.
- Audit all six issue categories and every applicable rule. Missing evidence
  remains an issue; it is never converted into an invented recommendation.
- Whole-group consolidation requires a proven destination, compatible water
  rating, house/bed capacity, and preserved reservations.
- Preserve source-before-destination dependencies, priority threads, crew
  assignments, tape/ribbon instructions, and historical shorthand.
- President approval is authoritative only through the matching authenticated
  receipt. Optimistic UI state rolls back on rejection or identity drift.

## Boundaries

Consume normalized schedules from `gnc-production-schedule-pipeline`. Hand
approved operational work to `gnc-nursery-stage-operations`. Do not create a
second inventory resolver, approval owner, navigation path, or client-only
receipt. Keep exact row identity and known/unknown values distinct.

## Verification

Cover all thirteen rules, the six issue categories, exact cross-sheet links,
capacity/water incompatibility, reserved beds, multi-hop ordering, crew/tape
output, and matching versus foreign approval receipts.

The exact consolidation map is in
`docs/gemini-gnc-argos-clean-gems-blueprint.md`.
