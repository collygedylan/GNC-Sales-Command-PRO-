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

test('Request customer cache picks up a published mapping revision without reloading the page', {tag:['@local-e2e','@release-functional']},async({page})=>{
  await page.setContent('<input id="cust-search-input" value="">');
  await page.addScriptTag({content:requestMappingSetup+'\n'+requestMappingFunctions()});
  const publication=await page.evaluate((oldRow)=>{
    const w=window as any;
    w.customerRepMapRows=[oldRow];
    w.tempSelectedReqRep='Molly Dixon';
    const before=w.getRequestModalCustomerOptionsForRep('Molly Dixon');

    const published=[];
    for(let customerIndex=0;customerIndex<119;customerIndex++){
      const customerId=String(100+customerIndex).padStart(6,'0');
      const customerName=customerIndex<2?'Shared Customer':`Customer ${String(customerIndex).padStart(3,'0')}`;
      const relationshipCount=customerIndex<30?2:1;
      for(let relationshipIndex=0;relationshipIndex<relationshipCount;relationshipIndex++){
        const relationNumber=published.length;
        published.push({
          unique_id:`published-${relationNumber}`,
          customeridentityid:customerId,
          consigneeid:String(500+relationNumber).padStart(6,'0'),
          customername:customerName,
          consigneename:`Location ${customerIndex+1}${relationshipIndex?'B':'A'}`,
          salesrepid:'0003',salesrepname:'Molly Dixon',customerstatus:'A',consigneestatus:'A'
        });
      }
    }
    w.customerRepMapRows=published;
    w.mappingRevision='published-revision-2';
    const options=w.getRequestModalCustomerOptionsForRep('Dixon, Molly');
    const groups=w.buildRequestCustomerPickerGroups(options);
    const shared=groups.find((group:any)=>group.customeridentityid==='000100');
    return {
      beforeCount:before.length,
      relationshipCount:options.length,
      customerCount:groups.length,
      distinctCustomerIds:new Set(options.map((option:any)=>option.customeridentityid)).size,
      firstCustomerConsigneeCount:shared?.consignees.length||0,
      leadingZeroIds:options.every((option:any)=>/^0{2,}/.test(option.customeridentityid)&&/^0{2,}/.test(option.consigneeidentityid)),
      samePage:document.querySelector('#cust-search-input')!==null
    };
  },mappingFixtureRow);
  expect(publication).toEqual({
    beforeCount:0,
    relationshipCount:149,
    customerCount:119,
    distinctCustomerIds:119,
    firstCustomerConsigneeCount:2,
    leadingZeroIds:true,
    samePage:true
  });
});
