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

- Never render or authorize Suspend decisions from a generic Request card, username text alone, cached role flags, or client-supplied assignee identity.
- Never broaden approval to every sales rep or let a stale/non-pending approval accept a decision.
