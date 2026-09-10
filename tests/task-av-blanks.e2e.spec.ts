import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Row = Record<string, any>;
const release = `V${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}`;
const stamp = '2026-09-09T17:00:00.000Z';
const row = (id: string, extra: Row = {}): Row => ({
  UNIQUE_ID: `isolated-av-${id}`, ITEMCODE: `TEST-${id}`, COMMONNAME: `Fixture ${id}`,
  GENUSNAME: 'Hydrangea', CONTSIZE: '#3', LOCATIONCODE: 'A.05.000', LOTCODE: '27.F1',
  BLOCKALPHA: 'A', SEASON: 'F1', SALESYEAR: '27', PRIORITY: '1', SOURCE: 'LD',
  PTRONHAND: '100', PTRAVAILABLE: '100', S_LTS: '100', HOLDSTOPCODE: '',
  APP_TAB_ASSIGNMENT: 'season', SOURCE_TABLE: 'ph_master_inventory',
  ASSIGNEDTO: 'eval_fixture', AV_NOTE: '', DATE_COMPLETED: '', LAST_UPDATED: stamp,
  ...extra,
});

/** These tests run only the compiled shell, with no business traffic permitted.
 * Identity and service boundaries are fixtures; membership, rendering, editing,
 * protected transport selection, confirmation and navigation are production code.
 */
