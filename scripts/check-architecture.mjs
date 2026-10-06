import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.gs', '.html']);
const GENERATED = /(^|\/)(?:node_modules|vendor|dist|build|_site|coverage|\.git|\.codex|\.gnc-local)(\/|$)|(?:\.min\.|\.generated\.|-bundle\.)/i;
const INERT_SCRIPT_TYPES = new Set(['application/json', 'application/ld+json', 'text/template', 'text/x-template']);

function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function normalizedPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function isGenerated(file) {
  const normalized = normalizedPath(file);
  return GENERATED.test(normalized) || normalized === 'assets/bunch-note-structured.js';
}

function isBrowserRuntimeFile(file) {
  const normalized = normalizedPath(file).split('#')[0];
  return normalized === 'index.html' || /^(?:assets|components|live-src|services|utils|v2\/src)\//i.test(normalized)
    || /^scripts\/staging\//i.test(normalized) || ['sw.js', 'OneSignalSDKWorker.js'].includes(normalized);
}

function isClassicBrowserScript(unit) {
  const file = normalizedPath(unit.file).split('#')[0];
  return !unit.module && (unit.file.startsWith('index.html#') || /^assets\//i.test(file)
    || ['sw.js', 'OneSignalSDKWorker.js'].includes(file));
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r\n|\n|\r/).length - (/(\r\n|\n|\r)$/.test(text) ? 1 : 0);
}

function fingerprint(rule, text) {
  return `${rule}:${String(text).replace(/\s+/g, ' ').trim()}`;
}

function location(source, position) {
  return source.getLineAndCharacterOfPosition(Math.max(0, position));
}

function parseWithTypeScript(text, file, scriptKind) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  const errors = source.parseDiagnostics.map(diagnostic => {
    const pos = location(source, diagnostic.start || 0);
    return { rule: 'parse-error', line: pos.line + 1, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') };
  });
  return { source, errors };
}

function activeInlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  let ordinal = 0;
  while ((match = pattern.exec(html))) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    ordinal += 1;
    const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || '').trim().toLowerCase();
    const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type === 'application/json' || type === 'application/ld+json') {
      scripts.push({ file: `index.html#data-${ordinal}`, text: body, kind: 'json', sourceOffset: match.index + match[0].indexOf(body) });
      continue;
    }
    if (!body.trim()) continue;
    const mainAppSource = id === 'app-script-source' && type === 'text/plain';
    if (mainAppSource) {
      scripts.push({
        file: 'index.html#inline-app-script-source',
        text: body,
        sourceOffset: match.index + match[0].indexOf(body),
        sourceText: html,
        module: false,
      });
      continue;
    }
    if (INERT_SCRIPT_TYPES.has(type) || type && !/^(?:module|text\/(?:java|ecma)script|application\/(?:java|ecma)script)$/.test(type)) {
      scripts.push({ file: `index.html#inert-${ordinal}`, text: body, kind: 'inert' });
      continue;
    }
    scripts.push({
      file: `index.html#inline-${id || ordinal}`,
      text: body,
      sourceOffset: match.index + match[0].indexOf(body),
      sourceText: html,
      module: type === 'module',
    });
  }
  return scripts;
}

function collectSourceUnits(file, text) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return activeInlineScripts(text);
  const module = ext !== '.gs' && (ext !== '.js' || !/^assets\//i.test(file) || /\b(?:import|export)\s/.test(text));
  return [{ file, text, module }];
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function staticPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return '';
}

