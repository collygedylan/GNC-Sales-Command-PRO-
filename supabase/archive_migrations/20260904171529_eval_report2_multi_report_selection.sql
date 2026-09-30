-- Multiple report filters are a union. One work item keeps every currently
-- qualifying originating report; import resolution requires all of them to clear.
-- No existing work, inventory, PDFs or deliveries are changed by this migration.
create or replace function private.eval_report2_context_ids_v1(p_context jsonb)
returns text[]
language plpgsql immutable security invoker set search_path = ''
as $function$
declare
  ids text[];
  raw_ids jsonb := coalesce(p_context->'reportIds', jsonb_build_array(p_context->>'reportId'));
  allowed text[] := array['s1-with-pri','u1','u2','u3','od-loc-note-date','hs-plus-5-days','get-off-hold','low-stock','no-pri','culls','not-in-f1'];
begin
  if jsonb_typeof(raw_ids) <> 'array' or jsonb_array_length(raw_ids) not between 1 and 11 then
    raise exception using errcode='22023', message='eval_report2_report_invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(raw_ids) v
    where jsonb_typeof(v) <> 'string' or not (lower(btrim(v #>> '{}')) = any(allowed))) then
    raise exception using errcode='22023', message='eval_report2_report_invalid';
  end if;
  select array_agg(distinct lower(btrim(v)) order by lower(btrim(v))) into ids
  from jsonb_array_elements_text(raw_ids) v;
  return ids;
end
$function$;

create or replace function private.eval_report2_matching_reports_v1(p_context jsonb, p_itemcode text, p_now timestamptz default now())
returns text[]
language plpgsql stable security invoker set search_path = ''
as $function$
declare
  id text;
  matched text[] := '{}'::text[];
begin
  foreach id in array private.eval_report2_context_ids_v1(p_context) loop
    if private.eval_report2_item_qualifies_v1(id, p_itemcode, p_now) then
      matched := array_append(matched, id);
    end if;
  end loop;
  return matched;
end
$function$;

create or replace function private.eval_report2_labels_v1(p_ids text[])
returns text language sql immutable security invoker set search_path = ''
as $function$
  select string_agg(case id
    when 's1-with-pri' then 'S1WithPRI' when 'u1' then 'U1' when 'u2' then 'U2' when 'u3' then 'U3'
    when 'od-loc-note-date' then 'ODLocNoteDate' when 'hs-plus-5-days' then 'HS+5days'
    when 'get-off-hold' then 'GEToffHold' when 'low-stock' then 'LowStock' when 'no-pri' then 'NoPRI'
    when 'culls' then 'Culls' when 'not-in-f1' then 'NotInF1' end, ' + ' order by ordinal)
  from unnest(p_ids) with ordinality selected(id, ordinal);
$function$;

revoke all on function private.eval_report2_context_ids_v1(jsonb) from public, anon, authenticated;
revoke all on function private.eval_report2_matching_reports_v1(jsonb,text,timestamptz) from public, anon, authenticated;
revoke all on function private.eval_report2_labels_v1(text[]) from public, anon, authenticated;
grant execute on function private.eval_report2_context_ids_v1(jsonb) to service_role;
grant execute on function private.eval_report2_matching_reports_v1(jsonb,text,timestamptz) to service_role;
grant execute on function private.eval_report2_labels_v1(text[]) to service_role;

-- Guarded edits preserve the current grouped-email, recipient, active-profile,
-- assignment and all-current-row contracts already installed on the functions.
do $migration$
declare
  definition text;
  old_block text;
  new_block text;
begin
  definition := replace(pg_get_functiondef('public.create_eval_report2_batch_v1(jsonb)'::regprocedure), E'\r', '');
  old_block := '  report_id text;';
  if position(old_block in definition) = 0 then raise exception 'eval_multi_create_declaration_guard'; end if;
  definition := replace(definition, old_block, old_block || E'\n  report_ids text[];\n  matching_report_ids text[];');
  old_block := '    report_id := lower(btrim(coalesce(item #>> ''{reportContext,reportId}'', '''')));';
  new_block := '    report_ids := private.eval_report2_context_ids_v1(item->''reportContext'');
    report_id := report_ids[1];';
  if position(old_block in definition) = 0 then raise exception 'eval_multi_create_context_guard'; end if;
  definition := replace(definition, old_block, new_block);
  old_block := '    if private.eval_report2_item_qualifies_v1(report_id, itemcode, now()) then';
  new_block := '    matching_report_ids := private.eval_report2_matching_reports_v1(item->''reportContext'', itemcode, now());
    if cardinality(matching_report_ids) > 0 then
      item := jsonb_set(item, ''{reportContext}'', (item->''reportContext'') || jsonb_build_object(
        ''reportId'', matching_report_ids[1],
        ''reportIds'', to_jsonb(matching_report_ids),
        ''reportLabel'', private.eval_report2_labels_v1(matching_report_ids)
      ), true);';
  if position(old_block in definition) = 0 then raise exception 'eval_multi_create_membership_guard'; end if;
  definition := replace(definition, old_block, new_block);
  definition := replace(definition,
    '''itemcode'', itemcode, ''reportId'', report_id, ''result'', ''already_resolved''',
    '''itemcode'', itemcode, ''reportId'', report_id, ''reportIds'', to_jsonb(report_ids), ''result'', ''already_resolved''');
  if position('private.eval_report2_group_assignment_delivery_v1' in definition) = 0 then
    raise exception 'eval_multi_grouped_delivery_guard';
  end if;
  execute definition;

  definition := replace(pg_get_functiondef('public.reconcile_eval_report2_work_v1(text,boolean,integer)'::regprocedure), E'\r', '');
  old_block := '    if private.eval_report2_item_qualifies_v1(report_id, work_row.itemcode, now()) then';
  new_block := '    if cardinality(private.eval_report2_matching_reports_v1(work_row.source_context->''report'', work_row.itemcode, now())) > 0 then';
  if position(old_block in definition) = 0 then raise exception 'eval_multi_reconcile_membership_guard'; end if;
  definition := replace(definition, old_block, new_block);
  definition := replace(definition,
    '''reportId'', report_id, ''importRevision'', safe_revision',
    '''reportId'', report_id, ''reportIds'', to_jsonb(private.eval_report2_context_ids_v1(work_row.source_context->''report'')), ''importRevision'', safe_revision');
  execute definition;
end
$migration$;

-- Preserve the existing API boundary: these operations run only in app-api or
-- the import worker with service credentials, never as direct browser writes.
revoke all on function public.create_eval_report2_batch_v1(jsonb) from public, anon, authenticated;
grant execute on function public.create_eval_report2_batch_v1(jsonb) to service_role;
revoke all on function public.reconcile_eval_report2_work_v1(text,boolean,integer) from public, anon, authenticated;
grant execute on function public.reconcile_eval_report2_work_v1(text,boolean,integer) to service_role;
notify pgrst, 'reload schema';
