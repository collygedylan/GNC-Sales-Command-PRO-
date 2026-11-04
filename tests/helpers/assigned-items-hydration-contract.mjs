import assert from 'node:assert/strict';
import vm from 'node:vm';
import {contracts} from '../../services/database-contracts.generated.ts';
import {matchesSchema} from '../../services/database-contract-runtime.ts';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
const source=readComposedRuntimeSource();
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);const end=source.indexOf('\n        }',start);assert.ok(end>start,name);return source.slice(start,end+10);}
export async function assignedItemsHydrationContract(){
 for(const table of ['ph_inventory_row_assignments','ph_itemcode_default_owners']){const field=contracts.tables[table].row.object.plant_group_code;assert.ok(field,table+' includes additive metadata');assert.ok(matchesSchema(field.schema,'130_SHRUB'));assert.ok(matchesSchema(field.schema,null));assert.equal(matchesSchema(field.schema,42),false);}
 const state={}; const context=vm.createContext({getManagerAssignedColumnState:()=>state,fullInventory:[],cavInventory:[],cropRollDriveInventory:[],masterInventoryByItemCode:new Map(),getDatasetLoadSignature:()=>'',buildManagerEvalAssignmentKey:v=>String(v||'').trim().toUpperCase(),firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim()),applyCommittedItemcodeOwnerReceipt:()=>{},normalizeEvalAssignableUser:v=>String(v||'').toLowerCase(),EVAL_TASK_INACTIVE_USERS:new Set(),getManagerItemLowStockTargetsState:()=>({}),getManagerAssignableOwnerUsers:()=>[]});
 vm.runInContext(fn('getCropRollPlantGroup')+';'+fn('normalizeWarehouseAssignedItemRow'),context);
 const raw=await Promise.resolve([{ITEMCODE:'123456.010.1',PLANTGROUPCODE:'',raw_row:{PLANTGROUPCODE:'130_SHRUB'}}]);
 assert.equal(context.normalizeWarehouseAssignedItemRow(raw[0]).PLANTGROUPCODE,'130_SHRUB','async assignment raw detail is not discarded');
 vm.runInContext(fn('enrichManagerAssignedPlantGroups'),context);
 state.itemDetails=[{ITEMCODE:'123456.010.2',details:{plant_group_code:'130_SHRUB'}},{ITEMCODE:'999999.100.1',plantgroup:'330_TREES'}];
 state.inquiryCoverage=[{ITEMCODE:'555555.010.1',PLANTGROUPCODE:'140_GRASS'}]; state.items=[{ITEMCODE:'777777.010.1',PLANTGROUPCODE:'151_PEREN'}];
 const response=await Promise.resolve([{itemcode:'123456.010.3',plant_group_code:''},{itemcode:'999999.100.1'},{itemcode:'555555.010.1'},{itemcode:'777777.010.1'}]);
 const result=context.enrichManagerAssignedPlantGroups(response);
 const warmIndex=state.plantGroupIndex;
 let sourcePasses=0;
 state.itemDetails.values=function(){sourcePasses++;return Array.prototype.values.call(this);};
 context.enrichManagerAssignedPlantGroups([{itemcode:'123456.010.8'}]);
 assert.equal(state.plantGroupIndex,warmIndex);assert.equal(sourcePasses,0,'a warm row lookup must not rescan the inventory');
 assert.deepEqual(Array.from(result,r=>r.PLANTGROUPCODE),['130_SHRUB','330_TREES','140_GRASS','151_PEREN']);
 assert.equal(context.enrichManagerAssignedPlantGroups([{itemcode:'123456.010.3',plant_group_code:''}])[0].PLANTGROUPCODE,'130_SHRUB','later blank server response retains lookup metadata');
 state.itemDetails.push({ITEMCODE:'123456.010.4',plantgroupcode:'330_TREES'}); state.dataEpoch=1;
 assert.equal(context.enrichManagerAssignedPlantGroups([{itemcode:'123456.010.9'}])[0].PLANTGROUPCODE,'','ambiguous base itemcodes never guess');
 const applyState={filters:{},editor:{field:'PLANTGROUPCODE',values:['130_shrub'],sort:null}},frames=[],calls=[];
 const apply=vm.createContext({canViewAssignedItemsExport:()=>true,getManagerAssignedColumnState:()=>applyState,closeManagerAssignedColumnFilter:(...args)=>calls.push(args),requestAnimationFrame:f=>frames.push(f),scheduleManagersRender:()=>calls.push('render')});
 vm.runInContext(fn('applyManagerAssignedColumnFilter'),apply);apply.applyManagerAssignedColumnFilter();assert.deepEqual(Array.from(applyState.filters.PLANTGROUPCODE),['130_shrub']);assert.equal(calls.length,1);assert.equal(frames.length,1);frames[0]();assert.equal(calls[1],'render');
 assert.ok(source.includes('warehouseAssignedItemsInventory = enrichManagerAssignedPlantGroups(res.warehouseAssignedItemsData'));
 const filterState={filters:{PLANTGROUPCODE:['130_shrub']},displayCache:{rows:[{ITEMCODE:'A',PLANTGROUPCODE:'130_SHRUB'},{ITEMCODE:'B',PLANTGROUPCODE:'330_TREES'}]}};
 const cached=vm.createContext({getManagerAssignedColumnState:()=>filterState,getManagerAssignedItemsDisplayRows:()=>{throw Error('background refresh must not block filter')},rememberManagerAssignedColumnLabels:()=>{},getManagerAssignedItemsActiveAssigneeKey:()=> 'all',managersSearchTerm:'',managerEvalAssignmentSelection:new Set(),matchesManagerAssignedColumnFilters:r=>r.PLANTGROUPCODE==='130_SHRUB',managerTextMatchesSearch:()=>true,buildManagerEvalAssignmentKey:v=>v,sortManagerAssignedColumnRows:r=>r});
 vm.runInContext(fn('getFilteredManagerAssignedItemsExportRows'),cached);assert.deepEqual(Array.from(cached.getFilteredManagerAssignedItemsExportRows(),r=>r.ITEMCODE),['A']);
}
export function assignedItemsOwnerOptionsContract(){
 const c=vm.createContext({GncUserAccessControl:{state:{userAccess:[{username:'matrix_eval',role:'EVAL'}]}},getAssignableAppUserOptions:()=>[{username:'josh_cantu',role:'EVAL'},{username:'kayla_knapp',role:'EVAL'},{username:'todd_dowty',role:'EVAL'}],EVAL_ASSIGNMENT_ROSTER_USERS:['dylan_collyge','zoe_green','megan_kelly','mitch_kaiser','nelly_aguilar','morgan_anderson','jd_jones'],evalAssignableUsers:['bobby_adair'],EVAL_TASK_INACTIVE_USERS:new Set(['retired_owner']),normalizeEvalAssignableUser:v=>String(v||'').toLowerCase().replace('nally_aguilar','nelly_aguilar'),warehouseAssignedItemsInventory:[{ASSIGNEDTO:'extra_owner'},{ASSIGNEDTO:'retired_owner'}],fullInventory:[],getManagerAssignedColumnState:()=>({defaultOwnersByCode:new Map([['x',{assignedto:'default_owner'}]])})});
 vm.runInContext(fn('getManagerAssignableOwnerUsers'),c);const users=Array.from(c.getManagerAssignableOwnerUsers());
 for(const user of ['matrix_eval','josh_cantu','kayla_knapp','todd_dowty','dylan_collyge','zoe_green','megan_kelly','mitch_kaiser','nelly_aguilar','morgan_anderson','jd_jones','extra_owner','default_owner','retired_owner'])assert.ok(users.includes(user),user);
 for(const name of ['getManagerEvalAssigneeOptionsHtml','getManagerAssignedItemsViewProps','renderManagerAssignedItemsExportPanel'])assert.match(fn(name),/getManagerAssignableOwnerUsers/);
 assert.doesNotMatch(fn('getManagerAssignedColumnOptions'),/getManagerAssignableOwnerUsers/);
}
