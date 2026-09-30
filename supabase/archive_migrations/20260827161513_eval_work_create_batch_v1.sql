begin;

alter table public.ph_eval_work
  add column if not exists batch_token text,
  add column if not exists source_context jsonb not null default '{}'::jsonb;

alter table public.ph_eval_work
  drop constraint if exists ph_eval_work_source_context_size;
alter table public.ph_eval_work
  add constraint ph_eval_work_source_context_size
  check (octet_length(source_context::text) <= 8192);

create index if not exists ph_eval_work_batch_token_idx
  on public.ph_eval_work (batch_token, created_at desc)
  where batch_token is not null;

create unique index if not exists ph_eval_work_batch_item_unique
  on public.ph_eval_work (lower(creator_username), batch_token, lower(itemcode))
  where batch_token is not null;

create or replace function public.create_eval_work_batch_v1(p_payload jsonb)
returns setof public.ph_eval_work
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  item jsonb;
  origin public.ph_master_inventory;
  context_rows jsonb;
  settings jsonb;
  inquiry jsonb;
  create_payload jsonb;
  new_work public.ph_eval_work;
  batch_token_value text := trim(coalesce(p_payload->>'batchToken', ''));
  items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  item_count integer;
  distinct_item_count integer;
  report_context jsonb;
  overlay jsonb;
  temporary_key text;
  temporary_values jsonb;
  temporary_fields jsonb;
  temporary_limit integer;
