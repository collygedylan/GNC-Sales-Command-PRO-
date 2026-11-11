import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export function assertDetailKeyboardVisibility() {
  const input={isConnected:true,style:{},closest:()=>true,getAttribute:()=>null,before(){},removeAttribute(){}};
  const rect={left:16,width:358,height:44};
  const placeholder={style:{},getBoundingClientRect:()=>rect,remove(){}};
  input.getBoundingClientRect=()=>rect;
  const context=vm.createContext({window:{innerHeight:844,innerWidth:390,visualViewport:{offsetTop:0,height:844,width:390}},
    document:{createElement:()=>placeholder,querySelector:()=>({getBoundingClientRect:()=>({bottom:48})})},
    getDetailMeasurementKeyboardVisibleHeight:()=>260,escapeShareHtml:String});
  for(const name of ['detail-keypad-insertion','request-detail-summary']) {
    vm.runInContext(fs.readFileSync(new URL('../../assets/'+name+'.js',import.meta.url),'utf8'),context);
  }
  context.pinActiveDetailField(input);
  assert.match(input.style.cssText,/color:#FACC15!important/);
  const top=Number(input.style.cssText.match(/top:([\d.]+)px/)[1]);
  assert.ok(top>=48 && top+44<=584);
  for(const type of ['spec','caliper','match','av-note']) {
    const next=context.resolveDetailKeypadInsertion(type,{value:'N/A',start:3,end:3},'5');
    assert.equal(next.nextValue,'5');
  }
  const strip=context.renderRequestCompactSummary({extras:[],commonName:'Green Giant',topCode:'000808.050.1'});
  assert.match(strip,/height:44px;max-height:48px/);
  assert.equal((strip.match(/request-reference-line/g)||[]).length,1);
}
