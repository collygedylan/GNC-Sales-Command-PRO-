begin;

create table if not exists public.ph_eval_work (
  id uuid primary key default gen_random_uuid(),
  create_token text not null unique,
  contract_version text not null default 'eval-work-v1' check (contract_version = 'eval-work-v1'),
  status text not null default 'open' check (status in ('open', 'in_progress', 'submitted', 'cancelled')),
  creator_username text not null,
  creator_display text not null,
  assignee_username text not null,
  assignee_display text not null,
  assignee_email text not null,
  instructions text not null default '',
  completion_recipients text[] not null,
  itemcode text not null,
  commonname text not null default '',
  contsize text not null default '',
  origin_unique_id text not null,
  origin_locationcode text not null default '',
  origin_lotcode text not null default '',
  origin_source text not null default '',
  origin_snapshot jsonb not null default '{}'::jsonb,
  context_rows jsonb not null default '[]'::jsonb,
  inventory_signature text not null,
  settings_signature text not null,
  inquiry_draft jsonb not null default '{}'::jsonb,
  evidence_draft jsonb not null default '{}'::jsonb,
  submitted_inquiry jsonb,
  submitted_evidence jsonb,
  version integer not null default 1 check (version > 0),
  assignment_event_id uuid references public.ph_request_delivery_outbox(event_id),
  completion_event_id uuid references public.ph_request_delivery_outbox(event_id),
  submission_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  constraint ph_eval_work_completion_recipients_nonempty check (cardinality(completion_recipients) > 0),
  constraint ph_eval_work_assignee_email_format check (assignee_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

comment on table public.ph_eval_work is
  'Durable Eval Work assignments. Reclass proposals are report-only; only originating-row evaluation evidence may be submitted.';

create table if not exists public.ph_eval_work_events (
  id bigint generated always as identity primary key,
  eval_work_id uuid not null references public.ph_eval_work(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'draft_saved', 'reassigned', 'submitted', 'cancelled')),
  actor_username text not null,
  version integer not null,
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 4096),
  created_at timestamptz not null default now()
);

comment on table public.ph_eval_work_events is
  'Sanitized immutable lifecycle audit for Eval Work; no notes, photos, recipients, or inventory payloads are stored here.';

create index if not exists ph_eval_work_assignee_status_updated_idx
  on public.ph_eval_work (lower(assignee_username), status, updated_at desc);
create index if not exists ph_eval_work_creator_status_updated_idx
  on public.ph_eval_work (lower(creator_username), status, updated_at desc);
create index if not exists ph_eval_work_itemcode_updated_idx
  on public.ph_eval_work (itemcode, updated_at desc);
create index if not exists ph_eval_work_events_work_created_idx
  on public.ph_eval_work_events (eval_work_id, created_at desc);

alter table public.ph_eval_work enable row level security;
alter table public.ph_eval_work_events enable row level security;

revoke all on table public.ph_eval_work from public, anon, authenticated;
revoke all on table public.ph_eval_work_events from public, anon, authenticated;
grant select on table public.ph_eval_work to authenticated;
grant select on table public.ph_eval_work_events to authenticated;
grant all on table public.ph_eval_work to service_role;
grant all on table public.ph_eval_work_events to service_role;
grant usage, select on sequence public.ph_eval_work_events_id_seq to service_role;

drop policy if exists "Authorized users read Eval Work" on public.ph_eval_work;
create policy "Authorized users read Eval Work"
on public.ph_eval_work for select to authenticated
using (
  lower((private.current_active_profile()).username) in ('dylan_collyge', 'megan_kelly')
  or lower(assignee_username) = lower((private.current_active_profile()).username)
);

drop policy if exists "Authorized users read Eval Work events" on public.ph_eval_work_events;
create policy "Authorized users read Eval Work events"
on public.ph_eval_work_events for select to authenticated
using (
  exists (
    select 1
    from public.ph_eval_work work
    where work.id = ph_eval_work_events.eval_work_id
      and (
        lower((private.current_active_profile()).username) in ('dylan_collyge', 'megan_kelly')
        or lower(work.assignee_username) = lower((private.current_active_profile()).username)
      )
  )
);

