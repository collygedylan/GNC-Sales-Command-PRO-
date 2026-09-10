# Verified data cache — release 1

Shell: `V2026.09.10.01`. This release changes client loading, not imports, permissions, inventory, or email contracts.

## Contract

- Persist complete server-confirmed dataset snapshots separately from mutable application rows and drafts. The cache contract includes account/profile/role/login scope, the physical query, permission version, source revisions, and contract version.
- Required access resolves before protected content appears. The revision boundary validates the saved scope before a preview is applied. An unchanged revision vector verifies the saved snapshot without downloading its rows again.
- Changed snapshots may remain visible while their replacement loads. Native write boundaries and editor controls require the relevant datasets to be current; cached data alone never authorizes a write.
- Load the visible screen before footer badges. Independent background failures do not invalidate a successful visible dependency. Task subviews request their own dependencies instead of always fetching Flyer history and duplicate CAV data.
- Shared reads survive ordinary view changes. Results may populate the scoped canonical cache but may not repaint a different view. Account, permission, query, revision, visibility, and offline fences remain enforced.
- Cache writes clone canonical data and serialize independently per dataset. Do not persist the entire mutable app cache during native-session refreshes.

## Local verification evidence

The initial real browser pipeline (authentication HTTP fixtures, IndexedDB, revision coordinator, scheduler, adapters, and rendering) passed 40/40 cases across Chromium, Firefox, WebKit, Android, and iPhone layouts. No new cache/scheduler function is replaced with an always-successful fixture. The later expanded matrix adds mixed-revision cache coverage; its successful and failed timings are also retained, rather than replacing them with the initial result.

| Target | Warm access resolution to saved rows | Full inventory reads on warm reopen | Inventory response bytes |
| --- | ---: | ---: | ---: |
| Chromium | 345 ms | 0 | 0 |
| Firefox | 451 ms | 0 | 0 |
| WebKit | 739 ms | 0 | 0 |
| Android | 369 ms | 0 | 0 |
| iPhone | 676 ms | 0 | 0 |

These are controlled local fixture measurements, not production latency guarantees. The full release unit union passed 850/850. Successful and failed browser timing records are retained by the compiled validation artifact; do not discard successful benchmark results. Later WebKit/iPhone timing failures exposed an unnecessary first-paint debounce, a late-starting revision check, and unnecessary hidden-editor refreshes. First snapshots now render immediately, verification begins when navigation selects its screen, and plain lists skip hidden form chrome.

The final freshly compiled, isolated warm-reopen run passed all five profiles with the unchanged 1,000 ms limit: Chromium 399 ms, Firefox 300 ms, WebKit 684 ms, Android 311 ms, and iPhone 368 ms. Each made zero full inventory reads and transferred zero inventory response bytes. The separate five-profile mixed-revision run also passed: an unchanged master preview remains visible while a changed joined dependency loads, without enabling writes early. These final successful measurements are retained in `artifacts/verified-data-cache-final-warm/results.json`; earlier failures remain separate diagnostic artifacts.

Coverage includes unchanged and changed cache, preview write denial, verified editor enablement, retained drafts, unrelated hanging badges, shared navigation reads, account isolation, denied sources, and offline recovery. Four WebKit/iPhone reload scenarios recorded cross-origin diagnostics consistent with cancelled synthetic requests; assertions still passed, so this report does not claim an error-free console.

## Promotion

The final fixture-corrected, freshly compiled local matrix passed **45/45**. Warm saved-row times were Chromium 534 ms, Firefox 440 ms, WebKit 899 ms, Android 503 ms and iPhone 759 ms; each used zero full inventory downloads and zero inventory body bytes. Results are retained at `artifacts/verified-cache-final-45-fixture-corrected/results.json`. The independent real-input/deferred-hydration regression remains in the previously passing 80-case login/photo matrix. The original CI trace did not instrument the internal writer, so the initial-hydration explanation for that one failure remains an inference, not a proven trace attribution.

The first hosted candidate (`a0ee2391`, run `34485150220`) was correctly blocked, not deployed. Database/RLS, the four functional shards, timing, Lighthouse and other compiled suites passed. Two source-extraction tests still matched the old zero-argument scheduler signature, the isolated Docks geometry fixture returned no coordinator despite declaring it enabled, and one WebKit case injected a synthetic restored draft without first waiting for initial row hydration. The fixtures now require the current interfaces and a bound, idle exact row; their original safety/layout/draft assertions remain. The complete local unit union subsequently passed 851/851 and the six Docks header cases passed. A new exact-commit candidate must pass all hosted gates before promotion; the earlier run is not approval.

The second hosted candidate (`aee7cfc4`, run `34487745570`) passed every required lane except one iPhone AV Blanks failure case. Its trace showed a mobile click taking roughly 2.15 seconds while the 340 ms note autosave could run; the original trace did not retain enough state to prove the precise zero-completion-RPC cause. The failure fixture now arms the failed response before typing, holds the real autosave RPC, clicks Mark Done while that save is pending, and then releases it. It still requires exactly one completion RPC, retained draft and visible unfinished work, and now captures real save-handler/readiness/toast diagnostics. This deterministic overlap and both earlier instrumented orderings passed locally on iPhone. No production source changed for either fixture correction, and neither failed candidate was deployed.

Commit and validate this exact candidate before promotion. Publish release 1 before promoting the separate projection/detail release. Main Pages validation, exact-live checks, and mutation-blocked production canaries remain required. Local green tests are not proof of live publication.
