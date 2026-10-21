---
name: agdata-skill-learner
description: Keep AgData domain skills and explicit fixture-read contracts synchronized when features, buttons, tables or RPCs are introduced or changed.
---

# Maintain skills alongside features

## Owned files and core functions

- Own `docs/architecture/agdata-module-dependency-map.md`, its static inventory, `.codex/skills/*/SKILL.md`, the skill routing list in `AGENTS.md`, and manifest/dependency registration in `tests/agdata-governance.test.mjs`, `tests/agdata-architecture.test.mjs` and `scripts/run-tooling-release-checks.mjs` (`runToolingReleaseChecks`).
- Use the map to route functions in `index.html`, `assets/*.js`, `supabase/functions/app-api/index.ts` and `Code.gs` to their domain owner. This maintenance skill does not own application mutations. Track renamed/added functions, DOM ownership, action/RPC names, migration contracts and exact focused test paths in the same commit as the feature.

Source extraction changes file ownership, not the number of business features. Keep the original census clearly labeled as a historical snapshot, record current source layout separately, and refresh dependency-map links to the actual function or stylesheet. Count function removals independently of functions merely moved into linked assets; preserve static tests through the shared composed-source reader.

Governance and skill updates do not authorize production changes. Production AI and watchdog workflows remain read-only: they may summarize evidence or propose a patch, but must not autonomously edit production source, push commits, or publish. A staging push may produce only the fast-validated site artifact; production promotion continues through the reviewed `main` release path.

## Shared component dependencies

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
