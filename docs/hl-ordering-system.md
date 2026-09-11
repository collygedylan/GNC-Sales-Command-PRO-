# HL ordering

HL Order is available only to the active native Supabase account whose trusted profile username is `dylan_collyge`. The saved workflow is independent of imported SOC and inventory rows. Imports remain the only source of stock quantities.

## Using the workflow

- **Needed** groups uninvoiced eligible SOC demand by item, size, plan start date, dock and stop. Open a card to compare all accessible Park Hill Drive rows for its item and size, including other locations, lots and seasons. Drive search and quick filters do not limit this comparison.
- Select SOC lines and enter whole-plant HL quantities. Any demand omitted from an HL quantity is covered locally. **Order selected rows** saves those lines in the persistent HL section of Bloom Picker. Quantities remain editable until submission.
- **HL TAGS** prepares a frozen PDF for review. It contains only ready draft lines. Older pending or uncertain deliveries stay visible in Bloom Picker and are excluded from new PDFs. Confirmed email delivery clears only the corresponding saved HL lines and moves their demand to Orders.
- **Remove selected rows** dismisses demand into **Removed**. Restore returns eligible unchanged demand to Needed. SOC data is never deleted by these actions.
- In **Orders**, select lines and enter the **total received**, not an increment. A lower total requires a correction reason. The original quantities and every receipt adjustment remain in history. Pending cancellation quantities are reserved against both receiving and another cancellation.
- Cancel unreceived balances by selecting lines, entering quantities and a reason, then reviewing and sending the cancellation PDF. Confirmation preserves receipts and original order lines; canceled demand enters **Needs Review** before replacement ordering.
- **Needs Review** prevents automatic reordering after source changes, disappearance, replacement IDs or cancellation. Resolve a possible replacement through the missing original source so its already-covered quantity is carried forward. A canceled balance reopens only that balance.
- **History** retains order details, receipts, cancellations, saved PDFs and recent workflow activity. Historical PDF viewing does not expire; submission of an unsubmitted preview does.

## Protected contracts

`hl_order_state()` authenticates the session and reconciles current SOC against saved source dispositions. It returns a global revision, actionable rows, drafts, dispositions, orders, delivery issues and recent activity. It is a workflow read that can record newly detected source changes; production mutation-blocked health probes must not invoke it as a pure read.

`hl_order_command(p_command_id, p_action, p_payload, p_expected_revision)` serializes mutations against that revision. Commands are replayable only with the same identity and payload. Editable rows retain the revision shown when their values were rendered; background polling cannot authorize an older local edit against newer saved values. A conflict requires reviewing the latest values with Refresh. Its actions are `draft_save`, `draft_clear`, `preview`, `submit`, `dismiss`, `restore`, `resolve_review`, `receive`, `cancellation_preview`, `cancellation_submit` and `reconcile_delivery`.

The `hl_order_private` schema holds workflow records. Public preview records permit no direct authenticated reads or writes; the authenticated Apps Script PDF action verifies ownership before reading them with its service credential. Historical records have no foreign key to an imported SOC row and cannot disappear when a report refresh replaces it.

HL uses the existing delivery outbox with `hl_order_submission` and `hl_order_cancellation` events. A signed service worker passes event identity to Apps Script, which loads the frozen report and resolves the existing Dylan email mapping. Subjects are exactly **HL TAGS** and **HL TAGS — CANCELLATION**. HL events bypass unrelated recipient and push rules. Legacy direct `hl_tags` sends require an app update, and legacy delivery-recovery routes exclude HL events.

Send intent is persisted before calling Gmail. A Gmail receipt durably advances workflow state, even if a later worker acknowledgement is lost. An ambiguous response cannot authorize another send: **Check delivery status** reconciles the same saved event and message identity against recorded/Sent-mail evidence. Missing proof remains visible for reconciliation. A known failure before sending can retry the same frozen order safely.

## Release and validation

Deploy the additive migration, compatible Apps Script handler and delivery worker before publishing the frontend. The isolated lifecycle/delivery SQL suites and real PostgreSQL concurrency fixture are included in the required database release lane. Focused browser tests run against the freshly compiled app across desktop and mobile engines; PDF fixtures cover grouping, totals and pagination. The exact-commit candidate and main release gates remain mandatory.
