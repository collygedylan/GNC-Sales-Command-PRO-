# Supabase v2 compatibility cleanup - V2026.08.16.12

Completed: 2026-08-16 (America/Chicago)

## Result

- `v2_` objects before: `72`
- Physical `v2_` tables before: `0`
- Materialized `v2_` views before: `0`
- Ordinary `v2_` compatibility views before: `72`
- `v2_` objects after: `0`
- Rows deleted: `0`
- Storage objects deleted: `0`
- Relation storage removed: `0` bytes
- Current canonical `ph_` tables: `74`
- Current canonical `ph_` views: `12`
- Current Postgres size: `7,266,544,787` bytes

The eye icons shown in Supabase Table Editor identified views, not stored
tables. The aliases queried the existing `ph_` relations and did not contain a
second copy of any row. Removing them cleans the API schema and Table Editor,
but it does not reduce database or Storage billing.

## Why the aliases existed

Migration `20260802173907_rename_v2_to_ph_compatibility_views` created the
aliases temporarily for cached clients and older deployed functions after the
canonical relations were renamed from `v2_` to `ph_`. The live app and Google
Apps Script integrations now use `ph_` names.

Two deployed functions still contained old relation names. They were updated
before the views were retired, with no workflow or response-shape change:

- `notify-chat`: version `8` to `9`
- `inventory-assistant`: version `10` to `11`

Post-deployment source verification found no remaining `v2_` reference in
either function.

## Safety and rollback

- Database dependencies on the compatibility views: `0`
- `v2_` requests observed in the available API logs: `0`
- Every view was dropped with `DROP VIEW ... RESTRICT`.
- No `CASCADE` operation was used.
- The migration required exactly 72 ordinary views and zero physical `v2_`
  objects; any mismatch would abort the transaction.
- Production migration:
  `20260817003458_retire_v2_compatibility_views`
- The original compatibility-view migration remains the rollback definition:
  `20260802173907_rename_v2_to_ph_compatibility_views`

## What remains in Table Editor

The remaining `ph_` entries are the canonical production tables and views.
They are not duplicates of the retired `v2_` aliases. The 12 exact-empty
tables retained by the earlier cleanup are documented in
`docs/supabase-cleanup-V2026.08.16.11.md`; each remains connected to a live or
scheduled workflow.
