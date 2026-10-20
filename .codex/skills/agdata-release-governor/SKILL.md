---
name: agdata-release-governor
description: Deliver scoped AgData releases with actual check results, reusable browser fixtures, local disposable SQL validation and ordered backend/frontend publication.
---

# Release governor

Use the permanent `scripts/run-release-smoke.mjs` harness. Do not create version-numbered check-v23XX scripts, per-version retained-validation files, receipt-hash gates or `.gnc-local/assemble-*` scripts. Historical receipts are archives, not permission to skip selected current checks.

- Run affected business logic, sorting, metric math and recipient cases in Node before browser validation. Target under two seconds for a focused logic suite and report its measured time.
- For modified Edge Functions, run local `deno check` before push, targeting under three seconds with warm dependencies. Do not weaken checks to reach a time target.
- Browser smoke runs Desktop Chromium, Android Chromium and iPhone WebKit concurrently, with sequential cases within each profile and zero retries. Retain the inclusive 2,000 ms render ceiling, zero console/page errors, single-line metrics, no overflow, complete fixture data and no production writes/email assertions.
- Use pre-seeded fixture authentication through addInitScript and a complete 9,487-row reference snapshot indexed once per worker. Target under 5 ms to serve an indexed page; measure setup separately. Production completeness is based on the published snapshot, never a fixed distinct-name threshold.
- Keep an explicit method/path/action allowlist for startup and background fixture reads. Unknown or misspelled routes fail; generic empty-success stubs must not hide missing contracts. Synthetic sessions do not verify real production authentication.
- Keep local validation on Docker Desktop with cached dependencies and browsers. Destructive SQL/trigger checks use disposable local databases. PostgreSQL 15 is a lightweight sandbox; full Supabase compatibility uses the repository's PostgreSQL 17 harness. Paid Build Cloud/Testcontainers Cloud execution is CI-only and disabled until separately configured with quota controls.
- Selected checks must actually execute and succeed. Preserve commit and built-artifact identity, current-main checks and authorization; remove cross-OS log/source receipt requirements, not artifact integrity.
- Frontend-only releases do not wait for backend work. Mixed releases publish changed SQL migrations, Edge Functions, Code.gs, then Pages. Manual and automatic releases use the same selection and ordering rules, with duplicate-publication protection.

Five minutes is a measured delivery target. Stop unrelated work after required checks pass. Keep compact pass summaries and detailed failure evidence; diagnose and rerun only affected checks. Halt after eight consecutive failed corrections of the same issue, retaining evidence. Restore last-known-good publication after a confirmed regression without discarding completed imports or user work.

Explicit task-specific validation overrides take precedence: a tooling-only task may require only focused Node/config checks and reuse historical browser evidence. Label that evidence historical and never claim a new browser/container pass.

The permanent published-snapshot smoke also covers cached-row Reclass during interrupted imports and stale permission refresh: Desktop uses Dylan, Android uses Megan, and iPhone uses JD. It holds exact item hydration until quantities, Hold and notes are drafted, verifies late hydration preserves those drafts, and submits through explicitly intercepted atomic move/live-field responses. Keep the report state labeled queued; these synthetic fixtures perform no production writes or real email delivery.
