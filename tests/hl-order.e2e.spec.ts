import { expect, test, type Page } from '@playwright/test';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';
const id='54c87ebf-d76d-452b-96b4-beaaeb1742d9';
const soc=(unique_id:string,changes={})=>({unique_id,itemcode:'SYNTH.003',commonname:'Synthetic HL Holly',contsize:'#3',locationcode:'C.12.001',
  lotcode:'27.F1',quantityordered:'10',ptravailable:null,dock:'4',planstartdate:null,transactionnumber:'SYNTH-ORDER', ...changes});
async function fixture(page:Page,baseURL:string,username='dylan_collyge') {
  const origin=new URL(baseURL).origin;
  // Dismiss notification onboarding through its real controls if it interrupts this data flow.
  await page.addLocatorHandler(page.locator('#push-permission-help-modal'), async modal => {
    await modal.getByRole('button',{name:'Close',exact:true}).click();
  });
  await page.addLocatorHandler(page.locator('#mobile-push-enable-prompt'), async prompt => {
    await prompt.getByRole('button',{name:'Dismiss',exact:true}).click();
  });
  const state={rows:[soc('hl-a'),soc('hl-b',{quantityordered:'15'}),soc('hl-c',{quantityordered:'5',locationcode:'C.14.002'}),soc('hl-excluded',{locationcode:'C.120.001'})],revision:1,
    master:[inventoryReadFixture.row({unique_id:'master-hl-a',itemcode:'SYNTH.003',commonname:'Synthetic HL Holly',contsize:'#3',locationcode:'C.12.001',lotcode:'27.F1',ptravailable:'90',warehouseid:'10',warehousei:'10',season:'F1',saleyear:'27'}),inventoryReadFixture.row({unique_id:'master-hl-c',itemcode:'SYNTH.003',commonname:'Synthetic HL Holly',contsize:'#3',locationcode:'C.14.002',lotcode:'27.F1',ptravailable:'42',warehouseid:'10',warehousei:'10',season:'F1',saleyear:'27'})],
    sends:[] as any[],fail:false,errors:[] as string[],mutations:[] as string[],runtime:0,
    revisionGate:null as Promise<void>|null,revisionReads:0};
  const profile={id,username,display_name:username,role:'ADMIN',division:'10',language:'English',disabled_at:null,locked_until:null,must_change_password:false};
  const claims={sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)};
  const token=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify(claims)).toString('base64url'),'synthetic'].join('.');
  const session={access_token:token,refresh_token:'synthetic',expires_at:claims.exp,expires_in:3600,token_type:'bearer',
    user:{id,aud:'authenticated',role:'authenticated',email:'hl-test@example.invalid',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}};
  const json=(route:any,value:any,status=200,extra={})=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*',...extra},body:JSON.stringify(value)});
  page.on('pageerror',e=>state.errors.push(e.message));
  page.on('response',r=>{if(/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(r.url()).pathname))state.runtime++;});
  await page.routeWebSocket('**/*',socket=>socket.close());
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    if(url.origin===origin && ['GET','HEAD'].includes(method))return route.continue();
    if(method==='OPTIONS')return json(route,{});
    if(url.pathname.startsWith('/auth/v1/'))return json(route,url.pathname.endsWith('/user')?session.user:session);
    if(url.hostname==='script.google.com'||url.hostname==='script.googleusercontent.com'){
      const body=req.postDataJSON()||{};
      if(body.type==='email'){
        state.sends.push(body);
        expect(body.emailSubType).toBe('hl_tags');
        return json(route,state.fail?{ok:false,message:'Synthetic email failure'}:{ok:true,mode:'gmailapp_named',recipients:['dylan_collyge@greenleafnursery.com']});
      }
      return json(route,{ok:true,active:false});
    }
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const op=url.pathname.split('/').pop(),body=req.postDataJSON()||{};
      if(op==='get_my_dataset_revisions_v1'){
        state.revisionReads++;const gate=state.revisionGate;if(gate)await gate;
        return json(route,{contractVersion:1,permissionVersion:'hl-policy-1',sources:(body.p_dataset_keys||[]).map((key:string)=>({key,revision:String(state.revision),state:'ready'}))});
      }
      if(op==='get_my_app_permissions_v1')return json(route,{contractVersion:'app-access-v1',enforcementMode:'enforced',username,role:'ADMIN',permissions:[]});
      if(op==='get_request_capabilities')return json(route,{contract_version:2,username,scope:'global',can_view_queue:true,can_edit:true,can_complete:true});
      if(op==='get_request_schema_compatibility')return json(route,{compatible:true,contract_version:2});
      if(/^(get_|list_|report_app_health_event)/.test(op||''))return json(route,[]);
      state.mutations.push(`RPC ${op}`);return json(route,{error:'Blocked'},403);
    }
    if(url.pathname.startsWith('/rest/v1/')){
      if(!['GET','HEAD'].includes(method)){state.mutations.push(`${method} ${url.pathname}`);return json(route,{},403);}
      const table=url.pathname.split('/').pop();
      if(table==='profiles')return json(route,/vnd\.pgrst\.object/.test(req.headers().accept||'')?profile:[profile]);
      if (url.searchParams.get('select')==='filename,last_updated' && url.searchParams.get('last_updated')==='not.is.null') return json(route,[]);
      const rows=table==='ph_soc_master'?state.rows:table==='ph_master_inventory'?inventoryReadFixture.read(state.master,url.search.slice(1)).rows:[];
      return json(route,rows,200,{'content-range':rows.length?`0-${rows.length-1}/${rows.length}`:'*/0'});
    }
    if(url.pathname.endsWith('/functions/v1/app-api')){
      const body=req.postDataJSON()||{};
      if(body.action==='native_session_bridge')return json(route,{ok:true,session:{token:'synthetic-bridge',expiresAt:Date.now()+3600000,username,displayName:username,role:'ADMIN'}});
      if(body.action==='db' && String(body.method).toUpperCase()==='GET')return json(route,{ok:true,data:body.table==='ph_soc_master'?state.rows:body.table==='ph_master_inventory'?inventoryReadFixture.read(state.master,body.query||'').rows:[]});
      if(body.action==='season_sales_office' && body.operation==='access')return json(route,{ok:true,allowed:false,canManage:false,users:[]});
      if(['list','get','state'].includes(body.operation)||/get|load|status|preferences|capabilit|health|telemetry|event/.test(body.action||''))return json(route,{ok:true,data:[],preferences:{},eligible:false});
      state.mutations.push(`API ${body.action}:${body.operation||''}`);return json(route,{ok:false,error:'Blocked'},403);
    }
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(value=>localStorage.setItem('gnc_supabase_auth_v1',JSON.stringify(value)),session);
  await page.goto('/',{waitUntil:'load'});
  await page.waitForFunction(()=>window.eval('typeof nativeAuthProfile !== "undefined" && !!nativeAuthProfile'));
  await expect(page.locator('#view-login')).toBeHidden();
  expect(state.runtime).toBe(1);
  return state;
}

