---
name: agdata-field-ops-and-qc
description: Maintain AgData Manager, QC, Production, Eval Work, Shear List, Location Work, field counting and Bunch Notes, including their protected task and report contracts.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# Field operations and QC

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 5 and shared Back/navigation ownership.

## Owned implementation boundaries

- `assets/app-runtime.js`: `renderManagers`, `setHomeTab`, `renderQcHub`, `renderProductionHub`; `loadEvalWorkAssignments`, `renderEvalWorkQueue`, `openEvalWorkDetail`, `saveEvalWorkDraft`, `submitEvalWork`, `openEvalWorkSetupFromReclass`; `loadShearListData`, `renderShearList`, `submitShearList`, `completeShearListRow`, `completeShearLocationInquiry`; `loadLocationWorkJobs`, `openLocationWorkJob`, `renderLocationWorkQueue`, `resolveLocationWorkLine`; `loadProductionWorkflowRows`, `renderProductionWorkflowPanel`, `completeProductionWorkflowRow`; `createFieldCountingTransport`, `ensureFieldCountingIsland`; `renderManagerEvalReportsPanel`, `renderManagerEvalReports2Panel`, `buildManagerEvalReport2IndexAsync`, `renderManagerAssignedItemsPreviewTable`, `renderManagerSeasonPriorityPanel`, `renderManagerMovesPanel`, `renderManagerBlockClearingPanel` and `renderGrowerScout`.
- `assets/eval-reports-engine.js`: `GncEvalReports.classifyRows`, `classifyScriptCompatibleRowsAsync`, `buildAuthoritativeAssignmentModelAsync`, `buildItemInquiryModel`. Preserve location, season, ownership and report-suppression rules.
- `assets/bunch-note.js`: `BunchNote.open`, `back`, `saveDraft`, card picker, draft/action/recount transitions; `assets/bunch-queue-shell.js`: `BunchQueueShell.render`, `openDetail`, `closeDetail`, `stage`, `commit`. Source components live in `components/bunch-notes/`, `components/bunch-queue/`, `components/field-counting/`; bridges in `services/bunchQueue.ts`, `services/fieldCounting.ts`. Generated assets are build outputs, not independent business-rule sources.
- `assets/report-pages-live.js` (`createController`), `services/reportPages.ts`, `components/report-pages/`; production schedule source `components/managers/ProductionSchedule/`, `services/productionScheduleClient.js`, `services/productionScheduleSheets.js` produces `assets/production-schedule.js`.
- Peripheral field surfaces in `assets/app-runtime.js`: `renderCropRollModule`, `loadCropRollData`, `saveCropRollDetailCompletionRow`, `renderWeatherHold`, `loadWeatherHoldRiskData`, `submitGrowerScoutReport`, `saveGrowerScoutRowLog`, `renderPestManagement`, `renderTakeBack`, `completeTakeBackRow`, `submitLaborHours`; keep run/row identity, protected notes, attachment lifecycle and current actor scope. HR command-center/offboarding overlaps the Docks/Comm skill and auth skill. Manager tables and archive navigation are owned by [agdata-table-management-and-directory](../agdata-table-management-and-directory/SKILL.md).
- Backend: `supabase/functions/app-api/index.ts` actions `eval_work`, `report_read_v2`, `shear_location_work`, `location_work`, `production_workflow`, `production_schedule`, `bunch_note`, `bunch_note_workflow`, `manager_season_settings`; `_shared/production-workflow.ts` and `_shared/bunch-note-pdf-delivery.ts`. `Code.gs`: `buildEvalWorkReportModel_`, `handleSignedEvalWorkDelivery_`, `handleSignedShearLocationDelivery_`, `handleSignedLocationWorkDelivery_`, `handleSignedBunchNoteDelivery_`, `runProductionScheduleImportChunk_`.

## Shared dependencies and invariants

