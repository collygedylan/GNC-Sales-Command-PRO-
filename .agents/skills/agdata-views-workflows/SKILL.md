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

- Keep the reserved N/A Request pair selectable before the directory arrives.
  Bind its real selected-rep ID before submission. Preserve full, clickable
  canonical photo URLs in Bloom shares.

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

- Validate a final Suspend pull receipt before publishing it to Queue and Docks. Use the server-confirmed order group to clear candidates and refresh both badges. An unrelated order that shares dock, drop, and item must stay visible (Invariant 650).

- Suspend evaluator scope, filters and badges resolve the exact Assigned Items itemcode, including a trailing-dot alias. Never substitute a raw ERP route or a different container's owner for a missing or cleared assignment (Invariant 593).

- Do not remove a mounted report selector or filter workflow while leaving only
  source-string checks that make the missing interaction appear covered.
- Do not restore legacy report chrome that competes with universal Back or the
  canonical current report/drill owner.
- Do not pass browser-only Reclass explanation metadata into the strict core
  move-command normalizer; validate it at the service boundary, preserve it in
  transport, and keep unknown command fields rejected before dispatch
  (Invariant 555).
- Do not rerun retained-DOM audits after a fresh bounded page already generated
  its current card tones; audit only a retained page publication so mobile
  completion frames stay inside the warm-render contract (Invariant 558).
- Do not grow Suspend page staging and publication inside the legacy runtime;
  keep that lifecycle in `suspend-tag-page.js` and leave the runtime adapter
  below 60 physical lines (Invariant 560).
- Do not reference extracted classic-script owners as undeclared lexical names;
  cross the ordered-script seam through `globalThis` and verify the generated
  owner remains callable before the runtime delegates to it (Invariant 561).

The complete workflow ownership map is in
docs/gemini-clean-gems-blueprint.md.

- Never apply a Suspend decision to a sibling order that shares a Dock or Drop. Keep the original canceled order visible and omit canceled candidate rows. Invariant 594.
- False Block keeps verified item metrics and zero physical location totals in the six-tile layout. Invariant 595.
- Keep header exports bound to the active account and filtered results. Preserve the selected season when switching AV View modes. Invariants 596 and 597.
- Keep Request autosave in the pending lifecycle. The completed history trigger stamps any provisional snapshot Complete, which can lock a still-pending Request. Only the canonical completion command may create its completed history and delivery receipt. Invariant 611.
- Keep retired Crop Roll out of the Menu, Inventory hub, Manager tables, Inventory Office, and Item Detail. Reject stale routes before hydration and restore an older Office selection to Move Up. Live sync must never subscribe to or fetch Crop Roll sources. Retain the stored records for historical access. Invariant 612.
- Never let an eager-only scan drop pending card photos when it reaches the frame budget. Resume connected work in bounded batches, and keep unrelated view renders from taking over the pending AV hydration timer. Invariant 615.
- Keep Eval Reports #2 overview totals synchronous on the account's published inventory and rebuild when hydration appends rows. Block and Location buttons share one delegated click path with native keyboard activation and universal Back. Invariant 651.
- Keep the Inventory Project preset single-select. Custom tasks are editable within Custom Multi-Task. Preserve the user's project name and keep the submission footer reachable while the form body scrolls. Invariant 651.
