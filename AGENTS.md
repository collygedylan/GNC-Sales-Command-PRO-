# Release and workspace discipline

- Read `docs/parallel-release-pipeline.md` before a release and `docs/workspace-organization.md` before starting or retiring a checkout.
- Keep changes on one isolated feature branch per repair. Preserve unrelated changes. Assign parallel workers explicit, non-overlapping file ownership and use one release owner.
- Run focused tests against the freshly compiled shell before pushing a candidate. Never test an old `_site` and report it as the current source.
- Push the feature branch and run its complete branch benchmark. `node scripts/release-candidate.mjs check` must verify the exact commit immediately before an authorized normal fast-forward promotion to main. Do not bypass checks, force-push main, or treat a failed preflight as a production deployment.
- Main verifies the successful exact-commit candidate proof and deploys its existing sealed artifact; it does not rebuild or repeat full candidate validation. Sealed artifact verification, current-main check, exact-live verification, all hosted suites and production health remain required. Missing or expired proof blocks publication. A passing candidate check is not a deployment or a guarantee of infrastructure availability.
- Prepare versions with `npm run release:version` using `package.json` as the source, before committing. Use one implementation/release owner and one bounded reviewer; retain the 30-minute active-repair checkpoint and one candidate validation plus at most one corrected validation.
- Never store secrets or local recovery snapshots in Git. Do not remove old worktrees merely because they are under Temp or appear merged. Inspect uncommitted/untracked/ignored work, shared Git ownership, active processes, backups, and reparse points first.
