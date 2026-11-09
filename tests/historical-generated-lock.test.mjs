import { compileOpsPrecisionPilot } from '../scripts/build-ops-precision-pilot.mjs';
import { compileBunchQueue } from '../scripts/build-bunch-queue.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileHistoricalRequests } from '../scripts/build-historical-requests.mjs';
import { checkHistoricalGeneratedOutput, validateHistoricalIndexInputs } from '../scripts/engineering-validator.mjs';

const root = process.cwd();
const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

test('historical bundle parity checks the real deterministic builder output', async () => {
  const { outputs } = await compileHistoricalRequests({ root });
  const file = 'assets/historical-requests.js';
  const source = outputs.get(path.join(root, file)).toString('utf8');
  assert.equal(checkHistoricalGeneratedOutput({ file, source, version: 'worktree' }, outputs, root), '');
  assert.match(checkHistoricalGeneratedOutput({ file, source: source + '\n// changed', version: 'index' }, outputs, root), /index:.*differs/);
  assert.match(checkHistoricalGeneratedOutput({ file: 'assets/historical-requests-chunks/not-built.js', source, version: 'worktree' }, outputs, root), /did not produce/);
});

test('historical index verification rejects unstaged and missing source inputs', async () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'historical-index-'));
  try {
    git(repo, ['init', '--quiet']);
    writeFileSync(path.join(repo, 'source.js'), 'first\n');
    git(repo, ['add', 'source.js']);
    await validateHistoricalIndexInputs(repo, ['source.js']);
    writeFileSync(path.join(repo, 'source.js'), 'second\n');
    await assert.rejects(validateHistoricalIndexInputs(repo, ['source.js']), /differ from worktree/);
    await assert.rejects(validateHistoricalIndexInputs(repo, ['absent.js']), /source missing/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});


test('ops pilot bundle must exactly match its deterministic source build', async () => {
  const { outputs, inputs } = await compileOpsPrecisionPilot({ root });
  const file = 'assets/ops-precision-pilot.js';
  const source = outputs.get(path.join(root, file)).toString('utf8');
  assert.ok(inputs.includes('src/ui/ops-pilot-entry.js'));
  assert.equal(checkHistoricalGeneratedOutput({ file, source, version: 'worktree' }, outputs, root), '');
  assert.match(checkHistoricalGeneratedOutput({ file, source: source + 'changed', version: 'index' }, outputs, root), /differs/);
});

test('bunch queue bundle must exactly match its canonical source build', async () => {
  const { outputs, inputs } = await compileBunchQueue({ root });
  const file = 'assets/bunch-queue.js';
  const source = outputs.get(path.join(root, file)).toString('utf8');
  assert.ok(inputs.includes('components/bunch-queue/mount.tsx'));
  assert.equal(checkHistoricalGeneratedOutput({ file, source, version: 'worktree' }, outputs, root), '');
  assert.match(checkHistoricalGeneratedOutput({ file, source: source + 'changed', version: 'index' }, outputs, root), /differs/);
});
