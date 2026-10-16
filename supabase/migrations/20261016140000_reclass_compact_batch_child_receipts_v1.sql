begin;

create or replace function private.replay_inventory_reclass_batch_child_v1(p_child_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  child_row private.ph_inventory_reclass_commands_v1%rowtype;
  batch_row private.ph_inventory_reclass_batch_receipts_v1%rowtype;
  source_index integer;
  source_uid text;
  parent_request_id uuid;
  rows_value jsonb;
  movements_value jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN';
  end if;
  select * into child_row from private.ph_inventory_reclass_commands_v1 c where c.request_id=p_child_request_id;
  if not found or child_row.result->>'_batchResultReference' is distinct from 'true'
     or child_row.result - array['_batchResultReference','batchRequestId','sourceIndex']<>'{}'::jsonb then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_CHILD_RECEIPT_INVALID';
  end if;
  begin parent_request_id:=(child_row.result->>'batchRequestId')::uuid; source_index:=(child_row.result->>'sourceIndex')::integer;
  exception when others then raise exception using errcode='55000',message='INVENTORY_RECLASS_CHILD_RECEIPT_INVALID'; end;
  if parent_request_id is null or source_index is null or source_index<1 then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_CHILD_RECEIPT_INVALID';
  end if;
  select * into batch_row from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.request_id=parent_request_id;
  if not found or batch_row.result->>'status' is distinct from 'applied' then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_PARENT_RECEIPT_MISSING';
  end if;
  if batch_row.child_request_ids[source_index] is distinct from p_child_request_id then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_CHILD_RECEIPT_INVALID';
  end if;
  source_uid:=child_row.request->>'sourceUid';
  if source_index is null or source_uid is null or jsonb_typeof(batch_row.result->'rows') is distinct from 'array'
     or jsonb_typeof(batch_row.result->'movements') is distinct from 'array' then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_PARENT_RECEIPT_INVALID';
  end if;
  if not exists(select 1 from jsonb_array_elements(batch_row.result->'movements') movement(value)
      where (movement.value->>'sourceIndex')::integer=source_index
        and movement.value->>'sourceUniqueId'=source_uid)
     or not exists(select 1 from jsonb_array_elements(batch_row.result->'rows') row_value(value)
      where row_value.value#>>'{row,unique_id}'=source_uid) then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_CHILD_RECEIPT_INVALID';
  end if;
  select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb) into rows_value
  from jsonb_array_elements(batch_row.result->'rows') with ordinality e(value,ordinality)
  where e.value#>>'{row,unique_id}'=source_uid
    or e.value#>>'{row,unique_id}' in (
      select movement.value->>'destinationUniqueId'
      from jsonb_array_elements(batch_row.result->'movements') movement(value)
      where (movement.value->>'sourceIndex')::integer=source_index);
  select coalesce(jsonb_agg(e.value-'sourceIndex' order by e.ordinality),'[]'::jsonb) into movements_value
  from jsonb_array_elements(batch_row.result->'movements') with ordinality e(value,ordinality)
  where (e.value->>'sourceIndex')::integer=source_index;
  if jsonb_array_length(rows_value)<2 or jsonb_array_length(movements_value)<1 then
    raise exception using errcode='55000',message='INVENTORY_RECLASS_CHILD_RECEIPT_INCOMPLETE';
  end if;
  return jsonb_build_object('ok',true,'commandId',child_row.command_id,'requestId',child_row.request_id,
    'revision',batch_row.result->'revision','rows',rows_value,'movements',movements_value,
    'status','applied','importStatus',coalesce(batch_row.result->>'importStatus','pending'));
end
$function$;
revoke all on function private.replay_inventory_reclass_batch_child_v1(uuid) from public,anon,authenticated,service_role;

-- Keep the public single-command replay contract unchanged while resolving
-- batch child receipts from the durable parent result.
do $migration$
declare
  definition text;
  old_marker text:=E'    return command_row.result;';
  new_marker text:=E'    if command_row.result->>''_batchResultReference'' = ''true'' then\n      return private.replay_inventory_reclass_batch_child_v1(command_row.request_id);\n    end if;\n    return command_row.result;';
  new_marker_count integer;
begin
  definition:=replace(pg_get_functiondef(
    'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure),E'\r\n',E'\n');
  new_marker_count:=(length(definition)-length(replace(definition,new_marker,'')))/length(new_marker);
  if new_marker_count=1 then return; end if;
  if new_marker_count>0 then raise exception 'RECLASS_COMPACT_CHILD_REPLAY_DUPLICATE_MARKER'; end if;
  if (length(definition)-length(replace(definition,old_marker,'')))/length(old_marker)<>1 then
    raise exception 'RECLASS_COMPACT_CHILD_REPLAY_SOURCE_MISMATCH';
  end if;
  execute replace(definition,old_marker,new_marker);
end
$migration$;

-- The public batch receipt remains the complete client response. Each private
-- child record now points back to it instead of writing duplicate row JSON.
do $migration$
declare
  definition text;
  start_marker text:='  with row_values as (';
  end_marker text:='  update private.ph_inventory_reclass_batch_receipts_v1 set child_request_ids=';
  replacement text:=E'  update private.ph_inventory_reclass_commands_v1 c set result=jsonb_build_object(''_batchResultReference'',true,''batchRequestId'',p_batch_request_id,''sourceIndex'',s.source_index)\n  from pg_temp.reclass_batch_sources_v1 s where c.request_id=s.child_request_id;\n';
  start_position integer;
  end_position integer;
begin
  definition:=replace(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure),E'\r\n',E'\n');
  if position('_batchResultReference' in definition)>0
     and position('batchRequestId' in definition)>0
     and position('sourceIndex' in definition)>0
     and position('with row_values as (' in definition)=0 then return; end if;
  if (length(definition)-length(replace(definition,start_marker,'')))/length(start_marker)<>1
     or (length(definition)-length(replace(definition,end_marker,'')))/length(end_marker)<>1 then
    raise exception 'RECLASS_COMPACT_CHILD_RESULT_SOURCE_MISMATCH';
  end if;
  start_position:=position(start_marker in definition);
  end_position:=position(end_marker in substring(definition from start_position));
  if end_position<=0 then raise exception 'RECLASS_COMPACT_CHILD_RESULT_SOURCE_MISMATCH'; end if;
  definition:=substring(definition from 1 for start_position-1)||replacement
    ||substring(definition from start_position+end_position-1);
  execute definition;
end
$migration$;

commit;
