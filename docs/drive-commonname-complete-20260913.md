# Complete Common Name list — V2026.09.13.03

## Failure and correction

The reproduced V2026.09.13.02 failure loaded 1,561 distinct names but published only its first 18 cards. An identical render cancelled the chunk token and then reused a render key which had been set before completion.

Common Name now builds bounded batches in a detached fragment and publishes every card together. Preparing, cancelled, and complete are separate states. Identical current preparation is retained; changes to navigation, account, permissions, source proof, search, or filter scope invalidate it. Completing cards never clears a source-verification error.

Hiding the window cancels pending preparation. Foreground verification restarts it, including when the unchanged Drive search field retains focus. Other focused data-entry controls and unsaved forms keep their existing protections. Empty and spreadsheet lists also have explicit completed state.

The authenticated master adapter uses the existing complete-read check: exact count, all pages, nonempty unique identities, and unchanged source revisions. Its internal cache query version changes so older snapshots without that completeness contract are not reused. Subsequent unchanged visits reuse the verified snapshot without another inventory download. Database, import, reporting, authentication, and public API contracts are unchanged.

## Verification

The shared browser fixture now reports the whole matching inventory count rather than the current page size. Regression data has 1,562 physical rows and 1,561 names. Browser cases cover held and failed later pages, an empty page with a nonzero declared total, duplicate refreshes, complete publication, first/middle/last selection, duplicate-name row counts, filtered-list replacement, navigation, visibility restore, and unchanged repeat-read counts. Existing Home restored-session, permission, HL, inventory, and performance gates remain required.

Ownership unit coverage invalidates pending fragments for changed account, logout, role, access, navigation, source generation, proof, filters, search, and visibility. The release unit suite contains 972 tests.

The final focused run passed all 16 checks across Android Chromium, iPhone WebKit, tablet WebKit, and desktop Chromium in 193 seconds; all 972 release unit checks passed. One local Android completion sample measured 3,797 ms from Drive navigation to all 1,561 cards on cold entry (including the intentionally held later page), and 1,813 ms on return. Cold/repeat samples were 6,439/4,025 ms on iPhone, 7,641/5,896 ms on tablet, and 3,345/1,974 ms on desktop. Every return performed zero new inventory requests. These are controlled fixture samples, not production latency promises or a valid speed comparison with the incomplete historical list. Every browser profile emits complete-list timing and request evidence in its JSON report.

## Release discipline

One isolated repair branch from d64035a91ce9bbd549c4d7bebea76236e054dd33, one release owner, and one bounded independent reviewer. Target version markers are V2026.09.13.03. Fresh compiled focused checks precede full candidate validation. Promotion requires the exact passing commit; main validation, sealed deployment, exact-live verification, hosted canaries, and production authentication health remain mandatory. No production completion is implied by this source record.
