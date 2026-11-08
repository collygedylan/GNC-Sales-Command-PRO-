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
- Do not run desktop, Android, and WebKit hydration/timing release profiles in
  parallel on one host; isolate profiles so CPU contention cannot create false
  latency failures or exhaust a deliberately blocked fixture read into retry.
- Do not relax per-device timing or catalog assertions to absorb host jitter;
  allow at most one bounded fresh-context retry and preserve passing evidence.
- Do not run desktop engines before the strict WebKit mobile timing profile on
  a shared Windows release host; verify the sensitive profile on a clean host.
- Do not treat one superseded coordinator check or a complete progressive row
  preview as terminal hydration; rejoin within the existing bounded deadline
  until the current cycle reports `Published data`, then wait for and enforce
  the exact authenticated settings receipt (Invariant 559).
- Do not reserialize the symbol index during a version-only update; replace its
  validated release marker in place so canonical JSON remains byte-stable and
  the zero-monolith-growth ratchet remains intact (Invariant 562).

The complete 21-to-5 mapping, publication checklist, and external Gemini
retirement sequence is in docs/gemini-clean-gems-blueprint.md.
