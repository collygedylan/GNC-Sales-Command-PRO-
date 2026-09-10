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

Commit and validate this exact candidate before promotion. Publish release 1 before promoting the separate projection/detail release. Main Pages validation, exact-live checks, and mutation-blocked production canaries remain required. Local green tests are not proof of live publication.
