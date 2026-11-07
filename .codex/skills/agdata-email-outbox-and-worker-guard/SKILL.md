---
name: agdata-email-outbox-and-worker-guard
description: Preserve private durable email outbox writes, service-role Apps Script workers, immediate wakes, retries, and confirmed recipient contracts.
---

## Authorized cleanup (2026-11-07)

The user has authorized pruning proven obsolete Apps Script versions without version-by-version questions. Preserve the production version plus five newest other rollback versions and every active deployment/pinned-library reference. Back up the deployed baseline before pruning; preserve unrelated unpublished HEAD drift during scoped publication. Only remove triggers with verified duplicate handler/type/source/owner/schedule. Follow AGENTS.md for retained production/history resources and host access gates; business authorization does not bypass a saved browser denial.


## Canonical live release sequence
AgData v3.0.0 starts the current sequence: 3.0.0 -> 3.0.1 -> 3.0.2. All future work and publication target only the live root PWA on main and gh-pages. The retired environment must never be restored, mirrored, or published. Earlier release labels below are historical evidence, not the current release or numbering sequence.


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
- v2.3.143: Register changed existing attachment helpers in both package.json and the scoped merger allowlist; prove remote-only production routes survive the patch (Invariant 398).
- v2.3.143: Never retry an unhealthy Storage gateway for every photo. Keep the 900ms first probe, five-minute identity-scoped storageGatewayCooldownUntil, authenticated store_drive_photo_blob_v1 and 1280px / 0.82 / 200KB compression. Index fallback metadata in the authorized Photo History catalog; preserve bucket/Drive history and the storage deletion guard. Cache metadata repair is service-only, LIMIT 200 FOR UPDATE SKIP LOCKED with 30s statement and 5s lock limits; metadata changes do not prove CDN headers. Invariants 395–397 enforce these seams.
- v2.3.138: Never treat enqueueing as delivery or drop selected recipients. Request lifecycle core is Dylan, Kayla (resolved through the existing Nelly handover), JD, Megan and Nelly, plus submitter, selected rep and extras. Bunch-only Dylan restrictions never apply to Request events (Invariant 357).
- v2.3.130: Never leave transformed photo URLs in cache keys, poll closed/hidden background UI, persist routine watchdog diagnostics, or emit success Edge logs. Keep signed cloud relays independent of the browser, protect referenced receipts and private grants, and verify empty CLI receipts against installed contracts (Invariants 323–326).

- Never trust a Bunch Note preview or outbox recipient snapshot at dispatch time; the worker must resolve Dylan's active address and replace, not merge, all stored recipients.
- Never add a changed `Code.gs` delivery entrypoint to `package.json#appsScriptPatchFunctions` without also authorizing it in the scoped merger allowlist and additive-function set; the production guard must prove the exact function can reach `@HEAD` without widening remote-only routes.

- Never repair a missing worker credential by granting anonymous operational writes, permissive public RLS, all-function execute, or access to private identity tables.
- Never use `SUPABASE_KEY` or a publishable key for imports/delivery, silently swallow a failed lease, or claim an email sent from queue insertion alone.

- A scoped Apps Script dispatcher patch must include every referenced event-type declaration; a missing unrelated route constant aborts ordinary Request delivery before Gmail. Invariant 362 exercises the merged live dispatcher.

<!-- GEM-BUS:START -->
## Shared Engineering Contract

Scope: Preserve private durable email outbox writes, service-role Apps Script workers, immediate wakes, retries, and confirmed recipient contracts.

### Exact ownership
- assets/app-runtime.js: module contract.
- assets/runtime-watchdog.js: module contract.
- supabase/functions/app-api/index.ts: dispatchRequestDeliveryWorkerNow.
- Code.gs: resolveSupabaseServiceRoleKey_, getSupabaseHeaders_, reconcileAppsScriptActionSigningKey_, processRequestDeliveryOutbox_, handleSignedBunchNoteDelivery_.
- supabase/migrations/20261026170000_agdata_v2371_request_suspend_email_and_lock_cleanup.sql: claim_request_delivery_events, ph_request_delivery_outbox.
- supabase/migrations/20261027211049_agdata_v2390_universal_fill_tag_bunch_dylan_reclass_lot_cap.sql: ph_location_sales_notes, bunch_note_private.recipients_for_reports, reclass-move-up-open-stock-v2390.
- supabase/migrations/20261102010000_v23133_resolve_delivery_order_violations.sql: get_eval_request_delivery_health_snapshot_v2, ph_prune_supabase_bloat_v1, private.request_delivery_order_reconciliations_v23133.
- DOM: #apps
- PostgreSQL: ph_request_delivery_outbox
Inspect installed constraints/indexes/triggers through pg_catalog before changing SQL; source contracts are not installed-state receipts.

### Preconditions
Read .gnc-local/gem-shared-memory-bus.json and the owning symbol-index entries. Resolve actor, environment, exact row and existing receipt before mutation. Test twins use sandbox apztnscvagayslumnalr and the explicit test namespace map.

### Postconditions and invariant equations
- Use the canonical owning module contract; preserve exact actor, row identity, navigation and source-specific receipts.
- committed success ⇒ matching actor + command identity + exact durable receipt; failure ⇒ draft and last-known-good display retained.
- production mutations from test = 0; test email recipient set ⊆ {dylan_collyge@greenleafnursery.com}.

### Cross-Gem Dependencies
Read contracts from: test-agdata-email-outbox-and-worker-guard, agdata-cross-gem-memory-bus-orchestrator, agdata-db-cmu-chief-schema-and-constraint-architect, agdata-app-shell-and-navigation. Publish reviewed changes through scripts/sync-gem-learning-bus.mjs; subscribers are the reverse dependency edges in .gnc-local/gem-shared-memory-bus.json. Twin: test-agdata-email-outbox-and-worker-guard.

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

## AgData v3.0.16 permanent repair law

Each verified Request completion has one idempotent row event; pending update/delete and completed-history insert/update hooks feed the existing private outbox and wake contract. History audit rows whose last_event is updated are not completion proof, even if a legacy trigger stamps their status Complete. Do not finish other folder members or resend already-delivered events to unblock one email. All photos render inline through existing worker helpers. A Gmail/channel receipt establishes SENT; the installed outbox status is delivered. New user authorization allows pruning oldest unused Apps Script versions only when capacity actually blocks a required deployment, after checking deployment references and retaining source backup.

### Forbidden Anti-Patterns (Never Repeat)

Do not regress this contract through stale snapshots, duplicate owners or a source-only proof that omits the actual route, card structure or delivery receipt. Preserve existing authorization, exact physical identity and durable persistence truth.
