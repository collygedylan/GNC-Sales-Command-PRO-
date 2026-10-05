# Repository Agent Workflow

This file is the authoritative repository workflow for candidate delivery, CI monitoring, remediation, and cleanup. Apply the sequence below in order. Supporting guidance in instructions.md must remain consistent with it.

## 1. Auto-PR

- Work on a candidate branch and preserve unrelated changes in shared workspaces.
- After pushing a new candidate branch, immediately create its pull request with `gh pr create --fill`. Reuse an existing open PR for that branch; subsequent repair pushes update the same PR.
- GitHub Actions owns validated merging, production publication, and hosted verification. Do not manually promote commits to main or bypass release gates.

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
