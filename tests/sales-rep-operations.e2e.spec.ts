import {expect,test} from '@playwright/test';
import {installHlOrderFixture,hlMaster} from './fixtures/hl-order-state.mjs';
// @test-group: @local-e2e,@release-functional

test('standard rep can open priority and hold operations without general inventory editors', {tag:['@local-e2e','@release-functional']}, async({page,baseURL})=>{
 const fixture=await installHlOrderFixture(page,baseURL!,{role:'REP',username:'operations_rep',master:[hlMaster('rep-ui-source',{itemcode:'REP.UI',commonname:'Synthetic Rep Plant',lotcode:'27.U3',season:'U3',ptronhand:'10',ptravailable:'9',priority:'2'})]});
 await page.evaluate(()=>window.eval("switchView('drive')"));
 await page.waitForFunction(()=>window.eval("fullInventory.some(row=>row.UNIQUE_ID==='rep-ui-source')"));
 await expect.poll(()=>page.evaluate(()=>window.eval('canCurrentUserSubmitRepInventoryOperations()'))).toBe(true);
 await page.evaluate(()=>window.eval("openArgosInventoryTransactionModal('rep-ui-source','reclass','drive')"));
 await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
 await expect(page.locator('[data-reclass-v3-action="priority_change"]').first()).toBeVisible();
 await expect(page.locator('[data-reclass-v3-action="hold"]').first()).toBeVisible();
 await expect(page.locator('[data-reclass-v3-action="stop_ship"]').first()).toBeVisible();
 await expect(page.locator('[data-reclass-v3-action="move_up"]')).toHaveCount(0);
 await expect(page.locator('[data-reclass-v3-action="recount"]')).toHaveCount(0);
 await expect(page.locator('[data-reclass-location-details]')).toHaveCount(0);
 for(const sourceView of ['drive','av']){
  await page.evaluate(sourceView=>window.eval(`argosInventoryTransactionState.sourceView=${JSON.stringify(sourceView)}`),sourceView);
  expect(await page.evaluate(()=>window.eval('applyArgosInventoryTransactionSourceContext({workflowPolicyVersion:RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION}).sourceContext.sourceMode'))).toBe('drive');
 }
 expect(fixture.blockedMutations).toEqual([]);
 expect(fixture.errors).toEqual([]);
});
