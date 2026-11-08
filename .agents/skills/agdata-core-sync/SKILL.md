---
name: agdata-core-sync
description: Maintain AgData authentication, cache-first boot, five-stage live sync, Supabase data access, quota controls, and database hygiene. Use for src/core changes or cross-layer sync/read-continuity work; do not use for DOM presentation or release publication alone.
---

# AgData Core Sync

Own src/core and the state/read side of the live Supabase project
kzrnyjsosryejjejliii. Read the repository AGENTS.md, latest state, symbol index,
and relevant source skill before changing behavior.

## Decisions this skill owns

- Native-auth identity, account/permission epochs, stale-while-revalidate
  caches, bounded snapshot hydration, and fail-open same-account reads.
- DRIVE, CAV, RESERVES, SOC, and HL PO stage state, resumable publication,
  revision signals, and protected READY/LKG data.
- Supabase read contracts, quota/egress controls, retention helpers,
  autovacuum/index evidence, and bounded database maintenance.
- Capability and access matrices as server-authoritative state. UI visibility
  never grants mutation authority.

## Invariants

- Use only project kzrnyjsosryejjejliii. Never revive the retired sandbox.
- An import, permission refresh, or transient failure cannot blank an
  authenticated view or discard same-account data.
- Browser reads, Apps Script, app-api, and Postgres functions/triggers retain
  their independent authorization and performance boundaries.
- Database tuning is evidence-led. Inspect installed pg_catalog state first;
  use online operations, bounded timeouts, and tracked migrations. Preserve
  business, inventory, weather/GDD, evaluation, receipt, and photo history.
- src/core modules stay below 400 physical lines; changed functions stay at or
  below 60 lines with nesting no deeper than three.

## Working boundary

Keep core modules free of DOM rendering and raw UI event handling. Publish
explicit state and receipts for src/views and src/ui consumers. Delegate
canonical row/evaluation math to agdata-canonical-engine and external
transport/publication work to agdata-services-release.

## Verification

Choose focused tests from live-sync-coordinator, live-sync-registry-coverage,
master-snapshot-chunk-import, security-zero-trust, Supabase quota security,
and the affected auth/cache tests. SQL changes require installed-state
inspection plus an isolated or rolled-back behavioral check.

The complete 21-to-5 migration and cross-layer checklist is in
docs/gemini-clean-gems-blueprint.md.
