# Engineering Guidance

`AGENTS.md` is the authoritative workflow for local development, candidate delivery, release monitoring, and file hygiene. Its permanent CI/CD override governs automatic merging and monitoring through verified publication; its Fast Deployment & Execution Policy governs scoped local checks and hooks.

## Development

- Implement the complete requested change, keep the diff focused, and preserve unrelated work.
- Before changing schema, RLS, or core UI behavior, map downstream dependencies such as migrations, generated contracts, database tests, and legacy fixtures. Update directly affected dependencies with the feature.
- Do not run historical database replays or migration replay fixtures unless the change introduces a new SQL migration.

## Local Validation

- Run only unit, integration, lint, and type checks scoped to modified files. Never run full repository suites locally.
- Pre-commit hooks check formatting or syntax only for staged files. They must not run tests, type checks, discovery audits, sandbox assertions, database checks, or database replays.
- Do not stop to repair unrelated legacy tests or missing historical fixtures.
- Leave full browser matrices and broad regression validation to GitHub Actions.
- For documentation-only changes, review document consistency and whitespace; application tests and builds are unnecessary.

## Release and Delivery

- Keep application release markers synchronized with `package.json` using the release-version tooling when preparing an application release. CI-only and documentation-only changes retain the current application version.
- Commit focused functional changes and push the candidate branch promptly so GitHub Actions can perform complete validation.
- Create or reuse the candidate pull request, request its merge immediately, and enable auto-merge when GitHub requires pending checks or a merge queue. Continue through configured release gates without another manual review or PR hand-off.
- Start deployment monitoring automatically and follow checks, merge completion, frontend hosted verification, and applicable backend publication until completion. Report live status only after those processes succeed; report specific blockers or failures truthfully.

## Cleanup

Preserve unrelated changes, shared resources, credentials, production data, and diagnostics needed for unresolved failures. Remove only confirmed obsolete artifacts within the task scope.