- Enter views through `switchView` / `setHomeTab`; preserve `canAccessView`, `getManagersToolAccess`, `updateGlobalBackButton`, `goBackUniversal` and the existing modal/secondary-back stack. Relevant roots: `#managers-content`, `#view-qc`, `#view-production`, `#production-workflow-page-content`, `#shear-list-content`, `#bunch-note-content`, `#manager-production-schedule-root`. Never change shared Back/header visibility to repair one queue; the shell skill owns that policy.
- Preserve account/auth epoch ownership, `activeHomeTab`, `evalWorkRows` / `activeEvalWorkDetailId`, `productionWorkflowState`, report-page source revisions and `GncEvalReports` assignment indexes. Keep same-account loaded work while refreshing; discard late responses from a different account/view.
- Eval Reports #2 owns its report-page state and last-good same-account rows. Shared Manager revision checks may refresh those sources, but a transient sync or revision failure must not replace the Manager shell or navigate away from the report; preserve its existing cards and offer a report-page retry. Keep confirmed permission denial and account identity fences authoritative.
- On a cold Eval Reports #2 visit, default the first query to LowStock only (`low-stock`) and render from the authorized `report_read_v2` groups page. Use server `metadata.counts` for each report filter and `metadata.reportMatchCount` for the full report union; do not read counts from empty client arrays in paged mode. Render bounded `previewRows` returned with each item group and load full item rows only when the user opens the item inquiry. Start capabilities as an optional background read; a timeout or failure must not hold the report page or trigger full `ph_master_inventory` / Warehouse Assigned Items downloads. Keep rows from materialized pages only, append subsequent pages from one guarded continuation, and show a single retry action on page failure instead of unhydrated placeholder rows.
- LOCATION MOVES, RECOUNT, SHEAR LIST, EVAL WORK and BUNCH NOTES remain distinct work types. Sort `locationcode` naturally ascending and retain physical-row/task identity. Preserve Hold/Stop reason/flag grades and overwintering notes; an absent ERP column cannot clear app-owned work.
- Mutations retain actor/module authorization, exact source/revision checks, command identity and atomic delivery/outbox behavior. Eval's modern creation freezes source AssignedTo and completion recipients in `create_eval_work_multi_v1`; do not substitute legacy browser-selected assignees for that path.
- Bunch Note required recipients are Dylan, Megan, Sharon and location/card owners (`requiredBunchRecipientIds`); preserve active mapped emails and selected additions. This is distinct from Request and Reclass routing.

## Scoped verification

For a relevant change, select the affected files from this pure Node command (target under 10 seconds, **not measured by the static audit**):

```sh
node --test tests/eval-reports-engine.test.mjs tests/bunch-note-card-model.test.mjs tests/production-schedule-client.test.mjs
```

Use the canonical dependency map's Location Work / Shear rows when those specific contracts change. Follow AGENTS daytime limits; browser, import replay and database suites require the applicable explicit or Nightly scope. This skill does not authorize production writes or a broad regression run.

Paged Eval2 indexes use metadata.reportMatchCount for the full union. Cold initialization must not reference an undeclared surface flag. Tasks may display its authenticated master preview while optional joins finish.

## Application conflict errors

Revision conflicts must use PT409, never custom 40001. The v2.3.34 application_conflict_retry_guard migration preserves existing RPC permissions and retry catches; Edge handlers recognize both real serialization failures and HTTP conflicts.

## Eval2 local browse and navigation continuity

The authorized report_read_v2 groups response supplies compact metadata.browseColumns/browseRows plus evaluatorDirectory. This display index preserves server classification, row assignments (including canonical block-derived assignments), source revision and account fences. GncEvalReports builds local report/user/block/location groups from it; Apply commits the checklist once and renders synchronously. Never change report selection on individual checkbox toggles. Keep Select All/Clear All and real matching-row user counts, including active evaluator accounts with zero matches.

