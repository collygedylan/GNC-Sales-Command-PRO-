# v3.0.39 historical delta and Request archive rollout

The historical delta migrations were exercised locally in PGlite. Production database inspection was read-only. No production migration, pruning, scheduler activation, or VACUUM ran.

## Installed read-only evidence

| Relation | Estimated rows | Exact total relation bytes |
| --- | ---: | ---: |
| ph_drive_around_report_rows | 9,060,588 | 14,640,791,552 |
| import_private.import_history_rows | 6,475,786 rows in ready file receipts | 5,898,698,752 |
| ph_hold_stop_itemcode_snapshots | 3,083,162 | 3,092,217,856 |
| ph_drive_mode_history | 39,072 | 127,377,408 |
| ph_orders_history | 32,685 | 101,859,328 |
| ph_reserves_history | 23,945 | 90,996,736 |
| ph_requests_completed_history | 4,148 | 62,980,096 |

The installed Hold snapshot builders use the Drive report manifest for chronological file order. A read-only distinct-file audit found **zero** unmatched Hold file IDs. Installed file metadata included 1,096 `row_indexed`, 26 `processed`, 135 `indexed`, and 5 `failed` files. Only exact count-verified completed file receipts qualify for comparison. Indexed, partial, and unknown files interrupt consecutive runs. A verified zero-row receipt records an empty snapshot and interrupts every item run.

The 5.90 GB private store records full positional workbooks. The installed file receipts report 581 ready Drive files with 5,548,905 expected and staged rows, 23 SOC files with 779,377, and 20 Reserves files with 147,504. Those totals come from receipt metadata. The compactor independently verifies the actual logical count and positions of both files before pruning.

- `ph_drive_mode_history` contains file snapshots and photo or evaluation events. The installed audit found 16,568 `drive_file_snapshot` rows across 24 files and zero existing count-complete file cohorts. `private.fast_archive_drive_v2369` records the raw count before its projection INSERT. Migration 07500 records a separate receipt after the projection writer verifies every expected source UID and its row count. Existing projection rows and photo or evaluation events are retained.
- `ph_orders_history` stores keyed order and Dock accountability evidence. Installed source kinds include 27,420 transaction rows, 4,300 SOC rows, 480 file marker rows, and 145 trip or trip-audit rows without a source file ID. `private.archive_dock_accountability_trigger_v2366` updates checkers, inspectors, and issue evidence independently of import publication. Full SOC workbook cohorts use `import_private.import_history_rows`.
- `ph_reserves_history` contains 23,945 enriched reserve records across 117 filename keys. `private.archive_reserve_trigger_v2366` refreshes an individual row, and `private.refresh_reserve_history_v2366` upserts a history key composed from the reserve UID and filename or update timestamp. The active refresh can run across mixed current rows and publishes no immutable file receipt or empty-file barrier. Full Reserves workbook cohorts use the private import store.

The larger installed relation scan also found separate event and operational stores. `ph_transactions_keyed_rows` is keyed by file, content digest, sheet and source row. `private.ph_eval_item_low_stock_order_rows` supplies versioned order events to protected sales analytics. `sales_private.source_versions` is keyed by credit source and revision. `hl_order_private.po_import_rows` is per-run PDF staging, and `production_schedule_rows` belongs to a separate protected workbook and sheet schedule lifecycle. Current ERP tables, stage rows, GDD cycles, Request and photo evidence, and these event stores are retained.

The read-only evidence is at `G:/My Drive/GNC/AgData/Release Evidence/phaseb3039-history-delta-audit.json`. Fresh Watchdog count was zero. Exact installed legacy cron job **56** (`agdata_historical_state_dedup_v2366`, command `select private.run_historical_state_dedup_v2366();`) was still active. Migration 01000 pauses only that exact job. Do not run old global-hash compaction; it can discard reversions.

## Scope and contracts

