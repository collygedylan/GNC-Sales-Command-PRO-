import { mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Supabase CLI 2.111.0's unchanged runtime, verified identical in ECR/GHCR.
// Pin the multiarch index so Docker chooses the host's matching platform.
const EDGE_RUNTIME_DIGEST = 'sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45';
const EDGE_RUNTIME_CANONICAL = 'public.ecr.aws/supabase/edge-runtime:v1.74.2';
const EDGE_RUNTIME_MIRROR = `ghcr.io/supabase/edge-runtime@${EDGE_RUNTIME_DIGEST}`;

export function selectSupabaseImages(output) {
  return [...new Set(output.split(/\r?\n/).filter(name =>
    /^(?:(?:public\.ecr\.aws|ghcr\.io)\/supabase\/|supabase\/|postgrest\/|kong:|envoyproxy\/|axllent\/mailpit:)[\w./:-]+$/.test(name)
    && !name.endsWith(':<none>')))];
}
export function cacheSupabaseImages(mode, { env = process.env, run = spawnSync } = {}) {
  if (!env.RUNNER_TEMP || !['restore', 'save'].includes(mode)) throw new Error('IMAGE_CACHE_ARGUMENT_INVALID');
  const directory = path.join(env.RUNNER_TEMP, 'gnc-supabase-images');
  const archive = path.join(directory, 'images.tar');
  const invoke = args => run('docker', args, { encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const execute = args => {
    const result = invoke(args);
    if (result.error || result.status !== 0) throw new Error('SUPABASE_IMAGE_CACHE_FAILED');
    return result.stdout || '';
  };
  const hasPinnedRuntime = (image, allowMissing = false) => {
    const result = invoke(['image', 'inspect', image, '--format', '{{json .RepoDigests}}']);
    if (result.error) throw new Error('SUPABASE_IMAGE_CACHE_FAILED');
    if (result.status !== 0) {
      if (allowMissing) return false;
      throw new Error('SUPABASE_EDGE_IMAGE_IDENTITY_INVALID');
    }
    let digests;
    try { digests = JSON.parse(result.stdout || ''); }
    catch { throw new Error('SUPABASE_EDGE_IMAGE_IDENTITY_INVALID'); }
    if (digests === null) return false; // Docker archives can omit RepoDigests.
    if (!Array.isArray(digests) || digests.some(value => typeof value !== 'string')) {
      throw new Error('SUPABASE_EDGE_IMAGE_IDENTITY_INVALID');
    }
    return digests.includes(EDGE_RUNTIME_MIRROR)
      || digests.includes(`public.ecr.aws/supabase/edge-runtime@${EDGE_RUNTIME_DIGEST}`);
  };
  if (mode === 'restore') {
    if (existsSync(archive)) execute(['image', 'load', '--input', archive]);
    // `functions serve` asks Docker for the ECR tag directly, unlike stack
    // startup's registry fallback. Seed that tag before native-auth checks.
    if (!hasPinnedRuntime(EDGE_RUNTIME_CANONICAL, true)) {
      execute(['image', 'pull', EDGE_RUNTIME_MIRROR]);
      if (!hasPinnedRuntime(EDGE_RUNTIME_MIRROR)) throw new Error('SUPABASE_EDGE_IMAGE_IDENTITY_INVALID');
      execute(['image', 'tag', EDGE_RUNTIME_MIRROR, EDGE_RUNTIME_CANONICAL]);
      if (!hasPinnedRuntime(EDGE_RUNTIME_CANONICAL)) throw new Error('SUPABASE_EDGE_IMAGE_IDENTITY_INVALID');
    }
    return;
  }
  const images = selectSupabaseImages(execute(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']));
  if (!images.length) throw new Error('SUPABASE_IMAGE_CACHE_EMPTY');
  mkdirSync(directory, { recursive: true });
  execute(['image', 'save', '--output', archive, ...images]);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) cacheSupabaseImages(process.argv[2]);
