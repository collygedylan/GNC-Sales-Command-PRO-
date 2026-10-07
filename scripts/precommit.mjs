import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditTestDiscovery, discoverTests } from './test-discovery.mjs';
import { selectAffectedTests } from './select-focused-tests.mjs';
import { doctor } from './tooling-doctor.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';
import { gitRepositoryContextEnvironment } from './git-repository-context.mjs';

export function stagedPaths(root = repoRoot, execute = run) {
  return execute('git', ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMD', '-z'], { root, capture: true })
    .split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/'));
}
export function requiredChecks(files) {
  return {
    code: files.some(file => /\.(?:[cm]?jsx?|tsx?|html|json|ya?ml)$/.test(file) || /(?:^|\/)\.husky\//.test(file)),
    edge: files.some(file => file.startsWith('supabase/functions/') || file.startsWith('services/database-contract') || file === 'services/databaseRest.ts' || /^deno\./.test(file) || /^package(?:-lock)?\.json$/.test(file)),
    database: files.some(file => /\.sql$/.test(file) || /(?:^|\/)(?:sandbox\.)?database\.types\.ts$/.test(file)
      || /contracts\.generated\.ts$/.test(file)
      || /^scripts\/(?:database-|sandbox-database-workspace|db-|generate-database|check-database|historical-database-|disposable-supabase-container|run-sql-rollback-tests|run-postgres-fixture-sql-tests|run-discovered-database-tests|prepare-isolated-sql-tests|test-discovery)/.test(file)
      || file === '.github/workflows/release-database.yml' || file === 'scripts/sql-lint-temp-context.mjs'
      || /^supabase\/(?:config\.toml|schema\/|ci\/.*(?:baseline|fixture))/.test(file)),
  };
}
export function precommit({ root = repoRoot, files = stagedPaths(root), execute = runNode, preflight = doctor } = {}) {
  if (!files.length) return;
  const checks = requiredChecks(files);
  preflight({ root, edge: checks.edge, database: checks.database });
  auditTestDiscovery({ root });
  const existing = files.filter(file => existsSync(path.join(root, file)) && statSync(path.join(root, file)).isFile());
  const code = existing.filter(file => /\.(?:[cm]?jsx?|tsx?)$/.test(file));
  const testEnvironment = () => ({ ...gitRepositoryContextEnvironment({ root }), CI: '1' });
  const step = (label, args, isolatedTest = false) => {
    console.log(`[pre-commit] ${label}`);
    execute(args, { root, env: isolatedTest ? testEnvironment() : { CI: '1' } });
  };
  // Argument arrays avoid shell interpolation; chunks also respect Windows limits.
  for (let start = 0; start < code.length; start += 30) {
    step('staged lint', [packageBin('eslint', 'eslint', root), '--no-warn-ignored', '--max-warnings=0', ...code.slice(start, start + 30)]);
  }
  if (existing.includes('index.html')) step('inline syntax', ['scripts/check-inline-scripts.mjs']);
  if (checks.code || checks.database) step('TypeScript', [packageBin('typescript', 'tsc', root), '--noEmit', '-p', 'tsconfig.json']);
  if (checks.code || checks.database) step('generated runtime contracts', ['scripts/generate-database-contracts.mjs', '--check']);
  if (checks.code || checks.database) step('database boundary coverage', ['scripts/check-database-boundaries.mjs']);
  if (checks.edge) step('Edge TypeScript', [packageBin('deno', 'deno', root), 'check', ...discoverTests({ root, group: 'deno-entrypoints' })]);
  const affected = selectAffectedTests(files, { root });
  if (affected.nodeUnit?.length) step('affected unit and mount tests', ['--test', '--test-concurrency=1', ...affected.nodeUnit], true);
  if (affected.vitest?.length) step('affected React/unit tests', [packageBin('vitest', 'vitest', root), 'run', '--config', 'vite.v2.config.ts', ...affected.vitest], true);
  if (checks.edge) step('Edge unit tests', [packageBin('deno', 'deno', root), 'test', '--node-modules-dir=auto', '--allow-env', '--allow-net', ...discoverTests({ root, group: 'deno-tests' })], true);
  for (const file of affected.python || []) run(process.env.PYTHON || 'python', [file], { root, env: testEnvironment() });
  if (checks.database || affected.requiresLocalDb) step('local database validation', ['scripts/database-check.mjs', '--staged']);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--staged') throw new Error('Usage: node scripts/precommit.mjs --staged');
    precommit();
  } catch (error) { console.error(`[pre-commit] ${error.message}`); process.exitCode = 1; }
}
