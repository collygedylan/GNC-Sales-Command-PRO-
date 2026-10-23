---
name: agdata-zero-lockout-guard
description: Preserve authorized same-account AgData views, session continuity and immediate row/modals during imports, background refreshes and legacy cache upgrades.
---

# Authorized stale-while-revalidate views

The canonical full-app administrators are exactly `dylan_collyge`, `megan_kelly`, and `jd_jones`. Their active authenticated profiles receive every canonical operational flag; the admin role baseline enables every operational flag. AURA has a separate canonical Dylan-only owner guard across UI, capabilities, Edge endpoints and database RPCs. `can_manage_user_access` is an account grant for those three only, enforced by client, app-api, SQL command gate and protected access rows. Never infer this identity from a display name, arbitrary payload or unverified session. Confirmed disabled/locked profiles and account switches remain security boundaries. See `20261021035500_full_app_administrators_v1.sql`, `canonical-user-access.ts`, and `isFullAppAdministrator`.

The extracted watchdog panel also owns cached state by verified account and auth epoch; its badge/list share a single pending read and stale view/host generations cannot repaint a later screen.

Account reset and suspension must detach aborted coordinator promises immediately. A transport that ignores cancellation cannot retain the next account's render lock; late completion must neither publish old rows nor clear a newer run.

View changes also detach the obsolete foreground promise while retaining same-account applied snapshots. New read generations must not await a cancelled earlier transport; generation/identity checks reject its late results. Drive's master-only preview follows the same display-only contract as AV.

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

During a same-account permission refresh, keep the selected Manager module and its last rendered DOM while the access snapshot is stale or loading. Once a fresh snapshot confirms that the module is no longer authorized, return to the Manager dashboard; confirmed account denial still follows the normal access boundary.

Keep account/session read identity separate from the mutable permission revision learned by background reads. Explicitly authenticated, non-denied same-account view loads may render a server-authorized snapshot while the independent access snapshot refreshes; exact permission hashes still govern verified caches and write freshness. Home must mount before the login overlay dismisses, and published dataset timestamps may populate its status while bounded filename reads finish.

Cover refresh failure, interrupted imports, account changes, confirmed revocation, modal drafts and cache-upgrade behavior in the appropriate focused tests. Apply the release governor for changed rendering. This skill describes required behavior; it does not certify the current runtime without evidence.

## Server verification and signed actions

Every non-login app-api action requires a non-expired server-verified session; the dedicated password-change reconciliation path also requires a verified identity. Resolve active canonical access and actor identity on the server. Client actor, username, role and administrator fields never grant authority. Failed-login throttling uses keyed username/IP digests and a service-role-only RPC; it must never throttle active-session reads or actions. Browser Apps Script actions use the authenticated `apps_script_action` gateway with its explicit action/capability allowlist and signed server actor. Transient verification errors preserve same-account rendered caches and drafts.

## Ownership and dependency boundary

- Owned frontend seams: `assets/app-runtime.js` — `getNativeAuthSession`, `refreshNativeRoleAndCapabilities`, `clearInMemorySessionIdentity`, `initializeAppAccessSnapshot`, `loadFromCache`, `saveToCache`, `getSupabaseReadIdentityScope`, `getProductionLiveSyncContext`, `resetProductionLiveSync`. Read/write bindings also touch `assets/user-access-control.js` (`configure`, `loadSelf`, `getEffectiveUserPermissions`), `assets/bounded-snapshot-cache.js`, and the owned Service Worker lifecycle in `assets/app-lifecycle.js`.
- Coordinator implementation: `assets/live-sync-coordinator.js` — `createCoordinator`, `readSourceToken`, `isReadableSource`, `isPublishedReadable`; lifecycle owners: `AgMetricLifecycle.resetSession`, `enterView`, `createScope`. Their auth epoch, identity scope, permission version and source revision must travel together. Never replace a same-account display receipt with an unverified cross-account cache.
- Backend boundaries: `app-api` actions `native_session_bridge`, `user_access`, `inventory_read`, `dataset_read`; `supabase/functions/_shared/canonical-user-access.ts`, `app-auth.ts`, and canonical `user_access_command_v1` / `user_access_control` authorization. Cache retention does not bypass those server checks.
- Shared shell dependency: `switchView`, `showOnlyPrimaryView`, `fastBackToView`, `goBackUniversal`, `updateGlobalBackButton`, `viewHistoryStack`, and `#global-header-inline-back` belong to the shell. Preserve their call order when resetting a session or restoring a view; do not add per-feature back-button/CSS overrides. `#global-back-btn` is a separate legacy control, not a replacement for the inline header Back control.

