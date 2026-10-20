# CRITICAL: Zero-Downtime, Zero-Lockout & Autonomous Execution Protocols

These protocols govern all engineering, testing, and deployment work across the AgData repository. Completion summaries must report only verified outcomes and measured metrics in 2–3 concise sentences.

**Autonomous Operational Decisions:** Make backend, performance, and scheduling decisions without asking for confirmation. Automatically throttle, pause, or reschedule processes that create database contention or threaten UI responsiveness. Historical backfill may run only from 11:30 PM inclusive to 6:15 AM exclusive in `America/Chicago` (and must remain PAUSED whenever explicitly instructed). Preserve completed work, resumable cursors, protected live fields, and atomic publication.

**Model, Quota & Subscription Autonomy:**
- **OpenAI Codex Token & Effort Hygiene:** Execute with surgical precision (`Medium` / `High` effort). Stop immediately and deploy once all required checks pass—never invent unprompted post-pass edge-case rewrites. Keep test output quiet (print compact pass/fail summaries; dump full stack traces only on failure) to prevent context-compaction loops.
- **Docker Business Quota Protection:** Always use **local `Docker Desktop`** (`docker compose` / `docker buildx` with local BuildKit cache mounts) for local validation containers and disposable Postgres 15 SQL fault tests (`0` cloud minutes consumed locally). Reserve **Docker Build Cloud** and **Testcontainers Cloud** (`1,500 min/month` each) strictly for GitHub Actions CI runs.
- **Supabase Pro Protection:** Run all destructive SQL and trigger fault-injection tests (such as simulated `INTERRUPTED` imports, lineage faults, or Reclass trigger rollbacks) inside disposable local Docker Postgres containers or rolled-back transactions—never leave live production datasets marked `INTERRUPTED`. Use the live Supabase MCP integration strictly for read-only schema/contract verification, Postgres log audits, and applying validated production migrations.

**Global Zero-Lockout Mandate (Fail-Open / Stale-While-Revalidate Everywhere):**
- **Never Lock Out Any Screen, Tab, Module, or Authenticated User:** Under no circumstances may a running, queued, timed-out, or interrupted import—or a background permission/session refresh—blank the UI, disable bottom-navigation tabs (`Manager`, `Docks`, etc.), or hide loaded/cached data.
- **Banned Lockout Screens:** Never render full-screen or inline lockout gates such as `Verifying updated access` (`Your access changed. Previous data is hidden...`), `Drive Inventory unavailable`, `Data could not be verified. Retry when the service is available.`, `Showing saved data - Needs attention - Retry`, `Load Failed: An import was interrupted`, or `Row Details Unavailable`.
- **Always Serve Last-Known-Good Data:** Always read from the latest completed `READY` snapshot and retain same-account cached data during background refreshes. Open Row Details and `Reclass` modals immediately from the displayed card while refreshing the exact row in the background without overwriting user drafts. Never kick an authenticated user back to the `Welcome back` login screen unless they explicitly click `Log Out` / `Use another account` or a confirmed server-side role revocation occurs.

---

# 🧠 PILLAR 0: MODULAR NURSERY SKILL ARCHITECTURE (`.codex/skills/`)

Before modifying any module, load and follow the corresponding domain skill(s) from `.codex/skills/`:

1. `.codex/skills/agdata-drive-and-av-specialist/SKILL.md` — `Drive Mode`, `AV`, `Inventory`, `EXPORT EXCEL`, full 9,486+ row (`1,566+` Common Names `A`–`Z`) hydration, drill-downs (`COMMONNAME` -> `CONTSIZE` -> `SEASON`), and all 6 single-line metrics (`On Hand`, `Review`, `Available`, `Open Stock`, `Loc Photo Match`, and numeric `Loc On Hand` summed across all lots for `itemcode + locationcode`).
2. `.codex/skills/agdata-bloom-and-request-specialist/SKILL.md` — `Bloom Picker` tray, all 9 Bloom actions (`Assign`, `Eval Work`, `Submit QC`, `Request`, `Location Move`, `Flyer`, `Take Back`, `2nd Cut`, `Shear`), and the 5-step `CREATE REQUEST` wizard (`Sales Rep` -> `Customer` -> `Consignee` -> `Folder` -> `ITEM 1 OF N` -> `TX/OK/NE/ADMIN/EVAL/ADV` territory email chain).
3. `.codex/skills/agdata-queue-and-reclass-specialist/SKILL.md` — `Que -> SUSPEND` (1 physical spreadsheet row = 1 card via unique tag line ID), `Que -> REQUEST`, natural `locationcode` ascending sort, `DriveAround` metric joins, and atomic `Reclass Item Inquiry` live updates + full HTML/PDF email reports sent **strictly** to `dylan_collyge`, `megan_kelly`, and the submitting user (never `jd_jones` or `sunday_ellis`).
4. `.codex/skills/agdata-field-ops-and-qc/SKILL.md` — `Managers`, `QC`, `Production`, and field sub-queues (`LOCATION MOVES`, `RECOUNT`, `SHEAR LIST`, `EVAL WORK`, `BUNCH NOTES`), preserving in-app crew tasks and overwintering notes across daily ERP imports.
5. `.codex/skills/agdata-docks-and-orders-specialist/SKILL.md` — `Docks`, `HL Order`, `Office`, `Comm`, `SOC-10-Open-Orders`, `SOC-10-Reserves`, and `Warehouse Assigned Items`.
6. `.codex/skills/agdata-sync-and-supabase-architect/SKILL.md` — `Home` status cards (`DRIVE`, `SOC`, `RESERVES`, `CAV` showing single latest filename), `RUN SCRIPT` `< 500 ms` fast-skip (`UP_TO_DATE`) on unchanged Google Drive files, chunked `120s` upserts, and non-blocking stage continuation.
7. `.codex/skills/agdata-zero-lockout-guard/SKILL.md` — Global fail-open reads, instant Row Details / Reclass opening, session persistence, and `v2.1.x` Service Worker cache purging.
8. `.codex/skills/agdata-release-governor/SKILL.md` — Fast `< 5 minute` verification pipeline, frozen Playwright harness (`scripts/run-release-smoke.mjs`), explicit background-read allowlist stubs, and `<= 2,000 ms` render ceiling.
9. `.codex/skills/agdata-skill-learner/SKILL.md` — Continuous self-learning: whenever a new feature, table, or RPC is added, register any new startup/background read in the shared Playwright fixture allowlist and update the matching `.codex/skills/<name>/SKILL.md` file in the same commit.

