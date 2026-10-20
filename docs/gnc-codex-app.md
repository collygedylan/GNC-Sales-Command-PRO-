# GNC Codex App

The canonical Git repository remains `C:\Users\dylan\Projects\GNC\repo`.
`G:\My Drive\GNC Codex App` is its source mirror and private fallback location.
Develop in an isolated local worktree; do not deploy from the Drive mirror.

## Application layout

```text
index.html                    Production HTML shell and existing application
assets/                       Production modules, styles, branding catalog and vendor assets
live-src/                     Production runtime manifest and module foundation
v2/
  index.html                  React beta entry point, still published at /v2/
  public/                     Beta static files and sandbox runtime configuration
  src/
    main.tsx                  React providers and mount
    components/               PartnerWorkspace and service-worker UpdatePrompt
    pages/                    App: beta navigation and request screens
    services/                 API, sandbox configuration and IndexedDB cache
      workers/                Inventory filtering/sorting worker
    utils/                    AV comparison and sorting
    assets/                   Beta stylesheet
    types.ts                  Shared beta contracts
scripts/                      Build, deployment, diagnostics and sync tools
supabase/                     Edge Functions, migrations and database tests
Code.gs                       Production Apps Script integration
tests/                        Existing production and release regression suites
docs/                         Architecture and operating instructions
database_cleanup_log.txt      Actual database cleanup outcome
legacy_fallback/              Drive-only verified original copies; never published
```

The HTML app remains the production application. React remains a separate beta,
locked to sandbox/test data by `v2/src/services/runtime.ts`. Moving source does
not replace the production UI, change database tables, or grant beta users access
to production. Production URLs, `/v2/`, service-worker scopes, backend actions,
session keys and persisted IndexedDB names remain unchanged.

`npm run build:v2` and `npm run test:v2` retain their existing interfaces. Vite
and TypeScript already include all nested `v2/src` modules. Tests are colocated
with their components and utilities. Production still uses `build:live` and the
sealed artifact release pipeline described in `parallel-release-pipeline.md`.
Root deployment/configuration files and production assets stay at paths required
by existing clients, build tools and service workers.

Production logos, app icons, and splash artwork are listed in
[`branding-assets.md`](branding-assets.md). The catalog owns the canonical
payloads; generated legacy root filenames preserve links used by older
installed shells and caches.

## Backup and recovery

The Drive-only `legacy_fallback` contains separate `remote-release`,
`local-pre-migration`, and `random-html-original` copies with SHA-256 manifests.
`repository.bundle` preserves the canonical repository's refs. Generated
dependencies/build output and nested Git metadata are excluded from source
copies and recorded in manifests; original historical checkouts remain intact.
The Git branch `legacy-messy-v1` preserves the pre-migration release tree. The
local ref `recovery/pre-gnc-migration-20260926` preserves divergent local main.

For recovery, verify hashes first, clone the bundle into a new local directory,
and select the required preserved ref. Restore private source copies into a
separate directory for comparison. Never extract over current work or restore
an old database snapshot over business transactions. A production rollback still
requires the normal candidate and live verification gates.

Do not commit credentials, backup snapshots, or local reports. The deployment
builder uses an explicit static file list and never includes `legacy_fallback`.
Use the generated handoff receipt for actual candidate, validation and deployment
status; the presence of the source mirror alone does not mean a release passed.

## AgData repository skills and Gemini compiler

The nine canonical skills live under `.codex/skills/`; root `AGENTS.md` routes matching tasks to them. Read the matching skill explicitly when the client does not automatically discover this directory. A new chat may be needed to refresh a client skill catalog.

The following compiler prompt is provided for manual use in Gemini; repository installation does not create account-side skills, Gems, subscriptions, or credentials.

```text
You are the AgData Codex Compiler for Dylan Collyge (dylan_collyge). Inspect screenshots, screen recordings, logs, or feature requests for the AgData PWA and output a ready-to-paste, fast-executing OpenAI Codex prompt.

Always expand and apply the matching workspace skills before responding:
- agdata-drive-and-av-specialist
- agdata-bloom-and-request-specialist
- agdata-queue-and-reclass-specialist
- agdata-field-ops-and-qc
- agdata-docks-and-orders-specialist
- agdata-sync-and-supabase-architect
- agdata-zero-lockout-guard
- agdata-release-governor
- agdata-skill-learner

Every Codex prompt you generate must:
1. Start with an Explicit Attempt Counter Reset (`0 / 8`), specify the starting branch/commit on `origin/main`, and keep historical archive backfills PAUSED unless instructed otherwise.
2. Direct Codex to load the exact `.codex/skills/agdata-*` repo skills affected by the task.
3. Enforce the Global Zero-Lockout Rule (always serve last-known-good `READY` snapshots and retain same-account loaded data; never render `Verifying updated access`, `Drive Inventory unavailable`, `Data could not be verified`, or `Row Details Unavailable`).
4. Enforce the Quota-Safe Frozen Test-Harness Rule (no per-version `check-v23XX-...` scripts or SHA-256 receipt-hash files; `< 2s` Node unit tests for logic; local `deno check` for Edge Functions; local Docker Postgres for destructive SQL tests; explicit allowlist stubs for background reads; `<= 2,000 ms` render ceiling across Desktop, Android, and iPhone).
5. When adding any new feature, table, or RPC, include a self-learning step instructing Codex to register any new startup/background read in the Playwright fixture allowlist and update the matching `.codex/skills/<name>/SKILL.md` file in the same commit.
```

### Execution boundaries

The root governance text is the supplied verbatim specification. Same-account cache retention applies only to authorized data: account changes and confirmed server-side access revocation must preserve authorization boundaries. No authorization rules or application behavior are changed by this tooling upgrade. Skills describe required future behavior, not proof that every feature has been verified.

The five-minute release, two-second logic checks, three-second Deno check and five-millisecond fixture response are measured targets; report actual durations and do not replace required checks with success messages. Historical smoke measurements supplied for `af9e1c0d` are 88/142/387 ms; they are not measurements of the modified harness.

Docker validation defaults to the local engine and consumes no Docker cloud execution minutes. Build Cloud and Testcontainers Cloud remain disabled; enabling them later requires CI-only credentials, a configured builder, verified available quota and explicit usage controls. Account entitlements and remaining minutes are not inferred from a subscription label. PostgreSQL 15 is an optional lightweight sandbox; the existing PostgreSQL 17/Supabase harness remains authoritative for full migration compatibility.

The tooling-only delivery runs focused Node checks and does not run browsers, build images, start containers, or execute database suites. Production runtime files and the app version remain unchanged. Keep historical backfill and the 15-minute automation paused.
