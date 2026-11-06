---
name: test-agdata-drive-and-av-specialist
description: Maintain AgData Drive Mode, AV, Inventory, inventory metrics, drill-downs, and EXPORT EXCEL using complete authorized snapshots.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Drive, AV and Inventory

Drive's initial catalog and preview use the same master adapter for admin and sales reps. AV Open uses complete master and reserve projections for every authorized role, retaining server reserve ownership filters. Warehouse assignments hydrate in the background; existing assignment-dependent card actions stay denied until authorized assignment data arrives. Normalize salesrep, sales rep and sales_rep identically.

Read [the canonical dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) for Cluster 3 and shared Back/navigation ownership.

Use this skill for Drive Mode, AV, Inventory and EXPORT EXCEL. Read the zero-lockout guard when changing hydration, cache or row-opening behavior.

- Hydrate the complete published DriveAround snapshot in the background, including all pages. The historical fixture has 9,487 rows and the reference inventory has 9,486+ rows and 1,566+ Common Names. These are reference sizes, never hardcoded production completeness thresholds. Compare hydration with the published snapshot row count and derive the complete A–Z Common Names index from that same authorized snapshot; never substitute a 38/75-name slice.
- Preserve the drill-down hierarchy: COMMONNAME → CONTSIZE → SEASON → location/lot cards. EXPORT EXCEL uses the complete authorized result, not only mounted cards or the current page.
- Global Back must unwind one Drive or AV open-stock drill level before delegated navigation/history; retain remaining selections and invalidate AV's resolved projection after stepping back. Root views with no history return Home. On mobile widths through 820px, keep the Drive filter rail in flow with no extra search-to-filter gap or fixed-rail spacer above `#drive-crumb`.
- Keep all six metrics on single lines: On Hand, Review, Available, Open Stock, Loc Photo Match, and Loc On Hand. Preserve their meanings and distinguish location totals from individual lot quantities.
- Compute numeric Loc On Hand deterministically across every lot with the same itemcode + locationcode in the complete same-account snapshot. A known stock total must not display `--`. Do not invent zero when data is genuinely unknown.
- Preserve PRI, quality flags ORANGE / NS 1.0 / LD, and Code / Reason / Since strips. Follow the existing source-of-truth field mappings rather than guessing substitute columns.
- Cache inventory indexes and dictionaries; opening a card must not wait for a fresh network query. Preserve user drafts while a row refresh completes.
- Drive and AV accept a master-only first-page display while optional settings/joins and the remaining pages load. Keep that preview partial: full export and write proof still require the complete authorized snapshot. Cold views start one bounded authenticated `inventory_read` preview recovery after 1,000 ms (or immediately on coordinator failure); it retries transient errors once and never inherits a stalled coordinator/deduplicated promise. Normal hydration continues with at most two page reads in flight.
- Replace a first-page display with the complete master as soon as its stage resolves, even while reserves/settings finish. All roles label incomplete AV catalogs as partial; a complete master takes precedence over a retained smaller AV projection. Retain the configured season/year predicate (including four-digit ERP sales years normalized against two-digit settings), and use zero Review only when stock quantities are known.

Before changing metric math, sorting or hydration, trace ERP → published Supabase snapshot → fixture projection → rendered card. Cover aggregation across lots, full pagination, A–Z completeness and export parity with focused Node cases. Apply the release governor for changed rendering and update this skill when its contracts change.

## Inventory Consolidation crop tiers

- `Inv Consolidation` derives the live current SalesYear from season settings and separates every eligible source into `CARRY_OVER` (`< current`), `CURRENT_CROP` (`= current`), or `FUTURE_CROP` (`> current`). A source location must be tier-pure; unresolved or mixed-tier active lots are not suggestions.
- Carry Over destinations for the same ItemCode must have zero active Current/Future rows and stay below the current year. Rank exact source year first, then other Carry Over years, same block, highest destination Loc On Hand, distance, and natural location identity.
- Current Crop destinations must be pure current year. Future Crop destinations must be pure and match the source's exact future year. `getInventoryConsolidationValidDestinations` repeats the year guard in the browser so stale cached options cannot cross tiers.
- `public.test_get_consolidation_move_candidates_v1()` owns strict candidates; `test_private.refresh_inventory_consolidation_cache_v2366()` atomically publishes them; `public.test_inventory_consolidation_suggestions_v1(jsonb)` and app-api `handleInventoryConsolidationAction` expose bounded authenticated reads. The authenticated shell warms this read after it becomes interactive without blocking Home, and the response is fenced to the initiating account. Nothing enters Location Moves until the user explicitly sends a card.
- Historical Drive Around file pages use the private `historical_drive_file_page_v2367` single-pass ID deduplication helper; preserve exact state hashes, the authenticated archive wrapper, and zero historical-row backfill during daytime releases.

