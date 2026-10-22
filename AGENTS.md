# CRITICAL: Zero-Downtime, Zero-Lockout & Autonomous Execution Protocols

These protocols govern all engineering, testing, and deployment work across the AgData repository. Completion summaries must report only verified outcomes and measured metrics in 2–3 concise sentences.

**Autonomous Operational Decisions:** Make backend, performance, and scheduling decisions without asking for confirmation. Automatically throttle, pause, or reschedule processes that create database contention or threaten UI responsiveness. Historical backfill may run only from 11:30 PM inclusive to 6:15 AM exclusive in `America/Chicago` (and must remain PAUSED whenever explicitly instructed). Preserve completed work, resumable cursors, protected live fields, and atomic publication.

**Production AI and Runtime Watchdog Boundary:** Production AI agents and the runtime watchdog are read-only by default. They may inspect authorized production context and prepare a proposed patch or fix brief, but must not autonomously write production data or source files, commit or push, or publish/deploy. Source or production changes require an explicit user release prompt naming the reviewed change and authorized action; local implementation permission alone does not authorize production writes, push, or deployment.

**Model, Quota & Subscription Autonomy:**
- **OpenAI Codex Token & Effort Hygiene:** Execute with surgical precision (`Medium` / `High` effort). Stop immediately and deploy once all required checks pass—never invent unprompted post-pass edge-case rewrites. Keep test output quiet (print compact pass/fail summaries; dump full stack traces only on failure) to prevent context-compaction loops.
- **Effort Defaults:** Use `low` reasoning for CSS, copy, and configuration work; use `medium` for standard multi-file fixes. Avoid `xhigh` reasoning.
- **Bounded Source Reading:** Never read entire monolithic files (`index.html`, `assets/app-runtime.js`, `supabase/functions/app-api/index.ts`, or `Code.gs`) into context. Locate code with `rg -n` and inspect slices of no more than 120 lines; load only the relevant skill sections.
- **Batched Tool Use:** Batch independent searches, reads, and checks in parallel where practical, and target completion within 12 tool-call turns.
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
3. `.codex/skills/agdata-queue-and-reclass-specialist/SKILL.md` — `Que -> SUSPEND` (1 physical spreadsheet row = 1 card via unique tag line ID), `Que -> REQUEST`, natural `locationcode` ascending sort, `DriveAround` metric joins, and atomic `Reclass Item Inquiry` live updates + full HTML/PDF email reports sent **strictly** to `dylan_collyge`, `megan_kelly`, `sharon_combs`, and the submitting user. `jd_jones` and `sunday_ellis` are not automatic CC recipients; either still receives their own submission as the actor, subject to the server's active confirmed recipient resolver.
4. `.codex/skills/agdata-field-ops-and-qc/SKILL.md` — `Managers`, `QC`, `Production`, and field sub-queues (`LOCATION MOVES`, `RECOUNT`, `SHEAR LIST`, `EVAL WORK`, `BUNCH NOTES`), preserving in-app crew tasks and overwintering notes across daily ERP imports.
5. `.codex/skills/agdata-docks-and-orders-specialist/SKILL.md` — `Docks`, `HL Order`, `Office`, `Comm`, `SOC-10-Open-Orders`, `SOC-10-Reserves`, and `Warehouse Assigned Items`.
6. `.codex/skills/agdata-sync-and-supabase-architect/SKILL.md` — `Home` status cards (`DRIVE`, `SOC`, `RESERVES`, `CAV` showing single latest filename), `RUN SCRIPT` `< 500 ms` fast-skip (`UP_TO_DATE`) on unchanged Google Drive files, chunked `120s` upserts, and non-blocking stage continuation.
7. `.codex/skills/agdata-zero-lockout-guard/SKILL.md` — Global fail-open reads, instant Row Details / Reclass opening, session persistence, and `v2.1.x` Service Worker cache purging.
8. `.codex/skills/agdata-release-governor/SKILL.md` — Fast daytime checks and ordered scoped publication; full browser, database, and performance coverage belongs to Nightly Validation.
9. `.codex/skills/agdata-skill-learner/SKILL.md` — Continuous self-learning: whenever a new feature, table, or RPC is added, register any new startup/background read in the shared Playwright fixture allowlist and update the matching `.codex/skills/<name>/SKILL.md` file in the same commit.
10. `.codex/skills/agdata-app-shell-and-navigation/SKILL.md` — Shared view router, Home/Menu/footer, header/search/Back ownership, breadcrumb/history stack, modal delegation and theme chrome; load with a feature skill whenever navigation changes.
11. `.codex/skills/agdata-aura-assistant/SKILL.md` — AURA voice/query lifecycle, per-account capabilities, bounded inventory/history/SOC analytics, reviewed draft actions and the separate legacy assistant boundary.
12. `.codex/skills/agdata-runtime-watchdog/SKILL.md` — Passive runtime load/error telemetry, bounded incident persistence and the authorized Manager review panel.

Use [the canonical module dependency map](docs/architecture/agdata-module-dependency-map.md) for exact functions, shared state, backend contracts and the 1–3 focused Node targets for each cluster. Its source inventory is an audit snapshot, not a release receipt or permission to skip current checks. Register skill additions in `scripts/run-tooling-release-checks.mjs`; preserve shared Back/navigation dependencies in every domain skill.

---

# 🛑 PILLAR 1: STRICT SCOPE AND WORKSPACE HYGIENE

