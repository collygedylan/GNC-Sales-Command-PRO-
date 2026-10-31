# CRITICAL: Zero-Downtime, Zero-Lockout & Autonomous Execution Protocols

These protocols govern all engineering, testing, and deployment work across the AgData repository. Completion summaries must report only verified outcomes and measured metrics in 2–3 concise sentences.

**Autonomous Operational Decisions:** Make backend, performance, and scheduling decisions without asking for confirmation. Automatically throttle, pause, or reschedule processes that create database contention or threaten UI responsiveness. Cloud RUN SCRIPT incrementally refreshes historical archives and canonical Average Order statistics at any time; the former overnight-only backfill rule is removed. Imports run through Drive REST, app-api and Postgres, never Apps Script/TEMP_IMPORT. Honor any future explicit pause while preserving Apps Script delivery/email workers. Preserve completed work, resumable cursors, protected live fields, and atomic publication.

**Production AI and Runtime Watchdog Boundary:** Production AI agents and the runtime watchdog are read-only by default. They may inspect authorized production context and prepare a proposed patch or fix brief, but must not autonomously write production data or source files, commit or push, or publish/deploy. Source or production changes require an explicit user release prompt naming the reviewed change and authorized action; local implementation permission alone does not authorize production writes, push, or deployment.

**Model, Quota & Subscription Autonomy:**
- **Permanent Disk Hygiene:** Reuse only the workspace `_site` directory for release builds, overwriting files in place; never create `_site-*` or `.gnc-local/foundation-site-*` copies. Never use `Remove-Item`, `del`, `rm`, or `fs.unlink` on `_site` or Google Drive. Truncate stale output files in place; move Drive files with REST PATCH or `fs.renameSync`. Do not retain unnecessary scratch/proof files or duplicate generated outputs on C:. Save retained reports, proofs, and artifacts strictly under `G:\My Drive\GNC\AgData\Release Evidence\`; after use, truncate temporary local scratch files to zero bytes. Keep source files, active build output, and required credentials intact. Hosted CI may use its ephemeral runner artifact storage.
- **OpenAI Codex Token & Effort Hygiene:** Execute with surgical precision (`Medium` / `High` effort). Stop immediately and deploy once all required checks pass—never invent unprompted post-pass edge-case rewrites. Keep test output quiet (print compact pass/fail summaries; dump full stack traces only on failure) to prevent context-compaction loops.
- **Effort Defaults:** Use `low` reasoning for CSS, copy, and configuration work; use `medium` for standard multi-file fixes. Avoid `xhigh` reasoning.
- **Bounded Source Reading:** Never read entire monolithic files (`index.html`, `assets/app-runtime.js`, `supabase/functions/app-api/index.ts`, or `Code.gs`) into context. Locate code with `rg -n` and inspect slices of no more than 120 lines; load only the relevant skill sections.
- **Batched Tool Use:** Batch independent searches, reads, and checks in parallel where practical, and target completion within 12 tool-call turns.
- **Zero-Approval Execution:** Never set `require_escalated` or any approval flag on tool calls when Full Access is enabled; execute authorized work directly without requesting approval.
- **Login Gateway Integrity:** Deploy `app-api` and `aura-llm-router` only with `supabase functions deploy <name> --no-verify-jwt`; omitting `--no-verify-jwt` enables gateway JWT rejection and breaks access-code login before the function can authenticate the request.
- **Forward-Only Git and Protected Skills:** Never use `git commit --amend`, `git reset --hard`, or `git push --force`. Never edit `.codex/**` files during a release unless the user explicitly overrides this rule.
- **Fast In-Place Inspection:** Use `git grep -n "<pattern>" -- <paths>` instead of `rg` or full-file `Select-String`, inspect no more than 80 lines at once, and edit existing files in place without throwaway copies.
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
13. `.codex/skills/agdata-request-lifecycle-and-lock-guard/SKILL.md` — Pending-only Request lifecycle, completion archival, draft continuity and role-correct published evaluation locks.
14. `.codex/skills/agdata-suspend-tag-approval-specialist/SKILL.md` — Suspend-only assigned-rep/Admin decisions, physical tag identity and immutable approval receipts.
15. `.codex/skills/agdata-email-outbox-and-worker-guard/SKILL.md` — Private durable outbox writes, service-role Apps Script workers, immediate wake/retry and confirmed recipient contracts.
16. `.codex/skills/agdata-table-management-and-directory/SKILL.md` — Manager Table Management, maintained-directory and inquiry-coverage CRUD, assigned-item ownership, customer mapping, canonical user access, and read-only history/photo archives.

Use [the canonical module dependency map](docs/architecture/agdata-module-dependency-map.md) for exact functions, shared state, backend contracts and the 1–3 focused Node targets for each cluster. Its source inventory is an audit snapshot, not a release receipt or permission to skip current checks. Register skill additions in `scripts/run-tooling-release-checks.mjs`; preserve shared Back/navigation dependencies in every domain skill.

**Mandatory Step 0 — Pre-Edit Skill & Symbol Index Read:** Before editing any file, read `docs/architecture/agdata-symbol-index.json` and every owning `.codex/skills/<skill-name>/SKILL.md`, then document the Cross-Layer Blast Radius across `Code.gs` <-> SQL migrations/RPCs <-> `supabase/functions/app-api/index.ts` <-> `assets/app-runtime.js`. Never introduce a competing helper when the symbol index identifies a canonical function.

**Mandatory Step N — `+1 Ratchet Learning Loop`:** Every future bug fix or Watchdog incident resolution must append its root-cause anti-pattern to the owning skill's `## Forbidden Anti-Patterns (Never Repeat)` section and append the next active, behavior-based `Invariant N` test to `tests/golden-invariants.test.mjs` in the same commit. Golden invariants are append-only: never delete, renumber, skip, todo, or weaken an existing invariant.

**Permanent Golden Contracts:** Preserve the zero-scroll 12-tile `#view-home` fit (including `Production` and `Smart Sales & Move`), immediate `#view-smart-moves` hydration, authorized fail-open `200` responses instead of transient `401`/`403`/`409`/`423` lockouts, `security_invoker = true` on every public SQL view, transactional `SET LOCAL`, and manual `RUN SCRIPT` `force: true` stale-lock override with successfully published `.xlsx` files moved to `Processed`.

## Mandatory 4-Caller & All-11-Gems Impact Contract

Every migration, RLS/trigger edit, `app-api` update, `Code.gs` change, or `assets/app-runtime.js` change must verify all four callers and every Gem domain before release:
1. **Browser PostgREST (`anon` / `authenticated`):** Preserve direct `SELECT` plus SWR/LKG access for operational inventory, queue, and lookup relations; never expose `ph_app_users` or `user_access_control`, and never grant anonymous operational mutations outside the reviewed delivery exception.
2. **Google Apps Script:** Preserve read/claim/status/thread access for request delivery outbox, worker state, email threads, pending requests, and completed history; every durable email event must remain immediately wakeable and retryable.
3. **`app-api` Edge:** Keep startup responses bounded below `300 ms`; never proxy a startup bulk download above `2,000` rows when direct read-only PostgREST or an item/folder-scoped RPC exists.
4. **Postgres Triggers/Functions:** Never mix `timestamptz` and `text` in `COALESCE`, and never add an unguarded per-row cross-table trigger to `ph_master_inventory`; use exact changed-column/row guards and set-based import paths.

The release gate must prove Drive/AV, Bloom/Request, Queue/Reclass, Email/Outbox, Docks/Archive, Shell/Navigation, Sync, Zero-Lockout, Watchdog/role parity, AURA, and Skill Learner/Release Governor behavior without weakening another domain.
Every modified `Code.gs` entrypoint and authorization dependency must be registered in `package.json#appsScriptPatchFunctions`, with a scoped merger test proving remote-only production routes remain intact.

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

## AgData v2.3.107 release contract

The explicit v2.3.107 release is main-thread only, retains the local v2.3.106 read deduplication, and authorizes scoped SQL, app-api and main publication without permission pauses. Its validation is one tooling-gate invocation, no Deno, linked-CLI SQL only, and one under-30-second Chromium DOM check; cold hydration duration and cancelled superseded reads are diagnostic only. No test emails or historical backfill are authorized.

## Permanent Main-Thread Memory Budget and Automatic Handoff

- **95% memory reduction / zero-compaction stdout budget:** Maximum 8 stdout lines per command. Never dump verbose test, tooling, Supabase, SQL, or diff output into chat. Redirect output to a scratch log under G:\My Drive\GNC\AgData\Release Evidence\; print only exit status, elapsed seconds, and the last 5 log lines. Use git diff --stat and inspect targeted ranges of at most 35 lines. Aim to keep context use below 15%; do not claim this is measurable or guaranteed without telemetry.
- **Batched execution:** Maximum 5 shell commands per prompt; batch inspection into 1, edits into 1–2, required focused tooling into 1, and authorized deployment/push/smoke into 1. Use the main thread only. Never spawn Customer ui, Customer backend, or other worker sub-agents. Do not rerun passed suites or rebuild a completed release without a demonstrated blocker.
- **Automatic handoff:** Read .gnc-local/latest-state.md first at the beginning of each new chat. At the end of every completed release, write exactly 10 concise lines recording the live version, latest commit SHA, publication results, checks, limitations, and next action. This required local state file is an explicit exception to the retained-artifact location rule.
- **Thread-full alert:** If a thread exceeds 6 completed prompts or context compaction occurs once, append this exact line at the bottom of the final response:
  **⚠️ CHAT MEMORY NEAR LIMIT — TAP [NEW CHAT] BEFORE PASTING YOUR NEXT PROMPT (STATE SAVED TO .gnc-local/latest-state.md)**
- **Zero permission pauses / cold-cache loops:** Execute authorized work end-to-end without May I permission prompts. Never fail or retry live browser checks solely for cold-cache download seconds or cancelled background reads during navigation. Report unverified outcomes honestly; do not weaken functional or security assertions.


## v2.3.111 UI prompt and theme contract

A prompt whose requested release version matches saved local release state must still be checked against the current source and completed when its requested changes are absent. Use dark-emerald in-app pickers and centered dialogs for Bloom inventory projects and Reclass; preserve mapped ownership, durable submission, authorization, and fail-open behavior.

## v2.3.112 runtime composition contract

AgDataKernel indexes the existing identity-scoped read map and render scheduler. Use scripts/composed-app-source.mjs for semantic runtime inspection; assets/bloom-runtime-functions.js contains declaration-only classic globals restored at the original marker. Handled watchdog diagnostics allow only static tokens and a bounded 100-entry ring; never persist raw errors, stacks or payloads.

## v2.3.113 firewall resilience contract

Keep cached shells and controllers during origin failures. Only successful complete worker installation may retire previous owned shell caches. Bound shell maintenance and optional native login bridging at 1,200ms; preserve direct server-verified native identities and every mutation authorization check. Supabase fetches use no-referrer. The company mirror binds only 127.0.0.1:4173 and serves the active _site tree.

Cross-layer blast radius: shell/lifecycle/transport and app-api CORS/version only; Code.gs, SQL/RPCs, private access tables, delivery workers and database grants retain their contracts. No new startup data read is introduced.

## v2.3.114 detached cloud sync contract

The signed internal HTTP relay owns accepted RUN SCRIPT jobs independently of the browser; use existing private job/request leases and at most 40 relay hops. Status with autoRelay:false is observation only. Start uses keepalive; background interruption hands off silently and pageshow/focus/visible refresh status and the canonical revision coordinator.
Cross-layer blast radius: app-runtime start/status and app-api relay/worker phase boundaries; shared ERP command validation accepts the optional status autoRelay boolean. SQL lease/publication/RLS contracts and Code.gs token/email delivery remain unchanged. No new browser read endpoint is introduced.

## v2.3.115 row saves, Home, Assigned Items and Suspend contract

Photo receipts resolve the exact master UID and never propagate across sibling lots/sources. Preserve full manually entered AV Note text; suggestion cleanup keeps its legacy contract. Admin/Manager may save any exact row and Eval may save assigned items; native storage fallback repeats authorization in SQL. Assigned Items uses active-owner choices, filtered checkbox selection, unique/all rows, Plant Group Code and canonical 150 low-stock overrides. Home retains bounded pills and expanded source cards; Suspend colors use local weekdays. Invariants 213–218 cover these contracts.

Cross-layer blast radius: runtime evidence/UI, app-api photo role gate, shared live-row authorization and scoped SQL owner/target/storage policies. Code.gs and delivery workers retain their contracts; no startup read route is added. Never fabricate completed history status.

## v2.3.116 sync progress and recovery contract

Home disclosure opens #erp-sync-progress-modal; private ERP job JSON owns sourceProgress and the authenticated projection excludes leases/cursors. Canonical PostgREST revision/capability reads retain permission and READY/LKG proof. Live slices cap at 1,500 and release raw bytes before staging; finalization yields at the slice budget. The 76 missing files belong to the immutable SOC average-order manifest; local recovery preserves canonical finalization/activation. Never fabricate processed history or resolve unverified incidents. Code.gs delivery and mutation authorization remain unchanged.

## v2.3.118 committed evidence and card media contract

Exact-row successful evidence receipts confirm saves independently of normalized values or read-after-write revision lag. Transport recovery replays the same authenticated PostgREST atomic upsert with its original idempotency key; direct table write grants remain restricted. Positive stock aliases and saved percentage recover missing/zero photo-match quantities, while durable nonzero Reclass quantities and photo eligibility retain their contracts. Shared 84px square media keeps count overlays inside and dates underneath; AV retains exact live Spec and full entered AV Note. Tooling suite timeout is 75 seconds. Invariants 238–240 cover these changes.

Cross-layer blast radius: runtime evidence receipt/rendering and shared media CSS only. Existing SQL atomic master/location-note persistence, app-api photo authorization, Code.gs imports/delivery, private tables, and startup read endpoints retain their contracts. The v2.3.117 last-write-wins owner migration and public Storage URL normalizer remain intact.


## v2.3.119 — Eight Permanent Pre-Commit Zero-Regression Locks

The .husky/pre-commit hook and scripts/enforce-all-14-gems-gate.mjs enforce these locks. Preserve all existing golden invariant numbers; append behavior tests for new fixes.

1. No undeclared masterUid identifiers in assets/*.js or inline index.html scripts; inspect lexical scopes.
2. Exact-row committed HTTP 2xx receipts confirm canonical evidence even after normalization; retain the full AV Note and reject mismatched identities.
3. Positive stock and match_pct produce the canonical positive Loc Photo Match across Drive Mode, AV, Item Detail and Que; preserve durable Reclass quantities.
4. Shared media is full-bleed 84px × 84px with object-fit: cover, an unclipped count overlay, and date outside/below the border. AV Spec and AV Note remain below six metrics.
5. public.user_access owns Y/N capabilities and per-Sales-Rep overrides. Who requested this? renders synchronously from the safe roster and never waits for a directory spinner. Nally/Nelly normalize identically; Dylan, Megan, JD, Mitch, Nelly and Morgan retain default full row and Flyer access. Explicit N remains authoritative.
6. Home retains v2.3.110 horizontal Print / Run Script parity and centered #erp-sync-progress-modal per-file bars.
7. Suspend Plan Start uses local weekdays: Monday Purple, Tuesday Red, Wednesday Green, Thursday Blue, Friday Green. Saves use save_drive_evidence_v3, return exact inventory receipts, and immediately repaint Drive Mode and AV; False Block is never a publication location.
8. Assigned Items uses set_itemcode_default_owners_v1 serialized last-write-wins without P0001 conflicts. Storage thumbnails use public object URLs, never /storage/v1/render/image/.

Additional owning skills: .codex/skills/agdata-zero-regression-mutation-engine/SKILL.md, .codex/skills/agdata-access-and-permissions-governor/SKILL.md, .codex/skills/agdata-access-and-permission-matrix/SKILL.md.

Cross-layer blast radius: safe public matrix schema/RPC and server authorization, app-api access/photo checks, runtime picker/editor and canonical evidence receipts. Code.gs imports/delivery and private credential-table grants retain their contracts. The only new startup read is the bounded, native-authenticated direct GET /rest/v1/user_access; its fixture rejects unknown parameters and all mutations.
