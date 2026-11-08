import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectEngineeringSource, bodyFingerprint, parseSource, walk} from '../scripts/engineering-ast-lock.mjs';
import {engineeringFailures} from '../scripts/anti-spaghetti-lock.mjs';

const inspect = (source, options = {}) => inspectEngineeringSource({source, file:'assets/example.js', ranges:[[1,10000]], ...options});
const rejects = async (source, pattern, options) => assert.match((await inspect(source, options)).issues.join('\n'), pattern);

test('function limits apply to new and modified code but preserve unchanged legacy bodies', async () => {
  const large = 'export function save(row) {\n' + 'row.value++;\n'.repeat(60) + 'return row;\n}';
  await rejects(large, /exceeds 60 lines/);
  assert.deepEqual((await inspect(large, {before:large})).issues, []);
  await rejects(large.replace('row.value++', 'row.value += 2'), /exceeds 60 lines/, {before:large});
  await rejects('export function save(row){if(row){if(row.ok){if(row.ready){if(row.valid)return row}}}return null}', /nesting/);
  assert.deepEqual((await inspect('export function save(row){if(!row)return null;return row}')).issues, []);
});

test('duplicate declarations, renamed clones and cross-view copies fail', async () => {
  await rejects('function save(){return 1} function save(){return 2} save();', /duplicate function/);
  const first = 'function hydrateDrive(row){row.qty+=1;row.value+=2;return row}';
  await rejects(first + first.replaceAll('hydrateDrive', 'hydrateAV') + 'hydrateDrive({});hydrateAV({});', /duplicated helper/);
  const {ast} = await parseSource(first, 'source.js');
  await rejects(first.replace('hydrateDrive', 'hydrateDocks') + 'hydrateDocks({});', /cross-view/,
    {peers:[{name:'hydrateDrive', fingerprint:bodyFingerprint(ast.body[0])}]});
  assert.deepEqual((await inspect('export function save(row){function helper(){return row}return helper()}')).issues, []);
  assert.deepEqual((await inspect('export function read(){load();sort();return render()} export function write(){save();audit();return confirm()}')).issues, []);
});

test('fingerprints preserve BigInt values and detect identical bodies', async () => {
  const source = 'function one(){const n=1n;use(n);return n} function two(){const n=1n;use(n);return n}';
  const {ast} = await parseSource(source, 'source.js');
  assert.equal(bodyFingerprint(ast.body[0]), bodyFingerprint(ast.body[1]));
  const changed = await parseSource(source.replace('const n=1n;use(n);return n}', 'const n=2n;use(n);return n}'), 'source.js');
  assert.notEqual(bodyFingerprint(changed.ast.body[0]), bodyFingerprint(changed.ast.body[1]));
  await rejects(source + 'one();two();', /duplicated helper/);
});

test('Supabase endpoint, interpolation and project-reference regressions fail', async () => {
  for (const source of [
    "fetch('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/render/image/public/photo')",
    'fetch(`/storage/v1/render/image/public/${photo}`)',
    "fetch('https://abcdefghijklmnopqrst.supabase.co/rest/v1/items')",
    "const PROJECT_REF='abcdefghijklmnopqrst'; fetch(PROJECT_REF)",
    "configure({projectRef:'abcdefghijklmnopqrst'})",
    "const SUPABASE_PROJECT_ID='abcdefghijklmnopqrst'",
    "setProjectRef('abcdefghijklmnopqrst')",
  ]) await rejects(source, /transformation|project reference/);
  assert.deepEqual((await inspect("fetch('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/photo')")).issues, []);
  assert.deepEqual((await inspect("export const field='printedcontainercode'")).issues, []);
});

test('polling needs a bounded interval and lifecycle guard; realtime reads need throttling', async () => {
  await rejects('setInterval(()=>fetch("/rows"),10)', /unguarded polling/);
  await rejects('const tick=setInterval;tick(()=>fetch("/rows"),2000)', /unguarded polling/);
  await rejects('function tick(){fetch("/rows");setTimeout(tick,100)}tick()', /unguarded polling/);
  await rejects('channel.on("postgres_changes",{},()=>fetch("/rows"))', /unthrottled realtime/);
  await rejects('setInterval(()=>{if(document.hidden)return;refreshState()},2000)', /unguarded polling/);
  assert.deepEqual((await inspect('setInterval(()=>{if(document.hidden||window.inFlight||Date.now()<retryNotBefore)return;refreshState()},2000)')).issues, []);
  assert.deepEqual((await inspect('setTimeout(()=>renderState(),100)')).issues, []);
});

test('dead code, commented-out code, debug statements and unused bindings fail', async () => {
  for (const [source, pattern] of [
    ['export function save(){return 1;notify()}', /unreachable/],
    ['if(false){notify()}', /dead branch/],
    ['// const stale = oldState();\nrenderState()', /commented-out/],
    ['console.debug("trace")', /debug statement/],
    ['debugger;', /debug statement/],
    ['export function save(){const unused=1;return 2}', /unused binding/],
    ['function orphan(){return 1}', /unused binding/],
  ]) await rejects(source, pattern);
  assert.deepEqual((await inspect('// Render the confirmed state.\nexport default function save(row){return row}')).issues, []);
});

