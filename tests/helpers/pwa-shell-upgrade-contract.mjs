import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { parse } from 'parse5';
import postcss from 'postcss';
import { harness, origin, request, shellResponse } from './root-service-worker-fixture.mjs';

const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

export async function upgradeOpenWindows() {
    const version = JSON.parse(read('version.json')).version;
    const prior = version.replace(/\d+$/, patch => String(Number(patch) - 5));
    const stale = {id:'old',url:origin+'/index.html?shellv=AgData+v'+prior+'&approvalId=keep#tag',focused:true,visibilityState:'visible'};
    class VersionChannel {
        port1 = {close(){}};
        port2 = {postMessage: data => this.port1.onmessage({data})};
    }
    const current = {id:'current',url:origin+'/?shellv=AgData+v'+version};
    const compatible = {id:'compatible',url:origin+'/',postMessage(message, ports) {
        if (message.type==='AGDATA_SW_CLIENT_VERSION') ports[0].postMessage({build:'AgData v'+prior,updateCheckpoint:true});
    }};
    const reported = {id:'reported',url:origin+'/',postMessage(message, ports) {
        if (message.type==='AGDATA_SW_CLIENT_VERSION') ports[0].postMessage({build:'AgData v'+version});
    }};
    const h = harness([stale,current,reported,compatible,{id:'unknown',url:origin+'/'},{id:'other',url:origin+'/v2/'}],
        {MessageChannel:VersionChannel});
    const key = h.evaluate('CACHE_NAME');
    const old = ['agdata-v'+prior+'-field-photos','agdata-shell-old','agdata-photo-cache-v1','unversioned-cache'];
    for (const name of old) await h.caches.open(name);
    await h.dispatch('install');
    assert.equal(h.calls.skipWaiting,0,'open windows keep the current worker after installation');
    const sender = { id:'old', url:stale.url };
    await h.dispatch('message',{source:sender,data:{type:'SKIP_WAITING'}});
    assert.equal(h.calls.skipWaiting,0,'an invalid legacy message cannot activate an update');
    await h.dispatch('message',{source:sender,data:{type:'SKIP_WAITING',protocol:'agdata-update-restore-v1',snapshotId:'saved-draft',targetBuild:'AgData v'+version}});
    assert.equal(h.calls.skipWaiting,0,'an automatic checkpoint from a prior version cannot authorize activation');
    const checkpoint = {type:'SKIP_WAITING',protocol:'agdata-update-restore-v1',trigger:'update-banner',snapshotId:'saved-draft',targetBuild:'AgData v'+version};
    await checkCameraCheckpointOwnership(h, sender, checkpoint);
    await h.dispatch('activate');
    assert.deepEqual((await h.caches.keys()).sort(),[key,...old].sort(),'open tabs retain their versioned assets and photos');
    assert.equal(h.calls.claims,1);
    assert.deepEqual(h.calls.navigated, [], 'each open tab owns its own banner tap and current draft');
    for (const id of ['old','unknown','compatible']) {
        assert.ok(h.calls.messages.some(c=>c.id===id && c.message.type==='GNC_SHELL_VERSION' && c.message.build==='AgData v'+version));
    }
}

async function checkCameraCheckpointOwnership(h, sender, checkpoint) {
    const capture = {type:'CAMERA_CAPTURE_STATE',active:true,until:Date.now()+60_000};
    await h.dispatch('message',{source:h.clients[1],data:capture});
    await h.dispatch('message',{source:sender,data:{...checkpoint,targetBuild:'AgData v0.0.1'}});
    assert.equal(h.calls.skipWaiting,0,'a mismatched target never authorizes activation');
    await h.dispatch('message',{source:sender,data:capture});
    await h.dispatch('message',{source:sender,data:checkpoint});
    assert.equal(h.calls.skipWaiting,0,'the requesting page retains its camera guard');
    await h.dispatch('message',{source:sender,data:{...capture,active:false}});
    await h.dispatch('message',{source:sender,data:checkpoint});
    assert.equal(h.calls.skipWaiting,1,'a sibling camera cannot veto another page checkpoint');
}

