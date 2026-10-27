begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '10s';

-- Freeze report rows before mutation. Test commands retain the normal atomic
-- inventory receipt but cannot enqueue an email event.
do $migration$
declare
  target regprocedure := 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure;
  definition text := pg_get_functiondef(target);
  declare_anchor text := '  applied_rows jsonb;';
  declare_replacement text := E'  applied_rows jsonb;\n  report_rows jsonb;\n  row_overlays jsonb;\n  report_stamps jsonb;\n  reclass_payload jsonb;\n  report_source jsonb;\n  request_actions jsonb;\n  is_test_command boolean := coalesce(p_command_id like ''test:%'',false);';
  start_anchor text := '  -- Match the movement RPC''s actor/command lock so receipt lookup, movement,';
  test_guard text := $guard$  if is_test_command then
    select * into actor_profile from public.profiles p where p.id=p_actor_id and p.disabled_at is null
      and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password;
    if actor_profile.id is null or private.normalized_profile_role(actor_profile.role) not in ('ADMIN','ADMINISTRATOR') then
      raise exception using errcode='42501',message='INVENTORY_RECLASS_TEST_ADMIN_REQUIRED';
    end if;
  end if;

$guard$;
  after_lock_anchor text := '  perform set_config(''gnc.inventory_edit_actor'',p_actor_id::text,true);';
  snapshot_code text := $snapshot$  -- v2380_pre_edit_report_rows: captured from physical ERP rows before any mutation.
  if not existing_command then
    perform 1 from public.ph_master_inventory m
      where upper(btrim(m.itemcode)) in (
        select upper(btrim(coalesce(move->'source'->'identity'->>'itemcode',move->'source'->>'itemcode')))
        from jsonb_array_elements(p_moves) move
      ) order by m.unique_id for update;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.locationcode,m.lotcode,m.unique_id),'[]'::jsonb)
      into report_rows
    from public.ph_master_inventory m
    where upper(btrim(m.itemcode)) in (
      select upper(btrim(coalesce(move->'source'->'identity'->>'itemcode',move->'source'->>'itemcode')))
      from jsonb_array_elements(p_moves) move
    )
      and coalesce(m.concat,'') not like 'reclass-move:%'
      and not exists (
        select 1 from private.ph_inventory_reclass_movements_v1 prior_move
        where prior_move.destination_unique_id=m.unique_id and prior_move.destination_before is null
      );
  end if;