begin
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly') then
    raise exception using errcode = '42501', message = 'eval_work_batch_create_forbidden';
  end if;
  if length(batch_token_value) < 16 or length(batch_token_value) > 200 then
    raise exception using errcode = '22023', message = 'eval_work_batch_token_invalid';
  end if;
  if jsonb_typeof(items) <> 'array' then
    raise exception using errcode = '22023', message = 'eval_work_batch_items_invalid';
  end if;
  item_count := jsonb_array_length(items);
  if item_count < 1 or item_count > 50 then
    raise exception using errcode = '22023', message = 'eval_work_batch_size_invalid';
  end if;
  select count(distinct lower(trim(coalesce(value#>>'{source,itemcode}', ''))))
    into distinct_item_count
  from jsonb_array_elements(items);
  if distinct_item_count <> item_count then
    raise exception using errcode = '22023', message = 'eval_work_batch_duplicate_itemcode';
  end if;

  -- Validate every member before creating any durable assignment. The RPC call
  -- is one database transaction, so any later conflict also rolls back all rows.
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) <> 'object'
       or length(trim(coalesce(item->>'createToken', ''))) < 16
       or jsonb_typeof(coalesce(item->'source', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(item->'inquiry', '{}'::jsonb)) <> 'object' then
      raise exception using errcode = '22023', message = 'eval_work_batch_item_invalid';
    end if;
    select m.* into origin
    from public.ph_master_inventory m
    where m.unique_id = trim(coalesce(item#>>'{source,unique_id}', ''))
    limit 1;
    if origin.unique_id is null
       or lower(trim(coalesce(origin.itemcode, ''))) <> lower(trim(coalesce(item#>>'{source,itemcode}', '')))
       or trim(coalesce(origin.locationcode, '')) <> trim(coalesce(item#>>'{source,locationcode}', ''))
       or trim(coalesce(origin.lotcode, '')) <> trim(coalesce(item#>>'{source,lotcode}', '')) then
      raise exception using errcode = '40001', message = 'eval_work_batch_origin_identity_conflict';
    end if;
    context_rows := private.eval_work_context_rows_v1(origin.itemcode);
    settings := private.eval_work_settings_v1();
    if jsonb_typeof(settings) <> 'object' or coalesce(settings->>'seasonCode', '') = '' or coalesce(settings->>'salesYear', '') = '' then
      raise exception using errcode = '40001', message = 'eval_work_batch_settings_unavailable';
    end if;
    inquiry := item->'inquiry';
    perform private.validate_eval_work_inquiry_v1(inquiry, origin.itemcode, context_rows);
    if jsonb_typeof(coalesce(inquiry->'rowOverlays', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(inquiry->'rowOverlays', '[]'::jsonb)) <> jsonb_array_length(context_rows)
       or (select count(distinct value->>'unique_id') from jsonb_array_elements(coalesce(inquiry->'rowOverlays', '[]'::jsonb))) <> jsonb_array_length(context_rows) then
      raise exception using errcode = '40001', message = 'eval_work_batch_complete_row_set_required';
    end if;
    for overlay in select value from jsonb_array_elements(coalesce(inquiry->'rowOverlays', '[]'::jsonb)) loop
      if (overlay ? 'temporaryValues') <> (overlay ? 'temporaryChangedFields') then
        raise exception using errcode = '22023', message = 'eval_work_batch_temporary_fields_invalid';
      end if;
      if overlay ? 'temporaryValues' then
        temporary_values := overlay->'temporaryValues';
        temporary_fields := overlay->'temporaryChangedFields';
        if jsonb_typeof(temporary_values) <> 'object'
           or jsonb_typeof(temporary_fields) <> 'array'
           or (select count(*) from jsonb_object_keys(temporary_values)) <> jsonb_array_length(temporary_fields)
           or (select count(distinct value) from jsonb_array_elements_text(temporary_fields)) <> jsonb_array_length(temporary_fields) then
          raise exception using errcode = '22023', message = 'eval_work_batch_temporary_fields_invalid';
        end if;
        for temporary_key in select key from jsonb_each(temporary_values) loop
          temporary_limit := case temporary_key
            when 'holdstopreason' then 1000
            when 'holdstopbegindate' then 180
            when 'locationnote' then 4000
            when 'locationnotedate' then 180
            when 'locationptn1' then 2000
            when 'suspendto' then 1000
            when 'specialpuller' then 1000
            else null
          end;
          if temporary_limit is null
             or not (temporary_fields ? temporary_key)
             or jsonb_typeof(temporary_values->temporary_key) <> 'string'
             or length(temporary_values->>temporary_key) > temporary_limit then
            raise exception using errcode = '22023', message = 'eval_work_batch_temporary_field_invalid';
          end if;
        end loop;
      end if;
    end loop;
    report_context := coalesce(item->'reportContext', '{}'::jsonb);
    if jsonb_typeof(report_context) <> 'object' or octet_length(report_context::text) > 4096 then
      raise exception using errcode = '22023', message = 'eval_work_batch_report_context_invalid';
    end if;
  end loop;

  for item in select value from jsonb_array_elements(items) loop
    create_payload := jsonb_build_object(
      'actorUsername', lower(actor.username),
      'createToken', trim(item->>'createToken'),
      'assigneeUsername', p_payload->>'assigneeUsername',
      'assigneeEmail', p_payload->>'assigneeEmail',
      'instructions', p_payload->>'instructions',
      'completionRecipients', coalesce(p_payload->'completionRecipients', '[]'::jsonb),
      'source', item->'source',
      'inquiry', item->'inquiry'
    );
    select * into new_work from public.create_eval_work_v1(create_payload);
    update public.ph_eval_work
    set batch_token = batch_token_value,
        source_context = jsonb_build_object(
          'report', coalesce(item->'reportContext', '{}'::jsonb),
          'inventorySignature', left(coalesce(p_payload->>'inventorySignature', ''), 512),
          'settingsSignature', left(coalesce(p_payload->>'settingsSignature', ''), 1024)
        ),
        updated_at = now()
    where id = new_work.id
    returning * into new_work;
    return next new_work;
  end loop;
  return;
end
$function$;

revoke all on function public.create_eval_work_batch_v1(jsonb) from public, anon, authenticated;
grant execute on function public.create_eval_work_batch_v1(jsonb) to service_role;

comment on function public.create_eval_work_batch_v1(jsonb) is
  'Service-only atomic and idempotent Eval Reports #2 batch creation. One item creates one Eval Work assignment and existing delivery-outbox event.';

commit;
