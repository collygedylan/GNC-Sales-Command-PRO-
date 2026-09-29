# Faster module loading and perennial ownership

Initial candidate: V2026.09.28.004. CI follow-ups: V2026.09.28.005 and V2026.09.28.006.

## Display and action readiness

The Managers landing menu has no inventory dependency. Each selected tab declares its own complete dataset cohort. Eval Reports #2 loads the threshold summary only when Low Stock is selected.

An authenticated, freshly authorized user may see a previously verified, complete cached cohort while revision checks run. Cache identity includes the user scope, canonical `dataPermissionVersion`, adapter contract and schema/cache key. A mismatch is a cache miss. The policy version is not a substitute for the permission fingerprint. The display says “Showing saved data · Checking for updates” and reports the saved verification time. Imports and temporary failures retain that labeled display.

Displaying cached records does not set dataset completeness flags, current revision proof, or mutation readiness. A failed refresh says “Showing saved data · Needs attention · Retry”; offline status remains explicit. Assignment changes, low-stock edits, report submissions/exports and inventory-dependent HL/PO controls require verified current data. Identity/permission changes invalidate protected display state. Cached optional datasets are explicitly allowlisted and size bounded; credentials, tokens and pending operation queues are not persisted by this change.

## Report work

The inventory/assignment/settings/threshold/date revision tuple owns one report index. Navigation epochs and local user filters do not rebuild it. Itemcode membership and physical-row lookups are prepared once, removing repeated full-inventory scans per card. Worker responses are checked against their originating identity and revisions; the fallback yields between bounded batches. When an open Low Stock report receives a new inventory signature, it refreshes the matching threshold summary before publishing refreshed records. Current-key failures require an explicit retry rather than an automatic request loop.

Apply acknowledges immediately and schedules a report-region update. Existing cards remain until replacement records are ready. The first small batch is rendered before subsequent batches; the full matching result remains available for selection and verified export. Background refresh preserves active drafts and display anchors. An open Reports picker retains its checked draft selections across an authorized screen render; it is discarded when the new authorized screen no longer contains that picker.

The runtime starts downloading earlier, but execution remains after initial paint. Timing diagnostics cover authentication/access, revision/download work, report indexing and rendering without recording customer rows or credentials. The supplied recording began after login, so it does not establish the cause of the earlier login gap.

## Ownership policy

Ownership is authoritative for normalized ItemCode + Genus, with itemcode leading zeros preserved. C.06/C.07 and D.04–D.09 qualify; D.10 requires a numeric three-digit bay from 000 through 021. Malformed locations are unresolved.

Any `135_roses` row exempts the whole pair. Otherwise any qualifying physical row assigns the pair to `zoe_green`, including pairs spanning other locations. A confirmed complete exit clears a previously automatic owner; an ordinary outside pair keeps its saved owner. Absent or unresolved evidence does not prove an exit. A later rose exemption restores the recorded prior owner if active, otherwise Unassigned with an audit reason.

The database stores override provenance and a private audit history. Active overrides reject conflicting manual writes in the existing assignment RPC. Current views use exact ItemCode + Genus; itemcode-only fallback is permitted only when unambiguous. Explicit Unassigned values remain authoritative over older owner fields on inventory or task rows. Existing frozen work snapshots and the separate historical Pikes repair workflow remain unchanged.

## Deployment and activation

The backend workflow produces a read-only impact preview before applying the additive migration. A non-ready snapshot or qualifying items without an active Zoe account stops deployment; the private preview is retained for diagnosis. The migration installs support without reallocating owners. The first successful canonical master import activates the policy inside fenced finalization, before ready revisions are published. Interrupted imports and scheduled runs before activation cannot infer departures. Manual assignment writes and reconciliation share a serialization lock. Repeated identical ownership does not create duplicate audit entries or notifications.

The archive backfill and low-stock activation safeguards are unchanged. Cloud PR checks, merging and production promotion remain mandatory. No release gate is bypassed.

## Validation evidence

