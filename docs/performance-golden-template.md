# Performance Golden Template

## Contract and scope

The live app retains its classic runtime and persistent route DOM. `/v2` is a
separate sandbox React application. Que means the top-level Request workspace.
Its beta rows are demo data; an unused request reader is not a performance win.

The reviewed comparison commit and fixture version live in
`performance/baseline.json`. Changing either requires an explicit reviewed diff
and an explanation of comparability. Never update a baseline automatically after
a failure. The candidate release gate requires the performance lane alongside
the existing SQL, Edge, browser, CSS and Lighthouse lanes.
Subsequent manifest changes require an approval from a human collaborator on the
current PR commit, checked by `check-performance-baseline-review.mjs`.

## Frontend standard

- Define React lazy components at module scope. Load route code on render; put
  loading/error states inside the existing content area. A failed chunk offers
  a reload because browsers cache failed module imports. Key error boundaries by
  route so an unrelated route remains usable. Mount the loading row as ordinary
  content, then reveal the lazy child in a React transition inside that boundary.
  This avoids the minimum display time of a newly committed Suspense fallback.
  The departed route still unmounts immediately, and superseded loads cannot
  remount it. Follow React's [revealed-content transition guidance](https://react.dev/reference/react/Suspense#preventing-already-revealed-content-from-hiding).
- State ownership is a behavior contract: Que filters/rows/selection remain in
  App; Drive aborts its request and resets local state when unmounted. Do not add
  keep-alive caching as a side effect of splitting code.
- Keep callbacks stable and memoize measured list boundaries. Scroll decoration
  belongs on the shell element, not in global React state. Tests must show that
  unrelated menu/toast/scroll updates do not rerender unchanged rows.
- In the live app, schedule background refresh reasons independently so each
  keeps its own typing and interaction deadline. Each callback resolves the
  current visible and dirty views when it runs, preserves dirty state for hidden
  views, and skips clean or stale render tokens. Preserve mutation invalidation,
  revision/identity checks, chunk cancellation and scroll.
- Service workers may download deferred static code for offline use without
  executing it. Preserve separate root, V2 and partner scopes and all private-data
  exclusions. Initial executable-code measurements block service workers; offline
  coverage verifies their separate precache path.

## Reader standard

Use generated Database types for fixed table/column/RPC contracts. Validate JSON
at the boundary and retain nulls, explicit field coverage and row identity.
Lists use their existing browse projection; details use their existing full-row
reader. A partial list must never masquerade as a complete detail snapshot.

Keep authorization and source predicates ahead of counts and pagination. Keep
stable ordering, page bounds, exact totals and duplicate/incomplete-page checks.
Do not infer a snapshot guarantee from a first-page total. This phase deliberately
does not remove later counts or introduce cursor pagination.

Use local `EXPLAIN (ANALYZE, BUFFERS)` before proposing an index. Record actual
rows, selectivity, buffer usage and write cost. A sequential scan can be correct;
never disable it to manufacture an index-use result. No production probes or
credentials are needed. Schema changes, when justified, use the existing additive
migration and SQL validation process.

## Repeatable measurements

`services/performanceBaseline.ts` validates manifests/reports and implements the
budget comparison. Every report identifies the commit, artifact digest, fixture
version, browser/runtime, viewport and measurement method. Missing/invalid samples
and mismatched contexts fail rather than producing a pass.

The cloud performance lane builds the pinned historical code in a separate
directory and verifies both sealed artifacts. It runs the same fixtures serially
on both. Phone (390×844), tablet (820×1180) and desktop (1440×900) each get five cold
contexts and ten warm visits per route/application. Report median and p95; do not
use a developer machine's one-shot timing as the release budget. Browser fixtures
contain 1,000 inventory rows and 200 live Queue rows, with external requests blocked.

Initial executable JavaScript is measured as decoded response bytes, excluding
worker precaching. Initial and deferred JavaScript sizes are reported separately;
the existing Lighthouse and compiled artifact size limits continue to govern code
size. The zero-growth payload budget applies to unchanged query results. Route metrics
include usable-content latency, long-task duration, content-node removals,
API reads and response bytes captured before the separate scroll-frame exercise.
Usable-content latency stops at the same first-visible-content boundary for both
artifacts. Live route attribution then waits, with a fixed timeout, for existing
dataset loads, queued renders and chunk work to finish and for API traffic to
settle. A short network-idle interval alone is insufficient because interaction
gates can defer work beyond it. The harness observes those queues; it does not
cancel timers, change app state or disable polling. Initial, route, between-route
and final partitions account for every API request exactly once, and full-context
read and byte totals remain subject to the original no-growth budgets.
The fixture also observes the coordinator's injected scheduler so its private
background and signal timers cannot evade the boundary. Original timer handles,
delays and callbacks are preserved. The identified recurring 30-second safeguard
is allowed to remain scheduled; any reads it starts are still counted. Render
queue entries require a live render token because the existing scheduler can
retain a cleared timer entry after an immediate replacement has completed.
Readiness also waits for pending touch-deferred startup tasks and role refreshes.
Before explicit login, it observes the existing shell callback scheduler as well.
Its two animation frames and delayed callback remain unchanged and count as
pending work until invocation. This closes the interval before a deferred Que
wake registers its data/render queues; API silence alone does not end that work.
The delayed login subscription task can otherwise overlap the first Que visit
and race its revision proof; it now finishes while Home remains active.
Before entering cold-login credentials, the fixture also waits for `document`
load completion, runtime boot readiness, and the app-session startup initializer
to finish its initial restore. The login trace must explicitly report the
expected no-session restore failure. A missing trace, an active restore, or a
successful/unexpected restore keeps the fixture blocked and eventually fails;
this prevents startup work from racing the measured Home and route requests.
Read counts include every API request started within the measurement window.
Payload bytes come from those same requests after bounded completion; later
background responses cannot enter the window. Deliberate browser cancellations
are recorded separately with zero completed payload, while unexpected HTTP,
network and body-capture failures invalidate the measurement.
React render isolation has separate deterministic mount tests because the normal
production React build does not enable profiling.
The isolated browser fixture seeds non-cryptographic randomness per profile,
application and cold-context number, identically for both revisions. The app's
existing sampled performance telemetry still runs and every emitted RPC is
counted; unseeded sampling otherwise changes strict read/byte totals even for
identical code. Each report records the seed, algorithm and number of random
calls. Native cryptographic identifiers, real clocks and timers remain unchanged.
Each cold context now owns a fresh Chromium process, while its warm revisits
remain in that same context. Matching baseline/candidate contexts run adjacently;
which revision runs first alternates by context number and viewport. The runner
retains all five cold and ten warm observations per revision, with no retries,
trimming, percentile changes or budget changes. Raw context reports and the
execution order accompany the aggregate report. This removes shared-browser
process state and reduces time-order bias; it does not establish that either
caused a prior failure or eliminate runner noise.

