# GNC Codex App

The canonical Git repository remains `C:\Users\dylan\Projects\GNC\repo`.
`G:\My Drive\GNC Codex App` is its source mirror and private fallback location.
Develop in an isolated local worktree; do not deploy from the Drive mirror.

## Application layout

```text
index.html                    Production HTML shell and existing application
assets/                       Production modules, styles, icons and vendor assets
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