## Owned seams and shared dependencies

- `test/assets/app-runtime.js`: `rebuildMasterInventoryIndexes`, `getMasterInventoryExactKey`, `getCardLocationOnHandValue`, `getCardLocationOnHandServerAggregate`, `getRetainedCardLocationOnHand`, `retainVerifiedCardLocationOnHandRows`, `scheduleStaleRequestOptionMetricRefresh`, `loadRequestItemCodeOptions`, `renderAV`, `renderDrive`, `buildAVExportContext`, `exportCurrentAVToExcel`, `buildDriveCurrentExportContext`, `exportCurrentDriveModeToExcel`. Drill navigation uses `backToDriveNames`, `backToDriveSizes`, `backToDriveSeasons`, `backToDriveBlocks`, `backToDriveLocations` and the corresponding selected Drive/AV state. These functions own the feature state, not the shared shell.
- Shared inventory state: `fullInventory`, `avOpenInventory`, `masterInventoryById`, `masterInventoryByExactKey`, `masterInventoryByItemCode`, `masterInventoryByItemLocationOnHand`, and `productionDisplayMasterReceipt`. Authoritative location totals require the matching account/permission/revision receipt or a complete authorized snapshot; incomplete data stays unknown. Rebuild indexes coherently before publishing returned-row updates.
- DOM: `#view-drive`, `#drive-content`, `#drive-crumb`, `#drive-drill-tabs`, `#drive-mobile-mode`, `#view-av`, `#av-content`, `#av-search`, `#av-export-btn`. Preserve COMMONNAME / LOCATION / CARD / REPORTS and the AV Open Stock / My Reserves routes.
- Feature helpers: `test/assets/inventory-list-contract.js`, `test/assets/queue-inventory-hydration.js`, `test/assets/drive-demand-detail.js`, and `test/assets/live-sync-registry.js` / `live-sync-adapters.js`. `inventory_read` (`master_page`, `master_identity_batch`, `source_freshness`) and `av_read` use `app-api`, `_shared/inventory-projections.ts`, `_shared/inventory-location-on-hand.ts`, `test_ph_master_inventory` and `test_inventory_location_on_hand_read_v1`; `test/workers/email/Code.gs` `buildMasterPayload` / `buildMasterBulkSnapshotPayload_` own upstream ERP normalization.
- Shared shell: keep `switchView`, `showOnlyPrimaryView`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, and `viewHistoryStack` intact. Drive drill Back and global Back are different levels: update both feature selection state and the existing navigation hooks instead of hiding or duplicating `#global-header-inline-back`.

## Scoped pure Node verification

```sh
node --test test/tests/inventory-card-location-on-hand.test.mjs test/tests/inventory-drill-navigation.test.mjs test/tests/drive-search-location.test.mjs
```

These are local source/VM tests, not browser, export-layout or production-volume benchmarks. Target `< 10s`, unmeasured until actually run. Choose the relevant subset; full volume/browser checks stay nightly unless explicitly requested. The docs-only verification override takes precedence. See the canonical module map, cluster 3, for the complete dependency tables.

A partial master preview cannot replace a complete same-account, same-permission display receipt. Common Name rendering paints its first batch synchronously while continuing in frames. Plant search removes punctuation and accepts joined word searches (stjohn). Resolved AV thumbnails hydrate immediately in the visible window; missing location totals may display a positive card On Hand fallback.

Startup warms the complete master browse snapshot from Home with 1,000-row pages and at most four concurrent continuation reads; partial pages never replace a complete same-account catalog. Require stable totals and projection coverage, then refresh focused search after complete hydration. AV option cards format hold Since as a compact date and arrange six metrics in three columns on narrow cards.

## Request completion and foreground continuity

renderDrive withholds partial root Common Name catalogs and retains an already painted complete catalog while refreshing. Background renderViewContent/renderDriveCommonNameDrill preserve selected name/location and CARD depth. getPlantSearchRank puts prefix and word-start tokens ahead of substring matches in Drive and buildAVExportContext. Dark empty photo surfaces are styled in app-shell-style-15.css. Focused coverage: inventory-drill-navigation.test.mjs.