create or replace function private.eval_work_context_rows_v1(p_itemcode text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'unique_id', m.unique_id,
    'itemcode', m.itemcode,
    'commonname', m.commonname,
    'contsize', m.contsize,
    'locationcode', m.locationcode,
    'lotcode', m.lotcode,
    'source', m.source,
    'season', m.season,
    'saleyear', m.saleyear,
    'ptronhand', m.ptronhand,
    'ptravailable', m.ptravailable,
    'priority', m.priority,
    'holdstopcode', m.holdstopcode,
    'holdstopreason', m.holdstopreason,
    'locationnotedate', m.locationnotedate,
    'locationnote', m.locationnote,
    'spec', m.spec,
    'caliper', m.caliper,
    'match', m.match,
    'loc_match_qty', m.loc_match_qty,
    'initial_ptr', m.initial_ptr,
    'av_note', m.av_note,
    'pic_note', m.pic_note,
    'sales_note', m.sales_note,
    'photo_link', m.photo_link,
    'photo_name', m.photo_name
  ) order by m.locationcode nulls last, m.lotcode nulls last, m.unique_id), '[]'::jsonb)
  from public.ph_master_inventory m
  where lower(trim(coalesce(m.itemcode, ''))) = lower(trim(coalesce(p_itemcode, '')))
$function$;

create or replace function private.eval_work_settings_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select s.value
    from public.ph_app_settings s
    where s.key = 'current_season_salesyear'
    limit 1
  ), '{}'::jsonb)
$function$;

create or replace function private.eval_work_assert_actor_v1(p_username text)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  profile_row public.profiles;
begin
  select p.* into profile_row
  from public.profiles p
  where lower(p.username) = lower(trim(coalesce(p_username, '')))
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
  limit 1;
  if profile_row.id is null then
    raise exception using errcode = '42501', message = 'eval_work_actor_not_authorized';
  end if;
  return profile_row;
end
$function$;

