import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
import { installAssignedPlantGroupFixture } from './assigned-items-hydration-contract.mjs';

const read = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8');
function bind(file, name, context) {
    const source=read(file);
    const start=source.indexOf('function '+name+'(');
    assert.ok(start>=0,name);
    const prefix=source.slice(Math.max(0,start-6),start)==='async ' ? start-6 : start;
    const syntax=parseExpressionAt(source,prefix,{ecmaVersion:'latest'});
    return vm.runInNewContext('('+source.slice(prefix,syntax.end)+')',context);
}
const fragment='assets/row-workflow-functions.js';
export async function suspendSelectionContract() {
    const match=bind(fragment,'isSuspendPullItemMatch',{});
    assert.ok(match('000150.008.','000150.008.1'));
    for(const [candidate,code] of [['008125.081.1','008125.031.1'],['000150.003.1','000150.008.1'],['000150','000150.008.1']]) assert.equal(match(candidate,code),false);
    let added,confirmed=0;
    const row={LOCATIONCODE:'F.14.000',LOTCODE:'27.F1',UNIQUE_ID:'master'},source={UNIQUE_ID:'tag'};
    const choose=bind(fragment,'chooseSuspendPullLocation',{getRequestItemCodeOptionRows:()=>[row],isFalseBlockLocation:()=>false,addSelectedDockSuspendDcRequestOptions:(rows,tag)=>{added=[rows,tag];},changeSuspendPullLocation:()=>{confirmed++;}});
    choose(source,{querySelector:()=>({value:'F.14.000'}),close(){}});
    assert.equal(added[0][0],row);assert.equal(added[1],source);assert.equal(confirmed,0);
    let prompt;
    const confirm=bind(fragment,'confirmSuspendLocationChange',{isFalseBlockLocation:()=>false,getDockSuspendDcRequestGroupParts:()=>({dock:'52',drop:'10',consignee:'Shop'}),getDockOrderedQtyDisplay:()=>8,showAppConfirm:(message,options)=>{prompt={message,options};return false;}});
    assert.equal(confirm({ITEMCODE:'008125.031.1',COMMONNAME:'Pugster'},['F.14.000']),false);
    assert.match(prompt.message,/Dock 52 · Drop 10/);assert.match(prompt.message,/Pull Order From: F.14.000/);assert.equal(prompt.options.confirmLabel,'✓ Confirm & Update Docks');
}
export function assignmentKeypadContract() {
    const ui={}, inv=[{ITEMCODE:'008125.031.1',GENUSNAME:'Buddleia',plantgroupcode:'SHRUB'}];
    const context = vm.createContext({getManagerAssignedColumnState:()=>ui,fullInventory:inv,
        buildManagerEvalAssignmentKey:v=>String(v||''),firstNonEmptyValue:(...values)=>values.find(Boolean)});
    installAssignedPlantGroupFixture(context);
    const [row]=context.enrichManagerAssignedPlantGroups([{ITEMCODE:'008125.081.1'}]);assert.equal(row.GENUSNAME,'Buddleia');assert.equal(row.PLANTGROUPCODE,'SHRUB');
    const runtime='assets/app-runtime.js';
    const columns=bind(runtime,'getManagerAssignedColumnDefinitions',{})();
    assert.deepEqual(Array.from(columns.slice(0,9),c=>c[0]),['ASSIGNEDTO','DEFAULT_ASSIGNEDTO','WAREHOUSEI','LOCATIONCODE','ITEMCODE','CONTSIZE','COMMONNAME','GENUSNAME','PLANTGROUPCODE']);
    const input={value:'',dataset:{detailKeypadCursorStart:'0',detailKeypadCursorEnd:'0'}};
    const selection=bind(fragment,'getDetailMeasurementKeyboardSelection',{detailMeasurementKeyboardType:'spec'});
    const insertion = bind('assets/detail-keypad-insertion.js','resolveDetailKeypadInsertion',{});
    const press=bind(runtime,'pressDetailMeasurementKeyboardKey',{detailMeasurementKeyboardType:'spec',
        detailMeasurementKeyboardTarget:input,detailMeasurementKeyboardChoiceOpen:'',triggerDetailKeyboardHaptic(){},
        resolveDetailKeypadInsertion:insertion,getDetailMeasurementKeyboardSelection:selection,
        updateDetailMeasurementKeyboardTargetValue(value,cursor) {
            input.value=value;
            input.dataset.detailKeypadCursorStart=input.dataset.detailKeypadCursorEnd=String(cursor);
        }});
    for(const token of ['1','2','-','1','4','"']) press(token);
    assert.equal(input.value,'12-14"');press('__backspace');assert.equal(input.value,'12-14');
}
export function quotaContract() {
    const rt=read('assets/app-runtime.js'),sw=read('sw.js'),css=read('assets/app-shell-style-16.css');
    assert.equal((rt.match(/\.channel\s*\(/g)||[]).length,1);
    assert.match(rt,/\.on\('postgres_changes', \{ event: '\*', schema: 'public', table: 'app_dataset_revisions'/);
    assert.match(sw,/AgDataStorageGuard/);
    const original=bind('assets/app-runtime.js','publicStorageObjectPath',{});
    const thumbnail=bind('assets/app-runtime.js','buildSupabaseStorageThumbnailUrl',{
        URL,window:{location:{href:'https://example.invalid'}},isSupabaseStorageHost:host=>host==='kzrnyjsosryejjejliii.supabase.co',
        publicStorageObjectPath:original,getSupabaseStaticV2ThumbnailUrl:()=>'',SUPABASE_STORAGE_TRANSFORM_PARAMS:['width','height','quality','format','resize']});
    assert.equal(new URL(thumbnail('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/render/image/public/p/customer/a.jpg')).pathname,
        '/storage/v1/object/public/p/customer/a.jpg');
    assert.equal(original('/storage/v1/render/image/public/p/customer/a.jpg'),'p/customer/a.jpg');
    let subscriptions=0;
    const arm=bind('assets/live-sync-coordinator.js','arm',{options:{explicitNavigationOnly:true,
        subscribe:()=>{subscriptions++;return ()=>{};}},pollTimer:null,subscribedScope:'',unsubscribe:null,
        closeSubscription(){},later(){assert.fail('idle polling timer');}});
    const visible={scope:'account',visible:true,online:true};
    arm(visible);arm(visible);assert.equal(subscriptions,1);
    assert.match(rt,/Date.now\(\)-navigationRevisionCache.started >= 300000/);
    assert.match(css,/#bottom-nav\s*\{[^}]*bottom:0 !important/);assert.match(css,/content-visibility:visible !important/);
    const index=read('index.html');assert.match(index,/id="side-drawer-logout-btn" onclick="performLogout\(\)"/);
    assert.match(index,/class="drawer-profile-logout" onclick="performLogout\(\)"/);
}