## Performance and retry guard (v2.3.34)

Application revision conflicts use SQLSTATE PT409 (HTTP 409); never raise 40001 for an application conflict, because PostgREST can retry it internally. Real PostgreSQL serialization failures retain 40001. The atomic application_conflict_retry_guard migration preserves security, grants and bounded catch behavior; operational_lookup_indexes uses audited physical columns and existing index prefixes. The 500/2,000-row staging constraint preserves resumable older imports. Historical archive backfills and the 15-minute trigger remain PAUSED.

The foreground coordinator owns a 30-second idle / 10-second active-sync heartbeat; hidden contexts cancel network polling and watchdog delivery retains its queue until visible. SOC/CAV/Reserves dataset_read pages accept optional numeric ifRevision, returning up_to_date only after actor, permission and query validation against a READY revision. Page caches are bounded and fenced by read identity and permission version. Queue metric joins group master/CAV once by item. Browser table mutations use authenticated app-api without direct PostgREST fallback; intentional native reads retain existing SELECT policies.

rebuildMasterInventoryIndexes installs the shared queue inventory index with byItemLocLot, byItemLoc (summed locOnHand and rows), byItem and normalizedSearchText. Search normalization and CAV fallback indexing happen once per snapshot. Exact mutation identity/ambiguity checks remain separate from display fallbacks. Shared switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack, header/search ownership and same-account cached displays remain governing dependencies. Focused regressions: live-sync-coordinator, inventory-drill-navigation, security-zero-trust; no browser timing claim follows from Node measurements.

## Durable Drive import reconciliation

The private inventory_live_overrides_v1 audit records per-physical-UID ERP baselines, app values, actor/time, latest ERP values and acknowledgement. Only matching fenced raw ERP values acknowledge a pending field; arbitrary ERP drift and auxiliary CAV writes preserve it. Later ERP changes apply after acknowledgement. Existing priority/Item6 guards remain; unprotected ERP sibling consolidation retains the new physical UID while protected ambiguity still fails. Missing source rows retain pending edits. New startup reads are not introduced.

runRoutedDropImport_ selects one newest live source and archives older unchanged file identities only after successful publication, using the published watermark for archival retry. Historical backfills remain paused. Shared switchView/showOnlyPrimaryView, goBackUniversal/updateGlobalBackButton, viewHistoryStack and header/search ownership remain dependencies. Focused checks: request-submission-durability and security-zero-trust.

## Option metrics and partial location refresh

On Hand accepts on_hand/onhand/onHand/qty_on_hand/oh and existing PTR aliases, deriving available + review when On Hand is absent/zero and that sum is positive. AV option cards use the shared spaced six-metric grid and a literal gap before container size. preserveCardLocationOnHand retains max(summedLocationOnHand, existingLocOnHand, rowOnHand) within the same account/permission item/location scope; partial refreshes cannot downgrade a known multi-lot total.

Candidate additions remain a verified service-role test_suspend_tag_command_v1 transaction with exact parent order grouping, source/version guards and idempotency. The receipt includes added_rows/removed_false_block and all affected physical rows; replaced False Block rows are removed from active Suspend arrays immediately. Optional metric enrichment cannot turn a committed receipt into failure. No synchronous test/workers/email/Code.gs mutation is involved. Focused coverage: suspend-tag-dataset, inventory-drill-navigation and dock-trip-status.

Reclass previews and confirmed seasonStocks receipts propagate itemcode/canonical-season Open Stock to every master/AV/CAV sibling across lot years. Publish source/destination previews immediately and preserve same-account cards while committing and sending reports asynchronously; rollback only definite rejection and retain unknown commands for idempotent recovery.

## Watchdog and active queue continuity