test('classes and required positional placeholders retain unused-binding checks', async () => {
  const safe = 'export function run(){class Clock{};const read=(_value, value)=>value;return [Clock,read]}';
  assert.deepEqual((await inspect(safe)).issues, []);
  await rejects('export function run(){class Orphan{};return 1}', /unused binding Orphan/);
  await rejects('export const read=(value,_unused)=>value', /unused binding _unused/);
  await rejects('export const read=(_unused)=>1', /unused binding _unused/);
  await rejects('export const read=(unused,value)=>value', /unused binding unused/);
});

test('changed function inspection includes untouched hazardous statements', async () => {
  const before = 'export function save(){\nif(false){bad()}\nreturn 1;\n}';
  const source = before.replace('return 1', 'return 2');
  await rejects(source, /constant dead branch/, {before, ranges:[[3,3]]});
  const polling = 'export function load(){\nsetInterval(()=>fetch("/rows"),10);\nreturn 1;\n}';
  await rejects(polling.replace('return 1', 'return 2'), /unguarded polling/,
    {before:polling, ranges:[[3,3]]});
  assert.deepEqual((await inspect('export function save(){\nreturn 2;\n}', {ranges:[[2,2]]})).issues, []);
});

test('UI event handlers dispatch commands instead of issuing raw queries', async () => {
  await rejects('button.addEventListener("click",()=>client.from("rows").select())', /raw database/);
  await rejects('button.onclick=()=>client.rpc("save_row")', /raw database/);
  assert.deepEqual((await inspect('button.addEventListener("click",()=>submitEvaluation())')).issues, []);
});

function collectLegacyNodes(node, expected) {
  if (!node || typeof node.type !== 'string') return;
  expected.push(`${node.type}:${node.start}:${node.end}`);
  for (const [key, value] of Object.entries(node)) {
    if (['loc','range','start','end','tokens','comments','parent'].includes(key)) continue;
    for (const child of Array.isArray(value) ? value : [value]) collectLegacyNodes(child, expected);
  }
}
test('AST walking retains the complete JS and TypeScript syntax tree', async () => {
  for (const [file, source] of [
    ['sample.js', 'export class C extends Base { static { use(1) } method(x = 1) { return obj?.[x] } }'],
    ['sample.ts', 'export class C<T> { method(x: T): T { return x as T } }'],
  ]) {
    const {ast} = await parseSource(source, file), visited = [], expected = [];
    walk(ast, node => visited.push(`${node.type}:${node.start}:${node.end}`));
    collectLegacyNodes(ast, expected);
    assert.deepEqual(visited.sort(), expected.sort(), file);
  }
});

test('TypeScript uses a real parser and scope analysis', async () => {
  assert.deepEqual((await inspect('export function identity(row: number): number {return row}', {file:'services/model.ts'})).issues, []);
  await rejects('export function identity(row: number): number { const unused = 1; return row; }', /unused binding/, {file:'services/model.ts'});
  await rejects('export function save(row: number) {\n' + 'row++;\n'.repeat(60) + 'return row;\n}', /exceeds 60 lines/, {file:'model.ts'});
  await rejects('export default () => <button onClick={()=>client.rpc("save")}/>;', /raw database/, {file:'view.jsx'});
  assert.deepEqual((await inspect('export default () => <button onClick={()=>submitEvaluation()}/>;', {file:'view.jsx'})).issues, []);
});

