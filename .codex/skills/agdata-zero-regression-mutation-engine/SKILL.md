---
name: agdata-zero-regression-mutation-engine
description: Preserve the canonical exact-row photo and evaluation mutation engine across operational views.
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


# zero regression mutation engine

Read [the canonical module dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and symbol index before editing.

## Owned Files, Canonical Functions & SQL Contracts

- Runtime: assets/app-runtime.js and declaration-only assets/row-workflow-functions.js; access editor: assets/user-access-control.js. Canonical functions: saveSecureDriveEvidence, applySuspendTagInventoryReceipt, publishFlyerInventoryEvidence.
- Server: supabase/functions/_shared/user-access-matrix.ts, app-api user_access, public.user_access, public.save_user_access_matrix_v23119 and suspend_tag_private.publish_inventory_evidence_v23119. Reuse public.save_drive_evidence_v3; never grant direct evidence-table writes.

## Cross-Layer Blast Radius

Code.gs delivery, private access credentials and outbox contracts stay intact. SQL rechecks the active profile and exact row assignment; app-api verifies native sessions and command identity. Browser matrix data is display state, never mutation authority. Preserve same-account SWR/LKG rows, drafts, and durable Request submission. The new bounded authenticated GET /rest/v1/user_access uses only the sanitized relation and its exact fixture.

Shared switchView, goBackUniversal, updateGlobalBackButton, viewHistoryStack and header/search ownership remain canonical; never recreate global Back/navigation.

## Scoped Node verification

```sh
node --test tests/golden-invariants.test.mjs tests/role-access-parity.test.mjs
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

- v2.3.197: Live root PWA only; the retired mirror and project sandbox preview must never be rebuilt or published. Inventory and queue cards never render an approved Bunch Note banner. resolveLiveInventoryForCard owns display hydration: normalized item/location/lot, then active same-item/location fallback; quantities come from master inventory, never SOC order Qty. Open Stock is numeric item-wide F1/S1 Available; Hold/Reason and evidence come from the selected live row and same-account location notes. Duplicate item/location/lot display rows merge evidence while physical UIDs remain available to exact mutation resolvers. Friday Plan Start is Grey (#64748B). Preserve physical tag identity, authorization, receipt-gated saves, Back/navigation, READY/LKG reads, and delivery workers. Cross-layer blast radius: frontend display and static publication only; Code.gs, SQL/RPCs and app-api unchanged; no new startup read.

- v2.3.196: Never replace incoming ERP order changes with an absolute pending Reclass quantity. Preserve the existing field and movement ledgers across Season/Move Up, Write Off, Location Move, Hold/Stop, Priority, Spec and Split; reapply pending numeric deltas until the exact physical ERP evidence acknowledges them. Raw baselines and private order receipts separate order depletion from Reclass out-movements. Deplete positive photo-match stock one-for-one by the canonical order delta, expire at zero or age >=10 days, and retain valid manual evidence and completion. Queue expired media for the existing Drive archive workflow. Never authorize RUN SCRIPT from a username alone: native or signed app-session proof and server-side account/administrator checks remain mandatory.

- v2.3.185 / Invariant 485: Never retain or reopen Item Detail after confirmed MARK DONE, tie its accepted save to an editor navigation signal, revoke a session photo preview on upload, or squeeze LEFT/RIGHT into an 84px pair. Capture exact row/account evidence and return through the canonical Back handler before awaiting persistence; retain scroll, receipt-gated Success, drafts and rollback. Suspend evaluation keeps the physical tag active; only Complete Tag removes it. Keep localPreviewUrl through Uploaded and group nowrap 11px buttons with 4px 8px padding. This supersedes earlier return-after-receipt and automatic-next-editor instructions.

- Never resolve an evaluation from item/location alone, aggregate sibling metrics for its preview, compute its observed percentage from Available, or refresh an expired photo using a notes update timestamp. Preserve original photo time, exact UID, depletion, and receipt-gated completion. Invariant 482 owns this contract.


- v2.3.179. Queue cards and their Item Detail may preview an existing evaluation from the same item and location, preferring the linked physical UID, lot, sale year, season and priority. Keep that display source separate from the write target. Request, Suspend, Drive, AV and Eval Work publish only exact master receipts. An ambiguous Reclass opens a physical-row choice. Reclass transport recovery replays the same authenticated Edge command and idempotency token through PostgREST. Service Worker updates defer to the page while a detail, modal or upload is open. Restore unsaved fields by account, row and section. Retain local photo previews until the public image loads. An inventory completion lock requires a photo and positive match stock. Suspend Mark Done returns to the scrolled cards after its matching receipt. A classified Dock 38 or 39 review enters the existing Suspend path. A fully staged SOC file continues to publication, and only its receipt qualifies it for 100%. Invariants 472–478 cover queue media, locks, previews, drafts, worker navigation, Reclass recovery and staged SOC continuation.

- Never hydrate or publish photos, spec, caliper, AV/pick notes, comments, match quantities or completion by location or item/location. Use the master UID first, and use an exact item/location/lot tuple only when it identifies one physical row. Two rows with the same tuple and different UIDs own separate evidence. Invariant 471 covers the Grey Guardian priority 1 and priority 10 cards.

- v2.3.165. A completed-row 42501 requires a deliberate unlock through the authenticated exact-row SQL RPC. Preserve drafts and keep server denials visible. Reclass may recover an uncertain command only from its actor-scoped receipt under the original token. Background reads retain verified same-account data. Watchdog repairs footer position and recounts badges before reporting persistent anomalies. Operational auto-resolution records a telemetry disposition, never a save receipt. Invariant 459 protects this boundary.
- v2.3.144: Never infer completion from photo/spec changes or drop a committed photo timestamp while restoring editor drafts. Keep unlimited photo references and ✓ UPLOADED receipts; only explicit Mark Done completes. Native unlock repeats assigned-user/Admin/super-admin authorization. Photo age >10 calendar days or evaluated zero match expires through canonical evidence/history; unentered match remains a draft and Docks-owned photos are exempt. Camera state is owner-scoped, survives recreation, and defers reload through capture plus 15 seconds. Unassigned summaries occur only once per completed manual sync on Home/Managers. Invariant 400 exercises these boundaries.
- Never clone the supplied VM fixture context when adding dependencies; asynchronous row and account transitions must share the original context object (Invariant 390).
- Never read a role fallback variable before its declaration while honoring an explicit Update Any Row grant. Invariant 386 exercises Y, explicit N and assigned-only branches.
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.
- v2.3.138: Never let a failed independent photo attachment undo a successful exact-row evidence receipt; keep failed drafts removable and independently retryable (Invariant 359).

- Never resume master snapshot formatting/indexing across a UI yield while an owner write is pending. The canonical preparation scheduler must use the same interactive-write guard before continuing and recheck snapshot identity afterward (Invariant 311).

- Never force a bulk inventory response to decode after an elapsed wait while a mutation is still pending. Yield until the current-account write settles, retaining abort handling and displayed LKG rows (Invariant 310).

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never route Suspend Item Detail MARK DONE through physical tag completion. Save exact evidence and retain the active card; only the main card Complete Tag close command removes eligibility. Email review completion retains its tag and evidence, with existing authorization, approval and outbox behavior. Request completion remains unchanged. Invariant 290 covers the detail route.

- v2.3.121: Never infer completion from elapsed runtime or stale parsing progress while a leased worker is publishing. Only five current-run checked source checkpoints may complete the run; expired leases remain resumable through cloud plus same-account single-flight browser continuation. A confirmed exact-file commit paints Published immediately, including Processed-move retries; unchanged checks retain real last-published counts and names. SOC accepts 52,000-row files with bounded 1,500-row slices. Invariants 253–257 and Lock 6 preserve this contract; the v2.3.120 age-based completion rule is superseded. Shared Back/navigation, READY/LKG data and all mutation authorization remain intact.

- v2.3.120: Never append ORDER HISTORY or unrelated secondary folders to the five-source operational Run Script. Complete DRIVE/CAV/RESERVES/SOC/HL PO at 100%, release retired-history or 90-second stalled jobs without deleting cursors, and fold new SOC quantities into the canonical SQL statistics using latest daily group bags. Preserve immutable history, protected evidence, public access-matrix authorization, shared Back/navigation and service-only delivery. Invariants 250–252 and Lock 6 preserve the five-card modal and bounded mobile centering.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Preserve the canonical exact-row photo and evaluation mutation engine across operational views.

### Exact ownership
- assets/app-runtime.js: module contract.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- assets/user-access-control.js: module contract.
- assets/row-workflow-functions.js: calculateLiveLocPhotoMatch, beginOptimisticCompletedRow, syncCompletedRowControls, replaceDetailMediaPreservingImages.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-zero-regression-mutation-engine, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-zero-regression-mutation-engine.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- ROW-EVALUATION-2026-11-05: Suspend preview fallback aggregated sibling lots; percentage drafts used Available instead of true On Hand; archived row evidence could lack a master photo or match quantity. Publish through publishRowEvaluationToMasterAndNotes and UID-keyed protected evidence. Require explicit UID or unique full season/year/priority/lot identity, calculate observed match from exact On Hand, retain outbound depletion and original photo timestamps, and never revive expired evidence from notes update time. Permanent assertion: tests/row-evaluation-contract.test.mjs; Golden Invariant 482; transactional sibling checks. Evidence: Sandbox rollback and live guarded recovery receipts; no actor permissions or completion-removal contracts changed..
- v2.3.185-completion-cards-preview: Completed Drive/AV details were deliberately retained, other receipts reopened editors, and uploaded previews were removed while narrow reorder controls wrapped. Return the captured exact-row completion to its cards before awaiting persistence; preserve receipt-gated success, account scope, rollback, active physical tags and session localPreviewUrl. Permanent assertion: tests/completion-cards-preview.test.mjs and append-only Invariant 485. Evidence: Reviewed v2.3.185 user report; baseline reproduction and focused live/test checks under G:/My Drive/GNC/AgData/Release Evidence/.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->

### Release reset anti-pattern
Never gate authoritative live-manifest or worker updates on a numerically greater version; compare normalized versions for inequality, retaining session/draft and complete-cache installation safeguards. Preserve existing live inventory card fallback, physical mutation UIDs, numeric Open Stock, hidden approved Bunch Note banners and Friday Grey. Cross-layer blast radius: frontend version checking only; Code.gs, SQL/RPCs and app-api remain unchanged.

## AgData v3.0.15 optimistic MARK DONE contract

The confirmation modal opens synchronously from a captured in-memory snapshot, with zero network or pending-autosave awaits before it. CANCEL causes no completion command. OK immediately publishes optimistic exact-row evaluation data and returns to the initiating list without awaiting persistence. Normal Request completion leaves the pending list and updates its badge; Suspend MARK DONE updates the physical tag and keeps it active until the separate Complete Tag command.

Freeze row identity, initiating account, evaluation values, photo/upload context and navigation source before the editor closes. Background persistence must outlive editor navigation without inheriting another row's fields. Preserve existing per-row coordination, idempotency, authenticated canonical commands, database evidence publishers and durable history/outbox receipts. Run independent persistence work concurrently with Promise.allSettled where appropriate; dependent photo URLs, atomic completion and outbox publication retain their required ordering. Never race duplicate raw PATCH/upsert writes against the canonical command.

Optimistic local completion is pending until the real receipt verifies. Retain existing owner-token rollback/retry and drafts on failure, reconcile only the initiating row/account, and never overwrite a newer edit or label an unpersisted save successful. The UI latency target is under 50ms after OK; measure the actual focused check and distinguish it from network/upload latency. Optional fields and missing photos remain nonblocking, while role/assignment authorization and exact-row identity remain mandatory.

### Forbidden Anti-Patterns (Never Repeat)
- Network, upload, stale-settings or autosave waits before asking for confirmation or before returning to the list.
- Completing a Suspend tag from MARK DONE, fabricating a durable success, abandoning failed optimistic work, or persisting a late upload to whichever editor is currently active.
- Parallel duplicate master/location/queue writes that bypass canonical transactional evidence, history/outbox or receipt contracts.
