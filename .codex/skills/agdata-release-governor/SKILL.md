---
name: agdata-release-governor
description: Deliver scoped AgData releases through fast daytime checks and ordered publication, while retaining full regression coverage in Nightly Validation.
---

## Authorized cleanup (2026-11-07)

Follow the standing resource-cleanup authorization and access boundaries in AGENTS.md. Preserve protected/current/open-PR/worktree branches and require exact merged-head evidence before deletion. Record mutation receipts and retain exceptions. Normal source/Pages hooks and one atomic live-root push remain mandatory; host permission gates cannot be overridden by repository instructions.


## v3.0.25 live update preservation

Enforce exact version.json parity for every local script/stylesheet query and the worker registration; generated .1/.2 query overrides are retired. Keep classic loading, source and generated snapshot/restore wiring, no-store version polling and updateViaCache:none. Source and Pages hooks must still finish below two seconds. Validate offline/timeouts, account/tab boundaries, storage failure, writes/camera, late edits and full restore with controlled fixtures; never certify a device or CDN without measurement. First activation from already-open pre-protocol releases requires their windows to close; no forced migration or Pages polling.

## Rule 0 - Autonomous Watchdog self-healing (standing user authorization, v3.0.10)

On EVERY future prompt, even when the user does not mention Watchdog, read `.gnc-local/latest-state.md` first and query `public.app_runtime_watchdog_events WHERE status = 'open'`. The user has given standing authorization to investigate and automatically fix genuine code/RPC anomalies reported by those incidents, apply the necessary scoped repair through existing authorized release paths, and resolve the verified incident IDs before committing. This supersedes earlier read-only-by-default restrictions on Codex remediation. Keep the browser sensor passive; it does not receive source-write, database-administration or deployment credentials.

Use the installed schema, with the user's requested column labels:

```sql
SELECT id, first_seen_at AS created_at, username, normalized_role AS role,
       view_id AS view_name, sub_module AS scope, event_type AS error_code,
       error_message AS message, owning_skill
FROM public.app_runtime_watchdog_events
WHERE status = 'open'
ORDER BY last_seen_at DESC
LIMIT 25;
SELECT count(*) AS open_watchdog_incidents
FROM public.app_runtime_watchdog_events WHERE status = 'open';
```

Investigate the recorded evidence and owning code/RPC, make the smallest real repair, and run the focused applicable check. Resolve only the exact verified incidents after the repair is installed or after evidence demonstrates the recorded anomaly is already fixed; retain a truthful resolution note and release reference. Never mass-resolve uninvestigated events, suppress telemetry to hide an unfixed failure, or claim WATCHDOG 0 without a fresh zero-count query. If access or a real external dependency prevents repair, retain the incident and report that concrete blocker rather than marking it fixed.

Before every commit, run `node scripts/fast-regression-lock.mjs`; `.git/hooks/pre-commit` must run the same mandatory lock. The target is under two seconds and must be measured, never assumed. Preserve real actor/role/session authorization, exact-row identity, durable receipts, the v3.0.9 recovered photos and publication/protection triggers, and deliberate photo deletion/expiry/depletion. The only mandatory business inputs remain positive Request/Reclass Quantity and non-admin/non-super-admin Reclass Explanation. Use last-write-wins and authenticated canonical PostgREST fallback for stale version/snapshot conflicts; never invent a successful save. Live root PWA only, `.nojekyll` on main and gh-pages, no retired mirror, no slow test suites and no Pages polling.

Cross-layer scope: Codex reads bounded incident metadata, repairs the owning runtime/Edge/SQL contract, verifies the real result, and resolves that incident cohort. Existing app permissions, RLS, private outbox grants, native-session mutation paths, shared navigation and user data remain authoritative.

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


# Release governor

Edge type checks resolve pinned npm imports through Deno's global cache (`--node-modules-dir=none --frozen`). The frontend npm installation may omit exact Edge-only versions; do not loosen the lockfile or skip an affected function to mask that mismatch.

## Owned files and core functions

