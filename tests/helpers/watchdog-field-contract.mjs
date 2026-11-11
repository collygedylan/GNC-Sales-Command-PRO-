import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {inspectWatchdogQueueControls,inspectWatchdogFooter} from '../../src/services/watchdog-queue-controls.js';
import {readReviewedWatchdogEvents} from '../../src/services/watchdog-review-transport.js';
const read = file => readFileSync(new URL('../../'+file, import.meta.url),'utf8');

export async function reviewedQueueWatchdogContract() {
    const visible = node => !node.hidden;
    const select = {offsetWidth:220,options:[{value:'pending'}]};
    const bar = {clientWidth:220,querySelector:()=>select,querySelectorAll:()=>[]};
    assert.equal(inspectWatchdogQueueControls(bar,visible),'');
    select.options = [];
    assert.equal(inspectWatchdogQueueControls(bar,visible),'EMPTY_TABS');
    const url='https://fixture.test/rest/v1/rpc/read_reviewed_watchdog_events_v3074';
    const request = {action:'watchdog_list_events',offset:250,includeResolved:true};
    let scope='reviewer', sent=0;
    const ctx = vm.createContext({SUPABASE_URL:'https://fixture.test',getSupabaseReadIdentityScope:()=>scope,
        getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer fixture'}),
        fetchWithTimeout:async (endpoint,init)=>{
            assert.equal(endpoint,url);
            assert.equal(init.headers.Authorization,'Bearer fixture');
            assert.deepEqual(JSON.parse(init.body),{p_offset:250,p_include_resolved:true});
            sent++;
            return {ok:true,json:async()=>({ok:true,data:[{id:1,status:'open'}],hasMore:false})};
        }});
    vm.runInContext(readReviewedWatchdogEvents.toString(),ctx);
    assert.equal((await ctx.readReviewedWatchdogEvents(url,request)).data[0].status,'open');
    ctx.getNativeAuthRequestHeaders = async () => { scope='another'; return {Authorization:'Bearer fixture'}; };
    await assert.rejects(ctx.readReviewedWatchdogEvents(url,request),/SESSION_REQUIRED/);
    await assert.rejects(ctx.readReviewedWatchdogEvents(url,{action:'watchdog_resolve_events'}),/PARAMETERS_INVALID/);
    assert.equal(sent,1);
}

export async function fieldWatchdogContract() {
    let now=100000, observer, rendered=[], foreign=false;
    const reports=[],timers=[],store=new Map();
    const docRoot={querySelector:()=>null,querySelectorAll:()=>[]};
    const doc={body:{dataset:{currentView:'request'}},documentElement:{},hidden:false,
        getElementById:id=>({'view-request':docRoot,'request-filter-toolbar':bar,'bottom-nav':footer,'footer-request-badge':badge}[id]),
        querySelector:()=>null,querySelectorAll:()=>rendered,addEventListener(){}};
    const select={offsetWidth:300,options:[{value:'pending'},{value:'suspend-tag'}]};
    const bar={clientWidth:300,querySelector:()=>select,querySelectorAll:()=>buttons,closest:()=>null};
    const buttons=[],footer={style:{setProperty(){}},getBoundingClientRect:()=>({top:750,bottom:820,height:70}),closest:()=>null};
    const badge={textContent:'186',closest:()=>null}; 
    const win={__APP_RELEASE_VERSION__:'AgData v2.3.80',innerHeight:780,addEventListener(){},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
        localStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k),removeItem:k=>store.delete(k)}};
    class Observer {constructor(fn){observer=fn;}observe(){}}
    vm.runInNewContext(read('assets/runtime-watchdog.js'),{window:win,document:doc,inspectWatchdogFooter,MutationObserver:Observer,Date:class extends Date{static now(){return now;}},setTimeout:win.setTimeout,clearTimeout(){}});
    win.inspectWatchdogQueueControls = inspectWatchdogQueueControls;
    const dog=win.GncRuntimeWatchdog;
    dog.configure({username:'field_eval',role:'Eval',memoryOnly:true, getQueueAudit:()=>({total:24,foreign}),
        reportEvent:async event=>{reports.push({...event});return {ok:true};}});
    dog.inspect();
    await new Promise(setImmediate);
    assert.ok(!reports.some(event=>/EMPTY_TABS|WIDE_TAB/.test(event.error_message)));
    select.options=[{value:'',disabled:true}];
    const banner={nodeType:1,textContent:'Could Not Complete Tag — SUSPEND_TAG_DATABASE_55P03 private customer token',closest:()=>null,
        matches:()=>true,querySelectorAll:()=>[],getClientRects:()=>[{}]};
    dog.observeError('Could Not Complete Tag',banner.textContent,true);
    rendered=[banner];observer([{target:banner,addedNodes:[banner]}]);dog.inspect();
    for(const text of ['SUSPEND_TAG_DATABASE_42501','Restricted','Move Not Saved','Row remains locked','timed out after 4s'])dog.observeError('',text,true);
    select.offsetWidth=0;buttons.push({offsetWidth:295,closest:()=>null});foreign=true;dog.inspect();
    await new Promise(setImmediate);
    assert.equal(reports.filter(r=>r.error_message.includes('55P03')).length,1,'direct and DOM reports coalesce');
    for(const code of ['55P03','42501','RESTRICTED','MOVE_NOT_SAVED','ROW_LOCKED','TIMEOUT','EMPTY_TABS','WIDE_TAB','FOOTER_OFFSCREEN','BADGE_EXCESS','FOREIGN_OWNER'])
        assert.ok(reports.some(r=>r.error_message.includes(code)),code);
    assert.ok(reports.every(r=>r.username==='field_eval' && !JSON.stringify(r).includes('private customer')));
    now+=60001;dog.observeError('',banner.textContent,true);await new Promise(setImmediate);
    assert.equal(reports.filter(r=>r.error_message.includes('55P03')).length,1,'a repeated fingerprint sends once per session');
}

