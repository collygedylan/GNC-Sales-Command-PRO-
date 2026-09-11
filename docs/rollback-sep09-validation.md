# September 9 client behavior validation

Release V2026.09.11.03 restores client behavior from 9a29cbe6dbc043a624ffdb6693ea160568a0da34, with the latest HL Order retained. This intentionally removes the later compact inventory/exact-detail, session recovery, Request proof/camera recovery, AV Blanks filter/Reclass, and AssignedTo-review client changes. Backend, database, HL Order, email delivery, invoice synchronization and release infrastructure tests remain current.

No unit, browser, build, or CI commands were executed while making this compatibility change. This document records coverage routing, not a passing result.

## Unit coverage

The three existing release product scripts use their complete September 9 file sets and original assertions. Current workflow-source readers and compiled-shell fixtures remain where needed for the current release infrastructure. Added backend, HL Order and release safety tests remain in the explicit runner. The release coverage manifest additionally fixes each complete September 9 script file set and compares copied browser bodies and complete fixtures with their preserved source suites. Active Dylan HL Home visibility, disabled-profile denial and account-switch denial are also covered. The release artifact seals, exact-commit gate, browser matrices, assertion thresholds and workflow jobs are unchanged.

The following later-only client suites were removed because their production contracts were deliberately rolled back. Their applicable original protections are exercised by the preserved live-sync, access-control, Request-completion, Request-option, Drive-evidence, photo-egress/history, Reclass, Eval Work and service-worker suites. This does not claim that the September 9 product implements the removed protections.

- tests/detail-hydration-draft.test.mjs
- tests/drive-photo-save-recovery.test.mjs
- tests/eval-report2-header-filters.test.mjs
- tests/inventory-list-contract.test.mjs
- tests/inventory-list-read-fixture.test.mjs
- tests/live-sync-owned-master-copy.test.mjs
- tests/login-home-bootstrap.test.mjs
- tests/login-photo-shell.test.mjs
- tests/master-detail-snapshots.test.mjs
- tests/master-list-staging.test.mjs
- tests/request-commit-verification.test.mjs
- tests/request-detail-proof.test.mjs
- tests/request-entry-source.test.mjs
- tests/request-on-hand-calculation.test.mjs
- tests/session-recovery-ui.test.mjs
- tests/session-recovery.test.mjs
- tests/session-shell-recovery.test.mjs
- tests/task-av-blanks-membership.test.mjs
- tests/task-av-blanks-reclass.test.mjs
- tests/verified-data-cache-integration.test.mjs

## Browser coverage routing

Every current browser lane and project remains enabled. Replacement files contain complete executable September 9 test bodies or the complete original fixture, with no skipped tests, empty wrappers, weakened assertions or dummy implementations. Some baseline scenarios intentionally execute in additional matrix lanes so existing desktop/mobile coverage remains present.

### tests/login-photo-repair.e2e.spec.ts

- tests/responsive-workflows.e2e.spec.ts: phone login keeps both fields and the submit action visible
- tests/responsive-workflows.e2e.spec.ts: Kayla receives standard Admin Request, Drive, and photo access
- tests/responsive-workflows.e2e.spec.ts: Request AV sheet preserves swipe intent before selecting a later option
- tests/photo-egress.e2e.spec.ts: both original photo URL and bounded encoding cases, including their original setup.

### tests/eval-report2-header-filters.e2e.spec.ts

- tests/responsive-workflows.e2e.spec.ts: Eval Reports #2 uses real checkbox clicks and preserves whole-ITEMCODE selection in the flat view
- tests/responsive-workflows.e2e.spec.ts: Eval Reports #2 verifies a named user against current assignments before showing cards
- tests/responsive-workflows.e2e.spec.ts: Eval Reports #2 manager search refreshes while the search field remains active

### tests/request-entry-source.e2e.spec.ts

- tests/responsive-workflows.e2e.spec.ts: Request rep selection always renders customer choices or a recoverable error state
- tests/responsive-workflows.e2e.spec.ts: Queue tab changes load only the canonical datasets needed by that tab
- tests/responsive-workflows.e2e.spec.ts: iPhone Request Queue renders all 19 rows instead of only the first adaptive chunk

### tests/request-on-hand-calculation.e2e.spec.ts

- tests/responsive-workflows.e2e.spec.ts: Request quantity and spec fields stay high-contrast and responsive on phones
- tests/responsive-workflows.e2e.spec.ts: Request reusable evidence prompt accepts partial exact-row data without auto-completing

### tests/request-photo-completion.e2e.spec.ts

- tests/responsive-workflows.e2e.spec.ts: Kayla receives standard Admin Request, Drive, and photo access
- tests/responsive-workflows.e2e.spec.ts: phone Request detail uses natural scrolling, a photo rail, a scrollable AV sheet, and a persistent Mark Done tray
- tests/responsive-workflows.e2e.spec.ts: Request AV sheet preserves swipe intent before selecting a later option
- tests/responsive-workflows.e2e.spec.ts: Request reusable evidence prompt accepts partial exact-row data without auto-completing
- tests/photo-egress.e2e.spec.ts: both original photo URL and bounded encoding cases, including their original setup.

### tests/review-assignedto.e2e.spec.ts

- tests/eval-work.e2e.spec.ts: Reclass Send as Review uses the searchable multi-evaluator Eval roster on phones
- tests/responsive-workflows.e2e.spec.ts: Eval assignment dropdown exposes the full managed roster and composite key
- tests/responsive-workflows.e2e.spec.ts: Phone Drive Reclass skips the recipient picker and strips browser recipient fields

### tests/task-av-blanks.e2e.spec.ts

- tests/sales-marketing-tasks.e2e.spec.ts: Complete preserved fixture and all assertions

### tests/session-recovery.e2e.spec.ts

- tests/home-role-visibility.e2e.spec.ts: Complete preserved fixture and all assertions

### tests/verified-data-cache.e2e.spec.ts

- tests/docks-filter.e2e.spec.ts: Complete preserved fixture and all assertions

## Scope limits

The old cache lane now tests the September 9 full-row shared-coordinator cache, import races, reconnects, saved local choices, draft retention and identity/query scope changes; it does not assert the removed compact-wire size or exact-detail contracts. The session lane tests original account transitions, role/module denials, and Request loading/retry; it does not assert the removed network-outage authentication recovery design. The Request lanes retain original creation, queue, quantities/specs, reusable evidence, photo handling, completion-tray and focused-draft coverage; they do not assert the removed immutable detail-proof and durable camera-file recovery design. The AV Blanks and Review lanes use original assignment/role and manual multi-evaluator behavior.
