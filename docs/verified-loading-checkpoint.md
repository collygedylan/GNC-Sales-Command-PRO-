# Verified loading repair — V2026.09.13.02

Status: implementation, controlled timing, and focused functional checks passed; exact-commit release gates remain required. No production changes have been made at this checkpoint.

Base/live main: `8f1ca2d2bd6e133a715e25cd871dfd5588c22d27`, V2026.09.13.01. Worktree: `C:/Users/dylan/Projects/GNC/worktrees/verified-loading-20260913`; branch `repair/verified-loading-20260913`.

## Diagnosis and correction

The resumed trace separated navigation, revision RPCs, proof publication, scheduling, and visible usable content. Returning to cached Drive/Tasks waited for a deferred activation callback; rapid return could retain the previous visit's proof before that callback. Later activation could request duplicate verification. Both coordinator status and the loader completion scheduled rendering. The historical Drive render key could also prevent repainting a loading placeholder.

Navigation now establishes a new visit identity, masks old content, and immediately checks Drive/Tasks revisions. Matching readiness callbacks coalesce into the same proof; source and permission events still trigger checks. One successful verification path schedules rendering immediately, and cancels an obsolete queued view-switch render. Render callbacks reject changed navigation/account context. Unchanged cached sources avoid downloads and index recommits. The raw snapshot identity remains independent of navigation generation.

The saved dependency improvements remain: Drive loads inventory/settings and required access dependencies; details and AV-note choices load on demand. Tasks adds category/filter-specific Flyer, Hot Price, AV Blank keys plus fallback, and reserve dependencies. Docks joins, complete pagination, atomic publication, account restrictions, and draft protection remain intact.

## Controlled measurements

Three independent trials per view/profile/build, each containing cold, settled Home return, and rapid Home return. Timing jobs ran serially with no competing browser work. Tasks fixtures contained actionable results. Timing begins at navigation pointerdown and ends at visible usable content with matching current proof and verification completed during that visit. Prior exploratory timings used a different endpoint and are superseded.

The user explicitly accepted recording historical noncompletion as failure, requiring every candidate repeat to pass and comparing speed wherever baseline completes. Failed samples have no numeric timing. Baseline Drive completed only 2 of 12 returns; candidate completed all 36 visits, including all 24 returns.

| Profile/view | Cold baseline → candidate | Settled baseline → candidate | Rapid baseline → candidate |
|---|---:|---:|---:|
| Android Drive | 335 → 223 ms | 148 (1/3 usable) → 116 ms | 962 (1/3 usable) → 88 ms |
| Android Tasks | 467 → 340 ms | 182 → 117 ms | 727 → 113 ms |
| Desktop Drive | 317 → 226 ms | 0/3 usable → 87 ms | 0/3 usable → 84 ms |
| Desktop Tasks | 413 → 341 ms | 157 → 119 ms | 802 → 106 ms |

All candidate entries are three-trial medians. Every candidate repeat used zero adapter reads and zero index recommits. Cold Drive adapter reads fell from 5 to 2; cold Tasks from 12 to 8. Candidate repeat REST medians: Drive 1 request / 185 bytes; Tasks settled 2 / 986 bytes, rapid 1 / 493 bytes. Cold REST medians: Drive 8 requests / 28,777 bytes → 4 / 28,061; Tasks 18 / 8,301–8,972 → 13 / 7,391. Bytes are decoded fixture response bodies, not production transfer or billing estimates; badge traffic may overlap. These small-fixture results are not a promised production load time.

Ignored evidence: `artifacts/resumed-baseline-timing.json`, `artifacts/resumed-candidate-timing.json`, `artifacts/resumed-timing-summary.json`, `repeat-navigation-trace.log`, and `repeat-navigation-trace-after.log`. The immutable .01 package and baseline config remain under `artifacts/`. Use an absolute JSON reporter path. `VERIFIED_LOADING_BASELINE=1` permits failure capture only for historical measurement; candidate assertions remain strict.

## Validation and release

- Fresh compiled runtime used for timing and functional checks.
- Full local unit runner: 970 passed, 0 failed. Inline parsing: 7 scripts and 10 shell assets passed.
- One bounded independent reviewer reported no blocker in navigation identity, source/permission invalidation, stale callback guards, or failed-read retry handling.
- Focused compiled browser checks: 40 Home/native startup/cache cases across Android, iPhone, tablet, and desktop; 6 HL/Drive detail, preserved-input return, and importing/obsolete-page cases across Firefox and Android. All 46 passed.
- Complete candidate validation is limited to one attempt plus at most one corrected attempt. Promote only its exact passing commit after the required candidate check. Main validation, sealed artifact verification, deployment, exact .02 version/commit verification, and hosted checks remain required.

No database, reporting, or public API changes are required. The active-repair checkpoint and repeat-failure stopping rule remain in force. Main must still match the stated base before promotion.
