---
name: agdata-release-governor
description: Deliver scoped AgData releases through fast daytime checks and ordered publication, while retaining full regression coverage in Nightly Validation.
---

# Release governor

Use the existing release tooling. Do not create version-numbered check-v23XX scripts, per-version retained-validation files, receipt-hash gates or `.gnc-local/assemble-*` scripts. Historical receipts are archives, not permission to claim new validation.

- Daytime feature/bug-fix validation uses only `npm run check:inline` plus `node scripts/prepare-release-site.mjs` (combined target under 5 seconds), `deno check` for changed `supabase/functions/**` (under 5 seconds), and focused Node tests for the touched feature (under 10 seconds). Run a targeted single-file SQL check only for a changed migration/RPC. Report measured times; preserve acceptance and authorization checks.
- Do not run `scripts/run-release-smoke.mjs`, Playwright/browser suites, Docker image builds, the full historical Node matrix, or full migration/database replays during daytime feature releases unless the user explicitly requests them. A failing or slow focused check does not authorize a broader suite.
- Full regression coverage belongs to `nightly-validation.yml`, scheduled for 8:30 PM America/Chicago or explicitly dispatched with `full_regression: true`. Retain the four-shard Node suite, full backend/SQL/import matrix and browser/performance coverage there.
- When browser validation is authorized, use the permanent `scripts/run-release-smoke.mjs` harness with Desktop Chromium, Android Chromium and iPhone WebKit concurrently, sequential cases within each profile and zero retries. Retain the inclusive 2,000 ms render ceiling, zero console/page errors, single-line metrics, no overflow, complete fixture data and no production writes/email assertions.
- Use pre-seeded fixture authentication through addInitScript and a complete 9,487-row reference snapshot indexed once per worker. Target under 5 ms to serve an indexed page; measure setup separately. Production completeness is based on the published snapshot, never a fixed distinct-name threshold.
- Keep an explicit method/path/action allowlist for startup and background fixture reads. Browser-aborted read-only requests and telemetry cancellation do not require hardcoded body contracts; unknown routes and unmocked mutations remain rejected. Generic empty-success stubs must not hide missing data contracts. Synthetic sessions do not verify real production authentication.
- Authorized destructive SQL/trigger checks use disposable local databases or rolled-back transactions. Use Docker Desktop with cached dependencies when container validation is explicitly requested; do not start a full replay to prepare a daytime targeted check. Paid Build Cloud/Testcontainers Cloud execution is CI-only and disabled until separately configured with quota controls.
- Selected checks must actually execute and succeed. Preserve commit and built-artifact identity, current-main checks and authorization; remove cross-OS log/source receipt requirements, not artifact integrity.
- Frontend-only releases do not wait for backend work. Mixed releases publish changed SQL migrations, Edge Functions, Code.gs, then Pages. Manual and automatic releases use the same selection and ordering rules, with duplicate-publication protection.

Standard main pushes use only the fast inline/static gate, changed-Edge type check, and `scripts/run-tooling-release-checks.mjs` (under 15 seconds). Target a gate under 45 seconds, scoped publication under 60 seconds and total GitHub Actions delivery under 2 minutes. Tooling-only releases make zero runtime changes and must not redeploy older application changes solely because a publication baseline differs.

Stop unrelated work after required checks pass. Keep compact pass summaries and detailed failure evidence; diagnose and rerun only affected checks. Halt after eight consecutive failed corrections of the same issue, retaining evidence. Restore last-known-good publication after a confirmed regression without discarding completed imports or user work.

Explicit task-specific validation overrides take precedence: a tooling-only task may require only focused Node/config checks and reuse historical browser evidence. Label that evidence historical and never claim a new browser/container pass.

The permanent published-snapshot smoke also covers cached-row Reclass during interrupted imports and stale permission refresh: Desktop uses Dylan, Android uses Megan, and iPhone uses JD. It holds exact item hydration until quantities, Hold and notes are drafted, verifies late hydration preserves those drafts, and submits through explicitly intercepted atomic move/live-field responses. Keep the report state labeled queued; these synthetic fixtures perform no production writes or real email delivery.
