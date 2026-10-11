-- Hold/Stop and movement proposals are independent. Existing authorization,
-- expected-value checks, fanout boundaries and quantity validation remain intact.
begin;

create or replace function private.validate_reclass_smart_shield_v6(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  projected jsonb;
  v5_payload jsonb;
  hold_proposals jsonb;
  hold_proposal jsonb;
  row_overlay jsonb;
  proposal jsonb;
  source_uid text;
  action_names text[];
  has_priority boolean := false;
begin
  projected := private.project_reclass_smart_shield_v6(p_payload);
  hold_proposals := coalesce(projected #> '{transaction,holdStopProposals}','[]'::jsonb);
  select array_agg(value order by ordinality) into action_names
  from jsonb_array_elements_text(projected #> '{transaction,requestActions}') with ordinality a(value,ordinality);
  for hold_proposal in select value from jsonb_array_elements(hold_proposals) loop
    source_uid := btrim(coalesce(hold_proposal->>'sourceUid',''));
    if source_uid is null or source_uid = ''
       or not exists(select 1 from jsonb_array_elements(projected->'rowOverlays') r where r->>'unique_id' = source_uid) then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_HOLD_SOURCE_INVALID';
    end if;
  end loop;
  for row_overlay in select value from jsonb_array_elements(projected->'rowOverlays') loop
    for proposal in select value from jsonb_array_elements(coalesce(row_overlay->'proposals','[]'::jsonb)) loop
      if proposal->>'action' = 'priority_change' then
        has_priority := true;
        if jsonb_typeof(proposal->'priority') <> 'string'
           or (proposal->>'priority' <> '' and proposal->>'priority' !~ '^[1-9][0-9]?$') then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_PRIORITY_INVALID';
        end if;
      end if;
    end loop;
  end loop;
  if not has_priority and jsonb_array_length(hold_proposals) = 0 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_LIVE_ACTION_REQUIRED';
  end if;
  v5_payload := projected || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'transaction',(projected->'transaction') || jsonb_build_object('holdStopProposals',coalesce((
      select jsonb_agg(value - 'sourceUid') from jsonb_array_elements(hold_proposals)
    ),'[]'::jsonb)),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'expected') || jsonb_build_object('expected', (value->'expected') - 'priority' - 'holdstopcode' - 'holdstopreason')
      order by ordinality
    ),'[]'::jsonb) from jsonb_array_elements(projected->'rowOverlays') with ordinality a(value,ordinality))
  );
  perform private.validate_drive_reclass_sheared_v5(v5_payload);
  return projected;
end
$function$;

