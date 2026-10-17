import { test, expect, type WebSocketRoute } from '@playwright/test';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
// @test-group: @app-lifecycle
// This 12k-row cross-client proof is a wide setup workload; retaining its large
// network trace/screenshot can dominate WebKit simulator preparation time.
test.use({ trace:'off', screenshot:'off' });

/** Wire protocol fixture, not a replacement for the production coordinator/client. */
function realtimeFeed() {
  type Subscription = { socket: WebSocketRoute; topic: string; id: number; table: string; joinRef: string };
  const subscriptions: Subscription[] = [];
  let sequence = 0;
  const send = (socket: WebSocketRoute, frame: { join_ref?: string; ref?: string; topic: string; event: string; payload: unknown }) =>
    socket.send(JSON.stringify([frame.join_ref || null, frame.ref || null, frame.topic, frame.event, frame.payload]));
  const connect = (socket: WebSocketRoute) => {
    if (!socket.url().includes('kzrnyjsosryejjejliii.supabase.co/realtime/')) { socket.close(); return; }
    socket.onMessage(raw => {
      // The installed Supabase client uses Phoenix serializer v2 tuples.
      const [join_ref, ref, topic, event, payload] = JSON.parse(String(raw));
      const frame = { join_ref, ref, topic, event, payload };
      if (frame.event === 'phx_join') {
        const filters = (frame.payload.config?.postgres_changes || []) as { table: string; event: string; schema: string }[];
        const changes = filters.map(filter => {
          const id = ++sequence;
          subscriptions.push({ socket, topic: frame.topic, id, table: filter.table, joinRef: frame.join_ref });
          return { ...filter, id };
        });
        send(socket, { event: 'phx_reply', topic: frame.topic, ref: frame.ref, join_ref: frame.join_ref,
          payload: { status: 'ok', response: { postgres_changes: changes } } });
      } else if (frame.event === 'heartbeat' || frame.event === 'phx_leave') {
        send(socket, { event: 'phx_reply', topic: frame.topic, ref: frame.ref, payload: { status: 'ok', response: {} } });
        if (frame.event === 'phx_leave') for (let index = subscriptions.length - 1; index >= 0; index--) {
          if (subscriptions[index].socket === socket && subscriptions[index].topic === frame.topic) subscriptions.splice(index, 1);
        }
      }
    });
    socket.onClose(() => {
      for (let index = subscriptions.length - 1; index >= 0; index--) if (subscriptions[index].socket === socket) subscriptions.splice(index, 1);
    });
  };
  return { connect, subscriptions, publish(table: string, record: Record<string, unknown>) {
    for (const subscription of subscriptions.filter(entry => entry.table === table)) {
      send(subscription.socket, { topic: subscription.topic, event: 'postgres_changes', join_ref: subscription.joinRef,
        payload: { ids: [subscription.id], data: { schema: 'public', table, type: 'UPDATE',
          columns: Object.keys(record).map(name => ({ name, type: name === 'revision' ? 'int8' : 'text' })),
          record, old_record: {}, errors: null, commit_timestamp: new Date().toISOString() } } });
    }
  } };
}