- 01000 disables global-hash suppression through the existing compact history trigger. Raw Drive and Hold use the Drive file manifest, and full positional Drive, SOC and Reserves snapshots use their own private file receipts.
- 03000–06000 reconstruct each archived observation from immutable, foreign-keyed business state and its own UID, file/date, and source lineage. Authorized logical readers preserve archived observations after physical updates, deletes, and rebuilds. The views mirror the installed relation grants and active-profile restriction. A different row-scoped policy or an unmigrated SQL reader blocks pruning.
- 07000 captures future raw Drive and Hold observations in the insertion transaction. An exact replay of an already-pruned UID, allowing for write timestamps, stays out of the physical table. The private queue independently reclaims duplicates only between consecutive count-verified snapshots. Hold also checks the exact item cohort against its Drive source. The job processes at most 500 physical candidates with single-flight selection and backoff. It is installed inactive pending verified reader and writer receipts.
- 06500 keeps the private workbook begin, stage, publish and paged-read RPCs. Future unchanged positions with the same positional header vector enter immutable coverage during staging and skip the full physical insert. Both publication and readers use the same lossless logical rows. Existing physical duplicates can be compacted in explicit batches of at most 500.
- 07500 records the Drive Mode projection receipt at the end of the canonical fast Drive archive writer. It leaves the receipt absent on an incomplete or wrong-UID projection and keeps the existing ERP writer response.
- 02000/08000 add the canonical Request path `SalesRep / Customer / Consignee / YYYY-MM-DD_RequestID / ItemCode`; blank/N/A uses `Direct_or_NA`. The five-level service-only read uses the existing actor/scope authority, preserves full-resolution URL links and source evidence, and redacts financials outside the existing authorized scope. Exact case-insensitive party lookup uses separate indexed predicates. The service-only queue projects the existing mutable `ph_photo_archive_jobs`, including `archive_path_receipts`; it does not create an independent worker queue.
- App-api routes historical GET/HEAD requests through the logical views, preserving authorization, headers, abort signal, query bounds and missing-relation-only rollout fallback. Writes still use the physical owners. Apps Script's existing raw snapshot publication is picked up by the database file receipt; the signed Request folder worker remains its separate canonical deployment. Active inventory, completion/protection triggers, startup reads and delivery permissions stay unchanged.

## Executable rollout after approval and installed checks

1. Install the registered migrations in timestamp order. Confirm the exact legacy job is inactive and the new job is installed inactive. Deploy and verify the compatible `app-api` with `--no-verify-jwt`, then the scoped signed Apps Script patch and root PWA using the normal release order. Verify authorized archive, Hold/GDD, direct PostgREST, and signed worker callers before enabling pruning.
2. Run a read-only exact candidate pass. Each call processes at most the requested item cohorts, each capped at 5,000 observations; use `--resume` until `done:true`. Oversized and unkeyed cohorts are explicitly retained in the report. Counts are exact for processed observations, not an instantaneous whole-table snapshot while concurrent imports continue.

```powershell
node scripts/compact-historical-deltas.mjs --relation=drive --mode=dry-run --limit=100
node scripts/compact-historical-deltas.mjs --relation=drive --mode=dry-run --limit=100 --resume
node scripts/compact-historical-deltas.mjs --relation=hold --mode=dry-run --limit=100
node scripts/compact-historical-deltas.mjs --relation=hold --mode=dry-run --limit=100 --resume
node scripts/compact-historical-deltas.mjs --relation=import --mode=dry-run --limit=100
node scripts/compact-historical-deltas.mjs --relation=import --mode=dry-run --limit=100 --resume
```

3. After the exact compatible Edge and caller receipts are verified, enable only the new bounded scheduler and read its state back:

```sql
DO $$DECLARE selected bigint; BEGIN
  SELECT jobid INTO STRICT selected FROM cron.job
  WHERE jobname='agdata_history_delta_queue_v3039' AND schedule='* * * * *'
    AND command='select private.process_history_delta_queue_v3039();';
  PERFORM cron.alter_job(selected,active:=true);
END $$;
SELECT jobid,jobname,username,active FROM cron.job WHERE jobname='agdata_history_delta_queue_v3039';
```

