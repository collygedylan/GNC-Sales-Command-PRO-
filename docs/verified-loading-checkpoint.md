# Verified loading repair checkpoint — V2026.09.13.02

Status: saved candidate, not approved for release. No full candidate validation has been dispatched and no main or deployment changes have been made.

Base/live main: `8f1ca2d2bd6e133a715e25cd871dfd5588c22d27`, V2026.09.13.01. Worktree: `C:/Users/dylan/Projects/GNC/worktrees/verified-loading-20260913`; branch `repair/verified-loading-20260913`.

## Completed implementation

Drive and Tasks loading now derives from the same dependency registry as rendering. Drive loads inventory/settings plus required access dependencies; detail panels and AV note choices load on demand. Tasks adds category/filter-specific Flyer, Hot Price, AV Blank (keys plus fallback), and reserve dependencies. Docks joins remain intact. Matching navigation checks coalesce; genuine revision/permission changes still recheck. Existing verified cache, complete pagination, atomic publication, account guards, and draft protection remain in place. Loading placeholders invalidate the former Drive render key so a cached snapshot can repaint. Initial verified view publication skips background render debounce.

## Verification

- Fresh compiled candidate tested locally.
- Full local unit runner: 967 passed, 0 failed.
- Inline parser: 7 scripts and 10 shell assets passed.
- Six focused Android/iPhone browser cases passed: Drive optional-source independence and repeat reuse; Tasks AV Blank keys/fallback proof with optional categories held; cache reload and source revision invalidation.
- One bounded independent reviewer examined dependency/access and coordinator changes. No correctness blocker reported.
- Final timing suite: four candidate and four baseline project/view combinations passed, with three cold/repeat trials each. Trials ran sequentially, without competing browser jobs.

## Release blocker

The small-fixture measurements do not establish faster first and repeat use. Drive repeat latency remains higher than the current release. Tasks improves in some scenarios, but the overall requested performance acceptance has not passed. Stop production repairs at the agreed active-work checkpoint and retain all work. Do not dispatch full validation or promote based on reduced request counts alone.

Timing starts at the actual navigation pointer event, excluding Playwright's actionability wait, and ends at visible content with a matching verified dependency proof. Byte figures are decoded REST response bodies in this synthetic fixture, not a production egress estimate. Optional badge traffic can overlap the measurement window. No hard production load-time claim is made.

| Build | View/profile | Visit | Median ms | Median REST requests | Median response bytes |
|---|---|---|---:|---:|---:|
| baseline | Drive / home-android-chromium | cold | 648 | 9 | 28779 |
| baseline | Drive / home-android-chromium | repeat | 164 | 5 | 2062 |
| baseline | Tasks / home-android-chromium | cold | 804 | 19 | 31849 |
| baseline | Tasks / home-android-chromium | repeat | 112 | 2 | 1346 |
| baseline | Drive / home-desktop-chromium | cold | 554 | 8 | 28777 |
| baseline | Drive / home-desktop-chromium | repeat | 180 | 7 | 2422 |
| baseline | Tasks / home-desktop-chromium | cold | 759 | 19 | 31849 |
| baseline | Tasks / home-desktop-chromium | repeat | 100 | 3 | 1267 |
| candidate | Drive / home-android-chromium | cold | 606 | 5 | 28246 |
| candidate | Drive / home-android-chromium | repeat | 286 | 3 | 187 |
| candidate | Tasks / home-android-chromium | cold | 620 | 13 | 30988 |
| candidate | Tasks / home-android-chromium | repeat | 270 | 3 | 1758 |
| candidate | Drive / home-desktop-chromium | cold | 602 | 6 | 28248 |
| candidate | Drive / home-desktop-chromium | repeat | 282 | 4 | 1507 |
| candidate | Tasks / home-desktop-chromium | cold | 649 | 13 | 30268 |
| candidate | Tasks / home-desktop-chromium | repeat | 277 | 4 | 1943 |

Raw result files and the immutable .01 baseline package remain under ignored `artifacts/` in this worktree. The baseline config lives in `artifacts/playwright.loading-baseline.config.mjs`; its JSON reporter output should always use an absolute path. Benchmark command: set `VERIFIED_LOADING_BENCHMARK=1`, run the `benchmark records` tests with one worker. Use `VERIFIED_LOADING_BASELINE=1` only for historical measurements; it records a bounded historical repeat failure as unusable and never relaxes candidate assertions.

## Remaining work

1. Trace repeat-navigation proof and render scheduling end-to-end; determine where the additional delay occurs instead of another speculative fix. Record revision RPC count/timestamps and actual paint completion.
2. Demonstrate acceptable cold/repeat performance with the same fixtures; add a representative delayed/large-source case if needed, documenting its assumptions.
3. Run remaining focused HL/Drive-detail and desktop checks, then complete exact-commit candidate validation (one run plus at most one corrected run).
4. Only after all gates pass: exact validated-commit promotion, main validation/deployment, exact V2026.09.13.02 and commit verification, hosted checks. Recheck main/version availability first.

No database or reporting dependency deployment is required by these changes. Existing release gates and protected ordering/receiving contracts remain unchanged.
