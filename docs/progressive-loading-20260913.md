# Progressive loading repair — V2026.09.13.04

Base: `96a1112b2a497c23c6605a9583db356ae91751d9` (V2026.09.13.03).
Historical loading reference: `186d3c3836cfd85cfbbe6f72be485425147a8a49` (V2026.08.31.01).

The user explicitly selected cache-first/progressive display, including potentially old or incomplete displayed rows. This supersedes the previous requirement to withhold every card until a complete source snapshot verifies. Permissions and protected write contracts remain unchanged.

## Read routing

Native database GETs, including legacy-named helper calls used by background refresh, AV evaluations, and chat, use authenticated PostgREST. Session restoration and token refresh share pending work. Missing native credentials produce session recovery guidance rather than the app-api database fallback. Native mode remains sticky during recovery, while actual legacy sessions retain their existing transport. Sign-out and account changes invalidate pending recovery. The delayed native login validator refreshes the established session instead of performing a second password login 2.2 seconds after startup; it no longer clears the profile during active reads or persists a native password through the legacy validator. An unfinished verification remains loading instead of being reported as Load Failed.

The fixture now returns production's HTTP 410 `DIRECT_RLS_REQUIRED` for native app-api database calls. The production prohibition remains unchanged. Read-only inspection confirmed authenticated SELECT, RLS, and policies on the affected master, sales-office, AV evaluation, and chat tables; no database or public API changes are required.

## Display and completion

The existing coordinator remains the native loading owner. Core readers offer their first page to the visible dependency group. An unrelated explicitly requested startup dependency cannot gate that group's early display. General views may reuse complete raw disk snapshots with matching account, query, and permission metadata while their source revisions refresh. In-memory returns render available data during the current revision check without another inventory download.

Progressive publication does not create complete-source flags, inventory proofs, or HL reconciliation snapshots. HL ordering, PO management, detail panels, and open editing dialogs retain their verification requirements. The final authoritative publication still validates pagination and before/after revisions. Inaccessible sources clear display eligibility; late navigation/account results are discarded.

Common Name rendering appends bounded batches without treating an interrupted batch as complete. Identical renders retain active work. Source freshness and rendering completion remain separate; failures keep accessible rows and Retry, and preparation cannot conceal an error.

## Verification record

- 983 required release unit checks passed locally (`release-unit-final-2.log`). The additional historical season-query fixture check also passed.
- Six corrected desktop cases passed (`progressive-corrected.log`). The four-profile run passed 32/36 cases; traces identified delayed native reauthentication and a premature failure state on WebKit. After correction, all eight targeted iPhone/iPad cases passed (`artifacts/progressive-mobile-corrected.json`).
- The expanded inventory fixture contains 9,366 physical rows and 1,581 distinct names, including repeated names and separate identities.
- Frozen fixture rows are validated once; mutable rows continue to be validated on every read. This removes test-harness work without weakening source validation.
- Implementation and focused repairs completed within the 30-minute checkpoint. Isolated timing trials completed; full candidate validation and live release checks remain pending. No candidate has been promoted.

Ignored `artifacts/august31-reference` contains a separately compiled historical reference for measurement only. It is not a release checkout or deployment source.

## Isolated timing results

Three cold sessions and three repeat visits per profile used identical 9,366-row / 1,581-name fixtures, one browser worker, and no competing browser jobs. Times start at Drive navigation, not login. Response bytes include REST fixture payloads, not static app downloads.

| Candidate median | Desktop Chromium | iPhone WebKit |
| --- | ---: | ---: |
| Cold first available names | 3.299 s | 4.366 s |
| Cold complete verified list | 20.565 s | 19.657 s |
| Repeat first available names | 2.109 s | 2.981 s |
| Repeat complete verified list | 2.782 s | 3.702 s |
| Repeat inventory page downloads | 0 | 0 |
| Repeat REST response bytes | 2,953 | 3,010 |

All six candidate samples completed with all names and no prohibited native database-proxy reads. Cold inventory pagination required 10 desktop / 11 mobile reads; cold REST response bytes were approximately 43.08 MB. Evidence: `artifacts/progressive-candidate-timing.json`.

The separately compiled August 31 reference failed the full-name count in all six historical samples under the same native-auth fixture. Its older season-scoped query was supported and tested before these recorded trials. These failures are not valid completion timing samples, and no percentage improvement over August 31 is claimed. Evidence: `artifacts/august31-timing-corrected.json`.

## First candidate corrections

Candidate `1cc4c698932a2b2a7ae521f29602000d23ec56b0`, run `34806809510`, was not promoted. Two held-refresh tests still expected the old `Syncing` label. Their assertions now require `Showing available rows · Refreshing` and independently require the coordinator to remain in `Syncing`, retaining all row, import, failure, reconnect, and final-proof checks.

Full Home validation also exposed a restored-session regression: the first `INITIAL_SESSION` event arrived before a profile existed and invalidated its own pending session read. Account mismatch now requires a known previous profile identity. Sign-out still always invalidates; successful password/passkey sign-in explicitly invalidates old reads before replacing identity. This is covered by a new unit regression and 16 passing restored-login/reload browser cases across all four Home profiles.

After correction, 985 required unit checks passed. All three focused Docks profiles passed. Four of five traced cache profiles passed; local desktop WebKit exhausted the overall 60-second budget at its final already-visible summary assertion. Its trace showed successful preceding correctness assertions. The unchanged test passed in 8.6 seconds with local tracing disabled as a diagnostic; required CI tracing, all assertions, and time limits remain unchanged. No gate is waived by that diagnostic.

The initial Home, HL order, and restocking jobs exhausted their job limits after the same restored-profile wait timed out; their logs point to `hl-order-state.mjs:608`. Six focused HL draft-reload and receipt-correction cases passed after the correction in Chromium, Firefox, and iPhone. The corrected candidate retains V2026.09.13.04 and uses the one additional full validation allowed by the release plan.
