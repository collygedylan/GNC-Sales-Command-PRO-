---
name: agdata-zero-regression-mutation-engine
description: Preserve the canonical exact-row photo and evaluation mutation engine across operational views.
---

# zero regression mutation engine

Read [the canonical module dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and symbol index before editing.

## Owned Files, Canonical Functions & SQL Contracts

- Runtime: assets/app-runtime.js and declaration-only assets/row-workflow-functions.js; access editor: assets/user-access-control.js. Canonical functions: saveSecureDriveEvidence, applySuspendTagInventoryReceipt, publishFlyerInventoryEvidence.
- Server: supabase/functions/_shared/user-access-matrix.ts, app-api user_access, public.user_access, public.save_user_access_matrix_v23119 and suspend_tag_private.publish_inventory_evidence_v23119. Reuse public.save_drive_evidence_v3; never grant direct evidence-table writes.

## Cross-Layer Blast Radius

Code.gs delivery, private access credentials and outbox contracts stay intact. SQL rechecks the active profile and exact row assignment; app-api verifies native sessions and command identity. Browser matrix data is display state, never mutation authority. Preserve same-account SWR/LKG rows, drafts, and durable Request submission. The new bounded authenticated GET /rest/v1/user_access uses only the sanitized relation and its exact fixture.

Shared switchView, goBackUniversal, updateGlobalBackButton, viewHistoryStack and header/search ownership remain canonical; never recreate global Back/navigation.

## Scoped Node verification

```sh
node --test tests/golden-invariants.test.mjs tests/role-access-parity.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.121: Never infer completion from elapsed runtime or stale parsing progress while a leased worker is publishing. Only five current-run checked source checkpoints may complete the run; expired leases remain resumable through cloud plus same-account single-flight browser continuation. A confirmed exact-file commit paints Published immediately, including Processed-move retries; unchanged checks retain real last-published counts and names. SOC accepts 52,000-row files with bounded 1,500-row slices. Invariants 253–257 and Lock 6 preserve this contract; the v2.3.120 age-based completion rule is superseded. Shared Back/navigation, READY/LKG data and all mutation authorization remain intact.

- v2.3.120: Never append ORDER HISTORY or unrelated secondary folders to the five-source operational Run Script. Complete DRIVE/CAV/RESERVES/SOC/HL PO at 100%, release retired-history or 90-second stalled jobs without deleting cursors, and fold new SOC quantities into the canonical SQL statistics using latest daily group bags. Preserve immutable history, protected evidence, public access-matrix authorization, shared Back/navigation and service-only delivery. Invariants 250–252 and Lock 6 preserve the five-card modal and bounded mobile centering.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.
