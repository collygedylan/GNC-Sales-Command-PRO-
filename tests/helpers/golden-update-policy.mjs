import assert from 'node:assert/strict';
import vm from 'node:vm';
import { harness, origin } from './root-service-worker-fixture.mjs';
import { indexReleaseDeclarations } from './release-gems-declarations.mjs';

export async function invariant41({read, expectedAppApiVersion}) {
  const lifecycle = read('assets/app-lifecycle.js'), update = read('assets/live-app-update.js');
  const shell = read('index.html'), worker = read('sw.js'), api = read('supabase/functions/app-api/index.ts');
  assert.match(lifecycle, /forceAgDataVersionUpgrade[^]*requestLiveAppUpdate/);
  assert.match(lifecycle, /checkAgDataVersion[^]*checkForLiveAppUpdate/);
  assert.match(update, /isAppUpdateSnapshotCurrent[^]*commitAppUpdateSnapshotForReload/);
  assert.doesNotMatch(update, /caches\.delete|localStorage\.clear|sessionStorage\.clear/);
  assertRetiredTestRegistrationPolicy(update);
  const version = JSON.parse(read('version.json')).version;
  const lifecycleTag = shell.indexOf(`src="./assets/app-lifecycle.js?v=${version}" data-app-lifecycle`);
  const updateTag = shell.indexOf(`src="./assets/live-app-update.js?v=${version}" data-live-app-update`);
  assert.ok(lifecycleTag >= 0 && updateTag > lifecycleTag, 'versioned update scripts must load in shell order');
  assert.match(worker, /self\.clients\.claim\(\)[^]*broadcastShellVersion\('GNC_SHELL_ACTIVATED'\)/);
  assert.match(worker, /async function navigateClientToForcedUpgrade[^]*client\.postMessage/);
  assert.ok(api.includes('APP_RUNTIME_VERSION = "' + expectedAppApiVersion() + '"'));
  assert.match(api, /"X-AgData-App-Version": APP_RUNTIME_VERSION/);
  await assertShellCacheRetirement();
}

