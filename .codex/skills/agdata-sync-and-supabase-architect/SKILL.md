---
name: agdata-sync-and-supabase-architect
description: Maintain AgData Home sync status, Drive file freshness, RUN SCRIPT, snapshot imports and Supabase publication while preserving live data and incremental history.
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
- Cloud RUN SCRIPT incrementally refreshes history at any time through Drive REST -> app-api -> Postgres. The v2.3.105 request removes the previous America/Chicago overnight-only/paused rule; keep immutable completed versions and resumable cursors. Honor future explicit pauses and preserve Apps Script delivery/email workers.

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

Home source filename drawer and toggle are restricted to the authenticated Dylan/Megan/JD trio. History continuation belongs to the cloud RUN SCRIPT stage.

Master startup hydration begins from Home for every authorized inventory role, with a progressive first page and at most eight concurrent pages sized to the live PostgREST cap. Customer/consignee choices use the compact authenticated preload endpoint instead of duplicated raw-table and per-rep paging. Use the resumable cloud history stage for current RUN SCRIPT imports.

## Request completion and foreground continuity

MANUAL_SYNC_STAGE_ORDER_DEFAULT starts drive, soc, reserves, cav. Master stage and history chunks support 2,000 rows; unfinished 500-row checkpoints remain resumable without staging-table alteration. Deferred runQueuedRequestIntegrityMaintenance_ waits until core sync is inactive. publishManualSyncStatus_ writes the service-only app_manual_sync_status singleton with an eight-second same-stage throttle; clients read app-api manual_sync_status every ten seconds. Cloud history runs incrementally after live source publication. These settings are not measured production timing guarantees. Focused coverage: live-sync-coordinator.test.mjs.

## Performance and retry guard (v2.3.34)

Application revision conflicts use SQLSTATE PT409 (HTTP 409); never raise 40001 for an application conflict, because PostgREST can retry it internally. Real PostgreSQL serialization failures retain 40001. The atomic application_conflict_retry_guard migration preserves security, grants and bounded catch behavior; operational_lookup_indexes uses audited physical columns and existing index prefixes. The 500/2,000-row staging constraint preserves resumable older imports. Cloud history runs incrementally after live source publication.

The foreground coordinator owns a 30-second idle / 10-second active-sync heartbeat; hidden contexts cancel network polling and watchdog delivery retains its queue until visible. SOC/CAV/Reserves dataset_read pages accept optional numeric ifRevision, returning up_to_date only after actor, permission and query validation against a READY revision. Page caches are bounded and fenced by read identity and permission version. Queue metric joins group master/CAV once by item. Browser table mutations use authenticated app-api without direct PostgREST fallback; intentional native reads retain existing SELECT policies.

rebuildMasterInventoryIndexes installs the shared queue inventory index with byItemLocLot, byItemLoc (summed locOnHand and rows), byItem and normalizedSearchText. Search normalization and CAV fallback indexing happen once per snapshot. Exact mutation identity/ambiguity checks remain separate from display fallbacks. Shared switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack, header/search ownership and same-account cached displays remain governing dependencies. Focused regressions: live-sync-coordinator, inventory-drill-navigation, security-zero-trust; no browser timing claim follows from Node measurements.

Both staging header expected_chunks and chunk-ledger row_count constraints must match the 2,000-row append contract; retain 500-row receipts and never clear resumable state to change capacity.

## Durable Drive import reconciliation

The private inventory_live_overrides_v1 audit records per-physical-UID ERP baselines, app values, actor/time, latest ERP values and acknowledgement. Only matching fenced raw ERP values acknowledge a pending field; arbitrary ERP drift and auxiliary CAV writes preserve it. Later ERP changes apply after acknowledgement. Existing priority/Item6 guards remain; unprotected ERP sibling consolidation retains the new physical UID while protected ambiguity still fails. Missing source rows retain pending edits. New startup reads are not introduced.