A shared callback that coalesced all live refresh reasons was tested and then
reverted after the unchanged retry reproduced request-read, DOM-removal and
timing regressions. That experiment is not part of the retained optimization;
the reason-specific scheduler described above remains the live behavior.

The request badge's legacy timer yields only when an initialized native
coordinator has a visible, online, permission-scoped `core:requests` adapter for
the active request table. Recheck ownership when a queued timer fires. This
prevents a redundant `request-check` signal from interrupting the coordinator's
background read; legacy and Bunch Notes-only contexts retain their existing
fallback. Coordinator revision proofs and explicit refresh signals still apply.

The beta lazy boundary schedules its existing transition in a layout effect so
chunk discovery does not wait for a passive effect. This schedules work before
paint; it does not promise the transition commits before paint. Route keys,
immediate unmount cleanup, loading content and chunk-error recovery are unchanged.
The paired cloud benchmark remains the evidence for any latency improvement.

Duration budgets permit the larger of 15% or 25 ms above baseline; database
duration uses 5 ms. Count, unchanged-render and equal-result payload budgets allow
no increase. Existing Lighthouse, frame-gap and cached-view limits remain active.
No claim of real-device or production database latency follows from synthetic data.

Database fixtures use 10,000 and 100,000 inventory rows, representative role
predicates and first/deep pages. The SQL gate first verifies that the active migration
paths and Git-clean contents match the pinned commit, the fixed app-api inventory
reader matches through its operation boundary (excluding only the old projector
implementation), and the beta API reader matches apart from its release-version
line. It then records 30 EXPLAIN samples for each identical page/count query as a
shared control, retaining result hashes, counts and raw plan evidence. Since this is
the same SQL on both sides, it makes no baseline-versus-candidate database speedup
claim and does not compare duplicated timing samples. Any change to these pinned
contracts requires a separately measured reader/schema baseline; it cannot be
accepted by this control run. The 15%/5ms comparator remains for genuinely distinct
SQL pairs. Row-copy measurements run only in SQL mode; authenticated local app-api
measurements are a separate output. Compare equivalent results and serialization
before claiming a payload or CPU improvement.
The canonical schema gate measures before its mandatory reset, while the CLI
workdir label is still independently verifiable by its child process. When the
GitHub-only `PERFORMANCE_API_BENCHMARK=true` opt-in is set, it runs the authenticated
API pair after the SQL control on that same full canonical schema, then resets,
lints, runs SQL assertions and compares generated types. The partial historical
regression fixture remains separate and does not run the master-inventory API
benchmark. The cloud API pair temporarily stages and serves the pinned and
candidate function sources against the same disposable stack, then restores any
source directories that existed before the comparison. The API comparison repeats
each revision three times in the fixed order baseline/candidate, candidate/baseline,
baseline/candidate. It pools all 45 samples per metric and retains each of the six
raw pass reports under `artifacts/performance/database-api-passes-*`. The p50/p95
budgets remain unchanged; at 45 samples, nearest-rank p95 is the 43rd observation,
so one slowest request does not determine the gate. All observations remain in the
reports, and response count/digest parity is checked in every pass. Alternating pass
order reduces broad time-order bias but does not eliminate machine noise or prove
the cause of a slow sample. The current schema-contract job has a 35-minute limit;
the six-pass comparison and complete schema gate passed in 22 minutes 32 seconds
in run `37794447351`, including generated-type validation.
Function-server startup failures report fixed diagnostic categories and process
status from at most the final 64 KiB of a private temporary log. Raw logs and
local credentials are never published; normal owned-workspace cleanup deletes
them. This does not retry or replace any benchmark observation.

The beta Drive SQL scenarios use its exact 18-column, 250-row reader on the
canonical inventory schema as a physical-read proxy. They do not claim sandbox
RLS or authentication measurements. Browser fixtures exercise its actual REST
boundary separately. No new index is included in this phase: preserve the query
plans and equivalent outputs rather than claiming a database speedup from an
unchanged SQL statement.

## Validation and review

Run focused Node/Vitest tests, lint, inline syntax, project TypeScript, applicable
Deno checks, focused Chromium/WebKit checks, and
`node scripts/database-check.mjs --all`. Keep hooks enabled. The latter uses only
verified disposable local resources and includes generated-type comparison.

GitHub Actions owns paired compiled-artifact measurements, full browser matrices,
merge, backend-before-PWA deployment and production verification. Inspect retained
`artifacts/performance` evidence on failure; repair the cause rather than loosening
budgets, skipping coverage or silently rebaselining. Preserve previous release
compatibility and the existing service-worker update/reload flow.
