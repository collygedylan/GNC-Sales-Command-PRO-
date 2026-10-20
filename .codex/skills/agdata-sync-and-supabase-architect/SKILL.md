---
name: agdata-sync-and-supabase-architect
description: Maintain AgData Home sync status, Drive file freshness, RUN SCRIPT, snapshot imports and Supabase publication while preserving live data and paused backfills.
---

# Sync and Supabase architecture

- Home DRIVE, SOC, RESERVES and CAV status cards display the single active/latest filename for each source.
- RUN SCRIPT must detect unchanged Google Drive source metadata and return UP_TO_DATE on the fast path, targeting less than 500 ms. Ignore TEMP_* and ~$* files before choosing a source; temporary Warehouse Assigned Items exports cannot stall the stage.
- Use chunked set-based upserts with a 120s statement timeout for bulk work. This timeout is not an interactive-query allowance: ordinary interactive queries remain below 100 ms and the atomic 100-source Reclass batch remains at or below 1,000 ms.
- Use one bounded retry for a transient stage failure, then continue unrelated eligible stages without blocking the UI. Preserve resumable progress, protected live fields, idempotent retries and atomic snapshot publication.
- Reads continue from the latest completed READY snapshot while new staging is running, queued, timed out or interrupted. Never leave production datasets marked INTERRUPTED as test residue.
- Keep historical backfill paused when instructed. When separately authorized to run, enforce 23:30 inclusive to 06:15 exclusive America/Chicago in both scheduler and worker, including daylight-saving transitions. Never enable the paused 15-minute automation as part of routine sync work.

Use Supabase MCP for read-only schema/contract/log inspection and validated production migrations. Keep credentials in environment/secret stores. Test destructive SQL, trigger faults and rollback behavior in disposable local databases. Use the repository's PostgreSQL 17/Supabase harness for full compatibility; a PostgreSQL 15 lightweight sandbox is not equivalent. No live fault injection is authorized by this skill.

Measure new, changed, unchanged and retried snapshots when importer behavior changes. Register new RPC/background reads in the fixture allowlist and update this skill in the same commit.
