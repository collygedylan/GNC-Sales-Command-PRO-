---
name: gnc-production-schedule-pipeline
description: Reconcile GNC production schedules, demand cutoffs, source headers, future inventory, and approved capacity plans. Use for schedule ingestion or multi-year production reconciliation; do not use for Bunch Note approval or individual nursery-stage execution.
---

# GNC Production Schedule Pipeline

Own the source-to-plan pipeline that converts approved schedules and known
inventory into reviewable nursery demand. Read repository `AGENTS.md`, the
current workbook/schema contracts, and the exact stage skill named by the
caller before changing calculations.

## Canonical decisions

- Map source headers once to canonical fields. Duplicate or unknown columns
  are explicit errors; they never silently overwrite a known value.
- Demand cutoffs use explicit schedule dates and sale years. Missing or stale
  dates become review issues instead of guessed demand.
- Future inventory equals known opening stock plus approved arrivals minus
  committed allocations. Unknown arrivals remain unknown.
- 2027 and later production quantities reconcile to documented schedules,
  exact item/season/lot identity, and plantable capacity before approval.
- Reconciliation records source differences and the matching approval receipt;
  it does not rewrite upstream workbooks merely to make totals agree.

## Boundaries

Keep schedule parsing, normalized demand, capacity comparison, and publication
receipts separate. Delegate Bunch Note issue/approval logic to
`gnc-bunch-notes-and-hydro-engine` and stage-specific sticking, cuttings,
planting, can filling, shifts, and hauling to `gnc-nursery-stage-operations`.
Never infer supply, labor, yield, dates, or beds from a blank source.

## Verification

Exercise header aliases, duplicate/unknown headers, cutoff boundaries,
item/season/lot identity, unknown arrivals, capacity shortfalls, and matching
approval receipts. Include a safe reconciled case and a rejected stale or
ambiguous schedule.

The exact consolidation map is in
`docs/gemini-gnc-argos-clean-gems-blueprint.md`.
