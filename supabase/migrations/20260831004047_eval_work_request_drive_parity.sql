begin;

create or replace function private.eval_work_safe_numeric_v1(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $function$
declare
  cleaned text := regexp_replace(coalesce(p_value, ''), '[^0-9.-]', '', 'g');
begin
  if cleaned !~ '^-?[0-9]+([.][0-9]+)?$' then
    return null;
  end if;
  return cleaned::numeric;
exception when others then
  return null;
end
$function$;

create or replace function private.eval_work_normalized_sales_year_v1(p_value text)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
declare
  parsed numeric := private.eval_work_safe_numeric_v1(p_value);
begin
  if parsed is null then
    return null;
  end if;
  if parsed >= 2000 then
    return (parsed % 100)::integer;
  end if;
  return parsed::integer;
exception when others then
  return null;
end
$function$;

create or replace function private.eval_work_apply_request_drive_parity_v1(
  p_work_id uuid,
  p_actor_username text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  settings jsonb;
  current_season text;
  current_sales_year integer;
  winner_id text;
  winner public.ph_master_inventory;
  completed_at timestamptz := now();
begin
  select * into work
  from public.ph_eval_work
  where id = p_work_id
  for update;

  if work.id is null then
    raise exception using errcode = '22023', message = 'eval_work_not_found';
  end if;

  settings := private.eval_work_settings_v1();
  current_season := upper(trim(coalesce(settings->>'seasonCode', '')));
  current_sales_year := private.eval_work_normalized_sales_year_v1(settings->>'salesYear');

  update public.ph_master_inventory m
  set date_completed = completed_at,
      av_rule_bundle_updated_at = completed_at,
      av_rule_av_note_updated_at = completed_at,
      av_rule_spec_updated_at = completed_at,
      av_rule_match_updated_at = completed_at,
      av_rule_caliper_updated_at = completed_at,
      av_rule_photo_updated_at = completed_at,
      av_rule_priority_snapshot = m.priority,
      av_rule_holdstop_snapshot = concat_ws('|',
        nullif(btrim(coalesce(m.holdstopcode, '')), ''),
        nullif(btrim(coalesce(m.holdstopreason, '')), '')
      ),
      last_updated = completed_at
  from public.ph_eval_work_origin_rows origin
  where origin.eval_work_id = work.id
    and m.unique_id = origin.origin_unique_id;

  if coalesce(work.source_context->>'scopeContract', '') <> 'itemcode-all-rows-v1' then
    return;
  end if;

  -- Request and Drive Mode select one current-season row for Season Sales Notes
  -- and route every other ordinary row to Location Sales Notes. Prefer an
  -- already selected season row, then use the same PTR / priority / location
  -- ordering used by the client-side row assignment model.
  select candidate.unique_id
    into winner_id
  from public.ph_master_inventory candidate
  where upper(trim(coalesce(candidate.itemcode, ''))) = upper(trim(work.itemcode))
    and current_season <> ''
    and upper(trim(coalesce(candidate.season, ''))) = current_season
    and private.eval_work_normalized_sales_year_v1(candidate.saleyear) <= current_sales_year
    and trim(coalesce(candidate.priority, '')) ~ '^[1-4]$'
    and upper(trim(coalesce(candidate.end_cap_folder, ''))) in ('', 'NULL', 'N/A', '-')
    and lower(trim(coalesce(candidate.app_tab_assignment, ''))) not in (
      'flyer', 'endcap', 'sales-office', 'sales-office-order', 'move', 'moves',
      'eval-task', 'not_on_inventory_dylan', 'not_on_inventory_jd', 'not_on_inventory_denied'
    )
    and lower(trim(coalesce(candidate.app_tab_assignment, ''))) not like 'ncr\_%' escape '\'
  order by
    case when lower(trim(coalesce(candidate.app_tab_assignment, ''))) = 'season' then 0 else 1 end,
    coalesce(private.eval_work_safe_numeric_v1(candidate.ptravailable), -1) desc,
    trim(coalesce(candidate.priority, ''))::integer asc,
    private.eval_work_natural_sort_key_v1(candidate.locationcode),
    private.eval_work_natural_sort_key_v1(candidate.lotcode),
    candidate.unique_id
  limit 1;

  update public.ph_master_inventory m
  set app_tab_assignment = case
        when upper(trim(coalesce(m.end_cap_folder, ''))) not in ('', 'NULL', 'N/A', '-') then 'endcap'
        when m.unique_id = winner_id then 'season'
        else 'location'
      end,
      last_updated = completed_at
  where upper(trim(coalesce(m.itemcode, ''))) = upper(trim(work.itemcode))
    and lower(trim(coalesce(m.app_tab_assignment, ''))) not in (
      'flyer', 'endcap', 'sales-office', 'sales-office-order', 'move', 'moves',
      'eval-task', 'not_on_inventory_dylan', 'not_on_inventory_jd', 'not_on_inventory_denied'
    )
    and lower(trim(coalesce(m.app_tab_assignment, ''))) not like 'ncr\_%' escape '\';

  -- Sales Office is derived state. Keep only the exact current Season Sales
  -- Notes winner, just as Request and Drive Mode do after Mark Done.
  delete from public.ph_sales_office sales
  using public.ph_master_inventory family
  where upper(trim(coalesce(family.itemcode, ''))) = upper(trim(work.itemcode))
    and (sales.unique_id = family.unique_id or sales.master_id = family.unique_id)
    and lower(trim(coalesce(sales.so_source, 'season'))) = 'season'
    and (winner_id is null or family.unique_id <> winner_id);

  if winner_id is null then
    return;
  end if;

  select * into winner
  from public.ph_master_inventory
  where unique_id = winner_id
  for update;

  if trim(coalesce(winner.av_note, '')) = ''
     or trim(coalesce(winner.photo_link, '')) = ''
     or trim(coalesce(winner.match, '')) = ''
     or coalesce(private.eval_work_safe_numeric_v1(winner.loc_match_qty), 0) <= 0
     or upper(coalesce(winner.holdstopcode, '')) ~ '[HS]' then
    delete from public.ph_sales_office sales
    where (sales.unique_id = winner_id or sales.master_id = winner_id)
      and lower(trim(coalesce(sales.so_source, 'season'))) = 'season';
    return;
  end if;

  insert into public.ph_sales_office (
    unique_id, master_id, so_source, itemcode, commonname, contsize,
    locationcode, lotcode, ptravailable, priority, av_note, sales_note,
    spec, caliper, photo_link, photo_name, completed_by, completed_at
  ) values (
    winner.unique_id, winner.unique_id, 'season', winner.itemcode,
    winner.commonname, winner.contsize, winner.locationcode, winner.lotcode,
    winner.ptravailable, winner.priority, winner.av_note, winner.sales_note,
    winner.spec, winner.caliper, winner.photo_link, winner.photo_name,
    lower(trim(coalesce(p_actor_username, ''))), completed_at
  )
  on conflict (unique_id) do update set
    master_id = excluded.master_id,
    so_source = excluded.so_source,
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    ptravailable = excluded.ptravailable,
    priority = excluded.priority,
    av_note = excluded.av_note,
    sales_note = excluded.sales_note,
    spec = excluded.spec,
    caliper = excluded.caliper,
    photo_link = excluded.photo_link,
    photo_name = excluded.photo_name,
    completed_by = excluded.completed_by,
    completed_at = excluded.completed_at;
end
$function$;

create or replace function public.submit_eval_work_v2(
  p_work_id uuid,
  p_actor_username text,
  p_expected_version integer,
  p_inquiry jsonb,
  p_evidence_by_origin jsonb,
  p_submission_token text
)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  current_rows jsonb;
  submitted public.ph_eval_work;
  delivery public.ph_request_delivery_outbox;
  apply_parity boolean := false;
begin
  select * into work from public.ph_eval_work where id = p_work_id;
  if work.id is null then
    raise exception using errcode = '22023', message = 'eval_work_not_found';
  end if;

  if coalesce(work.source_context->>'scopeContract', '') = 'itemcode-all-rows-v1' then
    current_rows := private.eval_work_assert_itemcode_membership_v1(p_work_id);
    if jsonb_array_length(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb)) <> work.origin_count
       or (select count(distinct value->>'unique_id') from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb))) <> work.origin_count then
      raise exception using errcode = '40001', message = 'eval_work_itemcode_overlay_membership_conflict';
    end if;
    if jsonb_typeof(coalesce(p_evidence_by_origin, '{}'::jsonb)) <> 'object'
       or (select count(*) from jsonb_object_keys(coalesce(p_evidence_by_origin, '{}'::jsonb))) <> work.origin_count
       or exists (
         select 1
         from jsonb_each(coalesce(p_evidence_by_origin, '{}'::jsonb)) evidence
         where lower(trim(coalesce(evidence.value->>'picturesSpecsResolution', evidence.value->>'pictures_specs_resolution', ''))) <> 'done'
       ) then
      raise exception using errcode = '22023', message = 'eval_work_all_pictures_specs_mark_done_required';
    end if;
  end if;

  apply_parity := work.status in ('open', 'in_progress');
  submitted := public.submit_eval_work_v2_legacy_impl(
    p_work_id, p_actor_username, p_expected_version, p_inquiry, p_evidence_by_origin, p_submission_token
  );

  if apply_parity then
    perform private.eval_work_apply_request_drive_parity_v1(p_work_id, p_actor_username);
    select * into submitted from public.ph_eval_work where id = p_work_id;
  end if;

  if coalesce(submitted.source_context->>'scopeContract', '') = 'itemcode-all-rows-v1' then
    select * into delivery from public.ph_request_delivery_outbox where event_id = submitted.completion_event_id for update;
    update public.ph_request_delivery_outbox
      set payload = payload || jsonb_build_object(
        'scopeContract', 'itemcode-all-rows-v1',
        'membershipSignature', submitted.source_context->>'membershipSignature',
        'membershipCount', submitted.origin_count,
        'selectedUserFilters', coalesce(submitted.source_context#>'{report,selectedUserFilters}', '[]'::jsonb),
        'matchedAssignedToUsers', to_jsonb(submitted.assigned_to_users),
        'picturesSpecsContract', 'request-drive-parity-v1'
      ), updated_at = now()
      where event_id = submitted.completion_event_id;
  end if;
  return submitted;
end
$function$;

revoke all on function private.eval_work_apply_request_drive_parity_v1(uuid, text) from public, anon, authenticated;
revoke all on function private.eval_work_normalized_sales_year_v1(text) from public, anon, authenticated;
revoke all on function private.eval_work_safe_numeric_v1(text) from public, anon, authenticated;
revoke all on function public.submit_eval_work_v2(uuid, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function private.eval_work_apply_request_drive_parity_v1(uuid, text) to service_role;
grant execute on function private.eval_work_normalized_sales_year_v1(text) to service_role;
grant execute on function private.eval_work_safe_numeric_v1(text) to service_role;
grant execute on function public.submit_eval_work_v2(uuid, text, integer, jsonb, jsonb, text) to service_role;

comment on function private.eval_work_apply_request_drive_parity_v1(uuid, text) is
  'Applies Request and Drive Mode completion, AV tracking, Season/Location assignment, and derived Sales Office rules to exact Eval Work origin rows.';

comment on function private.eval_work_safe_numeric_v1(text) is
  'Parses inventory numeric text without allowing malformed legacy values to abort Eval Work completion.';

comment on function private.eval_work_normalized_sales_year_v1(text) is
  'Normalizes four-digit and two-digit sales years without allowing malformed legacy values to abort Eval Work completion.';

commit;
