---
name: agdata-bloom-and-request-specialist
description: Maintain AgData Bloom selection/actions, Request wizard and durable submission, customer/consignee mapping, historical sales and territory-specific email contracts.
---

# Bloom and requests

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 6 and shared Back/navigation ownership.

## Owned implementation boundaries

- `assets/app-runtime.js`: `renderBloomPickerTrayRows`, `clearBloomPickerSelection`, `openBloomPickerModal`, `submitBloomPickerOrder`, `openBloomActionRowFormModal`, `submitBloomActionRowForm`, `openBloomEmailPurposeModal`, `sendBloomEmailPurpose`; `openRequestModal`, `selectRepForRequest`, `loadRequestModalCustomerOptionsForRep`, `renderExistingRequestFolderPicker`, `renderRequestQtyStepCurrentItem`, `submitRequestWithQtys`, `finalizeRequestAction`; `renderRequestEmailChainPanel`, `handleRequestEmailChainRecipientChange`, `sendEmailNotification`; `ensureHistoricalRequestsIsland`, `renderSalesHub`, `renderSalesOffice`, `saveSalesOfficeAvNote`.
- `assets/request-submission.js`: `AgMetricRequestSubmission.createController`, `resolveCustomerMappingPayload`, `validateAcknowledgment`, conflict reconciliation. `assets/app-runtime.js` integration owns `getRequestSubmissionController`, `performRequestSubmission`, `flushRequestOutbox`, `restoreRequestSubmissionForm`; durable IndexedDB records and blobs must retain account + batch identity.
- `assets/sales-workspace.js`: `SalesWorkspace.open`, `load`, `stageRefresh`, `applyRefresh`, `back`, `submit`, `review`, `resolveSource`, `amend`. Historical Requests source: `components/historical-requests/`, `services/historicalRequests.ts` (compiled `assets/historical-requests.js`). Mapping services: `services/customerRepMapping.ts`, `services/customerRepAssignments.ts`, `services/requestRecipients.ts`; mapping live events: `assets/customer-mapping-live-events.js`.
- Advertisement/Flyer in `assets/app-runtime.js`: `renderAdvertisement`, `saveAdvertisementExportToSupabase`, `sendAdvertisementEmail`; preserve canvas/photo/history drafts and marketing bucket + `marketing_materials` metadata identity. Reuse the existing purpose/recipient policy rather than creating a separate mail path.
- Backend: `supabase/functions/app-api/index.ts` actions `customer-rep-map`, `request_recipient_directory`, `request_history`, `sales_credit`, `season_sales_office`, plus the authorized `db` boundary for Request persistence; `_shared/sales-workflow.ts`. Delivery: `supabase/functions/request-delivery-worker/index.ts`, `Code.gs` `collectRequestRecipients_`, `collectRequestSubmitterEmails_`, `buildRequestEmailMessage_`, `handleSignedRequestDeliveryEvent_`, `processRequestDeliveryOutbox_`.

## Shared dependencies and invariants

