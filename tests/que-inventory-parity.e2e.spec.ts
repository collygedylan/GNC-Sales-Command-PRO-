import { readFileSync } from 'node:fs';
import { test, expect, type Route } from '@playwright/test';
import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';
import { realtimeFeed } from './fixtures/que-realtime-feed';
import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
// @test-group: @home-role
test.use({trace:'off',screenshot:'off',timezoneId:'Asia/Tokyo'});

test('Que inventory, thumbnails, PLANSTART and navigation retain parity through live repaints', {tag:['@home-role']}, async ({page,baseURL},info)=>{
  test.setTimeout(240000);
  const feed=realtimeFeed();
  const photo=(id:string)=>`https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/2026-10-17/que-${id}.png`;
  const master=Array.from({length:10000},(_,i)=>hlMaster(`parity-master-${String(i).padStart(5,'0')}`,{
    itemcode:i===0?'004380.010.1':`PARITY-${String(i).padStart(5,'0')}`,locationcode:'C.09.000',lotcode:'27.F1',source:'1',
    commonname:`Que parity ${String(i).padStart(5,'0')}`,ptronhand:'89',ptrreviewed:'27',ptravailable:'62',s_lts:'61',
    photo_link:photo(String(i)),photo_name:`2026-10-17-que-${i}.png`,match:'100',initial_ptr:'62',date_completed:new Date().toISOString(),loc_match_qty:'62',last_updated:'2026-10-17T12:00:00Z'
  }));
  master.push(hlMaster('parity-other-lot',{itemcode:'004380.010.1',locationcode:'C.09.000',lotcode:'27.F2',source:'1',ptronhand:'11'}));
  const makeRows=(prefix:string,count:number)=>Array.from({length:count},(_,i)=>({
    unique_id:`${prefix}-${String(i).padStart(5,'0')}`,itemcode:i===0?'43800101':master[i].itemcode,
    locationcode:'c.9.0',lotcode:'27.F1',commonname:master[i].commonname,contsize:'#3',season:'F1',saleyear:'27',
    req_status:'Pending',req_archived:false,req_qty:'10',quantityordered:'10',request_folder:'Parity',requested_by:'dylan_collyge',
    req_customer:'Parity customer',customername:'Parity customer',consigneename:'Parity consignee',salesrepname:'Dylan Collyge',
    assignedto:'dylan_collyge',suspend_tag_version:1,suspend_tag_status:'pending',dock_num:'1',stopnumber:'1',
    planstart:`10/${19+i%5}/2026`,last_updated:'2026-10-17T12:00:00Z',
    ...(prefix==='suspend'?{suspend:'SUSPEND',suspend_to:'dc',source_table:'ph_soc_master',request_source:'docks'}:{master_id:master[i].unique_id})
  }));
  const pending=makeRows('pending',200), suspended=makeRows('suspend',1000);
  const imageRequests:string[]=[];
  const inventoryReads:unknown[]=[], pageErrors:string[]=[];
  page.on('pageerror', error=>pageErrors.push(error.message));
  const fixture=await installHlOrderFixture(page,baseURL!,{master,realtimeSocket:feed.connect,demandSocRows:suspended,
    appPermissions:['request','drive','docks','po-management'].map(moduleKey=>({permissionKey:`module.${moduleKey}.view`,kind:'module',moduleKey,allowed:true})),
    beforeNavigate:async()=>{
      await page.route('**/storage/v1/**',route=>{
        imageRequests.push(route.request().url());
        const size=route.request().url().includes('que-updated')?180:32;
        return route.fulfill({status:200,contentType:'image/png',body:readFileSync(`assets/branding/ag-data-solutions-icon-v2026080925-${size}.png`)});
      });
      await page.route('**/rest/v1/rpc/get_request_capabilities',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({contract_version:2,username:'dylan_collyge',scope:'global',can_view_queue:true,can_edit:true,can_complete:true,can_archive:true,can_create_general:false,can_create_av:false,can_take_photo:false})}));
      await page.route('**/functions/v1/app-api',async(route:Route)=>{
        const body=route.request().postDataJSON();
        if(body?.action==='inventory_read') inventoryReads.push({operation:body.operation,params:body.params});
        if(body?.action==='dataset_read' && ['request_queue','active_request','suspend_tag'].includes(body.dataset)){
          const source=body.dataset==='suspend_tag'?suspended:pending,offset=Number(body.params.offset)||0,limit=Number(body.params.limit)||500;
          return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,data:{rows:source.slice(offset,offset+limit),offset,limit,total:source.length,hasMore:offset+limit<source.length}})});
        }
        return route.fallback();
      });
    }});
  await page.locator('#footer-request-btn').click();
  const request=page.locator('#request-content [data-request-uid="pending-00000"]');
  await expect(request).toBeVisible();
  const metric=(card:typeof request,name:string)=>card.locator(`[data-inventory-card-metric="${name}"] .app-card-qty-value`);
  for(const [name,value] of Object.entries({'on-hand':'89',review:'27',available:'62','open-stock':'61','loc-on-hand':'100'})) await expect(metric(request,name)).toHaveText(value);
  await expect.poll(()=>request.locator('img').first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===32)).toBe(true);
  const toolbar=page.locator('#request-filter-toolbar'), handle=await toolbar.elementHandle();
  await page.evaluate(()=>window.eval(`window.__queRenderEvents=[];window.__queOriginalChunkRenderer=renderMarkupChunkedByKey;renderMarkupChunkedByKey=function(key,container,crumb,rows,crumbText,renderRow,options){if(key!=='request-main')return window.__queOriginalChunkRenderer(...arguments);const event={at:performance.now(),signature:options?.renderSignature,rows:rows.length,connected:container.isConnected};window.__queRenderEvents.push(event);return window.__queOriginalChunkRenderer(key,container,crumb,rows,crumbText,renderRow,{...options,onComplete:()=>{event.completedAt=performance.now();event.connectedAtComplete=container.isConnected;options?.onComplete?.();event.applied=true;}});}`));
  await page.evaluate(()=>window.eval("setReqTab('suspend-tag')"));
  const card=page.locator('#request-content [data-request-uid="dock_suspend_dc_suspend-00000"]');
  await expect(card).toBeVisible();
  try { await expect(metric(card,'on-hand')).toHaveText('89'); }
  catch(error) {
    const hydration=await page.evaluate(()=>window.eval(`JSON.stringify({context:getQueueCardInventoryContext(),receipt:queueCardInventoryRevisionReceipt,visible:getCurrentVisibleViewId(),tab:activeReqTab,version:queueCardInventoryRenderVersion,token:chunkRenderTokensByKey['request-main'],activity:chunkRenderActivityByKey['request-main'],events:window.__queRenderEvents,entry:(()=>{const entry=getQueueCardInventoryState(getDockSuspendDcRequestMirrorRows().find(row=>getItemUniqueId(row).includes('suspend-00000')));return {status:entry.status,onHand:entry.row?.ptronhand};})()})`));
    console.log('QUE_HYDRATION_FAILURE',JSON.stringify({hydration,inventoryReads:inventoryReads.map((read:any)=>({operation:read.operation,params:read.params?.identities?{...read.params,identities:read.params.identities.slice(0,1),count:read.params.identities.length}:read.params})),pageErrors}));
    throw error;
  }
  await expect(metric(card,'loc-on-hand')).toHaveText('100');
  await expect(card.locator('.app-operational-planstart-date')).toHaveText('PLANSTART: 10/19/2026');
  for(const [i,day] of ['monday','tuesday','wednesday','thursday','friday'].entries()) await expect(page.locator(`#request-content [data-request-uid="dock_suspend_dc_suspend-${String(i).padStart(5,'0')}"]`)).toHaveClass(new RegExp(`app-planstart-${day}`));
  for(const theme of ['light','dark','outdoor']){
    await page.evaluate(value=>{document.body.dataset.opsTheme=value;document.documentElement.classList.toggle('dark',value==='dark');document.documentElement.classList.toggle('outdoor-mode',value==='outdoor');},theme);
    await expect(toolbar).toBeVisible();
    const navigationContrast=await toolbar.locator('[data-request-category]').evaluateAll(buttons=>buttons.map(button=>{
      const luminance=(value:string)=>{const channels=(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
      // Dark-theme active pills use a translucent brand tint. Compare the
      // painted color after compositing ancestors, not its unpainted RGB tint.
      const paintedBackground=(element:Element):number[]=>{
        const layers:number[][]=[];
        for(let node:Element|null=element;node;node=node.parentElement){
          const rgba=(getComputedStyle(node).backgroundColor.match(/[\d.]+/g)||[]).map(Number);
          layers.push([rgba[0]||0,rgba[1]||0,rgba[2]||0,rgba[3]??1]);
        }
        return layers.reverse().reduce((base,rgba)=>base.map((v,index)=>rgba[index]*rgba[3]+v*(1-rgba[3])),[255,255,255]);
      };
      const foreground=luminance(getComputedStyle(button.querySelector('span')!).color),background=luminance(`rgb(${paintedBackground(button).join(',')})`);
      return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
    }));
    if(navigationContrast.some(value=>value<4.5)){
      console.log('QUE_NAV_CONTRAST_FAILURE',JSON.stringify({theme,contrast:navigationContrast,styles:await toolbar.locator('[data-request-category]').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,color:getComputedStyle(button.querySelector('span')!).color,buttonColor:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor,classes:button.className,opacity:getComputedStyle(button).opacity})))}));
      await page.screenshot({path:`.gnc-local/que-nav-contrast-failure-${info.project.name}-${theme}.png`});
    }
    for(const contrast of navigationContrast)expect(contrast).toBeGreaterThanOrEqual(4.5);
    for(const button of await card.locator('.app-suspend-tag-action').all()) expect(await button.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    expect(await card.locator('.app-operational-planstart-date').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(17, 24, 39)');
    await page.screenshot({path:`.gnc-local/que-parity-${info.project.name}-${theme}.png`});
  }
  await page.evaluate(()=>window.eval("syncGlobalHeaderChrome({force:true});renderRequest()"));
  expect(await handle!.evaluate(node=>node.isConnected && node.parentElement?.id==='global-header-search-slot')).toBe(true);
  await page.evaluate(()=>window.eval('setMainAreaScrollTop(600)'));
  const navTop=await toolbar.evaluate(el=>el.getBoundingClientRect().top);
  expect(navTop).toBeGreaterThanOrEqual(0);expect(navTop).toBeLessThan(180);
  await page.evaluate(()=>window.eval('setMainAreaScrollTop(0)'));
  Object.assign(fixture.master[0],{photo_link:photo('updated'),photo_name:'que-updated.png',ptronhand:'93',ptravailable:'66',last_updated:new Date().toISOString()});fixture.datasetRevision++;
  feed.publish('app_dataset_revisions',{key:'ph_master_inventory',state:'ready',revision:String(fixture.datasetRevision)});
  feed.publish('ph_master_inventory',{unique_id:fixture.master[0].unique_id,itemcode:fixture.master[0].itemcode,locationcode:'C.09.000',last_updated:fixture.master[0].last_updated});
  await expect(metric(card,'on-hand')).toHaveText('93',{timeout:20000});
  try {
    await expect.poll(()=>card.locator('img').first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===180&&img.src.includes('que-updated'))).toBe(true);
  } catch (error) {
    const photoState=await card.locator('img').evaluateAll(images=>images.map(img=>({src:img.getAttribute('src'),pending:img.dataset.src,hydrated:img.dataset.photoHydrated,observed:img.dataset.photoObserved,complete:img.complete,width:img.naturalWidth,connected:img.isConnected})));
    console.log('QUE_PHOTO_FAILURE',JSON.stringify({photoState,updatedRequests:imageRequests.filter(url=>url.includes('que-updated'))}));
    throw error;
  }
  expect(imageRequests.some(url=>url.includes('que-updated'))).toBe(true);
  const renderMs=await page.evaluate(()=>window.eval(`new Promise(resolve=>{const start=performance.now();renderRequest();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)))})`));
  assertFrontendUiTiming(expect(Number(renderMs)),info.project);
  await info.attach('queue-parity-proof',{body:JSON.stringify({masterRows:master.length,requestRows:pending.length,suspendRows:suspended.length,renderMs,photoRequests:imageRequests.length,timezone:'Asia/Tokyo',cache:'warm client; shared OS cache uncontrolled'}),contentType:'application/json'});
  await page.locator('#footer-docks-btn').click();
  await page.locator('#docks-content').getByRole('button',{name:/^Open Dock 1$/i}).click();
  await page.locator('#docks-content').getByRole('button',{name:'Open Stop 1',exact:true}).click();
  const dock=page.locator('#docks-content .app-operational-planstart-date').first();
  await expect(dock).toContainText('PLANSTART: 10/');
  await expect(page.locator('#docks-content [data-inventory-card-metric="on-hand"] .app-card-qty-value').first()).not.toHaveText(/N\/A|Loading|Unavailable/);
});