Keep the Filters disclosure closed in initial markup and retain its mounted controls through hydration/mode refreshes. BLOCK / LOCATION Back unwinds item cards, locations, blocks, Manager Modules, Home; ITEMCODES exits to Modules. cancelManagerModuleReads cancels page/worker generations on module exit, and late direct-inquiry completion must check view, owner and generation. Preview On Hand/Available/Open Stock resolve numeric inventory fallback or zero; dark metric text remains cyan/mint. Focused coverage: eval-reports-engine and inventory-drill-navigation.

## Complete Reclass item scope (v2.3.37)

Eval Reports #2 passes its complete cached item rows, displayed card siblings and compact browse rows into the shared Reclass modal immediately. getItemInquiryRows merges these with masterInventoryByItemCode, deduplicates normalized item/location/lot and sorts location then lot naturally. A table-row click or keyboard activation selects that exact location/lot as Originating Row; a card-body activation uses the drilled location, retaining every sibling accordion. The header labels originating-row quantities; each row retains its own OH/REV/AVL/PRI. Background exact item hydration keeps existing account/view fences and cannot overwrite drafts. Dark quantities use the actual body[data-ops-theme="dark"] selector with sky-cyan text. Shared Back/modal hooks and server mutation/recipient authorization remain authoritative. Focused regression: tests/eval-reports-engine.test.mjs; no new read route.

## Season stock and Item Inquiry delivery

Reclass Open Stock is shared by itemcode and the trailing canonical season (27.F1 and 26.F1 both use F1). The atomic statement triggers propagate available-quantity deltas for moves, Hold/Stop transitions and quantity changes across every season sibling; new destination seasons start at existing destination stock, CAV stock, or zero. The private season override and physical s_lts/season_oh ledger protect un-keyed master and ph_cav_import imports, including new rows; matching ERP evidence acknowledges overrides. Receipt seasonStocks updates Drive, AV, Que and Eval cached siblings without clearing last-known-good views. Optimistic moves preserve rollback and unknown-outcome command identity; delivery runs in the background.

Every Reclass Item Inquiry has the same white/black 14-column HTML table and one landscape Letter PDF, titled Item Inquiry with Common Name, Item Code, Size and Source. All item location/lot rows remain visible; changed cells use #ffff00. The PDF filename is Common Name.pdf. Server-authorized core recipients are dylan_collyge, megan_kelly, sharon_combs plus the submitter, deduplicated from active confirmed accounts. Eval Reports #2 retains all sibling rows, exact tapped/drilled Originating Row, high-contrast quantities, and shared Back/modal ownership. No startup/background read was added; existing fixture routes remain unchanged.

## Watchdog and active queue continuity

Manager module buttons use content-visibility:visible to avoid blank boxes during scrolling. Eval2 uses getCachedManagerEvalReport2Metadata only from a complete same-account inventory receipt while report_read_v2 refreshes; optional assignment freshness must not erase cached browse rows. Cached classification is display-only; existing mutation authorization remains authoritative. Manager quantity text uses bright mint/cyan on dark backgrounds.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `renderManagerEvalReports2Panel`, `compareManagerEvalReport2InventoryRows`, `buildManagerEvalReport2IndexAsync`, `renderProductionHub`; `assets/eval-reports-engine.js`: Eval #2 classification/browse models.
- `supabase/functions/app-api/index.ts`: `compareLocationCodeNatural`, `sortManagerEval2PreviewRows`, `handleManagerReportReadAction`, `handleEvalWorkAction`, `handleLocationWorkAction`; SQL: `manager_report_read_v2`; `Code.gs`: Eval/Location Work delivery handlers.

## Cross-Layer Blast Radius

