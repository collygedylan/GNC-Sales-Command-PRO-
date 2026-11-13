import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { analyze } from 'eslint-scope';
import globals from 'globals';
import { readComposedRuntimeSource } from './composed-app-source.mjs';
import { parseGitBatch } from './git-batch-blobs.mjs';

const known = new Set(Object.keys({ ...globals.browser, ...globals.builtin, ...globals.es2021 }));
const runtimeFragment = /\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g;

function parseSource(source, sourceType = 'script') {
  return parse(source, { ecmaVersion: 'latest', sourceType, locations: true, ranges: true });
}

function functionDeclarations(ast) {
  const functions = new Map();
  simple(ast, { FunctionDeclaration(node) { if (node.id) functions.set(node.id.name, node); } });
  return functions;
}

function unresolvedReferences(ast) {
  return analyze(ast, { ecmaVersion: 2022, sourceType: ast.sourceType, optimistic: true, ignoreEval: true }).globalScope.through;
}

function readHeadBlobs(root, files) {
  const specs = files.map(file => 'HEAD:' + file);
  const result = execFileSync('git', ['cat-file', '--batch', '-Z'], {
    cwd: root, input: specs.join('\0') + '\0', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  const blobs = parseGitBatch(result, files.length);
  return new Map(files.map((file, index) => [file, blobs[index].toString('utf8')]));
}

function composedHeadRuntime(root, baselineSource) {
  const entry = 'assets/app-runtime.js';
  const baseline = baselineSource ?? readHeadBlobs(root, [entry]).get(entry);
  const fragments = [...new Set(Array.from(baseline.matchAll(runtimeFragment), match => match[1]))];
  if (!fragments.length) return baseline;
  const sources = readHeadBlobs(root, fragments);
  return baseline.replace(runtimeFragment, (_marker, file) => sources.get(file).trimEnd());
}
function referenceOwner(ref, functions) {
  const at=ref.identifier.start;
  return functions.filter(([,node]) => node.start<=at && node.end>=ref.identifier.end)
    .sort((a,b) => (a[1].end-a[1].start)-(b[1].end-b[1].start))[0]?.[0] || '';
}
function referenceKey(ref, source, functions) {
  const start=source.lastIndexOf('\n',ref.identifier.start-1)+1;
  const end=source.indexOf('\n',ref.identifier.end);
  const line=source.slice(start,end<0 ? source.length : end).trim();
  return [referenceOwner(ref,functions),ref.identifier.name,line].join('\0');
}
function unresolvedChanges(source,current,baseline,prior,changed) {
  const names=new Set(changed.map(([name])=>name));
  const earlier=[...prior.functions].filter(([name])=>names.has(name));
  const counts=new Map();
  for (const ref of unresolvedReferences(prior.ast)) {
    const key=referenceKey(ref,baseline,earlier);
    if (key.startsWith('\0')) continue;
    counts.set(key,(counts.get(key)||0)+1);
  }
  const issues=[];
  for (const ref of unresolvedReferences(current.ast)) {
    if (known.has(ref.identifier.name)) continue;
    const key=referenceKey(ref,source,changed);
    if (key.startsWith('\0')) continue;
    const count=counts.get(key)||0;
    if (count) counts.set(key,count-1);
    else issues.push({name:ref.identifier.name,line:ref.identifier.loc.start.line});
  }
  return issues;
}
export function compareRuntimeIdentifiers(source,baseline) {
  return compareRuntimeScopes(source,baseline,parseSource(source)).undeclared;
}

function compareRuntimeScopes(source, baseline, ast) {
  if (source === baseline) return { changedFunctions: 0, undeclared: [] };
  const current = { ast, functions: functionDeclarations(ast) };
  const priorAst = parseSource(baseline);
  const prior = { ast: priorAst, functions: functionDeclarations(priorAst) };
  const changed = [...current.functions].filter(([name,node]) => {
    const old=prior.functions.get(name);
    return !old || source.slice(node.start,node.end) !== baseline.slice(old.start,old.end);
  });
  const undeclared = changed.length ? unresolvedChanges(source,current,baseline,prior,changed) : [];
  return { changedFunctions: changed.length, undeclared };
}

function collectMasterUidReferences(ast, file, output) {
  for (const ref of unresolvedReferences(ast)) {
    if (ref.identifier.name === 'masterUid') output.push({ file, line: ref.identifier.loc.start.line });
  }
}

function auditMasterUid(root, source, runtimeAst) {
  const masterUid = [];
  const files = fs.readdirSync(path.join(root, 'assets')).filter(name => name.endsWith('.js'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, 'assets', file), 'utf8');
    if (!text.includes('masterUid')) continue;
    let ast;
    try { ast = text === source ? runtimeAst : parseSource(text); } catch { // ES module assets retain their import scope.
      ast = parseSource(text, 'module');
    }
    collectMasterUidReferences(ast, file, masterUid);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=|application\/ld\+json/i.test(attrs) || !body.includes('masterUid')) continue;
    collectMasterUidReferences(parseSource(body), 'index.html', masterUid);
  }
  return masterUid;
}

export function auditRuntimeIdentifiers(root = process.cwd(), baselineSource = null) {
  const source = readComposedRuntimeSource({ directory: root });
  const baseline = composedHeadRuntime(root, baselineSource);
  const ast = parseSource(source);
  return { ...compareRuntimeScopes(source, baseline, ast), masterUid: auditMasterUid(root, source, ast) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = auditRuntimeIdentifiers();
  console.log(JSON.stringify(result));
  if (result.undeclared.length || result.masterUid.length) process.exitCode = 1;
}
