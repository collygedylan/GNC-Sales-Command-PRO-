import assert from 'node:assert/strict';

// Called only by the explicitly enabled authenticated release proof.
// Reference saves retain their current values; no inventory moves or messages occur.
export async function verifyNurseryLive(page) {
  const proof={views:[],saves:[],permissions:{},liveInventory:{}};
  await page.evaluate(()=>openManagerTableManagement('president-command-center'));
  await page.waitForSelector('.nursery-shell',{timeout:30000});
  await page.waitForFunction(()=>{const status=document.querySelector('[data-nursery-status]')?.textContent;return status&&status!=='Loading reference data…';},null,{timeout:120000});
  assert.equal(await page.locator('[data-nursery-status]').textContent(),'Changes saved','Nursery reference hydration failed');
  const views=await page.evaluate(()=>GncNurseryModel.TABLES.map(({id,label,relation})=>({id,label,relation})));
  assert.equal(views.length,9);
  for(const view of views){
    const started=Date.now();
    await page.locator('[aria-label="Nursery view"]').selectOption(view.id);
    await page.waitForFunction(label=>document.querySelector('.nursery-shell h2')?.textContent===label,view.label);
    if(!view.relation&&view.id!=='bunch-notes-simulator')await page.locator('[data-nursery-filter="location"]').selectOption('ALL_LOCATIONS');
    const geometry=await page.evaluate(()=>({columns:document.querySelectorAll('.nursery-scroll th').length,rows:document.querySelectorAll('.nursery-scroll tbody tr').length,headerPosition:getComputedStyle(document.querySelector('.nursery-scroll th')).position,toolbarPosition:getComputedStyle(document.querySelector('.nursery-toolbar')).position}));
    assert.equal(geometry.headerPosition,'sticky');assert.equal(geometry.toolbarPosition,'sticky');
    if(view.id==='president-command-center')assert.equal(geometry.columns,22);
    if(view.id==='approved-execution-plan')assert.equal(geometry.columns,16);
    if(view.id==='bunch-notes-simulator')assert.equal(geometry.columns,15);
    proof.views.push({id:view.id,renderMs:Date.now()-started,...geometry});
    const control=page.locator('[data-nursery-edit]:not([readonly])').first();
    if(await control.count()){
      const responsePromise=page.waitForResponse(response=>{
        if(!response.url().endsWith('/rest/v1/rpc/nursery_command_v23127'))return false;
        try{return response.request().postDataJSON()?.p_operation==='save';}catch{return false;}
      });
      const before=await control.evaluate(el=>({table:el.dataset.nurseryTable,key:el.dataset.nurseryKey,field:el.dataset.nurseryEdit,value:el.type==='checkbox'?el.checked:el.value}));
      await control.dispatchEvent('change');
      const response=await responsePromise,receipt=await response.json();
      assert.equal(response.status(),200);assert.equal(receipt.committed,true);assert.ok(receipt.row);
      await page.waitForFunction(()=>document.querySelector('[data-nursery-status]')?.textContent==='Changes saved');
      proof.saves.push({view:view.id,table:before.table,key:before.key,field:before.field,http:response.status(),committed:receipt.committed});
    }
  }
  await page.locator('[aria-label="Nursery view"]').selectOption('president-command-center');
  await page.locator('[data-nursery-filter="location"]').selectOption('G.10.000');
  proof.liveInventory=await page.evaluate(()=>{
    const original=fullInventory,copy=original.map(row=>({...row}));
    const sample=copy.find(row=>String(row.WAREHOUSEI??row.warehousei??row.WAREHOUSE??row.warehouse??'').includes('10')&&GncNurseryModel.block(row.LOCATIONCODE??row.locationcode)==='G.10.000');
    if(!sample)return {rows:original.length,sampleFound:false};
    const key=['onhand','ONHAND','ptronhand','PTRONHAND','on_hand','ON_HAND'].find(name=>sample[name]!==undefined);
    const before=Number(sample[key]);sample[key]=before+100;
    // Change only this isolated browser's displayed inventory, then restore it.
    fullInventory=copy;window.__nurseryOriginalInventory=original;
    return {rows:original.length,sampleFound:true,key,before,after:sample[key],kpiBefore:[...document.querySelectorAll('.nursery-kpis strong')].map(e=>e.textContent)};
  });
  if(proof.liveInventory.sampleFound){
    await page.waitForFunction(before=>JSON.stringify([...document.querySelectorAll('.nursery-kpis strong')].map(e=>e.textContent))!==JSON.stringify(before),proof.liveInventory.kpiBefore,{timeout:10000});
    proof.liveInventory.refreshed=true;
    await page.evaluate(()=>{fullInventory=window.__nurseryOriginalInventory;delete window.__nurseryOriginalInventory;});
  }
  proof.permissions=await page.evaluate(()=>{
    const access=window.GncUserAccessControl,original=access.state.userAccess.find(r=>r.username==='dylan_collyge'),saved=JSON.parse(JSON.stringify(original));
    access.setAccessMatrixRows([{...saved,view_nursery_command_tables:'N',view_permissions:{...saved.view_permissions,view_nursery_command_tables:'N'}}]);
    const hidden=getManagerTableManagementItems().filter(item=>item.nursery).length;
    access.setAccessMatrixRows([saved]);
    return {hiddenWhenDenied:hidden,visibleWhenGranted:getManagerTableManagementItems().filter(item=>item.nursery).length,otherAdminDefault:access.resolveUserAccessMatrix('megan_kelly','ADMIN').view_nursery_command_tables};
  });
  assert.equal(proof.permissions.hiddenWhenDenied,0);assert.equal(proof.permissions.visibleWhenGranted,9);
  return proof;
}

export async function verifyAccessMatrixLive(page){
 await page.evaluate(()=>{switchView('managers');setHomeTab(MANAGER_ACCESS_CONTROL_VIEW);});
 await page.waitForSelector('button[data-access-edit-mode="role"]',{timeout:60000});
 const modes={role:await page.locator('button[data-access-edit-mode="role"]').count(),user:await page.locator('button[data-access-edit-mode="user"]').count()};
 assert.equal(modes.role,1);assert.equal(modes.user,1);
 await page.locator('[data-access-category="reps"]').click();await page.waitForSelector('.agdata-access-matrix thead th');
 const reps=await page.evaluate(()=>{const host=document.querySelector('.agdata-access-matrix');host.scrollLeft=500;const heads=[...host.querySelectorAll('thead th')];return {chance:heads.filter(e=>e.textContent==='Rep: Chance Alldredge').length,duplicate:heads.filter(e=>/Chance Alldredge.*South TX/.test(e.textContent)).length,left:heads[0].getBoundingClientRect().left,options:getAllRequestModalRepOptions().filter(o=>/Chance Alldredge/i.test(o.label)).map(o=>o.label)};});
 assert.equal(reps.chance,1);assert.equal(reps.duplicate,0);assert.ok(reps.left>=0);assert.ok(reps.options.every(label=>!label.includes('South TX')));return {modes,reps};
}
