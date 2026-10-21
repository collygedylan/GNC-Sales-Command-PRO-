# Eval and SUSPEND metric recovery — AgData v2.3.28

## Changes and verification

Eval's paged index intentionally has empty local report arrays; the picker incorrectly counted those arrays instead of the authoritative server counts. It now uses all 11 server counts. The list renders materialized pages with a single continuation/retry control, preserves loaded cards during refresh, rejects changed-account responses, and replaces rows on a new source revision. An incomplete page with `hasMore` becomes an explicit retry state.

Each page previously started up to 25 additional item-row reads. The group response now includes up to 18 preview rows per item, with full item inquiry retained for larger groups. Read-only comparison confirmed exact equality of the existing response fields; the first 25 groups contained 97 preview rows, with item identity and location totals verified. The SQL migration also preserves JSON enrichment semantics while avoiding repeated array concatenation and scalar recursion; its transaction checks old/new enrichment equality on a nested fixture.

SUSPEND now enriches its authorized SOC rows from bounded item-specific DriveAround and CAV reads. Matching proceeds through item/location/lot, item/lot, item, then CAV. Physical quantities are summed, repeated season Open Stock totals are counted once, and location totals remain specific to the tag's location. Display fallback does not grant Reclass source identity. Server-enriched metrics render without queuing another inventory identity read; absent verified source rows produce zero, whereas unavailable quantities remain N/A. The actual CAV table is `ph_cav_import`; `ph_warehouse_assigned_items` has assignment fields, not stock/hold/photo metrics.

Watchdog checks now detect SUSPEND metric dashes, visible Eval `Loading...` rows lasting 2,000 ms, and all-zero counts that contradict a positive authoritative match count. Valid empty reports and numeric zero/N/A values remain valid. Timers are fenced by account and view; telemetry contains diagnostic labels rather than row contents.

## Live production measurements

Read-only production SQL returned **9,585 inventory rows**, **7,186 qualifying rows**, and **2,933 item groups**. The installed RPC returned its first **25 groups / 97 preview rows in 6,357.51 ms**; the pre-change measurement was **5,643.53 ms** for groups without previews. The requested **1,500 ms first-response target remains unmet**. These are database RPC measurements, not authenticated HTTP round trips or mobile paint; no browser validation was run.

| Report | Matching rows |
| --- | ---: |
| S1WithPRI | 450 |
| U1 | 514 |
| U2 | 441 |
| U3 | 268 |
| ODLocNoteDate | 4,361 |
| HS+5days | 598 |
| GETOffHold | 754 |
| LowStock | 1,364 |
| NoPRI | 2,274 |
| Culls | 923 |
| NotInF1 | 2,038 |

The following captured production source rows were evaluated through the actual new TypeScript enrichment helper for `0.00.111`, lot `27.F1`; this is not an authenticated app-api response measurement.

| Item | On Hand | Review | Available | Open Stock | Loc On Hand | Loc Photo Match | Hold / Reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 010248.021.1 | 136 | 0 | 136 | 116 | 0 | N/A | H / leaf quality |
| 006009.031.1 | 35 | 35 | 0 | -400 | 0 | N/A | N/A |
| 006408.031.1 | 2,946 | 0 | 2,946 | 2,652 | 0 | N/A | H / leaf quality, retained from SOC |
| 008035.081.1 | 12 | 0 | 12 | -3 | 0 | N/A | N/A |

The third item's shared master photo match quantity is 967; existing request-owned photo evidence rules correctly keep SUSPEND Loc Photo Match at N/A. Negative Open Stock is preserved rather than clamped to zero.

## Required checks

The seven prescribed Node files covered **179 tests**. One new VM test initially extracted a function's default `{}` parameter as its body; after correcting the test extraction, the affected SUSPEND file passed **7/7 in 0.95 s**, and all other tests had passed. Inline passed in **0.89 s**, app-api Deno in **4.65 s**, tooling in **3.15 s**, and site preparation in **8.61 s**. Final verification commands totaled **27.42 s including reruns** (above the requested 25 s); earlier investigation checks are excluded. `git diff --check` passed.

Migration `20261021125546_manager_eval2_batched_preview_v1.sql` is installed; actor authorization, Eval permission, published-snapshot proof, source-revision checks, and service-role-only execution were verified. No browser, Docker, full regression, or historical migration replay ran. Code.gs and the paused historical backfill/15-minute trigger configuration were unchanged.