## Scoped pure Node verification

For changes to these seams, select only the relevant files from:

```sh
node --test tests/release-app-lifecycle.test.mjs tests/live-sync-coordinator.test.mjs tests/live-sync-priority-cache.test.mjs
```

These use local fixtures/VMs without a browser or database. Target `< 10s`; this is a budget, not a measured pass. For a docs-only task follow its verification override; do not run these automatically. See `docs/architecture/agdata-module-dependency-map.md`, cluster 2, for source anchors and the full component map.

The canonical access editor retains its DOM and verified same-account administrator controls through background permission refresh; confirmed denial still disables access. Reclass delivery trays are cleared during logout.

After identity verification, finalizeLogin reveals Home before awaiting capability, permission, mapping or dataset refresh. Transient access refresh failure retains the authenticated shell; confirmed revocation continues through the canonical access path. Request revision drift keeps complete same-account choices usable while server-side tuple validation protects writes.

## Request completion and foreground continuity

Active same-account sessions defer Service Worker reload and mismatch recovery, including a reload queued before login completed. Transient token/session refresh loss retains the visible shell and cached identity; confirmed disabled or locked profiles still clear access. Foreground restoration preserves the current view. Request save receipt acceptance checks account scope without rejecting a committed result solely because permission revision advanced. Focused coverage: release-app-lifecycle.test.mjs and request-submission-durability.test.mjs.

Same-version runtime releases must advance the service-worker runtime/cache revision while retaining the visible AgData badge. Reclass stock r1 refreshes shell assets with the existing reload-cache installer and preserves authenticated account data, drafts, and inactive-client navigation rules.

## Desktop shell recovery

The explicit v2.3.38 cache upgrade uses agdata-v2.3.38, skipWaiting, all-prior Cache Storage deletion and clients.claim. Version every shell CSS/JS URL consistently, including compiled assets and precache entries. This release clears Cache Storage only; retain authenticated snapshots, session storage, IndexedDB and drafts. Existing active-session reload deferral and shared router/Back ownership remain unchanged.

## Watchdog and active queue continuity

Queue rendering bypasses shared full-screen loading/error gates and refreshes through its existing authorized coordinator. Explicit navigation/Retry clears transport cooldowns without granting access or changing mutation authorization. Retain same-account row snapshots and complete inventory receipts during refresh.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `getNativeAuthSession`, `initializeAppAccessSnapshot`, `showOnlyPrimaryView`, retained snapshot/cache ownership; `assets/runtime-watchdog.js`: `capture`; app-api: `handleNativeSessionBridge`, `handleInventoryRead`, `handleDatasetRead` and fail-open read responses.
- SQL READY/LKG proofs, RLS, confirmed profile revocation, and atomic mutation authorization remain server-owned; `security_invoker = true` is mandatory for public views.

## Cross-Layer Blast Radius

- For authorized same-account flows, `user_access`, `native_session_bridge`, `season_sales_office`, `dataset_read`, `av_read`, customer mapping, AURA, `report_read_v2`, `inventory_read`, `drive_reclass_inquiry`, and `inventory_reclass_move` preserve a `200` retained/success path instead of transient `401`/`403`/`409`/`423` lockouts. Confirmed denial and genuine mutation authorization remain enforced.
- Session/cache changes cross login bootstrap, shell visibility, account/permission epoch, READY revisions, Row Details/Reclass drafts, Service Worker upgrades, and watchdog evidence.

## Forbidden Anti-Patterns (Never Repeat)

- Never render a banned lockout banner, clear same-account rows on transient refresh, disable navigation during import, delay Row Details/Reclass opening, or return transient forbidden/conflict/locked statuses where a retained authorized response is possible.
- Never use fail-open display continuity to bypass RLS, confirmed revocation, exact mutation identity, recipient policy, or account isolation.
