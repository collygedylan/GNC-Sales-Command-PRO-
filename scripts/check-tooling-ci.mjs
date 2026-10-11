import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';
import { doctor } from './tooling-doctor.mjs';
import { checkDatabaseBoundaries } from './check-database-boundaries.mjs';
import { auditTestDiscovery } from './test-discovery.mjs';

export function changedPaths({ root = repoRoot, execute = run, base = process.env.GNC_CHECK_BASE || 'origin/main' } = {}) {
  const mergeBase = execute('git', ['merge-base', 'HEAD', base], { root, capture: true }).trim();
  const output = execute('git', ['diff', '--name-only', '--no-renames', '--diff-filter=ACMD', '-z', mergeBase], { root, capture: true });
  const untracked = execute('git', ['ls-files', '--others', '--exclude-standard', '-z'], { root, capture: true });
  return [...new Set(`${output}\0${untracked}`.split('\0').filter(Boolean))];
}
export function checkTooling({ root = repoRoot, files = changedPaths({ root }), execute = runNode } = {}) {
  doctor({ root });
  auditTestDiscovery({ root });
  const code = files.filter(file => /\.[cm]?[jt]sx?$/.test(file) && existsSync(path.join(root, file)) && statSync(path.join(root, file)).isFile());
  for (let start = 0; start < code.length; start += 30) execute([packageBin('eslint', 'eslint', root), '--no-warn-ignored', '--max-warnings=0', ...code.slice(start, start + 30)], { root });
  execute(['scripts/check-inline-scripts.mjs'], { root });
  execute([packageBin('typescript', 'tsc', root), '--noEmit', '-p', 'tsconfig.json'], { root });
  execute(['scripts/generate-database-contracts.mjs', '--check'], { root });
  checkDatabaseBoundaries({ root });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { checkTooling(); }
  catch (error) { console.error(`[tooling] ${error.message}`); process.exitCode = 1; }
}
