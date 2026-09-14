import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareReleaseVersion } from '../scripts/prepare-release-version.mjs';

test('one version preparation repairs mixed markers without rewriting historical compatibility versions',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gnc-version-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'scripts'));
  const write=(file,value)=>fs.writeFileSync(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  write('package.json',{version:'2026.09.14.02'});
  write('package-lock.json',{version:'2026.09.14.01',packages:{'':{version:'2026.09.14.01'}}});
  write('manifest.json',{version:'V2026.09.14.02'});
  write('index.html',"window.__APP_SHELL_VERSION__ = 'V2026.09.14.01'; legacy='V2026.08.13.18';");
  write('sw.js',"const APP_SHELL_BUILD = 'V2026.09.13.04';");
  write('scripts/build-live-shell.mjs',"const RELEASE = 'V2026.09.14.01';");
  const before=read('index.html');
  assert.throws(()=>prepareReleaseVersion(root,true),/MISMATCH/);
  assert.equal(read('index.html'),before);
  assert.equal(prepareReleaseVersion(root),'V2026.09.14.02');
  assert.equal(prepareReleaseVersion(root,true),'V2026.09.14.02');
  assert.match(read('index.html'),/legacy='V2026.08.13.18'/);
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].version,'2026.09.14.02');
  write('package.json',{version:'invalid'});
  assert.throws(()=>prepareReleaseVersion(root),/VERSION_INVALID/);
});
