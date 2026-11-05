---
name: test-agdata-request-lifecycle-and-lock-guard
description: Preserve Que Request pending-only lifecycle, completion archival, draft continuity, and role-correct published evaluation locks.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Request Lifecycle and Lock Guard

Load with `test-agdata-queue-and-reclass-specialist`, `test-agdata-drive-and-av-specialist`, `test-agdata-zero-lockout-guard`, and `test-agdata-app-shell-and-navigation` when Request detail or shared evaluation controls change.

Read [the canonical dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) and preserve `goBackUniversal` ownership across Queue and detail transitions.

## Contracts

- `Que -> REQUEST` contains only active `REQ-%` rows with no completion date and status `Pending`, `Open`, or blank legacy pending status. Completion persists history and removes the active row in the same durable command.
- Regular Request cards never render Suspend approval actions. Request conflict drafts may remain locally recoverable, but no conflict or protected-after-done panel may block `MARK DONE` or replace the displayed row.
- Request detail is directly editable for its authorized workflow. Published Drive Mode, AV, and Sales Office evaluation data is directly editable by Admin users and read-only for non-Admin users, without press-and-hold unlock controls.
- Preserve immediate cached card/detail rendering, same-account SWR, shared Back behavior, and server authorization for every write.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/app-runtime.js`: `renderRequest`, `buildPendingRequestRenderPlan`, `isRequestPendingVisible`, `updateRequestWorkConflictReview`, `isProtectedSectionLocked`, `renderProtectedControls`, `saveData`.
- SQL: `test_ph_requests_pending`, `test_ph_requests_completed_history`, security-invoker `test_ph_active_request`, `test_request_work_command_v1`, and `test_private.persist_completed_request_history_v1`.
- Backend: `request_work`, queue removal, and lifecycle receipt handling in `test/supabase/functions/app-api/index.ts` and `_shared/production-workflow.ts`.

## Cross-Layer Blast Radius

- Request writes flow from `test/assets/app-runtime.js` through `app-api` to `test_request_work_command_v1`; completion history/outbox state must remain atomic while `test/workers/email/Code.gs` only consumes the durable delivery event.

## Focused Verification

```sh
node --test test/tests/request-work-draft.test.mjs test/tests/request-submission-durability.test.mjs test/tests/golden-invariants.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- Suspend detail Mark Done must retain the physical tag and return to its queue only after the full evaluation and photos receive exact-row publication confirmation. Use the same inventory metrics as the card for the match preview and keep drafts available after a failed save.

- v2.3.164, Invariant 458. AV has one Filters disclosure beside Season, a second row for Reset, Export Excel and Kiosk Mode, and a single scrolling chip line. Both open-stock and reserve cards open photos from the 84px thumbnail. Keep completion, Reclass, View Photos and evaluation owner controls off AV cards for every role.

- v2.3.164, Invariant 457. A regular Que Request opens Item Detail directly. Show its whole field grid inline in #ffffff or #ecfdf5, weight 700, on dark emerald. Keep LEFT and RIGHT with their own 84px photo. MARK DONE asks only “Mark <Item> done?”, publishes linked evidence through the authorized save, and advances after an exact completed-history receipt. Preserve unlinked folder completion and separate Suspend and NCR commands.

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never route Suspend Item Detail MARK DONE through physical tag completion. Save exact evidence and retain the active card; only the main card Complete Tag close command removes eligibility. Email review completion retains its tag and evidence, with existing authorization, approval and outbox behavior. Request completion remains unchanged. Invariant 290 covers the detail route.

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.test_user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared test_save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.

- Never merge completed history into the active Request queue, retain a completed row in `test_ph_requests_pending`, render approval decisions on a regular Request, or expose a conflict/protected banner that blocks completion.
- Never use one lock rule across Request and published Drive/AV data; authorization context and Admin bypass must be explicit.
- Never re-read or delete a just-completed Request through `test_ph_active_request`; completion makes that active-only view hide the row, so atomic persistence must retain and mutate the locked `test_ph_requests_pending` row until history and outbox acknowledgment finish.
- Never validate folder-completion delivery from pending rows alone after atomic completion deletes them; both queue reconciliation and worker preparation must derive membership from pending rows plus completed history.
- Never truncate the `Who requested this?` identity list behind a Load More control or include users outside REP/CSR/Admin plus active mapped Sales Reps; normalize role aliases and render human-readable names before selection.
