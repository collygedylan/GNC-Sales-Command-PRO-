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

The local rehearsal uses PostgreSQL 17.6 on ARM64 Docker with 12 logical CPUs and approximately 8.1 GiB of Docker memory. The production-shaped synthetic master fixture contains **9,539 rows**; its distributions come from aggregate column counts and lengths, without copying production values. Results from this environment are measurements, not a production latency guarantee.

First-run measurements start on a newly created disposable database after schema replay and fixture preparation. They are not OS cold-cache measurements. Repeated operations are explicitly warm-cache measurements. Protection triggers, mirror maintenance, and transaction publication are included in full RPC timings.

## Validation status

Phase 2 is halted after three consecutive full-volume HTTP failures under the operator-reset debugging limit. No Phase 2 PR, merge, or production deployment has occurred. The implementation is preserved on `codex/bulk-postgres-ingestion` and is not ready for deployment.

- The resumed full Node suite passed **3,084/3,084** tests. The earlier tooling check parsed **8 inline scripts and 13 shell assets** successfully; it has not been repeated after the pipeline changes.
- The expanded focused database suite passed **33/33** assertions, including omitted-priority preservation. It passed again on the same disposable database after an HTTP failure, verifying that the repaired cleanup no longer poisons the next SQL fixture with a stale import lease.
- Strict SQL lint passed with no errors. The new bulk migration release contract returned `installed=true` against the disposable database; its focused Node contract suites passed **66/66**, and deployment authorization tests passed **29/29**.
- A fresh disposable HTTP stack replayed all **73** canonical migrations successfully.
- The HTTP test then failed because it expected `BULK_MASTER_IMPORT_FENCE_LOST`, while the existing guard returned `MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID`. The test expectation was corrected.
- Two subsequent focused SQL attempts failed during fixture setup, before assertions: first `MASTER_SNAPSHOT_NOT_READY`, then `MASTER_IMPORT_FENCE_EXPIRED`. The failed HTTP fixture left import-fence metadata behind; restoring only the disposable dataset readiness state was insufficient. These three consecutive test failures triggered the mandatory stop.
- The original halt above was followed by an explicit operator reset and authorization to repair the fixture and update the Phase 2 deployment pipeline.
- Resumed HTTP attempt 1 failed before writes because the revision fixture used `updated_at` instead of the actual `changed_at` column. This was corrected using the database schema.
- Resumed HTTP attempt 2 completed the 9,539-row bulk insert within the 55-second assertion, then failed at downstream reconciliation with `SEASON_SALES_SETTINGS_INVALID`. The fixture lacked the required `current_season_salesyear` setting. Cleanup completed, and the subsequent 33 SQL assertions passed.
- Resumed HTTP attempt 3 used complete F1/27 season settings and failed during the initial bulk RPC with PostgreSQL statement timeout (HTTP 500). The 55-second production gate remains unchanged. No performance acceptance claim is made from the earlier incomplete fixture.
- Full SQL regression, historical migration replay, refreshed tooling/type checks, and all four full-size HTTP scenarios remain incomplete for this patch.

## Resumed repair and remaining work

The fail-import contract deliberately preserves interrupted readiness and a lease; restoring readiness alone cannot recover it. The HTTP fixture now tracks its own active runs, uses service-role context for direct fixture writes, removes only its owned lease/run metadata, restores captured revision rows before guarded cleanup, and checks the final state. It seeds and exactly restores the season setting, renews the lease during Season reconciliation batches, and clears its synthetic inventory, assignment, receipt, and reconciliation artifacts. Production fence functions were not weakened.

With explicit operator approval, the release registry now includes the migration and its security/timeout/trigger checks, strict SQL lint knows the two temporary shapes, and Apps Script activation waits for successful backend publication of the exact commit. Frontend publication remains independent. These pipeline changes are local and have not been deployed.

Next investigation must profile the complete bulk RPC with valid season settings and all existing protection/mirror triggers enabled before another full validation attempt. Also review the source-hash cache against an app edit that returns a shielded field to its previously imported value: a focused reproduction is still needed to confirm that an unchanged source snapshot performs the required acknowledgment. The current patch must not merge until the performance gate and complete regression suite pass.

## Publication and recovery

The database RPC must be installed and its grants and timeout verified before the new Apps Script ingestion code is activated. Frontend publication remains independent. Failed source publication must leave files available for retry, and an unchanged request ID must return the original receipt without applying writes again.

If activation fails, restore the last verified Apps Script version before resuming import triggers. Preserve receipts and raw acknowledgment evidence; do not delete production inventory or replay source files through an unverified fallback. Additive database objects can remain inactive while recovery is verified.
