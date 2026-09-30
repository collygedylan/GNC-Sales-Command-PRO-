begin;

-- Count parsing must not throw on malformed telemetry. Preserve integer/text
-- inputs accepted by the old singleton check, but classify invalid values bad.
create or replace function private.eval_itemcode_health_count_v1(p_value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case when jsonb_typeof(p_value) in ('number', 'string')
    and btrim(p_value #>> '{}') ~ '^[+-]?[0-9]{1,10}$' then
      case when (btrim(p_value #>> '{}'))::bigint between -2147483648 and 2147483647
        then (btrim(p_value #>> '{}'))::integer end
    end
$function$;

-- These helpers inspect immutable assignment evidence, never live inventory.
-- They are private/invoker-only; only the existing service-only health RPC
-- supplies the privileged read context. No delivery/history row is rewritten.
create or replace function private.eval_itemcode_health_member_valid_v1(p_payload jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  frozen_origins jsonb;
  expected_ids text[];
  supplied_ids text[];
  work_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload->>'contractVersion' is distinct from 'eval-work-v2-multi-origin'
     or p_payload->>'scopeContract' is distinct from 'itemcode-all-rows-v1'
     or p_payload->>'deliveryKind' is distinct from 'assignment'
     or jsonb_typeof(p_payload->'evalWorkId') is distinct from 'string'
     or jsonb_typeof(p_payload->'source') is distinct from 'object'
     or jsonb_typeof(p_payload->'origins') is distinct from 'array' then
    return false;
  end if;
  begin
    work_id := (p_payload->>'evalWorkId')::uuid;
  exception when invalid_text_representation then return false;
  end;
  if work_id::text is distinct from p_payload->>'evalWorkId' then return false; end if;
  select * into work from public.ph_eval_work where id = work_id;
  if work.id is null or work.source_context->>'scopeContract' is distinct from 'itemcode-all-rows-v1'
     or work.origin_count not between 1 and 100
     or p_payload->'membershipCount' is distinct from to_jsonb(work.origin_count)
     or (p_payload ? 'originCount' and p_payload->'originCount' is distinct from to_jsonb(work.origin_count))
     or work.source_context->'membershipCount' is distinct from to_jsonb(work.origin_count)
     or p_payload#>>'{source,unique_id}' is distinct from work.origin_unique_id
     or p_payload#>>'{source,itemcode}' is distinct from work.itemcode
     or p_payload#>>'{source,locationcode}' is distinct from work.origin_locationcode
     or p_payload#>>'{source,lotcode}' is distinct from work.origin_lotcode
     or p_payload#>>'{source,source_table}' is distinct from 'ph_master_inventory'
     or nullif(work.source_context->>'membershipSignature', '') is null
     or p_payload->>'membershipSignature' is distinct from work.source_context->>'membershipSignature'
     or jsonb_array_length(p_payload->'origins') <> work.origin_count then
    return false;
  end if;
  select jsonb_agg(origin_snapshot order by ordinal), array_agg(origin_unique_id order by origin_unique_id)
    into frozen_origins, expected_ids
  from public.ph_eval_work_origin_rows where eval_work_id = work.id;
  if coalesce(cardinality(expected_ids), 0) <> work.origin_count then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'origins') origin
             where jsonb_typeof(origin) is distinct from 'object'
                or jsonb_typeof(origin->'unique_id') is distinct from 'string'
                or coalesce(origin->>'unique_id', '') = '') then return false; end if;
  select array_agg(origin->>'unique_id' order by origin->>'unique_id') into supplied_ids
  from jsonb_array_elements(p_payload->'origins') origin;
  -- Array equality rejects duplicates, missing and foreign IDs at equal count.
  -- The existing signature also freezes item/location/lot/source/on-hand and
  -- ordering; comparing both signatures detects forged or swapped snapshots.
  return supplied_ids = expected_ids
    and private.eval_work_membership_signature_v1(frozen_origins) = work.source_context->>'membershipSignature'
    and private.eval_work_membership_signature_v1(p_payload->'origins') = work.source_context->>'membershipSignature';
end
$function$;

create or replace function private.eval_itemcode_health_group_valid_v1(p_payload jsonb, p_request_id text, p_event_key text)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  member_count integer;
  nested_ids text[];
  declared_ids text[];
  batch_token_value text;
  batch_ids text[];
  representative_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload->>'contractVersion' is distinct from 'eval-work-assignment-batch-v1'
     or p_payload->>'deliveryKind' is distinct from 'assignment'
     or jsonb_typeof(p_payload->'assignments') is distinct from 'array'
     or jsonb_typeof(p_payload->'evalWorkIds') is distinct from 'array'
     or jsonb_typeof(p_payload->'assignmentRecipients') is distinct from 'array' then return false; end if;
  member_count := jsonb_array_length(p_payload->'assignments');
  if member_count not between 2 and 50
     or p_payload->'assignmentCount' is distinct from to_jsonb(member_count)
     or jsonb_array_length(p_payload->'evalWorkIds') <> member_count
     or jsonb_array_length(p_payload->'assignmentRecipients') = 0 then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'evalWorkIds') id
             where jsonb_typeof(id) is distinct from 'string' or coalesce(id #>> '{}', '') = '')
     or exists (select 1 from jsonb_array_elements(p_payload->'assignments') member
                where not private.eval_itemcode_health_member_valid_v1(member)) then return false; end if;
  select array_agg(member->>'evalWorkId' order by member->>'evalWorkId') into nested_ids
  from jsonb_array_elements(p_payload->'assignments') member;
  select array_agg(id #>> '{}' order by id #>> '{}') into declared_ids
  from jsonb_array_elements(p_payload->'evalWorkIds') id;
  begin
    representative_id := p_request_id::uuid;
  exception when invalid_text_representation then return false;
  end;
  if representative_id::text is distinct from p_request_id then return false; end if;
  select batch_token into batch_token_value from public.ph_eval_work where id = representative_id;
  if nullif(btrim(batch_token_value), '') is null
     or p_event_key is distinct from 'eval-report2-batch:' || md5(btrim(batch_token_value)) || ':assignment:v1' then return false; end if;
  select array_agg(id::text order by id::text) into batch_ids
  from public.ph_eval_work where batch_token = batch_token_value;
  return coalesce(nested_ids = declared_ids
    and nested_ids = batch_ids
    and p_request_id = any(declared_ids)
    and (select count(distinct id) from unnest(nested_ids) id) = member_count, false);
  -- Do not compare current assignment_event_id: a later legitimate reassign
  -- can move that pointer without invalidating this already-delivered history.
end
$function$;

revoke all on function private.eval_itemcode_health_member_valid_v1(jsonb) from public, anon, authenticated;
revoke all on function private.eval_itemcode_health_count_v1(jsonb) from public, anon, authenticated;
revoke all on function private.eval_itemcode_health_group_valid_v1(jsonb, text, text) from public, anon, authenticated;
grant execute on function private.eval_itemcode_health_member_valid_v1(jsonb) to service_role;
grant execute on function private.eval_itemcode_health_count_v1(jsonb) to service_role;
grant execute on function private.eval_itemcode_health_group_valid_v1(jsonb, text, text) to service_role;

create or replace function public.get_eval_itemcode_work_health_snapshot_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  contract_started_at constant timestamptz := '2026-09-03 18:24:00+00'::timestamptz;
  scoped_assignments bigint := 0;
  stored_membership_mismatches bigint := 0;
  pdf_origin_mismatches bigint := 0;
  historical_pdf_origin_mismatches bigint := 0;
  excel_attachment_violations bigint := 0;
  over_limit_assignments bigint := 0;
  largest_origin_count integer := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'EVAL_ITEMCODE_HEALTH_FORBIDDEN';
  end if;
  select count(*), coalesce(max(work.origin_count), 0), count(*) filter (where work.origin_count > 100)
    into scoped_assignments, largest_origin_count, over_limit_assignments
  from public.ph_eval_work work where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1';
  select count(*) into stored_membership_mismatches
  from public.ph_eval_work work
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
    and (coalesce(private.eval_itemcode_health_count_v1(work.source_context->'membershipCount'), -1) <> coalesce(work.origin_count, -1)
      or coalesce(work.source_context->>'membershipSignature', '') = ''
      or coalesce(work.origin_count, -1) <> (select count(*) from public.ph_eval_work_origin_rows origin where origin.eval_work_id = work.id));

  with inspected as (
    select delivery.created_at, case
      when delivery.payload->>'contractVersion' = 'eval-work-assignment-batch-v1' then
        delivery.event_type <> 'eval_work_assignment'
        or not private.eval_itemcode_health_group_valid_v1(delivery.payload, delivery.request_id, delivery.event_key)
      -- Unknown or misspelled envelopes cannot pass as a permissive singleton.
      when delivery.payload ? 'assignments' or delivery.payload ? 'evalWorkIds' then true
      else
        coalesce(delivery.payload->>'scopeContract', '') <> 'itemcode-all-rows-v1'
        or (delivery.payload->>'originCount' is not null and private.eval_itemcode_health_count_v1(delivery.payload->'originCount') is null)
        or (delivery.payload->>'membershipCount' is not null and private.eval_itemcode_health_count_v1(delivery.payload->'membershipCount') is null)
        or coalesce(private.eval_itemcode_health_count_v1(delivery.payload->'originCount'), private.eval_itemcode_health_count_v1(delivery.payload->'membershipCount'), -1) <> coalesce(work.origin_count, -1)
        or case when jsonb_typeof(delivery.payload->'origins') = 'array'
             then jsonb_array_length(delivery.payload->'origins') else 0 end <> coalesce(work.origin_count, -1)
      end as mismatch
    from public.ph_request_delivery_outbox delivery
    left join public.ph_eval_work work on work.id::text = delivery.request_id
    where delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
      and delivery.status <> 'suppressed'
      and (work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
        or delivery.payload->>'contractVersion' = 'eval-work-assignment-batch-v1'
        or delivery.payload ? 'assignments' or delivery.payload ? 'evalWorkIds')
  )
  select count(*) filter (where created_at >= contract_started_at),
         count(*) filter (where created_at < contract_started_at)
    into pdf_origin_mismatches, historical_pdf_origin_mismatches
  from inspected where mismatch;

  -- Preserve the original whole-payload Excel check, including nested members.
  select count(*) into excel_attachment_violations
  from public.ph_request_delivery_outbox delivery
  left join public.ph_eval_work work on work.id::text = delivery.request_id
  where (work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
      or delivery.payload->>'contractVersion' = 'eval-work-assignment-batch-v1'
      or delivery.payload ? 'assignments' or delivery.payload ? 'evalWorkIds')
    and delivery.created_at >= contract_started_at
    and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
    and delivery.status <> 'suppressed'
    and lower(delivery.payload::text) ~ '(\.xlsx|\.xls"|spreadsheetml|excelattachment)';
  return jsonb_build_object(
    'contract_version', 'eval-itemcode-work-health-v2', 'scope_contract', 'itemcode-all-rows-v1',
    'contract_started_at', contract_started_at, 'scoped_assignment_count', scoped_assignments,
    'stored_membership_mismatch_count', stored_membership_mismatches,
    'pdf_origin_mismatch_count', pdf_origin_mismatches,
    'historical_pdf_origin_mismatch_count', historical_pdf_origin_mismatches,
    'excel_attachment_violation_count', excel_attachment_violations,
    'over_limit_assignment_count', over_limit_assignments, 'largest_origin_count', largest_origin_count);
end
$function$;
revoke all on function public.get_eval_itemcode_work_health_snapshot_v2() from public, anon, authenticated;
grant execute on function public.get_eval_itemcode_work_health_snapshot_v2() to service_role;
comment on function public.get_eval_itemcode_work_health_snapshot_v2() is
  'Service-only read-only ITEMCODE health. Validates grouped assignment envelopes and every frozen member; preserves single-delivery checks, cutoff and immutable history.';
commit;
