import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export function assertRequestRowIsolation() {
  const f1 = {UNIQUE_ID:'f1',ITEMCODE:'000808.050.1',LOCATIONCODE:'I.11.000',LOTCODE:'27.F1',SPEC:'F1',PHOTO_LINK:'f1-photo'};
  const s1 = {...f1,UNIQUE_ID:'s1',LOTCODE:'27.S1',SPEC:'S1',PHOTO_LINK:'s1-photo'};
  const notes = [{...f1,LOTCODE:''},{...f1,UNIQUE_ID:'wrong-owner',LOTCODE:'27.S1'}];
  const state = {noteScope:'actor',locationSalesNotes:new Map([[f1.ITEMCODE,notes]])};
  const context = vm.createContext({Map,Set,Date,masterInventoryById:new Map([['f1',f1],['s1',s1]]),
    masterInventoryByItemCode:new Map([[f1.ITEMCODE,[f1,s1]]]),getManagerAssignedColumnState:()=>state,
    getSupabaseReadIdentityScope:()=>'actor',getPhotoUrlList:v=>String(v||'').split(',').filter(Boolean),
    getPhotoEntryDateMs:()=>Date.now(),getPhotoRetentionFallbackDateMs:()=>Date.now()});
  vm.runInContext(fs.readFileSync(new URL('../../assets/canonical-inventory-evidence.js',import.meta.url),'utf8'),context);
  assert.equal(context.projectCanonicalInventoryRow(s1).PHOTO_LINK,'s1-photo');
  assert.equal(context.projectCanonicalInventoryRow(s1).SPEC,'S1');
  assert.equal(context.resolveCanonicalInventoryTarget({...s1,MASTER_ID:'f1'},context.masterInventoryById,context.masterInventoryByItemCode),null);
  assert.equal(context.resolveCanonicalInventoryTarget({...s1,UNIQUE_ID:'missing',LOTCODE:''},context.masterInventoryById,context.masterInventoryByItemCode),null);
  assert.equal(context.resolveCanonicalInventoryTarget({...s1,UNIQUE_ID:'req',MASTER_ID:'s1'},context.masterInventoryById,context.masterInventoryByItemCode),s1);
  assert.equal(context.canonicalInventorySameLot({...s1,LOTCODE:'S1',SALEYEAR:'2027'},s1),true);
}
