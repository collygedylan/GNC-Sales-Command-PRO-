import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.argv[2] || '.gnc-local/it-after.json');
const rel = file => path.relative(root, file).replaceAll('\\', '/');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const allFiles = ['index.html', ...walk(path.join(root, 'assets')).filter(file => /\.(?:js|css)$/i.test(file.slice(file.lastIndexOf('.')))
  && !file.includes(`${path.sep}vendor${path.sep}`)), ...walk(path.join(root, 'supabase', 'functions')).filter(file => /\.(?:js|mjs|ts|tsx)$/i.test(file)),
  ...walk(path.join(root, 'tests')).filter(file => /\.(?:js|mjs|ts|tsx|html)$/i.test(file))];
const uniqueFiles = [...new Set(allFiles.map(file => path.isAbsolute(file) ? file : path.join(root, file)))];
const sourceText = new Map(uniqueFiles.map(file => [rel(file), readFileSync(file, 'utf8')]));
const html = sourceText.get('index.html') || '';
const linked = new Set(['index.html', 'assets/app-runtime.js']);
for (const [, url] of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
  const clean = url.split(/[?#]/, 1)[0].replace(/^\.\//, '');
  if (/^assets\/[^/]+\.(?:js|css)$/i.test(clean)) linked.add(clean);
}
const assetFiles = uniqueFiles.filter(file => rel(file).startsWith('assets/') && /\.(?:js|css)$/i.test(file));
const measuredFiles = [...new Set([...linked, ...assetFiles.map(rel)])].filter(name => sourceText.has(name));
const files = measuredFiles.map(name => {
  const text = sourceText.get(name);
  return { path: name, bytes: Buffer.byteLength(text), lines: text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0), linked: linked.has(name) };
});

const declarations = [];
const calls = new Map();
const listenerSites = new Map();
const catches = [];
const parseErrors = [];
let datasetCalls = 0;
const primarySources = ['index.html', 'assets/app-runtime.js', ...assetFiles.filter(file => /\.js$/i.test(file)).map(rel)];
function inspectSource(name, text, primary) {
  if (/\.css$/i.test(name)) return;
  const chunks = /\.html?$/i.test(name) ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => ({ text: m[1], offset: m.index })) : [{ text, offset: 0 }];
  for (const chunk of chunks) {
    if (!chunk.text.trim()) continue;
    const file = ts.createSourceFile(name, chunk.text, ts.ScriptTarget.Latest, true, /\.tsx?$/i.test(name) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    for (const diagnostic of file.parseDiagnostics || []) parseErrors.push({ file: name, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
    const visit = node => {
      if (primary) {
        let fnName = '';
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) fnName = node.name?.getText(file) || '';
        else if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) fnName = node.name.getText(file);
        if (fnName) {
          const body = node.body?.getText(file) || node.initializer?.getText(file) || '';
          declarations.push({ name: fnName.replace(/^['"`]|['"`]$/g, ''), file: name, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            bodyHash: createHash('sha256').update(body.replace(/\s+/g, ' ')).digest('hex') });
        }
        if (ts.isCatchClause(node)) {
          const body = node.block.getText(file);
          const errorName = node.variableDeclaration?.name.getText(file) || '';
          const errorConsumed = !!errorName && new RegExp(`\\b${errorName.replace(/[$]/g, '\\$')}\\b`).test(body.slice(body.indexOf('=>') + 2));
          const telemetry = /reportHandledRuntimeIssue|console\.|\.log\(|showToast|track[A-Z]|telemetry/i.test(body);
          if (node.block.statements.length === 0 || (!telemetry && !errorConsumed)) catches.push({ file: name, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, empty: node.block.statements.length === 0, errorConsumed, telemetry });
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addEventListener') {
          const receiver = node.expression.expression.getText(file).replace(/\s+/g, ' ');
          const event = node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : '*dynamic*';
          const key = `${receiver} :: ${event}`;
          const rows = listenerSites.get(key) || [];
          rows.push({ file: name, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
          listenerSites.set(key, rows);
        }
      }
      if (ts.isCallExpression(node)) {
        const callName = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
        if (callName) calls.set(callName, (calls.get(callName) || 0) + 1);
        if (/(?:fetch|load|read|hydrate|refresh|get)/i.test(callName) && /(?:inventory|soc|suspend|reserve|warehouse|order|dataset|revision)/i.test(callName)) datasetCalls++;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
}
for (const [name, text] of sourceText) inspectSource(name, text, primarySources.includes(name));

const occurrences = new Map();
for (const [name, text] of sourceText) for (const match of text.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) occurrences.set(match[0], (occurrences.get(match[0]) || 0) + 1);
const byName = new Map();
for (const item of declarations) { const rows = byName.get(item.name) || []; rows.push(item); byName.set(item.name, rows); }
const duplicateNames = [...byName].filter(([, rows]) => rows.length > 1).map(([name, rows]) => ({ name, count: rows.length, files: [...new Set(rows.map(row => row.file))] }));
const duplicateBodies = [...new Map(declarations.map(item => [item.bodyHash, item])).keys()].filter(hash => declarations.filter(item => item.bodyHash === hash).length > 1)
  .map(hash => ({ hash, names: declarations.filter(item => item.bodyHash === hash).map(item => `${item.file}:${item.name}`) }));
const unreferencedCandidates = declarations.filter(item => (calls.get(item.name) || 0) === 0 && (occurrences.get(item.name) || 0) <= 1)
  .map(({ name, file, line }) => ({ name, file, line, reviewRequired: true }));
const mutableTopLevel = [];
for (const file of ['assets/app-runtime.js', ...assetFiles.map(rel)]) {
  const text = sourceText.get(file); if (!text) continue;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const stmt of ast.statements) if (ts.isVariableStatement(stmt) && (stmt.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0 && (stmt.declarationList.flags & ts.NodeFlags.Const) === 0) {
    for (const decl of stmt.declarationList.declarations) mutableTopLevel.push({ file, name: decl.name.getText(ast), line: ast.getLineAndCharacterOfPosition(decl.getStart(ast)).line + 1 });
  }
}
const corpus = [...sourceText.values()].join('\n');
const globalAssignments = [...corpus.matchAll(/\bwindow(?:\?\.)?\.([A-Za-z_$][\w$]*)\s*=/g)].map(match => match[1]);
const repeatedListeners = [...listenerSites].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, count: rows.length, rows }));
const renderCalls = [...corpus.matchAll(/\b(?:render[A-Z]\w*|updateGlobalHeaderChrome|updateGlobalBackButton)\s*\(/g)].length;
const baseline = {
  generatedAt: new Date().toISOString(),
  note: 'Static AST and lexical baseline. Zero-reference items are review candidates; dynamic dispatch and HTML handlers require human verification before removal.',
  totals: { measuredFiles: files.length, linkedAssets: linked.size - 1, functionDeclarations: declarations.length,
    duplicateFunctionNames: duplicateNames.length, duplicateFunctionBodies: duplicateBodies.length, unreferencedCandidates: unreferencedCandidates.length,
    windowAssignments: globalAssignments.length, mutableTopLevelBindings: mutableTopLevel.length, silentCatchCandidates: catches.length,
    emptyCatchBlocks: catches.filter(item => item.empty).length, duplicateListenerKeys: repeatedListeners.length, datasetFetchLikeCallSites: datasetCalls,
    synchronousRenderLikeCallSites: renderCalls, parseDiagnostics: parseErrors.length },
  files, declarations, duplicateNames, duplicateBodies, unreferencedCandidates, windowAssignments: globalAssignments,
  mutableTopLevel, silentCatchCandidates: catches, repeatedListeners, parseErrors,
};
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Files: ${files.length} measured; ${linked.size - 1} linked JS/CSS assets`);
console.log(`Functions: ${declarations.length}; duplicate names ${duplicateNames.length}; duplicate bodies ${duplicateBodies.length}`);
console.log(`Globals: ${globalAssignments.length} window assignments; ${mutableTopLevel.length} top-level mutable bindings`);
console.log(`Review candidates: ${unreferencedCandidates.length} zero-call names; ${catches.length} silent catch candidates`);
console.log(`Other: ${repeatedListeners.length} repeated listener keys; ${datasetCalls} dataset-like calls; ${renderCalls} render-like calls; parse diagnostics ${parseErrors.length}`);
