# Table Management and Eval Reports #2 Workspace Architecture

## v2.3.131 containment

`getManagerTableManagementKey` and `getManagerTableManagementLegacyTab`
retain exact legacy aliases and controllers.
`renderManagerTableManagementWorkspace` owns the shared visible selector;
`syncManagerTableManagementViewport` bounds its height. Managed, Nursery,
Assigned Items and canonical access editors retain existing transports and
authorization. Header/filter flex children remain outside each row scroller.

Nursery reference tables skip planning compilation. The canonical
`GncNurseryModel.compile` indexes same-item peers in existing sorted order
without changing capacity, approvals or mutations.

Focused target:

```sh
node --test tests/manager-table-workspace.test.mjs tests/manager-table-management.test.mjs
```

## v2.3.132 drill-down

The canonical workspace owns the 18-card authorized directory, deduplicated
schedule, and single 44px table navigation bar. `openManagerTableManagement`
resets directory selection synchronously; `goBackUniversal` takes this drill
step before Manager Modules. `handleManagersSearch` filters directory names
synchronously. Existing table controllers, scoped read paths, mutation gates,
and archives retain their contracts.

The blast radius is runtime routing, CSS and release markers only. `Code.gs`
and SQL/RPC contracts are unchanged; app-api changes only release constants.
No startup read is added. Browser PostgREST, Apps Script delivery, Edge
authentication and Postgres triggers retain their authorization and data
contracts.

Never render both the directory and an active editor, duplicate schedule
cards, or put a multi-row selector above table filters. Invariants 332-333 and
the Manager workspace tests cover directory isolation and synchronous Back.

## v3.0.36 v3.0.00 restoration

`src/views/manager-table-workspace.js` is the source owner for the Table
Management directory and selected-workspace markup; its generated classic
asset is consumed by `renderManagerTableManagementWorkspace`.
`src/ui/manager-table-layout.js` owns the universal pinned-results policy and
releases Manager tables from the generic full-view scroller. Assigned Items,
Company Directory, Inquiry Coverage, Customer Assignments, and User Role &
Access therefore retain their native selector, sticky header, filter row, and
single table scroller. Existing controllers, transports, authorization and
export contracts are unchanged.

`src/views/eval-report2-controls.js` owns the persistent multi-report picker,
Apply boundary, optional row filters, More menu, and Eval2 panel router. Fresh
entry opens the report workspace; aggregate overview and Season Y <=2026 field
audit remain explicit actions. Universal Back,
`renderManagerEvalReport2DrillGroupCard`, report-page state, exact Reclass
handoff, canonical evaluation publication, and durable receipts retain their
existing owners. Generated assets remain ordered classic scripts; no startup
read, app-api, SQL/RPC, Apps Script, or email route is added.

Focused coverage is `tests/manager-workspace-restoration.test.mjs`,
`tests/manager-table-workspace.test.mjs`, `tests/eval-reports-engine.test.mjs`,
and Golden Invariants 544 and 546. The v3.0.35 dark-emerald tokens and global
header/footer shell remain authoritative.