- Eval Reports #2 sorts `locationcode` naturally as the first key in both app-api preview rows and client rows; location groups remain contiguous and every current item row renders without a `.slice(0, 8)` cap.
- BLOCK / LOCATION drill-down is exactly BLOCK ALPHA -> base LOCATIONCODE (`C.05`, `C.06`) -> ITEMCODE cards ordered by full numeric bay. Global Back unwinds those two levels before leaving Manager.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- v3.0.7 / Invariants 524–525: Never replace Low Stock, Not in F1 or existing report categories with a field audit. Default both report surfaces to the original menu and offer Season Y <= 2026 Field Audit alongside them; compose canonical LOCATION groups and Drive plant cards with audit controls, custom questions and native Excel export.
- Cross-layer: request runtime/row-workflow, coordinator and canonical SQL creation/mapping/revision functions; app-api release pin redeployed. Code.gs delivery, Watchdog v3.0.6 and mandatory Reclass Explanation remain intact.

- Never treat an unknown sale year as zero, reset another account’s audit drafts, overwrite pending local answers with older network data, replace existing evaluator reports, or open a sibling inventory row for a field-audit action. Invariant 521 owns the preset and drill-down model.

- v2.3.189: Never reject Excel serial Hold dates or expand item-card siblings outside a selected Block/Location. Use the canonical date parser and filtered browse seed (Invariant 491).

- Never rebuild the complete filtered table in the optimistic/receipt paint of an owner save. Reuse the mounted row props, repaint drafts/pending selections, and coalesce full filtering until writes settle; preserve canonical state and rollback (Invariant 302).

- Never issue a zero-row owner INSERT/UPDATE merely to confirm unchanged selections: statement triggers still invalidate datasets and contend with reads. Skip the write statement after canonical authorization and comparison, retain a durable command receipt, and return authoritative assignments (Invariant 301).

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never ignore checked visible itemcodes in a row owner dropdown, remap all 9,485 display rows after a complete ownership receipt, or immediately reload the whole assignment dataset after every save. Use one authorized canonical batch, preserve the acknowledged mapped cache, coalesce background refreshes, and retain rollback/stale-receipt fences. Pin the toolbar outside the only vertical table scroll area. Invariants 283–287 and 291 cover these seams.

- v2.3.122: Never add an optional history/weather read without exact fixture keys, account fencing, estimate provenance, and the shared shear load confirmation. Keep one-column cards, fixed-height KPIs, and all five operational sync stages intact. Invariants 258–262 preserve the behavior.


- v2.3.115: Never derive owner choices only from users who already own items or render a text-only Bulk header. Assigned Items uses active directory users, filtered checkbox selection, unique/all-row modes, Plant Group Code and numeric history cells. Retain canonical default revisions, location overrides and failed drafts (Invariant 216).

- v2.3.112: Remove only expression statements proved unreachable after an unconditional return/throw in the same AST block; retain declaration bindings and all reachable public handlers. Strict identifier pruning excludes dynamically referenced names and non-declaration candidates.


- Never render Season Priority Hold or Location Notes from report `noteContext`; hydrate only visible rows through exact `master_identity_batch` identities, keep the report cards mounted while the read runs, and fence cached rows by account, permission scope, and inventory revision.
- Never route Managers Assigned Items through the generic blocking dataset gate or return a loading-only panel while retained assignments exist; mount the cached/empty table immediately and refresh assignment/master rows behind it without replacing the Managers hub.
- Never trust a `fullLoaded` marker or same-revision coordinator cache for `warehouseAssignedItems` when the retained row array is empty; a fresh Assigned Items entry must bypass snapshot reuse and retry bounded `REQUEST_ABORTED` generation handoffs for one current warehouse read while keeping the empty table mounted.

- Never repeat a location-level Direction or default House Plan beneath every Bunch Note commonname, expose Card direction in the card modal, or use single-value/datalist controls for workflow fields that require multi-select; custom choices stay field-scoped and persist to both `inv_bunch_notes_custom_dropdowns_v1` stores.

- Never hardcode Eval-user filtering to only one legacy manager set; the shared filter gate includes Dylan, Megan, JD, Mitch and authenticated Administrators while option values come from the live assignment/evaluator directory.

