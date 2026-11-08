import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditRuntimeIdentifiers, compareRuntimeIdentifiers} from '../scripts/check-runtime-identifiers.mjs';

test('changed functions reject new unresolved references and retain only matching prior debt', () => {
  const prior='function render(){\nlegacyMissing();\nreturn 1;\n}';
  assert.deepEqual(compareRuntimeIdentifiers(prior.replace('return 1','return 2'),prior),[]);
  assert.deepEqual(compareRuntimeIdentifiers(prior.replace('return 1','newMissing(); return 1'),prior).map(x=>x.name),['newMissing']);
  const local='function render(){\nconst value=1;\nreturn value;\n}';
  assert.deepEqual(compareRuntimeIdentifiers(local.replace('const value=1;',''),local).map(x=>x.name),['value']);
  const duplicate=prior.replace('legacyMissing();','legacyMissing(); legacyMissing();');
  assert.equal(compareRuntimeIdentifiers(duplicate,prior).filter(x=>x.name==='legacyMissing').length,2);
});

test('masterUid audit rejects an undeclared asset reference and accepts a local binding', () => {
  const dir=mkdtempSync(path.join(os.tmpdir(),'gnc-identifier-'));
  try {
    mkdirSync(path.join(dir,'assets'));
    writeFileSync(path.join(dir,'assets/app-runtime.js'),'function ready(){return 1}\n');
    writeFileSync(path.join(dir,'index.html'),'<html></html>');
    const file=path.join(dir,'assets/example.js');
    writeFileSync(file,'function bad(){return masterUid}\n');
    assert.equal(auditRuntimeIdentifiers(dir,'function ready(){return 1}\n').masterUid.length,1);
    writeFileSync(file,'function good(masterUid){return masterUid}\n');
    assert.deepEqual(auditRuntimeIdentifiers(dir,'function ready(){return 1}\n').masterUid,[]);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
