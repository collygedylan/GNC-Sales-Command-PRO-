# Supabase cleanup report — V2026.08.16.11

Completed: 2026-08-16 (America/Chicago)

## Result

- Public tables before: `183`
- Exact-empty public tables before: `119`
- Public tables after: `76`
- Exact-empty public tables after: `12`
- Tables removed: `107`
- Compatibility views removed: `5`
- Empty relation bytes removed: `5,332,992` (about 5.1 MiB)
- Remaining exact-empty relation bytes: `491,520`
- Current Postgres size: `7,266,577,555` bytes (`6930 MB`)
- Storage objects removed in this operation: `0`

This cleanup makes Supabase Table Editor substantially easier to use. It does
not materially reduce billing because the empty tables occupied only about
5.1 MiB. The earlier Drive Around cleanup remains the material database-size
reduction.

## Removed

The following five exact-empty legacy tables and their unused `v2_`
compatibility views were removed:

- `ph_employee_time_cards`
- `ph_eval_assignment_rules_import`
- `ph_outlook_accounts`
- `ph_security_audit_events`
- `ph_walkie_voice_messages`

The 102 exact-empty future-farm placeholders were also removed. They were the
complete cross-product of prefixes `hl_`, `nc_`, and `tx_` with these 34
suffixes:

- `active_request`
- `av_notes`
- `bunch_counts`
- `cav_import`
- `diagnostic_lab_cases`
- `disease_training_assets`
- `dock_issue_allocations`
- `dock_issue_status`
- `dock_item_status`
- `dock_team_status`
- `drive_around_report_files`
- `drive_around_report_rows`
- `flyer_folder_history`
- `flyer_folder_rows`
- `grower_scout_assets`
- `grower_scout_reports`
- `hold_learning_events`
- `hold_learning_profiles`
- `hold_release_cycles`
- `labor_hours`
- `master_inventory`
- `ml_image_jobs`
- `ncr_completions`
- `productivity_history`
- `request_history`
- `reserves`
- `sales_office`
- `shear_list`
- `soc_master`
- `spread_counts`
- `take_back_queue`
- `warehouse_assigned_items`
- `weather_daily`
- `weather_hourly`

All 107 tables were checked with an exact `EXISTS` query immediately before
the migration. The migration required exactly 102 documented future-farm
placeholders and used `DROP ... RESTRICT`; it would have aborted if any table
contained a row, had an unexpected comment, or had an unknown dependency.

## Deliberately retained empty tables

These 12 tables remain because they are referenced by live code, importers,
scheduled cleanup, or active backend workflows:

- `marketing_materials` — live marketing/photo workflow and archive scan
- `ph_bunch_counts` — live app/API/importer contract
- `ph_grower_scout_assets` — live app/API/importer contract
- `ph_grower_scout_reports` — live app/API/importer and ML dispatch
- `ph_hl_po` — active HL purchase-order importer contract
- `ph_hold_learning_cursors` — incremental hold-learning migration state
- `ph_labor_hours` — live labor-hours submission contract
- `ph_ml_github_dispatch_state` — referenced by `dispatch_github_ml_worker`
- `ph_photo_archive_jobs` — daily Google Drive archive lifecycle
- `ph_photo_archive_runs` — daily Google Drive archive lifecycle
- `ph_sales_credit_requests` — live sales-credit workflow
- `ph_spread_counts` — live app/API/importer contract

An empty operational table is not necessarily unused. Removing these would
break or weaken an existing workflow even though no row happened to be stored
at the audit time.

## Dependency and rollback protection

- Inbound foreign keys on removed tables: `0`
- Function source references on removed tables: `0`
- Realtime publication memberships on removed tables: `0`
- Downstream view dependencies: `0`
- App code references: `0`
- Existing Supabase physical backup: `1389891049`
- Original farm-table definitions remain in migration history and can recreate
  the empty placeholders if those future divisions are activated.
- The cleanup ran as one transactional migration. No `CASCADE` was used.
- Production migration: `20260817001819_remove_confirmed_unused_empty_tables`

## Related cleanup

The previous large-relation report is
`docs/supabase-cleanup-V2026.08.16.10.md`. It documents the verified Drive
Around compaction that reduced the logical database to below 8 GB. This `.11`
report documents only the Table Editor empty-object cleanup.
