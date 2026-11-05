---
name: agdata-request-queue-and-email-delivery-fortress
description: Maintain durable Request queue visibility, N/A folder submissions and confirmed multi-recipient email delivery.
---

# agdata request queue and email delivery fortress

## Owned Files, Canonical Functions & SQL Contracts
Request submission → Que → REQUEST → durable outbox → Apps Script receipt.
assets/app-runtime.js (reconcileIncomingRequestRows, getScopedRequestItems), assets/request-submission.js, public.ph_requests_pending / ph_active_request, get_request_capabilities, Code.gs (buildRequestDeliveryEmailPayload_, sendGmailApiMessage_).

## Cross-Layer Blast Radius
Use the existing switchView, goBackUniversal, header/search ownership and modal Back handlers. Preserve identity-scoped READY/LKG reads and server-authorized mutations. A skill does not authorize a deployment or email send.

Use docs/architecture/agdata-module-dependency-map.md for the canonical shared contracts. Runtime/Apps Script changes preserve SQL mutation authorization and READY/LKG reads; the scoped SOC migration changes staging cleanup only.

## Focused verification
```sh
node --test tests/operational-resilience.test.mjs
```
Run tests/operational-resilience.test.mjs; golden Invariants 356–358 and scripts/enforce-all-14-gems-gate.mjs own these contracts. Retain Planting Invariant 355. Browser timings are measured on hydrated data; physical native keyboard behavior needs device verification.

## Forbidden Anti-Patterns (Never Repeat)
- v2.3.139: Never interpret view_all_requests as a module view or infer pending visibility from edit permissions/role scope. Its top-level Y/N controls all pending rows versus canonical Assigned Items Effective Worker itemcodes plus the submitting actor; preserve the documented super-admin/Dylan/Nelly/JD fail-safe, aliases, explicit N for other users, immediate role/user cascades and rollback. Roster users awaiting password setup remain editable for this display capability without enabling their logins or other mutations. Invariants 371–372 enforce display scope and isolated saves. No production assignments or requests may be mutated by verification.
- v2.3.138 completion: Never leave the live submitted_by column out of generated Request read contracts: strict validation rejects every valid row and trips read cooldown. Preserve all pending rows for server-global queue scopes and keep schema type checks (Invariant 365).
- Never erase newly acknowledged pending requests with stale reads; only explicit lifecycle receipts retire them. Never discard row-selected recipient_emails. Never broaden anonymous writes to repair a worker. Keep the active-recipient handover and event-specific email policies.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Maintain durable Request queue visibility, N/A folder submissions and confirmed multi-recipient email delivery.

### Exact ownership
- assets/app-runtime.js: getScopedRequestItems, canViewAllRequests, getRequestAssignedItemcodeScope.
- Code.gs: buildRequestDeliveryEmailPayload_, requestDeliveryRest_.
- assets/row-workflow-functions.js: reconcileIncomingRequestRows.
- DOM: No DOM mutation owned; inspect the consuming domain.
- PostgreSQL: ph_requests_pending, ph_active_request
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-request-queue-and-email-delivery-fortress, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-request-queue-and-email-delivery-fortress.

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