export async function networkFirstShell() {
    const h = harness();
    await h.dispatch('install');
    const key=h.evaluate('CACHE_NAME'), cache=await h.caches.open(key);
    const paths=['/','/index.html','/version.json','/deployment.json','/deployment-fingerprint.json'];
    for(const [index,path] of paths.entries()) {
        const json=path.endsWith('.json');
        const mode=index===0 || path==='/deployment.json' ? 'navigate' : 'cors';
        await cache.put(path,new Response('old'));
        h.setFetch(async(_request,options)=>{assert.equal(options.cache,'no-store');return new Response('fresh '+path);});
        const network=await h.dispatch('fetch',{request:request(path+'?cb=1',{mode})});
        assert.equal(await network.response.text(),'fresh '+path);
        h.setFetch(async()=>{throw new TypeError('offline');});
        const offline=await h.dispatch('fetch',{request:request(path+'?cb=2',{mode})});
        assert.equal(await offline.response.text(), json ? 'fresh '+path : await shellResponse().text());
        if(json) assert.equal(await (await cache.match(path)).text(),'fresh '+path);
    }
    h.setFetch(async()=>new Response('missing',{status:404}));
    assert.equal(await (await h.dispatch('fetch',{request:request('/version.json')})).response.text(),'fresh /version.json');
    assert.equal((await h.dispatch('fetch',{request:request('/v2/',{mode:'navigate'})})).intercepted,false);
}

export async function staleUpdateNavigation() {
    const worker = harness();
    const version = worker.evaluate('APP_ASSET_VERSION');
    worker.setFetch(async () => shellResponse('STALE', '1.0.0'));
    await assert.rejects(worker.dispatch('install'), /SHELL_INSTALL_VERSION_MISMATCH/);
    assert.deepEqual(worker.calls.deleted, []);
    assert.equal(worker.calls.skipWaiting, 0);
    worker.setFetch(async () => shellResponse('CURRENT'));
    await worker.dispatch('install');
    worker.setFetch(async () => shellResponse('STALE', '1.0.0'));
    const verification = await worker.dispatch('fetch', { request: request('/index.html?verify=' + version) });
    assert.equal(verification.response.type, 'error');
    const url = '/?shellv=AgData+v' + version + '&v=' + version + '&_reload=1';
    const navigation = await worker.dispatch('fetch', { request: request(url, { mode: 'navigate' }) });
    assert.match(await navigation.response.text(), /CURRENT$/);
}

export async function boundedShellInstallation() {
    const worker = harness();
    const assets = new Set(worker.evaluate('ASSETS_TO_CACHE').map(asset => new URL(asset, origin).href));
    let active = 0, peak = 0;
    worker.setFetch(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return shellResponse();
    });
    await worker.dispatch('install');
    assert.equal(peak, 6, 'install caps the network queue');
    assert.equal(worker.calls.fetch.length, assets.size, 'each unique asset is downloaded once');
    assert.deepEqual(new Set(worker.calls.fetch.map(call => call.url)), assets);
    assert.equal(worker.calls.skipWaiting, 1);
    const receipt = worker.evaluate('SHELL_INSTALL_RECEIPT');
    const cache = await worker.caches.open(worker.evaluate('CACHE_NAME'));
    assert.equal(await (await cache.match(receipt)).text(), worker.evaluate('APP_SHELL_BUILD'));

    const unavailable = harness();
    unavailable.setFetch(async () => new Response('unavailable', { status: 503 }));
    await assert.rejects(unavailable.dispatch('install'), /SHELL_ASSET_UNAVAILABLE/);
    assert.ok(unavailable.calls.fetch.length <= 6, 'a failed lane stops admission of new downloads');
    assert.equal(unavailable.calls.skipWaiting, 0);
    const partial = await unavailable.caches.open(unavailable.evaluate('CACHE_NAME'));
    assert.equal(await partial.match(receipt), undefined);
}

