import {parseGitBatch, readGitBlobs} from './git-batch-blobs.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {monolithFailures} from './monolith-growth-lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inspect = dir => monolithFailures(dir);
const lines = n => Array.from(Array(n).keys(), i => `line ${i}\n`).join('');
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8', windowsHide:true}).trim();
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'monolith-lock-'));
  git(dir, 'init', '-q');
  const objects = git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'objects');
  await writeFile(path.join(dir, '.git/objects/info/alternates'), objects + '\n');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  await mkdir(path.join(dir, 'scripts'));
  await writeFile(path.join(dir, 'scripts/monolith-baseline.json'), await readFile(path.join(root, 'scripts/monolith-baseline.json')));
  await writeFile(path.join(dir, 'Code.gs'), lines(600));
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}
async function write(dir, file, data) {
  await mkdir(path.dirname(path.join(dir, file)), {recursive:true});
  await writeFile(path.join(dir, file), data);
}
function includes(issues, expected) { assert.ok(issues.some(issue => issue.includes(expected)), issues.join('\n')); }

test('monolith growth, staging, renames and immutable baseline', async () => {
  const dir = await fixture();
  try {
    assert.deepEqual(await inspect(dir), []);
    await write(dir, 'Code.gs', lines(601));
    includes(await inspect(dir), 'legacy file grew');
    git(dir, 'add', 'Code.gs');
    await write(dir, 'Code.gs', lines(599));
    includes(await inspect(dir), 'index: Code.gs: legacy file grew');
    git(dir, 'reset', '-q', 'HEAD', '--', 'Code.gs');
    assert.deepEqual(await inspect(dir), []);
    await write(dir, 'src/core/safe.mjs', lines(400));
    assert.deepEqual(await inspect(dir), []);
    await write(dir, 'src/core/large.mjs', lines(401));
    includes(await inspect(dir), 'new module exceeds 400');
    git(dir, 'add', 'src/core/large.mjs');
    await write(dir, 'src/core/large.mjs', lines(400));
    includes(await inspect(dir), 'index: src/core/large.mjs: new module exceeds 400');
    git(dir, 'reset', '-q', 'HEAD', '--', 'src/core/large.mjs');
    await rm(path.join(dir, 'src/core/large.mjs'));
    git(dir, 'mv', 'Code.gs', 'renamed.mjs');
    includes(await inspect(dir), 'new module exceeds 400');
    await write(dir, 'scripts/monolith-baseline.json', '{}');
    includes(await inspect(dir), 'baseline is immutable');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('CI inspects individual commits even when later changes shrink', async () => {
  const dir = await fixture();
  const prior = process.env.GITHUB_EVENT_PATH;
  try {
    const base = git(dir, 'rev-parse', 'HEAD');
    await write(dir, 'Code.gs', lines(601));
    git(dir, 'add', 'Code.gs');
    git(dir, 'commit', '-qm', 'growth');
    await write(dir, 'Code.gs', lines(599));
    git(dir, 'add', 'Code.gs');
    git(dir, 'commit', '-qm', 'shrink');
    const event = path.join(dir, 'event.json');
    await writeFile(event, JSON.stringify({before:base}));
    process.env.GITHUB_EVENT_PATH = event;
    includes(await inspect(dir), 'legacy file grew');
  } finally {
    if (prior === undefined) delete process.env.GITHUB_EVENT_PATH;
    else process.env.GITHUB_EVENT_PATH = prior;
    await rm(dir, {recursive:true, force:true});
  }
});


test('a committed shrink permanently lowers the next ceiling', async () => {
  const dir = await fixture();
  try {
    await write(dir, 'Code.gs', lines(550));
    git(dir, 'add', 'Code.gs');
    git(dir, 'commit', '-qm', 'shrink');
    await write(dir, 'Code.gs', lines(551));
    includes(await inspect(dir), 'legacy file grew by 1 lines');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('a new module remains capped after its introduction commit', async () => {
  const dir = await fixture();
  try {
    const base = git(dir, 'rev-parse', 'HEAD');
    await write(dir, 'src/core/owner.mjs', lines(400));
    git(dir, 'add', 'src/core/owner.mjs');
    git(dir, 'commit', '-qm', 'new owner');
    await write(dir, 'src/core/owner.mjs', lines(401));
    includes(await inspect(dir), 'new module exceeds 400');
    git(dir, 'add', 'src/core/owner.mjs');
    git(dir, 'commit', '-qm', 'oversized');
    await write(dir, 'src/core/owner.mjs', lines(399));
    git(dir, 'add', 'src/core/owner.mjs');
    git(dir, 'commit', '-qm', 'corrected');
    const event = path.join(dir, 'event.json'), prior = process.env.GITHUB_EVENT_PATH;
    await writeFile(event, JSON.stringify({before:base}));
    process.env.GITHUB_EVENT_PATH = event;
    try { includes(await inspect(dir), 'new module exceeds 400'); }
    finally {
      if (prior === undefined) delete process.env.GITHUB_EVENT_PATH;
      else process.env.GITHUB_EVENT_PATH = prior;
    }
  } finally { await rm(dir, {recursive:true, force:true}); }
});


test('Git batch framing preserves binary bytes and rejects missing or incomplete objects', async () => {
  const header = Buffer.from('a'.repeat(40) + ' blob 3\0');
  const body = Buffer.from([0, 10, 255]);
  const framed = Buffer.concat([header, body, Buffer.from([0])]);
  assert.deepEqual(parseGitBatch(framed, 1)[0], body);
  assert.throws(() => parseGitBatch(framed.subarray(0, -1), 1), /Incomplete/);
  assert.throws(() => parseGitBatch(Buffer.from(':missing missing\0'), 1), /Invalid/);
  assert.throws(() => parseGitBatch(Buffer.concat([framed, Buffer.from([0])]), 1), /Unexpected/);
  await assert.rejects(readGitBlobs(root, [':not-a-real-file']), /Invalid Git batch object/);
});