async function harness(page: Page, baseURL: string, rows: Row[], role = 'MANAGER', username = 'dylan_collyge', allowReclass = true) {
  const origin = new URL(baseURL).origin;
  const runtime: string[] = [], errors: string[] = [], forbidden: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) runtime.push(response.url());
  });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
    if (/ph_master_inventory/.test(url.pathname) && !['GET', 'HEAD'].includes(request.method())) forbidden.push(request.method() + ':' + url.pathname);
    return route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=1&task_av_blanks_canary=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
  await page.evaluate(({ rows, role, username, allowReclass }) => {
    (window as any).__taskAv = { rows, role, username, allowReclass, revision: 1, saves: [], reclass: [], publicCalls: [], replies: [], toasts: [], saveEvents: [], failed: false,
      bootstrap: { status: 'pending', phase: 'created', events: [], revisionReads: [], datasetReads: [] } };
    // Do not return an asynchronous bootstrap through CDP's awaitPromise path.
    // Chromium can collect that outer serialization promise even while this
    // strongly owned inner task completes. Poll its explicit terminal state.
    (window as any).__taskAvReady = window.eval(`(async () => {
      const f = window.__taskAv;
      const phase=name=>{f.bootstrap.phase=name;f.bootstrap.events.push({name,at:Date.now()})};
      phase('native-auth');
      const profile={id:'isolated-profile-'+f.username,username:f.username,role:f.role,active:true};
      const session={access_token:'synthetic-not-a-real-token',user:{id:profile.id}};
      const channel={on:()=>channel,subscribe:()=>channel};
      const client={auth:{getSession:async()=>({data:{session}}),signInWithPassword:async()=>({data:{session}}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
        from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:profile})})})}),channel:()=>channel,removeChannel:async()=>{}};
      getSupabaseBrowserClient=()=>client;
      if(!await tryNativeAuthPasswordLogin(f.username,'isolated-password')) throw new Error('TASK_FIXTURE_AUTH_FAILED');
      phase('install-service-boundaries');
      installMutationBlockedAccessCanaryIdentity(f.username, 'Isolated Task AV', f.role);
      const permissions=['module.home.view','module.tasks.view','module.drive.view','drive.reclass.submit'].map(key=>({permissionKey:key,kind:key.startsWith('module.')?'module':'action',moduleKey:key.split('.')[1],allowed:key==='drive.reclass.submit'?f.allowReclass:true,scope:f.role==='EVAL'?'assigned':'global'}));
      const snapshot=normalizeAppAccessSnapshot({contractVersion:'app-access-v1',enforcementMode:'enforced',username:f.username,role:f.role,permissions},f.username);
      appAccessSnapshotState={status:'ready',snapshot,stale:false,errorCode:'',loadedAt:Date.now(),username:f.username};
      appSeasonSettingsCache={seasonCode:'F1',salesYear:27};
      avBlanksPhotoBypassSettingsCache=normalizeAvBlanksPhotoBypassSettingsPayload({users:[f.username]});
      avBlanksPhotoBypassRemoteLoaded=true;
      avBlanksPhotoBypassAccessCache={username:f.username,allowed:true,canManage:true,loadedAt:Date.now()};
      assignableAppUsers=[{username:f.username,display:f.username,role:f.role},{username:'eval_fixture',display:'eval_fixture',role:'EVAL'}];
      assignableAppUsersLoaded=true;
      evalAssignableUsers=['eval_fixture','unrelated_person'];evalAssignableUsersDirectoryResolved=true;evalAssignableUsersLastAttemptAt=Date.now();
      taskViewTargetUser=f.role==='EVAL'?f.username:'all';
      ensureViewDataForRender=()=>false;
      loadDatasetTargetsWithLimit=async()=>false;
      ensureAppAccessSnapshotLoaded=async()=>snapshot;
      // Supply server boundaries to the production coordinator. Seeded app rows
      // alone must never satisfy the native freshness/mutation gate.
      fetchAllSupabaseRows=async (table)=>{
        f.bootstrap.datasetReads.push({table,at:Date.now()});
        if(table===APP_SEASON_SETTINGS_TABLE) return [{key:APP_SEASON_SETTINGS_KEY,value:{seasonCode:'F1',salesYear:27}}];
        if(table==='ph_master_inventory') return structuredClone(f.rows);
        if(table==='ph_cav_import') return f.rows.map(r=>({ITEMCODE:r.ITEMCODE,SEASON:'F1',HOLDSTOPREASON:''}));
        if(table===WAREHOUSE_ASSIGNED_ITEMS_TABLE) return f.rows.map(r=>({...r,PRESENT_IN_DRIVE:true}));
        if(Object.values(DATASET_DEFINITIONS).some(definition=>definition.table===table)) return [];
        throw new Error('UNEXPECTED_FIXTURE_DATASET:'+table);
      };
      avRuleColumnsReady=true;
      showToast=(title,message)=>f.toasts.push({title,message});
      const productionSaveData=saveData;
      saveData=async (...args)=>{
        const event={args:args.slice(0,3),uid:activeItem?.UNIQUE_ID,at:Date.now(),
          allowed:canEditRowDetails(args[1],activeItem),verified:canUseVerifiedProductionData(['master']),
          note:document.getElementById('ssn-av-note')?.value,
          status:getProductionLiveSyncCoordinator()?.getStatus()};
        f.saveEvents.push(event);
        try { return await productionSaveData(...args); }
        finally { event.finishedAt=Date.now();event.toasts=f.toasts.slice(); }
      };
      postGoogleScriptRawJsonPayload=async payload=>{f.publicCalls.push(payload);throw new Error('PUBLIC_DELIVERY_FORBIDDEN')};
      postAppFunctionJson=async (_url,payload)=>{
        if(payload.action==='drive_reclass_inquiry'){
          f.reclass.push(structuredClone(payload));
          return {ok:true,status:payload.operation==='status'?'failed':'queued',jobId:'synthetic-job',idempotencyToken:payload.idempotencyToken};
        }
        if(payload.action==='season_sales_office' && ['access','refresh'].includes(payload.operation)) return {ok:true,allowed:true,users:[f.username]};
        throw new Error('UNEXPECTED_APP_API:'+payload.action+':'+payload.operation);
      };
      supabaseRpc=async (name,payload)=>{
        if(name==='get_my_dataset_revisions_v1') {
          f.bootstrap.revisionReads.push({keys:payload.p_dataset_keys,revision:f.revision,at:Date.now()});
          return {contractVersion:1,permissionVersion:'task-fixture-policy-v1',
            sources:payload.p_dataset_keys.map(key=>({key,revision:String(f.revision),state:'ready'}))};
        }
        if(name==='save_drive_evidence_v2'){
          f.saves.push(structuredClone(payload));
          if(f.gate) await f.gate;
          if(f.failed) return {ok:false,code:'DRIVE_SAVE_UNCONFIRMED'};
          const current=f.rows.find(r=>r.UNIQUE_ID===payload.p_master_uid);
          const canonical={...current,...Object.fromEntries(Object.entries(payload.p_evidence||{}).map(([key,value])=>[key.toUpperCase(),value])),DATE_COMPLETED:payload.p_complete?'2026-09-09T18:00:00.000Z':current.DATE_COMPLETED,LAST_UPDATED:'2026-09-09T18:00:00.000Z'};
          f.rows=f.rows.map(r=>r.UNIQUE_ID===canonical.UNIQUE_ID?canonical:r);
          f.revision++;
          return {ok:true,canonicalConfirmed:true,row:canonical,requestRows:[],code:'SAVED'};
        }
        if(name==='get_my_app_permissions_v1') return snapshot;
        if(name==='get_request_capabilities') return {contract_version:2,username:f.username,scope:'global',can_view_queue:true,can_take_photo:true,can_edit:true,can_complete:true};
        if(name==='get_app_user_directory') return [];
        return [];
      };
      f.importRows=async (nextRows)=>{
        f.rows=structuredClone(nextRows);
        f.revision++;
        const coordinator=getProductionLiveSyncCoordinator();
        phase('verify-import');
        if(!coordinator || !await coordinator.check('isolated-task-import')) throw new Error('TASK_FIXTURE_VERIFICATION_FAILED:'+JSON.stringify(coordinator?.getStatus()));
        if(!canUseVerifiedProductionData(['master','cavAvBlankKeys','warehouseAssignedItems'])) throw new Error('TASK_FIXTURE_NOT_VERIFIED');
        phase('render-import');
        invalidateResolvedViewStateCaches();
        renderTasks();
        phase('import-ready');
      };
      f.verifyDetail=async()=>{
        const coordinator=getProductionLiveSyncCoordinator();
        if(!await coordinator.check('isolated-task-detail')) throw new Error('TASK_DETAIL_VERIFICATION_FAILED:'+JSON.stringify(coordinator.getStatus()));
        if(!canUseVerifiedProductionData(['master'])) throw new Error('TASK_DETAIL_NOT_VERIFIED');
      };
      activeTaskView=f.role==='EVAL'?'eval-task':'av-blanks';
      activeTaskTab=activeTaskView;
      activeTaskFilter=activeTaskSubview=f.role==='EVAL'?'av-blanks':'all';
      activeEvalSimpleFilter='av-blanks';
      selectedTaskGenusNames=new Set();selectedTaskContSizes=new Set();
      taskLocationDetailSearchTerm='';taskViewLevel=0;selectedTaskBlock=selectedTaskLoc=null;
      document.getElementById('view-login').style.setProperty('display','none','important');
      document.getElementById('app-wrapper').classList.remove('hidden');
      showOnlyPrimaryView('tasks');
      await f.importRows(f.rows);
      const state=ensureViewRenderState('tasks');state.initialized=true;state.dirty=false;
      phase('ready');
    })()`);
    (window as any).__taskAvBootstrapObserver = (window as any).__taskAvReady.then(
      () => { (window as any).__taskAv.bootstrap.status = 'ready'; },
      (error: Error) => {
        const bootstrap = (window as any).__taskAv.bootstrap;
        bootstrap.status = 'failed';
        bootstrap.error = { name:error?.name, message:error?.message || String(error), stack:error?.stack };
      },
    );
  }, { rows, role, username, allowReclass });
  let bootstrap: any;
  try {
    await expect.poll(async () => {
      // Each evaluation returns plain data immediately; no browser Promise is
      // exported. A reset document or rejected task ends polling and fails below.
      bootstrap = await page.evaluate(() => ({
        ...(window as any).__taskAv?.bootstrap,
        status: (window as any).__taskAv?.bootstrap?.status || 'missing',
        url: location.href,
        coordinator: window.eval('productionLiveSyncCoordinator?.getStatus()'),
        statistics: window.eval('productionLiveSyncCoordinator?.getStatistics()'),
      }));
      return bootstrap.status;
    }, { timeout:45_000, intervals:[50, 100, 250] }).not.toBe('pending');
  } catch (error) {
    throw new Error('TASK_FIXTURE_BOOTSTRAP_DID_NOT_SETTLE:' + JSON.stringify(bootstrap), { cause:error });
  }
  expect(bootstrap, 'TASK_FIXTURE_BOOTSTRAP_FAILED:' + JSON.stringify(bootstrap)).toMatchObject({ status:'ready', phase:'ready' });
  await expect(page.locator('#view-tasks')).toBeVisible();
  expect(runtime, 'the deferred production-built runtime must be loaded once').toHaveLength(1);
  expect(await page.evaluate(() => window.eval('APP_SHELL_VERSION'))).toBe(release);
  const ids = () => page.evaluate(() => window.eval('buildResolvedTaskState().tabItems.map(row=>row.UNIQUE_ID).sort()'));
  const importRows = async (nextRows: Row[]) => page.evaluate(data => (window as any).__taskAv.importRows(data), nextRows);
  const openRows = async () => {
    await page.getByRole('button', { name: 'Open block A', exact: true }).click();
    await page.getByRole('button', { name: 'Open location A.05', exact: true }).click();
    await expect(page.locator('#task-content .item-row').first()).toBeVisible();
  };
  return { ids, importRows, openRows, clean: async () => {
    expect(errors).toEqual([]);expect(forbidden).toEqual([]);
    expect(await page.evaluate(() => (window as any).__taskAv.publicCalls)).toEqual([]);
  } };
}

