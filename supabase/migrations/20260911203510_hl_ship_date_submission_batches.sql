-- Canonical ship dates and immutable, independently delivered submission batches.
begin;
create function hl_order_private.ship_date(value text) returns date
language plpgsql immutable set search_path='' as $$
declare v text:=btrim(value); parts text[]; month_number integer;
begin
  if v is null or v='' then return null; end if;
  if v ~ '^\d{4}-\d{2}-\d{2}$' then return v::date; end if;
  if v ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
    if v ~ '(Z|[+-]\d{2}:?\d{2})$' then return (v::timestamptz at time zone 'America/Chicago')::date; end if;
    return v::timestamp::date;
  end if;
  parts:=regexp_match(v,'^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT([+-]\d{2})(\d{2})( \([^)]*\))?$');
  if parts is not null then
    month_number:=array_position(array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],parts[1]);
    return ((make_date(parts[3]::int,month_number,parts[2]::int)::text||'T'||parts[4]||parts[5]||':'||parts[6])::timestamptz at time zone 'America/Chicago')::date;
  end if;
  return null;
exception when others then return null;
end $$;

alter table hl_order_private.orders add column ship_date date;
alter table hl_order_private.drafts add column ship_date date,
  add column target_order_id uuid references hl_order_private.orders(id);
create table hl_order_private.submission_batches (
  id uuid primary key,
  order_id uuid not null references hl_order_private.orders(id),
  preview_id uuid not null unique references public.ph_hl_order_previews(id),
  event_id uuid not null unique references public.ph_request_delivery_outbox(event_id),
  kind text not null check(kind in ('submission','addition')),
  ship_date date,
  status text not null check(status in ('queued','sent','delivery_unknown','failed')),
  created_by uuid not null, created_at timestamptz not null default now(),
  sent_at timestamptz, delivery_receipt jsonb
);
create index hl_batches_order on hl_order_private.submission_batches(order_id,created_at,id);
alter table hl_order_private.submission_batches enable row level security;
revoke all on hl_order_private.submission_batches from public,anon,authenticated;
alter table hl_order_private.order_lines add column batch_id uuid references hl_order_private.submission_batches(id);
update hl_order_private.orders o set ship_date=d.ship_date from (
  select order_id,case when count(distinct hl_order_private.ship_date(source->>'planstartdate'))=1
    and bool_and(hl_order_private.ship_date(source->>'planstartdate') is not null)
    then min(hl_order_private.ship_date(source->>'planstartdate')) end ship_date
  from hl_order_private.order_lines group by order_id
) d where d.order_id=o.id;
insert into hl_order_private.submission_batches(id,order_id,preview_id,event_id,kind,ship_date,status,created_by,created_at,sent_at,delivery_receipt)
  select id,id,preview_id,event_id,'submission',ship_date,status,created_by,created_at,sent_at,delivery_receipt from hl_order_private.orders;
-- Only the new provenance column is populated; historical quantities/snapshots remain untouched.
drop trigger hl_lines_immutable on hl_order_private.order_lines;
update hl_order_private.order_lines set batch_id=order_id;
create trigger hl_lines_immutable before update or delete on hl_order_private.order_lines
  for each row execute function hl_order_private.protect_history();
alter table hl_order_private.order_lines alter column batch_id set not null;
alter table hl_order_private.order_lines drop constraint order_lines_order_id_source_id_key;
alter table hl_order_private.order_lines add unique(batch_id,source_id);
create index hl_lines_batch on hl_order_private.order_lines(batch_id);
create index hl_orders_ship_date on hl_order_private.orders(ship_date,created_at,id);

create function hl_order_private.active_order(p_date date) returns uuid
language sql stable security definer set search_path='' as $$
  select o.id from hl_order_private.orders o where o.ship_date=p_date and (
    exists(select 1 from hl_order_private.order_lines l where l.order_id=o.id and l.quantity>l.received_quantity+l.cancelled_quantity)
    or exists(select 1 from hl_order_private.submission_batches b where b.order_id=o.id and b.status<>'sent'))
  order by o.created_at,o.id limit 1
$$;
update hl_order_private.drafts set ship_date=hl_order_private.ship_date(source->>'planstartdate'),
  target_order_id=hl_order_private.active_order(hl_order_private.ship_date(source->>'planstartdate'));

create function hl_order_private.batch_fingerprint(p_date date) returns text
language sql stable security definer set search_path='' as $$
  select hl_order_private.fingerprint(coalesce(jsonb_agg(jsonb_build_array(d.source_id,d.quantity,d.source->>'source_fingerprint') order by d.source_id),'[]'))
  from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id) where x.status='draft' and d.ship_date=p_date
$$;
create function hl_order_private.protect_batch() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (to_jsonb(new)-'status'-'sent_at'-'delivery_receipt')=(to_jsonb(old)-'status'-'sent_at'-'delivery_receipt')
    and (old.status<>'sent' or to_jsonb(new)=to_jsonb(old)) then return new; end if;
  raise exception using errcode='55000',message='HL_ORDER_HISTORY_IMMUTABLE';
