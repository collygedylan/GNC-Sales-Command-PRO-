import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {engineeringProofFailures, validateAndWriteEngineeringProof} from './engineering-proof.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
async function fixture() {
  const dir=await mkdtemp(path.join(os.tmpdir(),'gnc-engineering-proof-'));
  git(dir,'init','-q');
  git(dir,'config','user.email','fixture@example.invalid');
  git(dir,'config','user.name','Fixture');
  await writeFile(path.join(dir,'package.json'),'{}');
  await writeFile(path.join(dir,'.gitignore'),'node_modules/\n.gnc-local/\n');
  await mkdir(path.join(dir,'assets'));
  await writeFile(path.join(dir,'assets/owner.js'),'export function safe(){return 1}\n');
  await mkdir(path.join(dir,'node_modules'));
  await cp(path.join(root,'node_modules/acorn'),path.join(dir,'node_modules/acorn'),{recursive:true,dereference:true});
  for (const name of ['eslint-scope','typescript-eslint','typescript','esbuild','react','react-dom','@esbuild']) {
    await symlink(path.join(root,'node_modules',name),path.join(dir,'node_modules',name),'junction');
  }
  git(dir,'add','.');
  git(dir,'commit','-qm','base');
  return dir;
}
async function write(dir,file,text) {
  await mkdir(path.dirname(path.join(dir,file)),{recursive:true});
  await writeFile(path.join(dir,file),text);
}
async function invalid(dir) { assert.match((await engineeringProofFailures(dir)).join('\n'),/missing, stale or invalid/); }

test('engineering proof is bound to worktree, index, rules, history and signature', async () => {
  const eventPath=process.env.GITHUB_EVENT_PATH;
  delete process.env.GITHUB_EVENT_PATH;
  const dir=await fixture();
  try {
    await invalid(dir);
    await validateAndWriteEngineeringProof(dir);
    assert.deepEqual(await engineeringProofFailures(dir),[]);
    const parser=path.join(dir,'node_modules/acorn/dist/acorn.js'), original=await readFile(parser);
    await writeFile(parser,Buffer.concat([original,Buffer.from('\n// changed parser\n')]));
    await invalid(dir);
    await writeFile(parser,original);
    assert.deepEqual(await engineeringProofFailures(dir),[]);
    const priorOptions=process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS=priorOptions === '--no-warnings' ? '--trace-warnings' : '--no-warnings';
    await invalid(dir);
    if (priorOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS=priorOptions;
    await write(dir,'src/ui/new.js','export const item=1;\n');
    await invalid(dir);
    await rm(path.join(dir,'src/ui/new.js'));
    assert.deepEqual(await engineeringProofFailures(dir),[]);
    await write(dir,'assets/owner.js','export function safe(){const unused=1;return 1}\n');
    await invalid(dir);
    await assert.rejects(validateAndWriteEngineeringProof(dir),/unused binding/);
    await write(dir,'assets/owner.js','export function safe(){return 1}\n');
    assert.deepEqual(await engineeringProofFailures(dir),[]);
    await write(dir,'assets/owner.js','export function safe(){return 2}\n');
    git(dir,'add','assets/owner.js');
    await write(dir,'assets/owner.js','export function safe(){return 1}\n');
    await invalid(dir);
    git(dir,'restore','--staged','assets/owner.js');
    await write(dir,'scripts/engineering-proof.mjs','export const changed=true;\n');
    await invalid(dir);
    await rm(path.join(dir,'scripts/engineering-proof.mjs'));
    assert.deepEqual(await engineeringProofFailures(dir),[]);
    const file=path.join(dir,'.gnc-local/engineering-proof.json');
    const data=JSON.parse(await readFile(file,'utf8'));data.signature='0'.repeat(64);
    await writeFile(file,JSON.stringify(data));
    await invalid(dir);
    await validateAndWriteEngineeringProof(dir);
    git(dir,'commit','--allow-empty','-qm','advance');
    await invalid(dir);
  } finally {
    for (const name of ['eslint-scope','typescript-eslint','typescript','esbuild','react','react-dom','@esbuild']) await rm(path.join(dir,'node_modules',name));
    await rm(path.join(dir,'node_modules'),{recursive:true,force:true});
    await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    if (eventPath !== undefined) process.env.GITHUB_EVENT_PATH=eventPath;
  }
});

