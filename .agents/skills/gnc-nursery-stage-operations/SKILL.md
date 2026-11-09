---
name: gnc-nursery-stage-operations
description: Plan and verify GNC sticking, cuttings, planting, can filling, shifts, hauling, and sale-year movement. Use for execution-stage quantities and dependencies; do not own schedule normalization or Bunch Note approval.
---

# GNC Nursery Stage Operations

Own approved nursery-stage execution after demand and Bunch Note decisions are
published. Retain cultivar, item, container/tray, source lot, destination,
sale year, season, and planned-date identity across every handoff.

## Stage contracts

- Sticking and cuttings use approved propagation quantities; unknown yield or
  availability stays unresolved.
- Planting quantity cannot exceed net bed capacity after reservations, and the
  exact source lot follows the movement.
- Can filling uses container-specific demand and approved schedules; never
  invent crew capacity.
- Shift and haul dependencies preserve source-before-destination order,
  required crew work, and tape/ribbon instructions.
- F1 and SY27 movement keeps season and sale year distinct. Reserved planting
  locations use the reviewed fallback shield rather than an arbitrary bed.

## Boundaries

Consume approved demand from `gnc-production-schedule-pipeline` and approved
issues from `gnc-bunch-notes-and-hydro-engine`. Publish explicit stage state
and receipts; do not rewrite demand, approve a Bunch Note, or treat a proposed
move as completed work.

## Verification

Test each stage with exact identities, insufficient capacity/yield, reserved
bed conflicts, cross-year movement, dependency ordering, and receipt-gated
completion. Include a safe stage plan and a rejected ambiguous-source case.

The exact consolidation map is in
`docs/gemini-gnc-argos-clean-gems-blueprint.md`.
