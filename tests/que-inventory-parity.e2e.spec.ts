import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { test, expect, type Route } from '@playwright/test';
import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';
import { realtimeFeed } from './fixtures/que-realtime-feed';
import { assertRepresentativeQueueRenderTiming } from './helpers/frontend-ui-timing.mjs';
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
  // Exercise the real printed-date/color mismatch, including a UTC date whose
  // calendar date in the facility is still Monday. Device timezone is Tokyo.
  suspended[0].planstart='October 19, 2026 12:00:00 GMT-0500';
  suspended[5].planstart='Tue, 20 Oct 2026 02:00:00 GMT';
  const imageRequests:string[]=[];
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
  const suspendHydrationRequests:Array<Record<string,unknown>>=[];
  const suspendRequestEntries=new WeakMap<object,Record<string,unknown>>();
  page.on('request',req=>{
    let url:URL;try{url=new URL(req.url());}catch{return;}
    if(!url.pathname.includes('/functions/v1/app-api')&&!url.pathname.includes('/rest/v1/rpc/'))return;
    let body:Record<string,unknown>={};try{const parsed=req.postDataJSON();if(parsed&&typeof parsed==='object')body=parsed as Record<string,unknown>;}catch{}
    const params=body.params&&typeof body.params==='object'?body.params as Record<string,unknown>:{};
    const entry:Record<string,unknown>={at:Date.now(),path:url.pathname,method:req.method(),action:body.action||null,
      operation:body.operation||null,dataset:body.dataset||null,offset:params.offset??body.offset??null,limit:params.limit??body.limit??null,status:null};
    if(suspendHydrationRequests.length<40){suspendHydrationRequests.push(entry);suspendRequestEntries.set(req,entry);}
  });
  page.on('response',response=>{
    const entry=suspendRequestEntries.get(response.request());
    if(entry){entry.status=response.status();entry.finishedAt=Date.now();}
  });
  const toolbar=page.locator('#request-filter-toolbar'), handle=await toolbar.elementHandle();
  // This cold fixture batch checks 10,001 schema-shaped rows before replying.
  // Start the DOM hydration assertion after its actual response, separately
  // from the warm render gate below; never inject values into the client cache.
  const suspendInventoryResponse=page.waitForResponse(response=>{
    if(!response.url().includes('/functions/v1/app-api'))return false;
    const body=response.request().postDataJSON();
    return body?.action==='inventory_read'&&body.operation==='master_identity_batch';
  });
  await page.evaluate(()=>window.eval("setReqTab('suspend-tag')"));
  const card=page.locator('#request-content [data-request-uid="dock_suspend_dc_suspend-00000"]');
  await expect(card).toBeVisible();
  expect((await suspendInventoryResponse).status()).toBe(200);
  try { await expect(metric(card,'on-hand')).toHaveText('89'); } catch(error) {
    const pageState=await page.evaluate(()=>window.eval(`(() => {
      const call=fn=>{try{return typeof fn==='function'?fn():null;}catch(value){return {error:String(value)};}};
      const context=call(()=>getQueueCardInventoryContext());
      const master=call(()=>getDatasetState('master'));
      const source=call(()=>getDockSuspendDcSourceRows());
      const preparation=typeof dockSuspendDcRequestMirrorRowsPreparation==='undefined'?null:dockSuspendDcRequestMirrorRowsPreparation;
      const cacheRows=typeof dockSuspendDcRequestMirrorRowsCache==='undefined'?[]:dockSuspendDcRequestMirrorRowsCache;
      const cacheSource=typeof dockSuspendDcRequestMirrorRowsCacheSource==='undefined'?null:dockSuspendDcRequestMirrorRowsCacheSource;
      const container=document.querySelector('#request-suspend-tag-card-list');
      const card=document.querySelector('#request-content [data-request-uid="dock_suspend_dc_suspend-00000"]');
      const receipt=typeof queueCardInventoryRevisionReceipt==='undefined'?null:queueCardInventoryRevisionReceipt;
      return {tab:typeof activeReqTab==='undefined'?'':activeReqTab,requestVisible:call(()=>isViewVisible('request')),
        context:context?{scopePresent:!!context.scope,permissionPresent:!!context.permission,revision:String(context.revision||''),hasSignal:!!context.signal,signalAborted:!!context.signal?.aborted}:null,
        revisionReceipt:receipt?{scopeMatches:receipt.scope===context?.scope,permissionMatches:receipt.permission===context?.permission,revision:String(receipt.revision||'')}:null,
        master:master?{initialLoaded:!!master.initialLoaded,rowCompleteness:master.rowCompleteness||'',scopeMatches:master.liveVerifiedScope===context?.scope,
          permissionMatches:master.liveVerifiedPermission===context?.permission,revisionMatches:String(master.liveVerifiedRevision||'')===String(context?.revision||'')}:null,
        renderVersion:typeof queueCardInventoryRenderVersion==='undefined'?null:queueCardInventoryRenderVersion,
        indexReceiptPresent:typeof queueCardInventoryIndexReceipt==='undefined'?null:!!queueCardInventoryIndexReceipt,
        mirror:{sourceRows:Array.isArray(source)?source.length:null,preparing:!!preparation,cursor:preparation?.cursor??null,total:preparation?.sourceRows?.length??null,
          preparedRows:preparation?.rows?.length??null,preparedRevision:preparation?.revision??null,cacheRows:Array.isArray(cacheRows)?cacheRows.length:null,
          cacheKeyMatches:typeof dockSuspendDcRequestMirrorRowsCacheKey!=='undefined'&&dockSuspendDcRequestMirrorRowsCacheKey===call(()=>getDockSuspendDcSourceRowLookupRevision(source)),
          cacheSourceMatches:cacheSource===source},
        render:{pageGeneration:container?.__suspendPageGeneration??null,token:typeof chunkRenderTokensByKey==='undefined'?null:chunkRenderTokensByKey['request-main']??null,
          activity:typeof chunkRenderActivityByKey==='undefined'?null:chunkRenderActivityByKey['request-main']??null,activeToken:container?.dataset?.activeChunkRenderToken??null,
          signature:container?.dataset?.renderSignature??null,cardMetric:card?.querySelector('[data-inventory-card-metric="on-hand"] .app-card-qty-value')?.textContent?.trim()||null}};
    })()`));
    const diagnostics={project:info.project.name,activeTab:'suspend-tag',failure:String(error),pageState,requests:suspendHydrationRequests};
    console.log('QUEUE_SUSPEND_HYDRATION_FAILURE',JSON.stringify(diagnostics));
    await info.attach('queue-suspend-hydration-failure',{body:JSON.stringify(diagnostics,null,2),contentType:'application/json'});
    throw error;
  }
  await expect(metric(card,'loc-on-hand')).toHaveText('100');
  await expect(card.locator('.app-operational-planstart-date')).toHaveText('PLANSTART: 10/19/2026');
  await expect(card.locator('.app-drive-card-header .app-operational-planstart-date')).toHaveCount(0);
  await expect(card.locator('.app-request-card-bottom .app-operational-planstart-date + .app-suspend-tag-actions')).toHaveCount(1);
  await expect(card.locator('.app-drive-card-header .app-drive-card-title-row > .app-drive-card-reclass')).toHaveCount(1);
  const compactOrder=await card.evaluate(el=>({
    labels:[...el.querySelectorAll('.app-operational-card-header-fields .app-operational-card-header-field > span')].map(node=>node.textContent),
    fieldsAfterLocation:el.querySelector('.app-drive-card-meta')?.nextElementSibling?.classList.contains('app-operational-card-header-fields'),
    people:[...el.querySelectorAll('.app-request-card-meta-chip > span')].map(node=>node.textContent),
    badges:el.querySelector('.app-suspend-tag-data-chips')?.textContent||'',
    pendingLabel:el.querySelector('.app-suspend-tag-status-label')?.textContent||''
  }));
  expect(compactOrder.labels).toEqual(['Dock','Drop','Qty']);
  expect(compactOrder.fieldsAfterLocation).toBe(true);
  expect(compactOrder.people).toContain('Consignee');expect(compactOrder.people).toContain('Sales Rep');
  expect(compactOrder.people).not.toContain('Customer');expect(compactOrder.people).not.toContain('Request Qty');
  expect(compactOrder.badges).not.toMatch(/PHOTOS|LOC PHOTO MATCH/);
  expect(compactOrder.pendingLabel).not.toBe('Pending');
  await expect(card).not.toContainText('Reserve: NO');
  for(const [i,day] of ['monday','tuesday','wednesday','thursday','friday'].entries()) await expect(page.locator(`#request-content [data-request-uid="dock_suspend_dc_suspend-${String(i).padStart(5,'0')}"]`)).toHaveClass(new RegExp(`app-planstart-${day}`));
  const utcBoundaryCard=page.locator('#request-content [data-request-uid="dock_suspend_dc_suspend-00005"]');
  await expect(utcBoundaryCard.locator('.app-operational-planstart-date')).toHaveText('PLANSTART: 10/19/2026');
  await expect(utcBoundaryCard).toHaveClass(/app-planstart-monday/);
  for(const theme of ['light','dark','outdoor']){
    await page.evaluate(value=>{document.body.dataset.opsTheme=value;document.documentElement.classList.toggle('dark',value==='dark');document.documentElement.classList.toggle('outdoor-mode',value==='outdoor');},theme);
    await expect(toolbar).toBeVisible();
    const navigationContrast:number[]=[];
    const luminance=(rgb:number[])=>{const c=rgb.map(v=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;};
    for(const button of await toolbar.locator('[data-request-category]').all()){
      // Sample the real painted padding, including translucent fills and the
      // header's gradient/backdrop. Computed backgroundColor omits those layers.
      await button.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'}));
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const sample=await button.evaluate(el=>{
        const label=el.querySelector('span')!,box=label.getBoundingClientRect();
        const candidates=[{x:box.left+box.width/2,y:box.top-3},{x:box.left-4,y:box.top+box.height/2},{x:box.right+3,y:box.top+box.height/2}];
        const point=candidates.find(p=>p.x>=0&&p.y>=0&&p.x<innerWidth&&p.y<innerHeight&&document.elementFromPoint(p.x,p.y)===el);
        return {point,foreground:(getComputedStyle(label).color.match(/[\d.]+/g)||[]).slice(0,3).map(Number),width:innerWidth,height:innerHeight};
      });
      expect(sample.point,'the category label must have visible, unobstructed button padding').toBeTruthy();
      // Viewport coordinates avoid WebKit element crops and sample the chip's
      // own padding, rather than the separately colored count badge.
      const {data,info:imageInfo}=await sharp(await page.screenshot({scale:'css',animations:'disabled'})).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const x=Math.floor(sample.point!.x*imageInfo.width/sample.width),y=Math.floor(sample.point!.y*imageInfo.height/sample.height);
      const offset=(y*imageInfo.width+x)*imageInfo.channels;
      const fg=luminance(sample.foreground),bg=luminance([...data.subarray(offset,offset+3)]);
      navigationContrast.push((Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05));
    }
    if(navigationContrast.some(value=>value<4.5)){
      console.log('QUE_NAV_CONTRAST_FAILURE',JSON.stringify({theme,contrast:navigationContrast,styles:await toolbar.locator('[data-request-category]').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,color:getComputedStyle(button.querySelector('span')!).color,buttonColor:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor,classes:button.className,opacity:getComputedStyle(button).opacity})))}));
      await page.screenshot({path:`.gnc-local/que-nav-contrast-failure-${info.project.name}-${theme}.png`});
    }
    for(const contrast of navigationContrast)expect(contrast).toBeGreaterThanOrEqual(4.5);
    for(const button of await card.locator('.app-suspend-tag-action').all()) expect(await button.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    const reclass=card.locator('.app-drive-card-reclass button');
    await expect(reclass).toBeVisible();
    expect(await reclass.locator('span').evaluate(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight}))).toEqual({color:'rgb(255, 255, 255)',weight:'600'});
    const headerBox=await card.locator('.app-drive-card-header').boundingBox(),reclassBox=await reclass.boundingBox();
    expect(reclassBox!.x+reclassBox!.width).toBeGreaterThanOrEqual(headerBox!.x+headerBox!.width-2);
    expect(Math.abs(reclassBox!.y-headerBox!.y)).toBeLessThanOrEqual(4);
    for(const [i,color] of ['rgb(243, 232, 255)','rgb(255, 228, 230)','rgb(220, 252, 231)','rgb(219, 234, 254)','rgb(226, 232, 240)'].entries()){
      const weekdayCard=page.locator(`#request-content [data-request-uid="dock_suspend_dc_suspend-${String(i).padStart(5,'0')}"]`);
      expect(await weekdayCard.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain(color);
    }
    expect(await card.locator('.app-operational-planstart-date').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(17, 24, 39)');
    await page.screenshot({path:`.gnc-local/que-parity-${info.project.name}-${theme}.png`});
  }
  await page.evaluate(()=>window.eval("syncGlobalHeaderChrome({force:true});renderRequest()"));
  expect(await handle!.evaluate(node=>node.isConnected && node.parentElement?.id==='global-header-search-slot')).toBe(true);
  await page.evaluate(()=>window.eval('setMainAreaScrollTop(600)'));
  const navTop=await toolbar.evaluate(el=>el.getBoundingClientRect().top);
  expect(navTop).toBeGreaterThanOrEqual(0);expect(navTop).toBeLessThan(180);
  await page.evaluate(()=>window.eval('setMainAreaScrollTop(0)'));
  // Deliver a server change only after the real client has joined both feeds.
  // Publication before phx_join acknowledgement would be lost by the fixture.
  await expect.poll(()=>feed.subscriptions.filter(entry=>entry.table==='app_dataset_revisions').length).toBeGreaterThan(0);
  await expect.poll(()=>feed.subscriptions.filter(entry=>entry.table==='ph_master_inventory').length).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.eval("productionLiveSyncCoordinator?.getStatus?.().state")),{timeout:30000}).toBe('Up to date');

  Object.assign(fixture.master[0],{photo_link:photo('updated'),photo_name:'que-updated.png',ptronhand:'93',ptravailable:'66',last_updated:new Date().toISOString()});fixture.datasetRevision++;
  feed.publish('app_dataset_revisions',{key:'ph_master_inventory',state:'ready',revision:String(fixture.datasetRevision)});
  feed.publish('ph_master_inventory',{unique_id:fixture.master[0].unique_id,itemcode:fixture.master[0].itemcode,locationcode:'C.09.000',last_updated:fixture.master[0].last_updated});
   try { await expect(metric(card,'on-hand')).toHaveText('93',{timeout:20000}); } catch(error) {
     const diagnostics={subscriptions:feed.subscriptions.map(({table,topic})=>({table,topic})),state:await page.evaluate(()=>window.eval(`({status:productionLiveSyncCoordinator?.getStatus?.(),statistics:productionLiveSyncCoordinator?.getStatistics?.(),receipt:queueCardInventoryRevisionReceipt,version:queueCardInventoryRenderVersion,revision:getQueueCardInventoryContext()?.revision,token:chunkRenderTokensByKey['request-main'],activity:chunkRenderActivityByKey['request-main'],entry:(()=>{const state=getQueueCardInventoryState(getDockSuspendDcRequestMirrorRows().find(row=>getItemUniqueId(row).includes('suspend-00000')));return {status:state.status,onHand:state.row?.ptronhand};})()})`))};
     console.log('QUE_LIVE_PUBLICATION_FAILURE',JSON.stringify(diagnostics));
     await info.attach('queue-live-publication-failure',{body:JSON.stringify(diagnostics,null,2),contentType:'application/json'});
     throw error;
  }
  const livePublication=await page.evaluate(()=>window.eval(`(() => {
    const list=document.querySelector('#request-suspend-tag-card-list');
    const receipt=list?.__suspendPagePublicationReceipt;
    return {durationMs:receipt?.durationMs,renderSignature:receipt?.renderSignature,
      inventoryVersion:queueCardInventoryRenderVersion,rows:list?.querySelectorAll('[data-request-uid]').length};
  })()`));
  expect(livePublication.rows).toBe(100);
  expect(livePublication.renderSignature).toContain(`queue-inventory:${livePublication.inventoryVersion}`);
  assertRepresentativeQueueRenderTiming(expect(Number(livePublication.durationMs)));
  console.log('QUEUE_LIVE_PUBLICATION_TIMING',JSON.stringify({project:info.project.name,durationMs:livePublication.durationMs,
    rows:livePublication.rows,limitMs:1500,scope:'stage generation through atomic visible publication; network excluded'}));
  try {
    await expect.poll(()=>card.locator('img').first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===180&&img.src.includes('que-updated'))).toBe(true);
  } catch (error) {
    const photoState=await card.locator('img').evaluateAll(images=>images.map(img=>({src:img.getAttribute('src'),pending:img.dataset.src,hydrated:img.dataset.photoHydrated,observed:img.dataset.photoObserved,complete:img.complete,width:img.naturalWidth,connected:img.isConnected})));
    console.log('QUE_PHOTO_FAILURE',JSON.stringify({photoState,updatedRequests:imageRequests.filter(url=>url.includes('que-updated'))}));
    throw error;
  }
  expect(imageRequests.some(url=>url.includes('que-updated'))).toBe(true);
  // A visible updated card/photo does not establish a warm renderer: the live
  // publication can still have an ordinary side-data repaint or chunk pending.
  // Wait for the completed publication before measuring a separate warm repaint.
  await expect.poll(()=>page.evaluate(()=>window.eval(`({
    synchronized:productionLiveSyncCoordinator?.getStatus?.().state==='Up to date',
    rendering:!!productionLiveSyncActiveRender||productionLiveSyncRenderPending,
    chunkActive:isChunkRenderActive()||!!chunkRenderActivityByKey['request-main']
  })`)),{timeout:30000}).toEqual({synchronized:true,rendering:false,chunkActive:false});
  const renderMs=await page.evaluate(()=>window.eval(`new Promise(resolve=>{const start=performance.now();renderRequest();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)))})`));
  assertRepresentativeQueueRenderTiming(expect(Number(renderMs)));
  console.log('QUEUE_PARITY_TIMING',JSON.stringify({project:info.project.name,renderMs,masterRows:master.length,requestRows:pending.length,suspendRows:suspended.length,cache:'warm client; shared OS cache uncontrolled'}));
  await info.attach('queue-parity-proof',{body:JSON.stringify({masterRows:master.length,requestRows:pending.length,suspendRows:suspended.length,renderMs,photoRequests:imageRequests.length,timezone:'Asia/Tokyo',cache:'warm client; shared OS cache uncontrolled'}),contentType:'application/json'});
  await page.locator('#footer-docks-btn').click();
  await page.locator('#docks-content').getByRole('button',{name:/^Open Dock 1$/i}).click();
  await page.locator('#docks-content').getByRole('button',{name:'Open Stop 1',exact:true}).click();
  const dock=page.locator('#docks-content .app-operational-planstart-date').first();
  await expect(dock).toContainText('PLANSTART: 10/');
  await expect(page.locator('#docks-content [data-inventory-card-metric="on-hand"] .app-card-qty-value').first()).not.toHaveText(/N\/A|Loading|Unavailable/);
});
