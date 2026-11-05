---
name: test-agdata-it-caltech-release-and-sandbox-devops-chief
description: "Sandbox implementation. Publish cache-safe root and isolated Test artifacts with measured receipts."
---

# test-agdata-it-caltech-release-and-sandbox-devops-chief

Sandbox implementation. Publish cache-safe root and isolated Test artifacts with measured receipts.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Publish cache-safe root and isolated Test artifacts with measured receipts.

### Exact ownership
- test/assets/app-runtime.js: module contract.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: handleCustomerRepMappingAction.
- Code.gs: verifyAppsScriptActionEnvelope_, doPost.
- scripts/run-tooling-release-checks.mjs: runToolingReleaseChecks.
- scripts/release-disk-policy.mjs: releaseSiteDirectory, prepareReleaseSiteDirectory, localEvidenceDirectory.
- scripts/apply-item-low-stock-migration.mjs: agdataV2369EmergencyRecoveryMigrationName, agdataV2370WatchdogRequestRecoveryMigrationName, agdataV2375SuspendCardsFastBatchSyncMigrationName, agdataV2376InstantLoginFastSuspendMigrationName, agdataV2392JorgeAssignedLiveChangesMigrationName, agdataV23119AccessMatrixPublicationMigrationName, agdataV23119TypedPhotoPublicationMigrationName, agdataV23120OperationalSyncCompletionMigrationName, agdataV23121LiveErpLivenessMigrationName.
- scripts/apps-script-function-patch.mjs: mergeRequestDeliveryWakeDispatch, mergeMintDriveTokenDispatch.
- scripts/apps-script-recovery-evidence.mjs: createAppsScriptRecoveryEvidence, writeAppsScriptHeadOnlyEvidence.
- scripts/sync-all-version-surfaces.mjs: planVersionSync, assertVersionParity, synchronizeRelease.
- scripts/recover-or-publish-release.mjs: recoverVerifiedPublication, finalizeVerifiedRelease.
- scripts/prepare-release-site.mjs: module contract.
- sw.js: navigateClientToForcedUpgrade.
- test/sw-test.js: module contract.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: No independent SQL writes owned.
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- test install scope = /test/; root and test cache ownership do not overlap.
- retire old cache ⇒ complete successful installation; deployment target <60s requires measured evidence.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-it-caltech-release-and-sandbox-devops-chief, test-agdata-release-governor, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-it-caltech-release-and-sandbox-devops-chief.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
