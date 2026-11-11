import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInventoryReclassMove,reclassActionGate} from '../supabase/functions/app-api/reclass-action-access.ts';

const actor={id:'native-id',username:'unlisted_admin',role:'REP',must_change_password:false,disabled_at:null,locked_until:null};
const source={uniqueId:'y-row',identity:{unique_id:'y-row',itemcode:'ITEM',contsize:'#3',locationcode:'A.01',
  lotcode:'27.Y',season:'Y',ptronhand:'50',ptravailable:'40'}};
const move={action:'inventory_reclass_move',commandId:'reclass-y-boundary-0001',
  moves:[{source,lines:[{direction:'move_up',destinationSeason:'F1',quantity:2}]}]};
function inventoryLookup(table,rows){
  assert.equal(table,'ph_master_inventory','Reclass cannot revisit the old named/assignment guard');
  return{select:()=>({in:async()=>({data:rows,error:null})})};
}
function fixture(allowed=true){
  const calls=[];const rows=[{...source.identity,s_lts:'40'}];
  const supabase={rpc:async(name,args)=>{calls.push({name,args});
    if(name==='authorize_reclass_command_v3076')return{data:allowed,error:null};
    if(name==='get_inventory_reclass_move_status_v1')return{data:{ok:true,status:'missing',movements:[]},error:null};
    assert.equal(name,'apply_inventory_reclass_moves_with_delivery_v1');
    return{data:{ok:true,status:'applied',commandId:args.p_command_id,rows:[]},error:null};},
    from:table=>inventoryLookup(table,rows)};
  return{calls,context:{supabase,actorProfile:actor,payload:structuredClone(move)}};
}
test('real move wrapper authorizes the current physical command before single and batch dispatch',async()=>{
  for(const batch of [false,true]){const {context,calls}=fixture();
    if(batch)context.payload.moves.push({source:{...source,uniqueId:'second-y',identity:{...source.identity,unique_id:'second-y'}},lines:move.moves[0].lines});
    const batchRows=context.payload.moves.map(m=>({...m.source.identity,s_lts:'40'}));
    if(batch)context.supabase.from=table=>inventoryLookup(table,batchRows);
    assert.equal((await handleInventoryReclassMove(context)).status,'applied');
    assert.deepEqual(calls.map(c=>c.name),['authorize_reclass_command_v3076','apply_inventory_reclass_moves_with_delivery_v1']);
    assert.equal(calls[0].args.p_actor_id,actor.id);assert.deepEqual(calls[0].args.p_command.moves,context.payload.moves);
  }
});
test('server denial stays HTTP403-compatible and never reaches a write',async()=>{
  const {context,calls}=fixture(false);await assert.rejects(handleInventoryReclassMove(context),/INVENTORY_RECLASS_PERMISSION_REQUIRED/);
  assert.deepEqual(calls.map(c=>c.name),['authorize_reclass_command_v3076']);
});
test('malformed, duplicate and payload-supplied authority fail in the canonical normalizer',async()=>{
  for(const mutate of [p=>{p.actorRole='admin';},p=>{p.actorId='foreign';},p=>{p.moves=[];},p=>{p.moves.push(structuredClone(p.moves[0]));}]){
    const {context,calls}=fixture();mutate(context.payload);await assert.rejects(handleInventoryReclassMove(context));assert.equal(calls.length,0);
  }
});
test('status recovery checks only the authenticated actor command and never repeats a move',async()=>{
  const {context,calls}=fixture();context.payload={action:move.action,operation:'status',commandId:move.commandId};
  assert.equal((await handleInventoryReclassMove(context)).status,'missing');
  assert.deepEqual(calls.map(c=>c.name),['authorize_reclass_command_v3076','get_inventory_reclass_move_status_v1']);
  assert.equal(calls[1].args.p_actor_id,actor.id);assert.equal(calls.some(c=>c.name.includes('apply_')),false);
});
test('only Reclass create/move routes delegate their existing capability gate',()=>{
  assert.equal(reclassActionGate('inventory_reclass_move',{}).gate,null);
  assert.equal(reclassActionGate('drive_reclass_inquiry',{operation:'create'}).gate,null);
  assert.deepEqual(reclassActionGate('drive_reclass_inquiry',{operation:'status'}).gate,{flag:'can_access_drive_mode'});
  assert.equal(reclassActionGate('manager_table_management',{}),null);
});
