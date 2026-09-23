import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const excludedServices = 'studio,imgproxy,logflare,vector';
const writeReport = (name, report) => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(path.join('artifacts', name), `${JSON.stringify(report, null, 2)}\n`);
};

export function startIsolatedDatabase({ env = process.env, run = spawnSync, now = Date.now, save = writeReport } = {}) {
  const started = now();
  let exitCode = 1;
  let failure = 'ISOLATED_WORKDIR_REQUIRED';
  try {
    const expected = env.RUNNER_TEMP && path.resolve(env.RUNNER_TEMP, 'gnc-supabase-ci');
    if (!expected || !env.SUPABASE_CI_ROOT || path.resolve(env.SUPABASE_CI_ROOT) !== expected) return exitCode;
    failure = 'START_PROCESS_FAILED';
    const result = run('supabase', ['--workdir', expected, 'start', '--exclude', excludedServices], {
      stdio: 'inherit', shell: false, windowsHide: true,
      // setup-cli sets a GHCR-only override. Empty restores the pinned CLI's
      // ECR -> GHCR -> Docker Hub fallback and existing bounded pull retries.
      env: { ...env, SUPABASE_INTERNAL_IMAGE_REGISTRY: '' },
    });
    exitCode = Number.isInteger(result.status) && result.status >= 0 ? result.status : 1;
    failure = result.error || result.signal ? 'START_PROCESS_FAILED' : exitCode ? 'STACK_START_FAILED' : null;
    if (failure && exitCode === 0) exitCode = 1;
    return exitCode;
  } finally {
    save('database-startup.json', {
      schemaVersion: 'gnc-database-startup-v1', startedAt: new Date(started).toISOString(),
      durationMs: Math.max(0, now() - started), exitCode, failure,
      registryPolicy: 'cli-default-fallback', excludedServices: excludedServices.split(','),
    });
  }
}

export function collectDatabaseEvidence({ steps = {}, run = spawnSync, save = writeReport } = {}) {
  const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);
  const stages = Object.entries(steps).filter(([id]) => /^[\w-]+$/.test(id)).map(([id, step]) => ({
    id, outcome: outcomes.has(step?.outcome) ? step.outcome : 'unknown',
  }));
  const result = run('docker', ['image', 'ls', '--digests', '--no-trunc', '--format', '{{json .}}'], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000,
  });
  const available = !result.error && result.status === 0;
  const images = [];
  if (available) for (const line of String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean)) {
    const item = JSON.parse(line);
    if (!/^(?:(?:public\.ecr\.aws|ghcr\.io)\/supabase\/|supabase\/|kong$|envoyproxy\/|axllent\/mailpit$)/.test(item.Repository || '')) continue;
    if (!/^[\w./:-]+$/.test(item.Repository) || !/^[\w.-]+$/.test(item.Tag || '') || !/^sha256:[a-f0-9]{64}$/.test(item.ID || '')) continue;
    images.push({ repository: item.Repository, tag: item.Tag, id: item.ID,
      digest: /^sha256:[a-f0-9]{64}$/.test(item.Digest || '') ? item.Digest : null });
  }
  save('database-stages.json', { schemaVersion: 'gnc-database-stages-v1', stages,
    failedStages: stages.filter(stage => stage.outcome === 'failure').map(stage => stage.id),
    imageInventoryAvailable: available, images });
  return available ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (mode === 'start') process.exitCode = startIsolatedDatabase();
    else if (mode === 'evidence') process.exitCode = collectDatabaseEvidence({ steps: JSON.parse(process.env.DATABASE_STEPS || '{}') });
    else throw new Error('USAGE');
  } catch {
    console.error('DATABASE_STARTUP_OR_EVIDENCE_FAILED');
    process.exitCode = 1;
  }
}
