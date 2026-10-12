import { mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function selectSupabaseImages(output) {
  return [...new Set(output.split(/\r?\n/).filter(name =>
    /^(?:(?:public\.ecr\.aws|ghcr\.io)\/supabase\/|supabase\/|postgrest\/|kong:|envoyproxy\/|axllent\/mailpit:)[\w./:-]+$/.test(name)
    && !name.endsWith(':<none>')))];
}
export function cacheSupabaseImages(mode, { env = process.env, run = spawnSync } = {}) {
  if (!env.RUNNER_TEMP || !['restore', 'save'].includes(mode)) throw new Error('IMAGE_CACHE_ARGUMENT_INVALID');
  const directory = path.join(env.RUNNER_TEMP, 'gnc-supabase-images');
  const archive = path.join(directory, 'images.tar');
  const execute = args => {
    const result = run('docker', args, { encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('SUPABASE_IMAGE_CACHE_FAILED');
    return result.stdout || '';
  };
  if (mode === 'restore') {
    if (existsSync(archive)) execute(['image', 'load', '--input', archive]);
    return;
  }
  const images = selectSupabaseImages(execute(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']));
  if (!images.length) throw new Error('SUPABASE_IMAGE_CACHE_EMPTY');
  mkdirSync(directory, { recursive: true });
  execute(['image', 'save', '--output', archive, ...images]);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) cacheSupabaseImages(process.argv[2]);
