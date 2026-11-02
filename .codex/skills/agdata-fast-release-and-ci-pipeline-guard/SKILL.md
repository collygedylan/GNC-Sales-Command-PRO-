---
name: agdata-fast-release-and-ci-pipeline-guard
description: Ship scoped AgData releases with bounded output and idempotent CI receipts.
---

# agdata-fast-release-and-ci-pipeline-guard

Read relevant skill sections and symbol-index entries without dumping monoliths. Use npx deno. Update all version surfaces and prepare the active _site before one tooling-gate invocation. Existing empty CLI migration receipts pass only after installed-contract verification; conflicting nonempty history fails. Never use gh run rerun --failed; rerun the full workflow. Keep main-thread work and compact logs in Release Evidence.

## Owned Files, Canonical Functions & SQL Contracts
Canonical release functions: planVersionSync, transformVersionSurface, applyVersionTransaction, assertVersionParity, synchronizeRelease in scripts/sync-all-version-surfaces.mjs; recoverVerifiedPublication and finalizeVerifiedRelease in scripts/recover-or-publish-release.mjs; shouldRecoverFrontend in scripts/release-scope.mjs. Existing quota functions retain their domain owners.

## Cross-Layer Blast Radius
Read [the dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and agdata-symbol-index.json. Runtime/SW quota controls, app-api origin/telemetry, SQL normalization/RLS/retention and CI receipts are scoped together. Code.gs imports/delivery, native auth, mutation grants and shared Back/navigation (goBackUniversal) retain their contracts. No new startup read is added.

## Focused verification
```sh
node --test tests/supabase-quota-security.test.mjs tests/release-automation.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- Never bump a hand-maintained subset of release markers or treat a green, skipped-deploy workflow as a live release. Invariants 343–345 require rollback, staged/artifact parity, actual live fingerprints and resumable finalization.
- Every release runs node scripts/sync-all-version-surfaces.mjs <version> before checks and the first commit. Run node scripts/recover-or-publish-release.mjs --detach after committing; it pushes an ahead-of-main HEAD once, resumes matching runs and dispatches frontend recovery without another source commit.
- Only demonstrated infrastructure failures permit bounded full workflow reruns; never bypass functional failures. CI also finalizes successful Pages runs and retains a 10-line state artifact; the local helper atomically materializes local state after verifying the database.
- Preserve historical migration/RPC identifiers, library versions, compatibility fixtures and the explicit package.json appsScriptRelease pin. The transaction verifies current release markers, not historical version prose.
- Never turn cache misses or telemetry into idle polling, expose protected tables through a blanket read policy, delete referenced receipts, or reject an empty CI-owned receipt without checking the installed contract. Invariants 323–326 and Locks 11–13 cover these seams.