test('canonical completed winner is excluded, unfinished evidence remains in normal and simplified AV Blanks', async ({ page, browser, baseURL }) => {
  const rows=[row('done',{AV_NOTE:'SAVED NOTE',DATE_COMPLETED:stamp}),row('runner',{ITEMCODE:'TEST-done',PTRAVAILABLE:'20',LOCATIONCODE:'B.02.000'}),row('draft',{AV_NOTE:'SAVED BUT UNFINISHED'}),row('photo',{SAVED_PHOTO_LINK:'https://example.invalid/photo.webp'}),row('null',{AV_NOTE:'NULL',DATE_COMPLETED:stamp}),row('reset',{AV_NOTE:'OLD NOTE',DATE_COMPLETED:stamp,AV_RULE_LAST_CLEARED_AT:'2026-09-09T18:00:00.000Z'})];
  const app=await harness(page,baseURL!,rows);
  expect(await app.ids()).toEqual(['isolated-av-draft','isolated-av-null','isolated-av-photo','isolated-av-reset']);
  await app.openRows();
  await expect(page.locator('#task-content')).toContainText('AV Note saved — Mark Done to finish');
  await expect(page.locator('#task-content')).not.toContainText('Fixture done');
  await app.importRows(rows.map(r=>({...r,HOLDSTOPREASON:''})));
  expect(await app.ids()).not.toContain('isolated-av-done');
  const simpleContext=await browser.newContext({baseURL,serviceWorkers:'block'});
  try {
    const simplePage=await simpleContext.newPage();
    const simple=await harness(simplePage,baseURL!,rows,'EVAL','eval_fixture');
    expect(await simple.ids()).toEqual(['isolated-av-draft','isolated-av-null','isolated-av-photo','isolated-av-reset']);
    await simple.openRows();
    await expect(simplePage.locator('#task-content')).toContainText('AV Note saved — Mark Done to finish');
    await simple.clean();
  } finally {await simpleContext.close()}
  await app.clean();
});