- Never derive Bunch Notes email recipients from card owners, assignees, optional checkboxes, or stale preview snapshots while the Dylan-only delivery policy is active; in-app assignment and outbound email routing are separate contracts.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never let lot, priority, assignment, or season precede `locationcode`, reintroduce `Showing the first 8 inventory rows`, expose `.017`/`.018` as separate level-two tiles, or replace last-good Eval rows with a loading gate.
- Never use a Manager refresh to erase field drafts, app-owned notes, task identities, or the shared shell's Back/header state.
- Never make Assigned Items wait for full master pagination or replace retained assignments with `Load Failed`; paint its current assignment/master slice first and hydrate complete rows behind it.
- Never require an evaluator to open Manager → Assigned Items before row-scoped controls work; restore the account-owned assignment cache during login and refresh `ph_inventory_row_assignments` in the background before Drive, AV, Item Detail, or Reclass authorization is evaluated.
- Never replace a complete same-account Eval #2 snapshot with eleven zero buckets while its published source rows are still available, and never make a Bunch Notes suggestion depend on a mobile-native datalist keyboard.
- Never expose Bunch Notes' internal `setup`/`items` state as an extra Back stop; one shell Back tap must move from a visible location plan directly to its location grid.
- Never compare Bunch Note drafts and inventory by raw display location or keep drafts only in session memory; normalize `F.05` and `F.05.000`, retain a per-account local shadow through logout, and merge it with the server draft before rendering badges or editors.
- Never derive Manager Assigned Items only from assignment rows. Use the complete 9,552+ master catalog, join ownership by exact canonical warehouse-row identity, treat an exact empty assignment as authoritative over a stale master owner, and compute visible options/counts from that same joined snapshot.

## v2.3.122 ownership and GDD contracts

See [Smart Moves](../agdata-smart-moves-and-gdd-hold-intelligence/SKILL.md) and [Shear guard](../agdata-shear-crew-load-and-gdd-guard/SKILL.md).


## v2.3.134 Field stock reconciliation

TA; no report requires an exact-row recount and reviewed reconciliation; note approval does not change stock counts. Badge Not on inventory and missing historical lots as Ghost Stock / Not on Live Inventory. Preserve protected field tasks, photos, mutation authorization and delivery.

## Shared workflow and canonical ownership

Use all 11 routes in [AGENTS.md](../../../AGENTS.md) and the [dependency map](../../../docs/architecture/agdata-module-dependency-map.md). BUNCH_NOTES_SIMULATOR → Issues → Drive Mode Card → Approve & Create New Bunch Note uses the 13-Rule evaluator in assets/nursery-command-model.js and controller in assets/nursery-command-tables.js. The auditor owns Gates 1–7, Rules 8–13 and the six issue categories; this Gem contributes its domain evidence. resolveBunchNoteExceptionRowIdentity is canonical in the model; assets/app-runtime.js delegates to it. Never add competing evaluators.

## Persistence, navigation and cross-layer blast radius

Every issue has unique_id, locationcode, itemcode, lotcode, commonname and contsize. Retain physical live UIDs; explicitly historical identities use <locationcode>::<itemcode>::GHOST_LOT or HISTORICAL_LOT, zero unverified stock and a ghost badge. Synchronously publish same-account optimistic decisions to localStorage, Simulator, APPROVED_EXECUTION_PLAN and exact-row Drive projections; defer the authorized nursery_command_v23127 save with return=minimal. Validate the exact receipt, retain stable command IDs, and roll back with a retained draft and toast on failure. Never turn a historical approval into stock movement.

Preserve switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack, header/search ownership and READY/LKG reads. SQL seeds source-backed historical definitions idempotently; authenticated RPC authorization and optimistic revision guards remain authoritative. Browser direct-table grants, app-api, Code.gs and Apps Script delivery/outbox remain unchanged; no startup read is added.