end $$;
create trigger hl_batch_immutable before update or delete on hl_order_private.submission_batches
  for each row execute function hl_order_private.protect_batch();

create or replace function public.hl_order_command(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=hl_order_private.assert_dylan(); current_revision bigint; request_hash text; saved hl_order_private.commands;
  result jsonb; source_row jsonb; entry jsonb; report jsonb; report_lines jsonb; ids jsonb; keys text[];
  source_id_value text; target_id text; resolution text; reason text; qty numeric; ceiling numeric; previous_qty numeric;
  disposition hl_order_private.dispositions; target_disposition hl_order_private.dispositions;
  preview public.ph_hl_order_previews; ord hl_order_private.orders; order_line hl_order_private.order_lines;
  preview_id uuid; order_id_value uuid; cancellation_id_value uuid; event_id_value uuid; order_number_value text;
  batch_id_value uuid; ship_date_value date; date_count integer; batch_kind text;
  event_row public.ph_request_delivery_outbox; seen_ids text[]:='{}'; preview_result jsonb;
begin
  if p_command_id is null or p_expected_revision is null or p_expected_revision<0 or octet_length(coalesce(p_payload::text,''))>200000
    or p_action is null or p_action not in ('draft_save','draft_clear','preview','submit','dismiss','restore','resolve_review','receive','cancellation_preview','cancellation_submit','reconcile_delivery') then
    raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
  end if;
  keys:=case p_action when 'draft_save' then array['rows'] when 'draft_clear' then array['source_ids']
    when 'preview' then array['ship_date'] when 'submit' then array['preview_id']
    when 'dismiss' then array['source_ids'] when 'restore' then array['source_ids']
    when 'resolve_review' then array['source_id','resolution','replacement_source_id']
    when 'receive' then array['order_id','lines','reason'] when 'cancellation_preview' then array['order_id','lines','reason']
    when 'cancellation_submit' then array['preview_id'] else array['event_id'] end;
  perform hl_order_private.assert_keys(p_payload,keys);
  request_hash:=hl_order_private.fingerprint(jsonb_build_array(p_action,p_payload,p_expected_revision));
  select revision into current_revision from hl_order_private.state where singleton for update;
  select * into saved from hl_order_private.commands where command_id=p_command_id;
  if found then
    if saved.created_by<>actor or saved.request_hash<>request_hash then
      raise exception using errcode='22023',message='HL_ORDER_COMMAND_ID_CONFLICT';
    end if;
    return saved.response;
  end if;
  -- A reviewed snapshot cannot change between comparison and queued delivery.
  -- This is a short read lock, never an inventory mutation.
  lock table public.ph_soc_master in share mode;
  perform hl_order_private.reconcile();
  select revision into current_revision from hl_order_private.state where singleton;
  if current_revision<>p_expected_revision then
    raise exception using errcode='40001',message='HL_ORDER_REVISION_CONFLICT',detail=current_revision::text;
  end if;
  reason:=btrim(coalesce(p_payload->>'reason',''));
  if length(reason)>1000 then raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;

  if p_action='draft_save' then
    if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 500 then
      raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
    end if;
    for entry in select value from jsonb_array_elements(p_payload->'rows') loop
      perform hl_order_private.assert_keys(entry,array['source_id','quantity']);
      source_id_value:=entry->>'source_id'; qty:=hl_order_private.quantity(entry->>'quantity');
      if source_id_value is null or source_id_value=any(seen_ids) or qty is null or qty<=0 or qty<>trunc(qty) or qty>1000000000 then
        raise exception using errcode='22023',message='HL_ORDER_INVALID_QUANTITY';
      end if;
      seen_ids:=array_append(seen_ids,source_id_value);
      select s.source into source_row from hl_order_private.sources() s where s.source_id=source_id_value;
      if source_row is null then raise exception using errcode='55000',message='HL_ORDER_SOURCE_REVIEW_REQUIRED'; end if;
      perform hl_order_private.assert_source_unlocked(source_id_value);
      select * into disposition from hl_order_private.dispositions where source_id=source_id_value;
      if found and disposition.status not in ('needed','draft') then
        raise exception using errcode='55000',message='HL_ORDER_SOURCE_REVIEW_REQUIRED';
      end if;
      ceiling:=coalesce(disposition.available_quantity,hl_order_private.quantity(source_row->>'quantityordered'));
      if ceiling is null or qty>ceiling or hl_order_private.quantity(source_row->>'quantityordered') is null
        or hl_order_private.quantity(source_row->>'quantityordered')<>trunc(hl_order_private.quantity(source_row->>'quantityordered'))
        then raise exception using errcode='22023',message='HL_ORDER_INVALID_QUANTITY'; end if;
      insert into hl_order_private.dispositions(source_id,status,source,observed_fingerprint,available_quantity)
        values(source_id_value,'draft',source_row,source_row->>'source_fingerprint',ceiling)
        on conflict(source_id) do update set status='draft',source=excluded.source,reason='',review_kind=null,updated_at=now();
      insert into hl_order_private.drafts(source_id,quantity,source,ship_date,target_order_id)
        values(source_id_value,qty,source_row,hl_order_private.ship_date(source_row->>'planstartdate'),
          hl_order_private.active_order(hl_order_private.ship_date(source_row->>'planstartdate')))
        on conflict(source_id) do update set quantity=excluded.quantity,source=excluded.source,ship_date=excluded.ship_date,
          target_order_id=excluded.target_order_id,updated_at=now();
    end loop;

  elsif p_action in ('draft_clear','dismiss','restore') then
    ids:=p_payload->'source_ids';
    if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 500 then
      raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
    end if;
    for entry in select value from jsonb_array_elements(ids) loop
      if jsonb_typeof(entry)<>'string' then raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
      source_id_value:=entry#>>'{}';
      if source_id_value=any(seen_ids) then raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
      seen_ids:=array_append(seen_ids,source_id_value);
      perform hl_order_private.assert_source_unlocked(source_id_value);
      select s.source into source_row from hl_order_private.sources() s where s.source_id=source_id_value;
      select * into disposition from hl_order_private.dispositions where source_id=source_id_value;
      if source_row is null or disposition.status='needs_review'
        or (p_action='restore' and (disposition.status is distinct from 'removed' or disposition.replacement_source_id is not null))
        or (p_action='draft_clear' and disposition.status is distinct from 'draft')
        or (p_action='dismiss' and disposition.status is not null and disposition.status not in ('needed','draft')) then
        raise exception using errcode='55000',message='HL_ORDER_SOURCE_REVIEW_REQUIRED';
      end if;
      ceiling:=coalesce(disposition.available_quantity,hl_order_private.quantity(source_row->>'quantityordered'),0);
      insert into hl_order_private.dispositions(source_id,status,source,observed_fingerprint,available_quantity,reason)
        values(source_id_value,case when p_action='dismiss' then 'removed' else 'needed' end,source_row,source_row->>'source_fingerprint',ceiling,
          case when p_action='dismiss' then 'Removed by Dylan' else '' end)
        on conflict(source_id) do update set status=excluded.status,source=excluded.source,reason=excluded.reason,review_kind=null,updated_at=now();
      delete from hl_order_private.drafts where source_id=source_id_value;
    end loop;

  elsif p_action='resolve_review' then
    source_id_value:=p_payload->>'source_id'; resolution:=p_payload->>'resolution';
    target_id:=coalesce(nullif(p_payload->>'replacement_source_id',''),source_id_value);
    if resolution is null or resolution not in ('needed','removed','handled') then
      raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
    end if;
    perform hl_order_private.assert_source_unlocked(source_id_value);
    select * into disposition from hl_order_private.dispositions where source_id=source_id_value;
    if not found or disposition.status<>'needs_review' then raise exception using errcode='55000',message='HL_ORDER_SOURCE_REVIEW_REQUIRED'; end if;
    if (disposition.review_kind='possible_replacement' or disposition.replacement_source_id is not null) and resolution='needed' then
      raise exception using errcode='55000',message='HL_ORDER_REPLACEMENT_REVIEW_REQUIRED';
    end if;
    select s.source into source_row from hl_order_private.sources() s where s.source_id=target_id;
    if target_id<>source_id_value then
      perform hl_order_private.assert_source_unlocked(target_id);
      select * into target_disposition from hl_order_private.dispositions where source_id=target_id;
      if source_row is null or hl_order_private.business_key(source_row) is null
        or hl_order_private.business_key(source_row) is distinct from hl_order_private.business_key(disposition.source)
        or (target_disposition.status is not null and (target_disposition.status<>'needs_review' or target_disposition.review_kind<>'possible_replacement'))
        or exists(select 1 from hl_order_private.order_lines where source_id=target_id) then
        raise exception using errcode='55000',message='HL_ORDER_REPLACEMENT_REVIEW_REQUIRED';
      end if;
      update hl_order_private.dispositions set status='removed',available_quantity=0,reason='Replaced by '||target_id,
        replacement_source_id=target_id,review_kind=null,updated_at=now() where source_id=source_id_value;
    end if;
    -- Previously ordered/locally covered plants stay covered. A changed demand
    -- or confirmed cancellation can reopen only the uncovered difference.
    ceiling:=greatest(coalesce(hl_order_private.quantity(source_row->>'quantityordered'),0)
      -greatest(coalesce(hl_order_private.quantity(disposition.source->>'quantityordered'),0)-disposition.available_quantity,0),0);
    if resolution='needed' and (source_row is null or ceiling<=0 or ceiling<>trunc(ceiling)) then
      raise exception using errcode='55000',message='HL_ORDER_NO_UNCOVERED_QUANTITY';
    end if;
    if resolution='handled' or disposition.replacement_source_id is not null then ceiling:=0; end if;
    insert into hl_order_private.dispositions(source_id,status,source,observed_fingerprint,available_quantity,reason)
      values(target_id,resolution,coalesce(source_row,disposition.source),coalesce(source_row->>'source_fingerprint','missing'),ceiling,'Review resolved: '||resolution)
      on conflict(source_id) do update set status=excluded.status,source=excluded.source,observed_fingerprint=excluded.observed_fingerprint,
        available_quantity=excluded.available_quantity,reason=excluded.reason,review_kind=null,updated_at=now();
    delete from hl_order_private.drafts where source_id in (source_id_value,target_id);

  elsif p_action='preview' then
    select count(distinct d.ship_date) into date_count from hl_order_private.drafts d
      join hl_order_private.dispositions x using(source_id) where x.status='draft';
    if p_payload ? 'ship_date' then
      if coalesce(p_payload->>'ship_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception using errcode='22023',message='HL_ORDER_SHIP_DATE_REQUIRED'; end if;
      ship_date_value:=hl_order_private.ship_date(p_payload->>'ship_date');
    else
      if date_count>1 then raise exception using errcode='22023',message='HL_ORDER_SELECT_SHIP_DATE'; end if;
      select min(d.ship_date) into ship_date_value from hl_order_private.drafts d
        join hl_order_private.dispositions x using(source_id) where x.status='draft';
    end if;
    if ship_date_value is null then raise exception using errcode='22023',message='HL_ORDER_SHIP_DATE_REQUIRED'; end if;
    if not exists(select 1 from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id)
      where x.status='draft' and d.ship_date=ship_date_value)
      or (select count(*) from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id)
        where x.status='draft' and d.ship_date=ship_date_value)>500 then
      raise exception using errcode='22023',message='HL_ORDER_EMPTY_DRAFT';
    end if;
    order_id_value:=hl_order_private.active_order(ship_date_value);
    if order_id_value is not null then
      if exists(select 1 from hl_order_private.submission_batches where order_id=order_id_value and status<>'sent')
        or exists(select 1 from hl_order_private.cancellations where order_id=order_id_value and status<>'sent') then
        raise exception using errcode='55000',message='HL_ORDER_DELIVERY_UNKNOWN'; end if;
      select * into ord from hl_order_private.orders where id=order_id_value;
      order_number_value:=ord.order_number; batch_kind:='addition';
    else
      order_id_value:=gen_random_uuid(); batch_kind:='submission';
      order_number_value:='HL-'||to_char(now() at time zone 'America/Chicago','YYYY')||'-'||lpad(nextval('hl_order_private.order_number_seq')::text,6,'0');
    end if;
    preview_id:=gen_random_uuid(); batch_id_value:=gen_random_uuid();
    select jsonb_agg(hl_order_private.report_source(d.source)||jsonb_build_object('line_id',gen_random_uuid(),'quantity',d.quantity) order by d.source_id)
      into report_lines from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id)
      where x.status='draft' and d.ship_date=ship_date_value;
    report:=jsonb_build_object('contract_version','hl-order-report-v2','kind',batch_kind,'order_id',order_id_value,
      'batch_id',batch_id_value,'ship_date',ship_date_value,'order_number',order_number_value,'created_at',now(),'lines',report_lines,
      'total_quantity',(select sum((value->>'quantity')::numeric) from jsonb_array_elements(report_lines)));
    insert into public.ph_hl_order_previews(id,created_by,expires_at,state_revision,source_fingerprint,report)
      values(preview_id,actor,now()+interval '30 minutes',current_revision+1,hl_order_private.batch_fingerprint(ship_date_value),report);
    preview_result:=jsonb_build_object('id',preview_id,'report',report);

  elsif p_action='submit' then
    select * into preview from public.ph_hl_order_previews where id=(p_payload->>'preview_id')::uuid;
    ship_date_value:=hl_order_private.ship_date(preview.report->>'ship_date');
    if not found or preview.created_by<>actor or preview.report->>'kind' not in ('submission','addition')
      or preview.report->>'contract_version'<>'hl-order-report-v2' or ship_date_value is null or preview.expires_at<=now()
      or preview.state_revision<>current_revision or preview.source_fingerprint<>hl_order_private.batch_fingerprint(ship_date_value) then
      raise exception using errcode='55000',message='HL_ORDER_PREVIEW_STALE';
    end if;
    order_id_value:=(preview.report->>'order_id')::uuid; batch_id_value:=(preview.report->>'batch_id')::uuid;
    batch_kind:=preview.report->>'kind';
    if (batch_kind='addition' and hl_order_private.active_order(ship_date_value) is distinct from order_id_value)
      or (batch_kind='submission' and hl_order_private.active_order(ship_date_value) is not null)
      or exists(select 1 from hl_order_private.submission_batches where order_id=order_id_value and status<>'sent')
      or exists(select 1 from hl_order_private.cancellations where order_id=order_id_value and status<>'sent') then
      raise exception using errcode='55000',message='HL_ORDER_PREVIEW_STALE'; end if;
    event_id_value:=gen_random_uuid();
    insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,payload)
      values(event_id_value,'hl_order_submission:'||batch_id_value,'hl_order_submission',jsonb_build_object(
        'contract_version','hl-order-delivery-v1','order_id',order_id_value,'batch_id',batch_id_value,'preview_id',preview.id,'created_by',actor));
    if batch_kind='submission' then
      insert into hl_order_private.orders(id,order_number,preview_id,event_id,created_by,ship_date)
        values(order_id_value,preview.report->>'order_number',preview.id,event_id_value,actor,ship_date_value);
    end if;
    insert into hl_order_private.submission_batches(id,order_id,preview_id,event_id,kind,ship_date,status,created_by)
      values(batch_id_value,order_id_value,preview.id,event_id_value,batch_kind,ship_date_value,'queued',actor);
    for entry in select value from jsonb_array_elements(preview.report->'lines') loop
      source_id_value:=entry->>'source_id'; perform hl_order_private.assert_source_unlocked(source_id_value);
      insert into hl_order_private.order_lines(id,order_id,batch_id,source_id,source,quantity)
        values((entry->>'line_id')::uuid,order_id_value,batch_id_value,source_id_value,entry-'line_id'-'quantity',(entry->>'quantity')::numeric);
      update hl_order_private.dispositions set status='submitting',available_quantity=0,reason='Order email queued',updated_at=now() where source_id=source_id_value;
      update hl_order_private.drafts set target_order_id=order_id_value where source_id=source_id_value;
    end loop;

  elsif p_action in ('receive','cancellation_preview') then
    order_id_value:=(p_payload->>'order_id')::uuid;
    select * into ord from hl_order_private.orders where id=order_id_value;
    if not found or ord.status<>'sent' then raise exception using errcode='55000',message='HL_ORDER_NOT_SENT'; end if;
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500
      or (p_action='cancellation_preview' and reason='') then raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
    report_lines:='[]';
    for entry in select value from jsonb_array_elements(p_payload->'lines') loop
      perform hl_order_private.assert_keys(entry,case when p_action='receive' then array['line_id','received_quantity'] else array['line_id','quantity'] end);
      if (entry->>'line_id') is null or (entry->>'line_id')=any(seen_ids) then raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND'; end if;
      seen_ids:=array_append(seen_ids,entry->>'line_id');
      select * into order_line from hl_order_private.order_lines where id=(entry->>'line_id')::uuid and order_id=order_id_value;
      if not found then raise exception using errcode='22023',message='HL_ORDER_INVALID_LINE'; end if;
      if not exists(select 1 from hl_order_private.submission_batches b where b.id=order_line.batch_id and b.status='sent') then
        raise exception using errcode='55000',message='HL_ORDER_NOT_SENT'; end if;
      qty:=hl_order_private.quantity(entry->>case when p_action='receive' then 'received_quantity' else 'quantity' end);
      ceiling:=order_line.quantity-order_line.cancelled_quantity-hl_order_private.pending_cancellation(order_line.id)
        -case when p_action='cancellation_preview' then order_line.received_quantity else 0 end;
      if qty is null or qty<>trunc(qty) or qty<0 or qty>ceiling or (p_action='cancellation_preview' and qty=0) then
        raise exception using errcode='22023',message='HL_ORDER_INVALID_QUANTITY';
      end if;
      if p_action='receive' then
        if qty<order_line.received_quantity and reason='' then raise exception using errcode='22023',message='HL_ORDER_CORRECTION_REASON_REQUIRED'; end if;
        if qty<>order_line.received_quantity then
          insert into hl_order_private.receipts(command_id,order_id,line_id,received_quantity,previous_quantity,quantity_delta,reason,created_by)
            values(p_command_id,order_id_value,order_line.id,qty,order_line.received_quantity,qty-order_line.received_quantity,reason,actor);
          update hl_order_private.order_lines set received_quantity=qty where id=order_line.id;
        end if;
      else
        report_lines:=report_lines||jsonb_build_array(order_line.source||jsonb_build_object('line_id',order_line.id,'quantity',qty));
      end if;
    end loop;
    if p_action='cancellation_preview' then
      preview_id:=gen_random_uuid(); cancellation_id_value:=gen_random_uuid();
      report:=jsonb_build_object('contract_version',case when ord.ship_date is null then 'hl-order-report-v1' else 'hl-order-report-v2' end,'ship_date',ord.ship_date,'kind','cancellation','order_id',ord.id,'cancellation_id',cancellation_id_value,
        'order_number',ord.order_number,'original_order_number',ord.order_number,'reason',reason,'created_at',now(),'lines',report_lines,
        'total_quantity',(select sum((value->>'quantity')::numeric) from jsonb_array_elements(report_lines)));
      insert into public.ph_hl_order_previews(id,created_by,expires_at,state_revision,source_fingerprint,report)
        values(preview_id,actor,now()+interval '30 minutes',current_revision+1,hl_order_private.fingerprint(report_lines),report);
      preview_result:=jsonb_build_object('id',preview_id,'report',report);
    end if;

  elsif p_action='cancellation_submit' then
    select * into preview from public.ph_hl_order_previews where id=(p_payload->>'preview_id')::uuid;
    if not found or preview.created_by<>actor or preview.report->>'kind'<>'cancellation' or preview.expires_at<=now()
      or preview.state_revision<>current_revision then raise exception using errcode='55000',message='HL_ORDER_PREVIEW_STALE'; end if;
    order_id_value:=(preview.report->>'order_id')::uuid; cancellation_id_value:=(preview.report->>'cancellation_id')::uuid;
    select * into ord from hl_order_private.orders where id=order_id_value;
    if not found or ord.status<>'sent' then raise exception using errcode='55000',message='HL_ORDER_NOT_SENT'; end if;
    event_id_value:=gen_random_uuid();
    insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,payload)
      values(event_id_value,'hl_order_cancellation:'||cancellation_id_value,'hl_order_cancellation',jsonb_build_object(
        'contract_version','hl-order-delivery-v1','order_id',order_id_value,'cancellation_id',cancellation_id_value,'preview_id',preview.id,'created_by',actor));
    insert into hl_order_private.cancellations(id,order_id,preview_id,reason,event_id,created_by)
      values(cancellation_id_value,order_id_value,preview.id,preview.report->>'reason',event_id_value,actor);
    for entry in select value from jsonb_array_elements(preview.report->'lines') loop
      select * into order_line from hl_order_private.order_lines where id=(entry->>'line_id')::uuid and order_id=order_id_value;
      qty:=(entry->>'quantity')::numeric;
      if not found or qty>order_line.quantity-order_line.received_quantity-order_line.cancelled_quantity-hl_order_private.pending_cancellation(order_line.id) then
        raise exception using errcode='55000',message='HL_ORDER_PREVIEW_STALE';
      end if;
      insert into hl_order_private.cancellation_lines(cancellation_id,line_id,quantity) values(cancellation_id_value,order_line.id,qty);
    end loop;

  elsif p_action='reconcile_delivery' then
    -- Never wait on an outbox row while holding the workflow lock: its worker
    -- may be confirming delivery and acquiring this same workflow lock.
    select * into event_row from public.ph_request_delivery_outbox where event_id=(p_payload->>'event_id')::uuid
      and event_type in ('hl_order_submission','hl_order_cancellation') for update skip locked;
    if not found then raise exception using errcode='55000',message='HL_ORDER_DELIVERY_BUSY'; end if;
    if event_row.status='processing' and event_row.lease_expires_at>now() then raise exception using errcode='55000',message='HL_ORDER_DELIVERY_BUSY'; end if;
    if event_row.status<>'delivered' then
      update public.ph_request_delivery_outbox set status='pending',next_attempt_at=now(),attempt_count=0,lease_token=null,lease_owner=null,lease_expires_at=null,
        sanitized_error_code=null where event_id=event_row.event_id;
    end if;
  end if;

  update hl_order_private.state set revision=revision+1 where singleton;
  insert into hl_order_private.history(command_id,action,payload,created_by) values(p_command_id,p_action,p_payload,actor);
  result:=hl_order_private.state_json();
  if preview_result is not null then result:=result||jsonb_build_object('preview',preview_result); end if;
  insert into hl_order_private.commands(command_id,created_by,request_hash,response) values(p_command_id,actor,request_hash,result);
  return result;
