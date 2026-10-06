# Reclass split inquiries: approved audit behavior

## Decision

Preserve the existing Requested audit trigger. Each accepted inquiry records its ordered split quantities, destination seasons, per-action hold choices, and hold reasons in the Requested history snapshot. This supersedes the earlier plan to leave all inventory history unchanged.

## Transaction boundaries

- Validate the complete request before committing the inquiry outbox and its Requested audit.
- Retain the existing protected enqueue trigger; do not create Applied transactions, destination inventory rows, or inventory quantity/status changes.
- Preserve the original V4 proposals when invoking the legacy enqueue so the trigger snapshots every split and hold reason. The legacy projection is used for validation only.
- Identical retries reuse the original inquiry and audit. A reused token with changed content conflicts.
- Rejected requests roll back the provisional outbox and Requested audit together.
- Retain legacy queued inquiries and contracts.

## Verification

The disposable SQL suite checks Requested audit contents, retry deduplication, rollback, and unchanged inventory. Browser coverage checks split editing, combined On Hand limits, hold reasons, failed-submit retention, and restored drafts. HTML/plain-text/PDF fixtures preserve split order and hold details. Local Chromium PDF rendering does not establish Google Apps Script conversion success; report real conversion separately.