1. **Controlled Scope:** Make backend, performance, scheduling, and deployment changes necessary to deliver the authorized task autonomously. Keep changes isolated and reviewable; do not refactor unrelated code.
2. **Autonomous Blocker Resolution:** Diagnose and fix bugs, race conditions, or deployment gaps that block the authorized task or threaten production responsiveness.
3. **Surgical Precision & No Throwaway Scripts:** Only read and modify the specific files required to complete the explicit feature request. Never create version-numbered throwaway validation scripts (`scripts/check-v23XX-...`, `.gnc-local/assemble-*`, or `docs/releases/v2.3.XX-retained-validation.json`).
4. **Strict Workspace Synchronization:** Verify the local workspace is clean and synchronized with `origin/main` before starting work. Enforce `LF` line endings across all text files via `.gitattributes`.

---

# 🏗️ PILLAR 2: ARCHITECTURE, SECURITY & QUALITY

5. **Separation of Concerns (SoC) & Modular Design:** Decouple UI presentation from business logic and database operations.
6. **Strict Type Safety & Local Pre-Check:** Never use implicit `any` types. Whenever `supabase/functions/**` is modified, run a fast local `deno check` (`< 5s`) before `git push` so TypeScript null-guard issues are caught locally before CI.
7. **Zero Feature Regression:** Never remove existing UI elements, buttons, features, or workflows unless explicitly instructed. Preserve all RLS and RBAC permissions on mutations while keeping read views fail-open for authorized users.
8. **Focused Daytime Validation:** For daytime feature and bug-fix releases, run only `npm run check:inline` plus `node scripts/prepare-release-site.mjs` (combined target `< 5s`), `deno check` when `supabase/functions/**` changes (`< 5s`), and focused Node unit tests for the touched feature (`< 10s`). Add a targeted single-file SQL check only when a migration or RPC changes. Reproduce reported bugs in the focused check first, preserve security and acceptance assertions, and report actual measured times. Do not expand a slow or failing check into a full suite or schema replay.

---

# ⚡ PILLAR 3: RESILIENCY & PERFORMANCE STANDARDS

9. **Amazon-Grade Performance & State:** Pre-fetch and cache dictionary/lookup data locally using SWR (`stale-while-revalidate`). Dropdowns, modals, and UI filters must respond immediately client-side without blocking on network calls.
10. **Nightly Timing Gate (`<= 2,000 ms` UI Ceiling):**
    - Full browser, performance, and database regression checks run in `nightly-validation.yml` at 8:30 PM `America/Chicago`, or an explicit manual `workflow_dispatch` with `full_regression: true`. During daytime feature releases, do not run `scripts/run-release-smoke.mjs`, Playwright/browser suites, Docker image builds, the full historical Node matrix, or full migration/database replays unless the user explicitly requests them.
    - For authorized browser validation, run `Desktop`, `Android`, and `iPhone` profiles in parallel (with cases inside each profile running sequentially) using a pre-seeded auth fixture (`addInitScript`) and the one-time pre-indexed 9,487-row fixture (`< 5 ms` per page).
    - The inclusive frontend UI render ceiling across Desktop, Android, and iPhone emulators is **`<= 2,000 ms`** (with `0` console/page errors and single-line metric boxes). Interactive database queries must remain below `100 ms` (`1,000 ms` for atomic 100-row Reclass batches; `120s` statement timeout for chunked bulk imports). Do not block releases on container CPU jitter below `2,000 ms`, and never require cross-OS SHA-256 receipt-hash files to merge.
11. **Idempotent Transactions:** All database writes and form submissions must be idempotent with inflight button protection.

---

# 🚀 PILLAR 4: AUTONOMOUS `< 3 MINUTE` CI/CD DEPLOYMENT PROTOCOL

12. **Evidence-Based Recovery and Eight-Attempt Stop:** After a failure, inspect the root cause, apply a targeted fix, and rerun only the affected check. Halt only if the exact same failure persists after eight consecutive attempts.
13. **Decoupled, Direct Deployment Pipeline:**
    - **Fast Main Gate Only:** Every standard `main` push, including tooling, frontend, backend, and mixed changes, uses only the fast inline/static preparation gate, changed-Edge `deno check`, and `scripts/run-tooling-release-checks.mjs` (`< 15s`). Target the gate below 45 seconds, scoped deployment below 60 seconds, and total GitHub Actions delivery below 2 minutes. Do not invoke the four-shard Node matrix, 42-job backend matrix, Docker builds, or browser smoke from daytime deployment workflows.
    - **Nightly Coverage:** Retain all full Node, SQL/import, backend, browser, and performance suites behind the Nightly/manual-full-regression gate; moving checks off daytime delivery does not remove their coverage. Tooling-only releases must make zero application runtime changes and must not replay prior application deployment work merely because an old publication baseline differs.
    - **Decoupled Pipelines:** GitHub Pages frontend publication (`pages-static.yml`) and Supabase/Apps Script backend deployments (`publish-candidate.yml`) are decoupled so unchanged backend gates never block a frontend release, and manual/automatic triggers both publish cleanly without receipt-hash bureaucracy.
    - **Ordered Full-Stack Releases:** When a release modifies both backend and frontend, apply Supabase SQL migrations and Edge Functions first, apply any `Code.gs` patch second, and publish the GitHub Pages frontend immediately upon completion.
