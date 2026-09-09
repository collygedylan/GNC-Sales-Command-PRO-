import { expect, test, type Page } from '@playwright/test';

/** Run the freshly compiled production bootstrap and session state machine.
 * Only SDK/server boundaries and unrelated background integrations are fixtures.
 * In particular, auth/profile reads can fail independently with navigator online;
 * the fixture does not install an already-authorized app identity before login.
 */
async function isolatedSession(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const forbidden: string[] = [], runtime: string[] = [];
  page.on('response', response => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) runtime.push(response.url());
  });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && /ph_master_inventory|ph_requests|storage\/v1/.test(url.pathname)) {
      forbidden.push(request.method() + ':' + url.pathname);
    }
    return route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=session-recovery', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as any).restoreNativeAuthSessionOnStartup === 'function');
  await page.evaluate(() => {
    window.eval(`(() => {
      clearLoginStartupWatchdog();
      clearInMemorySessionIdentity();
      resetLoginUiState();
      localStorage.clear(); sessionStorage.clear(); clearExplicitLogoutMarker();
      const f=window.__sessionFixture={calls:[],signOuts:[],signIns:[],legacyLogins:[],toasts:[],gates:{},requestFailure:false,profileFailure:false};
      f.makeProfile=(username='session_fixture',role='MANAGER')=>({id:'isolated-'+username,username,display_name:username,role,division:'10',language:'English',disabled_at:null,locked_until:null,must_change_password:false});
      f.makeSession=profile=>({access_token:'isolated-token-'+profile.username,refresh_token:'isolated-refresh-'+profile.username,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:profile.id}});
      f.profile=f.makeProfile(); f.session=f.makeSession(f.profile);
      f.client={auth:{
        getSession:async()=>{f.calls.push('getSession');if(f.sessionFailure)return {data:{session:null},error:typeof f.sessionFailure==='object'?f.sessionFailure:{status:503,message:'upstream unavailable'}};return {data:{session:f.session},error:null}},
        refreshSession:async()=>{f.calls.push('refreshSession');return {data:{session:f.session},error:null}},
        signInWithPassword:async credentials=>{f.signIns.push(credentials.email);return {data:{session:f.session},error:null}},
        signOut:async options=>{f.signOuts.push(options||{});f.session=null;return {error:null}},
        onAuthStateChange:callback=>{f.authCallback=callback;return {data:{subscription:{unsubscribe(){}}}}}
      },from:table=>({select:()=>({eq:(_column,id)=>({maybeSingle:async()=>{
        f.calls.push('profile:'+id);const profile={...f.profile};const failure=f.profileFailure;const gate=f.gates[id];
        if(gate)await gate.promise;
        if(failure)return {data:null,error:{status:503,message:'upstream unavailable'}};
        if(table!=='profiles')throw new Error('UNEXPECTED_PROFILE_TABLE');
        return {data:profile.id===id?profile:null,error:null};
      }})})})};
      getSupabaseBrowserClient=()=>f.client;
      window.__gncNativeRoleAuthWatcher=null;installNativeRoleRefreshWatchers();
      f.emit=(event,session=f.session)=>f.authCallback(event,session);
      f.gate=id=>{let release;const promise=new Promise(resolve=>release=resolve);f.gates[id]={promise,release};};
      f.snapshot=()=>({active:nativeAuthSessionActive,token:nativeAuthAccessToken,profileId:nativeAuthProfile?.id||'',username:currentUser,owner:captureLoginSessionOwnership(),capabilityState:{...requestCapabilityState},accessUsername:getAppAccessSnapshot()?.username||''});
      f.start=()=>{f.done=false;f.startPromise=restoreNativeAuthSessionOnStartup().then(value=>{f.done=true;f.result=value}).catch(error=>{f.done=true;f.error=error.code||error.message})};
      showToast=(title,message)=>f.toasts.push({title,message});
      reportSemanticHealthEvent=()=>false;
      ensureNativeAppSessionBridge=async()=>null;
      primePushPermissionFromLoginGesture=async()=>false;
      postAppFunctionJson=async(_url,payload)=>{if(payload.action==='login')f.legacyLogins.push(payload.action);throw new Error('ISOLATED_REMOTE_BOUNDARY')};
      supabaseRpc=async operation=>{
        f.calls.push(operation);const identity=f.snapshot();
        if(operation==='get_my_app_permissions_v1')return {contractVersion:'app-access-v1',enforcementMode:'enforced',username:identity.username,role:f.profile.role,
          permissions:['home','drive','tasks'].map(key=>({permissionKey:'module.'+key+'.view',kind:'module',moduleKey:key,allowed:true,scope:'global'}))};
        if(operation==='get_request_capabilities'){
          if(f.requestGate)await f.requestGate;
          if(f.requestFailure)throw Object.assign(new Error('upstream unavailable'),{status:503});
          return {contract_version:2,username:identity.username,scope:'global',can_view_queue:true,can_take_photo:true,can_edit:true,can_complete:true,can_create_general:true,can_create_av:true};
        }
        return [];
      };
      for(const name of ['initializeOpsPilotForCurrentSession','ensureLeafAssistantSession','refreshCurrentSeasonSettingsFromRemote','refreshAvBlanksPhotoBypassSettingsFromRemote','ensureDockAssignableUsers','ensureDockTeamStatusLoaded','ensureDockItemStatusLoaded','ensureDockIssueDataLoaded','ensureAvRuleColumnsReady','warmCachedInventory','warmUserScopedDatasetCaches','loadEvalWorkAssignments','loadLoginReadyDatasets','refreshManualSyncStatus','loadDepartmentCalendar','loadChatMessages'])window[name]=async()=>false;
      for(const name of ['scheduleBackgroundLoginValidation','ensureChatBackgroundSync','installPushEnrollmentListeners','scheduleCellularPushEnrollment','queueDatasetLoad','queueVisibleDatasetCatchup','scheduleTaskHotCacheWarmup','startRealtimeSubscriptions'])window[name]=()=>{};
    })()`);
  });
  expect(runtime.length, 'Use compiled production runtime, not the source index').toBeGreaterThan(0);
  return { forbidden };
}

