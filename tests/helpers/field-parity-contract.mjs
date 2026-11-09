import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const runtime = read('assets/app-runtime.js'), workflow = read('assets/row-workflow-functions.js');
function install(ctx, src, names) {
    for(const name of names) {
        const fn=src.match(new RegExp('^( *)((?:async )?function '+name+'\\([^]*?^\\1})','m'));
        assert.ok(fn,name);vm.runInContext(fn[2],ctx);
    }
}
export function mediaParity() {
    const master=(name,item,location,count)=>({UNIQUE_ID:item+'@'+location,COMMONNAME:name,ITEMCODE:item,LOCATIONCODE:location,LOTCODE:'27.F1',PRIORITY:1,PHOTO_DATE:'2026-11-03',PHOTOS:[...Array(count).keys()].map(i=>'https://fixture/'+item+'/'+i)});
    const inventory=[master('Taylor Juniper','000745.070.1','G.12.000',4),master('Greenleaf American Holly','003620.150.1','F.05.000',3),master('Taylor Juniper','000745.070.1','OTHER',1)];
    const state={},dates=new Map();
    const ctx=vm.createContext({fullInventory:inventory,avOpenInventory:[],inventoryDomIdLookupCacheVersion:1,queueCardInventoryRenderVersion:0,
        getSupabaseReadIdentityScope:()=>'account',getManagerAssignedColumnState:()=>state,getRowPhotoLink:item=>item.PHOTOS?.join(',') || '',getSharedAppPhotoLinkCsvRaw:item=>item.PHOTOS?.join(',') || '',
        getPhotoUrlList:v=>Array.isArray(v)?v:v?String(v).split(','):[],resolveCanonicalInventoryRow:r=>inventory.find(item=>item.UNIQUE_ID===r.UNIQUE_ID)||r,resolveAndFormatPhotoDate:(row,url)=>{if(row.PHOTO_DATE)dates.set(url,row.PHOTO_DATE);return dates.get(url);},
        isPhotoEntryExpired:()=>false,getRequestPhotoLinkCsv:()=>'',getDockOwnedPhotoLinkCsv:()=>''});
    install(ctx,workflow,['inventoryPhotoLocationKey','getInventoryLocationPhotos','getAvRowPhotoUrls']);
    install(ctx,runtime,['resolveCanonicalPhotoUrls','avItemHasPhotos','getDetailPhotoGalleryGroups']);
    for (const [i,n] of [[0,4],[1,3]]) {
        const m=inventory[i],row={UNIQUE_ID:m.UNIQUE_ID,ITEMCODE:m.ITEMCODE.toLowerCase(),LOCATIONCODE:' '+m.LOCATIONCODE.toLowerCase()+' ',PRIORITY:'-',LOTCODE:'27.F1'};
        for (const view of ['drive','av','request','docks','detail']) assert.equal(ctx.resolveCanonicalPhotoUrls(row,view).length,n,view);
        const gallery=ctx.getDetailPhotoGalleryGroups(row,'request');
        assert.equal(gallery[0].prefix,'');assert.equal(gallery[0].link.split(',').length,n);
        assert.equal(dates.get(m.PHOTOS[0]),m.PHOTO_DATE);
    }
    assert.equal(inventory.filter(r=>r.LOCATIONCODE==='G.12.000' && r.COMMONNAME.toLowerCase().includes('taylor') && ctx.avItemHasPhotos(r))[0].ITEMCODE,'000745.070.1');
    for (const [i,term,count] of [[0,'taylor',4],[1,'greenleaf',3]]) {
        const candidate = {...inventory[i], PHOTOS:[]};
        assert.ok(candidate.COMMONNAME.toLowerCase().includes(term) && ctx.avItemHasPhotos(candidate));
        assert.equal(ctx.getInventoryLocationPhotos(candidate).length,count);
    }
    assert.equal(ctx.getInventoryLocationPhotos({ITEMCODE:inventory[0].ITEMCODE,LOCATIONCODE:'MISSING'}).length,0);
}
export function queueParity() {
    const state={itemcodeDefaultOwners:new Map()},settings={};const ctx=vm.createContext({getManagerAssignedColumnState:()=>state,normalizeEvalAssignableUser:v=>String(v||'').toLowerCase(),
        GncUserAccessControl:{resolveUserAccessMatrix:user=>settings[user]},suspendTagRawSourceRowsReady:true,socRawSourceRowsReady:true,
        getActiveAssignedQueueCounts:()=>({pending:2,'suspend-tag':0}),getAssignedQueueOwner:r=>r.owner,isDockSuspendDcRequestMirrorRow:r=>r.suspend});
    install(ctx,workflow,['queueAccessScope','getQueueScopeFilter','isQueueOwnerVisible','isSuspendTabAvailable']);
    install(ctx,runtime,['getRequestQueueAlertCount']);
    for (const user of ['dylan_collyge','megan_kelly','jd_jones','nelly_aguilar','nally_aguilar','morgan_anderson','other_admin']) {
        ctx.currentUser=user;
        const req=ctx.queueAccessScope('pending'),su=ctx.queueAccessScope('suspend-tag');
        assert.equal(req.all,user!=='other_admin');assert.equal(req.initial,req.all?'ALL':user);
        assert.equal(su.all,['dylan_collyge','megan_kelly','jd_jones'].includes(user));assert.equal(su.initial,user==='jd_jones'?'ALL':req.user);
        assert.equal(ctx.isSuspendTabAvailable(),su.all);assert.equal(ctx.isQueueOwnerVisible({owner:'another',suspend:false}),req.all);
    }
    ctx.currentUser='dylan_collyge';assert.equal(ctx.getQueueScopeFilter('pending'),'ALL');assert.equal(ctx.getQueueScopeFilter('suspend-tag'),'dylan_collyge');
    settings.dylan_collyge={view_all_requests:'N',request_default_scope:'ALL',view_all_suspend:'Y',suspend_default_scope:'ALL'};
    assert.equal(ctx.getQueueScopeFilter('pending'),'dylan_collyge');assert.equal(ctx.getQueueScopeFilter('suspend-tag'),'dylan_collyge');
    assert.equal(ctx.getRequestQueueAlertCount({pending:2,'suspend-tag':167}),169);
}
export function interactionParity() {
    const frames=new Map(),vibrations=[],ctx=vm.createContext({fieldSearchFrames:new WeakMap(),navigator:{vibrate:p=>vibrations.push(p)},
        requestAnimationFrame:cb=>{const key=frames.size+1;frames.set(key,cb);return key;},cancelAnimationFrame:key=>frames.delete(key),escapeHtml:s=>s});
    install(ctx,runtime,['triggerHaptic','scheduleFieldSearch','rememberDetailReturnPosition']);install(ctx,workflow,['normalizeQueueNoteText','escapeQueueNoteText']);
    const input={isConnected:true,value:'t'};let painted='';for(const term of ['t','ta','tay','taylor']){input.value=term;ctx.scheduleFieldSearch(input,()=>{painted=input.value;});}
    assert.equal(painted,'');assert.equal(frames.size,1);[...frames.values()][0]();assert.equal(painted,'taylor');
    for(const style of ['light','medium','success'])ctx.triggerHaptic(style);assert.deepEqual(JSON.parse(JSON.stringify(vibrations)),[8,15,[12,30,18]]);
    ctx.getMainAreaScrollTop=()=>453;ctx.rememberDetailReturnPosition('request');assert.equal(ctx.detailReturnState.scrollTop,453);
    assert.equal(ctx.escapeQueueNoteText('5'+String.fromCharCode(92)+"' H"),"5' H");
    assert.match(workflow,/refreshLocalRequestViewState\('row-completion-pending'/);assert.match(runtime,/applyConfirmedRequestCompletionReceipt\(itemToSave,receipt,requestSaveIdentityScope\)/);assert.ok(runtime.includes('compact ? 1600'));assert.ok(!runtime.toLowerCase().includes('saved; inventory refresh pending'));
}
export async function watchdogParity() {
    const mod={exports:{}};vm.runInNewContext(read('assets/runtime-watchdog-panel.js'),{module:mod,Date});
    const writes=[],recent={id:2,status:'open',last_seen_at:new Date().toISOString(),username:'field',error_message:'UI_ERROR_BANNER_SHOWN:detail:LOCK_TIMEOUT'};
    const version=JSON.parse(read('package.json')).version,sha='0'.repeat(40);
    const panel=mod.exports.createController({document:{getElementById:()=>null},getUsername:()=>'jd_jones',getBuild:async()=>({release:'AgData v'+version,commit:sha}),
        getRevisions:()=>({master:{revision:'11'}}),clipboard:{writeText:async value=>writes.push(value)},showToast(){},
        postJson:async(...args)=>args[1].offset?{data:[{id:3,status:'resolved'}]}:{data:[recent],hasMore:true,fixBrief:'# AgData Runtime Watchdog Fix Brief OLD'}});
    await Promise.all([panel.copyFixBrief(),panel.copyFixBrief()]);assert.equal(writes.length,1);assert.equal(writes[0].split('# AgData Runtime Watchdog Fix Brief').length,2);
    assert.ok(writes[0].includes('AgData v'+version));assert.ok(writes[0].includes(sha));assert.ok(writes[0].includes('"revision":"11"'));assert.ok(writes[0].includes('Open Incidents: 1'));
}

export async function reviewerParity() {
    let writes=0;const ctx=vm.createContext({currentUser:'dylan_collyge',APP_VERSION:'3.0.5',getSupabaseReadIdentityScope:()=>'actor',SUPABASE_URL:'https://fixture',
        getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer fixture'}),fetchWithTimeout:async(url,options)=>{
            writes++;assert.equal(options.headers['x-client-info'],'agdata/3.0.5');assert.equal(url,'https://fixture/rest/v1/rpc/resolve_runtime_watchdog_events_v23158');assert.deepEqual(JSON.parse(options.body),{p_ids:[940]});
            return {ok:true,json:async()=>({ok:true,resolved:1,confirmed_ids:[940]})};
        }});
    install(ctx,workflow,['resolveReviewedWatchdogEvents']);
    assert.equal((await ctx.resolveReviewedWatchdogEvents([940])).resolved,1);
    ctx.currentUser='field';await assert.rejects(ctx.resolveReviewedWatchdogEvents([940]),/REVIEW_DENIED/);assert.equal(writes,1);
}