export function authenticatedFooter() {
    const elements=new Map();
    const visit=node=>{const id=node.attrs?.find(a=>a.name==='id')?.value;if(id)elements.set(id,node);for(const child of node.childNodes||[])visit(child);};
    visit(parse(read('index.html')));
    const wrapper=elements.get('app-wrapper'), footer=elements.get('bottom-nav');
    assert.ok(wrapper && footer);
    assert.equal(footer.parentNode===wrapper,true,'footer must start outside the scrolling view');
    for(const id of ['view-home','view-request','view-managers','view-docks']) assert.ok(elements.has(id));
    const rules=postcss.parse(read('assets/app-shell-style-16.css'));
    const nav=rules.nodes.flatMap(n=>n.nodes||[]).find(n=>n.selector?.endsWith('> #bottom-nav'));
    assert.ok(nav,'screen rule must pin the authenticated shell footer');
    const required={position:'fixed',bottom:'0',left:'0',right:'0',display:'flex',visibility:'visible',opacity:'1','z-index':'9990',transform:'none'};
    for(const [prop,value] of Object.entries(required))assert.ok(nav.nodes.some(d=>d.prop===prop && d.value===value && d.important),prop);
    assert.match(nav.selector,/#app-wrapper:not\(\.hidden\)/);
    assert.ok(nav.nodes.some(d=>d.prop==='padding-bottom' && d.value.includes('safe-area-inset-bottom')));
    assert.ok(rules.nodes.flatMap(n=>n.nodes||[]).some(n=>n.selector?.includes('#main-scroll-area') && n.nodes.some(d=>d.prop==='padding-bottom' && d.value==='max(64px, var(--mobile-bottom-nav-height, 64px))' && d.important)));
}

function installBrowserUpdateState(release) {
    window.__APP_SHELL_VERSION__ = 'AgData v' + release;
    window.__APP_RELEASE_VERSION__ = release;
    window.fixtureDocumentToken = crypto.randomUUID();
    window.fixtureAccount = 'fixture_operator';
    const tabNonce = sessionStorage.getItem('fixture-tab') || crypto.randomUUID();
    sessionStorage.setItem('fixture-tab',tabNonce);
    let revision = 0;
    const input = document.querySelector('input');
    input.value = sessionStorage.getItem('fixture-draft') || '';
    window.addEventListener('input', () => revision++);
    document.addEventListener('click', event => {
        if (event.isTrusted && event.target?.id === 'agdata-live-update-pill') sessionStorage.setItem('fixture-tap-at',String(Date.now()));
    },{capture:true});
    window.withBootDeadline = work => work;
    window.getAppUpdateBusyState = () => ({busy:window.captureActive === true});
    window.saveWorkStateBeforeAppUpdate = async () => {
        sessionStorage.setItem('fixture-draft',input.value);
        return {ok:true,snapshotId:crypto.randomUUID(),revision,account:window.fixtureAccount,
            owner:{username:window.fixtureAccount,subject:'fixture-subject'},tabNonce};
    };
    window.isAppUpdateSnapshotCurrent = receipt => receipt.revision === revision && receipt.account === window.fixtureAccount;
    window.commitAppUpdateSnapshotForReload = window.isAppUpdateSnapshotCurrent;
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'AGDATA_SW_CLIENT_VERSION') event.ports[0]?.postMessage({build:window.__APP_SHELL_VERSION__});
    });
}

function browserShellDocument(release) {
    return '<!doctype html><meta name="agdata-release" content="'+release+'">'
        + '<input aria-label="SPEC"><script>('+installBrowserUpdateState.toString()+')('+JSON.stringify(release)+')</script>'
        + '<script src="/assets/live-app-update.js?v='+release+'"></script>'
        + '<script>GncLiveAppUpdate.runtimeReady()</script>';
}

function browserWorkerContent(state, url) {
    if (url.pathname === '/' || url.pathname === '/index.html') {
        if (url.searchParams.has('_reload')) state.navigationAt = Date.now();
        return {body:browserShellDocument(state.published),type:'text/html'};
    }
    if (url.pathname === '/version.json') return {body:JSON.stringify({
        version:state.published,autoApply:state.automatic && state.published === state.target
    }),type:'application/json'};
    return {body:browserWorkerScript(state,url),type:'application/javascript'};
}

function browserWorkerScript(state, url) {
    if (url.pathname === '/sw.js') return state.worker.replaceAll(state.target,url.searchParams.get('v') || state.published);
    if (url.pathname === '/assets/live-app-update.js') return url.searchParams.get('v') === state.prior ? state.legacyClient : state.client;
    if (['/assets/storage-request-guard.js','/assets/service-worker-url.js','/src/core/live-shell-worker.js'].includes(url.pathname)) return read(url.pathname.slice(1));
    return '';
}

function browserWorkerResponse(state, request, response) {
    const url = new URL(request.url,'http://127.0.0.1');
    if (state.delayInstall && url.pathname === '/assets/location-code.js' && url.searchParams.get('v') === state.target) {
        state.heldAsset = response;
        state.installHeldAt = Date.now();
        return;
    }
    const {body,type} = browserWorkerContent(state,url);
    response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});
    response.end(body);
}

async function createBrowserWorkerFixture(options) {
    const target = JSON.parse(read('version.json')).version;
    const prior = options.legacyVersion || target.replace(/\d+$/,patch => String(Number(patch)-1));
    assert.notEqual(prior,target,'the fixture needs distinct prior and target releases');
    const client = read('assets/live-app-update.js');
    const state = {target,prior,published:prior,client,legacyClient:options.legacyClientSource || client,worker:read('sw.js'),
        delayInstall:options.delayInstall === true,automatic:options.automatic === true};
    const server = createServer((request,response) => browserWorkerResponse(state,request,response));
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    return {state,server,url:'http://127.0.0.1:'+server.address().port};
}

