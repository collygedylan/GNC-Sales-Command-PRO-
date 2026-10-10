# Parallel release pipeline

This changes release orchestration, not the app shell, user permissions, inventory, or delivery rules. Faster publication must be demonstrated by measured runs; parallel jobs are not a promise of a particular release time.

## Working protocol before CI

Follow `protected-releases.md` for environment isolation, the diagnostic report, incident checkpoints and recovery evidence. Pages now waits for a byte-compatible live Apps Script before publication; candidate validation never deploys it. Follow `model-routing.md` for bounded model selection. `prepare --dispatch` reuses exact-commit pending/green runs and prints a quiet `release-watch.mjs` command; it does not silently retry a failed candidate. Record phase timing and available shared-account usage with `ops:record` for the next three changes.

Use one implementation/release owner and one bounded independent reviewer. Keep the 30-minute active-repair checkpoint separate from automated check time. Stop when a failure repeats after a verified fix. Allow one complete candidate validation and at most one corrected candidate validation; preserve progress and identify the blocker when the limit is reached.

Reproduce the reported failure with a focused fixture while implementation proceeds. Integrate the workers' changes once, then run the targeted regression against the compiled shell before pushing. Preserve unrelated worktree changes and keep unrelated improvements out of an urgent repair. Database, client, and delivery changes still follow their required compatibility order.

Report implementation, validation, publication, and exact-live verification separately. A fast publish step does not make diagnosis or coding instantaneous. Record time spent in each phase so the next bottleneck can be measured rather than guessed. Any failed required check stops publication; fix the cause instead of bypassing it or repeatedly rerunning an unexplained failure.

An authorized implementation request proceeds through the normal release automatically after focused checks and the exact candidate gate pass. Planning, explanation, diagnosis, status, and review-only requests do not authorize a change or release. During validation, run the printed watcher as the single source of progress; do not feed unchanged job lists back through the model. The reviewer receives only the bounded diff, affected contracts, and completed test evidence.

## One build; isolated checks

Set `package.json` to the next unused `YYYY.MM.DD.NN` version (or a three-digit sequence when needed), then run `npm run release:version` before committing. This synchronizes the manifest, shell, service worker, compiler and lockfile to the matching `VYYYY.MM.DD.NN[N]` version. `npm run release:version -- --check` verifies the markers without writing. Read-only production health must be checked before lengthy candidate validation and immediately before publication.

The build lane installs the locked dependencies, builds pilot monitoring, live assets and v2, then runs `scripts/prepare-release-site.mjs`. That script preserves the former Pages static copy list, hidden files, compiled live shell, deployment fingerprints, HTML-size bound, and external-CDN guard.

`scripts/release-artifact.mjs seal` inventories every release file by relative path, byte count and SHA256. The manifest records the exact commit and shell release and excludes only its own hash. Hidden files are included; symbolic links, unsafe paths and resealing are rejected. The build exposes the manifest digest as a workflow output. Every artifact consumer uses that digest and the run's commit to verify the downloaded package. Missing, extra or changed files fail verification. Consumers never rebuild or reseal the package. The deployment consumes the same immutable artifact that passed the compiled checks.

Independent checks run in parallel:

- After the sealed build, a small mandatory foundation lane exercises deterministic shared lifecycle failures on Chromium and WebKit. Functional and compiled feature suites wait for it; database, timing and Lighthouse keep their isolated runners. The original artifact is reverified after foundation checks. Hosted foundation checks run with the focused post-deployment canaries. See `feature-foundation.md` for the shorter local loop and credit controls.

- Four functional browser shards, with **one Playwright worker per runner**.
- Compiled-shell suites in a matrix with at most **six concurrent jobs**, also one worker per runner.
- Home uses two complementary Playwright shards and HL Orders uses three, with their existing configurations. Every shard is required. Three HL shards keep the 96-case group from exhausting the 12-minute compiled-job timeout without removing tests or increasing timeouts.
- A separate timing runner for scrolling, throttled startup, and Android login/photo saves.
- A separate database/functions runner for the composed migration, pgTAP/RLS, protected transactions, deliberate concurrency fixture, and Edge Function tests.
- A separate Lighthouse runner so browser contention does not corrupt performance thresholds.
- Unit, inline validation, and required read-only production health checks.