4. Apply bounded historical batches from the direct verified live DB credential. The CLI refuses to apply before queue activation/legacy pause, requires an explicit apply mode, keeps one transaction per item, retries contention at most three times, and saves checkpoints under Release Evidence. The transaction binds a run ID to the durable item receipt, so repeating after a lost checkpoint does not count or prune the same rows twice. Both apply and dry-run use `.env` unless the explicit `GNC_HISTORY_DATABASE_URL` is set.

```powershell
node scripts/compact-historical-deltas.mjs --relation=drive --mode=apply --limit=50
node scripts/compact-historical-deltas.mjs --relation=drive --mode=apply --limit=50 --resume
node scripts/compact-historical-deltas.mjs --relation=hold --mode=apply --limit=50
node scripts/compact-historical-deltas.mjs --relation=hold --mode=apply --limit=50 --resume
node scripts/compact-historical-deltas.mjs --relation=import --mode=apply --limit=50
node scripts/compact-historical-deltas.mjs --relation=import --mode=apply --limit=50 --resume
```

5. Once done, repeat the apply resume with `--vacuum`, or execute the following outside a transaction using a bounded maintenance session. `TRUNCATE FALSE` avoids the exclusive tail-truncation phase. Ordinary VACUUM makes space reusable and updates statistics; it does not establish physical GB savings. The checkpoint records exact before/after rows and bytes, estimated live/dead tuples, the shared immutable state and coverage bytes, concurrent net rows, and approximate reusable space when installed `pgstattuple_approx` is available. Measure physical byte reduction separately and report it only if observed.

```sql
SET lock_timeout='1s';
SET statement_timeout='120s';
VACUUM (ANALYZE, TRUNCATE FALSE) public.ph_drive_around_report_rows;
VACUUM (ANALYZE, TRUNCATE FALSE) public.ph_hold_stop_itemcode_snapshots;
```

After installation, run representative authorized exact Customer and Consignee lookups separately and record `EXPLAIN (ANALYZE, BUFFERS)` for the matching `lower(customer_name)=lower($1)` or `lower(consignee_name)=lower($1)` predicate under the corresponding actor scope. Local PGlite indexed probes were below 2 ms; no live latency receipt exists here.

For the private import store, enumerate ready snapshots by dataset, report date and sequence using the direct verified database credential. For each selected snapshot, call `import_private.compact_import_history_delta_v3039(snapshot_id, 0, 500, false)` in a read-only transaction. Continue with the returned `next_row` until `done:true`. After the installed stage, publish and paged-reader receipts are verified, repeat the same bounded traversal in explicit apply mode. Record physical and immutable archive bytes separately before reporting savings.

## Verification and retained exceptions

The Node history/transport and migration runner tests, Golden Invariant 563, and three PGlite suites validate exact behavior: A→B→A, changed headers, zero/unknown gaps, complete-file proof, physical 500+1 batch convergence, unchanged original logical observations, unauthorized access, index use, service-only Request/queue access and receipt evidence. Deno 2.9.6 checks and bundles the Edge import. The on-disk Edge bundle is a local validation artifact, not deployment proof.

The active legacy job has not been paused live by this work. No prod migration, file move, compaction, queue activation, or VACUUM ran. Public Drive Mode, Orders and Reserves evidence and oversized, unkeyed or ambiguous raw cohorts are retained. The private tests cover duplicate and blank headers, retained-row mutation and deletion, partial and empty receipts, dataset isolation, ready-file replay, and legacy physical compaction.

Archive state independently of physical rows. Require exact receipt verification for both files before pruning and compare only adjacent file cohorts. Verify the original-observation projection and caller authorization before activating the scheduler. Measure physical and archive bytes separately after any installed maintenance.
