# Engineering Guidance

`AGENTS.md` is the authoritative workflow for local development, candidate delivery, release monitoring, and file hygiene. Its Fast Deployment & Execution Policy applies to all work; this document summarizes the same rules for day-to-day changes.

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
- Create or reuse the candidate pull request according to `AGENTS.md`. Do not manually promote changes to `main` or bypass release gates.
- Monitor CI or production publication only when `AGENTS.md` or the user's current request calls for it. Report a production release as live only after final hosted publication succeeds.

## Cleanup

Preserve unrelated changes, shared resources, credentials, production data, and diagnostics needed for unresolved failures. Remove only confirmed obsolete artifacts within the task scope.
