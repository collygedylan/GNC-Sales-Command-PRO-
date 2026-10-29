---
name: agdata-sync-and-supabase-architect
description: Maintain AgData Home sync status, Drive file freshness, RUN SCRIPT, snapshot imports and Supabase publication while preserving live data and paused backfills.
---

# Sync and Supabase architecture

Home imported-file cards start expanded only for Dylan, Megan and JD. Empty folder checks return before opening Processed folders or acquiring publication fences; source names and actual import timestamps survive polling. Warehouse assignments are now exported from Supabase, so a sheet export timestamp must never be presented as a new import.

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 8 and shared Back/navigation ownership.

- Home DRIVE, SOC, RESERVES and CAV status cards display the single active/latest filename for each source.
- RUN SCRIPT must detect unchanged Google Drive source metadata and return UP_TO_DATE on the fast path, targeting less than 500 ms. Ignore TEMP_* and ~$* files before choosing a source; temporary Warehouse Assigned Items exports cannot stall the stage.
- Use chunked set-based upserts with a 120s statement timeout for bulk work. This timeout is not an interactive-query allowance: ordinary interactive queries remain below 100 ms and the atomic 100-source Reclass batch remains at or below 1,000 ms.
- Use one bounded retry for a transient stage failure, then continue unrelated eligible stages without blocking the UI. Preserve resumable progress, protected live fields, idempotent retries and atomic snapshot publication.
- Reads continue from the latest completed READY snapshot while new staging is running, queued, timed out or interrupted. Never leave production datasets marked INTERRUPTED as test residue.
- A valid `get_my_dataset_revisions_v1` response establishes that the authenticated client is connected to the revision service. Publish that connection state before adapter hydration completes, then continue snapshot hydration in the background; connection status alone is never current row proof or write authorization.
- Merge header connection states by source key within the same authenticated owner. A narrow Drive revision response updates its sources without replacing Home's broader readiness summary; account/session and confirmed permission resets clear the summary.
- Keep historical backfill paused when instructed. When separately authorized to run, enforce 23:30 inclusive to 06:15 exclusive America/Chicago in both scheduler and worker, including daylight-saving transitions. Never enable the paused 15-minute automation as part of routine sync work.

Use Supabase MCP for read-only schema/contract/log inspection and validated production migrations. Keep credentials in environment/secret stores. Test destructive SQL, trigger faults and rollback behavior in disposable local databases. Use the repository's PostgreSQL 17/Supabase harness for full compatibility; a PostgreSQL 15 lightweight sandbox is not equivalent. No live fault injection is authorized by this skill.

The zero-trust RLS migration enables RLS on public base tables and revokes anonymous/PUBLIC table and column mutation grants plus volatile/definer RPC execution. Preserve existing authenticated/service-role privileges explicitly before removing inherited PUBLIC grants; signed Code.gs imports continue with the server credential. Do not test this by mutating production rows.

All browser Apps Script POSTs use the verified app-api gateway. `Code.gs` authorizes a short-lived signed envelope before dispatch and retains the action-specific server checks. Deployment health uses a separately signed, read-only system envelope. The existing Home `manual_status` background read is registered with its exact nested gateway shape in `tests/helpers/release-smoke-route-policy.mjs`; unknown gateway mutations must not receive fixture success.

Apps Script accepts the current `AGDATA_ACTION_SIGNING_KEY_V1` property and legacy `SUPABASE_KEY` as action HMAC keys. A new key can be stored only through an explicitly marked, exact deployment-health system envelope: its HMAC must validate under the candidate key and the same key must pass Supabase Auth Admin `GET /auth/v1/admin/users` before the property is written. This is an Apps Script deployment-health probe only, never a UI/background fixture read; invalid keys and all non-health commands leave properties untouched.

Measure new, changed, unchanged and retried snapshots when importer behavior changes. Register new RPC/background reads in the fixture allowlist and update this skill in the same commit.

## Owned seams and shared dependencies

