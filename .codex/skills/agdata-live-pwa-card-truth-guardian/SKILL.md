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

## AgData v3.0.19 windowed card law

AV and Drive DOM windowing is presentation only. Keep the complete canonical row array, photo membership, counts, Excel exports and exact physical mutation identity authoritative; never derive them from mounted cards. Offscreen nodes may be removed, but scrolling, sorting, filters and Back must reach every eligible row. Source is omitted from AV card markup; kiosk location/metric visibility must not rewrite canonical data.

### Forbidden Anti-Patterns (Never Repeat)

Never window the underlying inventory data, accumulate offscreen card DOM indefinitely, retain stale observers after removal, or let kiosk styling change canonical identity, permissions or photo truth. Verify render behavior separately from SQL and delivery receipts.

## AgData v3.0.20 aggregate dashboard law

Report dashboard totals are full-cohort aggregates, never sums of mounted cards, paged previews or location-note duplicates. Preserve exact physical inventory identity and existing report classification; notes overlay their canonical row rather than becoming extra stock. Sum row On-Hand and its existing list-price extended value without inventing missing prices. Dashboard actions and displayed totals must describe the same report cohort; evaluation mutations and database protections remain unchanged.

### Forbidden Anti-Patterns (Never Repeat)

Never compute report totals from a visible page, double-count notes as stock, reuse another report’s drill filters, reset active navigation during refresh, or replace an existing classifier/drill/mutation owner to add dashboard presentation.

## AgData v3.0.21 compact report drill cards

Compact Eval Reports group cards are a presentation layer over their existing report cohorts. Preserve full-cohort counts, physical row identities, Total On-Hand and row list-price Extended Value. Emerald Season Y <= 2026 cards must retain every existing metric and click target; card height, layout and color must not change report filters, membership, navigation or mutation behavior.

### Forbidden Anti-Patterns (Never Repeat)

Never change report cohorts or filter state to make drill cards look uniform, drop aggregate metrics to reduce height, or apply report-only compact styling to unrelated inventory cards. Keep presentation helpers separate from canonical data and mutation owners.

## AgData v3.0.22 clean report drills

Removing redundant Eval Reports navigation and filter chrome is presentation only. Existing report membership, physical row identities, aggregate totals, evaluation mutations and filter semantics remain authoritative. Preserve the v3.0.21 compact group-card markup, dark emerald audit presentation and all metric values while simplifying the surrounding drill screen.

### Forbidden Anti-Patterns (Never Repeat)

Never recreate inline report navigation beside the shared header Back, reset filters or cohorts when removing their redundant disclosure, or simplify report chrome by changing canonical cards, metrics, drill identity or evaluation mutations.

## AgData v3.0.23 receipt and report card law

The Season Y <= 2026 Block Alpha card simplification changes only visible group-card presentation. Preserve physical inventory identity, report membership, canonical totals and valuation. Location metrics, exact-row actions and the clean shared Back navigation remain unchanged.

### Forbidden Anti-Patterns (Never Repeat)

Never change canonical inventory or report counts to match a simpler Block Alpha card, or propagate a Block Alpha-only metric omission to Location and exact-row cards.

## v3.0.24 canonical-engine consolidation

The v3.0.24 shared group-card renderer supersedes the earlier audit-only Location metric-panel presentation. Display simplification never changes report membership, aggregate valuation, stock, evidence, physical identity or write targets. All live card surfaces resolve canonical inventory before displaying metrics; order quantity cannot stand in for On-Hand.

### Forbidden Anti-Patterns (Never Repeat)

Never add a parallel owner, hide forbidden markup with CSS, weaken the mandatory lock to accept a bypass, or change database protections during this frontend consolidation.