function sharedGlobalWrite(node, shadows = new Set()) {
  if (!node || !(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return null;
  if (!ts.isIdentifier(node.expression) || !['window', 'globalThis', 'self'].includes(node.expression.text)) return null;
  if (shadows.has(node.expression.text)) return null;
  return { root: node.expression.text, property: staticPropertyName(node) };
}

function localGlobalShadows(source) {
  const shadows = new Set();
  function visit(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)
      || ts.isClassDeclaration(node) || ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      for (const identifier of node.name ? bindingIdentifiers(node.name) : []) {
        if (['window', 'globalThis', 'self'].includes(identifier.text)) shadows.add(identifier.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return shadows;
}

function isTopLevelClassicDeclaration(node, source, moduleScope) {
  if (moduleScope) return false;
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.parent === source) return true;
  if (ts.isVariableDeclaration(node)) {
    let list = node.parent;
    while (list && !ts.isVariableDeclarationList(list)) list = list.parent;
    if (!list) return false;
    const statement = list.parent;
    if (ts.isVariableStatement(statement) && statement.parent === source) return true;
    if (list.flags & ts.NodeFlags.BlockScoped) return false;
    let current = statement;
    while (current && !ts.isSourceFile(current)) {
      if (ts.isFunctionLike(current)) return false;
      current = current.parent;
    }
    return ts.isSourceFile(current);
  }
  return false;
}

function bindingIdentifiers(name, result = []) {
  if (ts.isIdentifier(name)) result.push(name);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) if (ts.isBindingElement(element)) bindingIdentifiers(element.name, result);
  }
  return result;
}

function declarationIsExported(node) {
  let declaration = node;
  if (ts.isVariableDeclaration(node)) {
    while (declaration && !ts.isVariableStatement(declaration)) declaration = declaration.parent;
  }
  return Boolean(declaration && ts.canHaveModifiers(declaration)
    && ts.getModifiers(declaration)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword));
}

function isPropertyName(identifier) {
  const parent = identifier.parent;
  if (!parent) return false;
  if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && parent.name === identifier) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)
    || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isEnumMember(parent))
    && parent.name === identifier && !ts.isComputedPropertyName(parent.name)) return true;
  if ((ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === identifier) return true;
  if (ts.isJsxAttribute(parent) && parent.name === identifier) return true;
  if (ts.isImportSpecifier(parent) && (parent.name === identifier || parent.propertyName === identifier)) return true;
  if (ts.isExportSpecifier(parent) && parent.name === identifier) return true;
  return false;
}

function collectUnusedCandidates(source, unit, add, moduleScope) {
  const declarations = [];
  const declaredPositions = new Set();
  function register(name, owner, kind) {
    for (const id of bindingIdentifiers(name)) {
      declaredPositions.add(`${id.pos}:${id.end}`);
      declarations.push({ id, owner, kind });
    }
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node)) register(node.name, node, 'variable');
    else if (ts.isFunctionDeclaration(node) && node.name) register(node.name, node, 'function');
    else if (ts.isClassDeclaration(node) && node.name) register(node.name, node, 'class');
    else if (ts.isImportClause(node) && node.name) register(node.name, node, 'import');
    else if (ts.isImportSpecifier(node)) register(node.name, node, 'import');
    else if (ts.isNamespaceImport(node)) register(node.name, node, 'import');
    ts.forEachChild(node, visit);
  }
  visit(source);
  const references = new Map();
  function visitReferences(node) {
    if (ts.isIdentifier(node) && !declaredPositions.has(`${node.pos}:${node.end}`) && !isPropertyName(node)) {
      references.set(node.text, (references.get(node.text) || 0) + 1);
    }
    ts.forEachChild(node, visitReferences);
  }
  visitReferences(source);

  for (const declaration of declarations) {
    const { id, owner, kind } = declaration;
    if (kind === 'function' || kind === 'class') {
      if (declarationIsExported(owner)) continue;
      if (isTopLevelClassicDeclaration(owner, source, moduleScope)) continue;
    }
    if (kind === 'variable') {
      if (isTopLevelClassicDeclaration(owner, source, moduleScope)) continue;
      if (owner.parent && ts.isVariableDeclarationList(owner.parent)
        && (owner.parent.flags & ts.NodeFlags.Const) && declarationIsExported(owner.parent.parent)) continue;
    }
    if (kind === 'import' && declarationIsExported(owner)) continue;
    if ((references.get(id.text) || 0) === 0) {
      const syntax = id.parent.getText(source);
      add('unused-candidate', id.getStart(source), `${kind} ${id.text} has no same-file identifier reference`, syntax);
    }
  }
  return references;
}

