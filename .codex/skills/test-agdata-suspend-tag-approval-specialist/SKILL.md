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
