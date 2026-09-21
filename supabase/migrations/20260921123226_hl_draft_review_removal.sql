-- Removing a saved Picker selection is not a resolution of its source review.
-- Keep delivery locks authoritative even when reconciliation changes status.
begin;

create function hl_order_private.draft_removal_block_reason(p_source_id text) returns text
language sql stable security definer set search_path='' as $$
  select case
    when exists(select 1 from hl_order_private.order_lines l
      join hl_order_private.submission_batches b on b.id=l.batch_id
      where l.source_id=p_source_id and b.status<>'sent')
      or exists(select 1 from hl_order_private.cancellation_lines l
        join hl_order_private.cancellations c on c.id=l.cancellation_id
        join hl_order_private.order_lines ol on ol.id=l.line_id
        where ol.source_id=p_source_id and c.status<>'sent')
      then 'HL_ORDER_DELIVERY_UNKNOWN'
    when not exists(select 1 from hl_order_private.drafts d
      join hl_order_private.dispositions x using(source_id)
      where d.source_id=p_source_id and x.status in ('draft','needs_review'))
      then 'HL_ORDER_SOURCE_REVIEW_REQUIRED'
    else null end
$$;
revoke all on function hl_order_private.draft_removal_block_reason(text) from public,anon,authenticated,service_role;

-- Keep the existing SOC/PO/restock response and order intact. Only enrich saved
-- draft rows; do not infer permission from the displayed disposition status.
create or replace function hl_order_private.state_json() returns jsonb
language sql stable security definer set search_path='' as $$
 with base as materialized (select hl_order_private.state_json_before_restock() s),
 draft_rows as materialized (
   select d.value,d.ordinality,hl_order_private.draft_removal_block_reason(d.value->>'source_id') block_reason
   from base cross join lateral jsonb_array_elements(s->'draft') with ordinality d
 )
 select s||jsonb_build_object('draft',coalesce((select jsonb_agg(value||jsonb_build_object(
   'source_kind',coalesce(value->'source'->>'source_kind','soc'),
   'can_remove',block_reason is null,'removal_block_reason',block_reason) order by ordinality)
   from draft_rows),'[]'),'po_report',(
   select jsonb_build_object('id',i.id,'source_format',i.source_format,'name',coalesce(nullif(i.metadata->>'source_file_name',''),'Legacy PO report'),
     'report_date',i.report_date,'receipt_cutoff',c.receipt_cutoff,'pending_pdf',(
       select jsonb_build_object('id',p.id,'name',p.metadata->>'source_file_name','report_date',p.report_date)
       from hl_order_private.po_imports p where p.source_format='pdf' and p.status='pending'
       order by (p.metadata->>'report_printed_at')::timestamptz desc,p.created_at desc,p.id desc limit 1))
   from hl_order_private.po_control c left join hl_order_private.po_imports i on i.id=c.active_import_id))
 from base
$$;

-- Preserve all other commands verbatim, including their review, preview and
-- delivery safeguards. The public entry point still authenticates the actor.
alter function hl_order_private.command_before_po(uuid,text,jsonb,bigint) rename to command_before_draft_removal;
create function hl_order_private.command_before_po(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=hl_order_private.assert_dylan(); current_revision bigint; request_hash text;
  saved hl_order_private.commands; disposition hl_order_private.dispositions;
  saved_draft hl_order_private.drafts; ids jsonb; entry jsonb; source_id_value text; source_row jsonb;
  seen_ids text[]:='{}'; removed_drafts jsonb:='[]'; result jsonb; block_reason text;
begin
  if p_action is distinct from 'draft_clear' then
    return hl_order_private.command_before_draft_removal(p_command_id,p_action,p_payload,p_expected_revision);
  end if;
  if p_command_id is null or p_expected_revision is null or p_expected_revision<0
    or octet_length(coalesce(p_payload::text,''))>200000 then
    raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
  end if;
  perform hl_order_private.assert_keys(p_payload,array['source_ids']);
  request_hash:=hl_order_private.fingerprint(jsonb_build_array(p_action,p_payload,p_expected_revision));
  select revision into current_revision from hl_order_private.state where singleton for update;
  select * into saved from hl_order_private.commands where command_id=p_command_id;
  if found then
    if saved.created_by<>actor or saved.request_hash<>request_hash then
      raise exception using errcode='22023',message='HL_ORDER_COMMAND_ID_CONFLICT';
    end if;
    return saved.response;
  end if;
  lock table public.ph_soc_master in share mode;
  perform hl_order_private.reconcile();
  select revision into current_revision from hl_order_private.state where singleton;
  if current_revision<>p_expected_revision then
    raise exception using errcode='40001',message='HL_ORDER_REVISION_CONFLICT',detail=current_revision::text;
  end if;
  ids:=p_payload->'source_ids';
  if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 500 then
    raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
  end if;
  for entry in select value from jsonb_array_elements(ids) loop
    if jsonb_typeof(entry)<>'string' then raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
    source_id_value:=entry#>>'{}';
    if source_id_value=any(seen_ids) then raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
    seen_ids:=array_append(seen_ids,source_id_value);
    block_reason:=hl_order_private.draft_removal_block_reason(source_id_value);
    if block_reason is not null then raise exception using errcode='55000',message=block_reason; end if;
    select * into disposition from hl_order_private.dispositions where source_id=source_id_value;
    select * into saved_draft from hl_order_private.drafts where source_id=source_id_value;
    removed_drafts:=removed_drafts||jsonb_build_array(to_jsonb(saved_draft));
    if disposition.status='draft' then
      -- Ordinary SOC/restock removal still returns the unchanged source to Needed.
      select s.source into source_row from hl_order_private.sources() s where s.source_id=source_id_value;
      if disposition.source_kind='restock' then source_row:=disposition.source; end if;
      if source_row is null then raise exception using errcode='55000',message='HL_ORDER_SOURCE_REVIEW_REQUIRED'; end if;
      update hl_order_private.dispositions set status='needed',source=source_row,reason='',review_kind=null,
        updated_at=now() where source_id=source_id_value;
    end if;
    -- A needs_review disposition, its saved source, reason, observed fingerprint,
    -- available quantity and replacement links remain byte-for-byte unchanged.
    delete from hl_order_private.drafts where source_id=source_id_value;
  end loop;
  update hl_order_private.state set revision=revision+1 where singleton;
  insert into hl_order_private.history(command_id,action,payload,created_by)
    values(p_command_id,p_action,p_payload||jsonb_build_object('removed_drafts',removed_drafts),actor);
  result:=hl_order_private.state_json();
  insert into hl_order_private.commands(command_id,created_by,request_hash,response)
    values(p_command_id,actor,request_hash,result);
  return result;
end $$;
revoke all on function hl_order_private.command_before_po(uuid,text,jsonb,bigint),
  hl_order_private.command_before_draft_removal(uuid,text,jsonb,bigint) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
