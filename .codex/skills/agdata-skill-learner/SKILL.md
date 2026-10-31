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

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.

- v2.3.118: Never add a receipt normalizer without indexing the declaration-only row-workflow asset, an active behavior invariant, and its owning skill. Existing evidence RPC and note reads remain the only routes; no new startup fixture is introduced.

- v2.3.115: Never exceed the raw-runtime budget to add row workflows. Register declaration-only assets/row-workflow-functions.js through the existing composition marker and index its exact symbols; audit identifier scope with Invariant 218.

- v2.3.112: Never report extracted declarations as deleted functions or compare revised audit methodology as if it were identical. Preserve the Stage 1 baseline, label candidate counts, and register new source ownership and composed-reader parity with behavior tests.

- Never register an implementation without its owning symbol and behavior invariant. v2.3.107 adds user-invoked project_create_from_bloom, service-only create_inventory_project_v1, and an inventory_projects broadcast refresh; projects_read remains the existing authenticated read route.

- Never equate a realtime connection or row event with complete cold hydration. Register per-owner source buffering, full-load replay, requester eligibility, assigned Eval Reclass and cloud-history continuation behavior together, with no wildcard browser fixture.

- Never create a second sync engine or substitute client Broadcast row claims for database authorization. Register the existing coordinator's row-patch helpers, physical source subscriptions, and opaque revision hints together; preserve draft/owner tests and report actual production timings separately from local synchronous behavior.

- Never approve a cross-layer change from one caller's tests alone or trade another Gem's availability, navigation, delivery, or data contract for a local pass.

- Never edit before the Step 0 read, leave a new canonical function unindexed, add a wildcard fixture, teach an unverified assumption, or close a bug without the `+1` invariant and root-cause entry.
- Never delete, renumber, skip, todo, or weaken an existing golden invariant; the ratchet is append-only.
- Never encode a general workflow contract as a one-user or one-rep exception; record deliberate named-user exceptions explicitly and add representative multi-identity coverage for every universal rule.

- Never diagnose an empty operational screen from row counts alone: verify the authenticated response against the generated browser contract and then exercise the same canonical hydration, drill navigation, and live note fields. Dock header aliases and all-user display parity share the existing SOC/master read contracts; no wildcard fixture or new startup read is justified.

- Season Priority cold-start note enrichment reuses the bounded `inventory_read/master_identity_batch` contract (`queueIdentities`, at most 100 exact identities per request) already modeled by `inventoryIdentityBatchFixture` in `tests/fixtures/hl-order-state.mjs`; no wildcard or bulk startup proxy is added. Account/scope/permission and returned-revision fences own the display cache, and Service Worker activation must finish before any client navigation can depend on it.

## Permanent Main-Thread Memory Budget and Automatic Handoff

- **95% memory reduction / zero-compaction stdout budget:** Maximum 8 stdout lines per command. Never dump verbose test, tooling, Supabase, SQL, or diff output into chat. Redirect output to a scratch log under G:\My Drive\GNC\AgData\Release Evidence\; print only exit status, elapsed seconds, and the last 5 log lines. Use git diff --stat and inspect targeted ranges of at most 35 lines. Aim to keep context use below 15%; do not claim this is measurable or guaranteed without telemetry.
- **Batched execution:** Maximum 5 shell commands per prompt; batch inspection into 1, edits into 1–2, required focused tooling into 1, and authorized deployment/push/smoke into 1. Use the main thread only. Never spawn Customer ui, Customer backend, or other worker sub-agents. Do not rerun passed suites or rebuild a completed release without a demonstrated blocker.
- **Automatic handoff:** Read .gnc-local/latest-state.md first at the beginning of each new chat. At the end of every completed release, write exactly 10 concise lines recording the live version, latest commit SHA, publication results, checks, limitations, and next action. This required local state file is an explicit exception to the retained-artifact location rule.
- **Thread-full alert:** If a thread exceeds 6 completed prompts or context compaction occurs once, append this exact line at the bottom of the final response:
  **⚠️ CHAT MEMORY NEAR LIMIT — TAP [NEW CHAT] BEFORE PASTING YOUR NEXT PROMPT (STATE SAVED TO .gnc-local/latest-state.md)**
- **Zero permission pauses / cold-cache loops:** Execute authorized work end-to-end without May I permission prompts. Never fail or retry live browser checks solely for cold-cache download seconds or cancelled background reads during navigation. Report unverified outcomes honestly; do not weaken functional or security assertions.


## Dark-emerald UI contract

Bloom project pickers and Reclass confirmations use centered, accessible in-app controls with the dark-emerald palette; preserve modal Back ownership, mapped identity and existing mutation boundaries.