A complete productionDisplayMasterReceipt with matching readScope and permission permits immediate Drive/AV rendering on navigation; background verification must not replace that account-owned inventory with skeletons.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/location-code.js`: `compareLocationCodeNatural`; `test/assets/app-runtime.js`: `compareLocationCodeValues`, `sortDriveCardItems`, `sortAvOpenItems`, `getRowPhotoLink`, `resolveCanonicalPhotoUrls`, `getDetailPhotoUrls`, `renderDrive`, and `renderAV`.
- `test/supabase/functions/app-api/index.ts`: `handleInventoryRead`, `handleInventoryConsolidationAction`; `test/workers/email/Code.gs`: `buildMasterPayload`, `buildMasterBulkSnapshotPayload_`; SQL: `test_app_sync_private.inventory_location_evidence_v1`, `test_private.apply_inventory_location_evidence_v1`, `public.test_save_drive_evidence_v3`, `public.test_reconcile_inventory_location_evidence_v1`, `public.test_get_consolidation_move_candidates_v1`, and `public.test_inventory_consolidation_suggestions_v1`.

## Cross-Layer Blast Radius

- Persist Season Photos (`photo_link`/`photo_name`/`date_completed`), `spec`, `match`/`loc_match_qty`, `av_note`, `pic_note`, and `sales_note` by normalized `(itemcode, locationcode)` and merge that overlay into every DriveAround import and `inventory_read`/`av_read`/`report_read_v2` projection. Recompute Loc Photo Match as rounded On Hand times percent.
- Multi-row `(itemcode, locationcode, lotcode)` photo save/delete/retry and MARK DONE select the canonical location row, upload with `upsert: true`, retry busy saves, and never reject merely because a standard and `DESIGITEM #` row coexist.
- Drive cards, AV photo cards, and the lightbox resolve URLs only through `resolveCanonicalPhotoUrls`; Drive, AV, Eval Reports #2, and Que consume the canonical natural location comparator.
- Canonical DriveAround, SOC, Reserves, CAV, request, API-response, display, and drill-key text removes only repeated literal backslashes immediately before `'` or `"`. Preserve valid standalone backslashes and normalize before deriving identities, hashes, grouping keys, or search keys.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `test/workers/email/Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `test_ph_app_users` and `test_user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.189: Never narrow photo-mode source rows or badge counts by season/sales year before valid-photo eligibility. Include photo mode in derivation cache identity and preserve permission, stock and exact-row evidence gates (Invariant 489).

- v2.3.186 / Invariant 486: Never sort ERP snapshots by the leading clock, trailing clock or Drive modification time ahead of the embedded date. Parse HHMMSS+YYYYMMDD+HHMMSS as YYYYMMDD+first HHMMSS; use modifiedTime only when no filename timestamp exists. Preserve exact-row evidence, committed source receipts, mapped Suspend ownership and numeric Docks. Keep captured Mark Done card return, receipt-gated success, session previews and no-wrap reorder controls. Four bounded local watchdog probes recover only the current editor/account and retained local images; never mutate production data or expose the restricted review panel to other roles.

- v2.3.185 / Invariant 485: Never retain or reopen Item Detail after confirmed MARK DONE, tie its accepted save to an editor navigation signal, revoke a session photo preview on upload, or squeeze LEFT/RIGHT into an 84px pair. Capture exact row/account evidence and return through the canonical Back handler before awaiting persistence; retain scroll, receipt-gated Success, drafts and rollback. Suspend evaluation keeps the physical tag active; only Complete Tag removes it. Keep localPreviewUrl through Uploaded and group nowrap 11px buttons with 4px 8px padding. This supersedes earlier return-after-receipt and automatic-next-editor instructions.

- Never resolve an evaluation from item/location alone, aggregate sibling metrics for its preview, compute its observed percentage from Available, or refresh an expired photo using a notes update timestamp. Preserve original photo time, exact UID, depletion, and receipt-gated completion. Invariant 482 owns this contract.


- v2.3.179. Queue cards and their Item Detail may preview an existing evaluation from the same item and location, preferring the linked physical UID, lot, sale year, season and priority. Keep that display source separate from the write target. Request, Suspend, Drive, AV and Eval Work publish only exact master receipts. An ambiguous Reclass opens a physical-row choice. Reclass transport recovery replays the same authenticated Edge command and idempotency token through PostgREST. Service Worker updates defer to the page while a detail, modal or upload is open. Restore unsaved fields by account, row and section. Retain local photo previews until the public image loads. An inventory completion lock requires a photo and positive match stock. Suspend Mark Done returns to the scrolled cards after its matching receipt. A classified Dock 38 or 39 review enters the existing Suspend path. A fully staged SOC file continues to publication, and only its receipt qualifies it for 100%. Invariants 472–478 cover queue media, locks, previews, drafts, worker navigation, Reclass recovery and staged SOC continuation.