test('HL cards group SOC rows, open locations, and send reviewed quantities only after confirmation',async({page,baseURL},info)=>{
  const state=await fixture(page,baseURL!);
  await page.locator('#home-tile-hl-order').click();
  await expect(page.locator('[data-hl-group]')).toHaveCount(1);
  const card=page.locator('[data-hl-group]');await expect(card).toContainText('Ordered: 30');
  await card.getByRole('button',{name:'View HL locations'}).click();
  await expect(card).toContainText('Available: 90');
  await expect(card).toContainText('Available: 42');
  expect(await card.getByText('Available:',{exact:false}).count()).toBe(2);
  await expect.poll(async()=>{ const bounds=await card.boundingBox(); return !!bounds && bounds.x+bounds.width<=page.viewportSize()!.width+1; }).toBe(true);
  await card.getByRole('button',{name:'Order HL plants',exact:true}).click();
  await page.evaluate(()=>window.eval('orderHlGroup(groupHlOrderRows(getHlOrderRows())[0].key)'));
  await expect(page.locator('#sel-count')).toHaveText('3');
  await page.locator('#batch-btn-hl-tags').click();
  await expect(page.locator('#hl-tags-preview')).toBeVisible();
  await expect(page.locator('#hl-tags-preview-content')).toContainText('dylan_collyge@greenleafnursery.com');
  expect(state.sends).toHaveLength(0);
  await page.screenshot({path:info.outputPath('hl-tags-preview.png')});
  state.fail=true;await page.locator('#hl-tags-send').click();
  await expect.poll(()=>state.sends.length).toBe(1);await expect(page.locator('#hl-tags-send')).toBeEnabled();
  await expect(page.locator('#sel-count')).toHaveText('3');
  state.fail=false;await page.locator('#hl-tags-send').click();
  await expect(page.locator('#hl-tags-preview')).not.toBeVisible();
  await expect(page.locator('#sel-count')).toHaveText('0');
  expect(state.sends).toHaveLength(2);expect(state.sends[1].sourceRows.map((r:any)=>r.quantityordered)).toEqual(['10','15','5']);
  expect(state.errors).toEqual([]);expect(state.mutations).toEqual([]);
});
test('SOC refresh updates grouped cards and blocks emailing changed selected quantities',async({page,baseURL})=>{
  const state=await fixture(page,baseURL!);await page.locator('#home-tile-hl-order').click();
  await page.getByRole('button',{name:'Order HL plants',exact:true}).click();
  state.rows[0].quantityordered='12';state.revision++;
  // Capture the displayed warning before unrelated notification onboarding can replace the toast.
  await page.evaluate(()=>{
    const messages:string[]=[];(window as any).__hlToastMessages=messages;
    const toast=document.getElementById('toast-notification')!;
    new MutationObserver(()=>messages.push(toast.textContent||''))
      .observe(toast,{childList:true,subtree:true,characterData:true});
  });
  await page.locator('#batch-btn-hl-tags').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__hlToastMessages.some((text:string)=>text.includes('changed')))).toBe(true);
  await expect(page.locator('#hl-tags-preview')).not.toBeVisible();
  await expect(page.locator('#sel-count')).toHaveText('3');
  await expect(page.locator('[data-hl-group]')).toContainText('Ordered: 32');
  expect(state.sends).toHaveLength(0);expect(state.mutations).toEqual([]);
});
test('another admin cannot see or open HL Order',async({page,baseURL})=>{
  const state=await fixture(page,baseURL!,'jd_jones');
  await expect(page.locator('#home-tile-hl-order')).toBeHidden();await expect(page.locator('#drawer-hl-order-btn')).toBeHidden();
  expect(await page.evaluate(()=>window.eval('canAccessView("hl-order")'))).toBe(false);
  await page.evaluate(()=>window.eval('switchView("hl-order")'));
  await expect(page.locator('#view-hl-order')).toBeHidden();expect(state.sends).toHaveLength(0);
});

