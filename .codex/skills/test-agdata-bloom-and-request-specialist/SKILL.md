---
name: test-agdata-bloom-and-request-specialist
description: Maintain AgData Bloom selection/actions, Request wizard and durable submission, customer/consignee mapping, historical sales and territory-specific email contracts.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Bloom and requests

Read [the canonical dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) for Cluster 6 and shared Back/navigation ownership.

## Owned implementation boundaries

- `test/assets/app-runtime.js`: `renderBloomPickerTrayRows`, `clearBloomPickerSelection`, `openBloomPickerModal`, `submitBloomPickerOrder`, `openBloomActionRowFormModal`, `submitBloomActionRowForm`, `openBloomEmailPurposeModal`, `sendBloomEmailPurpose`; `openRequestModal`, `selectRepForRequest`, `loadRequestModalCustomerOptionsForRep`, `renderExistingRequestFolderPicker`, `renderRequestQtyStepCurrentItem`, `submitRequestWithQtys`, `finalizeRequestAction`; `renderRequestEmailChainPanel`, `handleRequestEmailChainRecipientChange`, `sendEmailNotification`; `ensureHistoricalRequestsIsland`, `renderSalesHub`, `renderSalesOffice`, `saveSalesOfficeAvNote`.
- `test/assets/request-submission.js`: `AgMetricRequestSubmission.createController`, `resolveCustomerMappingPayload`, `validateAcknowledgment`, conflict reconciliation. `test/assets/app-runtime.js` integration owns `getRequestSubmissionController`, `performRequestSubmission`, `flushRequestOutbox`, `restoreRequestSubmissionForm`; durable IndexedDB records and blobs must retain account + batch identity.
- `test/assets/sales-workspace.js`: `SalesWorkspace.open`, `load`, `stageRefresh`, `applyRefresh`, `back`, `submit`, `review`, `resolveSource`, `amend`. Historical Requests source: `test/components/historical-requests/`, `test/services/historicalRequests.ts` (compiled `test/assets/historical-requests.js`). Mapping services: `test/services/customerRepMapping.ts`, `test/services/customerRepAssignments.ts`, `test/services/requestRecipients.ts`; mapping live events: `test/assets/customer-mapping-live-events.js`.
- Advertisement/Flyer in `test/assets/app-runtime.js`: `renderAdvertisement`, `saveAdvertisementExportToSupabase`, `sendAdvertisementEmail`; preserve canvas/photo/history drafts and marketing bucket + `test_marketing_materials` metadata identity. Reuse the existing purpose/recipient policy rather than creating a separate mail path.
- Backend: `test/supabase/functions/app-api/index.ts` actions `customer-rep-map`, `request_recipient_directory`, `request_history`, `sales_credit`, `season_sales_office`, plus the authorized `db` boundary for Request persistence; `_shared/sales-workflow.ts`. Delivery: `test/supabase/functions/request-delivery-worker/index.ts`, `test/workers/email/Code.gs` `collectRequestRecipients_`, `collectRequestSubmitterEmails_`, `buildRequestEmailMessage_`, `handleSignedRequestDeliveryEvent_`, `processRequestDeliveryOutbox_`.

## Shared dependencies and invariants

- v2.3.95 navigation regression guard: Bloom and Request wizard/modal Back remains higher priority than shared Drive/AV drill and history Back. The inventory Reclass fix adds no Request recipient, mapping, startup-read, or durable submission change.