- Never hydrate or publish photos, spec, caliper, AV/pick notes, comments, match quantities or completion by location or item/location. Use the master UID first, and use an exact item/location/lot tuple only when it identifies one physical row. Two rows with the same tuple and different UIDs own separate evidence. Invariant 471 covers the Grey Guardian priority 1 and priority 10 cards.

- v2.3.164, Invariant 458. AV has one Filters disclosure beside Season, a second row for Reset, Export Excel and Kiosk Mode, and a single scrolling chip line. Both open-stock and reserve cards open photos from the 84px thumbnail. Keep completion, Reclass, View Photos and evaluation owner controls off AV cards for every role.

- v2.3.164, Invariant 457. A regular Que Request opens Item Detail directly. Show its whole field grid inline in #ffffff or #ecfdf5, weight 700, on dark emerald. Keep LEFT and RIGHT with their own 84px photo. MARK DONE asks only “Mark <Item> done?”, publishes linked evidence through the authorized save, and advances after an exact completed-history receipt. Preserve unlinked folder completion and separate Suspend and NCR commands.
- v2.3.144: Never infer completion from photo/spec changes or drop a committed photo timestamp while restoring editor drafts. Keep unlimited photo references and ✓ UPLOADED receipts; only explicit Mark Done completes. Native unlock repeats assigned-user/Admin/super-admin authorization. Photo age >10 calendar days or evaluated zero match expires through canonical evidence/history; unentered match remains a draft and Docks-owned photos are exempt. Camera state is owner-scoped, survives recreation, and defers reload through capture plus 15 seconds. Unassigned summaries occur only once per completed manual sync on Home/Managers. Invariant 400 exercises these boundaries.
- v2.3.144: Never reset a proven gateway outage on reload or make Item Detail wait for photo transport warm-up. Persist the bounded 30-minute agdata_storage_gateway_cooldown_until_v1 deadline; warm only on detail entry through the native read-only test_can_upload_drive_evidence_v23115 RPC, exact Edge HEAD ?photo_warm=1, write-free blob-RPC OPTIONS, representative image-codec initialization and bounded Storage HEAD. Single-flight and account fences remain mandatory; warm-up never writes evidence or grants authority. Invariant 399 supersedes the five-minute RAM-only cooldown. Report actual HTTP cache headers separately from storage metadata.
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated test_store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- Never serialize unbounded photo uploads, hide other staged Reclass rows, or treat added candidates as an exact-order replacement. Keep 1280px/200KB JPEG compression, authenticated test_store_drive_photo_blob_v1 recovery, canonical Drive Item Detail, exact source/group commands with preserved split totals, and statement-level evidence propagation. Invariants 391–393 cover these seams; no new startup read, test/workers/email/Code.gs or delivery changes.
- Never expand the audited v3 physical projection in place or let a zero stock alias mask a positive exact-row alias; add full-read metadata through the canonical readColumns contract (Invariants 388–389).
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, test_save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.
- v2.3.138 completion: Never compare a dataset account scope to a REST read-identity string, or route the AV card body to the photo gallery. Retain the authorized display receipt and open exact Item Detail; photo buttons keep their gallery action (Invariant 366).
- v2.3.138: Never choose a failed blob stub over durable photos, block text/evaluation completion on a failed optional photo when a valid committed photo exists, or report failure after an exact committed evidence receipt. AV search must render while typing and replace stale card signatures (Invariants 359–360).
- v2.3.130: Never leave transformed photo URLs in cache keys, poll closed/hidden background UI, persist routine watchdog diagnostics, or emit success Edge logs. Keep signed cloud relays independent of the browser, protect referenced receipts and private grants, and verify empty CLI receipts against installed contracts (Invariants 323–326).

- v2.3.119: Never mix formatted text with timestamptz branches in photo_date CASE expressions. Persist saved_at as a timestamp and format MM/DD/YY in the renderer. Validate the actual atomic RPC inside a rolled-back transaction, not only CREATE FUNCTION compilation; Invariant 245 preserves the receipt.

- v2.3.119: Never make a verified same-account native photo/write transport wait for the optional legacy app-session bridge. Form requests already carry the native bearer; app-api and SQL retain active-profile and exact-row authorization. Invariant 244 rejects a mismatched account and preserves legacy fallback.

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.test_user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared test_save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.

- v2.3.118: Never reclassify an exact-row committed receipt as a failed save because canonical fields, photo URLs, or revisions differ from a draft. Recover transport loss through the same authenticated idempotent PostgREST evidence RPC; prefer positive exact-row stock aliases for match math, keep photo dates outside square media, and read AV Spec/Note from the exact live row (Invariants 238–240).

