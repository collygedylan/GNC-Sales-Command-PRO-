# Repository Agent Workflow

This file is the authoritative repository workflow. The Fast Deployment & Execution Policy supersedes conflicting testing, replay, hook, monitoring, and execution guidance in supporting documents.

### Fast Deployment & Execution Policy

1. Targeted Local Verification Only: Run unit, integration, and lint/type checks strictly scoped to modified files. Never execute full repository-wide test suites locally.
2. No Unprompted Historical Replays: Do not run historical database replays or migration replay fixtures unless a new SQL migration is explicitly introduced.
3. Strict Zero-Scope-Creep Rule: Do not halt execution to fix unrelated legacy tests or missing older fixtures.
4. Lightweight Pre-Commit Hooks: Pre-commit hooks must only run formatting/syntax checks against staged files. Never run sandbox assertions or full database validations inside pre-commit hooks.
5. Fast Hand-off to CI: Commit functional changes rapidly and push to the remote branch; let GitHub Actions handle complete verification asynchronously.

## Implementation and Delivery

- Map the direct consumers of changed schema, security rules, or core UI behavior before editing. Include necessary dependent changes in the feature commit; preserve unrelated work.
- Use an isolated `codex/` candidate branch targeting `main`. Keep application release markers synchronized with `package.json` using the release-version tooling.
- Run focused local checks for the changed behavior, commit, and push immediately. Leave full browser matrices, regression suites, and exhaustive database validation to GitHub Actions.
- Immediately create a new branch's PR with `gh pr create --fill`. Reuse an existing open PR for subsequent pushes to that branch.
- GitHub Actions owns complete validation, validated merging, production publication, and hosted verification. Do not manually promote commits to `main`, run exact-commit candidate proofs manually, or bypass release gates.
- After pushing and creating the PR, hand off to cloud CI and report the PR and targeted verification. Do not start unprompted CI/deployment watchers or repeated verification loops. Monitor only when the user explicitly requests it for the current task.
- Report a production release as live only after successful final hosted publication is confirmed. A pushed branch or merged PR alone is not confirmation.

## Focused Remediation and File Hygiene

- When asked to diagnose CI, read the failed job's logs and repair only failures directly caused by the authorized changes. Preserve assertions; do not fix unrelated legacy tests or missing historical fixtures.
- Keep task changes committed and preserve unrelated changes, shared resources, credentials, production data, and diagnostics needed for unresolved failures.
- Remove only confirmed obsolete artifacts within the task's scope. Verify resolved paths before recursive cleanup; never broadly clean a shared workspace.
