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

Phase 2 is halted under the three-consecutive-failure rule. No Phase 2 PR, merge, or production deployment has occurred. The implementation is preserved on `codex/bulk-postgres-ingestion` and is not ready for deployment.

- The full Node suite passed **3,079/3,079** tests. Tooling checks parsed **8 inline scripts and 13 shell assets** successfully.
- The earlier focused database run passed **32/32** assertions. A subsequent review added a 33rd assertion for an omitted source priority and a corresponding live-value preservation fix; that expanded test has not passed yet.
- A fresh disposable HTTP stack replayed all **73** canonical migrations successfully.
- The HTTP test then failed because it expected `BULK_MASTER_IMPORT_FENCE_LOST`, while the existing guard returned `MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID`. The test expectation was corrected.
- Two subsequent focused SQL attempts failed during fixture setup, before assertions: first `MASTER_SNAPSHOT_NOT_READY`, then `MASTER_IMPORT_FENCE_EXPIRED`. The failed HTTP fixture left import-fence metadata behind; restoring only the disposable dataset readiness state was insufficient. These three consecutive test failures triggered the mandatory stop.
- Full-size RPC latency, the expanded SQL assertions, full SQL regression, strict lint, and the historical migration replay remain unverified for this patch. No performance acceptance claim is made.

Recovery requires a fresh disposable workspace and corrected HTTP fixture/fence cleanup before re-running validation. The release migration registry, strict temporary-table lint registration, and database-before-Apps-Script activation order still need a reviewed delivery change; no deployment scripts, workflows, or baseline helpers have been modified.

## Publication and recovery

The database RPC must be installed and its grants and timeout verified before the new Apps Script ingestion code is activated. Frontend publication remains independent. Failed source publication must leave files available for retry, and an unchanged request ID must return the original receipt without applying writes again.

If activation fails, restore the last verified Apps Script version before resuming import triggers. Preserve receipts and raw acknowledgment evidence; do not delete production inventory or replay source files through an unverified fallback. Additive database objects can remain inactive while recovery is verified.
