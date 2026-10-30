# AgData v2.3.112 code-health remediation

Cross-layer blast radius: frontend diagnostics, canonical read-map indexing, active-view scheduling and classic-script source layout. Code.gs delivery routes, SQL/RPCs, app-api business authorization, browser PostgREST and trigger contracts are unchanged. App-api release constants and the app-version setting are the only backend publication changes. No new startup reads, tables, RPCs or recipient paths were introduced.

## Measured comparison

| Measure | Stage 1 | After remediation |
|---|---:|---:|
| index.html lines | 2997 | 2911 |
| Main runtime lines | 173261 | 168379 |
| Function declarations (audit scope) | 16817 | 16824 |
| Window assignments (audit scope) | 462 | 463 |
| Top-level mutable bindings (audit scope) | 3530 | 3532 |
| Potential silent catches | 847 | 653 |
| Empty catch blocks (audit scope) | 471 | 118 |
| Core runtime/fragment/coordinator/hydrator empty catches | not separately recorded | 0 |
| Repeated listener keys (static candidates) | 84 | 84 |
| Parse diagnostics | 0 | 0 |

The unchanged audit algorithm measures linked and historical assets (137 files after extraction, 133 before); these totals are static candidates, not runtime execution counts. The preserved baseline is .gnc-local/it-baseline.json; the rerunnable analyzer now writes .gnc-local/it-after.json by default, or an explicit destination argument, so it cannot overwrite the baseline by default. Extraction does not delete business functions. The added namespace and diagnostic functions explain the small net increase in declarations/global indexing; no reduction of all globals or all duplicate bodies is claimed.

## Six findings and outcomes

1. **Dead declarations and unreachable code:** all 458 baseline candidates were checked against exact identifier occurrences across tracked source, tests, scripts and architecture documentation, including string contents. Two identifiers occurred once; one was an arrow binding outside the strict function-declaration rule and was retained. The private, unexported requestCalendarDay declaration was removed. Seventeen expression statements after unconditional return/throw in their own AST block were removed; declaration bindings and reachable dynamic handlers remain intact.
2. **Duplicate helpers and dispersed state:** normalizeDriveColumnFilterKey delegates to normalizeDriveEvidenceLocationPart and normalizeExcelFilterSearchTerm delegates to normalizeSessionIdentity with identical input semantics. Existing function signatures and aliases remain. AgDataKernel indexes canonical state, sync, watchdog and metrics; its inFlightReadsByKey is the existing identity/query/generation-scoped map, not a competing dataset cache. Broader duplicate-body and listener candidates remain review items, not evidence of redundant runtime work.
3. **Silent errors:** core empty catches now call an allowlisted token-only reporter or an explicit capability-probe marker. reportHandledRuntimeIssue retains only timestamp, version, scope, errorCode, clusterId, owningSkill and fingerprint, uses immutable snapshots, caps its ring at 100 and deduplicates version/scope/fingerprint. Arbitrary messages, stacks and metadata are rejected. Legacy nonempty handlers and historical assets remain outside the empty-catch rewrite.
4. **Repeated reads, unchanged revisions and rendering:** seven operational dataset keys share canonical in-flight promises; account/generation fences reject late responses. Unchanged context/revision signatures suppress repeated revision callbacks while row-delta signals remain actionable. Active-view renders coalesce to one callback per microtask, hidden views remain dirty, and navigation/auth reset discards pending closures. Existing typing, draft and last-known-good protections remain.
5. **Monolithic source:** 213 Bloom declarations (4,862 lines) moved to assets/bloom-runtime-functions.js in classic global scope; composition restores them at the original marker for semantic tests and the built bundle. Reclass workspace and prepaint CSS moved to external source files; the build restores their exact original cascade positions. Development fragment tags are removed from the built shell so declarations execute once. Source budgets lock the raw runtime below 168,420 lines and 8,966 declarations, index.html below 2,920 lines, and core empty catches at zero.
6. **Governance and proof:** symbol ownership, dependency map, skills, service worker, composition readers and version surfaces are synchronized. Golden invariants 205–207 exercise promise sharing and owner rejection, unchanged revisions, and render coalescing/navigation/reset. Watchdog tests verify sensitive inputs are absent, deduplication, boundedness and immutable snapshots. No application permissions, email recipients, published row identity, Home tiles or operational route contracts were relaxed.

## Verified local checks

- Final tooling gate: 316 passed, zero failed/cancelled/skipped; 21.1 seconds in the runner (21.25 seconds wall clock).
- Focused architecture, code-health, watchdog, sync and golden run: 349 cases; initial source-layout/version/fixture mismatches were corrected, and the affected three files passed on recheck (8.95 seconds); the remaining focused files had passed initially.
- Final inline check and in-place release build: both passed, 4.74 seconds combined wall clock.
- app-api Deno type check: passed, 6.43 seconds. Targets are budgets, not claimed measured guarantees.
- Final audit: zero parse diagnostics. No test emails, historical backfill, schema changes or live fault injection.

Production publication and authenticated 390×844 browser results are recorded in the release evidence directory and .gnc-local/latest-state.md after delivery. Local checks alone do not certify the live DOM or all eleven domains on every device.