- Use `switchView`, `canAccessView`, `updateGlobalBackButton`, `goBackUniversal`, modal back handlers and the selection tray's navigation ownership. Preserve `#bloom-picker-tray`, `#bloom-picker-modal`, `#request-rep-modal`, `#view-sales`, `#view-sales-office`, `#historical-requests-content`. The shell skill owns shared header/Back visibility; individual wizard Back handlers retain their current step history.
- Preserve the Selected Rows tray, six inventory metrics, swipe removal and CLEAR BLOOM PICKER; preserve all nine actions: Assign, Eval Work, Submit QC, Request, Location Move, Flyer, Take Back, 2nd Cut, Shear.
- Request MARK DONE photo/spec confirmation must compute the visible plant count from the entered LOC MATCH % and linked master PTR availability even when photo recency qualification is unavailable. Preserve the measured percentage and count in the confirmation summary; strip escaped quote sequences before saving SPEC and AV NOTE text. Background refreshes must not reset active request detail scroll while photo uploads or focused form edits are underway, and custom measurement keyboards close as soon as focus leaves their own input.
- Request sequence remains Sales Rep → Customer → Consignee → Folder → ITEM 1 OF N → email review. Preserve `tempSelectedReqRep`, `tempReqCust`, `tempRequestCustomerSelectedContext`, `tempReqFolder`, per-item quantity/specification drafts, `requestMappingRpcCache`, submission generation and same-account outbox state. Keep selected Rep identity distinct from submitter identity; dictionary results are cached and late mapping reads cannot replace a newer Rep selection.
- Territory filters TX, OK, NE, ADMIN, EVAL, ADV, ALL and CLEAR select recipients; do not redefine authorization. The existing selected recipients and active mapped addresses remain deduplicated.
- **Actual email policies differ:** `test/workers/email/Code.gs` `REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_` / `plant-request-lifecycle-v2` requires Dylan + Kayla + JD for `new_request` and `request_complete`, plus resolved submitter, selected Rep and explicit applicable recipients. Inventory/Bloom purpose reports use `INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_EMAILS_` (Sunday + Sharon + Mitch + JD + Megan) plus actor and selected recipients. Crop updates, approval stages, shift reports and HL tags have separate branches in `collectRequestRecipients_`; preserve them. Do not copy these recipients into the server-authoritative Dylan + Megan + submitter Reclass policy.
- Submission is idempotent and disabled while inflight. Clear selected rows/blobs only after validated acknowledgment; retain failed drafts for retry and require explicit conflict/mapping review. Sales credit evidence retains its private storage and account boundaries.
- Every active mapped Sales Rep gets the protected literal `N/A` / `N/A` tuple. Use stable reserved identity IDs and a deterministic mapping row ID; preserve the tuple in imports and server snapshots. Each rep's Customer picker contains N/A first plus only active Customer/Consignee pairs owned by that canonical rep. Consignee choices must remain scoped to the exact selected rep and customer identity; display names alone never establish ownership.
- Canonical rep matching accepts First Last, Last, First, username, email prefix and external Sales Rep ID aliases. Preserve the actual source `salesrepid` on each selected mapped pair, including multiple source IDs bound to one canonical rep. Keep distinct Customer/Consignee ERP identity IDs even when display names repeat.
- Only the authenticated `jd_jones` actor receives the `AGDATA_EXECUTIVE_ALL` directory, which may combine active Customer Rep Map, SOC, Reserves, active Request and Request History tuples. A selected rep's spelling or role label never grants this scope. Validate the exact selected pair and its source Sales Rep ID at submission; stale universal caches must not paint for any other actor.
- The v2.3.102 `test_request_customer_directory_v23102` contract is selected-rep scoped for ordinary actors and reports universal scope only for authenticated JD. The compatibility mapping view is service-role-only; browser reads remain on authorized authenticated preload paths.
- N/A request mappings do not bypass Sales Rep ownership, selected-rep identity, mapping revision, request idempotency, or the durable outbox acknowledgment rules. Keep N/A names and identities intact in request history and the existing request email delivery path.
- Manager-maintained Customer Assignment rows are separate from imported Customer/Consignee source rows. `customer-rep-map` create/delete must use the revisioned idempotent command and durable override ledger; never modify or delete the protected N/A/N/A tuple, and replay maintained changes after imports.

## Scoped verification

Select the affected files from this pure Node command (target under 10 seconds; **unmeasured by this audit**):

```sh
node --test test/tests/request-submission-durability.test.mjs test/tests/request-mapping-reader.test.mjs test/tests/request-email-optional-qty.test.mjs
```

Use canonical map rows for Bloom metrics and historical-sales source changes. Follow AGENTS daytime limits; do not expand into browsers, Docker or database replay without the applicable authorization.

Request startup uses authenticated customer-rep-map/preload to fetch one complete authorized compact tuple snapshot and pre-index every returned rep. Keep same-account cached tuples usable across revision drift and refresh failures; validate active tuple and rep ownership at submission. Every sales_rep alias binds to self even with global view grants; nonrep actors retain the rep picker. Preserve Bloom location metrics in the Request modal snapshot, and mapped N/A customer/consignee ordering and auto-selection.

