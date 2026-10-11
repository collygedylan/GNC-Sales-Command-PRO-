# Customer and consignee mapping

## Source and ownership

`public.ph_customer_consignee_sales_reps` remains the customer/consignee directory used by Request and existing credit identity readers. External customer and consignee IDs distinguish identical display names. `raw_data` retains the complete source record, including fields not in the existing explicit schema.

In **Managers → Customer Mappings**, active Admin, Administrator and Manager profiles can filter, sort, page and correct the four mapping display/rep fields. External customer and consignee IDs are read-only. Save requires the current row revision; a conflict preserves the draft and requires review. The next successful master snapshot replaces manual corrections. Raw source/contact details are available only through the authorized management reader.

## Manual import

Run `runCustomerRepMapOnly()` from the existing Apps Script project after the cloud release deploys the database and `Code.gs`.

- Source parent: `1S4OTJVC8rpVNfuuEv2A0lHq-xFdjydBI` (Consignee List).
- Pending child: `13zlcdCp_nc_j2GGKxkB5Nrko4G-MWaYl` (Pending Consignee List).
- Archive: `1lXgfgChixjodh_zDvofmMnXUBPiO4epV` (Processed Consignee List).

The importer selects the newest eligible snapshot from the two source locations. It recognizes report preambles and CSV/Excel headers, preserves displayed identifiers and UTF-8 text, and rejects empty snapshots, missing required headers and duplicate identities before publishing anything. Inactive or unassigned records are retained for management; they are not selectable for new Requests.

Rows stage in bounded chunks of 300 and each Apps Script invocation stops staging after its 180-second budget. The next manual-sync trigger repeats source validation and resumes at the cumulative staged-row cursor returned by the database; the same stage remains active until every row is staged. Row timestamps use the Drive source revision time so replayed chunks are deterministic. The database validates and atomically publishes the complete snapshot, including removal of relationships absent from that snapshot, under the dataset revision fence. Failed runs leave the published directory intact. Only the file whose publication was confirmed moves to Archive; older or rejected files remain available for review. The importer does not delete `TEMP_`-named files from either source folder; its Excel conversion helper cleans up only temporary files it created itself.

If a source is rejected, it stays in place and is reported as skipped on later runs until its Drive modification timestamp changes. If an older pending file is encountered after a newer snapshot has already published, the database marks it stale; the importer reports and leaves it pending rather than replacing newer data. If publication succeeds but Drive archiving fails, the next run sends the same source file ID, modification timestamp and content hash. The server recognizes that exact published snapshot and lets the importer retry only the archive move.

The SQL finalizer owns the atomic dataset revision fence. Apps Script holds its import lock across source selection, staging, finalization and archive handling, but does not start a second revision fence. Staging uses bounded 300-row RPC calls and exposes no partial rows to readers. A continuation status reports staged/expected rows and queues the same manual-sync stage again; it does not mark the stage complete or archive the source.

## Request contract

New submissions require an active customer and consignee relationship for the selected rep. The picker carries external IDs, limits consignees to the selected customer, and clears invalid selections after mapping changes. Reserve-derived suggestions, static exceptions and custom typed names cannot bypass this rule. Existing rep ownership and Request permissions still apply.

The server revalidates membership at submission. Existing queued requests and saved snapshots remain readable and deliverable. If a mapping becomes inactive or unavailable, users correct/reselect it before making a new submission; no fallback silently invents a relationship.

## Validation and release

Conventional Node, Edge, SQL and Playwright tests cover parsing, publication, permissions, stale edits, duplicate names, Request membership and editor behavior. Database types and REST contracts are generated from the disposable Supabase migration chain. The existing release pipeline deploys the additive migration and backend before publishing the PWA and importer. No separate production write path or credentials are introduced.
