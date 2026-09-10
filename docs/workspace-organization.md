# Workspace organization and safe retirement

Use a permanent local development directory outside Temp and synchronized business-document folders. On the current Windows workstation this is `C:\Users\dylan\Projects\GNC`:

- `repo`: clean main checkout, tracking `origin/main`.
- `worktrees`: named active feature branches, one per repair.
- `recovery`: private dated backups and recovery manifests; never deploy or commit them.
- `reports`: test, release, and cleanup evidence; never deployment source.
- `tools`: explicitly scoped local maintenance scripts.

## Daily workflow

1. Confirm the base checkout is clean, fetch origin, and fast-forward main. Stop if it diverged; preserve work rather than reset it.
2. Create a named feature worktree under `worktrees` with `git worktree add -b`. Reuse that directory until the repair is complete. Do not repeatedly clone into Temp.
3. Install locked dependencies with `npm ci`. Retain shared npm and Playwright caches; clearing them routinely makes subsequent work slower.
4. Split implementation and regression verification across independent workers with explicit file ownership. Run performance tests in isolated lanes.
5. Use the exact-commit candidate preflight in `parallel-release-pipeline.md`, followed by normal main validation, sealed-artifact publication and live verification. Record the candidate SHA and successful run.

## Retiring old work

Cleanup is separate from release publication. A checkout being old or merged does not prove it is disposable: it can contain unique unstaged, staged, untracked or ignored work, and the primary checkout may own shared Git metadata for other worktrees.

Before retiring anything, inventory every registered worktree, branch and dirty state. Preserve all refs in a verified Git bundle plus source snapshots and separate staged/unstaged binary patches. Include private local files in private recovery storage, not in Git. Record SHA-256 checksums and restore instructions. Confirm archives are readable and files did not change during backup.

For a first cleanup, prefer removing only regenerable dependency installs from individually verified inactive, clean, merged worktrees. Keep their lockfiles, source, Git registration and history. Enumerate exact targets, reject reparse points, inspect active ownership and locks, review a dry-run, and revalidate it before deletion. Stop on any discrepancy or locked file; never switch to a stronger delete command.

Do not automate deletion of `gnc-*` directories by age. The legacy `gnc-photo-history-20260904` checkout owns the shared Git directory of older linked worktrees and must remain until an explicit migration retires those links. Current work and all dirty source copies remain protected. Do not blanket-delete Temp, browser profiles, caches, photos, business documents, or session history.

Future archive/retirement work should be one reviewed batch at a time, with a receipt showing what was removed, reclaimed bytes, and how to recover it. No automatic worktree cleanup is scheduled by this change.
