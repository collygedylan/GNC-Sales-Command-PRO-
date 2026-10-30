import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { analyze } from 'eslint-scope';
import globals from 'globals';
import { readComposedRuntimeSource } from './composed-app-source.mjs';

const known = new Set(Object.keys({ ...globals.browser, ...globals.builtin, ...globals.es2021 }));
function inspect(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true, ranges: true });
  const functions = new Map();
  simple(ast, { FunctionDeclaration(node) { if (node.id) functions.set(node.id.name, node); } });
  return { ast, functions, scope: analyze(ast, { ecmaVersion: 2022, sourceType: 'script', optimistic: true, ignoreEval: true }) };
}
export function auditRuntimeIdentifiers(root = process.cwd(), baselineSource = null) {
  const source = readComposedRuntimeSource({ directory: root });
  const baseline = baselineSource ?? execFileSync('git', ['show', 'HEAD:assets/app-runtime.js'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const composedBaseline = baseline.replace(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g, (_marker, file) => execFileSync('git', ['show', 'HEAD:' + file], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }).trimEnd());
  const current = inspect(source), prior = inspect(composedBaseline);
  const changed = [...current.functions].filter(([name, node]) => {
    const old = prior.functions.get(name);
    return !old || source.slice(node.start, node.end) !== composedBaseline.slice(old.start, old.end);
  });
  const undeclared = current.scope.globalScope.through.filter(ref => !known.has(ref.identifier.name)
    && changed.some(([, node]) => ref.identifier.start >= node.start && ref.identifier.end <= node.end))
    .map(ref => ({ name: ref.identifier.name, line: ref.identifier.loc.start.line }));
  const masterUid = [];
  const files = fs.readdirSync(path.join(root, 'assets')).filter(name => name.endsWith('.js'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, 'assets', file), 'utf8');
    if (!text.includes('masterUid')) continue;
    let parsed;
    try { parsed = inspect(text); } catch { // ES module assets retain their import scope.
      const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true });
      parsed = { scope: analyze(ast, { ecmaVersion: 2022, sourceType: 'module', optimistic: true, ignoreEval: true }) };
    }
    for (const ref of parsed.scope.globalScope.through) if (ref.identifier.name === 'masterUid') masterUid.push({ file, line: ref.identifier.loc.start.line });
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=|application\/ld\+json/i.test(attrs) || !body.includes('masterUid')) continue;
    for (const ref of inspect(body).scope.globalScope.through) if (ref.identifier.name === 'masterUid') masterUid.push({ file: 'index.html', line: ref.identifier.loc.start.line });
  }
  return { changedFunctions: changed.length, undeclared, masterUid };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = auditRuntimeIdentifiers();
  console.log(JSON.stringify(result));
  if (result.undeclared.length || result.masterUid.length) process.exitCode = 1;
}