function assertRetiredTestRegistrationPolicy(source) {
  const find = indexReleaseDeclarations(source);
  const context = vm.createContext({ URL, root: { location: { href: origin + '/' } } });
  vm.runInContext(find('isRetiredTestRegistration'), context);
  const legacy = {scope:origin+'/test/',active:{scriptURL:origin+'/test/sw.js?v=2.3.0'}};
  assert.equal(context.isRetiredTestRegistration(legacy),true);
  assert.equal(context.isRetiredTestRegistration({...legacy,scope:origin+'/'}),false);
  assert.equal(context.isRetiredTestRegistration({...legacy,waiting:{scriptURL:origin+'/sw.js'}}),false);
  assert.equal(context.isRetiredTestRegistration({...legacy, active:null}),false);
  assert.match(find('retireObsoleteWorkerRegistrations'),
    /worker !== serviceWorker\.controller[^]*workerVersions\.get\(worker\) !== currentVersion\(\)[^]*filter\(isRetiredTestRegistration\)[^]*candidate\.unregister/);
  assert.equal([...source.matchAll(/\.unregister\(/g)].length,1);
}

async function assertShellCacheRetirement() {
  const worker = harness([{id:'root',url:origin+'/'}]);
  const current = worker.evaluate('APP_SHELL_BUILD');
  const query = worker.evaluate('APP_SHELL_QUERY_PARAM');
  worker.clients[0].url = origin+'/?'+new URLSearchParams({[query]:'AgData v2.3.0'});
  const old = 'agdata-v2.3.0', permanent = 'agdata-image-cache', separate = 'agdata-v2-isolated-photo';
  for (const name of [old,permanent,separate]) await worker.caches.open(name);
  await worker.evaluate('retireUnusedShellGenerations()');
  assert.deepEqual(worker.calls.deleted,[]);
  await worker.dispatch('install');
  await worker.evaluate('retireUnusedShellGenerations()');
  assert.deepEqual(worker.calls.deleted,[]);
  worker.clients[0].url = origin+'/?'+new URLSearchParams({[query]:current});
  await worker.evaluate('retireUnusedShellGenerations()');
  assert.deepEqual(worker.calls.deleted,[old]);
}
export function invariant42({read}) {
  const writer = read('scripts/write-deployment-fingerprint.mjs'), update = read('assets/live-app-update.js');
  assert.match(writer, /writeFile\(path\.join\(siteRoot, 'deployment-fingerprint\.json'\), serialized, 'utf8'\)/);
  assert.match(writer, /writeFile\(path\.join\(siteRoot, 'deployment\.json'\), serialized, 'utf8'\)/);
  assert.match(writer, /writeFile\(path\.join\(siteRoot, 'deployments', `\$\{fingerprint\.commit\}\.json`\), serialized, 'utf8'\)/);
  assert.match(update, /fetch\('\.\/version\.json\?t='\+Date\.now\(\),\{cache:'no-store'/);
  assert.match(read('.codex/skills/agdata-release-governor/SKILL.md'), /Never add a runtime release-descriptor fetch path without emitting that exact path/);
}
export function invariant51({read}) {
  const lifecycle = read('assets/app-lifecycle.js'), runtime = read('assets/app-runtime.js');
  const update = read('assets/live-app-update.js');
  const migration = read('supabase/migrations/20261026220000_agdata_v2376_instant_login_and_fast_suspend_view.sql');
  assert.match(lifecycle, /VERSION_RELOAD_FUSE_MS = 5 \* 60 \* 1000/);
  assert.match(lifecycle, /!isAuthTransitionActive\(\)[^]*!activeSession\(\)[^]*runtime-not-ready/);
  assert.match(update, /!restoreReady \|\| !runtimeReady\(\)/);
  assert.match(update, /prior\?\.target===target[^]*prior\?\.from===currentVersion\(\)/);
  assert.match(runtime, /LOGIN_READ_TIMEOUT_MS = 6000/);
  assert.match(runtime, /document\.documentElement\?\.classList\?\.contains\('booting-session'\)/);
  assert.match(migration, /open_stock_by_item as materialized/);
  assert.match(migration, /loc_totals_by_item_loc as materialized/);
  assert.doesNotMatch(migration, /left join lateral/);
  assert.match(migration, /alter role anon set statement_timeout='120s'/);
  assert.match(migration, /notify pgrst,'reload config'/);
}
export async function invariant476({runFunctions}) {
  let navigated=0, messaged=0;
  const ctx=runFunctions('sw.js',['navigateClientToForcedUpgrade'],{
    isProductionShellUrl:()=>true,APP_SHELL_BUILD:'AgData v3.0.5',APP_SHELL_URL:'/index.html'
  });
  const client={url:'https://fixture.invalid',postMessage:()=>messaged++,navigate:()=>navigated++};
  await ctx.navigateClientToForcedUpgrade(client,'AgData v0.0.1');
  assert.equal(messaged,1);assert.equal(navigated,0);
}
function liveUpdateHarness(read) {
  const values=new Map([['gnc_native_auth_profile_v1','retained']]), requests=[], navigations=[], deletes=[];
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>deletes.push(k)};
  const root={__APP_SHELL_VERSION__:'AgData v3.0.1',document:{hidden:false,body:null,addEventListener(){}},
    navigator:{onLine:true},localStorage:storage,sessionStorage:storage,AbortController,
    addEventListener(){},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    location:{href:'https://agmetricapp.com/',replace:url=>navigations.push(url)},
    withBootDeadline:async work=>work,fetch:async(url,init)=>{requests.push([url,init]);return {status:200,json:async()=>({version:'3.0.5'})};}};
  vm.runInNewContext(read('assets/live-app-update.js'),{window:root,URL,Date,Promise,Set,WeakMap,WeakSet});
  return {root,values,requests,navigations,deletes};
}
export async function invariant522({read, functionSource, runFunctions}) {
  const h=liveUpdateHarness(read);
  assert.equal(await h.root.checkForLiveAppUpdate('force-data-sync',{force:true}),true);
  assert.equal(h.values.get('gnc_native_auth_profile_v1'),'retained');
  assert.deepEqual(h.deletes,[]);assert.deepEqual(h.navigations,[]);
  assert.match(h.requests[0][0],/version\.json\?t=\d+/);assert.equal(h.requests[0][1].cache,'no-store');
  const sync=[];const context={window:{checkAgDataVersion:async(reason,options)=>{sync.push([reason,options.force]);return true;}},fetchBackgroundData:()=>sync.push('data'),setMenuOpenState:()=>{}};
  vm.createContext(context);vm.runInContext(functionSource('assets/app-runtime.js','forceSyncAndCloseMenu'),context);
  context.forceSyncAndCloseMenu();await Promise.resolve();assert.deepEqual(sync,[['force-data-sync',true]]);
  let navigated=0,messaged=0;
  const worker=runFunctions('sw.js',['navigateClientToForcedUpgrade'],{APP_SHELL_BUILD:'AgData v3.0.5',APP_SHELL_URL:'/index.html',isProductionShellUrl:()=>true});
  assert.equal(await worker.navigateClientToForcedUpgrade({url:'https://agmetricapp.com/',navigate:()=>navigated++,postMessage:()=>messaged++},'AgData v3.0.1'),true);
  assert.equal(messaged,1);assert.equal(navigated,0);
}