test('missing master availability stays unknown while a real zero stays zero',async({page,baseURL})=>{
  const state=await fixture(page,baseURL!);
  state.master[0].ptravailable=null;state.master[1].ptravailable='0';
  await page.locator('#home-tile-hl-order').click();
  await page.getByRole('button',{name:'View HL locations'}).click();
  await expect(page.locator('[data-hl-group]')).toContainText('Available: 0');
  await expect(page.locator('[data-hl-group]')).toContainText('Available: Not available');
  expect(state.errors).toEqual([]);expect(state.mutations).toEqual([]);
});

test('expanded HL availability recovers after an unchanged master verification finishes',async({page,baseURL})=>{
  const state=await fixture(page,baseURL!);
  state.master[0].ptravailable=null;state.master[1].ptravailable='0';
  await page.locator('#home-tile-hl-order').click();
  await expect(page.locator('[data-hl-group]')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>window.eval('canUseVerifiedProductionData(["soc","master"])'))).toBe(true);
  // Finish view-entry verification and its delayed first-paint render before
  // opening the race window; otherwise that render can conceal the defect.
  await page.evaluate(()=>window.eval('getProductionLiveSyncCoordinator().check("hl-availability-settle")'));
  await expect.poll(()=>page.evaluate(()=>window.eval('!productionLiveSyncRenderTimer && canUseVerifiedProductionData(["soc","master"])'))).toBe(true);

  let releaseRevisionRead:()=>void=()=>{};
  state.revisionGate=new Promise<void>(resolve=>{releaseRevisionRead=resolve;});
  const priorReads=state.revisionReads;
  try {
    // Hold an unchanged revision check after it removes the old verification
    // fence. Expanding now must not expose unverified availability.
    await page.evaluate(()=>window.eval('void getProductionLiveSyncCoordinator().check("hl-availability-regression")'));
    await expect.poll(()=>state.revisionReads).toBeGreaterThan(priorReads);
    await expect.poll(()=>page.evaluate(()=>window.eval('canUseVerifiedProductionData(["master"])'))).toBe(false);
    await page.getByRole('button',{name:'View HL locations'}).click();
    await expect(page.locator('[data-hl-group]').getByText('Not available',{exact:true})).toHaveCount(2);
    // Drain any render already scheduled by view entry while metadata is
    // still held, so it cannot refresh the card after the release below.
    await expect.poll(()=>page.evaluate(()=>window.eval('!productionLiveSyncRenderTimer'))).toBe(true);

    // No revision or payload changes, so a commit callback alone cannot
    // repair the card. Verification completion must refresh the open card.
    state.revisionGate=null;releaseRevisionRead();
    await expect(page.locator('[data-hl-group]')).toContainText('Available: 0');
    await expect(page.locator('[data-hl-group]').getByText('Not available',{exact:true})).toHaveCount(1);
    expect(state.errors).toEqual([]);expect(state.mutations).toEqual([]);
  } finally {
    state.revisionGate=null;releaseRevisionRead();
  }
});
