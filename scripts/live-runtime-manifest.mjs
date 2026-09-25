import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idPattern = /^[a-z][a-z0-9-]*$/;

function assert(condition, message) {
  if (!condition) throw new Error(`LIVE_RUNTIME_MANIFEST: ${message}`);
}

const globalAliases = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames']);
function isGlobalObject(node) {
  if (node?.type === 'Identifier') return globalAliases.has(node.name);
  if (node?.type !== 'MemberExpression' || !isGlobalObject(node.object)) return false;
  const property = !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : node.computed && node.property.type === 'Literal' ? node.property.value : null;
  return typeof property === 'string' && globalAliases.has(property);
}

function assignedGlobalName(member, moduleId) {
  if (member?.type !== 'MemberExpression' || !isGlobalObject(member.object)) return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string' && /^[A-Za-z_$][\w$]*$/.test(member.property.value)) return member.property.value;
  assert(false, `${moduleId} uses a dynamic global assignment`);
}

function collectAssignmentTarget(target, moduleId, assigned) {
  if (!target) return;
  const name = assignedGlobalName(target, moduleId);
  if (name) { assigned.add(name); return; }
  if (target.type === 'ArrayPattern') for (const item of target.elements) collectAssignmentTarget(item, moduleId, assigned);
  if (target.type === 'ObjectPattern') for (const property of target.properties) collectAssignmentTarget(property.value || property.argument, moduleId, assigned);
  if (target.type === 'AssignmentPattern' || target.type === 'RestElement') collectAssignmentTarget(target.left || target.argument, moduleId, assigned);
}

function assignedGlobals(source, moduleId) {
  const assigned = new Set();
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  simple(ast, {
    AssignmentExpression(node) {
      collectAssignmentTarget(node.left, moduleId, assigned);
      assert(!isGlobalObject(node.right), `${moduleId} aliases the global object`);
    },
    UpdateExpression(node) { collectAssignmentTarget(node.argument, moduleId, assigned); },
    UnaryExpression(node) {
      if (node.operator === 'delete') collectAssignmentTarget(node.argument, moduleId, assigned);
    },
    VariableDeclarator(node) { assert(!isGlobalObject(node.init), `${moduleId} aliases the global object`); },
    CallExpression(node) {
      assert(!node.arguments.some(isGlobalObject), `${moduleId} passes the global object to a call`);
    },
  });
  return assigned;
}

export async function validateLiveRuntimeManifest(manifest, { root = defaultRoot, readSource } = {}) {
  assert(manifest && manifest.schemaVersion === 'gnc-live-runtime-modules-v1', 'unsupported schema');
  assert(manifest.legacyRuntimePosition === 'after-modules', 'legacy runtime must remain after extracted modules');
  assert(Array.isArray(manifest.modules), 'modules must be an array');
  const load = readSource || (source => readFile(path.join(root, source), 'utf8'));
  const ids = new Set();
  const globals = new Map();
  const completed = new Set();
  const sources = [];
  for (const module of manifest.modules) {
    assert(module && idPattern.test(module.id || ''), `invalid module id ${module?.id || ''}`);
    assert(!ids.has(module.id), `duplicate module id ${module.id}`);
    ids.add(module.id);
    assert(typeof module.source === 'string' && /^live-src\/modules\/[a-z0-9-]+\.js$/.test(module.source), `unsafe source for ${module.id}`);
    assert(Array.isArray(module.dependencies) && Array.isArray(module.globals), `missing declarations for ${module.id}`);
    for (const dependency of module.dependencies) assert(completed.has(dependency), `${module.id} depends on missing or later module ${dependency}`);
    const source = await load(module.source);
    assert(typeof source === 'string' && source.length > 0, `missing or empty source for ${module.id}`);
    const assigned = assignedGlobals(source, module.id);
    for (const name of assigned) assert(module.globals.includes(name), `${module.id} assigns undeclared global ${name}`);
    for (const name of module.globals) {
      assert(assigned.has(name), `${module.id} declares unused global ${name}`);
      assert(!globals.has(name), `${module.id} duplicates global ${name} from ${globals.get(name)}`);
      globals.set(name, module.id);
    }
    completed.add(module.id);
    sources.push({ ...module, sourceText: source });
  }
  return { manifest, modules: sources };
}

export async function loadLiveRuntimeManifest({ root = defaultRoot } = {}) {
  const manifestPath = path.join(root, 'live-src', 'runtime-modules.json');
  return validateLiveRuntimeManifest(JSON.parse(await readFile(manifestPath, 'utf8')), { root });
}

export function assembleLiveRuntime(legacySource, validated) {
  assert(typeof legacySource === 'string' && legacySource.length > 0, 'legacy runtime is empty');
  const extracted = validated.modules.map(module => `/* gnc-module:${module.id} */\n${module.sourceText}`).join('\n');
  return extracted ? `${extracted}\n/* gnc-module:legacy-inline-runtime */\n${legacySource}` : legacySource;
}

export function assertLiveRuntimeOutputSize(code, { min = 500_000, max = 10_000_000 } = {}) {
  assert(typeof code === 'string' && Buffer.byteLength(code, 'utf8') >= min, 'runtime output was unexpectedly small');
  assert(Buffer.byteLength(code, 'utf8') <= max, 'runtime output was unexpectedly large');
}
