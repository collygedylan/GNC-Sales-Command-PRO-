begin;

-- A H/S removal that only drops existing blocking tokens is a release, not
-- a new invalidation. Treat the H and S flags independently so HS -> S and
-- HS -> blank preserve evidence, while H -> S remains a new blocking state.
create or replace function private.ph_holdstop_strict_reduction_v1(p_old text, p_new text)
returns boolean
language sql immutable security definer set search_path = ''
as $function$
  with flags as (
    select upper(coalesce(p_old,'')) ~ '[H]' old_h,
      upper(coalesce(p_old,'')) ~ '[S]' old_s,
      upper(coalesce(p_new,'')) ~ '[H]' new_h,
      upper(coalesce(p_new,'')) ~ '[S]' new_s
  )
  select (old_h or old_s)
    and not (new_h and not old_h)
    and not (new_s and not old_s)
    and (old_h is distinct from new_h or old_s is distinct from new_s)
  from flags
$function$;
revoke all on function private.ph_holdstop_strict_reduction_v1(text,text) from public, anon, authenticated, service_role;

create or replace function public.check_inventory_changes_and_reset()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'private', 'vault', 'pg_temp'
as $function$
declare
  needs_reset boolean := false;
  old_has_h boolean;
  old_has_s boolean;
  new_has_h boolean;
  new_has_s boolean;
  hold_reduced boolean;
begin
  old_has_h := upper(coalesce(old.holdstopcode,'')) ~ '[H]';
  old_has_s := upper(coalesce(old.holdstopcode,'')) ~ '[S]';
  new_has_h := upper(coalesce(new.holdstopcode,'')) ~ '[H]';
  new_has_s := upper(coalesce(new.holdstopcode,'')) ~ '[S]';
  hold_reduced := private.ph_holdstop_strict_reduction_v1(old.holdstopcode,new.holdstopcode);

  -- A strict release wins over a priority change in the same update. A pure
  -- priority change and any newly added H/S token still invalidate evidence.
  if not hold_reduced and old.priority is distinct from new.priority then
    needs_reset := true;
  end if;
  if not hold_reduced and (
    (new_has_h and not old_has_h)
    or (new_has_s and not old_has_s)
    or ((old_has_h or old_has_s) and not (new_has_h or new_has_s))
  ) then
    needs_reset := true;
  end if;

  if needs_reset then
    new.av_note := null;
    new.spec := null;
    new.caliper := null;
    new.photo_link := null;
    new.photo_name := null;
    new.match := null;
    new.loc_match_qty := null;
    new.initial_ptr := null;
    new.date_completed := null;
  end if;
  return new;
end
$function$;
alter function public.check_inventory_changes_and_reset() owner to postgres;

-- Keep the existing clear-marker reason/timestamp contract while suppressing
-- its automatic priority/hold marker for a strict H/S reduction. An explicit
-- marker change still advances its timestamp and remains authoritative.
create or replace function private.stamp_season_sales_av_reset_v1()
returns trigger
language plpgsql set search_path = ''
as $function$
begin
  if not private.ph_holdstop_strict_reduction_v1(old.holdstopcode,new.holdstopcode) then
    if old.priority is distinct from new.priority then
      new.av_rule_last_clear_reason := 'priority_changed';
      new.av_rule_last_cleared_at := clock_timestamp();
    elsif (upper(coalesce(new.holdstopcode, '')) ~ '[H]'
           and not (upper(coalesce(old.holdstopcode, '')) ~ '[H]'))
          or (upper(coalesce(new.holdstopcode, '')) ~ '[S]'
              and not (upper(coalesce(old.holdstopcode, '')) ~ '[S]'))
          or ((upper(coalesce(old.holdstopcode, '')) ~ '[HS]')
              is distinct from (upper(coalesce(new.holdstopcode, '')) ~ '[HS]')) then
      new.av_rule_last_clear_reason := 'hold_stop_changed';
      new.av_rule_last_cleared_at := clock_timestamp();
    end if;
  end if;
  if new.av_rule_last_cleared_at is not null
     and new.av_rule_last_cleared_at is distinct from old.av_rule_last_cleared_at
     and nullif(btrim(new.av_note), '') is null
     and nullif(btrim(new.spec), '') is null
     and nullif(btrim(new.photo_link), '') is null
     and nullif(btrim(new.photo_name), '') is null then
    new.av_rule_last_cleared_at := clock_timestamp();
  end if;
  return new;
end
$function$;
alter function private.stamp_season_sales_av_reset_v1() owner to postgres;
revoke all on function private.stamp_season_sales_av_reset_v1() from public, anon, authenticated, service_role;

create or replace function private.sync_season_sales_av_note_reset_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if new.av_rule_last_cleared_at is not null
     and (
       new.av_rule_last_cleared_at is distinct from old.av_rule_last_cleared_at
       or (
         not private.ph_holdstop_strict_reduction_v1(old.holdstopcode,new.holdstopcode)
         and (
           new.priority is distinct from old.priority
           or (upper(coalesce(new.holdstopcode, '')) ~ '[H]'
               and not (upper(coalesce(old.holdstopcode, '')) ~ '[H]'))
           or (upper(coalesce(new.holdstopcode, '')) ~ '[S]'
               and not (upper(coalesce(old.holdstopcode, '')) ~ '[S]'))
           or ((upper(coalesce(old.holdstopcode, '')) ~ '[HS]')
               is distinct from (upper(coalesce(new.holdstopcode, '')) ~ '[HS]'))
         )
       )
     )
     and nullif(btrim(new.av_note), '') is null
     and nullif(btrim(new.spec), '') is null
     and nullif(btrim(new.photo_link), '') is null
     and nullif(btrim(new.photo_name), '') is null then
    if pg_try_advisory_xact_lock(hashtextextended('season-sales-office-v1', 0)) then
      perform private.clear_season_sales_av_note_for_reset_v1(new);
    end if;
  end if;
  return new;
end
$function$;
alter function private.sync_season_sales_av_note_reset_v1() owner to postgres;
revoke all on function private.sync_season_sales_av_note_reset_v1() from public, anon, authenticated, service_role;


