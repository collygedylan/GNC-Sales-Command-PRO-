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
- v2.3.138 completion: Never leave the live submitted_by column out of generated Request read contracts: strict validation rejects every valid row and trips read cooldown. Preserve all pending rows for server-global queue scopes and keep schema type checks (Invariant 365).
- Never erase newly acknowledged pending requests with stale reads; only explicit lifecycle receipts retire them. Never discard row-selected recipient_emails. Never broaden anonymous writes to repair a worker. Keep the active-recipient handover and event-specific email policies.