The controlled compiled-app fixture contains 10,000 physical rows and 3,200 item groups. All 15 report/assignment regressions passed across Chromium, Firefox and WebKit. Apply acknowledged in 1 / 1 / 17 ms and published its first records in 121 / 194 / 377 ms respectively. Index construction took 321 / 420 / 720 ms. Unchanged local filters caused no inventory downloads or low-stock requests. All-item membership lookup fell from 2.3–3.3 seconds to 6–15 ms. These are local synthetic measurements, not production network latency claims.

A separate same-process comparison against the mainline engine measured median ownership-overlay-plus-classification time of 196 ms before and 209 ms after (6.5% higher). This checks the extra cooperative-processing overhead; it is not a measurement of complete cold login or network loading.

A final isolated Chromium comparison used three fresh sessions per build. HTTP-served release, source commit and runtime bytes were checked against the local candidate and exact-mainline artifacts before measurement. Median results:

| Measurement | Mainline | Candidate |
| --- | ---: | ---: |
| First contentful paint | 160 ms | 148 ms |
| Login fixture completion | 2,218 ms | 2,262 ms |
| Cold first card | 3,738 ms | 3,498 ms |
| Cold complete list plus proof | 10,691 ms | 10,968 ms |
| Revisit first card | 2,149 ms | 816 ms |
| Revisit complete list plus proof | 2,651 ms | 4,585 ms |

The fixture renders 1,581 Common Name cards. “Complete list plus proof” waits for every card and current-data proof; it does not isolate revision latency. Revisit first content improves 62%, while complete-list rendering is slower and remains a measured tradeoff. Cold complete-list loading increases 2.6%, within the 10% regression limit. Both builds make zero repeat inventory reads; the candidate uses three repeat requests versus four on mainline. Candidate revisit samples ranged from 785 to 3,173 ms using the browser-test navigation timer. Separate click-event-to-visible checks measured 786 ms for saved Drive data and 120 ms for the Managers menu. These measurements are local synthetic evidence, not a production latency guarantee.

The read-only production preview at inventory revision 4581 found 3,190 item/genus groups: 262 qualifying, 185 rose-exempt, 5 unresolved, and 2,738 outside. All 262 qualifying groups need automatic lock metadata; 20 need an assignee change. One active Zoe roster entry was confirmed. This preview did not modify production; the deployment workflow repeats it against the then-current snapshot before activation.

Browser regressions cover the supported engines, permission-isolated saved display, imports/failures, read-only actions, report index reuse, cooperative cancellation, and assignment controls at mobile/tablet/desktop widths in light, dark and outdoor themes. Database fixtures exercise boundary parsing, split locations, exceptions/restoration, exits/re-entry, missing/incomplete evidence, active-user checks, audit idempotence, import fencing and authenticated RPC enforcement.

The local release unit run passed 1,418 checks and the V2 suite passed 10 tests. The 18 mobile module smoke cases passed across 320px and iPhone, alongside five cache regressions and 27 Eval2 functional checks. All four iPhone Assigned Items cases passed locally with trace recording disabled and the existing 90-second limit unchanged. The long navigation case took 56 seconds; trace-enabled runs timed out on both the candidate and the unchanged mainline near the end of the same scenario. CI tracing and release checks remain unchanged. Assigned Items exports append the new reason column, preserving existing column positions. Final browser and SQL results are reported in the PR. Production deployment is not implied by a local test result.

For an isolated local migration check, install the optional PGlite 0.5.8 runtime under `.gnc-local/pglite` and run `node scripts/validate-perennial-zone-migration.mjs`. The harness executes the new migration with minimal prerequisite fixtures and tests ownership transitions, fencing and permission hashes. It never connects to production. The original lightweight assertion shim accepted an unsupported pgTAP function, so its 60 local assertions were not evidence of real pgTAP compatibility. The follow-up replaces those calls with documented `ok(... IS NULL)` assertions and adds an assertion-API guard. Docker and `psql` are unavailable locally; the complete Supabase migration chain and real pgTAP run in the database release check. The isolated checks do not replace that check.

## V2026.09.28.005 CI follow-up

The follow-up corrects the pgTAP API usage and expects scheduled reconciliation to defer before canonical-import activation. It also fixes saved-data warning text, a Low Stock target-key race after core snapshot publication, and background replacement of an open Reports picker. Threshold failures retain eligible cards with Retry and cannot create an automatic retry loop. The canary now verifies local user filtering without another assignment download; the Low Stock season fixture supplies the required aggregate summary before indexing.

