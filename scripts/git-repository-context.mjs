import { repoRoot, run } from './tooling-process.mjs';

/** Keep a hook's index and repository variables out of foreign test repositories. */
export function gitRepositoryContextEnvironment({ root = repoRoot, env = process.env, execute = run } = {}) {
  const names = execute('git', ['rev-parse', '--local-env-vars'], { root, capture: true }).trim().split(/\s+/);
  if (!names.length || names.some(name => !/^GIT_[A-Z0-9_]+$/.test(name))) {
    throw new Error('GIT_REPOSITORY_ENVIRONMENT_INVALID');
  }
  const clean = { ...env };
  // Undefined removes these keys in spawn(), including when a runner merges
  // overrides with process.env. Deleting them here would reintroduce them.
  for (const name of names) clean[name] = undefined;
  for (const name of Object.keys(clean)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)) clean[name] = undefined;
  }
  return clean;
}
