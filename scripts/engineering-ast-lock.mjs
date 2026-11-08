import {parse} from 'acorn';
import {analyze} from 'eslint-scope';

const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const branches = /^(?:IfStatement|ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement|SwitchStatement|TryStatement|ConditionalExpression)$/;
const evidenceOwner = /hydrat|evaluat|photo|mark.*done|card.*metric|publish.*row|row.*mutat/i;
const ignoredKeys = new Set(['loc', 'range', 'start', 'end', 'tokens', 'comments', 'parent']);

function walkValue(value, visit, ancestors) {
  if (Array.isArray(value)) {
    for (const child of value) if (child && typeof child.type === 'string') walk(child, visit, ancestors);
  } else if (value && typeof value.type === 'string') walk(value, visit, ancestors);
}
export function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  ancestors.push(node);
  for (const key in node) if (!ignoredKeys.has(key)) walkValue(node[key], visit, ancestors);
  ancestors.pop();
}

function walkRelevant(node, visit, ranges, ancestors = []) {
  if (!node || typeof node.type !== 'string' || (node.loc && !changed(node, ranges))) return;
  visit(node, ancestors);
  ancestors.push(node);
  for (const key in node) if (!ignoredKeys.has(key)) relevantValue(node[key], visit, ranges, ancestors);
  ancestors.pop();
}
function relevantValue(value, visit, ranges, ancestors) {
  if (Array.isArray(value)) {
    for (const child of value) walkRelevant(child, visit, ranges, ancestors);
  } else walkRelevant(value, visit, ranges, ancestors);
}

export async function parseSource(source, file) {
  if (/\.(?:[cm]?tsx?|jsx)$/.test(file)) {
    const {parser} = await import('typescript-eslint');
    const parsed = parser.parseForESLint(source, {loc:true, range:true, sourceType:'module', jsx:/x$/.test(file)});
    walk(parsed.ast, node => { [node.start, node.end] = node.range; });
    for (const comment of parsed.ast.comments || []) [comment.start, comment.end] = comment.range;
    return parsed;
  }
  const comments = [];
  const options = {ecmaVersion:'latest', locations:true, ranges:true, allowHashBang:true};
  let ast;
  try { ast = parse(source, {...options, sourceType:'module', onComment:comments}); }
  catch { comments.length = 0; ast = parse(source, {...options, sourceType:'script', onComment:comments}); }
  ast.comments = comments;
  return {ast, scopeManager:analyze(ast, {ecmaVersion:2024, sourceType:ast.sourceType, optimistic:true})};
}

function functionName(node, ancestors) {
  const parent = ancestors.at(-1);
  return node.id?.name || parent?.id?.name || parent?.key?.name || `<callback:${node.loc.start.line}>`;
}

function changed(node, ranges) {
  return ranges.some(([start, end]) => node.loc.start.line <= end && node.loc.end.line >= start);
}

export function bodyFingerprint(node) {
  if (node.body?.type !== 'BlockStatement' || node.body.body.length < 3) return null;
  return JSON.stringify(node.body, (key, value) => ignoredKeys.has(key) ? undefined : typeof value === 'bigint' ? String(value) + 'n' : value);
}

function nestingFailure(node) {
  let deepest = 0;
  walk(node.body, (child, ancestors) => {
    const depth = ancestors.filter(parent => branches.test(parent.type) || functionTypes.has(parent.type)).length;
    deepest = Math.max(deepest, depth + Number(branches.test(child.type)));
  });
  return deepest > 3;
}

function abrupt(node) {
  if (/^(?:Return|Throw|Break|Continue)Statement$/.test(node.type)) return true;
  if (node.type === 'BlockStatement') return node.body.some(abrupt);
  return node.type === 'IfStatement' && node.alternate && abrupt(node.consequent) && abrupt(node.alternate);
}

function deadCodeFailures(ast, touched, ranges) {
  const issues = [];
  walkRelevant(ast, node => {
    if (node.type === 'BlockStatement' || node.type === 'Program' || node.type === 'SwitchCase') {
      issues.push(...sequenceFailures(node.body || node.consequent || [], touched));
    }
    if (branches.test(node.type) && node.test?.type === 'Literal' && touched(node)) {
      if (node.test.value === false || (node.type === 'IfStatement' && node.test.value === true)) issues.push('constant dead branch');
    }
  }, ranges);
  return issues;
}

function sequenceFailures(statements, touched) {
  let ended = false;
  const issues = [];
  for (const statement of statements) {
    if (ended && statement.type !== 'FunctionDeclaration' && touched(statement)) issues.push('unreachable statement');
    ended ||= abrupt(statement);
  }
  return issues;
}

function memberName(node) {
  return node?.type === 'Identifier' ? node.name : node?.type === 'MemberExpression' ? (node.computed ? node.property.value : node.property.name) : '';
}

function stringValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral') return node.quasis.map(part => part.value.cooked).join('${expression}');
  if (node?.type === 'BinaryExpression' && node.operator === '+') return stringValue(node.left) + stringValue(node.right);
  return '';
}

function pollingFailure(node, source, functions, constants) {
  const original = memberName(node.callee), name = constants.get('call:' + original) || original;
  if (!['setInterval', 'setTimeout'].includes(name)) return false;
  const callback = node.arguments[0]?.type === 'Identifier' ? functions.get(node.arguments[0].name) : node.arguments[0];
  const text = callback ? source.slice(callback.start, callback.end) : '';
  const delay = node.arguments[1]?.value ?? constants.get(node.arguments[1]?.name);
  if (name === 'setTimeout' && !/\b(?:fetch|supabaseFetch|supabaseRpc|setTimeout)\s*\(/.test(text)) return false;
  if (name === 'setTimeout' && !/\bsetTimeout\s*\(/.test(text)) return false;
  return !(Number.isFinite(Number(delay)) && Number(delay) >= 1000 && /\bif\s*\(/.test(text) && /\breturn\b/.test(text)
    && /hidden|visible|[Pp]ollingAllowed|disposed|destroyed|active/.test(text)
    && /inflight|inFlight|singleFlight/.test(text) && /[Bb]ackoff|retryNotBefore/.test(text));
}

function projectReferenceContext(ancestors) {
  const parent = ancestors.at(-1);
  const projectKey = /project_?(?:ref|id)|supabase_?(?:ref|project)/i;
  if (parent?.type === 'VariableDeclarator') return projectKey.test(parent.id?.name || '');
  if (parent?.type === 'Property') return projectKey.test(memberName(parent.key));
  if (parent?.type === 'AssignmentExpression') return projectKey.test(memberName(parent.left));
  return parent?.type === 'CallExpression' && projectKey.test(memberName(parent.callee));
}
function projectReferenceFailure(value, ancestors) {
  const urls = [...value.matchAll(/\b([a-z]{20})\.supabase\.(?:co|com)\b/gi)];
  if (urls.some(match => match[1].toLowerCase() !== 'kzrnyjsosryejjejliii')) return true;
  return /^[a-z]{20}$/i.test(value) && projectReferenceContext(ancestors)
    && value.toLowerCase() !== 'kzrnyjsosryejjejliii';
}
function runtimeFailures(ast, source, touched, functions, ranges, constants) {
  const issues = [];
  walkRelevant(ast, (node, ancestors) => {
    if (!touched(node)) return;
    const value = stringValue(node);
    if (/\/storage\/v1\/render\/image\//i.test(value)) issues.push('Supabase image transformation endpoint');
    if (projectReferenceFailure(value, ancestors)) issues.push('non-production Supabase project reference');
    if (node.type !== 'CallExpression') return;
    if (pollingFailure(node, source, functions, constants)) issues.push('unguarded polling loop');
    const name = memberName(node.callee);
    if (name === 'on' && node.arguments[0]?.value === 'postgres_changes') {
      const callback = node.arguments.at(-1), body = source.slice(callback.start, callback.end);
      if (/\b(?:fetch|supabaseFetch|supabaseRpc)\s*\(|\.from\s*\(/.test(body) && !/debounce|setTimeout|singleFlight/.test(body)) {
        issues.push('unthrottled realtime refresh');
      }
    }
    if (['from', 'rpc', 'supabaseFetch', 'supabaseRpc'].includes(name)) {
      const handler = ancestors.find(parent => uiHandler(parent));
      if (handler) issues.push('raw database access inside UI event handler');
    }
  }, ranges);
  return issues;
}

function uiHandler(node) {
  if (node.type === 'AssignmentExpression' && /^(?:onclick|onsubmit|onchange)$/i.test(memberName(node.left))) return true;
  if (node.type === 'JSXAttribute' && /^(?:onClick|onSubmit|onChange)$/.test(node.name?.name)) return true;
  return node.type === 'CallExpression' && memberName(node.callee) === 'addEventListener'
    && ['click', 'submit', 'change'].includes(node.arguments[0]?.value);
}

function positionalPlaceholder(variable) {
  const def = variable.defs[0];
  if (!/^_/.test(variable.name) || variable.defs.length !== 1 || def.type !== 'Parameter') return false;
  return variable.scope.variables.some(other => other.defs.some(item => item.type === 'Parameter' && item.index > def.index)
    && other.references.some(reference => reference.isRead()));
}
function isClassInnerBinding(variable) {
  return variable.scope.type === 'class' && variable.scope.block.type === 'ClassDeclaration';
}
function unusedFailures(scopeManager, touched, exported, externalReferences) {
  const issues = [];
  for (const variable of scopeManager.scopes.flatMap(scope => scope.variables)) {
    if (!variable.defs.length || !variable.identifiers.some(touched) || exported.has(variable.name)) continue;
    if (variable.references.some(reference => reference.isRead())) continue;
    if (variable.scope.block.type === 'Program' && externalReferences.has(variable.name)) continue;
    if (isClassInnerBinding(variable) || positionalPlaceholder(variable)) continue;
    if (variable.defs.every(def => def.type === 'Parameter') && variable.name === 'arguments') continue;
    issues.push('unused binding ' + variable.name);
  }
  return issues;
}

function collectDeclaration(node, ancestors, declarations) {
  if (node.type !== 'FunctionDeclaration') return;
  const scope = [...ancestors].reverse().find(parent => ['Program', 'BlockStatement', 'SwitchCase'].includes(parent.type));
  const key = scope.start + ':' + node.id.name, matches = declarations.get(key) || [];
  matches.push(node); declarations.set(key, matches);
}
function collectExport(node, exported) {
  if (node.type === 'ExportDefaultDeclaration' && node.declaration?.id) exported.add(node.declaration.id.name);
  if (node.type !== 'ExportNamedDeclaration') return;
  if (node.declaration?.id) exported.add(node.declaration.id.name);
  for (const declaration of node.declaration?.declarations || []) exported.add(declaration.id.name);
  for (const specifier of node.specifiers || []) exported.add(specifier.local.name);
}
function collectConstant(node, constants) {
  if (node.type !== 'VariableDeclarator') return;
  if (node.init?.type === 'Literal') constants.set(node.id.name, node.init.value);
  if (['setInterval', 'setTimeout'].includes(memberName(node.init))) constants.set('call:' + node.id.name, memberName(node.init));
}

function functionRecord(name, node, modified, text) {
  const shape = node.body?.type === 'BlockStatement' ? node.body.body.map(item => item.type).join(',') : '';
  let fingerprint;
  return {name, node, modified, text, shape, get fingerprint() {
    if (fingerprint === undefined) fingerprint = bodyFingerprint(node);
    return fingerprint;
  }};
}

export async function inspectEngineeringSource({source, before = '', file, ranges, peers = [], parsed, externalReferences = new Set()}) {
  const {ast, scopeManager} = parsed || await parseSource(source, file);
  const touched = node => changed(node, ranges), issues = [], functions = new Map(), records = [];
  const declarations = new Map(), exported = new Set(), constants = new Map();
  walk(ast, (node, ancestors) => {
    collectDeclaration(node, ancestors, declarations);
    collectExport(node, exported);
    collectConstant(node, constants);
    if (!functionTypes.has(node.type)) return;
    const name = functionName(node, ancestors), text = source.slice(node.start, node.end);
    functions.set(name, node);
    const modified = touched(node) && !before.includes(text);
    records.push(functionRecord(name, node, modified, text));
    if (!modified) return;
    if (node.loc.end.line - node.loc.start.line + 1 > 60) issues.push(name + ': function exceeds 60 lines');
    if (nestingFailure(node)) issues.push(name + ': nesting exceeds three levels');
  });
  for (const matches of declarations.values()) {
    if (matches.length > 1 && matches.some(touched)) issues.push('duplicate function declaration ' + matches[0].id.name);
  }
  for (const record of records.filter(item => item.modified && item.fingerprint)) {
    const clone = records.find(other => other !== record && other.shape === record.shape && other.fingerprint === record.fingerprint);
    if (clone) issues.push(record.name + ': duplicated helper body (' + clone.name + ')');
    if (evidenceOwner.test(record.name) && peers.some(peer => peer.name !== record.name && peer.fingerprint === record.fingerprint)) {
      issues.push(record.name + ': duplicated cross-view hydration/mutation helper');
    }
  }
  const affected = records.filter(record => record.modified);
  const checked = node => touched(node) || affected.some(record => node.start >= record.node.start && node.end <= record.node.end);
  const relevant = ranges.concat(affected.map(record => [record.node.loc.start.line, record.node.loc.end.line]));
  issues.push(...deadCodeFailures(ast, checked, relevant), ...unusedFailures(scopeManager, checked, exported, externalReferences));
  for (const comment of ast.comments || []) {
    if (touched(comment) && /(?:^|\n)\s*(?:const|let|var|function|return|if\s*\(|await\s|console\.)/.test(comment.value)) issues.push('commented-out code block');
  }
  walkRelevant(ast, node => {
    if (touched(node) && (node.type === 'DebuggerStatement' || (node.type === 'CallExpression'
      && node.callee?.object?.name === 'console' && ['log', 'debug', 'trace'].includes(memberName(node.callee))))) issues.push('leftover debug statement');
  }, ranges);
  if (!/(?:^|\/)(?:tests?|__tests__|fixtures|scripts|tools)\//.test(file)) {
    issues.push(...runtimeFailures(ast, source, checked, functions, relevant, constants));
  }
  return {issues:[...new Set(issues)], records};
}