const STATE_HINT = /(?:que|bunch|suspend|state|cache|data|store|current|pending|active|selected|loaded|visible|session|auth|sync|queue|request|view|modal|filter|search|draft|loading|saving|error|result|user|profile|inventory|order|photo|selection)/i;
const SYMBOL_DOMAINS = [
  ['que-bunch-suspend', /que|bunch.?note|suspend.?tag|ph.?soc.?master/i],
  ['requests-and-orders', /request|order|customer|consignee|fulfill/i],
  ['inventory-and-drive', /inventory|drive|stock|lot|item|photo|location/i],
  ['auth-and-sessions', /auth|session|profile|user|role|permission/i],
  ['networking-and-api', /supabase|api|fetch|http|network|connection|endpoint/i],
  ['sync-and-persistence', /sync|realtime|cache|storage|offline|persist|queue/i],
  ['delivery-and-notifications', /email|mail|push|notify|notification|delivery/i],
  ['ui-and-navigation', /render|view|screen|modal|route|navigation|tab|menu|button|mount|component/i],
  ['production-operations', /production|shipping|plant|house|bunch|harvest|schedule/i],
];

function domainForSymbol(name) {
  return SYMBOL_DOMAINS.find(([, pattern]) => pattern.test(name))?.[0] || 'general-or-unclassified';
}

function namedFunction(node, source) {
  if (node.name) return node.name.getText(source);
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return '';
  const owner = node.parent;
  if (ts.isVariableDeclaration(owner) && owner.initializer === node) return owner.name.getText(source);
  if (ts.isPropertyAssignment(owner) && owner.initializer === node) return owner.name.getText(source);
  if (ts.isBinaryExpression(owner) && owner.right === node && isAssignmentOperator(owner.operatorToken.kind)) return owner.left.getText(source);
  return '';
}

