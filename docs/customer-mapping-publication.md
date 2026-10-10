# Customer mapping publication hotfix

The full mapping import replaces the published directory atomically. Its finalizer can upsert and prune roughly 14,645 rows in one PostgREST call. The Data API role's inherited statement timeout is 8 seconds, so a larger publication could be cancelled and rolled back while the older mapping revision remained visible. That left newly active reps, including Molly Dixon, with no selectable customer relationships.

The hotfix sets `statement_timeout = '55s'` on `public.finalize_customer_rep_mapping_import_v1(uuid)` only. This remains below PostgREST's 60-second request ceiling. It does not raise role-wide timeouts or change the importer, staging, publication transaction, or unrelated RPCs.

## Reproduce the HTTP regression

Run the canonical database gate from the repository root:

```sh
node scripts/database-check.mjs --all
```

The discovered `supabase/ci/customer_rep_mapping_http.mjs` driver builds a synthetic 14,645-row, 122-column source and publishes it through PostgREST in a verified disposable Supabase workspace. It applies an 8-second authenticator default and adds a one-time 9-second publication delay. The first HTTP finalization must cancel with no partial row or revision change. The same run is then finalized with the function-level 55-second limit; the check verifies atomic visibility, stale-row removal, the 119-customer/149-relationship Molly mapping, and idempotent replay. The disposable workspace is destroyed by the database-check runner even if the test fails.
