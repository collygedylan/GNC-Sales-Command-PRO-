import assert from 'node:assert/strict';
import vm from 'node:vm';
import { reclassWorksheetSource } from './reclass-worksheet-source.mjs';

export function checkReclassPhysicalStock(source) {
 const row=(id,loc,lot,oh,av,stock)=>({UNIQUE_ID:id,ITEMCODE:'010018.031.1',LOCATIONCODE:loc,LOTCODE:lot,SEASON:lot.split('.').pop(),PTRONHAND:String(oh),PTRAVAILABLE:String(av),S_LTS:String(stock)});
 const rows=[row('source','A.03.000','27.S1',330,330,330),row('target','A.03.000','27.F1',114,104,104),row('sibling','A.02.000','28.F1',40,40,375)];
 const ctx=vm.createContext({getConfiguredCurrentSalesYearCode:()=>27,getConfiguredCurrentSeasonCode:()=> 'F1',parseAppNumber:v=>v==null?null:Number(v),buildItemInquiryViewModel:(_item,r)=>({rows:r}),avInventory:[],fullInventory:rows,cavInventory:[{ITEMCODE:'010018.031.1',SEASON:'F1',OPEN_STOCK:'375'},{ITEMCODE:'010018.031.1',SEASON:'S1',OPEN_STOCK:'330'}]});
 vm.runInContext(source('normalizeNcrSalesYearValue')+reclassWorksheetSource(),ctx);
 const start=performance.now();
 const result=ctx.buildOptimisticInventoryReclassMoveModel({item:rows[0],inquiryModel:{rows}},{commandId:'test-stock',moves:[{source:{uniqueId:'source'},lines:[{quantity:55,destinationSeason:'F1'}]}]}).model.rows;
 assert.ok(performance.now()-start<100);
 const sourceRow=result.find(r=>r.UNIQUE_ID==='source');assert.equal(sourceRow.PTRONHAND,'275');assert.equal(sourceRow.PTRAVAILABLE,'275');assert.equal(sourceRow.S_LTS,'275');
 const target=result.find(r=>r.UNIQUE_ID==='target');assert.equal(target.PTRONHAND,'169');assert.equal(target.PTRAVAILABLE,'159');assert.equal(target.S_LTS,'159');
 assert.equal(result.find(r=>r.UNIQUE_ID==='sibling').S_LTS,'375', 'different sales year stays unchanged');
 assert.equal(target.__reclassSeasonOpenStock,'159');
 assert.equal(rows[0].PTRONHAND,'330','preview retains immutable rollback rows');
}

export function checkReclassNewDestination(source) {
 const sourceRow={UNIQUE_ID:'orange-s1',ITEMCODE:'010585.031.1',LOCATIONCODE:'D.21.000',LOTCODE:'27.S1',SEASON:'S1',PTRONHAND:'2168',PTRAVAILABLE:'2168',S_LTS:'1323',PHOTO_LINK:'one.webp,two.webp',PHOTO_DATE:'2026-10-27',SPEC:'10-12 H x 14-16 W',CALIPER:'',LOC_PHOTO_MATCH:'325',LOC_MATCH_PCT:'15'};
 const ctx=vm.createContext({getConfiguredCurrentSalesYearCode:()=>27,getConfiguredCurrentSeasonCode:()=> 'F1',parseAppNumber:v=>v==null?null:Number(v),buildItemInquiryViewModel:(_item,r)=>({rows:r}),avInventory:[],fullInventory:[sourceRow],cavInventory:[{ITEMCODE:'010585.031.1',SEASON:'F1',OPEN_STOCK:'1323'}]});
 vm.runInContext(source('normalizeNcrSalesYearValue')+reclassWorksheetSource(),ctx);
 const rows=ctx.buildOptimisticInventoryReclassMoveModel({item:sourceRow,inquiryModel:{rows:[sourceRow]}},{commandId:'orange-move',moves:[{source:{uniqueId:'orange-s1'},lines:[{quantity:325,destinationSeason:'F1'}]}]}).model.rows;
 const destination=rows.find(row=>row.LOTCODE==='27.F1');
 assert.equal(destination.PTRONHAND,'325');
 assert.equal(destination.S_LTS,'325');
 assert.equal(destination.__reclassSeasonOpenStock,'325');
 for (const field of ['PHOTO_LINK','PHOTO_DATE','SPEC','CALIPER','LOC_PHOTO_MATCH','LOC_MATCH_PCT']) assert.equal(destination[field],sourceRow[field],field);
 assert.equal(rows.find(row=>row.UNIQUE_ID==='orange-s1').S_LTS,'998');
}