export async function watchdogReviewContract() {
    const module={exports:{}};vm.runInNewContext(read('assets/runtime-watchdog-panel.js'),{module,Date});
    const past=days=>new Date(Date.now()-days*86400000).toISOString();
    let username='dylan_collyge',tab='dashboard';const badge={style:{},classList:{toggle(){}},setAttribute(){},dataset:{}};
    const host={innerHTML:'',querySelectorAll:()=>[]},events=[
        {id:1,fingerprint:'lock-wait',status:'open',last_seen_at:past(1),app_version:'2.3.70',event_type:'UI_ERROR_BANNER_SHOWN',username:'alice',normalized_role:'evaluator'},
        {id:2,fingerprint:'lock-wait',status:'open',last_seen_at:past(2),app_version:'2.3.71',event_type:'UI_ERROR_BANNER_SHOWN',username:'bob',normalized_role:'admin'},
        {id:3,fingerprint:'expired',status:'open',last_seen_at:past(8),app_version:'2.3.69',username:'old-user'}];
    const panel=module.exports.createController({document:{getElementById:id=>id==='runtime-watchdog-events'?host:badge},getUsername:()=>username,
        getProfileId:()=>username,getVisibleView:()=>'managers',getActiveTab:()=>tab,panelViewId:'runtime-watchdog',escape:String,
        postJson:async()=>({ok:true,data:events,hasMore:false})});
    for(username of ['dylan_collyge','megan_kelly','jd_jones']){await panel.refreshBadge(true);assert.equal(badge.hidden,false);assert.match(badge.textContent,/WATCHDOG 1/);}
    tab='runtime-watchdog';await panel.refreshPanel();
    for(const label of ['v2.3.70','v2.3.71','alice','evaluator','bob','Mark Resolved'])assert.ok(host.innerHTML.includes(label),label);
    assert.ok(!host.innerHTML.includes('old-user'));
    username='unlisted_admin';await panel.refreshBadge(true);assert.equal(badge.hidden,false);assert.equal(badge.disabled,true);
    username='';await panel.refreshBadge(true);assert.equal(badge.hidden,true);
    const markup=read('index.html').match(/<button[^>]*id="runtime-watchdog-header-badge"[^>]*>/)?.[0];assert.match(markup,/openRuntimeWatchdogFromHeader/);
    const fn=read('assets/row-workflow-functions.js').match(/function openRuntimeWatchdogFromHeader\([^]*?\n}/)[0];
    const routed=[];const ctx={currentUser:'jd_jones',getCurrentVisibleViewId:()=>'home',switchView:view=>routed.push(view),setHomeTab:t=>routed.push(t),MANAGER_RUNTIME_WATCHDOG_VIEW:'runtime-watchdog'};
    vm.runInNewContext(fn+';openRuntimeWatchdogFromHeader()',ctx);assert.deepEqual(routed,['managers','runtime-watchdog']);
}
