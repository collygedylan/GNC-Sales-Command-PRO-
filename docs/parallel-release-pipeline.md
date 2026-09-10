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
