# Candidate publication

Production promotions, validations, and merges are handled by GitHub Actions cloud runners. Do not run exact-commit candidate proofs manually or perform fast-forward promotions to `main`.

Commit authorized changes to a candidate branch and push it. Immediately create its pull request with `gh pr create --fill`. Monitor PR checks using `gh pr checks --watch` and follow the CI remediation rule below when checks fail.

# Deployment visibility

This procedure supersedes all earlier fire-and-forget and terminate-immediately instructions. Whenever a PR is merged and handed off to GitHub Actions for production deployment, continue monitoring with the `gh` CLI until the final deployment for that merge succeeds.

Follow the full workflow handoff: `Publish validated candidate` can dispatch backend publication and Pages deployment. Its success alone does not establish that the app is live. Track the matching `main` commit through the final production workflow and verify that the publication job actually ran successfully.

Read the version from the deployed commit's `package.json`, `deno.json`, or release tag. Only after successful final production deployment, report:

"✅ Deployment is officially live in production. The app is now running on Version: [X.X.X]."

If publication fails or is cancelled, report that state and follow the remediation rule; do not report a live deployment.

# Environment synchronization and file hygiene

Keep code and external integrations organized. Remove temporary files created by the task and obsolete files made redundant by its changes. Preserve unrelated user work and files.

# Autonomous CI remediation

Autonomously attempt up to three consecutive fixes for CI/CD, browser matrix, or unit test failures without asking for approval. Request explicit approval after three consecutive failures, or when a failure involves a database migration, security credential, or production data risk. Continue monitoring after each authorized fix.
