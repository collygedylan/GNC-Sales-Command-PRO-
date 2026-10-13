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

Loc On Hand sums physical inventory rows by normalized item code and location
code across lots, sizes, and sales years. Item codes remain strings, preserving
leading zeros. Bounded inventory reads may carry a server aggregate with its
normalized pair and verified master revision, so cards can show the total before
the full master cohort finishes loading. If the server aggregate is absent, the
renderer can use a complete verified master snapshot; otherwise it displays
**Unknown**. Explicit nulls, pair mismatches, stale revisions, and unverified
native-session receipts display **Unknown** without falling back to a partial
snapshot. The renderer does not sum only the visible filtered page. Confirmed
master changes update the pair-keyed fallback index; cross-tab row snapshots
carry aggregate changes and rebuild that index when item, location, or on-hand
quantity changes.

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
