import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';

// Initial Supabase image downloads and their extracted layers can require several
// gigabytes. Keep an 8 GiB fail-fast floor; 15 GiB is recommended for the first pull.
export const MINIMUM_DATABASE_FREE_BYTES = 8 * 1024 ** 3;

export function doctor({ root = repoRoot, database = false, edge = false, execute = run, node = runNode,
  statfs = statfsSync, temporaryDirectory = tmpdir() } = {}) {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && (minor < 22 || (minor === 22 && patch < 1)))) {
    throw new Error('Node 22.22.1 or newer is required by the pinned commit tooling.');
  }
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of ['husky', 'lint-staged', 'eslint', 'typescript', ...(edge ? ['deno'] : []), ...(database ? ['supabase'] : [])]) {
    const file = path.join(root, 'node_modules', name, 'package.json');
    if (!existsSync(file) || JSON.parse(readFileSync(file, 'utf8')).version !== pkg.devDependencies[name]) {
      throw new Error(`${name} does not match package.json. Run npm ci before committing.`);
    }
  }
  if (edge) node([packageBin('deno', 'deno', root), '--version'], { root, capture: true });
  if (database) {
    let freeByPath;
    try {
      freeByPath = [root, temporaryDirectory].map(directory => {
        const disk = statfs(directory);
        return { directory, bytes: Number(disk.bavail) * Number(disk.bsize) };
      });
    } catch {
      throw new Error('Local SQL validation requires checking free space on both the repository and temporary-storage volumes. At least 8 GiB must be available before downloading Supabase images; 15 GiB is recommended for the first pull. Free space could not be measured, so no database checks were skipped.');
    }
    const low = freeByPath.filter(disk => !Number.isFinite(disk.bytes) || disk.bytes < MINIMUM_DATABASE_FREE_BYTES);
    if (low.length) {
      const available = low.map(disk => `${disk.directory}: ${Number.isFinite(disk.bytes) ? `${(disk.bytes / 1024 ** 3).toFixed(2)} GiB` : 'unknown'}`).join(', ');
      throw new Error(`Local SQL validation requires at least 8 GiB free on both the repository and temporary-storage volumes before downloading Supabase images (15 GiB is recommended for the first pull). Low space: ${available}. No database checks were skipped.`);
    }
    node([packageBin('supabase', 'supabase', root), '--version'], { root, capture: true });
    try {
      const version = execute('docker', ['info', '--format', '{{.ServerVersion}}'], { root, capture: true }).trim();
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Docker did not report a running engine version.');
    }
    catch { throw new Error('Local SQL validation requires a working Docker engine. Start or repair Docker Desktop, confirm docker info succeeds, then retry. No database checks were skipped.'); }
  }
  return { node: process.versions.node, edge, database };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(doctor({ database: process.argv.includes('--database'), edge: process.argv.includes('--edge') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