## Request completion and foreground continuity

Request detail paints saved photos before hydration, always exposes AV Note, normalizes escaped measurement quotes, and derives entered location match from On Hand. Native test_save_request_work and test_get_request_capabilities dispatch through app-api request_work; completion receipts patch cached master/AV evidence. Pending capability refresh may reuse only a same-account active profile with confirmed Que access; explicit denials and restricted ownership still win. Focused coverage: request-submission-durability.test.mjs.

## Compact Request cards and immediate Reclass delivery

Request/Archived cards display persisted req_qty immediately before itemcode, with creator display/username beneath Sales Rep and legacy creator/rep fallbacks. Metadata spans both thumbnail columns; meaningful notes replace empty caliper/source pills. The six metrics use three columns at narrow widths, matching Suspend. Submission retains canonical quantity and server creator audit fields.

Reclass create/retry immediately invokes the existing leased delivery worker, then reads its receipt. Only server-frozen v7 inquiries may retry an earlier RECLASS_CONFLICT; no inventory mutation is replayed. A timeout retains queued state and never reports delivery without a receipt. Current Dylan/Megan/actor recipient resolution remains authoritative. Focused tests: request-submission-durability and security-zero-trust.

## Immediate authorized Request entry

getRequestEntryCapabilities retains same-account server capabilities while refreshing and derives creation defaults from the verified active profile and canonical Que/AV grants when the capability read is pending. Explicit server denial, inactive profile and account changes still deny entry; server mutation/tuple validation remains authoritative. Request entry and submission never gate on capability age. Non-sales users start with Who requested this; sales_rep retains the locked self/customer path. Location totals use preserveCardLocationOnHand to retain the maximum known same-account item/location sum across partial lots (403/143 cannot fall to 102/81); account/permission changes clear retained display totals.

Queue card taps open Item Detail. Camera file inputs must obey the click-through guard; only a subsequent detail photo-control gesture opens the picker. The Request completion footer stays in flow after inputs and AV options. Focused coverage: request-submission-durability and inventory-drill-navigation.

## Watchdog and active queue continuity

Active Request card quantity accepts qty/request_qty/requested_qty/quantity/order_qty/payload.qty and persisted REQ_QTY/req_qty aliases. Render N/A | N/A as N/A only in card presentation; retain the durable customer mapping payload contract.

## Role-controlled Request Sales Impact

`Request Sales Impact ($)` is a dynamically mounted executive view reached from Historical Requests, Sales, Sales Office, Smart Sales & Move Intelligence and Menu without changing the Home tile grid. `dylan_collyge` is allowed by default; every other account is hidden unless a Manager explicitly selects `Allow view`. `public.test_ph_request_sales_impact_ledger` retains exactly one permanent line per stable request `unique_id`; lifecycle copies may merge only on that exact ID and never by folder, date, item, location, quantity, customer, consignee, or sales rep. The reporting-only effective quantity is exact positive Request Qty or `25` when blank/null/zero, multiplied by resolved List Price without changing source quantity.

