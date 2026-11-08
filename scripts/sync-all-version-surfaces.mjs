import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const semantic = /^\d+\.\d+\.\d+$/;
const required = ['version.json','src/ui/ops-pilot-state.js','package.json','package-lock.json','index.html','manifest.json','sw.js','assets/app-runtime.js','supabase/functions/app-api/index.ts','scripts/build-live-shell.mjs','v2/public/manifest.webmanifest','v2/src/services/api.ts','docs/architecture/agdata-symbol-index.json'];
const candidate = file => required.includes(file) || /^(?:assets\/[^/]+\.js|supabase\/functions\/.*\.(?:ts|mjs)|scripts\/.*\.mjs|tests\/.*\.mjs)$/.test(file);
const tokens = /(?<!\d)(\d+)(\\{0,2})\.(\d+)\2\.(\d+)(?:\.(\d+))?/g;
const currentMarker = /\b(?:APP_RUNTIME_VERSION|APP_RUNTIME_RELEASE|APP_SHELL_VERSION|APP_SHELL_BUILD|APP_VERSION|__APP_SHELL_VERSION__|__APP_RELEASE_VERSION__|CURRENT_RELEASE_VERSION)\b|\bconst\s+\w*RELEASE\w*\s*=/;
const ignored = file => /(?:^|\/)(?:vendor|node_modules|dist|historical-requests-chunks|assigned-items-chunks|field-counting-chunks)\//.test(file);
export function versionPaths(root, staged=false) {
  return execFileSync('git',['ls-files','-z',...(staged?[]:['--cached','--others','--exclude-standard'])],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}).split('\0').filter(Boolean).filter(file=>candidate(file)&&!ignored(file)).filter((f,i,a)=>a.indexOf(f)===i).sort();
}
let stagedRoot='',stagedSources=new Map();
export function decodeStagedBatch(buffer,entries){let offset=0;const result=new Map();for(const entry of entries){const end=buffer.indexOf(10,offset);if(end<0)throw Error('RELEASE_INDEX_BATCH_INVALID');const header=buffer.subarray(offset,end).toString('ascii').match(/^([a-f0-9]{40}) blob (\d+)$/);if(!header||header[1]!==entry.sha)throw Error('RELEASE_INDEX_BATCH_INVALID');const start=end+1,size=Number(header[2]);if(start+size>=buffer.length||buffer[start+size]!==10)throw Error('RELEASE_INDEX_BATCH_INVALID');result.set(entry.file,buffer.subarray(start,start+size).toString('utf8'));offset=start+size+1;}if(offset!==buffer.length)throw Error('RELEASE_INDEX_BATCH_INVALID');return result;}
function readStagedSources(root,files){const wanted=new Set(files),entries=execFileSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).split('\0').filter(Boolean).map(line=>{const match=line.match(/^(\d+) ([a-f0-9]{40}) (\d)\t(.+)$/);if(!match)throw Error('RELEASE_INDEX_ENTRY_INVALID');return {mode:match[1],sha:match[2],stage:match[3],file:match[4]};}).filter(entry=>wanted.has(entry.file));if(entries.some(entry=>entry.stage!=='0'||!['100644','100755'].includes(entry.mode)))throw Error('RELEASE_INDEX_UNMERGED_OR_SYMLINK');const batch=execFileSync('git',['cat-file','--batch'],{cwd:root,input:entries.map(entry=>entry.sha+'\n').join(''),windowsHide:true,maxBuffer:256*1024*1024});return decodeStagedBatch(batch,entries);}
function sourceAt(root,file,staged){if(!staged)return fs.readFileSync(path.join(root,file),'utf8');if(stagedRoot!==root||!stagedSources.has(file))throw Error('RELEASE_INDEX_SURFACE_MISSING:'+file);return stagedSources.get(file);}
export function transformVersionSurface(file, source, version, previousVersion) {
  if (!semantic.test(version)) throw Error('RELEASE_VERSION_INVALID');
  if(file==='version.json') {const value=JSON.parse(source);value.version=version;value.release='AgData v'+version;return JSON.stringify(value,null,2)+'\n';}
  if(file==='package.json'||file==='package-lock.json') {const value=JSON.parse(source);value.version=version;if(file==='package-lock.json')value.packages[''].version=version;return JSON.stringify(value,null,2)+'\n';}
  if(file==='docs/architecture/agdata-symbol-index.json'){const value=JSON.parse(source);value.release='AgData v'+version;return JSON.stringify(value,null,2)+'\n';}
  if(file==='manifest.json'||file==='v2/public/manifest.webmanifest'){const value=JSON.parse(source),old=value.version;return source.replaceAll(old,'AgData v'+version).replaceAll(encodeURIComponent(old),encodeURIComponent('AgData v'+version));}
  // Source-history comments, migration/RPC names, library versions and the explicit
  // Apps Script pin are contracts, not current application release markers.
  return source.split('\n').map(line=>{
    if(/^\s*(?:\/\/|\*|\/\*)/.test(line))return line;
    const fixture=/^(?:tests\/|scripts\/enforce-all-14-gems-gate)/.test(file),active=!file.startsWith('tests/')&&currentMarker.test(line);
    return line.replace(tokens,(raw,major,slashes,minor,patch,hotfix)=>{
      const plain=major+'.'+minor+'.'+patch;
      const recent=Number(major)===2&&Number(minor)===3&&Number(patch)>=128;
      if(!(active||plain===previousVersion||recent&&(fixture||/AgData(?:%20| )v|[?&]v=|shellv=/.test(line))))return raw;
      return version.split('.').join(slashes+'.')+(hotfix?'.'+hotfix:'');
    });
  }).join('\n');
}
export function planVersionSync({root=process.cwd(),version,staged=false,files=versionPaths(root,staged)}={}) {
  if(staged){stagedRoot=root;stagedSources=readStagedSources(root,[...files,'Code.gs']);}
  const pkg=JSON.parse(sourceAt(root,'package.json',staged));version=version||pkg.version;
  if(!semantic.test(version))throw Error('RELEASE_VERSION_INVALID');
  for(const file of required)if(!files.includes(file))throw Error('RELEASE_SURFACE_MISSING:'+file);
  const edgePin = pkg.frontendOnlyRelease?.version === version ? pkg.frontendOnlyRelease.appApiVersion : null;
  const edits=files.map(file=>{
    const before=sourceAt(root,file,staged);
    if (edgePin && file === 'supabase/functions/app-api/index.ts') {
      if (!semantic.test(edgePin) || !before.includes('const APP_RUNTIME_VERSION = "' + edgePin + '"')
          || !before.includes('const APP_RUNTIME_RELEASE = "AgData v' + edgePin + '"')) throw Error('RELEASE_APP_API_PIN_MISMATCH');
      return {file,before,after:before};
    }
    return {file,before,after:transformVersionSurface(file,before,version,pkg.version)};
  }).filter(edit=>edit.before!==edit.after);
  if(pkg.appsScriptRelease){const source=sourceAt(root,'Code.gs',staged);if(source.match(/const APP_RELEASE_VERSION_\s*=\s*['"]([^'"]+)['"]/)?.[1]!==pkg.appsScriptRelease)throw Error('RELEASE_APPS_SCRIPT_PIN_MISMATCH');}
  return {version,files,edits};
}
export function versionSourceDigest(root,files,staged=false){const hash=createHash('sha256');for(const file of files)hash.update(file+'\0'+sourceAt(root,file,staged).replaceAll('\r\n','\n')+'\0');return hash.digest('hex');}
export function assertPreparedVersionParity({version,sourceDigest,read}) {
 const receipt=JSON.parse(read('version-parity.json'));if(receipt.version!==version||receipt.sourceDigest!==sourceDigest)throw Error('RELEASE_SITE_SOURCE_MISMATCH');
 for(const file of ['index.html','assets/app-runtime.js','manifest.json','sw.js','v2/manifest.webmanifest']){const source=read(file);if(!source.includes('AgData v'+version)&&!source.includes('AgData%20v'+version))throw Error('RELEASE_SITE_VERSION_MISMATCH:'+file);const sourceFile=file==='v2/manifest.webmanifest'?'v2/public/manifest.webmanifest':file;if(transformVersionSurface(sourceFile,source,version,version)!==source)throw Error('RELEASE_SITE_VERSION_MISMATCH:'+file);}
 return true;
}
export function assertVersionParity({root=process.cwd(),staged=false,requireSite=false}={}) {
  const plan=planVersionSync({root,staged});if(plan.edits.length)throw Error('RELEASE_VERSION_MISMATCH:'+plan.edits.map(e=>e.file).join(','));
  if(requireSite){
    const site=path.join(root,'_site'),receiptPath=path.join(site,'version-parity.json');
    if(!fs.existsSync(receiptPath))throw Error('RELEASE_SITE_NOT_PREPARED');
    assertPreparedVersionParity({version:plan.version,sourceDigest:versionSourceDigest(root,plan.files,staged),read:file=>fs.readFileSync(path.join(site,file),'utf8')});
  }
  return {version:plan.version,surfaces:plan.files.length,artifact:requireSite};
}
export function applyVersionTransaction(edits,{write=fileWrite,verify=()=>{}}={}) {
  const written=[];try{for(const edit of edits){written.push(edit);write(edit.file,edit.after);}return verify();}
  catch(error){const failures=[];for(const edit of written.reverse())try{write(edit.file,edit.before);}catch(rollback){failures.push(rollback);}if(failures.length)throw new AggregateError([error,...failures],'RELEASE_ROLLBACK_FAILED');throw error;}
}
function fileWrite(file,source){fs.writeFileSync(file,source);}
export function syncVersionSources({root=process.cwd(),version,check=false}={}) {
  const plan=planVersionSync({root,version});if(check){if(plan.edits.length)throw Error('RELEASE_VERSION_MISMATCH:'+plan.edits.map(e=>e.file).join(','));return 'AgData v'+plan.version;}
  applyVersionTransaction(plan.edits,{write:(file,value)=>fs.writeFileSync(path.join(root,file),value),verify:()=>assertVersionParity({root})});return 'AgData v'+plan.version;
}
export async function synchronizeRelease({root=process.cwd(),version,prepare}={}) {
  const plan=planVersionSync({root,version});let prepared=false;
  applyVersionTransaction(plan.edits,{write:(file,value)=>fs.writeFileSync(path.join(root,file),value),verify:()=>{
    assertVersionParity({root});
    if(prepare)prepare();else{
      const dir=process.env.RELEASE_EVIDENCE_DIR||(process.platform==='win32'?'G:/My Drive/GNC/AgData/Release Evidence':process.env.RUNNER_TEMP||root);fs.mkdirSync(dir,{recursive:true});const log=path.join(dir,'version-sync-preparation.log'),fd=fs.openSync(log,'w');
      try{execFileSync(process.execPath,['scripts/prepare-release-site.mjs'],{cwd:root,stdio:['ignore',fd,fd],windowsHide:true,env:{...process.env,DEPLOYMENT_COMMIT:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}});}finally{fs.closeSync(fd);}
    }
    const receipt={version:plan.version,sourceDigest:versionSourceDigest(root,plan.files),surfaces:plan.files.length};fs.writeFileSync(path.join(root,'_site','version-parity.json'),JSON.stringify(receipt,null,2)+'\n');assertVersionParity({root,requireSite:true});prepared=true;
  }});
  return {version:plan.version,updated:plan.edits.length,surfaces:plan.files.length,prepared};
}
export function parseVersionArguments(args){let version,check=false,staged=false,requireSite=false;for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--version')version=args[++i];else if(arg==='--check')check=true;else if(arg==='--staged')staged=true;else if(arg==='--require-site')requireSite=true;else if(semantic.test(arg)&&!version)version=arg;else throw Error('Usage: sync-all-version-surfaces.mjs [--version] X.Y.Z [--check --staged --require-site]');}if(version!==undefined&&!semantic.test(version))throw Error('RELEASE_VERSION_INVALID');return {version,check,staged,requireSite};}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const args=parseVersionArguments(process.argv.slice(2));const result=args.check?assertVersionParity(args):await synchronizeRelease(args);console.log(JSON.stringify(result));}