async function readyHome(page: Page) {
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  await expect(page.locator('#native-session-recovery')).toBeHidden();
}

test('restored session survives online profile outage and Retry opens authorized Home', async ({ page, baseURL }) => {
  const fixture = await isolatedSession(page, baseURL!);
  await page.evaluate(() => { const f=(window as any).__sessionFixture; f.profileFailure=true;f.start(); });
  await expect(page.locator('#native-session-recovery')).toContainText('Connection Interrupted');
  await expect(page.locator('#app-wrapper')).toBeHidden();
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  const failed = await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(failed.active).toBe(true);
  expect(failed.token).toContain('isolated-token-');
  await page.evaluate(() => { (window as any).__sessionFixture.profileFailure=false; });
  await page.locator('#native-session-recovery').getByRole('button', { name:/retry/i }).click();
  await readyHome(page);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signIns)).toEqual([]);
  expect(fixture.forbidden).toEqual([]);
});

test('password success followed by profile outage never falls through to legacy login or global sign-out', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => { (window as any).__sessionFixture.profileFailure=true; });
  await page.locator('#username-input').fill('session_fixture');
  await page.locator('#pin-code').fill('synthetic-password');
  await page.evaluate(() => (window as any).handleLogin());
  await expect(page.locator('#native-session-recovery')).toContainText('Connection Interrupted');
  await page.evaluate(() => { (window as any).__sessionFixture.profileFailure=false; });
  await page.locator('#native-session-recovery').getByRole('button', { name:/retry/i }).click();
  await readyHome(page);
  const calls = await page.evaluate(() => {const f=(window as any).__sessionFixture;return {signIns:f.signIns,signOuts:f.signOuts,legacy:f.legacyLogins}});
  expect(calls.signIns).toHaveLength(1);
  expect(calls.signOuts).toEqual([]);
  expect(calls.legacy).toEqual([]);
});

test('token refresh immediately restores native flags even when the subsequent profile read fails', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => (window as any).__sessionFixture.start());
  await readyHome(page);
  await page.evaluate(() => window.eval(`nativeAuthSessionActive=false;nativeAuthAccessToken='';window.__sessionFixture.profileFailure=true;window.__sessionFixture.session.access_token='refreshed-isolated-token';window.__sessionFixture.emit('TOKEN_REFRESHED');`));
  const state = await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.active).toBe(true);
  expect(state.token).toBe('refreshed-isolated-token');
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('temporary SDK session-read failure retains an open workspace and recovers without a new sign-in', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => (window as any).__sessionFixture.start());
  await readyHome(page);
  const failure = await page.evaluate(async () => {
    const w=window as any;w.__sessionFixture.sessionFailure=true;
    try {await w.getNativeAuthSession();return '';}catch(error:any){return error.code;}
  });
  expect(failure).toBe('NATIVE_SESSION_SERVICE_UNAVAILABLE');
  const state=await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.active).toBe(true);
  expect(state.token).toContain('isolated-token-');
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  await page.evaluate(async () => {const w=window as any;w.__sessionFixture.sessionFailure=false;await w.getNativeAuthSession();});
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signIns)).toEqual([]);
});

