begin;

-- Route manager-order source rows through one bounded, service-owned operation.
-- This avoids depending on a direct PostgREST table upsert while preserving the
-- existing immutable batch/finalization contract for both Pikes and Stine.
create or replace function public.append_manager_order_source_rows_v1(
  p_batch_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.ph_pikes_order_batches%rowtype;
  input_count integer;
  accepted_count integer := 0;
  total_count integer := 0;
begin
  if p_batch_id is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 200 then
    raise exception 'MANAGER_ORDER_SOURCE_ROWS_INVALID';
  end if;

  select * into target
  from public.ph_pikes_order_batches b
  where b.batch_id = p_batch_id
  for update;

  if not found then raise exception 'MANAGER_ORDER_IMPORT_MANIFEST_MISSING'; end if;
  if target.source_key not in ('pikes', 'stine_lumber') then raise exception 'MANAGER_ORDER_SOURCE_INVALID'; end if;
  if target.status <> 'importing' then raise exception 'MANAGER_ORDER_IMPORT_INVALID_STATE'; end if;

  input_count := jsonb_array_length(p_rows);

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(
      "sourceRowNumber" integer,
      itemcode text,
      "itemcodeNormalized" text,
      "orderTot" text,
      "pickNotes" text
    )
    where x."sourceRowNumber" is null
       or x."sourceRowNumber" < 1
       or nullif(btrim(x.itemcode), '') is null
       or nullif(btrim(x."itemcodeNormalized"), '') is null
       or upper(btrim(x."itemcodeNormalized")) <> upper(btrim(x.itemcode))
  ) then
    raise exception 'MANAGER_ORDER_SOURCE_ROWS_INVALID';
  end if;

  if (
    select count(distinct x."sourceRowNumber")
    from jsonb_to_recordset(p_rows) as x("sourceRowNumber" integer)
  ) <> input_count then
    raise exception 'MANAGER_ORDER_SOURCE_ROWS_DUPLICATE';
  end if;

  insert into public.ph_pikes_order_source_rows (
    batch_id, source_row_number, itemcode, itemcode_normalized,
    order_tot, pick_notes, matched
  )
  select
    p_batch_id,
    x."sourceRowNumber",
    btrim(x.itemcode),
    upper(btrim(x."itemcodeNormalized")),
    nullif(btrim(coalesce(x."orderTot", '')), ''),
    nullif(btrim(coalesce(x."pickNotes", '')), ''),
    false
  from jsonb_to_recordset(p_rows) as x(
    "sourceRowNumber" integer,
    itemcode text,
    "itemcodeNormalized" text,
    "orderTot" text,
    "pickNotes" text
  )
  on conflict (batch_id, source_row_number) do update
  set itemcode = excluded.itemcode,
      itemcode_normalized = excluded.itemcode_normalized,
      order_tot = excluded.order_tot,
      pick_notes = excluded.pick_notes,
      matched = false;

  get diagnostics accepted_count = row_count;
  if accepted_count <> input_count then
    raise exception 'MANAGER_ORDER_SOURCE_ROW_COUNT_MISMATCH';
  end if;

  select count(*)::integer into total_count
  from public.ph_pikes_order_source_rows r
  where r.batch_id = p_batch_id;

  return jsonb_build_object(
    'status', 'accepted',
    'batchId', p_batch_id,
    'acceptedCount', accepted_count,
    'totalCount', total_count
  );
end;
$$;

revoke all on function public.append_manager_order_source_rows_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_manager_order_source_rows_v1(uuid, jsonb)
  to service_role;

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('rpc.manager.orders.source_rows', 'manager.orders.view', 'rpc',
   'Service-only bounded manager-order source row ingestion for Pikes and Stine Lumber.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;

notify pgrst, 'reload schema';

commit;