runRoutedDropImport_ selects one newest live source and archives older unchanged file identities only after successful publication, using the published watermark for archival retry. Cloud history runs incrementally after live source publication. Shared switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack and header/search ownership remain dependencies. Focused checks: request-submission-durability and security-zero-trust.

Pending Reclass season stock overrides protect master s_lts/season_oh and ph_cav_import Open Stock/Season OH until matching fenced ERP evidence and CAV acknowledgement. Imports retain new physical siblings and pending season CAV rows. Cloud history runs incrementally after live source publication.

## Desktop shell recovery

Home renders stable DRIVE/CAV/RESERVES/SOC filename cards even when only one metadata read has completed. Missing metadata has an honest pending label; keep one latest filename per source. The authorized admin trio retains RUN SCRIPT, Print, and native keyboard-accessible disclosure with a styled chevron. Desktop connection status is visible during idle and background imports. No read route, mutation permission, import schedule or paused historical trigger changes.

## Watchdog and active queue continuity

Home filename summaries persist under gnc_sync_filenames_v1 scoped by profile ID, username and permission version; restore them synchronously before background metadata refresh. Dark Home summary/cards/buttons use #062115 and light text. Footer queue adapters include actor-scoped Location Work and Bunch queue reads; none may gate the visible active queue. Cloud history runs incrementally after live source publication.

Home metadata reads isolate DRIVE, SOC, RESERVES and CAV failures per source and retain already rendered same-account filenames. Que reads try `ph_request_queue_live_rows`, then `ph_active_request_live_rows`, then retained active rows; a single PostgREST warning must not abort startup or zero unrelated queue tabs. Security-invoker queue views retain RLS and require the authenticated table privilege on joined `ph_master_inventory`.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `runGoogleAppsScriptTrigger`, `refreshDashboardSyncMetadata`, `selectDashboardSyncFilename`; `supabase/functions/app-api/index.ts`: `handleDatasetRevisionsAction`, `handleAppsScriptAction`; `Code.gs`: `getManualSyncStageOrder_`, `queueManualSyncRequest_`, `runQueuedManualSyncStage_`, `moveAndNormalizeDriveAroundProcessedFiles_`.
- SQL publication fences/revisions and every public view are governed contracts; the latest migration must enforce `security_invoker = true`, and every `SET LOCAL` must remain inside a transaction.

## Cross-Layer Blast Radius

- Manual RUN SCRIPT sends `force: true`, clears/overrides a stale sync lock, runs DRIVE -> SOC -> RESERVES -> CAV, archives successfully published `.xlsx` inputs into Processed, and immediately preserves one latest Home filename per source from cached/bootstrap state.
- Import changes cross Drive metadata, Apps Script scheduling/fences, SQL staging/revisions, app-api readiness, client SWR, and watchdog status. Cloud history runs incrementally after live source publication.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)
- Never let an empty hl_po summary hide active hl_po_parsed progress. Prefer the real stage alias and read its canonical hl_po_parsed revision key; preserve missing filenames honestly when no source receipt exists (Invariant 234).
- Never yield an ERP continuation solely because network/status preflight consumed a wall-clock budget. Each admitted worker must advance one bounded file chunk or a stage before yielding (Invariant 232); workbook buffers and chunk limits remain bounded.
- Never require ITEMCODE for the printed CAV ReportLayout. Its Item # header maps through the canonical item/product/size/season/availability aliases, and merged quality/category headings with no product description are excluded without dropping valid zero-availability items (Invariant 233).
- Never treat the forty-hop HTTP envelope as guaranteed whole-job completion. The private minute recovery wake resumes only accepted active jobs with expired leases and stale heartbeats, using the existing server-only service-role key; anonymous and authenticated callers cannot execute it. Invariant 231 preserves that authorization and the unchanged forty-hop ceiling. Server-only recovery must reach the guarded internal continuation route; browser continuations must retain native-session authorization.
- Never assume valid OOXML uses unprefixed spreadsheet elements. Preserve worksheet relationships and shared-string/cell values for `x:sheet`, `x:row`, `x:c`, and other namespace-qualified elements in both canonical full and bounded streaming readers; Invariant 230 covers the CAV ReportLayout format.
- Never renew a four-second ERP request lease on a four-second timer: a healthy publisher can lose ownership exactly at expiry, overlap stage commits, and fail on database locks. Renew every second; Invariant 229 must retain ownership through a slow atomic publication and stop the timer at completion.

