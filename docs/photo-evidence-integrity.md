# Photo evidence integrity — V2026.09.07.01

`MATCH`, `INITIAL_PTR`, and stored `LOC_MATCH_QTY` are retained observations, not proof that a photograph is still attached, current, or deliverable. Display and export must not claim a photo-backed quantity from those fields alone.

## Verification contract

- Require a committed photo reference belonging to the row's evidence source, a valid capture date no more than ten days old, a valid 0–100 match percentage, and known current stock. Invalid nonempty baselines fail closed.
- Use explicit capture dates from paired photo names/links before photo-update metadata. Generic note/bundle updates cannot renew a photo. A legacy completion timestamp is a fallback only when no photo-specific timestamp exists.
- Missing, undated, future, expired, invalid, or known failed photographs produce an unknown photo-match value. Presentation says **Not verified**, not a misleading zero. A genuinely calculated zero stays zero when its evidence is valid.
- Without a baseline, calculate `round(current available × MATCH / 100)`. With a baseline, reduce the original matched quantity by stock consumed since that baseline; later stock growth does not increase the original matched amount. Stored quantities do not override the calculation. Photo-match quantity is not a reservation or a promise of sellable stock.
- The private Season Sales Notes evidence classifier requires current photo evidence, a positive verified match quantity, an AV note, and a meaningful crop specification. Its existing status names, permissions, fingerprint inputs, completion history, and reconciliation rules remain in place.

## Data preservation and limits

This release does not clear inventory, raw observations, photographs, completed acknowledgments, or movement history. The SQL migration adds pure private projections and replaces the evidence classifier; it introduces no table, trigger, scheduled job, or browser API. Existing reconciliation can identify previously misclassified evidence as incomplete under its existing rules; no bulk reconciliation is forced by this migration.

Source/date verification alone cannot prove an object is reachable. UI delivery failures are handled separately. The original cause of older orphaned match observations is not established by their current state. Importer-provided `PTRAVAILABLE` and `S_LTS` do not establish upstream reservation semantics.

BloomScapes uses the same photo qualification and baseline calculation. Its existing current-season filter remains positive `S_LTS`, matching configured season, and sales year no later than the configured year. Incomplete rows may remain visible for review, but do not receive a verified match claim or an unqualified Ready to ship badge.

## Verification

- `tests/av-photo-evidence-integrity.test.mjs` executes the actual frontend helpers; it is included in `npm run test:photo`.
- `supabase/tests/photo_evidence_projection_test.sql` checks synthetic JSON arguments only, in a read-only rollback transaction. It does not create or complete real workflow records.
- Existing photo, service-worker, pilot, and release browser checks remain enabled. The Season lifecycle SQL fixture now supplies realistic dated photo evidence and numeric match observations.
- BloomScapes has separate catalog and presentation regression tests for missing evidence, image failures, stale events, expiry, nullable quantities, baseline arithmetic, and source-row preservation.

Release verification results are reported separately; this document does not imply that a build has been deployed or that every device has been manually tested.
