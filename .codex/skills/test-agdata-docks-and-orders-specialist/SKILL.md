---
name: test-agdata-docks-and-orders-specialist
description: Maintain AgData Docks/drop sequencing, HL orders and restock, Office/reserve reconciliation and Comm chat/presence with their existing source and delivery identities.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Docks and orders

Read [the canonical dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) for Cluster 7 and shared Back/navigation ownership.

## Owned implementation boundaries

- `test/assets/app-runtime.js`: `handleDocksSearch`, `renderDocks`, `openDocksCredit`, Dock issue/item/team filters and status handlers; `loadHlOrderState`, `ensureHlOrderAvailability`, `renderHlOrder`, `setHlOrderTab`, `loadHlRestockState`, `saveHlRestockDraft`, `sendHlTagsEmail`; `renderReserves`, `renderOfficeHub`, `renderMoves`; `renderCommunicationHub`, `renderChat`, `openChatConversation`, `sendChatMessage`, `sendChatVoiceMessageToConversation`.
- Comm's compiled `test/assets/alpha-command-center.js` comes from `test/components/command-center/fieldCommandCenter.jsx` / `test/services/commandCenterDatabase.ts`; `mountAlphaCommandCenter` / `unmountAlphaCommandCenter` own mounted view lifecycle. Legacy chat remains a separate path; do not remove it when changing the command center.
- Related Office/team surfaces: `loadPoManagementData`, `renderPoManagement`, `renderDepartmentCalendar`, `saveDepartmentCalendarEvent`, `openDepartmentCalendarEventChat`, `loadCompanyDirectory`, `mountCompanyDirectoryPanel`. Preserve season-specific PO source views, `test_ph_department_calendar_events` identities, reminder/push delivery, directory account caches and contacts/blocks/beds/codes. HR mode of the command center uses `test_core_employees`, `test_hr_job_codes`, `test_labor_timesheets`; `alpha_timeoff_*` is separate from chat. Scheduled offboarding lives in `test/supabase/functions/scheduled-offboarding/{index,handler}.ts`, with server-authorized handover/checkpoint and Auth admin revocation; the auth skill owns account/session invariants.
- Backend: `test/supabase/functions/app-api/index.ts` `dock_trip_status`, `alpha_chat_list`, `alpha_chat_page`, `alpha_chat_mark_read`, `aura_chat_send` and the guarded `db` action/RPC bridge; `test/supabase/functions/hl-po-pdf-import/index.ts`. HL RPC names include `test_hl_order_state`, `test_hl_order_command`, `test_hl_order_inventory_availability`, `test_hl_order_restock_state_v2`; Dock trip updates use `test_save_dock_trip_status_v1`.
- `test/workers/email/Code.gs`: `runReservesOnly`, `buildHlOrderPdfHtml_`, `handleHlOrderPreview_`, `handleSignedHlOrderDelivery_`, `collectRequestRecipients_`, plus protected Warehouse Assigned Items export/import reconciliation. Trace `test_ph_soc_master`, `test_ph_reserves`, `test_ph_sales_office`, `test_ph_warehouse_assigned_items`, `test_ph_dock_trip_status` and the HL contract tables through existing schema definitions rather than inventing aliases.

## Shared dependencies and invariants

