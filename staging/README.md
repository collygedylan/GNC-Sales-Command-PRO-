# Isolated teardown staging

This environment is limited to the approved Phase 1 and Phase 2 teardown work.
Its deployment target is:

https://collygedylan.github.io/gnc-teardown-staging/staging/

The URL alone is not evidence of readiness. Verify the banner commit, backend
isolation, and authenticated mobile checks before handing the environment over.

## Boundaries

- Source base: `staging-teardown`; candidates: `codex/teardown-phase-1` and
  `codex/teardown-phase-2`.
- Static artifacts: only `collygedylan/gnc-teardown-staging`, under `staging/` on
  its `gh-pages` branch. Do not set a custom domain or modify production Pages.
- Supabase: only project `apztnscvagayslumnalr`, schemas `teardown` and
  `teardown_private`, bucket `teardown-photos`, and function `teardown-api`.
- Existing sandbox tables, accounts, functions, and demo rows remain shared
  resources. Do not replay production migrations into this project.
- Email and push operations create captured delivery records; there is no
  external delivery worker for teardown resources.
- PDF conversion is disabled until a separate Apps Script deployment and
  sandbox Drive folders can be provisioned and verified. Missing configuration
  returns `TEARDOWN_PDF_NOT_CONFIGURED` and cannot fall back to production.
- Browser storage uses a teardown prefix. Service workers and push registration
  are disabled for this review. Never clear origin-wide storage or caches.

## Setup and delivery

1. Run focused AST, adapter, workflow, and schema contract checks. The database
   job must also execute the SQL against its disposable Postgres service.
2. Use the private GitHub App on only the source and hosting repositories. The
   local onboarding helper stores its key using Windows DPAPI outside the repo
   and installs staging environment credentials. Never commit or print keys.
3. Push the candidate, then immediately run
   `node scripts/staging/candidate-pr.mjs`. It creates or reuses the bot-authored
   PR against staging and enables merge only for the approved branch and head.
4. Monitor `gh pr checks <PR> --watch --fail-fast`. Apply AGENTS.md remediation
   limits, including immediate approval for migration or credential failures.
5. Before backend provisioning, confirm the exact project ID. Apply the
   separately tracked `supabase/staging/teardown-schema.sql` only after its
   disposable database checks pass. Its seed inserts preserve existing rows.
6. `teardown-session-fence.sql` adds restrictions to shared sandbox tables.
   It requires separate approval. Verify teardown identities cannot access
   unrelated records and existing demo identities retain their access.
7. Provision a preconfirmed synthetic Auth identity and teardown membership;
   do not create a public/shared application profile or send a real invitation.
   Store access credentials privately, outside the repository and logs.
8. Deploy `teardown-api` with authenticated JWT verification. Check membership,
   inactive accounts, revoked sessions, updates, and signed photo uploads.
9. Staging pushes build and validate in cloud CI. Publication runs after the
   gate, checks the exact source head, and copies only the validated artifact
   into the separate hosting repository. Candidate code is never executed in
   the credential-bearing publication job.
10. Verify the hosted commit and execute the authenticated mobile acceptance
    suite with the dedicated test identity. Do not report readiness from mocked
    requests, a skipped test, or an unauthenticated login screen alone.

## Focused checks

```sh
node --test tests/architecture-audit.test.mjs tests/staging-*.test.mjs
node scripts/check-architecture.mjs --base <trusted-target-sha>
git diff --check
```

Cloud CI supplies `STAGING_TEST_DATABASE_URL` for the disposable database test.
The local test reports a skip when it is unavailable; that skip is not database
validation. Full release artifacts and browser matrices are built in cloud CI.

The hosted acceptance configuration is `staging/playwright.auth.config.ts` and
requires `TEARDOWN_STAGING_BASE_URL`, `TEARDOWN_STAGING_USERNAME`, and
`TEARDOWN_STAGING_ACCESS_CODE`. Keep the code out of command lines and output.

## Stop after Phase 2

Phase 2 starts only after Phase 1 passes and merges. After Phase 2 merges,
verify its exact deployed commit and run
`node scripts/staging/configure-rules.mjs --require-review --apply` to restore
the human approval requirement. Stop for `collygedylan` to review on mobile.
Do not begin Phase 3 or resume production publication as part of this task.