test('Genus and Container filters, drill-down and exact-row Reclass retain Task context', async ({ page, baseURL }) => {
  const app=await harness(page,baseURL!,[row('keep'),row('genus',{GENUSNAME:'Ilex'}),row('size',{CONTSIZE:'#7'})]);
  await expect(page.locator('#task-genus-filters')).toBeVisible();
  await expect(page.locator('#task-contsize-filters')).toBeVisible();
  await page.evaluate(()=>window.eval(`toggleTaskGenusSelection('Hydrangea');setTaskContSizeFilter('#3');closeTaskDropdowns(true);renderTasks()`));
  expect(await app.ids()).toEqual(['isolated-av-keep']);
  await app.openRows();
  const card=page.locator('#task-content .item-row').filter({hasText:'Fixture keep'});
  await expect(card.getByRole('button',{name:'Open reclass transaction',exact:true})).toHaveCount(1);
  await card.getByRole('button',{name:'Open reclass transaction',exact:true}).click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
  expect(await page.evaluate(()=>window.eval('argosInventoryTransactionState.uid'))).toBe('isolated-av-keep');
  expect(await page.evaluate(()=>window.eval('argosInventoryTransactionState.sourceView'))).toBe('tasks-av-blanks');
  await expect(page.locator('[data-reclass-row-body="isolated-av-keep"] [data-reclass-v3-action]')).toHaveCount(8);
  await page.evaluate(()=>window.eval('closeArgosInventoryTransactionModal()'));
  await expect(card).toBeVisible();
  expect(await page.evaluate(()=>window.eval('({genus:[...selectedTaskGenusNames],size:[...selectedTaskContSizes],block:selectedTaskBlock,location:selectedTaskLoc})'))).toEqual({genus:['Hydrangea'],size:['#3'],block:'A',location:'A.05'});
  await app.clean();
});