- Home frontend in `assets/app-runtime.js`: `runGoogleAppsScriptTrigger`, `refreshDashboardSyncMetadata`, `updateDashboardSyncSummary`, `selectDashboardSyncFilename`; `#run-google-script-btn`, `#view-home`. Runtime synchronization uses `getProductionLiveSyncCoordinator`, `getProductionLiveSyncContext`, `withProductionLiveSyncSignal`, `scheduleProductionLiveSyncRender` and `processAndLoadData`.
- `assets/live-sync-registry.js` owns module/source declarations and `getViewAdapters` / `getSourceKeys`; `assets/live-sync-adapters.js` owns `create` and synchronous stage/commit publication; `assets/live-sync-coordinator.js` owns generation/source gates, permissions, retained display and cancellation. `assets/bounded-snapshot-cache.js` owns chunked IndexedDB writes. Preserve `productionLiveSyncReadAuthEpoch`, source signatures, scoped dataset state, `fullInventory` and master indexes across each atomic publication.
- `Code.gs` owns `getManualSyncStageOrder_`, `queueManualSyncRequest_`, `runQueuedManualSyncStage_`, `saveManualSyncStatus_`, `beginDatasetImportFence_`, `heartbeatDatasetImportFence_`, `closeDatasetImportFence_`, `failDatasetImportFence_`, `buildMasterBulkSnapshotPayload_`, `callMasterBulkSnapshotImport_`, `processSiteSplitMasterSnapshotBatchFolder_`, `buildMasterPayload`, `buildStandardPayload`, `buildCavPayload`. Treat the 500-row stage chunks, source digest, immutable source identity and resumable cursor as one contract; don't substitute ordinary upsert semantics for canonical master publication.
- Supabase contracts: `begin_dataset_import_v1`, import heartbeat/finish/failure RPCs, `begin_master_snapshot_stage_v1`, `append_master_snapshot_stage_chunk_v1`, `finalize_master_snapshot_stage_v1`, `app_dataset_revisions`, private import leases/runs/stage rows, source baselines and field protection triggers. Published read proof distinguishes retained READY data from authorization to mutate. Changing a projection also touches `app-api` `inventory_read` / `dataset_read` and `_shared/inventory-projections.ts`.
- Shared shell: sync completion routes through existing deferred render/invalidation and `switchView` / `showOnlyPrimaryView`; it must preserve `viewHistoryStack`, `goBackUniversal`, `updateGlobalBackButton`, current detail state and modal drafts. Data readiness is not navigation authorization. Never toggle paused backfill/15-minute triggers as an incidental fix.

## Scoped pure Node verification

```sh
node --test tests/master-snapshot-chunk-import.test.mjs tests/live-sync-registry-coverage.test.mjs tests/apps-script-sync.test.mjs
```

These use local source/VM or injected transport fixtures without a database, browser or deployment. Target `< 10s`, unmeasured until run; choose only the relevant subset. SQL/RPC changes require targeted isolated SQL checks, never automatic full migration replay. Docs-only task overrides take precedence. See canonical module-map cluster 8 for source anchors and cross-module contracts.

Home source filename drawer and toggle are restricted to the authenticated Dylan/Megan/JD trio. The existing historical backfill and 15-minute trigger remain paused.

Master startup hydration begins from Home for every authorized inventory role, with bounded four-way 1,000-row pages. Customer/consignee choices use the compact authenticated preload endpoint instead of duplicated raw-table and per-rep paging. Keep historical backfill and its 15-minute trigger paused under the current release instruction.

## Request completion and foreground continuity

MANUAL_SYNC_STAGE_ORDER_DEFAULT starts drive, soc, reserves, cav. Master stage and history chunks support 2,000 rows; unfinished 500-row checkpoints remain resumable without staging-table alteration. Deferred runQueuedRequestIntegrityMaintenance_ waits until core sync is inactive. publishManualSyncStatus_ writes the service-only app_manual_sync_status singleton with an eight-second same-stage throttle; clients read app-api manual_sync_status every ten seconds. Historical backfills and their fifteen-minute trigger remain paused. These settings are not measured production timing guarantees. Focused coverage: live-sync-coordinator.test.mjs.

## Performance and retry guard (v2.3.34)

Application revision conflicts use SQLSTATE PT409 (HTTP 409); never raise 40001 for an application conflict, because PostgREST can retry it internally. Real PostgreSQL serialization failures retain 40001. The atomic application_conflict_retry_guard migration preserves security, grants and bounded catch behavior; operational_lookup_indexes uses audited physical columns and existing index prefixes. The 500/2,000-row staging constraint preserves resumable older imports. Historical archive backfills and the 15-minute trigger remain PAUSED.

