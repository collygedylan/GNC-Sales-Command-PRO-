---
name: agdata-queue-and-reclass-specialist
description: Maintain AgData Que SUSPEND and REQUEST, physical tag-row identity, inventory joins, atomic Reclass updates and Reclass report recipient restrictions.
---

# Queues and Reclass

The current server-authorized SOC snapshot owns Suspend membership. Delta imports retain earlier filenames on unchanged physical rows, so a latest-filename watermark is display metadata, never a row exclusion predicate. An empty authorized snapshot remains empty.

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 4 and shared Back/navigation ownership.

- Que → SUSPEND represents one physical spreadsheet row as one card using the unique tag line ID. Never collapse distinct physical rows because item/location/lot values match. Preserve Que → REQUEST behavior.
- Dylan, Megan and JD can edit/complete Suspend Tags and decide pending Suspend approvals through the authenticated canonical grants. Preserve native session proof, command identity, source version and pending-status checks; access does not change delivery recipients.
- Use natural alphanumeric locationcode ascending as the primary queue order, with stable existing tie-breakers. Build deterministic inventory joins from itemcode, locationcode and lotcode against the complete master DriveAround inventory Map.
- Suspend Tag dataset pages include authenticated server metric enrichment from `ph_master_inventory` with item/location/lot, item/lot, then item fallback, and `ph_cav_import` for available/description fallback. Preserve each SOC `unique_id` as the card identity; keep item quantities distinct from location totals. Derive `LOC_ON_HAND` and `LOC_MATCH_QTY` only from rows at the requested item/location; use a positive card/item-lot On Hand display fallback for a missing physical location; otherwise emit numeric zero only after a complete master read is bracketed by the same verified READY inventory revision. Location photo match remains tied to the requested physical location. Never let a positive location photo match from another lot/location leak into the card. A missing item source must not fabricate zero item quantities. Client display may use the same fallback only from the current complete account-scoped inventory/CAV snapshot, and must expose each metric value to the runtime parity sensor with `data-queue-metric`.
- Reclass Item Inquiry supports atomic live updates for Move Up, Move Down, Hold/Stop, Priority, Loc PTN1, Loc Note and Sales Note. Preserve payload state, permission checks, deduplication and inflight protection. Open immediately from the displayed card; background refresh cannot replace a user draft.
- Pair each successful Reclass mutation with its durable full GNC PH Reclass Item Inquiry HTML and PDF report handoff. Delivery success is distinct from a queued outbox record; report only the state actually verified.
- Reclass email recipients are strictly the deduplicated set of dylan_collyge, megan_kelly, sharon_combs and the submitting user, resolved by the server from active profiles and confirmed email addresses. Under the approved v2.3.37 policy, jd_jones receives reports when he submits; do not add jd_jones or sunday_ellis as fixed or implicit recipients.
- Treat the client's inventory revision as an optional hint. Resolve the current revision inside the atomic server transaction, preserve exact source identity/quantity comparisons and command replay protection, and authorize the current actor on the server. A missing cache freshness proof must not block opening or submitting Reclass.

Test physical-row identity, numeric/natural ordering, lot-specific joins, duplicate submit attempts and exact recipient policy in Node. Validate changed atomic transaction contracts only in an isolated database; preserve production RLS/RBAC. The 100-source atomic batch limit is inclusively 1,000 ms; other interactive queries remain below 100 ms. Update matching fixture routes and this skill with new contracts.

## Owned seams and shared dependencies

