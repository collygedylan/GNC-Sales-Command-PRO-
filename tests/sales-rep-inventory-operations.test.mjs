import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readComposedAppSource();
const start=html.indexOf('function canCurrentUserSubmitRepInventoryOperations()');
const end=html.indexOf('function buildArgosInventoryTransactionRailHtml',start);
test('rep operational controls require the active stored account identity',()=>{
 const context=vm.createContext({Date,nativeAuthSessionActive:true,currentUser:'rep_one',nativeAuthProfile:{id:'rep-id',username:'rep_one',role:'\nREP\r\n',must_change_password:false}});
 vm.runInContext(html.slice(start,end),context);
 assert.equal(context.canCurrentUserSubmitRepInventoryOperations(),true);
 for(const change of [{disabled_at:'2026-01-01'},{must_change_password:true},{locked_until:'2099-01-01'},{username:'other_rep'},{role:'STAFF'}]){
  const old=context.nativeAuthProfile; context.nativeAuthProfile={...old,...change};
  assert.equal(context.canCurrentUserSubmitRepInventoryOperations(),false); context.nativeAuthProfile=old;
 }
 context.nativeAuthSessionActive=false; assert.equal(context.canCurrentUserSubmitRepInventoryOperations(),false);
});
test('rep editor exposes only priority and hold/stop controls',()=>{
 const editor=html.slice(html.indexOf('function buildArgosReclassActionFieldsHtml'),html.indexOf('function buildArgosReclassRowFieldsHtml'));
 assert.match(editor,/filter\(\(action\) => !repOperations \|\| \['priority_change', 'hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'\]/);
 assert.match(editor,/repOperations \? '' : locationDetailsHtml/);
 const toggle=html.slice(html.indexOf('function toggleArgosReclassV3Action'),html.indexOf('function toggleArgosReclassV3Action')+650);
 assert.match(toggle,/canCurrentUserSubmitRepInventoryOperations\(\).*includes\(normalized\)\) return false/);
});
test('shared frontend inventory scope retains every season and lot',()=>{
 const context=vm.createContext({});
 const start=html.indexOf('function shouldHideU3InventoryRowForRep('),end=html.indexOf('const FLYER_SHADOW_FIELD_MAP',start);
 vm.runInContext(html.slice(start,end),context);
 const rows=[{SEASON:'U3',LOTCODE:'27.U3'},{SEASON:'F1',LOTCODE:'26.F1'},{SEASON:'U3',LOTCODE:'28.U3'}];
 assert.deepEqual(context.applyRepU3VisibilityScope(rows),rows);
 for(const row of rows)assert.equal(context.shouldHideU3InventoryRowForRep(row,{isRepLike:true}),false);
 assert.equal(context.getRepU3VisibilityScopeKey(),'all-seasons');
});
