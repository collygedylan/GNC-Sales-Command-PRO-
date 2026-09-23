# Managers - Season Priority

This module is an inquiry shortcut, not an inventory editor. The office applies
the requested priorities in the source system; DriveAround imports the results.
Neither submit nor delivery writes inventory priorities or resets AV completion.

## Workflow

Managers and Administrators with Managers access and the Season Priority action
permission open **Managers > Season Priority**. Choose Assigned To (All or
Unassigned are available), then BLOCKALPHA and the full LOCATIONCODE. Search,
breadcrumbs and the normal mobile Back control retain the app's navigation.

The server selects the existing eligible Season Sales Notes winner first. Only
then does it filter priorities 2-4 and assignees. Completed AV work is included.
Priority 1 winners never cause an alternate row to be substituted.

**Make Priority 1** sends one protected Reclass inquiry for that ITEMCODE. For a
selected rank k, the selected row requests 1, and every other row at 1 through
k-1 requests its old priority plus one. Duplicate lower ranks all shift; missing,
invalid and unrelated ranks are not invented or renumbered. The scope spans all
locations and seasons. Email/PDF values explicitly describe requested changes.

An accepted card stays **Requested - awaiting import** with its delivery status.
Refresh and another manager's click find the existing pending request. A failed
delivery retries the original event, subject to current-state validation. No
automatic resend occurs after a conflicting import. A later completed import
that still contains the original priorities leaves the request pending. A full
match to the requested priorities permanently fulfills it; other changes require
fresh review. Reconciliation uses priority-independent lineage, not imported UID.

## Protected contract

The existing `drive_reclass_inquiry` API exposes `season_priority_list`,
`season_priority_state`, and `season_priority_submit`. Submit accepts sourceUid,
expectedPriority, scopeFingerprint and idempotencyToken only. The authenticated
profile, proposed rotation, recipients, coverage and audit are server-controlled.

The migration adds private receipts and service-only RPCs. Receipt, Reclass outbox
and requested-change audit are transactional. Active-request uniqueness and locks
cover concurrent clicks. Frozen V3 overlays carry expected priorities and stable
lineage; Apps Script validates every member before delivery. Existing manual V3
contracts do not require the new expectations and retain their prior behavior.

## Focused validation

- Prepare a complete local release site (including CSS, icons, fonts and v2)
  with the existing release build procedure, then run
  `npx playwright test --config playwright.season-priority.config.ts`.
  `npm run build:live` alone compiles the shell but does not copy static assets.
  Local dirty-tree builds are development checks, never sealed release evidence.
- `node --test tests/manager-season-priority-protected.test.mjs tests/season-priority-report.test.mjs tests/reclass-inquiry.test.mjs tests/drive-reclass-protected.test.mjs`
- The isolated database lane includes the Season Priority transaction tests and
  the two-connection `test-manager-season-priority-concurrency.mjs` fixture.
- `node scripts/render-season-priority-fixture.mjs` creates synthetic PDF/email
  previews under ignored `.gnc-local/season-priority-report`. It sends no email.

The candidate workflow includes the new compiled desktop, Android and iPhone
suite and report/backend tests. Production deployment remains compatibility-first:
validated database/API/report support, then the exact sealed frontend artifact.
Do not release while required Apps Script isolation/version verification is
blocked. Never bypass a failed gate or restore a prior database over business data.
