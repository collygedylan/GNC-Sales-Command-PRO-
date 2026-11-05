---
name: test-agdata-email-outbox-and-worker-guard
description: Preserve private durable email outbox writes, service-role Apps Script workers, immediate wakes, retries, and confirmed recipient contracts.
---

## Test isolation authority

This skill governs AgData Test (T) only. The explicit Test build request supersedes donor release instructions. Application paths are under `test/`; database relations/RPCs use the explicit test namespace in the dedicated Supabase sandbox `apztnscvagayslumnalr`; private schemas start with `test_`. Use `farm-operations-staging` for new media and route every outgoing email only to `dylan_collyge@greenleafnursery.com`. Never execute a donor production release command, call a live Edge endpoint, modify live credentials, or move live ERP input files. The live source is a read-only donor.

All mutation checks remain server authoritative. A test table-name rewrite alone is insufficient: inspect recursive SQL dependencies, auth state, workers, Realtime channels, browser storage, service-worker cache ownership, Drive folders and outbound calls. Clone background work in an inert state; only newly created test jobs may execute. No source or schema is promoted automatically.

Donor version notes and test names below are historical contracts, not evidence that this test application has passed them. Resolve commands against the actual test implementation before running them.



# Email Outbox and Worker Guard

Load with the feature skill that creates an email, plus `test-agdata-sync-and-supabase-architect` and `test-agdata-release-governor` for deployment changes.

Read [the canonical dependency map](../../../docs/architecture/test-agdata-module-dependency-map.md); delivery status must not disrupt `goBackUniversal` or any loaded operational view.

## Contracts

- `test_ph_request_delivery_outbox`, worker state, email threads, delivery mutations, and worker RPCs are service-role only. Browser roles never receive operational write access.
- `test/workers/email/Code.gs` resolves only a validated service-role secret for Supabase writes. Deployment reconciliation stores that validated secret and the action-signing secret in Script Properties; never fall back to anon/publishable keys.
- Every durable Request or Reclass event is immediately wakeable, leased, retryable, and idempotent. A queued event is not reported as delivered until its channel receipt confirms delivery.
- Reclass recipients remain Dylan, Megan, Sharon, and the submitting actor through the server resolver. Preserve other feature-specific recipient contracts.

## Owned Files, Canonical Functions & SQL Contracts

- `test/workers/email/Code.gs`: `resolveSupabaseServiceRoleKey_`, `getSupabaseHeaders_`, `reconcileAppsScriptActionSigningKey_`, `processRequestDeliveryOutbox_`, and signed wake routes.
- SQL: delivery outbox/worker/thread relations plus claim, complete, fail, heartbeat, channel-result, requeue, and recovery RPCs.
- Backend: outbox enqueue, `dispatchRequestDeliveryWorkerNow`, signed Apps Script actions, and `request-delivery-worker` wake dispatch.

## Cross-Layer Blast Radius

- Runtime/App API mutations enqueue SQL events; app-api wakes the worker; `test/workers/email/Code.gs` claims with service-role credentials and records final channel receipts without exposing browser writes.

## Focused Verification

```sh
node --test test/tests/apps-script-sync.test.mjs test/tests/reclass-recipient-policy.test.mjs test/tests/golden-invariants.test.mjs
```

## Forbidden Anti-Patterns (Never Repeat)
- v2.3.143: Register changed existing attachment helpers in both package.json and the scoped merger allowlist; prove remote-only production routes survive the patch (Invariant 398).
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated test_store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- v2.3.138: Never treat enqueueing as delivery or drop selected recipients. Request lifecycle core is Dylan, Kayla (resolved through the existing Nelly handover), JD, Megan and Nelly, plus submitter, selected rep and extras. Bunch-only Dylan restrictions never apply to Request events (Invariant 357).
- v2.3.130: Never leave transformed photo URLs in cache keys, poll closed/hidden background UI, persist routine watchdog diagnostics, or emit success Edge logs. Keep signed cloud relays independent of the browser, protect referenced receipts and private grants, and verify empty CLI receipts against installed contracts (Invariants 323–326).

- Never trust a Bunch Note preview or outbox recipient snapshot at dispatch time; the worker must resolve Dylan's active address and replace, not merge, all stored recipients.
- Never add a changed `test/workers/email/Code.gs` delivery entrypoint to `package.json#appsScriptPatchFunctions` without also authorizing it in the scoped merger allowlist and additive-function set; the production guard must prove the exact function can reach `@HEAD` without widening remote-only routes.

- Never repair a missing worker credential by granting anonymous operational writes, permissive public RLS, all-function execute, or access to private identity tables.
- Never use `SUPABASE_KEY` or a publishable key for imports/delivery, silently swallow a failed lease, or claim an email sent from queue insertion alone.

- A scoped Apps Script dispatcher patch must include every referenced event-type declaration; a missing unrelated route constant aborts ordinary Request delivery before Gmail. Invariant 362 exercises the merged live dispatcher.