- Relevant roots: `#view-docks` / `#docks-content`, `#view-hl-order` / `#hl-order-content`, `#view-office`, `#view-reserves`, `#view-communication`, `#alpha-communications-root`, `#chat-content`. Enter through `switchView`, `canAccessView` and `GncMobileWorkspace.syncHub`; preserve `updateGlobalBackButton`, `goBackUniversal`, `goBackFromHlOrderDriveDetail`, drill state and modal history. Shared Back/header visibility belongs to the shell skill.
- Docks reads `data.soc`, Dock trip/item/team/issue state and current filters; PLANSTART, Dock, Drop, TRIPNUMBER, stop and consignee identities link Docks to Que → SUSPEND. Do not merge distinct physical tag lines. Retain filter persistence and natural nursery location order.
- HL reads `hlOrderStateData`, availability indexes, account ownership/generation, source IDs and saved drafts. Preserve cached same-account state while polling, exact source eligibility, season/ship-date scope, revision guards and idempotent command IDs. Keep ordered, reserved and inventory quantities separate; never replace missing inventory evidence with fabricated availability.
- Keep `SOC-10-Open-Orders`, `SOC-10-Reserves`, Warehouse Assigned Items, Pikes and Stine source meanings distinct. Office links authorized sales-office and moves rather than owning an independent inventory copy.
- Comm retains membership-scoped conversations, unread/presence state, realtime teardown and attachment/voice ownership. Slow polling or failed background reads cannot block navigation, cached dictionaries or submission; account switches clear owned chat state.
- Preserve separate email contracts: HL tag emails resolve Dylan only in `collectRequestRecipients_`; HL order PDFs use `hlOrderRecipient_` / signed delivery routing. Request, Bunch Note and Reclass recipient lists do not apply to these flows.

## Scoped verification

Select the affected files from this pure Node command (under 10 seconds is a target, **not a measured audit result**):

```sh
node --test test/tests/dock-trip-status.test.mjs test/tests/hl-order-ship-date.test.mjs test/tests/hl-tags-email.test.mjs
```

Use the canonical map's Comm row for chat changes. Register actual new read routes in shared fixtures; follow AGENTS limits and keep broad browser/import/database checks in their authorized lane.

Docks previews its authenticated SOC rows before optional inventory and customer joins finish; task master previews follow the same retained-display contract. Partial previews do not establish write proof.

Docks projects grouped Suspend candidates as one pending order quantity. Exclude replaced/denied/canceled rows; retain only the chosen approved location/lot after resolution. Apply all rows in a server command receipt to SOC and Suspend memory together, then invalidate Docks totals. Import updates retain resolved candidate location, original order quantity, canceled quantity and Suspend lifecycle fields. Comm and Manager Approval show the authenticated suspend_tag/inbox read, scoped to the assigned rep or full administrators.