test('cached Request access Retry reports failure and subsequent success without resetting Home', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => (window as any).__sessionFixture.start());
  await readyHome(page);
  await page.evaluate(async () => { const w=window as any;w.__sessionFixture.requestFailure=true;await w.initializeRequestCapabilities({force:true,render:true,reason:'isolated-outage'}); });
  const warning = page.locator('#home-request-capability-status');
  await expect(warning).toContainText('Using saved Request access');
  await warning.getByRole('button', { name:/retry/i }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.toasts.some((t:any)=>/Unavailable|Could Not|Interrupted|Failed/i.test(t.title)))).toBe(true);
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  await page.evaluate(() => { (window as any).__sessionFixture.requestFailure=false; });
  await warning.getByRole('button', { name:/retry/i }).click();
  await expect(warning).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.toasts.some((t:any)=>t.title==='Request Access Ready'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('reconnect bursts single-flight the stale Request check and leave drafts intact', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => (window as any).__sessionFixture.start());
  await readyHome(page);
  await page.evaluate(async () => {const w=window as any;w.__sessionFixture.requestFailure=true;await w.initializeRequestCapabilities({force:true,render:true,reason:'isolated-outage'});});
  const before = await page.evaluate(() => (window as any).__sessionFixture.calls.filter((c:string)=>c==='get_request_capabilities').length);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.requestGate=new Promise(resolve=>f.releaseRequest=resolve);f.requestFailure=false;sessionStorage.setItem('isolated-draft','AV note retained');for(let i=0;i<4;i++)window.dispatchEvent(new Event('online'));});
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.calls.filter((c:string)=>c==='get_request_capabilities').length)).toBe(before+1);
  await page.evaluate(() => (window as any).__sessionFixture.releaseRequest());
  await expect(page.locator('#home-request-capability-status')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('isolated-draft'))).toBe('AV note retained');
  expect(await page.evaluate(() => (window as any).__sessionFixture.calls.filter((c:string)=>c==='get_request_capabilities').length)).toBe(before+1);
});

test('a late old-account profile response cannot replace a newer signed-in account', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.gate(f.profile.id);f.start();});
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.calls.filter((c:string)=>c==='profile:isolated-session_fixture').length)).toBeGreaterThan(0);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profile=f.makeProfile('second_fixture');f.session=f.makeSession(f.profile);f.start();});
  await readyHome(page);
  await page.evaluate(() => (window as any).__sessionFixture.gates['isolated-session_fixture'].release());
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.snapshot().username)).toBe('second_fixture');
  const state = await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.profileId).toBe('isolated-second_fixture');
  expect(state.accessUsername).toBe('second_fixture');
  expect(state.capabilityState.username).toBe('second_fixture');
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('SIGNED_OUT while a restored profile is pending cannot resurrect protected Home', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.gate(f.profile.id);f.start();});
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.calls.filter((c:string)=>c.startsWith('profile:')).length)).toBeGreaterThan(0);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.session=null;f.emit('SIGNED_OUT',null);f.gates['isolated-session_fixture'].release();});
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.done)).toBe(true);
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('#app-wrapper')).toBeHidden();
  const state = await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.active).toBe(false);
  expect(state.username).toBe('');
  expect(state.profileId).toBe('');
});

test('disabled profile stays denied without account-wide sign-out or module flash', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profile.disabled_at='2026-09-09T00:00:00Z';f.start();});
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.done)).toBe(true);
  await expect(page.locator('#app-wrapper')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts.filter((options:any)=>!options.scope||options.scope==='global'))).toEqual([]);
  expect(await page.evaluate(() => (window as any).__sessionFixture.legacyLogins)).toEqual([]);
});