$snapshot$;
  result_anchor text := '  if coalesce(result_value->>''status'', '''') <> ''applied'' then';
  suppress_code text := $suppress$  if is_test_command then
    return result_value || jsonb_build_object('duplicate',false,'emailQueued',false,
      'testDeliverySuppressed',true,'reportRows',report_rows);
  end if;

$suppress$;
  v7_payload_code text := $v7$  select
    coalesce(jsonb_agg(jsonb_build_object(
      'unique_id',row_value->>'unique_id',
      'expected',jsonb_build_object('itemcode',row_value->>'itemcode','lotcode',row_value->>'lotcode',
        'locationcode',row_value->>'locationcode','ptronhand',row_value->>'ptronhand',
        'priority',row_value->>'priority','ptravailable',row_value->>'ptravailable','desigitem',row_value->>'desigitem'),
      'proposals',coalesce((select jsonb_agg(jsonb_build_object('action',move_group.direction,
        'splits',move_group.splits,'applyHold',false,'holdReason','') order by move_group.direction)
        from (select move->>'direction' direction,
          jsonb_agg(jsonb_build_object('quantity',move->>'quantity','destinationSeason',move->>'destinationSeason')
            order by move->>'destinationSeason') splits
          from jsonb_array_elements(moves_value) move
          where move #>> '{source,unique_id}'=row_value->>'unique_id'
          group by move->>'direction') move_group),'[]'::jsonb)
    ) || case when synthetic.note is null then '{}'::jsonb else jsonb_build_object(
      'temporaryValues',jsonb_build_object('locationnote',concat_ws(E'\n',nullif(btrim(row_value->>'locationnote'),''),synthetic.note)),
      'temporaryChangedFields','["locationnote"]'::jsonb) end
      order by row_value->>'locationcode',row_value->>'lotcode',row_value->>'unique_id'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('unique_id',row_value->>'unique_id','stamps',jsonb_build_object(
      'prisetby',row_value->'prisetby','priupdated',row_value->'priupdated',
      'locationnotedate',row_value->'locationnotedate','evaldate',row_value->'evaldate'))
      order by row_value->>'locationcode',row_value->>'lotcode',row_value->>'unique_id'),'[]'::jsonb)
    into row_overlays,report_stamps from jsonb_array_elements(report_rows) row_value
    left join lateral (
      select string_agg(case when movement->>'direction'='move_down' then 'DOWN ' else 'UP ' end
        ||coalesce(movement->>'quantity','')||' FROM '||coalesce(movement #>> '{source,lotcode}','')
        ||' TO '||coalesce(movement #>> '{destination,season}','')||' (AgData-created lot at '
        ||coalesce(movement #>> '{source,locationcode}','')||')','; ' order by movement->>'direction') note
      from jsonb_array_elements(moves_value) movement
      where movement #>> '{source,unique_id}'<>row_value->>'unique_id'
        and exists (
          with recursive ancestry(unique_id,depth,path) as (
            select movement #>> '{source,unique_id}',0,array[movement #>> '{source,unique_id}']
            union all
            select prior_move.source_unique_id::text,ancestry.depth+1,ancestry.path||prior_move.source_unique_id::text
            from ancestry join private.ph_inventory_reclass_movements_v1 prior_move
              on prior_move.destination_unique_id::text=ancestry.unique_id and prior_move.destination_before is null
            where ancestry.depth<32 and not prior_move.source_unique_id::text=any(ancestry.path)
          ) select 1 from ancestry where ancestry.unique_id=row_value->>'unique_id'
        )
    ) synthetic on true;
  select coalesce(jsonb_agg(to_jsonb(direction) order by direction),'[]'::jsonb) into request_actions
    from (select distinct move->>'direction' direction from jsonb_array_elements(moves_value) move
      where exists(select 1 from jsonb_array_elements(report_rows) row_value
        where row_value->>'unique_id'=move #>> '{source,unique_id}')) actions;
  with recursive ancestry(unique_id,depth,path) as (
    select moves_value #>> '{0,source,unique_id}',0,array[moves_value #>> '{0,source,unique_id}']
    union all
    select prior_move.source_unique_id::text,ancestry.depth+1,ancestry.path||prior_move.source_unique_id::text
    from ancestry join private.ph_inventory_reclass_movements_v1 prior_move
      on prior_move.destination_unique_id::text=ancestry.unique_id and prior_move.destination_before is null
    where ancestry.depth<32 and not prior_move.source_unique_id::text=any(ancestry.path)
  )
  select row_value into report_source from ancestry join lateral jsonb_array_elements(report_rows) row_value
    on row_value->>'unique_id'=ancestry.unique_id order by ancestry.depth desc limit 1;
  if report_source is null then
    select row_value into report_source from jsonb_array_elements(report_rows) row_value
      where upper(btrim(row_value->>'itemcode'))=upper(btrim(moves_value #>> '{0,source,itemcode}'))
      order by row_value->>'locationcode',row_value->>'lotcode',row_value->>'unique_id' limit 1;
  end if;
  if report_source is null or jsonb_array_length(row_overlays)<>jsonb_array_length(report_rows)
    or jsonb_array_length(report_stamps)<>jsonb_array_length(report_rows) then
    raise exception using errcode='P0001',message='INVENTORY_RECLASS_V7_REPORT_SNAPSHOT_INVALID';
  end if;
  reclass_payload:=jsonb_build_object(
    'actor',jsonb_build_object('username',actor_username,'displayName',coalesce(nullif(btrim(actor_profile.display_name),''),actor_username)),
    'actorUsername',actor_username,'actorDisplayName',coalesce(nullif(btrim(actor_profile.display_name),''),actor_username),
    'actorEmail',actor_email,'source',jsonb_build_object('unique_id',report_source->>'unique_id',
      'itemcode',report_source->>'itemcode','contsize',report_source->>'contsize',
      'locationcode',report_source->>'locationcode','lotcode',report_source->>'lotcode',
      'season',report_source->>'season','ptronhand',report_source->>'ptronhand',
      'ptravailable',report_source->>'ptravailable','desigitem',report_source->>'desigitem'),
    'workflowPolicyVersion','reclass-action-workflow-v7-editable-fields-20261009',
    'sourceContext',jsonb_build_object('sourceMode','drive'),
    'transaction',jsonb_build_object('requestActions',request_actions,'holdStopProposals','[]'::jsonb,'scope','{}'::jsonb),
    'rowOverlays',row_overlays,'recipientEmails',to_jsonb(recipient_emails),
    'protectedDelivery',jsonb_build_object('contractVersion','drive-reclass-protected-v1',
      'requestFingerprint',encode(extensions.digest(convert_to(p_actor_id::text||':'||p_command_id,'UTF8'),'sha256'),'hex'),
      'v7FrozenRows',report_rows,'liveEdits','[]'::jsonb,'inventoryFields','[]'::jsonb,
      'inventoryRevision',result_value->>'revision','v7Scope',jsonb_build_object('sourceMode','drive',
        'reportStamps',report_stamps,'itemcode',upper(btrim(report_source->>'itemcode'))))
  );
$v7$;
  payload_anchor text := '''moves'',moves_value,''appliedRows'',applied_rows,''deliveryRecipients'',to_jsonb(recipient_emails)';
  payload_replacement text := '''commandId'',p_command_id,''requestId'',move_request_id,''actorProfileId'',p_actor_id,''actorUsername'',actor_username,''actorEmail'',actor_email,''actorDisplayName'',coalesce(nullif(btrim(actor_profile.display_name),''''),actor_username),''reclassPayload'',reclass_payload,''moves'',moves_value,''appliedRows'',applied_rows,''report_rows'',report_rows,''deliveryRecipients'',to_jsonb(recipient_emails)';
  moves_anchor text := 'if jsonb_array_length(moves_value) < 1 then raise exception using errcode = ''P0001'', message = ''INVENTORY_RECLASS_MOVE_RECEIPT_MISSING''; end if;';
  event_type_anchor text := '''inventory_reclass_move_completed''';
  duplicate_anchor text := 'return result_value || jsonb_build_object(''duplicate'', true, ''emailQueued'', event_row.event_id is not null,';
  duplicate_replacement text := 'return result_value || jsonb_build_object(''duplicate'', true, ''emailQueued'', case when is_test_command then false else event_row.event_id is not null end,';
