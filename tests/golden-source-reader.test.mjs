import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createGoldenSourceReader } from './helpers/golden-source-reader.mjs';

function fixtureReader(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gnc-source-reader-'));
  const paths = Object.keys(files).map(file => path.join(root, file));
  for (const [index, source] of Object.values(files).entries()) writeFileSync(paths[index], source);
  t.after(() => {
    paths.forEach(file => unlinkSync(file));
    rmdirSync(root);
  });
  return createGoldenSourceReader(root);
}

const lexicalSource = `
/** function commentOnly() {} */
const text = 'function stringOnly() {}';
const pattern = /function regexOnly()/;
function outer() {
  function repeated() { return 'first'; }
}
function repeated() { return 'second'; }
const arrow = () => { function inArrow() {} };
class Wrapper {
  static { function inStaticBlock() {} }
  method() { function inMethod() {} }
}
{ function inBlock() {} }
`;

test('Golden declaration lookup keeps first exact text and respects function boundaries', t => {
  const reader = fixtureReader(t, { 'lexical.js': lexicalSource });
  const source = (name, required) => reader.functionSource('lexical.js', name, required);
  assert.equal(source('repeated'), "function repeated() { return 'first'; }");
  assert.equal(source('inArrow'), 'function inArrow() {}');
  assert.equal(source('inMethod'), 'function inMethod() {}');
  assert.equal(source('inStaticBlock', false), 'function inStaticBlock() {}');
  assert.equal(source('inBlock', false), 'function inBlock() {}');
  for (const name of ['repeated','inArrow','inMethod','commentOnly','stringOnly','regexOnly','missing']) {
    assert.equal(source(name,false),null,name);
  }
  assert.throws(() => source('missing'), /lexical\.js:missing/);
  const tree = reader.syntax('lexical.js');
  assert.equal(tree.statements[0].parent,tree);
  assert.equal(reader.syntax('lexical.js'),tree);
  assert.equal(source('repeated'), "function repeated() { return 'first'; }");
});

test('Golden lookup follows an imported alias to its real declaration', t => {
  const reader = fixtureReader(t, {
    'caller.ts': "import { owner as localOwner } from './owner.ts';",
    'owner.ts': '// declaration\nexport function owner(value: string) { return value; }',
  });
  const source = reader.functionSource('caller.ts','localOwner');
  assert.equal(source, 'export function owner(value: string) { return value; }\nconst localOwner = owner;');
  const script = ts.transpileModule(source.replace(/^export /,''), {compilerOptions:{module:ts.ModuleKind.None}}).outputText;
  assert.equal(vm.runInNewContext(`${script}\nlocalOwner('exact')`), 'exact');
  assert.equal(reader.functionSource('caller.ts','unimported',false),null);
});

test('Golden compact lookup matches the production syntax tree declaration text', () => {
  const reader = createGoldenSourceReader(process.cwd());
  const file = 'assets/request-folder-choice.js';
  const names = ['isReservedRequestNaChoice','submitRequestCreateBatch'];
  const compact = names.map(name => reader.functionSource(file,name));
  const tree = reader.syntax(file);
  const expanded = names.map(name => tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name)?.getText(tree));
  assert.deepEqual(compact,expanded);
});
