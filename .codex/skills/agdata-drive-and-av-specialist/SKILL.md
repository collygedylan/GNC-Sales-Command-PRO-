---
name: agdata-drive-and-av-specialist
description: Maintain AgData Drive Mode, AV, Inventory, inventory metrics, drill-downs, and EXPORT EXCEL using complete authorized snapshots.
---

# Drive, AV and Inventory

Drive's initial catalog and preview use the same master adapter for admin and sales reps. AV Open uses complete master and reserve projections for every authorized role, retaining server reserve ownership filters. Warehouse assignments hydrate in the background; existing assignment-dependent card actions stay denied until authorized assignment data arrives. Normalize salesrep, sales rep and sales_rep identically.

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 3 and shared Back/navigation ownership.

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
- `public.get_consolidation_move_candidates_v1()` owns strict candidates; `private.refresh_inventory_consolidation_cache_v2366()` atomically publishes them; `public.inventory_consolidation_suggestions_v1(jsonb)` and app-api `handleInventoryConsolidationAction` expose bounded authenticated reads. The authenticated shell warms this read after it becomes interactive without blocking Home, and the response is fenced to the initiating account. Nothing enters Location Moves until the user explicitly sends a card.
- Historical Drive Around file pages use the private `historical_drive_file_page_v2367` single-pass ID deduplication helper; preserve exact state hashes, the authenticated archive wrapper, and zero historical-row backfill during daytime releases.

## Owned seams and shared dependencies

- `assets/app-runtime.js`: `rebuildMasterInventoryIndexes`, `getMasterInventoryExactKey`, `getCardLocationOnHandValue`, `getCardLocationOnHandServerAggregate`, `renderAV`, `renderDrive`, `buildAVExportContext`, `exportCurrentAVToExcel`, `buildDriveCurrentExportContext`, `exportCurrentDriveModeToExcel`. Drill navigation uses `backToDriveNames`, `backToDriveSizes`, `backToDriveSeasons`, `backToDriveBlocks`, `backToDriveLocations` and the corresponding selected Drive/AV state. These functions own the feature state, not the shared shell.
- Shared inventory state: `fullInventory`, `avOpenInventory`, `masterInventoryById`, `masterInventoryByExactKey`, `masterInventoryByItemCode`, `masterInventoryByItemLocationOnHand`, and `productionDisplayMasterReceipt`. Authoritative location totals require the matching account/permission/revision receipt or a complete authorized snapshot; incomplete data stays unknown. Rebuild indexes coherently before publishing returned-row updates.
- DOM: `#view-drive`, `#drive-content`, `#drive-crumb`, `#drive-drill-tabs`, `#drive-mobile-mode`, `#view-av`, `#av-content`, `#av-search`, `#av-export-btn`. Preserve COMMONNAME / LOCATION / CARD / REPORTS and the AV Open Stock / My Reserves routes.
- Feature helpers: `assets/inventory-list-contract.js`, `assets/queue-inventory-hydration.js`, `assets/drive-demand-detail.js`, and `assets/live-sync-registry.js` / `live-sync-adapters.js`. `inventory_read` (`master_page`, `master_identity_batch`, `source_freshness`) and `av_read` use `app-api`, `_shared/inventory-projections.ts`, `_shared/inventory-location-on-hand.ts`, `ph_master_inventory` and `inventory_location_on_hand_read_v1`; `Code.gs` `buildMasterPayload` / `buildMasterBulkSnapshotPayload_` own upstream ERP normalization.
- Shared shell: keep `switchView`, `showOnlyPrimaryView`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, and `viewHistoryStack` intact. Drive drill Back and global Back are different levels: update both feature selection state and the existing navigation hooks instead of hiding or duplicating `#global-header-inline-back`.

## Scoped pure Node verification

