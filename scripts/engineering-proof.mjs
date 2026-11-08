import {execFile} from 'node:child_process';
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile, writeFile, mkdir, rename, readdir, realpath, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

const proofPath = '.gnc-local/engineering-proof.json';
const keyPath = '.gnc-local/engineering-proof-key';
const rules = ['scripts/anti-spaghetti-lock.mjs','scripts/engineering-validator.mjs','scripts/engineering-ast-lock.mjs','scripts/engineering-proof.mjs',
  'scripts/monolith-growth-lock.mjs','scripts/git-batch-blobs.mjs','scripts/source-git-environment.mjs','scripts/monolith-baseline.json','scripts/fast-regression-lock.mjs',
  'scripts/fast-regression-contracts.mjs','scripts/fast-feature-lock.mjs','package.json','package-lock.json',
  'assets/app-runtime.js','assets/row-workflow-functions.js','scripts/build-dock-order-domain.mjs','scripts/build-historical-requests.mjs','scripts/build-ops-precision-pilot.mjs'];
const sourceFile = file => /\.(?:[cm]?jsx?|[cm]?tsx?|gs|html|css)$/.test(file)
  && !/(?:^|\/)(?:node_modules|vendor|_site|artifacts|live-src)\//.test(file);
const git = (root,args) => new Promise((resolve,reject) => {
  execFile('git',args,{cwd:root,encoding:'buffer',windowsHide:true,maxBuffer:64*1024*1024},
    (error,stdout) => error ? reject(error) : resolve(stdout));
});
function add(hash, name, data) {
  hash.update(String(Buffer.byteLength(name))+':'+name+':'+data.length+':');
  hash.update(data);
}
async function optionalFile(file) {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return Buffer.from('<missing>'); throw error; }
}
async function packageRoot(entry) {
  let dir = path.dirname(await realpath(entry));
  while (true) {
    try { await readFile(path.join(dir,'package.json')); return dir; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Parser package root missing');
    dir = parent;
  }
}
async function packageFiles(dir, seen = new Set()) {
  const actual=await realpath(dir), found=[];
  if (seen.has(actual)) return found;
  seen.add(actual);
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    const kind=entry.isSymbolicLink() ? await stat(file) : entry;
    if (kind.isDirectory() && entry.name !== 'node_modules') found.push(...await packageFiles(file,seen));
    else if (kind.isFile() && (/\.(?:[cm]?js|json|node|wasm|exe)$/.test(entry.name) || entry.name === 'esbuild')) found.push(file);
  }
  return found;
}

async function dependencyFiles(root) {
  const resolver=createRequire(path.join(root,'package.json')), queue=['acorn','eslint-scope','typescript-eslint','typescript','esbuild','react','react-dom',`@esbuild/${process.platform}-${process.arch}/package.json`];
  const seen=new Set(), files=[];
  while (queue.length) {
    const request=queue.shift();
    let entry;
    try { entry=resolver.resolve(request); } catch { throw new Error('Parser dependency missing: '+request); }
    const dir=await packageRoot(entry);
    if (seen.has(dir)) continue;
    seen.add(dir);
    const manifest=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
    files.push(...await packageFiles(dir));
    const local=createRequire(path.join(dir,'package.json'));
    for (const name of Object.keys(manifest.dependencies || {})) {
      if (name.startsWith('@types/')) continue;
      try { queue.push(local.resolve(name)); } catch { throw new Error('Parser dependency missing: '+name); }
    }
  }
  return files.sort();
}
async function addFiles(hash, root, files) {
  const contents=await Promise.all(files.map(file => optionalFile(path.isAbsolute(file) ? file : path.join(root,file))));
  for (let index=0; index<files.length; index++) add(hash,files[index],contents[index]);
}
export async function engineeringFingerprint(root) {
  const [head,worktree,index,status,untracked,dependencies] = await Promise.all([
    git(root,['rev-parse','HEAD']),
    git(root,['diff','--binary','--no-ext-diff','--no-renames','HEAD','--']),
    git(root,['diff','--binary','--no-ext-diff','--no-renames','--cached','HEAD','--']),
    git(root,['status','--porcelain=v1','-z','--untracked-files=all']),
    git(root,['ls-files','--others','--exclude-standard','-z']), dependencyFiles(root),
  ]);
  const hash=createHash('sha256');
  for (const [name,value] of [['head',head],['worktree',worktree],['index',index],['status',status]]) add(hash,name,value);
  const execution = {version:process.version, platform:process.platform, arch:process.arch, execArgv:process.execArgv};
  const environment = Object.fromEntries(['NODE_OPTIONS','NODE_PATH','TSESTREE_SINGLE_RUN','ESLINT_USE_FLAT_CONFIG'].map(key => [key,process.env[key] || '']));
  add(hash,'node',Buffer.from(JSON.stringify({execution,environment,root}))); 
  add(hash,'ci-event',process.env.GITHUB_EVENT_PATH ? await readFile(process.env.GITHUB_EVENT_PATH) : Buffer.from(''));
  const files=untracked.toString('utf8').split('\0').filter(file=>file && sourceFile(file)).sort();
  await addFiles(hash,root,[...new Set([...rules,...files,...dependencies])].sort());
  return hash.digest('hex');
}
async function proofKey(root, create) {
  const file=path.join(root,keyPath);
  if (create) {
    await mkdir(path.dirname(file),{recursive:true});
    try { await writeFile(file,randomBytes(32),{flag:'wx',mode:0o600}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const key=await readFile(file);
  if (key.length !== 32) throw new Error('Engineering proof key is invalid');
  return key;
}
const signature = (key,digest) => createHmac('sha256',key).update('gnc-engineering-proof-v1\0'+digest).digest('hex');
async function writeEngineeringProof(root, digest) {
  const key=await proofKey(root,true), data=JSON.stringify({version:1,digest,signature:signature(key,digest)})+'\n';
  const file=path.join(root,proofPath), temp=file+'.'+process.pid+'.tmp';
  await writeFile(temp,data,{mode:0o600});
  await rename(temp,file);
}
export async function validateAndWriteEngineeringProof(root) {
  const {engineeringFailures}=await import('./engineering-validator.mjs');
  const before=await engineeringFingerprint(root), issues=await engineeringFailures(root);
  if (issues.length) throw new Error(issues.join('\n'));
  const after=await engineeringFingerprint(root);
  if (before !== after) throw new Error('Engineering inputs changed during validation; run the lock again');
  await writeEngineeringProof(root,after);
}
export async function engineeringProofFailures(root) {
  try {
    const [digest,key,data]=await Promise.all([engineeringFingerprint(root),proofKey(root,false),readFile(path.join(root,proofPath),'utf8')]);
    const proof=JSON.parse(data), expected=signature(key,digest);
    if (proof.version !== 1 || proof.digest !== digest || !/^[a-f0-9]{64}$/.test(proof.signature || '')) throw new Error('stale');
    if (!timingSafeEqual(Buffer.from(proof.signature,'hex'),Buffer.from(expected,'hex'))) throw new Error('invalid');
    return [];
  } catch { return ['Engineering proof missing, stale or invalid; run node scripts/anti-spaghetti-lock.mjs']; }
}