create or replace function private.project_reclass_editable_fields_v7(p_payload jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  row_value jsonb;
  edit_value jsonb;
  row_edits jsonb;
  row_result jsonb;
  result_rows jsonb := '[]'::jsonb;
  actions text[];
  action_value jsonb;
  source_mode text;
  field_name text;
  seen_fields text[];
  has_fields boolean := false;
  v6_payload jsonb;
  v5_payload jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload->>'workflowPolicyVersion' <> 'reclass-action-workflow-v7-editable-fields-20261009'
     or jsonb_typeof(p_payload->'source') is distinct from 'object'
     or jsonb_typeof(p_payload->'transaction') is distinct from 'object'
     or jsonb_typeof(p_payload->'rowOverlays') is distinct from 'array'
     or jsonb_array_length(p_payload->'rowOverlays') not between 1 and 500 then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SHAPE_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_payload #> '{transaction,requestActions}','null'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_payload #> '{transaction,holdStopProposals}','null'::jsonb)) is distinct from 'array' then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ACTIONS_INVALID';
  end if;
  if p_payload ? 'sourceContext' and jsonb_typeof(p_payload->'sourceContext') is distinct from 'object' then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_CONTEXT_INVALID';
  end if;
  source_mode:=lower(btrim(coalesce(p_payload #>> '{sourceContext,sourceMode}','drive')));
  if source_mode not in ('drive','item-inquiry','eval-report-2','eval-work') then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_MODE_INVALID';
  end if;
  if exists(select 1 from jsonb_object_keys(coalesce(p_payload->'sourceContext','{}'::jsonb)) k
    where k not in ('sourceMode','reportId','itemcode')) then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_CONTEXT_INVALID';
  end if;
  if source_mode<>'eval-report-2' and exists(select 1 from jsonb_object_keys(coalesce(p_payload->'sourceContext','{}'::jsonb)) k where k<>'sourceMode') then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_CONTEXT_INVALID';
  end if;
  if source_mode='eval-report-2' and (
    (select count(*) from jsonb_object_keys(coalesce(p_payload->'sourceContext','{}'::jsonb)))<>3
    or nullif(btrim(coalesce(p_payload #>> '{sourceContext,reportId}','')),'') is null
    or nullif(btrim(coalesce(p_payload #>> '{sourceContext,itemcode}','')),'') is null
  ) then raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_CONTEXT_INVALID'; end if;
  for action_value in select value from jsonb_array_elements(p_payload #> '{transaction,requestActions}') loop
    if jsonb_typeof(action_value) is distinct from 'string' then raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ACTIONS_INVALID'; end if;
  end loop;
  select coalesce(array_agg(value order by ordinality),'{}'::text[]) into actions
  from jsonb_array_elements_text(p_payload #> '{transaction,requestActions}') with ordinality a(value,ordinality);
  if cardinality(actions) <> (select count(distinct value) from unnest(actions) a(value))
     or exists(select 1 from unnest(actions) a(value) where value not in (
       'hold','take_off_hold','stop_ship','off_stop_ship','recount','priority_change','move_up','move_down','sheared','inventory_fields'
     )) then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ACTIONS_INVALID';
  end if;
  for row_value in select value from jsonb_array_elements(p_payload->'rowOverlays') loop
    if jsonb_typeof(row_value) is distinct from 'object'
       or nullif(btrim(coalesce(row_value->>'unique_id','')),'') is null
       or jsonb_typeof(coalesce(row_value->'fieldEdits','[]'::jsonb)) is distinct from 'array'
       or jsonb_array_length(coalesce(row_value->'fieldEdits','[]'::jsonb))>9 then
      raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ROW_INVALID';
    end if;
    if exists(select 1 from jsonb_object_keys(row_value) k
      where k not in ('unique_id','expected','proposals','temporaryValues','temporaryChangedFields','resolution','fieldEdits')) then
      raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ROW_INVALID';
    end if;
    row_edits := coalesce(row_value->'fieldEdits','[]'::jsonb);
    seen_fields := '{}'::text[];
    for edit_value in select value from jsonb_array_elements(row_edits) loop
      field_name := edit_value->>'field';
      if jsonb_typeof(edit_value) is distinct from 'object'
         or field_name is null or field_name not in ('locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility','oversellpercentage','salesnote','suspend')
         or field_name=any(seen_fields)
         or not (edit_value ? 'expected')
         or jsonb_typeof(edit_value->'expected') is distinct from 'string' and jsonb_typeof(edit_value->'expected') is distinct from 'null'
         or length(coalesce(edit_value->>'expected',''))>4000 then
        raise exception using errcode='22023',message='DRIVE_RECLASS_V7_FIELD_INVALID';
      end if;
      seen_fields := array_append(seen_fields,field_name);
      if field_name='suspend' then
        if (select count(*) from jsonb_object_keys(edit_value))<>3
           or not (edit_value ?& array['field','expected','decision'])
           or coalesce(edit_value->>'decision','') not in ('yes','no') then
          raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SUSPEND_INVALID';
        end if;
      elsif (select count(*) from jsonb_object_keys(edit_value))<>3
         or not (edit_value ?& array['field','expected','value'])
         or not (edit_value ? 'value')
         or jsonb_typeof(edit_value->'value') is distinct from 'string' and jsonb_typeof(edit_value->'value') is distinct from 'null'
         or length(coalesce(edit_value->>'value',''))>4000 then
        raise exception using errcode='22023',message='DRIVE_RECLASS_V7_FIELD_INVALID';
      end if;
      has_fields := true;
    end loop;
    if exists(select 1 from jsonb_array_elements(coalesce(row_value->'proposals','[]'::jsonb)) p
      where p->>'action'='sheared') and 'desigitem'=any(seen_fields) then
      raise exception using errcode='22023',message='DRIVE_RECLASS_V7_DESIGNATION_PROPOSAL_CONFLICT';
    end if;
    row_result := row_value - 'fieldEdits' || jsonb_build_object('fieldEdits',row_edits);
    result_rows := result_rows || jsonb_build_array(row_result);
  end loop;
  if has_fields <> ('inventory_fields'=any(actions)) then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ACTIONS_INVALID';
  end if;
  if cardinality(actions)=0 and not has_fields then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ACTION_REQUIRED';
  end if;
  if (select count(distinct value->>'unique_id') from jsonb_array_elements(result_rows) a(value))
       <> jsonb_array_length(result_rows) then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ROW_DUPLICATE';
  end if;
  -- V6/V5 keep validating their established movement/priority/hold contracts.
  -- Their projections receive only fields they understand.
  v6_payload := (p_payload - 'sourceContext') || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v6-smart-shield-20261009',
    'transaction',(p_payload->'transaction') || jsonb_build_object(
      'requestActions',to_jsonb(array_remove(actions,'inventory_fields'))),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'fieldEdits') || jsonb_build_object('expected',
        (value->'expected') - 'locationnote' - 'locationptn1' - 'desigcust' - 'desigloc'
          - 'pullerresponsibility' - 'oversellpercentage' - 'salesnote' - 'suspend')
      order by ordinality),'[]'::jsonb)
      from jsonb_array_elements(result_rows) with ordinality a(value,ordinality))
  );
  v5_payload := v6_payload || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'transaction',(v6_payload->'transaction') || jsonb_build_object(
      'requestActions',to_jsonb(array_remove(array_remove(actions,'inventory_fields'),'priority_change')),
      'holdStopProposals','[]'::jsonb),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'expected') || jsonb_build_object('expected',(value->'expected') - 'priority' - 'holdstopcode' - 'holdstopreason')
      order by ordinality),'[]'::jsonb)
      from jsonb_array_elements(v6_payload->'rowOverlays') with ordinality a(value,ordinality))
  );
  -- A field-only inquiry is checked against locked rows by the V7 preparer;
  -- do not invent a legacy action to make the old validator accept it.
  if cardinality(array_remove(array_remove(actions,'inventory_fields'),'priority_change'))>0 then
    perform private.project_reclass_sheared_v5(v5_payload);
  end if;
  return p_payload || jsonb_build_object('rowOverlays',result_rows);
end
$function$;
revoke all on function private.project_reclass_editable_fields_v7(jsonb) from public,anon,authenticated;
grant execute on function private.project_reclass_editable_fields_v7(jsonb) to service_role;

create or replace function private.prepare_reclass_editable_fields_v7(p_payload jsonb,p_actor_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  projected jsonb := private.project_reclass_editable_fields_v7(p_payload);
  actor public.profiles;
  overlay jsonb;
  edit_value jsonb;
  row_value public.ph_master_inventory;
  source_row public.ph_master_inventory;
  v6_payload jsonb;
  v5_payload jsonb;
  v6_prepared jsonb;
  v6_has_action boolean;
  legacy_actions text[];
  uid text;
  field_name text;
  expected_value text;
  target_value text;
  before_values jsonb;
  after_values jsonb;
  all_values jsonb;
  changed_fields jsonb;
  field_rows jsonb := '[]'::jsonb;
  report_stamps jsonb := '[]'::jsonb;
  frozen_by_uid jsonb := '{}'::jsonb;
  actor_initials text;
  actor_name_parts text[];
  stamp_instant timestamptz;
  stamp_time text;
  stamp_date text;
  row_has_fields boolean;
  has_move_or_shear boolean;
  id_list text[] := '{}'::text[];
  live_uid text;
  source_mode text;
  source_uid text;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  actor_name_parts:=regexp_split_to_array(regexp_replace(
    btrim(coalesce(nullif(actor.display_name,''),actor.username)),'[^A-Za-z0-9]+',' ','g'),'[[:space:]]+');
  actor_initials:=upper(left(coalesce(actor_name_parts[1],''),1)||left(coalesce(actor_name_parts[2],''),1));
  if actor_initials='' then actor_initials:=upper(left(actor.username,3)); end if;
  stamp_instant:=clock_timestamp();
  stamp_time:=to_char(stamp_instant at time zone 'America/Chicago','FMMM/FMDD/YYYY FMHH12:MI:SS AM');
  stamp_date:=to_char(stamp_instant at time zone 'America/Chicago','FMMM/FMDD/YYYY');
  source_mode := lower(btrim(coalesce(projected #>> '{sourceContext,sourceMode}','drive')));
  if source_mode not in ('drive','item-inquiry','eval-report-2','eval-work') then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_MODE_INVALID';
  end if;

  select 'priority_change'=any(coalesce(array_agg(value),'{}'::text[])) into v6_has_action
  from jsonb_array_elements_text(projected #> '{transaction,requestActions}') actions(value);
  v6_has_action := coalesce(v6_has_action,false)
    or jsonb_array_length(coalesce(projected #> '{transaction,holdStopProposals}','[]'::jsonb))>0;
  v6_payload := (projected - 'sourceContext') || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v6-smart-shield-20261009',
    'transaction',(projected->'transaction') || jsonb_build_object(
      'requestActions',to_jsonb(array_remove(coalesce((select array_agg(value order by ordinality)
        from jsonb_array_elements_text(projected #> '{transaction,requestActions}') with ordinality a(value,ordinality)),'{}'::text[]),'inventory_fields'))),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'fieldEdits') || jsonb_build_object('expected',
        (value->'expected') - 'locationnote' - 'locationptn1' - 'desigcust' - 'desigloc'
          - 'pullerresponsibility' - 'oversellpercentage' - 'salesnote' - 'suspend')
      order by ordinality),'[]'::jsonb)
      from jsonb_array_elements(projected->'rowOverlays') with ordinality a(value,ordinality))
  );
  v5_payload := v6_payload || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'transaction',(v6_payload->'transaction') || jsonb_build_object(
      'requestActions',to_jsonb(array_remove(array_remove(coalesce((select array_agg(value order by ordinality)
        from jsonb_array_elements_text(projected #> '{transaction,requestActions}') with ordinality a(value,ordinality)),'{}'::text[]),'inventory_fields'),'priority_change')),
      'holdStopProposals','[]'::jsonb),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'expected') || jsonb_build_object('expected',(value->'expected') - 'priority' - 'holdstopcode' - 'holdstopreason')
      order by ordinality),'[]'::jsonb)
      from jsonb_array_elements(v6_payload->'rowOverlays') with ordinality a(value,ordinality))
  );
  legacy_actions := array(select jsonb_array_elements_text(v5_payload #> '{transaction,requestActions}'));
  has_move_or_shear := cardinality(legacy_actions)>0;
  source_uid:=btrim(coalesce(projected #>> '{source,unique_id}',projected #>> '{source,uniqueId}',''));
  select m.* into source_row from public.ph_master_inventory m where m.unique_id=source_uid for update;
  if source_row.unique_id is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_SOURCE_MISSING'; end if;
  if v6_has_action then
    perform private.validate_reclass_smart_shield_v6(v6_payload);
    v6_prepared := private.prepare_reclass_live_edits_v6(v6_payload,actor.username);
    select coalesce(array_agg(value->>'unique_id' order by value->>'unique_id'),'{}'::text[])
      into id_list from jsonb_array_elements(v6_prepared->'edits');
  elsif has_move_or_shear then
    perform private.validate_drive_reclass_sheared_v5(v5_payload);
  end if;

  -- Every submitted overlay is rechecked and locked, including field-only rows.
  for overlay in select value from jsonb_array_elements(projected->'rowOverlays') order by value->>'unique_id' loop
    uid := btrim(overlay->>'unique_id');
    select m.* into row_value from public.ph_master_inventory m where m.unique_id=uid for update;
    if row_value.unique_id is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_ROW_MISSING'; end if;
    if upper(btrim(coalesce(row_value.itemcode,''))) is distinct from upper(btrim(coalesce(projected #>> '{source,itemcode}','')))
       or lower(regexp_replace(btrim(coalesce(row_value.genusname,'')),'[[:space:]]+',' ','g'))
          is distinct from lower(regexp_replace(btrim(coalesce(source_row.genusname,'')),'[[:space:]]+',' ','g')) then
      raise exception using errcode='42501',message='DRIVE_RECLASS_V7_OVERLAY_SCOPE_FORBIDDEN';
    end if;
    if uid=source_uid then source_row:=row_value; end if;
    frozen_by_uid := frozen_by_uid || jsonb_build_object(uid,to_jsonb(row_value));
    if not (uid=any(id_list)) then id_list:=array_append(id_list,uid); end if;
    if not has_move_or_shear and not v6_has_action then
      -- The old V4/V5 validator is intentionally bypassed only for a truthful
      -- inventory_fields-only request; keep its row identity/OH checks here.
      if upper(btrim(coalesce(row_value.itemcode,''))) is distinct from upper(btrim(coalesce(overlay #>> '{expected,itemcode}','')))
         or upper(btrim(coalesce(row_value.lotcode,''))) is distinct from upper(btrim(coalesce(overlay #>> '{expected,lotcode}','')))
         or upper(btrim(coalesce(row_value.locationcode,''))) is distinct from upper(btrim(coalesce(overlay #>> '{expected,locationcode}','')))
         or coalesce(row_value.desigitem,'') is distinct from coalesce(overlay #>> '{expected,desigitem}','')
         or coalesce(regexp_replace(row_value.ptronhand,'[^0-9.-]','','g'),'') is distinct from coalesce(regexp_replace(overlay #>> '{expected,ptronhand}','[^0-9.-]','','g'),'') then
        raise exception using errcode='40001',message='DRIVE_RECLASS_V7_ROW_IDENTITY_CONFLICT';
      end if;
    end if;
    before_values := jsonb_build_object(
      'locationnote',row_value.locationnote,'locationptn1',row_value.locationptn1,
      'desigitem',row_value.desigitem,'desigcust',row_value.desigcust,'desigloc',row_value.desigloc,
      'pullerresponsibility',row_value.pullerresponsibility,'oversellpercentage',row_value.oversellpercentage,
      'salesnote',row_value.salesnote,'suspend',row_value.suspend
    );
    after_values := before_values;
    changed_fields := '[]'::jsonb;
    row_has_fields := false;
    for edit_value in select value from jsonb_array_elements(coalesce(overlay->'fieldEdits','[]'::jsonb)) loop
      field_name := edit_value->>'field';
      expected_value := nullif(edit_value->>'expected','');
      target_value := case field_name
        when 'suspend' then case edit_value->>'decision'
          when 'yes' then coalesce(nullif(btrim(row_value.suspend),''),actor_initials)
          else null end
        else nullif(edit_value->>'value','') end;
      case field_name
        when 'locationnote' then all_values:=to_jsonb(row_value.locationnote);
        when 'locationptn1' then all_values:=to_jsonb(row_value.locationptn1);
        when 'desigitem' then all_values:=to_jsonb(row_value.desigitem);
        when 'desigcust' then all_values:=to_jsonb(row_value.desigcust);
        when 'desigloc' then all_values:=to_jsonb(row_value.desigloc);
        when 'pullerresponsibility' then all_values:=to_jsonb(row_value.pullerresponsibility);
        when 'oversellpercentage' then all_values:=to_jsonb(row_value.oversellpercentage);
        when 'salesnote' then all_values:=to_jsonb(row_value.salesnote);
        when 'suspend' then all_values:=to_jsonb(row_value.suspend);
      end case;
      if nullif(all_values #>> '{}','') is distinct from expected_value then
        raise exception using errcode='40001',message='DRIVE_RECLASS_V7_FIELD_CONFLICT';
      end if;
      after_values := jsonb_set(after_values,array[field_name],coalesce(to_jsonb(target_value),'null'::jsonb),true);
      if expected_value is distinct from target_value then
        changed_fields := changed_fields || jsonb_build_array(field_name);
        row_has_fields := true;
      end if;
    end loop;
    if row_has_fields then
      field_rows := field_rows || jsonb_build_array(jsonb_build_object('unique_id',uid,'before',before_values,
        'after',after_values,'changedFields',changed_fields,'stamps',jsonb_build_object(
          'prisetby',actor_initials,'priupdated',stamp_time,
          'locationnotedate',case when before_values->'locationnote' is distinct from after_values->'locationnote' then stamp_time else row_value.locationnotedate end,
          'evaldate',stamp_date)));
    end if;
    report_stamps := report_stamps || jsonb_build_array(jsonb_build_object('unique_id',uid,'stamps',jsonb_build_object(
      'prisetby',actor_initials,'priupdated',stamp_time,'locationnotedate',
      case when row_has_fields and before_values->'locationnote' is distinct from after_values->'locationnote' then stamp_time else row_value.locationnotedate end,
      'evaldate',stamp_date)));
  end loop;
  if source_row.unique_id is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_SOURCE_MISSING'; end if;
  if v6_has_action then
    for live_uid in select unnest(id_list) loop
      if not (frozen_by_uid ? live_uid) then
        select to_jsonb(m) into all_values from public.ph_master_inventory m where m.unique_id=live_uid for update;
        if all_values is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_ROW_MISSING'; end if;
        frozen_by_uid:=frozen_by_uid || jsonb_build_object(live_uid,all_values);
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'v6Payload',v6_payload,'v5Payload',v5_payload,'v6Prepared',v6_prepared,
    'fieldRows',field_rows,'reportStamps',report_stamps,
    'v7FrozenRows',(select coalesce(jsonb_agg(value order by key),'[]'::jsonb) from jsonb_each(frozen_by_uid)),
    'actorInitials',actor_initials,'stampTime',stamp_time,'stampDate',stamp_date
  );
end
$function$;
revoke all on function private.prepare_reclass_editable_fields_v7(jsonb,text) from public,anon,authenticated,service_role;

create or replace function private.apply_reclass_editable_fields_v7(p_field_rows jsonb,p_actor_username text,p_stamp_time text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  item jsonb;
  uid text;
  before_values jsonb;
  after_values jsonb;
  row_value public.ph_master_inventory;
  result_rows jsonb := '[]'::jsonb;
  seen text[] := '{}'::text[];
  revision_value bigint;
  changed text[];
begin
  if jsonb_typeof(coalesce(p_field_rows,'null'::jsonb)) is distinct from 'array' or jsonb_array_length(p_field_rows)>500 then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_FIELD_LIMIT_EXCEEDED';
  end if;
  for item in select value from jsonb_array_elements(p_field_rows) order by value->>'unique_id' loop
    uid:=btrim(coalesce(item->>'unique_id',''));
    if uid='' or uid=any(seen) then raise exception using errcode='22023',message='DRIVE_RECLASS_V7_FIELD_ROW_INVALID'; end if;
    seen:=array_append(seen,uid);
    before_values:=item->'before'; after_values:=item->'after';
    select m.* into row_value from public.ph_master_inventory m where m.unique_id=uid for update;
    if row_value.unique_id is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_ROW_MISSING'; end if;
    if jsonb_build_object(
      'locationnote',row_value.locationnote,'locationptn1',row_value.locationptn1,
      'desigitem',row_value.desigitem,'desigcust',row_value.desigcust,'desigloc',row_value.desigloc,
      'pullerresponsibility',row_value.pullerresponsibility,'oversellpercentage',row_value.oversellpercentage,
      'salesnote',row_value.salesnote,'suspend',row_value.suspend
    ) is distinct from before_values then
      raise exception using errcode='40001',message='DRIVE_RECLASS_V7_FIELD_CONFLICT';
    end if;
    changed:=array(select jsonb_array_elements_text(coalesce(item->'changedFields','[]'::jsonb)));
    if 'locationnote'=any(changed) then
      update public.ph_master_inventory m set
        locationnote=after_values->>'locationnote',locationptn1=after_values->>'locationptn1',
        desigitem=after_values->>'desigitem',desigcust=after_values->>'desigcust',desigloc=after_values->>'desigloc',
        pullerresponsibility=after_values->>'pullerresponsibility',oversellpercentage=after_values->>'oversellpercentage',
        salesnote=after_values->>'salesnote',suspend=after_values->>'suspend',
        prisetby=item #>> '{stamps,prisetby}',priupdated=p_stamp_time,locationnotedate=p_stamp_time,
        last_updated=clock_timestamp()
      where m.unique_id=uid returning m.* into row_value;
    elsif cardinality(changed)>0 then
      update public.ph_master_inventory m set
        locationnote=after_values->>'locationnote',locationptn1=after_values->>'locationptn1',
        desigitem=after_values->>'desigitem',desigcust=after_values->>'desigcust',desigloc=after_values->>'desigloc',
        pullerresponsibility=after_values->>'pullerresponsibility',oversellpercentage=after_values->>'oversellpercentage',
        salesnote=after_values->>'salesnote',suspend=after_values->>'suspend',
        prisetby=item #>> '{stamps,prisetby}',priupdated=p_stamp_time,last_updated=clock_timestamp()
      where m.unique_id=uid returning m.* into row_value;
    end if;
    result_rows:=result_rows||jsonb_build_array(jsonb_build_object(
      'unique_id',uid,
      'before',before_values,
      'after',jsonb_build_object(
        'locationnote',row_value.locationnote,'locationptn1',row_value.locationptn1,
        'desigitem',row_value.desigitem,'desigcust',row_value.desigcust,'desigloc',row_value.desigloc,
        'pullerresponsibility',row_value.pullerresponsibility,'oversellpercentage',row_value.oversellpercentage,
        'salesnote',row_value.salesnote,'suspend',row_value.suspend
      ),
      'changedFields',to_jsonb(changed),
      'stamps',jsonb_build_object('prisetby',row_value.prisetby,'priupdated',row_value.priupdated,
        'locationnotedate',row_value.locationnotedate,'evaldate',item #>> '{stamps,evaldate}')
    ));
  end loop;
  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  if revision_value is null then raise exception using errcode='55000',message='RECLASS_V7_INVENTORY_REVISION_MISSING'; end if;
  return jsonb_build_object('inventoryFields',result_rows,'inventoryRevision',revision_value::text);
end
$function$;
revoke all on function private.apply_reclass_editable_fields_v7(jsonb,text,text) from public,anon,authenticated,service_role;

create or replace function public.enqueue_drive_reclass_inquiry_v7(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  actor_username text := lower(btrim(coalesce(p_payload->>'actorUsername','')));
  token text := btrim(coalesce(p_payload->>'idempotencyToken',p_payload->>'idempotency_token',''));
  source_mode text := lower(btrim(coalesce(p_payload #>> '{sourceContext,sourceMode}','drive')));
  event_key_value text;
  fingerprint text;
  projected jsonb;
  prepared jsonb;
  v6_payload jsonb;
  v5_payload jsonb;
  v3_payload jsonb;
  trio_result jsonb;
  field_result jsonb;
  underlying jsonb;
  event_row public.ph_request_delivery_outbox;
  actor_profile public.profiles;
  recipients text[] := '{}'::text[];
  supplied_emails text[] := '{}'::text[];
  recipient_count integer := 0;
  unavailable text[] := '{}'::text[];
  coverage public.ph_item_inquiry_coverage;
  sunday_email text;
  sharon_email text;
  current_live jsonb;
  final_payload jsonb;
  live_rows jsonb := '[]'::jsonb;
  live_uid text;
  live_uids text[] := '{}'::text[];
  row_value public.ph_master_inventory;
  inventory_revision bigint;
  existing_fingerprint text;
  source_itemcode text;
  source_row public.ph_master_inventory;
  v6_live_scope jsonb := '{}'::jsonb;
  request_fingerprint text;
  old_tx jsonb;
begin
  if actor_username='' or length(token)<12 or length(token)>180 then
    raise exception using errcode='22023',message='DRIVE_RECLASS_TOKEN_INVALID';
  end if;
  projected:=private.project_reclass_editable_fields_v7(p_payload);
  if source_mode not in ('drive','item-inquiry','eval-report-2') then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_SOURCE_MODE_INVALID';
  end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'workflowPolicyVersion',projected->>'workflowPolicyVersion',
    'source',projected->'source','sourceContext',projected->'sourceContext',
    'recipientEmails',projected->'recipientEmails','transaction',projected->'transaction',
    'rowOverlays',projected->'rowOverlays'
  )::text,'UTF8'),'sha256'),'hex');
  event_key_value:='reclass-inquiry:'||left(encode(extensions.digest(token,'sha256'),'hex'),40);
  perform pg_advisory_xact_lock(hashtextextended(event_key_value,0));
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is not null then
    if lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}','')))<>actor_username then
      raise exception using errcode='42501',message='DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    select p.* into actor_profile from public.profiles p where lower(btrim(p.username))=actor_username
      and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password limit 1;
    if actor_profile.id is null then raise exception using errcode='42501',message='DRIVE_RECLASS_PROFILE_NOT_ACTIVE'; end if;
    if event_row.payload #>> '{reclassPayload,workflowPolicyVersion}'<>'reclass-action-workflow-v7-editable-fields-20261009'
       or event_row.payload #>> '{reclassPayload,protectedDelivery,requestFingerprint}' is distinct from fingerprint then
      raise exception using errcode='P0001',message='DRIVE_RECLASS_TOKEN_CONFLICT';
    end if;
    return private.drive_reclass_delivery_result_v1(event_row) || jsonb_build_object(
      'duplicate',true,
      'liveEdits',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,liveEdits}','[]'::jsonb),
      'inventoryRevision',event_row.payload #>> '{reclassPayload,protectedDelivery,inventoryRevision}',
      'liveEditScope',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,liveEditScope}','{}'::jsonb),
      'inventoryFields',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,inventoryFields}','[]'::jsonb),
      'v7Scope',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,v7Scope}','{}'::jsonb)
    );
  end if;

  perform private.lock_ph_master_inventory_for_live_edit_v6();
  prepared:=private.prepare_reclass_editable_fields_v7(projected,actor_username);
  v6_payload:=prepared->'v6Payload';
  v5_payload:=prepared->'v5Payload';
  source_itemcode:=upper(btrim(coalesce(projected #>> '{source,itemcode}','')));
  select m.* into source_row from public.ph_master_inventory m
  where m.unique_id=btrim(coalesce(projected #>> '{source,unique_id}',projected #>> '{source,uniqueId}',''));
  if source_row.unique_id is null or source_itemcode='' or upper(btrim(coalesce(source_row.itemcode,'')))<>source_itemcode then
    raise exception using errcode='40001',message='DRIVE_RECLASS_V7_SOURCE_CHANGED';
  end if;
  if source_mode='eval-report-2' then
    if lower(btrim(coalesce(projected #>> '{sourceContext,itemcode}','')))<>source_itemcode
       or not private.eval_report2_item_qualifies_v1(projected #>> '{sourceContext,reportId}',source_itemcode,now()) then
      raise exception using errcode='42501',message='DRIVE_RECLASS_V7_REPORT_SCOPE_FORBIDDEN';
    end if;
    recipients:=public.get_eval_report2_direct_inquiry_recipients_v1(actor_username);
  elsif source_mode='item-inquiry' then
    if actor_username not in ('dylan_collyge','jd_jones','megan_kelly') then
      raise exception using errcode='42501',message='DRIVE_RECLASS_V7_ITEM_INQUIRY_FORBIDDEN';
    end if;
    if jsonb_typeof(coalesce(projected->'recipientEmails','null'::jsonb)) is distinct from 'array'
       or jsonb_array_length(projected->'recipientEmails') not between 1 and 50
       or exists(select 1 from jsonb_array_elements(projected->'recipientEmails') e
          where jsonb_typeof(e) is distinct from 'string' or length(e#>>'{}')>254
            or btrim(e#>>'{}') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
      raise exception using errcode='22023',message='DRIVE_RECLASS_V7_RECIPIENTS_INVALID';
    end if;
    select array_agg(lower(btrim(value)) order by lower(btrim(value))) into supplied_emails
    from jsonb_array_elements_text(projected->'recipientEmails') a(value);
    if cardinality(supplied_emails)<>cardinality(array(select distinct unnest(supplied_emails))) then
      raise exception using errcode='22023',message='DRIVE_RECLASS_V7_RECIPIENTS_INVALID';
    end if;
    select count(distinct lower(btrim(u.email)))::integer into recipient_count
    from public.profiles p join auth.users u on u.id=p.id
    where p.disabled_at is null and u.email_confirmed_at is not null
      and lower(btrim(u.email))=any(supplied_emails)
      and u.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
    if recipient_count<>cardinality(supplied_emails) then
      raise exception using errcode='42501',message='DRIVE_RECLASS_V7_RECIPIENTS_FORBIDDEN';
    end if;
    recipients:=supplied_emails;
  end if;

  if coalesce((prepared->'v6Prepared'->'edits') is not null,false) then
    underlying:=public.enqueue_drive_reclass_inquiry_v6(v6_payload);
  elsif cardinality(array(select jsonb_array_elements_text(v5_payload #> '{transaction,requestActions}')))>0 then
    underlying:=public.enqueue_drive_reclass_inquiry_v5(v5_payload);
  else
    v3_payload:=v5_payload || jsonb_build_object(
      'workflowPolicyVersion','reclass-action-workflow-v3-row-actions-20260826',
      'transaction',(v5_payload->'transaction')||jsonb_build_object('requestActions','[]'::jsonb,'holdStopProposals','[]'::jsonb),
      'rowOverlays',(select coalesce(jsonb_agg(
        (value - 'proposals') || jsonb_build_object('proposals','[]'::jsonb,'expected',
          (value->'expected') - 'ptronhand' - 'desigitem' || jsonb_build_object(
            'ptronhand',value #>> '{expected,ptronhand}','desigitem',value #>> '{expected,desigitem}'))
        order by ordinality),'[]'::jsonb) from jsonb_array_elements(v5_payload->'rowOverlays') with ordinality a(value,ordinality))
    );
    underlying:=public.enqueue_drive_reclass_inquiry_v1(v3_payload || jsonb_build_object('actorUsername',actor_username,'idempotencyToken',token));
  end if;
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is null or lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}','')))<>actor_username then
    raise exception using errcode='42501',message='DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
  end if;
  if coalesce(underlying->>'duplicate','false')='true' then raise exception using errcode='P0001',message='DRIVE_RECLASS_TOKEN_CONFLICT'; end if;

  trio_result:=coalesce(underlying,'{}'::jsonb);
  field_result:=private.apply_reclass_editable_fields_v7(prepared->'fieldRows',actor_username,prepared->>'stampTime');
  select r.revision into inventory_revision from public.app_dataset_revisions r where r.key='ph_master_inventory';
  if inventory_revision is null then raise exception using errcode='55000',message='RECLASS_V7_INVENTORY_REVISION_MISSING'; end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into live_uids
  from (
    select value->>'unique_id' x from jsonb_array_elements(coalesce(trio_result->'liveEdits','[]'::jsonb))
    union select value->>'unique_id' from jsonb_array_elements(coalesce(field_result->'inventoryFields','[]'::jsonb))
  ) all_ids where nullif(x,'') is not null;
  for live_uid in select unnest(live_uids) loop
    select m.* into row_value from public.ph_master_inventory m where m.unique_id=live_uid;
    if row_value.unique_id is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_ROW_MISSING'; end if;
    live_rows:=live_rows||jsonb_build_array(jsonb_build_object(
      'unique_id',row_value.unique_id,'priority',row_value.priority,'holdstopcode',row_value.holdstopcode,
      'holdstopreason',row_value.holdstopreason,'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
      'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,'last_updated',row_value.last_updated,
      'evidence',jsonb_build_object(
        'unique_id',row_value.unique_id,'itemcode',row_value.itemcode,'locationcode',row_value.locationcode,'lotcode',row_value.lotcode,
        'last_updated',row_value.last_updated,'photo_link',row_value.photo_link,'photo_name',row_value.photo_name,
        'match',row_value.match,'spec',row_value.spec,'caliper',row_value.caliper,'initial_ptr',row_value.initial_ptr,
        'loc_match_qty',row_value.loc_match_qty,'ptravailable',row_value.ptravailable,'av_note',row_value.av_note,
        'pic_note',row_value.pic_note,'sales_note',row_value.sales_note,'date_completed',row_value.date_completed,
        'app_tab_assignment',row_value.app_tab_assignment,'av_rule_av_note_updated_at',row_value.av_rule_av_note_updated_at,
        'av_rule_bundle_updated_at',row_value.av_rule_bundle_updated_at,'av_rule_caliper_updated_at',row_value.av_rule_caliper_updated_at,
        'av_rule_holdstop_snapshot',row_value.av_rule_holdstop_snapshot,'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
        'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,'av_rule_match_updated_at',row_value.av_rule_match_updated_at,
        'av_rule_photo_updated_at',row_value.av_rule_photo_updated_at,'av_rule_priority_snapshot',row_value.av_rule_priority_snapshot,
        'av_rule_spec_updated_at',row_value.av_rule_spec_updated_at
      )
    ));
  end loop;

  if source_mode in ('item-inquiry','eval-report-2') then
    select * into coverage from public.ph_item_inquiry_coverage where singleton;
    sharon_email:=private.item_inquiry_verified_email_v1('sharon_combs');
    if coalesce(coverage.sharon_away,false) and sharon_email=any(recipients) then
      sunday_email:=private.item_inquiry_verified_email_v1('sunday_ellis');
      if sunday_email is null then raise exception using errcode='40001',message='ITEM_INQUIRY_COVERAGE_UNAVAILABLE'; end if;
      recipients:=array(select distinct x from unnest(recipients||sunday_email) x order by x);
    end if;
    update public.ph_request_delivery_outbox o set payload=jsonb_set(o.payload,'{reclassPayload}',
      (o.payload->'reclassPayload')||jsonb_build_object(
        'sourceContext',projected->'sourceContext','recipientEmails',to_jsonb(recipients),
        'emailRecipients',to_jsonb(recipients),
        'recipients',(select coalesce(jsonb_agg(jsonb_build_object('email',email,'role',case when source_mode='eval-report-2' then 'required_eval_report_2' else 'selected_item_inquiry' end) order by email),'[]'::jsonb) from unnest(recipients) email)
      )
    ) where o.event_id=event_row.event_id returning * into event_row;
  end if;
  final_payload:=jsonb_set(event_row.payload,'{reclassPayload}',
    (event_row.payload->'reclassPayload')||jsonb_build_object(
      'workflowPolicyVersion','reclass-action-workflow-v7-editable-fields-20261009',
      'sourceContext',coalesce(projected->'sourceContext',jsonb_build_object('sourceMode','drive')),
      'transaction',projected->'transaction','rowOverlays',projected->'rowOverlays',
      'protectedDelivery',(coalesce(event_row.payload #> '{reclassPayload,protectedDelivery}','{}'::jsonb))||jsonb_build_object(
        'contractVersion','drive-reclass-protected-v1','requestFingerprint',fingerprint,
        'v7FrozenRows',prepared->'v7FrozenRows','liveEdits',live_rows,
        'inventoryFields',field_result->'inventoryFields','inventoryRevision',inventory_revision::text,
        'liveEditScope',coalesce(trio_result->'liveEditScope','{}'::jsonb),
        'v7Scope',jsonb_build_object('sourceMode',source_mode,'reportStamps',prepared->'reportStamps',
          'reportId',case when source_mode='eval-report-2' then projected #>> '{sourceContext,reportId}' else null end,
          'itemcode',source_itemcode)
      )
    ),false);
  if octet_length(convert_to(final_payload::text,'UTF8'))>4*1024*1024 then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V7_PAYLOAD_TOO_LARGE';
  end if;
  update public.ph_request_delivery_outbox o set payload=final_payload,updated_at=clock_timestamp()
  where o.event_id=event_row.event_id returning * into event_row;
  update public.ph_inventory_transactions t set raw_payload=jsonb_build_object(
    'workflowPolicyVersion',event_row.payload #>> '{reclassPayload,workflowPolicyVersion}',
    'transaction',event_row.payload #> '{reclassPayload,transaction}',
    'rowOverlays',event_row.payload #> '{reclassPayload,rowOverlays}',
    'protectedDelivery',event_row.payload #> '{reclassPayload,protectedDelivery}'
  ) where t.delivery_event_id=event_row.event_id and t.status='requested' and t.event_type='inventory_change_request';
  if not found then raise exception using errcode='55000',message='DRIVE_RECLASS_V7_REQUESTED_AUDIT_MISSING'; end if;
  return private.drive_reclass_delivery_result_v1(event_row)||jsonb_build_object(
    'duplicate',false,'liveEdits',live_rows,'inventoryFields',field_result->'inventoryFields',
    'inventoryRevision',inventory_revision::text,'liveEditScope',coalesce(trio_result->'liveEditScope','{}'::jsonb),
    'v7Scope',final_payload #> '{reclassPayload,protectedDelivery,v7Scope}'
  );
end
$function$;
revoke all on function public.enqueue_drive_reclass_inquiry_v7(jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_drive_reclass_inquiry_v7(jsonb) to service_role;

insert into private.app_access_legacy_checks(check_key,permission_key,enforcement_surface,notes)
values ('edge.drive.reclass.v7','drive.reclass.submit','edge','The authenticated app API routes V7 editable inventory fields through service-only atomic V7 enqueue and source-aware authorization.'),
       ('rpc.drive.reclass.v7','drive.reclass.submit','rpc','V7 validates complete editable-field snapshots, raw-import shields, and atomically freezes the inquiry with its live receipt.')
on conflict(check_key) do update set permission_key=excluded.permission_key,enforcement_surface=excluded.enforcement_surface,notes=excluded.notes;

notify pgrst,'reload schema';

-- Eval Work stores V7 drafts as proposals only. On submit, its existing
-- completion transaction invokes the same locked V7 preparation/apply helpers.
create or replace function private.validate_eval_work_editable_fields_v7(
  p_inquiry jsonb,p_itemcode text,p_context_rows jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  eval_payload jsonb;
  v5_payload jsonb;
  overlay jsonb;
  edit_value jsonb;
  current_row jsonb;
  uid text;
  field_name text;
  expected_value text;
  actual_value text;
  actions text[];
  seen text[] := '{}'::text[];
begin
  if jsonb_typeof(p_context_rows) is distinct from 'array' then
    raise exception using errcode='22023',message='eval_work_context_invalid';
  end if;
  -- Eval Work's source mode is derived from the server-owned work record.
  eval_payload := p_inquiry || jsonb_build_object('sourceContext',jsonb_build_object('sourceMode','eval-work'));
  eval_payload := private.project_reclass_editable_fields_v7(eval_payload);
  if upper(btrim(coalesce(eval_payload #>> '{source,itemcode}','')))<>upper(btrim(coalesce(p_itemcode,''))) then
    raise exception using errcode='42501',message='eval_work_itemcode_forbidden';
  end if;
  select coalesce(array_agg(value order by ordinality),'{}'::text[]) into actions
  from jsonb_array_elements_text(eval_payload #> '{transaction,requestActions}') with ordinality a(value,ordinality);

  for overlay in select value from jsonb_array_elements(eval_payload->'rowOverlays') loop
    uid:=btrim(coalesce(overlay->>'unique_id',''));
    if uid='' or uid=any(seen) then raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ROW_DUPLICATE'; end if;
    seen:=array_append(seen,uid);
    select value into current_row from jsonb_array_elements(p_context_rows) where value->>'unique_id'=uid limit 1;
    if current_row is null or upper(btrim(coalesce(current_row->>'itemcode','')))<>upper(btrim(coalesce(p_itemcode,''))) then
      raise exception using errcode='40001',message='eval_work_row_context_conflict';
    end if;
    if jsonb_typeof(overlay->'expected') is distinct from 'object'
       or not ((overlay->'expected') ?& array['itemcode','lotcode','locationcode','ptronhand','desigitem']) then
      raise exception using errcode='22023',message='DRIVE_RECLASS_V7_ROW_INVALID';
    end if;
    if upper(btrim(coalesce(overlay #>> '{expected,itemcode}','')))
          is distinct from upper(btrim(coalesce(current_row->>'itemcode','')))
       or upper(btrim(coalesce(overlay #>> '{expected,lotcode}','')))
          is distinct from upper(btrim(coalesce(current_row->>'lotcode','')))
       or upper(btrim(coalesce(overlay #>> '{expected,locationcode}','')))
          is distinct from upper(btrim(coalesce(current_row->>'locationcode','')))
       or regexp_replace(coalesce(overlay #>> '{expected,ptronhand}',''),'[^0-9.-]','','g')
          is distinct from regexp_replace(coalesce(current_row->>'ptronhand',''),'[^0-9.-]','','g') then
      raise exception using errcode='40001',message='eval_work_original_oh_conflict';
    end if;
    for edit_value in select value from jsonb_array_elements(coalesce(overlay->'fieldEdits','[]'::jsonb)) loop
      field_name:=edit_value->>'field';
      expected_value:=nullif(edit_value->>'expected','');
      actual_value:=nullif(current_row->>field_name,'');
      if actual_value is distinct from expected_value then
        raise exception using errcode='40001',message='DRIVE_RECLASS_V7_FIELD_CONFLICT';
      end if;
    end loop;
  end loop;

  if cardinality(actions)>0 then
    v5_payload:=eval_payload||jsonb_build_object(
      'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
      'transaction',(eval_payload->'transaction')||jsonb_build_object(
        'requestActions',to_jsonb(array_remove(array_remove(actions,'inventory_fields'),'priority_change')),
        'holdStopProposals','[]'::jsonb),
      'rowOverlays',(select coalesce(jsonb_agg(
        (value-'fieldEdits')||jsonb_build_object('expected',
          (value->'expected')-'locationnote'-'locationptn1'-'desigcust'-'desigloc'
            -'pullerresponsibility'-'oversellpercentage'-'salesnote'-'suspend'
            -'priority'-'holdstopcode'-'holdstopreason')
        order by ordinality),'[]'::jsonb)
        from jsonb_array_elements(eval_payload->'rowOverlays') with ordinality a(value,ordinality))
    );
    if cardinality(array_remove(array_remove(actions,'inventory_fields'),'priority_change'))>0 then
      perform private.validate_eval_work_inquiry_sheared_v5(v5_payload,p_itemcode,p_context_rows);
    end if;
  end if;
end
$function$;
revoke all on function private.validate_eval_work_editable_fields_v7(jsonb,text,jsonb) from public,anon,authenticated,service_role;

create or replace function private.validate_eval_work_inquiry_v1(
  p_inquiry jsonb,p_itemcode text,p_context_rows jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare projected jsonb; overlay jsonb; current_row jsonb; uid text;
begin
  if coalesce(p_inquiry->>'workflowPolicyVersion','')='reclass-action-workflow-v7-editable-fields-20261009' then
    perform private.validate_eval_work_editable_fields_v7(p_inquiry,p_itemcode,p_context_rows);
  elsif coalesce(p_inquiry->>'workflowPolicyVersion','')='reclass-action-workflow-v6-smart-shield-20261009' then
    perform private.validate_reclass_smart_shield_v6(p_inquiry);
    projected:=private.eval_work_smart_shield_v6_to_v5(p_inquiry);
    perform private.validate_eval_work_inquiry_sheared_v5(projected,p_itemcode,p_context_rows);
  elsif coalesce(p_inquiry->>'workflowPolicyVersion','')='reclass-action-workflow-v5-sheared-20261008' then
    perform private.validate_eval_work_inquiry_sheared_v5(p_inquiry,p_itemcode,p_context_rows);
  elsif coalesce(p_inquiry->>'workflowPolicyVersion','')='reclass-action-workflow-v4-split-moves-20261006' then
    for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays','[]'::jsonb)) loop
      uid:=btrim(coalesce(overlay->>'unique_id',''));
      select value into current_row from jsonb_array_elements(coalesce(p_context_rows,'[]'::jsonb)) where value->>'unique_id'=uid limit 1;
      if current_row is null then raise exception using errcode='40001',message='eval_work_original_oh_conflict'; end if;
      if overlay->'expected' ? 'ptronhand' and exists(
        select 1 from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) proposal
        where proposal->>'action' in ('move_up','move_down')
      ) and overlay #>> '{expected,ptronhand}' is distinct from current_row->>'ptronhand' then
        raise exception using errcode='40001',message='eval_work_original_oh_conflict';
      end if;
    end loop;
    projected:=private.project_reclass_split_move_v4(p_inquiry,true);
    perform private.validate_eval_work_inquiry_legacy_v1(projected,p_itemcode,p_context_rows);
  else
    perform private.validate_eval_work_inquiry_legacy_v1(p_inquiry,p_itemcode,p_context_rows);
  end if;
end
$function$;
revoke all on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) to service_role;

create or replace function private.finalize_eval_work_editable_fields_v7(
  p_work_id uuid,p_submitted public.ph_eval_work,p_eval_inquiry jsonb,p_prepared jsonb
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  submitted public.ph_eval_work:=p_submitted;
  v6_result jsonb:='{}'::jsonb;
  field_result jsonb;
  live_ids text[]:='{}'::text[];
  live_rows jsonb:='[]'::jsonb;
  live_uid text;
  live_row public.ph_master_inventory;
  delivery public.ph_request_delivery_outbox;
  revision_value bigint;
begin
  if jsonb_typeof(p_prepared #> '{v6Prepared,edits}')='array' then
    v6_result:=private.apply_ph_master_inventory_live_edits_v6(p_prepared #> '{v6Prepared,edits}');
  end if;
  field_result:=private.apply_reclass_editable_fields_v7(p_prepared->'fieldRows',
    p_eval_inquiry #>> '{actor,username}',p_prepared->>'stampTime');
  -- Actor username is also preserved by the protected Eval inquiry if the
  -- completion wrapper supplies it; apply does not use that parameter.
  select coalesce(array_agg(distinct uid order by uid),'{}'::text[]) into live_ids
  from (
    select value->>'unique_id' uid from jsonb_array_elements(coalesce(v6_result->'liveEdits','[]'::jsonb))
    union select value->>'unique_id' from jsonb_array_elements(coalesce(field_result->'inventoryFields','[]'::jsonb))
  ) u where nullif(uid,'') is not null;
  for live_uid in select unnest(live_ids) loop
    select * into live_row from public.ph_master_inventory m where m.unique_id=live_uid;
    if live_row.unique_id is null then raise exception using errcode='40001',message='DRIVE_RECLASS_V7_ROW_MISSING'; end if;
    live_rows:=live_rows||jsonb_build_array(jsonb_build_object(
      'unique_id',live_row.unique_id,'priority',live_row.priority,'holdstopcode',live_row.holdstopcode,
      'holdstopreason',live_row.holdstopreason,'av_rule_last_clear_reason',live_row.av_rule_last_clear_reason,
      'av_rule_last_cleared_at',live_row.av_rule_last_cleared_at,'last_updated',live_row.last_updated,
      'evidence',jsonb_build_object(
        'unique_id',live_row.unique_id,'itemcode',live_row.itemcode,'locationcode',live_row.locationcode,'lotcode',live_row.lotcode,
        'last_updated',live_row.last_updated,'photo_link',live_row.photo_link,'photo_name',live_row.photo_name,
        'match',live_row.match,'spec',live_row.spec,'caliper',live_row.caliper,'initial_ptr',live_row.initial_ptr,
        'loc_match_qty',live_row.loc_match_qty,'ptravailable',live_row.ptravailable,'av_note',live_row.av_note,
        'pic_note',live_row.pic_note,'sales_note',live_row.sales_note,'date_completed',live_row.date_completed,
        'app_tab_assignment',live_row.app_tab_assignment,'av_rule_av_note_updated_at',live_row.av_rule_av_note_updated_at,
        'av_rule_bundle_updated_at',live_row.av_rule_bundle_updated_at,'av_rule_caliper_updated_at',live_row.av_rule_caliper_updated_at,
        'av_rule_holdstop_snapshot',live_row.av_rule_holdstop_snapshot,'av_rule_last_clear_reason',live_row.av_rule_last_clear_reason,
        'av_rule_last_cleared_at',live_row.av_rule_last_cleared_at,'av_rule_match_updated_at',live_row.av_rule_match_updated_at,
        'av_rule_photo_updated_at',live_row.av_rule_photo_updated_at,'av_rule_priority_snapshot',live_row.av_rule_priority_snapshot,
        'av_rule_spec_updated_at',live_row.av_rule_spec_updated_at
      )
    ));
  end loop;
  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  if revision_value is null then raise exception using errcode='55000',message='RECLASS_V7_INVENTORY_REVISION_MISSING'; end if;
  update public.ph_eval_work w set
    inquiry_draft=p_eval_inquiry,submitted_inquiry=p_eval_inquiry
  where w.id=p_work_id returning * into submitted;
  select * into delivery from public.ph_request_delivery_outbox o
  where o.event_id=submitted.completion_event_id and o.event_type='eval_work_completion' for update;
  if delivery.event_id is null then raise exception using errcode='55000',message='EVAL_WORK_V7_COMPLETION_OUTBOX_MISSING'; end if;
  update public.ph_request_delivery_outbox o set payload=o.payload||jsonb_build_object(
    'inquiry',p_eval_inquiry,
    'protectedDelivery',jsonb_build_object(
      'liveEditVersion','reclass-action-workflow-v7-editable-fields-20261009',
      'v7FrozenRows',p_prepared->'v7FrozenRows','liveEdits',live_rows,
      'inventoryFields',field_result->'inventoryFields','inventoryRevision',revision_value::text,
      'liveEditScope',coalesce(v6_result->'liveEditScope','{}'::jsonb),
      'v7Scope',jsonb_build_object('sourceMode','eval-work','reportStamps',p_prepared->'reportStamps',
        'itemcode',p_eval_inquiry #>> '{source,itemcode}','evalWorkId',p_work_id::text)
    )
  ),updated_at=clock_timestamp() where o.event_id=delivery.event_id;
  return submitted;
end
$function$;
revoke all on function private.finalize_eval_work_editable_fields_v7(uuid,public.ph_eval_work,jsonb,jsonb) from public,anon,authenticated,service_role;

-- V1/V2 keep their old implementation for older workflows. V7 drafts remain
-- inert; only these submit branches run the locked prepare/apply sequence.
-- Preserve the V6 wrappers themselves before installing V7. Delegating every
-- non-V7 submission straight to the V5 body would silently lose V6 live edits.
alter function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) set schema private;
alter function private.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) rename to submit_eval_work_v1_v6_impl;
alter function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) set schema private;
alter function private.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) rename to submit_eval_work_v2_v6_impl;
revoke all on function private.submit_eval_work_v1_v6_impl(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function private.submit_eval_work_v2_v6_impl(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated,service_role;
create or replace function public.submit_eval_work_v1(
  p_work_id uuid,p_actor_username text,p_expected_version integer,
  p_inquiry jsonb,p_evidence jsonb,p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  inquiry_value jsonb;
  internal_inquiry jsonb;
  current_rows jsonb;
  prepared jsonb;
  fingerprint text;
begin
  actor:=private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id=p_work_id for update;
  if work.id is null or lower(work.assignee_username)<>lower(actor.username) then
    raise exception using errcode='42501',message='eval_work_submit_forbidden';
  end if;
  inquiry_value:=coalesce(p_inquiry,work.inquiry_draft);
  if coalesce(inquiry_value->>'workflowPolicyVersion','')<>'reclass-action-workflow-v7-editable-fields-20261009' then
    return private.submit_eval_work_v1_v6_impl(p_work_id,p_actor_username,p_expected_version,p_inquiry,p_evidence,p_submission_token);
  end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('inquiry',inquiry_value,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
  if work.status='submitted' and work.submission_token=trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode='P0001',message='eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if work.status not in ('open','in_progress') or work.version<>p_expected_version then
    raise exception using errcode='40001',message='eval_work_version_conflict';
  end if;
  internal_inquiry:=inquiry_value||jsonb_build_object('sourceContext',jsonb_build_object('sourceMode','eval-work'));
  perform private.lock_ph_master_inventory_for_live_edit_v6();
  current_rows:=private.eval_work_context_rows_v1(work.itemcode);
  perform private.validate_eval_work_inquiry_v1(internal_inquiry,work.itemcode,current_rows);
  prepared:=private.prepare_reclass_editable_fields_v7(internal_inquiry,actor.username);
  submitted:=private.submit_eval_work_v1_v5_impl(p_work_id,p_actor_username,p_expected_version,internal_inquiry,p_evidence,p_submission_token);
  update public.ph_eval_work w set submission_request_fingerprint=fingerprint
  where w.id=submitted.id returning * into submitted;
  return private.finalize_eval_work_editable_fields_v7(submitted.id,submitted,internal_inquiry,prepared);
end
$function$;
revoke all on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) to service_role;

create or replace function public.submit_eval_work_v2(
  p_work_id uuid,p_actor_username text,p_expected_version integer,
  p_inquiry jsonb,p_evidence_by_origin jsonb,p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  inquiry_value jsonb;
  internal_inquiry jsonb;
  origin_ids text[];
  current_rows jsonb;
  prepared jsonb;
  fingerprint text;
begin
  actor:=private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id=p_work_id for update;
  if work.id is null or work.contract_version<>'eval-work-v2-multi-origin'
     or not (lower(actor.username)=any(coalesce(work.assignee_usernames,array[lower(work.assignee_username)]))) then
    raise exception using errcode='42501',message='eval_work_submit_forbidden';
  end if;
  inquiry_value:=coalesce(p_inquiry,work.inquiry_draft);
  if coalesce(inquiry_value->>'workflowPolicyVersion','')<>'reclass-action-workflow-v7-editable-fields-20261009' then
    return private.submit_eval_work_v2_v6_impl(p_work_id,p_actor_username,p_expected_version,p_inquiry,p_evidence_by_origin,p_submission_token);
  end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('inquiry',inquiry_value,'evidenceByOrigin',p_evidence_by_origin)::text,'UTF8'),'sha256'),'hex');
  if work.status='submitted' and work.submission_token=trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode='P0001',message='eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if work.status not in ('open','in_progress') or work.version<>p_expected_version then
    raise exception using errcode='40001',message='eval_work_version_conflict';
  end if;
  internal_inquiry:=inquiry_value||jsonb_build_object('sourceContext',jsonb_build_object('sourceMode','eval-work'));
  perform private.lock_ph_master_inventory_for_live_edit_v6();
  if coalesce(work.source_context->>'scopeContract','')='itemcode-all-rows-v1' then
    current_rows:=private.eval_work_assert_itemcode_membership_v1(p_work_id);
  else
    select array_agg(origin_unique_id order by ordinal) into origin_ids
    from public.ph_eval_work_origin_rows where eval_work_id=work.id;
    current_rows:=private.eval_work_context_rows_for_origins_v2(origin_ids);
  end if;
  perform private.validate_eval_work_inquiry_v1(internal_inquiry,work.itemcode,current_rows);
  prepared:=private.prepare_reclass_editable_fields_v7(internal_inquiry,actor.username);
  submitted:=private.submit_eval_work_v2_v5_impl(p_work_id,p_actor_username,p_expected_version,
    internal_inquiry,p_evidence_by_origin,p_submission_token);
  update public.ph_eval_work w set submission_request_fingerprint=fingerprint
  where w.id=submitted.id returning * into submitted;
  return private.finalize_eval_work_editable_fields_v7(submitted.id,submitted,internal_inquiry,prepared);
end
$function$;
revoke all on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) to service_role;


create or replace function private.ph_master_inventory_stable_identity_v7(p_row jsonb)
returns text
language sql immutable security definer set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_array(
    coalesce(p_row->>'warehouseid',p_row->>'warehousei',''),
    coalesce(p_row->>'itemcode',''),
    coalesce(p_row->>'contsize',''),
    coalesce(p_row->>'locationcode',''),
    coalesce(p_row->>'lotcode',''),
    coalesce(p_row->>'source','')
  )::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function private.ph_master_inventory_stable_identity_v7(jsonb) from public, anon, authenticated, service_role;

create table if not exists app_sync_private.ph_master_inventory_item6_source_v7 (
  canonical_unique_id text primary key,
  stable_identity_key text not null,
  field_values jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default clock_timestamp(),
  import_run_id uuid
);
create index if not exists ph_master_inventory_item6_source_stable_v7_idx
  on app_sync_private.ph_master_inventory_item6_source_v7(stable_identity_key,canonical_unique_id);
alter table app_sync_private.ph_master_inventory_item6_source_v7 enable row level security;
revoke all on app_sync_private.ph_master_inventory_item6_source_v7 from public,anon,authenticated,service_role;

create table if not exists app_sync_private.ph_master_inventory_item6_edits_v7 (
  canonical_unique_id text not null,
  field_name text not null check(field_name in (
    'locationnote','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend'
  )),
  stable_identity_key text not null,
  source_value text,
  app_value text,
  pending boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  revision bigint not null default 1 check(revision > 0),
  primary key(canonical_unique_id,field_name)
);
create index if not exists ph_master_inventory_item6_edits_stable_v7_idx
  on app_sync_private.ph_master_inventory_item6_edits_v7(stable_identity_key,canonical_unique_id);
alter table app_sync_private.ph_master_inventory_item6_edits_v7 enable row level security;
revoke all on app_sync_private.ph_master_inventory_item6_edits_v7 from public,anon,authenticated,service_role;

create table if not exists app_sync_private.ph_master_inventory_item6_alias_seen_v7 (
  run_id uuid not null,
  canonical_unique_id text not null,
  imported_unique_id text not null,
  stable_identity_key text not null,
  seen_at timestamptz not null default clock_timestamp(),
  primary key(run_id,canonical_unique_id)
);
alter table app_sync_private.ph_master_inventory_item6_alias_seen_v7 enable row level security;
revoke all on app_sync_private.ph_master_inventory_item6_alias_seen_v7 from public,anon,authenticated,service_role;
create index if not exists ph_master_inventory_item6_alias_seen_expiry_v7_idx
  on app_sync_private.ph_master_inventory_item6_alias_seen_v7(seen_at);

-- Persist UIDs observed for each fixed physical tuple. Once a designation
-- edit is acknowledged, future keyer UIDs still resolve to the same row.
create table if not exists app_sync_private.ph_master_inventory_item6_aliases_v7 (
  imported_unique_id text primary key,
  canonical_unique_id text not null,
  stable_identity_key text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists ph_master_inventory_item6_aliases_canonical_v7_idx
  on app_sync_private.ph_master_inventory_item6_aliases_v7(canonical_unique_id,stable_identity_key);
alter table app_sync_private.ph_master_inventory_item6_aliases_v7 enable row level security;
revoke all on app_sync_private.ph_master_inventory_item6_aliases_v7 from public,anon,authenticated,service_role;
insert into app_sync_private.ph_master_inventory_item6_aliases_v7(imported_unique_id,canonical_unique_id,stable_identity_key)
select m.unique_id,m.unique_id,private.ph_master_inventory_stable_identity_v7(to_jsonb(m))
from public.ph_master_inventory m on conflict(imported_unique_id) do nothing;

insert into app_sync_private.ph_master_inventory_item6_source_v7(
  canonical_unique_id,stable_identity_key,field_values
)
select m.unique_id,private.ph_master_inventory_stable_identity_v7(to_jsonb(m)),
  jsonb_build_object(
    'locationnote',m.locationnote,'locationptn1',m.locationptn1,
    'desigitem',m.desigitem,'desigcust',m.desigcust,'desigloc',m.desigloc,
    'pullerresponsibility',m.pullerresponsibility,'oversellpercentage',m.oversellpercentage,
    'salesnote',m.salesnote,'suspend',m.suspend
  )
from public.ph_master_inventory m
on conflict(canonical_unique_id) do nothing;

create or replace function private.ph_master_inventory_item6_import_mask_v7()
returns text[]
language plpgsql stable security definer set search_path = ''
as $function$
declare
  headers jsonb;
  raw_mask text;
  mask_json jsonb;
  result text[] := '{}'::text[];
  item jsonb;
  allowed constant text[] := array[
    'locationnote','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend'
  ];
begin
  begin
    headers := nullif(current_setting('request.headers',true),'')::jsonb;
    raw_mask := headers->>'x-gnc-master-item6-fields';
    if raw_mask is null then return result; end if;
    mask_json := raw_mask::jsonb;
  exception when others then
    return result;
  end;
  if jsonb_typeof(mask_json) <> 'array' then return result; end if;
  for item in select value from jsonb_array_elements(mask_json) loop
    if jsonb_typeof(item) <> 'string' or not ((item#>>'{}')=any(allowed))
       or (item#>>'{}')=any(result) then
      return '{}'::text[];
    end if;
    result := array_append(result,item#>>'{}');
  end loop;
  return result;
end
$function$;
revoke all on function private.ph_master_inventory_item6_import_mask_v7() from public,anon,authenticated,service_role;

create or replace function private.resolve_ph_master_inventory_item6_alias_v7()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_run_id uuid;
  canonical_run boolean := false;
  stable_key text;
  v6_key text;
  candidate_uid text;
  candidates integer;
  pending_candidates integer;
  incoming jsonb;
  baseline app_sync_private.ph_master_inventory_item6_source_v7;
  live public.ph_master_inventory;
  seen app_sync_private.ph_master_inventory_item6_alias_seen_v7;
  v_field_name text;
  incoming_value text;
  baseline_value text;
  live_value text;
  target_value text;
  mapped_uid text;
begin
  v_run_id := private.ph_master_inventory_import_run_v1();
  if v_run_id is null then return new; end if;
  select 'ph_master_inventory'=any(r.canonical_keys) into canonical_run
  from app_sync_private.import_runs r where r.id=v_run_id;
  if not canonical_run then
    return new;
  end if;

  v6_key := private.ph_master_inventory_lineage_key_v1(to_jsonb(new));
  if exists(select 1 from app_sync_private.ph_master_inventory_source_baselines b
    join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
    where b.lineage_key=v6_key) then
    return new;
  end if;

  stable_key := private.ph_master_inventory_stable_identity_v7(to_jsonb(new));
  perform pg_advisory_xact_lock(hashtextextended('ph-master-item6:'||stable_key,0));
  select a.canonical_unique_id into mapped_uid
  from app_sync_private.ph_master_inventory_item6_aliases_v7 a
  where a.imported_unique_id=new.unique_id and a.stable_identity_key=stable_key;
  if mapped_uid is not null and mapped_uid is distinct from new.unique_id then
    select m.* into live from public.ph_master_inventory m where m.unique_id=mapped_uid for update;
    if live.unique_id is null then raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_CONFLICT'; end if;
    select * into seen from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
    where s.run_id=v_run_id and s.canonical_unique_id=mapped_uid;
    if seen.run_id is not null and seen.imported_unique_id is distinct from new.unique_id then
      raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
    end if;
    insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(run_id,canonical_unique_id,imported_unique_id,stable_identity_key)
    values(v_run_id,mapped_uid,new.unique_id,stable_key)
    on conflict(run_id,canonical_unique_id) do update set seen_at=clock_timestamp()
    where app_sync_private.ph_master_inventory_item6_alias_seen_v7.imported_unique_id=excluded.imported_unique_id;
    if not found then raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
    new.unique_id:=mapped_uid;
    return new;
  end if;
  -- Record exact canonical IDs too. If a later spreadsheet row presents a
  -- second UID for this same physical tuple in one run, the alias is ambiguous.
  if exists(select 1 from public.ph_master_inventory m where m.unique_id=new.unique_id) then
    select * into live from public.ph_master_inventory m where m.unique_id=new.unique_id for update;
    if exists(select 1
      from app_sync_private.ph_master_inventory_item6_source_v7 b
      join app_sync_private.ph_master_inventory_item6_edits_v7 e on e.canonical_unique_id=b.canonical_unique_id
      join public.ph_master_inventory protected on protected.unique_id=b.canonical_unique_id
      where b.stable_identity_key=stable_key and b.canonical_unique_id<>live.unique_id
        and e.pending and e.field_name in ('desigitem','desigcust','desigloc')) then
      raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
    end if;
    if exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
      where e.canonical_unique_id=live.unique_id and e.pending
        and e.field_name in ('desigitem','desigcust','desigloc')) then
      select * into seen from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
      where s.run_id=v_run_id and s.canonical_unique_id=live.unique_id;
      if seen.run_id is not null and seen.imported_unique_id is distinct from new.unique_id then
        raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
      end if;
      insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(
        run_id,canonical_unique_id,imported_unique_id,stable_identity_key
      ) values(v_run_id,live.unique_id,new.unique_id,stable_key)
      on conflict(run_id,canonical_unique_id) do update set seen_at=clock_timestamp()
      where app_sync_private.ph_master_inventory_item6_alias_seen_v7.imported_unique_id=excluded.imported_unique_id;
      if not found then raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
    end if;
    return new;
  end if;
  -- The stable tuple deliberately excludes the editable designations. Count
  -- every live row with that tuple before considering pending shields; a
  -- single shielded candidate is not enough proof when another row collides.
  select count(distinct b.canonical_unique_id)::integer into candidates
  from app_sync_private.ph_master_inventory_item6_source_v7 b
  join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
  where b.stable_identity_key=stable_key;
  if candidates>1 then
    raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
  end if;
  select count(distinct b.canonical_unique_id)::integer into pending_candidates
  from app_sync_private.ph_master_inventory_item6_source_v7 b
  join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
  where b.stable_identity_key=stable_key
    and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
      where e.canonical_unique_id=b.canonical_unique_id and e.pending
        and e.field_name in ('desigitem','desigcust','desigloc'));
  if pending_candidates=0 then return new; end if;
  if pending_candidates>1 then
    raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
  end if;
  select b.* into baseline
  from app_sync_private.ph_master_inventory_item6_source_v7 b
  where b.stable_identity_key=stable_key
    and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
      where e.canonical_unique_id=b.canonical_unique_id and e.pending
        and e.field_name in ('desigitem','desigcust','desigloc'))
  limit 1;
  select m.* into live
  from public.ph_master_inventory m
  where m.unique_id=baseline.canonical_unique_id
  limit 1 for update;
  candidate_uid := live.unique_id;
  incoming := to_jsonb(new);
  foreach v_field_name in array array['desigitem','desigcust','desigloc'] loop
    incoming_value := nullif(incoming->>v_field_name,'');
    baseline_value := nullif(baseline.field_values->>v_field_name,'');
    case v_field_name
      when 'desigitem' then live_value := nullif(live.desigitem,'');
      when 'desigcust' then live_value := nullif(live.desigcust,'');
      else live_value := nullif(live.desigloc,'');
    end case;
    select nullif(e.app_value,'') into target_value
    from app_sync_private.ph_master_inventory_item6_edits_v7 e
    where e.canonical_unique_id=candidate_uid and e.field_name=v_field_name and e.pending;
    if incoming_value is distinct from baseline_value
       and incoming_value is distinct from live_value
       and incoming_value is distinct from target_value then
      raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_CONFLICT';
    end if;
  end loop;

  select * into seen from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
  where s.run_id=v_run_id and s.canonical_unique_id=candidate_uid;
  if seen.run_id is not null and seen.imported_unique_id is distinct from new.unique_id then
    raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
  end if;
  delete from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
  where s.seen_at < clock_timestamp()-interval '3 days';
  insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(
    run_id,canonical_unique_id,imported_unique_id,stable_identity_key
  ) values(v_run_id,candidate_uid,new.unique_id,stable_key)
  on conflict(run_id,canonical_unique_id) do update set seen_at=clock_timestamp()
  where app_sync_private.ph_master_inventory_item6_alias_seen_v7.imported_unique_id=excluded.imported_unique_id;
  if not found then
    raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
  end if;
  insert into app_sync_private.ph_master_inventory_item6_aliases_v7(imported_unique_id,canonical_unique_id,stable_identity_key)
  values(new.unique_id,candidate_uid,stable_key)
  on conflict(imported_unique_id) do update set canonical_unique_id=excluded.canonical_unique_id,
    stable_identity_key=excluded.stable_identity_key
  where app_sync_private.ph_master_inventory_item6_aliases_v7.canonical_unique_id=excluded.canonical_unique_id
    and app_sync_private.ph_master_inventory_item6_aliases_v7.stable_identity_key=excluded.stable_identity_key;
  if not found then raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
  new.unique_id := candidate_uid;
  return new;
end
$function$;
revoke all on function private.resolve_ph_master_inventory_item6_alias_v7() from public,anon,authenticated,service_role;

create or replace function private.guard_ph_master_inventory_item6_fields_v7()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_run_id uuid;
  canonical_run boolean := false;
  mask text[] := '{}'::text[];
  raw_values jsonb;
  old_values jsonb;
  new_values jsonb;
  source_values jsonb;
  base_row app_sync_private.ph_master_inventory_item6_source_v7;
  edit_row app_sync_private.ph_master_inventory_item6_edits_v7;
  v_field_name text;
  raw_value text;
  old_value text;
  source_value text;
  app_value text;
  stable_key text;
  alias_row app_sync_private.ph_master_inventory_item6_alias_seen_v7;
  alias_import boolean := false;
  new_blocking_hold boolean := false;
  pending_any boolean := false;
  pending_marker text;
begin
  if tg_op='DELETE' then
    delete from app_sync_private.ph_master_inventory_item6_edits_v7 where canonical_unique_id=old.unique_id;
    delete from app_sync_private.ph_master_inventory_item6_source_v7 where canonical_unique_id=old.unique_id;
    delete from app_sync_private.ph_master_inventory_item6_aliases_v7 where canonical_unique_id=old.unique_id;
    return old;
  end if;
  v_run_id := private.ph_master_inventory_import_run_v1();
  if tg_op='UPDATE' then
    old_values := to_jsonb(old);
    new_values := to_jsonb(new);
  else
    old_values := '{}'::jsonb;
    new_values := to_jsonb(new);
  end if;
  raw_values := new_values;
  stable_key := private.ph_master_inventory_stable_identity_v7(new_values);
  perform pg_advisory_xact_lock(hashtextextended('ph-master-item6:'||stable_key,0));
  if v_run_id is not null then
    select 'ph_master_inventory'=any(r.canonical_keys) into canonical_run
    from app_sync_private.import_runs r where r.id=v_run_id;
    if canonical_run then mask := private.ph_master_inventory_item6_import_mask_v7(); end if;
    select * into alias_row from app_sync_private.ph_master_inventory_item6_alias_seen_v7 a
    where a.run_id=v_run_id and a.canonical_unique_id=new.unique_id;
    alias_import := alias_row.run_id is not null and alias_row.imported_unique_id is distinct from new.unique_id;
  end if;
  select * into base_row from app_sync_private.ph_master_inventory_item6_source_v7 b
  where b.canonical_unique_id=new.unique_id for update;
  source_values := coalesce(base_row.field_values,'{}'::jsonb);

  if tg_op='UPDATE' and v_run_id is not null and not canonical_run then
    -- Auxiliary fenced master writes cannot acknowledge or change Drive-owned
    -- Item6 values.
    foreach v_field_name in array array[
      'locationnote','locationptn1','desigitem','desigcust','desigloc',
      'pullerresponsibility','oversellpercentage','salesnote','suspend'
    ] loop
      new_values := jsonb_set(new_values,array[v_field_name],coalesce(old_values->v_field_name,'null'::jsonb),true);
    end loop;
  elsif tg_op='UPDATE' and v_run_id is not null and canonical_run then
    foreach v_field_name in array array[
      'locationnote','locationptn1','desigitem','desigcust','desigloc',
      'pullerresponsibility','oversellpercentage','salesnote','suspend'
    ] loop
      raw_value := nullif(raw_values->>v_field_name,'');
      old_value := nullif(old_values->>v_field_name,'');
      if not (v_field_name=any(mask)) then
        new_values := jsonb_set(new_values,array[v_field_name],coalesce(old_values->v_field_name,'null'::jsonb),true);
      else
        select * into edit_row from app_sync_private.ph_master_inventory_item6_edits_v7 e
        where e.canonical_unique_id=new.unique_id and e.field_name=v_field_name for update;
        source_values := jsonb_set(source_values,array[v_field_name],coalesce(to_jsonb(raw_value),'null'::jsonb),true);
        if edit_row.pending then
          if raw_value is not distinct from nullif(edit_row.app_value,'') then
            delete from app_sync_private.ph_master_inventory_item6_edits_v7 e
            where e.canonical_unique_id=new.unique_id and e.field_name=v_field_name;
          else
            update app_sync_private.ph_master_inventory_item6_edits_v7 e set
              source_value=raw_value,stable_identity_key=stable_key,
              revision=e.revision+1,updated_at=clock_timestamp()
            where e.canonical_unique_id=new.unique_id and e.field_name=v_field_name;
            new_values := jsonb_set(new_values,array[v_field_name],coalesce(old_values->v_field_name,'null'::jsonb),true);
          end if;
        end if;
      end if;
    end loop;
    insert into app_sync_private.ph_master_inventory_item6_source_v7(
      canonical_unique_id,stable_identity_key,field_values,imported_at,import_run_id
    ) values(new.unique_id,stable_key,source_values,clock_timestamp(),v_run_id)
    on conflict(canonical_unique_id) do update set
      stable_identity_key=excluded.stable_identity_key,field_values=excluded.field_values,
      imported_at=excluded.imported_at,import_run_id=excluded.import_run_id;
  elsif tg_op='UPDATE' then
    foreach v_field_name in array array[
      'locationnote','locationptn1','desigitem','desigcust','desigloc',
      'pullerresponsibility','oversellpercentage','salesnote','suspend'
    ] loop
      old_value := nullif(old_values->>v_field_name,'');
      raw_value := nullif(raw_values->>v_field_name,'');
      if old_value is distinct from raw_value then
        source_value := nullif(source_values->>v_field_name,'');
        if source_values ? v_field_name then
          source_value := nullif(source_values->>v_field_name,'');
        else
          source_value := old_value;
          source_values := jsonb_set(source_values,array[v_field_name],coalesce(to_jsonb(source_value),'null'::jsonb),true);
        end if;
        if source_value is not distinct from raw_value then
          delete from app_sync_private.ph_master_inventory_item6_edits_v7 e
          where e.canonical_unique_id=old.unique_id and e.field_name=v_field_name;
        else
          insert into app_sync_private.ph_master_inventory_item6_edits_v7(
            canonical_unique_id,field_name,stable_identity_key,source_value,app_value,pending
          ) values(old.unique_id,v_field_name,stable_key,source_value,raw_value,true)
          on conflict(canonical_unique_id,field_name) do update set
            stable_identity_key=excluded.stable_identity_key,
            source_value=coalesce(app_sync_private.ph_master_inventory_item6_edits_v7.source_value,excluded.source_value),
            app_value=excluded.app_value,pending=true,
            revision=app_sync_private.ph_master_inventory_item6_edits_v7.revision+1,
            updated_at=clock_timestamp();
          pending_any := true;
        end if;
      end if;
    end loop;
    if pending_any then
      new.concat := 'smart-shield-item6-pending:' || encode(extensions.digest(
        convert_to(new.unique_id||':'||stable_key||':'||clock_timestamp()::text,'UTF8'),'sha256'),'hex');
    end if;
  elsif tg_op='INSERT' then
    insert into app_sync_private.ph_master_inventory_item6_source_v7(
      canonical_unique_id,stable_identity_key,field_values,imported_at,import_run_id
    ) values(new.unique_id,stable_key,jsonb_build_object(
      'locationnote',new.locationnote,'locationptn1',new.locationptn1,
      'desigitem',new.desigitem,'desigcust',new.desigcust,'desigloc',new.desigloc,
      'pullerresponsibility',new.pullerresponsibility,'oversellpercentage',new.oversellpercentage,
      'salesnote',new.salesnote,'suspend',new.suspend
    ),clock_timestamp(),v_run_id)
    on conflict(canonical_unique_id) do nothing;
  end if;

  if alias_import then
    new_blocking_hold := coalesce(old.holdstopcode,'') !~* '[HS]'
      and coalesce(new.holdstopcode,'') ~* '[HS]';
    if new_blocking_hold then
      new.date_completed := null; new.av_note := null; new.sales_note := null;
      new.match := null; new.spec := null; new.caliper := null; new.pic_note := null;
      new.loc_match_qty := null; new.initial_ptr := null; new.photo_link := null; new.photo_name := null;
    else
      if nullif(nullif(btrim(old.date_completed::text),''),'NULL') is not null then new.date_completed:=old.date_completed; end if;
      if nullif(nullif(btrim(old.app_tab_assignment::text),''),'NULL') is not null then new.app_tab_assignment:=old.app_tab_assignment; end if;
      if nullif(nullif(btrim(old.av_note::text),''),'NULL') is not null then new.av_note:=old.av_note; end if;
      if nullif(nullif(btrim(old.sales_note::text),''),'NULL') is not null then new.sales_note:=old.sales_note; end if;
      if nullif(nullif(btrim(old.match::text),''),'NULL') is not null then new.match:=old.match; end if;
      if nullif(nullif(btrim(old.spec::text),''),'NULL') is not null then new.spec:=old.spec; end if;
      if nullif(nullif(btrim(old.caliper::text),''),'NULL') is not null then new.caliper:=old.caliper; end if;
      if nullif(nullif(btrim(old.pic_note::text),''),'NULL') is not null then new.pic_note:=old.pic_note; end if;
      if nullif(nullif(btrim(old.loc_match_qty::text),''),'NULL') is not null then new.loc_match_qty:=old.loc_match_qty; end if;
      if nullif(nullif(btrim(old.initial_ptr::text),''),'NULL') is not null then new.initial_ptr:=old.initial_ptr; end if;
      if nullif(nullif(btrim(old.photo_link::text),''),'NULL') is not null then new.photo_link:=old.photo_link; end if;
      if nullif(nullif(btrim(old.photo_name::text),''),'NULL') is not null then new.photo_name:=old.photo_name; end if;
      if nullif(nullif(btrim(new.assignedto::text),''),'NULL') is null
         and nullif(nullif(btrim(old.assignedto::text),''),'NULL') is not null then new.assignedto:=old.assignedto; end if;
    end if;
  end if;

  new.locationnote := new_values->>'locationnote';
  new.locationptn1 := new_values->>'locationptn1';
  new.desigitem := new_values->>'desigitem';
  new.desigcust := new_values->>'desigcust';
  new.desigloc := new_values->>'desigloc';
  new.pullerresponsibility := new_values->>'pullerresponsibility';
  new.oversellpercentage := new_values->>'oversellpercentage';
  new.salesnote := new_values->>'salesnote';
  new.suspend := new_values->>'suspend';

  if tg_op='UPDATE' and v_run_id is not null and canonical_run then
    select exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
      where e.canonical_unique_id=new.unique_id and e.pending) into pending_any;
    if pending_any then
      new.concat := 'smart-shield-item6-pending:' || encode(extensions.digest(
        convert_to(new.unique_id||':'||stable_key||':'||clock_timestamp()::text,'UTF8'),'sha256'),'hex');
    end if;
  end if;
  return new;
end
$function$;
revoke all on function private.guard_ph_master_inventory_item6_fields_v7() from public,anon,authenticated,service_role;

create or replace function private.refresh_ph_master_inventory_item6_lineage_v7()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_run_id uuid;
  values_json jsonb;
  stable_key text;
begin
  v_run_id := private.ph_master_inventory_import_run_v1();
  stable_key := private.ph_master_inventory_stable_identity_v7(to_jsonb(new));
  if tg_op='INSERT' then
    insert into app_sync_private.ph_master_inventory_item6_source_v7(
      canonical_unique_id,stable_identity_key,field_values,imported_at,import_run_id
    ) values(new.unique_id,stable_key,jsonb_build_object(
      'locationnote',new.locationnote,'locationptn1',new.locationptn1,
      'desigitem',new.desigitem,'desigcust',new.desigcust,'desigloc',new.desigloc,
      'pullerresponsibility',new.pullerresponsibility,'oversellpercentage',new.oversellpercentage,
      'salesnote',new.salesnote,'suspend',new.suspend
    ),clock_timestamp(),v_run_id)
    on conflict(canonical_unique_id) do nothing;
  elsif tg_op='UPDATE' then
    update app_sync_private.ph_master_inventory_app_edits s set
      lineage_key=private.ph_master_inventory_lineage_key_v1(to_jsonb(new))
    where s.canonical_unique_id=new.unique_id;
    if v_run_id is not null then
      if exists(select 1 from app_sync_private.ph_master_inventory_import_lineage_seen s
        where s.run_id=v_run_id and s.canonical_unique_id=new.unique_id
          and s.imported_unique_id is distinct from new.unique_id) then
        insert into app_sync_private.ph_master_inventory_item6_aliases_v7(
          imported_unique_id,canonical_unique_id,stable_identity_key
        )
        select s.imported_unique_id,new.unique_id,stable_key
        from app_sync_private.ph_master_inventory_import_lineage_seen s
        where s.run_id=v_run_id and s.canonical_unique_id=new.unique_id
          and s.imported_unique_id is distinct from new.unique_id
        on conflict(imported_unique_id) do update set
          canonical_unique_id=excluded.canonical_unique_id,stable_identity_key=excluded.stable_identity_key
        where app_sync_private.ph_master_inventory_item6_aliases_v7.canonical_unique_id=excluded.canonical_unique_id;
        if not found then raise exception using errcode='40001',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
      end if;
    end if;
  end if;
  return null;
end
$function$;
revoke all on function private.refresh_ph_master_inventory_item6_lineage_v7() from public,anon,authenticated,service_role;

drop trigger if exists aa0_ph_master_inventory_item6_alias_v7 on public.ph_master_inventory;
create trigger aa0_ph_master_inventory_item6_alias_v7
before insert on public.ph_master_inventory for each row
execute function private.resolve_ph_master_inventory_item6_alias_v7();
drop trigger if exists aab_ph_master_inventory_item6_guard_v7 on public.ph_master_inventory;
create trigger aab_ph_master_inventory_item6_guard_v7
before update or delete on public.ph_master_inventory for each row
execute function private.guard_ph_master_inventory_item6_fields_v7();
drop trigger if exists zzz_ph_master_inventory_item6_lineage_v7 on public.ph_master_inventory;
create trigger zzz_ph_master_inventory_item6_lineage_v7
after insert or update on public.ph_master_inventory for each row
execute function private.refresh_ph_master_inventory_item6_lineage_v7();

commit;
