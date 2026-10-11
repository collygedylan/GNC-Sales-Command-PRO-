# Inventory cards and Que removal

## Inventory quantities

Live inventory cards use the shared quantity renderer, in this order: On Hand,
Review, Available, Open Stock, Loc Photo Match, Loc On Hand. Existing evidence
validity rules still control Loc Photo Match; removing the percentage from the
card does not change capture requirements.

Drive and AV share the compact identity/action header and three-column quantity
grid, followed by specifications, AV notes, Bloom Picker and a single hold-data
row (Code, Reason, Since). Source sits below Reclass; only Drive includes field
tag color. Existing AV photo/gallery controls and price semantics remain available.

Loc On Hand uses the complete master inventory cohort, indexed once alongside
the existing master indexes by normalized item code and location code. Item codes
remain strings, preserving leading zeros. Lots and sizes do not split the total.
Partial pages, incomplete field coverage, missing quantities, or unverified
native-session data display **Unknown**. The renderer does not issue an extra
inventory read or sum the visible filtered page. Master index rebuilds update
the totals after a confirmed change. Cross-tab master-row acknowledgments rebuild
the index when item, location, or on-hand quantity changes; unchanged and
photo-only acknowledgments avoid that extra sweep.

## Permanent removal from Que

Current pending-row controls call the authenticated `request_queue_remove`
app-api operation. The server derives the active profile and uses the existing
Request management permission. It calls `request_queue_remove_v1` with the exact
request UID, expected row version and update timestamp, and a UUID command key.

The transaction locks the row, rejects stale/completed/archived requests,
preserves an existing historical snapshot (or creates one for a legacy row),
deletes only the active request, and records a private idempotency receipt.
It does not delete inventory, change quantities, or archive the request. Existing
deletion triggers update dataset revisions and reconcile the remaining folder
membership; the deleted request is not marked completed. Previously delivered
emails and historical records remain intact.

The UI removes a row only after validating the confirmed receipt. Retries reuse
the same command and revision, with at most three attempts. A failure retains
the visible row and requests a refresh. In-memory tombstones are scoped to the
authenticated identity so an older read cannot reinsert a confirmed deletion.
Confirmation cancellation and identity changes cannot update the active UI.

The separate archive/restore API remains available for existing archived rows
and cached clients. Old queued archive commands retain their original meaning.
Rolling back the UI must retain the additive removal RPC and its private receipts;
deleted active rows are not automatically restored from historical snapshots.

## Validation

Conventionally discovered unit and browser tests exercise card scope and layout,
removal retries, revision conflicts, identity changes and legacy archive behavior.
The canonical PostgreSQL test runs with the real schema in the disposable SQL
gate. Generated database types and release migration contracts include the new
RPC. No production data is used in these tests.