test('native Drive consumes another client’s Que photo/spec revision without refresh or a loading flash', { tag: ['@app-lifecycle'] }, async ({ page, baseURL }) => {
  // This cold setup reads 12k wide rows in 24 pages (~41 MB on the WebKit
  // simulator); only setup/readiness gets the larger budget. Interaction gates
  // below and the 12s remote-update assertion remain unchanged.
  // Setup is budgeted from the observed ~6.1s/500-row WebKit preview; this is
  // not an interaction gate. Realtime response and UI timing assertions below
  // remain unchanged.
  test.setTimeout(360_000);
  const feed = realtimeFeed();
  const masterReadTrace: { projection: string; offset: number; limit: number; dataset: string; status?: number }[] = [];
  const readTraceByRequest = new WeakMap<object, typeof masterReadTrace[number]>();
  const postEventTargetResponses: Array<{ projection:string; offset:number; status:number; target:Record<string,string> }> = [];
  let capturePostEventResponses = false;
  page.on('request', request => {
    if (!request.url().includes('/functions/v1/app-api')) return;
    try {
      const body = request.postDataJSON() as { action?: string; operation?: string; params?: { dataset?: string; projection?: string; offset?: number; limit?: number } };
      if (body.action !== 'inventory_read' || body.operation !== 'master_page' || body.params?.dataset !== 'master') return;
      const entry = { projection: String(body.params.projection || ''), offset: Number(body.params.offset || 0),
        limit: Number(body.params.limit || 0), dataset: String(body.params.dataset || '') };
      masterReadTrace.push(entry);
      readTraceByRequest.set(request, entry);
    } catch { /* Non-JSON and unrelated app-api requests are not inventory-read evidence. */ }
  });
  page.on('response', response => {
    const entry = readTraceByRequest.get(response.request());
    if (entry) entry.status = response.status();
    if (!capturePostEventResponses || !entry || entry.offset !== 0) return;
    void response.json().then((body: { data?: { rows?: Array<Record<string,unknown>> } }) => {
      const row=(body?.data?.rows||[]).find(item=>String(item.unique_id||item.UNIQUE_ID||'')==='que-sync-0');
      if (!row) return;
      const fields=['photo_link','photo_name','saved_photo_link','saved_photo_name','spec','last_updated'];
      const target:Record<string,string>={};
      fields.forEach(field=>{ target[field]=String(row[field]??row[field.toUpperCase()]??''); });
      postEventTargetResponses.push({projection:entry.projection,offset:entry.offset,status:response.status(),target});
    }).catch(()=>{});
  });
  const master = Array.from({ length: 12000 }, (_, index) => hlMaster(`que-sync-${index}`, {
    itemcode: `LIVE.${index}`, commonname: index ? `Live plant ${index}` : 'Patriot Hosta',
    contsize: '#1', locationcode: index ? `C.${String(index).padStart(5, '0')}` : 'C.09.000',
    spec: index ? '' : 'Before Que update', photo_link: '', ptronhand: '100', ptravailable: '90'
  }));
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'nellie_aguilar', role: 'REP', master, realtimeSocket: feed.connect,
    appPermissions: [{ permissionKey: 'module.drive.view', kind: 'module', moduleKey: 'drive', allowed: true }] });
  const photoDate = new Date().toISOString().slice(0, 10);
  const photo = `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${photoDate}/patriot-new.jpg`;
  await page.route('**/storage/v1/**/public/request_photos/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#08784a"/></svg>' }));
  // Test-only wrappers retain both production implementations and record only
  // snapshot/yield milestones. They do not change inputs, return values, or data.
  await page.evaluate(() => window.eval(`(() => {
    const diagnostics={prepareCalls:0,prepareCompleted:0,prepareFailed:0,prepareRows:0,preparedRows:0,
      prepareElapsedMs:0,lastPrepareErrorCode:'',lastPrepareErrorName:'',yieldCalls:0,yieldResolved:0,yieldPending:0,
      lastYieldMs:0,maxYieldMs:0};
    window.__quePreparationDiagnostics=diagnostics;
    const originalPrepare=prepareProductionMasterSnapshot;
    prepareProductionMasterSnapshot=async function(...args) {
      diagnostics.prepareCalls++;
      diagnostics.prepareRows=Number(args[0]?.length||0);
      const started=performance.now();
      try {
        const result=await originalPrepare.apply(this,args);
        diagnostics.prepareCompleted++;
        diagnostics.preparedRows=Number(result?.rowCount||0);
        return result;
      } catch(error) {
        diagnostics.prepareFailed++;
        diagnostics.lastPrepareErrorCode=String(error?.code||'').slice(0,80);
        diagnostics.lastPrepareErrorName=String(error?.name||'').slice(0,80);
        throw error;
      } finally { diagnostics.prepareElapsedMs=Math.round((performance.now()-started)*10)/10; }
    };
    const originalYield=yieldToUiFrame;
    yieldToUiFrame=function(...args) {
      diagnostics.yieldCalls++; diagnostics.yieldPending++;
      const started=performance.now();
      return Promise.resolve(originalYield.apply(this,args)).finally(() => {
        const elapsed=Math.round((performance.now()-started)*10)/10;
        diagnostics.yieldPending--; diagnostics.yieldResolved++;
        diagnostics.lastYieldMs=elapsed; diagnostics.maxYieldMs=Math.max(diagnostics.maxYieldMs,elapsed);
      });
    };
  })()`));
  await page.evaluate(() => window.eval("switchView('drive')"));
  await expect(page.locator('#view-drive')).toBeVisible();
  const readProof = () => page.evaluate(() => window.eval(`(() => {
    const state=getDatasetState('master'),context=getProductionLiveSyncContext();
    const coordinator=productionLiveSyncCoordinator?.getStatus?.() || {};
    const stats=productionLiveSyncCoordinator?.getStatistics?.() || {};
    const message=String(coordinator.message||'').replace(/Bearer\\s+\\S+/gi,'Bearer [redacted]').slice(0,180);
    return { rows:Array.isArray(fullInventory)?fullInventory.length:0, initialLoaded:!!state.initialLoaded,
      fullLoaded:!!state.fullLoaded, completeness:String(state.rowCompleteness||''),
      projection:String(state.projection||''), fieldCoverage:String(state.fieldCoverage||''),
      scopeMatches:state.liveVerifiedScope===context.scope,
      permissionMatches:state.liveVerifiedPermission===context.dataPermissionVersion,
      revisionVerified:/^[1-9][0-9]*$/.test(String(state.liveVerifiedRevision||'')),
      contextVisible:context.visible===true, contextOnline:context.online===true,
      documentHidden:document.hidden, view:String(context.view||''), coordinatorState:String(coordinator.state||''),
      coordinatorMessage:message, statistics:{adapterReads:Number(stats.adapterReads||0),discardedLoads:Number(stats.discardedLoads||0),
        commits:Number(stats.commits||0),revisionReads:Number(stats.revisionReads||0)} };
  })()`));
  const preparationDiagnostics = () => page.evaluate(() => window.eval(`(() => ({
    ...(window.__quePreparationDiagnostics||{}), pageHidden:document.hidden,
    contextVisible:getProductionLiveSyncContext().visible===true
  }))()`));
  const readTraceSummary = () => {
    const trace = masterReadTrace.map(({ projection, offset, limit, dataset, status }) => ({ projection, offset, limit, dataset, status }));
    return { requests:trace.length, browsePages:trace.filter(entry=>entry.projection==='browse').length,
      fullPages:trace.filter(entry=>entry.projection==='full').length,
      failedResponses:trace.filter(entry=>entry.status!==undefined && (entry.status<200 || entry.status>=300)).length };
  };
  // First wait for Drive's actual current browse cohort. The full-read call below
  // must be an explicit production request; a browse projection is not proof of
  // full coverage even when it has paged all rows.
  try {
    await expect.poll(async () => {
      const proof = await readProof();
      return proof.initialLoaded && proof.rows === master.length && proof.scopeMatches
        && proof.permissionMatches && proof.revisionVerified && proof.fieldCoverage === 'browse';
    }, { timeout:180_000 }).toBe(true);
  } catch (error) {
    throw new Error(`MASTER_BROWSE_COHORT_NOT_VERIFIED:${JSON.stringify({ state:await readProof(),
      preparation:await preparationDiagnostics(), reads:readTraceSummary() })}`, { cause:error });
  }
  const browseProof = await readProof();
  const ensuredFull = await page.evaluate(() => window.eval("ensureDatasetLoaded('master','full',{force:true})"));
  if (ensuredFull !== true) {
    const failedState = await readProof();
    throw new Error(`MASTER_FULL_READ_ENSURE_FALSE:${JSON.stringify({ browseProof, failedState,
      preparation:await preparationDiagnostics(), reads:readTraceSummary() })}`);
  }
  // WebKit must finish parsing and applying the complete server-backed snapshot
  // before the test evaluates realtime updates; these are readiness checks, not UI timing gates.
  try {
    await expect.poll(readProof, { timeout:180_000 }).toMatchObject({ rows:master.length, fullLoaded:true,
      completeness:'complete', fieldCoverage:'full', scopeMatches:true, permissionMatches:true, revisionVerified:true });
  } catch (error) {
    throw new Error(`MASTER_FULL_READ_NOT_VERIFIED:${JSON.stringify({ state:await readProof(),
      preparation:await preparationDiagnostics(), reads:readTraceSummary() })}`, { cause:error });
  }
  expect(masterReadTrace.some(entry => entry.projection === 'browse')).toBe(true);
  expect(masterReadTrace.some(entry => entry.projection === 'full' && entry.dataset === 'master'
    && entry.status !== undefined && entry.status >= 200 && entry.status < 300)).toBe(true);
  await expect.poll(() => feed.subscriptions.filter(entry => entry.table === 'app_dataset_revisions').length).toBeGreaterThan(0);
  await expect.poll(() => feed.subscriptions.filter(entry => entry.table === 'ph_master_inventory').length).toBeGreaterThan(0);
  await page.evaluate(() => window.eval(`(() => {
    activeDriveTab='card'; driveViewLevel=0; selectedDriveName='Patriot Hosta';
    renderDrive(false, true);
  })()`));
  await expect(page.locator('#drive-content')).toContainText('No Photo');
  await page.evaluate(() => window.eval(`(() => {
    window.__queSyncFlashes=[];
    const content=document.getElementById('drive-content');
    window.__queSyncObserver=new MutationObserver(() => {
      if (content.querySelector('.skeleton') || !content.textContent.trim()) window.__queSyncFlashes.push('empty-or-loading');
    });
    window.__queSyncObserver.observe(content,{childList:true,subtree:true});
  })()`));
  // Simulate a committed write from the other client at the server boundary.
  // Only normal metadata/row HTTP responses and a real WebSocket notification
  // reach the browser: no manual reload, cache mutation or coordinator signal.
  const changed = fixture.master.find((row: { unique_id: string }) => row.unique_id === 'que-sync-0');
  Object.assign(changed, { spec: 'Que spec updated by Dylan', photo_link: photo, photo_name: `${photoDate}-patriot-new.jpg`,
    av_rule_photo_updated_at: new Date().toISOString(), last_updated: new Date().toISOString() });
  fixture.datasetRevision++;
  const beforeReads = fixture.backgroundMasterReads;
  capturePostEventResponses = true;
  feed.publish('app_dataset_revisions', { key: 'ph_master_inventory', state: 'ready', revision: String(fixture.datasetRevision) });
  // Production publishes both the dataset revision and the RLS-safe master
  // identity. The latter drives the narrow authorized pair refresh while the
  // coordinator reconciles the complete snapshot in the background.
  feed.publish('ph_master_inventory', { unique_id: changed.unique_id, itemcode: changed.itemcode,
    locationcode: changed.locationcode, last_updated: changed.last_updated });
  await page.waitForFunction(() => window.eval("fullInventory.find(row=>row.UNIQUE_ID==='que-sync-0')?.SPEC === 'Que spec updated by Dylan'"), undefined, { timeout: 12000 });
  await expect(page.locator('#drive-content img').first()).toHaveAttribute('src', /patriot-new\.jpg/);
  const canonicalPhotoDiagnostics = () => page.evaluate(() => window.eval(`(() => {
    const row=fullInventory.find(item=>item.UNIQUE_ID==='que-sync-0')||{};
    const state=getDatasetState('master');
    return {photo:String(row.PHOTO_LINK||''),savedPhoto:String(row.SAVED_PHOTO_LINK||''),physicalPhoto:String(row.photo_link||''),
      photoName:String(row.PHOTO_NAME||''),lastUpdated:String(row.LAST_UPDATED||''),spec:String(row.SPEC||''),
      revision:String(state.liveVerifiedRevision||''),fieldCoverage:String(state.fieldCoverage||''),fullLoaded:state.fullLoaded===true};
  })()`));
  const warmNavDiagnostics = () => page.evaluate(() => window.eval(`(() => {
    const context=getProductionLiveSyncContext(),state=getDatasetState('master'),view=ensureViewRenderState('drive');
    const coordinator=productionLiveSyncCoordinator?.getStatus?.()||{};
    const stats=productionLiveSyncCoordinator?.getStatistics?.()||{};
    const container=document.getElementById('drive-content');
    const safePhoto=value=>String(value||'').split(/[?#]/)[0].split('/').pop().slice(0,100);
    const cards=[...(container?.querySelectorAll('.app-drive-compact-card')||[])].slice(0,8).map(card=>{
      const domId=String(card.getAttribute('data-dom-id')||'');
      const row=(Array.isArray(fullInventory)?fullInventory:[]).find(item=>String(item.DOM_ID||'')===domId);
      const image=card.querySelector('img');
      return {uid:String(row?.UNIQUE_ID||''),domId,photo:safePhoto(row?.PHOTO_LINK||image?.getAttribute('src')||image?.getAttribute('data-src'))};
    });
    const first=container?.firstElementChild;
    const active=productionLiveSyncActiveRender;
    const message=String(coordinator.message||'').replace(/Bearer\\s+\\S+/gi,'Bearer [redacted]').slice(0,180);
    return {proof:{rows:Array.isArray(fullInventory)?fullInventory.length:0,complete:state.rowCompleteness==='complete',
        fullLoaded:state.fullLoaded===true,fieldCoverage:String(state.fieldCoverage||''),
        scopeMatches:state.liveVerifiedScope===context.scope,permissionMatches:state.liveVerifiedPermission===context.dataPermissionVersion,
        revisionPresent:/^[1-9][0-9]*$/.test(String(state.liveVerifiedRevision||''))},
      context:{view:String(context.view||''),visible:context.visible===true,online:context.online===true,
        adapters:(context.adapters||[]).map(adapter=>({id:String(adapter.id||''),projection:String(adapter.projection||'')}))},
      coordinator:{state:String(coordinator.state||''),message,adapterReads:Number(stats.adapterReads||0),
        commits:Number(stats.commits||0),discardedLoads:Number(stats.discardedLoads||0)},
      render:{pending:productionLiveSyncRenderPending===true,rendering:productionLiveSyncRendering===true,
        active:!!active,activeView:String(active?.view||''),activePending:Number(active?.pending||0),
        viewInitialized:view.initialized===true,viewDirty:view.dirty===true,
        chunkActive:Number(chunkRenderActivityByKey['drive-main-card']||0)!==0,
        chunkTimers:Array.isArray(chunkRenderTimersByKey['drive-main-card'])?chunkRenderTimersByKey['drive-main-card'].length:0},
      cards:{count:container?.querySelectorAll('.app-drive-compact-card').length||0,firstTag:String(first?.tagName||''),
        firstId:String(first?.id||''),firstClass:String(first?.className||'').slice(0,140),
        firstDomId:String(first?.getAttribute('data-dom-id')||''),rows:cards,
        photoNames:[...(container?.querySelectorAll('img')||[])].slice(0,8).map(image=>safePhoto(image.getAttribute('src')||image.getAttribute('data-src')))},
      flashes:{count:Array.isArray(window.__queSyncFlashes)?window.__queSyncFlashes.length:0,
        recent:Array.isArray(window.__queSyncFlashes)?window.__queSyncFlashes.slice(-5):[]},
      pageHidden:document.hidden};
  })()`));
  // Finish the 24-page background reconciliation before measuring a warm
  // navigation. This readiness wait is separate from the 400 ms UI gate.
  // The complete 12k-row post-event reconciliation is setup/readiness work;
  // its budget does not alter the 12s remote-update or UI-interaction gates.
  await expect.poll(async () => page.evaluate(() => window.eval("productionLiveSyncCoordinator?.getStatus().state")), { timeout:180_000 }).toBe('Up to date');
  // The coordinator can publish Up-to-date before deferred DOM application and
  // card chunking finish. Wait for the actual Drive paint to settle before
  // leaving the view so the warm-navigation identity check measures reuse.
  try {
    await expect.poll(async () => page.evaluate(() => window.eval(`(() => {
      const view=ensureViewRenderState('drive');
      return productionLiveSyncRenderPending!==true && productionLiveSyncRendering!==true
        && !productionLiveSyncActiveRender && view.initialized===true && view.dirty!==true
        && !Number(chunkRenderActivityByKey['drive-main-card']||0)
        && !(Array.isArray(chunkRenderTimersByKey['drive-main-card'])&&chunkRenderTimersByKey['drive-main-card'].length);
    })()`)), { timeout:180_000 }).toBe(true);
  } catch (error) {
    throw new Error(`QUE_DRIVE_PRE_NAV_PAINT_NOT_SETTLED:${JSON.stringify(await warmNavDiagnostics())}`, { cause:error });
  }
  const beforeLeavingDrive=await warmNavDiagnostics();
  const canonicalBeforeLeaving=await canonicalPhotoDiagnostics();
  await page.evaluate(() => window.eval("switchView('home')"));
  await expect(page.locator('#view-home')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.eval("productionLiveSyncCoordinator?.getStatus().state"))).toBe('Up to date');
  const beforeRevisit=await warmNavDiagnostics();
  const canonicalBeforeRevisit=await canonicalPhotoDiagnostics();
  const revisit = await page.evaluate(() => window.eval(`new Promise(resolve => {
    const container=document.getElementById('drive-content');
    const before=container.firstElementChild;
    const beforeCount=container.children.length;
    const beforeDomId=String(before?.getAttribute('data-dom-id')||'');
    const beforeClass=String(before?.className||'').slice(0,140);
    const start=performance.now();
    switchView('drive');
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      elapsedMs:performance.now()-start,
      sameNode:before===container.firstElementChild,
      hasUpdatedPhoto:!!document.querySelector('#drive-content img[src*="patriot-new.jpg"]'),
      before:{childCount:beforeCount,firstDomId:beforeDomId,firstClass:beforeClass},
      after:{childCount:container.children.length,
        firstDomId:String(container.firstElementChild?.getAttribute('data-dom-id')||''),
        firstClass:String(container.firstElementChild?.className||'').slice(0,140)}
    })));
  })`));
  if (!revisit.sameNode) throw new Error(`QUE_DRIVE_WARM_NAV_REPLACED_NODE:${JSON.stringify({ beforeLeavingDrive,
    beforeRevisit, revisit, afterRevisit:await warmNavDiagnostics() })}`);
  expect(revisit.hasUpdatedPhoto).toBe(true);
  assertFrontendUiTiming(expect(revisit.elapsedMs), test.info().project);
  const result = await page.evaluate(() => window.eval(`(() => {
    window.__queSyncObserver.disconnect();
    return { user:currentUser, photo:fullInventory.find(row=>row.UNIQUE_ID==='que-sync-0').PHOTO_LINK, flashes:window.__queSyncFlashes };
  })()`));
  if (result.photo !== photo) throw new Error(`QUE_DRIVE_CANONICAL_PHOTO_LOST:${JSON.stringify({
    result, canonicalBeforeLeaving, canonicalBeforeRevisit, afterRevisit:await warmNavDiagnostics(),
    canonicalAfterRevisit:await canonicalPhotoDiagnostics(), source:{photo_link:String(changed.photo_link||''),
      photo_name:String(changed.photo_name||''),spec:String(changed.spec||''),last_updated:String(changed.last_updated||''),
      mutationRevision:String(fixture.datasetRevision)}, postEventTargetResponses, reads:readTraceSummary()
  })}`);
  expect(result).toEqual({ user: 'nellie_aguilar', photo, flashes: [] });
  await page.getByRole('button', { name: 'Open drive row', exact: true }).click();
  await expect(page.locator('#view-detail')).toBeVisible();
  // Drive's fixed overview intentionally hides legacy All Data and shows the
  // separate ERP ITEMSPEC field. Verify its opened row has the current measured
  // SPEC without changing that role's field visibility or confusing the fields.
  expect(await page.evaluate(() => window.eval("({ uid:activeItem.UNIQUE_ID, spec:activeItem.SPEC, photo:activeItem.PHOTO_LINK })")))
    .toEqual({ uid: 'que-sync-0', spec: 'Que spec updated by Dylan', photo });
  expect(fixture.backgroundMasterReads).toBeGreaterThan(beforeReads);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
  console.log(JSON.stringify({ event:'QUE_DRIVE_REMOTE_SYNC', rows:master.length, warmNavigation:revisit,
    cache:'Fresh browser; verified warm same-account Drive snapshot; remote revision delivered over WebSocket' }));
});
