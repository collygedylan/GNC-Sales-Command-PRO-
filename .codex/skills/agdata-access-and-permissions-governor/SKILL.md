---
name: agdata-access-and-permissions-governor
description: Govern server-authoritative Y/N capabilities, active identities and exact-row assignment boundaries.
---

# access and permissions governor

Read [the canonical module dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and symbol index before editing.

## Owned Files, Canonical Functions & SQL Contracts

- Runtime: assets/app-runtime.js and declaration-only assets/row-workflow-functions.js; access editor: assets/user-access-control.js. Canonical functions: resolveUserAccessMatrix, normalizeAccessUsername, saveAccessMatrix.
- Server: supabase/functions/_shared/user-access-matrix.ts, app-api user_access, public.user_access, public.save_user_access_matrix_v23119 and suspend_tag_private.publish_inventory_evidence_v23119. Reuse public.save_drive_evidence_v3; never grant direct evidence-table writes.

## Cross-Layer Blast Radius

Code.gs delivery, private access credentials and outbox contracts stay intact. SQL rechecks the active profile and exact row assignment; app-api verifies native sessions and command identity. Browser matrix data is display state, never mutation authority. Preserve same-account SWR/LKG rows, drafts, and durable Request submission. The new bounded authenticated GET /rest/v1/user_access uses only the sanitized relation and its exact fixture.

Shared switchView, goBackUniversal, updateGlobalBackButton, viewHistoryStack and header/search ownership remain canonical; never recreate global Back/navigation.

## Scoped Node verification

```sh
node --test tests/golden-invariants.test.mjs tests/role-access-parity.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.126: Never serialize independent owner-relay profile, active-account/cutoff and capability reads, or repeat the same request’s capability lookup. Start them only after native Auth verifies the user; bind the resulting proof to that exact profile ID and request. Retain both canonical capability and app_account_active_v1 checks, legacy behavior, password/lock rejection and native SQL mutation authorization. Invariants 281–282 enforce concurrency, proof isolation and revocation.

- v2.3.125: Never repeat native profile/account-cutoff reads within an Assigned Items relay after this same request verified them. Reuse only the server-verified three-part native bearer path, exclude legacy session headers, and retain fresh canonical capabilities plus native SQL authorization. Never cache this proof across requests. Invariant 278 covers reuse, denial and legacy isolation.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.