async function openBrowserWorkerWindows(context, fixture) {
    const tapped = await context.newPage(), sibling = await context.newPage();
    await tapped.goto(fixture.url+'/index.html?tab=tapped#view-item-detail');
    await sibling.goto(fixture.url+'/index.html?tab=passive#view-request');
    await Promise.all([tapped,sibling].map(page => page.waitForFunction(() => !!navigator.serviceWorker.controller)));
    await tapped.getByRole('textbox',{name:'SPEC'}).fill('tapped draft');
    await sibling.getByRole('textbox',{name:'SPEC'}).fill('passive draft');
    const passive = await sibling.evaluate(() => ({token:fixtureDocumentToken,url:location.href,release:document.querySelector('meta').content}));
    fixture.state.published = fixture.state.target;
    await sibling.bringToFront();
    await sibling.evaluate(() => GncLiveAppUpdate.check('browser-fixture',{force:true}));
    await tapped.bringToFront();
    await tapped.evaluate(() => GncLiveAppUpdate.check('browser-fixture',{force:true}));
    if (fixture.state.delayInstall) await tapped.waitForFunction(() => !!window.__swReg?.installing && !window.__swReg.waiting);
    else await tapped.waitForFunction(() => window.__swReg?.waiting?.state === 'installed');
    assert.match(await tapped.evaluate(() => navigator.serviceWorker.controller.scriptURL),new RegExp('v='+fixture.state.prior.replaceAll('.','\\.')+'$'));
    return {tapped,sibling,passive};
}

function signalBrowserWorkerCapture(active) {
    return new Promise(resolve => {
        const worker = window.__swReg.waiting;
        const listener = event => {
            if (event.source !== worker || event.data?.type !== 'GNC_SHELL_VERSION') return;
            navigator.serviceWorker.removeEventListener('message',listener);
            resolve();
        };
        navigator.serviceWorker.addEventListener('message',listener);
        worker.postMessage({type:'CAMERA_CAPTURE_STATE',active,until:Date.now()+60_000});
        worker.postMessage({type:'GNC_GET_SHELL_VERSION'});
    });
}

async function setBrowserWorkerCapture(page, active) {
    await page.evaluate(signalBrowserWorkerCapture,active);
}

async function applyBrowserWorkerBanner(windows, fixture) {
    const {tapped,sibling} = windows;
    await setBrowserWorkerCapture(sibling,true);
    await setBrowserWorkerCapture(tapped,true);
    await tapped.evaluate(() => { window.captureActive = true; });
    const pill = tapped.locator('#agdata-live-update-pill');
    await pill.click();
    assert.equal(await tapped.evaluate(() => GncLiveAppUpdate.requestApply()),false);
    assert.equal(await tapped.evaluate(() => document.querySelector('meta').content),fixture.state.prior);
    await tapped.getByRole('textbox',{name:'SPEC'}).fill('first safe tap draft');
    await tapped.evaluate(() => { window.captureActive = false; });
    await setBrowserWorkerCapture(tapped,false);
    await clickBrowserWorkerBanner(tapped,fixture.state.target);
    await sibling.waitForFunction(target => new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get('v') === target,fixture.state.target);
}

async function clickBrowserWorkerBanner(page, target) {
    const navigation = page.waitForResponse(response => response.request().isNavigationRequest()
        && new URL(response.url()).searchParams.get('v') === target);
    await page.locator('#agdata-live-update-pill').click();
    const response = await navigation;
    assert.equal(response.status(),200);
    assert.match(await response.text(),new RegExp('name="agdata-release" content="'+target.replaceAll('.','\\.')+'"'));
    await page.waitForURL(url => url.searchParams.get('v') === target);
    await page.waitForLoadState('load');
}

function releaseBrowserWorkerInstall(fixture) {
    fixture.state.delayInstall = false;
    const response = fixture.state.heldAsset;
    fixture.state.heldAsset = null;
    if (!response || response.destroyed || response.writableEnded) return;
    response.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});
    response.end('');
}

