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
