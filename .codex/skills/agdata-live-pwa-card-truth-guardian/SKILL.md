---
name: agdata-live-pwa-card-truth-guardian
description: Preserve AgData live PWA inventory-card identity, canonical Valid Photos membership and count/export parity when changing AV or Drive presentation.
---

# Live PWA card truth

Use the existing canonical inventory resolver, photo URL/date helpers and exact inventory identity. Valid Photos derives from complete deduplicated inventory across seasons and lotcodes, never the current AV available-stock subset. Deduplicate itemcode/locationcode/lotcode without merging distinct physical rows. Keep intentional depletion/deletion and the established photo-expiry calendar authoritative; never revive expired or deleted photos or hardcode a recorded count.

Active AV Valid Photos selects All Seasons and bypasses default available-stock and season/lot exclusions. Its cards, counter and Excel source share the canonical row set; toggling renders immediately so stale no-photo cards do not remain beneath an active pill. Inventory readiness is data-dependent, not a fixed 250-row invariant. Preserve other deliberate user filters and server authorization.

Keep filter/action controls mounted above a bounded results scroller across screen sizes. Collapse only known inactive/empty chrome slots. A refresh may replace current cards together while preserving scroll, but must not insert skeletons over a mounted view or navigate to Home. Remembered-session first paint remains dark and hides login until an explicit logout or confirmed session boundary.

## Owned source and boundaries

Inspect assets/app-runtime.js, its composed assets/row-workflow-functions.js fragment, index.html and the final blocking shell CSS. Use docs/architecture/agdata-symbol-index.json to locate canonical functions. This presentation contract does not change Code.gs, SQL/RPCs, app-api, photo storage or mutation permissions.

## Focused verification

Exercise cross-season/lot rows, zero available stock with valid physical evidence, expired/no-photo/depleted rows and duplicate identities. Assert counter/list/export agreement and immediate toggle behavior. Exercise stale hydration after navigation and mounted-card refresh separately. Source/VM checks do not prove native-device visual behavior.

## Forbidden Anti-Patterns (Never Repeat)

- Counting the full inventory in a label while filtering cards/export through Current Season or positive AV availability.
- Defining competing photo validity helpers, hardcoding counts, or weakening deliberate deletion/expiry to obtain a desired count.
- Allowing background boot completion to reset active navigation or replace mounted cards with a skeleton.
