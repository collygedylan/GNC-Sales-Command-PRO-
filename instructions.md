# Engineering Guidance

AGENTS.md is the authoritative workflow for candidate delivery, monitoring, autonomous CI remediation, and file hygiene. Follow its sequence after every candidate push.

## Development

Implement complete, connected solutions and verify the affected behavior. Keep diffs focused and preserve unrelated changes. Prioritize offline synchronization and UI hydration stability.

Check the impact of schema changes on Row Level Security and client queries. The approval rules in AGENTS.md apply to CI failures involving migrations, credentials, or production data.

## Local Validation

- UI, CSS, layout, and text: run focused checks for the changed behavior and relevant desktop/mobile browsers.
- State, component logic, and API routes: run targeted unit and integration checks for affected modules.
- Database, security, service worker, offline synchronization, or cross-module changes: run the relevant integration and regression checks for affected boundaries.

These tiers guide local feedback; every candidate must still pass all required GitHub Actions release gates. Diagnose failures and repair their cause. Preserve test coverage and assertions; do not quarantine, skip, or bypass failing tests to publish a candidate. Follow the single CI failure counter and approval conditions in AGENTS.md.

## Release Metadata and Delivery

Keep release markers synchronized with package.json using the repository's release-version tooling when preparing an application release. Use the date-based VYYYY.MM.DD.NNN version scheme for application releases. CI-only and documentation-only changes retain the current application version and must pass its consistency check.

After pushing a candidate, create or reuse its PR and monitor with the fail-fast workflow in AGENTS.md. GitHub Actions performs validated merging, production publication, and hosted verification.

## Cleanup

Follow AGENTS.md for task-scoped cleanup. Preserve unrelated work, shared resources, and diagnostics needed for unresolved failures. A pre-existing dirty worktree is not authorization to discard someone else's changes.
