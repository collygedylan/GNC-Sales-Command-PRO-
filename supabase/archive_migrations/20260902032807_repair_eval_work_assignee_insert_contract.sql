begin;

-- ph_eval_work requires at least one assignee profile at INSERT time. The
-- multi-assignee wrappers used to populate these columns only after the base
-- create function returned, so the base INSERT could never satisfy the table
-- constraints. Populate the canonical, server-validated assignee arrays in
-- the base create functions themselves. The wrappers still own the delivery
-- recipient contract and idempotent retry checks.
do $block$
declare
  definition text;
  old_declarations text;
  new_declarations text;
  old_actor_block text;
  new_actor_block text;
  old_columns text;
  new_columns text;
  old_values text;
  new_values text;
begin
  select pg_get_functiondef('public.create_eval_work_batch_v2(jsonb)'::regprocedure) into definition;

  old_declarations := E'  ordinal_value integer;';
  new_declarations := E'  ordinal_value integer;\n  normalized_assignees jsonb;\n  normalized_usernames text[];\n  normalized_profiles jsonb;';
  if position(old_declarations in definition) = 0 then
    raise exception 'eval_work_batch_v2_declarations_changed';
  end if;
  definition := replace(definition, old_declarations, new_declarations);

  old_actor_block := E'  assignee := private.eval_work_assert_actor_v1(p_payload->>''assigneeUsername'');\n  if trim(coalesce(p_payload->>''assigneeEmail'', '''')) !~* ''^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'' then\n    raise exception using errcode = ''22023'', message = ''eval_work_assignee_email_invalid'';\n  end if;';
  new_actor_block := old_actor_block || E'\n  if jsonb_typeof(p_payload->''assignees'') = ''array'' then\n    normalized_assignees := private.eval_work_normalize_assignees_v1(p_payload->''assignees'');\n    select array_agg(assignee_name order by ordinal)\n      into normalized_usernames\n    from jsonb_array_elements_text(normalized_assignees->''usernames'') with ordinality as names(assignee_name, ordinal);\n    normalized_profiles := normalized_assignees->''profiles'';\n  else\n    normalized_usernames := array[lower(assignee.username)];\n    normalized_profiles := jsonb_build_array(jsonb_build_object(\n      ''username'', lower(assignee.username),\n      ''display'', coalesce(nullif(assignee.display_name, ''''), assignee.username),\n      ''email'', lower(trim(p_payload->>''assigneeEmail''))\n    ));\n  end if;';
  if position(old_actor_block in definition) = 0 then
    raise exception 'eval_work_batch_v2_actor_block_changed';
  end if;
  definition := replace(definition, old_actor_block, new_actor_block);

  old_columns := E'      inquiry_draft, origin_count, assigned_to_users, batch_token, source_context';
  new_columns := E'      inquiry_draft, origin_count, assigned_to_users, assignee_usernames, assignee_profiles, batch_token, source_context';
  if position(old_columns in definition) = 0 then
    raise exception 'eval_work_batch_v2_insert_columns_changed';
  end if;
  definition := replace(definition, old_columns, new_columns);

  old_values := E'      cardinality(origin_ids), matched_users, batch_token_value,';
  new_values := E'      cardinality(origin_ids), matched_users, normalized_usernames, normalized_profiles, batch_token_value,';
  if position(old_values in definition) = 0 then
    raise exception 'eval_work_batch_v2_insert_values_changed';
  end if;
  definition := replace(definition, old_values, new_values);
  execute definition;

  select pg_get_functiondef('public.create_eval_work_v1(jsonb)'::regprocedure) into definition;

  old_declarations := E'  create_token_value text;';
  new_declarations := E'  create_token_value text;\n  normalized_assignees jsonb;\n  normalized_usernames text[];\n  normalized_profiles jsonb;';
  if position(old_declarations in definition) = 0 then
    raise exception 'eval_work_v1_declarations_changed';
  end if;
  definition := replace(definition, old_declarations, new_declarations);

  old_actor_block := E'  assignee := private.eval_work_assert_actor_v1(p_payload->>''assigneeUsername'');\n  if trim(coalesce(p_payload->>''assigneeEmail'', '''')) !~* ''^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'' then\n    raise exception using errcode = ''22023'', message = ''eval_work_assignee_email_invalid'';\n  end if;';
  new_actor_block := old_actor_block || E'\n  if jsonb_typeof(p_payload->''assignees'') = ''array'' then\n    normalized_assignees := private.eval_work_normalize_assignees_v1(p_payload->''assignees'');\n    select array_agg(assignee_name order by ordinal)\n      into normalized_usernames\n    from jsonb_array_elements_text(normalized_assignees->''usernames'') with ordinality as names(assignee_name, ordinal);\n    normalized_profiles := normalized_assignees->''profiles'';\n  else\n    normalized_usernames := array[lower(assignee.username)];\n    normalized_profiles := jsonb_build_array(jsonb_build_object(\n      ''username'', lower(assignee.username),\n      ''display'', coalesce(nullif(assignee.display_name, ''''), assignee.username),\n      ''email'', lower(trim(p_payload->>''assigneeEmail''))\n    ));\n  end if;';
  if position(old_actor_block in definition) = 0 then
    raise exception 'eval_work_v1_assignee_block_changed';
  end if;
  definition := replace(definition, old_actor_block, new_actor_block);

  old_columns := E'    origin_snapshot, context_rows, inventory_signature, settings_signature, inquiry_draft';
  new_columns := E'    origin_snapshot, context_rows, inventory_signature, settings_signature, inquiry_draft,\n    assignee_usernames, assignee_profiles';
  if position(old_columns in definition) = 0 then
    raise exception 'eval_work_v1_insert_columns_changed';
  end if;
  definition := replace(definition, old_columns, new_columns);

  old_values := E'    to_jsonb(origin), context_rows, md5(context_rows::text), md5(settings::text), inquiry';
  new_values := E'    to_jsonb(origin), context_rows, md5(context_rows::text), md5(settings::text), inquiry,\n    normalized_usernames, normalized_profiles';
  if position(old_values in definition) = 0 then
    raise exception 'eval_work_v1_insert_values_changed';
  end if;
  definition := replace(definition, old_values, new_values);
  execute definition;