async function applyDelayedWorkerBanner(windows, fixture) {
    const {tapped,sibling} = windows;
    await tapped.getByRole('textbox',{name:'SPEC'}).fill('first safe tap draft');
    await clickBrowserWorkerBanner(tapped,fixture.state.target);
    const tappedAt = await tapped.evaluate(() => Number(sessionStorage.getItem('fixture-tap-at')));
    fixture.state.fallbackRequestMs = fixture.state.navigationAt-tappedAt;
    assert.ok(fixture.state.fallbackRequestMs >= 800,'the genuine trusted tap waits for the bounded fallback before requesting target navigation');
    assert.ok(fixture.state.heldAsset,'an unrelated asset holds the real worker installation beyond the navigation fallback');
    await tapped.waitForFunction(tappedAt => Date.now()-tappedAt >= 900,tappedAt);
    fixture.state.installHeldAfterTapMs = Date.now()-tappedAt;
    assert.ok(Date.now()-fixture.state.installHeldAt >= 800,'the installation remains pending beyond the bounded apply timer');
    assert.equal(await tapped.evaluate(() => new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get('v')),fixture.state.prior);
    assert.equal(await sibling.evaluate(() => new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get('v')),fixture.state.prior);
    releaseBrowserWorkerInstall(fixture);
    await Promise.all([tapped,sibling].map(page => page.waitForFunction(target =>
        new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get('v') === target,fixture.state.target)));
}

async function verifyBrowserWorkerWindows(windows, fixture) {
    const {tapped,sibling,passive} = windows;
    assert.equal(await tapped.evaluate(() => document.querySelector('meta').content),fixture.state.target);
    assert.equal(await tapped.getByRole('textbox',{name:'SPEC'}).inputValue(),'first safe tap draft');
    assert.equal(new URL(tapped.url()).hash,'#view-item-detail');
    assert.deepEqual(await sibling.evaluate(() => ({token:fixtureDocumentToken,url:location.href,release:document.querySelector('meta').content})),passive);
    assert.equal(await sibling.getByRole('textbox',{name:'SPEC'}).inputValue(),'passive draft');
    assert.ok((await sibling.evaluate(() => caches.keys())).includes('agdata-v'+fixture.state.prior+'-network-first-r1'));
}

async function verifyAutomaticMobileUpdate(context, fixture) {
    const {state,url} = fixture;
    const page = await context.newPage();
    await page.goto(url+'/index.html#view-item-detail');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const draft = page.getByRole('textbox',{name:'SPEC'});
    await draft.fill('camera draft survives');
    await page.evaluate(() => { window.GncCameraState = {cameraCaptureInFlight:true}; });
    state.published = state.target;
    await page.evaluate(() => GncLiveAppUpdate.check('fixture',{force:true}));
    await page.waitForFunction(() => window.__swReg?.waiting?.state === 'installed');
    await setBrowserWorkerCapture(page,true);
    assert.equal(await page.evaluate(() => document.querySelector('meta').content),state.prior);
    const landed = page.waitForURL(location => location.searchParams.get('v') === state.target);
    await setBrowserWorkerCapture(page,false);
    await page.evaluate(() => {
        window.GncCameraState.cameraCaptureInFlight = false;
        window.dispatchEvent(new Event('agdata:update-work-settled'));
    });
    await landed;
    await page.waitForFunction(target => document.querySelector('meta').content === target
        && new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get('v') === target,state.target);
    assert.equal(await draft.inputValue(),'camera draft survives');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fixture-tap-at')),null);
    assert.equal(new URL(page.url()).hash,'#view-item-detail');
    return {prior:state.prior,target:state.target,automatic:true,cameraDraftPreserved:true};
}

export async function browserWorkerUpgradeContract(options = {}) {
    const {chromium} = await import('playwright');
    const fixture = await createBrowserWorkerFixture(options);
    let browser = options.browser, context;
    try {
        browser ||= await chromium.launch({headless:true,...options.launchOptions});
        const mobile = options.automatic ? {isMobile:true,hasTouch:true,viewport:{width:390,height:844}} : {};
        context = await browser.newContext({serviceWorkers:'allow',...mobile});
        context.setDefaultTimeout(5000);
        if (options.automatic) return await verifyAutomaticMobileUpdate(context,fixture);
        const windows = await openBrowserWorkerWindows(context,fixture);
        if (options.delayInstall) await applyDelayedWorkerBanner(windows,fixture);
        else await applyBrowserWorkerBanner(windows,fixture);
        await verifyBrowserWorkerWindows(windows,fixture);
        return {prior:fixture.state.prior,target:fixture.state.target,delayedInstall:options.delayInstall === true,
            passiveSiblingPreserved:true,fallbackRequestMs:fixture.state.fallbackRequestMs,installHeldAfterTapMs:fixture.state.installHeldAfterTapMs};
    } finally {
        releaseBrowserWorkerInstall(fixture);
        if (context) await context.close();
        if (browser && !options.browser) await browser.close();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}
