# Repository Agent Workflow

This file is the authoritative repository workflow for local development, candidate delivery, CI monitoring, remediation, and cleanup. Apply the sequence below in order. Supporting guidance in instructions.md must remain consistent with it.

## Local Development and Early Delivery

- Run only targeted unit tests or specific test files directly related to the current changes locally. Leave the full E2E suite and mobile/browser matrices to GitHub Actions.
- Prefer fast local dev-server verification for affected UI behavior. Do not rebuild full release artifacts or compile heavy production stylesheets merely to support local tests; send tests that require those artifacts to cloud CI.
- Run a local production build only when strictly necessary to diagnose or verify a potentially build-breaking configuration change. Explain why the build is required and run the smallest build that can verify that change.
- Once core changes, applicable migration checks, and focused local tests pass, commit and push the candidate immediately, then follow the Auto-PR sequence below. Do not delay the PR for exhaustive local regression testing.
- Let the parallel GitHub Actions pipeline perform exhaustive regression and E2E validation. On a cloud failure, inspect the failed job and make targeted corrections using the Monitor and Fail Fast and Autonomous Remediation rules below.

## 1. Auto-PR

- Work on a candidate branch and preserve unrelated changes in shared workspaces.
- After pushing a new candidate branch, immediately create its pull request with `gh pr create --fill`. Reuse an existing open PR for that branch; subsequent repair pushes update the same PR.
- GitHub Actions owns validated merging, production publication, and hosted verification. Do not manually promote commits to main or bypass release gates.

## Development-to-Production Flow

- Target `main` from an isolated `codex/` branch. Run focused local checks; let the full required GitHub Actions validation run on the PR.
- The `publish-candidate` workflow is the only automatic merge path for same-repository `codex/` branches. It waits for the exact full `PWA and Supabase performance` validation run to succeed, then merges the validated head SHA and dispatches the backend-to-Pages handoff. Do not enable GitHub Auto-Merge before validation; branch protection may not defer it.
- Other branches still require an explicit GitHub Auto-Merge opt-in, and the validated publisher will honor that opt-in only after the same full successful-run and exact-head checks.
- Production publication is a separate mandatory cloud gate: it validates the exact candidate commit, deploys backend changes before Pages, and verifies the live release. Do not write directly to production or use an alternate publication path.
- The aborted staging-teardown experiment adds no staging detour or prerequisite to this production flow.

## 2. Monitor and Fail Fast

- Stay active and monitor the candidate with `gh pr checks <PR> --watch --fail-fast`. If checks have not registered yet, retry the watcher after a bounded delay; missing checks are not a pass.
- Maintain lockfile-keyed dependency and browser caches, parallel test execution, and `fail-fast: true` on test matrices. GitHub cancels sibling shards within the failed matrix; this does not imply cancellation of unrelated jobs.
- On the first failed check, stop the watcher immediately and report the failed check and available evidence. Inspect the completed job's logs directly without waiting for parallel jobs or the entire run to finish.
- Continue directly into the remediation sequence below. Stopping polling does not mean abandoning an authorized repair.
- Treat cancelled or missing required checks as incomplete validation. Report success only when the current candidate's required checks pass. Production checks remain owned by cloud workflows.

## 3. Autonomous Remediation

- Count the initial failed CI validation run as failure one. Autonomously diagnose and repair ordinary CI, browser, or unit-test failures, then push the repair to the same PR and restart monitoring.
- Allow at most two repair pushes after that initial failure. Pause for explicit user approval if the third consecutive validation run fails. Count each validation run once, even when multiple checks fail; sibling cancellations do not add failures. Reset the consecutive count after successful validation.
- Pause immediately for explicit user approval when a failure involves a database migration, security credential, or production-data risk.
- Preserve test coverage and assertions. Do not skip, quarantine, disable, or bypass tests or release gates to obtain a passing result.

## 4. File Hygiene

- Keep the branch, PR, and task artifacts synchronized and organized. Track temporary files created by the task and remove them when no longer needed.
- Remove confirmed obsolete or orphaned artifacts within the task's scope. Preserve unrelated work, shared resources, and diagnostics needed for unresolved failures.
- Before recursive cleanup, verify the resolved target is within the intended task directory. Do not use broad cleanup commands against a shared workspace or external integration.
- Finish with committed task changes and a clear report of validation, PR status, and any remaining failure evidence.
