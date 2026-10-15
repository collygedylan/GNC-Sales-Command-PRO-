# CRITICAL: Zero-Downtime & Autonomous Execution Protocols

These protocols take precedence over conflicting instructions elsewhere in this document, including the Nightly-only restriction when mandatory pre-flight verification requires checks before merging. The three-consecutive-failure stop rule remains mandatory. Completion summaries must report only verified outcomes and measured metrics.

1. **Mandatory Shadow Testing:** Before proposing any PR that touches the database schema, data imports, or frontend rendering, you MUST execute a complete dry-run on a temporary/disposable database instance. If a migration cannot be safely tested in isolation, you are forbidden from deploying it.
2. **Automated Rollbacks & Self-Healing:** If your deployment triggers CI/CD failures, or if observability metrics (like Postgres warnings or API errors) spike immediately after a merge, you must automatically execute a rollback to the last known good state BEFORE asking me for input.
3. **No-Nag Debugging:** If a test runner fails or a minor syntax error occurs during your isolated testing, do not halt and ask for permission to investigate. You are authorized to proactively diagnose and fix your own test failures up to the 3-failure limit. Only halt and ping me if you hit a fundamental architectural blocker.
4. **Field-Worker Assumption:** Assume the human operator is in the field. When presenting a completed task, provide a 2-sentence executive summary of the outcome and the verified metrics (e.g., "Deployed 100%. Queues are clean. Load time is under 1s."). Do not require me to review line-by-line code to approve a deployment unless it changes core business logic.
5. **Pre-Flight Performance Checks:** Before merging any frontend list-view or interactive database-query change, require reproducible measurements at representative production data volumes. AV and Suspend list rendering have a user-approved inclusive maximum of 200 ms; Pending and all other frontend lists and interactive database queries must remain below 100 ms. Background bulk-import RPCs have a user-approved limit of 55 seconds per RPC; this exception does not relax the interactive-query limit. Record the environment, measured operation, dataset size, and cold/warm cache conditions, together with query-plan and appropriate pagination/caching evidence. Measure bulk imports with new, changed, unchanged, and retried snapshots, including their protection triggers and publication work. Block merging when this evidence is missing or the applicable threshold is exceeded.

# 🛑 PILLAR 1: STRICT SCOPE AND WORKSPACE HYGIENE
1. **Zero Scope Creep:** You are strictly forbidden from modifying CI/CD pipelines, `.github/workflows/`, deployment scripts, or baseline helpers unless the user explicitly commands you to "update the deployment pipeline."
2. **Report, Don't React:** If you discover a pre-existing bug, race condition, or deployment gap outside the exact scope of the user's prompt, DO NOT fix it. Report the blocker, wait for instructions, and halt execution.
3. **Surgical Precision & Token Economy:** Only read and modify the specific files required to complete the explicit feature request. Do not load unrelated files into your context window. Never refactor unrelated code or architecture you happen to pass through.
4. **Credit Protection:** If a seemingly simple task requires modifying more than 5 files, pause and ask the user for authorization before writing the code to prevent burning through workspace credits on incorrect assumptions.
5. **Strict Workspace Synchronization:** You must keep the repository in pristine order. Before beginning any implementation, verify the local workspace is completely clean and synchronized with `origin/main`. Never leave dangling untracked files, unresolved merge conflicts, or messy uncommitted states across sessions. Never execute new work on an unauthorized branch.

# 🏗️ PILLAR 2: ARCHITECTURE, SECURITY & QUALITY
6. **Separation of Concerns (SoC):** Strictly decouple UI presentation from business logic and database operations. Never write raw database queries directly inside UI components. Data fetching and mutations must be abstracted into dedicated hooks or service layers.
7. **Modular Component Design:** Prevent monolithic files. UI components must be small, reusable, and singularly focused. If a component grows too complex, refactor it into smaller sub-components before continuing.
8. **Strict Type Safety & Secure by Default:** Never use implicit `any` types. Enforce strict typing on all database payloads and component props. Never hardcode API keys or secrets; rely exclusively on environment variables and Supabase Row Level Security (RLS) policies.
9. **Zero Feature Regression:** Never remove existing UI elements, buttons, features, or workflows unless explicitly instructed. Strictly preserve all existing RLS and Role-Based Access Control (RBAC) permissions during component refactors.
10. **Test-Driven Remediation:** When fixing a reported bug, first verify or write a focused unit test that replicates the failure. Fix the code to pass the test.

# ⚡ PILLAR 3: RESILIENCY & PERFORMANCE STANDARDS
11. **Amazon-Grade Performance & State:** Never introduce synchronous network blocking for lookup tables (customers, reps, locations). All static and semi-static dictionary data must be pre-fetched and cached locally (e.g., using SWR). Dropdowns and UI filters must respond instantly client-side. 
12. **Payload & State Integrity:** State must be strictly preserved across components to guarantee payload integrity during final database transactions. Do not block UI interaction while awaiting broader view synchronization.
13. **Defensive UI & Error Boundaries:** Assume all network requests will eventually fail. Implement fallback UIs and Error Boundaries. A failure in a single component (e.g., a photo upload) must never crash or white-screen the entire application view. 
14. **Idempotent Transactions:** All database writes and form submissions must be idempotent. Implement strict deduplication and button-disabling during inflight requests so that network retries or accidental double-taps do not create duplicate database rows.

# 🚀 PILLAR 4: AUTONOMOUS CI/CD DEPLOYMENT PROTOCOL
15. **Anti-Looping Protocol (The Kill Switch):** If a local test, pipeline build, or deployment fails 3 times consecutively, you must instantly halt execution, restore the last known good state, and escalate to the user. Do not attempt to brute-force fixes through infinite guessing loops.

**Deployment Architecture & Execution**
* **Decoupled Pipelines:** GitHub Pages frontend publication and Supabase/Apps Script backend deployment are fully independent. Backend validation failures must not gate frontend publication.
* **Nightly Validation Isolation:** Browser checks, phone emulators, layout snapshots, timing checks, and performance benchmarks belong EXCLUSIVELY to Nightly Validation (8:30 PM Central Time (01:30 UTC)). Never run these during standard PR delivery. 
* **The Delivery Sequence:** Use an isolated `codex/` branch. Auto-merge the PR immediately upon passing scoped local tests. Monitor the GitHub Actions workflows and report live status only when the frontend and/or backend publications are 100% complete. Do not request manual PR reviews.