Generic SOC detail saves also route through the authenticated dock_review command; only canonical full administrators or QC supervisors can edit its bounded review fields. Suspend rows retain their stricter editor/completion workflow. Group candidate review evidence propagates only within the same location/lot.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/app-runtime.js`: `renderDocks`, `loadHlOrderState`, `renderCommunicationHub`; `test/supabase/functions/app-api/index.ts`: `handleDockTripStatusAction` and bounded chat actions; SQL/RPC: `test_save_dock_trip_status_v1`, `test_hl_order_state`, `test_hl_order_command`, and `test_hl_order_restock_state_v2`.
- `test/workers/email/Code.gs`: `runReservesOnly`, `buildHlOrderPdfHtml_`, `handleSignedHlOrderDelivery_`; exact symbols are indexed in `test/docs/architecture/test-agdata-symbol-index.json`.

## Cross-Layer Blast Radius

- Dock/Drop/SOC physical identity crosses imported `test/workers/email/Code.gs` rows, Supabase snapshots/RPC commands, app-api authorization, Docks/HL/Office cards, Comm presence, and shared shell navigation. Retained previews never establish write proof.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `test/workers/email/Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `test_ph_app_users` and `test_user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.183 / Invariant 483: Never group Dock 38 separately from 38, join SOC evidence across crop or explicit PRI, or let ambiguous display evidence establish a write target. Docks and Suspend share one display resolver and business-key deduplication; selected evidence writes require the exact master UID receipt. Apply location/completion receipts to SOC and Suspend together, remove closed tags optimistically with rollback, and keep Mark Done in the queue. Closed-tag import tombstones and security-invoker projections preserve durable lifecycle; missing docks are never invented from obsolete staged snapshots.
- Never serialize unbounded photo uploads, hide other staged Reclass rows, or treat added candidates as an exact-order replacement. Keep 1280px/200KB JPEG compression, authenticated test_store_drive_photo_blob_v1 recovery, canonical Drive Item Detail, exact source/group commands with preserved split totals, and statement-level evidence propagation. Invariants 391–393 cover these seams; no new startup read, test/workers/email/Code.gs or delivery changes.

- v2.3.112: Remove only expression statements proved unreachable after an unconditional return/throw in the same AST block; retain declaration bindings and all reachable public handlers. Strict identifier pruning excludes dynamically referenced names and non-declaration candidates.


- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never collapse physical tag lines, blend ordered/reserved/available quantities, reuse another module's email recipients, block Docks on an optional join, or let a late account response repaint Comm.
- Never create a second inventory or navigation source inside Office, HL, or Comm.
- Never filter the current Docks operational snapshot by a historical or missing PLANSTART value; valid imported dock identity is the render boundary, with numeric `.0` suffixes normalized for grouping.
- Never treat a trailing-dot SOC itemcode as a canonical Drive evidence identity; hydrate only a Docks display clone from one unique inventory row at the exact location and lot, preserving the source SOC line for actions.
- Never label a Docks Drop card as a Stop or sort its physical rows by common name ahead of nursery `locationcode` and the source order-line sequence; keep Dock/Drop row, quantity and suspend-state summaries derived from the same displayed rows.
- Never leave a live `test_ph_soc_master` column out of its generated Row/Insert/Update contract: `select=*` responses must validate all current physical columns, including nullable `photo_url`, `pick_note`, `status`, and non-null JSONB `photos`.
- Never canonicalize trailing-dot SOC codes with an unbounded master-table GROUP BY or per-row trigger; use statement transition rows, the normalized itemcode range index, exact location/lot matching, unique-code proof, and a quick return for already canonical values.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain AgData Docks/drop sequencing, HL orders and restock, Office/reserve reconciliation and Comm chat/presence with their existing source and delivery identities.

### Exact ownership
- test/assets/app-runtime.js: renderDocks, getScopedDocksItems, normalizeDockViewDockKey, loadHlOrderState, renderCommunicationHub, buildDockBrowseSummary, normalizeDockViewStopKey, normalizeSocDockRowAliases, getDockCardLiveInventoryDisplayRow.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleDockTripStatusAction.
- Code.gs: runReservesOnly, buildHlOrderPdfHtml_, handleSignedHlOrderDelivery_.
- services/database-contracts.generated.ts: ph_soc_master.
- supabase/functions/_shared/database.types.ts: ph_soc_master.
- supabase/migrations/20261029170500_agdata_v23104_docks_suspend.sql: normalize_soc_itemcode_from_master_v23104, normalize_soc_itemcode_after_import_v23104, normalize_soc_itemcode_from_current_master_v23104, normalize_soc_itemcode_from_pairs_v23104, bulk_import_master_snapshot_v1, finalize_master_snapshot_stage_v1.
- DOM: #view-docks, #docks-content, #view-hl-order, #hl-order-content, #view-office, #view-reserves
- PostgreSQL: test_ph_department_calendar_events, test_ph_soc_master, test_ph_reserves, test_ph_sales_office, test_ph_warehouse_assigned_items, test_ph_dock_trip_status, test_ph_app_users
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-docks-and-orders-specialist, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-docks-and-orders-specialist.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- DOCKS-SUSPEND-INTEGRITY-2026-11-05: SOC aliases and duplicate business keys diverged; inventory display required a unique PRI and completion retention covered only candidate groups. Use shared exact-crop display selection, exact UID save receipts, canonical SOC-backed protected views, durable closed-tag tombstones and synchronized receipt updates. Permanent assertion: tests/golden-invariants.test.mjs Invariant 483; tests/docks-suspend-integrity.test.mjs. Evidence: Live schema and staged SOC inspection; G:/My Drive/GNC/AgData/Release Evidence/docks-suspend-repair.sql.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
