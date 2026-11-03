import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { classifyReleasePaths, changedReleasePaths } from './release-scope.mjs';

const workflow='pages-static.yml';
const shaPattern=/^[a-f0-9]{40}$/;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function isTransientWorkflowFailure(run,logs='') {
  if(/not ok \d|AssertionError|RELEASE_[A-Z_]*MISMATCH|error TS\d|TypeError:|SyntaxError:/.test(logs))return false;
  return run.conclusion==='startup_failure'||/runner (?:has )?lost communication|runner failed to start|failed to acquire a runner|GitHub Actions service.*(?:unavailable|503)|infrastructure failure/i.test(logs);
}
export async function recoverVerifiedPublication({sha,version,runs,readLive,hasFrontendDiff,isAncestor,dispatch,rerun,failureLogs,wait=pause,now=Date.now,assertMain=async()=>{},finalize,progress=()=>{},maxPolls=180}) {
  const dispatched=new Set(),retried=new Map(),discoveryDeadline=now()+30000;let last='';
  for(let poll=0;poll<maxPolls;poll++){
    await assertMain();const list=(await runs()).filter(r=>r.head_sha===sha&&r.head_branch==='main').sort((a,b)=>b.id-a.id),run=list[0];
    if(!run){
      // GitHub's run index can lag the push, including pushes made before this helper starts.
      const remaining=discoveryDeadline-now();
      if(remaining>0){await wait(Math.min(3000,remaining));continue;}
      if(!dispatched.has('initial')){await dispatch('');dispatched.add('initial');}await wait(10000);continue;
    }
    const state=run.id+':'+run.run_attempt+':'+run.status+':'+run.conclusion;if(state!==last){progress({run:run.id,status:run.status,conclusion:run.conclusion});last=state;}
    if(run.status!=='completed'||retried.get(run.id)?.attempt===run.run_attempt){await wait(10000);continue;}
    if(run.conclusion!=='success'){
      const prior=retried.get(run.id);if((prior?.count||0)>=2||!isTransientWorkflowFailure(run,await failureLogs(run)))throw Error('RELEASE_CI_FAILED:'+run.id);
      await rerun(run);retried.set(run.id,{attempt:run.run_attempt,count:(prior?.count||0)+1});await wait(10000);continue;
    }
    let live;try{live=await readLive();}catch{await wait(10000);continue;}
    if(live.release==='AgData v'+version&&(live.commit===sha||!await hasFrontendDiff(live.commit,sha))){await assertMain();await finalize({run,live,sha,version});return {runId:run.id,sha,version,liveCommit:live.commit};}
    if(!shaPattern.test(live.commit)||!await isAncestor(live.commit,sha))throw Error('RELEASE_LIVE_BASE_INVALID');
    const key=live.commit;if(!dispatched.has(key)){await dispatch(key);dispatched.add(key);progress({recoveryBase:key});}await wait(10000);
  }
  throw Error('RELEASE_PUBLICATION_WAIT_EXPIRED');
}
export function releaseStateLines({version,sha,runId,liveCommit,browser,at=new Date().toISOString()}) {
  return [
    'Live release: AgData v'+version+'; verified '+at+'.',
    'Commit: '+sha+'; origin/main synchronized.',
    'Pages: GREEN run '+runId+'; live frontend '+liveCommit+'.',
    'Supabase: public.ph_app_settings verified '+version+'.',
    'Version parity: source, staged source and prepared artifact are checked before commit.',
    'Recovery: actual live fingerprints verified; no duplicate source commit is required.',
    browser?.pass?'Chromium: '+browser.browserSeconds+' seconds; '+browser.bunch?.saveMilliseconds+' ms approval; reload persistence '+!!browser.bunch?.reloadPersisted+'.':'Browser: no matching local browser receipt was supplied to this helper.',
    browser?.pass?'Identities: '+browser.bunch?.totalIdentities+' complete; block-only '+browser.bunch?.blockOnly+'; console/page/HTTP errors '+(browser.errors.length+browser.consoleErrors.length+browser.httpErrors.length)+'.':'Checks: exact-commit Pages workflow and live descriptor verified.',
    'Limits: historical migration identifiers and explicit Apps Script release pins are preserved.',
    'Next: none required; publication is idempotently resumable.'
  ];
}
export function writeReleaseState(root,lines){if(lines.length!==10||lines.some(line=>/[\r\n]/.test(line)))throw Error('RELEASE_STATE_INVALID');const directory=path.join(root,'.gnc-local');fs.mkdirSync(directory,{recursive:true});const pending=path.join(directory,'latest-state.md.pending');try{fs.writeFileSync(pending,lines.join('\n')+'\n');fs.renameSync(pending,path.join(directory,'latest-state.md'));}catch(error){if(fs.existsSync(pending))fs.writeFileSync(pending,'');throw error;}}
export async function finalizeVerifiedRelease({version,sha,runId,liveCommit,updateSetting,verifySetting,saveState}){try{await updateSetting(version);}catch(error){if(error.message!=='RELEASE_SETTING_CONCURRENT_CHANGE'||await verifySetting()!==version)throw error;}if(await verifySetting()!==version)throw Error('RELEASE_SETTING_MISMATCH');await saveState({version,sha,runId,liveCommit});}
function envFile(root){try{return Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(line=>/^[A-Z_]+\s*=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at).trim(),line.slice(at+1).trim().replace(/^['"]|['"]$/g,'')];}));}catch{return {};}}
export function assertReleaseAdvance(current,target){const valid=/^\d+\.\d+\.\d+$/;if(!valid.test(current)||!valid.test(target))throw Error('RELEASE_SETTING_VERSION_INVALID');const a=current.split('.').map(Number),b=target.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]>b[i])throw Error('RELEASE_SETTING_NEWER');if(a[i]<b[i])return;} }
async function settingsClient(root){
  const local=envFile(root),base=process.env.PRODUCTION_SUPABASE_URL||process.env.SUPABASE_URL,key=process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(base&&key){const url=new URL(base);if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co'))throw Error('RELEASE_SUPABASE_ORIGIN_INVALID');const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'};
    const call=async(query,method='GET',body)=>{const r=await fetch(base+'/rest/v1/ph_app_settings?'+query,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('RELEASE_SETTINGS_HTTP_'+r.status);return r.json();};
    return {read:async()=>(await call('key=eq.app_version&select=value'))[0]?.value?.app_version,update:async version=>{const row=(await call('key=eq.app_version&select=value'))[0];if(row?.value?.app_version===version)return;const prior=row?.value?.app_version;if(!prior)throw Error('RELEASE_SETTING_MISSING');assertReleaseAdvance(prior,version);const rows=await call('key=eq.app_version&value->>app_version=eq.'+encodeURIComponent(prior),'PATCH',{value:{...row.value,app_version:version,release:'AgData v'+version},updated_by:'release-v'+version,updated_at:new Date().toISOString()});if(rows.length!==1)throw Error('RELEASE_SETTING_CONCURRENT_CHANGE');},close:async()=>{}};
  }
  const connection=process.env.GNC_SUPABASE_DB_URL||local.GNC_SUPABASE_DB_URL;if(!connection)throw Error('RELEASE_DATABASE_CREDENTIAL_REQUIRED');const url=new URL(connection);const linked=fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim();if(!url.hostname.includes(linked)&&!decodeURIComponent(url.username).includes(linked))throw Error('RELEASE_DATABASE_LINK_MISMATCH');url.searchParams.delete('sslmode');const client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});await client.connect();
  return {read:async()=>(await client.query("select value->>'app_version' as version from public.ph_app_settings where key='app_version'")).rows[0]?.version,update:async version=>{const current=(await client.query("select value from public.ph_app_settings where key='app_version'")).rows[0]?.value;if(current?.app_version===version)return;if(!current)throw Error('RELEASE_SETTING_MISSING');assertReleaseAdvance(current.app_version,version);const result=await client.query("update public.ph_app_settings set value=value||jsonb_build_object('app_version',$1::text,'release','AgData v'||$1::text),updated_by='release-v'||$1::text,updated_at=now() where key='app_version' and value->>'app_version'=$2",[version,current.app_version]);if(result.rowCount!==1)throw Error('RELEASE_SETTING_CONCURRENT_CHANGE');},close:()=>client.end()};
}
async function run(){
  const root=process.cwd(),args=process.argv.slice(2);if(args.some(a=>!['--detach','--no-push'].includes(a)))throw Error('RELEASE_PUBLICATION_ARGUMENT_INVALID');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const frontendOnly=manifest.frontendOnlyRelease?.version===manifest.version;
  const evidence=frontendOnly ? path.join(root,'.gnc-local') : process.env.RELEASE_EVIDENCE_DIR||(process.platform==='win32'?'G:/My Drive/GNC/AgData/Release Evidence':process.env.RUNNER_TEMP||root);fs.mkdirSync(evidence,{recursive:true});
  if(args.includes('--detach')){const log=path.join(evidence,'release-publication.log'),fd=fs.openSync(log,'a');const child=spawn(process.execPath,[process.argv[1],...args.filter(a=>a!=='--detach')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:process.env});child.unref();fs.closeSync(fd);console.log(JSON.stringify({pid:child.pid,log}));return;}
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}).trim();
  if(git(['status','--porcelain','--untracked-files=no']))throw Error('RELEASE_WORKSPACE_DIRTY');git(['fetch','origin','main']);const sha=git(['rev-parse','HEAD']),origin=git(['rev-parse','origin/main']);
  if(sha!==origin){if(args.includes('--no-push'))throw Error('RELEASE_MAIN_MISMATCH');git(['merge-base','--is-ancestor',origin,sha]);git(['push','origin','HEAD:main']);}
  const repository=process.env.GITHUB_REPOSITORY||git(['remote','get-url','origin']).replace(/\.git$/,'').match(/github\.com[:/]([^/]+\/[^/]+)$/)?.[1];if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw Error('RELEASE_REPOSITORY_INVALID');
  let token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;if(!token){const credential=execFileSync('git',['credential','fill'],{cwd:root,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});token=credential.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);}if(!token)throw Error('RELEASE_GITHUB_CREDENTIAL_REQUIRED');
  const gh=args=>execFileSync('gh',[...args],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,GH_TOKEN:token,GH_REPO:repository},maxBuffer:48*1024*1024});const api=endpoint=>JSON.parse(gh(['api',endpoint]));
  const assertMain=async()=>{if(api('repos/'+repository+'/git/ref/heads/main').object.sha!==sha)throw Error('RELEASE_MAIN_SUPERSEDED');};
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  const readLive=async()=>{const data=await Promise.all(['deployment-fingerprint.json','deployment.json'].map(async file=>{const r=await fetch('https://agmetricapp.com/'+file+'?verify='+sha,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('RELEASE_LIVE_UNAVAILABLE');return r.json();}));if(data[0].release!==data[1].release||data[0].commit!==data[1].commit)throw Error('RELEASE_LIVE_DESCRIPTORS_DISAGREE');return data[0];};
  const outcome=await recoverVerifiedPublication({sha,version,assertMain,runs:async()=>{
    const list=JSON.parse(gh(['run','list','--commit',sha,'--workflow','Deploy static app to Pages','--branch','main','--limit','10','--json','databaseId']));
    // Keep the authoritative run_attempt for bounded infrastructure-only retries.
    return list.length?[api('repos/'+repository+'/actions/runs/'+Math.max(...list.map(run=>run.databaseId)))]:[];
  },
    readLive,hasFrontendDiff:async(before,after)=>classifyReleasePaths(changedReleasePaths({rootDir:root,before,after})).deploy.frontend,isAncestor:async(before,after)=>{try{git(['merge-base','--is-ancestor',before,after]);return true;}catch{return false;}},
    dispatch:async base=>{const args=['workflow','run',workflow,'--ref','main','-f','expected-commit='+sha];if(base)args.push('-f','base-commit='+base);gh(args);},rerun:async run=>gh(['run','rerun',String(run.id)]),failureLogs:async run=>gh(['run','view',String(run.id),'--log-failed']),progress:entry=>console.log(JSON.stringify(entry)),
    finalize:async({run,live})=>{
      if(frontendOnly){
        if(live.commit!==sha)throw Error('RELEASE_FRONTEND_COMMIT_MISMATCH');
        const lines=releaseStateLines({version,sha,runId:run.id,liveCommit:live.commit});
        lines[3]='Backend: frontend-only release; app-api pinned at '+manifest.frontendOnlyRelease.appApiVersion+'.';
        writeReleaseState(root,lines);
        return;
      }
      const settings=await settingsClient(root);try{await finalizeVerifiedRelease({version,sha,runId:run.id,liveCommit:live.commit,updateSetting:settings.update,verifySetting:settings.read,saveState:async data=>{let browser;try{const receipt=JSON.parse(fs.readFileSync(path.join(evidence,'table-management-browser-proof.json'),'utf8'));if(receipt.release===version&&receipt.pass)browser=receipt;}catch{}writeReleaseState(root,releaseStateLines({...data,browser}));await fs.promises.writeFile(path.join(evidence,'verified-release-publication.json'),JSON.stringify({...data,verifiedAt:new Date().toISOString()},null,2)+'\n');}});}finally{await settings.close();}}
  });console.log(JSON.stringify({published:true,...outcome}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await run();}catch(error){console.error(JSON.stringify({published:false,error:String(error.message||'').startsWith('RELEASE_')?error.message:error.code||'RELEASE_PUBLICATION_FAILED'}));process.exitCode=1;}}
