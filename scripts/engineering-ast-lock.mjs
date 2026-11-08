import {parse} from 'acorn';
import {analyze} from 'eslint-scope';

const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const branches = /^(?:IfStatement|ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement|SwitchStatement|TryStatement|ConditionalExpression)$/;
const evidenceOwner = /hydrat|evaluat|photo|mark.*done|card.*metric|publish.*row|row.*mutat/i;
const ignoredKeys = new Set(['loc', 'range', 'start', 'end', 'tokens', 'comments', 'parent']);

export function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  for (const [key, value] of Object.entries(node)) {
    if (ignoredKeys.has(key)) continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') walk(child, visit, [...ancestors, node]);
    }
  }
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
  return JSON.stringify(node.body, (key, value) => ignoredKeys.has(key) ? undefined : value);
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

function deadCodeFailures(ast, touched) {
  const issues = [];
  walk(ast, node => {
    if (node.type === 'BlockStatement' || node.type === 'Program' || node.type === 'SwitchCase') {
      issues.push(...sequenceFailures(node.body || node.consequent || [], touched));
    }
    if (branches.test(node.type) && node.test?.type === 'Literal' && touched(node)) {
      if (node.test.value === false || (node.type === 'IfStatement' && node.test.value === true)) issues.push('constant dead branch');
    }
  });
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

function runtimeFailures(ast, source, touched, functions) {
  const issues = [], constants = new Map();
  walk(ast, node => {
    if (node.type !== 'VariableDeclarator') return;
    if (node.init?.type === 'Literal') constants.set(node.id.name, node.init.value);
    if (['setInterval', 'setTimeout'].includes(memberName(node.init))) constants.set('call:' + node.id.name, memberName(node.init));
  });
  walk(ast, (node, ancestors) => {
    if (!touched(node)) return;
    const value = stringValue(node);
    if (/\/storage\/v1\/render\/image\//i.test(value)) issues.push('Supabase image transformation endpoint');
    for (const match of value.matchAll(/\b([a-z]{20})(?:\.supabase\.(?:co|com)|(?=\b))/g)) {
      if (match[1] !== 'kzrnyjsosryejjejliii') issues.push('non-production Supabase project reference');
    }
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
  });
  return issues;
}

function uiHandler(node) {
  if (node.type === 'AssignmentExpression' && /^(?:onclick|onsubmit|onchange)$/i.test(memberName(node.left))) return true;
  if (node.type === 'JSXAttribute' && /^(?:onClick|onSubmit|onChange)$/.test(node.name?.name)) return true;
  return node.type === 'CallExpression' && memberName(node.callee) === 'addEventListener'
    && ['click', 'submit', 'change'].includes(node.arguments[0]?.value);
}

function unusedFailures(scopeManager, touched, ast) {
  const exported = new Set();
  walk(ast, node => {
    if (node.type === 'ExportDefaultDeclaration' && node.declaration?.id) exported.add(node.declaration.id.name);
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      if (node.declaration.id) exported.add(node.declaration.id.name);
      for (const declaration of node.declaration.declarations || []) exported.add(declaration.id.name);
    }
    for (const specifier of node.type === 'ExportNamedDeclaration' ? node.specifiers : []) exported.add(specifier.local.name);
  });
  const issues = [];
  for (const variable of scopeManager.scopes.flatMap(scope => scope.variables)) {
    if (!variable.defs.length || !variable.identifiers.some(touched) || exported.has(variable.name)) continue;
    if (variable.references.some(reference => reference.isRead())) continue;
    if (variable.defs.every(def => def.type === 'Parameter') && variable.name === 'arguments') continue;
    issues.push('unused binding ' + variable.name);
  }
  return issues;
}

export async function inspectEngineeringSource({source, before = '', file, ranges, peers = []}) {
  const parsed = await parseSource(source, file), {ast, scopeManager} = parsed;
  const touched = node => changed(node, ranges), issues = [], functions = new Map(), records = [];
  walk(ast, (node, ancestors) => {
    if (!functionTypes.has(node.type)) return;
    const name = functionName(node, ancestors), text = source.slice(node.start, node.end);
    functions.set(name, node);
    const modified = touched(node) && !before.includes(text);
    records.push({name, node, modified, fingerprint:bodyFingerprint(node), text});
    if (!modified) return;
    if (node.loc.end.line - node.loc.start.line + 1 > 60) issues.push(name + ': function exceeds 60 lines');
    if (nestingFailure(node)) issues.push(name + ': nesting exceeds three levels');
  });
  const declarations = new Map();
  walk(ast, (node, ancestors) => {
    if (node.type !== 'FunctionDeclaration') return;
    const scope = [...ancestors].reverse().find(parent => ['Program', 'BlockStatement', 'SwitchCase'].includes(parent.type));
    const key = scope.start + ':' + node.id.name, matches = declarations.get(key) || [];
    matches.push(node); declarations.set(key, matches);
  });
  for (const matches of declarations.values()) {
    if (matches.length > 1 && matches.some(touched)) issues.push('duplicate function declaration ' + matches[0].id.name);
  }
  for (const record of records.filter(item => item.modified && item.fingerprint)) {
    const clone = records.find(other => other !== record && other.fingerprint === record.fingerprint);
    if (clone) issues.push(record.name + ': duplicated helper body (' + clone.name + ')');
    if (evidenceOwner.test(record.name) && peers.some(peer => peer.name !== record.name && peer.fingerprint === record.fingerprint)) {
      issues.push(record.name + ': duplicated cross-view hydration/mutation helper');
    }
  }
  const affected = records.filter(record => record.modified);
  const checked = node => touched(node) || affected.some(record => node.start >= record.node.start && node.end <= record.node.end);
  issues.push(...deadCodeFailures(ast, checked), ...unusedFailures(scopeManager, checked, ast));
  for (const comment of ast.comments || []) {
    if (touched(comment) && /(?:^|\n)\s*(?:const|let|var|function|return|if\s*\(|await\s|console\.)/.test(comment.value)) issues.push('commented-out code block');
  }
  walk(ast, node => {
    if (touched(node) && (node.type === 'DebuggerStatement' || (node.type === 'CallExpression'
      && node.callee?.object?.name === 'console' && ['log', 'debug', 'trace'].includes(memberName(node.callee))))) issues.push('leftover debug statement');
  });
  if (!/(?:^|\/)(?:tests?|__tests__|fixtures|scripts|tools)\//.test(file)) {
    issues.push(...runtimeFailures(ast, source, checked, functions));
  }
  return {issues:[...new Set(issues)], records};
}
