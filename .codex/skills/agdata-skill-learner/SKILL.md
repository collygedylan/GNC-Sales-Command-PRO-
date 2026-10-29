---
name: agdata-skill-learner
description: Keep AgData domain skills and explicit fixture-read contracts synchronized when features, buttons, tables or RPCs are introduced or changed.
---

# Maintain skills alongside features

## Owned files and core functions

- Own `docs/architecture/agdata-module-dependency-map.md`, its static inventory, `.codex/skills/*/SKILL.md`, the skill routing list in `AGENTS.md`, and manifest/dependency registration in `tests/agdata-governance.test.mjs`, `tests/agdata-architecture.test.mjs` and `scripts/run-tooling-release-checks.mjs` (`runToolingReleaseChecks`).
- Use the map to route functions in `index.html`, `assets/*.js`, `supabase/functions/app-api/index.ts` and `Code.gs` to their domain owner. This maintenance skill does not own application mutations. Track renamed/added functions, DOM ownership, action/RPC names, migration contracts and exact focused test paths in the same commit as the feature.

Source extraction changes file ownership, not the number of business features. Keep the original census clearly labeled as a historical snapshot, record current source layout separately, and refresh dependency-map links to the actual function or stylesheet. Count function removals independently of functions merely moved into linked assets; preserve static tests through the shared composed-source reader.

Manager table registration is owned by `agdata-table-management-and-directory`: keep `ph_company_directory` and `ph_inquiry_coverage` behind the authenticated app-api action, preserve canonical user-access and customer-mapping RPCs, and keep every historical/photo view read-only. Update the symbol index, dependency map, fixture routes for any new startup reads, and the all-Gems gate whenever these seams change.

Governance and skill updates do not authorize production changes. Production AI and watchdog workflows remain read-only: they may summarize evidence or propose a patch, but must not autonomously edit production source, push commits, or publish. A staging push may produce only the fast-validated site artifact; production promotion continues through the reviewed `main` release path.

## Shared component dependencies

Teach universal behavior as universal: absent an explicit named-user exception, feature skills and fixture contracts must cover all active users/roles and all Sales Rep identity formats rather than preserving a one-account workaround.

Every feature skill must name its dependency on the shared `switchView` / `showOnlyPrimaryView` router, `goBackUniversal` / `updateGlobalBackButton`, `viewHistoryStack` and header/search ownership where applicable. Do not teach a local component to hide or recreate global Back/navigation DOM. Keep permissions, auth epoch, cached rows and recipient contracts distinct from visual shell state. Record static findings separately from rendered behavior and measured performance.

## Scoped Node verification

```sh
node --test tests/agdata-governance.test.mjs tests/agdata-architecture.test.mjs
```

Target under 10 seconds. These checks validate manifests, registered ownership and usable test/source pointers without running the feature suites. The audit inventory is a commit-stamped reference, not a receipt authorizing deployment or a claim that all runtime behavior was tested.

When adding or changing a feature, button, table or RPC:

1. Trace the actual ERP → Supabase → UI flow, including row identities, protected live fields, account permissions and owning domain skills, before coding.
2. Load only the affected domain skill bodies and any genuinely required cross-cutting guard. Do not expand every skill for unrelated work.
3. Register each new startup/background read in the shared Playwright fixture allowlist with its exact route, method, action/RPC, accepted parameters and response shape. Add a focused unknown-route rejection case; never introduce a wildcard success stub.
4. Update the corresponding `.codex/skills/<skill-name>/SKILL.md` in the same commit with verified changed rules and useful source pointers. Preserve YAML name/description and precise activation boundaries.
5. Validate the skill manifests and affected contracts together with the implementation's selected checks. Record unresolved behavior honestly rather than teaching an unverified assumption as fact.

This is repository maintenance, not model training or automatic Gemini account synchronization. Improve skills from concrete feature changes or demonstrated failures; avoid duplicate global rules, speculative policies and unrelated cleanup. Existing user scope and authorization remain controlling.

The v2.3.31 recovery uses existing inventory_read master_page and drive_reclass_inquiry status contracts; no new startup/background route is introduced.

Shared releaseSnapshotReadFixture registers exact customer-rep-map/preload and suspend_tag/inbox request and response shapes. Reject additional parameters and mutation operations; Node governance assertions cover rejection. These registrations do not imply a new browser validation run.

## Request completion and foreground continuity

