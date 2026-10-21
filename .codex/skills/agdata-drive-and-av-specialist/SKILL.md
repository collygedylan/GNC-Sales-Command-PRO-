---
name: agdata-drive-and-av-specialist
description: Maintain AgData Drive Mode, AV, Inventory, inventory metrics, drill-downs, and EXPORT EXCEL using complete authorized snapshots.
---

# Drive, AV and Inventory

Drive's initial catalog and preview use the same master adapter for admin and sales reps. Warehouse assignments hydrate in the background; existing assignment-dependent card actions stay denied until authorized assignment data arrives. Normalize salesrep, sales rep and sales_rep identically.

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 3 and shared Back/navigation ownership.

Use this skill for Drive Mode, AV, Inventory and EXPORT EXCEL. Read the zero-lockout guard when changing hydration, cache or row-opening behavior.

- Hydrate the complete published DriveAround snapshot in the background, including all pages. The historical fixture has 9,487 rows and the reference inventory has 9,486+ rows and 1,566+ Common Names. These are reference sizes, never hardcoded production completeness thresholds. Compare hydration with the published snapshot row count and derive the complete A–Z Common Names index from that same authorized snapshot; never substitute a 38/75-name slice.
- Preserve the drill-down hierarchy: COMMONNAME → CONTSIZE → SEASON → location/lot cards. EXPORT EXCEL uses the complete authorized result, not only mounted cards or the current page.
- Global Back must unwind one Drive or AV open-stock drill level before delegated navigation/history; retain remaining selections and invalidate AV's resolved projection after stepping back. Root views with no history return Home. On mobile widths through 820px, keep the Drive filter rail in flow with no extra search-to-filter gap or fixed-rail spacer above `#drive-crumb`.
- Keep all six metrics on single lines: On Hand, Review, Available, Open Stock, Loc Photo Match, and Loc On Hand. Preserve their meanings and distinguish location totals from individual lot quantities.
- Compute numeric Loc On Hand deterministically across every lot with the same itemcode + locationcode in the complete same-account snapshot. A known stock total must not display `--`. Do not invent zero when data is genuinely unknown.
- Preserve PRI, quality flags ORANGE / NS 1.0 / LD, and Code / Reason / Since strips. Follow the existing source-of-truth field mappings rather than guessing substitute columns.
- Cache inventory indexes and dictionaries; opening a card must not wait for a fresh network query. Preserve user drafts while a row refresh completes.

Before changing metric math, sorting or hydration, trace ERP → published Supabase snapshot → fixture projection → rendered card. Cover aggregation across lots, full pagination, A–Z completeness and export parity with focused Node cases. Apply the release governor for changed rendering and update this skill when its contracts change.

## Owned seams and shared dependencies

- `index.html`: `rebuildMasterInventoryIndexes`, `getMasterInventoryExactKey`, `getCardLocationOnHandValue`, `getCardLocationOnHandServerAggregate`, `renderAV`, `renderDrive`, `buildAVExportContext`, `exportCurrentAVToExcel`, `buildDriveCurrentExportContext`, `exportCurrentDriveModeToExcel`. Drill navigation uses `backToDriveNames`, `backToDriveSizes`, `backToDriveSeasons`, `backToDriveBlocks`, `backToDriveLocations` and the corresponding selected Drive/AV state. These functions own the feature state, not the shared shell.
- Shared inventory state: `fullInventory`, `avOpenInventory`, `masterInventoryById`, `masterInventoryByExactKey`, `masterInventoryByItemCode`, `masterInventoryByItemLocationOnHand`, and `productionDisplayMasterReceipt`. Authoritative location totals require the matching account/permission/revision receipt or a complete authorized snapshot; incomplete data stays unknown. Rebuild indexes coherently before publishing returned-row updates.
- DOM: `#view-drive`, `#drive-content`, `#drive-crumb`, `#drive-drill-tabs`, `#drive-mobile-mode`, `#view-av`, `#av-content`, `#av-search`, `#av-export-btn`. Preserve COMMONNAME / LOCATION / CARD / REPORTS and the AV Open Stock / My Reserves routes.
- Feature helpers: `assets/inventory-list-contract.js`, `assets/queue-inventory-hydration.js`, `assets/drive-demand-detail.js`, and `assets/live-sync-registry.js` / `live-sync-adapters.js`. `inventory_read` (`master_page`, `master_identity_batch`, `source_freshness`) and `av_read` use `app-api`, `_shared/inventory-projections.ts`, `_shared/inventory-location-on-hand.ts`, `ph_master_inventory` and `inventory_location_on_hand_read_v1`; `Code.gs` `buildMasterPayload` / `buildMasterBulkSnapshotPayload_` own upstream ERP normalization.
- Shared shell: keep `switchView`, `showOnlyPrimaryView`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, and `viewHistoryStack` intact. Drive drill Back and global Back are different levels: update both feature selection state and the existing navigation hooks instead of hiding or duplicating `#global-header-inline-back`.

## Scoped pure Node verification

```sh
node --test tests/inventory-card-location-on-hand.test.mjs tests/inventory-drill-navigation.test.mjs tests/drive-search-location.test.mjs
```

These are local source/VM tests, not browser, export-layout or production-volume benchmarks. Target `< 10s`, unmeasured until actually run. Choose the relevant subset; full volume/browser checks stay nightly unless explicitly requested. The docs-only verification override takes precedence. See the canonical module map, cluster 3, for the complete dependency tables.