end $$;

create or replace function hl_order_private.order_json(p_order_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(o)||jsonb_build_object(
    'batches',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at,b.id) from hl_order_private.submission_batches b where b.order_id=o.id),'[]'),
    'fulfillment_status',case when totals.outstanding=0 and totals.cancelled=totals.quantity then 'cancelled'
      when totals.outstanding=0 and totals.cancelled>0 then 'received_and_cancelled'
      when totals.outstanding=0 then 'received' when totals.cancelled>0 then 'partially_cancelled'
      when totals.received>0 then 'partially_received' else 'open' end,
    'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('delivery_status',(select b.status from hl_order_private.submission_batches b where b.id=l.batch_id),
      'outstanding_quantity',l.quantity-l.received_quantity-l.cancelled_quantity,
      'pending_cancellation_quantity',hl_order_private.pending_cancellation(l.id)) order by l.source_id)
      from hl_order_private.order_lines l where l.order_id=o.id),'[]'),
    'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from hl_order_private.receipts r where r.order_id=o.id),'[]'),
    'cancellations',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('lines',
      (select jsonb_agg(to_jsonb(l) order by l.line_id) from hl_order_private.cancellation_lines l where l.cancellation_id=c.id))
      order by c.created_at,c.id) from hl_order_private.cancellations c where c.order_id=o.id),'[]'))
  from hl_order_private.orders o cross join lateral (
    select coalesce(sum(quantity),0) quantity,coalesce(sum(received_quantity),0) received,
      coalesce(sum(cancelled_quantity),0) cancelled,coalesce(sum(quantity-received_quantity-cancelled_quantity),0) outstanding
    from hl_order_private.order_lines where order_id=o.id) totals where o.id=p_order_id
