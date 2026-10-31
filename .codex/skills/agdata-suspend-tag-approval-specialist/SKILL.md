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
