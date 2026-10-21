---
name: agdata-field-ops-and-qc
description: Maintain AgData Manager, QC, Production, Eval Work, Shear List, Location Work, field counting and Bunch Notes, including their protected task and report contracts.
---

# Field operations and QC

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 5 and shared Back/navigation ownership.

## Owned implementation boundaries

- `assets/app-runtime.js`: `renderManagers`, `setHomeTab`, `renderQcHub`, `renderProductionHub`; `loadEvalWorkAssignments`, `renderEvalWorkQueue`, `openEvalWorkDetail`, `saveEvalWorkDraft`, `submitEvalWork`, `openEvalWorkSetupFromReclass`; `loadShearListData`, `renderShearList`, `submitShearList`, `completeShearListRow`, `completeShearLocationInquiry`; `loadLocationWorkJobs`, `openLocationWorkJob`, `renderLocationWorkQueue`, `resolveLocationWorkLine`; `loadProductionWorkflowRows`, `renderProductionWorkflowPanel`, `completeProductionWorkflowRow`; `createFieldCountingTransport`, `ensureFieldCountingIsland`; `renderManagerEvalReportsPanel`, `renderManagerEvalReports2Panel`, `buildManagerEvalReport2IndexAsync`, `renderManagerAssignedItemsPreviewTable`, `renderManagerSeasonPriorityPanel`, `renderManagerMovesPanel`, `renderManagerBlockClearingPanel` and `renderGrowerScout`.
- `assets/eval-reports-engine.js`: `GncEvalReports.classifyRows`, `classifyScriptCompatibleRowsAsync`, `buildAuthoritativeAssignmentModelAsync`, `buildItemInquiryModel`. Preserve location, season, ownership and report-suppression rules.
- `assets/bunch-note.js`: `BunchNote.open`, `back`, `saveDraft`, card picker, draft/action/recount transitions; `assets/bunch-queue-shell.js`: `BunchQueueShell.render`, `openDetail`, `closeDetail`, `stage`, `commit`. Source components live in `components/bunch-notes/`, `components/bunch-queue/`, `components/field-counting/`; bridges in `services/bunchQueue.ts`, `services/fieldCounting.ts`. Generated assets are build outputs, not independent business-rule sources.
- `assets/report-pages-live.js` (`createController`), `services/reportPages.ts`, `components/report-pages/`; production schedule source `components/managers/ProductionSchedule/`, `services/productionScheduleClient.js`, `services/productionScheduleSheets.js` produces `assets/production-schedule.js`.
- Peripheral field surfaces in `assets/app-runtime.js`: `renderCropRollModule`, `loadCropRollData`, `saveCropRollDetailCompletionRow`, `renderWeatherHold`, `loadWeatherHoldRiskData`, `submitGrowerScoutReport`, `saveGrowerScoutRowLog`, `renderPestManagement`, `renderTakeBack`, `completeTakeBackRow`, `submitLaborHours`; keep run/row identity, protected notes, attachment lifecycle and current actor scope. HR command-center/offboarding overlaps the Docks/Comm skill and auth skill.
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