Local verification passed 1,420 release unit checks, 10 V2 checks, inline-script parsing and isolated PGlite migration validation. Compiled-browser checks passed all eight canaries, six Low Stock season cases, twelve large-inventory/cache/ownership cases, three asynchronous-index cases, ten focused home-status/menu cases, and both traced Android/iPhone held-refresh cases. The latter force a real background render while the report picker is open and verify the same checked picker remains attached.

On the final compiled build, report Apply acknowledgement was 0.8 / 0 / 2 ms and first records appeared in 81 / 159 / 341 ms (Chromium / Firefox / WebKit). Cold indexing was 349 / 381 / 474 ms. Unchanged filters made no assignment downloads or unrelated low-stock reads. Managers menu checks measured 143 ms on Android and 115 ms on iPhone, retaining the 250 ms limit. CI tracing, suite timeouts, permissions, import activation and release gates are unchanged. Full real-pgTAP validation and production promotion remain cloud responsibilities.

## V2026.09.28.006 CI follow-up

PR #215 exposed four remaining causes. The single-transaction database fixture reused a completed import header for a later scheduled request. Its 61-assertion replacement explicitly checks rejection of that stale token and resets request headers and transaction touch state at the simulated boundaries. The local PGlite harness now loads the repository's source-touch trigger migration for the fence regression. It uses empty temporary transition relations because of its executor limitation; the full transition-table behavior and pgTAP suite remain cloud checks.

The Docks and verified-cache browser assertions now expect the saved-data Retry warning after a failed read. The saved-data loading regression also waits for the actual failure state instead of accepting the transient checking label. Syncing and importing keep their checking labels.

Managers renders its authorized, dataset-free dashboard in the navigation turn and defers responsive menu chrome. Data-dependent subviews keep the existing loading path. Three preliminary tablet WebKit runs measured 123, 106 and 111 ms. The .006 compiled matrix measured 105 ms on Android, 108 ms on iPhone, 108 ms on tablet WebKit and 95 ms on desktop, retaining the 250 ms limit.

The iPhone CI failure already displayed all 18 updated cards while refresh bookkeeping remained pending. A staged list shares its chunk token with ordinary records rendering: if the latter supersedes the staged completion callback, the pending counter can be stranded. Staged refreshes now track their destination containers and are canceled when an ordinary render takes ownership. A unit regression covers this cancellation and prevents late completion from modifying a newer refresh; compiled browser coverage exercises overlapping records rendering alongside the held-touch/scroll-anchor checks. CI tracing, timing limits and release gates remain unchanged.

The first .006 verification passed 1,422 release unit checks and all six traced Android/iPhone Eval2 refresh cases (verified refresh, held touch, overlapping records render). An additional tablet saved-Drive-data timing check measured 1,191 ms in the matrix and 1,150 ms alone against the existing 1,000 ms target. Instrumentation identified 866 ms waiting for navigation grace and only 4 ms rendering. The final build bypasses just that navigation grace for the first eligible saved preview in an empty loading screen. Active touch, scrolling, typing, drafts, saves and photo work retain their existing protections.

The final compiled home matrix passed all eight cases. Saved Drive first cards measured 203 / 242 / 441 / 92 ms and Managers menu first content measured 102 / 118 / 130 / 84 ms (Android / iPhone / tablet WebKit / desktop). The cases include saved-data visibility during imports and failures, Retry status, blocked unverified exports and logout. Local V2 tests passed 10/10 and the isolated database harness passed its real-fence request-boundary checks plus assignment scenarios. The complete PostgreSQL/pgTAP chain remains a required cloud check.

The final release unit run passed 1,423 checks. All four final traced held-touch cases passed on Android and iPhone, including an ordinary records render queued before staged completion. Docks recovery passed on Android and desktop; the local iPhone two-context run reached its unchanged 60-second timeout during import handling and produced a damaged trace archive. That local limitation is reported without changing the test timeout or cloud gate.

The duplicate verified-cache recovery scenario passed in Chromium, Firefox and Android. Its local WebKit two-context run also timed out; the full cloud browser matrix remains required rather than treating local coverage as complete.
