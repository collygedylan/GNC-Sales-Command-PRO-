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

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never collapse physical tag lines, blend ordered/reserved/available quantities, reuse another module's email recipients, block Docks on an optional join, or let a late account response repaint Comm.
- Never create a second inventory or navigation source inside Office, HL, or Comm.
- Never filter the current Docks operational snapshot by a historical or missing PLANSTART value; valid imported dock identity is the render boundary, with numeric `.0` suffixes normalized for grouping.
- Never label a Docks Drop card as a Stop or sort its physical rows by common name ahead of nursery `locationcode` and the source order-line sequence; keep Dock/Drop row, quantity and suspend-state summaries derived from the same displayed rows.
- Never leave a live `ph_soc_master` column out of its generated Row/Insert/Update contract: `select=*` responses must validate all current physical columns, including nullable `photo_url`, `pick_note`, `status`, and non-null JSONB `photos`.
