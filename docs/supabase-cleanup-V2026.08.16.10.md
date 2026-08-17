# Supabase cleanup report — V2026.08.16.10

Completed: 2026-08-16 (America/Chicago)

## Rollback protection

- Application source tag: `rollback-pre-cleanup-V2026.08.16.09`
- Pre-cleanup commit: `d884210`
- Supabase physical backup: `1389891049`
- Drive Around source reports remain in Google Drive and can rebuild the derived row index.

Supabase physical backups cover Postgres but not Storage objects. No Storage
objects were deleted in this release.

## Drive Around compaction

- Original source rows represented by the verified file manifest: `7,677,715`
- Retained rows dated 2025-08-16 or newer: `4,153,996`
- Net old derived rows removed from the active database: `3,523,719`
- Retained source files with indexed rows: `491`
- Bidirectional source/shadow row-hash parity: passed
- Duplicated `raw` JSON column: removed from the active base table
- Compatibility view: retained with all 24 legacy fields
- RLS policies: retained
- classification/update triggers: retained and transactionally smoke-tested

The removed pre-cleanup relation occupied:

- Table heap: `14,819,581,952` bytes
- Indexes: `7,300,530,176` bytes
- Total: `22,124,208,128` bytes

The replacement active Drive Around relation occupies `2,525,569,024` bytes.
The complete Postgres database now occupies `7,271,943,315` bytes
(`pg_size_pretty`: `6935 MB`).

## Deliberately retained

- `ph_hold_stop_itemcode_snapshots`: retained at `2,706,022,400` bytes so
  historical learning remains available.
- The hourly full-history rebuild is paused because rebuilding from the
  one-year hot row table would erase older learning. Weather and profile
  enrichment continue.
- `ph_app_live_events`: retained pending its required direct-Realtime parity
  period.
- Unused-table candidates: retained because they do not materially reduce disk
  usage and some have data or dependencies.

## Storage

- Objects deleted: `0`
- Bytes deleted: `0`
- Current Storage inventory: `18,240` objects / `47,596,071,402` bytes

Photo deletion remains protected by the Google Drive archive, two reference
scans at least 24 hours apart, and the 30-day quarantine. This database cleanup
does not bypass that protection.

## Deployment

- Backend cleanup release: `V2026.08.16.10-backend-cleanup`
- User-facing shell remains `V2026.08.16.09`; no UI or workflow regression was
  introduced.
- Apps Script importer deployment: passed
- GitHub Pages deployment: passed
- Pilot tests: 48/48 passed
- Database migrations, pgTAP/RLS tests, and Edge Function tests: passed