test('note-only Mark Done awaits protected confirmation; failure preserves draft and second client refresh converges', async ({ page, browser, baseURL }) => {
  const initial=[row('complete',{AV_NOTE:'READY NOTE'}),row('failure',{AV_NOTE:'DRAFT NOTE'})];
  const app=await harness(page,baseURL!,initial);
  const context=await browser.newContext({baseURL,serviceWorkers:'block'});
  const second=await context.newPage();
  try {
    const other=await harness(second,baseURL!,initial);
    await app.openRows();
    await page.evaluate(()=>window.eval(`openDetail('isolated-av-complete','tasks',{preferredTab:'season'})`));
    await page.evaluate(()=>(window as any).__taskAv.verifyDetail());
    await expect(page.locator('#ssn-btn-save-complete')).toBeVisible();
    await page.evaluate(()=>{const f=(window as any).__taskAv;f.gate=new Promise<void>(resolve=>f.release=resolve)});
    await page.locator('#ssn-btn-save-complete').click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__taskAv.saves.filter((s:any)=>s.p_complete).length)).toBe(1);
    expect(await app.ids()).toContain('isolated-av-complete');
    expect(await other.ids()).toContain('isolated-av-complete');
    await page.evaluate(()=>{const f=(window as any).__taskAv;f.gate=null;f.release()});
    await expect.poll(app.ids).not.toContain('isolated-av-complete');
    const committed=await page.evaluate(()=>(window as any).__taskAv.rows);
    await other.importRows(committed);
    await expect.poll(other.ids).not.toContain('isolated-av-complete');
    await page.evaluate(()=>window.eval(`openDetail('isolated-av-failure','tasks',{preferredTab:'season'})`));
    await page.evaluate(()=>(window as any).__taskAv.verifyDetail());
    await expect(page.locator('#ssn-av-note')).toBeVisible();
    await expect(page.locator('#ssn-av-note')).toHaveValue('DRAFT NOTE');
    await page.evaluate(()=>{
      const f=(window as any).__taskAv;
      f.failed=true;
      f.gate=new Promise<void>(resolve=>f.release=resolve);
    });
    // Type through the existing note editor, then freeze the actual entered
    // draft: failure must preserve it exactly, including the existing text.
    await page.locator('#ssn-av-note').fill('RETAINED EDIT');
    const enteredDraft=await page.locator('#ssn-av-note').inputValue();
    expect(enteredDraft).toContain('RETAINED EDIT');
    // Make the mobile overlap deterministic: a real note autosave is in flight
    // while Mark Done queues behind it. Both writes receive the failed reply.
    await expect.poll(()=>page.evaluate(()=>(window as any).__taskAv.saves.some((save:any)=>
      save.p_master_uid==='isolated-av-failure' && !save.p_complete))).toBe(true);
    await page.locator('#ssn-btn-save-complete').click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__taskAv.saveEvents.filter((event:any)=>
      event.uid==='isolated-av-failure' && event.args[0]===true))).toMatchObject([{allowed:true,verified:true,note:enteredDraft}]);
    await page.evaluate(()=>{const f=(window as any).__taskAv;f.gate=null;f.release()});
    await expect.poll(()=>page.evaluate(()=>{
      const f=(window as any).__taskAv;
      return {completeSaves:f.saves.filter((s:any)=>s.p_complete && s.p_master_uid==='isolated-av-failure').length,
        saves:f.saves,toasts:f.toasts,events:f.saveEvents};
    })).toMatchObject({completeSaves:1});
    await expect.poll(()=>page.evaluate(()=>(window as any).__taskAv.toasts.some((t:any)=>/error|sync|save|could|failed/i.test(t.title)))).toBe(true);
    await expect(page.locator('#ssn-av-note')).toHaveValue(enteredDraft);
    expect(await app.ids()).toContain('isolated-av-failure');
    await app.clean();await other.clean();
  } finally {await context.close()}
});

