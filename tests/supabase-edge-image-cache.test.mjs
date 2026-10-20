import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheSupabaseImages } from '../scripts/ci-supabase-image-cache.mjs';

const digest = 'sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45';
const canonical = 'public.ecr.aws/supabase/edge-runtime:v1.74.2';
const mirror = `ghcr.io/supabase/edge-runtime@${digest}`;
const proof = JSON.stringify([mirror]);
const inspect = image => ['image', 'inspect', image, '--format', '{{json .RepoDigests}}'];

function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'gnc-edge-image-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  if (options.archive) {
    mkdirSync(path.join(directory, 'gnc-supabase-images'));
    writeFileSync(path.join(directory, 'gnc-supabase-images', 'images.tar'), 'fixture');
  }
  const calls = [];
  let tagged = false;
  const run = (command, args, spawnOptions) => {
    assert.equal(command, 'docker');
    assert.equal(spawnOptions.shell, false);
    calls.push(args);
    if (args[1] === 'inspect') {
      if (args[2] === canonical && !tagged) return options.cached
        ? { status: 0, stdout: options.cached }
        : { status: 1, stdout: '' };
      if (args[2] === canonical && tagged) return { status: 0, stdout: options.taggedProof ?? proof };
      return { status: 0, stdout: options.mirrorProof ?? proof };
    }
    if (args[1] === 'pull' && options.pullFailure) return { status: 1, stderr: 'registry unavailable' };
    if (args[1] === 'tag') tagged = true;
    return { status: 0, stdout: '' };
  };
  return { calls, env: { RUNNER_TEMP: directory }, run };
}

test('cold image restore verifies the immutable multiarch mirror and seeds the unchanged ECR tag', t => {
  const f = fixture(t);
  cacheSupabaseImages('restore', f);
  assert.deepEqual(f.calls, [inspect(canonical), ['image', 'pull', mirror], inspect(mirror),
    ['image', 'tag', mirror, canonical], inspect(canonical)]);
  assert.equal(f.calls.some(args => args.includes('--platform')), false, 'Docker selects the native platform from the same pinned index');
});

test('verified cached runtime avoids registry calls', t => {
  const f = fixture(t, { cached: proof });
  cacheSupabaseImages('restore', f);
  assert.deepEqual(f.calls, [inspect(canonical)]);
});

test('archive hits still seed a missing runtime after loading reusable images', t => {
  const f = fixture(t, { archive: true });
  cacheSupabaseImages('restore', f);
  assert.deepEqual(f.calls[0], ['image', 'load', '--input', path.join(f.env.RUNNER_TEMP, 'gnc-supabase-images', 'images.tar')]);
  assert.deepEqual(f.calls[1], inspect(canonical));
  assert.deepEqual(f.calls.at(-1), inspect(canonical));
});

test('an unproven cache tag is replaced only from the exact pinned mirror', t => {
  for (const cached of ['null', '[]', JSON.stringify([`public.ecr.aws/supabase/edge-runtime@sha256:${'b'.repeat(64)}`])]) {
    const f = fixture(t, { cached });
    cacheSupabaseImages('restore', f);
    assert.deepEqual(f.calls.find(args => args[1] === 'pull'), ['image', 'pull', mirror]);
    assert.deepEqual(f.calls.find(args => args[1] === 'tag'), ['image', 'tag', mirror, canonical]);
  }
});

test('the final canonical tag must retain verified pinned identity', t => {
  const f = fixture(t, { taggedProof: '[]' });
  assert.throws(() => cacheSupabaseImages('restore', f), /SUPABASE_EDGE_IMAGE_IDENTITY_INVALID/);
  assert.deepEqual(f.calls.at(-1), inspect(canonical));
});

test('mirror pull and identity failures stop before an unverified ECR tag can be used', t => {
  for (const options of [{ pullFailure: true }, { mirrorProof: '[]' }, { mirrorProof: 'not-json' }]) {
    const f = fixture(t, options);
    assert.throws(() => cacheSupabaseImages('restore', f), /SUPABASE_(?:IMAGE_CACHE_FAILED|EDGE_IMAGE_IDENTITY_INVALID)/);
    assert.equal(f.calls.some(args => args[1] === 'tag'), false);
  }
});
