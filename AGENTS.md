# Repository Agent Workflow

This file is the authoritative repository workflow. The permanent CI/CD override below governs automatic merging, deployment monitoring, and completion reporting. The Fast Deployment & Execution Policy governs testing, replays, and hooks and supersedes conflicting guidance in supporting documents.

## Pipeline Architecture and Deployment Policy

1. Independent Deployments: GitHub Pages frontend publication and Supabase/Apps Script backend deployment are decoupled. Backend validation or deployment failures must not gate frontend publication.
2. Fast Standard PRs: Standard PR validation runs unit tests and lint/type checks only. Do not launch or wait for browser emulators, performance checks, release builds, or disposable database integration environments during standard PR delivery.
3. Nightly Validation: All browser checks, phone emulators, layout snapshots, timing checks, and performance benchmarks belong to Nightly Validation, scheduled daily at 09:17 UTC. Run its manual trigger only when explicitly requested. A job timeout is a safety limit, not an expected deployment duration.
4. Targeted Repairs: Do not fix unrelated legacy phone layout tests, layout snapshots, or missing historical fixtures during a targeted UI repair. Preserve their assertions and report unrelated failures separately.
5. LIVE Confirmation: A deployment is not fully live until the final GitHub Pages workflow succeeds and its hosted current-release descriptor and immutable fingerprint check pass for the published main commit. A push, passing PR, merge, or Pages branch publication alone is insufficient.

Pages builds and seals the merged main artifact, validates it without browsers, publishes the frontend, and verifies the hosted fingerprint. Standard PR checks emit no publication proof. Database integration validation runs in the independent backend workflow before production changes; browser and performance diagnostics remain nightly-only.

### Fast Deployment & Execution Policy

1. Targeted Local Verification Only: Run unit and lint/type checks strictly scoped to modified files. Never execute full repository-wide test suites, browser emulators, performance benchmarks, or disposable database integrations locally during standard delivery.
2. No Unprompted Historical Replays: Do not run historical database replays or migration replay fixtures unless a new SQL migration is explicitly introduced.
3. Strict Zero-Scope-Creep Rule: Do not halt execution to fix unrelated legacy tests or missing older fixtures.
4. Lightweight Pre-Commit Hooks: Pre-commit hooks must only run formatting/syntax checks against staged files. Never run sandbox assertions or full database validations inside pre-commit hooks.
5. Fast Hand-off to CI: Commit functional changes rapidly and push to the remote branch. GitHub Actions runs unit/lint PR checks, independent publication and backend validation, and scheduled nightly diagnostics. Continue automatically through merging and verified publication under the permanent CI/CD override below.

## Implementation and Delivery

- Map the direct consumers of changed schema, security rules, or core UI behavior before editing. Include necessary dependent changes in the feature commit; preserve unrelated work.
- Use an isolated `codex/` candidate branch targeting `main`. Keep application release markers synchronized with `package.json` using the release-version tooling.
- Run focused local unit/lint checks for the changed behavior, commit, and push immediately. Leave browser and performance suites to Nightly Validation and database integration checks to backend predeployment validation.
- Immediately create a new branch's PR with `gh pr create --fill`. Reuse an existing open PR for subsequent pushes to that branch.
- GitHub Actions owns complete validation, validated merging, production publication, and hosted verification. Automatically request the PR merge, enable auto-merge if required checks are pending, and continue watching publication. Do not run exact-commit candidate proofs manually or bypass release gates.
- After pushing and creating the PR, automatically monitor its checks, merge completion, and applicable frontend and backend publication workflows through final hosted verification. Do not stop at a PR hand-off or request another manual review.
- Report a production release as live only after successful final hosted publication is confirmed. A pushed branch or merged PR alone is not confirmation.

## Focused Remediation and File Hygiene

- When asked to diagnose CI, read the failed job's logs and repair only failures directly caused by the authorized changes. Preserve assertions; do not fix unrelated legacy tests or missing historical fixtures.
- Keep task changes committed and preserve unrelated changes, shared resources, credentials, production data, and diagnostics needed for unresolved failures.
- Remove only confirmed obsolete artifacts within the task's scope. Verify resolved paths before recursive cleanup; never broadly clean a shared workspace.

## PERMANENT OVERRIDE: Fully Automated CI/CD Deployment Protocol

Effective immediately, I am removing the requirement for manual Pull Request reviews and deployment hand-offs. Do not stop at the staging or PR phase.
From now on, you must adhere to this new deployment protocol:

1. **Auto-Merge Everything:** Once you have completed coding and local tests have passed, automatically create the PR and immediately merge it into the `main` branch.
2. **Monitor & Confirm:** Start your deployment watchers automatically. Monitor the GitHub Actions workflows until completion.
3. **Report Live Status:** Only report back to me when the frontend and backend publication processes are 100% complete and the changes are live in production.

This override applies to all current and future implementation chats working in this repository and supersedes conflicting review, merge, hand-off, and monitoring instructions above or in supporting documents.

Request the merge immediately; when GitHub requires checks or a merge queue, enable auto-merge and keep monitoring until the merge completes. Follow configured GitHub protections without adding a manual review requirement.

Continue through final Pages hosted release-descriptor and immutable fingerprint verification and every applicable backend publication. A backend workflow that confirms no backend changes are required satisfies that part of a documentation-only release. If an external blocker or failed workflow prevents completion, report the specific failure truthfully; do not describe a partial deployment as live.