- v2.3.115: Never reconcile a save receipt with an undeclared masterUid or copy evidence into sibling lots/sources. Resolve the exact UID, reject mismatched receipts, render local photo previews immediately, and retain entered AV Note text including SPEC/CALIPER; the legacy sanitizer remains suggestion-only unless preserveEnteredText is requested. Native photo recovery requires an active authorized session and exact-row storage policy (Invariants 213, 214, 218).

- Never key evaluation/photo evidence by item + location, propagate it to sibling lots/sources, or inherit a crop sibling’s evidence. Invariant 202 verifies exact-row snapshot propagation and cross-lot/source rejection.

- Never hide LOCATION or route Drive/AV cards into read-only overview based on assignment, Review, Available, Hold/Stop or completion. Authorized Admin/Manager and assigned Eval editors retain editable LOCATION. Render cached item demand immediately; normalize Excel serial hold dates. Photo fallback keys include physical UID or source/priority.

- Never leave a transient content-addressed photo upload as a manual-only retry; retry network and temporary server failures with the same optimized payload and stop immediately when the request is canceled or its account scope changes.

- Never infer live photo/evidence authority from an Admin role or a previously opened Manager tab: hydrate the canonical Assigned Items index at login, evaluate the displayed physical row with `canUserMakeLiveChangesOnRow`, and repeat Jorge's exact-row/itemcode assignment check in Edge and PostgreSQL before every live write.

- Never mutate `LOC_MATCH_QTY` while evaluating AV invalidation/display eligibility; validation helpers are read-only and must not replace durable Reclass photo evidence with percent-derived math.

- Never omit `loc_match_pct`, `loc_photo_match`, `baseline_on_hand`, or `initial_photo_match_qty` from startup browse or full `inventory_read` projections; falling back to legacy percent math after a confirmed Reclass corrupts the displayed durable evidence.

- Never pass untrimmed Drive/AV search text into render scheduling, recreate image wrappers during unchanged card refreshes, or expose a white thumbnail/letterbox surface while protected photo evidence is loading.

- Never require AV Note for a row that is not the exact current-season Season Sales Note winner, hide Spec/Caliper behind photo or AV Note presence, or regress shared plant thumbnails to letterboxed 64px surfaces.

- Never persist or prefill AV Note measurement fragments containing SPEC or CALIPER, and never make Admin users press-and-hold to edit published evaluation data; sanitize load/save while keeping non-Admin published fields read-only.

- Never let a delayed AV view reset erase a focused search that the user entered after the view became visible; explicit Reset/Home actions may clear it, background startup rendering may not.

- Never make an exact AV itemcode search wait for a near-tail full-cohort page or a native-session header refresh; hydrate that bounded public-read item directly into the partial same-account view while complete keyset hydration continues in the background.

- Never request `count=exact` or use deep offsets on wide `test_ph_master_inventory` pages; walk the indexed `unique_id` keyset until a short no-count terminal page and verify the ordered unique IDs before publishing.

- Never let `avOpen` and `master` create duplicate live-sync adapters for the same full inventory cohort; canonicalize aliases before staging or concurrent wide reads can exhaust the PostgREST statement timeout and leave AV loading forever.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never key durable photo/spec evidence only by physical UID or lot, overwrite it from a new DriveAround UID, use divergent thumbnail parsing, or display `Photo unavailable` when the canonical resolver returned a URL.
- Never restore inline `localeCompare` location copies, reject a duplicate-location photo save with `403`/`404`/`409`, truncate complete exports, or replace known metrics with `--`.
- Never repair escaped apostrophes only in rendered HTML; that leaves import hashes, Common Name groups, drill filters, Que, Bloom, and Eval #2 on divergent keys.
- Never rank a Carry Over source against unrestricted destination years, expose mixed-tier source/destination locations, or trust stale client destination arrays without repeating the crop-tier guard.
- Never prefetch Inventory Consolidation from Home, Drive, login, or Request; load it only after the foreground Inv Consolidation view opens and retain cached suggestions on actor-bound read failure.
- Never render a photo date as an absolute thumbnail overlay or expose SPEC/CALIPER-only fragments through cards, persisted AV notes, or lifecycle emails.
- Never reject a complete Drive snapshot merely because a retained alias points at a canonical UID absent from the current snapshot when the same atomic import has inserted the exact source UID; remap only that proven row and retain the conflict for genuinely missing identities.
- Never render a stale scoped AV option's Loc On Hand as `--` merely because a later read advanced the global aggregate receipt; retain each verified page total immediately in the same-account LKG before requesting another page, reject the stale total, and schedule at most one active-item-scoped refresh per newer revision. Acknowledge the refresh chain's final revision to prevent self-triggering loops; never sum partial option rows or weaken receipt checks.
- Never derive Season Priority Hold/Stop or Location Note from a report note cache; resolve the same exact item/location/lot row from the live `fullInventory` snapshot used by Drive. A blank Hold/Stop code means there is no active Hold even when old reason/date text remains, and Location Note plus `LOCATIONPTN1`/note-date must stay distinct and visible in Drive cards and Item Detail.

