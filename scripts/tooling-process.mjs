import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function packageBin(name, bin, root = repoRoot) {
  const require = createRequire(path.join(root, 'package.json'));
  const manifest = require.resolve(name + '/package.json');
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[bin];
  if (!entry) throw new Error(`Missing ${name} executable. Run npm ci before committing.`);
  return path.resolve(path.dirname(manifest), entry);
}
export function run(command, args, { root = repoRoot, env = {}, spawn = spawnSync, capture = false, input } = {}) {
  const result = spawn(command, args, { cwd: root, shell: false, windowsHide: true,
    env: { ...process.env, ...env }, encoding: 'utf8', stdio: capture || input !== undefined ? 'pipe' : 'inherit',
    ...(input === undefined ? {} : { input }) });
  if (result.error || result.status !== 0) {
    const diagnostics = [result.stderr, result.stdout].filter(Boolean).join('\n');
    const error = new Error(`${path.basename(command)} failed (${result.status ?? result.error?.code ?? 'unknown'}).${capture ? '\n' + diagnostics : ''}`);
    error.cause = result.error;
    throw error;
  }
  return result.stdout || '';
}
export const runNode = (args, options) => run(process.execPath, args, options);
