import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'parse5';
import postcss from 'postcss';
import { harness, origin, request, shellResponse } from './root-service-worker-fixture.mjs';

const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

export async function upgradeOpenWindows() {
    const version = JSON.parse(read('package.json')).version;
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
    assert.equal(h.calls.skipWaiting,1,'complete installation requests activation without a page snapshot');
    const sender = { id:'old', url:stale.url };
    await h.dispatch('message',{source:sender,data:{type:'SKIP_WAITING'}});
    assert.equal(h.calls.skipWaiting,1,'an invalid legacy message does not issue a second activation request');
    await h.dispatch('message',{source:sender,data:{type:'SKIP_WAITING',protocol:'agdata-update-restore-v1',snapshotId:'saved-draft',targetBuild:'AgData v'+version}});
    assert.equal(h.calls.skipWaiting,2);
    await h.dispatch('activate');
    assert.deepEqual((await h.caches.keys()).sort(),[key,...old].sort(),'open tabs retain their versioned assets and photos');
    assert.equal(h.calls.claims,1);
    assert.deepEqual(h.calls.navigated.map(entry => entry.id), ['old'], 'only the verified legacy window requires worker navigation');
    const navigated = new URL(h.calls.navigated[0].url);
    assert.equal(navigated.searchParams.get('approvalId'), 'keep');
    assert.equal(navigated.searchParams.get('shellv'), 'AgData v'+version);
    assert.equal(navigated.hash, '#tag');
    for (const id of ['old','unknown','compatible']) {
        assert.ok(h.calls.messages.some(c=>c.id===id && c.message.type==='GNC_SHELL_VERSION' && c.message.build==='AgData v'+version));
    }
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