- v2.3.116: Never apply a prior file's completed receipt or published row count to the next pending filename. Bind staged deltas and terminal receipts to their exact filename, reset counters for a new file, retain monotonic phase progress within one file, and show an unknown total as counting until its exact count is sealed.

- v2.3.116: Never return a verified active/completed history manifest without its exact latest published filename. Continuing history chunks identify the file being staged; import timestamps must never be fabricated from Drive modification timestamps.

- v2.3.116: Never route revision or Request capability reads through the XLSX isolate. Use canonical authenticated PostgREST with permission versions and READY/LKG proof; keep mutations behind server authorization. Cap live slices at 1,500 rows and release raw buffers before SQL staging. Private ERP job JSON owns sourceProgress; get_my_erp_sync_progress_v23116 excludes leases/cursors and the centered Home modal polls every 800ms only while visible.
- Never leave stale-lease recovery owned only by the workbook sender. The lightweight receiver retains a bounded waitUntil retry with the shared four-second renewable lease and 40-hop boundary.
- Never relabel the 76 missing immutable SOC history versions as Transactions Keyed rows or fabricate processed status/averages. Canonical prepare/stage/finalize/activate RPCs preserve completed versions. Local recovery uses three file partitions, four verified 256-KiB ranges per file and batches of at most 1,000 rows; truncation fails before publication. Shared router, Back, viewHistoryStack and header/search ownership remain canonical.

- v2.3.115: Never relabel unfinished history files as processed to clear a UI message. Assigned Items shows numeric averages while the canonical immutable history manifest and resumable cursor remain truthful; low-stock targets use private canonical overrides.
- v2.3.114: Never send Drive md5Checksum to a SHA-256 RPC parameter. Fast-skip uses file identity and modification time with a null hash until bytes are downloaded; publication retains the canonical calculated SHA-256.

- A claimed 12-second worker lease must never await a successor HTTP response before its heartbeat starts. Confirm outbound request issuance only; retain the response/retry promise in waitUntil while the current bounded slice proceeds.

- v2.3.114: Never rely on a browser continuation loop to finish an accepted cloud run. Advertise cloudRelay, keep the initial start alive, wake existing active runs on status unless autoRelay is false, and bound signed internal HTTP relay hops to 40. Dispatch the successor before heavy slice work under the same private request lease. A hidden or expired browser continuation hands off silently; foreground refresh wakes status, metadata and the canonical revision coordinator. Core, secondary and history transitions are separate slices. An anon key or relay header alone never grants worker authority.

- v2.3.112: Never introduce a dataset-only competing single-flight map: AgDataKernel.sync.inFlightReadsByKey indexes canonical supabaseReadInFlight, whose keys include account, permissions, query and generation. Unchanged revision signatures must not repeat onRevisionRead mutations; retain sequence/current-context fences and actionable row deltas.

