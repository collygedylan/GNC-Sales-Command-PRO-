# Daily import recovery

## October 8, 2026 incident

The five-minute Apps Script trigger was firing. The 07:30 America/Chicago
DriveAround workbook contained an empty worksheet, with neither headers nor data.
The importer rejected it before writes with `No recognized header row`. Because
DriveAround was the first stage of the shared job, that failure stopped the job
before the SOC and Reserves stages. The 07:30 Reserves workbook was also empty.
The files remained in their drop folders. File upload time alone did not establish
that business data had been imported.

Replace the empty exports with valid reports in their existing drop folders.
Do not manufacture inventory or treat a blank report as an empty nursery. Keep
rejected source files available for investigation; only confirmed committed
imports belong in the processed folders.

An unchanged rejected file must not be archived merely because a newer replacement
succeeds. Replace the original export or move the reviewed rejected source out of
the polling folder when recovery is confirmed; an invalid source left there will
continue to report a source-validation failure. A rejected newest file never
permits fallback to an older snapshot.

## Recovery checks

1. Confirm the guarded Apps Script deployment contains the hotfix commit.
2. Let the existing scheduled poll discover the source files. Check each stage's
   outcome; a partially failed job must not report complete success.
3. Compare source filenames, parsed identities and expected records with the
   committed Supabase data. User edits also advance `last_updated`, so that
   timestamp alone is insufficient evidence of an import.
4. Confirm successful datasets have ready import fences and advanced revisions.
   Verify the corresponding table sync events reach an already-open client that
   held yesterday's cache. Preserve local filters and unsaved editor state.
5. Confirm a subsequent scheduled poll completes without duplicate writes or
   an import left in progress.

Input validation failures are distinct from database, processor-lock and fence
failures. The latter retain fail-closed behavior. Header-only snapshots must be
rejected before deletion planning; a SOC report containing valid identities
whose records are all invoiced is a different, legitimate case.

GitHub Actions owns merge, backend-before-PWA publication and production release
verification. Record source-data recovery separately from a green deployment.
