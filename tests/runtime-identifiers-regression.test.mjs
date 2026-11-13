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

test('identical runtime baseline still audits raw runtime and inline masterUid references', () => {
  const dir=mkdtempSync(path.join(os.tmpdir(),'gnc-identifier-identical-'));
  try {
    mkdirSync(path.join(dir,'assets'));
    const runtime=path.join(dir,'assets/app-runtime.js'), html=path.join(dir,'index.html');
    const unsafe='function ready(){return masterUid}\n';
    writeFileSync(runtime,unsafe);
    writeFileSync(html,'<script>function inlineReady(){return masterUid}</script>');
    assert.deepEqual(auditRuntimeIdentifiers(dir,unsafe),{
      changedFunctions:0,undeclared:[],masterUid:[{file:'app-runtime.js',line:1},{file:'index.html',line:1}],
    });
    const safe='function ready(masterUid){return masterUid}\n';
    writeFileSync(runtime,safe);
    writeFileSync(html,'<script>function inlineReady(masterUid){return masterUid}</script>');
    assert.deepEqual(auditRuntimeIdentifiers(dir,safe),{changedFunctions:0,undeclared:[],masterUid:[]});
    writeFileSync(runtime,safe.replace('return masterUid','return unexpected'));
    assert.deepEqual(auditRuntimeIdentifiers(dir,safe),{
      changedFunctions:1,undeclared:[{name:'unexpected',line:1}],masterUid:[],
    });
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('runtime audit ignores CRLF checkout differences and detects changed code at its original line', () => {
  const dir=mkdtempSync(path.join(os.tmpdir(),'gnc-identifier-crlf-'));
  try {
    mkdirSync(path.join(dir,'assets'));
    const runtime=path.join(dir,'assets/app-runtime.js');
    writeFileSync(path.join(dir,'index.html'),'<html></html>');
    const baseline='function ready(masterUid){\nreturn masterUid;\n}\n';
    const current=baseline.replaceAll('\n','\r\n');
    writeFileSync(runtime,current);
    assert.deepEqual(auditRuntimeIdentifiers(dir,baseline),{changedFunctions:0,undeclared:[],masterUid:[]});
    const changed=current.replace('return masterUid','return missingOwner');
    writeFileSync(runtime,changed);
    const expected=[{name:'missingOwner',line:2}];
    assert.deepEqual(compareRuntimeIdentifiers(changed,baseline),expected);
    assert.deepEqual(auditRuntimeIdentifiers(dir,baseline),{changedFunctions:1,undeclared:expected,masterUid:[]});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
