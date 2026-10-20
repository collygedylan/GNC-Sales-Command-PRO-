---
name: agdata-zero-lockout-guard
description: Preserve authorized same-account AgData views, session continuity and immediate row/modals during imports, background refreshes and legacy cache upgrades.
---

# Authorized stale-while-revalidate views

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

Cover refresh failure, interrupted imports, account changes, confirmed revocation, modal drafts and cache-upgrade behavior in the appropriate focused tests. Apply the release governor for changed rendering. This skill describes required behavior; it does not certify the current runtime without evidence.
