# AgData code review remediation: v2.3.24–v2.3.26

## Scope and evidence

The comparison baseline is production v2.3.23, commit `fcaed82cabf569caeff249927115ed7fcd9426ab`. Stage 1 is commit `09a2a6e9`; Stage 2 is commit `28bbe362`. Stage 3 adds release governance and the executable code-health gate. Measurements use UTF-8 source with LF endings; line counts use `text.split('\n').length`, including the final empty line. The external review's 163,471-line figure is not the measured v2.3.23 baseline.

This report distinguishes source evidence, local executable checks, and production observations. Browser, device-render, full database replay, Docker, and exhaustive live role/mutation testing were excluded by the release request. Historical backfills and their 15-minute trigger must remain paused.

## Finding 1 — Public access, identity, and authorization

`app-api` now resolves every non-login request through a server-verified, unexpired session and active canonical access record. Client actor/role/isAdmin fields cannot grant authority. Existing operation-specific mutation permissions remain in force; confirmed revocation differs from temporary verification failure so same-account cached views survive an outage. The password-change path retains its explicit server proof and canonical reconciliation.

Login failures are keyed by HMAC digests, with limits of 10 per username and 40 per IP in 15 minutes. The rate-limit RPC is service-role-only; valid authenticated sessions do not traverse the login limiter. Apps Script `doPost` requires an authenticated signed envelope, validates its time window, and resolves the canonical actor. Existing purpose-specific signed delivery protocols remain supported.

| Live schema measure | Before release | Migration-enforced postcondition |
| --- | ---: | ---: |
| Public base tables with RLS | 142 / 142 | All public base tables |
| Relations with effective anonymous mutation grants, including column grants | 49 | 0 |
| Anonymous executable volatile routines | 32 | 0 |
| Anonymous executable volatile or security-definer routines | 33 | 0 |

The before counts came from read-only production catalog queries. The migrations preserve effective authenticated/service-role privileges before revoking PUBLIC/anon privileges; they do not rewrite business rows. The postcondition column describes executable migration assertions, not an unperformed live mutation test. Production results are recorded in the publication receipt below.

## Finding 2 — Monolithic source

| Source measure | v2.3.23 | v2.3.26 |
| --- | ---: | ---: |
| `index.html` lines | 176,825 | 2,811 |
| `index.html` UTF-8 bytes | 12,080,507 | 327,633 |
| Extracted stylesheet files | 0 | 15 |
| Extracted stylesheet aggregate lines / bytes | 0 / 0 | 6,988 / 585,321 |
| `assets/app-runtime.js` lines / bytes | Absent | 166,956 / 11,165,841 |
| `assets/runtime-watchdog-panel.js` lines / bytes | Absent | 148 / 8,575 |

The editable HTML shrank by **174,014 lines and 11,752,874 bytes**. Styles are `assets/app-shell-style-01.css` through `-15.css`, preserving original order and attributes. The main classic runtime remains intentionally large: extraction changes source ownership without claiming that moving code deletes it. The production builder retains critical styles and deferred after-paint runtime execution, then removes source-only copies from the published site. The service worker caches the compiled runtime and new panel module. Static contract readers reconstruct the composed source without changing their acceptance assertions.

## Finding 3 — Functions and shared state

Counts below use parse5 to collect inline JavaScript (excluding JSON/import maps), then Acorn on the baseline HTML and current composed HTML including the extracted runtime/panel. A declared slot means a direct program-level function declaration or variable declarator, not a claim about every property on `window`.

| AST measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| All function declarations, expressions, and arrows | 17,571 | 17,588 | +17 |
| Program-level function declarations | 8,907 | 8,901 | −6 |
| Program-level declared slots | 11,412 | 11,402 | −10 |
| Duplicate program-level function declarations | 0 | 0 | 0 |

Five unreferenced named functions were removed: `syncFixedFilterRails`, `clearLegacyOfflineState`, `forceMainAreaToTopImmediate`, `getRealtimeTablesForView`, and `getMasterAvOpenDesignatedCustomerValue`. An unused legacy cache constant and obsolete inline bootstrap were also removed. Two watchdog helpers and panel state now belong to a private controller, and a guarded factory was added. New cancellation/coalescing and fail-open callbacks explain the net increase in total function nodes; this release does not claim a net decrease in every function measure.

## Finding 4 — Operational failure visibility

**60 formerly silent handlers** now call the non-blocking watchdog: main runtime 33, application lifecycle 8, live sync coordinator 10, request submission 4, user access control 3, and queue completion 2. The new bounded `OPERATIONAL_FAILURE` event records operation and code rather than arbitrary error messages, row payloads, or tokens. Expected aborts are excluded and watchdog transport failures cannot recursively report themselves.

