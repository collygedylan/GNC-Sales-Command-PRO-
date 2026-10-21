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
- Suspend Tag dataset pages include authenticated server metric enrichment from `ph_master_inventory` with a bounded itemcode/lot fallback and `ph_cav_import` as the final read fallback. Preserve each SOC `unique_id` as the card identity; keep item quantities distinct from location totals (`LOC_ON_HAND` is zero when that physical location has no inventory rows). Client display may use the same fallback only from the current complete account-scoped inventory/CAV snapshot, and must expose each metric value to the runtime parity sensor with `data-queue-metric`.
- Reclass Item Inquiry supports atomic live updates for Move Up, Move Down, Hold/Stop, Priority, Loc PTN1, Loc Note and Sales Note. Preserve payload state, permission checks, deduplication and inflight protection. Open immediately from the displayed card; background refresh cannot replace a user draft.
- Pair each successful Reclass mutation with its durable full GNC PH Reclass Item Inquiry HTML and PDF report handoff. Delivery success is distinct from a queued outbox record; report only the state actually verified.
- Reclass email recipients are strictly the deduplicated set of dylan_collyge, megan_kelly and the submitting user, resolved by the server from active profiles and confirmed email addresses. Under the approved v2.3.17 policy, jd_jones receives reports when he submits; do not add jd_jones or sunday_ellis as fixed or implicit recipients.
- Treat the client's inventory revision as an optional hint. Resolve the current revision inside the atomic server transaction, preserve exact source identity/quantity comparisons and command replay protection, and authorize the current actor on the server. A missing cache freshness proof must not block opening or submitting Reclass.

Test physical-row identity, numeric/natural ordering, lot-specific joins, duplicate submit attempts and exact recipient policy in Node. Validate changed atomic transaction contracts only in an isolated database; preserve production RLS/RBAC. The 100-source atomic batch limit is inclusively 1,000 ms; other interactive queries remain below 100 ms. Update matching fixture routes and this skill with new contracts.

## Owned seams and shared dependencies

- Queue frontend in `assets/app-runtime.js`: `getLatestSocSuspendTagSourceRows`, `getCurrentSuspendTagSourceFreshness`, `compareRequestSuspendTagRows`, `buildSuspendTagRenderPlan`, `createSuspendTagPageRenderRow`, `renderSuspendTagPagedCards`, `renderRequest`, `generateCard`, `getOperationalCardInventoryRow`, `buildQueueInventoryMetricsHtml`, `getQueueCardInventoryAuthorizationContext`. `suspendTagInventory`, raw SOC/Suspend sources, `activeReqTab`, physical source UID, page cache and the master inventory indexes must agree. The render-row factory is lazy: a DOM no-op must not replace a populated page cache with an empty one.
- Reclass frontend: `openArgosInventoryTransactionModal`, `getReadableCachedArgosItemInquiryGroup`, `submitArgosInventoryTransaction`, `applyArgosInventoryTransactionReturnedRow`, `publishArgosInventoryTransactionReturnedRows`; `argosReclassRowEditorEntries` and `argosReclassMultiActionState` own dirty fields, quantities, Hold/Stop and notes. Preserve pending command identity and replay recovery. Publish receipt rows only after coherent indexes; do not rebuild/publish independently per returned row.
- DOM: `#view-request`, `#request-content`, `#argos-inventory-transaction-modal`, `#argos-inventory-transaction-form`, `#argos-reclass-item-inquiry`, `#argos-inventory-transaction-apply`; shared card layout and metrics come from `generateCard` / `assets/queue-inventory-hydration.js`, while `assets/queue-completion-state.js` owns completion display state.
- Backend: `app-api` actions `dataset_read` (including `suspend_tag`), `suspend_tag`, `inventory_reclass_move`, `drive_reclass_inquiry`, `request_queue_remove`; `_shared/suspend-tag.ts`, `_shared/production-workflow.ts`, `services/reclassMove.ts`, `reclassMoves.ts`, `reclassReceipt.ts`, `reclassLiveEdits.ts`, `reclassEditableFields.ts`. Preserve service-only RPCs `suspend_tag_command_v1`, `apply_inventory_reclass_moves_with_delivery_v1`, `enqueue_drive_reclass_inquiry_v7`, their exact-source checks and canonical authorization.
- Report boundary: `ph_request_delivery_outbox` is durable queue state. `Code.gs` `getReclassInquiryEmailRecipients_`, `buildReclassInquiryReportModel_`, `buildReclassInquiryReportHtml_`, `buildReclassInquiryCompactReportHtml_`, `handleSignedReclassInquiryDelivery_`, `handleSignedInventoryReclassMoveDelivery_` resolve/freeze reports and delivery receipts. SQL `private.reclass_delivery_recipients_v1` / `get_reclass_delivery_recipients_v1` remain authoritative: Dylan + Megan + submitting actor, deduplicated; JD is included when JD submits, never silently added as a fixed recipient.
- Shared shell: preserve `switchView`, `showOnlyPrimaryView`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, `viewHistoryStack` and modal-back hooks. Closing a draft modal must not reset navigation or destroy another module's draft.

## Scoped pure Node verification

```sh
node --test tests/reclass-zero-lockout.test.mjs tests/suspend-tag-dataset.test.mjs tests/reclass-recipient-policy.test.mjs
```

Local source/VM fixtures only; target `< 10s`, not a measured result. Select the subset relevant to the changed seam. Actual SQL changes additionally need only their targeted isolated SQL validation under the release governor; browser/full database suites remain nightly. Docs-only overrides take precedence. See canonical module-map cluster 4 for source anchors.