export async function avNameParity() {
    const state={},timers=[],renders=[];
    const row={UNIQUE_ID:'verified-master',ITEMCODE:'000745.070.1',LOCATIONCODE:'G.12.000',LOTCODE:'27.F1',PHOTOS:['https://fixture/1','https://fixture/2','https://fixture/3','https://fixture/4'],COMMONNAME:'Taylor Juniper'};
    const ctx=vm.createContext({activeAVTab:'open',getAvPhotoMode:()=>'photos',getAvSearchTerm:()=>'taylor',getExactAvSearchItemCode:()=>'',isViewVisible:v=>v==='av',
        getManagerAssignedColumnState:()=>state,getSupabaseReadIdentityScope:()=>'actor',appAccessSnapshotState:{snapshot:{dataPermissionVersion:'one'}},
        getRequestItemCodeOptionCommonNameSearchPattern:()=>'*taylor*',setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},URLSearchParams,
        fetchRequestItemCodeOptionRowsFromSupabase:async(lookup,opts)=>{assert.equal(new URLSearchParams(lookup.slice(1)).get('commonname'),'ilike.*taylor*');assert.equal(opts.maxRows,120);return [row];},
        formatFetchedRows:rows=>rows,buildSearchIndex:r=>r,scheduleAVRender:()=>renders.push('av'),fullInventory:[],avOpenInventory:[],
        inventoryDomIdLookupCacheVersion:1,queueCardInventoryRenderVersion:1,resolveCanonicalInventoryRow:r=>r,getSharedAppPhotoLinkCsvRaw:r=>r.PHOTOS.join(','),getPhotoUrlList:s=>Array.isArray(s)?s:String(s).split(','),isPhotoEntryExpired:()=>false,resolveAndFormatPhotoDate:()=>''});
    install(ctx,workflow,['inventoryPhotoLocationKey','getInventoryLocationPhotos','rememberInventoryLocationPhotoRows','getAvNamePhotoSearchRows','getAvRowPhotoUrls']);
    install(ctx,runtime,['avItemHasPhotos']);
    assert.equal(ctx.getAvNamePhotoSearchRows('taylor').length,0);assert.equal(ctx.getAvNamePhotoSearchRows('taylor').length,0);assert.equal(timers.length,1);
    await timers[0]();assert.deepEqual(renders,['av']);
    const rows=ctx.getAvNamePhotoSearchRows('taylor');
    assert.equal(rows.filter(r=>ctx.avItemHasPhotos(r))[0].ITEMCODE,row.ITEMCODE);
    assert.equal(ctx.getInventoryLocationPhotos({UNIQUE_ID:row.UNIQUE_ID,ITEMCODE:row.ITEMCODE,LOCATIONCODE:row.LOCATIONCODE,LOTCODE:row.LOTCODE,PRIORITY:'-'}).length,4);
    assert.equal(ctx.getInventoryLocationPhotos({ITEMCODE:row.ITEMCODE,LOCATIONCODE:row.LOCATIONCODE,PRIORITY:'-'}).length,0);
    assert.match(runtime,/const eligible = getAvSalesRowsForBucket\(activeAvSalesBucket,extra\)/);
    assert.match(runtime,/applyAvColumnFiltersToItems\(photos\)\.filter\(createAvTopFilterPredicate\(\)\)/);
}

