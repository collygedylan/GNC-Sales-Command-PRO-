# Local checks and database contracts

## Setup

Use Node 22.22.1 or newer and run `npm ci`. The package `prepare` script installs
Husky for this checkout, including linked worktrees. Deno and the Supabase CLI are
pinned in the lockfile; global installations are unnecessary.

Run `npm run doctor` for dependency diagnostics, or append `-- --edge --database`
to check the Edge runtime, Supabase CLI and Docker engine. SQL changes require a
working Docker Desktop/Engine. A failed diagnostic is a blocking error; it does
not silently skip validation.

Database checks require at least 8 GiB free on the repository and temporary-storage
volumes. Allow 15 GiB for the first Supabase image download and extraction. If a
full disk makes Docker's internal filesystem read-only, free space and restart
Docker Desktop before retrying; a successful `docker info` alone does not prove
that image downloads can complete.

## Pre-commit

Husky runs lint-staged with `--hide-all` and one sequential task. Unstaged content
and untracked files are hidden while checks read the index snapshot and restored
after success or failure. Checks do not format files or stage automatic repairs.
Deleted and renamed paths participate in dependency selection.

Test child processes clear the repository-local environment variables reported
by Git, so temporary fixture repositories cannot overwrite the enclosing hook's
index. Staged-file selection and the SQL gate retain the original hook context.

The gate runs correctness lint and inline HTML syntax validation, project
`tsc --noEmit`, generated runtime-contract and database-boundary guards, conditional
Deno checks, affected Node/Vitest unit and mounting tests, and conditional local
database validation. TypeScript receives the project configuration, never a list
of staged files. Ordinary frontend edits do not start a database.

`npm run check:tooling` repeats lint, syntax, TypeScript and boundary checks in CI.
Its default comparison base is `origin/main`; `GNC_CHECK_BASE` can select another
available ref. Full browser matrices and production verification run in Actions.

## Test discovery

`scripts/test-discovery.mjs` is the shared runtime taxonomy. Tests follow these
conventions:

| Runtime | Convention |
| --- | --- |
| Node | Recursive `tests/**/*.test.{mjs,cjs,js}` |
| Node browser mounts | `*.browser.test.mjs` in the dedicated browser lane |
| Vitest | `v2/src/**/*.{test,spec}.{ts,tsx}` and `tests/**/*.test.{ts,tsx}` |
| Playwright | Recursive `*.spec.{ts,tsx,js}` with suite tags |
| Deno | `supabase/functions/**/*_test.ts` or `*.test.ts`; function entrypoints are discovered independently |
| SQL | `supabase/tests/**/*_test.sql`; rollback/canary scripts have their own lane |
| PGlite | `supabase/ci/**/*_pglite.mjs` |
| Concurrency | `supabase/ci/**/*_concurrency.mjs` or `scripts/test-*concurrency.mjs` |
| Python | `tests/**/test_*.py` |

Use `node scripts/test-discovery.mjs --json` to inspect coverage. New conventional
tests need no central filename-list edit. Source-path mappings and local import
relationships select affected tests; shared or unmapped changes select the broad
fast unit/mount group. Production browser tags require the dedicated production
runner. Migration order is a separate release contract.

Run `node scripts/test-discovery.mjs --audit` to reject missing runtime assignments,
empty required groups, and duplicate primary execution. Browser tags are also
checked against the active workflow configurations. Existing browser matrices
keep their separate projects, environments, retries, and deliberate overlap.

## Database types and SQL

`npm run types:db:generate` uses the pinned Supabase CLI with two disposable
local databases: the production baseline plus active migrations, and the
schema-only sandbox capture plus its sandbox-only migration chain. It writes
`supabase/functions/_shared/database.types.ts` and
`v2/src/services/sandbox.database.types.ts`. Review and stage both schema diffs.
`npm run types:db:check` regenerates and compares both artifacts.
`supabase/schema/sandbox-project.catalog.json` is the immutable schema base for
the sandbox replay; it contains no application rows. Put subsequent sandbox
schema changes in `supabase/sandbox/migrations/` with matching tests under
`supabase/sandbox/tests/`. Refresh the base only when retiring any migrations
already represented by the refreshed capture, so replay does not apply a change
twice. `npm run types:contracts:generate` derives runtime
validators from both generated TypeScript artifacts. Do not edit generated
contracts manually.