- Never expect parallel offset paging without an authoritative total, or assume a requested 5,000-row limit bypasses the server cap. Read the exact total once through a narrow unique-ID projection beside the first page; keep wide physical-row pages free of exact-count work. Publish the first authorized partial page across Home and operational views, then validate total/identity coverage before full publication.
- Never discard non-enumerable inventory read metadata when redacting a shared snapshot for Eval accounts; preserve redacted coverage and completion metadata alongside the sanitized rows so authorized full hydration remains available.
- Never start a Home browse snapshot beside an owned cold full-master snapshot, or start a coordinator assignment read before joining the active cold full promise; both duplicate transport work and can cancel authenticated startup reads.
- Never serialize every 500-code Assigned Items history batch or duplicate the same in-flight code set across UI and coordinator callers; share the authenticated read and bound parallel batches to four while verifying complete returned-code coverage.
- Never attach authenticated cold dataset or shared revision transports to a view's cancellation signal; retain them across same-account coordinator changes, reject cancelled callers before dispatch, and keep account/auth-epoch fences on completed results.
- Never override the shared inventory transport's internal signal with a caller's navigation signal, or leave authenticated operational snapshot reads generation-scoped after a cold load completes; keep the read alive while its account owner remains unchanged and discard stale results at publication boundaries.
- Never repeat hundreds of physical column names in every wide master row when the same authenticated PostgREST query supports a compact CSV response. Decode against the exact expected header and SQL types, preserve null versus quoted empty strings and timestamp precision, and retain JSON compatibility for older cached contracts.
- Never negotiate CSV outside the typed database bridge's validation path, or parse an already validated inventory response a second time; validate the decoded payload with the existing table schema and reuse its response-local data.
- Never enable a new wire representation solely because the inventory decoder is present; require the database bridge's explicit capability too, so mixed cached assets continue with the compatible JSON path.
- Never let a foreground read generation cancel a shared same-account operational download; preserve its owner until completion and retain account/auth epoch as the cancellation boundary.
- Never fetch heavy operational tables before an authenticated identity exists, serialize master/SOC startup behind independent permission reads, or auto-open notification help during login.

- Never let a row delta set initial/full source readiness or replace a cold base load. Buffer source patches by authenticated owner until a complete nonempty snapshot is installed, then replay and rebuild canonical indexes.
- Never return a failed coordinator ensure as successful cold hydration; continue the canonical authorized direct loader and repaint after completion.
- Never make live imports depend on legacy Apps Script history processing; complete the bounded cloud history manifest and atomically activate canonical incremental Average Order statistics.

- Never make live row patches depend on the active module or accept a client Broadcast payload as an authoritative database row. The account-owned `agdata-live-sync` channel uses RLS-filtered Postgres Changes and bounded server Broadcast rows only for sources with uniform read access, private revision hints for immediate wake-up, zero-delay revision signals, and the existing foreground fallback. Retain editing drafts and scroll anchors while synchronously updating canonical caches and indexes.

- Never let a cloud ERP worker's 12-second request lease expire while it is inside a long atomic finalization. Renew through `assert_erp_sync_worker_v1` during the bounded worker operation, stop the heartbeat on every exit, and reject completion after lease ownership changes; keep the existing expired-worker reclaim interval.

- Never treat historical native Sheets in the HL PDF source folder as pending PDF imports. Preserve the canonical PDF-only filter and leave those historical documents in place.

- Never treat a source-specific first slice as permission to process a whole workbook, reuse a single source folder as removeParents, or mark a secondary file processed before its established finalizer succeeds. Register server-only secondary imports and preserve exact source row keys with hash-based no-op updates.
- Never retry a transient manual ERP slice failure with the same row cap indefinitely; retry HTTP 500/502/504/546 at most six times, lowering the requested slice from 2500 to 1250 to 600 rows, then resume normal 2500-row slices after a successful retry.

- Never allocate matches for every SOC cell merely to discard most of them afterward. Cache a selector for the exact header-derived item, Dock and Suspend columns, preserving sparse/shared/inline values and avoiding full-row decoding for excluded rows.

- Never drop every null-valued source key to shrink staged ERP JSON: the importer derives its update-column union from those keys. Preserve the first occurrence of every column and all nonnull values; exclude Drive protected raw-field payloads from compaction.

