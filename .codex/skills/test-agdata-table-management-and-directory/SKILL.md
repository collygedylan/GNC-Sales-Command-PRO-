---
name: test-agdata-table-management-and-directory
description: Maintain Manager Table Management, directory and inquiry coverage CRUD, assigned-item ownership, customer mapping, canonical user access, and read-only historical/photo archives.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Table Management and Directory

Use the [AgData module dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) for canonical symbols and cross-module callers.

Load this skill with `test-agdata-field-ops-and-qc`, `test-agdata-queue-and-reclass-specialist`, `test-agdata-suspend-tag-approval-specialist`, and `test-agdata-app-shell-and-navigation` whenever Manager table selection or one of its datasets changes.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/manager-table-management.js`: `mountManagerTableManagement`, safe table selector, paged editors for `test_ph_company_directory` and `test_ph_inquiry_coverage`, and verified user choices.
- `test/assets/app-runtime.js`: `renderManagerTableManagementPanel`, `openManagerTableManagement`, `getManagerTableManagementItems`, plus existing Assigned Items, Company Directory, Inquiry Coverage, Customer Assignments, and User & Role Access entry points. Company Directory also retains `mountCompanyDirectoryPanel` for employee contacts, blocks/beds and production codes.
- `test/assets/photo-history-v2026090401.js`: authorized gallery search, read-only badge, and bounded cursor-based Excel export; never export storage paths or signed URLs.
- Photo History is opened with a read-only bridge mode from Table Management; normal standalone Photo History retains its existing share workflow.
- `test/supabase/functions/_shared/table-management.ts`: strict request validation and `executeManagerTableManagement`.
- SQL: `test_manager_table_management_v2397`; `test_ph_company_directory`, `test_ph_inquiry_coverage`, row revisions, and `test_app_dataset_revisions` signals.
- Historical tables flow through `test_historical_archive_read_v2370` and `test_historical_requests_read_v2370`; Photo History flows through the existing separately authorized photo-history handler. Do not add archive writes or widen its explicitly approved actor set.

## Contracts

- Pin Location (locationcode) after Warehouse and before Item Code with a 135px minimum width. Prefer the direct row location and look up missing values in current inventory by exact itemcode. Count each location once per matching row and keep search, bulk selection and Excel export aligned with the filtered rows.

- Resolve the current profile and effective manager permission on the server for each mutation. Client role labels, hidden buttons, table names, and actor IDs are hints only.
- Read-only archive tables never get create, update, delete, or restore controls. The app-api rejects all non-read operations before calling a database function. Historical Drive, Open Orders, Reserves, Requests, and Photo History do not share an edit capability.
- Directory and coverage mutations use explicit column allowlists, optimistic row revisions, actor-stamped audit fields, and replay receipts keyed by a stable command UUID. A retry with changed payload under the same UUID conflicts. Never accept `access_code`, permission overrides, revisions, or audit stamps from the browser.
- Coverage's primary and backup user pickers use a bounded, server-filtered union of active `test_user_access` identities and active Company Directory users, and the write validator accepts that same union. Return username, display label, and only the email/territory fields required for the table. Never expose `test_ph_app_users`, `test_user_access_control`, credentials, or private access-code data through PostgREST.
- Preserve the existing global Sharon Here/Gone item-inquiry recipient control alongside the maintained scope coverage rows; the former has a separate canonical RPC and frozen email-recipient contract.
- Assigned Items retains its full authorized inventory and row-assignment join, one header filter system, import-owned inventory fields, and its existing manager/assigned-owner mutation rules. A zero-row/empty completion marker cannot suppress a needed current full read.
- Customer assignments continue through `customer-rep-map` and its idempotent `test_customer_rep_mapping_manage_v1` flow; never edit imported rows directly or bypass their revisions and import overrides.
- Manager-created Customer Assignment rows use the durable `test_sales_private.customer_mapping_rows_v2397` ledger and canonical create/delete operations. Deletes must preserve the reserved N/A mapping, carry expected revisions and stable request UUIDs, and survive a later import; imported source rows remain untouched.
- Request customer options are owned by exact rep/customer/consignee identity tuples. Ordinary reps see N/A plus their own active pairs; consignee options must match both the selected canonical rep and exact customer ID. Preserve each pair's physical `salesrepid` even when multiple source IDs resolve to one canonical profile. Repeated display names with distinct ERP IDs are distinct records.
- The v2.3.102 Request directory RPC (`test_request_customer_directory_v23102`) is selected-rep scoped; only the authenticated `jd_jones` actor may receive the cross-source universal directory. Its compatibility mapping view is service-role-only, and browser PostgREST must not expose the view or assignment ledger.
- Preserve imported and manager-maintained physical identity IDs. Keep the 26 true `N/A`/`N/A` tuples, remove only the audited synthetic real-customer/N/A rows, and never treat a shared display name as a reason to merge customer IDs or assignments.
- User Role and Access continues through `test_user_access` and `test_user_access_command_v1`, with its canonical administrator gate and receipt/replay behavior. Add uses the existing `auth-admin` provisioning route; profile edits use `test_update_user_access_profile_v2397`; deactivation is a soft disable through `test_deactivate_user_access_v2397`; access-code reset synchronizes Native Auth and the legacy login credential through `auth-admin`. Do not expose `access_code` in a list response, and do not edit the auth alias as a contact email; Company Directory owns contact emails.
- All Manager table transitions preserve `switchView`, `setHomeTab`, `goBackUniversal`, `updateGlobalBackButton`, header/search ownership, account scope, and the active user's last-known-good rows.

## Cross-Layer Blast Radius

`test/workers/email/Code.gs` remains the authoritative source for imported inventory, customer mapping, and warehouse ownership; no Apps Script write path is introduced. `test_manager_table_management_v2397` stores only maintained Company Directory and Inquiry Coverage records, and blocks archive writes. The app-api authenticates the actor and rechecks the active manager permission before the service-role RPC. User lifecycle writes stay on canonical User & Role Access and existing authenticated credential provisioning; profile/role changes synchronize test_profiles, legacy login and canonical directory state, while resets never return the submitted or stored access code. The runtime uses the existing authorized component/RPC for Assigned Items, Customer Assignments, User & Role Access, and historical reads, and keeps edits scoped to the current account.

No startup/background reads are added by mounting Table Management. The user directory is fetched only when the Inquiry Coverage editor is opened. Register any future startup/background source in the shared Playwright fixture allowlist in the same change.

## Focused verification

```sh
node --test test/tests/manager-table-management.test.mjs test/tests/role-access-parity.test.mjs
```

Use an isolated local Postgres check for the migration contract when available. The daytime release gate remains scoped; do not run a browser suite, full migration replay, or live production write as a substitute for an isolated check.

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.189: Never apply undisplayed search values or count options before other active facets. Shared inventory facets use same-account candidates, positive counts, visible-only bulk checks and pre-search selection restoration (Invariant 490).

- Never commit hidden values from a searched column popover. Across all headers, Apply and Enter commit only checked options displayed by the current query. Match all whitespace-separated words or a punctuation-free compact substring, and restore the pre-search selection when the query is cleared.

- Never seed filter popovers from the assignment roster or reinsert a missing selected or focused value with a zero count. Count matching rows after search and the other column filters. Select All and Clear Selection act only on displayed positive-count options. Clear Column Filter removes the constraint.

- Never squeeze Assigned Items or other Table Management filter headers into a horizontal title/control pair. Keep each title on one line above its full-width filter, with a 96px minimum control width. The table scrolls horizontally when the columns exceed the viewport.
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated test_store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, test_save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.
- Never use runtime ALTER TABLE trigger toggles for atomic ERP publication; service-role-only transaction guards preserve the bulk path without table DDL locks. Keep 55P03/57014 finalize cursors resumable and staged rows intact. Unassigned events aggregate the sorted code set with a fixed summary tag. Apps Script health compares its deployed fingerprint with the last test/workers/email/Code.gs commit, never unrelated frontend commits.
- v2.3.138 completion: Never replace inventory-backed Assigned Items with an import-error gate or wait for the warehouse join to enable an authorized RPC. Direct default-owner reads are account-fenced, paginated and merged by revision; checked-row dropdowns bulk-save only when the changed row is checked (Invariant 363).

- Legacy customer mapping role lists rejected the canonical super-admin role on reload. Keep isCustomerRepMappingEditorRole and both SQL base guards aligned on normalized SUPERADMIN while preserving active-profile checks, denied ordinary roles, revisions, idempotency and service-only execution. Invariant 341 covers aliases; use a rolled-back RPC check for SQL parity.
- Never advertise a table through the canonical native super-admin cascade while rejecting the same verified identity in its legacy route guard; preserve the Manager view gate (Invariant 327).
- Never let the generic Manager inventory hydration gate replace a consolidated table shell; each editor retains its own cache and refresh path (Invariant 327).
- Never rebuild nursery planning projections for reference-only tables or scan every inventory group to find same-item peers on each row. Keep canonical sorted peer order using an item index (Invariant 330).
- Never replace the same-account table controller during unrelated Manager refreshes or reset a maintained table scroll position during SWR; reset only when table, page or search changes (Invariant 331).
- v2.3.131: Never route a table pill outside the shared Table Management selector, duplicate maintained tables on the Manager Modules grid, inject white surfaces, or let nested viewport heights scroll controls away. Keep original editor controllers and capability checks, same-account cached rows, and a single row-scroll region with pinned headers (Invariants 327–329).

- Never replace a complete same-account assignment display with a shorter partial background preview; missing rows would falsely appear Unassigned. Invariant 304 preserves existing owners until complete publication.

- Never decode/validate a background bulk inventory snapshot over an interactive owner acknowledgment. The canonical typed bridge yields before fetching and before decoding through AgDataKernel.sync.waitForInteractiveOwnerWrites; keep cached rows, abort/account fences, and immediate permission/mutation transports (Invariant 303).

- Never rebuild the complete filtered table in the optimistic/receipt paint of an owner save. Reuse the mounted row props, repaint drafts/pending selections, and coalesce full filtering until writes settle; preserve canonical state and rollback (Invariant 302).

- Never issue a zero-row owner INSERT/UPDATE merely to confirm unchanged selections: statement triggers still invalidate datasets and contend with reads. Skip the write statement after canonical authorization and comparison, retain a durable command receipt, and return authoritative assignments (Invariant 301).

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.
- Pinned Manager workspaces must override the mobile shell overflow rule and apply only while Managers is active; retained hidden DOM must not clip another view (Invariant 296).
- Never rescan every inventory ItemCode for repeated sync adapter scope checks; reuse the canonical account/source-scoped lookup and invalidate on source replacement, size, or revision changes (Invariant 294).
- Never hide Assign All Filtered behind selection state: Selected and All Filtered remain independent explicit actions over the same canonical filtered snapshot (Invariant 293).

- v2.3.127: Never ignore checked visible itemcodes in a row owner dropdown, remap all 9,485 display rows after a complete ownership receipt, or immediately reload the whole assignment dataset after every save. Use one authorized canonical batch, preserve the acknowledged mapped cache, coalesce background refreshes, and retain rollback/stale-receipt fences. Pin the toolbar outside the only vertical table scroll area. Invariants 283–287 and 291 cover these seams.

- v2.3.126: Never serialize independent owner-relay profile, active-account/cutoff and capability reads, or repeat the same request’s capability lookup. Start them only after native Auth verifies the user; bind the resulting proof to that exact profile ID and request. Retain both canonical capability and test_app_account_active_v1 checks, legacy behavior, password/lock rejection and native SQL mutation authorization. Invariants 281–282 enforce concurrency, proof isolation and revocation.

- v2.3.125: Never route the multi-query owner replay away from the configured database region. The canonical project is in us-east-1; only its native owner replay uses forceFunctionRegion=us-east-1. Other requests keep their existing routes, and SQL authorization/idempotency remain unchanged (Invariant 280).

- v2.3.125: Never forward PostgREST-only Prefer headers to the native Edge owner relay: its browser CORS preflight rejects them before authorization runs. Strip only that header from a copied relay request; preserve the native bearer, API key, original command UUID/body and canonical PostgREST headers. Invariant 279 exercises the actual Edge allowlist.

- v2.3.125: Never repeat native profile/account-cutoff reads within an Assigned Items relay after this same request verified them. Reuse only the server-verified three-part native bearer path, exclude legacy session headers, and retain fresh canonical capabilities plus native SQL authorization. Never cache this proof across requests. Invariant 278 covers reuse, denial and legacy isolation.
- Never leave an optimistic owner mutation behind when its acknowledgment arrives after an account change; restore only captured row objects and discard the old acknowledgment.

- v2.3.122: Never let an older same-account warehouse snapshot overwrite an acknowledged owner default. Retain bounded exact-master-UID receipts with default and row revisions, reject cross-account reuse, and accept genuinely newer assignments. Invariant 266 protects this read-after-write boundary.

- v2.3.122: Never fix only the row resolver while the legacy warehouse audit trigger still vetoes explicit Perennial defaults. Preserve audit insertion and actor/RLS checks, and exercise a non-Zoe owner plus explicit Unassigned through the complete RPC inside a rolled-back transaction. Invariant 265 retains this boundary.

- v2.3.122: Never add an RPC overload without updating database.types.ts, regenerating runtime contracts and rebuilding the shared browser validator. Never synchronously rebuild all 9,485 mapped rows before starting an owner save; publish in-place optimistic fields and keep the canonical display signature current after invalidation. Invariants 263–264 cover typed requests and cached publication.

- v2.3.122: Never use stale mounted table rows for selection while toolbar counts use current filters. One filtered snapshot owns toolbar, header and table in Unique Items and All Rows, including blank defaults. Explicit owner saves optimistically update both default and effective ownership; failures roll back, and SQL explicit defaults precede zone suggestions. Invariants 258–262 preserve the behavior.


- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.test_user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared test_save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.

- v2.3.117: Never reject an authorized itemcode owner save because its client revision is stale. Serialize saves, increment the canonical owner revision in the existing RPC, return its acknowledgment, and apply that owner and revision across matching in-memory Assigned Items rows.
- Never gate loaded Assigned Items controls on whole-view background verification, or leave a removed History component in mobile cards. Keep complete identity-scoped rows interactive while server mutation authorization remains authoritative.

- v2.3.115: Never retire an owner by changing only a displayed label. Transfer canonical defaults, materialized row ownership and operational coverage together; keep public directory reads separate from private credentials. Assigned Items shares the active user directory (Invariant 216).

- Never call the rep catalog ownership helper once per customer row; materialize the catalog once and set-join rep IDs to actor profile scope for options and preload scans.

- Never expose all ten tables because a user can open Managers: build the selector from current server-backed capabilities and retain each table's own app-api and SQL authorization.
- Never route archive actions through a generic write RPC, add restore/delete affordances to a historical view, or broaden the Photo History actor set as a side effect of centralizing its menu entry.
- Never open Photo History from Table Management using its normal share mode. That archive entry is limited to view/search/filter/export; hide selection/send/status controls and guard selection and send handlers. Preserve the existing share workflow for separately opened Photo History.
- Never render an empty Assigned Items list as authoritative while a full same-account inventory/assignment read is still pending or failed transiently.
- Never rely only on the live-sync coordinator for the first cold full-master read on Assigned Items; if no completed full snapshot is present, use the cancellation-retrying direct loader so a false coordinator receipt cannot leave the table empty indefinitely.
- Never mask a malformed full inventory projection with an Assigned Items loader bypass: duplicate physical select fields make the coordinator return no snapshot while the direct loader throws. Keep the shared physical-column contract unique and keep Assigned Items on the canonical coordinator path.
- Never show a second Assigned Items mobile filter-pill grid beside the unified column-header filters. Reuse all column filter/sort triggers in one horizontally scrollable mobile header row, and keep the last complete view mounted while initial full master and assignment snapshots load.
- Never let Customer Assignments open its Add form before the authorized rep catalog is hydrated; the form captures its choices at mount time. Keep ordinary row deletes revision-checked and idempotent, and never expose deletion for the protected N/A tuple.
- Never replace the Company Directory contacts, blocks/beds, and production plant/project codes workflows with the maintained people-directory table. Keep the legacy directory reachable from its gated button and preserve its existing `canManageCompanyDirectory` authorization.
- Never expose a stored access code or treat the Native Auth alias as a contact email. User creation must provision both credential systems; access-code reset must synchronize Native Auth and the legacy login record with explicit reconciliation failure; deactivation must atomically soft-disable profile, legacy login, and canonical access, with self/last-administrator guards.
- Never let v2.3.94's global customer directory or its relabeled cache define pair ownership. Rows must be filtered from canonical source ownership, and stale `universal:true` cache entries must be ignored for non-JD actors.
- Never deduplicate customer mappings by display name or replace an option's physical Sales Rep ID with a canonical alias ID. Preserve repeated names, distinct customer/consignee IDs, and each selected row's actual source Sales Rep ID.
- Never blanket-delete rows with an N/A consignee or synthesize real-customer/N/A mappings during cleanup. Preserve genuine N/A/N/A identities and remove only rows proven synthetic by the protected audit.
- Never let REQUESTED_BY alone expand a rep's visible Request customer picker. Current folder rows must match the selected rep's active physical customer/consignee pair by IDs and names, with name-only resolution allowed only for a unique legacy pair; exclude stale real-customer/N/A-consignee cache rows and never let ordinary reps add synthetic pairs.

## v2.3.122 ownership and GDD contracts

See [Smart Moves](../test-agdata-smart-moves-and-gdd-hold-intelligence/SKILL.md) and [Shear guard](../test-agdata-shear-crew-load-and-gdd-guard/SKILL.md).

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain Manager Table Management, directory and inquiry coverage CRUD, assigned-item ownership, customer mapping, canonical user access, and read-only historical/photo archives.

### Exact ownership
- test/assets/app-runtime.js: renderManagerTableManagementPanel, openManagerTableManagement, getManagerTableManagementItems, downloadManagerRowsToExcel, openDylanPhotoHistory, renderCompanyDirectoryPanel, mountCompanyDirectoryPanel.
- test/assets/manager-table-management.js: mountManagerTableManagement.
- services/customerRepMapping.ts: mountCustomerRepMapping.
- services/customerRepAssignments.ts: createCustomerRepAssignments, prefetchCustomerRepOptions.
- test/assets/photo-history-v2026090401.js: open, toggle, send, exportAll.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: canonicalActionGate, handleCustomerRepMappingAction, handleAssignedOwnerSaveRelay.
- Code.gs: module contract.
- supabase/functions/_shared/customer-rep-mapping.ts: validateCustomerRepMappingRequest.
- supabase/functions/_shared/table-management.ts: validateManagerTableManagementRequest, executeManagerTableManagement.
- supabase/migrations/20261028221000_agdata_table_management_v2397.sql: manager_table_management_v2397, ph_manager_table_commands, ph_company_directory, ph_inquiry_coverage.
- supabase/migrations/20261028222000_agdata_customer_mapping_crud_v2397.sql: customer_rep_mapping_manage_v1, sales_private.customer_mapping_rows_v2397.
- supabase/migrations/20261029131000_agdata_v23102_directory_canonical_keys.sql: request_customer_directory_v23102, salesrepCanonicalKey.
- supabase/migrations/20261029130500_agdata_v23102_legacy_pair_scope.sql: customer_rep_mapping_manage_v1, request_customer_directory_v23102.
- supabase/migrations/20261029130000_agdata_v23102_customer_pair_ownership.sql: ph_customer_rep_map, customer_rep_catalog_v23102.
- test/assets/user-access-control.js: resolveUserAccessMatrix, normalizeAccessUsername, setAccessMatrixRows, getAccessSalesReps, canRequestSalesRep, saveAccessMatrix, preloadAccessMatrix, renderAccessMatrix, saveAccessPermission, renderAccessWorkspace, accessPermissionColumns, isSuperAdminRole.
- supabase/functions/_shared/user-access-matrix.ts: resolveUserAccessMatrix, normalizeAccessMatrixUsername, accessMatrixAllows.
- supabase/migrations/20261031010000_agdata_v23119_access_matrix_and_publication.sql: save_user_access_matrix_v23119, publish_inventory_evidence_v23119, assert_request_matrix_v23119.
- test/assets/row-workflow-functions.js: getManagerAssignedSelectionSnapshot, getManagerAssignedItemsViewProps, applyOptimisticItemcodeOwners, getManagerAssignedDisplaySignature, applyCommittedItemcodeOwnerReceipt, assignManagerCheckedItemcodes, waitForInteractiveOwnerWrites, loadManagerItemcodeDefaultOwners, renderManagerAssignedFallbackRows, enrichManagerAssignedPlantGroups.
- supabase/migrations/20261101010000_agdata_v23127_permissions_and_hold_history.sql: save_access_permission_v23127, smart_hold_context_v23127, suspend_tag_private.command.
- supabase/migrations/20261101030000_agdata_v23127_nursery_command.sql: nursery_command_v23127, nursery_schedule_import_v23127, resolve_nursery_schedule_locations_v23127.
- supabase/migrations/20261101040000_agdata_v23127_exact_planting_shield.sql: nursery_block_v23127, resolve_nursery_schedule_locations_v23127, nursery_schedule_import_v23127.
- supabase/migrations/20261101050000_v23129_super_admin_role.sql: user_access_capability_v23129, save_user_access_matrix_v23119, save_access_permission_v23127, is_full_app_administrator_v1, can_view_access_control_v2.
- services/bunch-note-pdf.mjs: buildBunchNotesBlockPdfDocument.
- supabase/functions/_shared/nursery-bunch-pdf.ts: validateNurseryPdfInput, assertNurseryPdfApprovals, renderNurseryPdf.
- test/assets/nursery-command-model.js: compile, parseBlockAllocations, rotationIndex, resolveScheduleTargets, allocatePlanting, buildBunchNoteContext, evaluateBunchNoteRowAndIssues, publishBunchDecisions, approvedBunchNote.
- test/assets/nursery-command-tables.js: mount.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_ph_company_directory, test_ph_inquiry_coverage, test_app_dataset_revisions, test_user_access, test_ph_app_users
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-table-management-and-directory, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-table-management-and-directory.

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
