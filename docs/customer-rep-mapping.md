# Customer and consignee mapping

## Source and ownership

`public.ph_customer_consignee_sales_reps` remains the customer/consignee directory used by Request and existing credit identity readers. External customer and consignee IDs distinguish identical display names. `raw_data` retains the complete source record, including fields not in the existing explicit schema.

In **Managers → Customer Assignments**, active Admin, Administrator and Manager profiles can filter, sort, page and assign a sales rep to a customer/consignee pair. The directory loads 50 rows at a time. A prefetched, locally searchable picker pairs each external rep ID with its canonical First Last name. External customer and consignee IDs are read-only. Existing customer/consignee name corrections remain available. A conflict preserves the draft and requires review. Raw source/contact details remain limited to the authorized management reader.

An assignment saves a persistent manager override keyed by the external customer and consignee IDs. Later imports continue to update source fields and status, but retain that assignment even when the imported row ID changes. Overrides remain dormant if a pair disappears and apply again if it returns; inactive pairs stay unavailable for new Requests. Name corrections retain their existing import-replacement behavior. The source label distinguishes **Imported** and **Manager override**.

**Reset to imported assignment** previews the latest imported rep and asks for confirmation. It deletes the override and restores import control. Existing `S99` / `Interdivision` assignments remain visible and can be restored by reset; they are not selectable as new assignments. Ordinary assignment requires an unambiguous canonical rep ID/name, with no comma-order names or email addresses.

The private source snapshot, overrides, and request receipts are accessible only through the existing protected backend. Assignment and reset require the current row revision and a request UUID. Exact retries replay the stored success result; changing a payload while reusing its UUID is rejected. Legacy rep corrections receive the same canonical validation. The existing manager role checks, RLS, and Request membership checks remain authoritative.

## Manual import

Run `runCustomerRepMapOnly()` from the existing Apps Script project after the cloud release deploys the database and `Code.gs`.

- Source parent: `1S4OTJVC8rpVNfuuEv2A0lHq-xFdjydBI` (Consignee List).
- Pending child: `13zlcdCp_nc_j2GGKxkB5Nrko4G-MWaYl` (Pending Consignee List).
- Archive: `1lXgfgChixjodh_zDvofmMnXUBPiO4epV` (Processed Consignee List).

The importer selects the newest eligible snapshot from the two source locations. It recognizes report preambles and CSV/Excel headers, preserves displayed identifiers and UTF-8 text, and rejects empty snapshots, missing required headers and duplicate identities before publishing anything. Inactive or unassigned records are retained for management; they are not selectable for new Requests.

Rows stage in bounded chunks of 300 and each Apps Script invocation stops staging after its 180-second budget. The next manual-sync trigger repeats source validation and resumes at the cumulative staged-row cursor returned by the database; the same stage remains active until every row is staged. Row timestamps use the Drive source revision time so replayed chunks are deterministic. The database validates and atomically publishes the complete snapshot, including removal of relationships absent from that snapshot, under the dataset revision fence. Failed runs leave the published directory intact. Only the file whose publication was confirmed moves to Archive; older or rejected files remain available for review. The importer does not delete `TEMP_`-named files from either source folder; its Excel conversion helper cleans up only temporary files it created itself.

If a source is rejected, it stays in place and is reported as skipped on later runs until its Drive modification timestamp changes. If an older pending file is encountered after a newer snapshot has already published, the database marks it stale; the importer reports and leaves it pending rather than replacing newer data. If publication succeeds but Drive archiving fails, the next run sends the same source file ID, modification timestamp and content hash. The server recognizes that exact published snapshot and lets the importer retry only the archive move.

The SQL finalizer owns the atomic dataset revision fence. Apps Script holds its import lock across source selection, staging, finalization and archive handling, but does not start a second revision fence. Staging uses bounded 300-row RPC calls and exposes no partial rows to readers. A continuation status reports staged/expected rows and queues the same manual-sync stage again; it does not mark the stage complete or archive the source. Publication replaces the private source snapshot and overlays manager assignments in the same transaction, retaining the existing 55-second timeout. Multiple source rows for an overridden customer/consignee pair reject publication atomically; other source relationships retain their existing behavior.

## Request contract

New submissions require an active customer and consignee relationship for the selected rep. The picker carries external IDs, limits consignees to the selected customer, and clears invalid selections after mapping changes. Reserve-derived suggestions, static exceptions and custom typed names cannot bypass this rule. Existing rep ownership and Request permissions still apply.

The live picker reads complete, revision-consistent pages through the protected `customer-rep-map` options operation with an exact `salesrepId`. Rep option merging retains the external ID. Partial names do not resolve an identity. Duplicate customer and consignee names remain separate by their external IDs, and obsolete reads cannot replace a newer selection.

New Request rows retain `request_selected_salesrep_id`. The server validates the complete active rep/customer/consignee tuple and checks rep account ownership through `sales_private.rep_identities` and its existing profile foreign key. Legacy requests remain readable; legacy submissions receive an external ID only when their selected relationship resolves unambiguously. External rep IDs remain text, including leading zeros.

The server revalidates membership at submission. Existing queued requests and saved snapshots remain readable and deliverable. If a mapping becomes inactive or unavailable, users correct/reselect it before making a new submission; no fallback silently invents a relationship.

## Validation and release

Focused Node/DOM, Edge-validator, and disposable-database SQL tests cover parsing, publication, permissions, stale edits, retry replay, assignment persistence/reset, duplicate names, Request membership and editor behavior. Browser, layout, timing and performance checks remain in Nightly Validation. The migration is registered in the existing backend release list; frontend and backend publication remain independent. New private tables and JSON operation fields preserve the existing public RPC signature and public table shape.
