---
name: agdata-views-workflows
description: Maintain AgData operational workflows, report drills, queues, and view state in src/views. Use for Drive, AV, Que, Request, Reclass, Docks, Bloom, Field Ops, Smart Moves/GDD, Shear, or Eval Reports; do not take over canonical data or global shell ownership.
---

# AgData Views Workflows

Own src/views adapters and workflow state. Consume canonical engine outputs and
service receipts; never create another mutation or cache owner.

## Workflow scope

- Drive Mode and AV drills; Que to Suspend/Request; Reclass; Docks and
  three-level order drills.
- Bloom/Flyer actions, Field Ops/QC, Smart Moves/GDD, Shear Guard, and
  assignment-aware workflow state.
- Eval Reports #2 report selection, Block Alpha to Location to item drills,
  last-good paged data, and exact row handoff to Detail/Reclass.

## Required behavior

- Keep view state account-scoped and generation-fenced. Late reads cannot
  navigate, replace drafts, or erase a newer same-account snapshot.
- Route navigation through the shared shell. Preserve universal Back, current
  report/drill state, scroll, filters, and modal priority.
- UI handlers dispatch commands. They do not issue raw database queries.
- Table/report presentation consumes current dark-emerald tokens without
  defining a second theme.
- Restored v3.0.00 workflows may recover structure and controls, but must keep
  current canonical row, receipt, authorization, and global-shell owners.

## Engineering limits

Keep modules below 400 lines, functions at or below 60 lines, and control
nesting at or below three. A changed legacy file over 500 lines must shrink as
its workflow slice moves here.

## Verification

Select focused tests for eval-reports-engine, inventory drill navigation,
manager table workspace, Bloom/Request, Docks, Field Ops, Smart Moves, or
Shear. Tests must exercise state transitions and exact identities, not only
static wording.

## Forbidden Anti-Patterns (Never Repeat)

- Do not remove a mounted report selector or filter workflow while leaving only
  source-string checks that make the missing interaction appear covered.
- Do not restore legacy report chrome that competes with universal Back or the
  canonical current report/drill owner.

The complete workflow ownership map is in
docs/gemini-clean-gems-blueprint.md.