- `scripts/release-scope.mjs`: `classifyReleasePaths`, `changedReleasePaths`, `selectReleaseRecoveryBase`; `scripts/release-baseline.mjs`: `findLastSuccessfulDeploymentBaseline`; `scripts/run-tooling-release-checks.mjs`: `runToolingReleaseChecks`.
- `.github/workflows/pages-static.yml`, `pr-validation.yml`, `publish-candidate.yml`, `release-validation.yml`, `nightly-validation.yml`; `.github/actions/prepare-native-release/action.yml`; `scripts/lib/apps-script-deployment-guard.mjs`: `authorizeAppsScriptDeployment`.
- Runtime boundaries are inputs to scope classification: `index.html`, `assets/*.js`, `supabase/functions/app-api/index.ts`, SQL migrations and `Code.gs`. This skill owns their release ordering and exact-commit checks, not their business functions. Use the domain owner in [Cluster 10](../../../docs/architecture/agdata-module-dependency-map.md#cluster-10-release-pipeline-scoped-tests-and-nightly-regression).
- Register each new production SQL migration in `scripts/apply-item-low-stock-migration.mjs` with its migration constant, `releaseDatabaseMigrations` allowlist entry and an `as installed` contract query; then add coverage to the runner registration checks so scoped publication can apply and verify it.

## Shared component dependencies

Universal workflow fixes remain universal at release review: unless the release prompt explicitly names a deliberate single-user contract, gates must reject baseline Request, Queue, navigation, or data-access behavior conditioned on one username or Sales Rep.

The built artifact must preserve the app shell's `switchView`, `syncGlobalHeaderChrome`, `goBackUniversal` and `updateGlobalBackButton` wiring; native compilation and cache restoration must not mix shell, styles or assets from different source identities. Preserve lifecycle/version fingerprints, source-specific build caching and shared navigation invariants from the app-shell skill. No release optimization may silently rewrite header/Back DOM or cached application data.

## Scoped Node verification

```sh
node --test tests/release-scope.test.mjs tests/main-release-registration.test.mjs tests/release-publish-candidate.test.mjs
```

Target under 10 seconds. The first two validate scope/orchestration; the third exercises trusted merge/dispatch identity and duplicate protection with mocked APIs. Use `node scripts/run-tooling-release-checks.mjs` for the registered tooling and skill contracts. No browser, container or live backend execution is implied.

Use the existing release tooling. Do not create version-numbered check-v23XX scripts, per-version retained-validation files, receipt-hash gates or `.gnc-local/assemble-*` scripts. Historical receipts are archives, not permission to claim new validation.

## Credit and context conservation

- Default to `low` reasoning for CSS, copy and configuration work, and `medium` for standard multi-file fixes; avoid `xhigh`.
- Never load whole monolithic source files (`index.html`, `assets/app-runtime.js`, `supabase/functions/app-api/index.ts` or `Code.gs`) into context. Use `rg -n` to find anchors and inspect slices of at most 120 lines; load only skill sections needed for the release.
- Batch independent tool calls in parallel where practical and target completion within 12 tool-call turns.

- Daytime feature/bug-fix validation uses only `npm run check:inline` plus `node scripts/prepare-release-site.mjs` (combined target under 5 seconds), `deno check` for changed `supabase/functions/**` (under 5 seconds), and focused Node tests for the touched feature (under 10 seconds). Run a targeted single-file SQL check only for a changed migration/RPC. Report measured times; preserve acceptance and authorization checks.
- Do not run `scripts/run-release-smoke.mjs`, Playwright/browser suites, Docker image builds, the full historical Node matrix, or full migration/database replays during daytime feature releases unless the user explicitly requests them. A failing or slow focused check does not authorize a broader suite.
- Full regression coverage belongs to `nightly-validation.yml`, scheduled for 8:30 PM America/Chicago or explicitly dispatched with `full_regression: true`. Retain the four-shard Node suite, full backend/SQL/import matrix and browser/performance coverage there.
- When browser validation is authorized, use the permanent `scripts/run-release-smoke.mjs` harness with Desktop Chromium, Android Chromium and iPhone WebKit concurrently, sequential cases within each profile and zero retries. Retain the inclusive 2,000 ms render ceiling, zero console/page errors, single-line metrics, no overflow, complete fixture data and no production writes/email assertions.
- Use pre-seeded fixture authentication through addInitScript and a complete 9,487-row reference snapshot indexed once per worker. Target under 5 ms to serve an indexed page; measure setup separately. Production completeness is based on the published snapshot, never a fixed distinct-name threshold.
- Keep an explicit method/path/action allowlist for startup and background fixture reads. Browser-aborted read-only requests and telemetry cancellation do not require hardcoded body contracts; unknown routes and unmocked mutations remain rejected. Generic empty-success stubs must not hide missing data contracts. Synthetic sessions do not verify real production authentication.
- Authorized destructive SQL/trigger checks use disposable local databases or rolled-back transactions. Use Docker Desktop with cached dependencies when container validation is explicitly requested; do not start a full replay to prepare a daytime targeted check. Paid Build Cloud/Testcontainers Cloud execution is CI-only and disabled until separately configured with quota controls.
- Selected checks must actually execute and succeed. Preserve commit and built-artifact identity, current-main checks and authorization; remove cross-OS log/source receipt requirements, not artifact integrity.
- Frontend-only releases do not wait for backend work. Mixed releases publish changed SQL migrations, Edge Functions, Code.gs, then Pages. Manual and automatic releases use the same selection and ordering rules, with duplicate-publication protection.

Standard main pushes use only the fast inline/static gate, changed-Edge type check, and `scripts/run-tooling-release-checks.mjs` (under 15 seconds). Target a gate under 45 seconds, scoped publication under 60 seconds and total GitHub Actions delivery under 2 minutes. Tooling-only releases make zero runtime changes and must not redeploy older application changes solely because a publication baseline differs.

Pushes to `staging` run the same fast inline/tooling validation and prepare one staging site artifact. This path has read-only repository permissions and performs no production deployment, backend or Apps Script work, secret-backed health checks, browser tests, email delivery, Docker build, or full regression matrix. Keep production promotion on the existing exact-commit fast-forward path from `main`; a passing staging artifact is not a production release authorization.

Stop unrelated work after required checks pass. Keep compact pass summaries and detailed failure evidence; diagnose and rerun only affected checks. Halt after eight consecutive failed corrections of the same issue, retaining evidence. Restore last-known-good publication after a confirmed regression without discarding completed imports or user work.

Explicit task-specific validation overrides take precedence: a tooling-only task may require only focused Node/config checks and reuse historical browser evidence. Label that evidence historical and never claim a new browser/container pass.

The permanent published-snapshot smoke also covers cached-row Reclass during interrupted imports and stale permission refresh: Desktop uses Dylan, Android uses Megan, and iPhone uses JD. It holds exact item hydration until quantities, Hold and notes are drafted, verifies late hydration preserves those drafts, and submits through explicitly intercepted atomic move/live-field responses. Keep the report state labeled queued; these synthetic fixtures perform no production writes or real email delivery.

Register suspend_existing_review_v1 in the scoped migration runner and verify its installed atomic command contract before Edge, Apps Script and frontend publication.

Register suspend_candidates_request_preload_v1 in the scoped migration runner; SQL and app-api precede the scoped buildSuspendTagApprovalEmail_ Apps Script patch, then Pages. Preserve the paused historical schedules.

Register `agdata_v2395_instant_reclass_and_navigation` in the release migration allowlist and installed-state query. Its SQL verifies the already-committed three-row Reclass state and version marker without replaying the move; publication remains SQL, app-api, then Pages, with no Apps Script patch.

## Request completion and foreground continuity

Register request_work_sync_status_v1 in the scoped migration runner. Publish SQL and app-api before the allowlisted Apps Script function/constant patch, then Pages. Apps Script patching supports only the named MANUAL_SYNC_STAGE_ORDER_DEFAULT and IMPORT_HISTORY_CHUNK_SIZE_ constants plus registered helper additions, retaining protected-source comparison and Head/active-version guards.

Changes limited to _shared/database.types.ts do not expand changed Edge publication to every function: this file contains erased TypeScript declarations. App-api remains selected by its actual implementation change; generated runtime contract changes travel with the affected function.

## Owned Files, Canonical Functions & SQL Contracts

- `scripts/run-tooling-release-checks.mjs`: `toolingReleaseCheckFiles`, `runToolingReleaseChecks`; `tests/golden-invariants.test.mjs`; `tests/code-health-governance.test.mjs`; release workflows and scoped deployment registration.
- The release gate treats `docs/architecture/agdata-symbol-index.json`, all 12 skill manifests, and `AGENTS.md` as governed release inputs. App-api publication always uses `--no-verify-jwt`.

## Cross-Layer Blast Radius

- A full-stack release orders validated SQL, app-api, allowed `Code.gs`, then Pages. Version changes must stay synchronized across the 12 tracked version files and the watchdog/symbol index must report the same release.
- The v2.3.55 task override forbids Deno and browser execution; its explicit focused Node command, inline check, site preparation, tooling gate, and diff check are the complete authorized local gate.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- v3.0.10: Never skip the standing Rule 0 incident query on a future prompt, mark an unverified anomaly resolved, claim an unmeasured fast-lock timing, bypass the mandatory commit hook, or weaken the v3.0.9 photo/lifecycle shield while removing artificial input gates.

- Never accept a blank Reclass Explanation from a non-exempt account or drop it between UI, SQL history, outbox and report rendering. Reclass Explanation is always visible and mandatory per staged/submitted row for every non-admin role. Only normalized admin/super-admin roles and canonical dylan_collyge are exempt; show Optional for Admin for them. Keep per-row drafts and confirmation text, validate the authoritative saved profile on the server, and persist exact-row explanations in ph_reclass_history and durable outbox email/PDF reports.

- v2.3.197: Live root PWA only; the retired mirror and project sandbox preview must never be rebuilt or published. Inventory and queue cards never render an approved Bunch Note banner. resolveLiveInventoryForCard owns display hydration: normalized item/location/lot, then active same-item/location fallback; quantities come from master inventory, never SOC order Qty. Open Stock is numeric item-wide F1/S1 Available; Hold/Reason and evidence come from the selected live row and same-account location notes. Duplicate item/location/lot display rows merge evidence while physical UIDs remain available to exact mutation resolvers. Friday Plan Start is Grey (#64748B). Preserve physical tag identity, authorization, receipt-gated saves, Back/navigation, READY/LKG reads, and delivery workers. Cross-layer blast radius: frontend display and static publication only; Code.gs, SQL/RPCs and app-api unchanged; no new startup read.
- v2.3.191: For the explicitly authorized v2.3.191 release, deploy scoped SQL and app-api with --no-verify-jwt before frontend; validate focused behavior, individual node --check and changed-Edge deno check. Do not invoke recovery/tooling scripts or Computer Use; keep raw evidence on G:.

- v2.3.164, Invariant 458. AV has one Filters disclosure beside Season, a second row for Reset, Export Excel and Kiosk Mode, and a single scrolling chip line. Both open-stock and reserve cards open photos from the 84px thumbnail. Keep completion, Reclass, View Photos and evaluation owner controls off AV cards for every role.

- v2.3.164, Invariant 457. For an explicitly requested 90-second frontend release, check each changed JavaScript file with node --check, synchronize the named version, and push main and gh-pages directly. Verify the remote Pages commit and version.json once. Keep the requested Edge pin and omit suites, Actions waits and CDN polling. A regular Que Request opens Item Detail directly. Show its whole field grid inline in #ffffff or #ecfdf5, weight 700, on dark emerald. Keep LEFT and RIGHT with their own 84px photo. MARK DONE asks only “Mark <Item> done?”, publishes linked evidence through the authorized save, and advances after an exact completed-history receipt. Preserve unlinked folder completion and separate Suspend and NCR commands.

- Updating release assertions without both app-api APP_RUNTIME_VERSION and APP_RUNTIME_RELEASE caused CI-only version failures. Invariant 342 derives the expected values from package.json and keeps the Edge constants synchronized before publication.
- v2.3.130: Never leave transformed photo URLs in cache keys, poll closed/hidden background UI, persist routine watchdog diagnostics, or emit success Edge logs. Keep signed cloud relays independent of the browser, protect referenced receipts and private grants, and verify empty CLI receipts against installed contracts (Invariants 323–326).

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.

- v2.3.118: Never terminate the measured ~46-second tooling suite at 45 seconds. Keep the bounded per-suite wrapper at 75 seconds, preserve its failure/skip checks, and report measured durations.

- v2.3.115: Never use parse-only checks as proof of identifier scope. Audit changed runtime functions and every masterUid asset reference before commit, alongside changed Edge type checks (Invariant 218).
- Never place comments before a release migration’s opening BEGIN; the canonical migrationBody parser requires BEGIN as the first statement. Preserve its transaction guard (Invariant 194).

- Never fail a release solely on cold-cache bulk download seconds or navigation-cancelled background reads. The explicit v2.3.107 release uses one tooling-gate invocation, no Deno, linked-CLI SQL, and one bounded live DOM check; correct harness faults without permission pauses. Preserve behavioral/security assertions.

- Never register a release migration name without adding its installed-state query to `migrationContractQuery`; the cloud runner must validate the exact live behavior after history verification.

- Never set the Pages fast-gate timeout so tightly that successful validation is killed during mandatory action cleanup; retain a bounded cleanup margin while measuring the real gate duration.

- Never publish a `Code.gs` change unless every changed entrypoint and authorization dependency is registered in `appsScriptPatchFunctions` and exercised by the scoped remote-preservation test.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never skip the golden invariant file, weaken its active count, add `.skip`/`.todo`, deploy app-api without `--no-verify-jwt`, run unrequested browser/Docker/Deno checks, or replay unchanged backend work.
- Never create versioned throwaway validators, amend/force-push, claim unmeasured evidence, or continue refactoring after the required gate passes.
- Never add a runtime release-descriptor fetch path without emitting that exact path in the prepared Pages artifact and covering it in the focused release contract.
- Never approve a supposedly universal workflow fix that tests only one account, one Sales Rep display format, or one role while equivalent active identities remain gated.

## v2.3.103 single-publication release contract

An explicit single-push release preserves completed mapping changes, prepares all source and SQL work first, applies validated migrations and app-api before one main push, and publishes one version. Explicit bounded live validation replaces broad rep loops: at most two screens, under 45 seconds, with browser.close in finally and process.exit after a recorded result. Long cloud imports continue independently of the browser; audit their durable completion without extending the browser loop. Never claim timing targets or empty folders from an unfinished job.

## Permanent Main-Thread Memory Budget and Automatic Handoff

- **95% memory reduction / zero-compaction stdout budget:** Maximum 8 stdout lines per command. Never dump verbose test, tooling, Supabase, SQL, or diff output into chat. Redirect output to a scratch log under G:\My Drive\GNC\AgData\Release Evidence\; print only exit status, elapsed seconds, and the last 5 log lines. Use git diff --stat and inspect targeted ranges of at most 35 lines. Aim to keep context use below 15%; do not claim this is measurable or guaranteed without telemetry.
- **Batched execution:** Maximum 5 shell commands per prompt; batch inspection into 1, edits into 1–2, required focused tooling into 1, and authorized deployment/push/smoke into 1. Use the main thread only. Never spawn Customer ui, Customer backend, or other worker sub-agents. Do not rerun passed suites or rebuild a completed release without a demonstrated blocker.
- **Automatic handoff:** Read .gnc-local/latest-state.md first at the beginning of each new chat. At the end of every completed release, write exactly 10 concise lines recording the live version, latest commit SHA, publication results, checks, limitations, and next action. This required local state file is an explicit exception to the retained-artifact location rule.
- **Thread-full alert:** If a thread exceeds 6 completed prompts or context compaction occurs once, append this exact line at the bottom of the final response:
  **⚠️ CHAT MEMORY NEAR LIMIT — TAP [NEW CHAT] BEFORE PASTING YOUR NEXT PROMPT (STATE SAVED TO .gnc-local/latest-state.md)**
- **Zero permission pauses / cold-cache loops:** Execute authorized work end-to-end without May I permission prompts. Never fail or retry live browser checks solely for cold-cache download seconds or cancelled background reads during navigation. Report unverified outcomes honestly; do not weaken functional or security assertions.


## Dark-emerald UI contract

Bloom project pickers and Reclass confirmations use centered, accessible in-app controls with the dark-emerald palette; preserve modal Back ownership, mapped identity and existing mutation boundaries.

- Never assume previously applied, uncommitted SQL is registered for the next release. Validate every selected migration path through selectReleaseMigrations before committing, including preserved work from an earlier chat; each needs an installed contract.

- Never place a leading comment before BEGIN in a migration consumed by the strict release runner. Exercise migrationBody and buildScopedMigrationApplySql against every selected source before publication, not only its registry name.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Deliver scoped AgData releases through fast daytime checks and ordered publication, while retaining full regression coverage in Nightly Validation.

### Exact ownership
- assets/app-runtime.js: module contract.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleCustomerRepMappingAction.
- Code.gs: verifyAppsScriptActionEnvelope_, doPost.
- scripts/run-tooling-release-checks.mjs: runToolingReleaseChecks.
- scripts/release-disk-policy.mjs: releaseSiteDirectory, prepareReleaseSiteDirectory, localEvidenceDirectory.
- scripts/apply-item-low-stock-migration.mjs: agdataV2369EmergencyRecoveryMigrationName, agdataV2370WatchdogRequestRecoveryMigrationName, agdataV2375SuspendCardsFastBatchSyncMigrationName, agdataV2376InstantLoginFastSuspendMigrationName, agdataV2392JorgeAssignedLiveChangesMigrationName, agdataV23119AccessMatrixPublicationMigrationName, agdataV23119TypedPhotoPublicationMigrationName, agdataV23120OperationalSyncCompletionMigrationName, agdataV23121LiveErpLivenessMigrationName.
- scripts/apps-script-function-patch.mjs: mergeRequestDeliveryWakeDispatch, mergeMintDriveTokenDispatch.
- scripts/apps-script-recovery-evidence.mjs: createAppsScriptRecoveryEvidence, writeAppsScriptHeadOnlyEvidence.
- scripts/sync-all-version-surfaces.mjs: planVersionSync, assertVersionParity, synchronizeRelease.
- scripts/recover-or-publish-release.mjs: recoverVerifiedPublication, finalizeVerifiedRelease.
- DOM: #cluster-10-release-pipeline-scoped-tests-and-nightly-regression
- PostgreSQL: ph_app_users, user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- v2.3.191: For the explicitly authorized v2.3.191 release, deploy scoped SQL and app-api with --no-verify-jwt before frontend; validate focused behavior, individual node --check and changed-Edge deno check. Do not invoke recovery/tooling scripts or Computer Use; keep raw evidence on G:.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-release-governor, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-release-governor.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- GATE-FIXTURES-2026-11-05: Legacy fixtures omitted new dependency and receipt fields and retained expectations superseded by current workflows; progress dialog width lost its bounded centering. Use current exact receipts and real helper dependencies; preserve no-photo unlock, no forced reload, Location column and five operational sources. Keep the progress dialog bounded and centered. Permanent assertion: tests/golden-invariants.test.mjs Invariant 480; scripts/enforce-all-14-gems-gate.mjs. Evidence: 2026-11-05 gate failure log and canonical source inspection..
- v2.3.191-five-regressions: Prepended shared controls duplicated native filters; boot/version recovery reloaded retained sessions; independent Request reads lost publication order; forced start reused same-actor jobs; sparse SOC reparsed every raw page and admitted trip-only/historical rows. Use native drawers, retain authenticated shells, publish Request snapshots in order, force a distinct manual job, scan newest Drive files and publish only after EOF; protect unfinished edited tags; use noon-local weekday colors. Permanent assertion: Golden Invariants 500–510 and rolled-back SQL fresh-job/source-eligibility proof.. Evidence: G:/My Drive/GNC/AgData/Release Evidence/release-191-workbook-summary.json; release-191-database.sql; release-191-soc-removed-backup.json.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->

## v2.3.194 Plan Start weekday law

Monday = Purple (#7C3AED), Tuesday = Red (#DC2626), Wednesday = Green (#16A34A), Thursday = Blue (#2563EB), Friday = Grey (#64748B). Parse calendar dates at local noon; apply the weekday to badges, card borders/top accents and Dock / Drop / Qty / Plan Start strips. Friday uses border #475569 and tint #F1F5F9; never reuse Wednesday green.

### Release reset anti-pattern
Never gate authoritative live-manifest or worker updates on a numerically greater version; compare normalized versions for inequality, retaining session/draft and complete-cache installation safeguards. Preserve existing live inventory card fallback, physical mutation UIDs, numeric Open Stock, hidden approved Bunch Note banners and Friday Grey. Cross-layer blast radius: frontend version checking only; Code.gs, SQL/RPCs and app-api remain unchanged.

## AgData v3.0.14 scoped UI release law

For a cross-device shell/photo repair, verify the owned source and generated live artifact: a bounded results scroller under persistent controls, collapsed inactive chrome, canonical full-inventory Valid Photos membership/count/export, and retained first-paint/current-view continuity. Use focused behavior checks and report their actual limits; static CSS or VM evidence does not claim physical iOS/Android/Desktop replay.

Keep frontend-only backend pins unchanged. Run the measured fast lock and ordinary mandatory commit hooks, preserve exact source/artifact identity, publish main and gh-pages once atomically when authorized, save latest-state, verify fresh WATCHDOG 0 and stop without Pages polling. Keep photo recovery/deletion/expiry protections and authenticated business mutations unchanged.

### Forbidden Anti-Patterns (Never Repeat)
- Never hardcode a recorded photo count or use an AV stock/season subset as the full-inventory denominator. Never claim cross-device rendering or native timing from a source-only check.
- Never add unrelated workflows, backend deployments or broad test runs to a scoped UI repair.

## Master deployment lock and architecture mandate

Never use git commit --no-verify, disable Husky, or override core.hooksPath to bypass validation. Audit the effective hook chain, including .husky/pre-commit when configured, and run the measured scripts/fast-regression-lock.mjs both directly and through ordinary source/Pages commits. Its active checks must reject PHOTO_REQUIRED action gates and APPROVED BUNCH NOTE: card banners, require root .nojekyll, and execute node --check. Fix failures in their owning code before publication.

Keep UI rendering a projection of state; fetch and mutation orchestration publish state and durable receipts before rendering. Route every evaluation/photo save in Drive, AV, Queue Suspend, Queue Request and Eval Work through publishRowEvaluationToMasterAndNotes. Its subordinate authenticated transports are implementation details, never alternate view entrypoints. Preserve SQL publication/protection triggers and exact account/row identity.

Prefer isolated pure ES6 modules and explicit imports when extracting changed logic; preserve existing entrypoint/build compatibility. Do not convert the whole classic shell or service worker during a surgical repair. A modular extraction must keep business filtering, canonical data truth, mutation receipts and navigation behavior unchanged.

### Forbidden Anti-Patterns (Never Repeat)

Never treat a quiet Watchdog database as evidence of working telemetry, count historical tests as a current run, replace last-write-wins receipt acceptance with stale readback, or purge offline caches before a verified complete replacement. Publish only the live root, once to main and gh-pages, without Pages polling.

## v3.0.24 canonical-engine consolidation

The mandatory fast lock uses lexical call ownership, not comments or a function-name substring, to verify unique canonical engines and their audited caller routes. Ban the three specified false-failure/banner strings throughout assets, require the existing syntax/nojekyll/version checks, and reject redundant Eval2 navigation. Keep source/artifact checks and deliberate-negative fixtures active under the measured two-second ceiling. Classic frontend script order remains unchanged.

### Forbidden Anti-Patterns (Never Repeat)

Never add a parallel owner, hide forbidden markup with CSS, weaken the mandatory lock to accept a bypass, or change database protections during this frontend consolidation.

## Mandatory engineering review gate

Read `.github/codex-review.md` and record evidence with `.github/pull_request_template.md`.
The mandatory fast lock also runs `scripts/anti-spaghetti-lock.mjs` against Git history and independently checks partially staged content. New and modified functions must stay within 60 physical lines and three nesting levels. AST and scope checks reject duplicate helpers, unused/dead code, database calls in UI handlers, image transformations, alternate Supabase projects and polling without lifecycle, single-flight and backoff guards. Inline HTML scripts and TypeScript are authoring surfaces too.
Retain native `node --check` for the large runtime; compile every other existing syntax target with V8 `SourceTextModule`, matching the package's module grammar without linking or executing application code. One worker owns the remaining syntax, canonical feature and forbidden-code checks, reads its own inputs and explicitly enables Node's VM module API. Keep asset geometry/version checks and the existing two-second ceiling. Use `tests/anti-spaghetti-lock.test.mjs` for actual negative cases and safe counterexamples. Static checks complement changed-line semantic review; they do not prove all scheduling or data-ownership behavior.

### Forbidden Anti-Patterns (Never Repeat)

Never check only the working tree when the index differs, grandfather a modified oversized function, normalize distinct callee/property names into false duplicate matches, or treat an unchanged legacy baseline as permission to introduce a new violation. Do not bypass hooks or reset baselines to make a guard pass.

Independent Git fixtures must isolate and restore the parent's CI event environment. A real workflow's before/base SHA does not belong to a newly initialized test repository; never weaken the production event-base comparison to accommodate a fixture.


## Migration transaction ownership lesson

The canonical migration publisher once rejected registered transactionless migration bodies before its own transaction and advisory lock could run. Accept such bodies only after rejecting embedded top-level transaction control; retain the publisher's single atomic transaction, lock and migration-history update. Existing explicitly wrapped sources remain supported. `tests/sql-transaction-control.test.mjs`, the migration runner tests and Golden invariant 534 cover transactionless sources, wrapped sources and unsafe control statements without executing production migrations.

- Never synchronize only shell labels while leaving root version.json behind. Its numeric version and release label are required source surfaces; preserve source/artifact parity and reject invalid versions (Invariant 537).
