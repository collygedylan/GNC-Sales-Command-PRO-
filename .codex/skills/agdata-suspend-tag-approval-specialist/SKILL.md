---
name: agdata-suspend-tag-approval-specialist
description: Preserve Suspend Tag physical identity, assigned-rep or Admin decisions, immutable candidates, and idempotent approval delivery.
---

# Suspend Tag Approval Specialist

Load with `agdata-queue-and-reclass-specialist`, `agdata-docks-and-orders-specialist`, and `agdata-app-shell-and-navigation` for `Que -> SUSPEND` changes.

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md) and preserve `goBackUniversal` ownership for cards, dialogs, and Queue history.

## Contracts

- Suspend approval and denial belong only to Suspend Tag cards and email review links. The server decides authority from the assigned rep identity or full-app Administrator status; cached UI role state never grants authority.
- Keep one card per physical source UID, immutable submitted snapshots, exact pending status, native session proof, command idempotency, candidate grouping, and approve-one/deny-others behavior.
- Non-decision users may see only the authorized read state. The UI renders decision controls only when the RPC returns `canDecide` and the feature permission remains enabled.
- Preserve shared Queue navigation, Docks pull consequences, and active confirmed recipient resolution.

## Owned Files, Canonical Functions & SQL Contracts

- `assets/app-runtime.js`: `buildSuspendTagActions`, `openSuspendTagApproval`, approval inbox and candidate rendering.
- `supabase/functions/_shared/suspend-tag.ts`: authenticated operation validation and canonical RPC dispatch.
- SQL: `suspend_tag_command_v1`, Suspend approval/candidate tables, assigned `rep_id`, and `private.is_full_app_administrator_v1`.

## Cross-Layer Blast Radius

- Suspend decisions flow from the runtime dialog through `_shared/suspend-tag.ts` to SQL; `Code.gs` consumes frozen email snapshots and never grants decision authority.

## Focused Verification