```sh
node --test tests/inventory-card-location-on-hand.test.mjs tests/inventory-drill-navigation.test.mjs tests/drive-search-location.test.mjs
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

Candidate additions remain a verified service-role suspend_tag_command_v1 transaction with exact parent order grouping, source/version guards and idempotency. The receipt includes added_rows/removed_false_block and all affected physical rows; replaced False Block rows are removed from active Suspend arrays immediately. Optional metric enrichment cannot turn a committed receipt into failure. No synchronous Code.gs mutation is involved. Focused coverage: suspend-tag-dataset, inventory-drill-navigation and dock-trip-status.

Reclass previews and confirmed seasonStocks receipts propagate itemcode/canonical-season Open Stock to every master/AV/CAV sibling across lot years. Publish source/destination previews immediately and preserve same-account cards while committing and sending reports asynchronously; rollback only definite rejection and retain unknown commands for idempotent recovery.

## Watchdog and active queue continuity

A complete productionDisplayMasterReceipt with matching readScope and permission permits immediate Drive/AV rendering on navigation; background verification must not replace that account-owned inventory with skeletons.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/location-code.js`: `compareLocationCodeNatural`; `assets/app-runtime.js`: `compareLocationCodeValues`, `sortDriveCardItems`, `sortAvOpenItems`, `getRowPhotoLink`, `resolveCanonicalPhotoUrls`, `getDetailPhotoUrls`, `renderDrive`, and `renderAV`.
- `supabase/functions/app-api/index.ts`: `handleInventoryRead`, `handleInventoryConsolidationAction`; `Code.gs`: `buildMasterPayload`, `buildMasterBulkSnapshotPayload_`; SQL: `app_sync_private.inventory_location_evidence_v1`, `private.apply_inventory_location_evidence_v1`, `public.save_drive_evidence_v3`, `public.reconcile_inventory_location_evidence_v1`, `public.get_consolidation_move_candidates_v1`, and `public.inventory_consolidation_suggestions_v1`.

## Cross-Layer Blast Radius

- Persist Season Photos (`photo_link`/`photo_name`/`date_completed`), `spec`, `match`/`loc_match_qty`, `av_note`, `pic_note`, and `sales_note` by normalized `(itemcode, locationcode)` and merge that overlay into every DriveAround import and `inventory_read`/`av_read`/`report_read_v2` projection. Recompute Loc Photo Match as rounded On Hand times percent.
- Multi-row `(itemcode, locationcode, lotcode)` photo save/delete/retry and MARK DONE select the canonical location row, upload with `upsert: true`, retry busy saves, and never reject merely because a standard and `DESIGITEM #` row coexist.
- Drive cards, AV photo cards, and the lightbox resolve URLs only through `resolveCanonicalPhotoUrls`; Drive, AV, Eval Reports #2, and Que consume the canonical natural location comparator.
- Canonical DriveAround, SOC, Reserves, CAV, request, API-response, display, and drill-key text removes only repeated literal backslashes immediately before `'` or `"`. Preserve valid standalone backslashes and normalize before deriving identities, hashes, grouping keys, or search keys.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- Never persist or prefill AV Note measurement fragments containing SPEC or CALIPER, and never make Admin users press-and-hold to edit published evaluation data; sanitize load/save while keeping non-Admin published fields read-only.

- Never let a delayed AV view reset erase a focused search that the user entered after the view became visible; explicit Reset/Home actions may clear it, background startup rendering may not.

- Never make an exact AV itemcode search wait for a near-tail full-cohort page or a native-session header refresh; hydrate that bounded public-read item directly into the partial same-account view while complete keyset hydration continues in the background.

- Never request `count=exact` or use deep offsets on wide `ph_master_inventory` pages; walk the indexed `unique_id` keyset until a short no-count terminal page and verify the ordered unique IDs before publishing.

- Never let `avOpen` and `master` create duplicate live-sync adapters for the same full inventory cohort; canonicalize aliases before staging or concurrent wide reads can exhaust the PostgREST statement timeout and leave AV loading forever.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never key durable photo/spec evidence only by physical UID or lot, overwrite it from a new DriveAround UID, use divergent thumbnail parsing, or display `Photo unavailable` when the canonical resolver returned a URL.
- Never restore inline `localeCompare` location copies, reject a duplicate-location photo save with `403`/`404`/`409`, truncate complete exports, or replace known metrics with `--`.
- Never repair escaped apostrophes only in rendered HTML; that leaves import hashes, Common Name groups, drill filters, Que, Bloom, and Eval #2 on divergent keys.
- Never rank a Carry Over source against unrestricted destination years, expose mixed-tier source/destination locations, or trust stale client destination arrays without repeating the crop-tier guard.
- Never prefetch Inventory Consolidation from Home, Drive, login, or Request; load it only after the foreground Inv Consolidation view opens and retain cached suggestions on actor-bound read failure.
- Never render a photo date as an absolute thumbnail overlay or expose SPEC/CALIPER-only fragments through cards, persisted AV notes, or lifecycle emails.
- Never reject a complete Drive snapshot merely because a retained alias points at a canonical UID absent from the current snapshot when the same atomic import has inserted the exact source UID; remap only that proven row and retain the conflict for genuinely missing identities.
