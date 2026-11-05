import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildTestRuntime } from './build-runtime.mjs';

export async function prepareTestSite(repositoryRoot) {
 await buildTestRuntime(repositoryRoot);
 const source=path.join(repositoryRoot,'test'),destination=path.join(repositoryRoot,'_site/test');
 const rootFiles=new Set(['index.html','manifest.json','sw-test.js','version.json','deployment.json','deployment-fingerprint.json','version-parity.json']);
 const publicDirectories=new Set(['assets','services','utils','components','reports','v2']);
 const publicExtensions=/\.(html|js|mjs|css|json|webmanifest|svg|png|webp|jpg|jpeg|gif|ico|woff2?|ttf|pdf|wasm)$/i;
 const files=[];
 async function visit(directory,relative=''){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   const rel=path.join(relative,entry.name),top=rel.split(path.sep)[0];
   if(entry.isSymbolicLink())throw Error('TEST_PUBLIC_SYMLINK_FORBIDDEN');
   if(entry.isDirectory()){if(publicDirectories.has(top))await visit(path.join(directory,entry.name),rel);}
   else if((rootFiles.has(rel)||publicDirectories.has(top)||(!relative&&/\.(png|webp|svg|ico)$/.test(entry.name)))&&publicExtensions.test(entry.name))files.push(rel);
  }
 }
 await visit(source);await fs.mkdir(destination,{recursive:true});
 const digest=crypto.createHash('sha256');
 for(const relative of files.sort()){
  const bytes=await fs.readFile(path.join(source,relative));
  if(/\.(js|mjs|json|html)$/.test(relative)&&/sb_secret_[A-Za-z0-9_-]{20,}|"role"\s*:\s*"service_role"|sbp_[a-f0-9]{20}/.test(bytes.toString('utf8')))throw Error('TEST_PUBLIC_SECRET_PATTERN');
  digest.update(relative.replaceAll('\\','/')).update(bytes);
  await fs.mkdir(path.dirname(path.join(destination,relative)),{recursive:true});
  await fs.writeFile(path.join(destination,relative),bytes);
 }
 const fingerprint=digest.digest('hex');
 const shell=files.filter(f=>/\.(js|mjs|css)$/.test(f)||rootFiles.has(f)&&f!=='sw-test.js'||f.replaceAll('\\','/').startsWith('assets/test/icon-')).map(f=>'./'+f.replaceAll('\\','/'));
 let worker=await fs.readFile(path.join(source,'sw-test.js'),'utf8');
 worker=worker.replace(/const CACHE = [^;]+;/,()=>`const CACHE = 'agdata-test:standalone-${fingerprint.slice(0,12)}';`);
 worker=worker.replace(/const SHELL = [^;]+;/,()=>`const SHELL = ${JSON.stringify(shell)};`);
 await fs.writeFile(path.join(destination,'sw-test.js'),worker);
 const artifact={environment:'agdata-test',project:'apztnscvagayslumnalr',files:files.length,sha256:fingerprint};
 const donor=JSON.parse(await fs.readFile(path.join(source,'deployment.json'),'utf8'));
 await fs.writeFile(path.join(destination,'deployment.json'),JSON.stringify({...donor,testArtifact:artifact})+'\n');
 return artifact;
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)console.log(JSON.stringify(await prepareTestSite(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'))));