function fixtureClassList(flags) {
    return {contains:key=>flags.has(key),toggle(key,force) {
        if (force ?? !flags.has(key)) flags.add(key); else flags.delete(key);
        return flags.has(key);
    }};
}
export async function showroomContract() {
    const controls = {dataset:{}}, handlers = [], flags = new Set();
    const view = {classList:fixtureClassList(flags)};
    const ctx = vm.createContext({document:{getElementById:id => id === 'view-av' ? view : null},
        window:{},getCurrentVisibleViewId:()=>'',ensureAvControlsVisible(){}, setContainerHtml:(el,html)=>{el.innerHTML=html;},
        buildExcelFilterFastAttrs:name=>{handlers.push(name);return 'data-handler="'+name+'"';}});
    install(ctx,read('assets/av-filter-markup.js'),['ensureAvTopControlsShell','buildAvRailMarkup','buildAvRailViewFields','buildAvRailAccountFields']);
    install(ctx,workflow,['formatAvReadySummary','syncAvKioskMode']);
    assert.equal(ctx.ensureAvTopControlsShell(controls),true);
    assert.deepEqual([...controls.innerHTML.matchAll(/data-av-filter-shell="([^"]+)"/g)].map(m=>m[1]),
        ['source','season','genus','contsize','hold','salesrep','customer','columns']);
    assert.deepEqual(handlers.slice(0,8), ['toggleAvSourceDropdown','toggleAvSeasonDropdown','toggleAvGenusDropdown','toggleAvContSizeDropdown','toggleAvHoldDropdown','toggleAvSalesRepDropdown','toggleAvRepCustomerDropdown','toggleAvColumnFilterDropdown']);
    assert.equal(ctx.formatAvReadySummary('Current Season',3284),'CURRENT SEASON · 3,284 ITEMS READY');
    assert.match(controls.innerHTML, /id="av-filter-options" class="av-top-controls-row">/);
    assert.doesNotMatch(read('index.html'), /av-kiosk-toggle|av-reset-btn/);
    assert.equal(ctx.syncAvKioskMode(), false);
    const card = read('assets/av-inventory-card.js');
    assert.doesNotMatch(card,/buildEvalOwnerBadge|card-eval-owner/);
    for (const token of ['app-av-catalog-title','app-av-catalog-size','app-av-catalog-price','buildInventoryQuantityChipsHtml','app-av-catalog-bloom-row','ph-leaf']) assert.ok(card.includes(token), token);
    const workflowCards = [runtime,read('assets/request-inventory-card.js'),read('assets/workflow-inventory-card.js')];
    for (const line of ['app-suspend-tag-compact-card','app-request-compact-card','const driveChipRowHtml']) {
        assert.ok(workflowCards.some(source=>source.split('\n').some(s=>s.includes(line) && s.includes('buildEvalOwnerBadge(item)'))),line);
    }
    const css = read('assets/app-shell-style-16.css');
    assert.match(css,/#av-content\s*\{[^}]*margin-top:\s*8px !important;\s*padding-top:\s*0 !important/);
    assert.doesNotMatch(runtime.match(/const FIXED_FILTER_RAIL_VIEW_IDS[\s\S]*?\]/)[0],/'av'/);
    assert.doesNotMatch(runtime,/Loading full inventory…/);
    for (const rule of ['repeat(2, minmax(0, 1fr))','repeat(4, minmax(0, 1fr))','repeat(auto-fill, minmax(420px, 1fr))','repeat(3,minmax(0,1fr))','@media (min-width: 768px)','@media (min-width: 1280px)','.av-kiosk-mode','.av-filters-hidden']) assert.ok(css.includes(rule),rule);
    mediaParity();
    await avNameParity();
}


