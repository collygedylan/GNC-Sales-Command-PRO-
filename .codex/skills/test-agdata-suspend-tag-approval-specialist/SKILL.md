---
name: test-agdata-suspend-tag-approval-specialist
description: Preserve Suspend Tag physical identity, assigned-rep or Admin decisions, immutable candidates, and idempotent approval delivery.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Suspend Tag Approval Specialist

Load with `test-agdata-queue-and-reclass-specialist`, `test-agdata-docks-and-orders-specialist`, and `test-agdata-app-shell-and-navigation` for `Que -> SUSPEND` changes.

Read [the canonical dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) and preserve `goBackUniversal` ownership for cards, dialogs, and Queue history.

## Contracts

- Suspend approval and denial belong only to Suspend Tag cards and email review links. The server decides authority from the assigned rep identity or full-app Administrator status; cached UI role state never grants authority.
- Keep one card per physical source UID, immutable submitted snapshots, exact pending status, native session proof, command idempotency, candidate grouping, and approve-one/deny-others behavior.
- Non-decision users may see only the authorized read state. The UI renders decision controls only when the RPC returns `canDecide` and the feature permission remains enabled.
- Preserve shared Queue navigation, Docks pull consequences, and active confirmed recipient resolution.

## Owned Files, Canonical Functions & SQL Contracts

- `test/assets/app-runtime.js`: `buildSuspendTagActions`, `openSuspendTagApproval`, approval inbox and candidate rendering.
- `test/supabase/functions/_shared/suspend-tag.ts`: authenticated operation validation and canonical RPC dispatch.
- SQL: `test_suspend_tag_command_v1`, Suspend approval/candidate tables, assigned `rep_id`, and `test_private.is_full_app_administrator_v1`.

## Cross-Layer Blast Radius

- Suspend decisions flow from the runtime dialog through `_shared/suspend-tag.ts` to SQL; `test/workers/email/Code.gs` consumes frozen email snapshots and never grants decision authority.

## Focused Verification

