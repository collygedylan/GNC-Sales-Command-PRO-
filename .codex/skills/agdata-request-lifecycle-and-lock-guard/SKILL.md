---
name: agdata-request-lifecycle-and-lock-guard
description: Preserve Que Request pending-only lifecycle, completion archival, draft continuity, and role-correct published evaluation locks.
---

## Rule 0 - Autonomous Watchdog self-healing (standing user authorization, v3.0.10)

On EVERY future prompt, even when the user does not mention Watchdog, read `.gnc-local/latest-state.md` first and query `public.app_runtime_watchdog_events WHERE status = 'open'`. The user has given standing authorization to investigate and automatically fix genuine code/RPC anomalies reported by those incidents, apply the necessary scoped repair through existing authorized release paths, and resolve the verified incident IDs before committing. This supersedes earlier read-only-by-default restrictions on Codex remediation. Keep the browser sensor passive; it does not receive source-write, database-administration or deployment credentials.

Use the installed schema, with the user's requested column labels:

```sql
SELECT id, first_seen_at AS created_at, username, normalized_role AS role,
       view_id AS view_name, sub_module AS scope, event_type AS error_code,
       error_message AS message, owning_skill
FROM public.app_runtime_watchdog_events
WHERE status = 'open'
ORDER BY last_seen_at DESC
LIMIT 25;
SELECT count(*) AS open_watchdog_incidents
FROM public.app_runtime_watchdog_events WHERE status = 'open';
```

Investigate the recorded evidence and owning code/RPC, make the smallest real repair, and run the focused applicable check. Resolve only the exact verified incidents after the repair is installed or after evidence demonstrates the recorded anomaly is already fixed; retain a truthful resolution note and release reference. Never mass-resolve uninvestigated events, suppress telemetry to hide an unfixed failure, or claim WATCHDOG 0 without a fresh zero-count query. If access or a real external dependency prevents repair, retain the incident and report that concrete blocker rather than marking it fixed.

Before every commit, run `node scripts/fast-regression-lock.mjs`; `.git/hooks/pre-commit` must run the same mandatory lock. The target is under two seconds and must be measured, never assumed. Preserve real actor/role/session authorization, exact-row identity, durable receipts, the v3.0.9 recovered photos and publication/protection triggers, and deliberate photo deletion/expiry/depletion. The only mandatory business inputs remain positive Request/Reclass Quantity and non-admin/non-super-admin Reclass Explanation. Use last-write-wins and authenticated canonical PostgREST fallback for stale version/snapshot conflicts; never invent a successful save. Live root PWA only, `.nojekyll` on main and gh-pages, no retired mirror, no slow test suites and no Pages polling.

Cross-layer scope: Codex reads bounded incident metadata, repairs the owning runtime/Edge/SQL contract, verifies the real result, and resolves that incident cohort. Existing app permissions, RLS, private outbox grants, native-session mutation paths, shared navigation and user data remain authoritative.

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


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

## AgData v3.0.8 zero artificial user blocks

This contract supersedes earlier photo, match-stock, optional-field, revision and import-fence prerequisites for MARK DONE, Request and Suspend Tag. The only mandatory user inputs are Quantity > 0 when submitting a Request or Reclass, and Reclass Explanation for non-admin/non-super-admin users. Blank photos, Spec, Caliper, Loc Match %, AV Note, Pick Note and Comments never block MARK DONE on Request, Suspend Tag or Inventory; preserve existing Spec or use N/A.

Never return Photo Required / PHOTO_REQUIRED or turn REQUEST_VERSION_CONFLICT, SUSPEND_TAG_VERSION_CHANGED, SUSPEND_TAG_TOKEN_CONFLICT, Inventory changed while reading, MASTER_SNAPSHOT_NOT_READY or MASTER_IMPORT_FENCE_EXPIRED into user-facing 409/422 action gates. Use last-write-wins for these authorized user actions, with an exact-target authenticated/service PostgREST update/upsert fallback when needed. Keep actor authentication, role/assignment authorization, row identity, real persistence errors and durable completion receipts authoritative; never invent success or grant anonymous operational writes.

collectAllActiveItemDetailPhotos merges active Item Detail photo cards and URL attributes, activeItemDetailPhotos/itemDetailDraft photos, target-row photo aliases, and matching fullInventory/locationSalesNotes evidence, preferring item/location/lot then item/location evidence. Preserve every uploaded photo and its original metadata. Publish the merged array through the canonical persistence owner to ph_master_inventory, ph_location_sales_notes and the corresponding ph_requests_pending/ph_active_suspend row. Request completion retains its history/outbox lifecycle; Suspend MARK DONE keeps the physical tag active until Complete Tag.

Cross-layer blast radius: Item Detail collection and save payloads in app-runtime/row-workflow, authenticated app-api mutation recovery, and canonical SQL evidence/queue commands. Code.gs delivery, account boundaries, existing grants, shared Back/navigation and READY/LKG reads stay intact. Live root PWA only; never restore the retired mirror. That historical surgical release used commit/push --no-verify. From v3.0.10 onward Rule 0 and the mandatory fast-regression-lock pre-commit hook supersede that bypass; keep .nojekyll and no slow suites.

## AgData v3.0.9 database publication and preservation

Request and Suspend evidence publication is enforced by PostgreSQL, not a client-only follow-up. The pending-request publisher and the physical SOC-table publisher behind ph_active_suspend merge photos and evaluation fields into the resolved master inventory row and location notes, publish the master/AV/request dataset revisions, and retain canonical durable receipts. Resolve the master UID or normalized item/location/lot first; an item/location fallback must resolve a real target without inventing a photo association. Calculate photo-match quantity from physical On Hand and preserve original photo dates and URL/name ordering.

