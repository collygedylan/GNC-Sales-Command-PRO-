import assert from 'node:assert/strict';
import vm from 'node:vm';

export async function workerActivationContract(read) {
  const worker=read('sw.js');
  const activation=worker.match(/self\.addEventListener\('activate', \(event\) => \{[^]*?^\}\);/m)?.[0];
  assert.ok(activation,'activation listener exists');
  const retired=[];let listener, navigation=0, clients=[];
  const client={url:'https://agmetricapp.com/?shellv=AgData+v2.3.97',navigate:()=>{navigation++;return new Promise(()=>{});}};
  clients=[client];
  const context=vm.createContext({Promise,URL,self:{
    addEventListener:(type,handler)=>{if(type==='activate') listener=handler;},
    location:{href:'https://agmetricapp.com/sw.js'},
    registration:{scope:'https://agmetricapp.com/',navigationPreload:{disable:()=>Promise.resolve()}},
    clients:{claim:()=>Promise.resolve(),matchAll:async()=>clients},
  },caches:{keys:async()=>['agdata-v2.3.97','agdata-v2.3.100'],delete:async key=>{retired.push(key);return true;}},
    hasCompleteShellInstall:async()=>true,
    isRetiredRootCacheName:key=>key!=='agdata-v2.3.100',broadcastShellVersion:async type=>assert.equal(type,'GNC_SHELL_ACTIVATED'),
  });
  const urlHelpers=read('assets/service-worker-url.js');
  vm.runInContext(urlHelpers+'\n'+activation,context);
  let work;listener({waitUntil:promise=>{work=promise;}});
  const completed=await Promise.race([work.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),100))]);
  assert.equal(completed,true);assert.equal(navigation,0);
  assert.deepEqual(retired,[],'active production tabs retain their old versioned assets');
  clients=[];listener({waitUntil:promise=>{work=promise;}});await work;
  assert.deepEqual(retired,['agdata-v2.3.97'],'old caches retire after production tabs close');
  assert.match(worker,/navigateInactiveClientToCurrentShell\(event\.clientId, 'inactive-network-activity'\)/);
}