```sh
node --test test/tests/suspend-tag-dataset.test.mjs test/tests/role-access-parity.test.mjs test/tests/golden-invariants.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.188 / Invariant 488: Never choose an evaluator filter to force an approximate total. Include every active SUSPEND route: dc means dylan_collyge; ms and mk mean megan_kelly; other routes use their explicit username or Assigned Items owner, never an implicit Dylan fallback. Dylan/Megan and other owners default to self; JD defaults to All Users; authorized users retain cross-owner options with actual positive counts. The verified workbook has 24 active ms plus 3 mk rows for Megan, not a fabricated 24 combined. Missing untouched rows leave SOC/Docks on atomic sync; missing tags with saved evidence or replacement work remain until Complete Tag. Only an exact Complete Tag receipt or explicit completed flag creates a permanent closure; evaluation dates and shared business keys cannot close sibling tags. Preserve exact master evidence, session previews, immediate cards return, filename ordering and Watchdog.

- v2.3.187 / Invariant 487 routing was superseded by the explicit v2.3.188 clarification: 25 was the dc subset, not the total queue. Never infer destination membership from an approximate count; preserve terminal candidate exclusions and exact source identities.

- v2.3.186 / Invariant 486: Never sort ERP snapshots by the leading clock, trailing clock or Drive modification time ahead of the embedded date. Parse HHMMSS+YYYYMMDD+HHMMSS as YYYYMMDD+first HHMMSS; use modifiedTime only when no filename timestamp exists. Preserve exact-row evidence, committed source receipts, mapped Suspend ownership and numeric Docks. Keep captured Mark Done card return, receipt-gated success, session previews and no-wrap reorder controls. Four bounded local watchdog probes recover only the current editor/account and retained local images; never mutate production data or expose the restricted review panel to other roles.

- v2.3.185 / Invariant 485: Never retain or reopen Item Detail after confirmed MARK DONE, tie its accepted save to an editor navigation signal, revoke a session photo preview on upload, or squeeze LEFT/RIGHT into an 84px pair. Capture exact row/account evidence and return through the canonical Back handler before awaiting persistence; retain scroll, receipt-gated Success, drafts and rollback. Suspend evaluation keeps the physical tag active; only Complete Tag removes it. Keep localPreviewUrl through Uploaded and group nowrap 11px buttons with 4px 8px padding. This supersedes earlier return-after-receipt and automatic-next-editor instructions.

- v2.3.184 / Invariant 484: Never use a T-prefixed trip/load as a Dock, including as a fallback for missing dock aliases. Numeric current-source Docks and Suspend share one active membership predicate; an evaluation DATE_COMPLETED does not close a still-suspended tag. Only explicit tag closure/terminal candidates leave the active queue. Resolve mapped evaluators before the dylan_collyge fallback, and default authorized full-queue readers to All Eval Users without broadening restricted access. Archive the reviewed historical trip records and explicitly cleared tags; preserve current snapshot membership and source receipts.

- v2.3.183 / Invariant 483: Never group Dock 38 separately from 38, join SOC evidence across crop or explicit PRI, or let ambiguous display evidence establish a write target. Docks and Suspend share one display resolver and business-key deduplication; selected evidence writes require the exact master UID receipt. Apply location/completion receipts to SOC and Suspend together, remove closed tags optimistically with rollback, and keep Mark Done in the queue. Closed-tag import tombstones and security-invoker projections preserve durable lifecycle; missing docks are never invented from obsolete staged snapshots.

- v2.3.179. Queue cards and their Item Detail may preview an existing evaluation from the same item and location, preferring the linked physical UID, lot, sale year, season and priority. Keep that display source separate from the write target. Request, Suspend, Drive, AV and Eval Work publish only exact master receipts. An ambiguous Reclass opens a physical-row choice. Reclass transport recovery replays the same authenticated Edge command and idempotency token through PostgREST. Service Worker updates defer to the page while a detail, modal or upload is open. Restore unsaved fields by account, row and section. Retain local photo previews until the public image loads. An inventory completion lock requires a photo and positive match stock. Suspend Mark Done returns to the scrolled cards after its matching receipt. A classified Dock 38 or 39 review enters the existing Suspend path. A fully staged SOC file continues to publication, and only its receipt qualifies it for 100%. Invariants 472–478 cover queue media, locks, previews, drafts, worker navigation, Reclass recovery and staged SOC continuation.

- On Suspend Mark Done, compute the observed match from exact-row On Hand and preserve it against the available stock at evaluation time for subsequent depletion. Keep photos and the physical tag intact, and return to Suspend cards only after the inventory receipt.

- Never route a Suspend card tap to standalone Drive detail and discard its physical tag identity. Mark Done publishes the full review via the Suspend save transaction. The matching inventory receipt returns the user to the scrolled Suspend queue. Only Complete Tag closes the tag.
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated test_store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- Never serialize unbounded photo uploads, hide other staged Reclass rows, or treat added candidates as an exact-order replacement. Keep 1280px/200KB JPEG compression, authenticated test_store_drive_photo_blob_v1 recovery, canonical Drive Item Detail, exact source/group commands with preserved split totals, and statement-level evidence propagation. Invariants 391–393 cover these seams; no new startup read, test/workers/email/Code.gs or delivery changes.
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, test_save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never route Suspend Item Detail MARK DONE through physical tag completion. Save exact evidence and retain the active card; only the main card Complete Tag close command removes eligibility. Email review completion retains its tag and evidence, with existing authorization, approval and outbox behavior. Request completion remains unchanged. Invariant 290 covers the detail route.

- v2.3.119: Retry bounded 55P03/57014 save contention with the original command ID and unchanged payload; never retry account/session, immutable-review or authorization denials. Keep the form responsive while waiting. Invariant 247 covers replay identity and denial termination.

- v2.3.119: Never read navigationSignal from a Suspend photo proof that owns signal. The post-commit fence must use the canonical signal and acknowledge the committed exact row before UI refresh; Invariant 246 exercises active and aborted proofs.

- v2.3.119: Never require optional notification metadata on a successful save or read receipt. Validate an absent notification as an empty object; preserve exact source/session checks and database-owned notification delivery. Invariant 243 covers committed receipts with and without notification metadata.

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.test_user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared test_save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.
- Never reject an acknowledged authorized edit solely because its resolved source/revision changed or its photo list contains concurrent additions; retain same-account fencing and strict send/retry receipt validation (Invariant 193).

- Never use awaiting_rep, approved, source revision or import readiness as a photo/edit/add-candidate UI gate. The authenticated atomic command resolves one physical source, merges photo evidence and supersedes an old pending approval round while preserving frozen receipts and decision authorization. False Block edits keep tag evidence; only exact real inventory locations receive stock evidence.

- Never render a manual Location/Lot fill form in Suspend AV Options; additions must use checked master inventory options. Route Suspend rows to `addSelectedDockSuspendDcRequestOptions` before applying the Request folder requirement, since Suspend source rows may have no Request folder.

- Never restrict Fill Tag candidate selection to False Block sources, accept a False Block variant as a real candidate, or create a parallel evidence editor; every Suspend source uses the canonical add-candidates and exact-row photo/spec completion path.

- Never render or authorize Suspend decisions from a generic Request card, username text alone, cached role flags, or client-supplied assignee identity.
- Never broaden approval to every sales rep or let a stale/non-pending approval accept a decision.
- Never raise the missing-source guard before stale-UID composite recovery, omit shipped quantity/tag code from physical-line recovery, or let optional decision delivery roll back a committed close/approve/reject receipt.
- Never send Add Candidates with only a mutable SOC UID; include the canonical stable physical source identity, and recover only one exact currently eligible order line. A present replaced/ineligible source must remain rejected.
- Render AV Options with the three-column by two-row metric grid and a checked `[✓] SELECT OPTION` control on each eligible physical row; submit only selected rows through the existing authenticated Add Candidates command, never free-form Location/Lot entries.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Sandbox implementation. Preserve Suspend Tag physical identity, assigned-rep or Admin decisions, immutable candidates, and idempotent approval delivery.

### Exact ownership
- test/assets/app-runtime.js: isFalseBlockLocation, buildSuspendTagActions, openSuspendTagApproval, getSuspendTagStableSourceIdentity, loadCurrentSuspendTagPhotoRow, persistSuspendTagUploadedPhoto, runSuspendTagRowCommand, addSelectedDockSuspendDcRequestOptions.
- test/assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- supabase/functions/_shared/suspend-tag.ts: handleSuspendTag, verifySuspendTagSession.
- supabase/migrations/20261028145127_agdata_v2394_universal_request_directory_suspend_identity.sql: request_customer_directory_v2394, is_universal_request_tuple_v2394, suspend-physical-identity-v2394.
- supabase/migrations/20261029210000_agdata_v23107_row_workflows.sql: resolve_edit_source_v23107, create_inventory_project_v1.
- test/assets/row-workflow-functions.js: applySuspendTagInventoryReceipt, publishFlyerInventoryEvidence, suspendTagApi.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: test_user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: agdata-suspend-tag-approval-specialist, test-agdata-cross-gem-memory-bus-orchestrator, test-agdata-db-cmu-chief-schema-and-constraint-architect, test-agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: agdata-suspend-tag-approval-specialist.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- DOCKS-SUSPEND-INTEGRITY-2026-11-05: SOC aliases and duplicate business keys diverged; inventory display required a unique PRI and completion retention covered only candidate groups. Use shared exact-crop display selection, exact UID save receipts, canonical SOC-backed protected views, durable closed-tag tombstones and synchronized receipt updates. Permanent assertion: tests/golden-invariants.test.mjs Invariant 483; tests/docks-suspend-integrity.test.mjs. Evidence: Live schema and staged SOC inspection; G:/My Drive/GNC/AgData/Release Evidence/docks-suspend-repair.sql.
- NUMERIC-DOCK-CURRENT-SUSPEND-2026-11-05: Dock aliases fell back to trip identifiers; active tags were hidden by evaluation timestamps and the default own-evaluator filter. Use numeric Dock identity only, retain evaluated active tags until explicit closure, and preserve mapped owners with a Dylan fallback and permission-correct All default. Permanent assertion: tests/golden-invariants.test.mjs Invariant 484; tests/current-soc-docks.test.mjs. Evidence: Both user recordings, live current SOC/staging and Drive discovery; G:/My Drive/GNC/AgData/Release Evidence/current-soc-docks-repair.sql.
- v2.3.185-completion-cards-preview: Completed Drive/AV details were deliberately retained, other receipts reopened editors, and uploaded previews were removed while narrow reorder controls wrapped. Return the captured exact-row completion to its cards before awaiting persistence; preserve receipt-gated success, account scope, rollback, active physical tags and session localPreviewUrl. Permanent assertion: tests/completion-cards-preview.test.mjs and append-only Invariant 485. Evidence: Reviewed v2.3.185 user report; baseline reproduction and focused live/test checks under G:/My Drive/GNC/AgData/Release Evidence/.
- ERP-FILENAME-2026-11-05: Cloud sync ordered snapshots by Drive modifiedTime; Home parsing read the trailing clock and could match time digits as a year. v2.3.186 / Invariant 486: Never sort ERP snapshots by the leading clock, trailing clock or Drive modification time ahead of the embedded date. Parse HHMMSS+YYYYMMDD+HHMMSS as YYYYMMDD+first HHMMSS; use modifiedTime only when no filename timestamp exists. Preserve exact-row evidence, committed source receipts, mapped Suspend ownership and numeric Docks. Keep captured Mark Done card return, receipt-gated success, session previews and no-wrap reorder controls. Four bounded local watchdog probes recover only the current editor/account and retained local images; never mutate production data or expose the restricted review panel to other roles. Permanent assertion: tests/erp-filename-watchdog.test.mjs; Invariant 486. Evidence: November 5 committed stage receipts; source comparator inspection; focused behavior checks..
- SOC-SUSPEND-MEMBERSHIP-2026-11-05: The approximate total was incorrectly inferred to mean the dc-only subset; v2.3.188 explicitly supersedes that routing restriction. Preserve physical tag identities and terminal candidate exclusions; follow the explicit all-route routing/default/retention contract in SUSPEND-ALL-ROUTES-2026-11-05. Permanent assertion: tests/soc-suspend-membership.test.mjs; Golden Invariant 487; exact workbook/staged UID EXCEPT checks.. Evidence: SHA-256 ec39f56435c12766dd5b20200ae9b25abc0fad10d33e3a1efe4f0b796352d267; 61492 workbook rows including header; 28 dc flags, 3 replaced, 25 active..
- SUSPEND-ALL-ROUTES-2026-11-05: A dc-only membership rule and blanket missing-row deletion hid other evaluators and discarded saved work; legacy evaluation dates were mistaken for permanent physical-tag completion. Never choose an evaluator filter to force an approximate total. Include every active SUSPEND route: dc means dylan_collyge; ms and mk mean megan_kelly; other routes use their explicit username or Assigned Items owner, never an implicit Dylan fallback. Dylan/Megan and other owners default to self; JD defaults to All Users; authorized users retain cross-owner options with actual positive counts. The verified workbook has 24 active ms plus 3 mk rows for Megan, not a fabricated 24 combined. Missing untouched rows leave SOC/Docks on atomic sync; missing tags with saved evidence or replacement work remain until Complete Tag. Only an exact Complete Tag receipt or explicit completed flag creates a permanent closure; evaluation dates and shared business keys cannot close sibling tags. Preserve exact master evidence, session previews, immediate cards return, filename ordering and Watchdog. Permanent assertion: tests/soc-suspend-routing.test.mjs; Invariant 488; rolled-back installed SQL ownership/retention/eligibility assertions.. Evidence: Verified revision 644 workbook: 88 active rows across all codes, including 24 ms and 3 mk. Existing five explicit completions remain closed..
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