end
$block$;

create or replace function public.get_eval_work_creation_health_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  batch_definition text;
  single_definition text;
  batch_contract_healthy boolean;
  single_contract_healthy boolean;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'EVAL_WORK_CREATION_HEALTH_FORBIDDEN';
  end if;

  select pg_get_functiondef('public.create_eval_work_batch_v2(jsonb)'::regprocedure) into batch_definition;
  select pg_get_functiondef('public.create_eval_work_v1(jsonb)'::regprocedure) into single_definition;

  batch_contract_healthy := position('assignee_usernames, assignee_profiles, batch_token' in batch_definition) > 0
    and position('normalized_usernames, normalized_profiles, batch_token_value' in batch_definition) > 0;
  single_contract_healthy := position('inquiry_draft,' || chr(10) || '    assignee_usernames, assignee_profiles' in single_definition) > 0
    and position('normalized_usernames, normalized_profiles' in single_definition) > 0;

  return jsonb_build_object(
    'contract_version', 'eval-work-creation-health-v1',
    'batch_assignee_insert_contract_healthy', batch_contract_healthy,
    'single_assignee_insert_contract_healthy', single_contract_healthy,
    'healthy', batch_contract_healthy and single_contract_healthy
  );
end
$function$;

revoke all on function public.create_eval_work_v1(jsonb) from public, anon, authenticated;
grant execute on function public.create_eval_work_v1(jsonb) to service_role;
revoke all on function public.create_eval_work_batch_v2(jsonb) from public, anon, authenticated;
grant execute on function public.create_eval_work_batch_v2(jsonb) to service_role;
revoke all on function public.get_eval_work_creation_health_snapshot_v1() from public, anon, authenticated;
grant execute on function public.get_eval_work_creation_health_snapshot_v1() to service_role;

commit;