## Forbidden Anti-Patterns (Never Repeat)

- Block-only historical cards and waiting for the network before updating approval caused unresolved work and slow UI. Invariants 339–340 require complete identities, immediate projection, exact receipts and rollback. Never fabricate a live master UID, replace physical inventory with historical stock, or broaden mutation grants.

## Scoped verification

Use tests/manager-table-workspace.test.mjs, the appended golden invariants and Permanent Lock 10 in scripts/enforce-all-14-gems-gate.mjs; register this manifest in scripts/run-tooling-release-checks.mjs.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Maintain AgData Manager, QC, Production, Eval Work, Shear List, Location Work, field counting and Bunch Notes, including their protected task and report contracts.

### Exact ownership
- assets/app-runtime.js: renderManagerEvalReports2Panel, compareManagerEvalReport2InventoryRows, renderProductionHub, getManagerUnassignedItemcodes, notifyManagerUnassignedItems, openManagerUnassignedItems, canUserFilterEvalUsers, loadManagerSeasonPriorityLiveNoteRows, resetManagerSeasonPriorityLiveNoteRows, getManagerSeasonPriorityContextNotes.
- assets/runtime-watchdog.js: inspectDataParity.
- supabase/functions/app-api/index.ts: handleEvalWorkAction, handleManagerReportReadAction, sortManagerEval2PreviewRows, handleLocationWorkAction, forceBunchNoteDylanRecipient.
- Code.gs: handleSignedEvalWorkDelivery_, handleSignedLocationWorkDelivery_, bunchNoteCardRoute_, buildBunchNotePdfHtml_, handleSignedBunchNoteDelivery_.
- index.html: resumeAssignedItemsNotification.
- assets/bunch-note.js: normalizeBunchNoteLocationKey, recipientEmails, requiredBunchRecipientIds, suggestionField, locationSetupHtml, renderBunchNoteMultiSelectDropdown, ensureBunchNoteDropdownOptionSaved, editor.
- services/bunch-note-pdf.mjs: renderBunchNoteReportsPdf.
- supabase/migrations/20261028070752_agdata_v2392_jorge_assigned_live_changes.sql: inventory_row_assigned_to_actor_v2392, require_drive_live_change_profile_v2392.
- assets/row-workflow-functions.js: getManagerAssignableOwnerUsers, setManagerAssignedViewMode, setManagerAssignedPlantGroupFilter, selectAllFilteredManagerAssignedItems.
- assets/nursery-command-model.js: resolveBunchNoteExceptionRowIdentity, buildBunchNoteContext, evaluateBunchNoteRowAndIssues, approvedBunchNote.
- assets/nursery-command-tables.js: mount.
- DOM: #managers-content, #view-qc, #view-production, #production-workflow-page-content, #shear-list-content, #bunch-note-content
- PostgreSQL: ph_master_inventory, ph_cav_import, ph_app_users, ph_inventory_row_assignments
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-field-ops-and-qc, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-field-ops-and-qc.

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


## Executive Inventory & Field Audit (v3.0.4)

The Reports Executive Inventory & Field Audit surface defaults to Season containing Y and Sale Year <= 2026, uses BlockAlpha -> LocationCode -> exact lot rows and preserves the evaluator/photo report switcher. Keep every surface dark emerald, the shared Back/Detail/Reclass owners, per-account local pending answers, serialized PostgREST upserts to ph_inventory_field_audits, custom question metadata, filtered export/print and all v3.0.3 Reclass Explanation rules. This release explicitly authorizes anon/authenticated/service_role audit-table access; it grants no new inventory mutation rights.
Cross-layer blast radius: row-workflow report helpers, two existing report render adapters, scoped app-styles CSS and the dedicated audit table. app-api, Code.gs, import/publication RPCs and all other relation grants remain unchanged. The on-demand GET /rest/v1/ph_inventory_field_audits is registered in the shared route fixture.