create or replace function private.apply_ph_master_inventory_live_edits_v6(p_edits jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  edit_row jsonb;
  target jsonb;
  expected jsonb;
  row_value public.ph_master_inventory;
  seen_ids text[] := '{}'::text[];
  result_rows jsonb := '[]'::jsonb;
  current_revision bigint;
  row_uid text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode = '42501', message = 'RECLASS_V6_LIVE_EDIT_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_edits,'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_edits) > 10000 then
    raise exception using errcode='22023',message='RECLASS_V6_LIVE_EDIT_LIMIT_EXCEEDED';
  end if;
  perform 1 from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory' and r.state = 'ready'
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  for edit_row in
    select value from jsonb_array_elements(p_edits)
    order by value->>'unique_id'
  loop
    if jsonb_typeof(edit_row) <> 'object'
       or (select count(*) from jsonb_object_keys(edit_row)) <> 3
       or not (edit_row ?& array['unique_id','expected','target'])
       or jsonb_typeof(edit_row->'expected') <> 'object'
       or jsonb_typeof(edit_row->'target') <> 'object'
       or exists(select 1 from jsonb_object_keys(edit_row->'expected') k
         where k not in ('priority','holdstopcode','holdstopreason'))
       or exists(select 1 from jsonb_object_keys(edit_row->'target') k
         where k not in ('priority','holdstopcode','holdstopreason'))
       or not ((edit_row->'expected') ?& array['priority','holdstopcode','holdstopreason'])
       or not ((edit_row->'target') ?& array['priority','holdstopcode','holdstopreason']) then
      raise exception using errcode = '22023', message = 'RECLASS_V6_LIVE_EDIT_SHAPE_INVALID';
    end if;
    row_uid := nullif(btrim(coalesce(edit_row->>'unique_id','')),'');
    if row_uid is null or row_uid = any(seen_ids) then
      raise exception using errcode = '22023', message = 'RECLASS_V6_LIVE_EDIT_ID_INVALID';
    end if;
    seen_ids := array_append(seen_ids,row_uid);
    expected := edit_row->'expected';
    target := edit_row->'target';
    if exists(select 1 from jsonb_each(expected) e where e.value <> 'null'::jsonb and jsonb_typeof(e.value) <> 'string')
       or exists(select 1 from jsonb_each(target) e where e.value <> 'null'::jsonb and jsonb_typeof(e.value) <> 'string') then
      raise exception using errcode = '22023', message = 'RECLASS_V6_LIVE_EDIT_VALUE_INVALID';
    end if;
    select m.* into row_value from public.ph_master_inventory m
    where m.unique_id = row_uid for update;
    if row_value.unique_id is null then
      raise exception using errcode = '40001', message = 'RECLASS_V6_LIVE_EDIT_ROW_MISSING';
    end if;
    if coalesce(row_value.priority,'') is distinct from coalesce(expected->>'priority','')
       or coalesce(row_value.holdstopcode,'') is distinct from coalesce(expected->>'holdstopcode','')
       or coalesce(row_value.holdstopreason,'') is distinct from coalesce(expected->>'holdstopreason','') then
      raise exception using errcode = '40001', message = 'RECLASS_V6_LIVE_EDIT_CONFLICT';
    end if;
    if coalesce(row_value.priority,'') is distinct from coalesce(target->>'priority','')
       or coalesce(row_value.holdstopcode,'') is distinct from coalesce(target->>'holdstopcode','')
       or coalesce(row_value.holdstopreason,'') is distinct from coalesce(target->>'holdstopreason','') then
      update public.ph_master_inventory m set
        priority = nullif(target->>'priority',''),
        holdstopcode = nullif(target->>'holdstopcode',''),
        holdstopreason = nullif(target->>'holdstopreason',''),
        holdstopbegindate = case
          when coalesce(row_value.holdstopcode,'') is distinct from coalesce(target->>'holdstopcode','') then
            case when nullif(target->>'holdstopcode','') is not null
              then to_char(clock_timestamp() at time zone 'America/Chicago','YYYY-MM-DD') else null end
          else m.holdstopbegindate end,
        last_updated = clock_timestamp()
      where m.unique_id = row_uid
      returning m.* into row_value;
    end if;
    result_rows := result_rows || jsonb_build_array(jsonb_build_object(
      'unique_id',row_value.unique_id,
      'priority',row_value.priority,
      'holdstopcode',row_value.holdstopcode,
      'holdstopreason',row_value.holdstopreason,
      'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
      'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,
      'last_updated',row_value.last_updated,
      'evidence',jsonb_build_object(
        'unique_id',row_value.unique_id,
        'itemcode',row_value.itemcode,
        'locationcode',row_value.locationcode,
        'lotcode',row_value.lotcode,
        'last_updated',row_value.last_updated,
        'photo_link',row_value.photo_link,
        'photo_name',row_value.photo_name,
        'match',row_value.match,
        'spec',row_value.spec,
        'caliper',row_value.caliper,
        'initial_ptr',row_value.initial_ptr,
        'loc_match_qty',row_value.loc_match_qty,
        'ptravailable',row_value.ptravailable,
        'av_note',row_value.av_note,
        'pic_note',row_value.pic_note,
        'sales_note',row_value.sales_note,
        'date_completed',row_value.date_completed,
        'app_tab_assignment',row_value.app_tab_assignment,
        'av_rule_av_note_updated_at',row_value.av_rule_av_note_updated_at,
        'av_rule_bundle_updated_at',row_value.av_rule_bundle_updated_at,
        'av_rule_caliper_updated_at',row_value.av_rule_caliper_updated_at,
        'av_rule_holdstop_snapshot',row_value.av_rule_holdstop_snapshot,
        'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
        'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,
        'av_rule_match_updated_at',row_value.av_rule_match_updated_at,
        'av_rule_photo_updated_at',row_value.av_rule_photo_updated_at,
        'av_rule_priority_snapshot',row_value.av_rule_priority_snapshot,
        'av_rule_spec_updated_at',row_value.av_rule_spec_updated_at
      )
    ));
  end loop;
  select r.revision into current_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory';
  if current_revision is null then
    raise exception using errcode = '55000', message = 'RECLASS_V6_INVENTORY_REVISION_MISSING';
  end if;
  return jsonb_build_object('liveEdits',result_rows,'inventoryRevision',current_revision::text);
end
$function$;

revoke all on function private.validate_reclass_smart_shield_v6(jsonb) from public, anon, authenticated;
revoke all on function private.apply_ph_master_inventory_live_edits_v6(jsonb) from public, anon, authenticated;
grant execute on function private.validate_reclass_smart_shield_v6(jsonb) to service_role;
grant execute on function private.apply_ph_master_inventory_live_edits_v6(jsonb) to service_role;
commit;
