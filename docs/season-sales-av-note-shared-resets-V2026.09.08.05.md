# Season Sales Office AV Note shared resets — V2026.09.08.05

Saved Season Sales Office AV Notes survive CAV-text-only imports, but now clear when the existing shared photo/spec bundle rules reset the inventory evidence: age over ten days, depleted matched quantity, priority changes, hold/stop changes, or explicit Clear Data. Missing/unverified photos and photo-only removal with Keep Data do not independently clear a saved note.

The database records actual reset epochs, updates the retained note and open mirror, increments the state revision, and records an audit event. Reconciliation handles resets deferred by an active lifecycle operation. A newly saved note after a reset remains valid; later photo/spec updates cannot revive an older retained note. Capture reads lock the source master row and use actual capture time. Done history and completion fields remain intact; existing reconciliation owns reopening decisions.

The browser preserves authoritative blank values for Season snapshots, refreshes an open detail view from current state revisions, and no longer copies old Season snapshots back into master inventory or creates fresh evidence timestamps while reading them. Explicit Clear Data records the same reset marker used by the shared database rules.

## Historical recovery correction

The user explicitly chose to apply these rules to recovered notes and future changes. All 103 notes recovered in batch `season-av-note-recovery-20260909-103` were older than the shared validity window or already reset. A guarded, rehearsed transaction cleared their active fields and retained their original text and source history. Correction batch: `season-av-note-shared-rules-20260909`; audit reason: `historical_shared_av_rule_reset`. Existing unrelated notes and master evidence were not rewritten.

## Validation

- 73 isolated PostgreSQL behavioral assertions across retention and shared resets, plus four migration-backfill cases.
- Installed capture function verified to lock the source master with FOR SHARE.
- A regression using a real reset followed by a protected save fails when the capture timestamp is changed back to transaction-start time.
- Focused browser-state tests cover authoritative nulls, stale snapshot prevention, live refreshes, and Clear Data.
- Release validation includes the full pilot/photo tests, inline syntax checks, Android/iPhone Season Sales Office browser tests, and production workflow checks.

Migration: `20260909004018_align_season_sales_av_note_shared_resets.sql`. Local PostgreSQL WASM tests do not simulate concurrent connections; lock ordering was separately reviewed, and hosted CI runs the migration and pgTAP suite against isolated native PostgreSQL.
