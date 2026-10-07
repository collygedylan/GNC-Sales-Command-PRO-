# Assigned Items virtualization

The Assigned Items view lazy-loads `components/assigned-items/AssignedItems.jsx` through the existing release asset pipeline. Phones use cards; desktop uses a table. Both share the complete filtered dataset with exports and bulk actions.

Each mounted inventory row has an Itemcode Default Owner control. Drafts, pending commands, errors, and confirmed defaults are shared by normalized itemcode. Effective owners and Zoe/Mitch override badges use the server assignment reason. The backend contract and ownership policy are unchanged.

TanStack Virtual mounts the viewport with two buffered entries on either side and at most one additional focused row. Exact inventory IDs provide stable keys. Measurements support wrapping and expanded details. The main scrolling area is retained; refreshes update the mounted root. Navigation and sign-out dispose listeners, observers, and the root.

## Local measurements

One matched Chromium run on October 6, 2026 used the same browser session, 1440 × 1000 viewport, 10,000 synthetic inventory rows, 5,000 distinct itemcodes, permissions, and fixed scroll container. The previous renderer came from base commit `60609f8a`. The measurement starts with normalized rows and ends after two animation frames following insertion/mount, including layout; the new measurement includes its first module import. No production backend was contacted.

| Measurement | Previous full-list renderer | Virtualized renderer |
|---|---:|---:|
| Initial render | 19,116 ms | 286 ms |
| Initial inventory DOM rows | 10,000 | 14 |
| Initial DOM elements inside host | 310,075 | 765 |
| Scroll update, four sampled positions | 428–670 ms | 69–95 ms |

These are single-run development measurements, not a production latency guarantee. Both versions used the source dev server and existing local stylesheet. A separate stress fixture passed with 25,000 logical rows, 14 initially mounted rows, access to the final record, and zero display-normalization calls while scrolling. Its transform-plus-mount measurement was 244 ms; it is a separate fixture and should not be compared directly with the table above.

## Validation

- Focused unit/component checks cover memoization, bounded shell output, sibling controls, retained edits, duplicate/retried commands, concurrent saves, account changes, focus, layout observers, and release assets.
- Browser coverage checks responsive cards/table, complete search/export semantics, filters, low-stock editing, override badges, and 10,000/25,000-row virtualization.
- Local source-adapter browser checks passed for responsive rendering, complete-list search, and stress scrolling. Focused checks against the downloaded cloud-built artifact also passed for filters/export/sorting, perennial overrides and exact-row resolution, and 25,000-row scrolling after the first CI repair. The earlier source-adapter resolver failure did not reproduce against the compiled artifact.
- The first CI run caught toolbar state retained while an action button held focus; refresh deferral now applies only to editable fields. Its scroll fixture now makes up to four bounded bottom-scroll attempts as variable-height measurements settle, retaining final-record, bounded-DOM, and no-recomputation assertions.
- The second CI run caught a retained toolbar after Assigned Items viewing permission was removed. The shell now explicitly disposes the React view and permits the restricted-access screen to replace it; the original permission-loss browser assertion remains.
- The Android navigation check exposed a queued anchor restoration overwriting a newer scroll. A queued list update now yields when the scroll position or scroll-event revision changes. Returning to Assigned Items also takes precedence over the general renderer's outgoing-page scroll restore. Focused regressions cover both paths; the browser's nonzero-scroll and exact back-navigation assertions remain intact.
- The required cloud release suites remain the publication gate. No tests are skipped or quarantined.