`request_sales_impact` resolves the active server profile and calls `test_navigation_module_allowed_v1('request-sales-impact')`; denied accounts receive only `{ ok: true, enabled: false, visible: false, rows: [] }`, and the service-role-only RPC is never exposed to `authenticated`. The client creates entry controls and `#view-request-sales-impact` only when the same-account navigation snapshot allows the view, removes them on account/access change, retains loaded same-account results on transient refresh failure, and exports Summary, Sales Rep, Customer/Consignee and Line Item worksheets.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/app-runtime.js`: `renderBloomPickerTrayRows`, `submitRequestWithQtys`, `forceRefreshRequestsForView`, `buildPendingRequestRenderPlan`, `openRequestSalesImpact`, `renderRequestSalesImpact`; `test/assets/request-submission.js`: durable controller and acknowledgment validation; `test/assets/request-sales-impact.js`: `aggregateRequestSalesImpactLines`, `buildRequestSalesImpactViewModel`, `mountRequestSalesImpact`.
- `test/supabase/functions/app-api/index.ts`: `handleCustomerRepMappingAction`, `handleRequestRecipientDirectory`, `handleDatasetRead`, `handleRequestSalesImpactAction`; SQL: `public.test_ph_active_request`, `public.test_ph_request_history`, `public.test_ph_request_delivery_outbox`, `public.test_ph_request_sales_impact_ledger`, `test_reconcile_active_requests_from_outbox_v1`, and `test_get_request_sales_impact_v2`; `test/workers/email/Code.gs`: `collectRequestRecipients_`, `handleSignedRequestDeliveryEvent_`.

## Cross-Layer Blast Radius

- A Plant Request acknowledgment is server-classified atomically: every submitted line is snapshotted permanently in `test_ph_request_history`, while an unfulfilled line also remains `Pending` in `test_ph_active_request`. Completion requires exactly one of four proofs: completion outbox, historical photo plus spec, current valid master photo/spec evidence, or explicit queue removal. MARK DONE persists the frozen photo/spec/notes and financial snapshot, queues completion delivery, then removes only the active copy.
- Opening Que or REQUEST uses `force_fresh: true`, `cache: 'no-store'`, and the eight-second visible poll; retained UI data and exact server-side tuple validation remain separate.
- Request Sales Impact reads are foreground-only and service-gated. Keep the SQL set-based over the bounded Request sources and small canonical price catalogs; never scan the 8.7M-row DriveAround history or add the action to anonymous/startup fixtures.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `test/workers/email/Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `test_ph_app_users` and `test_user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)
- v2.3.138: Never drop pending submitted IDs on a stale empty refresh or discard row recipient_emails when building the delivery payload. Preserve N/A tuples and explicit completion/archive authority (Invariant 356).

- v2.3.119: Default-rep selection, stale buttons and assistive calls must use resolveRequestRepSelectionForCurrentUser with the same Y/N matrix as the visible picker. Never bypass a per-rep N through automatic selection; Invariant 249 covers the shared validator.

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.test_user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared test_save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.

- v2.3.112: Remove only expression statements proved unreachable after an unconditional return/throw in the same AST block; retain declaration bindings and all reachable public handlers. Strict identifier pruning excludes dynamically referenced names and non-declaration candidates.


- v2.3.112: Never treat source extraction as deletion: test/assets/bloom-runtime-functions.js retains 213 classic global declarations, restored at the original marker for composed tests and release bundling. Preserve all aliases, modal Back, shared header ownership, recipients and mutation identities.

- Never require an existing Inventory Project before Bloom Project can open. The creator captures mapped Sales Rep/customer/consignee, per-row quantity/markings/grader and retains its command UUID across retries. test_create_inventory_project_v1 atomically persists existing project tables, rejects Sales Rep creation and unmapped pairs, and broadcasts a project refresh without email.

- Never give Bloom Picker a lower-resolution photo path or omit canonical photo count/date and saved Spec/Caliper evidence from the selected physical row.

- Never restore a delivery worker by granting browser roles access to private outbox, worker-state, email-thread, completed-history tables or worker RPCs; `test/workers/email/Code.gs` and app-api use the service role while browser history stays on its authorized reader.

- Never block Customer/Consignee selection on a full mapping download or assume a rep button already has `salesrepId`; resolve the selected rep through a bounded direct name query, then load only that rep's rows.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never skip a Que/REQUEST refresh because a client TTL or revision appears current, delete pending requests during import, clear a draft before validated acknowledgment, or duplicate the canonical location sorter.
- Never copy Reclass, Bunch, HL, or inventory-purpose recipient lists into the Plant Request lifecycle contract.
- Never await outbox reconciliation inside `dataset_read`, scan unbounded delivery history, or write the effective quantity fallback into an active Request row. The permanent history/financial snapshot uses positive Request Qty or `25`, while source quantity remains unchanged.
- Never infer completion from age, a terminal-looking status/date alone, or history membership; never delete a pending history snapshot or suppress an active request because the same ID exists in history.
- Never merge different request IDs in sales-impact reporting, bypass the navigation permission gate, or persist the analytics-only default quantity of `25` back to a Request source.
- Never derive `Sales Rep` from `requested_by` before the selected-rep fields or derive `Submitted By` from the selected rep; these are separate durable identities on every request row and delivery payload.
- Never overwrite the submitter with the selected sales rep or omit either address from submitted/completed delivery; greeting and `requested_by` follow the rep while `submitted_by` remains the actor.
- Never require JD to own a Customer Rep Map row before opening Select Customer, collapse his directory to one rep slice, or accept an executive customer tuple without validating its exact identity and names against the bounded app-wide source union.
- Never use exact display-name equality for a Sales Rep directory query or grant app-wide choices based on a selected rep label; only the authenticated jd_jones actor receives app-wide choices, while N/A remains available to every active rep.
- Never reuse the v2.3.94 all-rep Request directory for ordinary actors. Its global union and selected-rep relabeling erased source ownership; filter by canonical ownership and physical Sales Rep ID, invalidate old universal cache scope for non-JD, and expose only N/A plus exact owned pairs.
- Never collapse Customer/Consignee pairs by display name or rewrite an alternate source `salesrepid` to the first canonical alias. Repeated names and multiple source IDs are legitimate; preserve physical identity through option selection and the server-validated submission tuple.
- Never merge Request folder rows into a rep's picker by `REQUESTED_BY` alone. Include only rows whose physical customer/consignee IDs and names resolve to that rep's current active pairs; allow name-only legacy resolution only when unambiguous, exclude stale real-customer/N/A-consignee cache rows, and never add synthetic custom pairs for ordinary reps.
- Never strip `salesrepid` or `consigneeid` while converting raw directory rows into picker options; the final active-pair validator consumes these physical aliases, and canonical rep test_profiles can own multiple distinct source IDs.
- Never register a rep identity from an unvalidated picker label or only from a previously loaded directory index. When a cold name-resolved RPC returns a validated selected-rep ID and exact physical pairs, retain those rows in the local rep directory index before rendering options or existing-folder groups; preserve their source IDs and keep the same pair validation boundary.
- Never discard an owned alternate source Sales Rep row because its source display name has a territory suffix that differs from the selected canonical profile label. Admit an alias pair only when each RPC row's canonical key exactly matches the server-resolved selected profile key, preserve its physical `salesrepid`, and reject mismatching or missing canonical keys; do not infer aliases from similar names.
- Never treat a warm same-account mapping fragment as a complete selected-rep directory. Keep its exact rows visible while the normal picker path refreshes; only skip the scoped RPC when the cached directory has its validated top-level canonical key and every real pair carries that same key.
- Never expose raw storage-photo URLs or one `Photo N` line per image in Bloom Picker Copy/Email output; emit one clickable common-name/size/location gallery deep-link, retain the lot and row metrics, and let the query payload open the swipeable gallery before inventory hydration.
- Never treat a UI retry for creating or deleting a customer mapping as a fresh command: reuse the same request UUID for the same payload, require current expected revision for deletion, and keep N/A as a protected durable mapping across imports.
- Never let an authenticated JD global customer-directory read end at N/A-only when a same-actor permission/identity refresh invalidates the in-flight response; discard stale owner data and retry once under the new owner while rep/account switches still cancel. Synthesized N/A options must carry the active mapping fields consumed by the pair validator.
- Never cap `Who requested this?` at a `Show More` page or merge the whole app-user directory into it. Render every eligible REP/CSR/Admin user plus active mapped Sales Reps immediately, with human-readable names and refreshed role filtering; keep customer/folder option paging independent.
- Never leave `batch-btn-project` visible in Bloom Picker Actions for normalized Sales Rep roles (`Sales Rep`, `sales_rep`, `salesrep`, or `Sales`); Sales Rep actions expose Share and Request only.
- Never use native datalist pickers for Bloom inventory projects or display raw username keys; keep searchable in-app names and mapped customer/consignee ownership validation together.

## Bloom inventory project picker theme

Use searchable in-app dark-emerald pickers for project and destination choices, keep mapped Customer/Consignee ownership validation and canonical submit handlers intact, and center themed confirmation dialogs. Optional inventory fields remain collapsed unless opened by the user.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain AgData Bloom selection/actions, Request wizard and durable submission, customer/consignee mapping, historical sales and territory-specific email contracts.

### Exact ownership
- test/assets/app-runtime.js: renderBloomPickerTrayRows, submitRequestWithQtys, forceRefreshRequestsForView, buildPendingRequestRenderPlan, ensureHistoricalRequestsIsland, openRequestSalesImpact, renderRequestSalesImpact, fetchRequestCustomerMapRows, fetchRequestCustomerMapRowsForRepName, loadRequestModalCustomerOptionsForRep, hasVerifiedRequestRepCanonicalDirectory, scheduleRequestDeliveryWake, isUniversalRequestDirectoryRep, getRequestUniversalCustomerOptions, fetchRequestUniversalCustomerOptions, matchSalesRepIdentity, buildSalesRepCustomerDirectory, selectCustomRequestCustomer, selectCustomRequestConsignee, buildInventoryShareGalleryUrl, formatInventoryItemsText, formatInventoryItemsHtml, dedupeRequestModalRepUsers, addInventoryRowsToProject, updateBloomProjectCustomers, updateBloomProjectConsignees, submitBloomInventoryProject, resolveRequestRepSelectionForCurrentUser.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleCustomerRepMappingAction, handleRequestRecipientDirectory, handleSeasonSalesOfficeAction, handleHistoricalRequestsReadAction, handleRequestSalesImpactAction, dispatchAuthenticatedDeliveryWake, handleInventoryProjects.
- Code.gs: collectRequestRecipients_, handleSignedRequestDeliveryEvent_, processRequestDeliveryOutbox_.
- test/assets/request-sales-impact.js: aggregateRequestSalesImpactLines, buildRequestSalesImpactViewModel, normalizeRequestSalesImpactResponse, mountRequestSalesImpact.
- supabase/migrations/20261024203000_unified_request_sync_sales_impact_v1.sql: get_request_sales_impact_v2, recover_unfulfilled_requests_v1, request_completion_proof_v1, refresh_request_sales_impact_line_v1.
- components/historical-requests/HistoricalRequestsView.tsx: HistoricalRequestsView.
- components/historical-requests/HistoricalArchiveView.tsx: HistoricalArchiveView.
- services/historicalRequests.ts: createHistoricalRequestsBridge, historicalArchiveQuery, parseHistoricalArchivePage.
- supabase/migrations/20261025220000_agdata_v2366_historical_archive.sql: historical_archive_read_v1.
- scripts/fast-historical-archive-import.mjs: runHistoricalArchiveImport.
- supabase/migrations/20261026160000_agdata_v2370_watchdog_and_request_recovery.sql: historical_requests_read_v2370, historical_archive_read_v2370, sync_request_actor_fields_v2370.
- supabase/migrations/20261026200000_agdata_v2374_unified_fast_baseline_suspend_reclass_email.sql: sync_request_actor_fields_v2370.
- supabase/migrations/20261027124800_agdata_v2383_jd_universal_customer_directory.sql: request_jd_customer_directory_v1, is_jd_universal_request_tuple_v1, require_active_customer_mapping_for_request_v1.
- supabase/migrations/20261029131000_agdata_v23102_directory_canonical_keys.sql: request_customer_directory_v23102, salesrepCanonicalKey.
- supabase/migrations/20261029130500_agdata_v23102_legacy_pair_scope.sql: customer_rep_mapping_manage_v1, request_customer_directory_v23102.
- supabase/migrations/20261029130000_agdata_v23102_customer_pair_ownership.sql: request_customer_directory_v23102, customer_rep_catalog_v23102, require_active_customer_mapping_for_request_v1.
- test/assets/bloom-runtime-functions.js: isBloomEmailPurposeReasonRequired, isBloomEmailPurposeRecipientRequired, shouldCollectBloomEmailPurposeRecipientsBeforeAction, getBloomPurposeActionLabel, getBloomPurposeReasonLabel, getBloomPurposeReportTitle, normalizeBloomPurposeRecipientEmail, formatBloomPurposeDisplayName, getBloomPurposeRecipientOptions, getBloomEmailPurposeRecipientFilter, getBloomEmailPurposeSelectedRecipientOptions, syncBloomEmailPurposeRecipientUi, toggleBloomEmailPurposeRecipient, setBloomEmailPurposeRecipientSearch, setBloomEmailPurposeAllRecipients, getGroupedBloomNcrRowKey, getGroupedBloomNcrRowLabel, isGroupedBloomNcrRowSelectionEnabled, getGroupedBloomNcrSelectableRows, getGroupedBloomNcrSelectedRows, syncGroupedBloomNcrRowSelectionUi, toggleGroupedBloomNcrRowSelection, setGroupedBloomNcrAllRowsSelected, getGroupedBloomNcrRowOption, applyGroupedBloomNcrRowOptionsToItem, collectGroupedBloomNcrRowOptions, getGroupedBloomNcrRecipientOptions, getGroupedBloomNcrRecipientFilter, getGroupedBloomNcrSelectedRecipientOptions, getGroupedBloomNcrRequiredRecipientEmails, isGroupedBloomNcrRequiredRecipientEmail, syncGroupedBloomNcrRecipientUi, toggleGroupedBloomNcrRecipient, setGroupedBloomNcrRecipientSearch, setGroupedBloomNcrAllRecipients, closeGroupedBloomNcrRecipientModal, openGroupedBloomNcrRecipientModal, getBloomPurposeRowValue, getBloomPurposeReportQty, getBloomPurposeShearSnapshot, formatBloomPurposeShearPercent, getBloomPurposeReportRow, getBloomPurposeReportColumns, buildBloomPurposeReportTable, closeBloomEmailPurposeModal, getBloomEmailPurposeRowsForShare, getBloomEmailPurposeCoreLine, formatBloomPurposeDocksText, formatBloomPurposeItemsText, buildBloomPurposeEmailSubject, buildBloomPurposeEmailText, buildBloomPurposePayloadItems, buildBloomPurposeReportTableHtml, buildBloomPurposeEmailHtml, getBloomEmailPurposeActionVisibility, syncBloomEmailPurposeActionOptions, syncBloomEmailPurposeModalUi, selectBloomEmailPurpose, openBloomEmailPurposeModal, formatBloomActionRowTimestamp, getBloomActionRowPtrAvailableDefault, getBloomActionRowReleaseQtyDefault, getBloomActionRowMoveUpQtyDefault, getBloomActionMoveSeasonOptions, normalizeBloomActionMoveSeason, getBloomActionMoveLotCode, getBloomActionMoveDownSeasonOptions, normalizeBloomActionMoveDownSeason, getBloomActionMoveDownLotCode, getBloomActionRowMoveDownQtyDefault, getBloomActionRowItemCode, getBloomActionRowExplicitSeasonCode, getBloomActionRowExplicitSalesYearCode, getBloomActionRowIdentityValues, getBloomActionRowSourceLotCode, getBloomActionRowSourceLocationCode, isBloomActionBlankishSourceValue, getBloomActionRowSourceCandidates, getBloomActionRowRawHoldStopCodeValue, getBloomActionRowRawHoldStopReasonValue, getBloomActionRowCurrentHoldStopFromSource, getBloomActionRowCurrentHoldStopReasonFromSource, getBloomActionRowCurrentSeasonItemCodeHoldStop, normalizeOffHoldPriorityRequestValue, getOffHoldPriorityChangeDefaultPriority, getOffHoldPriorityChangeRowKey, buildOffHoldPriorityChangeRowSnapshot, getOffHoldPriorityChangeCandidates, ensureOffHoldPriorityChangeModal, syncOffHoldPriorityChangeModalUi, setOffHoldPriorityChangeRequestedPriority, toggleOffHoldPriorityChangeRow, setOffHoldPriorityChangeRowsSelected, closeOffHoldPriorityChangeModal, openOffHoldPriorityChangeModal, maybeCollectOffHoldPriorityChangeRows, getBloomActionRowCurrentHoldStop, normalizeBloomActionHoldStopCodeChoice, normalizeBloomActionHoldStopReasonValue, getBloomActionRowCurrentHoldStopReason, getBloomActionRowHoldStopDefault, getBloomActionRowReadonlyValue, getBloomActionRowBaseLocationNote, formatBloomActionNcrLocationNoteDate, buildBloomActionNcrLocationNoteLine, buildBloomActionNcrLocationNote, normalizeBloomActionLocationNote, getBloomActionRowDefaultValues, getBloomActionRowStoredValue, ensureBloomActionRowFormDrafts, getBloomActionRowFormCurrentIndex, getBloomActionRowFormDraft, buildBloomActionRowFormCard, syncBloomActionRowFormModalUi, openBloomActionRowFormModal, closeBloomActionRowFormModal, resolveBloomActionRowFormRecipientEmails, getBloomActionRowFormField, getBloomActionRowFormValues, handleBloomActionRowLastFieldKeydown, decorateBloomActionRowFormValuesForDraft, handleBloomActionRowQtyInput, handleBloomActionMoveSeasonChange, handleBloomActionMoveDownSeasonChange, handleBloomActionHoldStopReasonInput, handleBloomActionRowLocationNoteInput, persistCurrentBloomActionRowFormDraft, getBloomActionRowFormValidationError, showBloomActionRowFormValidationError, handleBloomActionRowFormBack, buildBloomActionRowFormPayload, patchBloomActionRowFormRow, buildBloomActionRowFormRowOptions, applyBloomActionRowFormPayloadToLocalRow, persistBloomActionRowFormRows, submitBloomActionNcrRowsToApproval, submitBloomActionHoldReleaseRowsToApproval, getPaperNcrDisplayValue, normalizePaperNcrSalesNoteValue, normalizePaperNcrCompareValue, isPaperNcrValueChanged, normalizePaperNcrChangedFieldDisplayValue, getPaperNcrChangedFieldValue, buildPaperNcrChangedFieldRows, serializePaperNcrChangedFields, getPaperNcrQtyDisplay, getPaperNcrRowKey, getPaperNcrSelectedRowKeys, formatPaperNcrShortDate, formatPaperNcrNoteDateValue, buildPaperNcrDefaultNote, buildPaperNcrRecountLine, isPaperNcrAutoNote, getPaperNcrPrimaryQtyForAction, refreshPaperNcrStateAutoNoteForAction, getPaperNcrPackageIdentity, buildPaperNcrRowSnapshot, getPaperNcrPackageRowsForItem, buildPaperNcrRowState, buildPaperNcrPackageDraft, getPaperNcrPackageActiveCount, getPaperNcrPackageRowDisplay, buildPaperNcrRowActionOptionsHtml, buildPaperNcrHoldStopCodeOptionsHtml, buildPaperNcrMoveDownSeasonOptionsHtml, getPaperNcrSalesNoteInputId, getPaperNcrSalesNoteListId, getPaperNcrSalesNoteOriginalValue, updatePaperNcrSalesNoteHighlight, debouncedFilterPaperNcrSalesNotes, filterPaperNcrSalesNotes, selectPaperNcrSalesNote, persistCurrentPaperNcrPackageDraft, buildPaperNcrPackagePayload, getPaperInquiryReportActionFromBloomAction, shouldUsePaperInquiryReportEmailForAction, buildPaperNcrPackageFromBloomActionRows, getPaperNcrApprovalReviewRowKeys, paperNcrApprovalReviewRowsMatch, getPaperNcrApprovalReviewAnchorIndex, applyPaperNcrActiveRowToState, applyNcrApprovalRowOptionsToPaperState, buildPaperNcrApprovalReviewDraft, buildPaperNcrPackagePayloadWithEditedRows, preparePaperNcrApprovalReviewFinalPackage, approvePaperNcrPackageReviewToOutbox, submitPaperNcrApprovalReviewModal, openNcrApprovalItemInquiryReview, buildPaperNcrPackageModalHtml, syncPaperNcrPackageModalUi, openPaperNcrPackageModal, closePaperNcrPackageModal, handlePaperNcrPackageBack, togglePaperNcrLine, setPaperNcrLineAction, updatePaperNcrLineAutoNote, setPaperNcrPackageAllRows, setPaperNcrPackagePriorityForChecked, validatePaperNcrPackage, submitPaperNcrPackagesToApproval, submitPaperNcrPackageModal, submitBloomActionRowForm, sendBloomPurposeReportEmail, sendPaperInquiryActionReportEmailOnly, sendBloomActionReportEmailOnly, shareBloomPurposeEmail, buildShearListAddedReportRows, sendShearListAddedReportEmail, sendBloomEmailPurpose, toggleBloomShareMenu, getBloomDirectShareSelectionKind, executeBloomDirectShareAction, handleBloomShareMenuSelection.
- DOM: #bloom-picker-tray, #bloom-picker-modal, #request-rep-modal, #view-sales, #view-sales-office, #historical-requests-content
- PostgreSQL: test_ph_request_sales_impact_ledger, test_ph_active_request, test_ph_request_history, test_ph_request_delivery_outbox, test_ph_app_users, test_user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-bloom-and-request-specialist, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-bloom-and-request-specialist.

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
