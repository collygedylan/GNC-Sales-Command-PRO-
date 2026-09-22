# Release and workspace discipline

- Read `docs/parallel-release-pipeline.md` before a release and `docs/workspace-organization.md` before starting or retiring a checkout.
- Keep changes on one isolated feature branch per repair. Preserve unrelated changes. Assign parallel workers explicit, non-overlapping file ownership and use one release owner.
- Run focused tests against the freshly compiled shell before pushing a candidate. Never test an old `_site` and report it as the current source.
- Push the feature branch and run its complete branch benchmark. `node scripts/release-candidate.mjs check` must verify the exact commit immediately before an authorized normal fast-forward promotion to main. Do not bypass checks, force-push main, or treat a failed preflight as a production deployment.
- Main verifies the successful exact-commit candidate proof and deploys its existing sealed artifact; it does not rebuild or repeat full candidate validation. Sealed artifact verification, current-main check, exact-live verification, all hosted suites and production health remain required. Missing or expired proof blocks publication. A passing candidate check is not a deployment or a guarantee of infrastructure availability.
- Prepare versions with `npm run release:version` using `package.json` as the source, before committing. Use one implementation/release owner and one bounded reviewer; retain the 30-minute active-repair checkpoint and one candidate validation plus at most one corrected validation.
- Never store secrets or local recovery snapshots in Git. Do not remove old worktrees merely because they are under Temp or appear merged. Inspect uncommitted/untracked/ignored work, shared Git ownership, active processes, backups, and reparse points first.

## Focused, efficient repairs

- Read only the code and instructions relevant to the requested repair; expand inspection when dependencies or failures justify it. Keep backups and reuse the repair's existing worktree and saved progress.
- Follow `docs/model-routing.md` to select the model/effort for useful delegated work by complexity. Use bounded prompts and avoid duplicating a worker's investigation. An existing conversation does not switch models merely because project defaults changed.
- Run the targeted regression locally and the complete required candidate validation once for the exact commit. Do not repeat broad suites locally and in CI without a concrete reason. Preserve all cross-module, permission, database, delivery, and hosted gates.
- Use `prepare --dispatch` to start or reuse a candidate benchmark, then `scripts/release-watch.mjs` to wait quietly. Do not poll run status or narrate unchanged jobs every 30-60 seconds. Monitoring success is not release approval: run the exact candidate check immediately before authorized promotion.
- Keep a short progress record outside Git with the branch, SHA, changed behavior, completed checks, run ID, failure (if any), and next action. Resume that evidence rather than rediscovering it. Use a fresh focused task for a separate repair.
