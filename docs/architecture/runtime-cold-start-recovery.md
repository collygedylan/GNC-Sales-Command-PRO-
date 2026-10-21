# Runtime cold-start recovery — AgData v2.3.27

## Observed failures and repairs

| Finding | Verified cause and repair |
| --- | --- |
| Eval Reports #2 rejected an empty local inventory and stalled on retry | Eval2 explicitly disabled the existing report-page API and awaited full master/assignment snapshots. It now reads authorized report groups directly; the full-download fallback is removed. |
| Cold report initially had no selected categories | First use now selects all 11 report categories; later explicit user selections, including clearing them, are retained. |
| Optional capabilities delayed the first report | Capabilities run in the background. Report reads retain server authentication, canonical access and source-revision enforcement. A failed optional read does not create a retry/render loop. |
| Manager refresh returned to Modules | Same-account transient access refresh retains the current module. Confirmed denial and account changes remain authoritative. |
| Header remained “Awaiting first sync” | A successful dataset-revision read now records connected state before snapshot hydration completes, without granting mutation or complete-row proof. |
| Phone showed 9 watchdog incidents while the production table was empty | Repeated live PostgreSQL reads, with RLS bypass, found **0 events in all statuses**. The checked-in sensor had no production configure/transport call. It now queues up to 100 events per username and flushes through authenticated app-api on login/token recovery, online/foreground events and bounded retry. Native-only authentication and account/auth-epoch changes have focused coverage. The phone's nine individual payloads were not available for inspection; no database rows were marked resolved. |

## Report measurements

Production project: `kzrnyjsosryejjejliii`; inventory: **9,581 rows**.

- Before: installed `manager_report_read_v2` took **12,628.30 ms** for Eval2/all 11 categories, offset 0, limit 25.
- The SQL change resolves active ownership in one join, parses distinct years/stock/date values once, skips empty search work, and aggregates only the selected group page.
- Read-only comparison of the original and optimized query returned **exact JSON equality**, including location totals: **25 groups**, **2,926 total groups**, **7,180 qualifying inventory rows**.
- After applying the migration, the installed production RPC took **1,922.22 ms** with those same counts. This measures database execution, not authenticated Edge/network time or mobile paint.
- Migration `20261021115558_manager_report_set_based_read_v1.sql` matches the live ledger name and body. Installed authorization, published-snapshot proof, revision checks and service-role-only execution were verified.

## Local verification

The prescribed seven Node files passed **179/179** in **4.40 s**. Inline validation passed in **0.79 s**, app-api Deno check in **9.21 s**, tooling checks in **3.51 s**, and site preparation in **8.10 s**: **26.01 s aggregate command time**, excluding earlier reproduction runs and live SQL investigation. After aligning the local migration filename with the applied ledger version, its focused regression passed again in **0.30 s**, bringing final verification command time to **26.31 s**.

No browser connection, Playwright run, Docker build or full migration replay was performed. The updated Manager integration fixture was not run because it is outside the requested seven-file list. Code.gs and historical backfill/trigger configuration were unchanged; the live database had no historical/backfill cron jobs. Device paint under two seconds and delivery of the phone's existing nine payloads remain unmeasured.