function fixtureGit(root, args) {
  return execFileSync('git', args, {cwd:root, encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe']});
}

async function inspectFixture(root) {
  // This independent Git history must not inherit the parent CI event's commit.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  delete process.env.GITHUB_EVENT_PATH;
  try { return await engineeringFailures(root, {peers:[]}); }
  finally {
    if (eventPath === undefined) delete process.env.GITHUB_EVENT_PATH;
    else process.env.GITHUB_EVENT_PATH = eventPath;
  }
}

test('Git integration catches inline scripts, deleted guards and staged/worktree disagreement', async () => {
  const base = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'agdata-engineering-'));
  assert(root.startsWith(base + path.sep));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text); };
  try {
    fixtureGit(root,['init','--quiet']);
    write('index.html','<script>function current(){return 1}current();</script>');
    fixtureGit(root,['add','.']);
    fixtureGit(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','baseline']);
    fixtureGit(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m','comparison']);
    assert.deepEqual(await inspectFixture(root),[]);
    write('index.html','<script>setInterval(()=>fetch("/rows"),10)</script>');
    assert.match((await inspectFixture(root)).join('\n'),/unguarded polling/);
    fixtureGit(root,['add','index.html']);
    write('index.html','<script>function current(){return 1}current();</script>');
    assert.match((await inspectFixture(root)).join('\n'),/unguarded polling/);
    fs.unlinkSync(path.join(root,'index.html'));
    assert.match((await inspectFixture(root)).join('\n'),/unguarded polling/);
    write('index.html','<script>function current(){return 1}current();</script>');
    fixtureGit(root,['restore','--staged','index.html']);
    write('assets/poller.js','setInterval(()=>{if(document.hidden)return;refreshState()},2000)');
    fixtureGit(root,['add','.']);
    fixtureGit(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','guarded poller']);
    write('assets/poller.js','setInterval(()=>{refreshState()},2000)');
    assert.match((await inspectFixture(root)).join('\n'),/unguarded polling/);
  } finally {
    assert(root.startsWith(base+path.sep) && path.basename(root).startsWith('agdata-engineering-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('fragment references and deterministic generated parity are verified', async () => {
  const base = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'agdata-fragments-'));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text); };
  try {
    fixtureGit(root,['init','--quiet']);
    write('assets/app-runtime.js', '/* @runtime-fragment assets/row-workflow-functions.js */\nexternalOne();');
    write('assets/row-workflow-functions.js', 'function externalOne(){return 1}');
    write('scripts/build-dock-order-domain.mjs', "const modules = [['core','dock-order-domain'], ['core','dock-issue-domain'], ['services','app-api-transport'], ['ui','body-prepaint-theme']]; for (const [directory,name] of modules) { const source = '../src/${directory}/${name}.js'; const target = '../assets/${name}.js'; source.replace(/^import .*;\\r?\\n/gm, '').replace(/^export /gm, ''); }");
    write('src/core/dock-order-domain.js', 'export function dockOne(){return 1}\n');
    write('src/core/dock-issue-domain.js', 'export function issueOne(){return 1}\n');
    write('assets/dock-issue-domain.js', 'function issueOne(){return 1}\n');
    write('src/services/app-api-transport.js', 'export function transportOne(){return 1}\n');
    write('assets/app-api-transport.js', 'function transportOne(){return 1}\n');
    write('src/ui/body-prepaint-theme.js', 'export function themeOne(){return 1}\n');
    write('assets/body-prepaint-theme.js', 'function themeOne(){return 1}\n');
    write('assets/dock-order-domain.js', 'function dockOne(){return 1}\n');
    fixtureGit(root,['add','.']);
    fixtureGit(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','base']);
    write('assets/row-workflow-functions.js', 'function externalOne(){return 2}');
    assert.deepEqual(await inspectFixture(root), []);
    write('assets/app-runtime.js', '/* @runtime-fragment assets/row-workflow-functions.js */\n// externalOne();');
    assert.match((await inspectFixture(root)).join('\n'), /unused binding externalOne/);
    write('assets/app-runtime.js', '/* @runtime-fragment assets/row-workflow-functions.js */\nfunction local(){const externalOne=()=>1;return externalOne()} local();');
    assert.match((await inspectFixture(root)).join('\n'), /unused binding externalOne/);
    write('assets/app-runtime.js', '/* @runtime-fragment assets/row-workflow-functions.js */\nexternalOne();');
    write('assets/row-workflow-functions.js', 'function externalOne(){return 2} function orphan(){return 1}');
    assert.match((await inspectFixture(root)).join('\n'), /unused binding orphan/);
    write('assets/row-workflow-functions.js', 'function externalOne(){return 2}');
    write('src/core/dock-order-domain.js', 'export function dockOne(){return 2}\n');
    write('assets/dock-order-domain.js', 'function dockOne(){return 2}\n');
    assert.deepEqual(await inspectFixture(root), []);
    fixtureGit(root,['add','assets/dock-order-domain.js']);
    assert.match((await inspectFixture(root)).join('\n'), /index: assets\/dock-order-domain.js: generated output differs/);
    fixtureGit(root,['add','src/core/dock-order-domain.js']);
    write('src/services/app-api-transport.js', 'export function transportOne(){return 2}\n');
    write('assets/app-api-transport.js', 'function transportOne(){return 2}\n');
    write('src/core/dock-issue-domain.js', 'import {dockOne} from \'./dock-order-domain.js\';\nexport function issueOne(){return dockOne()}\n');
    write('assets/dock-issue-domain.js', 'function issueOne(){return dockOne()}\n');
    assert.deepEqual(await inspectFixture(root), []);
    write('assets/app-api-transport.js', 'function transportOne(){return 3}\n');
    assert.match((await inspectFixture(root)).join('\n'), /generated output differs/);
    write('assets/app-api-transport.js', 'function transportOne(){return 2}\n');
    write('assets/dock-issue-domain.js', 'function issueOne(){return 3}\n');
    assert.match((await inspectFixture(root)).join('\n'), /generated output differs/);
    write('assets/dock-issue-domain.js', 'function issueOne(){return dockOne()}\n');
    write('assets/body-prepaint-theme.js', 'function themeOne(){return 2}\n');
    assert.match((await inspectFixture(root)).join('\n'), /generated output differs/);
    write('assets/body-prepaint-theme.js', 'function themeOne(){return 1}\n');
    write('assets/dock-order-domain.js', 'function dockOne(){return 3}\n');
    assert.match((await inspectFixture(root)).join('\n'), /generated output differs/);
  } finally {
    assert(root.startsWith(base+path.sep) && path.basename(root).startsWith('agdata-fragments-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
