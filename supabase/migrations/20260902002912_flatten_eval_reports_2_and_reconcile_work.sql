begin;

-- Eval Reports #2 work can be resolved by a later canonical inventory import.
-- This is a terminal historical state: it never creates a completion delivery.
alter table public.ph_eval_work
  add column if not exists resolved_import_at timestamptz,
  add column if not exists resolved_import_revision text,
  add column if not exists resolved_import_report_id text;

alter table public.ph_eval_work drop constraint if exists ph_eval_work_status_check;
alter table public.ph_eval_work
  add constraint ph_eval_work_status_check
  check (status in ('open', 'in_progress', 'submitted', 'cancelled', 'resolved_import'));

alter table public.ph_eval_work_events drop constraint if exists ph_eval_work_events_event_type_check;
alter table public.ph_eval_work_events
  add constraint ph_eval_work_events_event_type_check
  check (event_type in ('created', 'draft_saved', 'reassigned', 'submitted', 'cancelled', 'resolved_import'));

create index if not exists ph_eval_work_report2_active_item_idx
  on public.ph_eval_work (
    (lower(btrim(coalesce(source_context #>> '{report,reportId}', '')))),
    (upper(btrim(itemcode))),
    updated_at
  )
  where status in ('open', 'in_progress')
    and lower(btrim(coalesce(source_context #>> '{report,sourceMode}', ''))) = 'eval-report-2';

comment on column public.ph_eval_work.resolved_import_at is
  'Canonical inventory import time that silently resolved the originating Eval Reports #2 condition.';
comment on column public.ph_eval_work.resolved_import_revision is
  'Sanitized canonical import revision associated with resolved_import.';
comment on column public.ph_eval_work.resolved_import_report_id is
  'Originating Eval Reports #2 report independently re-evaluated at resolution.';

create or replace function private.eval_report2_inventory_date_v1(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $function$
declare
  raw_value text := btrim(coalesce(p_value, ''));
  match_value text[];
  parsed_date date;
  month_number integer;
begin
  if raw_value = '' then return null; end if;

  match_value := regexp_match(raw_value, '^(\d{1,2})/(\d{1,2})/(\d{2,4})(?:\D|$)');
  if match_value is not null then
    parsed_date := make_date(
      case when match_value[3]::integer between 0 and 99 then 2000 + match_value[3]::integer else match_value[3]::integer end,
      match_value[1]::integer,
      match_value[2]::integer
    );
    return parsed_date;
  end if;

  match_value := regexp_match(raw_value, '^(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)');
  if match_value is not null then
    return make_date(match_value[1]::integer, match_value[2]::integer, match_value[3]::integer);
  end if;

  match_value := regexp_match(
    raw_value,
    '^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})(?:\s|$)',
    'i'
  );
  if match_value is null then return null; end if;
  month_number := array_position(
    array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],
    lower(match_value[1])
  );
  return make_date(match_value[3]::integer, month_number, match_value[2]::integer);
exception when others then
  return null;
end
$function$;

create or replace function private.eval_report2_is_excluded_row_v1(
  p_season text,
  p_desigitem text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select upper(regexp_replace(btrim(coalesce(p_season, '')), '[[:space:]]+', '', 'g')) in ('Y', 'U3')
     and upper(coalesce(p_desigitem, '')) like '%SHFT%'
$function$;

create or replace function private.eval_report2_item_qualifies_v1(
  p_report_id text,
  p_itemcode text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  report_id text := lower(btrim(coalesce(p_report_id, '')));
  item_key text := upper(btrim(coalesce(p_itemcode, '')));
  app_settings jsonb := private.eval_work_settings_v1();
  current_season text := upper(btrim(coalesce(app_settings->>'seasonCode', 'F1')));
  current_sales_year integer := private.eval_work_normalized_sales_year_v1(app_settings->>'salesYear');
  next_season text;
  next_sales_year integer;
  low_stock_limit numeric := 150;
  hold_age_limit integer := 5;
  location_note_age_limit integer := 10;
  central_today date := (p_now at time zone 'America/Chicago')::date;
  result_value boolean := false;
begin
  if report_id not in (
    's1-with-pri', 'u1', 'u2', 'u3', 'od-loc-note-date', 'hs-plus-5-days',
    'get-off-hold', 'low-stock', 'no-pri', 'culls', 'not-in-f1'
  ) then
    raise exception using errcode = '22023', message = 'eval_report2_report_invalid';
  end if;
  if item_key = '' then return false; end if;
  current_sales_year := coalesce(current_sales_year, 27);
  next_season := case when current_season = 'F1' then 'S1' else 'F1' end;
  next_sales_year := case when current_season = 'F1' then current_sales_year else current_sales_year + 1 end;

  select
    coalesce((select s.low_stock_max_slts from public.ph_eval_report_settings s where s.singleton limit 1), 150),
    coalesce((select s.hold_age_days from public.ph_eval_report_settings s where s.singleton limit 1), 5),
    coalesce((select s.location_note_age_days from public.ph_eval_report_settings s where s.singleton limit 1), 10)
  into low_stock_limit, hold_age_limit, location_note_age_limit;

  with item_rows as materialized (
    select
      m.*,
      upper(regexp_replace(btrim(coalesce(m.season, '')), '[[:space:]]+', '', 'g')) as season_key,
      private.eval_work_normalized_sales_year_v1(m.saleyear) as sales_year_key,
      private.eval_report2_inventory_date_v1(m.holdstopbegindate) as hold_start_date,
      private.eval_report2_inventory_date_v1(m.locationnotedate) as location_note_date,
      coalesce(private.eval_work_safe_numeric_v1(m.s_lts), 0) as slts_value
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = item_key
      and not private.eval_report2_is_excluded_row_v1(m.season, m.desigitem)
  ), aggregate_flags as (
    select
      count(*) > 0 as has_rows,
      bool_or(nullif(btrim(coalesce(priority, '')), '') is not null) as has_priority,
      bool_or(season_key = 'F1' and sales_year_key between 1 and current_sales_year) as has_valid_f1,
      bool_or(
        upper(btrim(coalesce(holdstopcode, ''))) in ('H', 'S')
        and hold_start_date is not null
        and central_today - hold_start_date > hold_age_limit
      ) as has_old_hold,
      bool_or(
        season_key = 'F1'
        and sales_year_key between 1 and current_sales_year
        and slts_value < low_stock_limit
      ) as qualifies_low_stock
    from item_rows
  )
  select case report_id
    when 's1-with-pri' then exists (
      select 1 from item_rows where nullif(btrim(coalesce(priority, '')), '') is not null and season_key <> 'F1'
    )
    when 'u1' then exists (select 1 from item_rows where season_key = 'U1')
    when 'u2' then exists (select 1 from item_rows where season_key = 'U2')
    when 'u3' then exists (select 1 from item_rows where season_key = 'U3')
    when 'od-loc-note-date' then exists (
      select 1 from item_rows
      where location_note_date is not null and central_today - location_note_date > location_note_age_limit
    )
    when 'hs-plus-5-days' then exists (
      select 1 from item_rows
      where upper(btrim(coalesce(holdstopcode, ''))) in ('H', 'S')
        and hold_start_date is not null and central_today - hold_start_date > hold_age_limit
    )
    when 'get-off-hold' then (select has_old_hold from aggregate_flags)
      and exists (select 1 from item_rows where nullif(btrim(coalesce(holdstopcode, '')), '') is null)
    when 'low-stock' then (select qualifies_low_stock from aggregate_flags)
      and exists (
        select 1 from item_rows
        where (
          season_key in ('U1', 'U2', 'U3', 'X')
          and sales_year_key between 1 and current_sales_year
        ) or (season_key = next_season and sales_year_key = next_sales_year)
      )
    when 'no-pri' then (select has_rows from aggregate_flags) and not (select has_priority from aggregate_flags)
    when 'culls' then exists (select 1 from item_rows where season_key = 'X')
    when 'not-in-f1' then (select has_rows from aggregate_flags) and not (select has_valid_f1 from aggregate_flags)
    else false
  end into result_value;

  return coalesce(result_value, false);
end
$function$;

-- The prior implementation rejected an ITEMCODE above 100 current rows during
-- both creation and later membership checks. The flattened contract requires
-- every current physical row, so remove only those obsolete caps while
-- preserving the existing transactional implementations.
do $block$
declare
  definition text;
  create_old_clause text := E'    elsif jsonb_array_length(context_rows) > 100 then\n      raise exception using errcode = ''40001'', message = ''eval_work_itemcode_row_limit_conflict'';\n    end if;';
  create_new_clause text := E'    end if;';
  validate_old_clause text := E'  if jsonb_array_length(current_rows) < 1 or jsonb_array_length(current_rows) > 100 then\n    raise exception using errcode = ''40001'', message = ''eval_work_itemcode_row_limit_conflict'';\n  end if;';
  validate_new_clause text := E'  if jsonb_array_length(current_rows) < 1 then\n    raise exception using errcode = ''40001'', message = ''eval_work_itemcode_membership_empty'';\n  end if;';
begin
  select pg_get_functiondef('public.create_eval_work_batch_v2(jsonb)'::regprocedure) into definition;
  if position(create_old_clause in definition) > 0 then
    definition := replace(definition, create_old_clause, create_new_clause);
    execute definition;
  elsif position('eval_work_itemcode_row_limit_conflict' in definition) > 0 then
    raise exception 'eval_work_itemcode_row_limit_clause_changed';
  end if;

  select pg_get_functiondef('private.eval_work_assert_itemcode_membership_v1(uuid)'::regprocedure) into definition;
  if position(validate_old_clause in definition) > 0 then
    definition := replace(definition, validate_old_clause, validate_new_clause);
    execute definition;
  elsif position('eval_work_itemcode_row_limit_conflict' in definition) > 0 then
    raise exception 'eval_work_membership_row_limit_clause_changed';
  end if;
end
$block$;

create or replace function private.eval_report2_verified_user_emails_v1(p_usernames text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  with wanted as (
    select distinct private.eval_normalize_user_v2(value) as username
    from unnest(coalesce(p_usernames, '{}'::text[])) value
    where private.eval_normalize_user_v2(value) <> ''
  )
  select coalesce(array_agg(distinct lower(btrim(u.email)) order by lower(btrim(u.email))), '{}'::text[])
  from wanted w
  join public.profiles p on lower(btrim(p.username)) = w.username
  join auth.users u on u.id = p.id
  where p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and u.email_confirmed_at is not null
    and btrim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
$function$;

create or replace function public.create_eval_report2_batch_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  actor_username text;
  raw_items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  item jsonb;
  valid_items jsonb := '[]'::jsonb;
  resolved_items jsonb := '[]'::jsonb;
  report_id text;
  itemcode text;
  work_rows jsonb := '[]'::jsonb;
  assignment_emails text[];
  required_actor_emails text[];
  work_record public.ph_eval_work;
begin
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  actor_username := private.eval_normalize_user_v2(actor.username);
  if actor_username not in ('dylan_collyge', 'megan_kelly', 'jd_jones') then
    raise exception using errcode = '42501', message = 'eval_work_batch_create_forbidden';
  end if;
  if jsonb_typeof(raw_items) <> 'array' or jsonb_array_length(raw_items) < 1 or jsonb_array_length(raw_items) > 50 then
    raise exception using errcode = '22023', message = 'eval_work_batch_size_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gnc-eval-report2-create:' || coalesce(p_payload->>'batchToken', ''), 0));

  for item in select value from jsonb_array_elements(raw_items) loop
    report_id := lower(btrim(coalesce(item #>> '{reportContext,reportId}', '')));
    itemcode := upper(btrim(coalesce(item->>'itemcode', item #>> '{source,itemcode}', '')));
    if lower(btrim(coalesce(item #>> '{reportContext,sourceMode}', ''))) <> 'eval-report-2' then
      raise exception using errcode = '22023', message = 'eval_report2_source_invalid';
    end if;
    if itemcode = '' then
      raise exception using errcode = '22023', message = 'eval_work_batch_itemcode_invalid';
    end if;
    if private.eval_report2_item_qualifies_v1(report_id, itemcode, now()) then
      valid_items := valid_items || jsonb_build_array(
        jsonb_set(item, '{itemcode}', to_jsonb(itemcode), true)
      );
    else
      resolved_items := resolved_items || jsonb_build_array(
        jsonb_build_object('itemcode', itemcode, 'reportId', report_id, 'result', 'already_resolved')
      );
    end if;
  end loop;

  if jsonb_array_length(valid_items) = 0 then
    return jsonb_build_object(
      'result', 'already_resolved',
      'rows', '[]'::jsonb,
      'resolvedItemcodes', resolved_items,
      'assignmentRefreshed', false
    );
  end if;

  for work_record in
    select * from public.create_eval_work_batch_multi_v2(
      p_payload || jsonb_build_object('items', valid_items)
    )
  loop
    work_rows := work_rows || jsonb_build_array(to_jsonb(work_record));
  end loop;

  if actor_username = 'jd_jones' then
    required_actor_emails := private.eval_report2_verified_user_emails_v1(array['jd_jones']);
    if cardinality(required_actor_emails) <> 1 then
      raise exception using errcode = '40001', message = 'eval_work_required_assignment_recipient_unavailable';
    end if;
    update public.ph_request_delivery_outbox outbox
    set payload = jsonb_set(
      outbox.payload,
      '{assignmentRecipients}',
      (
        select to_jsonb(array_agg(distinct email order by email))
        from (
          select lower(btrim(value)) as email
          from jsonb_array_elements_text(coalesce(outbox.payload->'assignmentRecipients', '[]'::jsonb))
          union all
          select unnest(required_actor_emails)
        ) recipients
        where email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      ),
      true
    ), updated_at = now()
    where outbox.event_id in (
      select (row_payload->>'assignment_event_id')::uuid
      from jsonb_array_elements(work_rows) as selected_work(row_payload)
    );
  end if;

  select coalesce(array_agg(distinct lower(btrim(value)) order by lower(btrim(value))), '{}'::text[])
  into assignment_emails
  from jsonb_array_elements(work_rows) as selected_work(row_payload)
  join public.ph_request_delivery_outbox outbox
    on outbox.event_id = (row_payload->>'assignment_event_id')::uuid
  cross join lateral jsonb_array_elements_text(coalesce(outbox.payload->'assignmentRecipients', '[]'::jsonb)) value;

  return jsonb_build_object(
    'result', case when jsonb_array_length(resolved_items) > 0 then 'partial_success' else 'created' end,
    'rows', work_rows,
    'resolvedItemcodes', resolved_items,
    'assignmentRecipients', to_jsonb(coalesce(assignment_emails, '{}'::text[])),
    'assignmentRefreshed', exists (
      select 1 from jsonb_array_elements(work_rows) as selected_work(row_payload)
      where coalesce((row_payload #>> '{source_context,assignmentRefreshed}')::boolean, false)
    )
  );
end
$function$;

create or replace function public.get_eval_report2_direct_inquiry_recipients_v1(p_actor_username text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  actor_username text;
  usernames text[] := array['dylan_collyge', 'megan_kelly', 'sharon_combs'];
  emails text[];
  expected_count integer := 3;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  actor_username := private.eval_normalize_user_v2(actor.username);
  if actor_username not in ('dylan_collyge', 'megan_kelly', 'jd_jones') then
    raise exception using errcode = '42501', message = 'eval_report2_direct_inquiry_forbidden';
  end if;
  if actor_username = 'jd_jones' then
    usernames := array_append(usernames, 'jd_jones');
    expected_count := 4;
  end if;
  emails := private.eval_report2_verified_user_emails_v1(usernames);
  if cardinality(emails) <> expected_count then
    raise exception using errcode = '40001', message = 'eval_report2_direct_recipient_unavailable';
  end if;
  return emails;
end
$function$;

create or replace function public.list_eval_report2_itemcodes_v1(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  actor_username text;
  report_id text := lower(btrim(coalesce(p_payload->>'reportId', '')));
  cursor_itemcode text := upper(btrim(coalesce(p_payload->>'cursorItemcode', '')));
  page_limit integer := least(50, greatest(1, coalesce((p_payload->>'limit')::integer, 25)));
  page_rows jsonb := '[]'::jsonb;
  candidate_count integer := 0;
  total_itemcode_count integer := 0;
  next_cursor text;
begin
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  actor_username := private.eval_normalize_user_v2(actor.username);
  if actor_username not in ('dylan_collyge', 'megan_kelly', 'jd_jones') then
    raise exception using errcode = '42501', message = 'eval_report2_view_forbidden';
  end if;

  select count(*) into total_itemcode_count
  from (
    select distinct upper(btrim(m.itemcode)) as itemcode_key
    from public.ph_master_inventory m
    where nullif(btrim(coalesce(m.itemcode, '')), '') is not null
  ) distinct_items
  where private.eval_report2_item_qualifies_v1(report_id, itemcode_key, now());

  with distinct_items as materialized (
    select distinct upper(btrim(m.itemcode)) as itemcode_key
    from public.ph_master_inventory m
    where nullif(btrim(coalesce(m.itemcode, '')), '') is not null
      and upper(btrim(m.itemcode)) > cursor_itemcode
  ), candidate_items as materialized (
    select itemcode_key
    from distinct_items
    where private.eval_report2_item_qualifies_v1(report_id, itemcode_key, now())
    order by itemcode_key
    limit page_limit + 1
  ), selected_items as materialized (
    select itemcode_key from candidate_items order by itemcode_key limit page_limit
  ), inventory_rows as materialized (
    select
      upper(btrim(m.itemcode)) as itemcode_key,
      jsonb_build_object(
        'unique_id', m.unique_id,
        'itemcode', m.itemcode,
        'commonname', m.commonname,
        'contsize', m.contsize,
        'locationcode', m.locationcode,
        'lotcode', m.lotcode,
        'ptronhand', m.ptronhand,
        'ptravailable', m.ptravailable,
        'season', m.season,
        'saleyear', m.saleyear,
        'priority', m.priority,
        'genusname', m.genusname,
        'assignedToUsers', coalesce((
          select jsonb_agg(distinct coalesce(nullif(private.eval_normalize_user_v2(a.assignedto), ''), 'unassigned'))
          from public.ph_warehouse_assigned_items a
          where coalesce(a.present_in_drive, true)
            and upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(btrim(m.itemcode))
            and lower(regexp_replace(btrim(coalesce(a.genusname, '')), '[[:space:]]+', ' ', 'g'))
              = lower(regexp_replace(btrim(coalesce(m.genusname, '')), '[[:space:]]+', ' ', 'g'))
        ), jsonb_build_array('unassigned'))
      ) as row_payload,
      m.locationcode,
      m.lotcode,
      m.unique_id
    from public.ph_master_inventory m
    join selected_items selected on selected.itemcode_key = upper(btrim(m.itemcode))
  ), grouped as (
    select
      itemcode_key,
      max(row_payload->>'commonname') as commonname,
      jsonb_agg(row_payload order by private.eval_work_natural_sort_key_v1(locationcode), private.eval_work_natural_sort_key_v1(lotcode), unique_id) as rows
    from inventory_rows
    group by itemcode_key
    order by itemcode_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemcode', itemcode_key,
    'commonname', commonname,
    'rows', rows,
    'rowCount', jsonb_array_length(rows)
  ) order by itemcode_key), '[]'::jsonb)
  into page_rows
  from grouped;

  select count(*) into candidate_count
  from (
    select itemcode_key
    from (
      select distinct upper(btrim(m.itemcode)) as itemcode_key
      from public.ph_master_inventory m
      where nullif(btrim(coalesce(m.itemcode, '')), '') is not null
        and upper(btrim(m.itemcode)) > cursor_itemcode
    ) distinct_items
    where private.eval_report2_item_qualifies_v1(report_id, itemcode_key, now())
    order by itemcode_key
    limit page_limit + 1
  ) remaining;

  if candidate_count > page_limit then
    next_cursor := page_rows->-1->>'itemcode';
  end if;

  return jsonb_build_object(
    'reportId', report_id,
    'items', page_rows,
    'nextCursor', next_cursor,
    'hasMore', next_cursor is not null,
    'limit', page_limit,
    'totalItemcodeCount', total_itemcode_count
  );
exception when invalid_text_representation then
  raise exception using errcode = '22023', message = 'eval_report2_page_invalid';
end
$function$;

create or replace function public.reconcile_eval_report2_work_v1(
  p_import_revision text,
  p_dry_run boolean default true,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  lock_acquired boolean;
  work_row public.ph_eval_work;
  report_id text;
  checked_count integer := 0;
  resolved_count integer := 0;
  resolved_ids jsonb := '[]'::jsonb;
  safe_limit integer := least(5000, greatest(1, coalesce(p_limit, 1000)));
  safe_revision text := left(regexp_replace(btrim(coalesce(p_import_revision, '')), '[^A-Za-z0-9_.:+-]', '', 'g'), 160);
begin
  lock_acquired := pg_try_advisory_xact_lock(hashtextextended('gnc-eval-report2-import-reconcile-v1', 0));
  if not lock_acquired then
    return jsonb_build_object('status', 'deferred', 'errorCode', 'RECONCILIATION_DEFERRED', 'checked', 0, 'resolved', 0);
  end if;
  if safe_revision = '' then safe_revision := to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MISSMS'); end if;

  for work_row in
    select work.*
    from public.ph_eval_work work
    where work.status in ('open', 'in_progress')
      and lower(btrim(coalesce(work.source_context #>> '{report,sourceMode}', ''))) = 'eval-report-2'
      and nullif(btrim(coalesce(work.source_context #>> '{report,reportId}', '')), '') is not null
    order by work.created_at, work.id
    limit safe_limit
    for update skip locked
  loop
    checked_count := checked_count + 1;
    report_id := lower(btrim(work_row.source_context #>> '{report,reportId}'));
    if private.eval_report2_item_qualifies_v1(report_id, work_row.itemcode, now()) then
      continue;
    end if;
    resolved_count := resolved_count + 1;
    resolved_ids := resolved_ids || jsonb_build_array(work_row.id);
    if not coalesce(p_dry_run, true) then
      update public.ph_eval_work
      set status = 'resolved_import',
          resolved_import_at = now(),
          resolved_import_revision = safe_revision,
          resolved_import_report_id = report_id,
          updated_at = now(),
          version = version + 1
      where id = work_row.id and status in ('open', 'in_progress')
      returning * into work_row;

      if found then
        insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
        values (
          work_row.id,
          'resolved_import',
          'inventory_import',
          work_row.version,
          jsonb_build_object('reportId', report_id, 'importRevision', safe_revision, 'deliveryQueued', false)
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when coalesce(p_dry_run, true) then 'dry_run' else 'completed' end,
    'checked', checked_count,
    'resolved', resolved_count,
    'resolvedWorkIds', resolved_ids,
    'deliveryEventsCreated', 0,
    'importRevision', safe_revision
  );
end
$function$;

revoke all on function private.eval_report2_inventory_date_v1(text) from public, anon, authenticated;
revoke all on function private.eval_report2_is_excluded_row_v1(text, text) from public, anon, authenticated;
revoke all on function private.eval_report2_item_qualifies_v1(text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.eval_report2_verified_user_emails_v1(text[]) from public, anon, authenticated;
revoke all on function public.create_eval_report2_batch_v1(jsonb) from public, anon, authenticated;
revoke all on function public.get_eval_report2_direct_inquiry_recipients_v1(text) from public, anon, authenticated;
revoke all on function public.list_eval_report2_itemcodes_v1(jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_eval_report2_work_v1(text, boolean, integer) from public, anon, authenticated;

grant execute on function private.eval_report2_inventory_date_v1(text) to service_role;
grant execute on function private.eval_report2_is_excluded_row_v1(text, text) to service_role;
grant execute on function private.eval_report2_item_qualifies_v1(text, text, timestamptz) to service_role;
grant execute on function private.eval_report2_verified_user_emails_v1(text[]) to service_role;
grant execute on function public.create_eval_report2_batch_v1(jsonb) to service_role;
grant execute on function public.get_eval_report2_direct_inquiry_recipients_v1(text) to service_role;
grant execute on function public.list_eval_report2_itemcodes_v1(jsonb) to service_role;
grant execute on function public.reconcile_eval_report2_work_v1(text, boolean, integer) to service_role;

comment on function private.eval_report2_item_qualifies_v1(text, text, timestamptz) is
  'Central Eval Reports #2 ITEMCODE predicate shared by protected creation and canonical-import reconciliation, including Y/U3 SHFT exclusion.';
comment on function public.create_eval_report2_batch_v1(jsonb) is
  'Transactional stale-safe Eval Reports #2 batch creation. Resolved ITEMCODEs are skipped while valid selections are created.';
comment on function public.get_eval_report2_direct_inquiry_recipients_v1(text) is
  'Returns the exact active, unlocked, verified recipients for a direct Eval Reports #2 inquiry: Dylan, Megan, Sharon, plus JD only when JD submits.';
comment on function public.list_eval_report2_itemcodes_v1(jsonb) is
  'Service-only keyset page of flat Eval Reports #2 ITEMCODE cards with every current physical row.';
comment on function public.reconcile_eval_report2_work_v1(text, boolean, integer) is
  'Idempotently closes open Eval Reports #2 work as resolved_import when canonical data clears its originating report; no email is queued.';

commit;