The legacy JavaScript shell calls compiled TypeScript adapters. Those adapters
validate table/RPC names, columns and write inputs before transport. New database
calls must use an approved adapter and a client parameterized by its generated
schema. Sandbox and production schemas are distinct; do not substitute one for
the other. Permission and session checks remain at their original boundaries.

`npm run check:db` validates staged database changes against disposable local
resources. The canonical workspace replays the production baseline plus active
migrations, lints application SQL, runs the discovered `sql-canonical` pgTAP
contract and the selected transaction-contained rollback canaries, and compares
generated production types. It then replays the sandbox schema capture, lints
its schemas, and compares sandbox types. This is the canonical schema/type gate,
not a run of every SQL behavior suite.

The canonical workspace builder adds a synthetic migration-prerequisite fixture
only to its disposable copy. It supplies empty-inventory readiness and the
synthetic access-control rows needed by data-repair migrations; it does not copy
production rows or credentials. Canonical replay also disables the HR reminder
and scheduled handover cron jobs inside the copied migrations before their
transactions commit, so wall-clock jobs cannot mutate the local fixture or call
an Edge Function. Production migration files are unchanged.

The private-schema capture contains current definitions. Before baseline replay,
the renderer defers triggers introduced by active migrations and restores the
four function bodies that those migrations patch in place. This includes the
pre-v4 Eval Work inquiry validator from its archived source, so replaying the
v4 rename preserves a distinct legacy validator instead of a recursive wrapper.
Each restoration
checks the corresponding migration text and expected source fragment; unexpected
capture drift stops replay instead of applying a guessed replacement.

Sandbox-only SQL stays under `supabase/sandbox/migrations/` and
`supabase/sandbox/tests/`. The disposable sandbox workspace applies the immutable
schema capture first, then sandbox migrations in timestamp order. It copies
discovered tests tagged `-- @test-runtime: sandbox-pgtap` into that workspace,
runs strict SQL lint, then executes those pgTAP tests before comparing types.
Sandbox SQL is never added to the production migration chain or production SQL
test workspace.

The runner extracts the baseline's platform-owned default-privilege statements
and applies them after local Supabase start and each successful reset. It uses
`docker exec` only after verifying the temporary workspace path, randomized
project ID, Supabase container labels, image, and configured port. SQL replay,
lint, tests, and type generation use the disposable local project and its local
credentials; they do not use production credentials.

For staged changes, `check:db` additionally selects affected SQL behavior tests.
Migration or database-runner changes conservatively select the applicable
rollback canaries and historical fixture suites; changed canaries and dedicated
PostgreSQL fixture groups run in their own isolated lanes. The command
`node scripts/database-check.mjs --all` runs the canonical gate, sandbox
schema/type and pgTAP gates, and all discovered rollback canaries. It does not run the
historical or dedicated behavior suites. CI keeps those suites separate to
preserve their required fixtures and environments.

TypeScript cannot inspect PL/pgSQL function bodies. Ambiguous projections inside
SQL are covered by PostgreSQL linting, explicit-projection assertions and SQL
behavior tests. SQL validation never uses production credentials.

Six legacy functions create temporary tables at runtime. The lint wrapper derives
their column shapes by planning the checked-in static table declarations with
`WITH NO DATA` in a rolled-back disposable session. It adds supported
`plpgsql_check_pragma` table declarations only to the disposable function copies,
runs the unchanged strict error gate, then restores their exact original bodies
before behavior tests or type generation. Unexpected functions, declarations or
signatures fail closed; no lint findings are suppressed. Historical fixtures use
the same wrapper for whichever supported functions their schema contains.

The `sql-rollback` inventory contains three transaction-contained operational
canaries. Each test creates its own synthetic identities and scenario rows,
asserts its behavior, and rolls back. The runner discovers each SQL file and
streams it into `psql` inside the already verified disposable Supabase database
container with `ON_ERROR_STOP` enabled. It checks that each source begins a
transaction and ends with rollback. It does not use host PostgreSQL tools,
filename-specific fixture scripts, or production credentials.