test('shell replacement defers during editing and preserves credentials and draft storage', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => (window as any).__sessionFixture.start());
  await readyHome(page);
  await page.evaluate(() => {
    localStorage.setItem('sb-isolated-auth-token', JSON.stringify({access_token:'test-session-token',refresh_token:'test-refresh-token'}));
    sessionStorage.setItem('isolated-request-draft','unfinished AV note');
    const input=document.createElement('textarea');input.id='isolated-active-draft';input.value='unfinished AV note';document.querySelector('#view-home')!.prepend(input);input.focus();
  });
  const retained = await page.evaluate(async () => {
    const w=window as any;
    const result=await w.forceShellBuildReload('V2099.01.01.01','isolated-shell-update');
    await w.clearBootCacheForShellUpdate();
    return {result,draft:(document.querySelector('#isolated-active-draft') as HTMLTextAreaElement).value,
      focused:document.activeElement?.id,token:localStorage.getItem('sb-isolated-auth-token'),storedDraft:sessionStorage.getItem('isolated-request-draft')};
  });
  expect(retained.result).toBe(false);
  expect(retained.focused).toBe('isolated-active-draft');
  expect(retained.draft).toBe('unfinished AV note');
  expect(retained.storedDraft).toBe(retained.draft);
  expect(retained.token).toContain('test-refresh-token');
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    document.getElementById('isolated-active-draft')?.remove();
    // Cancel this fixture's deliberately queued target before letting the editor
    // become idle. The separate repeat-build assertion must not pass merely
    // because editing still blocks navigation.
    window.eval(`sessionStorage.removeItem(APP_SHELL_DEFERRED_RELOAD_STORAGE_KEY);window.__gncDeferredShellReload=null;`);
  });
  await expect.poll(() => page.evaluate(() => (window as any).isShellReloadBlocked())).toBe(false);
  const repeat = await page.evaluate(() => {
    sessionStorage.setItem('gnc_app_shell_navigation_history_v2',JSON.stringify(['V2099.01.01.02']));
    return (window as any).navigateToRecoveredShellBuild('V2099.01.01.02','isolated-repeated-build');
  });
  expect(repeat).toBe(false);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('[recovery-edge] retry after a connection outage exposes Sign In if the SDK session has expired', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profileFailure=true;f.start();});
  await expect(page.locator('#native-session-recovery')).toContainText('Connection Interrupted');
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profileFailure=false;f.session=null;});
  await page.locator('#native-session-recovery').getByRole('button',{name:/retry/i}).click();
  await expect(page.locator('#native-session-recovery')).toContainText('Session Ended');
  await expect(page.locator('#login-inputs')).toBeVisible();
  await expect(page.locator('#username-input')).toBeVisible();
  await expect(page.locator('#app-wrapper')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

for(const revoked of [false,true]) {
  test(`[recovery-edge] ${revoked?'revoked':'missing'} native session never restores cached profile or module authority`, async ({ page, baseURL }) => {
    await isolatedSession(page, baseURL!);
    await page.evaluate(() => (window as any).__sessionFixture.start());
    await readyHome(page);
    const cached=await page.evaluate(() => Object.keys(localStorage).some(key=>key.startsWith('gnc_app_access_v1:')));
    expect(cached).toBe(true);
    await page.evaluate(revoked => {
      window.eval(`clearInMemorySessionIdentity();resetLoginUiState();`);
      const f=(window as any).__sessionFixture;
      if(revoked)f.sessionFailure={status:401,code:'refresh_token_not_found',message:'refresh token missing'};
      else f.session=null;
      f.start();
    },revoked);
    await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.done)).toBe(true);
    await expect(page.locator('#view-login')).toBeVisible();
    await expect(page.locator('#login-inputs')).toBeVisible();
    await expect(page.locator('#app-wrapper')).toBeHidden();
    const state=await page.evaluate(() => (window as any).__sessionFixture.snapshot());
    expect(state.active).toBe(false);expect(state.username).toBe('');expect(state.profileId).toBe('');
    expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
  });
}

for(const event of ['online','visibilitychange']) {
  test(`[recovery-edge] ${event} automatically recovers an interrupted startup without password entry`, async ({ page, baseURL }) => {
    await isolatedSession(page, baseURL!);
    await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profileFailure=true;f.start();});
    await expect(page.locator('#native-session-recovery')).toContainText('Connection Interrupted');
    await page.evaluate(event => {
      (window as any).__sessionFixture.profileFailure=false;
      if(event==='online')window.dispatchEvent(new Event('online'));
      else document.dispatchEvent(new Event('visibilitychange'));
    },event);
    await readyHome(page);
    expect(await page.evaluate(() => (window as any).__sessionFixture.signIns)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
  });
}

