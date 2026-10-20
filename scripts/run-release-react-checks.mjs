import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

// Scope selection belongs to the caller. A selected React check always executes.
export function runReleaseReactChecks({ rootDir = repositoryRoot, argv = [], spawn = spawnSync } = {}) {
  const vitest = path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs');
  const result = spawn(process.execPath, [vitest, 'run', '--config', 'vite.v2.config.ts', ...argv], {
    cwd: rootDir, stdio: 'inherit', env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = runReleaseReactChecks({ argv: process.argv.slice(2) }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
