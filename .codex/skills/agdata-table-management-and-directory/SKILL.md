---
name: agdata-table-management-and-directory
description: Maintain Manager Table Management, directory and inquiry coverage CRUD, assigned-item ownership, customer mapping, canonical user access, and read-only historical/photo archives.
---

# Table Management and Directory

Use the [AgData module dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for canonical symbols and cross-module callers.

Load this skill with `agdata-field-ops-and-qc`, `agdata-queue-and-reclass-specialist`, `agdata-suspend-tag-approval-specialist`, and `agdata-app-shell-and-navigation` whenever Manager table selection or one of its datasets changes.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/manager-table-management.js`: `mountManagerTableManagement`, safe table selector, paged editors for `ph_company_directory` and `ph_inquiry_coverage`, and verified user choices.
- `assets/app-runtime.js`: `renderManagerTableManagementPanel`, `openManagerTableManagement`, `getManagerTableManagementItems`, plus existing Assigned Items, Company Directory, Inquiry Coverage, Customer Assignments, and User & Role Access entry points. Company Directory also retains `mountCompanyDirectoryPanel` for employee contacts, blocks/beds and production codes.
- `assets/photo-history-v2026090401.js`: authorized gallery search, read-only badge, and bounded cursor-based Excel export; never export storage paths or signed URLs.
- Photo History is opened with a read-only bridge mode from Table Management; normal standalone Photo History retains its existing share workflow.
- `supabase/functions/_shared/table-management.ts`: strict request validation and `executeManagerTableManagement`.
- SQL: `manager_table_management_v2397`; `ph_company_directory`, `ph_inquiry_coverage`, row revisions, and `app_dataset_revisions` signals.
- Historical tables flow through `historical_archive_read_v2370` and `historical_requests_read_v2370`; Photo History flows through the existing separately authorized photo-history handler. Do not add archive writes or widen its explicitly approved actor set.

## Contracts

- Resolve the current profile and effective manager permission on the server for each mutation. Client role labels, hidden buttons, table names, and actor IDs are hints only.
- Read-only archive tables never get create, update, delete, or restore controls. The app-api rejects all non-read operations before calling a database function. Historical Drive, Open Orders, Reserves, Requests, and Photo History do not share an edit capability.
- Directory and coverage mutations use explicit column allowlists, optimistic row revisions, actor-stamped audit fields, and replay receipts keyed by a stable command UUID. A retry with changed payload under the same UUID conflicts. Never accept `access_code`, permission overrides, revisions, or audit stamps from the browser.
- Coverage's primary and backup user pickers use a bounded, server-filtered union of active `user_access` identities and active Company Directory users, and the write validator accepts that same union. Return username, display label, and only the email/territory fields required for the table. Never expose `ph_app_users`, `user_access_control`, credentials, or private access-code data through PostgREST.
- Preserve the existing global Sharon Here/Gone item-inquiry recipient control alongside the maintained scope coverage rows; the former has a separate canonical RPC and frozen email-recipient contract.
- Assigned Items retains its full authorized inventory and row-assignment join, one header filter system, import-owned inventory fields, and its existing manager/assigned-owner mutation rules. A zero-row/empty completion marker cannot suppress a needed current full read.
- Customer assignments continue through `customer-rep-map` and its idempotent `customer_rep_mapping_manage_v1` flow; never edit imported rows directly or bypass their revisions and import overrides.
- Manager-created Customer Assignment rows use the durable `sales_private.customer_mapping_rows_v2397` ledger and canonical create/delete operations. Deletes must preserve the reserved N/A mapping, carry expected revisions and stable request UUIDs, and survive a later import; imported source rows remain untouched.
- User Role and Access continues through `user_access` and `user_access_command_v1`, with its canonical administrator gate and receipt/replay behavior. Add uses the existing `auth-admin` provisioning route; profile edits use `update_user_access_profile_v2397`; deactivation is a soft disable through `deactivate_user_access_v2397`; access-code reset synchronizes Native Auth and the legacy login credential through `auth-admin`. Do not expose `access_code` in a list response, and do not edit the auth alias as a contact email; Company Directory owns contact emails.
- All Manager table transitions preserve `switchView`, `setHomeTab`, `goBackUniversal`, `updateGlobalBackButton`, header/search ownership, account scope, and the active user's last-known-good rows.

## Cross-Layer Blast Radius

`Code.gs` remains the authoritative source for imported inventory, customer mapping, and warehouse ownership; no Apps Script write path is introduced. `manager_table_management_v2397` stores only maintained Company Directory and Inquiry Coverage records, and blocks archive writes. The app-api authenticates the actor and rechecks the active manager permission before the service-role RPC. User lifecycle writes stay on canonical User & Role Access and existing authenticated credential provisioning; profile/role changes synchronize profiles, legacy login and canonical directory state, while resets never return the submitted or stored access code. The runtime uses the existing authorized component/RPC for Assigned Items, Customer Assignments, User & Role Access, and historical reads, and keeps edits scoped to the current account.

No startup/background reads are added by mounting Table Management. The user directory is fetched only when the Inquiry Coverage editor is opened. Register any future startup/background source in the shared Playwright fixture allowlist in the same change.

## Focused verification

```sh
node --test tests/manager-table-management.test.mjs tests/role-access-parity.test.mjs
```

Use an isolated local Postgres check for the migration contract when available. The daytime release gate remains scoped; do not run a browser suite, full migration replay, or live production write as a substitute for an isolated check.

## Forbidden Anti-Patterns (Never Repeat)

- Never expose all ten tables because a user can open Managers: build the selector from current server-backed capabilities and retain each table's own app-api and SQL authorization.
- Never route archive actions through a generic write RPC, add restore/delete affordances to a historical view, or broaden the Photo History actor set as a side effect of centralizing its menu entry.
- Never open Photo History from Table Management using its normal share mode. That archive entry is limited to view/search/filter/export; hide selection/send/status controls and guard selection and send handlers. Preserve the existing share workflow for separately opened Photo History.
- Never render an empty Assigned Items list as authoritative while a full same-account inventory/assignment read is still pending or failed transiently.
- Never rely only on the live-sync coordinator for the first cold full-master read on Assigned Items; if no completed full snapshot is present, use the cancellation-retrying direct loader so a false coordinator receipt cannot leave the table empty indefinitely.
- Never mask a malformed full inventory projection with an Assigned Items loader bypass: duplicate physical select fields make the coordinator return no snapshot while the direct loader throws. Keep the shared physical-column contract unique and keep Assigned Items on the canonical coordinator path.
- Never let Customer Assignments open its Add form before the authorized rep catalog is hydrated; the form captures its choices at mount time. Keep ordinary row deletes revision-checked and idempotent, and never expose deletion for the protected N/A tuple.
- Never replace the Company Directory contacts, blocks/beds, and production plant/project codes workflows with the maintained people-directory table. Keep the legacy directory reachable from its gated button and preserve its existing `canManageCompanyDirectory` authorization.
- Never expose a stored access code or treat the Native Auth alias as a contact email. User creation must provision both credential systems; access-code reset must synchronize Native Auth and the legacy login record with explicit reconciliation failure; deactivation must atomically soft-disable profile, legacy login, and canonical access, with self/last-administrator guards.
