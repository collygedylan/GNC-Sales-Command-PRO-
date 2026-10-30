---
name: agdata-release-governor
description: Deliver scoped AgData releases through fast daytime checks and ordered publication, while retaining full regression coverage in Nightly Validation.
---

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
