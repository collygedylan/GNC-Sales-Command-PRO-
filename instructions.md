# Engineering Guidance

AGENTS.md is the authoritative workflow for local development, candidate delivery, monitoring, autonomous CI remediation, file hygiene, and the development-to-production flow. Follow its existing rules after every candidate push.

## Development

Implement complete, connected solutions and verify the affected behavior. Keep diffs focused and preserve unrelated changes. Prioritize offline synchronization and UI hydration stability.

Check the impact of schema changes on Row Level Security and client queries. The approval rules in AGENTS.md apply to CI failures involving migrations, credentials, or production data.

## Local Validation

- Run only targeted unit tests or specific test files directly related to the changed behavior, including focused migration checks when applicable. Leave full E2E suites, mobile/browser matrices, and exhaustive regression testing to GitHub Actions.
- Prefer fast local dev-server verification for UI changes. Do not rebuild full release artifacts or compile heavy production stylesheets just to run a local test; let cloud CI run tests that require those artifacts.
- A local production build is allowed only when strictly necessary to diagnose or verify a potentially build-breaking configuration change. Explain the need and use the smallest sufficient build, as required by AGENTS.md.
- For documentation-only changes, review document consistency and whitespace; application tests and builds are unnecessary.

Once core changes, applicable migration checks, and focused local tests pass, commit and push immediately. Every candidate must still pass all required GitHub Actions release gates. Use fail-fast cloud feedback to diagnose failures and make targeted corrections. Preserve test coverage and assertions; do not quarantine, skip, or bypass failing tests to publish a candidate. Follow the single CI failure counter and approval conditions in AGENTS.md.

## Release Metadata and Delivery

Keep release markers synchronized with package.json using the repository's release-version tooling when preparing an application release. Use the date-based VYYYY.MM.DD.NNN version scheme for application releases. CI-only and documentation-only changes retain the current application version and must pass its consistency check.

After pushing a candidate, create or reuse its PR and monitor with the fail-fast workflow in AGENTS.md. The Auto-Merge workflow relies on configured branch protections and required checks; the separate exact-commit publication gate must also pass, deploying backend changes before Pages. Do not patch production directly. See the Development-to-Production Flow in AGENTS.md.

## Cleanup

Follow AGENTS.md for task-scoped cleanup. Preserve unrelated work, shared resources, and diagnostics needed for unresolved failures. A pre-existing dirty worktree is not authorization to discard someone else's changes.
