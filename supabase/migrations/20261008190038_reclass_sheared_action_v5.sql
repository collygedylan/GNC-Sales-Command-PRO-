begin;

-- V5 adds a request-only Sheared instruction. V3/V4 contracts remain intact;
-- ordinary row actions continue through the V4 projection and validator.
create or replace function private.project_reclass_sheared_v5(p_payload jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  row_overlay jsonb;
  proposal jsonb;
  projected_rows jsonb := '[]'::jsonb;
  projected_proposals jsonb;
  action_name text;
  quantity numeric;
  quantity_text text;
  has_sheared boolean := false;
  seen_actions text[];
  requested_actions text[];
  canonical_actions text[];
begin
  if jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'workflowPolicyVersion' <> 'reclass-action-workflow-v5-sheared-20261008'
     or jsonb_typeof(coalesce(p_payload->'transaction','null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'rowOverlays','null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload #> '{transaction,requestActions}','null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_SHAPE_INVALID';
  end if;

  select array_agg(value order by ordinality)
  into requested_actions
  from jsonb_array_elements_text(p_payload #> '{transaction,requestActions}') with ordinality a(value,ordinality);
  if coalesce(cardinality(requested_actions),0) = 0
     or (select count(*) from unnest(requested_actions)) <> (select count(distinct value) from unnest(requested_actions) a(value))
     or exists(select 1 from unnest(requested_actions) a(value)
       where value not in ('hold','take_off_hold','stop_ship','off_stop_ship','recount','priority_change','move_up','move_down','sheared')) then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ACTIONS_INVALID';
  end if;
  select array_agg(value order by array_position(
    array['hold','take_off_hold','stop_ship','off_stop_ship','recount','priority_change','move_up','move_down','sheared']::text[],value))
  into canonical_actions from unnest(requested_actions) a(value);
  if requested_actions is distinct from canonical_actions then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ACTIONS_INVALID';
  end if;

  for row_overlay in select value from jsonb_array_elements(p_payload->'rowOverlays') loop
    if jsonb_typeof(row_overlay) <> 'object' then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ROW_INVALID';
    end if;
    if exists(select 1 from jsonb_object_keys(row_overlay) as keys(key)
      where key not in ('unique_id','expected','proposals','temporaryValues','temporaryChangedFields','resolution')) then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ROW_INVALID';
    end if;
    if nullif(btrim(coalesce(row_overlay->>'unique_id','')),'') is null
       or jsonb_typeof(coalesce(row_overlay->'expected','null'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(row_overlay->'proposals','null'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ROW_INVALID';
    end if;
    if exists(select 1 from jsonb_object_keys(row_overlay->'expected') as keys(key)
      where key not in ('itemcode','lotcode','locationcode','ptronhand','desigitem')) then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_EXPECTED_FIELDS_INVALID';
    end if;
    projected_proposals := '[]'::jsonb;
    seen_actions := '{}'::text[];
    for proposal in select value from jsonb_array_elements(row_overlay->'proposals') loop
      if jsonb_typeof(proposal) <> 'object' then
        raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_PROPOSAL_INVALID';
      end if;
      action_name := lower(btrim(coalesce(proposal->>'action','')));
      if action_name = 'sheared' then
        if action_name = any(seen_actions)
           or (select count(*) from jsonb_object_keys(proposal)) <> 2
           or not (proposal ?& array['action','quantity'])
           or jsonb_typeof(proposal->'quantity') <> 'number' then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_SHEARED_FIELDS_INVALID';
        end if;
        seen_actions := array_append(seen_actions,action_name);
        quantity_text := proposal->>'quantity';
        if quantity_text !~ '^[0-9]{1,10}$' then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_SHEARED_QUANTITY_INVALID';
        end if;
        quantity := quantity_text::numeric;
        if quantity < 1 or quantity > 2147483647 or quantity <> trunc(quantity) then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_SHEARED_QUANTITY_INVALID';
        end if;
        has_sheared := true;
        projected_proposals := projected_proposals || jsonb_build_array(jsonb_build_object(
          'action','sheared','quantity',quantity,'desigitem',quantity_text || '-->#'
        ));
      else
        if action_name = '' or action_name = any(seen_actions) then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_DUPLICATE_OR_EMPTY_ACTION';
        end if;
        seen_actions := array_append(seen_actions,action_name);
        projected_proposals := projected_proposals || jsonb_build_array(proposal);
      end if;
    end loop;
    projected_rows := projected_rows || jsonb_build_array(row_overlay || jsonb_build_object('proposals',projected_proposals));
  end loop;

  if has_sheared <> ('sheared' = any(coalesce(requested_actions,'{}'::text[]))) then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ACTIONS_INVALID';
  end if;
  return p_payload || jsonb_build_object('rowOverlays',projected_rows);
end
$function$;

revoke all on function private.project_reclass_sheared_v5(jsonb) from public, anon, authenticated;
grant execute on function private.project_reclass_sheared_v5(jsonb) to service_role;

create or replace function private.validate_drive_reclass_sheared_v5(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  projected jsonb;
  compatible_payload jsonb;
  compatible_rows jsonb := '[]'::jsonb;
  compatible_actions text[];
  overlay jsonb;
  proposal jsonb;
  split_item jsonb;
  row_json jsonb;
  compatible_expected jsonb;
  compatible_proposals jsonb;
  compatible_overlay jsonb;
  expected jsonb;
  row_uid text;
  current_oh numeric;
  expected_oh numeric;
  current_oh_text text;
  expected_oh_text text;
  movement_total numeric;
  sheared_total numeric;
  row_has_sheared boolean;
begin
  projected := private.project_reclass_sheared_v5(p_payload);

  -- Build a V4-compatible view of each row. For sheared rows, validate the
  -- submitted OH/desigitem against the locked inventory row first, then use
  -- the authoritative stored OH text for the legacy V4 validator. This keeps
  -- commas or equivalent numeric formatting from causing false conflicts.
  select coalesce(array_agg(value order by ordinality) filter (where value <> 'sheared'),'{}'::text[])
  into compatible_actions
  from jsonb_array_elements_text(projected #> '{transaction,requestActions}') with ordinality a(value,ordinality);
  for overlay in select value from jsonb_array_elements(projected->'rowOverlays') loop
    compatible_proposals := '[]'::jsonb;
    row_has_sheared := false;
    sheared_total := 0;
    movement_total := 0;
    for proposal in select value from jsonb_array_elements(overlay->'proposals') loop
      if proposal->>'action' = 'sheared' then
        row_has_sheared := true;
        sheared_total := sheared_total + (proposal->>'quantity')::numeric;
      else
        compatible_proposals := compatible_proposals || jsonb_build_array(proposal);
        if proposal->>'action' in ('move_up','move_down') then
          for split_item in select value from jsonb_array_elements(coalesce(proposal->'splits','[]'::jsonb)) loop
            movement_total := movement_total + (split_item->>'quantity')::numeric;
          end loop;
        end if;
      end if;
    end loop;
    expected := overlay->'expected';
    if row_has_sheared then
      row_uid := btrim(coalesce(overlay->>'unique_id',''));
      if nullif(btrim(coalesce(expected->>'itemcode','')),'') is null
         or nullif(btrim(coalesce(expected->>'lotcode','')),'') is null
         or nullif(btrim(coalesce(expected->>'locationcode','')),'') is null
         or nullif(expected->>'ptronhand','') is null
         or not (expected ? 'desigitem') then
        raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_EXPECTED_IDENTITY_REQUIRED';
      end if;
      select to_jsonb(m) into row_json
      from public.ph_master_inventory m
      where btrim(coalesce(m.unique_id,'')) = row_uid
      for share;
      if row_json is null then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V5_SOURCE_ROW_MISSING';
      end if;
      if upper(btrim(coalesce(row_json->>'itemcode',''))) <> upper(btrim(expected->>'itemcode'))
         or upper(btrim(coalesce(row_json->>'lotcode',''))) <> upper(btrim(expected->>'lotcode'))
         or upper(btrim(coalesce(row_json->>'locationcode',''))) <> upper(btrim(expected->>'locationcode')) then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V5_SOURCE_ROW_CHANGED';
      end if;
      current_oh_text := nullif(replace(btrim(coalesce(row_json->>'ptronhand','')),',',''),'');
      expected_oh_text := nullif(replace(btrim(coalesce(expected->>'ptronhand','')),',',''),'');
      if current_oh_text is null or expected_oh_text is null
         or current_oh_text !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
         or expected_oh_text !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then
        current_oh := null;
        expected_oh := null;
      else
        begin
          current_oh := current_oh_text::numeric;
          expected_oh := expected_oh_text::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          current_oh := null;
          expected_oh := null;
        end;
      end if;
      if current_oh is null or expected_oh is null or expected_oh < 0 then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT';
      end if;
      if current_oh < 1 then
        raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ORIGINAL_OH_INVALID';
      end if;
      if current_oh <> expected_oh
         or coalesce(row_json->>'desigitem','') <> coalesce(expected->>'desigitem','') then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT';
      end if;
      if sheared_total + movement_total > current_oh then
        raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_QUANTITY_EXCEEDS_OH';
      end if;
      compatible_expected := (expected - 'desigitem') || jsonb_build_object('ptronhand',row_json->>'ptronhand');
    else
      compatible_expected := expected;
    end if;
    compatible_overlay := (overlay - 'proposals') || jsonb_build_object('expected',compatible_expected,'proposals',compatible_proposals);
    compatible_rows := compatible_rows || jsonb_build_array(compatible_overlay);
  end loop;
  compatible_payload := projected || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v4-split-moves-20261006',
    'transaction',(projected->'transaction') || jsonb_build_object('requestActions',to_jsonb(compatible_actions)),
    'rowOverlays',compatible_rows
  );
  -- This also validates all selected rows and the source-itemcode boundary
  -- for shear-only envelopes (where the V4 action set is intentionally empty).
  perform private.validate_drive_reclass_split_move_v4(compatible_payload);

end
$function$;

revoke all on function private.validate_drive_reclass_sheared_v5(jsonb) from public, anon, authenticated;
grant execute on function private.validate_drive_reclass_sheared_v5(jsonb) to service_role;

create or replace function private.validate_eval_work_inquiry_sheared_v5(
  p_inquiry jsonb, p_itemcode text, p_context_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  raw_inquiry jsonb := p_inquiry;
  projected jsonb;
  compatible_payload jsonb;
  compatible_rows jsonb := '[]'::jsonb;
  compatible_actions text[];
  overlay jsonb;
  proposal jsonb;
  split_item jsonb;
  current_row jsonb;
  expected jsonb;
  compatible_expected jsonb;
  compatible_proposals jsonb;
  compatible_overlay jsonb;
  proposal_value jsonb;
  projected_proposals jsonb;
  projected_overlay jsonb;
  projected_rows jsonb := '[]'::jsonb;
  row_uid text;
  current_oh numeric;
  expected_oh numeric;
  current_oh_text text;
  expected_oh_text text;
  movement_total numeric;
  sheared_total numeric;
begin
  -- Submitted Eval Work rows have already passed the app boundary and may
  -- contain the server-derived designation. Revalidate that exact derivation,
  -- remove it for the raw-input projector, then re-add it deterministically.
  if jsonb_typeof(coalesce(raw_inquiry,'null'::jsonb)) <> 'object'
     or raw_inquiry->>'workflowPolicyVersion' <> 'reclass-action-workflow-v5-sheared-20261008'
     or jsonb_typeof(coalesce(raw_inquiry->'rowOverlays','[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_SHAPE_INVALID';
  end if;
  for overlay in select value from jsonb_array_elements(raw_inquiry->'rowOverlays') loop
    if jsonb_typeof(overlay) <> 'object'
       or jsonb_typeof(coalesce(overlay->'proposals','[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_ROW_INVALID';
    end if;
    projected_proposals := '[]'::jsonb;
    for proposal in select value from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) loop
      proposal_value := proposal;
      if proposal->>'action' = 'sheared' and proposal ? 'desigitem' then
        if (select count(*) from jsonb_object_keys(proposal)) <> 3
           or proposal->>'desigitem' is distinct from ((proposal->>'quantity') || '-->#') then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_SHEARED_DERIVATION_INVALID';
        end if;
        proposal_value := proposal - 'desigitem';
      end if;
      projected_proposals := projected_proposals || jsonb_build_array(proposal_value);
    end loop;
    projected_overlay := (overlay - 'proposals') || jsonb_build_object('proposals',projected_proposals);
    projected_rows := projected_rows || jsonb_build_array(projected_overlay);
  end loop;
  raw_inquiry := raw_inquiry || jsonb_build_object('rowOverlays',projected_rows);
  projected := private.project_reclass_sheared_v5(raw_inquiry);
  select coalesce(array_agg(value order by ordinality) filter (where value <> 'sheared'),'{}'::text[])
  into compatible_actions
  from jsonb_array_elements_text(projected #> '{transaction,requestActions}') with ordinality a(value,ordinality);

  for overlay in select value from jsonb_array_elements(projected->'rowOverlays') loop
    row_uid := btrim(coalesce(overlay->>'unique_id',''));
    expected := overlay->'expected';
    compatible_proposals := '[]'::jsonb;
    movement_total := 0;
    sheared_total := 0;
    for proposal in select value from jsonb_array_elements(overlay->'proposals') loop
      if proposal->>'action' = 'sheared' then
        sheared_total := sheared_total + (proposal->>'quantity')::numeric;
      else
        compatible_proposals := compatible_proposals || jsonb_build_array(proposal);
        if proposal->>'action' in ('move_up','move_down') then
          for split_item in select value from jsonb_array_elements(coalesce(proposal->'splits','[]'::jsonb)) loop
            movement_total := movement_total + (split_item->>'quantity')::numeric;
          end loop;
        end if;
      end if;
    end loop;
    compatible_expected := expected;
    if sheared_total > 0 then
      if nullif(btrim(coalesce(expected->>'itemcode','')),'') is null
         or nullif(btrim(coalesce(expected->>'lotcode','')),'') is null
         or nullif(btrim(coalesce(expected->>'locationcode','')),'') is null
         or nullif(expected->>'ptronhand','') is null
         or not (expected ? 'desigitem') then
        raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_EXPECTED_IDENTITY_REQUIRED';
      end if;
      select value into current_row
      from jsonb_array_elements(coalesce(p_context_rows,'[]'::jsonb))
      where value->>'unique_id' = row_uid limit 1;
      if current_row is null then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V5_SOURCE_ROW_MISSING';
      end if;
      current_oh_text := nullif(replace(btrim(coalesce(current_row->>'ptronhand','')),',',''),'');
      expected_oh_text := nullif(replace(btrim(coalesce(expected->>'ptronhand','')),',',''),'');
      if current_oh_text is null or expected_oh_text is null
         or current_oh_text !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
         or expected_oh_text !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then
        current_oh := null;
        expected_oh := null;
      else
        begin
          current_oh := current_oh_text::numeric;
          expected_oh := expected_oh_text::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          current_oh := null;
          expected_oh := null;
        end;
      end if;
      if current_oh is null or expected_oh is null or current_oh < 1 or current_oh <> expected_oh
         or coalesce(current_row->>'desigitem','') <> coalesce(expected->>'desigitem','') then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT';
      end if;
      if sheared_total + movement_total > current_oh then
        raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_QUANTITY_EXCEEDS_OH';
      end if;
      compatible_expected := (expected - 'desigitem') || jsonb_build_object('ptronhand',current_row->>'ptronhand');
    end if;
    compatible_overlay := (overlay - 'proposals') || jsonb_build_object('expected',compatible_expected,'proposals',compatible_proposals);
    compatible_rows := compatible_rows || jsonb_build_array(compatible_overlay);
  end loop;

  compatible_payload := projected || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v4-split-moves-20261006',
    'transaction',(projected->'transaction') || jsonb_build_object('requestActions',to_jsonb(compatible_actions)),
    'rowOverlays',compatible_rows
  );
  perform private.validate_eval_work_inquiry_v4_strict(compatible_payload,p_itemcode,p_context_rows);
  return projected;
end
$function$;

revoke all on function private.validate_eval_work_inquiry_sheared_v5(jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function private.validate_eval_work_inquiry_sheared_v5(jsonb,text,jsonb) to service_role;

create or replace function private.validate_eval_work_inquiry_v1(
  p_inquiry jsonb, p_itemcode text, p_context_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare projected jsonb; overlay jsonb; current_row jsonb; uid text;
begin
  if coalesce(p_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v5-sheared-20261008' then
    perform private.validate_eval_work_inquiry_sheared_v5(p_inquiry,p_itemcode,p_context_rows);
  elsif coalesce(p_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v4-split-moves-20261006' then
    for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays','[]'::jsonb)) loop
      uid := btrim(coalesce(overlay->>'unique_id',''));
      select value into current_row from jsonb_array_elements(coalesce(p_context_rows,'[]'::jsonb))
      where value->>'unique_id' = uid limit 1;
      if current_row is null then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
      if overlay->'expected' ? 'ptronhand' and exists (
        select 1 from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) proposal
        where proposal->>'action' in ('move_up','move_down')
      ) and overlay #>> '{expected,ptronhand}' is distinct from current_row->>'ptronhand' then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
    end loop;
    projected := private.project_reclass_split_move_v4(p_inquiry,true);
    perform private.validate_eval_work_inquiry_legacy_v1(projected,p_itemcode,p_context_rows);
  else
    perform private.validate_eval_work_inquiry_legacy_v1(p_inquiry,p_itemcode,p_context_rows);
  end if;
end
$function$;
revoke all on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) to service_role;

create or replace function public.submit_eval_work_v1(
  p_work_id uuid, p_actor_username text, p_expected_version integer,
  p_inquiry jsonb, p_evidence jsonb, p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  final_inquiry jsonb;
  legacy_inquiry jsonb := p_inquiry;
  current_rows jsonb;
  fingerprint text;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or lower(work.assignee_username) <> lower(actor.username) then
    raise exception using errcode = '42501', message = 'eval_work_submit_forbidden';
  end if;
  final_inquiry := coalesce(p_inquiry,work.inquiry_draft);
  if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if coalesce(final_inquiry->>'workflowPolicyVersion','') in (
      'reclass-action-workflow-v4-split-moves-20261006','reclass-action-workflow-v5-sheared-20261008') then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
    if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
      if work.submission_request_fingerprint is distinct from fingerprint then
        raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
      end if;
      return work;
    end if;
    if work.status not in ('open','in_progress') or work.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'eval_work_version_conflict';
    end if;
    current_rows := private.eval_work_context_rows_v1(work.itemcode);
    if coalesce(final_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v5-sheared-20261008' then
      legacy_inquiry := private.validate_eval_work_inquiry_sheared_v5(final_inquiry,work.itemcode,current_rows);
    else
      perform private.validate_eval_work_inquiry_v4_strict(final_inquiry,work.itemcode,current_rows);
    end if;
  elsif work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
    return work;
  end if;
  submitted := public.submit_eval_work_legacy_v1(
    p_work_id,p_actor_username,p_expected_version,legacy_inquiry,p_evidence,p_submission_token
  );
  if fingerprint is not null then
    update public.ph_eval_work set submission_request_fingerprint = fingerprint where id = submitted.id returning * into submitted;
  end if;
  return submitted;
end
$function$;
revoke all on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) to service_role;

create or replace function public.submit_eval_work_v2(
  p_work_id uuid, p_actor_username text, p_expected_version integer,
  p_inquiry jsonb, p_evidence_by_origin jsonb, p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  final_inquiry jsonb;
  legacy_inquiry jsonb := p_inquiry;
  current_rows jsonb;
  origin_ids text[];
  fingerprint text;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or work.contract_version <> 'eval-work-v2-multi-origin'
     or not (lower(actor.username) = any(coalesce(work.assignee_usernames,array[lower(work.assignee_username)]))) then
    raise exception using errcode = '42501', message = 'eval_work_submit_forbidden';
  end if;
  final_inquiry := coalesce(p_inquiry,work.inquiry_draft);
  if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence_by_origin)::text,'UTF8'),'sha256'),'hex');
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if coalesce(final_inquiry->>'workflowPolicyVersion','') in (
      'reclass-action-workflow-v4-split-moves-20261006','reclass-action-workflow-v5-sheared-20261008') then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence_by_origin)::text,'UTF8'),'sha256'),'hex');
    if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
      if work.submission_request_fingerprint is distinct from fingerprint then
        raise exception using errcode = 'P0001', message = 'eval_work_submission_token_conflict';
      end if;
      return work;
    end if;
    if work.status not in ('open','in_progress') or work.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'eval_work_version_conflict';
    end if;
    if coalesce(work.source_context->>'scopeContract','') = 'itemcode-all-rows-v1' then
      current_rows := private.eval_work_assert_itemcode_membership_v1(p_work_id);
    else
      select array_agg(origin_unique_id order by ordinal) into origin_ids
      from public.ph_eval_work_origin_rows where eval_work_id = work.id;
      current_rows := private.eval_work_context_rows_for_origins_v2(origin_ids);
    end if;
    if coalesce(final_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v5-sheared-20261008' then
      legacy_inquiry := private.validate_eval_work_inquiry_sheared_v5(final_inquiry,work.itemcode,current_rows);
    else
      perform private.validate_eval_work_inquiry_v4_strict(final_inquiry,work.itemcode,current_rows);
    end if;
  elsif work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token,'')) then
    return work;
  end if;
  submitted := public.submit_eval_work_legacy_v2(
    p_work_id,p_actor_username,p_expected_version,legacy_inquiry,p_evidence_by_origin,p_submission_token
  );
  if fingerprint is not null then
    update public.ph_eval_work set submission_request_fingerprint = fingerprint where id = submitted.id returning * into submitted;
  end if;
  return submitted;
end
$function$;
revoke all on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) to service_role;

create or replace function public.enqueue_drive_reclass_inquiry_v5(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  legacy_envelope jsonb;
  result_value jsonb;
  event_row public.ph_request_delivery_outbox;
  actor_username text := lower(btrim(coalesce(p_payload->>'actorUsername','')));
  token text := btrim(coalesce(p_payload->>'idempotencyToken',p_payload->>'idempotency_token',''));
  event_key_value text;
  fingerprint text;
  saved_fingerprint text;
  final_payload jsonb;
  actor_profile public.profiles;
  actor_role text;
  access_scope text;
  projected jsonb;
begin
  if actor_username = '' or length(token) < 12 or length(token) > 180 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_TOKEN_INVALID';
  end if;
  projected := private.project_reclass_sheared_v5(p_payload);
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'workflowPolicyVersion',p_payload->>'workflowPolicyVersion',
    'source',p_payload->'source','transaction',p_payload->'transaction','rowOverlays',p_payload->'rowOverlays'
  )::text,'UTF8'),'sha256'),'hex');
  event_key_value := 'reclass-inquiry:' || left(encode(extensions.digest(token,'sha256'),'hex'),40);
  perform pg_advisory_xact_lock(hashtextextended(event_key_value,0));
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is not null then
    if lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}',''))) <> actor_username then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    select p.* into actor_profile from public.profiles p
    where lower(btrim(p.username))=actor_username and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password limit 1;
    if actor_profile.id is null then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PROFILE_NOT_ACTIVE';
    end if;
    actor_role := private.normalized_profile_role(actor_profile.role);
    if actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR') and actor_role not like '%EVAL%' then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_FORBIDDEN';
    end if;
    select e.access_scope into access_scope
    from private.get_effective_app_permissions_v1(actor_profile.id,private.resolve_app_access_policy_id_v1(false)) e
    where e.permission_key='drive.reclass.submit' and e.allowed limit 1;
    if access_scope is null then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PERMISSION_REQUIRED';
    end if;
    saved_fingerprint := event_row.payload #>> '{reclassPayload,protectedDelivery,requestFingerprint}';
    if event_row.payload #>> '{reclassPayload,workflowPolicyVersion}' <> 'reclass-action-workflow-v5-sheared-20261008'
       or saved_fingerprint is distinct from fingerprint then
      raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_TOKEN_CONFLICT';
    end if;
    return private.drive_reclass_delivery_result_v1(event_row) || jsonb_build_object('duplicate',true);
  end if;

  -- V1 remains the authorization/recipient/audit insertion boundary. The V5
  -- payload is restored atomically below after its V5-specific live checks.
  legacy_envelope := p_payload || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v3-row-actions-20260826',
    'actorUsername',actor_username,'idempotencyToken',token,
    'rowOverlays',projected->'rowOverlays'
  );
  result_value := public.enqueue_drive_reclass_inquiry_v1(legacy_envelope);
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is null or lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}',''))) <> actor_username then
    raise exception using errcode = '42501', message = 'DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
  end if;
  if coalesce(result_value->>'duplicate','false') = 'true' then
    raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_TOKEN_CONFLICT';
  end if;
  perform private.validate_drive_reclass_sheared_v5(p_payload);
  final_payload := jsonb_set(event_row.payload,'{reclassPayload}',
    (event_row.payload->'reclassPayload') || jsonb_build_object(
      'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
      'transaction',p_payload->'transaction','rowOverlays',projected->'rowOverlays',
      'protectedDelivery',(event_row.payload->'reclassPayload'->'protectedDelivery') || jsonb_build_object('requestFingerprint',fingerprint)
    ),false);
  if octet_length(convert_to(final_payload::text,'UTF8')) > 4 * 1024 * 1024 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V5_PAYLOAD_TOO_LARGE';
  end if;
  update public.ph_request_delivery_outbox o set payload=final_payload,updated_at=now()
  where o.event_id=event_row.event_id returning * into event_row;
  return private.drive_reclass_delivery_result_v1(event_row)
    || jsonb_build_object('duplicate',false,'unavailableUsernames',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,unavailableUsernames}','[]'::jsonb));
end
$function$;

revoke all on function public.enqueue_drive_reclass_inquiry_v5(jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_drive_reclass_inquiry_v5(jsonb) to service_role;

insert into private.app_access_legacy_checks(check_key,permission_key,enforcement_surface,notes)
values
  ('edge.drive.reclass.v5','drive.reclass.submit','edge','The app API routes V5 sheared and split-move inquiries through its authenticated service-only enqueue RPC.'),
  ('rpc.drive.reclass.v5','drive.reclass.submit','rpc','V5 validates sheared and movement allocations against locked current OH and queues only a request snapshot.')
on conflict(check_key) do update set permission_key=excluded.permission_key,enforcement_surface=excluded.enforcement_surface,notes=excluded.notes;

notify pgrst, 'reload schema';
commit;
