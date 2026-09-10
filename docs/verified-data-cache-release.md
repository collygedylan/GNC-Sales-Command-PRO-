# Verified data cache — release 1

Shell: `V2026.09.10.01`. This release changes client loading, not imports, permissions, inventory, or email contracts.

## Contract

- Persist complete server-confirmed dataset snapshots separately from mutable application rows and drafts. The cache contract includes account/profile/role/login scope, the physical query, permission version, source revisions, and contract version.
- Required access resolves before protected content appears. The revision boundary validates the saved scope before a preview is applied. An unchanged revision vector verifies the saved snapshot without downloading its rows again.
- Changed snapshots may remain visible while their replacement loads. Native write boundaries and editor controls require the relevant datasets to be current; cached data alone never authorizes a write.
- Load the visible screen before footer badges. Independent background failures do not invalidate a successful visible dependency. Task subviews request their own dependencies instead of always fetching Flyer history and duplicate CAV data.
- Shared reads survive ordinary view changes. Results may populate the scoped canonical cache but may not repaint a different view. Account, permission, query, revision, visibility, and offline fences remain enforced.
- Cache writes clone canonical data and serialize independently per dataset. Do not persist the entire mutable app cache during native-session refreshes.

The lightweight dataset revision response is also an authorization boundary: it supplies a permission fingerprint and per-source availability that the separate module-access response does not contain. A saved preview therefore waits for that small check, never for unchanged dataset rows. A delayed/unavailable revision service cannot safely be bypassed using module permissions alone. The sub-second fixture measurements include this check under the fixture's network conditions; they are not a guarantee under an arbitrarily delayed authorization response.

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

The third candidate (`58d13b3b`, run `34489661574`) passed all lanes except a different Chromium fixture bootstrap failure: Playwright reported `Resulting promise was garbage collected` 87 ms into the second isolated client's evaluation. The iPhone completion case passed. The bootstrap is now explicitly retained by the page, with a non-retrying failure deadline and auth/import/render diagnostics; errors are not caught and treated as success. The complete compiled AV suite then passed 10/10 locally in 2.4 minutes, including both previously failing flows. Its exact candidate must be revalidated, not promoted based on the other lanes.

The fourth candidate (`fa17a1c1`, run `34492061054`) was cancelled as obsolete before promotion when a real native footer feedback loop was measured: verified rendering scheduled the legacy badge timer, which scheduled another coordinator check and verified rendering. A diagnostic recorded 141 metadata requests in one minute. Native sessions now cancel that legacy timer and rely on the existing coordinator events and safeguard poll; legacy sessions retain their prior timer behavior.

The expanded local footer run retained all 45 existing passing browser cases. Warm times were Chromium 484 ms, Firefox 295 ms, WebKit 890 ms, Android 511 ms and iPhone 729 ms, with zero full inventory downloads and zero inventory response bytes. Two new WebKit/iPhone assertions initially assumed at most four metadata reads per change event. The retained trace instead showed a finite three foreground plus three background reads: before/after checks and one cached queued-loader join for each lane. Background badge dependencies also include the master revision. There was exactly one inventory download, no extra change signal, and zero idle reads. The bound is therefore explicitly six for the two lanes; neither the one-download assertion nor the idle-zero assertion is relaxed. Successful and failed results remain separate artifacts.

The corrected bounded test passed all five profiles (5/5, zero skips/flaky/errors, 78.3 seconds), retained at `artifacts/r1-footer-derived-bound-5/results.json`. This is a validation union of the 45 passing unchanged cases plus the five corrected bounded cases, not a claim that the earlier 50-case run was entirely green. The exact hosted candidate runs the complete 50-case suite again.

The fifth candidate (`98552a19`, run `34496902127`) passed every safety lane except the same Chromium AV fixture return-promise error; the complete 50-case cache suite passed. The retained trace shows the second client already rendered Tasks / AV Blanks with four items after the error, with the same frame URL and no navigation or page error. Chrome collected the outer asynchronous evaluation's return promise, despite the inner bootstrap promise being page-owned. The fixture now starts bootstrap synchronously, records explicit ready/failed state, and polls serialized state with the same 45-second deadline and diagnostics. It does not retry failed bootstrap or accept failure as success. This change is test transport only.

The corresponding release-2 browser run also exposed a one-shot assertion sampling an independent, finite master recheck after current data had already appeared. The shared dependency test now waits for that recheck while the unrelated badge request remains held and explicitly verifies its gate is still closed. It still cannot pass if the badge blocks verification indefinitely; no production freshness rule is relaxed.

The corrected AV suite passed 10/10 locally in 1.4 minutes, and the held-badge verification case passed 5/5 in 19.6 seconds. They exercised the same freshly compiled `.01` application bytes as candidate five; only test transport/assertions and this evidence document changed afterward. The next candidate is rebuilt and sealed by CI and must pass every gate independently.

Commit and validate this exact candidate before promotion. Publish release 1 before promoting the separate projection/detail release. Main Pages validation, exact-live checks, and mutation-blocked production canaries remain required. Local green tests are not proof of live publication.
