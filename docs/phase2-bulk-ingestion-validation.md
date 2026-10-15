# Phase 2: bulk PostgreSQL inventory ingestion

## Acceptance and scope

The canonical `ph_master_inventory` Drive snapshot moves from client-side delta reads and serial REST writes to `bulk_import_master_snapshot_v1`. Apps Script still validates and normalizes the complete source batch, opens the existing import fence, performs the required reconciliation, and archives source files only after success. Other dataset importers retain their existing contracts.

The operator approved **55 seconds per background bulk RPC**. Interactive queries retain the **100 ms** gate. Full-size publication, changed snapshots, unchanged snapshots, and exact request retries must each meet the bulk gate before merging.

The database must preserve live `holdstopcode`, `holdstopreason`, and `locationnote` independently of source files. Raw source values and absent-versus-null evidence support the existing import acknowledgment rules. Assignment rules, lineage aliases, deletion protection, role permissions, and revision fences remain part of regression coverage.

## Reproduction

- Run the repository Node regression suite with `npm run test:node`.
- Run the canonical disposable database checks, including the discovered `canonical-http` driver and SQL assertions, with `node scripts/database-check.mjs --all`.
- Replay the historical migrations through the repository's isolated migration harness.
- Run `node scripts/check-tooling-ci.mjs` and `git diff --check`.

On Windows, disposable SQL copies are normalized to the repository's committed LF representation before replay. This does not change checked-in historical migrations or baseline helpers.

## Measurement conditions

The local rehearsal uses PostgreSQL 17.6 on ARM64 Docker with 12 logical CPUs and approximately **7.55 GiB** of Docker memory. The production-shaped synthetic master fixture contains **9,539 rows**; its distributions come from aggregate column counts and lengths, without copying production values. The serialized row payload contains **37,639,368 bytes** across **171 columns**. Results from this environment are measurements, not a production latency guarantee.

The database/RPC measurements include protection triggers, mirror maintenance, and transaction publication. Docker/OS cache state was not controlled, so no cold-cache claim is made. The latest cold PostgREST diagnostic rejected a forged-fence request in **4,702 ms**; PostgreSQL bind took **376 ms** and execute took approximately **2 s**. That diagnostic did not reproduce the earlier gateway timeout.

## Validation status

This record describes local preflight validation on October 15, 2026 UTC. The canonical and historical suites and complete full-volume HTTP repeats passed on disposable environments. A gateway timeout occurred on an earlier additional HTTP repeat before writes; a cold PostgREST diagnostic and subsequent complete runs did not reproduce it. Production deployment is verified separately through the exact-commit release workflow results.

- Canonical disposable database replay passed **73 migrations**, **785 SQL assertions across 23 files**, **3 canaries**, **2 HTTP drivers**, and **47 sandbox assertions**.
- Historical migration replay passed **204 migrations** and **1,461 assertions across 57 SQL files**.
- The full Node suite passed **3,084/3,084**. Type checking, lint, and tooling checks passed; tooling discovered **8 inline scripts** and **13 shell assets**.
- Both full-size HTTP drivers passed. The bulk driver measured **31,255 ms** for new rows, **34,046 ms** for changed rows, **11,771 ms** for unchanged rows, and **2,712 ms** for exact receipt replay. The customer-mapping driver measured **13,798 ms**. The 55-second gate applies to each bulk RPC; these measurements include trigger and mirror work.
- An additional full HTTP repeat received a Kong 504 before writes on a **37.64 MB** invalid-fence request; the expected fence error arrived **12 seconds later** (about **76 seconds total**). After an isolated PostgREST restart, the cold diagnostic rejected the same forged-fence request in **4,702 ms**. The subsequent complete HTTP repeat and fixture cleanup passed: new rows **36,381 ms**, changed rows **41,083 ms**, unchanged rows **13,551 ms**, exact replay **7,408 ms**. The transient gateway delay was not reproduced; these are local measurements, not a production transport guarantee.
- After the final unresolved-identity CTE optimization, a new disposable canonical run measured new rows **31,395 ms**, changed rows **34,760 ms**, unchanged rows **11,369 ms**, and exact replay **3,223 ms**. All four cases met the unchanged 55-second limit.

## Optimization and remaining work

The HTTP fixture tracks its own active runs, uses service-role context for direct fixture writes, removes only its owned lease/run metadata, restores captured revision rows before guarded cleanup, and checks its final state. It seeds and exactly restores the season setting, renews the lease during Season reconciliation batches, and clears its synthetic inventory, assignment, receipt, and reconciliation artifacts. Production fence functions were not weakened.

The bulk path now defers the per-row crop-roll mirror under a private, transaction-bound import context and performs a set-based mirror sync for exact touched IDs, while retaining the established mapper and ordinary row-trigger behavior. It uses direct exact-ID updates, materializes unresolved identities before alias joins, and retains acknowledgment handling when source values return to a prior hash. The release registry checks the private mirror guard/sync security and marker restoration; the migration registry, SQL lint, and Apps Script backend-publication gate include this contract. The new importer activates only after successful backend publication of the same commit.

Both complete full-volume HTTP runs met the 55-second gate for every accepted snapshot and replay. The migration release contract returned `installed=true` on the final disposable stack. Query-plan evidence and the recovery rehearsal are recorded before PR delivery; merge and production verification remain separate delivery steps.

## Query-plan and recovery evidence

Nested `auto_explain` capture used `ANALYZE`, buffers, trigger counts, JSON output, timing disabled, and a 100 ms reporting threshold in a rolled-back disposable transaction. With 9,539 rows, the earlier alias branches discarded roughly 45.5 million join pairs each when statistics were stale; identity mapping took 14,334 ms. The final unresolved-identity CTE removed that work: mapping fell below the 100 ms reporting threshold. The final instrumented new and changed snapshot calls took 47,134 ms and 38,015 ms. These diagnostic measurements include instrumentation and are separate from the HTTP acceptance measurements.

The plans show one execution of each protection trigger per directly updated row and one statement-level mirror publication per batch. The ordinary-write deferral predicate, measured with `EXPLAIN (ANALYZE, BUFFERS)` after the bulk marker was restored, took **0.156 ms** with a warm cache. No frontend list or interactive read query changes in this phase; source fingerprints and mutation receipts provide the import caching and replay paths.

The rollback rehearsal disabled service-role access to the new RPC, removed only its two new inventory triggers, and restored the original mirror function inside a rolled-back transaction; all three assertions passed. Recovery preserves inventory rows and private receipts. The known-good main commit is `cd322f72b66a20f9ea1f728ad623b808ee5c76b7`; the prior verified Apps Script publication is version **321**, commit `613964524ff8736fb1d8461b3952fc01b157107d`.

## Publication and recovery

The database RPC must be installed and its grants and timeout verified before the new Apps Script ingestion code is activated. Frontend publication remains independent. Failed source publication must leave files available for retry, and an unchanged request ID must return the original receipt without applying writes again.

If activation fails after Apps Script publication, restore version 321's files to Apps Script HEAD and restore its deployment pointer before disabling the bulk RPC; scheduled triggers use HEAD source. Preserve receipts and raw acknowledgment evidence; do not delete production inventory or replay source files through an unverified fallback. Additive database objects can remain inactive while recovery is verified. If backend publication fails first, the exact-commit gate leaves the prior Apps Script importer active.