$$;

create or replace function hl_order_private.state_json() returns jsonb
language sql stable security definer set search_path='' as $$
  with current_rows as materialized(select * from hl_order_private.sources())
  select jsonb_build_object('revision',(select revision from hl_order_private.state where singleton),
    'draft',coalesce((select jsonb_agg(jsonb_build_object('source_id',d.source_id,'quantity',d.quantity,'source',d.source,
      'ship_date',d.ship_date,'target_order_id',hl_order_private.active_order(d.ship_date),
      'target_order_number',(select o.order_number from hl_order_private.orders o where o.id=hl_order_private.active_order(d.ship_date)),
      'status',case when x.status='draft' then 'ready' else x.status end,'reason',x.reason) order by d.source_id)
      from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id)),'[]'),
    'actionable_rows',coalesce((select jsonb_agg(s.source||jsonb_build_object('available_quantity',coalesce(d.available_quantity,hl_order_private.quantity(s.source->>'quantityordered')))
      order by s.source_id) from current_rows s left join hl_order_private.dispositions d using(source_id)
      where d.status is null or d.status in ('needed','draft','submitting')),'[]'),
    'dispositions',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('current_source',s.source,
      'replacement_candidates',coalesce((select jsonb_agg(c.source order by c.source_id) from current_rows c
        where s.source is null and d.observed_fingerprint='missing' and d.replacement_source_id is null
          and c.source_id<>d.source_id and hl_order_private.business_key(c.source)=hl_order_private.business_key(d.source)),'[]'))
      order by d.source_id) from hl_order_private.dispositions d left join current_rows s using(source_id)),'[]'),
    'orders',coalesce((select jsonb_agg(hl_order_private.order_json(o.id) order by o.ship_date nulls last,o.order_number,o.id) from hl_order_private.orders o),'[]'),
    'delivery_issues',coalesce((select jsonb_agg(jsonb_build_object('event_id',e.event_id,'event_type',e.event_type,'status',e.status,
      'delivery_status',e.channel_results->'email'->>'status','order_id',e.payload->>'order_id','last_error',e.sanitized_error_code)
      order by e.created_at) from public.ph_request_delivery_outbox e where e.event_type in ('hl_order_submission','hl_order_cancellation')
      and (e.status in ('failed','unknown') or e.channel_results->'email'->>'status' in ('sending','unknown'))),'[]'),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from (select * from hl_order_private.history order by id desc limit 100) h),'[]'))
