import {readGitBlobs} from './git-batch-blobs.mjs';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const baselinePath = 'scripts/monolith-baseline.json';
const baselineDigest = 'b706275b958ad74f327126efd9e364f1d616bc7bab0acd13be9201b5652a73ea';
const modulePath = /\.(?:[cm]?[jt]sx?|gs)$/i;
const hash = data => createHash('sha256').update(data.toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
const git = (root, args) => new Promise((resolve, reject) => {
  execFile('git', args, {cwd:root, encoding:'buffer', windowsHide:true, maxBuffer:64 * 1024 * 1024},
    (error, output) => error ? reject(error) : resolve(output));
});

function parseStats(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);
    if (!match) throw new Error('Invalid Git numstat output');
    return {added:match[1], deleted:match[2], file:match[3]};
  });
}
function physicalLines(buffer) {
  if (buffer.includes(0)) return null;
  const text = new TextDecoder('utf-8', {fatal:true});
  try { text.decode(buffer); } catch { return null; }
  if (!buffer.length) return 0;
  return buffer.toString('utf8').split(/\r\n|\r|\n/).length - (/\r$|\n$/.test(buffer.toString('utf8')) ? 1 : 0);
}
function inspectLegacy(item, label) {
  if (item.added === '-' || item.deleted === '-') return `${label}: ${item.file}: legacy text became binary`;
  const delta = Number(item.added) - Number(item.deleted);
  return delta > 0 ? `${label}: ${item.file}: legacy file grew by ${delta} lines` : null;
}
function inspectStats(stats, baseline, label) {
  const issues = [], candidates = [];
  for (const item of stats) {
    const {file, added} = item;
    if (file === baselinePath) candidates.push({...item, baselineFile:true});
    if (Object.hasOwn(baseline.files, file)) {
      const issue = inspectLegacy(item, label);
      if (issue) issues.push(issue);
    } else if ((added !== '-' && Number(added) > 0) || (added === '-' && modulePath.test(file))) candidates.push(item);
  }
  return {issues, candidates};
}
async function checkCandidates(candidates, label, readVersion, originalFiles) {
  const issues = [];
  await Promise.all(candidates.map(async item => {
    const content = await readVersion(item.file);
    if (item.baselineFile) {
      if (hash(content) !== baselineDigest) issues.push(`${label}: monolith baseline is immutable`);
      return;
    }
    const lines = physicalLines(content);
    const added = Number(item.added), deleted = Number(item.deleted);
    if (lines === null) return;
    if (item.added === '-' && modulePath.test(item.file) && lines > 400) {
      issues.push(`${label}: ${item.file}: binary-classified module exceeds 400 lines (${lines})`);
      return;
    }
    if (!originalFiles.has(item.file) && modulePath.test(item.file) && lines > 400)
      issues.push(`${label}: ${item.file}: new module exceeds 400 lines (${lines})`);
    else if (lines > 500 && added > deleted)
      issues.push(`${label}: ${item.file}: oversized text file grew (${lines} lines)`);
  }));
  return issues;
}
async function checkDiff(root, baseline, label, args, readVersion, originalFiles, gitPrefix = null) {
  const stats = parseStats(await git(root, ['diff', '--no-ext-diff', '--no-renames', '--numstat', '-z', ...args, '--']));
  const {issues, candidates} = inspectStats(stats, baseline, label);
  if (gitPrefix !== null) {
    const specs = candidates.map(item => gitPrefix + item.file);
    const blobs = await readGitBlobs(root, specs);
    readVersion = file => blobs.get(gitPrefix + file);
  }
  return issues.concat(await checkCandidates(candidates, label, readVersion, originalFiles));
}
async function untrackedFailures(root) {
  const files = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).toString('utf8').split('\0').filter(Boolean);
  const candidates = files.filter(file => modulePath.test(file) || file === baselinePath)
    .map(file => ({file, baselineFile:file === baselinePath}));
  const issues = [];
  for (const item of candidates) {
    const content = await readFile(path.join(root, item.file));
    if (item.baselineFile) {
      if (hash(content) !== baselineDigest) issues.push('worktree: monolith baseline is immutable');
      continue;
    }
    const lines = physicalLines(content);
    if (lines !== null && modulePath.test(item.file) && lines > 400) issues.push(`worktree: ${item.file}: new module exceeds 400 lines (${lines})`);
  }
  return issues;
}
async function eventFailures(root, baseline, originalFiles) {
  if (!process.env.GITHUB_EVENT_PATH) return [];
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let base = event.pull_request?.base?.sha || event.before;
  if (!/^[a-f0-9]{40}$/.test(base || '') || /^0+$/.test(base)) {
    base = (await git(root, ['rev-parse', 'HEAD^'])).toString('utf8').trim();
  }
  const commits = (await git(root, ['rev-list', '--reverse', `${base}..HEAD`])).toString('utf8').trim().split('\n').filter(Boolean);
  const issues = [];
  for (const commit of commits) {
    const found = await checkDiff(root, baseline, commit.slice(0, 12), [commit + '^', commit], null, originalFiles, commit + ':');
    issues.push(...found);
  }
  return issues;
}
export async function monolithFailures(root) {
  const content = await readFile(path.join(root, baselinePath));
  if (hash(content) !== baselineDigest) return ['monolith baseline is immutable'];
  const baseline = JSON.parse(content);
  const tree = await git(root, ['ls-tree', '-r', '--name-only', '-z', baseline.base]);
  const originalFiles = new Set(tree.toString('utf8').split('\0').filter(Boolean));
  const [worktree, index, untracked, commits] = await Promise.all([
    checkDiff(root, baseline, 'worktree', ['HEAD'], file => readFile(path.join(root, file)), originalFiles),
    checkDiff(root, baseline, 'index', ['--cached', 'HEAD'], null, originalFiles, ':'),
    untrackedFailures(root), eventFailures(root, baseline, originalFiles),
  ]);
  return [...new Set([...worktree, ...index, ...untracked, ...commits])];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const issues = await monolithFailures(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    if (issues.length) throw new Error(issues.join('\n'));
    process.stdout.write('MONOLITH LOCK PASS\n');
  } catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