- Queue frontend in `assets/app-runtime.js`: `getLatestSocSuspendTagSourceRows`, `getCurrentSuspendTagSourceFreshness`, `compareRequestSuspendTagRows`, `buildSuspendTagRenderPlan`, `createSuspendTagPageRenderRow`, `renderSuspendTagPagedCards`, `renderRequest`, `generateCard`, `getOperationalCardInventoryRow`, `buildQueueInventoryMetricsHtml`, `getQueueCardInventoryAuthorizationContext`. `suspendTagInventory`, raw SOC/Suspend sources, `activeReqTab`, physical source UID, page cache and the master inventory indexes must agree. The render-row factory is lazy: a DOM no-op must not replace a populated page cache with an empty one.
- Reclass frontend: `openArgosInventoryTransactionModal`, `getReadableCachedArgosItemInquiryGroup`, `submitArgosInventoryTransaction`, `applyArgosInventoryTransactionReturnedRow`, `publishArgosInventoryTransactionReturnedRows`; `argosReclassRowEditorEntries` and `argosReclassMultiActionState` own dirty fields, quantities, Hold/Stop and notes. Preserve pending command identity and replay recovery. Publish receipt rows only after coherent indexes; do not rebuild/publish independently per returned row.
- DOM: `#view-request`, `#request-content`, `#argos-inventory-transaction-modal`, `#argos-inventory-transaction-form`, `#argos-reclass-item-inquiry`, `#argos-inventory-transaction-apply`; shared card layout and metrics come from `generateCard` / `assets/queue-inventory-hydration.js`, while `assets/queue-completion-state.js` owns completion display state.
- Backend: `app-api` actions `dataset_read` (including `suspend_tag`), `suspend_tag`, `inventory_reclass_move`, `drive_reclass_inquiry`, `request_queue_remove`; `_shared/suspend-tag.ts`, `_shared/production-workflow.ts`, `services/reclassMove.ts`, `reclassMoves.ts`, `reclassReceipt.ts`, `reclassLiveEdits.ts`, `reclassEditableFields.ts`. Preserve service-only RPCs `suspend_tag_command_v1`, `apply_inventory_reclass_moves_with_delivery_v1`, `enqueue_drive_reclass_inquiry_v7`, their exact-source checks and canonical authorization.
- Report boundary: `ph_request_delivery_outbox` is durable queue state. `Code.gs` `getReclassInquiryEmailRecipients_`, `buildReclassInquiryReportModel_`, `buildReclassInquiryReportHtml_`, `buildReclassInquiryCompactReportHtml_`, `handleSignedReclassInquiryDelivery_`, `handleSignedInventoryReclassMoveDelivery_` resolve/freeze reports and delivery receipts. SQL `private.reclass_delivery_recipients_v1` / `get_reclass_delivery_recipients_v1` remain authoritative: Dylan + Megan + Sharon + submitting actor, deduplicated; JD is included when JD submits, never silently added as a fixed recipient.
- Shared shell: preserve `switchView`, `showOnlyPrimaryView`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, `viewHistoryStack` and modal-back hooks. Closing a draft modal must not reset navigation or destroy another module's draft.

## Scoped pure Node verification

```sh
node --test tests/reclass-zero-lockout.test.mjs tests/suspend-tag-dataset.test.mjs tests/reclass-recipient-policy.test.mjs
```

Local source/VM fixtures only; target `< 10s`, not a measured result. Select the subset relevant to the changed seam. Actual SQL changes additionally need only their targeted isolated SQL validation under the release governor; browser/full database suites remain nightly. Docs-only overrides take precedence. See canonical module-map cluster 4 for source anchors.

Suspend completion can reuse existing photo plus spec/AV Note from exact identity, item/location, then item evidence. The atomic command supplies missing match as 100 and shares saved evidence across active item tags while preserving physical identity, versions and locked approvals. Reclass status recovers committed live receipts independently of failed email state; signed priority reports compare frozen server quantity while quantity-changing proposals retain conflict checks. Delivery notices are dismissible and hidden on logout; reopening reads the exact inventory source.

Suspend candidate additions use authenticated suspend_tag/add_candidates with stable command ID, source revision/version and master inventory IDs only. The server owns exact order grouping (dock/drop/transaction/PLANSTART/customer/consignee/rep/item/original quantity), removes False Block 0.00.111 from active pulls, and retains additional real-location candidates. Email freezes all active group candidates; approve one denies the others, deny all cancels the order quantity. Keep active confirmed recipient resolution, native-session proof, immutable decision snapshots, idempotency receipts and account-scoped UI application.

## Request completion and foreground continuity

Request completion uses service-only request_work_command_v1 with a verified native actor/session, existing work permissions and ownership, a strict patch allowlist, and master-before-request row locks. Completion merges the latest locked evidence and tolerates background row-version changes; ordinary edits retain conflict checks. Request metrics prefer exact item/location/lot, then item/location, item/lot and item/CAV fallbacks, preserving numeric zero. Suspend matching order remains unchanged. Focused coverage: request-submission-durability.test.mjs and suspend-tag-dataset.test.mjs.

## Performance and retry guard (v2.3.34)

Application revision conflicts use SQLSTATE PT409 (HTTP 409); never raise 40001 for an application conflict, because PostgREST can retry it internally. Real PostgreSQL serialization failures retain 40001. The atomic application_conflict_retry_guard migration preserves security, grants and bounded catch behavior; operational_lookup_indexes uses audited physical columns and existing index prefixes. The 500/2,000-row staging constraint preserves resumable older imports. Historical archive backfills and the 15-minute trigger remain PAUSED.

The foreground coordinator owns a 30-second idle / 10-second active-sync heartbeat; hidden contexts cancel network polling and watchdog delivery retains its queue until visible. SOC/CAV/Reserves dataset_read pages accept optional numeric ifRevision, returning up_to_date only after actor, permission and query validation against a READY revision. Page caches are bounded and fenced by read identity and permission version. Queue metric joins group master/CAV once by item. Browser table mutations use authenticated app-api without direct PostgREST fallback; intentional native reads retain existing SELECT policies.

