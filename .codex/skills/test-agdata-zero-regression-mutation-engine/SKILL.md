---
name: test-agdata-zero-regression-mutation-engine
description: Preserve the canonical exact-row photo and evaluation mutation engine across operational views.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# zero regression mutation engine

Read [the canonical module dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md) and symbol index before editing.

## Owned Files, Canonical Functions & SQL Contracts

- Runtime: test/assets/app-runtime.js and declaration-only test/assets/row-workflow-functions.js; access editor: test/assets/user-access-control.js. Canonical functions: saveSecureDriveEvidence, applySuspendTagInventoryReceipt, publishFlyerInventoryEvidence.
- Server: test/supabase/functions/_shared/user-access-matrix.ts, app-api test_user_access, public.test_user_access, public.test_save_user_access_matrix_v23119 and test_suspend_tag_private.publish_inventory_evidence_v23119. Reuse public.test_save_drive_evidence_v3; never grant direct evidence-table writes.

## Cross-Layer Blast Radius

test/workers/email/Code.gs delivery, private access credentials and outbox contracts stay intact. SQL rechecks the active profile and exact row assignment; app-api verifies native sessions and command identity. Browser matrix data is display state, never mutation authority. Preserve same-account SWR/LKG rows, drafts, and durable Request submission. The new bounded authenticated GET /rest/v1/test_user_access uses only the sanitized relation and its exact fixture.

Shared switchView, goBackUniversal, updateGlobalBackButton, viewHistoryStack and header/search ownership remain canonical; never recreate global Back/navigation.

## Scoped Node verification

```sh
node --test test/tests/golden-invariants.test.mjs test/tests/role-access-parity.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- Never clear a freshly committed exact-row AV note because its photo-match quantity is zero. Preserve the fresh note without reviving expired photos; verify the stored row and replay receipt in a rolled-back test.

- v2.3.179. Queue cards and their Item Detail may preview an existing evaluation from the same item and location, preferring the linked physical UID, lot, sale year, season and priority. Keep that display source separate from the write target. Request, Suspend, Drive, AV and Eval Work publish only exact master receipts. An ambiguous Reclass opens a physical-row choice. Reclass transport recovery replays the same authenticated Edge command and idempotency token through PostgREST. Service Worker updates defer to the page while a detail, modal or upload is open. Restore unsaved fields by account, row and section. Retain local photo previews until the public image loads. An inventory completion lock requires a photo and positive match stock. Suspend Mark Done returns to the scrolled cards after its matching receipt. A classified Dock 38 or 39 review enters the existing Suspend path. A fully staged SOC file continues to publication, and only its receipt qualifies it for 100%. Invariants 472–478 cover queue media, locks, previews, drafts, worker navigation, Reclass recovery and staged SOC continuation.

- Never hydrate or publish photos, spec, caliper, AV/pick notes, comments, match quantities or completion by location or item/location. Use the master UID first, and use an exact item/location/lot tuple only when it identifies one physical row. Two rows with the same tuple and different UIDs own separate evidence. Invariant 471 covers the Grey Guardian priority 1 and priority 10 cards.

- v2.3.165. A completed-row 42501 requires a deliberate unlock through the authenticated exact-row SQL RPC. Preserve drafts and keep server denials visible. Reclass may recover an uncertain command only from its actor-scoped receipt under the original token. Background reads retain verified same-account data. Watchdog repairs footer position and recounts badges before reporting persistent anomalies. Operational auto-resolution records a telemetry disposition, never a save receipt. Invariant 459 protects this boundary.
- v2.3.144: Never infer completion from photo/spec changes or drop a committed photo timestamp while restoring editor drafts. Keep unlimited photo references and ✓ UPLOADED receipts; only explicit Mark Done completes. Native unlock repeats assigned-user/Admin/super-admin authorization. Photo age >10 calendar days or evaluated zero match expires through canonical evidence/history; unentered match remains a draft and Docks-owned photos are exempt. Camera state is owner-scoped, survives recreation, and defers reload through capture plus 15 seconds. Unassigned summaries occur only once per completed manual sync on Home/Managers. Invariant 400 exercises these boundaries.
- Never clone the supplied VM fixture context when adding dependencies; asynchronous row and account transitions must share the original context object (Invariant 390).
- Never read a role fallback variable before its declaration while honoring an explicit Update Any Row grant. Invariant 386 exercises Y, explicit N and assigned-only branches.
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, test_save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.
- v2.3.138: Never let a failed independent photo attachment undo a successful exact-row evidence receipt; keep failed drafts removable and independently retryable (Invariant 359).

- Never resume master snapshot formatting/indexing across a UI yield while an owner write is pending. The canonical preparation scheduler must use the same interactive-write guard before continuing and recheck snapshot identity afterward (Invariant 311).

- Never force a bulk inventory response to decode after an elapsed wait while a mutation is still pending. Yield until the current-account write settles, retaining abort handling and displayed LKG rows (Invariant 310).

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never route Suspend Item Detail MARK DONE through physical tag completion. Save exact evidence and retain the active card; only the main card Complete Tag close command removes eligibility. Email review completion retains its tag and evidence, with existing authorization, approval and outbox behavior. Request completion remains unchanged. Invariant 290 covers the detail route.

- v2.3.121: Never infer completion from elapsed runtime or stale parsing progress while a leased worker is publishing. Only five current-run checked source checkpoints may complete the run; expired leases remain resumable through cloud plus same-account single-flight browser continuation. A confirmed exact-file commit paints Published immediately, including Processed-move retries; unchanged checks retain real last-published counts and names. SOC accepts 52,000-row files with bounded 1,500-row slices. Invariants 253–257 and Lock 6 preserve this contract; the v2.3.120 age-based completion rule is superseded. Shared Back/navigation, READY/LKG data and all mutation authorization remain intact.

- v2.3.120: Never append ORDER HISTORY or unrelated secondary folders to the five-source operational Run Script. Complete DRIVE/CAV/RESERVES/SOC/HL PO at 100%, release retired-history or 90-second stalled jobs without deleting cursors, and fold new SOC quantities into the canonical SQL statistics using latest daily group bags. Preserve immutable history, protected evidence, public access-matrix authorization, shared Back/navigation and service-only delivery. Invariants 250–252 and Lock 6 preserve the five-card modal and bounded mobile centering.

- v2.3.119: Never await the active directory to render Request reps, ignore an explicit N, drop the Nally/Nelly alias, or treat a SOC lot mismatch as authority to choose a different nursery location. Publish an acknowledged exact master receipt through the canonical evidence engine and preserve the full AV Note.
