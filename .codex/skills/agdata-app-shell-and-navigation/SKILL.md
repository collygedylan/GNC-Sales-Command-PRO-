---
name: agdata-app-shell-and-navigation
description: Maintain AgData's shared view router, Back navigation, header/search ownership, bottom shortcuts, menu, modal navigation and theme chrome. Use for shared shell changes and navigation effects of feature changes.
---

# App shell and navigation

Read [Cluster 1 and the Back visibility trace](../../../docs/architecture/agdata-module-dependency-map.md#cluster-1-global-app-shell-view-router-and-navigation-stack) before changing shared navigation. The map is a static source audit; it does not claim a browser reproduction.

## Owned files and core functions

- `index.html`: `switchView`, `showOnlyPrimaryView`, `syncCurrentViewBodyClass`, `runDirectTrackedNavigation`, `getCurrentVisibleViewId`, `pushViewHistoryEntry`, `peekPreviousViewHistoryEntry`, `pruneViewHistoryStack`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, `getVisibleSecondaryBack`, `syncGlobalModalBack`, `initializeModalBackNavigation`, `initializeNativeBackNavigation`, `getGlobalHeaderChromeState`, `syncGlobalHeaderChrome`, `installAmazonHeaderChrome`, `setMenuOpenState`, `toggleMenu`, `updateFooterNavState`, `configureNavigationPreferences`, `buildFastInvokeAttrs`.
- `assets/navigation-preferences.js`: `normalizedShortcuts`, `allowed`, `permitted`, `adopt`, `call`; public `GncNavigationPreferences.configure`, `refresh`. `assets/mobile-workspace.js`: `activationFor`, `GncMobileWorkspace.syncHub`. `assets/ops-precision-pilot.js` and `assets/ops-precision-pilot.css`: shell/theme class and chrome styling ownership. Keep compiled source/build ownership in mind before editing generated assets.
- Backend boundary: `navigation_preferences` and `user_access` actions in `supabase/functions/app-api/index.ts`, with their shared handlers and migrations. Shared shell routing does not own `Code.gs` import or email functions; it only exposes the sync entry point owned by the sync skill.

## Shared component dependencies and invariants

- `currentPrimaryViewId`, `body.dataset.currentView`, `current-view-*` classes, `#view-*` visibility and the lifecycle's active view must agree. Use the shared router instead of directly toggling one feature root.
- Preserve `viewHistoryStack` (bounded to 40 entries), scroll restoration, each feature's drill state and detail draft. Back closes the active drawer/modal/filter or feature drill before falling through to another view; do not replace `goBackUniversal` with a generic browser-history call.
- `#global-header-inline-back` is the central control; `#global-header-search-row` owns its visibility. Local `[data-secondary-back]` controls are hidden deliberately and delegated through the global control. Their handlers must remain reachable even while visually hidden.
- `#global-back-btn` is a legacy lookup, not the current markup. `getVisibleSecondaryBack` checks active view/open modal and ancestor visibility while intentionally allowing the control's own CSS-hidden state. `syncGlobalModalBack` can promote the actual global button to a manual popover/top layer; this is an exception to ordinary Home header collapse.
- In v2.3.17, Home CSS hides the entire global search row with `display:none!important`; changing the child's `hidden` class cannot reveal it. `updateGlobalBackButton` and `syncGlobalHeaderChrome` have different Home visibility rules. Non-Home CSS explicitly shows the global row/button, so a universal cross-view disappearance is not established by the static audit.
- Preserve the mounted search input node and focus during chrome synchronization, breadcrumb indexes, modal popover navigation, fixed Home/Menu/Comm shortcuts, role filtering and account-bound preferences. Coordinate auth/session effects with the zero-lockout skill; AURA controls must not replace the header's Back/search ownership.

## Scoped Node verification

```sh
node --test tests/inventory-drill-navigation.test.mjs tests/login-navigation-preferences.test.mjs tests/live-pilot.test.mjs
```

Target under 10 seconds; select only affected files when fewer suffice. These Node/VM checks cover drill transitions, permission/shortcut integration and static shell CSS contracts. They do not prove rendered Back visibility or browser layout. No new timing measurement is claimed by this audit; browser work requires the task's explicit authorization or Nightly selection.
