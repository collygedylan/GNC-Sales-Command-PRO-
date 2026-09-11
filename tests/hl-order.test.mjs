import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = html.slice(html.indexOf('        let hlOrderSelections ='), html.indexOf('        function getCartSelectedItems()'));
const source = (name) => { const start = html.indexOf(`        function ${name}(`); return html.slice(start, html.indexOf('\n        }', start) + 10); };
const row = (id='a', change={}) => ({ UNIQUE_ID:id, ITEMCODE:'plant-1', COMMONNAME:'Plant <one>', CONTSIZE:'#3',
  LOCATIONCODE:'C.12.001', LOTCODE:'27.F1', DOCK:'4', PLANSTARTDATE:'', QUANTITYORDERED:'10', PTRAVAILABLE:'90', ...change });
function runtime(rows=[row()]) {
  const dialog = { open:false, showModal(){this.open=true;}, close(){this.open=false;} };
  const elements = new Map([['hl-tags-preview',dialog],['hl-tags-preview-content',{}],['hl-tags-send',{}]]);
  const ctx=vm.createContext({ currentUser:'dylan_collyge', nativeAuthSessionActive:true, nativeAuthAccessToken:'fixture-token',
    nativeAuthProfile:{username:'dylan_collyge'}, socInventory:rows, fullInventory:[row('master-a')],
    getProductionMasterDetailStore:()=>({getVerifiedRows:ids=>ctx.fullInventory.filter(r=>ids.includes(r.UNIQUE_ID)),getVerifiedCanonicalRows:ids=>ctx.fullInventory.filter(r=>ids.includes(r.UNIQUE_ID))}), selectedItems:new Set(), selectedItemSources:new Map(),
    cartPanelOpen:false,bloomPickerActionsOpen:false, document:{getElementById:id=>elements.get(id)}, navigator:{onLine:true},
    captureLoginSessionOwnership:()=>({user:'dylan_collyge'}), isLoginSessionOwnershipCurrent:owner=>owner.user===ctx.currentUser,
    ensureDatasetLoaded:async()=>true, canUseVerifiedProductionData:()=>true, updateGlobalActionBar:()=>{},
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    buildFastInvokeAttrs:()=>'', resolveRequestRecipientEmail:()=> 'dylan@example.invalid', REQUEST_EMAIL_SCRIPT_TIMEOUT_MS:1000,
    getGoogleScriptEmailFailureMessage:(_response,fallback)=>fallback, errors:[], sends:[], showToast:(_title,message,error)=>{if(error)ctx.errors.push(message);},
    postGoogleScriptJsonPayload:async payload=>{ctx.sends.push(payload);return {ok:true,mode:'gmailapp_named',recipients:['dylan@example.invalid']};},
  });
  vm.runInContext(source('parseAppNumber')+'\n'+block,ctx);
  return ctx;
}
function add(ctx){ const group=ctx.groupHlOrderRows(ctx.getHlOrderRows())[0];ctx.orderHlGroup(group.key);return group; }

