# Drive, Eval and SUSPEND recovery

## Drive cold-start recovery — v2.3.29

The 11-to-2 header change was a summary bug: each revision response replaced the previous list, so Drive's two-source response erased Home's eleven-source summary. The connection display now merges states by source within the same authenticated owner and clears on account/session changes.

Drive requested a master-only preview but `previewProductionSnapshots` rejected partial cohorts outside AV. This discarded the first page and left Drive dependent on full pagination and settings. Drive now accepts that authorized display preview; complete hydration uses at most two page reads in flight. Navigation and new read generations detach obsolete promises immediately, with identity/generation checks rejecting late results. A cold Drive/AV load also has one bounded direct authenticated `inventory_read` preview recovery, followed by normal coordinator hydration. Partial previews never establish complete inventory or write proof.

Focused regressions reproduced all three original failures before the patch. The final specified Node check passed 219/219 tests in 21.55 seconds, including a 9,600-row A–Z fixture for Dylan and Brian, first-page display, cancelled-read recovery, the AURA/Watchdog visibility locks, and the existing specified Eval/SUSPEND/security checks. This is fixture execution, not a mobile paint measurement. Inline passed in 12.57 seconds and Deno checked app-api, aura-llm-router and aura-query in 24.76 seconds. The concurrent tooling run exceeded its 15-second timeout; rerunning only tooling without competing checks passed all 36 tests in 5.68 seconds. `git diff --check` passed. The requested combined time budget was exceeded.

Read-only production verification on October 21, 2026 returned 9,585 inventory rows at READY revision 8,429, and the same eleven Eval counts shown below. The metadata RPC returned 7,186 matching rows in approximately 6.1 seconds; a repeat timed out at the connector's 120-second limit and was not retried. These observations do not establish the requested sub-2.5-second live render. The user authorized SQL/service-role integration and Node verification in place of authenticated client HTTP calls. Historical backfill and trigger configuration are outside this change.

The operational read audit confirmed that master inventory, CAV and reserves already use authenticated `app-api` readers; their authenticated raw-table SELECT grants are absent. SOC uses the same gateway. Warehouse assignments use authenticated REST with an active-profile RLS policy. No anonymous SELECT policy was added.

SUSPEND now obtains both location metrics from the requested item/location. A missing physical location becomes zero only after the complete source read is bracketed by the same verified inventory revision. Item totals retain the item/lot → item → CAV fallback, and missing item data remains unknown. Numeric location photo zero passes through the card renderer without replacing request-owned photo evidence. The seven focused SUSPEND tests passed in 0.89 seconds, including all four item IDs and rejection of the unrelated location's photo count of 967.

Current READY source rows (master revision 8,429; CAV revision 37) yield the following six metrics under the updated enrichment rules. These are source-derived values, not authenticated client HTTP response or rendered-device measurements.

| Item at 0.00.111 / 27.F1 | On Hand | Review | Available | Open Stock | Loc Photo Match | Loc On Hand |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 010248.021.1 | 136 | 0 | 136 | 116 | 0 | 0 |
| 006009.031.1 | 35 | 35 | 0 | -400 | 0 | 0 |
| 006408.031.1 | 2,946 | 0 | 2,946 | 2,652 | 0 | 0 |
| 008035.081.1 | 12 | 0 | 12 | -3 | 0 | 0 |

The header Watchdog count is restricted to canonical `dylan_collyge`, with explicit hidden/display state at boot, session configuration and logout. Account changes and stale responses cannot restore the prior owner's count; background telemetry and existing Manager review access retain their independent authorization.

The same release restricts AURA to the active canonical `dylan_collyge` profile. Other accounts force-hide and dispose the floating control, widget and voice/panel state; verified server identity also gates app-api and router/query authorization. The SQL migration adds the owner condition to access, context, inventory and SOC reader RPCs, retaining their existing capability checks and grants. This covers callers using the database APIs directly. The signed deployment health probe remains a system diagnostic and does not grant user AURA access.

Read-only migration preflight confirmed that the replacement anchor occurs exactly once in each of the four live RPC definitions, each retains SECURITY DEFINER and authenticated execution, and none grants anonymous execution. The proposed owner condition admits Dylan and rejects Megan, JD and Brian. Deployment applies this guarded migration before Edge Functions and Pages.

## Previous release — v2.3.28

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