test('Task Reclass create, status and retry stay protected with stable identity and token', async ({ page, baseURL }) => {
  const app=await harness(page,baseURL!,[row('reclass')]);
  await app.openRows();
  await page.getByRole('button',{name:'Open reclass transaction',exact:true}).click();
  const modal=page.locator('#argos-inventory-transaction-modal');
  await expect(modal).toBeVisible();
  await modal.locator('[data-reclass-v3-action="priority_change"]').click();
  await modal.locator('[data-reclass-v3-proposal-field="priority"]').fill('2');
  await modal.locator('#argos-inventory-transaction-apply').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__taskAv.reclass.some((r:any)=>r.operation==='create'))).toBe(true);
  await page.evaluate(()=>window.eval('pollReclassDeliveryJobs()'));
  await page.evaluate(()=>window.eval('retryReclassDeliveryJob(readReclassDeliveryJobs()[0].token)'));
  const requests=await page.evaluate(()=>(window as any).__taskAv.reclass);
  expect(requests.map((r:any)=>r.operation)).toEqual(expect.arrayContaining(['create','status','retry']));
  const create=requests.find((r:any)=>r.operation==='create');
  expect(create.source.unique_id).toBe('isolated-av-reclass');
  expect(create.sourceContext.sourceMode).toBe('drive');
  expect(new Set(requests.map((r:any)=>r.idempotencyToken)).size).toBe(1);
  await app.clean();
});

test('simplified evaluator keeps only permitted assigned-row Reclass and AV Note exemption grants no action permission', async ({ page, baseURL }) => {
  const app=await harness(page,baseURL!,[row('assigned'),row('completed',{AV_NOTE:'FINISHED',DATE_COMPLETED:stamp}),row('other',{ASSIGNEDTO:'unrelated_person'})],'EVAL','eval_fixture');
  expect(await page.evaluate(()=>window.eval('shouldUseSimplifiedEvalTaskFilters()'))).toBe(true);
  expect(await app.ids()).not.toContain('isolated-av-completed');
  await app.openRows();
  const assigned=page.locator('#task-content .item-row').filter({hasText:'Fixture assigned'});
  await expect(assigned.getByRole('button',{name:'Open reclass transaction',exact:true})).toHaveCount(1);
  await assigned.getByRole('button',{name:'Open reclass transaction',exact:true}).click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
  await page.evaluate(()=>window.eval(`closeArgosInventoryTransactionModal();openArgosInventoryTransactionModal('isolated-av-other','reclass','tasks-av-blanks')`));
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await app.clean();
  // A fresh isolated client starts with the permission denied, rather than
  // manually mutating a snapshot behind the production permission lifecycle.
  const deniedContext=await page.context().browser()!.newContext({baseURL,serviceWorkers:'block'});
  const deniedPage=await deniedContext.newPage();
  try {
    const denied=await harness(deniedPage,baseURL!,[row('assigned',{AV_NOTE:'REQUIRES PHOTO',SPEC:'N/A',MATCH:'100',LOC_MATCH_QTY:'100'})],'MANAGER','dylan_collyge',false);
    await denied.openRows();
    await expect(deniedPage.locator('#task-content').getByRole('button',{name:'Open reclass transaction',exact:true})).toHaveCount(0);
    expect(await deniedPage.evaluate(()=>window.eval('isAvBlanksPhotoBypassUserAllowed()'))).toBe(true);
    await deniedPage.evaluate(()=>window.eval(`avBlanksPhotoBypassSettingsCache=normalizeAvBlanksPhotoBypassSettingsPayload({users:[]});avBlanksPhotoBypassAccessCache={username:'dylan_collyge',allowed:false,canManage:false,loadedAt:Date.now()};openDetail('isolated-av-assigned','tasks',{preferredTab:'season'})`));
    await expect(deniedPage.locator('#ssn-av-note')).toHaveValue('REQUIRES PHOTO');
    await deniedPage.locator('#ssn-btn-save-complete').click();
    await expect.poll(()=>deniedPage.evaluate(()=>(window as any).__taskAv.toasts.some((t:any)=>/photo required/i.test(t.title)))).toBe(true);
    expect(await deniedPage.evaluate(()=>(window as any).__taskAv.saves.filter((s:any)=>s.p_complete).length)).toBe(0);
    expect(await denied.ids()).toContain('isolated-av-assigned');
    await denied.clean();
  } finally {await deniedContext.close()}
  expect(await page.evaluate(()=>window.eval('isAvBlanksPhotoBypassUserAllowed()'))).toBe(true);
  await app.clean();
});