releaseSnapshotReadFixture registers exact manual_sync_status and request_work/capabilities shapes with explicit response data. Unknown keys, forged actor IDs and save operations remain rejected. The HL startup fixture supplies account-scoped capabilities. Node governance checks cover these contracts; registration alone does not claim browser validation.

Conditional dataset_read fixture parameters permit ifRevision only as a decimal string for soc/cav/reserves. Unknown keys and mutations remain rejected; Node tests cover hidden heartbeat, scoped cache reuse and indexed lookup timing.

Eval2 extends the existing authorized report_read_v2 response with compact browseColumns/browseRows and evaluatorDirectory metadata. It introduces no startup route, mutation grant or wildcard fixture. Node regression fixtures exercise exact local grouping, user row counts, empty selection, account fences and Back transitions. Register eval_browse_suspend_receipts_v1 in the scoped migration runner and verify its installed contract before app-api/Pages publication.

Queue badge startup registers only location_work/list/status=all and bunch_note_workflow queue/list_discrepancies with filter=mine, offset=0, limit=100 in releaseSnapshotReadFixture. Unknown keys, forged actor IDs and mutations remain rejected. No browser validation is implied.

The v2.3.60 request repair adds no startup route: it preserves the existing queue and metadata fixtures, registers the scoped SQL migration, and ratchets exact-ID ledgering plus four-proof lifecycle recovery into the golden invariants.

The v2.3.95 Reclass/navigation repair adds no startup or background route. Invariant 99 owns the behavior ratchet: empty Move Up/Down opens without validation, pending optimistic rows reject stale master snapshots, coherent publication invalidates resolved caches, and Drive card/program Back unwinds before season/size/name/search/history.

## Owned Files, Canonical Functions & SQL Contracts

- Own `docs/architecture/agdata-symbol-index.json`, `.codex/skills/*/SKILL.md`, `AGENTS.md`, `tests/golden-invariants.test.mjs`, governance registration, and the dependency map. Every listed symbol must resolve in its declared source file.
- **Mandatory Step 0:** before editing any source, read the symbol index and every owning skill, then trace the `Code.gs` <-> SQL <-> app-api <-> `assets/app-runtime.js` blast radius.

## Cross-Layer Blast Radius

- **Mandatory Step N — `+1 Ratchet Learning Loop`:** every bug or Watchdog incident fix appends its root-cause anti-pattern to the owning skill's forbidden section and appends one new active `Invariant N` behavior test to `tests/golden-invariants.test.mjs` in the same commit.
- New functions/RPCs/background reads update the symbol index, exact fixtures, owning skill, focused checks, and deployment registration together; documentation never substitutes for executable coverage.

## Mandatory 4-Caller & All-11-Gems Impact Contract

- Before any migration, RLS/trigger, app-api, Apps Script, or runtime hydration change, verify browser direct operational reads, the `Code.gs` delivery worker, bounded app-api startup work, and typed/guarded Postgres triggers across every Gem domain.
- Keep operational reads SWR/LKG, keep `ph_app_users` and `user_access_control` private, never route startup downloads above 2,000 rows through app-api, and never mix `timestamptz` with `text` or add unguarded master row triggers.

## Forbidden Anti-Patterns (Never Repeat)

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never edit before the Step 0 read, leave a new canonical function unindexed, add a wildcard fixture, teach an unverified assumption, or close a bug without the `+1` invariant and root-cause entry.
- Never delete, renumber, skip, todo, or weaken an existing golden invariant; the ratchet is append-only.
- Never encode a general workflow contract as a one-user or one-rep exception; record deliberate named-user exceptions explicitly and add representative multi-identity coverage for every universal rule.

- Never diagnose an empty operational screen from row counts alone: verify the authenticated response against the generated browser contract and then exercise the same canonical hydration, drill navigation, and live note fields. Dock header aliases and all-user display parity share the existing SOC/master read contracts; no wildcard fixture or new startup read is justified.

- Season Priority cold-start note enrichment reuses the bounded `inventory_read/master_identity_batch` contract (`queueIdentities`, at most 100 exact identities per request) already modeled by `inventoryIdentityBatchFixture` in `tests/fixtures/hl-order-state.mjs`; no wildcard or bulk startup proxy is added. Account/scope/permission and returned-revision fences own the display cache, and Service Worker activation must finish before any client navigation can depend on it.
