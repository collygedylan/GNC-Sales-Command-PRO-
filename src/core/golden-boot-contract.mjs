import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadWorkerSource, shellResponse } from '../../tests/helpers/root-service-worker-fixture.mjs';

export async function invariant208({read, rootPathForMirror}) {
  const runtime = read('assets/app-runtime.js');
  assert.match(read('index.html'), /<meta name="referrer" content="no-referrer">/);
  assert.match(runtime, /referrerPolicy: "no-referrer"/);
  const listeners = {}, stores = new Map(), deleted = [];
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const rows = stores.get(name);
    return { match: async key => rows.get(String(key)), put: async (key, value) => rows.set(String(key), value) };
  };
  await cache('agdata-v2.3.112').put('./index.html', new Response('last-good'));
  let blocked = true;
  const ctx = vm.createContext({ URL, Response, AbortController, setTimeout, clearTimeout,
    self: { addEventListener: (type, handler) => { listeners[type] = handler; }, skipWaiting: async () => {},
      location: { origin: 'https://agmetricapp.com', href: 'https://agmetricapp.com/sw.js' },
      registration: { scope: 'https://agmetricapp.com/' }, clients: { claim: async () => {}, matchAll: async () => [] } },
    caches: { open: async name => cache(name), keys: async () => [...stores.keys()], delete: async name => { deleted.push(name); stores.delete(name); } },
    fetch: async () => { if (blocked) throw new TypeError('blockedbyclient'); return shellResponse(); }
  });
  loadWorkerSource(ctx, read('sw.js'));
  let work; listeners.install({ waitUntil: promise => { work = promise; } });
  await assert.rejects(work, /blockedbyclient/);
  listeners.activate({ waitUntil: promise => { work = promise; } }); await work;
  assert.deepEqual(deleted, []);
  assert.equal(await (await ctx.matchRootCache('./index.html')).text(), 'last-good');
  blocked = false; listeners.install({ waitUntil: promise => { work = promise; } }); await work;
  listeners.activate({ waitUntil: promise => { work = promise; } }); await work;
  assert.deepEqual(deleted, ['agdata-v2.3.112']);
  const timers = [];
  const root = { setTimeout: (fn, ms) => { assert.equal(ms, 1200); timers.push(fn); return timers.length; }, clearTimeout() {} };
  const life = read('assets/app-lifecycle.js');
  vm.runInNewContext(life.slice(life.indexOf('root.withBootDeadline ='), life.indexOf('    const originalFetch')), { root });
  const pending = root.withBootDeadline(new Promise(() => {})); timers.shift()(); assert.equal(await pending, null);
  const native = { user: { username: 'dylan_collyge', role: 'Admin' }, profile: { id: 'verified-id' }, session: { access_token: 'verified-token' } };
  const login = { window: root, nativeAuthSessionActive: true,
    tryNativeAuthPasswordLogin: async () => native, ensureNativeAppSessionBridge: async () => { throw new TypeError('blocked'); }, readPersistedAppSessionRecord: () => null };
  vm.runInNewContext(runtime.slice(runtime.indexOf('async function fetchRemoteLoginUser('), runtime.indexOf('function getLoginFailureMessage(')), login);
  const result = await login.fetchRemoteLoginUser('dylan_collyge', 'password');
  assert.equal(result.ok, true); assert.equal(result.source, 'native-auth'); assert.equal(result.nativeSession, native.session);
  const { startCompanyMirror } = await import('../../scripts/serve-company-mirror.mjs');
  const server = await startCompanyMirror({ directory: rootPathForMirror(), port: 0 });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/');
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await fetch(base + '/.gnc-local/cloud-erp-secrets.env')).status, 404);
    assert.equal((await fetch(base + '/package.json', { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
}
function prebootHarness(read, remembered = false) {
  const listeners=new Map(), timers=new Map(), stored=new Map(), updates=[];let next=0;
  if (remembered) {
    stored.set('gnc_native_auth_profile_v1',JSON.stringify({id:'native-1',username:'dylan_collyge'}));
    stored.set('sb-kzrnyjsosryejjejliii-auth-token',JSON.stringify({user:{id:'native-1'},access_token:'cached'}));
  }
  const store={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
  const document={readyState:'complete',hidden:false,addEventListener:(type,fn)=>listeners.set(type,fn),
    documentElement:{classList:{remove(){}}},getElementById:()=>null,querySelectorAll:()=>[]};
  const context={document,localStorage:store,sessionStorage:store,navigator:{onLine:true},Event:class {},
    setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
    addEventListener:(type,fn)=>listeners.set(type,fn),dispatchEvent(){},checkForLiveAppUpdate:reason=>updates.push(reason)};
  context.window=context;
  const entry = read('index.html').match(/<script data-agdata-preboot>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(read('assets/preboot-recovery.js') + '\n' + entry,context);
  return {context,document,listeners,timers,stored,updates};
}

export function invariant538({read}) {
  const h=prebootHarness(read);
  h.document.readyState='loading';
  const initial=h.timers.get(1);
  h.timers.delete(1);
  initial();
  assert.equal(h.timers.size,0,'a loading document waits for its lifecycle event without recursive polling');
  assert.deepEqual(h.updates,[]);
  h.document.readyState='interactive';
  h.listeners.get('DOMContentLoaded')();
  assert.equal(h.timers.size,1,'DOM readiness receives one bounded recovery deadline');
  h.context.__agdataMarkBootComplete();
  assert.equal(h.timers.size,0,'a completed shell cancels its pending deadline');
  h.listeners.get('unhandledrejection')();
  assert.deepEqual(h.updates,[],'completed shells retain their current session and page');
  const failed=prebootHarness(read);
  failed.listeners.get('unhandledrejection')();
  failed.listeners.get('unhandledrejection')();
  assert.deepEqual(failed.updates,['preboot:STARTUP_REJECTION'],'recovery is single-flight');
  assert.match(read('index.html'), /preboot-recovery\.js\?v=[\d.]+[^]*data-agdata-preboot/);
  assert.ok(read('sw.js').includes('"./assets/preboot-recovery.js"'),'offline installation retains the preboot owner');
}
export async function invariant492({read}) {
  const h=prebootHarness(read);h.stored.set('session-token','keep');
  h.timers.get(1)();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.stored.get('session-token'),'keep');
  assert.deepEqual(h.updates,['preboot:BOOT_TIMEOUT']);
  assert.equal(JSON.parse(h.stored.get('agdata_preboot_recovery_log')).length,1);
  assert.ok(!h.stored.get('agdata_preboot_recovery_log').includes('private'));
  assert.equal(h.context.__gncShellUpdateReady,true);
}
export function invariant502({read}) {
  const h=prebootHarness(read,true);
  assert.equal(h.context.hasAgDataRememberedSession(),true);
  assert.equal(h.context.__agdataSuppressBootFailure(),true);
  h.timers.get(1)();assert.deepEqual(h.updates,[]);
  h.stored.set('gnc_explicit_logout_v1','1');
  assert.equal(h.context.hasAgDataRememberedSession(),false);
  assert.equal(h.context.__agdataSuppressBootFailure(),false);
}
export async function invariant523({read, functionSource}) {
  const h=prebootHarness(read);h.document.readyState='loading';
  h.timers.get(1)();assert.equal(h.stored.size,0,'slow DOM download is not a boot failure');
  h.context.__agdataMarkBootComplete();h.document.readyState='interactive';h.listeners.get('DOMContentLoaded')();
  assert.equal(h.context.__agdataBootCompleted,true);assert.equal(h.context.__agdataBootComplete,true);
  h.listeners.get('error')({target:h.context});assert.equal(h.stored.size,0,'rendered shell disarms recovery');
  const module={exports:{}};vm.runInNewContext(read('assets/runtime-watchdog-panel.js'),{module,Date});let copied='';
  const rows=Array.from({length:30},(_,i)=>({id:i+1,status:'open',last_seen_at:new Date(1700000000000+i*1000).toISOString(),error_message:'OPEN_'+(i+1),suspected_functions:[]}));
  rows.push({id:99,status:'resolved',error_message:'RESOLVED_SECRET',last_seen_at:new Date().toISOString()});
  const panel=module.exports.createController({document:{getElementById:()=>null},getUsername:()=> 'dylan_collyge',postJson:async()=>({data:rows}),clipboard:{writeText:async value=>{copied=value;}},showToast:()=>{}});
  await panel.copyFixBrief();assert.equal((copied.match(/OPEN_/g)||[]).length,25);assert.ok(copied.includes('Open Incidents: 30'));assert.ok(copied.includes('Resolved Historical Incidents: 1 omitted'));assert.ok(!copied.includes('RESOLVED_SECRET'));assert.ok(!copied.includes('OPEN_5 |'));assert.ok(copied.indexOf('OPEN_30')<copied.indexOf('OPEN_29'));
  const observed=[];const sensor={RUNTIME_ERROR_TYPES:new Set(),state:{username:'actor',role:'admin',revisions:{}},global:{__APP_RELEASE_VERSION__:'AgData v3.0.6'},view:()=> 'home',subModule:()=>'',normalizedRole:x=>x,OWNERS:{},fingerprint:()=> 'fingerprint',send:event=>observed.push(event)};
  vm.runInNewContext(functionSource('assets/runtime-watchdog.js','record'),sensor);
  assert.equal(sensor.record('UI_ERROR_BANNER_SHOWN',{error_message:'UI_ERROR_BANNER_SHOWN:detail:VALIDATION_REQUIRED'}),false);
  sensor.record('APP_API_FAILURE',{error_message:'HTTP 500'});assert.equal(observed.length,1);assert.equal(observed[0].error_message,'HTTP 500');
}

