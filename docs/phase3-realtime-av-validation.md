# Phase 3: Realtime access and AV background hydration

## Scope and acceptance

Phase 3 reuses the existing production Realtime publications for master inventory and dataset revisions. It does not add database migrations or broaden production grants. Inventory status refreshes wait for a verified source, deduplicate pair reads, limit concurrency and queue size, and preserve optimistic overlays. AV displays a bounded first-page preview while the complete snapshot is prepared in yielding batches, then publishes the verified cohort atomically.

On October 15, 2026, the operator explicitly accepted the measured **242.6 ms (rounded to 243 ms) Phase 3 AV render** and waived the 100 ms gate for this specific AV rendering check so delivery can advance. Phase 3 acceptance is **with this exception**, not a claim that AV rendering meets 100 ms. Phase 4 must optimize AV alongside Request, Archived, and Suspend views and restore the strict 100 ms requirement. The browser test retains its strict assertions for that follow-up.

## Permission parity and disposable backend rehearsal

Read-only production inspection confirmed that `authenticated` can select only `itemcode`, `locationcode`, and `unique_id` from `ph_master_inventory`; table-level SELECT and operational-field SELECT are denied. RLS remains enabled with `inventory_status_realtime_read_v1` and `scheduled_handover_active_session`. The canonical disposable baseline also contains a historical full-table grant and sales policy that are absent in production. The test fixture snapshots those grants/policies, models production's strict boundary, preserves other roles' privileges, and restores the original fixture exactly on cleanup.

The successful local rehearsal used PostgreSQL 17.6 on ARM64 Docker, shared buffers 128 MB, work memory 4 MB, and 8 parallel workers. Its synthetic production-shaped dataset contained **9,539 rows**, with a **161-column browse projection** and **500-row server pages**. OS/shared-buffer caches were not flushed; the first HTTP call is the first application request after fixture setup, not a controlled machine-cold measurement.

| Operation | Measured result |
| --- | ---: |
| Background bulk fixture publication | 32.036 s |
| Browse SQL execution | 30.553 ms |
| Exact count SQL execution | 11.713 ms |
| Exact pair SQL execution | 1.409 ms |
| Dataset revision SQL execution | 0.033 ms |
| First-page HTTP including auth/network | 427.68 ms |
| Warm first-page HTTP p50 / p95 | 331.99 / 372.55 ms |
| Pair HTTP including auth/network | 233.31 ms |
| Warm pair HTTP p50 / p95 | 201.80 / 211.25 ms |
| Realtime delivery to both authorized sessions | 169.74 ms |

Each authorized session received exactly one event; the disabled account received zero. The new Realtime payload contained exactly the three permitted identifier fields, and the old payload contained only `unique_id`. Disabled-account inventory API access returned 401. The fixture, original ACL, and owned containers were cleaned up successfully. Full `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans are retained with the local rehearsal evidence; the paginated browse query used 682 shared-buffer hits and zero reads in that measurement.

## AV rendering evidence and accepted exception

The final browser measurement used desktop Chromium at **1440 × 1000**, Node 24.14.1 on Windows, a freshly prepared release site, and **9,539 synthetic rows**. Service requests were mocked; later master pages and side datasets were held to verify the display-only preview. The application fixture started cold and then measured warm navigation. Browser tracing and 1 ms CPU sampling were enabled. These are local UI measurements, not production network claims.

| Milestone | Measured result |
| --- | ---: |
| First visible card | 526.3 ms |
| Display preview size / API page size | 50 / 500 rows |
| Preview commit / render | 8 / 63 ms |
| Preview search response | 164.9 ms |
| Largest preview main-thread task | 117 ms |
| Full 9,539-row commit | 67.5 ms |
| Full AV render | 242.6 ms |
| Largest task through full verification | 286 ms |
| Warm first visible card | 54 ms |
| Warm AV render | 163.7 ms |
| Largest warm main-thread task | 185 ms |

All semantic checks passed: the preview did not authorize mutations, the complete dataset reached the correct verified context and Up to date status, search input survived hydration, and warm navigation made no extra master reads. The three recorded browser failures were the preview/full/warm `<100 ms` timing assertions; these are covered by the explicit Phase 3 AV rendering exception.

The remaining full-render work is concentrated in `buildResolvedAVBaseState` (221.4 ms), including `getAvRawTabItems` (127.1 ms), `getAvSalesRowsForBucket` (122.2 ms), shared filters (50.8 ms), and search (43 ms). Nested timings are not additive. Warm base-state rebuilding took 145.5 ms. These measurements define the Phase 4 AV optimization target.

## Regression and delivery status

- Final Node regression: **3,110/3,110 passed** in 184.5 seconds.
- React: **101/101 passed** across 18 files; Python contracts: **3/3 passed**.
- Type checking, targeted ESLint, tooling contracts, release-version consistency, and inline parsing passed (8 inline scripts and 13 shell assets).
- Full-size disposable HTTP drivers passed: 9,539-row bulk import insert **30,989 ms**, changed **32,284 ms**, unchanged **12,138 ms**, and exact retry **2,558 ms**; the 14,645-row customer-mapping publication measured **14,316 ms**, including its intentional 9-second delay.
- Canonical disposable validation passed **73 migrations**, **785 assertions across 23 SQL files**, **3 rollback checks**, and both HTTP drivers; the sandbox replay passed **2 migrations** and **47 assertions**. Schema/type generation checks passed.
- Historical disposable replay passed **204 migrations** and **1,461 assertions across 57 SQL files**, plus both dedicated PostgreSQL fixture groups. Combined canonical, historical, and sandbox assertions: **2,293 passed**.
- Edge Function validation passed all **35 type-check targets** and **188/188 Deno tests** across the 13 CI-discovered groups.
- Phase 3 validation is **PASS with the explicitly accepted AV rendering exception**. Production publication is verified separately against the exact merged commit.

## Reproduction and recovery

- `npm run test:node`
- `npm run test:v2`
- `node scripts/run-discovered-tests.mjs python`
- `node scripts/check-tooling-ci.mjs`
- `node scripts/database-check.mjs --all` using a disposable Supabase stack, plus the historical migration fixture.
- `supabase/ci/realtime_av_hydration.mjs` against a verified local disposable workspace with Realtime and the staged application API enabled.
- `tests/av-hydration.e2e.spec.ts` on the desktop Chromium project against a freshly prepared local release site.

On Windows, only disposable SQL copies are normalized to committed LF line endings. The production permission boundary, historical migrations, deployment workflows, and baseline helpers are unchanged. The last known good production commit before Phase 3 is `266a079f79a86b5c0a407b1edf807e241044fe30`; a failed publication must restore that application state before escalation. This phase introduces no production schema changes to reverse.