rebuildMasterInventoryIndexes installs the shared queue inventory index with byItemLocLot, byItemLoc (summed locOnHand and rows), byItem and normalizedSearchText. Search normalization and CAV fallback indexing happen once per snapshot. Exact mutation identity/ambiguity checks remain separate from display fallbacks. Shared switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack, header/search ownership and same-account cached displays remain governing dependencies. Focused regressions: live-sync-coordinator, inventory-drill-navigation, security-zero-trust; no browser timing claim follows from Node measurements.

## Compact Request cards and immediate Reclass delivery

Request/Archived cards display persisted req_qty immediately before itemcode, with creator display/username beneath Sales Rep and legacy creator/rep fallbacks. Metadata spans both thumbnail columns; meaningful notes replace empty caliper/source pills. The six metrics use three columns at narrow widths, matching Suspend. Submission retains canonical quantity and server creator audit fields.

Reclass create/retry starts the existing leased delivery worker with EdgeRuntime.waitUntil and returns the durable queued receipt immediately. Only server-frozen v7 inquiries may retry an earlier RECLASS_CONFLICT; no inventory mutation is replayed. A timeout retains queued state and never reports delivery without a receipt. Current Dylan/Megan/Sharon/actor recipient resolution remains authoritative. Focused tests: request-submission-durability and security-zero-trust.

## Option metrics and partial location refresh

On Hand accepts on_hand/onhand/onHand/qty_on_hand/oh and existing PTR aliases, deriving available + review when On Hand is absent/zero and that sum is positive. AV option cards use the shared spaced six-metric grid and a literal gap before container size. preserveCardLocationOnHand retains max(summedLocationOnHand, existingLocOnHand, rowOnHand) within the same account/permission item/location scope; partial refreshes cannot downgrade a known multi-lot total.

Candidate additions remain a verified service-role suspend_tag_command_v1 transaction with exact parent order grouping, source/version guards and idempotency. The receipt includes added_rows/removed_false_block and all affected physical rows; replaced False Block rows are removed from active Suspend arrays immediately. Optional metric enrichment cannot turn a committed receipt into failure. No synchronous Code.gs mutation is involved. Focused coverage: suspend-tag-dataset, inventory-drill-navigation and dock-trip-status.

Reclass display scope merges supplied item siblings with the current master item index by normalized item/location/lot, sorting location then lot naturally. Eval2 supplies all cached card rows and the tapped/drilled origin immediately; shared modal hydration retains account/view and dirty-draft guards. Display rows never acquire a verified master proof merely from that merge. Header quantities are labeled Originating row; row bars retain OH/REV/AVL/PRI. Focused coverage: tests/eval-reports-engine.test.mjs.

## Season stock and Item Inquiry delivery

Reclass Open Stock is shared by itemcode and the trailing canonical season (27.F1 and 26.F1 both use F1). The atomic statement triggers propagate available-quantity deltas for moves, Hold/Stop transitions and quantity changes across every season sibling; new destination seasons start at existing destination stock, CAV stock, or zero. The private season override and physical s_lts/season_oh ledger protect un-keyed master and ph_cav_import imports, including new rows; matching ERP evidence acknowledges overrides. Receipt seasonStocks updates Drive, AV, Que and Eval cached siblings without clearing last-known-good views. Optimistic moves preserve rollback and unknown-outcome command identity; delivery runs in the background.

Every Reclass Item Inquiry has the same white/black 14-column HTML table and one landscape Letter PDF, titled Item Inquiry with Common Name, Item Code, Size and Source. All item location/lot rows remain visible; changed cells use #ffff00. The PDF filename is Common Name.pdf. Server-authorized core recipients are dylan_collyge, megan_kelly, sharon_combs plus the submitter, deduplicated from active confirmed accounts. Eval Reports #2 retains all sibling rows, exact tapped/drilled Originating Row, high-contrast quantities, and shared Back/modal ownership. No startup/background read was added; existing fixture routes remain unchanged.

## Watchdog and active queue continuity

Que contains only active operational tabs; ARCHIVED is absent. Archived/completed request pages and Restore mount inside Home Historical Requests via renderHistoricalRequestArchive, retaining account/permission ownership and idempotent restore. Queue cards paint their owned memory rows while refreshRequestViewInBackground runs; Location Work must not wait on requests/master. Reset transport cooldowns on explicit tab/Retry while preserving authorization fences. Request-only normalizeRequestCardMetrics repairs OH=0 with AVL>0 to AVL+REV and raises Loc OH to that value without mutating source rows. Collapse N/A | N/A and resolve all stored Qty aliases. Suspend candidate projection fields must match database.types.ts and its generated contracts; backend faults return retryable 503, never mislabeled parameter errors.

