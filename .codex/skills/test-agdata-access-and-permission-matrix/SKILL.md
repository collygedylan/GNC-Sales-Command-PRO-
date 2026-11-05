---
name: test-agdata-access-and-permission-matrix
description: Maintain the live capability, module-view and per-Sales-Rep Y/N editor and synchronous Request roster.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# access and permission matrix

Read [the canonical module dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) and symbol index before editing.

## Owned Files, Canonical Functions & SQL Contracts

- Runtime: test/assets/app-runtime.js and declaration-only test/assets/row-workflow-functions.js; access editor: test/assets/user-access-control.js. Canonical functions: resolveUserAccessMatrix, renderAccessMatrix, canRequestSalesRep.
- Server: test/supabase/functions/_shared/user-access-matrix.ts, app-api test_user_access, public.test_user_access, public.test_save_user_access_matrix_v23119 and test_suspend_tag_private.publish_inventory_evidence_v23119. Reuse public.test_save_drive_evidence_v3; never grant direct evidence-table writes.

## Cross-Layer Blast Radius

test/workers/email/Code.gs delivery, private access credentials and outbox contracts stay intact. SQL rechecks the active profile and exact row assignment; app-api verifies native sessions and command identity. Browser matrix data is display state, never mutation authority. Preserve same-account SWR/LKG rows, drafts, and durable Request submission. The new bounded authenticated GET /rest/v1/test_user_access uses only the sanitized relation and its exact fixture.

Shared switchView, goBackUniversal, updateGlobalBackButton, viewHistoryStack and header/search ownership remain canonical; never recreate global Back/navigation.

## Scoped Node verification

```sh
node --test test/tests/golden-invariants.test.mjs test/tests/role-access-parity.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated test_store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- v2.3.139 CI: Never import a test-registering .test.mjs file from a shared contract. Keep permissionFixture in a pure helper so nested suites cannot be cancelled by their parent on hosted Node runners (Invariant 373).
- v2.3.139: Never interpret test_view_all_requests as a module view or infer pending visibility from edit permissions/role scope. Its top-level Y/N controls all pending rows versus canonical Assigned Items Effective Worker itemcodes plus the submitting actor; preserve the documented super-admin/Dylan/Nelly/JD fail-safe, aliases, explicit N for other users, immediate role/user cascades and rollback. Roster users awaiting password setup remain editable for this display capability without enabling their logins or other mutations. Invariants 371–372 enforce display scope and isolated saves. No production assignments or requests may be mutated by verification.
- v2.3.138: Never distinguish nelly_aguilar, nally_aguilar and nelly_aguliar. Authorized Request queue roles view the full pending roster; preserve explicit capability denials and exact-row mutation gates (Invariant 358).
- v2.3.131: Never route a table pill outside the shared Table Management selector, duplicate maintained tables on the Manager Modules grid, inject white surfaces, or let nested viewport heights scroll controls away. Keep original editor controllers and capability checks, same-account cached rows, and a single row-scroll region with pinned headers (Invariants 327–329).

- Never rebuild the Sales Rep roster for every generic search token. Reuse the display index and bounded cache, invalidating both on safe-roster changes (Invariant 309).

- Never create a separate Sales Rep from a known person’s territory suffix or lose an explicit N while merging alias keys. Canonical options and SQL keys retain physical customer/consignee IDs (Invariant 306). Cache only Auth-verified identity for at most 60 seconds and JWT expiry; recheck live cutoff/capabilities, retain SQL authorization, and invalidate on access writes including concurrent cache fills (Invariant 307).

- Never report a role save count from the active login directory subset; the canonical matrix receipt includes every affected role row, including roster-only users. Invariant 305 counts the committed receipt.

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.
- Reset permission-save locks when the account changes; a stale receipt must never clear the new account's pending lock (Invariant 295).

- v2.3.127: Never confuse changing a legacy role baseline with updating public.test_user_access. The explicit role mode atomically cascades one Y/N permission to all matching users through test_save_access_permission_v23127; user mode changes one user only. Keep revisions, request receipts, active administrator checks, account-fenced replies, optimistic rollback, sticky identities/headers and the synchronous Request rep picker. test/tests/access-permission-workspace.test.mjs covers this behavior.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.
