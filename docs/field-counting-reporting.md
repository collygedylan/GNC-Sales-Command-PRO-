# Field Counting and Completion Reports

## Field Count

Field Count is a mobile-oriented Bunch Count / Spread Count screen available to the approved field-counting users. The legacy inventory hub loads the React island only when the user opens the screen. The app checks the active profile and sales-inventory access before mounting it; `app-api` resolves that profile again and checks the existing read/write permissions for the selected count table. The database command also verifies the active actor and service-role boundary.

The screen chooses a block and location, then reads saved inventory lots and count observations in pages of 100. Each command is idempotent by command UUID. A save includes each lot's expected prior `updated_at`; a stale row causes the whole command to conflict instead of overwriting a newer count. Count values must be whole nonnegative integers, and a mutation accepts at most 100 entries. Counts are stored in `ph_bunch_counts` or `ph_spread_counts`; they do not change master inventory quantities.

The screen keeps entered drafts and row ordering while the user pages through a location. Each save or completion command is bounded to at most 100 rows; a completion report represents only the rows submitted in that batch, not an automatic count of the entire location. Submissions include the selected direction, row order, count, note, and expected saved revision. If a location note is entered, it is applied to the submitted rows. The database records the authenticated actor and server timestamps, and returns the exact saved source IDs before the UI clears those drafts.

The React island uses SWR keys scoped by the active identity, count type, block, location, page, and revision key. It does not show previous-scope data while a new key loads, revalidates on focus and reconnect, and aborts a superseded page request. Draft counts are keyed by source UID and row-order overrides by page, so unsaved entries remain available when returning to a page. A successful save revalidates the current snapshot. Other users' count changes are fetched on focus, reconnect, or an explicit refresh; verified master revisions invalidate the active inventory scope.

Choosing **Complete & email report** saves the submitted counts and creates an immutable report snapshot in the same database transaction. The snapshot includes the lot identity and display fields, on-hand value at completion, counted quantity, direction, row order, note, actor, and completion time. The transaction queues one `field_count_completion` event; the UI reports that the report is queued, not that email has already arrived.

The signed delivery worker reads the frozen report and server-selected recipient list. Apps Script renders the PDF from that snapshot, freezes the resulting bytes before sending, and records the Gmail receipt against the event lease. A stable Message-ID supports receipt recovery. If sending may have started but no receipt can be recovered, the event enters reconciliation instead of sending a duplicate. PDF/render failures before send remain retryable. No recipient list, PDF, or completion identity is accepted from the field-entry client.

## Bunch Notes Automatic Completion

The structured editor and work-card board use separate `React.lazy` boundaries. Their SWR caches receive authoritative snapshots from the existing Bunch Notes reader, scoped to account and revision, without making duplicate database reads. Public view chunks are included in the root service-worker cache; private query results remain in memory. A failed chunk can be retried with a fresh URL without reloading the app or discarding the owning draft.

When a Bunch Notes job transitions from an active status to `complete`, the database trigger in `20261010080018_bunch_note_auto_completion_delivery.sql` creates a frozen completed-work preview and queues one `bunch_note_submission` event for that job revision. The report captures the saved instructions, work cards, actual work and corrections, progress, and inventory source snapshot. It uses the recipient snapshot from the published instruction revision, including the existing required recipient policy. The trigger does not modify inventory quantities.

The event key is derived from the job ID and work revision, and a uniqueness check prevents duplicate completion reports for the same revision. Existing completed jobs are not retroactively mailed. If a worker manually publishes the same completed revision, the command reuses its automatic preview/event instead of creating another email. A later corrected work revision can produce its own report.

The delivery worker uses the saved recipients, freezes the rendered PDFs before send, and records a signed delivery receipt. It follows the same no-blind-resend rule: a saved receipt is recovered; an ambiguous send is reconciled; and a known pre-send PDF failure can be retried. Manual preview and publish remain available for ordinary instruction revisions.

## PDF Render Check

The field-count report builder was rendered in headless Chromium with 100 fixture rows containing long names and notes. Poppler reported 26 landscape letter pages (792 × 612 points). The first, middle, and final rendered pages showed repeated table headings, separated row boundaries, and no visible text overlap or clipping; the last page contained row 100.
