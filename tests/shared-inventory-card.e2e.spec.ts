import { test, expect } from '@playwright/test';
import { installDriveCardLayoutFixture, renderDriveLayoutCard, settleDriveLayoutShell } from './fixtures/drive-card-layout';
// @test-group: @release-functional

for (const theme of ['light','dark','outdoor'] as const) {
 test(`Drive Suspend and Docks share metrics and responsive layout (${theme})`, {tag:['@release-functional']}, async({page,baseURL},testInfo)=>{
  const fixture=await installDriveCardLayoutFixture(page,baseURL!);
  await settleDriveLayoutShell(page,testInfo.project.name);
  await renderDriveLayoutCard(page,{theme,photo:true,longContent:true,knownQuantities:true},fixture);
  await page.evaluate(()=>window.eval(`(() => {
   const context=getProductionLiveSyncContext(),state=getDatasetState('master');
   state.liveVerifiedScope=context.scope;
   state.liveVerifiedPermission=context.dataPermissionVersion;
   state.liveVerifiedRevision='1';
  })()`));
  const layouts=[];
  for(const source of ['drive','request','docks']) {
   await page.evaluate((source)=>window.eval(`(() => {
   const row={...fullInventory[0],DOM_ID:'shared-test-'+${JSON.stringify(source)},DOCK_NUM:'D01',STOPNUMBER:'02',QUANTITYORDERED:0,DOCK_SPEC:'Verified tall spec',REQ_SPEC:'Verified tall spec',PLANSTART:'2026-10-19'};
    if(${JSON.stringify(source)}==='request'){row.DOCK_SUSPEND_DC_REQUEST=true;row.DOCK_SUSPEND_SOURCE_UID=row.UNIQUE_ID;activeReqTab='suspend-tag';}
    const host=document.getElementById(${JSON.stringify(source === 'docks' ? 'docks-content' : source === 'request' ? 'request-content' : 'drive-content')});
    if(${JSON.stringify(source)}==='docks') document.getElementById('view-docks')?.classList.remove('hidden');
    if(${JSON.stringify(source)}==='request') document.getElementById('view-request')?.classList.remove('hidden');
    host.innerHTML=generateCard(row,${JSON.stringify(source)},'status-green',{preserveUnknownAvailability:true,verifiedQuantityRow:row});
    host.querySelectorAll('img[data-deferred-card-photo]').forEach(image=>hydrateDeferredCardPhoto(image));
   })()`),source);
   const hostSelector=source==='docks'?'#docks-content':source==='request'?'#request-content':'#drive-content';
   const card=page.locator(`${hostSelector} .app-shared-drive-layout`);
   await expect(card).toBeVisible();
   // The premium shell decorates inserted cards on an animation frame. Its
   // ui-card border changes the available grid width, so compare settled cards.
   await expect(card).toHaveClass(/\bui-card\b/);
   await expect(card.locator('[data-inventory-card-metric]')).toHaveCount(6);
   await expect(card.locator('[data-inventory-card-metric="on-hand"] .app-card-qty-value')).toHaveText('15');
   if(source!=='drive') {
    const meta=card.locator('.app-operational-card-meta');
    await expect(meta).toContainText('Sales Rep');
    await expect(meta).toContainText('Request Qty');
    expect(await card.evaluate(el=>{
     const metadata=el.querySelector('.app-operational-card-meta');
     const operational=el.querySelector('.app-operational-card-header-fields');
     return !!(metadata && operational && (metadata.compareDocumentPosition(operational)&Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    await expect(card.locator('.app-operational-card-header-fields')).toContainText('Dock NumberD01');
    await expect(card.locator('.app-operational-card-header-fields')).toContainText('Drop Number02');
    await expect(card.locator('.app-operational-card-header-fields')).toContainText('SpecVerified tall spec');
    expect(await card.locator('.app-drive-card-title').evaluate(node=>getComputedStyle(node).color)).toBe('rgb(17, 24, 39)');
    expect(await card.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('rgb(243, 232, 255)');
    const layout=await card.evaluate(el=>{
     const bounds=(selector:string)=>{
      const node=el.querySelector(selector);
      if(!node) return null;
      const rect=node.getBoundingClientRect();
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
     };
     return {photo:bounds('.app-drive-card-photo'),title:bounds('.app-drive-card-header'),meta:bounds('.app-operational-card-meta'),fields:bounds('.app-operational-card-header-fields')};
    });
    expect(layout.photo && layout.title && layout.meta && layout.fields).toBeTruthy();
    expect(layout.meta!.left).toBeGreaterThanOrEqual(layout.photo!.right-2);
    expect(layout.fields!.left).toBeGreaterThanOrEqual(layout.photo!.right-2);
    expect(layout.meta!.top).toBeGreaterThanOrEqual(layout.title!.bottom-2);
    expect(layout.fields!.top).toBeGreaterThan(layout.meta!.top);
    expect(layout.fields!.top).toBeGreaterThanOrEqual(layout.meta!.bottom-2);
   }
   if(source==='docks') {
    await expect(card).toHaveClass(/app-operational-planstart-card/);
    await expect(card).toHaveClass(/app-card-planstart-monday/);
    await card.screenshot({path:testInfo.outputPath(`docks-weekday-monday-${theme}.png`)});
   }
   layouts.push(await card.evaluate(el=>{
    const grid=getComputedStyle(el.querySelector('.app-card-qty-row')!);
    const label=getComputedStyle(el.querySelector('.app-card-qty-label')!);
    const tracks=grid.gridTemplateColumns.split(/\s+/).map(track=>parseFloat(track));
    const total=tracks.reduce((sum,track)=>sum+track,0);
    return {columns:tracks.map(track=>track/total),gap:grid.gap,label:label.fontSize,padding:getComputedStyle(el).padding};
   }));
   expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  }
  // The actual Request and Docks hosts have different widths, so compare the
  // normalized six-track proportions plus the shared typography/spacing.
  expect(layouts[2].columns).toHaveLength(6);
  expect(layouts[1].columns).toHaveLength(6);
  layouts[1].columns.forEach((track,index)=>expect(layouts[2].columns[index]).toBeCloseTo(track,3));
  expect(layouts[2].gap).toBe(layouts[1].gap);
  expect(layouts[2].label).toBe(layouts[1].label);
  expect(layouts[2].padding).toBe(layouts[1].padding);
 });
}
