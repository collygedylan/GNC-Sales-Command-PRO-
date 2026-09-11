-- HL workflow owns local ordering state only. SOC and inventory remain import-owned.
begin;
create schema if not exists hl_order_private;
revoke all on schema hl_order_private from public, anon, authenticated;

create table hl_order_private.state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0)
);
insert into hl_order_private.state(singleton) values(true);
create sequence hl_order_private.order_number_seq;

create table hl_order_private.dispositions (
  source_id text primary key,
  status text not null check(status in ('needed','draft','submitting','handled','removed','needs_review')),
  source jsonb not null,
  observed_fingerprint text not null,
  available_quantity numeric not null default 0 check(available_quantity >= 0),
  reason text not null default '',
  review_kind text,
  replacement_source_id text,
  updated_at timestamptz not null default now()
);
create table hl_order_private.drafts (
  source_id text primary key references hl_order_private.dispositions(source_id),
  quantity numeric not null check(quantity > 0),
  source jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.ph_hl_order_previews (
  id uuid primary key,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  state_revision bigint not null,
  source_fingerprint text not null,
  report jsonb not null check(jsonb_typeof(report)='object')
);
create table hl_order_private.orders (
  id uuid primary key,
  order_number text not null unique,
  preview_id uuid not null unique references public.ph_hl_order_previews(id),
  status text not null default 'queued' check(status in ('queued','sent','delivery_unknown','failed')),
  event_id uuid not null unique references public.ph_request_delivery_outbox(event_id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivery_receipt jsonb
);
create table hl_order_private.order_lines (
  id uuid primary key,
  order_id uuid not null references hl_order_private.orders(id),
  source_id text not null,
  source jsonb not null,
  quantity numeric not null check(quantity > 0),
  received_quantity numeric not null default 0 check(received_quantity >= 0),
  cancelled_quantity numeric not null default 0 check(cancelled_quantity >= 0),
  check(received_quantity + cancelled_quantity <= quantity),
  unique(order_id,source_id)
);
create index hl_order_lines_source on hl_order_private.order_lines(source_id,order_id);
create table hl_order_private.receipts (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null,
  order_id uuid not null references hl_order_private.orders(id),
  line_id uuid not null references hl_order_private.order_lines(id),
  received_quantity numeric not null check(received_quantity >= 0),
  previous_quantity numeric not null check(previous_quantity >= 0),
  quantity_delta numeric not null,
  reason text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(command_id,line_id)
);
create table hl_order_private.cancellations (
  id uuid primary key,
  order_id uuid not null references hl_order_private.orders(id),
  preview_id uuid not null unique references public.ph_hl_order_previews(id),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  status text not null default 'queued' check(status in ('queued','sent','delivery_unknown','failed')),
  event_id uuid not null unique references public.ph_request_delivery_outbox(event_id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivery_receipt jsonb
);
create index hl_cancellations_order on hl_order_private.cancellations(order_id,created_at);
create table hl_order_private.cancellation_lines (
  cancellation_id uuid not null references hl_order_private.cancellations(id),
  line_id uuid not null references hl_order_private.order_lines(id),
  quantity numeric not null check(quantity > 0),
  primary key(cancellation_id,line_id)
);
create index hl_cancellation_lines_line on hl_order_private.cancellation_lines(line_id,cancellation_id);
create table hl_order_private.commands (
  command_id uuid primary key,
  created_by uuid not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create table hl_order_private.history (
  id bigint generated always as identity primary key,
  command_id uuid,
  action text not null,
  payload jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Immutable reports are deliberately not client-writable, even by Dylan.
alter table public.ph_hl_order_previews enable row level security;
revoke all on public.ph_hl_order_previews from public,anon,authenticated,service_role;
grant select on public.ph_hl_order_previews to service_role;
do $$ declare t text; begin
  foreach t in array array['state','dispositions','drafts','orders','order_lines','receipts','cancellations','cancellation_lines','commands','history'] loop
    execute format('alter table hl_order_private.%I enable row level security',t);
  end loop;
end $$;
revoke all on all tables in schema hl_order_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema hl_order_private from public,anon,authenticated,service_role;

create function hl_order_private.assert_dylan() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
begin
  if actor is null
    or claims->>'role' is distinct from 'authenticated'
    or claims->>'iss' is distinct from 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1'
    or coalesce((claims->>'exp')::numeric,0) <= extract(epoch from now())
    or not exists(select 1 from public.profiles p where p.id=actor and p.username='dylan_collyge'
      and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now())
      and p.must_change_password is false)
    or not exists(select 1 from auth.sessions s where s.id::text=claims->>'session_id'
      and s.user_id=actor and (s.not_after is null or s.not_after>now())) then
    raise exception using errcode='42501',message='HL_ORDER_FORBIDDEN';
  end if;
  return actor;
end $$;

create function hl_order_private.quantity(value text) returns numeric
language sql immutable set search_path='' as $$
  select case when length(btrim(value)) between 1 and 24
    and btrim(value) ~ '^([0-9]+|[0-9]{1,3}(,[0-9]{3})+)([.][0-9]+)?$'
    then replace(btrim(value),',','')::numeric else null end
$$;
create function hl_order_private.fingerprint(value jsonb) returns text
language sql immutable set search_path='' as $$select encode(sha256(convert_to(value::text,'UTF8')),'hex')$$;

create function hl_order_private.source(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}'; key text; identity jsonb;
begin
  foreach key in array array['unique_id','itemcode','contsize','commonname','locationcode','lotcode','quantityordered','dock','stopnumber','transactionnumber','purchaseordernumber','tripnumber','customeridentityid','customername','consigneeidentityid','consigneename','ptravailable','invoicedate'] loop
    result:=result||jsonb_build_object(key,btrim(coalesce(value->>key,'')));
  end loop;
  result:=result||jsonb_build_object('source_id',result->>'unique_id','planstartdate',btrim(coalesce(nullif(value->>'planstartdate',''),value->>'planstart','')),'ptravailable',null);
  -- Availability is supplementary, not an order identity or a reorder trigger.
  identity:=result-'ptravailable'-'source_id';
  return result||jsonb_build_object('source_fingerprint',hl_order_private.fingerprint(identity));
end $$;

create function hl_order_private.sources() returns table(source_id text,source jsonb)
language sql stable security definer set search_path='' as $$
  select s.unique_id,n.source from public.ph_soc_master s
  cross join lateral (select hl_order_private.source(to_jsonb(s)) source) n
  where btrim(coalesce(s.unique_id,''))<>''
    and upper(n.source->>'invoicedate') in ('','NULL')
    and (n.source->>'dock'<>'' or n.source->>'planstartdate'<>'')
    and (upper(n.source->>'locationcode') in ('C.05','0.00.111')
      or upper(n.source->>'locationcode') ~ '^(C[.]12|B[.]10|C[.]14)[.].+')
$$;

-- Capture authoritative inventory availability only at preview. Ambiguous,
-- missing or invalid inventory stays NULL; a real zero remains numeric zero.
create function hl_order_private.report_source(p_source jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select p_source||jsonb_build_object('ptravailable',case when count(*)=1
    then max(hl_order_private.quantity(m.ptravailable::text)) else null end)
  from public.ph_master_inventory m
  where upper(btrim(coalesce(m.itemcode::text,'')))=upper(p_source->>'itemcode')
    and upper(btrim(coalesce(m.contsize::text,'')))=upper(p_source->>'contsize')
    and upper(btrim(coalesce(m.locationcode::text,'')))=upper(p_source->>'locationcode')
    and upper(btrim(coalesce(m.lotcode::text,'')))=upper(p_source->>'lotcode')
    and p_source->>'itemcode'<>'' and p_source->>'contsize'<>''
$$;

create function hl_order_private.business_key(source jsonb) returns text
language sql immutable set search_path='' as $$
  select case when coalesce(source->>'transactionnumber','')<>'' or coalesce(source->>'purchaseordernumber','')<>''
    then hl_order_private.fingerprint(jsonb_build_array(upper(source->>'transactionnumber'),upper(source->>'purchaseordernumber'),
      upper(coalesce(nullif(source->>'customeridentityid',''),source->>'customername')),
      upper(coalesce(nullif(source->>'consigneeidentityid',''),source->>'consigneename')),
      upper(source->>'itemcode'),upper(source->>'contsize'))) else null end
$$;

create function hl_order_private.pending_cancellation(p_line_id uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(l.quantity),0) from hl_order_private.cancellation_lines l
  join hl_order_private.cancellations c on c.id=l.cancellation_id
  where l.line_id=p_line_id and c.status<>'sent'
$$;

-- Called with the global state lock held. One import may invalidate many rows,
-- but advances the CAS revision only once; source rows are never changed.
create function hl_order_private.reconcile() returns boolean
language plpgsql security definer set search_path='' as $$
declare changed boolean:=false; count_changed integer;
begin
  with current_rows as materialized(select * from hl_order_private.sources())
  update hl_order_private.dispositions d set status='needs_review',
    reason=case when c.source is null then 'Source disappeared or is no longer eligible' else 'Source fields or quantity changed' end,
    review_kind=case when c.source is null then 'source_missing' else 'source_changed' end,
    observed_fingerprint=coalesce(c.source->>'source_fingerprint','missing'),updated_at=now()
  from (select old.source_id,cur.source from hl_order_private.dispositions old left join current_rows cur using(source_id)) c
  where d.source_id=c.source_id and d.observed_fingerprint is distinct from coalesce(c.source->>'source_fingerprint','missing');
  get diagnostics count_changed=row_count; changed:=count_changed>0;

  -- A replacement ID matching previous order/customer/item/size is quarantined,
  -- never silently shown as fresh work alongside a handled imported row.
  with candidates as (
    select distinct on (s.source_id) s.source_id,s.source,d.source_id prior_source_id
    from hl_order_private.sources() s join hl_order_private.dispositions d
      on hl_order_private.business_key(s.source)=hl_order_private.business_key(d.source)
    where s.source_id<>d.source_id and d.observed_fingerprint='missing'
      and not exists(select 1 from hl_order_private.dispositions x where x.source_id=s.source_id)
    order by s.source_id,d.source_id
  ) insert into hl_order_private.dispositions(source_id,status,source,observed_fingerprint,available_quantity,reason,review_kind)
    select source_id,'needs_review',source,source->>'source_fingerprint',coalesce(hl_order_private.quantity(source->>'quantityordered'),0),
      'Possible replacement for '||prior_source_id,'possible_replacement' from candidates;
  get diagnostics count_changed=row_count; changed:=changed or count_changed>0;
  if changed then update hl_order_private.state set revision=revision+1 where singleton; end if;
  return changed;
end $$;

create function hl_order_private.order_json(p_order_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(o)||jsonb_build_object(
    'fulfillment_status',case when totals.outstanding=0 and totals.cancelled=totals.quantity then 'cancelled'
      when totals.outstanding=0 and totals.cancelled>0 then 'received_and_cancelled'
      when totals.outstanding=0 then 'received' when totals.cancelled>0 then 'partially_cancelled'
      when totals.received>0 then 'partially_received' else 'open' end,
    'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('outstanding_quantity',l.quantity-l.received_quantity-l.cancelled_quantity,
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

create function hl_order_private.state_json() returns jsonb
language sql stable security definer set search_path='' as $$
  with current_rows as materialized(select * from hl_order_private.sources())
  select jsonb_build_object('revision',(select revision from hl_order_private.state where singleton),
    'draft',coalesce((select jsonb_agg(jsonb_build_object('source_id',d.source_id,'quantity',d.quantity,'source',d.source,
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
    'orders',coalesce((select jsonb_agg(hl_order_private.order_json(o.id) order by o.created_at desc,o.id) from hl_order_private.orders o),'[]'),
    'delivery_issues',coalesce((select jsonb_agg(jsonb_build_object('event_id',e.event_id,'event_type',e.event_type,'status',e.status,
      'delivery_status',e.channel_results->'email'->>'status','order_id',e.payload->>'order_id','last_error',e.sanitized_error_code)
      order by e.created_at) from public.ph_request_delivery_outbox e where e.event_type in ('hl_order_submission','hl_order_cancellation')
      and (e.status in ('failed','unknown') or e.channel_results->'email'->>'status' in ('sending','unknown'))),'[]'),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from (select * from hl_order_private.history order by id desc limit 100) h),'[]'))
$$;

create function public.hl_order_state() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform hl_order_private.assert_dylan();
  perform 1 from hl_order_private.state where singleton for update;
  lock table public.ph_soc_master in share mode;
  perform hl_order_private.reconcile();
  return hl_order_private.state_json();
end $$;

create function hl_order_private.draft_fingerprint() returns text
language sql stable security definer set search_path='' as $$
  select hl_order_private.fingerprint(coalesce(jsonb_agg(jsonb_build_array(d.source_id,d.quantity,d.source->>'source_fingerprint') order by d.source_id),'[]'))
  from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id) where x.status='draft'
$$;

create function public.hl_order_command(p_command_id uuid,p_action text,p_payload jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=hl_order_private.assert_dylan(); current_revision bigint; request_hash text; saved hl_order_private.commands;
  result jsonb; source_row jsonb; entry jsonb; report jsonb; report_lines jsonb; ids jsonb; keys text[];
  source_id_value text; target_id text; resolution text; reason text; qty numeric; ceiling numeric; previous_qty numeric;
  disposition hl_order_private.dispositions; target_disposition hl_order_private.dispositions;
  preview public.ph_hl_order_previews; ord hl_order_private.orders; order_line hl_order_private.order_lines;
  preview_id uuid; order_id_value uuid; cancellation_id_value uuid; event_id_value uuid; order_number_value text;
  event_row public.ph_request_delivery_outbox; seen_ids text[]:='{}'; preview_result jsonb;
begin
  if p_command_id is null or p_expected_revision is null or p_expected_revision<0 or octet_length(coalesce(p_payload::text,''))>200000
    or p_action is null or p_action not in ('draft_save','draft_clear','preview','submit','dismiss','restore','resolve_review','receive','cancellation_preview','cancellation_submit','reconcile_delivery') then
    raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
  end if;
  keys:=case p_action when 'draft_save' then array['rows'] when 'draft_clear' then array['source_ids']
    when 'preview' then array[]::text[] when 'submit' then array['preview_id']
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
      insert into hl_order_private.drafts(source_id,quantity,source) values(source_id_value,qty,source_row)
        on conflict(source_id) do update set quantity=excluded.quantity,source=excluded.source,updated_at=now();
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
    if not exists(select 1 from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id) where x.status='draft')
      or (select count(*) from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id) where x.status='draft')>500 then
      raise exception using errcode='22023',message='HL_ORDER_EMPTY_DRAFT';
    end if;
    preview_id:=gen_random_uuid(); order_id_value:=gen_random_uuid();
    order_number_value:='HL-'||to_char(now() at time zone 'America/Chicago','YYYY')||'-'||lpad(nextval('hl_order_private.order_number_seq')::text,6,'0');
    select jsonb_agg(hl_order_private.report_source(d.source)||jsonb_build_object('line_id',gen_random_uuid(),'quantity',d.quantity) order by d.source_id)
      into report_lines from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id) where x.status='draft';
    report:=jsonb_build_object('contract_version','hl-order-report-v1','kind','submission','order_id',order_id_value,
      'order_number',order_number_value,'created_at',now(),'lines',report_lines,
      'total_quantity',(select sum(d.quantity) from hl_order_private.drafts d join hl_order_private.dispositions x using(source_id) where x.status='draft'));
    insert into public.ph_hl_order_previews(id,created_by,expires_at,state_revision,source_fingerprint,report)
      values(preview_id,actor,now()+interval '30 minutes',current_revision+1,hl_order_private.draft_fingerprint(),report);
    preview_result:=jsonb_build_object('id',preview_id,'report',report);

  elsif p_action='submit' then
    select * into preview from public.ph_hl_order_previews where id=(p_payload->>'preview_id')::uuid;
    if not found or preview.created_by<>actor or preview.report->>'kind'<>'submission' or preview.expires_at<=now()
      or preview.state_revision<>current_revision or preview.source_fingerprint<>hl_order_private.draft_fingerprint() then
      raise exception using errcode='55000',message='HL_ORDER_PREVIEW_STALE';
    end if;
    order_id_value:=(preview.report->>'order_id')::uuid; event_id_value:=gen_random_uuid();
    insert into public.ph_request_delivery_outbox(event_id,event_key,event_type,payload)
      values(event_id_value,'hl_order_submission:'||order_id_value,'hl_order_submission',jsonb_build_object(
        'contract_version','hl-order-delivery-v1','order_id',order_id_value,'preview_id',preview.id,'created_by',actor));
    insert into hl_order_private.orders(id,order_number,preview_id,event_id,created_by)
      values(order_id_value,preview.report->>'order_number',preview.id,event_id_value,actor);
    for entry in select value from jsonb_array_elements(preview.report->'lines') loop
      source_id_value:=entry->>'source_id'; perform hl_order_private.assert_source_unlocked(source_id_value);
      insert into hl_order_private.order_lines(id,order_id,source_id,source,quantity)
        values((entry->>'line_id')::uuid,order_id_value,source_id_value,entry-'line_id'-'quantity',(entry->>'quantity')::numeric);
      update hl_order_private.dispositions set status='submitting',available_quantity=0,reason='Order email queued',updated_at=now() where source_id=source_id_value;
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
      report:=jsonb_build_object('contract_version','hl-order-report-v1','kind','cancellation','order_id',ord.id,'cancellation_id',cancellation_id_value,
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

create function hl_order_private.assert_keys(value jsonb,allowed text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(value) k where not(k=any(allowed))) then
    raise exception using errcode='22023',message='HL_ORDER_INVALID_COMMAND';
  end if;
end $$;

create function hl_order_private.assert_source_unlocked(p_source_id text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if exists(select 1 from hl_order_private.order_lines l join hl_order_private.orders o on o.id=l.order_id
    where l.source_id=p_source_id and o.status<>'sent')
    or exists(select 1 from hl_order_private.cancellation_lines l join hl_order_private.cancellations c on c.id=l.cancellation_id
      join hl_order_private.order_lines ol on ol.id=l.line_id where ol.source_id=p_source_id and c.status<>'sent') then
    raise exception using errcode='55000',message='HL_ORDER_DELIVERY_UNKNOWN';
  end if;
end $$;

-- Reports and historical identity are append-only. Only receipt/cancellation
-- balances and delivery metadata can change through the protected functions.
create function hl_order_private.protect_history() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='order_lines' and tg_op='UPDATE'
    and (to_jsonb(new)-'received_quantity'-'cancelled_quantity')=(to_jsonb(old)-'received_quantity'-'cancelled_quantity') then return new; end if;
  raise exception using errcode='55000',message='HL_ORDER_HISTORY_IMMUTABLE';
end $$;
create trigger hl_preview_immutable before update or delete on public.ph_hl_order_previews
  for each row execute function hl_order_private.protect_history();
create trigger hl_lines_immutable before update or delete on hl_order_private.order_lines
  for each row execute function hl_order_private.protect_history();
create trigger hl_receipts_immutable before update or delete on hl_order_private.receipts
  for each row execute function hl_order_private.protect_history();
create trigger hl_cancellation_lines_immutable before update or delete on hl_order_private.cancellation_lines
  for each row execute function hl_order_private.protect_history();
create trigger hl_history_immutable before update or delete on hl_order_private.history
  for each row execute function hl_order_private.protect_history();
create trigger hl_commands_immutable before update or delete on hl_order_private.commands
  for each row execute function hl_order_private.protect_history();

-- Generic worker acknowledgements may arrive after Apps Script has already
-- persisted the Gmail receipt. Preserve proof and intent monotonically, without
-- changing any non-HL event's existing worker semantics or recipient routing.
create function hl_order_private.protect_delivery() returns trigger
language plpgsql set search_path='' as $$
declare prior jsonb:=coalesce(old.channel_results->'email','{}'); incoming jsonb;
begin
  if old.event_type not in ('hl_order_submission','hl_order_cancellation') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then raise exception using errcode='55000',message='HL_ORDER_HISTORY_IMMUTABLE'; end if;
  if (new.event_id,new.event_key,new.event_type,new.payload,new.request_id,new.request_folder)
    is distinct from (old.event_id,old.event_key,old.event_type,old.payload,old.request_id,old.request_folder) then
    raise exception using errcode='55000',message='HL_ORDER_HISTORY_IMMUTABLE';
  end if;
  incoming:=coalesce(new.channel_results->'email','{}');
  if prior->>'status'='sent' then
    new.channel_results:=coalesce(new.channel_results,'{}')||jsonb_build_object('email',incoming||prior);
    new.gmail_message_id:=coalesce(old.gmail_message_id,new.gmail_message_id);
    new.gmail_thread_id:=coalesce(old.gmail_thread_id,new.gmail_thread_id);
    new.message_id_header:=coalesce(old.message_id_header,new.message_id_header);
    new.email_delivered_at:=coalesce(old.email_delivered_at,new.email_delivered_at);
  elsif prior->>'status' in ('sending','unknown') and (coalesce(incoming->>'status','') not in ('sent','unknown','sending')
    or (prior->>'status'='unknown' and incoming->>'status'='sending')) then
    new.channel_results:=coalesce(new.channel_results,'{}')||jsonb_build_object('email',incoming||prior);
  end if;
  return new;
end $$;
create trigger hl_order_delivery_guard before update or delete on public.ph_request_delivery_outbox
  for each row execute function hl_order_private.protect_delivery();

-- This trigger follows the existing worker lock order (outbox, then state).
-- Commands never wait on existing outbox rows while holding the state lock.
create function hl_order_private.apply_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare email jsonb:=coalesce(new.channel_results->'email','{}'); delivery_status text;
  ord hl_order_private.orders; cancellation hl_order_private.cancellations;
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
    select * into ord from hl_order_private.orders where event_id=new.event_id;
    if not found or ord.status='sent' or ord.status=delivery_status then return new; end if;
    update hl_order_private.orders set status=delivery_status,
      sent_at=case when delivery_status='sent' then now() else sent_at end,
      delivery_receipt=case when delivery_status='sent' then email else delivery_receipt end where id=ord.id;
    if delivery_status='sent' then
      update hl_order_private.dispositions d set status='handled',reason='Order email confirmed',updated_at=now()
        from hl_order_private.order_lines l where l.order_id=ord.id and l.source_id=d.source_id and d.status='submitting';
      delete from hl_order_private.drafts d using hl_order_private.order_lines l where l.order_id=ord.id and l.source_id=d.source_id;
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
create trigger hl_order_delivery_apply after update on public.ph_request_delivery_outbox
  for each row execute function hl_order_private.apply_delivery();

create function public.hl_order_delivery_lookup_v1(p_event_id uuid) returns jsonb
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
    or (event.event_type='hl_order_submission' and (preview.report->>'kind'<>'submission'
      or not exists(select 1 from hl_order_private.orders o where o.id=order_id_value and o.event_id=event.event_id and o.preview_id=preview.id)))
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

create function public.hl_order_delivery_record_v1(p_event_id uuid,p_lease_token uuid,p_status text,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare event public.ph_request_delivery_outbox; email jsonb; prior_status text; result jsonb;
begin
  if not private.is_service_role_request() then raise exception using errcode='42501',message='HL_ORDER_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('sending','sent','unknown','failed') or jsonb_typeof(p_result) is distinct from 'object'
    or octet_length(p_result::text)>32000 then raise exception using errcode='22023',message='HL_ORDER_INVALID_DELIVERY_RESULT'; end if;
  -- Match the shared worker's lock order; its AFTER trigger takes state second.
  select * into event from public.ph_request_delivery_outbox where event_id=p_event_id
    and event_type in ('hl_order_submission','hl_order_cancellation') for update;
  if not found or event.status<>'processing' or event.lease_token is distinct from p_lease_token
    or p_lease_token is null or event.lease_expires_at is null or event.lease_expires_at<=now() then
    raise exception using errcode='55000',message='HL_ORDER_DELIVERY_LEASE_LOST';
  end if;
  email:=coalesce(event.channel_results->'email','{}'); prior_status:=coalesce(email->>'status','pending');
  if prior_status='sent' then return jsonb_build_object('allow_send',false,'reconciliation_only',true,'status','sent'); end if;
  if p_status='sending' and prior_status in ('sending','unknown') then
    return jsonb_build_object('allow_send',false,'reconciliation_only',true,'status',prior_status);
  end if;
  if p_status='sending' and prior_status='failed' and coalesce(email->'safe_to_retry','false')<>'true'::jsonb then
    return jsonb_build_object('allow_send',false,'reconciliation_only',true,'status','unknown');
  end if;
  if p_status='sent' and nullif(btrim(p_result->>'gmail_message_id'),'') is null then
    raise exception using errcode='22023',message='HL_ORDER_DELIVERY_RECEIPT_REQUIRED';
  end if;
  if p_status='failed' and (p_result->'safe_to_retry' is distinct from 'true'::jsonb or prior_status in ('sending','unknown')) then
    raise exception using errcode='22023',message='HL_ORDER_DELIVERY_UNKNOWN';
  end if;
  email:=email||p_result||jsonb_build_object('status',p_status,'updated_at',now());
  if p_status='sent' then email:=email||jsonb_build_object('delivered_at',now(),'safe_to_retry',false); end if;
  if p_status in ('sending','unknown') then email:=email||jsonb_build_object('safe_to_retry',false); end if;
  -- The existing function preserves the active lease for the normal worker's
  -- later complete/fail call and applies the same channel metadata fields.
  perform public.record_request_delivery_channel_result(p_event_id,p_lease_token,jsonb_build_object('email',email));
  return jsonb_build_object('allow_send',p_status='sending','reconciliation_only',p_status in ('unknown','sent'),'status',p_status);
end $$;

create function public.hl_order_can_read_outbox_v1() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  perform hl_order_private.assert_dylan(); return true;
exception when others then return false;
end $$;
revoke all on function public.hl_order_can_read_outbox_v1() from public,anon,authenticated,service_role;
grant execute on function public.hl_order_can_read_outbox_v1() to authenticated;
create policy hl_order_delivery_dylan_read on public.ph_request_delivery_outbox
  as restrictive for select to authenticated
  using(event_type not in ('hl_order_submission','hl_order_cancellation') or (select public.hl_order_can_read_outbox_v1()));

-- The legacy manager recovery RPCs are SECURITY DEFINER and bypass RLS.
-- Keep their exact non-HL behavior, but route HL recovery exclusively through
-- the revisioned Dylan command so protected payloads/intents cannot leak/reset.
create or replace function public.get_request_delivery_recovery_queue()
returns table(event_id uuid,event_type text,request_id text,request_folder text,status text,attempt_count integer,
  next_attempt_at timestamptz,first_attempt_at timestamptz,last_attempt_at timestamptz,lease_expires_at timestamptz,
  sanitized_error_code text,email_delivered_at timestamptz,push_delivered_at timestamptz,delivery_mode text,
  created_at timestamptz,pending_age_seconds bigint,history_snapshot jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_manage_requests() then raise exception using errcode='42501',message='REQUEST_RECOVERY_FORBIDDEN'; end if;
  return query
  select o.event_id,o.event_type,o.request_id,o.request_folder,o.status,o.attempt_count,o.next_attempt_at,o.first_attempt_at,
    o.last_attempt_at,o.lease_expires_at,o.sanitized_error_code,o.email_delivered_at,o.push_delivered_at,o.delivery_mode,
    o.created_at,extract(epoch from (now()-o.created_at))::bigint,h.snapshot
  from public.ph_request_delivery_outbox o left join public.ph_request_history h on h.unique_id=o.request_id
  where o.event_type not in ('hl_order_submission','hl_order_cancellation')
    and (o.status in ('unknown','failed') or (o.status='pending' and o.next_attempt_at<=now()-interval '2 minutes')
      or (o.status='processing' and coalesce(o.lease_expires_at,o.last_attempt_at)<=now()))
  order by o.created_at desc;
end $$;
create or replace function public.requeue_request_delivery(delivery_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare updated_event public.ph_request_delivery_outbox;
begin
  if not private.can_manage_requests() then raise exception using errcode='42501',message='REQUEST_RECOVERY_FORBIDDEN'; end if;
  update public.ph_request_delivery_outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null,
    lease_token=null,lease_owner=null,lease_expires_at=null
  where event_id=delivery_event_id and event_type not in ('hl_order_submission','hl_order_cancellation')
    and (status in ('unknown','failed') or (status='pending' and next_attempt_at<=now())
      or (status='processing' and coalesce(lease_expires_at,last_attempt_at)<=now()))
  returning * into updated_event;
  if not found then raise exception using errcode='P0002',message='DELIVERY_EVENT_NOT_RECOVERABLE'; end if;
  return to_jsonb(updated_event)-'payload'-'channel_results';
end $$;
revoke all on function public.get_request_delivery_recovery_queue(),public.requeue_request_delivery(uuid) from public,anon;
grant execute on function public.get_request_delivery_recovery_queue(),public.requeue_request_delivery(uuid) to authenticated;

revoke all on all functions in schema hl_order_private from public,anon,authenticated,service_role;
revoke all on function public.hl_order_state(),public.hl_order_command(uuid,text,jsonb,bigint),
  public.hl_order_delivery_lookup_v1(uuid),public.hl_order_delivery_record_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.hl_order_state(),public.hl_order_command(uuid,text,jsonb,bigint) to authenticated;
grant execute on function public.hl_order_delivery_lookup_v1(uuid),public.hl_order_delivery_record_v1(uuid,uuid,text,jsonb) to service_role;
comment on function public.hl_order_command(uuid,text,jsonb,bigint) is
  'Active native Dylan only; globally serialized revision CAS and command-id replay; immutable preview required for submit/cancellation_submit. receive records total received, never inventory.';
comment on function public.hl_order_delivery_record_v1(uuid,uuid,text,jsonb) is
  'Leased service-only send intent/receipt. Sending or unknown always reconciles without blind resend; sent receipt is monotonic.';
commit;
