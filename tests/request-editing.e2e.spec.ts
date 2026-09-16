import { expect, test } from '@playwright/test';
import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';
test.use({ trace: 'off' });

test('Request editing calculates immediately and renders a usable form', async ({ page, baseURL }) => {
  await installHlOrderFixture(page, baseURL, { startupMode: 'cold' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => window.eval(`(() => {
    const now = new Date().toISOString();
    const row = { UNIQUE_ID: 'request-edit-fixture', DOM_ID: 'request-edit-fixture', SOURCE_TABLE: 'ph_active_request',
      ITEMCODE: '001.020', COMMONNAME: 'Request test Hosta', CONTSIZE: '#1', LOTCODE: '27.F1', SEASON: 'F1', SALEYEAR: '27',
      LOCATIONCODE: 'C.09.000', PTRONHAND: '911', PTRAVAILABLE: '0', PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false, REQ_INITIAL_PTR: '911', HOLDSTOPCODE: 'H',
      QUANTITY: '100', REQ_QTY: '100', REQ_PHOTO_LINK: 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/current.webp',
      REQ_PHOTO_UPDATED_AT: now, REQ_PHOTO_NAME: 'current.webp', REQ_MATCH: '100', REQ_SPEC: '4-6 H', REQUEST_FOLDER: 'fixture',
      REQUESTED_BY: 'dylan_collyge', SALESREPNAME: 'Fixture Rep' };
    syncMasterFieldsToRequestRow({ ...row, UNIQUE_ID: 'master-fixture', PTRAVAILABLE: '911', PHOTO_MATCH_PTR_AVAILABLE_KNOWN: true }, row);
    requestsInventory = [row];
    window.__requestTrace = [];
    const original = verifyRequestDetailRendered;
    verifyRequestDetailRendered = function(...args) {
      const controls = ['req-match', 'req-spec', 'req-av-note', 'req-btn-save-complete'].map(id => {
        const el = document.getElementById(id);
        const hidden = []; for(let p=el;p;p=p.parentElement) if(getComputedStyle(p).display==='none') hidden.push(p.id || p.className);
        return { id, rects: el?.getClientRects().length, hidden };
      });
      const result = original(...args); window.__requestTrace.push({ args, controls, result }); return result;
    };
    openDetail(row.DOM_ID, 'request');
  })()`));
  await page.waitForTimeout(1500);
  if (await page.locator('#request-open-info-modal').isVisible()) await page.locator('#request-open-info-ok').click();
  const result = await page.evaluate(() => window.eval(`({trace:window.__requestTrace, error: document.getElementById('request-detail-load-state').textContent,
    item: {photo:activeItem.REQ_PHOTO_LINK, evidence:getLocPhotoEvidenceState(activeItem,'request')}, view:activeDetailTab})`));
  console.log(JSON.stringify(result));
  expect(result.error).toBe('');
  expect(errors).toEqual([]);
  const customKeyboard = await page.evaluate(() => (window as any).shouldPreferDetailMeasurementKeyboard()
    && (window as any).isDetailMeasurementKeyboardInput(document.getElementById('req-match')));
  if (customKeyboard) {
    await page.locator('#req-match').click();
    await page.locator('#detail-measurement-keyboard [data-key-token="__clear"]').first().click();
    await page.locator('#detail-measurement-keyboard [data-key-token="5"]').click();
    await page.locator('#detail-measurement-keyboard [data-key-token="0"]').click();
  } else await page.locator('#req-match').fill('50');
  await expect(page.locator('#req-match')).toHaveValue('50');
  await expect(page.locator('#req-match-qty-val')).toHaveText('456', { timeout: 1000 });
  const states = await page.evaluate(() => window.eval(`(() => {
    clearQueuedLagSensitiveInputSave('req-');
    const master = { ...activeItem, PTRAVAILABLE: 0, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: true };
    syncMasterFieldsToRequestRow(master, activeItem);
    calculateMatchQty('req-');
    const zero = document.getElementById('req-match-qty-val').textContent;
    syncMasterFieldsToRequestRow({ ...master, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false }, activeItem);
    calculateMatchQty('req-');
    const unknown = document.getElementById('req-match-qty-val').textContent;
    syncMasterFieldsToRequestRow({ ...master, PTRAVAILABLE: '911' }, activeItem);
    activeItem.REQ_PHOTO_LINK = ''; activeItem.REQ_PHOTO_NAME = ''; normalizeRowPhotoFields(activeItem);
    calculateMatchQty('req-');
    return { zero, unknown };
  })()`));
  expect(states).toEqual({ zero: '0', unknown: 'Not verified' });
  await page.evaluate(() => window.eval(`(() => {
    applyUploadedPhotoFieldsToItem(activeItem, 'req-',
      'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/photo_' + Date.now() + '.webp',
      'photo_' + Date.now() + '.webp');
    refreshPendingPhotoUiForItem(activeItem, 'req-');
  })()`));
  await expect(page.locator('#req-match-qty-val')).toHaveText('456');
});

test.describe('Request save performance', () => {
test('Request input and save timing with a complete inventory', async ({ page, baseURL, browserName }, testInfo) => {
  await installHlOrderFixture(page, baseURL, { startupMode: 'cold', master: Array.from({ length:9366 }, (_,i) => hlMaster('inventory-'+i,
    { itemcode:i?'TIMING.'+i:'TIMING.001', commonname:i?'Timing Hosta '+i:'Timing Hosta', contsize:'#1', locationcode:'C.09.000', ptravailable:'911', ptronhand:'911', holdstopcode:'H' })) });
  const saves: any[] = [];
  let serverRow: any = { unique_id: 'request-timing', itemcode: 'TIMING.001', commonname: 'Timing Hosta', contsize: '#1',
    master_id: 'inventory-0', locationcode: 'C.09.000', lotcode: '27.F1', ptravailable: '911', ptronhand: '911', holdstopcode: 'H',
    req_photo_link: 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/current.webp',
    req_photo_updated_at: new Date().toISOString(), req_photo_name: 'current.webp', req_match: '80', req_spec: '4-6 H', row_version: 1 };
  const responseHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route('**/rest/v1/rpc/get_request_schema_compatibility', route => route.fulfill({ headers: responseHeaders, json: { compatible: true, contract_version: 2 } }));
  await page.route('**/rest/v1/rpc/save_request_work', async route => {
    const payload = route.request().postDataJSON(), start = Date.now();
    await new Promise(resolve => setTimeout(resolve, 300));
    serverRow = { ...serverRow, ...payload.patch, row_version: serverRow.row_version + 1 };
    saves.push({ payload, start, end: Date.now() });
    await route.fulfill({ headers: responseHeaders, json: { row: serverRow, row_version: serverRow.row_version } });
  });
  await page.evaluate(row => window.eval(`(() => {
    const source = ${JSON.stringify(row)};
    fullInventory = formatFetchedRows(Array.from({length:9366}, (_,i) => ({
      ...source, unique_id:'inventory-'+i, itemcode:i?'TIMING.'+i:source.itemcode, commonname:i?'Timing Hosta '+i:'Timing Hosta', master_id:null,
      req_photo_link:null, req_photo_name:null, req_photo_updated_at:null, season:'F1', saleyear:'27'
    })), 'ph_master_inventory');
    requestsInventory = formatFetchedRows([source], 'ph_active_request');
    requestsInventory[0].DOM_ID = 'req_request-timing';
    rebuildMasterInventoryIndexes();
    rebuildRequestInventoryIndexes();
    refreshRealtimeDetailLookupIndexes('ph_master_inventory');
    refreshRealtimeDetailLookupIndexes('ph_active_request');
    window.__timings=[]; window.__longTasks=[];
    for(const name of ['syncRowDataAcrossViews','propagateCommittedEdit','buildSearchIndex','refreshProtectedSections',
      'renderSavedPhotos','persistCurrentCache','syncDetailMeasurementKeyboardLayout','calculateMatchQty','saveData','queueLagSensitiveInputSave','applyRowSyncSnapshot','broadcastRowSyncSnapshot']) {
      const original=window[name]; if(typeof original!=='function')continue;
      window[name]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{window.__timings.push({name,start,duration:performance.now()-start})}};
    }
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});
    openDetail(requestsInventory[0].DOM_ID, 'request');
  })()`), serverRow);
  await page.waitForTimeout(1500);
  if (await page.locator('#request-open-info-modal').isVisible()) await page.locator('#request-open-info-ok').click();
  await expect(page.locator('#req-comments')).toBeVisible();
  await page.waitForFunction(() => window.eval("getDatasetState('master').fullLoaded && fullInventory.length === 9366"));
  let profileSession: any;
  if (browserName === 'chromium') {
    profileSession = await page.context().newCDPSession(page);
    await profileSession.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    if (process.env.REQUEST_TIMING_PROFILE) {
      await profileSession.send('Profiler.enable');
      await profileSession.send('Profiler.start');
    }
  }
  await page.evaluate(() => { (window as any).__timings=[]; (window as any).__longTasks=[]; });
  await page.locator('#req-comments').pressSequentially('Fixture typing response', { delay: 30 });
  await page.waitForTimeout(1800);
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  await page.waitForTimeout(1800);
  const result = await page.evaluate(() => ({ rows:window.eval('fullInventory.length'), timings:(window as any).__timings, longTasks:(window as any).__longTasks,
    value:(document.getElementById('req-comments') as HTMLTextAreaElement).value }));
  if (profileSession && process.env.REQUEST_TIMING_PROFILE) {
    const { profile } = await profileSession.send('Profiler.stop');
    await testInfo.attach('request-cpu.json', { body:JSON.stringify(profile), contentType:'application/json' });
    const nodes = new Map(profile.nodes.map((n:any)=>[n.id,n.callFrame.functionName || '(anonymous)']));
    const totals: Record<string,number> = {};
    profile.samples.forEach((id:number,i:number)=>{const name=String(nodes.get(id));totals[name]=(totals[name]||0)+(profile.timeDeltas[i]||0);});
    console.log('CPU_TOP',JSON.stringify(Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,25)));
  }
  console.log('REQUEST_TIMING', JSON.stringify({ rows:result.rows, saves:saves.length,
    propagation:result.timings.filter((entry:any)=>entry.name==='propagateCommittedEdit'),longTasks:result.longTasks }));
  await testInfo.attach('request-timing.json', { body:JSON.stringify({ ...result, saves }), contentType:'application/json' });
  expect(result.value).toBe('Fixture typing response');
  expect(result.rows).toBe(9366);
  expect(saves).toHaveLength(1);
  expect(result.timings.filter((entry:any)=>entry.name==='syncRowDataAcrossViews')).toHaveLength(1);
  const sync = await page.evaluate(() => window.eval(`(() => {
    const master=masterInventoryById.get('inventory-0');
    const local={comments:master.REQ_COMMENTS,available:master.PTRAVAILABLE};
    const before=window.__timings.filter(t=>t.name==='syncRowDataAcrossViews').length;
    const snapshot=buildRowSyncSnapshot(activeItem,'req-');
    window.dispatchEvent(new StorageEvent('storage',{key:ROW_SYNC_STORAGE_KEY,newValue:JSON.stringify(snapshot)}));
    return {local,externalSweeps:window.__timings.filter(t=>t.name==='syncRowDataAcrossViews').length-before,
      persistedHasFlag:Object.hasOwn(JSON.parse(localStorage.getItem(ROW_SYNC_STORAGE_KEY)),'linkedRowsAlreadyApplied')};
  })()`));
  expect(sync).toEqual({ local:{comments:'Fixture typing response',available:'911'},externalSweeps:1,persistedHasFlag:false });
});
});