The BEFORE-write protection shield preserves existing nonblank evaluation evidence against blank/NULL/empty-array writes. Live photos require age under ten days and positive remaining photo-match quantity. Explicit authorized photo deletion and expiry/depletion use the canonical force_clear_photos path; preservation must never resurrect deleted, expired or depleted photos or reset their age. Keep intentional real zero/depletion semantics distinct from a stale blank request draft.

CREATE REQUEST inserts pending-request and durable outbox data only. Its BEFORE INSERT inheritance copies existing master/location evidence into the new request, but leaves it Pending, uncompleted and without completion attribution. Inherited photos/specs never imply the user completed this newly created request. Creation must never publish blank master/location fields. Request work edits existing requests through the authenticated canonical command, while the database publisher commits evidence with its receipt; Suspend MARK DONE retains the physical tag until Complete Tag.

Cross-layer blast radius: shared client publication/cache reconciliation, app-api existing-request command and internal creation state, database completion/inheritance/protection triggers, and exact recovery from retained dated evidence. Code.gs delivery, native sessions, assignments/roles, receipt verification and shared Back/navigation remain authoritative. Expiration and explicit deletion remain functional; live root PWA only and no retired mirror.

## Forbidden Anti-Patterns (Never Repeat)

- v3.0.10: Never skip the standing Rule 0 incident query on a future prompt, mark an unverified anomaly resolved, claim an unmeasured fast-lock timing, bypass the mandatory commit hook, or weaken the v3.0.9 photo/lifecycle shield while removing artificial input gates.

- v3.0.9: Never let Request creation clear canonical evaluation data, infer completion from inherited evidence, rely on a browser-only publication write, or let blank-preservation revive explicitly deleted/expired/depleted photos. Keep database publication and protection triggers with canonical receipts.

- v3.0.8: Never count only one photo cache when the active Item Detail strip has uploaded photos, require photos or optional evaluation fields to complete, or surface stale version/token/import-fence conflicts as action blockers. Merge active evidence and persist authorized last-write-wins commands with real receipts.

- v3.0.7 / Invariants 524–525: Never freeze Requests at login-time state. Keep canonical pending-table mutation/revision publication and the security-invoker active-view alias; refresh on navigation, foreground, creation/completion and realtime, with a 10-second visible-session fallback. Retain scoped views, last-good rows, drafts and single-flight receipt ownership.
- Cross-layer: request runtime/row-workflow, coordinator and canonical SQL creation/mapping/revision functions; app-api release pin redeployed. Code.gs delivery, Watchdog v3.0.6 and mandatory Reclass Explanation remain intact.

- Suspend detail Mark Done must retain the physical tag and return to its queue only after the full evaluation and photos receive exact-row publication confirmation. Use the same inventory metrics as the card for the match preview and keep drafts available after a failed save.

- v2.3.164, Invariant 458. AV has one Filters disclosure beside Season, a second row for Reset, Export Excel and Kiosk Mode, and a single scrolling chip line. Both open-stock and reserve cards open photos from the 84px thumbnail. Keep completion, Reclass, View Photos and evaluation owner controls off AV cards for every role.

- v2.3.164, Invariant 457. A regular Que Request opens Item Detail directly. Show its whole field grid inline in #ffffff or #ecfdf5, weight 700, on dark emerald. Keep LEFT and RIGHT with their own 84px photo. MARK DONE asks only “Mark <Item> done?”, publishes linked evidence through the authorized save, and advances after an exact completed-history receipt. Preserve unlinked folder completion and separate Suspend and NCR commands.

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never route Suspend Item Detail MARK DONE through physical tag completion. Save exact evidence and retain the active card; only the main card Complete Tag close command removes eligibility. Email review completion retains its tag and evidence, with existing authorization, approval and outbox behavior. Request completion remains unchanged. Invariant 290 covers the detail route.

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.

- Never merge completed history into the active Request queue, retain a completed row in `ph_requests_pending`, render approval decisions on a regular Request, or expose a conflict/protected banner that blocks completion.
- Never use one lock rule across Request and published Drive/AV data; authorization context and Admin bypass must be explicit.
- Never re-read or delete a just-completed Request through `ph_active_request`; completion makes that active-only view hide the row, so atomic persistence must retain and mutate the locked `ph_requests_pending` row until history and outbox acknowledgment finish.
- Never validate folder-completion delivery from pending rows alone after atomic completion deletes them; both queue reconciliation and worker preparation must derive membership from pending rows plus completed history.
- Never truncate the `Who requested this?` identity list behind a Load More control or include users outside REP/CSR/Admin plus active mapped Sales Reps; normalize role aliases and render human-readable names before selection.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Preserve Que Request pending-only lifecycle, completion archival, draft continuity, and role-correct published evaluation locks.

### Exact ownership
- assets/app-runtime.js: renderRequest, buildPendingRequestRenderPlan, updateRequestWorkConflictReview, isProtectedSectionLocked.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: request_work_command_v1.
- Code.gs: module contract.
- supabase/migrations/20261026170000_agdata_v2371_request_suspend_email_and_lock_cleanup.sql: ph_active_request, persist_completed_request_history_v1.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: ph_requests_pending, ph_requests_completed_history, ph_active_request, user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-request-lifecycle-and-lock-guard, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-request-lifecycle-and-lock-guard.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
