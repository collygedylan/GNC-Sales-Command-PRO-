# Parallel release pipeline

This changes release orchestration, not the app shell, user permissions, inventory, or delivery rules. Faster publication must be demonstrated by measured runs; parallel jobs are not a promise of a particular release time.

## Working protocol before CI

Use one release owner and up to three independently scoped workers when the change warrants it: client/UI, protected server contract, and regression/review. Agree on request/response contracts and file ownership first. Do not have multiple workers edit the same file or let multiple workers publish. Small single-file fixes do not need a full team.

Reproduce the reported failure with a focused fixture while implementation proceeds. Integrate the workers' changes once, then run the targeted regression against the compiled shell before pushing. Preserve unrelated worktree changes and keep unrelated improvements out of an urgent repair. Database, client, and delivery changes still follow their required compatibility order.

Report implementation, validation, publication, and exact-live verification separately. A fast publish step does not make diagnosis or coding instantaneous. Record time spent in each phase so the next bottleneck can be measured rather than guessed. Any failed required check stops publication; fix the cause instead of bypassing it or repeatedly rerunning an unexplained failure.

## One build; isolated checks

The build lane installs the locked dependencies, builds pilot monitoring, live assets and v2, then runs `scripts/prepare-release-site.mjs`. That script preserves the former Pages static copy list, hidden files, compiled live shell, deployment fingerprints, HTML-size bound, and external-CDN guard.

`scripts/release-artifact.mjs seal` inventories every release file by relative path, byte count and SHA256. The manifest records the exact commit and shell release and excludes only its own hash. Hidden files are included; symbolic links, unsafe paths and resealing are rejected. The build exposes the manifest digest as a workflow output. Every artifact consumer uses that digest and the run's commit to verify the downloaded package. Missing, extra or changed files fail verification. Consumers never rebuild or reseal the package. The deployment consumes the same immutable artifact that passed the compiled checks.

Independent checks run in parallel:

- Four functional browser shards, with **one Playwright worker per runner**.
- Compiled-shell suites in a matrix with at most **six concurrent jobs**, also one worker per runner.
- The HL browser suite uses two complementary Playwright shards of the same configuration. Both are required; this preserves every project and test while retaining the 12-minute compiled-job timeout.
- A separate timing runner for scrolling, throttled startup, and Android login/photo saves.
- A separate database/functions runner for the composed migration, pgTAP/RLS, protected transactions, deliberate concurrency fixture, and Edge Function tests.
- A separate Lighthouse runner so browser contention does not corrupt performance thresholds.
- Unit, inline validation, and required read-only production health checks.

Different jobs have separate filesystems, browser state, server ports and test outputs. Do not start several existing Playwright configurations together on one runner: some use the same port or output directory. Keep database fixtures serial on their isolated stack because they intentionally share profiles and configuration. The concurrency fixture's competing calls remain intentional and are not reduced.

Functional and timing app navigation use `scripts/serve-release-tests.mjs`: `/`, ordinary assets, and the `/_site/` alias resolve only into the verified sealed artifact. The only checkout fallback is the scoped `tests/fixtures` directory; those fixture pages load their relative assets from the artifact. Missing compiled files never fall back to source files. Dedicated compiled-shell configurations also consume the same artifact. Synthetic component fixtures that explicitly inject source modules remain component tests, not full compiled-shell tests; both forms of coverage are retained.

## Gates and publication

All required lanes must succeed; a missing, cancelled, failed or unexpectedly skipped lane blocks publication. Matrix fail-fast is disabled so independent failures remain visible. No authorization, recipient, email, Request, AV Blanks, photo, data-integrity, database or performance check is waived to save time.

Main releases are serialized with cancellation disabled. Immediately before publishing, the workflow checks that its candidate is still the current main commit. Superseded candidates do not publish. Branch workflow dispatch runs validation without deployment, providing a safe benchmark path. A benchmark branch does not enable production health mutations or deploy to Pages.

After deployment, exact-live release and commit verification runs before parallel mutation-blocked production canaries. Post-deployment failure remains visible in hosted health. Publishing quickly is not equivalent to completing those checks.

## Local candidate preflight

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

A passing check prints the immutable candidate SHA, benchmark run/attempt, main base, and the normal fast-forward push command for a release owner to execute when authorized. It performs no main push. Worktree, branch, origin and remote refs are checked again before reporting success; the latest run is also reread after job inspection. This remains a point-in-time preflight, not an atomic lock on GitHub. Rerun it immediately before publishing, and integrate/rebenchmark if main or the candidate changes. Main's sealed Pages validation, current-main deployment guard, production health and exact-live canaries remain required.

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
