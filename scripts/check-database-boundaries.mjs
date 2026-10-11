import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { repoRoot } from './tooling-process.mjs';

const frontendAdapters = new Set([
  'services/liveDatabase.ts', 'services/databaseRest.ts', 'services/commandCenterDatabase.ts',
  'v2/src/services/api.ts', 'v2/src/components/CompanyDirectory.tsx',
]);
const ignored = /(?:^|\/)(?:node_modules|vendor|dist|storybook-static|\.gnc-local|legacy_fallback)(?:\/|$)|(?:\.test\.[cm]?[jt]sx?|_test\.ts|\.typecheck\.ts|\.generated\.ts|database\.types\.ts|\.min\.[cm]?js)$/;
// These checked-in bundles are built from authored source covered below.
const generated = new Set(['assets/alpha-command-center.js', 'assets/assigned-items-table.js',
  'assets/production-schedule.js', 'assets/sentry-browser.js']);

export function inspectDatabaseBoundary(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const errors = [];
  const report = (node, message) => errors.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${message}`);
  const approved = frontendAdapters.has(file) || file.startsWith('supabase/functions/');
  const restUrlVariables = new Set();
  const restUrlAliases = [];
  const transportVariables = new Set();
  const transportAliases = [];
  function containsRestUrlExpression(node) {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) && /\/rest\/v1\//.test(node.getText(tree))) return true;
    if (ts.isObjectLiteralExpression(node)) return node.properties.some(property =>
      ts.isPropertyAssignment(property) && containsRestUrlExpression(property.initializer));
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(containsRestUrlExpression);
    return false;
  }
  function collectRestUrlVariables(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = node.initializer;
      if ((ts.isStringLiteralLike(initializer) || ts.isTemplateExpression(initializer))
        && /\/rest\/v1\//.test(initializer.getText(tree))) restUrlVariables.add(node.name.text);
      else if (ts.isIdentifier(initializer)) {
        restUrlAliases.push([node.name.text, initializer.text]);
        if (/^(?:fetch|fetchWithTimeout)$/.test(initializer.text)) transportVariables.add(node.name.text);
        else transportAliases.push([node.name.text, initializer.text]);
      }
      if ((ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        && /\b(?:fetch|fetchWithTimeout)\s*\(/.test(initializer.getText(tree))) transportVariables.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body
      && /\b(?:fetch|fetchWithTimeout)\s*\(/.test(node.body.getText(tree))) transportVariables.add(node.name.text.text);
    ts.forEachChild(node, collectRestUrlVariables);
  }
  collectRestUrlVariables(tree);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [alias, target] of restUrlAliases) {
      if (!restUrlVariables.has(alias) && restUrlVariables.has(target)) {
        restUrlVariables.add(alias);
        changed = true;
      }
    }
    for (const [alias, target] of transportAliases) {
      if (!transportVariables.has(alias) && transportVariables.has(target)) {
        transportVariables.add(alias);
        changed = true;
      }
    }
  }
  const createAliases = new Set(['createClient']);
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text.includes('supabase')) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName || item.name).text === 'createClient') createAliases.add(item.name.text);
      }
    }
  }
  function visit(node) {
    if ((ts.isParameter(node) || ts.isPropertySignature(node) || ts.isVariableDeclaration(node))
      && node.type?.kind === ts.SyntaxKind.AnyKeyword
      && /^(?:supabase|client|adminClient|userClient)$/i.test(node.name?.getText(tree) || '')) {
      report(node, 'Database client dependencies must use their generated schema, never any.');
    }
    if (ts.isPropertySignature(node) && /^(?:rpc|from)$/.test(node.name.getText(tree))
      && node.type && ts.isFunctionTypeNode(node.type)
      && node.type.parameters[0]?.type?.kind === ts.SyntaxKind.StringKeyword) {
      report(node, 'Database operation names must be fixed literals or generated schema keys.');
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const create = ts.isIdentifier(callee) ? createAliases.has(callee.text) : method === 'createClient';
      if (create && (!node.typeArguments?.length || node.typeArguments.some(type => type.kind === ts.SyntaxKind.AnyKeyword))) {
        // The legacy shell calls the typed factory exported by the compiled bundle.
        if (file !== 'index.html') report(node, 'Supabase clients must declare the generated Database type.');
      }
      if (method === 'rpc' || method === 'from') {
        const owner = ts.isPropertyAccessExpression(callee) ? callee.expression.getText(tree) : '';
        const nativeFrom = method === 'from' && /^(?:Array|Buffer|Uint\d+Array|Int\d+Array|Float\d+Array)$/.test(owner);
        const storage = /(?:^|\.)storage$/.test(owner) || owner === 'getSupabaseStorageClient()';
        if (!nativeFrom && !storage && !approved) report(node, 'Move database calls into an approved compiled TypeScript adapter.');
      }
      const directRestUrl = node.arguments.some(containsRestUrlExpression);
      const calleeName = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const isTransport = /^(?:fetch|fetchWithTimeout)$/.test(calleeName) || transportVariables.has(calleeName);
      const rawRestUrl = isTransport && (directRestUrl || node.arguments.some(arg =>
        ts.isIdentifier(arg) && restUrlVariables.has(arg.text)));
      if (rawRestUrl && file !== 'services/databaseRest.ts') {
        report(node, 'Direct database REST transport must use the validated typed bridge.');
      }
    }
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(tree) === 'SupabaseClient'
      && (!node.typeArguments?.length || node.typeArguments.some(type => type.kind === ts.SyntaxKind.AnyKeyword))) {
      report(node, 'SupabaseClient must retain its generated Database parameter.');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return errors;
}

export function checkDatabaseBoundaries({ root = repoRoot } = {}) {
  const errors = [];
  function walk(directory) {
    for (const item of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${item.name}`;
      if (ignored.test(file) || generated.has(file)) continue;
      if (item.isDirectory()) walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(file)) errors.push(...inspectDatabaseBoundary(file, readFileSync(path.join(root, file), 'utf8')));
    }
  }
  for (const directory of ['services', 'components', 'assets', 'v2/src', 'supabase/functions']) walk(directory);
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(match[1])) errors.push(...inspectDatabaseBoundary('index.html', match[2]));
  }
  if (errors.length) throw new Error(`Database boundary violations:\n${errors.join('\n')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { checkDatabaseBoundaries(); console.log('Database boundaries retain generated types and approved adapters.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
