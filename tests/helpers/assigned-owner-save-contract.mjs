import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {functionSource} from './completed-row-contract.mjs';
export function assignedFilterResetContract(){
 for(const field of ['ASSIGNEDTO','DEFAULT_ASSIGNEDTO','PLANTGROUPCODE'])for(const values of [[],null,[''],['140_grass']]){
 const state={filters:{[field]:['old'],OTHER:['retained']},editor:{field,values,sort:null}},frames=[];
 const c=vm.createContext({getManagerAssignedColumnState:()=>state,canViewAssignedItemsExport:()=>true,closeManagerAssignedColumnFilter(){},requestAnimationFrame:fn=>frames.push(fn),scheduleManagersRender(){}});
 vm.runInContext(functionSource('applyManagerAssignedColumnFilter'),c);c.applyManagerAssignedColumnFilter();
 if(values?.length)assert.deepEqual([...state.filters[field]],values);else assert.equal(Object.hasOwn(state.filters,field),false);
 assert.deepEqual(state.filters.OTHER,['retained']);assert.equal(frames.length,1);frames[0]();
 }}
export function assignedOwnerSaveContract(){
 const sql=fs.readFileSync(new URL('../../supabase/migrations/20261103040000_assigned_owner_roster_parity.sql',import.meta.url),'utf8');
 for(const relation of ['ph_app_users','user_access','ph_company_directory','ph_itemcode_default_owners','ph_eval_assignment_users'])assert.ok(sql.includes('public.'+relation),relation);
 for(const user of ['chris_fisher','dylan_collyge','zoe_green','megan_kelly','mitch_kaiser','nelly_aguilar','morgan_anderson','jd_jones','abigail_vazquez','bobby_adair','charley_robertson','jorge_colunga','kayla_knepp','josh_cantu','todd_dowty'])assert.ok(sql.includes("'"+user+"'"),user);
 for(const [alias,canonical] of [['abigail_vasquez','abigail_vazquez'],['charlie_robertson','charley_robertson'],['kayla_knapp','kayla_knepp']])assert.ok(sql.includes("when '"+alias+"' then '"+canonical+"'"));
 for(const boundary of ['private.itemcode_owner_candidate_v1(owners.owner)','private.itemcode_owner_candidate_v1(NEW.assignedto)','private.itemcode_owner_candidate_v1(default_row.assignedto)','private.can_manage_eval_assignments()','ITEMCODE_DEFAULT_OWNER_IDEMPOTENCY_CONFLICT','pg_advisory_xact_lock','previous_owner_scope'])assert.ok(sql.includes(boundary),boundary);
}

export function earlyPhotoAndBatchContract(){
 const c=vm.createContext({firstNonEmptyValue:(...xs)=>xs.find(x=>x!=null&&String(x).trim()),shouldPreferFlyerOwnedFields:()=>false});
 vm.runInContext(['getLocPhotoEvidenceContext','getLocPhotoOwnedValue','parseLocPhotoEvidenceTimestamp','getLocPhotoCaptureEvidence','getLocPhotoEvidenceState'].map(functionSource).join('\n'),c);
 const now=Date.parse('2026-11-03T06:13:00Z'),row={PHOTO_NAME:new Date(now-1).toISOString(),PHOTO_LINK:'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/location_sales_notes_photos/proof/2026-11-03.jpg'};
 assert.equal(c.getLocPhotoEvidenceState(row,'drive',now).state,'current');
 assert.equal(c.getLocPhotoEvidenceState({...row,PHOTO_NAME:new Date(now+1).toISOString()},'drive',now).state,'future');
 const sql=fs.readFileSync(new URL('../../supabase/migrations/20261103051000_batch_explicit_owner_resolution.sql',import.meta.url),'utf8');
 for(const boundary of ['for update of a','private.ph_inventory_row_assignment_audit','private.can_manage_eval_assignments()','itemcode_owner_candidate_v1(owners.owner)','private.resolve_inventory_row_assignment_v1(row_to_resolve.unique_id','not (m.unique_id=any(fast_ids))'])assert.ok(sql.includes(boundary),boundary);
}
