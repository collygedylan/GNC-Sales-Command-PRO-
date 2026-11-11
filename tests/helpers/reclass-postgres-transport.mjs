import assert from 'node:assert/strict';
import {handleInventoryReclassMove} from '../../supabase/functions/app-api/reclass-action-access.ts';

const actorId='00000000-0000-0000-0000-000000000076';
const literal=value=>value===null?'NULL':typeof value==='object'?"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb":
  typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
function createTransport(database,sql,calls){
  const execute=statement=>sql(database,"SET request.jwt.claim.role='service_role';"+statement);
  return{rpc:async(name,args)=>{
    assert.ok(['authorize_reclass_command_v3076','apply_inventory_reclass_moves_with_delivery_v1',
      'get_inventory_reclass_move_status_v1'].includes(name));calls.push(name);
    const params=Object.entries(args).map(([key,value])=>key+'=>'+literal(value)).join(',');
    return{data:JSON.parse(execute('SELECT coalesce(to_jsonb(public.'+name+'('+params+')),\'null\'::jsonb);')),error:null};},
    from:table=>{assert.equal(table,'ph_master_inventory','the Reclass move cannot reach the old named row guard');
      return{select:columns=>({in:async(column,values)=>{
        assert.match(columns,/^[a-z_,]+$/);assert.equal(column,'unique_id');
        const statement='SELECT coalesce(jsonb_agg(r),\'[]\'::jsonb) FROM (SELECT '+columns+
          ' FROM public.ph_master_inventory WHERE unique_id IN ('+values.map(literal).join(',')+')) r;';
        return{data:JSON.parse(execute(statement)),error:null};}})};}};
}
function seed(database,sql){
  sql(database,"BEGIN;SET LOCAL session_replication_role=replica;"+
    "UPDATE public.user_access SET role='ADMIN',edit_any_row='N',edit_assigned_rows_only='N',submit_reclass='N' WHERE profile_id='"+actorId+"';"+
    "UPDATE public.profiles SET role='REP' WHERE id='"+actorId+"';UPDATE public.ph_app_users SET role='ADMIN' WHERE id=3076;"+
    "UPDATE public.user_access_control SET permission_overrides='{}' WHERE profile_id='"+actorId+"';"+
    "INSERT INTO public.ph_master_inventory(unique_id,itemcode,contsize,source,locationcode,lotcode,season,saleyear,ptronhand,ptravailable,ptrreviewed,s_lts) VALUES "+
    "('edge-y-a','EDGE','#3','PH','A.10','Y','Y','2027','50','50','0','50'),"+
    "('edge-y-b','EDGE','#3','PH','A.11','27.Y','Y','2027','50','50','0','50'),"+
    "('edge-y-c','EDGE','#3','PH','A.12','27.Y','Y','2027','50','50','0','50');COMMIT;");
}
function command(database,sql,ids,key){
  const rows=JSON.parse(sql(database,'SELECT jsonb_agg(r) FROM (SELECT unique_id,itemcode,contsize,locationcode,lotcode,season,ptronhand,ptravailable '+
    'FROM public.ph_master_inventory WHERE unique_id IN ('+ids.map(literal).join(',')+')) r;'));
  return{action:'inventory_reclass_move',commandId:key,moves:rows.map(row=>({source:{uniqueId:row.unique_id,identity:row},
    lines:[{direction:'move_up',destinationSeason:'F1',quantity:2}]}))};
}
export async function exerciseReclassPostgresTransport(database,sql){
  seed(database,sql);const calls=[];const supabase=createTransport(database,sql,calls);
  const actorProfile={id:actorId,username:'fixture_admin',role:'REP',must_change_password:false,disabled_at:null,locked_until:null};
  for(const [ids,key] of [[['edge-y-a'],'test:edge-y-single-3076'],[['edge-y-b','edge-y-c'],'test:edge-y-batch-3076']]){
    const payload=command(database,sql,ids,key);
    const first=await handleInventoryReclassMove({supabase,actorProfile,payload});
    const replay=await handleInventoryReclassMove({supabase,actorProfile,payload});
    assert.equal(first.status,'applied');assert.equal(replay.duplicate,true);assert.equal(replay.requestId,first.requestId);
    const state=await handleInventoryReclassMove({supabase,actorProfile,payload:{action:payload.action,operation:'status',commandId:key}});
    assert.equal(state.status,'applied');assert.equal(state.requestId,first.requestId);
  }
  assert.equal(sql(database,"SELECT sum(ptronhand::numeric) FROM public.ph_master_inventory WHERE unique_id IN ('edge-y-a','edge-y-b','edge-y-c');"),'144');
  assert.equal(calls.filter(name=>name==='apply_inventory_reclass_moves_with_delivery_v1').length,4);
  assert.equal(calls.filter(name=>name==='authorize_reclass_command_v3076').length,6);
}