export function analyzeSourceText(text, file = 'input.js') {
  const findings = [];
  const symbols = { functions: [], stateBindings: [], globals: [] };
  const metrics = { functions: 0, topLevelNames: 0, astNodes: 0, inlineScripts: 0, inertScripts: 0, inertDataScripts: 0, inertScriptBytes: 0 };
  const units = collectSourceUnits(file, text);
  metrics.inlineScripts = path.extname(file).toLowerCase() === '.html' ? units.filter(unit => !unit.kind).length : 0;
  metrics.inertScripts = units.filter(unit => Boolean(unit.kind)).length;
  metrics.inertScriptBytes = units.filter(unit => Boolean(unit.kind)).reduce((sum, unit) => sum + Buffer.byteLength(unit.text), 0);
  for (const unit of units) {
    if (unit.kind === 'inert') continue;
    if (unit.kind === 'json') {
      metrics.inertDataScripts += 1;
      try { JSON.parse(unit.text); }
      catch (error) {
        const line = (unit.text.slice(0, error.position || 0).match(/\n/g) || []).length + 1;
        findings.push({ file: unit.file, rule: 'parse-error', line, message: `inert JSON script did not parse: ${error.message}`, fingerprint: fingerprint('parse-error', unit.text) });
      }
      continue;
    }
    const kind = unit.file.endsWith('.tsx') ? ts.ScriptKind.TSX : unit.file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
    const { source, errors } = parseWithTypeScript(unit.text, unit.file, kind);
    const moduleScope = unit.module || Boolean(source.externalModuleIndicator);
    const shadows = localGlobalShadows(source);
    const inlineLineOffset = unit.sourceText && unit.sourceOffset !== undefined
      ? (unit.sourceText.slice(0, unit.sourceOffset).match(/\n/g) || []).length
      : 0;
    const sourceLocation = offset => {
      const pos = location(source, offset);
      return { line: pos.line + 1 + inlineLineOffset, column: pos.character + 1 };
    };
    const unitGlobalStart = symbols.globals.length;
    const add = (rule, offset, message, syntax = '') => {
      findings.push({
        file: unit.file,
        rule,
        ...sourceLocation(offset),
        message,
        fingerprint: fingerprint(rule, syntax || message),
      });
    };
    for (const error of errors) add(error.rule, source.getPositionOfLineAndCharacter(error.line - 1, 0), error.message, error.message);
    if (errors.length) continue;

    function visit(node) {
      metrics.astNodes += 1;
      if (ts.isFunctionLike(node) && node.body) {
        metrics.functions += 1;
        const name = namedFunction(node, source);
        if (name) {
          const start = node.getStart(source);
          const end = node.end;
          symbols.functions.push({
            name,
            domain: domainForSymbol(name),
            file: unit.file,
            ...sourceLocation(start),
            spanLines: sourceLocation(end).line - sourceLocation(start).line + 1,
            spanBytes: end - start,
          });
        }
      }
      if ((ts.isFunctionDeclaration(node) && isTopLevelClassicDeclaration(node, source, moduleScope))
        || (isClassicBrowserScript(unit) && ts.isVariableStatement(node) && node.parent === source)) metrics.topLevelNames += 1;

      if (ts.isVariableDeclaration(node)) {
        for (const identifier of bindingIdentifiers(node.name)) {
          if (STATE_HINT.test(identifier.text)) symbols.stateBindings.push({ name: identifier.text, domain: domainForSymbol(identifier.text), file: unit.file, ...sourceLocation(identifier.getStart(source)) });
          if (isClassicBrowserScript(unit) && isTopLevelClassicDeclaration(node, source, moduleScope)) {
            symbols.globals.push({ name: identifier.text, file: unit.file, ...sourceLocation(identifier.getStart(source)) });
          }
        }
      }

      if (ts.isCatchClause(node) && node.block.statements.length === 0) {
        add('empty-catch', node.getStart(source), 'catch block has no executable handling', node.getText(source));
      }
      if (ts.isBlock(node) || ts.isSourceFile(node)) {
        let stopped = false;
        for (const statement of node.statements) {
          if (stopped) add('unreachable', statement.getStart(source), 'statement follows an unconditional control transfer', statement.getText(source));
          if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)
            || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) stopped = true;
        }
      }
      if (isBrowserRuntimeFile(unit.file) && ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
        const target = sharedGlobalWrite(node.left, shadows);
        const nativeWindowProperty = target?.root === 'window' && (target.property === 'location' || target.property === 'name' || target.property === 'status' || target.property.startsWith('on'));
        if (target && !nativeWindowProperty) add('global-write', node.getStart(source), `assignment writes through shared browser global ${target.root}`, node.getText(source));
      }
      if (isBrowserRuntimeFile(unit.file) && (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
        const operand = ts.isPrefixUnaryExpression(node) ? node.operand : node.operand;
        const target = sharedGlobalWrite(operand, shadows);
        if (target) add('global-write', node.getStart(source), `update writes through shared browser global ${target.root}`, node.getText(source));
      }
      if (isBrowserRuntimeFile(unit.file) && ts.isDeleteExpression(node)) {
        const target = sharedGlobalWrite(node.expression, shadows);
        if (target) add('global-write', node.getStart(source), `delete changes shared browser global ${target.root}`, node.getText(source));
      }
      if (isBrowserRuntimeFile(unit.file) && ts.isCallExpression(node) && node.arguments.length > 0 && ts.isPropertyAccessExpression(node.expression)
        && ['assign', 'defineProperty', 'set'].includes(node.expression.name.text)
        && (node.expression.expression.getText(source) === 'Object' || node.expression.expression.getText(source) === 'Reflect')) {
        const target = node.arguments[0];
        const root = ts.isIdentifier(target) && ['window', 'globalThis', 'self'].includes(target.text) ? target.text : '';
        if (root) add('global-write', node.getStart(source), `mutation helper writes through shared browser global ${root}`, node.getText(source));
      }
      if (isClassicBrowserScript(unit) && (ts.isFunctionDeclaration(node) && isTopLevelClassicDeclaration(node, source, moduleScope)
        || ts.isClassDeclaration(node) && isTopLevelClassicDeclaration(node, source, moduleScope))) {
        if (node.name) {
          add('global-declaration', node.getStart(source), `top-level ${ts.isFunctionDeclaration(node) ? 'function' : 'class'} ${node.name.text} in classic script`, node.getText(source));
          symbols.globals.push({ name: node.name.text, file: unit.file, ...sourceLocation(node.name.getStart(source)) });
        }
      }
      if (isClassicBrowserScript(unit) && ts.isVariableStatement(node) && node.parent === source) {
        for (const declaration of node.declarationList.declarations) {
          for (const name of bindingIdentifiers(declaration.name)) {
            add('global-declaration', name.getStart(source), `top-level binding ${name.text} in classic script`, name.getText(source));
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    const references = collectUnusedCandidates(source, unit, add, moduleScope);
    for (const global of symbols.globals.slice(unitGlobalStart)) global.references = references.get(global.name) || 0;
  }

  // Acorn independently validates executable HTML snippets and gives stable syntax coverage
  // for classic JavaScript while TypeScript supplies the uniform AST used by the rules.
  if (path.extname(file).toLowerCase() === '.html') {
    for (const unit of units) {
      if (unit.kind) continue;
      try {
        const ast = acorn.parse(unit.text, { ecmaVersion: 'latest', sourceType: unit.module ? 'module' : 'script', allowAwaitOutsideFunction: unit.module, allowReturnOutsideFunction: true });
        walk.simple(ast, { FunctionDeclaration() { /* parser walk confirms executable function syntax */ } });
      } catch (error) {
        const line = (unit.sourceText.slice(0, unit.sourceOffset).match(/\n/g) || []).length + 1;
        findings.push({ file, rule: 'parse-error', line, message: `inline JavaScript did not parse: ${error.message}`, fingerprint: fingerprint('parse-error', error.message.replace(/ \(\d+:\d+\)$/, '')) });
      }
    }
  }
  return { findings, metrics, symbols };
}

function readFromGit(ref, file) {
  try { return git(['show', `${ref}:${file}`]); } catch { return null; }
}

function changedPaths(base) {
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMRTUXB', base, '--']).split(/\r?\n/).filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
  return [...new Set([...tracked, ...untracked].map(normalizedPath))];
}

export function introducedFindings(current, baseline) {
  const counts = new Map();
  for (const finding of baseline) counts.set(finding.fingerprint, (counts.get(finding.fingerprint) || 0) + 1);
  const introduced = [];
  for (const finding of current) {
    const remaining = counts.get(finding.fingerprint) || 0;
    if (remaining) counts.set(finding.fingerprint, remaining - 1);
    else introduced.push(finding);
  }
  return introduced;
}

function isCountableText(bytes) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function auditChanges({ base, paths = changedPaths(base), rootDir = root } = {}) {
  const failures = [];
  const improvements = [];
  for (const file of paths) {
    const bytes = (() => { try { return fs.readFileSync(path.join(rootDir, file)); } catch { return null; } })();
    if (bytes === null) continue;
    const current = bytes.toString('utf8');
    const before = readFromGit(base, file);
    if (before === null && isCountableText(bytes) && countLines(current) > 500) {
      failures.push({ file, rule: 'new-file-size', line: 501, message: `new authored text file has ${countLines(current)} lines; limit is 500` });
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()) || isGenerated(file)) continue;
    const now = analyzeSourceText(current, file).findings;
    const old = before === null ? [] : analyzeSourceText(before, file).findings;
    failures.push(...introducedFindings(now, old));
    improvements.push(...introducedFindings(old, now).map(finding => ({ ...finding, status: 'removed' })));
  }
  return { failures, improvements };
}

async function runCli(argv) {
  if (argv.length === 1 && argv[0] === '--report') {
    const { reportRepository } = await import('./architecture-report.mjs');
    return reportRepository(analyzeSourceText);
  }
  if (argv.length !== 2 || argv[0] !== '--base') throw new Error('Usage: node scripts/check-architecture.mjs --base <trusted-commit> | --report');
  const base = git(['rev-parse', '--verify', `${argv[1]}^{commit}`]);
  try { git(['merge-base', '--is-ancestor', base, 'HEAD']); }
  catch { throw new Error('The trusted base must be an ancestor of HEAD.'); }
  const result = auditChanges({ base, paths: changedPaths(base) });
  for (const improvement of result.improvements) process.stdout.write(`FIXED ${improvement.file}:${improvement.line} ${improvement.rule} ${improvement.message}\n`);
  for (const failure of result.failures) process.stderr.write(`ERROR ${failure.file}:${failure.line} ${failure.rule} ${failure.message}\n`);
  if (result.failures.length) return 1;
  process.stdout.write(`Architecture audit passed against ${base}; no new findings in changed first-party files.\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runCli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