---

# 🛑 PILLAR 1: STRICT SCOPE AND WORKSPACE HYGIENE

1. **Controlled Scope:** Make backend, performance, scheduling, and deployment changes necessary to deliver the authorized task autonomously. Keep changes isolated and reviewable; do not refactor unrelated code.
2. **Autonomous Blocker Resolution:** Diagnose and fix bugs, race conditions, or deployment gaps that block the authorized task or threaten production responsiveness.
3. **Surgical Precision & No Throwaway Scripts:** Only read and modify the specific files required to complete the explicit feature request. Never create version-numbered throwaway validation scripts (`scripts/check-v23XX-...`, `.gnc-local/assemble-*`, or `docs/releases/v2.3.XX-retained-validation.json`).
4. **Strict Workspace Synchronization:** Verify the local workspace is clean and synchronized with `origin/main` before starting work. Enforce `LF` line endings across all text files via `.gitattributes`.

---

# 🏗️ PILLAR 2: ARCHITECTURE, SECURITY & QUALITY

5. **Separation of Concerns (SoC) & Modular Design:** Decouple UI presentation from business logic and database operations.
6. **Strict Type Safety & Local Pre-Check:** Never use implicit `any` types. Whenever `supabase/functions/**` is modified, run a fast local `deno check` (`< 3s`) before `git push` so TypeScript null-guard issues are caught locally before CI.
7. **Zero Feature Regression:** Never remove existing UI elements, buttons, features, or workflows unless explicitly instructed. Preserve all RLS and RBAC permissions on mutations while keeping read views fail-open for authorized users.
8. **Test-Driven Remediation (< 2s Node Tests First):** Validate all business logic, sorting, metric math, and recipient lists in fast Node unit tests (`< 2s`) before running any browser check.

---

# ⚡ PILLAR 3: RESILIENCY & PERFORMANCE STANDARDS

9. **Amazon-Grade Performance & State:** Pre-fetch and cache dictionary/lookup data locally using SWR (`stale-while-revalidate`). Dropdowns, modals, and UI filters must respond immediately client-side without blocking on network calls.
10. **Pre-Flight Timing Gate (`<= 2,000 ms` UI Ceiling):**
    - When a frontend UI change requires a Playwright smoke check (`scripts/run-release-smoke.mjs`), run `Desktop`, `Android`, and `iPhone` profiles in parallel (with cases inside each profile running sequentially) using a pre-seeded auth fixture (`addInitScript`) and the one-time pre-indexed 9,487-row fixture (`< 5 ms` per page).
    - The inclusive frontend UI render ceiling across Desktop, Android, and iPhone emulators is **`<= 2,000 ms`** (with `0` console/page errors and single-line metric boxes). Interactive database queries must remain below `100 ms` (`1,000 ms` for atomic 100-row Reclass batches; `120s` statement timeout for chunked bulk imports). Do not block releases on container CPU jitter below `2,000 ms`, and never require cross-OS SHA-256 receipt-hash files to merge.
11. **Idempotent Transactions:** All database writes and form submissions must be idempotent with inflight button protection.

---

# 🚀 PILLAR 4: AUTONOMOUS `< 5 MINUTE` CI/CD DEPLOYMENT PROTOCOL

12. **Evidence-Based Recovery and Eight-Attempt Stop:** After a failure, inspect the root cause, apply a targeted fix, and rerun only the affected check. Halt only if the exact same failure persists after eight consecutive attempts.
13. **Decoupled, Direct Deployment Pipeline:**
    - **Decoupled Pipelines:** GitHub Pages frontend publication (`pages-static.yml`) and Supabase/Apps Script backend deployments (`publish-candidate.yml`) are decoupled so unchanged backend gates never block a frontend release, and manual/automatic triggers both publish cleanly without receipt-hash bureaucracy.
    - **Ordered Full-Stack Releases:** When a release modifies both backend and frontend, apply Supabase SQL migrations and Edge Functions first, apply any `Code.gs` patch second, and publish the GitHub Pages frontend immediately upon completion.