```sh
node --test tests/suspend-tag-dataset.test.mjs tests/role-access-parity.test.mjs tests/golden-invariants.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- v2.3.179. Queue cards and their Item Detail may preview an existing evaluation from the same item and location, preferring the linked physical UID, lot, sale year, season and priority. Keep that display source separate from the write target. Request, Suspend, Drive, AV and Eval Work publish only exact master receipts. An ambiguous Reclass opens a physical-row choice. Reclass transport recovery replays the same authenticated Edge command and idempotency token through PostgREST. Service Worker updates defer to the page while a detail, modal or upload is open. Restore unsaved fields by account, row and section. Retain local photo previews until the public image loads. An inventory completion lock requires a photo and positive match stock. Suspend Mark Done returns to the scrolled cards after its matching receipt. A classified Dock 38 or 39 review enters the existing Suspend path. A fully staged SOC file continues to publication, and only its receipt qualifies it for 100%. Invariants 472–478 cover queue media, locks, previews, drafts, worker navigation, Reclass recovery and staged SOC continuation.

- On Suspend Mark Done, compute the observed match from exact-row On Hand and preserve it against the available stock at evaluation time for subsequent depletion. Keep photos and the physical tag intact, and return to Suspend cards only after the inventory receipt.

- Never route a Suspend card tap to standalone Drive detail and discard its physical tag identity. Mark Done publishes the full review via the Suspend save transaction. The matching inventory receipt returns the user to the scrolled Suspend queue. Only Complete Tag closes the tag.
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- Never serialize unbounded photo uploads, hide other staged Reclass rows, or treat added candidates as an exact-order replacement. Keep 1280px/200KB JPEG compression, authenticated store_drive_photo_blob_v1 recovery, canonical Drive Item Detail, exact source/group commands with preserved split totals, and statement-level evidence propagation. Invariants 391–393 cover these seams; no new startup read, Code.gs or delivery changes.
- v2.3.142: Never calculate order depletion from On Hand, reset a confirmed completion button, bypass the explicit completed-row lock for an authorized editor, rebuild photo image nodes during field edits, expand measurement-key trays, or filter Eval ownership from a tag sales rep. Use calculateLiveLocPhotoMatch, save_drive_evidence_v3, row-scoped unlocks and the canonical owner command; Invariants 382–385 enforce these behaviors.

- v2.3.127 continuation: Never make an owner batch issue a speculative second write, reuse an unverified actor, fabricate a hold reason from notes, merge beds across LOCATIONCODE + ITEMCODE + SALEYEAR, or sell .Y shift lots as Geo Surplus/Move Up. Use the canonical 12-stage model (Consolidate before Can Filling), persisted seasonal card instructions and Bunch/Spread count workflows. Invariants 297–300 retain single-write receipts, recorded GDD thresholds, lifecycle/group identity and exact direct-read fixtures.

- v2.3.127: Never route Suspend Item Detail MARK DONE through physical tag completion. Save exact evidence and retain the active card; only the main card Complete Tag close command removes eligibility. Email review completion retains its tag and evidence, with existing authorization, approval and outbox behavior. Request completion remains unchanged. Invariant 290 covers the detail route.

- v2.3.119: Retry bounded 55P03/57014 save contention with the original command ID and unchanged payload; never retry account/session, immutable-review or authorization denials. Keep the form responsive while waiting. Invariant 247 covers replay identity and denial termination.

- v2.3.119: Never read navigationSignal from a Suspend photo proof that owns signal. The post-commit fence must use the canonical signal and acknowledge the committed exact row before UI refresh; Invariant 246 exercises active and aborted proofs.

- v2.3.119: Never require optional notification metadata on a successful save or read receipt. Validate an absent notification as an empty object; preserve exact source/session checks and database-owned notification delivery. Invariant 243 covers committed receipts with and without notification metadata.

- v2.3.119: Never block the Request rep picker on directory readiness or bypass explicit public.user_access Y/N capabilities and per-rep N overrides. Keep Nally/Nelly canonical, exact assigned-row authorization, full Flyer access, and the shared save_drive_evidence_v3 publication receipt. A SOC lot mismatch may resolve only to a physical row at the same real item/location; never publish False Block evidence or infer another location. See the access-matrix and zero-regression mutation-engine skills; Invariants 241–242 and the eight pre-commit locks cover these seams.
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

Scope: Preserve Suspend Tag physical identity, assigned-rep or Admin decisions, immutable candidates, and idempotent approval delivery.

### Exact ownership
- assets/app-runtime.js: isFalseBlockLocation, buildSuspendTagActions, openSuspendTagApproval, getSuspendTagStableSourceIdentity, loadCurrentSuspendTagPhotoRow, persistSuspendTagUploadedPhoto, runSuspendTagRowCommand, addSelectedDockSuspendDcRequestOptions.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: module contract.
- Code.gs: module contract.
- supabase/functions/_shared/suspend-tag.ts: handleSuspendTag, verifySuspendTagSession.
- supabase/migrations/20261028145127_agdata_v2394_universal_request_directory_suspend_identity.sql: request_customer_directory_v2394, is_universal_request_tuple_v2394, suspend-physical-identity-v2394.
- supabase/migrations/20261029210000_agdata_v23107_row_workflows.sql: resolve_edit_source_v23107, create_inventory_project_v1.
- assets/row-workflow-functions.js: applySuspendTagInventoryReceipt, publishFlyerInventoryEvidence, suspendTagApi.
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
Read contracts from: test-agdata-suspend-tag-approval-specialist, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-suspend-tag-approval-specialist.

### Runnable verification
- `node scripts/sync-gem-learning-bus.mjs --check`
- `node scripts/enforce-all-gems-gate.mjs`
- SQL inspection: `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';`
Timing goals require measured receipts; local syntax/AST checks do not prove installed SQL, delivery or physical-device timing.

### Forbidden Anti-Patterns (Never Repeat)
- Do not create a competing canonical helper or infer missing SQL columns from prose.
- Do not replace server authorization, exact receipts, private outbox grants or READY/LKG reads with client assumptions.
Do not infer missing historical incidents or treat a documentation sync as executing a model, sending mail, or authorizing a release.
<!-- GEM-BUS:END -->
