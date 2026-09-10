# Request camera and completion repair

## Scope

Client-only follow-up to the compact inventory list release. Preserve Request
permissions, completion requirements, protected upload/save operations, and email
contracts. No migration, historical repair, automatic Request completion, or email
resend is included.

## Reproduction

The reported recording shows an existing Request accepting text entry, then
rejecting the camera result with `Restricted / You cannot update this row`.
Mark Done subsequently reports `Photo Required` because the photo was rejected.

The exact-detail loader binds verification to a detached Request object. Request
autosave resolves the canonical object before its permission check, losing that
object-bound proof. Both upload and completion checks can therefore fail before
any protected Request write. A native-camera foreground return can independently
make current-data verification temporarily pending; that is not a role denial.

Request autosaves also update linked master evidence transactionally. Continuation
after that own save must verify the actual canonical acknowledgement and preserve
the separate draft; it must not approve arbitrary concurrent master changes.

A Request live-view refresh omits master `SOURCE`. Recover only that omitted
identity from a currently verified exact master after matching Request ID, linked
master, item, location, lot and container. Reject supplied conflicting identities;
transfer the existing frozen proof rather than creating a new revision fence.
Establish that same identity before initially binding the editor, so opening
before the list enrichment finishes does not create a different reviewed identity.

After upload HTTP returns, verify the same owner and current row again before
publishing any local photo or scheduling its save. Retain a rejected File and
uploaded URL; an explicit permitted retry reuses that URL without another upload.

## Verification record

- Read-only production checks confirmed the affected account retains existing
  Request-work authorization and the deployed upload handler permits `req-`.
- The previous latency release `V2026.09.10.02`, commit `1cac09fd`, completed its
  exact-live check and all hosted post-deployment canaries successfully. That
  release success did not prove this newly reported camera workflow was working.
- New proof-transfer tests exercise the real coordinator and detail store, not a
  blanket editing-permission stub, including failure-first initial and refreshed
  native SOURCE omission and unchanged-check camera capture cases.
- A new compiled-shell browser regression is included in the existing verified
  cache lane. It exercises native-session bootstrap, projected list and exact-row
  reads, Request autosave, camera return, protected upload, and completion.
- The previous `.02` compiled shell reproduced the permission failure with actual
  permission checks and a ready exact-detail store. Initial focused runs exposed
  additional capture and canonical-refresh races; their traces were retained.
  The final `.03` source passes all seven focused Chromium cases, including the
  formerly intermittent offline retry. Seven compiled cases cover complete
  note/photo/completion, hidden camera return during acknowledgement, unchanged
  background checks, stale-data rejection, denied permission, retained offline
  selection and late stale upload responses.
- Local Windows WebKit cannot persist any Blob or File in IndexedDB, including a
  standalone native file-input fixture. It reports `UnknownError: Error preparing
  Blob/File data to be stored in object store`; ordinary JSON succeeds. This is
  recorded as a local test limitation, not a passing iPhone test. The unchanged
  photo-persistence assertions must pass in hosted Linux WebKit before promotion.
- Inline validation and the production v2 build pass. No production Request was
  completed, retried, or modified during verification; delivery was not invoked.

Final candidate, browser results, and exact-live verification must be recorded
before describing this repair as live.
