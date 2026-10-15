# Phase 1: performance diagnostics — 2026-10-14

Status at the pre-merge checkpoint: diagnostics and the disposable rehearsal passed. Production was inspected read-only; no schema, data, permissions, or configuration was changed. Publication and production maintenance must complete before Phase 2 starts.

## Verified baseline

- Repository base: `1274e02a7ba0543b86e79f8b78f2fdb0ca67ed64`; isolated branch: `codex/performance-diagnostics`.
- Supabase project: `kzrnyjsosryejjejliii`; PostgreSQL 17.6, ARM64.
- Performance Advisor at 2026-10-14 23:24 UTC reported **73 WARN findings**: 1 RLS initialization-plan finding, 68 overlapping permissive-policy findings, and 4 duplicate-index findings. It also reported 334 unindexed-foreign-key INFO findings, 415 unused-index INFO findings, and 1 Auth connection-allocation INFO finding. The reported historical count of 793 was not reproduced.
- The rolling 24-hour logs contained approximately 7.1 million database ERROR events, chiefly `REQUEST_VERSION_CONFLICT`, `LOC_ON_HAND_SOURCE_NOT_READY`, and `LOC_ON_HAND_REVISION_CHANGED` using SQLSTATE `40001`. Hourly inspection placed their last occurrence in the 19:00 UTC hour; the repository already contains `20261014190535_application_conflict_http_status.sql`, which changes those business conflicts to `PT409`. These historical counts must not be presented as a current failure rate.
- Fixed observation window **2026-10-14 22:00:00–23:25:00 UTC**: 1,773 edge/API events, **0 HTTP 5xx events**, 851 Postgres log events, **0 ERROR/FATAL events**, and **563 WARNING events**. These are observed counts, not a claim that every operation succeeded or a guarantee about future traffic.
- The continuing warning is `database "postgres" has a collation version mismatch`: database default collation provider ICU (`i`), recorded version **153.120**, actual version **153.121**; locale `en_US.UTF-8`.

## Repair requirements

A catalog inventory found **662 indexes using the database default collation**, occupying **6,641,836,032 bytes** at observation. None of the identified indexes was an exclusion or system-catalog index; subsequent dependency checks found no materialized views, default-collated partition keys, or used named-collation mismatches. One existing index was invalid: `public.ph_drive_around_report_rows_archive_batch_idx` (777,142,272 bytes). Its original failure cause is unknown; concurrent repair was demonstrated on a disposable invalid-index fixture.

The connected role is `postgres`, is not a superuser, and is not a member of `supabase_admin`, `supabase_auth_admin`, or `supabase_storage_admin`. It lacks PostgreSQL `MAINTAIN` privilege on the tables underlying these seven indexes:

| Schema | Index | Table |
| --- | --- | --- |
| auth | schema_migrations_pkey | auth.schema_migrations |
| cron | jobname_username_uniq | cron.job |
| storage | buckets_vectors_pkey | storage.buckets_vectors |
| storage | migrations_name_key | storage.migrations |
| storage | vector_indexes_name_bucket_id_idx | storage.vector_indexes |
| storage | vector_indexes_pkey | storage.vector_indexes |
| vault | secrets_name_idx | vault.secrets |

The existing production migration runner, `scripts/apply-item-low-stock-migration.mjs`, wraps migrations in a transaction. PostgreSQL forbids `REINDEX CONCURRENTLY` inside a transaction, so the current migration path cannot perform the required concurrent maintenance. No privilege elevation, blocking reindex, or metadata-only collation refresh was attempted.

The role does own the database. PostgreSQL 17 permits a database owner to run `REINDEX DATABASE CONCURRENTLY` on ordinary user-schema tables without individual table `MAINTAIN` privileges, so the seven indexes do not establish a hard permission blocker to that broader operation. This operation includes indexes beyond the default-collation inventory and must be assessed at that full scope. The invalid index requires a separate targeted concurrent rebuild.

At 23:33:55 UTC the authenticated Metrics API reported **21,886,812,160 bytes available** on `/data` (42,158,473,216 bytes total), approximately 2.35 GB available memory, and load average 0.05. Database catalog measurements showed approximately 18.94 GB database size, 7.07 GB total user indexes, no active index build, and no transaction older than five minutes. The largest table's indexes occupy approximately 4.99 GB; its estimated row count is 8,783,107. These are point-in-time preflight observations and must be rechecked immediately before maintenance.