Every submitted regular Request keeps a permanent history snapshot while its unfulfilled active copy remains visible. History overlap is required, not a completion signal; only completion outbox, history photo+spec, current valid master evidence, or explicit queue removal may remove the active copy. Authenticated direct reads of the security-invoker queue views require `ph_master_inventory` SELECT plus its existing RLS policies.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `renderRequest`, `buildPendingRequestRenderPlan`, `buildReclassRecountLocationGroups`, `buildOptimisticInventoryReclassMoveModel`, and the atomic Reclass modal/receipt publishers.
- `supabase/functions/app-api/index.ts`: `handleDatasetRead`, `handleDriveReclassAction`, `handleReclassRecountAction`; SQL: Reclass move/delivery RPCs and recount jobs; `Code.gs`: `buildReclassItemInquiryTable_`, `handleSignedReclassRecountCompletion_`.

## Cross-Layer Blast Radius

- Recount groups one card per `(itemcode, locationcode)`, sums On Hand across every lot, and sends per-lot On Hand/Available/Review plus the submitted location total.
- Move Up/Down applies the physical moved-quantity delta to Open Stock on every source/destination lot row and recomputes Loc Photo Match on first save. The report table remains exactly nine columns, with the frozen starting OH and inline `152 - 140 --> F1` (or split `152 - 100 --> F1, - 40 --> S1`) notation inside the yellow OH cell.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- Never grant or reject Jorge Reclass authority from cached role flags alone: the client may unlock only an Assigned Items row, and app-api plus PostgreSQL must independently resolve the authenticated `jorge_colunga` actor against the exact physical row or canonical itemcode assignment before applying live edits.

- Never cap Move Up only by physical row On Hand or Available; aggregate every Move Up line for the same itemcode + source lotcode and enforce the nonnegative pre-move `s_lts` limit in both the client draft and the locked SQL transaction.

- Never seed a newly created Reclass destination season from the source row or an unrelated CAV season baseline, omit location evidence from the cloned physical row, or accept an Edge success response without an applied receipt containing committed master rows.

- Never make Que cards borrow a reduced thumbnail renderer or suppress saved Spec/Caliper when AV Note is blank; reuse the canonical photo/evidence projection for the exact physical row.

- Never hydrate Queue metrics from another location or a different explicit lot, replace physical `s_lts` with summed Available, or replace a null `loc_photo_match` with a quantity. False Block variants must render no metric boxes even when an enriched payload contains stock; local report fixtures must include the frozen pre-edit `report_rows` and load every canonical reconciliation helper.

- Never add a direct operational view to the runtime allowlist without a finite typed browser alias to its exact canonical row contract; otherwise the database bridge rejects the table before transport and a healthy queue renders empty.

- Never render `Que -> SUSPEND` from a synthetic API dataset that can fail open to an empty result while authorized rows exist; hydrate `ph_active_suspend` directly, retain the prior snapshot, and replay the latest tab refresh when a shared single-flight is busy.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never group Recount by physical UID/lot alone, omit lot metrics from completion delivery, update only one destination-season Open Stock row, add Action columns to the nine-column report, or render Reclass movement as an `UP/DOWN ... TO ...` sub-box instead of the inline frozen-OH subtraction notation.
- Never collapse physical Suspend rows, infer mutation authority from cached UI state, add JD/Sunday as fixed Reclass recipients, or block opening a displayed-card Reclass draft on a background refresh.
- Never treat request age, status text, completion-date text, tombstone presence, or history membership alone as proof that an active Request is fulfilled.
- Never write the legacy master `pick` field without synchronizing canonical `pick_note`, or collapse Request rows that share an item but have distinct location/lot identities.
- Never reject an otherwise authorized Reclass move because mutable On Hand or Available changed after the draft opened; lock the current source, retain stable physical identity checks, auto-create missing destination lots, and rely on command receipts for idempotency.
- Never key Suspend cards by plant/location identity or enforce a global snapshot revision for Reclass; preserve each SOC order-line UID and validate the locked physical source inside the transaction.
- Never build a completed Reclass email/PDF from post-move applied rows; render the SQL-frozen `report_rows` snapshot directly, keep its pre-edit OH/PTRREVIEWED, and append each movement inline in the originating OH cell while excluding app-created destination rows.
- Never derive Reclass Open Stock from `SUM(ptravailable)` or an Available delta; adjust every physical row in the source and destination lots by the exact moved On Hand quantity and preserve the matching CAV/override ledger.
- Never assert Reclass office-keyer reports through the retired action-specific column layout; exercise the canonical nine-column renderer and verify frozen ERP rows/OH, yellow originating-row move callouts, and no app-created destination row.
- Never keep Que's loading skeleton visible while already-authorized Request or Suspend rows are rendered, and never classify a valid Reclass conflict as a generic 400 detail failure.
- Never require a second manual LOC MATCH entry when the exact physical row already has photo plus inventory evidence, and never reject a stale Reclass UID before deterministically resolving its current item/location/lot split identity under the SQL lock.