The foreground coordinator owns a 30-second idle / 10-second active-sync heartbeat; hidden contexts cancel network polling and watchdog delivery retains its queue until visible. SOC/CAV/Reserves dataset_read pages accept optional numeric ifRevision, returning up_to_date only after actor, permission and query validation against a READY revision. Page caches are bounded and fenced by read identity and permission version. Queue metric joins group master/CAV once by item. Browser table mutations use authenticated app-api without direct PostgREST fallback; intentional native reads retain existing SELECT policies.

rebuildMasterInventoryIndexes installs the shared queue inventory index with byItemLocLot, byItemLoc (summed locOnHand and rows), byItem and normalizedSearchText. Search normalization and CAV fallback indexing happen once per snapshot. Exact mutation identity/ambiguity checks remain separate from display fallbacks. Shared switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack, header/search ownership and same-account cached displays remain governing dependencies. Focused regressions: live-sync-coordinator, inventory-drill-navigation, security-zero-trust; no browser timing claim follows from Node measurements.

Both staging header expected_chunks and chunk-ledger row_count constraints must match the 2,000-row append contract; retain 500-row receipts and never clear resumable state to change capacity.

## Durable Drive import reconciliation

The private inventory_live_overrides_v1 audit records per-physical-UID ERP baselines, app values, actor/time, latest ERP values and acknowledgement. Only matching fenced raw ERP values acknowledge a pending field; arbitrary ERP drift and auxiliary CAV writes preserve it. Later ERP changes apply after acknowledgement. Existing priority/Item6 guards remain; unprotected ERP sibling consolidation retains the new physical UID while protected ambiguity still fails. Missing source rows retain pending edits. New startup reads are not introduced.

runRoutedDropImport_ selects one newest live source and archives older unchanged file identities only after successful publication, using the published watermark for archival retry. Historical backfills remain paused. Shared switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack and header/search ownership remain dependencies. Focused checks: request-submission-durability and security-zero-trust.

Pending Reclass season stock overrides protect master s_lts/season_oh and ph_cav_import Open Stock/Season OH until matching fenced ERP evidence and CAV acknowledgement. Imports retain new physical siblings and pending season CAV rows. Historical backfill and its 15-minute trigger remain paused.

## Desktop shell recovery

Home renders stable DRIVE/CAV/RESERVES/SOC filename cards even when only one metadata read has completed. Missing metadata has an honest pending label; keep one latest filename per source. The authorized admin trio retains RUN SCRIPT, Print, and native keyboard-accessible disclosure with a styled chevron. Desktop connection status is visible during idle and background imports. No read route, mutation permission, import schedule or paused historical trigger changes.

## Watchdog and active queue continuity

Home filename summaries persist under gnc_sync_filenames_v1 scoped by profile ID, username and permission version; restore them synchronously before background metadata refresh. Dark Home summary/cards/buttons use #062115 and light text. Footer queue adapters include actor-scoped Location Work and Bunch queue reads; none may gate the visible active queue. Historical backfills and the 15-minute historical trigger remain PAUSED.

Home metadata reads isolate DRIVE, SOC, RESERVES and CAV failures per source and retain already rendered same-account filenames. Que reads try `ph_request_queue_live_rows`, then `ph_active_request_live_rows`, then retained active rows; a single PostgREST warning must not abort startup or zero unrelated queue tabs. Security-invoker queue views retain RLS and require the authenticated table privilege on joined `ph_master_inventory`.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `runGoogleAppsScriptTrigger`, `refreshDashboardSyncMetadata`, `selectDashboardSyncFilename`; `supabase/functions/app-api/index.ts`: `handleDatasetRevisionsAction`, `handleAppsScriptAction`; `Code.gs`: `getManualSyncStageOrder_`, `queueManualSyncRequest_`, `runQueuedManualSyncStage_`, `moveAndNormalizeDriveAroundProcessedFiles_`.
- SQL publication fences/revisions and every public view are governed contracts; the latest migration must enforce `security_invoker = true`, and every `SET LOCAL` must remain inside a transaction.

## Cross-Layer Blast Radius

- Manual RUN SCRIPT sends `force: true`, clears/overrides a stale sync lock, runs DRIVE -> SOC -> RESERVES -> CAV, archives successfully published `.xlsx` inputs into Processed, and immediately preserves one latest Home filename per source from cached/bootstrap state.
- Import changes cross Drive metadata, Apps Script scheduling/fences, SQL staging/revisions, app-api readiness, client SWR, and watchdog status. Historical backfill and its 15-minute trigger remain PAUSED.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- Never collapse a physical Drive alias by UID or stable hash alone. Require exact full lineage, committed raw-stage source hash, one protected canonical row, no independent pending commands, and a locked revalidation of both rows and edit ledgers; audit full provenance and remap source-only evidence before deleting the alias.

