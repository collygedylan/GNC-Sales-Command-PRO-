---
name: agdata-docks-and-orders-specialist
description: Maintain AgData Docks/drop sequencing, HL orders and restock, Office/reserve reconciliation and Comm chat/presence with their existing source and delivery identities.
---

# Docks and orders

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) for Cluster 7 and shared Back/navigation ownership.

## Owned implementation boundaries

- `assets/app-runtime.js`: `handleDocksSearch`, `renderDocks`, `openDocksCredit`, Dock issue/item/team filters and status handlers; `loadHlOrderState`, `ensureHlOrderAvailability`, `renderHlOrder`, `setHlOrderTab`, `loadHlRestockState`, `saveHlRestockDraft`, `sendHlTagsEmail`; `renderReserves`, `renderOfficeHub`, `renderMoves`; `renderCommunicationHub`, `renderChat`, `openChatConversation`, `sendChatMessage`, `sendChatVoiceMessageToConversation`.
- Comm's compiled `assets/alpha-command-center.js` comes from `components/command-center/fieldCommandCenter.jsx` / `services/commandCenterDatabase.ts`; `mountAlphaCommandCenter` / `unmountAlphaCommandCenter` own mounted view lifecycle. Legacy chat remains a separate path; do not remove it when changing the command center.
- Related Office/team surfaces: `loadPoManagementData`, `renderPoManagement`, `renderDepartmentCalendar`, `saveDepartmentCalendarEvent`, `openDepartmentCalendarEventChat`, `loadCompanyDirectory`, `mountCompanyDirectoryPanel`. Preserve season-specific PO source views, `ph_department_calendar_events` identities, reminder/push delivery, directory account caches and contacts/blocks/beds/codes. HR mode of the command center uses `core_employees`, `hr_job_codes`, `labor_timesheets`; `alpha_timeoff_*` is separate from chat. Scheduled offboarding lives in `supabase/functions/scheduled-offboarding/{index,handler}.ts`, with server-authorized handover/checkpoint and Auth admin revocation; the auth skill owns account/session invariants.
- Backend: `supabase/functions/app-api/index.ts` `dock_trip_status`, `alpha_chat_list`, `alpha_chat_page`, `alpha_chat_mark_read`, `aura_chat_send` and the guarded `db` action/RPC bridge; `supabase/functions/hl-po-pdf-import/index.ts`. HL RPC names include `hl_order_state`, `hl_order_command`, `hl_order_inventory_availability`, `hl_order_restock_state_v2`; Dock trip updates use `save_dock_trip_status_v1`.
- `Code.gs`: `runReservesOnly`, `buildHlOrderPdfHtml_`, `handleHlOrderPreview_`, `handleSignedHlOrderDelivery_`, `collectRequestRecipients_`, plus protected Warehouse Assigned Items export/import reconciliation. Trace `ph_soc_master`, `ph_reserves`, `ph_sales_office`, `ph_warehouse_assigned_items`, `ph_dock_trip_status` and the HL contract tables through existing schema definitions rather than inventing aliases.

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
node --test tests/dock-trip-status.test.mjs tests/hl-order-ship-date.test.mjs tests/hl-tags-email.test.mjs
```

Use the canonical map's Comm row for chat changes. Register actual new read routes in shared fixtures; follow AGENTS limits and keep broad browser/import/database checks in their authorized lane.

Docks previews its authenticated SOC rows before optional inventory and customer joins finish; task master previews follow the same retained-display contract. Partial previews do not establish write proof.

Docks projects grouped Suspend candidates as one pending order quantity. Exclude replaced/denied/canceled rows; retain only the chosen approved location/lot after resolution. Apply all rows in a server command receipt to SOC and Suspend memory together, then invalidate Docks totals. Import updates retain resolved candidate location, original order quantity, canceled quantity and Suspend lifecycle fields. Comm and Manager Approval show the authenticated suspend_tag/inbox read, scoped to the assigned rep or full administrators.

Generic SOC detail saves also route through the authenticated dock_review command; only canonical full administrators or QC supervisors can edit its bounded review fields. Suspend rows retain their stricter editor/completion workflow. Group candidate review evidence propagates only within the same location/lot.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `renderDocks`, `loadHlOrderState`, `renderCommunicationHub`; `supabase/functions/app-api/index.ts`: `handleDockTripStatusAction` and bounded chat actions; SQL/RPC: `save_dock_trip_status_v1`, `hl_order_state`, `hl_order_command`, and `hl_order_restock_state_v2`.
- `Code.gs`: `runReservesOnly`, `buildHlOrderPdfHtml_`, `handleSignedHlOrderDelivery_`; exact symbols are indexed in `docs/architecture/agdata-symbol-index.json`.

## Cross-Layer Blast Radius

- Dock/Drop/SOC physical identity crosses imported `Code.gs` rows, Supabase snapshots/RPC commands, app-api authorization, Docks/HL/Office cards, Comm presence, and shared shell navigation. Retained previews never establish write proof.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.191: Never batch SOC archive ON CONFLICT inputs while the compact-state trigger can merge another key in the same command. Project once, select one normalized Dock/Trip status, and issue one conflict statement per projected archive row inside the atomic import transaction; preserve the deduplication trigger and immutable history. Validate by rolling back a complete canonical re-publication (Invariant 511).
- v2.3.191: Plan Start is a calendar date parsed at local noon, including Excel serials; use Mon #7C3AED, Tue #DC2626, Wed/Fri #16A34A, Thu #2563EB for both badge and accent. Do not impose a today cutoff. Operational SOC requires numeric Dock and year >= 2026; absent-file unfinished app-edited tags remain protected. HL scans original PDF Pending/Processed folders, never the generated GS sheet folder (Invariants 500, 505–506).

- v2.3.189: Never mix item facet values with trip/status or mutation state. Shared inventory filters narrow the existing authorized Dock projection and preserve physical order identities (Invariant 493).

- v2.3.188 / Invariant 488: Never choose an evaluator filter to force an approximate total. Include every active SUSPEND route: dc means dylan_collyge; ms and mk mean megan_kelly; other routes use their explicit username or Assigned Items owner, never an implicit Dylan fallback. Dylan/Megan and other owners default to self; JD defaults to All Users; authorized users retain cross-owner options with actual positive counts. The verified workbook has 24 active ms plus 3 mk rows for Megan, not a fabricated 24 combined. Missing untouched rows leave SOC/Docks on atomic sync; missing tags with saved evidence or replacement work remain until Complete Tag. Only an exact Complete Tag receipt or explicit completed flag creates a permanent closure; evaluation dates and shared business keys cannot close sibling tags. Preserve exact master evidence, session previews, immediate cards return, filename ordering and Watchdog.

- v2.3.187 / Invariant 487 routing was superseded by the explicit v2.3.188 clarification: 25 was the dc subset, not the total queue. Never infer destination membership from an approximate count; preserve terminal candidate exclusions and exact source identities.

- v2.3.186 / Invariant 486: Never sort ERP snapshots by the leading clock, trailing clock or Drive modification time ahead of the embedded date. Parse HHMMSS+YYYYMMDD+HHMMSS as YYYYMMDD+first HHMMSS; use modifiedTime only when no filename timestamp exists. Preserve exact-row evidence, committed source receipts, mapped Suspend ownership and numeric Docks. Keep captured Mark Done card return, receipt-gated success, session previews and no-wrap reorder controls. Four bounded local watchdog probes recover only the current editor/account and retained local images; never mutate production data or expose the restricted review panel to other roles.

- v2.3.184 / Invariant 484: Never use a T-prefixed trip/load as a Dock, including as a fallback for missing dock aliases. Numeric current-source Docks and Suspend share one active membership predicate; an evaluation DATE_COMPLETED does not close a still-suspended tag. Only explicit tag closure/terminal candidates leave the active queue. Resolve mapped evaluators before the dylan_collyge fallback, and default authorized full-queue readers to All Eval Users without broadening restricted access. Archive the reviewed historical trip records and explicitly cleared tags; preserve current snapshot membership and source receipts.

- v2.3.183 / Invariant 483: Never group Dock 38 separately from 38, join SOC evidence across crop or explicit PRI, or let ambiguous display evidence establish a write target. Docks and Suspend share one display resolver and business-key deduplication; selected evidence writes require the exact master UID receipt. Apply location/completion receipts to SOC and Suspend together, remove closed tags optimistically with rollback, and keep Mark Done in the queue. Closed-tag import tombstones and security-invoker projections preserve durable lifecycle; missing docks are never invented from obsolete staged snapshots.
- Never serialize unbounded photo uploads, hide other staged Reclass rows, or treat added candidates as an exact-order replacement. Keep 1280px/200KB JPEG compression, authenticated store_drive_photo_blob_v1 recovery, canonical Drive Item Detail, exact source/group commands with preserved split totals, and statement-level evidence propagation. Invariants 391–393 cover these seams; no new startup read, Code.gs or delivery changes.

- v2.3.112: Remove only expression statements proved unreachable after an unconditional return/throw in the same AST block; retain declaration bindings and all reachable public handlers. Strict identifier pruning excludes dynamically referenced names and non-declaration candidates.


- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never collapse physical tag lines, blend ordered/reserved/available quantities, reuse another module's email recipients, block Docks on an optional join, or let a late account response repaint Comm.
- Never create a second inventory or navigation source inside Office, HL, or Comm.
- Never filter the current Docks operational snapshot by a historical or missing PLANSTART value; valid imported dock identity is the render boundary, with numeric `.0` suffixes normalized for grouping.
- Never treat a trailing-dot SOC itemcode as a canonical Drive evidence identity; hydrate only a Docks display clone from one unique inventory row at the exact location and lot, preserving the source SOC line for actions.
- Never label a Docks Drop card as a Stop or sort its physical rows by common name ahead of nursery `locationcode` and the source order-line sequence; keep Dock/Drop row, quantity and suspend-state summaries derived from the same displayed rows.
- Never leave a live `ph_soc_master` column out of its generated Row/Insert/Update contract: `select=*` responses must validate all current physical columns, including nullable `photo_url`, `pick_note`, `status`, and non-null JSONB `photos`.
- Never canonicalize trailing-dot SOC codes with an unbounded master-table GROUP BY or per-row trigger; use statement transition rows, the normalized itemcode range index, exact location/lot matching, unique-code proof, and a quick return for already canonical values.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Maintain AgData Docks/drop sequencing, HL orders and restock, Office/reserve reconciliation and Comm chat/presence with their existing source and delivery identities.

### Exact ownership
- assets/app-runtime.js: renderDocks, getScopedDocksItems, normalizeDockViewDockKey, loadHlOrderState, renderCommunicationHub, buildDockBrowseSummary, normalizeDockViewStopKey, normalizeSocDockRowAliases, getDockCardLiveInventoryDisplayRow.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleDockTripStatusAction.
- Code.gs: runReservesOnly, buildHlOrderPdfHtml_, handleSignedHlOrderDelivery_.
- services/database-contracts.generated.ts: ph_soc_master.
- supabase/functions/_shared/database.types.ts: ph_soc_master.
- supabase/migrations/20261029170500_agdata_v23104_docks_suspend.sql: normalize_soc_itemcode_from_master_v23104, normalize_soc_itemcode_after_import_v23104, normalize_soc_itemcode_from_current_master_v23104, normalize_soc_itemcode_from_pairs_v23104, bulk_import_master_snapshot_v1, finalize_master_snapshot_stage_v1.
- DOM: #view-docks, #docks-content, #view-hl-order, #hl-order-content, #view-office, #view-reserves
- PostgreSQL: ph_department_calendar_events, ph_soc_master, ph_reserves, ph_sales_office, ph_warehouse_assigned_items, ph_dock_trip_status, ph_app_users
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- v2.3.191: Plan Start is a calendar date parsed at local noon, including Excel serials; use Mon #7C3AED, Tue #DC2626, Wed/Fri #16A34A, Thu #2563EB for both badge and accent. Do not impose a today cutoff. Operational SOC requires numeric Dock and year >= 2026; absent-file unfinished app-edited tags remain protected. HL scans original PDF Pending/Processed folders, never the generated GS sheet folder (Invariants 500, 505–506).
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-docks-and-orders-specialist, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-docks-and-orders-specialist.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- DOCKS-SUSPEND-INTEGRITY-2026-11-05: SOC aliases and duplicate business keys diverged; inventory display required a unique PRI and completion retention covered only candidate groups. Use shared exact-crop display selection, exact UID save receipts, canonical SOC-backed protected views, durable closed-tag tombstones and synchronized receipt updates. Permanent assertion: tests/golden-invariants.test.mjs Invariant 483; tests/docks-suspend-integrity.test.mjs. Evidence: Live schema and staged SOC inspection; G:/My Drive/GNC/AgData/Release Evidence/docks-suspend-repair.sql.
- NUMERIC-DOCK-CURRENT-SUSPEND-2026-11-05: Dock aliases fell back to trip identifiers; active tags were hidden by evaluation timestamps and the default own-evaluator filter. Use numeric Dock identity only, retain evaluated active tags until explicit closure, and preserve mapped owners with a Dylan fallback and permission-correct All default. Permanent assertion: tests/golden-invariants.test.mjs Invariant 484; tests/current-soc-docks.test.mjs. Evidence: Both user recordings, live current SOC/staging and Drive discovery; G:/My Drive/GNC/AgData/Release Evidence/current-soc-docks-repair.sql.
- ERP-FILENAME-2026-11-05: Cloud sync ordered snapshots by Drive modifiedTime; Home parsing read the trailing clock and could match time digits as a year. v2.3.186 / Invariant 486: Never sort ERP snapshots by the leading clock, trailing clock or Drive modification time ahead of the embedded date. Parse HHMMSS+YYYYMMDD+HHMMSS as YYYYMMDD+first HHMMSS; use modifiedTime only when no filename timestamp exists. Preserve exact-row evidence, committed source receipts, mapped Suspend ownership and numeric Docks. Keep captured Mark Done card return, receipt-gated success, session previews and no-wrap reorder controls. Four bounded local watchdog probes recover only the current editor/account and retained local images; never mutate production data or expose the restricted review panel to other roles. Permanent assertion: tests/erp-filename-watchdog.test.mjs; Invariant 486. Evidence: November 5 committed stage receipts; source comparator inspection; focused behavior checks..
- SOC-SUSPEND-MEMBERSHIP-2026-11-05: The approximate total was incorrectly inferred to mean the dc-only subset; v2.3.188 explicitly supersedes that routing restriction. Preserve physical tag identities and terminal candidate exclusions; follow the explicit all-route routing/default/retention contract in SUSPEND-ALL-ROUTES-2026-11-05. Permanent assertion: tests/soc-suspend-membership.test.mjs; Golden Invariant 487; exact workbook/staged UID EXCEPT checks.. Evidence: SHA-256 ec39f56435c12766dd5b20200ae9b25abc0fad10d33e3a1efe4f0b796352d267; 61492 workbook rows including header; 28 dc flags, 3 replaced, 25 active..
- SUSPEND-ALL-ROUTES-2026-11-05: A dc-only membership rule and blanket missing-row deletion hid other evaluators and discarded saved work; legacy evaluation dates were mistaken for permanent physical-tag completion. Never choose an evaluator filter to force an approximate total. Include every active SUSPEND route: dc means dylan_collyge; ms and mk mean megan_kelly; other routes use their explicit username or Assigned Items owner, never an implicit Dylan fallback. Dylan/Megan and other owners default to self; JD defaults to All Users; authorized users retain cross-owner options with actual positive counts. The verified workbook has 24 active ms plus 3 mk rows for Megan, not a fabricated 24 combined. Missing untouched rows leave SOC/Docks on atomic sync; missing tags with saved evidence or replacement work remain until Complete Tag. Only an exact Complete Tag receipt or explicit completed flag creates a permanent closure; evaluation dates and shared business keys cannot close sibling tags. Preserve exact master evidence, session previews, immediate cards return, filename ordering and Watchdog. Permanent assertion: tests/soc-suspend-routing.test.mjs; Invariant 488; rolled-back installed SQL ownership/retention/eligibility assertions.. Evidence: Verified revision 644 workbook: 88 active rows across all codes, including 24 ms and 3 mk. Existing five explicit completions remain closed..
- v2.3.191-five-regressions: Prepended shared controls duplicated native filters; boot/version recovery reloaded retained sessions; independent Request reads lost publication order; forced start reused same-actor jobs; sparse SOC reparsed every raw page and admitted trip-only/historical rows. Use native drawers, retain authenticated shells, publish Request snapshots in order, force a distinct manual job, scan newest Drive files and publish only after EOF; protect unfinished edited tags; use noon-local weekday colors. Permanent assertion: Golden Invariants 500–510 and rolled-back SQL fresh-job/source-eligibility proof.. Evidence: G:/My Drive/GNC/AgData/Release Evidence/release-191-workbook-summary.json; release-191-database.sql; release-191-soc-removed-backup.json.
- v2.3.191-compact-history-publication: The compact-history trigger merges another archive key; a batch ON CONFLICT can touch that target twice and abort SOC publication. Project SOC history once, select one normalized Dock/Trip status, and publish one conflict statement per projected row inside the canonical atomic transaction. Preserve archive deduplication and canonical business-line deduplication. Permanent assertion: Invariant 511 and full canonical publication rollback proof; live receipt processed 425 eligible source lines and the existing business-line deduplicator retains 423 unique live orders.. Evidence: G:/My Drive/GNC/AgData/Release Evidence/release-191-history-publication-proof.sql.
- v2.3.191-newest-hl-po-only: Adding Processed-folder discovery exposed every historical PDF to the operational HL worker, prolonging a run after the current file had published. Scan Pending, Processed and parent folders, then select only the newest original HL PO PDF before constructing the operational cursor; historical maintenance remains separate. Permanent assertion: Invariant 512 verifies three-folder discovery returns exactly the newest original PDF.. Evidence: G:/My Drive/GNC/AgData/Release Evidence/release-191-focused-hl-po.log.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
