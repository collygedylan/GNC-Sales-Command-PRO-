import {execFile} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectEngineeringSource, bodyFingerprint, parseSource, walk} from './engineering-ast-lock.mjs';

const sourceFile = file => /\.(?:[cm]?jsx?|[cm]?tsx?|gs|html)$/.test(file)
  && !/(?:^|\/)(?:node_modules|vendor|_site|artifacts|live-src)\//.test(file);
function git(root, args) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {cwd:root, encoding:'utf8', windowsHide:true, maxBuffer:32*1024*1024},
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.end();
  });
}

async function eventBase(root) {
  const event = process.env.GITHUB_EVENT_PATH && JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event?.pull_request?.base?.sha || event?.before;
  if (base && /^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base)) return base;
  try { return (await git(root, ['rev-parse', 'HEAD^'])).trim(); }
  catch { return (await git(root, ['hash-object', '-t', 'tree', '--stdin'])).trim(); }
}

function patchData(section) {
  const before = [], ranges = [];
  let line = 1, inside = false;
  for (const row of section.split('\n')) {
    if (row.startsWith('@@ ')) { line = Number(row.match(/\+(\d+)/)[1]); inside = true; continue; }
    if (!inside || row.startsWith('\\')) continue;
    if (row.startsWith(' ') || row.startsWith('-')) before.push(row.slice(1));
    if (row.startsWith('+') || row.startsWith('-')) ranges.push([Math.max(1, line), Math.max(1, line)]);
    if (row.startsWith(' ') || row.startsWith('+')) line++;
  }
  return {before:before.join('\n'), ranges};
}

function diffSections(text) {
  const result = new Map();
  for (const section of text.split(/^diff --git /m).slice(1)) {
    const file = section.match(/^a\/.* b\/([^\n]+)\n/)?.[1];
    if (file) result.set(file, section);
  }
  return result;
}

function statusFiles(text) {
  const entries = text.split('\0'), staged = new Set(), untracked = [];
  let partial = false;
  for (let index = 0; index < entries.length; index++) {
    const row = entries[index];
    if (!row) continue;
    const file = row.slice(3);
    if (row.startsWith('??')) untracked.push(file);
    else if (row[0] !== ' ') { staged.add(file); partial ||= row[1] !== ' '; }
    if (/[RC]/.test(row.slice(0, 2))) index++;
  }
  return {staged, untracked, partial};
}

async function workItems(root) {
  const [localText, status] = await Promise.all([
    git(root, ['diff', '--no-ext-diff', '--unified=1000000', 'HEAD', '--']),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ]);
  const {staged, untracked, partial} = statusFiles(status);
  const stagedText = partial ? await git(root, ['diff', '--cached', '--no-ext-diff', '--unified=1000000', 'HEAD', '--']) : localText;
  const base = !process.env.GITHUB_EVENT_PATH && (localText || staged.size || untracked.length) ? 'HEAD' : await eventBase(root);
  const diffs = diffSections(base === 'HEAD' ? localText : await git(root, ['diff', '--no-ext-diff', '--unified=1000000', base, '--']));
  const stagedDiffs = new Map([...diffSections(stagedText)].filter(([file]) => staged.has(file)));
  const files = [...new Set([...diffs.keys(), ...stagedDiffs.keys(), ...untracked])].filter(sourceFile);
  const groups = await Promise.all(files.map(async file => {
    const present = existsSync(path.join(root, file)), diff = diffs.get(file) || '';
    const source = present ? readFileSync(path.join(root, file), 'utf8') : '';
    const {before, ranges} = diff ? patchData(diff) : stagedDiffs.has(file)
      ? {before:patchData(stagedDiffs.get(file)).before, ranges:[]}
      : {before:'', ranges:[[1, source.split('\n').length]]};
    const items = present ? [{file, source, before, ranges}] : [];
    const staged = stagedDiffs.get(file);
    if (staged && !staged.includes('+++ /dev/null') && staged !== diffs.get(file)) {
      const index = await git(root, ['show', ':' + file]);
      if (index !== source) items.push({file, source:index, ...patchData(stagedDiffs.get(file))});
    }
    return items;
  }));
  return groups.flat();
}

function inlineScripts(item) {
  if (!item.file.endsWith('.html')) return [item];
  return [...item.source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => !/\bsrc\s*=|\btype\s*=\s*["'](?:application\/ld\+json|importmap)/i.test(match[1]))
    .map(match => {
      const line = item.source.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length - 1;
      const source = '\n'.repeat(line) + match[2];
      return {...item, source, before:item.before.includes(match[2]) ? source : '', file:item.file + '.js'};
    });
}

async function peerFingerprints(peers) {
  const result = [];
  for (const [name, source] of peers) {
    if (!/hydrat|evaluat|photo|mark.*done|card.*metric|publish.*row|row.*mutat/i.test(name)) continue;
    const {ast} = await parseSource(source, 'peer.js');
    walk(ast, node => { if (node.type === 'FunctionDeclaration') result.push({name, fingerprint:bodyFingerprint(node)}); });
  }
  return result;
}

async function canonicalPeers(root) {
  const peers = [];
  for (const file of ['assets/app-runtime.js', 'assets/row-workflow-functions.js']) {
    if (!existsSync(path.join(root, file))) continue;
    const source = readFileSync(path.join(root, file), 'utf8');
    const {ast} = await parseSource(source, file);
    walk(ast, node => {
      if (node.type === 'FunctionDeclaration') peers.push([node.id.name, source.slice(node.start, node.end)]);
    });
  }
  return peers;
}

export async function engineeringFailures(root, {peers = () => canonicalPeers(root)} = {}) {
  if (!existsSync(path.join(root, '.git'))) throw new Error('Engineering lock requires Git history for changed-function enforcement');
  const items = (await workItems(root)).flatMap(inlineScripts), issues = [];
  const inspected = [];
  for (const item of items) {
    const result = await inspectEngineeringSource(item);
    issues.push(...result.issues.map(issue => item.file + ': ' + issue));
    inspected.push(...result.records.map(record => ({...record, file:item.file})));
  }
  const candidates = inspected.filter(item => item.modified && item.fingerprint
    && /hydrat|evaluat|photo|mark.*done|card.*metric|publish.*row|row.*mutat/i.test(item.name));
  const fingerprints = candidates.length ? await peerFingerprints(typeof peers === 'function' ? await peers() : peers) : [];
  for (const record of candidates) {
    if (fingerprints.some(peer => peer.name !== record.name && peer.fingerprint === record.fingerprint)) {
      issues.push(record.file + ': duplicated cross-view hydration/mutation helper ' + record.name);
    }
  }
  for (const record of inspected.filter(item => item.modified && item.fingerprint)) {
    const clone = inspected.find(other => other.file !== record.file && other.fingerprint === record.fingerprint);
    if (clone) issues.push(record.file + ': duplicated cross-file helper ' + record.name + ' / ' + clone.name);
  }
  return [...new Set(issues)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const issues = await engineeringFailures(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    if (issues.length) throw new Error(issues.join('\n'));
    process.stdout.write('ENGINEERING LOCK PASS: changed functions, canonical helpers, cost patterns and dead code.\n');
  } catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
