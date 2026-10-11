import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseBenchmarkManifest } from '../services/performanceBaseline.ts';
import { repoRoot, run, runNode } from './tooling-process.mjs';
import { sealReleaseArtifact, verifyReleaseArtifact } from './release-artifact.mjs';

// Cloud-only: the live release is built once elsewhere; this builds the pinned
// historical comparison in a separate directory and never edits that artifact.
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('PERFORMANCE_BASELINE_BUILD_CLOUD_ONLY');
const manifest = parseBenchmarkManifest(JSON.parse(readFileSync(path.join(repoRoot, 'performance/baseline.json'), 'utf8')));
const directory = path.join(repoRoot, '.gnc-local', `performance-baseline-${manifest.baselineCommit}`);
const site = path.join(directory, '_site');
const env = { ...process.env, GITHUB_SHA: manifest.baselineCommit, DEPLOYMENT_COMMIT: manifest.baselineCommit, EXPECTED_RELEASE_COMMIT: manifest.baselineCommit };
if (!existsSync(path.join(site, 'release-manifest.json'))) {
  if (existsSync(directory)) throw new Error('PERFORMANCE_BASELINE_PARTIAL_BUILD: preserve diagnostics and use a clean CI workspace');
  mkdirSync(directory, { recursive: true });
  const archive = path.join(directory, 'source.tar');
  const output = openSync(archive, 'wx');
  try {
    const result = spawnSync('git', ['archive', '--format=tar', manifest.baselineCommit], { cwd: repoRoot, stdio: ['ignore', output, 'pipe'] });
    if (result.error || result.status !== 0) throw new Error('PERFORMANCE_BASELINE_ARCHIVE_FAILED');
  } finally { closeSync(output); }
  run('tar', ['-xf', archive, '-C', directory]);
  // The baseline is dependency-locked. Never silently build old code with an
  // incompatible candidate dependency tree.
  const baselineLock = readFileSync(path.join(directory, 'package-lock.json'), 'utf8');
  const currentLock = readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8');
  const dependencies = raw => { const value = JSON.parse(raw); delete value.version; delete value.packages[''].version; return JSON.stringify(value); };
  if (dependencies(baselineLock) === dependencies(currentLock)) {
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    // A candidate dependency upgrade must still compare against the old locked
    // tree; it must not force a baseline reset or rebuild old code with new deps.
    run('npm', ['ci', '--no-audit', '--no-fund'], { root: directory, env });
  }
  for (const command of ['build:pilot-monitoring', 'build:live:assets', 'build:v2']) {
    run('npm', ['run', command], { root: directory, env });
  }
  runNode(['scripts/prepare-release-site.mjs'], { root: directory, env });
  await sealReleaseArtifact(site, env);
}
const digest = createHash('sha256').update(readFileSync(path.join(site, 'release-manifest.json'))).digest('hex');
await verifyReleaseArtifact(site, { ...env, EXPECTED_RELEASE_DIGEST: digest });
console.log(`PERFORMANCE_BASELINE_READY ${manifest.baselineCommit} ${digest}`);