test('[recovery-edge] a restored native password-change requirement opens its gate without signing out', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profile.must_change_password=true;f.start();});
  await expect(page.locator('#view-change-password')).toBeVisible();
  await expect(page.locator('#new-password')).toBeVisible();
  await expect(page.locator('#app-wrapper')).toBeHidden();
  const state=await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.active).toBe(true);
  expect(state.username).toBe('session_fixture');
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('[recovery-edge] a new-account SIGNED_IN event restores only the new account automatically', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => (window as any).__sessionFixture.start());
  await readyHome(page);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profile=f.makeProfile('auth_event_fixture');f.session=f.makeSession(f.profile);f.emit('SIGNED_IN');});
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.snapshot().username)).toBe('auth_event_fixture');
  await readyHome(page);
  const state=await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.accessUsername).toBe('auth_event_fixture');
  expect(state.capabilityState.username).toBe('auth_event_fixture');
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('[recovery-edge] an explicit manual sign-in after prior logout can recover a profile outage', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => {const w=window as any;w.setExplicitLogoutMarker();w.__sessionFixture.profileFailure=true;});
  await page.locator('#username-input').fill('session_fixture');
  await page.locator('#pin-code').fill('synthetic-password');
  await page.evaluate(() => (window as any).handleLogin());
  await expect(page.locator('#native-session-recovery')).toContainText('Connection Interrupted');
  expect(await page.evaluate(() => (window as any).hasExplicitLogoutMarker())).toBe(false);
  await page.evaluate(() => {(window as any).__sessionFixture.profileFailure=false;});
  await page.locator('#native-session-recovery').getByRole('button',{name:/retry/i}).click();
  await readyHome(page);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signIns.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('[final-auth-audit] foreground discovers an ended SDK session even without a SIGNED_OUT event', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => (window as any).__sessionFixture.start());
  await readyHome(page);
  await page.evaluate(() => {
    sessionStorage.setItem('isolated-request-draft','retained after expiry');
    (window as any).__sessionFixture.session=null;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#native-session-recovery')).toContainText('Session Ended');
  await expect(page.locator('#login-inputs')).toBeVisible();
  await expect(page.locator('#app-wrapper')).toBeHidden();
  const state=await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.username).toBe('');expect(state.active).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem('isolated-request-draft'))).toBe('retained after expiry');
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('[final-auth-audit] late passkey result cannot overwrite a newer signed-in account', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(() => {
    const w=window as any,f=w.__sessionFixture;
    let release:any;const gate=new Promise(resolve=>release=resolve);f.releasePasskey=release;
    f.client.auth.signInWithPasskey=async()=>{const session=f.session;f.passkeyStarted=true;await gate;return {data:{session},error:null}};
    f.passkeyPromise=w.signInWithAppPasskey().finally(()=>f.passkeyDone=true);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__sessionFixture.passkeyStarted)).toBe(true);
  await page.evaluate(() => {const f=(window as any).__sessionFixture;f.profile=f.makeProfile('newer_than_passkey');f.session=f.makeSession(f.profile);f.start();});
  await readyHome(page);
  await page.evaluate(async () => {const f=(window as any).__sessionFixture;f.releasePasskey();await f.passkeyPromise;});
  const state=await page.evaluate(() => (window as any).__sessionFixture.snapshot());
  expect(state.username).toBe('newer_than_passkey');
  expect(state.profileId).toBe('isolated-newer_than_passkey');
  expect(state.token).toBe('isolated-token-newer_than_passkey');
  expect(state.accessUsername).toBe('newer_than_passkey');
  expect(state.capabilityState.username).toBe('newer_than_passkey');
  await readyHome(page);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});

test('[final-auth-audit] deliberate passkey sign-in after logout can retry an authenticated profile outage', async ({ page, baseURL }) => {
  await isolatedSession(page, baseURL!);
  await page.evaluate(async () => {
    const w=window as any,f=w.__sessionFixture;w.setExplicitLogoutMarker();f.profileFailure=true;
    f.client.auth.signInWithPasskey=async()=>({data:{session:f.session},error:null});
    await w.signInWithAppPasskey();
  });
  await expect(page.locator('#native-session-recovery')).toContainText('Connection Interrupted');
  expect(await page.evaluate(() => (window as any).hasExplicitLogoutMarker())).toBe(false);
  await page.evaluate(() => {(window as any).__sessionFixture.profileFailure=false;});
  await page.locator('#native-session-recovery').getByRole('button',{name:/retry/i}).click();
  await readyHome(page);
  expect(await page.evaluate(() => (window as any).__sessionFixture.signOuts)).toEqual([]);
});
