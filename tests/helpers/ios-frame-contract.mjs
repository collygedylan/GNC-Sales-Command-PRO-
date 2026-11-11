import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const runtime = [source('assets/app-runtime.js'), source('assets/row-workflow-functions.js')].join('\n');
function declaration(text, name) {
    const match = text.match(new RegExp('^( *)function ' + name + '\\([^]*?^\\1}', 'm'));
    assert.ok(match, name);
    return match[0];
}

export function iosFrameContract() {
    const kernel = { window: {}, queueMicrotask };
    vm.runInNewContext(source('assets/agdata-kernel.js'), kernel);
    const frames = [];
    let active = 'home', paints = 0;
    const scheduler = (kernel.window.AgDataKernel || kernel.AgDataKernel).sync.createViewRenderScheduler({
        getActiveView: () => active, enqueue: callback => frames.push(callback)
    });
    const region = { firstElementChild: {}, innerHTML: '' }, receipts = new WeakMap();
    const ctx = vm.createContext({ window: { innerWidth: 390 }, requestAnimationFrame: fn => frames.push(fn) });
    vm.runInContext(declaration(runtime, 'syncRequestChromeMarkup') + '\n' + declaration(runtime, 'onLayoutWidthChange'), ctx);
    for (const view of ['home','request:pending','request:suspend-tag','managers:assigned-items','drive','av']) {
        active = view;
        const render = value => scheduler.scheduleCoalescedViewRender(view, () => {
            if (ctx.syncRequestChromeMarkup(region, value, receipts)) paints++;
        });
        const before = paints;
        render('old'); render(view); render(view);
        assert.equal(frames.length, 1); frames.shift()();
        render(view); frames.shift()();
        assert.equal(paints, before + 1);
        render(view + ' changed'); frames.shift()(); assert.equal(paints, before + 2);
    }

    const renderNodes = { 'home-dynamic-content': region, 'home-dashboard-content': {classList:{add() {}}} };
    Object.assign(ctx, { document: { getElementById: id => renderNodes[id] }, getCurrentVisibleViewId: () => 'home',
        syncGoogleScriptButton() {}, auditLocalRequestDurability: async () => {}, shouldUseRepSalesHomeHub: () => true,
        getRepHomeDashboardHtml: () => '<article>Drive</article>', homeMarkupByNode: new WeakMap(), assertRepHomeModuleParity() {} });
    vm.runInContext(declaration(runtime, 'renderHome'), ctx);
    let replacements = 0, markup = '';
    Object.defineProperty(region, 'innerHTML', {get: () => markup, set: value => { replacements++; markup = value; region.firstElementChild = {}; }});
    ctx.renderHome(); const tile = region.firstElementChild; ctx.renderHome();
    assert.equal(replacements, 1); assert.equal(region.firstElementChild, tile);

    ctx.getManagerAssignedColumnDefinitions = () => [['DEFAULT_ASSIGNEDTO'], ['ITEMCODE']];
    vm.runInContext(declaration(source('assets/row-workflow-functions.js'), 'sameAssignedDisplayRows'), ctx);
    const rows = [{ UNIQUE_ID: 'lot', ITEMCODE: 'A', DEFAULT_ASSIGNEDTO: 'rep' }];
    assert.equal(ctx.sameAssignedDisplayRows(rows, rows.map(row => ({...row}))), true);
    assert.equal(ctx.sameAssignedDisplayRows(rows, [{...rows[0], DEFAULT_ASSIGNEDTO: 'new'}]), false);
    assert.equal(ctx.sameAssignedDisplayRows(rows, [{...rows[0], UNIQUE_ID: 'other'}]), false);

    ctx.avRenderChunkToken = 7;
    vm.runInContext(declaration(runtime, 'retainAvChunk'), ctx);
    const list = { __avPendingChunk: {token: 7, signature: 'lot-a'} };
    assert.equal(ctx.retainAvChunk(list, 'lot-a'), true);
    assert.equal(ctx.retainAvChunk(list, 'lot-b'), false);
    ctx.avRenderChunkToken++; assert.equal(ctx.retainAvChunk(list, 'lot-a'), false);

    const boot = [];
    Object.assign(ctx, { document: {documentElement: {classList: {toggle: (_name, value) => boot.push(value)}}} });
    ctx.window.isAuthenticatedAppSessionActive = () => true;
    vm.runInContext(declaration(runtime, 'setBootingSession'), ctx);
    ctx.setBootingSession(true);
    ctx.window.isAuthenticatedAppSessionActive = () => false;
    ctx.setBootingSession(true);
    assert.deepEqual(boot, [false, true]);
    let layouts = 0;
    const resize = ctx.onLayoutWidthChange(() => layouts++);
    ctx.window.innerHeight = 420; resize(); resize(); assert.equal(layouts, 0);
    ctx.window.innerWidth = 844; resize(); resize(); assert.equal(layouts, 1);
    const queue = declaration(runtime, 'renderRequest');
    for (const read of ['refreshRequestViewInBackground','scheduleRequestRenderSideData','loadManagerItemcodeDefaultOwners']) assert.ok(!queue.includes(read), read);
    const manager = declaration(runtime, 'renderManagerAssignedItemsExportPanel');
    assert.doesNotMatch(manager, /ensureDatasetLoaded|loadManagerItemcodeDefaultOwners/);
    assert.match(declaration(runtime, 'setReqTab'), /scheduleRequestRenderSideData/);
    assert.match(declaration(runtime, 'refreshViewDatasetsOnEnter'), /scheduleRequestRenderSideData/);
    assert.match(declaration(runtime, 'renderHome'), /syncRequestChromeMarkup/);
    assert.match(declaration(runtime, 'initializeIosRuntimeSelfHeal'), /onLayoutWidthChange/);
    assert.match(declaration(runtime, 'initializeViewportModeSync'), /onLayoutWidthChange/);
    const styles = source('assets/app-shell-style-16.css');
    assert.match(styles, /html,\s*body,\s*#app,\s*main,\s*\.view-section[^}]*background-color:\s*#04140d\s*!important/);
    assert.match(styles, /@supports\s*\(-webkit-touch-callout:\s*none\)[^]*backdrop-filter:\s*none\s*!important[^]*will-change:\s*auto\s*!important[^]*contain:\s*none\s*!important/);
}

export function iosReloadContract() {
    let now = 1000;
    const values = new Map();
    const life = source('assets/app-lifecycle.js');
    const claims = life.slice(life.indexOf('const reloadClaims'), life.indexOf('let forcedVersionUpgrade'));
    function documentClaim() {
        const root = { sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } };
        vm.runInNewContext(claims, {root, Date:{ now: () => now }, normalizeAgDataVersion: version => version.replace(/^AgData v/, '')});
        return root.claimShellReloadOnce;
    }
    const current = [3, 7, 11].join('.');
    assert.equal(documentClaim()(current), true);
    assert.ok(values.has('agdata_ios_reload_guard_v23154'));
    assert.equal(documentClaim()('AgData v' + current), false);
    const next = [3, 7, 12].join('.');
    now += 59999; assert.equal(documentClaim()(next), false);
    now++; assert.equal(documentClaim()(next), true);
    now += 60000; assert.equal(documentClaim()(current), false);
    const worker = source('sw.js');
    assert.doesNotMatch(worker, /await client\.navigate\(buildAbsoluteShellUrl/);
    const update = source('assets/live-app-update.js');
    const controller = update.slice(update.indexOf("addEventListener?.('controllerchange'"), update.indexOf('const resumed='));
    assert.match(controller, /askWorkerVersion\(worker\)/);
    assert.match(controller, /finishBannerActivation\(worker,version\).*rememberTarget\(version\)/);
    assert.match(update, /worker.postMessage\(\{type:'GNC_GET_SHELL_VERSION'\}\)/);
    assert.doesNotMatch(controller, /reloadForServiceWorkerUpdate\(\)/);
}
