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

- Keep Edge runtime imports inside `supabase/functions/`. A repository-root bundle can resolve a module that is absent from the isolated Supabase function runtime (Invariant 574).
- Preserve synthetic role and inventory prerequisites through the exact historical migration that consumes them. Reproduce historical one-off repairs only in disposable replay copies, verify their effects before fixture cleanup, and preserve installed predecessor checksums when a migration checks them (Invariant 578).
- Keep the full-size HTTP import test on the installed schema and enabled trigger set. Match photo-evidence lookup predicates to the existing index without changing null, location, or lot scope (Invariant 579).
- Pack generated database types in bounded parts through the canonical generator. Verify each part against a fresh introspection and derive runtime validators from the same lossless schema (Invariant 580).
- Recover pending Apps Script source from the verified backend publication baseline when a mixed release resumes through a backend repair (Invariant 576).
- Replay the Suspend approval and close command against the schema version those historical fixtures provide. Never select a later command by filename order alone (Invariant 577).
- Use the user's explicit season and year for AURA inventory scope. Keep provider-proposed season and year out of those filters (Invariant 575).
- Do not compare deployed Apps Script with the latest frontend commit or only
  the `Code.gs` blob. Compare the last change and all blobs in the deployment
  source closure: `Code.gs`, the photo receiver, and its builder.
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
- Do not carry a frontend-only app-api pin across staged or unstaged Supabase
  changes. Carry it forward only when both worktree and index prove the backend
  unchanged; a mixed release must synchronize through its ordinary backend
  scope and the fast hook must reject a stale frontend-only marker.
- A failed scoped Apps Script release must recover the captured deployment
  when its candidate is still active. Authorize rollback and re-read the owned
  deployment immediately before the write. Compare version, manifest, and
  description, verify the restored config, and preserve the original release
  error. Leave an externally changed deployment alone (Invariant 566).
- Never switch a scoped candidate before verifying captured HEAD restoration
  and reauthorizing the full deployment config. Recovery evidence is part of
  publication; its failure triggers the same rollback. After an ambiguous PUT,
  observe boundedly for the exact candidate and leave other config untouched.
  Select only the release manifest's explicitly allowlisted functions (Invariant 568).
- Never delete a photo still referenced by completed Request history merely because the active-master scan omitted that durable caller. Recover canonical five-folder copies from the existing hash/size-verified Drive file, expose the authorized full-resolution Drive fallback while retaining the original source URL and receipt, and keep future Request-photo deletion disabled until the reader path is live-verified (Invariant 569).
- Never equate matching Drive bytes with source identity, relabel an unmarked recovery source, compare completed-Request photos by literal URL alone, or send a cross-bucket Request leaf beneath its original archive root. Require independently verified portable metadata, canonical bucket/path identity with an ambiguity interlock, a separate retained primary receipt, and MIME-bound signatures (Invariant 571).
- Never replace historical Request folder search with the canonical archive path when publishing SQL ahead of Pages. Preserve the legacy search text and Folder fact within the same authorized reader and add canonical path matching alongside them (Invariant 572).
- Never analyze a byte-rebuilt minified bundle as first-party authoring or exempt it by filename alone. Route only the exact canonical output through its deterministic builder, reject any byte mismatch or unstaged input, and continue enforcing complexity on every authored source and unmatched asset (Invariant 573).

The complete 21-to-5 mapping, publication checklist, and external Gemini
retirement sequence is in docs/gemini-clean-gems-blueprint.md.

- Request photo archives accept only the signed, server-catalog five-part path under the approved Request root. Never trust client path/root input, retry into duplicate Drive objects, or treat a verified primary receipt as proof of every leaf. Normalize blank/N/A consignee to `Direct_or_NA`, keep original full-resolution links and first verified receipt identity, and verify each newly associated leaf before deleting its source (Invariant 565). Publish the generated Apps Script companion with its wrappers from the installed deployment base, and restore separately captured unpublished HEAD only after matching source digests.