## Strict physical-row evaluation ownership (v2.3.109)

Drive/AV/Inventory/Item Detail evidence uses the exact master UID, or exact item/location/lot/source tuple. test_save_drive_evidence_v3, capture/apply/canonical triggers and import reconciliation retain that UID; test_ph_location_sales_notes is keyed by unique_id and records source. Suspend/Docks may use their existing same-location display fallback, never a master hydration or mutation fallback.

- Never disable the bounded AV derivation service, reuse a partial preview across different search terms, or read the live search input inside base-row sort comparisons. Keep the first card synchronous and begin the first twenty-row window at index zero.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain AgData Drive Mode, AV, Inventory, inventory metrics, drill-downs, and EXPORT EXCEL using complete authorized snapshots.

### Exact ownership
- test/assets/app-runtime.js: renderDrive, renderAV, compareLocationCodeValues, sortDriveCardItems, sortAvOpenItems, createAvSalesRowsDerivation, buildResolvedAVBaseState, getRowPhotoLink, resolveCanonicalPhotoUrls, isSeasonSalesNoteWinner, requiresAvNoteForCompletion, getDetailPhotoUrls, canonicalizeProductionCoreLiveKeys, fetchDirectPostgrestReadPage, fetchDirectMasterInventoryPage, fetchDirectMasterInventoryItemRows, fetchAllInventoryReadRows, scheduleExactAvSearchHydration, installExactAvSearchHydrationRows, getCurrentExactAvSearchHydrationRows, hasCurrentExactAvSearchHydration, mergeExactAvSearchRowsIntoPreview, resetAVView, scheduleInventoryConsolidationWarmup, renderInventoryConsolidationContent, getInventoryConsolidationValidDestinations, openInventoryConsolidationLocationMove, normalizeLiveChangeUsername, isRowAssignedToUser, canUserMakeLiveChangesOnRow, warmLiveChangeAssignmentsAfterLogin, syncSuspendFillTagDetailAction, focusSuspendFillTagEvidenceEditor, getLiveDriveNoteRow, renderManagerSeasonPriorityLiveNotes, getDriveDetailFieldRawValue, getPrimaryDetailTabForItemContext, configureDetailTabsForItem, formatInventoryHoldSince, renderDriveDemandPanel, getMasterPhotoFallbackKey, reconcileConfirmedDriveEvidence, retryFailedSeasonDrivePhotoAttachments.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleInventoryRead, handleInventoryConsolidationAction.
- Code.gs: buildMasterPayload, buildMasterBulkSnapshotPayload_.
- supabase/migrations/20261026020000_agdata_v2367_crop_tier_aura_glossary.sql: get_consolidation_move_candidates_v1, refresh_inventory_consolidation_cache_v2366, inventory_consolidation_suggestions_v1.
- supabase/migrations/20261026034500_agdata_v2367_historical_drive_fast_read.sql: historical_drive_file_page_v2367.
- supabase/migrations/20261026160000_agdata_v2370_watchdog_and_request_recovery.sql: inventory_consolidation_suggestions_v2370, sync_master_inventory_pick_v2370.
- supabase/migrations/20261030150000_agdata_v23115_row_saves_assignments.sql: can_upload_drive_evidence_v23115.
- test/assets/row-workflow-functions.js: uploadDrivePhotoWithNativeSession, getCommittedDriveEvidenceReceipt, postPhotoUploadWithTransientRetry, ensurePhotoTakenDateBadges, getEditorLocMatchQtyValue, saveSecureDriveEvidence, getInventoryLocationPhotos, inventoryPhotoLocationKey, renderSavedPhotos, applySavedSuspendDisplay, rememberInventoryLocationPhotoRows, getAvNamePhotoSearchRows.
- supabase/migrations/20261031012000_agdata_v23119_typed_photo_publication.sql: save_drive_evidence_v3.
- DOM: #drive-crumb, #view-drive, #drive-content, #drive-drill-tabs, #drive-mobile-mode, #view-av
- PostgreSQL: test_ph_master_inventory, test_ph_app_users, test_user_access, test_ph_location_sales_notes
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-drive-and-av-specialist, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-drive-and-av-specialist.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- AV-VALID-PHOTOS-2026-11-05: AV photo mode did not distinguish expired or depleted row evidence from usable current photos. Valid Photos requires exact-row HTTP photos aged at most ten days, positive Available and positive remaining match. Explicit zero is depleted. Pill, View, chips and export use the same mode synchronously. Permanent assertion: tests/av-valid-photos.test.mjs. Evidence: User acceptance contract and AV filter source inspection..
- ROW-EVALUATION-2026-11-05: Suspend preview fallback aggregated sibling lots; percentage drafts used Available instead of true On Hand; archived row evidence could lack a master photo or match quantity. Publish through publishRowEvaluationToMasterAndNotes and UID-keyed protected evidence. Require explicit UID or unique full season/year/priority/lot identity, calculate observed match from exact On Hand, retain outbound depletion and original photo timestamps, and never revive expired evidence from notes update time. Permanent assertion: tests/row-evaluation-contract.test.mjs; Golden Invariant 482; transactional sibling checks. Evidence: Sandbox rollback and live guarded recovery receipts; no actor permissions or completion-removal contracts changed..
- v2.3.185-completion-cards-preview: Completed Drive/AV details were deliberately retained, other receipts reopened editors, and uploaded previews were removed while narrow reorder controls wrapped. Return the captured exact-row completion to its cards before awaiting persistence; preserve receipt-gated success, account scope, rollback, active physical tags and session localPreviewUrl. Permanent assertion: tests/completion-cards-preview.test.mjs and append-only Invariant 485. Evidence: Reviewed v2.3.185 user report; baseline reproduction and focused live/test checks under G:/My Drive/GNC/AgData/Release Evidence/.
- ERP-FILENAME-2026-11-05: Cloud sync ordered snapshots by Drive modifiedTime; Home parsing read the trailing clock and could match time digits as a year. v2.3.186 / Invariant 486: Never sort ERP snapshots by the leading clock, trailing clock or Drive modification time ahead of the embedded date. Parse HHMMSS+YYYYMMDD+HHMMSS as YYYYMMDD+first HHMMSS; use modifiedTime only when no filename timestamp exists. Preserve exact-row evidence, committed source receipts, mapped Suspend ownership and numeric Docks. Keep captured Mark Done card return, receipt-gated success, session previews and no-wrap reorder controls. Four bounded local watchdog probes recover only the current editor/account and retained local images; never mutate production data or expose the restricted review panel to other roles. Permanent assertion: tests/erp-filename-watchdog.test.mjs; Invariant 486. Evidence: November 5 committed stage receipts; source comparator inspection; focused behavior checks..
- v2.3.191-five-regressions: Prepended shared controls duplicated native filters; boot/version recovery reloaded retained sessions; independent Request reads lost publication order; forced start reused same-actor jobs; sparse SOC reparsed every raw page and admitted trip-only/historical rows. Use native drawers, retain authenticated shells, publish Request snapshots in order, force a distinct manual job, scan newest Drive files and publish only after EOF; protect unfinished edited tags; use noon-local weekday colors. Permanent assertion: Golden Invariants 500–510 and rolled-back SQL fresh-job/source-eligibility proof.. Evidence: G:/My Drive/GNC/AgData/Release Evidence/release-191-workbook-summary.json; release-191-database.sql; release-191-soc-removed-backup.json.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->

## AV Valid Photos quick filter
Canonical hasValidRowPhoto and getAvRowPhotoUrls use only exact-row evidence. Require a known timestamp no older than ten days, Available > 0 and positive remaining match; explicit zero must stay depleted. Unknown dates and uncommitted blob previews do not qualify. The pill, View options (all/valid_photos/photos/no_photos), chips and export share activeAvPhotoMode; All Photos includes expired evidence. Count from the full authorized filtered snapshot and preserve row identity, other filters and partial-export guards.
