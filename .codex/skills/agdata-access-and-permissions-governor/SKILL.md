---
name: agdata-access-and-permissions-governor
description: Govern server-authoritative Y/N capabilities, active identities and exact-row assignment boundaries.
---

## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


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

- v2.3.188 / Invariant 488: Never choose an evaluator filter to force an approximate total. Include every active SUSPEND route: dc means dylan_collyge; ms and mk mean megan_kelly; other routes use their explicit username or Assigned Items owner, never an implicit Dylan fallback. Dylan/Megan and other owners default to self; JD defaults to All Users; authorized users retain cross-owner options with actual positive counts. The verified workbook has 24 active ms plus 3 mk rows for Megan, not a fabricated 24 combined. Missing untouched rows leave SOC/Docks on atomic sync; missing tags with saved evidence or replacement work remain until Complete Tag. Only an exact Complete Tag receipt or explicit completed flag creates a permanent closure; evaluation dates and shared business keys cannot close sibling tags. Preserve exact master evidence, session previews, immediate cards return, filename ordering and Watchdog.
- v2.3.139: Never interpret view_all_requests as a module view or infer pending visibility from edit permissions/role scope. Its top-level Y/N controls all pending rows versus canonical Assigned Items Effective Worker itemcodes plus the submitting actor; preserve the documented super-admin/Dylan/Nelly/JD fail-safe, aliases, explicit N for other users, immediate role/user cascades and rollback. Roster users awaiting password setup remain editable for this display capability without enabling their logins or other mutations. Invariants 371–372 enforce display scope and isolated saves. No production assignments or requests may be mutated by verification.
- v2.3.138 completion: Never use only active login profiles as the user roster, omit roster-only users, or equate display roles with login authorization. Sync roles both directions without changing explicit N flags, disabled state or credentials. Guard no-op profile UPDATE statements before execution: statement triggers run even for zero rows (Invariant 364).
- v2.3.130: Never leave transformed photo URLs in cache keys, poll closed/hidden background UI, persist routine watchdog diagnostics, or emit success Edge logs. Keep signed cloud relays independent of the browser, protect referenced receipts and private grants, and verify empty CLI receipts against installed contracts (Invariants 323–326).

- Never create a separate Sales Rep from a known person’s territory suffix or lose an explicit N while merging alias keys. Canonical options and SQL keys retain physical customer/consignee IDs (Invariant 306). Cache only Auth-verified identity for at most 60 seconds and JWT expiry; recheck live cutoff/capabilities, retain SQL authorization, and invalidate on access writes including concurrent cache fills (Invariant 307).

- Never issue a zero-row owner INSERT/UPDATE merely to confirm unchanged selections: statement triggers still invalidate datasets and contend with reads. Skip the write statement after canonical authorization and comparison, retain a durable command receipt, and return authoritative assignments (Invariant 301).

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never confuse changing a legacy role baseline with updating public.user_access. The explicit role mode atomically cascades one Y/N permission to all matching users through save_access_permission_v23127; user mode changes one user only. Keep revisions, request receipts, active administrator checks, account-fenced replies, optimistic rollback, sticky identities/headers and the synchronous Request rep picker. tests/access-permission-workspace.test.mjs covers this behavior.

- v2.3.126: Never serialize independent owner-relay profile, active-account/cutoff and capability reads, or repeat the same request’s capability lookup. Start them only after native Auth verifies the user; bind the resulting proof to that exact profile ID and request. Retain both canonical capability and app_account_active_v1 checks, legacy behavior, password/lock rejection and native SQL mutation authorization. Invariants 281–282 enforce concurrency, proof isolation and revocation.

- v2.3.125: Never repeat native profile/account-cutoff reads within an Assigned Items relay after this same request verified them. Reuse only the server-verified three-part native bearer path, exclude legacy session headers, and retain fresh canonical capabilities plus native SQL authorization. Never cache this proof across requests. Invariant 278 covers reuse, denial and legacy isolation.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Govern server-authoritative Y/N capabilities, active identities and exact-row assignment boundaries.

### Exact ownership
- assets/app-runtime.js: module contract.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: resolveZeroTrustRequestContext.
- Code.gs: module contract.
- assets/user-access-control.js: resolveUserAccessMatrix, canRequestSalesRep, canViewAllRequests.
- supabase/functions/_shared/app-auth.ts: readSupabaseOrAppSessionFromRequest, isAppAccountActive.
- supabase/functions/_shared/user-access-matrix.ts: mergeAccessRosterDirectory.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-access-and-permissions-governor, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-access-and-permissions-governor.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- SUSPEND-ALL-ROUTES-2026-11-05: A dc-only membership rule and blanket missing-row deletion hid other evaluators and discarded saved work; legacy evaluation dates were mistaken for permanent physical-tag completion. Never choose an evaluator filter to force an approximate total. Include every active SUSPEND route: dc means dylan_collyge; ms and mk mean megan_kelly; other routes use their explicit username or Assigned Items owner, never an implicit Dylan fallback. Dylan/Megan and other owners default to self; JD defaults to All Users; authorized users retain cross-owner options with actual positive counts. The verified workbook has 24 active ms plus 3 mk rows for Megan, not a fabricated 24 combined. Missing untouched rows leave SOC/Docks on atomic sync; missing tags with saved evidence or replacement work remain until Complete Tag. Only an exact Complete Tag receipt or explicit completed flag creates a permanent closure; evaluation dates and shared business keys cannot close sibling tags. Preserve exact master evidence, session previews, immediate cards return, filename ordering and Watchdog. Permanent assertion: tests/soc-suspend-routing.test.mjs; Invariant 488; rolled-back installed SQL ownership/retention/eligibility assertions.. Evidence: Verified revision 644 workbook: 88 active rows across all codes, including 24 ms and 3 mk. Existing five explicit completions remain closed..
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->

## v3.0.32 daylight and permission parity

This v3.0.32 contract supersedes earlier scrollable-toolbar, 138px mode-select, and AURA-before-Comm rules. Non-super-admin views require a verified user_access Y; authenticated inventory identity and role baselines cannot override N or missing flags. canAccessView owns Home, drawer and router decisions; switchView denies before touching navigation state. Quick-access picker and four custom footer slots reuse it. Slots 1/2/5/8 are Menu/Home/Comm/AURA, leaving unauthorized empty positions rather than shifting fixed controls. Home Bloom shares the version row; standby microphone belongs inside AURA. Outdoor Off/On/Auto persists locally and Auto follows local 07:00–19:00; daylight surfaces use white/mint, forest ink and solid borders without blur. All seven Drive controls fit without horizontal scrolling. Require actual source/artifact browser geometry, daylight contrast and permission-denial fixtures before normal hooked publication.