- Never key a processed-file toast by dataset revision or import poll time; deduplicate by dataset plus immutable source filename and available Drive modified/hash identity so unrelated revision bumps cannot repeat Dylan's toast.
- Never require pending designation edits before resolving an incoming row by a unique stable physical identity, and never insert a mapped synthetic Drive UID as a second master row; preserve the source UID as import provenance while writing through the canonical physical-row identity.

- Never resolve equal-timestamp Home filename metadata lexically when the dataset revision advanced; carry the revision into the summary and let the higher authoritative revision repaint the existing source card in place.
- Never let generated database contracts lag live read-only columns; exact-field validation must include published CAV fields such as `open_stock` and `season_oh` before live revision refresh can hot-swap that dataset.

- Never let a successful full Drive import erase a pending app-created Reclass destination row or its evidence/season-stock overrides; preserve the canonical pending ledgers through atomic publication.

- Never assume row-level master inventory triggers reconcile pending per-field overrides during bulk publication; the canonical wrapper disables USER triggers, so apply pending edits set-wise against fenced raw Drive fields before publication and retain missing pending rows.

- Never collapse a structured master-bulk or SQLSTATE failure into `MANUAL_SYNC_STAGE_FAILED`; retain the bounded code without exposing database details or source rows.

- Never send a complete Drive snapshot through a per-row-triggered Apps Script publication; use trigger-suppressed fast ingest, retaining resumable staging as the failure-recovery path.

- Never give the outer Drive fast-ingest RPC a shorter timeout than the measured guarded master snapshot publication, and never exclude Drive from resumable Excel extraction checkpoints.

- Never retain orphaned `TEMP_IMPORT_*` or `~$*` files during live drop-folder scans, and never run per-row historical dedup locks while publishing a complete Drive archive snapshot.

- Never let Apps Script import or delivery code fall back to an anon/publishable Supabase key; reconcile and store a validated service-role secret instead of widening browser-role mutations.
- Never route recurring ERP drops through a table-truncating generic swap or re-import Warehouse Assigned Items from Drive; stage 1,000-row batches in private storage, commit through the canonical protected importer, and keep assignments authoritative in Managers.
- Never leave USER triggers disabled after a bulk ingest exception; every trigger-suppressed wrapper must restore them before returning or rethrowing.
- Never leave a successful fast-stage Excel extraction checkpoint or converted `TEMP_IMPORT_*` sheet behind; consume the matching checkpoint after confirmed commit and before archiving the source.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never answer a forced manual run with `The import processor is finishing its current work.`, acquire a fence for an unchanged file, leave a published `.xlsx` in Drop, show multiple stale filenames, create a public definer view, or execute `SET LOCAL` outside `BEGIN`/`COMMIT`.
- Never let one startup dataset rejection cancel sibling metadata/queue reads, and never grant a security-invoker view without the matching RLS-protected underlying-table privilege.
- Never short-circuit a forced Home RUN SCRIPT through the fast-ingest file-check RPC; dispatch DRIVE, SOC, RESERVES, and CAV through the authenticated `apps_script_action` gateway.
- Never run or enable historical backfill outside 23:30–06:15 America/Chicago or while explicitly paused.
- Never label a full-row Manager surface as paged in the live-sync context; its coordinator cohort must match the renderer's actual canonical source reads or `DATASET_KEYS_INVALID` can suppress the view.
- Never place private-schema names in app-api dataset-revision requests; mirror private low-stock changes onto the public `ph_eval_report_settings` revision and subscribe to that key so freshness remains observable without invalid requests.
- Never treat a healthy Realtime socket or login-time snapshot as sufficient freshness: retain the 15-second no-store revision poll, focus/visibility wakeups, and revision-fenced background adapters for DRIVE, CAV, RESERVES, SOC, and HL Order.
- Never filter SOC XLSX open orders by only the literal `dock` header; normalize `dock`, `docknumber`, and `tripnumber` aliases before counting, paging, and staging so valid dock rows remain regardless of Suspend status, while retaining the existing Suspend-DC exception.
