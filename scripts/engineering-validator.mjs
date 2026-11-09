import {execFile} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

function addChangedLine(ranges, line) {
  const changed = Math.max(1, line);
  const previous = ranges.at(-1);
  if (previous && changed >= previous[0] && changed <= previous[1] + 1) {
    previous[1] = Math.max(previous[1], changed);
  } else {
    ranges.push([changed, changed]);
  }
}

function patchData(section) {
  const before = [], ranges = [];
  let line = 1, inside = false;
  for (const row of section.split('\n')) {
    if (row.startsWith('@@ ')) { line = Number(row.match(/\+(\d+)/)[1]); inside = true; continue; }
    if (!inside || row.startsWith('\\')) continue;
    if (row.startsWith(' ') || row.startsWith('-')) before.push(row.slice(1));
    if (row.startsWith('+') || row.startsWith('-')) addChangedLine(ranges, line);
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
  const builderPath='scripts/build-dock-order-domain.mjs', builderFile=path.join(root,builderPath);
  const generated=new Set(existsSync(builderFile) ? generatedOwners(readFileSync(builderFile,'utf8')).keys() : []);
  if (staged.has(builderPath)) {
    const stagedBuilder=await git(root,['show',':' + builderPath]);
    for (const name of generatedOwners(stagedBuilder).keys()) generated.add(name);
  }
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
    const items = present ? [{file, source, before, ranges, version:'worktree'}] : [];
    const staged = stagedDiffs.get(file);
    if (staged && !staged.includes('+++ /dev/null') && (staged !== diffs.get(file) || generated.has(file)
      || historicalGeneratedPath(file) || bunchGeneratedPath(file) || file === 'assets/ops-precision-pilot.js')) {
      const index = await git(root, ['show', ':' + file]);
      if (index !== source || generated.has(file) || historicalGeneratedPath(file) || bunchGeneratedPath(file)
        || file === 'assets/ops-precision-pilot.js') items.push({file, source:index, version:'index', ...patchData(stagedDiffs.get(file))});
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

async function canonicalRecords(root, file, loaded) {
  if (loaded.has(file)) return loaded.get(file);
  const source = readFileSync(path.join(root, file), 'utf8');
  const {ast} = await parseSource(source, file), records = [];
  walk(ast, node => { if (node.type === 'FunctionDeclaration') records.push({name:node.id.name, node}); });
  return records;
}
function matchingPeer(record, shapes) {
  if (record.node.type !== 'FunctionDeclaration' || !/hydrat|evaluat|photo|mark.*done|card.*metric|publish.*row|row.*mutat/i.test(record.name)) return false;
  const body = record.node.body;
  return body?.type === 'BlockStatement' && shapes.has(body.body.map(item => item.type).join(','));
}
async function canonicalFingerprints(root, loaded, candidates) {
  const fingerprints = [], shapes = new Set(candidates.map(record => record.shape));
  for (const file of ['assets/app-runtime.js', 'assets/row-workflow-functions.js']) {
    if (!existsSync(path.join(root, file))) continue;
    for (const record of await canonicalRecords(root, file, loaded)) {
      if (matchingPeer(record, shapes)) fingerprints.push({name:record.name, fingerprint:bodyFingerprint(record.node)});
    }
  }
  return fingerprints;
}

async function versionSource(root, file, version) {
  if (version === 'index') return git(root, ['show', ':' + file]);
  return readFileSync(path.join(root, file), 'utf8');
}
async function fragmentContext(root, items) {
  const contexts = new Map();
  for (const version of new Set(items.map(item => item.version))) {
    const fragments = items.filter(item => item.version === version && item.file.startsWith('assets/') && item.file !== 'assets/app-runtime.js');
    if (!fragments.length || !existsSync(path.join(root, 'assets/app-runtime.js'))) continue;
    let source;
    try { source = await versionSource(root, 'assets/app-runtime.js', version); } catch { continue; }
    const owned = new Set([...source.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g)].map(match => match[1]));
    if (!fragments.some(item => owned.has(item.file))) continue;
    const parsed = await parseSource(source, 'assets/app-runtime.js');
    const references = new Set(parsed.scopeManager.globalScope.through.map(reference => reference.identifier.name));
    contexts.set(version, {source, owned, parsed, references});
  }
  return contexts;
}
function generatedOwners(builder) {
  const transform=String.raw`.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')`;
  if (!builder.includes('../src/${directory}/${name}.js') || !builder.includes('../assets/${name}.js') || !builder.includes(transform)
    || !/for\s*\(const \[directory,\s*name\] of modules\)/.test(builder)) return new Map();
  const list=builder.match(/const modules\s*=\s*\[([^;]+)\];/)?.[1] || '';
  const pair=/\[\s*['"](core|engine|services|ui|views)['"]\s*,\s*['"]([a-z0-9-]+)['"]\s*\]/g;
  if (list.replace(pair,'').replace(/[\s,]/g,'')) return new Map();
  const owners=new Map();
  for (const match of list.matchAll(pair)) {
    const file=`assets/${match[2]}.js`;
    if (owners.has(file)) return new Map();
    owners.set(file,`src/${match[1]}/${match[2]}.js`);
  }
  return owners;
}
async function generatedParity(root, item) {
  if (!/^assets\/[a-z0-9-]+\.js$/.test(item.file)) return null;
  let builder;
  try { builder=await versionSource(root,'scripts/build-dock-order-domain.mjs',item.version); } catch { return null; }
  const owner=generatedOwners(builder).get(item.file);
  if (!owner) return null;
  let source;
  try { source=await versionSource(root,owner,item.version); }
  catch { return `${item.version}: ${item.file}: generated source owner missing`; }
  const expected=source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  return expected === item.source ? '' : `${item.version}: ${item.file}: generated output differs from canonical source`;
}

function historicalGeneratedPath(file) {
  return file === 'assets/historical-requests.js' || file === 'assets/historical-requests.css'
    || /^assets\/historical-requests-chunks\/[a-z0-9-]+\.js$/i.test(file);
}

function bunchGeneratedPath(file) {
  return file === 'assets/bunch-queue.js';
}

export function checkHistoricalGeneratedOutput(item, outputs, root) {
  const expected = outputs.get(path.join(root, item.file));
  if (!expected) return `${item.version}: ${item.file}: historical builder did not produce output`;
  return expected.toString('utf8') === item.source ? '' : `${item.version}: ${item.file}: historical generated output differs from build`;
}

export async function validateHistoricalIndexInputs(root, inputs) {
  const dirty = await git(root, ['diff', '--name-only', '-z', '--', ...inputs]);
  if (dirty.toString('utf8')) throw new Error('historical generated index inputs differ from worktree');
  const indexed = new Set((await git(root, ['ls-files', '-z', '--', ...inputs])).toString('utf8').split('\0').filter(Boolean));
  if (inputs.some(file => !indexed.has(file))) throw new Error('historical generated index source missing');
}

async function historicalBuild(root, version) {
  const builder = 'scripts/build-historical-requests.mjs';
  const { compileHistoricalRequests } = await import(pathToFileURL(path.join(root, builder)).href);
  const result = await compileHistoricalRequests({ root });
  if (version === 'index') {
    await validateHistoricalIndexInputs(root, [builder, ...result.inputs.filter(file => !file.startsWith('node_modules/'))]);
  }
  return result.outputs;
}

async function inspectHistoricalGenerated(root, item, builds) {
  try {
    if (!builds.has(item.version)) builds.set(item.version, historicalBuild(root, item.version));
    return checkHistoricalGeneratedOutput(item, await builds.get(item.version), root);
  } catch (error) {
    return `${item.version}: ${item.file}: historical build verification failed: ${error.message}`;
  }
}

async function inspectOpsGenerated(root, item, builds) {
  try {
    if (!builds.has(item.version)) builds.set(item.version, opsBuild(root, item.version));
    return checkHistoricalGeneratedOutput(item, await builds.get(item.version), root);
  } catch (error) {
    return `${item.version}: ${item.file}: ops build verification failed: ${error.message}`;
  }
}

async function inspectBunchGenerated(root, item, builds) {
  try {
    if (!builds.has(item.version)) builds.set(item.version, bunchBuild(root, item.version));
    return checkHistoricalGeneratedOutput(item, await builds.get(item.version), root);
  } catch (error) {
    return `${item.version}: ${item.file}: bunch build verification failed: ${error.message}`;
  }
}

async function bunchBuild(root, version) {
  const builder = 'scripts/build-bunch-queue.mjs';
  const { compileBunchQueue } = await import(pathToFileURL(path.join(root, builder)).href);
  const result = await compileBunchQueue({ root });
  if (version === 'index') {
    await validateHistoricalIndexInputs(root, [builder, ...result.inputs.filter(file => !file.startsWith('node_modules/'))]);
  }
  return result.outputs;
}

async function opsBuild(root, version) {
  const builder = 'scripts/build-ops-precision-pilot.mjs';
  const { compileOpsPrecisionPilot } = await import(pathToFileURL(path.join(root, builder)).href);
  const result = await compileOpsPrecisionPilot({ root });
  if (version === 'index') {
    await validateHistoricalIndexInputs(root, [builder, ...result.inputs.filter(file => !file.startsWith('node_modules/'))]);
  }
  return result.outputs;
}

export async function engineeringFailures(root, {peers} = {}) {
  if (!existsSync(path.join(root, '.git'))) throw new Error('Engineering lock requires Git history for changed-function enforcement');
  const items = (await workItems(root)).flatMap(inlineScripts), issues = [];
  const inspected = [], loaded = new Map(), contexts = await fragmentContext(root, items);
  const historicalBuilds = new Map(), opsBuilds = new Map(), bunchBuilds = new Map();
  for (const item of items) {
    if (item.file === 'assets/ops-precision-pilot.js') {
      const issue = await inspectOpsGenerated(root, item, opsBuilds);
      if (issue) issues.push(issue);
      continue;
    }
    if (historicalGeneratedPath(item.file)) {
      const issue = await inspectHistoricalGenerated(root, item, historicalBuilds);
      if (issue) issues.push(issue);
      continue;
    }
    if (bunchGeneratedPath(item.file)) {
      const issue = await inspectBunchGenerated(root, item, bunchBuilds);
      if (issue) issues.push(issue);
      continue;
    }
    const parity = await generatedParity(root, item);
    if (parity === '') continue;
    if (parity) issues.push(parity);
    const context = contexts.get(item.version);
    const parsed = item.file === 'assets/app-runtime.js' && context?.source === item.source ? context.parsed : undefined;
    const externalReferences = context?.owned.has(item.file) ? context.references : undefined;
    const result = await inspectEngineeringSource({...item, parsed, externalReferences});
    issues.push(...result.issues.map(issue => item.file + ': ' + issue));
    if (['assets/app-runtime.js', 'assets/row-workflow-functions.js'].includes(item.file)
      && item.source === readFileSync(path.join(root, item.file), 'utf8')) loaded.set(item.file, result.records);
    for (const record of result.records) { record.file = item.file; inspected.push(record); }
  }
  const candidates = inspected.filter(item => item.modified && item.fingerprint
    && /hydrat|evaluat|photo|mark.*done|card.*metric|publish.*row|row.*mutat/i.test(item.name));
  const fingerprints = !candidates.length ? [] : peers === undefined ? await canonicalFingerprints(root, loaded, candidates)
    : await peerFingerprints(typeof peers === 'function' ? await peers() : peers);
  for (const record of candidates) {
    if (fingerprints.some(peer => peer.name !== record.name && peer.fingerprint === record.fingerprint)) {
      issues.push(record.file + ': duplicated cross-view hydration/mutation helper ' + record.name);
    }
  }
  for (const record of inspected.filter(item => item.modified && item.fingerprint)) {
    const clone = inspected.find(other => other.file !== record.file && other.shape === record.shape && other.fingerprint === record.fingerprint);
    if (clone) issues.push(record.file + ': duplicated cross-file helper ' + record.name + ' / ' + clone.name);
  }
  return [...new Set(issues)];
}