$$;

create or replace function hl_order_private.assert_source_unlocked(p_source_id text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if exists(select 1 from hl_order_private.order_lines l join hl_order_private.submission_batches o on o.id=l.batch_id
    where l.source_id=p_source_id and o.status<>'sent')
    or exists(select 1 from hl_order_private.cancellation_lines l join hl_order_private.cancellations c on c.id=l.cancellation_id
      join hl_order_private.order_lines ol on ol.id=l.line_id where ol.source_id=p_source_id and c.status<>'sent') then
    raise exception using errcode='55000',message='HL_ORDER_DELIVERY_UNKNOWN';
  end if;
end $$;

create or replace function hl_order_private.apply_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare email jsonb:=coalesce(new.channel_results->'email','{}'); delivery_status text;
  batch hl_order_private.submission_batches; ord hl_order_private.orders; cancellation hl_order_private.cancellations;
  line record; changed boolean:=false; target_source_id text; next_source_id text; visited text[];
begin
  if new.event_type not in ('hl_order_submission','hl_order_cancellation') then return new; end if;
  delivery_status:=case when email->>'status'='sent' and nullif(email->>'gmail_message_id','') is not null then 'sent'
    when email->>'status'='unknown' or (email->>'status'='sending' and new.status='failed') then 'delivery_unknown'
    when email->>'status'='failed' or new.status='failed' then 'failed' else 'queued' end;
  -- A claim/heartbeat alone is not a business-state transition.
  if delivery_status='queued' then return new; end if;
  perform 1 from hl_order_private.state where singleton for update;
  if new.event_type='hl_order_submission' then
    select * into batch from hl_order_private.submission_batches where event_id=new.event_id;
    if not found or batch.status='sent' or batch.status=delivery_status then return new; end if;
    update hl_order_private.submission_batches set status=delivery_status,
      sent_at=case when delivery_status='sent' then now() else sent_at end,
      delivery_receipt=case when delivery_status='sent' then email else delivery_receipt end where id=batch.id;
    if batch.kind='submission' then
      update hl_order_private.orders set status=delivery_status,
        sent_at=case when delivery_status='sent' then now() else sent_at end,
        delivery_receipt=case when delivery_status='sent' then email else delivery_receipt end where id=batch.order_id;
    end if;
    if delivery_status='sent' then
      update hl_order_private.dispositions d set status='handled',reason='Order email confirmed',updated_at=now()
        from hl_order_private.order_lines l where l.batch_id=batch.id and l.source_id=d.source_id and d.status='submitting';
      delete from hl_order_private.drafts d using hl_order_private.order_lines l where l.batch_id=batch.id and l.source_id=d.source_id;
    end if;
    changed:=true;
  else
    select * into cancellation from hl_order_private.cancellations where event_id=new.event_id;
    if not found or cancellation.status='sent' or cancellation.status=delivery_status then return new; end if;
    update hl_order_private.cancellations set status=delivery_status,
      sent_at=case when delivery_status='sent' then now() else sent_at end,
      delivery_receipt=case when delivery_status='sent' then email else delivery_receipt end where id=cancellation.id;
    if delivery_status='sent' then
      for line in select ol.id,ol.source_id,cl.quantity from hl_order_private.cancellation_lines cl
        join hl_order_private.order_lines ol on ol.id=cl.line_id where cl.cancellation_id=cancellation.id loop
        update hl_order_private.order_lines set cancelled_quantity=cancelled_quantity+line.quantity where id=line.id;
        -- Reviewed ID replacements carry existing coverage. A later cancellation
        -- reopens that quantity on the reviewed successor, never the retired ID.
        target_source_id:=line.source_id; visited:=array[target_source_id];
        loop
          select replacement_source_id into next_source_id from hl_order_private.dispositions where source_id=target_source_id;
          exit when next_source_id is null or next_source_id=any(visited);
          target_source_id:=next_source_id; visited:=array_append(visited,target_source_id);
        end loop;
        update hl_order_private.dispositions set status='needs_review',available_quantity=available_quantity+line.quantity,
          reason='Cancellation confirmed: '||cancellation.reason,review_kind='cancellation',updated_at=now() where source_id=target_source_id;
      end loop;
    end if;
    changed:=true;
  end if;
  if changed then
    update hl_order_private.state set revision=revision+1 where singleton;
    insert into hl_order_private.history(action,payload) values('delivery_'||delivery_status,jsonb_build_object('event_id',new.event_id,'event_type',new.event_type));
  end if;
  return new;
end $$;

create or replace function public.hl_order_delivery_lookup_v1(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare event public.ph_request_delivery_outbox; preview public.ph_hl_order_previews;
  email jsonb; delivery_status text; actor uuid; order_id_value uuid;
begin
  if not private.is_service_role_request() then raise exception using errcode='42501',message='HL_ORDER_FORBIDDEN'; end if;
  select * into event from public.ph_request_delivery_outbox where event_id=p_event_id
    and event_type in ('hl_order_submission','hl_order_cancellation');
  if not found then raise exception using errcode='22023',message='HL_ORDER_INVALID_EVENT'; end if;
  select p.* into preview from public.ph_hl_order_previews p where p.id=(event.payload->>'preview_id')::uuid;
  actor:=preview.created_by; order_id_value:=(preview.report->>'order_id')::uuid;
  if not found or (event.payload->>'created_by')::uuid is distinct from actor
    or (event.payload->>'order_id')::uuid is distinct from order_id_value
    or not exists(select 1 from public.profiles p where p.id=actor and p.username='dylan_collyge'
      and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and p.must_change_password is false)
    or (event.event_type='hl_order_submission' and (preview.report->>'kind' not in ('submission','addition')
      or not exists(select 1 from hl_order_private.submission_batches o where o.order_id=order_id_value and o.event_id=event.event_id and o.preview_id=preview.id
        and (not(event.payload ? 'batch_id') or o.id=(event.payload->>'batch_id')::uuid))))
    or (event.event_type='hl_order_cancellation' and (preview.report->>'kind'<>'cancellation'
      or not exists(select 1 from hl_order_private.cancellations c where c.id=(event.payload->>'cancellation_id')::uuid
        and c.event_id=event.event_id and c.preview_id=preview.id and c.order_id=order_id_value))) then
    raise exception using errcode='42501',message='HL_ORDER_FORBIDDEN';
  end if;
  email:=coalesce(event.channel_results->'email','{}'); delivery_status:=coalesce(email->>'status','pending');
  return jsonb_build_object('event_id',event.event_id,'event_key',event.event_key,'event_type',event.event_type,
    'created_by',actor,'order_id',order_id_value,'report',preview.report,'recipients',jsonb_build_array('dylan_collyge@greenleafnursery.com'),
    'delivery_status',delivery_status,'reconciliation_only',delivery_status in ('sending','unknown','sent'),'receipt',email);
end $$;

revoke all on all functions in schema hl_order_private from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
