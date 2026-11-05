import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence='G:/My Drive/GNC/AgData/Release Evidence';
const project='apztnscvagayslumnalr';
const cli=path.join(root,'node_modules/.deno/supabase@2.111.0/node_modules/supabase/dist/supabase.js');
const functions=['test-app-api','test-aura-query','test-aura-llm-router','test-inventory-assistant','test-auth-admin','test-hl-po-pdf-import','test-email-worker','test-request-delivery-worker','test-photo-proxy','test-codex-ops-api','test-send-push-alert'];
const token=(await fs.readFile(path.join(root,'.gnc-local/test-management-token'),'utf8')).trim();
const results=[];
async function run(name,executable,args){
  const file=await fs.open(path.join(evidence,'agdata-'+name+'.log'),'w');const start=Date.now();
  const exit=await new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:root,env:{...process.env,SUPABASE_ACCESS_TOKEN:token},windowsHide:true,stdio:['ignore',file.fd,file.fd]});child.on('error',reject);child.on('exit',resolve);});await file.close();
  results.push({name,exit,elapsedMs:Date.now()-start});await fs.writeFile(path.join(evidence,'agdata-test-edge-deployment.json'),JSON.stringify({project,results},null,2));
  if(exit!==0)throw Error(name+' failed; see retained log');
}
await run('test-edge-types',path.join(root,'node_modules/deno/deno.exe'),['check',...functions.map(n=>path.join(root,'test/supabase/functions',n,'index.ts'))]);
await run('test-secrets','node',[cli,'secrets','set','--project-ref',project,'--env-file',path.join(root,'.gnc-local/test-secrets.env')]);
for(const name of functions) await run(name,'node',[cli,'functions','deploy',name,'--project-ref',project,'--workdir',path.join(root,'test'),'--no-verify-jwt','--use-api']);
console.log(JSON.stringify({project,deployed:functions.length,complete:true}));