begin
  if position('v2380_pre_edit_report_rows' in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,declare_anchor,'')))/length(declare_anchor)<>1
    or (length(definition)-length(replace(definition,start_anchor,'')))/length(start_anchor)<>1
    or (length(definition)-length(replace(definition,after_lock_anchor,'')))/length(after_lock_anchor)<>1
    or (length(definition)-length(replace(definition,result_anchor,'')))/length(result_anchor)<>1
    or (length(definition)-length(replace(definition,payload_anchor,'')))/length(payload_anchor)<>1
    or (length(definition)-length(replace(definition,duplicate_anchor,'')))/length(duplicate_anchor)<>1
    or (length(definition)-length(replace(definition,moves_anchor,'')))/length(moves_anchor)<>1
    or (length(definition)-length(replace(definition,event_type_anchor,'')))/length(event_type_anchor)<>2 then
    raise exception 'AGDATA_V2380_DELIVERY_FUNCTION_ANCHOR_MISMATCH';
  end if;
  definition:=replace(definition,declare_anchor,declare_replacement);
  definition:=replace(definition,start_anchor,test_guard||start_anchor);
  definition:=replace(definition,after_lock_anchor,after_lock_anchor||E'\n'||snapshot_code);
  definition:=replace(definition,moves_anchor,'  '||moves_anchor||E'\n'||v7_payload_code);
  definition:=replace(definition,result_anchor,suppress_code||result_anchor);
  definition:=replace(definition,payload_anchor,payload_replacement);
  definition:=replace(definition,'''inventory_reclass_move_completed''','''reclass_inquiry''');
  definition:=replace(definition,duplicate_anchor,duplicate_replacement);
  definition:=replace(definition,'''deliveryEventId'', event_row.event_id);','''deliveryEventId'', event_row.event_id) || case when is_test_command then jsonb_build_object(''testDeliverySuppressed'',true) else ''{}''::jsonb end;');
  definition:=replace(definition,'$function$' || E'\n;',E'-- v2380_pre_edit_report_rows' || E'\n$function$' || E'\n;');
  execute definition;
end
$migration$;

notify pgrst,'reload schema';
commit;
