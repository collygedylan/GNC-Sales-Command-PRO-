import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const runtime = read('assets/app-runtime.js');
function install(ctx, source, names) {
    for (const name of names) {
        const match = source.match(new RegExp('^( *)((?:async )?function '+name+'\\([^]*?^\\1})','m'));
        assert.ok(match,name);
        vm.runInContext(match[2],ctx);
    }
}
export function keypadContract(source = runtime + '\n' + read('assets/row-workflow-functions.js')) {
    const input = {id:'req-spec',value:'',dataset:{},selectionStart:0,selectionEnd:0,setSelectionRange(){}};
    const preview = {}, keyboard = {classList:{contains:()=>true,remove(){}},dataset:{}};
    const ctx = vm.createContext({detailMeasurementKeyboardTarget:input,detailMeasurementKeyboardType:'spec',
        detailMeasurementKeyboardChoiceOpen:'',detailMeasurementKeyboardAvNoteMode:'letters',detailMeasurementKeyboardRenderSignature:'',
        document:{activeElement:null,getElementById:id=>id.includes('value-preview')?preview:null},
        getDetailMeasurementKeyboardTypeForInput:()=>ctx.detailMeasurementKeyboardType,
        markDetailMeasurementKeyboardInteraction(){},triggerDetailKeyboardHaptic(){},activeItem:{},getCompletedRowUnlockKey:()=>1,
        getSupabaseReadIdentityScope:()=>1,clearTimeout(){},setTimeout(){},ensureDetailMeasurementKeyboardElement:()=>keyboard,
        syncDetailMeasurementKeyboardLayout(){},requestAnimationFrame(){},isIOSDevice:()=>false,
        esc:s=>String(s).replaceAll("'","\\'"),escapeHtml:s=>String(s).replaceAll("'","&#39;")});
    install(ctx,source,['pressDetailMeasurementKeyboardToken','resolveDetailMeasurementKeyboardToken','pressDetailMeasurementKeyboardKey',
        'getDetailMeasurementKeyboardSelection','getDetailMeasurementKeyboardKeys','updateDetailMeasurementKeyboardTargetValue',
        'normalizeDetailMeasurementKeyboardValueForInput','normalizeDetailSpecTextForSave','getNormalizedDetailMeasurementCursor','renderDetailMeasurementKeyboard']);
    for (const token of ['1','2','-','1','4','double_quote','H','x','1','4','-','1','6','double_quote','W']) {
        ctx.pressDetailMeasurementKeyboardToken(token);
        assert.equal(preview.textContent,input.value);
    }
    assert.equal(input.value,'12-14" H x 14-16" W');
    for (let value = input.value; value; value=value.slice(0,-1)) {
        ctx.pressDetailMeasurementKeyboardToken('__backspace');
        assert.equal(input.value,value.slice(0,-1));
    }
    for(const token of ['5','-','6','apostrophe'])ctx.pressDetailMeasurementKeyboardToken(token);
    assert.equal(input.value,"5-6'");
    ctx.renderDetailMeasurementKeyboard();
    assert.match(keyboard.innerHTML,/FT (?:&#39;|')<\/button>/);
    input.dataset.detailKeypadCursorStart=input.dataset.detailKeypadCursorEnd='1';
    ctx.pressDetailMeasurementKeyboardToken('4');
    assert.equal(input.value,"5-6'4");
    ctx.detailMeasurementKeyboardType='match'; ctx.pressDetailMeasurementKeyboardToken('__clear');
    for(const token of ['9','5','.','.','5','__backspace'])ctx.pressDetailMeasurementKeyboardToken(token);
    assert.equal(input.value,'95.'); assert.equal(preview.textContent,'95.');
}
export function queueDetailContract() {
    const ctx = vm.createContext({getRequestItemCodeOptionItemCode:()=> '008125.031.1', activeItem:{},
        ensureRequestItemCodeOptionState:()=>state, getSupabaseReadIdentityScope:()=> 'account',
        getRequestSharedInventoryOptionRows:()=>rows,hasCompleteRequestOptionSnapshot:()=>true,
        canFetchRequestItemCodeOptionsFromSupabase:()=>true});
    const rows = Array.from({length:10},(_,i)=>({PTRAVAILABLE:i? 100:625})), state={key:'row',loaded:false};
    install(ctx,runtime,['loadRequestItemCodeOptions']);
    const css = read('assets/app-shell-style-16.css');
    assert.match(css,/#request-suspend-tag-card-list[^{}]*\{[^}]*content-visibility: visible !important; contain: none !important/);
    assert.doesNotMatch(runtime,/Checking AV options\.\.\./);
    assert.match(runtime,/AgMetricStableViewDom.apply\(cardContainer, renderTarget\)/);
    assert.match(runtime,/AgMetricStableViewDom.apply\(container, target\)/);
    return ctx.loadRequestItemCodeOptions({}).then(()=>{assert.equal(state.loaded,true);assert.equal(state.rows,rows);assert.ok(!state.loading);});
}
export function watchdogViewportContract() {
    const alerts=[],nav={style:{setProperty(){}},getBoundingClientRect:()=>({bottom:820})},activeClasses=new Set();
    const doc={hidden:false,visibilityState:'visible',documentElement:{clientHeight:760},body:{dataset:{currentView:'detail'},classList:{contains:k=>activeClasses.has(k)}},
        getElementById:id=>id==='bottom-nav'?nav:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
    const ctx=vm.createContext({document:doc,global:{innerHeight:760,visualViewport:{offsetTop:80,height:740}},state:{username:'test'},
        reportField:(...a)=>alerts.push(a),reportHandledRuntimeIssue:()=>true,isIgnorableRuntimeNoise:()=>false});
    install(ctx,read('assets/runtime-watchdog.js'),['inspectIntegrity','observeError']);
    ctx.inspectIntegrity(null,'detail');assert.equal(alerts.length,0);
    ctx.global.visualViewport.offsetTop=0; activeClasses.add('detail-measurement-keyboard-open');
    ctx.inspectIntegrity(null,'detail');assert.equal(alerts.length,0);
    activeClasses.clear();ctx.inspectIntegrity(null,'detail');assert.equal(alerts[0][2],'FOOTER_OFFSCREEN');
    assert.equal(ctx.observeError('rpc',{name:'AbortError'},false,'RPC_FAILURE'),false);
    doc.visibilityState='hidden';assert.equal(ctx.observeError('rpc','TIMEOUT',false,'RPC_FAILURE'),false);
}