PostgreSQL requires rebuilding affected objects before refreshing the recorded collation version; refreshing the version does not verify that those objects were rebuilt. A verified maintenance path must run supported concurrent operations outside transactions, with disk-capacity, lock, dependency, and recovery checks. An incomplete rebuild must not be followed by a database-wide version refresh. See [PostgreSQL 17 collation maintenance](https://www.postgresql.org/docs/17/sql-altercollation.html) and [PostgreSQL 17 REINDEX](https://www.postgresql.org/docs/17/sql-reindex.html).

## Reproducible read-only diagnostics

Check the database default version:

```sql
select datname, datlocprovider, datcollate, datctype, datcollversion,
       pg_database_collation_actual_version(oid) as actual_version
from pg_database
where datname = current_database();
```

Inventory indexes using that default and their maintenance privileges:

```sql
select n.nspname as schema_name, c.relname as index_name,
       i.indrelid::regclass::text as table_name, r.rolname as owner,
       has_table_privilege(current_user, i.indrelid, 'MAINTAIN') as can_maintain,
       i.indisvalid, i.indisexclusion, pg_relation_size(i.indexrelid) as bytes
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_roles r on r.oid = c.relowner
where exists (
  select 1 from unnest(i.indcollation) x
  join pg_collation co on co.oid = x
  where co.collprovider = 'd'
)
order by schema_name, index_name;
```

For the fixed observation window above, use the Supabase unified logs query with explicit start/end timestamps:

```sql
select source, count() as events,
  countIf(source = 'edge_logs' and
    toInt32OrZero(log_attributes['response.status_code']) >= 500) as api_server_errors,
  countIf(source = 'postgres_logs' and
    log_attributes['parsed.error_severity'] in ('ERROR', 'FATAL')) as database_errors,
  countIf(source = 'postgres_logs' and
    log_attributes['parsed.error_severity'] = 'WARNING') as database_warnings
from logs
where source in ('edge_logs', 'postgres_logs')
group by source;
```

## Validation and delivery

### Guarded maintenance command

`scripts/repair-database-collation.mjs` defaults to a read-only audit. Its apply path requires the exact project, database, and old/new collation versions; database ownership; no active index operation or old transaction; supported collation dependencies; valid index coverage; and fresh authenticated filesystem metrics. It rejects external tablespaces and accepts only Supabase's documented `/data/pgdata` and `/var/lib/postgresql/data` paths (the hosted provisioning [links the latter to the data volume](https://github.com/supabase/postgres/blob/develop/ansible/tasks/setup-postgres.yml)). It requires at least twice the largest table's index footprint plus 2 GiB on the data filesystem and 1 GiB on the system filesystem.

The command holds a session advisory lock, disables parallel maintenance workers for this session, repairs the single allowlisted invalid index concurrently, rebuilds ordinary database indexes concurrently, and verifies index identities and validity before refreshing the recorded version. Unexpected warnings, unsupported dependencies, lock contention, and rebuild failures prevent the refresh. The exact expected catalog-skip warning is accepted only when no affected system index exists; an exact existing collation-mismatch warning requires matching database/version details. It does not grant privileges, change application rows, or alter RLS. Standard Supabase storage layout is assumed; physical WAL placement is not inspected through server-file access.

Required credentials are supplied through `GNC_SUPABASE_DB_URL` and `SUPABASE_METRICS_KEY`, without recording them in logs or this document. An inherited database URL was rejected with SQLSTATE `28P01`; the existing repository `.env` credential was then verified successfully without resetting any password. Read-only CLI audit passed and confirmed the same 662 dependent indexes, one invalid index, approximately 21.89 GB data free space, 1.82 GB system free space, and 12.14 GB required data headroom.

Maintenance requires an explicit port **5432** for a direct or session-pooled connection. The saved URL uses transaction-pooler port 6543, which cannot preserve the session advisory lock or timeout settings; the CLI rejects that route before connecting. A separate session-pooler connection using the existing credentials on port 5432 retained the same backend and `lock_timeout` across five statements. The repository `.env` was not modified.

```powershell
node scripts/repair-database-collation.mjs --project-ref kzrnyjsosryejjejliii --expected-dbname postgres
# Apply only after the disposable rehearsal, regressions, PR checks, and merge succeed:
node scripts/repair-database-collation.mjs --project-ref kzrnyjsosryejjejliii --expected-dbname postgres --expected-recorded-version 153.120 --expected-actual-version 153.121 --apply
```

If interrupted, keep the old recorded version until every required rebuild passes. Inspect invalid index identities before retrying; never discard a valid original index or refresh metadata to hide an incomplete repair. A repeated successful invocation returns a no-op. Concurrent rebuilds allow normal writes, but still consume CPU, disk, and brief locks; publication monitoring must not claim guaranteed zero latency impact.

### Disposable rehearsal

`node scripts/rehearse-database-collation-repair.mjs --workspace <temporary-workspace> --scale-rows 8800000` accepts only a workspace verified by the repository's disposable-container guard. It creates a separate ICU database with an intentionally stale recorded version, an invalid concurrently built index, a non-superuser database owner, a foreign-owned table without table-level maintenance permission, and a denied non-owner. It checks data aggregates, index definitions, RLS policies, and grants before and after repair. All roles and the fixture database are removed in cleanup.

Use the existing `createDatabaseWorkspace` and `withDisposableSupabase` helpers to initialize and dispose that workspace, then invoke the rehearsal inside the helper's action. On Windows, normalize CRLF to LF only in the generated SQL copies before starting the stack, as described in the replay evidence below. The workload contains 8.8 million narrow synthetic history rows, 10,681 lookup rows, and 14,645 mapping rows; this mirrors observed cardinalities, not all production row widths or concurrent traffic. Local filesystem metric samples are controlled fixtures for the guard; they are not measurements of production capacity.

The measured operation is an indexed equality lookup ordered by its key with `LIMIT 50`, using `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Record the first query after rebuilding separately from ten warm samples; the first query is not asserted to be OS-cold. Every sample must be below 100 ms and the expected rebuilt index must appear in the plan. These server execution times do not measure browser or network latency.

### Regression evidence

- Full Node regression: `npm run test:node` passed **3,023/3,023 tests**, with zero failed, cancelled, skipped, or todo tests (173,207 ms). Log: `%TEMP%/gnc-phase1-node-regression.txt`.
- Full Node regression with the completed maintenance engine passed **3,065/3,065**, zero failures/skips (257,187 ms); the final focused suite including the connection-route guard passed **43/43**. Type checking, targeted ESLint, tooling checks, and whitespace checks passed. Logs: `%TEMP%/gnc-phase1-node-ready.log` and `%TEMP%/gnc-phase1-focused-ready.log`.
- Initial disposable migration replay stopped at `20261006210000_inventory_row_assignment_future_snapshots.sql` with `INVENTORY_ROW_ASSIGNMENT_HANDOVER_LOCK_ORDER_PATCH_FAILED`. The checked-out predecessor uses LF and this migration uses CRLF, while both committed blobs use LF. Recovery normalized SQL files only inside newly generated disposable workspaces; the next replay passed this migration and applied the full active migration chain. Repository migrations were not changed.
- Recovered disposable `database-check --all` completed successfully: 72 active replay migrations, 22 canonical SQL files containing **743 assertions**, 1 canonical HTTP driver, 3 rollback canaries, 2 sandbox migrations, and **47 sandbox assertions**; database lint, generated types, and generated contract checks also passed. Both temporary stacks were stopped and disposed. Log: `%TEMP%/gnc-phase1-database-lf.log`.
- Supplemental historical replay passed **204 ordered migrations**, **57 SQL test files / 1,461 assertions**, and both dedicated Bloomscapes and Suspend Tag PostgreSQL fixtures. The historical stack was stopped and disposed. Log: `%TEMP%/gnc-phase1-historical.log`.
- The first 8.8-million-row maintenance rehearsal exposed a permission-order bug: a non-owner reached the protected `data_directory` read before denial. The command now rejects non-owners first, and the disposable owner receives only the diagnostic `pg_read_all_settings` membership in addition to database ownership. Production's existing role already has that membership.
- The second maintenance rehearsal stopped on the unexpected-notice guard. PostgreSQL 17's implementation emits a standard warning when concurrent database reindexing skips system catalogs; the repair now distinguishes this exact warning from skipped required indexes. Both failed rehearsals cleaned up their disposable stacks; production was not changed.
- The third full-scale rehearsal passed, including the invalid-index repair, database-owner maintenance without individual table `MAINTAIN`, non-owner denial, unchanged row aggregates/index definitions/RLS/grants, refreshed ICU version, and complete fixture/stack disposal. Environment: PostgreSQL 17 in a disposable Supabase Docker container on this Windows workstation; Docker memory limit approximately 7.55 GiB; Node 24.14.1. Log: `%TEMP%/gnc-phase1-collation-3.log`.
- Reproducible lookup measurements at **8,800,000 rows**: first measured query after rebuild **0.045 ms** (OS cache state uncontrolled); ten warm samples **0.019, 0.012, 0.016, 0.013, 0.011, 0.010, 0.012, 0.029, 0.013, 0.012 ms**; warm median **0.013 ms**, maximum **0.029 ms**. Plan: `Limit` with child index `rehearsal_scale_key_idx`; bound: `LIMIT 50`. These are synthetic local server timings, not measured production request latency.

This report captures pre-merge evidence. It contains no claim that production maintenance or publication has completed; those outcomes must be verified separately before advancing the queue.

## Production maintenance checkpoint and connection recovery

PR #451 merged as `1263962bad464ff614be01b073af8e6d6a22f3eb`; frontend, Supabase backend, and Apps Script publications all succeeded for that commit. The first guarded production attempt rebuilt the previously invalid `public.ph_drive_around_report_rows_archive_batch_idx` successfully, then its client connection ended with `ECONNRESET`. The complete database rebuild and collation refresh were not confirmed, so the recorded version remains **153.120**. No metadata-only refresh or reversal of the successful index repair was attempted.

At **2026-10-15 00:12:17 UTC**, a fresh inspection found **zero invalid indexes**, and the same database start time of 2026-10-12 19:59:42 UTC; the index-progress view was also empty. The project remained `ACTIVE_HEALTHY`. The fixed **00:09:20–00:12:30 UTC** maintenance window contained 72 edge/API events with **zero HTTP 5xx**, and 45 Postgres events with **zero ERROR/FATAL/PANIC**. The data volume had approximately 21.89 GB free after the interrupted attempt. These observations do not establish why the transport reset occurred.

Read-only connection probes confirmed that the session pooler does not apply the requested client startup `application_name` and `statement_timeout`: explicit SQL `SET` commands are required. The recovery change enables TCP keepalive, handles client error events, verifies the session configuration, and preserves the original failure through cleanup. It must pass focused connection-failure regressions and another disposable maintenance rehearsal before production is retried; it must never refresh collation metadata after an incomplete rebuild.

The disconnected attempt left its original backend idle with the maintenance advisory lock held. Recovery verified its exact PID, backend start, completed REINDEX statement, query start, and advisory-lock key before terminating only that orphaned session. This released the lock without undoing the repaired index; arbitrary pooler sessions were not terminated.

Two read-only session probes, one with TCP keepalive and one without it, both completed a 190-second wait and retained their backend PID after an explicit four-minute SQL timeout setting. The reset cause therefore remains unproven. The recovery code passed **52/52 focused tests** and the full Node suite passed **3,075/3,075** with zero failures, cancellations, skips, or todo tests (174,155 ms); type checking, targeted ESLint, tooling checks, and whitespace checks passed. A read-only production audit remained eligible with zero invalid indexes. Log: `%TEMP%/gnc-phase1-recovery-node.log`.

The recovery branch's complete canonical disposable check passed again: **72 migrations, 743 SQL assertions, 47 sandbox assertions, three rollback tests, and the canonical HTTP regression**. Database lint passed its error gate while reporting existing warnings; this is not a zero-warning lint result. Both canonical and sandbox stacks were disposed before historical validation began.

The recovery branch's historical replay also passed **204 ordered migrations, 57 direct SQL files / 1,461 assertions, six acceptance files, and both dedicated PostgreSQL fixtures**. Its disposable stack was stopped before the maintenance rehearsal. These repeated SQL checks were captured in the interactive execution output; the earlier log files listed above belong to the original validation run.

The final recovery rehearsal passed at **8,800,000 rows** with the invalid-index fixture, foreign-owned indexes, non-owner denial, unchanged rows/RLS/grants/index definitions, and successful collation refresh. The indexed `ORDER BY key LIMIT 50` lookup measured **0.082 ms** on its first post-rebuild sample (OS cache condition uncontrolled), then **0.014, 0.028, 0.013, 0.012, 0.013, 0.014, 0.013, 0.012, 0.012, 0.012 ms** warm (median **0.013 ms**). Environment and interpretation match the disposable rehearsal above; these are local server timings. The fixture and stack were disposed. Log: `%TEMP%/gnc-phase1-recovery-rehearsal.log`.