- Never retain a full raw XLSX row array alongside a second full normalized snapshot in an Edge worker. Stream one worksheet pass through at most 5,000 raw rows, normalize and append that batch, release it, and seal the final count; renew the lease around each bounded write. A parser-only benchmark does not establish hosted memory or full-run completion.

- Never order dotted app releases as strings or treat an older remote manifest as a newer release; compare numeric major/minor/patch segments, including 2.3.100 > 2.3.99, through compareAgDataVersions.

- Never advance a browser-owned ERP continuation without scheduling the next signed cloud request under EdgeRuntime.waitUntil before heavy workbook work, with the successor waiting on the shared private.erp_sync_jobs lease. Renew that lease before every bounded append/publication; download and parse a new workbook once, and publish IDLE/Home metadata before background row hydration. A public.app_sync_runs lease must not be invented alongside the canonical private job.

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
- Never gate cloud history ingestion on the removed overnight window or reopen unchanged finalized file versions; respect a future explicit pause.
- Never label a full-row Manager surface as paged in the live-sync context; its coordinator cohort must match the renderer's actual canonical source reads or `DATASET_KEYS_INVALID` can suppress the view.
- Never place private-schema names in app-api dataset-revision requests; mirror private low-stock changes onto the public `ph_eval_report_settings` revision and subscribe to that key so freshness remains observable without invalid requests.
- Never treat a healthy Realtime socket or login-time snapshot as sufficient freshness: retain the 15-second no-store revision poll, focus/visibility wakeups, and revision-fenced background adapters for DRIVE, CAV, RESERVES, SOC, and HL Order.
- Never restore a live-sync draft onto an active editor object that aliases the authoritative cache row; isolate that editor before patching so cached rows and indexes stay current while draft values and scroll position remain intact.
- Never filter SOC XLSX open orders by only the literal `dock` header; normalize `dock`, `docknumber`, and `tripnumber` aliases before counting, paging, and staging so valid dock rows remain regardless of Suspend status, while retaining every SUSPEND row at ingestion (downstream queue eligibility remains independently scoped).

## v2.3.103 bounded cloud and secondary imports

Cross-layer blast radius: Code.gs folder identities and prepare/finalize/archive contracts remain canonical; app-api continues the four core stages then the four secondary stages using erp-secondary-sync.mjs. Browser transient retries pass a 600–2500 row cap; core parsing stops at 700 ms or its row budget and persists the raw offset. SQL request leases expire after 12 seconds. Secondary source rows retain their physical keys and use row_state_hash equality to skip unchanged updates; HL PDF pages retain immutable replay validation. Drive moves fetch actual parents before PATCH. Existing READY data and finalized history versions remain intact. No new browser startup reads are introduced.


## v2.3.105 cold hydration and incremental cloud history

`pendingRowPatchesBySource`, `hydrateColdSource` and `replayHydratedRowPatches` reuse the canonical dataset loader and master indexes. Home, Managers, Docks, Request and Item Detail eagerly hydrate their operational bases; account changes discard pending deltas. `erp-history-sync.mjs` continues after core/secondary imports and reuses immutable SOC_PROCESSED versions before activating affected-item statistics. No new browser read endpoint is introduced; Code.gs delivery/email paths remain intact.


## v2.3.106 cold-start read ownership

`hasAuthenticatedOperationalReadIdentity` gates heavy direct reads before transport. Customer mapping and the full master snapshot share account-owned in-flight promises that survive permission readiness transitions. `fetchAllInventoryReadRows` learns exact totals once, detects the actual server page cap, publishes a partial first page, and fetches continuation pages with up to eight workers. `finalizeLogin` starts master, SOC, pending requests, Suspend and assignments before awaiting access readiness. Only a complete unique-ID snapshot establishes full readiness and replays pending source patches; scheduled push enrollment keeps notification help closed. No new browser endpoint, SQL contract, or Apps Script importer is introduced. Performance targets require measured live evidence.