- Use `switchView`, `canAccessView`, `updateGlobalBackButton`, `goBackUniversal`, modal back handlers and the selection tray's navigation ownership. Preserve `#bloom-picker-tray`, `#bloom-picker-modal`, `#request-rep-modal`, `#view-sales`, `#view-sales-office`, `#historical-requests-content`. The shell skill owns shared header/Back visibility; individual wizard Back handlers retain their current step history.
- Preserve the Selected Rows tray, six inventory metrics, swipe removal and CLEAR BLOOM PICKER; preserve all nine actions: Assign, Eval Work, Submit QC, Request, Location Move, Flyer, Take Back, 2nd Cut, Shear.
- Request MARK DONE photo/spec confirmation must compute the visible plant count from the entered LOC MATCH % and linked master PTR availability even when photo recency qualification is unavailable. Preserve the measured percentage and count in the confirmation summary; strip escaped quote sequences before saving SPEC and AV NOTE text. Background refreshes must not reset active request detail scroll while photo uploads or focused form edits are underway, and custom measurement keyboards close as soon as focus leaves their own input.
- Request sequence remains Sales Rep → Customer → Consignee → Folder → ITEM 1 OF N → email review. Preserve `tempSelectedReqRep`, `tempReqCust`, `tempRequestCustomerSelectedContext`, `tempReqFolder`, per-item quantity/specification drafts, `requestMappingRpcCache`, submission generation and same-account outbox state. Keep selected Rep identity distinct from submitter identity; dictionary results are cached and late mapping reads cannot replace a newer Rep selection.
- Territory filters TX, OK, NE, ADMIN, EVAL, ADV, ALL and CLEAR select recipients; do not redefine authorization. The existing selected recipients and active mapped addresses remain deduplicated.
- **Actual email policies differ:** `Code.gs` `REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_` / `plant-request-lifecycle-v2` requires Dylan + Kayla + JD for `new_request` and `request_complete`, plus resolved submitter, selected Rep and explicit applicable recipients. Inventory/Bloom purpose reports use `INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_EMAILS_` (Sunday + Sharon + Mitch + JD + Megan) plus actor and selected recipients. Crop updates, approval stages, shift reports and HL tags have separate branches in `collectRequestRecipients_`; preserve them. Do not copy these recipients into the server-authoritative Dylan + Megan + submitter Reclass policy.
- Submission is idempotent and disabled while inflight. Clear selected rows/blobs only after validated acknowledgment; retain failed drafts for retry and require explicit conflict/mapping review. Sales credit evidence retains its private storage and account boundaries.
- Every active mapped Sales Rep must have a protected active Customer/Consignee mapping for the literal `N/A` / `N/A` pair. Use stable reserved identity IDs and a deterministic mapping row ID; include the row in each complete customer map snapshot and preserve it in the import finalizer. The Customer and Consignee pickers pin the mapped N/A option first, and request submission must continue validating the selected tuple against the complete server-authorized mapping list.
- N/A request mappings do not bypass Sales Rep ownership, selected-rep identity, mapping revision, request idempotency, or the durable outbox acknowledgment rules. Keep N/A names and identities intact in request history and the existing request email delivery path.

## Scoped verification

Select the affected files from this pure Node command (target under 10 seconds; **unmeasured by this audit**):

```sh
node --test tests/request-submission-durability.test.mjs tests/request-mapping-reader.test.mjs tests/request-email-optional-qty.test.mjs
```

Use canonical map rows for Bloom metrics and historical-sales source changes. Follow AGENTS daytime limits; do not expand into browsers, Docker or database replay without the applicable authorization.

Request startup uses authenticated customer-rep-map/preload to fetch one complete authorized compact tuple snapshot and pre-index every returned rep. Keep same-account cached tuples usable across revision drift and refresh failures; validate active tuple and rep ownership at submission. Every sales_rep alias binds to self even with global view grants; nonrep actors retain the rep picker. Preserve Bloom location metrics in the Request modal snapshot, and mapped N/A customer/consignee ordering and auto-selection.

## Request completion and foreground continuity

Request detail paints saved photos before hydration, always exposes AV Note, normalizes escaped measurement quotes, and derives entered location match from On Hand. Native save_request_work and get_request_capabilities dispatch through app-api request_work; completion receipts patch cached master/AV evidence. Pending capability refresh may reuse only a same-account active profile with confirmed Que access; explicit denials and restricted ownership still win. Focused coverage: request-submission-durability.test.mjs.

## Compact Request cards and immediate Reclass delivery

Request/Archived cards display persisted req_qty immediately before itemcode, with creator display/username beneath Sales Rep and legacy creator/rep fallbacks. Metadata spans both thumbnail columns; meaningful notes replace empty caliper/source pills. The six metrics use three columns at narrow widths, matching Suspend. Submission retains canonical quantity and server creator audit fields.

Reclass create/retry immediately invokes the existing leased delivery worker, then reads its receipt. Only server-frozen v7 inquiries may retry an earlier RECLASS_CONFLICT; no inventory mutation is replayed. A timeout retains queued state and never reports delivery without a receipt. Current Dylan/Megan/actor recipient resolution remains authoritative. Focused tests: request-submission-durability and security-zero-trust.
