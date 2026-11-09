import assert from 'node:assert/strict';
import vm from 'node:vm';

export function releaseAssetsContract({read}) {
  const shell=read('index.html'), sw=read('sw.js'), version=JSON.parse(read('version.json')).version;
  for (const match of shell.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="(\.\/assets\/[^"?]+\.(?:css|js)(?:\?[^\"]*)?)"/g)) {
    assert.equal(new URL(match[1],'https://agmetricapp.com').searchParams.get('v'),version,match[1]);
  }
  assert.ok(sw.includes(`const CACHE_VERSION = 'agdata-v${version}'`));
  assert.match(sw,/APP_SHELL_RUNTIME_REVISION = 'cloud-relay-cache-r2'/);
  assert.match(sw,/hasCompleteShellInstall\(\)[^]*!windows\.some\(client => isProductionShellUrl\(client\.url\)\)/);
  assert.match(sw,/self\.clients\.claim\(\)/);
  const scope='https://agmetricapp.com/';
  const worker=vm.createContext({self:{addEventListener(){},location:{href:scope+'sw.js',origin:new URL(scope).origin},registration:{scope}},URL});
  worker.importScripts = (...scripts) => {
    for (const script of scripts) {
      const source = new URL(script, scope);
      assert.equal(source.searchParams.get('v'), version);
      vm.runInContext(read(source.pathname.slice(1)), worker);
    }
  };
  vm.runInContext(sw+'\nglobalThis.assets = ASSETS_TO_CACHE;',worker);
  for (const asset of worker.assets.filter(value=>/\.(?:css|js|mjs)(?:\?|$)/.test(value))) {
    assert.equal(new URL(asset,'https://agmetricapp.com').searchParams.get('v'),version,asset);
  }
  assert.match(read('scripts/build-live-shell.mjs'),/shellStylesheetMarkup\(`\.\/assets\/live-app-styles-base/);
  assert.match(read('scripts/prepare-release-site.mjs'),/isScopedAssetHotfix[\s\S]*photo-history-v2026090401\.js[\s\S]*inventory-list-contract\.js/);
}
export async function startupContract({html,deferred}) {
  const startup=html.match(/        async function initializeAppSessionOnLoad\([^]*?^        }/m)?.[0];
  assert.ok(startup);
  for (const restored of [true,false]) {
    const restore=deferred(), inputs=new Set(['hidden']), timers=[];const fallbacks=[];
    const context=vm.createContext({appSessionStartupStarted:false,nativeAuthRecoveryEpoch:0,
      isPublicPhotoShareRoute:()=>false,isAuthenticatedAppShellVisible:()=>false,
      document:{getElementById:()=>({classList:{remove:name=>inputs.delete(name)}})},
      withAgDataBootDeadline:()=>Promise.resolve(false),ensureCurrentShellBuild(){},
      restoreNativeAuthSessionOnStartup:()=>restore.promise,setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout(){},
      finishAppSessionBootFallback:reason=>fallbacks.push(reason),globalThis:{}});
    vm.runInContext(startup,context);
    const pending=context.initializeAppSessionOnLoad();
    assert.equal(inputs.has('hidden'),false,'login is enabled before remote session recovery');
    assert.equal(timers.length,1);restore.resolve(restored);await pending;
    assert.deepEqual(fallbacks,[restored?'session-pending':'session-deadline']);
  }
}
export async function recoveryContract({harness}) {
  const ready=harness();ready.event('document','DOMContentLoaded');
  assert.equal(ready.window.markAgDataRuntimeReady(),true);ready.runTimer();
  const failed=harness(), updates=[];let navigation=0,unregistered=0;const deleted=[];
  failed.window.checkForLiveAppUpdate=async reason=>{updates.push(reason);return true;};
  failed.window.location={href:'https://agmetricapp.com/index.html',replace:()=>navigation++};
  failed.window.navigator={serviceWorker:{getRegistrations:async()=>[{unregister:async()=>unregistered++}]}};
  failed.window.caches={keys:async()=>['other-cache'],delete:async key=>deleted.push(key)};
  assert.equal(await failed.window.recoverAppLoadFailure('login-runtime-failure'),true);
  assert.deepEqual(updates,['login-runtime-failure']);assert.equal(navigation,0);
  assert.equal(unregistered,0);assert.deepEqual(deleted,[]);
}
export async function sessionUpdateContract({harness}) {
  const h=harness(), requests=[];let navigated=0,unregistered=0;const deleted=[];
  h.window.requestLiveAppUpdate=async(target,options)=>{requests.push([target,options.reason]);return true;};
  h.window.navigator={onLine:true,serviceWorker:{getRegistrations:async()=>[{unregister:async()=>unregistered++}]}};
  h.window.caches={keys:async()=>['other-cache'],delete:async key=>deleted.push(key)};
  h.window.location={href:'https://agmetricapp.com/',replace:()=>navigated++,reload:()=>navigated++};
  h.window.isAuthenticatedAppSessionActive=()=>true;
  assert.equal(h.window.reloadForServiceWorkerUpdate('AgData v3.0.5'),false);
  assert.equal(await h.window.recoverShellVersionMismatch('AgData v3.0.1','AgData v3.0.5'),true);
  assert.deepEqual(requests,[['AgData v3.0.5','worker-update'],['AgData v3.0.5','worker-version-mismatch']]);
  assert.equal(navigated,0);assert.equal(unregistered,0);assert.deepEqual(deleted,[]);
}
export function queuedWorkerContract({harness}) {
  const h=harness(), requests=[];let active=false,navigated=0;
  h.window.requestLiveAppUpdate=(target,options)=>{requests.push([target,options.reason]);return Promise.resolve(true);};
  h.window.location={reload(){navigated++;}};h.window.isAuthenticatedAppSessionActive=()=>active;
  assert.equal(h.window.reloadForServiceWorkerUpdate('AgData v2.3.33'),false);
  active=true;assert.equal(navigated,0);
  assert.deepEqual(requests,[['AgData v2.3.33','worker-update']]);
}

async function sameAccountScenario(outcome,functions,deferred) {
  const gate = deferred();
  let reads = 0, persisted = 0;
  const retained = { username: 'worker', canViewQueue: true };
  const runtime = vm.createContext({ currentUser: 'worker', nativeAuthSessionActive: true, nativeAuthSessionUserId: 'account-a',
    nativeAuthProfile: { id: 'account-a', active: true }, productionLiveSyncReadAuthEpoch: 1, window: {},
    requestCapabilityLoadPromise: null, navigator: { onLine: true },
    requestCapabilityState: { username: 'worker', profileId: 'account-a', authEpoch: 1,
      status: 'ready', stale: false, loadedAt: 1, capabilities: retained },
    getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase(),
    readCachedRequestCapabilities: () => assert.fail('the same-owner memory snapshot takes precedence'),
    refreshRequestCapabilityUi() {}, normalizeRequestCapabilities: value => value,
    persistRequestCapabilities: () => { persisted++; }, reportSemanticHealthEvent() {},
    hasConfirmedCurrentAccountRevocation:()=>outcome === 'denied', isSupabaseReadTerminalDenial: error => Number(error?.status) === 403,
    supabaseRpc: async () => {
      reads++; await gate.promise;
      if (outcome === 'denied' || outcome === 'transient') throw Object.assign(new Error(outcome), { status: outcome === 'denied' ? 403 : 503 });
      return { username: 'worker', canViewQueue: false };
    },
  });
  vm.runInContext(functions, runtime);
  const first = runtime.initializeRequestCapabilities({ force: true });
  const second = runtime.initializeRequestCapabilities({ force: true });
  assert.equal(reads, 1);
  assert.equal(runtime.requestCapabilityState.stale, true, 'retained access is not falsely marked fresh');
  assert.equal(runtime.requestCapabilityState.capabilities, retained);
  assert.equal(runtime.getRequestCapabilityStatusMarkup(), '', 'background checks do not replace Home with a permissions banner');
  let replacement;
  if (outcome === 'account-change') {
    runtime.currentUser = 'other'; runtime.nativeAuthProfile = { id: 'account-b' };
    runtime.nativeAuthSessionUserId = 'account-b'; runtime.productionLiveSyncReadAuthEpoch++;
    replacement = { username: 'other', status: 'loading', capabilities: null };
    runtime.requestCapabilityState = replacement;
  }
  gate.resolve();
  await Promise.all([first, second]);
  if (outcome === 'account-change') {
    assert.equal(runtime.requestCapabilityState, replacement);
    assert.equal(persisted, 0);
  } else if (outcome === 'denied') {
    assert.equal(runtime.requestCapabilityState.capabilities, null);
    assert.match(runtime.getRequestCapabilityStatusMarkup(), /role="alert"/);
    assert.equal(persisted, 0);
  } else {
    assert.equal(runtime.getRequestCapabilityStatusMarkup(), '');
    assert.equal(runtime.requestCapabilityState.capabilities.canViewQueue, outcome === 'transient');
    assert.equal(persisted, outcome === 'ready' ? 1 : 0);
  }
}
export async function sameAccountContract({html,deferred}) {
  const functions = ['initializeRequestCapabilities', 'getRequestCapabilityStatusMarkup'].map(name => {
    const source = html.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?^        }', 'm'))?.[0];
    assert.ok(source, name); return source;
  }).join('\n');
  for (const outcome of ['ready','transient','denied','account-change']) await sameAccountScenario(outcome,functions,deferred);
}
