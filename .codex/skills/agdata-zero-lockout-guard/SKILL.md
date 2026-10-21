---
name: agdata-zero-lockout-guard
description: Preserve authorized same-account AgData views, session continuity and immediate row/modals during imports, background refreshes and legacy cache upgrades.
---

# Authorized stale-while-revalidate views

The canonical full-app administrators are exactly `dylan_collyge`, `megan_kelly`, and `jd_jones`. Their active authenticated profiles receive every canonical operational flag and registered application capability; the admin role baseline enables every operational flag. `can_manage_user_access` is an account grant for those three only, enforced by client, app-api, SQL command gate and protected access rows. Never infer this identity from a display name, arbitrary payload or unverified session. Confirmed disabled/locked profiles and account switches remain security boundaries. See `20261021035500_full_app_administrators_v1.sql`, `canonical-user-access.ts`, and `isFullAppAdministrator`.

Account reset and suspension must detach aborted coordinator promises immediately. A transport that ignores cancellation cannot retain the next account's render lock; late completion must neither publish old rows nor clear a newer run.

Apply across screens, tabs, modules, Row Details and Reclass. During import or transient permission/session refresh, retain same-account loaded data and use the latest completed READY snapshot. Do not disable Manager or Docks bottom navigation for a background check.

Do not introduce the following lockout gates:

- Verifying updated access / Your access changed. Previous data is hidden...
- Drive Inventory unavailable
- Data could not be verified. Retry when the service is available.
- Showing saved data - Needs attention - Retry
- Load Failed: An import was interrupted
- Row Details Unavailable

Open Row Details and Reclass immediately from the displayed card. Refresh the exact row in the background without overwriting dirty fields, selected rows or drafts. Retain valid same-account loaded data through legacy cache upgrades and purge stale v2.1.x Service Worker caches on boot without clearing unrelated current user work.

Reclass submission must not await a client cache revision or permission refresh. Bind the draft to its original authenticated account and let the atomic server operation verify current authorization and exact source identity; genuine source conflicts retain the draft for correction.

Preserve an authenticated session through transient refresh failures. Explicit Log Out / Use another account and confirmed server-side role revocation remain real access boundaries. Never expose another account's cache, ignore a confirmed revocation, weaken RLS, fabricate a valid server session or permit unauthorized writes. Retaining visible authorized data does not authorize new backend actions.

Keep account/session read identity separate from the mutable permission revision learned by background reads. Explicitly authenticated, non-denied same-account view loads may render a server-authorized snapshot while the independent access snapshot refreshes; exact permission hashes still govern verified caches and write freshness. Home must mount before the login overlay dismisses, and published dataset timestamps may populate its status while bounded filename reads finish.

Cover refresh failure, interrupted imports, account changes, confirmed revocation, modal drafts and cache-upgrade behavior in the appropriate focused tests. Apply the release governor for changed rendering. This skill describes required behavior; it does not certify the current runtime without evidence.

## Ownership and dependency boundary

- Owned frontend seams: `index.html` — `getNativeAuthSession`, `refreshNativeRoleAndCapabilities`, `clearInMemorySessionIdentity`, `initializeAppAccessSnapshot`, `loadFromCache`, `saveToCache`, `getSupabaseReadIdentityScope`, `getProductionLiveSyncContext`, `resetProductionLiveSync`. Read/write bindings also touch `assets/user-access-control.js` (`configure`, `loadSelf`, `getEffectiveUserPermissions`), `assets/bounded-snapshot-cache.js`, and the owned Service Worker lifecycle in `assets/app-lifecycle.js`.
- Coordinator implementation: `assets/live-sync-coordinator.js` — `createCoordinator`, `readSourceToken`, `isReadableSource`, `isPublishedReadable`; lifecycle owners: `AgMetricLifecycle.resetSession`, `enterView`, `createScope`. Their auth epoch, identity scope, permission version and source revision must travel together. Never replace a same-account display receipt with an unverified cross-account cache.
- Backend boundaries: `app-api` actions `native_session_bridge`, `user_access`, `inventory_read`, `dataset_read`; `supabase/functions/_shared/canonical-user-access.ts`, `app-auth.ts`, and canonical `user_access_command_v1` / `user_access_control` authorization. Cache retention does not bypass those server checks.
- Shared shell dependency: `switchView`, `showOnlyPrimaryView`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, `viewHistoryStack`, and `#global-header-inline-back` belong to the shell. Preserve their call order when resetting a session or restoring a view; do not add per-feature back-button/CSS overrides. `#global-back-btn` is a separate legacy control, not a replacement for the inline header Back control.

## Scoped pure Node verification

For changes to these seams, select only the relevant files from:

```sh
node --test tests/release-app-lifecycle.test.mjs tests/live-sync-coordinator.test.mjs tests/live-sync-priority-cache.test.mjs
```

These use local fixtures/VMs without a browser or database. Target `< 10s`; this is a budget, not a measured pass. For a docs-only task follow its verification override; do not run these automatically. See `docs/architecture/agdata-module-dependency-map.md`, cluster 2, for source anchors and the full component map.
