begin;

-- Eval Work completion is allowed only after every authoritative ITEMCODE row
-- has an explicit Item Inquiry disposition. The trigger keeps this invariant
-- inside the same transaction that writes evidence and queues completion.
create or replace function private.enforce_eval_work_row_resolution_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  context_rows jsonb := coalesce(new.context_rows, '[]'::jsonb);
  overlays jsonb := coalesce(new.submitted_inquiry->'rowOverlays', '[]'::jsonb);
  current_row jsonb;
  overlay jsonb;
  uid text;
  resolution_value text;
  overlay_matches integer;
  required_recipients text[];
begin
  if new.contract_version <> 'eval-work-v2-multi-origin'
     or new.status <> 'submitted'
     or old.status = 'submitted' then
    return new;
  end if;

  if jsonb_typeof(context_rows) <> 'array'
     or jsonb_typeof(overlays) <> 'array'
     or jsonb_array_length(context_rows) <> new.origin_count
     or jsonb_array_length(overlays) <> new.origin_count then
    raise exception using errcode = '22023', message = 'eval_work_all_rows_resolution_required';
  end if;

  for current_row in select value from jsonb_array_elements(context_rows) loop
    uid := trim(coalesce(current_row->>'unique_id', ''));
    select count(*)
      into overlay_matches
    from jsonb_array_elements(overlays)
    where trim(coalesce(value->>'unique_id', '')) = uid;
    select value
      into overlay
    from jsonb_array_elements(overlays)
    where trim(coalesce(value->>'unique_id', '')) = uid
    limit 1;

    if uid = '' or overlay_matches <> 1 or overlay is null then
      raise exception using errcode = '22023', message = 'eval_work_all_rows_resolution_required';
    end if;

    resolution_value := lower(trim(coalesce(overlay->>'resolution', '')));
    if resolution_value not in ('done', 'no_action') then
      raise exception using errcode = '22023', message = 'eval_work_row_resolution_invalid';
    end if;
    if resolution_value = 'no_action'
       and jsonb_array_length(coalesce(overlay->'proposals', '[]'::jsonb)) <> 0 then
      raise exception using errcode = '22023', message = 'eval_work_no_action_has_proposals';
    end if;
  end loop;

  required_recipients := private.eval_work_required_manager_emails_v2();
  if cardinality(required_recipients) <> 2 then
    raise exception using errcode = '40001', message = 'eval_work_required_manager_recipient_unavailable';
  end if;
  select array_agg(distinct value order by value)
    into new.completion_recipients
  from unnest(coalesce(new.completion_recipients, '{}'::text[]) || required_recipients) value;

  return new;
end
$function$;

revoke all on function private.enforce_eval_work_row_resolution_v3()
  from public, anon, authenticated;

drop trigger if exists ph_eval_work_require_row_resolution_v3 on public.ph_eval_work;
create trigger ph_eval_work_require_row_resolution_v3
before update of status on public.ph_eval_work
for each row
when (new.status = 'submitted' and old.status is distinct from new.status)
execute function private.enforce_eval_work_row_resolution_v3();

comment on function private.enforce_eval_work_row_resolution_v3() is
  'Requires one done/no_action Item Inquiry resolution per authoritative Eval Work origin and locks Dylan/Megan completion recipients.';

commit;
