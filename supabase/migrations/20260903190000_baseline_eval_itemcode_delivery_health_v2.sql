begin;

-- The protected ITEMCODE-wide release became live after the timestamp below.
-- Keep earlier delivery history immutable, report it separately, and make the
-- blocking health signal apply to every delivery created by the new contract.
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

  select count(*), coalesce(max(work.origin_count), 0),
    count(*) filter (where work.origin_count > 100)
  into scoped_assignments, largest_origin_count, over_limit_assignments
  from public.ph_eval_work work
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1';

  select count(*) into stored_membership_mismatches
  from public.ph_eval_work work
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
    and (
      coalesce((work.source_context->>'membershipCount')::integer, -1) <> coalesce(work.origin_count, -1)
      or coalesce(work.source_context->>'membershipSignature', '') = ''
      or coalesce(work.origin_count, -1) <> (
        select count(*) from public.ph_eval_work_origin_rows origin where origin.eval_work_id = work.id
      )
    );

  with mismatches as (
    select delivery.created_at
    from public.ph_request_delivery_outbox delivery
    join public.ph_eval_work work on work.id::text = delivery.request_id
    where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
      and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
      and delivery.status <> 'suppressed'
      and (
        coalesce(delivery.payload->>'scopeContract', '') <> 'itemcode-all-rows-v1'
        or coalesce(
          (delivery.payload->>'originCount')::integer,
          (delivery.payload->>'membershipCount')::integer,
          -1
        ) <> coalesce(work.origin_count, -1)
        or coalesce(jsonb_array_length(delivery.payload->'origins'), 0) <> coalesce(work.origin_count, -1)
      )
  )
  select
    count(*) filter (where created_at >= contract_started_at),
    count(*) filter (where created_at < contract_started_at)
  into pdf_origin_mismatches, historical_pdf_origin_mismatches
  from mismatches;

  select count(*) into excel_attachment_violations
  from public.ph_request_delivery_outbox delivery
  join public.ph_eval_work work on work.id::text = delivery.request_id
  where work.source_context->>'scopeContract' = 'itemcode-all-rows-v1'
    and delivery.created_at >= contract_started_at
    and delivery.event_type in ('eval_work_assignment', 'eval_work_completion')
    and delivery.status <> 'suppressed'
    and lower(delivery.payload::text) ~ '(\.xlsx|\.xls"|spreadsheetml|excelattachment)';

  return jsonb_build_object(
    'contract_version', 'eval-itemcode-work-health-v2',
    'scope_contract', 'itemcode-all-rows-v1',
    'contract_started_at', contract_started_at,
    'scoped_assignment_count', scoped_assignments,
    'stored_membership_mismatch_count', stored_membership_mismatches,
    'pdf_origin_mismatch_count', pdf_origin_mismatches,
    'historical_pdf_origin_mismatch_count', historical_pdf_origin_mismatches,
    'excel_attachment_violation_count', excel_attachment_violations,
    'over_limit_assignment_count', over_limit_assignments,
    'largest_origin_count', largest_origin_count
  );
end
$function$;

revoke all on function public.get_eval_itemcode_work_health_snapshot_v2()
  from public, anon, authenticated;
grant execute on function public.get_eval_itemcode_work_health_snapshot_v2()
  to service_role;

comment on function public.get_eval_itemcode_work_health_snapshot_v2() is
  'Service-only ITEMCODE-wide Eval Work health. Preserves pre-release delivery anomalies as a non-blocking historical count and blocks on every new mismatch.';

commit;