test('HL eligibility implements exact/prefix boundaries and dock OR plan date',()=>{
  const ctx=runtime();
  for(const location of ['C.05','0.00.111','c.12.002',' B.10.011 ','C.14.888']){
    for(const fields of [{DOCK:'3',PLANSTARTDATE:''},{DOCK:null,PLANSTARTDATE:'2020-01-01'},{DOCK:'3',PLANSTARTDATE:'2026-09-11'}])
      assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a',{LOCATIONCODE:location,...fields}))),true);
  }
  for(const location of ['C.050','C.05.001','0.00.1112','C.12','C.120.001','B.100.001','C.14.','A.01.000',''])
    assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a',{LOCATIONCODE:location}))),false,location);
  assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a',{DOCK:'  ',PLANSTARTDATE:null}))),false);
  assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a',{ITEMCODE:'',CONTSIZE:''}))),true);
});
test('only active native Dylan identity can view or select HL data',()=>{
  const ctx=runtime();assert.equal(ctx.canUseHlOrder(),true);
  for(const change of [{username:'jd_jones'},{disabled_at:'2026-01-01'},{locked_until:'2999-01-01'},{must_change_password:true}]){
    ctx.nativeAuthProfile={username:'dylan_collyge',...change}; assert.equal(ctx.getHlOrderRows().length,0);
  }
  ctx.nativeAuthProfile={username:'dylan_collyge'};ctx.currentUser='jd_jones';assert.equal(ctx.canUseHlOrder(),false);
  ctx.currentUser='dylan_collyge';ctx.nativeAuthSessionActive=false;assert.equal(ctx.canUseHlOrder(),false);
});
test('SOC source stays authoritative after linked master enrichment',()=>{
  const original=row();const ctx=runtime([{...original,LOCATIONCODE:'A.01.001',QUANTITYORDERED:'999',HL_SOC_SOURCE:original}]);
  const [record]=ctx.getHlOrderRows();assert.equal(record.locationcode,'C.12.001');assert.equal(record.quantityordered,'10');
});
test('grouping sums order quantities once per SOC ID and keeps sizes separate',()=>{
  const ctx=runtime([row(),row(),row('b',{QUANTITYORDERED:'15'}),row('c',{CONTSIZE:'#7'})]);
  const groups=ctx.groupHlOrderRows(ctx.getHlOrderRows());assert.equal(groups.length,2);
  assert.equal(groups.find(g=>g.contsize==='#3').quantity,25);
});
test('missing or invalid ordered quantities stay visible for review and cannot be ordered',()=>{
  for(const value of ['',null,'bad','0','-1','0x10','1e3','Infinity']){const ctx=runtime([row('a',{QUANTITYORDERED:value})]); const group=add(ctx);assert.equal(group.invalid,true);assert.equal(ctx.selectedItems.size,0);}
});
test('location availability is displayed once and never summed across SOC orders',()=>{
  const ctx=runtime([row(),row('b')]);const detail=ctx.buildHlOrderDetailsHtml(ctx.getHlOrderRows());
  assert.equal((detail.match(/Available:/g)||[]).length,1);assert.ok(detail.includes('<strong>90</strong>'));assert.ok(!detail.includes('180'));
  ctx.fullInventory=[];assert.match(ctx.buildHlOrderDetailsHtml(ctx.getHlOrderRows()),/Not available/);
});
test('Order is duplicate-free and preserves other Bloom selections',()=>{
  const ctx=runtime();ctx.selectedItems.add('unrelated');ctx.selectedItemSources.set('unrelated','drive');add(ctx);add(ctx);
  assert.equal(ctx.selectedItems.size,2);assert.equal(ctx.getSelectedHlOrderRows().length,1);
});
test('SOC refresh changes and removals require review without replacing saved selection',async()=>{
  for(const rows of [[],[row('a',{QUANTITYORDERED:'11'})],[row('a',{LOCATIONCODE:'B.10.001'})]]){
    const ctx=runtime();add(ctx);ctx.socInventory=rows;await assert.rejects(ctx.verifyHlOrderSelection(),/changed or was removed/);
    assert.equal(ctx.getSelectedHlOrderRows()[0].quantityordered,'10');
  }
});
test('confirmed HL send uses reviewed SOC quantities and clears only those selections',async()=>{
  const ctx=runtime();ctx.selectedItems.add('other');ctx.selectedItemSources.set('other','drive');add(ctx);
  await ctx.openHlTagsPreview();await ctx.sendHlTagsEmail();assert.equal(ctx.sends.length,1);
  assert.equal(ctx.sends[0].emailSubType,'hl_tags');assert.equal(ctx.sends[0].sourceRows[0].quantityordered,'10');
  assert.equal(ctx.sends[0].skipDylanRecipientOverride,true);assert.deepEqual([...ctx.selectedItems],['other']);assert.deepEqual(ctx.errors,[]);
});
test('failed or ambiguous email retains selection and never retries automatically',async()=>{
  for(const response of [{ok:false},{ok:true},{ok:true,mode:'gmailapp_named',recipients:['other@example.invalid']}]){
    const ctx=runtime();add(ctx);ctx.postGoogleScriptJsonPayload=async p=>{ctx.sends.push(p);return response;};
    await ctx.openHlTagsPreview();await ctx.sendHlTagsEmail();assert.equal(ctx.sends.length,1);assert.equal(ctx.selectedItems.size,1);assert.equal(ctx.errors.length,1);
  }
});
test('preview membership changes and logout prevent sending',async()=>{
  const ctx=runtime([row(),row('b',{ITEMCODE:'other'})]);ctx.orderHlGroup(ctx.groupHlOrderRows(ctx.getHlOrderRows()).find(g=>g.itemcode==='plant-1').key);await ctx.openHlTagsPreview();
  ctx.orderHlGroup(ctx.groupHlOrderRows(ctx.getHlOrderRows()).find(g=>g.itemcode==='other').key);
  await ctx.sendHlTagsEmail();assert.equal(ctx.sends.length,0);
  ctx.currentUser='jd_jones';ctx.resetHlOrderState();assert.equal(ctx.selectedItems.size,0);assert.equal(ctx.getSelectedHlOrderRows().length,0);
});

 test('availability requires a unique exact verified master, with no SOC fallback',()=>{
  const ctx=runtime();
  for(const masters of [[],[row('master-a',{LOTCODE:'OTHER'})],[row('master-a'),row('master-b')],
    [row('master-a',{PTRAVAILABLE:null})],[row('master-a',{PTRAVAILABLE:'bad'})],[row('master-a',{PTRAVAILABLE:'-1'})],
    [row('master-a',{PTRAVAILABLE:'2'}),row('master-a',{PTRAVAILABLE:'3'})]]) {
    ctx.fullInventory=masters;assert.equal(ctx.getHlOrderRows()[0].ptravailable,'');
  }
  ctx.fullInventory=[row('master-a',{LOCATIONCODE:' c.12.001 ',PTRAVAILABLE:'0'})];
  assert.equal(ctx.getHlOrderRows()[0].ptravailable,'0');
  assert.equal(ctx.getHlOrderRows()[0].source.ptravailable,'90');
  ctx.getProductionMasterDetailStore=()=>({getVerifiedCanonicalRows:()=>null});
  assert.equal(ctx.getHlOrderRows()[0].ptravailable,'');
});


test('binding an already verified availability batch requests one fresh render',async()=>{
  const ctx=runtime([row(),row('c',{LOCATIONCODE:'C.14.002'})]);
  const masters=[row('master-a',{PTRAVAILABLE:null}),row('master-c',{LOCATIONCODE:'C.14.002',PTRAVAILABLE:'0'})];
  ctx.fullInventory=masters;
  const batch=ids=>ids.length===2 && ids.includes('master-a') && ids.includes('master-c') ? masters : null;
  ctx.getProductionMasterDetailStore=()=>({getVerifiedRows:batch,getVerifiedCanonicalRows:batch});
  const rows=ctx.getHlOrderRows();
  assert.deepEqual(Array.from(rows,r=>r.ptravailable),['','']);
  assert.equal(await ctx.ensureHlOrderAvailability(rows),true);
  assert.deepEqual(Array.from(ctx.getHlOrderRows(),r=>r.ptravailable),['','0']);
  assert.equal(await ctx.ensureHlOrderAvailability(rows),false);
});
