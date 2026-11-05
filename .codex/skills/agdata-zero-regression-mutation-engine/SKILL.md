---
name: agdata-zero-regression-mutation-engine
description: Preserve the canonical exact-row photo and evaluation mutation engine across operational views.
---

# zero regression mutation engine

Read [the canonical module dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and symbol index before editing.

## Owned Files, Canonical Functions & SQL Contracts

- Runtime: assets/app-runtime.js and declaration-only assets/row-workflow-functions.js; access editor: assets/user-access-control.js. Canonical functions: saveSecureDriveEvidence, applySuspendTagInventoryReceipt, publishFlyerInventoryEvidence.
- Server: supabase/functions/_shared/user-access-matrix.ts, app-api user_access, public.user_access, public.save_user_access_matrix_v23119 and suspend_tag_private.publish_inventory_evidence_v23119. Reuse public.save_drive_evidence_v3; never grant direct evidence-table writes.

## Cross-Layer Blast Radius

Code.gs delivery, private access credentials and outbox contracts stay intact. SQL rechecks the active profile and exact row assignment; app-api verifies native sessions and command identity. Browser matrix data is display state, never mutation authority. Preserve same-account SWR/LKG rows, drafts, and durable Request submission. The new bounded authenticated GET /rest/v1/user_access uses only the sanitized relation and its exact fixture.

Shared switchView, goBackUniversal, updateGlobalBackButton, viewHistoryStack and header/search ownership remain canonical; never recreate global Back/navigation.

## Scoped Node verification

```sh
node --test tests/golden-invariants.test.mjs tests/role-access-parity.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.185 / Invariant 485: Never retain or reopen Item Detail after confirmed MARK DONE, tie its accepted save to an editor navigation signal, revoke a session photo preview on upload, or squeeze LEFT/RIGHT into an 84px pair. Capture exact row/account evidence and return through the canonical Back handler before awaiting persistence; retain scroll, receipt-gated Success, drafts and rollback. Suspend evaluation keeps the physical tag active; only Complete Tag removes it. Keep localPreviewUrl through Uploaded and group nowrap 11px buttons with 4px 8px padding. This supersedes earlier return-after-receipt and automatic-next-editor instructions.

- Never resolve an evaluation from item/location alone, aggregate sibling metrics for its preview, compute its observed percentage from Available, or refresh an expired photo using a notes update timestamp. Preserve original photo time, exact UID, depletion, and receipt-gated completion. Invariant 482 owns this contract.


- v2.3.179. Queue cards and their Item Detail may preview an existing evaluation from the same item and location, preferring the linked physical UID, lot, sale year, season and priority. Keep that display source separate from the write target. Request, Suspend, Drive, AV and Eval Work publish only exact master receipts. An ambiguous Reclass opens a physical-row choice. Reclass transport recovery replays the same authenticated Edge command and idempotency token through PostgREST. Service Worker updates defer to the page while a detail, modal or upload is open. Restore unsaved fields by account, row and section. Retain local photo previews until the public image loads. An inventory completion lock requires a photo and positive match stock. Suspend Mark Done returns to the scrolled cards after its matching receipt. A classified Dock 38 or 39 review enters the existing Suspend path. A fully staged SOC file continues to publication, and only its receipt qualifies it for 100%. Invariants 472–478 cover queue media, locks, previews, drafts, worker navigation, Reclass recovery and staged SOC continuation.

- Never hydrate or publish photos, spec, caliper, AV/pick notes, comments, match quantities or completion by location or item/location. Use the master UID first, and use an exact item/location/lot tuple only when it identifies one physical row. Two rows with the same tuple and different UIDs own separate evidence. Invariant 471 covers the Grey Guardian priority 1 and priority 10 cards.

- v2.3.165. A completed-row 42501 requires a deliberate unlock through the authenticated exact-row SQL RPC. Preserve drafts and keep server denials visible. Reclass may recover an uncertain command only from its actor-scoped receipt under the original token. Background reads retain verified same-account data. Watchdog repairs footer position and recounts badges before reporting persistent anomalies. Operational auto-resolution records a telemetry disposition, never a save receipt. Invariant 459 protects this boundary.
- v2.3.144: Never infer completion from photo/spec changes or drop a committed photo timestamp while restoring editor drafts. Keep unlimited photo references and ✓ UPLOADED receipts; only explicit Mark Done completes. Native unlock repeats assigned-user/Admin/super-admin authorization. Photo age >10 calendar days or evaluated zero match expires through canonical evidence/history; unentered match remains a draft and Docks-owned photos are exempt. Camera state is owner-scoped, survives recreation, and defers reload through capture plus 15 seconds. Unassigned summaries occur only once per completed manual sync on Home/Managers. Invariant 400 exercises these boundaries.
- Never clone the supplied VM fixture context when adding dependencies; asynchronous row and account transitions must share the original context object (Invariant 390).
- Never read a role fallback variable before its declaration while honoring an explicit Update Any Row grant. Invariant 386 exercises Y, explicit N and assigned-only branches.
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.
- v2.3.138: Never let a failed independent photo attachment undo a successful exact-row evidence receipt; keep failed drafts removable and independently retryable (Invariant 359).

- Never resume master snapshot formatting/indexing across a UI yield while an owner write is pending. The canonical preparation scheduler must use the same interactive-write guard before continuing and recheck snapshot identity afterward (Invariant 311).

- Never force a bulk inventory response to decode after an elapsed wait while a mutation is still pending. Yield until the current-account write settles, retaining abort handling and displayed LKG rows (Invariant 310).

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never route Suspend Item Detail MARK DONE through physical tag completion. Save exact evidence and retain the active card; only the main card Complete Tag close command removes eligibility. Email review completion retains its tag and evidence, with existing authorization, approval and outbox behavior. Request completion remains unchanged. Invariant 290 covers the detail route.

- v2.3.121: Never infer completion from elapsed runtime or stale parsing progress while a leased worker is publishing. Only five current-run checked source checkpoints may complete the run; expired leases remain resumable through cloud plus same-account single-flight browser continuation. A confirmed exact-file commit paints Published immediately, including Processed-move retries; unchanged checks retain real last-published counts and names. SOC accepts 52,000-row files with bounded 1,500-row slices. Invariants 253–257 and Lock 6 preserve this contract; the v2.3.120 age-based completion rule is superseded. Shared Back/navigation, READY/LKG data and all mutation authorization remain intact.

- v2.3.120: Never append ORDER HISTORY or unrelated secondary folders to the five-source operational Run Script. Complete DRIVE/CAV/RESERVES/SOC/HL PO at 100%, release retired-history or 90-second stalled jobs without deleting cursors, and fold new SOC quantities into the canonical SQL statistics using latest daily group bags. Preserve immutable history, protected evidence, public access-matrix authorization, shared Back/navigation and service-only delivery. Invariants 250–252 and Lock 6 preserve the five-card modal and bounded mobile centering.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Preserve the canonical exact-row photo and evaluation mutation engine across operational views.

### Exact ownership
- assets/app-runtime.js: module contract.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- assets/user-access-control.js: module contract.
- assets/row-workflow-functions.js: calculateLiveLocPhotoMatch, beginOptimisticCompletedRow, syncCompletedRowControls, replaceDetailMediaPreservingImages.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: user_access
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-zero-regression-mutation-engine, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-zero-regression-mutation-engine.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
- ROW-EVALUATION-2026-11-05: Suspend preview fallback aggregated sibling lots; percentage drafts used Available instead of true On Hand; archived row evidence could lack a master photo or match quantity. Publish through publishRowEvaluationToMasterAndNotes and UID-keyed protected evidence. Require explicit UID or unique full season/year/priority/lot identity, calculate observed match from exact On Hand, retain outbound depletion and original photo timestamps, and never revive expired evidence from notes update time. Permanent assertion: tests/row-evaluation-contract.test.mjs; Golden Invariant 482; transactional sibling checks. Evidence: Sandbox rollback and live guarded recovery receipts; no actor permissions or completion-removal contracts changed..
- v2.3.185-completion-cards-preview: Completed Drive/AV details were deliberately retained, other receipts reopened editors, and uploaded previews were removed while narrow reorder controls wrapped. Return the captured exact-row completion to its cards before awaiting persistence; preserve receipt-gated success, account scope, rollback, active physical tags and session localPreviewUrl. Permanent assertion: tests/completion-cards-preview.test.mjs and append-only Invariant 485. Evidence: Reviewed v2.3.185 user report; baseline reproduction and focused live/test checks under G:/My Drive/GNC/AgData/Release Evidence/.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
