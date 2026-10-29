---
name: agdata-request-lifecycle-and-lock-guard
description: Preserve Que Request pending-only lifecycle, completion archival, draft continuity, and role-correct published evaluation locks.
---

# Request Lifecycle and Lock Guard

Load with `agdata-queue-and-reclass-specialist`, `agdata-drive-and-av-specialist`, `agdata-zero-lockout-guard`, and `agdata-app-shell-and-navigation` when Request detail or shared evaluation controls change.

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and preserve `goBackUniversal` ownership across Queue and detail transitions.

## Contracts

- `Que -> REQUEST` contains only active `REQ-%` rows with no completion date and status `Pending`, `Open`, or blank legacy pending status. Completion persists history and removes the active row in the same durable command.
- Regular Request cards never render Suspend approval actions. Request conflict drafts may remain locally recoverable, but no conflict or protected-after-done panel may block `MARK DONE` or replace the displayed row.
- Request detail is directly editable for its authorized workflow. Published Drive Mode, AV, and Sales Office evaluation data is directly editable by Admin users and read-only for non-Admin users, without press-and-hold unlock controls.
- Preserve immediate cached card/detail rendering, same-account SWR, shared Back behavior, and server authorization for every write.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `renderRequest`, `buildPendingRequestRenderPlan`, `isRequestPendingVisible`, `updateRequestWorkConflictReview`, `isProtectedSectionLocked`, `renderProtectedControls`, `saveData`.
- SQL: `ph_requests_pending`, `ph_requests_completed_history`, security-invoker `ph_active_request`, `request_work_command_v1`, and `private.persist_completed_request_history_v1`.
- Backend: `request_work`, queue removal, and lifecycle receipt handling in `supabase/functions/app-api/index.ts` and `_shared/production-workflow.ts`.

## Cross-Layer Blast Radius

- Request writes flow from `assets/app-runtime.js` through `app-api` to `request_work_command_v1`; completion history/outbox state must remain atomic while `Code.gs` only consumes the durable delivery event.

## Focused Verification

```sh
node --test tests/request-work-draft.test.mjs tests/request-submission-durability.test.mjs tests/golden-invariants.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- Never merge completed history into the active Request queue, retain a completed row in `ph_requests_pending`, render approval decisions on a regular Request, or expose a conflict/protected banner that blocks completion.
- Never use one lock rule across Request and published Drive/AV data; authorization context and Admin bypass must be explicit.
- Never re-read or delete a just-completed Request through `ph_active_request`; completion makes that active-only view hide the row, so atomic persistence must retain and mutate the locked `ph_requests_pending` row until history and outbox acknowledgment finish.
- Never validate folder-completion delivery from pending rows alone after atomic completion deletes them; both queue reconciliation and worker preparation must derive membership from pending rows plus completed history.
- Never truncate the `Who requested this?` identity list behind a Load More control or include users outside REP/CSR/Admin plus active mapped Sales Reps; normalize role aliases and render human-readable names before selection.
