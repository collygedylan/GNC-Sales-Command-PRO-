---
name: agdata-email-outbox-and-worker-guard
description: Preserve private durable email outbox writes, service-role Apps Script workers, immediate wakes, retries, and confirmed recipient contracts.
---

# Email Outbox and Worker Guard

Load with the feature skill that creates an email, plus `agdata-sync-and-supabase-architect` and `agdata-release-governor` for deployment changes.

Read [the canonical dependency map](../../../docs/architecture/agdata-module-dependency-map.md); delivery status must not disrupt `goBackUniversal` or any loaded operational view.

## Contracts

- `ph_request_delivery_outbox`, worker state, email threads, delivery mutations, and worker RPCs are service-role only. Browser roles never receive operational write access.
- `Code.gs` resolves only a validated service-role secret for Supabase writes. Deployment reconciliation stores that validated secret and the action-signing secret in Script Properties; never fall back to anon/publishable keys.
- Every durable Request or Reclass event is immediately wakeable, leased, retryable, and idempotent. A queued event is not reported as delivered until its channel receipt confirms delivery.
- Reclass recipients remain Dylan, Megan, Sharon, and the submitting actor through the server resolver. Preserve other feature-specific recipient contracts.

## Owned Files, Canonical Functions & SQL Contracts

- `Code.gs`: `resolveSupabaseServiceRoleKey_`, `getSupabaseHeaders_`, `reconcileAppsScriptActionSigningKey_`, `processRequestDeliveryOutbox_`, and signed wake routes.
- SQL: delivery outbox/worker/thread relations plus claim, complete, fail, heartbeat, channel-result, requeue, and recovery RPCs.
- Backend: outbox enqueue, `dispatchRequestDeliveryWorkerNow`, signed Apps Script actions, and `request-delivery-worker` wake dispatch.

## Cross-Layer Blast Radius

- Runtime/App API mutations enqueue SQL events; app-api wakes the worker; `Code.gs` claims with service-role credentials and records final channel receipts without exposing browser writes.

## Focused Verification

```sh
node --test tests/apps-script-sync.test.mjs tests/reclass-recipient-policy.test.mjs tests/golden-invariants.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)

- Never repair a missing worker credential by granting anonymous operational writes, permissive public RLS, all-function execute, or access to private identity tables.
- Never use `SUPABASE_KEY` or a publishable key for imports/delivery, silently swallow a failed lease, or claim an email sent from queue insertion alone.
