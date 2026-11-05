---
name: test-agdata-it-yale-ui-ux-and-table-ergonomics-dean
description: "Sandbox implementation. Maintain table filters, Suspend return navigation and AV card geometry."
---

# test-agdata-it-yale-ui-ux-and-table-ergonomics-dean

Sandbox implementation. Maintain table filters, Suspend return navigation and AV card geometry.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Maintain table filters, Suspend return navigation and AV card geometry.

### Exact ownership
- test/assets/app-runtime.js: renderManagerTableManagementPanel, openManagerTableManagement, getManagerTableManagementItems, downloadManagerRowsToExcel, openDylanPhotoHistory, renderCompanyDirectoryPanel, mountCompanyDirectoryPanel, renderManagerTableManagementWorkspace.
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
- test/assets/row-workflow-functions.js: module contract.
- supabase/migrations/20261101010000_agdata_v23127_permissions_and_hold_history.sql: save_access_permission_v23127, smart_hold_context_v23127, suspend_tag_private.command.
- supabase/migrations/20261101030000_agdata_v23127_nursery_command.sql: nursery_command_v23127, nursery_schedule_import_v23127, resolve_nursery_schedule_locations_v23127.
- supabase/migrations/20261101040000_agdata_v23127_exact_planting_shield.sql: nursery_block_v23127, resolve_nursery_schedule_locations_v23127, nursery_schedule_import_v23127.
- supabase/migrations/20261101050000_v23129_super_admin_role.sql: user_access_capability_v23129, save_user_access_matrix_v23119, save_access_permission_v23127, is_full_app_administrator_v1, can_view_access_control_v2.
- services/bunch-note-pdf.mjs: buildBunchNotesBlockPdfDocument.
- supabase/functions/_shared/nursery-bunch-pdf.ts: validateNurseryPdfInput, assertNurseryPdfApprovals, renderNurseryPdf.
- test/assets/nursery-command-model.js: compile, parseBlockAllocations, rotationIndex, resolveScheduleTargets, allocatePlanting, buildBunchNoteContext, evaluateBunchNoteRowAndIssues, publishBunchDecisions, approvedBunchNote.
- test/assets/nursery-command-tables.js: mount.
- test/assets/assigned-items-table.js: module contract.
- test/assets/assigned-items.css: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_ph_itemcode_default_owners, test_ph_active_suspend
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- filter option count > 0 after all other filters; Apply = checked ∩ displayed search matches.
- Location width ≥135px; filter width ≥96px; headings use nowrap and normal word breaks.
- Suspend MARK DONE + matching receipt ⇒ return to scrolled cards; only Complete Tag removes a tag.
- weekday colors Mon/Tue/Wed/Thu/Fri = #7C3AED/#DC2626/#16A34A/#2563EB/#16A34A; Export stays in filter bar.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-it-yale-ui-ux-and-table-ergonomics-dean, test-agdata-table-management-and-directory, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-it-yale-ui-ux-and-table-ergonomics-dean.

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