create or replace function private.validate_eval_work_inquiry_v1(
  p_inquiry jsonb,
  p_itemcode text,
  p_context_rows jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  allowed_actions constant text[] := array['hold','take_off_hold','stop_ship','off_stop_ship','recount','priority_change','move_up','move_down'];
  allowed_seasons constant text[] := array['F1','S1','U1','U2','U3','X','Y','Z'];
  action_value text;
  overlay jsonb;
  proposal jsonb;
  current_row jsonb;
  uid text;
  original_oh numeric;
  move_total numeric;
  move_qty numeric;
  destination text;
  priority_value text;
  code_value text;
  reason_value text;
begin
  if p_inquiry is null or jsonb_typeof(p_inquiry) <> 'object' then
    raise exception using errcode = '22023', message = 'eval_work_inquiry_invalid';
  end if;
  if coalesce(p_inquiry->>'workflowPolicyVersion', 'reclass-action-workflow-v3-row-actions-20260826')
      <> 'reclass-action-workflow-v3-row-actions-20260826' then
    raise exception using errcode = '22023', message = 'eval_work_inquiry_policy_conflict';
  end if;
  if jsonb_typeof(coalesce(p_inquiry#>'{transaction,requestActions}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'eval_work_inquiry_shape_invalid';
  end if;
  for action_value in select jsonb_array_elements_text(coalesce(p_inquiry#>'{transaction,requestActions}', '[]'::jsonb)) loop
    if not (lower(action_value) = any(allowed_actions)) then
      raise exception using errcode = '22023', message = 'eval_work_action_invalid';
    end if;
  end loop;
  for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb)) loop
    uid := trim(coalesce(overlay->>'unique_id', ''));
    select value into current_row
    from jsonb_array_elements(coalesce(p_context_rows, '[]'::jsonb))
    where value->>'unique_id' = uid
    limit 1;
    if uid = '' or current_row is null then
      raise exception using errcode = '40001', message = 'eval_work_row_identity_conflict';
    end if;
    if lower(trim(coalesce(current_row->>'itemcode', ''))) <> lower(trim(coalesce(p_itemcode, '')))
       or coalesce(overlay#>>'{expected,itemcode}', current_row->>'itemcode') <> coalesce(current_row->>'itemcode', '')
       or coalesce(overlay#>>'{expected,lotcode}', current_row->>'lotcode') <> coalesce(current_row->>'lotcode', '')
       or coalesce(overlay#>>'{expected,locationcode}', current_row->>'locationcode') <> coalesce(current_row->>'locationcode', '') then
      raise exception using errcode = '40001', message = 'eval_work_row_identity_conflict';
    end if;
    if jsonb_typeof(coalesce(overlay->'proposals', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'eval_work_proposals_invalid';
    end if;
    original_oh := nullif(regexp_replace(coalesce(current_row->>'ptronhand', ''), '[^0-9.-]', '', 'g'), '')::numeric;
    move_total := 0;
    for proposal in select value from jsonb_array_elements(coalesce(overlay->'proposals', '[]'::jsonb)) loop
      action_value := lower(trim(coalesce(proposal->>'action', '')));
      if not (action_value = any(allowed_actions))
         or not (coalesce(p_inquiry#>'{transaction,requestActions}', '[]'::jsonb) ? action_value) then
        raise exception using errcode = '22023', message = 'eval_work_proposal_action_invalid';
      end if;
      if action_value in ('move_up', 'move_down') then
        if (select count(*) from jsonb_object_keys(proposal)) <> 3
           or not (proposal ?& array['action','moveQuantity','destinationSeason']) then
          raise exception using errcode = '22023', message = 'eval_work_move_fields_invalid';
        end if;
        move_qty := nullif(trim(coalesce(proposal->>'moveQuantity', '')), '')::numeric;
        destination := upper(trim(coalesce(proposal->>'destinationSeason', '')));
        if move_qty is null or move_qty <> trunc(move_qty) or move_qty < 1 or original_oh is null or move_qty > original_oh
           or not (destination = any(allowed_seasons)) or destination = upper(coalesce(current_row->>'season', '')) then
          raise exception using errcode = '22023', message = 'eval_work_move_invalid';
        end if;
        move_total := move_total + move_qty;
      elsif action_value = 'priority_change' then
        if (select count(*) from jsonb_object_keys(proposal)) <> 2 or not (proposal ?& array['action','priority']) then
          raise exception using errcode = '22023', message = 'eval_work_priority_fields_invalid';
        end if;
        priority_value := trim(coalesce(proposal->>'priority', ''));
        if priority_value <> '' and (priority_value !~ '^[0-9]+$' or priority_value::integer < 1 or priority_value::integer > 99) then
          raise exception using errcode = '22023', message = 'eval_work_priority_invalid';
        end if;
        if priority_value = trim(coalesce(current_row->>'priority', '')) then
          raise exception using errcode = '22023', message = 'eval_work_priority_unchanged';
        end if;
      elsif action_value in ('hold', 'stop_ship', 'take_off_hold', 'off_stop_ship') then
        if (select count(*) from jsonb_object_keys(proposal)) <> 3
           or not (proposal ?& array['action','holdstopcode','holdstopreason']) then
          raise exception using errcode = '22023', message = 'eval_work_hold_fields_invalid';
        end if;
        code_value := upper(trim(coalesce(proposal->>'holdstopcode', '')));
        reason_value := trim(coalesce(proposal->>'holdstopreason', ''));
        if action_value = 'hold' and (code_value <> 'H' or reason_value = '') then
          raise exception using errcode = '22023', message = 'eval_work_on_hold_invalid';
        elsif action_value = 'stop_ship' and (code_value <> 'S' or reason_value = '') then
          raise exception using errcode = '22023', message = 'eval_work_on_stop_invalid';
        elsif action_value = 'take_off_hold' and (code_value <> '' or reason_value <> '' or upper(trim(coalesce(current_row->>'holdstopcode', ''))) <> 'H') then
          raise exception using errcode = '22023', message = 'eval_work_off_hold_invalid';
        elsif action_value = 'off_stop_ship' and (code_value <> '' or reason_value <> '' or upper(trim(coalesce(current_row->>'holdstopcode', ''))) <> 'S') then
          raise exception using errcode = '22023', message = 'eval_work_off_stop_invalid';
        end if;
      elsif action_value = 'recount' then
        if (select count(*) from jsonb_object_keys(proposal)) <> 1 then
          raise exception using errcode = '22023', message = 'eval_work_recount_fields_invalid';
        end if;
      end if;
    end loop;
    if original_oh is not null and move_total > original_oh then
      raise exception using errcode = '22023', message = 'eval_work_combined_move_exceeds_oh';
    end if;
  end loop;
end
$function$;

create or replace function public.create_eval_work_v1(p_payload jsonb)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  assignee public.profiles;
  origin public.ph_master_inventory;
  context_rows jsonb;
  settings jsonb;
  inquiry jsonb;
  recipients text[];
  new_work public.ph_eval_work;
  delivery public.ph_request_delivery_outbox;
  create_token_value text;
begin
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly') then
    raise exception using errcode = '42501', message = 'eval_work_create_forbidden';
  end if;
  create_token_value := trim(coalesce(p_payload->>'createToken', ''));
  if length(create_token_value) < 16 or length(create_token_value) > 240 then
    raise exception using errcode = '22023', message = 'eval_work_create_token_invalid';
  end if;
  select * into new_work from public.ph_eval_work where create_token = create_token_value limit 1;
  if new_work.id is not null then
    if lower(new_work.creator_username) <> lower(actor.username) then
      raise exception using errcode = '42501', message = 'eval_work_create_token_forbidden';
    end if;
    return new_work;
  end if;
  assignee := private.eval_work_assert_actor_v1(p_payload->>'assigneeUsername');
  if trim(coalesce(p_payload->>'assigneeEmail', '')) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'eval_work_assignee_email_invalid';
  end if;
  select coalesce(array_agg(distinct lower(trim(value))) filter (where trim(value) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'), '{}'::text[])
    into recipients
  from jsonb_array_elements_text(coalesce(p_payload->'completionRecipients', '[]'::jsonb));
  if cardinality(recipients) = 0 then
    raise exception using errcode = '22023', message = 'eval_work_completion_recipient_required';
  end if;
  select m.* into origin
  from public.ph_master_inventory m
  where m.unique_id = trim(coalesce(p_payload#>>'{source,unique_id}', p_payload->>'originUniqueId'))
  limit 1;
  if origin.unique_id is null
     or lower(trim(coalesce(origin.itemcode, ''))) <> lower(trim(coalesce(p_payload#>>'{source,itemcode}', p_payload->>'itemcode', '')))
     or trim(coalesce(origin.locationcode, '')) <> trim(coalesce(p_payload#>>'{source,locationcode}', p_payload->>'originLocationcode', ''))
     or trim(coalesce(origin.lotcode, '')) <> trim(coalesce(p_payload#>>'{source,lotcode}', p_payload->>'originLotcode', '')) then
    raise exception using errcode = '40001', message = 'eval_work_origin_identity_conflict';
  end if;
  context_rows := private.eval_work_context_rows_v1(origin.itemcode);
  settings := private.eval_work_settings_v1();
  if jsonb_typeof(settings) <> 'object' or coalesce(settings->>'seasonCode', '') = '' or coalesce(settings->>'salesYear', '') = '' then
    raise exception using errcode = '40001', message = 'eval_work_settings_unavailable';
  end if;
  inquiry := coalesce(p_payload->'inquiry', jsonb_build_object(
    'type', 'reclass_inquiry_email',
    'workflowPolicyVersion', 'reclass-action-workflow-v3-row-actions-20260826',
    'source', jsonb_build_object('unique_id', origin.unique_id, 'itemcode', origin.itemcode, 'lotcode', origin.lotcode, 'locationcode', origin.locationcode),
    'transaction', jsonb_build_object('requestActions', jsonb_build_array(), 'holdStopProposals', jsonb_build_array(), 'scope', jsonb_build_object()),
    'rowOverlays', jsonb_build_array()
  ));
  perform private.validate_eval_work_inquiry_v1(inquiry, origin.itemcode, context_rows);

  insert into public.ph_eval_work (
    create_token, creator_username, creator_display, assignee_username, assignee_display, assignee_email,
    instructions, completion_recipients, itemcode, commonname, contsize,
    origin_unique_id, origin_locationcode, origin_lotcode, origin_source,
    origin_snapshot, context_rows, inventory_signature, settings_signature, inquiry_draft
  ) values (
    create_token_value, lower(actor.username), coalesce(nullif(actor.display_name, ''), actor.username), lower(assignee.username),
    coalesce(nullif(assignee.display_name, ''), assignee.username), lower(trim(p_payload->>'assigneeEmail')),
    left(trim(coalesce(p_payload->>'instructions', '')), 4000), recipients,
    origin.itemcode, coalesce(origin.commonname, ''), coalesce(origin.contsize, ''),
    origin.unique_id, coalesce(origin.locationcode, ''), coalesce(origin.lotcode, ''), coalesce(origin.source, ''),
    to_jsonb(origin), context_rows, md5(context_rows::text), md5(settings::text), inquiry
  ) returning * into new_work;

  insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
  values (new_work.id, 'created', lower(actor.username), new_work.version, jsonb_build_object('proposalCount', coalesce(jsonb_array_length(inquiry#>'{transaction,requestActions}'), 0))) ;

  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
  values (
    'eval-work:' || new_work.id::text || ':assignment:v' || new_work.version::text,
    'eval_work_assignment', new_work.id::text,
    jsonb_build_object(
      'contractVersion', 'eval-work-v1', 'deliveryKind', 'assignment', 'evalWorkId', new_work.id,
      'assigneeUsername', new_work.assignee_username, 'assigneeDisplay', new_work.assignee_display,
      'assigneeEmail', new_work.assignee_email, 'creatorUsername', new_work.creator_username,
      'creatorDisplay', new_work.creator_display, 'instructions', new_work.instructions,
      'itemcode', new_work.itemcode, 'commonname', new_work.commonname, 'contsize', new_work.contsize,
      'source', jsonb_build_object('unique_id', new_work.origin_unique_id, 'itemcode', new_work.itemcode, 'locationcode', new_work.origin_locationcode, 'lotcode', new_work.origin_lotcode, 'source_table', 'ph_master_inventory'),
      'inquiry', new_work.inquiry_draft
    ), 'pending', now()
  ) on conflict (event_key) do update set updated_at = now()
  returning * into delivery;
  update public.ph_eval_work set assignment_event_id = delivery.event_id where id = new_work.id returning * into new_work;
  return new_work;
end
$function$;

create or replace function public.save_eval_work_v1(
  p_work_id uuid,
  p_actor_username text,
  p_expected_version integer,
  p_inquiry jsonb,
  p_evidence jsonb
)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  current_rows jsonb;
  baseline_row jsonb;
  current_row jsonb;
  overlay jsonb;
  proposed_uid text;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or lower(work.assignee_username) <> lower(actor.username) then
    raise exception using errcode = '42501', message = 'eval_work_edit_forbidden';
  end if;
  if work.status not in ('open', 'in_progress') then raise exception using errcode = '22023', message = 'eval_work_not_editable'; end if;
  if work.version <> p_expected_version then raise exception using errcode = '40001', message = 'eval_work_version_conflict'; end if;
  current_rows := private.eval_work_context_rows_v1(work.itemcode);
  for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb)) loop
    if jsonb_array_length(coalesce(overlay->'proposals', '[]'::jsonb)) = 0 then continue; end if;
    proposed_uid := trim(coalesce(overlay->>'unique_id', ''));
    select value into baseline_row from jsonb_array_elements(coalesce(work.context_rows, '[]'::jsonb)) where value->>'unique_id' = proposed_uid limit 1;
    select value into current_row from jsonb_array_elements(coalesce(current_rows, '[]'::jsonb)) where value->>'unique_id' = proposed_uid limit 1;
    if baseline_row is null or current_row is null
       or coalesce(baseline_row->>'itemcode', '') <> coalesce(current_row->>'itemcode', '')
       or coalesce(baseline_row->>'locationcode', '') <> coalesce(current_row->>'locationcode', '')
       or coalesce(baseline_row->>'lotcode', '') <> coalesce(current_row->>'lotcode', '')
       or coalesce(baseline_row->>'ptronhand', '') <> coalesce(current_row->>'ptronhand', '') then
      raise exception using errcode = '40001', message = 'eval_work_target_conflict';
    end if;
  end loop;
  perform private.validate_eval_work_inquiry_v1(coalesce(p_inquiry, work.inquiry_draft), work.itemcode, current_rows);
  update public.ph_eval_work set
    inquiry_draft = coalesce(p_inquiry, inquiry_draft),
    evidence_draft = coalesce(p_evidence, evidence_draft),
    context_rows = current_rows,
    inventory_signature = md5(current_rows::text),
    status = 'in_progress',
    started_at = coalesce(started_at, now()),
    version = version + 1,
    updated_at = now()
  where id = work.id returning * into work;
  insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
  values (work.id, 'draft_saved', lower(actor.username), work.version, '{}'::jsonb);
  return work;
end
$function$;

create or replace function public.submit_eval_work_v1(
  p_work_id uuid,
  p_actor_username text,
  p_expected_version integer,
  p_inquiry jsonb,
  p_evidence jsonb,
  p_submission_token text
)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  origin public.ph_master_inventory;
  current_rows jsonb;
  settings jsonb;
  photos jsonb;
  photo_links text;
  photo_names text;
  photo jsonb;
  photo_path text;
  spec_value text;
  match_value numeric;
  av_note_value text;
  ptr_value numeric;
  delivery public.ph_request_delivery_outbox;
  baseline_row jsonb;
  current_row jsonb;
  overlay jsonb;
  proposed_uid text;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or lower(work.assignee_username) <> lower(actor.username) then
    raise exception using errcode = '42501', message = 'eval_work_submit_forbidden';
  end if;
  if work.status = 'submitted' and work.submission_token = trim(coalesce(p_submission_token, '')) then return work; end if;
  if length(trim(coalesce(p_submission_token, ''))) < 16 or length(trim(coalesce(p_submission_token, ''))) > 240 then raise exception using errcode = '22023', message = 'eval_work_submission_token_invalid'; end if;
  if work.status not in ('open', 'in_progress') then raise exception using errcode = '22023', message = 'eval_work_not_submittable'; end if;
  if work.version <> p_expected_version then raise exception using errcode = '40001', message = 'eval_work_version_conflict'; end if;
  select * into origin from public.ph_master_inventory where unique_id = work.origin_unique_id for update;
  if origin.unique_id is null or lower(trim(coalesce(origin.itemcode, ''))) <> lower(trim(work.itemcode))
     or coalesce(origin.locationcode, '') <> work.origin_locationcode or coalesce(origin.lotcode, '') <> work.origin_lotcode then
    raise exception using errcode = '40001', message = 'eval_work_origin_identity_conflict';
  end if;
  current_rows := private.eval_work_context_rows_v1(work.itemcode);
  settings := private.eval_work_settings_v1();
  if md5(settings::text) <> work.settings_signature then
    raise exception using errcode = '40001', message = 'eval_work_settings_conflict';
  end if;
  for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays', '[]'::jsonb)) loop
    if jsonb_array_length(coalesce(overlay->'proposals', '[]'::jsonb)) = 0 then continue; end if;
    proposed_uid := trim(coalesce(overlay->>'unique_id', ''));
    select value into baseline_row from jsonb_array_elements(coalesce(work.context_rows, '[]'::jsonb)) where value->>'unique_id' = proposed_uid limit 1;
    select value into current_row from jsonb_array_elements(coalesce(current_rows, '[]'::jsonb)) where value->>'unique_id' = proposed_uid limit 1;
    if baseline_row is null or current_row is null
       or coalesce(baseline_row->>'itemcode', '') <> coalesce(current_row->>'itemcode', '')
       or coalesce(baseline_row->>'locationcode', '') <> coalesce(current_row->>'locationcode', '')
       or coalesce(baseline_row->>'lotcode', '') <> coalesce(current_row->>'lotcode', '')
       or coalesce(baseline_row->>'ptronhand', '') <> coalesce(current_row->>'ptronhand', '') then
      raise exception using errcode = '40001', message = 'eval_work_target_conflict';
    end if;
  end loop;
  perform private.validate_eval_work_inquiry_v1(coalesce(p_inquiry, work.inquiry_draft), work.itemcode, current_rows);

  photos := coalesce(p_evidence->'photos', '[]'::jsonb);
  spec_value := trim(coalesce(p_evidence->>'spec', ''));
  av_note_value := trim(coalesce(p_evidence->>'avNote', ''));
  if jsonb_typeof(photos) <> 'array' or jsonb_array_length(photos) = 0 then raise exception using errcode = '22023', message = 'eval_work_photo_required'; end if;
  if spec_value = '' then raise exception using errcode = '22023', message = 'eval_work_spec_required'; end if;
  if av_note_value = '' then raise exception using errcode = '22023', message = 'eval_work_av_note_required'; end if;
  begin match_value := trim(coalesce(p_evidence->>'locMatchPercent', ''))::numeric;
  exception when others then raise exception using errcode = '22023', message = 'eval_work_loc_match_invalid'; end;
  if match_value < 0 or match_value > 100 then raise exception using errcode = '22023', message = 'eval_work_loc_match_invalid'; end if;
  for photo in select value from jsonb_array_elements(photos) loop
    photo_path := trim(coalesce(photo->>'filePath', photo->>'file_path', photo->>'path', ''));
    if left(photo_path, length('eval/' || work.id::text || '/')) <> 'eval/' || work.id::text || '/'
       or position('..' in photo_path) > 0 then
      raise exception using errcode = '22023', message = 'eval_work_photo_scope_invalid';
    end if;
  end loop;
  select string_agg(trim(value->>'url'), E'\n' order by ordinality), string_agg(trim(coalesce(value->>'name', 'eval-photo')), E'\n' order by ordinality)
    into photo_links, photo_names
  from jsonb_array_elements(photos) with ordinality
  where trim(coalesce(value->>'url', '')) <> '';
  if coalesce(photo_links, '') = '' then raise exception using errcode = '22023', message = 'eval_work_committed_photo_required'; end if;
  begin ptr_value := nullif(regexp_replace(coalesce(origin.ptravailable, ''), '[^0-9.-]', '', 'g'), '')::numeric; exception when others then ptr_value := null; end;

  update public.ph_master_inventory set
    spec = spec_value,
    match = trim(to_char(match_value, 'FM999990.##')),
    initial_ptr = case when trim(coalesce(initial_ptr, '')) <> '' or ptr_value is null then initial_ptr else trim(to_char(ptr_value, 'FM999999990.##')) end,
    loc_match_qty = case when ptr_value is null then loc_match_qty else round(ptr_value * match_value / 100)::text end,
    av_note = av_note_value,
    caliper = case when trim(coalesce(p_evidence->>'caliper', '')) = '' then caliper else trim(p_evidence->>'caliper') end,
    pic_note = case when trim(coalesce(p_evidence->>'pickNote', '')) = '' then pic_note else trim(p_evidence->>'pickNote') end,
    sales_note = case when trim(coalesce(p_evidence->>'comments', '')) = '' then sales_note else trim(p_evidence->>'comments') end,
    photo_link = photo_links,
    photo_name = photo_names,
    last_updated = now()
  where unique_id = origin.unique_id;

  update public.ph_eval_work set
    inquiry_draft = coalesce(p_inquiry, inquiry_draft), evidence_draft = p_evidence,
    submitted_inquiry = coalesce(p_inquiry, inquiry_draft), submitted_evidence = p_evidence,
    context_rows = current_rows, inventory_signature = md5(current_rows::text),
    status = 'submitted', submission_token = trim(p_submission_token), submitted_at = now(), version = version + 1, updated_at = now()
  where id = work.id returning * into work;
  insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
  values (work.id, 'submitted', lower(actor.username), work.version,
    jsonb_build_object('photoCount', jsonb_array_length(photos), 'proposalCount', coalesce(jsonb_array_length(work.submitted_inquiry#>'{transaction,requestActions}'), 0)));
  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
  values (
    'eval-work:' || work.id::text || ':completion:v' || work.version::text,
    'eval_work_completion', work.id::text,
    jsonb_build_object(
      'contractVersion', 'eval-work-v1', 'deliveryKind', 'completion', 'evalWorkId', work.id,
      'assigneeUsername', work.assignee_username, 'assigneeDisplay', work.assignee_display,
      'creatorUsername', work.creator_username, 'creatorDisplay', work.creator_display,
      'completionRecipients', to_jsonb(work.completion_recipients), 'instructions', work.instructions,
      'itemcode', work.itemcode, 'commonname', work.commonname, 'contsize', work.contsize,
      'source', jsonb_build_object('unique_id', work.origin_unique_id, 'itemcode', work.itemcode, 'locationcode', work.origin_locationcode, 'lotcode', work.origin_lotcode, 'source_table', 'ph_master_inventory'),
      'inquiry', work.submitted_inquiry, 'evidence', work.submitted_evidence
    ), 'pending', now()
  ) on conflict (event_key) do update set updated_at = now()
  returning * into delivery;
  update public.ph_eval_work set completion_event_id = delivery.event_id where id = work.id returning * into work;
  return work;
end
$function$;

create or replace function public.reassign_eval_work_v1(
  p_work_id uuid,
  p_actor_username text,
  p_expected_version integer,
  p_assignee_username text,
  p_assignee_email text
)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  assignee public.profiles;
  work public.ph_eval_work;
  delivery public.ph_request_delivery_outbox;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly') then raise exception using errcode = '42501', message = 'eval_work_manage_forbidden'; end if;
  assignee := private.eval_work_assert_actor_v1(p_assignee_username);
  if trim(coalesce(p_assignee_email, '')) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode = '22023', message = 'eval_work_assignee_email_invalid'; end if;
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or work.status not in ('open', 'in_progress') then raise exception using errcode = '22023', message = 'eval_work_not_reassignable'; end if;
  if work.version <> p_expected_version then raise exception using errcode = '40001', message = 'eval_work_version_conflict'; end if;
  if exists (
    select 1 from public.ph_request_delivery_outbox o
    where o.event_id = work.assignment_event_id and o.status = 'processing'
  ) then
    raise exception using errcode = '40001', message = 'eval_work_assignment_delivery_in_progress';
  end if;
  update public.ph_request_delivery_outbox
  set status = 'suppressed', sanitized_error_code = 'EVAL_WORK_REASSIGNED', updated_at = now()
  where event_id = work.assignment_event_id and status in ('pending', 'failed', 'unknown');
  update public.ph_eval_work set assignee_username = lower(assignee.username), assignee_display = coalesce(nullif(assignee.display_name, ''), assignee.username),
    assignee_email = lower(trim(p_assignee_email)), version = version + 1, updated_at = now()
  where id = work.id returning * into work;
  insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
  values (work.id, 'reassigned', lower(actor.username), work.version, '{}'::jsonb);
  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
  values ('eval-work:' || work.id::text || ':assignment:v' || work.version::text, 'eval_work_assignment', work.id::text,
    jsonb_build_object('contractVersion','eval-work-v1','deliveryKind','assignment','evalWorkId',work.id,'assigneeUsername',work.assignee_username,'assigneeDisplay',work.assignee_display,'assigneeEmail',work.assignee_email,'creatorUsername',work.creator_username,'creatorDisplay',work.creator_display,'instructions',work.instructions,'itemcode',work.itemcode,'commonname',work.commonname,'contsize',work.contsize,'source',jsonb_build_object('unique_id',work.origin_unique_id,'itemcode',work.itemcode,'locationcode',work.origin_locationcode,'lotcode',work.origin_lotcode,'source_table','ph_master_inventory'),'inquiry',work.inquiry_draft), 'pending', now())
  on conflict (event_key) do update set updated_at = now() returning * into delivery;
  update public.ph_eval_work set assignment_event_id = delivery.event_id where id = work.id returning * into work;
  return work;
end
$function$;

create or replace function public.cancel_eval_work_v1(
  p_work_id uuid,
  p_actor_username text,
  p_expected_version integer
)
returns public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly') then raise exception using errcode = '42501', message = 'eval_work_manage_forbidden'; end if;
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null or work.status not in ('open', 'in_progress') then raise exception using errcode = '22023', message = 'eval_work_not_cancellable'; end if;
  if work.version <> p_expected_version then raise exception using errcode = '40001', message = 'eval_work_version_conflict'; end if;
  if exists (
    select 1 from public.ph_request_delivery_outbox o
    where o.event_id = work.assignment_event_id and o.status = 'processing'
  ) then
    raise exception using errcode = '40001', message = 'eval_work_assignment_delivery_in_progress';
  end if;
  update public.ph_request_delivery_outbox
  set status = 'suppressed', sanitized_error_code = 'EVAL_WORK_CANCELLED', updated_at = now()
  where event_id = work.assignment_event_id and status in ('pending', 'failed', 'unknown');
  update public.ph_eval_work set status = 'cancelled', cancelled_at = now(), cancelled_by = lower(actor.username), version = version + 1, updated_at = now()
  where id = work.id returning * into work;
  insert into public.ph_eval_work_events(eval_work_id, event_type, actor_username, version, metadata)
  values (work.id, 'cancelled', lower(actor.username), work.version, '{}'::jsonb);
  return work;
end
$function$;

revoke all on function public.create_eval_work_v1(jsonb) from public, anon, authenticated;
revoke all on function public.save_eval_work_v1(uuid, text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.submit_eval_work_v1(uuid, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.reassign_eval_work_v1(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.cancel_eval_work_v1(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.create_eval_work_v1(jsonb) to service_role;
grant execute on function public.save_eval_work_v1(uuid, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.submit_eval_work_v1(uuid, text, integer, jsonb, jsonb, text) to service_role;
grant execute on function public.reassign_eval_work_v1(uuid, text, integer, text, text) to service_role;
grant execute on function public.cancel_eval_work_v1(uuid, text, integer) to service_role;

revoke all on function private.eval_work_context_rows_v1(text) from public, anon, authenticated;
revoke all on function private.eval_work_settings_v1() from public, anon, authenticated;
revoke all on function private.eval_work_assert_actor_v1(text) from public, anon, authenticated;
revoke all on function private.validate_eval_work_inquiry_v1(jsonb, text, jsonb) from public, anon, authenticated;

do $block$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ph_eval_work'
     ) then
    alter publication supabase_realtime add table public.ph_eval_work;
  end if;
end
$block$;

commit;
