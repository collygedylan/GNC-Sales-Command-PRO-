---
name: agdata-access-and-permission-matrix
description: Maintain the live capability, module-view and per-Sales-Rep Y/N editor and synchronous Request roster.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# access and permission matrix

Read [the canonical module dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and symbol index before editing.

## Owned Files, Canonical Functions & SQL Contracts

- Runtime: assets/app-runtime.js and declaration-only assets/row-workflow-functions.js; access editor: assets/user-access-control.js. Canonical functions: resolveUserAccessMatrix, renderAccessMatrix, canRequestSalesRep.
- Server: supabase/functions/_shared/user-access-matrix.ts, app-api user_access, public.user_access, public.save_user_access_matrix_v23119 and suspend_tag_private.publish_inventory_evidence_v23119. Reuse public.save_drive_evidence_v3; never grant direct evidence-table writes.

## Cross-Layer Blast Radius

Code.gs delivery, private access credentials and outbox contracts stay intact. SQL rechecks the active profile and exact row assignment; app-api verifies native sessions and command identity. Browser matrix data is display state, never mutation authority. Preserve same-account SWR/LKG rows, drafts, and durable Request submission. The new bounded authenticated GET /rest/v1/user_access uses only the sanitized relation and its exact fixture.

Shared switchView, goBackUniversal, updateGlobalBackButton, viewHistoryStack and header/search ownership remain canonical; never recreate global Back/navigation.

## Scoped Node verification

```sh
node --test tests/golden-invariants.test.mjs tests/role-access-parity.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- Never accept a blank Reclass Explanation from a non-exempt account or drop it between UI, SQL history, outbox and report rendering. Reclass Explanation is always visible and mandatory per staged/submitted row for every non-admin role. Only normalized admin/super-admin roles and canonical dylan_collyge are exempt; show Optional for Admin for them. Keep per-row drafts and confirmation text, validate the authoritative saved profile on the server, and persist exact-row explanations in ph_reclass_history and durable outbox email/PDF reports.
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- v2.3.139 CI: Never import a test-registering .test.mjs file from a shared contract. Keep permissionFixture in a pure helper so nested suites cannot be cancelled by their parent on hosted Node runners (Invariant 373).
- v2.3.139: Never interpret view_all_requests as a module view or infer pending visibility from edit permissions/role scope. Its top-level Y/N controls all pending rows versus canonical Assigned Items Effective Worker itemcodes plus the submitting actor; preserve the documented super-admin/Dylan/Nelly/JD fail-safe, aliases, explicit N for other users, immediate role/user cascades and rollback. Roster users awaiting password setup remain editable for this display capability without enabling their logins or other mutations. Invariants 371–372 enforce display scope and isolated saves. No production assignments or requests may be mutated by verification.
- v2.3.138: Never distinguish nelly_aguilar, nally_aguilar and nelly_aguliar. Authorized Request queue roles view the full pending roster; preserve explicit capability denials and exact-row mutation gates (Invariant 358).
- v2.3.131: Never route a table pill outside the shared Table Management selector, duplicate maintained tables on the Manager Modules grid, inject white surfaces, or let nested viewport heights scroll controls away. Keep original editor controllers and capability checks, same-account cached rows, and a single row-scroll region with pinned headers (Invariants 327–329).

- Never rebuild the Sales Rep roster for every generic search token. Reuse the display index and bounded cache, invalidating both on safe-roster changes (Invariant 309).

- Never create a separate Sales Rep from a known person’s territory suffix or lose an explicit N while merging alias keys. Canonical options and SQL keys retain physical customer/consignee IDs (Invariant 306). Cache only Auth-verified identity for at most 60 seconds and JWT expiry; recheck live cutoff/capabilities, retain SQL authorization, and invalidate on access writes including concurrent cache fills (Invariant 307).

- Never report a role save count from the active login directory subset; the canonical matrix receipt includes every affected role row, including roster-only users. Invariant 305 counts the committed receipt.

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.
- Reset permission-save locks when the account changes; a stale receipt must never clear the new account's pending lock (Invariant 295).

- v2.3.127: Never confuse changing a legacy role baseline with updating public.user_access. The explicit role mode atomically cascades one Y/N permission to all matching users through save_access_permission_v23127; user mode changes one user only. Keep revisions, request receipts, active administrator checks, account-fenced replies, optimistic rollback, sticky identities/headers and the synchronous Request rep picker. tests/access-permission-workspace.test.mjs covers this behavior.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Maintain the live capability, module-view and per-Sales-Rep Y/N editor and synchronous Request roster.

### Exact ownership
- assets/app-runtime.js: module contract.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- assets/user-access-control.js: resolveUserAccessMatrix, canRequestSalesRep.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-access-and-permission-matrix, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-access-and-permission-matrix.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
