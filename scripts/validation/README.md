# Local Docker validation

The `release-smoke` service runs the existing sealed-artifact smoke with the
repository's pinned Playwright 1.62.1 Linux browsers. Compose keeps `node_modules`,
npm downloads, and Playwright browser files in named volumes. Bind the checkout
and provide `RELEASE_SMOKE_SITE_DIR`, `EXPECTED_RELEASE_COMMIT`,
`EXPECTED_RELEASE_DIGEST`, and `RELEASE_SMOKE_SOURCE_DIGEST` from the same sealed
release artifact before running `docker compose -f docker-compose.validation.yml run --rm release-smoke`.
For a linked Git worktree, Git metadata is outside the checkout: set
`GIT_WORKTREE_ADMIN_DIR` to the host `.git/worktrees/<worktree-name>` directory
and `GIT_COMMON_DIR` to the host repository `.git` directory. Both are mounted
read-only at the paths used by Git inside the container. The Dockerfile caches
the lockfile dependency install as an image layer; named volumes retain npm and
browser data, with Playwright version-specific volume names and an in-container
pin marker checked before reuse.

The optional `postgres15-aux` profile is for lightweight disposable SQL work;
its data directory is tmpfs-backed and disappears with the container. It is not
the full migration or integration-test database. The repository Supabase CLI
configuration targets PostgreSQL 17, and its disposable workspace/container
identity checks remain the supported compatibility path for Supabase database
validation. Use that path for migrations, RLS, Supabase roles, or extensions.
