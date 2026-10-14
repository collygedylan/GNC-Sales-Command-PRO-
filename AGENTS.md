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
