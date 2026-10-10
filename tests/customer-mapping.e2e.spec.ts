import { expect, test } from '@playwright/test';
import { mappingBrowserBundle, mappingFixtureRow, requestMappingFunctions, requestMappingSetup } from './helpers/customer-mapping-fixture.mjs';
// @test-group: @local-e2e,@release-functional

test('mapping management filters, edits, and preserves source identity at phone width', {tag:['@local-e2e','@release-functional']}, async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.setContent('<main id="mapping"></main>');
  await page.addScriptTag({content:mappingBrowserBundle()});
  await page.evaluate((row)=>{
    const w=window as any;w.mappingCalls=[];w.mappingSaved=0;
    w.MappingEditor.mountCustomerRepMapping(document.getElementById('mapping'),async (payload:any)=>{
      w.mappingCalls.push(payload);
      if(payload.operation==='save')return {ok:true,row:{...row,customername:payload.customerName,revision:'4'},revision:'4'};
      return {ok:true,rows:payload.filters.customername==='Absent'?[]:[row],total:payload.filters.customername==='Absent'?0:1,page:0,pageSize:50,revision:'3',canEdit:true};
    },()=>w.mappingSaved++);
  },mappingFixtureRow);
  await expect(page.getByRole('cell',{name:'Garden ® ID 00012'})).toBeVisible();
  await page.getByLabel('Filter Customer Name').fill('Absent');
  await expect(page.getByRole('status')).toHaveText('No matching mappings.');
  await page.getByLabel('Filter Customer Name').fill('Garden');
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Customer Name',{exact:true}).fill('Garden Updated ®');
  await page.getByRole('button',{name:'Save mapping'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).mappingSaved)).toBe(1);
  const saved=await page.evaluate(()=>(window as any).mappingCalls.find((p:any)=>p.operation==='save'));
  expect(saved).toMatchObject({id:'map-1',expectedRevision:'3',customerName:'Garden Updated ®'});
  expect(saved).not.toHaveProperty('customeridentityid');
});

test('Request choices keep the rep/customer/consignee relationship and reject typed bypasses', {tag:['@local-e2e','@release-functional']},async({page})=>{
  await page.setContent('<input id="cust-search-input" value="Not mapped">');
  await page.addScriptTag({content:requestMappingSetup+'\n'+requestMappingFunctions()});
  const result=await page.evaluate(row=>{
    const w=window as any;
    w.customerRepMapRows=[row,{...row,unique_id:'other',salesrepname:'Rep Two',consigneeid:'other'}, {...row,unique_id:'inactive',customerstatus:'I'}];
    w.reservesInventory=[{...row,customername:'Not mapped'}];
    const options=w.getRequestModalCustomerOptionsForRep('Rep One');
    w.processCustStep();
    return {options,qtyCalls:w.qtyCalls,toasts:w.toasts};
  },mappingFixtureRow);
  expect(result.options).toHaveLength(1);
  expect(result.options[0]).toMatchObject({customeridentityid:'00012',consigneeidentityid:'00007'});
  expect(result.qtyCalls).toHaveLength(0);
  expect(result.toasts[0][0]).toBe('Select Mapped Consignee');
});