The existing path remains sensor → `app_runtime_watchdog_events` → grouped header badge/Manager incidents → deduplicated alert delivery to `dylan_collyge`. This release adds observations to that path; it does not send test emails or claim a measured production email-delivery latency. Telemetry cannot autonomously rewrite source or push commits.

## Finding 5 — Ownership and stale work

The [module dependency map](agdata-module-dependency-map.md) retains ten clusters and identifies canonical DOM, navigation, dataset, and sync owners. The watchdog badge and incident panel now share one pending incident read per account. View abort controllers, account identity, generation tokens, and mounted-host checks prevent old completions from publishing into a later view or another account. Account changes clear private brief/event caches; an old promise cannot clear a newer owner's inflight reference.

Focused lifecycle checks include concurrent incident reads and Dylan → Megan → JD account changes. A missing watchdog module or failing telemetry call falls back to an inert controller so observability cannot abort application startup. Existing distinct dataset/realtime owners and working compatibility wrappers remain because they are not duplicate work. No universal latency improvement is claimed without browser measurements.

## Finding 6 — Controlled promotion and anti-bloat guard

Staging pushes run the fast static/tooling preparation gate and produce a staging artifact. They do not deploy production. Production retains the existing exact-main authorization and ordered publication pipeline. This explicit human-reviewed release request authorizes the current changes and main promotion; production AI/watchdog sensors otherwise remain read-only.

The new code-health gate enforces **3,000 lines / 360,000 bytes** for `index.html`, detects duplicate function declarations in shared classic program scope, and synchronizes the ten architecture clusters, twelve registered AgData skills, and extracted source layout. Closure-local declarations are correctly independent. Synthetic cases prove both size and duplicate-declaration rejection. The historical static inventory is retained and supplemented with current source-layout metadata.

## Local verification ledger

| Checkpoint | Verified result | Measured command time |
| --- | --- | ---: |
| v2.3.24 requested focused Node files | Passed | 0.74 s |
| v2.3.24 inline / preparation / corrected Deno check | Passed | 0.83 / 9.48 / 8.08 s |
| v2.3.25 six requested Node files | 143 passed | 3.87 s |
| v2.3.25 inline / Deno / preparation | Passed | 0.89 / 5.51 / 8.02 s |
| v2.3.26 new code-health test | 5 passed | 1.079 s |
| v2.3.26 twelve requested Node files | 257/258 initially; corrected dispatch assertion, affected file 24/24 | 8.598 s + 7.058 s rerun |
| v2.3.26 inline / Deno / preparation | Passed | 1.018 / 5.893 / 8.243 s |
| v2.3.26 tooling / whitespace | 36 passed / passed | 3.169 / 0.325 s |
| v2.3.26 tooling after staging gate addition | 36 passed | 3.099 s |
| v2.3.26 lifecycle after optional-module startup guard | 15 passed | 1.28 s |

Stage 1's successful commands totaled 19.13 s; an initial Deno failure identified two type/null guards and took another 10.86 s before the targeted fix. Stage 2's successful command time totaled 18.29 s. Stage 3's first fully captured checkpoint took 27.246 s before its affected-file rerun, exceeding the requested 25 s target; all 258 focused cases have passing results after the correction. An earlier 8.093 s failed focused run could not print its Unicode output through the Windows console, so it was rerun with UTF-8 output. Timing is measured command wall time, not elapsed engineering time. No omitted suite is represented as passing.

## Publication receipt

The two validated SQL migrations were applied through Supabase on 2026-10-21 UTC, recorded as `20261021044338_zero_trust_rls_lockdown_v1` and `20261021044342_app_login_rate_limit_v1`. A subsequent live catalog query verified **142/142** public base tables with RLS, **0** anonymous mutation relations, and **0** anonymous executable volatile/security-definer routines. The rate-limit RPC is executable by `service_role`, not `anon` or `authenticated`. All three designated administrators remain active with all nine canonical override flags true. All **26** active mapped sales representatives retain N/A mappings, with **0** missing. No historical/backfill Supabase cron job is present.

Edge, Apps Script Head/active Web App, and Pages publication remain pending at this committed report's preparation. The final delivery receipt is the production workflow evidence and HTTP fingerprint for the final commit. The deployment uses an explicit empty SQL selection after the independently verified MCP application, preventing replay under a different migration timestamp. Historical Apps Script settings are outside this SQL observation; this release does not resume or alter them.