Different jobs have separate filesystems, browser state, server ports and test outputs. Do not start several existing Playwright configurations together on one runner: some use the same port or output directory. Keep database fixtures serial on their isolated stack because they intentionally share profiles and configuration. The concurrency fixture's competing calls remain intentional and are not reduced.

Functional and timing app navigation use `scripts/serve-release-tests.mjs`: `/`, ordinary assets, and the `/_site/` alias resolve only into the verified sealed artifact. The only checkout fallback is the scoped `tests/fixtures` directory; those fixture pages load their relative assets from the artifact. Missing compiled files never fall back to source files. Dedicated compiled-shell configurations also consume the same artifact. Synthetic component fixtures that explicitly inject source modules remain component tests, not full compiled-shell tests; both forms of coverage are retained.

## Gates and publication

`publish-candidate.yml` handles successful PR runs of `performance-monitor.yml` using its trusted default-branch definition. GitHub suppresses push workflows from `GITHUB_TOKEN` merges, so this handler explicitly dispatches `apps-script-sync.yml` on `main`. It resolves the PR from its validated head commit (the workflow event's PR list can be empty after merge), rejects forks and changed heads, and confirms that the merge is still current main. If validation deferred an already-enabled auto-merge, it attempts that merge using the validated head SHA and GitHub's normal branch protection. A blocked merge fails the handler visibly; it never overrides outstanding reviews, checks, or merge-queue rules. Closed unmerged PRs and open PRs without auto-merge enabled are ignored. Queued, running, or successful backend handoffs for the same merge prevent duplicate dispatch. The handler never checks out PR code.

The backend guard reuses `selectPagesRelease` to prove that the sealed, successful PR build has exactly the current main tree. GitHub API errors fail closed. If no reusable PR proof exists, the existing exact-main manual proof remains available for recovery. The guard rechecks current main after proof lookup, and deployment retains the configured Apps Script project/deployment ownership checks. The additive low-stock migration runs before Apps Script publication. A bounded compatibility preflight skips version creation only when the configured live deployment has the identical Code.gs blob, preserving Apps Script's finite version capacity. Otherwise, successful backend deployment, health verification, and retained recovery evidence are required. The separate `publish-pages` job runs only after this backend lane succeeds. That job has no Google or database credentials, rechecks current main, and suppresses duplicate active/successful Pages runs. Pages independently verifies its sealed proof, compatible backend, production health, and current main before publication. No repeated full suite is required when the validated PR proof remains reusable.

The guard's GitHub REST reads allow at most three attempts for transient network failures, timeouts, HTTP 408/429/5xx, or malformed successful JSON responses. Each request and body read has a 12-second timeout; retries wait 200 ms and 500 ms. Authentication errors and other client errors fail immediately. Diagnostics record bounded response metadata without response bodies, tokens, or query strings. Job envelopes use 25-item pages because their nested step data can exceed GitHub's response deadline at 100 jobs. All pages remain required, with the existing 2,000-item ceiling, unique IDs, stable totals, and final current-main check. Neither transport recovery nor pagination accepts a partial proof.

For an already-merged release whose backend handoff failed or predates this handler, dispatch `apps-script-sync.yml` on `main` with `gh workflow run apps-script-sync.yml --ref main`. It deploys the required backend before dispatching Pages. If backend deployment already succeeded and only Pages failed, `gh workflow run pages-static.yml --ref main` retries the normal cloud validation and publication gates. If new branch rules delay merging beyond PR validation, complete those requirements before using either recovery path; enabling auto-merge alone is not confirmation of a merge or deployment.

All required lanes must succeed; a missing, cancelled, failed or unexpectedly skipped lane blocks publication. Matrix fail-fast is disabled so independent failures remain visible. No authorization, recipient, email, Request, AV Blanks, photo, data-integrity, database or performance check is waived to save time.

Main releases are serialized with cancellation disabled. Immediately before publishing, the workflow checks that its candidate is still the current main commit. Superseded candidates do not publish. Branch workflow dispatch runs validation without deployment, providing a safe benchmark path. A benchmark branch does not enable production health mutations or deploy to Pages.

PR validation runs the full reusable suite once. After every required lane passes, the release gate publishes `release-proof-COMMIT-ATTEMPT`, recording the repository, commit, version, run/attempt, site artifact ID and manifest digest. Pages uses `scripts/pages-release.mjs` to find the unique merged PR and its latest successful validation attempt, require the completed safety gate, and verify the proof/site artifact identities and expiry. GitHub's PR run API reports the branch head SHA, while the artifact was built at the synthetic PR merge SHA. The resolver binds both identities and compares the complete Git tree of that build with the final main merge tree. Approval alone never authorizes reuse.

When those trees match, Pages skips the repeated full suite and downloads that unchanged, sealed PR artifact. A direct push, changed merged tree, unavailable proof or artifact, or non-green latest PR run requires full validation on main instead. That fallback still binds its proof, digest, commit and attempt to the same Pages run. API failures fail closed. Both paths retain current production health and Apps Script compatibility checks; neither depends on a manual benchmark run.

Failed, pending, superseded, incomplete, expired, ambiguous or mismatched evidence cannot authorize publication. The full-validation fallback produces its own new proof. The selected proof is rechecked immediately before publication, and the full artifact manifest is verified after download. Pages never rebuilds or reseals a passing artifact.

The deployed fingerprint retains the original build commit. A separate `pages-publication-ATTEMPT` workflow artifact maps the main merge to that build, without changing any sealed site bytes. Exact-live checks use the build commit. Production health and Codex operations also resolve the publication identity, preventing false alarms caused by the different merge SHA. Older Pages runs without a descriptor retain their main-commit fingerprint behavior. After descriptor retention expires, independent Codex operations health checks require a confirmed Pages publication, the expected live release version, and a matching source tree from GitHub; this fallback cannot authorize a new deployment.

After deployment, exact-live release and commit verification runs before four parallel mutation-blocked live smoke suites: foundation, requests, session, and login/photo. All broader functional, compiled, database, unit, timing and Lighthouse coverage remains in full validation. Post-deployment failure remains visible in hosted health. Publishing quickly is not equivalent to completing those checks.

## Local candidate preflight

### Apps Script propagation recovery

The `.004` release exposed a stale second deployment read after the new version
and its exact source had already been verified. Recovery evidence now records
both deployment reads. A read below the pinned target retries the same immutable
version, commit and full source within the existing 13-attempt/90-second bound.
A read above the target fails immediately; an actual newer deployment must not
be overwritten or accepted as this release. Exhausted or invalid evidence still
blocks Pages publication. Retry the failed cloud handoff through GitHub Actions;
never publish the frontend around its backend verification gate.

The October 10 autonomous recovery retains the already-active temporary timing
profile in `performance/baseline.json`: doubled timing ceilings and a 100 ms
browser allowance floor. The stored 25 ms value is the strict restoration base,
not the active CI limit. Prompt 7 removes the temporary profile. Payload sizes,
render counts, duplicate reads, correctness and authorization checks stay active.

Run `npm run check:local` after preparing the release version and before sealing the commit. `prepare --dispatch` requires its passing source and compiled-artifact fingerprints, so failed or stale local evidence stops dispatch. The local check's one fresh build and selected regressions replace separate repeated foundation/feature runs; all candidate and hosted gates below remain required. Details: [local-validation.md](local-validation.md).

Use `scripts/release-candidate.mjs` from the candidate checkout before an authorized release. It does not fetch, commit, merge, push, deploy, or save an approval file. `prepare` and `check` are read-only. Start from a committed release branch that includes current `origin/main`:

```powershell
node scripts/release-candidate.mjs prepare
# If the branch is not published at this exact commit, prepare prints its SHA-pinned push command.
# After publishing the branch, explicitly request validation:
node scripts/release-candidate.mjs prepare --dispatch
# When the benchmark finishes:
node scripts/release-candidate.mjs check
# Optionally bind the check to a specific run; it must still be the latest exact-commit run:
node scripts/release-candidate.mjs check --run 123456789
```

The helper requires a named branch other than `main`, a clean index/worktree including untracked files and submodules, no assume-unchanged or skip-worktree index flags, and matching GitHub origin fetch/push destinations. Ignored build/dependency files are outside the clean-worktree check. It reads current remote refs with `git ls-remote`, requires local `origin/main` to match live main, and verifies that main is an ancestor of the candidate. A stale remote-tracking ref requires an explicit `git fetch origin` and a new preflight. A same-named remote tag is rejected so benchmark dispatch cannot select the wrong ref.

`--dispatch` is the only remote write: it requests `performance-monitor.yml` on the already-pushed branch at the checked HEAD. It never dispatches on main. GitHub resolves the branch during dispatch, so the helper rechecks refs immediately afterwards and treats dispatch as a request, not a successful validation. `check` separately requires the remote branch and the latest manual benchmark to match the exact local SHA, branch, repository, workflow ID and workflow path. PR merge runs, schedules, another branch's success, an older green run beneath a newer failed/pending run, and earlier rerun attempts do not satisfy the gate. It checks the current attempt's complete job list and the successful sealed release-gate step; only the intentionally skipped branch production-health job is exempt. Incomplete or ambiguous API responses fail closed.

A passing check prints the immutable candidate SHA, benchmark run/attempt, main base, and the normal fast-forward push command for a release owner to execute when authorized. It performs no main push. Worktree, branch, origin and remote refs are checked again before reporting success; the latest run is also reread after job inspection. This remains a point-in-time preflight, not an atomic lock on GitHub. Rerun it immediately before publishing, and integrate/rebenchmark if main or the candidate changes. Main's candidate-proof verification, sealed artifact verification, current-main deployment guard, production health and exact-live canaries remain required. Deploy compatible database/reporting dependencies before the frontend. Record the proof identity and exact-live results with the release report; reaching main alone is not completion.

## Measuring the result

Baseline Pages run **34424345738**, shell `.08`, took **24m 44s** from workflow creation to the successful deploy-pages step. The actual deployment step took **6s**. Full workflow completion was **37m 56s**, approximately **38 minutes**. This is a publication/CI baseline, not a claim about the entire coding and debugging task.

Use the read-only helper from the repository:

```powershell
node scripts/report-release-timings.mjs 34424345738 NEW_RUN_ID
node scripts/report-release-timings.mjs --json 34424345738 NEW_RUN_ID
```

The helper calls only `gh run view`. It reports time to the actual successful deployment step, the observed validation wall interval, post-deployment completion, full elapsed time, failed/skipped jobs and steps, and the sum of completed job minutes. It never reruns workflows, changes issues, deploys, or modifies production. Active runs show unfinished metrics as unavailable.

GitHub's run-view payload does not contain the dependency graph, so “validation critical path” is explicitly the observed interval from the earliest validation job start to the last completed validation boundary, including dependency and runner waits. Job minutes are summed compute durations, **not wall time or exact billing**. Parallelization can reduce elapsed time while increasing job minutes.

For the first rollout, dispatch `performance-monitor.yml` on the benchmark branch. It calls the same reusable validation workflow with production health disabled and does not trigger the legacy main-branch Pages-completion monitor. Compare completed validation intervals, per-lane failures and job minutes. Branch runs intentionally have no time-to-publication. Once this pipeline is on main, branch Pages dispatch is also safely gated from publication and production recovery. Compare publication and exact-live behavior after the first authorized main release. Keep all gates and fix fixture or resource failures instead of adding blanket retries or suppressing assertions. Record the actual results before claiming an improvement.
