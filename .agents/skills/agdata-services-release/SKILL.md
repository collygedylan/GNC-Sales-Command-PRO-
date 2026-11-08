---
name: agdata-services-release
description: Maintain AgData external services, Apps Script delivery, AURA, Watchdog, release tooling, migrations, CI, and atomic publication. Use for src/services, scripts, deployment health, or releases; do not absorb view or canonical-engine business logic.
---

# AgData Services Release

Own src/services and coordinated changes in scripts, Code.gs, Edge services,
delivery workers, Watchdog operations, and release automation.

## Service contracts

- Email enqueue, worker wake, lease/retry, Gmail/channel receipt, and frozen
  recipient snapshots are distinct states. Never report queued as delivered.
- Apps Script health compares the deployed Code.gs source fingerprint with the
  last Code.gs commit, preserving unpublished HEAD drift through the scoped
  merger. Login gateway deployments retain required no-verify-jwt behavior.
- AURA remains capability-bound and server-routed; draft proposals are not
  saved actions.
- Watchdog reads the fresh open incident set on every task, repairs only
  verified causes, and resolves only exact incident IDs after installed proof.

## Release contracts

- Order mixed publication as validated SQL, Edge, scoped Apps Script, then the
  live root Pages artifact. Keep main and gh-pages tied to one source identity.
- Run the measured fast regression lock before every commit and preserve the
  ordinary hook chain. Never force-push, amend, bypass hooks, or reset a
  baseline upward.
- Use the workspace _site in place. Keep evidence under the authorized Release
  Evidence directory and report only measured outcomes.
- New service modules stay below 400 lines; changed functions stay at or below
  60 lines with nesting no deeper than three.

## Verification

Choose focused Apps Script sync/fingerprint, delivery, AURA, Watchdog,
migration-runner, release-scope, and publication tests. A green static gate is
not live login, email delivery, database latency, or device evidence.

## Forbidden Anti-Patterns (Never Repeat)

- Do not compare a deployed Apps Script fingerprint with the latest frontend
  commit; compare deployed `Code.gs` with the last commit that changed it.
- Do not repair a deployment by publishing unrelated unpublished Apps Script
  HEAD changes. Patch the scoped deployed source, verify it, and restore HEAD.

The complete 21-to-5 mapping, publication checklist, and external Gemini
retirement sequence is in docs/gemini-clean-gems-blueprint.md.
