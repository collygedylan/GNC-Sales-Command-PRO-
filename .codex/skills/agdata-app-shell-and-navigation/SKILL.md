---
name: agdata-app-shell-and-navigation
description: Maintain AgData's shared view router, Back navigation, header/search ownership, bottom shortcuts, menu, modal navigation and theme chrome. Use for shared shell changes and navigation effects of feature changes.
---

# App shell and navigation

Read [Cluster 1 and the Back visibility trace](../../../docs/architecture/agdata-module-dependency-map.md#cluster-1-global-app-shell-view-router-and-navigation-stack) before changing shared navigation. The map is a static source audit; it does not claim a browser reproduction.

## Owned files and core functions

- `assets/app-runtime.js`: `switchView`, `showOnlyPrimaryView`, `syncCurrentViewBodyClass`, `runDirectTrackedNavigation`, `getCurrentVisibleViewId`, `pushViewHistoryEntry`, `peekPreviousViewHistoryEntry`, `pruneViewHistoryStack`, `fastBackToView`, `goBackUniversal`, `getGlobalBackState`, `applyGlobalBackState`, `updateGlobalBackButton`, `getVisibleSecondaryBack`, `syncGlobalModalBack`, `initializeModalBackNavigation`, `initializeNativeBackNavigation`, `getGlobalHeaderChromeState`, `syncGlobalHeaderChrome`, `installAmazonHeaderChrome`, `setMenuOpenState`, `toggleMenu`, `updateFooterNavState`, `configureNavigationPreferences`, `buildFastInvokeAttrs`.
- `assets/navigation-preferences.js`: `normalizedShortcuts`, `allowed`, `permitted`, `adopt`, `call`; public `GncNavigationPreferences.configure`, `refresh`. `assets/mobile-workspace.js`: `activationFor`, `GncMobileWorkspace.syncHub`. `assets/ops-precision-pilot.js` and `assets/ops-precision-pilot.css`: shell/theme class and chrome styling ownership. Keep compiled source/build ownership in mind before editing generated assets.
- Backend boundary: `navigation_preferences` and `user_access` actions in `supabase/functions/app-api/index.ts`, with their shared handlers and migrations. Shared shell routing does not own `Code.gs` import or email functions; it only exposes the sync entry point owned by the sync skill.

`index.html` owns the DOM and ordered asset tags; `assets/app-runtime.js` retains the classic-script public handlers required by inline controls. Extracted CSS must preserve source cascade order, style IDs, media attributes and relative URL resolution. Syntax and static-source checks include linked runtime sources through `scripts/composed-app-source.mjs` (`readComposedAppSource`); file-size checks read the raw shell. Production compilation still owns the deferred runtime boot and its final execution marker.

## Shared component dependencies and invariants

- `currentPrimaryViewId`, `body.dataset.currentView`, `current-view-*` classes, `#view-*` visibility and the lifecycle's active view must agree. Use the shared router instead of directly toggling one feature root.
- Preserve `viewHistoryStack` (bounded to 40 entries), scroll restoration, each feature's drill state and detail draft. Back closes the active drawer/modal/filter or feature drill before falling through to another view; do not replace `goBackUniversal` with a generic browser-history call.
- `#global-header-inline-back` is the central control; `#global-header-search-row` owns its visibility. Local `[data-secondary-back]` controls are hidden deliberately and delegated through the global control. Their handlers must remain reachable even while visually hidden.
- `#global-back-btn` is a legacy lookup, not the current markup. `getVisibleSecondaryBack` checks active view/open modal and ancestor visibility while intentionally allowing the control's own CSS-hidden state. `syncGlobalModalBack` can promote the actual global button to a manual popover/top layer; this is an exception to ordinary Home header collapse.
- From v2.3.18, `getGlobalBackState` / `applyGlobalBackState` own Back visibility for both header and modal synchronization. Every non-Home view enables the control before focused-search/signature/deferred chrome exits. Remove the `popover` attribute and stale hidden/display/disabled state when no modal owns it, even when the Popover API is unavailable. The `global-back-active` body class reveals Home's row only when a Home drill/selection/modal needs Back; plain Home retains its identity header. Open modals can promote Back to the top layer.
- Update primary view, body dataset/class and DOM visibility synchronously before lifecycle callbacks. Back resolves modal/wizard first, then active surface and one feature drill step, delegated local navigation, previous history, then Home. Mobile Drive uses an in-flow filter rail and zero extra command-to-filter gap; release old fixed spacers rather than reserving the rail twice.
- Post-login Home entry and same-view navigation must explicitly reveal the primary view and its wrapper before rendering. A preset `currentPrimaryViewId` does not establish that the DOM is mounted. Preserve account-authorized dynamic footer handlers for Manager, Docks and Queue.
- Preserve the mounted search input node and focus during chrome synchronization, breadcrumb indexes, modal popover navigation, fixed Home/Menu/Comm shortcuts, role filtering and account-bound preferences. Coordinate auth/session effects with the zero-lockout skill; AURA controls must not replace the header's Back/search ownership.

## Scoped Node verification

```sh
node --test tests/inventory-drill-navigation.test.mjs tests/login-navigation-preferences.test.mjs tests/live-pilot.test.mjs
```

Target under 10 seconds; select only affected files when fewer suffice. These Node/VM checks cover drill transitions, permission/shortcut integration and static shell CSS contracts. They do not prove rendered Back visibility or browser layout. No new timing measurement is claimed by this audit; browser work requires the task's explicit authorization or Nightly selection.

Background renderHome calls return when Home is not the visible view, preserving the active Manager module. The mounted canonical access editor owns its DOM and is retained during Manager refreshes.

Verified login mounts Home once before background refresh awaits. Later access readiness updates role chrome and signals hydration without remounting Home or resetting an active navigation. Manager Approval and Comm share the assigned-rep Suspend inbox and existing global Back ownership.

## Request completion and foreground continuity

Active authenticated sessions keep the current shell during worker updates and foreground restoration. Drive refresh preserves its drill state; Home entry retains the existing explicit navigation reset. app-shell-style-15.css owns forest footer colors, mint inactive labels, emerald active buttons, crimson Bloom clear, dark missing-photo surfaces and unclipped source filenames. Preserve shared Back/history/header ownership. Focused coverage: release-app-lifecycle.test.mjs and inventory-drill-navigation.test.mjs.

## Manager report Back and deferred reads

Global Back delegates Eval2 BLOCK / LOCATION drill state before leaving the module: ITEMCODE cards -> LOCATIONCODE -> BLOCK ALPHA -> Manager Modules -> Home. ITEMCODES returns to Modules. cancelManagerModuleReads cancels report-page reads and workers on setHomeTab, openManagersModules and switchView exits; renderManagers returns when Manager is inactive. Late item-inquiry reads must verify the same view, account and module generation before opening a modal. Retain Eval2 filter controls themselves, including native disclosure state, during background renders. Preserve viewHistoryStack and shared header/search ownership.

## Desktop shell recovery

Desktop/mobile shell structure is owned by the final blocking assets/app-styles.css. Header identity, compact version, theme and sync status remain horizontal; the footer remains mounted. Home uses two columns below 1024px and three above, with 96–130px rectangular cards and a 1120px maximum width; content scrolls instead of stretching or clipping. The eleven-entry HOME_MODULE_REGISTRY retains canonical authorization, and Sales Office uses an inline SVG. Base/pilot/authority CSS is blocking so a missed link onload cannot leave the shell unstyled. Preserve shared Back/search ownership and keyboard footer behavior. Focused Node coverage: role-access-parity and release-app-lifecycle; static contracts are not browser render measurements.

## Watchdog and active queue continuity

WATCHDOG MONITOR uses the shared setHomeTab and goBackUniversal/openManagersModules path. Archived request compatibility links route to historical-requests, outside active Que. Keep forest-green #041a10 through dark prepaint, login/session restore and the main surface. Manager module cards must paint their actual labels instead of content-visibility placeholders.
