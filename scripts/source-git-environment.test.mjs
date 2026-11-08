import test from 'node:test';
import { assertSourceGitWorktreeIsolation } from '../src/core/git-worktree-invariant.mjs';

test('artifact source checks isolate inherited linked-worktree Git state', assertSourceGitWorktreeIsolation);
