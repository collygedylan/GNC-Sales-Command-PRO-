# Item-specific open-stock targets

The source is the processed SOC archive (`13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo`). The initial discovery contained 471 files. Each scan inventories the current folder rather than hard-coding that count. Original files remain unchanged.

## Calculation

Only nonblank/nonzero Dock lines with an itemcode, stable order identity, and a positive numeric `QUANTITYORDERED` qualify. Invoiced lines remain eligible. The two sampled Reserves reports contain no Dock-filled lines and therefore contribute zero observations; they still pass through the same parser and exclusion audit. The unrelated DriveAround inventory workbook is excluded only after its inventory schema is confirmed.

Reports are grouped by Chicago report day, warehouse, transaction, consignee (customer fallback), and normalized itemcode. For each daily group, retain the latest qualifying report's entire set of row occurrences. Multiple source lines are preserved, even when their quantities match. A group disappearing from a later report retains its last qualifying appearance that day. Flatten these retained groups into individual line observations; do not sum them into an order total. An observation appearing again on another day counts again.

Modern filenames encode a 24-hour clock before YYYYMMDD. Legacy dated filenames use their explicit sequence, or sequence zero when unnumbered. Creation time breaks equal report-time/sequence ties; Drive file ID provides the final deterministic tie-breaker. A truly undated filename uses its Chicago creation day, marked `creation_time_fallback`. Modified time tracks revisions, never report dates. No stable line ID exists, so this snapshot convention cannot identify a duplicate already present inside one source export.

For each itemcode:

`suggested_qty = ceil(mean(line quantities) + max(mean(line quantities), percentile_disc(0.75)))`

Store observation count, distinct-day count, source-file count, date coverage, mean, P75, and calculation time. The summary download includes all historical itemcodes. Fewer than ten observations are labelled limited history; an item with no eligible observations has no invented average.

## Persistence and access

The manifest tracks every Drive ID/revision and parsing disposition. Immutable staged file revisions have bounded row uploads and retain source sheet/row references plus exclusion counts. Excluded nonempty source rows are recorded as compact row-number ranges with their exclusion reason, allowing each exclusion to be traced back to the original sheet without copying customer details. Identical manifest scans and uploads are idempotent. A new scan reuses previously finalized revisions, while unknown formats or incomplete uploads prevent activation. The prior completed run remains active until every file in the replacement manifest reconciles. Per-run item statistics are computed once at activation and read from a cache.

Manual overrides are stored separately and survive all recalculation. Only active `dylan_collyge`, `megan_kelly`, and `jd_jones` profiles can set or clear them through the dedicated RPC. A revision mismatch rejects a stale write; changes retain an audit trail. Existing Assigned Items/Eval Reports #2 viewers may read aggregate quantities. Raw historical customer/order identities remain private.

Effective quantity is manual override, otherwise computed suggestion, otherwise the existing report fallback (currently 150). Eval Reports #2 applies strict `S_LTS < effective_qty` in both SQL and JavaScript while retaining its season/year/support-row rules. Standalone NCR and Buildings/Move Up retain their current behavior. Assigned Items spreadsheet exports include computed columns but do not import overrides from those columns.

## Bounded background processing

The existing five-minute Apps Script scheduler queues `runSocOrderHistoryBackfillChunk_` independently of the operational SOC importer. Each invocation processes at most three pending files and checks its execution budget between files. Spreadsheet rows are read in 2,000-row chunks. Uploads are capped at 250 eligible lines per RPC and yield after 4 minutes 40 seconds. A later execution resumes after the last persisted source-row ordinal, so a large file can span runs without duplicate observations. The worker resumes until coverage is complete and continues scanning for new revisions. Failed/unknown files remain pending; they cannot silently activate partial suggestions. The UI indicates initial processing until a complete run is available.

Before accessing the archive or import RPCs, the worker requires a successful current-main Pages release compatible with its deployed code, including validation, publication, exact-live verification, and all four live canary suites. If the deployment fingerprint is older than main, both Code.gs GitHub blobs must match. Pending/failed releases and unavailable GitHub responses defer the worker. It caches the approved backend fingerprint in Script Properties, so subsequent chunks continue without repeatedly querying GitHub, including through frontend-only releases. Deploying new backend code requires fresh release approval. This gate leaves the operational SOC importer independent. If the existing five-minute trigger is absent, invoke the bounded `runSocOrderHistoryBackfillChunk_` once from the Apps Script editor after deployment is green; the worker schedules its own continuation. Do not use the broad operational sync as a backfill bootstrap.

## Rollout and verification

The existing cloud release proof and current-main guards run before a narrowly scoped migration step in Apps Script sync. That step requires the repository Actions secret `SUPABASE_DB_URL` (Supabase direct or session-pooler Postgres connection string) and verifies it belongs to `SUPABASE_URL`. It applies only `20260928145055_item_low_stock_targets.sql`, atomically records it in migration history, and checks the read RPC. The compatible Apps Script importer is then published and health-verified before the workflow dispatches Pages; Pages retains its existing compatibility gate. Both workflows can reuse the same fully validated merged-PR proof. Never put this credential into the app or source files.

Local checks cover the actual parser used by Apps Script, schema/date handling, daily deduplication, exports, override authorization/conflicts, report parity, and compiled browser behavior. Database acceptance tests run against isolated PostgreSQL in CI; the local PGlite harness is supplemental. Initial averages must not be presented as complete until archive coverage activates. Local source sampling is not a substitute for that full backfill.

### Diagnosing a blocked database rollout

Migration failures report a fixed phase and a sanitized network/TLS error code or Postgres SQLSTATE. Raw database messages, SQL, connection strings, and credentials are never printed. A failed rollback or connection close must not hide the original failure.

The Apps Script workflow has an explicit `diagnose_database` dispatch input. It defaults to false. When enabled on main, a separate job checks the configured connection and schema presence in a read-only transaction. Candidate branches cannot run this secret-bearing diagnostic. It does not apply the migration, authorize a release, update Apps Script, or dispatch Pages. Use it to diagnose the existing Actions secret without retrieving that secret locally. The normal deployment still requires current main and the validated release proof.

Keep certificate verification enabled. An SSL-mode deprecation warning alone is not a connection diagnosis. Supabase direct connections may require IPv6; for an IPv4-only runner, use the exact session-pooler connection string from the project's Connect dialog (port 5432), preserving the project-specific username and URL-encoding reserved password characters. Never guess the pooler hostname. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
