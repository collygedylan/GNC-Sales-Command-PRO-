begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

do $migration$
declare
  definition text := pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  anchor text := $old$   update public.ph_soc_master set suspend=null,suspend_to=null,date_completed=stamp where unique_id=uid;
   update suspend_tag_private.workflows set status='completed',current_approval_id=null,version=version+1,updated_at=stamp where source_uid=uid;
   result:=jsonb_build_object('ok',true,'completed',true,'unique_id',uid,'row',suspend_tag_private.row_json(uid));$old$;
  replacement text := $new$   -- suspend-close-exact-order-v3079: retain one payable SOC line and close only its linked candidates.
   chosen:=coalesce(nullif(s.suspend_origin_uid,''),uid);
   select q.* into strict r from public.ph_soc_master q
    where q.unique_id=chosen and suspend_tag_private.order_key(q)=suspend_tag_private.order_key(s)
    for update;
   if r.date_completed is not null and coalesce(r.suspend_candidate_state,'')<>'replaced' then
     raise exception 'SUSPEND_TAG_ALREADY_FINAL' using errcode='PT409';
   end if;
   if suspend_tag_private.is_false_block_v2378(s.locationcode) then
     raise exception 'SUSPEND_TAG_REAL_LOCATION_REQUIRED' using errcode='22023';
   end if;
   if uid<>chosen and (r.locationcode,coalesce(r.lotcode,'')) is distinct from (s.locationcode,coalesce(s.lotcode,'')) then
     select min(q.unique_id) into candidate_uid from public.ph_master_inventory q
       where q.itemcode=s.itemcode and q.locationcode=s.locationcode
         and coalesce(q.lotcode,'')=coalesce(s.lotcode,'') having count(*)=1;
     if candidate_uid is null then
       raise exception 'SUSPEND_TAG_INVENTORY_AMBIGUOUS' using errcode='22023';
     end if;
     result:=suspend_tag_private.group_command(p_actor_id,'replace_location',
       p_payload||jsonb_build_object('sourceUid',uid,'inventoryIds',jsonb_build_array(candidate_uid),'finalPull',true),
       md5(p_command_id::text||':complete-final-location')::uuid,p_expected_version);
     if not coalesce((result->>'finalPull')::boolean,false) then
       raise exception 'SUSPEND_TAG_FINAL_LOCATION_REQUIRED' using errcode='PT409';
     end if;
     result:=result||jsonb_build_object('unique_id',uid,'row',suspend_tag_private.row_json(uid));
   else
   select coalesce(array_agg(q.unique_id order by q.unique_id),'{}'::text[]) into ids
    from public.ph_soc_master q
    where (q.unique_id in (uid,chosen) or q.suspend_origin_uid=chosen)
      and suspend_tag_private.order_key(q)=suspend_tag_private.order_key(s);
   update suspend_tag_private.approvals set status='superseded' where status='pending' and id in (
     select wf.current_approval_id from suspend_tag_private.workflows wf where wf.source_uid=any(ids)
   );
   update public.ph_soc_master q set suspend=null,suspend_to=null,date_completed=stamp,last_updated=stamp,
      suspend_candidate_state=case when q.unique_id=chosen then 'approved' else 'replaced' end,
      quantityordered=case when q.unique_id=chosen then coalesce(r.suspend_order_quantity,r.quantityordered) else '0' end
    where q.unique_id=any(ids) and (q.unique_id in (uid,chosen) or q.date_completed is null);
   update suspend_tag_private.workflows set status='completed',current_approval_id=null,version=version+1,updated_at=stamp
    where source_uid in (select q.unique_id from public.ph_soc_master q where q.unique_id=any(ids) and q.date_completed=stamp);
   result:=jsonb_build_object('ok',true,'completed',true,'unique_id',uid,'row',suspend_tag_private.row_json(uid),
     'rows',(select jsonb_agg(suspend_tag_private.row_json(q.unique_id) order by q.unique_id)
       from public.ph_soc_master q where q.unique_id=any(ids) and q.date_completed=stamp));
   end if;$new$;
  group_receipt_anchor text := $old$ result:=result||jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]')
    from public.ph_soc_master r where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key));$old$;
begin
  if position('suspend-close-exact-order-v3079' in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'SUSPEND_CLOSE_ORDER_RECEIPT_ANCHOR_CHANGED';
  end if;
  if (length(definition)-length(replace(definition,group_receipt_anchor,'')))/length(group_receipt_anchor)<>1 then
    raise exception 'SUSPEND_CLOSE_GROUP_RECEIPT_ANCHOR_CHANGED';
  end if;
  execute replace(replace(definition,anchor,replacement),group_receipt_anchor,
    ' if p_operation<>''close'' then' || chr(10) || group_receipt_anchor || chr(10) || ' end if;');
end
$migration$;

commit;
