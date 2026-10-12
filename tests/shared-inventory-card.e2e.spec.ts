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
    const row={...fullInventory[0],DOM_ID:'shared-test-'+${JSON.stringify(source)},DOCK_NUM:'D01',STOPNUMBER:'02',QUANTITYORDERED:0,DOCK_SPEC:'Verified tall spec',REQ_SPEC:'Verified tall spec'};
    if(${JSON.stringify(source)}==='request'){row.DOCK_SUSPEND_DC_REQUEST=true;row.DOCK_SUSPEND_SOURCE_UID=row.UNIQUE_ID;activeReqTab='suspend-tag';}
    const host=document.getElementById('drive-content');
    host.innerHTML=generateCard(row,${JSON.stringify(source)},'status-green',{preserveUnknownAvailability:true,verifiedQuantityRow:row});
    host.querySelectorAll('img[data-deferred-card-photo]').forEach(image=>hydrateDeferredCardPhoto(image));
   })()`),source);
   const card=page.locator('#drive-content .app-shared-drive-layout');
   await expect(card).toBeVisible();
   // The premium shell decorates inserted cards on an animation frame. Its
   // ui-card border changes the available grid width, so compare settled cards.
   await expect(card).toHaveClass(/\bui-card\b/);
   await expect(card.locator('[data-inventory-card-metric]')).toHaveCount(6);
   await expect(card.locator('[data-inventory-card-metric="on-hand"] .app-card-qty-value')).toHaveText('15');
   if(source!=='drive') {
    await expect(card.locator('.app-operational-card-header-fields')).toContainText('Dock NumberD01');
    await expect(card.locator('.app-operational-card-header-fields')).toContainText('Drop Number02');
    await expect(card.locator('.app-operational-card-header-fields')).toContainText('SpecVerified tall spec');
   }
   layouts.push(await card.evaluate(el=>{
    const grid=getComputedStyle(el.querySelector('.app-card-qty-row')!);
    const label=getComputedStyle(el.querySelector('.app-card-qty-label')!);
    return {columns:grid.gridTemplateColumns,gap:grid.gap,label:label.fontSize,padding:getComputedStyle(el).padding};
   }));
   expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  }
  expect(layouts[1]).toEqual(layouts[0]);
  expect(layouts[2]).toEqual(layouts[0]);
 });
}
