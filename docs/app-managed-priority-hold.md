# App-managed priority and holds

## Ownership and synchronization

Priority, hold code, and hold reason use one pending legacy synchronization
state for each inventory row. A newly imported row accepts its initial legacy
values. An app edit protects the resulting three-field tuple. A later import
may update the other inventory fields but cannot replace this tuple while the
shield is pending. Only an import containing the same three values acknowledges
the edit and releases the shield. Subsequent imports can update the tuple again.

The database owns this decision. The browser cannot clear the shield, and an
email delivery acknowledgment is not a legacy synchronization acknowledgment.
Import tokens, dataset revisions, and inventory identity checks remain required.
Matching uses the persisted inventory identity; an itemcode alone is insufficient
to merge physical inventory rows.

The legacy export embeds priority in its row ID. Private lineage metadata keeps
the canonical app row stable when that legacy ID changes. The importer must carry
its existing, active import-run fence. An ambiguous alias fails without merging
physical rows, and deletion retries retain aliases already seen in that run.
A pending comparison marker forces the next export through database validation,
including when a user changes a value and then changes it back before an import.
Changed-ID imports also merge existing app evidence and assignments from the
canonical row. An acknowledged edit preserves that evidence; a newly accepted
legacy blocking hold retains the existing evidence-clear policy. A supplied
import fence without master-inventory authority is rejected.

The PH importer forwards the original legacy priority/hold tuple. Its older
approved-release suppression must not replace an incoming hold with a blank
before SQL compares it, because that would falsely acknowledge the app's clear.
Other sites retain their existing importer policy; photo preservation continues.
The migration initializes pending shields for existing, fully cleared holds with
recorded release approval, so those approvals stay protected during the change.

Fenced imports also carry `x-gnc-master-tuple-policy: raw-priority-hold-v1`.
SQL requires this exact policy before an equal source tuple can release a pending
shield. Older deployed importers may still complete their other work, but their
historically masked hold values cannot acknowledge an app edit. The additive
rollout repair re-arms approved, fully cleared holds that may have been falsely
acknowledged during the database-before-Apps-Script interval. It changes shield
metadata and the comparison marker; it leaves live priority and hold values intact.
A subsequent raw, matching tuple acknowledges those records normally.

## Atomic submission

A successful submission commits both the allowed live field edits and the
standard request/outbox entry. If validation or queue creation fails, neither
operation commits. The frontend reconciles only server-confirmed edits. A retry
uses the same idempotency token and cannot repeat a live edit or enqueue another
request.

Each live-edit acknowledgment includes the committed Drive evidence projection,
including any photo, spec, or availability values cleared by database rules.
The client validates its row identity and revision before updating same-row
Drive and AV copies, so old local evidence cannot survive a confirmed clear.

Only priority, hold code, and hold reason are live edits in this workflow.
Recounts, quantity movements, season changes, and shearing remain instructions
for keyers. Mixed requests retain both kinds of instructions in their PDF.

Selecting Move Up clears and disables hold drafts for that inquiry, including
the move's optional hold instructions. It does not clear an existing live hold
merely because the editor was opened or a checkbox changed. Priority remains
available. Other movement actions retain their supported hold instructions.

## Hold propagation

The database resolves the current season and sales year from the Managers
setting. Only these authenticated, active actors can trigger propagation:

- `dylan_collyge`
- `megan_kelly`
- `mitch_kaiser`
- `jd_jones`

Propagation requires the initiating row to have that exact season and a valid
sales year at or before the configured year. It applies only to the same item
within that scope. A future initiating row changes only itself. Other authorized
actors change only the selected row. Missing/invalid season settings cannot
silently widen the scope. Priority never propagates as a side effect of a hold.

The hold proposal carries the initiating row's `sourceUid`; contextual rows shown
beside it are not a client-supplied propagation list. Inventory ownership and tab
assignment do not replace the season/year scope check.

The queued request records the scope and affected row count for the keyers.
Normal recipient resolution, including active CSR recipients, and delivery
retry protections continue to apply.

## Validation and release

Regression coverage exercises initial import, conflicting import, exact
acknowledgment, later unshielded updates, mixed requests, propagation boundaries,
authorization, conflicts, idempotency, rejected submissions, and PDF instructions.
The disposable SQL gate validates the migration, PostgreSQL functions, and
generated types. Browser tests exercise the real editor and confirmed-result
reconciliation with synthetic responses.

GitHub Actions deploys the additive database changes and compatible backend
before the PWA. Existing request versions and queued deliveries remain supported.
Rollback must retain pending shields and delivery support for committed requests.
